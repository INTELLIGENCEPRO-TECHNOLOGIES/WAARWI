-- VAT credit notes are based on the issued invoice, including its discounts.
ALTER TABLE public.sale_returns
  ADD COLUMN vat_net_amount numeric,
  ADD COLUMN vat_amount numeric,
  ADD COLUMN vat_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE RESTRICT;
ALTER TABLE public.sale_return_items
  ADD COLUMN vat_net_amount numeric,
  ADD COLUMN vat_amount numeric,
  ADD COLUMN vat_rate numeric;
CREATE INDEX IF NOT EXISTS vat_sale_return_items_origin_idx ON public.sale_return_items(sale_item_id);

CREATE FUNCTION public._protect_vat_return()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
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
$$;

CREATE TRIGGER protect_vat_return BEFORE INSERT OR UPDATE OR DELETE ON public.sale_returns
FOR EACH ROW EXECUTE FUNCTION public._protect_vat_return();

CREATE FUNCTION public._protect_vat_return_item()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
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
$$;

CREATE TRIGGER protect_vat_return_item BEFORE INSERT OR UPDATE OR DELETE ON public.sale_return_items
FOR EACH ROW EXECUTE FUNCTION public._protect_vat_return_item();

CREATE FUNCTION public._prepare_vat_sale_return(
  p_sale_id uuid, p_site_id uuid, p_items jsonb, p_reason text, p_restock boolean, p_request_id text, p_cash_session_id uuid
)
RETURNS public.sale_returns
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
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
$$;

