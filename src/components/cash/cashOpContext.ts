import type { PrintTenant } from '../../lib/print';
import type { CashSession, Customer, PaymentMethod } from '../../lib/types';

export type CashOpMode = 'personal' | 'supervision';

export interface CashOpContext {
  mode: CashOpMode;
  sessionId: string;
  siteId: string;
  registerLabel: string;
  operatorName: string;
  siteName: string;
  userName: string;
  printTenant: PrintTenant;
  methods: PaymentMethod[];
  customers: Customer[];
}

export type CashSessionSnapshot = Omit<CashSession, 'closing_amount' | 'theoretical_amount' | 'variance'> & {
  closing_amount: number | null;
  theoretical_amount: number | null;
  variance: number | null;
  closing_note?: string | null;
};

export function cashOpError(e: { message?: string } | null | undefined, fallback = 'Opération impossible'): string {
  return e?.message || fallback;
}

// Non-null while rights are unknown: callers must wait instead of reporting a refusal.
export function permsPendingMessage(loading: boolean, error: string | null): string | null {
  if (loading) return 'Vérification de vos autorisations en cours.';
  if (error) return 'Impossible de vérifier vos autorisations.';
  return null;
}

export type SessionSale = {
  id: string;
  sale_number: string;
  total: number;
  paid: number;
  created_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  status: string;
  items: { sale_item_id: string; article_id: string; name: string; quantity: number; unit_price: number; purchase_cost?: number; returned?: number }[];
  fullyReturned?: boolean;
  doc_header?: Record<string, string | null> | null;
  user_id?: string | null;
};
