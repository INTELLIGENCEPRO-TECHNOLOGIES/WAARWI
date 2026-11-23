-- PC2D-A.1: review and post cash movements through their original accounting source.
-- Applying this migration does not change any data or post any entries.

CREATE INDEX IF NOT EXISTS cash_movements_accounting_review_idx
  ON public.cash_movements (tenant_id, created_at, id)
  WHERE accounting_status = 'not_accounted';
CREATE INDEX IF NOT EXISTS cash_movements_accounting_entry_idx
  ON public.cash_movements (accounting_entry_id)
  WHERE accounting_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_payments_cash_movement_idx
  ON public.customer_payments (cash_movement_id)
  WHERE cash_movement_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public._cash_accounting_decision(p_movement public.cash_movements)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = ''
AS $$
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
     OR m.created_at IS NULL OR NOT isfinite(m.created_at) THEN
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

  IF v_debit = v_credit THEN
    RETURN v_decision || jsonb_build_object('action', 'review', 'reason', 'Les comptes de débit et de crédit doivent être distincts.');
  END IF;
  RETURN v_decision || jsonb_build_object('action', 'post', 'source_type', v_source_type, 'source_id', v_source_id,
    'journal', v_journal, 'debit_account', v_debit, 'credit_account', v_credit);
END;
$$;

