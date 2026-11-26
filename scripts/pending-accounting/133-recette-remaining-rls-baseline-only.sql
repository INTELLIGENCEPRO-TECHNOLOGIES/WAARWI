-- RECETTE UNIQUEMENT. Compléter les politiques existantes, sans écraser les règles comptables ni les politiques de sauvegarde.
SET LOCAL search_path TO public, extensions, pg_catalog;
CREATE OR REPLACE FUNCTION public.shop_public_article_visible(p_article_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
SELECT EXISTS (
SELECT 1 FROM articles a
CROSS JOIN LATERAL public.shop_scope(a.tenant_id, true) sc
WHERE a.id = p_article_id AND a.is_active = true
AND public.shop_article_in_scope(a.site_id, sc.scope_site_id, sc.scope_shared, sc.scope_stock_site_ids)
);
$function$;
REVOKE ALL ON FUNCTION public.shop_public_article_visible(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.shop_public_article_visible(uuid) TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.current_user_can_access_site(uuid),public.current_user_is_owner() TO anon;
CREATE POLICY admin_delete_releases ON public.app_releases AS PERMISSIVE FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'super_admin'::text)))));
CREATE POLICY admin_insert_releases ON public.app_releases AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'super_admin'::text)))));
CREATE POLICY admin_select_releases ON public.app_releases AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'super_admin'::text)))));
CREATE POLICY admin_update_releases ON public.app_releases AS PERMISSIVE FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'super_admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'super_admin'::text)))));
CREATE POLICY select_published_releases ON public.app_releases AS PERMISSIVE FOR SELECT TO authenticated USING ((is_published = true));
CREATE POLICY "article_compatibilities public read shop" ON public.article_compatibilities AS PERMISSIVE FOR SELECT TO anon, authenticated USING (shop_public_article_visible(article_id));
CREATE POLICY "compat delete" ON public.article_compatibilities AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "compat insert" ON public.article_compatibilities AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "compat select" ON public.article_compatibilities AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "compat update" ON public.article_compatibilities AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY delete_own_pricing_tiers ON public.article_pricing_tiers AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY insert_own_pricing_tiers ON public.article_pricing_tiers AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY select_own_pricing_tiers ON public.article_pricing_tiers AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY update_own_pricing_tiers ON public.article_pricing_tiers AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "audit insert" ON public.audit_logs AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "audit select" ON public.audit_logs AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY delete_own_balance_adjustments ON public.balance_adjustments AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY insert_own_balance_adjustments ON public.balance_adjustments AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY select_own_balance_adjustments ON public.balance_adjustments AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY update_own_balance_adjustments ON public.balance_adjustments AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY recon_log_select_tenant ON public.balance_reconciliation_log AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY select_balance_reg_log ON public.balance_regularization_log AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "Activity types delete super admin" ON public.business_activity_types AS PERMISSIVE FOR DELETE TO authenticated USING (is_super_admin());
CREATE POLICY "Activity types insert super admin" ON public.business_activity_types AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (is_super_admin());
CREATE POLICY "Activity types readable by anon for signup" ON public.business_activity_types AS PERMISSIVE FOR SELECT TO anon USING ((is_active = true));
CREATE POLICY "Activity types readable by authenticated" ON public.business_activity_types AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "Activity types update super admin" ON public.business_activity_types AS PERMISSIVE FOR UPDATE TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY authenticated_update_sector_images ON public.business_activity_types AS PERMISSIVE FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Tenant members can delete cash_control_lines" ON public.cash_control_lines AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "Tenant members can insert cash_control_lines" ON public.cash_control_lines AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "Tenant members can select cash_control_lines" ON public.cash_control_lines AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)));
CREATE POLICY "Tenant members can update cash_control_lines" ON public.cash_control_lines AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "mc1d delete" ON public.cash_control_lines AS RESTRICTIVE FOR DELETE TO authenticated USING ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs
      WHERE (cs.user_id = auth.uid())))
    ELSE ( SELECT _cs_is_elevated() AS _cs_is_elevated)
END));
CREATE POLICY "mc1d insert" ON public.cash_control_lines AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs
      WHERE (cs.user_id = auth.uid())))
    ELSE ( SELECT _cs_is_elevated() AS _cs_is_elevated)
END));
CREATE POLICY "mc1d select" ON public.cash_control_lines AS RESTRICTIVE FOR SELECT TO authenticated USING ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs))
    ELSE ( SELECT _cs_is_elevated() AS _cs_is_elevated)
END));
CREATE POLICY "mc1d update" ON public.cash_control_lines AS RESTRICTIVE FOR UPDATE TO authenticated USING ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs
      WHERE (cs.user_id = auth.uid())))
    ELSE ( SELECT _cs_is_elevated() AS _cs_is_elevated)
END)) WITH CHECK ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs
      WHERE (cs.user_id = auth.uid())))
    ELSE ( SELECT _cs_is_elevated() AS _cs_is_elevated)
END));
CREATE POLICY "Tenant members can delete cash_regularizations" ON public.cash_regularizations AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "Tenant members can insert cash_regularizations" ON public.cash_regularizations AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "Tenant members can select cash_regularizations" ON public.cash_regularizations AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "Tenant members can update cash_regularizations" ON public.cash_regularizations AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "mc1d delete" ON public.cash_regularizations AS RESTRICTIVE FOR DELETE TO authenticated USING ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs
      WHERE (cs.user_id = auth.uid())))
    ELSE (user_id = auth.uid())
END));
CREATE POLICY "mc1d insert" ON public.cash_regularizations AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs
      WHERE (cs.user_id = auth.uid())))
    ELSE (user_id = auth.uid())
END));
CREATE POLICY "mc1d select" ON public.cash_regularizations AS RESTRICTIVE FOR SELECT TO authenticated USING ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs))
    ELSE ((user_id = auth.uid()) OR ( SELECT _cs_is_elevated() AS _cs_is_elevated))
END));
CREATE POLICY "mc1d update" ON public.cash_regularizations AS RESTRICTIVE FOR UPDATE TO authenticated USING ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs
      WHERE (cs.user_id = auth.uid())))
    ELSE (user_id = auth.uid())
END)) WITH CHECK ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs
      WHERE (cs.user_id = auth.uid())))
    ELSE (user_id = auth.uid())
END));
CREATE POLICY delete_own_categories ON public.categories AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY insert_own_categories ON public.categories AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY select_own_categories ON public.categories AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY update_own_categories ON public.categories AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid())))) WITH CHECK ((tenant_id = ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY "mc1d3 select prepay allocation" ON public.credit_allocations AS RESTRICTIVE FOR SELECT TO authenticated USING (((NOT _cs_multi_current()) OR (source_type IS DISTINCT FROM 'prepay'::text) OR (EXISTS ( SELECT 1
   FROM customer_prepayments pp
  WHERE (pp.id = credit_allocations.source_id)))));
CREATE POLICY select_credit_allocations ON public.credit_allocations AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "Tenant members can delete exception prices" ON public.customer_exception_prices AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY "Tenant members can insert exception prices" ON public.customer_exception_prices AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY "Tenant members can update exception prices" ON public.customer_exception_prices AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid())))) WITH CHECK ((tenant_id = ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY "Tenant members can view exception prices" ON public.customer_exception_prices AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY "mc1d select" ON public.customer_payments AS RESTRICTIVE FOR SELECT TO authenticated USING ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs))
    ELSE ((user_id = auth.uid()) OR (site_id = ANY (( SELECT _cs_supervised_site_ids() AS _cs_supervised_site_ids)::uuid[])))
END));
CREATE POLICY select_customer_payments ON public.customer_payments AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "customer_prepayments tenant insert" ON public.customer_prepayments AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "customer_prepayments tenant select" ON public.customer_prepayments AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "customer_prepayments tenant update" ON public.customer_prepayments AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "mc1d2 insert" ON public.customer_prepayments AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((( SELECT (NOT _cs_multi_current())) OR ((cash_session_id IS NOT NULL) AND (cash_session_id IN ( SELECT cs.id
   FROM cash_sessions cs
  WHERE (cs.user_id = auth.uid()))))));
CREATE POLICY "mc1d2 select" ON public.customer_prepayments AS RESTRICTIVE FOR SELECT TO authenticated USING ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs))
    ELSE (( SELECT _cs_is_elevated() AS _cs_is_elevated) AND (EXISTS ( SELECT 1
       FROM customers c
      WHERE ((c.id = customer_prepayments.customer_id) AND ((c.site_id IS NULL) OR (c.site_id = ANY (( SELECT _cs_supervised_site_ids() AS _cs_supervised_site_ids)::uuid[])))))))
END));
CREATE POLICY "mc1d2 update" ON public.customer_prepayments AS RESTRICTIVE FOR UPDATE TO authenticated USING ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs
      WHERE (cs.user_id = auth.uid())))
    ELSE ( SELECT _cs_is_elevated() AS _cs_is_elevated)
END)) WITH CHECK ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs
      WHERE (cs.user_id = auth.uid())))
    ELSE ( SELECT _cs_is_elevated() AS _cs_is_elevated)
