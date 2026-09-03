/*
# Coût d'achat serveur pour les factures créées depuis la Facturation

## Objet
Corriger la valorisation des factures directes créées depuis l'écran Facturation.
Jusqu'ici, les lignes étaient insérées dans `sale_items` sans `purchase_cost`,
donc la base enregistrait un coût nul et les rapports affichaient mécaniquement
une marge de 100 %. Le POS était déjà correct car ses RPC récupèrent le coût
côté serveur.

## Nouvelle fonction
1. `insert_billing_sale_items(p_sale_id uuid, p_items jsonb)`
   - Insère les lignes de vente d'une facture directe.
   - Pour chaque ligne, le coût enregistré (`sale_items.purchase_cost`) est lu
     côté serveur depuis `articles.purchase_price` du tenant courant.
   - Le coût n'est JAMAIS pris depuis une valeur envoyée par le navigateur.
   - Une vente sous le coût reste autorisée (marge négative réelle possible) ;
     le prix de vente n'est jamais utilisé pour dériver un coût.

## Sécurité
- Fonction SECURITY DEFINER, `search_path` figé à `public`.
- Vérifie que la vente appartient bien au tenant courant (`current_tenant_id()`).
- EXECUTE réservé au rôle `authenticated`, révoqué pour `anon`.

## Notes
1. Aucune donnée existante n'est modifiée. Aucun backfill des anciennes factures.
2. La logique des rapports est inchangée : ils continuent d'utiliser le coût
   historique enregistré dans `sale_items.purchase_cost`.
*/

CREATE OR REPLACE FUNCTION public.insert_billing_sale_items(
  p_sale_id uuid,
  p_items jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_sale_tenant uuid;
  v_item jsonb;
  v_article_id uuid;
  v_purchase_cost numeric;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Aucun tenant courant';
  END IF;

  SELECT tenant_id INTO v_sale_tenant FROM sales WHERE id = p_sale_id;
  IF v_sale_tenant IS NULL OR v_sale_tenant <> v_tenant_id THEN
    RAISE EXCEPTION 'Vente introuvable pour ce tenant';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_article_id := NULLIF(v_item->>'article_id', '')::uuid;
    IF v_article_id IS NULL THEN
      RAISE EXCEPTION 'article_id manquant sur une ligne de facture';
    END IF;

    SELECT COALESCE(purchase_price, 0) INTO v_purchase_cost
    FROM articles WHERE id = v_article_id AND tenant_id = v_tenant_id;
    v_purchase_cost := COALESCE(v_purchase_cost, 0);

    INSERT INTO sale_items (
      tenant_id, sale_id, article_id, name, quantity, unit_price, discount, total, purchase_cost
    )
    VALUES (
      v_tenant_id, p_sale_id, v_article_id,
      COALESCE(v_item->>'name', ''),
      COALESCE((v_item->>'quantity')::numeric, 0),
      COALESCE((v_item->>'unit_price')::numeric, 0),
      COALESCE((v_item->>'discount')::numeric, 0),
      COALESCE((v_item->>'total')::numeric, 0),
      v_purchase_cost
    );
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.insert_billing_sale_items(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.insert_billing_sale_items(uuid, jsonb) TO authenticated;
