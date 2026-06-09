import { useEffect, useMemo, useState } from 'react';
import { Calculator, Loader2, Eye, Printer, ShoppingCart, X, Calendar, Filter, Check, Scroll, User, CreditCard, BookOpen } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { formatFCFA, formatDateTime } from '../lib/format';
import { Modal, DocPanel } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { PremiumDateRangePicker } from '../components/PremiumDateRangePicker';
import { printTicket80, printDocumentA4, type PrintTenant } from '../lib/print';
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

function statusStyles(status: string) {
  if (status === 'paid') return { pill: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500', label: 'Payée' };
  if (status === 'cancelled') return { pill: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500', label: 'Annulée' };
  if (status === 'validated') return { pill: 'bg-sky-50 text-sky-700 border-sky-200', dot: 'bg-sky-500', label: 'Crédit' };
  return { pill: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500', label: 'Partielle' };
}

export function Sales({ onNavigate }: { onNavigate?: (route: string) => void }) {
  const { tenant, currentSite, dataTick, profile } = useApp();
  const { success: toastSuccess, error: toastError } = useToast();
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Sale | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [pays, setPays] = useState<any[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [accounting, setAccounting] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    if (!tenant || !currentSite) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('sales')
        .select('*, customers(name, phone, address), sites(name), sale_payments(method_name), accounting_status')
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
  }, [tenant?.id, currentSite?.id, dataTick]);

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

  const tenantForPrint: PrintTenant = {
    name: tenant?.name || '',
    legal_name: (tenant as any)?.legal_name,
    ninea: (tenant as any)?.ninea,
    rccm: (tenant as any)?.rccm,
    address: (tenant as any)?.address,
    phone: (tenant as any)?.phone,
    email: (tenant as any)?.email,
    website: (tenant as any)?.website,
    logo_url: (tenant as any)?.logo_url,
    business_type: (tenant as any)?.business_type,
  };

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
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-5 lg:-mx-8 px-3 sm:px-5 lg:px-8 pb-3 pt-3 sm:pt-4 lg:pt-6 -mt-3 sm:-mt-4 lg:-mt-6 bg-slate-50/95 backdrop-blur-sm space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 rounded-2xl bg-white border border-slate-200 shadow-sm hover:shadow-md focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-500/20 transition-all">
          <div className="flex items-center gap-2 pr-2 border-r border-slate-200 shrink-0">
            <div className="leading-tight">
              <h1 className="text-sm font-bold tracking-tight text-slate-900 leading-none">Journal des ventes</h1>
              <div className="text-[9px] font-semibold tracking-wider uppercase text-slate-400 leading-none mt-0.5">Tickets encaissés</div>
            </div>
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="N°, client, magasin, paiement…"
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
              activeFilterCount > 0
                ? 'bg-brand-50 text-brand-700 border border-brand-200'
                : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100'
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
            style={{ background: 'linear-gradient(135deg, #0f766e 0%, #064e3b 100%)' }}
            aria-label="Nouvelle vente"
          >
            <ShoppingCart className="w-3.5 h-3.5 text-white" />
          </button>
        </div>
      </div>

      {/* ── Inline stats chips ───────────────────────────────────── */}
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider overflow-x-auto no-scrollbar whitespace-nowrap">
        <span className="shrink-0 px-2 py-1 rounded-full bg-slate-100 text-slate-600 num">{filtered.length} / {sales.length}</span>
        <span className="shrink-0 px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 inline-flex items-center gap-1 num">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Aujourd'hui · {todayCount}
        </span>
        <span className="shrink-0 px-2 py-1 rounded-full bg-slate-50 text-slate-700 border border-slate-200 num">Total jour · {formatFCFA(todayTotal)}</span>
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="shrink-0 px-2 py-1 rounded-full bg-white text-slate-500 border border-slate-200 hover:bg-slate-100 inline-flex items-center gap-1 transition-all"
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
              const st = statusStyles(s.status);
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
                        <span className="font-mono text-[11px] font-bold text-slate-700 truncate">{s.sale_number}</span>
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider border ${st.pill}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{st.label}
                        </span>
                        {s.accounting_status === 'accounted' && <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-teal-50 text-teal-700 border border-teal-200">C</span>}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5 num">{formatDateTime(s.created_at)}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Total</div>
                      <div className="text-sm font-bold text-slate-900 num leading-tight mt-0.5">{formatFCFA(s.total)}</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-100">
                    <div className="min-w-0 flex items-center gap-1.5 text-[11px] text-slate-600 truncate">
                      <User className="w-3 h-3 text-slate-400 shrink-0" />
                      <span className="truncate">{s.customers?.name || 'Client comptoir'}</span>
                    </div>
                    {payMethods && (
                      <div className="flex items-center gap-1 text-[10px] text-slate-500 shrink-0">
                        <CreditCard className="w-3 h-3 text-slate-400" /><span className="truncate max-w-[90px]">{payMethods}</span>
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
                <thead className="sticky top-0 bg-slate-50/90 backdrop-blur text-[10px] uppercase tracking-wider text-slate-500 font-bold">
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
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(s => {
                    const st = statusStyles(s.status);
                    return (
                      <tr key={s.id} className="hover:bg-brand-50/40 transition-colors cursor-pointer" onClick={() => openDetail(s)}>
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700">{s.sale_number}</td>
                        <td className="px-4 py-3 text-xs whitespace-nowrap text-slate-500 num">{formatDateTime(s.created_at)}</td>
                        <td className="px-4 py-3 text-slate-700">{s.customers?.name || <span className="text-slate-400">Client comptoir</span>}</td>
                        <td className="px-4 py-3 hidden lg:table-cell text-slate-500 text-xs">{s.sites?.name || '—'}</td>
                        <td className="px-4 py-3 hidden xl:table-cell text-slate-500 text-xs">
                          {(s.sale_payments || []).map(p => p.method_name).join(', ') || '—'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${st.pill}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{st.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center hidden lg:table-cell">
                          {s.accounting_status === 'accounted' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-teal-50 text-teal-700 border border-teal-200"><BookOpen className="w-3 h-3" />OK</span>
                          ) : (
                            <span className="text-[10px] text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-slate-900 num whitespace-nowrap">{formatFCFA(s.total)}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={(e) => { e.stopPropagation(); openDetail(s); }}
                            className="p-1.5 rounded-lg hover:bg-white hover:shadow-sm text-slate-500 hover:text-brand-700 transition-all"
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
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
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
                      : 'bg-white text-slate-700 border border-slate-200 hover:border-brand-300 hover:bg-brand-50/50'
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
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
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
                      : 'bg-white text-slate-700 border border-slate-200 hover:border-brand-300 hover:bg-brand-50/50'
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
      <DocPanel open={open} onClose={() => setOpen(false)} title={selected ? `Vente ${selected.sale_number}` : ''}
        footer={<>
          <button onClick={() => setOpen(false)} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>
          {selected && selected.accounting_status !== 'accounted' && selected.status !== 'cancelled' && (
            <button onClick={comptabiliserVente} disabled={accounting} className="btn-icon text-teal-700 hover:bg-teal-50" title="Comptabiliser">
              {accounting ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4" />}
            </button>
          )}
          {selected && selected.accounting_status === 'accounted' && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-teal-50 text-teal-700 border border-teal-200"><BookOpen className="w-3 h-3" />Comptabilisé</span>
          )}
          <button onClick={printTicket} className="btn-icon" title="Ticket 80mm"><Scroll className="w-4 h-4" /></button>
          <button onClick={printInvoice} className="btn-icon-primary" title="Facture A4"><Printer className="w-4 h-4" /></button>
        </>}
      >
        {selected && (() => {
          const st = statusStyles(selected.status);
          const slimStatus: DocStatusConfig = {
            label: st.label,
            color: selected.status === 'paid' ? 'emerald' : selected.status === 'cancelled' ? 'rose' : selected.status === 'validated' ? 'blue' : 'amber',
          };
          return (
            <div className="space-y-4">
              <DocSlimHeader
                status={slimStatus}
                customerName={selected.customers?.name ?? null}
                date={formatDateTime(selected.created_at)}
              />

              {itemsLoading ? (
                <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-brand-700" /></div>
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
    </div>
  );
}
