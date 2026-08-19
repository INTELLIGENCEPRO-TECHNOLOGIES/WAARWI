/*
# Phase 9: Drop _backfill_return_costs_log

## Summary
Removes the temporary backfill audit table created in Phase 7.

## Verification performed before drop
  - 41 rows total
  - 36 corrections applied (was_corrected = true)
  - 5 rows not corrected because source sale_item had purchase_cost = 0
  - All 65 sale_return_items now have sale_item_id populated
  - All 5 zero-cost return items confirmed to have zero cost at source (sale_items.purchase_cost = 0)
  - Data is consistent; the log has served its purpose

## Security
  - No RLS changes
  - No policy changes
*/

DROP TABLE IF EXISTS _backfill_return_costs_log;
