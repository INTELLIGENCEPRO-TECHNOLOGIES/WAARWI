import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import {
  Plus, FileText, Loader2, Eye, Printer, CheckCircle, X, Trash2, Car,
  Receipt, RotateCcw, Wallet, Minus, Package, Filter, Check, Calendar, CalendarDays, User,
  CreditCard, ShoppingCart, ArrowRight, Coins, MessageCircle, Link2, Search, GripVertical, Lock, BookOpen,
  Tag, ShieldCheck, Smartphone, Pencil,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { usePermissions } from '../lib/permissions';
import { useToast } from '../context/ToastContext';
import { Modal, ConfirmDialog, DocPanel } from '../components/Modal';
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
import { LotPickerModal, type ArticleLotSelection } from '../components/LotPickerModal';
import { type DocSettings, type DocColumn, DEFAULT_COLUMNS, DEFAULT_DOC_SETTINGS, mergeColumns } from '../components/DocumentSettingsTab';
import { QuickCreateArticleModal, QuickCreateCustomerModal, QuickCreateButton } from '../components/QuickCreate';
import { type SalesRepresentative, type RepCommissionSettings, DEFAULT_REP_SETTINGS, computeRepCommission, repDisplayName } from '../lib/repCommission';

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
  draft:     { label: 'Brouillon', pill: 'bg-slate-100 text-slate-700 border-slate-200', dot: 'bg-slate-400' },
  sent:      { label: 'Envoyé',    pill: 'bg-neutral-50 text-neutral-800 border-neutral-200',     dot: 'bg-neutral-500' },
  accepted:  { label: 'Accepté',   pill: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  rejected:  { label: 'Refusé',    pill: 'bg-red-50 text-red-700 border-red-200',        dot: 'bg-red-500' },
  converted: { label: 'Converti',  pill: 'bg-brand-50 text-brand-700 border-brand-200',  dot: 'bg-brand-500' },
  expired:   { label: 'Expiré',    pill: 'bg-amber-50 text-amber-700 border-amber-200',  dot: 'bg-amber-500' },
};

function invoiceStatus(s: Invoice) {
  if (s.status === 'cancelled') return { label: 'Annulée', pill: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' };
  if (s.paid >= s.total)        return { label: 'Payée', pill: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' };
  if (Number(s.paid) > 0)       return { label: 'Partiellement payée', pill: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' };
  if (s.status === 'validated' && Number(s.paid) === 0) return { label: 'À crédit', pill: 'bg-slate-100 text-slate-700 border-slate-300', dot: 'bg-slate-500' };
  return { label: 'Validée', pill: 'bg-neutral-50 text-neutral-800 border-neutral-200', dot: 'bg-neutral-500' };
}

const RETURN_STATUS: Record<string, { label: string; pill: string; dot: string }> = {
  pending:  { label: 'Brouillon', pill: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  approved: { label: 'Approuvé',  pill: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  rejected: { label: 'Rejeté',    pill: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' },
};

function creditStatus(r: SaleReturn) {
  if (r.status !== 'approved') return RETURN_STATUS[r.status] || RETURN_STATUS.pending;
  const used = Number(r.credit_used || 0);
  if (used >= Number(r.total)) return { label: 'Utilisé', pill: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' };
  if (used > 0) return { label: 'Partiel', pill: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' };
  return { label: 'Disponible', pill: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' };
}

const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: 'invoices', label: 'Factures', icon: Receipt },
  { key: 'quotes',   label: 'Devis',    icon: FileText },
  { key: 'returns',  label: 'Retours',  icon: RotateCcw },
  { key: 'credits',  label: 'Avoirs',   icon: Wallet },
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
  const [returnDetail, setReturnDetail] = useState<SaleReturn | null>(null);
  const [returnItemsDetail, setReturnItemsDetail] = useState<any[]>([]);
  const [returnForm, setReturnForm] = useState({ sale_id: '', reason: '', refund_method: 'cash' as string, restock: true });
  const [returnLines, setReturnLines] = useState<{ item_id: string; article_id: string; name: string; max_qty: number; quantity: number; unit_price: number; selected: boolean }[]>([]);
  const [returnWorkflowBusy, setReturnWorkflowBusy] = useState(false);
  const [returnCashConfirmOpen, setReturnCashConfirmOpen] = useState(false);

  // Direct invoice creation
  const [invoiceEditorOpen, setInvoiceEditorOpen] = useState(false);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [invoiceForm, setInvoiceForm] = useState<{ customer_id: string; note: string; delivery_date: string; reference: string; warranty: string; representative: string; imei: string }>({ customer_id: '', note: '', delivery_date: '', reference: '', warranty: '', representative: '', imei: '' });
  const [invoiceEditorItems, setInvoiceEditorItems] = useState<QuoteItem[]>([{ article_id: null, name: '', quantity: 1, unit_price: 0, discount: 0, total: 0 }]);
  const [invoicePayList, setInvoicePayList] = useState<{ method_id: string; method_name: string; amount: number; reference: string }[]>([]);
  const [invoiceIsCredit, setInvoiceIsCredit] = useState(false);
  const [savingInvoice, setSavingInvoice] = useState(false);
  const editingInvoicePrevRep = useRef<string | null>(null);

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

  const load = async (silent = false) => {
    if (!tenant || !currentSite) return;
    if (!silent) setLoading(true);
    const siteId = currentSite.id;
    const [q, s, r] = await Promise.all([
      supabase.from('quotes').select('*, customers(name, phone, address)').eq('tenant_id', tenant.id).eq('site_id', siteId).order('created_at', { ascending: false }).limit(300),
      supabase.from('sales').select('id, sale_number, total, paid, status, customer_id, user_id, representative_id, rep_commission, created_at, public_code, doc_header, customers(name, phone, address)').eq('tenant_id', tenant.id).eq('site_id', siteId).order('created_at', { ascending: false }).limit(300),
      supabase.from('sale_returns').select('*, customers(name, phone, address), sales(sale_number)').eq('tenant_id', tenant.id).eq('site_id', siteId).order('created_at', { ascending: false }).limit(300),
    ]);
    setQuotes((q.data as any) || []);
    setInvoices((s.data as any) || []);
    setReturns((r.data as any) || []);
    if (!silent) setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenant?.id, currentSite?.id]);
  useEffect(() => { if (currentSite && !billSourceSiteId) setBillSourceSiteId(currentSite.id); }, [currentSite?.id]);

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
  useEffect(() => { if (dataTick > 0) { const t = setTimeout(() => load(true), 400); return () => clearTimeout(t); } /* eslint-disable-next-line */ }, [dataTick]);

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
      supabase.from('sales').select('id, sale_number, customer_id, total, paid, status, customers(name)').eq('tenant_id', tenant.id).eq('site_id', currentSite.id).neq('status', 'cancelled').order('created_at', { ascending: false }).limit(200),
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

  const activeReps = useMemo(() => salesReps.filter(r => r.status === 'actif'), [salesReps]);
  const repById = useCallback((id?: string | null) => salesReps.find(r => r.id === id) || null, [salesReps]);
  const repLabelOf = useCallback((id?: string | null) => {
    const r = repById(id);
    return r ? repDisplayName(r) : null;
  }, [repById]);
  const creatorName = useCallback((userId?: string | null) => {
    if (!userId) return 'Utilisateur non renseigné';
    return profileNames[userId] || 'Utilisateur non renseigné';
  }, [profileNames]);

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

  // ── Filtering helpers ─────────────────────────────────────────
  const matchesCommon = (
    created_at: string,
    customer_id: string | null | undefined,
    amount: number
  ) => {
    if (customerFilter && customer_id !== customerFilter) return false;
    if (dateFrom) { if (new Date(created_at) < new Date(dateFrom)) return false; }
    if (dateTo) {
      const to = new Date(dateTo); to.setDate(to.getDate() + 1);
      if (new Date(created_at) >= to) return false;
    }
    const min = minAmount ? Number(minAmount) : null;
    const max = maxAmount ? Number(maxAmount) : null;
    if (min != null && amount < min) return false;
    if (max != null && amount > max) return false;
    return true;
  };

  const filteredQuotes = useMemo(() => {
    let r = quotes;
    if (statusFilter) r = r.filter(q => q.status === statusFilter);
    const q = search.toLowerCase().trim();
    if (q) r = r.filter(x => x.quote_number.toLowerCase().includes(q) || (x.customers?.name || '').toLowerCase().includes(q));
    return r.filter(x => matchesCommon(x.created_at, x.customer_id, Number(x.total)));
  }, [quotes, search, statusFilter, customerFilter, dateFrom, dateTo, minAmount, maxAmount]);

  const filteredInvoices = useMemo(() => {
    let r = invoices;
    if (statusFilter) {
      r = r.filter(i => {
        if (statusFilter === 'paid') return i.status !== 'cancelled' && i.paid >= i.total;
        if (statusFilter === 'partial') return i.status !== 'cancelled' && i.paid > 0 && i.paid < i.total;
        if (statusFilter === 'validated') return i.status !== 'cancelled' && Number(i.paid) === 0;
        if (statusFilter === 'cancelled') return i.status === 'cancelled';
        return true;
      });
    }
    const q = search.toLowerCase().trim();
    if (q) r = r.filter(x => x.sale_number.toLowerCase().includes(q) || (x.customers?.name || '').toLowerCase().includes(q));
    return r.filter(x => matchesCommon(x.created_at, x.customer_id, Number(x.total)));
  }, [invoices, search, statusFilter, customerFilter, dateFrom, dateTo, minAmount, maxAmount]);

  const filteredReturns = useMemo(() => {
    let r = returns.filter(x => x.refund_method !== 'avoir');
    if (statusFilter) r = r.filter(x => x.status === statusFilter);
    const q = search.toLowerCase().trim();
    if (q) r = r.filter(x => x.return_number.toLowerCase().includes(q) || (x.customers?.name || '').toLowerCase().includes(q) || (x.sales?.sale_number || '').toLowerCase().includes(q));
    return r.filter(x => matchesCommon(x.created_at, x.customer_id, Number(x.total)));
  }, [returns, search, statusFilter, customerFilter, dateFrom, dateTo, minAmount, maxAmount]);

  const filteredCredits = useMemo(() => {
    let r = returns.filter(x => x.refund_method === 'avoir');
    if (statusFilter) {
      r = r.filter(x => {
        if (statusFilter === 'available') return x.status === 'approved' && Number(x.credit_used || 0) === 0;
        if (statusFilter === 'partial') return x.status === 'approved' && Number(x.credit_used || 0) > 0 && Number(x.credit_used || 0) < Number(x.total);
        if (statusFilter === 'used') return x.status === 'approved' && Number(x.credit_used || 0) >= Number(x.total);
        if (statusFilter === 'pending') return x.status === 'pending';
        if (statusFilter === 'rejected') return x.status === 'rejected';
        return true;
      });
    }
    const q = search.toLowerCase().trim();
    if (q) r = r.filter(x => x.return_number.toLowerCase().includes(q) || (x.customers?.name || '').toLowerCase().includes(q) || (x.sales?.sale_number || '').toLowerCase().includes(q));
    return r.filter(x => matchesCommon(x.created_at, x.customer_id, Number(x.total)));
  }, [returns, search, statusFilter, customerFilter, dateFrom, dateTo, minAmount, maxAmount]);

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
      if (!opts?.silent) { success('Devis mis à jour'); closeQuotePanel(); load(); }
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
      if (!opts?.silent) { success('Devis créé'); closeQuotePanel(); load(); }
    }
  };

  const autoSaveQuote = async () => {
    if (!tenant || !currentSite) return;
    if (quoteItems.every(i => !i.name.trim())) return;
    await saveQuote({ silent: true });
  };

  const closeQuotePanel = () => {
    setQuoteOpen(false);
    setEditingQuoteId(null);
    setEditingQuote(null);
    setQuoteItems([{ article_id: null, name: '', quantity: 1, unit_price: 0, discount: 0, total: 0 }]);
    setQuoteForm({ customer_id: '', valid_until: '', note: '', delivery_date: '', reference: '', warranty: '', representative: '', imei: '' });
  };

  const openQuoteForEdit = async (q: Quote) => {
    const { data } = await supabase.from('quote_items').select('*, articles(internal_ref, oem_ref, sale_price)').eq('quote_id', q.id);
    setEditingQuoteId(q.id);
    setEditingQuote(q);
    setQuoteForm({ customer_id: q.customer_id || '', valid_until: q.valid_until || '', note: q.note || '', delivery_date: q.doc_header?.delivery_date || '', reference: q.doc_header?.reference || '', warranty: q.doc_header?.warranty || '', representative: (q as any).representative_id || '', imei: q.doc_header?.imei || '' });
    setQuoteItems((data || []).map((i: any) => ({
      article_id: i.article_id, name: i.name,
      quantity: Number(i.quantity), unit_price: Number(i.unit_price),
      discount: Number(i.discount || 0), total: Number(i.total),
    })));
    setQuoteOpen(true);
  };

  const openQuoteDetail = async (q: Quote) => {
    if (isDesktop && q.status === 'draft') {
      openQuoteForEdit(q);
    } else if (isDesktop) {
      openQuoteForEdit(q);
    } else {
      setQuoteDetail(q);
      const { data } = await supabase.from('quote_items').select('*, articles(internal_ref, oem_ref)').eq('quote_id', q.id);
      setQuoteItemsDetail(data || []);
    }
  };
  const changeQuoteStatus = async (q: Quote, status: string) => {
    if (!can('edit_quotes')) { error('Vous n\'avez pas la permission de modifier les devis'); return; }
    await supabase.from('quotes').update({ status }).eq('id', q.id);
    success('Statut mis à jour'); load();
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
    setEditingInvoiceId(null);
    setInvoiceForm({ customer_id: '', note: '', delivery_date: '', reference: '', warranty: '', representative: '', imei: '' });
    setInvoiceEditorItems([{ article_id: null, name: '', quantity: 1, unit_price: 0, discount: 0, total: 0 }]);
    setInvoicePayList([]);
    setInvoiceIsCredit(false);
  };
  const closeInvoiceEditor = () => {
    setInvoiceEditorOpen(false);
    setEditingInvoiceId(null);
    setInvoiceForm({ customer_id: '', note: '', delivery_date: '', reference: '', warranty: '', representative: '', imei: '' });
    setInvoiceEditorItems([{ article_id: null, name: '', quantity: 1, unit_price: 0, discount: 0, total: 0 }]);
    setInvoicePayList([]);
    setInvoiceIsCredit(false);
  };
  const openInvoiceForEdit = async (inv: Invoice) => {
    const { data: items } = await supabase.from('sale_items').select('*, articles(internal_ref, oem_ref, sale_price)').eq('sale_id', inv.id);
    setEditingInvoiceId(inv.id);
    setInvoiceForm({
      customer_id: inv.customer_id || '',
      note: inv.note || '',
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
    setInvoiceDetail(null);
  };

  const saveInvoice = async () => {
    if (!tenant || !currentSite) { error('Magasin introuvable'); return; }
    if (!can('edit_invoices')) { error('Vous n\'avez pas la permission de créer des factures'); return; }
    const valid = invoiceEditorItems.filter(i => i.name.trim());
    if (valid.length === 0) { error('Ajoutez au moins un article'); return; }

    // Edit existing invoice via RPC (handles stock + balance recalculation)
    if (editingInvoiceId) {
      setSavingInvoice(true);
      try {
        const invRepLabel = repLabelOf(invoiceForm.representative);
        const docHeader = (invoiceForm.delivery_date || invoiceForm.reference || invoiceForm.warranty || invRepLabel || invoiceForm.imei)
          ? { delivery_date: invoiceForm.delivery_date || null, reference: invoiceForm.reference || null, warranty: invoiceForm.warranty || null, representative: invRepLabel, imei: invoiceForm.imei || null }
          : null;
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

        // Update note separately (not in RPC)
        if (invoiceForm.note !== undefined) {
          await supabase.from('sales').update({ note: invoiceForm.note || null }).eq('id', editingInvoiceId);
        }

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
        load();
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
    if (!invoiceIsCredit && totalPaid > clientDueAmount) { error('Le montant paye depasse la part client'); return; }

    if (invoiceIsCredit && !invoiceForm.customer_id) {
      error('Un client est requis pour une facture a crédit');
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
        source: 'billing', note: invoiceForm.note || (ipmCoverage > 0 ? `IPM: ${ipmBeneficiaire.ipm_organismes?.nom}` : ''),
        cash_session_id: sessionId,
        representative_id: invoiceForm.representative || null,
        rep_commission: repSnapshot,
        doc_header: (invoiceForm.delivery_date || invoiceForm.reference || invoiceForm.warranty || newInvRepLabel || invoiceForm.imei)
          ? { delivery_date: invoiceForm.delivery_date || null, reference: invoiceForm.reference || null, warranty: invoiceForm.warranty || null, representative: newInvRepLabel, imei: invoiceForm.imei || null }
          : null,
      }).select('id').single();
      if (e || !sale) { error(e?.message || 'Erreur'); return; }

      await supabase.from('sale_items').insert(valid.map(i => ({
        tenant_id: tenant.id, sale_id: sale.id,
        article_id: i.article_id, name: i.name,
        quantity: i.quantity, unit_price: i.unit_price,
        discount: i.discount, total: i.total,
      })));

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

      // Auto-apply available avoirs for this customer
      if (invoiceForm.customer_id) {
        await supabase.rpc('auto_apply_customer_avoirs', { p_sale_id: sale.id });
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
      closeInvoiceEditor();
      load();
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

    // Auto-apply available avoirs for this customer
    if (convertFrom.customer_id && (data as any)?.sale_id) {
      await supabase.rpc('auto_apply_customer_avoirs', { p_sale_id: (data as any).sale_id });
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
    setTab('invoices'); load();
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
    }
    load();
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

  // ── Register payment ─────────────────────────────────────────
  const openPay = () => {
    if (!invoiceDetail) return;
    const due = Math.max(0, Number(invoiceDetail.total) - Number(invoiceDetail.paid));
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
  const availableCredits = useMemo(() => returns.filter(r => r.refund_method === 'avoir' && r.status === 'approved' && Number(r.credit_used || 0) < Number(r.total) && (!invoiceDetail?.customer_id || r.customer_id === invoiceDetail.customer_id)), [returns, invoiceDetail]);
  const openCreditApply = () => {
    if (!invoiceDetail) return;
    const c = availableCredits[0];
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
        return { item_id: i.id, article_id: i.article_id, name: i.name, max_qty: remaining, quantity: Math.min(remaining, 1), unit_price: i.unit_price, selected: false };
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
      tenant_id: tenant.id, return_id: ret.id, article_id: i.article_id, name: i.name,
      quantity: i.quantity, unit_price: i.unit_price, total: i.quantity * i.unit_price,
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
    success('Retour enregistre — choisissez le mode de remboursement');
    setReturnOpen(false);
    setReturnForm({ sale_id: '', reason: '', refund_method: 'cash', restock: true });
    setReturnLines([]);
    await load();
    openReturnDetail({ ...ret, customers: sale?.customers || null, sales: sale ? { sale_number: sale.sale_number } : null } as SaleReturn);
  };

  const openReturnDetail = async (r: SaleReturn) => {
    setReturnDetail(r);
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
    load();
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
    load();
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
    quotes: quotes.length,
    invoices: invoices.length,
    returns: returns.filter(r => r.refund_method !== 'avoir').length,
    credits: returns.filter(r => r.refund_method === 'avoir').length,
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
      setQuoteOpen(true);
    } else if (tab === 'invoices') {
      if (!can('edit_invoices')) { error('Vous n\'avez pas la permission de créer des factures'); return; }
      openInvoiceEditor();
    } else {
      setReturnOpen(true);
    }
  };
  const primaryLabel = tab === 'quotes' ? 'Nouveau devis' : tab === 'invoices' ? 'Nouvelle facture' : 'Nouveau retour';
  const PIcon = Plus;

  const invoiceDue = invoiceDetail ? Math.max(0, Number(invoiceDetail.total) - Number(invoiceDetail.paid)) : 0;

  return (
    <div className="space-y-3 pb-6">
      {/* ── Header ───────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-5 lg:-mx-8 px-3 sm:px-5 lg:px-8 pb-3 pt-3 sm:pt-4 lg:pt-6 -mt-3 sm:-mt-4 lg:-mt-6 bg-slate-50/95 backdrop-blur-sm space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 rounded-2xl bg-white border border-slate-200 shadow-sm hover:shadow-md focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-500/20 transition-all">
          <div className="flex items-center gap-2 pr-2 border-r border-slate-200 shrink-0">
            <div className="leading-tight">
              <h1 className="text-sm font-bold tracking-tight text-slate-900 leading-none">Facturation</h1>
              <div className="text-[9px] font-semibold tracking-wider uppercase text-slate-400 leading-none mt-0.5 hidden sm:block">Documents commerciaux</div>
              <div className="text-[9px] font-semibold tracking-wider uppercase text-slate-400 leading-none mt-0.5 sm:hidden">Documents</div>
            </div>
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="N°, client, vente…"
            className="flex-1 min-w-0 w-0 bg-transparent text-xs focus:outline-none placeholder:text-slate-400"
          />
          {search && (
            <button onClick={() => setSearch('')} className="shrink-0 p-1 text-slate-400 hover:text-slate-600 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => setFiltersOpen(true)}
            className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-all ${
              (statusFilter || customerFilter || dateFrom || dateTo || minAmount || maxAmount)
                ? 'bg-brand-50 text-brand-700 border border-brand-200'
                : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Filtres</span>
          </button>
          <button
            onClick={primaryAction}
            className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center shadow-glow hover:shadow-premium active:scale-95 transition-all"
            style={{ background: 'linear-gradient(135deg, #0f766e 0%, #064e3b 100%)' }}
            aria-label={primaryLabel}
          >
            <Plus className="w-3.5 h-3.5 text-white" />
          </button>
        </div>
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

      {/* ── Tabs ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {TABS.map(t => {
            const Icon = t.icon;
            const active = tab === t.key;
            const count = counts[t.key];
            return (
              <button
                key={t.key}
                onClick={() => { setTab(t.key); setStatusFilter(''); }}
                className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold transition-all active:scale-95 ${
                  active
                    ? 'bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-glow border border-transparent'
                    : 'bg-white text-slate-600 border border-slate-200 hover:border-brand-300 hover:text-brand-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
                <span className={`num px-1.5 py-0.5 rounded-md text-[10px] font-bold ${active ? 'bg-white/20' : 'bg-slate-100 text-slate-600'}`}>{count}</span>
              </button>
            );
          })}
          <button
            onClick={primaryAction}
            className="shrink-0 ml-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-semibold bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-glow hover:shadow-lg transition-all active:scale-95"
          >
            <PIcon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{primaryLabel}</span>
          </button>
        </div>
      </div>

      {hasFilters && (
        <div className="flex items-center gap-1.5 flex-wrap text-[10px] font-bold uppercase tracking-wider">
          {statusFilter && <span className="px-2 py-1 rounded-full bg-brand-50 text-brand-700 border border-brand-200">{statusOptions.find(o => o.value === statusFilter)?.label}</span>}
          {customerFilter && <span className="px-2 py-1 rounded-full bg-brand-50 text-brand-700 border border-brand-200 inline-flex items-center gap-1"><User className="w-3 h-3" />{customers.find(c => c.id === customerFilter)?.name}</span>}
          {(dateFrom || dateTo) && <span className="px-2 py-1 rounded-full bg-brand-50 text-brand-700 border border-brand-200 inline-flex items-center gap-1"><Calendar className="w-3 h-3" />{dateFrom || '…'} → {dateTo || '…'}</span>}
          {(minAmount || maxAmount) && <span className="px-2 py-1 rounded-full bg-brand-50 text-brand-700 border border-brand-200">{minAmount || '0'} – {maxAmount || '∞'}</span>}
          <button onClick={clearFilters} className="px-2 py-1 rounded-full bg-white text-slate-500 border border-slate-200 hover:bg-slate-100 inline-flex items-center gap-1"><X className="w-3 h-3" />Réinitialiser</button>
        </div>
      )}

      {/* ── Content ──────────────────────────────────────────── */}
      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
      ) : (
        <>
          {tab === 'quotes' && (
            filteredQuotes.length === 0 ? (
              <div className="card-premium"><EmptyState icon={FileText} title="Aucun devis" description="Créez votre premier devis." action={<button onClick={() => setQuoteOpen(true)} className="btn-primary"><Plus className="w-4 h-4" />Nouveau devis</button>} /></div>
            ) : (
              <div className={flashTab === 'quotes' ? 'waarwi-flash waarwi-flash-scroll' : ''}>
                <div className="md:hidden space-y-2 count-up">
                  {filteredQuotes.map(q => {
                    const st = QUOTE_STATUS[q.status] || QUOTE_STATUS.draft;
                    return (
                      <div key={q.id} className="card-premium p-3 flex flex-col gap-2 hover:border-brand-400 transition-all">
                        <button onClick={() => openQuoteDetail(q)} className="text-left flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-mono text-[11px] font-bold text-slate-700">{q.quote_number}</span>
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase border ${st.pill}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{st.label}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5 num">{formatDate(q.created_at)}{q.valid_until ? ` · Valide ${formatDate(q.valid_until)}` : ''}</div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-sm font-bold text-slate-900 num">{formatFCFA(q.total)}</div>
                          </div>
                        </button>
                        <div className="flex items-center justify-between pt-1.5 border-t border-slate-100 gap-2">
                          <div className="min-w-0 flex items-center gap-1.5 text-[11px] text-slate-600 truncate">
                            <User className="w-3 h-3 text-slate-400 shrink-0" />
                            <span className="truncate">{q.customers?.name || 'Client comptoir'}</span>
                          </div>
                          {q.status === 'accepted' && (
                            <button onClick={() => openConvert(q)} className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-brand-600 text-white text-[10px] font-bold hover:bg-brand-700"><ArrowRight className="w-3 h-3" />Facturer</button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="hidden md:block card-premium overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-slate-50/90 backdrop-blur text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                        <tr>
                          <th className="px-4 py-3 text-left">N° Devis</th>
                          <th className="px-4 py-3 text-left">Date</th>
                          <th className="px-4 py-3 text-left">Client</th>
                          <th className="px-4 py-3 text-left hidden lg:table-cell">Validité</th>
                          <th className="px-4 py-3 text-center">Statut</th>
                          <th className="px-4 py-3 text-right">Montant</th>
                          <th className="px-4 py-3 text-right w-32">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredQuotes.map(q => {
                          const st = QUOTE_STATUS[q.status] || QUOTE_STATUS.draft;
                          return (
                            <tr key={q.id} className="hover:bg-brand-50/40 transition-colors cursor-pointer" onClick={() => openQuoteDetail(q)}>
                              <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700">{q.quote_number}</td>
                              <td className="px-4 py-3 text-xs text-slate-500 num whitespace-nowrap">{formatDate(q.created_at)}</td>
                              <td className="px-4 py-3 text-slate-700">{q.customers?.name || <span className="text-slate-400">—</span>}</td>
                              <td className="px-4 py-3 hidden lg:table-cell text-slate-500 text-xs num">{q.valid_until ? formatDate(q.valid_until) : '—'}</td>
                              <td className="px-4 py-3 text-center">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase border ${st.pill}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{st.label}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right font-bold text-slate-900 num whitespace-nowrap">{formatFCFA(q.total)}</td>
                              <td className="px-4 py-3 text-right">
                                <div className="inline-flex gap-1" onClick={e => e.stopPropagation()}>
                                  <button onClick={() => openQuoteDetail(q)} className="p-1.5 rounded-lg hover:bg-white hover:shadow-sm text-slate-500 hover:text-brand-700 transition-all" title="Voir"><Eye className="w-4 h-4" /></button>
                                  {q.status === 'accepted' && <button onClick={() => openConvert(q)} className="p-1.5 rounded-lg hover:bg-brand-50 text-brand-700 transition-all" title="Convertir en facture"><ArrowRight className="w-4 h-4" /></button>}
                                  {q.status === 'draft' && <button onClick={() => changeQuoteStatus(q, 'sent')} className="p-1.5 rounded-lg hover:bg-neutral-50 text-neutral-700 transition-all" title="Marquer envoyé"><CheckCircle className="w-4 h-4" /></button>}
                                  {q.status !== 'converted' && q.status !== 'rejected' && <button onClick={() => setQuoteToCancel(q)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 transition-all" title="Refuser"><X className="w-4 h-4" /></button>}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )
          )}

          {tab === 'invoices' && (
            filteredInvoices.length === 0 ? (
              <div className="card-premium"><EmptyState icon={Receipt} title="Aucune facture" description="Les factures créées apparaîtront ici." action={<button onClick={openInvoiceEditor} className="btn-primary"><Plus className="w-4 h-4" />Nouvelle facture</button>} /></div>
            ) : (
              <>
                <div className="md:hidden space-y-2 count-up">
                  {filteredInvoices.map(inv => {
                    const st = invoiceStatus(inv);
                    const solde = Math.max(0, Number(inv.total) - Number(inv.paid));
                    return (
                      <button key={inv.id} onClick={() => openInvoiceDetail(inv)} className="w-full text-left card-premium p-3 flex flex-col gap-2 hover:border-brand-400 transition-all active:scale-[0.99]">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-mono text-[11px] font-bold text-slate-700">{inv.sale_number}</span>
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase border ${st.pill}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{st.label}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5 num">{formatDateTime(inv.created_at)}</div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-sm font-bold text-slate-900 num">{formatFCFA(inv.total)}</div>
                            {solde > 0 && <div className="text-[10px] font-bold text-amber-700 num mt-0.5">Solde {formatFCFA(solde)}</div>}
                          </div>
                        </div>
                        <div className="flex items-center justify-between pt-1.5 border-t border-slate-100">
                          <div className="min-w-0 flex items-center gap-1.5 text-[11px] text-slate-600 truncate">
                            <User className="w-3 h-3 text-slate-400 shrink-0" />
                            <span className="truncate">{inv.customers?.name || 'Client comptoir'}</span>
                          </div>
                          <div className="text-[10px] text-emerald-700 font-bold num">Payé {formatFCFA(inv.paid)}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="hidden md:block card-premium overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-slate-50/90 backdrop-blur text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                        <tr>
                          <th className="px-4 py-3 text-left">N° Facture</th>
                          <th className="px-4 py-3 text-left">Date</th>
                          <th className="px-4 py-3 text-left">Client</th>
                          <th className="px-4 py-3 text-right">Total</th>
                          <th className="px-4 py-3 text-right hidden lg:table-cell">Payé</th>
                          <th className="px-4 py-3 text-right hidden lg:table-cell">Solde</th>
                          <th className="px-4 py-3 text-center">Statut</th>
                          <th className="px-4 py-3 text-center hidden xl:table-cell">Compta</th>
                          <th className="px-4 py-3 text-right w-16">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredInvoices.map(inv => {
                          const st = invoiceStatus(inv);
                          const solde = Math.max(0, Number(inv.total) - Number(inv.paid));
                          return (
                            <tr key={inv.id} className="hover:bg-brand-50/40 transition-colors cursor-pointer" onClick={() => openInvoiceDetail(inv)}>
                              <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700">{inv.sale_number}</td>
                              <td className="px-4 py-3 text-xs text-slate-500 num whitespace-nowrap">{formatDateTime(inv.created_at)}</td>
                              <td className="px-4 py-3 text-slate-700">{inv.customers?.name || <span className="text-slate-400">Client comptoir</span>}</td>
                              <td className="px-4 py-3 text-right font-bold text-slate-900 num">{formatFCFA(inv.total)}</td>
                              <td className="px-4 py-3 text-right hidden lg:table-cell text-emerald-700 num">{formatFCFA(inv.paid)}</td>
                              <td className="px-4 py-3 text-right hidden lg:table-cell num">{solde > 0 ? <span className="text-amber-700 font-bold">{formatFCFA(solde)}</span> : <span className="text-slate-400">—</span>}</td>
                              <td className="px-4 py-3 text-center">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase border ${st.pill}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{st.label}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-center hidden xl:table-cell">
                                {inv.accounting_status === 'accounted' ? (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-teal-50 text-teal-700 border border-teal-200">OK</span>
                                ) : (
                                  <span className="text-[10px] text-slate-400">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end gap-0.5">
                                  {inv.customers && (
                                    <button onClick={e => { e.stopPropagation(); quickWhatsApp(inv); }} className="p-1.5 rounded-lg hover:bg-emerald-50 text-[#25D366] transition" title="WhatsApp"><MessageCircle className="w-3.5 h-3.5" /></button>
                                  )}
                                  <button onClick={e => { e.stopPropagation(); quickCopy(inv); }} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition" title="Copier"><Link2 className="w-3.5 h-3.5" /></button>
                                  <button onClick={e => { e.stopPropagation(); openInvoiceDetail(inv); }} className="p-1.5 rounded-lg hover:bg-white hover:shadow-sm text-slate-500 hover:text-brand-700 transition-all"><Eye className="w-3.5 h-3.5" /></button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )
          )}

          {(tab === 'returns' || tab === 'credits') && (
            (tab === 'returns' ? filteredReturns : filteredCredits).length === 0 ? (
              <div className="card-premium">
                <EmptyState
                  icon={tab === 'returns' ? RotateCcw : Wallet}
                  title={tab === 'returns' ? 'Aucun retour' : 'Aucun avoir'}
                  description={tab === 'returns' ? 'Les retours clients apparaîtront ici.' : 'Les avoirs clients apparaîtront ici.'}
                  action={<button onClick={() => setReturnOpen(true)} className="btn-primary"><Plus className="w-4 h-4" />{tab === 'returns' ? 'Nouveau retour' : 'Nouvel avoir'}</button>}
                />
              </div>
            ) : (
              <div className={flashTab === 'returns' && tab === 'returns' ? 'waarwi-flash waarwi-flash-scroll' : ''}>
                <div className="md:hidden space-y-2 count-up">
                  {(tab === 'returns' ? filteredReturns : filteredCredits).map(r => {
                    const st = tab === 'credits' ? creditStatus(r) : (RETURN_STATUS[r.status] || RETURN_STATUS.pending);
                    const isCredit = tab === 'credits';
                    const used = Number(r.credit_used || 0);
                    const balance = Number(r.total) - used;
                    return (
                      <button key={r.id} onClick={() => openReturnDetail(r)} className="w-full text-left card-premium p-3 flex flex-col gap-2 hover:border-brand-400 transition-all active:scale-[0.99]">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-mono text-[11px] font-bold text-slate-700">{r.return_number}</span>
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase border ${st.pill}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{st.label}
                              </span>
                              {r.restock && <span className="inline-flex px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">Stock</span>}
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5 num">{formatDateTime(r.created_at)}{r.sales?.sale_number && <> · Vente {r.sales.sale_number}</>}</div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className={`text-sm font-bold num ${isCredit ? 'text-neutral-800' : 'text-red-700'}`}>{isCredit ? '' : '-'}{formatFCFA(r.total)}</div>
                            {isCredit && used > 0 && <div className="text-[10px] text-slate-500 num mt-0.5">Solde {formatFCFA(balance)}</div>}
                          </div>
                        </div>
                        <div className="flex items-center justify-between pt-1.5 border-t border-slate-100">
                          <div className="min-w-0 flex items-center gap-1.5 text-[11px] text-slate-600 truncate">
                            <User className="w-3 h-3 text-slate-400 shrink-0" />
                            <span className="truncate">{r.customers?.name || 'Client comptoir'}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="hidden md:block card-premium overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-slate-50/90 backdrop-blur text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                        <tr>
                          <th className="px-4 py-3 text-left">N°</th>
                          <th className="px-4 py-3 text-left">Date</th>
                          <th className="px-4 py-3 text-left">Client</th>
                          <th className="px-4 py-3 text-left hidden lg:table-cell">Vente liée</th>
                          {tab === 'returns' && <th className="px-4 py-3 text-center hidden lg:table-cell">Stock</th>}
                          {tab === 'credits' && <th className="px-4 py-3 text-right hidden lg:table-cell">Utilisé</th>}
                          <th className="px-4 py-3 text-center">Statut</th>
                          <th className="px-4 py-3 text-right">Montant</th>
                          <th className="px-4 py-3 text-right w-16">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(tab === 'returns' ? filteredReturns : filteredCredits).map(r => {
                          const st = tab === 'credits' ? creditStatus(r) : (RETURN_STATUS[r.status] || RETURN_STATUS.pending);
                          const isCredit = tab === 'credits';
                          const used = Number(r.credit_used || 0);
                          return (
                            <tr key={r.id} className="hover:bg-brand-50/40 transition-colors cursor-pointer" onClick={() => openReturnDetail(r)}>
                              <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700">{r.return_number}</td>
                              <td className="px-4 py-3 text-xs text-slate-500 num whitespace-nowrap">{formatDateTime(r.created_at)}</td>
                              <td className="px-4 py-3 text-slate-700">{r.customers?.name || <span className="text-slate-400">—</span>}</td>
                              <td className="px-4 py-3 hidden lg:table-cell font-mono text-xs text-slate-500">{r.sales?.sale_number || '—'}</td>
                              {tab === 'returns' && <td className="px-4 py-3 hidden lg:table-cell text-center">{r.restock ? <span className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">Oui</span> : <span className="text-slate-400 text-xs">Non</span>}</td>}
                              {tab === 'credits' && <td className="px-4 py-3 hidden lg:table-cell text-right num text-slate-600">{formatFCFA(used)}</td>}
                              <td className="px-4 py-3 text-center">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase border ${st.pill}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{st.label}
                                </span>
                              </td>
                              <td className={`px-4 py-3 text-right font-bold num whitespace-nowrap ${isCredit ? 'text-neutral-800' : 'text-red-700'}`}>{isCredit ? '' : '-'}{formatFCFA(r.total)}</td>
                              <td className="px-4 py-3 text-right">
                                <button onClick={e => { e.stopPropagation(); openReturnDetail(r); }} className="p-1.5 rounded-lg hover:bg-white hover:shadow-sm text-slate-500 hover:text-brand-700 transition-all"><Eye className="w-4 h-4" /></button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )
          )}
        </>
      )}

      {/* ── Filters Modal ────────────────────────────────────── */}
      <Modal open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filtres avancés" size="md"
        footer={<>
          <button onClick={clearFilters} className="btn-icon" title="Réinitialiser"><X className="w-4 h-4" /></button>
          <button onClick={() => setFiltersOpen(false)} className="btn-icon-primary" title="Appliquer"><Check className="w-4 h-4" /></button>
        </>}>
        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2"><Filter className="w-3.5 h-3.5" />Statut</div>
            <div className="grid grid-cols-2 gap-1.5">
              <button onClick={() => setStatusFilter('')} className={`px-3 py-2.5 rounded-xl text-xs font-semibold transition-all active:scale-95 ${statusFilter === '' ? 'bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-glow' : 'bg-white text-slate-700 border border-slate-200 hover:border-brand-300'}`}>Tous</button>
              {statusOptions.map(o => (
                <button key={o.value} onClick={() => setStatusFilter(o.value)} className={`px-3 py-2.5 rounded-xl text-xs font-semibold transition-all active:scale-95 ${statusFilter === o.value ? 'bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-glow' : 'bg-white text-slate-700 border border-slate-200 hover:border-brand-300'}`}>{o.label}</button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2"><User className="w-3.5 h-3.5" />Client</div>
            <select value={customerFilter} onChange={e => setCustomerFilter(e.target.value)} className="input">
              <option value="">— Tous les clients —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2"><Calendar className="w-3.5 h-3.5" />Période</div>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input" />
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input" />
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2"><Coins className="w-3.5 h-3.5" />Montant (FCFA)</div>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" placeholder="Min" value={minAmount} onChange={e => setMinAmount(e.target.value)} className="input" />
              <input type="number" placeholder="Max" value={maxAmount} onChange={e => setMaxAmount(e.target.value)} className="input" />
            </div>
          </div>
        </div>
      </Modal>

      {/* ── Direct invoice full-screen panel ──────────────────────────────── */}
      {invoiceEditorOpen && isDesktop && (
        <InvoiceFullPanel
          articles={articles}
          customers={customers}
          invoiceForm={invoiceForm}
          setInvoiceForm={setInvoiceForm}
          invoiceItems={invoiceEditorItems}
          setInvoiceItems={setInvoiceEditorItems}
          updateInvoiceItem={updateInvoiceItem}
          invoiceSubtotal={invoiceEditorSubtotal}
          paymentMethods={paymentMethods}
          payments={invoicePayList}
          setPayments={setInvoicePayList}
          totalPaid={invoiceIsCredit ? 0 : invoiceEditorPaid}
          saving={savingInvoice}
          saveInvoice={saveInvoice}
          onClose={closeInvoiceEditor}
          autoMode={autoMode}
          isCredit={invoiceIsCredit}
          setIsCredit={setInvoiceIsCredit}
          docSettings={docSettings}
          onVehiclePicker={(idx: number | null) => { setVehiclePickerTargetIdx(idx); setVehiclePickerOpen(true); }}
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
          editingInvoiceId={editingInvoiceId}
          reps={activeReps}
        />
      )}
      {invoiceEditorOpen && !isDesktop && (
        <MobileBillingWizard
          open={true}
          onClose={closeInvoiceEditor}
          title={editingInvoiceId ? 'Modifier la facture' : 'Nouvelle facture'}
          headerFields={[
            { key: 'customer_id', label: 'Client', type: 'select', options: customers.map(c => ({ value: c.id, label: c.name })), placeholder: 'Client comptoir' },
            { key: 'reference', label: 'Référence', type: 'text', placeholder: 'REF-...' },
            { key: 'delivery_date', label: 'Date de livraison', type: 'date' },
            { key: 'warranty', label: 'Garantie', type: 'text', placeholder: 'Ex: 6 mois' },
            ...(docSettings.show_representative ? [{ key: 'representative', label: 'Représentant', type: 'select' as const, options: activeReps.map(r => ({ value: r.id, label: repDisplayName(r) })), placeholder: 'Aucun représentant' }] : []),
            { key: 'note', label: 'Note', type: 'text', placeholder: 'Note optionnelle...' },
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

      {/* ── Quote create/edit full-screen panel (desktop only) ──────────────────────────────── */}
      {quoteOpen && isDesktop && (
        <QuoteFullPanel
          articles={articles}
          customers={customers}
          quoteForm={quoteForm}
          setQuoteForm={setQuoteForm}
          quoteItems={quoteItems}
          setQuoteItems={setQuoteItems}
          updateQuoteItem={updateQuoteItem}
          quoteSubtotal={quoteSubtotal}
          saving={saving}
          saveQuote={saveQuote}
          autoSaveQuote={autoSaveQuote}
          onClose={closeQuotePanel}
          autoMode={autoMode}
          onVehiclePicker={(idx: number | null) => { setVehiclePickerTargetIdx(idx); setVehiclePickerOpen(true); }}
          editingQuoteId={editingQuoteId}
          editingQuote={editingQuote}
          onChangeStatus={(status: string) => { if (editingQuote) { changeQuoteStatus(editingQuote, status); setEditingQuote({ ...editingQuote, status }); } }}
          onConvert={() => { if (editingQuote) openConvert(editingQuote); }}
          docSettings={quoteDocSettings}
          isPharmacy={isPharmacy}
          ipmBeneficiaire={quoteIpmBeneficiaire}
          ipmTaux={quoteIpmTaux}
          ipmPartIpm={quoteIpmPartIpm}
          ipmPartClient={quoteIpmPartClient}
          onPrint={() => {
            if (!editingQuote || !tenant) return;
            const items = quoteItems.filter(i => i.name.trim()).map(i => ({ name: i.name, supplier_ref: null, oem_ref: null, quantity: Number(i.quantity), unit_price: Number(i.unit_price), discount: Number(i.discount || 0) }));
            const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price - (i.discount || 0), 0);
            printDocumentA4({ tenant: tenantForPrint(tenant, currentSite), docLabel: 'DEVIS', docNumber: editingQuote.quote_number || 'Brouillon', docDate: new Date(editingQuote.created_at).toLocaleDateString('fr-FR'), customer: editingQuote.customers ? { name: editingQuote.customers.name } : null, items, subtotal, total: subtotal, payments: [], paid: 0, issuedBy: creatorName((editingQuote as any).user_id), docHeader: quoteForm.reference || quoteForm.delivery_date || quoteForm.warranty || repLabelOf(quoteForm.representative) ? { reference: quoteForm.reference || null, delivery_date: quoteForm.delivery_date || null, warranty: quoteForm.warranty || null, representative: repLabelOf(quoteForm.representative) } : null });
          }}
          onCreateArticle={(name) => { setQuickArticleName(name); setQuickArticleOpen(true); }}
          onCreateCustomer={(name) => { setQuickCustomerName(name); setQuickCustomerOpen(true); }}
          reps={activeReps}
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
            { key: 'reference', label: 'Référence', type: 'text', placeholder: 'REF-...' },
            { key: 'delivery_date', label: 'Date de livraison', type: 'date' },
            { key: 'warranty', label: 'Garantie', type: 'text', placeholder: 'Ex: 6 mois' },
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
      <Modal open={!!convertFrom} onClose={() => !converting && setConvertFrom(null)} title="Convertir en facture" size="sm"
        footer={<>
          <button onClick={() => setConvertFrom(null)} className="btn-secondary" disabled={converting}>Annuler</button>
          <button onClick={confirmConvert} disabled={converting || (!!convertIpmBeneficiaire && !!convertIpmConvention && !validerDocumentsIpm(parseConvention(convertIpmConvention)!, convertIpmDocs, convertIpmBeneficiaire?.matricule).valide)} className="btn-primary">{converting && <Loader2 className="w-4 h-4 animate-spin" />}<ArrowRight className="w-4 h-4" />Créer facture</button>
        </>}>
        {convertFrom && (() => {
          const convertIpmCfg = parseConvention(convertIpmConvention);
          const convertIpmCalc = convertIpmBeneficiaire && convertIpmCfg ? calculerIpm(convertIpmCfg, [{ montant_ligne: convertFrom.total, ipm_eligible: true }], 0) : null;
          const convertDocValid = convertIpmCfg ? validerDocumentsIpm(convertIpmCfg, convertIpmDocs, convertIpmBeneficiaire?.matricule) : { valide: true, champs_manquants: [] };
          return (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-brand-50 border border-brand-200">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-brand-700/70">Devis source</div>
                  <div className="font-mono text-sm font-bold text-brand-900 mt-0.5">{convertFrom.quote_number}</div>
                  <div className="text-[11px] text-slate-600 mt-0.5">{convertFrom.customers?.name || 'Client comptoir'}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-brand-700/70">Total</div>
                  <div className="text-lg font-bold text-brand-900 num">{formatFCFA(convertFrom.total)}</div>
                </div>
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
                <div className="text-sm font-semibold text-slate-800">Encaisser immediatement</div>
                <div className="text-[11px] text-slate-500">
                  {convertIpmCalc ? `Part client a encaisser : ${formatFCFA(convertIpmCalc.part_client)}` : 'Sinon, la facture reste a payer plus tard'}
                </div>
              </div>
            </label>

            {convertPayNow && (
              <div className="space-y-2">
                <div>
                  <label className="label">Mode de reglement</label>
                  <select value={convertPayMethod} onChange={e => setConvertPayMethod(e.target.value)} className="input">
                    {paymentMethods.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Montant encaisse{convertIpmCalc ? ` (Part client: ${formatFCFA(convertIpmCalc.part_client)})` : ''}</label>
                  <input type="number" value={convertPayAmount} onChange={e => setConvertPayAmount(e.target.value)} className="input num text-lg font-bold" />
                </div>
              </div>
            )}

            <div className="text-[11px] text-slate-500 p-3 rounded-xl bg-slate-50 border border-slate-200/70">
              Le devis sera marqué comme <strong>converti</strong> et une nouvelle facture sera créée avec les mêmes articles.
              {convertIpmCalc && <span className="block mt-1 text-teal-700 font-medium">La prise en charge IPM ({formatFCFA(convertIpmCalc.part_ipm)}) sera enregistree automatiquement.</span>}
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
      <DocPanel open={!!invoiceDetail} onClose={() => setInvoiceDetail(null)} title={invoiceDetail ? `Facture ${invoiceDetail.sale_number}` : ''}
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
                date={formatDateTime(invoiceDetail.created_at)}
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
      <Modal open={payOpen} onClose={() => !paying && setPayOpen(false)} title="Encaisser la facture" size="sm"
        footer={<>
          <button onClick={() => setPayOpen(false)} className="btn-secondary" disabled={paying}>Annuler</button>
          <button onClick={registerPayment} disabled={paying} className="btn-primary">{paying && <Loader2 className="w-4 h-4 animate-spin" />}<Coins className="w-4 h-4" />Enregistrer</button>
        </>}>
        {invoiceDetail && (
          <div className="space-y-3">
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700/70">Solde dû</div>
                <div className="font-mono text-xs font-bold text-amber-900 mt-0.5">{invoiceDetail.sale_number}</div>
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
          <button onClick={() => setCreditOpen(false)} className="btn-secondary" disabled={applyingCredit}>Annuler</button>
          <button onClick={applyCredit} disabled={applyingCredit} className="btn-primary">{applyingCredit && <Loader2 className="w-4 h-4 animate-spin" />}<Wallet className="w-4 h-4" />Appliquer</button>
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
      <Modal open={returnOpen} onClose={() => setReturnOpen(false)} title="Nouveau retour client" size="lg" fullMobile
        footer={<>
          <button onClick={() => setReturnOpen(false)} className="btn-secondary">Annuler</button>
          <button onClick={() => saveReturn()} disabled={saving || returnLines.filter(i => i.selected && i.quantity > 0).length === 0} className="btn-primary">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            <RotateCcw className="w-4 h-4" />
            Enregistrer le retour
          </button>
        </>}>
        <div className="space-y-2 sm:space-y-4">
          <div>
            <label className="text-[9px] sm:text-xs font-bold uppercase tracking-wider text-slate-500 mb-0.5 block">Vente d'origine *</label>
            <select value={returnForm.sale_id} onChange={e => handleSaleChange(e.target.value)} className="input text-xs sm:text-sm h-[34px] sm:h-auto">
              <option value="">-- Sélectionnez une vente --</option>
              {sales.map(s => <option key={s.id} value={s.id}>{s.sale_number}{s.customers ? ` - ${s.customers.name}` : ''} ({formatFCFA(s.total || 0)})</option>)}
            </select>
          </div>

          {returnLines.length === 0 && returnForm.sale_id && (
            <div className="py-4 text-center text-xs text-slate-500">Tous les articles de cette vente ont déjà été retournés.</div>
          )}

          {returnLines.length > 0 && (
            <div>
              <label className="text-[9px] sm:text-xs font-bold uppercase tracking-wider text-slate-500 mb-1 block">Articles a retourner</label>
              <div className="space-y-1 sm:space-y-2 overflow-y-auto -mx-0.5 px-0.5" style={{ maxHeight: 'calc(100vh - 350px)' }}>
                {returnLines.map((it, idx) => {
                  const toggle = (v: boolean) => setReturnLines(p => p.map((x, i) => i === idx ? { ...x, selected: v } : x));
                  const setQty = (q: number) => setReturnLines(p => p.map((x, i) => i === idx ? { ...x, quantity: Math.min(it.max_qty, Math.max(1, q)) } : x));
                  return (
                    <div key={idx} className={`rounded-xl border p-2 sm:p-3 transition-all ${it.selected ? 'border-brand-300 bg-brand-50/30' : 'border-slate-200 bg-white'}`}>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => toggle(!it.selected)} className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${it.selected ? 'bg-brand-600 border-brand-600' : 'bg-white border-slate-300'}`}>
                          {it.selected && <CheckCircle className="w-3 h-3 text-white" />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-semibold text-slate-900 leading-tight truncate">{it.name}</div>
                          <div className="text-[9px] text-slate-500 num">{formatFCFA(it.unit_price)} x max {it.max_qty}</div>
                        </div>
                        {it.selected && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button type="button" onClick={() => setQty(it.quantity - 1)} className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center"><Minus className="w-3 h-3" /></button>
                            <input type="number" value={it.quantity} onChange={e => setQty(Number(e.target.value))} min="1" max={it.max_qty} className="w-8 text-center text-[11px] font-bold num bg-transparent outline-none" />
                            <button type="button" onClick={() => setQty(it.quantity + 1)} className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center"><Plus className="w-3 h-3" /></button>
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
                <div className="mt-2 rounded-xl bg-gradient-to-br from-slate-900 to-slate-800 text-white p-3 flex items-center justify-between">
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-wider text-white/50">Total retour</div>
                    <div className="text-[10px] text-white/70">{returnLines.filter(i => i.selected).length} article{returnLines.filter(i => i.selected).length > 1 ? 's' : ''}</div>
                  </div>
                  <div className="num text-lg font-bold">{formatFCFA(returnTotal)}</div>
                </div>
              )}
            </div>
          )}

          <div>
            <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-0.5 block">Motif</label>
            <input value={returnForm.reason} onChange={e => setReturnForm(f => ({ ...f, reason: e.target.value }))} className="input text-xs h-[34px]" placeholder="Motif du retour..." />
          </div>

          <label className="flex items-center gap-2 cursor-pointer px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-200/70">
            <input type="checkbox" checked={returnForm.restock} onChange={e => setReturnForm(f => ({ ...f, restock: e.target.checked }))} className="w-3.5 h-3.5 rounded" />
            <span className="text-[11px] font-medium text-slate-700">Remettre en stock automatiquement</span>
          </label>
        </div>
      </Modal>

      {/* ── Return detail ─────────────────────────────────────── */}
      <DocPanel open={!!returnDetail} onClose={() => setReturnDetail(null)} title={returnDetail ? `${returnDetail.refund_method === 'avoir' ? 'Avoir' : 'Retour'} ${returnDetail.return_number}` : ''}
        footer={<>
          <button onClick={() => setReturnDetail(null)} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>
          <button onClick={printReturn} className="btn-icon-primary" title="Imprimer"><Printer className="w-4 h-4" /></button>
        </>}>
        {returnDetail && (() => {
          const isCredit = returnDetail.refund_method === 'avoir';
          const st = isCredit ? creditStatus(returnDetail) : (RETURN_STATUS[returnDetail.status] || RETURN_STATUS.pending);
          const used = Number(returnDetail.credit_used || 0);
          const balance = Number(returnDetail.total) - used;
          const slimStatusColor = returnDetail.status === 'approved' ? (isCredit ? 'blue' : 'emerald') : returnDetail.status === 'rejected' ? 'rose' : 'amber';
          return (
            <div className="space-y-4">
              <DocSlimHeader
                status={{ label: st.label, color: slimStatusColor as any }}
                customerName={returnDetail.customers?.name ?? null}
                date={formatDateTime(returnDetail.created_at)}
                extra={returnDetail.sales?.sale_number ? `Vente ${returnDetail.sales.sale_number}` : undefined}
              />

              {/* Workflow: pending return → choose action */}
              {returnDetail.status === 'pending' && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                      <RotateCcw className="w-3.5 h-3.5 text-amber-700" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-amber-900">Traitement du retour</div>
                      <div className="text-[10px] text-amber-700">Choisissez comment rembourser le client</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setReturnCashConfirmOpen(true)}
                      disabled={returnWorkflowBusy}
                      className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl bg-white border-2 border-slate-200 hover:border-emerald-400 hover:bg-emerald-50 transition-all active:scale-[0.97] disabled:opacity-50"
                    >
                      <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center">
                        <Coins className="w-4.5 h-4.5 text-emerald-700" />
                      </div>
                      <div className="text-[11px] font-bold text-slate-800">Rembourser en caisse</div>
                      <div className="text-[9px] text-slate-500 text-center">Sortie caisse immédiate</div>
                    </button>
                    <button
                      onClick={() => approveAsAvoir(returnDetail)}
                      disabled={returnWorkflowBusy}
                      className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl bg-white border-2 border-slate-200 hover:border-neutral-400 hover:bg-neutral-50 transition-all active:scale-[0.97] disabled:opacity-50"
                    >
                      <div className="w-9 h-9 rounded-full bg-neutral-100 flex items-center justify-center">
                        <Wallet className="w-4.5 h-4.5 text-neutral-800" />
                      </div>
                      <div className="text-[11px] font-bold text-slate-800">Créer un avoir</div>
                      <div className="text-[9px] text-slate-500 text-center">Imputer sur prochaine facture</div>
                    </button>
                  </div>
                  {returnWorkflowBusy && (
                    <div className="flex items-center justify-center gap-2 py-1">
                      <Loader2 className="w-4 h-4 animate-spin text-amber-600" />
                      <span className="text-xs text-amber-700">Traitement...</span>
                    </div>
                  )}
                </div>
              )}

              {/* Avoir: show credit balance and usage */}
              {isCredit && returnDetail.status === 'approved' && (
                <div className="rounded-xl bg-neutral-50 border border-neutral-200 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Wallet className="w-3.5 h-3.5 text-neutral-700" />
                      <span className="text-[11px] font-bold text-neutral-900">Solde avoir</span>
                    </div>
                    <span className="text-sm font-bold text-neutral-800 num">{formatFCFA(balance)}</span>
                  </div>
                  {used > 0 && (
                    <div className="flex items-center justify-between text-[10px] text-neutral-700 border-t border-neutral-200/70 pt-1.5">
                      <span>Montant initial</span>
                      <span className="num">{formatFCFA(Number(returnDetail.total))}</span>
                    </div>
                  )}
                  {used > 0 && (
                    <div className="flex items-center justify-between text-[10px] text-neutral-700">
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
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                  <div>
                    <div className="text-[11px] font-bold text-emerald-900">Remboursé en caisse</div>
                    <div className="text-[10px] text-emerald-700 num">{formatFCFA(Number(returnDetail.total))}</div>
                  </div>
                </div>
              )}

              {returnDetail.reason && <div className="p-3 bg-slate-50 rounded-xl text-sm border border-slate-200/70"><span className="font-semibold">Motif :</span> {returnDetail.reason}</div>}
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Articles retournés</div>
                <div className="space-y-1.5">
                  {returnItemsDetail.map(i => (
                    <div key={i.id} className="p-3 rounded-xl bg-white border border-slate-200/70 shadow-sm flex items-start gap-3">
                      <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center shrink-0"><Package className="w-4 h-4 text-slate-500" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-900 line-clamp-2">{i.name}</div>
                        {i.articles?.internal_ref && <div className="text-[10px] text-slate-400 font-mono mt-0.5">{i.articles.internal_ref}</div>}
                        {i.articles?.oem_ref && <div className="text-[10px] text-slate-400 font-mono">OEM: {i.articles.oem_ref}</div>}
                        <div className="text-[11px] text-slate-500 num mt-0.5">Qté {i.quantity} · {formatFCFA(i.unit_price)}</div>
                      </div>
                      <div className={`num font-bold shrink-0 ${isCredit ? 'text-neutral-800' : 'text-red-700'}`}>{formatFCFA(i.total)}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-900 text-white">
                  <span className="text-[11px] font-bold text-white/60 uppercase tracking-wider">Total</span>
                  <span className="text-base font-bold num">{formatFCFA(Number(returnDetail.total))}</span>
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
        />
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
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   QuoteFullPanel — Sage 100 Cloud-inspired full-screen document editor
   ═══════════════════════════════════════════════════════════════════════════════ */

function ArticleSearchInput({ articles, value, onSelect, onNameChange, placeholder, onCreateNew }: {
  articles: any[];
  value: string;
  onSelect: (a: any) => void;
  onNameChange: (name: string) => void;
  placeholder?: string;
  onCreateNew?: (name: string) => void;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setQuery(value); }, [value]);

  const filtered = useMemo(() => {
    if (!query.trim()) return articles.slice(0, 20);
    const q = query.toLowerCase().trim();
    return articles.filter(a =>
      a.name.toLowerCase().includes(q) ||
      (a.internal_ref || '').toLowerCase().includes(q)
    ).slice(0, 30);
  }, [query, articles]);

  useEffect(() => { setHighlighted(0); }, [filtered.length]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) { if (e.key === 'ArrowDown') setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && filtered[highlighted]) { e.preventDefault(); onSelect(filtered[highlighted]); setOpen(false); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); onNameChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || "Rechercher un article..."}
          className="input text-xs pl-8 pr-2"
          autoComplete="off"
        />
      </div>
      {open && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto">
          {filtered.map((a, i) => (
            <button
              key={a.id}
              onMouseDown={e => { e.preventDefault(); onSelect(a); setOpen(false); }}
              onMouseEnter={() => setHighlighted(i)}
              className={`w-full text-left px-3 py-2 flex items-center gap-2 text-xs transition-colors ${i === highlighted ? 'bg-teal-50 text-teal-800' : 'hover:bg-slate-50 text-slate-700'}`}
            >
              <Package className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{a.name}</p>
                {a.internal_ref && <p className="text-[10px] text-slate-400">{a.internal_ref}</p>}
              </div>
              <span className="text-[11px] font-bold text-slate-500 num flex-shrink-0">{formatFCFA(a.sale_price)}</span>
            </button>
          ))}
          {onCreateNew && (
            <QuickCreateButton label="Créer un article" onClick={() => { onCreateNew(query); setOpen(false); }} />
          )}
        </div>
      )}
    </div>
  );
}

function CustomerSearchInput({ customers, value, onSelect, placeholder, onCreateNew }: {
  customers: any[];
  value: string;
  onSelect: (c: any) => void;
  placeholder?: string;
  onCreateNew?: (name: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const selectedCustomer = customers.find(c => c.id === value);

  const filtered = useMemo(() => {
    if (!query.trim()) return customers.slice(0, 20);
    const q = query.toLowerCase().trim();
    return customers.filter((c: any) =>
      c.name.toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q)
    ).slice(0, 30);
  }, [query, customers]);

  useEffect(() => { setHighlighted(0); }, [filtered.length]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) { if (e.key === 'ArrowDown') setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && filtered[highlighted]) { e.preventDefault(); e.stopPropagation(); onSelect(filtered[highlighted]); setOpen(false); setQuery(''); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
        <input
          value={open ? query : (selectedCustomer?.name || '')}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { setQuery(''); setOpen(true); }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || "Rechercher client..."}
          className="input text-xs h-8 pl-8 pr-2 max-w-[220px]"
          autoComplete="off"
        />
      </div>
      {open && (
        <div className="absolute z-50 left-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-56 overflow-y-auto min-w-[260px]">
          <button
            onMouseDown={e => { e.preventDefault(); onSelect(null); setOpen(false); setQuery(''); }}
            className={`w-full text-left px-3 py-2 text-xs text-slate-500 hover:bg-slate-50 transition-colors ${!value ? 'bg-teal-50 font-semibold text-teal-700' : ''}`}
          >
            Client comptoir
          </button>
          {filtered.map((c: any, i: number) => (
            <button
              key={c.id}
              onMouseDown={e => { e.preventDefault(); onSelect(c); setOpen(false); setQuery(''); }}
              onMouseEnter={() => setHighlighted(i)}
              className={`w-full text-left px-3 py-2 flex items-center gap-2 text-xs transition-colors ${i === highlighted ? 'bg-teal-50 text-teal-800' : 'hover:bg-slate-50 text-slate-700'}`}
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{c.name}</p>
                {c.phone && <p className="text-[10px] text-slate-400">{c.phone}</p>}
              </div>
            </button>
          ))}
          {filtered.length === 0 && query.trim() && (
            <div className="px-3 py-3 text-center text-xs text-slate-400">Aucun client trouvé</div>
          )}
          {onCreateNew && (
            <QuickCreateButton label="Créer un client" onClick={() => { onCreateNew(query); setOpen(false); setQuery(''); }} />
          )}
        </div>
      )}
    </div>
  );
}

function QuoteFullPanel({ articles, customers, quoteForm, setQuoteForm, quoteItems, setQuoteItems, updateQuoteItem, quoteSubtotal, saving, saveQuote, autoSaveQuote, onClose, autoMode, onVehiclePicker, editingQuoteId, editingQuote, onChangeStatus, onConvert, onPrint, docSettings, isPharmacy, ipmBeneficiaire, ipmTaux, ipmPartIpm, ipmPartClient, onCreateArticle, onCreateCustomer, reps }: {
  articles: any[];
  customers: any[];
  quoteForm: { customer_id: string; valid_until: string; note: string; delivery_date: string; reference: string; warranty: string; representative: string; imei: string };
  setQuoteForm: (fn: any) => void;
  quoteItems: QuoteItem[];
  setQuoteItems: (fn: any) => void;
  updateQuoteItem: (idx: number, field: keyof QuoteItem, val: any) => void;
  quoteSubtotal: number;
  saving: boolean;
  saveQuote: (opts?: { silent?: boolean }) => void;
  autoSaveQuote: () => void;
  onClose: () => void;
  autoMode: boolean;
  onVehiclePicker: (idx: number | null) => void;
  editingQuoteId: string | null;
  editingQuote: Quote | null;
  onChangeStatus: (status: string) => void;
  onConvert: () => void;
  onPrint: () => void;
  docSettings: DocSettings;
  isPharmacy?: boolean;
  ipmBeneficiaire?: any;
  ipmTaux?: number;
  ipmPartIpm?: number;
  ipmPartClient?: number;
  onCreateArticle?: (name: string) => void;
  onCreateCustomer?: (name: string) => void;
  reps?: SalesRepresentative[];
}) {
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const [headerValidated, setHeaderValidated] = useState(!docSettings.require_header_lock);
  const panelRef = useRef<HTMLDivElement>(null);
  const resizing = useRef(false);
  const readOnly = editingQuote ? ['converted', 'rejected'].includes(editingQuote.status) : false;
  const repLabel = (id?: string | null) => { const r = (reps || []).find(x => x.id === id); return r ? repDisplayName(r) : ''; };

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = ''; };
  }, [onClose]);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    const startX = e.clientX;
    const startWidth = panelRef.current?.offsetWidth || window.innerWidth - 256;

    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const diff = startX - ev.clientX;
      const newWidth = Math.max(600, Math.min(window.innerWidth - 64, startWidth + diff));
      setPanelWidth(newWidth);
    };
    const onUp = () => { resizing.current = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const handleRowKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = quoteItems[idx];
      if (item.name.trim() && item.unit_price > 0) {
        if (idx === quoteItems.length - 1) {
          setQuoteItems((p: QuoteItem[]) => [...p, { article_id: null, name: '', quantity: 1, unit_price: 0, discount: 0, total: 0 }]);
          setTimeout(() => {
            const rows = panelRef.current?.querySelectorAll('[data-row-idx]');
            const lastRow = rows?.[rows.length - 1];
            const input = lastRow?.querySelector('input') as HTMLInputElement;
            input?.focus();
          }, 50);
        }
        autoSaveQuote();
      }
    }
  };

  return (
    <div className="fixed inset-0 lg:left-64 z-50 flex animate-fade-in">
      {/* Resize handle */}
      <div
        className="hidden lg:flex items-center justify-center w-2 cursor-col-resize hover:bg-teal-100 transition-colors group flex-shrink-0 relative z-10"
        style={{ marginLeft: panelWidth ? `calc(100% - ${panelWidth}px - 8px)` : '0' }}
        onMouseDown={startResize}
      >
        <GripVertical className="w-3 h-3 text-slate-300 group-hover:text-teal-500 transition-colors" />
      </div>

      {/* Main Panel */}
      <div
        ref={panelRef}
        className="bg-white h-full flex flex-col shadow-2xl flex-1 w-full"
        style={panelWidth ? { width: `${panelWidth}px`, flex: 'none' } : undefined}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50/80 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-teal-600 flex items-center justify-center">
              <FileText className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">{editingQuoteId ? 'Edition devis' : 'Nouveau devis'}</h2>
              <p className="text-[11px] text-slate-500">
                {editingQuoteId ? 'Sauvegarde auto à chaque ligne validée' : 'Entrée valide la ligne et ajoute une suivante'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {saving && <span className="text-[10px] text-teal-600 font-medium animate-pulse">Sauvegarde...</span>}
            {readOnly && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-500 border border-slate-200">
                <Lock className="w-3 h-3" />Verrouillé
              </span>
            )}
            {editingQuote && !readOnly && (
              <>
                {editingQuote.status === 'draft' && <button onClick={() => onChangeStatus('sent')} className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-neutral-200 text-neutral-800 bg-neutral-50 hover:bg-neutral-100 transition-colors" title="Marquer envoyé"><CheckCircle className="w-3.5 h-3.5 inline mr-1" />Envoyé</button>}
                {['draft', 'sent'].includes(editingQuote.status) && <button onClick={() => onChangeStatus('accepted')} className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors" title="Accepter"><CheckCircle className="w-3.5 h-3.5 inline mr-1" />Accepter</button>}
                {editingQuote.status === 'accepted' && <button onClick={onConvert} className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-brand-200 text-brand-700 bg-brand-50 hover:bg-brand-100 transition-colors" title="Convertir en facture"><ArrowRight className="w-3.5 h-3.5 inline mr-1" />Facturer</button>}
              </>
            )}
            {editingQuote && <button onClick={onPrint} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors" title="Imprimer"><Printer className="w-4 h-4" /></button>}
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors">Fermer</button>
            {!readOnly && (
              <button onClick={() => saveQuote()} disabled={saving} className="btn-primary text-xs px-4 py-1.5">
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Enregistrer
              </button>
            )}
          </div>
        </div>

        {/* Header lock / optional fields */}
        {headerValidated ? (
          <div className="px-5 py-2.5 border-b border-slate-100 bg-emerald-50/60 flex-shrink-0">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center flex-wrap gap-x-4 gap-y-1 min-w-0">
                <Lock className="w-3 h-3 text-emerald-600" />
                <span className="text-[11px] font-bold text-emerald-700">En-tête validé</span>
                {quoteForm.customer_id && customers.find(c => c.id === quoteForm.customer_id) && (
                  <span className="text-[11px] text-slate-600">{customers.find(c => c.id === quoteForm.customer_id)?.name}</span>
                )}
                {quoteForm.valid_until && <span className="text-[11px] text-slate-500">Validité : {new Date(quoteForm.valid_until).toLocaleDateString('fr-FR')}</span>}
                {quoteForm.reference && <span className="text-[11px] text-slate-500">Réf : {quoteForm.reference}</span>}
                {quoteForm.delivery_date && <span className="text-[11px] text-slate-500">Livraison : {new Date(quoteForm.delivery_date).toLocaleDateString('fr-FR')}</span>}
                {quoteForm.warranty && <span className="text-[11px] text-slate-500">Garantie : {quoteForm.warranty}</span>}
                {quoteForm.representative && <span className="text-[11px] text-slate-500">Représentant : {repLabel(quoteForm.representative) || quoteForm.representative}</span>}
              </div>
              <button onClick={() => setHeaderValidated(false)} className="shrink-0 text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 px-2.5 py-1 rounded-lg hover:bg-emerald-100 transition-colors">Modifier</button>
            </div>
          </div>
        ) : (
          <div className={`px-5 py-3 border-b flex-shrink-0 ${docSettings.require_header_lock ? 'border-teal-200 bg-teal-50/40' : 'border-slate-100 bg-white'} ${readOnly ? 'pointer-events-none opacity-70' : ''}`}>
            <div className="flex items-center flex-wrap gap-2">
              <CustomerSearchInput
                customers={customers}
                value={quoteForm.customer_id}
                onSelect={(c) => setQuoteForm((f: any) => ({ ...f, customer_id: c?.id || '' }))}
                placeholder="Rechercher client..."
                onCreateNew={onCreateCustomer}
              />
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <input type="date" value={quoteForm.valid_until} onChange={e => setQuoteForm((f: any) => ({ ...f, valid_until: e.target.value }))} className="input text-xs h-8 w-36" disabled={readOnly} />
              </div>
              <div className="flex items-center gap-1.5 flex-1 max-w-[200px]">
                <MessageCircle className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                <input value={quoteForm.note} onChange={e => setQuoteForm((f: any) => ({ ...f, note: e.target.value }))} placeholder="Note..." className="input text-xs h-8" disabled={readOnly} />
              </div>
              {docSettings.show_reference && (
                <div className="flex items-center gap-1.5 min-w-[130px] flex-1 max-w-[180px]">
                  <Tag className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <input value={quoteForm.reference} onChange={e => setQuoteForm((f: any) => ({ ...f, reference: e.target.value }))} placeholder="Référence…" className="input text-xs h-8 flex-1" />
                </div>
              )}
              {docSettings.show_delivery_date && (
                <div className="flex items-center gap-1.5 min-w-[130px]">
                  <CalendarDays className="w-3.5 h-3.5 text-neutral-600 shrink-0" />
                  <input type="date" value={quoteForm.delivery_date} onChange={e => setQuoteForm((f: any) => ({ ...f, delivery_date: e.target.value }))} className="input text-xs h-8" />
                </div>
              )}
              {docSettings.show_warranty && (
                <div className="flex items-center gap-1.5 min-w-[140px] flex-1 max-w-[200px]">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <input value={quoteForm.warranty} onChange={e => setQuoteForm((f: any) => ({ ...f, warranty: e.target.value }))} placeholder="Garantie…" className="input text-xs h-8 flex-1" />
                </div>
              )}
              {docSettings.show_imei && (
                <div className="flex items-center gap-1.5 min-w-[140px] flex-1 max-w-[200px]">
                  <Smartphone className="w-3.5 h-3.5 text-neutral-600 shrink-0" />
                  <input value={quoteForm.imei} onChange={e => setQuoteForm((f: any) => ({ ...f, imei: e.target.value }))} placeholder="IMEI / Téléphone…" className="input text-xs h-8 flex-1" />
                </div>
              )}
              {docSettings.show_representative && (
                <div className="flex items-center gap-1.5 min-w-[220px] flex-1 max-w-[320px]">
                  <User className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <select value={quoteForm.representative} onChange={e => setQuoteForm((f: any) => ({ ...f, representative: e.target.value }))} className="input text-xs h-8 flex-1 min-w-0 truncate pr-7" title={repLabel(quoteForm.representative) || 'Représentant'}>
                    <option value="">Aucun représentant</option>
                    {(reps || []).map(r => <option key={r.id} value={r.id}>{repDisplayName(r)}</option>)}
                  </select>
                </div>
              )}
              {autoMode && !readOnly && (
                <button onClick={() => onVehiclePicker(null)} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 hover:border-teal-300 hover:bg-teal-50/50 transition-all shrink-0">
                  <Car className="w-3 h-3" />Par véhicule
                </button>
              )}
              {docSettings.require_header_lock && !readOnly && (
                <button
                  onClick={() => setHeaderValidated(true)}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-teal-600 text-white hover:bg-teal-700 transition-colors shadow-sm"
                >
                  <Lock className="w-3 h-3" /> Valider l'en-tête
                </button>
              )}
            </div>
          </div>
        )}

        {/* IPM Banner (quotes) */}
        {isPharmacy && quoteForm.customer_id && ipmBeneficiaire && (
          <div className="px-5 py-2 border-b border-slate-100 flex-shrink-0">
            <div className="flex items-center gap-3 p-2.5 rounded-lg bg-teal-50 border border-teal-200">
              <div className="w-7 h-7 rounded-lg bg-teal-100 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4 text-teal-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-teal-800">
                  Client couvert IPM — {ipmBeneficiaire.ipm_organismes?.nom}
                </p>
                <p className="text-[10px] text-teal-600">
                  Taux : {ipmTaux || 0}% — Ce devis inclut une estimation de la prise en charge IPM
                </p>
              </div>
              {quoteSubtotal > 0 && (ipmPartIpm || 0) > 0 && (
                <div className="text-right shrink-0">
                  <p className="text-[10px] text-teal-600">Part IPM : <span className="font-bold">{formatFCFA(ipmPartIpm || 0)}</span></p>
                  <p className="text-[10px] text-teal-800 font-bold">Part client : {formatFCFA(ipmPartClient || 0)}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Table header + rows — colonnes dynamiques */}
        {(() => {
          const cols = (docSettings.columns_config.length ? docSettings.columns_config : DEFAULT_COLUMNS)
            .filter(c => c.visible).sort((a, b) => a.order - b.order);
          const gridTemplate = cols.map(c => c.width).join(' ') + ' 40px';
          const itemsLocked = docSettings.require_header_lock && !headerValidated;
          return (
            <>
              <div className="grid gap-2 px-5 py-2 border-b border-slate-200 bg-slate-50/50 flex-shrink-0" style={{ gridTemplateColumns: gridTemplate }}>
                {cols.map(col => (
                  <span key={col.key} className={`text-[10px] font-bold text-slate-500 uppercase tracking-wide ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}`}>{col.label}</span>
                ))}
                <span />
              </div>

              <div className={`flex-1 overflow-y-auto min-h-0 relative ${itemsLocked ? 'pointer-events-none' : ''} ${readOnly ? 'pointer-events-none opacity-80' : ''}`}>
                {itemsLocked && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-50/90 backdrop-blur-sm">
                    <Lock className="w-8 h-8 text-slate-300 mb-3" />
                    <p className="text-sm font-bold text-slate-500">En-tête non validé</p>
                    <p className="text-xs text-slate-400 mt-1">Validez les informations d'en-tête pour saisir les articles</p>
                  </div>
                )}
                {quoteItems.map((it, idx) => (
                  <div key={idx} data-row-idx={idx}
                    className={`grid gap-2 px-5 py-1.5 items-center border-b border-slate-50 hover:bg-slate-50/50 transition-colors ${idx === quoteItems.length - 1 ? 'bg-teal-50/30' : ''}`}
                    style={{ gridTemplateColumns: gridTemplate }}
                    onKeyDown={e => handleRowKeyDown(e, idx)}
                  >
                    {cols.map(col => {
                      switch (col.key) {
                        case 'article': return (
                          <div key="article">
                            <ArticleSearchInput articles={articles} value={it.article_id ? (articles.find(a => a.id === it.article_id)?.name || '') : ''} onSelect={a => updateQuoteItem(idx, 'article_id', a.id)} onNameChange={() => {}} placeholder="Rechercher..." onCreateNew={onCreateArticle} />
                          </div>
                        );
                        case 'designation': return (
                          <div key="designation">
                            <input value={it.name} onChange={e => updateQuoteItem(idx, 'name', e.target.value)} placeholder="Désignation" className="input text-xs" />
                            {it.tier_name && <div className="text-[9px] font-medium text-brand-600 mt-0.5">{it.tier_name}</div>}
                          </div>
                        );
                        case 'qty': return (
                          <div key="qty"><input type="number" value={it.quantity || ''} onChange={e => updateQuoteItem(idx, 'quantity', Number(e.target.value))} onBlur={() => finalizeQuoteItem(idx, 'quantity')} className="input text-xs text-center" /></div>
                        );
                        case 'unit_price': return (
                          <div key="unit_price"><input type="number" value={it.unit_price || ''} onChange={e => updateQuoteItem(idx, 'unit_price', Number(e.target.value))} onBlur={() => finalizeQuoteItem(idx, 'unit_price')} className="input text-xs text-right num" /></div>
                        );
                        case 'discount': return (
                          <div key="discount"><input type="number" value={it.discount || ''} onChange={e => updateQuoteItem(idx, 'discount', Number(e.target.value))} onBlur={() => finalizeQuoteItem(idx, 'discount')} className="input text-xs text-right num" /></div>
                        );
                        case 'total': return (
                          <div key="total" className="text-right"><span className="text-xs font-bold text-slate-800 num">{formatFCFA(it.total)}</span></div>
                        );
                        default: return null;
                      }
                    })}
                    <div className="flex justify-center">
                      <button onClick={() => setQuoteItems((p: QuoteItem[]) => p.filter((_, i) => i !== idx))} disabled={quoteItems.length === 1} className="p-1 rounded hover:bg-red-50 text-red-400 disabled:opacity-30 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                <div className="px-5 py-2">
                  <button onClick={() => setQuoteItems((p: QuoteItem[]) => [...p, { article_id: null, name: '', quantity: 1, unit_price: 0, discount: 0, total: 0 }])}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-600 hover:text-teal-800 hover:bg-teal-50 px-3 py-2 rounded-lg transition-colors">
                    <Plus className="w-3.5 h-3.5" />Ajouter une ligne
                  </button>
                </div>
              </div>
            </>
          );
        })()}

        {/* Footer totals */}
        <div className="border-t border-slate-200 bg-slate-50/80 px-5 py-3 flex items-center justify-between flex-shrink-0">
          <div className="text-xs text-slate-500">
            {quoteItems.filter(i => i.name.trim()).length} ligne{quoteItems.filter(i => i.name.trim()).length > 1 ? 's' : ''}
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wide block">Total HT</span>
              <span className="text-lg font-black text-slate-900 num">{formatFCFA(quoteSubtotal)}</span>
            </div>
            {ipmBeneficiaire && (ipmPartIpm || 0) > 0 && (
              <>
                <div className="text-right">
                  <span className="text-[10px] text-teal-500 uppercase font-bold tracking-wide block">Part IPM</span>
                  <span className="text-sm font-bold text-teal-700 num">{formatFCFA(ipmPartIpm || 0)}</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wide block">Part client</span>
                  <span className="text-sm font-bold text-slate-800 num">{formatFCFA(ipmPartClient || 0)}</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Invoice Full Panel ─────────────────────────────────────────
function InvoiceFullPanel({ articles, customers, invoiceForm, setInvoiceForm, invoiceItems, setInvoiceItems, updateInvoiceItem, invoiceSubtotal, paymentMethods, payments, setPayments, totalPaid, saving, saveInvoice, onClose, autoMode, onVehiclePicker, isCredit, setIsCredit, docSettings, isPharmacy, ipmLoading, ipmBeneficiaire, ipmTaux, ipmConvention, ipmPartIpm, ipmPartClient, ipmConfig, ipmDocuments, setIpmDocuments, ipmDocValidation, onCreateArticle, onCreateCustomer, editingInvoiceId, reps }: {
  articles: any[];
  customers: any[];
  invoiceForm: { customer_id: string; note: string; delivery_date: string; reference: string; warranty: string; representative: string; imei: string };
  setInvoiceForm: (fn: any) => void;
  invoiceItems: QuoteItem[];
  setInvoiceItems: (fn: any) => void;
  updateInvoiceItem: (idx: number, field: keyof QuoteItem, val: any) => void;
  invoiceSubtotal: number;
  paymentMethods: any[];
  payments: { method_id: string; method_name: string; amount: number; reference: string }[];
  setPayments: (fn: any) => void;
  totalPaid: number;
  saving: boolean;
  saveInvoice: () => void;
  onClose: () => void;
  autoMode: boolean;
  onVehiclePicker: (idx: number | null) => void;
  isCredit: boolean;
  setIsCredit: (v: boolean) => void;
  docSettings: DocSettings;
  isPharmacy: boolean;
  ipmLoading: boolean;
  ipmBeneficiaire: any;
  ipmTaux: number;
  ipmConvention: any;
  ipmPartIpm: number;
  ipmPartClient: number;
  ipmConfig: any;
  ipmDocuments: IpmDocsType;
  setIpmDocuments: (fn: any) => void;
  ipmDocValidation: { valide: boolean; champs_manquants: string[] };
  onCreateArticle?: (name: string) => void;
  onCreateCustomer?: (name: string) => void;
  editingInvoiceId?: string | null;
  reps?: SalesRepresentative[];
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const resizing = useRef(false);
  const [payMethodId, setPayMethodId] = useState(paymentMethods[0]?.id || '');
  const [payAmt, setPayAmt] = useState('');
  const [headerValidated, setHeaderValidated] = useState(!docSettings.require_header_lock);
  const repLabel = (id?: string | null) => { const r = (reps || []).find(x => x.id === id); return r ? repDisplayName(r) : ''; };

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = ''; };
  }, [onClose]);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    const startX = e.clientX;
    const startWidth = panelRef.current?.offsetWidth || window.innerWidth - 256;
    const onMove = (ev: MouseEvent) => { if (!resizing.current) return; setPanelWidth(Math.max(600, Math.min(window.innerWidth - 64, startWidth + (startX - ev.clientX)))); };
    const onUp = () => { resizing.current = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const handleRowKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = invoiceItems[idx];
      if (item.name.trim() && item.unit_price > 0 && idx === invoiceItems.length - 1) {
        setInvoiceItems((p: QuoteItem[]) => [...p, { article_id: null, name: '', quantity: 1, unit_price: 0, discount: 0, total: 0 }]);
        setTimeout(() => {
          const rows = panelRef.current?.querySelectorAll('[data-row-idx]');
          const lastRow = rows?.[rows.length - 1];
          (lastRow?.querySelector('input') as HTMLInputElement)?.focus();
        }, 50);
      }
    }
  };

  const addPayment = () => {
    const amt = Number(payAmt);
    if (!amt || amt <= 0) return;
    const pm = paymentMethods.find((m: any) => m.id === payMethodId);
    if (!pm) return;
    setPayments((prev: any[]) => [...prev, { method_id: pm.id, method_name: pm.name, amount: amt, reference: '' }]);
    setPayAmt('');
  };

  const clientDue = ipmBeneficiaire && ipmPartIpm > 0 ? ipmPartClient : invoiceSubtotal;
  const balance = clientDue - totalPaid;

  return (
    <div className="fixed inset-0 lg:left-64 z-50 flex animate-fade-in">
      <div
        className="hidden lg:flex items-center justify-center w-2 cursor-col-resize hover:bg-neutral-100 transition-colors group flex-shrink-0 relative z-10"
        style={{ marginLeft: panelWidth ? `calc(100% - ${panelWidth}px - 8px)` : '0' }}
        onMouseDown={startResize}
      >
        <GripVertical className="w-3 h-3 text-slate-300 group-hover:text-neutral-600 transition-colors" />
      </div>

      <div ref={panelRef} className="bg-white h-full flex flex-col shadow-2xl flex-1 w-full" style={panelWidth ? { width: `${panelWidth}px`, flex: 'none' } : undefined}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50/80 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-neutral-900 flex items-center justify-center">
              <Receipt className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">{editingInvoiceId ? 'Modifier la facture' : 'Nouvelle facture'}</h2>
              <p className="text-[11px] text-slate-500">Entrée valide la ligne et ajoute une suivante</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {saving && <span className="text-[10px] text-neutral-700 font-medium animate-pulse">Sauvegarde...</span>}
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors">Fermer</button>
            <button onClick={saveInvoice} disabled={saving || (ipmBeneficiaire && !ipmDocValidation.valide)} className="btn-primary text-xs px-4 py-1.5">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {editingInvoiceId ? 'Mettre à jour' : 'Enregistrer'}
            </button>
          </div>
        </div>

        {/* Meta bar — client, note, champs optionnels, verrou */}
        {headerValidated ? (
          /* ── En-tête verrouillé ── */
          <div className="px-5 py-2.5 border-b border-slate-100 bg-emerald-50/60 flex-shrink-0">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center flex-wrap gap-x-4 gap-y-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <Lock className="w-3 h-3 text-emerald-600 shrink-0" />
                  <span className="text-[11px] font-bold text-emerald-700">En-tête validé</span>
                </div>
                {invoiceForm.customer_id && <span className="text-[11px] text-slate-600 font-medium truncate max-w-[140px]"><User className="w-3 h-3 inline mr-0.5 text-slate-400" />{customers.find(c => c.id === invoiceForm.customer_id)?.name || ''}</span>}
                {invoiceForm.reference && <span className="text-[11px] text-slate-500"><span className="text-slate-400">Réf:</span> {invoiceForm.reference}</span>}
                {invoiceForm.delivery_date && <span className="text-[11px] text-slate-500"><span className="text-slate-400">Livraison:</span> {invoiceForm.delivery_date}</span>}
                {invoiceForm.warranty && <span className="text-[11px] text-slate-500 truncate max-w-[120px]"><span className="text-slate-400">Garantie:</span> {invoiceForm.warranty}</span>}
                {invoiceForm.imei && <span className="text-[11px] text-slate-500 truncate max-w-[140px]"><span className="text-slate-400">IMEI:</span> {invoiceForm.imei}</span>}
                {invoiceForm.representative && <span className="text-[11px] text-slate-500"><span className="text-slate-400">Rep.:</span> {repLabel(invoiceForm.representative) || invoiceForm.representative}</span>}
                {invoiceForm.note && <span className="text-[11px] text-slate-400 italic truncate max-w-[160px]">"{invoiceForm.note}"</span>}
              </div>
              <button
                onClick={() => setHeaderValidated(false)}
                className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold text-slate-500 hover:bg-slate-100 border border-slate-200 transition-colors"
              >
                <Lock className="w-3 h-3" /> Modifier
              </button>
            </div>
          </div>
        ) : (
          /* ── Formulaire d'en-tête ── */
          <div className={`px-5 py-3 border-b flex-shrink-0 ${docSettings.require_header_lock ? 'border-neutral-200 bg-neutral-50/40' : 'border-slate-100 bg-white'}`}>
            {docSettings.require_header_lock && (
              <div className="flex items-center gap-1.5 mb-2">
                <Lock className="w-3 h-3 text-neutral-600" />
                <span className="text-[10px] font-bold text-neutral-700 uppercase tracking-wide">Informations de l'en-tête — à valider avant la saisie</span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <CustomerSearchInput
                customers={customers}
                value={invoiceForm.customer_id}
                onSelect={(c) => setInvoiceForm((f: any) => ({ ...f, customer_id: c?.id || '' }))}
                placeholder="Rechercher client..."
                onCreateNew={onCreateCustomer}
              />
              <div className="flex items-center gap-1.5 min-w-[160px] flex-1 max-w-[220px]">
                <MessageCircle className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <input value={invoiceForm.note} onChange={e => setInvoiceForm((f: any) => ({ ...f, note: e.target.value }))} placeholder="Note…" className="input text-xs h-8 flex-1" />
              </div>
              {docSettings.show_reference && (
                <div className="flex items-center gap-1.5 min-w-[130px] flex-1 max-w-[180px]">
                  <Tag className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <input value={invoiceForm.reference} onChange={e => setInvoiceForm((f: any) => ({ ...f, reference: e.target.value }))} placeholder="Référence…" className="input text-xs h-8 flex-1" />
                </div>
              )}
              {docSettings.show_delivery_date && (
                <div className="flex items-center gap-1.5 min-w-[130px]">
                  <Calendar className="w-3.5 h-3.5 text-neutral-600 shrink-0" />
                  <input type="date" value={invoiceForm.delivery_date} onChange={e => setInvoiceForm((f: any) => ({ ...f, delivery_date: e.target.value }))} className="input text-xs h-8" />
                </div>
              )}
              {docSettings.show_warranty && (
                <div className="flex items-center gap-1.5 min-w-[140px] flex-1 max-w-[200px]">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <input value={invoiceForm.warranty} onChange={e => setInvoiceForm((f: any) => ({ ...f, warranty: e.target.value }))} placeholder="Garantie…" className="input text-xs h-8 flex-1" />
                </div>
              )}
              {docSettings.show_imei && (
                <div className="flex items-center gap-1.5 min-w-[140px] flex-1 max-w-[200px]">
                  <Smartphone className="w-3.5 h-3.5 text-neutral-600 shrink-0" />
                  <input value={invoiceForm.imei} onChange={e => setInvoiceForm((f: any) => ({ ...f, imei: e.target.value }))} placeholder="IMEI / Téléphone…" className="input text-xs h-8 flex-1" />
                </div>
              )}
              {docSettings.show_representative && (
                <div className="flex items-center gap-1.5 min-w-[220px] flex-1 max-w-[320px]">
                  <User className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <select value={invoiceForm.representative} onChange={e => setInvoiceForm((f: any) => ({ ...f, representative: e.target.value }))} className="input text-xs h-8 flex-1 min-w-0 truncate pr-7" title={repLabel(invoiceForm.representative) || 'Représentant'}>
                    <option value="">Aucun représentant</option>
                    {(reps || []).map(r => <option key={r.id} value={r.id}>{repDisplayName(r)}</option>)}
                  </select>
                </div>
              )}
              {autoMode && (
                <button onClick={() => onVehiclePicker(null)} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 hover:border-neutral-300 hover:bg-neutral-50/50 transition-all shrink-0">
                  <Car className="w-3 h-3" />Par véhicule
                </button>
              )}
              {docSettings.require_header_lock && (
                <button
                  onClick={() => setHeaderValidated(true)}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-neutral-900 text-white hover:bg-neutral-800 transition-colors shadow-sm"
                >
                  <Lock className="w-3 h-3" /> Valider l'en-tête
                </button>
              )}
            </div>
          </div>
        )}

        {/* IPM Banner */}
        {isPharmacy && invoiceForm.customer_id && (
          <div className="px-5 py-2 border-b border-slate-100 flex-shrink-0">
            {ipmLoading ? (
              <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Verification couverture IPM...</div>
            ) : ipmBeneficiaire ? (
              <div className="space-y-2">
                <div className="flex items-center gap-3 p-2.5 rounded-lg bg-teal-50 border border-teal-200">
                  <div className="w-7 h-7 rounded-lg bg-teal-100 flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-4 h-4 text-teal-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-teal-800">
                      Client couvert IPM — {ipmBeneficiaire.ipm_organismes?.nom}
                      {ipmBeneficiaire.matricule && <span className="text-teal-600 font-normal ml-2">Mat. {ipmBeneficiaire.matricule}</span>}
                    </p>
                    <p className="text-[10px] text-teal-600">
                      Taux : {ipmTaux}%
                      {ipmConvention?.plafond_facture && ` · Plafond/fact : ${formatFCFA(ipmConvention.plafond_facture)}`}
                      {ipmConvention?.nom && ` · Conv. ${ipmConvention.nom}`}
                    </p>
                  </div>
                  {invoiceSubtotal > 0 && (
                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-teal-600">Part IPM : <span className="font-bold">{formatFCFA(ipmPartIpm)}</span></p>
                      <p className="text-[10px] text-teal-800 font-bold">Part client : {formatFCFA(ipmPartClient)}</p>
                    </div>
                  )}
                </div>
                {ipmConfig && (ipmConfig.ordonnance_obligatoire || ipmConfig.numero_ordonnance_obligatoire || ipmConfig.medecin_prescripteur_obligatoire || ipmConfig.bon_prise_en_charge_obligatoire || ipmConfig.numero_bon_obligatoire) && (
                  <div className="flex items-center gap-2 flex-wrap p-2 rounded-lg bg-teal-50/50 border border-teal-100">
                    {(ipmConfig.ordonnance_obligatoire || ipmConfig.numero_ordonnance_obligatoire) && (
                      <input className="text-[11px] px-2 py-1 rounded border border-teal-300 bg-white w-40" placeholder="N° ordonnance *" value={ipmDocuments.numero_ordonnance} onChange={e => setIpmDocuments((d: any) => ({ ...d, numero_ordonnance: e.target.value }))} />
                    )}
                    {ipmConfig.medecin_prescripteur_obligatoire && (
                      <input className="text-[11px] px-2 py-1 rounded border border-teal-300 bg-white w-44" placeholder="Médecin prescripteur *" value={ipmDocuments.medecin} onChange={e => setIpmDocuments((d: any) => ({ ...d, medecin: e.target.value }))} />
                    )}
                    {(ipmConfig.bon_prise_en_charge_obligatoire || ipmConfig.numero_bon_obligatoire) && (
                      <input className="text-[11px] px-2 py-1 rounded border border-teal-300 bg-white w-44" placeholder="N° bon prise en charge *" value={ipmDocuments.numero_bon} onChange={e => setIpmDocuments((d: any) => ({ ...d, numero_bon: e.target.value }))} />
                    )}
                    {!ipmDocValidation.valide && (
                      <span className="text-[10px] text-red-600 font-medium">Manquant : {ipmDocValidation.champs_manquants.join(', ')}</span>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[10px] text-slate-400 italic">Ce client n'est pas beneficiaire d'un IPM actif</p>
            )}
          </div>
        )}

        {/* Table header — colonnes dynamiques */}
        {(() => {
          const cols = (docSettings.columns_config.length ? docSettings.columns_config : DEFAULT_COLUMNS)
            .filter(c => c.visible).sort((a, b) => a.order - b.order);
          const gridTemplate = cols.map(c => c.width).join(' ') + ' 40px';
          const itemsLocked = docSettings.require_header_lock && !headerValidated;
          return (
            <>
              <div className="grid gap-2 px-5 py-2 border-b border-slate-200 bg-slate-50/50 flex-shrink-0" style={{ gridTemplateColumns: gridTemplate }}>
                {cols.map(col => (
                  <span key={col.key} className={`text-[10px] font-bold text-slate-500 uppercase tracking-wide ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}`}>{col.label}</span>
                ))}
                <span />
              </div>

              {/* Scrollable rows */}
              <div className={`flex-1 overflow-y-auto min-h-0 relative ${itemsLocked ? 'pointer-events-none' : ''}`}>
                {itemsLocked && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-50/90 backdrop-blur-sm">
                    <Lock className="w-8 h-8 text-slate-300 mb-3" />
                    <p className="text-sm font-bold text-slate-500">En-tête non validé</p>
                    <p className="text-xs text-slate-400 mt-1">Validez les informations d'en-tête pour saisir les articles</p>
                  </div>
                )}
                {invoiceItems.map((it, idx) => (
                  <div key={idx} data-row-idx={idx}
                    className={`grid gap-2 px-5 py-1.5 items-center border-b border-slate-50 hover:bg-slate-50/50 transition-colors ${idx === invoiceItems.length - 1 ? 'bg-neutral-50/30' : ''}`}
                    style={{ gridTemplateColumns: gridTemplate }}
                    onKeyDown={e => handleRowKeyDown(e, idx)}
                  >
                    {cols.map(col => {
                      switch (col.key) {
                        case 'article': return (
                          <div key="article">
                            <ArticleSearchInput
                              articles={articles}
                              value={it.article_id ? (articles.find(a => a.id === it.article_id)?.name || '') : ''}
                              onSelect={a => updateInvoiceItem(idx, 'article_id', a.id)}
                              onNameChange={() => {}}
                              placeholder="Rechercher..."
                              onCreateNew={onCreateArticle}
                            />
                          </div>
                        );
                        case 'designation': return (
                          <div key="designation">
                            <input value={it.name} onChange={e => updateInvoiceItem(idx, 'name', e.target.value)} placeholder="Désignation" className="input text-xs" />
                            {it.tier_name && <div className="text-[9px] font-medium text-brand-600 mt-0.5">{it.tier_name}</div>}
                          </div>
                        );
                        case 'qty': return (
                          <div key="qty"><input type="number" value={it.quantity || ''} onChange={e => updateInvoiceItem(idx, 'quantity', Number(e.target.value))} onBlur={() => finalizeInvoiceItem(idx, 'quantity')} className="input text-xs text-center" /></div>
                        );
                        case 'unit_price': return (
                          <div key="unit_price"><input type="number" value={it.unit_price || ''} onChange={e => updateInvoiceItem(idx, 'unit_price', Number(e.target.value))} onBlur={() => finalizeInvoiceItem(idx, 'unit_price')} className="input text-xs text-right num" /></div>
                        );
                        case 'discount': return (
                          <div key="discount"><input type="number" value={it.discount || ''} onChange={e => updateInvoiceItem(idx, 'discount', Number(e.target.value))} onBlur={() => finalizeInvoiceItem(idx, 'discount')} className="input text-xs text-right num" /></div>
                        );
                        case 'total': return (
                          <div key="total" className="text-right"><span className="text-xs font-bold text-slate-800 num">{formatFCFA(it.total)}</span></div>
                        );
                        default: return null;
                      }
                    })}
                    <div className="flex justify-center">
                      <button onClick={() => setInvoiceItems((p: QuoteItem[]) => p.filter((_, i) => i !== idx))} disabled={invoiceItems.length === 1} className="p-1 rounded hover:bg-red-50 text-red-400 disabled:opacity-30 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ))}
                <div className="px-5 py-2">
                  <button onClick={() => setInvoiceItems((p: QuoteItem[]) => [...p, { article_id: null, name: '', quantity: 1, unit_price: 0, discount: 0, total: 0 }])}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-700 hover:text-neutral-800 hover:bg-neutral-50 px-3 py-2 rounded-lg transition-colors">
                    <Plus className="w-3.5 h-3.5" />Ajouter une ligne
                  </button>
                </div>

                {/* Payment section - hidden when editing existing invoice */}
                {!editingInvoiceId && (
                <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/30">
                  {ipmBeneficiaire && ipmPartIpm > 0 && (
                    <div className="flex items-center gap-2 px-3 py-2.5 mb-3 bg-teal-50 border border-teal-200 rounded-lg text-xs text-teal-800 font-medium">
                      <ShieldCheck className="w-4 h-4 text-teal-600 flex-shrink-0" />
                      <div>
                        <span className="font-bold">Prise en charge IPM : {formatFCFA(ipmPartIpm)}</span>
                        <span className="text-teal-600 ml-2">(créance {ipmBeneficiaire.ipm_organismes?.nom})</span>
                        {ipmPartClient > 0 && <span className="block mt-0.5">Reste à charge client : <span className="font-bold">{formatFCFA(ipmPartClient)}</span></span>}
                        {ipmPartClient === 0 && <span className="block mt-0.5 text-teal-700 font-bold">100% pris en charge — aucun paiement client requis</span>}
                      </div>
                    </div>
                  )}
                  {ipmPartClient === 0 && ipmBeneficiaire ? (
                    <div className="text-xs text-teal-600 font-medium text-center py-2">Facture entièrement couverte par l'IPM</div>
                  ) : (
                    <>
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Reglement{ipmBeneficiaire ? ' (part client)' : ''}</div>
                    {!ipmBeneficiaire && (
                    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                      <input type="checkbox" checked={isCredit} onChange={e => setIsCredit(e.target.checked)} className="sr-only peer" />
                      <div className="relative w-9 h-5 bg-slate-200 peer-checked:bg-amber-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-transform peer-checked:after:translate-x-4"></div>
                      <span className={`text-xs font-semibold ${isCredit ? 'text-amber-700' : 'text-slate-500'}`}>A crédit</span>
                    </label>
                    )}
                  </div>
                  {!isCredit && (
                    <>
                      <div className="flex items-center gap-2 mb-2">
                        <select value={payMethodId} onChange={e => setPayMethodId(e.target.value)} className="shrink-0 text-sm font-semibold text-slate-800 bg-transparent border-none outline-none cursor-pointer py-1 pr-6 appearance-none">
                          {paymentMethods.map((m: any) => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>
                        <input type="number" value={payAmt} onChange={e => setPayAmt(e.target.value)} placeholder={formatFCFA(balance > 0 ? balance : 0)} min="0" className="input text-xs h-8 w-32 text-right num" onFocus={() => { if (!payAmt && balance > 0) setPayAmt(String(balance)); }} />
                        <button onClick={addPayment} disabled={!payAmt || Number(payAmt) <= 0} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-40 transition-colors whitespace-nowrap">
                          <Plus className="w-3 h-3 inline" /> Ajouter
                        </button>
                      </div>
                      {payments.length > 0 && (
                        <div className="space-y-1">
                          {payments.map((p, i) => (
                            <div key={i} className="flex items-center justify-between px-3 py-2 bg-white rounded-lg border border-slate-200 text-xs">
                              <div className="flex items-center gap-2">
                                <Coins className="w-3.5 h-3.5 text-emerald-600" />
                                <span className="font-semibold text-slate-700">{p.method_name}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-emerald-700 num">{formatFCFA(p.amount)}</span>
                                <button onClick={() => setPayments((prev: any[]) => prev.filter((_: any, j: number) => j !== i))} className="p-1 rounded hover:bg-red-50 text-red-400"><X className="w-3 h-3" /></button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  {isCredit && (
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 font-medium">
                      <CreditCard className="w-4 h-4 text-amber-600 flex-shrink-0" />
                      Cette facture sera enregistrée à crédit. Le client devra régler ultérieurement.
                    </div>
                  )}
                    </>
                  )}
                </div>
                )}
              </div>
            </>
          );
        })()}

        {/* Footer */}
        <div className="border-t border-slate-200 bg-slate-50/80 px-5 py-3 flex items-center justify-between flex-shrink-0">
          <div className="text-xs text-slate-500">
            {invoiceItems.filter(i => i.name.trim()).length} ligne{invoiceItems.filter(i => i.name.trim()).length > 1 ? 's' : ''}
            {payments.length > 0 && <span className="ml-2">· {payments.length} reglement{payments.length > 1 ? 's' : ''}</span>}
          </div>
          <div className="flex items-center gap-6">
            {ipmBeneficiaire && ipmPartIpm > 0 && (
              <div className="text-right">
                <span className="text-[10px] text-teal-500 uppercase font-bold tracking-wide block">Part IPM</span>
                <span className="text-sm font-bold text-teal-700 num">{formatFCFA(ipmPartIpm)}</span>
              </div>
            )}
            {ipmBeneficiaire && ipmPartIpm > 0 && (
              <div className="text-right">
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wide block">Part Client</span>
                <span className="text-sm font-bold text-slate-700 num">{formatFCFA(ipmPartClient)}</span>
              </div>
            )}
            {totalPaid > 0 && (
              <div className="text-right">
                <span className="text-[10px] text-emerald-500 uppercase font-bold tracking-wide block">Payé</span>
                <span className="text-sm font-bold text-emerald-700 num">{formatFCFA(totalPaid)}</span>
              </div>
            )}
            {balance > 0 && totalPaid > 0 && (
              <div className="text-right">
                <span className="text-[10px] text-amber-500 uppercase font-bold tracking-wide block">Reste</span>
                <span className="text-sm font-bold text-amber-700 num">{formatFCFA(balance)}</span>
              </div>
            )}
            <div className="text-right">
              <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wide block">Total</span>
              <span className="text-lg font-black text-slate-900 num">{formatFCFA(invoiceSubtotal)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
