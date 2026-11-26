-- Prérequis de la branche isolée UNIQUEMENT. Ne pas rejouer en production.
CREATE OR REPLACE FUNCTION public._finish_sale_vat()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_lines jsonb;
  v_subtotal numeric;
  v_vat numeric;
  v_ht numeric;
BEGIN
  SELECT sum(i.total), jsonb_agg(jsonb_build_object('line_key', i.id::text, 'base', i.total, 'rate', i.vat_rate))
  INTO v_subtotal, v_lines
  FROM public.sale_items i WHERE i.sale_id = NEW.id AND i.tenant_id = NEW.tenant_id;
  IF v_subtotal IS NULL OR round(v_subtotal, 2) IS DISTINCT FROM round(NEW.subtotal, 2)
     OR COALESCE(NEW.discount, 0) NOT BETWEEN 0 AND v_subtotal THEN
    RAISE EXCEPTION 'Les lignes et la remise HT de la facture ne concordent pas.';
  END IF;

  WITH snapshots AS (
    UPDATE public.sale_items i SET vat_amount = a.vat, vat_net_amount = a.net
    FROM public._sale_vat_lines(v_lines, NEW.discount) a WHERE i.id = a.line_key::uuid
    RETURNING i.vat_amount, i.vat_net_amount
  )
  SELECT sum(vat_amount), sum(vat_net_amount) INTO v_vat, v_ht FROM snapshots;
  IF v_ht + v_vat IS DISTINCT FROM NEW.total THEN
    RAISE EXCEPTION 'Le prix TTC a changé. Vérifiez les montants avant de valider la vente.';
  END IF;
  UPDATE public.sales SET vat_amount = v_vat, vat_net_amount = v_ht
  WHERE id = NEW.id AND tenant_id = NEW.tenant_id;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._finish_sale_vat() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public._protect_sale_item_vat()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public._protect_sale_item_vat() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public._protect_sale_vat()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public._protect_sale_vat() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public._snapshot_sale_item_vat()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public._snapshot_sale_item_vat() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public._start_sale_vat()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public._start_sale_vat() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public._trg_cs_row_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
