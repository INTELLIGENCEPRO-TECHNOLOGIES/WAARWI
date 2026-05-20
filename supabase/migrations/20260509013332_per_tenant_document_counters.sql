/*
  # Per-tenant document counters (simpler, memorable, tenant-isolated numbers)

  1. Why
    - Existing numbers like `V-20260509-2d3dbc` are hard to read and memorise.
    - The online-order sequence was global, so numbers were shared across tenants
      (WEB-000001 for tenant A, WEB-000002 for tenant B, etc.). Each tenant must
      have its own continuous, starting-from-1 sequence per document kind.

  2. New tables
    - `tenant_doc_counters`
      - `tenant_id` (uuid, FK tenants)
      - `doc_kind`  (text) — one of: 'sale','invoice','quote','return','credit',
                                      'supplier_order','online_order'
      - `last_number` (bigint, default 0)
      - PK (tenant_id, doc_kind)

  3. New function
    - `next_doc_number(p_tenant_id uuid, p_kind text, p_prefix text)` returns text
      - Atomically increments the counter and returns `PREFIX-00001` (5-digit zero-padded).
      - Example: `V-00001`, `F-00042`, `WEB-00123`.
      - SECURITY DEFINER so anon inserts (online orders) can call it safely.

  4. Rewires
    - `create_pos_sale` / `create_pos_sale_v2` / `create_pos_sale_v3` → use `next_doc_number(..,'sale','V')`.
    - `convert_quote_to_sale` → `next_doc_number(..,'invoice','F')`.
    - `next_online_order_number` → uses per-tenant counter, returns `WEB-00001`.

  5. Security
    - Table RLS enabled. Only `next_doc_number` (SECURITY DEFINER) and the server
      functions touch it; no client-facing policies (no reads/writes by clients).
*/

-- ── counters table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_doc_counters (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  doc_kind  text NOT NULL,
  last_number bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, doc_kind)
);

ALTER TABLE tenant_doc_counters ENABLE ROW LEVEL SECURITY;

-- No client policies on purpose: access only through SECURITY DEFINER functions.

-- ── core helper: atomic per-tenant counter ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.next_doc_number(
  p_tenant_id uuid,
  p_kind      text,
  p_prefix    text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_num bigint;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'next_doc_number: tenant_id required';
  END IF;

  INSERT INTO tenant_doc_counters (tenant_id, doc_kind, last_number)
  VALUES (p_tenant_id, p_kind, 1)
  ON CONFLICT (tenant_id, doc_kind)
  DO UPDATE SET last_number = tenant_doc_counters.last_number + 1
  RETURNING last_number INTO v_num;

  RETURN p_prefix || '-' || lpad(v_num::text, 5, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_doc_number(uuid, text, text) TO anon, authenticated;

-- ── seed counters from existing data so we don't collide ─────────────────────
-- sales already generated (V- prefix) keep their numbers; the counter starts
-- above the count of existing sales per tenant so new ones are V-00001 onward
-- for tenants that had none, but do not clash for those that had any.
INSERT INTO tenant_doc_counters (tenant_id, doc_kind, last_number)
SELECT tenant_id, 'sale', COUNT(*) FROM sales GROUP BY tenant_id
ON CONFLICT (tenant_id, doc_kind) DO UPDATE
  SET last_number = GREATEST(tenant_doc_counters.last_number, EXCLUDED.last_number);

INSERT INTO tenant_doc_counters (tenant_id, doc_kind, last_number)
SELECT tenant_id, 'invoice',
       COUNT(*) FILTER (WHERE source = 'quote')
FROM sales GROUP BY tenant_id
ON CONFLICT (tenant_id, doc_kind) DO UPDATE
  SET last_number = GREATEST(tenant_doc_counters.last_number, EXCLUDED.last_number);

INSERT INTO tenant_doc_counters (tenant_id, doc_kind, last_number)
SELECT tenant_id, 'online_order', COUNT(*) FROM online_orders GROUP BY tenant_id
ON CONFLICT (tenant_id, doc_kind) DO UPDATE
  SET last_number = GREATEST(tenant_doc_counters.last_number, EXCLUDED.last_number);

-- ── rewire next_online_order_number to per-tenant ───────────────────────────
CREATE OR REPLACE FUNCTION public.next_online_order_number(p_tenant_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.next_doc_number(p_tenant_id, 'online_order', 'WEB');
$$;

GRANT EXECUTE ON FUNCTION public.next_online_order_number(uuid) TO anon, authenticated;