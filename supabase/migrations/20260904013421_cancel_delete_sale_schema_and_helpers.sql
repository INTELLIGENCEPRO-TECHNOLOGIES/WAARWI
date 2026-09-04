/*
# Cancel & Delete sale: traceability, atomic cancellation, safe deletion

## Overview
Reworks the "Annuler" (cancel) and "Supprimer" (delete) operations on invoices/sales
to be financially safe, atomic, and traceable.

## 1. New Tables

### sale_lot_deductions
Records exactly which stock lots were consumed by each sale item, so cancellation
and deletion can restore the correct lots rather than guessing.
- sale_id (uuid, FK sales)
- sale_item_id (uuid, FK sale_items)
- lot_id (uuid, FK stock_lots)
- article_id (uuid, FK articles)
- site_id (uuid, FK sites)
- quantity (numeric) — how much was deducted from this lot
- created_at (timestamptz)

### sale_deletion_log
Minimal audit trail for deleted sales (number, amount, reason, user, timestamp).
- id, tenant_id, sale_number, sale_total, sale_id_snapshot, reason, user_id, created_at

## 2. Modified Tables

### sales
- ADD COLUMN cancelled_at timestamptz (nullable)
- ADD COLUMN cancelled_by uuid REFERENCES auth.users (nullable)
- ADD COLUMN cancel_reason text DEFAULT '' (nullable)

### sale_items
- ADD COLUMN site_id uuid REFERENCES sites(id) ON DELETE SET NULL (nullable)
  Records which site fulfilled each line, so cancel/restore targets the right site.

## 3. Security
- sale_lot_deductions: RLS enabled, authenticated CRUD scoped to current_tenant_id()
- sale_deletion_log: RLS enabled, authenticated SELECT only (insert is server-side via SECURITY DEFINER)
- REVOKE EXECUTE on cancel_sale and delete_sale_and_recalculate from PUBLIC and anon
- GRANT EXECUTE to authenticated only

## 4. Important Notes
- Forward-only, idempotent (uses IF NOT EXISTS / DO blocks)
- Does NOT modify or recalculate any historical data
- cancel_sale is rewritten to be atomic, idempotent, and guarded
- delete_sale_and_recalculate is rewritten with eligibility guards
- Sale creation functions (create_pos_sale_lot, create_credit_sale) now insert
  into sale_lot_deductions so lot restoration is precise
*/

-- ── Schema additions ──────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sales' AND column_name = 'cancelled_at') THEN
    ALTER TABLE sales ADD COLUMN cancelled_at timestamptz;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sales' AND column_name = 'cancelled_by') THEN
    ALTER TABLE sales ADD COLUMN cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sales' AND column_name = 'cancel_reason') THEN
    ALTER TABLE sales ADD COLUMN cancel_reason text DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sale_items' AND column_name = 'site_id') THEN
    ALTER TABLE sale_items ADD COLUMN site_id uuid REFERENCES sites(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS sale_lot_deductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  sale_item_id uuid REFERENCES sale_items(id) ON DELETE CASCADE,
  lot_id uuid NOT NULL REFERENCES stock_lots(id) ON DELETE CASCADE,
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  quantity numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sld_sale_id ON sale_lot_deductions(sale_id);
CREATE INDEX IF NOT EXISTS idx_sld_lot_id ON sale_lot_deductions(lot_id);

ALTER TABLE sale_lot_deductions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sld_select_own" ON sale_lot_deductions;
CREATE POLICY "sld_select_own" ON sale_lot_deductions FOR SELECT
  TO authenticated USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "sld_insert_own" ON sale_lot_deductions;
CREATE POLICY "sld_insert_own" ON sale_lot_deductions FOR INSERT
  TO authenticated WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "sld_update_own" ON sale_lot_deductions;
CREATE POLICY "sld_update_own" ON sale_lot_deductions FOR UPDATE
  TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "sld_delete_own" ON sale_lot_deductions;
CREATE POLICY "sld_delete_own" ON sale_lot_deductions FOR DELETE
  TO authenticated USING (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS sale_deletion_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sale_id_snapshot uuid,
  sale_number text NOT NULL DEFAULT '',
  sale_total numeric DEFAULT 0,
  reason text DEFAULT '',
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sale_deletion_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sdl_select_own" ON sale_deletion_log;
CREATE POLICY "sdl_select_own" ON sale_deletion_log FOR SELECT
  TO authenticated USING (tenant_id = current_tenant_id());

-- ── Helper: check if a sale has linked financial effects ─────────────────

CREATE OR REPLACE FUNCTION public.sale_has_effects(p_sale_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_has_returns boolean;
  v_has_payments boolean;
  v_has_accounted_payments boolean;
  v_has_ipm boolean;
  v_has_ipm_in_bordereau boolean;
  v_sale_status text;
  v_accounting_status text;
BEGIN
  SELECT tenant_id, status, accounting_status INTO v_tenant_id, v_sale_status, v_accounting_status
  FROM sales WHERE id = p_sale_id;
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('exists', false);
  END IF;

  SELECT EXISTS(SELECT 1 FROM sale_returns WHERE sale_id = p_sale_id AND status IN ('pending','approved')) INTO v_has_returns;
  SELECT EXISTS(SELECT 1 FROM sale_payments WHERE sale_id = p_sale_id) INTO v_has_payments;
  SELECT EXISTS(SELECT 1 FROM sale_payments WHERE sale_id = p_sale_id AND accounting_status = 'accounted') INTO v_has_accounted_payments;
  SELECT EXISTS(SELECT 1 FROM ipm_ventes WHERE sale_id = p_sale_id) INTO v_has_ipm;
  SELECT EXISTS(SELECT 1 FROM ipm_ventes WHERE sale_id = p_sale_id AND bordereau_id IS NOT NULL) INTO v_has_ipm_in_bordereau;

  RETURN jsonb_build_object(
    'exists', true,
    'tenant_id', v_tenant_id,
    'status', v_sale_status,
    'accounting_status', v_accounting_status,
    'has_returns', v_has_returns,
    'has_payments', v_has_payments,
    'has_accounted_payments', v_has_accounted_payments,
    'has_ipm', v_has_ipm,
    'has_ipm_in_bordereau', v_has_ipm_in_bordereau
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sale_has_effects(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sale_has_effects(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.sale_has_effects(uuid) TO authenticated;
