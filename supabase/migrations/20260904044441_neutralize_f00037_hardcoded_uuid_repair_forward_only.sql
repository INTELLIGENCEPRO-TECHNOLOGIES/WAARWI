/*
# Neutralisation (forward-only) de l'ancien correctif F-00037 à UUID codés en dur

## Contexte
Une migration antérieure contenait un bloc de réparation ciblant des UUID de production
codés en dur (une vente et un client précis). Ce type d'opération est proscrit : aucune
migration ne doit modifier une vente ou un client de production à partir d'UUID codés en
dur.

## Décision
- Cette migration NE réécrit PAS l'ancienne migration déjà appliquée (forward-only).
- Elle NE touche AUCUNE donnée : pas de recensement global, pas de réparation historique,
  pas de devinette de correspondances manquantes.
- Le correctif fonctionnel (suppression logique des factures numérotées, exclusion des
  écritures techniques « reconciliation » de tous les calculs de solde, rapports et
  imputations) est appliqué à TOUS les tenants par les fonctions réécrites, sans jamais
  cibler un identifiant de production en particulier.

## Effet
Purement documentaire. Aucune instruction DDL/DML n'est exécutée ici : le simple fait de
consigner cette décision suffit, l'effet neutralisant provient des fonctions déjà
réécrites qui écartent partout les écritures « reconciliation ».
*/
DO $$
BEGIN
  -- Aucune opération : neutralisation assurée par les fonctions réécrites (exclusion
  -- globale des écritures 'reconciliation') sans cibler aucun UUID de production.
  PERFORM 1;
END $$;
