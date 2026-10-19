/*
# Performance Rapports > Caisse : index sur les lignes de vente et de retour

1. Contexte
   - `get_financial_summary` (appelée par `get_cash_report`) calcule le coût des ventes et
     des retours par sous-requête corrélée sur `sale_items.sale_id` et `sale_return_items.return_id`.
   - Sans index sur ces colonnes, chaque vente relit toutes les lignes de vente du tenant
     (cause démontrée du timeout sur CHEZ DELICE).

2. Objets modifiés
   - Nouvel index `idx_sale_items_sale_id` sur `public.sale_items (sale_id)`.
   - Nouvel index `idx_sale_return_items_return_id` sur `public.sale_return_items (return_id)`.

3. Notes importantes
   1. Aucune table, colonne, fonction, politique RLS ou donnée n'est modifiée.
   2. Les résultats des requêtes sont inchangés (un index n'altère jamais un résultat).
   3. Réversible : DROP INDEX IF EXISTS public.idx_sale_items_sale_id;
                   DROP INDEX IF EXISTS public.idx_sale_return_items_return_id;
*/

CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON public.sale_items (sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_return_items_return_id ON public.sale_return_items (return_id);
