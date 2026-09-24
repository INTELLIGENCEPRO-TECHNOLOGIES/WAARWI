/*
# PC1B — Backfill accounting_account_mappings with 14 global engine roles

## Purpose
Populate accounting_account_mappings with 14 role→account correspondences for every
existing tenant. Each role maps to a well-known SYSCOHADA account code in the `accounts`
table. Payment-method-specific accounts (Wave 5212000, Orange Money 5211000, Free Money
5213000) are intentionally excluded — they remain on payment_methods.account_code.

## 14 roles inserted per tenant
| role_code          | account code |
|--------------------|-------------|
| CARRY_FORWARD      | 1200000     |
| RESULT_PROFIT      | 1310000     |
| RESULT_LOSS        | 1390000     |
| INVENTORY_GOODS    | 3110000     |
| SUPPLIER_CONTROL   | 4010000     |
| CUSTOMER_CONTROL   | 4110000     |
| VAT_INPUT          | 4456000     |
| VAT_OUTPUT         | 4457000     |
| BANK_DEFAULT       | 5210000     |
| CASH_DEFAULT       | 5710000     |
| PURCHASES_GOODS    | 6010000     |
| MISC_EXPENSE       | 6580000     |
| SALES_GOODS        | 7010000     |
| MISC_INCOME        | 7580000     |

## Safety
- Pre-check: if ANY tenant is missing ANY of the 14 account codes, the entire
  migration is aborted with a clear error message.
- Idempotent: ON CONFLICT (tenant_id, role_code) DO NOTHING — re-running is safe
  and never overwrites existing mappings.
- No modifications to functions, payment_methods, accounts, journal data, or UI.

## Tables modified
- accounting_account_mappings: up to 168 rows inserted (14 × 12 tenants)

## Tables NOT modified
- accounts, journal_entries, journal_lines, payment_methods — zero changes
*/

DO $$
DECLARE
  v_missing_count integer;
  v_missing_detail text;
BEGIN
  -- Pre-check: every tenant must have all 14 required account codes
  WITH required_codes AS (
    SELECT unnest(ARRAY[
      '1200000','1310000','1390000','3110000',
      '4010000','4110000','4456000','4457000',
      '5210000','5710000','6010000','6580000',
      '7010000','7580000'
    ]) AS code
  ),
  missing AS (
    SELECT t.name AS tenant_name, rc.code
    FROM tenants t
    CROSS JOIN required_codes rc
    LEFT JOIN accounts a ON a.tenant_id = t.id AND a.code = rc.code
    WHERE a.id IS NULL
  )
  SELECT count(*), string_agg(tenant_name || ' → ' || code, '; ')
  INTO v_missing_count, v_missing_detail
  FROM missing;

  IF v_missing_count > 0 THEN
    RAISE EXCEPTION 'PC1B ABORT: % missing account(s): %', v_missing_count, v_missing_detail;
  END IF;
END $$;

-- Insert 14 mappings per tenant, skip any that already exist
INSERT INTO accounting_account_mappings (tenant_id, role_code, account_id)
SELECT t.id, m.role_code, a.id
FROM tenants t
CROSS JOIN (VALUES
  ('CARRY_FORWARD',    '1200000'),
  ('RESULT_PROFIT',    '1310000'),
  ('RESULT_LOSS',      '1390000'),
  ('INVENTORY_GOODS',  '3110000'),
  ('SUPPLIER_CONTROL', '4010000'),
  ('CUSTOMER_CONTROL', '4110000'),
  ('VAT_INPUT',        '4456000'),
  ('VAT_OUTPUT',       '4457000'),
  ('BANK_DEFAULT',     '5210000'),
  ('CASH_DEFAULT',     '5710000'),
  ('PURCHASES_GOODS',  '6010000'),
  ('MISC_EXPENSE',     '6580000'),
  ('SALES_GOODS',      '7010000'),
  ('MISC_INCOME',      '7580000')
) AS m(role_code, account_code)
JOIN accounts a ON a.tenant_id = t.id AND a.code = m.account_code
ON CONFLICT (tenant_id, role_code) DO NOTHING;
