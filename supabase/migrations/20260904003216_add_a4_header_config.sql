-- Add a4_header_config column to tenants and sites (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'a4_header_config') THEN
    ALTER TABLE tenants ADD COLUMN a4_header_config jsonb;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sites' AND column_name = 'a4_header_config') THEN
    ALTER TABLE sites ADD COLUMN a4_header_config jsonb;
  END IF;
END $$;
