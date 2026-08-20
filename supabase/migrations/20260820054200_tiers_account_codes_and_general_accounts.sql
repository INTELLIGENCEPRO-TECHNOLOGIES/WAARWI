/*
# Tiers Account Codes and General Accounts (411/401)

## Summary
Assigns structured account codes to all customers and suppliers for the professional
"Gestion des tiers" module, inspired by Sage 100 conventions.

## Changes

1. **General Accounts (accounting_accounts)**
   - Creates `4110000` (Clients, type=asset) for every tenant missing it
   - Creates `4010000` (Fournisseurs, type=liability) for every tenant missing it

2. **Customer account_code backfill**
   - Assigns `4110001`, `4110002`, ... to customers with NULL account_code
   - Preserves all existing codes unchanged

3. **Supplier account_code backfill**
   - Assigns `4010001`, `4010002`, ... to suppliers with NULL account_code

4. **Unique constraint** via partial unique indexes on (tenant_id, account_code)

5. **Search indexes** for fast lookup by account_code

6. **Auto-assign triggers** for new customers/suppliers

## Safety
- ONLY fills account_code where NULL; never overwrites existing values
- No balances, sales, payments affected
- Idempotent (safe to re-run)
*/

-- 1. Create 4110000 (Clients) for tenants missing it
INSERT INTO accounting_accounts (id, tenant_id, code, name, type, created_at)
SELECT gen_random_uuid(), t.id, '4110000', 'Clients', 'asset', now()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM accounting_accounts a
  WHERE a.tenant_id = t.id AND a.code = '4110000'
);

-- 2. Create 4010000 (Fournisseurs) for tenants missing it
INSERT INTO accounting_accounts (id, tenant_id, code, name, type, created_at)
SELECT gen_random_uuid(), t.id, '4010000', 'Fournisseurs', 'liability', now()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM accounting_accounts a
  WHERE a.tenant_id = t.id AND a.code = '4010000'
);

-- 3. Backfill customer account_codes (411XXXX)
DO $$
DECLARE
  t_id uuid;
  max_seq int;
  cust record;
  seq int;
BEGIN
  FOR t_id IN SELECT id FROM tenants LOOP
    SELECT COALESCE(MAX(NULLIF(substring(account_code FROM 4),'')::int), 0)
    INTO max_seq
    FROM customers
    WHERE tenant_id = t_id
      AND account_code IS NOT NULL
      AND account_code ~ '^411[0-9]+$';

    seq := max_seq;

    FOR cust IN
      SELECT id FROM customers
      WHERE tenant_id = t_id AND account_code IS NULL
      ORDER BY created_at, id
    LOOP
      seq := seq + 1;
      UPDATE customers SET account_code = '411' || LPAD(seq::text, 4, '0')
      WHERE id = cust.id;
    END LOOP;
  END LOOP;
END $$;

-- 4. Backfill supplier account_codes (401XXXX)
DO $$
DECLARE
  t_id uuid;
  max_seq int;
  sup record;
  seq int;
BEGIN
  FOR t_id IN SELECT id FROM tenants LOOP
    SELECT COALESCE(MAX(NULLIF(substring(account_code FROM 4),'')::int), 0)
    INTO max_seq
    FROM suppliers
    WHERE tenant_id = t_id
      AND account_code IS NOT NULL
      AND account_code ~ '^401[0-9]+$';

    seq := max_seq;

    FOR sup IN
      SELECT id FROM suppliers
      WHERE tenant_id = t_id AND account_code IS NULL
      ORDER BY created_at, id
    LOOP
      seq := seq + 1;
      UPDATE suppliers SET account_code = '401' || LPAD(seq::text, 4, '0')
      WHERE id = sup.id;
    END LOOP;
  END LOOP;
END $$;

-- 5. Partial unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_tenant_account_code_unique
  ON customers (tenant_id, account_code)
  WHERE account_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_tenant_account_code_unique
  ON suppliers (tenant_id, account_code)
  WHERE account_code IS NOT NULL;

-- 6. Search indexes
CREATE INDEX IF NOT EXISTS idx_customers_tenant_account_code
  ON customers (tenant_id, account_code);

CREATE INDEX IF NOT EXISTS idx_suppliers_tenant_account_code
  ON suppliers (tenant_id, account_code);

-- 7. Auto-assign trigger for customers
CREATE OR REPLACE FUNCTION assign_customer_account_code()
RETURNS TRIGGER AS $$
DECLARE
  max_seq int;
BEGIN
  IF NEW.account_code IS NULL THEN
    SELECT COALESCE(MAX(NULLIF(substring(account_code FROM 4),'')::int), 0)
    INTO max_seq
    FROM customers
    WHERE tenant_id = NEW.tenant_id
      AND account_code IS NOT NULL
      AND account_code ~ '^411[0-9]+$';

    NEW.account_code := '411' || LPAD((max_seq + 1)::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assign_customer_account_code ON customers;
CREATE TRIGGER trg_assign_customer_account_code
  BEFORE INSERT ON customers
  FOR EACH ROW
  EXECUTE FUNCTION assign_customer_account_code();

-- 8. Auto-assign trigger for suppliers
CREATE OR REPLACE FUNCTION assign_supplier_account_code()
RETURNS TRIGGER AS $$
DECLARE
  max_seq int;
BEGIN
  IF NEW.account_code IS NULL THEN
    SELECT COALESCE(MAX(NULLIF(substring(account_code FROM 4),'')::int), 0)
    INTO max_seq
    FROM suppliers
    WHERE tenant_id = NEW.tenant_id
      AND account_code IS NOT NULL
      AND account_code ~ '^401[0-9]+$';

    NEW.account_code := '401' || LPAD((max_seq + 1)::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assign_supplier_account_code ON suppliers;
CREATE TRIGGER trg_assign_supplier_account_code
  BEFORE INSERT ON suppliers
  FOR EACH ROW
  EXECUTE FUNCTION assign_supplier_account_code();
