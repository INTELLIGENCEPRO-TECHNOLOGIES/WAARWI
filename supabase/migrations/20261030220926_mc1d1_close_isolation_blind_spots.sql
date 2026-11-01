/*
# MC1-D.1 — Fermeture des angles morts d'isolation multi-caisse

Forward-only. Aucune donnée métier modifiée, aucun tenant activé, aucune permission changée.
Toutes les règles ajoutées sont sans effet tant que `multi_cash_enabled = false` pour le tenant.

1. Nouvelles colonnes
   - `supplier_payments.cash_session_id` (uuid, NULL, FK cash_sessions ON DELETE SET NULL, indexée) :
     session de caisse qui a financé un règlement fournisseur « depuis la caisse ».
     Historique laissé à NULL (aucun rapprochement par montant ou date). Sauvegarde/restauration :
     prise en charge automatiquement (registre dynamique, jsonb_populate_record).

2. Sécurité (politiques RESTRICTIVE conditionnelles, réutilisant les helpers MC1-D)
   - supplier_payments : trigger `trg_cs_row_guard` + politiques select/insert/update/delete.
     Ligne liée à une session : visible si la session est lisible, modifiable seulement dans sa propre session.
     Ligne sans session et financée par la caisse (historique non attribuable) : élevé du magasin uniquement.
     Ligne sans session et non financée par la caisse (crédit, coffre, banque) : comportement historique.
     En mode activé, impossible d'insérer un règlement « caisse » sans session.
   - customer_prepayments : politiques select/insert/update (session lisible / propre session ; sans session : historique).
   - vault_movements : politique select (mouvement lié à une session : session lisible ; sinon historique).

3. Fonctions
   - Nouveaux helpers internes : `_cs_sale_readable`, `_cs_return_readable`, `_cs_assert_sale_usable`,
     `_cs_assert_return_usable` (non exécutables par les clients).
   - `rpc_paginated_returns` (DEFINER) : filtre explicite identique à la RLS de sale_returns en mode activé.
   - `get_vault_report` (DEFINER) : pour un non-élevé en mode activé, détail, entrées/sorties, ventilation et
     nombre de mouvements excluent les mouvements liés à la session d'un collègue ; soldes du coffre inchangés.
   - `register_supplier_payment` : renseigne `cash_session_id` pour les règlements depuis la caisse et
     vérifie en mode activé que la session est la session personnelle opérationnelle.
   - `process_return_as_cash` : en mode activé, plus de recherche de « la dernière session ouverte du magasin » ;
     session personnelle obligatoire et vérifiée ; retour d'un collègue refusé.
   - Garde « opération d'un collègue » ajoutée en tête des RPC DEFINER agissant sur une vente
     (règlement, annulation, modification, suppression, retour, avoir, quantités retournées).
   Signatures, paramètres, formats, tris et droits inchangés.

4. Notes
   1. Mode désactivé : chaque garde retourne immédiatement, comportement strictement historique.
   2. Utilisateur élevé (admin ou manager avec manage+view) : lit les sessions des magasins supervisés,
      mais n'encaisse jamais dans la session d'un autre (contrôle `_cs_assert_operational`).
*/

-- 1. supplier_payments.cash_session_id
ALTER TABLE public.supplier_payments
  ADD COLUMN IF NOT EXISTS cash_session_id uuid NULL REFERENCES public.cash_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS supplier_payments_cash_session_id_idx
  ON public.supplier_payments (cash_session_id) WHERE cash_session_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_cs_row_guard ON public.supplier_payments;
CREATE TRIGGER trg_cs_row_guard BEFORE INSERT OR UPDATE OF cash_session_id ON public.supplier_payments
  FOR EACH ROW EXECUTE FUNCTION public._trg_cs_row_guard('cash_session_id');

-- 2. Politiques restrictives
DROP POLICY IF EXISTS "mc1d1 select" ON public.supplier_payments;
CREATE POLICY "mc1d1 select" ON public.supplier_payments AS RESTRICTIVE FOR SELECT TO authenticated
USING ((SELECT NOT public._cs_multi_current()) OR CASE
  WHEN cash_session_id IS NOT NULL THEN cash_session_id IN (SELECT cs.id FROM public.cash_sessions cs)
  WHEN funding_source = 'cash' THEN (site_id = ANY ((SELECT public._cs_supervised_site_ids())::uuid[]))
    OR (site_id IS NULL AND (SELECT public._cs_is_elevated()))
  ELSE true END);

