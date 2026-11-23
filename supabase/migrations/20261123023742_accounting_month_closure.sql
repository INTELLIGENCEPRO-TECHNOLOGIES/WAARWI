-- PC2D-B.1: close an entire accounting month and guard journal writes.
-- Open month rows coordinate reporting and journal writes for one tenant/month.

CREATE TABLE public.accounting_month_closures (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  month_start date NOT NULL CHECK (isfinite(month_start) AND extract(day FROM month_start) = 1),
  closed_at timestamptz,
  closed_by uuid,
  note text,
  control_snapshot jsonb,
  PRIMARY KEY (tenant_id, month_start),
  CHECK ((closed_at IS NULL AND closed_by IS NULL AND note IS NULL AND control_snapshot IS NULL)
      OR (closed_at IS NOT NULL AND closed_by IS NOT NULL AND jsonb_typeof(control_snapshot) = 'object'
        AND control_snapshot IS NOT NULL)),
  CHECK (note IS NULL OR length(note) BETWEEN 1 AND 500)
);

ALTER TABLE public.accounting_month_closures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accounting_month_closures FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._assert_accounting_month_open(p_tenant_id uuid, p_month_start date)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_closed_at timestamptz;
BEGIN
  SELECT c.closed_at INTO v_closed_at
  FROM public.accounting_month_closures c
  WHERE c.tenant_id = p_tenant_id AND c.month_start = p_month_start FOR SHARE;

  IF NOT FOUND THEN
    INSERT INTO public.accounting_month_closures (tenant_id, month_start)
    VALUES (p_tenant_id, p_month_start) ON CONFLICT (tenant_id, month_start) DO NOTHING;
    SELECT c.closed_at INTO v_closed_at
    FROM public.accounting_month_closures c
    WHERE c.tenant_id = p_tenant_id AND c.month_start = p_month_start FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La période a changé pendant la transaction. Réessayez.' USING ERRCODE = '40001';
    END IF;
  END IF;

  IF v_closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'La période comptable de % est clôturée.', to_char(p_month_start, 'MM/YYYY')
      USING ERRCODE = '55000';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._protect_accounting_entry_months()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old_tenant uuid;
  v_new_tenant uuid;
  v_old_date date;
  v_new_date date;
  v_month record;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old_tenant := OLD.tenant_id; v_old_date := OLD.entry_date; END IF;
  IF TG_OP <> 'DELETE' THEN v_new_tenant := NEW.tenant_id; v_new_date := NEW.entry_date; END IF;

  FOR v_month IN
    SELECT DISTINCT p.tenant_id, date_trunc('month', p.entry_date::timestamp)::date AS month_start
    FROM (VALUES (v_old_tenant, v_old_date), (v_new_tenant, v_new_date)) p(tenant_id, entry_date)
    WHERE p.tenant_id IS NOT NULL AND p.entry_date IS NOT NULL
    ORDER BY p.tenant_id, month_start
  LOOP
    PERFORM public._assert_accounting_month_open(v_month.tenant_id, v_month.month_start);
  END LOOP;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public._protect_accounting_line_months()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old_tenant uuid;
  v_new_tenant uuid;
  v_old_entry uuid;
  v_new_entry uuid;
  v_new_found boolean := false;
  v_parent record;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old_tenant := OLD.tenant_id; v_old_entry := OLD.entry_id; END IF;
  IF TG_OP <> 'DELETE' THEN v_new_tenant := NEW.tenant_id; v_new_entry := NEW.entry_id; END IF;

  -- Pin the parents while reading their dates, including both sides of a move.
  -- A cascaded DELETE can see no parent. The header trigger already checked it.
  FOR v_parent IN
    SELECT j.tenant_id, j.id, date_trunc('month', j.entry_date::timestamp)::date AS month_start
    FROM public.journal_entries j
    WHERE (j.tenant_id = v_old_tenant AND j.id = v_old_entry) OR (j.tenant_id = v_new_tenant AND j.id = v_new_entry)
    ORDER BY j.tenant_id, month_start, j.id FOR SHARE
  LOOP
    IF v_parent.tenant_id = v_new_tenant AND v_parent.id = v_new_entry THEN v_new_found := true; END IF;
    PERFORM public._assert_accounting_month_open(v_parent.tenant_id, v_parent.month_start);
  END LOOP;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NOT v_new_found THEN
    RAISE EXCEPTION 'L’écriture de la ligne est introuvable.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_closed_accounting_entry
  BEFORE INSERT OR UPDATE OR DELETE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public._protect_accounting_entry_months();