v_new jsonb := to_jsonb(NEW);
v_old jsonb;
v_tenant uuid;
v_col text;
v_ns uuid;
v_os uuid;
BEGIN
IF auth.uid() IS NULL THEN RETURN NEW; END IF;
v_tenant := NULLIF(v_new ->> 'tenant_id', '')::uuid;
IF NOT public._cs_multi_enabled(v_tenant) THEN RETURN NEW; END IF;
IF TG_OP = 'UPDATE' THEN v_old := to_jsonb(OLD); END IF;
FOREACH v_col IN ARRAY TG_ARGV LOOP
v_ns := NULLIF(v_new ->> v_col, '')::uuid;
v_os := CASE WHEN TG_OP = 'UPDATE' THEN NULLIF(v_old ->> v_col, '')::uuid END;
IF TG_OP = 'UPDATE' AND v_os IS NOT NULL AND v_ns IS DISTINCT FROM v_os THEN
RAISE EXCEPTION 'Le rattachement d''une opération à sa session de caisse ne peut pas être modifié' USING ERRCODE = '42501';
END IF;
IF v_ns IS NOT NULL AND (TG_OP = 'INSERT' OR v_os IS NULL) THEN
PERFORM public._cs_assert_operational(v_ns, v_tenant, NULLIF(v_new ->> 'site_id', '')::uuid);
END IF;
END LOOP;
RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._trg_cs_row_guard() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public._trg_sale_public_code()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
IF NEW.public_code IS NULL OR NEW.public_code = '' THEN
NEW.public_code := public._gen_sale_public_code();
END IF;
RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._trg_sale_public_code() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.apply_customer_prepayments(p_customer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_tenant_id uuid; v_prepay record; v_sale record;
v_available numeric; v_due numeric; v_take numeric;
v_new_paid numeric; v_new_status text; v_applied numeric := 0; v_method text;
v_multi boolean;
BEGIN
v_tenant_id := current_tenant_id();
IF v_tenant_id IS NULL THEN RETURN jsonb_build_object('applied', 0); END IF;
IF p_customer_id IS NULL THEN RETURN jsonb_build_object('applied', 0); END IF;
v_multi := public._cs_multi_enabled(v_tenant_id);

FOR v_prepay IN
SELECT * FROM public.customer_prepayments
WHERE tenant_id = v_tenant_id AND customer_id = p_customer_id AND amount_used < amount
ORDER BY created_at ASC FOR UPDATE
LOOP
v_available := v_prepay.amount - v_prepay.amount_used;
EXIT WHEN v_available <= 0;

FOR v_sale IN
SELECT * FROM public.sales
WHERE tenant_id = v_tenant_id AND customer_id = p_customer_id
AND status <> 'cancelled' AND deleted_at IS NULL
AND COALESCE(paid, 0) < COALESCE(total, 0)
ORDER BY created_at ASC FOR UPDATE
LOOP
v_due := GREATEST(0, COALESCE(v_sale.total, 0) - COALESCE(v_sale.paid, 0));
v_take := LEAST(v_available, v_due);
IF v_take <= 0 THEN CONTINUE; END IF;

SELECT COALESCE(pm.name, 'Acompte') INTO v_method FROM public.payment_methods pm
WHERE pm.tenant_id = v_tenant_id AND pm.payment_type = 'credit' LIMIT 1;
v_method := COALESCE(v_method, 'Acompte');

INSERT INTO public.sale_payments (tenant_id, sale_id, payment_method_id, method_name, amount, reference, affects_balance)
VALUES (v_tenant_id, v_sale.id, NULL, 'Acompte · ' || COALESCE(v_prepay.method_name, 'Caisse'),
v_take, CASE WHEN v_multi THEN 'Imputation acompte' ELSE 'Imputation acompte ' || COALESCE(v_prepay.reference, '') END, false);

v_new_paid := COALESCE(v_sale.paid, 0) + v_take;
v_new_status := CASE WHEN v_new_paid >= COALESCE(v_sale.total, 0) THEN 'paid' ELSE 'partial' END;
UPDATE public.sales SET paid = v_new_paid, status = v_new_status WHERE id = v_sale.id;

UPDATE public.customer_prepayments SET amount_used = amount_used + v_take WHERE id = v_prepay.id;

INSERT INTO public.credit_allocations (tenant_id, customer_id, source_type, source_id, target_type, target_id, amount)
VALUES (v_tenant_id, p_customer_id, 'prepay', v_prepay.id, 'invoice', v_sale.id, v_take)
ON CONFLICT (source_id, target_id, source_type, target_type) DO NOTHING;

v_available := v_available - v_take;
v_applied := v_applied + v_take;
EXIT WHEN v_available <= 0;
END LOOP;
END LOOP;

PERFORM public._allocate_negative_adjustments_to_invoices(p_customer_id, v_tenant_id);
RETURN jsonb_build_object('applied', v_applied);
END;
$function$;
REVOKE ALL ON FUNCTION public.apply_customer_prepayments(p_customer_id uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.check_negative_stock_trigger_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_site            record;
v_allow_negative  boolean;
BEGIN
-- Only check when quantity is going negative
IF NEW.quantity >= 0 THEN
RETURN NEW;
END IF;

-- Fetch the site record
SELECT s.id, s.is_warehouse, s.parent_site_id, s.allow_negative_stock
INTO v_site
FROM sites s
WHERE s.id = NEW.site_id;

-- If site not found, allow (defensive)
IF v_site IS NULL THEN
RETURN NEW;
END IF;

-- For depots (is_warehouse = true), check the PARENT site's flag
IF v_site.is_warehouse = true AND v_site.parent_site_id IS NOT NULL THEN
SELECT allow_negative_stock
INTO v_allow_negative
FROM sites
WHERE id = v_site.parent_site_id;

-- If parent not found, fall back to the depot's own flag
IF v_allow_negative IS NULL THEN
v_allow_negative := v_site.allow_negative_stock;
END IF;
ELSE
-- Root store: use its own flag
v_allow_negative := v_site.allow_negative_stock;
END IF;

-- Enforce the constraint
IF v_allow_negative = false THEN
RAISE EXCEPTION '[NEGATIVE_STOCK_FORBIDDEN] Stock négatif interdit pour ce magasin';
END IF;

RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.check_negative_stock_trigger_fn() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.trg_apply_prepayments_on_sale()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;
IF NEW.status = 'cancelled' THEN RETURN NEW; END IF;
IF COALESCE(NEW.paid, 0) >= COALESCE(NEW.total, 0) THEN RETURN NEW; END IF;

PERFORM apply_customer_prepayments(NEW.customer_id);
RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.trg_apply_prepayments_on_sale() FROM PUBLIC,anon,authenticated;

CREATE TRIGGER protect_sale_item_vat BEFORE DELETE OR UPDATE ON public.sale_items FOR EACH ROW EXECUTE FUNCTION _protect_sale_item_vat();

CREATE TRIGGER snapshot_sale_item_vat BEFORE INSERT ON public.sale_items FOR EACH ROW EXECUTE FUNCTION _snapshot_sale_item_vat();

CREATE TRIGGER trg_cs_row_guard BEFORE INSERT OR UPDATE OF cash_session_id ON public.sale_payments FOR EACH ROW EXECUTE FUNCTION _trg_cs_row_guard('cash_session_id');

CREATE CONSTRAINT TRIGGER finish_sale_vat AFTER INSERT ON public.sales DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (new.vat_enabled_at_issue) EXECUTE FUNCTION _finish_sale_vat();

CREATE TRIGGER protect_sale_vat BEFORE DELETE OR UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION _protect_sale_vat();

CREATE TRIGGER sales_apply_prepayments AFTER INSERT ON public.sales FOR EACH ROW EXECUTE FUNCTION trg_apply_prepayments_on_sale();

CREATE TRIGGER start_sale_vat BEFORE INSERT ON public.sales FOR EACH ROW EXECUTE FUNCTION _start_sale_vat();

CREATE TRIGGER trg_cs_row_guard BEFORE INSERT OR UPDATE OF cash_session_id ON public.sales FOR EACH ROW EXECUTE FUNCTION _trg_cs_row_guard('cash_session_id');

CREATE TRIGGER trg_sale_public_code BEFORE INSERT ON public.sales FOR EACH ROW EXECUTE FUNCTION _trg_sale_public_code();

CREATE TRIGGER trg_guard_negative_stock BEFORE INSERT OR UPDATE ON public.stock_levels FOR EACH ROW EXECUTE FUNCTION check_negative_stock_trigger_fn();
