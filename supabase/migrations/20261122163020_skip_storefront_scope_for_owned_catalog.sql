-- The private authenticated SELECT policy already allows each row belonging to
-- the current tenant. Skip the storefront scope for those rows only.
SET LOCAL lock_timeout = '3s';

ALTER POLICY "articles public read active shop" ON public.articles
  USING (
    CASE
      WHEN (SELECT CURRENT_USER) = 'authenticated'
        AND tenant_id = (SELECT public.current_tenant_id())
      THEN false
      ELSE is_active = true AND public.shop_article_in_scope(
        site_id,
        public.shop_public_catalog_site(tenant_id),
        public.shop_public_catalog_shared(tenant_id),
        public.shop_public_stock_site_ids(tenant_id)
      )
    END
  );

ALTER POLICY "stock_levels public read shop" ON public.stock_levels
  USING (
    CASE
      WHEN (SELECT CURRENT_USER) = 'authenticated'
        AND tenant_id = (SELECT public.current_tenant_id())
      THEN false
      ELSE site_id = ANY (public.shop_public_stock_site_ids(tenant_id))
    END
  );
