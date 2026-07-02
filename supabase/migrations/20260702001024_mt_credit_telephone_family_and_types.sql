/*
  Add family field to mt_services to distinguish:
  - 'transfert': services de transfert d'argent (Wave, Orange Money, Free Money, etc.)
  - 'credit_telephone': services de crédit téléphonique (Orange SEDDO, Free Crédit, etc.)
  
  Add new operation types for credit telephone.
  Add 'stock_credit' as valid account type for phone credit stock.
*/

-- 1) Add family column to mt_services
ALTER TABLE public.mt_services ADD COLUMN IF NOT EXISTS family text NOT NULL DEFAULT 'transfert'
  CHECK (family IN ('transfert', 'credit_telephone'));

-- 2) Update mt_operations type constraint to include credit telephone operations
ALTER TABLE public.mt_operations DROP CONSTRAINT IF EXISTS mt_operations_type_check;
ALTER TABLE public.mt_operations ADD CONSTRAINT mt_operations_type_check
  CHECK (type IN (
    'depot','retrait','achat_uv',
    'versement_banque','retrait_banque',
    'transfert_interne','transfert_service',
    'recharge_grossiste','dechargement_grossiste',
    'ajustement','annulation',
    'vente_credit','reappro_credit','ajustement_credit'
  ));

-- 3) Update mt_accounts type to allow 'stock_credit'
ALTER TABLE public.mt_accounts DROP CONSTRAINT IF EXISTS mt_accounts_type_check;
ALTER TABLE public.mt_accounts ADD CONSTRAINT mt_accounts_type_check
  CHECK (type IN ('cash', 'uv', 'bank', 'ecarts', 'commissions', 'stock_credit'));
