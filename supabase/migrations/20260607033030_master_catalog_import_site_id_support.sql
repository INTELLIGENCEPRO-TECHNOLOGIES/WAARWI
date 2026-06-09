-- Update import RPC to accept optional site_id for independent catalog mode
CREATE OR REPLACE FUNCTION public.import_master_catalog_items_to_tenant(
  p_item_ids uuid[] DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_subcategory_id uuid DEFAULT NULL,
  p_import_all boolean DEFAULT false,
  p_site_id uuid DEFAULT NULL
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
        AND (p_site_id IS NULL OR site_id IS NOT DISTINCT FROM p_site_id)
      LIMIT 1;

      IF v_exists IS NOT NULL THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      -- Catégorie : créer côté tenant si absente
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

      -- internal_ref
      v_internal_ref := NULLIF(trim(v_item.manufacturer_ref), '');
      IF v_internal_ref IS NULL THEN
        v_internal_ref := upper(regexp_replace(substr(v_item.designation, 1, 12), '[^A-Za-z0-9]+', '', 'g'))
                          || '-' || substr(v_item.id::text, 1, 6);
      END IF;

      -- Empêcher collision avec internal_ref existante
      SELECT id INTO v_exists FROM public.articles
      WHERE tenant_id = v_tenant_id AND lower(internal_ref) = lower(v_internal_ref)
        AND (p_site_id IS NULL OR site_id IS NOT DISTINCT FROM p_site_id)
      LIMIT 1;

      IF v_exists IS NOT NULL THEN
        UPDATE public.articles
        SET master_catalog_item_id = v_item.id
        WHERE id = v_exists AND master_catalog_item_id IS NULL;
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      INSERT INTO public.articles (
        tenant_id, site_id, internal_ref, name, description, category_id,
        brand, oem_ref, manufacturer_ref, model, barcode, unit,
        purchase_price, sale_price, vat_rate, image_url,
        master_catalog_item_id, business_activity_type_id, is_active
      ) VALUES (
        v_tenant_id,
        p_site_id,
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

-- Grant for new signature
GRANT EXECUTE ON FUNCTION public.import_master_catalog_items_to_tenant(uuid[], uuid, uuid, boolean, uuid) TO authenticated;