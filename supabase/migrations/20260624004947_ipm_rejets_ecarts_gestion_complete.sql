-- Migration : Gestion complète des Rejets et Écarts IPM
-- Ajouter les colonnes de suivi retour IPM sur ipm_ventes

ALTER TABLE ipm_ventes
  ADD COLUMN IF NOT EXISTS taux_prise_en_charge numeric(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS montant_eligible numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS montant_non_eligible numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS plafond_applique numeric(12,2),
  ADD COLUMN IF NOT EXISTS arrondi_applique text,
  ADD COLUMN IF NOT EXISTS part_beneficiaire_payee numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS montant_ipm_accepte numeric(12,2),
  ADD COLUMN IF NOT EXISTS montant_ipm_paye numeric(12,2),
  ADD COLUMN IF NOT EXISTS montant_rejete numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ecart_ipm numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS motif_rejet text,
  ADD COLUMN IF NOT EXISTS commentaire_retour text,
  ADD COLUMN IF NOT EXISTS date_retour_ipm date,
  ADD COLUMN IF NOT EXISTS reference_reglement text,
  ADD COLUMN IF NOT EXISTS action_regularisation text;

-- Ajouter les colonnes de suivi retour sur ipm_bordereaux
ALTER TABLE ipm_bordereaux
  ADD COLUMN IF NOT EXISTS total_accepte numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_paye numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_rejete numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_ecart numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nb_factures_rejetees integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nb_factures_ecart integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS date_retour date;

-- Ajouter la colonne action_corrective avec plus de précision sur ipm_rejets
ALTER TABLE ipm_rejets
  ADD COLUMN IF NOT EXISTS reference_bordereau text,
  ADD COLUMN IF NOT EXISTS montant_ipm_attendu numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS montant_accepte numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ecart numeric(12,2) DEFAULT 0;

-- Index pour optimiser les requêtes sur les statuts
CREATE INDEX IF NOT EXISTS idx_ipm_ventes_statut ON ipm_ventes(tenant_id, statut);
CREATE INDEX IF NOT EXISTS idx_ipm_ventes_date_retour ON ipm_ventes(tenant_id, date_retour_ipm) WHERE date_retour_ipm IS NOT NULL;
