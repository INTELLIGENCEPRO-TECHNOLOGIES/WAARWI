// Classification centralisée des mouvements de caisse (cash_movements.kind).
// Source unique de vérité partagée par POS, CashHistory, Dashboard, ReportScreen,
// reportEngine et print, afin d'éviter des filtres divergents.
//
// Les transferts avec le coffre sont des flux PHYSIQUES d'espèces, jamais du
// chiffre d'affaires ni un règlement client :
//   - vault_withdrawal = « Transfert reçu du coffre » : espèces qui ENTRENT en caisse.
//   - vault_deposit     = « Versement au coffre »      : espèces qui SORTENT de la caisse.

export type CashMovementKind =
  | 'expense'
  | 'income'
  | 'customer_prepayment'
  | 'customer_withdrawal'
  | 'customer_loan'
  | 'refund'
  | 'vault_withdrawal'
  | 'vault_deposit';

export const CASH_MOVEMENT_LABELS: Record<CashMovementKind, string> = {
  expense: 'Dépense',
  income: 'Entrée',
  customer_prepayment: 'Acompte',
  customer_withdrawal: 'Retrait',
  customer_loan: 'Prêt',
  refund: 'Remboursement',
  vault_withdrawal: 'Transfert reçu du coffre',
  vault_deposit: 'Versement au coffre',
};

// Flux physiques d'espèces : ce qui augmente / diminue le tiroir-caisse.
export const CASH_INFLOW_KINDS: CashMovementKind[] = ['income', 'customer_prepayment', 'vault_withdrawal'];
export const CASH_OUTFLOW_KINDS: CashMovementKind[] = ['expense', 'refund', 'customer_withdrawal', 'customer_loan', 'vault_deposit'];

export const VAULT_IN_KIND: CashMovementKind = 'vault_withdrawal'; // entrée physique (reçu du coffre)
export const VAULT_OUT_KIND: CashMovementKind = 'vault_deposit'; // sortie physique (versé au coffre)

export function isCashOutflow(kind: string): boolean {
  return (CASH_OUTFLOW_KINDS as string[]).includes(kind);
}

export function isCashInflow(kind: string): boolean {
  return (CASH_INFLOW_KINDS as string[]).includes(kind);
}

export function cashMovementSign(kind: string): '+' | '-' {
  return isCashOutflow(kind) ? '-' : '+';
}

export function cashMovementLabel(kind: string): string {
  return CASH_MOVEMENT_LABELS[kind as CashMovementKind] || 'Mouvement';
}

// Un règlement de facture/vente enregistré comme income ne doit pas être recompté
// comme une entrée directe : il est déjà couvert par les paiements de vente.
export function isSaleSettlementIncome(kind: string, reason?: string | null): boolean {
  return (
    kind === 'income' &&
    !!reason &&
    reason.startsWith('Règlement ') &&
    !reason.startsWith('Règlement solde')
  );
}
