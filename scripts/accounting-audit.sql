-- Audit comptable administrateur, en lecture seule.
-- À exécuter dans une session SQL autorisée, jamais depuis le navigateur.
-- Les candidats ne constituent pas une autorisation de comptabiliser.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';

WITH active_tenants AS (
  SELECT id FROM public.tenants WHERE enabled_modules ? 'accounting'
), pending AS MATERIALIZED (
  SELECT m, m.kind, m.amount, public._cash_accounting_decision(m) AS decision
  FROM public.cash_movements m JOIN active_tenants t ON t.id = m.tenant_id
  WHERE m.accounting_entry_id IS NULL
), classified AS MATERIALIZED (
  SELECT kind, amount, decision,
    CASE WHEN decision->>'action' = 'review'
      AND kind IN ('customer_prepayment','customer_withdrawal','refund')
      THEN public._cash_accounting_document(m) END AS document
  FROM pending
), totals AS (
  SELECT e.id, e.tenant_id, e.total_debit, e.total_credit,
    count(l.id) AS line_count, sum(l.debit) AS debit, sum(l.credit) AS credit
  FROM public.journal_entries e
  LEFT JOIN public.journal_lines l ON l.entry_id=e.id AND l.tenant_id=e.tenant_id
  GROUP BY e.id,e.tenant_id,e.total_debit,e.total_credit
)
SELECT jsonb_build_object(
  'integrity', jsonb_build_object(
    'entries', (SELECT count(*) FROM totals),
    'lines', (SELECT count(*) FROM public.journal_lines),
    'inconsistent_entries', (SELECT count(*) FROM totals WHERE line_count<2 OR debit IS DISTINCT FROM credit OR debit IS DISTINCT FROM total_debit OR credit IS DISTINCT FROM total_credit),
    'duplicate_source_groups', (SELECT count(*) FROM (SELECT tenant_id,source_type,source_id FROM public.journal_entries WHERE source_id IS NOT NULL GROUP BY 1,2,3 HAVING count(*)>1) d),
    'orphan_lines', (SELECT count(*) FROM public.journal_lines l WHERE NOT EXISTS (SELECT 1 FROM public.journal_entries e WHERE e.id=l.entry_id AND e.tenant_id=l.tenant_id)),
    'entries_outside_active_modules', (SELECT count(*) FROM public.journal_entries e WHERE NOT EXISTS (SELECT 1 FROM active_tenants t WHERE t.id=e.tenant_id))
  ),
  'cash_pending', (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.action,s.kind,s.document_eligible,s.reason),'[]'::jsonb) FROM (
    SELECT decision->>'action' AS action, kind, document->>'eligible' AS document_eligible,
      coalesce(document->>'reason',decision->>'reason') AS reason, count(*) AS movements,sum(amount) AS amount
    FROM classified GROUP BY 1,2,3,4
  ) s),
  'supplier_payments_pending', (SELECT count(*) FROM public.supplier_payments p JOIN active_tenants t ON t.id=p.tenant_id WHERE p.accounting_entry_id IS NULL),
  'closed_periods', (SELECT count(*) FROM public.accounting_month_closures WHERE closed_at IS NOT NULL)
) AS accounting_audit;

ROLLBACK;
