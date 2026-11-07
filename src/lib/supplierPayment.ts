export type SupplierPaymentState = 'unpaid' | 'partial' | 'paid';

export const PAYMENT_STATE_LABELS: Record<SupplierPaymentState, string> = {
  unpaid: 'Non payée',
  partial: 'Partiellement payée',
  paid: 'Payée',
};

type PayableOrder = { status: string; total: number | string | null; paid?: number | string | null };

const toMoney = (v: number | string | null | undefined) => Math.round((Number(v) || 0) * 100) / 100;

export function orderRemaining(o: PayableOrder): number {
  return Math.max(0, toMoney(toMoney(o.total) - toMoney(o.paid)));
}

// Mêmes règles que le filtre serveur de rpc_paginated_supplier_orders.
export function orderPaymentState(o: PayableOrder): SupplierPaymentState | null {
  const total = toMoney(o.total);
  const paid = toMoney(o.paid);
  if (o.status === 'cancelled' || total <= 0) return null;
  if (paid >= total) return 'paid';
  if (paid > 0) return 'partial';
  return 'unpaid';
}

// register_supplier_payment(_from_vault) refusent les commandes annulées et les brouillons.
export function isOrderPayable(o: PayableOrder): boolean {
  return o.status !== 'cancelled' && o.status !== 'draft' && orderRemaining(o) > 0;
}

export function orderBlockReason(o: PayableOrder): string | null {
  if (o.status === 'cancelled') return 'Commande annulée — aucun règlement possible.';
  if (o.status === 'draft') return 'Commande en brouillon — envoyez-la avant de la régler.';
  if (orderRemaining(o) <= 0) return 'Commande déjà soldée — plus rien à régler.';
  return null;
}
