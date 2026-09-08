/*
Fix _parse_warranty_days overflow when a doc_header.warranty field
accidentally contains a long numeric string (e.g. an IMEI).
The regex captures all leading digits, which can exceed int4 range.
Solution: cast to bigint first, then return NULL if the value is
unreasonably large (> 36500 days = ~100 years).
*/

CREATE OR REPLACE FUNCTION _parse_warranty_days(p_warranty text)
RETURNS int
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_lower text;
  v_num bigint;
  v_match text[];
  v_days bigint;
BEGIN
  IF p_warranty IS NULL OR trim(p_warranty) = '' THEN RETURN NULL; END IF;
  v_lower := lower(trim(p_warranty));
  v_match := regexp_match(v_lower, '^(\d+)');
  IF v_match IS NULL THEN RETURN NULL; END IF;
  v_num := v_match[1]::bigint;
  IF v_num > 36500 THEN RETURN NULL; END IF;
  IF v_lower ~ '(an|year)' THEN v_days := v_num * 365;
  ELSIF v_lower ~ '(mois|month)' THEN v_days := v_num * 30;
  ELSIF v_lower ~ '(jour|day)' THEN v_days := v_num;
  ELSIF v_lower ~ '(semaine|week)' THEN v_days := v_num * 7;
  ELSE v_days := v_num * 30;
  END IF;
  IF v_days > 36500 THEN RETURN NULL; END IF;
  RETURN v_days::int;
END;
$$;