END));
CREATE POLICY delete_own_document_settings ON public.document_settings AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY insert_own_document_settings ON public.document_settings AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY select_own_document_settings ON public.document_settings AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY update_own_document_settings ON public.document_settings AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY expense_categories_delete_scoped ON public.expense_categories AS PERMISSIVE FOR DELETE TO authenticated USING (((tenant_id = current_tenant_id()) AND ((site_id IS NULL) OR current_user_can_access_site(site_id))));
CREATE POLICY expense_categories_insert_scoped ON public.expense_categories AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((tenant_id = current_tenant_id()) AND (((site_id IS NULL) AND is_tenant_owner()) OR ((site_id IS NOT NULL) AND current_user_can_access_site(site_id)))));
CREATE POLICY expense_categories_select_scoped ON public.expense_categories AS PERMISSIVE FOR SELECT TO authenticated USING (((tenant_id = current_tenant_id()) AND ((site_id IS NULL) OR current_user_can_access_site(site_id))));
CREATE POLICY expense_categories_update_scoped ON public.expense_categories AS PERMISSIVE FOR UPDATE TO authenticated USING (((tenant_id = current_tenant_id()) AND ((site_id IS NULL) OR current_user_can_access_site(site_id)))) WITH CHECK (((tenant_id = current_tenant_id()) AND (((site_id IS NULL) AND is_tenant_owner()) OR ((site_id IS NOT NULL) AND current_user_can_access_site(site_id)))));
CREATE POLICY ecss_delete ON public.expense_category_site_settings AS PERMISSIVE FOR DELETE TO authenticated USING (((tenant_id = current_tenant_id()) AND current_user_can_access_site(site_id)));
CREATE POLICY ecss_insert ON public.expense_category_site_settings AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((tenant_id = current_tenant_id()) AND current_user_can_access_site(site_id)));
CREATE POLICY ecss_select ON public.expense_category_site_settings AS PERMISSIVE FOR SELECT TO authenticated USING (((tenant_id = current_tenant_id()) AND current_user_can_access_site(site_id)));
CREATE POLICY ecss_update ON public.expense_category_site_settings AS PERMISSIVE FOR UPDATE TO authenticated USING (((tenant_id = current_tenant_id()) AND current_user_can_access_site(site_id))) WITH CHECK (((tenant_id = current_tenant_id()) AND current_user_can_access_site(site_id)));
CREATE POLICY delete_own_tenant_held_carts ON public.held_carts AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY insert_own_tenant_held_carts ON public.held_carts AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "mc1d delete" ON public.held_carts AS RESTRICTIVE FOR DELETE TO authenticated USING ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs
      WHERE (cs.user_id = auth.uid())))
    ELSE ((user_id = auth.uid()) OR (site_id = ANY (( SELECT _cs_supervised_site_ids() AS _cs_supervised_site_ids)::uuid[])))
END));
CREATE POLICY "mc1d insert" ON public.held_carts AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs
      WHERE (cs.user_id = auth.uid())))
    ELSE ((user_id = auth.uid()) OR (site_id = ANY (( SELECT _cs_supervised_site_ids() AS _cs_supervised_site_ids)::uuid[])))
END));
CREATE POLICY "mc1d select" ON public.held_carts AS RESTRICTIVE FOR SELECT TO authenticated USING ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs))
    ELSE ((user_id = auth.uid()) OR (site_id = ANY (( SELECT _cs_supervised_site_ids() AS _cs_supervised_site_ids)::uuid[])))
END));
CREATE POLICY "mc1d update" ON public.held_carts AS RESTRICTIVE FOR UPDATE TO authenticated USING ((( SELECT (NOT _cs_multi_current())) OR
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
CREATE POLICY select_own_tenant_held_carts ON public.held_carts AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY update_own_tenant_held_carts ON public.held_carts AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY delete_own_ipm_parametres ON public.ipm_parametres AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY insert_own_ipm_parametres ON public.ipm_parametres AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY select_own_ipm_parametres ON public.ipm_parametres AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY update_own_ipm_parametres ON public.ipm_parametres AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid())))) WITH CHECK ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY "Lecture publique de la config landing" ON public.landing_config AS PERMISSIVE FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Super admin peut gérer la config landing" ON public.landing_config AS PERMISSIVE FOR ALL TO authenticated USING ((((auth.jwt() -> 'raw_app_meta_data'::text) ->> 'role'::text) = 'super_admin'::text)) WITH CHECK ((((auth.jwt() -> 'raw_app_meta_data'::text) ->> 'role'::text) = 'super_admin'::text));
CREATE POLICY "Master categories delete super admin" ON public.master_catalog_categories AS PERMISSIVE FOR DELETE TO authenticated USING (is_super_admin());
CREATE POLICY "Master categories insert super admin" ON public.master_catalog_categories AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (is_super_admin());
CREATE POLICY "Master categories readable" ON public.master_catalog_categories AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "Master categories update super admin" ON public.master_catalog_categories AS PERMISSIVE FOR UPDATE TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "Master items delete super admin" ON public.master_catalog_items AS PERMISSIVE FOR DELETE TO authenticated USING (is_super_admin());
CREATE POLICY "Master items insert super admin" ON public.master_catalog_items AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (is_super_admin());
CREATE POLICY "Master items readable" ON public.master_catalog_items AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "Master items update super admin" ON public.master_catalog_items AS PERMISSIVE FOR UPDATE TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "Master catalogs delete super admin" ON public.master_catalogs AS PERMISSIVE FOR DELETE TO authenticated USING (is_super_admin());
CREATE POLICY "Master catalogs insert super admin" ON public.master_catalogs AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (is_super_admin());
CREATE POLICY "Master catalogs readable" ON public.master_catalogs AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "Master catalogs update super admin" ON public.master_catalogs AS PERMISSIVE FOR UPDATE TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY delete_mt_accounts ON public.mt_accounts AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY insert_mt_accounts ON public.mt_accounts AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY select_mt_accounts ON public.mt_accounts AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY update_mt_accounts ON public.mt_accounts AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY delete_mt_audit_log ON public.mt_audit_log AS PERMISSIVE FOR DELETE TO authenticated USING (false);
CREATE POLICY insert_mt_audit_log ON public.mt_audit_log AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY select_mt_audit_log ON public.mt_audit_log AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY update_mt_audit_log ON public.mt_audit_log AS PERMISSIVE FOR UPDATE TO authenticated USING (false);
CREATE POLICY delete_mt_closures ON public.mt_closures AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY insert_mt_closures ON public.mt_closures AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY select_mt_closures ON public.mt_closures AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY update_mt_closures ON public.mt_closures AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY delete_mt_commission_tiers ON public.mt_commission_tiers AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY insert_mt_commission_tiers ON public.mt_commission_tiers AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY select_mt_commission_tiers ON public.mt_commission_tiers AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY update_mt_commission_tiers ON public.mt_commission_tiers AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY delete_mt_customer_ledger ON public.mt_customer_ledger AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY insert_mt_customer_ledger ON public.mt_customer_ledger AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY select_mt_customer_ledger ON public.mt_customer_ledger AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY update_mt_customer_ledger ON public.mt_customer_ledger AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY delete_mt_customers ON public.mt_customers AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY insert_mt_customers ON public.mt_customers AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY select_mt_customers ON public.mt_customers AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY update_mt_customers ON public.mt_customers AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY delete_mt_expense_categories ON public.mt_expense_categories AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY insert_mt_expense_categories ON public.mt_expense_categories AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY select_mt_expense_categories ON public.mt_expense_categories AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY update_mt_expense_categories ON public.mt_expense_categories AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY delete_mt_expenses ON public.mt_expenses AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY insert_mt_expenses ON public.mt_expenses AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY select_mt_expenses ON public.mt_expenses AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY update_mt_expenses ON public.mt_expenses AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY delete_mt_init_balances ON public.mt_init_balances AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY insert_mt_init_balances ON public.mt_init_balances AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY select_mt_init_balances ON public.mt_init_balances AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY update_mt_init_balances ON public.mt_init_balances AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY delete_mt_init_status ON public.mt_init_status AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY insert_mt_init_status ON public.mt_init_status AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY select_mt_init_status ON public.mt_init_status AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY update_mt_init_status ON public.mt_init_status AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY delete_mt_operations ON public.mt_operations AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY insert_mt_operations ON public.mt_operations AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY select_mt_operations ON public.mt_operations AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY update_mt_operations ON public.mt_operations AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY delete_mt_reconciliations ON public.mt_reconciliations AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY insert_mt_reconciliations ON public.mt_reconciliations AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY select_mt_reconciliations ON public.mt_reconciliations AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY update_mt_reconciliations ON public.mt_reconciliations AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY delete_mt_service_point_services ON public.mt_service_point_services AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY insert_mt_service_point_services ON public.mt_service_point_services AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY select_mt_service_point_services ON public.mt_service_point_services AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY update_mt_service_point_services ON public.mt_service_point_services AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY delete_mt_service_points ON public.mt_service_points AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY insert_mt_service_points ON public.mt_service_points AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY select_mt_service_points ON public.mt_service_points AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY update_mt_service_points ON public.mt_service_points AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY delete_mt_services ON public.mt_services AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY insert_mt_services ON public.mt_services AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY select_mt_services ON public.mt_services AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY update_mt_services ON public.mt_services AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY mt_ws_delete ON public.mt_wholesaler_services AS PERMISSIVE FOR DELETE TO authenticated USING ((wholesaler_id IN ( SELECT mt_wholesalers.id
   FROM mt_wholesalers
  WHERE (mt_wholesalers.tenant_id = current_tenant_id()))));
