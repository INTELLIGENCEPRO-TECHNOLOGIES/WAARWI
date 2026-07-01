INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('mt-service-logos', 'mt-service-logos', true, 2097152, ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "mt_logos_select" ON storage.objects FOR SELECT
  TO anon, authenticated USING (bucket_id = 'mt-service-logos');

CREATE POLICY "mt_logos_insert" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (bucket_id = 'mt-service-logos');

CREATE POLICY "mt_logos_update" ON storage.objects FOR UPDATE
  TO authenticated USING (bucket_id = 'mt-service-logos') WITH CHECK (bucket_id = 'mt-service-logos');

CREATE POLICY "mt_logos_delete" ON storage.objects FOR DELETE
  TO authenticated USING (bucket_id = 'mt-service-logos');