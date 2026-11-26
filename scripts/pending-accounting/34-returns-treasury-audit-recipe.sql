-- Audit returns/treasury. Read-only diagnostics; scope by actual posted original invoice.
SELECT count(*) returns_without_entry,
 count(*) FILTER(WHERE r.vat_net_amount IS NULL) legacy_without_tax_snapshot,
 count(*) FILTER(WHERE r.vat_net_amount IS NOT NULL) fiscal,
 coalesce(sum(r.total),0) total
FROM public.sale_returns r JOIN public.sales s ON s.tenant_id=r.tenant_id AND s.id=r.sale_id
JOIN public.journal_entries j ON j.tenant_id=s.tenant_id AND j.id=s.accounting_entry_id AND j.source_type='sale' AND j.source_id=s.id AND j.status='posted'
WHERE r.status='approved' AND NOT EXISTS(SELECT 1 FROM public.journal_entries c WHERE c.tenant_id=r.tenant_id AND c.source_type='sale_return' AND c.source_id=r.id AND c.status='posted');

SELECT count(*) n,count(*) FILTER(WHERE j.total_debit=r.total AND j.total_credit=r.total AND j.source_type='sale_return' AND j.source_id=r.id AND j.status='posted') consistent
FROM public.sale_returns r LEFT JOIN public.journal_entries j ON j.tenant_id=r.tenant_id AND j.id=r.vat_entry_id WHERE r.vat_entry_id IS NOT NULL;

SELECT count(*) n,count(*) FILTER(WHERE r.total IS DISTINCT FROM x.refunds) mismatch
FROM public.sale_returns r JOIN LATERAL (SELECT sum(m.amount) refunds FROM public.cash_movements m WHERE m.tenant_id=r.tenant_id AND m.sale_return_id=r.id AND m.kind='refund') x ON x.refunds IS NOT NULL
WHERE r.status='approved' AND r.refund_method='cash';

SELECT count(*) transfers,count(*) FILTER(WHERE NOT EXISTS(
 SELECT 1 FROM public.vault_movements v WHERE v.tenant_id=m.tenant_id AND v.id=m.vault_movement_id AND v.amount=m.amount AND v.site_id=m.site_id AND v.cash_session_id=m.cash_session_id
 AND v.kind=CASE WHEN m.kind='vault_deposit' THEN 'cash_deposit' ELSE 'cash_withdrawal' END
 AND v.direction=CASE WHEN m.kind='vault_deposit' THEN 'in' ELSE 'out' END)) inconsistent
FROM public.cash_movements m WHERE m.kind IN ('vault_deposit','vault_withdrawal');

SELECT count(*) n,count(*) FILTER(WHERE accounting_status='accounted' OR accounting_entry_id IS NOT NULL) linked FROM public.sale_payments WHERE affects_balance IS NOT TRUE;

-- Run assertions only after installation of 33 in staging.
DO $audit$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.uq_accounting_vault_source') AND indisunique AND indisvalid) THEN RAISE EXCEPTION 'Index coffre absent';END IF;
 IF has_function_privilege('anon','public.auto_apply_customer_avoirs(uuid)','EXECUTE') THEN RAISE EXCEPTION 'Application anonyme des avoirs autorisée';END IF;
 IF NOT has_function_privilege('authenticated','public.post_vat_sale_return(uuid)','EXECUTE') THEN RAISE EXCEPTION 'Comptabilisation des avoirs indisponible';END IF;
END $audit$;
-- Transactional recipe still required: two partial returns against one sale; over-limit HT and VAT;
-- idempotent retry; closed month; cash refund failure rolls back both entries;
-- same source concurrent transfer; no fake cash payment for applied credit.
