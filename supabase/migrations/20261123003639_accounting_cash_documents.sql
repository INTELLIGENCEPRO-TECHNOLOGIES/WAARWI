-- PC2D-A.2: proof-backed posting of documented cash exceptions.
-- No accounting entries or historical records are changed by this migration.

CREATE OR REPLACE FUNCTION public._cash_accounting_document(p_movement public.cash_movements)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = ''
AS $$
DECLARE
  m public.cash_movements := p_movement;
  v_document jsonb;
  v_prepayments uuid[];
  v_prepayment public.customer_prepayments;
  v_return public.sale_returns;
  v_sale public.sales;
  v_source_id uuid;
  v_customer_id uuid;
  v_reference text;
  v_label text;
  v_used numeric;
  v_treasury text;
  v_payment_type text;
BEGIN
  IF m.kind NOT IN ('customer_prepayment', 'customer_withdrawal', 'refund') THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'Utilisez le traitement standard de ce mouvement.');
  END IF;
  IF m.accounting_status IS DISTINCT FROM 'not_accounted' OR m.accounting_entry_id IS NOT NULL
     OR m.supplier_id IS NOT NULL OR m.amount IS NULL OR m.amount <= 0
     OR m.amount IN ('NaN'::numeric, 'Infinity'::numeric) OR m.created_at IS NULL OR NOT isfinite(m.created_at)
     OR m.vault_movement_id IS NOT NULL THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'Le mouvement a déjà été traité ou ses données sont incomplètes.');
  END IF;
  IF m.kind = 'customer_withdrawal' THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'Le retrait doit être rapproché des avances utilisées avant comptabilisation.');
  END IF;

  IF m.kind = 'customer_prepayment' THEN
    -- Older single-register sessions wrote the two rows in the same transaction
    -- without saving cash_movement_id on the prepayment.
    SELECT ARRAY(
      SELECT p.id FROM public.customer_prepayments p
      WHERE p.tenant_id = m.tenant_id
        AND (p.cash_movement_id = m.id OR (
          p.cash_movement_id IS NULL AND p.customer_id = m.customer_id
          AND p.amount = m.amount AND p.created_at = m.created_at
          AND (p.cash_session_id IS NULL OR p.cash_session_id = m.cash_session_id)
        ))
      LIMIT 2
    ) INTO v_prepayments;
    IF cardinality(v_prepayments) <> 1 THEN
      RETURN jsonb_build_object('eligible', false, 'reason', 'Fiche d’acompte introuvable ou rapprochement ambigu.');
    END IF;

    SELECT * INTO v_prepayment FROM public.customer_prepayments p
    WHERE p.tenant_id = m.tenant_id AND p.id = v_prepayments[1];
    IF m.customer_id IS NULL OR v_prepayment.customer_id IS DISTINCT FROM m.customer_id
       OR v_prepayment.amount IS DISTINCT FROM m.amount
       OR (v_prepayment.cash_session_id IS NOT NULL AND v_prepayment.cash_session_id IS DISTINCT FROM m.cash_session_id)
       OR (v_prepayment.payment_method_id IS NOT NULL AND v_prepayment.payment_method_id IS DISTINCT FROM m.payment_method_id)
       OR m.sale_return_id IS NOT NULL
       OR (v_prepayment.cash_movement_id IS NULL AND EXISTS (
         SELECT 1 FROM public.cash_movements cm
         WHERE cm.tenant_id = m.tenant_id AND cm.id <> m.id AND cm.kind = 'customer_prepayment'
           AND cm.customer_id = m.customer_id AND cm.amount = m.amount AND cm.created_at = m.created_at
       )) THEN
      RETURN jsonb_build_object('eligible', false, 'reason', 'La fiche d’acompte et le mouvement de caisse ne concordent pas.');
    END IF;
    v_source_id := v_prepayment.id;
    v_customer_id := v_prepayment.customer_id;
    v_label := 'Acompte client';
    v_used := v_prepayment.amount_used;
    v_reference := COALESCE(NULLIF(btrim(v_prepayment.reference), ''), NULLIF(btrim(m.reference), ''), NULLIF(btrim(m.receipt_number), ''));

  ELSE
    SELECT * INTO v_return FROM public.sale_returns r
    WHERE r.tenant_id = m.tenant_id AND r.id = m.sale_return_id AND r.site_id = m.site_id;
    IF NOT FOUND OR v_return.status IS DISTINCT FROM 'approved' OR v_return.refund_method IS DISTINCT FROM 'cash'
       OR v_return.total IS DISTINCT FROM m.amount OR v_return.refunded_at IS DISTINCT FROM m.created_at
       OR m.cash_session_id IS NULL OR v_return.refund_cash_session_id IS DISTINCT FROM m.cash_session_id
       OR (m.customer_id IS NOT NULL AND v_return.customer_id IS DISTINCT FROM m.customer_id)
       OR EXISTS (
          SELECT 1 FROM public.cash_movements cm WHERE cm.tenant_id = m.tenant_id AND cm.id <> m.id
            AND cm.sale_return_id = v_return.id AND cm.kind = 'refund'
       ) THEN
      RETURN jsonb_build_object('eligible', false, 'reason', 'Retour ou remboursement intégral non confirmé par la pièce et la sortie de caisse.');
    END IF;
    SELECT * INTO v_sale FROM public.sales s
    WHERE s.tenant_id = m.tenant_id AND s.id = v_return.sale_id AND s.site_id = m.site_id;
    IF NOT FOUND OR v_sale.deleted_at IS NOT NULL OR v_sale.status = 'cancelled'
       OR v_sale.total IS NULL OR v_sale.total < m.amount
       OR v_sale.accounting_status IS DISTINCT FROM 'accounted' OR NOT EXISTS (
         SELECT 1 FROM public.journal_entries j WHERE j.tenant_id = m.tenant_id AND j.id = v_sale.accounting_entry_id AND j.status = 'posted'
           AND j.source_type = 'sale' AND j.source_id = v_sale.id
       ) THEN
      RETURN jsonb_build_object('eligible', false, 'reason', 'La vente d’origine doit être identifiée et comptabilisée.');
    END IF;
    IF v_sale.vat_amount IS DISTINCT FROM 0::numeric THEN
      RETURN jsonb_build_object('eligible', false, 'reason', 'La TVA de la vente doit être vérifiée avant de traiter ce remboursement.');
    END IF;
    v_source_id := v_return.id;
    v_customer_id := v_return.customer_id;
    v_label := 'Remboursement du retour ' || v_return.return_number;
    v_reference := v_return.return_number;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.journal_entries j
    WHERE j.tenant_id = m.tenant_id AND (
      j.source_id IN (m.id, v_source_id)
      OR (v_reference IS NOT NULL AND j.reference = v_reference
          AND j.total_debit = m.amount AND j.total_credit = m.amount
          AND j.id IS DISTINCT FROM v_sale.accounting_entry_id)
    )
  ) OR (m.kind = 'refund' AND EXISTS (
    SELECT 1 FROM public.sale_payments p
    WHERE p.tenant_id = m.tenant_id AND p.source_return_id = v_source_id
      AND (p.accounting_entry_id IS NOT NULL OR p.accounting_status = 'accounted' OR EXISTS (
        SELECT 1 FROM public.journal_entries j
        WHERE j.tenant_id = p.tenant_id AND j.source_type = 'payment' AND j.source_id = p.id
      ))
  )) THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'Une écriture liée à cette pièce est déjà présente. Rapprochez-la avant toute saisie.');
  END IF;

  IF m.payment_method_id IS NOT NULL THEN
    SELECT NULLIF(btrim(pm.account_code), ''), pm.payment_type INTO v_treasury, v_payment_type
    FROM public.payment_methods pm WHERE pm.tenant_id = m.tenant_id AND pm.id = m.payment_method_id;
  ELSIF m.kind = 'refund' THEN
    -- The refund RPC releases physical cash and historically wrote no mode ID.
    BEGIN
      v_treasury := public.resolve_account(m.tenant_id, 'CASH_DEFAULT');
      v_payment_type := 'cash';
    EXCEPTION WHEN raise_exception THEN
      RETURN jsonb_build_object('eligible', false, 'reason', 'Renseignez le compte de caisse utilisé pour les remboursements.');
    END;
  END IF;
  IF v_payment_type IS NULL OR v_payment_type NOT IN ('cash', 'mobile', 'bank', 'card', 'check')
     OR (m.kind = 'refund' AND v_payment_type <> 'cash')
     OR NOT EXISTS (
       SELECT 1 FROM public.accounts a WHERE a.tenant_id = m.tenant_id AND a.code = v_treasury AND a.is_active AND a.class = 5
     ) THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'Le compte de trésorerie de la pièce doit être configuré et actif.');
  END IF;

  v_document := jsonb_build_object(
    'id', v_source_id, 'kind', m.kind, 'label', v_label, 'reference', v_reference,
    'date', (m.created_at AT TIME ZONE 'UTC')::date, 'amount', m.amount,
    'used_amount', v_used, 'sale_number', v_sale.sale_number,
    'customer_id', v_customer_id, 'customer_name', (
      SELECT c.name FROM public.customers c WHERE c.tenant_id = m.tenant_id AND c.id = v_customer_id
    ),
    'journal', CASE WHEN v_payment_type = 'cash' THEN 'CA' ELSE 'BQ' END, 'treasury', v_treasury
  );
  RETURN jsonb_build_object('eligible', true, 'document', v_document);
