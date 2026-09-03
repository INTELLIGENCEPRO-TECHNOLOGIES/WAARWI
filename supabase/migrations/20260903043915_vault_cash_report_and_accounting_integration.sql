/*
  # Coffre — intégration au rapport de caisse et à la comptabilité

  ## 1. get_cash_report(...)
  Ajout de deux lignes distinctes, sans jamais les compter comme chiffre d'affaires,
  achat ou dépense :
    - transferts_depuis_coffre : espèces entrées dans la caisse en provenance du coffre
      (mouvements de caisse kind='vault_withdrawal') ;
    - versements_au_coffre : espèces sorties de la caisse vers le coffre
      (mouvements de caisse kind='vault_deposit').
  Ces flux sont désormais pris en compte dans le solde physique de caisse
  (total_entrees / total_sorties / solde_theorique) et dans les ventilations par mode
  et par jour, mais restent EXCLUS de encaissements_reels (assimilable au chiffre
  d'affaires encaissé) et de reglements_fournisseurs / depenses_payees.
  Non-régression : aucun tenant n'ayant de mouvement de coffre, la sortie est identique
  à l'existant pour toutes les données actuelles.

  ## 2. comptabiliser_reglement_fournisseur(p_payment_id)
  Lorsque le règlement a funding_source='vault', la contrepartie de trésorerie est le
  compte comptable du coffre (vaults.account_code). Si ce compte n'est pas configuré ou
  n'existe pas dans le plan comptable, la fonction renvoie une erreur explicite et ne
  passe AUCUNE écriture (jamais de repli silencieux). Le comportement caisse existant est
  strictement inchangé.
*/

