/*
# Fix landing_config.contact_hours default

1. Purpose
- Correct the default value of contact_hours (added in the previous migration).
  It was mistakenly set to the string '[]' (a JSON-array literal) instead of an
  empty string. contact_hours is a plain text column and should default to ''.

2. Idempotence
- ALTER COLUMN SET DEFAULT is safe to re-run.

3. Notes
- No data loss: only the column default changes. Existing rows already hold ''
  (or '[]' from the bad default) and are not modified here; the landing page
  treats both as "no hours set" because it checks for a non-empty trimmed
  string.
*/

ALTER TABLE landing_config
  ALTER COLUMN contact_hours SET DEFAULT '';
