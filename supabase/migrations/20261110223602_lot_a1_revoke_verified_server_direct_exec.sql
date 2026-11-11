/*
# Lot A — retrait de l'exécution directe de `_br_is_verified_server()` par authenticated

1. Sécurité
- La fonction n'est appelée que depuis des fonctions SECURITY DEFINER (exécutées par leur propriétaire) :
  aucun besoin d'exécution directe par `authenticated` via l'API. EXECUTE conservé pour service_role.
2. Notes
- `_br_can_manage_backups` reste exécutable par authenticated (nécessaire aux politiques RLS ; ne révèle
  que le droit de l'appelant sur son propre tenant). `br_download_backup` est une RPC publique voulue, contrôlée.
*/
REVOKE EXECUTE ON FUNCTION public._br_is_verified_server() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._br_is_verified_server() TO service_role;
