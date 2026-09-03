import { useEffect, useRef, useState } from 'react';
import {
  Loader2, Printer, Eye, Calendar, ChevronDown, Store, Check, ArrowLeft, RefreshCw,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { PremiumDateRangePicker } from '../components/PremiumDateRangePicker';
import { ReportScreen } from '../components/reports/ReportScreen';
import { ReportSkeleton } from '../components/reports/reportPrimitives';
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

export function Reports() {
  const { tenant, sites, currentSite, refresh } = useApp();
  const { error: toastError } = useToast();

  const [reportType, setReportType] = useState<ReportType>('cash');
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'screen' | 'preview'>('screen');

  const [pickerOpen, setPickerOpen] = useState(false);
  const [siteDropOpen, setSiteDropOpen] = useState(false);
  const [selectedSiteId, setSelectedSiteId] = useState<string | 'all'>('all');
  const [savingMargin, setSavingMargin] = useState(false);
  const [hideZeroBalances, setHideZeroBalances] = useState(false);

  const [showMargin, setShowMargin] = useState<boolean>(() =>
    !!(tenant as any)?.settings?.show_margin_in_reports
  );

  const [range, setRange] = useState<DateRange>(() => {
    const now = new Date();
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
  });

  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [previewScale, setPreviewScale] = useState(1);
  const [mobile, setMobile] = useState(isMobile);
  const reqToken = useRef(0);

  useEffect(() => {
    if (currentSite && selectedSiteId === 'all' && sites.length <= 1) {
      setSelectedSiteId(currentSite.id);
    }
  }, [currentSite?.id, sites.length]);

  useEffect(() => {
    if (tenant) setShowMargin(!!(tenant as any)?.settings?.show_margin_in_reports);
  }, [tenant?.id]);

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

  // Load only the active report; refresh on tab / period / site change.
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
          next = { type: 'cash', stats: await fetchCashStats(tenantId, siteIdParam, from, to) };
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
  }, [tenant?.id, reportType, range.from, range.to, selectedSiteId]);

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

  const buildHtml = () => {
    if (!matches) return '';
    return buildReportHtml(data!, tenantMeta, range, showMargin, siteName, hideZeroBalances);
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
    <div className="flex flex-col gap-0" style={{ minHeight: 'calc(100vh - 160px)' }}>

      {/* ── Header : title + context + actions ── */}
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-5 lg:-mx-8 px-3 sm:px-5 lg:px-8 -mt-3 sm:-mt-4 lg:-mt-6 pt-3 sm:pt-4 lg:pt-6 bg-white shrink-0">
        <div className="flex items-center gap-3 pb-3 border-b border-neutral-200">
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-tight text-neutral-900 leading-none">Rapports</h1>
            <p className="mt-1 text-[11px] sm:text-xs text-neutral-500 truncate">{def.label} · {def.context}</p>
          </div>
          <div className="flex-1" />
          {!mobile && (
            <button
              onClick={openPreview}
              className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1.5 text-[12px] font-medium text-neutral-500 hover:text-neutral-900 transition-colors"
            >
              <Eye className="w-4 h-4" />
              <span className="hidden md:inline">Aperçu</span>
            </button>
          )}
          <button
            onClick={handlePrint}
            className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1.5 text-[12px] font-medium text-neutral-700 hover:text-neutral-900 transition-colors"
          >
            <Printer className="w-4 h-4" />
            <span className="hidden sm:inline">Imprimer</span>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-5 overflow-x-auto no-scrollbar border-b border-neutral-200">
          {REPORT_DEFS.map(d => {
            const active = reportType === d.key;
            return (
              <button
                key={d.key}
                onClick={() => { setReportType(d.key); setViewMode('screen'); }}
                className={`relative shrink-0 py-2.5 text-[13px] transition-colors ${
                  active ? 'text-neutral-900 font-semibold' : 'text-neutral-400 hover:text-neutral-600'
                }`}
              >
                {d.label}
                {active && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-neutral-900" />}
              </button>
            );
          })}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 py-2.5 flex-wrap">
          <button
            onClick={() => setPickerOpen(v => !v)}
            className="flex items-center gap-1.5 text-[12px] font-medium text-neutral-600 hover:text-neutral-900 transition-colors whitespace-nowrap border-b border-transparent hover:border-neutral-300 pb-0.5"
          >
            <Calendar className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
            <span>{labelRange(range)}</span>
            <ChevronDown className={`w-3 h-3 text-neutral-400 shrink-0 transition-transform ${pickerOpen ? 'rotate-180' : ''}`} />
          </button>

          {sites.length > 1 && (
            <div className="relative">
              <button
                onClick={() => setSiteDropOpen(v => !v)}
                className="flex items-center gap-1.5 text-[12px] font-medium text-neutral-600 hover:text-neutral-900 transition-colors whitespace-nowrap border-b border-transparent hover:border-neutral-300 pb-0.5"
              >
                <Store className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                <span>{selectedSiteId === 'all' ? 'Tous les sites' : (selectedSite?.name || 'Site')}</span>
                <ChevronDown className={`w-3 h-3 text-neutral-400 shrink-0 transition-transform ${siteDropOpen ? 'rotate-180' : ''}`} />
              </button>
              {siteDropOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setSiteDropOpen(false)} />
                  <div className="absolute top-full left-0 mt-1 z-30 bg-white border border-neutral-200 shadow-lg py-1 min-w-[180px]">
                    <button
                      onClick={() => { setSelectedSiteId('all'); setSiteDropOpen(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-[12px] transition-colors ${selectedSiteId === 'all' ? 'text-neutral-900 font-semibold' : 'text-neutral-600 hover:bg-neutral-50'}`}
                    >
                      <span>Tous les sites</span>
                      {selectedSiteId === 'all' && <Check className="w-3.5 h-3.5 ml-auto text-neutral-900" />}
                    </button>
                    {sites.map(s => (
                      <button key={s.id}
                        onClick={() => { setSelectedSiteId(s.id); setSiteDropOpen(false); }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-[12px] transition-colors ${selectedSiteId === s.id ? 'text-neutral-900 font-semibold' : 'text-neutral-600 hover:bg-neutral-50'}`}
                      >
                        <span className="truncate">{s.name}</span>
                        {selectedSiteId === s.id && <Check className="w-3.5 h-3.5 ml-auto text-neutral-900 shrink-0" />}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {def.hasMargin && (
            <button
              onClick={() => toggleMargin(!showMargin)}
              disabled={savingMargin}
              className="shrink-0 flex items-center gap-2 text-[12px] font-medium text-neutral-600 hover:text-neutral-900 transition-colors disabled:opacity-40"
            >
              <span>Afficher les marges</span>
              <span className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${showMargin ? 'bg-neutral-900' : 'bg-neutral-200'}`}>
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${showMargin ? 'translate-x-4' : 'translate-x-0'}`} />
              </span>
            </button>
          )}

          {def.hasZeroToggle && (
            <button
              onClick={() => setHideZeroBalances(v => !v)}
              className="shrink-0 flex items-center gap-2 text-[12px] font-medium text-neutral-600 hover:text-neutral-900 transition-colors"
            >
              <span>Masquer les soldes nuls</span>
              <span className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${hideZeroBalances ? 'bg-neutral-900' : 'bg-neutral-200'}`}>
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${hideZeroBalances ? 'translate-x-4' : 'translate-x-0'}`} />
              </span>
            </button>
          )}

          {loading && matches && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-neutral-400">
              <Loader2 className="w-3 h-3 animate-spin" /> Actualisation…
            </span>
          )}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 min-h-0 pt-5">
        {viewMode === 'preview' && !mobile ? (
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-neutral-200">
              <button onClick={() => setViewMode('screen')} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-neutral-600 hover:text-neutral-900 transition-colors">
                <ArrowLeft className="w-4 h-4" /> Retour au rapport
              </button>
              <span className="text-[12px] text-neutral-400">Aperçu avant impression — {def.label}</span>
              <button onClick={handlePrint} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-neutral-700 hover:text-neutral-900 transition-colors">
                <Printer className="w-4 h-4" /> Imprimer
              </button>
            </div>
            <div ref={previewContainerRef} className="flex-1 min-h-0 overflow-y-auto bg-neutral-100 p-4 sm:p-8 flex justify-center">
              <div
                className="bg-white origin-top"
                style={{
                  width: '793px',
                  minHeight: `${Math.round(1122 * previewScale)}px`,
                  padding: '68px',
                  transform: `scale(${previewScale})`,
                  transformOrigin: 'top center',
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
              <div className="mb-5 flex items-center justify-between gap-3 border-l-2 border-neutral-900 pl-3 py-2">
                <p className="text-[12px] text-neutral-600">{errorMsg}</p>
                <button onClick={reload} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-neutral-700 hover:text-neutral-900 shrink-0">
                  <RefreshCw className="w-3.5 h-3.5" /> Réessayer
                </button>
              </div>
            )}
            {matches ? (
              <ReportScreen data={data!} showMargin={showMargin} hideZero={hideZeroBalances} range={range} />
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
