/*
# Regles d'acces : boutique publique limitee au magasin source, commandes en ligne par magasin

## Resume
Les lectures publiques (visiteurs et utilisateurs d'autres commerces) ne peuvent plus
atteindre les articles ni le stock d'un autre magasin que celui de la boutique.
Les commandes en ligne ne sont visibles/gerables que par les utilisateurs ayant acces
au magasin de la commande (le proprietaire et les comptes « tous les magasins » gardent tout).

## 1. Policies publiques modifiees (anon + authenticated)
- articles « articles public read active shop » : boutique active, magasin configure,
  article actif du magasin (ou du catalogue partage).
- stock_levels « stock_levels public read shop » : uniquement magasin configure + depots rattaches.
- article_compatibilities « article_compatibilities public read shop » : uniquement les articles visibles.
- shop_settings « shop_settings public read active » : uniquement les boutiques actives.
- online_order_items « online_order_items public aggregate select » : supprimee
  (anon n'avait de toute facon aucun droit SELECT ; les meilleures ventes viennent du serveur).

## 2. Policies authenticated modifiees
- online_orders select/update/delete : meme tenant ET (proprietaire OU site_id dans les
  magasins accessibles de l'utilisateur, via current_user_root_site_ids()).
- online_order_items select/update/delete et online_order_status_history select/insert :
  meme tenant ET commande parente visible.

## 3. Non modifie
- Pages publiques facture / commande fournisseur / suivi de commande (RPC dediees).
- Policies internes des articles et stocks pour les utilisateurs du commerce.
*/

DROP POLICY IF EXISTS "articles public read active shop" ON public.articles;
CREATE POLICY "articles public read active shop" ON public.articles FOR SELECT
  TO anon, authenticated
  USING (
    is_active = true
    AND public.shop_public_catalog_site(tenant_id) IS NOT NULL
    AND (public.shop_public_catalog_shared(tenant_id) OR site_id = public.shop_public_catalog_site(tenant_id))
  );

DROP POLICY IF EXISTS "stock_levels public read shop" ON public.stock_levels;
CREATE POLICY "stock_levels public read shop" ON public.stock_levels FOR SELECT
  TO anon, authenticated
  USING (site_id = ANY (public.shop_public_stock_site_ids(tenant_id)));

DROP POLICY IF EXISTS "article_compatibilities public read shop" ON public.article_compatibilities;
CREATE POLICY "article_compatibilities public read shop" ON public.article_compatibilities FOR SELECT
  TO anon, authenticated
  USING (public.shop_public_article_visible(article_id));

DROP POLICY IF EXISTS "shop_settings public read active" ON public.shop_settings;
CREATE POLICY "shop_settings public read active" ON public.shop_settings FOR SELECT
  TO anon, authenticated
  USING (is_active = true AND public.is_shop_active(tenant_id));

DROP POLICY IF EXISTS "online_order_items public aggregate select" ON public.online_order_items;

DROP POLICY IF EXISTS "online_orders tenant select" ON public.online_orders;
CREATE POLICY "online_orders tenant select" ON public.online_orders FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.is_tenant_owner() OR site_id IN (SELECT public.current_user_root_site_ids()))
  );

DROP POLICY IF EXISTS "online_orders tenant update" ON public.online_orders;
CREATE POLICY "online_orders tenant update" ON public.online_orders FOR UPDATE
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.is_tenant_owner() OR site_id IN (SELECT public.current_user_root_site_ids()))
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.is_tenant_owner() OR site_id IN (SELECT public.current_user_root_site_ids()))
  );

DROP POLICY IF EXISTS "online_orders tenant delete" ON public.online_orders;
CREATE POLICY "online_orders tenant delete" ON public.online_orders FOR DELETE
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.is_tenant_owner() OR site_id IN (SELECT public.current_user_root_site_ids()))
  );

DROP POLICY IF EXISTS "online_order_items tenant select" ON public.online_order_items;
CREATE POLICY "online_order_items tenant select" ON public.online_order_items FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND EXISTS (SELECT 1 FROM public.online_orders o WHERE o.id = online_order_items.order_id)
  );

DROP POLICY IF EXISTS "online_order_items tenant update" ON public.online_order_items;
CREATE POLICY "online_order_items tenant update" ON public.online_order_items FOR UPDATE
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND EXISTS (SELECT 1 FROM public.online_orders o WHERE o.id = online_order_items.order_id)
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND EXISTS (SELECT 1 FROM public.online_orders o WHERE o.id = online_order_items.order_id)
  );

DROP POLICY IF EXISTS "online_order_items tenant delete" ON public.online_order_items;
CREATE POLICY "online_order_items tenant delete" ON public.online_order_items FOR DELETE
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND EXISTS (SELECT 1 FROM public.online_orders o WHERE o.id = online_order_items.order_id)
  );

DROP POLICY IF EXISTS "order_status_history tenant select" ON public.online_order_status_history;
CREATE POLICY "order_status_history tenant select" ON public.online_order_status_history FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND EXISTS (SELECT 1 FROM public.online_orders o WHERE o.id = online_order_status_history.order_id)
  );

DROP POLICY IF EXISTS "order_status_history tenant insert" ON public.online_order_status_history;
CREATE POLICY "order_status_history tenant insert" ON public.online_order_status_history FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND EXISTS (SELECT 1 FROM public.online_orders o WHERE o.id = online_order_status_history.order_id)
  );
