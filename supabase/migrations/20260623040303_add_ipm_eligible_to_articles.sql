-- Add ipm_eligible flag to articles for IPM eligibility filtering
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS ipm_eligible boolean NOT NULL DEFAULT true;

-- Add index for quick filtering
CREATE INDEX IF NOT EXISTS idx_articles_ipm_eligible ON public.articles(tenant_id, ipm_eligible) WHERE ipm_eligible = false;