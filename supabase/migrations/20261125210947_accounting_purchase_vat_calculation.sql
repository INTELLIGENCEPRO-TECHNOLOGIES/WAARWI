CREATE OR REPLACE FUNCTION public._calculate_purchase_invoice_amounts(
  p_lines jsonb, p_declared jsonb
) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = ''
AS $fn$
DECLARE
  l jsonb;
  n numeric;
  r numeric;
  d numeric;
  tax numeric;
  recovered numeric;
  net_total numeric := 0;
  vat_total numeric := 0;
  recovered_total numeric := 0;
  gross_total numeric;
  max_safe CONSTANT numeric := 9007199254740991;
  line_results jsonb := '[]'::jsonb;
  k text;
  result jsonb;
BEGIN
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Lignes de facture invalides.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_lines) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Une facture doit contenir entre 1 et 500 lignes.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_declared) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Montants de la facture fournisseur obligatoires.' USING ERRCODE = '22023';
  END IF;
  FOR l IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    IF jsonb_typeof(l->'netMinor') IS DISTINCT FROM 'number'
      OR jsonb_typeof(l->'vatBps') IS DISTINCT FROM 'number'
      OR jsonb_typeof(l->'deductibleBps') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Montants HT et taux de TVA numériques obligatoires.' USING ERRCODE = '22023';
    END IF;
    n := (l->>'netMinor')::numeric;
    r := (l->>'vatBps')::numeric;
    d := (l->>'deductibleBps')::numeric;
    IF n NOT BETWEEN 0 AND max_safe OR n <> trunc(n)
      OR r NOT BETWEEN 0 AND 10000 OR r <> trunc(r)
      OR d NOT BETWEEN 0 AND 10000 OR d <> trunc(d) THEN
      RAISE EXCEPTION 'Montant ou taux hors limites.' USING ERRCODE = '22023';
    END IF;
    tax := round(n*r/10000);
    recovered := round(tax*d/10000);
    net_total := net_total + n;
    vat_total := vat_total + tax;
    recovered_total := recovered_total + recovered;
    IF net_total + vat_total > max_safe THEN
      RAISE EXCEPTION 'Montant de facture trop élevé.' USING ERRCODE = '22023';
    END IF;
    line_results := line_results || jsonb_build_array(jsonb_build_object(
      'netMinor',n,'vatMinor',tax,'deductibleVatMinor',recovered,
      'nonDeductibleVatMinor',tax-recovered,'grossMinor',n+tax,
      'expenseMinor',n+tax-recovered
    ));
  END LOOP;
  IF net_total <= 0 THEN
    RAISE EXCEPTION 'Le montant HT total doit être positif.' USING ERRCODE = '22023';
  END IF;
  gross_total := net_total + vat_total;
  result := jsonb_build_object(
    'lines',line_results,'netMinor',net_total,'vatMinor',vat_total,
    'deductibleVatMinor',recovered_total,'nonDeductibleVatMinor',vat_total-recovered_total,
    'grossMinor',gross_total,'expenseMinor',gross_total-recovered_total
  );
  FOREACH k IN ARRAY ARRAY['netMinor','vatMinor','grossMinor'] LOOP
    IF jsonb_typeof(p_declared->k) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Montant déclaré manquant : %',k USING ERRCODE = '22023';
    END IF;
    IF (p_declared->>k)::numeric IS DISTINCT FROM (result->>k)::numeric THEN
      RAISE EXCEPTION 'Écart avec la facture fournisseur : %',k USING ERRCODE = '22023';
    END IF;
  END LOOP;
  RETURN result;
END;
$fn$;
REVOKE ALL ON FUNCTION public._calculate_purchase_invoice_amounts(jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
