/*
# Rattachement de la boutique en ligne a un magasin source

## Resume
Chaque boutique en ligne (une par tenant) est desormais liee a UN magasin precis
(shop_settings.site_id). Chaque commande en ligne memorise le magasin d'origine
(online_orders.site_id). Aucune ligne d'articles ou de stock_levels n'est modifiee.

## 1. Nouvelles colonnes
- shop_settings.site_id (uuid) : magasin alimentant la boutique.
- online_orders.site_id (uuid, NOT NULL apres backfill) : magasin d'origine de la commande.

## 2. Integrite
- UNIQUE (sites.tenant_id, sites.id) pour permettre des FK composites.
- FK composites (tenant_id, site_id) -> sites(tenant_id, id), ON DELETE RESTRICT :
  impossible de pointer vers le magasin d'un autre tenant, impossible de supprimer
  un magasin utilise par la boutique ou par des commandes.
- Trigger shop_settings : refuse un depot comme magasin source, refuse un magasin
  inactif lors du rattachement, refuse l'activation sans magasin. Pour un tenant
  mono-magasin, le magasin unique est renseigne automatiquement (comportement inchange).
- CHECK : une boutique active doit avoir un site_id.
- Trigger online_orders : site_id deduit de shop_settings a l'insertion si absent,
  et immuable ensuite.
- Index (tenant_id, site_id, created_at DESC).

## 3. Affectations (decisions validees)
- SAD PIECES AUTO -> magasin SAD PIECES AUTO (boutique laissee desactivee).
- INTELLIGENCEPRO -> magasin INTELLIGENCEPRO.
- SALOUM ELECTRONIQUE -> magasin PARCELLE (commande WEB-00001 rattachee, statut inchange).
- CONNECTENDO -> magasin CONNECTENDO (verifie : 1359 articles actifs, l'autre magasin est une boulangerie distincte).
- Tenants a magasin unique actif non-depot -> ce magasin.
- Autres boutiques inactives multi-magasins : non rattachees (activation impossible sans choix).

## 4. Notes
1. Forward-only, idempotent.
2. Le trigger updated_at des commandes est suspendu le temps du backfill pour ne pas alterer les dates.
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sites_tenant_id_id_key') THEN
    ALTER TABLE public.sites ADD CONSTRAINT sites_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END $$;

ALTER TABLE public.shop_settings ADD COLUMN IF NOT EXISTS site_id uuid;
ALTER TABLE public.online_orders ADD COLUMN IF NOT EXISTS site_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_settings_tenant_site_fkey') THEN
    ALTER TABLE public.shop_settings ADD CONSTRAINT shop_settings_tenant_site_fkey
      FOREIGN KEY (tenant_id, site_id) REFERENCES public.sites (tenant_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'online_orders_tenant_site_fkey') THEN
    ALTER TABLE public.online_orders ADD CONSTRAINT online_orders_tenant_site_fkey
      FOREIGN KEY (tenant_id, site_id) REFERENCES public.sites (tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_online_orders_tenant_site_created
  ON public.online_orders (tenant_id, site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shop_settings_site ON public.shop_settings (site_id);

CREATE OR REPLACE FUNCTION public.trg_shop_settings_site_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_site record;
  v_only uuid;
BEGIN
  IF NEW.site_id IS NULL THEN
    SELECT CASE WHEN count(*) = 1 THEN (array_agg(s.id))[1] END INTO v_only
    FROM sites s WHERE s.tenant_id = NEW.tenant_id AND s.is_active AND NOT s.is_warehouse;
    NEW.site_id := v_only;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.site_id IS DISTINCT FROM OLD.site_id OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    IF NEW.site_id IS NOT NULL THEN
      SELECT id, tenant_id, is_active, is_warehouse INTO v_site FROM sites WHERE id = NEW.site_id;
      IF v_site.id IS NULL OR v_site.tenant_id <> NEW.tenant_id THEN
        RAISE EXCEPTION '[SHOP_SITE_INVALID] Magasin inconnu pour ce commerce' USING ERRCODE = '23514';
      END IF;
      IF v_site.is_warehouse THEN
        RAISE EXCEPTION '[SHOP_SITE_IS_DEPOT] Un depot ne peut pas alimenter la boutique' USING ERRCODE = '23514';
      END IF;
      IF NOT v_site.is_active AND (TG_OP = 'INSERT' OR NEW.site_id IS DISTINCT FROM OLD.site_id OR NEW.is_active) THEN
        RAISE EXCEPTION '[SHOP_SITE_INACTIVE] Le magasin choisi est inactif' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NEW.is_active AND NEW.site_id IS NULL THEN
      RAISE EXCEPTION '[SHOP_SITE_REQUIRED] Choisissez le magasin alimentant la boutique avant de l''activer' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.trg_shop_settings_site_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_shop_settings_site_guard ON public.shop_settings;
CREATE TRIGGER trg_shop_settings_site_guard BEFORE INSERT OR UPDATE ON public.shop_settings
  FOR EACH ROW EXECUTE FUNCTION public.trg_shop_settings_site_guard();

CREATE OR REPLACE FUNCTION public.trg_online_orders_site_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.site_id IS NULL THEN
      SELECT ss.site_id INTO NEW.site_id FROM shop_settings ss WHERE ss.tenant_id = NEW.tenant_id;
    END IF;
    IF NEW.site_id IS NULL THEN
      RAISE EXCEPTION '[ORDER_SITE_REQUIRED] Boutique non rattachee a un magasin' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.site_id IS DISTINCT FROM OLD.site_id AND OLD.site_id IS NOT NULL THEN
    RAISE EXCEPTION '[ORDER_SITE_IMMUTABLE] Le magasin d''une commande ne peut pas etre modifie' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.trg_online_orders_site_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_online_orders_site_guard ON public.online_orders;
CREATE TRIGGER trg_online_orders_site_guard BEFORE INSERT OR UPDATE ON public.online_orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_online_orders_site_guard();

-- Explicit, validated assignments (only when the site belongs to the tenant)
UPDATE public.shop_settings ss SET site_id = m.site_id
FROM (VALUES
  ('66ce2dfd-96bb-4ab6-815e-1b583e064fbc'::uuid, '597e7936-3e33-4d50-b715-a3d75aa21690'::uuid),
  ('31f9910a-5e94-4dc1-8ab5-c204bbcdb7db'::uuid, '91fcc3e8-f5bd-4fc8-8899-25bed82a44ee'::uuid),
  ('6df087c1-e338-47b1-b218-d51d69b54310'::uuid, 'c0ceacf3-6025-41dc-9bbb-1ee7ca0e6581'::uuid),
  ('f9d04734-6acf-432b-b071-4be6031e54db'::uuid, 'ff430bc4-7895-461c-b522-323a6c72005d'::uuid)
) AS m(tenant_id, site_id)
WHERE ss.tenant_id = m.tenant_id AND ss.site_id IS NULL
  AND EXISTS (SELECT 1 FROM public.sites s WHERE s.id = m.site_id AND s.tenant_id = m.tenant_id AND NOT s.is_warehouse);

-- Single active store tenants
UPDATE public.shop_settings ss SET site_id = x.site_id
FROM (
  SELECT s.tenant_id, (array_agg(s.id))[1] AS site_id
  FROM public.sites s WHERE s.is_active AND NOT s.is_warehouse
  GROUP BY s.tenant_id HAVING count(*) = 1
) x
WHERE ss.tenant_id = x.tenant_id AND ss.site_id IS NULL;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.shop_settings WHERE is_active AND site_id IS NULL) THEN
    RAISE EXCEPTION 'Boutique active sans magasin apres backfill';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_settings_active_requires_site') THEN
    ALTER TABLE public.shop_settings ADD CONSTRAINT shop_settings_active_requires_site
      CHECK (NOT is_active OR site_id IS NOT NULL);
  END IF;
END $$;

ALTER TABLE public.online_orders DISABLE TRIGGER trg_online_orders_touch;
UPDATE public.online_orders o SET site_id = ss.site_id
FROM public.shop_settings ss
WHERE ss.tenant_id = o.tenant_id AND o.site_id IS NULL AND ss.site_id IS NOT NULL;
ALTER TABLE public.online_orders ENABLE TRIGGER trg_online_orders_touch;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.online_orders WHERE site_id IS NULL) THEN
    RAISE EXCEPTION 'Commande en ligne sans magasin apres backfill';
  END IF;
END $$;

ALTER TABLE public.online_orders ALTER COLUMN site_id SET NOT NULL;
