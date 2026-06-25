-- Add document reference fields to ipm_ventes for tracking required documents
ALTER TABLE public.ipm_ventes ADD COLUMN IF NOT EXISTS numero_ordonnance text;
ALTER TABLE public.ipm_ventes ADD COLUMN IF NOT EXISTS medecin_prescripteur text;
ALTER TABLE public.ipm_ventes ADD COLUMN IF NOT EXISTS numero_bon_pec text;