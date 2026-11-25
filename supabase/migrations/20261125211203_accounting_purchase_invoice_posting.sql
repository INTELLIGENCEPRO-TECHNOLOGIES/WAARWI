-- Facture fournisseur : une facture par commande entièrement reçue.
-- Le TTC est identique à la dette commerciale ; aucun mouvement de stock ni paiement créé.
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS purchase_invoice jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_invoice_supplier_reference ON public.journal_entries
 (tenant_id, (purchase_invoice->>'supplier_id'), (lower(btrim(purchase_invoice->>'number'))))
 WHERE purchase_invoice IS NOT NULL;

CREATE OR REPLACE FUNCTION public.post_purchase_invoice(
 p_tenant_id uuid,p_order_id uuid,p_invoice_number text,p_invoice_date date,p_lines jsonb,p_declared jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE
 o public.supplier_orders%ROWTYPE;
 v_amounts jsonb;
 v_number text := nullif(btrim(p_invoice_number),'');
 v_supplier text;
 v_purchase text;
 v_vat text;
 v_expense numeric;
 v_recoverable numeric;
 v_total numeric;
 v_lines jsonb;
 v_entry jsonb;
 v_entry_id uuid;
 v_previous public.journal_entries%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM public.current_tenant_id() OR NOT public.current_user_can_manage_accounting() THEN
  RAISE EXCEPTION 'Accès refusé à la comptabilité.' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id=p_tenant_id AND t.enabled_modules ? 'accounting') THEN
  RAISE EXCEPTION 'Module comptable non activé.' USING ERRCODE='42501';
 END IF;
 IF v_number IS NULL OR length(v_number)>120 OR p_invoice_date IS NULL OR NOT isfinite(p_invoice_date) OR p_invoice_date>(now() AT TIME ZONE 'Africa/Dakar')::date THEN
  RAISE EXCEPTION 'Numéro et date de facture valides obligatoires.';
 END IF;
 IF extract(year FROM p_invoice_date)<>extract(year FROM CURRENT_DATE) THEN
  RAISE EXCEPTION 'Facture d’un exercice antérieur : numérotation à régulariser.';
 END IF;
 SELECT * INTO o FROM public.supplier_orders WHERE id=p_order_id AND tenant_id=p_tenant_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Commande introuvable.'; END IF;
 IF o.status IS DISTINCT FROM 'received' OR o.received_date IS NULL OR o.supplier_id IS NULL THEN
  RAISE EXCEPTION 'Commande entièrement réceptionnée et fournisseur obligatoires.';
 END IF;
 v_amounts:=public._calculate_purchase_invoice_amounts(p_lines,p_declared);
 v_total:=(v_amounts->>'grossMinor')::numeric/100;
 v_expense:=(v_amounts->>'expenseMinor')::numeric/100;
 v_recoverable:=(v_amounts->>'deductibleVatMinor')::numeric/100;
 IF o.total IS DISTINCT FROM v_total THEN
  RAISE EXCEPTION 'Le TTC de la facture doit correspondre au total de la commande (% FCFA).',o.total;
 END IF;
 SELECT * INTO v_previous FROM public.journal_entries j WHERE j.tenant_id=p_tenant_id AND j.source_type='purchase' AND j.source_id=o.id LIMIT 1;
 IF FOUND THEN
  IF v_previous.id=o.accounting_entry_id AND v_previous.status='posted' AND v_previous.purchase_invoice->>'number'=v_number AND v_previous.entry_date=p_invoice_date AND v_previous.purchase_invoice->'input_lines'=p_lines AND v_previous.purchase_invoice->'amounts'=v_amounts THEN
   RETURN jsonb_build_object('success',true,'entry_id',v_previous.id,'piece_number',v_previous.entry_number,'already_accounted',true);
  END IF;
  RAISE EXCEPTION 'Cette commande possède déjà une écriture comptable.';
 END IF;
 IF o.accounting_status='accounted' OR o.accounting_entry_id IS NOT NULL THEN RAISE EXCEPTION 'Lien comptable existant à vérifier.'; END IF;
 PERFORM public._assert_accounting_month_open(p_tenant_id,date_trunc('month',p_invoice_date)::date);
 v_purchase:=public.resolve_account(p_tenant_id,'PURCHASES_GOODS');
 v_supplier:=public.get_or_create_supplier_account(p_tenant_id,o.supplier_id);
 IF NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.tenant_id=p_tenant_id AND a.code=v_purchase AND a.is_active AND a.class=6) OR NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.tenant_id=p_tenant_id AND a.code=v_supplier AND a.is_active AND a.class=4) THEN
  RAISE EXCEPTION 'Comptes d’achat ou fournisseur invalides.';
 END IF;
 v_lines:=jsonb_build_array(jsonb_build_object('account_code',v_purchase,'debit',v_expense,'credit',0,'label','Achats de marchandises'));
 IF v_recoverable>0 THEN
  v_vat:=public.resolve_account(p_tenant_id,'VAT_INPUT');
  IF NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.tenant_id=p_tenant_id AND a.code=v_vat AND a.is_active AND a.class=4 AND a.code LIKE '445%') OR v_vat=v_supplier THEN RAISE EXCEPTION 'Compte de TVA récupérable invalide.'; END IF;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_code',v_vat,'debit',v_recoverable,'credit',0,'label','TVA récupérable sur achats'));
 END IF;
 v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_code',v_supplier,'debit',0,'credit',v_total,'label','Facture fournisseur '||v_number));
 v_entry:=public.create_manual_journal_entry(p_tenant_id,'AC',p_invoice_date,'Facture fournisseur '||v_number||' / '||o.order_number,v_number,v_lines);
 v_entry_id:=(v_entry->>'entry_id')::uuid;
 IF v_entry_id IS NULL THEN RAISE EXCEPTION 'Création de l’écriture non confirmée.'; END IF;
 UPDATE public.journal_entries SET source_type='purchase',source_id=o.id,purchase_invoice=jsonb_build_object('number',v_number,'supplier_id',o.supplier_id,'order_number',o.order_number,'invoice_date',p_invoice_date,'input_lines',p_lines,'amounts',v_amounts)
 WHERE tenant_id=p_tenant_id AND id=v_entry_id;
 UPDATE public.journal_lines SET third_party_id=o.supplier_id WHERE tenant_id=p_tenant_id AND entry_id=v_entry_id AND account_code=v_supplier;
 UPDATE public.supplier_orders SET accounting_status='accounted',accounting_entry_id=v_entry_id WHERE tenant_id=p_tenant_id AND id=o.id;
 RETURN v_entry;
