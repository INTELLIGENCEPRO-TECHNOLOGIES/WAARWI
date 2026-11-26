-- RECETTE UNIQUEMENT : rétablissement des politiques commerciales du schéma de production.
-- Ne jamais intégrer ce script aux migrations de production. Aucun transfert de données.
SET LOCAL search_path TO public, extensions, pg_catalog;
CREATE OR REPLACE FUNCTION public.is_shop_active(p_tenant_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT EXISTS (
SELECT 1 FROM tenants t
WHERE t.id = p_tenant_id
AND t.public_slug IS NOT NULL
AND COALESCE(t.is_active, true)
AND COALESCE(t.approval_status, 'approved') = 'approved'
AND (
t.enabled_modules IS NULL
OR jsonb_typeof(t.enabled_modules) <> 'array'
OR t.enabled_modules ? 'online_orders'
)
);
$function$;
REVOKE ALL ON FUNCTION public.is_shop_active(p_tenant_id uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.is_shop_active(p_tenant_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_shop_active(p_tenant_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_shop_active(p_tenant_id uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.shop_scope(p_tenant_id uuid, p_require_public boolean)
 RETURNS TABLE(scope_site_id uuid, scope_shared boolean, scope_stock_site_ids uuid[], scope_shop_active boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
SELECT ss.site_id,
NOT coalesce(t.settings -> 'shared_articles' = 'false'::jsonb, false),
ARRAY(
SELECT ss.site_id
UNION
SELECT d.id FROM sites d
WHERE d.tenant_id = ss.tenant_id AND d.is_warehouse AND d.is_active AND d.parent_site_id = ss.site_id
),
ss.is_active
FROM shop_settings ss
JOIN tenants t ON t.id = ss.tenant_id
JOIN sites s ON s.id = ss.site_id AND s.tenant_id = ss.tenant_id AND s.is_active AND NOT s.is_warehouse
WHERE ss.tenant_id = p_tenant_id
AND public.is_shop_active(p_tenant_id)
AND (ss.is_active OR NOT p_require_public);
$function$;
REVOKE ALL ON FUNCTION public.shop_scope(p_tenant_id uuid, p_require_public boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.shop_scope(p_tenant_id uuid, p_require_public boolean) TO service_role;
CREATE OR REPLACE FUNCTION public.is_expense_category_available_for_site(p_category_id uuid, p_site_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_tenant_id uuid;
v_root_site_id uuid;
v_cat_site_id uuid;
v_cat_active boolean;
v_override boolean;
BEGIN
v_tenant_id := current_tenant_id();
IF v_tenant_id IS NULL THEN RETURN false; END IF;

v_root_site_id := resolve_root_site_id(p_site_id);

SELECT ec.site_id, ec.is_active
INTO v_cat_site_id, v_cat_active
FROM expense_categories ec
WHERE ec.id = p_category_id AND ec.tenant_id = v_tenant_id;

IF NOT FOUND THEN RETURN false; END IF;

IF v_cat_site_id IS NULL THEN
-- Global: check site override
SELECT ecss.is_enabled INTO v_override
FROM expense_category_site_settings ecss
WHERE ecss.expense_category_id = p_category_id
AND ecss.site_id = v_root_site_id
AND ecss.tenant_id = v_tenant_id;
RETURN COALESCE(v_override, v_cat_active);
ELSIF v_cat_site_id = v_root_site_id THEN
RETURN v_cat_active;
ELSE
RETURN false;
END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.is_expense_category_available_for_site(p_category_id uuid, p_site_id uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.is_expense_category_available_for_site(p_category_id uuid, p_site_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_expense_category_available_for_site(p_category_id uuid, p_site_id uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.shop_article_in_scope(p_article_site uuid, p_scope_site uuid, p_shared boolean, p_stock_sites uuid[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
SELECT p_scope_site IS NOT NULL AND (
p_article_site = p_scope_site
OR (coalesce(p_shared, false) AND (p_article_site IS NULL OR p_article_site = ANY (coalesce(p_stock_sites, '{}'::uuid[]))))
);
$function$;
REVOKE ALL ON FUNCTION public.shop_article_in_scope(p_article_site uuid, p_scope_site uuid, p_shared boolean, p_stock_sites uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.shop_article_in_scope(p_article_site uuid, p_scope_site uuid, p_shared boolean, p_stock_sites uuid[]) TO anon;
GRANT EXECUTE ON FUNCTION public.shop_article_in_scope(p_article_site uuid, p_scope_site uuid, p_shared boolean, p_stock_sites uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shop_article_in_scope(p_article_site uuid, p_scope_site uuid, p_shared boolean, p_stock_sites uuid[]) TO service_role;
CREATE OR REPLACE FUNCTION public.shop_public_catalog_shared(p_tenant_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
SELECT coalesce((SELECT scope_shared FROM public.shop_scope(p_tenant_id, true)), false);
$function$;
REVOKE ALL ON FUNCTION public.shop_public_catalog_shared(p_tenant_id uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.shop_public_catalog_shared(p_tenant_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.shop_public_catalog_shared(p_tenant_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shop_public_catalog_shared(p_tenant_id uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.shop_public_catalog_site(p_tenant_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
SELECT scope_site_id FROM public.shop_scope(p_tenant_id, true);
$function$;
REVOKE ALL ON FUNCTION public.shop_public_catalog_site(p_tenant_id uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.shop_public_catalog_site(p_tenant_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.shop_public_catalog_site(p_tenant_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shop_public_catalog_site(p_tenant_id uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.shop_public_stock_site_ids(p_tenant_id uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
SELECT coalesce((SELECT scope_stock_site_ids FROM public.shop_scope(p_tenant_id, true)), '{}'::uuid[]);
$function$;
REVOKE ALL ON FUNCTION public.shop_public_stock_site_ids(p_tenant_id uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.shop_public_stock_site_ids(p_tenant_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.shop_public_stock_site_ids(p_tenant_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shop_public_stock_site_ids(p_tenant_id uuid) TO service_role;
-- Droits EXECUTE observés sur les fonctions existantes utilisées par les politiques publiques.
GRANT EXECUTE ON FUNCTION public.current_tenant_id(),public.current_user_root_site_ids(),public.is_super_admin(),public.is_tenant_owner(),public.resolve_root_site_id(uuid) TO anon;
CREATE POLICY "art delete" ON public.articles AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "art insert" ON public.articles AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "art select" ON public.articles AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)));
CREATE POLICY "art update" ON public.articles AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "articles public read active shop" ON public.articles AS PERMISSIVE FOR SELECT TO anon, authenticated USING (
CASE
    WHEN ((( SELECT CURRENT_USER AS "current_user") = 'authenticated'::name) AND (tenant_id = ( SELECT current_tenant_id() AS current_tenant_id))) THEN false
    ELSE ((is_active = true) AND shop_article_in_scope(site_id, shop_public_catalog_site(tenant_id), shop_public_catalog_shared(tenant_id), shop_public_stock_site_ids(tenant_id)))
END);
CREATE POLICY "cash_movements tenant delete" ON public.cash_movements AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "cash_movements tenant insert" ON public.cash_movements AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((tenant_id = current_tenant_id()) AND ((kind <> 'expense'::text) OR (expense_category_id IS NULL) OR is_expense_category_available_for_site(expense_category_id, site_id))));
CREATE POLICY "cash_movements tenant select" ON public.cash_movements AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "cash_movements tenant update" ON public.cash_movements AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "mc1d delete" ON public.cash_movements AS RESTRICTIVE FOR DELETE TO authenticated USING ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs
      WHERE (cs.user_id = auth.uid())))
    ELSE ((user_id = auth.uid()) OR (site_id = ANY (( SELECT _cs_supervised_site_ids() AS _cs_supervised_site_ids)::uuid[])))
END));
CREATE POLICY "mc1d insert" ON public.cash_movements AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs
      WHERE (cs.user_id = auth.uid())))
    ELSE ((user_id = auth.uid()) OR (site_id = ANY (( SELECT _cs_supervised_site_ids() AS _cs_supervised_site_ids)::uuid[])))
END));
CREATE POLICY "mc1d select" ON public.cash_movements AS RESTRICTIVE FOR SELECT TO authenticated USING ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs))
    ELSE ((user_id = auth.uid()) OR (site_id = ANY (( SELECT _cs_supervised_site_ids() AS _cs_supervised_site_ids)::uuid[])))
END));
CREATE POLICY "mc1d update" ON public.cash_movements AS RESTRICTIVE FOR UPDATE TO authenticated USING ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs
      WHERE (cs.user_id = auth.uid())))
    ELSE ((user_id = auth.uid()) OR (site_id = ANY (( SELECT _cs_supervised_site_ids() AS _cs_supervised_site_ids)::uuid[])))
END)) WITH CHECK ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs
      WHERE (cs.user_id = auth.uid())))
    ELSE ((user_id = auth.uid()) OR (site_id = ANY (( SELECT _cs_supervised_site_ids() AS _cs_supervised_site_ids)::uuid[])))
END));
CREATE POLICY "cs insert" ON public.cash_sessions AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "cs select" ON public.cash_sessions AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "cs update" ON public.cash_sessions AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "mc1d insert" ON public.cash_sessions AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT (NOT _cs_multi_current())));
CREATE POLICY "mc1d select" ON public.cash_sessions AS RESTRICTIVE FOR SELECT TO authenticated USING ((( SELECT (NOT _cs_multi_current())) OR (user_id = auth.uid()) OR (site_id = ANY (( SELECT _cs_supervised_site_ids() AS _cs_supervised_site_ids)::uuid[]))));
CREATE POLICY "mc1d update" ON public.cash_sessions AS RESTRICTIVE FOR UPDATE TO authenticated USING ((( SELECT (NOT _cs_multi_current())) OR (user_id = auth.uid()))) WITH CHECK ((( SELECT (NOT _cs_multi_current())) OR (user_id = auth.uid())));
CREATE POLICY "cust delete" ON public.customers AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "cust insert" ON public.customers AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "cust select" ON public.customers AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "cust update" ON public.customers AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY delete_own_ipm_beneficiaires ON public.ipm_beneficiaires AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY insert_own_ipm_beneficiaires ON public.ipm_beneficiaires AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY select_own_ipm_beneficiaires ON public.ipm_beneficiaires AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY update_own_ipm_beneficiaires ON public.ipm_beneficiaires AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid())))) WITH CHECK ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY delete_own_ipm_bordereaux ON public.ipm_bordereaux AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY insert_own_ipm_bordereaux ON public.ipm_bordereaux AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY select_own_ipm_bordereaux ON public.ipm_bordereaux AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY update_own_ipm_bordereaux ON public.ipm_bordereaux AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid())))) WITH CHECK ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY delete_own_ipm_conventions ON public.ipm_conventions AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY insert_own_ipm_conventions ON public.ipm_conventions AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY select_own_ipm_conventions ON public.ipm_conventions AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY update_own_ipm_conventions ON public.ipm_conventions AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid())))) WITH CHECK ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY delete_own_ipm_factures ON public.ipm_factures AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY insert_own_ipm_factures ON public.ipm_factures AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY select_own_ipm_factures ON public.ipm_factures AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY update_own_ipm_factures ON public.ipm_factures AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid())))) WITH CHECK ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY delete_own_ipm_organismes ON public.ipm_organismes AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY insert_own_ipm_organismes ON public.ipm_organismes AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY select_own_ipm_organismes ON public.ipm_organismes AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY update_own_ipm_organismes ON public.ipm_organismes AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid())))) WITH CHECK ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY delete_own_ipm_reglements ON public.ipm_reglements AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY insert_own_ipm_reglements ON public.ipm_reglements AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY select_own_ipm_reglements ON public.ipm_reglements AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY update_own_ipm_reglements ON public.ipm_reglements AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid())))) WITH CHECK ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY delete_own_ipm_rejets ON public.ipm_rejets AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY insert_own_ipm_rejets ON public.ipm_rejets AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY select_own_ipm_rejets ON public.ipm_rejets AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY update_own_ipm_rejets ON public.ipm_rejets AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid())))) WITH CHECK ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY delete_own_ipm_ventes ON public.ipm_ventes AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY insert_own_ipm_ventes ON public.ipm_ventes AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY select_own_ipm_ventes ON public.ipm_ventes AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY update_own_ipm_ventes ON public.ipm_ventes AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid())))) WITH CHECK ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY "Admins manage tenant profiles" ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated USING (((tenant_id = current_tenant_id()) AND (EXISTS ( SELECT 1
   FROM profiles p2
  WHERE ((p2.id = auth.uid()) AND (p2.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))))))) WITH CHECK (((tenant_id = current_tenant_id()) AND (EXISTS ( SELECT 1
   FROM profiles p2
  WHERE ((p2.id = auth.uid()) AND (p2.role = ANY (ARRAY['admin'::text, 'super_admin'::text])))))));
