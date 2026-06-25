-- 1) Drop the old unique constraint that prevents same internal_ref across different sites
ALTER TABLE articles DROP CONSTRAINT IF EXISTS articles_tenant_id_internal_ref_key;

-- 2) Create partial unique index for SHARED catalog mode (site_id IS NULL)
--    Ensures global uniqueness within a tenant when articles are shared
CREATE UNIQUE INDEX articles_unique_ref_shared
  ON articles (tenant_id, lower(internal_ref))
  WHERE site_id IS NULL AND is_active = true;

-- 3) Create partial unique index for INDEPENDENT catalog mode (site_id IS NOT NULL)
--    Ensures uniqueness within a tenant + site combination
CREATE UNIQUE INDEX articles_unique_ref_per_site
  ON articles (tenant_id, site_id, lower(internal_ref))
  WHERE site_id IS NOT NULL AND is_active = true;

-- 4) Recreate the bulk_import_tenant_articles function to properly handle soft-deleted articles
CREATE OR REPLACE FUNCTION bulk_import_tenant_articles(p_rows jsonb, p_site_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_site_id   uuid;
  v_row jsonb;
  v_imported int := 0;
  v_updated int := 0;
  v_reactivated int := 0;
  v_errors jsonb[] := '{}';
  v_idx int := 0;
  v_name text;
  v_ref text;
  v_cat_id uuid;
  v_existing_id uuid;
  v_inactive_id uuid;
  v_new_id uuid;
  v_stock_init numeric;
  v_shared_articles boolean;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('imported', 0, 'updated', 0, 'reactivated', 0, 'errors', jsonb_build_array(jsonb_build_object('row', 0, 'error', 'Tenant non identifié')), 'total', 0);
  END IF;

  -- Determine catalog mode
  SELECT COALESCE((settings->>'shared_articles')::boolean, true)
  INTO v_shared_articles
  FROM tenants WHERE id = v_tenant_id;

  -- Resolve target site
  IF p_site_id IS NOT NULL THEN
    SELECT id INTO v_site_id FROM sites WHERE id = p_site_id AND tenant_id = v_tenant_id LIMIT 1;
    IF v_site_id IS NULL THEN
      RETURN jsonb_build_object('imported', 0, 'updated', 0, 'reactivated', 0, 'errors', jsonb_build_array(jsonb_build_object('row', 0, 'error', 'Emplacement invalide')), 'total', 0);
    END IF;
  ELSE
    IF NOT v_shared_articles THEN
      RETURN jsonb_build_object('imported', 0, 'updated', 0, 'reactivated', 0, 'errors', jsonb_build_array(jsonb_build_object('row', 0, 'error', 'En mode catalogue indépendant, un magasin cible est obligatoire')), 'total', 0);
    END IF;
    SELECT id INTO v_site_id FROM sites WHERE tenant_id = v_tenant_id LIMIT 1;
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_idx := v_idx + 1;
    BEGIN
      v_name := COALESCE(NULLIF(TRIM(v_row->>'designation'), ''), NULLIF(TRIM(v_row->>'nom'), ''));
      IF v_name IS NULL OR v_name = '' THEN
        v_errors := array_append(v_errors, jsonb_build_object('row', v_idx, 'error', 'Désignation manquante'));
        CONTINUE;
      END IF;

      v_ref := COALESCE(NULLIF(TRIM(v_row->>'reference_interne'), ''), NULLIF(TRIM(v_row->>'ref'), ''), '');

      IF v_ref = '' THEN
        v_ref := 'ART-' || LPAD((v_idx + (SELECT COUNT(*) FROM articles WHERE tenant_id = v_tenant_id))::text, 5, '0');
      END IF;

      -- Resolve category
      v_cat_id := NULL;
      IF COALESCE(TRIM(v_row->>'categorie'), '') != '' THEN
        SELECT id INTO v_cat_id
        FROM part_categories
        WHERE tenant_id = v_tenant_id
          AND lower(name) = lower(TRIM(v_row->>'categorie'))
          AND is_active = true
        LIMIT 1;

        IF v_cat_id IS NULL THEN
          INSERT INTO part_categories (tenant_id, name, code, is_active)
          VALUES (v_tenant_id, TRIM(v_row->>'categorie'), upper(left(regexp_replace(TRIM(v_row->>'categorie'), '[^a-zA-Z]', '', 'g'), 3)), true)
          RETURNING id INTO v_cat_id;
        END IF;
      END IF;

      -- Duplicate detection: only consider ACTIVE articles
      v_existing_id := NULL;
      v_inactive_id := NULL;

      IF v_shared_articles THEN
        -- Shared catalog: match by tenant + ref among active articles
        SELECT id INTO v_existing_id
        FROM articles
        WHERE tenant_id = v_tenant_id AND lower(internal_ref) = lower(v_ref) AND is_active = true
        LIMIT 1;

        -- Check for soft-deleted article with same ref (to reactivate)
        IF v_existing_id IS NULL THEN
          SELECT id INTO v_inactive_id
          FROM articles
          WHERE tenant_id = v_tenant_id AND lower(internal_ref) = lower(v_ref) AND is_active = false
          LIMIT 1;
        END IF;
      ELSE
        -- Independent catalog: match by tenant + ref + site_id among active articles
        SELECT id INTO v_existing_id
        FROM articles
        WHERE tenant_id = v_tenant_id AND lower(internal_ref) = lower(v_ref) AND site_id = v_site_id AND is_active = true
        LIMIT 1;

        -- Check for soft-deleted article with same ref and site (to reactivate)
        IF v_existing_id IS NULL THEN
          SELECT id INTO v_inactive_id
          FROM articles
          WHERE tenant_id = v_tenant_id AND lower(internal_ref) = lower(v_ref) AND site_id = v_site_id AND is_active = false
          LIMIT 1;
        END IF;

        -- Also check for orphaned articles with NULL site_id
        IF v_existing_id IS NULL AND v_inactive_id IS NULL THEN
          SELECT id INTO v_existing_id
          FROM articles
          WHERE tenant_id = v_tenant_id AND lower(internal_ref) = lower(v_ref) AND site_id IS NULL AND is_active = true
          LIMIT 1;
          IF v_existing_id IS NOT NULL THEN
            UPDATE articles SET site_id = v_site_id WHERE id = v_existing_id;
          ELSE
            -- Check orphaned inactive
            SELECT id INTO v_inactive_id
            FROM articles
            WHERE tenant_id = v_tenant_id AND lower(internal_ref) = lower(v_ref) AND site_id IS NULL AND is_active = false
            LIMIT 1;
            IF v_inactive_id IS NOT NULL THEN
              UPDATE articles SET site_id = v_site_id WHERE id = v_inactive_id;
            END IF;
          END IF;
        END IF;
      END IF;

      -- Case 1: Active article exists -> UPDATE it
      IF v_existing_id IS NOT NULL THEN
        UPDATE articles SET
          name = v_name,
          category_id = COALESCE(v_cat_id, category_id),
          brand = COALESCE(NULLIF(TRIM(v_row->>'marque'), ''), brand),
          oem_ref = COALESCE(NULLIF(TRIM(v_row->>'ref_oem'), ''), oem_ref),
          supplier_ref = COALESCE(NULLIF(TRIM(v_row->>'ref_fournisseur'), ''), supplier_ref),
          barcode = COALESCE(NULLIF(TRIM(v_row->>'code_barres'), ''), barcode),
          unit = COALESCE(NULLIF(TRIM(v_row->>'unite'), ''), unit),
          purchase_price = CASE WHEN (v_row->>'prix_achat') IS NOT NULL AND (v_row->>'prix_achat') != '' THEN (v_row->>'prix_achat')::numeric ELSE purchase_price END,
          sale_price = CASE WHEN (v_row->>'prix_vente') IS NOT NULL AND (v_row->>'prix_vente') != '' THEN (v_row->>'prix_vente')::numeric ELSE sale_price END,
          min_price = CASE WHEN (v_row->>'prix_minimum') IS NOT NULL AND (v_row->>'prix_minimum') != '' THEN (v_row->>'prix_minimum')::numeric ELSE min_price END,
          wholesale_price = CASE WHEN (v_row->>'prix_gros') IS NOT NULL AND (v_row->>'prix_gros') != '' THEN (v_row->>'prix_gros')::numeric ELSE wholesale_price END,
          vat_rate = CASE WHEN (v_row->>'taux_tva') IS NOT NULL AND (v_row->>'taux_tva') != '' THEN (v_row->>'taux_tva')::numeric ELSE vat_rate END,
          stock_min = CASE WHEN (v_row->>'stock_min') IS NOT NULL AND (v_row->>'stock_min') != '' THEN (v_row->>'stock_min')::numeric ELSE stock_min END,
          stock_max = CASE WHEN (v_row->>'stock_max') IS NOT NULL AND (v_row->>'stock_max') != '' THEN (v_row->>'stock_max')::numeric ELSE stock_max END,
          location = COALESCE(NULLIF(TRIM(v_row->>'emplacement'), ''), location),
          description = COALESCE(NULLIF(TRIM(v_row->>'description'), ''), description)
        WHERE id = v_existing_id;
        v_updated := v_updated + 1;

        -- Apply stock
        v_stock_init := COALESCE(NULLIF(TRIM(v_row->>'stock_initial'), '')::numeric, 0);
        IF v_stock_init > 0 AND v_site_id IS NOT NULL THEN
          INSERT INTO stock_movements (tenant_id, article_id, site_id, quantity, movement_type, note)
          VALUES (v_tenant_id, v_existing_id, v_site_id, v_stock_init, 'adjustment_in', 'Stock ajout (import)');
          INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity)
          VALUES (v_tenant_id, v_existing_id, v_site_id, v_stock_init)
          ON CONFLICT (article_id, site_id)
          DO UPDATE SET quantity = stock_levels.quantity + v_stock_init;
        END IF;

      -- Case 2: Inactive (soft-deleted) article found -> REACTIVATE it
      ELSIF v_inactive_id IS NOT NULL THEN
        UPDATE articles SET
          is_active = true,
          name = v_name,
          category_id = COALESCE(v_cat_id, category_id),
          brand = COALESCE(NULLIF(TRIM(v_row->>'marque'), ''), brand),
          oem_ref = COALESCE(NULLIF(TRIM(v_row->>'ref_oem'), ''), oem_ref),
          supplier_ref = COALESCE(NULLIF(TRIM(v_row->>'ref_fournisseur'), ''), supplier_ref),
          barcode = COALESCE(NULLIF(TRIM(v_row->>'code_barres'), ''), barcode),
          unit = COALESCE(NULLIF(TRIM(v_row->>'unite'), ''), unit),
          purchase_price = CASE WHEN (v_row->>'prix_achat') IS NOT NULL AND (v_row->>'prix_achat') != '' THEN (v_row->>'prix_achat')::numeric ELSE purchase_price END,
          sale_price = CASE WHEN (v_row->>'prix_vente') IS NOT NULL AND (v_row->>'prix_vente') != '' THEN (v_row->>'prix_vente')::numeric ELSE sale_price END,
          min_price = CASE WHEN (v_row->>'prix_minimum') IS NOT NULL AND (v_row->>'prix_minimum') != '' THEN (v_row->>'prix_minimum')::numeric ELSE min_price END,
          wholesale_price = CASE WHEN (v_row->>'prix_gros') IS NOT NULL AND (v_row->>'prix_gros') != '' THEN (v_row->>'prix_gros')::numeric ELSE wholesale_price END,
          vat_rate = CASE WHEN (v_row->>'taux_tva') IS NOT NULL AND (v_row->>'taux_tva') != '' THEN (v_row->>'taux_tva')::numeric ELSE vat_rate END,
          stock_min = CASE WHEN (v_row->>'stock_min') IS NOT NULL AND (v_row->>'stock_min') != '' THEN (v_row->>'stock_min')::numeric ELSE stock_min END,
          stock_max = CASE WHEN (v_row->>'stock_max') IS NOT NULL AND (v_row->>'stock_max') != '' THEN (v_row->>'stock_max')::numeric ELSE stock_max END,
          location = COALESCE(NULLIF(TRIM(v_row->>'emplacement'), ''), location),
          description = COALESCE(NULLIF(TRIM(v_row->>'description'), ''), description)
        WHERE id = v_inactive_id;
        v_reactivated := v_reactivated + 1;

        -- Apply stock
        v_stock_init := COALESCE(NULLIF(TRIM(v_row->>'stock_initial'), '')::numeric, 0);
        IF v_stock_init > 0 AND v_site_id IS NOT NULL THEN
          INSERT INTO stock_movements (tenant_id, article_id, site_id, quantity, movement_type, note)
          VALUES (v_tenant_id, v_inactive_id, v_site_id, v_stock_init, 'adjustment_in', 'Stock réactivation (import)');
          INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity)
          VALUES (v_tenant_id, v_inactive_id, v_site_id, v_stock_init)
          ON CONFLICT (article_id, site_id)
          DO UPDATE SET quantity = stock_levels.quantity + v_stock_init;
        END IF;

      -- Case 3: No existing article -> INSERT new
      ELSE
        INSERT INTO articles (
          tenant_id, site_id, internal_ref, name, category_id, brand,
          oem_ref, supplier_ref, barcode, unit,
          purchase_price, sale_price, min_price, wholesale_price,
          vat_rate, stock_min, stock_max, location, description, is_active
        ) VALUES (
          v_tenant_id,
          CASE WHEN NOT v_shared_articles THEN v_site_id ELSE NULL END,
          v_ref, v_name, v_cat_id,
          COALESCE(TRIM(v_row->>'marque'), ''),
          COALESCE(TRIM(v_row->>'ref_oem'), ''),
          COALESCE(TRIM(v_row->>'ref_fournisseur'), ''),
          COALESCE(TRIM(v_row->>'code_barres'), ''),
          COALESCE(NULLIF(TRIM(v_row->>'unite'), ''), 'pièce'),
          COALESCE(NULLIF(v_row->>'prix_achat', '')::numeric, 0),
          COALESCE(NULLIF(v_row->>'prix_vente', '')::numeric, 0),
          COALESCE(NULLIF(v_row->>'prix_minimum', '')::numeric, 0),
          COALESCE(NULLIF(v_row->>'prix_gros', '')::numeric, 0),
          COALESCE(NULLIF(v_row->>'taux_tva', '')::numeric, 0),
          COALESCE(NULLIF(v_row->>'stock_min', '')::numeric, 0),
          COALESCE(NULLIF(v_row->>'stock_max', '')::numeric, 0),
          COALESCE(TRIM(v_row->>'emplacement'), ''),
          COALESCE(TRIM(v_row->>'description'), ''),
          true
        )
        RETURNING id INTO v_new_id;

        -- Apply initial stock
        v_stock_init := COALESCE(NULLIF(TRIM(v_row->>'stock_initial'), '')::numeric, 0);
        IF v_stock_init > 0 AND v_site_id IS NOT NULL AND v_new_id IS NOT NULL THEN
          INSERT INTO stock_movements (tenant_id, article_id, site_id, quantity, movement_type, note)
          VALUES (v_tenant_id, v_new_id, v_site_id, v_stock_init, 'initial', 'Stock initial (import)');
          INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity)
          VALUES (v_tenant_id, v_new_id, v_site_id, v_stock_init)
          ON CONFLICT (article_id, site_id)
          DO UPDATE SET quantity = stock_levels.quantity + v_stock_init;
        END IF;

        v_imported := v_imported + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_errors := array_append(v_errors, jsonb_build_object('row', v_idx, 'error', SQLERRM));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'imported', v_imported,
    'updated', v_updated,
    'reactivated', v_reactivated,
    'errors', to_jsonb(v_errors),
    'total', v_idx
  );
END;
$$;