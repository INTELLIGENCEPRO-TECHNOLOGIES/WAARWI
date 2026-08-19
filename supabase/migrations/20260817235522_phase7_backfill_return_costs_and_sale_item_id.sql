/*
# Phase 7: Historical Return Cost Correction & sale_item_id Traceability

## Summary
Corrects 36 `sale_return_items` rows whose `purchase_cost` was recorded as 0
when the original `sale_items` row had a real cost. Also adds a `sale_item_id`
foreign key to `sale_return_items` for future traceability, and backfills it
for all 65 existing rows (all have exactly one unambiguous match).

## 1. Audit Log Table (`_backfill_return_costs_log`)
  - Captures every row examined during this correction
  - Records: sale_return_item_id, return_id, sale_id, article_id, sale_item_id,
    old_purchase_cost, new_purchase_cost, tenant_id, site_id, return_date
  - Retained for post-migration verification; to be dropped in a later cleanup migration

## 2. Purchase Cost Backfill (36 rows)
  - Updates `sale_return_items.purchase_cost` from 0 to the matching
    `sale_items.purchase_cost` WHERE the source cost > 0
  - 5 rows where source cost is also 0 are logged but NOT modified
  - Zero ambiguous matches (all 41 zero-cost rows have exactly 1 match)

## 3. New Column: `sale_item_id` on `sale_return_items`
  - `uuid REFERENCES sale_items(id) ON DELETE SET NULL`
  - Nullable, additive — no existing flow is broken
  - Backfilled for all 65 existing rows (all unambiguous)

## 4. Impact
  - COGS retours increases for 4 tenants (total +148,666 FCFA)
  - COGS net decreases by the same amount → marge brute improves
  - No RPC, no front-end code, no other table is modified

## 5. Affected Tenants/Sites/Periods
  - SALOUM ELECTRONIQUE / SE-BATTERIE / Jul 2026: +19,200
  - SALOUM ELECTRONIQUE / SE-BATTERIE / Aug 2026: +52,975
  - SALOUM ELECTRONIQUE / SE-MAMOUTH DRAME / Aug 2026: +2,200
  - Baraka Electro / Magasin Principal / Aug 2026: +60,000
  - SAD Pieces Auto / SAD PIECES AUTO / Jul 2026: +13,500
  - CHEZ DELICE / CHEZ DELICE KAOLACK / Jul 2026: +791

## 6. Security
  - No RLS changes. Audit log table has RLS enabled with no policies
    (admin-only access via service role).
*/

-- ============================================================================
-- 1. Create audit log table
-- ============================================================================
CREATE TABLE IF NOT EXISTS _backfill_return_costs_log (
  id              serial PRIMARY KEY,
  sale_return_item_id uuid NOT NULL,
  return_id       uuid NOT NULL,
  sale_id         uuid,
  article_id      uuid,
  sale_item_id    uuid,
  old_purchase_cost numeric NOT NULL DEFAULT 0,
  new_purchase_cost numeric NOT NULL DEFAULT 0,
  was_corrected   boolean NOT NULL DEFAULT false,
  tenant_id       uuid,
  site_id         uuid,
  return_date     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE _backfill_return_costs_log ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. Populate audit log with all 41 zero-cost lines + their source match
-- ============================================================================
INSERT INTO _backfill_return_costs_log (
  sale_return_item_id, return_id, sale_id, article_id, sale_item_id,
  old_purchase_cost, new_purchase_cost, was_corrected,
  tenant_id, site_id, return_date
)
SELECT
  sri.id,
  sri.return_id,
  sr.sale_id,
  sri.article_id,
  si.id AS sale_item_id,
  COALESCE(sri.purchase_cost, 0),
  COALESCE(si.purchase_cost, 0),
  (COALESCE(si.purchase_cost, 0) > 0),
  sr.tenant_id,
  sr.site_id,
  sr.created_at
FROM sale_return_items sri
JOIN sale_returns sr ON sr.id = sri.return_id
LEFT JOIN sale_items si ON si.sale_id = sr.sale_id AND si.article_id = sri.article_id
WHERE sri.purchase_cost = 0 OR sri.purchase_cost IS NULL;

-- ============================================================================
-- 3. Backfill purchase_cost (only where source > 0)
--    Uses a subquery to get the correct source cost per row
-- ============================================================================
UPDATE sale_return_items
SET purchase_cost = sub.source_cost
FROM (
  SELECT sri.id AS sri_id, si.purchase_cost AS source_cost
  FROM sale_return_items sri
  JOIN sale_returns sr ON sr.id = sri.return_id
  JOIN sale_items si ON si.sale_id = sr.sale_id AND si.article_id = sri.article_id
  WHERE (sri.purchase_cost = 0 OR sri.purchase_cost IS NULL)
    AND si.purchase_cost > 0
) sub
WHERE sale_return_items.id = sub.sri_id;

-- ============================================================================
-- 4. Add sale_item_id column (additive, nullable)
-- ============================================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sale_return_items'
      AND column_name = 'sale_item_id'
  ) THEN
    ALTER TABLE sale_return_items
      ADD COLUMN sale_item_id uuid REFERENCES sale_items(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================================
-- 5. Backfill sale_item_id for ALL existing rows (all 65 are unambiguous)
-- ============================================================================
UPDATE sale_return_items
SET sale_item_id = sub.matched_si_id
FROM (
  SELECT sri.id AS sri_id, si.id AS matched_si_id
  FROM sale_return_items sri
  JOIN sale_returns sr ON sr.id = sri.return_id
  JOIN sale_items si ON si.sale_id = sr.sale_id AND si.article_id = sri.article_id
  WHERE sri.sale_item_id IS NULL
) sub
WHERE sale_return_items.id = sub.sri_id;