CREATE POLICY "Super admin views all profiles" ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated USING (is_super_admin());
CREATE POLICY "Users insert own profile" ON public.profiles AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((id = auth.uid()));
CREATE POLICY "Users update own profile" ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated USING ((id = auth.uid())) WITH CHECK ((id = auth.uid()));
CREATE POLICY "Users view own profile" ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated USING (((id = auth.uid()) OR (tenant_id = current_tenant_id())));
CREATE POLICY "Admins can delete role permissions" ON public.role_permissions AS PERMISSIVE FOR DELETE TO authenticated USING (((tenant_id = ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))) AND (( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = auth.uid())) = ANY (ARRAY['admin'::text, 'super_admin'::text]))));
CREATE POLICY "Admins can insert role permissions" ON public.role_permissions AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((tenant_id = ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))) AND (( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = auth.uid())) = ANY (ARRAY['admin'::text, 'super_admin'::text]))));
CREATE POLICY "Admins can update role permissions" ON public.role_permissions AS PERMISSIVE FOR UPDATE TO authenticated USING (((tenant_id = ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))) AND (( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = auth.uid())) = ANY (ARRAY['admin'::text, 'super_admin'::text])))) WITH CHECK (((tenant_id = ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))) AND (( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = auth.uid())) = ANY (ARRAY['admin'::text, 'super_admin'::text]))));
CREATE POLICY "Tenant members can read role permissions" ON public.role_permissions AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY "mc1d insert" ON public.sale_items AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((( SELECT (NOT _cs_multi_current())) OR (EXISTS ( SELECT 1
   FROM sales s
  WHERE (s.id = sale_items.sale_id)))));
