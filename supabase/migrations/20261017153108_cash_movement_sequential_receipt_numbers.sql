/*
  # Sequential receipt numbers for cash movements

  1. Why
    - Cash receipts were reprinted with a number derived from the row UUID (e.g. ENC-8E91D86C).
    - Each tenant now gets a continuous sequence per receipt type: ENC-00000001, ENC-00000002...

  2. Modified tables
    - `cash_movements`: new column `receipt_number` (text, nullable), filled automatically.

  3. New functions
    - `cash_movement_receipt_prefix(kind)`: income→ENC, customer_prepayment→ACO, expense→DEC,
      customer_withdrawal→RTC, customer_loan→PRT, refund→RMB, vault_deposit→VDP, vault_withdrawal→VRT.
    - `assign_cash_movement_receipt_number()` BEFORE INSERT trigger using `tenant_doc_counters`
      (doc_kind 'cm_' || prefix), 8-digit zero padding.

  4. Backfill
    - Existing movements numbered per tenant/prefix chronologically; counters seeded after them.

  5. Security
    - No RLS change. Trigger function SECURITY DEFINER; EXECUTE revoked from client roles.
    - Unique index on (tenant_id, receipt_number).
*/

ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS receipt_number text;

CREATE OR REPLACE FUNCTION public.cash_movement_receipt_prefix(p_kind text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_kind
    WHEN 'income' THEN 'ENC'
    WHEN 'customer_prepayment' THEN 'ACO'
    WHEN 'expense' THEN 'DEC'
    WHEN 'customer_withdrawal' THEN 'RTC'
    WHEN 'customer_loan' THEN 'PRT'
    WHEN 'refund' THEN 'RMB'
    WHEN 'vault_deposit' THEN 'VDP'
    WHEN 'vault_withdrawal' THEN 'VRT'
    ELSE 'MVT'
  END;
$$;

CREATE OR REPLACE FUNCTION public.assign_cash_movement_receipt_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prefix text;
  v_num bigint;
BEGIN
  IF NEW.receipt_number IS NOT NULL OR NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;
  v_prefix := cash_movement_receipt_prefix(NEW.kind);
  INSERT INTO tenant_doc_counters (tenant_id, doc_kind, last_number)
  VALUES (NEW.tenant_id, 'cm_' || v_prefix, 1)
  ON CONFLICT (tenant_id, doc_kind)
  DO UPDATE SET last_number = tenant_doc_counters.last_number + 1
  RETURNING last_number INTO v_num;
  NEW.receipt_number := v_prefix || '-' || lpad(v_num::text, 8, '0');
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_cash_movement_receipt_number() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_assign_cash_movement_receipt_number ON cash_movements;
CREATE TRIGGER trg_assign_cash_movement_receipt_number
  BEFORE INSERT ON cash_movements
  FOR EACH ROW EXECUTE FUNCTION public.assign_cash_movement_receipt_number();

WITH numbered AS (
  SELECT id, cash_movement_receipt_prefix(kind) AS prefix,
         row_number() OVER (PARTITION BY tenant_id, cash_movement_receipt_prefix(kind) ORDER BY created_at, id) AS n
  FROM cash_movements
  WHERE receipt_number IS NULL AND tenant_id IS NOT NULL
)
UPDATE cash_movements cm
SET receipt_number = numbered.prefix || '-' || lpad(numbered.n::text, 8, '0')
FROM numbered
WHERE cm.id = numbered.id;

INSERT INTO tenant_doc_counters (tenant_id, doc_kind, last_number)
SELECT tenant_id, 'cm_' || split_part(receipt_number, '-', 1), MAX(split_part(receipt_number, '-', 2)::bigint)
FROM cash_movements
WHERE receipt_number ~ '^[A-Z]+-[0-9]{8}$'
GROUP BY tenant_id, split_part(receipt_number, '-', 1)
ON CONFLICT (tenant_id, doc_kind) DO UPDATE
  SET last_number = GREATEST(tenant_doc_counters.last_number, EXCLUDED.last_number);

CREATE UNIQUE INDEX IF NOT EXISTS cash_movements_tenant_receipt_number_key
  ON cash_movements (tenant_id, receipt_number);
