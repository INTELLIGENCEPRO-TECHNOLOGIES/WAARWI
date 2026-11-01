/*
# MC1-B : socle multi-caisse sans activation fonctionnelle

Cree les caisses permanentes (cash_registers), la structure d'affectation des
collaborateurs (cash_register_assignments, laissee vide), une "Caisse 1" par
magasin existant et futur, et rattache chaque session de caisse a une caisse.
Le fonctionnement actuel est conserve : une seule session ouverte par magasin
(index idx_cash_sessions_one_open_per_site conserve), aucun frontend modifie.

## 1. Nouvelles tables
- cash_registers : id, tenant_id, site_id, code, name, is_active, is_default,
  created_by, created_at, updated_at.
  - FK composite (tenant_id, site_id) -> sites(tenant_id, id) ON DELETE CASCADE.
  - code / name non vides ; code unique (insensible a la casse) par magasin ;
    une seule caisse par defaut par magasin.
  - Cles uniques techniques (tenant_id, id) et (tenant_id, site_id, id).
- cash_register_assignments : id, tenant_id, cash_register_id, user_id,
  is_active, assigned_by, created_at, updated_at.
  - FK composite (tenant_id, cash_register_id) -> cash_registers(tenant_id, id).
  - FK composite (tenant_id, user_id) -> profiles(tenant_id, id).
  - Unicite (cash_register_id, user_id). Aucune ligne creee.

## 2. Tables modifiees
- profiles : contrainte unique technique (tenant_id, id) (id deja cle primaire).
- cash_sessions : colonne cash_register_id, renseignee pour tout l'historique
  avec la caisse par defaut du magasin, puis NOT NULL ;
  FK composite (tenant_id, site_id, cash_register_id) ;
  index de recherche ; index unique partiel une session ouverte par caisse ;
  trigger de compatibilite (affectation automatique, controles, immutabilite).
  La colonne porte une expression par defaut evaluant NULL : elle permet a
  br_preflight_restore d'accepter les sauvegardes anterieures (sans cette
  colonne) ; la valeur reelle est toujours fixee par le trigger, et NOT NULL
  reste verifie apres le trigger.

## 3. Fonctions internes (SECURITY DEFINER, search_path public, pg_temp)
- _ensure_default_cash_register(tenant, site) : verrou transactionnel par
  magasin, verification tenant/site, creation idempotente de Caisse 1.
- _trg_sites_default_cash_register() : trigger contrainte differe sur sites
  (cree Caisse 1 a la validation si aucune caisse par defaut n'existe, ce qui
  laisse une restauration de sauvegarde reinserer ses propres caisses).
- _trg_cash_sessions_register() : trigger BEFORE INSERT/UPDATE sur cash_sessions.
- EXECUTE retire a PUBLIC, anon, authenticated et service_role.

## 4. Securite
- RLS active sur les deux tables, aucune politique.
- Aucun droit pour PUBLIC, anon, authenticated ; SELECT seul pour service_role.

## 5. Sauvegarde
- _br_table_registry : cash_registers (direct, structure, 20, preserve),
  cash_register_assignments (direct, structure, 40, preserve).
- Aucune fonction de sauvegarde modifiee.

## 6. Notes
1. Aucune donnee existante modifiee hormis l'ajout de cash_register_id.
2. Aucune fonction existante modifiee.
3. Arret immediat si une precondition est incoherente.
*/

