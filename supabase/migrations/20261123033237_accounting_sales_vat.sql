-- Opt-in VAT for new sales. Catalogue prices, discounts and payments stay TTC.
CREATE TABLE public.sales_vat_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  site_id uuid REFERENCES public.sites(id) ON DELETE CASCADE,
  enabled boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE NULLS NOT DISTINCT (tenant_id, site_id)
);

INSERT INTO public._br_table_registry
  (schema_name, table_name, tenant_link, tenant_id_column, category, restore_order, reset_behavior)
VALUES ('public', 'sales_vat_settings', 'direct', 'tenant_id', 'structure', 20, 'preserve')
ON CONFLICT (schema_name, table_name) DO NOTHING;

ALTER TABLE public.sales_vat_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_vat_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.sales_vat_settings TO authenticated;
CREATE POLICY sales_vat_settings_owner_read ON public.sales_vat_settings
FOR SELECT TO authenticated
USING (tenant_id = (SELECT public.current_tenant_id()) AND (SELECT public.current_user_is_owner()));

CREATE OR REPLACE FUNCTION public.save_sales_vat_setting(p_site_id uuid, p_enabled boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL OR NOT public.current_user_is_owner() THEN
    RAISE EXCEPTION 'Seul le propriétaire peut modifier le paramétrage TVA.' USING ERRCODE = '42501';
  END IF;
  IF p_site_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sites s
    WHERE s.id = p_site_id AND s.tenant_id = v_tenant_id AND public.resolve_root_site_id(s.id) = s.id
  ) THEN
    RAISE EXCEPTION 'Magasin introuvable.' USING ERRCODE = '42501';
  END IF;

  IF p_enabled IS NULL THEN
    IF p_site_id IS NULL THEN RAISE EXCEPTION 'Choisissez un réglage pour l’entreprise.'; END IF;
    DELETE FROM public.sales_vat_settings WHERE tenant_id = v_tenant_id AND site_id = p_site_id;
    RETURN;
  END IF;

  IF p_enabled THEN
    INSERT INTO public.accounts (tenant_id, code, name, class, account_type, is_active)
    VALUES (v_tenant_id, '4431000', 'État, TVA facturée sur ventes', 4, 'general', true)
    ON CONFLICT (tenant_id, code) DO NOTHING;

    -- Replace the old default only. A tenant-specific 443 mapping is preserved.
    INSERT INTO public.accounting_account_mappings (tenant_id, role_code, account_id)
    SELECT v_tenant_id, 'VAT_OUTPUT', a.id FROM public.accounts a
    WHERE a.tenant_id = v_tenant_id AND a.code = '4431000'
    ON CONFLICT (tenant_id, role_code) DO UPDATE SET account_id = EXCLUDED.account_id
    WHERE EXISTS (
      SELECT 1 FROM public.accounts a WHERE a.id = accounting_account_mappings.account_id
        AND a.tenant_id = v_tenant_id AND a.code = '4457000'
    );
    IF public.resolve_account(v_tenant_id, 'VAT_OUTPUT') NOT LIKE '443%' THEN
      RAISE EXCEPTION 'Associez la TVA facturée à un compte actif de la famille 443 avant de l’activer.';
    END IF;
  END IF;

  INSERT INTO public.sales_vat_settings (tenant_id, site_id, enabled, updated_by)
  VALUES (v_tenant_id, p_site_id, p_enabled, auth.uid())
  ON CONFLICT (tenant_id, site_id) DO UPDATE SET
    enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.save_sales_vat_setting(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_sales_vat_setting(uuid, boolean) TO authenticated;

ALTER TABLE public.sales ADD COLUMN vat_enabled_at_issue boolean NOT NULL DEFAULT false;
ALTER TABLE public.sales ADD COLUMN vat_net_amount numeric;
ALTER TABLE public.sale_items ADD COLUMN vat_net_amount numeric;
ALTER TABLE public.sale_items ADD COLUMN vat_amount numeric;

CREATE FUNCTION public._start_sale_vat()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  -- Always derive the setting from the seller and sale site, never from the client payload.
  SELECT v.enabled INTO NEW.vat_enabled_at_issue
  FROM public.sales_vat_settings v
  WHERE v.tenant_id = NEW.tenant_id
    AND (v.site_id IS NULL OR v.site_id = public.resolve_root_site_id(NEW.site_id))
  ORDER BY v.site_id IS NULL
  LIMIT 1;

  NEW.vat_enabled_at_issue := COALESCE(NEW.vat_enabled_at_issue, false);
  NEW.vat_net_amount := NULL;
  NEW.vat_amount := 0;
  RETURN NEW;
END;
$$;

CREATE TRIGGER start_sale_vat BEFORE INSERT ON public.sales
FOR EACH ROW EXECUTE FUNCTION public._start_sale_vat();

CREATE FUNCTION public._snapshot_sale_item_vat()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_sale record;
BEGIN
  SELECT s.tenant_id, s.vat_enabled_at_issue, s.vat_net_amount INTO v_sale
  FROM public.sales s WHERE s.id = NEW.sale_id;
  IF FOUND AND v_sale.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'La ligne et la vente doivent appartenir à la même entreprise.' USING ERRCODE = '42501';
  END IF;
  NEW.vat_net_amount := NULL;
  NEW.vat_amount := NULL;
  IF NOT v_sale.vat_enabled_at_issue THEN RETURN NEW; END IF;
  IF v_sale.vat_net_amount IS NOT NULL THEN
    RAISE EXCEPTION 'La facture est déjà émise. Utilisez un avoir pour la corriger.';
  END IF;

  SELECT COALESCE(a.vat_rate, 0) INTO NEW.vat_rate FROM public.articles a
  WHERE a.id = NEW.article_id AND a.tenant_id = NEW.tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sélectionnez une fiche article valide pour chaque ligne d’une facture avec TVA.';
  END IF;
  IF NEW.vat_rate NOT BETWEEN 0 AND 100 OR NEW.quantity <= 0 OR NEW.total < 0
     OR NEW.unit_price < 0 OR COALESCE(NEW.discount, 0) < 0
     OR round(NEW.quantity * NEW.unit_price - COALESCE(NEW.discount, 0), 2) IS DISTINCT FROM round(NEW.total, 2)
     OR NEW.total IN ('NaN'::numeric, 'Infinity'::numeric)
     OR NEW.quantity IN ('NaN'::numeric, 'Infinity'::numeric) THEN
    RAISE EXCEPTION 'Vérifiez le taux de TVA, la quantité et le montant de chaque ligne.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER snapshot_sale_item_vat BEFORE INSERT ON public.sale_items
FOR EACH ROW EXECUTE FUNCTION public._snapshot_sale_item_vat();

CREATE FUNCTION public._finish_sale_vat()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_line_total numeric;
  v_sales_total numeric := round(NEW.total, 2);
  v_vat numeric;
  v_ht numeric;
BEGIN
  SELECT sum(i.total) INTO v_line_total
  FROM public.sale_items i WHERE i.sale_id = NEW.id AND i.tenant_id = NEW.tenant_id;
  IF v_line_total IS NULL OR v_sales_total IS NULL OR v_sales_total < 0
     OR v_sales_total IN ('NaN'::numeric, 'Infinity'::numeric)
     OR round(v_line_total, 2) IS DISTINCT FROM round(NEW.subtotal, 2)
     OR v_sales_total IS DISTINCT FROM round(v_line_total - COALESCE(NEW.discount, 0), 2)
     OR COALESCE(NEW.discount, 0) < 0 THEN
    RAISE EXCEPTION 'Les lignes, la remise et le total de la facture ne concordent pas.';
  END IF;

  -- Allocate the document discount proportionally, using cumulative rounding so
  -- even fractional quantities and mixed rates sum to the exact payable total.
  WITH running AS (
    SELECT i.id, i.vat_rate, i.total, sum(i.total) OVER (ORDER BY i.id) AS cumulative
    FROM public.sale_items i WHERE i.sale_id = NEW.id AND i.tenant_id = NEW.tenant_id
  ), allocated AS (
    SELECT id, vat_rate, COALESCE(
      round(cumulative * v_sales_total / NULLIF(v_line_total, 0), 2)
      - round((cumulative - total) * v_sales_total / NULLIF(v_line_total, 0), 2), 0
    ) AS ttc
    FROM running
  ), amounts AS (
    SELECT id, ttc, round(ttc * vat_rate / (100 + vat_rate), 2) AS vat
    FROM allocated
  ), snapshots AS (
    UPDATE public.sale_items i SET vat_amount = a.vat, vat_net_amount = a.ttc - a.vat
    FROM amounts a WHERE i.id = a.id
    RETURNING i.vat_amount, i.vat_net_amount
  )
  SELECT sum(vat_amount), sum(vat_net_amount) INTO v_vat, v_ht FROM snapshots;

  UPDATE public.sales SET vat_amount = v_vat, vat_net_amount = v_ht
  WHERE id = NEW.id AND tenant_id = NEW.tenant_id;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER finish_sale_vat AFTER INSERT ON public.sales
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
WHEN (NEW.vat_enabled_at_issue)
EXECUTE FUNCTION public._finish_sale_vat();

CREATE FUNCTION public._protect_sale_vat()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.vat_enabled_at_issue THEN
      RAISE EXCEPTION 'Une facture émise avec TVA doit être conservée. Utilisez un avoir.';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.vat_enabled_at_issue IS DISTINCT FROM OLD.vat_enabled_at_issue THEN
    RAISE EXCEPTION 'Le paramétrage fiscal d’une vente émise est définitif.';
  END IF;
  IF (NEW.vat_amount, NEW.vat_net_amount) IS DISTINCT FROM (OLD.vat_amount, OLD.vat_net_amount)
     AND NOT (OLD.vat_enabled_at_issue AND OLD.vat_net_amount IS NULL AND pg_trigger_depth() > 1) THEN
    RAISE EXCEPTION 'Les montants de TVA sont calculés par Waarwi.';
  END IF;
  IF OLD.vat_enabled_at_issue AND (
    (NEW.site_id, NEW.tenant_id, NEW.customer_id, NEW.subtotal, NEW.discount, NEW.total)
      IS DISTINCT FROM (OLD.site_id, OLD.tenant_id, OLD.customer_id, OLD.subtotal, OLD.discount, OLD.total)
    OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('cancelled', 'deleted'))
    OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
  ) THEN
    RAISE EXCEPTION 'Utilisez un avoir pour corriger une facture émise avec TVA.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_sale_vat BEFORE UPDATE OR DELETE ON public.sales
