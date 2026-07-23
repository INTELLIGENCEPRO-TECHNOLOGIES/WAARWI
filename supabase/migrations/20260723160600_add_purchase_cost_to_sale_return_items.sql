/*
# Add purchase_cost to sale_return_items

1. Modified Tables
   - `sale_return_items`: added `purchase_cost` column (numeric, default 0)
     - Stores the unit purchase cost of the article at the time of return
     - Enables accurate margin calculation in reports without extra joins

2. Important Notes
   - Existing rows get purchase_cost = 0 (will be backfilled from sale_items where possible)
   - Future returns will populate this field from the original sale_items record
*/

ALTER TABLE public.sale_return_items
  ADD COLUMN IF NOT EXISTS purchase_cost numeric NOT NULL DEFAULT 0;
