import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search, Plus, Minus, Trash2, ShoppingCart, CreditCard, Loader2,
  Package, X, User, Check, LogOut, Lock, Printer, BarChart2,
  ChevronRight, ChevronLeft, AlertTriangle, ArrowRight, Pause, RotateCcw,
  FileText, List, LayoutGrid, Play, Car, Tag, Flame, ArrowDownAZ, CheckCircle2, Wallet, ArrowDownRight, ArrowUpRight, Banknote,
  Globe, Truck, ShoppingBag, Zap, ArrowRightCircle, Clock as ClockIcon, Phone, MapPin, AlertCircle
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { usePermissions } from '../lib/permissions';
import { useToast } from '../context/ToastContext';
import { formatFCFA } from '../lib/format';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { SearchableSelect } from '../components/SearchableSelect';
import { VehicleArticlePicker } from '../components/VehicleArticlePicker';
import { POSGuide, POSGuideCardTrigger, POSGuideInlineTrigger } from '../components/POSGuide';
import { isAutoParts } from '../lib/types';
import { desktopAutoFocus } from '../lib/device';
import { printTicket80 as printTicket80Shared, printReturnTicket80 as printReturnTicket80Shared, printDocumentA4, printXReport80, type PrintTenant } from '../lib/print';
import type { CartItem, PaymentMethod, Customer, CashSession, SalePayment } from '../lib/types';
import { peekNavContext, consumeNavContext } from '../lib/navHighlight';
import { LotPickerModal, type ArticleLotSelection } from '../components/LotPickerModal';

type ArticleLite = {
  id: string; internal_ref: string; name: string; oem_ref: string;
  sale_price: number; purchase_price: number; stock_available: number;
  category_id: string | null; image_url: string | null;
};

type ArticleTier = { article_id: string; tier_name: string; price: number };

type CategoryLite = { id: string; name: string; parent_id: string | null };

type ControlLine = {
  payment_method_id: string | null;
  method_name: string;
  theoretical_amount: number;
  counted_amount: number;
};

type CloseStep = 'control' | 'regularize' | 'confirm';

type HeldCart = {
  id: string;
  label: string;
  cart: CartItem[];
  customer: Customer | null;
  discount: number;
  savedAt: string;
};

type SessionSale = {
  id: string;
  sale_number: string;
  total: number;
  created_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  status: string;
  items: { article_id: string; name: string; quantity: number; unit_price: number; returned?: number }[];
  fullyReturned?: boolean;
};

function printXReport(
  session: CashSession & { opening_note?: string; closing_note?: string },
  controls: ControlLine[],
  salesStats: {
    count: number; total: number;
    byMethod: { method_name: string; amount: number }[];
    topArticles: { name: string; qty: number; total: number }[];
    movements?: { kind: 'expense' | 'income' | 'customer_prepayment'; amount: number; reason: string; method_name: string; customer_name: string | null }[];
    movExpense?: number; movIncome?: number; movPrepay?: number; netTotal?: number;
  },
  regularizations: { reg_type: string; amount: number; reason: string }[],
  tenantArg: { name: string; ninea?: string; rccm?: string; address?: string },
  cashier: string,
  siteName: string
) {
  printXReport80({
    tenant: tenantArg as PrintTenant,
    cashier,
    siteName,
    sessionId: session.id,
    openedAt: session.opened_at,
    closedAt: session.closed_at,
    openingAmount: Number(session.opening_amount),
    salesCount: salesStats.count,
    salesTotal: salesStats.total,
    byMethod: salesStats.byMethod,
    movements: salesStats.movements,
    controls: controls.map(c => ({
      method_name: c.method_name,
      theoretical_amount: c.theoretical_amount,
      counted_amount: c.counted_amount,
    })),
    regularizations,
    topArticles: salesStats.topArticles,
  });
}

// ─── POS Landing Screens (Desktop-first) ──────────────────────────────────────

type LandingSite = { id: string; name: string } | null;
type RecentSession = {
  id: string; opened_at: string; closed_at: string | null;
  opening_amount: number; closing_amount: number | null; status: string;
};
type DaySummary = {
  salesCount: number; salesTotal: number;
  byMethod: { method_name: string; amount: number }[];
};

function useDaySummary(tenantId?: string, siteId?: string, sessionId?: string) {
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!tenantId || !siteId || !sessionId) return;
    setLoading(true);
    (async () => {
      const [{ data: sales }, { data: payments }] = await Promise.all([
        supabase
          .from('sales')
          .select('id, total')
          .eq('tenant_id', tenantId)
          .eq('cash_session_id', sessionId)
          .neq('status', 'cancelled'),
        supabase
          .from('sale_payments')
          .select('method_name, amount')
          .eq('tenant_id', tenantId)
          .eq('cash_session_id', sessionId),
      ]);
      const salesArr = sales || [];
      const paymentsArr = (payments || []) as { method_name: string; amount: number }[];
      const byMethod: Record<string, number> = {};
      let totalPaid = 0;
      for (const p of paymentsArr) {
        const amt = Number(p.amount);
        byMethod[p.method_name] = (byMethod[p.method_name] || 0) + amt;
        totalPaid += amt;
      }
      setSummary({
        salesCount: salesArr.length,
        salesTotal: totalPaid,
        byMethod: Object.entries(byMethod).map(([method_name, amount]) => ({ method_name, amount })),
      });
      setLoading(false);
    })();
  }, [tenantId, siteId, sessionId]);
  return { summary, loading };
}

function useRecentSessions(tenantId?: string, siteId?: string, excludeId?: string) {
  const [sessions, setSessions] = useState<RecentSession[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!tenantId || !siteId) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('cash_sessions')
        .select('id, opened_at, closed_at, opening_amount, closing_amount, status')
        .eq('tenant_id', tenantId)
        .eq('site_id', siteId)
        .eq('status', 'closed')
        .order('closed_at', { ascending: false, nullsFirst: false })
        .limit(6);
      let rows = (data || []) as RecentSession[];
      if (excludeId) rows = rows.filter(r => r.id !== excludeId);
      setSessions(rows.slice(0, 5));
      setLoading(false);
    })();
  }, [tenantId, siteId, excludeId]);
  return { sessions, loading };
}

const fmtDateShort = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
const fmtTimeLanding = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const fmtDateFull = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });

function sessionDuration(opened: string) {
  const ms = Date.now() - new Date(opened).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}min`;
  return `${m} min`;
}

function POSLandingOpen({
  currentSite, openingAmount, setOpeningAmount, openingNote, setOpeningNote,
  openingSubmitting, openSessionSubmit, tenantId, onSeeAll, cashierName,
}: {
  currentSite: LandingSite;
  openingAmount: number; setOpeningAmount: (v: number) => void;
  openingNote: string; setOpeningNote: (v: string) => void;
  openingSubmitting: boolean; openSessionSubmit: () => void;
  tenantId?: string; onSeeAll?: () => void; cashierName: string;
}) {
  const { sessions, loading: loadingSessions } = useRecentSessions(tenantId, currentSite?.id);

  return (
    <div className="space-y-3 pb-6">
      {/* ── Unified header bar (same style as Sales/Articles pages) ── */}
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-5 lg:-mx-8 px-3 sm:px-5 lg:px-8 pb-3 pt-3 sm:pt-4 lg:pt-6 -mt-3 sm:-mt-4 lg:-mt-6 bg-slate-50/95 backdrop-blur-sm flex items-center gap-2">
        <div className="flex-1 min-w-0 flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 rounded-2xl bg-white border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 pr-2 border-r border-slate-200 shrink-0">
            <div className="leading-tight">
              <h1 className="text-sm font-bold tracking-tight text-slate-900 leading-none">Caisse</h1>
              <div className="text-[9px] font-semibold tracking-wider uppercase text-slate-400 leading-none mt-0.5 hidden sm:block">Nouvelle session</div>
              <div className="text-[9px] font-semibold tracking-wider uppercase text-slate-400 leading-none mt-0.5 sm:hidden">Ouvrir</div>
            </div>
          </div>
          <div className="flex-1 flex items-center gap-2 min-w-0">
            {currentSite && (
              <span className="text-[11px] text-slate-500 truncate flex items-center gap-1">
                <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                {currentSite.name}
              </span>
            )}
          </div>
          <span className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-xl bg-slate-900 text-white text-[9px] font-bold uppercase tracking-wider">
            <Lock className="w-2.5 h-2.5" />
            Fermée
          </span>
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shadow-glow shrink-0" style={{ background: 'linear-gradient(135deg, #0f766e 0%, #064e3b 100%)' }}>
            <Wallet className="w-3.5 h-3.5 text-white" />
          </div>
        </div>
      </div>

      {/* ── Desktop: 2-column grid ── */}
      <div className="hidden lg:grid lg:grid-cols-5 gap-4">
        {/* Left: open form */}
        <div className="col-span-3">
          <div className="relative overflow-hidden rounded-2xl border border-brand-200/60 bg-white shadow-card">
            <div className="absolute -top-24 -right-24 w-56 h-56 rounded-full bg-brand-400/8 blur-3xl pointer-events-none" />
            <div className="relative p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-2xl text-white flex items-center justify-center shadow-lg" style={{ background: 'linear-gradient(135deg, #0f766e 0%, #064e3b 100%)' }}>
                  <ShoppingCart className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Ouvrir la caisse</h2>
                  <p className="text-xs text-slate-500">Démarrez une nouvelle session de vente</p>
                </div>
              </div>

              <div className="space-y-4 max-w-sm">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1.5 block">Fond de caisse initial (FCFA)</label>
                  <input
                    type="number"
                    value={openingAmount || ''}
                    onChange={e => setOpeningAmount(Number(e.target.value))}
                    className="w-full h-12 px-4 rounded-xl bg-slate-50 border border-slate-200 focus:bg-white focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20 outline-none text-base font-bold tabular-nums transition-all"
                    placeholder="0"
                    min="0"
                    autoFocus
                    inputMode="numeric"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1.5 block">Note (optionnel)</label>
                  <input
                    value={openingNote}
                    onChange={e => setOpeningNote(e.target.value)}
                    className="w-full h-10 px-4 rounded-xl bg-slate-50 border border-slate-200 focus:bg-white focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20 outline-none text-sm transition-all"
                    placeholder="Ex: monnaie disponible..."
                  />
                </div>
                {cashierName && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-100">
                    <User className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-xs text-slate-500">Vendeur :</span>
                    <span className="text-xs font-semibold text-slate-700">{cashierName}</span>
                  </div>
                )}
              </div>

              <button
                onClick={openSessionSubmit}
                disabled={openingSubmitting}
                className="group mt-6 w-full max-w-sm relative overflow-hidden rounded-xl disabled:opacity-60 text-white font-bold text-sm py-3.5 px-5 shadow-[0_6px_20px_-8px_rgba(6,78,59,0.55)] hover:shadow-[0_8px_28px_-6px_rgba(6,78,59,0.7)] active:scale-[0.99] transition-all"
                style={{ background: 'linear-gradient(135deg, #0f766e 0%, #064e3b 100%)' }}
              >
                <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/15 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out" />
                <span className="relative flex items-center justify-center gap-2">
                  {openingSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
                  Ouvrir la caisse
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Right: tips */}
        <div className="col-span-2 space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center"><AlertCircle className="w-4 h-4" /></div>
              <h3 className="text-sm font-bold text-slate-800">Rappel</h3>
            </div>
            <ul className="space-y-2 text-xs text-slate-600 leading-relaxed">
              <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-brand-500 mt-1.5 shrink-0" />Comptez les espèces dans votre tiroir-caisse avant d'ouvrir.</li>
              <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-brand-500 mt-1.5 shrink-0" />Le fond de caisse initial sera vérifié à la clôture.</li>
              <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-brand-500 mt-1.5 shrink-0" />Vous pouvez quitter la caisse et y revenir sans la fermer.</li>
            </ul>
          </div>
          {currentSite && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center"><MapPin className="w-4 h-4" /></div>
                <h3 className="text-sm font-bold text-slate-800">Point de vente</h3>
              </div>
              <p className="text-sm font-semibold text-slate-900">{currentSite.name}</p>
              <p className="text-xs text-slate-500 mt-0.5">La session sera liée à ce point de vente.</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Mobile: open form card ── */}
      <div className="lg:hidden">
        <div className="rounded-2xl border border-brand-200/70 bg-white shadow-card overflow-hidden">
          <div className="p-4">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-9 h-9 rounded-xl text-white flex items-center justify-center shadow-md" style={{ background: 'linear-gradient(135deg, #0f766e 0%, #064e3b 100%)' }}>
                <ShoppingCart className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900">Ouvrir la caisse</h2>
                {cashierName && <p className="text-[10px] text-slate-500">{cashierName}</p>}
              </div>
            </div>

            <div className="space-y-2.5">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1 block">Fond de caisse (FCFA)</label>
                <input
                  type="number"
                  value={openingAmount || ''}
                  onChange={e => setOpeningAmount(Number(e.target.value))}
                  className="w-full h-11 px-3 rounded-xl bg-slate-50 border border-slate-200 focus:bg-white focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20 outline-none text-base font-bold tabular-nums"
                  placeholder="0"
                  min="0"
                  autoFocus={desktopAutoFocus}
                  inputMode="numeric"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1 block">Note (optionnel)</label>
                <input
                  value={openingNote}
                  onChange={e => setOpeningNote(e.target.value)}
                  className="w-full h-9 px-3 rounded-xl bg-slate-50 border border-slate-200 focus:bg-white focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20 outline-none text-xs"
                  placeholder="Ex: monnaie disponible..."
                />
              </div>
            </div>

            <button
              onClick={openSessionSubmit}
              disabled={openingSubmitting}
              className="group mt-3 w-full rounded-xl disabled:opacity-60 text-white font-bold text-sm py-3 px-4 shadow-[0_6px_20px_-8px_rgba(6,78,59,0.55)] active:scale-[0.99] transition-all"
              style={{ background: 'linear-gradient(135deg, #0f766e 0%, #064e3b 100%)' }}
            >
              <span className="flex items-center justify-center gap-2">
                {openingSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
                Ouvrir la caisse
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Recent sessions ── */}
      {!loadingSessions && sessions.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5 px-1">
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Dernières sessions</h3>
            {onSeeAll && (
              <button onClick={onSeeAll} className="text-[11px] font-semibold text-brand-700 inline-flex items-center gap-0.5">
                Voir tout <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>
          {/* Desktop table */}
          <div className="hidden lg:block rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-card">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Date</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Ouverture</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Fermeture</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Fond</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Encaissé</th>
                  <th className="text-center px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sessions.map(s => {
                  const collected = s.closing_amount != null ? Number(s.closing_amount) - Number(s.opening_amount) : null;
                  return (
                    <tr key={s.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 text-xs font-semibold text-slate-800">{fmtDateFull(s.opened_at)}</td>
                      <td className="px-4 py-3 text-xs tabular-nums text-slate-600">{fmtTimeLanding(s.opened_at)}</td>
                      <td className="px-4 py-3 text-xs tabular-nums text-slate-600">{s.closed_at ? fmtTimeLanding(s.closed_at) : '-'}</td>
                      <td className="px-4 py-3 text-xs font-semibold text-slate-800 tabular-nums text-right">{formatFCFA(Number(s.opening_amount))}</td>
                      <td className="px-4 py-3 text-xs font-bold text-brand-800 tabular-nums text-right">{collected != null ? formatFCFA(collected) : '-'}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[9px] font-bold uppercase">
                          <Lock className="w-2 h-2" /> Clôturée
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Mobile list */}
          <div className="lg:hidden space-y-1.5">
            {sessions.slice(0, 3).map(s => {
              const collected = s.closing_amount != null ? Number(s.closing_amount) - Number(s.opening_amount) : null;
              return (
                <div key={s.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-white border border-slate-200">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center shrink-0"><Lock className="w-2.5 h-2.5 text-slate-500" /></div>
                    <div className="min-w-0">
                      <span className="text-[11px] font-bold text-slate-800">{fmtDateShort(s.opened_at)}</span>
                      <span className="text-[10px] text-slate-400 ml-1.5 tabular-nums">{fmtTimeLanding(s.opened_at)}{s.closed_at ? ` - ${fmtTimeLanding(s.closed_at)}` : ''}</span>
                    </div>
                  </div>
                  <span className="text-[11px] font-bold text-brand-800 tabular-nums shrink-0">{collected != null ? formatFCFA(collected) : '-'}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function LandingActionBtn({ icon: Icon, label, onClick, disabled, variant, badge }: {
  icon: typeof Wallet; label: string; onClick: () => void; disabled?: boolean;
  variant?: 'primary' | 'dark'; badge?: number;
}) {
  const base = variant === 'primary'
    ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
    : variant === 'dark'
    ? 'bg-slate-900 border-slate-800 text-white hover:bg-slate-800'
    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative flex flex-col items-center justify-center gap-1.5 px-2 py-3 rounded-xl border text-center transition-all active:scale-[0.97] ${base} ${disabled ? 'opacity-40 pointer-events-none' : ''}`}
    >
      <Icon className="w-4 h-4" />
      <span className="text-[10px] font-semibold leading-tight">{label}</span>
      {badge != null && badge > 0 && (
        <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 text-[9px] rounded-full bg-red-500 text-white flex items-center justify-center font-bold">{badge}</span>
      )}
    </button>
  );
}