FOR EACH ROW EXECUTE FUNCTION public._protect_sale_vat();

CREATE FUNCTION public._protect_sale_item_vat()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_finalized boolean;
BEGIN
  SELECT s.vat_net_amount IS NOT NULL INTO v_finalized FROM public.sales s WHERE s.id = OLD.sale_id;
  IF v_finalized AND TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Utilisez un avoir pour corriger une facture émise avec TVA.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.vat_net_amount, NEW.vat_amount) IS DISTINCT FROM (OLD.vat_net_amount, OLD.vat_amount)
       AND NOT (NOT v_finalized AND pg_trigger_depth() > 1) THEN
      RAISE EXCEPTION 'Les montants de TVA sont calculés par Waarwi.';
    END IF;
    IF v_finalized AND (NEW.sale_id, NEW.tenant_id, NEW.article_id, NEW.name, NEW.quantity, NEW.unit_price, NEW.discount, NEW.total, NEW.vat_rate)
       IS DISTINCT FROM (OLD.sale_id, OLD.tenant_id, OLD.article_id, OLD.name, OLD.quantity, OLD.unit_price, OLD.discount, OLD.total, OLD.vat_rate) THEN
      RAISE EXCEPTION 'Utilisez un avoir pour corriger une facture émise avec TVA.';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER protect_sale_item_vat BEFORE UPDATE OR DELETE ON public.sale_items
