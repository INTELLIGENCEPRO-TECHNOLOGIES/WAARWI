-- Pending audit hardening; no historical automatic corrections.
CREATE UNIQUE INDEX uq_accounting_vault_source ON public.journal_entries(tenant_id,source_id)
 WHERE source_type='vault_movement' AND source_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public._cash_accounting_decision(p_movement cash_movements)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  m public.cash_movements := p_movement;
  v_decision jsonb;
  v_source_type text := 'cash_movement';
  v_source_id uuid := m.id;
  v_candidates uuid[];
  v_entries uuid[];
  v_entry public.journal_entries;
  v_vault_code text;
  v_treasury_code text;
  v_payment_type text;
  v_debit text;
  v_credit text;
  v_journal text;
  v_operation_date date := (m.created_at AT TIME ZONE 'UTC')::date;
BEGIN
  v_decision := jsonb_build_object('amount', m.amount, 'date', v_operation_date);

  IF m.accounting_status = 'excluded' OR m.supplier_id IS NOT NULL THEN
    RETURN v_decision || jsonb_build_object('action', 'excluded', 'reason', 'Règlement à traiter via les règlements fournisseurs ou mouvement déjà exclu.');
  END IF;

  IF m.amount IS NULL OR m.amount <= 0 OR m.amount IN ('NaN'::numeric, 'Infinity'::numeric)
     OR round(m.amount,2)<>m.amount OR m.created_at IS NULL OR NOT isfinite(m.created_at) THEN
    RETURN v_decision || jsonb_build_object('action', 'review', 'reason', 'Montant ou date de mouvement invalide.');
  END IF;

  IF m.kind = 'income' THEN
    SELECT ARRAY(SELECT cp.id FROM public.customer_payments cp
      WHERE cp.tenant_id = m.tenant_id AND cp.cash_movement_id = m.id
      LIMIT 2) INTO v_candidates;

    IF cardinality(v_candidates) > 0 THEN
      IF cardinality(v_candidates) <> 1 OR NOT EXISTS (
        SELECT 1 FROM public.customer_payments cp
        WHERE cp.id = v_candidates[1] AND cp.tenant_id = m.tenant_id
          AND cp.customer_id = m.customer_id AND cp.amount = m.amount AND cp.status = 'confirmed'
      ) THEN
        RETURN v_decision || jsonb_build_object('action', 'review', 'reason', 'Lien avec le règlement client ambigu ou incohérent.');
      END IF;
      v_source_type := 'customer_payment';
      v_source_id := v_candidates[1];

    ELSIF m.reason LIKE 'Règlement %' AND m.reason NOT LIKE 'Règlement solde%'
        AND m.reason NOT LIKE 'Règlement report de solde%' THEN
      -- The legacy POS wrote both rows in the same transaction. The same day
      -- alone is ambiguous when a customer made two identical instalments.
      SELECT ARRAY(
        SELECT sp.id
        FROM public.sales s
        JOIN public.sale_payments sp ON sp.sale_id = s.id AND sp.tenant_id = s.tenant_id
        WHERE s.tenant_id = m.tenant_id AND s.sale_number = m.reference
          AND m.reason = 'Règlement ' || s.sale_number
          AND s.customer_id IS NOT DISTINCT FROM m.customer_id
          AND sp.cash_session_id = m.cash_session_id AND sp.payment_method_id = m.payment_method_id
          AND sp.amount = m.amount AND sp.created_at = m.created_at
        LIMIT 2
      ) INTO v_candidates;

      IF cardinality(v_candidates) <> 1 THEN
        RETURN v_decision || jsonb_build_object('action', 'review', 'reason', 'Règlement de facture à rapprocher manuellement.');
      END IF;
      v_source_type := 'payment';
      v_source_id := v_candidates[1];
    END IF;
  END IF;

  IF m.kind IN ('vault_deposit', 'vault_withdrawal') THEN
    SELECT NULLIF(btrim(v.account_code), '') INTO v_vault_code
    FROM public.vault_movements vm
    JOIN public.vaults v ON v.id = vm.vault_id AND v.tenant_id = vm.tenant_id AND v.site_id = vm.site_id
    WHERE vm.id = m.vault_movement_id AND vm.tenant_id = m.tenant_id AND vm.site_id = m.site_id
      AND vm.cash_session_id = m.cash_session_id AND vm.amount = m.amount
      AND vm.kind = CASE WHEN m.kind = 'vault_deposit' THEN 'cash_deposit' ELSE 'cash_withdrawal' END
      AND vm.direction = CASE WHEN m.kind = 'vault_deposit' THEN 'in' ELSE 'out' END;
    IF NOT FOUND OR EXISTS (
      SELECT 1 FROM public.cash_movements other
      WHERE other.tenant_id = m.tenant_id AND other.vault_movement_id = m.vault_movement_id AND other.id <> m.id
    ) THEN
      RETURN v_decision || jsonb_build_object('action', 'review', 'reason', 'Contrepartie du coffre manquante, incohérente ou déjà associée à un autre mouvement.');
    END IF;
    v_source_type := 'vault_movement';
    v_source_id := m.vault_movement_id;
  END IF;

  -- A journal source may exist even when the movement or payment status is stale.
  SELECT ARRAY(
    SELECT j.id FROM public.journal_entries j
    WHERE j.tenant_id = m.tenant_id AND (
      (j.source_type = v_source_type AND j.source_id = v_source_id)
      OR (j.source_type = 'cash_movement' AND j.source_id = m.id)
    )
    LIMIT 2
  ) INTO v_entries;

  IF cardinality(v_entries) > 1 THEN
    RETURN v_decision || jsonb_build_object('action', 'review', 'reason', 'Plusieurs écritures existent pour cette opération.');
  ELSIF cardinality(v_entries) = 1 THEN
    SELECT * INTO v_entry FROM public.journal_entries WHERE tenant_id = m.tenant_id AND id = v_entries[1];
    IF v_entry.status IS DISTINCT FROM 'posted'
       OR v_entry.is_balanced IS DISTINCT FROM true
       OR v_entry.total_debit IS DISTINCT FROM m.amount OR v_entry.total_credit IS DISTINCT FROM m.amount
       OR (m.accounting_entry_id IS NOT NULL AND m.accounting_entry_id <> v_entry.id)
       OR (v_source_type IN ('payment', 'customer_payment') AND v_entry.source_type <> v_source_type)
       OR EXISTS (
         SELECT 1 FROM public.cash_movements other
         WHERE other.tenant_id = m.tenant_id AND other.accounting_entry_id = v_entry.id AND other.id <> m.id
       )
       OR NOT EXISTS (
         SELECT FROM public.journal_lines jl WHERE jl.tenant_id = m.tenant_id AND jl.entry_id = v_entry.id
         HAVING sum(jl.debit) = m.amount AND sum(jl.credit) = m.amount
       ) THEN
      RETURN v_decision || jsonb_build_object('action', 'review', 'reason', 'L’écriture existante doit être vérifiée.');
    END IF;
    RETURN v_decision || jsonb_build_object('action', 'link', 'entry_id', v_entry.id, 'entry_number', v_entry.entry_number);
  ELSIF m.accounting_entry_id IS NOT NULL OR m.accounting_status = 'accounted' THEN
    RETURN v_decision || jsonb_build_object('action', 'review', 'reason', 'Le lien comptable actuel est incohérent.');
  END IF;

  IF v_source_type IN ('payment', 'customer_payment') THEN
    -- Keep the existing client payment RPCs responsible for the accounts and
    -- eligibility of their source. The cash operation only links that entry.
    RETURN v_decision || jsonb_build_object('action', 'post_payment',
      'source_type', v_source_type, 'source_id', v_source_id);
  END IF;

  IF m.kind NOT IN ('income', 'expense', 'vault_deposit', 'vault_withdrawal')
     OR m.customer_id IS NOT NULL OR m.sale_return_id IS NOT NULL
     OR (m.kind = 'income' AND m.reason LIKE 'Règlement%')
     OR (m.kind IN ('income', 'expense') AND m.vault_movement_id IS NOT NULL) THEN
    RETURN v_decision || jsonb_build_object('action', 'review', 'reason', 'Contrepartie à vérifier à partir de la pièce d’origine.');
  END IF;

  SELECT NULLIF(btrim(pm.account_code), ''), pm.payment_type INTO v_treasury_code, v_payment_type
  FROM public.payment_methods pm
  JOIN public.accounts a ON a.tenant_id = pm.tenant_id AND a.code = btrim(pm.account_code)
    AND a.is_active AND a.class = 5
  WHERE pm.id = m.payment_method_id AND pm.tenant_id = m.tenant_id;

  IF v_treasury_code IS NULL OR v_payment_type IS NULL
     OR v_payment_type NOT IN ('cash', 'bank', 'mobile', 'card', 'check')
     OR (v_source_type = 'vault_movement' AND v_payment_type <> 'cash') THEN
    RETURN v_decision || jsonb_build_object('action', 'review', 'reason', 'Compte de trésorerie actif à renseigner sur le mode de paiement.');
  END IF;

  v_journal := CASE WHEN v_payment_type = 'cash' THEN 'CA' ELSE 'BQ' END;
  IF v_source_type = 'vault_movement' THEN
    IF v_vault_code IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.accounts a WHERE a.tenant_id = m.tenant_id AND a.code = v_vault_code AND a.is_active AND a.class = 5
    ) THEN
      RETURN v_decision || jsonb_build_object('action', 'review', 'reason', 'Compte comptable du coffre à renseigner.');
    END IF;
    IF m.kind = 'vault_deposit' THEN
      v_debit := v_vault_code;
      v_credit := v_treasury_code;
    ELSE
      v_debit := v_treasury_code;
      v_credit := v_vault_code;
    END IF;
  ELSE
    BEGIN
      IF m.kind = 'income' THEN
        v_debit := v_treasury_code;
        v_credit := public.resolve_account(m.tenant_id, 'MISC_INCOME');
      ELSE
        v_debit := public.resolve_account(m.tenant_id, 'MISC_EXPENSE');
        v_credit := v_treasury_code;
      END IF;
    EXCEPTION WHEN raise_exception THEN
      RETURN v_decision || jsonb_build_object('action', 'review', 'reason', 'Compte de contrepartie à renseigner dans le plan comptable.');
    END;
  END IF;

  IF v_operation_date>(now() AT TIME ZONE 'Africa/Dakar')::date OR extract(year FROM v_operation_date)<>extract(year FROM CURRENT_DATE) THEN
    RETURN v_decision||jsonb_build_object('action','review','reason','Date hors exercice courant : numérotation à régulariser.');
  END IF;
  IF v_source_type='cash_movement' AND (
    (m.kind='income' AND NOT EXISTS(SELECT 1 FROM public.accounts a WHERE a.tenant_id=m.tenant_id AND a.code=v_credit AND a.is_active AND a.class=7))
    OR (m.kind='expense' AND NOT EXISTS(SELECT 1 FROM public.accounts a WHERE a.tenant_id=m.tenant_id AND a.code=v_debit AND a.is_active AND a.class=6))
  ) THEN RETURN v_decision||jsonb_build_object('action','review','reason','Contrepartie de charge ou de produit active requise.');END IF;
  IF v_debit = v_credit THEN
    RETURN v_decision || jsonb_build_object('action', 'review', 'reason', 'Les comptes de débit et de crédit doivent être distincts.');
  END IF;
  RETURN v_decision || jsonb_build_object('action', 'post', 'source_type', v_source_type, 'source_id', v_source_id,
    'journal', v_journal, 'debit_account', v_debit, 'credit_account', v_credit);
