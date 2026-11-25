CREATE OR REPLACE FUNCTION public.comptabiliser_achat(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
v_order RECORD;
v_entry_id uuid;
v_piece_number text;
v_supplier_name text;
v_supplier_account text;
v_purchase_account text;
v_fallback_supplier text;
BEGIN
SELECT so.*, sup.name as supplier_name
INTO v_order
FROM supplier_orders so
LEFT JOIN suppliers sup ON sup.id = so.supplier_id AND sup.tenant_id = so.tenant_id
WHERE so.id = p_order_id AND so.tenant_id = public.current_tenant_id()
FOR UPDATE OF so;

IF NOT FOUND THEN
RETURN jsonb_build_object('success', false, 'error', 'Commande fournisseur introuvable');
END IF;

IF auth.uid() IS NULL OR NOT public.current_user_can_manage_accounting() THEN
  RAISE EXCEPTION 'Accès refusé à la comptabilité.' USING ERRCODE = '42501';
END IF;
IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = v_order.tenant_id AND t.enabled_modules ? 'accounting') THEN
  RETURN jsonb_build_object('success', false, 'error', 'Module comptable non activé');
END IF;
IF v_order.status IS DISTINCT FROM 'received' OR v_order.received_date IS NULL OR NOT isfinite(v_order.received_date) OR v_order.received_date > (now() AT TIME ZONE 'Africa/Dakar')::date THEN
  RETURN jsonb_build_object('success', false, 'error', 'Réception complète et date de réception valide obligatoires');
END IF;
-- Le numéroteur historique utilise l’année courante.
IF extract(year FROM v_order.received_date) <> extract(year FROM CURRENT_DATE) THEN
  RETURN jsonb_build_object('success', false, 'error', 'Achat d’un exercice antérieur : numérotation à régulariser');
END IF;
IF v_order.total IS NULL OR v_order.total <= 0 OR v_order.total IN ('NaN'::numeric, 'Infinity'::numeric) OR v_order.total <> round(v_order.total, 2) THEN
  RETURN jsonb_build_object('success', false, 'error', 'Montant d’achat invalide');
END IF;
IF v_order.supplier_id IS NOT NULL AND v_order.supplier_name IS NULL THEN
  RETURN jsonb_build_object('success', false, 'error', 'Fournisseur introuvable dans cette entreprise');
END IF;
IF v_order.accounting_status = 'accounted' OR v_order.accounting_entry_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.journal_entries j WHERE j.tenant_id = v_order.tenant_id AND j.source_type = 'purchase' AND j.source_id = p_order_id) THEN
RETURN jsonb_build_object('success', false, 'error', 'Achat déjà comptabilisé');
END IF;

-- Verrouiller la période avant de créer des comptes auxiliaires.
BEGIN
  PERFORM public._assert_accounting_month_open(v_order.tenant_id, date_trunc('month', v_order.received_date)::date);
EXCEPTION WHEN SQLSTATE '55000' THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
v_supplier_name := COALESCE(v_order.supplier_name, 'Fournisseur');

-- Resolve purchase account via mapping
BEGIN
v_purchase_account := resolve_account(v_order.tenant_id, 'PURCHASES_GOODS');
EXCEPTION WHEN OTHERS THEN
RETURN jsonb_build_object('success', false, 'error', 'Résolution PURCHASES_GOODS échouée: ' || SQLERRM);
END;

-- Get or create supplier auxiliary account
IF v_order.supplier_id IS NOT NULL THEN
v_supplier_account := get_or_create_supplier_account(v_order.tenant_id, v_order.supplier_id);
ELSE
-- Resolve collective supplier control account via mapping
BEGIN
v_fallback_supplier := resolve_account(v_order.tenant_id, 'SUPPLIER_CONTROL');
EXCEPTION WHEN OTHERS THEN
RETURN jsonb_build_object('success', false, 'error', 'Résolution SUPPLIER_CONTROL échouée: ' || SQLERRM);
END;
v_supplier_account := v_fallback_supplier;
END IF;

IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_order.tenant_id AND code = v_purchase_account AND is_active AND class = 6) THEN
RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_purchase_account || ' (Achats) introuvable');
END IF;
IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_order.tenant_id AND code = v_supplier_account AND is_active AND class = 4) THEN
RETURN jsonb_build_object('success', false, 'error', 'Compte fournisseur ' || v_supplier_account || ' introuvable');
END IF;

IF v_purchase_account = v_supplier_account THEN
  RETURN jsonb_build_object('success', false, 'error', 'Comptes d’achat et fournisseur identiques');
END IF;
v_piece_number := next_accounting_piece_number(v_order.tenant_id, 'AC');

INSERT INTO journal_entries (
tenant_id, entry_number, journal_type, entry_date, reference, description,
total_debit, total_credit, is_balanced, source_type, source_id, status, posted_at, posted_by
) VALUES (
v_order.tenant_id, v_piece_number, 'AC', v_order.received_date,
v_order.order_number,
'Achat ' || v_order.order_number || ' - ' || v_supplier_name,
v_order.total, v_order.total, true,
'purchase', p_order_id, 'posted', now(), auth.uid()
) RETURNING id INTO v_entry_id;

INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
VALUES (
v_order.tenant_id, v_entry_id, v_purchase_account,
(SELECT name FROM accounts WHERE tenant_id = v_order.tenant_id AND code = v_purchase_account LIMIT 1),
v_order.total, 0,
'Achat marchandises ' || v_order.order_number,
v_order.supplier_id
);

INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
VALUES (
v_order.tenant_id, v_entry_id, v_supplier_account,
(SELECT name FROM accounts WHERE tenant_id = v_order.tenant_id AND code = v_supplier_account LIMIT 1),
0, v_order.total,
'Fournisseur ' || v_supplier_name,
v_order.supplier_id
);

UPDATE supplier_orders SET
accounting_status = 'accounted',
accounting_entry_id = v_entry_id
WHERE id = p_order_id AND tenant_id = v_order.tenant_id;

RETURN jsonb_build_object(
'success', true,
'entry_id', v_entry_id,
'piece_number', v_piece_number,
'journal', 'AC',
'total', v_order.total
);
END;
$function$;

REVOKE ALL ON FUNCTION public.comptabiliser_achat(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.comptabiliser_achats_en_masse(p_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  o record; r jsonb; n int := 0; failures jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM public.current_tenant_id() OR NOT public.current_user_can_manage_accounting() THEN
    RAISE EXCEPTION 'Accès refusé à la comptabilité.' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id=p_tenant_id AND t.enabled_modules ? 'accounting') THEN
    RAISE EXCEPTION 'Module comptable non activé.' USING ERRCODE='42501';
  END IF;
  FOR o IN SELECT id,order_number FROM public.supplier_orders WHERE tenant_id=p_tenant_id AND (accounting_status='not_accounted' OR accounting_status IS NULL) AND status='received' ORDER BY received_date,id LOOP
    BEGIN
      r := public.comptabiliser_achat(o.id);
      IF (r->>'success')::boolean IS DISTINCT FROM true THEN
        RAISE EXCEPTION '%', coalesce(r->>'error','Comptabilisation refusée.');
      END IF;
      n:=n+1;
    EXCEPTION WHEN OTHERS THEN
      failures:=failures||jsonb_build_array(jsonb_build_object('order',o.order_number,'error',SQLERRM));
    END;
  END LOOP;
  RETURN jsonb_build_object('success',true,'accounted',n,'errors',jsonb_array_length(failures),'error_details',failures);
END;
$fn$;
REVOKE ALL ON FUNCTION public.comptabiliser_achats_en_masse(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comptabiliser_achats_en_masse(uuid) TO authenticated;