REVOKE ALL ON FUNCTION public._cash_accounting_decision(public.cash_movements) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.review_cash_accounting(
  p_tenant_id uuid, p_date_from date, p_date_to date,
  p_after_time timestamptz DEFAULT NULL, p_after_id uuid DEFAULT NULL
)
RETURNS TABLE (id uuid, created_at timestamptz, kind text, label text, decision jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM public.current_tenant_id()
     OR NOT public.current_user_can_manage_accounting() THEN
    RAISE EXCEPTION 'Accès refusé à la comptabilité de cette entreprise.' USING ERRCODE = '42501';
  END IF;
  IF p_date_from IS NULL OR p_date_to IS NULL OR NOT isfinite(p_date_from) OR NOT isfinite(p_date_to)
     OR p_date_to < p_date_from
     OR p_date_to - p_date_from > 366 OR (p_after_time IS NULL) <> (p_after_id IS NULL) THEN
    RAISE EXCEPTION 'Sélectionnez une période d’un an au maximum.';
  END IF;

  RETURN QUERY
  WITH page AS MATERIALIZED (
    SELECT cm.* FROM public.cash_movements cm
    WHERE cm.tenant_id = p_tenant_id AND cm.accounting_status = 'not_accounted'
      AND cm.created_at >= (p_date_from::timestamp AT TIME ZONE 'UTC')
      AND cm.created_at < ((p_date_to + 1)::timestamp AT TIME ZONE 'UTC')
      AND (p_after_time IS NULL OR (cm.created_at, cm.id) > (p_after_time, p_after_id))
    ORDER BY cm.created_at, cm.id
    LIMIT 26
  )
  SELECT p.id, p.created_at, p.kind, COALESCE(NULLIF(p.reason, ''), 'Mouvement de caisse'),
    public._cash_accounting_decision(p::public.cash_movements)
  FROM page p
  ORDER BY p.created_at, p.id;
END;
$$;

-- Reuse the same decision at write time. The old service RPC remains callable
-- only by its existing roles and shares this corrected posting implementation.
CREATE OR REPLACE FUNCTION public._apply_cash_accounting(p_tenant_id uuid, p_movement_id uuid, p_expected jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  m public.cash_movements;
  v_decision jsonb;
  v_entry_id uuid;
  v_piece text;
  v_label text;
  v_payment_result jsonb;
  v_payment_link jsonb;
BEGIN
  SELECT * INTO m FROM public.cash_movements cm
  WHERE cm.id = p_movement_id AND (p_tenant_id IS NULL OR cm.tenant_id = p_tenant_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Mouvement de caisse introuvable.');
  END IF;

  -- Competing transfers for the same vault movement must serialize.
  IF m.vault_movement_id IS NOT NULL THEN
    PERFORM 1 FROM public.vault_movements vm
    WHERE vm.id = m.vault_movement_id AND vm.tenant_id = m.tenant_id FOR UPDATE;
  END IF;
  v_decision := public._cash_accounting_decision(m);

  IF m.accounting_status = 'accounted' AND v_decision->>'action' = 'link'
     AND m.accounting_entry_id = (v_decision->>'entry_id')::uuid THEN
    RETURN jsonb_build_object('success', true, 'outcome', 'already_accounted', 'entry_id', m.accounting_entry_id);
  END IF;
  IF p_expected IS NOT NULL AND p_expected IS DISTINCT FROM v_decision THEN
    RETURN jsonb_build_object('success', false, 'error', 'Le mouvement ou sa contrepartie a changé. Actualisez le contrôle.');
  END IF;

  CASE v_decision->>'action'
    WHEN 'excluded' THEN
      RETURN jsonb_build_object('success', true, 'skipped', true, 'reason', v_decision->>'reason');
    WHEN 'link' THEN
      v_entry_id := (v_decision->>'entry_id')::uuid;
      -- An existing entry can cover only one cash movement. Use its row lock
      -- before a second check across cash movements, including legacy matches.
      PERFORM 1 FROM public.journal_entries j
      WHERE j.id = v_entry_id AND j.tenant_id = m.tenant_id FOR UPDATE;
      IF public._cash_accounting_decision(m) IS DISTINCT FROM v_decision THEN
        RETURN jsonb_build_object('success', false, 'error', 'L’écriture a changé. Actualisez le contrôle.');
      END IF;
    WHEN 'post_payment' THEN
      BEGIN
        IF v_decision->>'source_type' = 'payment' THEN
          v_payment_result := public.comptabiliser_reglement((v_decision->>'source_id')::uuid);
        ELSE
          v_payment_result := public.comptabiliser_reglement_solde_client((v_decision->>'source_id')::uuid);
        END IF;
        v_payment_link := public._cash_accounting_decision(m);
        IF v_payment_link->>'action' IS DISTINCT FROM 'link' THEN
          RAISE EXCEPTION '%', COALESCE(v_payment_result->>'error', 'Le règlement ne peut pas être comptabilisé.');
        END IF;
        v_entry_id := (v_payment_link->>'entry_id')::uuid;
        v_piece := v_payment_link->>'entry_number';
        PERFORM 1 FROM public.journal_entries j WHERE j.id = v_entry_id AND j.tenant_id = m.tenant_id FOR UPDATE;
        IF public._cash_accounting_decision(m) IS DISTINCT FROM v_payment_link THEN
          RAISE EXCEPTION 'L’écriture a changé. Actualisez le contrôle.';
        END IF;
      EXCEPTION WHEN raise_exception THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
      END;
    WHEN 'post' THEN
      v_piece := public.next_accounting_piece_number(m.tenant_id, v_decision->>'journal');
      v_label := COALESCE(NULLIF(m.reason, ''), 'Mouvement de caisse');
      INSERT INTO public.journal_entries (tenant_id, entry_number, journal_type, entry_date, reference,
        description, total_debit, total_credit, is_balanced, source_type, source_id, status, posted_at, posted_by)
      VALUES (m.tenant_id, v_piece, v_decision->>'journal', (v_decision->>'date')::date,
        COALESCE(m.reference, ''), v_label, m.amount, m.amount, true,
        v_decision->>'source_type', (v_decision->>'source_id')::uuid, 'posted', now(), auth.uid())
      RETURNING id INTO v_entry_id;

      INSERT INTO public.journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label)
      SELECT m.tenant_id, v_entry_id, a.code, a.name, line.debit, line.credit, v_label
      FROM (VALUES (v_decision->>'debit_account', m.amount, 0::numeric),
                   (v_decision->>'credit_account', 0::numeric, m.amount)) AS line(code, debit, credit)
      JOIN public.accounts a ON a.tenant_id = m.tenant_id AND a.code = line.code AND a.is_active;
      IF NOT FOUND OR (SELECT count(*) FROM public.journal_lines jl WHERE jl.entry_id = v_entry_id AND jl.tenant_id = m.tenant_id) <> 2 THEN
        RAISE EXCEPTION 'Un compte a changé pendant la comptabilisation. Actualisez le contrôle.';
      END IF;
    ELSE
      RETURN jsonb_build_object('success', false, 'error', v_decision->>'reason');
  END CASE;

  UPDATE public.cash_movements SET accounting_status = 'accounted', accounting_entry_id = v_entry_id
  WHERE id = m.id AND tenant_id = m.tenant_id;
  RETURN jsonb_build_object('success', true, 'outcome', v_decision->>'action', 'entry_id', v_entry_id,
    'piece_number', COALESCE(v_piece, v_decision->>'entry_number'),
    'journal', v_decision->>'journal', 'total', m.amount);
END;
$$;

REVOKE ALL ON FUNCTION public._apply_cash_accounting(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.comptabiliser_depense(p_movement_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public._apply_cash_accounting(NULL, p_movement_id, NULL);
$$;

REVOKE ALL ON FUNCTION public.comptabiliser_depense(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comptabiliser_depense(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_cash_accounting(p_tenant_id uuid, p_movements jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_result jsonb;
  v_results jsonb := '[]';
BEGIN
  IF auth.uid() IS NULL OR p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM public.current_tenant_id()
     OR NOT public.current_user_can_manage_accounting() THEN
    RAISE EXCEPTION 'Accès refusé à la comptabilité de cette entreprise.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_movements) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Sélection de mouvements invalide.';
  END IF;
  IF jsonb_array_length(p_movements) NOT BETWEEN 1 AND 25 THEN
    RAISE EXCEPTION 'Sélectionnez de 1 à 25 mouvements.';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_movements) ORDER BY value->>'id' LOOP
    IF v_item->'decision'->>'action' IN ('link', 'post', 'post_payment')
       AND (jsonb_array_length(p_movements) = 1 OR v_item->'decision'->>'action' = 'link') THEN
      v_result := public._apply_cash_accounting(p_tenant_id, (v_item->>'id')::uuid, v_item->'decision');
    ELSE
      v_result := jsonb_build_object('success', false, 'error', 'Un aperçu à jour est nécessaire. Validez chaque nouvelle écriture séparément.');
    END IF;
    v_results := v_results || jsonb_build_array(v_result || jsonb_build_object('id', v_item->>'id'));
  END LOOP;
  RETURN v_results;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_accounting_vault_accounts(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM public.current_tenant_id()
     OR NOT public.current_user_can_manage_accounting() THEN
    RAISE EXCEPTION 'Accès refusé à la comptabilité de cette entreprise.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'vaults', (
      SELECT COALESCE(jsonb_agg(to_jsonb(v) ORDER BY v.site_name, v.name, v.id), '[]')
      FROM (
        SELECT v.id, v.name, v.account_code, s.name AS site_name, v.is_active
        FROM public.vaults v
        JOIN public.sites s ON s.id = v.site_id AND s.tenant_id = v.tenant_id
        WHERE v.tenant_id = p_tenant_id
      ) v
    ),
    'accounts', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name) ORDER BY a.code), '[]')
      FROM public.accounts a WHERE a.tenant_id = p_tenant_id AND a.is_active AND a.class = 5
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_accounting_vault_account(
  p_tenant_id uuid, p_vault_id uuid, p_account_code text, p_previous_account_code text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM public.current_tenant_id()
     OR NOT public.current_user_can_manage_accounting() THEN
    RAISE EXCEPTION 'Accès refusé à la comptabilité de cette entreprise.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.accounts a WHERE a.tenant_id = p_tenant_id AND a.code = p_account_code AND a.is_active AND a.class = 5
  ) THEN
    RAISE EXCEPTION 'Sélectionnez un compte de trésorerie actif.';
  END IF;
  UPDATE public.vaults v SET account_code = p_account_code, updated_at = now()
  WHERE v.tenant_id = p_tenant_id AND v.id = p_vault_id
    AND v.account_code IS NOT DISTINCT FROM p_previous_account_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'Le compte du coffre a changé ou le coffre est introuvable.'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.review_cash_accounting(uuid, date, date, timestamptz, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_cash_accounting(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_accounting_vault_accounts(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_accounting_vault_account(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_cash_accounting(uuid, date, date, timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_cash_accounting(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_accounting_vault_accounts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_accounting_vault_account(uuid, uuid, text, text) TO authenticated;
