import { useEffect, useMemo, useState } from 'react';
import {
  Plus, FileText, Loader2, Eye, Printer, CheckCircle, X, Trash2, Car,
  Receipt, RotateCcw, Wallet, Minus, Package, Filter, Check, Calendar, User,
  CreditCard, ShoppingCart, ArrowRight, Banknote, MessageCircle, Link2
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { Modal, ConfirmDialog } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { VehicleArticlePicker } from '../components/VehicleArticlePicker';
import { isAutoParts } from '../lib/types';
import { formatFCFA, formatDate, formatDateTime } from '../lib/format';
import { printDocumentA4, type PrintTenant } from '../lib/print';
import { consumeNavContext } from '../lib/navHighlight';

const tenantForPrint = (t: any): PrintTenant => ({
  name: t?.name || '', legal_name: t?.legal_name, ninea: t?.ninea, rccm: t?.rccm,
  address: t?.address, phone: t?.phone, email: t?.email, website: t?.website,
  logo_url: t?.logo_url, business_type: t?.business_type,
});

type Tab = 'quotes' | 'invoices' | 'returns' | 'credits';

type Quote = {
  id: string; quote_number: string; total: number; subtotal: number; discount: number;
  status: string; created_at: string; valid_until: string | null; note: string;
  converted_sale_id: string | null; customer_id: string | null;
  customers: { name: string } | null;
};
type QuoteItem = {
  id?: string; article_id: string | null; name: string;
  quantity: number; unit_price: number; discount: number; total: number;
};
type Invoice = {
  id: string; sale_number: string; total: number; paid: number; status: string;
  customer_id: string | null;
  created_at: string;
  public_code?: string | null;
  customers: { name: string } | null;
};
type SaleReturn = {
  id: string; return_number: string; total: number; status: string;
  refund_method: string; reason: string; restock: boolean;
  credit_used?: number; customer_id: string | null;
  created_at: string;
  customers: { name: string } | null;
  sales: { sale_number: string } | null;
};

const QUOTE_STATUS: Record<string, { label: string; pill: string; dot: string }> = {
  draft:     { label: 'Brouillon', pill: 'bg-slate-100 text-slate-700 border-slate-200', dot: 'bg-slate-400' },
  sent:      { label: 'Envoyé',    pill: 'bg-blue-50 text-blue-700 border-blue-200',     dot: 'bg-blue-500' },
  accepted:  { label: 'Accepté',   pill: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  rejected:  { label: 'Refusé',    pill: 'bg-red-50 text-red-700 border-red-200',        dot: 'bg-red-500' },
  converted: { label: 'Converti',  pill: 'bg-brand-50 text-brand-700 border-brand-200',  dot: 'bg-brand-500' },
  expired:   { label: 'Expiré',    pill: 'bg-amber-50 text-amber-700 border-amber-200',  dot: 'bg-amber-500' },
};

function invoiceStatus(s: Invoice) {
  if (s.status === 'cancelled') return { label: 'Annulée', pill: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' };
  if (s.paid >= s.total)        return { label: 'Payée', pill: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' };
  if (Number(s.paid) > 0)       return { label: 'Partiellement payée', pill: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' };
  return { label: 'Validée', pill: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' };
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
  { key: 'quotes',   label: 'Devis',    icon: FileText },
  { key: 'invoices', label: 'Factures', icon: Receipt },
  { key: 'returns',  label: 'Retours',  icon: RotateCcw },
  { key: 'credits',  label: 'Avoirs',   icon: Wallet },
];

export function Billing({ onNavigate }: { onNavigate?: (r: string) => void }) {
  const { tenant, currentSite, dataTick, profile } = useApp();
  const autoMode = isAutoParts(tenant);
  const { success, error } = useToast();

  const [tab, setTab] = useState<Tab>('quotes');
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
  const [sales, setSales] = useState<any[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);

  // Quote modals
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quoteDetail, setQuoteDetail] = useState<Quote | null>(null);
  const [quoteItemsDetail, setQuoteItemsDetail] = useState<any[]>([]);
  const [quoteForm, setQuoteForm] = useState<{ customer_id: string; valid_until: string; note: string }>({ customer_id: '', valid_until: '', note: '' });
  const [quoteItems, setQuoteItems] = useState<QuoteItem[]>([{ article_id: null, name: '', quantity: 1, unit_price: 0, discount: 0, total: 0 }]);
  const [quoteToCancel, setQuoteToCancel] = useState<Quote | null>(null);
  const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false);
  const [vehiclePickerTargetIdx, setVehiclePickerTargetIdx] = useState<number | null>(null);

  // Conversion modal
  const [convertFrom, setConvertFrom] = useState<Quote | null>(null);
  const [convertPayNow, setConvertPayNow] = useState(false);
  const [convertPayMethod, setConvertPayMethod] = useState('');
  const [convertPayAmount, setConvertPayAmount] = useState('');
  const [converting, setConverting] = useState(false);

  // Invoice detail + payment
  const [invoiceDetail, setInvoiceDetail] = useState<Invoice | null>(null);
  const [invoiceItems, setInvoiceItems] = useState<any[]>([]);
  const [invoicePays, setInvoicePays] = useState<any[]>([]);
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

  const [saving, setSaving] = useState(false);

  const load = async (silent = false) => {
    if (!tenant || !currentSite) return;
    if (!silent) setLoading(true);
    const siteId = currentSite.id;
    const [q, s, r] = await Promise.all([
      supabase.from('quotes').select('*, customers(name, phone, address)').eq('tenant_id', tenant.id).eq('site_id', siteId).order('created_at', { ascending: false }).limit(300),
      supabase.from('sales').select('id, sale_number, total, paid, status, customer_id, created_at, public_code, customers(name, phone, address)').eq('tenant_id', tenant.id).eq('site_id', siteId).order('created_at', { ascending: false }).limit(300),
      supabase.from('sale_returns').select('*, customers(name, phone, address), sales(sale_number)').eq('tenant_id', tenant.id).eq('site_id', siteId).order('created_at', { ascending: false }).limit(300),
    ]);
    setQuotes((q.data as any) || []);
    setInvoices((s.data as any) || []);
    setReturns((r.data as any) || []);
    if (!silent) setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenant?.id, currentSite?.id]);

  const [flashTab, setFlashTab] = useState<Tab | null>(null);
  useEffect(() => {
    const ctx = consumeNavContext();
    if (!ctx?.target) return;
    if (ctx.target === 'quotes') { setTab('quotes'); setFlashTab('quotes'); }
    else if (ctx.target === 'returns') { setTab('returns'); setFlashTab('returns'); }
    const t = setTimeout(() => setFlashTab(null), 6800);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => { if (dataTick > 0) load(true); /* eslint-disable-next-line */ }, [dataTick]);

  useEffect(() => {
    if (!tenant) return;
    Promise.all([
      supabase.from('customers').select('id, name').eq('tenant_id', tenant.id).eq('is_active', true).order('name'),
      supabase.from('articles').select('id, name, sale_price, internal_ref').eq('tenant_id', tenant.id).eq('is_active', true).order('name').limit(500),
      supabase.from('sales').select('id, sale_number, customer_id, customers(name)').eq('tenant_id', tenant.id).eq('status', 'paid').order('created_at', { ascending: false }).limit(200),
      supabase.from('payment_methods').select('id, name, code, payment_type').eq('tenant_id', tenant.id).eq('is_active', true).order('sort_order'),
    ]).then(([c, a, sl, pm]) => {
      setCustomers(c.data || []);
      setArticles(a.data || []);
      setSales((sl.data as any) || []);
      setPaymentMethods((pm.data || []).filter((m: any) => m.payment_type !== 'credit'));
    });
  }, [tenant?.id]);

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
  const updateQuoteItem = (idx: number, field: keyof QuoteItem, val: any) => {
    setQuoteItems(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      if (field === 'article_id') {
        const art = articles.find(a => a.id === val);
        if (art) {
          next[idx].name = art.name;
          next[idx].unit_price = art.sale_price;
          if (!Number(next[idx].quantity) || Number(next[idx].quantity) < 1) next[idx].quantity = 1;
        }
      }
      const it = next[idx];
      next[idx].total = Math.max(0, Number(it.quantity || 0) * Number(it.unit_price || 0) - Number(it.discount || 0));
      return next;
    });
  };
  const quoteSubtotal = quoteItems.reduce((s, i) => s + Number(i.total), 0);

  const saveQuote = async () => {
    if (!tenant || !currentSite) { error('Magasin introuvable'); return; }
    if (quoteItems.every(i => !i.name.trim())) { error('Ajoutez au moins un article'); return; }
    setSaving(true);
    const { data: numData } = await supabase.rpc('next_doc_number', {
      p_tenant_id: tenant.id, p_kind: 'quote', p_prefix: 'DEV',
    });
    const qNum = (numData as string) || ('DEV-' + Date.now());
    const { data: q, error: e } = await supabase.from('quotes').insert({
      tenant_id: tenant.id, site_id: currentSite.id,
      customer_id: quoteForm.customer_id || null,
      quote_number: qNum, subtotal: quoteSubtotal, discount: 0, total: quoteSubtotal,
      valid_until: quoteForm.valid_until || null, note: quoteForm.note, status: 'draft',
    }).select().single();
    if (e || !q) { error(e?.message || 'Erreur'); setSaving(false); return; }
    const valid = quoteItems.filter(i => i.name.trim());
    await supabase.from('quote_items').insert(valid.map(i => ({ tenant_id: tenant.id, quote_id: q.id, article_id: i.article_id, name: i.name, quantity: i.quantity, unit_price: i.unit_price, discount: i.discount, total: i.total })));
    setSaving(false);
    success('Devis créé'); setQuoteOpen(false);
    setQuoteItems([{ article_id: null, name: '', quantity: 1, unit_price: 0, discount: 0, total: 0 }]);
    setQuoteForm({ customer_id: '', valid_until: '', note: '' });
    load();
  };

  const openQuoteDetail = async (q: Quote) => {
    setQuoteDetail(q);
    const { data } = await supabase.from('quote_items').select('*, articles(internal_ref, oem_ref)').eq('quote_id', q.id);
    setQuoteItemsDetail(data || []);
  };
  const changeQuoteStatus = async (q: Quote, status: string) => {
    await supabase.from('quotes').update({ status }).eq('id', q.id);
    success('Statut mis à jour'); load();
    if (quoteDetail?.id === q.id) setQuoteDetail({ ...q, status });
  };

  const printQuote = () => {
    if (!quoteDetail || !tenant) return;
    const items = quoteItemsDetail.map(i => ({ name: i.name, supplier_ref: null, oem_ref: i.articles?.oem_ref || null, quantity: Number(i.quantity), unit_price: Number(i.unit_price), discount: Number(i.discount || 0) }));
    const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price - (i.discount || 0), 0);
    printDocumentA4({
      tenant: tenantForPrint(tenant),
      docLabel: 'DEVIS',
      docNumber: quoteDetail.quote_number,
      docDate: new Date(quoteDetail.created_at).toLocaleDateString('fr-FR'),
      customer: quoteDetail.customers ? { name: quoteDetail.customers.name, phone: (quoteDetail.customers as any).phone || undefined, address: (quoteDetail.customers as any).address || undefined } : null,
      items, subtotal, total: Number(quoteDetail.total),
      footerNote: 'Devis valable 30 jours à compter de la date d\'émission.',
      issuedBy: profile?.full_name || undefined,
    });
  };

  // ── Convert quote → sale ─────────────────────────────────────
  const openConvert = (q: Quote) => {
    setConvertFrom(q); setConvertPayNow(false); setConvertPayMethod(paymentMethods[0]?.id || '');
    setConvertPayAmount(String(q.total));
  };
  const confirmConvert = async () => {
    if (!convertFrom || !currentSite) return;
    setConverting(true);
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
      p_site_id: currentSite.id,
      p_cash_session_id: null,
      p_payments: payments,
    });
    setConverting(false);
    if (e) { error(e.message); return; }
    success(`Facture ${(data as any)?.sale_number || ''} créée`);
    setConvertFrom(null); setQuoteDetail(null);
    setTab('invoices'); load();
  };

  // ── Invoice detail ───────────────────────────────────────────
  const openInvoiceDetail = async (s: Invoice) => {
    setInvoiceDetail(s);
    const [{ data: it }, { data: pp }] = await Promise.all([
      supabase.from('sale_items').select('*, articles(internal_ref, oem_ref)').eq('sale_id', s.id),
      supabase.from('sale_payments').select('*').eq('sale_id', s.id),
    ]);
    setInvoiceItems(it || []); setInvoicePays(pp || []);
  };

  const reloadInvoice = async (id: string) => {
    const { data } = await supabase.from('sales').select('id, sale_number, total, paid, status, customer_id, created_at, public_code, customers(name, phone, address)').eq('id', id).maybeSingle();
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
      tenant: tenantForPrint(tenant),
      docLabel: 'FACTURE',
      docNumber: invoiceDetail.sale_number,
      docDate: new Date(invoiceDetail.created_at).toLocaleDateString('fr-FR'),
      customer: invoiceDetail.customers ? { name: invoiceDetail.customers.name, phone: (invoiceDetail.customers as any).phone || undefined, address: (invoiceDetail.customers as any).address || undefined } : null,
      items, subtotal, total: Number(invoiceDetail.total),
      payments: invoicePays.map(p => ({ method_name: p.method_name, amount: Number(p.amount) })),
      paid: Number(invoiceDetail.paid),
      issuedBy: profile?.full_name || undefined,
    });
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
    const amt = Number(payAmount);
    if (!amt || amt <= 0) { error('Montant invalide'); return; }
    const pm = paymentMethods.find(p => p.id === payMethod);
    if (!pm) { error('Mode de règlement requis'); return; }
    setPaying(true);
    let sessionId: string | null = null;
    if (currentSite && tenant) {
      const { data: sess } = await supabase.from('cash_sessions')
        .select('id').eq('tenant_id', tenant.id).eq('site_id', currentSite.id)
        .eq('status', 'open').order('opened_at', { ascending: false }).limit(1).maybeSingle();
      sessionId = sess?.id || null;
    }
    const ref = `Règlement facture ${invoiceDetail.sale_number}${invoiceDetail.customers?.name ? ' · ' + invoiceDetail.customers.name : ''}`;
    const { error: e } = await supabase.rpc('register_sale_payment', {
      p_sale_id: invoiceDetail.id,
      p_payment_method_id: pm.id,
      p_method_name: pm.name,
      p_amount: amt,
      p_reference: ref,
      p_cash_session_id: sessionId,
    });
    setPaying(false);
    if (e) { error(e.message); return; }
    success(sessionId ? 'Paiement enregistré · imputé sur la caisse du jour' : 'Paiement enregistré');
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
    const { data } = await supabase.from('sale_items').select('*').eq('sale_id', saleId);
    setReturnLines((data || []).map(i => ({ item_id: i.id, article_id: i.article_id, name: i.name, max_qty: i.quantity, quantity: i.quantity, unit_price: i.unit_price, selected: false })));
  };
  const handleSaleChange = async (saleId: string) => {
    setReturnForm(f => ({ ...f, sale_id: saleId }));
    if (saleId) await loadSaleItems(saleId);
    else setReturnLines([]);
  };
  const returnTotal = returnLines.filter(i => i.selected).reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0);

  const saveReturn = async (asCredit = false) => {
    if (!tenant || !currentSite) { error('Magasin introuvable'); return; }
    if (!returnForm.sale_id) { error('Sélectionnez une vente'); return; }
    const sel = returnLines.filter(i => i.selected && i.quantity > 0);
    if (sel.length === 0) { error('Sélectionnez au moins un article'); return; }
    setSaving(true);
    const { data: numData } = await supabase.rpc('next_doc_number', {
      p_tenant_id: tenant.id,
      p_kind: asCredit ? 'credit' : 'return',
      p_prefix: asCredit ? 'AVR' : 'RET',
    });
    const rNum = (numData as string) || ((asCredit ? 'AVR-' : 'RET-') + Date.now());
    const sale = sales.find(s => s.id === returnForm.sale_id);
    const { data: ret, error: e } = await supabase.from('sale_returns').insert({
      tenant_id: tenant.id, site_id: currentSite.id,
      sale_id: returnForm.sale_id, customer_id: sale?.customer_id || null,
      return_number: rNum, total: returnTotal,
      refund_method: asCredit ? 'avoir' : returnForm.refund_method, reason: returnForm.reason,
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
          p_article_id: item.article_id, p_site_id: currentSite.id,
          p_quantity: item.quantity, p_movement_type: 'return_customer',
          p_note: `Retour ${rNum}`,
        });
      }
    }
    setSaving(false);
    success(asCredit ? 'Avoir créé' : 'Retour enregistré');
    setReturnOpen(false);
    setReturnForm({ sale_id: '', reason: '', refund_method: 'cash', restock: true });
    setReturnLines([]);
    load();
  };

  const openReturnDetail = async (r: SaleReturn) => {
    setReturnDetail(r);
    const { data } = await supabase.from('sale_return_items').select('*, articles(internal_ref, oem_ref)').eq('return_id', r.id);
    setReturnItemsDetail(data || []);
  };
  const approveReturn = async (r: SaleReturn) => {
    await supabase.from('sale_returns').update({ status: 'approved' }).eq('id', r.id);
    success('Approuvé'); load();
    if (returnDetail?.id === r.id) setReturnDetail({ ...r, status: 'approved' });
  };

  const printReturn = () => {
    if (!returnDetail || !tenant) return;
    const isCredit = returnDetail.refund_method === 'avoir';
    const items = returnItemsDetail.map(i => ({ name: i.name, supplier_ref: null, oem_ref: i.articles?.oem_ref || null, quantity: Number(i.quantity), unit_price: Number(i.unit_price) }));
    const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
    const extra: { label: string; value: string }[] = [];
    if (returnDetail.sales?.sale_number) extra.push({ label: 'Vente liée', value: returnDetail.sales.sale_number });
    printDocumentA4({
      tenant: tenantForPrint(tenant),
      docLabel: isCredit ? 'AVOIR' : 'RETOUR',
      docNumber: returnDetail.return_number,
      docDate: new Date(returnDetail.created_at).toLocaleDateString('fr-FR'),
      customer: returnDetail.customers ? { name: returnDetail.customers.name, phone: (returnDetail.customers as any).phone || undefined, address: (returnDetail.customers as any).address || undefined } : null,
      extraMeta: extra,
      items, subtotal, total: Number(returnDetail.total),
      footerNote: returnDetail.reason ? `Motif : ${returnDetail.reason}` : undefined,
      issuedBy: profile?.full_name || undefined,
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
      { value: 'validated', label: 'Validée' },
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
    if (tab === 'quotes') setQuoteOpen(true);
    else if (tab === 'invoices') onNavigate?.('pos');
    else setReturnOpen(true);
  };
  const primaryLabel = tab === 'quotes' ? 'Nouveau devis' : tab === 'invoices' ? 'Nouvelle facture' : tab === 'returns' ? 'Nouveau retour' : 'Nouvel avoir';
  const PIcon = tab === 'invoices' ? ShoppingCart : Plus;

  const invoiceDue = invoiceDetail ? Math.max(0, Number(invoiceDetail.total) - Number(invoiceDetail.paid)) : 0;

  return (
    <div className="space-y-3 pb-6">
      {/* ── Header ───────────────────────────────────────────── */}
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

      {/* ── Tabs ─────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 -mx-1 px-1 pt-1 pb-1 bg-gradient-to-b from-[#f6f8fb] to-[#f6f8fb]/80 backdrop-blur">
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
                                  {q.status === 'draft' && <button onClick={() => changeQuoteStatus(q, 'sent')} className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 transition-all" title="Marquer envoyé"><CheckCircle className="w-4 h-4" /></button>}
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
              <div className="card-premium"><EmptyState icon={Receipt} title="Aucune facture" description="Les factures créées apparaîtront ici." action={<button onClick={() => onNavigate?.('pos')} className="btn-primary"><ShoppingCart className="w-4 h-4" />Aller à la caisse</button>} /></div>
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
                            <div className={`text-sm font-bold num ${isCredit ? 'text-blue-700' : 'text-red-700'}`}>{isCredit ? '' : '-'}{formatFCFA(r.total)}</div>
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
                              <td className={`px-4 py-3 text-right font-bold num whitespace-nowrap ${isCredit ? 'text-blue-700' : 'text-red-700'}`}>{isCredit ? '' : '-'}{formatFCFA(r.total)}</td>
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
          <button onClick={clearFilters} className="btn-secondary"><X className="w-4 h-4" />Réinitialiser</button>
          <button onClick={() => setFiltersOpen(false)} className="btn-primary"><Check className="w-4 h-4" />Appliquer</button>
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
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2"><Banknote className="w-3.5 h-3.5" />Montant (FCFA)</div>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" placeholder="Min" value={minAmount} onChange={e => setMinAmount(e.target.value)} className="input" />
              <input type="number" placeholder="Max" value={maxAmount} onChange={e => setMaxAmount(e.target.value)} className="input" />
            </div>
          </div>
        </div>
      </Modal>

      {/* ── Quote create modal ──────────────────────────────── */}
      <Modal open={quoteOpen} onClose={() => setQuoteOpen(false)} title="Nouveau devis" size="lg"
        footer={<>
          <button onClick={() => setQuoteOpen(false)} className="btn-secondary">Annuler</button>
          <button onClick={saveQuote} disabled={saving} className="btn-primary">{saving && <Loader2 className="w-4 h-4 animate-spin" />}Enregistrer</button>
        </>}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Client</label>
              <select value={quoteForm.customer_id} onChange={e => setQuoteForm(f => ({ ...f, customer_id: e.target.value }))} className="input">
                <option value="">— Client comptoir —</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Valide jusqu'au</label>
              <input type="date" value={quoteForm.valid_until} onChange={e => setQuoteForm(f => ({ ...f, valid_until: e.target.value }))} className="input" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Articles</label>
              <div className="flex items-center gap-1.5">
                {autoMode && <button onClick={() => { setVehiclePickerTargetIdx(null); setVehiclePickerOpen(true); }} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 hover:border-brand-300 hover:bg-brand-50/50 transition-all"><Car className="w-3 h-3" />Par véhicule</button>}
                <button onClick={() => setQuoteItems(p => [...p, { article_id: null, name: '', quantity: 1, unit_price: 0, discount: 0, total: 0 }])} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1.5 rounded-xl bg-brand-50 border border-brand-200 text-brand-700 hover:bg-brand-100 transition-all"><Plus className="w-3 h-3" />Ajouter</button>
              </div>
            </div>

            <div className="md:hidden space-y-2 max-h-[45vh] overflow-y-auto -mx-1 px-1 pb-1">
              {quoteItems.map((it, idx) => (
                <div key={idx} className="p-3 rounded-2xl bg-slate-50/60 border border-slate-200/80">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <select value={it.article_id || ''} onChange={e => updateQuoteItem(idx, 'article_id', e.target.value)} className="input text-xs h-9">
                        <option value="">— Article —</option>
                        {articles.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                      <input value={it.name} onChange={e => updateQuoteItem(idx, 'name', e.target.value)} placeholder="Désignation" className="input text-xs h-9" />
                      <div className="grid grid-cols-3 gap-1.5">
                        <input type="number" value={it.quantity} onChange={e => updateQuoteItem(idx, 'quantity', Number(e.target.value))} min="1" className="input text-xs h-9" placeholder="Qté" />
                        <input type="number" value={it.unit_price} onChange={e => updateQuoteItem(idx, 'unit_price', Number(e.target.value))} min="0" className="input text-xs h-9" placeholder="Prix" />
                        <input type="number" value={it.discount} onChange={e => updateQuoteItem(idx, 'discount', Number(e.target.value))} min="0" className="input text-xs h-9" placeholder="Remise" />
                      </div>
                      <div className="text-right text-[11px] font-bold text-slate-900 num">Total {formatFCFA(it.total)}</div>
                    </div>
                    <button onClick={() => setQuoteItems(p => p.filter((_, i) => i !== idx))} disabled={quoteItems.length === 1} className="p-2 rounded-lg hover:bg-red-50 text-red-400 disabled:opacity-30"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden md:block max-h-[45vh] overflow-y-auto">
              <div className="space-y-1.5">
                {quoteItems.map((it, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-1.5 items-start">
                    <div className="col-span-4">
                      <select value={it.article_id || ''} onChange={e => updateQuoteItem(idx, 'article_id', e.target.value)} className="input text-xs">
                        <option value="">— Article —</option>
                        {articles.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    </div>
                    <div className="col-span-4"><input value={it.name} onChange={e => updateQuoteItem(idx, 'name', e.target.value)} placeholder="Désignation" className="input text-xs" /></div>
                    <div className="col-span-1"><input type="number" value={it.quantity} onChange={e => updateQuoteItem(idx, 'quantity', Number(e.target.value))} min="1" className="input text-xs" /></div>
                    <div className="col-span-2"><input type="number" value={it.unit_price} onChange={e => updateQuoteItem(idx, 'unit_price', Number(e.target.value))} min="0" className="input text-xs" /></div>
                    <div className="col-span-1 flex items-center justify-end">
                      <button onClick={() => setQuoteItems(p => p.filter((_, i) => i !== idx))} disabled={quoteItems.length === 1} className="p-1 rounded hover:bg-red-50 text-red-400 disabled:opacity-30"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-slate-100 flex justify-end">
              <span className="font-bold text-slate-900 num">Total : {formatFCFA(quoteSubtotal)}</span>
            </div>
          </div>

          <div>
            <label className="label">Note</label>
            <textarea value={quoteForm.note} onChange={e => setQuoteForm(f => ({ ...f, note: e.target.value }))} className="input resize-none" rows={2} />
          </div>
        </div>
      </Modal>

      {/* ── Quote detail ─────────────────────────────────────── */}
      <Modal open={!!quoteDetail} onClose={() => setQuoteDetail(null)} title={quoteDetail ? `Devis ${quoteDetail.quote_number}` : ''} size="lg"
        footer={<>
          <div className="flex gap-2 flex-wrap">
            {quoteDetail?.status === 'draft' && <button onClick={() => changeQuoteStatus(quoteDetail, 'sent')} className="btn-secondary text-sm">Marquer envoyé</button>}
            {quoteDetail && ['draft', 'sent'].includes(quoteDetail.status) && <button onClick={() => changeQuoteStatus(quoteDetail, 'accepted')} className="text-sm px-3 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 font-semibold flex items-center gap-1"><CheckCircle className="w-4 h-4" />Accepter</button>}
            {quoteDetail?.status === 'accepted' && <button onClick={() => openConvert(quoteDetail)} className="text-sm px-3 py-2 bg-gradient-to-br from-brand-600 to-brand-800 text-white rounded-xl hover:shadow-glow font-semibold flex items-center gap-1"><ArrowRight className="w-4 h-4" />Convertir en facture</button>}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setQuoteDetail(null)} className="btn-secondary">Fermer</button>
            <button onClick={printQuote} className="btn-primary"><Printer className="w-4 h-4" />Imprimer</button>
          </div>
        </>}>
        {quoteDetail && (() => {
          const st = QUOTE_STATUS[quoteDetail.status] || QUOTE_STATUS.draft;
          return (
            <div className="space-y-4">
              <div className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border ${st.pill}`}>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
                  <span className={`w-2 h-2 rounded-full ${st.dot} animate-pulse`} />Devis {st.label}
                </div>
                <div className="text-[10px] font-semibold opacity-70 num">{formatDate(quoteDetail.created_at)}</div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="p-3 rounded-xl bg-slate-50/80 border border-slate-200/70">
                  <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-slate-400"><Calendar className="w-3 h-3" />Date</div>
                  <div className="text-[11px] font-semibold text-slate-800 mt-1 num">{formatDate(quoteDetail.created_at)}</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50/80 border border-slate-200/70">
                  <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-slate-400"><User className="w-3 h-3" />Client</div>
                  <div className="text-[11px] font-semibold text-slate-800 mt-1 truncate">{quoteDetail.customers?.name || 'Comptoir'}</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-900 text-white border border-slate-900">
                  <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-white/50"><Receipt className="w-3 h-3" />Total</div>
                  <div className="text-sm font-bold mt-1 num">{formatFCFA(quoteDetail.total)}</div>
                </div>
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                  <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-amber-700/70"><Calendar className="w-3 h-3" />Validité</div>
                  <div className="text-[11px] font-semibold text-amber-800 mt-1 num">{quoteDetail.valid_until ? formatDate(quoteDetail.valid_until) : '—'}</div>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Articles</div>
                  <span className="text-[10px] font-bold text-slate-400 num">{quoteItemsDetail.length}</span>
                </div>
                <div className="md:hidden space-y-1.5">
                  {quoteItemsDetail.map(i => (
                    <div key={i.id} className="p-2.5 rounded-xl bg-white border border-slate-200/70 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] font-semibold text-slate-900 truncate">{i.name}</div>
                          {i.articles?.internal_ref && <div className="text-[10px] text-slate-400 font-mono mt-0.5">{i.articles.internal_ref}</div>}
                          {i.articles?.oem_ref && <div className="text-[10px] text-slate-400 font-mono">OEM: {i.articles.oem_ref}</div>}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[11px] font-bold text-slate-900 num">{formatFCFA(i.total)}</div>
                          <div className="text-[9px] text-slate-400 num mt-0.5">{i.quantity} × {formatFCFA(i.unit_price)}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="hidden md:block rounded-xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                      <tr><th className="px-4 py-2.5 text-left">Article</th><th className="px-4 py-2.5 text-right">Qté</th><th className="px-4 py-2.5 text-right">P.U.</th><th className="px-4 py-2.5 text-right">Total</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {quoteItemsDetail.map(i => <tr key={i.id} className="hover:bg-slate-50/60"><td className="px-4 py-2.5 text-slate-800"><div>{i.name}</div>{i.articles?.internal_ref && <div className="text-[10px] text-slate-400 font-mono mt-0.5">{i.articles.internal_ref}</div>}{i.articles?.oem_ref && <div className="text-[10px] text-slate-400 font-mono">OEM: {i.articles.oem_ref}</div>}</td><td className="px-4 py-2.5 text-right num">{i.quantity}</td><td className="px-4 py-2.5 text-right num">{formatFCFA(i.unit_price)}</td><td className="px-4 py-2.5 text-right font-bold num">{formatFCFA(i.total)}</td></tr>)}
                    </tbody>
                  </table>
                </div>
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
          <button onClick={confirmConvert} disabled={converting} className="btn-primary">{converting && <Loader2 className="w-4 h-4 animate-spin" />}<ArrowRight className="w-4 h-4" />Créer facture</button>
        </>}>
        {convertFrom && (
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

            <label className="flex items-center gap-2 cursor-pointer p-3 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors">
              <input type="checkbox" checked={convertPayNow} onChange={e => setConvertPayNow(e.target.checked)} className="w-4 h-4 rounded" />
              <div className="flex-1">
                <div className="text-sm font-semibold text-slate-800">Encaisser immédiatement</div>
                <div className="text-[11px] text-slate-500">Sinon, la facture reste à payer plus tard</div>
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
                  <label className="label">Montant encaissé</label>
                  <input type="number" value={convertPayAmount} onChange={e => setConvertPayAmount(e.target.value)} className="input num text-lg font-bold" />
                </div>
              </div>
            )}

            <div className="text-[11px] text-slate-500 p-3 rounded-xl bg-slate-50 border border-slate-200/70">
              Le devis sera marqué comme <strong>converti</strong> et une nouvelle facture sera créée avec les mêmes articles.
            </div>
          </div>
        )}
      </Modal>

      {/* ── Invoice detail ───────────────────────────────────── */}
      <Modal open={!!invoiceDetail} onClose={() => setInvoiceDetail(null)} title={invoiceDetail ? `Facture ${invoiceDetail.sale_number}` : ''} size="lg"
        footer={<>
          <div className="flex gap-2 flex-wrap">
            {invoiceDetail && invoiceDue > 0 && invoiceDetail.status !== 'cancelled' && <button onClick={openPay} className="text-sm px-3 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 font-semibold flex items-center gap-1"><Banknote className="w-4 h-4" />Encaisser</button>}
            {invoiceDetail && invoiceDue > 0 && availableCredits.length > 0 && invoiceDetail.status !== 'cancelled' && <button onClick={openCreditApply} className="text-sm px-3 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-semibold flex items-center gap-1"><Wallet className="w-4 h-4" />Appliquer avoir</button>}
          </div>
          <div className="flex gap-2">
            <button onClick={() => copyInvoiceLink()} className="btn-secondary" title="Copier le lien de la facture"><Link2 className="w-4 h-4" /><span className="hidden sm:inline">Copier lien</span></button>
            {invoiceDetail?.customers && (
              <button onClick={() => sendInvoiceWhatsApp()} className="flex items-center gap-1.5 px-3 py-2 bg-[#25D366] text-white rounded-xl hover:brightness-95 font-semibold text-sm transition shadow-sm" title="Envoyer par WhatsApp"><MessageCircle className="w-4 h-4" /><span className="hidden sm:inline">WhatsApp</span></button>
            )}
            <button onClick={() => setInvoiceDetail(null)} className="btn-secondary">Fermer</button>
            <button onClick={printInvoice} className="btn-primary"><Printer className="w-4 h-4" />Imprimer</button>
          </div>
        </>}>
        {invoiceDetail && (() => {
          const st = invoiceStatus(invoiceDetail);
          return (
            <div className="space-y-4">
              <div className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border ${st.pill}`}>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
                  <span className={`w-2 h-2 rounded-full ${st.dot} animate-pulse`} />Facture {st.label}
                </div>
                <div className="text-[10px] font-semibold opacity-70 num">{formatDateTime(invoiceDetail.created_at)}</div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="p-3 rounded-xl bg-slate-50/80 border border-slate-200/70">
                  <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-slate-400"><User className="w-3 h-3" />Client</div>
                  <div className="text-[11px] font-semibold text-slate-800 mt-1 truncate">{invoiceDetail.customers?.name || 'Comptoir'}</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-900 text-white border border-slate-900">
                  <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-white/50"><Receipt className="w-3 h-3" />Total</div>
                  <div className="text-sm font-bold mt-1 num">{formatFCFA(invoiceDetail.total)}</div>
                </div>
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                  <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-emerald-700/70"><CreditCard className="w-3 h-3" />Payé</div>
                  <div className="text-sm font-bold text-emerald-700 mt-1 num">{formatFCFA(invoiceDetail.paid)}</div>
                </div>
                <div className={`p-3 rounded-xl border ${invoiceDue > 0 ? 'bg-amber-50 border-amber-200' : 'bg-slate-50/80 border-slate-200/70'}`}>
                  <div className={`flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider ${invoiceDue > 0 ? 'text-amber-700/70' : 'text-slate-400'}`}><Wallet className="w-3 h-3" />Solde</div>
                  <div className={`text-sm font-bold mt-1 num ${invoiceDue > 0 ? 'text-amber-700' : 'text-slate-500'}`}>{formatFCFA(invoiceDue)}</div>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Articles</div>
                  <span className="text-[10px] font-bold text-slate-400 num">{invoiceItems.length}</span>
                </div>
                <div className="md:hidden space-y-1.5">
                  {invoiceItems.map(i => (
                    <div key={i.id} className="p-2.5 rounded-xl bg-white border border-slate-200/70 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] font-semibold text-slate-900 truncate">{i.name}</div>
                          {i.articles?.internal_ref && <div className="text-[10px] text-slate-400 font-mono mt-0.5">{i.articles.internal_ref}</div>}
                          {i.articles?.oem_ref && <div className="text-[10px] text-slate-400 font-mono">OEM: {i.articles.oem_ref}</div>}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[11px] font-bold text-slate-900 num">{formatFCFA(i.total)}</div>
                          <div className="text-[9px] text-slate-400 num mt-0.5">{i.quantity} × {formatFCFA(i.unit_price)}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="hidden md:block rounded-xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                      <tr><th className="px-4 py-2.5 text-left">Article</th><th className="px-4 py-2.5 text-right">Qté</th><th className="px-4 py-2.5 text-right">P.U.</th><th className="px-4 py-2.5 text-right">Total</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {invoiceItems.map(i => <tr key={i.id} className="hover:bg-slate-50/60"><td className="px-4 py-2.5 text-slate-800"><div>{i.name}</div>{i.articles?.internal_ref && <div className="text-[10px] text-slate-400 font-mono mt-0.5">{i.articles.internal_ref}</div>}{i.articles?.oem_ref && <div className="text-[10px] text-slate-400 font-mono">OEM: {i.articles.oem_ref}</div>}</td><td className="px-4 py-2.5 text-right num">{i.quantity}</td><td className="px-4 py-2.5 text-right num">{formatFCFA(i.unit_price)}</td><td className="px-4 py-2.5 text-right font-bold num">{formatFCFA(i.total)}</td></tr>)}
                    </tbody>
                  </table>
                </div>
              </div>
              {invoicePays.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Paiements</div>
                  <div className="space-y-1.5">
                    {invoicePays.map(p => (
                      <div key={p.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-white border border-slate-200/70 shadow-sm">
                        <div className="flex items-center gap-2 text-sm text-slate-700 min-w-0">
                          <div className="w-7 h-7 rounded-lg bg-brand-50 flex items-center justify-center shrink-0"><CreditCard className="w-3.5 h-3.5 text-brand-700" /></div>
                          <div className="min-w-0">
                            <div className="truncate font-medium">{p.method_name}</div>
                            <div className="text-[10px] text-slate-400 num">{formatDateTime(p.created_at)}</div>
                          </div>
                        </div>
                        <span className="font-bold text-slate-900 num">{formatFCFA(p.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      {/* ── Register payment modal ───────────────────────────── */}
      <Modal open={payOpen} onClose={() => !paying && setPayOpen(false)} title="Encaisser la facture" size="sm"
        footer={<>
          <button onClick={() => setPayOpen(false)} className="btn-secondary" disabled={paying}>Annuler</button>
          <button onClick={registerPayment} disabled={paying} className="btn-primary">{paying && <Loader2 className="w-4 h-4 animate-spin" />}<Banknote className="w-4 h-4" />Enregistrer</button>
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
      <Modal open={returnOpen} onClose={() => setReturnOpen(false)} title={tab === 'credits' ? 'Nouvel avoir client' : 'Nouveau retour client'} size="lg"
        footer={<>
          <button onClick={() => setReturnOpen(false)} className="btn-secondary">Annuler</button>
          {tab === 'credits' ? (
            <button onClick={() => saveReturn(true)} disabled={saving} className="btn-primary">{saving && <Loader2 className="w-4 h-4 animate-spin" />}<Wallet className="w-4 h-4" />Créer avoir</button>
          ) : (
            <button onClick={() => saveReturn(false)} disabled={saving} className="btn-primary">{saving && <Loader2 className="w-4 h-4 animate-spin" />}Enregistrer retour</button>
          )}
        </>}>
        <div className="space-y-4">
          <div>
            <label className="label">Vente d'origine *</label>
            <select value={returnForm.sale_id} onChange={e => handleSaleChange(e.target.value)} className="input">
              <option value="">— Sélectionnez une vente —</option>
              {sales.map(s => <option key={s.id} value={s.id}>{s.sale_number}{s.customers ? ` — ${s.customers.name}` : ''}</option>)}
            </select>
          </div>

          {returnLines.length > 0 && (
            <div>
              <label className="label">Articles à retourner</label>
              <div className="space-y-2 max-h-[40vh] overflow-y-auto -mx-1 px-1 pb-1">
                {returnLines.map((it, idx) => {
                  const toggle = (v: boolean) => setReturnLines(p => p.map((x, i) => i === idx ? { ...x, selected: v } : x));
                  const setQty = (q: number) => setReturnLines(p => p.map((x, i) => i === idx ? { ...x, quantity: Math.min(it.max_qty, Math.max(1, q)) } : x));
                  return (
                    <div key={idx} className={`rounded-2xl border p-3 transition-all ${it.selected ? 'border-brand-300 bg-brand-50/30 shadow-sm' : 'border-slate-200 bg-white'}`}>
                      <div className="flex items-start gap-3">
                        <button type="button" onClick={() => toggle(!it.selected)} className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all ${it.selected ? 'bg-brand-600 border-brand-600' : 'bg-white border-slate-300'}`}>
                          {it.selected && <CheckCircle className="w-4 h-4 text-white" />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-slate-900 line-clamp-2">{it.name}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5 num">{formatFCFA(it.unit_price)} · max {it.max_qty}</div>
                        </div>
                        <div className="num font-bold text-slate-900 shrink-0 text-right">
                          {it.selected ? formatFCFA(it.quantity * it.unit_price) : <span className="text-slate-300">—</span>}
                        </div>
                      </div>
                      {it.selected && (
                        <div className="mt-3 flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-500">Qté</span>
                          <div className="ml-auto flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl p-1">
                            <button type="button" onClick={() => setQty(it.quantity - 1)} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center"><Minus className="w-3.5 h-3.5" /></button>
                            <input type="number" value={it.quantity} onChange={e => setQty(Number(e.target.value))} min="1" max={it.max_qty} className="w-12 text-center text-sm font-bold num bg-transparent outline-none" />
                            <button type="button" onClick={() => setQty(it.quantity + 1)} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center"><Plus className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {returnLines.filter(i => i.selected).length > 0 && (
                <div className="mt-3 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 text-white p-4 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-white/50">{tab === 'credits' ? 'Total avoir' : 'Total remboursement'}</div>
                    <div className="text-xs text-white/70 mt-0.5">{returnLines.filter(i => i.selected).length} article{returnLines.filter(i => i.selected).length > 1 ? 's' : ''}</div>
                  </div>
                  <div className="num text-2xl font-bold">{formatFCFA(returnTotal)}</div>
                </div>
              )}
            </div>
          )}

          {tab !== 'credits' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Mode de remboursement</label>
                <select value={returnForm.refund_method} onChange={e => setReturnForm(f => ({ ...f, refund_method: e.target.value }))} className="input">
                  <option value="cash">Espèces</option>
                  <option value="wave">Wave</option>
                  <option value="orange_money">Orange Money</option>
                </select>
              </div>
              <div>
                <label className="label">Motif du retour</label>
                <input value={returnForm.reason} onChange={e => setReturnForm(f => ({ ...f, reason: e.target.value }))} className="input" placeholder="Défectueux, mauvaise référence…" />
              </div>
            </div>
          )}

          {tab === 'credits' && (
            <div>
              <label className="label">Motif</label>
              <input value={returnForm.reason} onChange={e => setReturnForm(f => ({ ...f, reason: e.target.value }))} className="input" placeholder="Raison de l'avoir…" />
            </div>
          )}

          <label className="flex items-center gap-2 cursor-pointer px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/70 hover:bg-slate-100 transition-colors">
            <input type="checkbox" checked={returnForm.restock} onChange={e => setReturnForm(f => ({ ...f, restock: e.target.checked }))} className="w-4 h-4 rounded" />
            <span className="text-sm font-medium text-slate-700">Remettre les articles en stock automatiquement</span>
          </label>
        </div>
      </Modal>

      {/* ── Return detail ─────────────────────────────────────── */}
      <Modal open={!!returnDetail} onClose={() => setReturnDetail(null)} title={returnDetail ? `${returnDetail.refund_method === 'avoir' ? 'Avoir' : 'Retour'} ${returnDetail.return_number}` : ''} size="md"
        footer={<>
          {returnDetail?.status === 'pending' && <button onClick={() => { approveReturn(returnDetail); }} className="text-sm px-3 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 font-semibold flex items-center gap-1"><CheckCircle className="w-4 h-4" />Approuver</button>}
          <button onClick={() => setReturnDetail(null)} className="btn-secondary">Fermer</button>
          <button onClick={printReturn} className="btn-primary"><Printer className="w-4 h-4" />Imprimer</button>
        </>}>
        {returnDetail && (() => {
          const isCredit = returnDetail.refund_method === 'avoir';
          const st = isCredit ? creditStatus(returnDetail) : (RETURN_STATUS[returnDetail.status] || RETURN_STATUS.pending);
          const used = Number(returnDetail.credit_used || 0);
          const balance = Number(returnDetail.total) - used;
          return (
            <div className="space-y-4">
              <div className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border ${st.pill}`}>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
                  <span className={`w-2 h-2 rounded-full ${st.dot} animate-pulse`} />{isCredit ? 'Avoir' : 'Retour'} {st.label}
                </div>
                <div className="text-[10px] font-semibold opacity-70 num">{formatDateTime(returnDetail.created_at)}</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-3 rounded-xl bg-slate-50/80 border border-slate-200/70">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Vente liée</div>
                  <div className="text-[11px] font-mono font-semibold text-slate-800 mt-1 truncate">{returnDetail.sales?.sale_number || '—'}</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50/80 border border-slate-200/70">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Client</div>
                  <div className="text-[11px] font-semibold text-slate-800 mt-1 truncate">{returnDetail.customers?.name || '—'}</div>
                </div>
                <div className={`p-3 rounded-xl border ${isCredit ? 'bg-blue-50 border-blue-200' : 'bg-red-50 border-red-200'}`}>
                  <div className={`text-[9px] font-bold uppercase tracking-wider ${isCredit ? 'text-blue-700/70' : 'text-red-700/70'}`}>{isCredit ? 'Montant initial' : 'Remboursé'}</div>
                  <div className={`text-sm font-bold mt-1 num ${isCredit ? 'text-blue-700' : 'text-red-700'}`}>{formatFCFA(returnDetail.total)}</div>
                </div>
                {isCredit ? (
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-emerald-700/70">Solde disponible</div>
                    <div className="text-sm font-bold text-emerald-700 mt-1 num">{formatFCFA(balance)}</div>
                    {used > 0 && <div className="text-[9px] text-emerald-600/70 mt-0.5 num">{formatFCFA(used)} utilisé</div>}
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-slate-50/80 border border-slate-200/70">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Remise stock</div>
                    <div className="text-[11px] font-semibold text-slate-800 mt-1">{returnDetail.restock ? 'Oui' : 'Non'}</div>
                  </div>
                )}
              </div>
              {returnDetail.reason && <div className="p-3 bg-slate-50 rounded-xl text-sm border border-slate-200/70"><span className="font-semibold">Motif :</span> {returnDetail.reason}</div>}
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Articles</div>
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
                      <div className={`num font-bold shrink-0 ${isCredit ? 'text-blue-700' : 'text-red-700'}`}>{formatFCFA(i.total)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}
      </Modal>

      {autoMode && tenant && currentSite && (
        <VehicleArticlePicker
          open={vehiclePickerOpen}
          onClose={() => setVehiclePickerOpen(false)}
          onSelect={a => {
            if (vehiclePickerTargetIdx !== null) {
              updateQuoteItem(vehiclePickerTargetIdx, 'article_id', a.id);
            } else {
              setQuoteItems(p => [...p, { article_id: a.id, name: a.name, quantity: 1, unit_price: a.sale_price, discount: 0, total: a.sale_price }]);
            }
          }}
          priceMode="sale"
          tenantId={tenant.id}
          siteId={currentSite.id}
        />
      )}
    </div>
  );
}