END;
$$;

REVOKE ALL ON FUNCTION public._cash_accounting_document(public.cash_movements) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.review_cash_accounting_document(p_tenant_id uuid, p_movement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  m public.cash_movements;
  v_review jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM public.current_tenant_id()
     OR NOT public.current_user_can_manage_accounting() THEN
    RAISE EXCEPTION 'Accès refusé à la comptabilité de cette entreprise.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO m FROM public.cash_movements cm WHERE cm.tenant_id = p_tenant_id AND cm.id = p_movement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mouvement de caisse introuvable.'; END IF;
  v_review := public._cash_accounting_document(m);
  IF NOT (v_review->>'eligible')::boolean THEN RETURN v_review; END IF;

  RETURN v_review || jsonb_build_object('accounts', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name) ORDER BY a.code), '[]')
    FROM public.accounts a WHERE a.tenant_id = p_tenant_id AND a.is_active
      AND a.code <> v_review->'document'->>'treasury'
  ));
END;
$$;

CREATE OR REPLACE FUNCTION public.post_cash_accounting_document(
  p_tenant_id uuid, p_movement_id uuid, p_document jsonb, p_counterpart text, p_reference text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  m public.cash_movements;
  v_review jsonb;
  v_document jsonb;
  v_account public.accounts;
  v_reference text := NULLIF(btrim(p_reference), '');
  v_treasury text;
  v_debit text;
  v_credit text;
  v_result jsonb;
  v_entry_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM public.current_tenant_id()
     OR NOT public.current_user_can_manage_accounting() THEN
    RAISE EXCEPTION 'Accès refusé à la comptabilité de cette entreprise.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO m FROM public.cash_movements cm WHERE cm.tenant_id = p_tenant_id AND cm.id = p_movement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mouvement de caisse introuvable.'; END IF;
  IF m.accounting_status = 'accounted' AND EXISTS (
    SELECT 1 FROM public.journal_entries j
    WHERE j.tenant_id = p_tenant_id AND j.id = m.accounting_entry_id
      AND j.source_type = 'cash_movement' AND j.source_id = m.id AND j.status = 'posted'
      AND j.total_debit = m.amount AND j.total_credit = m.amount
  ) THEN
    RETURN jsonb_build_object('entry_id', m.accounting_entry_id, 'already_accounted', true);
  END IF;
  IF v_reference IS NULL OR length(v_reference) > 120 THEN
    RAISE EXCEPTION 'Renseignez une référence de justificatif de 120 caractères au maximum.';
  END IF;
  v_review := public._cash_accounting_document(m);
  v_document := v_review->'document';
  IF NOT (v_review->>'eligible')::boolean THEN RAISE EXCEPTION '%', v_review->>'reason'; END IF;
  IF v_document IS DISTINCT FROM p_document THEN RAISE EXCEPTION 'La pièce a changé. Relancez la vérification.'; END IF;

  IF m.kind = 'customer_prepayment' THEN
    PERFORM 1 FROM public.customer_prepayments p
    WHERE p.tenant_id = p_tenant_id AND p.id = (v_document->>'id')::uuid FOR SHARE;
  ELSE
    PERFORM 1 FROM public.sale_returns r
    WHERE r.tenant_id = p_tenant_id AND r.id = (v_document->>'id')::uuid FOR SHARE;
  END IF;
  IF NOT FOUND OR public._cash_accounting_document(m) IS DISTINCT FROM v_review THEN
    RAISE EXCEPTION 'La pièce a changé. Relancez la vérification.';
  END IF;

  v_treasury := v_document->>'treasury';
  SELECT * INTO v_account FROM public.accounts a
  WHERE a.tenant_id = p_tenant_id AND a.is_active AND a.code = p_counterpart AND a.code <> v_treasury;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sélectionnez une contrepartie active et distincte de la trésorerie.'; END IF;
  IF v_document->>'reference' IS DISTINCT FROM v_reference AND EXISTS (
    SELECT 1 FROM public.journal_entries j WHERE j.tenant_id = p_tenant_id AND j.reference = v_reference
      AND j.total_debit = m.amount AND j.total_credit = m.amount
  ) THEN
    RAISE EXCEPTION 'Une écriture de même référence et de même montant existe déjà.';
  END IF;
  v_debit := CASE WHEN m.kind = 'refund' THEN v_account.code ELSE v_treasury END;
  v_credit := CASE WHEN m.kind = 'refund' THEN v_treasury ELSE v_account.code END;

  v_result := public.create_manual_journal_entry(
    p_tenant_id, v_document->>'journal', (v_document->>'date')::date, v_document->>'label', v_reference,
    jsonb_build_array(
      jsonb_build_object('account_code', v_debit, 'debit', m.amount, 'credit', 0, 'label', v_document->>'label'),
      jsonb_build_object('account_code', v_credit, 'debit', 0, 'credit', m.amount, 'label', v_document->>'label')
    )
  );
  v_entry_id := (v_result->>'entry_id')::uuid;
  IF v_entry_id IS NULL THEN RAISE EXCEPTION 'Le journal n’a pas confirmé la comptabilisation.'; END IF;

  UPDATE public.journal_entries SET source_type = 'cash_movement', source_id = m.id
  WHERE tenant_id = p_tenant_id AND id = v_entry_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Impossible de rattacher l’écriture au mouvement.'; END IF;

  -- Third-party reporting uses the accounting line for the client's counterpart.
  IF v_account.class = 4 AND v_document->>'customer_id' IS NOT NULL THEN
    UPDATE public.journal_lines SET third_party_id = (v_document->>'customer_id')::uuid
    WHERE tenant_id = p_tenant_id AND entry_id = v_entry_id AND account_code = v_account.code;
  END IF;

  UPDATE public.cash_movements SET accounting_status = 'accounted', accounting_entry_id = v_entry_id
  WHERE tenant_id = p_tenant_id AND id = m.id;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.review_cash_accounting_document(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.post_cash_accounting_document(uuid, uuid, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_cash_accounting_document(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_cash_accounting_document(uuid, uuid, jsonb, text, text) TO authenticated;
