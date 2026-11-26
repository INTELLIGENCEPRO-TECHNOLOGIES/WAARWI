import { useEffect, useId, useRef, type ReactNode } from 'react';
import { BookOpen, ChevronDown, Coins, Loader2, Minus, Plus, Printer, Wallet, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useTopLayer } from '../modalStack';
import { formatDateTime } from '../../lib/format';
import { formatVatAmount, type VatAmounts } from '../../lib/salesVat';

import {ReturnLotFields} from './ReturnLotFields';
import type {ReturnLotLine} from '../../lib/returnLotAllocation';

export type ReturnLine = ReturnLotLine & {
  item_id: string;
  article_id: string | null;
  name: string;
  max_qty: number;
  quantity: number;
  unit_price: number;
  purchase_cost: number;
  selected: boolean;
};

type Origin = { id: string; reference: string; customer: string; total: number };

export function BillingReturnFields({ origins, saleId, lines, loading, loadError, reason, restock, busy, onSale, onRetry, onLine, onReason, onRestock }: {
  origins: Origin[];
  saleId: string;
  lines: ReturnLine[];
  loading: boolean;
  loadError: string | null;
  reason: string;
  restock: boolean;
  busy: boolean;
  onSale: (id: string) => void;
  onRetry: () => void;
  onLine: (id: string, values: Partial<Pick<ReturnLine, 'selected' | 'quantity' | 'lotQuantities'>>) => void;
  onReason: (value: string) => void;
  onRestock: (value: boolean) => void;
}) {
  const selectedOrigin = origins.find(origin => origin.id === saleId);
  return (
    <fieldset disabled={busy} className="min-w-0 space-y-5">
      <label className="block text-sm font-semibold">
        Vente d’origine <span aria-hidden="true">*</span>
        <span className="relative mt-1 block">
          <select required value={saleId} onChange={event => onSale(event.target.value)}
            className="min-h-11 w-full appearance-none border-b border-[var(--w-separator)] bg-transparent pr-7 text-base font-normal">
            <option value="">Choisir une vente</option>
            {origins.map(origin => <option key={origin.id} value={origin.id}>
              {origin.id === saleId ? origin.reference : `${origin.reference} · ${origin.customer}`}
            </option>)}
          </select>
          <ChevronDown size={16} className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2" />
        </span>
        {selectedOrigin && <span className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm font-normal text-[var(--w-text-secondary)]">
          <span className="min-w-0 break-words">{selectedOrigin.customer}</span>
          <span className="whitespace-nowrap tabular-nums">{formatVatAmount(selectedOrigin.total)}</span>
        </span>}
      </label>

      {saleId && (
        <section aria-label="Articles à retourner" aria-busy={loading}>
          <h2 className="mb-1.5 text-sm font-semibold">Articles à retourner</h2>
          {loading ? <p role="status" className="py-3 text-sm text-[var(--w-text-secondary)]">Chargement des articles…</p>
            : loadError ? <div className="py-2 text-sm">
              <p role="alert" className="text-red-700">{loadError}</p>
              <button type="button" className="min-h-10 font-medium underline underline-offset-4" onClick={onRetry}>Réessayer</button>
            </div>
            : lines.length === 0 ? <p className="py-2 text-sm text-[var(--w-text-secondary)]">Aucun article ne peut encore être retourné pour cette vente.</p>
            : <ul className="divide-y divide-[var(--w-separator-l)] border-y border-[var(--w-separator-l)]">
              {lines.map(line => {
                const step = line.max_qty < 1 ? line.max_qty : 1;
                const setQuantity = (value: number) => onLine(line.item_id, { quantity: Math.min(line.max_qty, Math.max(step, value)), lotQuantities: {} });
                return (
                  <li key={line.item_id} className="py-2">
                    <label className="flex min-h-11 items-center gap-3">
                      <input type="checkbox" className="h-5 w-5 shrink-0 accent-neutral-900" checked={line.selected}
                        onChange={event => onLine(line.item_id, { selected: event.target.checked })} />
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-sm font-semibold">{line.name}</span>
                        <span className="block text-xs text-[var(--w-text-secondary)]">Quantité restante&nbsp;: {line.max_qty}</span>
                      </span>
                    </label>
                    {line.selected && (
                      <div className="flex items-center justify-between gap-2 pl-8">
                        <div className="flex items-center" role="group" aria-label={`Quantité de ${line.name}`}>
                          <button type="button" aria-label={`Diminuer la quantité de ${line.name}`} disabled={line.quantity <= step}
                            onClick={() => setQuantity(line.quantity - step)} className="grid h-11 w-11 place-items-center disabled:opacity-30"><Minus size={16} /></button>
                          <input type="number" inputMode="decimal" min={step} max={line.max_qty} step="any"
                            aria-label={`Quantité de ${line.name}`} value={line.quantity}
                            onChange={event => setQuantity(Number(event.target.value))}
                            className="min-h-10 w-11 border-b border-[var(--w-separator)] bg-transparent text-center text-base tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
                          <button type="button" aria-label={`Augmenter la quantité de ${line.name}`} disabled={line.quantity >= line.max_qty}
                            onClick={() => setQuantity(line.quantity + step)} className="grid h-11 w-11 place-items-center disabled:opacity-30"><Plus size={16} /></button>
                        </div>
                        <span className="whitespace-nowrap text-sm font-semibold tabular-nums">{formatVatAmount(line.quantity * line.unit_price)}</span>
                      </div>
                    )}
                    {line.selected&&<div className="ml-8"><ReturnLotFields line={line} restock={restock} onChange={lotQuantities=>onLine(line.item_id,{lotQuantities})}/></div>}
                  </li>
                );
              })}
            </ul>}
        </section>
      )}

      <label className="block text-sm font-semibold">
        Motif
        <textarea value={reason} onChange={event => onReason(event.target.value)} rows={2}
          className="mt-1 block w-full resize-y border-b border-[var(--w-separator)] bg-transparent py-2 text-base font-normal"
          placeholder="Indiquer le motif du retour" />
      </label>
      <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
        <input type="checkbox" checked={restock} onChange={event => onRestock(event.target.checked)} className="h-5 w-5 shrink-0 accent-neutral-900" />
        Remettre les articles en stock
      </label>
    </fieldset>
  );
}

