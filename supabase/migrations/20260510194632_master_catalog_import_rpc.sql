/*
  # RPC d'import des articles depuis catalogue maître

  1. Fonction
    - `import_master_catalog_items_to_tenant(p_item_ids uuid[], p_category_id uuid, p_subcategory_id uuid, p_import_all boolean)`
    - Retourne un jsonb : { imported, skipped, errors, total }

  2. Règles
    - tenant_id = current_tenant_id()
    - N'importe que les articles du master_catalog lié au business_activity_type_id du tenant
    - Évite les doublons via master_catalog_item_id déjà lié, sinon via (tenant_id, internal_ref)
    - Crée les part_categories manquantes côté tenant (reprise du nom du master)
    - Copie : désignation, internal_ref, brand, model, unit, purchase_price, sale_price,
              vat_rate, barcode, description, image_url, manufacturer_ref
    - Transactionnel (fonction plpgsql = atomique)

  3. Sécurité
    - SECURITY DEFINER
    - Vérifie que l'utilisateur appartient à un tenant (current_tenant_id NOT NULL)
*/

CREATE OR REPLACE FUNCTION public.import_master_catalog_items_to_tenant(
  p_item_ids uuid[] DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_subcategory_id uuid DEFAULT NULL,
  p_import_all boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_activity_type_id uuid;
  v_catalog_id uuid;
  v_imported int := 0;
  v_skipped int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_item record;
  v_category_id_tenant uuid;
  v_internal_ref text;
  v_exists uuid;
  v_ref_seq int;
BEGIN
  v_tenant_id := public.current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Aucun tenant actif';
  END IF;

  SELECT business_activity_type_id INTO v_activity_type_id
  FROM public.tenants WHERE id = v_tenant_id;

  IF v_activity_type_id IS NULL THEN
    RAISE EXCEPTION 'Type d''activité non configuré pour ce tenant';
  END IF;

  SELECT id INTO v_catalog_id
  FROM public.master_catalogs
  WHERE business_activity_type_id = v_activity_type_id AND is_active = true
  ORDER BY created_at
  LIMIT 1;

  IF v_catalog_id IS NULL THEN
    RAISE EXCEPTION 'Aucun catalogue maître actif pour ce type d''activité';
  END IF;

  FOR v_item IN
    SELECT mi.*, mcat.name AS category_name, mscat.name AS subcategory_name
    FROM public.master_catalog_items mi
    LEFT JOIN public.master_catalog_categories mcat ON mcat.id = mi.category_id
    LEFT JOIN public.master_catalog_categories mscat ON mscat.id = mi.subcategory_id
    WHERE mi.master_catalog_id = v_catalog_id
      AND mi.is_active = true
      AND (
        p_import_all = true
        OR (p_item_ids IS NOT NULL AND mi.id = ANY(p_item_ids))
        OR (p_category_id IS NOT NULL AND mi.category_id = p_category_id)
        OR (p_subcategory_id IS NOT NULL AND mi.subcategory_id = p_subcategory_id)
      )
  LOOP
    BEGIN
      -- Déjà importé via master_catalog_item_id ?
      SELECT id INTO v_exists FROM public.articles
      WHERE tenant_id = v_tenant_id AND master_catalog_item_id = v_item.id
      LIMIT 1;

      IF v_exists IS NOT NULL THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      -- Catégorie : créer côté tenant si absente (on utilise la sous-cat si présente, sinon cat)
      v_category_id_tenant := NULL;
      IF v_item.subcategory_name IS NOT NULL THEN
        SELECT id INTO v_category_id_tenant FROM public.part_categories
        WHERE tenant_id = v_tenant_id AND lower(name) = lower(v_item.subcategory_name)
        LIMIT 1;
        IF v_category_id_tenant IS NULL THEN
          INSERT INTO public.part_categories (tenant_id, name, is_active)
          VALUES (v_tenant_id, v_item.subcategory_name, true)
          RETURNING id INTO v_category_id_tenant;
        END IF;
      ELSIF v_item.category_name IS NOT NULL THEN
        SELECT id INTO v_category_id_tenant FROM public.part_categories
        WHERE tenant_id = v_tenant_id AND lower(name) = lower(v_item.category_name)
        LIMIT 1;
        IF v_category_id_tenant IS NULL THEN
          INSERT INTO public.part_categories (tenant_id, name, is_active)
          VALUES (v_tenant_id, v_item.category_name, true)
          RETURNING id INTO v_category_id_tenant;
        END IF;
      END IF;

      -- internal_ref : on utilise manufacturer_ref si dispo, sinon un slug généré
      v_internal_ref := NULLIF(trim(v_item.manufacturer_ref), '');
      IF v_internal_ref IS NULL THEN
        v_internal_ref := upper(regexp_replace(substr(v_item.designation, 1, 12), '[^A-Za-z0-9]+', '', 'g'))
                          || '-' || substr(v_item.id::text, 1, 6);
      END IF;

      -- Empêcher collision avec internal_ref existante pour ce tenant
      SELECT id INTO v_exists FROM public.articles
      WHERE tenant_id = v_tenant_id AND lower(internal_ref) = lower(v_internal_ref)
      LIMIT 1;

      IF v_exists IS NOT NULL THEN
        -- L'article existe déjà avec cette référence : on lie au master et on passe
        UPDATE public.articles
        SET master_catalog_item_id = v_item.id
        WHERE id = v_exists AND master_catalog_item_id IS NULL;
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      INSERT INTO public.articles (
        tenant_id, internal_ref, name, description, category_id,
        brand, oem_ref, manufacturer_ref, model, barcode, unit,
        purchase_price, sale_price, vat_rate, image_url,
        master_catalog_item_id, business_activity_type_id, is_active
      ) VALUES (
        v_tenant_id,
        v_internal_ref,
        v_item.designation,
        COALESCE(v_item.description, ''),
        v_category_id_tenant,
        COALESCE(v_item.brand, ''),
        COALESCE(v_item.manufacturer_ref, ''),
        COALESCE(v_item.manufacturer_ref, ''),
        COALESCE(v_item.model, ''),
        COALESCE(v_item.barcode, ''),
        COALESCE(v_item.unit, 'pièce'),
        COALESCE(v_item.purchase_price, 0),
        COALESCE(v_item.sale_price, 0),
        COALESCE(v_item.vat_rate, 0),
        COALESCE(v_item.image_url, ''),
        v_item.id,
        v_activity_type_id,
        true
      );

      v_imported := v_imported + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'item_id', v_item.id,
        'designation', v_item.designation,
        'error', SQLERRM
      );
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'imported', v_imported,
    'skipped', v_skipped,
    'total', v_imported + v_skipped,
    'errors', v_errors
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.import_master_catalog_items_to_tenant(uuid[], uuid, uuid, boolean) TO authenticated;

