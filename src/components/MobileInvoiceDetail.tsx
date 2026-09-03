import {
  X, Printer, Link2, MessageCircle, Pencil,
  Coins, BookOpen, Loader2, Ban, Trash2, User, Calendar,
} from 'lucide-react';
import { formatFCFA, formatDate } from '../lib/format';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon', validated: 'Validée', paid: 'Payée',
  partial: 'Partielle', cancelled: 'Annulée',
};
const STATUS_COLORS: Record<string, string> = {
  draft: 'text-slate-500', validated: 'text-neutral-700', paid: 'text-emerald-600',
  partial: 'text-amber-600', cancelled: 'text-red-600',
};

type InvoiceItem = {
  article_id: string | null;
  name: string;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
};

type PaymentLine = {
  method_name: string;
  amount: number;
};

type Props = {
  invoice: {
    id: string;
    sale_number: string;
    total: number;
    paid: number;
    status: string;
    created_at: string;
    customer_id?: string | null;
    accounting_status?: string;
    customers: { name: string } | null;
  };
  items: InvoiceItem[];
  payments: PaymentLine[];
  docHeader?: {
    doc_date?: string | null;
    reference?: string | null;
    delivery_date?: string | null;
    warranty?: string | null;
    representative?: string | null;
    imei?: string | null;
  } | null;
  onClose: () => void;
  onEdit?: () => void;
  onPay?: () => void;
  onPrint?: () => void;
  onCopyLink?: () => void;
  onWhatsApp?: () => void;
  onComptabiliser?: () => void;
  onCancel?: () => void;
  onDelete?: () => void;
  accountingBusy?: boolean;
};

