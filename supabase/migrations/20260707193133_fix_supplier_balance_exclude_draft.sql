-- Fix: exclude draft orders from supplier balance calculation
-- Draft orders should not count toward debt until confirmed

CREATE OR REPLACE FUNCTION trigger_update_supplier_balance()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_supplier_id uuid;
  v_tenant_id uuid;
  v_new_balance numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_supplier_id := OLD.supplier_id;
    v_tenant_id := OLD.tenant_id;
  ELSE
    v_supplier_id := NEW.supplier_id;
    v_tenant_id := NEW.tenant_id;
  END IF;

  IF v_supplier_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_new_balance := COALESCE((
    SELECT GREATEST(0, SUM(o.total) - SUM(COALESCE(o.paid, 0)))
    FROM supplier_orders o
    WHERE o.supplier_id = v_supplier_id
      AND o.tenant_id = v_tenant_id
      AND o.status NOT IN ('cancelled', 'draft')
  ), 0) + COALESCE((
    SELECT SUM(amount) FROM balance_adjustments
    WHERE entity_id = v_supplier_id AND entity_type = 'supplier' AND tenant_id = v_tenant_id
  ), 0);

  UPDATE suppliers
  SET balance = GREATEST(0, v_new_balance)
  WHERE id = v_supplier_id AND tenant_id = v_tenant_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Also update recompute_supplier_balance to exclude drafts
CREATE OR REPLACE FUNCTION recompute_supplier_balance(p_supplier_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_new_balance numeric;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM suppliers WHERE id = p_supplier_id;

  v_new_balance := COALESCE((
    SELECT GREATEST(0, SUM(o.total) - SUM(COALESCE(o.paid, 0)))
    FROM supplier_orders o
    WHERE o.supplier_id = p_supplier_id
      AND o.tenant_id = v_tenant_id
      AND o.status NOT IN ('cancelled', 'draft')
  ), 0) + COALESCE((
    SELECT SUM(amount) FROM balance_adjustments
    WHERE entity_id = p_supplier_id AND entity_type = 'supplier' AND tenant_id = v_tenant_id
  ), 0);

  UPDATE suppliers
  SET balance = GREATEST(0, v_new_balance)
  WHERE id = p_supplier_id;
END;
$$;

-- Also fix the old supplier trigger
CREATE OR REPLACE FUNCTION trigger_update_old_supplier_balance()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_new_balance numeric;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.supplier_id IS DISTINCT FROM NEW.supplier_id AND OLD.supplier_id IS NOT NULL THEN
    v_new_balance := COALESCE((
      SELECT GREATEST(0, SUM(o.total) - SUM(COALESCE(o.paid, 0)))
      FROM supplier_orders o
      WHERE o.supplier_id = OLD.supplier_id
        AND o.tenant_id = OLD.tenant_id
        AND o.status NOT IN ('cancelled', 'draft')
    ), 0) + COALESCE((
      SELECT SUM(amount) FROM balance_adjustments
      WHERE entity_id = OLD.supplier_id AND entity_type = 'supplier' AND tenant_id = OLD.tenant_id
    ), 0);

    UPDATE suppliers
    SET balance = GREATEST(0, v_new_balance)
    WHERE id = OLD.supplier_id AND tenant_id = OLD.tenant_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Recalculate all supplier balances with draft exclusion
UPDATE suppliers s
SET balance = GREATEST(0,
  COALESCE((
    SELECT GREATEST(0, SUM(o.total) - SUM(COALESCE(o.paid, 0)))
    FROM supplier_orders o
    WHERE o.supplier_id = s.id AND o.tenant_id = s.tenant_id AND o.status NOT IN ('cancelled', 'draft')
  ), 0) + COALESCE((
    SELECT SUM(ba.amount) FROM balance_adjustments ba
    WHERE ba.entity_id = s.id AND ba.entity_type = 'supplier' AND ba.tenant_id = s.tenant_id
  ), 0)
);