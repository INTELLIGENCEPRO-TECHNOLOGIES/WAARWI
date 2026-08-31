import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock, Loader2, X, Printer, Check, Wallet, ArrowDownRight, ArrowUpRight, Calendar, ChevronRight, CreditCard, Package, HandCoins, RotateCcw, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { formatFCFA, formatDateTime } from '../lib/format';
import { Modal } from '../components/Modal';
import { CashModal } from '../components/CashModal';
import { EmptyState } from '../components/EmptyState';
import { PremiumDateRangePicker } from '../components/PremiumDateRangePicker';
import { printXReport80, buildPrintTenantForSite } from '../lib/print';
import { consumeNavContext } from '../lib/navHighlight';

const tap = () => { if (navigator.vibrate) navigator.vibrate(8); };

type SessionRow = {
  id: string;
  tenant_id: string;
  site_id: string;
  user_id: string;
  opened_at: string;
  closed_at: string | null;
  opening_amount: number;
  closing_amount: number | null;
  counted_cash: number | null;
  theoretical_amount: number | null;
  variance: number | null;
  status: string;
  opening_note: string;
  closing_note: string;
  site_name?: string;
  cashier_name?: string;
};

type InvoicePayment = {
  id: string; amount: number; method_name: string; created_at: string; reference: string;
  sale_number: string; customer_name: string | null; sale_date: string;
};

type CashMovementRow = {
  id: string; kind: 'expense' | 'income' | 'customer_prepayment' | 'customer_withdrawal' | 'customer_loan' | 'refund';
  amount: number; reason: string; note: string; reference: string;
  method_name: string; customer_name: string | null; supplier_name: string | null; created_at: string;
};

type SessionDetail = {
  session: SessionRow;
  sales: { id: string; sale_number: string; total: number; created_at: string; customer_name: string | null }[];
  cancelledSales: { id: string; sale_number: string; total: number; created_at: string; customer_name: string | null }[];
  controls: { method_name: string; theoretical_amount: number; counted_amount: number; difference_amount: number }[];
  regularizations: { reg_type: string; amount: number; reason: string; note: string; created_at: string }[];
  byMethod: { method_name: string; amount: number }[];
  invoicePayments: InvoicePayment[];
  movements: CashMovementRow[];
};

