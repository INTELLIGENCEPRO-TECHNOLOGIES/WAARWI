
/*
  # Phase 1 — Fondations Boutique en Ligne AutoParts Pro

  ## Résumé
  - Colonne public_slug sur tenants
  - Bucket Storage article-images
  - Table shop_settings
  - Table online_orders
  - Table online_order_items
  - Table online_order_status_history
  - RLS partout, isolation tenant_id
  - Fonctions generate_tenant_slug, next_online_order_number
*/

-- 1. TENANTS : ajout public_slug
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'public_slug'
  ) THEN
    ALTER TABLE tenants ADD COLUMN public_slug text UNIQUE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tenants_public_slug ON tenants (public_slug);

-- 2. BUCKET article-images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'article-images',
  'article-images',
  true,
  5242880,
  ARRAY['image/jpeg','image/jpg','image/png','image/webp']
)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'article-images public read'
  ) THEN
    CREATE POLICY "article-images public read"
      ON storage.objects FOR SELECT TO public
      USING (bucket_id = 'article-images');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'article-images authenticated upload'
  ) THEN
    CREATE POLICY "article-images authenticated upload"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'article-images');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'article-images authenticated update'
  ) THEN
    CREATE POLICY "article-images authenticated update"
      ON storage.objects FOR UPDATE TO authenticated
      USING (bucket_id = 'article-images');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'article-images authenticated delete'
  ) THEN
    CREATE POLICY "article-images authenticated delete"
      ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = 'article-images');
  END IF;
END $$;

-- 3. TABLE shop_settings
CREATE TABLE IF NOT EXISTS shop_settings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  is_active      boolean NOT NULL DEFAULT false,
  shop_name      text NOT NULL DEFAULT '',
  tagline        text NOT NULL DEFAULT '',
  logo_url       text NOT NULL DEFAULT '',
  phone          text NOT NULL DEFAULT '',
  whatsapp       text NOT NULL DEFAULT '',
  address        text NOT NULL DEFAULT '',
  welcome_msg    text NOT NULL DEFAULT '',
  footer_text    text NOT NULL DEFAULT '',
  delivery_modes jsonb NOT NULL DEFAULT '["retrait","livraison"]'::jsonb,
  payment_modes  jsonb NOT NULL DEFAULT '["livraison","retrait"]'::jsonb,
  primary_color  text NOT NULL DEFAULT '#0f766e',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

ALTER TABLE shop_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='shop_settings' AND policyname='shop_settings tenant select') THEN
    CREATE POLICY "shop_settings tenant select"
      ON shop_settings FOR SELECT TO authenticated
      USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='shop_settings' AND policyname='shop_settings tenant insert') THEN
    CREATE POLICY "shop_settings tenant insert"
      ON shop_settings FOR INSERT TO authenticated
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='shop_settings' AND policyname='shop_settings tenant update') THEN
    CREATE POLICY "shop_settings tenant update"
      ON shop_settings FOR UPDATE TO authenticated
      USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='shop_settings' AND policyname='shop_settings public read active') THEN
    CREATE POLICY "shop_settings public read active"
      ON shop_settings FOR SELECT TO anon
      USING (is_active = true);
  END IF;
END $$;

-- 4. TABLE online_orders
CREATE TABLE IF NOT EXISTS online_orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_number      text NOT NULL,
  customer_name     text NOT NULL DEFAULT '',
  customer_phone    text NOT NULL DEFAULT '',
  customer_whatsapp text NOT NULL DEFAULT '',
  customer_email    text NOT NULL DEFAULT '',
  customer_address  text NOT NULL DEFAULT '',
  customer_note     text NOT NULL DEFAULT '',
  customer_id       uuid REFERENCES customers(id) ON DELETE SET NULL,
  delivery_mode     text NOT NULL DEFAULT 'retrait',
  delivery_address  text NOT NULL DEFAULT '',
  delivery_fee      numeric(15,2) NOT NULL DEFAULT 0,
  payment_mode      text NOT NULL DEFAULT 'livraison',
  payment_status    text NOT NULL DEFAULT 'non_paye',
  subtotal          numeric(15,2) NOT NULL DEFAULT 0,
  total             numeric(15,2) NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'nouvelle',
  internal_note     text NOT NULL DEFAULT '',
  sale_id           uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, order_number)
);

