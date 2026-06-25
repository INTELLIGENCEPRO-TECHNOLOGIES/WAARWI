/**
 * DocLayout — Système d'affichage documentaire universel
 *
 * Composants exportés :
 *   DocSlimHeader    — En-tête compact pour modals (statut + client + date sur 1 ligne)
 *   DocHeader        — En-tête complet pour pages publiques (type, numéro, méta-grille)
 *   DocItems         — Liste articles responsive (cartes mobile / tableau desktop)
 *   DocTotals        — Récapitulatif financier (sous-total, remise, TVA, total)
 *   DocPayments      — Détail des paiements reçus
 *   DocStatusBadge   — Badge de statut premium cohérent
 */

import { ChevronRight, CalendarDays, Tag, ShieldCheck, User, Smartphone, Clock } from 'lucide-react';
import { formatFCFA } from '../lib/format';
import { computeWarrantyExpiry } from '../lib/print';

/* ─────────────────────────────────────────────────────────────────────────────
 * Types
 * ─────────────────────────────────────────────────────────────────────────── */
export interface DocItem {
  id?: string;
  name: string;
  internal_ref?: string | null;
  oem_ref?: string | null;
  supplier_ref?: string | null;
  quantity: number;
  unit_price: number;
  discount?: number;
  total: number;
  /** Pour les réceptions fournisseurs */
  quantity_received?: number;
  quantity_ordered?: number;
}

export interface DocPayment {
  method_name: string;
  amount: number;
  paid_at?: string | null;
}

