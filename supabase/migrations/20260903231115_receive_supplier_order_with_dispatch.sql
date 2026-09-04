/*
# Réception fournisseur transactionnelle avec répartition par emplacement

## Résumé
Ajoute un unique point d'entrée serveur, atomique et idempotent, pour réceptionner
une commande fournisseur en répartissant les quantités reçues entre le magasin
principal de la commande et ses dépôts rattachés (et, si le partage fournisseurs
est activé, les autres magasins). Remplace la succession d'appels client
`adjust_stock` / `adjust_stock_lot` + updates par une seule transaction serveur.

## Nouvelles tables
- `supplier_order_receptions` : trace chaque réception validée pour garantir
  l'idempotence.
  - `id` (uuid, PK)
  - `tenant_id` (uuid) — locataire
  - `order_id` (uuid) — commande réceptionnée
  - `idempotency_key` (text) — clé unique par locataire empêchant tout double envoi
  - `payload` (jsonb) — instantané de la répartition reçue
  - `created_by` (uuid) — utilisateur ayant validé
  - `created_at` (timestamptz)
  - Contrainte UNIQUE (tenant_id, idempotency_key).

## Nouvelles fonctions
- `receive_supplier_order(p_order_id uuid, p_allocations jsonb, p_idempotency_key text)`
  SECURITY DEFINER. Vérifie le locataire, la commande, l'accessibilité de chaque
  emplacement (magasin de la commande, ses dépôts `is_warehouse=true` +
  `parent_site_id = commande.site_id`, et les autres magasins si le partage
  fournisseurs est actif). Pour chaque répartition : met à jour `stock_levels`,
  crée un mouvement d'achat (`movement_type='purchase'`, lié à la commande via
  `reference_type`/`reference_id`), et crée un lot (`stock_lots`) si le mode lot
  est actif. Met ensuite à jour `quantity_received` une seule fois par ligne, puis
  le statut de la commande (`partial` ou `received`). Toute erreur annule
  l'intégralité de la réception (fonction = transaction unique).

## Sécurité
- RLS activée sur `supplier_order_receptions` (SELECT/INSERT pour authenticated,
  isolés par `current_tenant_id()`).
- La fonction est réservée au rôle `authenticated` ; `anon`/`public` sont révoqués.

## Notes importantes
1. Migration en avant uniquement : aucune réception historique n'est modifiée.
2. Idempotence : un même `idempotency_key` renvoie le résultat déjà calculé sans
   réappliquer les mouvements.
3. Le mode lot est déterminé par `tenants.settings->>'stock_method' = 'lot'`.
4. Le prix d'achat (`unit_price` de la ligne), le lot et l'expiration sont
   conservés sur le mouvement et sur le lot créé.
*/

CREATE TABLE IF NOT EXISTS supplier_order_receptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES supplier_orders(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'supplier_order_receptions_tenant_key_uniq'
  ) THEN
    ALTER TABLE supplier_order_receptions
      ADD CONSTRAINT supplier_order_receptions_tenant_key_uniq UNIQUE (tenant_id, idempotency_key);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_supplier_order_receptions_order
  ON supplier_order_receptions(order_id);

ALTER TABLE supplier_order_receptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_tenant_receptions" ON supplier_order_receptions;
CREATE POLICY "select_own_tenant_receptions" ON supplier_order_receptions FOR SELECT
  TO authenticated USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "insert_own_tenant_receptions" ON supplier_order_receptions;
CREATE POLICY "insert_own_tenant_receptions" ON supplier_order_receptions FOR INSERT
  TO authenticated WITH CHECK (tenant_id = current_tenant_id());

