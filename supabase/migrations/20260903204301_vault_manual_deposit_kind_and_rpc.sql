/*
# Coffre — Dépôt manuel : type `manual_deposit` + RPC `record_manual_vault_deposit`

Migration additive, forward-only, non destructive. Elle finalise le module Coffre
existant en ajoutant la possibilité d'enregistrer un dépôt manuel directement dans
le coffre (sans mouvement de caisse), pour tous les tenants ayant le module activé.

## 1. Modifications de tables
- `vault_movements.kind` : la contrainte CHECK `vault_movements_kind_check` est étendue
  pour accepter en plus la valeur `manual_deposit`. Aucune donnée existante n'est
  modifiée ; toutes les valeurs actuelles restent valides.

## 2. Nouvelle fonction (RPC)
- `record_manual_vault_deposit(p_site_id, p_amount, p_effective_at, p_reference, p_note, p_idempotency_key)`
  SECURITY DEFINER. Crédite UNIQUEMENT le coffre du site (mouvement `in` / `manual_deposit`).
  Ne crée AUCUN mouvement de caisse : un dépôt manuel n'est pas un versement de clôture.
  Contrôles effectués :
    1. Tenant courant présent.
    2. Module Coffre activé (`vault_module_enabled`).
    3. Permission `vault_receive_from_cash` ou `access_vault`.
    4. Site accessible (`vault_site_accessible`).
    5. Montant strictement positif.
    6. Idempotence via `p_idempotency_key` (contrainte unique `tenant_id + idempotency_key`)
       pour empêcher tout doublon en cas de double validation.
  Le coffre est verrouillé (`FOR UPDATE`) le temps de la mise à jour du solde.

## 3. Sécurité
- EXECUTE révoqué pour anon/public, accordé à `authenticated`.
- Aucune policy d'écriture directe sur `vaults`/`vault_movements` : les écritures
  passent exclusivement par cette fonction SECURITY DEFINER.

## 4. Notes importantes
1. Migration idempotente : ré-exécutable sans effet de bord.
2. Aucune suppression ni renommage : les soldes et l'historique existants sont préservés.
3. Le type `manual_deposit` est distinct de `cash_deposit` (versement depuis la caisse
   lors d'une clôture), ce qui garantit une comptabilité claire dans le rapport du coffre.
*/

-- 1. Extension de la contrainte kind (additive)
DO $ext_vault_kind$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vault_movements_kind_check'
      AND conrelid = 'public.vault_movements'::regclass
  ) THEN
    ALTER TABLE public.vault_movements DROP CONSTRAINT vault_movements_kind_check;
  END IF;
  ALTER TABLE public.vault_movements ADD CONSTRAINT vault_movements_kind_check
    CHECK (kind = ANY (ARRAY[
      'opening_balance','cash_deposit','cash_withdrawal',
      'supplier_payment','adjustment_in','adjustment_out','manual_deposit'
    ]));
END
$ext_vault_kind$;

-- 2. RPC : dépôt manuel dans le coffre
CREATE OR REPLACE FUNCTION public.record_manual_vault_deposit(
  p_site_id uuid,
  p_amount numeric,
  p_effective_at timestamptz DEFAULT NULL,
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
  v_amount numeric(14,2) := COALESCE(p_amount, 0);
  v_when timestamptz := COALESCE(p_effective_at, now());
BEGIN
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Aucun tenant courant'; END IF;
  IF NOT public.vault_module_enabled() THEN RAISE EXCEPTION 'Le module Coffre n''est pas activé'; END IF;
  IF NOT public.vault_has_permission('vault_receive_from_cash') AND NOT public.vault_has_permission('access_vault') THEN
    RAISE EXCEPTION 'Permission insuffisante';
  END IF;
  IF NOT public.vault_site_accessible(p_site_id) THEN RAISE EXCEPTION 'Site non autorisé'; END IF;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'Le montant doit être strictement positif'; END IF;

  -- Idempotence
  IF p_idempotency_key IS NOT NULL AND p_idempotency_key <> '' AND EXISTS (
    SELECT 1 FROM vault_movements WHERE tenant_id = v_tenant AND idempotency_key = p_idempotency_key
  ) THEN
    SELECT current_balance INTO v_after FROM vaults WHERE tenant_id = v_tenant AND site_id = p_site_id AND is_active;
    RETURN jsonb_build_object('already_processed', true, 'vault_balance', v_after);
  END IF;

  -- Verrou coffre
  SELECT * INTO v_vault FROM vaults WHERE tenant_id = v_tenant AND site_id = p_site_id AND is_active FOR UPDATE;
  IF v_vault.id IS NULL THEN RAISE EXCEPTION 'Aucun coffre initialisé pour ce site'; END IF;

  v_before := COALESCE(v_vault.current_balance, 0);
  v_after := v_before + v_amount;

  INSERT INTO vault_movements (
    tenant_id, vault_id, site_id, direction, kind, amount,
    balance_before, balance_after, effective_at,
    reference, note, created_by, idempotency_key
  ) VALUES (
    v_tenant, v_vault.id, p_site_id, 'in', 'manual_deposit', v_amount,
    v_before, v_after, v_when,
    NULLIF(p_reference,''), NULLIF(p_note,''), auth.uid(), NULLIF(p_idempotency_key,'')
  ) RETURNING id INTO v_vm_id;

  UPDATE vaults SET current_balance = v_after, updated_at = now() WHERE id = v_vault.id;

  RETURN jsonb_build_object('vault_movement_id', v_vm_id, 'vault_balance', v_after);
END
$fn$;

REVOKE ALL ON FUNCTION public.record_manual_vault_deposit(uuid,numeric,timestamptz,text,text,text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.record_manual_vault_deposit(uuid,numeric,timestamptz,text,text,text) TO authenticated;
