/*
# C1 -- Revoke PUBLIC and anon EXECUTE on all 12 accounting DEFINER functions

## Purpose
All 12 accounting functions are SECURITY DEFINER and currently grant EXECUTE
to PUBLIC, anon, authenticated, and service_role.  This means an unauthenticated
visitor can call any of them (mass accounting, closures, etc.) on any tenant.

This migration removes EXECUTE from PUBLIC and anon on every function, and
restricts authenticated to only the 7 functions actually called from the UI.
The 5 internal functions (called only by other DEFINER functions) lose all
API-role EXECUTE grants -- only the function owner (postgres) and service_role
retain access.

## Functions and their classification

### RPC functions (called from React UI -- keep authenticated):
1. comptabiliser_vente(uuid) -- Billing.tsx, Sales.tsx
2. comptabiliser_ventes_en_masse(uuid) -- Accounting.tsx
3. comptabiliser_reglements_clients_en_masse(uuid) -- Accounting.tsx
4. comptabiliser_achats_en_masse(uuid) -- Accounting.tsx
5. comptabiliser_reglements_fournisseurs_en_masse(uuid) -- Accounting.tsx
6. cloturer_journal(uuid, text, date) -- Accounting.tsx
7. cloturer_exercice(uuid, integer) -- Accounting.tsx

### Internal functions (never called from UI -- no authenticated):
8. comptabiliser_reglement(uuid) -- called by reglements_clients_en_masse
9. comptabiliser_achat(uuid) -- called by achats_en_masse
10. comptabiliser_reglement_fournisseur(uuid) -- called by reglements_fournisseurs_en_masse
11. comptabiliser_depense(uuid) -- called by the accounting engine
12. next_accounting_piece_number(uuid, text) -- called by all comptabiliser_* functions

## Security changes
- REVOKE ALL FROM PUBLIC on all 12 functions
- REVOKE ALL FROM anon on all 12 functions
- REVOKE ALL FROM authenticated on the 5 internal functions
- GRANT EXECUTE TO authenticated on the 7 RPC functions only

## What is NOT changed
- No function body is modified
- No table, RLS policy, or data is modified
- service_role and postgres owner retain full access via ownership
*/

-- ============================================================
-- GROUP A: RPC functions (PUBLIC + anon revoked, authenticated kept)
-- ============================================================

-- 1. comptabiliser_vente(uuid)
REVOKE ALL ON FUNCTION public.comptabiliser_vente(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.comptabiliser_vente(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.comptabiliser_vente(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.comptabiliser_vente(uuid) TO service_role;

-- 2. comptabiliser_ventes_en_masse(uuid)
REVOKE ALL ON FUNCTION public.comptabiliser_ventes_en_masse(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.comptabiliser_ventes_en_masse(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.comptabiliser_ventes_en_masse(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.comptabiliser_ventes_en_masse(uuid) TO service_role;

-- 3. comptabiliser_reglements_clients_en_masse(uuid)
REVOKE ALL ON FUNCTION public.comptabiliser_reglements_clients_en_masse(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.comptabiliser_reglements_clients_en_masse(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.comptabiliser_reglements_clients_en_masse(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.comptabiliser_reglements_clients_en_masse(uuid) TO service_role;

-- 4. comptabiliser_achats_en_masse(uuid)
REVOKE ALL ON FUNCTION public.comptabiliser_achats_en_masse(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.comptabiliser_achats_en_masse(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.comptabiliser_achats_en_masse(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.comptabiliser_achats_en_masse(uuid) TO service_role;

-- 5. comptabiliser_reglements_fournisseurs_en_masse(uuid)
REVOKE ALL ON FUNCTION public.comptabiliser_reglements_fournisseurs_en_masse(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.comptabiliser_reglements_fournisseurs_en_masse(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.comptabiliser_reglements_fournisseurs_en_masse(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.comptabiliser_reglements_fournisseurs_en_masse(uuid) TO service_role;

-- 6. cloturer_journal(uuid, text, date)
REVOKE ALL ON FUNCTION public.cloturer_journal(uuid, text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cloturer_journal(uuid, text, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.cloturer_journal(uuid, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cloturer_journal(uuid, text, date) TO service_role;

-- 7. cloturer_exercice(uuid, integer)
REVOKE ALL ON FUNCTION public.cloturer_exercice(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cloturer_exercice(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.cloturer_exercice(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cloturer_exercice(uuid, integer) TO service_role;

-- ============================================================
-- GROUP B: Internal functions (all API roles revoked)
-- ============================================================

-- 8. comptabiliser_reglement(uuid)
REVOKE ALL ON FUNCTION public.comptabiliser_reglement(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.comptabiliser_reglement(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.comptabiliser_reglement(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.comptabiliser_reglement(uuid) TO service_role;

-- 9. comptabiliser_achat(uuid)
REVOKE ALL ON FUNCTION public.comptabiliser_achat(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.comptabiliser_achat(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.comptabiliser_achat(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.comptabiliser_achat(uuid) TO service_role;

-- 10. comptabiliser_reglement_fournisseur(uuid)
REVOKE ALL ON FUNCTION public.comptabiliser_reglement_fournisseur(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.comptabiliser_reglement_fournisseur(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.comptabiliser_reglement_fournisseur(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.comptabiliser_reglement_fournisseur(uuid) TO service_role;

-- 11. comptabiliser_depense(uuid)
REVOKE ALL ON FUNCTION public.comptabiliser_depense(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.comptabiliser_depense(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.comptabiliser_depense(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.comptabiliser_depense(uuid) TO service_role;

-- 12. next_accounting_piece_number(uuid, text)
REVOKE ALL ON FUNCTION public.next_accounting_piece_number(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.next_accounting_piece_number(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.next_accounting_piece_number(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.next_accounting_piece_number(uuid, text) TO service_role;
