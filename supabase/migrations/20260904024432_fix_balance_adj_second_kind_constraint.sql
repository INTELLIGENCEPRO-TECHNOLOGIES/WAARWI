/*
# Corriger la seconde contrainte sur balance_adjustments.kind

La table possède deux contraintes CHECK sur `kind`. La migration précédente n'avait
mis à jour que l'une d'elles. On aligne ici `chk_balance_adj_kind_values` pour
accepter les mêmes valeurs (`cancel_reversal`, `cancel_refund`) sans quoi les
contre-passations d'annulation et les neutralisations de remboursement échouent.
*/
ALTER TABLE balance_adjustments DROP CONSTRAINT IF EXISTS chk_balance_adj_kind_values;
ALTER TABLE balance_adjustments ADD CONSTRAINT chk_balance_adj_kind_values
  CHECK (kind = ANY (ARRAY['manual','carryover','reconciliation','cancel_reversal','cancel_refund']));