FOR EACH ROW EXECUTE FUNCTION public._protect_sale_item_vat();

REVOKE ALL ON FUNCTION public._start_sale_vat(), public._snapshot_sale_item_vat(),
  public._finish_sale_vat(), public._protect_sale_vat(), public._protect_sale_item_vat()
  FROM PUBLIC, anon, authenticated, service_role;

-- The invoice header and its lines must exist in the same transaction.
-- Direct invoicing keeps its current RLS and reuses the initial-payment controls.
CREATE FUNCTION public.create_billing_sale_with_items(p_sale jsonb, p_items jsonb, p_payments jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_sale_id uuid;
  v_payment_result jsonb;
  v_tenant_id uuid := public.current_tenant_id();
  v_site_id uuid := (p_sale->>'site_id')::uuid;
  v_customer_id uuid := NULLIF(p_sale->>'customer_id', '')::uuid;
  v_session_id uuid := NULLIF(p_sale->>'cash_session_id', '')::uuid;
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL OR v_site_id IS NULL
     OR public.current_user_can_access_site(v_site_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Accès refusé au magasin de facturation.' USING ERRCODE = '42501';
  END IF;
  IF v_customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers c WHERE c.id = v_customer_id AND c.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Client introuvable.';
  END IF;
  IF v_session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cash_sessions c WHERE c.id = v_session_id AND c.tenant_id = v_tenant_id
      AND c.site_id = v_site_id AND c.status = 'open'
  ) THEN
    RAISE EXCEPTION 'Session de caisse invalide ou fermée.';
  END IF;

  INSERT INTO public.sales (
    tenant_id, site_id, customer_id, user_id, sale_number, subtotal, discount,
    total, paid, status, source, note, cash_session_id, representative_id, rep_commission, doc_header
  ) VALUES (
    v_tenant_id, v_site_id, v_customer_id, auth.uid(), p_sale->>'sale_number',
    (p_sale->>'subtotal')::numeric, 0, (p_sale->>'total')::numeric, (p_sale->>'paid')::numeric,
    p_sale->>'status', 'billing', p_sale->>'note', v_session_id,
    NULLIF(p_sale->>'representative_id', '')::uuid,
    NULLIF(p_sale->'rep_commission', 'null'::jsonb), NULLIF(p_sale->'doc_header', 'null'::jsonb)
  ) RETURNING id INTO v_sale_id;

  PERFORM public.insert_billing_sale_items(v_sale_id, p_items);
  IF jsonb_array_length(p_payments) > 0 THEN
    v_payment_result := public.register_initial_billing_payments(v_sale_id, v_session_id, p_payments);
    IF (v_payment_result->>'success')::boolean IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Les règlements n’ont pas été enregistrés.';
    END IF;
  END IF;
  RETURN v_sale_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_billing_sale_with_items(jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_billing_sale_with_items(jsonb, jsonb, jsonb) TO authenticated;

-- Reuse the existing journal and period controls with the stored HT amount.
CREATE OR REPLACE FUNCTION public.comptabiliser_vente(p_sale_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
v_sale RECORD;
v_entry_id uuid;
v_piece_number text;
v_debit_account text;
v_credit_vente text;
v_credit_tva text;
v_ht numeric;
v_tva numeric;
v_ttc numeric;
v_customer_name text;
v_customer_account text;
v_caller_tenant uuid;
v_entry_date date;
BEGIN
-- C2 tenant guard
IF auth.uid() IS NULL THEN
RAISE EXCEPTION 'Acces refuse au tenant demande';
END IF;
v_caller_tenant := current_tenant_id();
IF v_caller_tenant IS NULL THEN
RAISE EXCEPTION 'Acces refuse au tenant demande';
END IF;

-- PC1F: permission guard
IF NOT current_user_can_manage_accounting() THEN
RAISE EXCEPTION 'Permission manage_accounting requise';
END IF;

SELECT s.*, c.name as customer_name
INTO v_sale
FROM sales s
LEFT JOIN customers c ON c.id = s.customer_id AND c.tenant_id = s.tenant_id
WHERE s.id = p_sale_id
AND s.tenant_id = v_caller_tenant
FOR UPDATE OF s;

IF NOT FOUND THEN
RETURN jsonb_build_object('success', false, 'error', 'Vente introuvable');
END IF;

IF v_sale.accounting_status = 'accounted' THEN
RETURN jsonb_build_object('success', false, 'error', 'Vente déjà comptabilisée');
END IF;

IF v_sale.status IN ('cancelled', 'deleted') OR v_sale.deleted_at IS NOT NULL THEN
RETURN jsonb_build_object('success', false, 'error', 'Impossible de comptabiliser une vente annulée');
END IF;

v_tva := round(COALESCE(v_sale.vat_amount, 0), 2);
v_ttc := round(v_sale.total, 2);
v_ht := COALESCE(v_sale.vat_net_amount, round(v_sale.subtotal - COALESCE(v_sale.discount, 0), 2));
IF v_ht IS NULL OR v_ttc IS NULL OR v_ht < 0 OR v_tva < 0 OR v_ttc <= 0
   OR v_ttc IN ('NaN'::numeric, 'Infinity'::numeric)
   OR v_ht + v_tva IS DISTINCT FROM v_ttc
   OR (v_sale.vat_enabled_at_issue AND v_sale.vat_net_amount IS NULL) THEN
  RETURN jsonb_build_object('success', false, 'error', 'Les montants HT, TVA et TTC de la vente ne concordent pas.');
END IF;
v_customer_name := COALESCE(v_sale.customer_name, 'Client comptant');

v_entry_date := COALESCE(v_sale.created_at::date, CURRENT_DATE);

IF v_sale.customer_id IS NOT NULL THEN
v_customer_account := get_or_create_customer_account(v_sale.tenant_id, v_sale.customer_id);
ELSE
BEGIN
v_customer_account := resolve_account(v_sale.tenant_id, 'CUSTOMER_CONTROL');
EXCEPTION WHEN OTHERS THEN
RETURN jsonb_build_object('success', false, 'error', 'Résolution CUSTOMER_CONTROL échouée: ' || SQLERRM);
END;
END IF;

v_debit_account := v_customer_account;

BEGIN
v_credit_vente := resolve_account(v_sale.tenant_id, 'SALES_GOODS');
EXCEPTION WHEN OTHERS THEN
RETURN jsonb_build_object('success', false, 'error', 'Résolution SALES_GOODS échouée: ' || SQLERRM);
END;

IF v_tva > 0 THEN
BEGIN
v_credit_tva := resolve_account(v_sale.tenant_id, 'VAT_OUTPUT');
IF v_sale.vat_enabled_at_issue AND v_credit_tva NOT LIKE '443%' THEN
  RETURN jsonb_build_object('success', false, 'error', 'Associez la TVA facturée à un compte actif de la famille 443.');
END IF;
EXCEPTION WHEN OTHERS THEN
RETURN jsonb_build_object('success', false, 'error', 'Résolution VAT_OUTPUT échouée: ' || SQLERRM);
END;
END IF;

IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_debit_account) THEN
RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_debit_account || ' introuvable dans le plan comptable.');
END IF;
IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_credit_vente) THEN
RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_credit_vente || ' introuvable dans le plan comptable.');
END IF;

