-- PC2D-A.3: compare the accounting reports and operational links for a period.
-- This report never posts an entry or closes a period.

CREATE OR REPLACE FUNCTION public.accounting_period_controls(
  p_tenant_id uuid, p_date_from date, p_date_to date
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_from timestamptz;
  v_until timestamptz;
  v_report jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM public.current_tenant_id()
     OR NOT public.current_user_can_view_accounting() THEN
    RAISE EXCEPTION 'Accès refusé à la comptabilité de cette entreprise.' USING ERRCODE = '42501';
  END IF;
  IF p_date_from IS NULL OR p_date_to IS NULL OR NOT isfinite(p_date_from) OR NOT isfinite(p_date_to)
     OR p_date_to < p_date_from OR p_date_to - p_date_from > 365 THEN
    RAISE EXCEPTION 'Sélectionnez une période d’un an au maximum.';
  END IF;
  v_from := p_date_from::timestamp AT TIME ZONE 'UTC';
  v_until := (p_date_to + 1)::timestamp AT TIME ZONE 'UTC';

  WITH posted AS MATERIALIZED (
    SELECT j.* FROM public.journal_entries j WHERE j.tenant_id = p_tenant_id
      AND j.status = 'posted' AND j.entry_date BETWEEN p_date_from AND p_date_to
  ),
  ledger AS MATERIALIZED (
    SELECT g.entry_id, g.account_code, g.debit, g.credit
    FROM public.grand_livre(p_tenant_id, p_date_from, p_date_to, NULL) g
  ),
  entry_sums AS (
    SELECT entry_id, count(*) AS lines, sum(debit) AS debit, sum(credit) AS credit
    FROM ledger GROUP BY entry_id
  ),
  entry_mismatches AS (
    SELECT j.entry_number, j.entry_date FROM posted j LEFT JOIN entry_sums l ON l.entry_id = j.id
    WHERE COALESCE(l.lines, 0) < 2 OR j.is_balanced IS NOT TRUE
      OR j.total_debit IS DISTINCT FROM j.total_credit OR j.total_debit IS DISTINCT FROM l.debit
      OR j.total_credit IS DISTINCT FROM l.credit
  ),
  journal_check AS (
    SELECT count(*) AS entries,
      COALESCE(sum(j.total_debit), 0) AS debit, COALESCE(sum(j.total_credit), 0) AS credit,
      (SELECT count(*) FROM entry_mismatches) AS inconsistent_entries
    FROM posted j
  ),
  source_duplicates AS (
    SELECT count(*) AS total FROM (
      SELECT j.source_type, j.source_id
      FROM (SELECT DISTINCT source_type, source_id FROM posted WHERE source_id IS NOT NULL) p
      JOIN public.journal_entries j ON j.tenant_id = p_tenant_id AND j.status = 'posted'
        AND j.source_type = p.source_type AND j.source_id = p.source_id
      GROUP BY j.source_type, j.source_id HAVING count(*) > 1
    ) x
  ),
  ledger_by_account AS (
    SELECT account_code, count(*) AS lines, sum(debit) AS debit, sum(credit) AS credit
    FROM ledger GROUP BY account_code
  ),
  accounting_balance AS (
    SELECT b.account_code, b.total_debit AS debit, b.total_credit AS credit
    FROM public.balance_generale(p_tenant_id, p_date_from, p_date_to) b
  ),
  account_comparison AS (
    SELECT account_code, l.lines, l.debit AS ledger_debit, l.credit AS ledger_credit, b.debit AS balance_debit,
      b.credit AS balance_credit, (l.debit IS DISTINCT FROM b.debit OR l.credit IS DISTINCT FROM b.credit) AS inconsistent
    FROM ledger_by_account l FULL JOIN accounting_balance b USING (account_code)
  ),
  account_check AS (
    SELECT COALESCE(sum(lines), 0) AS lines,
      COALESCE(sum(ledger_debit), 0) AS ledger_debit, COALESCE(sum(ledger_credit), 0) AS ledger_credit,
      COALESCE(sum(balance_debit), 0) AS balance_debit, COALESCE(sum(balance_credit), 0) AS balance_credit,
      count(*) FILTER (WHERE inconsistent) AS inconsistent_accounts
    FROM account_comparison
  ),
  control_roles (family, role_code) AS (
    VALUES ('client', 'CUSTOMER_CONTROL'), ('supplier', 'SUPPLIER_CONTROL')
  ),
  configured_roles AS MATERIALIZED (
    SELECT cr.family, left(a.code, 3) AS prefix
    FROM control_roles cr
    JOIN public.accounting_account_mappings m ON m.tenant_id = p_tenant_id AND m.role_code = cr.role_code
    JOIN public.accounts a ON a.id = m.account_id AND a.tenant_id = m.tenant_id AND a.is_active
  ),
  third_ledger AS (
    SELECT r.family, sum(l.debit) AS debit, sum(l.credit) AS credit,
      count(*) FILTER (WHERE c.id IS NULL AND s.id IS NULL) AS unassigned_lines
    FROM configured_roles r
    JOIN posted j ON true
    JOIN public.journal_lines l ON l.tenant_id = p_tenant_id AND l.entry_id = j.id
      AND l.account_code LIKE r.prefix || '%'
    LEFT JOIN public.customers c ON r.family = 'client' AND c.tenant_id = p_tenant_id AND c.id = l.third_party_id
    LEFT JOIN public.suppliers s ON r.family = 'supplier' AND s.tenant_id = p_tenant_id AND s.id = l.third_party_id
    GROUP BY r.family
  ),
  third_balance AS (
    SELECT r.family, sum(t.total_debit) AS debit, sum(t.total_credit) AS credit
    FROM configured_roles r
    CROSS JOIN LATERAL public.balance_tiers(p_tenant_id, r.family, p_date_from, p_date_to) t
    GROUP BY r.family
  ),
  third_check AS (
    SELECT cr.family, (r.prefix IS NOT NULL) AS configured,
      COALESCE(l.debit, 0) AS ledger_debit, COALESCE(l.credit, 0) AS ledger_credit,
      COALESCE(b.debit, 0) AS balance_debit, COALESCE(b.credit, 0) AS balance_credit,
      COALESCE(l.unassigned_lines, 0) AS unassigned_lines
    FROM control_roles cr LEFT JOIN configured_roles r USING (family)
    LEFT JOIN third_ledger l USING (family) LEFT JOIN third_balance b USING (family)
  ),
  cash AS (
    SELECT 'cash'::text AS family, c.id, (c.created_at AT TIME ZONE 'UTC')::date AS operation_date,
      COALESCE(NULLIF(c.receipt_number, ''), NULLIF(c.reference, ''), NULLIF(c.reason, ''), 'Mouvement de caisse') AS reference,
      c.amount, j.entry_date,
      CASE
        WHEN c.accounting_status = 'excluded' OR c.supplier_id IS NOT NULL THEN
          CASE WHEN c.accounting_entry_id IS NULL THEN 'excluded' ELSE 'invalid' END
        WHEN c.accounting_entry_id IS NULL AND c.accounting_status IS DISTINCT FROM 'accounted' THEN 'missing'
        WHEN c.accounting_status = 'accounted' AND j.status = 'posted' AND j.is_balanced
          AND j.total_debit = c.amount AND j.total_credit = c.amount
          AND NOT EXISTS (
            SELECT 1 FROM public.cash_movements other
            WHERE other.tenant_id = p_tenant_id AND other.id <> c.id AND other.accounting_entry_id = j.id
          )
          AND (
            (j.source_type = 'cash_movement' AND j.source_id = c.id)
            OR (j.source_type = 'vault_movement' AND j.source_id = c.vault_movement_id)
            OR (j.source_type = 'customer_payment' AND EXISTS (
              SELECT 1 FROM public.customer_payments p
              WHERE p.tenant_id = p_tenant_id AND p.id = j.source_id AND p.cash_movement_id = c.id
                AND p.customer_id = c.customer_id AND p.amount = c.amount
            ))
            OR (j.source_type = 'payment' AND EXISTS (
              SELECT 1 FROM public.sale_payments p JOIN public.sales s ON s.tenant_id = p.tenant_id AND s.id = p.sale_id
              WHERE p.tenant_id = p_tenant_id AND p.id = j.source_id AND s.sale_number = c.reference
                AND c.reason = 'Règlement ' || s.sale_number AND p.amount = c.amount AND p.created_at = c.created_at
                AND p.cash_session_id = c.cash_session_id AND p.payment_method_id = c.payment_method_id
                AND s.customer_id IS NOT DISTINCT FROM c.customer_id
            ))
          ) THEN 'linked'
        ELSE 'invalid'
      END AS state
    FROM public.cash_movements c
    LEFT JOIN public.journal_entries j ON j.tenant_id = c.tenant_id AND j.id = c.accounting_entry_id
    WHERE c.tenant_id = p_tenant_id AND c.created_at >= v_from AND c.created_at < v_until
  ),
  supplier AS (
    SELECT 'supplier'::text AS family, s.id, (COALESCE(s.paid_at, s.created_at) AT TIME ZONE 'UTC')::date AS operation_date,
      COALESCE(NULLIF(s.reference, ''), 'Règlement fournisseur') AS reference, s.amount, j.entry_date,
      CASE
        WHEN s.accounting_entry_id IS NULL AND s.accounting_status IS DISTINCT FROM 'accounted' THEN 'missing'
        WHEN s.accounting_status = 'accounted' AND j.status = 'posted' AND j.is_balanced
          AND j.source_type = 'supplier_payment' AND j.source_id = s.id
          AND j.total_debit = s.amount AND j.total_credit = s.amount THEN 'linked'
        ELSE 'invalid'
      END AS state
    FROM public.supplier_payments s
    LEFT JOIN public.journal_entries j ON j.tenant_id = s.tenant_id AND j.id = s.accounting_entry_id
    WHERE s.tenant_id = p_tenant_id AND COALESCE(s.paid_at, s.created_at) >= v_from
      AND COALESCE(s.paid_at, s.created_at) < v_until
  ),
  vault AS (
    SELECT 'vault'::text AS family, v.id, vd.operation_date,
      COALESCE(NULLIF(v.reference, ''), CASE v.kind
        WHEN 'opening_balance' THEN 'Solde initial du coffre'
        WHEN 'manual_deposit' THEN 'Versement manuel au coffre'
        WHEN 'manual_withdrawal' THEN 'Retrait manuel du coffre'
        WHEN 'cash_deposit' THEN 'Versement depuis la caisse'
        WHEN 'cash_withdrawal' THEN 'Transfert vers la caisse'
        WHEN 'supplier_payment' THEN 'Règlement fournisseur par coffre'
        ELSE 'Mouvement de coffre'
      END) AS reference, v.amount,
      CASE WHEN v.kind = 'supplier_payment' AND parts.total > 0 THEN parts.different_date ELSE direct.entry_date END AS entry_date,
      CASE
        WHEN v.kind = 'supplier_payment' AND direct.total > 0 AND parts.total > 0 THEN 'invalid'
        WHEN v.kind = 'supplier_payment' AND parts.total > 0 THEN
          CASE
            WHEN parts.amount IS DISTINCT FROM v.amount OR parts.invalid > 0 THEN 'invalid'
            WHEN parts.linked = parts.total THEN 'linked'
            ELSE 'missing'
          END
        WHEN direct.total = 0 THEN 'missing'
        WHEN direct.total = 1 AND direct.matches = 1 THEN 'linked'
        ELSE 'invalid'
      END AS state
    FROM public.vault_movements v
    CROSS JOIN LATERAL (SELECT (v.effective_at AT TIME ZONE 'UTC')::date AS operation_date) vd
    CROSS JOIN LATERAL (
      SELECT count(*) AS total, max(j.entry_date) AS entry_date,
        count(*) FILTER (WHERE j.status = 'posted' AND j.is_balanced
          AND j.total_debit = v.amount AND j.total_credit = v.amount) AS matches
      FROM public.journal_entries j WHERE j.tenant_id = p_tenant_id AND j.source_type = 'vault_movement' AND j.source_id = v.id
    ) direct
    CROSS JOIN LATERAL (
      SELECT count(*) AS total, sum(s.amount) AS amount,
        count(*) FILTER (WHERE s.accounting_status = 'accounted' AND j.status = 'posted' AND j.is_balanced
          AND j.source_type = 'supplier_payment' AND j.source_id = s.id
          AND j.total_debit = s.amount AND j.total_credit = s.amount) AS linked,
        count(*) FILTER (WHERE (s.accounting_entry_id IS NOT NULL OR s.accounting_status = 'accounted')
          AND (s.accounting_status = 'accounted' AND j.status = 'posted' AND j.is_balanced
            AND j.source_type = 'supplier_payment' AND j.source_id = s.id
            AND j.total_debit = s.amount AND j.total_credit = s.amount) IS NOT TRUE) AS invalid,
        min(j.entry_date) FILTER (WHERE j.entry_date <> vd.operation_date) AS different_date
      FROM public.supplier_payments s LEFT JOIN public.journal_entries j ON j.tenant_id = s.tenant_id AND j.id = s.accounting_entry_id
      WHERE v.kind = 'supplier_payment' AND s.tenant_id = p_tenant_id AND s.vault_movement_id = v.id
        AND s.funding_source = 'vault' AND s.vault_id = v.vault_id AND s.supplier_id = v.supplier_id
        AND s.site_id IS NOT DISTINCT FROM v.site_id
    ) parts
    WHERE v.tenant_id = p_tenant_id AND v.effective_at >= v_from AND v.effective_at < v_until
  ),
  operational AS MATERIALIZED (
    SELECT * FROM cash UNION ALL SELECT * FROM supplier UNION ALL SELECT * FROM vault
  ),
  families (family) AS (VALUES ('cash'), ('vault'), ('supplier')),
  coverage AS (
    SELECT f.family, count(o.id) AS total,
      count(*) FILTER (WHERE o.state = 'linked') AS linked,
      count(*) FILTER (WHERE o.state = 'missing') AS missing,
      count(*) FILTER (WHERE o.state = 'invalid') AS invalid,
      count(*) FILTER (WHERE o.state = 'excluded') AS excluded,
      count(*) FILTER (WHERE o.state = 'linked' AND o.entry_date <> o.operation_date) AS date_differences,
      COALESCE(sum(o.amount) FILTER (WHERE o.state IN ('missing', 'invalid')), 0) AS amount_to_check
    FROM families f LEFT JOIN operational o USING (family) GROUP BY f.family
  ),
  examples AS (
    SELECT e.* FROM families f
    CROSS JOIN LATERAL (
      SELECT o.family, o.id, o.reference, o.operation_date, o.entry_date, o.amount,
        CASE WHEN o.state = 'linked' THEN 'date' ELSE o.state END AS issue
      FROM operational o WHERE o.family = f.family AND (
        o.state IN ('missing', 'invalid') OR (o.state = 'linked' AND o.entry_date <> o.operation_date)
      )
      ORDER BY CASE o.state WHEN 'invalid' THEN 0 WHEN 'linked' THEN 1 ELSE 2 END,
        o.operation_date DESC, o.id
      LIMIT 12
    ) e
  )
  SELECT jsonb_build_object(
    'from', p_date_from, 'to', p_date_to,
    'journal', to_jsonb(j) || jsonb_build_object('duplicate_sources', d.total),
    'accounts', to_jsonb(a),
    'journal_examples', ARRAY(SELECT e.entry_number FROM entry_mismatches e ORDER BY e.entry_date DESC, e.entry_number LIMIT 12),
    'account_examples', ARRAY(SELECT c.account_code FROM account_comparison c WHERE c.inconsistent ORDER BY c.account_code LIMIT 12),
    'third_parties', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.family) FROM third_check t),
    'coverage', (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.family) FROM coverage c),
    'issues', (SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.family, e.operation_date DESC, e.id), '[]') FROM examples e)
  ) INTO v_report FROM journal_check j CROSS JOIN source_duplicates d CROSS JOIN account_check a;

  RETURN v_report;
END;
$$;

REVOKE ALL ON FUNCTION public.accounting_period_controls(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accounting_period_controls(uuid, date, date) TO authenticated;