CREATE POLICY "mc1d select" ON public.sale_items AS RESTRICTIVE FOR SELECT TO authenticated USING ((( SELECT (NOT _cs_multi_current())) OR (EXISTS ( SELECT 1
   FROM sales s
  WHERE (s.id = sale_items.sale_id)))));
CREATE POLICY "si insert" ON public.sale_items AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "si select" ON public.sale_items AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)));
CREATE POLICY sld_delete_own ON public.sale_lot_deductions AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY sld_insert_own ON public.sale_lot_deductions AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY sld_select_own ON public.sale_lot_deductions AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY sld_update_own ON public.sale_lot_deductions AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "mc1d insert" ON public.sale_payments AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs
      WHERE (cs.user_id = auth.uid())))
    ELSE (EXISTS ( SELECT 1
       FROM sales s
      WHERE (s.id = sale_payments.sale_id)))
END));
CREATE POLICY "mc1d select" ON public.sale_payments AS RESTRICTIVE FOR SELECT TO authenticated USING ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs))
    ELSE (EXISTS ( SELECT 1
       FROM sales s
      WHERE (s.id = sale_payments.sale_id)))
END));
CREATE POLICY "sp insert" ON public.sale_payments AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "sp select" ON public.sale_payments AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "mc1d insert" ON public.sale_return_items AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((( SELECT (NOT _cs_multi_current())) OR (EXISTS ( SELECT 1
   FROM sale_returns sr
  WHERE (sr.id = sale_return_items.return_id)))));