export interface DocStatusConfig {
  label: string;
  color: 'slate' | 'amber' | 'emerald' | 'blue' | 'rose' | 'teal';
  dot?: boolean;
  pulse?: boolean;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Couleurs de statut
 * ─────────────────────────────────────────────────────────────────────────── */
const STATUS_COLORS: Record<DocStatusConfig['color'], { bg: string; text: string; border: string; dot: string }> = {
  slate:   { bg: 'bg-neutral-100',  text: 'text-neutral-700',  border: 'border-neutral-200', dot: 'bg-neutral-500' },
  amber:   { bg: 'bg-amber-50',     text: 'text-amber-800',    border: 'border-amber-200',   dot: 'bg-amber-500' },
  emerald: { bg: 'bg-neutral-100',  text: 'text-neutral-800',  border: 'border-neutral-200', dot: 'bg-neutral-900' },
  blue:    { bg: 'bg-neutral-50',   text: 'text-neutral-800',  border: 'border-neutral-200', dot: 'bg-neutral-900' },
  rose:    { bg: 'bg-rose-50',      text: 'text-rose-800',     border: 'border-rose-200',    dot: 'bg-rose-500' },
  teal:    { bg: 'bg-neutral-100',  text: 'text-neutral-800',  border: 'border-neutral-300', dot: 'bg-neutral-900' },
};

/* ─────────────────────────────────────────────────────────────────────────────
 * DocStatusBadge
 * ─────────────────────────────────────────────────────────────────────────── */
export function DocStatusBadge({ label, color, pulse }: DocStatusConfig) {
  const c = STATUS_COLORS[color];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider border ${c.bg} ${c.text} ${c.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot} shrink-0 ${pulse ? 'animate-pulse' : ''}`} />
      {label}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * DocSlimHeader — en-tête compact pour modals
 * ─────────────────────────────────────────────────────────────────────────── */
export interface DocHeaderMeta {
  delivery_date?: string | null;
  reference?: string | null;
  warranty?: string | null;
  imei?: string | null;
  representative?: string | null;
  created_at?: string | null;
}

interface DocSlimHeaderProps {
  status?: DocStatusConfig;
  customerName?: string | null;
  date?: string;
  extra?: string;
  docHeader?: DocHeaderMeta | null;
}

export function DocSlimHeader({ status, customerName, date, extra, docHeader }: DocSlimHeaderProps) {
  const metaPills: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; color: string }[] = [];
  if (docHeader?.reference)      metaPills.push({ icon: Tag,          label: 'Ref.',         value: docHeader.reference, color: 'bg-amber-50 border-amber-200 text-amber-800' });
  if (docHeader?.delivery_date)  metaPills.push({ icon: CalendarDays, label: 'Livraison',     value: new Date(docHeader.delivery_date).toLocaleDateString('fr-FR'), color: 'bg-neutral-50 border-neutral-200 text-neutral-800' });
  if (docHeader?.warranty)       metaPills.push({ icon: ShieldCheck,  label: 'Garantie',      value: docHeader.warranty, color: 'bg-neutral-100 border-neutral-200 text-neutral-800' });
  if (docHeader?.warranty && docHeader?.created_at) {
    const expiry = computeWarrantyExpiry(docHeader.created_at, docHeader.warranty);
    if (expiry) metaPills.push({ icon: Clock, label: 'Expire le', value: expiry, color: 'bg-neutral-50 border-neutral-200 text-neutral-700' });
  }
  if (docHeader?.imei)           metaPills.push({ icon: Smartphone,   label: 'IMEI',          value: docHeader.imei, color: 'bg-neutral-50 border-neutral-200 text-neutral-800' });
  if (docHeader?.representative) metaPills.push({ icon: User,         label: 'Representant',  value: docHeader.representative, color: 'bg-neutral-50 border-neutral-200 text-neutral-700' });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap py-1">
        {status && <DocStatusBadge {...status} />}
        {customerName !== undefined && (
          <span className="text-[12px] font-semibold text-neutral-700 break-words">
            {customerName || 'Comptoir'}
          </span>
        )}
        {(date || extra) && (
          <span className="ml-auto text-[11px] text-neutral-400 font-medium whitespace-nowrap num">
            {extra ? `${extra} · ` : ''}{date}
          </span>
        )}
      </div>
      {metaPills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {metaPills.map(({ icon: Icon, label, value, color }) => (
            <span key={label} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium ${color}`}>
              <Icon className="w-3 h-3 shrink-0 opacity-70" />
              <span className="font-semibold opacity-60">{label} :</span>
              <span>{value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * DocHeader — en-tête complet pour pages publiques
 * ─────────────────────────────────────────────────────────────────────────── */
interface DocHeaderProps {
  docType: string;
  docNumber: string;
  date: string;
  status?: DocStatusConfig;
  customerLabel?: string;
  customerName?: string | null;
  extra?: { label: string; value: string }[];
  /** Si fourni, affiche un bouton lien public */
  publicUrl?: string | null;
}

export function DocHeader({ docType, docNumber, date, status, customerLabel = 'Client', customerName, extra, publicUrl }: DocHeaderProps) {
  return (
    <div className="space-y-3">
      {/* Type + numéro + statut */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-neutral-400">{docType}</div>
          <div className="text-[18px] font-black text-neutral-900 leading-tight tracking-tight num">{docNumber}</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {status && <DocStatusBadge {...status} />}
          {publicUrl && (
            <a
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold text-teal-700 bg-teal-50 border border-teal-200"
            >
              Lien public <ChevronRight className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>

      {/* Méta */}
      <div className="grid grid-cols-2 gap-2">
        <MetaCell label="Date" value={date} />
        {customerName !== undefined && (
          <MetaCell label={customerLabel} value={customerName || 'Comptoir'} />
        )}
        {extra?.map(e => (
          <MetaCell key={e.label} label={e.label} value={e.value} />
        ))}
      </div>
    </div>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-2 rounded-xl bg-neutral-50 border border-neutral-200/80">
      <div className="text-[9px] font-bold uppercase tracking-wider text-neutral-400 mb-0.5">{label}</div>
      <div className="text-[12px] font-semibold text-neutral-800 leading-tight break-words">{value}</div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * DocItems — cœur du système
 * Mobile  : cartes compactes premium (toujours)
 * Desktop : tableau (si écran suffisant)
 * ─────────────────────────────────────────────────────────────────────────── */
interface DocItemsProps {
  items: DocItem[];
  /** Mode fournisseur : affiche qté reçue vs commandée */
  showReceived?: boolean;
  /** Libellé colonne qté (défaut "Qté") */
  qtyLabel?: string;
}

export function DocItems({ items, showReceived = false, qtyLabel = 'Qté' }: DocItemsProps) {
  if (items.length === 0) {
    return (
      <div className="py-6 text-center text-[12px] text-neutral-400 font-medium">Aucun article</div>
    );
  }

  return (
    <div>
      {/* ── MOBILE CARDS (< md) ─────────────────────────────────────────── */}
      <div className="md:hidden space-y-2">
        {items.map((item, idx) => {
          const lineTotal = item.total ?? (item.quantity * item.unit_price - (item.discount ?? 0));
          const ref = item.supplier_ref || item.internal_ref;
          return (
            <div
              key={item.id ?? idx}
              className="rounded-xl bg-white border border-neutral-200 overflow-hidden"
              style={{ boxShadow: '0 1px 3px rgba(15,23,42,0.06)' }}
            >
              {/* Nom de l'article — max 2 lignes */}
              <div className="px-3 pt-2.5 pb-1.5">
                <div
                  className="text-[13px] font-bold text-neutral-900 leading-snug"
                  style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                >
                  {item.name}
                </div>
                {ref && (
                  <div className="text-[10px] font-mono text-neutral-400 mt-0.5 truncate">
                    {item.supplier_ref ? `Fournisseur : ${ref}` : `Réf : ${ref}`}
                  </div>
                )}
                {item.oem_ref && (
                  <div className="text-[10px] font-mono text-neutral-400 truncate">OEM : {item.oem_ref}</div>
                )}
              </div>

              {/* Ligne quantité / PU / Total — Qté compact, PU et Total prennent l'espace */}
              <div className="flex divide-x divide-slate-100 border-t border-neutral-100">
                {/* Qté — largeur fixe compacte */}
                <div className="px-2.5 py-2 shrink-0" style={{ width: '52px' }}>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-neutral-400 mb-0.5">{qtyLabel}</div>
                  <div className="text-[13px] font-bold text-neutral-800 num leading-none">
                    {showReceived && item.quantity_ordered != null
                      ? `${item.quantity_received ?? 0}/${item.quantity_ordered}`
                      : item.quantity}
                  </div>
                </div>
                {/* Prix unit. — flex-1 */}
                <div className="px-2.5 py-2 flex-1 min-w-0">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-neutral-400 mb-0.5">Prix unit.</div>
                  <div className="text-[12px] font-semibold text-neutral-700 num leading-none whitespace-nowrap overflow-hidden text-ellipsis">
                    {formatFCFA(item.unit_price)}
                  </div>
                </div>
                {/* Total — flex-1, fond légèrement teinté, priorité visuelle maximale */}
                <div className="px-2.5 py-2 flex-1 min-w-0 bg-neutral-50/60">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-neutral-400 mb-0.5">Total</div>
                  <div className="text-[14px] font-black text-neutral-900 num leading-none whitespace-nowrap overflow-hidden text-ellipsis">
                    {formatFCFA(lineTotal)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── DESKTOP TABLE (≥ md) ────────────────────────────────────────── */}
      <div className="hidden md:block rounded-xl border border-neutral-200 overflow-hidden">
        <table className="w-full text-sm table-fixed">
          <thead className="bg-neutral-50 border-b border-neutral-200">
            <tr>
              <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-neutral-500 w-[52%]">Article</th>
              <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-neutral-500 w-[10%]">{qtyLabel}</th>
              <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-neutral-500 w-[19%]">Prix unit.</th>
              <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-neutral-500 w-[19%]">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item, idx) => {
              const lineTotal = item.total ?? (item.quantity * item.unit_price - (item.discount ?? 0));
              const ref = item.supplier_ref || item.internal_ref;
              return (
                <tr key={item.id ?? idx} className="hover:bg-neutral-50/50 transition-colors">
                  <td className="px-4 py-3 align-top">
                    <div className="text-[13px] font-semibold text-neutral-900 leading-snug">{item.name}</div>
                    {ref && <div className="text-[10px] font-mono text-neutral-400 mt-0.5">{ref}</div>}
                    {item.oem_ref && <div className="text-[10px] font-mono text-neutral-400">OEM : {item.oem_ref}</div>}
                  </td>
                  <td className="px-4 py-3 text-right text-[13px] text-neutral-700 num align-top font-medium">
                    {showReceived && item.quantity_ordered != null
                      ? `${item.quantity_received ?? 0}/${item.quantity_ordered}`
                      : item.quantity}
                  </td>
                  <td className="px-4 py-3 text-right text-[13px] text-neutral-700 num align-top font-medium whitespace-nowrap">
                    {formatFCFA(item.unit_price)}
                  </td>
                  <td className="px-4 py-3 text-right text-[14px] font-bold text-neutral-900 num align-top whitespace-nowrap">
                    {formatFCFA(lineTotal)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * DocTotals
 * ─────────────────────────────────────────────────────────────────────────── */
interface DocTotalsProps {
  subtotal: number;
  discount?: number;
  tax?: number;
  total: number;
  /** Label du total (défaut "Total à payer") */
  totalLabel?: string;
  /** Montant déjà payé */
  paid?: number;
  /** Montant restant dû */
  remaining?: number;
}

export function DocTotals({ subtotal, discount = 0, tax = 0, total, totalLabel = 'Total à payer', paid, remaining }: DocTotalsProps) {
  return (
    <div className="rounded-xl border border-neutral-200 overflow-hidden">
      {discount > 0 && (
        <TotalsRow label="Sous-total" value={formatFCFA(subtotal)} />
      )}
      {discount > 0 && (
        <TotalsRow label="Remise" value={`– ${formatFCFA(discount)}`} valueClass="text-rose-600" />
      )}
      {tax > 0 && (
        <TotalsRow label="TVA" value={formatFCFA(tax)} />
      )}
      <div className="flex items-center justify-between px-4 py-3.5 bg-neutral-900">
        <span className="text-[12px] font-bold uppercase tracking-wider text-white/70">{totalLabel}</span>
        <span className="text-[18px] font-black text-white num whitespace-nowrap">{formatFCFA(total)}</span>
      </div>
      {paid !== undefined && paid > 0 && (
        <TotalsRow label="Déjà payé" value={formatFCFA(paid)} valueClass="text-emerald-700" />
      )}
      {remaining !== undefined && remaining > 0 && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-rose-50 border-t border-rose-100">
          <span className="text-[11px] font-bold uppercase tracking-wider text-rose-700">Reste à payer</span>
          <span className="text-[15px] font-black text-rose-700 num whitespace-nowrap">{formatFCFA(remaining)}</span>
        </div>
      )}
    </div>
  );
}

function TotalsRow({ label, value, valueClass = 'text-neutral-900' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-100 last:border-0">
      <span className="text-[11px] font-medium text-neutral-500">{label}</span>
      <span className={`text-[13px] font-bold num whitespace-nowrap ${valueClass}`}>{value}</span>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * DocPayments
 * ─────────────────────────────────────────────────────────────────────────── */
interface DocPaymentsProps {
  payments: DocPayment[];
  formatDate?: (d: string) => string;
}

export function DocPayments({ payments, formatDate }: DocPaymentsProps) {
  if (payments.length === 0) return null;
  return (
    <div className="rounded-xl border border-neutral-200 overflow-hidden">
      <div className="px-4 py-2.5 bg-neutral-50 border-b border-neutral-200">
        <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Paiements reçus</div>
      </div>
      {payments.map((p, idx) => (
        <div key={idx} className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-100 last:border-0">
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-neutral-800">{p.method_name}</div>
            {p.paid_at && formatDate && (
              <div className="text-[10px] text-neutral-400 mt-0.5">{formatDate(p.paid_at)}</div>
            )}
          </div>
          <span className="text-[13px] font-bold text-emerald-700 num whitespace-nowrap ml-4">
            {formatFCFA(p.amount)}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * DocSectionTitle — titre de section uniforme
 * ─────────────────────────────────────────────────────────────────────────── */
export function DocSectionTitle({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center justify-between">
      <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">{title}</div>
      {count !== undefined && (
        <span className="text-[10px] font-bold text-neutral-400 num">{count}</span>
      )}
    </div>
  );
}
