import { useState, useEffect, useCallback, useMemo } from 'react';
import { ArrowDownLeft, ArrowUpRight, RefreshCw, BarChart3, Settings2, Plus, Search, X, Check, AlertTriangle, Loader2, CreditCard as Edit2, Trash2, ArrowRightLeft, Banknote, Clock, CheckCircle2, XCircle, ChevronDown, TrendingUp, Wallet, MapPin, User, FileText, Lock, PlayCircle, ShieldCheck, Smartphone, Activity, Package, Users } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { usePermissions } from '../lib/permissions';

type SubPage = 'dashboard' | 'operations' | 'operations_grossiste' | 'soldes' | 'clotures' | 'rapports' | 'parametres';

const SUB_NAV: { key: SubPage; label: string; icon: any }[] = [
  { key: 'dashboard', label: 'Tableau de bord', icon: BarChart3 },
  { key: 'operations', label: 'Opérations clients', icon: RefreshCw },
  { key: 'operations_grossiste', label: 'Opérations grossiste', icon: Package },
  { key: 'soldes', label: 'Soldes', icon: Wallet },
  { key: 'clotures', label: 'Clôtures', icon: Lock },
  { key: 'rapports', label: 'Rapports', icon: FileText },
  { key: 'parametres', label: 'Paramètres', icon: Settings2 },
];

const OP_TYPE_LABELS: Record<string, string> = {
  depot: 'Total dépôt du jour',
  retrait: 'Total retrait du jour',
  vente_credit: 'Vente crédit du jour',
  reappro_credit: 'Réapprovisionnement stock crédit',
  ajustement_credit: 'Ajustement stock crédit',
  achat_uv: 'Achat UV',
  recharge_grossiste: 'Recharge via grossiste',
  dechargement_grossiste: 'Déchargement vers grossiste',
  versement_banque: 'Recharge via grossiste (ancien)',
  retrait_banque: 'Déchargement vers grossiste (ancien)',
  transfert_interne: 'Transfert interne',
  transfert_service: 'Transfert service',
  ajustement: 'Ajustement',
  annulation: 'Annulation',
};

const STATUS_LABELS: Record<string, string> = {
  brouillon: 'Brouillon',
  validee: 'Validée',
  en_attente: 'En attente',
  annulee: 'Annulée',
  rapprochee: 'Rapprochée',
  rejetee: 'Rejetée',
  ecart_detecte: 'Écart détecté',
};

const STATUS_COLORS: Record<string, string> = {
  brouillon: 'bg-neutral-100 text-neutral-700',
  validee: 'bg-emerald-50 text-emerald-700',
  en_attente: 'bg-amber-50 text-amber-700',
  annulee: 'bg-red-50 text-red-600',
  rapprochee: 'bg-sky-50 text-sky-700',
  rejetee: 'bg-red-50 text-red-600',
  ecart_detecte: 'bg-orange-50 text-orange-700',
};

function fmt(n: number | null | undefined): string {
  if (n == null) return '0';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n);
}