CREATE INDEX IF NOT EXISTS idx_online_orders_tenant   ON online_orders (tenant_id);
CREATE INDEX IF NOT EXISTS idx_online_orders_status   ON online_orders (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_online_orders_created  ON online_orders (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_online_orders_customer ON online_orders (tenant_id, customer_phone);

ALTER TABLE online_orders ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='online_orders' AND policyname='online_orders tenant select') THEN
    CREATE POLICY "online_orders tenant select"
      ON online_orders FOR SELECT TO authenticated
      USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='online_orders' AND policyname='online_orders tenant update') THEN
    CREATE POLICY "online_orders tenant update"
      ON online_orders FOR UPDATE TO authenticated
      USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='online_orders' AND policyname='online_orders tenant delete') THEN
    CREATE POLICY "online_orders tenant delete"
      ON online_orders FOR DELETE TO authenticated
      USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='online_orders' AND policyname='online_orders public insert') THEN
    CREATE POLICY "online_orders public insert"
      ON online_orders FOR INSERT TO anon
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM shop_settings WHERE is_active = true));
  END IF;
END $$;

-- 5. TABLE online_order_items
CREATE TABLE IF NOT EXISTS online_order_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id     uuid NOT NULL REFERENCES online_orders(id) ON DELETE CASCADE,
  article_id   uuid REFERENCES articles(id) ON DELETE SET NULL,
  article_name text NOT NULL DEFAULT '',
  internal_ref text NOT NULL DEFAULT '',
  quantity     integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price   numeric(15,2) NOT NULL DEFAULT 0,
  line_total   numeric(15,2) NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_online_order_items_order  ON online_order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_online_order_items_tenant ON online_order_items (tenant_id);

ALTER TABLE online_order_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='online_order_items' AND policyname='online_order_items tenant select') THEN
    CREATE POLICY "online_order_items tenant select"
      ON online_order_items FOR SELECT TO authenticated
      USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='online_order_items' AND policyname='online_order_items tenant update') THEN
    CREATE POLICY "online_order_items tenant update"
      ON online_order_items FOR UPDATE TO authenticated
      USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='online_order_items' AND policyname='online_order_items tenant delete') THEN
    CREATE POLICY "online_order_items tenant delete"
      ON online_order_items FOR DELETE TO authenticated
      USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='online_order_items' AND policyname='online_order_items public insert') THEN
    CREATE POLICY "online_order_items public insert"
      ON online_order_items FOR INSERT TO anon
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM shop_settings WHERE is_active = true));
  END IF;
END $$;

-- 6. TABLE online_order_status_history
CREATE TABLE IF NOT EXISTS online_order_status_history (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id   uuid NOT NULL REFERENCES online_orders(id) ON DELETE CASCADE,
  old_status text NOT NULL DEFAULT '',
  new_status text NOT NULL,
  changed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  note       text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_status_history_order  ON online_order_status_history (order_id);
CREATE INDEX IF NOT EXISTS idx_order_status_history_tenant ON online_order_status_history (tenant_id);

ALTER TABLE online_order_status_history ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='online_order_status_history' AND policyname='order_status_history tenant select') THEN
    CREATE POLICY "order_status_history tenant select"
      ON online_order_status_history FOR SELECT TO authenticated
      USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='online_order_status_history' AND policyname='order_status_history tenant insert') THEN
    CREATE POLICY "order_status_history tenant insert"
      ON online_order_status_history FOR INSERT TO authenticated
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
  END IF;
END $$;

-- 7. FONCTION generate_tenant_slug
CREATE OR REPLACE FUNCTION generate_tenant_slug(p_name text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_base      text;
  v_counter   int := 0;
  v_candidate text;
BEGIN
  v_base := lower(p_name);
  v_base := regexp_replace(v_base, '[àáâãäå]', 'a', 'g');
  v_base := regexp_replace(v_base, '[èéêë]', 'e', 'g');
  v_base := regexp_replace(v_base, '[ìíîï]', 'i', 'g');
  v_base := regexp_replace(v_base, '[òóôõö]', 'o', 'g');
  v_base := regexp_replace(v_base, '[ùúûü]', 'u', 'g');
  v_base := regexp_replace(v_base, '[ç]', 'c', 'g');
  v_base := regexp_replace(v_base, '[^a-z0-9]+', '-', 'g');
  v_base := trim(both '-' from v_base);
  v_base := substring(v_base, 1, 40);
  v_candidate := v_base;
  LOOP
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE public_slug = v_candidate) THEN
      RETURN v_candidate;
    END IF;
    v_counter := v_counter + 1;
    v_candidate := v_base || '-' || v_counter;
  END LOOP;
END;
$$;

-- 8. SÉQUENCE & fonction numéro commande web
CREATE SEQUENCE IF NOT EXISTS online_order_seq START 1;

CREATE OR REPLACE FUNCTION next_online_order_number(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_num bigint;
BEGIN
  v_num := nextval('online_order_seq');
  RETURN 'WEB-' || to_char(v_num, 'FM000000');
END;
$$;
