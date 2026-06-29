-- Fix suppliers.balance to reflect net owed (total_orders - total_paid)
-- Previously it was being decremented per payment (wrong: ended up negative = cumulative payments)

-- 1. Recompute all supplier balances from actual order data
UPDATE suppliers s
SET balance = COALESCE((
  SELECT GREATEST(0, SUM(o.total) - SUM(COALESCE(o.paid, 0)))
  FROM supplier_orders o
  WHERE o.supplier_id = s.id
    AND o.tenant_id = s.tenant_id
    AND o.status != 'cancelled'
), 0);

-- 2. Create a function to recompute a single supplier's balance (called after payments)
CREATE OR REPLACE FUNCTION recompute_supplier_balance(p_supplier_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  UPDATE suppliers
  SET balance = COALESCE((
    SELECT GREATEST(0, SUM(o.total) - SUM(COALESCE(o.paid, 0)))
    FROM supplier_orders o
    WHERE o.supplier_id = p_supplier_id
      AND o.tenant_id = suppliers.tenant_id
      AND o.status != 'cancelled'
  ), 0)
  WHERE id = p_supplier_id;
END;
$$;