CREATE POLICY "mc1d select" ON public.sale_return_items AS RESTRICTIVE FOR SELECT TO authenticated USING ((( SELECT (NOT _cs_multi_current())) OR (EXISTS ( SELECT 1
   FROM sale_returns sr
  WHERE (sr.id = sale_return_items.return_id)))));
CREATE POLICY "sri insert" ON public.sale_return_items AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "sri select" ON public.sale_return_items AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "mc1d insert" ON public.sale_returns AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((( SELECT (NOT _cs_multi_current())) OR ((cash_session_id IS NOT NULL) AND (cash_session_id IN ( SELECT cs.id
   FROM cash_sessions cs))) OR ((refund_cash_session_id IS NOT NULL) AND (refund_cash_session_id IN ( SELECT cs.id
   FROM cash_sessions cs))) OR ((cash_session_id IS NULL) AND (refund_cash_session_id IS NULL) AND ((user_id = auth.uid()) OR (site_id = ANY (( SELECT _cs_supervised_site_ids() AS _cs_supervised_site_ids)::uuid[]))))));
CREATE POLICY "mc1d select" ON public.sale_returns AS RESTRICTIVE FOR SELECT TO authenticated USING ((( SELECT (NOT _cs_multi_current())) OR ((cash_session_id IS NOT NULL) AND (cash_session_id IN ( SELECT cs.id
   FROM cash_sessions cs))) OR ((refund_cash_session_id IS NOT NULL) AND (refund_cash_session_id IN ( SELECT cs.id
   FROM cash_sessions cs))) OR ((cash_session_id IS NULL) AND (refund_cash_session_id IS NULL) AND ((user_id = auth.uid()) OR (site_id = ANY (( SELECT _cs_supervised_site_ids() AS _cs_supervised_site_ids)::uuid[]))))));
CREATE POLICY "mc1d update" ON public.sale_returns AS RESTRICTIVE FOR UPDATE TO authenticated USING ((( SELECT (NOT _cs_multi_current())) OR ((cash_session_id IS NOT NULL) AND (cash_session_id IN ( SELECT cs.id
   FROM cash_sessions cs))) OR ((refund_cash_session_id IS NOT NULL) AND (refund_cash_session_id IN ( SELECT cs.id
   FROM cash_sessions cs))) OR ((cash_session_id IS NULL) AND (refund_cash_session_id IS NULL) AND ((user_id = auth.uid()) OR (site_id = ANY (( SELECT _cs_supervised_site_ids() AS _cs_supervised_site_ids)::uuid[])))))) WITH CHECK ((( SELECT (NOT _cs_multi_current())) OR ((cash_session_id IS NOT NULL) AND (cash_session_id IN ( SELECT cs.id
   FROM cash_sessions cs))) OR ((refund_cash_session_id IS NOT NULL) AND (refund_cash_session_id IN ( SELECT cs.id
   FROM cash_sessions cs))) OR ((cash_session_id IS NULL) AND (refund_cash_session_id IS NULL) AND ((user_id = auth.uid()) OR (site_id = ANY (( SELECT _cs_supervised_site_ids() AS _cs_supervised_site_ids)::uuid[]))))));
