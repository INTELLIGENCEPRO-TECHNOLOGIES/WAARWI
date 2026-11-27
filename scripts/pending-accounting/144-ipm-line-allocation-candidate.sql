-- Private arithmetic primitives. No historical data inferred or written.
-- Caller must determine the convention, eligibility and final approved coverage on the server.
-- allocation_base is the verified distributable amount for each line, never a client assertion.
CREATE FUNCTION public._ipm_allocate_line_shares(p_lines jsonb,p_approved_ipm numeric)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $f$
DECLARE capacity numeric;total_gross numeric;result jsonb;
BEGIN
 IF p_lines IS NULL OR jsonb_typeof(p_lines)<>'array' THEN RAISE EXCEPTION 'Lignes IPM invalides.' USING ERRCODE='22023';END IF;
 IF jsonb_array_length(p_lines) NOT BETWEEN 1 AND 500 OR p_approved_ipm IS NULL OR p_approved_ipm::text IN ('NaN','Infinity','-Infinity') OR p_approved_ipm<0 OR round(p_approved_ipm,2)<>p_approved_ipm THEN RAISE EXCEPTION 'Montant IPM invalide.' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_lines) z(line_id uuid,gross numeric,allocation_base numeric)
 WHERE z.line_id IS NULL OR z.gross IS NULL OR z.allocation_base IS NULL
 OR z.gross::text IN ('NaN','Infinity','-Infinity') OR z.allocation_base::text IN ('NaN','Infinity','-Infinity')
 OR z.gross<0 OR z.allocation_base<0 OR z.allocation_base>z.gross
 OR round(z.gross,2)<>z.gross OR round(z.allocation_base,2)<>z.allocation_base)
 OR EXISTS(SELECT 1 FROM jsonb_to_recordset(p_lines) z(line_id uuid) GROUP BY z.line_id HAVING count(*)>1) THEN
 RAISE EXCEPTION 'Montants ou identité des lignes IPM invalides.' USING ERRCODE='22023';END IF;
 SELECT sum(z.allocation_base),sum(z.gross) INTO capacity,total_gross FROM jsonb_to_recordset(p_lines) z(line_id uuid,gross numeric,allocation_base numeric);
 IF p_approved_ipm>capacity THEN RAISE EXCEPTION 'Prise en charge supérieure à la ventilation justifiée.' USING ERRCODE='22023';END IF;
 WITH amounts AS (
 SELECT z.*,sum(z.allocation_base) OVER(ORDER BY z.line_id ROWS UNBOUNDED PRECEDING) AS cumulative
 FROM jsonb_to_recordset(p_lines) z(line_id uuid,gross numeric,allocation_base numeric)
 ), shares AS (
 SELECT a.*,CASE WHEN capacity=0 THEN 0 ELSE
 round(p_approved_ipm*a.cumulative/capacity,2)-round(p_approved_ipm*(a.cumulative-a.allocation_base)/capacity,2) END AS ipm
 FROM amounts a
 )
 SELECT jsonb_build_object('gross',total_gross,'ipm',p_approved_ipm,'patient',total_gross-p_approved_ipm,
 'lines',jsonb_agg(jsonb_build_object('line_id',s.line_id,'gross',s.gross,'ipm',s.ipm,'patient',s.gross-s.ipm) ORDER BY s.line_id))
 INTO result FROM shares s;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(result->'lines') z(ipm numeric,patient numeric) WHERE z.ipm<0 OR z.patient<0)
 OR (SELECT sum(z.ipm) FROM jsonb_to_recordset(result->'lines') z(ipm numeric)) IS DISTINCT FROM p_approved_ipm THEN
 RAISE EXCEPTION 'Ventilation IPM incohérente.' USING ERRCODE='55000';END IF;
 RETURN result;
END $f$;
REVOKE ALL ON FUNCTION public._ipm_allocate_line_shares(jsonb,numeric) FROM PUBLIC,anon,authenticated,service_role;

-- Compute delta from immutable original line shares; cumulative rounding exhausts both shares exactly.
-- This is not a refund authorization or a fiscal posting routine.
CREATE FUNCTION public._ipm_return_line_delta(p_ipm numeric,p_patient numeric,p_original_qty numeric,p_prior_qty numeric,p_new_qty numeric)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $f$
DECLARE i numeric;c numeric;
BEGIN
 IF EXISTS(SELECT 1 FROM unnest(ARRAY[p_ipm,p_patient,p_original_qty,p_prior_qty,p_new_qty]) v WHERE v IS NULL OR v::text IN ('NaN','Infinity','-Infinity'))
 OR p_ipm<0 OR p_patient<0 OR round(p_ipm,2)<>p_ipm OR round(p_patient,2)<>p_patient
 OR p_original_qty<=0 OR p_prior_qty<0 OR p_new_qty<=0 OR p_prior_qty+p_new_qty>p_original_qty THEN
 RAISE EXCEPTION 'Quantité ou ventilation IPM historique invalide.' USING ERRCODE='22023';END IF;
 i:=round(p_ipm*(p_prior_qty+p_new_qty)/p_original_qty,2)-round(p_ipm*p_prior_qty/p_original_qty,2);
 c:=round(p_patient*(p_prior_qty+p_new_qty)/p_original_qty,2)-round(p_patient*p_prior_qty/p_original_qty,2);
 RETURN jsonb_build_object('ipm',i,'patient',c,'gross',i+c);
END $f$;
REVOKE ALL ON FUNCTION public._ipm_return_line_delta(numeric,numeric,numeric,numeric,numeric) FROM PUBLIC,anon,authenticated,service_role;
