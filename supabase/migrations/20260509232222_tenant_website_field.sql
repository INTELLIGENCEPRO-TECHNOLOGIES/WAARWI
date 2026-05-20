/*
  # Ajout du champ website au tenant

  1. Modifications
    - Ajoute la colonne `website` (text, nullable) à la table `tenants`
    - Utilisée dans l'en-tête des documents imprimables

  2. Sécurité
    - Aucune nouvelle politique RLS nécessaire — la colonne hérite de celles de `tenants`

  3. Notes importantes
    - Champ purement informatif, utilisé uniquement pour l'affichage
    - `IF NOT EXISTS` garantit l'idempotence
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'website'
  ) THEN
    ALTER TABLE public.tenants ADD COLUMN website text;
  END IF;
END $$;