END;
$fn$;
REVOKE ALL ON FUNCTION public.post_purchase_invoice(uuid,uuid,text,date,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.post_purchase_invoice(uuid,uuid,text,date,jsonb,jsonb) TO authenticated;

-- Un document comptabilisé ne doit pas être supprimé par l'annulation de réception.
-- Limité aux nouvelles factures avec justificatif : ne touche pas aux anciens achats.
CREATE OR REPLACE FUNCTION public._guard_posted_purchase_invoice_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
 IF EXISTS (SELECT 1 FROM public.journal_entries j WHERE j.tenant_id=OLD.tenant_id AND j.source_type='purchase' AND j.source_id=OLD.id AND j.purchase_invoice IS NOT NULL) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Facture fournisseur comptabilisée : une correction comptable est nécessaire.'; END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR NEW.total IS DISTINCT FROM OLD.total OR NEW.received_date IS DISTINCT FROM OLD.received_date OR NEW.site_id IS DISTINCT FROM OLD.site_id OR NEW.status IS DISTINCT FROM OLD.status OR NEW.order_number IS DISTINCT FROM OLD.order_number THEN
   RAISE EXCEPTION 'Facture fournisseur comptabilisée : les données de la réception ne sont plus modifiables.';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public._guard_posted_purchase_invoice_order() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_posted_purchase_invoice_order BEFORE UPDATE OR DELETE ON public.supplier_orders
FOR EACH ROW EXECUTE FUNCTION public._guard_posted_purchase_invoice_order();

CREATE OR REPLACE FUNCTION public._reverse_supplier_order_effects(p_order_id uuid, p_tenant uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_order supplier_orders%ROWTYPE;
v_stock_method text;
r record;
v_prev numeric;
v_new numeric;
v_left numeric;
l record;
v_take numeric;
BEGIN
SELECT * INTO v_order FROM supplier_orders WHERE id = p_order_id AND tenant_id = p_tenant;
IF EXISTS (SELECT 1 FROM public.journal_entries j WHERE j.tenant_id=p_tenant AND j.source_type='purchase' AND j.source_id=p_order_id AND j.purchase_invoice IS NOT NULL) THEN RAISE EXCEPTION 'Facture fournisseur comptabilisée : une correction comptable est nécessaire.'; END IF;
SELECT COALESCE(settings->>'stock_method', 'none') INTO v_stock_method FROM tenants WHERE id = p_tenant;

FOR r IN
SELECT article_id, site_id, SUM(quantity) AS net_qty,
MIN(created_at) AS first_at,
MAX(unit_cost) FILTER (WHERE movement_type = 'purchase') AS unit_cost
FROM stock_movements
WHERE tenant_id = p_tenant AND reference_type = 'supplier_order' AND reference_id = p_order_id
GROUP BY article_id, site_id
HAVING SUM(quantity) > 0
LOOP
SELECT quantity INTO v_prev FROM stock_levels
WHERE article_id = r.article_id AND site_id = r.site_id FOR UPDATE;
v_prev := COALESCE(v_prev, 0);
v_new := v_prev - r.net_qty;
UPDATE stock_levels SET quantity = v_new, updated_at = now()
WHERE article_id = r.article_id AND site_id = r.site_id;

INSERT INTO stock_movements (
tenant_id, article_id, site_id, movement_type, quantity,
previous_qty, new_qty, unit_cost, reference_type, reference_id, user_id, note
) VALUES (
p_tenant, r.article_id, r.site_id, 'adjustment_out', -r.net_qty,
v_prev, v_new, COALESCE(r.unit_cost, 0), 'supplier_order', p_order_id, auth.uid(),
'Annulation réception commande ' || COALESCE(v_order.order_number, '')
);

IF v_stock_method = 'lot' THEN
v_left := r.net_qty;
FOR l IN
SELECT id, initial_quantity, remaining_quantity FROM stock_lots
WHERE tenant_id = p_tenant AND article_id = r.article_id AND site_id = r.site_id
AND remaining_quantity > 0
AND created_at >= r.first_at - interval '1 minute'
AND COALESCE(purchase_price, 0) = COALESCE(r.unit_cost, 0)
ORDER BY created_at DESC
FOR UPDATE
LOOP
EXIT WHEN v_left <= 0;
v_take := LEAST(v_left, l.remaining_quantity);
IF v_take = l.remaining_quantity AND l.remaining_quantity = l.initial_quantity THEN
DELETE FROM stock_lots WHERE id = l.id;
ELSE
UPDATE stock_lots SET remaining_quantity = remaining_quantity - v_take WHERE id = l.id;
END IF;
v_left := v_left - v_take;
END LOOP;
END IF;
END LOOP;

DELETE FROM journal_entries
WHERE tenant_id = p_tenant
AND (id = v_order.accounting_entry_id OR (source_type = 'purchase' AND source_id = p_order_id));

UPDATE supplier_orders
SET accounting_status = 'not_accounted', accounting_entry_id = NULL
WHERE id = p_order_id;
END;
$function$;
