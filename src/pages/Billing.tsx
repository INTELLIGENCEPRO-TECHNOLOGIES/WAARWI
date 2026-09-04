import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus, FileText, Loader2, Printer, CheckCircle, X, Trash2, Car,
  Receipt, RotateCcw, Wallet, Minus, Package, Filter, Check, Calendar, CalendarDays, User,
  CreditCard, ShoppingCart, ArrowRight, Coins, MessageCircle, Link2, Search, GripVertical, Lock, BookOpen,
  Tag, ShieldCheck, Smartphone, Pencil, ChevronLeft, ChevronRight, RefreshCw, Ban,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { usePermissions } from '../lib/permissions';
import { useToast } from '../context/ToastContext';
import { Modal, ConfirmDialog, DocPanel } from '../components/Modal';
import { PremiumDateRangePicker } from '../components/PremiumDateRangePicker';
import { SearchableSelect } from '../components/SearchableSelect';
import { EmptyState } from '../components/EmptyState';
import { VehicleArticlePicker } from '../components/VehicleArticlePicker';
import { isAutoParts } from '../lib/types';
import { formatFCFA, formatDate, formatDateTime } from '../lib/format';
import { printDocumentA4, buildPrintTenantForSite, type PrintTenant } from '../lib/print';
import { consumeNavContext } from '../lib/navHighlight';
import { DocItems, DocTotals, DocPayments, DocSectionTitle, DocSlimHeader } from '../components/DocLayout';
import { calculerIpm, parseConvention, validerDocumentsIpm, type IpmArticleLine, type IpmDocuments as IpmDocsType } from '../lib/ipm';
import type { DocItem, DocPayment, DocStatusConfig } from '../components/DocLayout';
import { MobileBillingWizard, type WizardHeaderField } from '../components/MobileBillingWizard';
import { MobileInvoiceDetail } from '../components/MobileInvoiceDetail';
import { LotPickerModal, type ArticleLotSelection } from '../components/LotPickerModal';
import { type DocSettings, type DocColumn, DEFAULT_COLUMNS, DEFAULT_DOC_SETTINGS, mergeColumns } from '../components/DocumentSettingsTab';
import { QuickCreateArticleModal, QuickCreateCustomerModal, QuickCreateButton } from '../components/QuickCreate';
import { type SalesRepresentative, type RepCommissionSettings, DEFAULT_REP_SETTINGS, computeRepCommission, repDisplayName } from '../lib/repCommission';
import { DocumentEditor } from '../components/DocumentEditor';

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
type Invoice = {
  id: string; sale_number: string; total: number; paid: number; status: string;
  customer_id: string | null;
  created_at: string;
  public_code?: string | null;
  accounting_status?: string;
  user_id?: string | null;
  representative_id?: string | null;
  rep_commission?: any;
  customers: { name: string } | null;
};
type SaleReturn = {
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
  pending:  { label: 'Brouillon', pill: 'text-amber-600', dot: '' },
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

export function Billing({ onNavigate }: { onNavigate?: (r: string) => void }) {
  const { tenant, currentSite, sites, depots, dataTick, profile } = useApp();
  const { can } = usePermissions();
  const autoMode = isAutoParts(tenant);
  const { success, error } = useToast();

  const [tab, setTab] = useState<Tab>('invoices');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
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
  const [billTotals, setBillTotals] = useState<any>({});
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

  // Quote modals
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quoteEditorMode, setQuoteEditorMode] = useState<'create' | 'edit' | 'view'>('create');
  const [quoteDetail, setQuoteDetail] = useState<Quote | null>(null);
  const [quoteItemsDetail, setQuoteItemsDetail] = useState<any[]>([]);
  const [quoteForm, setQuoteForm] = useState<{ customer_id: string; valid_until: string; note: string; delivery_date: string; reference: string; warranty: string; representative: string; imei: string }>({ customer_id: '', valid_until: '', note: '', delivery_date: '', reference: '', warranty: '', representative: '', imei: '' });
  const [quoteItems, setQuoteItems] = useState<QuoteItem[]>([{ article_id: null, name: '', quantity: 1, unit_price: 0, discount: 0, total: 0 }]);
  const [quoteToCancel, setQuoteToCancel] = useState<Quote | null>(null);
  const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false);
  const [vehiclePickerTargetIdx, setVehiclePickerTargetIdx] = useState<number | null>(null);
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [editingQuote, setEditingQuote] = useState<Quote | null>(null);
  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024;

  // IPM for quotes (pharmacy only) - state declarations only
  const [quoteIpmBeneficiaire, setQuoteIpmBeneficiaire] = useState<any>(null);
  const [quoteIpmConvention, setQuoteIpmConvention] = useState<any>(null);
  const quoteIpmConfig = useMemo(() => parseConvention(quoteIpmConvention), [quoteIpmConvention]);

  // Conversion modal
  const [convertFrom, setConvertFrom] = useState<Quote | null>(null);
  const [convertPayNow, setConvertPayNow] = useState(false);
  const [convertPayMethod, setConvertPayMethod] = useState('');
  const [convertPayAmount, setConvertPayAmount] = useState('');
  const [converting, setConverting] = useState(false);
  const [convertItems, setConvertItems] = useState<{ article_id: string; name: string; quantity: number }[]>([]);
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
  const [invoiceItems, setInvoiceItems] = useState<any[]>([]);
  const [invoicePays, setInvoicePays] = useState<any[]>([]);
  const [invoiceIpmVente, setInvoiceIpmVente] = useState<any>(null);
  const [accountingBusy, setAccountingBusy] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payMethod, setPayMethod] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [paying, setPaying] = useState(false);

  // Apply credit
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditSelected, setCreditSelected] = useState<string>('');
  const [creditAmount, setCreditAmount] = useState('');
  const [applyingCredit, setApplyingCredit] = useState(false);

  // Return modals
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnMode, setReturnMode] = useState<'return' | 'avoir'>('return');
  const [returnDetail, setReturnDetail] = useState<SaleReturn | null>(null);
  const [returnItemsDetail, setReturnItemsDetail] = useState<any[]>([]);
  const [returnEditorOpen, setReturnEditorOpen] = useState(false);
  const [returnForm, setReturnForm] = useState({ sale_id: '', reason: '', refund_method: 'cash' as string, restock: true });
  const [returnLines, setReturnLines] = useState<{ item_id: string; article_id: string; name: string; max_qty: number; quantity: number; unit_price: number; purchase_cost: number; selected: boolean }[]>([]);
  const [returnWorkflowBusy, setReturnWorkflowBusy] = useState(false);
  const [returnCashConfirmOpen, setReturnCashConfirmOpen] = useState(false);
  const [returnedQtys, setReturnedQtys] = useState<Record<string, number>>({});
  // returnedQtys no longer filters invoices — kept for compat but always empty

  // Direct invoice creation
  const [invoiceEditorOpen, setInvoiceEditorOpen] = useState(false);
  const [invoiceEditorMode, setInvoiceEditorMode] = useState<'create' | 'edit' | 'view'>('create');
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [invoiceForm, setInvoiceForm] = useState<{ customer_id: string; doc_date: string; delivery_date: string; reference: string; warranty: string; representative: string; imei: string }>({ customer_id: '', doc_date: new Date().toISOString().slice(0, 10), delivery_date: '', reference: '', warranty: '', representative: '', imei: '' });
  const [invoicePostCreation, setInvoicePostCreation] = useState<{ saleNumber: string; createdAt: string; createdBy: string } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Invoice | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelPaymentAction, setCancelPaymentAction] = useState<'keep_credit' | 'refund_cash' | 'none'>('none');
  const [invoiceEditorItems, setInvoiceEditorItems] = useState<QuoteItem[]>([{ article_id: null, name: '', quantity: 1, unit_price: 0, discount: 0, total: 0 }]);
  const [invoicePayList, setInvoicePayList] = useState<{ method_id: string; method_name: string; amount: number; reference: string }[]>([]);
  const [invoiceIsCredit, setInvoiceIsCredit] = useState(false);
  const [savingInvoice, setSavingInvoice] = useState(false);
  const editingInvoicePrevRep = useRef<string | null>(null);
  const [invoiceNavIdx, setInvoiceNavIdx] = useState(-1);
  const [invoiceSearchOpen, setInvoiceSearchOpen] = useState(false);
  const [invoiceSearchQuery, setInvoiceSearchQuery] = useState('');

  // IPM (pharmacy only)
  const isPharmacy = (tenant?.business_activity_type_name || '').toLowerCase() === 'pharmacie';
  const [ipmBeneficiaire, setIpmBeneficiaire] = useState<any>(null);
  const [ipmConvention, setIpmConvention] = useState<any>(null);
  const [ipmLoading, setIpmLoading] = useState(false);

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
    const dTo = dateTo ? new Date(dateTo + 'T23:59:59.999').toISOString() : null;
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
      setLoading(false); setRefreshing(false); return;
    }

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

  const [flashTab, setFlashTab] = useState<Tab | null>(null);
  useEffect(() => {
    const ctx = consumeNavContext();
    if (!ctx?.target) return;
    if (ctx.target === 'quotes') { setTab('quotes'); setFlashTab('quotes'); }
    else if (ctx.target === 'returns') { setTab('returns'); setFlashTab('returns'); }
    const t = setTimeout(() => setFlashTab(null), 6800);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => { if (dataTick > 0) { const t = setTimeout(() => loadTab(billPage, true), 400); return () => clearTimeout(t); } /* eslint-disable-next-line */ }, [dataTick]);

  useEffect(() => {
    if (!tenant || !currentSite) return;
    const isShared = (tenant as any)?.settings?.shared_articles !== false;
    const isSharedCust = (tenant as any)?.settings?.shared_customers !== false;
    let custQuery = supabase.from('customers').select('id, name, phone').eq('tenant_id', tenant.id).eq('is_active', true).order('name');
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
      supabase.from('sales').select('id, sale_number, customer_id, total, paid, status, user_id, customers(name)').eq('tenant_id', tenant.id).eq('site_id', currentSite.id).neq('status', 'cancelled').order('created_at', { ascending: false }).limit(200),
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
  const matchesCommon = (
    created_at: string,
    customer_id: string | null | undefined,
    amount: number
  ) => {
    return true;
  };

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
      // Update existing line at index
      const updateFn = (prev: QuoteItem[]) => {
        const next = [...prev];
        next[tierPickerIdx] = { ...next[tierPickerIdx], unit_price: tierPrice, tier_name: tierName || undefined };
        next[tierPickerIdx].total = Math.max(0, Number(next[tierPickerIdx].quantity || 1) * tierPrice - Number(next[tierPickerIdx].discount || 0));
        return next;
      };
      if (tierPickerTarget === 'invoice') setInvoiceEditorItems(updateFn);
      else setQuoteItems(updateFn);
    } else {
      const newItem: QuoteItem = { article_id: tierPickerArticle.id, name: tierPickerArticle.name, quantity: 1, unit_price: tierPrice, discount: 0, total: tierPrice, tier_name: tierName || undefined };
      if (tierPickerTarget === 'invoice') setInvoiceEditorItems(p => [...p, newItem]);
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
  const finalizeQuoteItem = (idx: number, field: 'quantity' | 'unit_price' | 'discount') => {
    setQuoteItems(prev => {
      const next = [...prev];
      if (field === 'quantity' && (!Number(next[idx].quantity) || Number(next[idx].quantity) < 1)) next[idx].quantity = 1;
      if (field === 'unit_price' && (!Number(next[idx].unit_price) || Number(next[idx].unit_price) < 0)) next[idx].unit_price = 0;
      if (field === 'discount' && (!Number(next[idx].discount) || Number(next[idx].discount) < 0)) next[idx].discount = 0;
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
    if (!can('create_quotes')) { if (!opts?.silent) error('Vous n\'avez pas la permission de créer des devis'); return; }
    if (quoteItems.every(i => !i.name.trim())) { if (!opts?.silent) error('Ajoutez au moins un article'); return; }
    setSaving(true);
    const valid = quoteItems.filter(i => i.name.trim());
    const subtotal = valid.reduce((s, i) => s + Number(i.total), 0);
    const quoteRepLabel = repLabelOf(quoteForm.representative);
    const docHeader = (quoteForm.delivery_date || quoteForm.reference || quoteForm.warranty || quoteRepLabel || quoteForm.imei)
      ? { delivery_date: quoteForm.delivery_date || null, reference: quoteForm.reference || null, warranty: quoteForm.warranty || null, representative: quoteRepLabel, imei: quoteForm.imei || null }
      : null;

    if (editingQuoteId) {
      const prevRepId = (editingQuote as any)?.representative_id || null;
      await supabase.from('quotes').update({
        customer_id: quoteForm.customer_id || null,
        subtotal, discount: 0, total: subtotal,
        valid_until: quoteForm.valid_until || null, note: quoteForm.note,
        representative_id: quoteForm.representative || null,
        doc_header: docHeader,
      }).eq('id', editingQuoteId);
      if (prevRepId !== (quoteForm.representative || null)) {
        await supabase.from('audit_logs').insert({
          tenant_id: tenant.id, user_id: profile?.id || null,
          action: 'representative_change', module: 'billing', reference_id: editingQuoteId,
          old_value: { representative_id: prevRepId }, new_value: { representative_id: quoteForm.representative || null },
        });
      }
      await supabase.from('quote_items').delete().eq('quote_id', editingQuoteId);
      await supabase.from('quote_items').insert(valid.map(i => ({ tenant_id: tenant.id, quote_id: editingQuoteId, article_id: i.article_id, name: i.name, quantity: i.quantity, unit_price: i.unit_price, discount: i.discount, total: i.total })));
      setSaving(false);
      if (!opts?.silent) { success('Devis mis à jour'); closeQuotePanel(); loadTab(billPage, true); }
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
      if (e || !q) { error(e?.message || 'Erreur'); setSaving(false); return; }
      await supabase.from('quote_items').insert(valid.map(i => ({ tenant_id: tenant.id, quote_id: q.id, article_id: i.article_id, name: i.name, quantity: i.quantity, unit_price: i.unit_price, discount: i.discount, total: i.total })));
      setEditingQuoteId(q.id);
      setSaving(false);
      if (!opts?.silent) { success('Devis créé'); closeQuotePanel(); loadTab(billPage, true); }
    }
  };

  const autoSaveQuote = async () => {
    if (!tenant || !currentSite) return;
    if (quoteItems.every(i => !i.name.trim())) return;
    await saveQuote({ silent: true });
  };

  const closeQuotePanel = () => {
    setQuoteOpen(false);
    setQuoteEditorMode('create');
    setEditingQuoteId(null);
    setEditingQuote(null);
    setQuoteItems([{ article_id: null, name: '', quantity: 1, unit_price: 0, discount: 0, total: 0 }]);
    setQuoteForm({ customer_id: '', valid_until: '', note: '', delivery_date: '', reference: '', warranty: '', representative: '', imei: '' });
  };

  const openQuoteForEdit = async (q: Quote) => {
    const { data } = await supabase.from('quote_items').select('*, articles(internal_ref, oem_ref, sale_price)').eq('quote_id', q.id);
    setEditingQuoteId(q.id);
    setEditingQuote(q);
    setQuoteEditorMode('edit');
    setQuoteForm({ customer_id: q.customer_id || '', valid_until: q.valid_until || '', note: q.note || '', delivery_date: q.doc_header?.delivery_date || '', reference: q.doc_header?.reference || '', warranty: q.doc_header?.warranty || '', representative: (q as any).representative_id || '', imei: q.doc_header?.imei || '' });
    setQuoteItems((data || []).map((i: any) => ({
      article_id: i.article_id, name: i.name,
      quantity: Number(i.quantity), unit_price: Number(i.unit_price),
      discount: Number(i.discount || 0), total: Number(i.total),
    })));
    setQuoteOpen(true);
  };

  const openQuoteForView = async (q: Quote) => {
    const { data } = await supabase.from('quote_items').select('*, articles(internal_ref, oem_ref, sale_price)').eq('quote_id', q.id);
    setEditingQuoteId(q.id);
    setEditingQuote(q);
    setQuoteEditorMode('view');
    setQuoteForm({ customer_id: q.customer_id || '', valid_until: q.valid_until || '', note: q.note || '', delivery_date: q.doc_header?.delivery_date || '', reference: q.doc_header?.reference || '', warranty: q.doc_header?.warranty || '', representative: (q as any).representative_id || '', imei: q.doc_header?.imei || '' });
    setQuoteItems((data || []).map((i: any) => ({
      article_id: i.article_id, name: i.name,
      quantity: Number(i.quantity), unit_price: Number(i.unit_price),
      discount: Number(i.discount || 0), total: Number(i.total),
    })));
    setQuoteOpen(true);
  };

  const openQuoteDetail = async (q: Quote) => {
    if (isDesktop) {
      if (q.status === 'draft' || q.status === 'sent') {
        openQuoteForEdit(q);
      } else {
        openQuoteForView(q);
      }
    } else {
      setQuoteDetail(q);
      const { data } = await supabase.from('quote_items').select('*, articles(internal_ref, oem_ref)').eq('quote_id', q.id);
      setQuoteItemsDetail(data || []);
    }
  };
  const changeQuoteStatus = async (q: Quote, status: string) => {
    if (!can('edit_quotes')) { error('Vous n\'avez pas la permission de modifier les devis'); return; }
    await supabase.from('quotes').update({ status }).eq('id', q.id);
    success('Statut mis à jour'); loadTab(billPage, true);
    if (quoteDetail?.id === q.id) setQuoteDetail({ ...q, status });
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
  const finalizeInvoiceItem = (idx: number, field: 'quantity' | 'unit_price' | 'discount') => {
    setInvoiceEditorItems(prev => {
      const next = [...prev];
      if (field === 'quantity' && (!Number(next[idx].quantity) || Number(next[idx].quantity) < 1)) next[idx].quantity = 1;
      if (field === 'unit_price' && (!Number(next[idx].unit_price) || Number(next[idx].unit_price) < 0)) next[idx].unit_price = 0;
      if (field === 'discount' && (!Number(next[idx].discount) || Number(next[idx].discount) < 0)) next[idx].discount = 0;
      const it = next[idx];
      next[idx].total = Math.max(0, Number(it.quantity || 0) * Number(it.unit_price || 0) - Number(it.discount || 0));
      return next;
    });
  };
  const invoiceEditorSubtotal = invoiceEditorSubtotalRaw;
  const invoiceEditorPaid = invoicePayList.reduce((s, p) => s + p.amount, 0);

  const openInvoiceEditor = () => {
    setInvoiceEditorOpen(true);
    setInvoiceEditorMode('create');
    setEditingInvoiceId(null);
    setInvoiceForm({ customer_id: '', doc_date: new Date().toISOString().slice(0, 10), delivery_date: '', reference: '', warranty: '', representative: '', imei: '' });
    setInvoiceEditorItems([{ article_id: null, name: '', quantity: 1, unit_price: 0, discount: 0, total: 0 }]);
    setInvoicePayList([]);
    setInvoiceIsCredit(false);
    setInvoicePostCreation(null);
  };
  const closeInvoiceEditor = () => {
    setInvoiceEditorOpen(false);
    setInvoiceEditorMode('create');
    setEditingInvoiceId(null);
    setInvoicePostCreation(null);
    setInvoiceDetail(null);
    setInvoiceForm({ customer_id: '', doc_date: new Date().toISOString().slice(0, 10), delivery_date: '', reference: '', warranty: '', representative: '', imei: '' });
    setInvoiceEditorItems([{ article_id: null, name: '', quantity: 1, unit_price: 0, discount: 0, total: 0 }]);
    setInvoicePayList([]);
    setInvoiceIsCredit(false);
    setInvoicePostCreation(null);
  };
  const openInvoiceForEdit = async (inv: Invoice) => {
    const { data: items } = await supabase.from('sale_items').select('*, articles(internal_ref, oem_ref, sale_price)').eq('sale_id', inv.id);
    setInvoicePostCreation(null);
    setEditingInvoiceId(inv.id);
    setInvoiceEditorMode('edit');
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
    setInvoiceEditorOpen(true);
  };
  const openInvoiceForView = async (inv: Invoice) => {
    const { data: items } = await supabase.from('sale_items').select('*, articles(internal_ref, oem_ref, sale_price)').eq('sale_id', inv.id);
    setEditingInvoiceId(inv.id);
    setInvoiceNavIdx(invoices.findIndex(i => i.id === inv.id));
    setInvoiceEditorMode('view');
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
    setInvoiceEditorOpen(true);
  };

  const saveInvoice = async () => {
    if (!tenant || !currentSite) { error('Magasin introuvable'); return; }
    if (!can('edit_invoices')) { error('Vous n\'avez pas la permission de créer des factures'); return; }
    const valid = invoiceEditorItems.filter(i => i.name.trim());
    if (valid.length === 0) { error('Ajoutez au moins un article'); return; }
    const nonCatalog = valid.filter(i => !i.article_id);
    if (nonCatalog.length > 0) { error(`Chaque ligne doit correspondre à un article du catalogue : ${nonCatalog.map(i => i.name).join(', ')}`); return; }

    // Edit existing invoice via RPC (handles stock + balance recalculation)
    if (editingInvoiceId) {
      setSavingInvoice(true);
      try {
        const invRepLabel = repLabelOf(invoiceForm.representative);
        const docHeader = { doc_date: invoiceForm.doc_date || null, delivery_date: invoiceForm.delivery_date || null, reference: invoiceForm.reference || null, warranty: invoiceForm.warranty || null, representative: invRepLabel, imei: invoiceForm.imei || null };
        const { data: result, error: rpcErr } = await supabase.rpc('update_sale_items_and_totals', {
          p_sale_id: editingInvoiceId,
          p_tenant_id: tenant.id,
          p_items: valid.map(i => ({
            article_id: i.article_id, name: i.name,
            quantity: i.quantity, unit_price: i.unit_price,
            discount: i.discount,
          })),
          p_customer_id: invoiceForm.customer_id || null,
          p_doc_header: docHeader,
        });
        if (rpcErr) throw rpcErr;
        if (result && !(result as any).success) throw new Error((result as any).error || 'Erreur');

        const editSubtotal = valid.reduce((s, i) => s + Number(i.total), 0);
        const editSnapshot = await buildRepSnapshot(invoiceForm.representative || null, valid, editSubtotal);
        await supabase.from('sales').update({
          representative_id: invoiceForm.representative || null,
          rep_commission: editSnapshot,
        }).eq('id', editingInvoiceId);
        if (editingInvoicePrevRep.current !== (invoiceForm.representative || null)) {
          await supabase.from('audit_logs').insert({
            tenant_id: tenant.id, user_id: profile?.id || null,
            action: 'representative_change', module: 'billing', reference_id: editingInvoiceId,
            old_value: { representative_id: editingInvoicePrevRep.current }, new_value: { representative_id: invoiceForm.representative || null },
          });
        }

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

    const subtotal = valid.reduce((s, i) => s + Number(i.total), 0);
    const totalPaid = invoiceIsCredit ? 0 : invoicePayList.reduce((s, p) => s + p.amount, 0);
    const clientDueAmount = (ipmBeneficiaire && ipmPartIpm > 0) ? ipmPartClient : subtotal;
    if (!invoiceIsCredit && totalPaid > clientDueAmount) { error('Le montant payé dépasse la part client'); return; }

    if (invoiceIsCredit && !invoiceForm.customer_id) {
      error('Un client est requis pour une facture à crédit');
      return;
    }

    // Stock check if negative stock not allowed
    const allowNeg = !!(tenant as any)?.settings?.allow_negative_stock;
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
        const { data: sess } = await supabase.from('cash_sessions')
          .select('id').eq('tenant_id', tenant.id).eq('site_id', currentSite.id)
          .eq('status', 'open').order('opened_at', { ascending: false }).limit(1).maybeSingle();
        sessionId = sess?.id || null;
      }

      const status = invoiceIsCredit
        ? (ipmBeneficiaire && ipmPartIpm > 0 && totalPaid >= clientDueAmount ? 'paid' : 'validated')
        : (totalPaid >= clientDueAmount ? 'paid' : totalPaid > 0 ? 'partial' : 'validated');

      const ipmCoverage = (ipmBeneficiaire && ipmPartIpm > 0) ? ipmPartIpm : 0;
      const effectivePaid = totalPaid + ipmCoverage;

      const repSnapshot = await buildRepSnapshot(invoiceForm.representative || null, valid, subtotal);
      const newInvRepLabel = repLabelOf(invoiceForm.representative);

      const { data: sale, error: e } = await supabase.from('sales').insert({
        tenant_id: tenant.id, site_id: currentSite.id,
        customer_id: invoiceForm.customer_id || null,
        user_id: profile?.id || null,
        sale_number: invNum, subtotal, discount: 0, total: subtotal,
        paid: effectivePaid, status,
        source: 'billing', note: ipmCoverage > 0 ? `IPM: ${ipmBeneficiaire.ipm_organismes?.nom}` : null,
        cash_session_id: sessionId,
        representative_id: invoiceForm.representative || null,
        rep_commission: repSnapshot,
        doc_header: { doc_date: invoiceForm.doc_date || null, delivery_date: invoiceForm.delivery_date || null, reference: invoiceForm.reference || null, warranty: invoiceForm.warranty || null, representative: newInvRepLabel, imei: invoiceForm.imei || null },
      }).select('id').single();
      if (e || !sale) { error(e?.message || 'Erreur'); return; }

      const { error: itemsErr } = await supabase.rpc('insert_billing_sale_items', {
        p_sale_id: sale.id,
        p_items: valid.map(i => ({
          article_id: i.article_id, name: i.name,
          quantity: i.quantity, unit_price: i.unit_price,
          discount: i.discount, total: i.total,
        })),
      });
      if (itemsErr) {
        await supabase.from('sales').delete().eq('id', sale.id);
        error(itemsErr.message || 'Erreur lors de l\'enregistrement des lignes de facture');
        return;
      }

      // Insert payments (skip if credit)
      if (!invoiceIsCredit) {
        let sessionPayTotal = 0;
        for (const p of invoicePayList) {
          await supabase.from('sale_payments').insert({
            tenant_id: tenant.id, sale_id: sale.id,
            cash_session_id: sessionId,
            payment_method_id: p.method_id || null,
            method_name: p.method_name, amount: p.amount,
            reference: p.reference || '',
          });
          if (sessionId) sessionPayTotal += p.amount;
        }
        if (sessionId && sessionPayTotal > 0) {
          await supabase.rpc('increment_session_theoretical', {
            p_session_id: sessionId,
            p_amount: sessionPayTotal,
          });
        }
      }

      // Update customer balance for unpaid portion
      if (invoiceForm.customer_id) {
        const unpaidAmount = subtotal - effectivePaid;
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
          montant_total: subtotal,
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
      setEditingInvoiceId(sale.id);
      setInvoiceEditorMode('view');
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
    setConvertPayAmount(String(q.total));
    setConvertIpmDocs({ numero_ordonnance: '', medecin: '', numero_bon: '' });
    setConvertIpmBeneficiaire(null);
    setConvertIpmConvention(null);
    const { data } = await supabase.from('quote_items').select('article_id, name, quantity').eq('quote_id', q.id);
    setConvertItems((data || []).filter((i: any) => i.article_id).map((i: any) => ({ article_id: i.article_id, name: i.name, quantity: Number(i.quantity) })));
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
    const allowNeg = !!(tenant as any)?.settings?.allow_negative_stock;
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
        .in('article_id', trackedConvertItems.map(i => i.article_id));
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
    setConverting(true);

    // Find active cash session for payment tracking
    let convertSessionId: string | null = null;
    if (currentSite && tenant) {
      const { data: sess } = await supabase.from('cash_sessions')
        .select('id').eq('tenant_id', tenant.id).eq('site_id', currentSite.id)
        .eq('status', 'open').order('opened_at', { ascending: false }).limit(1).maybeSingle();
      convertSessionId = sess?.id || null;
    }

    const payments: any[] = [];
    if (convertPayNow && Number(convertPayAmount) > 0 && convertPayMethod) {
      const pm = paymentMethods.find(p => p.id === convertPayMethod);
      payments.push({
        payment_method_id: convertPayMethod,
        method_name: pm?.name || 'Paiement',
        amount: Math.min(Number(convertPayAmount), convertFrom.total),
        reference: '',
      });
    }
    const { data, error: e } = await supabase.rpc('convert_quote_to_sale', {
      p_quote_id: convertFrom.id,
      p_site_id: billSourceSiteId || currentSite.id,
      p_cash_session_id: convertSessionId,
      p_payments: payments,
    });
    if (e) { setConverting(false); error(e.message); return; }

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
        const ipmCalc = calculerIpm(cfg, [{ montant_ligne: convertFrom.total, ipm_eligible: true }], 0);
        const payAmt = convertPayNow ? Math.min(Number(convertPayAmount), convertFrom.total) : 0;
        await supabase.from('ipm_ventes').insert({
          tenant_id: tenant.id,
          organisme_id: convertIpmBeneficiaire.organisme_id,
          beneficiaire_id: convertIpmBeneficiaire.id,
          convention_id: convertIpmBeneficiaire.convention_id || null,
          sale_id: saleId,
          date_vente: new Date().toISOString().slice(0, 10),
          part_ipm: ipmCalc.part_ipm,
          part_client: ipmCalc.part_client,
          montant_total: convertFrom.total,
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
    setTab('invoices'); loadTab(billPage, true);
  };

  // ── Invoice detail ───────────────────────────────────────────
  const openInvoiceDetail = async (s: Invoice) => {
    setInvoiceDetail(s);
    setInvoiceIpmVente(null);
    const [{ data: it }, { data: pp }, { data: ipmV }] = await Promise.all([
      supabase.from('sale_items').select('*, articles(internal_ref, oem_ref)').eq('sale_id', s.id),
      supabase.from('sale_payments').select('*').eq('sale_id', s.id),
      supabase.from('ipm_ventes').select('*, ipm_organismes(nom)').eq('sale_id', s.id).limit(1).maybeSingle(),
    ]);
    setInvoiceItems(it || []); setInvoicePays(pp || []);
    setInvoiceIpmVente(ipmV || null);
  };

  const reloadInvoice = async (id: string) => {
    const { data } = await supabase.from('sales').select('id, sale_number, total, paid, status, customer_id, created_at, public_code, doc_header, customers(name, phone, address)').eq('id', id).maybeSingle();
    if (data) {
      setInvoiceDetail(data as any);
      const { data: pp } = await supabase.from('sale_payments').select('*').eq('sale_id', id);
      setInvoicePays(pp || []);
      if (invoiceEditorOpen && editingInvoiceId === id) {
        setInvoicePayList((pp || []).map((p: any) => ({ method_id: p.payment_method_id || '', method_name: p.method_name, amount: Number(p.amount), reference: '' })));
      }
    }
    loadTab(billPage, true);
  };

  const printInvoice = () => {
    if (!invoiceDetail || !tenant) return;
    const items = invoiceItems.map(i => ({ name: i.name, supplier_ref: null, oem_ref: i.articles?.oem_ref || null, quantity: Number(i.quantity), unit_price: Number(i.unit_price), discount: Number(i.discount || 0) }));
    const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price - (i.discount || 0), 0);
    printDocumentA4({
      tenant: tenantForPrint(tenant, currentSite),
      docLabel: 'FACTURE',
      docNumber: invoiceDetail.sale_number,
      docDate: new Date(invoiceDetail.created_at).toLocaleDateString('fr-FR'),
      docCreatedAt: invoiceDetail.created_at,
      customer: invoiceDetail.customers ? { name: invoiceDetail.customers.name, phone: (invoiceDetail.customers as any).phone || undefined, address: (invoiceDetail.customers as any).address || undefined } : null,
      items, subtotal, total: Number(invoiceDetail.total),
      payments: invoicePays.map(p => ({ method_name: p.method_name, amount: Number(p.amount) })),
      paid: Number(invoiceDetail.paid),
      issuedBy: creatorName((invoiceDetail as any).user_id),
      docHeader: (invoiceDetail as any).doc_header ?? null,
    });
  };

  const comptabiliserFacture = async () => {
    if (!invoiceDetail || accountingBusy) return;
    if (!can('edit_invoices')) { error('Vous n\'avez pas la permission de comptabiliser les factures'); return; }
    setAccountingBusy(true);
    try {
      const { data, error } = await supabase.rpc('comptabiliser_vente', { p_sale_id: invoiceDetail.id });
      if (error) throw error;
      if (!(data as any)?.success) throw new Error((data as any)?.error || 'Erreur inconnue');
      success(`Comptabilisé : ${(data as any).piece_number}`);
      setInvoiceDetail({ ...invoiceDetail, accounting_status: 'accounted' });
      setInvoices(prev => prev.map(i => i.id === invoiceDetail.id ? { ...i, accounting_status: 'accounted' } : i));
    } catch (e: any) { error(e.message); }
    finally { setAccountingBusy(false); }
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
      const { data: sess } = await supabase.from('cash_sessions')
        .select('id').eq('tenant_id', tenant.id).eq('site_id', currentSite.id)
        .eq('status', 'open').order('opened_at', { ascending: false }).limit(1).maybeSingle();
      cashSessionId = sess?.id || null;
      if (!cashSessionId) {
        setCancelling(false);
        error("Aucune session de caisse ouverte : impossible de rembourser en espèces. Ouvrez une caisse ou choisissez « Conserver en crédit ».");
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
    closeInvoiceEditor();
  };

  const comptabiliserFromEditor = async (inv: Invoice) => {
    if (accountingBusy) return;
    if (!can('edit_invoices')) { error('Vous n\'avez pas la permission de comptabiliser les factures'); return; }
    setAccountingBusy(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc('comptabiliser_vente', { p_sale_id: inv.id });
      if (rpcErr) throw rpcErr;
      if (!(data as any)?.success) throw new Error((data as any)?.error || 'Erreur inconnue');
      success(`Comptabilisé : ${(data as any).piece_number}`);
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
    if (!invoiceDetail) return;
    if (!can('edit_invoices')) { error('Vous n\'avez pas la permission d\'enregistrer des paiements'); return; }
    const amt = Number(payAmount);
    if (!amt || amt <= 0) { error('Montant invalide'); return; }
    const pm = paymentMethods.find(p => p.id === payMethod);
    if (!pm) { error('Mode de règlement requis'); return; }
    if (!tenant || !currentSite) return;
    setPaying(true);
    const { data: sess } = await supabase.from('cash_sessions')
      .select('id')
      .eq('tenant_id', tenant.id).eq('site_id', currentSite.id)
      .eq('status', 'open').order('opened_at', { ascending: false }).limit(1).maybeSingle();
    if (!sess) { setPaying(false); error("La caisse doit être ouverte d'abord"); return; }
    const ref = `Règlement facture ${invoiceDetail.sale_number}${invoiceDetail.customers?.name ? ' · ' + invoiceDetail.customers.name : ''}`;
    const { error: e } = await supabase.rpc('register_sale_payment', {
      p_sale_id: invoiceDetail.id,
      p_payment_method_id: pm.id,
      p_method_name: pm.name,
      p_amount: amt,
      p_reference: ref,
      p_cash_session_id: sess.id,
    });
    setPaying(false);
    if (e) { error(e.message); return; }
    // Update IPM part_beneficiaire_payee if this is an IPM sale
    const { data: ipmV } = await supabase.from('ipm_ventes').select('id, part_client').eq('sale_id', invoiceDetail.id).limit(1).maybeSingle();
    if (ipmV) {
      const { data: allPays } = await supabase.from('sale_payments').select('amount').eq('sale_id', invoiceDetail.id);
      const totalPaidNow = (allPays || []).reduce((s: number, p: any) => s + Number(p.amount), 0);
      await supabase.from('ipm_ventes').update({ part_beneficiaire_payee: Math.min(totalPaidNow, Number(ipmV.part_client)) }).eq('id', ipmV.id);
    }
    success('Paiement enregistré · imputé sur la caisse du jour');
    setPayOpen(false);
    await reloadInvoice(invoiceDetail.id);
  };

  // ── Apply credit ─────────────────────────────────────────────
  const [availableCredits, setAvailableCredits] = useState<SaleReturn[]>([]);
  const openCreditApply = async () => {
    if (!invoiceDetail || !tenant || !currentSite) return;
    const { data: creds } = await supabase.from('sale_returns')
      .select('*, customers(name, phone, address), sales(sale_number)')
      .eq('tenant_id', tenant.id).eq('site_id', currentSite.id)
      .eq('refund_method', 'avoir').eq('status', 'approved')
      .order('created_at', { ascending: false });
    const filtered = (creds || []).filter((r: any) =>
      Number(r.credit_used || 0) < Number(r.total) &&
      (!invoiceDetail.customer_id || r.customer_id === invoiceDetail.customer_id)
    );
    setAvailableCredits(filtered as SaleReturn[]);
    const c = filtered[0] as SaleReturn | undefined;
    setCreditSelected(c?.id || '');
    const due = Math.max(0, Number(invoiceDetail.total) - Number(invoiceDetail.paid));
    const avail = c ? Number(c.total) - Number(c.credit_used || 0) : 0;
    setCreditAmount(String(Math.min(due, avail)));
    setCreditOpen(true);
  };
  const applyCredit = async () => {
    if (!invoiceDetail || !creditSelected) { error('Sélectionnez un avoir'); return; }
    if (!can('edit_invoices')) { error('Vous n\'avez pas la permission d\'appliquer des avoirs'); return; }
    const amt = Number(creditAmount);
    if (!amt || amt <= 0) { error('Montant invalide'); return; }
    setApplyingCredit(true);
    const { error: e } = await supabase.rpc('apply_credit_to_sale', {
      p_credit_id: creditSelected,
      p_sale_id: invoiceDetail.id,
      p_amount: amt,
    });
    setApplyingCredit(false);
    if (e) { error(e.message); return; }
    success('Avoir appliqué');
    setCreditOpen(false);
    await reloadInvoice(invoiceDetail.id);
  };

  // ── Returns ──────────────────────────────────────────────────
  const loadSaleItems = async (saleId: string) => {
    const [{ data: items }, { data: retQtys }] = await Promise.all([
      supabase.from('sale_items').select('*').eq('sale_id', saleId),
      supabase.rpc('get_sale_returned_quantities', { p_sale_id: saleId }),
    ]);
    const retMap: Record<string, number> = {};
    (retQtys || []).forEach((r: any) => { retMap[r.article_id] = Number(r.total_returned); });
    const lines = (items || [])
      .map(i => {
        const alreadyReturned = retMap[i.article_id] || 0;
        const remaining = Math.max(0, Number(i.quantity) - alreadyReturned);
        return { item_id: i.id, article_id: i.article_id, name: i.name, max_qty: remaining, quantity: Math.min(remaining, 1), unit_price: i.unit_price, purchase_cost: i.purchase_cost || 0, selected: false };
      })
      .filter(i => i.max_qty > 0);
    setReturnLines(lines);
  };
  const handleSaleChange = async (saleId: string) => {
    setReturnForm(f => ({ ...f, sale_id: saleId }));
    if (saleId) await loadSaleItems(saleId);
    else setReturnLines([]);
  };
  const returnTotal = returnLines.filter(i => i.selected).reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0);

  // For IPM returns: calculate client-only refund
  const returnSale = sales.find(s => s.id === returnForm.sale_id);
  const returnIsFullReturn = returnForm.sale_id && returnLines.length > 0 && returnLines.every(i => i.selected && i.quantity === i.max_qty);

  const saveReturn = async () => {
    if (!tenant || !currentSite) { error('Magasin introuvable'); return; }
    if (!can('edit_invoices')) { error('Vous n\'avez pas la permission d\'effectuer des retours'); return; }
    if (!returnForm.sale_id) { error('Sélectionnez une vente'); return; }
    const sel = returnLines.filter(i => i.selected && i.quantity > 0);
    if (sel.length === 0) { error('Sélectionnez au moins un article'); return; }
    setSaving(true);

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
    const sale = sales.find(s => s.id === returnForm.sale_id);
    const { data: ret, error: e } = await supabase.from('sale_returns').insert({
      tenant_id: tenant.id, site_id: currentSite.id,
      sale_id: returnForm.sale_id, customer_id: sale?.customer_id || null,
      return_number: rNum, total: refundTotal,
      refund_method: 'pending', reason: returnForm.reason,
      restock: returnForm.restock, status: 'pending',
    }).select().single();
    if (e || !ret) { error(e?.message || 'Erreur'); setSaving(false); return; }
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
    success(returnMode === 'avoir' ? 'Avoir enregistré — disponible sur le compte client' : 'Retour enregistré — choisissez le mode de remboursement');
    setReturnOpen(false);
    setReturnForm({ sale_id: '', reason: '', refund_method: 'cash', restock: true });
    setReturnLines([]);
    await loadTab(billPage, true);
    if (returnMode === 'avoir') {
      const { error: avErr } = await supabase.rpc('approve_return_as_avoir', { p_return_id: ret.id });
      if (avErr) { error(avErr.message); return; }
      success('Avoir créé — disponible sur le compte client');
      await loadTab(billPage, true);
    }
    openReturnDetail({ ...ret, customers: sale?.customers || null, sales: sale ? { sale_number: sale.sale_number } : null } as SaleReturn);
  };

  const openReturnDetail = async (r: SaleReturn) => {
    setReturnDetail(r);
    if (isDesktop) setReturnEditorOpen(true);
    const { data } = await supabase.from('sale_return_items').select('*, articles(internal_ref, oem_ref)').eq('return_id', r.id);
    setReturnItemsDetail(data || []);
  };
  const approveAsAvoir = async (r: SaleReturn) => {
    if (!can('edit_invoices')) { error('Vous n\'avez pas la permission d\'approuver les retours'); return; }
    setReturnWorkflowBusy(true);
    const { error: e } = await supabase.rpc('approve_return_as_avoir', { p_return_id: r.id });
    setReturnWorkflowBusy(false);
    if (e) { error(e.message); return; }
    success('Avoir créé — disponible sur le compte client');
    loadTab(billPage, true);
    setReturnDetail(prev => prev?.id === r.id ? { ...prev, status: 'approved', refund_method: 'avoir' } : prev);
  };

  const approveAsCash = async (r: SaleReturn) => {
    if (!can('edit_invoices')) { error('Vous n\'avez pas la permission d\'approuver les retours'); return; }
    setReturnCashConfirmOpen(false);
    setReturnWorkflowBusy(true);
    const { error: e } = await supabase.rpc('process_return_as_cash', { p_return_id: r.id });
    setReturnWorkflowBusy(false);
    if (e) { error(e.message); return; }
    success('Remboursement enregistré en caisse');
    loadTab(billPage, true);
    setReturnDetail(prev => prev?.id === r.id ? { ...prev, status: 'approved', refund_method: 'cash' } : prev);
  };

  const printReturn = () => {
    if (!returnDetail || !tenant) return;
    const isCredit = returnDetail.refund_method === 'avoir';
    const items = returnItemsDetail.map(i => ({ name: i.name, supplier_ref: null, oem_ref: i.articles?.oem_ref || null, quantity: Number(i.quantity), unit_price: Number(i.unit_price) }));
    const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
    const extra: { label: string; value: string }[] = [];
    if (returnDetail.sales?.sale_number) extra.push({ label: 'Vente liée', value: returnDetail.sales.sale_number });
    printDocumentA4({
      tenant: tenantForPrint(tenant, currentSite),
      docLabel: isCredit ? 'AVOIR' : 'RETOUR',
      docNumber: returnDetail.return_number,
      docDate: new Date(returnDetail.created_at).toLocaleDateString('fr-FR'),
      customer: returnDetail.customers ? { name: returnDetail.customers.name, phone: (returnDetail.customers as any).phone || undefined, address: (returnDetail.customers as any).address || undefined } : null,
      extraMeta: extra,
      items, subtotal, total: Number(returnDetail.total),
      footerNote: returnDetail.reason ? `Motif : ${returnDetail.reason}` : undefined,
      issuedBy: creatorName((returnDetail as any).user_id),
    });
  };

  const hasFilters = !!(search || statusFilter || customerFilter || dateFrom || dateTo || minAmount || maxAmount);
  const clearFilters = () => { setSearch(''); setStatusFilter(''); setCustomerFilter(''); setDateFrom(''); setDateTo(''); setMinAmount(''); setMaxAmount(''); setFiltersOpen(false); };

  const counts = {
    quotes: tab === 'quotes' ? billTotalCount : 0,
    invoices: tab === 'invoices' ? billTotalCount : 0,
    returns: tab === 'returns' ? billTotalCount : 0,
    credits: tab === 'credits' ? billTotalCount : 0,
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

  const primaryAction = () => {
    if (tab === 'quotes') {
      if (!can('create_quotes')) { error('Vous n\'avez pas la permission de créer des devis'); return; }
      setQuoteEditorMode('create'); setQuoteOpen(true);
    } else if (tab === 'invoices') {
      if (!can('edit_invoices')) { error('Vous n\'avez pas la permission de créer des factures'); return; }
      openInvoiceEditor();
    } else if (tab === 'returns') {
      setReturnMode('return'); setReturnForm({ sale_id: '', reason: '', refund_method: 'cash', restock: true }); setReturnLines([]); setReturnOpen(true);
    } else {
      setReturnMode('avoir'); setReturnForm({ sale_id: '', reason: '', refund_method: 'avoir', restock: true }); setReturnLines([]); setReturnOpen(true);
    }
  };
  const primaryLabel = tab === 'quotes' ? 'Nouveau devis' : tab === 'invoices' ? 'Nouvelle facture' : tab === 'returns' ? 'Nouveau retour' : 'Nouvel avoir';

  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const newMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!newMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target as Node)) setNewMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [newMenuOpen]);
  const newMenuItems = [
    { key: 'invoice', label: 'Nouvelle facture', icon: Receipt, action: () => { if (!can('edit_invoices')) { error('Vous n\'avez pas la permission de créer des factures'); return; } openInvoiceEditor(); } },
    { key: 'quote', label: 'Nouveau devis', icon: FileText, action: () => { if (!can('create_quotes')) { error('Vous n\'avez pas la permission de créer des devis'); return; } setQuoteEditorMode('create'); setQuoteOpen(true); } },
    { key: 'return', label: 'Nouveau retour', icon: RotateCcw, action: () => { if (!can('edit_invoices')) { error('Vous n\'avez pas la permission d\'effectuer des retours'); return; } setReturnMode('return'); setReturnForm({ sale_id: '', reason: '', refund_method: 'cash', restock: true }); setReturnLines([]); setReturnOpen(true); } },
    { key: 'credit', label: 'Nouvel avoir', icon: Wallet, action: () => { if (!can('edit_invoices')) { error('Vous n\'avez pas la permission de créer des avoirs'); return; } setReturnMode('avoir'); setReturnForm({ sale_id: '', reason: '', refund_method: 'avoir', restock: true }); setReturnLines([]); setReturnOpen(true); } },
  ];

  const invoiceDue = invoiceDetail ? Math.max(0, Number(invoiceDetail.total) - Number(invoiceDetail.paid)) : 0;

  return (
    <div className="space-y-3 pb-6">
      {/* ── Header ───────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-5 lg:-mx-8 px-4 sm:px-5 lg:px-8 pb-3 pt-4 -mt-3 sm:-mt-4 lg:-mt-6 bg-white space-y-3 border-b border-neutral-100">
      <div className="flex items-start justify-between">
        <h1 className="text-lg font-bold text-neutral-900 leading-tight">Facturation</h1>
        <div className="relative shrink-0" ref={newMenuRef}>
          <button
            onClick={() => setNewMenuOpen(v => !v)}
            className="p-1.5 text-neutral-500 hover:text-brand-700 transition-colors"
            aria-label="Nouveau document"
          >
            <Plus className={`w-5 h-5 transition-transform duration-200 ${newMenuOpen ? 'rotate-45' : ''}`} />
          </button>
            {newMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-52 rounded-xl bg-white border border-slate-200 shadow-lg overflow-hidden z-50 origin-top-right">
                {newMenuItems.map((item, idx) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.key}
                      onClick={() => { item.action(); setNewMenuOpen(false); }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-brand-50 hover:text-brand-700 transition-colors text-left ${idx !== newMenuItems.length - 1 ? 'border-b border-slate-100' : ''}`}
                    >
                      <Icon className="w-4 h-4 text-slate-400" />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4 text-neutral-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="N°, client, vente…"
            className="bare-input w-full text-sm py-1.5"
          />
          <div className="h-px bg-neutral-200 mt-1" />
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
          <span className="hidden md:inline">Filtres</span>
        </button>
      </div>

      {(() => {
        const sharedCatalog = (tenant as any)?.settings?.shared_articles !== false;
        const interDepot = !!(tenant as any)?.settings?.inter_depot_transfer;
        // Own depots always accessible; other depots only if shared catalog + inter-depot enabled
        const availableDepots = depots.filter(d =>
          d.parent_site_id === currentSite?.id || (sharedCatalog && interDepot)
        );
        if (availableDepots.length === 0) return null;
        return (
          <div className="flex items-center gap-2">
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

      {/* ── Tabs ─────────────────────────────────────────────── */}
      {/* Mobile: centered, dividers, active top border + bg */}
      <div className="md:hidden flex items-stretch text-[13px] font-bold overflow-x-auto no-scrollbar">
          {TABS.map((t, i) => {
            const active = tab === t.key;
            return (
              <div key={t.key} className="flex items-stretch shrink-0 min-w-[80px]">
                {i > 0 && <div className="w-px bg-neutral-200 shrink-0" />}
                <button
                  onClick={() => { setTab(t.key); setStatusFilter(''); }}
                  className={`flex-1 flex items-center justify-center py-2 px-3 transition-all ${
                    active
                      ? 'text-neutral-900 bg-neutral-100/80 border-b-2 border-neutral-900 font-bold'
                      : 'text-neutral-400 hover:text-neutral-600 border-b-2 border-transparent'
                  }`}
                >
                  {t.label}
                </button>
              </div>
            );
          })}
        </div>
      {/* Desktop: original tab bar */}
      <div className="hidden md:flex items-center gap-3 text-[10px] font-bold uppercase tracking-wider overflow-x-auto no-scrollbar whitespace-nowrap">
          {TABS.map(t => {
            const active = tab === t.key;
            const count = counts[t.key];
            return (
              <button
                key={t.key}
                onClick={() => { setTab(t.key); setStatusFilter(''); }}
                className={`shrink-0 inline-flex items-center gap-1.5 py-1 transition-colors ${
                  active
                    ? 'text-neutral-900 font-bold'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.label}
                <span className="num">{count}</span>
              </button>
            );
          })}
        </div>

      {hasFilters && (
        <div className="flex items-center gap-1.5 flex-wrap text-[10px] font-bold uppercase tracking-wider">
          {statusFilter && <span className="px-2 py-1 rounded-full bg-brand-50 text-brand-700 border border-brand-200">{statusOptions.find(o => o.value === statusFilter)?.label}</span>}
          {customerFilter && <span className="px-2 py-1 rounded-full bg-brand-50 text-brand-700 border border-brand-200 inline-flex items-center gap-1"><User className="w-3 h-3" />{customers.find(c => c.id === customerFilter)?.name}</span>}
          {(dateFrom || dateTo) && <span className="px-2 py-1 rounded-full bg-brand-50 text-brand-700 border border-brand-200 inline-flex items-center gap-1"><Calendar className="w-3 h-3" />{dateFrom || '…'} → {dateTo || '…'}</span>}
          {(minAmount || maxAmount) && <span className="px-2 py-1 rounded-full bg-brand-50 text-brand-700 border border-brand-200">{minAmount || '0'} – {maxAmount || '∞'}</span>}
          <button onClick={clearFilters} className="btn-icon" title="Réinitialiser"><RotateCcw className="w-4 h-4" /></button>
        </div>
      )}

      </div>{/* end sticky header */}

      {/* ── Content ──────────────────────────────────────────── */}
      {loading ? (
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
              <EmptyState icon={FileText} title="Aucun devis" description="Créez votre premier devis." action={<button onClick={() => { setQuoteEditorMode('create'); setQuoteOpen(true); }} className="btn-icon-primary" title="Nouveau devis"><Plus className="w-4 h-4" /></button>} />
            ) : (
              <div className={flashTab === 'quotes' ? 'waarwi-flash waarwi-flash-scroll' : ''}>
                <div className="md:hidden count-up">
                  {filteredQuotes.map(q => {
                    const st = QUOTE_STATUS[q.status] || QUOTE_STATUS.draft;
                    return (
                      <button
                        key={q.id}
                        onClick={() => openQuoteDetail(q)}
                        className="w-full text-left px-4 py-2.5 border-b border-neutral-100 hover:bg-neutral-50/50 transition-colors active:scale-[0.995]"
                      >
                        {/* Line 1: customer only */}
                        <div className="text-xs font-medium text-neutral-700 truncate">{q.customers?.name || 'Client comptoir'}</div>
                        {/* Line 2: quote#, status, date */}
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[13px] font-semibold text-neutral-900 shrink-0">{q.quote_number}</span>
                          <span className={`text-[10px] font-semibold ${st.pill} shrink-0`}>{st.label}</span>
                          <span className="text-xs text-neutral-400 shrink-0 num">{formatDate(q.created_at)}{q.valid_until ? ` · Valide ${formatDate(q.valid_until)}` : ''}</span>
                        </div>
                        {/* Line 3: actions + amount */}
                        <div className="flex items-center gap-1 mt-1.5">
                          {q.status === 'accepted' && (
                            <button onClick={e => { e.stopPropagation(); openConvert(q); }} className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-brand-600 text-white text-[10px] font-bold hover:bg-brand-700"><ArrowRight className="w-3 h-3" />Facturer</button>
                          )}
                          {q.status === 'draft' && <button onClick={e => { e.stopPropagation(); changeQuoteStatus(q, 'sent'); }} className="p-1.5 rounded-md hover:bg-neutral-100 text-neutral-500 transition" title="Marquer envoyé"><CheckCircle className="w-4 h-4" /></button>}
                          {q.status !== 'converted' && q.status !== 'rejected' && <button onClick={e => { e.stopPropagation(); setQuoteToCancel(q); }} className="p-1.5 rounded-md hover:bg-red-50 text-red-500 transition" title="Refuser"><X className="w-4 h-4" /></button>}
                          <div className="flex-1" />
                          <div className="w-px h-5 bg-neutral-200 mx-1" />
                          <span className="text-sm font-extrabold text-neutral-900 num whitespace-nowrap shrink-0">{formatFCFA(q.total)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="hidden md:block">
                  <div className="flex items-center gap-3 px-2 py-1.5 border-b border-slate-200 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                    <span className="shrink-0 w-28">N° Devis</span>
                    <span className="shrink-0 hidden lg:inline w-24">Date</span>
                    <span className="flex-1 min-w-0">Client</span>
                    <span className="shrink-0 w-20 text-right">Statut</span>
                    <span className="shrink-0 w-28 text-right">Montant</span>
                    <span className="shrink-0 w-16 text-center">Actions</span>
                  </div>
                  {filteredQuotes.map(q => {
                    const st = QUOTE_STATUS[q.status] || QUOTE_STATUS.draft;
                    return (
                      <div key={q.id} onClick={() => openQuoteDetail(q)} className="flex items-center gap-3 px-2 py-1.5 hover:bg-slate-50 transition-colors cursor-pointer border-b border-slate-50">
                        <span className="doc-number text-[12px] font-bold text-slate-700 shrink-0 w-28 truncate">{q.quote_number}</span>
                        <span className="text-[11px] text-slate-400 shrink-0 tabular-nums hidden lg:inline w-24">{formatDate(q.created_at)}</span>
                        <span className="text-[12px] text-slate-700 truncate flex-1 min-w-0">{q.customers?.name || <span className="text-slate-400">—</span>}</span>
                        <span className={`text-[9px] font-bold uppercase ${st.pill} shrink-0 w-20 text-right`}>{st.label}</span>
                        <span className="text-[12px] font-bold text-slate-900 tabular-nums shrink-0 w-28 text-right">{formatFCFA(q.total)}</span>
                        <div className="flex items-center gap-0.5 shrink-0 w-16 justify-center" onClick={e => e.stopPropagation()}>
                          <button onClick={() => openQuoteDetail(q)} className="text-[10px] font-semibold text-slate-400 hover:text-brand-700 transition" title="Voir">Voir</button>
                          {q.status === 'accepted' && <button onClick={() => openConvert(q)} className="p-1 rounded hover:bg-brand-50 text-brand-700 transition" title="Convertir"><ArrowRight className="w-3.5 h-3.5" /></button>}
                          {q.status === 'draft' && <button onClick={() => changeQuoteStatus(q, 'sent')} className="p-1 rounded hover:bg-neutral-50 text-neutral-700 transition" title="Envoyé"><CheckCircle className="w-3.5 h-3.5" /></button>}
                          {q.status !== 'converted' && q.status !== 'rejected' && <button onClick={() => setQuoteToCancel(q)} className="p-1 rounded hover:bg-red-50 text-red-500 transition" title="Refuser"><X className="w-3.5 h-3.5" /></button>}
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
              <EmptyState icon={Receipt} title="Aucune facture" description="Les factures créées apparaîtront ici." action={<button onClick={openInvoiceEditor} className="btn-icon-primary" title="Nouvelle facture"><Plus className="w-4 h-4" /></button>} />
            ) : (
              <>
                <div className="md:hidden count-up">
                  {filteredInvoices.map(inv => {
                    const st = invoiceStatus(inv);
                    const solde = Math.max(0, Number(inv.total) - Number(inv.paid));
                    return (
                      <button
                        key={inv.id}
                        onClick={() => openInvoiceForView(inv)}
                        className="w-full text-left px-4 py-2.5 border-b border-neutral-100 hover:bg-neutral-50/50 transition-colors active:scale-[0.995]"
                      >
                        {/* Line 1: customer only */}
                        <div className="text-xs font-medium text-neutral-700 truncate">{inv.customers?.name || 'Client comptoir'}</div>
                        {/* Line 2: invoice#, status, date */}
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[13px] font-semibold text-neutral-900 shrink-0">{inv.sale_number}</span>
                          <span className={`text-[10px] font-semibold ${st.pill} shrink-0`}>{st.label}</span>
                          {inv.accounting_status === 'accounted' && <span className="text-[9px] font-bold text-neutral-500 shrink-0">C</span>}
                          <span className="text-xs text-neutral-400 shrink-0 num">{formatDateTime(inv.created_at)}</span>
                        </div>
                        {/* Line 3: icons + paid + amount */}
                        <div className="flex items-center gap-1 mt-1.5">
                          {inv.customers && <button onClick={e => { e.stopPropagation(); quickWhatsApp(inv); }} className="p-1.5 rounded-md hover:bg-emerald-50 text-[#25D366] transition" title="WhatsApp"><MessageCircle className="w-4 h-4" /></button>}
                          <button onClick={e => { e.stopPropagation(); quickCopy(inv); }} className="p-1.5 rounded-md hover:bg-neutral-100 text-neutral-500 transition" title="Copier le lien"><Link2 className="w-4 h-4" /></button>
                          {solde > 0 && <span className="text-[10px] text-amber-700 font-bold num shrink-0">Solde {formatFCFA(solde)}</span>}
                          <div className="flex-1" />
                          <div className="w-px h-5 bg-neutral-200 mx-1" />
                          <span className="text-sm font-extrabold text-neutral-900 num whitespace-nowrap shrink-0">{formatFCFA(inv.total)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="hidden md:block">
                  <div className="flex items-center gap-3 px-2 py-1.5 border-b border-slate-200 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                    <span className="shrink-0 w-28">N° Facture</span>
                    <span className="shrink-0 hidden lg:inline w-32">Date</span>
                    <span className="flex-1 min-w-0">Client</span>
                    <span className="shrink-0 w-28 text-right">Total</span>
                    <span className="shrink-0 w-24 text-right hidden lg:inline">Payé</span>
                    <span className="shrink-0 w-24 text-right hidden lg:inline">Solde</span>
                    <span className="shrink-0 w-20 text-right">Statut</span>
                    <span className="shrink-0 w-16 text-center">Actions</span>
                  </div>
                  {filteredInvoices.map(inv => {
                    const st = invoiceStatus(inv);
                    const solde = Math.max(0, Number(inv.total) - Number(inv.paid));
                    return (
                      <div key={inv.id} onClick={() => openInvoiceForView(inv)} className="flex items-center gap-3 px-2 py-1.5 hover:bg-slate-50 transition-colors cursor-pointer border-b border-slate-50">
                        <span className="doc-number text-[12px] font-bold text-slate-700 shrink-0 w-28 truncate">{inv.sale_number}</span>
                        <span className="text-[11px] text-slate-400 shrink-0 tabular-nums hidden lg:inline w-32">{formatDateTime(inv.created_at)}</span>
                        <span className="text-[12px] text-slate-700 truncate flex-1 min-w-0">{inv.customers?.name || <span className="text-slate-400">Client comptoir</span>}</span>
                        <span className="text-[12px] font-bold text-slate-900 tabular-nums shrink-0 w-28 text-right">{formatFCFA(inv.total)}</span>
                        <span className="text-[11px] text-emerald-700 tabular-nums shrink-0 w-24 text-right hidden lg:inline">{formatFCFA(inv.paid)}</span>
                        <span className="text-[11px] tabular-nums shrink-0 w-24 text-right hidden lg:inline">{solde > 0 ? <span className="text-amber-700 font-bold">{formatFCFA(solde)}</span> : <span className="text-slate-400">—</span>}</span>
                        <span className={`text-[9px] font-bold uppercase ${st.pill} shrink-0 w-20 text-right`}>{st.label}</span>
                        {inv.accounting_status === 'accounted' && <span className="inline-flex px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-teal-50 text-teal-700 border border-teal-200 shrink-0 hidden xl:inline">OK</span>}
                        <div className="flex items-center gap-0.5 shrink-0 w-16 justify-center" onClick={e => e.stopPropagation()}>
                          {inv.customers && <button onClick={() => quickWhatsApp(inv)} className="p-1 rounded hover:bg-emerald-50 text-[#25D366] transition" title="WhatsApp"><MessageCircle className="w-3.5 h-3.5" /></button>}
                          <button onClick={() => quickCopy(inv)} className="p-1 rounded hover:bg-slate-100 text-slate-500 transition" title="Copier"><Link2 className="w-3.5 h-3.5" /></button>
                          <button onClick={() => openInvoiceForView(inv)} className="text-[10px] font-semibold text-slate-400 hover:text-brand-700 transition" title="Voir">Voir</button>
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
                action={<button onClick={() => { if (tab === 'returns') { setReturnMode('return'); setReturnForm({ sale_id: '', reason: '', refund_method: 'cash', restock: true }); } else { setReturnMode('avoir'); setReturnForm({ sale_id: '', reason: '', refund_method: 'avoir', restock: true }); } setReturnLines([]); setReturnOpen(true); }} className="btn-icon-primary" title={tab === 'returns' ? 'Nouveau retour' : 'Nouvel avoir'}><Plus className="w-4 h-4" /></button>}
              />
            ) : (
              <div className={flashTab === 'returns' && tab === 'returns' ? 'waarwi-flash waarwi-flash-scroll' : ''}>
                <div className="md:hidden count-up">
                  {(tab === 'returns' ? filteredReturns : filteredCredits).map(r => {
                    const st = tab === 'credits' ? creditStatus(r) : (RETURN_STATUS[r.status] || RETURN_STATUS.pending);
                    const isCredit = tab === 'credits';
                    const used = Number(r.credit_used || 0);
                    const balance = Number(r.total) - used;
                    return (
                      <button
                        key={r.id}
                        onClick={() => openReturnDetail(r)}
                        className="w-full text-left px-4 py-2.5 border-b border-neutral-100 hover:bg-neutral-50/50 transition-colors active:scale-[0.995]"
                      >
                        {/* Line 1: customer only */}
                        <div className="text-xs font-medium text-neutral-700 truncate">{r.customers?.name || 'Client comptoir'}</div>
                        {/* Line 2: doc# + status */}
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[13px] font-semibold text-neutral-900 shrink-0">{r.return_number}</span>
                          <span className={`text-[10px] font-semibold ${st.pill} shrink-0`}>{st.label}</span>
                        </div>
                        {/* Line 3: date + sale ref */}
                        <div className="text-xs text-neutral-400 num mt-0.5 truncate">
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
                  <div className="flex items-center gap-3 px-2 py-1.5 border-b border-slate-200 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                    <span className="shrink-0 w-28">N° Document</span>
                    <span className="shrink-0 hidden lg:inline w-32">Date</span>
                    <span className="flex-1 min-w-0">Client</span>
                    {tab === 'returns' && <span className="hidden lg:inline shrink-0 w-12 text-center">Stock</span>}
                    {tab === 'credits' && <span className="hidden lg:inline shrink-0 w-24 text-right">Utilisé</span>}
                    <span className="shrink-0 w-20 text-right">Statut</span>
                    <span className="shrink-0 w-28 text-right">Montant</span>
                    <span className="shrink-0 w-12 text-center">Action</span>
                  </div>
                  {(tab === 'returns' ? filteredReturns : filteredCredits).map(r => {
                    const st = tab === 'credits' ? creditStatus(r) : (RETURN_STATUS[r.status] || RETURN_STATUS.pending);
                    const isCredit = tab === 'credits';
                    const used = Number(r.credit_used || 0);
                    return (
                      <div key={r.id} onClick={() => openReturnDetail(r)} className="flex items-center gap-3 px-2 py-1.5 hover:bg-slate-50 transition-colors cursor-pointer border-b border-slate-50">
                        <span className="doc-number text-[12px] font-bold text-slate-700 shrink-0 w-28 truncate">{r.return_number}</span>
                        <span className="text-[11px] text-slate-400 shrink-0 tabular-nums hidden lg:inline w-32">{formatDateTime(r.created_at)}</span>
                        <span className="text-[12px] text-slate-700 truncate flex-1 min-w-0">{r.customers?.name || <span className="text-slate-400">—</span>}</span>
                        {tab === 'returns' && <span className="hidden lg:inline shrink-0 w-12 text-center">{r.restock ? <span className="inline-flex px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">Oui</span> : <span className="text-slate-400 text-[10px]">Non</span>}</span>}
                        {tab === 'credits' && <span className="hidden lg:inline shrink-0 w-24 text-right text-[11px] text-slate-600 tabular-nums">{formatFCFA(used)}</span>}
                        <span className={`text-[9px] font-bold uppercase ${st.pill} shrink-0 w-20 text-right`}>{st.label}</span>
                        <span className={`text-[12px] font-bold tabular-nums shrink-0 w-28 text-right ${isCredit ? 'text-neutral-800' : 'text-red-700'}`}>{isCredit ? '' : '-'}{formatFCFA(r.total)}</span>
                        <div className="flex items-center shrink-0 w-12 justify-center">
                          <button onClick={e => { e.stopPropagation(); openReturnDetail(r); }} className="text-[10px] font-semibold text-slate-400 hover:text-brand-700 transition" title="Voir">Voir</button>
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
            <div className="flex items-center justify-between px-4 py-3 mt-3">
              <div className="text-xs text-slate-500">
                {billPage * PAGE_SIZE + 1}–{Math.min((billPage + 1) * PAGE_SIZE, billTotalCount)} sur {billTotalCount}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setBillPage(0)} disabled={billPage === 0} className="px-2 py-1 rounded-lg text-[11px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">{'<<'}</button>
                <button onClick={() => setBillPage(p => Math.max(0, p - 1))} disabled={billPage === 0} className="px-2 py-1 rounded-lg text-[11px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="px-3 py-1 rounded-lg text-[11px] font-bold bg-brand-50 text-brand-700 border border-brand-200">{billPage + 1} / {Math.max(1, Math.ceil(billTotalCount / PAGE_SIZE))}</span>
                <button onClick={() => setBillPage(p => p + 1)} disabled={!billHasMore} className="px-2 py-1 rounded-lg text-[11px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setBillPage(Math.ceil(billTotalCount / PAGE_SIZE) - 1)} disabled={!billHasMore} className="px-2 py-1 rounded-lg text-[11px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">{'>>'}</button>
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

      {/* ── Direct invoice full-screen panel ──────────────────────────────── */}
      {invoiceEditorOpen && isDesktop && (
        <DocumentEditor
          docType="invoice"
          mode={invoiceEditorMode}
          articles={articles}
          customers={customers}
          headerForm={{ ...invoiceForm, valid_until: '', note: '', doc_date: invoiceForm.doc_date || '' }}
          setHeaderForm={(fn: any) => setInvoiceForm((prev: any) => {
            const next = typeof fn === 'function' ? fn(prev) : fn;
            const { valid_until: _, ...rest } = next;
            return rest;
          })}
          items={invoiceEditorItems}
          setItems={setInvoiceEditorItems}
          subtotal={invoiceEditorSubtotal}
          saving={savingInvoice}
          onSave={saveInvoice}
          onClose={closeInvoiceEditor}
          hasPrev={invoiceNavIdx > 0}
          hasNext={invoiceNavIdx >= 0 && invoiceNavIdx < invoices.length - 1}
          onPrev={invoiceNavIdx > 0 ? () => { const prev = invoices[invoiceNavIdx - 1]; if (prev) openInvoiceForView(prev); } : undefined}
          onNext={invoiceNavIdx >= 0 && invoiceNavIdx < invoices.length - 1 ? () => { const next = invoices[invoiceNavIdx + 1]; if (next) openInvoiceForView(next); } : undefined}
          onSearchOpen={() => setInvoiceSearchOpen(true)}
          editingId={editingInvoiceId}
          documentNumber={editingInvoiceId ? (invoices.find(i => i.id === editingInvoiceId)?.sale_number || undefined) : undefined}
          documentStatus={editingInvoiceId ? (invoices.find(i => i.id === editingInvoiceId)?.status || undefined) : undefined}
          accountingStatus={(invoices.find(i => i.id === editingInvoiceId) as any)?.accounting_status || undefined}
          invoiceDue={editingInvoiceId ? Math.max(0, Number(invoices.find(i => i.id === editingInvoiceId)?.total || 0) - Number(invoices.find(i => i.id === editingInvoiceId)?.paid || 0)) : 0}
          docSettings={docSettings}
          autoMode={autoMode}
          onVehiclePicker={(idx: number | null) => { setVehiclePickerTargetIdx(idx); setVehiclePickerOpen(true); }}
          paymentMethods={paymentMethods}
          payments={invoicePayList}
          setPayments={setInvoicePayList}
          totalPaid={invoiceIsCredit ? 0 : invoiceEditorPaid}
          isCredit={invoiceIsCredit}
          setIsCredit={setInvoiceIsCredit}
          isPharmacy={isPharmacy}
          ipmLoading={ipmLoading}
          ipmBeneficiaire={ipmBeneficiaire}
          ipmTaux={ipmTaux}
          ipmConvention={ipmConvention}
          ipmPartIpm={ipmPartIpm}
          ipmPartClient={ipmPartClient}
          ipmConfig={ipmConfig}
          ipmDocuments={ipmDocuments}
          setIpmDocuments={setIpmDocuments}
          ipmDocValidation={ipmDocValidation}
          onCreateArticle={(name) => { setQuickArticleName(name); setQuickArticleOpen(true); }}
          onCreateCustomer={(name) => { setQuickCustomerName(name); setQuickCustomerOpen(true); }}
          reps={activeReps}
          postCreation={invoicePostCreation}
          docCreatedInfo={editingInvoiceId ? (() => {
            const inv = invoices.find(i => i.id === editingInvoiceId);
            return inv ? { createdAt: inv.created_at, createdBy: creatorName(inv.user_id) } : null;
          })() : null}
          onNewInvoice={() => {
            setInvoicePostCreation(null);
            setEditingInvoiceId(null);
            setInvoiceForm({ customer_id: '', doc_date: new Date().toISOString().slice(0, 10), delivery_date: '', reference: '', warranty: '', representative: '', imei: '' });
            setInvoiceEditorItems([{ article_id: null, name: '', quantity: 1, unit_price: 0, discount: 0, total: 0 }]);
            setInvoicePayList([]);
            setInvoiceIsCredit(false);
          }}
          onEdit={editingInvoiceId ? () => {
            setInvoicePostCreation(null);
            const inv = invoices.find(i => i.id === editingInvoiceId);
            if (inv) openInvoiceForEdit(inv);
          } : undefined}
          onPay={editingInvoiceId ? () => {
            const inv = invoices.find(i => i.id === editingInvoiceId);
            if (inv) openPay(inv);
          } : undefined}
          onCopyLink={editingInvoiceId ? () => {
            const inv = invoices.find(i => i.id === editingInvoiceId);
            if (inv) copyInvoiceLink(inv);
          } : undefined}
          onWhatsApp={editingInvoiceId ? (() => {
            const inv = invoices.find(i => i.id === editingInvoiceId);
            if (inv?.customers) return () => sendInvoiceWhatsApp(inv);
            return undefined;
          })() : undefined}
          onCancel={editingInvoiceId ? () => {
            const inv = invoices.find(i => i.id === editingInvoiceId);
            if (inv) cancelInvoice(inv);
          } : undefined}
          onComptabiliser={editingInvoiceId ? () => {
            const inv = invoices.find(i => i.id === editingInvoiceId);
            if (inv) comptabiliserFromEditor(inv);
          } : undefined}
          onPrint={editingInvoiceId ? () => {
            const inv = invoices.find(i => i.id === editingInvoiceId);
            if (!inv || !tenant) return;
            const pitems = invoiceEditorItems.filter(i => i.name.trim()).map(i => ({ name: i.name, supplier_ref: null, oem_ref: null, quantity: Number(i.quantity), unit_price: Number(i.unit_price), discount: Number(i.discount || 0) }));
            const psubtotal = pitems.reduce((s, i) => s + i.quantity * i.unit_price - (i.discount || 0), 0);
            printDocumentA4({ tenant: tenantForPrint(tenant, currentSite), docLabel: 'FACTURE', docNumber: inv.sale_number || '', docDate: new Date(inv.created_at).toLocaleDateString('fr-FR'), docCreatedAt: inv.created_at, customer: inv.customers ? { name: inv.customers.name, phone: (inv.customers as any).phone || undefined, address: (inv.customers as any).address || undefined } : null, items: pitems, subtotal: psubtotal, total: Number(inv.total), payments: invoicePayList.map(p => ({ method_name: p.method_name, amount: p.amount })), paid: Number(inv.paid), issuedBy: creatorName((inv as any).user_id), docHeader: invoiceForm.reference || invoiceForm.delivery_date || invoiceForm.warranty || invoiceForm.imei || repLabelOf(invoiceForm.representative) ? { reference: invoiceForm.reference || null, delivery_date: invoiceForm.delivery_date || null, warranty: invoiceForm.warranty || null, representative: repLabelOf(invoiceForm.representative), imei: invoiceForm.imei || null } : null });
          } : undefined}
          transformReturnLines={returnLines}
          loadReturnLines={async (saleId: string) => { await loadSaleItems(saleId); }}
          onTransformToReturn={async (config) => {
            if (!tenant || !currentSite) { error('Magasin introuvable'); return; }
            if (!can('edit_invoices')) { error('Permission insuffisante'); return; }
            if (!editingInvoiceId) return;
            const sel = config.selectedItems.filter(i => i.selected && i.quantity > 0);
            if (sel.length === 0) { error('Sélectionnez au moins un article'); return; }
            setSaving(true);
            const saleId = editingInvoiceId;
            const localReturnTotal = sel.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0);
            const { data: ipmVente } = await supabase.from('ipm_ventes')
              .select('id, part_ipm, part_client, montant_total, bordereau_id, statut')
              .eq('sale_id', saleId).limit(1).maybeSingle();
            let refundTotal = localReturnTotal;
            if (ipmVente && ipmVente.montant_total > 0) {
              const ipmRatio = Number(ipmVente.part_client) / Number(ipmVente.montant_total);
              refundTotal = Math.round(localReturnTotal * ipmRatio);
            }
            const { data: numData } = await supabase.rpc('next_doc_number', {
              p_tenant_id: tenant.id, p_kind: 'return', p_prefix: 'RET',
            });
            const rNum = (numData as string) || ('RET-' + Date.now());
            const sale = sales.find(s => s.id === saleId);
            const { data: ret, error: e } = await supabase.from('sale_returns').insert({
              tenant_id: tenant.id, site_id: currentSite.id,
              sale_id: saleId, customer_id: sale?.customer_id || null,
              return_number: rNum, total: refundTotal,
              refund_method: 'pending', reason: config.reason,
              restock: config.restock, status: 'pending',
            }).select().single();
            if (e || !ret) { error(e?.message || 'Erreur'); setSaving(false); return; }
            await supabase.from('sale_return_items').insert(sel.map(i => ({
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
            closeInvoiceEditor();
            await loadTab(billPage, true);
            openReturnDetail({ ...ret, customers: sale?.customers || null, sales: sale ? { sale_number: sale.sale_number } : null } as SaleReturn);
          }}
        />
      )}
      {invoiceEditorOpen && !isDesktop && invoiceEditorMode === 'view' && (() => {
        const viewInv = invoices[invoiceNavIdx] || null;
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
                customer: viewInv.customers ? { name: viewInv.customers.name } : null,
                items: pitems, subtotal: psubtotal, total: Number(viewInv.total),
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
            onComptabiliser={can('edit_invoices') && !isAccounted && !isCancelled ? async () => {
              if (accountingBusy) return;
              setAccountingBusy(true);
              const { error: rpcErr } = await supabase.rpc('comptabiliser_vente', { p_sale_id: viewInv.id });
              setAccountingBusy(false);
              if (rpcErr) { error(rpcErr.message); return; }
              success('Facture comptabilisée');
              setInvoices(prev => prev.map(inv => inv.id === viewInv.id ? { ...inv, accounting_status: 'accounted' } : inv));
              closeInvoiceEditor();
              loadTab(billPage, true);
            } : undefined}
            accountingBusy={accountingBusy}
            onCancel={!isCancelled && !isAccounted ? () => setCancelTarget(viewInv) : undefined}
          />
        );
      })()}
      {invoiceEditorOpen && !isDesktop && invoiceEditorMode !== 'view' && (
        <MobileBillingWizard
          open={true}
          onClose={closeInvoiceEditor}
          title={editingInvoiceId ? 'Modifier la facture' : 'Nouvelle facture'}
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
          saveLabel={editingInvoiceId ? 'Mettre à jour' : 'Enregistrer facture'}
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
      {quoteOpen && isDesktop && (
        <DocumentEditor
          docType="quote"
          mode={quoteEditorMode}
          articles={articles}
          customers={customers}
          headerForm={{ customer_id: quoteForm.customer_id, note: quoteForm.note, delivery_date: quoteForm.delivery_date, reference: quoteForm.reference, warranty: quoteForm.warranty, representative: quoteForm.representative, imei: quoteForm.imei, valid_until: quoteForm.valid_until }}
          setHeaderForm={(fn: any) => setQuoteForm((prev: any) => typeof fn === 'function' ? fn(prev) : fn)}
          items={quoteItems}
          setItems={setQuoteItems}
          subtotal={quoteSubtotal}
          saving={saving}
          onSave={() => saveQuote()}
          onClose={closeQuotePanel}
          editingId={editingQuoteId}
          documentNumber={editingQuote?.quote_number}
          documentStatus={editingQuote?.status}
          docSettings={quoteDocSettings}
          autoMode={autoMode}
          onVehiclePicker={(idx: number | null) => { setVehiclePickerTargetIdx(idx); setVehiclePickerOpen(true); }}
          onChangeStatus={(status: string) => { if (editingQuote) { changeQuoteStatus(editingQuote, status); setEditingQuote({ ...editingQuote, status }); } }}
          onConvert={() => { if (editingQuote) openConvert(editingQuote); }}
          isPharmacy={isPharmacy}
          ipmBeneficiaire={quoteIpmBeneficiaire}
          ipmTaux={quoteIpmTaux}
          ipmPartIpm={quoteIpmPartIpm}
          ipmPartClient={quoteIpmPartClient}
          onPrint={() => {
            if (!editingQuote || !tenant) return;
            const pitems = quoteItems.filter(i => i.name.trim()).map(i => ({ name: i.name, supplier_ref: null, oem_ref: null, quantity: Number(i.quantity), unit_price: Number(i.unit_price), discount: Number(i.discount || 0) }));
            const psubtotal = pitems.reduce((s, i) => s + i.quantity * i.unit_price - (i.discount || 0), 0);
            printDocumentA4({ tenant: tenantForPrint(tenant, currentSite), docLabel: 'DEVIS', docNumber: editingQuote.quote_number || 'Brouillon', docDate: new Date(editingQuote.created_at).toLocaleDateString('fr-FR'), customer: editingQuote.customers ? { name: editingQuote.customers.name } : null, items: pitems, subtotal: psubtotal, total: psubtotal, payments: [], paid: 0, issuedBy: creatorName((editingQuote as any).user_id), docHeader: quoteForm.reference || quoteForm.delivery_date || quoteForm.warranty || repLabelOf(quoteForm.representative) ? { reference: quoteForm.reference || null, delivery_date: quoteForm.delivery_date || null, warranty: quoteForm.warranty || null, representative: repLabelOf(quoteForm.representative) } : null });
          }}
          onCreateArticle={(name) => { setQuickArticleName(name); setQuickArticleOpen(true); }}
          onCreateCustomer={(name) => { setQuickCustomerName(name); setQuickCustomerOpen(true); }}
          reps={activeReps}
          onEdit={editingQuote && quoteEditorMode === 'view' ? () => openQuoteForEdit(editingQuote) : undefined}
        />
      )}

      {/* ── Quote create modal (mobile only) ──────────────────────────────── */}
      {quoteOpen && !isDesktop && (
        <MobileBillingWizard
          open={true}
          onClose={closeQuotePanel}
          title={editingQuoteId ? 'Edition devis' : 'Nouveau devis'}
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
      {returnEditorOpen && returnDetail && (
        <DocumentEditor
          docType="return"
          mode="view"
          articles={articles}
          customers={customers}
          headerForm={{
            customer_id: returnDetail.customer_id || '',
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
            total: Number(i.quantity) * Number(i.unit_price),
          }))}
          setItems={() => {}}
          subtotal={returnItemsDetail.reduce((s: number, i: any) => s + Number(i.quantity) * Number(i.unit_price), 0)}
          saving={false}
          onSave={() => {}}
          onClose={() => { setReturnEditorOpen(false); setReturnDetail(null); }}
          editingId={returnDetail.id}
          documentNumber={returnDetail.return_number}
          documentStatus={returnDetail.status}
          docSettings={docSettings}
          onPrint={printReturn}
          onRefundCash={returnDetail.status === 'pending' ? () => setReturnCashConfirmOpen(true) : undefined}
          onApproveAvoir={returnDetail.status === 'pending' ? () => approveAsAvoir(returnDetail) : undefined}
        />
      )}

      {/* ── Quote detail ─────────────────────────────────────── */}
      <Modal open={!!quoteDetail} onClose={() => setQuoteDetail(null)} title={quoteDetail ? `Devis ${quoteDetail.quote_number}` : ''} size="lg"
        footer={<>
          <div className="flex gap-1.5 mr-auto">
            {quoteDetail?.status === 'draft' && <button onClick={() => changeQuoteStatus(quoteDetail, 'sent')} className="btn-icon" title="Marquer envoyé"><CheckCircle className="w-4 h-4 text-neutral-600" /></button>}
            {quoteDetail && ['draft', 'sent'].includes(quoteDetail.status) && <button onClick={() => changeQuoteStatus(quoteDetail, 'accepted')} className="btn-icon-success" title="Accepter"><CheckCircle className="w-4 h-4" /></button>}
            {quoteDetail?.status === 'accepted' && <button onClick={() => openConvert(quoteDetail)} className="btn-icon-primary" title="Convertir en facture"><ArrowRight className="w-4 h-4" /></button>}
          </div>
          <button onClick={() => setQuoteDetail(null)} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>
          <button onClick={printQuote} className="btn-icon-primary" title="Imprimer"><Printer className="w-4 h-4" /></button>
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
              {quoteDetail.note && <div className="p-3 bg-slate-50 rounded-xl text-sm text-slate-600 border border-slate-200/70"><span className="font-semibold">Note :</span> {quoteDetail.note}</div>}
            </div>
          );
        })()}
      </Modal>

      <ConfirmDialog open={!!quoteToCancel} onClose={() => setQuoteToCancel(null)} onConfirm={async () => { if (!quoteToCancel) return; await changeQuoteStatus(quoteToCancel, 'rejected'); setQuoteToCancel(null); }} title="Refuser le devis ?" message={`Le devis "${quoteToCancel?.quote_number}" sera marqué comme refusé.`} danger />

      {/* ── Convert quote → sale ─────────────────────────────── */}
      <Modal open={!!convertFrom} onClose={() => !converting && setConvertFrom(null)} title="Convertir en facture" size="sm" layer="top"
        footer={<>
          <button onClick={() => setConvertFrom(null)} className="btn-icon" title="Annuler" disabled={converting}><X className="w-4 h-4" /></button>
          <button onClick={confirmConvert} disabled={converting || (!!convertIpmBeneficiaire && !!convertIpmConvention && !validerDocumentsIpm(parseConvention(convertIpmConvention)!, convertIpmDocs, convertIpmBeneficiaire?.matricule).valide)} className="btn-icon-primary" title="Créer facture">{converting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}</button>
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
                  <div className="text-[10px] font-bold uppercase tracking-wider text-brand-700/70">Total</div>
                  <div className="text-lg font-bold text-brand-900 num">{formatFCFA(convertFrom.total)}</div>
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

            <label className="flex items-center gap-2 cursor-pointer p-3 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors">
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

            <div className="text-[11px] text-slate-500 p-3 rounded-xl bg-slate-50 border border-slate-200/70">
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
        items={convertItems}
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

      {/* ── Invoice detail ───────────────────────────────────── */}
      <DocPanel open={!!invoiceDetail && !invoiceEditorOpen} onClose={() => setInvoiceDetail(null)} title={invoiceDetail ? `Facture ${invoiceDetail.sale_number}` : ''}
        footer={<>
          <div className="flex gap-1.5 mr-auto">
            {invoiceDetail && invoiceDetail.status !== 'cancelled' && invoiceDetail.accounting_status !== 'accounted' && (
              <button onClick={() => openInvoiceForEdit(invoiceDetail)} className="btn-icon text-brand-700 hover:bg-brand-50" title="Modifier"><Pencil className="w-4 h-4" /></button>
            )}
            {invoiceDetail && invoiceDue > 0 && invoiceDetail.status !== 'cancelled' && <button onClick={openPay} className="btn-icon-success" title="Encaisser"><Coins className="w-4 h-4" /></button>}
            {invoiceDetail && invoiceDue > 0 && availableCredits.length > 0 && invoiceDetail.status !== 'cancelled' && <button onClick={openCreditApply} className="btn-icon" title="Appliquer avoir"><Wallet className="w-4 h-4" /></button>}
            {invoiceDetail && invoiceDetail.accounting_status !== 'accounted' && invoiceDetail.status !== 'cancelled' && (
              <button onClick={comptabiliserFacture} disabled={accountingBusy} className="btn-icon text-teal-700 hover:bg-teal-50" title="Comptabiliser">
                {accountingBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4" />}
              </button>
            )}
            {invoiceDetail && invoiceDetail.accounting_status === 'accounted' && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-teal-50 text-teal-700 border border-teal-200"><BookOpen className="w-3 h-3" />Comptabilisé</span>
            )}
          </div>
          <button onClick={() => copyInvoiceLink()} className="btn-icon" title="Copier le lien"><Link2 className="w-4 h-4" /></button>
          {invoiceDetail?.customers && (
            <button onClick={() => sendInvoiceWhatsApp()} className="btn-icon" title="WhatsApp" style={{ color: '#25D366' }}><MessageCircle className="w-4 h-4" /></button>
          )}
          <button onClick={() => setInvoiceDetail(null)} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>
          <button onClick={printInvoice} className="btn-icon-primary" title="Imprimer"><Printer className="w-4 h-4" /></button>
        </>}>
        {invoiceDetail && (() => {
          const st = invoiceStatus(invoiceDetail);
          const slimStatus: DocStatusConfig = {
            label: st.label,
            color: invoiceDetail.status === 'cancelled' ? 'rose' : invoiceDetail.paid >= invoiceDetail.total ? 'emerald' : Number(invoiceDetail.paid) > 0 ? 'amber' : 'slate',
          };
          return (
            <div className="space-y-4">
              <DocSlimHeader
                status={slimStatus}
                customerName={invoiceDetail.customers?.name ?? null}
                date={(invoiceDetail as any).doc_header?.doc_date || formatDateTime(invoiceDetail.created_at)}
                docHeader={(invoiceDetail as any).doc_header ? { ...(invoiceDetail as any).doc_header, created_at: invoiceDetail.created_at } : null}
              />
              <div className="space-y-3">
                <DocSectionTitle title="Articles" count={invoiceItems.length} />
                <DocItems items={invoiceItems.map(i => ({
                  id: i.id,
                  name: i.name,
                  internal_ref: i.articles?.internal_ref || null,
                  oem_ref: i.articles?.oem_ref || null,
                  quantity: Number(i.quantity),
                  unit_price: Number(i.unit_price),
                  discount: Number(i.discount ?? 0),
                  total: Number(i.total),
                }) satisfies DocItem)} />
                {(() => {
                  const subtotal = invoiceItems.reduce((s, i) => s + Number(i.total), 0);
                  const paidTotal = invoicePays.reduce((s, p) => s + Number(p.amount), 0);
                  const due = Math.max(0, Number(invoiceDetail.total) - paidTotal);
                  return (
                    <DocTotals
                      subtotal={subtotal}
                      total={Number(invoiceDetail.total)}
                      paid={paidTotal > 0 ? paidTotal : undefined}
                      remaining={due > 0 ? due : undefined}
                    />
                  );
                })()}
                {invoicePays.length > 0 && (
                  <div className="space-y-2">
                    <DocSectionTitle title="Paiements" count={invoicePays.length} />
                    <DocPayments
                      payments={invoicePays.map(p => ({ method_name: p.method_name, amount: Number(p.amount), paid_at: p.created_at }) satisfies DocPayment)}
                      formatDate={formatDateTime}
                    />
                  </div>
                )}
                {invoiceIpmVente && (
                  <div className="space-y-2 mt-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-teal-700 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" />Suivi IPM</h4>
                    <div className="rounded-xl border border-teal-200 bg-teal-50/50 p-3 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">Organisme</span>
                        <span className="font-semibold text-slate-900">{invoiceIpmVente.ipm_organismes?.nom || '—'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">Taux de prise en charge</span>
                        <span className="font-semibold text-slate-900">{invoiceIpmVente.taux_prise_en_charge ? `${invoiceIpmVente.taux_prise_en_charge}%` : '—'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">Part bénéficiaire</span>
                        <span className="font-mono font-bold text-slate-900">{formatFCFA(Number(invoiceIpmVente.part_client))}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">Part bénéficiaire payée</span>
                        <span className="font-mono font-bold text-emerald-700">{invoiceIpmVente.part_beneficiaire_payee != null ? formatFCFA(Number(invoiceIpmVente.part_beneficiaire_payee)) : '—'}</span>
                      </div>
                      <hr className="border-teal-200" />
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">Part IPM attendue</span>
                        <span className="font-mono font-bold text-teal-700">{formatFCFA(Number(invoiceIpmVente.part_ipm))}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">Montant accepté IPM</span>
                        <span className="font-mono font-bold text-teal-700">{invoiceIpmVente.montant_ipm_accepte != null ? formatFCFA(Number(invoiceIpmVente.montant_ipm_accepte)) : '—'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">Montant payé IPM</span>
                        <span className="font-mono font-bold text-emerald-700">{invoiceIpmVente.montant_ipm_paye != null ? formatFCFA(Number(invoiceIpmVente.montant_ipm_paye)) : '—'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">Montant rejeté</span>
                        <span className={`font-mono font-bold ${Number(invoiceIpmVente.montant_rejete) > 0 ? 'text-red-600' : 'text-slate-500'}`}>{invoiceIpmVente.montant_rejete != null ? formatFCFA(Number(invoiceIpmVente.montant_rejete)) : '—'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">Écart IPM</span>
                        <span className={`font-mono font-bold ${Number(invoiceIpmVente.ecart_ipm) !== 0 ? 'text-amber-600' : 'text-slate-500'}`}>{invoiceIpmVente.ecart_ipm != null ? formatFCFA(Number(invoiceIpmVente.ecart_ipm)) : '—'}</span>
                      </div>
                      {invoiceIpmVente.motif_rejet && (
                        <div className="flex items-center justify-between">
                          <span className="text-slate-600">Motif du rejet</span>
                          <span className="font-semibold text-red-600">{invoiceIpmVente.motif_rejet}</span>
                        </div>
                      )}
                      <hr className="border-teal-200" />
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">Statut IPM</span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          invoiceIpmVente.statut === 'payee' ? 'bg-emerald-100 text-emerald-700' :
                          invoiceIpmVente.statut === 'validee' ? 'bg-neutral-100 text-neutral-800' :
                          invoiceIpmVente.statut === 'rejet_partiel' || invoiceIpmVente.statut === 'rejet_total' ? 'bg-red-100 text-red-700' :
                          invoiceIpmVente.statut === 'ecart_a_regulariser' ? 'bg-amber-100 text-amber-700' :
                          invoiceIpmVente.statut === 'contestee' ? 'bg-neutral-100 text-neutral-800' :
                          invoiceIpmVente.statut === 'regularisee' ? 'bg-emerald-100 text-emerald-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>{
                          invoiceIpmVente.statut === 'en_attente' ? 'En attente' :
                          invoiceIpmVente.statut === 'bordereau' ? 'Bordereau' :
                          invoiceIpmVente.statut === 'validee' ? 'Validée' :
                          invoiceIpmVente.statut === 'payee' ? 'Payée' :
                          invoiceIpmVente.statut === 'rejet_partiel' ? 'Rejet partiel' :
                          invoiceIpmVente.statut === 'rejet_total' ? 'Rejet total' :
                          invoiceIpmVente.statut === 'ecart_a_regulariser' ? 'Écart à régulariser' :
                          invoiceIpmVente.statut === 'contestee' ? 'Contestée' :
                          invoiceIpmVente.statut === 'regularisee' ? 'Régularisée' :
                          invoiceIpmVente.statut || '—'
                        }</span>
                      </div>
                      {invoiceIpmVente.action_regularisation && (
                        <div className="flex items-center justify-between">
                          <span className="text-slate-600">Action de régularisation</span>
                          <span className="font-semibold text-amber-700">{
                            invoiceIpmVente.action_regularisation === 'refacturer_beneficiaire' ? 'Refacturer au bénéficiaire' :
                            invoiceIpmVente.action_regularisation === 'perte_pharmacie' ? 'Perte / remise pharmacie' :
                            invoiceIpmVente.action_regularisation === 'contester_ipm' ? 'Contester auprès de l\'IPM' :
                            invoiceIpmVente.action_regularisation === 'corriger_renvoyer' ? 'Corriger et renvoyer' :
                            invoiceIpmVente.action_regularisation === 'avoir_ajustement' ? 'Avoir / ajustement' :
                            invoiceIpmVente.action_regularisation === 'regularise' ? 'Régularisé' :
                            invoiceIpmVente.action_regularisation
                          }</span>
                        </div>
                      )}
                      {invoiceIpmVente.date_retour_ipm && (
                        <div className="flex items-center justify-between">
                          <span className="text-slate-600">Date retour IPM</span>
                          <span className="font-semibold text-slate-900">{formatDate(invoiceIpmVente.date_retour_ipm)}</span>
                        </div>
                      )}
                      {invoiceIpmVente.reference_reglement && (
                        <div className="flex items-center justify-between">
                          <span className="text-slate-600">Réf. règlement</span>
                          <span className="font-semibold text-slate-900">{invoiceIpmVente.reference_reglement}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </DocPanel>

      {/* ── Register payment modal ───────────────────────────── */}
      <Modal open={payOpen} onClose={() => !paying && setPayOpen(false)} title="Encaisser la facture" size="sm" layer="top"
        footer={<>
          <button onClick={() => setPayOpen(false)} className="btn-icon" title="Annuler" disabled={paying}><X className="w-4 h-4" /></button>
          <button onClick={registerPayment} disabled={paying} className="btn-icon-primary" title="Enregistrer">{paying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Coins className="w-4 h-4" />}</button>
        </>}>
        {invoiceDetail && (
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700/70">Solde dû</div>
                <div className="doc-number text-sm font-bold text-amber-900 mt-0.5">{invoiceDetail.sale_number}</div>
              </div>
              <div className="text-xl font-bold text-amber-700 num">{formatFCFA(invoiceDue)}</div>
            </div>
            <div>
              <label className="label">Mode de règlement</label>
              <select value={payMethod} onChange={e => setPayMethod(e.target.value)} className="input">
                {paymentMethods.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Montant encaissé</label>
              <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)} className="input num text-lg font-bold" />
              <div className="flex gap-1.5 mt-1.5">
                <button type="button" onClick={() => setPayAmount(String(invoiceDue))} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 uppercase tracking-wider">Solde total</button>
                <button type="button" onClick={() => setPayAmount(String(Math.round(invoiceDue / 2)))} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 uppercase tracking-wider">Moitié</button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Apply credit modal ──────────────────────────────── */}
      <Modal open={creditOpen} onClose={() => !applyingCredit && setCreditOpen(false)} title="Appliquer un avoir" size="sm"
        footer={<>
          <button onClick={() => setCreditOpen(false)} className="btn-icon" title="Annuler" disabled={applyingCredit}><X className="w-4 h-4" /></button>
          <button onClick={applyCredit} disabled={applyingCredit} className="btn-icon-primary" title="Appliquer">{applyingCredit ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}</button>
        </>}>
        {invoiceDetail && (
          <div className="space-y-3">
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-between">
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700/70">Solde dû</div>
              <div className="text-base font-bold text-amber-700 num">{formatFCFA(invoiceDue)}</div>
            </div>
            <div>
              <label className="label">Avoir disponible</label>
              <select value={creditSelected} onChange={e => {
                setCreditSelected(e.target.value);
                const c = availableCredits.find(x => x.id === e.target.value);
                if (c) {
                  const avail = Number(c.total) - Number(c.credit_used || 0);
                  setCreditAmount(String(Math.min(invoiceDue, avail)));
                }
              }} className="input">
                <option value="">— Sélectionnez —</option>
                {availableCredits.map(c => {
                  const avail = Number(c.total) - Number(c.credit_used || 0);
                  return <option key={c.id} value={c.id}>{c.return_number} · Solde {formatFCFA(avail)}</option>;
                })}
              </select>
              {availableCredits.length === 0 && <div className="text-[11px] text-slate-500 mt-1">Aucun avoir disponible pour ce client.</div>}
            </div>
            <div>
              <label className="label">Montant à appliquer</label>
              <input type="number" value={creditAmount} onChange={e => setCreditAmount(e.target.value)} className="input num text-lg font-bold" />
            </div>
          </div>
        )}
      </Modal>

      {/* ── Return create modal ─────────────────────────────── */}
      <Modal open={returnOpen} onClose={() => setReturnOpen(false)} title={returnMode === 'avoir' ? 'Nouvel avoir client' : 'Nouveau retour client'} size="lg" fullMobile
        footer={<>
          <button onClick={() => setReturnOpen(false)} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
          <button onClick={() => saveReturn()} disabled={saving || returnLines.filter(i => i.selected && i.quantity > 0).length === 0} className="btn-icon-primary" title="Enregistrer">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (returnMode === 'avoir' ? <Wallet className="w-4 h-4" /> : <RotateCcw className="w-4 h-4" />)}
          </button>
        </>}>
        <div className="space-y-2 sm:space-y-4">
          <div>
            <label className="text-[9px] sm:text-xs font-bold uppercase tracking-wider text-slate-500 mb-0.5 block">Vente d'origine *</label>
            <div className="relative">
              <select value={returnForm.sale_id} onChange={e => handleSaleChange(e.target.value)} className="bare-input w-full text-xs sm:text-sm py-1.5 pr-6">
                <option value="">-- Sélectionnez une vente --</option>
                {sales.map(s => <option key={s.id} value={s.id}>{s.sale_number}{s.customers ? ` - ${s.customers.name}` : ''} ({formatFCFA(s.total || 0)})</option>)}
              </select>
              <div className="h-px bg-neutral-300 mt-0.5" />
            </div>
          </div>

          {returnLines.length === 0 && returnForm.sale_id && (
            <div className="py-4 text-center text-xs text-slate-500">Tous les articles de cette vente ont déjà été retournés.</div>
          )}

          {returnLines.length > 0 && (
            <div>
              <label className="text-[9px] sm:text-xs font-bold uppercase tracking-wider text-slate-500 mb-1 block">Articles à retourner</label>
              <div className="space-y-0 overflow-y-auto -mx-0.5 px-0.5" style={{ maxHeight: 'calc(100vh - 350px)' }}>
                {returnLines.map((it, idx) => {
                  const toggle = (v: boolean) => setReturnLines(p => p.map((x, i) => i === idx ? { ...x, selected: v } : x));
                  const setQty = (q: number) => setReturnLines(p => p.map((x, i) => i === idx ? { ...x, quantity: Math.min(it.max_qty, Math.max(1, q)) } : x));
                  return (
                    <div key={idx} className={`py-2.5 transition-all border-b border-neutral-100 ${it.selected ? 'opacity-100' : 'opacity-60'}`}>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => toggle(!it.selected)} className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${it.selected ? 'bg-neutral-900 border-neutral-900' : 'bg-white border-neutral-300'}`}>
                          {it.selected && <CheckCircle className="w-3 h-3 text-white" />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-semibold text-slate-900 leading-tight truncate">{it.name}</div>
                          <div className="text-[9px] text-slate-500 num">{formatFCFA(it.unit_price)} x max {it.max_qty}</div>
                        </div>
                        {it.selected && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button type="button" onClick={() => setQty(it.quantity - 1)} className="w-6 h-6 flex items-center justify-center text-slate-500 hover:text-slate-900"><Minus className="w-3 h-3" /></button>
                            <input type="number" value={it.quantity} onChange={e => setQty(Number(e.target.value))} min="1" max={it.max_qty} className="w-8 text-center text-[11px] font-bold num bg-transparent outline-none border-b border-neutral-300" />
                            <button type="button" onClick={() => setQty(it.quantity + 1)} className="w-6 h-6 flex items-center justify-center text-slate-500 hover:text-slate-900"><Plus className="w-3 h-3" /></button>
                          </div>
                        )}
                        <span className="num text-[11px] font-bold text-slate-800 shrink-0 w-16 text-right">
                          {it.selected ? formatFCFA(it.quantity * it.unit_price) : '--'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {returnLines.filter(i => i.selected).length > 0 && (
                <div className="mt-2 flex items-center justify-between py-2 border-b-2 border-neutral-900">
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Total {returnMode === 'avoir' ? 'avoir' : 'retour'}</div>
                    <div className="text-[10px] text-slate-500">{returnLines.filter(i => i.selected).length} article{returnLines.filter(i => i.selected).length > 1 ? 's' : ''}</div>
                  </div>
                  <div className="num text-lg font-bold text-neutral-900">{formatFCFA(returnTotal)}</div>
                </div>
              )}
            </div>
          )}

          <div>
            <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-0.5 block">Motif</label>
            <input value={returnForm.reason} onChange={e => setReturnForm(f => ({ ...f, reason: e.target.value }))} className="bare-input w-full text-xs py-1.5" placeholder="Motif du retour..." />
            <div className="h-px bg-neutral-300 mt-0.5" />
          </div>

          <label className="flex items-center gap-2 cursor-pointer py-1.5">
            <input type="checkbox" checked={returnForm.restock} onChange={e => setReturnForm(f => ({ ...f, restock: e.target.checked }))} className="w-3.5 h-3.5 rounded" />
            <span className="text-[11px] font-medium text-slate-700">Remettre en stock automatiquement</span>
          </label>
        </div>
      </Modal>

      {/* ── Return detail ─────────────────────────────────────── */}
      <DocPanel open={!!returnDetail && !returnEditorOpen} onClose={() => setReturnDetail(null)} title={returnDetail ? `${returnDetail.refund_method === 'avoir' ? 'Avoir' : 'Retour'} ${returnDetail.return_number}` : ''}
        footer={<>
          <button onClick={() => setReturnDetail(null)} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>
          <button onClick={printReturn} className="btn-icon-primary" title="Imprimer"><Printer className="w-4 h-4" /></button>
        </>}>
        {returnDetail && (() => {
          const isCredit = returnDetail.refund_method === 'avoir';
          const st = isCredit ? creditStatus(returnDetail) : (RETURN_STATUS[returnDetail.status] || RETURN_STATUS.pending);
          const used = Number(returnDetail.credit_used || 0);
          const balance = Number(returnDetail.total) - used;
          return (
            <div className="space-y-4">
              <DocSlimHeader
                status={{ label: st.label, color: 'slate' as any }}
                customerName={returnDetail.customers?.name ?? null}
                date={formatDateTime(returnDetail.created_at)}
                extra={returnDetail.sales?.sale_number ? `Vente ${returnDetail.sales.sale_number}` : undefined}
              />

              {/* Workflow: pending return → choose action */}
              {returnDetail.status === 'pending' && (
                <div className="py-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <RotateCcw className="w-4 h-4 text-amber-600 shrink-0" />
                    <div>
                      <div className="text-xs font-bold text-neutral-900">Traitement du retour</div>
                      <div className="text-[10px] text-slate-500">Choisissez comment rembourser le client</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setReturnCashConfirmOpen(true)}
                      disabled={returnWorkflowBusy}
                      className="flex flex-col items-center gap-1.5 px-3 py-3 transition-all active:scale-[0.97] disabled:opacity-50"
                    >
                      <Coins className="w-5 h-5 text-emerald-600" />
                      <div className="text-[11px] font-bold text-slate-800">Rembourser en caisse</div>
                      <div className="text-[9px] text-slate-500 text-center">Sortie caisse immédiate</div>
                    </button>
                    <button
                      onClick={() => approveAsAvoir(returnDetail)}
                      disabled={returnWorkflowBusy}
                      className="flex flex-col items-center gap-1.5 px-3 py-3 transition-all active:scale-[0.97] disabled:opacity-50"
                    >
                      <Wallet className="w-5 h-5 text-neutral-700" />
                      <div className="text-[11px] font-bold text-slate-800">Créer un avoir</div>
                      <div className="text-[9px] text-slate-500 text-center">Imputer sur prochaine facture</div>
                    </button>
                  </div>
                  {returnWorkflowBusy && (
                    <div className="flex items-center justify-center gap-2 py-1">
                      <Loader2 className="w-4 h-4 animate-spin text-amber-600" />
                      <span className="text-xs text-amber-600">Traitement...</span>
                    </div>
                  )}
                </div>
              )}

              {/* Avoir: show credit balance and usage */}
              {isCredit && returnDetail.status === 'approved' && (
                <div className="py-2 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Wallet className="w-3.5 h-3.5 text-slate-600" />
                      <span className="text-[11px] font-bold text-neutral-900">Solde avoir</span>
                    </div>
                    <span className="text-sm font-bold text-neutral-900 num">{formatFCFA(balance)}</span>
                  </div>
                  {used > 0 && (
                    <div className="flex items-center justify-between text-[10px] text-slate-600 border-t border-neutral-100 pt-1.5">
                      <span>Montant initial</span>
                      <span className="num">{formatFCFA(Number(returnDetail.total))}</span>
                    </div>
                  )}
                  {used > 0 && (
                    <div className="flex items-center justify-between text-[10px] text-slate-600">
                      <span>Déjà utilisé</span>
                      <span className="num">-{formatFCFA(used)}</span>
                    </div>
                  )}
                  {balance <= 0 && (
                    <div className="text-[10px] font-semibold text-slate-500 text-center pt-0.5">Avoir entièrement utilisé</div>
                  )}
                </div>
              )}

              {/* Cash refund: show approved status */}
              {!isCredit && returnDetail.status === 'approved' && (
                <div className="flex items-center gap-2 py-2">
                  <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                  <div>
                    <div className="text-[11px] font-bold text-emerald-800">Remboursé en caisse</div>
                    <div className="text-[10px] text-emerald-700 num">{formatFCFA(Number(returnDetail.total))}</div>
                  </div>
                </div>
              )}

              {returnDetail.reason && <div className="py-2 text-sm border-b border-neutral-100"><span className="font-semibold">Motif :</span> {returnDetail.reason}</div>}
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Articles retournés</div>
                <div className="space-y-0">
                  {returnItemsDetail.map(i => (
                    <div key={i.id} className="py-2.5 flex items-start gap-3 border-b border-neutral-100">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-900 line-clamp-2">{i.name}</div>
                        {i.articles?.internal_ref && <div className="text-[10px] text-slate-400 font-mono mt-0.5">{i.articles.internal_ref}</div>}
                        {i.articles?.oem_ref && <div className="text-[10px] text-slate-400 font-mono">OEM: {i.articles.oem_ref}</div>}
                        <div className="text-[11px] text-slate-500 num mt-0.5">Qté {i.quantity} · {formatFCFA(i.unit_price)}</div>
                      </div>
                      <div className={`num font-bold shrink-0 ${isCredit ? 'text-neutral-900' : 'text-red-700'}`}>{formatFCFA(i.total)}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between py-2.5 border-b-2 border-neutral-900">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total</span>
                  <span className="text-base font-bold num text-neutral-900">{formatFCFA(Number(returnDetail.total))}</span>
                </div>
              </div>
            </div>
          );
        })()}
      </DocPanel>

      {/* Confirm cash refund */}
      {returnDetail && (
        <ConfirmDialog
          open={returnCashConfirmOpen}
          onClose={() => setReturnCashConfirmOpen(false)}
          onConfirm={() => approveAsCash(returnDetail)}
          title="Rembourser en caisse ?"
          message={`Le montant de ${formatFCFA(Number(returnDetail.total))} sera enregistré comme sortie caisse. Cette action est irréversible.`}
          confirmLabel="Confirmer le remboursement"
          danger={false}
          layer="top"
        />
      )}

      {cancelTarget && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget && !cancelling) { setCancelTarget(null); setCancelReason(''); } }}>
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
              <button disabled={cancelling} onClick={() => { setCancelTarget(null); setCancelReason(''); }} className="px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 rounded transition-colors disabled:opacity-50">Non, garder</button>
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
            const targetUpdate = invoiceEditorOpen ? updateInvoiceItem : updateQuoteItem;
            const targetSet = invoiceEditorOpen ? setInvoiceEditorItems : setQuoteItems;
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
      {invoiceSearchOpen && (() => {
        const q = invoiceSearchQuery.toLowerCase().trim();
        const filtered = q
          ? invoices.filter(inv => {
              const num = (inv.sale_number || '').toLowerCase();
              const name = (inv.customers?.name || '').toLowerCase();
              const amt = String(inv.total);
              return num.includes(q) || name.includes(q) || amt.includes(q);
            }).slice(0, 30)
          : invoices.slice(0, 20);
        return (
          <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[10vh]" onClick={() => { setInvoiceSearchOpen(false); setInvoiceSearchQuery(''); }}>
            <div className="absolute inset-0 bg-black/40" />
            <div className="relative bg-white w-full max-w-md rounded-xl shadow-2xl overflow-hidden max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="px-4 pt-4 pb-2">
                <input
                  autoFocus
                  type="text"
                  placeholder="Rechercher une facture (n°, client, montant)…"
                  className="w-full text-sm outline-none border-0 border-b border-slate-200 focus:border-slate-900 pb-2 bg-transparent placeholder:text-slate-400 transition-colors"
                  value={invoiceSearchQuery}
                  onChange={e => setInvoiceSearchQuery(e.target.value)}
                />
              </div>
              <div className="overflow-y-auto flex-1 px-2 pb-2">
                {filtered.map(inv => (
                  <button
                    key={inv.id}
                    onClick={() => { setInvoiceSearchOpen(false); setInvoiceSearchQuery(''); openInvoiceForView(inv); }}
                    className="w-full text-left px-3 py-2.5 hover:bg-slate-50 rounded-lg transition-colors flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 doc-number">{inv.sale_number}</div>
                      <div className="text-[11px] text-slate-500 truncate">{inv.customers?.name || 'Client comptoir'}</div>
                    </div>
                    <div className="text-sm font-bold text-slate-700 num shrink-0">{formatFCFA(inv.total)}</div>
                  </button>
                ))}
                {filtered.length === 0 && <div className="text-center text-sm text-slate-400 py-6">Aucune facture trouvée</div>}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
