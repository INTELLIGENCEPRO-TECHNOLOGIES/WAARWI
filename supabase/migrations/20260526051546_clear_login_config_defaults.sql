/*
  # Vider les valeurs par défaut de la config login

  1. Modifications
    - `platform_login_config` : vider headline, headline_accent, subtitle et modules
      pour que rien ne s'affiche si l'admin n'a pas configuré l'écran de connexion
    - Change les DEFAULT des colonnes en chaînes vides / tableau JSON vide
    - Met à jour la ligne 'default' existante pour supprimer le contenu hardcodé

  2. Raison
    - L'interface de connexion ne doit afficher aucun texte par défaut
    - Seul le contenu configuré explicitement via la plateforme admin doit apparaître
*/

-- Changer les valeurs par défaut des colonnes
ALTER TABLE platform_login_config
  ALTER COLUMN headline SET DEFAULT '',
  ALTER COLUMN headline_accent SET DEFAULT '',
  ALTER COLUMN subtitle SET DEFAULT '',
  ALTER COLUMN modules SET DEFAULT '[]'::jsonb;

-- Vider la ligne existante seulement si elle contient encore les valeurs hardcodées d'origine
UPDATE platform_login_config
SET
  headline = '',
  headline_accent = '',
  subtitle = '',
  modules = '[]'::jsonb,
  updated_at = now()
WHERE id = 'default'
  AND headline = 'Gérez votre business,';
