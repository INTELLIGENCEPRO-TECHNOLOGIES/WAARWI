-- Add foreign key on ipm_ventes.sale_id to enable PostgREST joins from sales
ALTER TABLE public.ipm_ventes
  ADD CONSTRAINT ipm_ventes_sale_id_fkey
  FOREIGN KEY (sale_id) REFERENCES public.sales(id) ON DELETE SET NULL;