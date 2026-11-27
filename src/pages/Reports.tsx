import { useRealtimeTick } from '../lib/useRealtimeData';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, Printer, Eye, Calendar, ChevronDown, Store, ArrowLeft, RefreshCw,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { SearchableSelect } from '../components/SearchableSelect';
import { PremiumDateRangePicker } from '../components/PremiumDateRangePicker';
import { ReportScreen } from '../components/reports/ReportScreen';
import { ReportSkeleton } from '../components/reports/reportPrimitives';
import {
  CashScopeFilters, EMPTY_SCOPE, parseScopeOptions, scopeLabel,
  type CashScopeOptions, type CashScopeSelection,
} from '../components/reports/CashScopeFilters';
import { registerText } from '../lib/cashSession';
import {
  a4Style, buildReportHtml, printDoc, isoDate, labelRange,
  fetchCashStats, fetchArticleStats, fetchCustomerStats,
  fetchSupplierStats, fetchExpenseStats, fetchTiersBalanceStats,
  type DateRange, type ReportType, type ReportData, type TenantMeta,
} from '../components/reports/reportEngine';

const REPORT_DEFS: {
  key: ReportType; label: string; context: string; hasMargin: boolean; hasZeroToggle: boolean;
}[] = [
  { key: 'cash',          label: 'Caisse',            context: 'Flux de trésorerie réels — entrées, sorties et solde théorique', hasMargin: true,  hasZeroToggle: false },
  { key: 'articles',      label: 'Articles',          context: "Classement des articles vendus par chiffre d'affaires net",      hasMargin: true,  hasZeroToggle: false },
  { key: 'customers',     label: 'Clients',           context: 'Activité de la période et situation financière',                 hasMargin: true,  hasZeroToggle: false },
  { key: 'suppliers',     label: 'Fournisseurs',      context: 'Achats, règlements et dette par fournisseur',                    hasMargin: false, hasZeroToggle: false },
  { key: 'expenses',      label: 'Dépenses',          context: "Charges d'exploitation et résultat",                             hasMargin: false, hasZeroToggle: false },
  { key: 'tiers_balance', label: 'Balance des tiers', context: 'Créances, dettes et position nette à une date',                  hasMargin: false, hasZeroToggle: true },
];

function isMobile() {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 768;
}

const REPORT_CHANGES: Record<string, readonly string[]> = {
  cash: ['cash_sessions', 'cash_movements', 'cash_regularizations', 'cash_control_lines', 'sales', 'sale_payments', 'sale_returns', 'customer_payments', 'supplier_payments', 'expense_categories'],
  articles: ['articles', 'sales', 'sale_items', 'sale_returns', 'stock_levels'],
  customers: ['customers', 'sales', 'sale_payments', 'customer_payments', 'customer_prepayments', 'sale_returns'],
  suppliers: ['suppliers', 'supplier_orders', 'supplier_order_items', 'supplier_payments'],
  expenses: ['cash_movements', 'expense_categories', 'expense_category_site_settings'],
  tiers_balance: ['customers', 'suppliers', 'sales', 'sale_payments', 'supplier_orders', 'supplier_payments', 'customer_payments', 'balance_adjustments'],
};

