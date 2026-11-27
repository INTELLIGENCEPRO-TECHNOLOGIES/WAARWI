-- Allow journal-independent models and field rules while retaining previously saved models.
ALTER TABLE public.accounting_entry_templates
  ALTER COLUMN journal_code DROP NOT NULL,
  ADD CONSTRAINT accounting_template_schedule_requires_journal
    CHECK (next_due_on IS NULL OR journal_code IS NOT NULL);

CREATE FUNCTION public.write_accounting_entry_template(
  p_tenant_id uuid,
  p_id uuid,
  p_revision bigint,
  p_name text,
  p_journal_code text,
  p_description text,
  p_lines jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  current_template public.accounting_entry_templates%ROWTYPE;
  template_id uuid;
  template_revision bigint;
  selected_journal text := nullif(btrim(p_journal_code), '');
  line jsonb;
  line_number integer := 0;
  account_code text;
  line_label text;
  account_rule text;
  label_rule text;
  amount_rule text;
  amount_side text;
  previous_amount_rule text;
  debit numeric;
  credit numeric;
  total_debit numeric := 0;
  total_credit numeric := 0;
  all_fixed boolean := true;
  can_debit boolean := false;
  can_credit boolean := false;
  balancing_lines integer := 0;
  clean_lines jsonb := '[]'::jsonb;
BEGIN
  PERFORM public._bank_reconciliation_access(p_tenant_id, true);
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 100
     OR p_description IS NULL OR length(btrim(p_description)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Intitulé du modèle et libellé de l’écriture obligatoires.' USING ERRCODE = '22023';
  END IF;
  IF selected_journal IS NOT NULL AND NOT public._accounting_journal_allowed(p_tenant_id, selected_journal, true) THEN
    RAISE EXCEPTION 'Journal inactif ou inconnu.' USING ERRCODE = '22023';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'Lignes de modèle invalides.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_lines) NOT BETWEEN 2 AND 500 THEN
    RAISE EXCEPTION 'De 2 à 500 lignes requises.' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT * INTO current_template
      FROM public.accounting_entry_templates t
      WHERE t.tenant_id = p_tenant_id AND t.id = p_id AND t.is_active FOR UPDATE;
    IF NOT FOUND OR current_template.revision IS DISTINCT FROM p_revision THEN
      RAISE EXCEPTION 'Modèle absent ou modifié. Actualisez puis réessayez.' USING ERRCODE = '40001';
    END IF;
    IF current_template.next_due_on IS NOT NULL AND selected_journal IS DISTINCT FROM current_template.journal_code THEN
      RAISE EXCEPTION 'Le journal d’un modèle planifié est conservé.' USING ERRCODE = '22023';
    END IF;
  END IF;

  PERFORM 1 FROM public.accounts a
    WHERE a.tenant_id = p_tenant_id
      AND a.code IN (SELECT btrim(x->>'account_code') FROM jsonb_array_elements(p_lines) x WHERE x->>'account_rule' = 'fixed')
    ORDER BY a.code FOR SHARE;

  FOR line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    line_number := line_number + 1;
    account_rule := line->>'account_rule';
    label_rule := line->>'label_rule';
    amount_rule := line->>'amount_rule';
    amount_side := line->>'amount_side';
    IF jsonb_typeof(line) <> 'object'
       OR account_rule IS NULL OR account_rule NOT IN ('fixed','input','repeat')
       OR label_rule IS NULL OR label_rule NOT IN ('fixed','input','repeat')
       OR amount_rule IS NULL OR amount_rule NOT IN ('fixed','input','repeat','balance')
       OR amount_side IS NULL OR amount_side NOT IN ('debit','credit','auto')
       OR (amount_side = 'auto' AND amount_rule <> 'balance') THEN
      RAISE EXCEPTION 'Règle du modèle invalide à la ligne %.', line_number USING ERRCODE = '22023';
    END IF;
    IF line_number = 1 AND 'repeat' IN (account_rule, label_rule, amount_rule) THEN
      RAISE EXCEPTION 'La première ligne ne peut pas répéter une valeur.' USING ERRCODE = '22023';
    END IF;
    IF amount_rule = 'repeat' AND previous_amount_rule = 'balance' THEN
      RAISE EXCEPTION 'La ligne % ne peut pas répéter le montant de la ligne d’équilibrage.', line_number USING ERRCODE = '22023';
    END IF;

    account_code := CASE WHEN account_rule = 'fixed' THEN coalesce(btrim(line->>'account_code'), '') ELSE '' END;
    line_label := CASE WHEN label_rule = 'fixed' THEN coalesce(btrim(line->>'label'), '') ELSE '' END;
    IF account_rule = 'fixed' AND NOT EXISTS (
      SELECT 1 FROM public.accounts a WHERE a.tenant_id = p_tenant_id AND a.code = account_code AND a.is_active
    ) THEN
      RAISE EXCEPTION 'Choisissez un compte actif à la ligne %.', line_number USING ERRCODE = '22023';
    END IF;
    IF length(line_label) > 500 THEN
      RAISE EXCEPTION 'Le libellé de la ligne % dépasse 500 caractères.', line_number USING ERRCODE = '22023';
    END IF;

    debit := 0;
    credit := 0;
    IF amount_rule = 'fixed' THEN
      IF coalesce(line->>'debit', '0') !~ '^[0-9]{1,13}(\.[0-9]{1,2})?$'
         OR coalesce(line->>'credit', '0') !~ '^[0-9]{1,13}(\.[0-9]{1,2})?$' THEN
        RAISE EXCEPTION 'Montant fixe invalide à la ligne %.', line_number USING ERRCODE = '22023';
      END IF;
      debit := coalesce((line->>'debit')::numeric, 0);
      credit := coalesce((line->>'credit')::numeric, 0);
      IF (amount_side = 'debit' AND (debit <= 0 OR credit <> 0))
         OR (amount_side = 'credit' AND (credit <= 0 OR debit <> 0)) THEN
        RAISE EXCEPTION 'Montant positif requis dans le sens choisi à la ligne %.', line_number USING ERRCODE = '22023';
      END IF;
      total_debit := total_debit + debit;
      total_credit := total_credit + credit;
    ELSE
      all_fixed := false;
      IF amount_rule = 'balance' THEN
        balancing_lines := balancing_lines + 1;
      END IF;
    END IF;

    can_debit := can_debit OR amount_side IN ('debit','auto');
    can_credit := can_credit OR amount_side IN ('credit','auto');
    previous_amount_rule := amount_rule;
    clean_lines := clean_lines || jsonb_build_array(jsonb_build_object(
      'account_code', account_code, 'label', line_label, 'debit', debit, 'credit', credit,
      'account_rule', account_rule, 'label_rule', label_rule, 'amount_rule', amount_rule, 'amount_side', amount_side
    ));
  END LOOP;

  IF balancing_lines > 1 THEN
    RAISE EXCEPTION 'Le modèle accepte une seule ligne d’équilibrage.' USING ERRCODE = '22023';
  END IF;
  IF NOT can_debit OR NOT can_credit OR (all_fixed AND total_debit <> total_credit)
     OR greatest(total_debit, total_credit) > 90071992547409 THEN
    RAISE EXCEPTION 'Contrôlez les sens, les montants fixes et l’équilibre du modèle.' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.accounting_entry_templates (tenant_id, name, journal_code, description, lines, updated_by)
      VALUES (p_tenant_id, btrim(p_name), selected_journal, btrim(p_description), clean_lines, auth.uid())
      RETURNING id, revision INTO template_id, template_revision;
  ELSE
    UPDATE public.accounting_entry_templates t
      SET name = btrim(p_name), journal_code = selected_journal,
          description = btrim(p_description), lines = clean_lines, revision = t.revision + 1,
          updated_at = now(), updated_by = auth.uid()
      WHERE t.tenant_id = p_tenant_id AND t.id = p_id
      RETURNING t.id, t.revision INTO template_id, template_revision;
  END IF;

  RETURN jsonb_build_object('success', true, 'id', template_id, 'revision', template_revision);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Un modèle porte déjà cet intitulé.' USING ERRCODE = '23505';
END;
$$;

REVOKE ALL ON FUNCTION public.write_accounting_entry_template(uuid,uuid,bigint,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.write_accounting_entry_template(uuid,uuid,bigint,text,text,text,jsonb) TO authenticated;
