/*
# Unique open session per site constraint

1. Changes
  - Adds a unique partial index on `cash_sessions` to ensure only one session
    can be in 'open' status per site at any given time.
  - This prevents accidental creation of multiple open sessions for the same
    point of sale (caused by double-clicks, page reloads, etc.).

2. Important Notes
  - The index is partial: it only applies to rows where status = 'open'.
  - Existing orphaned sessions were already closed via a data fix.
*/

CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_sessions_one_open_per_site
ON cash_sessions (site_id)
WHERE status = 'open';
