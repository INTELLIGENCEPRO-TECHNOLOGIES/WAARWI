-- Recette isolée uniquement, publication soumise au release gate.
CREATE OR REPLACE FUNCTION public.post_purchase_invoice(p_tenant_id uuid, p_order_id uuid, p_invoice_number text, p_invoice_date date, p_lines jsonb, p_declared jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 o public.supplier_orders%ROWTYPE;
 v_amounts jsonb;
 v_number text := nullif(btrim(p_invoice_number),'');
 v_supplier text;
 v_purchase text;
 v_vat text;
 v_expense numeric;
 v_recoverable numeric;
 v_total numeric;
 v_lines jsonb;
 v_entry jsonb;
 v_entry_id uuid;
 v_previous public.journal_entries%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM public.current_tenant_id() OR NOT public.current_user_can_manage_accounting() THEN
  RAISE EXCEPTION 'Accès refusé à la comptabilité.' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id=p_tenant_id AND t.enabled_modules ? 'accounting') THEN
  RAISE EXCEPTION 'Module comptable non activé.' USING ERRCODE='42501';
 END IF;
 IF v_number IS NULL OR length(v_number)>120 OR p_invoice_date IS NULL OR NOT isfinite(p_invoice_date) OR p_invoice_date>(now() AT TIME ZONE 'Africa/Dakar')::date THEN
  RAISE EXCEPTION 'Numéro et date de facture valides obligatoires.';
 END IF;
 -- La numérotation est désormais fondée sur la date de pièce (script 35).
 -- Le verrou de période reste obligatoire, y compris pour les exercices antérieurs.
 SELECT * INTO o FROM public.supplier_orders WHERE id=p_order_id AND tenant_id=p_tenant_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Commande introuvable.'; END IF;
 IF o.status IS DISTINCT FROM 'received' OR o.received_date IS NULL OR o.supplier_id IS NULL THEN
  RAISE EXCEPTION 'Commande entièrement réceptionnée et fournisseur obligatoires.';
 END IF;
 v_amounts:=public._calculate_purchase_invoice_amounts(p_lines,p_declared);
 v_total:=(v_amounts->>'grossMinor')::numeric/100;
 v_expense:=(v_amounts->>'expenseMinor')::numeric/100;
 v_recoverable:=(v_amounts->>'deductibleVatMinor')::numeric/100;
 IF o.total IS DISTINCT FROM v_total THEN
  RAISE EXCEPTION 'Le TTC de la facture doit correspondre au total de la commande (% FCFA).',o.total;
 END IF;
 SELECT * INTO v_previous FROM public.journal_entries j WHERE j.tenant_id=p_tenant_id AND j.source_type='purchase' AND j.source_id=o.id LIMIT 1;
 IF FOUND THEN
  IF v_previous.id=o.accounting_entry_id AND v_previous.status='posted' AND v_previous.purchase_invoice->>'number'=v_number AND v_previous.entry_date=p_invoice_date AND v_previous.purchase_invoice->'input_lines'=p_lines AND v_previous.purchase_invoice->'amounts'=v_amounts THEN
   RETURN jsonb_build_object('success',true,'entry_id',v_previous.id,'piece_number',v_previous.entry_number,'already_accounted',true);
  END IF;
  RAISE EXCEPTION 'Cette commande possède déjà une écriture comptable.';
 END IF;
 IF o.accounting_status='accounted' OR o.accounting_entry_id IS NOT NULL THEN RAISE EXCEPTION 'Lien comptable existant à vérifier.'; END IF;
 PERFORM public._assert_accounting_month_open(p_tenant_id,date_trunc('month',p_invoice_date)::date);
 v_purchase:=public.resolve_account(p_tenant_id,'PURCHASES_GOODS');
 v_supplier:=public.get_or_create_supplier_account(p_tenant_id,o.supplier_id);
 IF NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.tenant_id=p_tenant_id AND a.code=v_purchase AND a.is_active AND a.class=6) OR NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.tenant_id=p_tenant_id AND a.code=v_supplier AND a.is_active AND a.class=4) THEN
  RAISE EXCEPTION 'Comptes d’achat ou fournisseur invalides.';
 END IF;
 v_lines:=jsonb_build_array(jsonb_build_object('account_code',v_purchase,'debit',v_expense,'credit',0,'label','Achats de marchandises'));
 IF v_recoverable>0 THEN
  v_vat:=public.resolve_account(p_tenant_id,'VAT_INPUT');
  IF NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.tenant_id=p_tenant_id AND a.code=v_vat AND a.is_active AND a.class=4 AND a.code LIKE '445%') OR v_vat=v_supplier THEN RAISE EXCEPTION 'Compte de TVA récupérable invalide.'; END IF;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_code',v_vat,'debit',v_recoverable,'credit',0,'label','TVA récupérable sur achats'));
 END IF;
 v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_code',v_supplier,'debit',0,'credit',v_total,'label','Facture fournisseur '||v_number));
 v_entry:=public.create_manual_journal_entry(p_tenant_id,'AC',p_invoice_date,'Facture fournisseur '||v_number||' / '||o.order_number,v_number,v_lines);
 v_entry_id:=(v_entry->>'entry_id')::uuid;
 IF v_entry_id IS NULL THEN RAISE EXCEPTION 'Création de l’écriture non confirmée.'; END IF;
 UPDATE public.journal_entries SET source_type='purchase',source_id=o.id,purchase_invoice=jsonb_build_object('number',v_number,'supplier_id',o.supplier_id,'order_number',o.order_number,'invoice_date',p_invoice_date,'input_lines',p_lines,'amounts',v_amounts)
 WHERE tenant_id=p_tenant_id AND id=v_entry_id;
 UPDATE public.journal_lines SET third_party_id=o.supplier_id WHERE tenant_id=p_tenant_id AND entry_id=v_entry_id AND account_code=v_supplier;
 UPDATE public.supplier_orders SET accounting_status='accounted',accounting_entry_id=v_entry_id WHERE tenant_id=p_tenant_id AND id=o.id;
 RETURN v_entry;