-- =====================================================================
-- 1) get_cash_report
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_cash_report(
  p_site_id uuid DEFAULT NULL::uuid,
  p_from date DEFAULT CURRENT_DATE,
  p_to date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_tz        text;
  v_ts_from   timestamptz;
  v_ts_to     timestamptz;
  v_summary   jsonb;
  v_fonds     numeric := 0;
  v_reg_cli   numeric := 0;
  v_autres_in numeric := 0;
  v_reg_four  numeric := 0;
  v_depenses  numeric := 0;
  v_rembours  numeric := 0;
  v_autres_out numeric := 0;
  v_transf_coffre numeric := 0;   -- coffre -> caisse (entrée physique)
  v_vers_coffre   numeric := 0;   -- caisse -> coffre (sortie physique)
  v_tot_in    numeric := 0;
  v_tot_out   numeric := 0;
  v_par_mode  jsonb;
  v_par_jour  jsonb;
  v_articles  jsonb;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_site_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sites WHERE id = p_site_id AND tenant_id = v_tenant_id
  ) THEN RAISE EXCEPTION 'Site not authorized'; END IF;

  SELECT COALESCE(NULLIF(settings->>'timezone', ''), 'Africa/Dakar') INTO v_tz FROM tenants WHERE id = v_tenant_id;
  v_tz := COALESCE(v_tz, 'Africa/Dakar');
  v_ts_from := (p_from::timestamp AT TIME ZONE v_tz);
  v_ts_to   := ((p_to + 1)::timestamp AT TIME ZONE v_tz);

  -- Activité commerciale + rentabilité (moteur central déjà corrigé)
  v_summary := get_financial_summary(p_site_id, p_from, p_to);

  -- Fonds d'ouverture
  SELECT COALESCE(SUM(cs.opening_amount), 0) INTO v_fonds
  FROM cash_sessions cs
  WHERE cs.tenant_id = v_tenant_id
    AND cs.opened_at >= v_ts_from AND cs.opened_at < v_ts_to
    AND (p_site_id IS NULL OR cs.site_id = p_site_id);

  -- Agrégats du registre de caisse par grande catégorie (+ lignes coffre distinctes)
  SELECT
    COALESCE(SUM(CASE WHEN cm.kind = 'income' AND cm.customer_id IS NOT NULL THEN cm.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN cm.kind = 'income' AND cm.customer_id IS NULL THEN cm.amount
                      WHEN cm.kind = 'customer_prepayment' THEN cm.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN cm.kind = 'expense' AND cm.supplier_id IS NOT NULL THEN cm.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN cm.kind = 'expense' AND cm.supplier_id IS NULL THEN cm.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN cm.kind = 'refund' THEN cm.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN cm.kind IN ('customer_loan', 'customer_withdrawal') THEN cm.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN cm.kind = 'vault_withdrawal' THEN cm.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN cm.kind = 'vault_deposit' THEN cm.amount ELSE 0 END), 0)
  INTO v_reg_cli, v_autres_in, v_reg_four, v_depenses, v_rembours, v_autres_out, v_transf_coffre, v_vers_coffre
  FROM cash_movements cm
  WHERE cm.tenant_id = v_tenant_id
    AND cm.created_at >= v_ts_from AND cm.created_at < v_ts_to
    AND (p_site_id IS NULL OR cm.site_id = p_site_id);

  -- Encaissements « réels » (assimilables au CA encaissé) : hors transferts de coffre
  v_tot_in  := v_reg_cli + v_autres_in;
  v_tot_out := v_reg_four + v_depenses + v_rembours + v_autres_out;

  -- Ventilation par mode de règlement (inclut les flux physiques de coffre)
  SELECT COALESCE(jsonb_agg(m ORDER BY (m->>'net')::numeric DESC), '[]'::jsonb) INTO v_par_mode
  FROM (
    SELECT jsonb_build_object(
      'method', COALESCE(NULLIF(cm.method_name, ''), 'Non précisé'),
      'entrees', COALESCE(SUM(CASE WHEN cm.kind IN ('income','customer_prepayment','vault_withdrawal') THEN cm.amount ELSE 0 END), 0),
      'sorties', COALESCE(SUM(CASE WHEN cm.kind IN ('expense','refund','customer_loan','customer_withdrawal','vault_deposit') THEN cm.amount ELSE 0 END), 0),
      'net', COALESCE(SUM(CASE WHEN cm.kind IN ('income','customer_prepayment','vault_withdrawal') THEN cm.amount
                              WHEN cm.kind IN ('expense','refund','customer_loan','customer_withdrawal','vault_deposit') THEN -cm.amount ELSE 0 END), 0)
    ) AS m
    FROM cash_movements cm
    WHERE cm.tenant_id = v_tenant_id
      AND cm.created_at >= v_ts_from AND cm.created_at < v_ts_to
      AND (p_site_id IS NULL OR cm.site_id = p_site_id)
    GROUP BY COALESCE(NULLIF(cm.method_name, ''), 'Non précisé')
  ) sub;

  -- Évolution journalière (date métier) — inclut les flux physiques de coffre
  SELECT COALESCE(jsonb_agg(d ORDER BY d->>'date'), '[]'::jsonb) INTO v_par_jour
  FROM (
    SELECT jsonb_build_object(
      'date', to_char((cm.created_at AT TIME ZONE v_tz)::date, 'YYYY-MM-DD'),
      'entrees', COALESCE(SUM(CASE WHEN cm.kind IN ('income','customer_prepayment','vault_withdrawal') THEN cm.amount ELSE 0 END), 0),
      'sorties', COALESCE(SUM(CASE WHEN cm.kind IN ('expense','refund','customer_loan','customer_withdrawal','vault_deposit') THEN cm.amount ELSE 0 END), 0),
      'solde', COALESCE(SUM(CASE WHEN cm.kind IN ('income','customer_prepayment','vault_withdrawal') THEN cm.amount
                              WHEN cm.kind IN ('expense','refund','customer_loan','customer_withdrawal','vault_deposit') THEN -cm.amount ELSE 0 END), 0)
    ) AS d
    FROM cash_movements cm
    WHERE cm.tenant_id = v_tenant_id
      AND cm.created_at >= v_ts_from AND cm.created_at < v_ts_to
      AND (p_site_id IS NULL OR cm.site_id = p_site_id)
    GROUP BY (cm.created_at AT TIME ZONE v_tz)::date
  ) sub;

  -- Articles vendus nets de retours (inchangé)
  WITH sold AS (
    SELECT si.article_id, COALESCE(a.name, si.name) AS name,
      SUM(si.quantity) AS qty, SUM(si.total) AS revenue, SUM(COALESCE(si.purchase_cost,0) * si.quantity) AS cost
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN articles a ON a.id = si.article_id
    WHERE s.tenant_id = v_tenant_id
      AND s.status IN ('paid','partial','validated')
      AND s.created_at >= v_ts_from AND s.created_at < v_ts_to
      AND (p_site_id IS NULL OR s.site_id = p_site_id)
    GROUP BY si.article_id, COALESCE(a.name, si.name)
  ),
  returned AS (
    SELECT sri.article_id,
      SUM(sri.quantity) AS qty, SUM(sri.total) AS revenue, SUM(COALESCE(sri.purchase_cost,0) * sri.quantity) AS cost
    FROM sale_return_items sri
    JOIN sale_returns sr ON sr.id = sri.return_id
    WHERE sr.tenant_id = v_tenant_id
      AND sr.status = 'approved'
      AND sr.created_at >= v_ts_from AND sr.created_at < v_ts_to
      AND (p_site_id IS NULL OR sr.site_id = p_site_id)
    GROUP BY sri.article_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'name', so.name,
    'qty', so.qty - COALESCE(r.qty, 0),
    'revenue', so.revenue - COALESCE(r.revenue, 0),
    'cost', so.cost - COALESCE(r.cost, 0)
  ) ORDER BY (so.revenue - COALESCE(r.revenue, 0)) DESC), '[]'::jsonb) INTO v_articles
  FROM sold so LEFT JOIN returned r ON r.article_id = so.article_id;

  RETURN v_summary || jsonb_build_object(
    'fonds_ouverture',         v_fonds,
    'reglements_clients',      v_reg_cli,
    'autres_entrees',          v_autres_in,
    'encaissements_reels',     v_tot_in,
    'reglements_fournisseurs', v_reg_four,
    'depenses_payees',         v_depenses,
    'remboursements_clients',  v_rembours,
    'autres_sorties',          v_autres_out,
    'transferts_depuis_coffre',v_transf_coffre,
    'versements_au_coffre',    v_vers_coffre,
    'total_entrees',           v_tot_in + v_transf_coffre,
    'total_sorties',           v_tot_out + v_vers_coffre,
    'solde_theorique',         v_fonds + (v_tot_in + v_transf_coffre) - (v_tot_out + v_vers_coffre),
    'par_mode',                v_par_mode,
    'par_jour',                v_par_jour,
    'articles',                v_articles
  );