export function MobileReturnScreen({ title, subtitle, badge, onClose, busy, children, footer }: {
  title: string;
  subtitle?: string;
  badge?: string;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const headingId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const { isTop, zIndex } = useTopLayer(true);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return createPortal(
    <div ref={screen} role="dialog" aria-modal="true" aria-labelledby={headingId}
      className="billing-return-screen fixed inset-0 flex flex-col bg-[var(--w-surface)] text-[var(--w-text)]"
      style={{ zIndex }}
      onKeyDown={event => {
        if (!isTop) return;
        if (event.key === 'Escape' && !busy) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
        if (event.key !== 'Tab') return;
        const focusable = Array.from(screen.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)') ?? [])
          .filter(element => element.getClientRects().length > 0 && !element.closest('fieldset:disabled'));
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }}>
      <header className="billing-return-header flex shrink-0 items-center gap-2 border-b border-[var(--w-separator)] px-3 py-2">
        <button ref={closeButton} type="button" aria-label="Fermer" disabled={busy} onClick={onClose}
          className="grid h-11 w-11 shrink-0 place-items-center hover:bg-[var(--w-hover)] disabled:opacity-40"><X size={19} /></button>
        <div className="min-w-0 flex-1">
          <h1 id={headingId} className="text-base font-semibold leading-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 text-xs text-[var(--w-text-secondary)]">{subtitle}</p>}
        </div>
        {badge && <span className="shrink-0 text-xs font-medium text-[var(--w-text-secondary)]">{badge}</span>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
      {footer && <footer className="billing-return-footer shrink-0 space-y-2 border-t border-[var(--w-separator)] bg-[var(--w-surface)] px-4 py-3">{footer}</footer>}
    </div>,
    document.body,
  );
}

const mobileAction = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold disabled:opacity-50';

export function MobileReturnDetail({ document, status, items, loading, loadError, error, busy, confirmingCash, canProcess, canPost, onClose, onPrint, onRetry, onCash, onCancelCash, onConfirmCash, onCredit, onPost }: {
  document: VatAmounts & {
    return_number: string;
    customer_id: string | null;
    customers: { name: string } | null;
    sales: { sale_number: string } | null;
    created_at: string;
    refunded_at?: string | null;
    refund_method: string;
    status: string;
    total: number;
    credit_used?: number;
    restock: boolean;
    reason: string;
    vat_entry_id?: string | null;
  };
  status: string;
  items: { id: string; name: string; quantity: number; unit_price: number; total: number; articles?: { internal_ref?: string; oem_ref?: string } | null }[];
  loading: boolean;
  loadError: string | null;
  error: string | null;
  busy: boolean;
  confirmingCash: boolean;
  canProcess: boolean;
  canPost: boolean;
  onClose: () => void;
  onPrint: () => void;
  onRetry: () => void;
  onCash: () => void;
  onCancelCash: () => void;
  onConfirmCash: () => void;
  onCredit: () => void;
  onPost: () => void;
}) {
  const isCredit = document.refund_method === 'avoir';
  const pending = document.status === 'pending';
  const approved = document.status === 'approved';
  const fiscal = document.vat_net_amount != null;
  const used = Number(document.credit_used ?? 0);
  const total = Number(document.total);
  const rows = [
    ...(fiscal ? [
      { label: 'Total HT', amount: formatVatAmount(document.vat_net_amount) },
      { label: 'TVA', amount: formatVatAmount(document.vat_amount) },
    ] : []),
    { label: fiscal ? 'Total TTC' : 'Total', amount: formatVatAmount(total) },
    ...(isCredit && approved ? [
      { label: 'Montant utilisé', amount: formatVatAmount(used) },
      { label: 'Avoir disponible', amount: formatVatAmount(Math.max(0, total - used)) },
    ] : []),
  ];

  return (
    <MobileReturnScreen title={confirmingCash ? 'Rembourser en caisse' : `${isCredit ? 'Avoir' : 'Retour'} ${document.return_number}`}
      subtitle={confirmingCash ? document.return_number : undefined} badge={confirmingCash ? undefined : status}
      onClose={confirmingCash ? onCancelCash : onClose} busy={busy}
      footer={<>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {confirmingCash ? (
          <div className="flex items-center gap-2">
            <button type="button" onClick={onCancelCash} disabled={busy} className={mobileAction}>Annuler</button>
            <button type="button" onClick={onConfirmCash} disabled={busy} className={`${mobileAction} flex-1 bg-neutral-900 text-white`}>
              {busy && <Loader2 size={16} className="animate-spin" />} Confirmer le remboursement
            </button>
          </div>
        ) : <div className="flex flex-wrap items-center gap-2">
          {pending && canProcess && (
            <>
              <button type="button" onClick={onCash} disabled={busy} className={`${mobileAction} bg-neutral-900 text-white`}><Coins size={16} /> Rembourser</button>
              {document.customer_id && <button type="button" onClick={onCredit} disabled={busy} className={`${mobileAction} hover:bg-[var(--w-hover)]`}><Wallet size={16} /> Créer un avoir</button>}
            </>
          )}
          {fiscal && approved && (document.vat_entry_id
            ? <span className="inline-flex min-h-11 items-center gap-2 text-sm"><BookOpen size={16} /> Comptabilisé</span>
            : canPost && <button type="button" onClick={onPost} disabled={busy} className={`${mobileAction} hover:bg-[var(--w-hover)]`}><BookOpen size={16} /> Comptabiliser</button>)}
          {busy && <span role="status" className="inline-flex items-center gap-1.5 text-xs"><Loader2 size={14} className="animate-spin" /> Traitement…</span>}
          <button type="button" onClick={onPrint} aria-label="Imprimer" title="Imprimer" disabled={loading || !!loadError || busy}
            className={`${mobileAction} ml-auto border border-[var(--w-separator)]`}><Printer size={17} /></button>
        </div>}
      </>}>
      {confirmingCash ? (
        <div className="space-y-3">
          <p className="text-sm text-[var(--w-text-secondary)]">Le remboursement sera enregistré comme sortie de caisse.</p>
          <p className="text-2xl font-semibold tabular-nums">{formatVatAmount(total)}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1 border-b border-[var(--w-separator-l)] pb-3">
            <p className="text-sm font-semibold">{document.customers?.name || 'Client comptoir'}</p>
            {document.sales?.sale_number && <p className="text-sm text-[var(--w-text-secondary)]">Vente d’origine · {document.sales.sale_number}</p>}
            <p className="text-xs text-[var(--w-text-secondary)]">{formatDateTime(document.created_at)}</p>
          </div>
          <section aria-label="Articles retournés" aria-busy={loading}>
            <h2 className="text-sm font-semibold">Articles retournés</h2>
            {loading ? <p role="status" className="py-2 text-sm">Chargement des articles…</p>
              : loadError ? <div className="py-2 text-sm">
                <p role="alert" className="text-red-700">{loadError}</p>
                <button type="button" onClick={onRetry} className="min-h-10 underline underline-offset-4">Réessayer</button>
              </div>
              : <ul className="divide-y divide-[var(--w-separator-l)]">
                {items.map(item => (
                  <li key={item.id} className="flex items-end justify-between gap-2 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="break-words">{item.name}</p>
                      {(item.articles?.internal_ref || item.articles?.oem_ref) && <p className="text-xs text-[var(--w-text-secondary)]">{[item.articles.internal_ref, item.articles.oem_ref].filter(Boolean).join(' · ')}</p>}
                      <p className="text-xs text-[var(--w-text-secondary)]">{item.quantity} × {formatVatAmount(item.unit_price)}{fiscal ? ' HT' : ''}</p>
                    </div>
                    <span className="whitespace-nowrap font-semibold tabular-nums">{formatVatAmount(item.total)}</span>
                  </li>
                ))}
              </ul>}
          </section>
          <dl className="space-y-1.5 border-t border-[var(--w-separator)] pt-3 text-sm">
            {rows.map((row, index) => (
              <div key={row.label} className={`flex justify-between gap-2 ${index === rows.length - 1 ? 'font-semibold' : ''}`}>
                <dt>{row.label}</dt><dd className="whitespace-nowrap tabular-nums">{row.amount}</dd>
              </div>
            ))}
          </dl>
          <div className="space-y-2 border-t border-[var(--w-separator-l)] pt-3 text-sm text-[var(--w-text-secondary)]">
            {approved && !isCredit && document.refund_method === 'cash' && <p>Remboursé en caisse{document.refunded_at ? ` · ${formatDateTime(document.refunded_at)}` : ''}</p>}
            {document.reason && <p><span className="font-semibold">Motif</span> · {document.reason}</p>}
            <p>{document.restock ? 'Articles remis en stock' : 'Sans remise en stock'}</p>
          </div>
        </div>
      )}
    </MobileReturnScreen>
  );
}