DROP POLICY IF EXISTS "mc1d1 insert" ON public.supplier_payments;
CREATE POLICY "mc1d1 insert" ON public.supplier_payments AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK ((SELECT NOT public._cs_multi_current()) OR CASE
  WHEN cash_session_id IS NOT NULL THEN cash_session_id IN (SELECT cs.id FROM public.cash_sessions cs WHERE cs.user_id = auth.uid())
  ELSE funding_source IS DISTINCT FROM 'cash' END);

DROP POLICY IF EXISTS "mc1d1 update" ON public.supplier_payments;
CREATE POLICY "mc1d1 update" ON public.supplier_payments AS RESTRICTIVE FOR UPDATE TO authenticated
USING ((SELECT NOT public._cs_multi_current()) OR CASE
  WHEN cash_session_id IS NOT NULL THEN cash_session_id IN (SELECT cs.id FROM public.cash_sessions cs WHERE cs.user_id = auth.uid())
  WHEN funding_source = 'cash' THEN (site_id = ANY ((SELECT public._cs_supervised_site_ids())::uuid[]))
    OR (site_id IS NULL AND (SELECT public._cs_is_elevated()))
  ELSE true END)
WITH CHECK ((SELECT NOT public._cs_multi_current()) OR CASE
  WHEN cash_session_id IS NOT NULL THEN cash_session_id IN (SELECT cs.id FROM public.cash_sessions cs WHERE cs.user_id = auth.uid())
  WHEN funding_source = 'cash' THEN (site_id = ANY ((SELECT public._cs_supervised_site_ids())::uuid[]))
    OR (site_id IS NULL AND (SELECT public._cs_is_elevated()))
  ELSE true END);

DROP POLICY IF EXISTS "mc1d1 delete" ON public.supplier_payments;
CREATE POLICY "mc1d1 delete" ON public.supplier_payments AS RESTRICTIVE FOR DELETE TO authenticated
USING ((SELECT NOT public._cs_multi_current()) OR CASE
  WHEN cash_session_id IS NOT NULL THEN cash_session_id IN (SELECT cs.id FROM public.cash_sessions cs WHERE cs.user_id = auth.uid())
  WHEN funding_source = 'cash' THEN (site_id = ANY ((SELECT public._cs_supervised_site_ids())::uuid[]))
    OR (site_id IS NULL AND (SELECT public._cs_is_elevated()))
  ELSE true END);

DROP POLICY IF EXISTS "mc1d1 select" ON public.customer_prepayments;
CREATE POLICY "mc1d1 select" ON public.customer_prepayments AS RESTRICTIVE FOR SELECT TO authenticated
USING ((SELECT NOT public._cs_multi_current()) OR cash_session_id IS NULL
  OR cash_session_id IN (SELECT cs.id FROM public.cash_sessions cs));

DROP POLICY IF EXISTS "mc1d1 insert" ON public.customer_prepayments;
CREATE POLICY "mc1d1 insert" ON public.customer_prepayments AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK ((SELECT NOT public._cs_multi_current()) OR cash_session_id IS NULL
  OR cash_session_id IN (SELECT cs.id FROM public.cash_sessions cs WHERE cs.user_id = auth.uid()));

DROP POLICY IF EXISTS "mc1d1 update" ON public.customer_prepayments;
CREATE POLICY "mc1d1 update" ON public.customer_prepayments AS RESTRICTIVE FOR UPDATE TO authenticated
USING ((SELECT NOT public._cs_multi_current()) OR cash_session_id IS NULL
  OR cash_session_id IN (SELECT cs.id FROM public.cash_sessions cs WHERE cs.user_id = auth.uid()))
WITH CHECK ((SELECT NOT public._cs_multi_current()) OR cash_session_id IS NULL
  OR cash_session_id IN (SELECT cs.id FROM public.cash_sessions cs WHERE cs.user_id = auth.uid()));