END;
$function$;

CREATE OR REPLACE FUNCTION public.post_vat_sale_return(p_return_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_original_ht numeric;
  v_original_tax numeric;
  v_previous_ht numeric;
  v_previous_tax numeric;
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
  PERFORM public._bank_reconciliation_access(v_tenant_id,true);
  IF v_return.vat_entry_id IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.journal_entries j WHERE j.tenant_id=v_tenant_id AND j.id=v_return.vat_entry_id AND j.source_type='sale_return' AND j.source_id=v_return.id AND j.status='posted' AND j.total_debit=v_return.total AND j.total_credit=v_return.total) THEN RAISE EXCEPTION 'Lien comptable de l’avoir incohérent.'; END IF;
    RETURN jsonb_build_object('entry_id', v_return.vat_entry_id, 'already_accounted', true);
  END IF;
  IF EXISTS(SELECT 1 FROM public.journal_entries j WHERE j.tenant_id=v_tenant_id AND j.source_type='sale_return' AND j.source_id=v_return.id) THEN RAISE EXCEPTION 'Pièce existante sans lien : rapprochement requis.'; END IF;
  IF v_return.refund_method IS NULL OR v_return.total IS NULL OR v_return.vat_amount IS NULL OR v_return.total<=0 OR v_return.vat_net_amount<0 OR v_return.vat_amount<0 OR v_return.total IN ('NaN','Infinity','-Infinity') OR v_return.total<>round(v_return.total,2) OR v_return.vat_net_amount<>round(v_return.vat_net_amount,2) OR v_return.vat_amount<>round(v_return.vat_amount,2) OR v_return.vat_net_amount+v_return.vat_amount IS DISTINCT FROM v_return.total THEN RAISE EXCEPTION 'Montants HT, TVA et TTC de l’avoir incohérents.'; END IF;

  SELECT s.* INTO v_sale FROM public.sales s WHERE s.id = v_return.sale_id AND s.tenant_id = v_tenant_id FOR UPDATE;
  IF NOT FOUND OR v_sale.deleted_at IS NOT NULL OR v_sale.status IN ('cancelled','deleted') THEN RAISE EXCEPTION 'Facture d’origine non valide.';END IF;
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

  -- Refuse multi-account or ambiguous legacy postings instead of selecting MIN(code).
  IF (SELECT count(DISTINCT l.account_code) FROM public.journal_lines l WHERE l.tenant_id=v_tenant_id AND l.entry_id=v_entry.id AND l.debit>0)<>1
     OR (SELECT count(DISTINCT l.account_code) FROM public.journal_lines l WHERE l.tenant_id=v_tenant_id AND l.entry_id=v_entry.id AND l.credit>0 AND l.account_code NOT LIKE '443%')>1
     OR (SELECT count(DISTINCT l.account_code) FROM public.journal_lines l WHERE l.tenant_id=v_tenant_id AND l.entry_id=v_entry.id AND l.credit>0 AND l.account_code LIKE '443%')>1
     OR v_customer_account NOT LIKE '4%' OR (v_return.vat_net_amount>0 AND v_revenue_account NOT LIKE '7%')
  THEN RAISE EXCEPTION 'Ventilation d’origine complexe : revue comptable requise.';END IF;
  SELECT coalesce(sum(l.credit) FILTER(WHERE l.account_code=v_revenue_account),0),coalesce(sum(l.credit) FILTER(WHERE l.account_code=v_vat_account),0) INTO v_original_ht,v_original_tax
  FROM public.journal_lines l WHERE l.tenant_id=v_tenant_id AND l.entry_id=v_entry.id;
  -- Legacy approved returns without fiscal detail cannot be mixed with automated reversals.
  IF EXISTS(SELECT 1 FROM public.sale_returns r WHERE r.tenant_id=v_tenant_id AND r.sale_id=v_sale.id AND r.id<>v_return.id AND r.status='approved' AND r.vat_net_amount IS NULL) THEN RAISE EXCEPTION 'Retours historiques sans ventilation fiscale : revue préalable requise.';END IF;
  SELECT coalesce(sum(r.vat_net_amount),0),coalesce(sum(r.vat_amount),0) INTO v_previous_ht,v_previous_tax
  FROM public.sale_returns r WHERE r.tenant_id=v_tenant_id AND r.sale_id=v_sale.id AND r.id<>v_return.id AND r.status='approved';
  IF v_previous_ht+v_return.vat_net_amount>v_original_ht OR v_previous_tax+v_return.vat_amount>v_original_tax THEN RAISE EXCEPTION 'Cumul des avoirs supérieur à la facture d’origine.';END IF;
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
  IF NOT coalesce((v_result->>'success')::boolean,false) THEN RAISE EXCEPTION 'Avoir non comptabilisé : %',coalesce(v_result->>'error','erreur inconnue');END IF;
  v_entry_id := (v_result->>'entry_id')::uuid;
  UPDATE public.journal_entries SET source_type = 'sale_return', source_id = v_return.id
  WHERE id = v_entry_id AND tenant_id = v_tenant_id;
  UPDATE public.journal_lines SET third_party_id = v_return.customer_id
  WHERE entry_id = v_entry_id AND tenant_id = v_tenant_id AND account_code = v_customer_account;

  IF v_return.refund_method = 'cash' THEN
    BEGIN
    SELECT * INTO STRICT v_movement FROM public.cash_movements m WHERE m.tenant_id = v_tenant_id
      AND m.sale_return_id = v_return.id AND m.kind = 'refund' AND m.amount = v_return.total
      AND m.site_id = v_return.site_id AND m.cash_session_id = v_return.refund_cash_session_id FOR UPDATE;
    EXCEPTION WHEN no_data_found THEN
      RAISE EXCEPTION 'Mouvement de remboursement introuvable ou incohérent : aucune écriture enregistrée.';
    WHEN too_many_rows THEN
      RAISE EXCEPTION 'Plusieurs mouvements de remboursement correspondent à cet avoir : contrôle requis.';
    END;
    IF v_movement.accounting_entry_id IS NOT NULL OR v_movement.accounting_status = 'accounted' THEN
      RAISE EXCEPTION 'Cette sortie de caisse est déjà comptabilisée.';
    END IF;
    IF v_movement.payment_method_id IS NULL THEN
      v_cash_account := public.resolve_account(v_tenant_id, 'CASH_DEFAULT');
    ELSE
      SELECT pm.account_code INTO v_cash_account FROM public.payment_methods pm WHERE pm.tenant_id=v_tenant_id AND pm.id=v_movement.payment_method_id AND pm.payment_type='cash';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.accounts a WHERE a.tenant_id=v_tenant_id AND a.code=v_cash_account AND a.is_active AND a.class=5 AND a.code LIKE '57%') THEN RAISE EXCEPTION 'Compte de caisse actif de famille 57 requis.';END IF;
    v_result := public.create_manual_journal_entry(v_tenant_id, 'CA', (v_movement.created_at AT TIME ZONE 'Africa/Dakar')::date,
      'Remboursement ' || v_return.return_number, v_return.return_number,
      jsonb_build_array(
        jsonb_build_object('account_code', v_customer_account, 'debit', v_return.total, 'credit', 0),
        jsonb_build_object('account_code', v_cash_account, 'debit', 0, 'credit', v_return.total)
      ));
    IF NOT coalesce((v_result->>'success')::boolean,false) THEN RAISE EXCEPTION 'Remboursement non comptabilisé : %',coalesce(v_result->>'error','erreur inconnue');END IF;
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
$function$;