END;
$function$;

CREATE OR REPLACE FUNCTION public._cash_accounting_document(p_movement cash_movements)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
     OR round(m.amount,2)<>m.amount OR m.vault_movement_id IS NOT NULL THEN
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
    IF v_return.vat_net_amount IS NOT NULL OR v_sale.vat_amount IS DISTINCT FROM 0::numeric THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.auto_apply_customer_avoirs(p_sale_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_tenant_id uuid;
v_customer_id uuid;
BEGIN
IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentification requise' USING ERRCODE='42501';END IF;
v_tenant_id := current_tenant_id();
IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;

SELECT customer_id INTO v_customer_id FROM public.sales
WHERE id = p_sale_id AND tenant_id = v_tenant_id;

IF v_customer_id IS NULL THEN RETURN jsonb_build_object('applied', 0); END IF;

RETURN public._apply_avoirs_internal(v_customer_id, v_tenant_id);
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
    SELECT * INTO STRICT v_movement FROM public.cash_movements m WHERE m.tenant_id = v_tenant_id
      AND m.sale_return_id = v_return.id AND m.kind = 'refund' AND m.amount = v_return.total
      AND m.site_id = v_return.site_id AND m.cash_session_id = v_return.refund_cash_session_id FOR UPDATE;
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
REVOKE ALL ON FUNCTION public.auto_apply_customer_avoirs(uuid),public.post_vat_sale_return(uuid),public._cash_accounting_decision(public.cash_movements),public._cash_accounting_document(public.cash_movements) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.auto_apply_customer_avoirs(uuid),public.post_vat_sale_return(uuid) TO authenticated;
