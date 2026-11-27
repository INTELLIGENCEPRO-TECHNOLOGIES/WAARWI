import type { ArticleLotSelection } from '../components/LotPickerModal';
import { getOperationalCashContext, missingSessionMessage } from './cashSession';
import type { IpmDocuments } from './ipm';
import { supabase } from './supabase';

type InvoiceLine = {
  article_id: string | null;
  name: string;
  quantity: number;
  unit_price: number;
  discount: number;
};
type InvoicePayment = { method_id: string; amount: number; reference: string };

export function trackedInvoiceItems(lines: InvoiceLine[], articles: { id: string; track_stock?: boolean | null }[]) {
  const untracked = new Set(articles.filter(article => article.track_stock === false).map(article => article.id));
  const tracked = new Map<string, { article_id: string; name: string; quantity: number }>();
  for (const line of lines) {
    const articleId = line.article_id;
    if (!articleId || !line.name.trim() || untracked.has(articleId)) continue;
    tracked.set(articleId, {
      article_id: articleId,
      name: line.name,
      quantity: Number(line.quantity) + (tracked.get(articleId)?.quantity ?? 0),
    });
  }
  return [...tracked.values()];
}

type DirectInvoice = {
  tenantId: string;
  siteId: string;
  stockSiteId: string;
  customerId: string | null;
  representativeId: string | null;
  total: number;
  docHeader: Record<string, string | null>;
  lines: InvoiceLine[];
  payments: InvoicePayment[];
  ipm?: { beneficiaryId: string; organizationName?: string; expectedShare: number; documents: IpmDocuments };
  lots: ArticleLotSelection[];
};

export async function createDirectInvoice(invoice: DirectInvoice, requestId: string) {
  const payments = invoice.payments.filter(payment => payment.amount > 0);
  let sessionId: string | null = null;
  if (payments.length) {
    const cash = await getOperationalCashContext(invoice.siteId);
    sessionId = cash.session?.id ?? null;
    if (!sessionId && (cash.multiEnabled || cash.error)) throw new Error(missingSessionMessage(cash, ''));
  }

  const ipm = invoice.ipm;
  const { data, error } = await supabase.rpc('create_direct_invoice_atomic', {
    p_tenant_id: invoice.tenantId,
    p_sale: {
      site_id: invoice.siteId,
      customer_id: invoice.customerId,
      representative_id: invoice.representativeId,
      cash_session_id: sessionId,
      total: invoice.total,
      doc_header: invoice.docHeader,
      note: ipm?.organizationName ? `IPM: ${ipm.organizationName}` : null,
      ipm: ipm ? {
        beneficiaire_id: ipm.beneficiaryId,
        expected_part_ipm: ipm.expectedShare,
        documents: ipm.documents,
      } : null,
    },
    p_items: invoice.lines.map(({ article_id, name, quantity, unit_price, discount }) => ({
      article_id, name, quantity, unit_price, discount,
    })),
    p_payments: payments.map(payment => ({
      payment_method_id: payment.method_id || null,
      amount: payment.amount,
      reference: payment.reference || '',
    })),
    p_stock_site_id: invoice.stockSiteId,
    p_lot_assignments: Object.fromEntries(invoice.lots.map(selection => [
      selection.article_id,
      selection.assignments.filter(lot => lot.quantity > 0).map(lot => ({ lot_id: lot.lot_id, quantity: lot.quantity })),
    ])),
    p_request_id: requestId,
  });
  if (error) throw error;
  if (typeof data?.sale_id !== 'string' || typeof data?.sale_number !== 'string') {
    throw new Error('Résultat incertain. Relancez l’enregistrement depuis ce même brouillon.');
  }
  return { id: data.sale_id as string, number: data.sale_number as string };
}
