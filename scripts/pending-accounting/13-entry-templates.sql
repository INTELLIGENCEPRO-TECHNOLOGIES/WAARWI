-- Phase 2 : modèles d'écritures, sans comptabilisation automatique.
-- Apply only after 12-journal-settings.sql.
CREATE TABLE public.accounting_entry_templates(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100),
 journal_code text NOT NULL CHECK(journal_code ~ '^[A-Z]{2,3}$'),
 description text NOT NULL CHECK(length(btrim(description)) BETWEEN 1 AND 500),
 lines jsonb NOT NULL CHECK(jsonb_typeof(lines)='array' AND jsonb_array_length(lines) BETWEEN 2 AND 500),
 is_active boolean NOT NULL DEFAULT true,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid,
 UNIQUE(tenant_id,id)
);
CREATE UNIQUE INDEX accounting_entry_templates_name_uq ON public.accounting_entry_templates(tenant_id,lower(name));
ALTER TABLE public.accounting_entry_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accounting_entry_templates FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.accounting_entry_templates TO authenticated;
CREATE POLICY accounting_entry_templates_read ON public.accounting_entry_templates FOR SELECT TO authenticated USING(tenant_id=public.current_tenant_id() AND public.current_user_can_view_accounting());
CREATE OR REPLACE FUNCTION public.save_accounting_entry_template(p_tenant_id uuid,p_name text,p_journal_code text,p_description text,p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l jsonb; d numeric; c numeric; td numeric:=0;tc numeric:=0; clean jsonb:='[]'::jsonb; template_id uuid;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,true);
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 100 OR p_description IS NULL OR length(btrim(p_description)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Nom et libellé obligatoires.'; END IF;
 IF NOT public._accounting_journal_allowed(p_tenant_id,p_journal_code,true) THEN RAISE EXCEPTION 'Journal inactif ou inconnu.';END IF;
 IF p_lines IS NULL OR jsonb_typeof(p_lines)<>'array' THEN RAISE EXCEPTION 'Lignes invalides.';END IF;
 IF jsonb_array_length(p_lines) NOT BETWEEN 2 AND 500 THEN RAISE EXCEPTION 'De 2 à 500 lignes requises.';END IF;
 PERFORM 1 FROM public.accounts a WHERE a.tenant_id=p_tenant_id AND a.code IN (SELECT x->>'account_code' FROM jsonb_array_elements(p_lines) x) ORDER BY a.code FOR SHARE;
 FOR l IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  IF NOT EXISTS(SELECT 1 FROM public.accounts a WHERE a.tenant_id=p_tenant_id AND a.code=l->>'account_code' AND a.is_active) THEN RAISE EXCEPTION 'Compte inactif ou inconnu : %',l->>'account_code';END IF;
  IF coalesce(l->>'debit','0') !~ '^[0-9]{1,13}(\.[0-9]{1,2})?$' OR coalesce(l->>'credit','0') !~ '^[0-9]{1,13}(\.[0-9]{1,2})?$' THEN RAISE EXCEPTION 'Montant invalide.';END IF;
  d:=coalesce((l->>'debit')::numeric,0);c:=coalesce((l->>'credit')::numeric,0);
  IF (d>0)=(c>0) OR length(coalesce(l->>'label',''))>500 THEN RAISE EXCEPTION 'Un seul sens et un libellé de 500 caractères maximum par ligne.';END IF;
  td:=td+d;tc:=tc+c;
  clean:=clean||jsonb_build_array(jsonb_build_object('account_code',l->>'account_code','label',coalesce(l->>'label',''),'debit',d,'credit',c));
 END LOOP;
 IF td<=0 OR td<>tc OR td>90071992547409 THEN RAISE EXCEPTION 'Modèle déséquilibré ou montant hors limite.';END IF;
 INSERT INTO public.accounting_entry_templates(tenant_id,name,journal_code,description,lines,updated_by)
 VALUES(p_tenant_id,btrim(p_name),p_journal_code,btrim(p_description),clean,auth.uid()) RETURNING id INTO template_id;
 RETURN jsonb_build_object('success',true,'id',template_id);
END;$$;
CREATE OR REPLACE FUNCTION public.archive_accounting_entry_template(p_tenant_id uuid,p_id uuid,p_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,true);
 UPDATE public.accounting_entry_templates SET is_active=false,revision=revision+1,updated_at=now(),updated_by=auth.uid()
 WHERE tenant_id=p_tenant_id AND id=p_id AND revision=p_revision AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Modèle absent ou modifié. Actualisez.' USING ERRCODE='40001';END IF;
 RETURN jsonb_build_object('success',true);
END;$$;
REVOKE ALL ON FUNCTION public.save_accounting_entry_template(uuid,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.archive_accounting_entry_template(uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_accounting_entry_template(uuid,text,text,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_accounting_entry_template(uuid,uuid,bigint) TO authenticated;
INSERT INTO public._br_table_registry(schema_name,table_name,tenant_link,tenant_id_column,category,restore_order,reset_behavior,is_mandatory)
VALUES('public','accounting_entry_templates','direct','tenant_id','structure',12,'preserve',false);
