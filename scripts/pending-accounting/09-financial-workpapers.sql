-- Lot en attente : dossier de préparation des états financiers, pas une certification.
CREATE TABLE public.accounting_financial_workpapers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 fiscal_year integer NOT NULL CHECK(fiscal_year BETWEEN 2000 AND 2099),
 flow_inputs jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(flow_inputs)='object'),
 flow_justifications jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(flow_justifications)='object'),
 annexes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(annexes)='object'),
 revision bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),updated_by uuid NOT NULL,
 UNIQUE(tenant_id,fiscal_year)
);
ALTER TABLE public.accounting_financial_workpapers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accounting_financial_workpapers FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.accounting_financial_workpapers TO authenticated;
CREATE POLICY financial_workpapers_read ON public.accounting_financial_workpapers FOR SELECT TO authenticated USING(tenant_id=(SELECT public.current_tenant_id()) AND (SELECT public.current_user_can_view_accounting()));
INSERT INTO public._br_table_registry(schema_name,table_name,tenant_link,tenant_id_column,category,restore_order,reset_behavior,is_mandatory)
VALUES('public','accounting_financial_workpapers','direct','tenant_id','operation',92,'delete',false);
CREATE OR REPLACE FUNCTION public.save_financial_workpaper(p_tenant_id uuid,p_year integer,p_expected_revision bigint,p_inputs jsonb,p_justifications jsonb,p_annexes jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE old_row public.accounting_financial_workpapers%ROWTYPE;r record;v_amount numeric;new_revision bigint;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,true);
 IF p_year IS NULL OR p_year NOT BETWEEN 2000 AND 2099 OR p_expected_revision IS NULL OR p_expected_revision<0 THEN RAISE EXCEPTION 'Exercice ou version invalide.';END IF;
 IF jsonb_typeof(p_inputs) IS DISTINCT FROM 'object' OR jsonb_typeof(p_justifications) IS DISTINCT FROM 'object' OR jsonb_typeof(p_annexes) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Dossier invalide.';END IF;
 FOR r IN SELECT * FROM jsonb_each(p_inputs) LOOP
  IF r.key NOT IN ('FA','FB','FC','FD','FE','FF','FG','FH','FI','FJ','FK','FL','FM','FN','FO','FP','FQ') OR jsonb_typeof(r.value)<>'number' THEN RAISE EXCEPTION 'Rubrique de flux invalide.';END IF;
  v_amount:=(r.value#>>'{}')::numeric;
  IF abs(v_amount)>90071992547409 OR v_amount<>round(v_amount,2) THEN RAISE EXCEPTION 'Montant hors limites.';END IF;
  IF (r.key IN ('FF','FG','FH','FM','FN','FQ') AND v_amount>0) OR (r.key IN ('FI','FJ','FK','FL','FO','FP') AND v_amount<0) THEN RAISE EXCEPTION 'Sens du flux invalide : %.',r.key;END IF;
  IF nullif(btrim(p_justifications->>r.key),'') IS NULL THEN RAISE EXCEPTION 'Justification obligatoire : %.',r.key;END IF;
 END LOOP;
 FOR r IN SELECT * FROM jsonb_each(p_justifications) LOOP
  IF NOT (p_inputs ? r.key) OR jsonb_typeof(r.value)<>'string' OR length(r.value#>>'{}')>1000 THEN RAISE EXCEPTION 'Justification invalide.';END IF;
 END LOOP;
 FOR r IN SELECT * FROM jsonb_each(p_annexes) LOOP
  IF r.key NOT IN ('methods','inventory','assets','receivables','debts','equity','commitments','tax','events','other') OR jsonb_typeof(r.value)<>'string' OR length(r.value#>>'{}')>10000 THEN RAISE EXCEPTION 'Note annexe invalide.';END IF;
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':financial-workpaper:'||p_year::text,0));
 SELECT * INTO old_row FROM public.accounting_financial_workpapers WHERE tenant_id=p_tenant_id AND fiscal_year=p_year FOR UPDATE;
 IF coalesce(old_row.revision,0)<>p_expected_revision THEN RAISE EXCEPTION 'Le dossier a été modifié. Actualisez avant de sauvegarder.' USING ERRCODE='40001';END IF;
 INSERT INTO public.accounting_financial_workpapers(tenant_id,fiscal_year,flow_inputs,flow_justifications,annexes,updated_by)
 VALUES(p_tenant_id,p_year,p_inputs,p_justifications,p_annexes,auth.uid())
 ON CONFLICT(tenant_id,fiscal_year) DO UPDATE SET flow_inputs=excluded.flow_inputs,flow_justifications=excluded.flow_justifications,annexes=excluded.annexes,updated_at=now(),updated_by=auth.uid(),revision=public.accounting_financial_workpapers.revision+1
 RETURNING revision INTO new_revision;
 RETURN jsonb_build_object('success',true,'revision',new_revision);
END;$f$;
REVOKE ALL ON FUNCTION public.save_financial_workpaper(uuid,integer,bigint,jsonb,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_financial_workpaper(uuid,integer,bigint,jsonb,jsonb,jsonb) TO authenticated;
