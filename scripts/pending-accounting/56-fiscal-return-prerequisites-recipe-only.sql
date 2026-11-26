-- Branche recette uniquement, ne pas rejouer en production.
CREATE OR REPLACE FUNCTION public._prepare_vat_sale_return(p_sale_id uuid, p_site_id uuid, p_items jsonb, p_reason text, p_restock boolean, p_request_id text, p_cash_session_id uuid)
 RETURNS sale_returns
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
  v_invoice public.sales;
  v_result public.sale_returns;
  v_line public.sale_items;
  v_item record;
  v_prior record;
  v_remaining numeric;
  v_net numeric;
  v_vat numeric;
  v_ttc numeric;
  v_total_ht numeric := 0;
  v_total_vat numeric := 0;
  v_lines jsonb := '[]';
BEGIN
  SELECT s.* INTO v_invoice FROM public.sales s
  WHERE s.id = p_sale_id AND s.tenant_id = v_tenant_id AND s.site_id = p_site_id
  FOR UPDATE;
  IF auth.uid() IS NULL OR NOT FOUND OR public.current_user_can_access_site(p_site_id) IS DISTINCT FROM true
     OR v_invoice.vat_net_amount IS NULL OR v_invoice.status NOT IN ('paid', 'partial', 'validated')
     OR v_invoice.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Facture émise avec TVA introuvable dans ce magasin.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._cs_assert_sale_usable(p_sale_id);
  IF EXISTS (SELECT 1 FROM public.ipm_ventes i WHERE i.sale_id = p_sale_id AND i.tenant_id = v_tenant_id) THEN
    RAISE EXCEPTION 'Cette facture relève de l’IPM. La part de chaque payeur doit être traitée avant d’émettre l’avoir.';
  END IF;
  IF p_request_id IS NULL OR btrim(p_request_id) = '' OR length(p_request_id) > 160 THEN
    RAISE EXCEPTION 'Référence de traitement de l’avoir invalide.';
  END IF;
  SELECT * INTO v_result FROM public.sale_returns r WHERE r.tenant_id = v_tenant_id AND r.request_id = p_request_id;
  IF FOUND THEN
    IF v_result.sale_id IS DISTINCT FROM p_sale_id OR v_result.site_id IS DISTINCT FROM p_site_id
      OR v_result.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Référence de traitement déjà utilisée.'; END IF;
    RETURN v_result;
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Sélectionnez les lignes à retourner.';
  END IF;

  FOR v_item IN
    SELECT (i->>'sale_item_id')::uuid AS id, sum((i->>'quantity')::numeric) AS quantity
    FROM jsonb_array_elements(p_items) i GROUP BY 1 ORDER BY 1
  LOOP
    SELECT i.* INTO v_line FROM public.sale_items i
    WHERE i.id = v_item.id AND i.sale_id = p_sale_id AND i.tenant_id = v_tenant_id;
    IF NOT FOUND OR v_line.vat_net_amount IS NULL OR v_item.quantity IS NULL OR v_item.quantity <= 0
       OR v_item.quantity IN ('NaN'::numeric, 'Infinity'::numeric) THEN
      RAISE EXCEPTION 'Ligne ou quantité de retour invalide.';
    END IF;

    SELECT COALESCE(sum(i.quantity), 0) AS quantity, COALESCE(sum(i.vat_net_amount), 0) AS net,
      COALESCE(sum(i.vat_amount), 0) AS vat INTO v_prior
    FROM public.sale_return_items i JOIN public.sale_returns r ON r.id = i.return_id AND r.tenant_id = i.tenant_id
    WHERE i.tenant_id = v_tenant_id AND i.sale_item_id = v_line.id AND r.status IN ('approved', 'pending');
    v_remaining := v_line.quantity - v_prior.quantity;
    IF v_remaining < v_item.quantity OR v_prior.net > v_line.vat_net_amount OR v_prior.vat > v_line.vat_amount THEN
      RAISE EXCEPTION 'Quantité ou montant disponible dépassé pour %.', v_line.name;
    END IF;
    v_ttc := round((v_line.vat_net_amount - v_prior.net + v_line.vat_amount - v_prior.vat)
      * v_item.quantity / v_remaining, 2);
    v_vat := greatest(v_ttc - (v_line.vat_net_amount - v_prior.net),
      least(v_ttc, v_line.vat_amount - v_prior.vat, round((v_line.vat_amount - v_prior.vat) * v_item.quantity / v_remaining, 2)));
    v_net := v_ttc - v_vat;
    v_total_ht := v_total_ht + v_net;
    v_total_vat := v_total_vat + v_vat;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'id', v_line.id, 'article', v_line.article_id, 'name', v_line.name,
      'quantity', v_item.quantity, 'price', v_line.unit_price, 'cost', v_line.purchase_cost,
      'net', v_net, 'vat', v_vat, 'rate', v_line.vat_rate
    ));
  END LOOP;

  IF v_total_ht + v_total_vat <= 0 THEN
    RAISE EXCEPTION 'L’avoir doit avoir un montant strictement positif.';
  END IF;

  INSERT INTO public.sale_returns (
    tenant_id, site_id, sale_id, customer_id, user_id, cash_session_id, return_number,
    total, vat_net_amount, vat_amount, refund_method, status, reason, restock, request_id
  ) VALUES (
    v_tenant_id, p_site_id, p_sale_id, v_invoice.customer_id, auth.uid(), p_cash_session_id,
    public.next_doc_number(v_tenant_id, 'return', 'RET'), v_total_ht + v_total_vat, v_total_ht, v_total_vat,
    'pending', 'pending', COALESCE(NULLIF(btrim(p_reason), ''), 'Retour sur facture'),
    COALESCE(p_restock, false), p_request_id
  ) RETURNING * INTO v_result;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(v_lines) AS d(
    id uuid, article uuid, name text, quantity numeric, price numeric, cost numeric, net numeric, vat numeric, rate numeric
  )
  LOOP
    INSERT INTO public.sale_return_items (
      tenant_id, return_id, article_id, sale_item_id, name, quantity, unit_price, purchase_cost,
      total, vat_net_amount, vat_amount, vat_rate
    ) VALUES (
      v_tenant_id, v_result.id, v_item.article, v_item.id, v_item.name, v_item.quantity, v_item.price,
      COALESCE(v_item.cost, 0), v_item.net + v_item.vat, v_item.net, v_item.vat, v_item.rate
    );
    IF p_restock AND EXISTS (
      SELECT 1 FROM public.articles a WHERE a.id = v_item.article AND a.tenant_id = v_tenant_id AND a.track_stock
    ) THEN
      PERFORM public.adjust_stock(v_item.article, p_site_id, v_item.quantity, 'return_customer', 'Retour ' || v_result.return_number);
    END IF;
  END LOOP;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public._prepare_vat_sale_return(p_sale_id uuid, p_site_id uuid, p_items jsonb, p_reason text, p_restock boolean, p_request_id text, p_cash_session_id uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public._protect_vat_return()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_tax_invoice boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT s.vat_enabled_at_issue INTO v_tax_invoice
    FROM public.sales s WHERE s.id = NEW.sale_id AND s.tenant_id = NEW.tenant_id;
    IF COALESCE(v_tax_invoice, false) IS DISTINCT FROM (NEW.vat_net_amount IS NOT NULL)
      OR (NEW.vat_net_amount IS NOT NULL AND current_user IN ('authenticated', 'anon')) THEN
      RAISE EXCEPTION 'Émettez le retour depuis le parcours Avoir sur facture avec TVA.';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.vat_net_amount IS NOT NULL THEN RAISE EXCEPTION 'Cet avoir fiscal doit être conservé.'; END IF;
    RETURN OLD;
  END IF;
  IF (OLD.vat_net_amount, OLD.vat_amount) IS DISTINCT FROM (NEW.vat_net_amount, NEW.vat_amount)
    OR (OLD.vat_entry_id IS DISTINCT FROM NEW.vat_entry_id AND current_user IN ('authenticated', 'anon')) THEN
    RAISE EXCEPTION 'Les montants et écritures de TVA sont calculés par Waarwi.';
  END IF;
  IF OLD.vat_net_amount IS NOT NULL THEN
    IF (OLD.tenant_id, OLD.site_id, OLD.sale_id, OLD.customer_id, OLD.total, OLD.return_number, OLD.created_at)
        IS DISTINCT FROM (NEW.tenant_id, NEW.site_id, NEW.sale_id, NEW.customer_id, NEW.total, NEW.return_number, NEW.created_at)
      OR ((OLD.status, OLD.refund_method, OLD.refunded_at, OLD.refund_cash_session_id)
        IS DISTINCT FROM (NEW.status, NEW.refund_method, NEW.refunded_at, NEW.refund_cash_session_id)
        AND (current_user IN ('authenticated', 'anon') OR OLD.status = 'approved')) THEN
      RAISE EXCEPTION 'Les informations fiscales de cet avoir sont protégées.';
    END IF;
    IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM NEW.status THEN
      IF NEW.refund_method = 'avoir' AND NEW.customer_id IS NULL THEN
        RAISE EXCEPTION 'Un client est requis pour émettre un avoir à utiliser sur ses factures.';
      ELSIF NEW.refund_method = 'cash' AND NOT EXISTS (
        SELECT 1 FROM public.cash_movements m WHERE m.tenant_id = NEW.tenant_id AND m.sale_return_id = NEW.id
          AND m.kind = 'refund' AND m.cash_session_id = NEW.refund_cash_session_id AND m.amount = NEW.total
      ) THEN
        RAISE EXCEPTION 'Ouvrez la caisse du magasin pour enregistrer le remboursement.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._protect_vat_return() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public._protect_vat_return_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_return_vat numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT r.vat_net_amount INTO v_return_vat FROM public.sale_returns r WHERE r.id = NEW.return_id AND r.tenant_id = NEW.tenant_id;
    IF (v_return_vat IS NOT NULL) IS DISTINCT FROM (NEW.vat_net_amount IS NOT NULL)
      OR (v_return_vat IS NOT NULL AND current_user IN ('authenticated', 'anon')) THEN
      RAISE EXCEPTION 'Le détail de la TVA doit provenir de la facture d’origine.';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.vat_net_amount IS NOT NULL THEN RAISE EXCEPTION 'Le détail fiscal de cet avoir doit être conservé.'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.vat_net_amount IS NOT NULL OR NEW.vat_amount IS NOT NULL OR NEW.vat_rate IS NOT NULL THEN
    RAISE EXCEPTION 'Le détail de la TVA doit provenir de la facture d’origine.';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._protect_vat_return_item() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.adjust_stock(p_article_id uuid, p_site_id uuid, p_quantity numeric, p_movement_type text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_tenant_id uuid;
v_previous numeric;
v_new numeric;
BEGIN
v_tenant_id := current_tenant_id();
IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Non authentifié'; END IF;

SELECT quantity INTO v_previous FROM stock_levels WHERE article_id = p_article_id AND site_id = p_site_id;
IF v_previous IS NULL THEN
v_previous := 0;
INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, p_article_id, p_site_id, 0);
END IF;

v_new := v_previous + p_quantity;
UPDATE stock_levels SET quantity = v_new, updated_at = now() WHERE article_id = p_article_id AND site_id = p_site_id;

INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note)
VALUES (v_tenant_id, p_article_id, p_site_id, p_movement_type, p_quantity, v_previous, v_new, auth.uid(), COALESCE(p_note,''));
END;
$function$;
REVOKE ALL ON FUNCTION public.adjust_stock(p_article_id uuid, p_site_id uuid, p_quantity numeric, p_movement_type text, p_note text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.approve_return_as_avoir(p_return_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_tenant_id uuid;
v_ret record;
v_sale_customer_id uuid;
v_alloc_result jsonb;
BEGIN
PERFORM public._cs_assert_return_usable(p_return_id);
v_tenant_id := current_tenant_id();
IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;

SELECT * INTO v_ret FROM public.sale_returns
WHERE id = p_return_id AND tenant_id = v_tenant_id FOR UPDATE;

IF v_ret.id IS NULL THEN RAISE EXCEPTION 'Retour introuvable'; END IF;

-- IDEMPOTENCY: if already approved, do nothing
IF v_ret.status = 'approved' THEN
RETURN jsonb_build_object(
'success', true, 'idempotent', true,
'credit_balance', v_ret.total,
'message', 'Avoir déjà approuvé — aucune modification'
);
END IF;

IF v_ret.status <> 'pending' THEN
RAISE EXCEPTION 'Seuls les retours en attente peuvent être convertis en avoir';
END IF;

-- Resolve customer from sale if return has no customer
IF v_ret.customer_id IS NULL AND v_ret.sale_id IS NOT NULL THEN
SELECT customer_id INTO v_sale_customer_id
FROM public.sales WHERE id = v_ret.sale_id AND tenant_id = v_tenant_id;
IF v_sale_customer_id IS NOT NULL THEN
UPDATE public.sale_returns SET customer_id = v_sale_customer_id
WHERE id = p_return_id;
v_ret.customer_id := v_sale_customer_id;
END IF;
END IF;

UPDATE public.sale_returns
SET status = 'approved', refund_method = 'avoir',
refunded_at = now(), approved_by = auth.uid()
WHERE id = p_return_id;

IF v_ret.customer_id IS NOT NULL AND COALESCE(v_ret.total, 0) > 0 THEN
UPDATE public.customers
SET balance = COALESCE(balance, 0) - v_ret.total
WHERE id = v_ret.customer_id AND tenant_id = v_tenant_id;

v_alloc_result := public._apply_avoirs_internal(v_ret.customer_id, v_tenant_id);
END IF;

RETURN jsonb_build_object(
'success', true, 'idempotent', false,
'credit_balance', v_ret.total,
'customer_id', v_ret.customer_id,
'allocation', COALESCE(v_alloc_result, '{}'::jsonb)
);
END;
$function$;
REVOKE ALL ON FUNCTION public.approve_return_as_avoir(p_return_id uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.prepare_vat_invoice_return(p_sale_id uuid, p_site_id uuid, p_items jsonb, p_reason text, p_restock boolean, p_request_id text, p_issue_credit boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_return public.sale_returns;
BEGIN
  PERFORM public._cr_require_caller();
  IF NOT public._cr_profile_has_permission(auth.uid(), 'edit_invoices') THEN
    RAISE EXCEPTION 'Permission de retour sur facture requise.' USING ERRCODE = '42501';
  END IF;
  v_return := public._prepare_vat_sale_return(p_sale_id, p_site_id, p_items, p_reason, p_restock, p_request_id, NULL);
  IF p_issue_credit AND v_return.status = 'pending' THEN
    PERFORM public.approve_return_as_avoir(v_return.id);
    SELECT * INTO v_return FROM public.sale_returns WHERE sale_returns.id = v_return.id AND sale_returns.tenant_id = v_return.tenant_id;
  END IF;
  RETURN to_jsonb(v_return);
END;
$function$;
REVOKE ALL ON FUNCTION public.prepare_vat_invoice_return(p_sale_id uuid, p_site_id uuid, p_items jsonb, p_reason text, p_restock boolean, p_request_id text, p_issue_credit boolean) FROM PUBLIC,anon,authenticated;

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
v_origin_sale public.sales;
v_paid_cash numeric;
v_refunded_cash numeric;
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

IF v_ret.vat_net_amount IS NOT NULL THEN
  IF auth.uid() IS NULL OR public.current_user_can_access_site(v_ret.site_id) IS DISTINCT FROM true
     OR NOT (public._cr_profile_has_permission(auth.uid(), 'edit_invoices') OR public._cr_profile_has_permission(auth.uid(), 'pos_returns'))
     OR v_ret.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Ce remboursement de TVA n’est pas autorisé.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO STRICT v_origin_sale FROM public.sales
  WHERE id = v_ret.sale_id AND tenant_id = v_tenant_id FOR UPDATE;
  SELECT * INTO STRICT v_ret FROM public.sale_returns
  WHERE id = p_return_id AND tenant_id = v_tenant_id FOR UPDATE;
  IF v_ret.status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'Ce retour est déjà traité.'; END IF;
  PERFORM 1 FROM public.cash_sessions WHERE id = p_session_id AND tenant_id = v_tenant_id
    AND site_id = v_ret.site_id AND status = 'open' FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ouvrez une caisse dans le magasin de la facture avant le remboursement.'; END IF;
  SELECT COALESCE(sum(p.amount), 0) INTO v_paid_cash FROM public.sale_payments p
  JOIN public.payment_methods m ON m.id = p.payment_method_id AND m.tenant_id = p.tenant_id
  WHERE p.tenant_id = v_tenant_id AND p.sale_id = v_origin_sale.id AND m.payment_type = 'cash';
  SELECT COALESCE(sum(r.total), 0) INTO v_refunded_cash FROM public.sale_returns r
  WHERE r.tenant_id = v_tenant_id AND r.sale_id = v_origin_sale.id AND r.status = 'approved' AND r.refund_method = 'cash';
  IF v_refunded_cash + v_ret.total > v_paid_cash THEN
    RAISE EXCEPTION 'Le remboursement dépasse le montant encaissé en espèces. Émettez un avoir.';
  END IF;
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
CASE WHEN v_multi OR v_ret.vat_net_amount IS NOT NULL THEN auth.uid() END
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
refunded_at = now(), approved_by = CASE WHEN v_ret.vat_net_amount IS NOT NULL THEN auth.uid() ELSE approved_by END
WHERE id = p_return_id;

RETURN jsonb_build_object('success', true, 'amount', v_ret.total);
END;
$function$;
REVOKE ALL ON FUNCTION public.process_return_as_cash(p_return_id uuid, p_session_id uuid) FROM PUBLIC,anon,authenticated;

CREATE TRIGGER protect_vat_return BEFORE INSERT OR DELETE OR UPDATE ON public.sale_returns FOR EACH ROW EXECUTE FUNCTION _protect_vat_return();

CREATE TRIGGER protect_vat_return_item BEFORE INSERT OR DELETE OR UPDATE ON public.sale_return_items FOR EACH ROW EXECUTE FUNCTION _protect_vat_return_item();
GRANT EXECUTE ON FUNCTION public.prepare_vat_invoice_return(uuid,uuid,jsonb,text,boolean,text,boolean),public.approve_return_as_avoir(uuid),public.process_return_as_cash(uuid,uuid) TO authenticated;
