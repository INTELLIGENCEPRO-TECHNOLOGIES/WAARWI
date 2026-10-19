/*
# Rattachement automatique des fiches sans magasin lors du passage en mode indépendant

## Problème
Quand un établissement passe son catalogue (ou ses clients / fournisseurs) en mode
"indépendant", l'application filtre par magasin. Les fiches créées avant le
multi-magasin (site_id NULL) deviennent alors invisibles.

## Correction
1. Nouvelle fonction `_assign_unassigned_rows_to_sites(tenant_id, articles, customers, suppliers)`.
   - Magasin principal = premier magasin actif non-dépôt (par date de création).
   - Articles : rattachés au magasin où ils ont le plus de stock (un dépôt est
     remplacé par son magasin parent), sinon au magasin principal. Les articles
     dont la référence existe déjà (active) dans le magasin cible sont ignorés
     pour ne pas violer l'index d'unicité par magasin.
   - Clients : rattachés au magasin où ils ont le plus de ventes, sinon au principal.
   - Fournisseurs : rattachés au magasin principal.
2. Nouveau trigger `trg_tenants_assign_unassigned_on_independent` (AFTER UPDATE OF settings
   sur `tenants`) : appelle la fonction pour chaque partage passé à `false`.

## Sécurité
- Fonction SECURITY DEFINER (search_path fixé), limitée au tenant modifié.
- EXECUTE révoqué pour public/anon/authenticated : seule le trigger l'utilise.
- Aucune suppression de données, aucune modification de policy.
*/

CREATE OR REPLACE FUNCTION public._assign_unassigned_rows_to_sites(
  p_tenant_id uuid, p_articles boolean, p_customers boolean, p_suppliers boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_main uuid;
BEGIN
  SELECT id INTO v_main FROM sites
  WHERE tenant_id = p_tenant_id AND is_active AND NOT COALESCE(is_warehouse, false)
  ORDER BY created_at, id LIMIT 1;

  IF v_main IS NULL THEN RETURN; END IF;

  IF p_articles THEN
    WITH stock_site AS (
      SELECT DISTINCT ON (sl.article_id) sl.article_id,
             CASE WHEN s.is_warehouse AND s.parent_site_id IS NOT NULL THEN s.parent_site_id ELSE s.id END AS site_id
      FROM stock_levels sl
      JOIN articles a ON a.id = sl.article_id AND a.tenant_id = p_tenant_id AND a.site_id IS NULL
      JOIN sites s ON s.id = sl.site_id AND s.tenant_id = p_tenant_id AND s.is_active
      WHERE sl.quantity > 0
      ORDER BY sl.article_id, sl.quantity DESC
    ), target AS (
      SELECT a.id, COALESCE(ss.site_id, v_main) AS site_id, a.internal_ref, a.is_active
      FROM articles a LEFT JOIN stock_site ss ON ss.article_id = a.id
      WHERE a.tenant_id = p_tenant_id AND a.site_id IS NULL
    )
    UPDATE articles a SET site_id = t.site_id
    FROM target t
    WHERE a.id = t.id
      AND NOT (t.is_active AND EXISTS (
        SELECT 1 FROM articles x
        WHERE x.tenant_id = p_tenant_id AND x.site_id = t.site_id AND x.is_active
          AND lower(x.internal_ref) = lower(t.internal_ref)
      ))
      AND NOT (t.is_active AND EXISTS (
        SELECT 1 FROM target t2
        WHERE t2.id <> t.id AND t2.is_active AND t2.site_id = t.site_id
          AND lower(t2.internal_ref) = lower(t.internal_ref) AND t2.id < t.id
      ));
  END IF;

  IF p_customers THEN
    WITH sale_site AS (
      SELECT DISTINCT ON (customer_id) customer_id, site_id
      FROM (
        SELECT sa.customer_id, sa.site_id, count(*) AS n
        FROM sales sa JOIN sites s ON s.id = sa.site_id AND s.is_active
        WHERE sa.tenant_id = p_tenant_id AND sa.customer_id IS NOT NULL
        GROUP BY sa.customer_id, sa.site_id
      ) x ORDER BY customer_id, n DESC
    )
    UPDATE customers c SET site_id = COALESCE(ss.site_id, v_main)
    FROM customers c2 LEFT JOIN sale_site ss ON ss.customer_id = c2.id
    WHERE c.id = c2.id AND c.tenant_id = p_tenant_id AND c.site_id IS NULL;
  END IF;

  IF p_suppliers THEN
    UPDATE suppliers SET site_id = v_main
    WHERE tenant_id = p_tenant_id AND site_id IS NULL;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public._assign_unassigned_rows_to_sites(uuid, boolean, boolean, boolean) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public._trg_tenants_assign_unassigned_on_independent()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a boolean := COALESCE(NEW.settings->>'shared_articles', '') = 'false';
  c boolean := COALESCE(NEW.settings->>'shared_customers', '') = 'false';
  s boolean := COALESCE(NEW.settings->>'shared_suppliers', '') = 'false';
BEGIN
  IF a OR c OR s THEN
    PERFORM public._assign_unassigned_rows_to_sites(NEW.id, a, c, s);
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public._trg_tenants_assign_unassigned_on_independent() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tenants_assign_unassigned_on_independent ON public.tenants;
CREATE TRIGGER trg_tenants_assign_unassigned_on_independent
AFTER UPDATE OF settings ON public.tenants
FOR EACH ROW
WHEN (OLD.settings IS DISTINCT FROM NEW.settings)
EXECUTE FUNCTION public._trg_tenants_assign_unassigned_on_independent();