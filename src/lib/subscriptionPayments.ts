import { supabase } from './supabase';

export type SubscriptionCycle = 'monthly' | 'yearly' | 'lifetime';
export type SubscriptionPayment = {
  id: string;
  tenant_name?: string;
  plan_code: string;
  billing_cycle: SubscriptionCycle;
  billing_months?: number | null;
  monthly_rate?: number | null;
  purpose: 'initial' | 'renewal';
  amount: number;
  environment: 'prod' | 'test';
  state: 'creating' | 'pending' | 'paid' | 'cancelled' | 'failed' | 'refunded';
  subscription_id: string | null;
  review_reason: string | null;
  payment_method: string | null;
  paid_at: string | null;
  created_at: string;
};

export type SubscriptionPaymentContext = {
  enabled: boolean;
  environment?: 'prod' | 'test';
  checkout_paused?: boolean;
  payment?: SubscriptionPayment | null;
  quote?: {
    plan_name: string;
    amount: number;
    billing_cycle: SubscriptionCycle;
    purpose: SubscriptionPayment['purpose'];
    billing_options?: { months: number; amount: number; discount_percent?: number }[] | null;
  } | null;
};

export function subscriptionPaymentDuration(payment: Pick<SubscriptionPayment, 'billing_cycle' | 'billing_months'>) {
  return payment.billing_cycle === 'lifetime'
    ? 'À vie'
    : (payment.billing_months ?? (payment.billing_cycle === 'yearly' ? 12 : 1)) + ' mois';
}

const discountFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

export function formatSubscriptionDiscount(percent: number) {
  return discountFormatter.format(percent) + ' %';
}

export const subscriptionCycleLabels: Record<SubscriptionCycle, string> = {
  monthly: 'Mensuel',
  yearly: 'Annuel',
  lifetime: 'À vie',
};

export function subscriptionPaymentLabel(payment: SubscriptionPayment) {
  if (payment.state === 'paid') {
    if (payment.review_reason) return 'À rapprocher';
    if (payment.environment === 'test') return 'Test confirmé';
    return payment.subscription_id ? 'Paiement confirmé' : 'Payé, validation en attente';
  }
  return {
    creating: 'En préparation',
    pending: 'Paiement en attente',
    cancelled: 'Paiement annulé',
    failed: 'Paiement indisponible',
    refunded: 'Remboursé',
  }[payment.state];
}

export function callSubscriptionPayments<T>(body: Record<string, unknown>): Promise<T> {
  return callSubscriptionFunction('subscription-payments', body);
}

export function callSubscriptionRecords<T>(body: Record<string, unknown>): Promise<T> {
  return callSubscriptionFunction('subscription-records', body);
}

async function callSubscriptionFunction<T>(name: 'subscription-payments' | 'subscription-records', body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) {
    const response = error.context;
    const payload = response instanceof Response ? await response.json().catch(() => null) : null;
    throw new Error(payload?.error || 'Le service de paiement est temporairement indisponible.');
  }
  if (!data) throw new Error('Réponse du service de paiement indisponible.');
  return data;
}

export function hasSubscriptionReceipt(payment: SubscriptionPayment) {
  return payment.environment === 'prod' && payment.state === 'paid' && !!payment.paid_at;
}