-- ─── RPC admin pour import en masse via CSV parsé côté client ──────────────
-- On reçoit un jsonb array de lignes déjà validé côté client ; la fonction
-- détecte le catalogue par slug d'activité + fait des UPSERT.
CREATE OR REPLACE FUNCTION public.bulk_upsert_master_catalog_items(
  p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
  v_activity_slug text;
  v_catalog_name text;
  v_catalog_id uuid;
  v_activity_id uuid;
  v_cat_name text;
  v_subcat_name text;
  v_cat_id uuid;
  v_subcat_id uuid;
  v_brand text;
  v_ref text;
  v_existing_id uuid;
  v_imported int := 0;
  v_updated int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_row_index int := 0;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Réservé aux administrateurs plateforme';
  END IF;

  FOR v_row IN SELECT jsonb_array_elements(p_rows)
  LOOP
    v_row_index := v_row_index + 1;
    BEGIN
      v_activity_slug := NULLIF(trim(v_row->>'type_activite'), '');
      v_catalog_name := NULLIF(trim(v_row->>'catalogue'), '');
      v_cat_name := NULLIF(trim(v_row->>'categorie'), '');
      v_subcat_name := NULLIF(trim(v_row->>'sous_categorie'), '');
      v_brand := COALESCE(NULLIF(trim(v_row->>'marque'), ''), '');
      v_ref := COALESCE(NULLIF(trim(v_row->>'reference_constructeur'), ''), '');

      IF v_activity_slug IS NULL OR v_row->>'designation' IS NULL THEN
        v_errors := v_errors || jsonb_build_object('row', v_row_index, 'error', 'type_activite et designation requis');
        CONTINUE;
      END IF;

      SELECT id INTO v_activity_id FROM public.business_activity_types
      WHERE lower(slug) = lower(v_activity_slug) OR lower(name) = lower(v_activity_slug)
      LIMIT 1;

      IF v_activity_id IS NULL THEN
        v_errors := v_errors || jsonb_build_object('row', v_row_index, 'error', 'type_activite inconnu: ' || v_activity_slug);
        CONTINUE;
      END IF;

      -- Catalogue : par nom si fourni, sinon premier actif du type
      IF v_catalog_name IS NOT NULL THEN
        SELECT id INTO v_catalog_id FROM public.master_catalogs
        WHERE business_activity_type_id = v_activity_id AND lower(name) = lower(v_catalog_name)
        LIMIT 1;
        IF v_catalog_id IS NULL THEN
          INSERT INTO public.master_catalogs (business_activity_type_id, name)
          VALUES (v_activity_id, v_catalog_name)
          RETURNING id INTO v_catalog_id;
        END IF;
      ELSE
        SELECT id INTO v_catalog_id FROM public.master_catalogs
        WHERE business_activity_type_id = v_activity_id AND is_active = true
        ORDER BY created_at LIMIT 1;
      END IF;

      IF v_catalog_id IS NULL THEN
        v_errors := v_errors || jsonb_build_object('row', v_row_index, 'error', 'Aucun catalogue pour ce type');
        CONTINUE;
      END IF;

      -- Catégorie
      v_cat_id := NULL;
      IF v_cat_name IS NOT NULL THEN
        SELECT id INTO v_cat_id FROM public.master_catalog_categories
        WHERE master_catalog_id = v_catalog_id AND parent_id IS NULL AND lower(name) = lower(v_cat_name)
        LIMIT 1;
        IF v_cat_id IS NULL THEN
          INSERT INTO public.master_catalog_categories (master_catalog_id, name, slug, parent_id)
          VALUES (v_catalog_id, v_cat_name, lower(regexp_replace(v_cat_name, '[^A-Za-z0-9]+', '-', 'g')), NULL)
          RETURNING id INTO v_cat_id;
        END IF;
      END IF;

      -- Sous-catégorie
      v_subcat_id := NULL;
      IF v_subcat_name IS NOT NULL AND v_cat_id IS NOT NULL THEN
        SELECT id INTO v_subcat_id FROM public.master_catalog_categories
        WHERE master_catalog_id = v_catalog_id AND parent_id = v_cat_id AND lower(name) = lower(v_subcat_name)
        LIMIT 1;
        IF v_subcat_id IS NULL THEN
          INSERT INTO public.master_catalog_categories (master_catalog_id, name, slug, parent_id)
          VALUES (v_catalog_id, v_subcat_name, lower(regexp_replace(v_subcat_name, '[^A-Za-z0-9]+', '-', 'g')), v_cat_id)
          RETURNING id INTO v_subcat_id;
        END IF;
      END IF;

      -- Upsert article : détection par (catalogue, brand, manufacturer_ref)
      v_existing_id := NULL;
      IF v_ref <> '' THEN
        SELECT id INTO v_existing_id FROM public.master_catalog_items
        WHERE master_catalog_id = v_catalog_id
          AND lower(brand) = lower(v_brand)
          AND lower(manufacturer_ref) = lower(v_ref)
        LIMIT 1;
      END IF;

      IF v_existing_id IS NOT NULL THEN
        UPDATE public.master_catalog_items SET
          category_id = COALESCE(v_cat_id, category_id),
          subcategory_id = COALESCE(v_subcat_id, subcategory_id),
          designation = v_row->>'designation',
          model = COALESCE(v_row->>'modele', model),
          unit = COALESCE(NULLIF(trim(v_row->>'unite'), ''), unit),
          purchase_price = COALESCE((v_row->>'prix_achat')::numeric, purchase_price),
          sale_price = COALESCE((v_row->>'prix_vente')::numeric, sale_price),
          vat_rate = COALESCE((v_row->>'taux_tva')::numeric, vat_rate),
          barcode = COALESCE(v_row->>'code_barres', barcode),
          description = COALESCE(v_row->>'description', description),
          image_url = COALESCE(v_row->>'image_url', image_url),
          source_url = COALESCE(v_row->>'source_url', source_url),
          source_name = COALESCE(v_row->>'source_nom', source_name),
          reliability_level = COALESCE(v_row->>'niveau_fiabilite', reliability_level)
        WHERE id = v_existing_id;
        v_updated := v_updated + 1;
      ELSE
        INSERT INTO public.master_catalog_items (
          master_catalog_id, category_id, subcategory_id, manufacturer_ref,
          designation, brand, model, unit, purchase_price, sale_price, vat_rate,
          barcode, description, image_url, source_url, source_name, reliability_level
        ) VALUES (
          v_catalog_id, v_cat_id, v_subcat_id, v_ref,
          v_row->>'designation', v_brand, COALESCE(v_row->>'modele', ''),
          COALESCE(NULLIF(trim(v_row->>'unite'), ''), 'pièce'),
          COALESCE((v_row->>'prix_achat')::numeric, 0),
          COALESCE((v_row->>'prix_vente')::numeric, 0),
          COALESCE((v_row->>'taux_tva')::numeric, 0),
          COALESCE(v_row->>'code_barres', ''),
          COALESCE(v_row->>'description', ''),
          COALESCE(v_row->>'image_url', ''),
          COALESCE(v_row->>'source_url', ''),
          COALESCE(v_row->>'source_nom', ''),
          COALESCE(v_row->>'niveau_fiabilite', '')
        );
        v_imported := v_imported + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('row', v_row_index, 'error', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'imported', v_imported,
    'updated', v_updated,
    'errors', v_errors,
    'total', v_imported + v_updated
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_upsert_master_catalog_items(jsonb) TO authenticated;
