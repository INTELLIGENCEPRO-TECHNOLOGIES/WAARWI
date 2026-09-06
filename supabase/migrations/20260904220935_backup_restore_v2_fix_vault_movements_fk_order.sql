/*
# Fix FK ordering: vault_movements must be deleted after supplier_payments and cash_movements

supplier_payments.vault_movement_id and cash_movements.vault_movement_id both reference
vault_movements with NO ACTION on delete. All three were at restore_order 70.

Delete proceeds in reverse restore_order (highest first), with alphabetical DESC as
tiebreaker within the same level. vault_movements (v) > supplier_payments (s) > cash_movements (c),
so vault_movements was deleted first — causing FK violation.

Fix: move vault_movements to restore_order 65 (lower = deleted later in reverse pass).
This ensures both children (at 70) are deleted before the parent (at 65).
*/

UPDATE _br_table_registry
SET restore_order = 65
WHERE table_name = 'vault_movements' AND schema_name = 'public';