export function MobileInvoiceDetail({
  invoice,
  items,
  payments,
  docHeader,
  onClose,
  onEdit,
  onPay,
  onPrint,
  onCopyLink,
  onWhatsApp,
  onComptabiliser,
  onCancel,
  onDelete,
  accountingBusy,
}: Props) {
  const stLabel = STATUS_LABELS[invoice.status] || invoice.status;
  const stColor = STATUS_COLORS[invoice.status] || 'text-slate-500';
  const customerName = invoice.customers?.name || 'Client comptoir';
  const due = Math.max(0, Number(invoice.total) - Number(invoice.paid));
  const validItems = items.filter(i => i.name.trim());
  const subtotal = validItems.reduce((s, i) => s + Number(i.total), 0);
  const isAccounted = invoice.accounting_status === 'accounted';
  const isCancelled = invoice.status === 'cancelled';

  return (
    <div className="fixed inset-0 z-[55] bg-white flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-neutral-200 shrink-0">
        <button onClick={onClose} className="p-1"><X className="w-5 h-5 text-neutral-700" /></button>
        <div className="text-center flex-1 min-w-0">
          <div className="text-sm font-bold text-neutral-900 truncate">{invoice.sale_number}</div>
        </div>
        <span className={`text-xs font-semibold ${stColor}`}>{stLabel}</span>
      </div>

      {/* Invoice info */}
      <div className="px-4 py-3 border-b border-neutral-100 space-y-1">
        <div className="flex items-center gap-2 text-xs text-neutral-700">
          <User className="w-3.5 h-3.5 text-neutral-400" />
          <span className="font-medium">{customerName}</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-neutral-500">
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {formatDate(docHeader?.doc_date || invoice.created_at)}
          </span>
          {isAccounted && (
            <span className="flex items-center gap-1 text-emerald-600 font-medium">
              <BookOpen className="w-3 h-3" /> Comptabilisée
            </span>
          )}
        </div>
        {docHeader?.reference && (
          <div className="text-xs text-neutral-500">Réf : {docHeader.reference}</div>
        )}
        {docHeader?.delivery_date && (
          <div className="text-xs text-neutral-500">Livraison : {formatDate(docHeader.delivery_date)}</div>
        )}
        {docHeader?.warranty && (
          <div className="text-xs text-neutral-500">Garantie : {docHeader.warranty}</div>
        )}
        {docHeader?.imei && (
          <div className="text-xs text-neutral-400 font-mono">IMEI : {docHeader.imei}</div>
        )}
        {docHeader?.representative && (
          <div className="text-xs text-neutral-500">Représentant : {docHeader.representative}</div>
        )}
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto">
        <div className="divide-y divide-neutral-100">
          {validItems.map((item, idx) => (
            <div key={idx} className="px-4 py-2.5">
              <div className="text-sm font-medium text-neutral-800">{item.name}</div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-neutral-500">
                  {item.quantity} x {formatFCFA(item.unit_price)}
                  {item.discount > 0 && <span className="text-amber-600 font-medium ml-2">-{formatFCFA(item.discount)}</span>}
                </span>
                <span className="text-sm font-bold text-neutral-900 num">{formatFCFA(item.total)}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="px-4 py-3 border-t border-neutral-100 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span>Sous-total</span>
            <span className="num font-semibold">{formatFCFA(subtotal)}</span>
          </div>
          <div className="flex items-center justify-between text-sm font-bold text-neutral-900">
            <span>Total</span>
            <span className="num">{formatFCFA(invoice.total)}</span>
          </div>
          {Number(invoice.paid) > 0 && (
            <div className="flex items-center justify-between text-xs text-emerald-600 font-medium">
              <span>Payé</span>
              <span className="num">{formatFCFA(invoice.paid)}</span>
            </div>
          )}
          {due > 0 && (
            <div className="flex items-center justify-between text-xs text-amber-600 font-bold">
              <span>Solde restant</span>
              <span className="num">{formatFCFA(due)}</span>
            </div>
          )}
        </div>

        {/* Payments */}
        {payments.length > 0 && (
          <div className="px-4 py-2.5 border-t border-neutral-100">
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold mb-1.5">Paiements</div>
            <div className="space-y-1">
              {payments.map((p, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-neutral-600">{p.method_name}</span>
                  <span className="text-neutral-900 font-semibold num">{formatFCFA(p.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="border-t border-neutral-200 px-4 py-3 shrink-0 bg-white">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-neutral-500">{validItems.length} article{validItems.length > 1 ? 's' : ''}</span>
          <span className="text-base font-extrabold text-neutral-900 num">{formatFCFA(invoice.total)}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {onEdit && !isCancelled && !isAccounted && (
            <button onClick={onEdit} className="btn-icon" title="Modifier"><Pencil className="w-4 h-4" /></button>
          )}
          {onPay && due > 0 && !isCancelled && (
            <button onClick={onPay} className="btn-icon" title="Encaisser"><Coins className="w-4 h-4" /></button>
          )}
          {onComptabiliser && !isAccounted && !isCancelled && (
            <button onClick={onComptabiliser} disabled={accountingBusy} className="btn-icon" title="Comptabiliser">
              {accountingBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4" />}
            </button>
          )}
          {onCopyLink && (
            <button onClick={onCopyLink} className="btn-icon" title="Copier le lien"><Link2 className="w-4 h-4" /></button>
          )}
          {onWhatsApp && (
            <button onClick={onWhatsApp} className="btn-icon" title="WhatsApp"><MessageCircle className="w-4 h-4" /></button>
          )}
          {onCancel && !isCancelled && !isAccounted && (
            <button onClick={onCancel} className="btn-icon-danger" title="Annuler"><Ban className="w-4 h-4" /></button>
          )}
          {onDelete && !isAccounted && (
            <button onClick={onDelete} className="btn-icon-danger" title="Supprimer"><Trash2 className="w-4 h-4" /></button>
          )}
          <span className="flex-1" />
          {onPrint && (
            <button onClick={onPrint} className="btn-icon-primary" title="Imprimer"><Printer className="w-4 h-4" /></button>
          )}
        </div>
      </div>
    </div>
  );
}