function ActionIconBtn({ icon: Icon, label, onClick, disabled }: {
  icon: typeof Wallet; label: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-all active:scale-[0.97] ${disabled ? 'opacity-40 pointer-events-none' : ''}`}
    >
      <Icon className="w-4.5 h-4.5" />
      <span className="text-[10px] font-medium leading-tight text-slate-600 whitespace-nowrap">{label}</span>
    </button>
  );
}

function POSLandingResume({
  session, currentSite, onResume, tenantId, onSeeAll, cashierName,
  actions,
}: {
  session: CashSession; currentSite: LandingSite;
  onResume: () => void; tenantId?: string; onSeeAll?: () => void; cashierName: string;
  actions?: {
    onStats: () => void;
    onTickets: () => void;
    onReturn: () => void;
    onCustomerPayment: () => void;
    onMovement: () => void;
    onWebOrders: () => void;
    onClose: () => void;
    canReturn: boolean;
    canMovement: boolean;
    canClose: boolean;
    webOrdersBadge?: number;
    sessionOpen: boolean;
  };
}) {
  const { summary, loading: loadingSummary } = useDaySummary(tenantId, currentSite?.id, session.id);
  const isOpen = actions?.sessionOpen !== false;

  const actionBtns = actions ? [
    { icon: Wallet, label: 'Encaisser', onClick: actions.onCustomerPayment, show: true },
    { icon: ArrowDownRight, label: 'Mouvement', onClick: actions.onMovement, show: actions.canMovement },
    { icon: RotateCcw, label: 'Retour client', onClick: actions.onReturn, show: actions.canReturn },
    { icon: List, label: 'Tickets', onClick: actions.onTickets, show: true },
    { icon: Lock, label: 'Clôturer', onClick: actions.onClose, show: actions.canClose },
  ].filter(b => b.show) : [];

  return (
    <div className="pb-4">
      {/* ── Header ── */}
      <div className="px-1 sm:px-2 lg:px-6 pt-4 sm:pt-5 pb-3 sm:pb-4">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Caisse</h1>
          {currentSite && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-slate-200 bg-white text-[11px] sm:text-xs font-medium text-slate-600">
              <MapPin className="w-3 h-3 text-slate-400" />
              {currentSite.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
          <span className="text-xs sm:text-sm font-medium text-emerald-600">Session ouverte</span>
          <span className="hidden sm:inline text-xs sm:text-sm text-slate-400 ml-1">Ouverte le {new Date(session.opened_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })} à {fmtTimeLanding(session.opened_at)}</span>
        </div>
      </div>

      {/* ── Desktop grid ── */}
      <div className="hidden lg:grid lg:grid-cols-[1fr_320px] gap-4 px-6">
        {/* Left: Session de caisse */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-col">
          <h2 className="text-lg font-bold text-slate-900 mb-5">Session de caisse</h2>

          <div className="grid grid-cols-2 gap-x-6 gap-y-0 flex-1">
            <div className="flex items-center gap-3 py-4 border-b border-slate-100">
              <div className="w-9 h-9 rounded-full border border-slate-200 flex items-center justify-center shrink-0"><MapPin className="w-4 h-4 text-slate-400" /></div>
              <div><p className="text-[11px] text-slate-400 leading-none mb-1">Point de vente</p><p className="text-sm font-semibold text-slate-900">{currentSite?.name || '-'}</p></div>
            </div>
            <div className="flex items-center gap-3 py-4 border-b border-slate-100">
              <div className="w-9 h-9 rounded-full border border-slate-200 flex items-center justify-center shrink-0"><ClockIcon className="w-4 h-4 text-slate-400" /></div>
              <div><p className="text-[11px] text-slate-400 leading-none mb-1">Ouverte le</p><p className="text-sm font-semibold text-slate-900">{new Date(session.opened_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })} à {fmtTimeLanding(session.opened_at)}</p></div>
            </div>
            <div className="flex items-center gap-3 py-4 border-b border-slate-100">
              <div className="w-9 h-9 rounded-full border border-slate-200 flex items-center justify-center shrink-0"><ClockIcon className="w-4 h-4 text-slate-400" /></div>
              <div><p className="text-[11px] text-slate-400 leading-none mb-1">Durée</p><p className="text-sm font-semibold text-slate-900">{sessionDuration(session.opened_at)}</p></div>
            </div>
            <div className="flex items-center gap-3 py-4 border-b border-slate-100">
              <div className="w-9 h-9 rounded-full border border-slate-200 flex items-center justify-center shrink-0"><Banknote className="w-4 h-4 text-slate-400" /></div>
              <div><p className="text-[11px] text-slate-400 leading-none mb-1">Fond initial</p><p className="text-sm font-semibold text-emerald-600">{formatFCFA(Number(session.opening_amount))}</p></div>
            </div>
            <div className="flex items-center gap-3 py-4">
              <div className="w-9 h-9 rounded-full border border-slate-200 flex items-center justify-center shrink-0"><User className="w-4 h-4 text-slate-400" /></div>
              <div><p className="text-[11px] text-slate-400 leading-none mb-1">Vendeur</p><p className="text-sm font-semibold text-slate-900 uppercase">{cashierName || '-'}</p></div>
            </div>
            <div className="flex items-center gap-3 py-4">
              <div className="w-9 h-9 rounded-full border border-slate-200 flex items-center justify-center shrink-0"><CheckCircle2 className="w-4 h-4 text-slate-400" /></div>
              <div><p className="text-[11px] text-slate-400 leading-none mb-1">Statut</p><span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border border-emerald-200 bg-emerald-50 text-emerald-700">OUVERTE</span></div>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-2 mt-5 pt-4 border-t border-slate-100">
            <button onClick={onResume} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold transition-colors active:scale-[0.98] shadow-sm">
              <Play className="w-3.5 h-3.5 fill-current" /> Reprendre la session
            </button>
            {actionBtns.map(btn => (
              <button key={btn.label} onClick={btn.onClick} disabled={!isOpen} className="flex flex-col items-center justify-center w-[72px] h-[62px] rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-all active:scale-[0.96] disabled:opacity-40 disabled:pointer-events-none">
                <btn.icon className="w-4 h-4 mb-1" />
                <span className="text-[9px] font-medium leading-tight text-center">{btn.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Right column — stretch to match left */}
        <div className="flex flex-col gap-4">
          {/* Résumé de session */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center"><BarChart2 className="w-4 h-4 text-teal-600" /></div>
              <h3 className="text-sm font-bold text-slate-900">Résumé de session</h3>
            </div>
            {loadingSummary ? (
              <div className="space-y-2 animate-pulse"><div className="h-10 bg-slate-100 rounded-lg" /><div className="h-10 bg-slate-100 rounded-lg" /></div>
            ) : summary ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between py-2.5 border-b border-slate-100">
                  <span className="text-xs text-teal-700 font-medium">Total encaissé</span>
                  <span className="text-sm font-bold text-teal-600 tabular-nums">{formatFCFA(summary.salesTotal)}</span>
                </div>
                <div className="flex items-center justify-between py-2.5 border-b border-slate-100">
                  <span className="text-xs text-slate-600 font-medium">Nombre de ventes</span>
                  <span className="text-sm font-bold text-slate-800 tabular-nums">{summary.salesCount}</span>
                </div>
                {summary.byMethod.length > 0 && (
                  <div className="pt-1">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Par mode de paiement</p>
                    {summary.byMethod.map(m => (
                      <div key={m.method_name} className="flex items-center justify-between py-1.5">
                        <span className="text-[11px] text-slate-500">{m.method_name}</span>
                        <span className="text-[11px] font-bold text-slate-700 tabular-nums">{formatFCFA(m.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-400 text-center py-2">Aucune donnée</p>
            )}
          </div>

          {/* Accès rapides */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 flex-1">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center"><ClockIcon className="w-4 h-4 text-slate-500" /></div>
              <h3 className="text-sm font-bold text-slate-900">Accès rapides</h3>
            </div>
            <div className="space-y-1">
              {onSeeAll && (
                <button onClick={onSeeAll} className="w-full flex items-center gap-2.5 px-3 py-3 rounded-xl hover:bg-slate-50 border border-slate-100 text-left transition-colors group">
                  <div className="w-7 h-7 rounded-lg bg-teal-50 flex items-center justify-center shrink-0"><ClockIcon className="w-3.5 h-3.5 text-teal-600" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-800">Historique des sessions</p>
                    <p className="text-[10px] text-slate-400">Consulter les sessions précédentes</p>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 shrink-0" />
                </button>
              )}
              <button onClick={onResume} className="w-full flex items-center gap-2.5 px-3 py-3 rounded-xl hover:bg-slate-50 border border-slate-100 text-left transition-colors group">
                <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0"><ShoppingCart className="w-3.5 h-3.5 text-emerald-600" /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-800">Point de vente</p>
                  <p className="text-[10px] text-slate-400">Accéder à la caisse</p>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 shrink-0" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Mobile layout ── */}
      <div className="lg:hidden px-2 sm:px-3 space-y-3">
        {/* Session info card */}
        <div className="bg-white rounded-xl border border-slate-200 p-3.5">
          <h2 className="text-sm font-bold text-slate-900 mb-3">Session de caisse</h2>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full border border-slate-200 flex items-center justify-center shrink-0"><MapPin className="w-3 h-3 text-slate-400" /></div>
              <div><p className="text-[9px] text-slate-400">Point de vente</p><p className="text-[11px] font-semibold text-slate-800 truncate">{currentSite?.name || '-'}</p></div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full border border-slate-200 flex items-center justify-center shrink-0"><ClockIcon className="w-3 h-3 text-slate-400" /></div>
              <div><p className="text-[9px] text-slate-400">Durée</p><p className="text-[11px] font-semibold text-slate-800">{sessionDuration(session.opened_at)}</p></div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full border border-slate-200 flex items-center justify-center shrink-0"><Banknote className="w-3 h-3 text-slate-400" /></div>
              <div><p className="text-[9px] text-slate-400">Fond initial</p><p className="text-[11px] font-semibold text-emerald-600">{formatFCFA(Number(session.opening_amount))}</p></div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full border border-slate-200 flex items-center justify-center shrink-0"><CheckCircle2 className="w-3 h-3 text-slate-400" /></div>
              <div><p className="text-[9px] text-slate-400">Statut</p><span className="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold uppercase border border-emerald-200 bg-emerald-50 text-emerald-700">OUVERTE</span></div>
            </div>
          </div>
          {cashierName && (
            <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-slate-100">
              <div className="w-7 h-7 rounded-full border border-slate-200 flex items-center justify-center shrink-0"><User className="w-3 h-3 text-slate-400" /></div>
              <div><p className="text-[9px] text-slate-400">Vendeur</p><p className="text-[11px] font-semibold text-slate-800 uppercase">{cashierName}</p></div>
            </div>
          )}
        </div>

        {/* Resume button */}
        <button onClick={onResume} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold transition-colors active:scale-[0.98] shadow-sm">
          <Play className="w-4 h-4 fill-current" /> Reprendre la session
        </button>

        {/* Action buttons grid */}
        {actions && (
          <div className="grid grid-cols-5 gap-1.5">
            {actionBtns.map(btn => (
              <button key={btn.label} onClick={btn.onClick} disabled={!isOpen} className="flex flex-col items-center justify-center py-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 transition-all active:scale-[0.95] disabled:opacity-40 disabled:pointer-events-none">
                <btn.icon className="w-4 h-4 mb-0.5" />
                <span className="text-[8px] font-medium leading-tight text-center">{btn.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* Summary card */}
        {!loadingSummary && summary && (
          <div className="bg-white rounded-xl border border-slate-200 p-3.5">
            <div className="flex items-center gap-2 mb-2.5">
              <div className="w-6 h-6 rounded-md bg-teal-50 flex items-center justify-center"><BarChart2 className="w-3 h-3 text-teal-600" /></div>
              <h3 className="text-xs font-bold text-slate-900">Résumé</h3>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-[11px] text-slate-500">Total encaissé</span>
              <span className="text-xs font-bold text-teal-600 tabular-nums">{formatFCFA(summary.salesTotal)}</span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-t border-slate-100">
              <span className="text-[11px] text-slate-500">Ventes</span>
              <span className="text-xs font-bold text-slate-800 tabular-nums">{summary.salesCount}</span>
            </div>
            {summary.byMethod.length > 0 && summary.byMethod.map(m => (
              <div key={m.method_name} className="flex items-center justify-between py-1 border-t border-slate-50">
                <span className="text-[10px] text-slate-400">{m.method_name}</span>
                <span className="text-[10px] font-bold text-slate-600 tabular-nums">{formatFCFA(m.amount)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Quick links */}
        <div className="flex gap-2">
          {onSeeAll && (
            <button onClick={onSeeAll} className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-left active:bg-slate-50 transition-colors">
              <ClockIcon className="w-3.5 h-3.5 text-teal-600 shrink-0" />
              <span className="text-[11px] font-medium text-slate-700">Historique</span>
            </button>
          )}
          <button onClick={onResume} className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-left active:bg-slate-50 transition-colors">
            <ShoppingCart className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span className="text-[11px] font-medium text-slate-700">Point de vente</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function POS({ onLeave, onNavigate }: { onLeave?: () => void; onNavigate?: (route: string) => void }) {
  const { tenant, currentSite, sites, depots, profile, setPosCart, posCartOpen, dataTick } = useApp();
  const { can } = usePermissions();
  const tenantForPrint: PrintTenant = tenant ? {
    name: tenant.name, legal_name: (tenant as any).legal_name,
    ninea: (tenant as any).ninea, rccm: (tenant as any).rccm,
    address: (tenant as any).address, phone: (tenant as any).phone,
    email: (tenant as any).email, website: (tenant as any).website,
    logo_url: (tenant as any).logo_url,
    business_type: (tenant as any).business_type,
  } : { name: '' };
  const cashierName = profile?.full_name || profile?.email || '';

  const printSaleTicket = (sale: { sale_number: string; created_at: string; total: number; discount: number; items: CartItem[]; payments: SalePayment[]; customer: Customer | null }) => {
    printTicket80Shared({
      sale_number: sale.sale_number,
      created_at: sale.created_at,
      total: sale.total,
      discount: sale.discount,
      items: sale.items.map(i => ({ name: i.name, supplier_ref: null, oem_ref: i.oem_ref, quantity: i.quantity, unit_price: i.unit_price, discount: i.discount })),
      payments: sale.payments.map(p => ({ method_name: p.method_name, amount: p.amount })),
      customer: sale.customer ? { name: sale.customer.name, phone: (sale.customer as any).phone, address: (sale.customer as any).address } : null,
    }, tenantForPrint, cashierName);
  };

  const printSaleInvoice = (sale: { sale_number: string; created_at: string; total: number; discount: number; items: CartItem[]; payments: SalePayment[]; customer: Customer | null }) => {
    const items = sale.items.map(i => ({ name: i.name, supplier_ref: null, oem_ref: i.oem_ref, quantity: i.quantity, unit_price: i.unit_price, discount: i.discount }));
    const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price - (i.discount || 0), 0);
    const paid = sale.payments.reduce((s, p) => s + p.amount, 0);
    printDocumentA4({
      tenant: tenantForPrint,
      docLabel: 'FACTURE',
      docNumber: sale.sale_number,
      docDate: new Date(sale.created_at).toLocaleDateString('fr-FR'),
      customer: sale.customer ? { name: sale.customer.name, phone: (sale.customer as any).phone, address: (sale.customer as any).address } : null,
      items, subtotal, discount: sale.discount, total: sale.total,
      payments: sale.payments.map(p => ({ method_name: p.method_name, amount: p.amount })),
      paid, cashier: cashierName, issuedBy: profile?.full_name || undefined,
    });
  };
  const autoMode = isAutoParts(tenant);
  const { success, error } = useToast();

  // Screen state: 'open-form' | 'resume' | 'pos'
  const [screen, setScreen] = useState<'open-form' | 'resume' | 'pos'>('open-form');

  // Data
  const [articles, setArticles] = useState<ArticleLite[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [session, setSession] = useState<CashSession | null>(null);
  const [loadingData, setLoadingData] = useState(true);

  // Session open form
  const [openingAmount, setOpeningAmount] = useState(0);
  const [openingNote, setOpeningNote] = useState('');
  const [openingSubmitting, setOpeningSubmitting] = useState(false);

  // Catalog filters
  const [categories, setCategories] = useState<CategoryLite[]>([]);
  const [topScores, setTopScores] = useState<Record<string, number>>({});
  const [sortMode, setSortMode] = useState<'top' | 'alpha'>('top');
  const [categoryId, setCategoryId] = useState<string>('');
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [articleView, setArticleView] = useState<'grid' | 'list'>('grid');

  // Cart
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [discount, setDiscount] = useState(0);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [exceptionPrices, setExceptionPrices] = useState<Map<string, number>>(new Map());
  const [articleTiers, setArticleTiers] = useState<ArticleTier[]>([]);
  const [tierPickerOpen, setTierPickerOpen] = useState(false);
  const [tierPickerArticle, setTierPickerArticle] = useState<ArticleLite | null>(null);

  // Source site/depot selector for stock deduction
  const [saleSourceSiteId, setSaleSourceSiteId] = useState<string>('');

  // Load exception prices when customer changes
  useEffect(() => {
    if (!customer || !tenant) { setExceptionPrices(new Map()); return; }
    supabase.from('customer_exception_prices')
      .select('article_id, exception_price')
      .eq('tenant_id', tenant.id)
      .eq('customer_id', customer.id)
      .then(({ data }) => {
        const m = new Map<string, number>();
        (data || []).forEach((r: any) => m.set(r.article_id, Number(r.exception_price)));
        setExceptionPrices(m);
        if (m.size > 0 && cart.length > 0) {
          setCart(c => c.map(item => {
            const ep = m.get(item.article_id);
            return ep !== undefined ? { ...item, unit_price: ep } : item;
          }));
        }
      });
  }, [customer?.id]);

  // Sync cart state to Shell FAB
  useEffect(() => {
    setPosCart(cart.length, mobileCartOpen);
  }, [cart.length, mobileCartOpen, setPosCart]);

  // React to Shell FAB toggling the cart
  useEffect(() => {
    setMobileCartOpen(posCartOpen);
  }, [posCartOpen]);

  // Reset FAB state on unmount
  useEffect(() => {
    return () => { setPosCart(0, false); };
  }, [setPosCart]);

  // Init saleSourceSiteId from currentSite
  useEffect(() => {
    if (currentSite && !saleSourceSiteId) setSaleSourceSiteId(currentSite.id);
  }, [currentSite?.id]);

  // Held carts (mise en attente)
  const [heldCarts, setHeldCarts] = useState<HeldCart[]>([]);
  const [holdOpen, setHoldOpen] = useState(false);

  // Payment
  const [payOpen, setPayOpen] = useState(false);
  const [payments, setPayments] = useState<SalePayment[]>([]);
  const [paying, setPaying] = useState(false);
  const [lastSale, setLastSale] = useState<{
    sale_number: string; created_at: string; total: number; discount: number;
    items: CartItem[]; payments: SalePayment[]; customer: Customer | null;
  } | null>(null);
  const [printInvoice, setPrintInvoice] = useState(false);

  // Document settings fields for POS payment modal
  type PosDocSettings = { show_delivery_date: boolean; show_reference: boolean; show_warranty: boolean; show_representative: boolean; default_representative: string };
  const [posDocSettings, setPosDocSettings] = useState<PosDocSettings>({ show_delivery_date: false, show_reference: false, show_warranty: false, show_representative: false, default_representative: '' });
  const [docDeliveryDate, setDocDeliveryDate] = useState('');
  const [docReference, setDocReference] = useState('');
  const [docWarranty, setDocWarranty] = useState('');
  const [docRepresentative, setDocRepresentative] = useState('');

  useEffect(() => {
    if (!tenant) return;
    supabase.from('document_settings').select('*').eq('tenant_id', tenant.id).eq('doc_type', 'invoice').maybeSingle().then(({ data }) => {
      if (data) {
        setPosDocSettings({
          show_delivery_date: data.show_delivery_date ?? false,
          show_reference: data.show_reference ?? false,
          show_warranty: data.show_warranty ?? false,
          show_representative: data.show_representative ?? false,
          default_representative: data.default_representative ?? '',
        });
        if (data.default_representative) setDocRepresentative(data.default_representative);
      }
    });
  }, [tenant?.id]);

  // Cash movement (expense / income / customer prepayment)
  const [mvOpen, setMvOpen] = useState(false);
  const [mvKind, setMvKind] = useState<'expense' | 'income' | 'customer_prepayment'>('expense');
  const [mvAmount, setMvAmount] = useState(0);
  const [mvReason, setMvReason] = useState('');
  const [mvNote, setMvNote] = useState('');
  const [mvRef, setMvRef] = useState('');
  const [mvMethod, setMvMethod] = useState<PaymentMethod | null>(null);
  const [mvCustomer, setMvCustomer] = useState<Customer | null>(null);
  const [mvCustSearch, setMvCustSearch] = useState('');
  const [mvSubmitting, setMvSubmitting] = useState(false);

  // Customer payment (encaissement libre)
  const [custPayOpen, setCustPayOpen] = useState(false);
  const [custPayCustomer, setCustPayCustomer] = useState<Customer | null>(null);
  const [custPayUnpaid, setCustPayUnpaid] = useState<{ id: string; sale_number: string; total: number; paid: number; created_at: string }[]>([]);
  const [custPaySaleId, setCustPaySaleId] = useState<string>('');
  const [custPayAmount, setCustPayAmount] = useState<number>(0);
  const [custPayMethod, setCustPayMethod] = useState<PaymentMethod | null>(null);
  const [custPayRef, setCustPayRef] = useState('');
  const [custPaySubmitting, setCustPaySubmitting] = useState(false);
  const [custPaySearch, setCustPaySearch] = useState('');

  // Return ticket
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnSearch, setReturnSearch] = useState('');
  const [returnSales, setReturnSales] = useState<SessionSale[]>([]);
  const [returnLoading, setReturnLoading] = useState(false);
  const [returnSelected, setReturnSelected] = useState<SessionSale | null>(null);
  const [returnLines, setReturnLines] = useState<{ article_id: string; name: string; quantity: number; unit_price: number; maxQty: number; selected: boolean }[]>([]);

  // Session tickets list
  const [ticketsOpen, setTicketsOpen] = useState(false);
  const [sessionSales, setSessionSales] = useState<SessionSale[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);

  // Close workflow
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeStep, setCloseStep] = useState<CloseStep>('control');
  const [controlLines, setControlLines] = useState<ControlLine[]>([]);
  const [loadingControl, setLoadingControl] = useState(false);
  const [closingNote, setClosingNote] = useState('');
  const [closing, setClosing] = useState(false);
  const [statsData, setStatsData] = useState<{
    count: number; total: number;
    byMethod: { method_name: string; amount: number }[];
    topArticles: { name: string; qty: number; total: number }[];
    movements: { kind: 'expense' | 'income' | 'customer_prepayment'; amount: number; reason: string; method_name: string; customer_name: string | null }[];
    invoicePayments: { sale_number: string; amount: number; method_name: string; customer_name: string | null; created_at: string; user_name: string | null }[];
    movExpense: number; movIncome: number; movPrepay: number;
    netTotal: number;
  } | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [loadingStats, setLoadingStats] = useState(false);
  const [statsExpanded, setStatsExpanded] = useState<'reglements' | 'modes' | 'articles' | null>(null);

  // Vehicle picker
  const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false);

  // Web orders
  type WebOrder = {
    id: string; order_number: string; status: string; payment_status: string;
    delivery_mode: string; delivery_address: string; payment_mode: string;
    customer_name: string; customer_phone: string; customer_whatsapp: string;
    customer_note: string; subtotal: number; delivery_fee: number; total: number;
    created_at: string; sale_id: string | null;
  };
  type WebOrderItem = {
    id: string; article_id: string; article_name: string; internal_ref: string;
    quantity: number; unit_price: number; line_total: number;
  };
  const [webOrdersOpen, setWebOrdersOpen] = useState(false);
  const [webOrders, setWebOrders] = useState<WebOrder[]>([]);
  const [webOrdersLoading, setWebOrdersLoading] = useState(false);
  const [webOrdersFilter, setWebOrdersFilter] = useState<'all' | 'a_transformer' | 'livraison' | 'attente_paiement'>('a_transformer');
  const [webOrderDetail, setWebOrderDetail] = useState<WebOrder | null>(null);
  const [webOrderItems, setWebOrderItems] = useState<WebOrderItem[]>([]);
  const [transforming, setTransforming] = useState(false);

  // Regularization
  const [regOpen, setRegOpen] = useState(false);
  const [regType, setRegType] = useState<'excedent' | 'manquant' | 'depot' | 'retrait'>('manquant');
  const [regAmount, setRegAmount] = useState(0);
  const [regReason, setRegReason] = useState('');
  const [regNote, setRegNote] = useState('');
  const [savingReg, setSavingReg] = useState(false);
  const [sessionRegs, setSessionRegs] = useState<{ reg_type: string; amount: number; reason: string; note: string }[]>([]);

  // Lot picker for sale
  const [lotPickerOpen, setLotPickerOpen] = useState(false);

  const load = useCallback(async () => {
    if (!tenant || !currentSite) return;
    const stockSiteId = saleSourceSiteId || currentSite.id;
    setLoadingData(true);
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const isShared = (tenant as any)?.settings?.shared_articles !== false;
    const isSharedCust = (tenant as any)?.settings?.shared_customers !== false;

    // Fetch all articles in batches (Supabase default limit is 1000)
    let allArts: any[] = [];
    let from = 0;
    const batchSize = 1000;
    while (true) {
      let query = supabase
        .from('articles')
        .select('id, internal_ref, name, oem_ref, sale_price, purchase_price, category_id, image_url')
        .eq('tenant_id', tenant.id)
        .eq('is_active', true)
        .range(from, from + batchSize - 1);
      if (!isShared && currentSite) {
        query = query.or(`site_id.eq.${currentSite.id},site_id.is.null`);
      }
      const { data, error: e } = await query;
      if (e || !data) break;
      allArts = allArts.concat(data);
      if (data.length < batchSize) break;
      from += batchSize;
    }

    const [{ data: stk }, { data: pm }, { data: cs }, { data: cust }, { data: cats }, { data: topRows }, { data: tiers }] = await Promise.all([
      supabase.from('stock_levels').select('article_id, quantity').eq('tenant_id', tenant.id).eq('site_id', stockSiteId),
      supabase.from('payment_methods').select('*').eq('tenant_id', tenant.id).eq('is_active', true).order('sort_order'),
      supabase.from('cash_sessions').select('*').eq('tenant_id', tenant.id).eq('site_id', currentSite.id).eq('status', 'open').order('opened_at', { ascending: false }).limit(1).maybeSingle(),
      (() => { let q = supabase.from('customers').select('*').eq('tenant_id', tenant.id).eq('is_active', true).order('name').limit(300); if (!isSharedCust && currentSite) q = q.or(`site_id.eq.${currentSite.id},site_id.is.null`); return q; })(),
      supabase.from('part_categories').select('id, name, parent_id').eq('tenant_id', tenant.id).eq('is_active', true).order('name'),
      supabase.from('sale_items').select('article_id, quantity, sales!inner(tenant_id, created_at, status)').eq('tenant_id', tenant.id).gte('sales.created_at', since).neq('sales.status', 'cancelled').limit(5000),
      supabase.from('article_pricing_tiers').select('article_id, tier_name, price').eq('tenant_id', tenant.id).order('sort_order'),
    ]);
    const qmap = new Map((stk || []).map((r: any) => [r.article_id, Number(r.quantity)]));
    setArticles((allArts).map((a: any) => ({
      id: a.id, internal_ref: a.internal_ref, name: a.name, oem_ref: a.oem_ref || '',
      sale_price: Number(a.sale_price), purchase_price: Number(a.purchase_price),
      stock_available: qmap.get(a.id) || 0,
      category_id: a.category_id || null,
      image_url: a.image_url || null,
    })));
    setMethods((pm || []).filter((m: any) => m.payment_type !== 'credit'));
    setCustomers(cust || []);
    setCategories((cats || []) as CategoryLite[]);
    const scores: Record<string, number> = {};
    for (const r of (topRows || []) as any[]) {
      if (!r.article_id) continue;
      scores[r.article_id] = (scores[r.article_id] || 0) + Number(r.quantity || 0);
    }
    setTopScores(scores);
    setArticleTiers((tiers || []) as ArticleTier[]);
    const existingSession = cs || null;
    setSession(existingSession);
    // Only update screen if we're not already inside the POS (avoids resetting after a sale)
    setScreen(prev => {
      if (prev === 'pos') return 'pos';
      // Check if caller requested direct POS access (skip resume)
      const ctx = peekNavContext();
      if (ctx?.target === 'directPos' && existingSession) {
        consumeNavContext();
        return 'pos';
      }
      return existingSession ? 'resume' : 'open-form';
    });
    setLoadingData(false);
  }, [tenant?.id, currentSite?.id, saleSourceSiteId]);

  useEffect(() => { load(); }, [load]);

  // Realtime: silently refresh stock + customers when another user makes changes
  useEffect(() => {
    if (dataTick === 0 || !tenant || !currentSite) return;
    const stockSiteId = saleSourceSiteId || currentSite.id;
    (async () => {
      const [{ data: stk }, { data: cust }] = await Promise.all([
        supabase.from('stock_levels').select('article_id, quantity').eq('tenant_id', tenant.id).eq('site_id', stockSiteId),
        supabase.from('customers').select('*').eq('tenant_id', tenant.id).order('name'),
      ]);
      if (stk) {
        const qmap = new Map(stk.map((r: any) => [r.article_id, Number(r.quantity)]));
        setArticles(prev => prev.map(a => ({ ...a, stock_available: qmap.get(a.id) || 0 })));
      }
      if (cust) setCustomers(cust);
    })();
  }, [dataTick]);

  // Force-skip resume screen when coming from Dashboard "Ventes" button
  useEffect(() => {
    if (session && screen === 'resume') {
      const ctx = peekNavContext();
      if (ctx?.target === 'directPos') {
        consumeNavContext();
        setScreen('pos');
      }
    }
  }, [session, screen]);

  const categoryMatchIds = useMemo(() => {
    if (!categoryId) return null;
    const ids = new Set<string>([categoryId]);
    for (const c of categories) if (c.parent_id === categoryId) ids.add(c.id);
    return ids;
  }, [categoryId, categories]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let base = articles;
    if (categoryMatchIds) base = base.filter(a => a.category_id && categoryMatchIds.has(a.category_id));
    if (q) {
      base = base.filter(a => a.name.toLowerCase().includes(q) || a.internal_ref.toLowerCase().includes(q));
    }
    const sorted = [...base].sort((a, b) => {
      if (sortMode === 'alpha') return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
      const sa = topScores[a.id] || 0;
      const sb = topScores[b.id] || 0;
      if (sb !== sa) return sb - sa;
      return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
    });
    const cap = q || categoryId ? 300 : 120;
    return sorted.slice(0, cap);
  }, [articles, search, sortMode, topScores, categoryMatchIds, categoryId]);

  // ─── Cart operations ──────────────────────────────────────────────────────

  const addToCart = (a: ArticleLite) => {
    const allowNeg = !!(tenant as any)?.settings?.allow_negative_stock;
    // If already in cart, just increment qty
    const existing = cart.find(i => i.article_id === a.id);
    if (existing) {
      if (!allowNeg && existing.quantity + 1 > a.stock_available) { error(`Stock insuffisant (${a.stock_available})`); return; }
      setCart(c => c.map(i => i.article_id === a.id ? { ...i, quantity: i.quantity + 1 } : i));
      return;
    }
    if (!allowNeg && a.stock_available <= 0) { error('Article en rupture'); return; }

    // Check pricing tiers for this article (exception price always takes priority)
    const hasException = exceptionPrices.has(a.id);
    const tiers = articleTiers.filter(t => t.article_id === a.id);
    if (tiers.length > 1 && !hasException) {
      setTierPickerArticle(a);
      setTierPickerOpen(true);
      return;
    }

    const price = hasException ? exceptionPrices.get(a.id)! : (tiers.length === 1 ? tiers[0].price : a.sale_price);
    const tierName = !hasException && tiers.length === 1 ? tiers[0].tier_name : undefined;
    setCart(c => [...c, {
      article_id: a.id, name: a.name, internal_ref: a.internal_ref, oem_ref: a.oem_ref,
      quantity: 1, unit_price: price, discount: 0,
      stock_available: a.stock_available, purchase_cost: a.purchase_price,
      tier_name: tierName,
    }]);
  };

  const addToCartWithTier = (a: ArticleLite, tierName: string, tierPrice: number) => {
    const price = exceptionPrices.get(a.id) ?? tierPrice;
    setCart(c => [...c, {
      article_id: a.id, name: a.name, internal_ref: a.internal_ref, oem_ref: a.oem_ref,
      quantity: 1, unit_price: price, discount: 0,
      stock_available: a.stock_available, purchase_cost: a.purchase_price,
      tier_name: tierName,
    }]);
    setTierPickerOpen(false);
    setTierPickerArticle(null);
  };

  const updateQty = (id: string, delta: number) => {
    const allowNeg = !!(tenant as any)?.settings?.allow_negative_stock;
    setCart(c => c.flatMap(i => {
      if (i.article_id !== id) return [i];
      const q = i.quantity + delta;
      if (q <= 0) return [];
      if (!allowNeg && q > i.stock_available) { error(`Stock insuffisant (${i.stock_available})`); return [i]; }
      return [{ ...i, quantity: q }];
    }));
  };

  const setQty = (id: string, q: number) => {
    const allowNeg = !!(tenant as any)?.settings?.allow_negative_stock;
    setCart(c => c.map(i => i.article_id === id ? { ...i, quantity: Math.max(1, allowNeg ? q : Math.min(q, i.stock_available)) } : i));
  };

  const setPrice = (id: string, p: number) => {
    setCart(c => c.map(i => i.article_id === id ? { ...i, unit_price: Math.max(0, p) } : i));
  };

  const removeLine = (id: string) => setCart(c => c.filter(i => i.article_id !== id));

  const subtotal = cart.reduce((s, i) => s + i.quantity * i.unit_price - (i.discount || 0), 0);
  const total = Math.max(0, subtotal - discount);
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = total - totalPaid;

  // ─── Hold cart ────────────────────────────────────────────────────────────

  const holdCart = () => {
    if (cart.length === 0) { error('Panier vide, rien à mettre en attente'); return; }
    const held: HeldCart = {
      id: crypto.randomUUID(),
      label: customer ? customer.name : `Ticket #${heldCarts.length + 1}`,
      cart: [...cart], customer, discount,
      savedAt: new Date().toISOString(),
    };
    setHeldCarts(h => [...h, held]);
    setCart([]); setDiscount(0); setCustomer(null);
    success('Ticket mis en attente');
  };

  const resumeHeld = (h: HeldCart) => {
    if (cart.length > 0 && !confirm('Remplacer le panier actuel par ce ticket en attente ?')) return;
    setCart(h.cart); setCustomer(h.customer); setDiscount(h.discount);
    setHeldCarts(held => held.filter(x => x.id !== h.id));
    setHoldOpen(false);
  };

  const deleteHeld = (id: string) => setHeldCarts(h => h.filter(x => x.id !== id));

  // ─── Session open ─────────────────────────────────────────────────────────

  const openSessionSubmit = async () => {
    if (!tenant || !currentSite || !profile) return;
    if (!can('pos_open_session')) { error('Vous n\'avez pas la permission d\'ouvrir une session'); return; }
    setOpeningSubmitting(true);
    const { data, error: e } = await supabase.from('cash_sessions').insert({
      tenant_id: tenant.id, site_id: currentSite.id, user_id: profile.id,
      opening_amount: openingAmount, opening_note: openingNote, status: 'open',
    }).select().single();
    setOpeningSubmitting(false);
    if (e) { error(e.message); return; }
    setSession(data); setScreen('pos'); success('Caisse ouverte');
  };

  const leaveSession = () => {
    setCart([]); setDiscount(0); setCustomer(null);
    onLeave?.();
  };

  // ─── Payment ──────────────────────────────────────────────────────────────

  const openPayment = () => {
    if (cart.length === 0) { error('Panier vide'); return; }
    if (!session) { error('Ouvrez d\'abord la caisse'); return; }
    setPayments([]);
    setPayOpen(true);
  };


  const validateCreditSale = async () => {
    if (!session || !currentSite) return;
    if (!customer) { error('Sélectionnez un client pour une vente à crédit'); return; }
    if (cart.length === 0) { error('Panier vide'); return; }
    if ((customer as any).credit_blocked) { error('Ventes à crédit bloquées pour ce client'); return; }
    const limit = Number((customer as any).credit_limit || 0);
    const currentBalance = Number((customer as any).balance || 0);
    if (limit > 0 && (currentBalance + total) > limit) {
      error(`Plafond crédit dépassé (${formatFCFA(limit)}). Solde actuel : ${formatFCFA(currentBalance)}`);
      return;
    }
    setPaying(true);
    const saleItems = cart.map(i => ({
      article_id: i.article_id, name: i.name, quantity: i.quantity,
      unit_price: i.unit_price, discount: i.discount, purchase_cost: i.purchase_cost,
    }));
    const { data, error: e } = await supabase.rpc('create_credit_sale', {
      p_site_id: currentSite.id,
      p_cash_session_id: session.id,
      p_customer_id: customer.id,
      p_items: saleItems,
      p_discount: discount,
      p_note: '',
    });
    setPaying(false);
    if (e) { error(e.message); return; }
    const saleNum = (data as any)?.sale_number || `VTE-${Date.now()}`;
    setLastSale({
      sale_number: saleNum, created_at: new Date().toISOString(),
      total, discount, items: [...cart], payments: [], customer,
    });
    setPrintInvoice(false);
    success('Vente à crédit enregistrée');
    setCart([]); setDiscount(0); setCustomer(null); setPayments([]); setPayOpen(false); setMobileCartOpen(false);
    load();
  };

  // ─── Customer payment (encaissement libre) ────────────────────────────────

  const openCustomerPayment = () => {
    if (!session) { error('Ouvrez d\'abord la caisse'); return; }
    setCustPayOpen(true);
    setCustPayCustomer(null);
    setCustPayUnpaid([]);
    setCustPaySaleId('');
    setCustPayAmount(0);
    setCustPayMethod(methods[0] || null);
    setCustPayRef('');
    setCustPaySearch('');
  };

  const loadCustomerUnpaid = async (c: Customer) => {
    if (!tenant) return;
    setCustPayCustomer(c);
    const { data } = await supabase.from('sales')
      .select('id, sale_number, total, paid, status, created_at')
      .eq('tenant_id', tenant.id).eq('customer_id', c.id).neq('status', 'cancelled')
      .order('created_at', { ascending: true });
    const unpaid = (data || [])
      .map((s: any) => ({ ...s, total: Number(s.total), paid: Number(s.paid) }))
      .filter((s: any) => s.paid < s.total);
    setCustPayUnpaid(unpaid);
    setCustPaySaleId('');
    const totalDue = unpaid.reduce((a, s) => a + (s.total - s.paid), 0);
    setCustPayAmount(totalDue);
  };

  const openMovement = () => {
    if (!session) { error('Ouvrez d\'abord la caisse'); return; }
    setMvOpen(true);
    setMvKind('expense');
    setMvAmount(0); setMvReason(''); setMvNote(''); setMvRef('');
    setMvMethod(methods[0] || null);
    setMvCustomer(null); setMvCustSearch('');
  };

  const submitMovement = async () => {
    if (!session || !currentSite) return;
    if (!can('pos_cash_movement')) { error('Vous n\'avez pas la permission d\'enregistrer un mouvement de caisse'); return; }
    if (mvAmount <= 0) { error('Montant invalide'); return; }
    if (mvKind !== 'expense' && !mvMethod) { error('Mode de règlement requis'); return; }
    if (mvKind === 'customer_prepayment' && !mvCustomer) { error('Client obligatoire'); return; }
    setMvSubmitting(true);
    const { data, error: e } = await supabase.rpc('record_cash_movement', {
      p_cash_session_id: session.id,
      p_site_id: currentSite.id,
      p_kind: mvKind,
      p_amount: mvAmount,
      p_reason: mvReason,
      p_note: mvNote,
      p_reference: mvRef,
      p_customer_id: mvCustomer?.id || null,
      p_payment_method_id: mvMethod?.id || null,
      p_method_name: mvMethod?.name || '',
    });
    setMvSubmitting(false);
    if (e) { error(e.message); return; }
    const autoApplied = Number((data as any)?.auto_applied || 0);
    if (mvKind === 'customer_prepayment' && autoApplied > 0) {
      success(`Acompte enregistré · ${formatFCFA(autoApplied)} imputé automatiquement`);
    } else if (mvKind === 'expense') {
      success('Dépense enregistrée');
    } else if (mvKind === 'income') {
      success('Entrée enregistrée');
    } else {
      success('Acompte enregistré · en attente de facture');
    }
    setMvOpen(false);
  };

  const submitCustomerPayment = async () => {
    if (!session || !custPayCustomer || !custPayMethod) return;
    if (custPayAmount <= 0) { error('Montant invalide'); return; }
    setCustPaySubmitting(true);
    const { error: e } = await supabase.rpc('register_customer_payment', {
      p_customer_id: custPayCustomer.id,
      p_payment_method_id: custPayMethod.id,
      p_method_name: custPayMethod.name,
      p_amount: custPayAmount,
      p_reference: custPayRef,
      p_cash_session_id: session.id,
      p_sale_id: custPaySaleId || null,
    });
    setCustPaySubmitting(false);
    if (e) { error(e.message); return; }
    success('Règlement encaissé');
    setCustPayOpen(false);
    load();
  };

  const validateSale = async () => {
    if (!session || !currentSite || !tenant) return;
    if (discount > 0 && !can('apply_discounts')) { error('Vous n\'avez pas la permission d\'appliquer des remises'); return; }
    if (totalPaid < total && !customer) { error('Sélectionnez un client pour un paiement partiel'); return; }

    const stockMethod = (tenant as any)?.settings?.stock_method || 'none';

    // If lot mode, close payment modal and open lot picker for manual selection
    if (stockMethod === 'lot') {
      setPayOpen(false);
      setLotPickerOpen(true);
      return;
    }

    await executeSale(null);
  };

  const executeSale = async (lotSelections: ArticleLotSelection[] | null) => {
    if (!session || !currentSite) return;
    setLotPickerOpen(false);
    setPaying(true);
    const saleItems = cart.map(i => ({
      article_id: i.article_id, name: i.name, quantity: i.quantity,
      unit_price: i.unit_price, discount: i.discount, purchase_cost: i.purchase_cost,
    }));
    const salePayments = payments.map(p => ({
      payment_method_id: p.payment_method_id, method_name: p.method_name,
      amount: p.amount, reference: p.reference,
    }));
    const stockMethod = (tenant as any)?.settings?.stock_method || 'none';
    const rpcName = stockMethod === 'lot' ? 'create_pos_sale_lot' : 'create_pos_sale';

    // Build lot assignments map for manual selection
    let lotAssignments: Record<string, { lot_id: string; quantity: number }[]> | null = null;
    if (lotSelections) {
      lotAssignments = {};
      for (const s of lotSelections) {
        const assigned = s.assignments.filter(a => a.quantity > 0).map(a => ({ lot_id: a.lot_id, quantity: a.quantity }));
        if (assigned.length > 0) lotAssignments[s.article_id] = assigned;
      }
    }

    const params: any = {
      p_site_id: saleSourceSiteId || currentSite.id,
      p_cash_session_id: session.id,
      p_customer_id: customer?.id || null,
      p_items: saleItems,
      p_payments: salePayments,
      p_discount: discount,
      p_note: '',
    };
    if (rpcName === 'create_pos_sale_lot' && lotAssignments && Object.keys(lotAssignments).length > 0) {
      params.p_lot_assignments = lotAssignments;
    }

    const { data, error: e } = await supabase.rpc(rpcName, params);
    setPaying(false);
    if (e) { error(e.message); return; }
    const saleNum = (data as any)?.sale_number || `VTE-${Date.now()}`;
    const saleId = (data as any)?.sale_id || (data as any)?.id || null;

    // Save document header fields if any were filled
    if (saleId && (docDeliveryDate || docReference || docWarranty || docRepresentative)) {
      const docHeader: Record<string, string | null> = {};
      if (docDeliveryDate) docHeader.delivery_date = docDeliveryDate;
      if (docReference) docHeader.reference = docReference;
      if (docWarranty) docHeader.warranty = docWarranty;
      if (docRepresentative) docHeader.representative = docRepresentative;
      supabase.from('sales').update({ doc_header: docHeader }).eq('id', saleId).then(() => {});
    }

    setLastSale({
      sale_number: saleNum, created_at: new Date().toISOString(),
      total, discount, items: [...cart], payments: [...payments], customer,
    });
    setPrintInvoice(false);
    // Link to web order if this sale originated from one
    const pendingWeb = (window as any).__pendingWebOrderId as string | undefined;
    if (pendingWeb && tenant && saleId) {
      await supabase.from('online_orders').update({
        status: 'livree', payment_status: 'paye', sale_id: saleId,
      }).eq('id', pendingWeb).eq('tenant_id', tenant.id);
      await supabase.rpc('log_online_order_status', {
        p_order_id: pendingWeb, p_old_status: 'prete', p_new_status: 'livree', p_note: `Transformée en vente ${saleNum}`,
      }).then(() => {}).catch(() => {});
      (window as any).__pendingWebOrderId = undefined;
    }
    // Auto-apply available avoirs for this customer
    if (customer?.id && saleId) {
      await supabase.rpc('auto_apply_customer_avoirs', { p_sale_id: saleId });
    }
    success('Vente enregistrée');
    setCart([]); setDiscount(0); setCustomer(null); setPayments([]); setPayOpen(false); setMobileCartOpen(false);
    setDocDeliveryDate(''); setDocReference(''); setDocWarranty(''); setDocRepresentative(posDocSettings.default_representative || '');
    load();
  };

  // ─── Return ticket ────────────────────────────────────────────────────────

  const openReturn = async () => {
    if (!can('pos_returns')) { error('Vous n\'avez pas la permission d\'effectuer des retours'); return; }
    setReturnOpen(true); setReturnSelected(null); setReturnLines([]);
    setReturnLoading(true);
    const { data } = await supabase
      .from('sales')
      .select('id, sale_number, total, created_at, customers(name, phone, address), status, sale_items(article_id, name, quantity, unit_price)')
      .eq('tenant_id', tenant!.id)
      .eq('cash_session_id', session!.id)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false });

    // Fetch already-returned quantities for these sales
    const saleIds = (data || []).map((s: any) => s.id);
    let returnedMap: Record<string, Record<string, number>> = {};
    if (saleIds.length > 0) {
      const { data: retData } = await supabase
        .from('sale_returns')
        .select('sale_id, sale_return_items(article_id, quantity)')
        .eq('tenant_id', tenant!.id)
        .in('sale_id', saleIds);
      for (const ret of retData || []) {
        if (!returnedMap[ret.sale_id]) returnedMap[ret.sale_id] = {};
        for (const ri of (ret as any).sale_return_items || []) {
          returnedMap[ret.sale_id][ri.article_id] = (returnedMap[ret.sale_id][ri.article_id] || 0) + Number(ri.quantity);
        }
      }
    }

    setReturnSales((data || []).map((s: any) => {
      const items = (s.sale_items || []).map((i: any) => {
        const alreadyReturned = returnedMap[s.id]?.[i.article_id] || 0;
        return { article_id: i.article_id || '', name: i.name, quantity: Number(i.quantity), unit_price: Number(i.unit_price), returned: alreadyReturned };
      });
      const fullyReturned = items.every((i: any) => i.returned >= i.quantity);
      return {
        id: s.id, sale_number: s.sale_number, total: Number(s.total),
        created_at: s.created_at, customer_name: s.customers?.name || null, customer_phone: s.customers?.phone || null, customer_address: s.customers?.address || null, status: s.status,
        items, fullyReturned,
      };
    }));
    setReturnLoading(false);
  };

  const selectReturnSale = (s: SessionSale) => {
    setReturnSelected(s);
    setReturnSearch('');
    setReturnLines(s.items.map(i => {
      const remaining = i.quantity - (i.returned || 0);
      return { ...i, quantity: remaining, maxQty: remaining, selected: remaining > 0 };
    }));
  };

  const [returnProcessing, setReturnProcessing] = useState(false);

  const processReturn = async () => {
    if (!returnSelected || !tenant || !currentSite || !session) return;
    if (!can('pos_returns')) { error('Vous n\'avez pas la permission d\'effectuer des retours'); return; }
    const lines = returnLines.filter(l => l.selected && l.quantity > 0);
    if (lines.length === 0) { error('Aucun article sélectionné'); return; }
    const returnTotal = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);

    setReturnProcessing(true);
    try {
      // 1. Adjust stock (increase for each returned item)
      for (const item of lines) {
        if (!item.article_id) continue;
        await supabase.rpc('adjust_stock', {
          p_article_id: item.article_id,
          p_site_id: currentSite.id,
          p_quantity: item.quantity,
          p_movement_type: 'return_customer',
          p_note: `Retour POS - ${returnSelected.sale_number}`,
        });
      }

      // 2. Create a sale_returns record for traceability
      const retNum = `RET-${returnSelected.sale_number}-${Date.now().toString(36).toUpperCase().slice(-4)}`;
      const { data: retInserted } = await supabase.from('sale_returns').insert({
        tenant_id: tenant.id,
        site_id: currentSite.id,
        sale_id: returnSelected.id,
        cash_session_id: session.id,
        return_number: retNum,
        total: returnTotal,
        refund_method: 'cash',
        reason: 'Retour au POS',
        restock: true,
        status: 'approved',
      }).select('id').single();

      // 3. Insert sale_return_items for each returned line
      if (retInserted?.id) {
        await supabase.from('sale_return_items').insert(
          lines.map(l => ({
            tenant_id: tenant.id,
            return_id: retInserted.id,
            article_id: l.article_id || null,
            name: l.name,
            quantity: l.quantity,
            unit_price: l.unit_price,
            total: l.quantity * l.unit_price,
          }))
        );
      }

      // 4. Record cash movement (expense) with article names in label
      const articleNames = lines.map(l => `${l.name}${l.quantity > 1 ? ' x' + l.quantity : ''}`).join(', ');
      await supabase.from('cash_movements').insert({
        tenant_id: tenant.id,
        site_id: currentSite.id,
        cash_session_id: session.id,
        user_id: profile?.id || null,
        kind: 'expense',
        amount: returnTotal,
        reason: `Retour ${retNum}: ${articleNames}`,
        note: `Réf. vente: ${returnSelected.sale_number}`,
        reference: retNum,
      });

      // 5. Decrease cash session theoretical_amount
      await supabase.from('cash_sessions').update({
        theoretical_amount: Math.max(0, (session as any).theoretical_amount - returnTotal),
      }).eq('id', session.id);

      // 6. Print the return ticket
      printReturnTicket80Shared(returnSelected.sale_number, lines, returnTotal, tenantForPrint, cashierName, retNum);

      setReturnOpen(false);
      success(`Retour effectue: -${formatFCFA(returnTotal)} rembourse`);
      load();
    } catch (e: any) {
      error(e.message || 'Erreur lors du retour');
    } finally {
      setReturnProcessing(false);
    }
  };

  const filteredReturnSales = useMemo(() => {
    const q = returnSearch.toLowerCase().trim();
    if (!q) return returnSales;
    return returnSales.filter(s => s.sale_number.toLowerCase().includes(q) || (s.customer_name || '').toLowerCase().includes(q));
  }, [returnSales, returnSearch]);

  // ─── Session tickets ──────────────────────────────────────────────────────

  const openTickets = async () => {
    setTicketsOpen(true); setLoadingTickets(true);
    const [{ data }, { data: retData }] = await Promise.all([
      supabase
        .from('sales')
        .select('id, sale_number, total, created_at, customers(name, phone, address), status, sale_items(article_id, name, quantity, unit_price)')
        .eq('tenant_id', tenant!.id)
        .eq('cash_session_id', session!.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('sale_returns')
        .select('id, return_number, total, created_at, sale_id')
        .eq('tenant_id', tenant!.id)
        .eq('cash_session_id', session!.id)
        .order('created_at', { ascending: false }),
    ]);
    const sales: SessionSale[] = (data || []).map((s: any) => ({
      id: s.id, sale_number: s.sale_number, total: Number(s.total),
      created_at: s.created_at, customer_name: s.customers?.name || null, customer_phone: s.customers?.phone || null, customer_address: s.customers?.address || null, status: s.status,
      items: (s.sale_items || []).map((i: any) => ({ article_id: i.article_id || '', name: i.name, quantity: Number(i.quantity), unit_price: Number(i.unit_price) })),
    }));
    const returns: SessionSale[] = (retData || []).map((r: any) => ({
      id: r.id, sale_number: r.return_number, total: -Number(r.total),
      created_at: r.created_at, customer_name: null, customer_phone: null, customer_address: null, status: 'return',
      items: [],
    }));
    setSessionSales([...sales, ...returns].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
    setLoadingTickets(false);
  };

  // ─── Web orders ───────────────────────────────────────────────────────────

  const loadWebOrders = useCallback(async () => {
    if (!tenant) return;
    setWebOrdersLoading(true);
    const { data } = await supabase
      .from('online_orders')
      .select('id, order_number, status, payment_status, delivery_mode, delivery_address, payment_mode, customer_name, customer_phone, customer_whatsapp, customer_note, subtotal, delivery_fee, total, created_at, sale_id')
      .eq('tenant_id', tenant.id)
      .in('status', ['nouvelle', 'confirmee', 'en_preparation', 'prete', 'livree'])
      .order('created_at', { ascending: false })
      .limit(200);
    setWebOrders((data || []) as WebOrder[]);
    setWebOrdersLoading(false);
  }, [tenant]);

  // Fetch badge count on mount
  useEffect(() => { if (tenant) loadWebOrders(); }, [tenant, loadWebOrders]);

  const openWebOrders = () => {
    setWebOrdersOpen(true);
    setWebOrderDetail(null);
    setWebOrderItems([]);
    loadWebOrders();
  };

  const openWebOrderDetail = async (o: WebOrder) => {
    setWebOrderDetail(o);
    const { data } = await supabase
      .from('online_order_items')
      .select('id, article_id, article_name, internal_ref, quantity, unit_price, line_total')
      .eq('order_id', o.id);
    setWebOrderItems((data || []) as WebOrderItem[]);
  };

  const loadToCartFromWebOrder = () => {
    if (!webOrderDetail || webOrderItems.length === 0) return;
    if (cart.length > 0 && !confirm('Remplacer le panier actuel par cette commande web ?')) return;
    const newCart: CartItem[] = [];
    const missing: string[] = [];
    for (const it of webOrderItems) {
      const a = articles.find(x => x.id === it.article_id);
      if (!a) { missing.push(it.article_name); continue; }
      const allowNeg = !!(tenant as any)?.settings?.allow_negative_stock;
      if (!allowNeg && a.stock_available < it.quantity) {
        error(`Stock insuffisant pour "${a.name}" (${a.stock_available} dispo / ${it.quantity} requis)`);
        return;
      }
      newCart.push({
        article_id: a.id, name: a.name, internal_ref: a.internal_ref, oem_ref: a.oem_ref,
        quantity: it.quantity, unit_price: Number(it.unit_price), discount: 0,
        stock_available: a.stock_available, purchase_cost: a.purchase_price,
      });
    }
    if (missing.length > 0) { error(`Articles introuvables: ${missing.join(', ')}`); return; }
    setCart(newCart);
    setDiscount(0);
    setCustomer(null);
    setWebOrdersOpen(false);
    setMobileCartOpen(true);
    success(`Commande ${webOrderDetail.order_number} chargée. Validez le paiement pour finaliser.`);
    // Remember pending web order id for post-sale linking
    (window as any).__pendingWebOrderId = webOrderDetail.id;
  };

  const markWebOrderDelivered = async (o: WebOrder) => {
    if (!tenant) return;
    if (!o.sale_id) { error('Commande non transformée en vente'); return; }
    const { error: e } = await supabase
      .from('online_orders')
      .update({ status: 'livree', payment_status: 'paye' })
      .eq('id', o.id).eq('tenant_id', tenant.id);
    if (e) { error(e.message); return; }
    await supabase.rpc('log_online_order_status', {
      p_order_id: o.id, p_old_status: o.status, p_new_status: 'livree', p_note: 'Livrée depuis caisse',
    }).then(() => {}).catch(() => {});
    success('Commande marquée comme livrée');
    loadWebOrders();
  };

  const cancelWebOrder = async (o: WebOrder) => {
    if (!tenant) return;
    if (!confirm(`Annuler la commande ${o.order_number} ?`)) return;
    const { error: e } = await supabase
      .from('online_orders')
      .update({ status: 'annulee' })
      .eq('id', o.id).eq('tenant_id', tenant.id);
    if (e) { error(e.message); return; }
    await supabase.rpc('log_online_order_status', {
      p_order_id: o.id, p_old_status: o.status, p_new_status: 'annulee', p_note: 'Annulée depuis caisse',
    }).then(() => {}).catch(() => {});
    success('Commande annulée');
    loadWebOrders();
    setWebOrderDetail(null);
  };

  const webOrdersFiltered = useMemo(() => {
    return webOrders.filter(o => {
      if (webOrdersFilter === 'all') return true;
      if (webOrdersFilter === 'a_transformer') return !o.sale_id && o.status !== 'annulee' && o.status !== 'livree';
      if (webOrdersFilter === 'livraison') return o.delivery_mode === 'livraison' && o.status !== 'annulee';
      if (webOrdersFilter === 'attente_paiement') return o.payment_status !== 'paye' && o.status !== 'annulee';
      return true;
    });
  }, [webOrders, webOrdersFilter]);

  const webOrdersCounts = useMemo(() => ({
    a_transformer: webOrders.filter(o => !o.sale_id && o.status !== 'annulee' && o.status !== 'livree').length,
    livraison: webOrders.filter(o => o.delivery_mode === 'livraison' && o.status !== 'annulee').length,
    attente_paiement: webOrders.filter(o => o.payment_status !== 'paye' && o.status !== 'annulee').length,
  }), [webOrders]);

  // ─── Stats ────────────────────────────────────────────────────────────────

  const openStats = async () => {
    if (!session || !tenant) return;
    setStatsOpen(true); setLoadingStats(true);
    const [{ data: sales }, { data: pmtRows }, { data: mvRows }] = await Promise.all([
      supabase.from('sales').select('id, total, sale_items(name, quantity, total)').eq('tenant_id', tenant.id).eq('cash_session_id', session.id).neq('status', 'cancelled'),
      supabase.from('sale_payments').select('method_name, amount, created_at, reference, sale_id, sales(sale_number, cash_session_id, customers(name))').eq('tenant_id', tenant.id).eq('cash_session_id', session.id).order('created_at'),
      supabase.from('cash_movements').select('kind, amount, reason, method_name, customers(name)').eq('tenant_id', tenant.id).eq('cash_session_id', session.id).order('created_at'),
    ]);
    const salesList = sales || [];
    const pmtList = pmtRows || [];
    const byMethod: Record<string, number> = {};
    pmtList.forEach((p: any) => { byMethod[p.method_name] = (byMethod[p.method_name] || 0) + Number(p.amount); });
    const invoicePayments = pmtList
      .filter((p: any) => !p.sales || p.sales.cash_session_id !== session.id)
      .map((p: any) => ({
        sale_number: p.sales?.sale_number || '',
        amount: Number(p.amount),
        method_name: p.method_name || '',
        customer_name: p.sales?.customers?.name || null,
        created_at: p.created_at || '',
        user_name: profile?.full_name || profile?.email || null,
      }));
    const articleMap: Record<string, { name: string; qty: number; total: number }> = {};
    salesList.forEach((s: any) => {
      (s.sale_items || []).forEach((item: any) => {
        if (!articleMap[item.name]) articleMap[item.name] = { name: item.name, qty: 0, total: 0 };
        articleMap[item.name].qty += Number(item.quantity);
        articleMap[item.name].total += Number(item.total);
      });
    });
    const topArticles = Object.values(articleMap).sort((a, b) => b.total - a.total).slice(0, 10);
    const movs = (mvRows || []).map((m: any) => ({
      kind: m.kind as 'expense' | 'income' | 'customer_prepayment',
      amount: Number(m.amount), reason: m.reason || '',
      method_name: m.method_name || '', customer_name: m.customers?.name || null,
    })).filter(m => !(m.kind === 'income' && m.reason.startsWith('Reglement ')));
    const movExpense = movs.filter(m => m.kind === 'expense').reduce((s, m) => s + m.amount, 0);
    const movIncome = movs.filter(m => m.kind === 'income').reduce((s, m) => s + m.amount, 0);
    const movPrepay = movs.filter(m => m.kind === 'customer_prepayment').reduce((s, m) => s + m.amount, 0);
    const totalPayments = pmtList.reduce((s: number, p: any) => s + Number(p.amount), 0);
    setStatsData({
      count: salesList.length,
      total: totalPayments,
      byMethod: Object.entries(byMethod).map(([method_name, amount]) => ({ method_name, amount })),
      topArticles,
      movements: movs,
      invoicePayments,
      movExpense, movIncome, movPrepay,
      netTotal: totalPayments + movIncome + movPrepay - movExpense,
    });
    setLoadingStats(false);
  };

  // ─── Close workflow ───────────────────────────────────────────────────────

  const openCloseWorkflow = async () => {
    if (!session || !tenant) return;
    if (!can('pos_close_session')) { error('Vous n\'avez pas la permission de cloturer la session'); return; }
    setCloseStep('control');
    setLoadingControl(true);
    setCloseOpen(true);

    const [{ data: pmts }, { data: regs }, salesResult, { data: mvs }] = await Promise.all([
      supabase.from('sale_payments').select('payment_method_id, method_name, amount, created_at, sales(sale_number, cash_session_id, customers(name))').eq('tenant_id', tenant.id).eq('cash_session_id', session.id).order('created_at'),
      supabase.from('cash_regularizations').select('reg_type, amount, reason, note').eq('tenant_id', tenant.id).eq('cash_session_id', session.id).order('created_at'),
      supabase.from('sales').select('id, total, sale_items(name, quantity, total)').eq('tenant_id', tenant.id).eq('cash_session_id', session.id).neq('status', 'cancelled'),
      supabase.from('cash_movements').select('kind, amount, payment_method_id, method_name, reason, customers(name)').eq('tenant_id', tenant.id).eq('cash_session_id', session.id).order('created_at'),
    ]);

    // Build theoretical per method — include sale payments + cash movements
    const pmtList = pmts || [];
    const theoretical: Record<string, { method_name: string; payment_method_id: string | null; amount: number }> = {};
    pmtList.forEach((p: any) => {
      const key = p.method_name;
      if (!theoretical[key]) theoretical[key] = { method_name: p.method_name, payment_method_id: p.payment_method_id, amount: 0 };
      theoretical[key].amount += Number(p.amount);
    });
    (mvs || []).forEach((m: any) => {
      if (m.kind === 'income' && m.reason && m.reason.startsWith('Reglement ')) return;
      const key = m.method_name || (m.kind === 'expense' ? 'Espèces' : '—');
      if (!theoretical[key]) theoretical[key] = { method_name: key, payment_method_id: m.payment_method_id, amount: 0 };
      if (m.kind === 'expense') {
        theoretical[key].amount -= Number(m.amount);
      } else {
        theoretical[key].amount += Number(m.amount);
      }
    });

    const lines: ControlLine[] = methods.map(m => {
      const th = theoretical[m.name];
      let base = th ? th.amount : 0;
      const isCash = m.name.toLowerCase().includes('espèce') || m.name.toLowerCase().includes('liquide') || m.name.toLowerCase().includes('cash') || m.payment_type === 'cash';
      if (isCash && Number(session.opening_amount) > 0) base += Number(session.opening_amount);
      return { payment_method_id: m.id, method_name: m.name, theoretical_amount: base, counted_amount: base };
    });
    Object.values(theoretical).forEach(t => {
      if (!lines.find(l => l.method_name === t.method_name)) {
        lines.push({ payment_method_id: t.payment_method_id, method_name: t.method_name, theoretical_amount: t.amount, counted_amount: t.amount });
      }
    });

    // Build stats for X report
    const salesList = salesResult.data || [];
    const byMethod: Record<string, number> = {};
    pmtList.forEach((p: any) => { byMethod[p.method_name] = (byMethod[p.method_name] || 0) + Number(p.amount); });
    const invoicePayments = pmtList
      .filter((p: any) => !p.sales || p.sales.cash_session_id !== session.id)
      .map((p: any) => ({
        sale_number: p.sales?.sale_number || '',
        amount: Number(p.amount),
        method_name: p.method_name || '',
        customer_name: p.sales?.customers?.name || null,
        created_at: p.created_at || '',
        user_name: profile?.full_name || profile?.email || null,
      }));
    const articleMap: Record<string, { name: string; qty: number; total: number }> = {};
    salesList.forEach((s: any) => {
      (s.sale_items || []).forEach((item: any) => {
        if (!articleMap[item.name]) articleMap[item.name] = { name: item.name, qty: 0, total: 0 };
        articleMap[item.name].qty += Number(item.quantity);
        articleMap[item.name].total += Number(item.total);
      });
    });
    const movList = (mvs || []).map((m: any) => ({
      kind: m.kind as 'expense' | 'income' | 'customer_prepayment',
      amount: Number(m.amount), reason: m.reason || '',
      method_name: m.method_name || '', customer_name: m.customers?.name || null,
    })).filter(m => !(m.kind === 'income' && m.reason.startsWith('Reglement ')));
    const movExpense = movList.filter(m => m.kind === 'expense').reduce((s, m) => s + m.amount, 0);
    const movIncome = movList.filter(m => m.kind === 'income').reduce((s, m) => s + m.amount, 0);
    const movPrepay = movList.filter(m => m.kind === 'customer_prepayment').reduce((s, m) => s + m.amount, 0);
    const totalSales = salesList.reduce((s: number, r: any) => s + Number(r.total), 0);
    const totalPayments = pmtList.reduce((s: number, p: any) => s + Number(p.amount), 0);
    setStatsData({
      count: salesList.length,
      total: totalSales,
      byMethod: Object.entries(byMethod).map(([method_name, amount]) => ({ method_name, amount })),
      topArticles: Object.values(articleMap).sort((a, b) => b.total - a.total).slice(0, 10),
      movements: movList,
      invoicePayments,
      movExpense, movIncome, movPrepay,
      netTotal: totalPayments + movIncome + movPrepay - movExpense,
    });

    setControlLines(lines);
    setSessionRegs(regs || []);
    setLoadingControl(false);
  };

  const totalVariance = controlLines.reduce((s, c) => s + (c.counted_amount - c.theoretical_amount), 0);

  const saveRegularization = async () => {
    if (!session || !tenant || !profile) return;
    if (regAmount <= 0) { error('Montant invalide'); return; }
    setSavingReg(true);
    const { error: e } = await supabase.from('cash_regularizations').insert({
      tenant_id: tenant.id, cash_session_id: session.id,
      reg_type: regType, amount: regAmount, reason: regReason, note: regNote, user_id: profile.id,
    });
    setSavingReg(false);
    if (e) { error(e.message); return; }
    setSessionRegs(r => [...r, { reg_type: regType, amount: regAmount, reason: regReason, note: regNote }]);
    setRegOpen(false); setRegAmount(0); setRegReason(''); setRegNote('');
    success('Régularisation enregistrée');
  };

  const confirmClose = async () => {
    if (!session || !tenant) return;
    if (!can('pos_close_session')) { error('Vous n\'avez pas la permission de cloturer la session'); return; }
    setClosing(true);
    const ctrlRows = controlLines.map(c => ({
      tenant_id: tenant.id, cash_session_id: session.id,
      payment_method_id: c.payment_method_id, method_name: c.method_name,
      theoretical_amount: c.theoretical_amount, counted_amount: c.counted_amount,
    }));
    await supabase.from('cash_control_lines').insert(ctrlRows);
    const countedTotal = controlLines.reduce((s, c) => s + c.counted_amount, 0);
    const { error: e } = await supabase.from('cash_sessions').update({
      status: 'closed', closed_at: new Date().toISOString(),
      closing_amount: countedTotal, counted_cash: countedTotal,
      variance: totalVariance, closing_note: closingNote, updated_at: new Date().toISOString(),
    }).eq('id', session.id);
    setClosing(false);
    if (e) { error(e.message); return; }
    if (statsData) {
      printXReport(
        { ...session, closing_note: closingNote } as any, controlLines, statsData, sessionRegs,
        { name: tenant.name, ninea: (tenant as any).ninea, rccm: (tenant as any).rccm, address: (tenant as any).address },
        profile?.full_name || profile?.email || '', currentSite?.name || ''
      );
    }
    success('Caisse clôturée');
    setCloseOpen(false); setSession(null); setScreen('open-form');
    setCart([]); setDiscount(0); setCustomer(null);
    setOpeningAmount(0); setOpeningNote('');
    setControlLines([]); setSessionRegs([]); setStatsData(null);
    load();
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loadingData) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>;
  }

  // Screen: open form (no active session)
  if (screen === 'open-form') {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="w-full max-w-[1600px] mx-auto px-3 sm:px-5 lg:px-8 pt-3 sm:pt-4 lg:pt-6 pb-[92px] lg:pb-8">
          <POSGuide tenantId={tenant?.id} hasSession={false} businessType={(tenant as any)?.business_type} />
          <POSLandingOpen
            currentSite={currentSite}
            openingAmount={openingAmount}
            setOpeningAmount={setOpeningAmount}
            openingNote={openingNote}
            setOpeningNote={setOpeningNote}
            openingSubmitting={openingSubmitting}
            openSessionSubmit={openSessionSubmit}
            tenantId={tenant?.id}
            onSeeAll={onNavigate ? () => onNavigate('cash_history') : undefined}
            cashierName={cashierName}
          />
        </div>
      </div>
    );
  }

  // Screen: resume (active session found — opened by someone else or after "Quitter")
  const isResumeScreen = screen === 'resume' && !!session;

  // ─── Main POS screen ──────────────────────────────────────────────────────

  const CartPanel = (
    <div className="flex flex-col h-full bg-white">
      {/* Header — compact */}
      <div className="px-3 py-2 border-b border-slate-200/70 bg-white flex items-center gap-2">
        <span className="text-xs font-bold text-slate-900 leading-none">{cart.length} ligne{cart.length !== 1 ? 's' : ''}</span>
        <div className="flex-1" />
        {heldCarts.length > 0 && (
          <button onClick={() => setHoldOpen(true)} className="relative p-1.5 rounded-lg hover:bg-amber-50 text-amber-600 transition-colors" title="Tickets en attente">
            <List className="w-3.5 h-3.5" />
            <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 text-[9px] rounded-full bg-amber-500 text-white flex items-center justify-center font-bold">{heldCarts.length}</span>
          </button>
        )}
        {cart.length > 0 && (
          <button onClick={() => setCart([])} className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-colors" title="Vider">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
        <button onClick={() => setMobileCartOpen(false)} className="lg:hidden p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Customer selector — compact */}
      <div className="px-3 py-1.5 border-b border-slate-200/70 bg-white">
        <SearchableSelect
          options={[{ value: '', label: 'Client comptoir' }, ...customers.map(c => ({ value: c.id, label: c.name }))]}
          value={customer?.id || ''}
          onChange={v => setCustomer(customers.find(c => c.id === v) || null)}
          placeholder="Client comptoir"
        />
        {customer && (() => {
          const limit = Number((customer as any).credit_limit || 0);
          const balance = Number((customer as any).balance || 0);
          const blocked = (customer as any).credit_blocked;
          if (blocked) return <div className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-red-600"><AlertTriangle className="w-3 h-3" />Crédit bloqué</div>;
          if (limit > 0) {
            const usage = Math.round((balance / limit) * 100);
            const isOver = balance >= limit;
            const isNear = usage >= 80;
            if (isOver || isNear) return <div className={`mt-1 flex items-center gap-1 text-[10px] font-semibold ${isOver ? 'text-red-600' : 'text-amber-600'}`}><AlertTriangle className="w-3 h-3" />{isOver ? 'Plafond atteint' : `Crédit à ${usage}%`} ({formatFCFA(balance)}/{formatFCFA(limit)})</div>;
          }
          return null;
        })()}
      </div>

      {/* Cart lines */}
      <div className="flex-1 overflow-y-auto">
        {cart.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-400 p-6">
            <ShoppingCart className="w-8 h-8 opacity-30" />
            <p className="text-xs font-medium text-slate-400">Panier vide</p>
            {heldCarts.length > 0 && (
              <button onClick={() => setHoldOpen(true)} className="mt-1 chip text-amber-700 bg-amber-50 border-amber-200 hover:bg-amber-100 text-[11px]">
                <List className="w-3 h-3" />
                {heldCarts.length} ticket{heldCarts.length > 1 ? 's' : ''} en attente
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {cart.map(i => (
              <div key={i.article_id} className="group px-3 py-1.5 hover:bg-slate-50 transition-colors">
                {/* Row 1: name + delete */}
                <div className="flex items-center gap-1.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-slate-900 leading-snug truncate">{i.name}</div>
                    {i.tier_name && <div className="text-[9px] font-medium text-brand-600 leading-tight">{i.tier_name}</div>}
                  </div>
                  <button onClick={() => removeLine(i.article_id)} className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-50 text-red-400 transition-all shrink-0">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                {/* Row 2: qty stepper + price input + line total */}
                <div className="flex items-center gap-1.5 mt-1">
                  <div className="flex items-center bg-slate-100 rounded-lg shrink-0">
                    <button onClick={() => updateQty(i.article_id, -1)} className="w-6 h-6 flex items-center justify-center hover:bg-slate-200 rounded-l-lg active:scale-95 transition-all text-slate-600"><Minus className="w-3 h-3" /></button>
                    <input type="number" value={i.quantity} onChange={e => setQty(i.article_id, Number(e.target.value))} className="w-7 text-center bg-transparent text-xs font-bold num leading-none py-0" />
                    <button onClick={() => updateQty(i.article_id, 1)} className="w-6 h-6 flex items-center justify-center hover:bg-slate-200 rounded-r-lg active:scale-95 transition-all text-slate-600"><Plus className="w-3 h-3" /></button>
                  </div>
                  <input type="number" value={i.unit_price || ''} onChange={e => setPrice(i.article_id, Number(e.target.value))} className="flex-1 min-w-0 px-2 py-1 rounded-md border border-slate-200 bg-white text-[11px] text-right num focus:outline-none focus:border-brand-500" title="Prix unitaire" />
                  <div className="text-xs font-bold text-slate-900 num whitespace-nowrap min-w-[52px] text-right">{formatFCFA(i.quantity * i.unit_price - i.discount)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer totals + pay button */}
      <div className="border-t border-slate-200 px-3 pt-2 pb-3 bg-white pb-safe space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-500">Sous-total</span>
          <span className="font-semibold text-slate-800 num">{formatFCFA(subtotal)}</span>
        </div>
        {can('apply_discounts') && (
          <div className="flex items-center justify-between text-[11px] gap-2">
            <span className="text-slate-500 shrink-0">Remise</span>
            <input type="number" value={discount || ''} onChange={e => setDiscount(Math.max(0, Number(e.target.value)))} className="px-2 py-1 rounded-md border border-slate-200 bg-white text-[11px] text-right num w-24 focus:outline-none focus:border-brand-500" placeholder="0" />
          </div>
        )}
        <div className="flex items-center justify-between pt-1.5 border-t border-slate-200">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total</span>
          <div className="text-2xl font-bold text-slate-900 num leading-none">{formatFCFA(total)}</div>
        </div>
        <button onClick={openPayment} disabled={cart.length === 0}
          className="btn-icon-primary w-full h-10 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none mt-1">
          <CreditCard className="w-5 h-5" />
        </button>
      </div>
    </div>
  );

  return (
    <>
    {isResumeScreen && session ? (
      <div className="flex-1 overflow-y-auto">
        <div className="w-full max-w-[1600px] mx-auto px-3 sm:px-5 lg:px-8 pt-3 sm:pt-4 lg:pt-6 pb-[92px] lg:pb-8">
          <POSGuide tenantId={tenant?.id} hasSession={true} businessType={(tenant as any)?.business_type} />
          <POSLandingResume
            session={session}
            currentSite={currentSite}
            onResume={() => setScreen('pos')}
            tenantId={tenant?.id}
            onSeeAll={onNavigate ? () => onNavigate('cash_history') : undefined}
            cashierName={cashierName}
            actions={{
              onStats: openStats,
              onTickets: openTickets,
              onReturn: openReturn,
              onCustomerPayment: openCustomerPayment,
              onMovement: openMovement,
              onWebOrders: openWebOrders,
              onClose: openCloseWorkflow,
              canReturn: can('pos_returns'),
              canMovement: can('pos_cash_movement'),
              canClose: can('pos_close_session'),
              webOrdersBadge: webOrdersCounts.a_transformer,
              sessionOpen: session.status === 'open',
            }}
          />
        </div>
      </div>
    ) : (
    <>
    <POSGuide tenantId={tenant?.id} hasSession={!!session} businessType={(tenant as any)?.business_type} />
    <div className="flex-1 flex flex-col overflow-hidden w-full min-h-0" style={{ height: 'calc(100dvh - 56px - env(safe-area-inset-top))' }}>
      {/* Action bar */}
      <div className="px-2 py-1.5 border-b border-slate-200/70 glass shrink-0">
        {/* Mobile: single compact row */}
        <div className="flex items-center gap-1 lg:hidden">
          <button onClick={openStats} className="pos-btn hidden sm:flex" title="Stats"><BarChart2 className="w-4 h-4" /></button>
          <button onClick={openTickets} className="pos-btn" title="Tickets"><List className="w-4 h-4" /></button>
          {can('pos_returns') && <button onClick={openReturn} className="pos-btn" title="Retour"><RotateCcw className="w-4 h-4" /></button>}
          <button onClick={openCustomerPayment} className="pos-btn" title="Encaisser"><Wallet className="w-4 h-4" /></button>
          {can('pos_cash_movement') && <button onClick={openMovement} className="pos-btn" title="Mouvement"><ArrowDownRight className="w-4 h-4" /></button>}
          <button onClick={openWebOrders} className="pos-btn relative" title="Commandes web">
            <Globe className="w-4 h-4 text-brand-700" />
            {webOrdersCounts.a_transformer > 0 && <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 text-[8px] rounded-full bg-red-500 text-white flex items-center justify-center font-bold">{webOrdersCounts.a_transformer}</span>}
          </button>
          <button onClick={holdCart} className="pos-btn" title="Pause"><Pause className="w-4 h-4" /></button>
          <button onClick={leaveSession} className="pos-btn" title="Quitter"><LogOut className="w-4 h-4" /></button>
          {can('pos_close_session') && <button onClick={openCloseWorkflow} className="pos-btn-dark ml-0.5" title="Clôturer"><Lock className="w-4 h-4" /></button>}
        </div>
        {/* Desktop: EN SERVICE indicator + labeled chips */}
        <div className="hidden lg:flex items-center gap-1.5">
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="relative w-2 h-2">
              <div className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-60" />
              <div className="relative w-2 h-2 rounded-full bg-emerald-500" />
            </div>
            <span className="text-[10px] font-bold text-emerald-700 tracking-wide">En service</span>
            <span className="text-[10px] text-slate-400 ml-1">· Fond&nbsp;<span className="font-bold text-slate-600 num">{formatFCFA(Number(session!.opening_amount))}</span></span>
          </div>
          <div className="flex-1" />
          <button onClick={openStats} className="chip"><BarChart2 className="w-3.5 h-3.5" /><span className="hidden xl:inline">Stats</span></button>
          <button onClick={openTickets} className="chip"><List className="w-3.5 h-3.5" /><span className="hidden xl:inline">Tickets</span></button>
          {can('pos_returns') && <button onClick={openReturn} className="chip"><RotateCcw className="w-3.5 h-3.5" /><span className="hidden xl:inline">Retour</span></button>}
          <button onClick={openCustomerPayment} className="chip"><Wallet className="w-3.5 h-3.5" /><span className="hidden xl:inline">Encaisser</span></button>
          {can('pos_cash_movement') && <button onClick={openMovement} className="chip"><ArrowDownRight className="w-3.5 h-3.5" /><span className="hidden xl:inline">Mouvement</span></button>}
          <button onClick={openWebOrders} className="chip relative">
            <Globe className="w-3.5 h-3.5 text-brand-700" /><span className="hidden xl:inline">Commandes web</span>
            {webOrdersCounts.a_transformer > 0 && <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 text-[9px] rounded-full bg-red-500 text-white flex items-center justify-center font-bold border border-white">{webOrdersCounts.a_transformer}</span>}
          </button>
          <button onClick={holdCart} className="chip"><Pause className="w-3.5 h-3.5" /><span className="hidden xl:inline">Pause</span></button>
          <button onClick={leaveSession} className="chip"><LogOut className="w-3.5 h-3.5" /><span className="hidden xl:inline">Quitter</span></button>
          {can('pos_close_session') && <button onClick={openCloseWorkflow} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-bold bg-ink-900 text-white hover:bg-ink-800 transition-all active:scale-95 shadow-sm">
            <Lock className="w-3.5 h-3.5" /><span>Clôturer</span>
          </button>}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="px-3 sm:px-4 pt-4 pb-3 glass border-b border-slate-200/60 sticky top-0 z-10">
            <div className="flex gap-2">
              <div className="flex-1 min-w-0 flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-2xl bg-white border border-slate-200 shadow-sm focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-500/20 transition-all">
                <Search className="w-4 h-4 text-slate-400 shrink-0" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Rechercher…"
                  className="flex-1 min-w-0 w-0 bg-transparent text-sm focus:outline-none placeholder:text-slate-400"
                  autoFocus={desktopAutoFocus}
                />
                {search && (
                  <button onClick={() => setSearch('')} className="shrink-0 p-1 text-slate-400 hover:text-slate-600 transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                <POSGuideInlineTrigger />
                <button
                  onClick={() => setCategoryPickerOpen(true)}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-all ${
                    categoryId
                      ? 'bg-brand-50 text-brand-700 border border-brand-200'
                      : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100'
                  }`}
                  title="Filtrer par catégorie"
                >
                  <Tag className="w-3.5 h-3.5" />
                  <span className="hidden md:inline max-w-[120px] truncate">
                    {categoryId ? (categories.find(c => c.id === categoryId)?.name || 'Catégorie') : 'Catégorie'}
                  </span>
                </button>
                <button
                  onClick={() => setSortMode(m => m === 'top' ? 'alpha' : 'top')}
                  className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100 transition-all"
                  title={sortMode === 'top' ? 'Tri : meilleures ventes' : 'Tri : A → Z'}
                >
                  {sortMode === 'top' ? <Flame className="w-3.5 h-3.5 text-amber-500" /> : <ArrowDownAZ className="w-3.5 h-3.5 text-brand-700" />}
                  <span className="hidden md:inline">{sortMode === 'top' ? 'Top' : 'A→Z'}</span>
                </button>
                <button
                  onClick={() => setArticleView(v => v === 'grid' ? 'list' : 'grid')}
                  className={`shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all border ${articleView === 'list' ? 'bg-brand-600 border-brand-700 text-white shadow-sm' : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'}`}
                  title={articleView === 'grid' ? 'Vue liste' : 'Vue grille'}
                >
                  {articleView === 'grid' ? <List className="w-3.5 h-3.5" /> : <LayoutGrid className="w-3.5 h-3.5" />}
                </button>
              </div>
              {autoMode && (
                <button onClick={() => setVehiclePickerOpen(true)} className="shrink-0 flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-brand-50 hover:border-brand-400 text-slate-800 transition-all text-sm font-semibold active:scale-95 shadow-sm" title="Recherche par véhicule">
                  <Car className="w-4 h-4 text-brand-700" />
                  <span className="hidden sm:inline">Par véhicule</span>
                </button>
              )}
            </div>
            {(categoryId || sortMode !== 'top') && (
              <div className="mt-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
                {sortMode === 'top' ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100">
                    <Flame className="w-3 h-3" />Meilleures ventes
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                    <ArrowDownAZ className="w-3 h-3" />A → Z
                  </span>
                )}
                {categoryId && (
                  <button onClick={() => setCategoryId('')} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200">
                    {categories.find(c => c.id === categoryId)?.name} <X className="w-3 h-3" />
                  </button>
                )}
                <span className="text-slate-400 num">· {filtered.length} article{filtered.length > 1 ? 's' : ''}</span>
              </div>
            )}
            {(() => {
              const sharedCatalog = (tenant as any)?.settings?.shared_articles !== false;
              const interDepot = !!(tenant as any)?.settings?.inter_depot_transfer;
              // Own depots always accessible; other depots only if shared catalog + inter-depot enabled
              const availableDepots = depots.filter(d =>
                d.parent_site_id === currentSite?.id || (sharedCatalog && interDepot)
              );
              if (availableDepots.length === 0) return null;
              return (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Stock depuis :</span>
                  <select
                    value={saleSourceSiteId}
                    onChange={e => { setSaleSourceSiteId(e.target.value); }}
                    className="text-[11px] font-semibold bg-white border border-slate-200 rounded-lg px-2 py-1 text-slate-700 focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400/30"
                  >
                    {currentSite && <option value={currentSite.id}>{currentSite.name} (Magasin)</option>}
                    {availableDepots.map(d => (
                      <option key={d.id} value={d.id}>{d.name} (Dépôt)</option>
                    ))}
                  </select>
                </div>
              );
            })()}
          </div>
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            <div className="p-3 sm:p-4 w-full max-w-full mx-auto">
            {filtered.length === 0 ? (
              <EmptyState icon={Package} title="Aucun article" description="Créez des articles dans le catalogue." />
            ) : articleView === 'grid' ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-2.5 w-full justify-center">
                {filtered.map(a => {
                  const allowNeg = !!(tenant as any)?.settings?.allow_negative_stock;
                  const out = !allowNeg && a.stock_available <= 0;
                  const low = a.stock_available > 0 && a.stock_available <= 3;
                  return (
                    <button key={a.id} onClick={() => addToCart(a)} disabled={out}
                      className="product-card disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <div className="relative aspect-[4/3] bg-white rounded-lg flex items-center justify-center overflow-hidden border border-slate-100">
                        {a.image_url ? (
                          <img src={a.image_url} alt={a.name} className="w-full h-full object-contain p-1" loading="lazy" />
                        ) : (
                          <Package className="w-7 h-7 text-slate-300" />
                        )}
                        <span className={`absolute top-1 right-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${a.stock_available <= 0 ? (allowNeg ? 'bg-orange-500 text-white' : 'bg-red-500 text-white') : low ? 'bg-amber-500 text-white' : 'bg-white/90 text-slate-700 border border-slate-200'} shadow-sm num`}>
                          {a.stock_available <= 0 ? (allowNeg ? '×0' : 'Rupture') : `×${a.stock_available}`}
                        </span>
                      </div>
                      <div className="text-[9px] font-mono text-slate-400 truncate tracking-wide">{a.internal_ref}</div>
                      <div className="text-[12px] font-semibold text-slate-900 line-clamp-2 leading-[1.25] article-text">{a.name}</div>
                      <div className="flex items-center justify-between mt-auto pt-0.5">
                        <span className="text-[13px] font-bold text-slate-900 num">{formatFCFA(a.sale_price)}</span>
                        <span className="w-6 h-6 rounded-full bg-brand-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                          <Plus className="w-3.5 h-3.5" />
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {filtered.map(a => {
                  const allowNeg = !!(tenant as any)?.settings?.allow_negative_stock;
                  const out = !allowNeg && a.stock_available <= 0;
                  const low = a.stock_available > 0 && a.stock_available <= 3;
                  return (
                    <button
                      key={a.id}
                      onClick={() => addToCart(a)}
                      disabled={out}
                      className={`w-full flex items-start gap-2.5 px-3 py-2.5 rounded-xl border transition-all text-left active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed ${out ? 'border-red-200/60 bg-red-50/30' : 'border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50/40 hover:shadow-sm'}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-semibold text-slate-900 leading-snug">{a.name}</div>
                        {a.internal_ref && <div className="text-[10px] font-mono text-slate-400 mt-0.5">{a.internal_ref}</div>}
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-0.5">
                        <span className="text-[13px] font-bold text-slate-900 num">{formatFCFA(a.sale_price)}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md num ${
                          a.stock_available <= 0
                            ? (allowNeg ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700')
                            : low
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-emerald-50 text-emerald-700'
                        }`}>
                          {a.stock_available <= 0 ? (allowNeg ? '0' : 'Rupture') : `x${a.stock_available}`}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            </div>
          </div>
        </div>

        <aside className="hidden lg:flex w-[400px] xl:w-[440px] bg-white border-l border-slate-200/70 flex-col shadow-[inset_8px_0_24px_-16px_rgb(15_23_42_/0.08)]">
          {CartPanel}
        </aside>

        {mobileCartOpen && (
          <div className="fixed inset-0 z-40 lg:hidden animate-fade-in">
            <div className="scrim" onClick={() => setMobileCartOpen(false)} />
            <div className="absolute inset-x-0 bottom-0 top-[6vh] bg-white flex flex-col animate-sheet-up rounded-t-3xl shadow-premium overflow-hidden" style={{ paddingBottom: 'calc(72px + env(safe-area-inset-bottom))' }}>
              <div className="sheet-handle" />
              {CartPanel}
            </div>
          </div>
        )}
      </div>

      {/* ── Modals ───────────────────────────────────────────────────────────── */}

      {/* Category picker sheet */}
      {categoryPickerOpen && (
        <div className="fixed inset-0 z-[55] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setCategoryPickerOpen(false)} />
          <div className="relative w-full sm:max-w-md bg-white sm:rounded-2xl shadow-premium flex flex-col max-h-[85vh] animate-slide-up">
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-100 shrink-0">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-brand-700/80">Filtrer</div>
                <h3 className="text-base font-bold text-slate-900">Catégorie</h3>
              </div>
              <button onClick={() => setCategoryPickerOpen(false)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              <button
                onClick={() => { setCategoryId(''); setCategoryPickerOpen(false); }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  !categoryId ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'hover:bg-slate-50 text-slate-700 border border-transparent'
                }`}
              >
                <span className="inline-flex items-center gap-2"><Tag className="w-4 h-4" />Toutes les catégories</span>
                {!categoryId && <CheckCircle2 className="w-4 h-4 text-brand-600" />}
              </button>
              {categories.filter(c => !c.parent_id).map(c => {
                const children = categories.filter(s => s.parent_id === c.id);
                const sel = categoryId === c.id;
                const count = articles.filter(a => a.category_id === c.id || children.some(ch => ch.id === a.category_id)).length;
                return (
                  <div key={c.id}>
                    <button
                      onClick={() => { setCategoryId(c.id); setCategoryPickerOpen(false); }}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                        sel ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'hover:bg-slate-50 text-slate-800 border border-transparent'
                      }`}
                    >
                      <span className="truncate">{c.name}</span>
                      <span className="inline-flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] font-bold num text-slate-400">{count}</span>
                        {sel && <CheckCircle2 className="w-4 h-4 text-brand-600" />}
                      </span>
                    </button>
                    {children.map(s => {
                      const sSel = categoryId === s.id;
                      const sCount = articles.filter(a => a.category_id === s.id).length;
                      return (
                        <button
                          key={s.id}
                          onClick={() => { setCategoryId(s.id); setCategoryPickerOpen(false); }}
                          className={`w-full flex items-center justify-between pl-8 pr-3 py-2 rounded-xl text-sm transition-all ${
                            sSel ? 'bg-brand-50 text-brand-700 border border-brand-200 font-semibold' : 'hover:bg-slate-50 text-slate-600 border border-transparent'
                          }`}
                        >
                          <span className="truncate">{s.name}</span>
                          <span className="inline-flex items-center gap-1.5 shrink-0">
                            <span className="text-[10px] font-bold num text-slate-400">{sCount}</span>
                            {sSel && <CheckCircle2 className="w-4 h-4 text-brand-600" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              {categories.length === 0 && (
                <div className="text-center text-xs text-slate-400 py-6">Aucune catégorie disponible</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Vehicle article picker */}
      {autoMode && <VehicleArticlePicker
        open={vehiclePickerOpen}
        onClose={() => setVehiclePickerOpen(false)}
        onSelect={a => {
          const article: ArticleLite = {
            id: a.id, internal_ref: a.internal_ref, name: a.name, oem_ref: (a as any).oem_ref || '',
            sale_price: a.sale_price, purchase_price: a.purchase_price,
            stock_available: a.stock_available,
            category_id: null,
            image_url: null,
          };
          addToCart(article);
        }}
        priceMode="sale"
        tenantId={tenant!.id}
        siteId={currentSite!.id}
      />}

      {/* Tier picker modal */}
      {tierPickerOpen && tierPickerArticle && (() => {
        const tiers = articleTiers.filter(t => t.article_id === tierPickerArticle.id);
        const defaultPrice = tierPickerArticle.sale_price;
        return (
          <Modal open={tierPickerOpen} onClose={() => { setTierPickerOpen(false); setTierPickerArticle(null); }} title="Choisir le tarif" size="sm">
            <div className="space-y-2">
              <p className="text-xs text-slate-500 mb-3">Sélectionnez le tarif à appliquer pour <span className="font-semibold text-slate-700">{tierPickerArticle.name}</span></p>
              <button onClick={() => addToCartWithTier(tierPickerArticle, '', defaultPrice)} className="w-full text-left px-4 py-3 rounded-xl border border-slate-200 hover:border-brand-300 hover:bg-brand-50/30 transition-all group">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-900">Prix standard</span>
                  <span className="text-sm font-bold text-slate-900 num">{formatFCFA(defaultPrice)}</span>
                </div>
              </button>
              {tiers.map(t => (
                <button key={t.tier_name} onClick={() => addToCartWithTier(tierPickerArticle, t.tier_name, t.price)} className="w-full text-left px-4 py-3 rounded-xl border border-slate-200 hover:border-brand-300 hover:bg-brand-50/30 transition-all group">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-900">{t.tier_name}</span>
                    <span className="text-sm font-bold text-brand-700 num">{formatFCFA(t.price)}</span>
                  </div>
                </button>
              ))}
            </div>
          </Modal>
        );
      })()}

    </div>
    </>
    )}

      {/* Cash movement (expense / income / customer prepayment) */}
      {mvOpen && (
        <Modal open onClose={() => setMvOpen(false)} title="Mouvement de caisse" size="md"
          footer={
            <div className="flex gap-2 w-full">
              <button onClick={() => setMvOpen(false)} className="btn-secondary flex-1 justify-center">Annuler</button>
              <button onClick={submitMovement} disabled={mvSubmitting || mvAmount <= 0}
                className="btn-primary flex-1 justify-center">
                {mvSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Enregistrer
              </button>
            </div>
          }>
          <div className="space-y-4">
            <div>
              <label className="label">Type de mouvement</label>
              <div className="grid grid-cols-3 gap-2">
                <button type="button" onClick={() => setMvKind('expense')}
                  className={`p-3 rounded-xl border-2 text-center transition-all ${mvKind === 'expense' ? 'border-red-500 bg-red-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                  <ArrowUpRight className={`w-5 h-5 mx-auto mb-1 ${mvKind === 'expense' ? 'text-red-600' : 'text-slate-400'}`} />
                  <div className={`text-xs font-bold ${mvKind === 'expense' ? 'text-red-700' : 'text-slate-600'}`}>Dépense</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Sortie de caisse</div>
                </button>
                <button type="button" onClick={() => setMvKind('income')}
                  className={`p-3 rounded-xl border-2 text-center transition-all ${mvKind === 'income' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                  <ArrowDownRight className={`w-5 h-5 mx-auto mb-1 ${mvKind === 'income' ? 'text-emerald-600' : 'text-slate-400'}`} />
                  <div className={`text-xs font-bold ${mvKind === 'income' ? 'text-emerald-700' : 'text-slate-600'}`}>Entrée</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Apport libre</div>
                </button>
                <button type="button" onClick={() => setMvKind('customer_prepayment')}
                  className={`p-3 rounded-xl border-2 text-center transition-all ${mvKind === 'customer_prepayment' ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                  <Banknote className={`w-5 h-5 mx-auto mb-1 ${mvKind === 'customer_prepayment' ? 'text-brand-600' : 'text-slate-400'}`} />
                  <div className={`text-xs font-bold ${mvKind === 'customer_prepayment' ? 'text-brand-700' : 'text-slate-600'}`}>Acompte</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Client</div>
                </button>
              </div>
            </div>

            {mvKind === 'customer_prepayment' && (
              <div>
                <label className="label">Client</label>
                {mvCustomer ? (
                  <div className="flex items-center gap-3 p-2.5 rounded-xl bg-brand-50 border border-brand-200">
                    <div className="w-8 h-8 rounded-xl bg-brand-600 text-white flex items-center justify-center shrink-0"><User className="w-4 h-4" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-slate-900 truncate">{mvCustomer.name}</div>
                      {mvCustomer.phone && <div className="text-[10px] text-slate-500 truncate">{mvCustomer.phone}</div>}
                    </div>
                    <button onClick={() => setMvCustomer(null)} className="text-xs font-semibold text-brand-700 hover:underline shrink-0">Changer</button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input autoFocus value={mvCustSearch} onChange={e => setMvCustSearch(e.target.value)}
                        className="input pl-9" placeholder="Rechercher un client…" />
                    </div>
                    <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
                      {customers
                        .filter(cu => {
                          const q = mvCustSearch.toLowerCase().trim();
                          if (!q) return true;
                          return cu.name.toLowerCase().includes(q) || (cu.phone || '').includes(q);
                        })
                        .slice(0, 20)
                        .map(cu => (
                          <button key={cu.id} onClick={() => setMvCustomer(cu)}
                            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-left transition-colors">
                            <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="text-sm font-semibold text-slate-800 truncate">{cu.name}</span>
                            {cu.phone && <span className="text-[10px] text-slate-500 ml-auto shrink-0">{cu.phone}</span>}
                          </button>
                        ))}
                    </div>
                  </>
                )}
                <div className="text-[10px] text-slate-500 mt-1.5">
                  Si ce client a des factures impayées, l'acompte sera imputé automatiquement. Sinon, son compte sera crédité et le montant s'imputera dès la prochaine facture.
                </div>
              </div>
            )}

            <div>
              <label className="label">Montant</label>
              <input type="number" value={mvAmount || ''} onChange={e => setMvAmount(Math.max(0, Number(e.target.value)))}
                className="input text-lg font-bold num" placeholder="0" min={0} />
            </div>

            {(mvKind === 'income' || mvKind === 'customer_prepayment') && (
              <div>
                <label className="label">Mode de règlement</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {methods.map(m => (
                    <button key={m.id} type="button" onClick={() => setMvMethod(m)}
                      className={`px-3 py-2.5 rounded-xl text-xs font-semibold border-2 transition-all ${mvMethod?.id === m.id ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
                      {m.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="label">{mvKind === 'expense' ? 'Motif de dépense' : 'Motif'}</label>
              <input value={mvReason} onChange={e => setMvReason(e.target.value)}
                className="input" placeholder={mvKind === 'expense' ? 'Ex: Carburant, achat fournitures…' : 'Motif du mouvement'} />
            </div>

            <div>
              <label className="label">Référence (optionnel)</label>
              <input value={mvRef} onChange={e => setMvRef(e.target.value)} className="input" placeholder="N° pièce, bordereau…" />
            </div>

            {mvNote || true ? (
              <div>
                <label className="label">Note (optionnel)</label>
                <textarea value={mvNote} onChange={e => setMvNote(e.target.value)} className="input min-h-16" rows={2} placeholder="Détails complémentaires…" />
              </div>
            ) : null}
          </div>
        </Modal>
      )}

      {/* Customer payment (encaissement libre) */}
      {custPayOpen && (
        <Modal open onClose={() => setCustPayOpen(false)} title="Encaisser un client" size="md"
          footer={
            <div className="flex gap-2 w-full">
              <button onClick={() => setCustPayOpen(false)} className="btn-secondary flex-1 justify-center">Annuler</button>
              <button onClick={submitCustomerPayment} disabled={custPaySubmitting || !custPayCustomer || !custPayMethod || custPayAmount <= 0}
                className="btn-primary flex-1 justify-center">
                {custPaySubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Valider {custPayAmount > 0 ? `· ${formatFCFA(custPayAmount)}` : ''}
              </button>
            </div>
          }>
          <div className="space-y-4">
            {!custPayCustomer ? (
              <div>
                <label className="label">Rechercher un client</label>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input autoFocus value={custPaySearch} onChange={e => setCustPaySearch(e.target.value)}
                    className="input pl-9" placeholder="Nom, téléphone…" />
                </div>
                <div className="mt-2 max-h-72 overflow-y-auto rounded-2xl border border-slate-200 divide-y divide-slate-100">
                  {customers
                    .filter(c => {
                      const q = custPaySearch.toLowerCase().trim();
                      if (!q) return true;
                      return c.name.toLowerCase().includes(q) || (c.phone || '').includes(q);
                    })
                    .slice(0, 30)
                    .map(c => (
                      <button key={c.id} onClick={() => loadCustomerUnpaid(c)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 active:bg-slate-100 text-left transition-colors">
                        <div className="w-8 h-8 rounded-xl bg-brand-50 text-brand-700 flex items-center justify-center shrink-0"><User className="w-4 h-4" /></div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-slate-900 truncate">{c.name}</div>
                          {c.phone && <div className="text-[11px] text-slate-500 truncate">{c.phone}</div>}
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                      </button>
                    ))}
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 p-3 rounded-2xl bg-gradient-to-br from-brand-50 to-white border border-brand-200/70">
                  <div className="w-10 h-10 rounded-xl bg-brand-600 text-white flex items-center justify-center shrink-0"><User className="w-5 h-5" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-slate-900 truncate">{custPayCustomer.name}</div>
                    <div className="text-[11px] text-slate-500">{custPayUnpaid.length} facture(s) impayée(s) · Dû total {formatFCFA(custPayUnpaid.reduce((a, s) => a + (s.total - s.paid), 0))}</div>
                  </div>
                  <button onClick={() => setCustPayCustomer(null)} className="text-xs font-semibold text-brand-700 hover:underline shrink-0">Changer</button>
                </div>

                {custPayUnpaid.length === 0 ? (
                  <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-center">
                    <CheckCircle2 className="w-6 h-6 text-emerald-600 mx-auto mb-1" />
                    <div className="text-sm font-semibold text-emerald-800">Aucune facture en attente</div>
                    <div className="text-xs text-emerald-700 mt-0.5">Ce client est à jour.</div>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="label">Imputation</label>
                      <SearchableSelect
                        options={[
                          { value: '', label: 'Repartir automatiquement (plus ancienne d\'abord)' },
                          ...custPayUnpaid.map(s => ({
                            value: s.id,
                            label: `${s.sale_number} · du ${formatFCFA(s.total - s.paid)}`,
                            sublabel: new Date(s.created_at).toLocaleDateString('fr-FR'),
                          }))
                        ]}
                        value={custPaySaleId}
                        onChange={v => {
                          setCustPaySaleId(v);
                          if (v) {
                            const s = custPayUnpaid.find(x => x.id === v);
                            if (s) setCustPayAmount(s.total - s.paid);
                          } else {
                            setCustPayAmount(custPayUnpaid.reduce((a, s) => a + (s.total - s.paid), 0));
                          }
                        }}
                        placeholder="Repartir automatiquement"
                      />
                    </div>

                    <div>
                      <label className="label">Montant</label>
                      <input type="number" value={custPayAmount || ''} onChange={e => setCustPayAmount(Math.max(0, Number(e.target.value)))}
                        className="input text-lg font-bold num" placeholder="0" min={0} />
                    </div>

                    <div>
                      <label className="label">Mode de règlement</label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {methods.map(m => (
                          <button key={m.id} type="button" onClick={() => setCustPayMethod(m)}
                            className={`px-3 py-2.5 rounded-xl text-xs font-semibold border-2 transition-all ${custPayMethod?.id === m.id ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
                            {m.name}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="label">Référence (optionnel)</label>
                      <input value={custPayRef} onChange={e => setCustPayRef(e.target.value)} className="input" placeholder="N° bordereau, transaction…" />
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </Modal>
      )}

      {/* Fullscreen immersive payment */}
      {payOpen && (
        <PaymentScreen
          total={total}
          customer={customer}
          methods={methods}
          payments={payments}
          setPayments={setPayments}
          paying={paying}
          onClose={() => setPayOpen(false)}
          onValidate={validateSale}
          onValidateCredit={validateCreditSale}
          docSettings={posDocSettings}
          docFields={{ deliveryDate: docDeliveryDate, reference: docReference, warranty: docWarranty, representative: docRepresentative }}
          setDocFields={{ setDeliveryDate: setDocDeliveryDate, setReference: setDocReference, setWarranty: setDocWarranty, setRepresentative: setDocRepresentative }}
        />
      )}

      {/* Post-sale: print choice */}
      {lastSale && (
        <Modal open={!!lastSale} onClose={() => setLastSale(null)} title="Vente enregistrée" size="sm"
          footer={<div className="w-full grid grid-cols-3 gap-2">
            <button onClick={() => setLastSale(null)} className="px-2 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 border border-slate-200 transition inline-flex items-center justify-center">Fermer</button>
            <button onClick={() => {
              printSaleTicket(lastSale);
              setLastSale(null);
            }} className="px-2 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:border-brand-400 transition inline-flex items-center justify-center gap-1.5">
              <Printer className="w-3.5 h-3.5" /> Ticket
            </button>
            <button onClick={() => {
              printSaleInvoice(lastSale);
              setLastSale(null);
            }} className="px-2 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-brand-600 to-brand-700 text-white shadow-glow hover:shadow-lg transition inline-flex items-center justify-center gap-1.5 active:scale-95">
              <FileText className="w-3.5 h-3.5" /> Facture
            </button>
          </div>}
        >
          <div className="text-center py-4">
            <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
              <Check className="w-7 h-7 text-emerald-600" />
            </div>
            <div className="font-semibold text-slate-900">{lastSale.sale_number}</div>
            <div className="text-2xl font-bold text-brand-800 mt-1">{formatFCFA(lastSale.total)}</div>
            {lastSale.payments.reduce((s, p) => s + p.amount, 0) > lastSale.total && (
              <div className="mt-2 text-sm text-emerald-700 font-semibold">
                Monnaie : {formatFCFA(lastSale.payments.reduce((s, p) => s + p.amount, 0) - lastSale.total)}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Held carts */}
      <Modal open={holdOpen} onClose={() => setHoldOpen(false)} title={`Tickets en attente (${heldCarts.length})`} size="md"
        footer={<button onClick={() => setHoldOpen(false)} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>}
      >
        {heldCarts.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">Aucun ticket en attente.</div>
        ) : (
          <div className="space-y-2">
            {heldCarts.map(h => (
              <div key={h.id} className="flex items-center justify-between p-3 border border-slate-200 rounded-xl hover:bg-slate-50">
                <div className="min-w-0">
                  <div className="font-semibold text-sm">{h.label}</div>
                  <div className="text-xs text-slate-500">{h.cart.length} article{h.cart.length > 1 ? 's' : ''} · {formatFCFA(h.cart.reduce((s, i) => s + i.quantity * i.unit_price - i.discount, 0) - h.discount)}</div>
                  <div className="text-xs text-slate-400">{new Date(h.savedAt).toLocaleTimeString('fr-FR')}</div>
                </div>
                <div className="flex items-center gap-2 ml-3 shrink-0">
                  <button onClick={() => resumeHeld(h)} className="btn-primary text-xs py-1.5 px-3">
                    <Play className="w-3.5 h-3.5" /> Reprendre
                  </button>
                  <button onClick={() => deleteHeld(h.id)} className="p-1.5 rounded hover:bg-red-50 text-red-500">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Return ticket */}
      <Modal open={returnOpen} onClose={() => setReturnOpen(false)} title="Ticket de retour" size="lg"
        footer={<>
          <button onClick={() => { setReturnOpen(false); setReturnSelected(null); }} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>
          {returnSelected && (
            <button onClick={processReturn} disabled={returnProcessing} className="btn-icon-success" title="Valider le retour">
              {returnProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
            </button>
          )}
        </>}
      >
        {returnLoading ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
        ) : !returnSelected ? (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input value={returnSearch} onChange={e => setReturnSearch(e.target.value)} placeholder="Rechercher un ticket de la session…" className="input pl-9" autoFocus={desktopAutoFocus} />
            </div>
            {filteredReturnSales.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500">Aucun ticket dans cette session.</div>
            ) : (
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {filteredReturnSales.map(s => (
                  <button key={s.id} onClick={() => !s.fullyReturned && selectReturnSale(s)} disabled={s.fullyReturned} className={`w-full text-left p-3 border rounded-xl transition-colors ${s.fullyReturned ? 'border-slate-100 bg-slate-50 opacity-60 cursor-not-allowed' : 'border-slate-200 hover:bg-brand-50 hover:border-brand-200'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-sm text-brand-700">{s.sale_number}</span>
                        {s.customer_name && <span className="text-xs text-slate-500">· {s.customer_name}</span>}
                        {s.fullyReturned && <span className="text-[10px] font-bold uppercase text-slate-500 bg-slate-200 px-1.5 py-0.5 rounded">Retourne</span>}
                      </div>
                      <span className="font-bold text-sm">{formatFCFA(s.total)}</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">{new Date(s.created_at).toLocaleString('fr-FR')} · {s.items.length} article{s.items.length > 1 ? 's' : ''}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl text-sm">
              <div>
                <span className="font-mono font-semibold text-brand-700">{returnSelected.sale_number}</span>
                {returnSelected.customer_name && <span className="text-slate-500 ml-2">· {returnSelected.customer_name}</span>}
              </div>
              <button onClick={() => setReturnSelected(null)} className="text-xs text-slate-500 hover:text-slate-700 underline">Changer</button>
            </div>
            <p className="text-sm text-slate-600">Sélectionnez les articles à retourner et ajustez les quantités.</p>
            <div className="space-y-2">
              {returnLines.map((l, i) => {
                const toggle = (v: boolean) => setReturnLines(lines => lines.map((x, j) => j === i ? { ...x, selected: v } : x));
                const setQ = (q: number) => setReturnLines(lines => lines.map((x, j) => j === i ? { ...x, quantity: Math.min(l.maxQty, Math.max(1, q)) } : x));
                return (
                  <div key={i} className={`rounded-2xl border p-3 transition-all ${l.selected ? 'border-red-200 bg-red-50/40 shadow-sm' : 'border-slate-200 bg-white'}`}>
                    <div className="flex items-start gap-3">
                      <button type="button" onClick={() => toggle(!l.selected)} className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all ${l.selected ? 'bg-red-600 border-red-600' : 'bg-white border-slate-300'}`}>
                        {l.selected && <Check className="w-4 h-4 text-white" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-900 break-words">{l.name}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5 num">{formatFCFA(l.unit_price)} · max {l.maxQty}</div>
                      </div>
                      <div className="num font-bold shrink-0 text-right text-red-600">
                        {l.selected ? `-${formatFCFA(l.quantity * l.unit_price)}` : <span className="text-slate-300">—</span>}
                      </div>
                    </div>
                    {l.selected && (
                      <div className="mt-3 flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-500">Qté à retourner</span>
                        <div className="ml-auto flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl p-1">
                          <button type="button" onClick={() => setQ(l.quantity - 1)} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center"><Minus className="w-3.5 h-3.5" /></button>
                          <input type="number" value={l.quantity} min="1" max={l.maxQty} onChange={e => setQ(Number(e.target.value))} className="w-12 text-center text-sm font-bold num bg-transparent outline-none" />
                          <button type="button" onClick={() => setQ(l.quantity + 1)} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center"><Plus className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="rounded-2xl bg-gradient-to-br from-red-50 to-amber-50 border border-red-200 p-4 flex items-center justify-between mt-1">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-red-700">Avoir total</div>
                  <div className="text-xs text-slate-600 mt-0.5">{returnLines.filter(l => l.selected).length} article{returnLines.filter(l => l.selected).length > 1 ? 's' : ''}</div>
                </div>
                <div className="num text-2xl font-bold text-red-700">
                  -{formatFCFA(returnLines.filter(l => l.selected).reduce((s, l) => s + l.quantity * l.unit_price, 0))}
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Lot picker modal for manual lot selection */}
      <LotPickerModal
        open={lotPickerOpen}
        onClose={() => setLotPickerOpen(false)}
        items={cart.map(c => ({ article_id: c.article_id, name: c.name, quantity: c.quantity }))}
        onConfirm={(selections) => executeSale(selections)}
        title="Selection des lots a consommer"
        confirmLabel="Confirmer la vente"
      />

      {/* Session tickets list */}
      <Modal open={ticketsOpen} onClose={() => setTicketsOpen(false)} title="Tickets de la session" size="lg"
        footer={<button onClick={() => setTicketsOpen(false)} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>}
      >
        {loadingTickets ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
        ) : sessionSales.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">Aucune vente dans cette session.</div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="card p-3 text-center">
                <div className="text-xs text-slate-500">Tickets</div>
                <div className="text-xl font-bold mt-0.5">{sessionSales.filter(x => x.status !== 'return').length}</div>
              </div>
              <div className="card p-3 text-center col-span-2">
                <div className="text-xs text-slate-500">CA Net</div>
                <div className="text-xl font-bold text-brand-800 mt-0.5">{formatFCFA(sessionSales.reduce((s, x) => s + x.total, 0))}</div>
              </div>
            </div>
            <div className="space-y-2 max-h-[55vh] overflow-y-auto -mx-1 px-1 pb-1">
              {sessionSales.map(s => (
                <div key={s.id} className={`card p-3 flex items-center gap-3 hover:shadow-elevated transition-all ${s.status === 'return' ? 'border-red-200 bg-red-50/30' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-mono text-xs font-bold ${s.status === 'return' ? 'text-red-600' : 'text-brand-700'}`}>{s.sale_number}</span>
                      <span className="text-[11px] text-slate-400 num">{new Date(s.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                      {s.status === 'return' && <span className="text-[10px] font-bold uppercase text-red-600 bg-red-100 px-1.5 py-0.5 rounded">Retour</span>}
                    </div>
                    <div className="text-xs text-slate-600 article-text line-clamp-1 mt-0.5">{s.customer_name || (s.status === 'return' ? 'Remboursement' : 'Client comptoir')}</div>
                  </div>
                  <div className={`num font-bold shrink-0 ${s.total < 0 ? 'text-red-600' : 'text-slate-900'}`}>{s.total < 0 ? '-' : ''}{formatFCFA(Math.abs(s.total))}</div>
                  {s.status !== 'return' && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button title="Ticket 80mm" onClick={() => {
                            const fakeSale = {
                              sale_number: s.sale_number, created_at: s.created_at, total: s.total, discount: 0,
                              items: s.items.map(i => ({ ...i, discount: 0, article_id: '', internal_ref: '', stock_available: 0, purchase_cost: 0 })),
                              payments: [{ payment_method_id: null, method_name: 'Règlement', amount: s.total, reference: '' }],
                              customer: s.customer_name ? { id: '', tenant_id: '', name: s.customer_name, phone: s.customer_phone || '', email: '', address: s.customer_address || '', customer_type: '', balance: 0 } : null,
                            };
                            printSaleTicket(fakeSale);
                          }} className="p-1.5 rounded hover:bg-slate-100 text-slate-600">
                            <Printer className="w-4 h-4" />
                          </button>
                          <button title="Facture A4" onClick={() => {
                            const fakeSale = {
                              sale_number: s.sale_number, created_at: s.created_at, total: s.total, discount: 0,
                              items: s.items.map(i => ({ ...i, discount: 0, article_id: '', internal_ref: '', stock_available: 0, purchase_cost: 0 })),
                              payments: [{ payment_method_id: null, method_name: 'Règlement', amount: s.total, reference: '' }],
                              customer: s.customer_name ? { id: '', tenant_id: '', name: s.customer_name, phone: s.customer_phone || '', email: '', address: s.customer_address || '', customer_type: '', balance: 0 } : null,
                            };
                            printSaleInvoice(fakeSale);
                          }} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600">
                            <FileText className="w-4 h-4" />
                          </button>
                  </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* Stats */}
      <Modal open={statsOpen} onClose={() => setStatsOpen(false)} title="Statistiques de la session" size="md"
        footer={<>
          <button onClick={() => setStatsOpen(false)} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>
          {statsData && (
            <button onClick={() => printXReport(
              session as any,
              methods.map(m => ({ payment_method_id: m.id, method_name: m.name, theoretical_amount: statsData.byMethod.find(b => b.method_name === m.name)?.amount || 0, counted_amount: 0 })),
              statsData, sessionRegs,
              { name: tenant!.name, ninea: (tenant as any).ninea, rccm: (tenant as any).rccm, address: (tenant as any).address },
              profile?.full_name || profile?.email || '', currentSite?.name || ''
            )} className="btn-icon-primary" title="Imprimer rapport">
              <Printer className="w-4 h-4" />
            </button>
          )}
        </>}
      >
        {loadingStats ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
        ) : statsData ? (
          <div className="space-y-3">
            {/* KPI strip */}
            <div className="flex items-stretch gap-2 p-2 rounded-2xl bg-gradient-to-br from-slate-50 to-white border border-slate-200">
              <div className="flex-1 text-center px-2 py-1.5">
                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Ventes</div>
                <div className="text-lg font-bold text-slate-900 num leading-tight">{statsData.count}</div>
              </div>
              <div className="w-px bg-slate-200" />
              <div className="flex-1 text-center px-2 py-1.5">
                <div className="text-[9px] font-bold uppercase tracking-wider text-brand-600">CA Total</div>
                <div className="text-lg font-bold text-brand-900 num leading-tight">{formatFCFA(statsData.total)}</div>
              </div>
              {statsData.movements.length > 0 && <>
                <div className="w-px bg-slate-200" />
                <div className="flex-1 text-center px-2 py-1.5">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-brand-700">Net</div>
                  <div className="text-lg font-bold text-brand-900 num leading-tight">{formatFCFA(statsData.netTotal)}</div>
                </div>
              </>}
            </div>

            {/* Movements mini-summary */}
            {statsData.movements.length > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-semibold num">+{formatFCFA(statsData.movIncome + statsData.movPrepay)}</span>
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-red-50 text-red-700 font-semibold num">-{formatFCFA(statsData.movExpense)}</span>
                {statsData.movements.map((m, i) => {
                  const isExp = m.kind === 'expense';
                  return (
                    <span key={i} className={`hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium ${isExp ? 'bg-red-50/60 text-red-600' : 'bg-emerald-50/60 text-emerald-600'}`}>
                      {m.reason || (isExp ? 'Sortie' : 'Entrée')}
                    </span>
                  );
                })}
              </div>
            )}

            {/* Collapsible sections */}
            <div className="space-y-1.5">
              {/* Reglements */}
              {statsData.invoicePayments.length > 0 && (
                <div className={`rounded-xl border transition-all duration-200 ${statsExpanded === 'reglements' ? 'border-sky-300 bg-sky-50/40 order-first' : 'border-slate-200 bg-white'}`}>
                  <button onClick={() => setStatsExpanded(statsExpanded === 'reglements' ? null : 'reglements')} className="w-full flex items-center justify-between px-3 py-2.5 text-left">
                    <div className="flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${statsExpanded === 'reglements' ? 'bg-sky-200 text-sky-800' : 'bg-sky-100 text-sky-700'}`}>
                        <Wallet className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-800">Reglements factures</div>
                        <div className="text-[10px] text-slate-500">{statsData.invoicePayments.length} reglement{statsData.invoicePayments.length > 1 ? 's' : ''}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-sky-800 num">{formatFCFA(statsData.invoicePayments.reduce((s, p) => s + p.amount, 0))}</span>
                      <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${statsExpanded === 'reglements' ? 'rotate-90' : ''}`} />
                    </div>
                  </button>
                  {statsExpanded === 'reglements' && (
                    <div className="px-3 pb-3 space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
                      {statsData.invoicePayments.map((p, i) => (
                        <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-white border border-sky-100">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-bold text-slate-900">
                              <span className="font-mono">{p.sale_number}</span>
                              {p.customer_name && <span className="text-slate-600 font-medium ml-1">- {p.customer_name}</span>}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[10px] text-slate-500">
                              <span>{new Date(p.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} {new Date(p.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">{p.method_name}</span>
                              {p.user_name && <span className="inline-flex items-center gap-0.5"><User className="w-2.5 h-2.5" />{p.user_name}</span>}
                            </div>
                          </div>
                          <span className="text-xs font-bold text-emerald-700 num shrink-0">+{formatFCFA(p.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Encaissements par mode */}
              {statsData.byMethod.length > 0 && (
                <div className={`rounded-xl border transition-all duration-200 ${statsExpanded === 'modes' ? 'border-brand-300 bg-brand-50/30 order-first' : 'border-slate-200 bg-white'}`}>
                  <button onClick={() => setStatsExpanded(statsExpanded === 'modes' ? null : 'modes')} className="w-full flex items-center justify-between px-3 py-2.5 text-left">
                    <div className="flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${statsExpanded === 'modes' ? 'bg-brand-200 text-brand-800' : 'bg-brand-100 text-brand-700'}`}>
                        <CreditCard className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-800">Encaissements par mode</div>
                        <div className="text-[10px] text-slate-500">{statsData.byMethod.length} mode{statsData.byMethod.length > 1 ? 's' : ''}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-brand-800 num">{formatFCFA(statsData.total)}</span>
                      <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${statsExpanded === 'modes' ? 'rotate-90' : ''}`} />
                    </div>
                  </button>
                  {statsExpanded === 'modes' && (
                    <div className="px-3 pb-3 space-y-1 animate-in fade-in slide-in-from-top-1 duration-200">
                      {statsData.byMethod.map(m => (
                        <div key={m.method_name} className="flex items-center justify-between px-3 py-2 rounded-lg bg-white border border-slate-100 text-xs">
                          <span className="font-medium text-slate-700">{m.method_name}</span>
                          <span className="font-bold text-slate-900 num">{formatFCFA(m.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Top articles */}
              {statsData.topArticles.length > 0 && (
                <div className={`rounded-xl border transition-all duration-200 ${statsExpanded === 'articles' ? 'border-amber-300 bg-amber-50/30 order-first' : 'border-slate-200 bg-white'}`}>
                  <button onClick={() => setStatsExpanded(statsExpanded === 'articles' ? null : 'articles')} className="w-full flex items-center justify-between px-3 py-2.5 text-left">
                    <div className="flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${statsExpanded === 'articles' ? 'bg-amber-200 text-amber-800' : 'bg-amber-100 text-amber-700'}`}>
                        <Package className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-800">Top articles</div>
                        <div className="text-[10px] text-slate-500">{statsData.topArticles.length} article{statsData.topArticles.length > 1 ? 's' : ''}</div>
                      </div>
                    </div>
                    <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${statsExpanded === 'articles' ? 'rotate-90' : ''}`} />
                  </button>
                  {statsExpanded === 'articles' && (
                    <div className="px-3 pb-3 space-y-1 animate-in fade-in slide-in-from-top-1 duration-200">
                      {statsData.topArticles.map((a, i) => (
                        <div key={a.name} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-white border border-slate-100">
                          <div className="w-5 h-5 rounded-md bg-brand-50 flex items-center justify-center text-[9px] font-bold text-brand-700 num shrink-0">#{i + 1}</div>
                          <div className="min-w-0 flex-1 text-xs font-medium text-slate-800 truncate">{a.name}</div>
                          <div className="text-[10px] text-slate-500 num shrink-0">x{a.qty}</div>
                          <div className="text-xs font-bold text-slate-900 num shrink-0">{formatFCFA(a.total)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Regularization */}
      <Modal open={regOpen} onClose={() => setRegOpen(false)} title="Régularisation d'écart" size="sm" layer="top"
        footer={<>
          <button onClick={() => setRegOpen(false)} className="btn-secondary">Annuler</button>
          <button onClick={saveRegularization} disabled={savingReg} className="btn-primary">
            {savingReg && <Loader2 className="w-4 h-4 animate-spin" />} Enregistrer
          </button>
        </>}
      >
        <div className="space-y-3">
          <div>
            <label className="label">Type</label>
            <select value={regType} onChange={e => setRegType(e.target.value as any)} className="input">
              <option value="manquant">Manquant (déficit)</option>
              <option value="excedent">Excédent (surplus)</option>
              <option value="depot">Dépôt</option>
              <option value="retrait">Retrait</option>
            </select>
          </div>
          <div>
            <label className="label">Montant (FCFA)</label>
            <input type="number" value={regAmount || ''} onChange={e => setRegAmount(Number(e.target.value))} className="input" min="0" />
          </div>
          <div>
            <label className="label">Motif *</label>
            <input value={regReason} onChange={e => setRegReason(e.target.value)} className="input" placeholder="Ex: Écart de monnaie, dépôt initial…" />
          </div>
          <div>
            <label className="label">Note (optionnel)</label>
            <input value={regNote} onChange={e => setRegNote(e.target.value)} className="input" />
          </div>
        </div>
      </Modal>

      {/* Close workflow */}
      <Modal open={closeOpen} onClose={() => !closing && setCloseOpen(false)} title="Clôture de caisse" size="md"
        footer={
          closeStep === 'control' ? (
            <>
              <button onClick={() => setCloseOpen(false)} className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition">Annuler</button>
              <button onClick={() => setRegOpen(true)} className="px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:border-brand-300 transition inline-flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Régulariser
              </button>
              <button onClick={() => setCloseStep('regularize')} className="px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-brand-600 to-brand-700 text-white shadow-glow hover:shadow-lg transition inline-flex items-center gap-1.5 active:scale-95">
                Suivant <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </>
          ) : closeStep === 'regularize' ? (
            <>
              <button onClick={() => setCloseStep('control')} className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition">Retour</button>
              <button onClick={() => setCloseStep('confirm')} className="px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-brand-600 to-brand-700 text-white shadow-glow hover:shadow-lg transition inline-flex items-center gap-1.5 active:scale-95">
                Confirmer <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setCloseStep('regularize')} className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition">Retour</button>
              <button onClick={confirmClose} disabled={closing} className="px-4 py-2 rounded-xl text-xs font-bold bg-ink-900 hover:bg-ink-800 text-white shadow-sm transition inline-flex items-center gap-1.5 active:scale-95 disabled:opacity-50">
                {closing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
                Clôturer
              </button>
            </>
          )
        }
      >
        {/* Premium stepper */}
        <div className="flex items-center gap-1.5 mb-4">
          {(['control', 'regularize', 'confirm'] as CloseStep[]).map((s, i) => {
            const labels = ['Contrôle', 'Régul.', 'Confirm.'];
            const active = closeStep === s;
            const done = (['control', 'regularize', 'confirm'] as CloseStep[]).indexOf(closeStep) > i;
            return (
              <div key={s} className="flex items-center gap-1.5 flex-1">
                <div className={`relative flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-full transition-all duration-300 flex-1 justify-center ${active ? 'bg-gradient-to-r from-brand-600 to-brand-700 text-white shadow-glow' : done ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-50 text-slate-400 border border-slate-200'}`}>
                  {done ? <Check className="w-3 h-3" /> : <span className={`w-4 h-4 rounded-full inline-flex items-center justify-center text-[9px] ${active ? 'bg-white/25' : 'bg-slate-200'}`}>{i + 1}</span>}
                  <span>{labels[i]}</span>
                </div>
              </div>
            );
          })}
        </div>

        {loadingControl ? (
          <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-brand-700" /></div>
        ) : closeStep === 'control' ? (
          <div className="space-y-2.5 count-up">
            <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Saisissez les montants comptés</p>
            <div className="space-y-1.5">
              {controlLines.map((c, idx) => {
                const diff = c.counted_amount - c.theoretical_amount;
                const balanced = diff === 0 && c.counted_amount > 0;
                return (
                  <div key={c.method_name} className={`rounded-xl border p-2.5 transition-all duration-300 ${balanced ? 'border-emerald-200 bg-emerald-50/40' : diff < 0 ? 'border-red-200 bg-red-50/40' : diff > 0 ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-slate-900 truncate">{c.method_name}</div>
                        <div className="text-[10px] text-slate-500 num mt-0.5">Théorique: <span className="font-semibold text-slate-700">{formatFCFA(c.theoretical_amount)}</span></div>
                      </div>
                      <input type="number" value={c.counted_amount || ''} onChange={e => setControlLines(lines => lines.map((l, i) => i === idx ? { ...l, counted_amount: Number(e.target.value) } : l))} className="w-24 px-2 py-1.5 text-xs text-right font-bold num rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 transition" min="0" placeholder="0" />
                      <div className={`text-[10px] font-bold num w-14 text-right ${balanced ? 'text-emerald-600' : diff < 0 ? 'text-red-600' : diff > 0 ? 'text-amber-600' : 'text-slate-300'}`}>
                        {c.counted_amount === 0 ? '—' : diff === 0 ? 'OK' : `${diff > 0 ? '+' : ''}${formatFCFA(diff)}`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className={`rounded-xl p-2.5 flex items-center justify-between transition-all duration-300 ${totalVariance === 0 ? 'bg-gradient-to-br from-emerald-50 to-brand-50 border border-emerald-200' : 'bg-slate-50 border border-slate-200'}`}>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Écart total</div>
              <div className={`num font-bold text-sm ${totalVariance > 0 ? 'text-amber-600' : totalVariance < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                {totalVariance === 0 ? <span className="flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Équilibré</span> : `${totalVariance > 0 ? '+' : ''}${formatFCFA(totalVariance)}`}
              </div>
            </div>
            {Math.abs(totalVariance) > 0 && (
              <div className={`flex items-start gap-2 p-2 rounded-lg text-[11px] ${totalVariance < 0 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{totalVariance < 0 ? `Manquant de ${formatFCFA(-totalVariance)}` : `Excédent de ${formatFCFA(totalVariance)}`}</span>
              </div>
            )}
          </div>
        ) : closeStep === 'regularize' ? (
          <div className="space-y-3 count-up">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl p-2.5 bg-white border border-slate-200 text-center">
                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Écart</div>
                <div className={`text-xs font-bold mt-0.5 num ${totalVariance === 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  {totalVariance === 0 ? 'OK' : `${totalVariance > 0 ? '+' : ''}${formatFCFA(totalVariance)}`}
                </div>
              </div>
              <div className="rounded-xl p-2.5 bg-white border border-slate-200 text-center">
                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Régul.</div>
                <div className="text-xs font-bold mt-0.5 num">{sessionRegs.length}</div>
              </div>
              <div className="rounded-xl p-2.5 bg-white border border-slate-200 text-center">
                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Montant</div>
                <div className="text-xs font-bold mt-0.5 num">{formatFCFA(sessionRegs.reduce((s, r) => s + r.amount, 0))}</div>
              </div>
            </div>
            {sessionRegs.length > 0 ? (
              <div className="space-y-1.5">
                {sessionRegs.map((r, i) => (
                  <div key={i} className={`rounded-xl p-2.5 flex items-center gap-2 border ${r.reg_type === 'manquant' ? 'bg-red-50/40 border-red-200' : r.reg_type === 'excedent' ? 'bg-amber-50/40 border-amber-200' : 'bg-white border-slate-200'}`}>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold capitalize text-slate-800">{r.reg_type}</div>
                      {r.reason && <div className="text-[10px] text-slate-500 article-text line-clamp-1 mt-0.5">{r.reason}</div>}
                    </div>
                    <div className="num font-bold text-xs text-slate-900 shrink-0">{formatFCFA(r.amount)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4 text-[11px] text-slate-500">Aucune régularisation.</div>
            )}
            <button onClick={() => setRegOpen(true)} className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-dashed border-slate-300 text-slate-700 hover:border-brand-400 hover:bg-brand-50/40 transition">
              <Plus className="w-3.5 h-3.5" /> Ajouter une régularisation
            </button>
          </div>
        ) : (
          <div className="space-y-3 count-up">
            <div className="p-3 bg-gradient-to-br from-ink-900 to-slate-800 text-white rounded-2xl space-y-2 shadow-premium">
              <div className="flex items-center gap-1.5"><Lock className="w-4 h-4 text-slate-300" /><span className="text-xs font-bold tracking-wide">RÉCAPITULATIF</span></div>
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                <span className="text-slate-400">Fond ouverture</span>
                <span className="text-right font-semibold num">{formatFCFA(session!.opening_amount)}</span>
                <span className="text-slate-400">Total compté</span>
                <span className="text-right font-semibold num">{formatFCFA(controlLines.reduce((s, c) => s + c.counted_amount, 0))}</span>
                <span className="text-slate-400 border-t border-slate-700 pt-1.5">Écart final</span>
                <span className={`border-t border-slate-700 pt-1.5 text-right font-bold num ${totalVariance === 0 ? 'text-emerald-400' : totalVariance < 0 ? 'text-red-400' : 'text-amber-400'}`}>
                  {totalVariance === 0 ? 'Équilibré' : `${totalVariance > 0 ? '+' : ''}${formatFCFA(totalVariance)}`}
                </span>
              </div>
            </div>
            <input value={closingNote} onChange={e => setClosingNote(e.target.value)} className="input text-sm" placeholder="Note de clôture (optionnel)" />
            <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-50 text-[11px] text-amber-800">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Action irréversible. La session sera verrouillée.</span>
            </div>
          </div>
        )}
      </Modal>

      {/* Web orders modal */}
      <Modal open={webOrdersOpen} onClose={() => { setWebOrdersOpen(false); setWebOrderDetail(null); }} title="Commandes web" size="lg"
        footer={<button onClick={() => { setWebOrdersOpen(false); setWebOrderDetail(null); }} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>}>
        {!webOrderDetail ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {([
                { k: 'a_transformer', label: 'À transformer', count: webOrdersCounts.a_transformer, icon: ArrowRightCircle },
                { k: 'livraison', label: 'Livraison', count: webOrdersCounts.livraison, icon: Truck },
                { k: 'attente_paiement', label: 'Attente paiement', count: webOrdersCounts.attente_paiement, icon: ClockIcon },
                { k: 'all', label: 'Toutes', count: webOrders.length, icon: Globe },
              ] as const).map(f => {
                const Icon = f.icon;
                const active = webOrdersFilter === f.k;
                return (
                  <button key={f.k} onClick={() => setWebOrdersFilter(f.k as any)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${active ? 'bg-gradient-to-r from-brand-600 to-brand-800 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
                    <Icon className="w-3.5 h-3.5" />{f.label}
                    <span className={`min-w-[20px] h-4 px-1 rounded-full flex items-center justify-center text-[10px] ${active ? 'bg-white/25' : 'bg-white text-slate-700'}`}>{f.count}</span>
                  </button>
                );
              })}
              <button onClick={loadWebOrders} className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold text-brand-700 hover:bg-brand-50">
                <RotateCcw className="w-3.5 h-3.5" />Actualiser
              </button>
            </div>
            {webOrdersLoading ? (
              <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-brand-600" /></div>
            ) : webOrdersFiltered.length === 0 ? (
              <EmptyState icon={Globe} title="Aucune commande" description="Aucune commande web dans cette catégorie." />
            ) : (
              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                {webOrdersFiltered.map(o => {
                  const transformed = !!o.sale_id;
                  return (
                    <button key={o.id} onClick={() => openWebOrderDetail(o)}
                      className="w-full text-left p-3 rounded-xl bg-white border border-slate-200 hover:border-brand-400 hover:shadow-sm transition-all">
                      <div className="flex items-start gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${o.status === 'annulee' ? 'bg-rose-100 text-rose-700' : transformed ? 'bg-emerald-100 text-emerald-700' : 'bg-brand-100 text-brand-700'}`}>
                          {o.delivery_mode === 'livraison' ? <Truck className="w-5 h-5" /> : <ShoppingBag className="w-5 h-5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-extrabold text-slate-900 tracking-wider text-sm">{o.order_number}</span>
                            <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${o.status === 'nouvelle' ? 'bg-sky-100 text-sky-700' : o.status === 'confirmee' ? 'bg-indigo-100 text-indigo-700' : o.status === 'en_preparation' ? 'bg-amber-100 text-amber-700' : o.status === 'prete' ? 'bg-violet-100 text-violet-700' : o.status === 'livree' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{o.status}</span>
                            {transformed && <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-emerald-600 text-white inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Transformée</span>}
                            {o.payment_status !== 'paye' && <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">{o.payment_status === 'en_attente' ? 'Attente' : 'Non payé'}</span>}
                          </div>
                          <div className="text-xs text-slate-600 mt-0.5 break-words">{o.customer_name} · <Phone className="inline w-3 h-3" /> {o.customer_phone}</div>
                          <div className="text-[11px] text-slate-400 mt-0.5">{new Date(o.created_at).toLocaleString('fr-FR')}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-extrabold text-slate-900 num">{formatFCFA(o.total)}</div>
                          <div className="text-[10px] text-slate-500 capitalize">{(o.payment_mode || '').replace(/_/g, ' ')}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <button onClick={() => { setWebOrderDetail(null); setWebOrderItems([]); }} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900">
              <ChevronLeft className="w-4 h-4" />Retour à la liste
            </button>
            <div className="p-4 rounded-xl bg-gradient-to-br from-brand-50 to-white border border-brand-100">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-brand-700">Commande</div>
                  <div className="font-extrabold text-lg text-slate-900 tracking-wider">{webOrderDetail.order_number}</div>
                  <div className="text-xs text-slate-600 mt-1">{new Date(webOrderDetail.created_at).toLocaleString('fr-FR')}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total</div>
                  <div className="font-extrabold text-xl text-slate-900 num">{formatFCFA(webOrderDetail.total)}</div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1"><User className="w-3 h-3" />Client</div>
                <div className="font-bold text-slate-900">{webOrderDetail.customer_name}</div>
                <div className="text-slate-600 flex items-center gap-1 mt-0.5"><Phone className="w-3 h-3" />{webOrderDetail.customer_phone}</div>
                {webOrderDetail.customer_whatsapp && <div className="text-emerald-700 mt-0.5">WhatsApp: {webOrderDetail.customer_whatsapp}</div>}
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1">
                  {webOrderDetail.delivery_mode === 'livraison' ? <Truck className="w-3 h-3" /> : <ShoppingBag className="w-3 h-3" />}
                  {webOrderDetail.delivery_mode === 'livraison' ? 'Livraison' : 'Retrait'}
                </div>
                <div className="text-slate-800">{webOrderDetail.delivery_mode === 'livraison' ? (webOrderDetail.delivery_address || '—') : 'Retrait en boutique'}</div>
                {webOrderDetail.delivery_fee > 0 && <div className="text-slate-500 mt-0.5">Frais: {formatFCFA(webOrderDetail.delivery_fee)}</div>}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-900">
                <div className="font-bold">Paiement: <span className="capitalize">{(webOrderDetail.payment_mode || '').replace(/_/g, ' ')}</span></div>
                <div className="mt-0.5">Le stock sera décrémenté uniquement lors de la validation de la vente en caisse.</div>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-500">Articles ({webOrderItems.length})</div>
              <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
                {webOrderItems.map(it => (
                  <div key={it.id} className="flex items-start justify-between px-3 py-2 gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-900 break-words">{it.article_name}</div>
                      <div className="text-[11px] text-slate-500">Qté {it.quantity} × {formatFCFA(it.unit_price)}</div>
                    </div>
                    <div className="text-sm font-bold text-slate-900 shrink-0 num whitespace-nowrap">{formatFCFA(it.line_total)}</div>
                  </div>
                ))}
              </div>
            </div>
            {webOrderDetail.customer_note && (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700">
                <span className="font-bold">Note client:</span> {webOrderDetail.customer_note}
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-2">
              {!webOrderDetail.sale_id && webOrderDetail.status !== 'annulee' && (
                <button onClick={loadToCartFromWebOrder} disabled={!session || transforming}
                  className="flex-1 h-11 rounded-xl bg-gradient-to-r from-brand-600 to-brand-800 text-white font-bold inline-flex items-center justify-center gap-2 hover:opacity-95 active:scale-[0.98] transition-all shadow-glow disabled:opacity-60">
                  <ArrowRight className="w-4 h-4" />Transformer en vente
                </button>
              )}
              {webOrderDetail.sale_id && webOrderDetail.status !== 'livree' && (
                <button onClick={() => markWebOrderDelivered(webOrderDetail)} className="flex-1 h-11 rounded-xl bg-emerald-600 text-white font-bold inline-flex items-center justify-center gap-2 hover:bg-emerald-700 active:scale-[0.98] transition-all">
                  <CheckCircle2 className="w-4 h-4" />Marquer livrée
                </button>
              )}
              {webOrderDetail.customer_phone && (
                <a href={`tel:${webOrderDetail.customer_phone}`} className="h-11 px-4 rounded-xl bg-slate-100 text-slate-700 font-semibold inline-flex items-center justify-center gap-2 hover:bg-slate-200 transition-all">
                  <Phone className="w-4 h-4" />Appeler
                </a>
              )}
              {webOrderDetail.status !== 'annulee' && !webOrderDetail.sale_id && (
                <button onClick={() => cancelWebOrder(webOrderDetail)} className="h-11 px-4 rounded-xl bg-rose-50 text-rose-700 font-semibold inline-flex items-center justify-center gap-2 hover:bg-rose-100 transition-all border border-rose-200">
                  <X className="w-4 h-4" />Annuler
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

// ═══ Fullscreen immersive payment screen ═══════════════════════════════════════

function PaymentScreen({
  total, customer, methods, payments, setPayments, paying,
  onClose, onValidate, onValidateCredit,
  docSettings, docFields, setDocFields,
}: {
  total: number;
  customer: Customer | null;
  methods: PaymentMethod[];
  payments: SalePayment[];
  setPayments: (updater: (p: SalePayment[]) => SalePayment[]) => void;
  paying: boolean;
  onClose: () => void;
  onValidate: () => void;
  onValidateCredit: () => void;
  docSettings: { show_delivery_date: boolean; show_reference: boolean; show_warranty: boolean; show_representative: boolean; default_representative: string };
  docFields: { deliveryDate: string; reference: string; warranty: string; representative: string };
  setDocFields: { setDeliveryDate: (v: string) => void; setReference: (v: string) => void; setWarranty: (v: string) => void; setRepresentative: (v: string) => void };
}) {
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = total - totalPaid;
  const enough = totalPaid >= total && total > 0;
  const canPartial = customer && totalPaid > 0 && totalPaid < total;

  const hasDocFields = docSettings.show_delivery_date || docSettings.show_reference || docSettings.show_warranty || docSettings.show_representative;

  const modeStyle = (name: string): { tint: string; emoji: string } => {
    const n = name.toLowerCase();
    if (n.includes('espèce') || n.includes('liquide') || n.includes('cash')) return { tint: 'from-emerald-500/20 to-emerald-600/10', emoji: 'ESP' };
    if (n.includes('wave')) return { tint: 'from-sky-500/25 to-sky-600/10', emoji: 'WAV' };
    if (n.includes('orange')) return { tint: 'from-orange-500/25 to-orange-600/10', emoji: 'OM' };
    if (n.includes('free')) return { tint: 'from-pink-500/25 to-pink-600/10', emoji: 'FM' };
    if (n.includes('carte') || n.includes('cb')) return { tint: 'from-brand-500/25 to-brand-700/10', emoji: 'CB' };
    if (n.includes('virement')) return { tint: 'from-blue-500/25 to-blue-700/10', emoji: 'VIR' };
    if (n.includes('chèque') || n.includes('cheque')) return { tint: 'from-violet-500/25 to-violet-700/10', emoji: 'CHQ' };
    return { tint: 'from-slate-400/20 to-slate-600/10', emoji: '∙' };
  };

  const selectMethod = (m: PaymentMethod) => {
    const existing = payments.findIndex(p => p.payment_method_id === m.id);
    if (existing >= 0) return;
    const amt = Math.max(0, remaining);
    setPayments(arr => [...arr.filter(p => p.amount > 0 || p.payment_method_id === m.id), { payment_method_id: m.id, method_name: m.name, amount: amt, reference: '' }]);
  };

  const updateAmount = (idx: number, val: string) => {
    const n = Math.max(0, Number(val) || 0);
    setPayments(arr => arr.map((p, i) => i === idx ? { ...p, amount: n } : p));
  };

  const removePayment = (idx: number) => {
    setPayments(arr => arr.filter((_, i) => i !== idx));
  };

  const setExact = (idx: number) => {
    const othersTotal = payments.reduce((s, p, i) => i === idx ? s : s + p.amount, 0);
    const needed = Math.max(0, total - othersTotal);
    setPayments(arr => arr.map((p, i) => i === idx ? { ...p, amount: needed } : p));
  };

  return (
    <div className="fixed inset-0 z-[80] bg-ink-900 text-white flex flex-col animate-fade-in overflow-hidden safe-top safe-bottom">
      <div className="pointer-events-none absolute inset-0 opacity-60">
        <div className="absolute -top-40 -right-40 w-[520px] h-[520px] rounded-full bg-brand-500/20 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-[520px] h-[520px] rounded-full bg-brand-700/20 blur-3xl" />
      </div>

      {/* Header with total + buttons */}
      <div className="relative shrink-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-white/10 transition-colors" disabled={paying}>
            <X className="w-5 h-5" />
          </button>
          <div className="text-center flex-1 min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest text-white/50">Encaissement</div>
            <div className="text-2xl sm:text-3xl font-bold tracking-tight num leading-none mt-0.5">{formatFCFA(total)}</div>
          </div>
          <div className="w-9" />
        </div>
        {/* Summary bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-white/[0.02]">
          <div className="flex items-center gap-3 text-[11px]">
            {customer && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/10"><User className="w-3 h-3" /> {customer.name}</span>}
            {totalPaid > 0 && (
              <>
                <span className="text-white/60">Recu <span className="num font-bold text-white">{formatFCFA(totalPaid)}</span></span>
                {remaining > 0 ? <span className="text-amber-300 font-semibold">Reste <span className="num">{formatFCFA(remaining)}</span></span>
                : <span className="text-emerald-300 font-semibold">Monnaie <span className="num">{formatFCFA(-remaining)}</span></span>}
              </>
            )}
          </div>
          {/* Action buttons moved up */}
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 h-8 rounded-xl bg-white/5 hover:bg-white/10 text-white/80 font-semibold text-[11px] transition-colors" disabled={paying}>
              Annuler
            </button>
            {enough ? (
              <button onClick={onValidate} disabled={paying}
                className="h-8 px-4 rounded-xl font-bold text-[11px] flex items-center gap-1.5 bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-[0_8px_24px_-8px_rgb(16_185_129_/0.5)] active:scale-[0.98] whitespace-nowrap">
                {paying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                {paying ? '...' : `Valider · ${formatFCFA(total)}`}
              </button>
            ) : canPartial ? (
              <button onClick={onValidate} disabled={paying}
                className="h-8 px-3 rounded-xl font-bold text-[11px] flex items-center gap-1.5 bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-[0_8px_24px_-8px_rgb(217_119_6_/0.4)] active:scale-[0.98] whitespace-nowrap">
                {paying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                {paying ? '...' : `Partiel · ${formatFCFA(remaining)} credit`}
              </button>
            ) : (
              <div className="h-8 px-3 rounded-xl bg-white/10 text-white/40 font-semibold text-[11px] flex items-center whitespace-nowrap">
                {totalPaid === 0 ? 'Choisir un mode' : `Reste ${formatFCFA(remaining)}`}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content: 2 columns on desktop, stacked on mobile */}
      <div className="relative flex-1 min-h-0 overflow-y-auto px-4 py-4">
        <div className={`mx-auto ${hasDocFields ? 'max-w-3xl grid grid-cols-1 md:grid-cols-2 gap-6' : 'max-w-md space-y-4'}`}>
          {/* Left column: payment methods */}
          <div className="space-y-4">
            {/* Payment lines */}
            {payments.length > 0 && (
              <div className="space-y-2">
                {payments.map((p, idx) => {
                  const { emoji } = modeStyle(p.method_name);
                  return (
                    <div key={idx} className="flex items-center gap-2 p-2.5 rounded-2xl bg-white/5 border border-white/10">
                      <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-[9px] font-bold shrink-0">{emoji}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] text-white/50 leading-tight mb-0.5">{p.method_name}</div>
                        <input
                          type="number"
                          inputMode="numeric"
                          value={p.amount || ''}
                          onChange={e => updateAmount(idx, e.target.value)}
                          className="w-full bg-transparent text-lg font-bold num outline-none border-none p-0 leading-tight [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          placeholder="0"
                        />
                      </div>
                      <button onClick={() => setExact(idx)} className="px-2 py-1 rounded-lg bg-brand-500/30 text-brand-100 text-[10px] font-bold hover:bg-brand-500/50 transition-colors shrink-0">
                        Exact
                      </button>
                      <button onClick={() => removePayment(idx)} className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-300 shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Payment methods tokens */}
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-2">
                {payments.length > 0 ? 'Ajouter un autre mode' : 'Mode de paiement'}
              </div>
              <div className="flex flex-wrap gap-2">
                {methods.filter(m => !payments.some(p => p.payment_method_id === m.id)).map(m => {
                  const { emoji } = modeStyle(m.name);
                  return (
                    <button key={m.id} onClick={() => selectMethod(m)}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/8 border border-white/12 hover:bg-white/15 active:scale-95 transition-all">
                      <span className="text-[11px] font-black tracking-wider text-white/80 font-mono leading-none">{emoji}</span>
                      <span className="text-[12px] font-semibold text-white/90 leading-none">{m.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Credit sale option */}
            {customer && totalPaid === 0 && (
              <div className="pt-2 border-t border-white/10">
                <button onClick={onValidateCredit} disabled={paying}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-amber-500/15 border border-amber-400/30 text-amber-100 hover:bg-amber-500/25 transition-all text-sm font-bold">
                  {paying ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                  Tout a credit · {customer.name}
                </button>
                <div className="text-[10px] text-white/50 mt-1.5 text-center">Facture impayee dans le compte client</div>
              </div>
            )}
          </div>

          {/* Right column: document fields (only if any enabled) */}
          {hasDocFields && (
            <div className="space-y-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-2">Informations document</div>
              <div className="space-y-2.5">
                {docSettings.show_reference && (
                  <div>
                    <label className="text-[10px] font-semibold text-white/60 mb-1 block">Reference client</label>
                    <input
                      value={docFields.reference}
                      onChange={e => setDocFields.setReference(e.target.value)}
                      placeholder="Ref. commande / dossier"
                      className="w-full h-9 rounded-xl bg-white/8 border border-white/12 px-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-brand-400/50 focus:bg-white/10 transition-colors"
                    />
                  </div>
                )}
                {docSettings.show_delivery_date && (
                  <div>
                    <label className="text-[10px] font-semibold text-white/60 mb-1 block">Date de livraison</label>
                    <input
                      type="date"
                      value={docFields.deliveryDate}
                      onChange={e => setDocFields.setDeliveryDate(e.target.value)}
                      className="w-full h-9 rounded-xl bg-white/8 border border-white/12 px-3 text-sm text-white outline-none focus:border-brand-400/50 focus:bg-white/10 transition-colors [color-scheme:dark]"
                    />
                  </div>
                )}
                {docSettings.show_warranty && (
                  <div>
                    <label className="text-[10px] font-semibold text-white/60 mb-1 block">Garantie</label>
                    <input
                      value={docFields.warranty}
                      onChange={e => setDocFields.setWarranty(e.target.value)}
                      placeholder="Ex: 6 mois, 1 an"
                      className="w-full h-9 rounded-xl bg-white/8 border border-white/12 px-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-brand-400/50 focus:bg-white/10 transition-colors"
                    />
                  </div>
                )}
                {docSettings.show_representative && (
                  <div>
                    <label className="text-[10px] font-semibold text-white/60 mb-1 block">Representant</label>
                    <input
                      value={docFields.representative}
                      onChange={e => setDocFields.setRepresentative(e.target.value)}
                      placeholder="Nom du commercial"
                      className="w-full h-9 rounded-xl bg-white/8 border border-white/12 px-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-brand-400/50 focus:bg-white/10 transition-colors"
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile-only bottom action bar (hidden on md+) */}
      <div className="relative border-t border-white/10 px-4 py-3 bg-ink-900/80 backdrop-blur-xl shrink-0 safe-bottom md:hidden">
        <div className="flex gap-2">
          <button onClick={onClose} className="px-4 h-12 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-semibold text-sm transition-colors" disabled={paying}>
            Annuler
          </button>
          {enough ? (
            <button onClick={onValidate} disabled={paying}
              className="flex-1 min-w-0 h-12 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-[0_12px_40px_-12px_rgb(16_185_129_/0.5)] active:scale-[0.98] whitespace-nowrap">
              {paying ? <Loader2 className="w-5 h-5 animate-spin shrink-0" /> : <Check className="w-5 h-5 shrink-0" />}
              <span className="truncate">{paying ? 'Traitement...' : `Valider · ${formatFCFA(total)}`}</span>
            </button>
          ) : canPartial ? (
            <button onClick={onValidate} disabled={paying}
              className="flex-1 min-w-0 h-12 rounded-2xl font-bold text-[13px] flex items-center justify-center gap-1.5 bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-[0_12px_40px_-12px_rgb(217_119_6_/0.4)] active:scale-[0.98] whitespace-nowrap px-3">
              {paying ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : <FileText className="w-4 h-4 shrink-0" />}
              <span className="truncate">{paying ? 'Traitement...' : `Partiel · ${formatFCFA(remaining)} credit`}</span>
            </button>
          ) : (
            <div className="flex-1 min-w-0 h-12 rounded-2xl bg-white/10 text-white/40 font-semibold text-sm flex items-center justify-center whitespace-nowrap">
              {totalPaid === 0 ? 'Choisir un mode' : `Reste ${formatFCFA(remaining)}`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
