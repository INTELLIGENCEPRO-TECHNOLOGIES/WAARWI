/*
  # Assign auxiliary accounts to all existing customers and suppliers

  1. Changes
    - Assigns unique auxiliary account codes (4110001, 4110002...) to all customers without one
    - Assigns unique auxiliary account codes (4010001, 4010002...) to all suppliers without one
    - Creates corresponding entries in the accounts table for each auxiliary account
    - Updates existing journal_lines that used the collectif account (4110000/4010000)
      with a third_party_id to use the correct auxiliary account instead

  2. Logic (like Sage)
    - Each named tiers (client/fournisseur) gets its own auxiliary account
    - The collectif (4110000/4010000) is only for general ledger interrogation
    - Balance des tiers shows per-tiers debit/credit/solde using auxiliary accounts
    - After a credit sale is accounted, the client is debitor on their auxiliary account
    - After payment is accounted, the account balances to zero

  3. Notes
    - This does NOT touch sales without customer_id (client comptoir / cash sales)
      as those correctly go through caisse (5710000) and don't need an auxiliary
    - Existing journal_lines with third_party_id set are retroactively updated
*/

-- Step 1: Assign account_code to all customers that don't have one
DO $$
DECLARE
  v_tenant RECORD;
  v_customer RECORD;
  v_next_num int;
  v_code text;
BEGIN
  FOR v_tenant IN SELECT DISTINCT tenant_id FROM customers LOOP
    v_next_num := COALESCE(
      (SELECT MAX(CAST(SUBSTRING(account_code FROM 4) AS int))
       FROM customers
       WHERE tenant_id = v_tenant.tenant_id AND account_code IS NOT NULL AND account_code LIKE '411%'),
      0
    );

    FOR v_customer IN
      SELECT id, name FROM customers
      WHERE tenant_id = v_tenant.tenant_id AND (account_code IS NULL OR account_code = '')
      ORDER BY created_at
    LOOP
      v_next_num := v_next_num + 1;
      v_code := '411' || LPAD(v_next_num::text, 4, '0');

      UPDATE customers SET account_code = v_code WHERE id = v_customer.id;

      INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active)
      VALUES (v_tenant.tenant_id, v_code, v_customer.name, 4, 'auxiliary', true)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

-- Step 2: Assign account_code to all suppliers that don't have one
DO $$
DECLARE
  v_tenant RECORD;
  v_supplier RECORD;
  v_next_num int;
  v_code text;
BEGIN
  FOR v_tenant IN SELECT DISTINCT tenant_id FROM suppliers LOOP
    v_next_num := COALESCE(
      (SELECT MAX(CAST(SUBSTRING(account_code FROM 4) AS int))
       FROM suppliers
       WHERE tenant_id = v_tenant.tenant_id AND account_code IS NOT NULL AND account_code LIKE '401%'),
      0
    );

    FOR v_supplier IN
      SELECT id, name FROM suppliers
      WHERE tenant_id = v_tenant.tenant_id AND (account_code IS NULL OR account_code = '')
      ORDER BY created_at
    LOOP
      v_next_num := v_next_num + 1;
      v_code := '401' || LPAD(v_next_num::text, 4, '0');

      UPDATE suppliers SET account_code = v_code WHERE id = v_supplier.id;

      INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active)
      VALUES (v_tenant.tenant_id, v_code, v_supplier.name, 4, 'auxiliary', true)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

-- Step 3: Update existing journal_lines that use collectif 4110000 but have a third_party_id
-- Replace with the customer's auxiliary account
UPDATE journal_lines jl
SET
  account_code = c.account_code,
  account_name = c.name
FROM customers c
WHERE jl.third_party_id = c.id
  AND jl.account_code = '4110000'
  AND c.account_code IS NOT NULL
  AND c.account_code != '';

-- Step 4: Update existing journal_lines that use collectif 4010000 but have a third_party_id
-- Replace with the supplier's auxiliary account
UPDATE journal_lines jl
SET
  account_code = s.account_code,
  account_name = s.name
FROM suppliers s
WHERE jl.third_party_id = s.id
  AND jl.account_code = '4010000'
  AND s.account_code IS NOT NULL
  AND s.account_code != '';
