/*
# RS1 Section G addendum — Fix ADAMA CISSÉ cached balance

After removing ghost sale_payments and balance_adjustments, the cached
customer.balance is stale (0 instead of the computed 540,000).
This updates it to match the formula used by recalculate_customer_balance.
*/

UPDATE customers
SET balance = 540000
WHERE id = 'e1e9fadc-3b3b-4542-bd83-3cb81ce711ef'
  AND tenant_id = '31f9910a-5e94-4dc1-8ab5-c204bbcdb7db';

INSERT INTO balance_reconciliation_log (
  tenant_id, customer_id, previous_balance, computed_balance, delta, note, user_id
) VALUES (
  '31f9910a-5e94-4dc1-8ab5-c204bbcdb7db',
  'e1e9fadc-3b3b-4542-bd83-3cb81ce711ef',
  0, 540000, 540000,
  'RS1 Section G — Correction après suppression des paiements fantômes',
  '65a0b438-957b-4556-a296-00a851716220'
);