END;
$function$;

-- =====================================================================
-- 2) comptabiliser_reglement_fournisseur
-- =====================================================================
CREATE OR REPLACE FUNCTION public.comptabiliser_reglement_fournisseur(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pay RECORD;
  v_entry_id uuid;
  v_piece_number text;
  v_journal text;
  v_credit_account text;
  v_supplier_name text;
  v_supplier_account text;
BEGIN
  SELECT sp.*, sup.name as supplier_name
  INTO v_pay
  FROM supplier_payments sp
  LEFT JOIN suppliers sup ON sup.id = sp.supplier_id
  WHERE sp.id = p_payment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Règlement fournisseur introuvable');
  END IF;

  IF v_pay.accounting_status = 'accounted' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Règlement déjà comptabilisé');
  END IF;

  v_supplier_name := COALESCE(v_pay.supplier_name, 'Fournisseur');

  IF v_pay.supplier_id IS NOT NULL THEN
    v_supplier_account := get_or_create_supplier_account(v_pay.tenant_id, v_pay.supplier_id);
  ELSE
    v_supplier_account := '4010000';
  END IF;

  IF v_pay.funding_source = 'vault' THEN
    -- Contrepartie = compte comptable du coffre, sans repli silencieux
    v_journal := 'CA';
    SELECT NULLIF(TRIM(account_code), '') INTO v_credit_account
    FROM vaults WHERE id = v_pay.vault_id AND tenant_id = v_pay.tenant_id;
    IF v_credit_account IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Compte comptable du coffre non configuré');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = v_credit_account) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Compte comptable du coffre introuvable dans le plan comptable');
    END IF;
  ELSE
    IF LOWER(COALESCE(v_pay.method_name, '')) LIKE '%banque%' OR LOWER(COALESCE(v_pay.method_name, '')) LIKE '%virement%' OR LOWER(COALESCE(v_pay.method_name, '')) LIKE '%cheque%' OR LOWER(COALESCE(v_pay.method_name, '')) LIKE '%chèque%' THEN
      v_journal := 'BQ'; v_credit_account := '5210000';
    ELSIF LOWER(COALESCE(v_pay.method_name, '')) LIKE '%wave%' THEN
      v_journal := 'BQ'; v_credit_account := '5211000';
    ELSIF LOWER(COALESCE(v_pay.method_name, '')) LIKE '%orange%' THEN
      v_journal := 'BQ'; v_credit_account := '5212000';
    ELSIF LOWER(COALESCE(v_pay.method_name, '')) LIKE '%free%' THEN
      v_journal := 'BQ'; v_credit_account := '5213000';
    ELSE
      v_journal := 'CA'; v_credit_account := '5710000';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = v_credit_account) THEN
      v_credit_account := '5710000'; v_journal := 'CA';
    END IF;
  END IF;

  v_piece_number := next_accounting_piece_number(v_pay.tenant_id, v_journal);

  INSERT INTO journal_entries (
    tenant_id, entry_number, journal_type, entry_date, reference, description,
    total_debit, total_credit, is_balanced, source_type, source_id, status, posted_at, posted_by
  ) VALUES (
    v_pay.tenant_id, v_piece_number, v_journal, CURRENT_DATE,
    COALESCE((SELECT order_number FROM supplier_orders WHERE id = v_pay.order_id), ''),
    'Règlement fournisseur ' || v_supplier_name,
    v_pay.amount, v_pay.amount, true,
    'supplier_payment', p_payment_id, 'posted', now(), auth.uid()
  ) RETURNING id INTO v_entry_id;

  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
  VALUES (
    v_pay.tenant_id, v_entry_id, v_supplier_account,
    (SELECT name FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = v_supplier_account LIMIT 1),
    v_pay.amount, 0,
    'Règlement ' || v_supplier_name,
    v_pay.supplier_id
  );

  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
  VALUES (
    v_pay.tenant_id, v_entry_id, v_credit_account,
    (SELECT name FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = v_credit_account LIMIT 1),
    0, v_pay.amount,
    'Décaissement ' || v_supplier_name,
    v_pay.supplier_id
  );

  UPDATE supplier_payments SET
    accounting_status = 'accounted',
    accounting_entry_id = v_entry_id
  WHERE id = p_payment_id;

  RETURN jsonb_build_object(
    'success', true,
    'entry_id', v_entry_id,
    'piece_number', v_piece_number,
    'journal', v_journal,
    'total', v_pay.amount
  );
END;
$function$;
