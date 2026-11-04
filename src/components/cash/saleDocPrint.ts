import { printTicket80 as printTicket80Shared, printDocumentA4, type PrintTenant } from '../../lib/print';
import type { CartItem, Customer, SalePayment } from '../../lib/types';

export type PrintableSale = { sale_number: string; created_at: string; total: number; discount: number; items: CartItem[]; payments: SalePayment[]; customer: Customer | null };
type DocHeader = Record<string, string | null> | null;

export function printSaleTicketDoc(sale: PrintableSale, docHeader: DocHeader, tenant: PrintTenant, cashier: string) {
  printTicket80Shared({
    sale_number: sale.sale_number,
    created_at: sale.created_at,
    total: sale.total,
    discount: sale.discount,
    items: sale.items.map(i => ({ name: i.name, supplier_ref: null, oem_ref: i.oem_ref, internal_ref: i.internal_ref, quantity: i.quantity, unit_price: i.unit_price, discount: i.discount })),
    payments: sale.payments.map(p => ({ method_name: p.method_name, amount: p.amount })),
    customer: sale.customer ? { name: sale.customer.name, phone: (sale.customer as any).phone, address: (sale.customer as any).address } : null,
    docHeader,
  }, tenant, cashier);
}

export function printSaleInvoiceDoc(sale: PrintableSale, docHeader: DocHeader, tenant: PrintTenant, cashier: string, issuedBy?: string) {
  const items = sale.items.map(i => ({ name: i.name, supplier_ref: null, oem_ref: i.oem_ref, internal_ref: i.internal_ref, quantity: i.quantity, unit_price: i.unit_price, discount: i.discount }));
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price - (i.discount || 0), 0);
  const paid = sale.payments.reduce((s, p) => s + p.amount, 0);
  printDocumentA4({
    tenant,
    docLabel: 'FACTURE',
    docNumber: sale.sale_number,
    docDate: new Date(sale.created_at).toLocaleDateString('fr-FR'),
    docCreatedAt: sale.created_at,
    customer: sale.customer ? { name: sale.customer.name, phone: (sale.customer as any).phone, address: (sale.customer as any).address } : null,
    items, subtotal, discount: sale.discount, total: sale.total,
    payments: sale.payments.map(p => ({ method_name: p.method_name, amount: p.amount })),
    paid, cashier, issuedBy,
    docHeader,
  });
}
