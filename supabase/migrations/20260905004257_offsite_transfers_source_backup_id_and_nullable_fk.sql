/*
# Offsite transfers: add source_backup_id, make backup_id nullable

1. Changes to `_br_offsite_transfers`
   - Add `source_backup_id` (uuid, NOT NULL) — immutable reference to the original backup
   - Backfill from existing `backup_id`
   - Add unique constraint on `source_backup_id`
   - Drop old unique on `backup_id`, make it nullable, change FK to ON DELETE SET NULL
   - This lets local retention delete backups without losing offsite transfer history

2. Important notes
   - After retrieve, the new local backup gets linked via `backup_id`
   - `source_backup_id` never changes — it's the permanent reference
*/

-- 1. Add source_backup_id column (nullable first for backfill)
ALTER TABLE _br_offsite_transfers
  ADD COLUMN IF NOT EXISTS source_backup_id uuid;

-- 2. Backfill from backup_id
UPDATE _br_offsite_transfers
  SET source_backup_id = backup_id
  WHERE source_backup_id IS NULL AND backup_id IS NOT NULL;

-- 3. Make NOT NULL
DO $$ BEGIN
  ALTER TABLE _br_offsite_transfers ALTER COLUMN source_backup_id SET NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

-- 4. Add unique on source_backup_id
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = '_br_offsite_transfers' AND indexdef LIKE '%source_backup_id%'
  ) THEN
    ALTER TABLE _br_offsite_transfers ADD CONSTRAINT uq_offsite_source_backup_id UNIQUE (source_backup_id);
  END IF;
END $$;

-- 5. Drop old unique on backup_id
DO $$ BEGIN
  ALTER TABLE _br_offsite_transfers DROP CONSTRAINT IF EXISTS _br_offsite_transfers_backup_id_key;
EXCEPTION WHEN others THEN NULL;
END $$;

-- 6. Drop old FK on backup_id
DO $$ BEGIN
  ALTER TABLE _br_offsite_transfers DROP CONSTRAINT IF EXISTS _br_offsite_transfers_backup_id_fkey;
EXCEPTION WHEN others THEN NULL;
END $$;

-- 7. Make backup_id nullable
ALTER TABLE _br_offsite_transfers ALTER COLUMN backup_id DROP NOT NULL;

-- 8. Re-add FK with ON DELETE SET NULL
DO $$ BEGIN
  ALTER TABLE _br_offsite_transfers
    ADD CONSTRAINT _br_offsite_transfers_backup_id_fkey
    FOREIGN KEY (backup_id) REFERENCES tenant_backups(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
