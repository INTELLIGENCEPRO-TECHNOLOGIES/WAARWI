/*
# Module Coffre (Vault) — Fondation : tables, colonnes de liaison, RLS, permissions, RPC de base

## Résumé
Ajoute l'infrastructure du module « Coffre » de façon strictement additive et désactivée
par défaut. Aucune donnée historique n'est modifiée, aucun tenant n'est activé, aucune
fonction financière existante n'est remplacée. Le module reste invisible tant que
`tenants.enabled_modules` ne contient pas `"vault"`.

## 1. Nouvelles tables
- `vaults` : un coffre physique par site (tenant, site, devise XOF, solde courant >= 0,
  compte comptable optionnel, actif, traçabilité d'initialisation).
- `vault_movements` : registre immuable des entrées/sorties du coffre (direction in/out,
  type d'opération, montant > 0, solde avant/après, références, utilisateur, clé
  d'idempotence unique par tenant).

## 2. Colonnes ajoutées (toutes nullable, non destructives)
- `cash_movements.vault_movement_id` (FK vault_movements) + index.
- `supplier_payments` : `funding_source`, `vault_id`, `vault_movement_id`, `site_id`.
- `cash_sessions` : `physical_cash_counted`, `vault_deposit_amount`, `retained_cash_amount`,
  `close_request_id` (unique).
- Extension de la contrainte `cash_movements.kind` pour accepter en plus `vault_deposit`
  et `vault_withdrawal` (créés uniquement par les RPC sécurisées du coffre).

## 3. Sécurité
- RLS activée sur `vaults` et `vault_movements`.
- Lecture autorisée aux membres du tenant, limitée aux sites accessibles.
- Aucune écriture directe possible : INSERT/UPDATE/DELETE passent exclusivement par des
  fonctions SECURITY DEFINER ; droits retirés à anon/public.
- Helpers privés : vérification du tenant, de la permission, du module actif, de l'accès au site.

## 4. Permissions
- Ajout additif des clés `access_vault`, `view_vault`, `vault_receive_from_cash`,
  `vault_transfer_to_cash`, `vault_pay_supplier`, `vault_adjust` à `role_permissions`
  (administrateur = autorisé, autres rôles = refusé). Les clés déjà présentes ne sont
  jamais écrasées.

## 5. RPC créées
- `initialize_site_vault` : initialise le coffre d'un site (une seule fois), solde initial >= 0.
- `transfer_vault_to_cash` : transfère du coffre vers une caisse ouverte du même site (atomique).
- `get_vault_report` : registre paginé + soldes/entrées/sorties/ventilation à une date d'arrêté.

## Notes importantes
1. Aucun solde initial n'est inséré par la migration.
2. `current_balance` est le miroir transactionnel du registre `vault_movements`.
3. Le coffre ne peut jamais devenir négatif (contrôle + contrainte CHECK).
4. Migration idempotente et forward-only.
*/

-- =====================================================================
-- 1. TABLES
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.vaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Coffre principal',
  currency text NOT NULL DEFAULT 'XOF',
  current_balance numeric(14,2) NOT NULL DEFAULT 0 CHECK (current_balance >= 0),
  account_code text,
  is_active boolean NOT NULL DEFAULT true,
  initialized_at timestamptz,
  initialized_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Un seul coffre actif par couple tenant/site
CREATE UNIQUE INDEX IF NOT EXISTS vaults_one_active_per_site
  ON public.vaults (tenant_id, site_id) WHERE is_active;

CREATE INDEX IF NOT EXISTS vaults_tenant_idx ON public.vaults (tenant_id);
CREATE INDEX IF NOT EXISTS vaults_site_idx ON public.vaults (site_id);

CREATE TABLE IF NOT EXISTS public.vault_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vault_id uuid NOT NULL REFERENCES public.vaults(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('in','out')),
  kind text NOT NULL CHECK (kind IN (
    'opening_balance','cash_deposit','cash_withdrawal',
    'supplier_payment','adjustment_in','adjustment_out'
  )),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  balance_before numeric(14,2) NOT NULL,
  balance_after numeric(14,2) NOT NULL,
  effective_at timestamptz NOT NULL DEFAULT now(),
  cash_session_id uuid,
  supplier_id uuid,
  payment_method_id uuid,
  reference text,
  note text,
  created_by uuid,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vault_movements_tenant_idem_unique UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS vault_movements_vault_idx ON public.vault_movements (vault_id, effective_at);