-- 0. Preconditions
DO $$
BEGIN
  IF to_regclass('public.cash_registers') IS NOT NULL OR to_regclass('public.cash_register_assignments') IS NOT NULL THEN
    RAISE EXCEPTION 'MC1-B precondition: tables multi-caisse deja presentes';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cash_sessions' AND column_name='cash_register_id') THEN
    RAISE EXCEPTION 'MC1-B precondition: cash_sessions.cash_register_id deja presente';
  END IF;
  IF to_regclass('public.idx_cash_sessions_one_open_per_site') IS NULL THEN
    RAISE EXCEPTION 'MC1-B precondition: index idx_cash_sessions_one_open_per_site absent';
  END IF;
  IF EXISTS (SELECT 1 FROM cash_sessions WHERE status='open' GROUP BY site_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'MC1-B precondition: magasin avec plusieurs sessions ouvertes';
  END IF;
  IF EXISTS (SELECT 1 FROM cash_sessions cs LEFT JOIN sites s ON s.id = cs.site_id
             WHERE s.id IS NULL OR s.tenant_id <> cs.tenant_id) THEN
    RAISE EXCEPTION 'MC1-B precondition: session avec tenant/magasin incoherent';
  END IF;
END $$;

-- 1. Cle technique parente sur profiles
ALTER TABLE public.profiles ADD CONSTRAINT profiles_tenant_id_id_key UNIQUE (tenant_id, id);

-- 2. cash_registers
CREATE TABLE public.cash_registers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  site_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_registers_site_fk FOREIGN KEY (tenant_id, site_id)
    REFERENCES public.sites (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT cash_registers_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT cash_registers_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT cash_registers_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT cash_registers_tenant_site_id_key UNIQUE (tenant_id, site_id, id)
);
CREATE UNIQUE INDEX cash_registers_site_code_ci_key ON public.cash_registers (site_id, lower(btrim(code)));
CREATE UNIQUE INDEX cash_registers_one_default_per_site ON public.cash_registers (site_id) WHERE is_default;

ALTER TABLE public.cash_registers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cash_registers FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cash_registers TO service_role;

-- 3. cash_register_assignments
CREATE TABLE public.cash_register_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  cash_register_id uuid NOT NULL,
  user_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  assigned_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cra_register_fk FOREIGN KEY (tenant_id, cash_register_id)
    REFERENCES public.cash_registers (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT cra_profile_fk FOREIGN KEY (tenant_id, user_id)
    REFERENCES public.profiles (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT cra_register_user_key UNIQUE (cash_register_id, user_id)
);
CREATE INDEX idx_cra_tenant_user ON public.cash_register_assignments (tenant_id, user_id);

ALTER TABLE public.cash_register_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cash_register_assignments FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cash_register_assignments TO service_role;

-- 4. Creation idempotente de la caisse par defaut
CREATE FUNCTION public._ensure_default_cash_register(p_tenant_id uuid, p_site_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_tenant_id IS NULL OR p_site_id IS NULL THEN
    RAISE EXCEPTION 'Caisse par défaut : magasin ou tenant manquant';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('cash_registers:default:' || p_site_id::text, 0));

  IF NOT EXISTS (SELECT 1 FROM sites WHERE id = p_site_id AND tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Caisse par défaut : magasin introuvable pour ce tenant';
  END IF;

  SELECT id INTO v_id FROM cash_registers WHERE site_id = p_site_id AND is_default;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO cash_registers (tenant_id, site_id, code, name, is_active, is_default)
  VALUES (p_tenant_id, p_site_id, 'CAISSE-1', 'Caisse 1', true, true)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public._ensure_default_cash_register(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- 5. Caisse 1 pour chaque magasin existant
INSERT INTO public.cash_registers (tenant_id, site_id, code, name, is_active, is_default)
SELECT s.tenant_id, s.id, 'CAISSE-1', 'Caisse 1', true, true
FROM public.sites s;

DO $$
BEGIN
  IF (SELECT count(*) FROM cash_registers) <> (SELECT count(*) FROM sites)
     OR EXISTS (SELECT 1 FROM sites s WHERE NOT EXISTS (
       SELECT 1 FROM cash_registers r WHERE r.site_id = s.id AND r.tenant_id = s.tenant_id AND r.is_default)) THEN
    RAISE EXCEPTION 'MC1-B: creation des caisses par defaut incomplete';
  END IF;
END $$;

-- 6. Rattachement des sessions
ALTER TABLE public.cash_sessions ADD COLUMN cash_register_id uuid NULL;

UPDATE public.cash_sessions cs
SET cash_register_id = r.id
FROM public.cash_registers r
WHERE r.site_id = cs.site_id AND r.tenant_id = cs.tenant_id AND r.is_default;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cash_sessions WHERE cash_register_id IS NULL) THEN
    RAISE EXCEPTION 'MC1-B: sessions non rattachees';
  END IF;
  IF EXISTS (SELECT 1 FROM cash_sessions cs JOIN cash_registers r ON r.id = cs.cash_register_id
             WHERE r.tenant_id <> cs.tenant_id OR r.site_id <> cs.site_id) THEN
    RAISE EXCEPTION 'MC1-B: rattachement croise detecte';
  END IF;
END $$;

ALTER TABLE public.cash_sessions ALTER COLUMN cash_register_id SET NOT NULL;
ALTER TABLE public.cash_sessions ALTER COLUMN cash_register_id SET DEFAULT (CASE WHEN false THEN NULL::uuid END);
COMMENT ON COLUMN public.cash_sessions.cash_register_id IS
  'Caisse permanente de la session. Fixee par _trg_cash_sessions_register (caisse par defaut du magasin si absente), immuable. L''expression par defaut evalue NULL et sert uniquement a la compatibilite des sauvegardes anterieures.';

ALTER TABLE public.cash_sessions ADD CONSTRAINT cash_sessions_register_fk
  FOREIGN KEY (tenant_id, site_id, cash_register_id)
  REFERENCES public.cash_registers (tenant_id, site_id, id);

CREATE INDEX idx_cash_sessions_register_opened ON public.cash_sessions (cash_register_id, opened_at DESC);
CREATE UNIQUE INDEX idx_cash_sessions_one_open_per_register ON public.cash_sessions (cash_register_id) WHERE status = 'open';

-- 7. Trigger de compatibilite sur cash_sessions
CREATE FUNCTION public._trg_cash_sessions_register()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reg record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.cash_register_id IS DISTINCT FROM OLD.cash_register_id THEN
      RAISE EXCEPTION 'La caisse d''une session ne peut pas être modifiée';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.cash_register_id IS NULL THEN
    NEW.cash_register_id := _ensure_default_cash_register(NEW.tenant_id, NEW.site_id);
    RETURN NEW;
  END IF;

  SELECT id, tenant_id, site_id, is_active INTO v_reg
  FROM cash_registers WHERE id = NEW.cash_register_id
  FOR SHARE;

  IF NOT FOUND OR v_reg.tenant_id IS DISTINCT FROM NEW.tenant_id OR v_reg.site_id IS DISTINCT FROM NEW.site_id THEN
    RAISE EXCEPTION 'Caisse invalide pour ce magasin';
  END IF;

  IF coalesce(NEW.status, 'open') = 'open' AND NOT v_reg.is_active THEN
    RAISE EXCEPTION 'Cette caisse est désactivée';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._trg_cash_sessions_register() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_cash_sessions_register
  BEFORE INSERT OR UPDATE ON public.cash_sessions
  FOR EACH ROW EXECUTE FUNCTION public._trg_cash_sessions_register();

-- 8. Caisse 1 automatique pour chaque futur magasin
CREATE FUNCTION public._trg_sites_default_cash_register()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM sites WHERE id = NEW.id AND tenant_id = NEW.tenant_id) THEN
    PERFORM _ensure_default_cash_register(NEW.tenant_id, NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public._trg_sites_default_cash_register() FROM PUBLIC, anon, authenticated, service_role;

CREATE CONSTRAINT TRIGGER trg_sites_default_cash_register
  AFTER INSERT ON public.sites
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public._trg_sites_default_cash_register();

-- 9. Registre de sauvegarde
INSERT INTO public._br_table_registry (schema_name, table_name, tenant_link, tenant_id_column, category, restore_order, reset_behavior)
VALUES
  ('public', 'cash_registers', 'direct', 'tenant_id', 'structure', 20, 'preserve'),
  ('public', 'cash_register_assignments', 'direct', 'tenant_id', 'structure', 40, 'preserve')
ON CONFLICT (schema_name, table_name) DO NOTHING;

-- 10. Controles finaux
DO $$
BEGIN
  IF to_regclass('public.idx_cash_sessions_one_open_per_site') IS NULL THEN
    RAISE EXCEPTION 'MC1-B: index par magasin perdu';
  END IF;
  IF (SELECT count(*) FROM cash_register_assignments) <> 0 THEN
    RAISE EXCEPTION 'MC1-B: affectations inattendues';
  END IF;
END $$;
