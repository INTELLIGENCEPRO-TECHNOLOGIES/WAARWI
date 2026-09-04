/*
# Correction du solde de clôture du relevé client

Le solde de clôture = somme de tous les mouvements affectant le solde jusqu'à
la fin de la période (borne exclusive). Correction de la condition erronée de la
version précédente. Seule cette expression change ; le reste est identique.
*/

CREATE OR REPLACE FUNCTION public.get_customer_statement(
  p_customer_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_from_ts   timestamptz;
  v_to_excl   timestamptz;
  v_result    jsonb;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Contexte tenant introuvable';
  END IF;

  PERFORM 1 FROM customers WHERE id = p_customer_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client introuvable';
  END IF;

  v_from_ts := CASE WHEN p_from IS NOT NULL THEN p_from::timestamptz ELSE NULL END;
  v_to_excl := CASE WHEN p_to IS NOT NULL THEN (p_to + 1)::timestamptz ELSE NULL END;

  WITH movements AS (
    SELECT ba.created_at AS ts, 1 AS ord, ''::text AS piece,
           CASE
             WHEN ba.kind = 'cancel_reversal' THEN COALESCE(NULLIF(ba.note, ''), 'Contre-passation annulation')
             WHEN ba.amount > 0 THEN COALESCE(NULLIF(ba.note, ''), 'Report de solde')
             ELSE COALESCE(NULLIF(ba.note, ''), 'Règlement solde')
           END AS label,
           CASE WHEN ba.kind = 'cancel_reversal' THEN GREATEST(ba.amount, 0)
                WHEN ba.amount > 0 THEN ba.amount ELSE 0 END AS debit,
           CASE WHEN ba.kind = 'cancel_reversal' THEN GREATEST(-ba.amount, 0)
                WHEN ba.amount < 0 THEN -ba.amount ELSE 0 END AS credit,
           (ba.kind <> 'cancel_reversal') AS affects
    FROM balance_adjustments ba
    WHERE ba.tenant_id = v_tenant_id AND ba.entity_type = 'customer'
      AND ba.entity_id = p_customer_id
      AND ba.kind IS DISTINCT FROM 'reconciliation' AND ba.amount <> 0

    UNION ALL
    SELECT s.created_at, 2, s.sale_number,
           CASE WHEN s.status = 'cancelled' THEN 'Facture annulée'
                WHEN s.status = 'deleted' THEN 'Facture'
                ELSE 'Vente' END,
           s.total::numeric, 0::numeric,
           (s.status NOT IN ('cancelled', 'deleted'))
    FROM sales s
    WHERE s.tenant_id = v_tenant_id AND s.customer_id = p_customer_id

    UNION ALL
    SELECT COALESCE(s.deleted_at, s.created_at), 3, s.sale_number,
           'Suppression facture ' || s.sale_number, 0::numeric, s.total::numeric, false
    FROM sales s
    WHERE s.tenant_id = v_tenant_id AND s.customer_id = p_customer_id AND s.status = 'deleted'

    UNION ALL
    SELECT sp.created_at, 4, COALESCE(s.sale_number, ''),
           CASE WHEN sp.affects_balance = false THEN COALESCE(sp.method_name, 'Règlement par crédit')
                ELSE 'Règlement' || CASE WHEN sp.method_name IS NOT NULL THEN ' · ' || sp.method_name ELSE '' END END,
           0::numeric, sp.amount::numeric, COALESCE(sp.affects_balance, true)
    FROM sale_payments sp
    JOIN sales s ON s.id = sp.sale_id
    LEFT JOIN payment_methods pm ON pm.id = sp.payment_method_id
    WHERE s.tenant_id = v_tenant_id AND s.customer_id = p_customer_id
      AND COALESCE(pm.payment_type, '') <> 'credit'
      AND NOT (COALESCE(sp.affects_balance, true) = true
               AND (sp.method_name LIKE 'Acompte ·%' OR sp.method_name LIKE 'Avoir %'))

    UNION ALL
    SELECT pp.created_at, 5, COALESCE(pp.reference, ''),
           'Acompte' || CASE WHEN pp.method_name IS NOT NULL THEN ' · ' || pp.method_name ELSE '' END,
           0::numeric, pp.amount::numeric, true
    FROM customer_prepayments pp
    WHERE pp.tenant_id = v_tenant_id AND pp.customer_id = p_customer_id AND pp.amount > 0

    UNION ALL
    SELECT COALESCE(sr.refunded_at, sr.created_at), 6, sr.return_number, 'Avoir',
           0::numeric, sr.total::numeric, true
    FROM sale_returns sr
    WHERE sr.tenant_id = v_tenant_id AND sr.customer_id = p_customer_id
      AND sr.status = 'approved' AND sr.refund_method = 'avoir'

    UNION ALL
    SELECT cm.created_at, 7, COALESCE(cm.reference, ''),
           'Retrait caisse' || CASE WHEN COALESCE(cm.reason, '') <> '' THEN ' · ' || cm.reason ELSE '' END,
           cm.amount::numeric, 0::numeric, true
    FROM cash_movements cm
    WHERE cm.tenant_id = v_tenant_id AND cm.customer_id = p_customer_id
      AND cm.kind = 'customer_withdrawal'

    UNION ALL
    SELECT cm.created_at, 8, COALESCE(cm.reference, ''),
           'Prêt client' || CASE WHEN COALESCE(cm.reason, '') <> '' THEN ' · ' || cm.reason ELSE '' END,
           cm.amount::numeric, 0::numeric, true
    FROM cash_movements cm
    WHERE cm.tenant_id = v_tenant_id AND cm.customer_id = p_customer_id
      AND cm.kind = 'customer_loan'
  ),
  ordered AS (
    SELECT m.*,
           SUM(CASE WHEN m.affects THEN m.debit - m.credit ELSE 0 END)
             OVER (ORDER BY m.ts, m.ord ROWS UNBOUNDED PRECEDING) AS running
    FROM movements m
  ),
  period AS (
    SELECT * FROM ordered
    WHERE (v_from_ts IS NULL OR ts >= v_from_ts)
      AND (v_to_excl IS NULL OR ts < v_to_excl)
  )
  SELECT jsonb_build_object(
    'opening_balance', COALESCE((
        SELECT SUM(CASE WHEN affects THEN debit - credit ELSE 0 END)
        FROM movements WHERE v_from_ts IS NOT NULL AND ts < v_from_ts), 0),
    'total_debit', COALESCE(SUM(debit) FILTER (WHERE affects), 0),
    'total_credit', COALESCE(SUM(credit) FILTER (WHERE affects), 0),
    'closing_balance', COALESCE((
        SELECT SUM(CASE WHEN affects THEN debit - credit ELSE 0 END)
        FROM movements WHERE v_to_excl IS NULL OR ts < v_to_excl), 0),
    'rows', COALESCE(jsonb_agg(jsonb_build_object(
        'ts', ts, 'piece', piece, 'label', label,
        'debit', debit, 'credit', credit, 'running', running, 'affects', affects
      ) ORDER BY ts, ord), '[]'::jsonb)
  )
  INTO v_result
  FROM period;

  RETURN v_result;
END;
$function$;