CREATE INDEX IF NOT EXISTS vault_movements_tenant_idx ON public.vault_movements (tenant_id);
CREATE INDEX IF NOT EXISTS vault_movements_site_idx ON public.vault_movements (site_id);

-- =====================================================================
-- 2. COLONNES DE LIAISON (additives, non destructives)
-- =====================================================================

DO $add_cols$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cash_movements' AND column_name='vault_movement_id') THEN
    ALTER TABLE public.cash_movements ADD COLUMN vault_movement_id uuid REFERENCES public.vault_movements(id);
    CREATE INDEX IF NOT EXISTS cash_movements_vault_movement_idx ON public.cash_movements (vault_movement_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='supplier_payments' AND column_name='funding_source') THEN
    ALTER TABLE public.supplier_payments ADD COLUMN funding_source text CHECK (funding_source IN ('cash','vault'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='supplier_payments' AND column_name='vault_id') THEN
    ALTER TABLE public.supplier_payments ADD COLUMN vault_id uuid REFERENCES public.vaults(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='supplier_payments' AND column_name='vault_movement_id') THEN
    ALTER TABLE public.supplier_payments ADD COLUMN vault_movement_id uuid REFERENCES public.vault_movements(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='supplier_payments' AND column_name='site_id') THEN
    ALTER TABLE public.supplier_payments ADD COLUMN site_id uuid REFERENCES public.sites(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cash_sessions' AND column_name='physical_cash_counted') THEN
    ALTER TABLE public.cash_sessions ADD COLUMN physical_cash_counted numeric(14,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cash_sessions' AND column_name='vault_deposit_amount') THEN
    ALTER TABLE public.cash_sessions ADD COLUMN vault_deposit_amount numeric(14,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cash_sessions' AND column_name='retained_cash_amount') THEN
    ALTER TABLE public.cash_sessions ADD COLUMN retained_cash_amount numeric(14,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cash_sessions' AND column_name='close_request_id') THEN
    ALTER TABLE public.cash_sessions ADD COLUMN close_request_id uuid;
    CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_close_request_unique ON public.cash_sessions (close_request_id) WHERE close_request_id IS NOT NULL;
  END IF;
END
$add_cols$;

-- Extension prudente de la contrainte kind de cash_movements (ajout de deux valeurs)
DO $ext_kind$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='cash_movements_kind_check' AND conrelid='public.cash_movements'::regclass) THEN
    ALTER TABLE public.cash_movements DROP CONSTRAINT cash_movements_kind_check;
  END IF;
  ALTER TABLE public.cash_movements ADD CONSTRAINT cash_movements_kind_check
    CHECK (kind = ANY (ARRAY[
      'expense','income','customer_prepayment','customer_withdrawal',
      'customer_loan','refund','vault_deposit','vault_withdrawal'
    ]));
END
$ext_kind$;

-- =====================================================================
-- 3. RLS
-- =====================================================================

ALTER TABLE public.vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vaults_select_tenant_sites" ON public.vaults;
CREATE POLICY "vaults_select_tenant_sites" ON public.vaults FOR SELECT TO authenticated
USING (
  tenant_id = public.current_tenant_id()
  AND EXISTS (
    SELECT 1 FROM public.profiles pr
    WHERE pr.id = auth.uid()
      AND pr.tenant_id = vaults.tenant_id
      AND (pr.assigned_site_ids IS NULL OR array_length(pr.assigned_site_ids,1) IS NULL OR vaults.site_id = ANY(pr.assigned_site_ids))
  )
);

DROP POLICY IF EXISTS "vault_movements_select_tenant_sites" ON public.vault_movements;
CREATE POLICY "vault_movements_select_tenant_sites" ON public.vault_movements FOR SELECT TO authenticated
USING (
  tenant_id = public.current_tenant_id()
  AND EXISTS (
    SELECT 1 FROM public.profiles pr
    WHERE pr.id = auth.uid()
      AND pr.tenant_id = vault_movements.tenant_id
      AND (pr.assigned_site_ids IS NULL OR array_length(pr.assigned_site_ids,1) IS NULL OR vault_movements.site_id = ANY(pr.assigned_site_ids))
  )
);

-- Aucune policy INSERT/UPDATE/DELETE : écritures uniquement via SECURITY DEFINER.
REVOKE ALL ON public.vaults FROM anon;
REVOKE ALL ON public.vault_movements FROM anon;

-- =====================================================================
-- 4. HELPERS PRIVÉS (SECURITY DEFINER)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.vault_has_permission(p_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(
    (SELECT (pr.permissions ->> p_key)::boolean FROM profiles pr WHERE pr.id = auth.uid() AND pr.permissions ? p_key),
    (SELECT (rp.permissions ->> p_key)::boolean
       FROM profiles pr JOIN role_permissions rp ON rp.tenant_id = pr.tenant_id AND rp.role = pr.role
       WHERE pr.id = auth.uid()),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.vault_module_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenants t
    WHERE t.id = public.current_tenant_id()
      AND t.enabled_modules ? 'vault'
  );
$$;

CREATE OR REPLACE FUNCTION public.vault_site_accessible(p_site_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM sites s
    JOIN profiles pr ON pr.id = auth.uid()
    WHERE s.id = p_site_id
      AND s.tenant_id = public.current_tenant_id()
      AND pr.tenant_id = s.tenant_id
      AND (pr.assigned_site_ids IS NULL OR array_length(pr.assigned_site_ids,1) IS NULL OR p_site_id = ANY(pr.assigned_site_ids))
  );
$$;

REVOKE ALL ON FUNCTION public.vault_has_permission(text) FROM anon, public;
REVOKE ALL ON FUNCTION public.vault_module_enabled() FROM anon, public;
REVOKE ALL ON FUNCTION public.vault_site_accessible(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.vault_has_permission(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vault_module_enabled() TO authenticated;
GRANT EXECUTE ON FUNCTION public.vault_site_accessible(uuid) TO authenticated;

-- =====================================================================
-- 5. PERMISSIONS (ajout additif, sans écrasement)
-- =====================================================================

UPDATE public.role_permissions rp
SET permissions = jsonb_build_object(
      'access_vault',            rp.role = 'admin',
      'view_vault',              rp.role = 'admin',
      'vault_receive_from_cash', rp.role = 'admin',
      'vault_transfer_to_cash',  rp.role = 'admin',
      'vault_pay_supplier',      rp.role = 'admin',
      'vault_adjust',            rp.role = 'admin'
    ) || rp.permissions,
    updated_at = now();

-- =====================================================================
-- 6. RPC : initialize_site_vault
-- =====================================================================

CREATE OR REPLACE FUNCTION public.initialize_site_vault(
  p_site_id uuid,
  p_opening_amount numeric,
  p_note text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE
  v_tenant uuid;
  v_vault_id uuid;
  v_amount numeric(14,2) := COALESCE(p_opening_amount, 0);
BEGIN
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Aucun tenant courant'; END IF;
  IF NOT public.vault_module_enabled() THEN RAISE EXCEPTION 'Le module Coffre n''est pas activé'; END IF;
  IF NOT public.vault_has_permission('vault_adjust') AND NOT public.vault_has_permission('access_vault') THEN
    RAISE EXCEPTION 'Permission insuffisante';
  END IF;
  IF NOT public.vault_site_accessible(p_site_id) THEN RAISE EXCEPTION 'Site non autorisé'; END IF;
  IF v_amount < 0 THEN RAISE EXCEPTION 'Le solde initial ne peut pas être négatif'; END IF;

  IF EXISTS (SELECT 1 FROM vaults WHERE tenant_id = v_tenant AND site_id = p_site_id AND is_active) THEN
    RAISE EXCEPTION 'Un coffre existe déjà pour ce site';
  END IF;

  INSERT INTO vaults (tenant_id, site_id, current_balance, initialized_at, initialized_by)
  VALUES (v_tenant, p_site_id, 0, now(), auth.uid())
  RETURNING id INTO v_vault_id;

  IF v_amount > 0 THEN
    INSERT INTO vault_movements (
      tenant_id, vault_id, site_id, direction, kind, amount,
      balance_before, balance_after, note, created_by, idempotency_key
    ) VALUES (
      v_tenant, v_vault_id, p_site_id, 'in', 'opening_balance', v_amount,
      0, v_amount, p_note, auth.uid(),
      COALESCE(p_idempotency_key, 'init:'||v_vault_id::text)
    );
    UPDATE vaults SET current_balance = v_amount, updated_at = now() WHERE id = v_vault_id;
  END IF;

  RETURN jsonb_build_object('vault_id', v_vault_id, 'balance', v_amount);
END
$fn$;

-- =====================================================================
-- 7. RPC : transfer_vault_to_cash
-- =====================================================================

CREATE OR REPLACE FUNCTION public.transfer_vault_to_cash(
  p_site_id uuid,
  p_cash_session_id uuid,
  p_amount numeric,
  p_reference text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE
  v_tenant uuid;
  v_vault vaults%ROWTYPE;
  v_before numeric(14,2);
  v_after numeric(14,2);
  v_vm_id uuid;
  v_pm_id uuid;
  v_pm_name text;
  v_session_status text;
  v_session_site uuid;
  v_amount numeric(14,2) := COALESCE(p_amount,0);
BEGIN
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Aucun tenant courant'; END IF;
  IF NOT public.vault_module_enabled() THEN RAISE EXCEPTION 'Le module Coffre n''est pas activé'; END IF;
  IF NOT public.vault_has_permission('vault_transfer_to_cash') THEN RAISE EXCEPTION 'Permission insuffisante'; END IF;
  IF NOT public.vault_site_accessible(p_site_id) THEN RAISE EXCEPTION 'Site non autorisé'; END IF;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'Le montant doit être strictement positif'; END IF;

  -- Idempotence
  IF p_idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM vault_movements WHERE tenant_id = v_tenant AND idempotency_key = p_idempotency_key
  ) THEN
    SELECT current_balance INTO v_after FROM vaults WHERE tenant_id = v_tenant AND site_id = p_site_id AND is_active;
    RETURN jsonb_build_object('already_processed', true, 'vault_balance', v_after);
  END IF;

  -- Session ouverte du même site
  SELECT status, site_id INTO v_session_status, v_session_site
  FROM cash_sessions WHERE id = p_cash_session_id AND tenant_id = v_tenant FOR UPDATE;
  IF v_session_status IS NULL OR v_session_site <> p_site_id OR v_session_status <> 'open' THEN
    RAISE EXCEPTION 'Ouvrez une session de caisse avant d''effectuer ce transfert.';
  END IF;

  -- Verrou coffre
  SELECT * INTO v_vault FROM vaults WHERE tenant_id = v_tenant AND site_id = p_site_id AND is_active FOR UPDATE;
  IF v_vault.id IS NULL THEN RAISE EXCEPTION 'Aucun coffre initialisé pour ce site'; END IF;
  IF v_amount > v_vault.current_balance THEN RAISE EXCEPTION 'Montant supérieur au solde du coffre'; END IF;

  -- Mode physique « Espèces »
  SELECT id, name INTO v_pm_id, v_pm_name FROM payment_methods
  WHERE tenant_id = v_tenant AND is_active
    AND (payment_type = 'cash' OR name ILIKE '%esp%ce%' OR name ILIKE '%liquide%' OR name ILIKE '%cash%')
  ORDER BY (payment_type='cash') DESC, sort_order NULLS LAST LIMIT 1;

  v_before := v_vault.current_balance;
  v_after := v_before - v_amount;

  INSERT INTO vault_movements (
    tenant_id, vault_id, site_id, direction, kind, amount,
    balance_before, balance_after, cash_session_id, payment_method_id,
    reference, note, created_by, idempotency_key
  ) VALUES (
    v_tenant, v_vault.id, p_site_id, 'out', 'cash_withdrawal', v_amount,
    v_before, v_after, p_cash_session_id, v_pm_id,
    p_reference, p_note, auth.uid(), p_idempotency_key
  ) RETURNING id INTO v_vm_id;

  UPDATE vaults SET current_balance = v_after, updated_at = now() WHERE id = v_vault.id;

  INSERT INTO cash_movements (
    tenant_id, cash_session_id, site_id, user_id, kind, amount,
    reason, note, reference, payment_method_id, method_name, vault_movement_id
  ) VALUES (
    v_tenant, p_cash_session_id, p_site_id, auth.uid(), 'vault_withdrawal', v_amount,
    'Transfert coffre → caisse', p_note, p_reference, v_pm_id, COALESCE(v_pm_name,'Espèces'), v_vm_id
  );

  UPDATE cash_sessions SET theoretical_amount = COALESCE(theoretical_amount,0) + v_amount, updated_at = now()
  WHERE id = p_cash_session_id;

  RETURN jsonb_build_object('vault_movement_id', v_vm_id, 'vault_balance', v_after);
END
$fn$;

-- =====================================================================
-- 8. RPC : get_vault_report
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_vault_report(
  p_site_id uuid,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_as_of timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $fn$
DECLARE
  v_tenant uuid;
  v_vault_id uuid;
  v_as_of timestamptz;
  v_prior numeric(14,2);
  v_in numeric(14,2);
  v_out numeric(14,2);
  v_balance numeric(14,2);
  v_total integer;
  v_detail jsonb;
  v_breakdown jsonb;
BEGIN
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Aucun tenant courant'; END IF;
  IF NOT public.vault_has_permission('view_vault') AND NOT public.vault_has_permission('access_vault') THEN
    RAISE EXCEPTION 'Permission insuffisante';
  END IF;
  IF NOT public.vault_site_accessible(p_site_id) THEN RAISE EXCEPTION 'Site non autorisé'; END IF;

  SELECT id INTO v_vault_id FROM vaults WHERE tenant_id = v_tenant AND site_id = p_site_id AND is_active;
  IF v_vault_id IS NULL THEN
    RETURN jsonb_build_object('vault_id', NULL, 'prior_balance', 0, 'total_in', 0, 'total_out', 0,
      'balance', 0, 'total_movements', 0, 'breakdown', '[]'::jsonb, 'movements', '[]'::jsonb);
  END IF;

  v_as_of := COALESCE(p_as_of, p_to, now());

  -- Solde antérieur (avant p_from)
  SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) INTO v_prior
  FROM vault_movements
  WHERE vault_id = v_vault_id AND (p_from IS NULL OR effective_at < p_from);

  -- Entrées / sorties de la période
  SELECT COALESCE(SUM(amount) FILTER (WHERE direction='in'),0),
         COALESCE(SUM(amount) FILTER (WHERE direction='out'),0)
  INTO v_in, v_out
  FROM vault_movements
  WHERE vault_id = v_vault_id
    AND (p_from IS NULL OR effective_at >= p_from)
    AND effective_at < v_as_of;

  -- Solde à date d'arrêté
  SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) INTO v_balance
  FROM vault_movements
  WHERE vault_id = v_vault_id AND effective_at < v_as_of;

  SELECT COUNT(*) INTO v_total
  FROM vault_movements
  WHERE vault_id = v_vault_id
    AND (p_from IS NULL OR effective_at >= p_from)
    AND effective_at < v_as_of;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', kind, 'direction', direction, 'total', t)),'[]'::jsonb)
  INTO v_breakdown
  FROM (
    SELECT kind, direction, SUM(amount) AS t
    FROM vault_movements
    WHERE vault_id = v_vault_id
      AND (p_from IS NULL OR effective_at >= p_from)
      AND effective_at < v_as_of
    GROUP BY kind, direction
  ) b;

  SELECT COALESCE(jsonb_agg(row_to_json(m)),'[]'::jsonb) INTO v_detail
  FROM (
    SELECT vm.id, vm.effective_at, vm.kind, vm.direction, vm.amount,
           vm.balance_before, vm.balance_after, vm.reference, vm.note,
           vm.cash_session_id, vm.supplier_id, vm.created_by,
           pr.full_name AS created_by_name
    FROM vault_movements vm
    LEFT JOIN profiles pr ON pr.id = vm.created_by
    WHERE vm.vault_id = v_vault_id
      AND (p_from IS NULL OR vm.effective_at >= p_from)
      AND vm.effective_at < v_as_of
    ORDER BY vm.effective_at DESC, vm.created_at DESC
    LIMIT GREATEST(COALESCE(p_limit,100),1) OFFSET GREATEST(COALESCE(p_offset,0),0)
  ) m;

  RETURN jsonb_build_object(
    'vault_id', v_vault_id,
    'prior_balance', v_prior,
    'total_in', v_in,
    'total_out', v_out,
    'balance', v_balance,
    'total_movements', v_total,
    'breakdown', v_breakdown,
    'movements', v_detail
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.initialize_site_vault(uuid,numeric,text,text) FROM anon, public;
REVOKE ALL ON FUNCTION public.transfer_vault_to_cash(uuid,uuid,numeric,text,text,text) FROM anon, public;
REVOKE ALL ON FUNCTION public.get_vault_report(uuid,timestamptz,timestamptz,timestamptz,integer,integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.initialize_site_vault(uuid,numeric,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_vault_to_cash(uuid,uuid,numeric,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_vault_report(uuid,timestamptz,timestamptz,timestamptz,integer,integer) TO authenticated;
