-- Situation de TVA comptable : mouvements validés, pas une déclaration fiscale.
-- Les comptes affectés par le tenant font foi ; les autres 443/445 sont signalés.
CREATE OR REPLACE FUNCTION public.accounting_vat_report(
 p_tenant_id uuid,p_date_from date,p_date_to date,p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE
 v_output text; v_input text; v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM public.current_tenant_id() OR NOT public.current_user_can_view_accounting() THEN
  RAISE EXCEPTION 'Accès refusé à la comptabilité.' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id=p_tenant_id AND t.enabled_modules ? 'accounting') THEN
  RAISE EXCEPTION 'Module comptable non activé.' USING ERRCODE='42501';
 END IF;
 IF p_date_from IS NULL OR p_date_to IS NULL OR NOT isfinite(p_date_from) OR NOT isfinite(p_date_to) OR p_date_from>p_date_to OR p_date_to-p_date_from>366 OR p_offset IS NULL OR p_offset<0 THEN
  RAISE EXCEPTION 'Choisissez une période de 367 jours au maximum et une page valide.' USING ERRCODE='22023';
 END IF;
 SELECT a.code INTO v_output FROM public.accounting_account_mappings m JOIN public.accounts a ON a.tenant_id=m.tenant_id AND a.id=m.account_id WHERE m.tenant_id=p_tenant_id AND m.role_code='VAT_OUTPUT';
 SELECT a.code INTO v_input FROM public.accounting_account_mappings m JOIN public.accounts a ON a.tenant_id=m.tenant_id AND a.id=m.account_id WHERE m.tenant_id=p_tenant_id AND m.role_code='VAT_INPUT';
 IF v_output IS NULL OR v_input IS NULL OR v_output=v_input THEN
  RAISE EXCEPTION 'Configurez deux comptes distincts de TVA collectée et récupérable.';
 END IF;
 WITH tax_lines AS MATERIALIZED (
  SELECT l.id,e.entry_date,e.entry_number,e.journal_type,e.reference,e.description,e.source_type,l.account_code,l.account_name,
   coalesce(l.debit,0) debit,coalesce(l.credit,0) credit,
   CASE WHEN l.account_code=v_output THEN 'output' WHEN l.account_code=v_input THEN 'input' ELSE 'other' END AS category,
   CASE WHEN l.account_code=v_output AND e.source_type IN ('sale','sale_return') THEN 'sales'
        WHEN l.account_code=v_input AND e.source_type='purchase' THEN 'purchases' ELSE 'adjustments' END AS nature
  FROM public.journal_entries e JOIN public.journal_lines l ON l.tenant_id=e.tenant_id AND l.entry_id=e.id
  WHERE e.tenant_id=p_tenant_id AND e.status='posted' AND e.entry_date BETWEEN p_date_from AND p_date_to
    AND (l.account_code IN (v_output,v_input) OR l.account_code LIKE '443%' OR l.account_code LIKE '445%')
 ), sums AS (
  SELECT coalesce(sum(credit-debit) FILTER(WHERE category='output' AND nature='sales'),0) output_sales,
   coalesce(sum(debit-credit) FILTER(WHERE category='input' AND nature='purchases'),0) input_purchases,
   coalesce(sum(credit-debit) FILTER(WHERE category='output' AND nature='adjustments'),0) output_adjustments,
   coalesce(sum(debit-credit) FILTER(WHERE category='input' AND nature='adjustments'),0) input_adjustments,
   count(*) FILTER(WHERE category='other') other_count,count(*) row_count
  FROM tax_lines
 ), pending_sales AS (
  SELECT count(*) n,coalesce(sum(s.vat_amount),0) amount FROM public.sales s
  WHERE s.tenant_id=p_tenant_id AND s.deleted_at IS NULL AND s.status IS DISTINCT FROM 'cancelled'
    AND s.vat_amount>0 AND s.created_at>=p_date_from::timestamp AT TIME ZONE 'Africa/Dakar'
    AND s.created_at<(p_date_to+1)::timestamp AT TIME ZONE 'Africa/Dakar'
    AND NOT EXISTS (SELECT 1 FROM public.journal_entries e WHERE e.tenant_id=s.tenant_id AND e.source_type='sale' AND e.source_id=s.id AND e.status='posted')
 ), pending_returns AS (
  SELECT count(*) n,coalesce(sum(r.vat_amount),0) amount FROM public.sale_returns r
  WHERE r.tenant_id=p_tenant_id AND r.status='approved' AND r.vat_amount>0
    AND r.created_at>=p_date_from::timestamp AT TIME ZONE 'Africa/Dakar'
    AND r.created_at<(p_date_to+1)::timestamp AT TIME ZONE 'Africa/Dakar'
    AND NOT EXISTS (SELECT 1 FROM public.journal_entries e WHERE e.tenant_id=r.tenant_id AND e.source_type='sale_return' AND e.source_id=r.id AND e.status='posted')
 ), pending_purchases AS (
  SELECT count(*) n FROM public.supplier_orders o WHERE o.tenant_id=p_tenant_id AND o.status='received' AND o.received_date BETWEEN p_date_from AND p_date_to
    AND NOT EXISTS(SELECT 1 FROM public.journal_entries e WHERE e.tenant_id=o.tenant_id AND e.source_type='purchase' AND e.source_id=o.id AND e.status='posted')
 )
 SELECT jsonb_build_object('output_account',v_output,'input_account',v_input,
   'output_sales',s.output_sales,'input_purchases',s.input_purchases,'net_trade',s.output_sales-s.input_purchases,
   'output_adjustments',s.output_adjustments,'input_adjustments',s.input_adjustments,
   'net_movements',s.output_sales+s.output_adjustments-s.input_purchases-s.input_adjustments,
   'other_count',s.other_count,'row_count',s.row_count,
   'pending_sales',ps.n,'pending_sales_vat',ps.amount,'pending_returns',pr.n,'pending_returns_vat',pr.amount,'pending_purchases',pp.n,
   'rows',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.entry_date,x.entry_number,x.id),'[]'::jsonb)
     FROM (SELECT * FROM tax_lines ORDER BY entry_date,entry_number,id LIMIT 50 OFFSET p_offset) x)
 ) INTO v_result FROM sums s CROSS JOIN pending_sales ps CROSS JOIN pending_returns pr CROSS JOIN pending_purchases pp;
 RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.accounting_vat_report(uuid,date,date,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accounting_vat_report(uuid,date,date,integer) TO authenticated;
