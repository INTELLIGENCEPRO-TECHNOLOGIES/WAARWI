import { useEffect, useMemo, useState } from 'react';
import { Clock, Loader2, Search, X, Eye, Printer, Check, TrendingUp, Wallet, ArrowDownRight, ArrowUpRight, Calendar, ChevronRight, CreditCard, Package } from 'lucide-react';
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
  const [detailExpanded, setDetailExpanded] = useState<'modes' | 'reglements' | 'encDirect' | 'acomptes' | 'depenses' | 'ventes' | 'controle' | null>(null);

  const load = async (silent = false) => {
    if (!tenant || !currentSite) return;
    if (!silent) setLoading(true);
    const { data } = await supabase
      .from('cash_sessions')
      .select('*')
      .eq('tenant_id', tenant.id)
      .eq('site_id', currentSite.id)
      .order('opened_at', { ascending: false })
      .limit(200);
    setSessions(data || []);
    if (!silent) setLoading(false);
  };

  useEffect(() => { load(); }, [tenant?.id, currentSite?.id]);
  useEffect(() => { if (dataTick > 0) load(true); }, [dataTick]);

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
      .filter((p: any) => !p.sales || p.sales.cash_session_id !== s.id)
      .map((p: any) => ({
        id: p.id, amount: Number(p.amount), method_name: p.method_name,
        created_at: p.created_at, reference: p.reference || '',
        sale_number: p.sales?.sale_number || '',
        customer_name: p.sales?.customers?.name || null,
        sale_date: p.sales?.created_at || '',
      }))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const allMovements = (mvData || []).map((m: any) => ({
      id: m.id, kind: m.kind as CashMovementRow['kind'], amount: Number(m.amount),
      reason: m.reason || '', note: m.note || '', reference: m.reference || '',
      method_name: m.method_name || '',
      customer_name: m.customers?.name || null,
      created_at: m.created_at,
    }));
    const movements = allMovements.filter(m =>
      !(m.kind === 'income' && m.reason.startsWith('Reglement '))
    );
    setDetail({
      session: s,
      sales: (salesData || []).map((x: any) => ({ id: x.id, sale_number: x.sale_number, total: Number(x.total), created_at: x.created_at, customer_name: x.customers?.name || null })),
      controls: ctrlData || [],
      regularizations: regData || [],
      byMethod: Object.entries(byMethodMap).map(([method_name, amount]) => ({ method_name, amount })),
      invoicePayments,
      movements,
    });
    setLoadingDetail(false);
  };

  const printReport = (d: SessionDetail) => {
    const salesTotal = d.sales.reduce((s, x) => s + x.total, 0);
    const invoicePayTotal = d.invoicePayments.reduce((s, p) => s + p.amount, 0);
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
      salesTotal: salesTotal + invoicePayTotal,
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
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-5 lg:-mx-8 px-3 sm:px-5 lg:px-8 pb-3 pt-3 sm:pt-4 lg:pt-6 -mt-3 sm:-mt-4 lg:-mt-6 bg-slate-50/95 backdrop-blur-sm flex items-center gap-2">
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
          <div className="space-y-2.5 count-up">
            {/* Compact KPI strip */}
            {(() => {
              const mvExp = detail.movements.filter(m => m.kind === 'expense').reduce((s, m) => s + m.amount, 0);
              const mvIn = detail.movements.filter(m => m.kind === 'income').reduce((s, m) => s + m.amount, 0);
              const mvPre = detail.movements.filter(m => m.kind === 'customer_prepayment').reduce((s, m) => s + m.amount, 0);
              const salesTotal = detail.sales.reduce((s, x) => s + x.total, 0);
              const invoicePayTotal = detail.invoicePayments.reduce((s, p) => s + p.amount, 0);
              const net = salesTotal + invoicePayTotal + mvIn + mvPre - mvExp;
              return (
                <div className="flex items-stretch gap-px rounded-xl overflow-hidden border border-slate-200 bg-slate-200">
                  <div className="flex-1 bg-white p-2 text-center">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Ventes</div>
                    <div className="text-sm font-bold text-slate-900 num mt-0.5">{detail.sales.length}</div>
                  </div>
                  <div className="flex-1 bg-white p-2 text-center">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">CA Total</div>
                    <div className="text-sm font-bold text-slate-900 num mt-0.5">{formatFCFA(salesTotal + invoicePayTotal)}</div>
                  </div>
                  <div className="flex-1 bg-white p-2 text-center">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Net</div>
                    <div className="text-sm font-bold text-brand-800 num mt-0.5">{formatFCFA(net)}</div>
                  </div>
                  <div className="flex-1 bg-white p-2 text-center">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Ecart</div>
                    <div className={`text-sm font-bold num mt-0.5 ${(detail.session.variance || 0) === 0 ? 'text-emerald-700' : (detail.session.variance || 0) < 0 ? 'text-red-600' : 'text-amber-600'}`}>
                      {detail.session.variance != null ? (detail.session.variance === 0 ? 'OK' : `${detail.session.variance > 0 ? '+' : ''}${formatFCFA(detail.session.variance)}`) : '--'}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Timeline compact */}
            <div className="relative p-2.5 rounded-xl bg-gradient-to-br from-ink-900 to-slate-800 text-white overflow-hidden">
              <div className="absolute inset-0 shimmer-bg opacity-30" />
              <div className="relative flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[8px] font-bold uppercase tracking-[0.15em] text-emerald-400">Ouverture</div>
                  <div className="text-xs font-bold mt-0.5 num truncate">{formatDateTime(detail.session.opened_at)}</div>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <div className="flex-1 min-w-0 text-right">
                  <div className={`text-[8px] font-bold uppercase tracking-[0.15em] ${detail.session.closed_at ? 'text-amber-400' : 'text-slate-500'}`}>Cloture</div>
                  <div className="text-xs font-bold mt-0.5 num truncate">{detail.session.closed_at ? formatDateTime(detail.session.closed_at) : 'En cours'}</div>
                </div>
              </div>
            </div>

            {/* Collapsible accordion sections */}
            <div className="space-y-1.5">
              {/* Encaissements par mode */}
              {detail.byMethod.length > 0 && (
                <div className={`rounded-xl border transition-all duration-200 ${detailExpanded === 'modes' ? 'border-brand-300 bg-brand-50/30 order-first' : 'border-slate-200 bg-white'}`}>
                  <button onClick={() => setDetailExpanded(detailExpanded === 'modes' ? null : 'modes')} className="w-full flex items-center justify-between px-3 py-2.5 text-left">
                    <div className="flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${detailExpanded === 'modes' ? 'bg-brand-200 text-brand-800' : 'bg-brand-100 text-brand-700'}`}>
                        <CreditCard className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-800">Encaissements par mode</div>
                        <div className="text-[10px] text-slate-500">{detail.byMethod.length} mode{detail.byMethod.length > 1 ? 's' : ''}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-brand-800 num">{formatFCFA(detail.byMethod.reduce((s, m) => s + m.amount, 0))}</span>
                      <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${detailExpanded === 'modes' ? 'rotate-90' : ''}`} />
                    </div>
                  </button>
                  {detailExpanded === 'modes' && (
                    <div className="px-3 pb-3 space-y-1 animate-in fade-in slide-in-from-top-1 duration-200">
                      {detail.byMethod.map(m => {
                        const total = detail.byMethod.reduce((s, x) => s + x.amount, 0);
                        const pct = total > 0 ? (m.amount / total) * 100 : 0;
                        return (
                          <div key={m.method_name} className="relative flex items-center justify-between px-3 py-2 rounded-lg bg-white border border-slate-100 text-xs overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-r from-brand-50/60 to-transparent" style={{ width: `${pct}%` }} />
                            <span className="relative font-medium text-slate-700">{m.method_name}</span>
                            <div className="relative flex items-center gap-2 shrink-0">
                              <span className="text-[10px] font-bold text-slate-400 num">{pct.toFixed(0)}%</span>
                              <span className="font-bold text-slate-900 num">{formatFCFA(m.amount)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Reglements factures */}
              {detail.invoicePayments.length > 0 && (
                <div className={`rounded-xl border transition-all duration-200 ${detailExpanded === 'reglements' ? 'border-sky-300 bg-sky-50/40 order-first' : 'border-slate-200 bg-white'}`}>
                  <button onClick={() => setDetailExpanded(detailExpanded === 'reglements' ? null : 'reglements')} className="w-full flex items-center justify-between px-3 py-2.5 text-left">
                    <div className="flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${detailExpanded === 'reglements' ? 'bg-sky-200 text-sky-800' : 'bg-sky-100 text-sky-700'}`}>
                        <Wallet className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-800">Reglements factures</div>
                        <div className="text-[10px] text-slate-500">{detail.invoicePayments.length} reglement{detail.invoicePayments.length > 1 ? 's' : ''}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-sky-800 num">+{formatFCFA(detail.invoicePayments.reduce((s, p) => s + p.amount, 0))}</span>
                      <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${detailExpanded === 'reglements' ? 'rotate-90' : ''}`} />
                    </div>
                  </button>
                  {detailExpanded === 'reglements' && (
                    <div className="px-3 pb-3 space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
                      {detail.invoicePayments.map(p => (
                        <div key={p.id} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-white border border-sky-100">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-bold text-slate-900">
                              <span className="font-mono">{p.sale_number}</span>
                              {p.customer_name && <span className="text-slate-600 font-medium ml-1">- {p.customer_name}</span>}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[10px] text-slate-500">
                              <span>{new Date(p.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} {new Date(p.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">{p.method_name}</span>
                            </div>
                          </div>
                          <span className="text-xs font-bold text-emerald-700 num shrink-0">+{formatFCFA(p.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Mouvements de caisse — split by kind */}
              {(() => {
                const encDirectList = detail.movements.filter(m => m.kind === 'income');
                const acomptesList = detail.movements.filter(m => m.kind === 'customer_prepayment');
                const depensesList = detail.movements.filter(m => m.kind === 'expense');
                const encDirectTotal = encDirectList.reduce((s, m) => s + m.amount, 0);
                const acomptesTotal = acomptesList.reduce((s, m) => s + m.amount, 0);
                const depensesTotal = depensesList.reduce((s, m) => s + m.amount, 0);
                return (
                  <>
                    {encDirectList.length > 0 && (
                      <div className={`rounded-xl border transition-all duration-200 ${detailExpanded === 'encDirect' ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200 bg-white'}`}>
                        <button onClick={() => setDetailExpanded(detailExpanded === 'encDirect' ? null : 'encDirect')} className="w-full flex items-center justify-between px-3 py-2.5 text-left">
                          <div className="flex items-center gap-2">
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${detailExpanded === 'encDirect' ? 'bg-emerald-200 text-emerald-800' : 'bg-emerald-100 text-emerald-700'}`}>
                              <ArrowDownRight className="w-3.5 h-3.5" />
                            </div>
                            <div>
                              <div className="text-xs font-bold text-slate-800">Encaissements directs</div>
                              <div className="text-[10px] text-slate-500">{encDirectList.length} entrée{encDirectList.length > 1 ? 's' : ''}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-emerald-700 num">+{formatFCFA(encDirectTotal)}</span>
                            <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${detailExpanded === 'encDirect' ? 'rotate-90' : ''}`} />
                          </div>
                        </button>
                        {detailExpanded === 'encDirect' && (
                          <div className="px-3 pb-3 space-y-1.5 max-h-72 overflow-y-auto animate-in fade-in slide-in-from-top-1 duration-200">
                            {encDirectList.map(m => (
                              <div key={m.id} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-white border border-emerald-100">
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-semibold text-slate-900 line-clamp-1">{m.reason || 'Encaissement direct'}</div>
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[10px] text-slate-500">
                                    <span className="num">{new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                                    {m.method_name && <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">{m.method_name}</span>}
                                  </div>
                                </div>
                                <span className="text-xs font-bold text-emerald-700 num shrink-0">+{formatFCFA(m.amount)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {acomptesList.length > 0 && (
                      <div className={`rounded-xl border transition-all duration-200 ${detailExpanded === 'acomptes' ? 'border-brand-300 bg-brand-50/40' : 'border-slate-200 bg-white'}`}>
                        <button onClick={() => setDetailExpanded(detailExpanded === 'acomptes' ? null : 'acomptes')} className="w-full flex items-center justify-between px-3 py-2.5 text-left">
                          <div className="flex items-center gap-2">
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${detailExpanded === 'acomptes' ? 'bg-brand-200 text-brand-800' : 'bg-brand-100 text-brand-700'}`}>
                              <Wallet className="w-3.5 h-3.5" />
                            </div>
                            <div>
                              <div className="text-xs font-bold text-slate-800">Acomptes clients</div>
                              <div className="text-[10px] text-slate-500">{acomptesList.length} acompte{acomptesList.length > 1 ? 's' : ''}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-brand-700 num">+{formatFCFA(acomptesTotal)}</span>
                            <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${detailExpanded === 'acomptes' ? 'rotate-90' : ''}`} />
                          </div>
                        </button>
                        {detailExpanded === 'acomptes' && (
                          <div className="px-3 pb-3 space-y-1.5 max-h-72 overflow-y-auto animate-in fade-in slide-in-from-top-1 duration-200">
                            {acomptesList.map(m => (
                              <div key={m.id} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-white border border-brand-100">
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-semibold text-slate-900 line-clamp-1">{m.customer_name || 'Client'}</div>
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[10px] text-slate-500">
                                    <span className="num">{new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                                    {m.method_name && <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">{m.method_name}</span>}
                                    {m.reason && <span className="line-clamp-1">{m.reason}</span>}
                                  </div>
                                </div>
                                <span className="text-xs font-bold text-brand-700 num shrink-0">+{formatFCFA(m.amount)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {depensesList.length > 0 && (
                      <div className={`rounded-xl border transition-all duration-200 ${detailExpanded === 'depenses' ? 'border-red-300 bg-red-50/40' : 'border-slate-200 bg-white'}`}>
                        <button onClick={() => setDetailExpanded(detailExpanded === 'depenses' ? null : 'depenses')} className="w-full flex items-center justify-between px-3 py-2.5 text-left">
                          <div className="flex items-center gap-2">
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${detailExpanded === 'depenses' ? 'bg-red-200 text-red-800' : 'bg-red-100 text-red-700'}`}>
                              <ArrowUpRight className="w-3.5 h-3.5" />
                            </div>
                            <div>
                              <div className="text-xs font-bold text-slate-800">Décaissements</div>
                              <div className="text-[10px] text-slate-500">{depensesList.length} dépense{depensesList.length > 1 ? 's' : ''}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-red-700 num">-{formatFCFA(depensesTotal)}</span>
                            <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${detailExpanded === 'depenses' ? 'rotate-90' : ''}`} />
                          </div>
                        </button>
                        {detailExpanded === 'depenses' && (
                          <div className="px-3 pb-3 space-y-1.5 max-h-72 overflow-y-auto animate-in fade-in slide-in-from-top-1 duration-200">
                            {depensesList.map(m => (
                              <div key={m.id} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-white border border-red-100">
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-semibold text-slate-900 line-clamp-1">{m.reason || 'Dépense'}</div>
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[10px] text-slate-500">
                                    <span className="num">{new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                                    {m.method_name && <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">{m.method_name}</span>}
                                  </div>
                                </div>
                                <span className="text-xs font-bold text-red-700 num shrink-0">-{formatFCFA(m.amount)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}

              {/* Ventes */}
              <div className={`rounded-xl border transition-all duration-200 ${detailExpanded === 'ventes' ? 'border-brand-300 bg-brand-50/30 order-first' : 'border-slate-200 bg-white'}`}>
                <button onClick={() => setDetailExpanded(detailExpanded === 'ventes' ? null : 'ventes')} className="w-full flex items-center justify-between px-3 py-2.5 text-left">
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${detailExpanded === 'ventes' ? 'bg-brand-200 text-brand-800' : 'bg-slate-100 text-slate-700'}`}>
                      <Package className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-800">Ventes de la session</div>
                      <div className="text-[10px] text-slate-500">{detail.sales.length} vente{detail.sales.length > 1 ? 's' : ''}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-800 num">{formatFCFA(detail.sales.reduce((s, x) => s + x.total, 0))}</span>
                    <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${detailExpanded === 'ventes' ? 'rotate-90' : ''}`} />
                  </div>
                </button>
                {detailExpanded === 'ventes' && (
                  <div className="px-3 pb-3 space-y-1 animate-in fade-in slide-in-from-top-1 duration-200">
                    {detail.sales.length === 0 ? (
                      <div className="py-3 text-center text-xs text-slate-500">Aucune vente.</div>
                    ) : detail.sales.map(s => (
                      <div key={s.id} className="flex items-center gap-2 p-2 rounded-lg bg-white border border-slate-100 hover:border-brand-200 transition">
                        <div className="w-6 h-6 rounded-md bg-brand-50 flex items-center justify-center shrink-0">
                          <Wallet className="w-3 h-3 text-brand-700" />
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
                  </div>
                )}
              </div>

              {/* Controle de caisse */}
              {detail.controls.length > 0 && (
                <div className={`rounded-xl border transition-all duration-200 ${detailExpanded === 'controle' ? 'border-amber-300 bg-amber-50/30 order-first' : 'border-slate-200 bg-white'}`}>
                  <button onClick={() => setDetailExpanded(detailExpanded === 'controle' ? null : 'controle')} className="w-full flex items-center justify-between px-3 py-2.5 text-left">
                    <div className="flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${detailExpanded === 'controle' ? 'bg-amber-200 text-amber-800' : 'bg-amber-100 text-amber-700'}`}>
                        <Check className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-800">Controle de caisse</div>
                        <div className="text-[10px] text-slate-500">{detail.controls.length} methode{detail.controls.length > 1 ? 's' : ''}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${detailExpanded === 'controle' ? 'rotate-90' : ''}`} />
                    </div>
                  </button>
                  {detailExpanded === 'controle' && (
                    <div className="px-3 pb-3 animate-in fade-in slide-in-from-top-1 duration-200">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {detail.controls.map((c, i) => {
                          const diff = Number(c.difference_amount);
                          const balanced = diff === 0;
                          return (
                            <div key={i} className={`rounded-lg border p-2.5 ${balanced ? 'border-slate-100 bg-white' : diff < 0 ? 'border-red-100 bg-red-50/40' : 'border-amber-100 bg-amber-50/40'}`}>
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
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Regularizations inline if any */}
            {detail.regularizations.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Regularisations ({detail.regularizations.length})</div>
                {detail.regularizations.map((r, i) => (
                  <div key={i} className={`flex items-center justify-between p-2 rounded-lg text-xs ${r.reg_type === 'manquant' ? 'bg-red-50 border border-red-100' : r.reg_type === 'excedent' ? 'bg-amber-50 border border-amber-100' : 'bg-slate-50 border border-slate-100'}`}>
                    <div className="min-w-0 truncate">
                      <span className="font-semibold capitalize">{r.reg_type}</span>
                      {r.reason && <span className="text-slate-600 ml-2">-- {r.reason}</span>}
                    </div>
                    <span className="font-bold num shrink-0 ml-2">{formatFCFA(r.amount)}</span>
                  </div>
                ))}
              </div>
            )}

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
                    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Note cloture</div>
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
