import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import {
  Search,
  Trash2,
  ShoppingCart,
  CreditCard,
  Loader2,
  Package,
  X,
  User,
  Check,
  LogOut,
  Lock,
  Printer,
  BarChart2,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  AlertTriangle,
  ArrowRight,
  Pause,
  RotateCcw,
  FileText,
  List,
  LayoutGrid,
  Play,
  Car,
  Tag,
  ArrowDownAZ,
  CheckCircle2,
  Wallet,
  ArrowDownRight,
  Globe,
  Truck,
  ShoppingBag,
  ArrowRightCircle,
  Clock as ClockIcon,
  Phone,
  AlertCircle,
  Shield,
  MapPin,
  TrendingUp,
  UserPlus,
  Store,
  History,
  Menu as MenuIcon,
  Eye,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { usePermissions } from '../lib/permissions';
import { useToast } from '../context/ToastContext';
import { formatFCFA } from '../lib/format';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { MarqueeText } from '../components/MarqueeText';
import { SearchableSelect } from '../components/SearchableSelect';
import { VehicleArticlePicker } from '../components/VehicleArticlePicker';

import { isAutoParts } from '../lib/types';
import { desktopAutoFocus } from '../lib/device';
import { buildPrintTenantForSite, type PrintTenant } from '../lib/print';
import type { CartItem, PaymentMethod, Customer, CashSession, SalePayment } from '../lib/types';
import { peekNavContext, consumeNavContext } from '../lib/navHighlight';
import { isSaleSettlementIncome } from '../lib/cashMovements';
import { CashSupervision } from '../components/CashSupervision';
import { CashMovementModal } from '../components/cash/CashMovementModal';
import { CustomerPaymentModal } from '../components/cash/CustomerPaymentModal';
import { SaleReturnModal } from '../components/cash/SaleReturnModal';
import { CashCloseModal } from '../components/cash/CashCloseModal';
import type { CashOpContext } from '../components/cash/cashOpContext';
import { printSaleTicketDoc, printSaleInvoiceDoc, type PrintableSale } from '../components/cash/saleDocPrint';
import { SessionTicketsModal } from '../components/cash/SessionTicketsModal';
import { SessionStatsModal } from '../components/cash/SessionStatsModal';
import { LotPickerModal, type ArticleLotSelection } from '../components/LotPickerModal';
import { calculerIpm, parseConvention, type IpmArticleLine } from '../lib/ipm';
import { QuickCreateArticleModal, QuickCreateCustomerModal, QuickCreateButton } from '../components/QuickCreate';
import { QuickActionsPanel } from '../components/QuickActionsPanel';
import { Activity } from 'lucide-react';
import { CategoryPickerModal } from './ArticlesComponents';
import { PosNumpad, type NumpadField } from '../components/PosNumpad';
import { PosRegisterPicker } from '../components/PosRegisterPicker';
import { newIdempotencyKey, registerLabel, registerText, type PosCashContext } from '../lib/cashSession';
import { type SalesRepresentative, type RepCommissionSettings, DEFAULT_REP_SETTINGS, computeRepCommission, repDisplayName } from '../lib/repCommission';

type ArticleLite = {
  id: string; internal_ref: string; name: string; oem_ref: string;
  sale_price: number; purchase_price: number; stock_available: number;
  category_id: string | null; image_url: string | null; ipm_eligible: boolean;
  track_stock: boolean;
  _stockLoaded?: boolean;
};

type ArticleTier = { article_id: string; tier_name: string; price: number };

type CategoryLite = { id: string; name: string; parent_id: string | null; track_stock?: boolean };



type HeldCart = {
  id: string;
  label: string;
  cart: CartItem[];
  customer: Customer | null;
  discount: number;
  savedAt: string;
};


function PosCardImage({ url, alt }: { url: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <div className="pos-card-noimg w-full h-full" aria-hidden="true" />;
  return (
    <img src={url} alt={alt} loading="lazy" onError={() => setFailed(true)}
      style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center', margin: 0, padding: 0 }} />
  );
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
      const [{ data: sales }, { data: payments }, { data: movements }] = await Promise.all([
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
        supabase
          .from('cash_movements')
          .select('kind, amount, reason, method_name')
          .eq('tenant_id', tenantId)
          .eq('cash_session_id', sessionId),
      ]);
      const salesArr = sales || [];
      const paymentsArr = (payments || []) as { method_name: string; amount: number }[];
      const movementsArr = (movements || []) as { kind: string; amount: number; reason: string | null; method_name: string | null }[];
      const byMethod: Record<string, number> = {};
      let total = 0;
      for (const p of paymentsArr) {
        const amt = Number(p.amount);
        byMethod[p.method_name] = (byMethod[p.method_name] || 0) + amt;
        total += amt;
      }
      for (const m of movementsArr) {
        if (m.kind !== 'income' && m.kind !== 'customer_prepayment') continue;
        if (isSaleSettlementIncome(m.kind, m.reason)) continue;
        const amt = Number(m.amount);
        const method = m.method_name || 'Espèces';
        byMethod[method] = (byMethod[method] || 0) + amt;
        total += amt;
      }
      setSummary({
        salesCount: salesArr.length,
        salesTotal: total,
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

type RecentSessionSale = {
  id: string;
  sale_number: string;
  total: number;
  created_at: string;
  customer_name: string | null;
};

function useRecentSessionSales(tenantId?: string, sessionId?: string) {
  const [sales, setSales] = useState<RecentSessionSale[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!tenantId || !sessionId) return;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from('sales')
        .select('id, sale_number, total, created_at, customers(name)')
        .eq('tenant_id', tenantId)
        .eq('cash_session_id', sessionId)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(5);
      setSales((data || []).map((s: any) => ({
        id: s.id,
        sale_number: s.sale_number,
        total: Number(s.total),
        created_at: s.created_at,
        customer_name: s.customers?.name || null,
      })));
      setLoading(false);
    })();
  }, [tenantId, sessionId]);
  return { sales, loading };
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

function LandingActionBtn({ icon: Icon, label, onClick, disabled, variant, badge }: {
  icon: typeof Wallet; label: string; onClick: () => void; disabled?: boolean;
  variant?: 'primary' | 'dark'; badge?: number;
}) {
  const base = variant === 'primary'
    ? 'bg-neutral-100 border-neutral-200 text-neutral-800 hover:bg-neutral-100'
    : variant === 'dark'
    ? 'bg-neutral-900 border-neutral-800 text-white hover:bg-neutral-800'
    : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative flex flex-col items-center justify-center gap-1.5 px-2 py-3 rounded-md border text-center transition-all active:scale-[0.97] ${base} ${disabled ? 'opacity-40 pointer-events-none' : ''}`}
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
      className={`flex flex-col items-center justify-center gap-1.5 px-3 py-2.5 rounded-md border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-600 transition-all active:scale-[0.97] ${disabled ? 'opacity-40 pointer-events-none' : ''}`}
    >
      <Icon className="w-4.5 h-4.5" />
      <span className="text-[10px] font-medium leading-tight text-neutral-600 whitespace-nowrap">{label}</span>
    </button>
  );
}

function POSLandingOpenMinimal({
  tenantName, tenantLogo, fundModalOpen, setFundModalOpen,
  openingAmount, setOpeningAmount, openingSubmitting, openSessionSubmit,
  siteName, cashierName, onMenu, registerSlot, openDisabled,
}: {
  registerSlot?: React.ReactNode;
  openDisabled?: boolean;
  tenantName?: string;
  tenantLogo?: string | null;
  fundModalOpen: boolean;
  setFundModalOpen: (v: boolean) => void;
  openingAmount: number;
  setOpeningAmount: (v: number) => void;
  openingSubmitting: boolean;
  openSessionSubmit: () => void;
  siteName?: string;
  cashierName?: string;
  onMenu: () => void;
}) {
  const [now, setNow] = useState(() => new Date());
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const fundInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onVis = () => { if (!document.hidden) setNow(new Date()); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); };
  }, []);

  useEffect(() => {
    if (fundModalOpen) {
      setTimeout(() => fundInputRef.current?.focus(), 50);
    } else {
      setOpeningAmount(0);
    }
  }, [fundModalOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dayStr = now.toLocaleDateString('fr-FR', { weekday: 'long' });
  const dateStr = now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  const submitFund = (e: React.FormEvent) => {
    e.preventDefault();
    if (openingSubmitting) return;
    openSessionSubmit();
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[var(--w-bg)] overflow-hidden">
      {/* Top bar: clock left, logo right — aligned on all sizes */}
      <div className="flex items-center justify-between px-4 sm:px-10 pt-4 sm:pt-8">
        {/* Clock: time on left, day+date stacked on right at same height */}
        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-4">
          <span className="text-2xl sm:text-5xl font-bold tabular-nums text-neutral-900 leading-none tracking-tight">{timeStr}</span>
          <div className="flex flex-col justify-center gap-0.5">
            <span className="text-[10px] sm:text-sm font-medium text-neutral-500 capitalize leading-none">{dayStr}</span>
            <span className="text-[9px] sm:text-xs text-neutral-400 capitalize leading-none">{dateStr}</span>
          </div>
        </div>
        {/* Logo zone: directly on page background */}
        <div className="flex-1 min-w-0 flex items-center justify-end px-2 py-1.5 sm:px-3 sm:py-2 overflow-hidden">
          {tenantLogo ? (
            <img src={tenantLogo} alt={tenantName || ''} className="max-h-8 sm:max-h-16 max-w-full object-contain" />
          ) : (
            <span className="text-xs sm:text-lg font-bold text-neutral-700 tracking-tight truncate whitespace-nowrap">{tenantName || 'Waarwi'}</span>
          )}
        </div>
      </div>

      {/* Center: site + cashier info, then Ouvrir la caisse */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 gap-3">
        {/* Site name (larger, higher) + cashier below */}
        <div className="flex flex-col items-center gap-1.5 text-center">
          {siteName && <div className="text-sm sm:text-base font-semibold text-neutral-800"><span className="text-neutral-400 font-normal">Point de vente : </span>{siteName}</div>}
          {cashierName && <div className="text-[11px] leading-tight"><span className="text-neutral-400">Vendeur : </span><span className="font-semibold text-neutral-700">{cashierName}</span></div>}
        </div>
        {registerSlot}
        <button
          onClick={() => setFundModalOpen(true)}
          disabled={openDisabled}
          className="disabled:opacity-40 disabled:pointer-events-none group flex flex-col items-center gap-3 px-8 py-7 rounded-xl bg-white shadow-sm hover:shadow-md transition-all duration-200 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-brand-400"
        >
          <ShoppingCart className="w-7 h-7 text-neutral-900 group-hover:text-brand-700 transition-colors" />
          <span className="text-sm font-bold text-neutral-900 group-hover:text-brand-700 transition-colors">Ouvrir la caisse</span>
        </button>
      </div>

      {/* Bottom: Menu + Quick Actions buttons */}
      <div className="flex items-center justify-center gap-3 pb-4 sm:pb-8">
        <button
          onClick={onMenu}
          className="flex items-center gap-2 px-8 py-3.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white text-sm font-bold shadow-sm hover:shadow-md transition-all duration-200 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-brand-400"
        >
          <MenuIcon className="w-5 h-5" />
          Menu
        </button>
        <button
          onClick={() => setQuickActionsOpen(true)}
          className="flex items-center gap-1.5 px-4 py-3.5 rounded-xl bg-[var(--w-surface)] border border-[var(--w-separator)] hover:bg-[var(--w-hover)] text-[var(--w-text-sec)] text-sm font-medium shadow-sm hover:shadow-md transition-all duration-200 active:scale-[0.98] quick-action-pulse"
        >
          <Activity className="w-4 h-4" />
          <span className="hidden sm:inline">Actions rapides</span>
        </button>
      </div>

      {quickActionsOpen && <QuickActionsPanel onClose={() => setQuickActionsOpen(false)} />}

      {/* Fund modal */}
      {fundModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 animate-fade-in">
          <div className="absolute inset-0 bg-black/40" onClick={() => !openingSubmitting && setFundModalOpen(false)} />
          <form onSubmit={submitFund} className="relative w-full max-w-[340px] bg-white rounded-xl shadow-premium flex flex-col animate-scale-in">
            <div className="px-5 py-3.5 border-b border-neutral-100">
              <h3 className="text-sm font-bold text-neutral-900">Fond de caisse</h3>
            </div>
            <div className="px-5 py-4 flex-1">
              <label className="text-[10px] text-neutral-400 leading-none mb-2 block">Montant initial — facultatif</label>
              <div className="flex items-baseline gap-1">
                <input
                  ref={fundInputRef}
                  type="number"
                  value={openingAmount || ''}
                  onChange={e => setOpeningAmount(Math.max(0, Number(e.target.value)))}
                  className="w-input-ul flex-1 min-w-0 text-lg font-bold text-neutral-900 tabular-nums py-1.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  placeholder="0"
                  min="0"
                  inputMode="numeric"
                  disabled={openingSubmitting}
                />
                <span className="text-sm font-medium text-neutral-400 shrink-0">FCFA</span>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-neutral-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setFundModalOpen(false)}
                disabled={openingSubmitting}
                className="px-3 py-2 text-xs font-medium text-neutral-500 hover:text-neutral-700 transition-colors disabled:opacity-40"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={openingSubmitting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold transition-colors disabled:opacity-50"
              >
                {openingSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
                Ouvrir la caisse
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function POSLandingOpenInline({
  tenantName, tenantLogo, fundModalOpen, setFundModalOpen,
  openingAmount, setOpeningAmount, openingSubmitting, openSessionSubmit,
  siteName, cashierName, onBack, registerSlot, openDisabled,
}: {
  registerSlot?: React.ReactNode;
  openDisabled?: boolean;
  tenantName?: string;
  tenantLogo?: string | null;
  fundModalOpen: boolean;
  setFundModalOpen: (v: boolean) => void;
  openingAmount: number;
  setOpeningAmount: (v: number) => void;
  openingSubmitting: boolean;
  openSessionSubmit: () => void;
  siteName?: string;
  cashierName?: string;
  onBack: () => void;
}) {
  const fundInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (fundModalOpen) {
      setTimeout(() => fundInputRef.current?.focus(), 50);
    } else {
      setOpeningAmount(0);
    }
  }, [fundModalOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitFund = (e: React.FormEvent) => {
    e.preventDefault();
    if (openingSubmitting) return;
    openSessionSubmit();
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <button
        onClick={onBack}
        className="absolute top-2 left-2 px-3 py-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-900 transition-colors"
      >
        Plein écran
      </button>

      <div className="flex flex-col items-center gap-1 text-center">
        {siteName && <div className="text-[11px] leading-tight"><span className="text-neutral-400">Point de vente : </span><span className="font-semibold text-neutral-700">{siteName}</span></div>}
        {cashierName && <div className="text-[11px] leading-tight"><span className="text-neutral-400">Vendeur : </span><span className="font-semibold text-neutral-700">{cashierName}</span></div>}
      </div>

      {registerSlot}
      <button
        onClick={() => setFundModalOpen(true)}
        disabled={openDisabled}
        className="disabled:opacity-40 disabled:pointer-events-none group flex flex-col items-center gap-3 px-8 py-7 rounded-xl bg-white shadow-sm hover:shadow-md transition-all duration-200 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-brand-400"
      >
        <ShoppingCart className="w-7 h-7 text-neutral-900 group-hover:text-brand-700 transition-colors" />
        <span className="text-sm font-bold text-neutral-900 group-hover:text-brand-700 transition-colors">Ouvrir la caisse</span>
      </button>

      {fundModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 animate-fade-in">
          <div className="absolute inset-0 bg-black/40" onClick={() => !openingSubmitting && setFundModalOpen(false)} />
          <form onSubmit={submitFund} className="relative w-full max-w-[340px] bg-white rounded-xl shadow-premium flex flex-col animate-scale-in">
            <div className="px-5 py-3.5 border-b border-neutral-100">
              <h3 className="text-sm font-bold text-neutral-900">Fond de caisse</h3>
            </div>
            <div className="px-5 py-4 flex-1">
              <label className="text-[10px] text-neutral-400 leading-none mb-2 block">Montant initial — facultatif</label>
              <div className="flex items-baseline gap-1">
                <input
                  ref={fundInputRef}
                  type="number"
                  value={openingAmount || ''}
                  onChange={e => setOpeningAmount(Math.max(0, Number(e.target.value)))}
                  className="w-input-ul flex-1 min-w-0 text-lg font-bold text-neutral-900 tabular-nums py-1.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  placeholder="0"
                  min="0"
                  inputMode="numeric"
                  disabled={openingSubmitting}
                />
                <span className="text-sm font-medium text-neutral-400 shrink-0">FCFA</span>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-neutral-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setFundModalOpen(false)}
                disabled={openingSubmitting}
                className="px-3 py-2 text-xs font-medium text-neutral-500 hover:text-neutral-700 transition-colors disabled:opacity-40"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={openingSubmitting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold transition-colors disabled:opacity-50"
              >
                {openingSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
                Ouvrir la caisse
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function POSLandingResume({
  session, currentSite, onResume, tenantId, onSeeAll, cashierName, tenantName, onSwitchSite, siteCount,
  actions,
}: {
  session: CashSession; currentSite: LandingSite;
  onResume: () => void; tenantId?: string; onSeeAll?: () => void; cashierName: string; tenantName?: string; onSwitchSite?: () => void; siteCount?: number;
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
    canWebOrders?: boolean;
    canViewSummary?: boolean;
    webOrdersBadge?: number;
    sessionOpen: boolean;
  };
}) {
  const { summary, loading: loadingSummary } = useDaySummary(tenantId, currentSite?.id, session.id);
  const { sales: recentSales, loading: loadingRecentSales } = useRecentSessionSales(tenantId, session.id);
  const isOpen = actions?.sessionOpen !== false;

  const shortcutBtns = actions ? [
    { icon: Wallet, label: 'Encaisser', onClick: actions.onCustomerPayment, show: true },
    { icon: ArrowDownRight, label: 'Mouvement', onClick: actions.onMovement, show: actions.canMovement },
    { icon: RotateCcw, label: 'Retour client', onClick: actions.onReturn, show: actions.canReturn },
    { icon: List, label: 'Tickets', onClick: actions.onTickets, show: true },
  ].filter(b => b.show) : [];

  return (
    <div className="h-full overflow-hidden lg:overflow-auto pb-0 lg:pb-6">
      {/* ── Desktop layout ── */}
      <div className="hidden lg:block">
        {/* Title row: Caisse + tenant */}
        <div className="flex items-end px-8 pt-6 pb-5 border-b border-neutral-100">
          <div className="leading-tight">
            <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Caisse</h1>
            <p className="text-sm text-neutral-500 mt-0.5 truncate whitespace-nowrap">{tenantName || currentSite?.name || '-'}</p>
          </div>
        </div>

        {/* Two-row body: row 1 = session info + résumé, row 2 = tickets + accès rapide */}
        <div className="px-8 pt-6">
          {/* ── Row 1: Informations + Résumé ── */}
          <div className="grid lg:grid-cols-[1fr_300px]">
            {/* Left: session info */}
            <div className="pr-8">
              <h3 className="text-sm font-bold text-neutral-900 mb-4">Informations de la session</h3>
              <div className="grid grid-cols-3">
                {/* Row 1 */}
                <div className="py-4 pr-4 border-b border-neutral-100">
                  <p className="text-[10px] text-neutral-400 leading-none mb-1.5">Point de vente</p>
                  <p className="text-[13px] font-bold text-neutral-900 truncate">{currentSite?.name || '-'}</p>
                </div>
                <div className="py-4 px-4 border-l border-b border-neutral-100">
                  <p className="text-[10px] text-neutral-400 leading-none mb-1.5">Ouverte le</p>
                  <p className="text-[13px] font-bold text-neutral-900 leading-tight">{new Date(session.opened_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })} · {fmtTimeLanding(session.opened_at)}</p>
                </div>
                <div className="py-4 pl-4 border-l border-b border-neutral-100">
                  <p className="text-[10px] text-neutral-400 leading-none mb-1.5">Durée</p>
                  <p className="text-[13px] font-bold text-neutral-900">{sessionDuration(session.opened_at)}</p>
                </div>
                {/* Row 2 */}
                <div className="py-4 pr-4">
                  <p className="text-[10px] text-neutral-400 leading-none mb-1.5">Fond initial</p>
                  <p className="text-[13px] font-bold text-neutral-900 tabular-nums">{formatFCFA(Number(session.opening_amount))}</p>
                </div>
                <div className="py-4 px-4 border-l border-neutral-100">
                  <p className="text-[10px] text-neutral-400 leading-none mb-1.5">Vendeur</p>
                  <p className="text-[13px] font-bold text-neutral-900 uppercase truncate">{cashierName || '-'}</p>
                </div>
                <div className="py-4 pl-4 border-l border-neutral-100">
                  <p className="text-[10px] text-neutral-400 leading-none mb-1.5">Statut</p>
                  <p className="text-[13px] font-bold text-emerald-600">Ouverte</p>
                </div>
              </div>
            </div>

            {/* Right: résumé */}
            <div className="lg:border-l border-neutral-100 pl-8">
              {actions?.canViewSummary !== false && (
                <div>
                  <h3 className="text-sm font-bold text-neutral-900 mb-3">Résumé de session</h3>
                  {loadingSummary ? (
                    <div className="space-y-2.5 animate-pulse">
                      <div className="h-10 bg-neutral-100 rounded" />
                      <div className="h-10 bg-neutral-100 rounded" />
                    </div>
                  ) : summary ? (
                    <div>
                      <div className="flex items-center justify-between py-2.5 border-b border-neutral-100">
                        <span className="text-[13px] text-neutral-600">Total encaissé</span>
                        <span className="text-[14px] font-bold text-neutral-900 tabular-nums">{formatFCFA(summary.salesTotal)}</span>
                      </div>
                      <div className="flex items-center justify-between py-2.5 border-b border-neutral-100">
                        <span className="text-[13px] text-neutral-600">Nombre de ventes</span>
                        <span className="text-[14px] font-bold text-neutral-900 tabular-nums">{summary.salesCount}</span>
                      </div>
                      {summary.byMethod.length > 0 && (
                        <div className="pt-2.5">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">Par mode de paiement</p>
                          {summary.byMethod.map(m => (
                            <div key={m.method_name} className="flex items-center justify-between py-1.5">
                              <span className="text-[12px] text-neutral-500">{m.method_name}</span>
                              <span className="text-[13px] font-bold text-neutral-800 tabular-nums">{formatFCFA(m.amount)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-[13px] text-neutral-400 text-center py-3">Aucune donnée</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Separator between rows */}
          <div className="h-px bg-[var(--w-separator-l)] mt-6 mb-6" />

          {/* ── Row 2: Tickets récents + Accès rapide ── */}
          <div className="grid lg:grid-cols-[1fr_300px]">
            {/* Left: tickets récents */}
            <div className="pr-8">
              <h3 className="text-sm font-bold text-neutral-900 mb-3">Tickets récents</h3>
              {loadingRecentSales ? (
                <div className="space-y-2 animate-pulse">
                  <div className="h-8 bg-neutral-100 rounded" />
                  <div className="h-8 bg-neutral-100 rounded" />
                </div>
              ) : recentSales.length > 0 ? (
                <div className="divide-y divide-neutral-100">
                  {recentSales.map(s => (
                    <div key={s.id} className="flex items-center gap-3 py-2.5">
                      <span className="text-[12px] tabular-nums text-neutral-500 shrink-0 w-16">{fmtDateShort(s.created_at)}</span>
                      <span className="text-[12px] font-medium text-neutral-700 shrink-0">{s.sale_number}</span>
                      <span className="text-[12px] text-neutral-500 truncate flex-1 min-w-0">{s.customer_name || '-'}</span>
                      <span className="text-[12px] font-bold text-neutral-900 tabular-nums shrink-0">{formatFCFA(s.total)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-neutral-400 py-3">Aucun ticket</p>
              )}
            </div>

            {/* Right: accès rapide */}
            <div className="lg:border-l border-neutral-100 pl-8 flex flex-col">
              <h3 className="text-sm font-bold text-neutral-900 mb-3">Accès rapide</h3>

              {/* Main actions: Reprendre / Clôturer */}
              <div className="grid grid-cols-2 gap-2 mb-2">
                <button onClick={onResume} className="flex items-center gap-2.5 px-3 py-3 rounded-md bg-neutral-50 hover:bg-neutral-100 text-neutral-900 transition-all active:scale-[0.98]">
                  <Play className="w-4 h-4 fill-current shrink-0 text-neutral-700" />
                  <span className="text-[13px] font-bold">Reprendre</span>
                </button>
                {actions?.canClose ? (
                  <button onClick={actions.onClose} disabled={!isOpen} className="flex items-center gap-2.5 px-3 py-3 rounded-md bg-neutral-50 hover:bg-neutral-100 text-neutral-900 transition-all active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none">
                    <Lock className="w-4 h-4 shrink-0 text-neutral-600" />
                    <span className="text-[13px] font-bold">Clôturer</span>
                  </button>
                ) : <div />}
              </div>

              {/* Shortcut buttons */}
              {shortcutBtns.length > 0 && (
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {shortcutBtns.map(btn => (
                    <button key={btn.label} onClick={btn.onClick} disabled={!isOpen} className="flex items-center gap-2.5 px-3 py-2.5 rounded-md bg-neutral-50 hover:bg-neutral-100 text-neutral-700 transition-all active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none">
                      <btn.icon className="w-4 h-4 shrink-0 text-neutral-600" />
                      <span className="text-[12px] font-medium">{btn.label}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Links without titles */}
              <div className="space-y-0.5 mt-auto">
                {onSeeAll && (
                  <button onClick={onSeeAll} className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-md hover:bg-neutral-50 text-left transition-colors group">
                    <History className="w-4 h-4 text-neutral-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-neutral-700 leading-tight">Historique des sessions</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-neutral-300 group-hover:text-neutral-500 shrink-0" />
                  </button>
                )}
                <button onClick={() => { if (siteCount && siteCount > 1 && onSwitchSite) onSwitchSite(); else if (onResume) onResume(); }} className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-md hover:bg-neutral-50 text-left transition-colors group">
                  <Store className="w-4 h-4 text-neutral-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-neutral-700 leading-tight">Point de vente</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-neutral-300 group-hover:text-neutral-500 shrink-0" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Mobile layout ── */}
      <div className="lg:hidden px-0 pt-1">
        <div className="px-2">
          {/* Header: title + tenant */}
          <div className="py-3">
            <h2 className="text-lg font-bold tracking-tight text-neutral-900 leading-tight">Caisse</h2>
            <p className="text-[12px] text-neutral-500 leading-tight mt-0.5 truncate">{tenantName || currentSite?.name || '-'}</p>
          </div>

          {/* Informations de la session */}
          <div className="py-3 border-t border-neutral-100">
            <h3 className="text-[13px] font-bold text-neutral-900 mb-2">Informations de la session</h3>
            <div className="grid grid-cols-2 gap-y-2.5 gap-x-1">
              <div>
                <p className="text-[9px] text-neutral-400 leading-none mb-0.5">Point de vente</p>
                <p className="text-[11px] font-bold text-neutral-900 truncate">{currentSite?.name || '-'}</p>
              </div>
              <div>
                <p className="text-[9px] text-neutral-400 leading-none mb-0.5">Ouverte le</p>
                <p className="text-[11px] font-bold text-neutral-900 leading-tight">{fmtTimeLanding(session.opened_at)}</p>
                <p className="text-[10px] text-neutral-500 leading-tight">{new Date(session.opened_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</p>
              </div>
              <div>
                <p className="text-[9px] text-neutral-400 leading-none mb-0.5">Durée</p>
                <p className="text-[11px] font-bold text-neutral-900 truncate">{sessionDuration(session.opened_at)}</p>
              </div>
              <div>
                <p className="text-[9px] text-neutral-400 leading-none mb-0.5">Fond initial</p>
                <p className="text-[11px] font-bold text-neutral-900 truncate tabular-nums">{formatFCFA(Number(session.opening_amount))}</p>
              </div>
              <div>
                <p className="text-[9px] text-neutral-400 leading-none mb-0.5">Vendeur</p>
                <p className="text-[11px] font-bold text-neutral-900 truncate">{cashierName ? cashierName.charAt(0).toUpperCase() + cashierName.slice(1).toLowerCase() : '-'}</p>
              </div>
              <div>
                <p className="text-[9px] text-neutral-400 leading-none mb-0.5">Statut</p>
                <p className="text-[11px] font-bold text-emerald-600">Ouverte</p>
              </div>
            </div>
          </div>

          {/* Résumé */}
          {actions?.canViewSummary !== false && (
            <div className="mt-2 pt-3 border-t border-neutral-100">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[13px] font-bold text-neutral-900">Résumé de session</h3>
                <span className="text-[11px] text-neutral-400">Aujourd'hui</span>
              </div>
              {loadingSummary ? (
                <div className="space-y-2 animate-pulse">
                  <div className="h-14 bg-neutral-100 rounded-md" />
                  <div className="h-8 bg-neutral-100 rounded-md" />
                </div>
              ) : summary ? (
                <>
                  <div className="rounded-md bg-neutral-900 px-4 py-3.5">
                    <p className="text-[9px] text-white/40 uppercase tracking-wider leading-none mb-1.5">Total encaissé</p>
                    <p className="text-xl font-bold text-white tabular-nums leading-tight">{formatFCFA(summary.salesTotal)}</p>
                  </div>
                  <div className="flex items-center mt-3">
                    <div className="flex-1 text-center">
                      <p className="text-[10px] text-neutral-400 leading-none mb-1">Ventes</p>
                      <p className="text-[14px] font-bold text-neutral-900 tabular-nums">{summary.salesCount}</p>
                    </div>
                    <div className="w-px h-8 bg-neutral-200 shrink-0" />
                    {(() => {
                      const cash = summary.byMethod.find(m => /esp[èe]ces|cash/i.test(m.method_name));
                      return (
                        <div className="flex-1 text-center">
                          <p className="text-[10px] text-neutral-400 leading-none mb-1">Espèces</p>
                          <p className="text-[14px] font-bold text-neutral-900 tabular-nums">{cash ? formatFCFA(cash.amount) : formatFCFA(0)}</p>
                        </div>
                      );
                    })()}
                  </div>
                </>
              ) : (
                <p className="text-[12px] text-neutral-400 text-center py-4">Aucune donnée</p>
              )}
            </div>
          )}

          {/* Accès rapide — buttons + links in same zone */}
          <div className="mt-4 pt-3 border-t border-neutral-100">
            <h3 className="text-[13px] font-bold text-neutral-900 mb-3">Accès rapide</h3>

            {/* Main actions */}
            <div className="grid grid-cols-2 gap-2 mb-2">
              <button onClick={onResume} className="flex items-center gap-2 px-3 py-3 rounded-md bg-neutral-50 hover:bg-neutral-100 text-neutral-900 transition-all active:scale-[0.97]">
                <Play className="w-4 h-4 fill-current shrink-0 text-neutral-700" />
                <span className="text-[13px] font-bold">Reprendre</span>
              </button>
              {actions?.canClose ? (
                <button onClick={actions.onClose} disabled={!isOpen} className="flex items-center gap-2 px-3 py-3 rounded-md bg-neutral-50 hover:bg-neutral-100 text-neutral-900 transition-all active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none">
                  <Lock className="w-4 h-4 shrink-0 text-neutral-600" />
                  <span className="text-[13px] font-bold">Clôturer</span>
                </button>
              ) : <div />}
            </div>

            {/* Shortcut buttons */}
            {shortcutBtns.length > 0 && (
              <div className="grid grid-cols-2 gap-2 mb-3">
                {shortcutBtns.map(btn => (
                  <button key={btn.label} onClick={btn.onClick} disabled={!isOpen} className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-neutral-50 hover:bg-neutral-100 text-neutral-700 transition-all active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none">
                    <btn.icon className="w-4 h-4 shrink-0 text-neutral-600" />
                    <span className="text-[12px] font-medium">{btn.label}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Links without titles */}
            <div className="space-y-0.5">
              {onSeeAll && (
                <button onClick={onSeeAll} className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-md hover:bg-neutral-50 text-left transition-colors group">
                  <History className="w-4 h-4 text-neutral-500 shrink-0" />
                  <p className="flex-1 text-[13px] font-medium text-neutral-700 leading-tight">Historique des sessions</p>
                  <ChevronRight className="w-4 h-4 text-neutral-300 group-hover:text-neutral-500 shrink-0" />
                </button>
              )}
              <button onClick={() => { if (siteCount && siteCount > 1 && onSwitchSite) onSwitchSite(); else if (onResume) onResume(); }} className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-md hover:bg-neutral-50 text-left transition-colors group">
                <Store className="w-4 h-4 text-neutral-500 shrink-0" />
                <p className="flex-1 text-[13px] font-medium text-neutral-700 leading-tight">Point de vente</p>
                <ChevronRight className="w-4 h-4 text-neutral-300 group-hover:text-neutral-500 shrink-0" />
              </button>
            </div>
          </div>

          <div className="h-4" />
        </div>
      </div>
    </div>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────────

// Module-level cache to avoid full reload when returning to POS
const posCache: {
  key: string;
  articles: ArticleLite[];
  customers: Customer[];
  methods: PaymentMethod[];
  session: CashSession | null;
  categories: CategoryLite[];
  topScores: Record<string, number>;
  articleTiers: ArticleTier[];
  screen: 'open-form' | 'resume' | 'pos';
  stockSiteId: string;
} = { key: '', articles: [], customers: [], methods: [], session: null, categories: [], topScores: {}, articleTiers: [], screen: 'open-form', stockSiteId: '' };

export function POS({ onLeave, onNavigate }: { onLeave?: () => void; onNavigate?: (route: string) => void }) {
  const { tenant, currentSite, sites, depots, profile, setPosCart, posCartOpen, refData, onDataChange, setCurrentSite } = useApp();
  const { can } = usePermissions();
  const enabledModules: string[] = Array.isArray((tenant as any)?.enabled_modules)
    ? (tenant as any).enabled_modules
    : ['dashboard','pos','cash_history','articles','stock','tiers','sales','billing','supplier_orders','online_orders','accounting','settings','reports','ipm'];
  const hasModule = (m: string) => enabledModules.includes(m);
  const tenantForPrint: PrintTenant = buildPrintTenantForSite(tenant, currentSite);
  const cashierName = profile?.full_name || profile?.email || '';

  const buildDocHeader = () => {
    if (!docDeliveryDate && !docReference && !docWarranty && !docImei && !docRepresentative) return null;
    return {
      delivery_date: docDeliveryDate || null,
      reference: docReference || null,
      warranty: docWarranty || null,
      imei: docImei || null,
      representative: posRepLabel(docRepresentative) || docRepresentative || null,
    };
  };

  const printSaleTicket = (sale: PrintableSale, docHeaderOverride?: Record<string, string | null> | null) =>
    printSaleTicketDoc(sale, docHeaderOverride !== undefined ? docHeaderOverride : buildDocHeader(), tenantForPrint, cashierName);

  const printSaleInvoice = (sale: PrintableSale, docHeaderOverride?: Record<string, string | null> | null, issuedByOverride?: string) =>
    printSaleInvoiceDoc(sale, docHeaderOverride !== undefined ? docHeaderOverride : buildDocHeader(), tenantForPrint, cashierName, issuedByOverride ?? (profile?.full_name || undefined));
  const autoMode = isAutoParts(tenant);
  const { success, error } = useToast();

  const depotAllOptions = useMemo(() => {
    const sharedCatalog = (tenant as any)?.settings?.shared_articles !== false;
    const interDepot = !!(tenant as any)?.settings?.inter_depot_transfer;
    const available = depots.filter(d => d.parent_site_id === currentSite?.id || (sharedCatalog && interDepot));
    return [...(currentSite ? [currentSite] : []), ...available];
  }, [tenant, currentSite, depots]);

  const posCacheKey = `${tenant?.id}:${currentSite?.id}`;
  const hasPosCache = posCache.key === posCacheKey && posCache.articles.length > 0;

  // Screen state: 'open-form' | 'resume' | 'pos'
  const [screen, setScreen] = useState<'open-form' | 'resume' | 'pos'>(hasPosCache ? posCache.screen : 'open-form');

  // Data
  const [articles, setArticles] = useState<ArticleLite[]>(hasPosCache ? posCache.articles : []);
  const [customers, setCustomers] = useState<Customer[]>(hasPosCache ? posCache.customers : []);
  const [methods, setMethods] = useState<PaymentMethod[]>(hasPosCache ? posCache.methods : []);
  const [session, setSession] = useState<CashSession | null>(hasPosCache ? posCache.session : null);
  const cashCtx: CashOpContext | null = session ? {
    mode: 'personal', sessionId: session.id, siteId: session.site_id,
    registerLabel: '', operatorName: cashierName, siteName: currentSite?.name || '',
    userName: cashierName, printTenant: tenantForPrint, methods, customers,
  } : null;
  const [loadingData, setLoadingData] = useState(!hasPosCache);
  const initialLoadDone = useRef(hasPosCache);

  // Session open form
  const [openingAmount, setOpeningAmount] = useState(0);
  const [openingNote, setOpeningNote] = useState('');
  const [openingSubmitting, setOpeningSubmitting] = useState(false);
  const [posCashCtx, setPosCashCtx] = useState<PosCashContext | null>(null);
  const [supervising, setSupervising] = useState(false);
  const [posCashCtxError, setPosCashCtxError] = useState('');
  const [selectedRegisterId, setSelectedRegisterId] = useState<string | null>(null);
  const openIdemRef = useRef<{ key: string; registerId: string | null }>({ key: '', registerId: null });
  const [fundModalOpen, setFundModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Catalog filters
  const [categories, setCategories] = useState<CategoryLite[]>(hasPosCache ? posCache.categories : []);
  const [topScores, setTopScores] = useState<Record<string, number>>(hasPosCache ? posCache.topScores : {});
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
  const [sessionPopOpen, setSessionPopOpen] = useState(false);
  const [desktopDepotOpen, setDesktopDepotOpen] = useState(false);
  const [mobileDepotOpen, setMobileDepotOpen] = useState(false);
  const mobileDepotTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [mobileDepotPos, setMobileDepotPos] = useState<{ top: number; left: number; flip: boolean }>({ top: 0, left: 0, flip: false });
  const [stockSourceLoading, setStockSourceLoading] = useState(false);
  const stockSourceLoadId = useRef(0);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [exceptionPrices, setExceptionPrices] = useState<Map<string, number>>(new Map());
  const [articleTiers, setArticleTiers] = useState<ArticleTier[]>([]);
  const [tierPickerOpen, setTierPickerOpen] = useState(false);
  const [tierPickerArticle, setTierPickerArticle] = useState<ArticleLite | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);

  // Auto-select first cart line for desktop numpad editing
  useEffect(() => {
    if (cart.length > 0 && !cart.some(i => i.article_id === selectedLineId)) {
      setSelectedLineId(cart[0].article_id);
    } else if (cart.length === 0) {
      setSelectedLineId(null);
    }
  }, [cart]); // eslint-disable-line react-hooks/exhaustive-deps

  // Quick-create modals
  const [quickArticleOpen, setQuickArticleOpen] = useState(false);
  const [quickArticleName, setQuickArticleName] = useState('');
  const [quickCustomerOpen, setQuickCustomerOpen] = useState(false);
  const [quickCustomerName, setQuickCustomerName] = useState('');

  // Source site/depot selector for stock deduction
  const [saleSourceSiteId, setSaleSourceSiteId] = useState<string>(currentSite?.id || '');

  // IPM detection (pharmacy only)
  const isPharmacy = (tenant?.business_activity_type_name || '').toLowerCase() === 'pharmacie';
  const [ipmBeneficiaire, setIpmBeneficiaire] = useState<any>(null);
  const [ipmConvention, setIpmConvention] = useState<any>(null);
  const [ipmDocuments, setIpmDocuments] = useState<{ numero_ordonnance: string; medecin: string; numero_bon: string }>({ numero_ordonnance: '', medecin: '', numero_bon: '' });

  useEffect(() => {
    if (!isPharmacy || !customer?.id || !tenant) {
      setIpmBeneficiaire(null); setIpmConvention(null); return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('ipm_beneficiaires')
        .select('*, ipm_organismes(nom), ipm_conventions(nom, taux_defaut, plafond_facture, mode_calcul, mode_arrondi, application_plafond, ordonnance_obligatoire, bon_prise_en_charge_obligatoire, numero_bon_obligatoire, numero_ordonnance_obligatoire, medecin_prescripteur_obligatoire, matricule_obligatoire)')
        .eq('tenant_id', tenant.id)
        .eq('customer_id', customer.id)
        .eq('statut', 'actif')
        .limit(1).maybeSingle();
      if (cancelled) return;
      if (data) { setIpmBeneficiaire(data); setIpmConvention(data.ipm_conventions); }
      else { setIpmBeneficiaire(null); setIpmConvention(null); }
    })();
    return () => { cancelled = true; };
  }, [isPharmacy, customer?.id, tenant?.id]);

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

  // Always reset saleSourceSiteId when currentSite changes & close depot menus
  useEffect(() => {
    if (currentSite) setSaleSourceSiteId(currentSite.id);
    setDesktopDepotOpen(false);
    setMobileDepotOpen(false);
  }, [currentSite?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reposition mobile depot dropdown on scroll/resize/rotation
  useEffect(() => {
    if (!mobileDepotOpen) return;
    const reposition = () => {
      const el = mobileDepotTriggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const menuH = depotAllOptions.length * 34 + 8;
      const spaceBelow = window.innerHeight - r.bottom - 8;
      const flip = spaceBelow < menuH && r.top > spaceBelow;
      setMobileDepotPos({
        top: flip ? Math.max(8, r.top - menuH - 4) : r.bottom + 4,
        left: Math.max(8, Math.min(r.left, window.innerWidth - 184)),
        flip,
      });
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    const vv = window.visualViewport;
    if (vv) { vv.addEventListener('resize', reposition); vv.addEventListener('scroll', reposition); }
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      if (vv) { vv.removeEventListener('resize', reposition); vv.removeEventListener('scroll', reposition); }
    };
  }, [mobileDepotOpen, depotAllOptions.length]);

  // Held carts (mise en attente) — persisted in DB
  const [heldCarts, setHeldCarts] = useState<HeldCart[]>([]);
  const [holdOpen, setHoldOpen] = useState(false);

  // Load held carts from DB when session changes
  useEffect(() => {
    if (!session || !tenant) { setHeldCarts([]); return; }
    (async () => {
      const { data } = await supabase
        .from('held_carts')
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('cash_session_id', session.id)
        .order('created_at');
      if (data) {
        setHeldCarts(data.map((r: any) => ({
          id: r.id,
          label: r.label,
          cart: r.cart_data as CartItem[],
          customer: r.customer_data as Customer | null,
          discount: Number(r.discount),
          savedAt: r.created_at,
        })));
      }
    })();
  }, [session?.id, tenant?.id]);

  // Payment
  const [payOpen, setPayOpen] = useState(false);
  const [payments, setPayments] = useState<SalePayment[]>([]);
  const [paying, setPaying] = useState(false);
  const [lastSale, setLastSale] = useState<{
    sale_number: string; created_at: string; total: number; discount: number;
    items: CartItem[]; payments: SalePayment[]; customer: Customer | null;
  } | null>(null);
  const [printInvoice, setPrintInvoice] = useState(false);
  const [autoPrintTicket, setAutoPrintTicket] = useState(false);
  const [autoPrintInvoice, setAutoPrintInvoice] = useState(false);

  // Load auto-print preferences from profile
  useEffect(() => {
    if (profile?.id) {
      setAutoPrintTicket(!!(profile as any).auto_print_ticket);
      setAutoPrintInvoice(!!(profile as any).auto_print_invoice);
    }
  }, [profile?.id]);

  const updateAutoPrintPref = async (key: 'auto_print_ticket' | 'auto_print_invoice', value: boolean) => {
    if (!profile?.id) return;
    if (key === 'auto_print_ticket') setAutoPrintTicket(value);
    else setAutoPrintInvoice(value);
    try {
      await supabase.from('profiles').update({ [key]: value } as any).eq('id', profile.id);
      // Update local profile state so it persists across reloads
      (profile as any)[key] = value;
    } catch {}
  };

  // Document settings fields for POS payment modal
  type PosDocSettings = { show_delivery_date: boolean; show_reference: boolean; show_warranty: boolean; show_imei: boolean; show_representative: boolean; default_representative: string };
  const [posDocSettings, setPosDocSettings] = useState<PosDocSettings>({ show_delivery_date: false, show_reference: false, show_warranty: false, show_imei: false, show_representative: false, default_representative: '' });
  const [docDeliveryDate, setDocDeliveryDate] = useState('');
  const [docReference, setDocReference] = useState('');
  const [docWarranty, setDocWarranty] = useState('');
  const [docImei, setDocImei] = useState('');
  const [docRepresentative, setDocRepresentative] = useState('');
  const [posReps, setPosReps] = useState<SalesRepresentative[]>([]);
  const [posRepSettings, setPosRepSettings] = useState<RepCommissionSettings>(DEFAULT_REP_SETTINGS);

  useEffect(() => {
    if (!tenant) return;
    supabase.from('document_settings').select('*').eq('tenant_id', tenant.id).eq('doc_type', 'invoice').maybeSingle().then(({ data }) => {
      if (data) {
        setPosDocSettings({
          show_delivery_date: data.show_delivery_date ?? false,
          show_reference: data.show_reference ?? false,
          show_warranty: data.show_warranty ?? false,
          show_imei: data.show_imei ?? false,
          show_representative: data.show_representative ?? false,
          default_representative: data.default_representative ?? '',
        });
      }
    });
    supabase.from('sales_representatives').select('*').eq('tenant_id', tenant.id).eq('status', 'actif').order('code').then(({ data }) => {
      setPosReps((data as SalesRepresentative[]) || []);
    });
    supabase.from('rep_commission_settings').select('enabled, commission_type, commission_base, rate, fixed_amount').eq('tenant_id', tenant.id).maybeSingle().then(({ data }) => {
      if (data) {
        setPosRepSettings({
          enabled: data.enabled === true,
          commission_type: (data.commission_type || 'pct_ca') as any,
          commission_base: (data.commission_base || 'ttc') as any,
          rate: Number(data.rate || 0),
          fixed_amount: Number(data.fixed_amount || 0),
        });
      }
    });
  }, [tenant?.id]);

  const posRepLabel = (id?: string | null) => {
    const r = posReps.find(x => x.id === id);
    return r ? repDisplayName(r) : '';
  };

  // Cash movement (expense / income / customer prepayment)
  const [mvOpen, setMvOpen] = useState(false);

  // Customer payment (encaissement libre)
  const [custPayOpen, setCustPayOpen] = useState(false);

  // Return ticket
  const [returnOpen, setReturnOpen] = useState(false);

  // Session tickets list
  const [ticketsOpen, setTicketsOpen] = useState(false);

  // Close workflow
  const [closeOpen, setCloseOpen] = useState(false);
  const [sitePickerOpen, setSitePickerOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);

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

  // Lot picker for sale
  const [lotPickerOpen, setLotPickerOpen] = useState(false);

  const loadIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!tenant || !currentSite) { setLoadingData(false); return; }
    const thisLoadId = ++loadIdRef.current;
    const stockSiteId = saleSourceSiteId || currentSite.id;
    const thisCacheKey = `${tenant.id}:${currentSite.id}`;
    if (posCache.key !== thisCacheKey || posCache.articles.length === 0) {
      setLoadingData(true);
    }
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const isShared = (tenant as any)?.settings?.shared_articles !== false;
    const isSharedCust = (tenant as any)?.settings?.shared_customers !== false;

    try {
    // Fetch articles, stock and other data ALL in parallel
    const fetchArticlesBatched = async () => {
      let all: any[] = [];
      let from = 0;
      while (true) {
        let q = supabase.from('articles')
          .select('id, internal_ref, name, oem_ref, sale_price, purchase_price, category_id, image_url, ipm_eligible, track_stock')
          .eq('tenant_id', tenant.id).eq('is_active', true)
          .range(from, from + 999);
        if (!isShared && currentSite) q = q.eq('site_id', currentSite.id);
        const { data, error: e } = await q;
        if (e || !data) break;
        all = all.concat(data);
        if (data.length < 1000) break;
        from += 1000;
      }
      return all;
    };
    const fetchStockBatched = async () => {
      let all: any[] = [];
      let from = 0;
      while (true) {
        const { data, error: e } = await supabase.from('stock_levels')
          .select('article_id, quantity')
          .eq('tenant_id', tenant.id).eq('site_id', stockSiteId)
          .range(from, from + 999);
        if (e) { console.error('[POS] stock fetch error', e, { from, siteId: stockSiteId }); break; }
        if (!data) break;
        all = all.concat(data);
        if (data.length < 1000) break;
        from += 1000;
      }
      return all;
    };

    const fetchCustomersBatched = async () => {
      let all: any[] = [];
      let from = 0;
      const seen = new Set<string>();
      while (true) {
        let q = supabase.from('customers')
          .select('id, name, phone, email, address, whatsapp, customer_type, credit_limit, credit_blocked, balance, is_active, tenant_id, site_id')
          .eq('tenant_id', tenant.id).eq('is_active', true)
          .order('name').order('id')
          .range(from, from + 999);
        if (!isSharedCust && currentSite) q = q.or(`site_id.eq.${currentSite.id},site_id.is.null`);
        const { data, error: e } = await q;
        if (e) { console.error('[POS] customers fetch error', e, { from }); break; }
        if (!data) break;
        for (const c of data) { if (!seen.has(c.id)) { seen.add(c.id); all.push(c); } }
        if (data.length < 1000) break;
        from += 1000;
      }
      return all;
    };

    const [allArts, allStk, csResult, allCust, topResult, tiersResult, posCtxResult] = await Promise.all([
      fetchArticlesBatched(),
      fetchStockBatched(),
      supabase.from('cash_sessions').select('id, opening_amount, theoretical_amount, counted_cash, opened_at, status, user_id, site_id, tenant_id').eq('tenant_id', tenant.id).eq('site_id', currentSite.id).eq('status', 'open').order('opened_at', { ascending: false }).limit(1).maybeSingle(),
      fetchCustomersBatched(),
      supabase.from('sale_items').select('article_id, quantity, sales!inner(tenant_id, created_at, status)').eq('tenant_id', tenant.id).gte('sales.created_at', since).neq('sales.status', 'cancelled').limit(5000),
      supabase.from('article_pricing_tiers').select('article_id, tier_name, price').eq('tenant_id', tenant.id).order('sort_order'),
      supabase.rpc('cash_pos_context', { p_site_id: currentSite.id }),
    ]);

    // Abort if a newer load was started
    if (thisLoadId !== loadIdRef.current) return;

    const stk = allStk;
    const cs = csResult.data;
    const cust = allCust;
    const topRows = topResult.data;
    const tiers = tiersResult.data;

    if (process.env.NODE_ENV !== 'production') {
      console.log('[POS] load complete', { articles: allArts.length, stock: stk.length, siteId: stockSiteId, loadId: thisLoadId });
    }

    const qmap = new Map((stk || []).map((r: any) => [r.article_id, Number(r.quantity)]));
    const newArticles = (allArts).map((a: any) => ({
      id: a.id, internal_ref: a.internal_ref, name: a.name, oem_ref: a.oem_ref || '',
      sale_price: Number(a.sale_price), purchase_price: Number(a.purchase_price),
      stock_available: qmap.get(a.id) ?? 0,
      _stockLoaded: true,
      category_id: a.category_id || null,
      image_url: a.image_url || null,
      ipm_eligible: a.ipm_eligible !== false,
      track_stock: a.track_stock !== false,
    }));
    const newMethods = ((refData?.paymentMethods || []).filter((m: any) => m.payment_type !== 'credit')) as PaymentMethod[];
    const newCustomers = (cust || []) as Customer[];
    const newCategories = (refData?.categories || []) as CategoryLite[];
    const scores: Record<string, number> = {};
    for (const r of (topRows || []) as any[]) {
      if (!r.article_id) continue;
      scores[r.article_id] = (scores[r.article_id] || 0) + Number(r.quantity || 0);
    }
    const newTiers = (tiers || []) as ArticleTier[];
    const ctxData = posCtxResult.data as PosCashContext | null;
    const ctxOk = !posCtxResult.error && !!ctxData && typeof ctxData === 'object';
    const multiMode = ctxOk && !!ctxData!.multi_enabled;
    // Mode multi-caisse : uniquement la session personnelle de l'utilisateur, jamais celle d'un collègue.
    const existingSession = !ctxOk ? null : multiMode ? (ctxData!.my_session || null) : (cs || null);
    setPosCashCtx(ctxOk ? ctxData : null);
    setPosCashCtxError(ctxOk ? '' : (posCtxResult.error?.message || 'Impossible de vérifier l’état des caisses'));
    if (multiMode) {
      const usable = (ctxData!.registers || []).filter(r => r.status !== 'busy' && !r.locked);
      setSelectedRegisterId(prev => {
        if (prev && usable.some(r => r.id === prev)) return prev;
        const mine = usable.find(r => r.status === 'mine');
        if (mine) return mine.id;
        if (usable.length === 1) return usable[0].id;
        return usable.find(r => r.is_default)?.id || null;
      });
    }

    setArticles(newArticles);
    setMethods(newMethods);
    setCustomers(newCustomers);
    setCategories(newCategories);
    setTopScores(scores);
    setArticleTiers(newTiers);
    setSession((existingSession) as any);
    // Only update screen if we're not already inside the POS (avoids resetting after a sale)
    setScreen(prev => {
      if (prev === 'pos') return 'pos';
      // Check if caller requested direct POS access (skip resume)
      const ctx = peekNavContext();
      if (ctx?.target === 'directPos' && existingSession) {
        consumeNavContext();
        return 'pos';
      }
      if (multiMode && existingSession) {
        posCache.screen = 'pos';
        return 'pos';
      }
      const newScreen = existingSession ? 'resume' : 'open-form';
      posCache.screen = newScreen;
      return newScreen;
    });
    // Persist to module-level cache
    posCache.key = thisCacheKey;
    posCache.articles = newArticles;
    posCache.customers = newCustomers;
    posCache.methods = newMethods;
    posCache.session = existingSession as any;
    posCache.categories = newCategories;
    posCache.topScores = scores;
    posCache.articleTiers = newTiers;
    posCache.stockSiteId = stockSiteId;
    } catch (err) {
      console.error('[POS] load error', err);
    } finally {
      if (thisLoadId === loadIdRef.current) {
        setLoadingData(false);
        initialLoadDone.current = true;
      }
    }
  }, [tenant?.id, currentSite?.id, saleSourceSiteId]);

  useEffect(() => { load(); }, [load]);

  // Dedicated stock-only fetch for a given site — used by depot selector
  const fetchStockForSite = useCallback(async (siteId: string) => {
    if (!tenant) return null;
    let all: any[] = [];
    let from = 0;
    while (true) {
      const { data, error: e } = await supabase.from('stock_levels')
        .select('article_id, quantity')
        .eq('tenant_id', tenant.id).eq('site_id', siteId)
        .range(from, from + 999);
      if (e || !data) return null;
      all = all.concat(data);
      if (data.length < 1000) break;
      from += 1000;
    }
    return all;
  }, [tenant?.id]);

  const handleStockSourceChange = useCallback(async (nextSiteId: string) => {
    if (!tenant || !currentSite || nextSiteId === saleSourceSiteId) return;
    setDesktopDepotOpen(false);
    setMobileDepotOpen(false);
    setStockSourceLoading(true);
    const thisId = ++stockSourceLoadId.current;
    try {
      const stk = await fetchStockForSite(nextSiteId);
      if (thisId !== stockSourceLoadId.current) return;
      if (!stk) { error('Impossible de charger le stock de ce dépôt'); return; }
      const qmap = new Map(stk.map((r: any) => [r.article_id, Number(r.quantity)]));
      setSaleSourceSiteId(nextSiteId);
      setArticles(prev => prev.map(a => ({
        ...a,
        stock_available: qmap.get(a.id) ?? 0,
        _stockLoaded: true,
      })));
      posCache.articles = posCache.articles.map(a => ({
        ...a,
        stock_available: qmap.get(a.id) ?? 0,
        _stockLoaded: true,
      }));
      posCache.stockSiteId = nextSiteId;
      setCart(prev => prev.map(item => ({
        ...item,
        stock_available: qmap.get(item.article_id) ?? 0,
      })));
    } catch {
      if (thisId === stockSourceLoadId.current) error('Erreur lors du chargement du stock');
    } finally {
      if (thisId === stockSourceLoadId.current) setStockSourceLoading(false);
    }
  }, [tenant?.id, currentSite?.id, saleSourceSiteId, fetchStockForSite, error]);

  // Realtime: silently refresh stock + articles when another user makes changes (NOT customers)
  useEffect(() => {
    if (!tenant || !currentSite) return;
    const stockSiteId = saleSourceSiteId || currentSite.id;
    const isShared = (tenant as any)?.settings?.shared_articles !== false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const unsub = onDataChange(
      ['articles', 'stock_levels'],
      () => {
        if (!initialLoadDone.current) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(async () => {
          const fetchStk = async () => {
            let all: any[] = [];
            let f = 0;
            while (true) {
              const { data, error: e } = await supabase.from('stock_levels').select('article_id, quantity').eq('tenant_id', tenant.id).eq('site_id', stockSiteId).range(f, f + 999);
              if (e || !data) break;
              all = all.concat(data);
              if (data.length < 1000) break;
              f += 1000;
            }
            return all;
          };
          const fetchArts = async () => {
            let all: any[] = [];
            let from = 0;
            while (true) {
              let q = supabase.from('articles').select('id, internal_ref, name, oem_ref, sale_price, purchase_price, category_id, image_url, ipm_eligible, track_stock').eq('tenant_id', tenant.id).eq('is_active', true).range(from, from + 999);
              if (!isShared) q = q.eq('site_id', currentSite.id);
              const { data, error: e } = await q;
              if (e || !data) break;
              all = all.concat(data);
              if (data.length < 1000) break;
              from += 1000;
            }
            return all;
          };
          const [stk, newArts] = await Promise.all([fetchStk(), fetchArts()]);
          if (stk && newArts && newArts.length > 0) {
            const qmap = new Map(stk.map((r: any) => [r.article_id, Number(r.quantity)]));
            const updatedArticles = newArts.map((a: any) => ({
              id: a.id, internal_ref: a.internal_ref, name: a.name, oem_ref: a.oem_ref || '',
              sale_price: Number(a.sale_price), purchase_price: Number(a.purchase_price),
              stock_available: qmap.get(a.id) ?? 0,
              _stockLoaded: true,
              category_id: a.category_id || null,
              image_url: a.image_url || null,
              ipm_eligible: a.ipm_eligible !== false,
              track_stock: a.track_stock !== false,
            }));
            setArticles(updatedArticles);
            posCache.articles = updatedArticles;
          } else if (stk && stk.length > 0) {
            const qmap = new Map(stk.map((r: any) => [r.article_id, Number(r.quantity)]));
            setArticles(prev => prev.map(a => ({ ...a, stock_available: qmap.get(a.id) ?? 0, _stockLoaded: true })));
          }
        }, 600);
      }
    );
    return () => { unsub(); if (timer) clearTimeout(timer); };
  }, [tenant?.id, currentSite?.id, saleSourceSiteId, onDataChange]);

  // Realtime: refresh customers only when customer data changes
  useEffect(() => {
    if (!tenant || !currentSite) return;
    const isSharedCust = (tenant as any)?.settings?.shared_customers !== false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const unsub = onDataChange(
      ['customers'],
      () => {
        if (!initialLoadDone.current) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(async () => {
          let all: any[] = [];
          let from = 0;
          const seen = new Set<string>();
          let failed = false;
          while (true) {
            let q = supabase.from('customers')
              .select('id, name, phone, email, address, whatsapp, customer_type, credit_limit, credit_blocked, balance, is_active, tenant_id, site_id')
              .eq('tenant_id', tenant.id).eq('is_active', true)
              .order('name').order('id')
              .range(from, from + 999);
            if (!isSharedCust && currentSite) q = q.or(`site_id.eq.${currentSite.id},site_id.is.null`);
            const { data, error: e } = await q;
            if (e) { console.error('[POS] realtime customers fetch error', e, { from }); failed = true; break; }
            if (!data) break;
            for (const c of data) { if (!seen.has(c.id)) { seen.add(c.id); all.push(c); } }
            if (data.length < 1000) break;
            from += 1000;
          }
          if (!failed && all.length > 0) {
            const cust = all as Customer[];
            setCustomers(cust);
            posCache.customers = cust;
          }
        }, 600);
      }
    );
    return () => { unsub(); if (timer) clearTimeout(timer); };
  }, [tenant?.id, currentSite?.id, onDataChange]);

  // Force-skip resume screen when coming from Dashboard "Ventes" button
  useEffect(() => {
    if (session && screen === 'resume') {
      const ctx = peekNavContext();
      if (ctx?.target === 'directPos') {
        consumeNavContext();
        setScreen('pos');
      }
    }
    // Handle quick-action targets on mount
    const ctx = peekNavContext();
    if (!ctx?.target) return;
    if (ctx.target === 'openCashSession') { consumeNavContext(); setScreen('open-form'); }
    else if (ctx.target === 'cashMovement' || ctx.target === 'newExpense') {
      consumeNavContext();
      if (session) { setScreen('pos'); }
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

  const tracksStock = (a: ArticleLite) => a.track_stock !== false;

  const addToCart = (a: ArticleLite) => {
    if (stockSourceLoading) return;
    const allowNeg = !!(currentSite as any)?.allow_negative_stock;
    // If already in cart, just increment qty
    const existing = cart.find(i => i.article_id === a.id);
    if (existing) {
      if (!allowNeg && tracksStock(a) && a._stockLoaded && existing.quantity + 1 > a.stock_available) { error(`Stock insuffisant (${a.stock_available})`); return; }
      setCart(c => c.map(i => i.article_id === a.id ? { ...i, quantity: i.quantity + 1 } : i));
      return;
    }
    if (!allowNeg && tracksStock(a) && a._stockLoaded && a.stock_available <= 0) { error('Article en rupture'); return; }

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
      tier_name: tierName, ipm_eligible: a.ipm_eligible,
    }]);
  };

  const addToCartWithTier = (a: ArticleLite, tierName: string, tierPrice: number) => {
    const price = exceptionPrices.get(a.id) ?? tierPrice;
    setCart(c => [...c, {
      article_id: a.id, name: a.name, internal_ref: a.internal_ref, oem_ref: a.oem_ref,
      quantity: 1, unit_price: price, discount: 0,
      stock_available: a.stock_available, purchase_cost: a.purchase_price,
      tier_name: tierName, ipm_eligible: a.ipm_eligible,
    }]);
    setTierPickerOpen(false);
    setTierPickerArticle(null);
  };

  const updateQty = (id: string, delta: number) => {
    const allowNeg = !!(currentSite as any)?.allow_negative_stock;
    const art = articles.find(a => a.id === id);
    const tracked = art ? tracksStock(art) : true;
    setCart(c => c.flatMap(i => {
      if (i.article_id !== id) return [i];
      const q = i.quantity + delta;
      if (q <= 0) return [];
      if (!allowNeg && tracked && q > i.stock_available) { error(`Stock insuffisant (${i.stock_available})`); return [i]; }
      return [{ ...i, quantity: q }];
    }));
  };

  const setQty = (id: string, raw: string) => {
    const n = raw === '' ? 0 : Number(raw);
    if (isNaN(n)) return;
    const allowNeg = !!(currentSite as any)?.allow_negative_stock;
    const art = articles.find(a => a.id === id);
    const tracked = art ? tracksStock(art) : true;
    const val = (allowNeg || !tracked) ? n : Math.min(n, (cart.find(i => i.article_id === id)?.stock_available ?? n));
    setCart(c => c.map(i => i.article_id === id ? { ...i, quantity: val } : i));
  };

  const finalizeQty = (id: string) => {
    setCart(c => c.map(i => i.article_id === id ? { ...i, quantity: Math.max(1, i.quantity) } : i));
  };

  const setPrice = (id: string, raw: string) => {
    const n = raw === '' ? 0 : Number(raw);
    if (isNaN(n)) return;
    setCart(c => c.map(i => i.article_id === id ? { ...i, unit_price: n } : i));
  };

  const finalizePrice = (id: string) => {
    setCart(c => c.map(i => i.article_id === id ? { ...i, unit_price: Math.max(0, i.unit_price) } : i));
  };

  const removeLine = (id: string) => setCart(c => c.filter(i => i.article_id !== id));

  const commitNumpad = (field: NumpadField, value: number) => {
    if (!selectedLineId) return;
    const allowNeg = !!(currentSite as any)?.allow_negative_stock;
    if (field === 'qty') {
      const item = cart.find(i => i.article_id === selectedLineId);
      if (!allowNeg && item && tracksStock(articles.find(a => a.id === selectedLineId)!) && value > (item.stock_available ?? value)) {
        error(`Stock insuffisant (${item.stock_available})`);
        return;
      }
      setCart(c => c.map(i => i.article_id === selectedLineId ? { ...i, quantity: Math.max(1, value) } : i));
    } else if (field === 'price') {
      setCart(c => c.map(i => i.article_id === selectedLineId ? { ...i, unit_price: Math.max(0, value) } : i));
    } else if (field === 'discount') {
      setCart(c => c.map(i => i.article_id === selectedLineId ? { ...i, discount: Math.max(0, value) } : i));
    }
  };

  const subtotal = cart.reduce((s, i) => s + i.quantity * i.unit_price - (i.discount || 0), 0);
  const total = Math.max(0, subtotal - discount);
  const ipmConfig = parseConvention(ipmConvention);
  const ipmTaux = ipmConfig?.taux_defaut || 0;
  const ipmModeCalcul = ipmConfig?.mode_calcul || 'total_facture';
  const ipmResult = ipmBeneficiaire && ipmConfig ? (() => {
    const lignes: IpmArticleLine[] = cart.map(i => ({
      montant_ligne: i.quantity * i.unit_price - (i.discount || 0),
      ipm_eligible: i.ipm_eligible !== false,
    }));
    return calculerIpm(ipmConfig, lignes, discount);
  })() : null;
  const ipmPartIpm = ipmResult?.part_ipm || 0;
  const ipmPartClient = ipmBeneficiaire ? total - ipmPartIpm : total;
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = ipmPartClient - totalPaid;

  // ─── Hold cart ────────────────────────────────────────────────────────────

  const holdCart = async () => {
    if (cart.length === 0) { error('Panier vide, rien à mettre en attente'); return; }
    if (!session || !tenant) return;
    const label = customer ? customer.name : `Ticket #${heldCarts.length + 1}`;
    const { data, error: err } = await supabase.from('held_carts').insert({
      tenant_id: tenant.id,
      cash_session_id: session.id,
      site_id: currentSite?.id || null,
      user_id: profile?.id || null,
      label,
      cart_data: cart,
      customer_data: customer,
      discount,
    }).select('id, created_at').single();
    if (err) { error('Erreur lors de la mise en attente'); return; }
    const held: HeldCart = { id: data.id, label, cart: [...cart], customer, discount, savedAt: data.created_at };
    setHeldCarts(h => [...h, held]);
    setCart([]); setDiscount(0); setCustomer(null);
    success('Ticket mis en attente');
  };

  const resumeHeld = async (h: HeldCart) => {
    if (cart.length > 0 && !confirm('Remplacer le panier actuel par ce ticket en attente ?')) return;
    setCart(h.cart); setCustomer(h.customer); setDiscount(h.discount);
    setHeldCarts(held => held.filter(x => x.id !== h.id));
    setHoldOpen(false);
    await supabase.from('held_carts').delete().eq('id', h.id);
  };

  const deleteHeld = async (id: string) => {
    setHeldCarts(h => h.filter(x => x.id !== id));
    await supabase.from('held_carts').delete().eq('id', id);
  };

  // ─── Session open ─────────────────────────────────────────────────────────

  const refreshPosCashCtx = async () => {
    if (!currentSite) return;
    const { data, error: e } = await supabase.rpc('cash_pos_context', { p_site_id: currentSite.id });
    if (e || !data || typeof data !== 'object') { setPosCashCtxError(e?.message || 'Impossible de vérifier l’état des caisses'); return; }
    setPosCashCtx(data as PosCashContext);
    setPosCashCtxError('');
  };

  const openSessionSubmit = async () => {
    if (!tenant || !currentSite || !profile) return;
    if (!can('pos_open_session')) { error('Vous n\'avez pas la permission d\'ouvrir une session'); return; }
    if (posCashCtxError) { error(posCashCtxError); return; }
    if (posCashCtx?.multi_enabled) {
      if (!selectedRegisterId) { error('Choisissez une caisse avant de l’ouvrir'); return; }
      if (!openIdemRef.current.key || openIdemRef.current.registerId !== selectedRegisterId) {
        openIdemRef.current = { key: newIdempotencyKey(), registerId: selectedRegisterId };
      }
      setOpeningSubmitting(true);
      const { data, error: e } = await supabase.rpc('cash_session_open', {
        p_cash_register_id: selectedRegisterId,
        p_opening_amount: openingAmount,
        p_opening_note: openingNote,
        p_idempotency_key: openIdemRef.current.key,
      });
      setOpeningSubmitting(false);
      if (e || !data || typeof (data as any).id !== 'string') {
        error(e?.message || 'Ouverture de la caisse impossible');
        openIdemRef.current = { key: '', registerId: null };
        refreshPosCashCtx();
        return;
      }
      openIdemRef.current = { key: '', registerId: null };
      setSession(data as any); setScreen('pos'); setFundModalOpen(false);
      success((data as any).reused ? 'Votre session a été reprise' : 'Caisse ouverte');
      refreshPosCashCtx();
      return;
    }
    setOpeningSubmitting(true);
    const { data: existing } = await supabase.from('cash_sessions').select('id, opening_amount, opened_at').eq('tenant_id', tenant.id).eq('site_id', currentSite.id).eq('status', 'open').order('opened_at', { ascending: false }).limit(1);
    if (existing && existing.length > 0) {
      setSession(existing[0]); setScreen('pos'); success('Session existante récupérée');
      setOpeningSubmitting(false);
      return;
    }
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
    // Pre-select Espèces (cash) as the default payment method
    const cashMethod = methods.find(m => /esp[èe]ces|cash|espèces/i.test(m.name) || m.code?.toLowerCase() === 'cash') || methods[0] || null;
    setPayments(cashMethod ? [{ payment_method_id: cashMethod.id, method_name: cashMethod.name, amount: Math.max(0, total), reference: '' }] : []);
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
    const creditSaleId = (data as any)?.sale_id || (data as any)?.id || null;
    if (creditSaleId && (docDeliveryDate || docReference || docWarranty || docRepresentative || docImei)) {
      const docHeader: Record<string, string | null> = {};
      if (docDeliveryDate) docHeader.delivery_date = docDeliveryDate;
      if (docReference) docHeader.reference = docReference;
      if (docWarranty) docHeader.warranty = docWarranty;
      if (docImei) docHeader.imei = docImei;
      if (docRepresentative) docHeader.representative = posRepLabel(docRepresentative) || docRepresentative;
      supabase.from('sales').update({ doc_header: docHeader }).eq('id', creditSaleId).then(() => {});
    }
    if (creditSaleId && docRepresentative) {
      const rep = posReps.find(r => r.id === docRepresentative) || null;
      if (rep) {
        const subtotal = cart.reduce((s, i) => s + i.quantity * i.unit_price - (i.discount || 0), 0);
        const net = Math.max(0, subtotal - (discount || 0));
        const margin = cart.reduce((s, i) => s + (i.unit_price - (i.purchase_cost || 0)) * i.quantity - (i.discount || 0), 0);
        const snapshot = computeRepCommission(rep, posRepSettings, { subtotal, net, margin });
        supabase.from('sales').update({ representative_id: rep.id, rep_commission: snapshot }).eq('id', creditSaleId).then(() => {});
      }
    }
    // Create IPM vente record if client is IPM beneficiary
    if (ipmBeneficiaire && ipmPartIpm > 0 && creditSaleId && tenant) {
      await supabase.from('ipm_ventes').insert({
        tenant_id: tenant.id,
        organisme_id: ipmBeneficiaire.organisme_id,
        beneficiaire_id: ipmBeneficiaire.id,
        convention_id: ipmBeneficiaire.convention_id || null,
        sale_id: creditSaleId,
        date_vente: new Date().toISOString().slice(0, 10),
        part_ipm: ipmPartIpm,
        part_client: ipmPartClient,
        montant_total: total,
        part_beneficiaire_payee: 0,
        statut: 'en_attente',
        numero_ordonnance: ipmDocuments.numero_ordonnance || null,
        medecin_prescripteur: ipmDocuments.medecin || null,
        numero_bon_pec: ipmDocuments.numero_bon || null,
      });
    }
    setLastSale({
      sale_number: saleNum, created_at: new Date().toISOString(),
      total, discount, items: [...cart], payments: [], customer,
    });
    setPrintInvoice(false);
    success('Vente à crédit enregistrée');
    setCart([]); setDiscount(0); setCustomer(null); setPayments([]); setPayOpen(false); setMobileCartOpen(false);
    setDocDeliveryDate(''); setDocReference(''); setDocWarranty(''); setDocImei(''); setDocRepresentative('');
    load();
  };

  // ─── Customer payment (encaissement libre) ────────────────────────────────

  const openCustomerPayment = () => {
    if (!session) { error('Ouvrez d\'abord la caisse'); return; }
    setCustPayOpen(true);
  };

  const openMovement = () => {
    if (!session) { error('Ouvrez d\'abord la caisse'); return; }
    setMvOpen(true);
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const target = (e as CustomEvent).detail?.target;
      if (target === 'directPos' && session) setScreen('pos');
      else if (target === 'openCashSession') setScreen('open-form');
      else if ((target === 'cashMovement' || target === 'newExpense') && session) {
        setScreen('pos');
        openMovement();
      }
    };
    window.addEventListener('waarwi:quickaction', handler);
    return () => window.removeEventListener('waarwi:quickaction', handler);
  }, [session]);


  const validateSale = async () => {
    if (!session || !currentSite || !tenant) return;
    if (discount > 0 && !can('apply_discounts')) { error('Vous n\'avez pas la permission d\'appliquer des remises'); return; }
    if (totalPaid < ipmPartClient && !customer) { error('Sélectionnez un client pour un paiement partiel'); return; }

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
    if (saleId && (docDeliveryDate || docReference || docWarranty || docRepresentative || docImei)) {
      const docHeader: Record<string, string | null> = {};
      if (docDeliveryDate) docHeader.delivery_date = docDeliveryDate;
      if (docReference) docHeader.reference = docReference;
      if (docWarranty) docHeader.warranty = docWarranty;
      if (docImei) docHeader.imei = docImei;
      if (docRepresentative) docHeader.representative = posRepLabel(docRepresentative) || docRepresentative;
      supabase.from('sales').update({ doc_header: docHeader }).eq('id', saleId).then(() => {});
    }

    // Representative + commission snapshot (computed at validation only)
    if (saleId && docRepresentative) {
      const rep = posReps.find(r => r.id === docRepresentative) || null;
      if (rep) {
        const subtotal = cart.reduce((s, i) => s + i.quantity * i.unit_price - (i.discount || 0), 0);
        const net = Math.max(0, subtotal - (discount || 0));
        const margin = cart.reduce((s, i) => s + (i.unit_price - (i.purchase_cost || 0)) * i.quantity - (i.discount || 0), 0);
        const snapshot = computeRepCommission(rep, posRepSettings, { subtotal, net, margin });
        supabase.from('sales').update({ representative_id: rep.id, rep_commission: snapshot }).eq('id', saleId).then(() => {});
      }
    }

    const completedSale = {
      sale_number: saleNum, created_at: new Date().toISOString(),
      total, discount, items: [...cart], payments: [...payments], customer,
    };
    setLastSale(completedSale);
    setPrintInvoice(false);
    // Auto-print if enabled
    if (autoPrintTicket) {
      try { printSaleTicket(completedSale); } catch {}
    }
    if (autoPrintInvoice) {
      try { printSaleInvoice(completedSale); } catch {}
    }
    // Link to web order if this sale originated from one
    const pendingWeb = (window as any).__pendingWebOrderId as string | undefined;
    if (pendingWeb && tenant && saleId) {
      await supabase.from('online_orders').update({
        status: 'livree', payment_status: 'paye', sale_id: saleId,
      }).eq('id', pendingWeb).eq('tenant_id', tenant.id);
      await supabase.rpc('log_online_order_status', {
        p_order_id: pendingWeb, p_old_status: 'prete', p_new_status: 'livree', p_note: `Transformée en vente ${saleNum}`,
      }).then(() => {}, () => {});
      (window as any).__pendingWebOrderId = undefined;
    }

    // Create IPM vente record if client is IPM beneficiary
    if (ipmBeneficiaire && ipmPartIpm > 0 && saleId && tenant) {
      await supabase.from('ipm_ventes').insert({
        tenant_id: tenant.id,
        organisme_id: ipmBeneficiaire.organisme_id,
        beneficiaire_id: ipmBeneficiaire.id,
        convention_id: ipmBeneficiaire.convention_id || null,
        sale_id: saleId,
        date_vente: new Date().toISOString().slice(0, 10),
        part_ipm: ipmPartIpm,
        part_client: ipmPartClient,
        montant_total: total,
        part_beneficiaire_payee: Math.min(totalPaid, ipmPartClient),
        statut: 'en_attente',
        numero_ordonnance: ipmDocuments.numero_ordonnance || null,
        medecin_prescripteur: ipmDocuments.medecin || null,
        numero_bon_pec: ipmDocuments.numero_bon || null,
      });
      // Update sale: mark as paid if client paid their part, include IPM coverage in paid amount
      if (totalPaid >= ipmPartClient) {
        await supabase.from('sales').update({ status: 'paid', paid: totalPaid + ipmPartIpm }).eq('id', saleId);
      }
    }
    success(`Vente enregistrée${ipmBeneficiaire && ipmPartIpm > 0 ? ` · IPM: ${ipmBeneficiaire.ipm_organismes?.nom}` : ''}`);
    setCart([]); setDiscount(0); setCustomer(null); setPayments([]); setPayOpen(false); setMobileCartOpen(false);
    setDocDeliveryDate(''); setDocReference(''); setDocWarranty(''); setDocRepresentative('');
    setIpmDocuments({ numero_ordonnance: '', medecin: '', numero_bon: '' });
    load();
  };

  // ─── Return ticket ────────────────────────────────────────────────────────

  const openReturn = () => {
    if (!session) return;
    if (!can('pos_returns')) { error('Vous n\'avez pas la permission d\'effectuer des retours'); return; }
    setReturnOpen(true);
  };

  // ─── Session tickets ──────────────────────────────────────────────────────

  const openTickets = () => {
    if (!session) return;
    setTicketsOpen(true);
  };

  // ─── Web orders ───────────────────────────────────────────────────────────

  const loadWebOrders = useCallback(async () => {
    if (!tenant) return;
    setWebOrdersLoading(true);
    const webStoreId = currentSite ? (currentSite.is_warehouse ? currentSite.parent_site_id || null : currentSite.id) : null;
    let q = supabase
      .from('online_orders')
      .select('id, order_number, status, payment_status, delivery_mode, delivery_address, payment_mode, customer_name, customer_phone, customer_whatsapp, customer_note, subtotal, delivery_fee, total, created_at, sale_id')
      .eq('tenant_id', tenant.id)
      .in('status', ['nouvelle', 'confirmee', 'en_preparation', 'prete', 'livree']);
    if (webStoreId) q = q.eq('site_id', webStoreId);
    const { data } = await q.order('created_at', { ascending: false }).limit(200);
    setWebOrders((data || []) as WebOrder[]);
    setWebOrdersLoading(false);
  }, [tenant, currentSite]);

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
      const allowNeg = !!(currentSite as any)?.allow_negative_stock;
      if (!allowNeg && tracksStock(a) && a.stock_available < it.quantity) {
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
    }).then(() => {}, () => {});
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
    }).then(() => {}, () => {});
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

  const openStats = () => {
    if (!session || !tenant) return;
    setStatsOpen(true);
  };

  // ─── Close workflow ──────────────────────────────

  const openCloseWorkflow = () => {
    if (!session || !tenant) return;
    if (!can('pos_close_session')) { error('Vous n\'avez pas la permission de cloturer la session'); return; }
    if (heldCarts.length > 0) {
      error(`Impossible de clôturer : ${heldCarts.length} ticket${heldCarts.length > 1 ? 's' : ''} en attente. Validez ou annulez-les d'abord.`);
      return;
    }
    setCloseOpen(true);
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loadingData) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>;
  }

  if (!currentSite) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="w-12 h-12 rounded-md bg-neutral-100 flex items-center justify-center mx-auto mb-3">
            <MapPin className="w-6 h-6 text-neutral-400" />
          </div>
          <h2 className="text-sm font-bold text-neutral-900 mb-1">Aucun point de vente</h2>
          <p className="text-xs text-neutral-500">Aucun point de vente n'est configuré pour votre compte. Contactez un administrateur pour qu'il vous en assigne un.</p>
        </div>
      </div>
    );
  }

  // Screen: open form (no active session) — minimal full-screen view
  const multiCash = !!posCashCtx?.multi_enabled;
  const multiRegisters = posCashCtx?.registers || [];
  const multiNotice = posCashCtxError
    || (multiCash && posCashCtx?.can_open === false ? 'Vous n’avez pas l’autorisation d’ouvrir une caisse. Contactez votre administrateur.' : '');
  const canSupervise = multiCash && !!posCashCtx?.is_elevated;
  const registerSlot = (multiCash || posCashCtxError) ? (
    <>
      <PosRegisterPicker
        registers={multiRegisters}
        selectedId={selectedRegisterId}
        onSelect={setSelectedRegisterId}
        otherSession={posCashCtx?.other_session || null}
        notice={multiNotice}
      />
      {canSupervise && (
        <button type="button" onClick={() => setSupervising(true)} className="w-full mt-2 inline-flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-neutral-700 hover:text-black hover:underline underline-offset-4 transition-colors">
          <Eye className="w-3.5 h-3.5" />Superviser une caisse
        </button>
      )}
    </>
  ) : undefined;
  if (supervising && tenant) {
    return <CashSupervision tenantId={tenant.id} methods={methods} customers={customers}
      onExit={() => { setSupervising(false); load(); }} />;
  }
  const openDisabled = !!posCashCtxError || (multiCash && (
    !!multiNotice || !!posCashCtx?.other_session || !selectedRegisterId
    || multiRegisters.find(r => r.id === selectedRegisterId)?.status === 'busy'
    || !!multiRegisters.find(r => r.id === selectedRegisterId)?.locked
  ));
  if (screen === 'open-form' && !menuOpen) {
    return <POSLandingOpenMinimal
      tenantName={currentSite?.logo_url ? currentSite.name : tenant?.name}
      tenantLogo={currentSite?.logo_url || tenant?.logo_url}
      fundModalOpen={fundModalOpen}
      setFundModalOpen={setFundModalOpen}
      openingAmount={openingAmount}
      setOpeningAmount={setOpeningAmount}
      openingSubmitting={openingSubmitting}
      openSessionSubmit={openSessionSubmit}
      siteName={currentSite?.name}
      cashierName={cashierName}
      onMenu={() => setMenuOpen(true)}
      registerSlot={registerSlot}
      openDisabled={openDisabled}
    />;
  }

  // Screen: open form — inline (after Menu click, sidebar visible)
  if (screen === 'open-form' && menuOpen) {
    return (
      <div className="flex-1 overflow-y-auto lg:overflow-y-auto">
        <div className="w-full max-w-[1600px] mx-auto px-1.5 sm:px-5 lg:px-8 pt-2 sm:pt-4 lg:pt-6 pb-2 lg:pb-8">
          <POSLandingOpenInline
            tenantName={currentSite?.logo_url ? currentSite.name : tenant?.name}
            tenantLogo={currentSite?.logo_url || tenant?.logo_url}
            fundModalOpen={fundModalOpen}
            setFundModalOpen={setFundModalOpen}
            openingAmount={openingAmount}
            setOpeningAmount={setOpeningAmount}
            openingSubmitting={openingSubmitting}
            openSessionSubmit={openSessionSubmit}
            siteName={currentSite?.name}
            cashierName={cashierName}
            onBack={() => setMenuOpen(false)}
            registerSlot={registerSlot}
            openDisabled={openDisabled}
          />
        </div>
      </div>
    );
  }

  // Screen: resume (active session found — opened by someone else or after "Quitter")
  const isResumeScreen = screen === 'resume' && !!session;

  const selectedLine = cart.find(i => i.article_id === selectedLineId) || null;

  // ─── Main POS screen ──────────────────────────────────────────────────────

  const CartPanel = (
    <div className="flex flex-col h-full bg-[var(--w-surface)]">
      {/* Header — single compact line: Panier | count | customer | add | held | clear */}
      <div className="px-3 py-1.5 border-b border-[var(--w-separator)] bg-[var(--w-surface)]">
        <div className="flex items-center gap-1.5">
          <div className="flex-1 min-w-0 [&>div>button]:rounded-none [&>div>button]:border-0 [&>div>button]:py-1.5 [&>div>button]:px-0 [&>div>button]:text-xs [&>div>button]:shadow-none [&>div>button]:h-8 [&>div>button]:justify-start">
            <SearchableSelect
              options={[{ value: '', label: 'Client comptoir' }, ...customers.map(c => ({ value: c.id, label: c.name, sublabel: (c as any).phone || undefined }))]}
              value={customer?.id || ''}
              onChange={v => setCustomer(customers.find(c => c.id === v) || null)}
              placeholder="Client comptoir"
              maxResults={50}
            />
          </div>
          <button onClick={() => { setQuickCustomerName(''); setQuickCustomerOpen(true); }} className="shrink-0 p-1.5 rounded-md text-neutral-900 hover:bg-[var(--w-hover)] transition-all active:scale-95" title="Créer un client">
            <UserPlus className="w-3.5 h-3.5" />
          </button>
          {heldCarts.length > 0 && (
            <button onClick={() => setHoldOpen(true)} className="relative shrink-0 p-1.5 rounded-md hover:bg-amber-50 text-amber-600 transition-colors" title="Tickets en attente">
              <List className="w-3.5 h-3.5" />
              <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 text-[9px] rounded-full bg-amber-500 text-white flex items-center justify-center font-bold">{heldCarts.length}</span>
            </button>
          )}
          {cart.length > 0 && (
            <button onClick={() => setCart([])} className="shrink-0 p-1.5 rounded-md hover:bg-red-50 text-red-400 transition-colors" title="Vider">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
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
          <div className="flex flex-col items-center justify-center h-full gap-2 text-neutral-400 p-6">
            <ShoppingCart className="w-8 h-8 opacity-30" />
            <p className="text-xs font-medium text-neutral-400">Panier vide</p>
            {heldCarts.length > 0 && (
              <button onClick={() => setHoldOpen(true)} className="mt-1 chip text-amber-700 bg-amber-50 border-amber-200 hover:bg-amber-100 text-[11px]">
                <List className="w-3 h-3" />
                {heldCarts.length} ticket{heldCarts.length > 1 ? 's' : ''} en attente
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {cart.map(i => (
              <div key={i.article_id} onClick={() => setSelectedLineId(i.article_id)} className={`group px-3 py-1.5 cursor-pointer transition-colors ${selectedLineId === i.article_id ? 'bg-[var(--w-active)] border-l-2 border-l-brand-600' : 'hover:bg-neutral-50 border-l-2 border-l-transparent'}`}>
                <div className="flex items-start justify-between gap-1">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-semibold text-neutral-900 leading-snug">{i.name}</div>
                    {i.tier_name && <div className="text-[9px] font-medium text-brand-600 leading-tight">{i.tier_name}</div>}
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); removeLine(i.article_id); }} className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-50 text-red-400 transition-all shrink-0 mt-0.5">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <input type="number" value={i.quantity || ''} onChange={e => setQty(i.article_id, e.target.value)} onBlur={() => finalizeQty(i.article_id)} onClick={e => e.stopPropagation()} className="w-12 bg-transparent border-b border-neutral-200 focus:border-neutral-900 text-[10px] text-center font-bold num outline-none pb-0.5 shrink-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" title="Quantité" />
                  <span className="text-[10px] text-neutral-400">x</span>
                  <input type="number" value={i.unit_price || ''} onChange={e => setPrice(i.article_id, e.target.value)} onBlur={() => finalizePrice(i.article_id)} onClick={e => e.stopPropagation()} className="w-16 bg-transparent border-b border-neutral-200 focus:border-neutral-900 text-[10px] text-right num outline-none pb-0.5 shrink-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" title="Prix unitaire" />
                  <span className="text-[10px] text-neutral-400">=</span>
                  <div className="text-[11px] font-bold text-neutral-900 num whitespace-nowrap ml-auto">{formatFCFA(i.quantity * i.unit_price - i.discount)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer totals + pay button — MOBILE (unchanged) */}
      <div className="lg:hidden border-t border-[var(--w-separator)] px-3 pt-2 pb-3 bg-[var(--w-surface)] pb-safe space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-neutral-500">Panier {cart.length} ligne{cart.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-neutral-500">Sous-total</span>
          <span className="font-semibold text-neutral-800 num">{formatFCFA(subtotal)}</span>
        </div>
        {can('apply_discounts') && (
          <div className="flex items-center justify-between text-[11px] gap-2">
            <span className="text-neutral-500 shrink-0">Remise</span>
            <input type="number" value={discount || ''} onChange={e => setDiscount(Math.max(0, Number(e.target.value)))} className="bg-transparent border-b border-neutral-200 focus:border-neutral-900 text-[11px] text-right num w-24 outline-none pb-0.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" placeholder="0" />
          </div>
        )}
        {ipmBeneficiaire && total > 0 && (
          <div className="px-2 py-1.5 bg-neutral-100 border border-neutral-200 rounded-lg text-[10px] space-y-1">
            <div className="flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-neutral-700 shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="font-bold text-neutral-900">IPM {ipmBeneficiaire.ipm_organismes?.nom}</span>
                <span className="text-neutral-700 ml-1">({ipmTaux}%{ipmModeCalcul === 'articles_eligibles' ? ' sur articles eligibles' : ipmModeCalcul === 'ligne_par_ligne' ? ' ligne/ligne' : ''})</span>
              </div>
              <div className="text-right shrink-0 leading-tight">
                <div className="text-neutral-700">IPM: <span className="font-bold">{formatFCFA(ipmPartIpm)}</span></div>
                <div className="text-neutral-900 font-bold">Client: {formatFCFA(ipmPartClient)}</div>
              </div>
            </div>
            {ipmModeCalcul === 'articles_eligibles' && cart.some(i => i.ipm_eligible === false) && (
              <div className="text-[9px] text-amber-700 bg-amber-50 px-2 py-1 rounded">
                {cart.filter(i => i.ipm_eligible === false).length} article(s) non eligible(s) IPM, exclu(s) du calcul
              </div>
            )}
          </div>
        )}
        <div className="flex items-center justify-between pt-1.5 border-t border-neutral-200">
          <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Total</span>
          <div className="text-2xl font-bold text-neutral-900 num leading-none">{formatFCFA(total)}</div>
        </div>
        <button onClick={openPayment} disabled={cart.length === 0}
          className="btn-icon-primary w-full h-10 rounded-md disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none mt-1 gap-2">
          <CreditCard className="w-5 h-5" />
          {cart.length > 0 && <span className="text-sm font-bold tracking-wide">PAIEMENT</span>}
        </button>
      </div>

      {/* Footer — DESKTOP with virtual numpad (Warwi branded) */}
      {cart.length > 0 && (
        <div className="hidden lg:flex flex-col flex-shrink-0 border-t border-[var(--w-separator)] bg-[var(--w-surface)] pb-1">
          {/* Compact totals row */}
          <div className="px-3 py-1.5 space-y-0.5 shrink-0">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-neutral-500">Panier {cart.length} ligne{cart.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-neutral-500">Sous-total</span>
              <span className="font-semibold text-neutral-800 num">{formatFCFA(subtotal)}</span>
            </div>
            {can('apply_discounts') && (
              <div className="flex items-center justify-between text-[11px] gap-2">
                <span className="text-neutral-500 shrink-0">Remise globale</span>
                <input type="number" value={discount || ''} onChange={e => setDiscount(Math.max(0, Number(e.target.value)))} className="bg-transparent border-b border-neutral-200 focus:border-neutral-900 text-[11px] text-right num w-24 outline-none pb-0.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" placeholder="0" />
              </div>
            )}
            {ipmBeneficiaire && total > 0 && (
              <div className="px-2 py-1.5 bg-neutral-100 border border-neutral-200 rounded-lg text-[10px] space-y-1">
                <div className="flex items-center gap-2">
                  <Shield className="w-3.5 h-3.5 text-neutral-700 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="font-bold text-neutral-900">IPM {ipmBeneficiaire.ipm_organismes?.nom}</span>
                    <span className="text-neutral-700 ml-1">({ipmTaux}%{ipmModeCalcul === 'articles_eligibles' ? ' sur articles eligibles' : ipmModeCalcul === 'ligne_par_ligne' ? ' ligne/ligne' : ''})</span>
                  </div>
                  <div className="text-right shrink-0 leading-tight">
                    <div className="text-neutral-700">IPM: <span className="font-bold">{formatFCFA(ipmPartIpm)}</span></div>
                    <div className="text-neutral-900 font-bold">Client: {formatFCFA(ipmPartClient)}</div>
                  </div>
                </div>
                {ipmModeCalcul === 'articles_eligibles' && cart.some(i => i.ipm_eligible === false) && (
                  <div className="text-[9px] text-amber-700 bg-amber-50 px-2 py-1 rounded">
                    {cart.filter(i => i.ipm_eligible === false).length} article(s) non eligible(s) IPM, exclu(s) du calcul
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center justify-between pt-1 border-t border-neutral-200">
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Total</span>
              <div className="text-xl font-bold text-neutral-900 num leading-none">{formatFCFA(total)}</div>
            </div>
          </div>
          {/* Virtual numpad — Warwi branded, fills remaining space */}
          <PosNumpad
            target={{
              qty: selectedLine?.quantity || 1,
              price: selectedLine?.unit_price || 0,
              discount: selectedLine?.discount || 0,
              total: total,
            }}
            onCommit={commitNumpad}
            onValidate={openPayment}
            canDiscount={can('apply_discounts')}
            compact={true}
          />
        </div>
      )}
    </div>
  );

  return (
    <>
    {isResumeScreen && session ? (
      <div className="flex-1 overflow-y-auto lg:overflow-y-auto">
        <div className="w-full max-w-[1600px] mx-auto px-1.5 sm:px-5 lg:px-8 pt-2 sm:pt-4 lg:pt-6 pb-2 lg:pb-8">
          <POSLandingResume
            session={session}
            currentSite={currentSite}
            onResume={() => setScreen('pos')}
            tenantId={tenant?.id}
            onSeeAll={onNavigate ? () => onNavigate('cash_history') : undefined}
            cashierName={cashierName}
            tenantName={tenant?.name}
            onSwitchSite={() => setSitePickerOpen(true)}
            siteCount={sites.length}
            actions={{
              onStats: openStats,
              onTickets: openTickets,
              onReturn: openReturn,
              onCustomerPayment: openCustomerPayment,
              onMovement: openMovement,
              onWebOrders: openWebOrders,
              canWebOrders: hasModule('online_orders'),
              canViewSummary: can('pos_view_session_summary'),
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
    <div className="flex-1 flex flex-col overflow-hidden w-full min-h-0" style={{ height: 'calc(100dvh - 56px - env(safe-area-inset-top))' }}>
      {/* ── Unified command bar ─────────────────────────────────────── */}
      <div className="pos-command-bar shrink-0 relative z-20">
        {/* ═══ DESKTOP ═══ */}
        <div className="hidden lg:flex items-center h-[52px] px-2 gap-1">
          <div className="pos-search flex items-center gap-2 flex-1 min-w-0 h-9 mx-1 px-2.5">
            <Search className="w-4 h-4 text-[var(--w-text-muted)] shrink-0" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher…"
              className="flex-1 min-w-0 w-0 bg-transparent text-sm text-[var(--w-text)] focus:outline-none placeholder:text-[var(--w-text-disabled)]"
              autoFocus={desktopAutoFocus}
            />
            {search && (
              <button onClick={() => setSearch('')} className="shrink-0 p-1 text-[var(--w-text-muted)] hover:text-[var(--w-text)] transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {/* Source depot */}
          {(() => {
            if (depotAllOptions.length <= 1) return null;
            const selectedName = depotAllOptions.find(o => o.id === saleSourceSiteId)?.name || currentSite?.name || 'Stock';
            return (
              <div className="relative shrink-0">
                <button onClick={() => setDesktopDepotOpen(v => !v)} className="chip" title="Dépot source" disabled={stockSourceLoading}>
                  {stockSourceLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                  <span className="whitespace-nowrap">Dépot source: {selectedName}</span><ChevronDown className={`w-3 h-3 transition-transform ${desktopDepotOpen ? 'rotate-180' : ''}`} />
                </button>
                {desktopDepotOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setDesktopDepotOpen(false)} />
                    <div className="absolute left-0 top-full mt-1 z-[9999] w-48 rounded-lg border border-[var(--w-separator)] bg-[var(--w-surface)] shadow-lg py-1 animate-fade-in">
                      {depotAllOptions.map(o => (
                        <button key={o.id} onClick={() => handleStockSourceChange(o.id)} className={`pos-pop-item ${o.id === saleSourceSiteId ? 'text-brand-700 font-semibold' : ''}`}>
                          {o.id === saleSourceSiteId && <Check className="w-4 h-4" />}{o.name}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })()}
          <div className="w-px h-5 bg-[var(--w-separator)] shrink-0 mx-1" />
          <button onClick={() => setCategoryPickerOpen(true)} className={`chip ${categoryId ? 'chip-active' : ''}`} title="Catégorie">
            <Tag className="w-3.5 h-3.5" />
            <span className="hidden xl:inline max-w-[100px] truncate">{categoryId ? (categories.find(c => c.id === categoryId)?.name || 'Cat.') : 'Catégorie'}</span>
            {categoryId && <button onClick={e => { e.stopPropagation(); setCategoryId(''); }} className="ml-0.5 hover:text-red-500"><X className="w-3 h-3" /></button>}
          </button>
          {/* Top / Alpha */}
          <button onClick={() => setSortMode(m => m === 'top' ? 'alpha' : 'top')} className="chip" title={sortMode === 'top' ? 'Top ventes' : 'A→Z'}>
            {sortMode === 'top' ? <TrendingUp className="w-3.5 h-3.5 text-amber-500" /> : <ArrowDownAZ className="w-3.5 h-3.5" />}
            <span className="hidden xl:inline">{sortMode === 'top' ? 'Top' : 'A→Z'}</span>
          </button>
          {/* Grid / List */}
          <button onClick={() => setArticleView(v => v === 'grid' ? 'list' : 'grid')} className="chip" title={articleView === 'grid' ? 'Liste' : 'Grille'}>
            {articleView === 'grid' ? <List className="w-3.5 h-3.5" /> : <LayoutGrid className="w-3.5 h-3.5" />}
            <span className="hidden xl:inline">{articleView === 'grid' ? 'Liste' : 'Grille'}</span>
          </button>
          {autoMode && (
            <button onClick={() => setVehiclePickerOpen(true)} className="chip" title="Par véhicule">
              <Car className="w-3.5 h-3.5 text-brand-700" /><span className="hidden xl:inline">Véhicule</span>
            </button>
          )}
          <div className="w-px h-5 bg-[var(--w-separator)] shrink-0 mx-1" />
          <button onClick={openTickets} className="chip" data-label="Tickets"><List className="w-3.5 h-3.5" /><span className="hidden xl:inline">Tickets</span></button>
          {can('pos_returns') && <button onClick={openReturn} className="chip" data-label="Retour"><RotateCcw className="w-3.5 h-3.5" /><span className="hidden xl:inline">Retour</span></button>}
          {can('pos_cash_movement') && <button onClick={openMovement} className="chip" data-label="Mouvement"><ArrowDownRight className="w-3.5 h-3.5" /><span className="hidden xl:inline">Mouv.</span></button>}
          <button onClick={holdCart} className="chip" data-label="Pause"><Pause className="w-3.5 h-3.5" /><span className="hidden xl:inline">Pause</span></button>
          {/* Session popover button */}
          <div className="relative">
            {(() => {
              const reg = multiCash && ((session as any)?.register_code || (session as any)?.register_name);
              return (
                <button onClick={() => setSessionPopOpen(v => !v)} className={`pos-session-btn ml-1 ${sessionPopOpen ? 'is-open' : ''}`} aria-expanded={sessionPopOpen}>
                  {reg ? (
                    <span className="flex flex-col items-start min-w-0 leading-tight">
                      <span className="text-[10px] font-medium text-[var(--w-text-muted)]">Session</span>
                      <span title={registerText((session as any).register_code, (session as any).register_name)} className="text-xs font-bold text-[var(--w-text)] max-w-[10rem] truncate">{registerLabel((session as any).register_code, (session as any).register_name).primary}</span>
                    </span>
                  ) : (
                    <span className="text-xs font-bold text-[var(--w-text)]">Session</span>
                  )}
                  <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-[var(--w-text-muted)] transition-transform ${sessionPopOpen ? 'rotate-180' : ''}`} />
                </button>
              );
            })()}
            {sessionPopOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setSessionPopOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-52 rounded-lg border border-[var(--w-separator)] bg-[var(--w-surface)] shadow-lg py-1 animate-fade-in">
                  {can('pos_view_session_stats') && <button onClick={() => { setSessionPopOpen(false); openStats(); }} className="pos-pop-item"><BarChart2 className="w-4 h-4" />Stats</button>}
                  <button onClick={() => { setSessionPopOpen(false); openCustomerPayment(); }} className="pos-pop-item"><Wallet className="w-4 h-4" />Encaisser un client</button>
                  {hasModule('online_orders') && <button onClick={() => { setSessionPopOpen(false); openWebOrders(); }} className="pos-pop-item relative"><Globe className="w-4 h-4" />Commandes en ligne{webOrdersCounts.a_transformer > 0 && <span className="ml-auto min-w-[18px] h-[18px] px-1 text-[9px] rounded-full bg-red-500 text-white flex items-center justify-center font-bold">{webOrdersCounts.a_transformer}</span>}</button>}
                  <div className="h-px bg-[var(--w-separator)] my-1" />
                  <button onClick={() => { setSessionPopOpen(false); leaveSession(); }} className="pos-pop-item"><LogOut className="w-4 h-4" />Quitter</button>
                  {multiCash && posCashCtx?.is_elevated && <button onClick={() => { setSessionPopOpen(false); setSupervising(true); }} className="pos-pop-item"><Eye className="w-4 h-4" />Superviser une caisse</button>}
                  {can('pos_close_session') && <button onClick={() => { setSessionPopOpen(false); openCloseWorkflow(); }} className="pos-pop-item text-red-600"><Lock className="w-4 h-4" />Clôturer</button>}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ═══ MOBILE ═══ */}
        <div className="lg:hidden">
          {/* Line 1: search + filter + actions */}
          <div className="flex items-center h-11 px-2 gap-1.5">
            <div className="flex items-center gap-1.5 flex-1 min-w-0 h-9">
              <Search className="w-4 h-4 text-[var(--w-text-muted)] shrink-0" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Rechercher…"
                className="flex-1 min-w-0 w-0 bg-transparent text-sm text-[var(--w-text)] focus:outline-none placeholder:text-[var(--w-text-disabled)]"
              />
              {search && (
                <button onClick={() => setSearch('')} className="shrink-0 p-1 text-[var(--w-text-muted)] hover:text-[var(--w-text)] transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button onClick={() => setCategoryPickerOpen(true)} className={`shrink-0 p-2 rounded-md transition-colors ${categoryId ? 'text-brand-700 bg-brand-50' : 'text-[var(--w-text-sec)] hover:bg-[var(--w-hover)]'}`} title="Catégorie">
              <Tag className="w-4.5 h-4.5" />
            </button>
            <button onClick={() => setMobileActionsOpen(true)} className="shrink-0 p-2 rounded-md text-[var(--w-text-sec)] hover:bg-[var(--w-hover)] transition-colors relative" title="Actions">
              <MenuIcon className="w-4.5 h-4.5" />
              {webOrdersCounts.a_transformer > 0 && <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-red-500" />}
            </button>
          </div>
          {/* Line 2: thin filter pills */}
          <div className="flex items-center h-8 px-2 gap-1 border-t border-[var(--w-separator)] overflow-x-auto scrollbar-hide">
            {(() => {
              if (depotAllOptions.length <= 1) return null;
              const selectedName = depotAllOptions.find(o => o.id === saleSourceSiteId)?.name || currentSite?.name || 'Stock';
              return (
                <div className="relative shrink-0">
                  <button ref={mobileDepotTriggerRef} onClick={() => {
                    const el = mobileDepotTriggerRef.current;
                    if (el) {
                      const r = el.getBoundingClientRect();
                      const menuH = depotAllOptions.length * 34 + 8;
                      const spaceBelow = window.innerHeight - r.bottom - 8;
                      const flip = spaceBelow < menuH && r.top > spaceBelow;
                      setMobileDepotPos({
                        top: flip ? Math.max(8, r.top - menuH - 4) : r.bottom + 4,
                        left: Math.max(8, Math.min(r.left, window.innerWidth - 184)),
                        flip,
                      });
                    }
                    setMobileDepotOpen(v => !v);
                  }} className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold text-[var(--w-text-sec)] hover:bg-[var(--w-hover)]" disabled={stockSourceLoading}>
                    {stockSourceLoading ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : null}
                    <span className="whitespace-nowrap">Dépot source: {selectedName}</span><ChevronDown className={`w-2.5 h-2.5 transition-transform ${mobileDepotOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {mobileDepotOpen && ReactDOM.createPortal(
                    <>
                      <div className="fixed inset-0 z-[9998]" onClick={() => setMobileDepotOpen(false)} />
                      <div className="fixed z-[9999] w-44 rounded-lg border border-[var(--w-separator)] bg-[var(--w-surface)] shadow-lg py-1 animate-fade-in" style={{ top: mobileDepotPos.top, left: mobileDepotPos.left }}>
                        {depotAllOptions.map(o => (
                          <button key={o.id} onClick={() => handleStockSourceChange(o.id)} className={`pos-pop-item text-[11px] ${o.id === saleSourceSiteId ? 'text-brand-700 font-semibold' : ''}`}>
                            {o.id === saleSourceSiteId && <Check className="w-3.5 h-3.5" />}{o.name}
                          </button>
                        ))}
                      </div>
                    </>,
                    document.body
                  )}
                </div>
              );
            })()}
            {categoryId && (
              <button onClick={() => setCategoryId('')} className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700 text-[10px] font-semibold">
                {categories.find(c => c.id === categoryId)?.name} <X className="w-2.5 h-2.5" />
              </button>
            )}
            <button onClick={() => setSortMode(m => m === 'top' ? 'alpha' : 'top')} className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold text-[var(--w-text-sec)] hover:bg-[var(--w-hover)]">
              {sortMode === 'top' ? <TrendingUp className="w-3 h-3 text-amber-500" /> : <ArrowDownAZ className="w-3 h-3" />}
              {sortMode === 'top' ? 'Top' : 'A→Z'}
            </button>
            <button onClick={() => setArticleView(v => v === 'grid' ? 'list' : 'grid')} className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold text-[var(--w-text-sec)] hover:bg-[var(--w-hover)]">
              {articleView === 'grid' ? <List className="w-3 h-3" /> : <LayoutGrid className="w-3 h-3" />}
              {articleView === 'grid' ? 'Liste' : 'Grille'}
            </button>
            {autoMode && (
              <button onClick={() => setVehiclePickerOpen(true)} className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold text-[var(--w-text-sec)] hover:bg-[var(--w-hover)]">
                <Car className="w-3 h-3" />Véhicule
              </button>
            )}
            <span className="text-[var(--w-text-disabled)] text-[10px] num shrink-0 ml-auto">{filtered.length} art.</span>
          </div>
        </div>
      </div>

      {/* ── Mobile actions bottom sheet ──────────────────────────────── */}
      {mobileActionsOpen && (
        <div className="fixed inset-0 z-50 lg:hidden animate-fade-in">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={() => setMobileActionsOpen(false)} />
          <div className="absolute bottom-0 inset-x-0 bg-[var(--w-surface)] rounded-t-2xl shadow-lg animate-slide-up" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div className="w-10 h-1 rounded-full bg-[var(--w-text-disabled)] mx-auto mt-2 mb-3" />
            <div className="px-4 pb-4 space-y-0.5">
              <button onClick={() => { setMobileActionsOpen(false); openTickets(); }} className="pos-sheet-item"><List className="w-5 h-5" />Tickets</button>
              {can('pos_returns') && <button onClick={() => { setMobileActionsOpen(false); openReturn(); }} className="pos-sheet-item"><RotateCcw className="w-5 h-5" />Retour</button>}
              {can('pos_cash_movement') && <button onClick={() => { setMobileActionsOpen(false); openMovement(); }} className="pos-sheet-item"><ArrowDownRight className="w-5 h-5" />Mouvement</button>}
              <button onClick={() => { setMobileActionsOpen(false); openCustomerPayment(); }} className="pos-sheet-item"><Wallet className="w-5 h-5" />Encaisser un client</button>
              {can('pos_view_session_stats') && <button onClick={() => { setMobileActionsOpen(false); openStats(); }} className="pos-sheet-item"><BarChart2 className="w-5 h-5" />Stats</button>}
              <button onClick={() => { setMobileActionsOpen(false); holdCart(); }} className="pos-sheet-item"><Pause className="w-5 h-5" />Pause</button>
              {hasModule('online_orders') && <button onClick={() => { setMobileActionsOpen(false); openWebOrders(); }} className="pos-sheet-item relative"><Globe className="w-5 h-5" />Commandes en ligne{webOrdersCounts.a_transformer > 0 && <span className="ml-auto min-w-[18px] h-[18px] px-1 text-[9px] rounded-full bg-red-500 text-white flex items-center justify-center font-bold">{webOrdersCounts.a_transformer}</span>}</button>}
              <div className="h-px bg-[var(--w-separator)] my-1" />
              <button onClick={() => { setMobileActionsOpen(false); leaveSession(); }} className="pos-sheet-item"><LogOut className="w-5 h-5" />Quitter</button>
              {multiCash && posCashCtx?.is_elevated && <button onClick={() => { setMobileActionsOpen(false); setSupervising(true); }} className="pos-sheet-item"><Eye className="w-5 h-5" />Superviser une caisse</button>}
              {can('pos_close_session') && <button onClick={() => { setMobileActionsOpen(false); openCloseWorkflow(); }} className="pos-sheet-item text-red-600"><Lock className="w-5 h-5" />Clôturer</button>}
            </div>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            <div className="p-2 sm:p-3 w-full max-w-full mx-auto">
            {filtered.length === 0 ? (
              <div>
                <EmptyState icon={Package} title="Aucun article" description="Créez des articles dans le catalogue." />
                <div className="mt-3 flex justify-center">
                  <QuickCreateButton label="Créer un article" onClick={() => { setQuickArticleName(search); setQuickArticleOpen(true); }} />
                </div>
              </div>
            ) : articleView === 'grid' ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-2.5 w-full justify-center">
                {filtered.map(a => {
                  const allowNeg = !!(currentSite as any)?.allow_negative_stock;
                  const tracked = tracksStock(a);
                  const out = !allowNeg && tracked && a._stockLoaded && a.stock_available <= 0;
                  const low = tracked && a._stockLoaded && a.stock_available > 0 && a.stock_available <= 3;
                  return (
                    <button key={a.id} onClick={() => addToCart(a)} disabled={out}
                      className="product-card disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <div className="relative aspect-[4/3] overflow-hidden" style={{ background: '#FFFFFF', margin: 0, padding: 0 }}>
                        <PosCardImage key={a.image_url || ''} url={a.image_url} alt={a.name} />
                        {tracked && can('view_stock_levels') && (
                          <span className={`absolute top-1 right-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${!a._stockLoaded ? 'bg-neutral-300 text-white' : a.stock_available <= 0 ? (allowNeg ? 'bg-orange-500 text-white' : 'bg-red-500 text-white') : low ? 'bg-amber-500 text-white' : 'bg-white/90 text-neutral-700 border border-neutral-200'} shadow-sm num`}>
                            {!a._stockLoaded ? '...' : a.stock_available <= 0 ? (allowNeg ? '×0' : 'Rupture') : `×${a.stock_available}`}
                          </span>
                        )}
                      </div>
                      <div className="h-px bg-neutral-200 dark:bg-neutral-600" />
                      <div className="px-2 pt-1.5 pb-2 flex flex-col gap-1">
                        <div className="text-[10px] font-semibold text-neutral-900 dark:text-neutral-100 line-clamp-3 leading-[1.2] article-text">{a.name}</div>
                        <div className="flex items-center justify-between mt-auto">
                          <span className="text-[13px] font-bold text-neutral-900 dark:text-neutral-100 num">{formatFCFA(a.sale_price)}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-neutral-100 border-y border-neutral-100">
                {filtered.map(a => {
                  const allowNeg = !!(currentSite as any)?.allow_negative_stock;
                  const tracked = tracksStock(a);
                  const out = !allowNeg && tracked && a._stockLoaded && a.stock_available <= 0;
                  const stockLabel = tracked && can('view_stock_levels') ? (!a._stockLoaded ? '...' : a.stock_available <= 0 ? (allowNeg ? '0' : 'Rup') : `${a.stock_available}`) : '';
                  return (
                    <button
                      key={a.id}
                      onClick={() => addToCart(a)}
                      disabled={out}
                      className="w-full px-3 py-2 transition-colors text-left active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-neutral-50"
                    >
                      {/* Desktop: single row with vertical separators */}
                      <div className="hidden sm:flex items-center gap-2">
                        <span className={`text-[11px] font-bold num tabular-nums w-12 shrink-0 text-center ${!a._stockLoaded ? 'text-neutral-300' : a.stock_available <= 0 ? 'text-neutral-400' : 'text-neutral-700'}`}>
                          {stockLabel}
                        </span>
                        <span className="w-px h-4 bg-neutral-200 shrink-0" />
                        <span className="flex-1 min-w-0 text-[12px] font-semibold text-neutral-900 truncate">{a.name}</span>
                        <span className="w-px h-4 bg-neutral-200 shrink-0" />
                        <span className="text-[12px] font-bold text-neutral-900 num shrink-0 tabular-nums">{formatFCFA(a.sale_price)}</span>
                      </div>
                      {/* Mobile: name on top line (marquee), stock left + price right on second line */}
                      <div className="sm:hidden">
                        <MarqueeText className="text-[12px] font-semibold text-neutral-900">{a.name}</MarqueeText>
                        <div className="flex items-center justify-between mt-0.5">
                          <span className={`text-[10px] font-bold num ${!a._stockLoaded ? 'text-neutral-300' : a.stock_available <= 0 ? 'text-red-500' : 'text-neutral-500'}`}>
                            {stockLabel && `Stock: ${stockLabel}`}
                          </span>
                          <span className="text-[12px] font-bold text-neutral-900 num">{formatFCFA(a.sale_price)}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            </div>
          </div>
        </div>

        <aside className="hidden lg:flex w-[400px] xl:w-[440px] bg-[var(--w-surface)] border-l border-[var(--w-separator)] flex-col shadow-[inset_8px_0_24px_-16px_rgb(15_23_42_/0.08)]">
          {CartPanel}
        </aside>

        {mobileCartOpen && (
          <div className="fixed inset-0 z-40 lg:hidden animate-fade-in">
            <div className="absolute inset-0 bg-[var(--w-surface)] flex flex-col overflow-hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
              <div className="flex items-center gap-2 px-3 h-11 border-b border-[var(--w-separator)] shrink-0">
                <button onClick={() => setMobileCartOpen(false)} className="p-1 -ml-1 text-[var(--w-text-muted)] hover:text-[var(--w-text)]"><ChevronLeft className="w-5 h-5" /></button>
                <span className="text-sm font-bold text-[var(--w-text)] leading-none">Panier</span>
                <span className="text-[10px] font-semibold text-[var(--w-text-muted)] num">{cart.length} ligne{cart.length !== 1 ? 's' : ''}</span>
                <div className="flex-1" />
                {heldCarts.length > 0 && (
                  <button onClick={openTickets} className="pos-btn relative" title="Paniers en pause">
                    <Pause className="w-4 h-4" />
                    <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 text-[8px] rounded-full bg-amber-500 text-white flex items-center justify-center font-bold">{heldCarts.length}</span>
                  </button>
                )}
                {cart.length > 0 && (
                  <button onClick={() => { setCart([]); setDiscount(0); setCustomer(null); }} className="pos-btn text-red-500" title="Vider"><Trash2 className="w-4 h-4" /></button>
                )}
              </div>
              {CartPanel}
            </div>
          </div>
        )}
      </div>

      {/* ── Modals ───────────────────────────────────────────────────────────── */}

      {/* Category picker modal */}
      <CategoryPickerModal open={categoryPickerOpen} onClose={() => setCategoryPickerOpen(false)} categories={categories} onSelect={v => { setCategoryId(v); setCategoryPickerOpen(false); }} />

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
            ipm_eligible: true,
            track_stock: (a as any).track_stock !== false,
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
              <p className="text-xs text-neutral-500 mb-3">Sélectionnez le tarif à appliquer pour <span className="font-semibold text-neutral-700">{tierPickerArticle.name}</span></p>
              <button onClick={() => addToCartWithTier(tierPickerArticle, '', defaultPrice)} className="w-full text-left px-4 py-3 rounded-md border border-neutral-200 hover:border-brand-300 hover:bg-brand-50/30 transition-all group">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-neutral-900">Prix standard</span>
                  <span className="text-sm font-bold text-neutral-900 num">{formatFCFA(defaultPrice)}</span>
                </div>
              </button>
              {tiers.map(t => (
                <button key={t.tier_name} onClick={() => addToCartWithTier(tierPickerArticle, t.tier_name, t.price)} className="w-full text-left px-4 py-3 rounded-md border border-neutral-200 hover:border-brand-300 hover:bg-brand-50/30 transition-all group">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-neutral-900">{t.tier_name}</span>
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

      {mvOpen && cashCtx && (
        <CashMovementModal ctx={cashCtx} onClose={() => setMvOpen(false)} onDone={load} />
      )}

      {custPayOpen && cashCtx && (
        <CustomerPaymentModal ctx={cashCtx} onClose={() => setCustPayOpen(false)} onDone={load} />
      )}

      {/* Fullscreen immersive payment */}
      {payOpen && (
        <PaymentScreen
          total={ipmPartClient}
          customer={customer}
          methods={methods}
          payments={payments}
          setPayments={setPayments}
          paying={paying}
          onClose={() => setPayOpen(false)}
          onValidate={validateSale}
          onValidateCredit={validateCreditSale}
          docSettings={posDocSettings}
          docFields={{ deliveryDate: docDeliveryDate, reference: docReference, warranty: docWarranty, imei: docImei, representative: docRepresentative }}
          setDocFields={{ setDeliveryDate: setDocDeliveryDate, setReference: setDocReference, setWarranty: setDocWarranty, setImei: setDocImei, setRepresentative: setDocRepresentative }}
          reps={posReps}
          ipmInfo={ipmBeneficiaire && ipmPartIpm > 0 ? { organisme: ipmBeneficiaire.ipm_organismes?.nom, partIpm: ipmPartIpm, taux: ipmTaux } : null}
          ipmDocRequired={ipmBeneficiaire && ipmPartIpm > 0 && ipmConfig ? {
            ordonnance: !!(ipmConfig.ordonnance_obligatoire || ipmConfig.numero_ordonnance_obligatoire),
            medecin: !!ipmConfig.medecin_prescripteur_obligatoire,
            bon: !!(ipmConfig.bon_prise_en_charge_obligatoire || ipmConfig.numero_bon_obligatoire),
          } : null}
          ipmDocuments={ipmDocuments}
          setIpmDocuments={setIpmDocuments}
          autoPrintTicket={autoPrintTicket}
          setAutoPrintTicket={(v) => updateAutoPrintPref('auto_print_ticket', v)}
          autoPrintInvoice={autoPrintInvoice}
          setAutoPrintInvoice={(v) => updateAutoPrintPref('auto_print_invoice', v)}
        />
      )}

      {/* Post-sale: print choice */}
      {lastSale && (
        <Modal open={!!lastSale} onClose={() => setLastSale(null)} title="Vente enregistrée" size="sm"
          footer={<div className="w-full flex items-center justify-end gap-2">
            <button onClick={() => setLastSale(null)} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>
            <button onClick={() => {
              printSaleTicket(lastSale);
              setLastSale(null);
            }} className="btn-icon" title="Ticket"><Printer className="w-4 h-4" /></button>
            <button onClick={() => {
              printSaleInvoice(lastSale);
              setLastSale(null);
            }} className="btn-icon-primary" title="Facture"><FileText className="w-4 h-4" /></button>
          </div>}
        >
          <div className="text-center py-4">
            <div className="w-14 h-14 rounded-full bg-neutral-100 flex items-center justify-center mx-auto mb-3">
              <Check className="w-7 h-7 text-neutral-700" />
            </div>
            <div className="font-semibold text-neutral-900">{lastSale.sale_number}</div>
            <div className="text-2xl font-bold text-brand-800 mt-1">{formatFCFA(lastSale.total)}</div>
            {lastSale.payments.reduce((s, p) => s + p.amount, 0) > lastSale.total && (
              <div className="mt-2 text-sm text-neutral-800 font-semibold">
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
          <div className="py-8 text-center text-sm text-neutral-500">Aucun ticket en attente.</div>
        ) : (
          <div className="space-y-2">
            {heldCarts.map(h => (
              <div key={h.id} className="flex items-center justify-between p-3 border border-neutral-200 rounded-md hover:bg-neutral-50">
                <div className="min-w-0">
                  <div className="font-semibold text-sm">{h.label}</div>
                  <div className="text-xs text-neutral-500">{h.cart.length} article{h.cart.length > 1 ? 's' : ''} · {formatFCFA(h.cart.reduce((s, i) => s + i.quantity * i.unit_price - i.discount, 0) - h.discount)}</div>
                  <div className="text-xs text-neutral-400">{new Date(h.savedAt).toLocaleTimeString('fr-FR')}</div>
                </div>
                <div className="flex items-center gap-2 ml-3 shrink-0">
                  <button onClick={() => resumeHeld(h)} className="btn-icon-primary" title="Reprendre">
                    <Play className="w-4 h-4" />
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

      {returnOpen && cashCtx && (
        <SaleReturnModal ctx={cashCtx} onClose={() => setReturnOpen(false)} onDone={load} />
      )}

      {/* Lot picker modal for manual lot selection */}
      <LotPickerModal
        open={lotPickerOpen}
        onClose={() => setLotPickerOpen(false)}
        items={cart.map(c => ({ article_id: c.article_id, name: c.name, quantity: c.quantity }))}
        onConfirm={(selections) => executeSale(selections)}
        title="Selection des lots a consommer"
        confirmLabel="Confirmer la vente"
      />

      {ticketsOpen && cashCtx && <SessionTicketsModal ctx={cashCtx} onClose={() => setTicketsOpen(false)} />}

      {statsOpen && session && cashCtx && <SessionStatsModal ctx={cashCtx} session={session} onClose={() => setStatsOpen(false)} />}


      {closeOpen && session && cashCtx && (
        <CashCloseModal ctx={cashCtx} session={session} multiEnabled={!!posCashCtx?.multi_enabled}
          onClose={() => setCloseOpen(false)}
          onClosed={() => {
            setCloseOpen(false); setSession(null); setScreen('open-form');
            setCart([]); setDiscount(0); setCustomer(null);
            setOpeningAmount(0); setOpeningNote('');
            load();
          }} />
      )}

      {/* Site picker modal */}
      <Modal open={sitePickerOpen} onClose={() => setSitePickerOpen(false)} title="Changer de point de vente" size="md"
        footer={<button onClick={() => setSitePickerOpen(false)} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>}>
        {sites.length <= 1 ? (
          <div className="py-8 text-center">
            <div className="w-12 h-12 rounded-full bg-neutral-100 flex items-center justify-center mx-auto mb-3">
              <Store className="w-6 h-6 text-neutral-400" />
            </div>
            <p className="text-sm font-semibold text-neutral-900">Un seul point de vente</p>
            <p className="text-xs text-neutral-500 mt-1">Vous n'avez qu'un seul magasin configuré. Contactez l'administrateur pour en ajouter d'autres.</p>
          </div>
        ) : (
          <div>
            <p className="text-[11px] text-neutral-500 uppercase tracking-wider font-semibold mb-1">Sélectionnez un magasin</p>
            <div className="divide-y divide-neutral-100">
            {sites.map(s => {
              const active = s.id === currentSite?.id;
              return (
                <button
                  key={s.id}
                  onClick={() => {
                    if (!active) {
                      setCurrentSite(s);
                      setSitePickerOpen(false);
                      setScreen('open-form');
                    }
                  }}
                  disabled={active}
                  className="w-full flex items-center gap-3 px-1 py-3 text-left transition-colors disabled:cursor-default"
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${active ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-500'}`}>
                    <Store className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-neutral-900 truncate">{s.name}</p>
                    {s.address && <p className="text-[10px] text-neutral-500 truncate">{s.address}</p>}
                  </div>
                  {active && <Check className="w-4 h-4 text-neutral-500 shrink-0" />}
                </button>
              );
            })}
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
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${active ? 'bg-gradient-to-r from-brand-600 to-brand-800 text-white shadow-sm' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'}`}>
                    <Icon className="w-3.5 h-3.5" />{f.label}
                    <span className={`min-w-[20px] h-4 px-1 rounded-full flex items-center justify-center text-[10px] ${active ? 'bg-white/25' : 'bg-white text-neutral-700'}`}>{f.count}</span>
                  </button>
                );
              })}
              <button onClick={loadWebOrders} className="btn-icon" title="Actualiser"><RotateCcw className="w-4 h-4" /></button>
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
                      className="w-full text-left p-3 rounded-md bg-white border border-neutral-200 hover:border-brand-400 hover:shadow-sm transition-all">
                      <div className="flex items-start gap-3">
                        <div className={`w-10 h-10 rounded-md flex items-center justify-center shrink-0 ${o.status === 'annulee' ? 'bg-rose-100 text-rose-700' : transformed ? 'bg-neutral-100 text-neutral-800' : 'bg-brand-100 text-brand-700'}`}>
                          {o.delivery_mode === 'livraison' ? <Truck className="w-5 h-5" /> : <ShoppingBag className="w-5 h-5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-extrabold text-neutral-900 tracking-wider text-sm">{o.order_number}</span>
                            <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${o.status === 'nouvelle' ? 'bg-neutral-100 text-neutral-700' : o.status === 'confirmee' ? 'bg-neutral-100 text-neutral-800' : o.status === 'en_preparation' ? 'bg-amber-100 text-amber-700' : o.status === 'prete' ? 'bg-neutral-200 text-neutral-800' : o.status === 'livree' ? 'bg-neutral-100 text-neutral-800' : 'bg-rose-100 text-rose-700'}`}>{o.status}</span>
                            {transformed && <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-neutral-900 text-white inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Transformée</span>}
                            {o.payment_status !== 'paye' && <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">{o.payment_status === 'en_attente' ? 'Attente' : 'Non payé'}</span>}
                          </div>
                          <div className="text-xs text-neutral-600 mt-0.5 break-words">{o.customer_name} · <Phone className="inline w-3 h-3" /> {o.customer_phone}</div>
                          <div className="text-[11px] text-neutral-400 mt-0.5">{new Date(o.created_at).toLocaleString('fr-FR')}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-extrabold text-neutral-900 num">{formatFCFA(o.total)}</div>
                          <div className="text-[10px] text-neutral-500 capitalize">{(o.payment_mode || '').replace(/_/g, ' ')}</div>
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
            <button onClick={() => { setWebOrderDetail(null); setWebOrderItems([]); }} className="btn-icon" title="Retour à la liste"><ChevronLeft className="w-4 h-4" /></button>
            <div className="p-4 rounded-md bg-gradient-to-br from-brand-50 to-white border border-brand-100">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-brand-700">Commande</div>
                  <div className="font-extrabold text-lg text-neutral-900 tracking-wider">{webOrderDetail.order_number}</div>
                  <div className="text-xs text-neutral-600 mt-1">{new Date(webOrderDetail.created_at).toLocaleString('fr-FR')}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Total</div>
                  <div className="font-extrabold text-xl text-neutral-900 num">{formatFCFA(webOrderDetail.total)}</div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-3 rounded-md bg-neutral-50 border border-neutral-200">
                <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 mb-1 flex items-center gap-1"><User className="w-3 h-3" />Client</div>
                <div className="font-bold text-neutral-900">{webOrderDetail.customer_name}</div>
                <div className="text-neutral-600 flex items-center gap-1 mt-0.5"><Phone className="w-3 h-3" />{webOrderDetail.customer_phone}</div>
                {webOrderDetail.customer_whatsapp && <div className="text-neutral-800 mt-0.5">WhatsApp: {webOrderDetail.customer_whatsapp}</div>}
              </div>
              <div className="p-3 rounded-md bg-neutral-50 border border-neutral-200">
                <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 mb-1 flex items-center gap-1">
                  {webOrderDetail.delivery_mode === 'livraison' ? <Truck className="w-3 h-3" /> : <ShoppingBag className="w-3 h-3" />}
                  {webOrderDetail.delivery_mode === 'livraison' ? 'Livraison' : 'Retrait'}
                </div>
                <div className="text-neutral-800">{webOrderDetail.delivery_mode === 'livraison' ? (webOrderDetail.delivery_address || '—') : 'Retrait en boutique'}</div>
                {webOrderDetail.delivery_fee > 0 && <div className="text-neutral-500 mt-0.5">Frais: {formatFCFA(webOrderDetail.delivery_fee)}</div>}
              </div>
            </div>
            <div className="p-3 rounded-md bg-amber-50 border border-amber-200 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-900">
                <div className="font-bold">Paiement: <span className="capitalize">{(webOrderDetail.payment_mode || '').replace(/_/g, ' ')}</span></div>
                <div className="mt-0.5">Le stock sera décrémenté uniquement lors de la validation de la vente en caisse.</div>
              </div>
            </div>
            <div className="rounded-md border border-neutral-200 overflow-hidden">
              <div className="px-3 py-2 bg-neutral-50 border-b border-neutral-200 text-[10px] font-bold uppercase tracking-wider text-neutral-500">Articles ({webOrderItems.length})</div>
              <div className="divide-y divide-neutral-100 max-h-60 overflow-y-auto">
                {webOrderItems.map(it => (
                  <div key={it.id} className="flex items-start justify-between px-3 py-2 gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-neutral-900 break-words">{it.article_name}</div>
                      <div className="text-[11px] text-neutral-500">Qté {it.quantity} × {formatFCFA(it.unit_price)}</div>
                    </div>
                    <div className="text-sm font-bold text-neutral-900 shrink-0 num whitespace-nowrap">{formatFCFA(it.line_total)}</div>
                  </div>
                ))}
              </div>
            </div>
            {webOrderDetail.customer_note && (
              <div className="p-3 rounded-md bg-neutral-50 border border-neutral-200 text-xs text-neutral-700">
                <span className="font-bold">Note client:</span> {webOrderDetail.customer_note}
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-2">
              {!webOrderDetail.sale_id && webOrderDetail.status !== 'annulee' && (
                <button onClick={loadToCartFromWebOrder} disabled={!session || transforming}
                  className="flex-1 h-11 rounded-md bg-gradient-to-r from-brand-600 to-brand-800 text-white font-bold inline-flex items-center justify-center gap-2 hover:opacity-95 active:scale-[0.98] transition-all shadow-glow disabled:opacity-60">
                  <ArrowRight className="w-4 h-4" />Transformer en vente
                </button>
              )}
              {webOrderDetail.sale_id && webOrderDetail.status !== 'livree' && (
                <button onClick={() => markWebOrderDelivered(webOrderDetail)} className="flex-1 h-11 rounded-md bg-neutral-900 text-white font-bold inline-flex items-center justify-center gap-2 hover:bg-neutral-800 active:scale-[0.98] transition-all">
                  <CheckCircle2 className="w-4 h-4" />Marquer livrée
                </button>
              )}
              {webOrderDetail.customer_phone && (
                <a href={`tel:${webOrderDetail.customer_phone}`} className="h-11 px-4 rounded-md bg-neutral-100 text-neutral-700 font-semibold inline-flex items-center justify-center gap-2 hover:bg-neutral-200 transition-all">
                  <Phone className="w-4 h-4" />Appeler
                </a>
              )}
              {webOrderDetail.status !== 'annulee' && !webOrderDetail.sale_id && (
                <button onClick={() => cancelWebOrder(webOrderDetail)} className="h-11 px-4 rounded-md bg-rose-50 text-rose-700 font-semibold inline-flex items-center justify-center gap-2 hover:bg-rose-100 transition-all border border-rose-200">
                  <X className="w-4 h-4" />Annuler
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      <QuickCreateArticleModal
        open={quickArticleOpen}
        onClose={() => setQuickArticleOpen(false)}
        onCreated={(a) => {
          setArticles(prev => [{ ...a, stock_available: 0, track_stock: a.track_stock !== false } as ArticleLite, ...prev]);
        }}
        initialName={quickArticleName}
      />
      <QuickCreateCustomerModal
        open={quickCustomerOpen}
        onClose={() => setQuickCustomerOpen(false)}
        onCreated={(c) => { setCustomers(prev => [c, ...prev]); }}
        initialName={quickCustomerName}
      />
    </>
  );
}

// ═══ Fullscreen immersive payment screen ═══════════════════════════════════════

function PaymentScreen({
  total, customer, methods, payments, setPayments, paying,
  onClose, onValidate, onValidateCredit,
  docSettings, docFields, setDocFields, ipmInfo,
  ipmDocRequired, ipmDocuments, setIpmDocuments, reps,
  autoPrintTicket, setAutoPrintTicket,
  autoPrintInvoice, setAutoPrintInvoice,
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
  docSettings: { show_delivery_date: boolean; show_reference: boolean; show_warranty: boolean; show_imei: boolean; show_representative: boolean; default_representative: string };
  docFields: { deliveryDate: string; reference: string; warranty: string; imei: string; representative: string };
  setDocFields: { setDeliveryDate: (v: string) => void; setReference: (v: string) => void; setWarranty: (v: string) => void; setImei: (v: string) => void; setRepresentative: (v: string) => void };
  reps?: SalesRepresentative[];
  ipmInfo?: { organisme: string; partIpm: number; taux: number } | null;
  ipmDocRequired?: { ordonnance: boolean; medecin: boolean; bon: boolean } | null;
  ipmDocuments?: { numero_ordonnance: string; medecin: string; numero_bon: string };
  setIpmDocuments?: (updater: (d: { numero_ordonnance: string; medecin: string; numero_bon: string }) => { numero_ordonnance: string; medecin: string; numero_bon: string }) => void;
  autoPrintTicket: boolean;
  setAutoPrintTicket: (v: boolean) => void;
  autoPrintInvoice: boolean;
  setAutoPrintInvoice: (v: boolean) => void;
}) {
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = total - totalPaid;
  const enough = totalPaid >= total && total > 0;
  const canPartial = customer && totalPaid > 0 && totalPaid < total;

  const hasDocFields = docSettings.show_delivery_date || docSettings.show_reference || docSettings.show_warranty || docSettings.show_imei || docSettings.show_representative;

  const ipmDocsValid = !ipmDocRequired || (
    (!ipmDocRequired.ordonnance || !!(ipmDocuments?.numero_ordonnance?.trim())) &&
    (!ipmDocRequired.medecin || !!(ipmDocuments?.medecin?.trim())) &&
    (!ipmDocRequired.bon || !!(ipmDocuments?.numero_bon?.trim()))
  );
  const hasIpmDocFields = !!(ipmDocRequired && (ipmDocRequired.ordonnance || ipmDocRequired.medecin || ipmDocRequired.bon));

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
    <div className="fixed inset-0 z-[80] flex items-center justify-center animate-fade-in">
      <div className="absolute inset-0 bg-neutral-900/50" onClick={paying ? undefined : onClose} />
      <div className="relative w-[calc(100%-32px)] max-w-[420px] bg-white rounded-lg shadow-lg flex flex-col max-h-[88vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <div className="flex items-baseline gap-3">
            <p className="text-[20px] font-bold text-neutral-900 num leading-none tracking-tight">{formatFCFA(total)}</p>
            {totalPaid > 0 && (
              <span className="text-[11px] num">
                {remaining > 0
                  ? <span className="text-amber-600 font-semibold">reste {formatFCFA(remaining)}</span>
                  : <span className="text-neutral-500">monnaie {formatFCFA(-remaining)}</span>
                }
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 -mr-1.5 text-neutral-400 hover:text-neutral-700 transition-colors" disabled={paying}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="h-px bg-[var(--w-separator-l)]" />

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto overscroll-contain">

          {/* Customer + IPM compact banner */}
          {(customer || ipmInfo) && (
            <div className="px-4 py-2 flex items-center gap-2 text-[11px] border-b border-[var(--w-separator-l)]">
              {customer && <><User className="w-3 h-3 text-neutral-400" /><span className="font-semibold text-neutral-700">{customer.name}</span>{
                Number((customer as any).balance || 0) !== 0 && <span className="text-amber-700 font-bold num">({formatFCFA(Number((customer as any).balance || 0))})</span>
              }</>}
              {customer && ipmInfo && <span className="text-neutral-200">|</span>}
              {ipmInfo && <><Shield className="w-3 h-3 text-neutral-400" /><span className="text-neutral-500">{ipmInfo.organisme} {ipmInfo.taux}%</span><span className="font-bold text-neutral-800 num">{formatFCFA(ipmInfo.partIpm)}</span></>}
            </div>
          )}

          {/* Payment lines */}
          {payments.length > 0 && (
            <div className="px-4">
              {payments.map((p, idx) => (
                <div key={idx} className="flex items-center gap-2 py-2 border-b border-neutral-100 last:border-b-0">
                  <div className="flex-1 min-w-0">
                    <span className="text-[9px] font-semibold uppercase tracking-wide text-neutral-400">{p.method_name}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={p.amount || ''}
                      onChange={e => updateAmount(idx, e.target.value)}
                      className="w-full bg-transparent text-[16px] font-bold num text-neutral-900 outline-none border-none p-0 leading-tight [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      placeholder="0"
                    />
                  </div>
                  <button onClick={() => setExact(idx)} className="px-1.5 py-0.5 text-[9px] font-bold text-neutral-600 hover:text-neutral-900 transition-colors">Exact</button>
                  <button onClick={() => removePayment(idx)} className="p-1 text-neutral-300 hover:text-red-500 transition-colors"><Trash2 className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
          )}

          {/* Payment methods */}
          <div className="px-4 py-2.5">
            {payments.length === 0 && <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-neutral-400 mb-1.5">Mode de paiement</p>}
            <div>
              {methods.filter(m => !payments.some(p => p.payment_method_id === m.id)).map(m => (
                <button key={m.id} onClick={() => selectMethod(m)}
                  className="w-full text-left py-1.5 border-b border-neutral-100 last:border-b-0 text-[12px] font-semibold text-neutral-700 hover:text-neutral-900 transition-colors">
                  {m.name}
                </button>
              ))}
            </div>
          </div>

          {/* Credit sale option */}
          {customer && totalPaid === 0 && (
            <div className="px-4 py-2 border-t border-neutral-100">
              <button onClick={onValidateCredit} disabled={paying || !ipmDocsValid}
                className="w-full flex items-center justify-center gap-1.5 h-8 text-amber-800 hover:bg-amber-50 transition-colors text-[11px] font-bold disabled:opacity-50">
                {paying ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                Tout à crédit
              </button>
            </div>
          )}

          {/* Document fields */}
          {hasDocFields && (
            <div className="px-4 py-2 border-t border-neutral-100">
              <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-neutral-400 mb-2">Document</p>
              {docSettings.show_reference && (
                <div className="mb-2">
                  <label className="text-[9px] text-neutral-400 block">Référence client</label>
                  <input value={docFields.reference} onChange={e => setDocFields.setReference(e.target.value)} placeholder="Réf. commande / dossier" className="w-full bg-transparent border-b border-neutral-200 focus:border-neutral-900 text-[12px] text-neutral-900 placeholder:text-neutral-300 outline-none pb-1 transition-colors" />
                </div>
              )}
              {docSettings.show_delivery_date && (
                <div className="mb-2">
                  <label className="text-[9px] text-neutral-400 block">Date de livraison</label>
                  <input type="date" value={docFields.deliveryDate} onChange={e => setDocFields.setDeliveryDate(e.target.value)} className="w-full bg-transparent border-b border-neutral-200 focus:border-neutral-900 text-[12px] text-neutral-900 outline-none pb-1 transition-colors" />
                </div>
              )}
              {docSettings.show_warranty && (
                <div className="mb-2">
                  <label className="text-[9px] text-neutral-400 block">Garantie</label>
                  <input value={docFields.warranty} onChange={e => setDocFields.setWarranty(e.target.value)} placeholder="Ex : 6 mois, 1 an" className="w-full bg-transparent border-b border-neutral-200 focus:border-neutral-900 text-[12px] text-neutral-900 placeholder:text-neutral-300 outline-none pb-1 transition-colors" />
                </div>
              )}
              {docSettings.show_imei && (
                <div className="mb-2">
                  <label className="text-[9px] text-neutral-400 block">IMEI / Téléphone</label>
                  <input value={docFields.imei} onChange={e => setDocFields.setImei(e.target.value)} placeholder="Numéro IMEI ou série" className="w-full bg-transparent border-b border-neutral-200 focus:border-neutral-900 text-[12px] text-neutral-900 placeholder:text-neutral-300 outline-none pb-1 transition-colors" />
                </div>
              )}
              {docSettings.show_representative && (
                <div className="mb-2">
                  <label className="text-[9px] text-neutral-400 block">Représentant</label>
                  <select value={docFields.representative} onChange={e => setDocFields.setRepresentative(e.target.value)} className="w-full bg-transparent border-b border-neutral-200 focus:border-neutral-900 text-[12px] text-neutral-900 outline-none pb-1 transition-colors cursor-pointer">
                    <option value="">Aucun</option>
                    {(reps || []).map(r => <option key={r.id} value={r.id}>{repDisplayName(r)}</option>)}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* IPM mandatory documents */}
          {hasIpmDocFields && setIpmDocuments && (
            <div className="px-4 py-2 border-t border-neutral-100">
              <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-neutral-400 mb-2">Documents IPM</p>
              {ipmDocRequired?.ordonnance && (
                <div className="mb-2">
                  <label className="text-[9px] text-neutral-400 block">N° Ordonnance *</label>
                  <input value={ipmDocuments?.numero_ordonnance || ''} onChange={e => setIpmDocuments(d => ({ ...d, numero_ordonnance: e.target.value }))} placeholder="Numéro d'ordonnance" className={`w-full bg-transparent border-b text-[12px] text-neutral-900 placeholder:text-neutral-300 outline-none pb-1 transition-colors ${!ipmDocuments?.numero_ordonnance?.trim() ? 'border-red-300 focus:border-red-500' : 'border-neutral-200 focus:border-neutral-900'}`} />
                </div>
              )}
              {ipmDocRequired?.medecin && (
                <div className="mb-2">
                  <label className="text-[9px] text-neutral-400 block">Médecin prescripteur *</label>
                  <input value={ipmDocuments?.medecin || ''} onChange={e => setIpmDocuments(d => ({ ...d, medecin: e.target.value }))} placeholder="Nom du médecin" className={`w-full bg-transparent border-b text-[12px] text-neutral-900 placeholder:text-neutral-300 outline-none pb-1 transition-colors ${!ipmDocuments?.medecin?.trim() ? 'border-red-300 focus:border-red-500' : 'border-neutral-200 focus:border-neutral-900'}`} />
                </div>
              )}
              {ipmDocRequired?.bon && (
                <div className="mb-2">
                  <label className="text-[9px] text-neutral-400 block">N° Bon de prise en charge *</label>
                  <input value={ipmDocuments?.numero_bon || ''} onChange={e => setIpmDocuments(d => ({ ...d, numero_bon: e.target.value }))} placeholder="Numéro du bon IPM" className={`w-full bg-transparent border-b text-[12px] text-neutral-900 placeholder:text-neutral-300 outline-none pb-1 transition-colors ${!ipmDocuments?.numero_bon?.trim() ? 'border-red-300 focus:border-red-500' : 'border-neutral-200 focus:border-neutral-900'}`} />
                </div>
              )}
              {!ipmDocsValid && (
                <p className="text-[10px] text-red-500 font-medium mt-1">Remplissez tous les champs obligatoires</p>
              )}
            </div>
          )}
        </div>

        {/* Print toggles */}
        <div className="border-t border-neutral-100 px-4 py-2 space-y-1.5">
          <label className="flex items-center justify-between cursor-pointer select-none">
            <span className="text-[10px] text-neutral-600 flex items-center gap-1"><Printer className="w-3 h-3" /> Ticket auto</span>
            <button type="button" role="switch" aria-checked={autoPrintTicket}
              onClick={() => { const next = !autoPrintTicket; setAutoPrintTicket(next); if (next) setAutoPrintInvoice(false); }}
              className={`relative w-8 h-[18px] rounded-full transition-colors shrink-0 ${autoPrintTicket ? 'bg-neutral-900' : 'bg-neutral-200'}`}>
              <span className={`absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform ${autoPrintTicket ? 'translate-x-[14px]' : ''}`} />
            </button>
          </label>
          <label className="flex items-center justify-between cursor-pointer select-none">
            <span className="text-[10px] text-neutral-600 flex items-center gap-1"><FileText className="w-3 h-3" /> Facture auto</span>
            <button type="button" role="switch" aria-checked={autoPrintInvoice}
              onClick={() => { const next = !autoPrintInvoice; setAutoPrintInvoice(next); if (next) setAutoPrintTicket(false); }}
              className={`relative w-8 h-[18px] rounded-full transition-colors shrink-0 ${autoPrintInvoice ? 'bg-neutral-900' : 'bg-neutral-200'}`}>
              <span className={`absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform ${autoPrintInvoice ? 'translate-x-[14px]' : ''}`} />
            </button>
          </label>
        </div>

        {/* Footer */}
        <div className="border-t border-neutral-100 px-4 py-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          {enough ? (
            <button onClick={onValidate} disabled={paying || !ipmDocsValid}
              className="h-10 px-5 rounded-md bg-neutral-900 text-white text-[13px] font-bold flex items-center justify-center gap-2 hover:bg-neutral-800 active:scale-[0.98] transition-all disabled:opacity-50 order-1 sm:order-2 sm:ml-auto">
              {paying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              <span>{paying ? 'Traitement...' : `Valider · ${formatFCFA(total)}`}</span>
            </button>
          ) : canPartial ? (
            <button onClick={onValidate} disabled={paying || !ipmDocsValid}
              className="h-10 px-5 rounded-md bg-neutral-900 text-white text-[13px] font-bold flex items-center justify-center gap-2 hover:bg-neutral-800 active:scale-[0.98] transition-all disabled:opacity-50 order-1 sm:order-2 sm:ml-auto">
              {paying ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              <span>{paying ? 'Traitement...' : `Partiel · ${formatFCFA(remaining)} crédit`}</span>
            </button>
          ) : (
            <div className="h-10 px-5 rounded-md bg-neutral-50 text-neutral-400 font-semibold text-[13px] flex items-center justify-center border border-neutral-100 order-1 sm:order-2 sm:ml-auto">
              {totalPaid === 0 ? 'Choisir un mode' : `Reste ${formatFCFA(remaining)}`}
            </div>
          )}
          <button onClick={onClose} className="h-10 px-4 rounded-md border border-neutral-200 text-[13px] font-semibold text-neutral-700 hover:border-neutral-400 transition-colors order-2 sm:order-1" disabled={paying}>
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}