v_piece_number := next_accounting_piece_number(v_sale.tenant_id, 'VE');

INSERT INTO journal_entries (
tenant_id, entry_number, journal_type, entry_date, reference, description,
total_debit, total_credit, is_balanced, source_type, source_id, status, posted_at, posted_by
) VALUES (
v_sale.tenant_id, v_piece_number, 'VE', v_entry_date,
v_sale.sale_number,
'Vente ' || v_sale.sale_number || ' - ' || v_customer_name,
v_ttc, v_ttc, true,
'sale', p_sale_id, 'posted', now(), auth.uid()
) RETURNING id INTO v_entry_id;

INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
VALUES (
v_sale.tenant_id, v_entry_id, v_debit_account,
(SELECT name FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_debit_account LIMIT 1),
v_ttc, 0,
'Vente ' || v_sale.sale_number || ' ' || v_customer_name,
v_sale.customer_id
);

IF v_ht > 0 THEN
INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label)
VALUES (
v_sale.tenant_id, v_entry_id, v_credit_vente,
(SELECT name FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_credit_vente LIMIT 1),
0, v_ht,
'Vente marchandises ' || v_sale.sale_number
);
END IF;

IF v_tva > 0 THEN
INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label)
VALUES (
v_sale.tenant_id, v_entry_id, v_credit_tva,
(SELECT name FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_credit_tva LIMIT 1),
0, v_tva,
'TVA collectée ' || v_sale.sale_number
);
END IF;

