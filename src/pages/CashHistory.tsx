import { useEffect, useMemo, useState } from 'react';
import { Clock, Loader2, Search, X, Eye, Printer, ChevronDown, ChevronUp, Check, TrendingUp, Wallet, ArrowDownRight, ArrowUpRight, Calendar, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { formatFCFA, formatDateTime } from '../lib/format';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { PremiumDateRangePicker } from '../components/PremiumDateRangePicker';
import { printXReport80 } from '../lib/print';

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
  id: string; kind: 'expense' | 'income' | 'customer_prepayment';
  amount: number; reason: string; note: string; reference: string;
  method_name: string; customer_name: string | null; created_at: string;
};

type SessionDetail = {
  session: SessionRow;
  sales: { id: string; sale_number: string; total: number; created_at: string; customer_name: string | null }[];
  controls: { method_name: string; theoretical_amount: number; counted_amount: number; difference_amount: number }[];
  regularizations: { reg_type: string; amount: number; reason: string; note: string; created_at: string }[];
  byMethod: { method_name: string; amount: number }[];
  invoicePayments: InvoicePayment[];
  movements: CashMovementRow[];
};

export function CashHistory() {
  const { tenant, currentSite, profile } = useApp();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [expandedSales, setExpandedSales] = useState(false);
  const [expandedControls, setExpandedControls] = useState(false);

  const load = async () => {
    if (!tenant || !currentSite) return;
    setLoading(true);
    const { data } = await supabase
      .from('cash_sessions')
      .select('*')
      .eq('tenant_id', tenant.id)
      .eq('site_id', currentSite.id)
      .order('opened_at', { ascending: false })
      .limit(200);
    setSessions(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [tenant?.id, currentSite?.id]);

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
    setDetail(null); setDetailOpen(true); setLoadingDetail(true); setExpandedSales(false);
    const [{ data: salesData }, { data: ctrlData }, { data: regData }, { data: pmtData }, { data: mvData }] = await Promise.all([
      supabase.from('sales').select('id, sale_number, total, created_at, customers(name)').eq('tenant_id', tenant!.id).eq('cash_session_id', s.id).order('created_at'),
      supabase.from('cash_control_lines').select('method_name, theoretical_amount, counted_amount, difference_amount').eq('tenant_id', tenant!.id).eq('cash_session_id', s.id),
      supabase.from('cash_regularizations').select('reg_type, amount, reason, note, created_at').eq('tenant_id', tenant!.id).eq('cash_session_id', s.id).order('created_at'),
      supabase.from('sale_payments').select('id, method_name, amount, reference, created_at, sale_id, sales(sale_number, created_at, cash_session_id, customers(name))').eq('tenant_id', tenant!.id).eq('cash_session_id', s.id),
      supabase.from('cash_movements').select('id, kind, amount, reason, note, reference, method_name, created_at, customers(name)').eq('tenant_id', tenant!.id).eq('cash_session_id', s.id).order('created_at'),
    ]);
    const byMethodMap: Record<string, number> = {};
    (pmtData || []).forEach((p: any) => { byMethodMap[p.method_name] = (byMethodMap[p.method_name] || 0) + Number(p.amount); });
    const invoicePayments: InvoicePayment[] = (pmtData || [])
      .filter((p: any) => p.sales && p.sales.cash_session_id && p.sales.cash_session_id !== s.id)
      .map((p: any) => ({
        id: p.id, amount: Number(p.amount), method_name: p.method_name,
        created_at: p.created_at, reference: p.reference || '',
        sale_number: p.sales?.sale_number || '',
        customer_name: p.sales?.customers?.name || null,
        sale_date: p.sales?.created_at || '',
      }))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    setDetail({
      session: s,
      sales: (salesData || []).map((x: any) => ({ id: x.id, sale_number: x.sale_number, total: Number(x.total), created_at: x.created_at, customer_name: x.customers?.name || null })),
      controls: ctrlData || [],
      regularizations: regData || [],
      byMethod: Object.entries(byMethodMap).map(([method_name, amount]) => ({ method_name, amount })),
      invoicePayments,
      movements: (mvData || []).map((m: any) => ({
        id: m.id, kind: m.kind, amount: Number(m.amount),
        reason: m.reason || '', note: m.note || '', reference: m.reference || '',
        method_name: m.method_name || '',
        customer_name: m.customers?.name || null,
        created_at: m.created_at,
      })),
    });
    setLoadingDetail(false);
  };

  const printReport = (d: SessionDetail) => {
    const salesTotal = d.sales.reduce((s, x) => s + x.total, 0);
    printXReport80({
      tenant: {
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
      },
      cashier: d.session.cashier_name || profile?.full_name || profile?.email || '',
      siteName: d.session.site_name || currentSite?.name || '',
      sessionId: d.session.id,
      openedAt: d.session.opened_at,
      closedAt: d.session.closed_at,
      openingAmount: Number(d.session.opening_amount),
      salesCount: d.sales.length,
      salesTotal,
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
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 rounded-2xl bg-white border border-slate-200 shadow-sm hover:shadow-md focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-500/20 transition-all">
          <div className="flex items-center gap-2 pr-2 border-r border-slate-200 shrink-0">
            <div className="leading-tight">
              <h1 className="text-sm font-bold tracking-tight text-slate-900 leading-none">Caisse</h1>
              <div className="text-[9px] font-semibold tracking-wider uppercase text-slate-400 leading-none mt-0.5 hidden sm:block">Historique des sessions</div>
              <div className="text-[9px] font-semibold tracking-wider uppercase text-slate-400 leading-none mt-0.5 sm:hidden">Historique</div>
            </div>
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher…" className="flex-1 min-w-0 w-0 bg-transparent text-xs focus:outline-none placeholder:text-slate-400" />
          {search && <button onClick={() => setSearch('')} className="shrink-0 p-1 text-slate-400 hover:text-slate-600 transition-colors"><X className="w-3.5 h-3.5" /></button>}
          <button onClick={() => setPickerOpen(true)} className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-all ${dateFrom || dateTo ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100'}`}>
            <Calendar className="w-3.5 h-3.5" />
            <span className="hidden md:inline max-w-[120px] truncate">{dateLabel}</span>
          </button>
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 flex items-center justify-center shadow-glow shrink-0">
            <Search className="w-3.5 h-3.5 text-white" />
          </div>
        </div>
      </div>

      {/* Inline stats chips */}
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider overflow-x-auto no-scrollbar whitespace-nowrap">
        <span className="shrink-0 px-2 py-1 rounded-full bg-slate-100 text-slate-600 num">{filtered.length} / {sessions.length}</span>
        {stats.open > 0 && <span className="shrink-0 px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 pulse-glow" />{stats.open} ouverte{stats.open > 1 ? 's' : ''}</span>}
        {stats.closed > 0 && <span className="shrink-0 px-2 py-1 rounded-full bg-slate-50 text-slate-600 border border-slate-200">{stats.closed} clôturée{stats.closed > 1 ? 's' : ''}</span>}
        {stats.variances > 0 && <span className="shrink-0 px-2 py-1 rounded-full bg-amber-50 text-amber-700">{stats.variances} écart{stats.variances > 1 ? 's' : ''}</span>}
        {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="shrink-0 px-2 py-1 rounded-full bg-slate-50 text-slate-400 hover:text-slate-600 inline-flex items-center gap-1">Effacer <X className="w-3 h-3" /></button>}
      </div>

      <PremiumDateRangePicker open={pickerOpen} onClose={() => setPickerOpen(false)} from={dateFrom} to={dateTo} onApply={(f, t) => { setDateFrom(f); setDateTo(t); setPickerOpen(false); }} />

      {/* Cards / Timeline */}
      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
      ) : filtered.length === 0 ? (
        <div className="card-premium"><EmptyState icon={Clock} title="Aucune session" description="Les sessions de caisse apparaîtront ici après ouverture." /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
          {filtered.map(s => {
            const variance = s.variance != null ? Number(s.variance) : null;
            const isOpen = s.status === 'open';
            const balanced = variance === 0;
            const opened = new Date(s.opened_at);
            const closed = s.closed_at ? new Date(s.closed_at) : null;
            const duration = closed ? Math.round((closed.getTime() - opened.getTime()) / 60000) : null;
            return (
              <button key={s.id} onClick={() => openDetail(s)} className="card-premium text-left p-3 flex flex-col gap-2 hover:border-brand-400 transition-all duration-300 group">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 ${isOpen ? 'bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-glow' : balanced ? 'bg-gradient-to-br from-brand-500 to-brand-700 text-white' : 'bg-gradient-to-br from-amber-400 to-amber-600 text-white'}`}>
                    {isOpen ? <Clock className="w-3.5 h-3.5" /> : balanced ? <Check className="w-3.5 h-3.5" /> : <TrendingUp className="w-3.5 h-3.5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] font-bold tracking-wider text-brand-700">#{s.id.slice(0, 8).toUpperCase()}</span>
                      <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${isOpen ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{isOpen ? 'Ouverte' : 'Clôturée'}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 num leading-tight mt-0.5 truncate">
                      {opened.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} · {opened.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      {closed && <>→{closed.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</>}
                      {duration != null && <span className="text-slate-400"> · {duration > 60 ? `${Math.floor(duration / 60)}h${duration % 60}` : `${duration}m`}</span>}
                    </div>
                  </div>
                  <Eye className="w-3.5 h-3.5 text-slate-300 group-hover:text-brand-600 transition-colors shrink-0" />
                </div>
                <div className="grid grid-cols-3 gap-1.5 pt-1.5 border-t border-slate-100">
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Fond</div>
                    <div className="text-[11px] font-bold text-slate-800 num leading-tight mt-0.5">{formatFCFA(s.opening_amount)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Compté</div>
                    <div className="text-[11px] font-bold text-slate-800 num leading-tight mt-0.5">{s.counted_cash != null ? formatFCFA(s.counted_cash) : '—'}</div>
                  </div>
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Écart</div>
                    <div className="leading-tight mt-0.5">
                      {variance != null ? (
                        <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold num ${balanced ? 'text-emerald-700' : variance < 0 ? 'text-red-600' : 'text-amber-600'}`}>
                          {balanced ? 'OK' : <>{variance > 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}{formatFCFA(Math.abs(variance))}</>}
                        </span>
                      ) : <span className="text-[11px] text-slate-400">—</span>}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Detail modal — fintech ultra compact */}
      <Modal open={detailOpen} onClose={() => setDetailOpen(false)} title="Détail de la session" size="md"
        footer={<>
          <button onClick={() => setDetailOpen(false)} className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition">Fermer</button>
          {detail && (
            <button onClick={() => printReport(detail)} className="px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-brand-600 to-brand-700 text-white shadow-glow hover:shadow-lg transition inline-flex items-center gap-1.5 active:scale-95">
              <Printer className="w-3.5 h-3.5" /> X de caisse
            </button>
          )}
        </>}
      >
        {loadingDetail ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-brand-700" /></div>
        ) : detail ? (
          <div className="space-y-3 count-up">
            {/* One-line KPI strip */}
            <div className="grid grid-cols-4 gap-1.5 p-2 rounded-2xl bg-gradient-to-br from-slate-50 to-white border border-slate-200">
              <div className="text-center">
                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Session</div>
                <div className="font-mono text-[11px] font-bold text-brand-700 mt-0.5 truncate">{detail.session.id.slice(0, 8).toUpperCase()}</div>
              </div>
              <div className="text-center border-l border-slate-200">
                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Statut</div>
                <div className={`text-[11px] font-bold mt-0.5 inline-flex items-center gap-1 ${detail.session.status === 'open' ? 'text-emerald-700' : 'text-slate-700'}`}>
                  {detail.session.status === 'open' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 pulse-glow" />}
                  {detail.session.status === 'open' ? 'Ouverte' : 'Clôturée'}
                </div>
              </div>
              <div className="text-center border-l border-slate-200">
                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">FO</div>
                <div className="text-[11px] font-bold text-slate-800 num mt-0.5 truncate">{formatFCFA(detail.session.opening_amount)}</div>
              </div>
              <div className="text-center border-l border-slate-200">
                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Écart</div>
                <div className={`text-[11px] font-bold num mt-0.5 truncate ${(detail.session.variance || 0) === 0 ? 'text-emerald-700' : (detail.session.variance || 0) < 0 ? 'text-red-600' : 'text-amber-600'}`}>
                  {detail.session.variance != null ? (detail.session.variance === 0 ? 'OK' : `${detail.session.variance > 0 ? '+' : ''}${formatFCFA(detail.session.variance)}`) : '—'}
                </div>
              </div>
            </div>

            {/* Ouverture / clôture — visual timeline */}
            <div className="relative p-3 rounded-2xl bg-gradient-to-br from-ink-900 to-slate-800 text-white overflow-hidden">
              <div className="absolute inset-0 shimmer-bg opacity-30" />
              <div className="relative flex items-center gap-3">
                <div className="flex-1">
                  <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-emerald-400">Ouverture</div>
                  <div className="text-sm font-bold mt-1 num">{formatDateTime(detail.session.opened_at)}</div>
                </div>
                <div className="shrink-0 px-2 text-slate-500">
                  <ChevronRight className="w-4 h-4" />
                </div>
                <div className="flex-1 text-right">
                  <div className={`text-[9px] font-bold uppercase tracking-[0.15em] ${detail.session.closed_at ? 'text-amber-400' : 'text-slate-500'}`}>Clôture</div>
                  <div className="text-sm font-bold mt-1 num">{detail.session.closed_at ? formatDateTime(detail.session.closed_at) : 'En cours'}</div>
                </div>
              </div>
            </div>

            {/* Payment methods */}
            {detail.byMethod.length > 0 && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Encaissements par mode</div>
                <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden divide-y divide-slate-100">
                  {detail.byMethod.map(m => {
                    const total = detail.byMethod.reduce((s, x) => s + x.amount, 0);
                    const pct = total > 0 ? (m.amount / total) * 100 : 0;
                    return (
                      <div key={m.method_name} className="relative p-2.5">
                        <div className="absolute inset-0 bg-gradient-to-r from-brand-50/60 to-transparent" style={{ width: `${pct}%` }} />
                        <div className="relative flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-800 truncate">{m.method_name}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] font-bold text-slate-400 num">{pct.toFixed(0)}%</span>
                            <span className="text-xs font-bold num text-slate-900">{formatFCFA(m.amount)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div className="p-2.5 bg-gradient-to-r from-brand-50 to-brand-100/50 flex items-center justify-between">
                    <span className="text-xs font-bold text-brand-800 uppercase tracking-wider">Total CA</span>
                    <span className="text-sm font-bold text-brand-800 num">{formatFCFA(detail.byMethod.reduce((s, m) => s + m.amount, 0))}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Net caisse incluant mouvements */}
            {detail.movements.length > 0 && (() => {
              const mvExp = detail.movements.filter(m => m.kind === 'expense').reduce((s, m) => s + m.amount, 0);
              const mvIn = detail.movements.filter(m => m.kind === 'income').reduce((s, m) => s + m.amount, 0);
              const mvPre = detail.movements.filter(m => m.kind === 'customer_prepayment').reduce((s, m) => s + m.amount, 0);
              const salesTotal = detail.sales.reduce((s, x) => s + x.total, 0);
              const net = salesTotal + mvIn + mvPre - mvExp;
              return (
                <div className="rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-brand-700 mb-2">Net caisse</div>
                  <div className="grid grid-cols-4 gap-2">
                    <div>
                      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Ventes</div>
                      <div className="text-xs font-bold text-slate-800 num mt-0.5">{formatFCFA(salesTotal)}</div>
                    </div>
                    <div>
                      <div className="text-[9px] font-bold uppercase tracking-wider text-emerald-700">Entrées</div>
                      <div className="text-xs font-bold text-emerald-700 num mt-0.5">+{formatFCFA(mvIn + mvPre)}</div>
                    </div>
                    <div>
                      <div className="text-[9px] font-bold uppercase tracking-wider text-red-700">Sorties</div>
                      <div className="text-xs font-bold text-red-700 num mt-0.5">-{formatFCFA(mvExp)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-brand-800">Net</div>
                      <div className="text-sm font-bold text-brand-900 num mt-0.5">{formatFCFA(net)}</div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Cash movements */}
            {detail.movements.length > 0 && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Mouvements de caisse ({detail.movements.length})
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden divide-y divide-slate-100">
                  {detail.movements.map(m => {
                    const isExp = m.kind === 'expense';
                    const isPrepay = m.kind === 'customer_prepayment';
                    const label = isExp ? 'Dépense' : isPrepay ? 'Acompte client' : 'Entrée';
                    return (
                      <div key={m.id} className="p-2.5 flex items-start gap-2">
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${isExp ? 'bg-red-50 text-red-600' : isPrepay ? 'bg-brand-50 text-brand-700' : 'bg-emerald-50 text-emerald-700'}`}>
                          {isExp ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-slate-900 break-words">
                            {label}{isPrepay && m.customer_name ? ` · ${m.customer_name}` : ''}
                            {m.reason ? ` · ${m.reason}` : ''}
                          </div>
                          <div className="text-[10px] text-slate-500 break-words">
                            {m.method_name || '—'} · {new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                            {m.reference ? ` · ${m.reference}` : ''}
                          </div>
                        </div>
                        <div className={`text-sm font-bold num shrink-0 whitespace-nowrap ${isExp ? 'text-red-700' : 'text-emerald-700'}`}>
                          {isExp ? '-' : '+'}{formatFCFA(m.amount)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Invoice payments (non-POS, facture encaissée sur caisse du jour) */}
            {detail.invoicePayments.length > 0 && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Règlements de factures ({detail.invoicePayments.length})
                </div>
                <div className="rounded-2xl border border-sky-200 bg-sky-50/30 overflow-hidden divide-y divide-sky-100">
                  {detail.invoicePayments.map(p => (
                    <div key={p.id} className="p-2.5 flex items-start gap-2">
                      <div className="w-8 h-8 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center shrink-0 mt-0.5">
                        <Wallet className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-slate-900 break-words">
                          Règlement facture <span className="font-mono">{p.sale_number}</span>
                          {p.customer_name && <> · <span className="text-slate-700">{p.customer_name}</span></>}
                        </div>
                        <div className="text-[10px] text-slate-500 break-words">
                          Facture du {p.sale_date ? new Date(p.sale_date).toLocaleDateString('fr-FR') : '—'} · {p.method_name} · {new Date(p.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      <div className="text-sm font-bold text-emerald-700 num shrink-0 whitespace-nowrap">+{formatFCFA(p.amount)}</div>
                    </div>
                  ))}
                  <div className="p-2.5 bg-sky-100/50 flex items-center justify-between">
                    <span className="text-xs font-bold text-sky-800 uppercase tracking-wider">Total règlements factures</span>
                    <span className="text-sm font-bold text-sky-800 num">+{formatFCFA(detail.invoicePayments.reduce((s, p) => s + p.amount, 0))}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Control lines — collapsible */}
            {detail.controls.length > 0 && (
              <div>
                <button onClick={() => setExpandedControls(v => !v)} className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200 hover:border-brand-300 transition">
                  {expandedControls ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
                  <span className="text-xs font-bold text-slate-800">Contrôle de caisse</span>
                  <span className="ml-auto text-[10px] font-bold text-slate-400 num">{detail.controls.length}</span>
                </button>
                {expandedControls && (
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5 count-up">
                    {detail.controls.map((c, i) => {
                      const diff = Number(c.difference_amount);
                      const balanced = diff === 0;
                      return (
                        <div key={i} className={`rounded-xl border p-2.5 ${balanced ? 'border-slate-200 bg-white' : diff < 0 ? 'border-red-200 bg-red-50/40' : 'border-amber-200 bg-amber-50/40'}`}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs font-bold text-slate-800 truncate">{c.method_name}</div>
                            <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold num shrink-0 ${balanced ? 'text-emerald-700' : diff < 0 ? 'text-red-600' : 'text-amber-600'}`}>
                              {balanced ? <><Check className="w-3 h-3" /> OK</> : <>{diff > 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}{formatFCFA(Math.abs(diff))}</>}
                            </span>
                          </div>
                          <div className="mt-1.5 flex items-center justify-between text-[10px]">
                            <div><span className="text-slate-400">Th.</span> <span className="num font-semibold text-slate-700">{formatFCFA(c.theoretical_amount)}</span></div>
                            <div><span className="text-slate-400">Cpt.</span> <span className="num font-semibold text-slate-800">{formatFCFA(c.counted_amount)}</span></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Regularizations */}
            {detail.regularizations.length > 0 && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Régularisations ({detail.regularizations.length})</div>
                <div className="space-y-1">
                  {detail.regularizations.map((r, i) => (
                    <div key={i} className={`flex items-center justify-between p-2 rounded-xl text-xs ${r.reg_type === 'manquant' ? 'bg-red-50 border border-red-100' : r.reg_type === 'excedent' ? 'bg-amber-50 border border-amber-100' : 'bg-slate-50 border border-slate-100'}`}>
                      <div className="min-w-0 truncate">
                        <span className="font-semibold capitalize">{r.reg_type}</span>
                        {r.reason && <span className="text-slate-600 ml-2">— {r.reason}</span>}
                      </div>
                      <span className="font-bold num shrink-0 ml-2">{formatFCFA(r.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sales — collapsible */}
            <div>
              <button onClick={() => setExpandedSales(v => !v)} className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200 hover:border-brand-300 transition">
                {expandedSales ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
                <span className="text-xs font-bold text-slate-800">Ventes de la session</span>
                <span className="ml-auto text-[10px] font-bold text-slate-400 num">{detail.sales.length}</span>
              </button>
              {expandedSales && (
                <div className="mt-2 space-y-1 count-up">
                  {detail.sales.length === 0 ? (
                    <div className="py-4 text-center text-xs text-slate-500">Aucune vente.</div>
                  ) : (
                    <>
                      {detail.sales.map(s => (
                        <div key={s.id} className="p-2 rounded-xl bg-white border border-slate-200 flex items-center gap-2 hover:border-brand-300 transition">
                          <div className="w-7 h-7 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
                            <Wallet className="w-3.5 h-3.5 text-brand-700" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-[10px] font-bold text-brand-700">{s.sale_number}</span>
                              <span className="text-[10px] text-slate-500 truncate">{s.customer_name || 'Comptoir'}</span>
                            </div>
                            <div className="text-[9px] text-slate-400 num leading-none mt-0.5">{formatDateTime(s.created_at)}</div>
                          </div>
                          <div className="num font-bold text-xs text-slate-900 shrink-0">{formatFCFA(s.total)}</div>
                        </div>
                      ))}
                      <div className="p-2 rounded-xl bg-gradient-to-r from-brand-50 to-brand-100/50 border border-brand-200 flex items-center justify-between">
                        <span className="text-xs font-bold text-brand-800">{detail.sales.length} vente{detail.sales.length !== 1 ? 's' : ''}</span>
                        <span className="text-xs font-bold text-brand-800 num">{formatFCFA(detail.sales.reduce((s, x) => s + x.total, 0))}</span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Notes */}
            {(detail.session.opening_note || detail.session.closing_note) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px]">
                {detail.session.opening_note && (
                  <div className="p-2 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Note ouverture</div>
                    <div className="text-slate-700">{detail.session.opening_note}</div>
                  </div>
                )}
                {detail.session.closing_note && (
                  <div className="p-2 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Note clôture</div>
                    <div className="text-slate-700">{detail.session.closing_note}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
