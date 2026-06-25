-- Add facture_ipm_id to ipm_bordereaux to track which facture each bordereau belongs to
ALTER TABLE ipm_bordereaux ADD COLUMN IF NOT EXISTS facture_ipm_id uuid REFERENCES ipm_factures(id) ON DELETE SET NULL;

-- Create index for efficient lookup
CREATE INDEX IF NOT EXISTS idx_ipm_bordereaux_facture_ipm_id ON ipm_bordereaux(facture_ipm_id) WHERE facture_ipm_id IS NOT NULL;