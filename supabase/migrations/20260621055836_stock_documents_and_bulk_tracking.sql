-- =====================================================================
-- Stock documents: header for bulk stock operations (entree/sortie/transfer/inventaire)
-- =====================================================================
CREATE TABLE IF NOT EXISTS stock_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  doc_number text NOT NULL,
  doc_type text NOT NULL CHECK (doc_type IN ('entry', 'exit', 'transfer', 'inventory')),
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  dest_site_id uuid REFERENCES sites(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note text DEFAULT '',
  status text DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'edited')),
  total_qty numeric DEFAULT 0,
  line_count int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stockdoc_tenant ON stock_documents(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stockdoc_site ON stock_documents(site_id);
CREATE INDEX IF NOT EXISTS idx_stockdoc_type ON stock_documents(tenant_id, doc_type, created_at DESC);

ALTER TABLE stock_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stkdoc select" ON stock_documents
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id());

CREATE POLICY "stkdoc insert" ON stock_documents
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY "stkdoc update" ON stock_documents
  FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY "stkdoc delete" ON stock_documents
  FOR DELETE TO authenticated
  USING (tenant_id = current_tenant_id());

-- Link column on stock_movements
ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS stock_document_id uuid REFERENCES stock_documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stmov_stock_document ON stock_movements(stock_document_id);

-- Allow client-side update/delete (needed for edit/regen flows). Already restricted by tenant_id.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='stock_movements' AND policyname='stmov update') THEN
    CREATE POLICY "stmov update" ON stock_movements
      FOR UPDATE TO authenticated
      USING (tenant_id = current_tenant_id())
      WITH CHECK (tenant_id = current_tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='stock_movements' AND policyname='stmov delete') THEN
    CREATE POLICY "stmov delete" ON stock_movements
      FOR DELETE TO authenticated
      USING (tenant_id = current_tenant_id());
  END IF;
END $$;

-- =====================================================================
-- adjust_stock_with_doc: like adjust_stock but binds the movement to a stock_document
-- =====================================================================
CREATE OR REPLACE FUNCTION public.adjust_stock_with_doc(
  p_article_id uuid,
  p_site_id uuid,
  p_quantity numeric,
  p_movement_type text,
  p_note text,
  p_stock_document_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_previous numeric;
  v_new numeric;
  v_movement_id uuid;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Non authentifié'; END IF;

  SELECT quantity INTO v_previous FROM stock_levels
   WHERE article_id = p_article_id AND site_id = p_site_id;
  IF v_previous IS NULL THEN
    v_previous := 0;
    INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity)
    VALUES (v_tenant_id, p_article_id, p_site_id, 0);
  END IF;

  v_new := v_previous + p_quantity;
  UPDATE stock_levels SET quantity = v_new, updated_at = now()
   WHERE article_id = p_article_id AND site_id = p_site_id;

  INSERT INTO stock_movements (
    tenant_id, article_id, site_id, movement_type, quantity,
    previous_qty, new_qty, user_id, note, stock_document_id
  ) VALUES (
    v_tenant_id, p_article_id, p_site_id, p_movement_type, p_quantity,
    v_previous, v_new, auth.uid(), COALESCE(p_note,''), p_stock_document_id
  )
  RETURNING id INTO v_movement_id;

  RETURN v_movement_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_stock_with_doc(uuid, uuid, numeric, text, text, uuid) TO authenticated;

-- =====================================================================
-- reverse_stock_document: reverses every movement linked to a stock_document
-- and deletes the movements (used for edit-regenerate flow)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.reverse_stock_document(p_document_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_movement record;
  v_previous numeric;
  v_new numeric;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Non authentifié'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM stock_documents
     WHERE id = p_document_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Document non trouvé';
  END IF;

  FOR v_movement IN
    SELECT * FROM stock_movements
     WHERE stock_document_id = p_document_id AND tenant_id = v_tenant_id
  LOOP
    SELECT quantity INTO v_previous FROM stock_levels
     WHERE article_id = v_movement.article_id AND site_id = v_movement.site_id;
    IF v_previous IS NULL THEN v_previous := 0; END IF;
    v_new := v_previous - v_movement.quantity;
    UPDATE stock_levels SET quantity = v_new, updated_at = now()
     WHERE article_id = v_movement.article_id AND site_id = v_movement.site_id;
    DELETE FROM stock_movements WHERE id = v_movement.id;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reverse_stock_document(uuid) TO authenticated;