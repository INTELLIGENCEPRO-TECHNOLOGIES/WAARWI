-- Arithmetic tests only; no customer data, no mutation, rollback.
BEGIN;
DO $test$
DECLARE a uuid:='00000000-0000-0000-0000-000000000001'; b uuid:='00000000-0000-0000-0000-000000000002'; c uuid:='00000000-0000-0000-0000-000000000003';
 lines jsonb;r jsonb;r2 jsonb;d jsonb;i numeric:=0;p numeric:=0;k int; x numeric;
BEGIN
 lines:=jsonb_build_array(jsonb_build_object('line_id',a,'gross',8000,'allocation_base',8000),jsonb_build_object('line_id',b,'gross',2000,'allocation_base',0));
 r:=public._ipm_allocate_line_shares(lines,6400);
 IF (r->>'patient')::numeric<>3600 OR (r->'lines'->0->>'ipm')::numeric<>6400 OR (r->'lines'->1->>'ipm')::numeric<>0 OR (r->'lines'->1->>'patient')::numeric<>2000 THEN RAISE EXCEPTION 'Ventilation éligibilité incorrecte';END IF;
 r:=public._ipm_allocate_line_shares(lines,3000);
 IF (r->'lines'->0->>'ipm')::numeric<>3000 OR (r->'lines'->1->>'ipm')::numeric<>0 THEN RAISE EXCEPTION 'Plafond non respecté';END IF;
 r:=public._ipm_allocate_line_shares(lines,0);
 IF (r->>'patient')::numeric<>10000 THEN RAISE EXCEPTION 'Couverture nulle incorrecte';END IF;
 r:=public._ipm_allocate_line_shares(lines,8000);
 IF (r->>'patient')::numeric<>2000 THEN RAISE EXCEPTION 'Couverture intégrale éligible incorrecte';END IF;
 lines:=jsonb_build_array(jsonb_build_object('line_id',a,'gross',1.01,'allocation_base',1.01),jsonb_build_object('line_id',b,'gross',1.01,'allocation_base',1.01),jsonb_build_object('line_id',c,'gross',1.01,'allocation_base',1.01));
 r:=public._ipm_allocate_line_shares(lines,1.00);
 r2:=public._ipm_allocate_line_shares(jsonb_build_array(lines->2,lines->0,lines->1),1.00);
 IF r IS DISTINCT FROM r2 OR (SELECT sum(z.ipm) FROM jsonb_to_recordset(r->'lines') z(ipm numeric))<>1.00 OR (SELECT sum(z.patient) FROM jsonb_to_recordset(r->'lines') z(patient numeric))<>2.03 THEN RAISE EXCEPTION 'Arrondi global incorrect';END IF;
 r:=public._ipm_allocate_line_shares(jsonb_build_array(jsonb_build_object('line_id',a,'gross',0,'allocation_base',0)),0);
 IF (r->>'gross')::numeric<>0 OR (r->'lines'->0->>'ipm')::numeric<>0 THEN RAISE EXCEPTION 'Base nulle incorrecte';END IF;
 FOR k IN 0..2 LOOP
  d:=public._ipm_return_line_delta(6.41,3.59,3,k,1);i:=i+(d->>'ipm')::numeric;p:=p+(d->>'patient')::numeric;
 END LOOP;
 IF i<>6.41 OR p<>3.59 THEN RAISE EXCEPTION 'Retours cumulés inexacts';END IF;
 d:=public._ipm_return_line_delta(0,2000,1,0,1);
 IF (d->>'ipm')::numeric<>0 OR (d->>'patient')::numeric<>2000 THEN RAISE EXCEPTION 'Retour non éligible incorrect';END IF;
 d:=public._ipm_return_line_delta(4,6,2.5,0.5,2);
 IF (d->>'ipm')::numeric<>3.2 OR (d->>'patient')::numeric<>4.8 THEN RAISE EXCEPTION 'Quantité fractionnaire incorrecte';END IF;
 BEGIN PERFORM public._ipm_allocate_line_shares(lines,3.04);RAISE EXCEPTION 'Dépassement accepté';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public._ipm_allocate_line_shares(jsonb_build_array(lines->0,lines->0),1);RAISE EXCEPTION 'Doublon accepté';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public._ipm_allocate_line_shares(lines,'NaN'::numeric);RAISE EXCEPTION 'NaN accepté';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public._ipm_allocate_line_shares(jsonb_build_array(jsonb_build_object('line_id',a,'gross',1,'allocation_base',2)),1);RAISE EXCEPTION 'Base excessive acceptée';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public._ipm_return_line_delta(4,6,2,1,2);RAISE EXCEPTION 'Sur-retour accepté';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public._ipm_return_line_delta(NULL,6,2,0,1);RAISE EXCEPTION 'Historique incomplet accepté';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 IF has_function_privilege('authenticated','public._ipm_allocate_line_shares(jsonb,numeric)','EXECUTE') OR has_function_privilege('anon','public._ipm_return_line_delta(numeric,numeric,numeric,numeric,numeric)','EXECUTE') OR has_function_privilege('service_role','public._ipm_allocate_line_shares(jsonb,numeric)','EXECUTE') THEN RAISE EXCEPTION 'Fonction interne exposée';END IF;
END $test$;
ROLLBACK;
SELECT 'IPM_VENTILATION_CALCUL_OK' AS resultat;