export function MoneyTransfer() {
  const { tenant } = useApp();
  const { can, loading: permsLoading } = usePermissions();
  const [sub, setSub] = useState<SubPage>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [initStatus, setInitStatus] = useState<string>('loading');

  const loadInitStatus = useCallback(async () => {
    if (!tenant) return;
    const { data } = await supabase.from('mt_init_status').select('status').eq('tenant_id', tenant.id).maybeSingle();
    setInitStatus(data?.status || 'non_initialise');
  }, [tenant]);

  useEffect(() => { loadInitStatus(); }, [loadInitStatus]);

  const isInitialized = initStatus === 'valide';
  const blockedPages: SubPage[] = ['operations', 'operations_grossiste', 'soldes', 'clotures', 'rapports'];

  const isNavVisible = (key: SubPage): boolean => {
    if (permsLoading) return true;
    if (key === 'operations_grossiste') return can('mt_wholesaler_operation_view');
    if (key === 'parametres') return can('mt_settings_manage');
    if (key === 'rapports') return can('mt_report_view_site');
    return true;
  };

  return (
    <div className="h-full flex flex-col">
      {/* Sous-navigation */}
      <div className="shrink-0 border-b border-neutral-200 bg-white">
        {/* Desktop */}
        <div className="hidden lg:flex items-center gap-1 px-4 pt-2 overflow-x-auto scrollbar-hide">
          {SUB_NAV.filter(n => isNavVisible(n.key)).map(n => (
            <button
              key={n.key}
              onClick={() => setSub(n.key)}
              className={`flex items-center gap-2 px-3 py-2.5 text-xs font-medium rounded-t-lg border-b-2 transition-all whitespace-nowrap ${
                sub === n.key
                  ? 'border-neutral-900 text-neutral-900 bg-neutral-50'
                  : 'border-transparent text-neutral-500 hover:text-neutral-700 hover:bg-neutral-50'
              } ${!isInitialized && blockedPages.includes(n.key) ? 'opacity-40 pointer-events-none' : ''}`}
            >
              <n.icon className="w-3.5 h-3.5" />
              {n.label}
              {!isInitialized && blockedPages.includes(n.key) && <Lock className="w-3 h-3 text-neutral-400" />}
            </button>
          ))}
        </div>
        {/* Mobile */}
        <div className="lg:hidden px-3 py-2">
          <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-neutral-200 bg-white">
            <span className="flex items-center gap-2 text-sm font-medium text-neutral-900">
              {(() => { const c = SUB_NAV.find(n => n.key === sub); return c ? <><c.icon className="w-4 h-4" />{c.label}</> : null; })()}
            </span>
            <ChevronDown className={`w-4 h-4 text-neutral-400 transition-transform ${mobileMenuOpen ? 'rotate-180' : ''}`} />
          </button>
          {mobileMenuOpen && (
            <div className="absolute left-3 right-3 mt-1 bg-white border border-neutral-200 rounded-lg shadow-lg z-50 py-1">
              {SUB_NAV.filter(n => isNavVisible(n.key) && (isInitialized || !blockedPages.includes(n.key))).map(n => (
                <button key={n.key} onClick={() => { setSub(n.key); setMobileMenuOpen(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm ${sub === n.key ? 'bg-neutral-50 font-medium text-neutral-900' : 'text-neutral-600 hover:bg-neutral-50'}`}>
                  <n.icon className="w-4 h-4" />{n.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Zone de contenu */}
      <div className="flex-1 overflow-y-auto p-4 lg:p-6">
        {sub === 'dashboard' && <MTDashboard isInitialized={isInitialized} onGoInit={() => setSub('parametres')} />}
        {sub === 'operations' && isInitialized && <MTOperations />}
        {sub === 'operations_grossiste' && isInitialized && can('mt_wholesaler_operation_view') && <MTWholesalerOperations />}
        {sub === 'soldes' && isInitialized && <MTBalances />}
        {sub === 'clotures' && isInitialized && <MTClosures />}
        {sub === 'rapports' && isInitialized && can('mt_report_view_site') && <MTReports />}
        {sub === 'parametres' && can('mt_settings_manage') && <MTSettings onValidated={() => { loadInitStatus(); setSub('dashboard'); }} />}
        {!isInitialized && blockedPages.includes(sub) && <BlockedMessage onGoInit={() => setSub('parametres')} />}
      </div>
    </div>
  );
}

function BlockedMessage({ onGoInit }: { onGoInit: () => void }) {
  return (
    <div className="max-w-[600px] mx-auto py-16 text-center">
      <div className="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-4">
        <AlertTriangle className="w-7 h-7 text-amber-500" />
      </div>
      <h3 className="text-base font-semibold text-neutral-900 mb-2">Module non initialisé</h3>
      <p className="text-sm text-neutral-500 mb-6">Veuillez initialiser les soldes d'ouverture avant de commencer les opérations.</p>
      <button onClick={onGoInit} className="px-4 py-2.5 text-sm font-medium bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 transition-colors">
        Initialiser les soldes
      </button>
    </div>
  );
}

/* ============================================ */
/* DASHBOARD                                    */
/* ============================================ */
function MTDashboard({ isInitialized, onGoInit }: { isInitialized: boolean; onGoInit: () => void }) {
  const { tenant, profile } = useApp();
  const [loading, setLoading] = useState(true);
  const [points, setPoints] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [todayOps, setTodayOps] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [pointServices, setPointServices] = useState<any[]>([]);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenant || !isInitialized) { setLoading(false); return; }
    const today = new Date().toISOString().split('T')[0];
    const [{ data: pts }, { data: svcs }, { data: accs }, { data: ops }, { data: profs }, { data: ps }] = await Promise.all([
      supabase.from('mt_service_points').select('*').eq('tenant_id', tenant.id).eq('status', 'active').order('name'),
      supabase.from('mt_services').select('*').eq('tenant_id', tenant.id).eq('status', 'active'),
      supabase.from('mt_accounts').select('*').eq('tenant_id', tenant.id),
      supabase.from('mt_operations').select('*').eq('tenant_id', tenant.id).gte('operated_at', today + 'T00:00:00').order('operated_at', { ascending: false }).limit(100),
      supabase.from('profiles').select('id, full_name').eq('tenant_id', tenant.id),
      supabase.from('mt_service_point_services').select('*').eq('tenant_id', tenant.id),
    ]);
    setPoints(pts || []);
    setServices(svcs || []);
    setAccounts(accs || []);
    setTodayOps(ops || []);
    setProfiles(profs || []);
    setPointServices(ps || []);
    setLoading(false);
  }, [tenant, isInitialized]);

  useEffect(() => { load(); }, [load]);

  const getUserName = (userId: string | null) => {
    if (!userId) return 'Système';
    const p = profiles.find(pr => pr.id === userId);
    return p?.full_name || 'Utilisateur';
  };

  const getPointName = (pointId: string | null) => {
    if (!pointId) return '—';
    const p = points.find(pt => pt.id === pointId);
    return p?.name || '—';
  };

  const getServiceName = (serviceId: string | null) => {
    if (!serviceId) return '';
    const s = services.find(sv => sv.id === serviceId);
    return s?.name || '';
  };

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-5 h-5 animate-spin text-neutral-400" /></div>;

  if (!isInitialized) {
    return (
      <div className="max-w-[700px] mx-auto py-10">
        <div className="bg-white border border-neutral-200 rounded-xl p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-5">
            <PlayCircle className="w-8 h-8 text-amber-500" />
          </div>
          <h2 className="text-lg font-bold text-neutral-900 mb-2">Module Transfert d'argent non initialisé</h2>
          <p className="text-sm text-neutral-500 mb-6 max-w-md mx-auto">
            Veuillez configurer les points de service, les services de transfert et les soldes d'ouverture avant de commencer les opérations.
          </p>
          <button onClick={onGoInit} className="px-5 py-2.5 text-sm font-medium bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 transition-colors flex items-center gap-2 mx-auto">
            <PlayCircle className="w-4 h-4" />Initialiser les soldes
          </button>
          <div className="mt-8 pt-6 border-t border-neutral-100 text-left">
            <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-3">Étapes requises</h4>
            <div className="space-y-2">
              {[['1', 'Configurer au moins un point de service'], ['2', 'Configurer au moins un service de transfert'], ['3', 'Renseigner les soldes d\'ouverture'], ['4', 'Valider l\'initialisation']].map(([n, l]) => (
                <div key={n} className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-neutral-100 flex items-center justify-center text-xs font-bold text-neutral-600">{n}</span>
                  <span className="text-sm text-neutral-600">{l}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Filter ops by selected point
  const filteredOps = selectedPointId
    ? todayOps.filter(o => o.service_point_id === selectedPointId)
    : todayOps;
  const validOps = filteredOps.filter(o => o.status === 'validee');
  const isOpeningOp = (o: any) => o.reference === 'INIT-OUVERTURE' || o.reference === 'OUVERTURE-JOUR';

  // Global stats (filtered)
  const filteredAccounts = selectedPointId
    ? accounts.filter(a => a.service_point_id === selectedPointId)
    : accounts;
  const totalCash = filteredAccounts.filter(a => a.type === 'cash').reduce((s, a) => s + Number(a.balance), 0);
  const totalUV = filteredAccounts.filter(a => a.type === 'uv').reduce((s, a) => s + Number(a.balance), 0);
  const deposits = validOps.filter(o => o.type === 'depot').reduce((s, o) => s + Number(o.amount), 0);
  const withdrawals = validOps.filter(o => o.type === 'retrait').reduce((s, o) => s + Number(o.amount), 0);
  const opsCount = validOps.filter(o => !isOpeningOp(o)).length;
  const totalCredit = filteredAccounts.filter(a => a.type === 'stock_credit').reduce((s, a) => s + Number(a.balance), 0);
  const creditSales = validOps.filter(o => o.type === 'vente_credit').reduce((s, o) => s + Number(o.amount), 0);
  const uvAlerts = filteredAccounts.filter(a => a.type === 'uv' && Number(a.balance) < 50000).length;
  const creditAlerts = filteredAccounts.filter(a => a.type === 'stock_credit' && Number(a.balance) < 20000).length;
  const totalAlerts = uvAlerts + creditAlerts;

  // Per-service stats (filtered)
  const serviceStats = services.map(svc => {
    const svcOps = validOps.filter(o => o.service_id === svc.id);
    return {
      id: svc.id,
      name: svc.name,
      deposits: svcOps.filter(o => o.type === 'depot').reduce((s, o) => s + Number(o.amount), 0),
      withdrawals: svcOps.filter(o => o.type === 'retrait').reduce((s, o) => s + Number(o.amount), 0),
      opsCount: svcOps.filter(o => !isOpeningOp(o)).length,
      uvBalance: filteredAccounts.filter(a => a.type === 'uv' && a.service_id === svc.id).reduce((s, a) => s + Number(a.balance), 0),
    };
  }).filter(s => s.opsCount > 0 || s.uvBalance > 0);

  // Per-point stats (always all points for the multi-point view)
  const pointStats = points.map(pt => {
    const ptAccounts = accounts.filter(a => a.service_point_id === pt.id);
    const ptOps = todayOps.filter(o => o.service_point_id === pt.id && o.status === 'validee');
    const ptSvcs = pointServices.filter(ps => ps.service_point_id === pt.id);
    return {
      id: pt.id,
      name: pt.name,
      cash: ptAccounts.filter(a => a.type === 'cash').reduce((s, a) => s + Number(a.balance), 0),
      uv: ptAccounts.filter(a => a.type === 'uv').reduce((s, a) => s + Number(a.balance), 0),
      deposits: ptOps.filter(o => o.type === 'depot').reduce((s, o) => s + Number(o.amount), 0),
      withdrawals: ptOps.filter(o => o.type === 'retrait').reduce((s, o) => s + Number(o.amount), 0),
      opsCount: ptOps.filter(o => !isOpeningOp(o)).length,
      servicesCount: ptSvcs.length,
      volume: ptOps.filter(o => !isOpeningOp(o)).reduce((s, o) => s + Number(o.amount), 0),
    };
  });

  // Top points ranking
  const topPoints = [...pointStats].sort((a, b) => b.opsCount - a.opsCount || b.volume - a.volume);

  return (
    <div className="-mx-1 sm:-mx-2 lg:mx-0 space-y-2.5 lg:space-y-4 lg:max-w-[1400px] lg:mx-auto">

      {/* ── MOBILE HERO: Tableau de bord Transfert ── */}
      <div className="lg:hidden">
        <div
          className="w-full relative overflow-hidden rounded-[18px] p-4"
          style={{ background: 'linear-gradient(160deg, #0a0a0a 0%, #171717 35%, #262626 65%, #404040 100%)', boxShadow: '0 16px 32px -8px rgba(0,0,0,0.55), 0 6px 12px -4px rgba(0,0,0,0.25)' }}
        >
          <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-[18px]">
            <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-gradient-to-br from-white/5 to-transparent blur-3xl" />
            <div className="absolute -bottom-20 -left-10 w-48 h-48 rounded-full bg-gradient-to-tr from-white/3 to-transparent blur-3xl" />
          </div>
          <div className="relative">
            {/* Header with module name + point context */}
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-white/70" />
                <span className="text-[10px] font-bold text-white/90">Transfert d'argent</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-bold text-white/50 num">
                  {new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
                <button onClick={() => load()} className="p-1 rounded-full hover:bg-white/10 transition-colors">
                  <RefreshCw className="w-3 h-3 text-white/60" />
                </button>
              </div>
            </div>

            {/* Point de service context */}
            <div className="flex items-center gap-1.5 mb-3">
              <MapPin className="w-2.5 h-2.5 text-sky-400" />
              <span className="text-[9px] font-semibold text-sky-300/80">
                {selectedPointId ? getPointName(selectedPointId) : `Tous les points (${points.length})`}
              </span>
              {selectedPointId && (
                <button onClick={() => setSelectedPointId(null)} className="ml-1 text-white/40 hover:text-white"><X className="w-2.5 h-2.5" /></button>
              )}
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-auto" />
              <span className="text-[8px] font-bold uppercase tracking-wider text-emerald-400/80">En direct</span>
            </div>

            {/* Alert banner if any */}
            {totalAlerts > 0 && (
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-rose-500/15 border border-rose-400/20 mb-3">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                <span className="text-[9px] font-bold text-rose-200">
                  {totalAlerts} {totalAlerts > 1 ? 'comptes' : 'compte'} en solde bas
                  {uvAlerts > 0 && <span className="text-rose-300/70"> ({uvAlerts} UV{creditAlerts > 0 ? `, ${creditAlerts} crédit` : ''})</span>}
                  {uvAlerts === 0 && creditAlerts > 0 && <span className="text-rose-300/70"> ({creditAlerts} crédit)</span>}
                </span>
              </div>
            )}

            {/* Main Amount - Liquidités totales */}
            <div className="mb-3">
              <p className="text-[9px] font-bold uppercase tracking-[0.07em] text-white/50 mb-0.5">Liquidités totales (Cash + UV + Crédit)</p>
              <p className="text-[clamp(24px,8vw,32px)] font-black text-white num leading-none">{fmt(totalCash + totalUV + totalCredit)} <span className="text-[11px] font-normal text-white/40">FCFA</span></p>
            </div>

            {/* Key metrics grid */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="rounded-lg bg-white/5 border border-white/8 px-2.5 py-2">
                <p className="text-[8px] font-bold uppercase tracking-wider text-white/50 mb-0.5">Caisse</p>
                <p className="text-[13px] font-black num text-white">{fmt(totalCash)}</p>
              </div>
              <div className="rounded-lg bg-white/5 border border-white/8 px-2.5 py-2">
                <p className="text-[8px] font-bold uppercase tracking-wider text-sky-400/70 mb-0.5">Solde UV</p>
                <p className="text-[13px] font-black num text-sky-300">{fmt(totalUV)}</p>
              </div>
              <div className="rounded-lg bg-white/5 border border-white/8 px-2.5 py-2">
                <p className="text-[8px] font-bold uppercase tracking-wider text-amber-400/70 mb-0.5">Stock crédit</p>
                <p className="text-[13px] font-black num text-amber-300">{fmt(totalCredit)}</p>
              </div>
            </div>

            {/* Flows du jour */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="rounded-lg bg-white/5 border border-white/8 px-2.5 py-2">
                <p className="text-[8px] font-bold uppercase tracking-wider text-emerald-400/70 mb-0.5">Dépôts du jour</p>
                <p className="text-[13px] font-black num text-emerald-300">+{fmt(deposits)}</p>
              </div>
              <div className="rounded-lg bg-white/5 border border-white/8 px-2.5 py-2">
                <p className="text-[8px] font-bold uppercase tracking-wider text-rose-400/70 mb-0.5">Retraits du jour</p>
                <p className="text-[13px] font-black num text-rose-300">-{fmt(withdrawals)}</p>
              </div>
            </div>

            {/* Activity summary row */}
            <div className="flex items-center justify-between py-2 rounded-lg bg-white/5 border border-white/8 px-2.5">
              <div className="flex items-center gap-1.5">
                <Activity className="w-3 h-3 text-white/50" />
                <span className="text-[9px] font-bold text-white/60">Opérations du jour</span>
              </div>
              <span className="text-[13px] font-black num text-white/90">{opsCount}</span>
            </div>

            {/* Credit sales row if any */}
            {creditSales > 0 && (
              <div className="flex items-center justify-between py-2 mt-2 rounded-lg bg-amber-500/10 border border-amber-400/15 px-2.5">
                <div className="flex items-center gap-1.5">
                  <Smartphone className="w-3 h-3 text-amber-400" />
                  <span className="text-[9px] font-bold text-amber-300/80">Ventes crédit du jour</span>
                </div>
                <span className="text-[13px] font-black num text-amber-300">{fmt(creditSales)}</span>
              </div>
            )}

            {/* Footer - derniere operation */}
            {filteredOps.length > 0 && (
              <div className="flex items-center gap-1.5 pt-2 mt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <Clock className="w-3 h-3 text-white/30" />
                <span className="text-[9px] text-white/40">Dernière opération à {new Date(filteredOps[0].operated_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── DESKTOP: Situation du jour (left) + 3 cards (right) ── */}
      <div className="hidden lg:grid grid-cols-[minmax(0,2fr)_380px] gap-4">

        {/* Situation du jour */}
        <div
          className="relative overflow-hidden rounded-xl p-5 flex flex-col"
          style={{ background: 'linear-gradient(160deg, #0a0a0a 0%, #171717 35%, #262626 65%, #404040 100%)', boxShadow: '0 16px 32px -8px rgba(0,0,0,0.55), 0 6px 12px -4px rgba(0,0,0,0.25)', minHeight: 320 }}
        >
          <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-xl">
            <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-gradient-to-br from-white/5 to-transparent blur-3xl" />
            <div className="absolute -bottom-20 -left-10 w-48 h-48 rounded-full bg-gradient-to-tr from-white/3 to-transparent blur-3xl" />
          </div>
          <div className="relative flex flex-col h-full">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-white/70" />
                <h3 className="text-base font-bold text-white">Situation du jour</h3>
              </div>
              <div className="flex items-center gap-2">
                {selectedPointId && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/20 border border-sky-400/30 text-sky-200">
                    <MapPin className="w-3 h-3" />{getPointName(selectedPointId)}
                    <button onClick={() => setSelectedPointId(null)} className="ml-0.5 hover:text-white"><X className="w-3 h-3" /></button>
                  </span>
                )}
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-white/10 border border-white/15 text-white/80">
                  <Clock className="w-3 h-3" />
                  {new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                </span>
              </div>
            </div>

            {/* KPI Grid - 4 main totals */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="rounded-lg px-3.5 py-3 flex flex-col justify-center border bg-white/6 border-white/8">
                <p className="text-[10px] font-medium uppercase tracking-wide mb-1 text-white/50">Total dépôts</p>
                <p className="text-xl font-bold num leading-tight text-emerald-300">{fmt(deposits)} <span className="text-[10px] font-normal text-white/40">FCFA</span></p>
              </div>
              <div className="rounded-lg px-3.5 py-3 flex flex-col justify-center border bg-white/6 border-white/8">
                <p className="text-[10px] font-medium uppercase tracking-wide mb-1 text-white/50">Total retraits</p>
                <p className="text-xl font-bold num leading-tight text-rose-300">{fmt(withdrawals)} <span className="text-[10px] font-normal text-white/40">FCFA</span></p>
              </div>
              <div className="rounded-lg px-3.5 py-3 flex flex-col justify-center border bg-white/6 border-white/8">
                <p className="text-[10px] font-medium uppercase tracking-wide mb-1 text-white/50">Total UV restant</p>
                <p className="text-xl font-bold num leading-tight text-amber-300">{fmt(totalUV)} <span className="text-[10px] font-normal text-white/40">FCFA</span></p>
              </div>
              <div className="rounded-lg px-3.5 py-3 flex flex-col justify-center border bg-white/6 border-white/8">
                <p className="text-[10px] font-medium uppercase tracking-wide mb-1 text-white/50">Total cash restant</p>
                <p className="text-xl font-bold num leading-tight text-white">{fmt(totalCash)} <span className="text-[10px] font-normal text-white/40">FCFA</span></p>
              </div>
            </div>

            {/* Secondary stats */}
            <div className="grid grid-cols-2 gap-3 flex-1">
              <div className="rounded-lg px-3.5 py-2.5 flex flex-col justify-center border bg-white/4 border-white/6">
                <p className="text-[10px] font-medium uppercase tracking-wide mb-0.5 text-white/40">Opérations</p>
                <p className="text-base font-bold num leading-tight text-white/90">{opsCount}</p>
              </div>
              <div className="rounded-lg px-3.5 py-2.5 flex flex-col justify-center border bg-white/4 border-white/6">
                <p className="text-[10px] font-medium uppercase tracking-wide mb-0.5 text-white/40">Points actifs</p>
                <p className="text-base font-bold num leading-tight text-white/90">{points.length}</p>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-3 mt-3 border-t border-white/10">
              {filteredOps.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-white/40">
                  <Clock className="w-3.5 h-3.5" />
                  Dernière opération à {new Date(filteredOps[0].operated_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
              <button onClick={() => load()} className="flex items-center gap-1 text-xs font-semibold text-white/80 hover:text-white ml-auto transition-colors">
                <RefreshCw className="w-3.5 h-3.5" /> Actualiser
              </button>
            </div>
          </div>
        </div>

        {/* Right column: 3 cards */}
        <div className="flex flex-col gap-3">
          {/* Top points de service */}
          <div className="bg-white rounded-xl border border-neutral-200 px-4 py-3.5 overflow-hidden">
            <div className="flex items-center gap-2 mb-2.5">
              <TrendingUp className="w-4 h-4 text-neutral-700" />
              <h3 className="text-sm font-bold text-neutral-900">Top points de service</h3>
            </div>
            {topPoints.length === 0 ? (
              <p className="text-xs text-neutral-400">Aucune activité</p>
            ) : (
              <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: 200 }}>
                {topPoints.slice(0, 5).map((pt, i) => (
                  <div key={pt.id} className="flex items-center gap-2">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-neutral-100 text-neutral-600' : 'bg-orange-50 text-orange-600'}`}>{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-neutral-900 truncate">{pt.name}</p>
                      <p className="text-[10px] text-neutral-400">{pt.opsCount} op. · Dép: {fmt(pt.deposits)} · Ret: {fmt(pt.withdrawals)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Liquidités totales */}
          <div className="flex-1 bg-white rounded-xl border border-neutral-200 px-4 py-3.5">
            <div className="flex items-center gap-2 mb-1.5">
              <Wallet className="w-4 h-4 text-neutral-600" />
              <h3 className="text-sm font-bold text-neutral-900">Liquidités totales</h3>
            </div>
            <p className="text-xl font-bold text-neutral-900 num tracking-tight">{fmt(totalCash + totalUV)} <span className="text-xs font-normal text-neutral-400">FCFA</span></p>
            <p className="text-[11px] text-neutral-400 mt-0.5">Cash: {fmt(totalCash)} + UV: {fmt(totalUV)}</p>
          </div>

          {/* Alertes soldes */}
          <div className="flex-1 bg-white rounded-xl border border-neutral-200 px-4 py-3.5">
            <div className="flex items-center gap-2 mb-1.5">
              <AlertTriangle className={`w-4 h-4 ${uvAlerts > 0 ? 'text-orange-500' : 'text-neutral-400'}`} />
              <h3 className="text-sm font-bold text-neutral-900">Alertes soldes bas</h3>
            </div>
            <p className={`text-xl font-bold num tracking-tight ${uvAlerts > 0 ? 'text-orange-600' : 'text-neutral-900'}`}>{uvAlerts}</p>
            <p className="text-[11px] text-neutral-400 mt-0.5">Comptes UV en dessous de 50 000 FCFA</p>
          </div>
        </div>
      </div>

      {/* ── Détail par service ── */}
      {services.length > 0 && (
        <div className="bg-white rounded-[18px] lg:rounded-xl border border-neutral-200 overflow-hidden" style={{ boxShadow: '0 4px 20px rgba(15,23,42,0.08), 0 12px 40px rgba(15,23,42,0.05), 0 0 0 1px rgba(226,232,240,0.6)' }}>
          <div className="flex items-center gap-2.5 px-3.5 lg:px-4 py-2.5 lg:py-3 border-b border-neutral-100/50 bg-neutral-50/80">
            <ArrowRightLeft className="w-3.5 h-3.5 text-neutral-700" />
            <span className="text-[10px] lg:text-sm font-bold text-neutral-700 uppercase tracking-wider lg:tracking-normal lg:normal-case">Activité par service</span>
            <span className="text-[9px] lg:text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-100 text-neutral-700 font-bold border border-neutral-200">{services.length}</span>
          </div>
          {/* Mobile: horizontal scroll */}
          <div className="lg:hidden flex overflow-x-auto gap-2 p-3 snap-x snap-mandatory no-scrollbar">
            {services.map(svc => {
              const st = serviceStats.find(s => s.id === svc.id);
              const svcDeposits = st?.deposits || 0;
              const svcWithdrawals = st?.withdrawals || 0;
              const svcOps = st?.opsCount || 0;
              const svcUV = st?.uvBalance || 0;
              return (
                <div key={svc.id} className="snap-start shrink-0 w-[calc(50%-4px)] p-2.5 rounded-xl border border-neutral-200 bg-white">
                  <div className="flex items-center gap-1.5 mb-2">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${svcOps > 0 ? 'bg-sky-500' : 'bg-neutral-300'}`} />
                    <span className="text-[10px] font-bold text-neutral-800 truncate">{svc.name}</span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[8px] text-neutral-400 font-semibold">Dépôts</span>
                      <span className="text-[9px] font-bold text-emerald-700 num">{fmt(svcDeposits)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[8px] text-neutral-400 font-semibold">Retraits</span>
                      <span className="text-[9px] font-bold text-red-600 num">{fmt(svcWithdrawals)}</span>
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t border-neutral-100">
                      <span className="text-[8px] text-neutral-600 font-bold">Solde UV</span>
                      <span className="text-[9px] font-bold text-neutral-900 num">{fmt(svcUV)}</span>
                    </div>
                  </div>
                  <div className="mt-1.5 pt-1 border-t border-neutral-50">
                    <span className="text-[8px] text-neutral-400">{svcOps} op.</span>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Desktop: grid */}
          <div className="hidden lg:block p-4">
            <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${Math.min(services.length, 5)}, minmax(0, 1fr))` }}>
            {services.map(svc => {
              const st = serviceStats.find(s => s.id === svc.id);
              const svcDeposits = st?.deposits || 0;
              const svcWithdrawals = st?.withdrawals || 0;
              const svcOps = st?.opsCount || 0;
              const svcUV = st?.uvBalance || 0;
              return (
                <div key={svc.id} className="p-3 rounded-lg border border-neutral-200 bg-neutral-50/50">
                  <div className="flex items-center gap-1.5 mb-2">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${svcOps > 0 ? 'bg-sky-500' : 'bg-neutral-300'}`} />
                    <span className="text-[11px] font-bold text-neutral-900 truncate">{svc.name}</span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-neutral-400 font-semibold">Dépôts</span>
                      <span className="text-[11px] font-bold text-emerald-700 num">{fmt(svcDeposits)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-neutral-400 font-semibold">Retraits</span>
                      <span className="text-[11px] font-bold text-red-600 num">{fmt(svcWithdrawals)}</span>
                    </div>
                    <div className="flex items-center justify-between pt-1.5 border-t border-neutral-100">
                      <span className="text-[9px] text-neutral-600 font-bold">Solde UV</span>
                      <span className="text-[11px] font-black text-neutral-900 num">{fmt(svcUV)}</span>
                    </div>
                  </div>
                  <div className="mt-1.5 pt-1 border-t border-neutral-50">
                    <span className="text-[8px] text-neutral-400">{svcOps} opération{svcOps > 1 ? 's' : ''}</span>
                  </div>
                </div>
              );
            })}
            </div>
          </div>
        </div>
      )}

      {/* ── Points de service (multi-point like multi-store mobile) ── */}
      {pointStats.length > 0 && (
        <div className="bg-white rounded-[18px] lg:rounded-xl border border-neutral-200 overflow-hidden" style={{ boxShadow: '0 4px 20px rgba(15,23,42,0.08), 0 12px 40px rgba(15,23,42,0.05), 0 0 0 1px rgba(226,232,240,0.6)' }}>
          {/* Header */}
          <div className="flex items-center justify-between px-3.5 lg:px-4 py-2.5 lg:py-3 border-b border-neutral-100/50 bg-neutral-50/80">
            <div className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-neutral-700" />
              <span className="text-[10px] lg:text-sm font-bold text-neutral-700 uppercase tracking-wider lg:tracking-normal lg:normal-case">Points de service</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-100 text-neutral-700 font-bold border border-neutral-200">{points.length}</span>
            </div>
            <div className="flex items-center gap-2">
              {selectedPointId && (
                <button onClick={() => setSelectedPointId(null)} className="text-[10px] font-medium text-sky-600 hover:text-sky-800 transition-colors">
                  Tous
                </button>
              )}
              <span className="hidden lg:inline text-[11px] text-neutral-400">Cliquez pour filtrer</span>
            </div>
          </div>

          {/* Mobile: horizontal scroll cards */}
          <div className="lg:hidden flex overflow-x-auto gap-2 p-3 snap-x snap-mandatory no-scrollbar">
            {pointStats.map(pt => {
              const isSelected = selectedPointId === pt.id;
              return (
                <button
                  key={pt.id}
                  onClick={() => setSelectedPointId(isSelected ? null : pt.id)}
                  className={`snap-start shrink-0 w-[calc(50%-4px)] p-2.5 rounded-xl border text-left transition-all ${isSelected ? 'border-neutral-400 bg-neutral-50' : 'border-neutral-200 bg-white active:bg-neutral-50'}`}
                >
                  <div className="flex items-center gap-1.5 mb-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${pt.opsCount > 0 ? 'bg-emerald-500' : 'bg-neutral-300'}`} />
                    <span className="text-[10px] font-bold text-neutral-900 truncate">{pt.name}</span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[8px] text-neutral-400 font-semibold">Dépôts</span>
                      <span className="text-[9px] font-bold text-emerald-700 num">{fmt(pt.deposits)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[8px] text-neutral-400 font-semibold">Retraits</span>
                      <span className="text-[9px] font-bold text-red-600 num">{fmt(pt.withdrawals)}</span>
                    </div>
                    <div className="flex items-center justify-between pt-0.5 border-t border-neutral-100">
                      <span className="text-[8px] text-neutral-600 font-bold">Cash</span>
                      <span className="text-[9px] font-bold text-neutral-900 num">{fmt(pt.cash)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[8px] text-neutral-600 font-bold">UV</span>
                      <span className="text-[9px] font-bold text-neutral-900 num">{fmt(pt.uv)}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Desktop: grid */}
          <div className="hidden lg:block p-4">
            <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${Math.min(pointStats.length, 5)}, minmax(0, 1fr))` }}>
              {pointStats.slice(0, 10).map(pt => {
                const isSelected = selectedPointId === pt.id;
                return (
                  <button
                    key={pt.id}
                    onClick={() => setSelectedPointId(isSelected ? null : pt.id)}
                    className={`p-3 rounded-lg border text-left transition-all duration-200 ${isSelected ? 'border-sky-400 bg-sky-50/50 ring-1 ring-sky-200' : 'border-neutral-200 bg-white hover:border-neutral-300'}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${pt.opsCount > 0 ? 'bg-emerald-500' : 'bg-neutral-300'}`} />
                        <span className="text-[11px] font-bold text-neutral-900 truncate">{pt.name}</span>
                      </div>
                      {isSelected && <span className="text-[8px] font-bold text-sky-700 bg-sky-100 px-1.5 py-0.5 rounded shrink-0 ml-1">Filtre actif</span>}
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] text-neutral-400 font-semibold">Dépôts</span>
                        <span className="text-[11px] font-bold text-emerald-700 num">{fmt(pt.deposits)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] text-neutral-400 font-semibold">Retraits</span>
                        <span className="text-[11px] font-bold text-red-600 num">{fmt(pt.withdrawals)}</span>
                      </div>
                      <div className="flex items-center justify-between pt-1.5 border-t border-neutral-100">
                        <span className="text-[9px] text-neutral-600 font-bold">Cash</span>
                        <span className="text-[11px] font-black text-neutral-900 num">{fmt(pt.cash)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] text-neutral-600 font-bold">UV</span>
                        <span className="text-[11px] font-black text-neutral-900 num">{fmt(pt.uv)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 pt-1 border-t border-neutral-50">
                      <span className="text-[8px] text-neutral-400">{pt.opsCount} opération{pt.opsCount > 1 ? 's' : ''}</span>
                      <span className="text-[8px] text-neutral-400">{pt.servicesCount} service{pt.servicesCount > 1 ? 's' : ''}</span>
                    </div>
                  </button>
                );
              })}
            </div>
            {pointStats.length > 10 && (
              <div className="flex justify-end mt-2">
                <span className="text-[10px] text-neutral-400 font-medium">+{pointStats.length - 10} autre{pointStats.length - 10 > 1 ? 's' : ''} point{pointStats.length - 10 > 1 ? 's' : ''}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Dernières opérations ── */}
      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden flex flex-col" style={{ maxHeight: 420 }}>
        <div className="px-3.5 lg:px-5 py-3 lg:py-3.5 border-b border-neutral-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-neutral-700" />
            <h3 className="text-sm font-bold text-neutral-900">Dernières opérations</h3>
          </div>
          <span className="text-[10px] lg:text-xs text-neutral-400">{filteredOps.length} op.</span>
        </div>
        {filteredOps.length === 0 ? (
          <div className="py-16 text-center">
            <RefreshCw className="w-8 h-8 text-neutral-200 mx-auto mb-3" />
            <p className="text-sm text-neutral-400">Aucune opération {selectedPointId ? 'pour ce point' : "aujourd'hui"}</p>
          </div>
        ) : (
          <div className="divide-y divide-neutral-100 overflow-y-auto flex-1">
            {filteredOps.slice(0, 20).map(op => {
              const opTime = new Date(op.operated_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
              const isDeposit = op.type === 'depot';
              const isWithdraw = op.type === 'retrait';
              return (
                <div key={op.id} className="px-3.5 lg:px-5 py-3 flex items-center gap-2.5 lg:gap-3 hover:bg-neutral-50/50 transition-colors">
                  <div className={`w-8 h-8 lg:w-9 lg:h-9 rounded-full flex items-center justify-center shrink-0 ${isDeposit ? 'bg-emerald-50' : isWithdraw ? 'bg-red-50' : 'bg-neutral-100'}`}>
                    {isDeposit ? <ArrowDownLeft className="w-3.5 h-3.5 lg:w-4 lg:h-4 text-emerald-600" /> : isWithdraw ? <ArrowUpRight className="w-3.5 h-3.5 lg:w-4 lg:h-4 text-red-500" /> : <ArrowRightLeft className="w-3.5 h-3.5 lg:w-4 lg:h-4 text-neutral-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <p className="text-xs lg:text-sm font-semibold text-neutral-900 truncate">{OP_TYPE_LABELS[op.type] || op.type}</p>
                      {op.service_id && (
                        <span className="hidden sm:inline text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 font-medium shrink-0">{getServiceName(op.service_id)}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] lg:text-xs text-neutral-400 flex-wrap">
                      <span className="flex items-center gap-0.5">
                        <MapPin className="w-2.5 h-2.5 lg:w-3 lg:h-3" />{getPointName(op.service_point_id)}
                      </span>
                      <span className="text-neutral-200">|</span>
                      <span>{opTime}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-xs lg:text-sm font-bold num ${isDeposit ? 'text-emerald-700' : isWithdraw ? 'text-red-600' : 'text-neutral-900'}`}>
                      {isDeposit ? '+' : isWithdraw ? '-' : ''}{fmt(op.amount)}
                    </p>
                    <span className={`inline-block text-[9px] lg:text-[10px] font-medium px-1 lg:px-1.5 py-0.5 rounded mt-0.5 ${STATUS_COLORS[op.status] || 'bg-neutral-100 text-neutral-600'}`}>
                      {STATUS_LABELS[op.status] || op.status}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function KPICard({ label, value, suffix, icon: Icon, accent, warn }: { label: string; value: string; suffix?: string; icon: any; accent?: boolean; warn?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${warn ? 'border-orange-200 bg-orange-50/50' : accent ? 'border-emerald-200 bg-emerald-50/50' : 'border-neutral-200 bg-white'}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${warn ? 'text-orange-500' : accent ? 'text-emerald-600' : 'text-neutral-400'}`} />
        <span className="text-xs text-neutral-500">{label}</span>
      </div>
      <p className={`text-lg font-bold ${warn ? 'text-orange-700' : accent ? 'text-emerald-700' : 'text-neutral-900'}`}>
        {value} {suffix && <span className="text-xs font-normal text-neutral-400">{suffix}</span>}
      </p>
    </div>
  );
}

/* ============================================ */
/* INITIALISATION DES SOLDES                    */
/* ============================================ */
function MTInitialisation({ onValidated }: { onValidated: () => void }) {
  const { tenant, profile } = useApp();
  const toast = useToast();
  const [points, setPoints] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [pointServices, setPointServices] = useState<Record<string, string[]>>({});
  const [accounts, setAccounts] = useState<any[]>([]);
  const [initStatus, setInitStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [balanceInputs, setBalanceInputs] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!tenant) return;
    const [{ data: p }, { data: s }, { data: sps }, { data: st }, { data: existingBal }, { data: accs }] = await Promise.all([
      supabase.from('mt_service_points').select('*').eq('tenant_id', tenant.id).eq('status', 'active').order('name'),
      supabase.from('mt_services').select('*').eq('tenant_id', tenant.id).eq('status', 'active').order('name'),
      supabase.from('mt_service_point_services').select('*').eq('tenant_id', tenant.id),
      supabase.from('mt_init_status').select('*').eq('tenant_id', tenant.id).maybeSingle(),
      supabase.from('mt_init_balances').select('*').eq('tenant_id', tenant.id),
      supabase.from('mt_accounts').select('*').eq('tenant_id', tenant.id),
    ]);
    setPoints(p || []);
    setServices(s || []);
    setAccounts(accs || []);
    const map: Record<string, string[]> = {};
    (sps || []).forEach((x: any) => {
      if (!map[x.service_point_id]) map[x.service_point_id] = [];
      map[x.service_point_id].push(x.service_id);
    });
    setPointServices(map);
    setInitStatus(st);

    const inputs: Record<string, string> = {};
    (existingBal || []).forEach((b: any) => {
      const key = b.account_type === 'cash' ? `cash_${b.service_point_id}` : `uv_${b.service_point_id}_${b.service_id}`;
      inputs[key] = String(b.amount || 0);
    });
    setBalanceInputs(inputs);
    setLoading(false);
  }, [tenant]);

  useEffect(() => { load(); }, [load]);

  const isValidated = initStatus?.status === 'valide';

  const getInputKey = (type: 'cash' | 'uv', pointId: string, serviceId?: string) => {
    return type === 'cash' ? `cash_${pointId}` : `uv_${pointId}_${serviceId}`;
  };

  const setBalance = (key: string, value: string) => {
    setBalanceInputs(prev => ({ ...prev, [key]: value }));
  };

  const pointHasAccounts = (pointId: string) => accounts.some(a => a.service_point_id === pointId);
  const uninitializedPoints = points.filter(pt => !pointHasAccounts(pt.id));
  const initializedPoints = points.filter(pt => pointHasAccounts(pt.id));

  const displayPoints = isValidated ? uninitializedPoints : points;

  const totalCash = displayPoints.reduce((sum, pt) => sum + (Number(balanceInputs[getInputKey('cash', pt.id)] || 0)), 0);
  const totalUV = displayPoints.reduce((sum, pt) => {
    const svcIds = pointServices[pt.id] || [];
    return sum + svcIds.reduce((s, sid) => s + Number(balanceInputs[getInputKey('uv', pt.id, sid)] || 0), 0);
  }, 0);

  const hasAnyBalance = Object.values(balanceInputs).some(v => Number(v) > 0);
  const canValidate = !isValidated && hasAnyBalance && points.length > 0 && services.length > 0;
  const canInitNewPoints = isValidated && uninitializedPoints.length > 0;

  const validate = async () => {
    if (!tenant) return;
    setValidating(true);

    if (!isValidated) {
      if (initStatus) {
        await supabase.from('mt_init_status').update({ status: 'valide', initialized_at: new Date().toISOString(), initialized_by: profile?.id, updated_at: new Date().toISOString() }).eq('id', initStatus.id);
      } else {
        await supabase.from('mt_init_status').insert({ tenant_id: tenant.id, status: 'valide', initialized_at: new Date().toISOString(), initialized_by: profile?.id });
      }
      await supabase.from('mt_init_balances').delete().eq('tenant_id', tenant.id);
    }

    const pointsToInit = isValidated ? uninitializedPoints : points;

    for (const pt of pointsToInit) {
      const cashKey = getInputKey('cash', pt.id);
      const cashAmount = Number(balanceInputs[cashKey] || 0);

      await supabase.from('mt_init_balances').insert({ tenant_id: tenant.id, service_point_id: pt.id, service_id: null, account_type: 'cash', label: `Caisse - ${pt.name}`, amount: cashAmount, created_by: profile?.id });
      const { data: cashAcc } = await supabase.from('mt_accounts').insert({ tenant_id: tenant.id, service_point_id: pt.id, service_id: null, type: 'cash', label: `Caisse - ${pt.name}`, balance: cashAmount, currency: 'XOF' }).select('id').single();
      await supabase.from('mt_operations').insert({ tenant_id: tenant.id, service_point_id: pt.id, service_id: null, type: 'ajustement', amount: cashAmount, commission: 0, currency: 'XOF', dest_account_id: cashAcc?.id || null, reference: 'INIT-OUVERTURE', status: 'validee', comment: 'Solde d\'ouverture cash', operated_by: profile?.id, validated_by: profile?.id });

      const svcIds = pointServices[pt.id] || [];
      for (const sid of svcIds) {
        const uvKey = getInputKey('uv', pt.id, sid);
        const uvAmount = Number(balanceInputs[uvKey] || 0);
        const svc = services.find(x => x.id === sid);

        await supabase.from('mt_init_balances').insert({ tenant_id: tenant.id, service_point_id: pt.id, service_id: sid, account_type: 'uv', label: `UV ${svc?.name || ''} - ${pt.name}`, amount: uvAmount, created_by: profile?.id });
        const { data: uvAcc } = await supabase.from('mt_accounts').insert({ tenant_id: tenant.id, service_point_id: pt.id, service_id: sid, type: 'uv', label: `UV ${svc?.name || ''}`, balance: uvAmount, currency: 'XOF' }).select('id').single();
        await supabase.from('mt_operations').insert({ tenant_id: tenant.id, service_point_id: pt.id, service_id: sid, type: 'ajustement', amount: uvAmount, commission: 0, currency: 'XOF', dest_account_id: uvAcc?.id || null, reference: 'INIT-OUVERTURE', status: 'validee', comment: `Solde d'ouverture ${svc?.name || ''}`, operated_by: profile?.id, validated_by: profile?.id });
      }

    }

    setValidating(false);
    setShowConfirm(false);
    toast.success(isValidated ? 'Nouveau point initialisé avec succès.' : 'Initialisation validée. Le module est opérationnel.');
    if (!isValidated) onValidated();
    else load();
  };

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-5 h-5 animate-spin text-neutral-400" /></div>;

  return (
    <div className="max-w-[1100px] mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-neutral-900">Initialisation des soldes</h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            {isValidated && uninitializedPoints.length === 0
              ? 'Tous les points sont initialisés.'
              : isValidated && uninitializedPoints.length > 0
              ? `${uninitializedPoints.length} nouveau(x) point(s) à initialiser.`
              : 'Renseignez les soldes disponibles au démarrage pour chaque point et chaque service.'}
          </p>
        </div>
        {isValidated && uninitializedPoints.length === 0 && (
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />Tous initialisés
          </span>
        )}
      </div>

      {/* Pre-requisites check */}
      {!isValidated && (
        <div className="bg-white border border-neutral-200 rounded-xl p-4">
          <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-3">Pré-requis</h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${points.length > 0 ? 'border-emerald-200 bg-emerald-50/50' : 'border-orange-200 bg-orange-50/50'}`}>
              {points.length > 0 ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-orange-500" />}
              <span className="text-xs text-neutral-700">{points.length} point(s) de service</span>
            </div>
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${services.length > 0 ? 'border-emerald-200 bg-emerald-50/50' : 'border-orange-200 bg-orange-50/50'}`}>
              {services.length > 0 ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-orange-500" />}
              <span className="text-xs text-neutral-700">{services.length} service(s) actif(s)</span>
            </div>
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${Object.keys(pointServices).length > 0 ? 'border-emerald-200 bg-emerald-50/50' : 'border-orange-200 bg-orange-50/50'}`}>
              {Object.keys(pointServices).length > 0 ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-orange-500" />}
              <span className="text-xs text-neutral-700">Services associés aux points</span>
            </div>
          </div>
        </div>
      )}

      {/* Summary cards */}
      {hasAnyBalance && displayPoints.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <KPICard label="Cash total" value={fmt(totalCash)} suffix="FCFA" icon={Banknote} />
          <KPICard label="UV total" value={fmt(totalUV)} suffix="FCFA" icon={Wallet} />
          <KPICard label="Total actifs" value={fmt(totalCash + totalUV)} suffix="FCFA" icon={TrendingUp} accent />
        </div>
      )}

      {/* Already initialized points (info only) */}
      {isValidated && initializedPoints.length > 0 && uninitializedPoints.length > 0 && (
        <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-4">
          <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">Points déjà initialisés</h4>
          <div className="flex flex-wrap gap-2">
            {initializedPoints.map(pt => (
              <span key={pt.id} className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
                <CheckCircle2 className="w-3 h-3" />{pt.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Balance grids per point */}
      {displayPoints.length === 0 && !isValidated ? (
        <div className="bg-white border border-neutral-200 rounded-xl py-12 text-center">
          <MapPin className="w-10 h-10 text-neutral-300 mx-auto mb-3" />
          <p className="text-sm text-neutral-500">Aucun point de service configuré</p>
          <p className="text-xs text-neutral-400 mt-1">Créez d'abord vos points de service et associez-leur des services</p>
        </div>
      ) : displayPoints.length === 0 && isValidated ? (
        <div className="bg-white border border-neutral-200 rounded-xl py-12 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-300 mx-auto mb-3" />
          <p className="text-sm text-neutral-600">Tous les points de service sont initialisés</p>
          <p className="text-xs text-neutral-400 mt-1">Ajoutez un nouveau point de service pour pouvoir l'initialiser ici</p>
        </div>
      ) : (
        <div className="space-y-4">
          {displayPoints.map(pt => {
            const svcIds = pointServices[pt.id] || [];
            const pointSvcs = svcIds.map(sid => services.find(s => s.id === sid)).filter(Boolean);
            return (
              <div key={pt.id} className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-neutral-100 bg-neutral-50/50 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                    <MapPin className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-neutral-900">{pt.name}</h4>
                    <p className="text-[11px] text-neutral-400">{pt.code || pt.address || ''}{isValidated ? ' — Nouveau point' : ''}</p>
                  </div>
                </div>
                <div className="p-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {/* Cash balance */}
                    <div className="space-y-1.5">
                      <label className="flex items-center gap-2 text-[11px] font-medium text-neutral-500 uppercase tracking-wide">
                        <Banknote className="w-3.5 h-3.5 text-emerald-500" />Caisse (Cash)
                      </label>
                      <input
                        type="number"
                        value={balanceInputs[getInputKey('cash', pt.id)] || ''}
                        onChange={e => setBalance(getInputKey('cash', pt.id), e.target.value)}
                        placeholder="0"
                        className="input text-base font-semibold"
                      />
                    </div>
                    {/* UV per service */}
                    {pointSvcs.map(svc => (
                      <div key={svc.id} className="space-y-1.5">
                        <label className="flex items-center gap-2 text-[11px] font-medium text-neutral-500 uppercase tracking-wide">
                          {svc.logo_url ? <img src={svc.logo_url} alt="" className="w-4 h-4 rounded object-contain" /> : <Smartphone className="w-3.5 h-3.5 text-sky-500" />}
                          {svc.name}
                        </label>
                        <input
                          type="number"
                          value={balanceInputs[getInputKey('uv', pt.id, svc.id)] || ''}
                          onChange={e => setBalance(getInputKey('uv', pt.id, svc.id), e.target.value)}
                          placeholder="0"
                          className="input text-base font-semibold"
                        />
                      </div>
                    ))}
                  </div>
                  {pointSvcs.length === 0 && (
                    <p className="text-xs text-amber-600 mt-2">Aucun service associé à ce point. Allez dans "Points de service" pour en ajouter.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Validate button */}
      {(canValidate || canInitNewPoints) && (
        <div className="bg-white border border-neutral-200 rounded-xl p-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h4 className="text-sm font-semibold text-neutral-900">{isValidated ? 'Initialiser les nouveaux points' : 'Prêt à valider'}</h4>
              <p className="text-xs text-neutral-500 mt-0.5">
                {isValidated ? 'Les comptes seront créés pour les nouveaux points avec les soldes renseignés.' : 'Les comptes seront créés avec les soldes renseignés. Cette action est irréversible.'}
              </p>
            </div>
            <button onClick={() => setShowConfirm(true)} className="px-5 py-2.5 text-sm font-medium bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" />{isValidated ? 'Initialiser' : 'Valider l\'initialisation'}
            </button>
          </div>
        </div>
      )}

      {/* Confirmation modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl border border-neutral-200 shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-neutral-900">{isValidated ? 'Confirmer l\'initialisation' : 'Confirmer la validation'}</h3>
            <p className="text-sm text-neutral-600">Les soldes suivants seront créés :</p>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-neutral-500">Cash total</span><span className="font-semibold">{fmt(totalCash)} FCFA</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">UV total</span><span className="font-semibold">{fmt(totalUV)} FCFA</span></div>
              <div className="flex justify-between pt-2 border-t border-neutral-100"><span className="text-neutral-700 font-medium">Total actifs</span><span className="font-bold">{fmt(totalCash + totalUV)} FCFA</span></div>
              <div className="flex justify-between pt-2 border-t border-neutral-100"><span className="text-neutral-700 font-medium">Points concernés</span><span className="font-semibold">{displayPoints.length}</span></div>
            </div>
            <p className="text-xs text-amber-600 bg-amber-50 rounded-lg p-2">Les comptes seront créés et les opérations deviendront accessibles.</p>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setShowConfirm(false)} className="px-3 py-2 text-sm border border-neutral-200 rounded-lg hover:bg-neutral-50">Annuler</button>
              <button onClick={validate} disabled={validating} className="px-4 py-2 text-sm font-medium bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 disabled:opacity-50 flex items-center gap-2">
                {validating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Confirmer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================ */
/* POINTS DE SERVICE                            */
/* ============================================ */
function MTServicePoints() {
  const { tenant } = useApp();
  const toast = useToast();
  const [points, setPoints] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [pointServices, setPointServices] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', address: '', manager_name: '', phone: '', description: '', serviceIds: [] as string[] });
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenant) return;
    const [{ data: p }, { data: s }, { data: sps }] = await Promise.all([
      supabase.from('mt_service_points').select('*').eq('tenant_id', tenant.id).order('name'),
      supabase.from('mt_services').select('*').eq('tenant_id', tenant.id).eq('status', 'active').order('name'),
      supabase.from('mt_service_point_services').select('*').eq('tenant_id', tenant.id),
    ]);
    setPoints(p || []);
    setServices(s || []);
    const map: Record<string, string[]> = {};
    (sps || []).forEach((x: any) => {
      if (!map[x.service_point_id]) map[x.service_point_id] = [];
      map[x.service_point_id].push(x.service_id);
    });
    setPointServices(map);
    setLoading(false);
  }, [tenant]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!tenant || !form.name.trim()) return;
    setSaving(true);
    const { serviceIds, ...payload } = form;
    let pointId = editId;
    if (editId) {
      await supabase.from('mt_service_points').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editId);
    } else {
      const { data } = await supabase.from('mt_service_points').insert({ ...payload, tenant_id: tenant.id }).select('id').single();
      pointId = data?.id || null;
    }
    if (pointId) {
      await supabase.from('mt_service_point_services').delete().eq('service_point_id', pointId);
      if (serviceIds.length > 0) {
        await supabase.from('mt_service_point_services').insert(
          serviceIds.map(sid => ({ service_point_id: pointId!, service_id: sid, tenant_id: tenant.id }))
        );
      }
    }
    setSaving(false);
    setShowForm(false);
    setEditId(null);
    setForm({ name: '', code: '', address: '', manager_name: '', phone: '', description: '', serviceIds: [] });
    toast.success(editId ? 'Point de service modifié' : 'Point de service créé');
    load();
  };

  const edit = (p: any) => {
    setForm({ name: p.name, code: p.code || '', address: p.address || '', manager_name: p.manager_name || '', phone: p.phone || '', description: p.description || '', serviceIds: pointServices[p.id] || [] });
    setEditId(p.id);
    setShowForm(true);
  };

  const toggleStatus = async (p: any) => {
    await supabase.from('mt_service_points').update({ status: p.status === 'active' ? 'inactive' : 'active' }).eq('id', p.id);
    load();
  };

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-5 h-5 animate-spin text-neutral-400" /></div>;

  return (
    <div className="max-w-[1000px] mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-neutral-900">Points de service</h2>
        <button onClick={() => { setShowForm(true); setEditId(null); setForm({ name: '', code: '', address: '', manager_name: '', phone: '', description: '', serviceIds: [] }); }}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 transition-colors">
          <Plus className="w-4 h-4" />Ajouter
        </button>
      </div>

      {showForm && (
        <div className="bg-white border border-neutral-200 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-neutral-900">{editId ? 'Modifier le point de service' : 'Nouveau point de service'}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Nom *" className="input" />
            <input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="Code" className="input" />
            <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Adresse" className="input" />
            <input value={form.manager_name} onChange={e => setForm({ ...form, manager_name: e.target.value })} placeholder="Responsable" className="input" />
            <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Téléphone" className="input" />
            <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Description" className="input" />
          </div>
          {services.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-neutral-500 uppercase tracking-wide mb-2">Services effectués par ce point</p>
              <div className="flex flex-wrap gap-2">
                {services.map(s => (
                  <button key={s.id} type="button" onClick={() => {
                    setForm(f => ({ ...f, serviceIds: f.serviceIds.includes(s.id) ? f.serviceIds.filter(x => x !== s.id) : [...f.serviceIds, s.id] }));
                  }} className={`flex items-center gap-2 px-3 py-2 text-xs rounded-lg border transition-all ${form.serviceIds.includes(s.id) ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-400'}`}>
                    {s.logo_url ? <img src={s.logo_url} alt="" className="w-4 h-4 rounded object-contain" /> : <Smartphone className="w-3.5 h-3.5" />}
                    {s.name}
                    {form.serviceIds.includes(s.id) && <Check className="w-3 h-3" />}
                  </button>
                ))}
              </div>
              {form.serviceIds.length === 0 && (
                <p className="text-[11px] text-amber-600 mt-1.5">Sélectionnez au moins un service pour pouvoir initialiser les soldes de ce point.</p>
              )}
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <button onClick={() => { setShowForm(false); setEditId(null); }} className="px-3 py-2 text-sm border border-neutral-200 rounded-lg hover:bg-neutral-50">Annuler</button>
            <button onClick={save} disabled={saving || !form.name.trim()} className="px-4 py-2 text-sm font-medium bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{editId ? 'Modifier' : 'Créer'}
            </button>
          </div>
        </div>
      )}

      {points.length === 0 ? (
        <div className="bg-white border border-neutral-200 rounded-xl py-16 text-center">
          <MapPin className="w-10 h-10 text-neutral-300 mx-auto mb-3" />
          <p className="text-sm text-neutral-500">Aucun point de service configuré</p>
          <p className="text-xs text-neutral-400 mt-1">Créez votre premier point de service pour commencer</p>
        </div>
      ) : (
        <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden divide-y divide-neutral-100">
          {points.map(p => (
            <div key={p.id} className="px-4 py-3 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${p.status === 'active' ? 'bg-emerald-50' : 'bg-neutral-100'}`}>
                <MapPin className={`w-4 h-4 ${p.status === 'active' ? 'text-emerald-600' : 'text-neutral-400'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-neutral-900">{p.name}</p>
                <p className="text-xs text-neutral-400">{p.code ? `${p.code} · ` : ''}{p.address || 'Aucune adresse'}</p>
                {(pointServices[p.id] || []).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(pointServices[p.id] || []).map(sid => {
                      const svc = services.find(s => s.id === sid);
                      return svc ? <span key={sid} className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700">{svc.name}</span> : null;
                    })}
                  </div>
                )}
              </div>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${p.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-500'}`}>{p.status === 'active' ? 'Actif' : 'Inactif'}</span>
              <button onClick={() => edit(p)} className="p-1.5 rounded-lg hover:bg-neutral-100"><Edit2 className="w-3.5 h-3.5 text-neutral-400" /></button>
              <button onClick={() => toggleStatus(p)} className="p-1.5 rounded-lg hover:bg-neutral-100">{p.status === 'active' ? <XCircle className="w-3.5 h-3.5 text-neutral-400" /> : <CheckCircle2 className="w-3.5 h-3.5 text-neutral-400" />}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================ */
/* SERVICES                                     */
/* ============================================ */
function MTServices() {
  const { tenant } = useApp();
  const toast = useToast();
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'national', family: 'transfert', currency: 'XOF', alert_min_balance: '0', description: '' });
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string>('');
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const load = useCallback(async () => {
    if (!tenant) return;
    const { data } = await supabase.from('mt_services').select('*').eq('tenant_id', tenant.id).order('name');
    setServices(data || []);
    setLoading(false);
  }, [tenant]);

  useEffect(() => { load(); }, [load]);

  const uploadLogo = async (serviceId: string): Promise<string | null> => {
    if (!logoFile) return null;
    setUploadingLogo(true);
    const ext = logoFile.name.split('.').pop() || 'png';
    const path = `${tenant!.id}/${serviceId}.${ext}`;
    const { error } = await supabase.storage.from('mt-service-logos').upload(path, logoFile, { upsert: true });
    setUploadingLogo(false);
    if (error) { toast.error('Erreur upload logo'); return null; }
    const { data: urlData } = supabase.storage.from('mt-service-logos').getPublicUrl(path);
    return urlData.publicUrl;
  };

  const save = async () => {
    if (!tenant || !form.name.trim()) return;
    setSaving(true);
    const payload = { name: form.name, type: form.type, family: form.family, currency: form.currency, alert_min_balance: Number(form.alert_min_balance) || 0, description: form.description };
    let serviceId = editId;
    if (editId) {
      await supabase.from('mt_services').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editId);
    } else {
      const { data } = await supabase.from('mt_services').insert({ ...payload, tenant_id: tenant.id }).select('id').single();
      serviceId = data?.id || null;
      if (serviceId) {
        const { data: activePoints } = await supabase.from('mt_service_points').select('id').eq('tenant_id', tenant.id).eq('status', 'active');
        if (activePoints && activePoints.length > 0) {
          const accType = form.family === 'credit_telephone' ? 'stock_credit' : 'uv';
          const accLabel = form.family === 'credit_telephone' ? `Stock crédit ${form.name}` : `UV ${form.name}`;
          const newAccounts = activePoints.map(pt => ({
            tenant_id: tenant.id,
            service_point_id: pt.id,
            service_id: serviceId,
            type: accType,
            label: accLabel,
            currency: form.currency || 'XOF',
            balance: 0,
          }));
          await supabase.from('mt_accounts').insert(newAccounts);
        }
      }
    }
    if (serviceId && logoFile) {
      const logoUrl = await uploadLogo(serviceId);
      if (logoUrl) {
        await supabase.from('mt_services').update({ logo_url: logoUrl, updated_at: new Date().toISOString() }).eq('id', serviceId);
      }
    }
    setSaving(false);
    setShowForm(false);
    setEditId(null);
    setLogoFile(null);
    setLogoPreview('');
    setForm({ name: '', type: 'national', family: 'transfert', currency: 'XOF', alert_min_balance: '0', description: '' });
    toast.success(editId ? 'Service modifié' : 'Service créé et initialisé');
    load();
  };

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error('Le logo doit faire moins de 2 Mo'); return; }
    setLogoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setLogoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const removeLogo = async (s: any) => {
    if (!s.logo_url) return;
    await supabase.from('mt_services').update({ logo_url: null, updated_at: new Date().toISOString() }).eq('id', s.id);
    toast.success('Logo supprime');
    load();
  };

  const edit = (s: any) => {
    setForm({ name: s.name, type: s.type, family: s.family || 'transfert', currency: s.currency || 'XOF', alert_min_balance: String(s.alert_min_balance || 0), description: s.description || '' });
    setEditId(s.id);
    setLogoFile(null);
    setLogoPreview(s.logo_url || '');
    setShowForm(true);
  };

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-5 h-5 animate-spin text-neutral-400" /></div>;

  return (
    <div className="max-w-[1000px] mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-neutral-900">Services de transfert</h2>
        <button onClick={() => { setShowForm(true); setEditId(null); setLogoFile(null); setLogoPreview(''); setForm({ name: '', type: 'national', family: 'transfert', currency: 'XOF', alert_min_balance: '0', description: '' }); }}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 transition-colors">
          <Plus className="w-4 h-4" />Ajouter
        </button>
      </div>

      {showForm && (
        <div className="bg-white border border-neutral-200 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-neutral-900">{editId ? 'Modifier le service' : 'Nouveau service'}</h3>

          {/* Logo upload section */}
          <div className="flex items-start gap-4">
            <div className="shrink-0">
              <p className="text-[11px] font-medium text-neutral-500 uppercase tracking-wide mb-2">Logo</p>
              <div className="relative w-20 h-20 rounded-xl border-2 border-dashed border-neutral-300 hover:border-neutral-400 transition-colors overflow-hidden group">
                {logoPreview ? (
                  <>
                    <img src={logoPreview} alt="Logo" className="w-full h-full object-contain p-1" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <button onClick={() => { setLogoFile(null); setLogoPreview(''); }} className="p-1 rounded-full bg-white/90">
                        <X className="w-4 h-4 text-neutral-700" />
                      </button>
                    </div>
                  </>
                ) : (
                  <label className="absolute inset-0 flex flex-col items-center justify-center cursor-pointer">
                    <Plus className="w-5 h-5 text-neutral-400" />
                    <span className="text-[9px] text-neutral-400 mt-1">Max 2Mo</span>
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={handleLogoSelect} className="hidden" />
                  </label>
                )}
              </div>
            </div>
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Nom du service *" className="input" />
              <select value={form.family} onChange={e => setForm({ ...form, family: e.target.value })} className="input">
                <option value="transfert">Transfert d'argent</option>
                <option value="credit_telephone">Crédit téléphonique</option>
              </select>
              <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="input">
                <option value="national">National</option>
                <option value="international">International</option>
                <option value="mixte">Mixte</option>
              </select>
              <input value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} placeholder="Devise" className="input" />
              <input value={form.alert_min_balance} onChange={e => setForm({ ...form, alert_min_balance: e.target.value })} placeholder="Seuil alerte solde bas (FCFA)" type="number" className="input" />
              <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Description" className="input" />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={() => { setShowForm(false); setEditId(null); setLogoFile(null); setLogoPreview(''); }} className="px-3 py-2 text-sm border border-neutral-200 rounded-lg hover:bg-neutral-50">Annuler</button>
            <button onClick={save} disabled={saving || uploadingLogo || !form.name.trim()} className="px-4 py-2 text-sm font-medium bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 disabled:opacity-50 flex items-center gap-2">
              {(saving || uploadingLogo) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{editId ? 'Modifier' : 'Créer'}
            </button>
          </div>
        </div>
      )}

      {services.length === 0 ? (
        <div className="bg-white border border-neutral-200 rounded-xl py-16 text-center">
          <ArrowRightLeft className="w-10 h-10 text-neutral-300 mx-auto mb-3" />
          <p className="text-sm text-neutral-500">Aucun service configuré</p>
          <p className="text-xs text-neutral-400 mt-1">Ajoutez Orange Money, Wave, Ria, etc.</p>
        </div>
      ) : (
        <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden divide-y divide-neutral-100">
          {services.map(s => (
            <div key={s.id} className="px-4 py-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-neutral-50 border border-neutral-200 flex items-center justify-center overflow-hidden">
                {s.logo_url ? (
                  <img src={s.logo_url} alt={s.name} className="w-full h-full object-contain p-0.5" />
                ) : (
                  <ArrowRightLeft className="w-4 h-4 text-neutral-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-neutral-900">{s.name}</p>
                <p className="text-xs text-neutral-400">{s.family === 'credit_telephone' ? 'Crédit téléphonique' : 'Transfert'} · {s.type === 'national' ? 'National' : s.type === 'international' ? 'International' : 'Mixte'} · {s.currency}{Number(s.alert_min_balance) > 0 ? ` · Alerte si < ${fmt(s.alert_min_balance)}` : ''}</p>
              </div>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${s.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-500'}`}>{s.status === 'active' ? 'Actif' : 'Inactif'}</span>
              {s.logo_url && (
                <button onClick={() => removeLogo(s)} className="p-1.5 rounded-lg hover:bg-red-50 text-neutral-300 hover:text-red-500 transition-colors" title="Supprimer le logo">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              <button onClick={() => edit(s)} className="p-1.5 rounded-lg hover:bg-neutral-100"><Edit2 className="w-3.5 h-3.5 text-neutral-400" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================ */
/* OPÉRATIONS                                   */
/* ============================================ */
function MTOperations() {
  const { tenant, profile } = useApp();
  const toast = useToast();
  const { can } = usePermissions();
  const [ops, setOps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [points, setPoints] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [pointServiceLinks, setPointServiceLinks] = useState<any[]>([]);
  const [lastClosureAt, setLastClosureAt] = useState<string | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<string>('');
  const [actionModal, setActionModal] = useState<any>(null);
  const [opModal, setOpModal] = useState<{ type: string; service: any } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [form, setForm] = useState({ amount: '', note: '', reference: '' });
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState({ type: '', search: '' });

  const load = useCallback(async () => {
    if (!tenant) return;
    const [{ data: o }, { data: p }, { data: s }, { data: a }, { data: ps }, { data: cl }] = await Promise.all([
      supabase.from('mt_operations').select('*').eq('tenant_id', tenant.id).order('operated_at', { ascending: false }).limit(200),
      supabase.from('mt_service_points').select('*').eq('tenant_id', tenant.id).eq('status', 'active').order('name'),
      supabase.from('mt_services').select('*').eq('tenant_id', tenant.id).eq('status', 'active').order('name'),
      supabase.from('mt_accounts').select('*').eq('tenant_id', tenant.id),
      supabase.from('mt_service_point_services').select('*').eq('tenant_id', tenant.id),
      supabase.from('mt_closures').select('closed_at,service_point_id').eq('tenant_id', tenant.id).eq('status', 'cloturee').order('closed_at', { ascending: false }).limit(1),
    ]);
    setOps(o || []);
    setPoints(p || []);
    setServices(s || []);
    setAccounts(a || []);
    setPointServiceLinks(ps || []);
    setLastClosureAt(cl && cl.length > 0 ? cl[0].closed_at : null);
    if (p && p.length === 1) setSelectedPoint(p[0].id);
    setLoading(false);
  }, [tenant]);

  useEffect(() => { load(); }, [load]);

  const ptAccounts = useMemo(() => selectedPoint ? accounts.filter(a => a.service_point_id === selectedPoint) : accounts, [accounts, selectedPoint]);
  const ptCash = useMemo(() => ptAccounts.filter(a => a.type === 'cash').reduce((s, a) => s + Number(a.balance), 0), [ptAccounts]);

  const availableServices = useMemo(() => {
    if (!selectedPoint) return services;
    const linkedSvcIds = pointServiceLinks.filter(ps => ps.service_point_id === selectedPoint).map(ps => ps.service_id);
    if (linkedSvcIds.length === 0) return services;
    return services.filter(s => linkedSvcIds.includes(s.id));
  }, [services, selectedPoint, pointServiceLinks]);

  const getServiceUV = (svcId: string): number => {
    const accs = selectedPoint ? accounts.filter(a => a.type === 'uv' && a.service_id === svcId && a.service_point_id === selectedPoint) : accounts.filter(a => a.type === 'uv' && a.service_id === svcId);
    return accs.reduce((s, a) => s + Number(a.balance), 0);
  };

  const isOpeningOp = (o: any) => o.reference === 'INIT-OUVERTURE' || o.reference === 'OUVERTURE-JOUR';

  const todayOps = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    let filtered = ops.filter(o => o.operated_at?.startsWith(today) && o.status === 'validee');
    if (selectedPoint) filtered = filtered.filter(o => o.service_point_id === selectedPoint);
    if (lastClosureAt) filtered = filtered.filter(o => o.operated_at > lastClosureAt);
    return filtered.filter(o => !isOpeningOp(o));
  }, [ops, selectedPoint, lastClosureAt]);

  const todayDeposits = useMemo(() => todayOps.filter(o => ['depot', 'vente_credit'].includes(o.type)).reduce((s, o) => s + Number(o.amount), 0), [todayOps]);
  const todayWithdrawals = useMemo(() => todayOps.filter(o => o.type === 'retrait').reduce((s, o) => s + Number(o.amount), 0), [todayOps]);

  const getBalance = async (spId: string | null, svcId: string | null, type: string): Promise<number> => {
    let q = supabase.from('mt_accounts').select('balance').eq('tenant_id', tenant!.id).eq('type', type);
    if (spId) q = q.eq('service_point_id', spId);
    if (svcId) q = q.eq('service_id', svcId);
    const { data } = await q;
    return (data || []).reduce((sum, row) => sum + Number(row.balance || 0), 0);
  };

  const createOp = async () => {
    if (!tenant || !selectedPoint || !form.amount || !opModal) return;
    setSaving(true);
    const amount = Number(form.amount) || 0;
    const sp = selectedPoint;
    const svc = opModal.service?.id || '';
    const svcName = opModal.service?.name || '';
    const svcFamily = opModal.service?.family || 'transfert';
    const opType = opModal.type;
    const today = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const operatorName = profile?.full_name || 'Opérateur';

    // Balance validation
    if (opType === 'depot' && svc) {
      const uvBal = await getBalance(sp, svc, 'uv');
      if (uvBal < amount) { toast.error(`Solde UV ${svcName} insuffisant (${fmt(uvBal)} disponible)`); setSaving(false); return; }
    } else if (opType === 'retrait') {
      const cashBal = await getBalance(sp, null, 'cash');
      if (cashBal < amount) { toast.error(`Solde cash insuffisant (${fmt(cashBal)} disponible)`); setSaving(false); return; }
    } else if (opType === 'vente_credit' && svc) {
      const stockBal = await getBalance(sp, svc, 'stock_credit');
      if (stockBal < amount) { toast.error(`Stock crédit ${svcName} insuffisant (${fmt(stockBal)} disponible)`); setSaving(false); return; }
    }

    // Auto-generate label
    let comment = '';
    if (opType === 'depot') comment = `Total dépôt ${svcName} du jour - ${today} - ${selectedPointName} - ${operatorName}`;
    else if (opType === 'retrait') comment = `Total retrait ${svcName} du jour - ${today} - ${selectedPointName} - ${operatorName}`;
    else if (opType === 'vente_credit') comment = `Vente crédit ${svcName} du jour - ${today} - ${selectedPointName} - ${operatorName}`;
    if (form.note) comment += ` | ${form.note}`;

    const { error } = await supabase.from('mt_operations').insert({
      tenant_id: tenant.id, service_point_id: sp, service_id: svc || null,
      type: opType, amount, commission: 0,
      comment, reference: form.reference || null,
      status: 'validee',
      operated_by: profile?.id || null, validated_by: profile?.id || null,
    });

    if (!error) {
      if (opType === 'depot') {
        await updateBalance(tenant.id, sp, null, 'cash', amount);
        if (svc) await updateBalance(tenant.id, sp, svc, 'uv', -amount);
      } else if (opType === 'retrait') {
        await updateBalance(tenant.id, sp, null, 'cash', -amount);
        if (svc) await updateBalance(tenant.id, sp, svc, 'uv', amount);
      } else if (opType === 'vente_credit') {
        await updateBalance(tenant.id, sp, null, 'cash', amount);
        if (svc) await updateBalance(tenant.id, sp, svc, 'stock_credit', -amount);
      }
      toast.success('Opération enregistrée');
    } else {
      toast.error('Erreur: ' + error.message);
    }
    setSaving(false);
    setOpModal(null);
    setForm({ amount: '', note: '', reference: '' });
    load();
  };

  const cancelOp = async (op: any) => {
    if (op.status !== 'validee') return;
    await supabase.from('mt_operations').update({ status: 'annulee', cancelled_by: profile?.id, cancelled_at: new Date().toISOString() }).eq('id', op.id);
    const sp = op.service_point_id;
    const svc = op.service_id;
    const amount = Number(op.amount);
    if (op.type === 'depot') {
      await updateBalance(tenant!.id, sp, null, 'cash', -amount);
      if (svc) await updateBalance(tenant!.id, sp, svc, 'uv', amount);
    } else if (op.type === 'retrait') {
      await updateBalance(tenant!.id, sp, null, 'cash', amount);
      if (svc) await updateBalance(tenant!.id, sp, svc, 'uv', -amount);
    } else if (op.type === 'achat_uv') {
      await updateBalance(tenant!.id, sp, null, 'cash', amount);
      if (svc) await updateBalance(tenant!.id, sp, svc, 'uv', -amount);
    } else if (op.type === 'vente_credit') {
      await updateBalance(tenant!.id, sp, null, 'cash', -amount);
      if (svc) await updateBalance(tenant!.id, sp, svc, 'stock_credit', amount);
    }
    toast.success('Opération annulée');
    load();
  };

  const clientOpTypes = ['depot', 'retrait', 'vente_credit', 'reappro_credit', 'ajustement_credit', 'achat_uv', 'ajustement', 'annulation'];
  const historyOps = useMemo(() => {
    let r = ops.filter(o => clientOpTypes.includes(o.type));
    if (!can('mt_client_operation_view_all')) r = r.filter(o => o.operated_by === profile?.id);
    if (selectedPoint) r = r.filter(o => o.service_point_id === selectedPoint);
    if (filter.type) r = r.filter(o => o.type === filter.type);
    if (filter.search) {
      const q = filter.search.toLowerCase();
      r = r.filter(o => (o.comment || '').toLowerCase().includes(q) || (o.reference || '').toLowerCase().includes(q));
    }
    return r;
  }, [ops, filter, profile, selectedPoint]);

  const getServiceColor = (svc: any) => {
    const name = (svc.name || '').toLowerCase();
    if (name.includes('wave')) return { bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-700', icon: 'text-sky-600' };
    if (name.includes('orange')) return { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', icon: 'text-orange-600' };
    if (name.includes('free')) return { bg: 'bg-teal-50', border: 'border-teal-200', text: 'text-teal-700', icon: 'text-teal-600' };
    if (name.includes('expresso')) return { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', icon: 'text-amber-600' };
    return { bg: 'bg-neutral-50', border: 'border-neutral-200', text: 'text-neutral-700', icon: 'text-neutral-600' };
  };

  const transferServices = useMemo(() => availableServices.filter(s => s.family !== 'credit_telephone'), [availableServices]);
  const creditServices = useMemo(() => availableServices.filter(s => s.family === 'credit_telephone'), [availableServices]);

  const getServiceStock = (svcId: string): number => {
    const accs = selectedPoint ? accounts.filter(a => a.type === 'stock_credit' && a.service_id === svcId && a.service_point_id === selectedPoint) : accounts.filter(a => a.type === 'stock_credit' && a.service_id === svcId);
    return accs.reduce((s, a) => s + Number(a.balance), 0);
  };

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-5 h-5 animate-spin text-neutral-400" /></div>;

  const selectedPointName = points.find(p => p.id === selectedPoint)?.name || '';

  return (
    <div className="max-w-[900px] mx-auto flex flex-col h-[calc(100dvh-160px)] lg:h-[calc(100vh-180px)] overflow-hidden">
      {/* Top bar: point selector */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-neutral-100 flex items-center justify-center">
            <MapPin className="w-4 h-4 text-neutral-600" />
          </div>
          {points.length > 1 ? (
            <select value={selectedPoint} onChange={e => setSelectedPoint(e.target.value)} className="text-sm font-semibold text-neutral-900 bg-transparent border-none p-0 focus:ring-0 cursor-pointer">
              <option value="">Sélectionner un point</option>
              {points.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          ) : (
            <span className="text-sm font-semibold text-neutral-900">{selectedPointName}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setHistoryOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-600 bg-neutral-100 rounded-lg hover:bg-neutral-200 transition-colors">
            <Clock className="w-3.5 h-3.5" /> Historique
          </button>
          <button onClick={() => load()} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!selectedPoint ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <MapPin className="w-10 h-10 text-neutral-200 mx-auto mb-3" />
            <p className="text-sm text-neutral-400">Sélectionnez un point de service</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Cash card - white, banking style */}
          <div className="bg-white border border-neutral-200 rounded-2xl p-5 mb-5 shrink-0">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-1">Cash disponible</p>
                <p className="text-3xl sm:text-4xl font-black text-neutral-900 tracking-tight num">{fmt(ptCash)} <span className="text-base font-medium text-neutral-400">FCFA</span></p>
              </div>
              <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center">
                <Banknote className="w-5 h-5 text-emerald-600" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-neutral-100">
              <div>
                <p className="text-[10px] font-medium text-neutral-400 uppercase">Entrées cash</p>
                <p className="text-sm font-bold text-emerald-600 num mt-0.5">+{fmt(todayDeposits)}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium text-neutral-400 uppercase">Sorties cash</p>
                <p className="text-sm font-bold text-red-500 num mt-0.5">-{fmt(todayWithdrawals)}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium text-neutral-400 uppercase">Opérations</p>
                <p className="text-sm font-bold text-neutral-900 num mt-0.5">{todayOps.length}</p>
              </div>
            </div>
          </div>

          {/* Service cards - split by family */}
          <div className="flex-1 min-h-0 overflow-y-auto pb-4 space-y-6">
            {/* Transfert d'argent */}
            {transferServices.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <ArrowRightLeft className="w-3.5 h-3.5" />Transfert d'argent
                </p>
                <div className="flex flex-wrap justify-center gap-3 sm:gap-4">
                  {transferServices.map(svc => {
                    const color = getServiceColor(svc);
                    const uvBal = getServiceUV(svc.id);
                    return (
                      <button
                        key={svc.id}
                        onClick={() => setActionModal(svc)}
                        className="w-[130px] h-[130px] sm:w-[150px] sm:h-[150px] rounded-2xl bg-white border border-neutral-100 shadow-lg shadow-neutral-200/60 hover:shadow-xl hover:shadow-neutral-300/50 hover:-translate-y-0.5 transition-all duration-200 flex flex-col items-center justify-center gap-1.5 sm:gap-2 p-3 sm:p-4"
                      >
                        <div className="w-12 h-12 sm:w-16 sm:h-16 flex items-center justify-center">
                          {svc.logo_url ? <img src={svc.logo_url} alt="" className="w-10 h-10 sm:w-14 sm:h-14 object-contain" /> : <Smartphone className={`w-8 h-8 sm:w-10 sm:h-10 ${color.icon}`} />}
                        </div>
                        <p className="text-[10px] sm:text-xs font-semibold text-neutral-900 text-center truncate w-full">{svc.name}</p>
                        <p className={`text-xs sm:text-sm font-bold num ${svc.alert_min_balance > 0 && uvBal < svc.alert_min_balance ? 'text-red-600' : color.text}`}>{fmt(uvBal)}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Crédit téléphonique */}
            {creditServices.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Smartphone className="w-3.5 h-3.5" />Crédit téléphonique
                </p>
                <div className="flex flex-wrap justify-center gap-3 sm:gap-4">
                  {creditServices.map(svc => {
                    const color = getServiceColor(svc);
                    const stockBal = getServiceStock(svc.id);
                    return (
                      <button
                        key={svc.id}
                        onClick={() => { setOpModal({ type: 'vente_credit', service: svc }); }}
                        className="w-[130px] h-[130px] sm:w-[150px] sm:h-[150px] rounded-2xl bg-white border border-neutral-100 shadow-lg shadow-neutral-200/60 hover:shadow-xl hover:shadow-neutral-300/50 hover:-translate-y-0.5 transition-all duration-200 flex flex-col items-center justify-center gap-1.5 sm:gap-2 p-3 sm:p-4"
                      >
                        <div className="w-12 h-12 sm:w-16 sm:h-16 flex items-center justify-center">
                          {svc.logo_url ? <img src={svc.logo_url} alt="" className="w-10 h-10 sm:w-14 sm:h-14 object-contain" /> : <Smartphone className={`w-8 h-8 sm:w-10 sm:h-10 ${color.icon}`} />}
                        </div>
                        <p className="text-[10px] sm:text-xs font-semibold text-neutral-900 text-center truncate w-full">{svc.name}</p>
                        <p className={`text-xs sm:text-sm font-bold num ${svc.alert_min_balance > 0 && stockBal < svc.alert_min_balance ? 'text-red-600' : color.text}`}>{fmt(stockBal)}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {transferServices.length === 0 && creditServices.length === 0 && (
              <p className="text-xs text-neutral-400 text-center">Aucun service configuré</p>
            )}
          </div>
        </div>
      )}

      {/* Action modal - choose deposit or withdrawal for transfer services */}
      {actionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setActionModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-5 w-[280px] animate-in fade-in zoom-in-95" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                {actionModal.logo_url ? <img src={actionModal.logo_url} className="w-5 h-5 rounded object-contain" /> : <Smartphone className="w-4 h-4 text-neutral-500" />}
                <p className="text-sm font-semibold text-neutral-900">{actionModal.name}</p>
              </div>
              <button onClick={() => setActionModal(null)} className="p-1 rounded-lg hover:bg-neutral-100"><X className="w-4 h-4 text-neutral-400" /></button>
            </div>
            <div className="space-y-2">
              {can('mt_client_deposit_create') && (
                <button onClick={() => { setOpModal({ type: 'depot', service: actionModal }); setActionModal(null); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-colors">
                  <ArrowDownLeft className="w-5 h-5 text-emerald-600" />
                  <span className="text-sm font-semibold text-emerald-800">Dépôt du jour</span>
                </button>
              )}
              {can('mt_client_withdrawal_create') && (
                <button onClick={() => { setOpModal({ type: 'retrait', service: actionModal }); setActionModal(null); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200 hover:bg-red-100 transition-colors">
                  <ArrowUpRight className="w-5 h-5 text-red-500" />
                  <span className="text-sm font-semibold text-red-700">Retrait du jour</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Operation modal - daily consolidated entry */}
      {opModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => { setOpModal(null); setForm({ amount: '', note: '', reference: '' }); }}>
          <div className="bg-white rounded-2xl shadow-2xl p-5 w-full max-w-[340px] animate-in fade-in zoom-in-95" onClick={e => e.stopPropagation()}>
            <div className={`flex items-center gap-2 mb-4 pb-3 border-b ${opModal.type === 'depot' || opModal.type === 'vente_credit' ? 'border-emerald-100' : 'border-red-100'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${opModal.type === 'depot' || opModal.type === 'vente_credit' ? 'bg-emerald-50' : 'bg-red-50'}`}>
                {opModal.type === 'depot' ? <ArrowDownLeft className="w-4 h-4 text-emerald-600" /> : opModal.type === 'vente_credit' ? <Smartphone className="w-4 h-4 text-emerald-600" /> : <ArrowUpRight className="w-4 h-4 text-red-500" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-neutral-900">
                  {opModal.type === 'depot' ? 'Total dépôt du jour' : opModal.type === 'retrait' ? 'Total retrait du jour' : 'Vente crédit du jour'}
                </p>
                <p className="text-[10px] text-neutral-400">{opModal.service.name} - {selectedPointName}</p>
              </div>
              <button onClick={() => { setOpModal(null); setForm({ amount: '', note: '', reference: '' }); }} className="p-1 rounded-lg hover:bg-neutral-100"><X className="w-4 h-4 text-neutral-400" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-medium text-neutral-500 uppercase mb-1">Montant total (FCFA)</label>
                <input value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} type="number" placeholder="0" autoFocus
                  className="w-full px-3 py-2.5 text-xl font-bold text-neutral-900 bg-neutral-50 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-neutral-900 focus:border-transparent text-center num" />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-neutral-500 uppercase mb-1">Référence opérateur (optionnel)</label>
                <input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} type="text" placeholder="Ex: TX-12345"
                  className="w-full px-3 py-2 text-sm bg-neutral-50 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-neutral-900 focus:border-transparent" />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-neutral-500 uppercase mb-1">Note (optionnel)</label>
                <input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} type="text" placeholder="Observation du jour..."
                  className="w-full px-3 py-2 text-sm bg-neutral-50 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-neutral-900 focus:border-transparent" />
              </div>
            </div>
            <div className="mt-3 px-3 py-2 bg-neutral-50 rounded-lg">
              <p className="text-[9px] text-neutral-400 leading-relaxed">
                Libellé automatique : <span className="font-medium text-neutral-600">
                  {opModal.type === 'depot' ? `Total dépôt ${opModal.service.name} du jour` : opModal.type === 'retrait' ? `Total retrait ${opModal.service.name} du jour` : `Vente crédit ${opModal.service.name} du jour`}
                </span>
              </p>
            </div>
            <button onClick={createOp} disabled={saving || !form.amount}
              className={`w-full mt-4 py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-colors disabled:opacity-50 ${
                opModal.type === 'depot' || opModal.type === 'vente_credit' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-500 hover:bg-red-600'
              }`}>
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Valider
            </button>
          </div>
        </div>
      )}

      {/* History full-screen modal */}
      {historyOpen && (
        <div className="fixed inset-0 z-50 bg-white flex flex-col">
          {/* Header */}
          <div className="shrink-0 border-b border-neutral-200 px-5 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-neutral-900">Historique des operations</h2>
              <p className="text-xs text-neutral-400 mt-0.5">{selectedPointName || 'Tous les points'} - {historyOps.length} operation{historyOps.length > 1 ? 's' : ''}</p>
            </div>
            <button onClick={() => setHistoryOpen(false)} className="w-9 h-9 rounded-full bg-neutral-100 flex items-center justify-center hover:bg-neutral-200 transition-colors">
              <X className="w-5 h-5 text-neutral-600" />
            </button>
          </div>
          {/* Filters */}
          <div className="shrink-0 px-5 py-3 border-b border-neutral-100 flex items-center gap-3">
            <div className="relative flex-1 max-w-[240px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <input value={filter.search} onChange={e => setFilter({ ...filter, search: e.target.value })} placeholder="Rechercher..." className="w-full pl-9 pr-3 py-2 text-sm bg-neutral-50 border border-neutral-200 rounded-lg focus:ring-2 focus:ring-neutral-900 focus:border-transparent" />
            </div>
            <select value={filter.type} onChange={e => setFilter({ ...filter, type: e.target.value })} className="px-3 py-2 text-sm bg-neutral-50 border border-neutral-200 rounded-lg">
              <option value="">Tous types</option>
              {Object.entries(OP_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          {/* Table */}
          <div className="flex-1 overflow-y-auto">
            {historyOps.length === 0 ? (
              <div className="py-20 text-center">
                <Clock className="w-10 h-10 text-neutral-200 mx-auto mb-3" />
                <p className="text-sm text-neutral-400">Aucune operation</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-neutral-50 border-b border-neutral-200">
                  <tr className="text-[10px] font-medium text-neutral-400 uppercase tracking-wider">
                    <th className="text-left px-5 py-2.5">Date / Heure</th>
                    <th className="text-left px-3 py-2.5">Type</th>
                    <th className="text-left px-3 py-2.5">Service</th>
                    <th className="text-left px-3 py-2.5">Libellé</th>
                    <th className="text-right px-3 py-2.5">Montant</th>
                    <th className="text-center px-3 py-2.5">Statut</th>
                    <th className="text-right px-5 py-2.5">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {historyOps.map(op => {
                    const svc = services.find(s => s.id === op.service_id);
                    const pt = points.find(p => p.id === op.service_point_id);
                    return (
                      <tr key={op.id} className="hover:bg-neutral-50/50 transition-colors">
                        <td className="px-5 py-2.5 whitespace-nowrap">
                          <p className="text-xs font-medium text-neutral-900">{new Date(op.operated_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}</p>
                          <p className="text-[10px] text-neutral-400">{new Date(op.operated_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</p>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center gap-1 text-xs font-medium ${op.type === 'depot' || op.type === 'vente_credit' ? 'text-emerald-700' : op.type === 'retrait' ? 'text-red-600' : 'text-neutral-600'}`}>
                            {op.type === 'depot' ? <ArrowDownLeft className="w-3 h-3" /> : op.type === 'retrait' ? <ArrowUpRight className="w-3 h-3" /> : op.type === 'vente_credit' ? <Smartphone className="w-3 h-3" /> : <ArrowRightLeft className="w-3 h-3" />}
                            {OP_TYPE_LABELS[op.type] || op.type}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="text-xs text-neutral-700">{svc?.name || '—'}</p>
                          {pt && <p className="text-[10px] text-neutral-400">{pt.name}</p>}
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="text-xs text-neutral-700 truncate max-w-[200px]">{op.comment || op.reference || '—'}</p>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <p className={`text-xs font-bold num ${['depot', 'vente_credit'].includes(op.type) ? 'text-emerald-700' : op.type === 'retrait' ? 'text-red-600' : 'text-neutral-900'}`}>
                            {['depot', 'vente_credit'].includes(op.type) ? '+' : op.type === 'retrait' ? '-' : ''}{fmt(op.amount)}
                          </p>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[op.status] || 'bg-neutral-100 text-neutral-600'}`}>
                            {STATUS_LABELS[op.status] || op.status}
                          </span>
                        </td>
                        <td className="px-5 py-2.5 text-right">
                          {op.status === 'validee' && (can('mt_client_operation_cancel_any') || (can('mt_client_operation_cancel_own') && op.operated_by === profile?.id)) && (
                            <button onClick={() => cancelOp(op)} className="text-[10px] font-medium text-red-500 hover:text-red-700 hover:underline">Annuler</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

async function updateBalance(tenantId: string, spId: string | null, svcId: string | null, type: string, delta: number) {
  let q = supabase.from('mt_accounts').select('*').eq('tenant_id', tenantId).eq('type', type);
  if (spId) q = q.eq('service_point_id', spId); else q = q.is('service_point_id', null);
  if (svcId) q = q.eq('service_id', svcId); else q = q.is('service_id', null);
  const { data } = await q.maybeSingle();
  if (data) {
    await supabase.from('mt_accounts').update({ balance: Number(data.balance) + delta, updated_at: new Date().toISOString() }).eq('id', data.id);
  } else {
    if (!svcId && (type === 'cash' || type === 'bank')) {
      let q2 = supabase.from('mt_accounts').select('*').eq('tenant_id', tenantId).eq('type', type);
      if (spId) q2 = q2.eq('service_point_id', spId);
      const { data: fallback } = await q2.limit(1).maybeSingle();
      if (fallback) {
        await supabase.from('mt_accounts').update({ balance: Number(fallback.balance) + delta, updated_at: new Date().toISOString() }).eq('id', fallback.id);
        return;
      }
    }
    const label = type === 'cash' ? 'Caisse' : type === 'uv' ? 'UV' : type === 'bank' ? 'Banque' : type === 'stock_credit' ? 'Stock crédit' : 'Écarts';
    await supabase.from('mt_accounts').insert({ tenant_id: tenantId, service_point_id: spId || null, service_id: svcId || null, type, label, balance: delta, currency: 'XOF' });
  }
}

/* ============================================ */
/* GROSSISTES                                   */
/* ============================================ */
function MTWholesalers() {
  const { tenant } = useApp();
  const toast = useToast();
  const { can } = usePermissions();
  const [wholesalers, setWholesalers] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', address: '', zone: '', notes: '', serviceIds: [] as string[] });
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenant) return;
    const [{ data: w }, { data: s }, { data: ws }] = await Promise.all([
      supabase.from('mt_wholesalers').select('*').eq('tenant_id', tenant.id).order('name'),
      supabase.from('mt_services').select('*').eq('tenant_id', tenant.id).eq('status', 'active').order('name'),
      supabase.from('mt_wholesaler_services').select('*'),
    ]);
    const wList = (w || []).map(wh => ({
      ...wh,
      services: (ws || []).filter(x => x.wholesaler_id === wh.id).map(x => x.service_id),
    }));
    setWholesalers(wList);
    setServices(s || []);
    setLoading(false);
  }, [tenant]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!tenant || !form.name.trim()) return;
    setSaving(true);
    const payload = { name: form.name, phone: form.phone || null, address: form.address || null, zone: form.zone || null, notes: form.notes || null };
    let whId = editId;
    if (editId) {
      await supabase.from('mt_wholesalers').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editId);
    } else {
      const { data } = await supabase.from('mt_wholesalers').insert({ ...payload, tenant_id: tenant.id, created_by: null }).select('id').single();
      whId = data?.id || null;
    }
    if (whId) {
      await supabase.from('mt_wholesaler_services').delete().eq('wholesaler_id', whId);
      if (form.serviceIds.length > 0) {
        await supabase.from('mt_wholesaler_services').insert(form.serviceIds.map(sid => ({ wholesaler_id: whId!, service_id: sid })));
      }
    }
    setSaving(false);
    setShowForm(false);
    setEditId(null);
    setForm({ name: '', phone: '', address: '', zone: '', notes: '', serviceIds: [] });
    toast.success(editId ? 'Grossiste modifié' : 'Grossiste créé');
    load();
  };

  const edit = (w: any) => {
    setForm({ name: w.name, phone: w.phone || '', address: w.address || '', zone: w.zone || '', notes: w.notes || '', serviceIds: w.services || [] });
    setEditId(w.id);
    setShowForm(true);
  };

  const toggleStatus = async (w: any) => {
    const newStatus = w.status === 'active' ? 'inactive' : 'active';
    await supabase.from('mt_wholesalers').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', w.id);
    toast.success(newStatus === 'active' ? 'Grossiste activé' : 'Grossiste désactivé');
    load();
  };

  const getServiceName = (id: string) => services.find(s => s.id === id)?.name || '—';

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-5 h-5 animate-spin text-neutral-400" /></div>;

  return (
    <div className="max-w-[1000px] mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-neutral-900">Grossistes</h2>
          <p className="text-xs text-neutral-500 mt-0.5">Gérez vos grossistes pour les recharges et déchargements de solde électronique.</p>
        </div>
        {can('mt_wholesaler_manage') && (
          <button onClick={() => { setShowForm(true); setEditId(null); setForm({ name: '', phone: '', address: '', zone: '', notes: '', serviceIds: [] }); }}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 transition-colors">
            <Plus className="w-4 h-4" />Ajouter
          </button>
        )}
      </div>

      {showForm && can('mt_wholesaler_manage') && (
        <div className="bg-white border border-neutral-200 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-neutral-900">{editId ? 'Modifier le grossiste' : 'Nouveau grossiste'}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Nom du grossiste *" className="input" />
            <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Téléphone" className="input" />
            <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Adresse" className="input" />
            <input value={form.zone} onChange={e => setForm({ ...form, zone: e.target.value })} placeholder="Zone / Quartier" className="input" />
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Notes" className="input sm:col-span-2" rows={2} />
          </div>
          <div>
            <p className="text-[11px] font-medium text-neutral-500 uppercase tracking-wide mb-2">Services associés</p>
            <div className="flex flex-wrap gap-2">
              {services.map(s => (
                <button key={s.id} onClick={() => {
                  setForm(f => ({ ...f, serviceIds: f.serviceIds.includes(s.id) ? f.serviceIds.filter(x => x !== s.id) : [...f.serviceIds, s.id] }));
                }} className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${form.serviceIds.includes(s.id) ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'}`}>
                  {s.name}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={() => { setShowForm(false); setEditId(null); }} className="px-3 py-2 text-sm border border-neutral-200 rounded-lg hover:bg-neutral-50">Annuler</button>
            <button onClick={save} disabled={saving || !form.name.trim()} className="px-4 py-2 text-sm font-medium bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{editId ? 'Modifier' : 'Créer'}
            </button>
          </div>
        </div>
      )}

      {wholesalers.length === 0 ? (
        <div className="bg-white border border-neutral-200 rounded-xl py-16 text-center">
          <Users className="w-10 h-10 text-neutral-300 mx-auto mb-3" />
          <p className="text-sm text-neutral-500">Aucun grossiste configuré</p>
          <p className="text-xs text-neutral-400 mt-1">Ajoutez vos grossistes pour les opérations de recharge et déchargement</p>
        </div>
      ) : (
        <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden divide-y divide-neutral-100">
          {wholesalers.map(w => (
            <div key={w.id} className="px-4 py-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center">
                <User className="w-5 h-5 text-neutral-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-neutral-900">{w.name}</p>
                <p className="text-xs text-neutral-400">{w.phone || '—'} · {w.zone || w.address || '—'}</p>
                {w.services?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {w.services.map((sid: string) => (
                      <span key={sid} className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700">{getServiceName(sid)}</span>
                    ))}
                  </div>
                )}
              </div>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${w.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-500'}`}>
                {w.status === 'active' ? 'Actif' : 'Inactif'}
              </span>
              {can('mt_wholesaler_manage') && (
                <>
                  <button onClick={() => toggleStatus(w)} className="p-1.5 rounded-lg hover:bg-neutral-100" title={w.status === 'active' ? 'Désactiver' : 'Activer'}>
                    {w.status === 'active' ? <XCircle className="w-3.5 h-3.5 text-neutral-400" /> : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                  </button>
                  <button onClick={() => edit(w)} className="p-1.5 rounded-lg hover:bg-neutral-100"><Edit2 className="w-3.5 h-3.5 text-neutral-400" /></button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================ */
/* OPÉRATIONS GROSSISTE                         */
/* ============================================ */
function MTWholesalerOperations() {
  const { tenant, profile } = useApp();
  const toast = useToast();
  const { can } = usePermissions();
  const [ops, setOps] = useState<any[]>([]);
  const [wholesalers, setWholesalers] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [points, setPoints] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [opType, setOpType] = useState<'recharge_grossiste' | 'dechargement_grossiste' | 'reappro_credit'>('recharge_grossiste');
  const [form, setForm] = useState({ wholesaler_id: '', service_id: '', service_point_id: '', amount: '', comment: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!tenant) return;
    const [{ data: o }, { data: w }, { data: s }, { data: p }, { data: a }] = await Promise.all([
      supabase.from('mt_operations').select('*').eq('tenant_id', tenant.id).in('type', ['recharge_grossiste', 'dechargement_grossiste', 'reappro_credit', 'versement_banque', 'retrait_banque']).order('operated_at', { ascending: false }).limit(100),
      supabase.from('mt_wholesalers').select('*').eq('tenant_id', tenant.id).eq('status', 'active').order('name'),
      supabase.from('mt_services').select('*').eq('tenant_id', tenant.id).eq('status', 'active').order('name'),
      supabase.from('mt_service_points').select('*').eq('tenant_id', tenant.id).eq('status', 'active').order('name'),
      supabase.from('mt_accounts').select('*').eq('tenant_id', tenant.id),
    ]);
    setOps(o || []);
    setWholesalers(w || []);
    setServices(s || []);
    setPoints(p || []);
    setAccounts(a || []);
    if (p && p.length === 1) setForm(f => ({ ...f, service_point_id: p[0].id }));
    setLoading(false);
  }, [tenant]);

  useEffect(() => { load(); }, [load]);

  const cashTotal = accounts.filter(a => a.type === 'cash').reduce((s, a) => s + Number(a.balance), 0);
  const getServiceUV = (svcId: string) => accounts.filter(a => a.type === 'uv' && a.service_id === svcId).reduce((s, a) => s + Number(a.balance), 0);
  const getServiceCredit = (svcId: string) => accounts.filter(a => a.type === 'stock_credit' && a.service_id === svcId).reduce((s, a) => s + Number(a.balance), 0);

  const createOp = async () => {
    if (!tenant || !form.service_point_id || !form.amount || !form.service_id) return;
    setSaving(true);
    const amount = Number(form.amount) || 0;
    const sp = form.service_point_id;
    const svc = form.service_id;

    const getBalance = async (spId: string | null, svcId: string | null, type: string): Promise<number> => {
      let q = supabase.from('mt_accounts').select('balance').eq('tenant_id', tenant.id).eq('type', type);
      if (spId) q = q.eq('service_point_id', spId);
      if (svcId) q = q.eq('service_id', svcId);
      const { data } = await q;
      return (data || []).reduce((sum, row) => sum + Number(row.balance || 0), 0);
    };

    const cashBefore = await getBalance(sp, null, 'cash');
    const uvBefore = await getBalance(sp, svc, 'uv');
    const creditBefore = await getBalance(sp, svc, 'stock_credit');

    if (opType === 'recharge_grossiste') {
      if (cashBefore < amount) { toast.error(`Solde cash insuffisant (${fmt(cashBefore)} FCFA disponible)`); setSaving(false); return; }
    } else if (opType === 'dechargement_grossiste') {
      if (uvBefore < amount) { toast.error(`Solde UV insuffisant (${fmt(uvBefore)} FCFA disponible)`); setSaving(false); return; }
    } else if (opType === 'reappro_credit') {
      if (cashBefore < amount) { toast.error(`Solde cash insuffisant (${fmt(cashBefore)} FCFA disponible)`); setSaving(false); return; }
    }

    const { error } = await supabase.from('mt_operations').insert({
      tenant_id: tenant.id,
      service_point_id: sp,
      service_id: svc,
      wholesaler_id: form.wholesaler_id || null,
      type: opType,
      amount,
      commission: 0,
      status: 'validee',
      comment: form.comment || null,
      operated_by: profile?.id || null,
      validated_by: profile?.id || null,
      balance_before_cash: cashBefore,
      balance_after_cash: opType === 'dechargement_grossiste' ? cashBefore + amount : cashBefore - amount,
      balance_before_uv: opType === 'reappro_credit' ? creditBefore : uvBefore,
      balance_after_uv: opType === 'recharge_grossiste' ? uvBefore + amount : opType === 'dechargement_grossiste' ? uvBefore - amount : creditBefore + amount,
    });

    if (!error) {
      if (opType === 'recharge_grossiste') {
        await updateBalance(tenant.id, sp, null, 'cash', -amount);
        await updateBalance(tenant.id, sp, svc, 'uv', amount);
      } else if (opType === 'dechargement_grossiste') {
        await updateBalance(tenant.id, sp, svc, 'uv', -amount);
        await updateBalance(tenant.id, sp, null, 'cash', amount);
      } else if (opType === 'reappro_credit') {
        await updateBalance(tenant.id, sp, null, 'cash', -amount);
        await updateBalance(tenant.id, sp, svc, 'stock_credit', amount);
      }
      toast.success('Opération grossiste enregistrée');
    } else {
      toast.error('Erreur : ' + error.message);
    }
    setSaving(false);
    setShowForm(false);
    setForm({ wholesaler_id: '', service_id: '', service_point_id: points.length === 1 ? points[0].id : '', amount: '', comment: '' });
    load();
  };

  const cancelOp = async (op: any) => {
    if (op.status !== 'validee') return;
    await supabase.from('mt_operations').update({ status: 'annulee', cancelled_by: profile?.id, cancelled_at: new Date().toISOString() }).eq('id', op.id);
    const sp = op.service_point_id;
    const svc = op.service_id;
    const amount = Number(op.amount);
    if (op.type === 'recharge_grossiste') {
      await updateBalance(tenant!.id, sp, null, 'cash', amount);
      await updateBalance(tenant!.id, sp, svc, 'uv', -amount);
    } else if (op.type === 'dechargement_grossiste') {
      await updateBalance(tenant!.id, sp, svc, 'uv', amount);
      await updateBalance(tenant!.id, sp, null, 'cash', -amount);
    } else if (op.type === 'reappro_credit') {
      await updateBalance(tenant!.id, sp, null, 'cash', amount);
      await updateBalance(tenant!.id, sp, svc, 'stock_credit', -amount);
    }
    toast.success('Opération grossiste annulée');
    load();
  };

  const getWholesalerName = (id: string | null) => wholesalers.find(w => w.id === id)?.name || '—';
  const getServiceName = (id: string | null) => services.find(s => s.id === id)?.name || '—';
  const getPointName = (id: string | null) => points.find(p => p.id === id)?.name || '—';

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-5 h-5 animate-spin text-neutral-400" /></div>;

  return (
    <div className="max-w-[1200px] mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-neutral-900">Opérations grossiste</h2>
          <p className="text-xs text-neutral-500 mt-0.5">Recharges et déchargements de solde électronique via vos grossistes.</p>
        </div>
        {can('mt_wholesaler_operation_create') && (
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 transition-colors">
            <Plus className="w-4 h-4" />Nouvelle opération
          </button>
        )}
      </div>

      {/* Résumé soldes */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-neutral-200 bg-white p-3.5">
          <div className="flex items-center gap-2 mb-1"><Banknote className="w-4 h-4 text-emerald-500" /><span className="text-[11px] font-medium text-neutral-500 uppercase">Cash disponible</span></div>
          <p className="text-lg font-bold text-neutral-900">{fmt(cashTotal)} <span className="text-xs font-normal text-neutral-400">FCFA</span></p>
        </div>
        {services.slice(0, 3).map(svc => (
          <div key={svc.id} className="rounded-xl border border-neutral-200 bg-white p-3.5">
            <div className="flex items-center gap-2 mb-1"><Smartphone className="w-4 h-4 text-sky-500" /><span className="text-[11px] font-medium text-neutral-500 uppercase">{svc.name}</span></div>
            <p className="text-lg font-bold text-neutral-900">{fmt(getServiceUV(svc.id))} <span className="text-xs font-normal text-neutral-400">FCFA</span></p>
          </div>
        ))}
      </div>

      {/* Formulaire nouvelle opération grossiste */}
      {showForm && can('mt_wholesaler_operation_create') && (
        <div className="bg-white border border-neutral-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 sm:gap-3 mb-2 flex-wrap">
            <button onClick={() => setOpType('recharge_grossiste')}
              className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors ${opType === 'recharge_grossiste' ? 'bg-emerald-600 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'}`}>
              Recharge UV
            </button>
            <button onClick={() => setOpType('dechargement_grossiste')}
              className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors ${opType === 'dechargement_grossiste' ? 'bg-red-500 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'}`}>
              Déchargement UV
            </button>
            <button onClick={() => setOpType('reappro_credit')}
              className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors ${opType === 'reappro_credit' ? 'bg-amber-600 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'}`}>
              Réappro. crédit
            </button>
          </div>
          <p className="text-xs text-neutral-500">
            {opType === 'recharge_grossiste' ? 'Vous donnez du cash au grossiste et recevez du solde électronique (UV).' : opType === 'dechargement_grossiste' ? 'Vous envoyez du solde électronique au grossiste et recevez du cash.' : 'Vous achetez du stock de crédit téléphonique (cash vers stock crédit).'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <select value={form.wholesaler_id} onChange={e => setForm({ ...form, wholesaler_id: e.target.value })} className="input">
              <option value="">Grossiste *</option>
              {wholesalers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <select value={form.service_id} onChange={e => setForm({ ...form, service_id: e.target.value })} className="input">
              <option value="">Service *</option>
              {services.filter(s => opType === 'reappro_credit' ? s.family === 'credit_telephone' : s.family !== 'credit_telephone').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {points.length > 1 && (
              <select value={form.service_point_id} onChange={e => setForm({ ...form, service_point_id: e.target.value })} className="input">
                <option value="">Point de service *</option>
                {points.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            <div>
              <label className="block text-[11px] font-medium text-neutral-500 uppercase mb-1">Montant *</label>
              <input value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0" type="number" className="input text-lg font-semibold" />
            </div>
            <input value={form.comment} onChange={e => setForm({ ...form, comment: e.target.value })} placeholder="Commentaire (optionnel)" className="input" />
          </div>

          {/* Aperçu impact */}
          {Number(form.amount) > 0 && form.service_id && (
            <div className="rounded-lg border border-neutral-100 bg-neutral-50/50 p-4">
              <p className="text-[11px] font-medium text-neutral-500 uppercase tracking-wide mb-2">Impact prévisionnel</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-neutral-400 mb-0.5">Caisse</p>
                  <p className={`text-sm font-bold ${opType === 'dechargement_grossiste' ? 'text-emerald-600' : 'text-red-600'}`}>
                    {opType === 'dechargement_grossiste' ? '+' : '-'}{fmt(Number(form.amount))} FCFA
                  </p>
                </div>
                <div>
                  <p className="text-xs text-neutral-400 mb-0.5">{opType === 'reappro_credit' ? `Stock crédit ${getServiceName(form.service_id)}` : `Solde UV ${getServiceName(form.service_id)}`}</p>
                  <p className={`text-sm font-bold ${opType === 'dechargement_grossiste' ? 'text-red-600' : 'text-emerald-600'}`}>
                    {opType === 'dechargement_grossiste' ? '-' : '+'}{fmt(Number(form.amount))} FCFA
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={() => setShowForm(false)} className="px-4 py-2.5 text-sm border border-neutral-200 rounded-lg hover:bg-neutral-50">Annuler</button>
            <button onClick={createOp} disabled={saving || !form.amount || !form.service_id || !form.service_point_id}
              className={`px-6 py-2.5 text-sm font-semibold text-white rounded-lg flex items-center gap-2 disabled:opacity-50 transition-colors ${
                opType === 'recharge_grossiste' ? 'bg-emerald-600 hover:bg-emerald-700' : opType === 'dechargement_grossiste' ? 'bg-red-500 hover:bg-red-600' : 'bg-amber-600 hover:bg-amber-700'
              }`}>
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Valider {opType === 'recharge_grossiste' ? 'la recharge' : opType === 'dechargement_grossiste' ? 'le déchargement' : 'le réapprovisionnement'}
            </button>
          </div>
        </div>
      )}

      {/* Historique des opérations grossiste */}
      {ops.length === 0 ? (
        <div className="bg-white border border-neutral-200 rounded-xl py-16 text-center">
          <Package className="w-10 h-10 text-neutral-300 mx-auto mb-3" />
          <p className="text-sm text-neutral-500">Aucune opération grossiste</p>
        </div>
      ) : (
        <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-100">
            <h3 className="text-sm font-semibold text-neutral-900">Historique des opérations grossiste</h3>
          </div>
          <div className="divide-y divide-neutral-100 max-h-[500px] overflow-y-auto">
            {ops.map(op => (
              <div key={op.id} className="px-4 py-3 flex items-center gap-3">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                  (op.type === 'recharge_grossiste' || op.type === 'retrait_banque' || op.type === 'reappro_credit') ? 'bg-emerald-50' : 'bg-red-50'
                }`}>
                  {(op.type === 'recharge_grossiste' || op.type === 'retrait_banque' || op.type === 'reappro_credit') ? <ArrowDownLeft className="w-4 h-4 text-emerald-600" /> : <ArrowUpRight className="w-4 h-4 text-red-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-neutral-900">{OP_TYPE_LABELS[op.type] || op.type}</p>
                  <p className="text-xs text-neutral-400">
                    {getWholesalerName(op.wholesaler_id)} · {getServiceName(op.service_id)} · {getPointName(op.service_point_id)} · {new Date(op.operated_at).toLocaleDateString('fr-FR')} {new Date(op.operated_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-neutral-900">{fmt(op.amount)} <span className="text-[10px] font-normal text-neutral-400">FCFA</span></p>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${STATUS_COLORS[op.status] || ''}`}>{STATUS_LABELS[op.status] || op.status}</span>
                </div>
                {op.status === 'validee' && can('mt_wholesaler_operation_cancel') && (
                  <button onClick={() => cancelOp(op)} className="p-1.5 rounded-lg hover:bg-red-50 text-neutral-300 hover:text-red-500 transition-colors shrink-0" title="Annuler">
                    <XCircle className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================ */
/* SOLDES                                       */
/* ============================================ */
function MTBalances() {
  const { tenant } = useApp();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [points, setPoints] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [ops, setOps] = useState<any[]>([]);
  const [pointServiceLinks, setPointServiceLinks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPointId, setSelectedPointId] = useState<string>('');
  const [dateRange, setDateRange] = useState<string>('today');

  useEffect(() => {
    if (!tenant) return;
    (async () => {
      const now = new Date();
      let startDate: string;
      if (dateRange === 'today') startDate = now.toISOString().split('T')[0];
      else if (dateRange === 'week') { const d = new Date(now); d.setDate(d.getDate() - 7); startDate = d.toISOString().split('T')[0]; }
      else { const d = new Date(now); d.setMonth(d.getMonth() - 1); startDate = d.toISOString().split('T')[0]; }

      const [{ data: a }, { data: p }, { data: s }, { data: o }, { data: ps }, { data: cl }] = await Promise.all([
        supabase.from('mt_accounts').select('*').eq('tenant_id', tenant.id).order('type'),
        supabase.from('mt_service_points').select('*').eq('tenant_id', tenant.id).eq('status', 'active'),
        supabase.from('mt_services').select('*').eq('tenant_id', tenant.id),
        supabase.from('mt_operations').select('*').eq('tenant_id', tenant.id).gte('operated_at', startDate + 'T00:00:00').eq('status', 'validee').order('operated_at', { ascending: false }),
        supabase.from('mt_service_point_services').select('*').eq('tenant_id', tenant.id),
        supabase.from('mt_closures').select('closed_at').eq('tenant_id', tenant.id).eq('status', 'cloturee').order('closed_at', { ascending: false }).limit(1),
      ]);
      setAccounts(a || []);
      setPoints(p || []);
      setServices(s || []);
      const closureTime = cl && cl.length > 0 && dateRange === 'today' ? cl[0].closed_at : null;
      setOps(closureTime ? (o || []).filter(op => op.operated_at > closureTime) : (o || []));
      setPointServiceLinks(ps || []);
      if (p && p.length === 1 && !selectedPointId) setSelectedPointId(p[0].id);
      setLoading(false);
    })();
  }, [tenant, dateRange]);

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-5 h-5 animate-spin text-neutral-400" /></div>;

  const filteredAccounts = selectedPointId ? accounts.filter(a => a.service_point_id === selectedPointId) : accounts;
  const isOpeningOp = (o: any) => o.reference === 'INIT-OUVERTURE' || o.reference === 'OUVERTURE-JOUR';
  const filteredOps = (selectedPointId ? ops.filter(o => o.service_point_id === selectedPointId) : ops).filter(o => !isOpeningOp(o));

  const getName = (id: string | null, list: any[]) => list.find(i => i.id === id)?.name || '—';
  const totalCash = filteredAccounts.filter(a => a.type === 'cash').reduce((s, a) => s + Number(a.balance), 0);
  const totalUV = filteredAccounts.filter(a => a.type === 'uv').reduce((s, a) => s + Number(a.balance), 0);
  const totalCredit = filteredAccounts.filter(a => a.type === 'stock_credit').reduce((s, a) => s + Number(a.balance), 0);

  const cashEntries = filteredOps.filter(o => ['depot', 'dechargement_grossiste', 'vente_credit'].includes(o.type)).reduce((s, o) => s + Number(o.amount), 0);
  const cashExits = filteredOps.filter(o => ['retrait', 'recharge_grossiste', 'achat_uv'].includes(o.type)).reduce((s, o) => s + Number(o.amount), 0);
  const uvEntries = filteredOps.filter(o => ['retrait', 'recharge_grossiste', 'achat_uv'].includes(o.type)).reduce((s, o) => s + Number(o.amount), 0);
  const uvExits = filteredOps.filter(o => ['depot', 'dechargement_grossiste'].includes(o.type)).reduce((s, o) => s + Number(o.amount), 0);
  const creditSales = filteredOps.filter(o => o.type === 'vente_credit').reduce((s, o) => s + Number(o.amount), 0);

  const availableSvcIds = selectedPointId ? pointServiceLinks.filter(ps => ps.service_point_id === selectedPointId).map(ps => ps.service_id) : null;
  const filteredUVAccounts = filteredAccounts.filter(a => a.type === 'uv' && (!availableSvcIds || availableSvcIds.length === 0 || availableSvcIds.includes(a.service_id)));
  const filteredCreditAccounts = filteredAccounts.filter(a => a.type === 'stock_credit' && (!availableSvcIds || availableSvcIds.length === 0 || availableSvcIds.includes(a.service_id)));

  const lowBalanceAlerts = [...filteredUVAccounts, ...filteredCreditAccounts].filter(a => {
    const svc = services.find(s => s.id === a.service_id);
    const threshold = svc?.alert_min_balance;
    if (!threshold || threshold <= 0) return false;
    return Number(a.balance) < threshold;
  });

  const selectedPointName = points.find(p => p.id === selectedPointId)?.name || 'Tous les points';
  const periodLabel = dateRange === 'today' ? "aujourd'hui" : dateRange === 'week' ? '7 derniers jours' : '30 derniers jours';

  return (
    <div className="max-w-[900px] mx-auto flex flex-col h-[calc(100dvh-160px)] lg:h-[calc(100vh-180px)] overflow-hidden">
      {/* Barre du haut */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-neutral-100 flex items-center justify-center">
            <MapPin className="w-4 h-4 text-neutral-600" />
          </div>
          {points.length > 1 ? (
            <select value={selectedPointId} onChange={e => setSelectedPointId(e.target.value)} className="text-sm font-semibold text-neutral-900 bg-transparent border-none p-0 focus:ring-0 cursor-pointer">
              <option value="">Tous les points</option>
              {points.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          ) : (
            <span className="text-sm font-semibold text-neutral-900">{selectedPointName}</span>
          )}
        </div>
        <select value={dateRange} onChange={e => setDateRange(e.target.value)} className="px-3 py-1.5 text-xs font-medium bg-neutral-100 border-none rounded-lg text-neutral-700 focus:ring-0 cursor-pointer">
          <option value="today">Aujourd'hui</option>
          <option value="week">7 derniers jours</option>
          <option value="month">30 derniers jours</option>
        </select>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {/* Carte blanche - Solde global */}
        <div className="bg-white border border-neutral-200 rounded-2xl p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-1">Solde total disponible</p>
              <p className="text-3xl sm:text-4xl font-black text-neutral-900 tracking-tight num">{fmt(totalCash + totalUV + totalCredit)} <span className="text-base font-medium text-neutral-400">FCFA</span></p>
            </div>
            <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center">
              <Wallet className="w-5 h-5 text-emerald-600" />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-neutral-100">
            <div>
              <p className="text-[10px] font-medium text-neutral-400 uppercase">Caisse (Cash)</p>
              <p className="text-sm font-bold text-neutral-900 num mt-0.5">{fmt(totalCash)}</p>
            </div>
            <div>
              <p className="text-[10px] font-medium text-neutral-400 uppercase">Unités Virtuelles</p>
              <p className="text-sm font-bold text-sky-700 num mt-0.5">{fmt(totalUV)}</p>
            </div>
            <div>
              <p className="text-[10px] font-medium text-neutral-400 uppercase">Stock crédit</p>
              <p className="text-sm font-bold text-amber-700 num mt-0.5">{fmt(totalCredit)}</p>
            </div>
            <div>
              <p className="text-[10px] font-medium text-neutral-400 uppercase">Opérations</p>
              <p className="text-sm font-bold text-neutral-900 num mt-0.5">{filteredOps.length}</p>
            </div>
          </div>
        </div>

        {/* Alertes solde bas */}
        {lowBalanceAlerts.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <h3 className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Alertes - Solde bas</h3>
            </div>
            <div className="space-y-2">
              {lowBalanceAlerts.map(a => {
                const svc = services.find(s => s.id === a.service_id);
                const svcName = svc?.name || '—';
                const ptName = getName(a.service_point_id, points);
                const minBal = svc?.alert_min_balance || 0;
                return (
                  <div key={a.id} className="flex items-center justify-between bg-white/60 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      {svc?.logo_url ? <img src={svc.logo_url} className="w-5 h-5 object-contain" /> : <Smartphone className="w-4 h-4 text-amber-600" />}
                      <div>
                        <p className="text-xs font-semibold text-amber-900">{svcName}</p>
                        <p className="text-[10px] text-amber-600">{ptName} &middot; Seuil : {fmt(minBal)} FCFA</p>
                      </div>
                    </div>
                    <p className="text-sm font-bold text-amber-900 num">{fmt(a.balance)} FCFA</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Mouvements de la période */}
        <div className="bg-white border border-neutral-200 rounded-xl p-4">
          <h3 className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-3">Mouvements {periodLabel}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-3 bg-emerald-50/60 rounded-xl px-3.5 py-3">
              <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                <ArrowDownLeft className="w-4 h-4 text-emerald-600" />
              </div>
              <div>
                <p className="text-[10px] text-neutral-500 uppercase">Entrées cash</p>
                <p className="text-sm font-bold text-emerald-700 num">+{fmt(cashEntries)}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-red-50/60 rounded-xl px-3.5 py-3">
              <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <ArrowUpRight className="w-4 h-4 text-red-500" />
              </div>
              <div>
                <p className="text-[10px] text-neutral-500 uppercase">Sorties cash</p>
                <p className="text-sm font-bold text-red-600 num">-{fmt(cashExits)}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-sky-50/60 rounded-xl px-3.5 py-3">
              <div className="w-9 h-9 rounded-full bg-sky-100 flex items-center justify-center shrink-0">
                <ArrowDownLeft className="w-4 h-4 text-sky-600" />
              </div>
              <div>
                <p className="text-[10px] text-neutral-500 uppercase">Entrées UV</p>
                <p className="text-sm font-bold text-sky-700 num">+{fmt(uvEntries)}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-orange-50/60 rounded-xl px-3.5 py-3">
              <div className="w-9 h-9 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                <ArrowUpRight className="w-4 h-4 text-orange-500" />
              </div>
              <div>
                <p className="text-[10px] text-neutral-500 uppercase">Sorties UV</p>
                <p className="text-sm font-bold text-orange-600 num">-{fmt(uvExits)}</p>
              </div>
            </div>
            {creditSales > 0 && (
              <div className="col-span-2 flex items-center gap-3 bg-amber-50/60 rounded-xl px-3.5 py-3">
                <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                  <Smartphone className="w-4 h-4 text-amber-600" />
                </div>
                <div>
                  <p className="text-[10px] text-neutral-500 uppercase">Ventes crédit téléphonique</p>
                  <p className="text-sm font-bold text-amber-700 num">{fmt(creditSales)}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Caisse par point */}
        {!selectedPointId && filteredAccounts.filter(a => a.type === 'cash').length > 1 && (
          <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-neutral-100">
              <h3 className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">Caisse par point de service</h3>
            </div>
            <div className="divide-y divide-neutral-100">
              {filteredAccounts.filter(a => a.type === 'cash').map(a => {
                const ptName = getName(a.service_point_id, points);
                return (
                  <div key={a.id} className="px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-neutral-100 flex items-center justify-center">
                        <MapPin className="w-3.5 h-3.5 text-neutral-500" />
                      </div>
                      <p className="text-sm font-medium text-neutral-900">{ptName}</p>
                    </div>
                    <p className={`text-sm font-bold num ${Number(a.balance) < 0 ? 'text-red-600' : 'text-neutral-900'}`}>{fmt(a.balance)} FCFA</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Soldes UV par service */}
        {filteredUVAccounts.length > 0 && (
          <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-neutral-100">
              <h3 className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">Solde UV par service (Transfert)</h3>
            </div>
            <div className="divide-y divide-neutral-100">
              {filteredUVAccounts.map(a => {
                const svc = services.find(s => s.id === a.service_id);
                const svcName = svc?.name || '—';
                const ptName = getName(a.service_point_id, points);
                const isLow = svc?.alert_min_balance > 0 && Number(a.balance) < svc.alert_min_balance;
                return (
                  <div key={a.id} className="px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 flex items-center justify-center">
                        {svc?.logo_url ? <img src={svc.logo_url} className="w-6 h-6 object-contain" /> : <Smartphone className="w-4 h-4 text-sky-500" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-neutral-900">{svcName}</p>
                        {!selectedPointId && <p className="text-[10px] text-neutral-400">{ptName}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-bold num ${isLow ? 'text-amber-700' : 'text-neutral-900'}`}>{fmt(a.balance)} FCFA</p>
                      {isLow && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Bas</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Stock crédit par service */}
        {filteredCreditAccounts.length > 0 && (
          <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-neutral-100">
              <h3 className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">Stock crédit par service (Crédit téléphonique)</h3>
            </div>
            <div className="divide-y divide-neutral-100">
              {filteredCreditAccounts.map(a => {
                const svc = services.find(s => s.id === a.service_id);
                const svcName = svc?.name || '—';
                const ptName = getName(a.service_point_id, points);
                const isLow = svc?.alert_min_balance > 0 && Number(a.balance) < svc.alert_min_balance;
                return (
                  <div key={a.id} className="px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 flex items-center justify-center">
                        {svc?.logo_url ? <img src={svc.logo_url} className="w-6 h-6 object-contain" /> : <Smartphone className="w-4 h-4 text-amber-500" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-neutral-900">{svcName}</p>
                        {!selectedPointId && <p className="text-[10px] text-neutral-400">{ptName}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-bold num ${isLow ? 'text-amber-700' : 'text-neutral-900'}`}>{fmt(a.balance)} FCFA</p>
                      {isLow && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Bas</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {accounts.length === 0 && (
          <div className="bg-white border border-neutral-200 rounded-xl py-16 text-center">
            <Wallet className="w-10 h-10 text-neutral-200 mx-auto mb-3" />
            <p className="text-sm text-neutral-500">Aucun compte créé</p>
            <p className="text-xs text-neutral-400 mt-1">Les comptes sont créés automatiquement lors de l'initialisation</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================ */
/* CLÔTURES                                     */
/* ============================================ */
function MTClosures() {
  const { tenant, profile } = useApp();
  const toast = useToast();
  const [closures, setClosures] = useState<any[]>([]);
  const [points, setPoints] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showOpeningForm, setShowOpeningForm] = useState(false);
  const [selectedPointId, setSelectedPointId] = useState('');
  const [theoretical, setTheoretical] = useState<{ cash: number; uvByService: { serviceId: string; name: string; amount: number }[]; creditByService: { serviceId: string; name: string; amount: number }[] } | null>(null);
  const [actualInputs, setActualInputs] = useState<Record<string, string>>({});
  const [openingInputs, setOpeningInputs] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingTheoretical, setLoadingTheoretical] = useState(false);

  const load = useCallback(async () => {
    if (!tenant) return;
    const [{ data: c }, { data: p }, { data: s }, { data: a }, { data: pr }] = await Promise.all([
      supabase.from('mt_closures').select('*').eq('tenant_id', tenant.id).order('closed_at', { ascending: false }).limit(50),
      supabase.from('mt_service_points').select('*').eq('tenant_id', tenant.id).eq('status', 'active'),
      supabase.from('mt_services').select('*').eq('tenant_id', tenant.id).eq('status', 'active'),
      supabase.from('mt_accounts').select('*').eq('tenant_id', tenant.id),
      supabase.from('profiles').select('id,full_name').eq('tenant_id', tenant.id),
    ]);
    setClosures(c || []);
    setPoints(p || []);
    setServices(s || []);
    setAccounts(a || []);
    setProfiles(pr || []);
    setLoading(false);
  }, [tenant]);

  useEffect(() => { load(); }, [load]);

  const loadTheoretical = async (pointId: string) => {
    if (!tenant || !pointId) return;
    setLoadingTheoretical(true);
    setSelectedPointId(pointId);

    const pointAccounts = accounts.filter(a => a.service_point_id === pointId);
    const cashBalance = pointAccounts.filter(a => a.type === 'cash').reduce((s, a) => s + Number(a.balance), 0);

    const transferSvcs = services.filter(s => s.family !== 'credit_telephone');
    const creditSvcs = services.filter(s => s.family === 'credit_telephone');

    const uvByService = transferSvcs.map(svc => {
      const acc = pointAccounts.find(a => a.type === 'uv' && a.service_id === svc.id);
      return { serviceId: svc.id, name: svc.name, amount: acc ? Number(acc.balance) : 0 };
    });

    const creditByService = creditSvcs.map(svc => {
      const acc = pointAccounts.find(a => a.type === 'stock_credit' && a.service_id === svc.id);
      return { serviceId: svc.id, name: svc.name, amount: acc ? Number(acc.balance) : 0 };
    });

    setTheoretical({ cash: cashBalance, uvByService, creditByService });
    const inputs: Record<string, string> = { cash: String(cashBalance) };
    uvByService.forEach(uv => { inputs[`uv_${uv.serviceId}`] = String(uv.amount); });
    creditByService.forEach(cr => { inputs[`credit_${cr.serviceId}`] = String(cr.amount); });
    setActualInputs(inputs);
    setLoadingTheoretical(false);
  };

  const getEcart = (key: string, theoreticalVal: number): number => {
    const actual = Number(actualInputs[key] || 0);
    return actual - theoreticalVal;
  };

  const closureCreate = async () => {
    if (!tenant || !selectedPointId || !theoretical) return;
    setSaving(true);
    const today = new Date().toISOString().split('T')[0];

    const cashActual = Number(actualInputs.cash || 0);
    const cashDiff = cashActual - theoretical.cash;

    const { data: todayOps } = await supabase.from('mt_operations').select('*').eq('tenant_id', tenant.id).eq('service_point_id', selectedPointId).gte('operated_at', today + 'T00:00:00').eq('status', 'validee');
    const cashIn = (todayOps || []).filter(o => ['depot', 'dechargement_grossiste', 'vente_credit'].includes(o.type)).reduce((s, o) => s + Number(o.amount), 0);
    const cashOut = (todayOps || []).filter(o => ['retrait', 'recharge_grossiste', 'achat_uv'].includes(o.type)).reduce((s, o) => s + Number(o.amount), 0);

    const uvTheoreticalTotal = theoretical.uvByService.reduce((s, uv) => s + uv.amount, 0);
    const uvActualTotal = theoretical.uvByService.reduce((s, uv) => s + Number(actualInputs[`uv_${uv.serviceId}`] || 0), 0);

    const creditTheoreticalTotal = theoretical.creditByService.reduce((s, cr) => s + cr.amount, 0);
    const creditActualTotal = theoretical.creditByService.reduce((s, cr) => s + Number(actualInputs[`credit_${cr.serviceId}`] || 0), 0);

    const totalVentesCredit = (todayOps || []).filter(o => o.type === 'vente_credit').reduce((s, o) => s + Number(o.amount), 0);

    await supabase.from('mt_closures').insert({
      tenant_id: tenant.id,
      service_point_id: selectedPointId,
      closure_date: today,
      cash_opening: theoretical.cash - cashIn + cashOut,
      cash_in: cashIn,
      cash_out: cashOut,
      cash_theoretical: theoretical.cash,
      cash_actual: cashActual,
      cash_difference: cashDiff,
      uv_opening: 0,
      uv_movements: 0,
      uv_theoretical: uvTheoreticalTotal,
      uv_actual: uvActualTotal,
      uv_difference: uvActualTotal - uvTheoreticalTotal,
      bank_theoretical: creditTheoreticalTotal,
      commissions_generated: totalVentesCredit,
      status: 'cloturee',
      closed_by: profile?.id,
      closed_at: new Date().toISOString(),
      notes: notes || null,
    });

    if (Math.abs(cashDiff) >= 1) {
      await updateBalance(tenant.id, selectedPointId, null, 'ecarts', cashDiff);
      await supabase.from('mt_operations').insert({ tenant_id: tenant.id, service_point_id: selectedPointId, type: 'ajustement', amount: Math.abs(cashDiff), commission: 0, status: 'validee', reference: `ECART-CLOTURE-${today}`, comment: `Écart constaté lors de la clôture du ${today}. Cash réel: ${cashActual}, théorique: ${theoretical.cash}`, operated_by: profile?.id, validated_by: profile?.id });
    }

    // Reset all balances for this point to zero after closure
    await supabase.from('mt_accounts').update({ balance: 0, updated_at: new Date().toISOString() }).eq('tenant_id', tenant.id).eq('service_point_id', selectedPointId);

    toast.success('Clôture effectuée avec succès');
    setSaving(false);
    setShowForm(false);
    setSelectedPointId('');
    setTheoretical(null);
    setActualInputs({});
    setNotes('');
    load();
  };

  const startOpening = async (pointId: string) => {
    setSelectedPointId(pointId);
    setShowOpeningForm(true);
    const pointAccounts = accounts.filter(a => a.service_point_id === pointId);
    const inputs: Record<string, string> = {};
    inputs.cash = String(pointAccounts.filter(a => a.type === 'cash').reduce((s, a) => s + Number(a.balance), 0));

    const transferSvcs = services.filter(s => s.family !== 'credit_telephone');
    const creditSvcs = services.filter(s => s.family === 'credit_telephone');

    // Create missing UV accounts for transfer services
    const missingTransfer = transferSvcs.filter(svc => !pointAccounts.find(a => a.type === 'uv' && a.service_id === svc.id));
    // Create missing stock_credit accounts for credit services
    const missingCredit = creditSvcs.filter(svc => !pointAccounts.find(a => a.type === 'stock_credit' && a.service_id === svc.id));

    const newAccounts: any[] = [
      ...missingTransfer.map(svc => ({ tenant_id: tenant!.id, service_point_id: pointId, service_id: svc.id, type: 'uv', label: `UV ${svc.name}`, currency: svc.currency || 'XOF', balance: 0 })),
      ...missingCredit.map(svc => ({ tenant_id: tenant!.id, service_point_id: pointId, service_id: svc.id, type: 'stock_credit', label: `Stock crédit ${svc.name}`, currency: svc.currency || 'XOF', balance: 0 })),
    ];

    if (newAccounts.length > 0 && tenant) {
      const { data: inserted } = await supabase.from('mt_accounts').insert(newAccounts).select('*');
      if (inserted) {
        const updatedAccounts = [...accounts, ...inserted];
        setAccounts(updatedAccounts);
        const allPointAccounts = updatedAccounts.filter(a => a.service_point_id === pointId);
        allPointAccounts.filter(a => a.type === 'uv').forEach(a => { inputs[`uv_${a.service_id}`] = String(Number(a.balance)); });
        allPointAccounts.filter(a => a.type === 'stock_credit').forEach(a => { inputs[`credit_${a.service_id}`] = String(Number(a.balance)); });
      }
    } else {
      pointAccounts.filter(a => a.type === 'uv').forEach(a => { inputs[`uv_${a.service_id}`] = String(Number(a.balance)); });
      pointAccounts.filter(a => a.type === 'stock_credit').forEach(a => { inputs[`credit_${a.service_id}`] = String(Number(a.balance)); });
    }

    setOpeningInputs(inputs);
  };

  const confirmOpening = async () => {
    if (!tenant || !selectedPointId) return;
    setSaving(true);

    const pointAccounts = accounts.filter(a => a.service_point_id === selectedPointId);

    const cashAcc = pointAccounts.find(a => a.type === 'cash');
    const newCash = Number(openingInputs.cash || 0);
    if (cashAcc) {
      const diff = newCash - Number(cashAcc.balance);
      if (Math.abs(diff) >= 1) {
        await supabase.from('mt_accounts').update({ balance: newCash, updated_at: new Date().toISOString() }).eq('id', cashAcc.id);
        await supabase.from('mt_operations').insert({ tenant_id: tenant.id, service_point_id: selectedPointId, type: 'ajustement', amount: Math.abs(diff), commission: 0, status: 'validee', reference: 'OUVERTURE-JOUR', comment: `Ajustement d'ouverture: nouveau solde cash ${newCash}`, operated_by: profile?.id, validated_by: profile?.id });
      }
    }

    const transferSvcs = services.filter(s => s.family !== 'credit_telephone');
    const creditSvcs = services.filter(s => s.family === 'credit_telephone');

    // Handle transfer services (UV accounts)
    for (const svc of transferSvcs) {
      const uvAcc = pointAccounts.find(a => a.type === 'uv' && a.service_id === svc.id);
      const newUv = Number(openingInputs[`uv_${svc.id}`] || 0);
      if (uvAcc) {
        const diff = newUv - Number(uvAcc.balance);
        if (Math.abs(diff) >= 1) {
          await supabase.from('mt_accounts').update({ balance: newUv, updated_at: new Date().toISOString() }).eq('id', uvAcc.id);
          await supabase.from('mt_operations').insert({ tenant_id: tenant.id, service_point_id: selectedPointId, service_id: svc.id, type: 'ajustement', amount: Math.abs(diff), commission: 0, status: 'validee', reference: 'OUVERTURE-JOUR', comment: `Ajustement d'ouverture UV ${svc.name}: nouveau solde ${newUv}`, operated_by: profile?.id, validated_by: profile?.id });
        }
      } else if (newUv > 0) {
        const { data: newAcc } = await supabase.from('mt_accounts').insert({ tenant_id: tenant.id, service_point_id: selectedPointId, service_id: svc.id, type: 'uv', label: `UV ${svc.name}`, currency: svc.currency || 'XOF', balance: newUv }).select('id').single();
        if (newAcc) {
          await supabase.from('mt_operations').insert({ tenant_id: tenant.id, service_point_id: selectedPointId, service_id: svc.id, type: 'ajustement', amount: newUv, commission: 0, status: 'validee', reference: 'OUVERTURE-JOUR', comment: `Initialisation UV ${svc.name}: solde ${newUv}`, operated_by: profile?.id, validated_by: profile?.id });
        }
      }
    }

    // Handle credit services (stock_credit accounts)
    for (const svc of creditSvcs) {
      const creditAcc = pointAccounts.find(a => a.type === 'stock_credit' && a.service_id === svc.id);
      const newCredit = Number(openingInputs[`credit_${svc.id}`] || 0);
      if (creditAcc) {
        const diff = newCredit - Number(creditAcc.balance);
        if (Math.abs(diff) >= 1) {
          await supabase.from('mt_accounts').update({ balance: newCredit, updated_at: new Date().toISOString() }).eq('id', creditAcc.id);
          await supabase.from('mt_operations').insert({ tenant_id: tenant.id, service_point_id: selectedPointId, service_id: svc.id, type: 'ajustement_credit', amount: Math.abs(diff), commission: 0, status: 'validee', reference: 'OUVERTURE-JOUR', comment: `Ajustement d'ouverture stock crédit ${svc.name}: nouveau solde ${newCredit}`, operated_by: profile?.id, validated_by: profile?.id });
        }
      } else if (newCredit > 0) {
        const { data: newAcc } = await supabase.from('mt_accounts').insert({ tenant_id: tenant.id, service_point_id: selectedPointId, service_id: svc.id, type: 'stock_credit', label: `Stock crédit ${svc.name}`, currency: svc.currency || 'XOF', balance: newCredit }).select('id').single();
        if (newAcc) {
          await supabase.from('mt_operations').insert({ tenant_id: tenant.id, service_point_id: selectedPointId, service_id: svc.id, type: 'ajustement_credit', amount: newCredit, commission: 0, status: 'validee', reference: 'OUVERTURE-JOUR', comment: `Initialisation stock crédit ${svc.name}: solde ${newCredit}`, operated_by: profile?.id, validated_by: profile?.id });
        }
      }
    }

    toast.success('Ouverture enregistrée. Bonne journée !');
    setSaving(false);
    setShowOpeningForm(false);
    setSelectedPointId('');
    setOpeningInputs({});
    load();
  };

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-5 h-5 animate-spin text-neutral-400" /></div>;

  const lastClosureByPoint = (pointId: string) => closures.find(c => c.service_point_id === pointId);

  return (
    <div className="max-w-[1100px] mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-neutral-900">Clôtures & Ouvertures</h2>
          <p className="text-xs text-neutral-500 mt-0.5">Clôturez la journée et ouvrez avec les nouveaux montants de départ.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowOpeningForm(false) || setShowForm(true)} className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-neutral-900 text-white rounded-lg hover:bg-neutral-800">
            <Lock className="w-4 h-4" />Clôturer
          </button>
          <button onClick={() => setShowForm(false) || setShowOpeningForm(true)} className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
            <PlayCircle className="w-4 h-4" />Ouvrir journée
          </button>
        </div>
      </div>

      {/* Closure form */}
      {showForm && (
        <div className="bg-white border border-neutral-200 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-neutral-900">Clôture journalière</h3>
          <div className="flex items-center gap-3">
            <select value={selectedPointId} onChange={e => { loadTheoretical(e.target.value); }} className="input text-sm w-auto">
              <option value="">Sélectionner un point de service</option>
              {points.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {loadingTheoretical && <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-neutral-400" /></div>}

          {theoretical && selectedPointId && !loadingTheoretical && (
            <div className="space-y-4">
              <div className="rounded-lg border border-neutral-100 bg-neutral-50/50 p-4">
                <p className="text-[11px] font-medium text-neutral-500 uppercase tracking-wide mb-3">Soldes théoriques vs réels</p>
                <div className="space-y-3">
                  {/* Cash */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 items-center">
                    <div className="flex items-center gap-2 col-span-2 sm:col-span-1">
                      <Banknote className="w-4 h-4 text-emerald-500" />
                      <span className="text-sm font-medium text-neutral-900">Cash</span>
                    </div>
                    <div className="text-left sm:text-center">
                      <p className="text-[10px] text-neutral-400">Théorique</p>
                      <p className="text-sm font-semibold text-neutral-700">{fmt(theoretical.cash)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-neutral-400 mb-0.5">Réel compté</p>
                      <input type="number" value={actualInputs.cash || ''} onChange={e => setActualInputs(prev => ({ ...prev, cash: e.target.value }))} className="input text-sm font-semibold py-1.5" />
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] text-neutral-400">Écart</p>
                      <p className={`text-sm font-bold ${getEcart('cash', theoretical.cash) === 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {getEcart('cash', theoretical.cash) >= 0 ? '+' : ''}{fmt(getEcart('cash', theoretical.cash))}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Transfer services - UV */}
              {theoretical.uvByService.length > 0 && (
                <div className="rounded-lg border border-sky-100 bg-sky-50/30 p-4">
                  <p className="text-[11px] font-medium text-sky-700 uppercase tracking-wide mb-3 flex items-center gap-2">
                    <ArrowRightLeft className="w-3.5 h-3.5" />Transfert d'argent - Soldes UV
                  </p>
                  <div className="space-y-3">
                    {theoretical.uvByService.map(uv => (
                      <div key={uv.serviceId} className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 items-center">
                        <div className="flex items-center gap-2 col-span-2 sm:col-span-1">
                          <Smartphone className="w-4 h-4 text-sky-500" />
                          <span className="text-sm font-medium text-neutral-900">{uv.name}</span>
                        </div>
                        <div className="text-center">
                          <p className="text-[10px] text-neutral-400">Théorique</p>
                          <p className="text-sm font-semibold text-neutral-700">{fmt(uv.amount)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-neutral-400 mb-0.5">Réel</p>
                          <input type="number" value={actualInputs[`uv_${uv.serviceId}`] || ''} onChange={e => setActualInputs(prev => ({ ...prev, [`uv_${uv.serviceId}`]: e.target.value }))} className="input text-sm font-semibold py-1.5" />
                        </div>
                        <div className="text-center">
                          <p className="text-[10px] text-neutral-400">Écart</p>
                          <p className={`text-sm font-bold ${getEcart(`uv_${uv.serviceId}`, uv.amount) === 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {getEcart(`uv_${uv.serviceId}`, uv.amount) >= 0 ? '+' : ''}{fmt(getEcart(`uv_${uv.serviceId}`, uv.amount))}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Credit services - Stock */}
              {theoretical.creditByService.length > 0 && (
                <div className="rounded-lg border border-amber-100 bg-amber-50/30 p-4">
                  <p className="text-[11px] font-medium text-amber-700 uppercase tracking-wide mb-3 flex items-center gap-2">
                    <Smartphone className="w-3.5 h-3.5" />Crédit téléphonique - Stock
                  </p>
                  <div className="space-y-3">
                    {theoretical.creditByService.map(cr => (
                      <div key={cr.serviceId} className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 items-center">
                        <div className="flex items-center gap-2 col-span-2 sm:col-span-1">
                          <Smartphone className="w-4 h-4 text-amber-500" />
                          <span className="text-sm font-medium text-neutral-900">{cr.name}</span>
                        </div>
                        <div className="text-center">
                          <p className="text-[10px] text-neutral-400">Théorique</p>
                          <p className="text-sm font-semibold text-neutral-700">{fmt(cr.amount)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-neutral-400 mb-0.5">Réel</p>
                          <input type="number" value={actualInputs[`credit_${cr.serviceId}`] || ''} onChange={e => setActualInputs(prev => ({ ...prev, [`credit_${cr.serviceId}`]: e.target.value }))} className="input text-sm font-semibold py-1.5" />
                        </div>
                        <div className="text-center">
                          <p className="text-[10px] text-neutral-400">Écart</p>
                          <p className={`text-sm font-bold ${getEcart(`credit_${cr.serviceId}`, cr.amount) === 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {getEcart(`credit_${cr.serviceId}`, cr.amount) >= 0 ? '+' : ''}{fmt(getEcart(`credit_${cr.serviceId}`, cr.amount))}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes / observations (optionnel)" className="input text-sm" />

              <div className="flex gap-2">
                <button onClick={() => { setShowForm(false); setTheoretical(null); setSelectedPointId(''); }} className="px-4 py-2.5 text-sm border border-neutral-200 rounded-lg hover:bg-neutral-50">Annuler</button>
                <button onClick={closureCreate} disabled={saving} className="px-6 py-2.5 text-sm font-semibold bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 disabled:opacity-50 flex items-center gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}Confirmer la clôture
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Opening form */}
      {showOpeningForm && (
        <div className="bg-white border border-emerald-200 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-neutral-900 flex items-center gap-2">
            <PlayCircle className="w-4 h-4 text-emerald-600" />Ouverture de journée
          </h3>
          <p className="text-xs text-neutral-500">Saisissez les montants de départ réels pour commencer la journée. Les soldes peuvent différer de la veille.</p>
          <select value={selectedPointId} onChange={e => startOpening(e.target.value)} className="input text-sm w-auto">
            <option value="">Sélectionner un point de service</option>
            {points.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          {selectedPointId && (
            <div className="space-y-3">
              <div className="rounded-lg border border-neutral-100 bg-neutral-50/50 p-4">
                <p className="text-[11px] font-medium text-neutral-500 uppercase tracking-wide mb-3">Montants de départ</p>
                <div className="space-y-4">
                  {/* Cash */}
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-2 text-[11px] font-medium text-neutral-500 uppercase tracking-wide">
                      <Banknote className="w-3.5 h-3.5 text-emerald-500" />Caisse (Cash)
                    </label>
                    <input type="number" value={openingInputs.cash || ''} onChange={e => setOpeningInputs(prev => ({ ...prev, cash: e.target.value }))} className="input text-base font-semibold" placeholder="0" />
                  </div>

                  {/* Transfer services section */}
                  {services.filter(s => s.family !== 'credit_telephone').length > 0 && (
                    <div className="pt-3 border-t border-neutral-200">
                      <p className="text-[10px] font-semibold text-sky-700 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                        <ArrowRightLeft className="w-3 h-3" />Transfert d'argent - UV
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {services.filter(s => s.family !== 'credit_telephone').map(svc => (
                          <div key={svc.id} className="space-y-1.5">
                            <label className="flex items-center gap-2 text-[11px] font-medium text-neutral-500 uppercase tracking-wide">
                              {svc?.logo_url ? <img src={svc.logo_url} alt="" className="w-4 h-4 rounded object-contain" /> : <Smartphone className="w-3.5 h-3.5 text-sky-500" />}
                              {svc?.name || 'Service'}
                            </label>
                            <input type="number" value={openingInputs[`uv_${svc.id}`] || ''} onChange={e => setOpeningInputs(prev => ({ ...prev, [`uv_${svc.id}`]: e.target.value }))} className="input text-base font-semibold" placeholder="0" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Credit services section */}
                  {services.filter(s => s.family === 'credit_telephone').length > 0 && (
                    <div className="pt-3 border-t border-neutral-200">
                      <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                        <Smartphone className="w-3 h-3" />Crédit téléphonique - Stock
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {services.filter(s => s.family === 'credit_telephone').map(svc => (
                          <div key={svc.id} className="space-y-1.5">
                            <label className="flex items-center gap-2 text-[11px] font-medium text-neutral-500 uppercase tracking-wide">
                              {svc?.logo_url ? <img src={svc.logo_url} alt="" className="w-4 h-4 rounded object-contain" /> : <Smartphone className="w-3.5 h-3.5 text-amber-500" />}
                              {svc?.name || 'Service'}
                            </label>
                            <input type="number" value={openingInputs[`credit_${svc.id}`] || ''} onChange={e => setOpeningInputs(prev => ({ ...prev, [`credit_${svc.id}`]: e.target.value }))} className="input text-base font-semibold" placeholder="0" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setShowOpeningForm(false); setSelectedPointId(''); }} className="px-4 py-2.5 text-sm border border-neutral-200 rounded-lg hover:bg-neutral-50">Annuler</button>
                <button onClick={confirmOpening} disabled={saving} className="px-6 py-2.5 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}Confirmer l'ouverture
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quick status per point */}
      {!showForm && !showOpeningForm && points.length > 0 && (
        <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-100">
            <h3 className="text-sm font-semibold text-neutral-900">État par point de service</h3>
          </div>
          <div className="divide-y divide-neutral-100">
            {points.map(pt => {
              const last = lastClosureByPoint(pt.id);
              const ptAccounts = accounts.filter(a => a.service_point_id === pt.id);
              const ptCash = ptAccounts.filter(a => a.type === 'cash').reduce((s, a) => s + Number(a.balance), 0);
              return (
                <div key={pt.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-neutral-100 flex items-center justify-center">
                    <MapPin className="w-4 h-4 text-neutral-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-neutral-900">{pt.name}</p>
                    <p className="text-xs text-neutral-400">
                      {last ? `Dernière clôture: ${new Date(last.closure_date).toLocaleDateString('fr-FR')}` : 'Jamais clôturé'}
                      {last && Number(last.cash_difference) !== 0 && (
                        <span className="text-red-500 ml-2">Écart: {fmt(last.cash_difference)} FCFA</span>
                      )}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-neutral-900">{fmt(ptCash)} <span className="text-[10px] font-normal text-neutral-400">FCFA</span></p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Closure history */}
      {closures.length > 0 && (
        <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-100">
            <h3 className="text-sm font-semibold text-neutral-900">Historique des clôtures</h3>
          </div>
          <div className="divide-y divide-neutral-100">
            {closures.map(c => {
              const pt = points.find(p => p.id === c.service_point_id);
              const closedByProfile = profiles.find(p => p.id === c.closed_by);
              const hasEcart = Math.abs(Number(c.cash_difference)) >= 1 || Math.abs(Number(c.uv_difference)) >= 1;
              return (
                <div key={c.id} className={`px-4 py-4 ${hasEcart ? 'bg-red-50/30' : ''}`}>
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${hasEcart ? 'bg-red-100' : 'bg-emerald-50'}`}>
                        <Lock className={`w-4 h-4 ${hasEcart ? 'text-red-500' : 'text-emerald-600'}`} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-neutral-900">{pt?.name || '—'}</p>
                        <p className="text-xs text-neutral-400">
                          {c.closed_at ? new Date(c.closed_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : new Date(c.closure_date).toLocaleDateString('fr-FR')}
                          {closedByProfile && <span className="ml-2">par {closedByProfile.full_name}</span>}
                        </p>
                      </div>
                    </div>
                    {hasEcart && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 shrink-0">Écart</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-3 pt-3 border-t border-neutral-100">
                    <div>
                      <p className="text-[10px] text-neutral-400 uppercase">Dépôts</p>
                      <p className="text-sm font-semibold text-emerald-700 mt-0.5">+{fmt(c.cash_in)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-neutral-400 uppercase">Retraits</p>
                      <p className="text-sm font-semibold text-red-600 mt-0.5">-{fmt(c.cash_out)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-neutral-400 uppercase">Cash clôture</p>
                      <p className="text-sm font-semibold text-neutral-900 mt-0.5">{fmt(c.cash_actual)}</p>
                      {Number(c.cash_difference) !== 0 && (
                        <p className="text-[9px] text-red-500">Écart: {Number(c.cash_difference) > 0 ? '+' : ''}{fmt(c.cash_difference)}</p>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] text-neutral-400 uppercase">UV clôture</p>
                      <p className="text-sm font-semibold text-sky-700 mt-0.5">{fmt(c.uv_actual)}</p>
                      {Number(c.uv_difference) !== 0 && (
                        <p className="text-[9px] text-red-500">Écart: {Number(c.uv_difference) > 0 ? '+' : ''}{fmt(c.uv_difference)}</p>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] text-neutral-400 uppercase">Ventes crédit</p>
                      <p className="text-sm font-semibold text-amber-700 mt-0.5">{fmt(c.commissions_generated)}</p>
                      {Number(c.bank_theoretical) > 0 && (
                        <p className="text-[9px] text-neutral-400">Stock: {fmt(c.bank_theoretical)}</p>
                      )}
                    </div>
                  </div>
                  {c.notes && <p className="text-xs text-neutral-400 italic mt-2">{c.notes}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {closures.length === 0 && !showForm && !showOpeningForm && (
        <div className="bg-white border border-neutral-200 rounded-xl py-16 text-center">
          <Lock className="w-10 h-10 text-neutral-300 mx-auto mb-3" />
          <p className="text-sm text-neutral-500">Aucune clôture effectuée</p>
          <p className="text-xs text-neutral-400 mt-1">Clôturez en fin de journée pour suivre les écarts</p>
        </div>
      )}
    </div>
  );
}

/* ============================================ */
/* RAPPORTS                                     */
/* ============================================ */
function MTReports() {
  const { tenant } = useApp();
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<string>('operations');
  const [dateFrom, setDateFrom] = useState(new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [data, setData] = useState<any[]>([]);

  const generate = async () => {
    if (!tenant) return;
    setLoading(true);
    let q;
    if (report === 'operations') {
      q = supabase.from('mt_operations').select('*').eq('tenant_id', tenant.id).gte('operated_at', dateFrom + 'T00:00:00').lte('operated_at', dateTo + 'T23:59:59').order('operated_at', { ascending: false });
    } else if (report === 'depots') {
      q = supabase.from('mt_operations').select('*').eq('tenant_id', tenant.id).eq('type', 'depot').gte('operated_at', dateFrom + 'T00:00:00').lte('operated_at', dateTo + 'T23:59:59').order('operated_at', { ascending: false });
    } else if (report === 'retraits') {
      q = supabase.from('mt_operations').select('*').eq('tenant_id', tenant.id).eq('type', 'retrait').gte('operated_at', dateFrom + 'T00:00:00').lte('operated_at', dateTo + 'T23:59:59').order('operated_at', { ascending: false });
    } else {
      q = supabase.from('mt_closures').select('*').eq('tenant_id', tenant.id).gte('closure_date', dateFrom).lte('closure_date', dateTo).order('closure_date', { ascending: false });
    }
    const { data: result } = await q;
    setData(result || []);
    setLoading(false);
  };

  const totalAmount = data.reduce((s, d) => s + Number(d.amount || 0), 0);

  return (
    <div className="max-w-[1200px] mx-auto space-y-4">
      <h2 className="text-lg font-bold text-neutral-900">Rapports</h2>

      <div className="bg-white border border-neutral-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-neutral-500 mb-1 block">Type de rapport</label>
            <select value={report} onChange={e => setReport(e.target.value)} className="input text-sm">
              <option value="operations">Toutes les opérations</option>
              <option value="depots">Dépôts</option>
              <option value="retraits">Retraits</option>
              <option value="clotures">Clôtures</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-neutral-500 mb-1 block">Du</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input text-sm" />
          </div>
          <div>
            <label className="text-xs text-neutral-500 mb-1 block">Au</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input text-sm" />
          </div>
          <button onClick={generate} disabled={loading} className="px-4 py-2 text-sm font-medium bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 disabled:opacity-50 flex items-center gap-2">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BarChart3 className="w-3.5 h-3.5" />}Générer
          </button>
        </div>
      </div>

      {data.length > 0 && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="bg-white border border-neutral-200 rounded-xl p-4">
              <p className="text-xs text-neutral-500">Nombre de lignes</p>
              <p className="text-lg font-bold text-neutral-900">{data.length}</p>
            </div>
            <div className="bg-white border border-neutral-200 rounded-xl p-4">
              <p className="text-xs text-neutral-500">Total montants</p>
              <p className="text-lg font-bold text-neutral-900">{fmt(totalAmount)} <span className="text-xs font-normal text-neutral-400">FCFA</span></p>
            </div>
          </div>

          <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 border-b border-neutral-200 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium text-neutral-500">Date</th>
                    <th className="text-left px-4 py-2.5 font-medium text-neutral-500">Type</th>
                    <th className="text-right px-4 py-2.5 font-medium text-neutral-500">Montant</th>
                    <th className="text-center px-4 py-2.5 font-medium text-neutral-500">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {data.map((d: any) => (
                    <tr key={d.id}>
                      <td className="px-4 py-2 text-neutral-600">{new Date(d.operated_at || d.closure_date).toLocaleDateString('fr-FR')}</td>
                      <td className="px-4 py-2 text-neutral-900">{OP_TYPE_LABELS[d.type] || d.type || 'Clôture'}</td>
                      <td className="px-4 py-2 text-right font-medium">{fmt(d.amount || d.cash_theoretical)}</td>
                      <td className="px-4 py-2 text-center"><span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[d.status] || 'bg-neutral-100 text-neutral-500'}`}>{STATUS_LABELS[d.status] || d.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {data.length === 0 && !loading && (
        <div className="bg-white border border-neutral-200 rounded-xl py-16 text-center">
          <FileText className="w-10 h-10 text-neutral-300 mx-auto mb-3" />
          <p className="text-sm text-neutral-500">Sélectionnez un rapport et une période puis cliquez Générer</p>
        </div>
      )}
    </div>
  );
}

/* ============================================ */
/* PARAMÈTRES                                   */
/* ============================================ */
type SettingsTab = 'initialisation' | 'points' | 'services' | 'grossistes' | 'config';

function MTSettings({ onValidated }: { onValidated: () => void }) {
  const { can } = usePermissions();
  const [activeTab, setActiveTab] = useState<SettingsTab>('initialisation');

  const tabs: { key: SettingsTab; label: string; icon: any; visible: boolean }[] = [
    { key: 'initialisation', label: 'Initialisation', icon: PlayCircle, visible: can('mt_balance_initialize') },
    { key: 'points', label: 'Points de service', icon: MapPin, visible: true },
    { key: 'services', label: 'Services', icon: ArrowRightLeft, visible: can('mt_services_manage') },
    { key: 'grossistes', label: 'Grossistes', icon: Users, visible: can('mt_wholesaler_view') },
    { key: 'config', label: 'Configuration', icon: Settings2, visible: true },
  ].filter(t => t.visible);

  return (
    <div className="max-w-[1100px] mx-auto space-y-4">
      <h2 className="text-lg font-bold text-neutral-900">Paramètres</h2>

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-neutral-200 overflow-x-auto scrollbar-hide">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-all -mb-px ${
              activeTab === t.key
                ? 'border-neutral-900 text-neutral-900'
                : 'border-transparent text-neutral-500 hover:text-neutral-700'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      <div>
        {activeTab === 'initialisation' && can('mt_balance_initialize') && <MTInitialisation onValidated={onValidated} />}
        {activeTab === 'points' && <MTServicePoints />}
        {activeTab === 'services' && can('mt_services_manage') && <MTServices />}
        {activeTab === 'grossistes' && can('mt_wholesaler_view') && <MTWholesalers />}
        {activeTab === 'config' && (
          <div className="max-w-[700px] bg-white border border-neutral-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-3 pb-3 border-b border-neutral-100">
              <Settings2 className="w-5 h-5 text-neutral-400" />
              <div>
                <p className="text-sm font-medium text-neutral-900">Module Transfert d'argent</p>
                <p className="text-xs text-neutral-400">Informations de configuration du module</p>
              </div>
            </div>
            <div className="space-y-3 text-sm text-neutral-600">
              <p>Les comptes internes sont créés automatiquement lors de l'initialisation des points de service.</p>
              <p>Les clôtures journalières réinitialisent tous les soldes du point une fois validées.</p>
              <p>Les opérations validées ne peuvent pas être supprimées — utilisez l'annulation (contrepassation) pour corriger une erreur.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
