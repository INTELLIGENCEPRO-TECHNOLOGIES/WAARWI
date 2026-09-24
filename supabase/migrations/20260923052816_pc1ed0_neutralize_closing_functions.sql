/*
  PC1E-D0 — Neutralize closing functions (no real closing logic yet)

  Both functions keep their exact signatures, owner, SECURITY DEFINER,
  search_path, and privilege grants. They validate the tenant, then
  return an error with code ACCOUNTING_CLOSING_NOT_READY.
  No INSERT, UPDATE, DELETE, no hardcoded account codes.
*/

-- cloturer_journal: same signature (uuid, text, date)
CREATE OR REPLACE FUNCTION public.cloturer_journal(
  p_tenant_id uuid, p_journal_type text, p_date_to date
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR current_tenant_id() IS NULL OR p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
    RAISE EXCEPTION 'Acces refuse au tenant demande';
  END IF;

  RETURN jsonb_build_object(
    'success', false,
    'code', 'ACCOUNTING_CLOSING_NOT_READY',
    'error', 'La clôture des journaux est temporairement indisponible pendant la finalisation du moteur comptable. Aucune écriture n''a été modifiée.'
  );
END;
$function$;

-- cloturer_exercice: same signature (uuid, integer)
CREATE OR REPLACE FUNCTION public.cloturer_exercice(
  p_tenant_id uuid, p_fiscal_year integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR current_tenant_id() IS NULL OR p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
    RAISE EXCEPTION 'Acces refuse au tenant demande';
  END IF;

  RETURN jsonb_build_object(
    'success', false,
    'code', 'ACCOUNTING_CLOSING_NOT_READY',
    'error', 'La clôture d''exercice est temporairement indisponible pendant la finalisation du moteur comptable. Aucune écriture n''a été créée.'
  );
END;
$function$;