CREATE TRIGGER guard_closed_accounting_line
  BEFORE INSERT OR UPDATE OR DELETE ON public.journal_lines
  FOR EACH ROW EXECUTE FUNCTION public._protect_accounting_line_months();

CREATE OR REPLACE FUNCTION public._accounting_month_snapshot(p_tenant_id uuid, p_report jsonb)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = ''
SET timezone = 'UTC'
AS $$
  WITH period_entries AS MATERIALIZED (
    SELECT j.* FROM public.journal_entries j WHERE j.tenant_id = p_tenant_id
      AND j.entry_date BETWEEN (p_report->>'from')::date AND (p_report->>'to')::date
  ),
  entry_version AS (
    SELECT count(*) FILTER (WHERE status NOT IN ('posted', 'cancelled')) AS unposted,
      md5(COALESCE(string_agg(md5(to_jsonb(j)::text), '' ORDER BY j.id), '')) AS version
    FROM period_entries j
  ),
  line_version AS (
    SELECT md5(COALESCE(string_agg(md5(to_jsonb(l)::text), '' ORDER BY l.id), '')) AS version
    FROM public.journal_lines l JOIN period_entries j ON j.id = l.entry_id AND j.tenant_id = l.tenant_id
  )
  SELECT (p_report - ARRAY['issues', 'journal_examples', 'account_examples'])
    || jsonb_build_object('unposted_entries', e.unposted, 'ledger_version', e.version || l.version)
  FROM entry_version e CROSS JOIN line_version l;
$$;

CREATE OR REPLACE FUNCTION public._accounting_month_assessment(p_snapshot jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'blocked',
      (p_snapshot->'journal'->>'inconsistent_entries')::bigint > 0
      OR (p_snapshot->'journal'->>'duplicate_sources')::bigint > 0
      OR (p_snapshot->'accounts'->>'inconsistent_accounts')::bigint > 0
      OR (p_snapshot->>'unposted_entries')::bigint > 0,
    'has_observations',
      EXISTS (SELECT 1 FROM jsonb_array_elements(p_snapshot->'coverage') r
        WHERE (r->>'missing')::bigint > 0 OR (r->>'invalid')::bigint > 0 OR (r->>'date_differences')::bigint > 0)
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_snapshot->'third_parties') r
        WHERE (r->>'configured')::boolean IS NOT TRUE OR (r->>'unassigned_lines')::bigint > 0
          OR (r->>'ledger_debit')::numeric IS DISTINCT FROM (r->>'balance_debit')::numeric
          OR (r->>'ledger_credit')::numeric IS DISTINCT FROM (r->>'balance_credit')::numeric)
  );
$$;

CREATE OR REPLACE FUNCTION public._closed_accounting_month_receipt(p_closure public.accounting_month_closures)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'status', 'closed', 'closed_at', p_closure.closed_at,
    'closed_by_name', (SELECT p.full_name FROM public.profiles p
      WHERE p.tenant_id = p_closure.tenant_id AND p.id = p_closure.closed_by),
    'note', p_closure.note, 'snapshot', p_closure.control_snapshot
  );
$$;