CREATE POLICY mt_ws_insert ON public.mt_wholesaler_services AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((wholesaler_id IN ( SELECT mt_wholesalers.id
   FROM mt_wholesalers
  WHERE (mt_wholesalers.tenant_id = current_tenant_id()))));
CREATE POLICY mt_ws_select ON public.mt_wholesaler_services AS PERMISSIVE FOR SELECT TO authenticated USING ((wholesaler_id IN ( SELECT mt_wholesalers.id
   FROM mt_wholesalers
  WHERE (mt_wholesalers.tenant_id = current_tenant_id()))));
CREATE POLICY mt_wholesalers_delete ON public.mt_wholesalers AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY mt_wholesalers_insert ON public.mt_wholesalers AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY mt_wholesalers_select ON public.mt_wholesalers AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY mt_wholesalers_update ON public.mt_wholesalers AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "notif insert" ON public.notifications AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "notif select" ON public.notifications AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "notif update" ON public.notifications AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "online_order_items tenant delete" ON public.online_order_items AS PERMISSIVE FOR DELETE TO authenticated USING (((tenant_id = current_tenant_id()) AND (EXISTS ( SELECT 1
   FROM online_orders o
  WHERE (o.id = online_order_items.order_id)))));
CREATE POLICY "online_order_items tenant select" ON public.online_order_items AS PERMISSIVE FOR SELECT TO authenticated USING (((tenant_id = current_tenant_id()) AND (EXISTS ( SELECT 1
   FROM online_orders o
  WHERE (o.id = online_order_items.order_id)))));
CREATE POLICY "online_order_items tenant update" ON public.online_order_items AS PERMISSIVE FOR UPDATE TO authenticated USING (((tenant_id = current_tenant_id()) AND (EXISTS ( SELECT 1
   FROM online_orders o
  WHERE (o.id = online_order_items.order_id))))) WITH CHECK (((tenant_id = current_tenant_id()) AND (EXISTS ( SELECT 1
   FROM online_orders o
  WHERE (o.id = online_order_items.order_id)))));
CREATE POLICY "order_status_history tenant insert" ON public.online_order_status_history AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((tenant_id = current_tenant_id()) AND (EXISTS ( SELECT 1
   FROM online_orders o
  WHERE (o.id = online_order_status_history.order_id)))));
CREATE POLICY "order_status_history tenant select" ON public.online_order_status_history AS PERMISSIVE FOR SELECT TO authenticated USING (((tenant_id = current_tenant_id()) AND (EXISTS ( SELECT 1
   FROM online_orders o
  WHERE (o.id = online_order_status_history.order_id)))));
CREATE POLICY "online_orders tenant delete" ON public.online_orders AS PERMISSIVE FOR DELETE TO authenticated USING (((tenant_id = current_tenant_id()) AND (is_tenant_owner() OR (site_id IN ( SELECT current_user_root_site_ids() AS current_user_root_site_ids)))));
CREATE POLICY "online_orders tenant select" ON public.online_orders AS PERMISSIVE FOR SELECT TO authenticated USING (((tenant_id = current_tenant_id()) AND (is_tenant_owner() OR (site_id IN ( SELECT current_user_root_site_ids() AS current_user_root_site_ids)))));
CREATE POLICY "online_orders tenant update" ON public.online_orders AS PERMISSIVE FOR UPDATE TO authenticated USING (((tenant_id = current_tenant_id()) AND (is_tenant_owner() OR (site_id IN ( SELECT current_user_root_site_ids() AS current_user_root_site_ids))))) WITH CHECK (((tenant_id = current_tenant_id()) AND (is_tenant_owner() OR (site_id IN ( SELECT current_user_root_site_ids() AS current_user_root_site_ids)))));
CREATE POLICY part_categories_anon_select_active ON public.part_categories AS PERMISSIVE FOR SELECT TO anon USING (((tenant_id = current_tenant_id()) AND (is_active = true)));
CREATE POLICY part_categories_delete_scoped ON public.part_categories AS PERMISSIVE FOR DELETE TO authenticated USING (((tenant_id = current_tenant_id()) AND ((site_id IS NULL) OR current_user_can_access_site(site_id))));
CREATE POLICY part_categories_insert_scoped ON public.part_categories AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((tenant_id = current_tenant_id()) AND (((site_id IS NULL) AND is_tenant_owner()) OR ((site_id IS NOT NULL) AND current_user_can_access_site(site_id)))));
CREATE POLICY part_categories_select_scoped ON public.part_categories AS PERMISSIVE FOR SELECT TO authenticated USING (((tenant_id = current_tenant_id()) AND ((site_id IS NULL) OR current_user_can_access_site(site_id))));
CREATE POLICY part_categories_update_scoped ON public.part_categories AS PERMISSIVE FOR UPDATE TO authenticated USING (((tenant_id = current_tenant_id()) AND ((site_id IS NULL) OR current_user_can_access_site(site_id)))) WITH CHECK (((tenant_id = current_tenant_id()) AND (((site_id IS NULL) AND is_tenant_owner()) OR ((site_id IS NOT NULL) AND current_user_can_access_site(site_id)))));
CREATE POLICY "pm delete" ON public.payment_methods AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "pm insert" ON public.payment_methods AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "pm select" ON public.payment_methods AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "pm update" ON public.payment_methods AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "Anon view public plans" ON public.plans AS PERMISSIVE FOR SELECT TO anon USING ((is_public = true));
CREATE POLICY "Anyone view plans" ON public.plans AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "Super admin delete plans" ON public.plans AS PERMISSIVE FOR DELETE TO authenticated USING (is_super_admin());
CREATE POLICY "Super admin insert plans" ON public.plans AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (is_super_admin());
CREATE POLICY "Super admin update plans" ON public.plans AS PERMISSIVE FOR UPDATE TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "Super admin view events" ON public.platform_events AS PERMISSIVE FOR SELECT TO authenticated USING (is_super_admin());
CREATE POLICY "Lecture publique de la config login" ON public.platform_login_config AS PERMISSIVE FOR SELECT TO anon, authenticated USING ((id = 'default'::text));
CREATE POLICY delete_own_tier_defs ON public.pricing_tier_definitions AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY insert_own_tier_defs ON public.pricing_tier_definitions AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY select_own_tier_defs ON public.pricing_tier_definitions AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY update_own_tier_defs ON public.pricing_tier_definitions AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "qi delete" ON public.quote_items AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "qi insert" ON public.quote_items AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "qi select" ON public.quote_items AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "qi update" ON public.quote_items AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "quotes insert" ON public.quotes AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "quotes select" ON public.quotes AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "quotes update" ON public.quotes AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY delete_rep_commission_settings ON public.rep_commission_settings AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY insert_rep_commission_settings ON public.rep_commission_settings AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY select_rep_commission_settings ON public.rep_commission_settings AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY update_rep_commission_settings ON public.rep_commission_settings AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY sdl_select_own ON public.sale_deletion_log AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY delete_sales_representatives ON public.sales_representatives AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY insert_sales_representatives ON public.sales_representatives AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY select_sales_representatives ON public.sales_representatives AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY update_sales_representatives ON public.sales_representatives AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY sales_vat_settings_owner_read ON public.sales_vat_settings AS PERMISSIVE FOR SELECT TO authenticated USING (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ( SELECT current_user_is_owner() AS current_user_is_owner)));
CREATE POLICY "shop_settings public read active" ON public.shop_settings AS PERMISSIVE FOR SELECT TO anon, authenticated USING (((is_active = true) AND is_shop_active(tenant_id)));
CREATE POLICY "shop_settings tenant insert" ON public.shop_settings AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY "shop_settings tenant select" ON public.shop_settings AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY "shop_settings tenant update" ON public.shop_settings AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid())))) WITH CHECK ((tenant_id IN ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY insert_own_site_change_log ON public.site_change_log AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));
CREATE POLICY no_delete_site_change_log ON public.site_change_log AS PERMISSIVE FOR DELETE TO authenticated USING (false);
CREATE POLICY no_update_site_change_log ON public.site_change_log AS PERMISSIVE FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY select_own_site_change_log ON public.site_change_log AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = ( SELECT profiles.tenant_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
CREATE POLICY "stkdoc delete" ON public.stock_documents AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "stkdoc insert" ON public.stock_documents AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "stkdoc select" ON public.stock_documents AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "stkdoc update" ON public.stock_documents AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY super_admin_delete_action_tokens ON public.subscription_action_tokens AS PERMISSIVE FOR DELETE TO authenticated USING (is_super_admin());
CREATE POLICY super_admin_insert_action_tokens ON public.subscription_action_tokens AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (is_super_admin());
CREATE POLICY super_admin_select_action_tokens ON public.subscription_action_tokens AS PERMISSIVE FOR SELECT TO authenticated USING (is_super_admin());
CREATE POLICY super_admin_update_action_tokens ON public.subscription_action_tokens AS PERMISSIVE FOR UPDATE TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "soi delete" ON public.supplier_order_items AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "soi insert" ON public.supplier_order_items AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "soi select" ON public.supplier_order_items AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "soi update" ON public.supplier_order_items AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY insert_own_tenant_receptions ON public.supplier_order_receptions AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY select_own_tenant_receptions ON public.supplier_order_receptions AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "so insert" ON public.supplier_orders AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "so select" ON public.supplier_orders AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "so update" ON public.supplier_orders AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "mc1d1 delete" ON public.supplier_payments AS RESTRICTIVE FOR DELETE TO authenticated USING ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs
      WHERE (cs.user_id = auth.uid())))
    WHEN (funding_source = 'cash'::text) THEN ((site_id = ANY (( SELECT _cs_supervised_site_ids() AS _cs_supervised_site_ids)::uuid[])) OR ((site_id IS NULL) AND ( SELECT _cs_is_elevated() AS _cs_is_elevated)))
    ELSE true