UPDATE sales SET
accounting_status = 'accounted',
accounting_entry_id = v_entry_id,
accounted_at = now()
WHERE id = p_sale_id
AND tenant_id = v_caller_tenant;

RETURN jsonb_build_object(
'success', true,
'entry_id', v_entry_id,
'piece_number', v_piece_number,
'journal', 'VE',
'total', v_ttc
);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_public_sale_invoice(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale   public.sales%ROWTYPE;
  v_items  jsonb;
  v_pays   jsonb;
  v_cust   jsonb;
  v_tenant jsonb;
BEGIN
  SELECT * INTO v_sale FROM public.sales WHERE public_code = p_token LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Items
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'name', i.name,
    'quantity', i.quantity,
    'unit_price', i.unit_price,
    'discount', i.discount,
    'total', i.total,
    'vat_rate', CASE WHEN v_sale.vat_enabled_at_issue THEN i.vat_rate END
  ) ORDER BY i.name), '[]'::jsonb)
  INTO v_items
  FROM public.sale_items i
  WHERE i.sale_id = v_sale.id AND i.tenant_id = v_sale.tenant_id;

  -- Payments
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'method_name', p.method_name,
    'amount', p.amount
  )), '[]'::jsonb)
  INTO v_pays
  FROM public.sale_payments p
  WHERE p.sale_id = v_sale.id AND p.tenant_id = v_sale.tenant_id;

  -- Customer
  IF v_sale.customer_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'name', c.name,
      'phone', c.phone,
      'email', c.email,
      'address', c.address
    ) INTO v_cust
    FROM public.customers c
    WHERE c.id = v_sale.customer_id AND c.tenant_id = v_sale.tenant_id;
  END IF;

  -- Tenant
  SELECT jsonb_build_object(
    'name', t.name,
    'legal_name', t.legal_name,
    'ninea', t.ninea,
    'rccm', t.rccm,
    'address', t.address,
    'phone', t.phone,
    'email', t.email,
    'website', t.website,
    'logo_url', t.logo_url,
    'business_type', t.business_type
  ) INTO v_tenant
  FROM public.tenants t
  WHERE t.id = v_sale.tenant_id;

  RETURN jsonb_build_object(
    'sale', jsonb_build_object(
      'sale_number', v_sale.sale_number,
      'created_at', v_sale.created_at,
      'status', v_sale.status,
      'subtotal', v_sale.subtotal,
      'discount', v_sale.discount,
      'vat_net_amount', v_sale.vat_net_amount,
      'vat_amount', v_sale.vat_amount,
      'total', v_sale.total,
      'paid', COALESCE(v_sale.paid, 0),
      'note', v_sale.note,
      'doc_header', v_sale.doc_header
    ),
    'customer', v_cust,
    'tenant', v_tenant,
    'items', v_items,
    'payments', v_pays
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_sale_invoice(text) TO anon, authenticated;
