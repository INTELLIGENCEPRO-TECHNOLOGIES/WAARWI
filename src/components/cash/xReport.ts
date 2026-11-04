import type { CashSession } from '../../lib/types';
import type { ControlLine } from '../../lib/cashClose';
import type { CashMovementKind } from '../../lib/cashMovements';
import { printXReport80, type PrintTenant } from '../../lib/print';

export type SessionStats = {
    count: number; total: number; totalPayments: number;
    byMethod: { method_name: string; amount: number }[];
    topArticles: { name: string; qty: number; total: number }[];
    movements: { kind: CashMovementKind; amount: number; reason: string; method_name: string; customer_name: string | null }[];
    invoicePayments: { sale_number: string; amount: number; method_name: string; customer_name: string | null; created_at: string; user_name: string | null }[];
    movExpense: number; movIncome: number; movPrepay: number; movWithdrawal: number; movLoan: number; movRefund: number;
    movVaultIn: number; movVaultOut: number;
    netTotal: number;
  };

export type SessionRegularization = { id?: string; reg_type: string; amount: number; reason: string; note: string };

export function printXReport(
  session: Pick<CashSession, 'id' | 'opened_at' | 'closed_at' | 'opening_amount'>,
  controls: ControlLine[],
  salesStats: {
    count: number; total: number; totalPayments?: number;
    byMethod: { method_name: string; amount: number }[];
    topArticles: { name: string; qty: number; total: number }[];
    movements?: { kind: CashMovementKind; amount: number; reason: string; method_name: string; customer_name: string | null }[];
    movExpense?: number; movIncome?: number; movPrepay?: number; netTotal?: number;
  },
  regularizations: { reg_type: string; amount: number; reason: string }[],
  tenantArg: PrintTenant,
  cashier: string,
  siteName: string,
  identity?: { registerLabel?: string; printedBy?: string }
) {
  printXReport80({
    tenant: tenantArg,
    cashier,
    siteName,
    sessionId: session.id,
    openedAt: session.opened_at,
    closedAt: session.closed_at,
    openingAmount: Number(session.opening_amount),
    salesCount: salesStats.count,
    salesTotal: (salesStats.totalPayments ?? salesStats.total) + (salesStats.movIncome || 0) + (salesStats.movPrepay || 0),
    byMethod: salesStats.byMethod,
    movements: salesStats.movements,
    controls: controls.map(c => ({
      method_name: c.method_name,
      theoretical_amount: c.theoretical_amount,
      counted_amount: c.counted_amount,
    })),
    regularizations,
    registerLabel: identity?.registerLabel || undefined,
    printedBy: identity?.printedBy && identity.printedBy !== cashier ? identity.printedBy : undefined,
  });
}