CREATE FUNCTION public.prepare_vat_invoice_return(
  p_sale_id uuid, p_site_id uuid, p_items jsonb, p_reason text, p_restock boolean, p_request_id text, p_issue_credit boolean
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
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
$$;

REVOKE ALL ON FUNCTION public._protect_vat_return(), public._protect_vat_return_item(),
  public._prepare_vat_sale_return(uuid, uuid, jsonb, text, boolean, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prepare_vat_invoice_return(uuid, uuid, jsonb, text, boolean, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_vat_invoice_return(uuid, uuid, jsonb, text, boolean, text, boolean) TO authenticated;

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

-- Keep the original register and supervision entry points. Only fiscal sales
-- use the new return calculator; the historical return flow stays intact.
ALTER FUNCTION public.process_sale_return(uuid, uuid, uuid, jsonb, text, boolean, boolean, text, text)
RENAME TO _process_sale_return_without_vat;
REVOKE ALL ON FUNCTION public._process_sale_return_without_vat(uuid, uuid, uuid, jsonb, text, boolean, boolean, text, text)
FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.process_sale_return(
  p_sale_id uuid, p_site_id uuid, p_cash_session_id uuid, p_items jsonb,
  p_reason text DEFAULT 'Retour au POS', p_refund_now boolean DEFAULT true,
  p_restock boolean DEFAULT true, p_request_id text DEFAULT NULL, p_refund_method text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
  v_return public.sale_returns;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sales WHERE id = p_sale_id AND tenant_id = v_tenant_id AND vat_enabled_at_issue
  ) THEN
    RETURN public._process_sale_return_without_vat(p_sale_id, p_site_id, p_cash_session_id, p_items,
      p_reason, p_refund_now, p_restock, p_request_id, p_refund_method);
  END IF;

  PERFORM public._cr_require_caller();
  IF NOT public._cr_profile_has_permission(auth.uid(), 'pos_returns') THEN
    RAISE EXCEPTION 'Permission de retour en caisse requise.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cash_sessions
    WHERE id = p_cash_session_id AND tenant_id = v_tenant_id AND site_id = p_site_id AND status = 'open') THEN
    RAISE EXCEPTION 'Session de caisse invalide ou fermée.';
  END IF;
  IF public._cs_multi_enabled(v_tenant_id) THEN
    PERFORM public._cs_assert_operational(p_cash_session_id, v_tenant_id, p_site_id);
  END IF;

  v_return := public._prepare_vat_sale_return(p_sale_id, p_site_id, p_items, p_reason, p_restock, p_request_id, p_cash_session_id);
  IF v_return.status = 'pending' THEN
    IF p_refund_method = 'avoir' THEN
      PERFORM public.approve_return_as_avoir(v_return.id);
    ELSIF p_refund_now THEN
      PERFORM public.process_return_as_cash(v_return.id, p_cash_session_id);
    END IF;
    SELECT * INTO v_return FROM public.sale_returns r WHERE r.id = v_return.id;
  END IF;
  RETURN jsonb_build_object('success', true, 'return_id', v_return.id, 'return_number', v_return.return_number,
    'total', v_return.total, 'vat_net_amount', v_return.vat_net_amount, 'vat_amount', v_return.vat_amount,
    'refunded', v_return.refund_method = 'cash', 'refund_method', v_return.refund_method);
END;
$$;

REVOKE ALL ON FUNCTION public.process_sale_return(uuid, uuid, uuid, jsonb, text, boolean, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_sale_return(uuid, uuid, uuid, jsonb, text, boolean, boolean, text, text) TO authenticated, service_role;

CREATE FUNCTION public.post_vat_sale_return(p_return_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
  v_return public.sale_returns;
  v_sale public.sales;
  v_movement public.cash_movements;
  v_entry public.journal_entries;
  v_customer_account text;
  v_revenue_account text;
  v_vat_account text;
  v_cash_account text;
  v_lines jsonb := '[]';
  v_result jsonb;
  v_entry_id uuid;
  v_cash_entry_id uuid;
  v_date date;
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL OR NOT public.current_user_can_manage_accounting() THEN
    RAISE EXCEPTION 'Accès à la comptabilité refusé.' USING ERRCODE = '42501';
  END IF;
  SELECT r.* INTO v_return FROM public.sale_returns r
  WHERE r.id = p_return_id AND r.tenant_id = v_tenant_id FOR UPDATE;
  IF NOT FOUND OR public.current_user_can_access_site(v_return.site_id) IS DISTINCT FROM true
     OR v_return.vat_net_amount IS NULL OR v_return.status <> 'approved'
     OR v_return.refund_method NOT IN ('avoir', 'cash') OR v_return.refunded_at IS NULL THEN
    RAISE EXCEPTION 'Avoir fiscal approuvé introuvable dans ce magasin.';
  END IF;
  IF v_return.vat_entry_id IS NOT NULL THEN
    RETURN jsonb_build_object('entry_id', v_return.vat_entry_id, 'already_accounted', true);
  END IF;

  SELECT s.* INTO v_sale FROM public.sales s WHERE s.id = v_return.sale_id AND s.tenant_id = v_tenant_id;
  SELECT j.* INTO v_entry FROM public.journal_entries j
  WHERE j.id = v_sale.accounting_entry_id AND j.tenant_id = v_tenant_id
    AND j.source_type = 'sale' AND j.source_id = v_sale.id AND j.status = 'posted';
  IF NOT FOUND THEN RAISE EXCEPTION 'Comptabilisez d’abord la facture d’origine.'; END IF;

  -- Reuse the accounts actually posted on the original sale. A later change to
  -- the chart of accounts must not change which accounts an avoir reverses.
  SELECT min(l.account_code) FILTER (WHERE l.debit > 0),
    min(l.account_code) FILTER (WHERE l.credit > 0 AND l.account_code NOT LIKE '443%'),
    min(l.account_code) FILTER (WHERE l.credit > 0 AND l.account_code LIKE '443%')
  INTO v_customer_account, v_revenue_account, v_vat_account
  FROM public.journal_lines l WHERE l.entry_id = v_entry.id AND l.tenant_id = v_tenant_id;
  IF v_customer_account IS NULL OR (v_return.vat_net_amount > 0 AND v_revenue_account IS NULL)
     OR (v_return.vat_amount > 0 AND v_vat_account IS NULL) THEN
    RAISE EXCEPTION 'Les comptes d’origine de la facture ne permettent pas d’enregistrer cet avoir.';
  END IF;

  v_date := (v_return.refunded_at AT TIME ZONE 'Africa/Dakar')::date;
  IF v_date < v_entry.entry_date THEN RAISE EXCEPTION 'La date de l’avoir précède la facture d’origine.'; END IF;
  IF v_return.vat_net_amount > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', v_revenue_account, 'debit', v_return.vat_net_amount, 'credit', 0));
  END IF;
  IF v_return.vat_amount > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', v_vat_account, 'debit', v_return.vat_amount, 'credit', 0));
  END IF;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', v_customer_account, 'debit', 0, 'credit', v_return.total));

  v_result := public.create_manual_journal_entry(v_tenant_id, 'VE', v_date,
    'Avoir ' || v_return.return_number || ' sur ' || v_sale.sale_number, v_return.return_number, v_lines);
  v_entry_id := (v_result->>'entry_id')::uuid;
  UPDATE public.journal_entries SET source_type = 'sale_return', source_id = v_return.id
  WHERE id = v_entry_id AND tenant_id = v_tenant_id;
  UPDATE public.journal_lines SET third_party_id = v_return.customer_id
  WHERE entry_id = v_entry_id AND tenant_id = v_tenant_id AND account_code = v_customer_account;

  IF v_return.refund_method = 'cash' THEN
    SELECT * INTO STRICT v_movement FROM public.cash_movements m WHERE m.tenant_id = v_tenant_id
      AND m.sale_return_id = v_return.id AND m.kind = 'refund' AND m.amount = v_return.total
      AND m.site_id = v_return.site_id AND m.cash_session_id = v_return.refund_cash_session_id FOR UPDATE;
    IF v_movement.accounting_entry_id IS NOT NULL OR v_movement.accounting_status = 'accounted' THEN
      RAISE EXCEPTION 'Cette sortie de caisse est déjà comptabilisée.';
    END IF;
    v_cash_account := public.resolve_account(v_tenant_id, 'CASH_DEFAULT');
    v_result := public.create_manual_journal_entry(v_tenant_id, 'CA', (v_movement.created_at AT TIME ZONE 'Africa/Dakar')::date,
      'Remboursement ' || v_return.return_number, v_return.return_number,
      jsonb_build_array(
        jsonb_build_object('account_code', v_customer_account, 'debit', v_return.total, 'credit', 0),
        jsonb_build_object('account_code', v_cash_account, 'debit', 0, 'credit', v_return.total)
      ));
    v_cash_entry_id := (v_result->>'entry_id')::uuid;
    UPDATE public.journal_entries SET source_type = 'cash_movement', source_id = v_movement.id
    WHERE id = v_cash_entry_id AND tenant_id = v_tenant_id;
    UPDATE public.journal_lines SET third_party_id = v_return.customer_id
    WHERE entry_id = v_cash_entry_id AND tenant_id = v_tenant_id AND account_code = v_customer_account;
    UPDATE public.cash_movements SET accounting_status = 'accounted', accounting_entry_id = v_cash_entry_id
    WHERE id = v_movement.id AND tenant_id = v_tenant_id;
  END IF;

  UPDATE public.sale_returns SET vat_entry_id = v_entry_id WHERE id = v_return.id AND tenant_id = v_tenant_id;
  RETURN jsonb_build_object('entry_id', v_entry_id, 'cash_entry_id', v_cash_entry_id, 'already_accounted', false);
END;
$$;

REVOKE ALL ON FUNCTION public.post_vat_sale_return(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_vat_sale_return(uuid) TO authenticated;

-- Net sales and credit notes use the same HT basis for margin reports.
CREATE OR REPLACE FUNCTION public.get_financial_summary(p_site_id uuid DEFAULT NULL::uuid, p_from date DEFAULT CURRENT_DATE, p_to date DEFAULT CURRENT_DATE, p_cash_session_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
v_tenant_id           uuid;
v_tz                  text;
v_ts_from             timestamptz;
v_ts_to               timestamptz;
v_ventes_validees     numeric := 0;
v_retours             numeric := 0;
v_cogs_ventes         numeric := 0;
v_cogs_retours        numeric := 0;
v_charges             numeric := 0;
v_nb_ventes           bigint  := 0;
v_nb_retours          bigint  := 0;
v_nb_ventes_retour    bigint  := 0;
v_nb_annulations      bigint  := 0;
v_montant_annule      numeric := 0;
v_nb_lignes_sans_cout bigint  := 0;
v_ca_net              numeric;
v_cogs_net            numeric;
v_marge_brute         numeric;
v_taux_marque         numeric;
v_taux_marge          numeric;
v_resultat            numeric;
BEGIN
v_tenant_id := current_tenant_id();
IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

IF p_site_id IS NOT NULL THEN
IF NOT EXISTS (SELECT 1 FROM sites WHERE id = p_site_id AND tenant_id = v_tenant_id) THEN
RAISE EXCEPTION 'Site not authorized';
END IF;
END IF;

SELECT COALESCE(NULLIF(settings->>'timezone', ''), 'Africa/Dakar') INTO v_tz FROM tenants WHERE id = v_tenant_id;
v_tz := COALESCE(v_tz, 'Africa/Dakar');
v_ts_from := (p_from::timestamp AT TIME ZONE v_tz);
v_ts_to   := ((p_to + 1)::timestamp AT TIME ZONE v_tz);

SELECT COALESCE(SUM(s.total - COALESCE(s.vat_amount, 0)), 0),
COALESCE(SUM(item_cost.cost), 0), COUNT(*)
INTO v_ventes_validees, v_cogs_ventes, v_nb_ventes
FROM sales s
LEFT JOIN LATERAL (
SELECT COALESCE(SUM(si.purchase_cost * si.quantity), 0) AS cost
FROM sale_items si WHERE si.sale_id = s.id
) item_cost ON true
WHERE s.tenant_id = v_tenant_id
AND s.status IN ('paid', 'partial', 'validated')
AND s.created_at >= v_ts_from AND s.created_at < v_ts_to
AND (p_site_id IS NULL OR s.site_id = p_site_id)
AND (p_cash_session_ids IS NULL OR s.cash_session_id = ANY (p_cash_session_ids));

SELECT COUNT(*) INTO v_nb_lignes_sans_cout
FROM sale_items si
JOIN sales s ON s.id = si.sale_id
JOIN articles a ON a.id = si.article_id
WHERE s.tenant_id = v_tenant_id
AND s.status IN ('paid', 'partial', 'validated')
AND s.created_at >= v_ts_from AND s.created_at < v_ts_to
AND (p_site_id IS NULL OR s.site_id = p_site_id)
AND (p_cash_session_ids IS NULL OR s.cash_session_id = ANY (p_cash_session_ids))
AND a.track_stock = true AND COALESCE(si.purchase_cost, 0) = 0;

SELECT COALESCE(SUM(COALESCE(sr.vat_net_amount, sr.total)), 0), COALESCE(SUM(ret_cost.cost), 0),
COUNT(*), COUNT(DISTINCT sr.sale_id)
INTO v_retours, v_cogs_retours, v_nb_retours, v_nb_ventes_retour
FROM sale_returns sr
LEFT JOIN LATERAL (
SELECT COALESCE(SUM(sri.purchase_cost * sri.quantity), 0) AS cost
FROM sale_return_items sri WHERE sri.return_id = sr.id
) ret_cost ON true
WHERE sr.tenant_id = v_tenant_id
AND sr.status = 'approved'
AND sr.created_at >= v_ts_from AND sr.created_at < v_ts_to
AND (p_site_id IS NULL OR sr.site_id = p_site_id)
AND (p_cash_session_ids IS NULL OR sr.cash_session_id = ANY (p_cash_session_ids));

SELECT COUNT(*), COALESCE(SUM(s.total), 0)
INTO v_nb_annulations, v_montant_annule
FROM sales s
WHERE s.tenant_id = v_tenant_id AND s.status = 'cancelled'
AND s.created_at >= v_ts_from AND s.created_at < v_ts_to
AND (p_site_id IS NULL OR s.site_id = p_site_id)
AND (p_cash_session_ids IS NULL OR s.cash_session_id = ANY (p_cash_session_ids));

SELECT COALESCE(SUM(cm.amount), 0) INTO v_charges
FROM cash_movements cm
WHERE cm.tenant_id = v_tenant_id AND cm.kind = 'expense'
AND cm.created_at >= v_ts_from AND cm.created_at < v_ts_to
AND (p_site_id IS NULL OR cm.site_id = p_site_id)
AND (p_cash_session_ids IS NULL OR cm.cash_session_id = ANY (p_cash_session_ids));

v_ca_net      := v_ventes_validees - v_retours;
v_cogs_net    := v_cogs_ventes - v_cogs_retours;
v_marge_brute := v_ca_net - v_cogs_net;
-- Taux de marque = marge / CA ; taux de marge = marge / CMV ; NULL si dénominateur nul.
v_taux_marque := CASE WHEN v_ca_net > 0 THEN ROUND((v_marge_brute / v_ca_net) * 100, 2) ELSE NULL END;
v_taux_marge  := CASE WHEN v_cogs_net > 0 THEN ROUND((v_marge_brute / v_cogs_net) * 100, 2) ELSE NULL END;
v_resultat    := v_marge_brute - v_charges;

RETURN jsonb_build_object(
'ventes_validees',       v_ventes_validees,
'retours',               v_retours,
'ca_net',                v_ca_net,
'cogs_ventes',           v_cogs_ventes,
'cogs_retours',          v_cogs_retours,
'cogs_net',              v_cogs_net,
'marge_brute',           v_marge_brute,
'taux_marque',           v_taux_marque,
'taux_marge',            v_taux_marge,
'charges_exploitation',  v_charges,
'resultat_exploitation', v_resultat,
'nb_ventes',             v_nb_ventes,
'nb_retours',            v_nb_retours,
'nb_ventes_avec_retour', v_nb_ventes_retour,
'nb_annulations',        v_nb_annulations,
'montant_annule',        v_montant_annule,
'nb_lignes_sans_cout',   v_nb_lignes_sans_cout
);
END;
$function$;

-- VAT refunds are posted together with their credit note from Facturation.
DO $$
DECLARE
  v_definition text;
BEGIN
  v_definition := pg_get_functiondef('public._cash_accounting_document(public.cash_movements)'::regprocedure);
  IF position('IF v_sale.vat_amount IS DISTINCT FROM 0::numeric THEN' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'La vérification comptable des remboursements doit être disponible avant la migration TVA.';
  END IF;
  EXECUTE replace(v_definition,
    'IF v_sale.vat_amount IS DISTINCT FROM 0::numeric THEN',
    'IF v_return.vat_net_amount IS NOT NULL OR v_sale.vat_amount IS DISTINCT FROM 0::numeric THEN');
END;
$$;
