-- Read-only audit, run on staging after script 31, then review any historical exceptions.
WITH src AS (
 SELECT 'sale' typ,tenant_id,id,accounting_entry_id link,accounting_status state,total amount FROM public.sales
 UNION ALL SELECT 'payment',tenant_id,id,accounting_entry_id,accounting_status,amount FROM public.sale_payments
 UNION ALL SELECT 'purchase',tenant_id,id,accounting_entry_id,accounting_status,total FROM public.supplier_orders
 UNION ALL SELECT 'supplier_payment',tenant_id,id,accounting_entry_id,accounting_status,amount FROM public.supplier_payments
 UNION ALL SELECT 'customer_payment',tenant_id,id,accounting_entry_id,accounting_status,amount FROM public.customer_payments
 UNION ALL SELECT 'cash_movement',tenant_id,id,accounting_entry_id,accounting_status,amount FROM public.cash_movements
 UNION ALL SELECT 'sale_return',tenant_id,id,NULL::uuid,status,total FROM public.sale_returns
), j AS (SELECT * FROM public.journal_entries WHERE status='posted' AND source_type IN ('sale','payment','purchase','supplier_payment','customer_payment','cash_movement','sale_return'))
SELECT j.source_type,count(*) entries,count(*) FILTER(WHERE s.id IS NULL) missing_source,
 count(*) FILTER(WHERE s.id IS NOT NULL AND j.source_type<>'sale_return' AND s.link IS DISTINCT FROM j.id) link_mismatch,
 count(*) FILTER(WHERE s.id IS NOT NULL AND s.amount IS DISTINCT FROM j.total_debit) amount_difference
FROM j LEFT JOIN src s ON s.typ=j.source_type AND s.tenant_id=j.tenant_id AND s.id=j.source_id GROUP BY 1 ORDER BY 1;

SELECT count(*) duplicate_groups FROM (
 SELECT tenant_id,source_type,source_id FROM public.journal_entries WHERE source_id IS NOT NULL AND source_type IN ('sale','payment','purchase','customer_payment','supplier_payment','sale_return','cash_movement') GROUP BY 1,2,3 HAVING count(*)>1
) x;

-- Historical exceptions require an accountant's correction, never an automatic delete or reversal.
SELECT count(*) exceptions,coalesce(sum(j.total_debit),0) amount
FROM public.sales s JOIN public.journal_entries j ON j.tenant_id=s.tenant_id AND j.source_id=s.id AND j.source_type='sale'
WHERE s.status IN ('deleted','cancelled') OR s.deleted_at IS NOT NULL;

DO $audit$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.uq_accounting_commercial_source') AND indisunique AND indisvalid) THEN RAISE EXCEPTION 'Index d’unicité absent ou invalide'; END IF;
 IF has_function_privilege('authenticated','public.comptabiliser_reglement(uuid)','EXECUTE') OR has_function_privilege('authenticated','public.comptabiliser_reglement_fournisseur(uuid)','EXECUTE') OR has_function_privilege('authenticated','public.comptabiliser_reglement_solde_client(uuid)','EXECUTE') THEN RAISE EXCEPTION 'Fonction interne exposée'; END IF;
END $audit$;
