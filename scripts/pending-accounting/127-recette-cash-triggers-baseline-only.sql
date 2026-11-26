-- RECETTE UNIQUEMENT : rétablissement de déclencheurs de caisse absents.
SET LOCAL search_path TO public, extensions, pg_catalog;
CREATE OR REPLACE FUNCTION public._ensure_default_cash_register(p_tenant_id uuid, p_site_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
v_id uuid;
BEGIN
IF p_tenant_id IS NULL OR p_site_id IS NULL THEN
RAISE EXCEPTION 'Caisse par défaut : magasin ou tenant manquant';
END IF;

PERFORM pg_advisory_xact_lock(hashtextextended('cash_registers:default:' || p_site_id::text, 0));

IF NOT EXISTS (SELECT 1 FROM sites WHERE id = p_site_id AND tenant_id = p_tenant_id) THEN
RAISE EXCEPTION 'Caisse par défaut : magasin introuvable pour ce tenant';
END IF;

SELECT id INTO v_id FROM cash_registers WHERE site_id = p_site_id AND is_default;
IF v_id IS NOT NULL THEN
RETURN v_id;
END IF;

INSERT INTO cash_registers (tenant_id, site_id, code, name, is_active, is_default)
VALUES (p_tenant_id, p_site_id, 'CAISSE-1', 'Caisse 1', true, true)
RETURNING id INTO v_id;

RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public._ensure_default_cash_register(p_tenant_id uuid, p_site_id uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public._trg_cash_sessions_register()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
v_reg record;
BEGIN
IF TG_OP = 'UPDATE' THEN
IF NEW.cash_register_id IS DISTINCT FROM OLD.cash_register_id THEN
RAISE EXCEPTION 'La caisse d''une session ne peut pas être modifiée';
END IF;
RETURN NEW;
END IF;

IF NEW.cash_register_id IS NULL THEN
NEW.cash_register_id := _ensure_default_cash_register(NEW.tenant_id, NEW.site_id);
RETURN NEW;
END IF;

SELECT id, tenant_id, site_id, is_active INTO v_reg
FROM cash_registers WHERE id = NEW.cash_register_id
FOR SHARE;

IF NOT FOUND OR v_reg.tenant_id IS DISTINCT FROM NEW.tenant_id OR v_reg.site_id IS DISTINCT FROM NEW.site_id THEN
RAISE EXCEPTION 'Caisse invalide pour ce magasin';
END IF;

IF coalesce(NEW.status, 'open') = 'open' AND NOT v_reg.is_active THEN
RAISE EXCEPTION 'Cette caisse est désactivée';
END IF;

RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._trg_cash_sessions_register() FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public._trg_cs_closed_by()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
IF TG_OP = 'INSERT' THEN
NEW.closed_by := NULL;
ELSIF OLD.status = 'open' AND NEW.status = 'closed' THEN
NEW.closed_by := auth.uid();
ELSE
NEW.closed_by := OLD.closed_by;
END IF;
RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._trg_cs_closed_by() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public._trg_cs_closed_by() TO service_role;
CREATE OR REPLACE FUNCTION public._trg_cs_open_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
v_uid uuid := auth.uid();
v_multi boolean;
v_changed text[];
BEGIN
IF NEW.status = 'open' AND (TG_OP = 'INSERT'
OR OLD.status IS DISTINCT FROM 'open'
OR NEW.site_id IS DISTINCT FROM OLD.site_id
OR NEW.user_id IS DISTINCT FROM OLD.user_id
OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
PERFORM public._cs_lock_open_keys(NEW.tenant_id, NEW.site_id, NEW.user_id);
v_multi := public._cs_multi_enabled(NEW.tenant_id);
IF NOT v_multi THEN
IF EXISTS (SELECT 1 FROM cash_sessions cs WHERE cs.site_id = NEW.site_id AND cs.status = 'open' AND cs.id <> NEW.id) THEN
RAISE EXCEPTION 'duplicate key value violates unique constraint "idx_cash_sessions_one_open_per_site"'
USING ERRCODE = '23505', CONSTRAINT = 'idx_cash_sessions_one_open_per_site',
DETAIL = 'Key (site_id)=(' || NEW.site_id::text || ') already exists.';
END IF;
ELSE
IF NEW.user_id IS NULL THEN
RAISE EXCEPTION 'Une session de caisse doit avoir un opérateur' USING ERRCODE = '23514';
END IF;
IF EXISTS (SELECT 1 FROM cash_sessions cs WHERE cs.user_id = NEW.user_id AND cs.status = 'open' AND cs.id <> NEW.id) THEN
RAISE EXCEPTION 'Vous avez déjà une session de caisse ouverte. Clôturez-la avant d''en ouvrir une autre.' USING ERRCODE = '23505';
END IF;
END IF;
END IF;

IF TG_OP = 'UPDATE' AND v_uid IS NOT NULL
AND COALESCE(current_setting('waarwi.cs_close_session', true), '') <> OLD.id::text
AND public._cs_multi_enabled(OLD.tenant_id) THEN
SELECT array_agg(n.key ORDER BY n.key) INTO v_changed
FROM jsonb_each(to_jsonb(NEW)) n
WHERE n.value IS DISTINCT FROM (to_jsonb(OLD) -> n.key)
AND n.key NOT IN ('theoretical_amount', 'updated_at');
IF v_changed IS NOT NULL THEN
RAISE EXCEPTION 'En mode multi-caisse, une session ne peut être modifiée que par les opérations de caisse (%)', array_to_string(v_changed, ', ')
USING ERRCODE = '42501';
END IF;
IF NEW.theoretical_amount IS DISTINCT FROM OLD.theoretical_amount
AND (OLD.user_id IS DISTINCT FROM v_uid OR OLD.status <> 'open')
AND NOT (OLD.status = 'open' AND public._cs_supervision_active(OLD.id, OLD.site_id)) THEN
RAISE EXCEPTION 'Cette session de caisse appartient à un autre opérateur' USING ERRCODE = '42501';
END IF;
END IF;
RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._trg_cs_open_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.cash_movement_receipt_prefix(p_kind text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
SELECT CASE p_kind
WHEN 'income' THEN 'ENC'
WHEN 'customer_prepayment' THEN 'ACO'
WHEN 'expense' THEN 'DEC'
WHEN 'customer_withdrawal' THEN 'RTC'
WHEN 'customer_loan' THEN 'PRT'
WHEN 'refund' THEN 'RMB'
WHEN 'vault_deposit' THEN 'VDP'
WHEN 'vault_withdrawal' THEN 'VRT'
ELSE 'MVT'
END;
$function$;
REVOKE ALL ON FUNCTION public.cash_movement_receipt_prefix(p_kind text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cash_movement_receipt_prefix(p_kind text) TO anon;
GRANT EXECUTE ON FUNCTION public.cash_movement_receipt_prefix(p_kind text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cash_movement_receipt_prefix(p_kind text) TO service_role;
CREATE OR REPLACE FUNCTION public.assign_cash_movement_receipt_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_prefix text;
v_num bigint;
BEGIN
IF NEW.receipt_number IS NOT NULL OR NEW.tenant_id IS NULL THEN
RETURN NEW;
END IF;
v_prefix := cash_movement_receipt_prefix(NEW.kind);
INSERT INTO tenant_doc_counters (tenant_id, doc_kind, last_number)
VALUES (NEW.tenant_id, 'cm_' || v_prefix, 1)
ON CONFLICT (tenant_id, doc_kind)
DO UPDATE SET last_number = tenant_doc_counters.last_number + 1
RETURNING last_number INTO v_num;
NEW.receipt_number := v_prefix || '-' || lpad(v_num::text, 8, '0');
RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.assign_cash_movement_receipt_number() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.assign_cash_movement_receipt_number() TO service_role;
CREATE TRIGGER trg_assign_cash_movement_receipt_number BEFORE INSERT ON public.cash_movements FOR EACH ROW EXECUTE FUNCTION assign_cash_movement_receipt_number();
CREATE TRIGGER trg_cs_row_guard BEFORE INSERT OR UPDATE OF cash_session_id ON public.cash_movements FOR EACH ROW EXECUTE FUNCTION _trg_cs_row_guard('cash_session_id');
CREATE TRIGGER trg_cash_sessions_register BEFORE INSERT OR UPDATE ON public.cash_sessions FOR EACH ROW EXECUTE FUNCTION _trg_cash_sessions_register();
CREATE TRIGGER trg_cs_closed_by BEFORE INSERT OR UPDATE ON public.cash_sessions FOR EACH ROW EXECUTE FUNCTION _trg_cs_closed_by();
CREATE TRIGGER trg_cs_open_guard BEFORE INSERT OR UPDATE ON public.cash_sessions FOR EACH ROW EXECUTE FUNCTION _trg_cs_open_guard();
CREATE TRIGGER trg_cs_row_guard BEFORE INSERT OR UPDATE OF cash_session_id, refund_cash_session_id ON public.sale_returns FOR EACH ROW EXECUTE FUNCTION _trg_cs_row_guard('cash_session_id', 'refund_cash_session_id');