export function CashHistory() {
  const { tenant, currentSite, profile, dataTick } = useApp();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailExpanded, setDetailExpanded] = useState<'modes' | 'reglements' | 'encDirect' | 'acomptes' | 'depenses' | 'remboursements' | 'retraits' | 'prets' | 'ventes' | 'controle' | null>(null);
  const [highlightSessionId, setHighlightSessionId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const ctx = consumeNavContext();
    if (!ctx?.highlightId) return;
    (async () => {
      const { data } = await supabase.from('cash_movements').select('cash_session_id').eq('id', ctx.highlightId).maybeSingle();
      if (data?.cash_session_id) {
        setHighlightSessionId(data.cash_session_id);
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = setTimeout(() => setHighlightSessionId(null), 6800);
      }
    })();
    return () => { if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current); };
  }, []);

  useEffect(() => {
    if (!highlightSessionId || loading) return;
    let raf: number;
    let tries = 0;
    const tryScroll = () => {
      const el = document.querySelector(`[data-row-id="${highlightSessionId}"]`);
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
  }, [highlightSessionId, sessions, loading]);

  const load = async (silent = false) => {
    if (!tenant || !currentSite) return;
    if (!silent) setLoading(true);
    const { data } = await supabase
      .from('cash_sessions')
      .select('id, opening_amount, theoretical_amount, counted_cash, opened_at, closed_at, closing_amount, variance, status, user_id, site_id, tenant_id')
      .eq('tenant_id', tenant.id)
      .eq('site_id', currentSite.id)
      .order('opened_at', { ascending: false })
      .limit(200);
    setSessions((data || []) as any);
    if (!silent) setLoading(false);
  };

  useEffect(() => { load(); }, [tenant?.id, currentSite?.id]);
  useEffect(() => { if (dataTick > 0) { const t = setTimeout(() => load(true), 400); return () => clearTimeout(t); } }, [dataTick]);

  const filtered = useMemo(() => {
    let r = sessions;
    if (dateFrom) {
      const f = new Date(dateFrom); f.setHours(0, 0, 0, 0);
      r = r.filter(s => new Date(s.opened_at) >= f);
    }
    if (dateTo) {
      const t = new Date(dateTo); t.setHours(23, 59, 59, 999);
      r = r.filter(s => new Date(s.opened_at) <= t);
    }
    const q = search.toLowerCase().trim();
    if (!q) return r;
    return r.filter(s =>
      s.id.toLowerCase().includes(q) ||
      (s.cashier_name || '').toLowerCase().includes(q) ||
      (s.site_name || '').toLowerCase().includes(q)
    );
  }, [sessions, search, dateFrom, dateTo]);

  const openDetail = async (s: SessionRow) => {
    setDetail(null); setDetailOpen(true); setLoadingDetail(true); setDetailExpanded(null);
    const [{ data: salesData }, { data: cancelledData }, { data: ctrlData }, { data: regData }, { data: pmtData }, { data: mvData }] = await Promise.all([
      supabase.from('sales').select('id, sale_number, total, created_at, customers(name)').eq('tenant_id', tenant!.id).eq('cash_session_id', s.id).in('status', ['paid', 'partial', 'validated']).order('created_at'),
      supabase.from('sales').select('id, sale_number, total, created_at, customers(name)').eq('tenant_id', tenant!.id).eq('cash_session_id', s.id).eq('status', 'cancelled').order('created_at'),
      supabase.from('cash_control_lines').select('method_name, theoretical_amount, counted_amount, difference_amount').eq('tenant_id', tenant!.id).eq('cash_session_id', s.id),
      supabase.from('cash_regularizations').select('reg_type, amount, reason, note, created_at').eq('tenant_id', tenant!.id).eq('cash_session_id', s.id).order('created_at'),
      supabase.from('sale_payments').select('id, method_name, amount, reference, created_at, sale_id, sales(sale_number, created_at, cash_session_id, customers(name))').eq('tenant_id', tenant!.id).eq('cash_session_id', s.id),
      supabase.from('cash_movements').select('id, kind, amount, reason, note, reference, method_name, created_at, customers(name), suppliers(name)').eq('tenant_id', tenant!.id).eq('cash_session_id', s.id).order('created_at'),
    ]);
    const byMethodMap: Record<string, number> = {};
    (pmtData || []).forEach((p: any) => { byMethodMap[p.method_name] = (byMethodMap[p.method_name] || 0) + Number(p.amount); });
    (mvData || []).forEach((m: any) => {
      if (m.kind !== 'income' && m.kind !== 'customer_prepayment') return;
      const isReglement = m.kind === 'income' && (m.reason || '').startsWith('Règlement ') && !m.reason.startsWith('Règlement solde');
      if (isReglement) return;
      const method = m.method_name || 'Espèces';
      byMethodMap[method] = (byMethodMap[method] || 0) + Number(m.amount);
    });
    const invoicePayments: InvoicePayment[] = (pmtData || [])
      .filter((p: any) => (p.reference && p.reference.startsWith('Règlement ')) || !p.sales || p.sales.cash_session_id !== s.id)
      .map((p: any) => ({
        id: p.id, amount: Number(p.amount), method_name: p.method_name,
        created_at: p.created_at, reference: p.reference || '',
        sale_number: p.sales?.sale_number || '',
        customer_name: p.sales?.customers?.name || null,
        sale_date: p.sales?.created_at || '',
      }))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const allMovements = (mvData || []).map((m: any) => ({
      id: m.id, kind: (m.kind as string) as CashMovementRow['kind'], amount: Number(m.amount),
      reason: m.reason || '', note: m.note || '', reference: m.reference || '',
      method_name: m.method_name || '',
      customer_name: m.customers?.name || null,
      supplier_name: m.suppliers?.name || null,
      created_at: m.created_at,
    }));
    const movements = allMovements.filter(m =>
      !(m.kind === 'income' && m.reason.startsWith('Règlement ') && !m.reason.startsWith('Règlement solde'))
    );
    setDetail({
      session: s,
      sales: (salesData || []).map((x: any) => ({ id: x.id, sale_number: x.sale_number, total: Number(x.total), created_at: x.created_at, customer_name: x.customers?.name || null })),
      cancelledSales: (cancelledData || []).map((x: any) => ({ id: x.id, sale_number: x.sale_number, total: Number(x.total), created_at: x.created_at, customer_name: x.customers?.name || null })),
      controls: ctrlData || [],
      regularizations: regData || [],
      byMethod: Object.entries(byMethodMap).map(([method_name, amount]) => ({ method_name, amount })),
      invoicePayments,
      movements,
    });
    setLoadingDetail(false);
  };

  const printReport = (d: SessionDetail) => {
    const byMethodTotal = d.byMethod.reduce((s, m) => s + m.amount, 0);
    printXReport80({
      tenant: buildPrintTenantForSite(tenant, currentSite),
      cashier: d.session.cashier_name || profile?.full_name || profile?.email || '',
      siteName: d.session.site_name || currentSite?.name || '',
      sessionId: d.session.id,
      openedAt: d.session.opened_at,
      closedAt: d.session.closed_at,
      openingAmount: Number(d.session.opening_amount),
      salesCount: d.sales.length,
      salesTotal: byMethodTotal,
      byMethod: d.byMethod,
      movements: d.movements,
      controls: d.controls.map(c => ({
        method_name: c.method_name,
        theoretical_amount: Number(c.theoretical_amount),
        counted_amount: Number(c.counted_amount),
        difference_amount: Number(c.difference_amount),
      })),
      regularizations: d.regularizations,
    });
  };

  const stats = useMemo(() => {
    const open = sessions.filter(s => s.status === 'open').length;
    const closed = sessions.filter(s => s.status === 'closed').length;
    const variances = sessions.filter(s => s.variance != null && Number(s.variance) !== 0).length;
    return { open, closed, variances };
  }, [sessions]);

  const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '';
  const dateLabel = dateFrom && dateTo ? `${fmtDate(dateFrom)} → ${fmtDate(dateTo)}` : dateFrom ? `Depuis ${fmtDate(dateFrom)}` : dateTo ? `Jusqu'au ${fmtDate(dateTo)}` : 'Période';

  return (
    <div className="space-y-3">
      {/* Premium unified search bar with embedded title + date picker */}
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-5 lg:-mx-8 px-4 sm:px-5 lg:px-8 pb-3 pt-4 -mt-3 sm:-mt-4 lg:-mt-6 bg-white space-y-3 border-b border-neutral-100">
        <h1 className="text-lg font-bold text-neutral-900 leading-tight">Caisse</h1>
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-neutral-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher…" className="bare-input w-full text-sm py-1.5" />
            <div className="h-px bg-neutral-200 mt-1" />
          </div>
          {search && <button onClick={() => setSearch('')} className="shrink-0 p-1 text-neutral-400 hover:text-neutral-600 transition-colors"><X className="w-4 h-4" /></button>}
          <button onClick={() => setPickerOpen(true)} className={`shrink-0 inline-flex items-center gap-1.5 text-[12px] font-semibold transition-colors ${dateFrom || dateTo ? 'text-brand-700' : 'text-neutral-500 hover:text-neutral-700'}`}>
            <Calendar className="w-4 h-4" />
            <span className="hidden md:inline max-w-[120px] truncate">{dateLabel}</span>
          </button>
        </div>
      </div>

      {/* Inline stats chips */}
      <div className="flex items-center gap-3 text-[11px] font-semibold overflow-x-auto no-scrollbar whitespace-nowrap mt-3">
        <span className="shrink-0 text-neutral-500 num">{filtered.length} / {sessions.length}</span>
        {stats.open > 0 && <span className="shrink-0 text-neutral-700 num">{stats.open} ouverte{stats.open > 1 ? 's' : ''}</span>}
        {stats.closed > 0 && <span className="shrink-0 text-neutral-600 num">{stats.closed} clôturée{stats.closed > 1 ? 's' : ''}</span>}
        {stats.variances > 0 && <span className="shrink-0 text-amber-600 num">{stats.variances} écart{stats.variances > 1 ? 's' : ''}</span>}
        {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="shrink-0 text-neutral-500 hover:text-neutral-700 inline-flex items-center gap-1 transition-all" title="Effacer"><X className="w-3 h-3" />Réinitialiser</button>}
      </div>

      <PremiumDateRangePicker open={pickerOpen} onClose={() => setPickerOpen(false)} from={dateFrom} to={dateTo} onApply={(f, t) => { setDateFrom(f); setDateTo(t); setPickerOpen(false); }} />

      {/* MOBILE: cards / DESKTOP: list */}
      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Clock} title="Aucune session" description="Les sessions de caisse apparaîtront ici après ouverture." />
      ) : (
        <>
          {/* MOBILE: flat list */}
          <div className="md:hidden divide-y divide-neutral-100">
            {filtered.map(s => {
              const variance = s.variance != null ? Number(s.variance) : null;
              const isOpen = s.status === 'open';
              const balanced = variance === 0;
              const opened = new Date(s.opened_at);
              const closed = s.closed_at ? new Date(s.closed_at) : null;
              const duration = closed ? Math.round((closed.getTime() - opened.getTime()) / 60000) : null;
              return (
                <button key={s.id} data-row-id={s.id} onClick={() => openDetail(s)} className="w-full text-left px-2 py-3 flex flex-col gap-1.5 active:bg-neutral-50 transition-colors">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-bold tracking-wider text-neutral-800">#{s.id.slice(0, 8).toUpperCase()}</span>
                        <span className={`text-[9px] font-bold uppercase tracking-wider ${isOpen ? 'text-neutral-700' : 'text-neutral-400'}`}>{isOpen ? 'Ouverte' : 'Clôturée'}</span>
                      </div>
                      <div className="text-[10px] text-neutral-500 num leading-tight mt-0.5 truncate">
                        {opened.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} · {opened.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        {closed && <>→{closed.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</>}
                        {duration != null && <span className="text-neutral-400"> · {duration > 60 ? `${Math.floor(duration / 60)}h${duration % 60}` : `${duration}m`}</span>}
                      </div>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-neutral-300 shrink-0" />
                  </div>
                  <div className="grid grid-cols-3 gap-1 pt-1">
                    <div className="flex flex-col items-start">
                      <span className="text-[9px] text-neutral-400">Fond</span>
                      <span className="text-[11px] font-bold text-neutral-800 num">{formatFCFA(s.opening_amount)}</span>
                    </div>
                    <div className="flex flex-col items-center">
                      <span className="text-[9px] text-neutral-400">Compté</span>
                      <span className="text-[11px] font-bold text-neutral-800 num">{s.counted_cash != null ? formatFCFA(s.counted_cash) : '—'}</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[9px] text-neutral-400">Écart</span>
                      {variance != null ? (
                        <span className={`text-[11px] font-bold num ${balanced ? 'text-neutral-600' : variance < 0 ? 'text-red-600' : 'text-amber-600'}`}>
                          {balanced ? 'OK' : `${variance > 0 ? '+' : ''}${formatFCFA(Math.abs(variance))}`}
                        </span>
                      ) : <span className="text-[11px] text-neutral-400">—</span>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* DESKTOP: list */}
          <div className="hidden md:block">
            <table className="w-full text-sm">
              <thead className="text-[9px] uppercase tracking-wider text-slate-400 font-bold border-b border-slate-200">
                <tr>
                  <th className="px-2 py-1.5 text-left whitespace-nowrap">Session</th>
                  <th className="px-2 py-1.5 text-left whitespace-nowrap">Ouverture</th>
                  <th className="px-2 py-1.5 text-left whitespace-nowrap">Clôture</th>
                  <th className="px-2 py-1.5 text-left whitespace-nowrap">Durée</th>
                  <th className="px-2 py-1.5 text-center whitespace-nowrap">Statut</th>
                  <th className="px-2 py-1.5 text-right whitespace-nowrap">Fond</th>
                  <th className="px-2 py-1.5 text-right whitespace-nowrap">Compté</th>
                  <th className="px-2 py-1.5 text-right whitespace-nowrap">Écart</th>
                  <th className="px-2 py-1.5 text-right w-16"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => {
                  const variance = s.variance != null ? Number(s.variance) : null;
                  const isOpen = s.status === 'open';
                  const balanced = variance === 0;
                  const opened = new Date(s.opened_at);
                  const closed = s.closed_at ? new Date(s.closed_at) : null;
                  const duration = closed ? Math.round((closed.getTime() - opened.getTime()) / 60000) : null;
                  return (
                    <tr key={s.id} data-row-id={s.id} className="border-b border-neutral-100 hover:bg-neutral-50/50 transition-colors cursor-pointer" onClick={() => openDetail(s)}>
                      <td className="px-2 py-1.5 doc-number text-[12px] font-bold text-neutral-700 whitespace-nowrap">#{s.id.slice(0, 8).toUpperCase()}</td>
                      <td className="px-2 py-1.5 text-[11px] whitespace-nowrap text-neutral-500 num">{opened.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} · {opened.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="px-2 py-1.5 text-[11px] whitespace-nowrap text-neutral-500 num">{closed ? closed.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                      <td className="px-2 py-1.5 text-[11px] whitespace-nowrap text-neutral-500 num">{duration != null ? (duration > 60 ? `${Math.floor(duration / 60)}h${duration % 60}` : `${duration}m`) : '—'}</td>
                      <td className="px-2 py-1.5 text-center">
                        <span className={`text-[9px] font-bold uppercase tracking-wider whitespace-nowrap ${isOpen ? 'text-neutral-700' : 'text-neutral-500'}`}>{isOpen ? 'Ouverte' : 'Clôturée'}</span>
                      </td>
                      <td className="px-2 py-1.5 text-right text-[11px] font-semibold text-neutral-700 num whitespace-nowrap">{formatFCFA(s.opening_amount)}</td>
                      <td className="px-2 py-1.5 text-right text-[11px] font-semibold text-neutral-700 num whitespace-nowrap">{s.counted_cash != null ? formatFCFA(s.counted_cash) : '—'}</td>
                      <td className="px-2 py-1.5 text-right">
                        {variance != null ? (
                          <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold num whitespace-nowrap ${balanced ? 'text-neutral-700' : variance < 0 ? 'text-red-600' : 'text-amber-600'}`}>
                            {balanced ? 'OK' : <>{variance > 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}{formatFCFA(Math.abs(variance))}</>}
                          </span>
                        ) : <span className="text-[11px] text-neutral-400">—</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button onClick={(e) => { e.stopPropagation(); openDetail(s); }} className="text-[10px] font-semibold text-neutral-500 hover:text-brand-700 transition-colors">
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

      {/* Detail modal — fintech ultra compact */}
      <CashModal open={detailOpen} onClose={() => setDetailOpen(false)} title="Détail de la session"
        footer={<>
          <button onClick={() => setDetailOpen(false)} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>
          {detail && (
            <button onClick={() => printReport(detail)} className="btn-icon-primary" title="Imprimer X de caisse">
              <Printer className="w-4 h-4" />
            </button>
          )}
        </>}
      >
        {loadingDetail ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-brand-700" /></div>
        ) : detail ? (
          <div className="count-up">
            {/* Timeline inline row */}
            {(() => {
              const fmtTime = (d: string) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
              const fmtDay = (d: string) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
              return (
                <div className="flex items-center justify-between py-2 border-b border-neutral-100">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-black">Session</span>
                  <div className="flex items-center gap-1.5 text-xs text-neutral-700 num">
                    <span>{fmtDay(detail.session.opened_at)}</span>
                    <span className="font-semibold">{fmtTime(detail.session.opened_at)}</span>
                    <span className="text-neutral-300">&rarr;</span>
                    {detail.session.closed_at ? (
                      <span className="font-semibold">{fmtTime(detail.session.closed_at)}</span>
                    ) : (
                      <span className="text-neutral-400 italic text-[11px]">En cours</span>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* KPI hairline rows */}
            {(() => {
              const mvExp = detail.movements.filter(m => m.kind === 'expense').reduce((s, m) => s + m.amount, 0);
              const mvRefund = detail.movements.filter(m => m.kind === 'refund').reduce((s, m) => s + m.amount, 0);
              const mvRetrait = detail.movements.filter(m => m.kind === 'customer_withdrawal').reduce((s, m) => s + m.amount, 0);
              const mvPret = detail.movements.filter(m => m.kind === 'customer_loan').reduce((s, m) => s + m.amount, 0);
              const salesTotal = detail.sales.reduce((s, x) => s + x.total, 0);
              const byMethodTotal = detail.byMethod.reduce((s, m) => s + m.amount, 0);
              const openingAmount = Number(detail.session.opening_amount) || 0;
              const totalEncaisse = byMethodTotal;
              const totalSorties = mvExp + mvRefund + mvRetrait + mvPret;
              const net = openingAmount + totalEncaisse - totalSorties;
              const cancelledTotal = detail.cancelledSales.reduce((s, x) => s + x.total, 0);
              const variance = detail.session.variance;
              return (
                <div className="divide-y divide-neutral-100">
                  <div className="flex items-center justify-between py-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-black">Ventes validées</span>
                    <div className="text-right">
                      <span className="text-sm font-bold text-neutral-900 num">{detail.sales.length}</span>
                      {detail.cancelledSales.length > 0 && (
                        <span className="text-[9px] text-red-500 num ml-2">{detail.cancelledSales.length} ann. ({formatFCFA(cancelledTotal)})</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-black">Facturé</span>
                    <span className="text-sm font-bold text-neutral-900 num">{formatFCFA(salesTotal)}</span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-black">Fond initial</span>
                    <span className="text-sm font-bold text-neutral-900 num">{formatFCFA(openingAmount)}</span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-black">Encaissé</span>
                    <span className="text-sm font-bold text-emerald-700 num">+{formatFCFA(totalEncaisse)}</span>
                  </div>
                  {totalSorties > 0 && (
                    <div className="flex items-center justify-between py-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-black">Sorties</span>
                      <span className="text-sm font-bold text-red-600 num">-{formatFCFA(totalSorties)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between py-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-black">Caisse théorique</span>
                    <span className="text-sm font-bold text-neutral-900 num">{formatFCFA(net)}</span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-black">Écart</span>
                    <span className={`text-sm font-bold num ${(variance || 0) === 0 ? 'text-neutral-700' : (variance || 0) < 0 ? 'text-red-600' : 'text-amber-600'}`}>
                      {variance != null ? (variance === 0 ? 'OK' : `${variance > 0 ? '+' : ''}${formatFCFA(variance)}`) : '--'}
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* Collapsible hairline sections */}
            <div className="mt-1 divide-y divide-neutral-100">
              {/* Encaissements par mode */}
              {detail.byMethod.length > 0 && (<>
                <button onClick={() => { tap(); setDetailExpanded(detailExpanded === 'modes' ? null : 'modes'); }} className="w-full flex items-center justify-between py-2.5 px-2 -mx-2 rounded-lg text-left active:bg-neutral-100 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <CreditCard className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                    <span className="text-[10px] text-neutral-400 shrink-0 num">{detail.byMethod.length}</span>
                    <span className="text-xs font-semibold text-neutral-800 truncate">Encaissements par mode</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-bold text-neutral-800 num">{formatFCFA(detail.byMethod.reduce((s, m) => s + m.amount, 0))}</span>
                    <ChevronRight className={`w-3.5 h-3.5 text-neutral-300 transition-transform duration-200 ${detailExpanded === 'modes' ? 'rotate-90' : ''}`} />
                  </div>
                </button>
                {detailExpanded === 'modes' && (
                  <div className="pb-2 animate-in fade-in slide-in-from-top-1 duration-200">
                    {detail.byMethod.map(m => {
                      const total = detail.byMethod.reduce((s, x) => s + x.amount, 0);
                      const pct = total > 0 ? (m.amount / total) * 100 : 0;
                      return (
                        <div key={m.method_name} className="flex items-center justify-between py-1.5 pl-6 text-xs">
                          <span className="text-neutral-600 truncate">{m.method_name}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] text-neutral-400 num">{pct.toFixed(0)}%</span>
                            <span className="font-semibold text-neutral-800 num">{formatFCFA(m.amount)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>)}

              {/* Reglements factures */}
              {detail.invoicePayments.length > 0 && (<>
                <button onClick={() => { tap(); setDetailExpanded(detailExpanded === 'reglements' ? null : 'reglements'); }} className="w-full flex items-center justify-between py-2.5 px-2 -mx-2 rounded-lg text-left active:bg-neutral-100 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <Wallet className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                    <span className="text-[10px] text-neutral-400 shrink-0 num">{detail.invoicePayments.length}</span>
                    <span className="text-xs font-semibold text-neutral-800 truncate">Règlements factures</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-bold text-neutral-800 num">+{formatFCFA(detail.invoicePayments.reduce((s, p) => s + p.amount, 0))}</span>
                    <ChevronRight className={`w-3.5 h-3.5 text-neutral-300 transition-transform duration-200 ${detailExpanded === 'reglements' ? 'rotate-90' : ''}`} />
                  </div>
                </button>
                {detailExpanded === 'reglements' && (
                  <div className="pb-2 divide-y divide-neutral-50 animate-in fade-in slide-in-from-top-1 duration-200">
                    {detail.invoicePayments.map(p => (
                      <div key={p.id} className="flex items-center justify-between py-1.5 pl-6 gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-neutral-800 truncate">{p.customer_name || 'Client'}</div>
                          <div className="flex items-center gap-1.5 text-[10px] text-neutral-400 num">
                            <span className="doc-number font-semibold">{p.sale_number}</span>
                            <span>{p.method_name}</span>
                          </div>
                        </div>
                        <span className="text-xs font-semibold text-neutral-700 num shrink-0">+{formatFCFA(p.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>)}

              {/* Movement sections */}
              {(() => {
                const encDirectList = detail.movements.filter(m => m.kind === 'income');
                const acomptesList = detail.movements.filter(m => m.kind === 'customer_prepayment');
                const depensesList = detail.movements.filter(m => m.kind === 'expense');
                const remboursementsList = detail.movements.filter(m => m.kind === 'refund');
                const retraitsList = detail.movements.filter(m => m.kind === 'customer_withdrawal');
                const pretsList = detail.movements.filter(m => m.kind === 'customer_loan');

                const MovSection = ({ id, icon: Icon, label, items, total, sign, color }: {
                  id: typeof detailExpanded; icon: any; label: string;
                  items: CashMovementRow[]; total: number; sign: string; color: string;
                }) => items.length === 0 ? null : (<>
                  <button onClick={() => { tap(); setDetailExpanded(detailExpanded === id ? null : id); }} className="w-full flex items-center justify-between py-2.5 px-2 -mx-2 rounded-lg text-left active:bg-neutral-100 transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                      <span className="text-[10px] text-neutral-400 shrink-0 num">{items.length}</span>
                      <span className="text-xs font-semibold text-neutral-800 truncate">{label}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs font-bold num ${color}`}>{sign}{formatFCFA(total)}</span>
                      <ChevronRight className={`w-3.5 h-3.5 text-neutral-300 transition-transform duration-200 ${detailExpanded === id ? 'rotate-90' : ''}`} />
                    </div>
                  </button>
                  {detailExpanded === id && (
                    <div className="pb-2 max-h-72 overflow-y-auto divide-y divide-neutral-50 animate-in fade-in slide-in-from-top-1 duration-200">
                      {items.map(m => (
                        <div key={m.id} className="flex items-center justify-between py-1.5 pl-6 gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-neutral-800 truncate">{m.customer_name || m.reason || label}</div>
                            <div className="flex items-center gap-1.5 text-[10px] text-neutral-400 num">
                              {m.method_name && <span>{m.method_name}</span>}
                              <span>{new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                          </div>
                          <span className={`text-xs font-semibold num shrink-0 ${color}`}>{sign}{formatFCFA(m.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>);

                return (<>
                  <MovSection id="encDirect" icon={ArrowDownRight} label="Encaissements directs" items={encDirectList} total={encDirectList.reduce((s, m) => s + m.amount, 0)} sign="+" color="text-neutral-700" />
                  <MovSection id="acomptes" icon={Wallet} label="Acomptes clients" items={acomptesList} total={acomptesList.reduce((s, m) => s + m.amount, 0)} sign="+" color="text-neutral-700" />
                  <MovSection id="depenses" icon={ArrowUpRight} label="Décaissements" items={depensesList} total={depensesList.reduce((s, m) => s + m.amount, 0)} sign="-" color="text-red-600" />
                  <MovSection id="remboursements" icon={RotateCcw} label="Remboursements" items={remboursementsList} total={remboursementsList.reduce((s, m) => s + m.amount, 0)} sign="-" color="text-amber-600" />
                  <MovSection id="retraits" icon={ArrowDownRight} label="Retraits client" items={retraitsList} total={retraitsList.reduce((s, m) => s + m.amount, 0)} sign="-" color="text-amber-600" />
                  <MovSection id="prets" icon={HandCoins} label="Prêts client" items={pretsList} total={pretsList.reduce((s, m) => s + m.amount, 0)} sign="-" color="text-neutral-700" />
                </>);
              })()}

              {/* Ventes */}
              <button onClick={() => { tap(); setDetailExpanded(detailExpanded === 'ventes' ? null : 'ventes'); }} className="w-full flex items-center justify-between py-2.5 px-2 -mx-2 rounded-lg text-left active:bg-neutral-100 transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <Package className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                  <span className="text-[10px] text-neutral-400 shrink-0 num">{detail.sales.length}</span>
                  <span className="text-xs font-semibold text-neutral-800 truncate">Ventes de la session</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-bold text-neutral-800 num">{formatFCFA(detail.sales.reduce((s, x) => s + x.total, 0))}</span>
                  <ChevronRight className={`w-3.5 h-3.5 text-neutral-300 transition-transform duration-200 ${detailExpanded === 'ventes' ? 'rotate-90' : ''}`} />
                </div>
              </button>
              {detailExpanded === 'ventes' && (
                <div className="pb-2 divide-y divide-neutral-50 animate-in fade-in slide-in-from-top-1 duration-200">
                  {detail.sales.length === 0 ? (
                    <div className="py-3 text-center text-xs text-neutral-400">Aucune vente.</div>
                  ) : detail.sales.map(s => (
                    <div key={s.id} className="flex items-center justify-between py-1.5 pl-6 gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-neutral-800 truncate">{s.customer_name || 'Comptoir'}</div>
                        <div className="flex items-center gap-1.5 text-[10px] text-neutral-400 num">
                          <span className="doc-number font-semibold text-neutral-500">{s.sale_number}</span>
                          <span>{new Date(s.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>
                      <span className="text-xs font-semibold text-neutral-800 num shrink-0">{formatFCFA(s.total)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Controle de caisse */}
              {detail.controls.length > 0 && (<>
                <button onClick={() => { tap(); setDetailExpanded(detailExpanded === 'controle' ? null : 'controle'); }} className="w-full flex items-center justify-between py-2.5 px-2 -mx-2 rounded-lg text-left active:bg-neutral-100 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <Check className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                    <span className="text-[10px] text-neutral-400 shrink-0 num">{detail.controls.length}</span>
                    <span className="text-xs font-semibold text-neutral-800 truncate">Contrôle de caisse</span>
                  </div>
                  <ChevronRight className={`w-3.5 h-3.5 text-neutral-300 transition-transform duration-200 shrink-0 ${detailExpanded === 'controle' ? 'rotate-90' : ''}`} />
                </button>
                {detailExpanded === 'controle' && (
                  <div className="pb-2 divide-y divide-neutral-50 animate-in fade-in slide-in-from-top-1 duration-200">
                    {Number(detail.session.opening_amount) > 0 && (
                      <div className="flex items-center justify-between py-1.5 pl-6 text-xs">
                        <span className="text-neutral-500">Fond d'ouverture</span>
                        <span className="font-semibold text-neutral-800 num">{formatFCFA(Number(detail.session.opening_amount))}</span>
                      </div>
                    )}
                    {detail.controls.map((c, i) => {
                      const diff = Number(c.difference_amount);
                      const balanced = diff === 0;
                      return (
                        <div key={i} className="py-1.5 pl-6">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-neutral-800 truncate">{c.method_name}</span>
                            <span className={`font-bold num shrink-0 ${balanced ? 'text-neutral-600' : diff < 0 ? 'text-red-600' : 'text-amber-600'}`}>
                              {balanced ? 'OK' : `${diff > 0 ? '+' : ''}${formatFCFA(diff)}`}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-[10px] text-neutral-400 num">
                            <span>Th. {formatFCFA(c.theoretical_amount)}</span>
                            <span>Cpt. {formatFCFA(c.counted_amount)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>)}
            </div>

            {/* Regularizations — flat hairline rows */}
            {detail.regularizations.length > 0 && (
              <div className="mt-2 border-t border-neutral-100 pt-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-black mb-1">Régularisations ({detail.regularizations.length})</div>
                <div className="divide-y divide-neutral-100">
                  {detail.regularizations.map((r, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 text-xs">
                      <div className="min-w-0 truncate">
                        <span className={`font-semibold capitalize ${r.reg_type === 'manquant' ? 'text-red-600' : r.reg_type === 'excedent' ? 'text-amber-600' : 'text-neutral-700'}`}>{r.reg_type}</span>
                        {r.reason && <span className="text-neutral-500 ml-1.5">{r.reason}</span>}
                      </div>
                      <span className="font-bold num shrink-0 ml-2 text-neutral-800">{formatFCFA(r.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Notes — single-line entries */}
            {(detail.session.opening_note || detail.session.closing_note) && (
              <div className="mt-2 border-t border-neutral-100 pt-2 divide-y divide-neutral-100">
                {detail.session.opening_note && (
                  <div className="flex items-start justify-between py-1.5 gap-3 text-[11px]">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-black shrink-0 pt-px">Ouverture</span>
                    <span className="text-neutral-700 text-right">{detail.session.opening_note}</span>
                  </div>
                )}
                {detail.session.closing_note && (
                  <div className="flex items-start justify-between py-1.5 gap-3 text-[11px]">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-black shrink-0 pt-px">Clôture</span>
                    <span className="text-neutral-700 text-right">{detail.session.closing_note}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </CashModal>
    </div>
  );
}
