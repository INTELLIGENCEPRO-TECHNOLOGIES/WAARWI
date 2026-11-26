import './Billing.css';
import { useSalePrice, type PriceLine } from '../lib/useSalePrice';
import { formatVatAmount } from '../lib/salesVat';
import { loadInvoiceReturnLines } from '../lib/saleReturnLines';
import { newIdempotencyKey } from '../lib/cashSession';
import type { VatAmounts } from '../lib/salesVat';
import { useRealtimeTick } from '../lib/useRealtimeData';
import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useStickyOffset } from '../lib/useStickyOffset';
import { createPortal } from 'react-dom';
import { Plus, FileText, Loader2, Printer, CheckCircle, X, Receipt, RotateCcw, Wallet, Filter, Calendar, User, CreditCard, ArrowRight, Coins, MessageCircle, Link2, Search, FilePlus, ShieldCheck, ChevronLeft, ChevronRight, RefreshCw, Ban, ClipboardList } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getOperationalCashContext, missingSessionMessage } from '../lib/cashSession';
import { useApp } from '../context/AppContext';
import { usePermissions } from '../lib/permissions';
import { useToast } from '../context/ToastContext';
import { Modal, ConfirmDialog } from '../components/Modal';
import { useTopLayer } from '../components/modalStack';
import { PremiumDateRangePicker } from '../components/PremiumDateRangePicker';
import { EmptyState } from '../components/EmptyState';
import { VehicleArticlePicker } from '../components/VehicleArticlePicker';
import { isAutoParts } from '../lib/types';
import { formatFCFA, formatDate, formatDateTime } from '../lib/format';
import { printDocumentA4, buildPrintTenantForSite, type PrintTenant } from '../lib/print';
import { consumeNavContext } from '../lib/navHighlight';
import { DocItems, DocTotals, DocSectionTitle, DocSlimHeader } from '../components/DocLayout';
import { calculerIpm, parseConvention, validerDocumentsIpm, type IpmArticleLine, type IpmDocuments as IpmDocsType } from '../lib/ipm';
import type { DocItem, DocStatusConfig } from '../components/DocLayout';
import { MobileBillingWizard } from '../components/MobileBillingWizard';
import { MobileInvoiceDetail } from '../components/MobileInvoiceDetail';
import { BillingReturnFields, MobileReturnScreen, MobileReturnDetail, type ReturnLine } from '../components/billing/BillingReturnFlow';
import { LotPickerModal, type ArticleLotSelection } from '../components/LotPickerModal';
import { type DocSettings, DEFAULT_DOC_SETTINGS, mergeColumns } from '../components/DocumentSettingsTab';
import { QuickCreateArticleModal, QuickCreateCustomerModal } from '../components/QuickCreate';
import { type SalesRepresentative, type RepCommissionSettings, DEFAULT_REP_SETTINGS, computeRepCommission, repDisplayName } from '../lib/repCommission';
import { DocumentEditor } from '../components/DocumentEditor';
import { DesktopWindow } from '../components/DesktopWindow';
import {useLockedQuoteSnapshot,quoteSnapshotForm,readQuoteActionSnapshot,type QuoteBaseline,type LockedQuoteSnapshot} from '../lib/useLockedQuoteSnapshot';
import {Pencil} from '../components/Icons';
import {useDocumentEditLease} from '../lib/useDocumentEditLease';
import {useLockedInvoiceSnapshot,invoiceSnapshotForm,type InvoiceBaseline} from '../lib/useLockedInvoiceSnapshot';
import {DocumentEditLeaseBar} from '../components/DocumentEditLeaseBar';
import {InvoiceEditSnapshotBar} from '../components/InvoiceEditSnapshotBar';
import { InvoiceEditorInstance, type InvoiceWindowDescriptor } from '../components/billing/InvoiceEditorInstance';
import { QuoteEditorInstance, type QuoteWindowDescriptor } from '../components/billing/QuoteEditorInstance';
import { useWindowManager } from '../context/WindowManagerContext';
import { loadLayout, saveLayout, clearFormDraft, type LayoutWindow } from '../lib/draftRecovery';

const tenantForPrint = (t: any, site?: any): PrintTenant => buildPrintTenantForSite(t, site);

type Tab = 'quotes' | 'invoices' | 'returns' | 'credits';

type Quote = {
  id: string; quote_number: string; total: number; subtotal: number; discount: number;
  status: string; created_at: string; valid_until: string | null; note: string;
  converted_sale_id: string | null; customer_id: string | null;
  user_id?: string | null;
  representative_id?: string | null;
  customers: { name: string } | null;
  doc_header?: { delivery_date?: string; reference?: string; warranty?: string; representative?: string; imei?: string } | null;
};
type QuoteItem = {
  id?: string; article_id: string | null; name: string;
  quantity: number; unit_price: number; discount: number; total: number;
  tier_name?: string; ipm_eligible?: boolean;
};
type Invoice = VatAmounts & {
  discount?: number;
  id: string; sale_number: string; total: number; paid: number; status: string;
  customer_id: string | null;
  created_at: string;
  public_code?: string | null;
  accounting_status?: string;
  user_id?: string | null;
  representative_id?: string | null;
  rep_commission?: any;
  customers: { name: string; phone?: string; address?: string } | null;
};
type SaleReturn = VatAmounts & {
  vat_entry_id?: string | null;
  sale_id?: string;
  id: string; return_number: string; total: number; status: string;
  refund_method: string; reason: string; restock: boolean;
  credit_used?: number; customer_id: string | null;
  created_at: string; refunded_at?: string | null;
  customers: { name: string } | null;
  sales: { sale_number: string } | null;
};

const QUOTE_STATUS: Record<string, { label: string; pill: string; dot: string }> = {
  draft:     { label: 'Brouillon', pill: 'text-slate-500', dot: '' },
  sent:      { label: 'Envoyé',    pill: 'text-neutral-700', dot: '' },
  accepted:  { label: 'Accepté',   pill: 'text-emerald-600', dot: '' },
  rejected:  { label: 'Refusé',    pill: 'text-red-600', dot: '' },
  converted: { label: 'Converti',  pill: 'text-brand-600', dot: '' },
  expired:   { label: 'Expiré',    pill: 'text-amber-600', dot: '' },
};

function invoiceStatus(s: Invoice) {
  if (s.status === 'cancelled') return { label: 'Annulée', pill: 'text-red-600', dot: '' };
  if (s.paid >= s.total)        return { label: 'Payée', pill: 'text-emerald-600', dot: '' };
  if (Number(s.paid) > 0)       return { label: 'Partiellement payée', pill: 'text-amber-600', dot: '' };
  if (s.status === 'validated' && Number(s.paid) === 0) return { label: 'À crédit', pill: 'text-slate-600', dot: '' };
  return { label: 'Validée', pill: 'text-neutral-700', dot: '' };
}

const RETURN_STATUS: Record<string, { label: string; pill: string; dot: string }> = {
  pending:  { label: 'À traiter', pill: 'text-amber-600', dot: '' },
  approved: { label: 'Approuvé',  pill: 'text-emerald-600', dot: '' },
  rejected: { label: 'Rejeté',    pill: 'text-red-600', dot: '' },
};

function creditStatus(r: SaleReturn) {
  if (r.status !== 'approved') return RETURN_STATUS[r.status] || RETURN_STATUS.pending;
  const used = Number(r.credit_used || 0);
  if (used >= Number(r.total)) return { label: 'Utilisé', pill: 'text-slate-500', dot: '' };
  if (used > 0) return { label: 'Partiel', pill: 'text-amber-600', dot: '' };
  return { label: 'Disponible', pill: 'text-emerald-600', dot: '' };
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'invoices', label: 'Factures' },
  { key: 'quotes',   label: 'Devis'    },
  { key: 'returns',  label: 'Retours'  },
  { key: 'credits',  label: 'Avoirs'   },
];

