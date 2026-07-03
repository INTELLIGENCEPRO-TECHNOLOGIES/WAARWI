import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Calculator, Loader2, Eye, Printer, ShoppingCart, X, Calendar, Filter, Check, Scroll, User, CreditCard, BookOpen, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { usePermissions } from '../lib/permissions';
import { formatFCFA, formatDateTime } from '../lib/format';
import { Modal, DocPanel } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { PremiumDateRangePicker } from '../components/PremiumDateRangePicker';
import { printTicket80, printDocumentA4, buildPrintTenantForSite, type PrintTenant } from '../lib/print';
import { DocItems, DocTotals, DocPayments, DocSectionTitle, DocSlimHeader } from '../components/DocLayout';
import type { DocItem, DocPayment, DocStatusConfig } from '../components/DocLayout';

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
  if (status === 'paid' && hasIpm) return { pill: 'bg-neutral-100 text-neutral-700 border-neutral-300', dot: 'bg-neutral-900', label: 'Réglée (IPM à recouvrer)' };
  if (status === 'paid') return { pill: 'bg-neutral-100 text-neutral-700 border-neutral-200', dot: 'bg-neutral-900', label: 'Payée' };
  if (status === 'cancelled') return { pill: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500', label: 'Annulée' };
  if (status === 'validated') return { pill: 'bg-slate-50 text-slate-700 border-slate-200', dot: 'bg-slate-500', label: 'Crédit' };
  if (hasIpm) return { pill: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500', label: 'Partielle (IPM)' };
  return { pill: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500', label: 'Partielle' };
}

export function Sales({ onNavigate }: { onNavigate?: (route: string) => void }) {
  const { tenant, currentSite, dataTick, profile } = useApp();
  const { success: toastSuccess, error: toastError } = useToast();
  const { can } = usePermissions();
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [debouncedTick, setDebouncedTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { if (dataTick === 0) return; if (tickRef.current) clearTimeout(tickRef.current); tickRef.current = setTimeout(() => setDebouncedTick(dataTick), 400); return () => { if (tickRef.current) clearTimeout(tickRef.current); }; }, [dataTick]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Sale | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [pays, setPays] = useState<any[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [accounting, setAccounting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [docSettings, setDocSettings] = useState<{ allow_edit: boolean; allow_delete: boolean; loaded: boolean }>({ allow_edit: false, allow_delete: false, loaded: false });

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
      .select('allow_edit, allow_delete')
      .eq('tenant_id', tenant.id)
      .eq('doc_type', 'invoice')
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setDocSettings({ allow_edit: data.allow_edit ?? false, allow_delete: data.allow_delete ?? false, loaded: true });
        } else {
          setDocSettings({ allow_edit: true, allow_delete: true, loaded: true });
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
    setItemsLoading(false);
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
      profile?.full_name || profile?.email || ''
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
      issuedBy: profile?.full_name || undefined,
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

  const canEditSale = can('edit_invoices') && (docSettings.allow_edit || !docSettings.loaded);
  const canDeleteSale = can('delete_invoices') && (docSettings.allow_delete || !docSettings.loaded);
  const [editing, setEditing] = useState(false);
  const [editItems, setEditItems] = useState<any[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);

  const startEdit = () => {
    if (!selected || !canEditSale) return;
    setEditItems(items.map(i => ({ ...i, quantity: Number(i.quantity), unit_price: Number(i.unit_price), discount: Number(i.discount ?? 0) })));
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!selected || !tenant || savingEdit) return;
    if (!can('edit_invoices')) { toastError('Vous n\'avez pas la permission de modifier les ventes'); return; }
    setSavingEdit(true);
    try {
      const payload = editItems.map(i => ({
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
      setItems(editItems.map(i => ({ ...i, total: i.quantity * i.unit_price - (i.discount || 0) })));
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
      {/* ── Unified premium header ───────────────────────────────── */}
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-5 lg:-mx-8 px-3 sm:px-5 lg:px-8 pb-3 pt-3 sm:pt-4 lg:pt-6 -mt-3 sm:-mt-4 lg:-mt-6 bg-neutral-50/95 backdrop-blur-sm space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 rounded-2xl bg-white border border-neutral-200 shadow-sm hover:shadow-md focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-500/20 transition-all">
          <div className="flex items-center gap-2 pr-2 border-r border-neutral-200 shrink-0">
            <div className="leading-tight">
              <h1 className="text-sm font-bold tracking-tight text-neutral-900 leading-none">Journal des ventes</h1>
              <div className="text-[9px] font-semibold tracking-wider uppercase text-neutral-400 leading-none mt-0.5">Tickets encaissés</div>
            </div>
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="N°, client, magasin, paiement…"
            className="flex-1 min-w-0 w-0 bg-transparent text-xs focus:outline-none placeholder:text-neutral-400"
          />
          {search && (
            <button onClick={() => setSearch('')} className="shrink-0 p-1 text-neutral-400 hover:text-neutral-600 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => setFiltersOpen(true)}
            className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-all ${
              activeFilterCount > 0
                ? 'bg-brand-50 text-brand-700 border border-brand-200'
                : 'bg-neutral-50 text-neutral-500 border border-neutral-200 hover:bg-neutral-100'
            }`}
            title="Filtres"
          >
            <Filter className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Filtres</span>
            {activeFilterCount > 0 && <span className="num">· {activeFilterCount}</span>}
          </button>
          <button
            onClick={() => onNavigate?.('pos')}
            className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center shadow-glow hover:shadow-premium active:scale-95 transition-all"
            style={{ background: 'linear-gradient(135deg, #262626 0%, #0a0a0a 100%)' }}
            aria-label="Nouvelle vente"
          >
            <ShoppingCart className="w-3.5 h-3.5 text-white" />
          </button>
        </div>
      </div>

      {/* ── Inline stats chips ───────────────────────────────────── */}
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider overflow-x-auto no-scrollbar whitespace-nowrap">
        <span className="shrink-0 px-2 py-1 rounded-full bg-neutral-100 text-neutral-600 num">{filtered.length} / {sales.length}</span>
        <span className="shrink-0 px-2 py-1 rounded-full bg-neutral-100 text-neutral-700 inline-flex items-center gap-1 num">
          <span className="w-1.5 h-1.5 rounded-full bg-neutral-900" />Aujourd'hui · {todayCount}
        </span>
        <span className="shrink-0 px-2 py-1 rounded-full bg-neutral-50 text-neutral-700 border border-neutral-200 num">Total jour · {formatFCFA(todayTotal)}</span>
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="shrink-0 px-2 py-1 rounded-full bg-white text-neutral-500 border border-neutral-200 hover:bg-neutral-100 inline-flex items-center gap-1 transition-all"
          >
            <X className="w-3 h-3" />Réinitialiser
          </button>
        )}
        <button
          onClick={() => onNavigate?.('pos')}
          className="shrink-0 ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-glow hover:shadow-lg transition-all active:scale-95"
        >
          <ShoppingCart className="w-3.5 h-3.5" />Nouvelle vente
        </button>
      </div>
      </div>

      {/* ── List ─────────────────────────────────────────────────── */}
      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
      ) : filtered.length === 0 ? (
        <div className="card-premium">
          {sales.length === 0
            ? <EmptyState icon={Calculator} title="Aucune vente" description="Les ventes apparaîtront ici. Commencez par ouvrir la caisse." action={<button onClick={() => onNavigate?.('pos')} className="btn-primary"><ShoppingCart className="w-4 h-4" />Aller à la caisse</button>} />
            : <EmptyState icon={Calculator} title="Aucun résultat" description="Aucune vente ne correspond aux filtres sélectionnés." action={<button onClick={clearFilters} className="btn-secondary"><X className="w-4 h-4" />Réinitialiser</button>} />
          }
        </div>
      ) : (
        <>
          {/* ── MOBILE: card list ──────────────────────────────── */}
          <div className="md:hidden space-y-2 count-up">
            {filtered.map(s => {
              const st = statusStyles(s.status, s);
              const payMethods = (s.sale_payments || []).map(p => p.method_name).join(', ');
              return (
                <button
                  key={s.id}
                  onClick={() => openDetail(s)}
                  className="w-full text-left card-premium p-3 flex flex-col gap-2 hover:border-brand-400 transition-all duration-300 group active:scale-[0.99]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[11px] font-bold text-neutral-700 truncate">{s.sale_number}</span>
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider border ${st.pill}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{st.label}
                        </span>
                        {s.accounting_status === 'accounted' && <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-neutral-100 text-neutral-700 border border-neutral-200">C</span>}
                      </div>
                      <div className="text-[10px] text-neutral-400 mt-0.5 num">{formatDateTime(s.created_at)}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-neutral-400">Total</div>
                      <div className="text-sm font-bold text-neutral-900 num leading-tight mt-0.5">{formatFCFA(s.total)}</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-neutral-100">
                    <div className="min-w-0 flex items-center gap-1.5 text-[11px] text-neutral-600 truncate">
                      <User className="w-3 h-3 text-neutral-400 shrink-0" />
                      <span className="truncate">{s.customers?.name || 'Client comptoir'}</span>
                    </div>
                    {payMethods && (
                      <div className="flex items-center gap-1 text-[10px] text-neutral-500 shrink-0">
                        <CreditCard className="w-3 h-3 text-neutral-400" /><span className="truncate max-w-[90px]">{payMethods}</span>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* ── DESKTOP: table ─────────────────────────────────── */}
          <div className="hidden md:block card-premium overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-neutral-50/90 backdrop-blur text-[10px] uppercase tracking-wider text-neutral-500 font-bold">
                  <tr>
                    <th className="px-4 py-3 text-left">N° Vente</th>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Client</th>
                    <th className="px-4 py-3 text-left hidden lg:table-cell">Magasin</th>
                    <th className="px-4 py-3 text-left hidden xl:table-cell">Paiement</th>
                    <th className="px-4 py-3 text-center">Statut</th>
                    <th className="px-4 py-3 text-center hidden lg:table-cell">Compta</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right w-16">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filtered.map(s => {
                    const st = statusStyles(s.status, s);
                    return (
                      <tr key={s.id} className="hover:bg-brand-50/40 transition-colors cursor-pointer" onClick={() => openDetail(s)}>
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-neutral-700">{s.sale_number}</td>
                        <td className="px-4 py-3 text-xs whitespace-nowrap text-neutral-500 num">{formatDateTime(s.created_at)}</td>
                        <td className="px-4 py-3 text-neutral-700">{s.customers?.name || <span className="text-neutral-400">Client comptoir</span>}</td>
                        <td className="px-4 py-3 hidden lg:table-cell text-neutral-500 text-xs">{s.sites?.name || '—'}</td>
                        <td className="px-4 py-3 hidden xl:table-cell text-neutral-500 text-xs">
                          {(s.sale_payments || []).map(p => p.method_name).join(', ') || '—'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${st.pill}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{st.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center hidden lg:table-cell">
                          {s.accounting_status === 'accounted' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-neutral-100 text-neutral-700 border border-neutral-200"><BookOpen className="w-3 h-3" />OK</span>
                          ) : (
                            <span className="text-[10px] text-neutral-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-neutral-900 num whitespace-nowrap">{formatFCFA(s.total)}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={(e) => { e.stopPropagation(); openDetail(s); }}
                            className="p-1.5 rounded-lg hover:bg-white hover:shadow-sm text-neutral-500 hover:text-brand-700 transition-all"
                            title="Voir détail"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
                <button onClick={() => setPickerOpen(true)} className="ml-2 underline">Modifier</button>
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

      {/* ── Detail Modal ─────────────────────────────────────────── */}
      <DocPanel open={open} onClose={() => { setOpen(false); setEditing(false); }} title={selected ? `Vente ${selected.sale_number}` : ''}
        footer={<>
          <button onClick={() => { setOpen(false); setEditing(false); }} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>
          {selected && canDeleteSale && selected.accounting_status !== 'accounted' && !editing && (
            <button onClick={() => setConfirmDelete(true)} className="btn-icon text-red-600 hover:bg-red-50" title="Supprimer">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          {selected && canEditSale && selected.accounting_status !== 'accounted' && !editing && (
            <button onClick={startEdit} className="btn-icon text-neutral-700 hover:bg-neutral-50" title="Modifier">
              <Pencil className="w-4 h-4" />
            </button>
          )}
          {editing && (
            <>
              <button onClick={() => setEditing(false)} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
              <button onClick={saveEdit} disabled={savingEdit} className="btn-icon-primary" title="Enregistrer">
                {savingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              </button>
            </>
          )}
          {!editing && selected && selected.accounting_status !== 'accounted' && selected.status !== 'cancelled' && (
            <button onClick={comptabiliserVente} disabled={accounting} className="btn-icon text-neutral-700 hover:bg-neutral-100" title="Comptabiliser">
              {accounting ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4" />}
            </button>
          )}
          {!editing && selected && selected.accounting_status === 'accounted' && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-neutral-100 text-neutral-700 border border-neutral-200"><BookOpen className="w-3 h-3" />Comptabilise</span>
          )}
          {!editing && <button onClick={printTicket} className="btn-icon" title="Ticket 80mm"><Scroll className="w-4 h-4" /></button>}
          {!editing && <button onClick={printInvoice} className="btn-icon-primary" title="Facture A4"><Printer className="w-4 h-4" /></button>}
        </>}
      >
        {selected && (() => {
          const st = statusStyles(selected.status, selected);
          const hasIpm = selected.ipm_ventes && selected.ipm_ventes.length > 0;
          const slimStatus: DocStatusConfig = {
            label: st.label,
            color: selected.status === 'paid' ? (hasIpm ? 'teal' : 'emerald') : selected.status === 'cancelled' ? 'rose' : selected.status === 'validated' ? 'slate' : 'amber',
          };
          return (
            <div className="space-y-4">
              <DocSlimHeader
                status={slimStatus}
                customerName={selected.customers?.name ?? null}
                date={formatDateTime(selected.created_at)}
                docHeader={(selected as any).doc_header ? { ...(selected as any).doc_header, created_at: selected.created_at } : null}
              />

              {itemsLoading ? (
                <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-brand-700" /></div>
              ) : editing ? (
                /* ── EDIT MODE ── */
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
              ) : (
                <>
                  {/* Articles */}
                  <div className="space-y-2">
                    <DocSectionTitle title="Articles" count={items.length} />
                    <DocItems items={items.map(i => ({
                      id: i.id,
                      name: i.name,
                      internal_ref: i.articles?.internal_ref || i.internal_ref || null,
                      oem_ref: i.articles?.oem_ref || null,
                      quantity: Number(i.quantity),
                      unit_price: Number(i.unit_price),
                      discount: Number(i.discount ?? 0),
                      total: Number(i.total),
                    }) satisfies DocItem)} />
                  </div>

                  {/* Totaux */}
                  {(() => {
                    const subtotal = items.reduce((s, i) => s + Number(i.total), 0);
                    const paidTotal = pays.reduce((s, p) => s + Number(p.amount), 0);
                    const due = Math.max(0, Number(selected.total) - paidTotal);
                    return (
                      <DocTotals
                        subtotal={subtotal}
                        total={Number(selected.total)}
                        paid={paidTotal > 0 ? paidTotal : undefined}
                        remaining={due > 0 ? due : undefined}
                      />
                    );
                  })()}

                  {/* Paiements */}
                  {pays.length > 0 && (
                    <div className="space-y-2">
                      <DocSectionTitle title="Paiements" count={pays.length} />
                      <DocPayments payments={pays.map(p => ({ method_name: p.method_name, amount: Number(p.amount) }) satisfies DocPayment)} />
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })()}
      </DocPanel>

      {/* Delete confirmation */}
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Confirmer la suppression" size="sm"
        footer={<>
          <button onClick={() => setConfirmDelete(false)} className="btn-secondary text-sm">Annuler</button>
          <button onClick={deleteSale} disabled={deleting} className="btn-primary bg-red-600 hover:bg-red-700 text-sm flex items-center gap-2">
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Supprimer
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
