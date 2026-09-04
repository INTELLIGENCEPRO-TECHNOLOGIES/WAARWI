/*
# Ajout du type de mouvement (kind) au relevé client

L'écran de compte client filtre par catégorie (Ventes, Règlements, Avoirs,
Imputations, Prêts). On expose donc un champ `kind` par ligne, aligné sur la
sémantique du grand livre de l'interface, afin que l'écran et l'impression
partagent exactement la même source de données. Seule la projection change.
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
  v_tenant_id   uuid;
  v_from_ts     timestamptz;
  v_to_excl     timestamptz;
  v_balance     numeric := 0;
  v_total_delta numeric := 0;
  v_base        numeric := 0;
  v_result      jsonb;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Contexte tenant introuvable';
  END IF;

  SELECT COALESCE(balance, 0) INTO v_balance
  FROM customers WHERE id = p_customer_id AND tenant_id = v_tenant_id;
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
           (ba.kind <> 'cancel_reversal') AS affects,
           CASE WHEN ba.kind = 'cancel_reversal' THEN 'cancel'
                WHEN ba.amount > 0 THEN 'adjustment' ELSE 'payment' END AS kind
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
           (s.status NOT IN ('cancelled', 'deleted')),
           CASE WHEN s.status IN ('cancelled', 'deleted') THEN 'cancel' ELSE 'sale' END
    FROM sales s
    WHERE s.tenant_id = v_tenant_id AND s.customer_id = p_customer_id

    UNION ALL
    SELECT COALESCE(s.deleted_at, s.created_at), 3, s.sale_number,
           'Suppression facture ' || s.sale_number, 0::numeric, s.total::numeric, false, 'cancel'
    FROM sales s
    WHERE s.tenant_id = v_tenant_id AND s.customer_id = p_customer_id AND s.status = 'deleted'

    UNION ALL
    SELECT sp.created_at, 4, COALESCE(s.sale_number, ''),
           CASE WHEN sp.affects_balance = false THEN COALESCE(sp.method_name, 'Règlement par crédit')
                ELSE 'Règlement' || CASE WHEN sp.method_name IS NOT NULL THEN ' · ' || sp.method_name ELSE '' END END,
           0::numeric, sp.amount::numeric, COALESCE(sp.affects_balance, true),
           CASE WHEN sp.affects_balance = false THEN 'allocation' ELSE 'payment' END
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
           0::numeric, pp.amount::numeric, true, 'payment'
    FROM customer_prepayments pp
    WHERE pp.tenant_id = v_tenant_id AND pp.customer_id = p_customer_id AND pp.amount > 0

    UNION ALL
    SELECT COALESCE(sr.refunded_at, sr.created_at), 6, sr.return_number, 'Avoir',
           0::numeric, sr.total::numeric, true, 'avoir'
    FROM sale_returns sr
    WHERE sr.tenant_id = v_tenant_id AND sr.customer_id = p_customer_id
      AND sr.status = 'approved' AND sr.refund_method = 'avoir'

    UNION ALL
    SELECT cm.created_at, 7, COALESCE(cm.reference, ''),
           'Retrait caisse' || CASE WHEN COALESCE(cm.reason, '') <> '' THEN ' · ' || cm.reason ELSE '' END,
           cm.amount::numeric, 0::numeric, true, 'withdrawal'
    FROM cash_movements cm
    WHERE cm.tenant_id = v_tenant_id AND cm.customer_id = p_customer_id
      AND cm.kind = 'customer_withdrawal'

    UNION ALL
    SELECT cm.created_at, 8, COALESCE(cm.reference, ''),
           'Prêt client' || CASE WHEN COALESCE(cm.reason, '') <> '' THEN ' · ' || cm.reason ELSE '' END,
           cm.amount::numeric, 0::numeric, true, 'loan'
    FROM cash_movements cm
    WHERE cm.tenant_id = v_tenant_id AND cm.customer_id = p_customer_id
      AND cm.kind = 'customer_loan'
  ),
  ordered AS (
    SELECT m.*,
           SUM(CASE WHEN m.affects THEN m.debit - m.credit ELSE 0 END)
             OVER (ORDER BY m.ts, m.ord ROWS UNBOUNDED PRECEDING) AS cum
    FROM movements m
  )
  SELECT
    COALESCE((SELECT SUM(CASE WHEN affects THEN debit - credit ELSE 0 END) FROM movements), 0),
    jsonb_build_object(
      'balance', v_balance,
      'opening_delta', COALESCE((
          SELECT SUM(CASE WHEN affects THEN debit - credit ELSE 0 END)
          FROM movements WHERE v_from_ts IS NOT NULL AND ts < v_from_ts), 0),
      'closing_delta', COALESCE((
          SELECT SUM(CASE WHEN affects THEN debit - credit ELSE 0 END)
          FROM movements WHERE v_to_excl IS NULL OR ts < v_to_excl), 0),
      'total_debit', COALESCE((SELECT SUM(debit) FROM ordered o
          WHERE affects AND (v_from_ts IS NULL OR o.ts >= v_from_ts) AND (v_to_excl IS NULL OR o.ts < v_to_excl)), 0),
      'total_credit', COALESCE((SELECT SUM(credit) FROM ordered o
          WHERE affects AND (v_from_ts IS NULL OR o.ts >= v_from_ts) AND (v_to_excl IS NULL OR o.ts < v_to_excl)), 0),
      'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'ts', o.ts, 'piece', o.piece, 'label', o.label, 'kind', o.kind,
            'debit', o.debit, 'credit', o.credit, 'cum', o.cum, 'affects', o.affects
          ) ORDER BY o.ts, o.ord)
        FROM ordered o
        WHERE (v_from_ts IS NULL OR o.ts >= v_from_ts) AND (v_to_excl IS NULL OR o.ts < v_to_excl)),
        '[]'::jsonb)
    )
  INTO v_total_delta, v_result
  FROM (SELECT 1) _;

  v_base := v_balance - v_total_delta;

  v_result := jsonb_set(v_result, '{opening_balance}',
      to_jsonb(v_base + (v_result->>'opening_delta')::numeric));
  v_result := jsonb_set(v_result, '{closing_balance}',
      to_jsonb(v_base + (v_result->>'closing_delta')::numeric));
  v_result := v_result - 'opening_delta' - 'closing_delta';
  v_result := jsonb_set(v_result, '{rows}', COALESCE((
      SELECT jsonb_agg(
        jsonb_set(r - 'cum', '{running}', to_jsonb(v_base + (r->>'cum')::numeric)))
      FROM jsonb_array_elements(v_result->'rows') r), '[]'::jsonb));

  RETURN v_result;
END;
$function$;
