import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Calculator, Loader2, Printer, Plus, X, Calendar, Filter, Check, BookOpen, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import { PageSearch } from '../components/PageSearch';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { usePermissions } from '../lib/permissions';
import { formatFCFA, formatDateTime } from '../lib/format';
import { Modal, DocPanel } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { PremiumDateRangePicker } from '../components/PremiumDateRangePicker';
import { printTicket80, printDocumentA4, buildPrintTenantForSite, type PrintTenant } from '../lib/print';
import { consumeNavContext } from '../lib/navHighlight';
import { DocSectionTitle } from '../components/DocLayout';
import { MobileInvoiceDetail } from '../components/MobileInvoiceDetail';
import { DocumentEditor, type DocLineItem, type DocHeaderForm, type DocPaymentLine } from '../components/DocumentEditor';
import { DEFAULT_DOC_SETTINGS, mergeColumns, type DocSettings } from '../components/DocumentSettingsTab';

type Sale = {
  id: string; sale_number: string; total: number; paid: number;
  status: string; created_at: string; source: string;
  user_id: string;
  cash_session_id: string | null;
  accounting_status: string;
  customers: { name: string } | null;
  sites: { name: string } | null;
  sale_payments?: { method_name: string }[];
  ipm_ventes?: { part_ipm: number; part_client: number; statut: string }[];
};

type DateRange = 'all' | 'today' | 'week' | 'month' | 'custom';

const DATE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: 'all', label: 'Toutes les dates' },
  { value: 'today', label: "Aujourd'hui" },
  { value: 'week', label: '7 derniers jours' },
  { value: 'month', label: '30 derniers jours' },
  { value: 'custom', label: 'Personnalisé' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'Tous les statuts' },
  { value: 'paid', label: 'Payée' },
  { value: 'partial', label: 'Partielle' },
  { value: 'validated', label: 'Crédit' },
  { value: 'cancelled', label: 'Annulée' },
];

function statusStyles(status: string, sale?: Sale) {
  const hasIpm = sale?.ipm_ventes && sale.ipm_ventes.length > 0;
  if (status === 'paid' && hasIpm) return { textColor: 'text-neutral-700', label: 'Réglée (IPM à recouvrer)' };
  if (status === 'paid') return { textColor: 'text-neutral-700', label: 'Payée' };
  if (status === 'cancelled') return { textColor: 'text-red-600', label: 'Annulée' };
  if (status === 'validated') return { textColor: 'text-slate-600', label: 'Crédit' };
  if (hasIpm) return { textColor: 'text-amber-600', label: 'Partielle (IPM)' };
  return { textColor: 'text-amber-600', label: 'Partielle' };
}