CREATE OR REPLACE FUNCTION public.preview_accounting_closure(p_tenant_id uuid, p_date_from date, p_date_to date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_report jsonb;
  v_snapshot jsonb;
  v_assessment jsonb;
  v_closure public.accounting_month_closures;
BEGIN
  -- The reporting RPC validates the period and the tenant's view permission.
  v_report := public.accounting_period_controls(p_tenant_id, p_date_from, p_date_to);
  IF extract(day FROM p_date_from) <> 1 OR (p_date_from + interval '1 month')::date - 1 <> p_date_to THEN
    RETURN v_report || jsonb_build_object('month_closure', NULL);
  END IF;

  SELECT * INTO v_closure FROM public.accounting_month_closures c
  WHERE c.tenant_id = p_tenant_id AND c.month_start = p_date_from AND c.closed_at IS NOT NULL;
  IF FOUND THEN
    RETURN v_report || jsonb_build_object('month_closure', public._closed_accounting_month_receipt(v_closure));
  END IF;

  IF p_date_to >= (statement_timestamp() AT TIME ZONE 'UTC')::date THEN
    RETURN v_report || jsonb_build_object('month_closure', jsonb_build_object('status', 'in_progress'));
  END IF;

  v_snapshot := public._accounting_month_snapshot(p_tenant_id, v_report);
  v_assessment := public._accounting_month_assessment(v_snapshot);
  RETURN v_report || jsonb_build_object('month_closure', v_assessment || jsonb_build_object(
    'status', 'open', 'review_token', md5(v_snapshot::text), 'unposted_entries', v_snapshot->'unposted_entries'
  ));
END;
$$;

CREATE OR REPLACE FUNCTION public.close_accounting_month(
  p_tenant_id uuid, p_month_start date, p_review_token text, p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_last_day date;
  v_closure public.accounting_month_closures;
  v_snapshot jsonb;
  v_assessment jsonb;
  v_note text := NULLIF(btrim(p_note), '');
BEGIN
  IF auth.uid() IS NULL OR p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM public.current_tenant_id()
     OR NOT public.current_user_can_manage_accounting() OR NOT public.current_user_can_view_accounting() THEN
    RAISE EXCEPTION 'Permission de gérer la comptabilité requise.' USING ERRCODE = '42501';
  END IF;
  IF p_month_start IS NULL OR NOT isfinite(p_month_start) OR extract(day FROM p_month_start) <> 1 THEN
    RAISE EXCEPTION 'Choisissez un mois civil à clôturer.' USING ERRCODE = '22023';
  END IF;
  v_last_day := (p_month_start + interval '1 month')::date - 1;
  IF v_last_day >= (statement_timestamp() AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'Le mois doit être terminé avant la clôture.' USING ERRCODE = '22023';
  END IF;
  -- Recheck the ledger in a new snapshot after waiting for journal writers.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Relancez la clôture dans une nouvelle transaction.' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.accounting_month_closures (tenant_id, month_start)
  VALUES (p_tenant_id, p_month_start) ON CONFLICT (tenant_id, month_start) DO NOTHING;
  SELECT * INTO STRICT v_closure FROM public.accounting_month_closures c
  WHERE c.tenant_id = p_tenant_id AND c.month_start = p_month_start FOR UPDATE;
  IF v_closure.closed_at IS NOT NULL THEN
    RETURN public._closed_accounting_month_receipt(v_closure);
  END IF;

  v_snapshot := public._accounting_month_snapshot(
    p_tenant_id, public.accounting_period_controls(p_tenant_id, p_month_start, v_last_day)
  );
  IF p_review_token IS DISTINCT FROM md5(v_snapshot::text) THEN
    RAISE EXCEPTION 'Les contrôles ont changé. Contrôlez à nouveau la période.' USING ERRCODE = '55000';
  END IF;
  v_assessment := public._accounting_month_assessment(v_snapshot);
  IF (v_assessment->>'blocked')::boolean THEN
    RAISE EXCEPTION 'Corrigez les incohérences du journal et validez les écritures en attente avant la clôture.'
      USING ERRCODE = '55000';
  END IF;
  IF length(v_note) > 500 OR ((v_assessment->>'has_observations')::boolean AND v_note IS NULL) THEN
    RAISE EXCEPTION 'Documentez les écarts constatés dans une note de 500 caractères au maximum.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.accounting_month_closures c SET closed_at = clock_timestamp(), closed_by = auth.uid(),
    note = v_note, control_snapshot = v_snapshot
  WHERE c.tenant_id = p_tenant_id AND c.month_start = p_month_start
  RETURNING * INTO STRICT v_closure;

  RETURN public._closed_accounting_month_receipt(v_closure);
END;
$$;

REVOKE ALL ON FUNCTION public._assert_accounting_month_open(uuid, date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._protect_accounting_entry_months() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._protect_accounting_line_months() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._accounting_month_snapshot(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._accounting_month_assessment(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._closed_accounting_month_receipt(public.accounting_month_closures) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.preview_accounting_closure(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_accounting_month(uuid, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_accounting_closure(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_accounting_month(uuid, date, text, text) TO authenticated;