CREATE OR REPLACE FUNCTION public.receive_supplier_order(
  p_order_id uuid,
  p_allocations jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tenant uuid;
  v_order supplier_orders%ROWTYPE;
  v_stock_method text;
  v_shared boolean;
  v_alloc jsonb;
  v_item supplier_order_items%ROWTYPE;
  v_item_id uuid;
  v_site_id uuid;
  v_qty numeric;
  v_batch text;
  v_expiry date;
  v_previous numeric;
  v_new numeric;
  v_total_received numeric;
  v_all_received boolean := true;
  v_any numeric := 0;
  v_new_status text;
  r_item record;
BEGIN
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Aucun tenant courant'; END IF;

  IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array' OR jsonb_array_length(p_allocations) = 0 THEN
    RAISE EXCEPTION 'Aucune répartition fournie';
  END IF;

  SELECT * INTO v_order FROM supplier_orders
    WHERE id = p_order_id AND tenant_id = v_tenant FOR UPDATE;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Commande introuvable'; END IF;

  -- Idempotence : si la clé existe déjà, renvoyer l'état courant sans réappliquer
  IF p_idempotency_key IS NOT NULL AND p_idempotency_key <> '' AND EXISTS (
    SELECT 1 FROM supplier_order_receptions
    WHERE tenant_id = v_tenant AND idempotency_key = p_idempotency_key
  ) THEN
    RETURN jsonb_build_object('already_processed', true, 'order_id', p_order_id, 'status', v_order.status);
  END IF;

  SELECT COALESCE(settings->>'stock_method', 'none') INTO v_stock_method FROM tenants WHERE id = v_tenant;
  SELECT COALESCE((settings->>'shared_suppliers')::boolean, true) INTO v_shared FROM tenants WHERE id = v_tenant;

  -- Traiter chaque répartition
  FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
  LOOP
    v_item_id := (v_alloc->>'item_id')::uuid;
    v_site_id := (v_alloc->>'site_id')::uuid;
    v_qty := COALESCE((v_alloc->>'quantity')::numeric, 0);
    v_batch := COALESCE(v_alloc->>'batch_number', '');
    v_expiry := NULLIF(v_alloc->>'expiry_date', '')::date;

    IF v_qty <= 0 THEN CONTINUE; END IF;
    IF v_qty < 0 THEN RAISE EXCEPTION 'Quantité négative interdite'; END IF;

    -- Ligne de commande
    SELECT * INTO v_item FROM supplier_order_items
      WHERE id = v_item_id AND order_id = p_order_id AND tenant_id = v_tenant;
    IF v_item.id IS NULL THEN RAISE EXCEPTION 'Ligne de commande introuvable'; END IF;
    IF v_item.article_id IS NULL THEN RAISE EXCEPTION 'Article introuvable pour la ligne'; END IF;

    -- Emplacement autorisé : magasin de la commande, ses dépôts, ou autres magasins si partage actif
    IF NOT (
      v_site_id = v_order.site_id
      OR EXISTS (
        SELECT 1 FROM sites s
        WHERE s.id = v_site_id AND s.tenant_id = v_tenant AND s.is_active
          AND s.is_warehouse = true AND s.parent_site_id = v_order.site_id
      )
      OR (v_shared AND EXISTS (
        SELECT 1 FROM sites s
        WHERE s.id = v_site_id AND s.tenant_id = v_tenant AND s.is_active
          AND s.is_warehouse = false
      ))
    ) THEN
      RAISE EXCEPTION 'Emplacement non autorisé pour cette commande';
    END IF;

    -- Mise à jour du stock au bon emplacement
    SELECT quantity INTO v_previous FROM stock_levels
      WHERE article_id = v_item.article_id AND site_id = v_site_id;
    IF v_previous IS NULL THEN
      v_previous := 0;
      INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity)
      VALUES (v_tenant, v_item.article_id, v_site_id, 0);
    END IF;
    v_new := v_previous + v_qty;
    UPDATE stock_levels SET quantity = v_new, updated_at = now()
      WHERE article_id = v_item.article_id AND site_id = v_site_id;

    -- Mouvement d'achat lié à la commande
    INSERT INTO stock_movements (
      tenant_id, article_id, site_id, movement_type, quantity,
      previous_qty, new_qty, unit_cost, reference_type, reference_id, user_id, note
    ) VALUES (
      v_tenant, v_item.article_id, v_site_id, 'purchase', v_qty,
      v_previous, v_new, COALESCE(v_item.unit_price, 0), 'supplier_order', v_order.id, auth.uid(),
      'Réception commande ' || COALESCE(v_order.order_number, '')
    );

    -- Lot si mode lot actif
    IF v_stock_method = 'lot' THEN
      INSERT INTO stock_lots (
        tenant_id, article_id, site_id, batch_number, expiry_date,
        initial_quantity, remaining_quantity, purchase_price
      ) VALUES (
        v_tenant, v_item.article_id, v_site_id,
        COALESCE(NULLIF(v_batch, ''), 'LOT-' || to_char(now(), 'YYYYMMDDHH24MISS')),
        v_expiry, v_qty, v_qty, COALESCE(v_item.unit_price, 0)
      );
    END IF;

    v_any := v_any + v_qty;
  END LOOP;

  -- Mettre à jour quantity_received une seule fois par ligne (somme des répartitions)
  FOR r_item IN
    SELECT (a->>'item_id')::uuid AS item_id, SUM(COALESCE((a->>'quantity')::numeric, 0)) AS add_qty
    FROM jsonb_array_elements(p_allocations) a
    GROUP BY (a->>'item_id')::uuid
  LOOP
    IF r_item.add_qty > 0 THEN
      UPDATE supplier_order_items
        SET quantity_received = COALESCE(quantity_received, 0) + r_item.add_qty
        WHERE id = r_item.item_id AND order_id = p_order_id AND tenant_id = v_tenant;
    END IF;
  END LOOP;

  -- Statut : reçu si toutes les lignes sont complètes, sinon partiel
  SELECT bool_and(COALESCE(quantity_received, 0) >= COALESCE(quantity_ordered, 0))
    INTO v_all_received
    FROM supplier_order_items WHERE order_id = p_order_id AND tenant_id = v_tenant;

  IF v_all_received THEN
    v_new_status := 'received';
    UPDATE supplier_orders SET status = 'received', received_date = CURRENT_DATE WHERE id = p_order_id;
  ELSE
    v_new_status := 'partial';
    UPDATE supplier_orders SET status = 'partial' WHERE id = p_order_id;
  END IF;

  -- Trace d'idempotence
  IF p_idempotency_key IS NOT NULL AND p_idempotency_key <> '' THEN
    INSERT INTO supplier_order_receptions (tenant_id, order_id, idempotency_key, payload, created_by)
    VALUES (v_tenant, p_order_id, p_idempotency_key, p_allocations, auth.uid());
  END IF;

  RETURN jsonb_build_object(
    'already_processed', false,
    'order_id', p_order_id,
    'status', v_new_status,
    'received_qty', v_any
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.receive_supplier_order(uuid, jsonb, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.receive_supplier_order(uuid, jsonb, text) TO authenticated;
