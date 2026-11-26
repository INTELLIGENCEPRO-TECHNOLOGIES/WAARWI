-- Charger 64/67/68/71/73/80/93 puis br_check_schema_drift, lot D et 98 dans la transaction de recette.
BEGIN;
DO $test$
DECLARE hooks jsonb; drift jsonb;
BEGIN
 IF (SELECT enabled FROM public._br_restore_config WHERE id=1) IS DISTINCT FROM false THEN RAISE EXCEPTION 'Moteur activé';END IF;
 IF has_function_privilege('authenticated','public._br_rs_request_reset(uuid,uuid)','EXECUTE') OR has_function_privilege('anon','public._br_rs_request_restore(uuid,uuid,integer,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Droits destructifs incorrects';END IF;
 BEGIN PERFORM public._br_assert_destructive_available();RAISE EXCEPTION 'BR020 non maintenu';EXCEPTION WHEN SQLSTATE 'BR020' THEN NULL;END;
 drift:=public.br_check_schema_drift();
 IF drift->>'drift_detected' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'Dérive registre : %',drift;END IF;
 hooks:=public._br_lotd_install_hooks();
 IF hooks->>'document_lease_gate' IS DISTINCT FROM 'true' OR (public._br_lotd_hooks_status()->>'ok') IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Crochets incomplets : %',public._br_lotd_hooks_status();END IF;
 IF (SELECT count(*) FROM pg_trigger tg WHERE tg.tgname IN ('trg_historical_matched_sale_item','trg_historical_matched_deduction','document_edit_notify') AND position('_br_restore_bypass' in pg_get_triggerdef(tg.oid))>0)<>3 THEN RAISE EXCEPTION 'Protections historiques et notifications non intégrées au moteur';END IF;
 IF (SELECT enabled FROM public._br_restore_config WHERE id=1) IS DISTINCT FROM false THEN RAISE EXCEPTION 'Activation involontaire';END IF;
END $test$;
ROLLBACK;
SELECT 'LOT_D_REGISTRE_CROCHETS_OK' AS resultat;