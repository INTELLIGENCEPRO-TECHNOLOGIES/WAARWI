/*
# MC1-D : correction du type de la clé de clôture

1. Problème
- `cash_sessions.close_request_id` est de type uuid alors que `cash_session_close` y écrivait la clé texte,
  ce qui faisait échouer toute clôture en mode multi-caisse.

2. Correction
- La clé d'idempotence est convertie en uuid de façon déterministe : utilisée telle quelle si elle a la forme d'un uuid,
  sinon dérivée par md5. La comparaison du rejeu utilise la même conversion.
- Aucune table, aucune donnée, aucun droit modifiés. EXECUTE inchangé (authenticated uniquement).
*/

CREATE OR REPLACE FUNCTION public.cash_session_close(p_session_id uuid, p_control_lines jsonb, p_closing_note text DEFAULT ''::text, p_vault_deposit_amount numeric DEFAULT 0, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
v_me public.profiles;
v_s record;
v_res jsonb;
v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
v_key_id uuid;
BEGIN
v_me := public._cr_require_caller();
IF v_key IS NULL THEN
RAISE EXCEPTION 'Clé d''idempotence obligatoire pour la clôture' USING ERRCODE = '22023';
END IF;
v_key_id := CASE WHEN v_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  THEN v_key::uuid ELSE md5(v_key)::uuid END;
SELECT cs.id, cs.status, cs.user_id, cs.close_request_id, cs.closing_amount, cs.theoretical_amount, cs.variance
INTO v_s FROM cash_sessions cs
WHERE cs.id = p_session_id AND cs.tenant_id = v_me.tenant_id
FOR UPDATE;
IF NOT FOUND THEN
RAISE EXCEPTION 'Session de caisse introuvable ou déjà clôturée' USING ERRCODE = '42501';
END IF;
IF v_s.status <> 'open' THEN
IF v_s.close_request_id = v_key_id THEN
RETURN jsonb_build_object('success', true, 'replayed', true, 'counted_total', v_s.closing_amount,
'theoretical_total', v_s.theoretical_amount, 'variance', v_s.variance);
END IF;
RAISE EXCEPTION 'Session de caisse introuvable ou déjà clôturée' USING ERRCODE = '42501';
END IF;

v_res := public.close_cash_session_v2(p_session_id, p_control_lines, p_closing_note, p_vault_deposit_amount, v_key);
PERFORM set_config('waarwi.cs_close_session', p_session_id::text, true);
UPDATE cash_sessions SET close_request_id = v_key_id WHERE id = p_session_id;

IF v_s.user_id IS DISTINCT FROM v_me.id THEN
INSERT INTO audit_logs (tenant_id, user_id, action, module, reference_id, old_value, new_value)
VALUES (v_me.tenant_id, v_me.id, 'cash_session_admin_closed', 'cash_registers', p_session_id,
jsonb_build_object('owner', v_s.user_id), v_res);
END IF;
RETURN v_res || jsonb_build_object('replayed', false);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cash_session_close(uuid, jsonb, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cash_session_close(uuid, jsonb, text, numeric, text) TO authenticated;