END));
CREATE POLICY "mc1d1 insert" ON public.supplier_payments AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs
      WHERE (cs.user_id = auth.uid())))
    ELSE (funding_source IS DISTINCT FROM 'cash'::text)
END));
CREATE POLICY "mc1d1 select" ON public.supplier_payments AS RESTRICTIVE FOR SELECT TO authenticated USING ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs))
    WHEN (funding_source = 'cash'::text) THEN ((site_id = ANY (( SELECT _cs_supervised_site_ids() AS _cs_supervised_site_ids)::uuid[])) OR ((site_id IS NULL) AND ( SELECT _cs_is_elevated() AS _cs_is_elevated)))
    ELSE true
END));
CREATE POLICY "mc1d1 update" ON public.supplier_payments AS RESTRICTIVE FOR UPDATE TO authenticated USING ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs
      WHERE (cs.user_id = auth.uid())))
    WHEN (funding_source = 'cash'::text) THEN ((site_id = ANY (( SELECT _cs_supervised_site_ids() AS _cs_supervised_site_ids)::uuid[])) OR ((site_id IS NULL) AND ( SELECT _cs_is_elevated() AS _cs_is_elevated)))
    ELSE true
END)) WITH CHECK ((( SELECT (NOT _cs_multi_current())) OR
CASE
    WHEN (cash_session_id IS NOT NULL) THEN (cash_session_id IN ( SELECT cs.id
       FROM cash_sessions cs
      WHERE (cs.user_id = auth.uid())))
    WHEN (funding_source = 'cash'::text) THEN ((site_id = ANY (( SELECT _cs_supervised_site_ids() AS _cs_supervised_site_ids)::uuid[])) OR ((site_id IS NULL) AND ( SELECT _cs_is_elevated() AS _cs_is_elevated)))
    ELSE true
END));
CREATE POLICY "supp delete" ON public.supplier_payments AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "supp insert" ON public.supplier_payments AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "supp select" ON public.supplier_payments AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "supp update" ON public.supplier_payments AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "sup delete" ON public.suppliers AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "sup insert" ON public.suppliers AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "sup select" ON public.suppliers AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "sup update" ON public.suppliers AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "Users insert own reads" ON public.tenant_message_reads AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "Users view own reads" ON public.tenant_message_reads AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR is_super_admin()));
CREATE POLICY "Members view eligible messages" ON public.tenant_messages AS PERMISSIVE FOR SELECT TO authenticated USING ((is_super_admin() OR (target = 'all'::text) OR ((target = 'tenant'::text) AND (tenant_id = current_tenant_id())) OR ((target = 'plan'::text) AND (plan_code = ( SELECT tenants.plan
   FROM tenants
  WHERE (tenants.id = current_tenant_id()))))));
CREATE POLICY "Super admin delete messages" ON public.tenant_messages AS PERMISSIVE FOR DELETE TO authenticated USING (is_super_admin());
CREATE POLICY "Super admin insert messages" ON public.tenant_messages AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (is_super_admin());
CREATE POLICY "Super admin update messages" ON public.tenant_messages AS PERMISSIVE FOR UPDATE TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "Super admin delete subs" ON public.tenant_subscriptions AS PERMISSIVE FOR DELETE TO authenticated USING (is_super_admin());
CREATE POLICY "Super admin insert subs" ON public.tenant_subscriptions AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (is_super_admin());
CREATE POLICY "Super admin update subs" ON public.tenant_subscriptions AS PERMISSIVE FOR UPDATE TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "Tenant members view own subs" ON public.tenant_subscriptions AS PERMISSIVE FOR SELECT TO authenticated USING (((tenant_id = current_tenant_id()) OR is_super_admin()));
CREATE POLICY "mc1d1 select" ON public.vault_movements AS RESTRICTIVE FOR SELECT TO authenticated USING ((( SELECT (NOT _cs_multi_current())) OR (cash_session_id IS NULL) OR (cash_session_id IN ( SELECT cs.id
   FROM cash_sessions cs))));
CREATE POLICY vault_movements_select_tenant_sites ON public.vault_movements AS PERMISSIVE FOR SELECT TO authenticated USING (((tenant_id = current_tenant_id()) AND (EXISTS ( SELECT 1
   FROM profiles pr
  WHERE ((pr.id = auth.uid()) AND (pr.tenant_id = vault_movements.tenant_id) AND ((pr.assigned_site_ids IS NULL) OR (array_length(pr.assigned_site_ids, 1) IS NULL) OR (vault_movements.site_id = ANY (pr.assigned_site_ids))))))));
CREATE POLICY vaults_select_tenant_sites ON public.vaults AS PERMISSIVE FOR SELECT TO authenticated USING (((tenant_id = current_tenant_id()) AND (EXISTS ( SELECT 1
   FROM profiles pr
  WHERE ((pr.id = auth.uid()) AND (pr.tenant_id = vaults.tenant_id) AND ((pr.assigned_site_ids IS NULL) OR (array_length(pr.assigned_site_ids, 1) IS NULL) OR (vaults.site_id = ANY (pr.assigned_site_ids))))))));
CREATE POLICY "veh brands delete" ON public.vehicle_brands AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "veh brands insert" ON public.vehicle_brands AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "veh brands select" ON public.vehicle_brands AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "veh brands update" ON public.vehicle_brands AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "vehicle_brands public read shop" ON public.vehicle_brands AS PERMISSIVE FOR SELECT TO anon, authenticated USING (((is_active = true) AND (tenant_id IN ( SELECT tenants.id
   FROM tenants
  WHERE ((tenants.public_slug IS NOT NULL) AND COALESCE(tenants.is_active, true) AND (COALESCE(tenants.approval_status, 'approved'::text) = 'approved'::text) AND ((tenants.enabled_modules IS NULL) OR (jsonb_typeof(tenants.enabled_modules) <> 'array'::text) OR (tenants.enabled_modules ? 'online_orders'::text)))))));
CREATE POLICY "veh models delete" ON public.vehicle_models AS PERMISSIVE FOR DELETE TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "veh models insert" ON public.vehicle_models AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "veh models select" ON public.vehicle_models AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id = current_tenant_id()));
CREATE POLICY "veh models update" ON public.vehicle_models AS PERMISSIVE FOR UPDATE TO authenticated USING ((tenant_id = current_tenant_id())) WITH CHECK ((tenant_id = current_tenant_id()));
CREATE POLICY "vehicle_models public read shop" ON public.vehicle_models AS PERMISSIVE FOR SELECT TO anon, authenticated USING ((tenant_id IN ( SELECT tenants.id
   FROM tenants
  WHERE ((tenants.public_slug IS NOT NULL) AND COALESCE(tenants.is_active, true) AND (COALESCE(tenants.approval_status, 'approved'::text) = 'approved'::text) AND ((tenants.enabled_modules IS NULL) OR (jsonb_typeof(tenants.enabled_modules) <> 'array'::text) OR (tenants.enabled_modules ? 'online_orders'::text))))));