export function Sales({ onNavigate }: { onNavigate?: (route: string) => void }) {
  const { tenant, currentSite, dataTick } = useApp();
  const { success: toastSuccess, error: toastError } = useToast();
  const { can } = usePermissions();
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [debouncedTick, setDebouncedTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { if (dataTick === 0) return; if (tickRef.current) clearTimeout(tickRef.current); tickRef.current = setTimeout(() => setDebouncedTick(dataTick), 400); return () => { if (tickRef.current) clearTimeout(tickRef.current); }; }, [dataTick]);
  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024;
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Sale | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [pays, setPays] = useState<any[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [accounting, setAccounting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editorItems, setEditorItems] = useState<DocLineItem[]>([]);
  const [editorPayments, setEditorPayments] = useState<DocPaymentLine[]>([]);
  const [editorHeader, setEditorHeader] = useState<DocHeaderForm>({ customer_id: '', note: '', doc_date: '', delivery_date: '', reference: '', warranty: '', representative: '', imei: '', valid_until: '' });
  const [docSettings, setDocSettings] = useState<DocSettings>(DEFAULT_DOC_SETTINGS);
  const [articles, setArticles] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [editDataLoaded, setEditDataLoaded] = useState(false);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const ctx = consumeNavContext();
    if (!ctx?.highlightId) return;
    setHighlightId(ctx.highlightId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightId(null), 6800);
    return () => { if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current); };
  }, []);

  useEffect(() => {
    if (!highlightId || loading) return;
    let raf: number;
    let tries = 0;
    const tryScroll = () => {
      const el = document.querySelector(`[data-row-id="${highlightId}"]`);
      if (el) {
        el.classList.remove('waarwi-flash');
        void el.offsetWidth;
        el.classList.add('waarwi-flash');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (++tries < 20) raf = requestAnimationFrame(tryScroll);
    };
    raf = requestAnimationFrame(tryScroll);
    return () => cancelAnimationFrame(raf);
  }, [highlightId, sales, loading]);

  useEffect(() => {
    if (!tenant) return;
    supabase.from('profiles').select('id, full_name, email').eq('tenant_id', tenant.id).then(({ data }) => {
      const m: Record<string, string> = {};
      (data || []).forEach((p: any) => { m[p.id] = p.full_name || p.email || ''; });
      setProfileNames(m);
    });
  }, [tenant?.id]);

  const creatorName = (userId?: string | null) => (userId && profileNames[userId]) || 'Utilisateur non renseigné';

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Load document settings for invoice
  useEffect(() => {
    if (!tenant) return;
    supabase
      .from('document_settings')
      .select('*')
      .eq('tenant_id', tenant.id)
      .eq('doc_type', 'invoice')
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setDocSettings({
            show_delivery_date: data.show_delivery_date ?? false,
            show_reference: data.show_reference ?? false,
            show_warranty: data.show_warranty ?? false,
            show_imei: data.show_imei ?? false,
            show_representative: data.show_representative ?? false,
            default_representative: data.default_representative ?? '',
            warranty_terms: data.warranty_terms ?? '',
            require_header_lock: data.require_header_lock ?? false,
            allow_edit: data.allow_edit ?? false,
            allow_delete: data.allow_delete ?? false,
            columns_config: mergeColumns(data.columns_config ?? []),
          });
        }
      });
  }, [tenant?.id, debouncedTick]);

  useEffect(() => {
    if (!tenant || !currentSite) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('sales')
        .select('*, customers(name, phone, address), sites(name), sale_payments(method_name), ipm_ventes(part_ipm, part_client, statut)')
        .eq('tenant_id', tenant.id)
        .eq('site_id', currentSite.id)
        .order('created_at', { ascending: false })
        .limit(500);
      if (!cancelled) {
        setSales((data as any) || []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tenant?.id, currentSite?.id, debouncedTick]);

  const filtered = useMemo(() => {
    let result = sales;
    if (dateRange === 'custom') {
      if (customFrom) {
        const f = new Date(customFrom); f.setHours(0, 0, 0, 0);
        result = result.filter(s => new Date(s.created_at) >= f);
      }
      if (customTo) {
        const t = new Date(customTo); t.setHours(23, 59, 59, 999);
        result = result.filter(s => new Date(s.created_at) <= t);
      }
    } else if (dateRange !== 'all') {
      const now = new Date();
      const cutoff = new Date();
      if (dateRange === 'today') cutoff.setHours(0, 0, 0, 0);
      else if (dateRange === 'week') cutoff.setDate(now.getDate() - 7);
      else if (dateRange === 'month') cutoff.setDate(now.getDate() - 30);
      result = result.filter(s => new Date(s.created_at) >= cutoff);
    }
    if (statusFilter) result = result.filter(s => s.status === statusFilter);
    const q = search.toLowerCase().trim();
    if (q) {
      result = result.filter(s =>
        s.sale_number.toLowerCase().includes(q) ||
        (s.customers?.name || '').toLowerCase().includes(q) ||
        (s.sites?.name || '').toLowerCase().includes(q) ||
        (s.sale_payments || []).some(p => p.method_name.toLowerCase().includes(q)) ||
        String(s.total).includes(q)
      );
    }
    return result;
  }, [sales, search, statusFilter, dateRange, customFrom, customTo]);

  const openDetail = async (s: Sale) => {
    setSelected(s); setOpen(true); setItemsLoading(true);
    const [{ data: it }, { data: pp }] = await Promise.all([
      supabase.from('sale_items').select('*, articles(internal_ref, oem_ref)').eq('sale_id', s.id),
      supabase.from('sale_payments').select('*').eq('sale_id', s.id),
    ]);
    setItems(it || []); setPays(pp || []);
    setEditorItems((it || []).map((i: any) => ({ article_id: i.article_id, name: i.name, quantity: Number(i.quantity), unit_price: Number(i.unit_price), discount: Number(i.discount ?? 0), total: Number(i.total) })));
    setEditorPayments((pp || []).map((p: any) => ({ method_id: p.method_id || '', method_name: p.method_name, amount: Number(p.amount), reference: p.reference || '' })));
    const dh = (s as any).doc_header;
    setEditorHeader({ customer_id: (s as any).customer_id || '', note: '', doc_date: dh?.doc_date || s.created_at.slice(0, 10), delivery_date: dh?.delivery_date || '', reference: dh?.reference || '', warranty: dh?.warranty || '', representative: dh?.representative || '', imei: dh?.imei || '', valid_until: '' });
    setItemsLoading(false);
  };

  const closeDetail = () => { setOpen(false); setEditing(false); setSelected(null); };

  const currentIdx = selected ? filtered.findIndex(s => s.id === selected.id) : -1;
  const goPrev = () => { if (currentIdx > 0) openDetail(filtered[currentIdx - 1]); };
  const goNext = () => { if (currentIdx >= 0 && currentIdx < filtered.length - 1) openDetail(filtered[currentIdx + 1]); };

  const copyInvoiceLink = async (s: Sale) => {
    if (!s) return;
    const { data } = await supabase.from('sales').select('public_token').eq('id', s.id).maybeSingle();
    const token = (data as any)?.public_token;
    if (token) {
      const url = `${window.location.origin}/invoice/${token}`;
      navigator.clipboard?.writeText(url);
      toastSuccess('Lien copié');
    } else {
      toastError('Lien non disponible');
    }
  };

  const sendWhatsApp = (s: Sale) => {
    if (!s.customers) return;
    const msg = `Facture ${s.sale_number} - Total: ${formatFCFA(Number(s.total))}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const cancelInvoice = async (s: Sale) => {
    if (!tenant || !s) return;
    const { error: e } = await supabase.rpc('cancel_sale', { p_sale_id: s.id, p_tenant_id: tenant.id });
    if (e) { toastError(e.message); return; }
    toastSuccess('Vente annulée');
    setSales(prev => prev.map(x => x.id === s.id ? { ...x, status: 'cancelled' } : x));
    closeDetail();
  };

  const tenantForPrint: PrintTenant = buildPrintTenantForSite(tenant, currentSite);

  const printTicket = () => {
    if (!selected || !tenant) return;
    printTicket80(
      {
        sale_number: selected.sale_number,
        created_at: selected.created_at,
        total: Number(selected.total),
        discount: 0,
        items: items.map(i => ({
          name: i.name,
          supplier_ref: null,
          oem_ref: i.articles?.oem_ref ?? null,
          quantity: Number(i.quantity),
          unit_price: Number(i.unit_price),
          discount: Number(i.discount ?? 0),
        })),
        payments: pays.map(p => ({ method_name: p.method_name, amount: Number(p.amount) })),
        customer: selected.customers ? { name: selected.customers.name, phone: (selected.customers as any).phone || undefined, address: (selected.customers as any).address || undefined } : null,
        docHeader: (selected as any).doc_header ?? null,
      },
      tenantForPrint,
      creatorName(selected.user_id)
    );
  };

  const printInvoice = () => {
    if (!selected || !tenant) return;
    const printItems = items.map(i => ({
      name: i.name,
      supplier_ref: null,
      oem_ref: i.articles?.oem_ref ?? null,
      quantity: Number(i.quantity),
      unit_price: Number(i.unit_price),
      discount: Number(i.discount ?? 0),
    }));
    const subtotal = printItems.reduce((s, i) => s + i.quantity * i.unit_price - (i.discount || 0), 0);
    const paidTotal = pays.reduce((s, p) => s + Number(p.amount), 0);
    printDocumentA4({
      tenant: tenantForPrint,
      docLabel: 'FACTURE',
      docNumber: selected.sale_number,
      docDate: new Date(selected.created_at).toLocaleDateString('fr-FR'),
      docCreatedAt: selected.created_at,
      customer: selected.customers ? { name: selected.customers.name, phone: (selected.customers as any).phone || undefined, address: (selected.customers as any).address || undefined } : null,
      items: printItems,
      subtotal,
      total: Number(selected.total),
      payments: pays.map(p => ({ method_name: p.method_name, amount: Number(p.amount) })),
      paid: paidTotal,
      issuedBy: creatorName(selected.user_id),
      docHeader: (selected as any).doc_header ?? null,
    });
  };

  const todayCount = sales.filter(s => new Date(s.created_at).toDateString() === new Date().toDateString()).length;
  const todayTotal = sales
    .filter(s => new Date(s.created_at).toDateString() === new Date().toDateString())
    .reduce((sum, s) => sum + Number(s.total), 0);

  const hasFilters = search || statusFilter || dateRange !== 'all';
  const activeFilterCount = (statusFilter ? 1 : 0) + (dateRange !== 'all' ? 1 : 0);
  const clearFilters = () => { setSearch(''); setStatusFilter(''); setDateRange('all'); setCustomFrom(''); setCustomTo(''); setFiltersOpen(false); };

  const canEditSale = can('edit_invoices') && docSettings.allow_edit;
  const canDeleteSale = can('delete_invoices') && docSettings.allow_delete;
  const [editing, setEditing] = useState(false);
  const [editItems, setEditItems] = useState<any[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);

  const startEdit = async () => {
    if (!selected || !canEditSale || !tenant || !currentSite) return;
    if (isDesktop) {
      if (!editDataLoaded) {
        const [{ data: arts }, { data: custs }, { data: pms }] = await Promise.all([
          supabase.from('articles').select('id, name, internal_ref, oem_ref, sale_price').eq('tenant_id', tenant.id).eq('site_id', currentSite.id),
          supabase.from('customers').select('id, name').eq('tenant_id', tenant.id),
          supabase.from('payment_methods').select('id, name').eq('tenant_id', tenant.id),
        ]);
        setArticles(arts || []);
        setCustomers(custs || []);
        setPaymentMethods(pms || []);
        setEditDataLoaded(true);
      }
      setEditing(true);
    } else {
      setEditItems(items.map(i => ({ ...i, quantity: Number(i.quantity), unit_price: Number(i.unit_price), discount: Number(i.discount ?? 0) })));
      setEditing(true);
    }
  };

  const saveEdit = async () => {
    if (!selected || !tenant || savingEdit) return;
    if (!can('edit_invoices')) { toastError('Vous n\'avez pas la permission de modifier les ventes'); return; }
    setSavingEdit(true);
    try {
      const sourceItems = isDesktop ? editorItems : editItems;
      const payload = sourceItems.filter(i => i.name && i.name.trim()).map(i => ({
        article_id: i.article_id,
        name: i.name,
        quantity: Number(i.quantity),
        unit_price: Number(i.unit_price),
        discount: Number(i.discount ?? 0),
        vat_rate: Number(i.vat_rate ?? 0),
        imei: i.imei || null,
      }));
      const { data, error } = await supabase.rpc('update_sale_items_and_totals', {
        p_sale_id: selected.id,
        p_tenant_id: tenant.id,
        p_items: payload,
      });
      if (error) throw error;
      if (!(data as any)?.success) throw new Error((data as any)?.error || 'Erreur');
      const newTotal = Number((data as any).new_total);
      toastSuccess('Vente modifiee');
      setSelected({ ...selected, total: newTotal });
      setSales(prev => prev.map(s => s.id === selected.id ? { ...s, total: newTotal } : s));
      const updatedItems = sourceItems.map(i => ({ ...i, total: i.quantity * i.unit_price - (i.discount || 0) }));
      setItems(updatedItems);
      if (isDesktop) setEditorItems(updatedItems.map(i => ({ article_id: i.article_id, name: i.name, quantity: Number(i.quantity), unit_price: Number(i.unit_price), discount: Number(i.discount ?? 0), total: Number(i.total) })));
      setEditing(false);
    } catch (e: any) { toastError(e.message); }
    finally { setSavingEdit(false); }
  };

  const updateEditItem = (idx: number, field: string, value: any) => {
    setEditItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const removeEditItem = (idx: number) => {
    setEditItems(prev => prev.filter((_, i) => i !== idx));
  };

  const deleteSale = useCallback(async () => {
    if (!selected || !tenant || deleting) return;
    if (!can('delete_invoices')) { toastError('Vous n\'avez pas la permission de supprimer les ventes'); return; }
    setDeleting(true);
    try {
      const { data, error } = await supabase.rpc('delete_sale_and_recalculate', {
        p_sale_id: selected.id,
        p_tenant_id: tenant.id,
      });
      if (error) throw error;
      if (!(data as any)?.success) throw new Error((data as any)?.error || 'Erreur');
      toastSuccess('Vente supprimee, stock restaure');
      setSales(prev => prev.filter(s => s.id !== selected.id));
      setOpen(false);
      setConfirmDelete(false);
    } catch (e: any) { toastError(e.message); }
    finally { setDeleting(false); }
  }, [selected, tenant, deleting, can]);

  const comptabiliserVente = async () => {
    if (!selected || accounting) return;
    setAccounting(true);
    try {
      const { data, error } = await supabase.rpc('comptabiliser_vente', { p_sale_id: selected.id });
      if (error) throw error;
      if (!(data as any)?.success) throw new Error((data as any)?.error || 'Erreur inconnue');
      toastSuccess(`Comptabilisé : ${(data as any).piece_number}`);
      setSelected({ ...selected, accounting_status: 'accounted' });
      setSales(prev => prev.map(s => s.id === selected.id ? { ...s, accounting_status: 'accounted' } : s));
    } catch (e: any) { toastError(e.message); }
    finally { setAccounting(false); }
  };

  return (
    <div className="space-y-3 pb-6">
      {/* ── Page Header ───────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-5 lg:-mx-8 px-4 sm:px-5 lg:px-8 pb-3 pt-4 -mt-3 sm:-mt-4 lg:-mt-6 bg-white space-y-3 border-b border-neutral-100">

        {/* Row 1: Title */}
        <h1 className="text-lg font-bold text-neutral-900 leading-tight">Journal des ventes</h1>

        {/* Row 2: Stats */}
        <div className="flex items-center gap-3 text-[11px] font-semibold overflow-x-auto no-scrollbar whitespace-nowrap">
          <span className="shrink-0 text-neutral-500 num">{filtered.length} / {sales.length}</span>
          <span className="shrink-0 text-neutral-700 num">Aujourd'hui · {todayCount}</span>
          <span className="shrink-0 text-neutral-700 num">Total jour · {formatFCFA(todayTotal)}</span>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="shrink-0 text-neutral-500 hover:text-neutral-700 inline-flex items-center gap-1 transition-colors"
            >
              <X className="w-3 h-3" />Réinitialiser
            </button>
          )}
        </div>

        {/* Row 3: Search + Filter button */}
        <PageSearch
          value={search}
          onChange={setSearch}
          placeholder="Rechercher par N°, client, magasin, paiement…"
          rightSlot={
            <button
              onClick={() => setFiltersOpen(true)}
              className={`shrink-0 inline-flex items-center gap-1.5 pl-2 text-[12px] font-semibold transition-colors ${
                activeFilterCount > 0 ? 'text-brand-700' : 'text-neutral-500 hover:text-neutral-700'
              }`}
              title="Filtres"
            >
              <Filter className="w-4 h-4" />
              {activeFilterCount > 0 && <span className="num">{activeFilterCount}</span>}
            </button>
          }
        />
      </div>

      {/* ── List ─────────────────────────────────────────────────── */}
      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
      ) : filtered.length === 0 ? (
        <div>
          {sales.length === 0
            ? <EmptyState icon={Calculator} title="Aucune vente" description="Les ventes apparaîtront ici. Commencez par ouvrir la caisse." action={<button onClick={() => onNavigate?.('pos')} className="btn-icon-primary" title="Aller à la caisse"><Plus className="w-4 h-4" /></button>} />
            : <EmptyState icon={Calculator} title="Aucun résultat" description="Aucune vente ne correspond aux filtres sélectionnés." action={<button onClick={clearFilters} className="btn-icon" title="Réinitialiser"><X className="w-4 h-4" /></button>} />
          }
        </div>
      ) : (
        <>
          {/* ── MOBILE: list ──────────────────────────────── */}
          <div className="md:hidden count-up">
            {filtered.map(s => {
              const st = statusStyles(s.status, s);
              const payMethods = (s.sale_payments || []).map(p => p.method_name).join(', ');
              return (
                <button
                  key={s.id}
                  data-row-id={s.id}
                  onClick={() => openDetail(s)}
                  className="w-full text-left px-4 py-2.5 border-b border-neutral-100 hover:bg-neutral-50/50 transition-colors group active:scale-[0.995]"
                >
                  {/* Line 1: customer only */}
                  <div className="text-xs font-medium text-neutral-700 truncate">{s.customers?.name || 'Client comptoir'}</div>
                  {/* Line 2: invoice#, status, date */}
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[13px] font-semibold text-neutral-900 shrink-0">{s.sale_number}</span>
                    <span className={`text-[10px] font-semibold ${st.textColor} shrink-0`}>{st.label}</span>
                    {s.accounting_status === 'accounted' && <span className="text-[9px] font-bold text-neutral-500 shrink-0">C</span>}
                    <span className="text-xs text-neutral-400 shrink-0 num">{formatDateTime(s.created_at)}</span>
                  </div>
                  {/* Line 3: payment methods + amount */}
                  <div className="flex items-center gap-1 mt-1.5">
                    {payMethods && <span className="text-[10px] text-neutral-400 truncate max-w-[120px] shrink-0">{payMethods}</span>}
                    <div className="flex-1" />
                    <div className="w-px h-5 bg-neutral-200 mx-1" />
                    <span className="text-sm font-extrabold text-neutral-900 num whitespace-nowrap shrink-0">{formatFCFA(s.total)}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* ── DESKTOP: table ─────────────────────────────────── */}
          <div className="hidden md:block">
            <table className="w-full text-sm">
              <thead className="text-[9px] uppercase tracking-wider text-slate-400 font-bold border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2.5 text-left whitespace-nowrap">N° Vente</th>
                  <th className="px-4 py-2.5 text-left whitespace-nowrap">Date</th>
                  <th className="px-4 py-2.5 text-left whitespace-nowrap">Client</th>
                  <th className="px-4 py-2.5 text-left hidden lg:table-cell whitespace-nowrap">Magasin</th>
                  <th className="px-4 py-2.5 text-left hidden xl:table-cell whitespace-nowrap">Paiement</th>
                  <th className="px-4 py-2.5 text-center whitespace-nowrap">Statut</th>
                  <th className="px-4 py-2.5 text-center hidden lg:table-cell whitespace-nowrap">Compta</th>
                  <th className="px-4 py-2.5 text-right whitespace-nowrap">Total</th>
                  <th className="px-4 py-2.5 text-right w-16"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => {
                  const st = statusStyles(s.status, s);
                  return (
                    <tr key={s.id} data-row-id={s.id} className="border-b border-neutral-100 hover:bg-neutral-50/50 transition-colors cursor-pointer" onClick={() => openDetail(s)}>
                      <td className="px-4 py-1.5 doc-number text-[12px] font-bold text-neutral-700 whitespace-nowrap">{s.sale_number}</td>
                      <td className="px-4 py-1.5 text-[11px] whitespace-nowrap text-neutral-500 num">{formatDateTime(s.created_at)}</td>
                      <td className="px-4 py-1.5 text-[12px] text-neutral-700 whitespace-nowrap">{s.customers?.name || <span className="text-neutral-400">Client comptoir</span>}</td>
                      <td className="px-4 py-1.5 hidden lg:table-cell text-neutral-500 text-[11px] whitespace-nowrap">{s.sites?.name || '—'}</td>
                      <td className="px-4 py-1.5 hidden xl:table-cell text-neutral-500 text-[11px] whitespace-nowrap">
                        {(s.sale_payments || []).map(p => p.method_name).join(', ') || '—'}
                      </td>
                      <td className="px-4 py-1.5 text-center">
                        <span className={`text-[9px] font-bold uppercase tracking-wider whitespace-nowrap ${st.textColor}`}>{st.label}</span>
                      </td>
                      <td className="px-4 py-1.5 text-center hidden lg:table-cell">
                        {s.accounting_status === 'accounted' ? (
                          <span className="text-[9px] font-bold text-neutral-600">OK</span>
                        ) : (
                          <span className="text-[9px] text-neutral-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-1.5 text-right text-[12px] font-bold text-neutral-900 num whitespace-nowrap">{formatFCFA(s.total)}</td>
                      <td className="px-4 py-1.5 text-right">
                        <button
                          onClick={(e) => { e.stopPropagation(); openDetail(s); }}
                          className="text-[10px] font-semibold text-neutral-500 hover:text-brand-700 transition-colors"
                          title="Voir détail"
                        >
                          Voir
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Filters Modal ────────────────────────────────────────── */}
      <Modal open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filtres" size="sm"
        footer={<>
          <button onClick={clearFilters} className="btn-icon" title="Réinitialiser"><X className="w-4 h-4" /></button>
          <button onClick={() => setFiltersOpen(false)} className="btn-icon-primary" title="Appliquer"><Check className="w-4 h-4" /></button>
        </>}
      >
        <div className="space-y-5">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-2">
              <Calendar className="w-3.5 h-3.5" />Période
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {DATE_OPTIONS.map(o => (
                <button
                  key={o.value}
                  onClick={() => { setDateRange(o.value); if (o.value === 'custom') setPickerOpen(true); }}
                  className={`px-3 py-2.5 rounded-xl text-xs font-semibold transition-all active:scale-95 ${
                    dateRange === o.value
                      ? 'bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-glow border-transparent'
                      : 'bg-white text-neutral-700 border border-neutral-200 hover:border-brand-300 hover:bg-brand-50/50'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {dateRange === 'custom' && (customFrom || customTo) && (
              <div className="mt-2 text-[11px] text-brand-700 font-medium px-1">
                {customFrom && new Date(customFrom).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                {customFrom && customTo && ' — '}
                {customTo && new Date(customTo).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                <button onClick={() => setPickerOpen(true)} className="btn-icon" title="Modifier"><Pencil className="w-4 h-4" /></button>
              </div>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-2">
              <Filter className="w-3.5 h-3.5" />Statut
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {STATUS_OPTIONS.map(o => (
                <button
                  key={o.value}
                  onClick={() => setStatusFilter(o.value)}
                  className={`px-3 py-2.5 rounded-xl text-xs font-semibold transition-all active:scale-95 ${
                    statusFilter === o.value
                      ? 'bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-glow border-transparent'
                      : 'bg-white text-neutral-700 border border-neutral-200 hover:border-brand-300 hover:bg-brand-50/50'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      <PremiumDateRangePicker open={pickerOpen} onClose={() => setPickerOpen(false)} from={customFrom} to={customTo}
        onApply={(f, t) => { setCustomFrom(f); setCustomTo(t); setDateRange('custom'); setPickerOpen(false); }} />

      {/* ── Mobile: Full-screen invoice detail ─────────────────────── */}
      {open && !isDesktop && !editing && selected && (() => {
        const due = Math.max(0, Number(selected.total) - pays.reduce((s, p) => s + Number(p.amount), 0));
        const isCancelled = selected.status === 'cancelled';
        const isAccounted = selected.accounting_status === 'accounted';
        const dh = (selected as any).doc_header;
        return (
          <MobileInvoiceDetail
            invoice={selected}
            items={items.map(i => ({ article_id: i.article_id, name: i.name, quantity: Number(i.quantity), unit_price: Number(i.unit_price), discount: Number(i.discount ?? 0), total: Number(i.total) }))}
            payments={pays.map(p => ({ method_name: p.method_name, amount: Number(p.amount) }))}
            docHeader={dh ? { doc_date: dh.doc_date || null, reference: dh.reference || null, delivery_date: dh.delivery_date || null, warranty: dh.warranty || null, representative: dh.representative || null, imei: dh.imei || null } : { doc_date: selected.created_at.slice(0, 10) }}
            onClose={closeDetail}
            onEdit={canEditSale && !isAccounted ? startEdit : undefined}
            onPay={due > 0 && !isCancelled ? () => onNavigate?.('billing') : undefined}
            onPrint={printInvoice}
            onCopyLink={() => copyInvoiceLink(selected)}
            onWhatsApp={selected.customers ? () => sendWhatsApp(selected) : undefined}
            onComptabiliser={!isAccounted && !isCancelled ? comptabiliserVente : undefined}
            accountingBusy={accounting}
            onCancel={!isCancelled && !isAccounted ? () => cancelInvoice(selected) : undefined}
          />
        );
      })()}

      {/* ── Desktop: Full-screen DocumentEditor (view + edit mode) ─── */}
      {open && isDesktop && selected && (
        <DocumentEditor
          docType="invoice"
          mode={editing ? 'edit' : 'view'}
          articles={articles}
          customers={customers}
          headerForm={editorHeader}
          setHeaderForm={editing ? setEditorHeader : () => {}}
          items={editorItems}
          setItems={editing ? setEditorItems : () => {}}
          subtotal={editorItems.filter(i => i.name && i.name.trim()).reduce((s, i) => s + i.quantity * i.unit_price - (i.discount || 0), 0)}
          saving={savingEdit}
          onSave={saveEdit}
          onClose={editing ? () => setEditing(false) : closeDetail}
          editingId={selected.id}
          documentNumber={selected.sale_number}
          documentStatus={selected.status}
          accountingStatus={selected.accounting_status}
          invoiceDue={Math.max(0, Number(selected.total) - pays.reduce((s, p) => s + Number(p.amount), 0))}
          docSettings={docSettings}
          paymentMethods={paymentMethods}
          payments={editorPayments}
          setPayments={editing ? setEditorPayments : undefined}
          totalPaid={pays.reduce((s, p) => s + Number(p.amount), 0)}
          hasPrev={currentIdx > 0}
          hasNext={currentIdx >= 0 && currentIdx < filtered.length - 1}
          onPrev={currentIdx > 0 ? goPrev : undefined}
          onNext={currentIdx >= 0 && currentIdx < filtered.length - 1 ? goNext : undefined}
          onEdit={canEditSale && selected.accounting_status !== 'accounted' ? startEdit : undefined}
          onPay={Math.max(0, Number(selected.total) - pays.reduce((s, p) => s + Number(p.amount), 0)) > 0 && selected.status !== 'cancelled' ? () => onNavigate?.('billing') : undefined}
          onPrint={printInvoice}
          onCopyLink={() => copyInvoiceLink(selected)}
          onWhatsApp={selected.customers ? () => sendWhatsApp(selected) : undefined}
          onComptabiliser={selected.accounting_status !== 'accounted' && selected.status !== 'cancelled' ? comptabiliserVente : undefined}
          onCancel={selected.status !== 'cancelled' && selected.accounting_status !== 'accounted' ? () => cancelInvoice(selected) : undefined}
          docCreatedInfo={{ createdAt: selected.created_at, createdBy: creatorName(selected.user_id) }}
        />
      )}

      {/* ── Mobile Edit Panel (shown when editing on mobile) ────────── */}
      <DocPanel open={open && editing && !isDesktop} onClose={closeDetail} title={selected ? `Vente ${selected.sale_number}` : ''}
        footer={<>
          <button onClick={() => setEditing(false)} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
          <button onClick={saveEdit} disabled={savingEdit} className="btn-icon-primary" title="Enregistrer">
            {savingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          </button>
        </>}
      >
        {selected && (() => {
          return (
            <div className="space-y-3">
              <DocSectionTitle title="Modifier les articles" count={editItems.length} />
              <div className="space-y-2">
                {editItems.map((item, idx) => (
                  <div key={idx} className="bg-white border border-neutral-200 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-neutral-800 truncate flex-1">{item.name}</span>
                      <button onClick={() => removeEditItem(idx)} className="p-1 rounded-lg hover:bg-red-50 text-red-500" title="Retirer">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[9px] font-bold text-neutral-400 uppercase">Qte</label>
                        <input type="number" min="1" value={item.quantity}
                          onChange={e => updateEditItem(idx, 'quantity', Number(e.target.value) || 1)}
                          className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-xs font-semibold text-center focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-neutral-400 uppercase">Prix unit.</label>
                        <input type="number" min="0" value={item.unit_price}
                          onChange={e => updateEditItem(idx, 'unit_price', Number(e.target.value) || 0)}
                          className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-xs font-semibold text-right focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-neutral-400 uppercase">Remise</label>
                        <input type="number" min="0" value={item.discount}
                          onChange={e => updateEditItem(idx, 'discount', Number(e.target.value) || 0)}
                          className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-xs font-semibold text-right focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400"
                        />
                      </div>
                    </div>
                    <div className="text-right text-[11px] font-bold text-neutral-700">
                      Sous-total : {formatFCFA(item.quantity * item.unit_price - (item.discount || 0))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="bg-neutral-50 rounded-xl p-3 text-right">
                <span className="text-xs text-neutral-500">Nouveau total : </span>
                <span className="text-sm font-bold text-neutral-900">
                  {formatFCFA(editItems.reduce((s, i) => s + (i.quantity * i.unit_price - (i.discount || 0)), 0))}
                </span>
              </div>
            </div>
          );
        })()}
      </DocPanel>

      {/* Delete confirmation */}
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Confirmer la suppression" size="sm"
        footer={<>
          <button onClick={() => setConfirmDelete(false)} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
          <button onClick={deleteSale} disabled={deleting} className="btn-icon-danger-solid" title="Supprimer">
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          </button>
        </>}
      >
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-red-500" />
          </div>
          <p className="text-sm text-neutral-700 font-medium">
            Supprimer la vente <span className="font-bold">{selected?.sale_number}</span> ?
          </p>
          <p className="text-xs text-neutral-500 max-w-xs">
            Le stock sera restaure et le solde du client recalcule. Cette action est irreversible.
          </p>
        </div>
      </Modal>
    </div>
  );
}
