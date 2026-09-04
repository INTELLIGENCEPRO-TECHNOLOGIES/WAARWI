/*
# Réparation ciblée des données corrompues — SALIMATA MBERY NDONG (INTELLIGENCEPRO)

Migration corrective, en avant uniquement et idempotente, STRICTEMENT limitée au
tenant INTELLIGENCEPRO et au client SALIMATA MBERY NDONG. Aucun UPDATE global,
aucun autre tenant touché.

## Contexte
- F-00032 (270 000) : vente à crédit non réglée, annulée. Un ajustement de solde
  erroné de -270 000 « autonome » avait été créé, comptant le crédit deux fois.
- F-00033 (160 000) : réglée 160 000 en espèces, annulée sans session de caisse
  ouverte : aucun espèces n'a réellement quitté la caisse, les 160 000 restent
  en crédit client.

## Résultat visé (vérifié)
- F-00032 : nette = 0 ; 270 000 devient une contre-passation liée à F-00032
  (kind cancel_reversal), jamais un crédit autonome.
- Solde serveur final du client = -160 000 (« Crédit disponible : 160 000 FCFA »).

## Garde d'unicité / idempotence
Ne s'exécute que si tenant, client, factures, montants et ajustement -270 000
correspondent exactement et de manière unique. Sinon : aucune modification.
*/

DO $$
DECLARE
v_tenant uuid;
v_customer uuid;
v_f32 record;
v_f33 record;
v_adj_count int;
v_adj_id uuid;
v_real_refund numeric;
v_final numeric;
BEGIN
SELECT id INTO v_tenant FROM tenants WHERE name = 'INTELLIGENCEPRO';
IF v_tenant IS NULL THEN
RAISE NOTICE 'Réparation ignorée : tenant INTELLIGENCEPRO introuvable.';
RETURN;
END IF;

SELECT id INTO v_customer FROM customers
WHERE tenant_id = v_tenant AND name = 'SALIMATA MBERY NDONG';
IF v_customer IS NULL THEN
RAISE NOTICE 'Réparation ignorée : client SALIMATA MBERY NDONG introuvable.';
RETURN;
END IF;

SELECT * INTO v_f32 FROM sales
WHERE tenant_id = v_tenant AND customer_id = v_customer AND sale_number = 'F-00032';
SELECT * INTO v_f33 FROM sales
WHERE tenant_id = v_tenant AND customer_id = v_customer AND sale_number = 'F-00033';

IF v_f32 IS NULL OR v_f33 IS NULL THEN
RAISE NOTICE 'Réparation ignorée : factures F-00032/F-00033 introuvables.';
RETURN;
END IF;
IF v_f32.total <> 270000 OR v_f33.total <> 160000 THEN
RAISE NOTICE 'Réparation ignorée : montants ne correspondent pas.';
RETURN;
END IF;
IF v_f32.status <> 'cancelled' OR v_f33.status <> 'cancelled' THEN
RAISE NOTICE 'Réparation ignorée : les deux factures ne sont pas annulées.';
RETURN;
END IF;
IF v_f33.paid <> 160000 THEN
RAISE NOTICE 'Réparation ignorée : F-00033 n''affiche pas 160 000 encaissés.';
RETURN;
END IF;

SELECT COALESCE(SUM(amount), 0) INTO v_real_refund
FROM cash_movements
WHERE tenant_id = v_tenant AND kind = 'refund'
AND (reference = 'sale_cancel_' || v_f33.id::text OR customer_id = v_customer);
IF v_real_refund > 0 THEN
RAISE NOTICE 'Réparation ignorée : un remboursement espèces existe pour ce client.';
RETURN;
END IF;

SELECT COUNT(*) INTO v_adj_count FROM balance_adjustments
WHERE tenant_id = v_tenant AND entity_type = 'customer' AND entity_id = v_customer
AND amount = -270000 AND note ILIKE '%F-00032%'
AND kind IN ('manual', 'cancel_reversal');

IF v_adj_count <> 1 THEN
RAISE NOTICE 'Réparation ignorée : ajustement -270 000 non unique.';
RETURN;
END IF;

SELECT id INTO v_adj_id FROM balance_adjustments
WHERE tenant_id = v_tenant AND entity_type = 'customer' AND entity_id = v_customer
AND amount = -270000 AND note ILIKE '%F-00032%'
AND kind IN ('manual', 'cancel_reversal');

-- Idempotent : ne reclasse que si encore 'manual'
UPDATE balance_adjustments
SET kind = 'cancel_reversal',
note = 'Contre-passation annulation F-00032 (270 000) — ' || COALESCE(note, '')
WHERE id = v_adj_id AND kind = 'manual';

PERFORM public.recalculate_customer_balance(v_customer);

SELECT balance INTO v_final FROM customers WHERE id = v_customer;
IF v_final <> -160000 THEN
RAISE EXCEPTION 'Réparation SALIMATA : solde final inattendu % (attendu -160000).', v_final;
END IF;

RAISE NOTICE 'Réparation SALIMATA appliquée : solde final = %.', v_final;
END;
$$;
