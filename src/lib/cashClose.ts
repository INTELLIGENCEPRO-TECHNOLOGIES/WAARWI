import type { PaymentMethod } from './types';
import { isSaleSettlementIncome } from './cashMovements';

export type ControlLine = {
  payment_method_id: string | null;
  method_name: string;
  theoretical_amount: number;
  counted_amount: number;
};

type PaymentRow = { payment_method_id: string | null; method_name: string; amount: number | string };
type MovementRow = { kind: string; amount: number | string; payment_method_id: string | null; method_name: string | null; reason: string | null };

const isCashName = (name: string) => {
  const n = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return n.includes('espece') || n.includes('liquide') || n.includes('cash');
};

export function isCashMethod(name: string, method?: PaymentMethod | null): boolean {
  return method?.payment_type === 'cash' || isCashName(name);
}

export function buildCloseControlLines(
  payments: PaymentRow[], movements: MovementRow[], methods: PaymentMethod[], openingAmount: number,
): ControlLine[] {
  const theoretical: Record<string, { method_name: string; payment_method_id: string | null; amount: number }> = {};
  payments.forEach(p => {
    const key = p.method_name;
    if (!theoretical[key]) theoretical[key] = { method_name: p.method_name, payment_method_id: p.payment_method_id, amount: 0 };
    theoretical[key].amount += Number(p.amount);
  });
  movements.forEach(m => {
    if (isSaleSettlementIncome(m.kind, m.reason)) return;
    const outflow = m.kind === 'expense' || m.kind === 'refund' || m.kind === 'customer_withdrawal' || m.kind === 'customer_loan' || m.kind === 'vault_deposit';
    const key = m.method_name || (outflow || m.kind === 'vault_withdrawal' ? 'Espèces' : '—');
    if (!theoretical[key]) theoretical[key] = { method_name: key, payment_method_id: m.payment_method_id, amount: 0 };
    theoretical[key].amount += outflow ? -Number(m.amount) : Number(m.amount);
  });

  const opening = Number(openingAmount) || 0;
  const lines: ControlLine[] = methods.map(m => {
    let base = theoretical[m.name] ? theoretical[m.name].amount : 0;
    if (isCashMethod(m.name, m) && opening > 0) base += opening;
    return { payment_method_id: m.id, method_name: m.name, theoretical_amount: base, counted_amount: base };
  });
  Object.values(theoretical).forEach(t => {
    if (lines.find(l => l.method_name === t.method_name)) return;
    let base = t.amount;
    if (isCashName(t.method_name) && opening > 0) base += opening;
    lines.push({ payment_method_id: t.payment_method_id, method_name: t.method_name, theoretical_amount: base, counted_amount: base });
  });
  return lines;
}
