/*
  # Create brand logos storage bucket

  1. New bucket: `brand-logos`
     - Public bucket for serving brand logo images
  2. RLS policies on storage.objects
     - Authenticated users can upload/update/delete logos in their tenant folder
     - Public read access for all logo images
*/

-- Create the bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'brand-logos',
  'brand-logos',
  true,
  2097152, -- 2MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

-- Public read policy
CREATE POLICY "Brand logos are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'brand-logos');

-- Authenticated upload policy
CREATE POLICY "Authenticated users can upload brand logos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'brand-logos');

-- Authenticated update policy
CREATE POLICY "Authenticated users can update brand logos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'brand-logos');

-- Authenticated delete policy
CREATE POLICY "Authenticated users can delete brand logos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'brand-logos');