export function Reports() {
  const { tenant, sites, currentSite, refresh } = useApp();
  const { error: toastError } = useToast();

  const [reportType, setReportType] = useState<ReportType>('cash');
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'screen' | 'preview'>('screen');

  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedSiteId, setSelectedSiteId] = useState<string | 'all'>('all');
  const [savingMargin, setSavingMargin] = useState(false);
  const [hideZeroBalances, setHideZeroBalances] = useState(false);
  const [scopeOptions, setScopeOptions] = useState<CashScopeOptions | null>(null);
  const [scope, setScope] = useState<CashScopeSelection>(EMPTY_SCOPE);

  const marginInReports = !!(tenant as any)?.settings?.show_margin_in_reports;
  const [showMargin, setShowMargin] = useState(marginInReports);

  const [range, setRange] = useState<DateRange>(() => {
    const now = new Date();
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
  });

  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [previewScale, setPreviewScale] = useState(1);
  const [mobile, setMobile] = useState(isMobile);
  const reqToken = useRef(0);
  const cashScopeTick = useRealtimeTick(['cash_sessions', 'cash_registers', 'cash_register_assignments', 'profiles', 'sites']);
  const reportTick = useRealtimeTick(REPORT_CHANGES[reportType] || []);

  useEffect(() => {
    if (currentSite && selectedSiteId === 'all' && sites.length <= 1) {
      setSelectedSiteId(currentSite.id);
    }
  }, [currentSite?.id, sites.length]);

  useEffect(() => {
    setShowMargin(marginInReports);
  }, [marginInReports]);

  useEffect(() => {
    const check = () => setMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const selectedSite = sites.find(s => s.id === selectedSiteId);
  const siteName = selectedSiteId === 'all' ? undefined : selectedSite?.name;
  const siteIdParam = selectedSiteId === 'all' ? undefined : selectedSiteId;

  const tenantMeta: TenantMeta = {
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

  const selectSite = (id: string | 'all') => {
    setSelectedSiteId(id);
    setScope(EMPTY_SCOPE);
  };

  useEffect(() => {
    if (!tenant) return;
    let cancelled = false;
    (async () => {
      const { data: raw, error } = await supabase.rpc('get_cash_scope_options', {
        p_site_id: siteIdParam ?? null,
        p_cash_register_id: scope.registerId || null,
        p_user_id: scope.userId || null,
        p_from: isoDate(range.from),
        p_to: isoDate(range.to),
      });
      if (cancelled) return;
      const opts = error ? null : parseScopeOptions(raw);
      setScopeOptions(opts);
      if (!opts) { setScope(s => (s.registerId || s.userId || s.sessionId ? EMPTY_SCOPE : s)); return; }
      setScope(s => {
        const next = { ...s };
        if (next.registerId && !opts.registers.some(r => r.id === next.registerId)) next.registerId = '';
        if (next.userId && !opts.cashiers.some(c => c.id === next.userId)) next.userId = '';
        if (next.sessionId && !opts.sessions.some(x => x.id === next.sessionId)) next.sessionId = '';
        return next.registerId === s.registerId && next.userId === s.userId && next.sessionId === s.sessionId ? s : next;
      });
    })();
    return () => { cancelled = true; };
  }, [tenant?.id, selectedSiteId, scope.registerId, scope.userId, range.from, range.to, cashScopeTick]);

  const multi = !!scopeOptions;

  // Load only the active report; refresh on tab / period / site / scope change.
  useEffect(() => {
    if (!tenant) return;
    const token = ++reqToken.current;
    const from = isoDate(range.from);
    const to = isoDate(range.to);
    const tenantId = tenant.id;
    setLoading(true);
    setErrorMsg(null);

    (async () => {
      try {
        let next: ReportData;
        if (reportType === 'cash') {
          next = {
            type: 'cash',
            stats: await fetchCashStats(tenantId, siteIdParam, from, to, {
              cashRegisterId: scope.registerId || undefined,
              userId: scope.userId || undefined,
              cashSessionId: scope.sessionId || undefined,
            }),
          };
        } else if (reportType === 'articles') {
          next = { type: 'articles', rows: await fetchArticleStats(tenantId, siteIdParam, from, to) };
        } else if (reportType === 'customers') {
          next = { type: 'customers', stats: await fetchCustomerStats(tenantId, siteIdParam, from, to) };
        } else if (reportType === 'suppliers') {
          next = { type: 'suppliers', stats: await fetchSupplierStats(tenantId, siteIdParam, from, to) };
        } else if (reportType === 'expenses') {
          next = { type: 'expenses', stats: await fetchExpenseStats(tenantId, siteIdParam, from, to) };
        } else {
          next = { type: 'tiers_balance', stats: await fetchTiersBalanceStats(tenantId, from, to, selectedSiteId === 'all' ? null : selectedSiteId) };
        }
        if (token !== reqToken.current) return;
        setData(next);
        setErrorMsg(null);
      } catch (e: any) {
        if (token !== reqToken.current) return;
        // Keep the last valid report on screen; show a short message.
        setErrorMsg(e?.message || 'Impossible de charger le rapport.');
      } finally {
        if (token === reqToken.current) setLoading(false);
      }
    })();
  }, [tenant?.id, reportType, range.from, range.to, selectedSiteId, scope.registerId, scope.userId, scope.sessionId, reportTick]);

  const reload = () => setRange(r => ({ ...r }));

  useEffect(() => {
    if (viewMode !== 'preview' || !previewContainerRef.current) return;
    const obs = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w) setPreviewScale(Math.min(1, (w - 32) / 793));
    });
    obs.observe(previewContainerRef.current);
    return () => obs.disconnect();
  }, [viewMode]);

  const toggleMargin = async (val: boolean) => {
    setShowMargin(val);
    if (!tenant) return;
    setSavingMargin(true);
    const current = (tenant as any)?.settings || {};
    await supabase.from('tenants').update({ settings: { ...current, show_margin_in_reports: val } }).eq('id', tenant.id);
    setSavingMargin(false);
    refresh();
  };

  const def = REPORT_DEFS.find(d => d.key === reportType)!;
  const matches = data && data.type === reportType;

  const [extraRegisters, setExtraRegisters] = useState<Record<string, { code: string; name: string }>>({});
  useEffect(() => {
    if (!data || data.type !== 'cash' || !data.stats.parCaisse || !scopeOptions) return;
    const known = new Set(scopeOptions.registers.map(r => r.id));
    const missing = data.stats.parCaisse
      .filter(b => b.bucket === 'register' && b.id && !known.has(b.id) && !extraRegisters[b.id])
      .map(b => b.id as string);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data: rows, error } = await supabase.rpc('get_cash_register_labels', { p_ids: missing });
      if (cancelled) return;
      const list = !error && Array.isArray(rows) ? rows as { id: string; code: string; name: string }[] : [];
      setExtraRegisters(prev => {
        const next = { ...prev };
        for (const id of missing) next[id] = next[id] || { code: '', name: '' };
        for (const r of list) next[r.id] = { code: r.code, name: r.name };
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [data, scopeOptions, extraRegisters]);

  const viewData = useMemo<ReportData | null>(() => {
    if (!data || data.type !== 'cash' || !data.stats.parCaisse || !scopeOptions) return data;
    const names = new Map<string, string>(Object.entries(extraRegisters).map(([id, r]) => [id, registerText(r.code, r.name)]));
    for (const r of scopeOptions.registers) names.set(r.id, registerText(r.code, r.name));
    return {
      ...data,
      stats: {
        ...data.stats,
        parCaisse: data.stats.parCaisse.map(b =>
          b.bucket === 'register' && b.id && names.has(b.id) ? { ...b, label: names.get(b.id)! } : b),
      },
    };
  }, [data, scopeOptions, extraRegisters]);

  const headerLabel = scopeOptions
    ? [siteName, reportType === 'cash' ? scopeLabel(scopeOptions, scope) : scopeLabel(scopeOptions, EMPTY_SCOPE)]
        .filter(Boolean).join(' │ ')
    : siteName;

  const buildHtml = () => {
    if (!matches || !viewData) return '';
    return buildReportHtml(viewData, tenantMeta, range, showMargin, headerLabel, hideZeroBalances);
  };

  const handlePrint = () => {
    if (!matches) { toastError('Le rapport est encore en cours de chargement.'); return; }
    printDoc(buildHtml());
  };

  const openPreview = () => {
    if (!matches) { toastError('Le rapport est encore en cours de chargement.'); return; }
    setViewMode('preview');
  };

  return (
    <div className="flex min-w-0 flex-col" style={{ minHeight: 'calc(100vh - 160px)' }}>

      {/* ── Header : title + context + actions ── */}
      <div className="sm:sticky sm:top-0 z-10 -mx-3 sm:-mx-5 lg:-mx-8 px-3 sm:px-5 lg:px-8 -mt-3 sm:-mt-4 lg:-mt-6 pt-3 sm:pt-4 lg:pt-6 bg-[var(--w-surface)] border-b border-[var(--w-separator)]">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 border-b border-[var(--w-separator)] pb-3">
          <div className="min-w-0 flex-1 basis-48">
            <h1 className="text-lg font-bold leading-tight text-[var(--w-text)]">Rapports</h1>
            <p className="mt-0.5 break-words text-xs text-[var(--w-text-sec)]">{def.label} │ {def.context}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {!mobile && (
              <button onClick={openPreview} className="btn-secondary px-2.5 py-1.5 text-xs">
                <Eye className="h-4 w-4" /> Aperçu
              </button>
            )}
            <button
              onClick={handlePrint}
              className="btn-secondary px-2.5 py-1.5 text-xs"
            >
              <Printer className="h-4 w-4" /> Imprimer
            </button>
          </div>
        </div>

        {/* Tabs */}
        <nav aria-label="Types de rapport" className="flex min-w-0 items-center gap-4 overflow-x-auto overscroll-x-contain border-b border-[var(--w-separator)] sm:gap-5">
          {REPORT_DEFS.map(d => {
            const active = reportType === d.key;
            return (
              <button
                key={d.key}
                onClick={() => { setReportType(d.key); setViewMode('screen'); }}
                aria-current={active ? 'true' : undefined}
                className={`shrink-0 border-b-2 py-2.5 text-[13px] transition-colors ${
                  active ? 'border-[var(--w-text)] font-semibold text-[var(--w-text)]' : 'border-transparent text-[var(--w-text-sec)] hover:text-[var(--w-text)]'
                }`}
              >
                {d.label}
              </button>
            );
          })}
        </nav>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 py-2">
          <button
            onClick={() => setPickerOpen(v => !v)}
            aria-expanded={pickerOpen}
            aria-label={`Période │ ${labelRange(range)}`}
            className="btn-ghost min-w-0 px-2.5 py-1.5 text-xs"
          >
            <Calendar className="h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words text-left">{labelRange(range)}</span>
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${pickerOpen ? 'rotate-180' : ''}`} />
          </button>

          {sites.length > 1 && (
            <div className="flex min-w-0 max-w-full items-center gap-2 px-2.5 text-[var(--w-text-sec)]">
              <Store className="h-4 w-4 shrink-0" aria-hidden="true" />
              <SearchableSelect ariaLabel="Point de vente" value={selectedSiteId} onChange={selectSite}
                className="min-w-0 max-w-60" searchable={sites.length > 8} clearable={false} wrapLabels
                options={[{ value: 'all', label: 'Tous les sites' }, ...sites.map(site => ({ value: site.id, label: site.name }))]} />
            </div>
          )}

          {multi && reportType === 'cash' && scopeOptions && (
            <CashScopeFilters options={scopeOptions} value={scope} onChange={setScope} />
          )}

          {def.hasMargin && (
            <label className="btn-ghost cursor-pointer px-2.5 py-1.5 text-xs">
              <input type="checkbox" checked={showMargin} disabled={savingMargin} onChange={e => toggleMargin(e.target.checked)} className="h-4 w-4 shrink-0 accent-neutral-900" />
              Afficher les marges
            </label>
          )}

          {def.hasZeroToggle && (
            <label className="btn-ghost cursor-pointer px-2.5 py-1.5 text-xs">
              <input type="checkbox" checked={hideZeroBalances} onChange={e => setHideZeroBalances(e.target.checked)} className="h-4 w-4 shrink-0 accent-neutral-900" />
              Masquer les soldes nuls
            </label>
          )}

          {loading && matches && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-neutral-400">
              <Loader2 className="w-3 h-3 animate-spin" /> Actualisation…
            </span>
          )}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 min-h-0 min-w-0 pt-5">
        {viewMode === 'preview' && !mobile ? (
          <div className="flex flex-col h-full">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--w-separator)] pb-3">
              <button onClick={() => setViewMode('screen')} className="btn-ghost px-2.5 py-1.5 text-xs">
                <ArrowLeft className="w-4 h-4" /> Retour au rapport
              </button>
              <span className="text-xs text-[var(--w-text-sec)]">Aperçu avant impression │ {def.label}</span>
              <button onClick={handlePrint} className="btn-secondary px-2.5 py-1.5 text-xs">
                <Printer className="w-4 h-4" /> Imprimer
              </button>
            </div>
            <div ref={previewContainerRef} className="flex-1 min-h-0 overflow-y-auto bg-neutral-100 p-4 sm:p-8 flex justify-center">
              <div
                className="print-preview origin-top"
                style={{
                  width: '793px',
                  minHeight: `${Math.round(1122 * previewScale)}px`,
                  padding: '68px',
                  transform: `scale(${previewScale})`,
                  transformOrigin: 'top center',
                  background: '#fff',
                  color: '#111',
                  colorScheme: 'light',
                }}
              >
                <style>{a4Style()}</style>
                <div dangerouslySetInnerHTML={{ __html: buildHtml() }} />
              </div>
            </div>
          </div>
        ) : (
          <div className="pb-10">
            {errorMsg && (
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-l-2 border-neutral-900 pl-3 py-2">
                <p className="text-[12px] text-neutral-600">{errorMsg}</p>
                <button onClick={reload} className="btn-secondary shrink-0 px-2.5 py-1.5 text-xs">
                  <RefreshCw className="w-3.5 h-3.5" /> Réessayer
                </button>
              </div>
            )}
            {multi && headerLabel && (
              <p className="mb-4 text-[11px] text-neutral-500 leading-relaxed">{headerLabel}</p>
            )}
            {matches && viewData ? (
              <ReportScreen data={viewData} showMargin={showMargin} hideZero={hideZeroBalances} range={range} />
            ) : loading ? (
              <ReportSkeleton />
            ) : (
              !errorMsg && <ReportSkeleton />
            )}
          </div>
        )}
      </div>

      <PremiumDateRangePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        from={isoDate(range.from)}
        to={isoDate(range.to)}
        onApply={(from, to) => {
          setRange({ from: new Date(from), to: new Date(to) });
          setPickerOpen(false);
        }}
      />
    </div>
  );
}
