/*
# MC1-D.1 — Retrait de l'accès anonyme à deux RPC de retours

1. Changements
   - `rpc_paginated_returns` et `get_sale_returned_quantities` ne sont plus exécutables par `anon` ni `PUBLIC`.
   - `authenticated` conserve l'exécution (seules les pages connectées de Facturation les utilisent).
2. Notes
   1. Aucune donnée modifiée ; aucune signature modifiée.
*/
REVOKE EXECUTE ON FUNCTION public.rpc_paginated_returns(uuid,uuid,integer,timestamptz,uuid,text,text,uuid,timestamptz,timestamptz,numeric,numeric,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_sale_returned_quantities(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_paginated_returns(uuid,uuid,integer,timestamptz,uuid,text,text,uuid,timestamptz,timestamptz,numeric,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sale_returned_quantities(uuid) TO authenticated;