GRANT DELETE ON TABLE public."app_releases" TO anon;
GRANT INSERT ON TABLE public."app_releases" TO anon;
GRANT SELECT ON TABLE public."app_releases" TO anon;
GRANT UPDATE ON TABLE public."app_releases" TO anon;
GRANT DELETE ON TABLE public."app_releases" TO authenticated;
GRANT INSERT ON TABLE public."app_releases" TO authenticated;
GRANT SELECT ON TABLE public."app_releases" TO authenticated;
GRANT UPDATE ON TABLE public."app_releases" TO authenticated;
GRANT DELETE ON TABLE public."article_compatibilities" TO anon;
GRANT INSERT ON TABLE public."article_compatibilities" TO anon;
GRANT SELECT ON TABLE public."article_compatibilities" TO anon;
GRANT UPDATE ON TABLE public."article_compatibilities" TO anon;
GRANT DELETE ON TABLE public."article_compatibilities" TO authenticated;
GRANT INSERT ON TABLE public."article_compatibilities" TO authenticated;
GRANT SELECT ON TABLE public."article_compatibilities" TO authenticated;
GRANT UPDATE ON TABLE public."article_compatibilities" TO authenticated;
GRANT DELETE ON TABLE public."article_pricing_tiers" TO anon;
GRANT INSERT ON TABLE public."article_pricing_tiers" TO anon;
GRANT SELECT ON TABLE public."article_pricing_tiers" TO anon;
GRANT UPDATE ON TABLE public."article_pricing_tiers" TO anon;
GRANT DELETE ON TABLE public."article_pricing_tiers" TO authenticated;
GRANT INSERT ON TABLE public."article_pricing_tiers" TO authenticated;
GRANT SELECT ON TABLE public."article_pricing_tiers" TO authenticated;
GRANT UPDATE ON TABLE public."article_pricing_tiers" TO authenticated;
GRANT DELETE ON TABLE public."audit_logs" TO anon;
GRANT INSERT ON TABLE public."audit_logs" TO anon;
GRANT SELECT ON TABLE public."audit_logs" TO anon;
GRANT UPDATE ON TABLE public."audit_logs" TO anon;
GRANT DELETE ON TABLE public."audit_logs" TO authenticated;
GRANT INSERT ON TABLE public."audit_logs" TO authenticated;
GRANT SELECT ON TABLE public."audit_logs" TO authenticated;
GRANT UPDATE ON TABLE public."audit_logs" TO authenticated;
GRANT DELETE ON TABLE public."balance_adjustments" TO anon;
GRANT INSERT ON TABLE public."balance_adjustments" TO anon;
GRANT SELECT ON TABLE public."balance_adjustments" TO anon;
GRANT UPDATE ON TABLE public."balance_adjustments" TO anon;
GRANT DELETE ON TABLE public."balance_adjustments" TO authenticated;
GRANT INSERT ON TABLE public."balance_adjustments" TO authenticated;
GRANT SELECT ON TABLE public."balance_adjustments" TO authenticated;
GRANT UPDATE ON TABLE public."balance_adjustments" TO authenticated;
GRANT DELETE ON TABLE public."balance_reconciliation_log" TO anon;
GRANT INSERT ON TABLE public."balance_reconciliation_log" TO anon;
GRANT SELECT ON TABLE public."balance_reconciliation_log" TO anon;
GRANT UPDATE ON TABLE public."balance_reconciliation_log" TO anon;
GRANT DELETE ON TABLE public."balance_reconciliation_log" TO authenticated;
GRANT INSERT ON TABLE public."balance_reconciliation_log" TO authenticated;
GRANT SELECT ON TABLE public."balance_reconciliation_log" TO authenticated;
GRANT UPDATE ON TABLE public."balance_reconciliation_log" TO authenticated;
GRANT DELETE ON TABLE public."balance_regularization_log" TO anon;
GRANT INSERT ON TABLE public."balance_regularization_log" TO anon;
GRANT SELECT ON TABLE public."balance_regularization_log" TO anon;
GRANT UPDATE ON TABLE public."balance_regularization_log" TO anon;
GRANT DELETE ON TABLE public."balance_regularization_log" TO authenticated;
GRANT INSERT ON TABLE public."balance_regularization_log" TO authenticated;
GRANT SELECT ON TABLE public."balance_regularization_log" TO authenticated;
GRANT UPDATE ON TABLE public."balance_regularization_log" TO authenticated;
GRANT DELETE ON TABLE public."business_activity_types" TO anon;
GRANT INSERT ON TABLE public."business_activity_types" TO anon;
GRANT SELECT ON TABLE public."business_activity_types" TO anon;
GRANT UPDATE ON TABLE public."business_activity_types" TO anon;
GRANT DELETE ON TABLE public."business_activity_types" TO authenticated;
GRANT INSERT ON TABLE public."business_activity_types" TO authenticated;
GRANT SELECT ON TABLE public."business_activity_types" TO authenticated;
GRANT UPDATE ON TABLE public."business_activity_types" TO authenticated;
GRANT DELETE ON TABLE public."cash_control_lines" TO authenticated;
GRANT INSERT ON TABLE public."cash_control_lines" TO authenticated;
GRANT SELECT ON TABLE public."cash_control_lines" TO authenticated;
GRANT UPDATE ON TABLE public."cash_control_lines" TO authenticated;
GRANT DELETE ON TABLE public."cash_regularizations" TO authenticated;
GRANT INSERT ON TABLE public."cash_regularizations" TO authenticated;
GRANT SELECT ON TABLE public."cash_regularizations" TO authenticated;
GRANT UPDATE ON TABLE public."cash_regularizations" TO authenticated;
GRANT DELETE ON TABLE public."categories" TO anon;
GRANT INSERT ON TABLE public."categories" TO anon;
GRANT SELECT ON TABLE public."categories" TO anon;
GRANT UPDATE ON TABLE public."categories" TO anon;
GRANT DELETE ON TABLE public."categories" TO authenticated;
GRANT INSERT ON TABLE public."categories" TO authenticated;
GRANT SELECT ON TABLE public."categories" TO authenticated;
GRANT UPDATE ON TABLE public."categories" TO authenticated;
GRANT SELECT ON TABLE public."credit_allocations" TO anon;
GRANT SELECT ON TABLE public."credit_allocations" TO authenticated;
GRANT DELETE ON TABLE public."customer_exception_prices" TO anon;
GRANT INSERT ON TABLE public."customer_exception_prices" TO anon;
GRANT SELECT ON TABLE public."customer_exception_prices" TO anon;
GRANT UPDATE ON TABLE public."customer_exception_prices" TO anon;
GRANT DELETE ON TABLE public."customer_exception_prices" TO authenticated;
GRANT INSERT ON TABLE public."customer_exception_prices" TO authenticated;
GRANT SELECT ON TABLE public."customer_exception_prices" TO authenticated;
GRANT UPDATE ON TABLE public."customer_exception_prices" TO authenticated;
GRANT SELECT ON TABLE public."customer_payments" TO authenticated;
GRANT DELETE ON TABLE public."customer_prepayments" TO authenticated;
GRANT INSERT ON TABLE public."customer_prepayments" TO authenticated;
GRANT SELECT ON TABLE public."customer_prepayments" TO authenticated;
GRANT UPDATE ON TABLE public."customer_prepayments" TO authenticated;
GRANT DELETE ON TABLE public."document_settings" TO anon;
GRANT INSERT ON TABLE public."document_settings" TO anon;
GRANT SELECT ON TABLE public."document_settings" TO anon;
GRANT UPDATE ON TABLE public."document_settings" TO anon;
GRANT DELETE ON TABLE public."document_settings" TO authenticated;
GRANT INSERT ON TABLE public."document_settings" TO authenticated;
GRANT SELECT ON TABLE public."document_settings" TO authenticated;
GRANT UPDATE ON TABLE public."document_settings" TO authenticated;
GRANT DELETE ON TABLE public."expense_categories" TO anon;
GRANT INSERT ON TABLE public."expense_categories" TO anon;
GRANT SELECT ON TABLE public."expense_categories" TO anon;
GRANT UPDATE ON TABLE public."expense_categories" TO anon;
GRANT DELETE ON TABLE public."expense_categories" TO authenticated;
GRANT INSERT ON TABLE public."expense_categories" TO authenticated;
GRANT SELECT ON TABLE public."expense_categories" TO authenticated;
GRANT UPDATE ON TABLE public."expense_categories" TO authenticated;
GRANT DELETE ON TABLE public."expense_category_site_settings" TO anon;
GRANT INSERT ON TABLE public."expense_category_site_settings" TO anon;
GRANT SELECT ON TABLE public."expense_category_site_settings" TO anon;
GRANT UPDATE ON TABLE public."expense_category_site_settings" TO anon;
GRANT DELETE ON TABLE public."expense_category_site_settings" TO authenticated;
GRANT INSERT ON TABLE public."expense_category_site_settings" TO authenticated;
GRANT SELECT ON TABLE public."expense_category_site_settings" TO authenticated;
GRANT UPDATE ON TABLE public."expense_category_site_settings" TO authenticated;
GRANT DELETE ON TABLE public."held_carts" TO authenticated;
GRANT INSERT ON TABLE public."held_carts" TO authenticated;
GRANT SELECT ON TABLE public."held_carts" TO authenticated;
GRANT UPDATE ON TABLE public."held_carts" TO authenticated;
GRANT DELETE ON TABLE public."ipm_parametres" TO anon;
GRANT INSERT ON TABLE public."ipm_parametres" TO anon;
GRANT SELECT ON TABLE public."ipm_parametres" TO anon;
GRANT UPDATE ON TABLE public."ipm_parametres" TO anon;
GRANT DELETE ON TABLE public."ipm_parametres" TO authenticated;
GRANT INSERT ON TABLE public."ipm_parametres" TO authenticated;
GRANT SELECT ON TABLE public."ipm_parametres" TO authenticated;
GRANT UPDATE ON TABLE public."ipm_parametres" TO authenticated;
GRANT DELETE ON TABLE public."landing_config" TO anon;
GRANT INSERT ON TABLE public."landing_config" TO anon;
GRANT SELECT ON TABLE public."landing_config" TO anon;
GRANT UPDATE ON TABLE public."landing_config" TO anon;
GRANT DELETE ON TABLE public."landing_config" TO authenticated;
GRANT INSERT ON TABLE public."landing_config" TO authenticated;
GRANT SELECT ON TABLE public."landing_config" TO authenticated;
GRANT UPDATE ON TABLE public."landing_config" TO authenticated;
GRANT DELETE ON TABLE public."master_catalog_categories" TO anon;
GRANT INSERT ON TABLE public."master_catalog_categories" TO anon;
GRANT SELECT ON TABLE public."master_catalog_categories" TO anon;
GRANT UPDATE ON TABLE public."master_catalog_categories" TO anon;
GRANT DELETE ON TABLE public."master_catalog_categories" TO authenticated;
GRANT INSERT ON TABLE public."master_catalog_categories" TO authenticated;
GRANT SELECT ON TABLE public."master_catalog_categories" TO authenticated;
GRANT UPDATE ON TABLE public."master_catalog_categories" TO authenticated;
GRANT DELETE ON TABLE public."master_catalog_items" TO anon;
GRANT INSERT ON TABLE public."master_catalog_items" TO anon;
GRANT SELECT ON TABLE public."master_catalog_items" TO anon;
GRANT UPDATE ON TABLE public."master_catalog_items" TO anon;
GRANT DELETE ON TABLE public."master_catalog_items" TO authenticated;
GRANT INSERT ON TABLE public."master_catalog_items" TO authenticated;
GRANT SELECT ON TABLE public."master_catalog_items" TO authenticated;
GRANT UPDATE ON TABLE public."master_catalog_items" TO authenticated;
GRANT DELETE ON TABLE public."master_catalogs" TO anon;
GRANT INSERT ON TABLE public."master_catalogs" TO anon;
GRANT SELECT ON TABLE public."master_catalogs" TO anon;
GRANT UPDATE ON TABLE public."master_catalogs" TO anon;
GRANT DELETE ON TABLE public."master_catalogs" TO authenticated;
GRANT INSERT ON TABLE public."master_catalogs" TO authenticated;
GRANT SELECT ON TABLE public."master_catalogs" TO authenticated;
GRANT UPDATE ON TABLE public."master_catalogs" TO authenticated;
GRANT DELETE ON TABLE public."mt_accounts" TO anon;
GRANT INSERT ON TABLE public."mt_accounts" TO anon;
GRANT SELECT ON TABLE public."mt_accounts" TO anon;
GRANT UPDATE ON TABLE public."mt_accounts" TO anon;
GRANT DELETE ON TABLE public."mt_accounts" TO authenticated;
GRANT INSERT ON TABLE public."mt_accounts" TO authenticated;
GRANT SELECT ON TABLE public."mt_accounts" TO authenticated;
GRANT UPDATE ON TABLE public."mt_accounts" TO authenticated;
GRANT DELETE ON TABLE public."mt_audit_log" TO anon;
GRANT INSERT ON TABLE public."mt_audit_log" TO anon;
GRANT SELECT ON TABLE public."mt_audit_log" TO anon;
GRANT UPDATE ON TABLE public."mt_audit_log" TO anon;
GRANT DELETE ON TABLE public."mt_audit_log" TO authenticated;
GRANT INSERT ON TABLE public."mt_audit_log" TO authenticated;
GRANT SELECT ON TABLE public."mt_audit_log" TO authenticated;
GRANT UPDATE ON TABLE public."mt_audit_log" TO authenticated;
GRANT DELETE ON TABLE public."mt_closures" TO anon;
GRANT INSERT ON TABLE public."mt_closures" TO anon;
GRANT SELECT ON TABLE public."mt_closures" TO anon;
GRANT UPDATE ON TABLE public."mt_closures" TO anon;
GRANT DELETE ON TABLE public."mt_closures" TO authenticated;
GRANT INSERT ON TABLE public."mt_closures" TO authenticated;
GRANT SELECT ON TABLE public."mt_closures" TO authenticated;
GRANT UPDATE ON TABLE public."mt_closures" TO authenticated;
GRANT DELETE ON TABLE public."mt_commission_tiers" TO anon;
GRANT INSERT ON TABLE public."mt_commission_tiers" TO anon;
GRANT SELECT ON TABLE public."mt_commission_tiers" TO anon;
GRANT UPDATE ON TABLE public."mt_commission_tiers" TO anon;
GRANT DELETE ON TABLE public."mt_commission_tiers" TO authenticated;
GRANT INSERT ON TABLE public."mt_commission_tiers" TO authenticated;
GRANT SELECT ON TABLE public."mt_commission_tiers" TO authenticated;
GRANT UPDATE ON TABLE public."mt_commission_tiers" TO authenticated;
GRANT DELETE ON TABLE public."mt_customer_ledger" TO anon;
GRANT INSERT ON TABLE public."mt_customer_ledger" TO anon;
GRANT SELECT ON TABLE public."mt_customer_ledger" TO anon;
GRANT UPDATE ON TABLE public."mt_customer_ledger" TO anon;
GRANT DELETE ON TABLE public."mt_customer_ledger" TO authenticated;
GRANT INSERT ON TABLE public."mt_customer_ledger" TO authenticated;
GRANT SELECT ON TABLE public."mt_customer_ledger" TO authenticated;
GRANT UPDATE ON TABLE public."mt_customer_ledger" TO authenticated;
GRANT DELETE ON TABLE public."mt_customers" TO anon;
GRANT INSERT ON TABLE public."mt_customers" TO anon;
GRANT SELECT ON TABLE public."mt_customers" TO anon;
GRANT UPDATE ON TABLE public."mt_customers" TO anon;
GRANT DELETE ON TABLE public."mt_customers" TO authenticated;
GRANT INSERT ON TABLE public."mt_customers" TO authenticated;
GRANT SELECT ON TABLE public."mt_customers" TO authenticated;
GRANT UPDATE ON TABLE public."mt_customers" TO authenticated;
GRANT DELETE ON TABLE public."mt_expense_categories" TO anon;
GRANT INSERT ON TABLE public."mt_expense_categories" TO anon;
GRANT SELECT ON TABLE public."mt_expense_categories" TO anon;
GRANT UPDATE ON TABLE public."mt_expense_categories" TO anon;
GRANT DELETE ON TABLE public."mt_expense_categories" TO authenticated;
GRANT INSERT ON TABLE public."mt_expense_categories" TO authenticated;
GRANT SELECT ON TABLE public."mt_expense_categories" TO authenticated;
GRANT UPDATE ON TABLE public."mt_expense_categories" TO authenticated;
GRANT DELETE ON TABLE public."mt_expenses" TO anon;
GRANT INSERT ON TABLE public."mt_expenses" TO anon;
GRANT SELECT ON TABLE public."mt_expenses" TO anon;
GRANT UPDATE ON TABLE public."mt_expenses" TO anon;
GRANT DELETE ON TABLE public."mt_expenses" TO authenticated;
GRANT INSERT ON TABLE public."mt_expenses" TO authenticated;
GRANT SELECT ON TABLE public."mt_expenses" TO authenticated;
GRANT UPDATE ON TABLE public."mt_expenses" TO authenticated;
GRANT DELETE ON TABLE public."mt_init_balances" TO anon;
GRANT INSERT ON TABLE public."mt_init_balances" TO anon;
GRANT SELECT ON TABLE public."mt_init_balances" TO anon;
GRANT UPDATE ON TABLE public."mt_init_balances" TO anon;
GRANT DELETE ON TABLE public."mt_init_balances" TO authenticated;
GRANT INSERT ON TABLE public."mt_init_balances" TO authenticated;
GRANT SELECT ON TABLE public."mt_init_balances" TO authenticated;
GRANT UPDATE ON TABLE public."mt_init_balances" TO authenticated;
GRANT DELETE ON TABLE public."mt_init_status" TO anon;
GRANT INSERT ON TABLE public."mt_init_status" TO anon;
GRANT SELECT ON TABLE public."mt_init_status" TO anon;
GRANT UPDATE ON TABLE public."mt_init_status" TO anon;
GRANT DELETE ON TABLE public."mt_init_status" TO authenticated;
GRANT INSERT ON TABLE public."mt_init_status" TO authenticated;
GRANT SELECT ON TABLE public."mt_init_status" TO authenticated;
GRANT UPDATE ON TABLE public."mt_init_status" TO authenticated;
GRANT DELETE ON TABLE public."mt_operations" TO anon;
GRANT INSERT ON TABLE public."mt_operations" TO anon;
GRANT SELECT ON TABLE public."mt_operations" TO anon;
GRANT UPDATE ON TABLE public."mt_operations" TO anon;
GRANT DELETE ON TABLE public."mt_operations" TO authenticated;
GRANT INSERT ON TABLE public."mt_operations" TO authenticated;
GRANT SELECT ON TABLE public."mt_operations" TO authenticated;
GRANT UPDATE ON TABLE public."mt_operations" TO authenticated;
GRANT DELETE ON TABLE public."mt_reconciliations" TO anon;
GRANT INSERT ON TABLE public."mt_reconciliations" TO anon;
GRANT SELECT ON TABLE public."mt_reconciliations" TO anon;
GRANT UPDATE ON TABLE public."mt_reconciliations" TO anon;
GRANT DELETE ON TABLE public."mt_reconciliations" TO authenticated;
GRANT INSERT ON TABLE public."mt_reconciliations" TO authenticated;
GRANT SELECT ON TABLE public."mt_reconciliations" TO authenticated;
GRANT UPDATE ON TABLE public."mt_reconciliations" TO authenticated;
GRANT DELETE ON TABLE public."mt_service_point_services" TO anon;
GRANT INSERT ON TABLE public."mt_service_point_services" TO anon;
GRANT SELECT ON TABLE public."mt_service_point_services" TO anon;
GRANT UPDATE ON TABLE public."mt_service_point_services" TO anon;
GRANT DELETE ON TABLE public."mt_service_point_services" TO authenticated;
GRANT INSERT ON TABLE public."mt_service_point_services" TO authenticated;
GRANT SELECT ON TABLE public."mt_service_point_services" TO authenticated;
GRANT UPDATE ON TABLE public."mt_service_point_services" TO authenticated;
GRANT DELETE ON TABLE public."mt_service_points" TO anon;
GRANT INSERT ON TABLE public."mt_service_points" TO anon;
GRANT SELECT ON TABLE public."mt_service_points" TO anon;
GRANT UPDATE ON TABLE public."mt_service_points" TO anon;
GRANT DELETE ON TABLE public."mt_service_points" TO authenticated;
GRANT INSERT ON TABLE public."mt_service_points" TO authenticated;
GRANT SELECT ON TABLE public."mt_service_points" TO authenticated;
GRANT UPDATE ON TABLE public."mt_service_points" TO authenticated;
GRANT DELETE ON TABLE public."mt_services" TO anon;
GRANT INSERT ON TABLE public."mt_services" TO anon;
GRANT SELECT ON TABLE public."mt_services" TO anon;
GRANT UPDATE ON TABLE public."mt_services" TO anon;
GRANT DELETE ON TABLE public."mt_services" TO authenticated;
GRANT INSERT ON TABLE public."mt_services" TO authenticated;
GRANT SELECT ON TABLE public."mt_services" TO authenticated;
GRANT UPDATE ON TABLE public."mt_services" TO authenticated;
GRANT DELETE ON TABLE public."mt_wholesaler_services" TO anon;
GRANT INSERT ON TABLE public."mt_wholesaler_services" TO anon;
GRANT SELECT ON TABLE public."mt_wholesaler_services" TO anon;
GRANT UPDATE ON TABLE public."mt_wholesaler_services" TO anon;
GRANT DELETE ON TABLE public."mt_wholesaler_services" TO authenticated;
GRANT INSERT ON TABLE public."mt_wholesaler_services" TO authenticated;
GRANT SELECT ON TABLE public."mt_wholesaler_services" TO authenticated;
GRANT UPDATE ON TABLE public."mt_wholesaler_services" TO authenticated;
GRANT DELETE ON TABLE public."mt_wholesalers" TO anon;
GRANT INSERT ON TABLE public."mt_wholesalers" TO anon;
GRANT SELECT ON TABLE public."mt_wholesalers" TO anon;
GRANT UPDATE ON TABLE public."mt_wholesalers" TO anon;
GRANT DELETE ON TABLE public."mt_wholesalers" TO authenticated;
GRANT INSERT ON TABLE public."mt_wholesalers" TO authenticated;
GRANT SELECT ON TABLE public."mt_wholesalers" TO authenticated;
GRANT UPDATE ON TABLE public."mt_wholesalers" TO authenticated;
GRANT DELETE ON TABLE public."notifications" TO anon;
GRANT INSERT ON TABLE public."notifications" TO anon;
GRANT SELECT ON TABLE public."notifications" TO anon;
GRANT UPDATE ON TABLE public."notifications" TO anon;
GRANT DELETE ON TABLE public."notifications" TO authenticated;
GRANT INSERT ON TABLE public."notifications" TO authenticated;
GRANT SELECT ON TABLE public."notifications" TO authenticated;
GRANT UPDATE ON TABLE public."notifications" TO authenticated;
GRANT DELETE ON TABLE public."online_order_items" TO authenticated;
GRANT INSERT ON TABLE public."online_order_items" TO authenticated;
GRANT SELECT ON TABLE public."online_order_items" TO authenticated;
GRANT UPDATE ON TABLE public."online_order_items" TO authenticated;
GRANT DELETE ON TABLE public."online_order_status_history" TO anon;
GRANT INSERT ON TABLE public."online_order_status_history" TO anon;
GRANT SELECT ON TABLE public."online_order_status_history" TO anon;
GRANT UPDATE ON TABLE public."online_order_status_history" TO anon;
GRANT DELETE ON TABLE public."online_order_status_history" TO authenticated;
GRANT INSERT ON TABLE public."online_order_status_history" TO authenticated;
GRANT SELECT ON TABLE public."online_order_status_history" TO authenticated;
GRANT UPDATE ON TABLE public."online_order_status_history" TO authenticated;
GRANT DELETE ON TABLE public."online_orders" TO authenticated;
GRANT INSERT ON TABLE public."online_orders" TO authenticated;
GRANT SELECT ON TABLE public."online_orders" TO authenticated;
GRANT UPDATE ON TABLE public."online_orders" TO authenticated;
GRANT DELETE ON TABLE public."part_categories" TO anon;
GRANT INSERT ON TABLE public."part_categories" TO anon;
GRANT SELECT ON TABLE public."part_categories" TO anon;
GRANT UPDATE ON TABLE public."part_categories" TO anon;
GRANT DELETE ON TABLE public."part_categories" TO authenticated;
GRANT INSERT ON TABLE public."part_categories" TO authenticated;
GRANT SELECT ON TABLE public."part_categories" TO authenticated;
GRANT UPDATE ON TABLE public."part_categories" TO authenticated;
GRANT DELETE ON TABLE public."payment_methods" TO anon;
GRANT INSERT ON TABLE public."payment_methods" TO anon;
GRANT SELECT ON TABLE public."payment_methods" TO anon;
GRANT UPDATE ON TABLE public."payment_methods" TO anon;
GRANT DELETE ON TABLE public."payment_methods" TO authenticated;
GRANT INSERT ON TABLE public."payment_methods" TO authenticated;
GRANT SELECT ON TABLE public."payment_methods" TO authenticated;
GRANT UPDATE ON TABLE public."payment_methods" TO authenticated;
GRANT DELETE ON TABLE public."plans" TO anon;
GRANT INSERT ON TABLE public."plans" TO anon;
GRANT SELECT ON TABLE public."plans" TO anon;
GRANT UPDATE ON TABLE public."plans" TO anon;
GRANT DELETE ON TABLE public."plans" TO authenticated;
GRANT INSERT ON TABLE public."plans" TO authenticated;
GRANT SELECT ON TABLE public."plans" TO authenticated;
GRANT UPDATE ON TABLE public."plans" TO authenticated;
GRANT DELETE ON TABLE public."platform_events" TO anon;
GRANT INSERT ON TABLE public."platform_events" TO anon;
GRANT SELECT ON TABLE public."platform_events" TO anon;
GRANT UPDATE ON TABLE public."platform_events" TO anon;
GRANT DELETE ON TABLE public."platform_events" TO authenticated;
GRANT INSERT ON TABLE public."platform_events" TO authenticated;
GRANT SELECT ON TABLE public."platform_events" TO authenticated;
GRANT UPDATE ON TABLE public."platform_events" TO authenticated;
GRANT DELETE ON TABLE public."platform_login_config" TO anon;
GRANT INSERT ON TABLE public."platform_login_config" TO anon;
GRANT SELECT ON TABLE public."platform_login_config" TO anon;
GRANT UPDATE ON TABLE public."platform_login_config" TO anon;
GRANT DELETE ON TABLE public."platform_login_config" TO authenticated;
GRANT INSERT ON TABLE public."platform_login_config" TO authenticated;
GRANT SELECT ON TABLE public."platform_login_config" TO authenticated;
GRANT UPDATE ON TABLE public."platform_login_config" TO authenticated;
GRANT DELETE ON TABLE public."pricing_tier_definitions" TO anon;
GRANT INSERT ON TABLE public."pricing_tier_definitions" TO anon;
GRANT SELECT ON TABLE public."pricing_tier_definitions" TO anon;
GRANT UPDATE ON TABLE public."pricing_tier_definitions" TO anon;
GRANT DELETE ON TABLE public."pricing_tier_definitions" TO authenticated;
GRANT INSERT ON TABLE public."pricing_tier_definitions" TO authenticated;
GRANT SELECT ON TABLE public."pricing_tier_definitions" TO authenticated;
GRANT UPDATE ON TABLE public."pricing_tier_definitions" TO authenticated;
GRANT DELETE ON TABLE public."quote_items" TO anon;
GRANT INSERT ON TABLE public."quote_items" TO anon;
GRANT SELECT ON TABLE public."quote_items" TO anon;
GRANT UPDATE ON TABLE public."quote_items" TO anon;
GRANT DELETE ON TABLE public."quote_items" TO authenticated;
GRANT INSERT ON TABLE public."quote_items" TO authenticated;
GRANT SELECT ON TABLE public."quote_items" TO authenticated;
GRANT UPDATE ON TABLE public."quote_items" TO authenticated;
GRANT DELETE ON TABLE public."quotes" TO anon;
GRANT INSERT ON TABLE public."quotes" TO anon;
GRANT SELECT ON TABLE public."quotes" TO anon;
GRANT UPDATE ON TABLE public."quotes" TO anon;
GRANT DELETE ON TABLE public."quotes" TO authenticated;
GRANT INSERT ON TABLE public."quotes" TO authenticated;
GRANT SELECT ON TABLE public."quotes" TO authenticated;
GRANT UPDATE ON TABLE public."quotes" TO authenticated;
GRANT DELETE ON TABLE public."rep_commission_settings" TO anon;
GRANT INSERT ON TABLE public."rep_commission_settings" TO anon;
GRANT SELECT ON TABLE public."rep_commission_settings" TO anon;
GRANT UPDATE ON TABLE public."rep_commission_settings" TO anon;
GRANT DELETE ON TABLE public."rep_commission_settings" TO authenticated;
GRANT INSERT ON TABLE public."rep_commission_settings" TO authenticated;
GRANT SELECT ON TABLE public."rep_commission_settings" TO authenticated;
GRANT UPDATE ON TABLE public."rep_commission_settings" TO authenticated;
GRANT DELETE ON TABLE public."sale_deletion_log" TO anon;
GRANT INSERT ON TABLE public."sale_deletion_log" TO anon;
GRANT SELECT ON TABLE public."sale_deletion_log" TO anon;
GRANT UPDATE ON TABLE public."sale_deletion_log" TO anon;
GRANT DELETE ON TABLE public."sale_deletion_log" TO authenticated;
GRANT INSERT ON TABLE public."sale_deletion_log" TO authenticated;
GRANT SELECT ON TABLE public."sale_deletion_log" TO authenticated;
GRANT UPDATE ON TABLE public."sale_deletion_log" TO authenticated;
GRANT DELETE ON TABLE public."sales_representatives" TO anon;
GRANT INSERT ON TABLE public."sales_representatives" TO anon;
GRANT SELECT ON TABLE public."sales_representatives" TO anon;
GRANT UPDATE ON TABLE public."sales_representatives" TO anon;
GRANT DELETE ON TABLE public."sales_representatives" TO authenticated;
GRANT INSERT ON TABLE public."sales_representatives" TO authenticated;
GRANT SELECT ON TABLE public."sales_representatives" TO authenticated;
GRANT UPDATE ON TABLE public."sales_representatives" TO authenticated;
GRANT SELECT ON TABLE public."sales_vat_settings" TO authenticated;
GRANT DELETE ON TABLE public."shop_settings" TO anon;
GRANT INSERT ON TABLE public."shop_settings" TO anon;
GRANT SELECT ON TABLE public."shop_settings" TO anon;
GRANT UPDATE ON TABLE public."shop_settings" TO anon;
GRANT DELETE ON TABLE public."shop_settings" TO authenticated;
GRANT INSERT ON TABLE public."shop_settings" TO authenticated;
GRANT SELECT ON TABLE public."shop_settings" TO authenticated;
GRANT UPDATE ON TABLE public."shop_settings" TO authenticated;
GRANT DELETE ON TABLE public."site_change_log" TO anon;
GRANT INSERT ON TABLE public."site_change_log" TO anon;
GRANT SELECT ON TABLE public."site_change_log" TO anon;
GRANT UPDATE ON TABLE public."site_change_log" TO anon;
GRANT DELETE ON TABLE public."site_change_log" TO authenticated;
GRANT INSERT ON TABLE public."site_change_log" TO authenticated;
GRANT SELECT ON TABLE public."site_change_log" TO authenticated;
GRANT UPDATE ON TABLE public."site_change_log" TO authenticated;
GRANT DELETE ON TABLE public."stock_documents" TO anon;
GRANT INSERT ON TABLE public."stock_documents" TO anon;
GRANT SELECT ON TABLE public."stock_documents" TO anon;
GRANT UPDATE ON TABLE public."stock_documents" TO anon;
GRANT DELETE ON TABLE public."stock_documents" TO authenticated;
GRANT INSERT ON TABLE public."stock_documents" TO authenticated;
GRANT SELECT ON TABLE public."stock_documents" TO authenticated;
GRANT UPDATE ON TABLE public."stock_documents" TO authenticated;
GRANT DELETE ON TABLE public."subscription_action_tokens" TO anon;
GRANT INSERT ON TABLE public."subscription_action_tokens" TO anon;
GRANT SELECT ON TABLE public."subscription_action_tokens" TO anon;
GRANT UPDATE ON TABLE public."subscription_action_tokens" TO anon;
GRANT DELETE ON TABLE public."subscription_action_tokens" TO authenticated;
GRANT INSERT ON TABLE public."subscription_action_tokens" TO authenticated;
GRANT SELECT ON TABLE public."subscription_action_tokens" TO authenticated;
GRANT UPDATE ON TABLE public."subscription_action_tokens" TO authenticated;
GRANT DELETE ON TABLE public."supplier_order_items" TO anon;
GRANT INSERT ON TABLE public."supplier_order_items" TO anon;
GRANT SELECT ON TABLE public."supplier_order_items" TO anon;
GRANT UPDATE ON TABLE public."supplier_order_items" TO anon;
GRANT DELETE ON TABLE public."supplier_order_items" TO authenticated;
GRANT INSERT ON TABLE public."supplier_order_items" TO authenticated;
GRANT SELECT ON TABLE public."supplier_order_items" TO authenticated;
GRANT UPDATE ON TABLE public."supplier_order_items" TO authenticated;
GRANT DELETE ON TABLE public."supplier_order_receptions" TO anon;
GRANT INSERT ON TABLE public."supplier_order_receptions" TO anon;
GRANT SELECT ON TABLE public."supplier_order_receptions" TO anon;
GRANT UPDATE ON TABLE public."supplier_order_receptions" TO anon;
GRANT DELETE ON TABLE public."supplier_order_receptions" TO authenticated;
GRANT INSERT ON TABLE public."supplier_order_receptions" TO authenticated;
GRANT SELECT ON TABLE public."supplier_order_receptions" TO authenticated;
GRANT UPDATE ON TABLE public."supplier_order_receptions" TO authenticated;
GRANT DELETE ON TABLE public."supplier_orders" TO anon;
GRANT INSERT ON TABLE public."supplier_orders" TO anon;
GRANT SELECT ON TABLE public."supplier_orders" TO anon;
GRANT UPDATE ON TABLE public."supplier_orders" TO anon;
GRANT DELETE ON TABLE public."supplier_orders" TO authenticated;
GRANT INSERT ON TABLE public."supplier_orders" TO authenticated;
GRANT SELECT ON TABLE public."supplier_orders" TO authenticated;
GRANT UPDATE ON TABLE public."supplier_orders" TO authenticated;
GRANT DELETE ON TABLE public."supplier_payments" TO authenticated;
GRANT INSERT ON TABLE public."supplier_payments" TO authenticated;
GRANT SELECT ON TABLE public."supplier_payments" TO authenticated;
GRANT UPDATE ON TABLE public."supplier_payments" TO authenticated;
GRANT DELETE ON TABLE public."suppliers" TO authenticated;
GRANT INSERT ON TABLE public."suppliers" TO authenticated;
GRANT SELECT ON TABLE public."suppliers" TO authenticated;
GRANT UPDATE ON TABLE public."suppliers" TO authenticated;
GRANT DELETE ON TABLE public."tenant_message_reads" TO anon;
GRANT INSERT ON TABLE public."tenant_message_reads" TO anon;
GRANT SELECT ON TABLE public."tenant_message_reads" TO anon;
GRANT UPDATE ON TABLE public."tenant_message_reads" TO anon;
GRANT DELETE ON TABLE public."tenant_message_reads" TO authenticated;
GRANT INSERT ON TABLE public."tenant_message_reads" TO authenticated;
GRANT SELECT ON TABLE public."tenant_message_reads" TO authenticated;
GRANT UPDATE ON TABLE public."tenant_message_reads" TO authenticated;
GRANT DELETE ON TABLE public."tenant_messages" TO anon;
GRANT INSERT ON TABLE public."tenant_messages" TO anon;
GRANT SELECT ON TABLE public."tenant_messages" TO anon;
GRANT UPDATE ON TABLE public."tenant_messages" TO anon;
GRANT DELETE ON TABLE public."tenant_messages" TO authenticated;
GRANT INSERT ON TABLE public."tenant_messages" TO authenticated;
GRANT SELECT ON TABLE public."tenant_messages" TO authenticated;
GRANT UPDATE ON TABLE public."tenant_messages" TO authenticated;
GRANT DELETE ON TABLE public."tenant_subscriptions" TO anon;
GRANT INSERT ON TABLE public."tenant_subscriptions" TO anon;
GRANT SELECT ON TABLE public."tenant_subscriptions" TO anon;
GRANT UPDATE ON TABLE public."tenant_subscriptions" TO anon;
GRANT DELETE ON TABLE public."tenant_subscriptions" TO authenticated;
GRANT INSERT ON TABLE public."tenant_subscriptions" TO authenticated;
GRANT SELECT ON TABLE public."tenant_subscriptions" TO authenticated;
GRANT UPDATE ON TABLE public."tenant_subscriptions" TO authenticated;
GRANT DELETE ON TABLE public."vault_movements" TO authenticated;
GRANT INSERT ON TABLE public."vault_movements" TO authenticated;
GRANT SELECT ON TABLE public."vault_movements" TO authenticated;
GRANT UPDATE ON TABLE public."vault_movements" TO authenticated;
GRANT DELETE ON TABLE public."vaults" TO authenticated;
GRANT INSERT ON TABLE public."vaults" TO authenticated;
GRANT SELECT ON TABLE public."vaults" TO authenticated;
GRANT UPDATE ON TABLE public."vaults" TO authenticated;
GRANT DELETE ON TABLE public."vehicle_brands" TO anon;
GRANT INSERT ON TABLE public."vehicle_brands" TO anon;
GRANT SELECT ON TABLE public."vehicle_brands" TO anon;
GRANT UPDATE ON TABLE public."vehicle_brands" TO anon;
GRANT DELETE ON TABLE public."vehicle_brands" TO authenticated;
GRANT INSERT ON TABLE public."vehicle_brands" TO authenticated;
GRANT SELECT ON TABLE public."vehicle_brands" TO authenticated;
GRANT UPDATE ON TABLE public."vehicle_brands" TO authenticated;
GRANT DELETE ON TABLE public."vehicle_models" TO anon;
GRANT INSERT ON TABLE public."vehicle_models" TO anon;
GRANT SELECT ON TABLE public."vehicle_models" TO anon;
GRANT UPDATE ON TABLE public."vehicle_models" TO anon;
GRANT DELETE ON TABLE public."vehicle_models" TO authenticated;
GRANT INSERT ON TABLE public."vehicle_models" TO authenticated;
GRANT SELECT ON TABLE public."vehicle_models" TO authenticated;
GRANT UPDATE ON TABLE public."vehicle_models" TO authenticated;
