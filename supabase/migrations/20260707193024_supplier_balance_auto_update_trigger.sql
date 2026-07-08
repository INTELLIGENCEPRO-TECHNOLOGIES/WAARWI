-- Add trigger to automatically update supplier balance when orders change
-- This ensures the balance column stays in sync without needing explicit RPC calls

CREATE OR REPLACE FUNCTION trigger_update_supplier_balance()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_supplier_id uuid;
  v_tenant_id uuid;
  v_new_balance numeric;
BEGIN
  -- Determine which supplier to update
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

  -- Recalculate: unpaid orders + balance adjustments
  v_new_balance := COALESCE((
    SELECT GREATEST(0, SUM(o.total) - SUM(COALESCE(o.paid, 0)))
    FROM supplier_orders o
    WHERE o.supplier_id = v_supplier_id
      AND o.tenant_id = v_tenant_id
      AND o.status != 'cancelled'
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

-- Fire on INSERT, UPDATE (of total, paid, status, supplier_id), DELETE
DROP TRIGGER IF EXISTS trg_supplier_orders_update_balance ON supplier_orders;
CREATE TRIGGER trg_supplier_orders_update_balance
  AFTER INSERT OR UPDATE OF total, paid, status, supplier_id OR DELETE
  ON supplier_orders
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_supplier_balance();

-- Also handle when supplier_id changes (old supplier needs recalculation too)
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
        AND o.status != 'cancelled'
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

DROP TRIGGER IF EXISTS trg_supplier_orders_update_old_balance ON supplier_orders;
CREATE TRIGGER trg_supplier_orders_update_old_balance
  AFTER UPDATE OF supplier_id
  ON supplier_orders
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_old_supplier_balance();

-- Recalculate ALL supplier balances now to fix any stale data
UPDATE suppliers s
SET balance = GREATEST(0,
  COALESCE((
    SELECT GREATEST(0, SUM(o.total) - SUM(COALESCE(o.paid, 0)))
    FROM supplier_orders o
    WHERE o.supplier_id = s.id AND o.tenant_id = s.tenant_id AND o.status != 'cancelled'
  ), 0) + COALESCE((
    SELECT SUM(ba.amount) FROM balance_adjustments ba
    WHERE ba.entity_id = s.id AND ba.entity_type = 'supplier' AND ba.tenant_id = s.tenant_id
  ), 0)
);