export function Billing({ visible = true, onNavigate }: { visible?: boolean; onNavigate?: (r: string) => void }) {
  const { tenant, currentSite, depots, profile, user } = useApp();
  const dataTick = useRealtimeTick(['sales', 'sale_items', 'sale_payments', 'sale_returns', 'quotes', 'quote_items', 'customers', 'articles', 'stock_levels', 'document_settings']);
  const { can } = usePermissions();
  const autoMode = isAutoParts(tenant);
  const { success, error } = useToast();

  const [tab, setTabRaw] = useState<Tab>('invoices');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [tabError, setTabError] = useState<string | null>(null);

  const switchTab = useCallback((t: Tab) => {
    setTabRaw(t);
    setSearch('');
    setDebouncedSearch('');
    setStatusFilter('');
    setBillPage(0);
    setBillCursors([]);
    setTabError(null);
  }, []);
  const [customerFilter, setCustomerFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Data
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [returns, setReturns] = useState<SaleReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Server pagination state
  const PAGE_SIZE = 50;
  const [billPage, setBillPage] = useState(0);
  const [billHasMore, setBillHasMore] = useState(false);
  const [billCursors, setBillCursors] = useState<{ val: string | null; id: string | null }[]>([]);
  const [billTotalCount, setBillTotalCount] = useState(0);
  const [tabCounts, setTabCounts] = useState<Record<Tab, number>>({ invoices: 0, quotes: 0, returns: 0, credits: 0 });
  const [, setBillTotals] = useState<any>({});
  const billReqIdRef = useRef(0);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const billSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [customers, setCustomers] = useState<any[]>([]);
  const [articles, setArticles] = useState<any[]>([]);
  const [articleTiers, setArticleTiers] = useState<{ article_id: string; tier_name: string; price: number }[]>([]);
  const [tierPickerOpen, setTierPickerOpen] = useState(false);
  const [tierPickerArticle, setTierPickerArticle] = useState<any>(null);
  const [tierPickerTarget, setTierPickerTarget] = useState<'invoice' | 'quote'>('invoice');
  const [tierPickerIdx, setTierPickerIdx] = useState<number | null>(null);
  const [billSourceSiteId, setBillSourceSiteId] = useState<string>('');
  const [sales, setSales] = useState<any[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [salesReps, setSalesReps] = useState<SalesRepresentative[]>([]);
  const [repSettings, setRepSettings] = useState<RepCommissionSettings>(DEFAULT_REP_SETTINGS);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});

  // Quote modals — mobile uses single state; desktop uses quoteWindows map
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [, setQuoteEditorMode] = useState<'create' | 'edit' | 'view'>('create');
  const [quoteDetail, setQuoteDetail] = useState<Quote | null>(null);
  const [quoteItemsDetail, setQuoteItemsDetail] = useState<any[]>([]);
  const [quoteForm, setQuoteForm] = useState<{ customer_id: string; valid_until: string; note: string; delivery_date: string; reference: string; warranty: string; representative: string; imei: string }>({ customer_id: '', valid_until: '', note: '', delivery_date: '', reference: '', warranty: '', representative: '', imei: '' });
  const [quoteItems, setQuoteItems] = useState<QuoteItem[]>([{ article_id: null, name: '', quantity: 1, unit_price: 0, discount: 0, total: 0 }]);
  const [quoteToCancel, setQuoteToCancel] = useState<Quote | null>(null);
  const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false);
  const [vehiclePickerTargetIdx, setVehiclePickerTargetIdx] = useState<number | null>(null);
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [quoteBaseline,setQuoteBaseline]=useState<QuoteBaseline|null>(null);
  const [quoteViewBaseline,setQuoteViewBaseline]=useState<QuoteBaseline|null>(null);
  const quoteOriginal=useRef<string|null>(null);
  const quoteEditSite=useRef<string|null>(null);
  const quoteSavingRef=useRef(false);
  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024;
  const [stickyTopRef, stickyTop] = useStickyOffset<HTMLDivElement>();

  // Multi-instance quote windows (desktop)
  const [quoteWindows, setQuoteWindows] = useState<Map<string, QuoteWindowDescriptor>>(new Map());
  const quoteWindowCounter = useRef(0);
  // Callback ref for vehicle picker / tier picker targeting in quote windows
  const activeQuoteItemsSetter = useRef<((fn: any) => void) | null>(null);

  // IPM for quotes (pharmacy only) — mobile path only
  const [quoteIpmBeneficiaire, setQuoteIpmBeneficiaire] = useState<any>(null);
  const [quoteIpmConvention, setQuoteIpmConvention] = useState<any>(null);
  const quoteIpmConfig = useMemo(() => parseConvention(quoteIpmConvention), [quoteIpmConvention]);

  // Conversion modal
  const [convertFrom, setConvertFrom] = useState<Quote | null>(null);
  const [convertPayNow, setConvertPayNow] = useState(false);
  const [convertPayMethod, setConvertPayMethod] = useState('');
  const [convertPayAmount, setConvertPayAmount] = useState('');
  const [converting, setConverting] = useState(false);
  const [convertItems, setConvertItems] = useState<(PriceLine & { name: string })[]>([]);
  const [lotPickerConvertOpen, setLotPickerConvertOpen] = useState(false);
  const stockMethod = (tenant as any)?.settings?.stock_method || 'none';

  // Quick-create modals
  const [quickArticleOpen, setQuickArticleOpen] = useState(false);
  const [quickArticleName, setQuickArticleName] = useState('');
  const [quickCustomerOpen, setQuickCustomerOpen] = useState(false);
  const [quickCustomerName, setQuickCustomerName] = useState('');

  // IPM for conversion
  const [convertIpmBeneficiaire, setConvertIpmBeneficiaire] = useState<any>(null);
  const [convertIpmConvention, setConvertIpmConvention] = useState<any>(null);
  const [convertIpmDocs, setConvertIpmDocs] = useState<IpmDocsType>({ numero_ordonnance: '', medecin: '', numero_bon: '' });

  // Invoice detail + payment
  const [invoiceDetail, setInvoiceDetail] = useState<Invoice | null>(null);
  const [accountingBusy, setAccountingBusy] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const payLayer = useTopLayer(payOpen);
  useEffect(() => {
    if (!payOpen) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && payLayer.isTop) setPayOpen(false); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [payOpen, payLayer.isTop]);
  const [payMethod, setPayMethod] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [paying, setPaying] = useState(false);
  const payingRef = useRef(false);

  // Apply credit
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditSelected, setCreditSelected] = useState<string>('');
  const [creditAmount, setCreditAmount] = useState('');
  const [applyingCredit, setApplyingCredit] = useState(false);
  const [applyCreditError, setApplyCreditError] = useState<string | null>(null);

  // Return modals
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnMode, setReturnMode] = useState<'return' | 'avoir'>('return');
  const [returnDetail, setReturnDetail] = useState<SaleReturn | null>(null);
  const [returnItemsDetail, setReturnItemsDetail] = useState<any[]>([]);
  const [returnEditorOpen, setReturnEditorOpen] = useState(false);
  const vatReturnAttempt = useRef<{ payload: string; key: string } | null>(null);
  const [returnForm, setReturnForm] = useState({ sale_id: '', reason: '', restock: true });
  const [returnOrigin, setReturnOrigin] = useState<Invoice | null>(null);
  const [returnLoad, setReturnLoad] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [returnDetailLoad, setReturnDetailLoad] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [returnError, setReturnError] = useState<string | null>(null);
  const [returnDetailError, setReturnDetailError] = useState<string | null>(null);
  const returnLinesRequest = useRef(0);
  const returnDetailRequest = useRef(0);
  const [returnLines, setReturnLines] = useState<ReturnLine[]>([]);
  const [returnWorkflowBusy, setReturnWorkflowBusy] = useState(false);
  const [returnCashConfirmOpen, setReturnCashConfirmOpen] = useState(false);

  // Multi-instance invoice windows (desktop)
  const [invoiceWindows, setInvoiceWindows] = useState<Map<string, InvoiceWindowDescriptor>>(new Map());
  const invoiceWindowCounter = useRef(0);
  const { windows: wmWindows, tileVisibleWindows, focus: focusWindow, updateTitle: updateWindowTitle, minimize: minimizeWindow, minimizeGroup, restore: restoreWindow } = useWindowManager();
  const [pageWindowOpen, setPageWindowOpen] = useState(true);
  const BILLING_PAGE_ID = 'billing-page';
  const BILLING_GROUP = 'billing';

  const userId = profile?.id || user?.id || '';
  const billingScope = useMemo(
    () => ({ userId, tenantId: tenant?.id || '', siteId: currentSite?.id || '' }),
    [userId, tenant?.id, currentSite?.id],
  );
  const [pendingRecovery, setPendingRecovery] = useState<LayoutWindow[] | null>(null);
  const [pendingBillSourceSiteId, setPendingBillSourceSiteId] = useState<string | null>(null);
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const recoveryOfferedRef = useRef<string>('');

  useEffect(() => {
    if (!isDesktop) return;
    if (!billingScope.userId || !billingScope.tenantId || !billingScope.siteId) return;
    const key = `${billingScope.userId}|${billingScope.tenantId}|${billingScope.siteId}`;
    if (recoveryOfferedRef.current === key) return;
    recoveryOfferedRef.current = key;
    const layout = loadLayout('billing', billingScope);
    const matching = layout ? layout.windows.filter(w => w.kind === 'invoice' || w.kind === 'quote') : [];
    if (matching.length > 0) {
      setPendingRecovery(matching);
      if (layout?.billSourceSiteId) setPendingBillSourceSiteId(layout.billSourceSiteId);
    } else setRecoveryChecked(true);
  }, [isDesktop, billingScope.userId, billingScope.tenantId, billingScope.siteId]);

  const acceptBillingRecovery = useCallback(() => {
    if (!pendingRecovery) return;
    // Advance window counters past any restored ids so newly opened windows
    // never collide with a restored `inv-new-N` or `quote-N`.
    for (const w of pendingRecovery) {
      const mi = /^inv-new-(\d+)$/.exec(w.windowId);
      if (mi) invoiceWindowCounter.current = Math.max(invoiceWindowCounter.current, Number(mi[1]));
      const mq = /^quote-(\d+)$/.exec(w.windowId);
      if (mq) quoteWindowCounter.current = Math.max(quoteWindowCounter.current, Number(mq[1]));
    }
    setInvoiceWindows(prev => {
      const m = new Map(prev);
      for (const w of pendingRecovery) {
        if (w.kind !== 'invoice') continue;
        const desc = w.descriptor as InvoiceWindowDescriptor;
        if (!desc || m.has(w.windowId)) continue;
        if (desc.siteId && desc.siteId !== billingScope.siteId) continue;
        m.set(w.windowId, desc);
      }
      return m;
    });
    setQuoteWindows(prev => {
      const m = new Map(prev);
      for (const w of pendingRecovery) {
        if (w.kind !== 'quote') continue;
        const desc = w.descriptor as QuoteWindowDescriptor;
        if (!desc || m.has(w.windowId)) continue;
        if (desc.siteId && desc.siteId !== billingScope.siteId) continue;
        m.set(w.windowId, desc);
      }
      return m;
    });
    // Restore the "Stock depuis" depot chosen before the reload rather than
    // silently keeping whatever is currently active.
    if (pendingBillSourceSiteId) setBillSourceSiteId(pendingBillSourceSiteId);
    setPendingBillSourceSiteId(null);
    setPendingRecovery(null);
    setRecoveryChecked(true);
  }, [pendingRecovery, pendingBillSourceSiteId, billingScope.siteId]);

  const dismissBillingRecovery = useCallback(() => {
    if (pendingRecovery) {
      for (const w of pendingRecovery) clearFormDraft(billingScope, w.windowId);
    }
    setPendingBillSourceSiteId(null);
    setPendingRecovery(null);
    setRecoveryChecked(true);
    saveLayout('billing', { scope: billingScope, pageWindowOpen: true, windows: [] });
  }, [pendingRecovery, billingScope]);
  const prevRouteRef = useRef<string | null>(null);
  // Auto-minimize billing-module windows only when navigating away; restore page on return
  const prevVisible = useRef(visible);
  useEffect(() => {
    if (prevVisible.current && !visible && isDesktop) minimizeGroup(BILLING_GROUP);
    if (!prevVisible.current && visible && isDesktop) {
      if (!pageWindowOpen) setPageWindowOpen(true);
      else restoreWindow(BILLING_PAGE_ID);
    }
    prevVisible.current = visible;
  }, [visible]);

  // Track previous allowed route so closing the billing page can navigate back to it.
  useEffect(() => {
    if (!visible) prevRouteRef.current = null;
  }, [visible]);

  const closeBillingPage = useCallback(() => {
    setPageWindowOpen(false);
    // Leave billing route without closing any document windows.
    onNavigate?.(prevRouteRef.current && prevRouteRef.current !== 'billing' ? prevRouteRef.current : 'dashboard');
  }, [onNavigate]);

  // Clear all windows on tenant change
  const prevTenantId = useRef(tenant?.id);
  useEffect(() => {
    if (prevTenantId.current && tenant?.id !== prevTenantId.current) {
      setInvoiceWindows(new Map());
      setQuoteWindows(new Map());
    }
    prevTenantId.current = tenant?.id;
  }, [tenant?.id]);

  // Auto-minimize off-site windows when active site changes
  const prevSiteId = useRef(currentSite?.id);
  useEffect(() => {
    if (!currentSite?.id || currentSite.id === prevSiteId.current) { prevSiteId.current = currentSite?.id; return; }
    prevSiteId.current = currentSite.id;
    if (!isDesktop) return;
    for (const w of wmWindows) {
      if (w.siteId && w.siteId !== currentSite.id && !w.minimized) {
        minimizeWindow(w.id);
      }
    }
  }, [currentSite?.id, isDesktop]);

  const [cancelTarget, setCancelTarget] = useState<Invoice | null>(null);
  const cancelLayer = useTopLayer(!!cancelTarget);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelPaymentAction, setCancelPaymentAction] = useState<'keep_credit' | 'refund_cash' | 'none'>('none');
  const [invoiceSearchOpen, setInvoiceSearchOpen] = useState(false);
  const [invoiceSearchQuery, setInvoiceSearchQuery] = useState('');
  // Mobile-only singleton state (kept for !isDesktop path)
  const [mobileInvoiceOpen, setMobileInvoiceOpen] = useState(false);
  const [mobileInvoiceMode, setMobileInvoiceMode] = useState<'create' | 'edit' | 'view'>('create');
  const [mobileEditingInvoiceId, setMobileEditingInvoiceId] = useState<string | null>(null);
  const [invoiceForm, setInvoiceForm] = useState<{ customer_id: string; doc_date: string; delivery_date: string; reference: string; warranty: string; representative: string; imei: string }>({ customer_id: '', doc_date: new Date().toISOString().slice(0, 10), delivery_date: '', reference: '', warranty: '', representative: '', imei: '' });
  const [, setInvoicePostCreation] = useState<{ saleNumber: string; createdAt: string; createdBy: string } | null>(null);
  const [invoiceEditorItems, setInvoiceEditorItems] = useState<QuoteItem[]>([{ article_id: null, name: '', quantity: 1, unit_price: 0, discount: 0, total: 0 }]);
  const [invoicePayList, setInvoicePayList] = useState<{ method_id: string; method_name: string; amount: number; reference: string }[]>([]);
  const [invoiceIsCredit, setInvoiceIsCredit] = useState(false);
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [mobileInvoiceBaseline,setMobileInvoiceBaseline]=useState<InvoiceBaseline|null>(null);
  const mobileOriginalDraft=useRef<string|null>(null);
  const mobileEditSite=useRef<string|null>(null);
  const mobileEditEnabled=visible&&!isDesktop&&mobileInvoiceOpen&&mobileInvoiceMode==='edit'&&!!mobileEditingInvoiceId&&mobileEditSite.current===currentSite?.id&&can('edit_invoices');
  const mobileDirty=mobileInvoiceMode==='edit'&&mobileOriginalDraft.current!==JSON.stringify([invoiceForm,invoiceEditorItems]);
  const mobileLease=useDocumentEditLease({tenantId:tenant?.id,userId:profile?.id||user?.id,kind:'sale',resource:mobileEditingInvoiceId||'',enabled:mobileEditEnabled,dirty:mobileDirty,saving:savingInvoice});
  const mobileSnapshot=useLockedInvoiceSnapshot({tenantId:tenant?.id,saleId:mobileEditingInvoiceId,lease:mobileLease,enabled:mobileEditEnabled,baseline:mobileInvoiceBaseline,preserveDraft:false,hydrate:s=>{const f=invoiceSnapshotForm(s);setInvoiceForm(f);setInvoiceEditorItems(s.items);setInvoicePayList([]);setInvoiceIsCredit(s.sale.status==='validated'&&Number(s.sale.paid)===0);setInvoiceDetail(old=>({...old,...s.sale} as Invoice));mobileOriginalDraft.current=JSON.stringify([f,s.items]);},onBaseline:setMobileInvoiceBaseline});
  const mobileEditBlocked=mobileInvoiceMode==='edit'&&(!mobileLease.held||!mobileSnapshot.ready);
  const editingInvoicePrevRep = useRef<string | null>(null);
  const [invoiceNavIdx, setInvoiceNavIdx] = useState(-1);

  // IPM (pharmacy only)
  const isPharmacy = (tenant?.business_activity_type_name || '').toLowerCase() === 'pharmacie';
  const [ipmBeneficiaire, setIpmBeneficiaire] = useState<any>(null);
  const [ipmConvention, setIpmConvention] = useState<any>(null);
  const [, setIpmLoading] = useState(false);

  useEffect(() => {
    if (!isPharmacy || !invoiceForm.customer_id || !tenant) {
      setIpmBeneficiaire(null);
      setIpmConvention(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setIpmLoading(true);
      const { data } = await supabase
        .from('ipm_beneficiaires')
        .select('*, ipm_organismes(nom), ipm_conventions(nom, taux_defaut, plafond_facture, mode_calcul, mode_arrondi, application_plafond, ordonnance_obligatoire, bon_prise_en_charge_obligatoire, numero_bon_obligatoire, numero_ordonnance_obligatoire, medecin_prescripteur_obligatoire, matricule_obligatoire)')
        .eq('tenant_id', tenant.id)
        .eq('customer_id', invoiceForm.customer_id)
        .eq('statut', 'actif')
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setIpmBeneficiaire(data);
        setIpmConvention(data.ipm_conventions);
      } else {
        setIpmBeneficiaire(null);
        setIpmConvention(null);
      }
      setIpmLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isPharmacy, invoiceForm.customer_id, tenant?.id]);

  const ipmConfig = useMemo(() => parseConvention(ipmConvention), [ipmConvention]);
  const ipmTaux = ipmConfig?.taux_defaut || 0;
  const invoiceEditorSubtotalRaw = useMemo(() => invoiceEditorItems.filter(i => i.name.trim()).reduce((s, i) => s + Number(i.total), 0), [invoiceEditorItems]);
  const invoicePricing = useSalePrice(mobileInvoiceOpen && mobileInvoiceMode === 'create' ? currentSite?.id : null,
    invoiceEditorItems.filter(i => i.name.trim()));
  const convertPricing = useSalePrice(convertFrom ? billSourceSiteId || currentSite?.id : null, convertItems, Number(convertFrom?.discount ?? 0));
  const convertTtc = convertPricing.price?.ttc ?? 0;

  useEffect(() => {
    if (!convertPayNow && convertPricing.price) setConvertPayAmount(String(convertPricing.price.ttc));
  }, [convertPayNow, convertPricing.price]);

  const ipmResult = useMemo(() => {
    if (!ipmBeneficiaire || !ipmConfig) return null;
    const lignes: IpmArticleLine[] = invoiceEditorItems.filter(i => i.name.trim()).map(i => ({
      montant_ligne: Number(i.total),
      ipm_eligible: i.ipm_eligible !== false,
    }));
    return calculerIpm(ipmConfig, lignes, 0);
  }, [ipmBeneficiaire, ipmConfig, invoiceEditorItems]);
  const ipmPartIpm = ipmResult?.part_ipm || 0;
  const ipmPartClient = ipmBeneficiaire ? invoiceEditorSubtotalRaw - ipmPartIpm : invoiceEditorSubtotalRaw;

  // IPM document state
  const [ipmDocuments, setIpmDocuments] = useState<IpmDocsType>({ numero_ordonnance: '', medecin: '', numero_bon: '' });
  const ipmDocValidation = useMemo(() => {
    if (!ipmBeneficiaire || !ipmConfig) return { valide: true, champs_manquants: [] };
    return validerDocumentsIpm(ipmConfig, ipmDocuments, ipmBeneficiaire?.matricule);
  }, [ipmBeneficiaire, ipmConfig, ipmDocuments]);

  // Quote IPM lookup
  useEffect(() => {
    if (!isPharmacy || !quoteForm.customer_id || !tenant) {
      setQuoteIpmBeneficiaire(null);
      setQuoteIpmConvention(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('ipm_beneficiaires')
        .select('*, ipm_organismes(nom), ipm_conventions(nom, taux_defaut, plafond_facture, mode_calcul, mode_arrondi, application_plafond, ordonnance_obligatoire, bon_prise_en_charge_obligatoire, numero_bon_obligatoire, numero_ordonnance_obligatoire, medecin_prescripteur_obligatoire, matricule_obligatoire)')
        .eq('tenant_id', tenant.id)
        .eq('customer_id', quoteForm.customer_id)
        .eq('statut', 'actif')
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setQuoteIpmBeneficiaire(data);
        setQuoteIpmConvention(data.ipm_conventions);
      } else {
        setQuoteIpmBeneficiaire(null);
        setQuoteIpmConvention(null);
      }
    })();
    return () => { cancelled = true; };
  }, [isPharmacy, quoteForm.customer_id, tenant?.id]);

  // Document settings
  const [docSettings, setDocSettings] = useState<DocSettings>(DEFAULT_DOC_SETTINGS);
  const [quoteDocSettings, setQuoteDocSettings] = useState<DocSettings>(DEFAULT_DOC_SETTINGS);

  const [saving, setSaving] = useState(false);
  const quoteEditEnabled=visible&&!isDesktop&&quoteOpen&&!!editingQuoteId&&quoteEditSite.current===currentSite?.id&&can('edit_quotes');
  const quoteDirty=!!editingQuoteId&&quoteOriginal.current!==JSON.stringify([quoteForm,quoteItems]);
  const quoteLease=useDocumentEditLease({tenantId:tenant?.id,userId:profile?.id||user?.id,kind:'quote',resource:editingQuoteId||'',enabled:quoteEditEnabled,dirty:quoteDirty,saving});
  const quoteSnapshot=useLockedQuoteSnapshot({tenantId:tenant?.id,quoteId:editingQuoteId,lease:quoteLease,enabled:quoteEditEnabled,baseline:quoteBaseline,preserveDraft:false,hydrate:s=>{const f=quoteSnapshotForm(s),lines=s.items.map(i=>({...i,quantity:Number(i.quantity),unit_price:Number(i.unit_price),discount:Number(i.discount||0),total:Number(i.total)}));setQuoteForm(f);setQuoteItems(lines);quoteOriginal.current=JSON.stringify([f,lines]);},onBaseline:setQuoteBaseline});
  const quoteEditBlocked=!!editingQuoteId&&(!quoteLease.held||!quoteSnapshot.ready);

  // Debounce search
  useEffect(() => {
    if (billSearchTimer.current) clearTimeout(billSearchTimer.current);
    billSearchTimer.current = setTimeout(() => { setDebouncedSearch(search); setBillPage(0); setBillCursors([]); }, 250);
    return () => { if (billSearchTimer.current) clearTimeout(billSearchTimer.current); };
  }, [search]);

  // Reset page when filters change
  useEffect(() => { setBillPage(0); setBillCursors([]); }, [statusFilter, customerFilter, dateFrom, dateTo, minAmount, maxAmount, tenant?.id, currentSite?.id, tab]);

  const loadTab = useCallback(async (pageNum: number, isRefresh = false) => {
    if (!tenant || !currentSite) return;
    const myReqId = ++billReqIdRef.current;
    if (isRefresh) setRefreshing(true);
    else if (pageNum === 0) setLoading(true);
    else setRefreshing(true);

    const siteId = currentSite.id;
    const cursor = pageNum > 0 && billCursors[pageNum - 1] ? billCursors[pageNum - 1] : { val: null, id: null };
    const searchParam = debouncedSearch || null;
    const statusParam = statusFilter || null;
    const custId = customerFilter || null;
    const dFrom = dateFrom ? new Date(dateFrom).toISOString() : null;
    const dTo = dateTo ? (() => { const d = new Date(dateTo); d.setDate(d.getDate() + 1); return d.toISOString(); })() : null;
    const minAmt = minAmount ? Number(minAmount) : null;
    const maxAmt = maxAmount ? Number(maxAmount) : null;

    let rpcName = '';
    let params: Record<string, any> = { p_tenant_id: tenant.id, p_site_id: siteId, p_page_size: PAGE_SIZE };

    if (tab === 'invoices') {
      rpcName = 'rpc_paginated_invoices';
      params = { ...params, p_search: searchParam, p_status_filter: statusParam, p_customer_id: custId, p_date_from: dFrom, p_date_to: dTo, p_min_amount: minAmt, p_max_amount: maxAmt };
      if (cursor.val && cursor.id) { params.p_cursor_created_at = cursor.val; params.p_cursor_id = cursor.id; }
    } else if (tab === 'quotes') {
      rpcName = 'rpc_paginated_quotes';
      params = { ...params, p_search: searchParam, p_status_filter: statusParam, p_customer_id: custId, p_date_from: dFrom, p_date_to: dTo, p_min_amount: minAmt, p_max_amount: maxAmt };
      if (cursor.val && cursor.id) { params.p_cursor_created_at = cursor.val; params.p_cursor_id = cursor.id; }
    } else {
      rpcName = 'rpc_paginated_returns';
      const refundMethod = tab === 'credits' ? 'avoir' : 'not_avoir';
      params = { ...params, p_search: searchParam, p_status_filter: statusParam, p_customer_id: custId, p_date_from: dFrom, p_date_to: dTo, p_min_amount: minAmt, p_max_amount: maxAmt, p_refund_method: refundMethod };
      if (cursor.val && cursor.id) { params.p_cursor_created_at = cursor.val; params.p_cursor_id = cursor.id; }
    }

    const { data, error: rpcErr } = await supabase.rpc(rpcName, params);
    if (myReqId !== billReqIdRef.current) return;

    if (rpcErr || !data) {
      setTabError(rpcErr?.message || 'Erreur de chargement');
      setLoading(false); setRefreshing(false); return;
    }
    setTabError(null);

    const rows = (data.rows || []) as any[];
    setBillTotalCount(data.total_count || 0);
    setBillTotals(data.totals || {});
    setBillHasMore(rows.length >= PAGE_SIZE);

    // Save cursor for next page
    if (rows.length > 0) {
      const last = rows[rows.length - 1];
      setBillCursors(prev => { const next = [...prev]; next[pageNum] = { val: last.created_at, id: last.id }; return next; });
    }

    // Transform rows to match existing types
    if (tab === 'invoices') {
      setInvoices(rows.map(r => ({ ...r, customers: r.customer_name ? { name: r.customer_name } : null })) as Invoice[]);
    } else if (tab === 'quotes') {
      setQuotes(rows.map(r => ({ ...r, customers: r.customer_name ? { name: r.customer_name } : null })) as Quote[]);
    } else {
      setReturns(rows.map(r => ({
        ...r,
        customers: r.customer_name ? { name: r.customer_name } : null,
        sales: r.sale_number ? { sale_number: r.sale_number } : null,
      })) as SaleReturn[]);
    }

    setLoading(false);
    setRefreshing(false);
  }, [tenant, currentSite, tab, debouncedSearch, statusFilter, customerFilter, dateFrom, dateTo, minAmount, maxAmount, billCursors]);

  useEffect(() => { loadTab(billPage); /* eslint-disable-next-line */ }, [billPage, tab, debouncedSearch, statusFilter, customerFilter, dateFrom, dateTo, minAmount, maxAmount, tenant?.id, currentSite?.id]);

  // Load counts for all tabs so the tab bar shows real numbers without
  // requiring the user to click each tab first.
  useEffect(() => {
    if (!tenant || !currentSite) return;
    const tenantId = tenant.id;
    const siteId = currentSite.id;
    let cancelled = false;
    (async () => {
      const base = { p_tenant_id: tenantId, p_site_id: siteId, p_page_size: 1 };
      const [inv, qte, ret, av] = await Promise.all([
        supabase.rpc('rpc_paginated_invoices', base),
        supabase.rpc('rpc_paginated_quotes',   base),
        supabase.rpc('rpc_paginated_returns',  { ...base, p_refund_method: 'not_avoir' }),
        supabase.rpc('rpc_paginated_returns',  { ...base, p_refund_method: 'avoir' }),
      ]);
      if (cancelled) return;
      setTabCounts({
        invoices: Number((inv.data as any)?.total_count || 0),
        quotes:   Number((qte.data as any)?.total_count || 0),
        returns:  Number((ret.data as any)?.total_count || 0),
        credits:  Number((av.data  as any)?.total_count || 0),
      });
    })();
    return () => { cancelled = true; };
  }, [tenant?.id, currentSite?.id, dataTick]);

  useEffect(() => { if (dataTick > 0) { const t = setTimeout(() => loadTab(billPage, true), 400); return () => clearTimeout(t); } /* eslint-disable-next-line */ }, [dataTick]);

  // Load document settings (per doc type)
  useEffect(() => {
    if (!tenant) return;
    const parseSettings = (data: any): DocSettings => ({
      show_delivery_date:  data.show_delivery_date  ?? false,
      show_reference:      data.show_reference      ?? false,
      show_warranty:       data.show_warranty       ?? false,
      show_imei:           data.show_imei           ?? false,
      show_representative: data.show_representative ?? false,
      default_representative: data.default_representative ?? '',
      require_header_lock: data.require_header_lock ?? false,
      allow_edit:          data.allow_edit          ?? false,
      allow_delete:        data.allow_delete        ?? false,
      warranty_terms:      data.warranty_terms      ?? '',
      columns_config:      mergeColumns(data.columns_config ?? []),
    });
    supabase.from('document_settings').select('*').eq('tenant_id', tenant.id).in('doc_type', ['invoice', 'quote']).then(({ data }) => {
      if (!data) return;
      const inv = data.find((r: any) => r.doc_type === 'invoice');
      const quo = data.find((r: any) => r.doc_type === 'quote');
      if (inv) setDocSettings(parseSettings(inv));
      if (quo) setQuoteDocSettings(parseSettings(quo));
    });
  }, [tenant?.id]);

  const pendingNavRef = useRef<string | null>(null);
  useEffect(() => {
    const ctx = consumeNavContext();
    if (!ctx?.target) return;
    pendingNavRef.current = ctx.target;
    if (ctx.target === 'quotes') setTabRaw('quotes');
    else if (ctx.target === 'returns') setTabRaw('returns');
  }, []);

  useEffect(() => {
    if (!tenant || !currentSite) return;
    const isShared = (tenant as any)?.settings?.shared_articles !== false;
    const isSharedCust = (tenant as any)?.settings?.shared_customers !== false;
    let custQuery = supabase.from('customers').select('id, name, phone, address').eq('tenant_id', tenant.id).eq('is_active', true).order('name');
    if (!isSharedCust && currentSite) {
      custQuery = custQuery.eq('site_id', currentSite.id);
    }
    const fetchAllArticles = async () => {
      const all: any[] = [];
      const pageSize = 1000;
      let from = 0;
      while (true) {
        let q = supabase.from('articles').select('id, name, sale_price, internal_ref, ipm_eligible, track_stock, category_id').eq('tenant_id', tenant.id).eq('is_active', true).order('name').range(from, from + pageSize - 1);
        if (!isShared && currentSite) q = q.eq('site_id', currentSite.id);
        const { data } = await q;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }
      return all;
    };
    Promise.all([
      custQuery,
      fetchAllArticles(),
      supabase.from('sales').select('id, sale_number, customer_id, total, paid, status, user_id, customers(name, phone, address)').eq('tenant_id', tenant.id).eq('site_id', currentSite.id).neq('status', 'cancelled').is('deleted_at', null).order('created_at', { ascending: false }).limit(200),
      supabase.from('payment_methods').select('id, name, code, payment_type').eq('tenant_id', tenant.id).eq('is_active', true).order('sort_order'),
      supabase.from('article_pricing_tiers').select('article_id, tier_name, price').eq('tenant_id', tenant.id).order('sort_order'),
      supabase.from('sales_representatives').select('*').eq('tenant_id', tenant.id).order('code'),
      supabase.from('rep_commission_settings').select('enabled, commission_type, commission_base, rate, fixed_amount').eq('tenant_id', tenant.id).maybeSingle(),
      supabase.from('profiles').select('id, full_name, email').eq('tenant_id', tenant.id),
    ]).then(([c, a, sl, pm, tr, reps, rcs, profs]) => {
      setCustomers(c.data || []);
      setArticles(a as any[]);
      setSales((sl.data as any) || []);
      setPaymentMethods((pm.data || []).filter((m: any) => m.payment_type !== 'credit'));
      setArticleTiers((tr.data || []) as { article_id: string; tier_name: string; price: number }[]);
      setSalesReps((reps.data as any) || []);
      if (rcs.data) {
        setRepSettings({
          enabled: rcs.data.enabled === true,
          commission_type: rcs.data.commission_type || 'pct_ca',
          commission_base: rcs.data.commission_base || 'ttc',
          rate: Number(rcs.data.rate || 0),
          fixed_amount: Number(rcs.data.fixed_amount || 0),
        });
      }
      const pmap: Record<string, string> = {};
      for (const p of (profs.data || [])) pmap[p.id] = p.full_name || p.email || '';
      setProfileNames(pmap);
    });
  }, [tenant?.id, currentSite?.id]);

  // Reload stock levels when the source site ("Stock depuis") changes
  useEffect(() => {
    if (!tenant || !currentSite) return;
    const stockSiteId = billSourceSiteId || currentSite.id;
    let cancelled = false;
    const fetchStock = async () => {
      let all: any[] = [];
      let from = 0;
      while (true) {
        const { data, error: e } = await supabase.from('stock_levels')
          .select('article_id, quantity')
          .eq('tenant_id', tenant.id).eq('site_id', stockSiteId)
          .range(from, from + 999);
        if (e || !data) break;
        all = all.concat(data);
        if (data.length < 1000) break;
        from += 1000;
      }
      if (cancelled) return;
      const stockMap = new Map(all.map((r: any) => [r.article_id, Number(r.quantity)]));
      setArticles(prev => prev.map(art => ({
        ...art,
        stock_quantity: stockMap.get(art.id) ?? 0,
      })));
    };
    fetchStock();
    return () => { cancelled = true; };
  }, [tenant?.id, billSourceSiteId, currentSite?.id]);

  const activeReps = useMemo(() => salesReps.filter(r => r.status === 'actif'), [salesReps]);
  const repById = useCallback((id?: string | null) => salesReps.find(r => r.id === id) || null, [salesReps]);
  const repLabelOf = useCallback((id?: string | null) => {
    const r = repById(id);
    return r ? repDisplayName(r) : null;
  }, [repById]);
  const creatorName = useCallback((userId?: string | null) => {
    if (!userId) return 'Utilisateur non renseigné';
    if (profile && userId === profile.id) return profile.full_name || profile.email || 'Utilisateur non renseigné';
    return profileNames[userId] || 'Utilisateur non renseigné';
  }, [profileNames, profile]);

  const computeItemsMargin = async (items: QuoteItem[]): Promise<number> => {
    const ids = items.filter(i => i.article_id).map(i => i.article_id!) as string[];
    const pmap = new Map<string, number>();
    if (ids.length > 0) {
      const { data } = await supabase.from('articles').select('id, purchase_price').in('id', ids);
      for (const a of (data || [])) pmap.set(a.id, Number((a as any).purchase_price || 0));
    }
    return items.reduce((s, i) => s + (Number(i.total || 0) - (pmap.get(i.article_id || '') || 0) * Number(i.quantity || 0)), 0);
  };

  const buildRepSnapshot = async (repId: string | null | undefined, items: QuoteItem[], subtotal: number) => {
    const rep = repById(repId);
    if (!rep || !repSettings.enabled) return null;
    const needsMargin = repSettings.commission_base === 'marge' || repSettings.commission_type === 'pct_marge'
      || (rep.commission_override && (rep.commission_type === 'pct_marge' || rep.commission_base === 'marge'));
    const margin = needsMargin ? await computeItemsMargin(items) : 0;
    return computeRepCommission(rep, repSettings, { subtotal, net: subtotal, margin });
  };

  // ── Filtering helpers (now done server-side, these are no-ops for compatibility) ──
  

  const filteredQuotes = quotes;

  const filteredInvoices = invoices;

  const filteredReturns = returns.filter(x => x.refund_method !== 'avoir');

  const filteredCredits = returns.filter(x => x.refund_method === 'avoir');

  // ── Quote actions ────────────────────────────────────────────
  const addArticleWithTierCheck = (articleId: string, target: 'invoice' | 'quote') => {
    const art = articles.find(a => a.id === articleId);
    if (!art) return;
    const tiers = articleTiers.filter(t => t.article_id === articleId);
    if (tiers.length > 1) {
      setTierPickerArticle(art);
      setTierPickerTarget(target);
      setTierPickerOpen(true);
      return;
    }
    const price = tiers.length === 1 ? tiers[0].price : (art.sale_price || 0);
    const tierName = tiers.length === 1 ? tiers[0].tier_name : undefined;
    const newItem: QuoteItem = { article_id: articleId, name: art.name, quantity: 1, unit_price: price, discount: 0, total: price, tier_name: tierName };
    if (target === 'invoice') setInvoiceEditorItems(p => [...p, newItem]);
    else setQuoteItems(p => [...p, newItem]);
  };

  const addArticleWithSelectedTier = (tierName: string, tierPrice: number) => {
    if (!tierPickerArticle) return;
    if (tierPickerIdx !== null) {
      const updateFn = (prev: QuoteItem[]) => {
        const next = [...prev];
        next[tierPickerIdx] = { ...next[tierPickerIdx], unit_price: tierPrice, tier_name: tierName || undefined };
        next[tierPickerIdx].total = Math.max(0, Number(next[tierPickerIdx].quantity || 1) * tierPrice - Number(next[tierPickerIdx].discount || 0));
        return next;
      };
      if (tierPickerTarget === 'invoice') setInvoiceEditorItems(updateFn);
      else if (activeQuoteItemsSetter.current) activeQuoteItemsSetter.current(updateFn);
      else setQuoteItems(updateFn);
    } else {
      const newItem: QuoteItem = { article_id: tierPickerArticle.id, name: tierPickerArticle.name, quantity: 1, unit_price: tierPrice, discount: 0, total: tierPrice, tier_name: tierName || undefined };
      if (tierPickerTarget === 'invoice') setInvoiceEditorItems(p => [...p, newItem]);
      else if (activeQuoteItemsSetter.current) activeQuoteItemsSetter.current((p: QuoteItem[]) => [...p, newItem]);
      else setQuoteItems(p => [...p, newItem]);
    }
    setTierPickerOpen(false);
    setTierPickerArticle(null);
    setTierPickerIdx(null);
  };

  const updateQuoteItem = (idx: number, field: keyof QuoteItem, val: any) => {
    if (field === 'article_id') {
      const art = articles.find(a => a.id === val);
      if (art) {
        const tiers = articleTiers.filter(t => t.article_id === val);
        if (tiers.length > 1) {
          setQuoteItems(prev => {
            const next = [...prev];
            next[idx] = { ...next[idx], article_id: val, name: art.name };
            if (!Number(next[idx].quantity) || Number(next[idx].quantity) < 1) next[idx].quantity = 1;
            return next;
          });
          setTierPickerArticle(art);
          setTierPickerTarget('quote');
          setTierPickerIdx(idx);
          setTierPickerOpen(true);
          return;
        }
      }
    }
    setQuoteItems(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      if (field === 'article_id') {
        const art = articles.find(a => a.id === val);
        if (art) {
          next[idx].name = art.name;
          next[idx].ipm_eligible = (art as any).ipm_eligible !== false;
          const tiers = articleTiers.filter(t => t.article_id === val);
          next[idx].unit_price = tiers.length === 1 ? tiers[0].price : art.sale_price;
          next[idx].tier_name = tiers.length === 1 ? tiers[0].tier_name : undefined;
          if (!Number(next[idx].quantity) || Number(next[idx].quantity) < 1) next[idx].quantity = 1;
        }
      }
      const it = next[idx];
      next[idx].total = Math.max(0, Number(it.quantity || 0) * Number(it.unit_price || 0) - Number(it.discount || 0));
      return next;
    });
  };
  
  const quoteSubtotal = quoteItems.reduce((s, i) => s + Number(i.total), 0);

  // Quote IPM calculation
  const quoteIpmResult = useMemo(() => {
    if (!quoteIpmBeneficiaire || !quoteIpmConfig) return null;
    const lignes: IpmArticleLine[] = quoteItems.filter(i => i.name.trim()).map(i => ({
      montant_ligne: Number(i.total),
      ipm_eligible: i.ipm_eligible !== false,
    }));
    return calculerIpm(quoteIpmConfig, lignes, 0);
  }, [quoteIpmBeneficiaire, quoteIpmConfig, quoteItems]);
  const quoteIpmPartIpm = quoteIpmResult?.part_ipm || 0;
  const quoteIpmTaux = quoteIpmConfig?.taux_defaut || 0;
  const quoteIpmPartClient = quoteIpmBeneficiaire ? quoteSubtotal - quoteIpmPartIpm : quoteSubtotal;

  const saveQuote = async (opts?: { silent?: boolean }) => {
    if (!tenant || !currentSite) { if (!opts?.silent) error('Magasin introuvable'); return; }
    if (quoteSavingRef.current||saving)return;
    if (!can(editingQuoteId?'edit_quotes':'create_quotes')) { if (!opts?.silent) error('Vous n\'avez pas la permission de créer des devis'); return; }
    if (quoteItems.every(i => !i.name.trim())) { if (!opts?.silent) error('Ajoutez au moins un article'); return; }
    if(editingQuoteId&&(!quoteLease.held||!quoteLease.token||!quoteSnapshot.ready||quoteBaseline?.quoteId!==editingQuoteId)){error('Reprenez l’accès et vérifiez la version du devis.');return;}
    quoteSavingRef.current=true;setSaving(true);
    const valid = quoteItems.filter(i => i.name.trim());
    const subtotal = valid.reduce((s, i) => s + Number(i.total), 0);
    const quoteRepLabel = repLabelOf(quoteForm.representative);
    const docHeader = (quoteForm.delivery_date || quoteForm.reference || quoteForm.warranty || quoteRepLabel || quoteForm.imei)
      ? { delivery_date: quoteForm.delivery_date || null, reference: quoteForm.reference || null, warranty: quoteForm.warranty || null, representative: quoteRepLabel, imei: quoteForm.imei || null }
      : null;

    if (editingQuoteId) {
      try{
        const {data,error:e}=await supabase.rpc('save_locked_quote_edit',{p_tenant_id:tenant.id,p_quote_id:editingQuoteId,p_window_id:quoteLease.windowId,p_lock_token:quoteLease.token,p_expected_version:quoteBaseline!.version,p_items:valid.map(i=>({article_id:i.article_id,name:i.name,quantity:i.quantity,unit_price:i.unit_price,discount:i.discount})),p_customer_id:quoteForm.customer_id||null,p_valid_until:quoteForm.valid_until||null,p_note:quoteForm.note,p_doc_header:docHeader,p_representative_id:quoteForm.representative||null,p_release:true});
        if(e){if(e.code==='40001')quoteSnapshot.retry();throw e;}
        if(!(data as LockedQuoteSnapshot&{success:boolean})?.success)throw new Error('Le devis n’a pas été enregistré.');
        success('Devis mis à jour');closeQuotePanel();loadTab(billPage,true);
      }catch(e){error(e&&typeof e==='object'&&'message' in e?String(e.message):'Enregistrement impossible.');}
      finally{quoteSavingRef.current=false;setSaving(false);}
    } else {
      const { data: numData } = await supabase.rpc('next_doc_number', {
        p_tenant_id: tenant.id, p_kind: 'quote', p_prefix: 'DEV',
      });
      const qNum = (numData as string) || ('DEV-' + Date.now());
      const { data: q, error: e } = await supabase.from('quotes').insert({
        tenant_id: tenant.id, site_id: currentSite.id,
        customer_id: quoteForm.customer_id || null,
        quote_number: qNum, subtotal, discount: 0, total: subtotal,
        valid_until: quoteForm.valid_until || null, note: quoteForm.note, status: 'draft',
        user_id: profile?.id || null,
        representative_id: quoteForm.representative || null,
        doc_header: docHeader,
      }).select().single();
      if (e || !q) { error(e?.message || 'Erreur'); quoteSavingRef.current=false;setSaving(false); return; }
      await supabase.from('quote_items').insert(valid.map(i => ({ tenant_id: tenant.id, quote_id: q.id, article_id: i.article_id, name: i.name, quantity: i.quantity, unit_price: i.unit_price, discount: i.discount, total: i.total })));
      setEditingQuoteId(q.id);
      quoteSavingRef.current=false;setSaving(false);
      if (!opts?.silent) {
        success('Devis créé');
        closeQuotePanel();
        const customer = customers.find(item => item.id === q.customer_id);
        void openQuoteDetail({ ...q, customers: customer ? { name: customer.name } : null });
        void loadTab(billPage, true);
      }
    }
  };

  

  const closeQuotePanel = () => {
    setQuoteOpen(false);
    setQuoteEditorMode('create');
    setEditingQuoteId(null);
    setQuoteBaseline(null);quoteOriginal.current=null;quoteEditSite.current=null;
    setQuoteItems([{ article_id: null, name: '', quantity: 1, unit_price: 0, discount: 0, total: 0 }]);
    setQuoteForm({ customer_id: '', valid_until: '', note: '', delivery_date: '', reference: '', warranty: '', representative: '', imei: '' });
  };

  // Desktop: open or restore a quote window
  const openDesktopQuoteWindow = (quoteId: string | null, mode: 'create' | 'edit' | 'view') => {
    if (quoteId) {
      const existing = Array.from(quoteWindows.values()).find(d => d.quoteId === quoteId);
      if (existing) { restoreWindow(existing.windowId); return; }
    }
    const wid = `quote-${++quoteWindowCounter.current}`;
    const desc: QuoteWindowDescriptor = { windowId: wid, quoteId, mode, siteId: currentSite?.id || '', tenantId: tenant?.id || '' };
    setQuoteWindows(prev => { const next = new Map(prev); next.set(wid, desc); return next; });
    if (quoteWindows.size + invoiceWindows.size >= 1) setTimeout(() => tileVisibleWindows(), 50);
  };
  const closeQuoteWindow = (windowId: string) => {
    clearFormDraft(billingScope, windowId);
    setQuoteWindows(prev => { const next = new Map(prev); next.delete(windowId); return next; });
  };

  

  

  const openQuoteDetail = async (q: Quote) => {
    if (isDesktop) {
      openDesktopQuoteWindow(q.id, q.status === 'draft' || q.status === 'sent' ? 'edit' : 'view');
    } else {
      setQuoteItemsDetail([]);setQuoteViewBaseline(null);
      setQuoteDetail(q);
      if(tenant&&can('edit_quotes')){try{const snap=await readQuoteActionSnapshot(tenant.id,q.id);setQuoteDetail({...q,...snap.quote} as Quote);setQuoteItemsDetail(snap.items);setQuoteViewBaseline({quoteId:q.id,version:snap.version});return;}catch{/* consultation simple */}}
      const { data } = await supabase.from('quote_items').select('*, articles(internal_ref, oem_ref)').eq('quote_id', q.id);
      setQuoteItemsDetail(data || []);
    }
  };
  const changeQuoteStatus = async (q:Quote,status:string)=>{
    if(!tenant||!can('edit_quotes')){error('Vous n’avez pas la permission de modifier les devis');return;}
    try{
      let version=quoteViewBaseline?.quoteId===q.id?quoteViewBaseline.version:null;
      if(!version){const snap=await readQuoteActionSnapshot(tenant.id,q.id);if(snap.quote.status!==q.status||Number(snap.quote.total)!==Number(q.total)){error('Le devis a changé. Ouvrez-le avant de poursuivre.');return;}version=snap.version;}
      const {data,error:e}=await supabase.rpc('change_locked_quote_status',{p_tenant_id:tenant.id,p_quote_id:q.id,p_expected_version:version,p_status:status});
      if(e)throw e;
      const snap=data as LockedQuoteSnapshot;
      if(quoteDetail?.id===q.id){setQuoteDetail({...q,...snap.quote} as Quote);setQuoteItemsDetail(snap.items);setQuoteViewBaseline({quoteId:q.id,version:snap.version});}
      success('Statut mis à jour');loadTab(billPage,true);
    }catch(e){error(e&&typeof e==='object'&&'message' in e?String(e.message):'Changement impossible.');}
  };
  const editMobileQuote=(q:Quote)=>{
    if(!can('edit_quotes')||!['draft','sent'].includes(q.status))return;
    quoteEditSite.current=currentSite?.id||null;setQuoteBaseline(null);quoteOriginal.current=null;setEditingQuoteId(q.id);setQuoteEditorMode('edit');setQuoteDetail(null);setQuoteOpen(true);
  };

  const printQuote = () => {
    if (!quoteDetail || !tenant) return;
    const items = quoteItemsDetail.map(i => ({ name: i.name, supplier_ref: null, oem_ref: i.articles?.oem_ref || null, quantity: Number(i.quantity), unit_price: Number(i.unit_price), discount: Number(i.discount || 0) }));
    const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price - (i.discount || 0), 0);
    printDocumentA4({
      tenant: tenantForPrint(tenant, currentSite),
      docLabel: 'DEVIS',
      docNumber: quoteDetail.quote_number,
      docDate: new Date(quoteDetail.created_at).toLocaleDateString('fr-FR'),
      docCreatedAt: quoteDetail.created_at,
      customer: quoteDetail.customers ? { name: quoteDetail.customers.name, phone: (quoteDetail.customers as any).phone || undefined, address: (quoteDetail.customers as any).address || undefined } : null,
      items, subtotal, total: Number(quoteDetail.total),
      footerNote: 'Devis valable 30 jours à compter de la date d\'émission.',
      issuedBy: creatorName((quoteDetail as any).user_id),
      docHeader: (quoteDetail as any).doc_header ?? null,
    });
  };

  // ── Direct invoice creation ──────────────────────────────────
  const updateInvoiceItem = (idx: number, field: keyof QuoteItem, val: any) => {
    if (field === 'article_id') {
      const art = articles.find(a => a.id === val);
      if (art) {
        const tiers = articleTiers.filter(t => t.article_id === val);
        if (tiers.length > 1) {
          setInvoiceEditorItems(prev => {
            const next = [...prev];
            next[idx] = { ...next[idx], article_id: val, name: art.name };
            if (!Number(next[idx].quantity) || Number(next[idx].quantity) < 1) next[idx].quantity = 1;
            return next;
          });
          setTierPickerArticle(art);
          setTierPickerTarget('invoice');
          setTierPickerIdx(idx);
          setTierPickerOpen(true);
          return;
        }
      }
    }
    setInvoiceEditorItems(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      if (field === 'article_id') {
        const art = articles.find(a => a.id === val);
        if (art) {
          next[idx].name = art.name;
          next[idx].ipm_eligible = (art as any).ipm_eligible !== false;
          const tiers = articleTiers.filter(t => t.article_id === val);
          next[idx].unit_price = tiers.length === 1 ? tiers[0].price : art.sale_price;
          next[idx].tier_name = tiers.length === 1 ? tiers[0].tier_name : undefined;
          if (!Number(next[idx].quantity) || Number(next[idx].quantity) < 1) next[idx].quantity = 1;
        }
      }
      const it = next[idx];
      next[idx].total = Math.max(0, Number(it.quantity || 0) * Number(it.unit_price || 0) - Number(it.discount || 0));
      return next;
    });
  };
  
  const invoiceEditorSubtotal = invoicePricing.price?.ttc ?? invoiceEditorSubtotalRaw;

  const openInvoiceEditor = () => {
    if (isDesktop) {
      const wid = `inv-new-${++invoiceWindowCounter.current}`;
      const desc: InvoiceWindowDescriptor = { windowId: wid, invoiceId: null, mode: 'create', siteId: currentSite?.id || '', tenantId: tenant?.id || '' };
      setInvoiceWindows(prev => { const next = new Map(prev); next.set(wid, desc); return next; });
    } else {
      setMobileInvoiceOpen(true);
      setMobileInvoiceMode('create');
      setMobileEditingInvoiceId(null);
      setInvoiceForm({ customer_id: '', doc_date: new Date().toISOString().slice(0, 10), delivery_date: '', reference: '', warranty: '', representative: '', imei: '' });
      setInvoiceEditorItems([{ article_id: null, name: '', quantity: 1, unit_price: 0, discount: 0, total: 0 }]);
      setInvoicePayList([]);
      setInvoiceIsCredit(false);
      setInvoicePostCreation(null);
    }
  };
  const closeInvoiceWindow = (windowId: string) => {
    clearFormDraft(billingScope, windowId);
    setInvoiceWindows(prev => { const next = new Map(prev); next.delete(windowId); return next; });
  };

  useEffect(() => {
    if (!isDesktop) return;
    if (!recoveryChecked) return;
    if (!billingScope.userId || !billingScope.tenantId || !billingScope.siteId) return;
    const windowsList: LayoutWindow[] = [];
    for (const desc of invoiceWindows.values()) {
      const wm = wmWindows.find(w => w.id === desc.windowId);
      windowsList.push({ windowId: desc.windowId, kind: 'invoice', descriptor: desc, rect: wm?.rect, minimized: wm?.minimized });
    }
    for (const desc of quoteWindows.values()) {
      const wm = wmWindows.find(w => w.id === desc.windowId);
      windowsList.push({ windowId: desc.windowId, kind: 'quote', descriptor: desc, rect: wm?.rect, minimized: wm?.minimized });
    }
    saveLayout('billing', { scope: billingScope, pageWindowOpen, windows: windowsList, billSourceSiteId });
  }, [isDesktop, recoveryChecked, billingScope, pageWindowOpen, invoiceWindows, quoteWindows, wmWindows, billSourceSiteId]);
  const closeWindowForInvoice = (invoiceId: string) => {
    const entry = Array.from(invoiceWindows.entries()).find(([, d]) => d.invoiceId === invoiceId);
    if (entry) closeInvoiceWindow(entry[0]);
  };
  const handleInvoiceCreated = (windowId: string, invoiceId: string, saleNumber: string) => {
    setInvoiceWindows(prev => {
      const next = new Map(prev);
      const desc = next.get(windowId);
      if (desc) next.set(windowId, { ...desc, invoiceId, mode: 'view' });
      return next;
    });
    updateWindowTitle(windowId, `Facture ${saleNumber}`);
  };
  const closeInvoiceEditor = () => {
    if (isDesktop) {
      setInvoiceWindows(new Map());
    } else {
      setMobileInvoiceOpen(false);
      setMobileInvoiceMode('create');
      setMobileEditingInvoiceId(null);
      setInvoicePostCreation(null);
      setInvoiceDetail(null);
      setInvoiceForm({ customer_id: '', doc_date: new Date().toISOString().slice(0, 10), delivery_date: '', reference: '', warranty: '', representative: '', imei: '' });
      setInvoiceEditorItems([{ article_id: null, name: '', quantity: 1, unit_price: 0, discount: 0, total: 0 }]);
      setInvoicePayList([]);
      setInvoiceIsCredit(false);
      setInvoicePostCreation(null);
    }
  };
  const handleSaleChange = async (saleId: string) => {
    const request = ++returnLinesRequest.current;
    setReturnForm(f => ({ ...f, sale_id: saleId }));
    setReturnLines([]);
    setReturnError(null);
    setReturnLoad({ busy: !!saleId, error: null });
    if (!saleId) return;
    try {
      const lines = await loadInvoiceReturnLines(saleId);
      if (request !== returnLinesRequest.current) return;
      setReturnLines(lines);
      setReturnLoad({ busy: false, error: null });
    } catch (failure) {
      if (request === returnLinesRequest.current) {
        setReturnLoad({ busy: false, error: (failure as { message?: string }).message || 'Impossible de charger les articles.' });
      }
    }
  };

  const startReturn = (mode: 'return' | 'avoir', origin: Invoice | null = null) => {
    setReturnMode(mode);
    setReturnOrigin(origin);
    setReturnForm({ sale_id: '', reason: '', restock: true });
    void handleSaleChange(origin?.id || '');
    setReturnOpen(true);
  };

  const closeReturnForm = () => {
    returnLinesRequest.current++;
    setReturnOpen(false);
  };

  const handleNavTarget = useCallback((target: string) => {
    switch (target) {
      case 'newInvoice': setTabRaw('invoices'); openInvoiceEditor(); break;
      case 'newQuote': setTabRaw('quotes'); if (isDesktop) { openDesktopQuoteWindow(null, 'create'); } else { setQuoteEditorMode('create'); setQuoteOpen(true); } break;
      case 'newReturn': setTabRaw('returns'); startReturn('return'); break;
      case 'newAvoir': setTabRaw('credits'); startReturn('avoir'); break;
    }
  }, []);

  useEffect(() => {
    if (pendingNavRef.current) {
      const t = pendingNavRef.current;
      pendingNavRef.current = null;
      handleNavTarget(t);
    }
  }, [handleNavTarget]);

  useEffect(() => {
    const handler = (e: Event) => {
      const target = (e as CustomEvent).detail?.target;
      if (target) handleNavTarget(target);
    };
    window.addEventListener('waarwi:quickaction', handler);
    return () => window.removeEventListener('waarwi:quickaction', handler);
  }, [handleNavTarget]);

  const openInvoiceForEdit = async (inv: Invoice) => {
    if (isDesktop) {
      const existing = Array.from(invoiceWindows.values()).find(w => w.invoiceId === inv.id);
      if (existing) { restoreWindow(existing.windowId); return; }
      const wid = `inv-edit-${inv.id}`;
      const desc: InvoiceWindowDescriptor = { windowId: wid, invoiceId: inv.id, mode: 'edit', siteId: currentSite?.id || '', tenantId: tenant?.id || '' };
      setInvoiceWindows(prev => { const next = new Map(prev); next.set(wid, desc); return next; });
    } else {
      const [{ data: items }, { data: full }] = await Promise.all([
        supabase.from('sale_items').select('*, articles(internal_ref, oem_ref, sale_price)').eq('sale_id', inv.id),
        supabase.from('sales').select('*, customers(name, phone, address)').eq('id', inv.id).maybeSingle(),
      ]);
      setInvoicePostCreation(null);
      if (full) setInvoiceDetail(full as any);
      mobileEditSite.current=currentSite?.id||null;setMobileInvoiceBaseline(null);mobileOriginalDraft.current=null;
      setMobileEditingInvoiceId(inv.id);
      setMobileInvoiceMode('edit');
      setInvoiceForm({
        customer_id: inv.customer_id || '',
        doc_date: (inv as any).doc_header?.doc_date || new Date(inv.created_at).toISOString().slice(0, 10),
        delivery_date: (inv as any).doc_header?.delivery_date || '',
        reference: (inv as any).doc_header?.reference || '',
        warranty: (inv as any).doc_header?.warranty || '',
        representative: (inv as any).representative_id || '',
        imei: (inv as any).doc_header?.imei || '',
      });
      editingInvoicePrevRep.current = (inv as any).representative_id || null;
      setInvoiceEditorItems((items || []).map((i: any) => ({
        article_id: i.article_id, name: i.name,
        quantity: Number(i.quantity), unit_price: Number(i.unit_price),
        discount: Number(i.discount || 0), total: Number(i.total),
      })));
      setInvoicePayList([]);
      setInvoiceIsCredit(inv.status === 'validated' && Number(inv.paid) === 0);
      setMobileInvoiceOpen(true);
    }
  };
  const openInvoiceForView = async (inv: Invoice) => {
    if (isDesktop) {
      const existing = Array.from(invoiceWindows.values()).find(w => w.invoiceId === inv.id);
      if (existing) { restoreWindow(existing.windowId); return; }
      const wid = `inv-view-${inv.id}`;
      const desc: InvoiceWindowDescriptor = { windowId: wid, invoiceId: inv.id, mode: 'view', siteId: currentSite?.id || '', tenantId: tenant?.id || '' };
      setInvoiceWindows(prev => { const next = new Map(prev); next.set(wid, desc); return next; });
    } else {
      const [{ data: items }, { data: full }] = await Promise.all([
        supabase.from('sale_items').select('*, articles(internal_ref, oem_ref, sale_price)').eq('sale_id', inv.id),
        supabase.from('sales').select('*, customers(name, phone, address)').eq('id', inv.id).maybeSingle(),
      ]);
      setMobileEditingInvoiceId(inv.id);
      setInvoiceNavIdx(invoices.findIndex(i => i.id === inv.id));
      setMobileInvoiceMode('view');
      setInvoiceForm({
        customer_id: inv.customer_id || '',
        doc_date: (inv as any).doc_header?.doc_date || new Date(inv.created_at).toISOString().slice(0, 10),
        delivery_date: (inv as any).doc_header?.delivery_date || '',
        reference: (inv as any).doc_header?.reference || '',
        warranty: (inv as any).doc_header?.warranty || '',
        representative: (inv as any).representative_id || '',
        imei: (inv as any).doc_header?.imei || '',
      });
      setInvoiceEditorItems((items || []).map((i: any) => ({
        article_id: i.article_id, name: i.name,
        quantity: Number(i.quantity), unit_price: Number(i.unit_price),
        discount: Number(i.discount || 0), total: Number(i.total),
      })));
      const { data: pp } = await supabase.from('sale_payments').select('*').eq('sale_id', inv.id);
      setInvoicePayList((pp || []).map((p: any) => ({ method_id: p.payment_method_id || '', method_name: p.method_name, amount: Number(p.amount), reference: '' })));
      setInvoiceIsCredit(inv.status === 'validated' && Number(inv.paid) === 0);
      if (full) setInvoiceDetail(full as any);
      setMobileInvoiceOpen(true);
    }
  };

  const saveInvoice = async () => {
    if (!tenant || !currentSite) { error('Magasin introuvable'); return; }
    if (!can('edit_invoices')) { error('Vous n\'avez pas la permission de créer des factures'); return; }
    const valid = invoiceEditorItems.filter(i => i.name.trim());
    if (valid.length === 0) { error('Ajoutez au moins un article'); return; }
    const nonCatalog = valid.filter(i => !i.article_id);
    if (nonCatalog.length > 0) { error(`Chaque ligne doit correspondre à un article du catalogue : ${nonCatalog.map(i => i.name).join(', ')}`); return; }

    // Edit existing invoice via RPC (handles stock + balance recalculation)
    if (mobileEditingInvoiceId) {
      if(savingInvoice||mobileInvoiceMode!=='edit'||!mobileLease.held||!mobileLease.token||!mobileSnapshot.ready||mobileInvoiceBaseline?.saleId!==mobileEditingInvoiceId){error('Reprenez l’accès et vérifiez la version de la facture avant de l’enregistrer.');return;}
      setSavingInvoice(true);
      try {
        const invRepLabel = repLabelOf(invoiceForm.representative);
        const docHeader = { doc_date: invoiceForm.doc_date || null, delivery_date: invoiceForm.delivery_date || null, reference: invoiceForm.reference || null, warranty: invoiceForm.warranty || null, representative: invRepLabel, imei: invoiceForm.imei || null };
        const editSubtotal=valid.reduce((sum,i)=>sum+Number(i.total),0);
        const editRepSnapshot=await buildRepSnapshot(invoiceForm.representative||null,valid,editSubtotal);
        const {data:result,error:rpcErr}=await supabase.rpc('save_locked_invoice_edit',{
          p_tenant_id:tenant.id,p_sale_id:mobileEditingInvoiceId,p_window_id:mobileLease.windowId,p_lock_token:mobileLease.token,p_expected_version:mobileInvoiceBaseline.version,
          p_items:valid.map(i=>({article_id:i.article_id,name:i.name,quantity:i.quantity,unit_price:i.unit_price,discount:i.discount})),
          p_customer_id:invoiceForm.customer_id||null,p_doc_header:docHeader,p_representative_id:invoiceForm.representative||null,p_rep_commission:editRepSnapshot,p_release:true,
        });
        if(rpcErr){if(rpcErr.code==='40001')mobileSnapshot.retry();throw rpcErr;}
        if(!(result as any)?.success)throw new Error('La facture n’a pas été modifiée.');
        success('Facture mise à jour');
        closeInvoiceEditor();
        loadTab(billPage, true);
      } catch (err: any) {
        error(err.message || 'Erreur');
      } finally {
        setSavingInvoice(false);
      }
      return;
    }

    // IPM document validation
    if (ipmBeneficiaire && ipmConfig && !ipmDocValidation.valide) {
      error(`Documents IPM manquants : ${ipmDocValidation.champs_manquants.join(', ')}`);
      return;
    }

    if (!invoicePricing.price) {
      error(invoicePricing.error || 'Le montant de la facture est en cours de calcul.');
      if (invoicePricing.error) invoicePricing.refresh();
      return;
    }
    if (ipmBeneficiaire && invoicePricing.price.vat > 0) {
      error('La répartition d’une facture avec TVA entre le client et l’IPM doit être validée.');
      return;
    }
    const invoiceTtc = invoicePricing.price.ttc;
    const subtotal = valid.reduce((s, i) => s + Number(i.total), 0);
    const totalPaid = invoiceIsCredit ? 0 : invoicePayList.reduce((s, p) => s + p.amount, 0);
    const clientDueAmount = (ipmBeneficiaire && ipmPartIpm > 0) ? ipmPartClient : invoiceTtc;
    if (!invoiceIsCredit && totalPaid > clientDueAmount) { error('Le montant payé dépasse la part client'); return; }

    if (invoiceIsCredit && !invoiceForm.customer_id) {
      error('Un client est requis pour une facture à crédit');
      return;
    }

    // Stock check if negative stock not allowed
    const allowNeg = !!(currentSite as any)?.allow_negative_stock;
    const articleItems = valid.filter(i => i.article_id);
    const trackedItems = articleItems.filter(i => {
      const art = articles.find((a: any) => a.id === i.article_id);
      return art && art.track_stock !== false;
    });
    if (!allowNeg && trackedItems.length > 0) {
      const { data: stk } = await supabase.from('stock_levels')
        .select('article_id, quantity')
        .eq('tenant_id', tenant.id).eq('site_id', currentSite.id)
        .in('article_id', trackedItems.map(i => i.article_id!));
      const stockMap = new Map((stk || []).map((r: any) => [r.article_id, Number(r.quantity)]));
      const insufficient = trackedItems.filter(i => (stockMap.get(i.article_id!) || 0) < i.quantity);
      if (insufficient.length > 0) {
        error(`Stock insuffisant: ${insufficient.map(i => i.name).join(', ')}`);
        return;
      }
    }

    setSavingInvoice(true);
    try {
      const { data: numData } = await supabase.rpc('next_doc_number', {
        p_tenant_id: tenant.id, p_kind: 'invoice', p_prefix: 'F',
      });
      const invNum = (numData as string) || ('F-' + Date.now());

      let sessionId: string | null = null;
      if (!invoiceIsCredit) {
        const cashCtx = await getOperationalCashContext(currentSite.id);
        sessionId = cashCtx.session?.id || null;
        if (!sessionId && totalPaid > 0 && (cashCtx.multiEnabled || cashCtx.error)) throw new Error(missingSessionMessage(cashCtx, ''));
      }

      const status = invoiceIsCredit
        ? (ipmBeneficiaire && ipmPartIpm > 0 && totalPaid >= clientDueAmount ? 'paid' : 'validated')
        : (totalPaid >= clientDueAmount ? 'paid' : totalPaid > 0 ? 'partial' : 'validated');

      const ipmCoverage = (ipmBeneficiaire && ipmPartIpm > 0) ? ipmPartIpm : 0;
      const effectivePaid = totalPaid + ipmCoverage;

      const repSnapshot = await buildRepSnapshot(invoiceForm.representative || null, valid, subtotal);
      const newInvRepLabel = repLabelOf(invoiceForm.representative);

      const { data: saleId, error: e } = await supabase.rpc('create_billing_sale_with_items', {
        p_sale: {
          site_id: currentSite.id,
          customer_id: invoiceForm.customer_id || null,
          sale_number: invNum, subtotal, discount: 0, total: invoiceTtc,
          paid: effectivePaid, status,
          note: ipmCoverage > 0 ? `IPM: ${ipmBeneficiaire.ipm_organismes?.nom}` : null,
          cash_session_id: sessionId,
          representative_id: invoiceForm.representative || null,
          rep_commission: repSnapshot,
          doc_header: { doc_date: invoiceForm.doc_date || null, delivery_date: invoiceForm.delivery_date || null, reference: invoiceForm.reference || null, warranty: invoiceForm.warranty || null, representative: newInvRepLabel, imei: invoiceForm.imei || null },
        },
        p_items: valid.map(i => ({
          article_id: i.article_id, name: i.name, quantity: i.quantity,
          unit_price: i.unit_price, discount: i.discount, total: i.total,
        })),
        p_payments: invoiceIsCredit ? [] : invoicePayList.filter(p => p.amount > 0).map(p => ({
          payment_method_id: p.method_id || null, amount: p.amount, reference: p.reference || '',
        })),
      });
      if (e || !saleId) { invoicePricing.refresh(); error(e?.message || 'La facture n’a pas été enregistrée.'); return; }
      const sale = { id: saleId as string };

      if (invoiceForm.customer_id) {
        const unpaidAmount = invoiceTtc - effectivePaid;
        if (unpaidAmount > 0) {
          const { data: cust } = await supabase.from('customers').select('balance').eq('id', invoiceForm.customer_id).single();
          await supabase.from('customers').update({ balance: Number(cust?.balance || 0) + unpaidAmount }).eq('id', invoiceForm.customer_id);
        }
      }

      // Deduct stock
      const stockSiteId = billSourceSiteId || currentSite.id;
      for (const item of articleItems) {
        if (!item.article_id) continue;
        await supabase.rpc('adjust_stock', {
          p_article_id: item.article_id,
          p_site_id: stockSiteId,
          p_quantity: -item.quantity,
          p_movement_type: 'sale',
          p_note: `Facture ${invNum}${invoiceIsCredit ? ' (credit)' : ''}`,
        });
      }



      // Create IPM vente record if client is IPM beneficiary
      if (ipmBeneficiaire && ipmPartIpm > 0) {
        await supabase.from('ipm_ventes').insert({
          tenant_id: tenant.id,
          organisme_id: ipmBeneficiaire.organisme_id,
          beneficiaire_id: ipmBeneficiaire.id,
          convention_id: ipmBeneficiaire.convention_id || null,
          sale_id: sale.id,
          date_vente: new Date().toISOString().slice(0, 10),
          part_ipm: ipmPartIpm,
          part_client: ipmPartClient,
          montant_total: invoiceTtc,
          taux_prise_en_charge: ipmTaux,
          montant_eligible: ipmResult?.montant_eligible || subtotal,
          montant_non_eligible: ipmResult?.montant_non_eligible || 0,
          plafond_applique: ipmResult?.plafond_atteint ? ipmConfig?.plafond_facture : null,
          arrondi_applique: ipmConfig?.mode_arrondi || null,
          part_beneficiaire_payee: Math.min(totalPaid, ipmPartClient),
          statut: 'en_attente',
          numero_ordonnance: ipmDocuments.numero_ordonnance || null,
          medecin_prescripteur: ipmDocuments.medecin || null,
          numero_bon_pec: ipmDocuments.numero_bon || null,
        });
      }

      success(`Facture ${invNum} créée${invoiceIsCredit ? ' (à crédit)' : ''}${ipmBeneficiaire && ipmPartIpm > 0 ? ` · Part IPM: ${formatFCFA(ipmPartIpm)}` : ''}`);
      setInvoicePostCreation({ saleNumber: invNum, createdAt: new Date().toISOString(), createdBy: profile?.full_name || profile?.email || '' });
      setMobileEditingInvoiceId(sale.id);
      setMobileInvoiceMode('view');
      const [{ data: newFull }, { data: payments }] = await Promise.all([
        supabase.from('sales').select('*, customers(name, phone, address)').eq('id', sale.id).maybeSingle(),
        supabase.from('sale_payments').select('*').eq('sale_id', sale.id),
      ]);
      if (newFull) setInvoiceDetail(newFull as Invoice);
      if (payments) {
        setInvoicePayList(payments.map(p => ({
          method_id: p.payment_method_id || '', method_name: p.method_name, amount: Number(p.amount), reference: p.reference || '',
        })));
      }
      loadTab(billPage, true);
    } catch (err: any) {
      error(err.message || 'Erreur');
    } finally {
      setSavingInvoice(false);
    }
  };

  // ── Convert quote → sale ─────────────────────────────────────
  const openConvert = async (q: Quote) => {
    setConvertFrom(q); setConvertPayNow(false); setConvertPayMethod(paymentMethods[0]?.id || '');
    setConvertItems([]);
    setConvertPayAmount('');
    setConvertIpmDocs({ numero_ordonnance: '', medecin: '', numero_bon: '' });
    setConvertIpmBeneficiaire(null);
    setConvertIpmConvention(null);
    const { data } = await supabase.from('quote_items').select('article_id, name, quantity, unit_price, discount').eq('quote_id', q.id);
    setConvertItems(data || []);
    // IPM lookup for conversion
    if (isPharmacy && q.customer_id && tenant) {
      const { data: benef } = await supabase
        .from('ipm_beneficiaires')
        .select('*, ipm_organismes(nom), ipm_conventions(nom, taux_defaut, plafond_facture, mode_calcul, mode_arrondi, application_plafond, ordonnance_obligatoire, bon_prise_en_charge_obligatoire, numero_bon_obligatoire, numero_ordonnance_obligatoire, medecin_prescripteur_obligatoire, matricule_obligatoire)')
        .eq('tenant_id', tenant.id)
        .eq('customer_id', q.customer_id)
        .eq('statut', 'actif')
        .limit(1)
        .maybeSingle();
      if (benef) {
        setConvertIpmBeneficiaire(benef);
        setConvertIpmConvention(benef.ipm_conventions);
        // Pre-fill payment amount with client part
        const cfg = parseConvention(benef.ipm_conventions);
        if (cfg) {
          const calc = calculerIpm(cfg, [{ montant_ligne: q.total, ipm_eligible: true }], 0);
          setConvertPayAmount(String(calc.part_client));
        }
      }
    }
  };
  const confirmConvert = async () => {
    if (!convertFrom || !currentSite) return;

    // IPM document validation
    if (convertIpmBeneficiaire && convertIpmConvention) {
      const cfg = parseConvention(convertIpmConvention);
      if (cfg) {
        const validation = validerDocumentsIpm(cfg, convertIpmDocs, convertIpmBeneficiaire.matricule);
        if (!validation.valide) {
          error(`Documents IPM manquants : ${validation.champs_manquants.join(', ')}`);
          return;
        }
      }
    }

    // Stock check: block if insufficient stock and negative stock not allowed
    const allowNeg = !!(currentSite as any)?.allow_negative_stock;
    const trackedConvertItems = convertItems.filter(i => {
      const art = articles.find((a: any) => a.id === i.article_id);
      return art && art.track_stock !== false;
    });
    if (!allowNeg && trackedConvertItems.length > 0) {
      const { data: stk } = await supabase
        .from('stock_levels')
        .select('article_id, quantity')
        .eq('tenant_id', tenant!.id)
        .eq('site_id', currentSite.id)
        .in('article_id', trackedConvertItems.map(i => i.article_id!));
      const stockMap = new Map((stk || []).map((r: any) => [r.article_id, Number(r.quantity)]));
      const insufficient = trackedConvertItems.filter(i => (stockMap.get(i.article_id) || 0) < i.quantity);
      if (insufficient.length > 0) {
        error(`Stock insuffisant pour: ${insufficient.map(i => i.name).join(', ')}. Conversion impossible.`);
        return;
      }
    }

    if (stockMethod === 'lot' && convertItems.length > 0) {
      setLotPickerConvertOpen(true);
      return;
    }
    await executeConvert(null);
  };

  const executeConvert = async (lotSelections: ArticleLotSelection[] | null) => {
    if (!convertFrom || !currentSite) return;
    if (!can('edit_invoices')) { error('Vous n\'avez pas la permission de convertir en facture'); return; }
    if (!convertPricing.price) {
      error(convertPricing.error || 'Le montant de la facture est en cours de calcul.');
      if (convertPricing.error) convertPricing.refresh();
      return;
    }
    if (convertIpmBeneficiaire && convertPricing.price.vat > 0) {
      error('La répartition d’une facture avec TVA entre le client et l’IPM doit être validée.');
      return;
    }
    setConverting(true);

    // Find active cash session for payment tracking
    let convertSessionId: string | null = null;
    if (currentSite && tenant) {
      const cashCtx = await getOperationalCashContext(currentSite.id);
      convertSessionId = cashCtx.session?.id || null;
      if (!convertSessionId && convertPayNow && Number(convertPayAmount) > 0 && (cashCtx.multiEnabled || cashCtx.error)) {
        setConverting(false); error(missingSessionMessage(cashCtx, '')); return;
      }
    }

    const payments: object[] = [{ expected_ttc: convertTtc }];
    if (convertPayNow && Number(convertPayAmount) > 0 && convertPayMethod) {
      const pm = paymentMethods.find(p => p.id === convertPayMethod);
      payments.push({
        payment_method_id: convertPayMethod,
        method_name: pm?.name || 'Paiement',
        amount: Math.min(Number(convertPayAmount), convertTtc),
        reference: '',
      });
    }
    const { data, error: e } = await supabase.rpc('convert_quote_to_sale', {
      p_quote_id: convertFrom.id,
      p_site_id: billSourceSiteId || currentSite.id,
      p_cash_session_id: convertSessionId,
      p_payments: payments,
    });
    if (e) { setConverting(false); convertPricing.refresh(); error(e.message); return; }

    if (lotSelections && lotSelections.length > 0) {
      for (const sel of lotSelections) {
        const assignments = sel.assignments.filter(a => a.quantity > 0).map(a => ({ lot_id: a.lot_id, quantity: a.quantity }));
        if (assignments.length > 0) {
          await supabase.rpc('deduct_stock_manual_lots', {
            p_article_id: sel.article_id,
            p_site_id: billSourceSiteId || currentSite.id,
            p_total_quantity: assignments.reduce((s, a) => s + a.quantity, 0),
            p_lot_assignments: assignments,
          });
        }
      }
    } else if (convertItems.length > 0) {
      const saleNum = (data as any)?.sale_number || '';
      for (const item of convertItems) {
        if (!item.article_id) continue;
        await supabase.rpc('adjust_stock', {
          p_article_id: item.article_id,
          p_site_id: billSourceSiteId || currentSite.id,
          p_quantity: -item.quantity,
          p_movement_type: 'sale',
          p_note: `Facture ${saleNum} (devis converti)`,
        });
      }
    }



    // Carry representative + commission snapshot onto the new sale
    const convRepId = (convertFrom as any).representative_id || null;
    const newSaleId = (data as any)?.sale_id;
    if (convRepId && newSaleId) {
      const { data: sItems } = await supabase.from('sale_items').select('article_id, quantity, total').eq('sale_id', newSaleId);
      const convItems: QuoteItem[] = (sItems || []).map((i: any) => ({
        article_id: i.article_id, name: '', quantity: Number(i.quantity), unit_price: 0, discount: 0, total: Number(i.total),
      }));
      const convSubtotal = convItems.reduce((s, i) => s + Number(i.total), 0) || Number(convertFrom.total);
      const convSnapshot = await buildRepSnapshot(convRepId, convItems, convSubtotal);
      await supabase.from('sales').update({ representative_id: convRepId, rep_commission: convSnapshot }).eq('id', newSaleId);
    }

    // Create IPM vente record if beneficiary
    const saleId = (data as any)?.sale_id;
    if (convertIpmBeneficiaire && tenant && saleId) {
      const cfg = parseConvention(convertIpmConvention);
      if (cfg) {
        const ipmCalc = calculerIpm(cfg, [{ montant_ligne: convertTtc, ipm_eligible: true }], 0);
        const payAmt = convertPayNow ? Math.min(Number(convertPayAmount), convertTtc) : 0;
        await supabase.from('ipm_ventes').insert({
          tenant_id: tenant.id,
          organisme_id: convertIpmBeneficiaire.organisme_id,
          beneficiaire_id: convertIpmBeneficiaire.id,
          convention_id: convertIpmBeneficiaire.convention_id || null,
          sale_id: saleId,
          date_vente: new Date().toISOString().slice(0, 10),
          part_ipm: ipmCalc.part_ipm,
          part_client: ipmCalc.part_client,
          montant_total: convertTtc,
          part_beneficiaire_payee: Math.min(payAmt, ipmCalc.part_client),
          statut: 'en_attente',
          numero_ordonnance: convertIpmDocs.numero_ordonnance || null,
          medecin_prescripteur: convertIpmDocs.medecin || null,
          numero_bon_pec: convertIpmDocs.numero_bon || null,
        });
        // Update sale status: mark as paid if payment covers client part
        if (payAmt >= ipmCalc.part_client) {
          await supabase.from('sales').update({ status: 'paid', paid: payAmt + ipmCalc.part_ipm }).eq('id', saleId);
        }
      }
    }

    setConverting(false);
    success(`Facture ${(data as any)?.sale_number || ''} créée`);
    setConvertFrom(null); setQuoteDetail(null);
    setTabRaw('invoices'); loadTab(billPage, true);
  };

  const reloadInvoice = async (id: string) => {
    const { data } = await supabase.from('sales').select('*, customers(name, phone, address)').eq('id', id).maybeSingle();
    if (data) {
      setInvoiceDetail(prev => prev?.id === id ? data as Invoice : prev);
      if (mobileInvoiceOpen && mobileEditingInvoiceId === id) {
        const { data: pp } = await supabase.from('sale_payments').select('*').eq('sale_id', id);
        setInvoicePayList((pp || []).map((p: any) => ({ method_id: p.payment_method_id || '', method_name: p.method_name, amount: Number(p.amount), reference: '' })));
      }
    }
    loadTab(billPage, true);
  };

  const invoiceUrl = (inv: Invoice | null) => {
    if (!inv?.public_code) return '';
    return `${window.location.origin}/inv/${inv.public_code}`;
  };

  const copyInvoiceLink = async (inv?: Invoice | null) => {
    const target = inv || invoiceDetail;
    const url = invoiceUrl(target);
    if (!url) { error('Lien indisponible'); return; }
    try {
      await navigator.clipboard.writeText(url);
      success('Lien copié');
    } catch {
      window.prompt('Copiez le lien :', url);
    }
  };

  const sendInvoiceWhatsApp = (inv?: Invoice | null) => {
    const target = inv || invoiceDetail;
    if (!target) return;
    const cust = target.customers as any;
    const phoneRaw = (cust?.whatsapp || cust?.phone || '').replace(/[^0-9]/g, '');
    if (!phoneRaw) { error('Aucun numéro WhatsApp/téléphone pour ce client'); return; }
    const phone = phoneRaw.startsWith('221') ? phoneRaw : phoneRaw.length === 9 ? `221${phoneRaw}` : phoneRaw;
    const due = Math.max(0, Number(target.total) - Number(target.paid));
    const link = invoiceUrl(target);
    const msg = [
      `Bonjour ${cust?.name || ''},`,
      '',
      `Votre facture *${target.sale_number}* du ${formatDate(target.created_at)}.`,
      `*Total : ${formatFCFA(target.total)}*`,
      due > 0 ? `Reste à payer : *${formatFCFA(due)}*` : 'Payée intégralement.',
      link ? `\nVoir la facture : ${link}` : '',
      '',
      'Merci.',
    ].filter(Boolean).join('\n');
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const quickWhatsApp = (inv: Invoice) => sendInvoiceWhatsApp(inv);
  const quickCopy = (inv: Invoice) => copyInvoiceLink(inv);

  const cancelInvoice = async (inv: Invoice) => {
    setCancelReason('');
    const hasRealPayments = Number(inv.paid) > 0;
    setCancelPaymentAction(hasRealPayments ? 'keep_credit' : 'none');
    setCancelTarget(inv);
  };

  const [cancelling, setCancelling] = useState(false);
  const confirmCancelInvoice = async () => {
    if (!cancelTarget) return;
    if (!can('edit_invoices')) { error("Vous n'avez pas la permission d'annuler une facture"); return; }
    if (!cancelReason.trim()) { error('Un motif d\'annulation est obligatoire'); return; }
    const inv = cancelTarget;
    if (!tenant) { error('Aucun établissement sélectionné'); return; }
    setCancelling(true);
    let cashSessionId: string | null = null;
    if (cancelPaymentAction === 'refund_cash') {
      if (!currentSite) { setCancelling(false); error('Aucun point de vente sélectionné'); return; }
      const cashCtx = await getOperationalCashContext(currentSite.id);
      cashSessionId = cashCtx.session?.id || null;
      if (!cashSessionId) {
        setCancelling(false);
        error(missingSessionMessage(cashCtx, "Aucune session de caisse ouverte : impossible de rembourser en espèces. Ouvrez une caisse ou choisissez « Conserver en crédit »."));
        return;
      }
    }
    const { data, error: e } = await supabase.rpc('cancel_sale', {
      p_sale_id: inv.id,
      p_tenant_id: tenant.id,
      p_cancel_reason: cancelReason.trim(),
      p_payment_action: cancelPaymentAction,
      p_cash_session_id: cashSessionId,
    });
    setCancelling(false);
    if (e) { error(e.message); return; }
    if (!(data as any)?.success) {
      const code = (data as any)?.error;
      const msg = code === 'requires_open_session'
        ? "Aucune session de caisse ouverte : impossible de rembourser en espèces."
        : code === 'requires_payment_action'
        ? "Veuillez choisir comment traiter le paiement déjà encaissé."
        : code || "Échec de l'annulation";
      error(msg);
      return;
    }
    setCancelTarget(null);
    setCancelReason('');
    setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, status: 'cancelled' } : i));
    success(`Facture ${inv.sale_number} annulée`);
    if (isDesktop) {
      closeWindowForInvoice(inv.id);
    } else {
      closeInvoiceEditor();
    }
  };

  const comptabiliserFromEditor = async (inv: Invoice) => {
    if (accountingBusy) return;
    if (!can('manage_accounting')) { error('Vous n\'avez pas la permission de comptabiliser les factures'); return; }
    setAccountingBusy(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc('comptabiliser_vente', { p_sale_id: inv.id });
      if (rpcErr) throw rpcErr;
      if (!(data as any)?.success) throw new Error((data as any)?.error || 'Erreur inconnue');
      success((data as any).piece_number ? `Comptabilisé · ${(data as any).piece_number}` : 'Facture comptabilisée');
      setInvoiceDetail(prev => prev?.id === inv.id ? { ...prev, accounting_status: 'accounted' } : prev);
      setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, accounting_status: 'accounted' } : i));
    } catch (e: any) { error(e.message); }
    finally { setAccountingBusy(false); }
  };

  // ── Register payment ─────────────────────────────────────────
  const openPay = (inv?: Invoice | null) => {
    const target = inv || invoiceDetail;
    if (!target) return;
    setInvoiceDetail(target);
    const due = Math.max(0, Number(target.total) - Number(target.paid));
    setPayAmount(String(due));
    setPayMethod(paymentMethods[0]?.id || '');
    setPayOpen(true);
  };
  const registerPayment = async () => {
    if (payingRef.current) return;
    if (!invoiceDetail) return;
    if (!can('edit_invoices')) { error('Vous n\'avez pas la permission d\'enregistrer des paiements'); return; }
    const amt = Number(payAmount);
    if (!amt || amt <= 0) { error('Montant invalide'); return; }
    const pm = paymentMethods.find(p => p.id === payMethod);
    if (!pm) { error('Mode de règlement requis'); return; }
    if (!tenant || !currentSite) return;
    payingRef.current = true;
    setPaying(true);
    const cashCtx = await getOperationalCashContext(currentSite.id);
    const sess = cashCtx.session;
    if (!sess) { payingRef.current = false; setPaying(false); error(missingSessionMessage(cashCtx, "La caisse doit être ouverte d'abord")); return; }
    const ref = `Règlement facture ${invoiceDetail.sale_number}${invoiceDetail.customers?.name ? ' · ' + invoiceDetail.customers.name : ''}`;
    const { error: e } = await supabase.rpc('register_sale_payment', {
      p_sale_id: invoiceDetail.id,
      p_payment_method_id: pm.id,
      p_method_name: pm.name,
      p_amount: amt,
      p_reference: ref,
      p_cash_session_id: sess.id,
    });
    if (e) { payingRef.current = false; setPaying(false); error(e.message); return; }
    // Update IPM part_beneficiaire_payee if this is an IPM sale
    const { data: ipmV } = await supabase.from('ipm_ventes').select('id, part_client').eq('sale_id', invoiceDetail.id).limit(1).maybeSingle();
    if (ipmV) {
      const { data: allPays } = await supabase.from('sale_payments').select('amount').eq('sale_id', invoiceDetail.id);
      const totalPaidNow = (allPays || []).reduce((s: number, p: any) => s + Number(p.amount), 0);
      await supabase.from('ipm_ventes').update({ part_beneficiaire_payee: Math.min(totalPaidNow, Number(ipmV.part_client)) }).eq('id', ipmV.id);
    }
    success('Paiement enregistré · imputé sur la caisse du jour');
    setPayOpen(false);
    payingRef.current = false;
    setPaying(false);
    await reloadInvoice(invoiceDetail.id);
  };

  // ── Apply credit ─────────────────────────────────────────────
  const [availableCredits, setAvailableCredits] = useState<SaleReturn[]>([]);
  const openCreditApply = async (invoice: Invoice | null = invoiceDetail) => {
    if (!invoice?.customer_id || !tenant || !currentSite || !can('edit_invoices')) return;
    const { data: creds, error: creditError } = await supabase.from('sale_returns')
      .select('*, customers(name, phone, address), sales(sale_number)')
      .eq('tenant_id', tenant.id).eq('site_id', currentSite.id)
      .eq('refund_method', 'avoir').eq('status', 'approved')
      .eq('customer_id', invoice.customer_id)
      .order('created_at', { ascending: false });
    if (creditError) { error(creditError.message); return; }
    const filtered = (creds || []).filter(r => Number(r.credit_used || 0) < Number(r.total));
    setInvoiceDetail(invoice);
    setAvailableCredits(filtered as SaleReturn[]);
    const c = filtered[0] as SaleReturn | undefined;
    setCreditSelected(c?.id || '');
    const due = Math.max(0, Number(invoice.total) - Number(invoice.paid));
    const avail = c ? Number(c.total) - Number(c.credit_used || 0) : 0;
    setCreditAmount(String(Math.min(due, avail)));
    setApplyCreditError(null);
    setCreditOpen(true);
  };
  const applyCredit = async () => {
    if (!invoiceDetail || !creditSelected || applyingCredit) return;
    if (!can('edit_invoices')) { setApplyCreditError('Vous n’avez pas la permission d’appliquer des avoirs.'); return; }
    const amt = Number(creditAmount);
    const credit = availableCredits.find(item => item.id === creditSelected);
    const due = Math.max(0, Number(invoiceDetail.total) - Number(invoiceDetail.paid));
    const available = credit ? Number(credit.total) - Number(credit.credit_used ?? 0) : 0;
    if (!Number.isFinite(amt) || amt <= 0 || amt > Math.min(due, available)) {
      setApplyCreditError('Saisissez un montant positif dans la limite de l’avoir disponible et du solde dû.');
      return;
    }
    setApplyCreditError(null);
    setApplyingCredit(true);
    const { data: result, error: e } = await supabase.rpc('apply_credit_to_sale', {
      p_credit_id: creditSelected,
      p_sale_id: invoiceDetail.id,
      p_amount: amt,
    });
    setApplyingCredit(false);
    if (e || result?.success !== true) {
      setApplyCreditError(e?.message || result?.error || 'L’avoir n’a pas été imputé.');
      return;
    }
    success('Avoir appliqué');
    setCreditOpen(false);
    await reloadInvoice(invoiceDetail.id);
  };

  // ── Returns ──────────────────────────────────────────────────
  const returnTotal = returnLines.filter(i => i.selected).reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0);

  const prepareVatReturn = async (saleId: string, siteId: string, lines: { item_id: string; quantity: number }[],
    reason: string, restock: boolean, issueCredit: boolean, showError: (message: string) => void = error) => {
    const items = lines.map(line => ({ sale_item_id: line.item_id, quantity: line.quantity }));
    const payload = JSON.stringify({ saleId, siteId, items, reason, restock, issueCredit });
    if (vatReturnAttempt.current?.payload !== payload) {
      vatReturnAttempt.current = { payload, key: newIdempotencyKey() };
    }
    const { data, error: failure } = await supabase.rpc('prepare_vat_invoice_return', {
      p_sale_id: saleId, p_site_id: siteId, p_items: items,
      p_reason: reason, p_restock: restock, p_request_id: vatReturnAttempt.current.key, p_issue_credit: issueCredit,
    });
    if (failure) { showError(failure.message); return null; }
    vatReturnAttempt.current = null;
    return data as SaleReturn;
  };

  const saveReturn = async () => {
    if (saving || returnLoad.busy) return;
    if (!tenant || !currentSite) { setReturnError('Magasin introuvable.'); return; }
    if (!can('edit_invoices')) { setReturnError('Vous n’avez pas la permission d’effectuer des retours.'); return; }
    if (!returnForm.sale_id) { setReturnError('Sélectionnez une vente.'); return; }
    const sel = returnLines.filter(i => i.selected && i.quantity > 0);
    if (sel.length === 0) { setReturnError('Sélectionnez au moins un article.'); return; }
    setReturnError(null);
    setSaving(true);

    const { data: sale } = await supabase.from('sales')
      .select('id, customer_id, sale_number, site_id, vat_net_amount, customers(name, phone, address)')
      .eq('id', returnForm.sale_id).maybeSingle();
    if (!sale) { setReturnError('Facture introuvable.'); setSaving(false); return; }
    if (returnMode === 'avoir' && !sale.customer_id) {
      setReturnError('Sélectionnez une vente associée à un client pour créer un avoir.');
      setSaving(false);
      return;
    }

    if (sale.vat_net_amount != null) {
      const ret = await prepareVatReturn(sale.id, sale.site_id, sel, returnForm.reason, returnForm.restock, returnMode === 'avoir', setReturnError);
      setSaving(false);
      if (!ret) return;
      setReturnOpen(false);
      setReturnForm({ sale_id: '', reason: '', restock: true });
      setReturnLines([]);
      if (mobileInvoiceOpen && mobileEditingInvoiceId === sale.id && returnMode === 'avoir') void reloadInvoice(sale.id);
      else void loadTab(billPage, true);
      await openReturnDetail({ ...ret, customers: Array.isArray(sale.customers) ? sale.customers[0] ?? null : sale.customers, sales: { sale_number: sale.sale_number } });
      success(ret.status === 'approved' ? 'Avoir fiscal émis.' : 'Retour enregistré. Choisissez le mode de remboursement.');
      return;
    }

    // Check if sale has IPM coverage
    const { data: ipmVente } = await supabase.from('ipm_ventes')
      .select('id, part_ipm, part_client, montant_total, bordereau_id, statut')
      .eq('sale_id', returnForm.sale_id)
      .limit(1)
      .maybeSingle();

    // For IPM sales, refund only client portion
    let refundTotal = returnTotal;
    if (ipmVente && ipmVente.montant_total > 0) {
      const ipmRatio = Number(ipmVente.part_client) / Number(ipmVente.montant_total);
      refundTotal = Math.round(returnTotal * ipmRatio);
    }

    const { data: numData } = await supabase.rpc('next_doc_number', {
      p_tenant_id: tenant.id, p_kind: 'return', p_prefix: 'RET',
    });
    const rNum = (numData as string) || ('RET-' + Date.now());
    const { data: ret, error: e } = await supabase.from('sale_returns').insert({
      tenant_id: tenant.id, site_id: currentSite.id,
      sale_id: returnForm.sale_id, customer_id: sale.customer_id || null,
      return_number: rNum, total: refundTotal,
      refund_method: 'pending', reason: returnForm.reason,
      restock: returnForm.restock, status: 'pending',
    }).select().single();
    if (e || !ret) { setReturnError(e?.message || 'Le document n’a pas été enregistré.'); setSaving(false); return; }
    await supabase.from('sale_return_items').insert(sel.map(i => ({
      tenant_id: tenant.id, return_id: ret.id, article_id: i.article_id, sale_item_id: i.item_id, name: i.name,
      quantity: i.quantity, unit_price: i.unit_price, purchase_cost: i.purchase_cost || 0, total: i.quantity * i.unit_price,
    })));
    if (returnForm.restock) {
      for (const item of sel) {
        await supabase.rpc('adjust_stock', {
          p_article_id: item.article_id, p_site_id: billSourceSiteId || currentSite.id,
          p_quantity: item.quantity, p_movement_type: 'return_customer',
          p_note: `Retour ${rNum}`,
        });
      }
    }

    // IPM bordereau handling
    if (ipmVente) {
      const saleTotal = Number(ipmVente.montant_total);
      const isFullReturn = returnTotal >= saleTotal;
      if (isFullReturn) {
        // Full return: remove from bordereau and cancel the ipm_vente
        await supabase.from('ipm_ventes').update({
          statut: 'annulee',
          bordereau_id: null,
        }).eq('id', ipmVente.id);
      } else {
        // Partial return: recalculate IPM amounts
        const newTotal = saleTotal - returnTotal;
        const oldRatio = Number(ipmVente.part_ipm) / saleTotal;
        const newPartIpm = Math.round(newTotal * oldRatio);
        const newPartClient = newTotal - newPartIpm;
        await supabase.from('ipm_ventes').update({
          montant_total: newTotal,
          part_ipm: newPartIpm,
          part_client: newPartClient,
          bordereau_id: null, // Remove from existing bordereau, needs regeneration
        }).eq('id', ipmVente.id);
      }
    }

    setSaving(false);
    setReturnOpen(false);
    setReturnForm({ sale_id: '', reason: '', restock: true });
    setReturnLines([]);
    await loadTab(billPage, true);
    if (returnMode === 'avoir') {
      const { error: avErr } = await supabase.rpc('approve_return_as_avoir', { p_return_id: ret.id });
      if (!avErr) success('Avoir créé.');
      await openReturnDetail({ ...ret, customers: Array.isArray(sale.customers) ? sale.customers[0] ?? null : sale.customers, sales: { sale_number: sale.sale_number } });
      if (avErr) setReturnDetailError(avErr.message);
      void loadTab(billPage, true);
      return;
    }
    success('Retour enregistré. Choisissez le mode de remboursement.');
    void openReturnDetail({ ...ret, customers: Array.isArray(sale.customers) ? sale.customers[0] ?? null : sale.customers, sales: { sale_number: sale.sale_number } });
  };

  const refreshReturnStatus = async (id: string) => {
    const { data, error: failure } = await supabase.from('sale_returns')
      .select('status, refund_method, credit_used, refunded_at, vat_net_amount, vat_amount, vat_entry_id').eq('id', id).maybeSingle();
    if (data) setReturnDetail(previous => previous?.id === id ? { ...previous, ...data } : previous);
    return failure?.message ?? null;
  };

  const openReturnDetail = async (r: SaleReturn) => {
    const request = ++returnDetailRequest.current;
    setReturnDetail(r);
    setReturnEditorOpen(isDesktop);
    setReturnItemsDetail([]);
    setReturnCashConfirmOpen(false);
    setReturnDetailError(null);
    setReturnDetailLoad({ busy: true, error: null });
    const [{ data: items, error: itemsError }, statusError] = await Promise.all([
      supabase.from('sale_return_items').select('*, articles(internal_ref, oem_ref)').eq('return_id', r.id),
      refreshReturnStatus(r.id),
    ]);
    if (request !== returnDetailRequest.current) return;
    setReturnItemsDetail(items || []);
    setReturnDetailLoad({ busy: false, error: itemsError?.message ?? statusError });
  };

  const closeReturnDetail = () => {
    returnDetailRequest.current++;
    setReturnEditorOpen(false);
    setReturnCashConfirmOpen(false);
    setReturnDetail(null);
  };

  const showReturnError = (message: string) => {
    setReturnDetailError(message);
    if (isDesktop) error(message);
  };

  const approveAsAvoir = async (r: SaleReturn) => {
    if (returnWorkflowBusy || !can('edit_invoices')) return;
    setReturnDetailError(null);
    setReturnWorkflowBusy(true);
    const { data, error: failure } = await supabase.rpc('approve_return_as_avoir', { p_return_id: r.id });
    if (failure || data?.success !== true) {
      setReturnWorkflowBusy(false);
      showReturnError(failure?.message ?? data?.error ?? 'L’avoir n’a pas été créé.');
      return;
    }
    const refreshError = await refreshReturnStatus(r.id);
    setReturnWorkflowBusy(false);
    if (refreshError) showReturnError(refreshError);
    success('Avoir créé.');
    if (r.sale_id && mobileInvoiceOpen && mobileEditingInvoiceId === r.sale_id) void reloadInvoice(r.sale_id);
    else void loadTab(billPage, true);
  };

  const approveAsCash = async (r: SaleReturn) => {
    if (returnWorkflowBusy || !can('edit_invoices')) return;
    setReturnDetailError(null);
    setReturnWorkflowBusy(true);
    const cashCtx = currentSite ? await getOperationalCashContext(currentSite.id) : null;
    if (cashCtx?.multiEnabled && !cashCtx.session) {
      setReturnWorkflowBusy(false);
      showReturnError(missingSessionMessage(cashCtx, ''));
      return;
    }
    const { data, error: failure } = await supabase.rpc('process_return_as_cash', cashCtx?.multiEnabled && cashCtx.session
      ? { p_return_id: r.id, p_session_id: cashCtx.session.id }
      : { p_return_id: r.id });
    if (failure || data?.success !== true) {
      setReturnWorkflowBusy(false);
      showReturnError(failure?.message ?? data?.error ?? 'Le remboursement n’a pas été enregistré.');
      return;
    }
    setReturnCashConfirmOpen(false);
    setReturnDetail(prev => prev?.id === r.id ? { ...prev, status: 'approved', refund_method: 'cash' } : prev);
    const refreshError = await refreshReturnStatus(r.id);
    setReturnWorkflowBusy(false);
    if (refreshError) showReturnError(refreshError);
    success('Remboursement enregistré en caisse.');
    void loadTab(billPage, true);
  };

  const postVatReturn = async (r: SaleReturn) => {
    if (returnWorkflowBusy || !can('manage_accounting')) return;
    setReturnDetailError(null);
    setReturnWorkflowBusy(true);
    const { data, error: failure } = await supabase.rpc('post_vat_sale_return', { p_return_id: r.id });
    setReturnWorkflowBusy(false);
    if (failure || !data?.entry_id) {
      showReturnError(failure?.message ?? 'La comptabilisation n’a pas été enregistrée.');
      return;
    }
    setReturnDetail(previous => previous?.id === r.id ? { ...previous, vat_entry_id: data.entry_id } : previous);
    success('Document comptabilisé.');
  };

  const vatReturnAction = returnDetail?.vat_net_amount != null && returnDetail.status === 'approved'
    ? returnDetail.vat_entry_id
      ? <span className="text-xs font-medium">Comptabilisé</span>
      : can('manage_accounting') && <button type="button" className="btn-secondary" disabled={returnWorkflowBusy}
          onClick={() => void postVatReturn(returnDetail)}>Comptabiliser</button>
    : null;

  const printReturn = () => {
    if (!returnDetail || !tenant) return;
    const isCredit = returnDetail.refund_method === 'avoir' || (returnDetail.vat_net_amount != null && returnDetail.status === 'approved');
    const items = returnItemsDetail.map(i => ({ name: i.name, supplier_ref: null, oem_ref: i.articles?.oem_ref || null, quantity: Number(i.quantity), unit_price: Number(i.unit_price),
      discount: returnDetail.vat_net_amount != null ? Number(i.quantity) * Number(i.unit_price) - Number(i.total) : 0 }));
    const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price - i.discount, 0);
    const extra: { label: string; value: string }[] = [];
    if (returnDetail.sales?.sale_number) extra.push({ label: 'Vente liée', value: returnDetail.sales.sale_number });
    printDocumentA4({
      tenant: tenantForPrint(tenant, currentSite),
      docLabel: isCredit ? 'AVOIR' : 'RETOUR',
      docNumber: returnDetail.return_number,
      docDate: new Date(returnDetail.created_at).toLocaleDateString('fr-FR'),
      customer: returnDetail.customers ? { name: returnDetail.customers.name, phone: (returnDetail.customers as any).phone || undefined, address: (returnDetail.customers as any).address || undefined } : null,
      extraMeta: extra,
      items, subtotal, vat: returnDetail, total: Number(returnDetail.total),
      footerNote: returnDetail.reason ? `Motif : ${returnDetail.reason}` : undefined,
      issuedBy: creatorName((returnDetail as any).user_id),
    });
  };

  const hasFilters = !!(search || statusFilter || customerFilter || dateFrom || dateTo || minAmount || maxAmount);
  const clearFilters = () => { setSearch(''); setStatusFilter(''); setCustomerFilter(''); setDateFrom(''); setDateTo(''); setMinAmount(''); setMaxAmount(''); setFiltersOpen(false); };

  // When a tab is active AND the user is filtering, show the filtered count
  // for that tab; otherwise fall back to the site-wide total for that tab.
  const counts: Record<Tab, number> = {
    invoices: tab === 'invoices' && hasFilters ? billTotalCount : tabCounts.invoices,
    quotes:   tab === 'quotes'   && hasFilters ? billTotalCount : tabCounts.quotes,
    returns:  tab === 'returns'  && hasFilters ? billTotalCount : tabCounts.returns,
    credits:  tab === 'credits'  && hasFilters ? billTotalCount : tabCounts.credits,
  };

  const statusOptions = useMemo(() => {
    if (tab === 'quotes') return Object.entries(QUOTE_STATUS).map(([v, s]) => ({ value: v, label: s.label }));
    if (tab === 'invoices') return [
      { value: 'validated', label: 'À crédit' },
      { value: 'partial', label: 'Partiellement payée' },
      { value: 'paid', label: 'Payée' },
      { value: 'cancelled', label: 'Annulée' },
    ];
    if (tab === 'credits') return [
      { value: 'pending', label: 'Brouillon' },
      { value: 'available', label: 'Disponible' },
      { value: 'partial', label: 'Partiel' },
      { value: 'used', label: 'Utilisé' },
      { value: 'rejected', label: 'Rejeté' },
    ];
    return Object.entries(RETURN_STATUS).map(([v, s]) => ({ value: v, label: s.label }));
  }, [tab]);

  const newMenuItems = [
    { key: 'invoice', label: 'Nouvelle facture', icon: FilePlus, action: () => { if (!can('edit_invoices')) { error('Vous n\'avez pas la permission de créer des factures'); return; } openInvoiceEditor(); } },
    { key: 'quote', label: 'Nouveau devis', icon: FileText, action: () => { if (!can('create_quotes')) { error('Vous n\'avez pas la permission de créer des devis'); return; } if (isDesktop) { openDesktopQuoteWindow(null, 'create'); } else { setQuoteEditorMode('create'); setQuoteOpen(true); } } },
    { key: 'return', label: 'Nouveau retour', icon: RotateCcw, action: () => { if (!can('edit_invoices')) { error('Vous n\'avez pas la permission d\'effectuer des retours'); return; } startReturn('return'); } },
    { key: 'credit', label: 'Nouvel avoir', icon: CreditCard, action: () => { if (!can('edit_invoices')) { error('Vous n\'avez pas la permission de créer des avoirs'); return; } startReturn('avoir'); } },
  ];

  const quotePreviewAction = 'clay-action inline-flex h-9 w-9 shrink-0 items-center justify-center';
  const invoiceDue = invoiceDetail ? Math.max(0, Number(invoiceDetail.total) - Number(invoiceDetail.paid)) : 0;

  const pageContent = (
    <div className={isDesktop ? "billing-workspace h-full overflow-y-auto px-4 lg:px-5 pb-6 space-y-3" : "space-y-3 pb-6"}>
      {isDesktop && pendingRecovery && pendingRecovery.length > 0 && (
        <div className="mt-3 mb-1 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 flex items-start gap-2 text-xs text-amber-900">
          <RotateCcw className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-semibold">Travail non enregistré détecté</div>
            <div className="mt-0.5">
              {pendingRecovery.length} fenêtre{pendingRecovery.length > 1 ? 's' : ''} de la session précédente peut être restaurée. Aucun enregistrement ne sera relancé automatiquement.
            </div>
          </div>
          <div className="flex gap-1 shrink-0">
            <button onClick={acceptBillingRecovery} className="px-2 py-1 rounded bg-neutral-900 text-white text-[11px] font-semibold hover:bg-neutral-800 transition">Restaurer</button>
            <button onClick={dismissBillingRecovery} className="px-2 py-1 rounded text-[11px] font-semibold text-amber-600 hover:bg-[var(--w-hover)] transition">Ignorer</button>
          </div>
        </div>
      )}
      {/* ── Header ───────────────────────────────────────────── */}
      <div ref={stickyTopRef} className={`sticky top-0 z-20 pb-3 pt-4 bg-[var(--w-surface)] space-y-3 border-b border-[var(--w-separator)] ${isDesktop ? '-mx-4 lg:-mx-5 px-4 lg:px-5' : '-mx-3 sm:-mx-5 lg:-mx-8 px-3 sm:px-5 lg:px-8 -mt-3 sm:-mt-4 lg:-mt-6'}`}>
      <div className="md:hidden flex items-start justify-between">
        <h1 className="text-lg font-bold text-neutral-900 leading-tight">Facturation</h1>
        <div className="shrink-0">
          {(() => {
            const item = newMenuItems.find(i =>
              (tab === 'invoices' && i.key === 'invoice') ||
              (tab === 'quotes' && i.key === 'quote') ||
              (tab === 'returns' && i.key === 'return') ||
              (tab === 'credits' && i.key === 'credit')
            );
            if (!item) return null;
            const Icon = item.icon;
            return (
              <button onClick={item.action} className="inline-flex min-h-8 items-center gap-1.5 text-sm font-semibold text-[var(--w-text)] hover:underline">
                <Icon className="w-4 h-4" /><span>{item.label}</span>
              </button>
            );
          })()}
        </div>
        </div>
      <div className="md:hidden flex items-center gap-2">
        <Search className="w-4 h-4 text-neutral-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={tab === 'invoices' ? 'N° facture, client ou montant\u2026' : tab === 'quotes' ? 'N° devis, client ou montant\u2026' : 'N°, client ou vente li\u00e9e\u2026'}
            className="w-input-ul w-full text-sm py-1.5"
          />
        </div>
        {search && (
          <button onClick={() => setSearch('')} className="shrink-0 p-1 text-neutral-400 hover:text-neutral-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={() => setFiltersOpen(true)}
          className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
            (statusFilter || customerFilter || dateFrom || dateTo || minAmount || maxAmount)
              ? 'text-brand-700'
              : 'text-neutral-500 hover:text-neutral-700'
          }`}
        >
          <Filter className="w-3.5 h-3.5" />
          <span>Filtres</span>
        </button>
      </div>

      {(() => {
        const sharedCatalog = (tenant as any)?.settings?.shared_articles !== false;
        const interDepot = !!(tenant as any)?.settings?.inter_depot_transfer;
        const availableDepots = depots.filter(d =>
          d.parent_site_id === currentSite?.id || (sharedCatalog && interDepot)
        );
        if (availableDepots.length === 0) return null;
        return (
          <div className="md:hidden flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Stock depuis :</span>
            <select
              value={billSourceSiteId}
              onChange={e => setBillSourceSiteId(e.target.value)}
              className="text-[11px] font-semibold bg-transparent border-b border-slate-300 px-0 py-1 text-slate-700 focus:outline-none focus:border-brand-400"
            >
              {currentSite && <option value={currentSite.id}>{currentSite.name} (Magasin)</option>}
              {availableDepots.map(d => (
                <option key={d.id} value={d.id}>{d.name} (Dépôt)</option>
              ))}
            </select>
          </div>
        );
      })()}

      {/* Desktop: single compact toolbar row – search, filters, depot, action */}
      {(() => {
        const sharedCatalog = (tenant as any)?.settings?.shared_articles !== false;
        const interDepot = !!(tenant as any)?.settings?.inter_depot_transfer;
        const availableDepots = depots.filter(d =>
          d.parent_site_id === currentSite?.id || (sharedCatalog && interDepot)
        );
        const actionItem = newMenuItems.find(i =>
          (tab === 'invoices' && i.key === 'invoice') ||
          (tab === 'quotes' && i.key === 'quote') ||
          (tab === 'returns' && i.key === 'return') ||
          (tab === 'credits' && i.key === 'credit')
        );
        const ActionIcon = actionItem?.icon;
        const filtersActive = !!(statusFilter || customerFilter || dateFrom || dateTo || minAmount || maxAmount);
        return (
          <div className="hidden md:flex items-end gap-4">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400 pointer-events-none" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={tab === 'invoices' ? 'N° facture, client ou montant…' : tab === 'quotes' ? 'N° devis, client ou montant…' : 'N°, client ou vente liée…'}
                className="w-input-ul w-full text-sm py-1.5 pl-5 pr-6"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-600 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button
              onClick={() => setFiltersOpen(true)}
              className={`shrink-0 inline-flex items-center gap-1.5 pb-1.5 text-sm font-semibold transition-colors ${
                filtersActive
                  ? 'text-brand-700 hover:text-brand-800'
                  : 'text-neutral-500 hover:text-neutral-800'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>Filtres</span>
            </button>
            {availableDepots.length > 0 && (
              <div className="shrink-0 inline-flex items-center gap-2 pb-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Stock</span>
                <select
                  value={billSourceSiteId}
                  onChange={e => setBillSourceSiteId(e.target.value)}
                  className="text-xs font-semibold bg-transparent border-0 px-0 py-0 text-neutral-800 focus:outline-none max-w-[200px] cursor-pointer"
                >
                  {currentSite && <option value={currentSite.id}>{currentSite.name} (Magasin)</option>}
                  {availableDepots.map(d => (
                    <option key={d.id} value={d.id}>{d.name} (Dépôt)</option>
                  ))}
                </select>
              </div>
            )}
            {actionItem && ActionIcon && (
              <button
                onClick={actionItem.action}
                className="shrink-0 inline-flex items-center gap-1.5 pb-1.5 text-sm font-semibold text-neutral-700 hover:text-brand-700 transition-colors"
              >
                <ActionIcon className="w-4 h-4" /><span>{actionItem.label}</span>
              </button>
            )}
          </div>
        );
      })()}

      {/* ── Tabs ─────────────────────────────────────────────── */}
      {/* Mobile: centered, dividers, active top border + bg */}
      <div className="md:hidden grid grid-cols-4 items-stretch text-sm -mb-3">
          {TABS.map(t => {
            const active = tab === t.key;
            return (
              <div key={t.key} className="flex min-w-0 items-stretch">
                <button
                  aria-pressed={active}
                  onClick={() => switchTab(t.key)}
                  className={`flex-1 flex items-center justify-center py-2.5 px-1 transition-colors ${
                    active
                      ? 'text-[var(--w-text)] border-b-2 border-[var(--w-text)] font-semibold'
                      : 'text-[var(--w-text-secondary)] border-b-2 border-transparent'
                  }`}
                >
                  {t.label}
                </button>
              </div>
            );
          })}
        </div>
      {/* Desktop: bigger, more impactful tab bar */}
      <div className="hidden md:flex items-center gap-1 -mb-3">
          {TABS.map(t => {
            const active = tab === t.key;
            const count = counts[t.key];
            return (
              <button
                key={t.key}
                aria-pressed={active}
                  onClick={() => switchTab(t.key)}
                className={`shrink-0 inline-flex items-center gap-2 px-3 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                  active
                    ? 'text-[var(--w-text)] border-[var(--w-text)]'
                    : 'text-neutral-500 border-transparent hover:text-neutral-800 hover:border-neutral-200'
                }`}
              >
                <span>{t.label}</span>
                <span className="num text-xs font-medium text-[var(--w-text-secondary)]">{count}</span>
              </button>
            );
          })}
        </div>

      {hasFilters && (
        <div className="flex items-center gap-x-2 flex-wrap text-xs font-medium">
          {statusFilter && <span className="pr-3 py-1 text-[var(--w-text-secondary)]">{statusOptions.find(o => o.value === statusFilter)?.label}</span>}
          {customerFilter && <span className="pr-3 py-1 text-[var(--w-text-secondary)] inline-flex items-center gap-1"><User className="w-3 h-3" />{customers.find(c => c.id === customerFilter)?.name}</span>}
          {(dateFrom || dateTo) && <span className="pr-3 py-1 text-[var(--w-text-secondary)] inline-flex items-center gap-1"><Calendar className="w-3 h-3" />{dateFrom || '…'} → {dateTo || '…'}</span>}
          {(minAmount || maxAmount) && <span className="pr-3 py-1 text-[var(--w-text-secondary)]">{minAmount || '0'} – {maxAmount || '∞'}</span>}
          <button onClick={clearFilters} className="btn-icon" title="Réinitialiser"><RotateCcw className="w-4 h-4" /></button>
        </div>
      )}

      </div>{/* end sticky header */}

      {/* ── Content ──────────────────────────────────────────── */}
      {tabError ? (
        <div className="py-16 flex flex-col items-center gap-3">
          <p className="text-sm text-red-600">{tabError}</p>
          <button onClick={() => { setTabError(null); loadTab(billPage); }} className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-700 hover:text-brand-700 transition-colors"><RefreshCw className="w-4 h-4" />Réessayer</button>
        </div>
      ) : loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
      ) : (
        <>
        {refreshing && (
          <div className="flex items-center justify-center py-1">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-neutral-400" />
          </div>
        )}
          {tab === 'quotes' && (
            filteredQuotes.length === 0 ? (
              <EmptyState icon={FileText} title="Aucun devis" description="Créez votre premier devis." action={<button onClick={() => { if (isDesktop) { openDesktopQuoteWindow(null, 'create'); } else { setQuoteEditorMode('create'); setQuoteOpen(true); } }} className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-700 hover:text-brand-700 transition-colors"><Plus className="w-4 h-4" />Nouveau devis</button>} />
            ) : (
              <div>
                <div className="md:hidden">
                  {filteredQuotes.map(q => {
                    const st = QUOTE_STATUS[q.status] || QUOTE_STATUS.draft;
                    return (
                      <div
                        key={q.id}
                        className="px-1 py-2.5 border-b border-[var(--w-separator-l)]"
                      >
                        <button type="button" onClick={() => openQuoteDetail(q)} className="block w-full text-left hover:bg-[var(--w-hover)]">
                        {/* Line 1: customer only */}
                        <div className="text-xs font-medium text-[var(--w-text)] truncate">{q.customers?.name || 'Client comptoir'}</div>
                        {/* Line 2: quote#, status, date */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                          <span className="text-[13px] font-semibold text-neutral-900 shrink-0">{q.quote_number}</span>
                          <span className={`text-xs font-semibold ${st.pill} shrink-0`}>{st.label}</span>
                          <span className="text-xs text-[var(--w-text-secondary)] shrink-0 num">{formatDate(q.created_at)}{q.valid_until ? ` · Valide ${formatDate(q.valid_until)}` : ''}</span>
                        </div>
                        </button>
                        {/* Line 3: actions + amount */}
                        <div className="flex items-center gap-1 mt-1.5">
                          {q.status === 'accepted' && (
                            <button onClick={() => openConvert(q)} className="shrink-0 inline-flex items-center gap-1 py-1 text-xs font-semibold text-[var(--w-text)] hover:underline"><ArrowRight className="w-3 h-3" />Facturer</button>
                          )}
                          {q.status === 'draft' && <button onClick={e => { e.stopPropagation(); changeQuoteStatus(q, 'sent'); }} className="p-1.5 rounded-md hover:bg-[var(--w-hover)] text-[var(--w-text-muted)] transition" title="Marquer envoyé"><CheckCircle className="w-4 h-4" /></button>}
                          {q.status !== 'converted' && q.status !== 'rejected' && <button onClick={e => { e.stopPropagation(); setQuoteToCancel(q); }} className="p-1.5 rounded-md hover:bg-[var(--w-hover)] text-red-500 transition" title="Refuser"><X className="w-4 h-4" /></button>}
                          <div className="flex-1" />
                          <div className="w-px h-5 bg-neutral-200 mx-1" />
                          <span className="text-sm font-extrabold text-neutral-900 num whitespace-nowrap shrink-0">{formatFCFA(q.total)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="hidden md:block">
                  <div style={{ top: stickyTop }} className="sticky z-10 bg-[var(--w-surface)] flex items-center gap-3 px-2 py-1.5 border-b border-slate-200 text-xs font-semibold text-[var(--w-text-secondary)]">
                    <span className="shrink-0 w-[6.5rem]">N° Devis</span>
                    <span className="shrink-0 hidden billing-extra w-24">Date</span>
                    <span className="flex-1 min-w-0">Client</span>
                    <span className="shrink-0 w-20 text-right">Statut</span>
                    <span className="shrink-0 w-[6.5rem] text-right">Montant</span>
                    <span className="shrink-0 w-16 text-center">Actions</span>
                  </div>
                  {filteredQuotes.map(q => {
                    const st = QUOTE_STATUS[q.status] || QUOTE_STATUS.draft;
                    return (
                      <div key={q.id} onClick={() => openQuoteDetail(q)} className="flex items-center gap-3 px-2 py-2.5 hover:bg-[var(--w-hover)] transition-colors cursor-pointer border-b border-[var(--w-separator-l)]">
                        <span className="doc-number text-sm font-semibold text-[var(--w-text)] shrink-0 w-[6.5rem] truncate">{q.quote_number}</span>
                        <span className="text-xs text-[var(--w-text-secondary)] shrink-0 tabular-nums hidden billing-extra w-24">{formatDate(q.created_at)}</span>
                        <span className="text-sm text-[var(--w-text)] truncate flex-1 min-w-0">{q.customers?.name || <span className="text-slate-400">—</span>}</span>
                        <span className={`text-xs leading-tight font-semibold ${st.pill} shrink-0 w-20 text-right`}>{st.label}</span>
                        <span className="text-sm font-semibold text-[var(--w-text)] tabular-nums shrink-0 w-[6.5rem] text-right">{formatFCFA(q.total)}</span>
                        <div className="flex items-center gap-0.5 shrink-0 w-[4.5rem] justify-center" onClick={e => e.stopPropagation()}>
                          <button onClick={() => openQuoteDetail(q)} className="text-xs font-medium text-[var(--w-text-secondary)] hover:underline" title="Voir">Voir</button>
                          {q.status === 'accepted' && <button onClick={() => openConvert(q)} className="p-1 rounded hover:bg-brand-50 text-brand-700 transition" title="Convertir"><ArrowRight className="w-3.5 h-3.5" /></button>}
                          {q.status === 'draft' && <button onClick={() => changeQuoteStatus(q, 'sent')} className="p-1 rounded hover:bg-[var(--w-hover)] text-[var(--w-text-secondary)] transition" title="Envoyé"><CheckCircle className="w-3.5 h-3.5" /></button>}
                          {q.status !== 'converted' && q.status !== 'rejected' && <button onClick={() => setQuoteToCancel(q)} className="p-1 rounded hover:bg-[var(--w-hover)] text-red-500 transition" title="Refuser"><X className="w-3.5 h-3.5" /></button>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )
          )}

          {tab === 'invoices' && (
            filteredInvoices.length === 0 ? (
              <EmptyState icon={Receipt} title="Aucune facture" description="Les factures créées apparaîtront ici." action={<button onClick={openInvoiceEditor} className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-700 hover:text-brand-700 transition-colors"><Plus className="w-4 h-4" />Nouvelle facture</button>} />
            ) : (
              <>
                <div className="md:hidden">
                  {filteredInvoices.map(inv => {
                    const st = invoiceStatus(inv);
                    const solde = Math.max(0, Number(inv.total) - Number(inv.paid));
                    return (
                      <div
                        key={inv.id}
                        className="px-1 py-2.5 border-b border-[var(--w-separator-l)]"
                      >
                        <button type="button" onClick={() => openInvoiceForView(inv)} className="block w-full text-left hover:bg-[var(--w-hover)]">
                        {/* Line 1: customer only */}
                        <div className="text-xs font-medium text-[var(--w-text)] truncate">{inv.customers?.name || 'Client comptoir'}</div>
                        {/* Line 2: invoice#, status, date */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                          <span className="text-[13px] font-semibold text-neutral-900 shrink-0">{inv.sale_number}</span>
                          <span className={`text-xs font-semibold ${st.pill} shrink-0`}>{st.label}</span>
                          {inv.accounting_status === 'accounted' && <span className="text-xs text-[var(--w-text-secondary)]">Comptabilisée</span>}
                          <span className="text-xs text-[var(--w-text-secondary)] shrink-0 num">{formatDateTime(inv.created_at)}</span>
                        </div>
                        </button>
                        {/* Line 3: icons + paid + amount */}
                        <div className="flex items-center gap-1 mt-1.5">
                          {inv.customers && <button onClick={e => { e.stopPropagation(); quickWhatsApp(inv); }} className="p-1.5 rounded-md hover:bg-[var(--w-hover)] text-[#25D366] transition" title="WhatsApp"><MessageCircle className="w-4 h-4" /></button>}
                          <button onClick={e => { e.stopPropagation(); quickCopy(inv); }} className="p-1.5 rounded-md hover:bg-[var(--w-hover)] text-[var(--w-text-muted)] transition" title="Copier le lien"><Link2 className="w-4 h-4" /></button>
                          {solde > 0 && <span className="text-[10px] text-amber-700 font-bold num shrink-0">Solde {formatFCFA(solde)}</span>}
                          <div className="flex-1" />
                          <div className="w-px h-5 bg-neutral-200 mx-1" />
                          <span className="text-sm font-extrabold text-neutral-900 num whitespace-nowrap shrink-0">{formatFCFA(inv.total)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="hidden md:block">
                  <div style={{ top: stickyTop }} className="sticky z-10 bg-[var(--w-surface)] flex items-center gap-3 px-2 py-1.5 border-b border-slate-200 text-xs font-semibold text-[var(--w-text-secondary)]">
                    <span className="shrink-0 w-[6.5rem]">N° Facture</span>
                    <span className="shrink-0 hidden billing-extra w-[7.5rem]">Date</span>
                    <span className="flex-1 min-w-0">Client</span>
                    <span className="shrink-0 w-[6.5rem] text-right">Total</span>
                    <span className="shrink-0 w-[5.5rem] text-right hidden billing-extra">Payé</span>
                    <span className="shrink-0 w-[5.5rem] text-right hidden billing-extra">Solde</span>
                    <span className="shrink-0 w-24 text-right">Statut</span>
                    <span className="shrink-0 w-[4.5rem] text-center">Actions</span>
                  </div>
                  {filteredInvoices.map(inv => {
                    const st = invoiceStatus(inv);
                    const solde = Math.max(0, Number(inv.total) - Number(inv.paid));
                    return (
                      <div key={inv.id} onClick={() => openInvoiceForView(inv)} className="flex items-center gap-3 px-2 py-2.5 hover:bg-[var(--w-hover)] transition-colors cursor-pointer border-b border-[var(--w-separator-l)]">
                        <span className="doc-number text-sm font-semibold text-[var(--w-text)] shrink-0 w-[6.5rem] truncate">{inv.sale_number}</span>
                        <span className="text-xs text-[var(--w-text-secondary)] shrink-0 tabular-nums hidden billing-extra w-[7.5rem]">{formatDateTime(inv.created_at)}</span>
                        <span className="text-sm text-[var(--w-text)] truncate flex-1 min-w-0">{inv.customers?.name || <span className="text-slate-400">Client comptoir</span>}</span>
                        <span className="text-sm font-semibold text-[var(--w-text)] tabular-nums shrink-0 w-[6.5rem] text-right">{formatFCFA(inv.total)}</span>
                        <span className="text-[11px] text-emerald-700 tabular-nums shrink-0 w-[5.5rem] text-right hidden billing-extra">{formatFCFA(inv.paid)}</span>
                        <span className="text-[11px] tabular-nums shrink-0 w-[5.5rem] text-right hidden billing-extra">{solde > 0 ? <span className="text-amber-700 font-bold">{formatFCFA(solde)}</span> : <span className="text-slate-400">—</span>}</span>
                        <div className="shrink-0 w-24 text-right">
                          <div className={`text-xs leading-tight font-semibold ${st.pill}`}>{st.label}</div>
                          {inv.accounting_status === 'accounted' && <div className="text-xs mt-0.5 text-[var(--w-text-secondary)]">Comptabilisée</div>}
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0 w-[4.5rem] justify-center" onClick={e => e.stopPropagation()}>
                          {inv.customers && <button onClick={() => quickWhatsApp(inv)} className="p-1 rounded hover:bg-[var(--w-hover)] text-[#25D366] transition" title="WhatsApp"><MessageCircle className="w-3.5 h-3.5" /></button>}
                          <button onClick={() => quickCopy(inv)} className="p-1 rounded hover:bg-[var(--w-hover)] text-[var(--w-text-muted)] transition" title="Copier"><Link2 className="w-3.5 h-3.5" /></button>
                          <button onClick={() => openInvoiceForView(inv)} className="text-xs font-medium text-[var(--w-text-secondary)] hover:underline" title="Voir">Voir</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )
          )}

          {(tab === 'returns' || tab === 'credits') && (
            (tab === 'returns' ? filteredReturns : filteredCredits).length === 0 ? (
              <EmptyState
                icon={tab === 'returns' ? RotateCcw : Wallet}
                title={tab === 'returns' ? 'Aucun retour' : 'Aucun avoir'}
                description={tab === 'returns' ? 'Les retours clients apparaîtront ici.' : 'Les avoirs clients apparaîtront ici.'}
                action={<button onClick={() => startReturn(tab === 'returns' ? 'return' : 'avoir')} className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-700 hover:text-brand-700 transition-colors"><Plus className="w-4 h-4" />{tab === 'returns' ? 'Nouveau retour' : 'Nouvel avoir'}</button>}
              />
            ) : (
              <div>
                <div className="md:hidden">
                  {(tab === 'returns' ? filteredReturns : filteredCredits).map(r => {
                    const st = tab === 'credits' ? creditStatus(r) : (RETURN_STATUS[r.status] || RETURN_STATUS.pending);
                    const isCredit = tab === 'credits';
                    const used = Number(r.credit_used || 0);
                    const balance = Number(r.total) - used;
                    return (
                      <button
                        key={r.id}
                        onClick={() => openReturnDetail(r)}
                        className="w-full text-left px-1 py-2.5 border-b border-neutral-100 hover:bg-[var(--w-hover)] transition-colors"
                      >
        {/* Line 1: customer only */}
                        <div className="text-xs font-medium text-[var(--w-text)] truncate">{r.customers?.name || 'Client comptoir'}</div>
                        {/* Line 2: doc# + status */}
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[13px] font-semibold text-neutral-900 shrink-0">{r.return_number}</span>
                          <span className={`text-xs font-semibold ${st.pill} shrink-0`}>{st.label}</span>
                        </div>
                        {/* Line 3: date + sale ref */}
                        <div className="text-xs text-[var(--w-text-secondary)] num mt-0.5 truncate">
                          {formatDateTime(r.created_at)}{r.sales?.sale_number && <> · Vente {r.sales.sale_number}</>}
                        </div>
                        {/* Line 4: balance + amount */}
                        <div className="flex items-center gap-1 mt-1.5">
                          {isCredit && used > 0 && <span className="text-[10px] text-neutral-500 font-bold num shrink-0">Solde {formatFCFA(balance)}</span>}
                          <div className="flex-1" />
                          <div className="w-px h-5 bg-neutral-200 mx-1" />
                          <span className={`text-sm font-extrabold num whitespace-nowrap shrink-0 ${isCredit ? 'text-neutral-900' : 'text-red-700'}`}>{isCredit ? '' : '-'}{formatFCFA(r.total)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="hidden md:block">
                  <div style={{ top: stickyTop }} className="sticky z-10 bg-[var(--w-surface)] flex items-center gap-3 px-2 py-1.5 border-b border-slate-200 text-xs font-semibold text-[var(--w-text-secondary)]">
                    <span className="shrink-0 w-[6.5rem]">N° Document</span>
                    <span className="shrink-0 hidden billing-extra w-[7.5rem]">Date</span>
                    <span className="flex-1 min-w-0">Client</span>
                    {tab === 'returns' && <span className="hidden billing-extra shrink-0 w-12 text-center">Stock</span>}
                    {tab === 'credits' && <span className="hidden billing-extra shrink-0 w-[5.5rem] text-right">Utilisé</span>}
                    <span className="shrink-0 w-20 text-right">Statut</span>
                    <span className="shrink-0 w-[6.5rem] text-right">Montant</span>
                    <span className="shrink-0 w-12 text-center">Action</span>
                  </div>
                  {(tab === 'returns' ? filteredReturns : filteredCredits).map(r => {
                    const st = tab === 'credits' ? creditStatus(r) : (RETURN_STATUS[r.status] || RETURN_STATUS.pending);
                    const isCredit = tab === 'credits';
                    const used = Number(r.credit_used || 0);
                    return (
                      <div key={r.id} onClick={() => openReturnDetail(r)} className="flex items-center gap-3 px-2 py-2.5 hover:bg-[var(--w-hover)] transition-colors cursor-pointer border-b border-[var(--w-separator-l)]">
                        <span className="doc-number text-sm font-semibold text-[var(--w-text)] shrink-0 w-[6.5rem] truncate">{r.return_number}</span>
                        <span className="text-xs text-[var(--w-text-secondary)] shrink-0 tabular-nums hidden billing-extra w-[7.5rem]">{formatDateTime(r.created_at)}</span>
                        <span className="text-sm text-[var(--w-text)] truncate flex-1 min-w-0">{r.customers?.name || <span className="text-slate-400">—</span>}</span>
                        {tab === 'returns' && <span className="hidden billing-extra shrink-0 w-12 text-center">{r.restock ? <span className="text-xs text-[var(--w-text)]">Oui</span> : <span className="text-slate-400 text-[10px]">Non</span>}</span>}
                        {tab === 'credits' && <span className="hidden billing-extra shrink-0 w-[5.5rem] text-right text-[11px] text-slate-600 tabular-nums">{formatFCFA(used)}</span>}
                        <span className={`text-xs leading-tight font-semibold ${st.pill} shrink-0 w-20 text-right`}>{st.label}</span>
                        <span className={`text-[12px] font-bold tabular-nums shrink-0 w-[6.5rem] text-right ${isCredit ? 'text-neutral-800' : 'text-red-700'}`}>{isCredit ? '' : '-'}{formatFCFA(r.total)}</span>
                        <div className="flex items-center shrink-0 w-12 justify-center">
                          <button onClick={e => { e.stopPropagation(); openReturnDetail(r); }} className="text-xs font-medium text-[var(--w-text-secondary)] hover:underline" title="Voir">Voir</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )
          )}
          {/* ── Pagination ───────────────────────────────────────── */}
          {billTotalCount > PAGE_SIZE && (
            <div className="flex items-center justify-between px-3 py-3 mt-3">
              <div className="text-xs text-slate-500">
                {billPage * PAGE_SIZE + 1}–{Math.min((billPage + 1) * PAGE_SIZE, billTotalCount)} sur {billTotalCount}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setBillPage(0)} disabled={billPage === 0} className="px-2 py-1 rounded-lg text-[11px] font-semibold text-[var(--w-text-secondary)] hover:bg-[var(--w-hover)] disabled:opacity-30 disabled:cursor-not-allowed">{'<<'}</button>
                <button onClick={() => setBillPage(p => Math.max(0, p - 1))} disabled={billPage === 0} className="px-2 py-1 rounded-lg text-[11px] font-semibold text-[var(--w-text-secondary)] hover:bg-[var(--w-hover)] disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="px-3 py-1 rounded-lg text-xs font-semibold text-[var(--w-text)]">{billPage + 1} / {Math.max(1, Math.ceil(billTotalCount / PAGE_SIZE))}</span>
                <button onClick={() => setBillPage(p => p + 1)} disabled={!billHasMore} className="px-2 py-1 rounded-lg text-[11px] font-semibold text-[var(--w-text-secondary)] hover:bg-[var(--w-hover)] disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setBillPage(Math.ceil(billTotalCount / PAGE_SIZE) - 1)} disabled={!billHasMore} className="px-2 py-1 rounded-lg text-[11px] font-semibold text-[var(--w-text-secondary)] hover:bg-[var(--w-hover)] disabled:opacity-30 disabled:cursor-not-allowed">{'>>'}</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Filters Modal (Premium date range picker + extra filters) ────── */}
      <PremiumDateRangePicker
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        from={dateFrom}
        to={dateTo}
        onApply={(f, t) => { setDateFrom(f); setDateTo(t); setFiltersOpen(false); }}
        onReset={clearFilters}
        extraFilters={
          <div>
            <div className="text-[10px] font-semibold text-slate-500 mb-0.5">Statut</div>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="w-full px-2 py-1 text-[10px] font-medium border border-slate-200 rounded-md bg-white text-slate-700 outline-none focus:border-slate-400"
            >
              <option value="">Tous</option>
              {statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        }
      />
    </div>
  );

  return (
    <>
      {/* ── Page window (desktop) / inline content (mobile) ──────────── */}
      {isDesktop && pageWindowOpen && (
        <DesktopWindow
          id={BILLING_PAGE_ID}
          title="Facturation"
          icon={<ClipboardList className="w-4 h-4" />}
          onClose={closeBillingPage}
          minW={480}
          minH={320}
          background
          startMaximized
          groupId={BILLING_GROUP}
        >
          <div className="flex flex-col h-full min-h-0">
            <div className="flex-1 min-h-0 overflow-hidden">{pageContent}</div>
            {(() => {
              const groupMinimized = wmWindows.filter(w => w.groupId === BILLING_GROUP && w.id !== BILLING_PAGE_ID && w.minimized);
              if (groupMinimized.length === 0) return null;
              return (
                <div className="shrink-0 h-9 border-t border-[var(--w-separator)] bg-[var(--w-surface-el)] flex items-center gap-1 px-2 overflow-x-auto">
                  {groupMinimized.map(w => (
                    <button
                      key={w.id}
                      onClick={() => { restoreWindow(w.id); focusWindow(w.id); }}
                      className="flex items-center gap-1.5 px-2.5 h-7 rounded-md bg-[var(--w-hover)] hover:bg-[var(--w-active)] text-xs font-medium text-[var(--w-text)] transition-colors truncate max-w-[220px]"
                    >
                      {w.icon && <span className="[&>svg]:w-3.5 [&>svg]:h-3.5 text-[var(--w-text-muted)]">{w.icon}</span>}
                      <span className="truncate">{w.title}</span>
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        </DesktopWindow>
      )}
      {!isDesktop && visible && pageContent}

      {/* ── Multi-instance invoice windows (desktop) ────────────────────── */}
      {isDesktop && Array.from(invoiceWindows.values()).map(desc => (
        <DesktopWindow
          key={desc.windowId}
          id={desc.windowId}
          title={desc.invoiceId ? `Facture ${invoices.find(i => i.id === desc.invoiceId)?.sale_number || ''}` : 'Nouvelle Facture'}
          icon={<FileText className="w-4 h-4" />}
          onClose={() => closeInvoiceWindow(desc.windowId)}
          siteId={desc.siteId || undefined}
          startMaximized
          minW={600}
          minH={400}
          groupId={BILLING_GROUP}
        >
          <InvoiceEditorInstance
            descriptor={desc}
            articles={articles}
            customers={customers}
            articleTiers={articleTiers}
            invoices={invoices}
            sales={sales}
            paymentMethods={paymentMethods}
            docSettings={docSettings}
            autoMode={autoMode}
            isPharmacy={isPharmacy}
            activeReps={activeReps}
            salesReps={salesReps}
            repSettings={repSettings}
            profileNames={profileNames}
            billSourceSiteId={billSourceSiteId}
            onClose={() => closeInvoiceWindow(desc.windowId)}
            onSaved={() => loadTab(billPage, true)}
            onInvoiceCreated={handleInvoiceCreated}
            onOpenNew={() => openInvoiceEditor()}
            onOpenPay={(inv) => openPay(inv)}
            onOpenCredit={can('edit_invoices') ? (inv) => openCreditApply(inv) : undefined}
            onCancelInvoice={(inv) => cancelInvoice(inv)}
            onComptabiliser={can('manage_accounting') ? comptabiliserFromEditor : undefined}
            accountingBusy={accountingBusy}
            onCopyLink={(inv) => copyInvoiceLink(inv)}
            onWhatsApp={(inv) => sendInvoiceWhatsApp(inv)}
            onReturnTransform={async (config, saleId) => {
              if (!tenant || !currentSite) { error('Magasin introuvable'); return; }
              if (!can('edit_invoices')) { error('Permission insuffisante'); return; }
              const sel = config.selectedItems.filter((i: any) => i.selected && i.quantity > 0);
              if (sel.length === 0) { error('Sélectionnez au moins un article'); return; }
              setSaving(true);
              const { data: sourceInvoice } = await supabase.from('sales')
                .select('id, sale_number, site_id, vat_net_amount, customers(name, phone, address)')
                .eq('id', saleId).maybeSingle();
              if (!sourceInvoice) { error('Facture introuvable'); setSaving(false); return; }
              if (sourceInvoice.vat_net_amount != null) {
                const ret = await prepareVatReturn(saleId, sourceInvoice.site_id, sel, config.reason, config.restock, false);
                setSaving(false);
                if (!ret) return;
                closeInvoiceWindow(desc.windowId);
                await loadTab(billPage, true);
                await openReturnDetail({ ...ret, customers: Array.isArray(sourceInvoice.customers) ? sourceInvoice.customers[0] ?? null : sourceInvoice.customers, sales: { sale_number: sourceInvoice.sale_number } });
                success('Retour enregistré. Choisissez le mode de remboursement.');
                return;
              }
              const localReturnTotal = sel.reduce((s: number, i: any) => s + Number(i.quantity) * Number(i.unit_price), 0);
              const { data: ipmVente } = await supabase.from('ipm_ventes')
                .select('id, part_ipm, part_client, montant_total, bordereau_id, statut')
                .eq('sale_id', saleId).limit(1).maybeSingle();
              let refundTotal = localReturnTotal;
              if (ipmVente && ipmVente.montant_total > 0) {
                const ipmRatio = Number(ipmVente.part_client) / Number(ipmVente.montant_total);
                refundTotal = Math.round(localReturnTotal * ipmRatio);
              }
              const { data: numData } = await supabase.rpc('next_doc_number', { p_tenant_id: tenant.id, p_kind: 'return', p_prefix: 'RET' });
              const rNum = (numData as string) || ('RET-' + Date.now());
              const { data: sale } = await supabase.from('sales').select('id, customer_id, sale_number, customers(name, phone, address)').eq('id', saleId).maybeSingle();
              if (!sale) { error('Facture introuvable'); setSaving(false); return; }
              const { data: ret, error: e } = await supabase.from('sale_returns').insert({
                tenant_id: tenant.id, site_id: currentSite.id,
                sale_id: saleId, customer_id: sale.customer_id || null,
                return_number: rNum, total: refundTotal,
                refund_method: 'pending', reason: config.reason,
                restock: config.restock, status: 'pending',
              }).select().single();
              if (e || !ret) { error(e?.message || 'Erreur'); setSaving(false); return; }
              await supabase.from('sale_return_items').insert(sel.map((i: any) => ({
                tenant_id: tenant.id, return_id: ret.id, article_id: i.article_id, sale_item_id: i.item_id, name: i.name,
                quantity: i.quantity, unit_price: i.unit_price, purchase_cost: i.purchase_cost || 0, total: i.quantity * i.unit_price,
              })));
              if (config.restock) {
                for (const item of sel) {
                  await supabase.rpc('adjust_stock', {
                    p_article_id: item.article_id, p_site_id: billSourceSiteId || currentSite.id,
                    p_quantity: item.quantity, p_movement_type: 'return_customer',
                    p_note: `Retour ${rNum}`,
                  });
                }
              }
              if (ipmVente) {
                const saleTotal = Number(ipmVente.montant_total);
                if (localReturnTotal >= saleTotal) {
                  await supabase.from('ipm_ventes').update({ statut: 'annulee', bordereau_id: null }).eq('id', ipmVente.id);
                } else {
                  const newTotal = saleTotal - localReturnTotal;
                  const oldRatio = Number(ipmVente.part_ipm) / saleTotal;
                  await supabase.from('ipm_ventes').update({
                    montant_total: newTotal, part_ipm: Math.round(newTotal * oldRatio),
                    part_client: newTotal - Math.round(newTotal * oldRatio), bordereau_id: null,
                  }).eq('id', ipmVente.id);
                }
              }
              setSaving(false);
              success('Retour enregistré — choisissez le mode de remboursement');
              closeInvoiceWindow(desc.windowId);
              await loadTab(billPage, true);
              openReturnDetail({ ...ret, customers: sale?.customers || null, sales: { sale_number: sale.sale_number } } as SaleReturn);
            }}
            onSearchOpen={() => setInvoiceSearchOpen(true)}
            onVehiclePicker={(idx) => { setVehiclePickerTargetIdx(idx); setVehiclePickerOpen(true); }}
            onCreateArticle={(name) => { setQuickArticleName(name); setQuickArticleOpen(true); }}
            onCreateCustomer={(name) => { setQuickCustomerName(name); setQuickCustomerOpen(true); }}
            onTierPicker={(art, idx) => { setTierPickerArticle(art); setTierPickerTarget('invoice'); setTierPickerIdx(idx); setTierPickerOpen(true); }}
          />
        </DesktopWindow>
      ))}
      {visible && mobileInvoiceOpen && !isDesktop && mobileInvoiceMode === 'view' && (() => {
        const listedInvoice = invoices[invoiceNavIdx];
        const viewInv = invoiceDetail?.id === mobileEditingInvoiceId ? invoiceDetail : listedInvoice?.id === mobileEditingInvoiceId ? listedInvoice : null;
        if (!viewInv) return null;
        const invDue = Math.max(0, Number(viewInv.total) - Number(viewInv.paid));
        const isCancelled = viewInv.status === 'cancelled';
        const isAccounted = viewInv.accounting_status === 'accounted';
        return (
          <MobileInvoiceDetail
            invoice={viewInv}
            items={invoiceEditorItems}
            payments={invoicePayList}
            docHeader={{
              doc_date: invoiceForm.doc_date || null,
              reference: invoiceForm.reference || null,
              delivery_date: invoiceForm.delivery_date || null,
              warranty: invoiceForm.warranty || null,
              representative: repLabelOf(invoiceForm.representative) || null,
              imei: invoiceForm.imei || null,
            }}
            onClose={closeInvoiceEditor}
            onEdit={!isCancelled && !isAccounted ? () => openInvoiceForEdit(viewInv) : undefined}
            onApplyCredit={can('edit_invoices') && viewInv.customer_id && invDue > 0 && !isCancelled ? () => openCreditApply(viewInv) : undefined}
            onReturn={can('edit_invoices') && !isCancelled ? () => startReturn('return', viewInv) : undefined}
            onPay={invDue > 0 && !isCancelled ? () => openPay(viewInv) : undefined}
            onPrint={() => {
              const pitems = invoiceEditorItems.filter(i => i.name.trim()).map(i => ({
                name: i.name, supplier_ref: null, oem_ref: null,
                quantity: Number(i.quantity), unit_price: Number(i.unit_price), discount: Number(i.discount || 0),
              }));
              const psubtotal = pitems.reduce((s, i) => s + i.quantity * i.unit_price - (i.discount || 0), 0);
              printDocumentA4({
                tenant: tenantForPrint(tenant, currentSite),
                docLabel: 'FACTURE',
                docNumber: viewInv.sale_number,
                docDate: invoiceForm.doc_date || new Date(viewInv.created_at).toLocaleDateString('fr-FR'),
                customer: viewInv.customers ? {
                  name: viewInv.customers.name,
                  phone: viewInv.customers.phone || undefined,
                  address: viewInv.customers.address || undefined,
                } : null,
                items: pitems, subtotal: psubtotal, discount: Number(viewInv.discount ?? 0), vat: viewInv, total: Number(viewInv.total),
                payments: invoicePayList.map(p => ({ method_name: p.method_name, amount: p.amount })),
                paid: Number(viewInv.paid),
                issuedBy: creatorName((viewInv as any).user_id),
                docHeader: invoiceForm.reference || invoiceForm.delivery_date || invoiceForm.warranty || invoiceForm.imei || repLabelOf(invoiceForm.representative) ? {
                  reference: invoiceForm.reference || null, delivery_date: invoiceForm.delivery_date || null,
                  warranty: invoiceForm.warranty || null, representative: repLabelOf(invoiceForm.representative),
                  imei: invoiceForm.imei || null,
                } : null,
              });
            }}
            onCopyLink={() => copyInvoiceLink(viewInv)}
            onWhatsApp={viewInv.customers ? () => sendInvoiceWhatsApp(viewInv) : undefined}
            onComptabiliser={can('manage_accounting') && !isAccounted && !isCancelled ? () => comptabiliserFromEditor(viewInv) : undefined}
            accountingBusy={accountingBusy}
            onCancel={!isCancelled && !isAccounted ? () => setCancelTarget(viewInv) : undefined}
          />
        );
      })()}
      {visible && mobileInvoiceOpen && !isDesktop && mobileInvoiceMode !== 'view' && (
        <MobileBillingWizard
          open={true}
          onClose={closeInvoiceEditor}
          title={mobileEditingInvoiceId ? 'Modifier la facture' : 'Nouvelle facture'}
          editBlocked={mobileEditBlocked}
          onActivity={mobileLease.markActivity}
          editLeaseBanner={mobileInvoiceMode==='edit'?<div className="px-3 pt-2"><DocumentEditLeaseBar lease={mobileLease} dirty={mobileDirty} saving={savingInvoice} label="cette facture" onSaveAndRelease={mobileSnapshot.ready?()=>void saveInvoice():undefined}/><InvoiceEditSnapshotBar state={mobileSnapshot}/></div>:undefined}
          headerFields={[
            { key: 'customer_id', label: 'Client', type: 'select', options: customers.map(c => ({ value: c.id, label: c.name })), placeholder: 'Client comptoir' },
            { key: 'doc_date', label: 'Date', type: 'date' as const },
            ...(docSettings.show_reference ? [{ key: 'reference', label: 'Référence', type: 'text' as const, placeholder: 'REF-...' }] : []),
            ...(docSettings.show_delivery_date ? [{ key: 'delivery_date', label: 'Date de livraison', type: 'date' as const }] : []),
            ...(docSettings.show_warranty ? [{ key: 'warranty', label: 'Garantie', type: 'text' as const, placeholder: 'Ex: 6 mois' }] : []),
            ...(docSettings.show_imei ? [{ key: 'imei', label: 'IMEI', type: 'text' as const, placeholder: 'Numéro IMEI' }] : []),
            ...(docSettings.show_representative ? [{ key: 'representative', label: 'Représentant', type: 'select' as const, options: activeReps.map(r => ({ value: r.id, label: repDisplayName(r) })), placeholder: 'Aucun représentant' }] : []),
          ]}
          headerValues={invoiceForm}
          onHeaderChange={(k, v) => setInvoiceForm(f => ({ ...f, [k]: v }))}
          items={invoiceEditorItems}
          onAddItem={(articleId) => addArticleWithTierCheck(articleId, 'invoice')}
          onUpdateItem={(idx, field, val) => updateInvoiceItem(idx, field as any, val)}
          onRemoveItem={(idx) => setInvoiceEditorItems(p => p.filter((_, i) => i !== idx))}
          articles={articles}
          saving={savingInvoice}
          onSave={saveInvoice}
          total={invoiceEditorSubtotal}
          vatSummary={invoicePricing.price?.enabled ? invoicePricing.price : undefined}
          saveLabel={mobileEditingInvoiceId ? 'Mettre à jour' : 'Enregistrer facture'}
          onCreateArticle={(name) => { setQuickArticleName(name); setQuickArticleOpen(true); }}
          onCreateCustomer={(name) => { setQuickCustomerName(name); setQuickCustomerOpen(true); }}
          banner={isPharmacy && invoiceForm.customer_id && ipmBeneficiaire ? (
            <div className="px-4 py-2 bg-teal-50 border-b border-teal-200 space-y-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-teal-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-bold text-teal-800 truncate">
                    IPM — {ipmBeneficiaire.ipm_organismes?.nom} ({ipmTaux}%)
                  </p>
                  {invoiceEditorSubtotalRaw > 0 && (
                    <p className="text-[10px] text-teal-600">
                      Part IPM : {formatFCFA(ipmPartIpm)} · Part client : {formatFCFA(ipmPartClient)}
                    </p>
                  )}
                </div>
              </div>
              {ipmConfig && (ipmConfig.ordonnance_obligatoire || ipmConfig.numero_ordonnance_obligatoire || ipmConfig.medecin_prescripteur_obligatoire || ipmConfig.bon_prise_en_charge_obligatoire || ipmConfig.numero_bon_obligatoire) && (
                <div className="grid grid-cols-1 gap-1.5">
                  {(ipmConfig.ordonnance_obligatoire || ipmConfig.numero_ordonnance_obligatoire) && (
                    <input className="w-full text-[11px] px-2 py-1 rounded border border-teal-300 bg-white" placeholder="N° ordonnance *" value={ipmDocuments.numero_ordonnance} onChange={e => setIpmDocuments(d => ({ ...d, numero_ordonnance: e.target.value }))} />
                  )}
                  {ipmConfig.medecin_prescripteur_obligatoire && (
                    <input className="w-full text-[11px] px-2 py-1 rounded border border-teal-300 bg-white" placeholder="Médecin prescripteur *" value={ipmDocuments.medecin} onChange={e => setIpmDocuments(d => ({ ...d, medecin: e.target.value }))} />
                  )}
                  {(ipmConfig.bon_prise_en_charge_obligatoire || ipmConfig.numero_bon_obligatoire) && (
                    <input className="w-full text-[11px] px-2 py-1 rounded border border-teal-300 bg-white" placeholder="N° bon de prise en charge *" value={ipmDocuments.numero_bon} onChange={e => setIpmDocuments(d => ({ ...d, numero_bon: e.target.value }))} />
                  )}
                  {!ipmDocValidation.valide && (
                    <p className="text-[10px] text-red-600 font-medium">Manquant : {ipmDocValidation.champs_manquants.join(', ')}</p>
                  )}
                </div>
              )}
            </div>
          ) : undefined}
        />
      )}
      {/* ── Multi-instance quote windows (desktop) ────────────────────── */}
      {isDesktop && Array.from(quoteWindows.values()).map(desc => (
        <DesktopWindow
          key={desc.windowId}
          id={desc.windowId}
          title={desc.quoteId ? `Devis ${quotes.find(q => q.id === desc.quoteId)?.quote_number || ''}` : 'Nouveau Devis'}
          icon={<FileText className="w-4 h-4" />}
          onClose={() => closeQuoteWindow(desc.windowId)}
          siteId={desc.siteId || undefined}
          initialRect={{ x: 80 + (quoteWindows.size - 1) * 30, y: 40 + (quoteWindows.size - 1) * 20, w: Math.min(1400, window.innerWidth - 120), h: Math.min(900, window.innerHeight - 80) }}
          minW={600}
          minH={400}
          groupId={BILLING_GROUP}
        >
          <QuoteEditorInstance
            descriptor={desc}
            articles={articles}
            customers={customers}
            articleTiers={articleTiers}
            docSettings={quoteDocSettings}
            autoMode={autoMode}
            isPharmacy={isPharmacy}
            activeReps={activeReps}
            profileNames={profileNames}
            onClose={() => closeQuoteWindow(desc.windowId)}
            onSaved={() => loadTab(billPage, true)}
            onConvert={(q) => openConvert(q)}
            onCreated={(quoteId, quoteNumber) => {
              setQuoteWindows(prev => {
                const next = new Map(prev);
                const current = next.get(desc.windowId);
                if (current) next.set(desc.windowId, { ...current, quoteId, mode: 'view' });
                return next;
              });
              updateWindowTitle(desc.windowId, `Devis ${quoteNumber}`);
            }}
            onVehiclePicker={(idx) => { setVehiclePickerTargetIdx(idx); setVehiclePickerOpen(true); }}
            onCreateArticle={(name) => { setQuickArticleName(name); setQuickArticleOpen(true); }}
            onCreateCustomer={(name) => { setQuickCustomerName(name); setQuickCustomerOpen(true); }}
            onTierPicker={(art, idx) => { setTierPickerArticle(art); setTierPickerTarget('quote'); setTierPickerIdx(idx); setTierPickerOpen(true); }}
          />
        </DesktopWindow>
      ))}

      {/* ── Quote create modal (mobile only) ──────────────────────────────── */}
      {quoteOpen && !isDesktop && (
        <MobileBillingWizard
          open={true}
          onClose={closeQuotePanel}
          title={editingQuoteId ? 'Modifier le devis' : 'Nouveau devis'}
          editBlocked={quoteEditBlocked}
          onActivity={quoteLease.markActivity}
          editLeaseBanner={editingQuoteId?<div className="px-3 pt-2"><DocumentEditLeaseBar lease={quoteLease} dirty={quoteDirty} saving={saving} label="ce devis" onSaveAndRelease={quoteSnapshot.ready?()=>void saveQuote():undefined}/><InvoiceEditSnapshotBar state={quoteSnapshot} document="devis"/></div>:undefined}
          headerFields={[
            { key: 'customer_id', label: 'Client', type: 'select', options: customers.map(c => ({ value: c.id, label: c.name })), placeholder: 'Client comptoir' },
            { key: 'valid_until', label: 'Valide jusqu\'au', type: 'date' },
            ...(quoteDocSettings.show_reference ? [{ key: 'reference', label: 'Référence', type: 'text' as const, placeholder: 'REF-...' }] : []),
            ...(quoteDocSettings.show_delivery_date ? [{ key: 'delivery_date', label: 'Date de livraison', type: 'date' as const }] : []),
            ...(quoteDocSettings.show_warranty ? [{ key: 'warranty', label: 'Garantie', type: 'text' as const, placeholder: 'Ex: 6 mois' }] : []),
            ...(quoteDocSettings.show_imei ? [{ key: 'imei', label: 'IMEI', type: 'text' as const, placeholder: 'Numéro IMEI' }] : []),
            ...(quoteDocSettings.show_representative ? [{ key: 'representative', label: 'Représentant', type: 'select' as const, options: activeReps.map(r => ({ value: r.id, label: repDisplayName(r) })), placeholder: 'Aucun représentant' }] : []),
            { key: 'note', label: 'Note', type: 'text', placeholder: 'Note optionnelle...' },
          ]}
          headerValues={quoteForm}
          onHeaderChange={(k, v) => setQuoteForm((f: any) => ({ ...f, [k]: v }))}
          items={quoteItems}
          onAddItem={(articleId) => addArticleWithTierCheck(articleId, 'quote')}
          onUpdateItem={(idx, field, val) => updateQuoteItem(idx, field as any, val)}
          onRemoveItem={(idx) => setQuoteItems(p => p.filter((_, i) => i !== idx))}
          articles={articles}
          saving={saving}
          onSave={() => saveQuote()}
          total={quoteSubtotal}
          saveLabel="Enregistrer devis"
          onCreateArticle={(name) => { setQuickArticleName(name); setQuickArticleOpen(true); }}
          onCreateCustomer={(name) => { setQuickCustomerName(name); setQuickCustomerOpen(true); }}
          banner={isPharmacy && quoteForm.customer_id && quoteIpmBeneficiaire ? (
            <div className="px-4 py-2 bg-teal-50 border-b border-teal-200">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-teal-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-bold text-teal-800 truncate">
                    IPM — {quoteIpmBeneficiaire.ipm_organismes?.nom} ({quoteIpmTaux}%)
                  </p>
                  {quoteSubtotal > 0 && quoteIpmPartIpm > 0 && (
                    <p className="text-[10px] text-teal-600">
                      Part IPM : {formatFCFA(quoteIpmPartIpm)} · Part client : {formatFCFA(quoteIpmPartClient)}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : undefined}
        />
      )}

      {/* ── Return full-screen viewer ──────────────────────────────── */}
      {visible && isDesktop && returnEditorOpen && returnDetail && (
        <DesktopWindow
          id="billing-return-viewer"
          title={`${returnDetail.refund_method === 'avoir' ? 'Avoir' : 'Retour'} ${returnDetail.return_number}`}
          icon={<RotateCcw className="w-4 h-4" />}
          onClose={closeReturnDetail}
          initialRect={{ x: 100, y: 50, w: Math.min(1200, window.innerWidth - 140), h: Math.min(800, window.innerHeight - 100) }}
          minW={500}
          minH={350}
          groupId={BILLING_GROUP}
        >
        <DocumentEditor
          embedded
          docType="return"
          mode="view"
          vat={returnDetail}
          documentTotal={Number(returnDetail.total)}
          additionalActions={vatReturnAction}
          articles={articles}
          customers={customers}
          headerForm={{
            customer_id: returnDetail.customer_id || '',
            doc_date: returnDetail.created_at ? new Date(returnDetail.created_at).toLocaleDateString('sv-SE',{timeZone:'Africa/Dakar'}) : '',
            note: returnDetail.reason || '',
            delivery_date: '',
            reference: returnDetail.sales?.sale_number ? `Vente ${returnDetail.sales.sale_number}` : '',
            warranty: '',
            representative: '',
            imei: '',
            valid_until: '',
          }}
          setHeaderForm={() => {}}
          items={returnItemsDetail.map((i: any) => ({
            id: i.id,
            article_id: i.article_id,
            name: i.name,
            quantity: Number(i.quantity),
            unit_price: Number(i.unit_price),
            discount: 0,
            total: returnDetail.vat_net_amount != null ? Number(i.total) : Number(i.quantity) * Number(i.unit_price),
          }))}
          setItems={() => {}}
          subtotal={returnItemsDetail.reduce((s: number, i: any) => s + Number(i.quantity) * Number(i.unit_price), 0)}
          saving={false}
          onSave={() => {}}
          onClose={closeReturnDetail}
          editingId={returnDetail.id}
          documentNumber={returnDetail.return_number}
          documentStatus={returnDetail.status}
          docSettings={docSettings}
          onPrint={printReturn}
          onRefundCash={returnDetail.status === 'pending' && can('edit_invoices') ? () => { setReturnDetailError(null); setReturnCashConfirmOpen(true); } : undefined}
          onApproveAvoir={returnDetail.status === 'pending' && returnDetail.customer_id && can('edit_invoices') ? () => approveAsAvoir(returnDetail) : undefined}
        />
        </DesktopWindow>
      )}

      {/* ── Quote detail ─────────────────────────────────────── */}
      <Modal open={visible && !!quoteDetail} onClose={() => setQuoteDetail(null)} title={quoteDetail ? `Devis ${quoteDetail.quote_number}` : ''} size="lg" clayPreviewActions
        footer={<>
          <div className="flex gap-1.5 mr-auto">
            {quoteDetail&&can('edit_quotes')&&['draft','sent'].includes(quoteDetail.status)&&<button onClick={()=>editMobileQuote(quoteDetail)} className={quotePreviewAction} title="Modifier"><Pencil className="w-4 h-4"/></button>}
            {quoteDetail?.status === 'draft' && <button onClick={() => changeQuoteStatus(quoteDetail, 'sent')} className={quotePreviewAction} title="Marquer envoyé"><CheckCircle className="w-4 h-4" /></button>}
            {quoteDetail && ['draft', 'sent'].includes(quoteDetail.status) && <button onClick={() => changeQuoteStatus(quoteDetail, 'accepted')} className={quotePreviewAction} title="Accepter"><CheckCircle className="w-4 h-4" /></button>}
            {quoteDetail?.status === 'accepted' && <button onClick={() => openConvert(quoteDetail)} className={quotePreviewAction} title="Convertir en facture"><ArrowRight className="w-4 h-4" /></button>}
          </div>
          <button onClick={() => setQuoteDetail(null)} className={quotePreviewAction} title="Fermer"><X className="w-4 h-4" /></button>
          <button onClick={printQuote} className={quotePreviewAction} title="Imprimer"><Printer className="w-4 h-4" /></button>
        </>}>
        {quoteDetail && (() => {
          const st = QUOTE_STATUS[quoteDetail.status] || QUOTE_STATUS.draft;
          const slimStatus: DocStatusConfig = {
            label: st.label,
            color: quoteDetail.status === 'accepted' ? 'emerald' : quoteDetail.status === 'rejected' ? 'rose' : quoteDetail.status === 'converted' ? 'teal' : quoteDetail.status === 'sent' ? 'blue' : quoteDetail.status === 'expired' ? 'amber' : 'slate',
          };
          return (
            <div className="space-y-4">
              <DocSlimHeader
                status={slimStatus}
                customerName={quoteDetail.customers?.name ?? null}
                date={formatDate(quoteDetail.created_at)}
                extra={quoteDetail.valid_until ? `Valide ${formatDate(quoteDetail.valid_until)}` : undefined}
                docHeader={(quoteDetail as any).doc_header ? { ...(quoteDetail as any).doc_header, created_at: quoteDetail.created_at } : null}
              />
              <div className="space-y-3">
                <DocSectionTitle title="Articles" count={quoteItemsDetail.length} />
                <DocItems items={quoteItemsDetail.map(i => ({
                  id: i.id,
                  name: i.name,
                  internal_ref: i.articles?.internal_ref || null,
                  oem_ref: i.articles?.oem_ref || null,
                  quantity: Number(i.quantity),
                  unit_price: Number(i.unit_price),
                  discount: Number(i.discount ?? 0),
                  total: Number(i.total),
                }) satisfies DocItem)} />
                <DocTotals
                  subtotal={quoteItemsDetail.reduce((s, i) => s + Number(i.total), 0)}
                  total={Number(quoteDetail.total)}
                />
              </div>
              {quoteDetail.note && <div className="p-3 bg-[var(--w-surface-el)] rounded-xl text-sm text-slate-600 border border-slate-200/70"><span className="font-semibold">Note :</span> {quoteDetail.note}</div>}
            </div>
          );
        })()}
      </Modal>

      <ConfirmDialog open={!!quoteToCancel} onClose={() => setQuoteToCancel(null)} onConfirm={async () => { if (!quoteToCancel) return; await changeQuoteStatus(quoteToCancel, 'rejected'); setQuoteToCancel(null); }} title="Refuser le devis ?" message={`Le devis "${quoteToCancel?.quote_number}" sera marqué comme refusé.`} danger />

      {/* ── Convert quote → sale ─────────────────────────────── */}
      <Modal open={!!convertFrom} onClose={() => !converting && setConvertFrom(null)} title="Convertir en facture" size="sm" layer="top"
        footer={<>
          <button onClick={() => setConvertFrom(null)} className="btn-icon" title="Annuler" disabled={converting}><X className="w-4 h-4" /></button>
          <button onClick={confirmConvert} disabled={converting || !convertPricing.price || (!!convertIpmBeneficiaire && !!convertIpmConvention && !validerDocumentsIpm(parseConvention(convertIpmConvention)!, convertIpmDocs, convertIpmBeneficiaire?.matricule).valide)} className="btn-icon-primary" title="Créer facture">{converting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}</button>
        </>}>
        {convertFrom && (() => {
          const convertIpmCfg = parseConvention(convertIpmConvention);
          const convertIpmCalc = convertIpmBeneficiaire && convertIpmCfg ? calculerIpm(convertIpmCfg, [{ montant_ligne: convertFrom.total, ipm_eligible: true }], 0) : null;
          const convertDocValid = convertIpmCfg ? validerDocumentsIpm(convertIpmCfg, convertIpmDocs, convertIpmBeneficiaire?.matricule) : { valide: true, champs_manquants: [] };
          return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-brand-700/70">Devis source</div>
                  <div className="doc-number text-sm font-bold text-brand-900 mt-0.5">{convertFrom.quote_number}</div>
                  <div className="text-[11px] text-slate-600 mt-0.5">{convertFrom.customers?.name || 'Client comptoir'}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-brand-700/70">Total de la facture</div>
                  {convertPricing.price?.enabled && <div className="text-[11px] text-slate-600">HT {formatVatAmount(convertPricing.price.ht)} · TVA {formatVatAmount(convertPricing.price.vat)}</div>}
                  <div className="text-lg font-bold text-brand-900 num">{convertPricing.price ? formatVatAmount(convertTtc) : convertPricing.error ? 'Montant indisponible' : 'Calcul…'}</div>
                  {convertPricing.error && <button type="button" className="text-xs font-semibold underline" onClick={convertPricing.refresh}>Recalculer</button>}
                </div>
              </div>

            {/* IPM Banner */}
            {convertIpmBeneficiaire && convertIpmCalc && (
              <div className="p-3 rounded-xl bg-teal-50 border border-teal-200 space-y-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-teal-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-teal-800">{convertIpmBeneficiaire.ipm_organismes?.nom}</p>
                    <p className="text-[10px] text-teal-600">
                      Taux : {convertIpmCfg?.taux_defaut || 0}% — Part IPM : {formatFCFA(convertIpmCalc.part_ipm)} · Part client : {formatFCFA(convertIpmCalc.part_client)}
                    </p>
                  </div>
                </div>
                {convertIpmCfg && (convertIpmCfg.ordonnance_obligatoire || convertIpmCfg.numero_ordonnance_obligatoire || convertIpmCfg.medecin_prescripteur_obligatoire || convertIpmCfg.bon_prise_en_charge_obligatoire || convertIpmCfg.numero_bon_obligatoire) && (
                  <div className="space-y-1.5 pt-1 border-t border-teal-200">
                    <p className="text-[10px] font-bold text-teal-700 uppercase tracking-wide">Documents obligatoires</p>
                    <div className="flex flex-col gap-1.5">
                      {(convertIpmCfg.ordonnance_obligatoire || convertIpmCfg.numero_ordonnance_obligatoire) && (
                        <input className="text-[11px] px-2.5 py-1.5 rounded-lg border border-teal-300 bg-white w-full" placeholder="N° ordonnance *" value={convertIpmDocs.numero_ordonnance} onChange={e => setConvertIpmDocs(d => ({ ...d, numero_ordonnance: e.target.value }))} />
                      )}
                      {convertIpmCfg.medecin_prescripteur_obligatoire && (
                        <input className="text-[11px] px-2.5 py-1.5 rounded-lg border border-teal-300 bg-white w-full" placeholder="Médecin prescripteur *" value={convertIpmDocs.medecin} onChange={e => setConvertIpmDocs(d => ({ ...d, medecin: e.target.value }))} />
                      )}
                      {(convertIpmCfg.bon_prise_en_charge_obligatoire || convertIpmCfg.numero_bon_obligatoire) && (
                        <input className="text-[11px] px-2.5 py-1.5 rounded-lg border border-teal-300 bg-white w-full" placeholder="N° bon de prise en charge *" value={convertIpmDocs.numero_bon} onChange={e => setConvertIpmDocs(d => ({ ...d, numero_bon: e.target.value }))} />
                      )}
                    </div>
                    {!convertDocValid.valide && (
                      <p className="text-[10px] text-red-600 font-medium">Champs manquants : {convertDocValid.champs_manquants.join(', ')}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            <label className="flex items-center gap-2 cursor-pointer p-3 rounded-xl border border-slate-200 hover:bg-[var(--w-surface-el)] transition-colors">
              <input type="checkbox" checked={convertPayNow} onChange={e => setConvertPayNow(e.target.checked)} className="w-4 h-4 rounded" />
              <div className="flex-1">
                <div className="text-sm font-semibold text-slate-800">Encaisser immédiatement</div>
                <div className="text-[11px] text-slate-500">
                  {convertIpmCalc ? `Part client à encaisser : ${formatFCFA(convertIpmCalc.part_client)}` : 'Sinon, la facture reste à payer plus tard'}
                </div>
              </div>
            </label>

            {convertPayNow && (
              <div className="space-y-2">
                <div>
                  <label className="label">Mode de règlement</label>
                  <select value={convertPayMethod} onChange={e => setConvertPayMethod(e.target.value)} className="input">
                    {paymentMethods.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Montant encaissé{convertIpmCalc ? ` (Part client: ${formatFCFA(convertIpmCalc.part_client)})` : ''}</label>
                  <input type="number" value={convertPayAmount} onChange={e => setConvertPayAmount(e.target.value)} className="input num text-lg font-bold" />
                </div>
              </div>
            )}

            <div className="text-[11px] text-slate-500 p-3 rounded-xl bg-[var(--w-surface-el)] border border-slate-200/70">
              Le devis sera marqué comme <strong>converti</strong> et une nouvelle facture sera créée avec les mêmes articles.
              {convertIpmCalc && <span className="block mt-1 text-teal-700 font-medium">La prise en charge IPM ({formatFCFA(convertIpmCalc.part_ipm)}) sera enregistrée automatiquement.</span>}
            </div>
          </div>
          );
        })()}
      </Modal>

      <LotPickerModal
        open={lotPickerConvertOpen}
        onClose={() => setLotPickerConvertOpen(false)}
        items={convertItems.flatMap(item => item.article_id ? [{ ...item, article_id: item.article_id }] : [])}
        onConfirm={(selections) => { setLotPickerConvertOpen(false); executeConvert(selections); }}
        title="Sélection des lots (Facturation)"
        confirmLabel="Confirmer & Facturer"
      />

      {/* Tier picker modal */}
      {tierPickerOpen && tierPickerArticle && (() => {
        const tiers = articleTiers.filter(t => t.article_id === tierPickerArticle.id);
        const defaultPrice = tierPickerArticle.sale_price || 0;
        return (
          <Modal open={tierPickerOpen} onClose={() => { setTierPickerOpen(false); setTierPickerArticle(null); }} title="Choisir le tarif" size="sm">
            <div className="space-y-2">
              <p className="text-xs text-slate-500 mb-3">Sélectionnez le tarif à appliquer pour <span className="font-semibold text-slate-700">{tierPickerArticle.name}</span></p>
              <button onClick={() => addArticleWithSelectedTier('', defaultPrice)} className="w-full text-left px-4 py-3 rounded-xl border border-slate-200 hover:border-brand-300 hover:bg-brand-50/30 transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-900">Prix standard</span>
                  <span className="text-sm font-bold text-slate-900 num">{formatFCFA(defaultPrice)}</span>
                </div>
              </button>
              {tiers.map(t => (
                <button key={t.tier_name} onClick={() => addArticleWithSelectedTier(t.tier_name, t.price)} className="w-full text-left px-4 py-3 rounded-xl border border-slate-200 hover:border-brand-300 hover:bg-brand-50/30 transition-all">
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

      {/* ── Register payment modal ───────────────────────────── */}
      {payOpen && invoiceDetail && createPortal(
        <div className="fixed inset-0 flex items-center justify-center bg-black/20" style={{ zIndex: payLayer.zIndex }} onClick={e => { if (e.target === e.currentTarget && !paying && payLayer.isTop) setPayOpen(false); }}>
          <div className="bg-white w-full max-w-sm rounded-lg shadow-xl mx-4 flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 bg-neutral-900 rounded-t-lg flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-sm font-bold text-white">Encaisser la facture</h3>
                <p className="text-[11px] text-neutral-400 mt-0.5">{invoiceDetail.sale_number}</p>
              </div>
              <button onClick={() => !paying && setPayOpen(false)} className="p-1 rounded hover:bg-white/10 text-neutral-400"><X className="w-4 h-4" /></button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-3">
              <div className="flex items-center justify-between px-2 py-2 border-b border-neutral-200">
                <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Solde dû</div>
                <div className="num text-base font-bold text-neutral-900">{formatFCFA(invoiceDue)}</div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1 block">Mode de règlement</label>
                <select value={payMethod} onChange={e => setPayMethod(e.target.value)} className="w-full text-xs h-8 px-1 bg-transparent border-b border-neutral-300 focus:border-neutral-900 outline-none transition-colors">
                  {paymentMethods.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1 block">Montant encaissé</label>
                <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)} className="w-full text-xs h-8 px-1 bg-transparent border-b border-neutral-300 focus:border-neutral-900 outline-none transition-colors num font-bold" />
                <div className="flex gap-1.5 mt-2">
                  <button type="button" onClick={() => setPayAmount(String(invoiceDue))} className="text-[10px] font-bold px-2 py-1 rounded bg-[var(--w-bg-secondary)] hover:bg-[var(--w-hover)] text-[var(--w-text-secondary)] uppercase tracking-wider">Solde total</button>
                  <button type="button" onClick={() => setPayAmount(String(Math.round(invoiceDue / 2)))} className="text-[10px] font-bold px-2 py-1 rounded bg-[var(--w-bg-secondary)] hover:bg-[var(--w-hover)] text-[var(--w-text-secondary)] uppercase tracking-wider">Moitié</button>
                </div>
              </div>
            </div>

            <div className="px-4 py-3 border-t border-neutral-100 flex items-center justify-end gap-2 flex-shrink-0">
              <button onClick={() => setPayOpen(false)} disabled={paying} className="px-3 py-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-700 transition-colors disabled:opacity-40">Annuler</button>
              <button onClick={registerPayment} disabled={paying} className="px-4 py-1.5 text-xs font-semibold bg-neutral-900 text-white rounded hover:bg-neutral-800 disabled:opacity-40 transition-colors flex items-center gap-1">
                {paying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Coins className="w-3 h-3" />} Encaisser
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {visible && creditOpen && invoiceDetail && (() => {
        const close = () => { if (!applyingCredit) setCreditOpen(false); };
        const selectedCredit = availableCredits.find(credit => credit.id === creditSelected);
        const available = selectedCredit ? Number(selectedCredit.total) - Number(selectedCredit.credit_used ?? 0) : 0;
        const content = (
          <fieldset disabled={applyingCredit} className="min-w-0 space-y-4">
            <p className="flex items-center justify-between gap-2 border-b border-[var(--w-separator)] pb-3 text-sm">
              <span>Solde à payer</span><strong className="whitespace-nowrap tabular-nums">{formatVatAmount(invoiceDue)}</strong>
            </p>
            {availableCredits.length > 0 ? <>
              <label className="block text-sm font-semibold">
                Avoir disponible
                <select value={creditSelected} onChange={event => {
                  const credit = availableCredits.find(item => item.id === event.target.value);
                  setCreditSelected(event.target.value);
                  setApplyCreditError(null);
                  setCreditAmount(credit ? String(Math.min(invoiceDue, Number(credit.total) - Number(credit.credit_used ?? 0))) : '');
                }} className="mt-1 block min-h-11 w-full border-b border-[var(--w-separator)] bg-transparent text-base font-normal">
                  <option value="">Choisir un avoir</option>
                  {availableCredits.map(credit => <option key={credit.id} value={credit.id}>
                    {credit.return_number} · {formatVatAmount(Number(credit.total) - Number(credit.credit_used ?? 0))}
                  </option>)}
                </select>
              </label>
              <label className="block text-sm font-semibold">
                Montant à appliquer
                <input type="number" inputMode="decimal" min="0.01" step="0.01" max={Math.min(invoiceDue, available)}
                  value={creditAmount} onChange={event => { setCreditAmount(event.target.value); setApplyCreditError(null); }}
                  className="mt-1 block min-h-11 w-full border-b border-[var(--w-separator)] bg-transparent text-base font-normal tabular-nums" />
              </label>
            </> : <p className="text-sm text-[var(--w-text-secondary)]">Aucun avoir disponible pour ce client dans ce magasin.</p>}
          </fieldset>
        );
        const footer = <>
          {applyCreditError && <p role="alert" className="w-full text-sm text-red-700">{applyCreditError}</p>}
          <div className="flex w-full items-center gap-2">
            {isDesktop && <button type="button" disabled={applyingCredit} onClick={close} className="min-h-11 px-3 text-sm font-medium">Annuler</button>}
            <button type="button" disabled={applyingCredit || !creditSelected} onClick={() => void applyCredit()}
              className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md bg-neutral-900 px-3 text-sm font-semibold text-white disabled:opacity-40">
              {applyingCredit && <Loader2 size={16} className="animate-spin" />} Appliquer l’avoir
            </button>
          </div>
        </>;
        return isDesktop
          ? <Modal open title="Appliquer un avoir" onClose={close} size="sm" layer="top" focusOnOpen footer={footer}>{content}</Modal>
          : <MobileReturnScreen title="Appliquer un avoir" subtitle={invoiceDetail.sale_number} busy={applyingCredit} onClose={close} footer={footer}>{content}</MobileReturnScreen>;
      })()}

      {visible && returnOpen && (() => {
        const title = returnMode === 'avoir' ? 'Nouvel avoir client' : 'Nouveau retour client';
        const label = returnMode === 'avoir' ? 'Créer l’avoir' : 'Enregistrer le retour';
        const saleOptions = returnOrigin && !sales.some(sale => sale.id === returnOrigin.id) ? [returnOrigin, ...sales] : sales;
        const origins = saleOptions
          .filter(sale => returnMode === 'return' || !!sale.customer_id)
          .map(sale => ({
            id: sale.id,
            reference: sale.sale_number,
            customer: sale.customers?.name || 'Client comptoir',
            total: Number(sale.total),
          }));
        const hasLines = returnLines.some(line => line.selected && line.quantity > 0);
        const fields = <BillingReturnFields
          origins={origins} saleId={returnForm.sale_id} lines={returnLines} loading={returnLoad.busy} loadError={returnLoad.error}
          reason={returnForm.reason} restock={returnForm.restock} busy={saving}
          onSale={handleSaleChange} onRetry={() => void handleSaleChange(returnForm.sale_id)}
          onLine={(id, values) => setReturnLines(previous => previous.map(line => line.item_id === id ? { ...line, ...values } : line))}
          onReason={reason => setReturnForm(f => ({ ...f, reason }))}
          onRestock={restock => setReturnForm(f => ({ ...f, restock }))}
        />;
        const footer = <>
          {returnError && <p role="alert" className="w-full text-sm text-red-700">{returnError}</p>}
          {hasLines && <div className="flex w-full items-center justify-between gap-2 text-sm" aria-live="polite">
            <span className="text-[var(--w-text-secondary)]">Montant estimé</span>
            <strong className="whitespace-nowrap tabular-nums">{formatVatAmount(returnTotal)}</strong>
          </div>}
          <div className="flex w-full items-center gap-2">
            {isDesktop && <button type="button" onClick={closeReturnForm} disabled={saving} className="min-h-11 px-3 text-sm font-medium">Annuler</button>}
            <button type="button" onClick={() => void saveReturn()} disabled={saving || returnLoad.busy || !hasLines}
              className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md bg-neutral-900 px-4 text-sm font-semibold text-white disabled:opacity-40">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} {label}
            </button>
          </div>
        </>;
        return isDesktop
          ? <Modal open title={title} onClose={() => !saving && closeReturnForm()} size="lg" layer="top" focusOnOpen footer={footer}>{fields}</Modal>
          : <MobileReturnScreen title={title} onClose={closeReturnForm} busy={saving} footer={footer}>{fields}</MobileReturnScreen>;
      })()}

      {visible && !isDesktop && returnDetail && (
        <MobileReturnDetail
          document={returnDetail}
          status={(returnDetail.refund_method === 'avoir' ? creditStatus(returnDetail) : RETURN_STATUS[returnDetail.status] || RETURN_STATUS.pending).label}
          items={returnItemsDetail} loading={returnDetailLoad.busy} loadError={returnDetailLoad.error}
          busy={returnWorkflowBusy} error={returnDetailError} confirmingCash={returnCashConfirmOpen}
          canProcess={can('edit_invoices') && !returnDetailLoad.busy && !returnDetailLoad.error}
          canPost={can('manage_accounting') && !returnDetailLoad.busy && !returnDetailLoad.error}
          onClose={closeReturnDetail} onPrint={printReturn} onRetry={() => void openReturnDetail(returnDetail)}
          onCash={() => { setReturnDetailError(null); setReturnCashConfirmOpen(true); }}
          onCancelCash={() => { setReturnDetailError(null); setReturnCashConfirmOpen(false); }}
          onConfirmCash={() => void approveAsCash(returnDetail)}
          onCredit={() => void approveAsAvoir(returnDetail)} onPost={() => void postVatReturn(returnDetail)}
        />
      )}

      {visible && isDesktop && returnDetail && (
        <ConfirmDialog
          open={returnCashConfirmOpen}
          onClose={() => !returnWorkflowBusy && setReturnCashConfirmOpen(false)}
          onConfirm={() => void approveAsCash(returnDetail)}
          title="Rembourser en caisse ?"
          message={returnDetailError || `Le montant de ${formatFCFA(Number(returnDetail.total))} sera enregistré comme sortie de caisse.`}
          confirmLabel="Confirmer le remboursement"
          layer="top"
        />
      )}

      {cancelTarget && createPortal(
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4" style={{ zIndex: cancelLayer.zIndex }} onClick={(e) => { if (e.target === e.currentTarget && !cancelling && cancelLayer.isTop) { setCancelTarget(null); setCancelReason(''); } }}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-[min(90vw,420px)] space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0">
                <Ban className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-neutral-900">Annuler la facture</h3>
                <p className="text-xs text-neutral-500">Facture {cancelTarget.sale_number} - {formatFCFA(Number(cancelTarget.total))}</p>
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5 block">Motif d'annulation *</label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Indiquez le motif de l'annulation…"
                rows={2}
                className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs text-neutral-800 focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400 resize-none"
              />
            </div>

            {Number(cancelTarget.paid) > 0 && (
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5 block">Gestion du paiement encaissé</label>
                <div className="space-y-2">
                  <button
                    onClick={() => setCancelPaymentAction('keep_credit')}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${cancelPaymentAction === 'keep_credit' ? 'border-amber-400' : 'border-neutral-200 hover:bg-neutral-50'}`}
                  >
                    <Wallet className="w-4 h-4 text-amber-600 shrink-0" />
                    <div className="flex-1">
                      <div className="text-xs font-semibold text-neutral-800">Conserver comme crédit client</div>
                      <div className="text-[10px] text-neutral-500">L'argent reste encaissé et devient un crédit traçable</div>
                    </div>
                  </button>
                  <button
                    onClick={() => setCancelPaymentAction('refund_cash')}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${cancelPaymentAction === 'refund_cash' ? 'border-red-400' : 'border-neutral-200 hover:bg-neutral-50'}`}
                  >
                    <RotateCcw className="w-4 h-4 text-red-500 shrink-0" />
                    <div className="flex-1">
                      <div className="text-xs font-semibold text-neutral-800">Rembourser le client</div>
                      <div className="text-[10px] text-neutral-500">Crée une sortie financière et diminue la caisse</div>
                    </div>
                  </button>
                </div>
              </div>
            )}

            <div className="bg-neutral-50 rounded-lg p-3 text-[10px] text-neutral-500 space-y-1">
              <p>• Le stock sera restauré sur le dépôt source</p>
              <p>• La garantie liée sera marquée comme annulée</p>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button disabled={cancelling} onClick={() => { setCancelTarget(null); setCancelReason(''); }} className="px-3 py-1.5 text-xs font-medium text-[var(--w-text-secondary)] hover:bg-[var(--w-hover)] rounded transition-colors disabled:opacity-50">Non, garder</button>
              <button disabled={cancelling || !cancelReason.trim()} onClick={confirmCancelInvoice} className="px-3 py-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded transition-colors disabled:opacity-50 inline-flex items-center gap-1.5">{cancelling && <Loader2 className="w-3 h-3 animate-spin" />}Oui, annuler</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {autoMode && tenant && currentSite && (
        <VehicleArticlePicker
          open={vehiclePickerOpen}
          onClose={() => setVehiclePickerOpen(false)}
          onSelect={a => {
            const targetUpdate = mobileInvoiceOpen ? updateInvoiceItem : updateQuoteItem;
            const targetSet = mobileInvoiceOpen ? setInvoiceEditorItems : setQuoteItems;
            if (vehiclePickerTargetIdx !== null) {
              targetUpdate(vehiclePickerTargetIdx, 'article_id', a.id);
            } else {
              targetSet((p: QuoteItem[]) => [...p, { article_id: a.id, name: a.name, quantity: 1, unit_price: a.sale_price, discount: 0, total: a.sale_price }]);
            }
          }}
          priceMode="sale"
          tenantId={tenant.id}
          siteId={currentSite.id}
        />
      )}

      <QuickCreateArticleModal
        open={quickArticleOpen}
        onClose={() => setQuickArticleOpen(false)}
        onCreated={(a) => { setArticles(prev => [a, ...prev]); }}
        initialName={quickArticleName}
      />
      <QuickCreateCustomerModal
        open={quickCustomerOpen}
        onClose={() => setQuickCustomerOpen(false)}
        onCreated={(c) => { setCustomers(prev => [c, ...prev]); }}
        initialName={quickCustomerName}
      />

      {/* ── Invoice search modal (Atteindre une facture) ── */}
      {invoiceSearchOpen && <InvoiceSearchModal
        tenant={tenant}
        currentSite={currentSite}
        onClose={() => { setInvoiceSearchOpen(false); setInvoiceSearchQuery(''); }}
        query={invoiceSearchQuery}
        setQuery={setInvoiceSearchQuery}
        onSelect={(inv) => { setInvoiceSearchOpen(false); setInvoiceSearchQuery(''); openInvoiceForView(inv); }}
      />}
    </>
  );
}

function InvoiceSearchModal({ tenant, currentSite, onClose, query, setQuery, onSelect }: {
  tenant: any; currentSite: any;
  onClose: () => void; query: string; setQuery: (v: string) => void;
  onSelect: (inv: Invoice) => void;
}) {
  const [results, setResults] = useState<Invoice[]>([]);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [initial, setInitial] = useState(true);
  const reqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (!tenant || !currentSite) return;
    const myId = ++reqRef.current;
    setSearching(true);
    setErr(null);
    const params: Record<string, any> = {
      p_tenant_id: tenant.id,
      p_site_id: currentSite.id,
      p_page_size: q.trim() ? 30 : 20,
      p_search: q.trim() || null,
    };
    const { data, error: rpcErr } = await supabase.rpc('rpc_paginated_invoices', params);
    if (myId !== reqRef.current) return;
    if (rpcErr || !data) { setErr(rpcErr?.message || 'Erreur'); setSearching(false); return; }
    setResults((data.rows || []).map((r: any) => ({ ...r, customers: r.customer_name ? { name: r.customer_name } : null })) as Invoice[]);
    setSearching(false);
    setInitial(false);
  }, [tenant, currentSite]);

  useEffect(() => { doSearch(''); }, [doSearch]);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(query), 250);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query, doSearch]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[10vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white w-full max-w-md rounded-xl shadow-2xl overflow-hidden max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-4 pt-4 pb-2">
          <input autoFocus type="text" placeholder="Rechercher une facture (n°, client, montant)…"
            className="w-input-ul text-sm pb-2"
            value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <div className="overflow-y-auto flex-1 px-2 pb-2">
          {searching && initial ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-neutral-400" /></div>
          ) : err ? (
            <div className="text-center text-sm text-red-500 py-6">{err}</div>
          ) : results.length === 0 ? (
            <div className="text-center text-sm text-slate-400 py-6">Aucune facture trouvée</div>
          ) : (
            results.map(inv => (
              <button key={inv.id} onClick={() => onSelect(inv)}
                className="w-full text-left px-3 py-2.5 hover:bg-[var(--w-surface-el)] rounded-lg transition-colors flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 doc-number">{inv.sale_number}</div>
                  <div className="text-[11px] text-slate-500 truncate">{inv.customers?.name || 'Client comptoir'}</div>
                </div>
                <div className="text-sm font-bold text-slate-700 num shrink-0">{formatFCFA(inv.total)}</div>
              </button>
            ))
          )}
          {searching && !initial && <div className="flex justify-center py-2"><Loader2 className="w-4 h-4 animate-spin text-neutral-300" /></div>}
        </div>
      </div>
    </div>
  );
}