CREATE POLICY "sr insert" ON public.sale_returns AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "sr select" ON public.sale_returns AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "sr update" ON public.sale_returns AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "mc1d insert" ON public.sales AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs))
    ELSE ((user_id = auth.uid()) OR (site_id = ANY (( SELECT _cs_supervised_site_ids() AS _cs_supervised_site_ids)::uuid[])))
END));
CREATE POLICY "mc1d select" ON public.sales AS RESTRICTIVE FOR SELECT TO authenticated USING ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs))
    ELSE ((user_id = auth.uid()) OR (site_id = ANY (( SELECT _cs_supervised_site_ids() AS _cs_supervised_site_ids)::uuid[])))
END));
CREATE POLICY "mc1d update" ON public.sales AS RESTRICTIVE FOR UPDATE TO authenticated USING ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs))
    ELSE ((user_id = auth.uid()) OR (site_id = ANY (( SELECT _cs_supervised_site_ids() AS _cs_supervised_site_ids)::uuid[])))
END)) WITH CHECK ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs))
    ELSE ((user_id = auth.uid()) OR (site_id = ANY (( SELECT _cs_supervised_site_ids() AS _cs_supervised_site_ids)::uuid[])))
END));
CREATE POLICY "sales insert" ON public.sales AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "sales select" ON public.sales AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)));
CREATE POLICY "sales update" ON public.sales AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY sites_delete_scoped ON public.sites AS PERMISSIVE FOR DELETE TO authenticated USING (((tenant_id = current_tenant_id()) AND is_tenant_owner() AND (is_warehouse = false)));
CREATE POLICY sites_insert_scoped ON public.sites AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((tenant_id = current_tenant_id()) AND (((is_warehouse = true) AND (parent_site_id IN ( SELECT current_user_root_site_ids() AS current_user_root_site_ids))) OR ((is_warehouse = false) AND is_tenant_owner()))));
CREATE POLICY sites_select_scoped ON public.sites AS PERMISSIVE FOR SELECT TO authenticated USING (((tenant_id = current_tenant_id()) AND (is_tenant_owner() OR (((is_warehouse = false) AND (id IN ( SELECT current_user_root_site_ids() AS current_user_root_site_ids))) OR ((is_warehouse = true) AND (parent_site_id IN ( SELECT current_user_root_site_ids() AS current_user_root_site_ids)))))));
CREATE POLICY sites_update_scoped ON public.sites AS PERMISSIVE FOR UPDATE TO authenticated USING (((tenant_id = current_tenant_id()) AND (is_tenant_owner() OR (id IN ( SELECT current_user_root_site_ids() AS current_user_root_site_ids)) OR (parent_site_id IN ( SELECT current_user_root_site_ids() AS current_user_root_site_ids))))) WITH CHECK (((tenant_id = current_tenant_id()) AND (is_tenant_owner() OR (id IN ( SELECT current_user_root_site_ids() AS current_user_root_site_ids)) OR (parent_site_id IN ( SELECT current_user_root_site_ids() AS current_user_root_site_ids)))));
CREATE POLICY "stk delete" ON public.stock_levels AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "stk insert" ON public.stock_levels AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "stk select" ON public.stock_levels AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)));
CREATE POLICY "stk update" ON public.stock_levels AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "stock_levels public read shop" ON public.stock_levels AS PERMISSIVE FOR SELECT TO anon, authenticated USING (
CASE
    WHEN ((( SELECT CURRENT_USER AS "current_user") = 'authenticated'::name) AND (tenant_id = ( SELECT current_tenant_id() AS current_tenant_id))) THEN false
    ELSE (site_id = ANY (shop_public_stock_site_ids(tenant_id)))
END);
CREATE POLICY "Tenant members can delete their stock lots" ON public.stock_lots AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)));
CREATE POLICY "Tenant members can insert stock lots" ON public.stock_lots AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)));
CREATE POLICY "Tenant members can update their stock lots" ON public.stock_lots AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id))) WITH CHECK ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)));
CREATE POLICY "Tenant members can view their stock lots" ON public.stock_lots AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)));
CREATE POLICY "stmov delete" ON public.stock_movements AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "stmov insert" ON public.stock_movements AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "stmov select" ON public.stock_movements AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "stmov update" ON public.stock_movements AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "Members view their tenant" ON public.tenants AS PERMISSIVE FOR SELECT TO authenticated USING ((id = current_tenant_id()));
CREATE POLICY "Super admin views all tenants" ON public.tenants AS PERMISSIVE FOR SELECT TO authenticated USING (is_super_admin());
CREATE POLICY "tenants public read shop slug" ON public.tenants AS PERMISSIVE FOR SELECT TO anon, authenticated USING (((public_slug IS NOT NULL) AND COALESCE(is_active, true) AND (COALESCE(approval_status, 'approved'::text) = 'approved'::text) AND ((enabled_modules IS NULL) OR (jsonb_typeof(enabled_modules) <> 'array'::text) OR (enabled_modules ? 'online_orders'::text))));
CREATE POLICY tenants_update_owner_only ON public.tenants AS PERMISSIVE FOR UPDATE TO authenticated USING (((id = current_tenant_id()) AND (is_tenant_owner() OR (COALESCE(((current_setting('request.jwt.claims'::text, true))::json ->> 'role'::text), ''::text) = 'service_role'::text)))) WITH CHECK (((id = current_tenant_id()) AND (is_tenant_owner() OR (COALESCE(((current_setting('request.jwt.claims'::text, true))::json ->> 'role'::text), ''::text) = 'service_role'::text))));
GRANT DELETE ON TABLE public."articles" TO anon;
GRANT INSERT ON TABLE public."articles" TO anon;
GRANT SELECT ON TABLE public."articles" TO anon;
GRANT UPDATE ON TABLE public."articles" TO anon;
GRANT DELETE ON TABLE public."articles" TO authenticated;
GRANT INSERT ON TABLE public."articles" TO authenticated;
GRANT SELECT ON TABLE public."articles" TO authenticated;
GRANT UPDATE ON TABLE public."articles" TO authenticated;
GRANT DELETE ON TABLE public."cash_movements" TO authenticated;
GRANT INSERT ON TABLE public."cash_movements" TO authenticated;
GRANT SELECT ON TABLE public."cash_movements" TO authenticated;
GRANT UPDATE ON TABLE public."cash_movements" TO authenticated;
GRANT DELETE ON TABLE public."cash_sessions" TO authenticated;
GRANT INSERT ON TABLE public."cash_sessions" TO authenticated;
GRANT SELECT ON TABLE public."cash_sessions" TO authenticated;
GRANT UPDATE ON TABLE public."cash_sessions" TO authenticated;
GRANT DELETE ON TABLE public."customers" TO authenticated;
GRANT INSERT ON TABLE public."customers" TO authenticated;
GRANT SELECT ON TABLE public."customers" TO authenticated;
GRANT UPDATE ON TABLE public."customers" TO authenticated;
GRANT DELETE ON TABLE public."ipm_beneficiaires" TO anon;
GRANT INSERT ON TABLE public."ipm_beneficiaires" TO anon;
GRANT SELECT ON TABLE public."ipm_beneficiaires" TO anon;
GRANT UPDATE ON TABLE public."ipm_beneficiaires" TO anon;
GRANT DELETE ON TABLE public."ipm_beneficiaires" TO authenticated;
GRANT INSERT ON TABLE public."ipm_beneficiaires" TO authenticated;
GRANT SELECT ON TABLE public."ipm_beneficiaires" TO authenticated;
GRANT UPDATE ON TABLE public."ipm_beneficiaires" TO authenticated;
GRANT DELETE ON TABLE public."ipm_bordereaux" TO anon;
GRANT INSERT ON TABLE public."ipm_bordereaux" TO anon;
GRANT SELECT ON TABLE public."ipm_bordereaux" TO anon;
GRANT UPDATE ON TABLE public."ipm_bordereaux" TO anon;
GRANT DELETE ON TABLE public."ipm_bordereaux" TO authenticated;
GRANT INSERT ON TABLE public."ipm_bordereaux" TO authenticated;
GRANT SELECT ON TABLE public."ipm_bordereaux" TO authenticated;
GRANT UPDATE ON TABLE public."ipm_bordereaux" TO authenticated;
GRANT DELETE ON TABLE public."ipm_conventions" TO anon;
GRANT INSERT ON TABLE public."ipm_conventions" TO anon;
GRANT SELECT ON TABLE public."ipm_conventions" TO anon;
GRANT UPDATE ON TABLE public."ipm_conventions" TO anon;
GRANT DELETE ON TABLE public."ipm_conventions" TO authenticated;
GRANT INSERT ON TABLE public."ipm_conventions" TO authenticated;
GRANT SELECT ON TABLE public."ipm_conventions" TO authenticated;
GRANT UPDATE ON TABLE public."ipm_conventions" TO authenticated;
GRANT DELETE ON TABLE public."ipm_factures" TO anon;
GRANT INSERT ON TABLE public."ipm_factures" TO anon;
GRANT SELECT ON TABLE public."ipm_factures" TO anon;
GRANT UPDATE ON TABLE public."ipm_factures" TO anon;
GRANT DELETE ON TABLE public."ipm_factures" TO authenticated;
GRANT INSERT ON TABLE public."ipm_factures" TO authenticated;
GRANT SELECT ON TABLE public."ipm_factures" TO authenticated;
GRANT UPDATE ON TABLE public."ipm_factures" TO authenticated;
GRANT DELETE ON TABLE public."ipm_organismes" TO anon;
GRANT INSERT ON TABLE public."ipm_organismes" TO anon;
GRANT SELECT ON TABLE public."ipm_organismes" TO anon;
GRANT UPDATE ON TABLE public."ipm_organismes" TO anon;
GRANT DELETE ON TABLE public."ipm_organismes" TO authenticated;
GRANT INSERT ON TABLE public."ipm_organismes" TO authenticated;
GRANT SELECT ON TABLE public."ipm_organismes" TO authenticated;
GRANT UPDATE ON TABLE public."ipm_organismes" TO authenticated;
GRANT DELETE ON TABLE public."ipm_reglements" TO anon;
GRANT INSERT ON TABLE public."ipm_reglements" TO anon;
GRANT SELECT ON TABLE public."ipm_reglements" TO anon;
GRANT UPDATE ON TABLE public."ipm_reglements" TO anon;
GRANT DELETE ON TABLE public."ipm_reglements" TO authenticated;
GRANT INSERT ON TABLE public."ipm_reglements" TO authenticated;
GRANT SELECT ON TABLE public."ipm_reglements" TO authenticated;
GRANT UPDATE ON TABLE public."ipm_reglements" TO authenticated;
GRANT DELETE ON TABLE public."ipm_rejets" TO anon;
GRANT INSERT ON TABLE public."ipm_rejets" TO anon;
GRANT SELECT ON TABLE public."ipm_rejets" TO anon;
GRANT UPDATE ON TABLE public."ipm_rejets" TO anon;
GRANT DELETE ON TABLE public."ipm_rejets" TO authenticated;
GRANT INSERT ON TABLE public."ipm_rejets" TO authenticated;
GRANT SELECT ON TABLE public."ipm_rejets" TO authenticated;
GRANT UPDATE ON TABLE public."ipm_rejets" TO authenticated;
GRANT DELETE ON TABLE public."ipm_ventes" TO anon;
GRANT INSERT ON TABLE public."ipm_ventes" TO anon;
GRANT SELECT ON TABLE public."ipm_ventes" TO anon;
GRANT UPDATE ON TABLE public."ipm_ventes" TO anon;
GRANT DELETE ON TABLE public."ipm_ventes" TO authenticated;
GRANT INSERT ON TABLE public."ipm_ventes" TO authenticated;
GRANT SELECT ON TABLE public."ipm_ventes" TO authenticated;
GRANT UPDATE ON TABLE public."ipm_ventes" TO authenticated;
GRANT SELECT ON TABLE public."profiles" TO anon;
GRANT DELETE ON TABLE public."profiles" TO authenticated;
GRANT INSERT ON TABLE public."profiles" TO authenticated;
GRANT SELECT ON TABLE public."profiles" TO authenticated;
GRANT DELETE ON TABLE public."role_permissions" TO anon;
GRANT INSERT ON TABLE public."role_permissions" TO anon;
GRANT SELECT ON TABLE public."role_permissions" TO anon;
GRANT UPDATE ON TABLE public."role_permissions" TO anon;
GRANT DELETE ON TABLE public."role_permissions" TO authenticated;
GRANT INSERT ON TABLE public."role_permissions" TO authenticated;
GRANT SELECT ON TABLE public."role_permissions" TO authenticated;
GRANT UPDATE ON TABLE public."role_permissions" TO authenticated;
GRANT DELETE ON TABLE public."sale_items" TO authenticated;
GRANT INSERT ON TABLE public."sale_items" TO authenticated;
GRANT SELECT ON TABLE public."sale_items" TO authenticated;
GRANT UPDATE ON TABLE public."sale_items" TO authenticated;
GRANT DELETE ON TABLE public."sale_lot_deductions" TO anon;
GRANT INSERT ON TABLE public."sale_lot_deductions" TO anon;
GRANT SELECT ON TABLE public."sale_lot_deductions" TO anon;
GRANT UPDATE ON TABLE public."sale_lot_deductions" TO anon;
GRANT DELETE ON TABLE public."sale_lot_deductions" TO authenticated;
GRANT INSERT ON TABLE public."sale_lot_deductions" TO authenticated;
GRANT SELECT ON TABLE public."sale_lot_deductions" TO authenticated;
GRANT UPDATE ON TABLE public."sale_lot_deductions" TO authenticated;
GRANT DELETE ON TABLE public."sale_payments" TO authenticated;
GRANT INSERT ON TABLE public."sale_payments" TO authenticated;
GRANT SELECT ON TABLE public."sale_payments" TO authenticated;
GRANT UPDATE ON TABLE public."sale_payments" TO authenticated;
GRANT DELETE ON TABLE public."sale_return_items" TO authenticated;
GRANT INSERT ON TABLE public."sale_return_items" TO authenticated;
GRANT SELECT ON TABLE public."sale_return_items" TO authenticated;
GRANT UPDATE ON TABLE public."sale_return_items" TO authenticated;
GRANT DELETE ON TABLE public."sale_returns" TO authenticated;
GRANT INSERT ON TABLE public."sale_returns" TO authenticated;
GRANT SELECT ON TABLE public."sale_returns" TO authenticated;
GRANT UPDATE ON TABLE public."sale_returns" TO authenticated;
GRANT DELETE ON TABLE public."sales" TO authenticated;
GRANT INSERT ON TABLE public."sales" TO authenticated;
GRANT SELECT ON TABLE public."sales" TO authenticated;
GRANT UPDATE ON TABLE public."sales" TO authenticated;
GRANT DELETE ON TABLE public."sites" TO anon;
GRANT INSERT ON TABLE public."sites" TO anon;
GRANT SELECT ON TABLE public."sites" TO anon;
GRANT UPDATE ON TABLE public."sites" TO anon;
GRANT DELETE ON TABLE public."sites" TO authenticated;
GRANT INSERT ON TABLE public."sites" TO authenticated;
GRANT SELECT ON TABLE public."sites" TO authenticated;
GRANT UPDATE ON TABLE public."sites" TO authenticated;
GRANT DELETE ON TABLE public."stock_levels" TO authenticated;
GRANT INSERT ON TABLE public."stock_levels" TO authenticated;
GRANT SELECT ON TABLE public."stock_levels" TO authenticated;
GRANT UPDATE ON TABLE public."stock_levels" TO authenticated;
GRANT DELETE ON TABLE public."stock_lots" TO anon;
GRANT INSERT ON TABLE public."stock_lots" TO anon;
GRANT SELECT ON TABLE public."stock_lots" TO anon;
GRANT UPDATE ON TABLE public."stock_lots" TO anon;
GRANT DELETE ON TABLE public."stock_lots" TO authenticated;
GRANT INSERT ON TABLE public."stock_lots" TO authenticated;
GRANT SELECT ON TABLE public."stock_lots" TO authenticated;
GRANT UPDATE ON TABLE public."stock_lots" TO authenticated;
GRANT DELETE ON TABLE public."stock_movements" TO authenticated;
GRANT INSERT ON TABLE public."stock_movements" TO authenticated;
GRANT SELECT ON TABLE public."stock_movements" TO authenticated;
GRANT UPDATE ON TABLE public."stock_movements" TO authenticated;
GRANT SELECT ON TABLE public."tenants" TO authenticated;
DO $check$ BEGIN
IF (SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relnamespace='public'::regnamespace AND c.relname IN ('sales','sale_items','sale_returns','sale_return_items','sale_payments','stock_levels','stock_lots','stock_movements','sale_lot_deductions','cash_sessions','cash_movements','ipm_ventes','ipm_bordereaux','ipm_factures','ipm_reglements','ipm_rejets','customers','profiles','tenants','sites','role_permissions','articles','cash_registers','cash_register_assignments','cash_register_settings','ipm_organismes','ipm_conventions','ipm_beneficiaires'))<>113 THEN RAISE EXCEPTION 'Nombre de politiques inattendu';END IF;
IF EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname IN ('sales','sale_items','sale_returns','sale_return_items','sale_payments','stock_levels','stock_lots','stock_movements','sale_lot_deductions','cash_sessions','cash_movements','ipm_ventes','ipm_bordereaux','ipm_factures','ipm_reglements','ipm_rejets','customers','profiles','tenants','sites','role_permissions','articles','cash_registers','cash_register_assignments','cash_register_settings','ipm_organismes','ipm_conventions','ipm_beneficiaires') AND NOT c.relrowsecurity) THEN RAISE EXCEPTION 'RLS non activée';END IF;
END $check$;
