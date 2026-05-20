/*
  # Bons de commande fournisseurs : code court partageable

  1. Problème
    - L'URL actuelle `/po/{public_token}` utilise un token de 64 caractères
      hexadécimaux, ce qui rend le lien long et difficile à partager
      (WhatsApp, SMS).

  2. Solution
    - Ajout d'une colonne `public_code` (text, UNIQUE) sur `supplier_orders`,
      générée aléatoirement sur 10 caractères en base36 (chiffres + lettres
      minuscules). Suffisant pour ~3.6e15 combinaisons : aucune collision
      réaliste dans le périmètre métier, et URL très courte type
      `/po/k7m2x9aq3p`.
    - Backfill des lignes existantes avec un nouveau code unique.
    - DEFAULT côté table pour les insertions futures (boucle de génération
      protégée contre une éventuelle collision).
    - La RPC `get_public_supplier_order(p_token)` accepte désormais à la
      fois le long token historique et le nouveau code court : les anciens
      liens partagés restent valides.

  3. Sécurité
    - SECURITY DEFINER inchangé, fonction toujours exposée à anon/authenticated.
    - Le code court est la capacité d'accès (URL non devinable) : pas
      d'ouverture supplémentaire de RLS sur les tables de base.
*/

-- 1. Fonction utilitaire : générer un code court base36 unique
CREATE OR REPLACE FUNCTION public._gen_supplier_order_public_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_alphabet text := 'abcdefghijklmnopqrstuvwxyz0123456789';
  v_code text;
  v_i int;
  v_attempts int := 0;
BEGIN
  LOOP
    v_code := '';
    FOR v_i IN 1..10 LOOP
      v_code := v_code || substr(
        v_alphabet,
        1 + floor(random() * length(v_alphabet))::int,
        1
      );
    END LOOP;

    PERFORM 1 FROM public.supplier_orders WHERE public_code = v_code LIMIT 1;
    IF NOT FOUND THEN
      RETURN v_code;
    END IF;

    v_attempts := v_attempts + 1;
    IF v_attempts > 50 THEN
      RAISE EXCEPTION 'Impossible de générer un code public unique';
    END IF;
  END LOOP;
END;
$$;

-- 2. Colonne public_code
ALTER TABLE public.supplier_orders
  ADD COLUMN IF NOT EXISTS public_code text;

-- Backfill des lignes existantes
DO $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN SELECT id FROM public.supplier_orders WHERE public_code IS NULL LOOP
    UPDATE public.supplier_orders
       SET public_code = public._gen_supplier_order_public_code()
     WHERE id = v_id;
  END LOOP;
END $$;

ALTER TABLE public.supplier_orders
  ALTER COLUMN public_code SET NOT NULL;

ALTER TABLE public.supplier_orders
  ALTER COLUMN public_code SET DEFAULT public._gen_supplier_order_public_code();

CREATE UNIQUE INDEX IF NOT EXISTS supplier_orders_public_code_key
  ON public.supplier_orders(public_code);

-- 3. RPC : accepte ancien token long ET nouveau code court
CREATE OR REPLACE FUNCTION public.get_public_supplier_order(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order  public.supplier_orders%ROWTYPE;
  v_items  jsonb;
  v_supp   jsonb;
  v_tenant jsonb;
BEGIN
  SELECT * INTO v_order
    FROM public.supplier_orders
   WHERE public_code = p_token OR public_token = p_token
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'name', i.name,
    'supplier_ref', i.supplier_ref,
    'quantity_ordered', i.quantity_ordered,
    'quantity_received', i.quantity_received,
    'unit_price', i.unit_price,
    'total', i.total
  ) ORDER BY i.name), '[]'::jsonb)
  INTO v_items
  FROM public.supplier_order_items i
  WHERE i.order_id = v_order.id;

  SELECT jsonb_build_object(
    'name', s.name,
    'phone', s.phone,
    'email', s.email,
    'address', s.address
  ) INTO v_supp
  FROM public.suppliers s
  WHERE s.id = v_order.supplier_id;

  SELECT jsonb_build_object(
    'name', t.name,
    'legal_name', t.legal_name,
    'ninea', t.ninea,
    'rccm', t.rccm,
    'address', t.address,
    'phone', t.phone,
    'email', t.email,
    'website', t.website,
    'logo_url', t.logo_url,
    'business_type', t.business_type
  ) INTO v_tenant
  FROM public.tenants t
  WHERE t.id = v_order.tenant_id;

  RETURN jsonb_build_object(
    'order', jsonb_build_object(
      'order_number', v_order.order_number,
      'created_at', v_order.created_at,
      'expected_date', v_order.expected_date,
      'status', v_order.status,
      'subtotal', v_order.subtotal,
      'discount', v_order.discount,
      'total', v_order.total,
      'note', v_order.note
    ),
    'supplier', v_supp,
    'tenant', v_tenant,
    'items', v_items
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_supplier_order(text) TO anon, authenticated;