DROP POLICY IF EXISTS "mc1d1 select" ON public.vault_movements;
CREATE POLICY "mc1d1 select" ON public.vault_movements AS RESTRICTIVE FOR SELECT TO authenticated
USING ((SELECT NOT public._cs_multi_current()) OR cash_session_id IS NULL
  OR cash_session_id IN (SELECT cs.id FROM public.cash_sessions cs));

-- 3. Helpers internes
CREATE OR REPLACE FUNCTION public._cs_sale_readable(p_sale_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
SELECT COALESCE((
  SELECT CASE
    WHEN auth.uid() IS NULL OR NOT public._cs_multi_enabled(s.tenant_id) THEN true
    WHEN s.cash_session_id IS NOT NULL THEN EXISTS (
      SELECT 1 FROM public.cash_sessions cs
      WHERE cs.id = s.cash_session_id AND cs.tenant_id = s.tenant_id
        AND (cs.user_id = auth.uid() OR cs.site_id = ANY (public._cs_supervised_site_ids())))
    ELSE (s.user_id = auth.uid() OR s.site_id = ANY (public._cs_supervised_site_ids()))
  END
  FROM public.sales s WHERE s.id = p_sale_id), true);
$f$;

CREATE OR REPLACE FUNCTION public._cs_return_readable(p_return_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
SELECT COALESCE((
  SELECT CASE
    WHEN auth.uid() IS NULL OR NOT public._cs_multi_enabled(r.tenant_id) THEN true
    ELSE (r.cash_session_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.cash_sessions cs WHERE cs.id = r.cash_session_id AND cs.tenant_id = r.tenant_id
              AND (cs.user_id = auth.uid() OR cs.site_id = ANY (public._cs_supervised_site_ids()))))
      OR (r.refund_cash_session_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.cash_sessions cs WHERE cs.id = r.refund_cash_session_id AND cs.tenant_id = r.tenant_id
              AND (cs.user_id = auth.uid() OR cs.site_id = ANY (public._cs_supervised_site_ids()))))
      OR (r.cash_session_id IS NULL AND r.refund_cash_session_id IS NULL
          AND (r.user_id = auth.uid() OR r.site_id = ANY (public._cs_supervised_site_ids())))
  END
  FROM public.sale_returns r WHERE r.id = p_return_id), true);
$f$;

