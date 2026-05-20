/*
  # Provisioning tenant

  Fonction RPC qui provisionne un nouveau tenant avec:
  - entreprise
  - profile admin
  - site principal
  - catégories par défaut
  - marques véhicules par défaut
  - modes de règlement par défaut
  - plan comptable SYSCOHADA de base
*/

CREATE OR REPLACE FUNCTION provision_tenant(
  p_company_name text,
  p_user_full_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_site_id uuid;
  v_user_id uuid;
  v_user_email text;
  v_moteur_id uuid;
  v_freinage_id uuid;
  v_filtration_id uuid;
  v_elec_id uuid;
  v_suspension_id uuid;
  v_carrosserie_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Non authentifié';
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;

  -- Déjà un tenant ?
  SELECT tenant_id INTO v_tenant_id FROM profiles WHERE id = v_user_id;
  IF v_tenant_id IS NOT NULL THEN
    RETURN v_tenant_id;
  END IF;

  -- Tenant
  INSERT INTO tenants (name, email) VALUES (p_company_name, v_user_email)
  RETURNING id INTO v_tenant_id;

  -- Profile
  INSERT INTO profiles (id, tenant_id, full_name, email, role)
  VALUES (v_user_id, v_tenant_id, p_user_full_name, v_user_email, 'admin')
  ON CONFLICT (id) DO UPDATE SET tenant_id = v_tenant_id, full_name = p_user_full_name;

  -- Site principal
  INSERT INTO sites (tenant_id, name, code, is_warehouse)
  VALUES (v_tenant_id, 'Magasin Principal', 'MAIN', true)
  RETURNING id INTO v_site_id;

  -- Marques véhicules par défaut
  INSERT INTO vehicle_brands (tenant_id, name) VALUES
    (v_tenant_id, 'Toyota'), (v_tenant_id, 'Nissan'), (v_tenant_id, 'Hyundai'),
    (v_tenant_id, 'Kia'), (v_tenant_id, 'Renault'), (v_tenant_id, 'Peugeot'),
    (v_tenant_id, 'Citroën'), (v_tenant_id, 'Mercedes-Benz'), (v_tenant_id, 'BMW'),
    (v_tenant_id, 'Audi'), (v_tenant_id, 'Volkswagen'), (v_tenant_id, 'Ford'),
    (v_tenant_id, 'Mitsubishi'), (v_tenant_id, 'Mazda'), (v_tenant_id, 'Honda'),
    (v_tenant_id, 'Suzuki'), (v_tenant_id, 'Isuzu'), (v_tenant_id, 'Chevrolet'),
    (v_tenant_id, 'Dacia'), (v_tenant_id, 'Land Rover');

  -- Catégories principales
  INSERT INTO part_categories (tenant_id, name, code) VALUES (v_tenant_id, 'Moteur', 'MOT') RETURNING id INTO v_moteur_id;
  INSERT INTO part_categories (tenant_id, name, code) VALUES (v_tenant_id, 'Freinage', 'FRE') RETURNING id INTO v_freinage_id;
  INSERT INTO part_categories (tenant_id, name, code) VALUES (v_tenant_id, 'Filtration', 'FIL') RETURNING id INTO v_filtration_id;
  INSERT INTO part_categories (tenant_id, name, code) VALUES (v_tenant_id, 'Électricité', 'ELE') RETURNING id INTO v_elec_id;
  INSERT INTO part_categories (tenant_id, name, code) VALUES (v_tenant_id, 'Suspension', 'SUS') RETURNING id INTO v_suspension_id;
  INSERT INTO part_categories (tenant_id, name, code) VALUES (v_tenant_id, 'Carrosserie', 'CAR') RETURNING id INTO v_carrosserie_id;

  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES
    (v_tenant_id, v_filtration_id, 'Filtre à huile', 'FIL-HUI'),
    (v_tenant_id, v_filtration_id, 'Filtre à air', 'FIL-AIR'),
    (v_tenant_id, v_filtration_id, 'Filtre à carburant', 'FIL-CAR'),
    (v_tenant_id, v_filtration_id, 'Filtre habitacle', 'FIL-HAB'),
    (v_tenant_id, v_freinage_id, 'Plaquettes', 'FRE-PLA'),
    (v_tenant_id, v_freinage_id, 'Disques', 'FRE-DIS'),
    (v_tenant_id, v_freinage_id, 'Étriers', 'FRE-ETR'),
    (v_tenant_id, v_moteur_id, 'Courroie distribution', 'MOT-DIS'),
    (v_tenant_id, v_moteur_id, 'Pompe à eau', 'MOT-POM'),
    (v_tenant_id, v_moteur_id, 'Bougies', 'MOT-BOU'),
    (v_tenant_id, v_elec_id, 'Batterie', 'ELE-BAT'),
    (v_tenant_id, v_elec_id, 'Alternateur', 'ELE-ALT'),
    (v_tenant_id, v_elec_id, 'Démarreur', 'ELE-DEM'),
    (v_tenant_id, v_suspension_id, 'Amortisseurs', 'SUS-AMO'),
    (v_tenant_id, v_suspension_id, 'Rotules', 'SUS-ROT');

  -- Modes de paiement
  INSERT INTO payment_methods (tenant_id, name, code, payment_type, account_code, sort_order) VALUES
    (v_tenant_id, 'Espèces', 'CASH', 'cash', '5710000', 1),
    (v_tenant_id, 'Wave', 'WAVE', 'mobile', '5211000', 2),
    (v_tenant_id, 'Orange Money', 'OM', 'mobile', '5212000', 3),
    (v_tenant_id, 'Free Money', 'FM', 'mobile', '5213000', 4),
    (v_tenant_id, 'Carte bancaire', 'CARD', 'card', '5210000', 5),
    (v_tenant_id, 'Virement', 'WIRE', 'bank', '5210000', 6),
    (v_tenant_id, 'Chèque', 'CHEQUE', 'check', '5210000', 7),
    (v_tenant_id, 'Crédit client', 'CREDIT', 'credit', '4110000', 8);

  -- Plan comptable SYSCOHADA de base (codes 7 caractères)
  INSERT INTO accounts (tenant_id, code, name, class) VALUES
    (v_tenant_id, '3110000', 'Marchandises', 3),
    (v_tenant_id, '4010000', 'Fournisseurs', 4),
    (v_tenant_id, '4110000', 'Clients', 4),
    (v_tenant_id, '4457000', 'TVA collectée', 4),
    (v_tenant_id, '4456000', 'TVA déductible', 4),
    (v_tenant_id, '5210000', 'Banque', 5),
    (v_tenant_id, '5710000', 'Caisse', 5),
    (v_tenant_id, '5211000', 'Wave', 5),
    (v_tenant_id, '5212000', 'Orange Money', 5),
    (v_tenant_id, '5213000', 'Free Money', 5),
    (v_tenant_id, '6010000', 'Achats de marchandises', 6),
    (v_tenant_id, '6580000', 'Charges diverses', 6),
    (v_tenant_id, '7010000', 'Ventes de marchandises', 7),
    (v_tenant_id, '7580000', 'Produits divers', 7);

  RETURN v_tenant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION provision_tenant TO authenticated;

-- ============================================================
-- Fonction de vente atomique: crée vente + items + paiements + mouvements stock
-- ============================================================
CREATE OR REPLACE FUNCTION create_pos_sale(
  p_site_id uuid,
  p_cash_session_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_discount numeric,
  p_note text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_user_id uuid;
  v_sale_id uuid;
  v_sale_number text;
  v_item jsonb;
  v_payment jsonb;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_previous numeric;
  v_new numeric;
  v_line_total numeric;
BEGIN
  v_user_id := auth.uid();
  v_tenant_id := current_tenant_id();

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant introuvable';
  END IF;

  -- Numéro vente
  v_sale_number := 'V-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6);

  -- Calcul subtotal
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_line_total := (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric - COALESCE((v_item->>'discount')::numeric, 0);
    v_subtotal := v_subtotal + v_line_total;
  END LOOP;

  v_total := v_subtotal - COALESCE(p_discount, 0);

  -- Total payé
  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    v_paid := v_paid + (v_payment->>'amount')::numeric;
  END LOOP;

  -- Création vente
  INSERT INTO sales (tenant_id, site_id, cash_session_id, customer_id, user_id, sale_number, subtotal, discount, total, paid, status, note)
  VALUES (v_tenant_id, p_site_id, p_cash_session_id, p_customer_id, v_user_id, v_sale_number, v_subtotal, COALESCE(p_discount,0), v_total, v_paid,
          CASE WHEN v_paid >= v_total THEN 'paid' ELSE 'partial' END, COALESCE(p_note, ''))
  RETURNING id INTO v_sale_id;

  -- Items + mouvements de stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_line_total := (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric - COALESCE((v_item->>'discount')::numeric, 0);

    INSERT INTO sale_items (tenant_id, sale_id, article_id, name, quantity, unit_price, discount, total, purchase_cost)
    VALUES (v_tenant_id, v_sale_id, (v_item->>'article_id')::uuid, v_item->>'name',
            (v_item->>'quantity')::numeric, (v_item->>'unit_price')::numeric,
            COALESCE((v_item->>'discount')::numeric, 0), v_line_total,
            COALESCE((v_item->>'purchase_cost')::numeric, 0));

    -- Stock
    SELECT quantity INTO v_previous FROM stock_levels
      WHERE article_id = (v_item->>'article_id')::uuid AND site_id = p_site_id;

    IF v_previous IS NULL THEN
      v_previous := 0;
      INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity)
        VALUES (v_tenant_id, (v_item->>'article_id')::uuid, p_site_id, 0);
    END IF;

    v_new := v_previous - (v_item->>'quantity')::numeric;

    UPDATE stock_levels SET quantity = v_new, updated_at = now()
      WHERE article_id = (v_item->>'article_id')::uuid AND site_id = p_site_id;

    INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, reference_type, reference_id, user_id, note)
    VALUES (v_tenant_id, (v_item->>'article_id')::uuid, p_site_id, 'sale',
            -(v_item->>'quantity')::numeric, v_previous, v_new, 'sale', v_sale_id, v_user_id, 'Vente ' || v_sale_number);
  END LOOP;

  -- Paiements
  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    INSERT INTO sale_payments (tenant_id, sale_id, payment_method_id, method_name, amount, reference)
    VALUES (v_tenant_id, v_sale_id,
            NULLIF(v_payment->>'payment_method_id','')::uuid,
            v_payment->>'method_name',
            (v_payment->>'amount')::numeric,
            COALESCE(v_payment->>'reference', ''));
  END LOOP;

  RETURN v_sale_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_pos_sale TO authenticated;

-- ============================================================
-- Fonction d'ajustement stock
-- ============================================================
CREATE OR REPLACE FUNCTION adjust_stock(
  p_article_id uuid,
  p_site_id uuid,
  p_quantity numeric,
  p_movement_type text,
  p_note text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_previous numeric;
  v_new numeric;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Non authentifié'; END IF;

  SELECT quantity INTO v_previous FROM stock_levels WHERE article_id = p_article_id AND site_id = p_site_id;
  IF v_previous IS NULL THEN
    v_previous := 0;
    INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, p_article_id, p_site_id, 0);
  END IF;

  v_new := v_previous + p_quantity;
  UPDATE stock_levels SET quantity = v_new, updated_at = now() WHERE article_id = p_article_id AND site_id = p_site_id;

  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note)
  VALUES (v_tenant_id, p_article_id, p_site_id, p_movement_type, p_quantity, v_previous, v_new, auth.uid(), COALESCE(p_note,''));
END;
$$;

GRANT EXECUTE ON FUNCTION adjust_stock TO authenticated;