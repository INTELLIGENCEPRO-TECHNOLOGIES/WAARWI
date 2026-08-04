-- Add 'customer_loan' to the allowed values in cash_movements.kind CHECK constraint
ALTER TABLE cash_movements DROP CONSTRAINT cash_movements_kind_check;
ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_kind_check
  CHECK (kind = ANY (ARRAY['expense','income','customer_prepayment','customer_withdrawal','customer_loan']));