CREATE OR REPLACE FUNCTION public._cs_assert_sale_usable(p_sale_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
BEGIN
  IF p_sale_id IS NOT NULL AND NOT public._cs_sale_readable(p_sale_id) THEN
    RAISE EXCEPTION 'Cette opération est rattachée à la session de caisse d''un autre opérateur' USING ERRCODE = '42501';
  END IF;
END;
$f$;

CREATE OR REPLACE FUNCTION public._cs_assert_return_usable(p_return_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
BEGIN
  IF p_return_id IS NOT NULL AND NOT public._cs_return_readable(p_return_id) THEN
    RAISE EXCEPTION 'Cette opération est rattachée à la session de caisse d''un autre opérateur' USING ERRCODE = '42501';
  END IF;
END;
$f$;

REVOKE EXECUTE ON FUNCTION public._cs_sale_readable(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._cs_return_readable(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._cs_assert_sale_usable(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._cs_assert_return_usable(uuid) FROM PUBLIC, anon, authenticated;

-- 4. process_return_as_cash : session personnelle obligatoire en mode activé
CREATE OR REPLACE FUNCTION public.process_return_as_cash(p_return_id uuid, p_session_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_tenant_id uuid;
v_ret record;
v_session record;
v_already_refunded numeric;
v_multi boolean;
BEGIN
v_tenant_id := current_tenant_id();
IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;
v_multi := public._cs_multi_enabled(v_tenant_id);

SELECT * INTO v_ret FROM sale_returns
WHERE id = p_return_id AND tenant_id = v_tenant_id;
IF v_ret.id IS NULL THEN RAISE EXCEPTION 'Retour introuvable'; END IF;
IF v_multi THEN PERFORM public._cs_assert_return_usable(p_return_id); END IF;
IF v_ret.status NOT IN ('pending', 'approved') THEN
RAISE EXCEPTION 'Ce retour ne peut pas être remboursé (statut: %)', v_ret.status;
END IF;

-- Double-refund guard
SELECT COALESCE(SUM(cm.amount), 0) INTO v_already_refunded
FROM cash_movements cm
WHERE cm.sale_return_id = p_return_id AND cm.kind = 'refund';
IF v_already_refunded >= COALESCE(v_ret.total, 0) THEN
RAISE EXCEPTION 'Ce retour a déjà été remboursé';
END IF;

IF v_multi THEN
IF p_session_id IS NULL THEN
RAISE EXCEPTION 'Ouvrez votre caisse avant d''enregistrer cet encaissement.' USING ERRCODE = '42501';
END IF;
PERFORM public._cs_assert_operational(p_session_id, v_tenant_id, v_ret.site_id);
ELSIF p_session_id IS NULL AND v_ret.site_id IS NOT NULL THEN
-- Try to find open session if not provided (historical single-cash behavior)
SELECT id INTO p_session_id FROM cash_sessions
WHERE tenant_id = v_tenant_id AND site_id = v_ret.site_id AND status = 'open'
ORDER BY opened_at DESC LIMIT 1;
END IF;

-- Record cash movement if session is available
IF p_session_id IS NOT NULL THEN
SELECT * INTO v_session FROM cash_sessions WHERE id = p_session_id AND tenant_id = v_tenant_id;
IF v_session.id IS NOT NULL THEN
INSERT INTO cash_movements (
tenant_id, site_id, cash_session_id, kind, amount, reason, reference, sale_return_id, user_id
) VALUES (
v_tenant_id, v_ret.site_id, p_session_id, 'refund',
v_ret.total,
'Remboursement retour ' || v_ret.return_number,
v_ret.return_number,
p_return_id,
CASE WHEN v_multi THEN auth.uid() END
);
UPDATE cash_sessions
SET theoretical_amount = GREATEST(0, COALESCE(theoretical_amount, 0) - v_ret.total)
WHERE id = p_session_id;
END IF;
END IF;

-- Mark return as approved/refunded
UPDATE sale_returns
SET status = 'approved',
refund_method = 'cash',
refund_cash_session_id = p_session_id,
refunded_at = now()
WHERE id = p_return_id;

RETURN jsonb_build_object('success', true, 'amount', v_ret.total);
END;
$function$;

-- 5. get_sale_returned_quantities : garde de lecture
CREATE OR REPLACE FUNCTION public.get_sale_returned_quantities(p_sale_id uuid)
 RETURNS TABLE(article_id uuid, total_returned bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT sri.article_id, SUM(sri.quantity) AS total_returned
FROM sale_return_items sri
JOIN sale_returns sr ON sr.id = sri.return_id
WHERE sr.sale_id = p_sale_id
AND sr.status = 'approved'
AND public._cs_sale_readable(p_sale_id)
GROUP BY sri.article_id;
$function$;

-- 6. Correctifs ciblés des fonctions existantes (remplacements vérifiés, échec si le texte attendu est absent)
DO $mig$
DECLARE
  v_patch record;
  v_def text;
  v_n int;
  v_pos int;
BEGIN
  FOR v_patch IN
    SELECT * FROM (VALUES
      (1, 'public.register_supplier_payment(uuid,uuid,text,numeric,text,uuid,uuid,boolean)',
       'INSERT INTO supplier_payments (tenant_id, supplier_id, order_id, payment_method_id, method_name, amount, reference, funding_source, site_id)',
       'INSERT INTO supplier_payments (tenant_id, supplier_id, order_id, payment_method_id, method_name, amount, reference, funding_source, site_id, cash_session_id)',
       3, 'all'),
      (2, 'public.register_supplier_payment(uuid,uuid,text,numeric,text,uuid,uuid,boolean)',
       'CASE WHEN p_from_cash THEN v_site_id ELSE NULL END);',
       'CASE WHEN p_from_cash THEN v_site_id ELSE NULL END, CASE WHEN p_from_cash THEN p_cash_session_id ELSE NULL END);',
       3, 'all'),
      (3, 'public.register_supplier_payment(uuid,uuid,text,numeric,text,uuid,uuid,boolean)',
       E'v_site_id := v_session.site_id;\nEND IF;',
       E'v_site_id := v_session.site_id;\nIF public._cs_multi_enabled(v_tenant_id) THEN\nPERFORM public._cs_assert_operational(p_cash_session_id, v_tenant_id, v_session.site_id);\nEND IF;\nEND IF;',
       1, 'all'),
      (4, 'public.rpc_paginated_returns(uuid,uuid,integer,timestamptz,uuid,text,text,uuid,timestamptz,timestamptz,numeric,numeric,text)',
       E'v_accessible_sites uuid[];\n',
       E'v_accessible_sites uuid[];\nv_cs_uid text;\nv_cs_sup text;\n',
       1, 'all'),
      (5, 'public.rpc_paginated_returns(uuid,uuid,integer,timestamptz,uuid,text,text,uuid,timestamptz,timestamptz,numeric,numeric,text)',
       $r$v_where := v_where || ' AND r.site_id = ANY(' || _uuid_array_literal(v_accessible_sites) || ')';
END IF;
$r$,
       $r$v_where := v_where || ' AND r.site_id = ANY(' || _uuid_array_literal(v_accessible_sites) || ')';
END IF;
IF public._cs_multi_current() THEN
v_cs_uid := quote_literal(COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid));
v_cs_sup := _uuid_array_literal(public._cs_supervised_site_ids());
v_where := v_where || ' AND ((r.cash_session_id IS NOT NULL AND r.cash_session_id IN (SELECT cs.id FROM cash_sessions cs WHERE cs.tenant_id = r.tenant_id AND (cs.user_id = ' || v_cs_uid || ' OR cs.site_id = ANY(' || v_cs_sup || '))))'
|| ' OR (r.refund_cash_session_id IS NOT NULL AND r.refund_cash_session_id IN (SELECT cs.id FROM cash_sessions cs WHERE cs.tenant_id = r.tenant_id AND (cs.user_id = ' || v_cs_uid || ' OR cs.site_id = ANY(' || v_cs_sup || '))))'
|| ' OR (r.cash_session_id IS NULL AND r.refund_cash_session_id IS NULL AND (r.user_id = ' || v_cs_uid || ' OR r.site_id = ANY(' || v_cs_sup || '))))';
END IF;
$r$,
       1, 'all'),
      (6, 'public.get_vault_report(uuid,timestamptz,timestamptz,timestamptz,integer,integer)',
       E'v_breakdown jsonb;\nBEGIN\n',
       E'v_breakdown jsonb;\nv_cs_hide boolean;\nBEGIN\nv_cs_hide := public._cs_multi_current() AND NOT public._cs_is_elevated();\n',
       1, 'all'),
      (7, 'public.get_vault_report(uuid,timestamptz,timestamptz,timestamptz,integer,integer)',
       E'\nAND effective_at < v_as_of',
       E'\nAND effective_at < v_as_of\nAND (NOT v_cs_hide OR cash_session_id IS NULL OR cash_session_id IN (SELECT cs.id FROM cash_sessions cs WHERE cs.user_id = auth.uid()))',
       3, 'all'),
      (8, 'public.get_vault_report(uuid,timestamptz,timestamptz,timestamptz,integer,integer)',
       E'\nAND vm.effective_at < v_as_of',
       E'\nAND vm.effective_at < v_as_of\nAND (NOT v_cs_hide OR vm.cash_session_id IS NULL OR vm.cash_session_id IN (SELECT cs.id FROM cash_sessions cs WHERE cs.user_id = auth.uid()))',
       1, 'all'),
      (10, 'public.register_sale_payment(uuid,uuid,text,numeric,text,uuid)', E'\nBEGIN\n', E'\nBEGIN\nPERFORM public._cs_assert_sale_usable(p_sale_id);\n', 1, 'first'),
      (11, 'public.cancel_sale(uuid,uuid)', E'\nBEGIN\n', E'\nBEGIN\nPERFORM public._cs_assert_sale_usable(p_sale_id);\n', 1, 'first'),
      (12, 'public.cancel_sale(uuid,uuid,text,text,uuid)', E'\nBEGIN\n', E'\nBEGIN\nPERFORM public._cs_assert_sale_usable(p_sale_id);\n', 1, 'first'),
      (13, 'public.update_sale_items_and_totals(uuid,uuid,jsonb,uuid,jsonb)', E'\nBEGIN\n', E'\nBEGIN\nPERFORM public._cs_assert_sale_usable(p_sale_id);\n', 1, 'first'),
      (14, 'public.delete_sale_and_recalculate(uuid,uuid)', E'\nBEGIN\n', E'\nBEGIN\nPERFORM public._cs_assert_sale_usable(p_sale_id);\n', 1, 'first'),
      (15, 'public.delete_sale_and_recalculate(uuid,uuid,text)', E'\nBEGIN\n', E'\nBEGIN\nPERFORM public._cs_assert_sale_usable(p_sale_id);\n', 1, 'first'),
      (16, 'public.apply_credit_to_sale(uuid,uuid,numeric)', E'\nBEGIN\n', E'\nBEGIN\nPERFORM public._cs_assert_sale_usable(p_sale_id);\n', 1, 'first'),
      (17, 'public.insert_billing_sale_items(uuid,jsonb)', E'\nBEGIN\n', E'\nBEGIN\nPERFORM public._cs_assert_sale_usable(p_sale_id);\n', 1, 'first'),
      (18, 'public.discard_failed_billing_sale(uuid)', E'\nBEGIN\n', E'\nBEGIN\nPERFORM public._cs_assert_sale_usable(p_sale_id);\n', 1, 'first'),
      (19, 'public.register_initial_billing_payments(uuid,uuid,jsonb)', E'\nBEGIN\n', E'\nBEGIN\nPERFORM public._cs_assert_sale_usable(p_sale_id);\n', 1, 'first'),
      (20, 'public.process_sale_return(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text)', E'\nBEGIN\n', E'\nBEGIN\nPERFORM public._cs_assert_sale_usable(p_sale_id);\n', 1, 'first'),
      (21, 'public.register_customer_payment(uuid,uuid,text,numeric,text,uuid,uuid)', E'\nBEGIN\n', E'\nBEGIN\nPERFORM public._cs_assert_sale_usable(p_sale_id);\n', 1, 'first'),
      (22, 'public.sale_has_effects(uuid)', E'\nBEGIN\n', E'\nBEGIN\nPERFORM public._cs_assert_sale_usable(p_sale_id);\n', 1, 'first'),
      (23, 'public.approve_return_as_avoir(uuid)', E'\nBEGIN\n', E'\nBEGIN\nPERFORM public._cs_assert_return_usable(p_return_id);\n', 1, 'first')
    ) AS t(ord, fn, src, dst, expected, mode)
    ORDER BY ord
  LOOP
    v_def := pg_get_functiondef(v_patch.fn::regprocedure);
    IF position(CASE WHEN v_patch.mode = 'first' THEN '_cs_assert_' ELSE v_patch.dst END IN v_def) > 0
       AND (v_patch.mode = 'first' OR position(v_patch.src IN v_def) = 0) THEN
      CONTINUE;
    END IF;
    v_n := (length(v_def) - length(replace(v_def, v_patch.src, ''))) / length(v_patch.src);
    IF v_patch.mode = 'first' THEN
      IF v_n < 1 THEN RAISE EXCEPTION 'MC1-D.1 patch % : motif absent dans %', v_patch.ord, v_patch.fn; END IF;
      v_pos := position(v_patch.src IN v_def);
      v_def := overlay(v_def placing v_patch.dst from v_pos for length(v_patch.src));
    ELSE
      IF v_n <> v_patch.expected THEN
        RAISE EXCEPTION 'MC1-D.1 patch % : % occurrence(s) au lieu de % dans %', v_patch.ord, v_n, v_patch.expected, v_patch.fn;
      END IF;
      v_def := replace(v_def, v_patch.src, v_patch.dst);
    END IF;
    EXECUTE v_def;
  END LOOP;
END
$mig$;
