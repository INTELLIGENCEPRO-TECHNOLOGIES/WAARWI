import { useRealtimeTick, useRealtimeRefresh } from '../lib/useRealtimeData';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { ArrowLeft, ArrowDownLeft, ArrowUpRight, RefreshCw, BarChart3, Settings2, Plus, X, Check, AlertTriangle, Loader2, Pencil as Edit2, Trash2, ArrowRightLeft, Banknote, Clock, CheckCircle2, XCircle, TrendingUp, Wallet, MapPin, User, FileText, Lock, PlayCircle, ShieldCheck, Smartphone, Package, Users, Receipt, HandCoins, Phone } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { usePermissions } from '../lib/permissions';
import { ConfirmDialog, Modal } from '../components/Modal';
import { SearchableSelect } from '../components/SearchableSelect';
import { PageSearch } from '../components/PageSearch';

type SubPage = 'dashboard' | 'operations' | 'operations_grossiste' | 'depenses' | 'clients' | 'soldes' | 'clotures' | 'rapports' | 'parametres';

const SUB_NAV: { key: SubPage; label: string; icon: any }[] = [
  { key: 'dashboard', label: 'Tableau de bord', icon: BarChart3 },
  { key: 'operations', label: 'Opérations clients', icon: RefreshCw },
  { key: 'operations_grossiste', label: 'Opérations grossiste', icon: Package },
  { key: 'depenses', label: 'Dépenses', icon: Receipt },
  { key: 'clients', label: 'Clients et créances', icon: Users },
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
  rapprochee: 'w-badge-muted',
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
  const [initStatus, setInitStatus] = useState<string>('loading');

  const loadInitStatus = useCallback(async () => {
    if (!tenant) return;
    const { data } = await supabase.from('mt_init_status').select('status').eq('tenant_id', tenant.id).maybeSingle();
    setInitStatus(data?.status || 'non_initialise');
  }, [tenant]);

  useEffect(() => { loadInitStatus(); }, [loadInitStatus]);
  useRealtimeRefresh(['mt_init_status'], loadInitStatus);

  const isInitialized = initStatus === 'valide';
  const blockedPages: SubPage[] = ['operations', 'operations_grossiste', 'depenses', 'clients', 'soldes', 'clotures', 'rapports'];

  const isNavVisible = (key: SubPage): boolean => {
    if (permsLoading) return true;
    if (key === 'operations_grossiste') return can('mt_wholesaler_operation_view');
    if (key === 'depenses') return can('mt_expense_view');
    if (key === 'clients') return can('mt_customer_view');
    if (key === 'parametres') return can('mt_settings_manage');
    if (key === 'rapports') return can('mt_report_view_site');
    return true;
  };

  const navigation = SUB_NAV.filter(item => isNavVisible(item.key));

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="shrink-0 border-b border-[var(--w-separator)] bg-[var(--w-surface)]">
        <div className="mx-auto max-w-[1400px] px-1 py-2.5 lg:px-4">
          <h1 className="text-base font-bold text-[var(--w-text)]">Transfert d’argent</h1>
          <SearchableSelect ariaLabel="Rubrique de transfert d’argent" value={sub} onChange={value => setSub(value as SubPage)}
            className="mt-2 min-w-0 lg:hidden" searchable={false} clearable={false}
            options={navigation.map(item => ({
              value: item.key, label: item.label, disabled: !isInitialized && blockedPages.includes(item.key),
            }))} />
          <nav aria-label="Rubriques de transfert d’argent" className="mt-2 hidden flex-wrap gap-1 lg:flex">
            {navigation.map(item => (
              <button key={item.key} type="button" aria-current={sub === item.key ? 'page' : undefined}
                disabled={!isInitialized && blockedPages.includes(item.key)}
                onClick={() => setSub(item.key)}
                className={`btn-ghost min-h-9 px-2.5 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${sub === item.key ? 'bg-[var(--w-active)] font-semibold !text-[var(--w-text)]' : ''}`}>
                <item.icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <div className="min-w-0 flex-1 overflow-y-auto px-1 py-3 lg:px-4 lg:py-5">
        {sub === 'dashboard' && <MTDashboard isInitialized={isInitialized} onGoInit={() => setSub('parametres')} />}
        {sub === 'operations' && isInitialized && <MTOperations />}
        {sub === 'operations_grossiste' && isInitialized && can('mt_wholesaler_operation_view') && <MTWholesalerOperations />}
        {sub === 'depenses' && isInitialized && can('mt_expense_view') && <MTExpenses />}
        {sub === 'clients' && isInitialized && can('mt_customer_view') && <MTCustomers />}
        {sub === 'soldes' && isInitialized && <MTBalances />}
        {sub === 'clotures' && isInitialized && <MTClosures />}
        {sub === 'rapports' && isInitialized && can('mt_report_view_site') && <MTReports />}
        {sub === 'parametres' && can('mt_settings_manage') && <MTSettings onValidated={() => { loadInitStatus(); setSub('dashboard'); }} />}
        {!isInitialized && blockedPages.includes(sub) && <BlockedMessage onGoInit={() => setSub('parametres')} />}
      </div>
    </div>
  );
}

function MTEmpty({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-6 text-center text-sm text-[var(--w-text-muted)]">{children}</p>;
}

function BlockedMessage({ onGoInit }: { onGoInit: () => void }) {
  const { can } = usePermissions();
  return (
    <section className="mx-auto max-w-xl space-y-3 border-b border-[var(--w-separator)] px-1 py-4">
      <div className="flex items-start gap-2">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[var(--w-text-muted)]" aria-hidden="true" />
        <div>
          <h2 className="text-sm font-semibold text-[var(--w-text)]">Soldes d’ouverture à configurer</h2>
          <p className="mt-0.5 text-sm text-[var(--w-text-sec)]">Configurez les points de service, les services et leurs soldes d’ouverture pour accéder aux opérations.</p>
        </div>
      </div>
      {can('mt_settings_manage') && <button type="button" onClick={onGoInit} className="btn-primary text-xs">Initialiser les soldes</button>}
    </section>
  );
}

function MTMoney({ value, className = '' }: { value: number; className?: string }) {
  return <span className={`num whitespace-nowrap ${className}`}>{fmt(value)} <span className="text-[0.72em] font-medium">FCFA</span></span>;
}

function MTFormActions({ cancel, submit, label, busy, disabled = false }: {
  cancel: () => void; submit: () => void; label: string; busy: boolean; disabled?: boolean;
}) {
  return (
    <>
      <button type="button" onClick={cancel} disabled={busy} className="btn-secondary text-xs disabled:opacity-50">Annuler</button>
      <button type="button" onClick={submit} disabled={busy || disabled} className="btn-primary text-xs">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
        {label}
      </button>
    </>
  );
}

function MTSectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="border-b border-[var(--w-separator)] px-3.5 py-2.5 text-sm font-semibold xl:px-4">{children}</h3>;
}

/* ============================================ */
/* DASHBOARD                                    */
/* ============================================ */
function MTDashboard({ isInitialized, onGoInit }: { isInitialized: boolean; onGoInit: () => void }) {
  const { tenant } = useApp();
  const [loading, setLoading] = useState(true);
  const [points, setPoints] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [todayOps, setTodayOps] = useState<any[]>([]);
  const [, setProfiles] = useState<any[]>([]);
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
  useRealtimeRefresh(['mt_operations', 'mt_closures', 'mt_expenses', 'mt_accounts', 'mt_service_points', 'mt_services'], load);



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

  if (!isInitialized) return <BlockedMessage onGoInit={onGoInit} />;

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

  const topPoints = [...pointStats].sort((a, b) => b.opsCount - a.opsCount || b.volume - a.volume).slice(0, 3);
  const dailyAmounts = [
    { label: 'Caisse', value: totalCash },
    { label: 'Unités de valeur', value: totalUV },
    { label: 'Stock crédit', value: totalCredit },
    { label: 'Dépôts du jour', value: deposits },
    { label: 'Retraits du jour', value: withdrawals },
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-[var(--w-text)]">Situation du jour</h2>
          <p className="text-xs text-[var(--w-text-sec)]">{new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <SearchableSelect ariaLabel="Filtrer par point de service" value={selectedPointId ?? ''}
            onChange={value => setSelectedPointId(value || null)} className="min-w-0 max-w-full" clearable={false}
            searchable={points.length > 8} wrapLabels options={[
              { value: '', label: 'Tous les points' }, ...points.map(point => ({ value: point.id, label: point.name })),
            ]} />
          <button type="button" onClick={load} className="btn-icon" aria-label="Actualiser la situation" title="Actualiser">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
        <section className="min-w-0 rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)]">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--w-separator)] px-3.5 py-3 xl:px-4">
            <div>
              <p className="text-xs text-[var(--w-text-sec)]">Liquidités (caisse et UV)</p>
              <MTMoney value={totalCash + totalUV} className="text-[clamp(1.05rem,6vw,1.875rem)] font-bold" />
            </div>
            <div className="text-sm">
              <p className="text-xs text-[var(--w-text-sec)]">Total avec stock crédit</p>
              <MTMoney value={totalCash + totalUV + totalCredit} className="font-semibold" />
            </div>
          </div>
          <dl className="grid grid-cols-1 divide-y divide-[var(--w-separator-l)] px-3.5 sm:grid-cols-2 sm:gap-x-5 sm:divide-y-0 xl:px-4">
            {dailyAmounts.map(({ label, value }) => (
              <div key={label} className="flex min-w-0 items-baseline justify-between gap-3 py-2 text-sm sm:border-b sm:border-[var(--w-separator-l)]">
                <dt className="text-xs text-[var(--w-text-sec)]">{label}</dt>
                <dd className="font-semibold"><MTMoney value={value} /></dd>
              </div>
            ))}
            <div className="flex min-w-0 items-baseline justify-between gap-3 py-2 text-sm">
              <dt className="text-xs text-[var(--w-text-sec)]">Opérations du jour</dt>
              <dd className="num font-semibold">{fmt(opsCount)}</dd>
            </div>
            {creditSales > 0 && <div className="flex min-w-0 items-baseline justify-between gap-3 py-2 text-sm">
              <dt className="text-xs text-[var(--w-text-sec)]">Ventes crédit du jour</dt>
              <dd className="font-semibold"><MTMoney value={creditSales} /></dd>
            </div>}
          </dl>
        </section>

        <section className="min-w-0 rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)]">
          <MTSectionHeading>Points les plus actifs</MTSectionHeading>
          {topPoints.length === 0 ? <MTEmpty>Aucun point de service</MTEmpty> : (
            <ul className="divide-y divide-[var(--w-separator-l)] px-3.5 xl:px-4">
              {topPoints.map(point => <li key={point.id} className="flex items-baseline justify-between gap-2 py-2.5 text-sm">
                <span className="font-medium">{point.name}</span>
                <span className="shrink-0 text-xs text-[var(--w-text-muted)]">{point.opsCount} op.</span>
              </li>)}
            </ul>
          )}
          {totalAlerts > 0 && (
            <p className="flex items-start gap-2 border-t border-[var(--w-separator)] px-3.5 py-2.5 text-xs text-[var(--w-warning)] xl:px-4">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{totalAlerts} en solde bas{uvAlerts ? ` │ ${uvAlerts} UV` : ''}{creditAlerts ? ` │ ${creditAlerts} crédit` : ''}</span>
            </p>
          )}
        </section>
      </div>

      {services.length > 0 && (
        <section className="rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)]">
          <MTSectionHeading>Activité par service</MTSectionHeading>
          <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {services.map(service => {
              const stats = serviceStats.find(item => item.id === service.id);
              return (
                <li key={service.id} className="min-w-0 border-b border-[var(--w-separator-l)] px-3.5 py-2.5 xl:px-4">
                  <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                    <h4 className="text-sm font-semibold">{service.name}</h4>
                    <span className="text-xs text-[var(--w-text-muted)]">{stats?.opsCount ?? 0} op.</span>
                  </div>
                  <dl className="space-y-1 text-xs">
                    {[
                      ['Dépôts', stats?.deposits ?? 0],
                      ['Retraits', stats?.withdrawals ?? 0],
                      ['Solde UV', stats?.uvBalance ?? 0],
                    ].map(([label, value]) => <div key={label} className="flex justify-between gap-2">
                      <dt className="text-[var(--w-text-sec)]">{label}</dt>
                      <dd className="font-medium"><MTMoney value={Number(value)} /></dd>
                    </div>)}
                  </dl>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {pointStats.length > 0 && (
        <section className="rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)]">
          <MTSectionHeading>Points de service</MTSectionHeading>
          <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {pointStats.map(point => (
              <li key={point.id} className="min-w-0 border-b border-[var(--w-separator-l)]">
                <button type="button" aria-pressed={selectedPointId === point.id}
                  onClick={() => setSelectedPointId(selectedPointId === point.id ? null : point.id)}
                  className="w-full px-3.5 py-2.5 text-left hover:bg-[var(--w-hover)] aria-pressed:bg-[var(--w-active)] xl:px-4">
                  <span className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                    <span className="text-sm font-semibold">{point.name}</span>
                    <span className="text-xs text-[var(--w-text-muted)]">{point.opsCount} op. │ {point.servicesCount} service{point.servicesCount > 1 ? 's' : ''}</span>
                  </span>
                  <span className="block space-y-1 text-xs">
                    {[
                      ['Caisse', point.cash],
                      ['Solde UV', point.uv],
                      ['Dépôts', point.deposits],
                      ['Retraits', point.withdrawals],
                    ].map(([label, value]) => <span key={label} className="flex justify-between gap-2">
                      <span className="text-[var(--w-text-sec)]">{label}</span>
                      <MTMoney value={Number(value)} className="font-medium" />
                    </span>)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)]">
        <MTSectionHeading>Dernières opérations</MTSectionHeading>
        {filteredOps.length === 0 ? <MTEmpty>Aucune opération {selectedPointId ? 'pour ce point' : 'aujourd’hui'}</MTEmpty> : (
          <ul className="divide-y divide-[var(--w-separator-l)]">
            {filteredOps.slice(0, 20).map(op => {
              const time = new Date(op.operated_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
              const isWithdrawal = op.type === 'retrait';
              const Icon = op.type === 'depot' ? ArrowDownLeft : isWithdrawal ? ArrowUpRight : ArrowRightLeft;
              return (
                <li key={op.id} className="flex items-start gap-2.5 px-3.5 py-2.5 xl:px-4">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--w-text-sec)]" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{OP_TYPE_LABELS[op.type] || op.type}</p>
                    <p className="text-xs text-[var(--w-text-sec)]">{[getServiceName(op.service_id), getPointName(op.service_point_id), time].filter(Boolean).join(' │ ')}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <MTMoney value={isWithdrawal ? -Number(op.amount) : Number(op.amount)} className="text-xs font-semibold sm:text-sm" />
                    <p className="text-xs text-[var(--w-text-sec)]">{STATUS_LABELS[op.status] || op.status}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
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
    <div className="lg:max-w-[1100px] mx-auto min-w-0 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-bold text-[var(--w-text)]">Initialisation des soldes</h2>
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
        <div className="rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)] p-4">
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
        <div className="rounded-md border border-[var(--w-separator)] bg-[var(--w-surface-el)] p-4">
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
        <MTEmpty>Aucun point de service configuré │ Créez d'abord vos points de service et associez-leur des services</MTEmpty>
      ) : displayPoints.length === 0 && isValidated ? (
        <div className="rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)] py-12 text-center">
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
              <div key={pt.id} className="rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)] overflow-hidden">
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
                      <label className="flex items-center gap-2 text-xs font-medium text-[var(--w-text-sec)] tracking-wide">
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
                        <label className="flex items-center gap-2 text-xs font-medium text-[var(--w-text-sec)] tracking-wide">
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
        <div className="rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)] p-5">
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

      <Modal open={showConfirm} onClose={() => { if (!validating) setShowConfirm(false); }}
        title={isValidated ? 'Confirmer l’initialisation' : 'Confirmer la validation'} size="sm" layer="top"
        panelClassName="!h-auto" focusOnOpen
        footer={<MTFormActions cancel={() => setShowConfirm(false)} submit={validate} label="Confirmer" busy={validating} />}>
        <p className="mb-3 text-sm text-[var(--w-text-sec)]">Soldes d’ouverture à créer</p>
        <dl className="divide-y divide-[var(--w-separator-l)] text-sm">
          <div className="flex justify-between gap-2 py-2"><dt>Caisse</dt><dd className="font-semibold"><MTMoney value={totalCash} /></dd></div>
          <div className="flex justify-between gap-2 py-2"><dt>Unités de valeur</dt><dd className="font-semibold"><MTMoney value={totalUV} /></dd></div>
          <div className="flex justify-between gap-2 py-2"><dt>Total des actifs</dt><dd className="font-semibold"><MTMoney value={totalCash + totalUV} /></dd></div>
          <div className="flex justify-between gap-2 py-2"><dt>Points concernés</dt><dd className="font-semibold">{displayPoints.length}</dd></div>
        </dl>
        <p className="mt-2 border-t border-[var(--w-separator)] pt-2 text-xs text-[var(--w-text-sec)]">L’initialisation ouvre l’accès aux opérations de ces points.</p>
      </Modal>
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
  useRealtimeRefresh(['mt_service_points', 'mt_service_point_services', 'mt_services', 'mt_accounts'], load);

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
    <div className="lg:max-w-[1000px] mx-auto min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-[var(--w-text)]">Points de service</h2>
        <button onClick={() => { setShowForm(true); setEditId(null); setForm({ name: '', code: '', address: '', manager_name: '', phone: '', description: '', serviceIds: [] }); }}
          className="btn-primary min-h-9 px-3 py-1.5 text-xs">
          <Plus className="w-4 h-4" />Ajouter
        </button>
      </div>

      <Modal open={showForm} onClose={() => { if (!(saving)) { setShowForm(false); setEditId(null); } }}
        title={editId ? 'Modifier le point de service' : 'Nouveau point de service'} size="md" layer="top" panelClassName="!h-auto" focusOnOpen
        footer={<MTFormActions cancel={() => { setShowForm(false); setEditId(null); }} submit={save}
          label={editId ? 'Mettre à jour' : 'Créer'} busy={saving} disabled={!form.name.trim()} />}>
        <div className="space-y-3">
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
              <p className="text-xs font-medium text-[var(--w-text-sec)] tracking-wide mb-2">Services effectués par ce point</p>
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
        </div>
      </Modal>

      {points.length === 0 ? (
        <MTEmpty>Aucun point de service configuré │ Créez votre premier point de service pour commencer</MTEmpty>
      ) : (
        <div className="rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)] overflow-hidden divide-y divide-neutral-100">
          {points.map(p => (
            <div key={p.id} className="px-4 py-3 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${p.status === 'active' ? 'bg-emerald-50' : 'bg-neutral-100'}`}>
                <MapPin className={`w-4 h-4 ${p.status === 'active' ? 'text-emerald-600' : 'text-neutral-400'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-neutral-900">{p.name}</p>
                <p className="text-xs text-neutral-400">{p.code ? `${p.code} │ ` : ''}{p.address || 'Aucune adresse'}</p>
                {(pointServices[p.id] || []).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(pointServices[p.id] || []).map(sid => {
                      const svc = services.find(s => s.id === sid);
                      return svc ? <span key={sid} className="text-[10px] px-1.5 py-0.5 rounded w-badge-muted">{svc.name}</span> : null;
                    })}
                  </div>
                )}
              </div>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${p.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-500'}`}>{p.status === 'active' ? 'Actif' : 'Inactif'}</span>
              <button onClick={() => edit(p)} className="btn-icon shrink-0"><Edit2 className="w-3.5 h-3.5 text-neutral-400" /></button>
              <button onClick={() => toggleStatus(p)} className="btn-icon shrink-0">{p.status === 'active' ? <XCircle className="w-3.5 h-3.5 text-neutral-400" /> : <CheckCircle2 className="w-3.5 h-3.5 text-neutral-400" />}</button>
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
  useRealtimeRefresh(['mt_services', 'mt_commission_tiers', 'mt_accounts'], load);

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
    toast.success('Logo supprimé');
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
    <div className="lg:max-w-[1000px] mx-auto min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-[var(--w-text)]">Services de transfert</h2>
        <button onClick={() => { setShowForm(true); setEditId(null); setLogoFile(null); setLogoPreview(''); setForm({ name: '', type: 'national', family: 'transfert', currency: 'XOF', alert_min_balance: '0', description: '' }); }}
          className="btn-primary min-h-9 px-3 py-1.5 text-xs">
          <Plus className="w-4 h-4" />Ajouter
        </button>
      </div>

      <Modal open={showForm} onClose={() => { if (!(saving || uploadingLogo)) { setShowForm(false); setEditId(null); } }}
        title={editId ? 'Modifier le service' : 'Nouveau service'} size="md" layer="top" panelClassName="!h-auto" focusOnOpen
        footer={<MTFormActions cancel={() => { setShowForm(false); setEditId(null); }} submit={save}
          label={editId ? 'Mettre à jour' : 'Créer'} busy={saving || uploadingLogo} disabled={!form.name.trim()} />}>
        <div className="space-y-3">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2.5 border-b border-[var(--w-separator-l)] pb-2.5">
              {logoPreview && <img src={logoPreview} alt="Logo du service" className="h-9 w-9 object-contain" />}
              <label className="btn-secondary cursor-pointer px-2.5 py-1.5 text-xs focus-within:outline focus-within:outline-2 focus-within:outline-offset-2">
                {logoPreview ? 'Changer le logo' : 'Importer un logo'}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={handleLogoSelect} className="sr-only" />
              </label>
              <span className="text-xs text-[var(--w-text-muted)]">2 Mo max.</span>
              {logoPreview && <button type="button" onClick={() => { setLogoFile(null); setLogoPreview(''); }}
                className="btn-icon" aria-label="Retirer le logo" title="Retirer le logo"><X className="h-4 w-4" /></button>}
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

        </div>
      </Modal>

      {services.length === 0 ? (
        <MTEmpty>Aucun service configuré │ Ajoutez Orange Money, Wave, Ria, etc.</MTEmpty>
      ) : (
        <div className="rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)] overflow-hidden divide-y divide-neutral-100">
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
                <p className="text-xs text-neutral-400">{s.family === 'credit_telephone' ? 'Crédit téléphonique' : 'Transfert'} │ {s.type === 'national' ? 'National' : s.type === 'international' ? 'International' : 'Mixte'} │ {s.currency}{Number(s.alert_min_balance) > 0 ? ` │ Alerte si < ${fmt(s.alert_min_balance)}` : ''}</p>
              </div>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${s.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-500'}`}>{s.status === 'active' ? 'Actif' : 'Inactif'}</span>
              {s.logo_url && (
                <button onClick={() => removeLogo(s)} className="p-1.5 rounded-lg hover:bg-red-50 text-neutral-300 hover:text-red-500 transition-colors" title="Supprimer le logo">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              <button onClick={() => edit(s)} className="btn-icon shrink-0"><Edit2 className="w-3.5 h-3.5 text-neutral-400" /></button>
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
  useRealtimeRefresh(['mt_operations', 'mt_accounts', 'mt_services', 'mt_service_points', 'mt_customers'], load);

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

  const transferServices = useMemo(() => availableServices.filter(s => s.family !== 'credit_telephone'), [availableServices]);
  const creditServices = useMemo(() => availableServices.filter(s => s.family === 'credit_telephone'), [availableServices]);

  const getServiceStock = (svcId: string): number => {
    const accs = selectedPoint ? accounts.filter(a => a.type === 'stock_credit' && a.service_id === svcId && a.service_point_id === selectedPoint) : accounts.filter(a => a.type === 'stock_credit' && a.service_id === svcId);
    return accs.reduce((s, a) => s + Number(a.balance), 0);
  };

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-5 h-5 animate-spin text-neutral-400" /></div>;

  const selectedPointName = points.find(point => point.id === selectedPoint)?.name;
  const closeOperation = () => {
    if (saving) return;
    setOpModal(null);
    setForm({ amount: '', note: '', reference: '' });
  };

  return (
    <div className="mx-auto max-w-[1050px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold">Opérations clients</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setHistoryOpen(true)} className="btn-secondary px-2.5 py-1.5 text-xs">
            <Clock className="h-4 w-4" aria-hidden="true" /> Historique
          </button>
          <button type="button" onClick={load} className="btn-icon" title="Actualiser" aria-label="Actualiser les opérations">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <MapPin className="h-4 w-4 shrink-0 text-[var(--w-text-sec)]" aria-hidden="true" />
        {points.length > 1 ? (
          <SearchableSelect ariaLabel="Point de service" value={selectedPoint} onChange={setSelectedPoint}
            className="min-w-0 flex-1 sm:max-w-72" clearable={false} searchable={points.length > 8} wrapLabels
            options={[{ value: '', label: 'Sélectionner un point' }, ...points.map(point => ({ value: point.id, label: point.name }))]} />
        ) : <span className="text-sm font-medium">{selectedPointName}</span>}
      </div>

      {!selectedPoint ? <MTEmpty>{points.length ? 'Sélectionnez un point de service' : 'Aucun point de service disponible'}</MTEmpty> : (
        <>
          <section className="divide-y divide-[var(--w-separator-l)] rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)] px-3.5 xl:px-4">
            <div className="py-3">
              <p className="text-xs text-[var(--w-text-sec)]">Disponible en caisse</p>
              <MTMoney value={ptCash} className="text-[clamp(1.05rem,6vw,1.875rem)] font-bold" />
            </div>
            <dl className="flex flex-wrap gap-x-6 gap-y-2 py-2.5">
              <div><dt className="text-xs text-[var(--w-text-sec)]">Entrées de caisse</dt><dd className="text-sm font-semibold"><MTMoney value={todayDeposits} /></dd></div>
              <div><dt className="text-xs text-[var(--w-text-sec)]">Sorties de caisse</dt><dd className="text-sm font-semibold"><MTMoney value={todayWithdrawals} /></dd></div>
              <div><dt className="text-xs text-[var(--w-text-sec)]">Opérations</dt><dd className="num text-sm font-semibold">{todayOps.length}</dd></div>
            </dl>
          </section>

          {[
            { label: 'Services de transfert', items: transferServices, credit: false },
            { label: 'Crédit téléphonique', items: creditServices, credit: true },
          ].map(({ label, items, credit }) => items.length > 0 && (
            <section key={label} className="rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)]">
              <MTSectionHeading>{label}</MTSectionHeading>
              <ul className="grid sm:grid-cols-2 xl:grid-cols-3">
                {items.map(service => {
                  const balance = credit ? getServiceStock(service.id) : getServiceUV(service.id);
                  const lowBalance = service.alert_min_balance > 0 && balance < service.alert_min_balance;
                  return <li key={service.id} className="min-w-0 border-b border-[var(--w-separator-l)]">
                    <button type="button"
                      onClick={() => credit ? setOpModal({ type: 'vente_credit', service }) : setActionModal(service)}
                      className="flex min-h-12 w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-[var(--w-hover)] xl:px-4">
                      {service.logo_url ? <img src={service.logo_url} alt="" className="h-6 w-6 shrink-0 object-contain" /> : <Smartphone className="h-4 w-4 shrink-0 text-[var(--w-text-sec)]" aria-hidden="true" />}
                      <span className="min-w-0 flex-1 text-sm font-medium">{service.name}</span>
                      <span className="shrink-0 text-right">
                        <MTMoney value={balance} className={`text-xs font-semibold ${lowBalance ? 'text-[var(--w-error)]' : ''}`} />
                        {lowBalance && <span className="block text-xs text-[var(--w-error)]">Solde bas</span>}
                      </span>
                    </button>
                  </li>;
                })}
              </ul>
            </section>
          ))}
          {transferServices.length === 0 && creditServices.length === 0 && <MTEmpty>Aucun service configuré pour ce point</MTEmpty>}
        </>
      )}

      {actionModal && (
        <Modal open onClose={() => setActionModal(null)} title={actionModal.name} size="sm" layer="top" panelClassName="!h-auto" focusOnOpen>
          <div className="flex flex-wrap gap-2">
            {can('mt_client_deposit_create') && (
              <button type="button" onClick={() => { setOpModal({ type: 'depot', service: actionModal }); setActionModal(null); }} className="btn-primary min-h-10 flex-1 text-xs">
                <ArrowDownLeft className="h-4 w-4" aria-hidden="true" /> Dépôt du jour
              </button>
            )}
            {can('mt_client_withdrawal_create') && (
              <button type="button" onClick={() => { setOpModal({ type: 'retrait', service: actionModal }); setActionModal(null); }} className="btn-secondary min-h-10 flex-1 text-xs">
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" /> Retrait du jour
              </button>
            )}
            {!can('mt_client_deposit_create') && !can('mt_client_withdrawal_create') && (
              <MTEmpty>Aucune opération autorisée pour ce service.</MTEmpty>
            )}
          </div>
        </Modal>
      )}

      {opModal && (
        <Modal open onClose={closeOperation} title={OP_TYPE_LABELS[opModal.type]} size="sm" layer="top" panelClassName="!h-auto" focusOnOpen
          footer={<MTFormActions cancel={closeOperation} submit={createOp} label="Valider" busy={saving} disabled={!form.amount} />}>
          <p className="mb-3 text-sm text-[var(--w-text-sec)]">{opModal.service.name} │ {selectedPointName}</p>
          <div className="space-y-3">
            <label className="label">Montant total (FCFA)
              <input value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })} type="number" inputMode="decimal" placeholder="0"
                className="input num mt-1 text-lg font-semibold" />
            </label>
            <label className="label">Référence opérateur
              <input value={form.reference} onChange={event => setForm({ ...form, reference: event.target.value })} placeholder="Facultatif" className="input mt-1 text-sm" />
            </label>
            <label className="label">Note
              <input value={form.note} onChange={event => setForm({ ...form, note: event.target.value })} placeholder="Facultatif" className="input mt-1 text-sm" />
            </label>
          </div>
          <p className="mt-3 border-t border-[var(--w-separator)] pt-2 text-xs text-[var(--w-text-sec)]">
            Libellé automatique │ {opModal.type === 'depot' ? `Total dépôt ${opModal.service.name} du jour` : opModal.type === 'retrait' ? `Total retrait ${opModal.service.name} du jour` : `Vente crédit ${opModal.service.name} du jour`}
          </p>
        </Modal>
      )}

      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title="Historique des opérations" size="lg" layer="top" fullscreenMobile focusOnOpen>
        <div className="space-y-3">
          <p className="text-xs text-[var(--w-text-sec)]">{selectedPointName || 'Tous les points'} │ {historyOps.length} opération{historyOps.length > 1 ? 's' : ''}</p>
          <div className="grid items-end gap-2 sm:grid-cols-2">
            <PageSearch value={filter.search} onChange={search => setFilter({ ...filter, search })} placeholder="Rechercher une référence ou une note…" />
            <SearchableSelect ariaLabel="Type d’opération" value={filter.type} onChange={type => setFilter(previous => ({ ...previous, type }))}
              className="min-w-0" searchable={false} clearable={false} wrapLabels
              options={[{ value: '', label: 'Tous les types' }, ...Object.entries(OP_TYPE_LABELS).map(([value, label]) => ({ value, label }))]} />
          </div>
          {historyOps.length === 0 ? <MTEmpty>Aucune opération</MTEmpty> : (
            <ul className="divide-y divide-[var(--w-separator-l)] border-y border-[var(--w-separator)]">
              {historyOps.map(op => {
                const service = services.find(item => item.id === op.service_id);
                const point = points.find(item => item.id === op.service_point_id);
                const when = new Date(op.operated_at).toLocaleString('fr-FR');
                const canCancel = op.status === 'validee' && (can('mt_client_operation_cancel_any') || (can('mt_client_operation_cancel_own') && op.operated_by === profile?.id));
                return (
                  <li key={op.id} className="flex items-start gap-2 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{OP_TYPE_LABELS[op.type] || op.type}</p>
                      <p className="text-xs text-[var(--w-text-sec)]">{[service?.name, point?.name, when].filter(Boolean).join(' │ ')}</p>
                      {(op.comment || op.reference) && <p className="break-words text-xs text-[var(--w-text-muted)]">{op.comment || op.reference}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      <MTMoney value={op.type === 'retrait' ? -Number(op.amount) : Number(op.amount)} className="text-xs font-semibold sm:text-sm" />
                      <p className="text-xs text-[var(--w-text-sec)]">{STATUS_LABELS[op.status] || op.status}</p>
                    </div>
                    {canCancel && (
                      <button type="button" onClick={() => cancelOp(op)} className="btn-icon-danger shrink-0" title="Annuler l’opération" aria-label="Annuler l’opération">
                        <XCircle className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Modal>
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
    if (!svcId && type === 'cash') {
      let q2 = supabase.from('mt_accounts').select('*').eq('tenant_id', tenantId).eq('type', type);
      if (spId) q2 = q2.eq('service_point_id', spId);
      const { data: fallback } = await q2.limit(1).maybeSingle();
      if (fallback) {
        await supabase.from('mt_accounts').update({ balance: Number(fallback.balance) + delta, updated_at: new Date().toISOString() }).eq('id', fallback.id);
        return;
      }
    }
    const label = type === 'cash' ? 'Caisse' : type === 'uv' ? 'UV' : type === 'stock_credit' ? 'Stock crédit' : 'Écarts';
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
  useRealtimeRefresh(['mt_wholesalers', 'mt_wholesaler_services', 'mt_services'], load);

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
    <div className="lg:max-w-[1000px] mx-auto min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-[var(--w-text)]">Grossistes</h2>
          <p className="text-xs text-neutral-500 mt-0.5">Gérez vos grossistes pour les recharges et déchargements de solde électronique.</p>
        </div>
        {can('mt_wholesaler_manage') && (
          <button onClick={() => { setShowForm(true); setEditId(null); setForm({ name: '', phone: '', address: '', zone: '', notes: '', serviceIds: [] }); }}
            className="btn-primary min-h-9 px-3 py-1.5 text-xs">
            <Plus className="w-4 h-4" />Ajouter
          </button>
        )}
      </div>

      <Modal open={showForm && can('mt_wholesaler_manage')} onClose={() => { if (!(saving)) { setShowForm(false); setEditId(null); } }}
        title={editId ? 'Modifier le grossiste' : 'Nouveau grossiste'} size="md" layer="top" panelClassName="!h-auto" focusOnOpen
        footer={<MTFormActions cancel={() => { setShowForm(false); setEditId(null); }} submit={save}
          label={editId ? 'Mettre à jour' : 'Créer'} busy={saving} disabled={!form.name.trim()} />}>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Nom du grossiste *" className="input" />
            <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Téléphone" className="input" />
            <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Adresse" className="input" />
            <input value={form.zone} onChange={e => setForm({ ...form, zone: e.target.value })} placeholder="Zone / Quartier" className="input" />
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Notes" className="input sm:col-span-2" rows={2} />
          </div>
          <div>
            <p className="text-xs font-medium text-[var(--w-text-sec)] tracking-wide mb-2">Services associés</p>
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
        </div>
      </Modal>

      {wholesalers.length === 0 ? (
        <MTEmpty>Aucun grossiste configuré │ Ajoutez vos grossistes pour les opérations de recharge et déchargement</MTEmpty>
      ) : (
        <div className="rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)] overflow-hidden divide-y divide-neutral-100">
          {wholesalers.map(w => (
            <div key={w.id} className="px-4 py-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center">
                <User className="w-5 h-5 text-neutral-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-neutral-900">{w.name}</p>
                <p className="text-xs text-neutral-400">{w.phone || '—'} │ {w.zone || w.address || '—'}</p>
                {w.services?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {w.services.map((sid: string) => (
                      <span key={sid} className="text-[10px] px-1.5 py-0.5 rounded w-badge-muted">{getServiceName(sid)}</span>
                    ))}
                  </div>
                )}
              </div>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${w.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-500'}`}>
                {w.status === 'active' ? 'Actif' : 'Inactif'}
              </span>
              {can('mt_wholesaler_manage') && (
                <>
                  <button onClick={() => toggleStatus(w)} className="btn-icon shrink-0" title={w.status === 'active' ? 'Désactiver' : 'Activer'}>
                    {w.status === 'active' ? <XCircle className="w-3.5 h-3.5 text-neutral-400" /> : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                  </button>
                  <button onClick={() => edit(w)} className="btn-icon shrink-0"><Edit2 className="w-3.5 h-3.5 text-neutral-400" /></button>
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
type WhOpType = 'recharge_grossiste' | 'dechargement_grossiste' | 'reappro_credit' | 'transfert_interne';
type TransferKind = 'cash' | 'uv' | 'stock_credit';

const WH_OP_META: Record<WhOpType, { label: string; short: string; verb: string; hint: string }> = {
  recharge_grossiste: { label: 'Recharge UV', short: 'Recharge UV', verb: 'la recharge', hint: 'Vous donnez du cash au grossiste et recevez du solde électronique (UV).' },
  dechargement_grossiste: { label: 'Déchargement UV', short: 'Déchargement UV', verb: 'le déchargement', hint: 'Vous renvoyez du solde électronique au grossiste et recevez du cash.' },
  reappro_credit: { label: 'Réappro. crédit', short: 'Réappro. crédit', verb: 'le réapprovisionnement', hint: 'Vous achetez du stock de crédit téléphonique (cash vers stock crédit).' },
  transfert_interne: { label: 'Transfert interne', short: 'Transfert interne', verb: 'le transfert interne', hint: 'Vous déplacez du cash, de l\'UV ou du stock crédit entre deux points de service.' },
};

function balanceLabel(kind: 'cash' | 'uv' | 'stock_credit', svcName?: string) {
  if (kind === 'cash') return 'Cash disponible';
  if (kind === 'uv') return `UV ${svcName || ''}`.trim();
  return `Stock crédit ${svcName || ''}`.trim();
}

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
  const [opType, setOpType] = useState<WhOpType>('recharge_grossiste');
  const [transferKind, setTransferKind] = useState<TransferKind>('cash');
  const [form, setForm] = useState({ wholesaler_id: '', service_id: '', service_point_id: '', dest_service_point_id: '', amount: '', comment: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!tenant) return;
    const [{ data: o }, { data: w }, { data: s }, { data: p }, { data: a }] = await Promise.all([
      supabase.from('mt_operations').select('*').eq('tenant_id', tenant.id).in('type', ['recharge_grossiste', 'dechargement_grossiste', 'reappro_credit', 'transfert_interne']).order('operated_at', { ascending: false }).limit(150),
      supabase.from('mt_wholesalers').select('*').eq('tenant_id', tenant.id).eq('status', 'active').order('name'),
      supabase.from('mt_services').select('*').eq('tenant_id', tenant.id).eq('status', 'active').order('name'),
      supabase.from('mt_service_points').select('*').eq('tenant_id', tenant.id).eq('status', 'active').order('name'),
      supabase.from('mt_accounts').select('*').eq('tenant_id', tenant.id),
    ]);
    setOps(o || []);
    setWholesalers(w || []);
    setServices((s || []).filter((x: any) => (x.name || '').trim() !== ''));
    setPoints(p || []);
    setAccounts(a || []);
    if (p && p.length === 1) setForm(f => ({ ...f, service_point_id: f.service_point_id || p[0].id }));
    setLoading(false);
  }, [tenant]);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(['mt_operations', 'mt_wholesalers', 'mt_accounts', 'mt_service_points', 'mt_services'], load);

  const getBal = useCallback((spId: string | null, svcId: string | null, type: string): number => {
    return accounts
      .filter(a => a.type === type
        && (spId ? a.service_point_id === spId : true)
        && (svcId ? a.service_id === svcId : (type === 'cash' ? true : a.service_id === null)))
      .reduce((s, a) => s + Number(a.balance || 0), 0);
  }, [accounts]);

  const resetForm = () => {
    setForm({ wholesaler_id: '', service_id: '', service_point_id: points.length === 1 ? points[0].id : '', dest_service_point_id: '', amount: '', comment: '' });
  };

  const isTransfer = opType === 'transfert_interne';
  const needsService = !isTransfer || transferKind === 'uv' || transferKind === 'stock_credit';
  const filteredServices = services.filter(s => {
    if (opType === 'reappro_credit') return s.family === 'credit_telephone';
    if (isTransfer && transferKind === 'stock_credit') return s.family === 'credit_telephone';
    if (isTransfer && transferKind === 'uv') return s.family !== 'credit_telephone';
    return s.family !== 'credit_telephone';
  });

  const amount = Number(form.amount) || 0;
  const svc = form.service_id;
  const sp = form.service_point_id;
  const dp = form.dest_service_point_id;

  const preview = useMemo(() => {
    if (amount <= 0) return null;
    if (isTransfer) {
      if (!sp || !dp || sp === dp) return null;
      if (needsService && !svc) return null;
      const bal = transferKind;
      const svcId = bal === 'cash' ? null : svc;
      const srcBefore = getBal(sp, svcId, bal);
      const dstBefore = getBal(dp, svcId, bal);
      const svcName = services.find(s => s.id === svc)?.name || '';
      return {
        rows: [
          { label: `${balanceLabel(bal, svcName)} │ ${points.find(p => p.id === sp)?.name || ''}`, before: srcBefore, after: srcBefore - amount, delta: -amount, isSource: true },
          { label: `${balanceLabel(bal, svcName)} │ ${points.find(p => p.id === dp)?.name || ''}`, before: dstBefore, after: dstBefore + amount, delta: amount, isSource: false },
        ],
        insufficient: srcBefore < amount ? balanceLabel(bal, svcName) : null,
      };
    }
    if (!sp || !svc) return null;
    const targetType: 'uv' | 'stock_credit' = opType === 'reappro_credit' ? 'stock_credit' : 'uv';
    const svcName = services.find(s => s.id === svc)?.name || '';
    const sourceBefore = getBal(sp, null, 'cash');
    const targetBefore = getBal(sp, svc, targetType);
    if (opType === 'dechargement_grossiste') {
      return {
        rows: [
          { label: `${balanceLabel('uv', svcName)} │ ${points.find(p => p.id === sp)?.name || ''}`, before: targetBefore, after: targetBefore - amount, delta: -amount, isSource: true },
          { label: `${balanceLabel('cash')} │ ${points.find(p => p.id === sp)?.name || ''}`, before: sourceBefore, after: sourceBefore + amount, delta: amount, isSource: false },
        ],
        insufficient: targetBefore < amount ? balanceLabel('uv', svcName) : null,
      };
    }
    return {
      rows: [
        { label: `${balanceLabel('cash')} │ ${points.find(p => p.id === sp)?.name || ''}`, before: sourceBefore, after: sourceBefore - amount, delta: -amount, isSource: true },
        { label: `${balanceLabel(targetType, svcName)} │ ${points.find(p => p.id === sp)?.name || ''}`, before: targetBefore, after: targetBefore + amount, delta: amount, isSource: false },
      ],
      insufficient: sourceBefore < amount ? balanceLabel('cash') : null,
    };
  }, [amount, isTransfer, sp, dp, svc, needsService, transferKind, opType, getBal, points, services]);

  const validationError = useMemo(() => {
    if (amount <= 0) return 'Veuillez saisir un montant supérieur à zéro.';
    if (isTransfer) {
      if (!sp) return 'Veuillez sélectionner le point source.';
      if (!dp) return 'Veuillez sélectionner le point destination.';
      if (sp === dp) return 'Le point source et le point destination doivent être différents.';
      if (needsService && !svc) return 'Veuillez sélectionner un service.';
    } else {
      if (!form.wholesaler_id) return 'Veuillez sélectionner un grossiste.';
      if (!svc) return 'Veuillez sélectionner un service.';
      if (!sp) return 'Veuillez sélectionner un point de service.';
    }
    if (preview?.insufficient) {
      if (preview.insufficient.startsWith('Cash')) return 'Cash insuffisant pour cette opération.';
      if (preview.insufficient.startsWith('UV')) return 'Solde UV insuffisant pour cette opération.';
      if (preview.insufficient.startsWith('Stock')) return 'Stock crédit insuffisant pour cette opération.';
    }
    return null;
  }, [amount, isTransfer, sp, dp, svc, needsService, form.wholesaler_id, preview]);

  const applyDeltas = async (op: WhOpType, kind: TransferKind, srcSp: string, dstSp: string | null, svcId: string | null, amt: number) => {
    if (op === 'recharge_grossiste') {
      await updateBalance(tenant!.id, srcSp, null, 'cash', -amt);
      await updateBalance(tenant!.id, srcSp, svcId, 'uv', amt);
    } else if (op === 'dechargement_grossiste') {
      await updateBalance(tenant!.id, srcSp, svcId, 'uv', -amt);
      await updateBalance(tenant!.id, srcSp, null, 'cash', amt);
    } else if (op === 'reappro_credit') {
      await updateBalance(tenant!.id, srcSp, null, 'cash', -amt);
      await updateBalance(tenant!.id, srcSp, svcId, 'stock_credit', amt);
    } else if (op === 'transfert_interne' && dstSp) {
      const svcForDelta = kind === 'cash' ? null : svcId;
      await updateBalance(tenant!.id, srcSp, svcForDelta, kind, -amt);
      await updateBalance(tenant!.id, dstSp, svcForDelta, kind, amt);
    }
  };

  const createOp = async () => {
    if (!tenant || validationError) { if (validationError) toast.error(validationError); return; }
    setSaving(true);
    const cashBefore = getBal(sp, null, 'cash');
    const uvBefore = svc ? getBal(sp, svc, 'uv') : 0;
    const creditBefore = svc ? getBal(sp, svc, 'stock_credit') : 0;
    const kindMeta = isTransfer ? transferKind : null;

    const commentPrefix = isTransfer ? `[transfert_${transferKind}] ` : '';
    const payload: any = {
      tenant_id: tenant.id,
      service_point_id: sp,
      dest_service_point_id: isTransfer ? dp : null,
      service_id: isTransfer && transferKind === 'cash' ? null : (svc || null),
      wholesaler_id: !isTransfer ? (form.wholesaler_id || null) : null,
      type: opType,
      amount,
      commission: 0,
      status: 'validee',
      comment: (commentPrefix + (form.comment || '')).trim() || null,
      operated_by: profile?.id || null,
      validated_by: profile?.id || null,
      balance_before_cash: cashBefore,
      balance_after_cash: opType === 'dechargement_grossiste' ? cashBefore + amount : opType === 'recharge_grossiste' || opType === 'reappro_credit' ? cashBefore - amount : cashBefore,
      balance_before_uv: opType === 'reappro_credit' ? creditBefore : uvBefore,
      balance_after_uv: opType === 'recharge_grossiste' ? uvBefore + amount : opType === 'dechargement_grossiste' ? uvBefore - amount : opType === 'reappro_credit' ? creditBefore + amount : uvBefore,
    };

    const { error } = await supabase.from('mt_operations').insert(payload);
    if (error) { toast.error('Erreur : ' + error.message); setSaving(false); return; }

    await applyDeltas(opType, kindMeta || 'cash', sp, isTransfer ? dp : null, isTransfer && transferKind === 'cash' ? null : (svc || null), amount);
    toast.success('Opération enregistrée');
    setSaving(false);
    setShowForm(false);
    resetForm();
    load();
  };

  const cancelOp = async (op: any) => {
    if (op.status !== 'validee') return;
    await supabase.from('mt_operations').update({ status: 'annulee', cancelled_by: profile?.id, cancelled_at: new Date().toISOString() }).eq('id', op.id);
    const amt = Number(op.amount);
    const svcId = op.service_id;
    const srcSp = op.service_point_id;
    const dstSp = op.dest_service_point_id;
    const cmt: string = op.comment || '';
    const tk: TransferKind = cmt.includes('[transfert_uv]') ? 'uv' : cmt.includes('[transfert_stock_credit]') ? 'stock_credit' : 'cash';
    if (op.type === 'transfert_interne' && dstSp) {
      const svcForDelta = tk === 'cash' ? null : svcId;
      await updateBalance(tenant!.id, srcSp, svcForDelta, tk, amt);
      await updateBalance(tenant!.id, dstSp, svcForDelta, tk, -amt);
    } else if (op.type === 'recharge_grossiste') {
      await updateBalance(tenant!.id, srcSp, null, 'cash', amt);
      await updateBalance(tenant!.id, srcSp, svcId, 'uv', -amt);
    } else if (op.type === 'dechargement_grossiste') {
      await updateBalance(tenant!.id, srcSp, svcId, 'uv', amt);
      await updateBalance(tenant!.id, srcSp, null, 'cash', -amt);
    } else if (op.type === 'reappro_credit') {
      await updateBalance(tenant!.id, srcSp, null, 'cash', amt);
      await updateBalance(tenant!.id, srcSp, svcId, 'stock_credit', -amt);
    }
    toast.success('Opération annulée');
    load();
  };

  const getWholesalerName = (id: string | null) => wholesalers.find(w => w.id === id)?.name || '—';
  const getServiceName = (id: string | null) => services.find(s => s.id === id)?.name || '—';
  const getPointName = (id: string | null) => points.find(p => p.id === id)?.name || '—';

  const decodeOp = (op: any) => {
    const cmt: string = op.comment || '';
    const tk: TransferKind = cmt.includes('[transfert_uv]') ? 'uv' : cmt.includes('[transfert_stock_credit]') ? 'stock_credit' : 'cash';
    return { tk };
  };

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-5 h-5 animate-spin text-neutral-400" /></div>;

  const canValidate = !saving && !validationError;

  return (
    <div className="lg:max-w-[1200px] mx-auto min-w-0 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-bold text-[var(--w-text)]">Opérations grossiste</h2>
          <p className="text-xs text-neutral-500 mt-0.5">Alimentation et transferts internes des soldes cash, UV et stock crédit.</p>
        </div>
        {can('mt_wholesaler_operation_create') && !showForm && (
          <button onClick={() => setShowForm(true)}
            className="btn-primary min-h-9 px-3 py-1.5 text-xs">
            <Plus className="w-4 h-4" />Nouvelle opération
          </button>
        )}
      </div>

      {showForm && can('mt_wholesaler_operation_create') && (
        <div className="rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)] p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-neutral-900">Nouvelle opération</h3>
            <button onClick={() => { setShowForm(false); resetForm(); }} className="p-1 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-neutral-700"><X className="w-4 h-4" /></button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(['recharge_grossiste', 'dechargement_grossiste', 'reappro_credit', 'transfert_interne'] as WhOpType[]).map(t => (
              <button key={t} onClick={() => { setOpType(t); setForm(f => ({ ...f, service_id: '', dest_service_point_id: '' })); }}
                className={`px-3 py-2.5 text-xs sm:text-sm font-medium rounded-lg border transition-colors ${opType === t ? 'bg-neutral-900 border-neutral-900 text-white' : 'bg-white border-neutral-200 text-neutral-700 hover:border-neutral-300'}`}>
                {WH_OP_META[t].short}
              </button>
            ))}
          </div>
          <p className="text-xs text-neutral-500 -mt-1">{WH_OP_META[opType].hint}</p>

          {isTransfer && (
            <div>
              <label className="block text-xs font-medium text-[var(--w-text-sec)] mb-1.5">Type de transfert</label>
              <div className="flex gap-2 flex-wrap">
                {([{ k: 'cash', l: 'Cash' }, { k: 'uv', l: 'UV' }, { k: 'stock_credit', l: 'Stock crédit' }] as { k: TransferKind; l: string }[]).map(({ k, l }) => (
                  <button key={k} onClick={() => { setTransferKind(k); setForm(f => ({ ...f, service_id: '' })); }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${transferKind === k ? 'bg-neutral-900 border-neutral-900 text-white' : 'bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {!isTransfer && (
              <div>
                <label className="block text-xs font-medium text-[var(--w-text-sec)] mb-1">Grossiste *</label>
                <select value={form.wholesaler_id} onChange={e => setForm({ ...form, wholesaler_id: e.target.value })} className="input">
                  <option value="">Sélectionner...</option>
                  {wholesalers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
            )}
            {needsService && (
              <div>
                <label className="block text-xs font-medium text-[var(--w-text-sec)] mb-1">Service *</label>
                <select value={form.service_id} onChange={e => setForm({ ...form, service_id: e.target.value })} className="input">
                  <option value="">Sélectionner...</option>
                  {filteredServices.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-[var(--w-text-sec)] mb-1">{isTransfer ? 'Point source *' : 'Point de service *'}</label>
              <select value={form.service_point_id} onChange={e => setForm({ ...form, service_point_id: e.target.value })} className="input">
                <option value="">Sélectionner...</option>
                {points.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {isTransfer && (
              <div>
                <label className="block text-xs font-medium text-[var(--w-text-sec)] mb-1">Point destination *</label>
                <select value={form.dest_service_point_id} onChange={e => setForm({ ...form, dest_service_point_id: e.target.value })} className="input">
                  <option value="">Sélectionner...</option>
                  {points.filter(p => p.id !== form.service_point_id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}
            {!isTransfer && (
              <div>
                <label className="block text-xs font-medium text-[var(--w-text-sec)] mb-1">Source des fonds</label>
                <div className="px-3 py-2 text-xs font-medium rounded-lg border border-neutral-200 bg-neutral-50 text-neutral-700">
                  Cash
                </div>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-[var(--w-text-sec)] mb-1">Montant (FCFA) *</label>
              <input value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0" type="number" min="0" className="input text-base font-semibold" />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="block text-xs font-medium text-[var(--w-text-sec)] mb-1">Commentaire</label>
              <input value={form.comment} onChange={e => setForm({ ...form, comment: e.target.value })} placeholder="Optionnel" className="input" />
            </div>
          </div>

          {/* Cartes dynamiques */}
          {(sp && (isTransfer ? dp : svc)) ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {preview ? preview.rows.map((r, i) => (
                <div key={i} className={`rounded-xl border p-3.5 ${r.isSource ? 'border-neutral-200 bg-white' : 'border-neutral-200 bg-neutral-50/60'}`}>
                  <p className="text-xs font-medium text-[var(--w-text-sec)] truncate">{r.label}</p>
                  <div className="flex items-baseline gap-2 mt-1">
                    <p className="text-sm text-neutral-400 line-through">{fmt(r.before)}</p>
                    <p className="text-base font-bold text-neutral-900">{fmt(r.after)}</p>
                    <span className="text-[10px] text-neutral-400">FCFA</span>
                  </div>
                  <p className={`text-[11px] font-medium mt-0.5 ${r.delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{r.delta >= 0 ? '+' : ''}{fmt(r.delta)} FCFA</p>
                </div>
              )) : (
                <div className="col-span-full rounded-lg border border-dashed border-neutral-200 p-4 text-center">
                  <p className="text-xs text-neutral-500">Saisissez un montant pour voir les soldes avant et après opération.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-neutral-200 p-6 text-center">
              <Wallet className="w-8 h-8 text-neutral-300 mx-auto mb-2" />
              <p className="text-sm text-neutral-500">Sélectionnez {isTransfer ? 'les points source et destination' : 'un service et un point'} pour afficher les soldes disponibles.</p>
            </div>
          )}

          {validationError && amount > 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-100 px-3 py-2">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
              <p className="text-xs text-red-700">{validationError}</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t border-[var(--w-separator-l)] pt-2.5">
            <button onClick={() => { setShowForm(false); resetForm(); }} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
            <button onClick={createOp} disabled={!canValidate}
              className="btn-icon-primary" title={`Valider ${WH_OP_META[opType].verb}`}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}

      {/* Historique */}
      {ops.length === 0 ? (
        <MTEmpty>Aucune opération enregistrée │ Créez une nouvelle opération pour alimenter ou déplacer vos soldes.</MTEmpty>
      ) : (
        <div className="rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)] overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-neutral-900">Historique récent</h3>
            <span className="text-[11px] text-neutral-400">{ops.length} opération{ops.length > 1 ? 's' : ''}</span>
          </div>
          <div className="divide-y divide-neutral-100 max-h-[600px] overflow-y-auto">
            {ops.map(op => {
              const { tk } = decodeOp(op);
              const isTr = op.type === 'transfert_interne';
              const isIn = ['dechargement_grossiste'].includes(op.type);
              const badge = isTr ? `Transfert ${tk === 'cash' ? 'cash' : tk === 'uv' ? 'UV' : 'stock crédit'}` : (OP_TYPE_LABELS[op.type] || op.type);
              return (
                <div key={op.id} className="px-4 py-3 flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${isTr ? 'bg-neutral-100' : isIn ? 'bg-emerald-50' : 'bg-neutral-50'}`}>
                    {isTr ? <ArrowRightLeft className="w-4 h-4 text-neutral-600" /> : isIn ? <ArrowDownLeft className="w-4 h-4 text-emerald-600" /> : <ArrowUpRight className="w-4 h-4 text-neutral-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-neutral-900">{badge}</p>
                      {op.service_id && <span className="text-[10px] font-medium text-neutral-500 bg-neutral-100 px-1.5 py-0.5 rounded">{getServiceName(op.service_id)}</span>}
                    </div>
                    <p className="text-xs text-neutral-500 mt-0.5 break-words">
                      {isTr
                        ? `${getPointName(op.service_point_id)} → ${getPointName(op.dest_service_point_id)}`
                        : `${getWholesalerName(op.wholesaler_id)} │ ${getPointName(op.service_point_id)}`}
                    </p>
                    <p className="text-[11px] text-neutral-400 mt-0.5">{new Date(op.operated_at).toLocaleDateString('fr-FR')} {new Date(op.operated_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</p>
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
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================ */
/* SOLDES                                       */
/* ============================================ */
type AggAccount = {
  service_point_id: string | null;
  service_id: string | null;
  type: string;
  currency: string;
  balance: number;
  initialized: boolean;
};

function MTBalances() {
  const { tenant } = useApp();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [points, setPoints] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [ops, setOps] = useState<any[]>([]);
  const [, setPointServiceLinks] = useState<any[]>([]);
  const [initBalances, setInitBalances] = useState<any[]>([]);
  const [reconciliations, setReconciliations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPointId, setSelectedPointId] = useState<string>('');
  const [dateRange, setDateRange] = useState<string>('today');

  const realtimeTick = useRealtimeTick(['mt_accounts', 'mt_operations', 'mt_closures', 'mt_service_points', 'mt_services', 'mt_service_point_services', 'mt_init_balances', 'mt_reconciliations']);

  useEffect(() => {
    if (!tenant) return;
    (async () => {
      const now = new Date();
      let startDate: string;
      if (dateRange === 'today') startDate = now.toISOString().split('T')[0];
      else if (dateRange === 'week') { const d = new Date(now); d.setDate(d.getDate() - 7); startDate = d.toISOString().split('T')[0]; }
      else { const d = new Date(now); d.setMonth(d.getMonth() - 1); startDate = d.toISOString().split('T')[0]; }

      const [{ data: a }, { data: p }, { data: s }, { data: o }, { data: ps }, { data: cl }, { data: ib }, { data: rec }] = await Promise.all([
        supabase.from('mt_accounts').select('*').eq('tenant_id', tenant.id).order('type'),
        supabase.from('mt_service_points').select('*').eq('tenant_id', tenant.id).eq('status', 'active').order('name'),
        supabase.from('mt_services').select('*').eq('tenant_id', tenant.id).eq('status', 'active'),
        supabase.from('mt_operations').select('*').eq('tenant_id', tenant.id).gte('operated_at', startDate + 'T00:00:00').eq('status', 'validee').order('operated_at', { ascending: false }),
        supabase.from('mt_service_point_services').select('*').eq('tenant_id', tenant.id),
        supabase.from('mt_closures').select('closed_at').eq('tenant_id', tenant.id).eq('status', 'cloturee').order('closed_at', { ascending: false }).limit(1),
        supabase.from('mt_init_balances').select('service_point_id, service_id, account_type').eq('tenant_id', tenant.id),
        supabase.from('mt_reconciliations').select('*').eq('tenant_id', tenant.id).eq('status', 'pending').order('created_at', { ascending: false }).limit(50),
      ]);
      setAccounts(a || []);
      setPoints(p || []);
      setServices(s || []);
      const closureTime = cl && cl.length > 0 && dateRange === 'today' ? cl[0].closed_at : null;
      setOps(closureTime ? (o || []).filter(op => op.operated_at > closureTime) : (o || []));
      setPointServiceLinks(ps || []);
      setInitBalances(ib || []);
      setReconciliations(rec || []);
      if (p && p.length === 1 && !selectedPointId) setSelectedPointId(p[0].id);
      setLoading(false);
    })();
  }, [tenant, dateRange, realtimeTick]);

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-5 h-5 animate-spin text-neutral-400" /></div>;

  // ─── Normalization: valid services (with a name) only ────────────
  const validServiceIds = new Set(services.filter(s => (s.name || '').trim()).map(s => s.id));
  const svcById = new Map(services.map(s => [s.id, s]));
  const ptById = new Map(points.map(p => [p.id, p]));
  const validPointIds = new Set(points.map(p => p.id));

  // ─── Deduplicate accounts: group by (point, service, type, currency) ────
  const aggMap = new Map<string, AggAccount>();
  const initSet = new Set(initBalances.map(i => `${i.service_point_id || 'null'}|${i.service_id || 'null'}|${i.account_type}`));
  for (const a of accounts) {
    if (a.type !== 'cash' && a.type !== 'uv' && a.type !== 'stock_credit') continue;
    if (a.service_point_id && !validPointIds.has(a.service_point_id)) continue;
    if (a.service_id && !validServiceIds.has(a.service_id)) continue;
    if ((a.type === 'uv' || a.type === 'stock_credit') && !a.service_id) continue;
    const key = `${a.service_point_id || 'null'}|${a.service_id || 'null'}|${a.type}|${a.currency || 'XOF'}`;
    const initKey = `${a.service_point_id || 'null'}|${a.service_id || 'null'}|${a.type}`;
    const prev = aggMap.get(key);
    if (prev) {
      prev.balance += Number(a.balance) || 0;
    } else {
      aggMap.set(key, {
        service_point_id: a.service_point_id,
        service_id: a.service_id,
        type: a.type,
        currency: a.currency || 'XOF',
        balance: Number(a.balance) || 0,
        initialized: initSet.has(initKey),
      });
    }
  }
  const aggAccounts = Array.from(aggMap.values());

  const scopedAccounts = selectedPointId ? aggAccounts.filter(a => a.service_point_id === selectedPointId) : aggAccounts;
  const isOpeningOp = (o: any) => o.reference === 'INIT-OUVERTURE' || o.reference === 'OUVERTURE-JOUR';
  const scopedOps = (selectedPointId ? ops.filter(o => o.service_point_id === selectedPointId) : ops).filter(o => !isOpeningOp(o));

  const totals = {
    cash: scopedAccounts.filter(a => a.type === 'cash').reduce((s, a) => s + a.balance, 0),
    uv: scopedAccounts.filter(a => a.type === 'uv').reduce((s, a) => s + a.balance, 0),
    credit: scopedAccounts.filter(a => a.type === 'stock_credit').reduce((s, a) => s + a.balance, 0),
  };

  const hasAnyInit = scopedAccounts.some(a => a.initialized);
  const cashInitialized = scopedAccounts.some(a => a.type === 'cash' && a.initialized);
  const uvInitialized = scopedAccounts.some(a => a.type === 'uv' && a.initialized);
  const creditInitialized = scopedAccounts.some(a => a.type === 'stock_credit' && a.initialized);

  const commissionsToday = scopedOps.reduce((s, o) => s + (Number(o.commission_amount) || 0), 0);

  // ─── Low balance alerts (dedup, valid services only) ────
  const lowBalanceAlerts = scopedAccounts
    .filter(a => a.service_id)
    .map(a => ({ acc: a, svc: svcById.get(a.service_id!) }))
    .filter(x => x.svc && Number(x.svc.alert_min_balance) > 0 && x.acc.balance < Number(x.svc.alert_min_balance));

  const pendingEcarts = selectedPointId ? reconciliations.filter(r => r.service_point_id === selectedPointId) : reconciliations;

  // ─── Per-point aggregation (for Tous les points view) ────
  const pointCards = points.map(pt => {
    const pointAccs = aggAccounts.filter(a => a.service_point_id === pt.id);
    const cash = pointAccs.filter(a => a.type === 'cash').reduce((s, a) => s + a.balance, 0);
    const uv = pointAccs.filter(a => a.type === 'uv').reduce((s, a) => s + a.balance, 0);
    const credit = pointAccs.filter(a => a.type === 'stock_credit').reduce((s, a) => s + a.balance, 0);
    const opsCount = ops.filter(o => o.service_point_id === pt.id && !isOpeningOp(o)).length;
    const anyInit = pointAccs.some(a => a.initialized);
    const hasLow = pointAccs.some(a => {
      const svc = a.service_id ? svcById.get(a.service_id) : null;
      return svc && Number(svc.alert_min_balance) > 0 && a.balance < Number(svc.alert_min_balance);
    });
    const hasEcart = reconciliations.some(r => r.service_point_id === pt.id);
    const status: 'ok' | 'low' | 'ecart' | 'uninit' =
      !anyInit ? 'uninit' : hasEcart ? 'ecart' : hasLow ? 'low' : 'ok';
    return { pt, cash, uv, credit, opsCount, initialized: anyInit, status };
  });

  // ─── UV per service (grouped by service, breakdown per point) ────
  const buildServiceGroups = (family: 'transfert' | 'credit_telephone', type: 'uv' | 'stock_credit') => {
    const svcList = services.filter(s => s.family === family && (s.name || '').trim());
    return svcList.map(svc => {
      const scoped = selectedPointId
        ? aggAccounts.filter(a => a.service_id === svc.id && a.type === type && a.service_point_id === selectedPointId)
        : aggAccounts.filter(a => a.service_id === svc.id && a.type === type);
      const total = scoped.reduce((s, a) => s + a.balance, 0);
      const anyInit = scoped.some(a => a.initialized);
      const perPoint = scoped
        .map(a => ({ pt: a.service_point_id ? ptById.get(a.service_point_id) : null, balance: a.balance, initialized: a.initialized }))
        .filter(x => x.pt)
        .sort((x, y) => (x.pt.name || '').localeCompare(y.pt.name || ''));
      const isLow = Number(svc.alert_min_balance) > 0 && total < Number(svc.alert_min_balance) && anyInit;
      return { svc, total, perPoint, initialized: anyInit, isLow };
    }).filter(g => g.perPoint.length > 0 || g.total > 0 || g.initialized);
  };

  const uvGroups = buildServiceGroups('transfert', 'uv');
  const creditGroups = buildServiceGroups('credit_telephone', 'stock_credit');

  const selectedPoint = selectedPointId ? ptById.get(selectedPointId) : null;
  const selectedPointName = selectedPoint?.name || 'Tous les points';
  const periodLabel = dateRange === 'today' ? "aujourd'hui" : dateRange === 'week' ? '7 derniers jours' : '30 derniers jours';

  const fmtBalance = (bal: number, isInitialized: boolean) =>
    !isInitialized && bal === 0 ? <span className="text-neutral-400 italic text-xs">Non initialisé</span> : <MTMoney value={bal} />;

  const StatusPill = ({ status }: { status: 'ok' | 'low' | 'ecart' | 'uninit' }) => {
    const map = {
      ok: { label: 'Normal', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
      low: { label: 'Solde bas', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
      ecart: { label: 'Écart détecté', cls: 'bg-red-50 text-red-700 border-red-200' },
      uninit: { label: 'Non initialisé', cls: 'bg-neutral-100 text-neutral-500 border-neutral-200' },
    };
    return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${map[status].cls}`}>{map[status].label}</span>;
  };

  if (aggAccounts.length === 0) return <MTEmpty>Aucun solde initialisé</MTEmpty>;

  return (
    <div className="mx-auto max-w-[1100px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold">Soldes</h2>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {points.length > 1 ? (
            <SearchableSelect ariaLabel="Point de service" value={selectedPointId} onChange={setSelectedPointId}
              className="min-w-0 max-w-full" searchable={points.length > 8} clearable={false} wrapLabels
              options={[{ value: '', label: 'Tous les points' }, ...points.map(point => ({ value: point.id, label: point.name }))]} />
          ) : <span className="text-sm text-[var(--w-text-sec)]">{selectedPointName}</span>}
          <SearchableSelect ariaLabel="Période" value={dateRange} onChange={setDateRange}
            className="min-w-0 max-w-full" searchable={false} clearable={false}
            options={[
              { value: 'today', label: 'Aujourd’hui' }, { value: 'week', label: '7 derniers jours' },
              { value: 'month', label: '30 derniers jours' },
            ]} />
        </div>
      </div>

      <div className="flex-1 space-y-4">
        {/* ─── Bloc 1 : Synthèse ─── */}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-[var(--w-text)]">
            {selectedPointId ? `Synthèse — ${selectedPointName}` : 'Synthèse globale'}
          </h2>
          <div className="rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)] p-4 sm:p-5">
            <div className="flex items-start justify-between mb-4">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-1">Solde total disponible</p>
                {hasAnyInit ? (
                  <MTMoney value={totals.cash + totals.uv + totals.credit} className="text-[clamp(1.05rem,6vw,1.875rem)] font-bold" />
                ) : (
                  <p className="text-lg font-semibold text-neutral-400 italic">Non initialisé</p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-neutral-100">
              <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--w-text-muted)]">Cash total</p>
                <p className="text-sm font-bold text-neutral-900 mt-0.5">
                  {cashInitialized ? <span className="num">{fmt(totals.cash)}</span> : <span className="text-neutral-400 italic text-xs">Non initialisé</span>}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--w-text-muted)]">UV transfert</p>
                <p className="text-sm font-bold text-[var(--w-text)] mt-0.5">
                  {uvInitialized ? <span className="num">{fmt(totals.uv)}</span> : <span className="text-neutral-400 italic text-xs">Non initialisé</span>}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--w-text-muted)]">Stock crédit</p>
                <p className="text-sm font-bold text-[var(--w-text)] mt-0.5">
                  {creditInitialized ? <span className="num">{fmt(totals.credit)}</span> : <span className="text-neutral-400 italic text-xs">Non initialisé</span>}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--w-text-muted)]">Opérations {periodLabel}</p>
                <p className="text-sm font-bold text-neutral-900 num mt-0.5">{scopedOps.length}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-4 mt-3 border-t border-neutral-100">
              <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--w-text-muted)]">Commissions {periodLabel}</p>
                <p className="text-sm font-bold text-emerald-700 num mt-0.5">{fmt(commissionsToday)} <span className="text-[10px] font-normal text-neutral-400">FCFA</span></p>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--w-text-muted)]">Écarts non résolus</p>
                <p className={`text-sm font-bold mt-0.5 ${pendingEcarts.length > 0 ? 'text-red-600' : 'text-neutral-900'} num`}>{pendingEcarts.length}</p>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--w-text-muted)]">Alertes solde bas</p>
                <p className={`text-sm font-bold mt-0.5 ${lowBalanceAlerts.length > 0 ? 'text-amber-700' : 'text-neutral-900'} num`}>{lowBalanceAlerts.length}</p>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Bloc 2 : Soldes par point (vue Tous les points) ─── */}
        {!selectedPointId && points.length > 1 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold text-[var(--w-text)]">Soldes par point de service</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {pointCards.map(({ pt, cash, uv, credit, opsCount, initialized, status }) => (
                <div key={pt.id} className="rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)] p-4 hover:border-neutral-300 transition-colors">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-neutral-100 flex items-center justify-center shrink-0">
                        <MapPin className="w-4 h-4 text-neutral-600" />
                      </div>
                      <p className="text-sm font-bold text-neutral-900 break-words">{pt.name}</p>
                    </div>
                    <StatusPill status={status} />
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <p className="text-[10px] text-neutral-400 uppercase font-medium">Cash</p>
                      <p className="text-sm font-bold text-neutral-900 mt-0.5">{fmtBalance(cash, initialized)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-neutral-400 uppercase font-medium">UV transfert</p>
                      <p className="text-sm font-bold text-[var(--w-text)] mt-0.5">{fmtBalance(uv, initialized)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-neutral-400 uppercase font-medium">Stock crédit</p>
                      <p className="text-sm font-bold text-[var(--w-text)] mt-0.5">{fmtBalance(credit, initialized)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-neutral-400 uppercase font-medium">Opérations</p>
                      <p className="text-sm font-bold text-neutral-900 num mt-0.5">{opsCount}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ─── Bloc 3 : UV transfert par service ─── */}
        {uvGroups.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold text-[var(--w-text)]">
              {selectedPointId ? 'Services de transfert' : 'Soldes UV par service de transfert'}
            </h2>
            <div className="rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)] overflow-hidden divide-y divide-neutral-100">
              {uvGroups.map(({ svc, total, perPoint, initialized, isLow }) => (
                <div key={svc.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-sky-50 flex items-center justify-center shrink-0 overflow-hidden">
                        {svc.logo_url ? <img src={svc.logo_url} className="w-full h-full object-contain" alt={svc.name} /> : <Smartphone className="w-4 h-4 text-sky-500" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-neutral-900 break-words">{svc.name}</p>
                        {!selectedPointId && perPoint.length > 0 && (
                          <p className="text-[10px] text-neutral-400">{perPoint.length} point{perPoint.length > 1 ? 's' : ''}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <p className={`text-sm font-bold ${isLow ? 'text-amber-700' : 'text-sky-700'}`}>{fmtBalance(total, initialized)}</p>
                      {isLow && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Bas</span>}
                    </div>
                  </div>
                  {!selectedPointId && perPoint.length > 1 && (
                    <div className="mt-2 pl-10 space-y-0.5">
                      {perPoint.map((pp, idx) => (
                        <div key={idx} className="flex items-center justify-between text-[11px]">
                          <span className="text-neutral-500">{pp.pt.name}</span>
                          <span className="text-neutral-700 font-medium">{fmtBalance(pp.balance, pp.initialized)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ─── Bloc 4 : Stock crédit téléphonique par service ─── */}
        {creditGroups.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold text-[var(--w-text)]">
              {selectedPointId ? 'Crédit téléphonique' : 'Stock crédit par service téléphonique'}
            </h2>
            <div className="rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)] overflow-hidden divide-y divide-neutral-100">
              {creditGroups.map(({ svc, total, perPoint, initialized, isLow }) => (
                <div key={svc.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center shrink-0 overflow-hidden">
                        {svc.logo_url ? <img src={svc.logo_url} className="w-full h-full object-contain" alt={svc.name} /> : <Smartphone className="w-4 h-4 text-amber-500" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-neutral-900 break-words">{svc.name}</p>
                        {!selectedPointId && perPoint.length > 0 && (
                          <p className="text-[10px] text-neutral-400">{perPoint.length} point{perPoint.length > 1 ? 's' : ''}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <p className={`text-sm font-bold ${isLow ? 'text-amber-700' : 'text-amber-800'}`}>{fmtBalance(total, initialized)}</p>
                      {isLow && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Bas</span>}
                    </div>
                  </div>
                  {!selectedPointId && perPoint.length > 1 && (
                    <div className="mt-2 pl-10 space-y-0.5">
                      {perPoint.map((pp, idx) => (
                        <div key={idx} className="flex items-center justify-between text-[11px]">
                          <span className="text-neutral-500">{pp.pt.name}</span>
                          <span className="text-neutral-700 font-medium">{fmtBalance(pp.balance, pp.initialized)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ─── Bloc 5 : Alertes et anomalies ─── */}
        {(lowBalanceAlerts.length > 0 || pendingEcarts.length > 0) && (
          <section>
            <h2 className="mb-2 text-sm font-semibold text-[var(--w-text)]">Alertes et anomalies</h2>
            <div className="space-y-2">
              {lowBalanceAlerts.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <h3 className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Solde bas</h3>
                  </div>
                  <div className="space-y-1.5">
                    {lowBalanceAlerts.map((x, idx) => {
                      const ptName = x.acc.service_point_id ? ptById.get(x.acc.service_point_id)?.name : null;
                      return (
                        <div key={idx} className="flex items-center justify-between bg-white/70 rounded-lg px-3 py-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            {x.svc.logo_url ? <img src={x.svc.logo_url} className="w-5 h-5 object-contain" /> : <Smartphone className="w-4 h-4 text-amber-600" />}
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-amber-900 break-words">{x.svc.name}</p>
                              <p className="text-[10px] text-amber-600 break-words">{ptName ? `${ptName} │ ` : ''}Seuil : {fmt(x.svc.alert_min_balance)} FCFA</p>
                            </div>
                          </div>
                          <p className="text-sm font-bold text-amber-900 num shrink-0">{fmt(x.acc.balance)}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {pendingEcarts.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className="w-4 h-4 text-red-600" />
                    <h3 className="text-xs font-semibold text-red-800 uppercase tracking-wide">Écarts non résolus</h3>
                  </div>
                  <p className="text-[11px] text-red-700">
                    {pendingEcarts.length} écart{pendingEcarts.length > 1 ? 's en attente de traitement' : ' en attente de traitement'} — consultez l'onglet Clôtures.
                  </p>
                </div>
              )}
            </div>
          </section>
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
  useRealtimeRefresh(['mt_closures', 'mt_accounts', 'mt_service_points', 'mt_operations', 'mt_reconciliations'], load);

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
    <div className="lg:max-w-[1100px] mx-auto min-w-0 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-bold text-[var(--w-text)]">Clôtures et ouvertures</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => { setShowOpeningForm(false); setShowForm(true); }} className="btn-primary min-h-9 px-3 py-1.5 text-xs">
            <Lock className="w-4 h-4" />Clôturer
          </button>
          <button onClick={() => { setShowForm(false); setShowOpeningForm(true); }} className="btn-secondary min-h-9 px-3 py-1.5 text-xs">
            <PlayCircle className="w-4 h-4" />Ouvrir la journée
          </button>
        </div>
      </div>

      {/* Closure form */}
      {showForm && (
        <div className="rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)] p-5 space-y-4">
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
                <p className="text-xs font-medium text-[var(--w-text-sec)] tracking-wide mb-3">Soldes théoriques vs réels</p>
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

              <div className="flex flex-wrap gap-2">
                <button onClick={() => { setShowForm(false); setTheoretical(null); setSelectedPointId(''); }} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
                <button onClick={closureCreate} disabled={saving} className="btn-icon-primary" title="Confirmer la clôture">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
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
                <p className="text-xs font-medium text-[var(--w-text-sec)] tracking-wide mb-3">Montants de départ</p>
                <div className="space-y-4">
                  {/* Cash */}
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-2 text-xs font-medium text-[var(--w-text-sec)] tracking-wide">
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
                            <label className="flex items-center gap-2 text-xs font-medium text-[var(--w-text-sec)] tracking-wide">
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
                            <label className="flex items-center gap-2 text-xs font-medium text-[var(--w-text-sec)] tracking-wide">
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
              <div className="flex flex-wrap gap-2">
                <button onClick={() => { setShowOpeningForm(false); setSelectedPointId(''); }} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
                <button onClick={confirmOpening} disabled={saving} className="btn-icon-primary !bg-emerald-600 hover:!bg-emerald-700" title="Confirmer l'ouverture">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quick status per point */}
      {!showForm && !showOpeningForm && points.length > 0 && (
        <div className="rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)] overflow-hidden">
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
        <div className="rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)] overflow-hidden">
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
        <MTEmpty>Aucune clôture effectuée │ Clôturez en fin de journée pour suivre les écarts</MTEmpty>
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
  const [generated, setGenerated] = useState(false);

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
    setGenerated(true);
    setLoading(false);
  };

  const totalAmount = data.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const changeType = (value: string) => {
    setReport(value);
    setData([]);
    setGenerated(false);
  };

  return (
    <div className="mx-auto max-w-[1200px] space-y-4">
      <h2 className="text-base font-bold">Rapports</h2>
      <form className="grid min-w-0 items-end gap-2 border-b border-[var(--w-separator)] pb-3 sm:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
        onSubmit={event => { event.preventDefault(); void generate(); }}>
        <SearchableSelect label="Type de rapport" value={report} onChange={changeType}
          className="min-w-0" searchable={false} clearable={false} wrapLabels disabled={loading}
          options={[
            { value: 'operations', label: 'Toutes les opérations' }, { value: 'depots', label: 'Dépôts' },
            { value: 'retraits', label: 'Retraits' }, { value: 'clotures', label: 'Clôtures' },
          ]} />
        <label className="label min-w-0">Du
          <input type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} className="input mt-1 min-w-0 text-sm" required />
        </label>
        <label className="label min-w-0">Au
          <input type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} className="input mt-1 min-w-0 text-sm" min={dateFrom} required />
        </label>
        <button type="submit" disabled={loading} className="btn-primary mb-1 text-xs">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <BarChart3 className="h-4 w-4" aria-hidden="true" />} Générer
        </button>
      </form>

      {data.length > 0 && (
        <section className="rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)]">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--w-separator)] px-3.5 py-2.5 text-sm xl:px-4">
            <h3 className="font-semibold">{data.length} résultat{data.length > 1 ? 's' : ''}</h3>
            {report !== 'clotures' && <MTMoney value={totalAmount} className="font-semibold" />}
          </div>
          <ul className="divide-y divide-[var(--w-separator-l)]">
            {data.map(row => (
              <li key={row.id} className="flex items-start justify-between gap-2 px-3.5 py-2.5 xl:px-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{OP_TYPE_LABELS[row.type] || row.type || 'Clôture'}</p>
                  <p className="text-xs text-[var(--w-text-sec)]">{new Date(row.operated_at || row.closure_date).toLocaleDateString('fr-FR')}</p>
                </div>
                <div className="shrink-0 text-right">
                  <MTMoney value={Number(row.amount ?? row.cash_theoretical ?? 0)} className="text-xs font-semibold sm:text-sm" />
                  <p className="text-xs text-[var(--w-text-sec)]">{STATUS_LABELS[row.status] || row.status}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {generated && data.length === 0 && !loading && <MTEmpty>Aucun résultat pour cette période</MTEmpty>}
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

  const tabs = ([
    { key: 'initialisation', label: 'Initialisation', icon: PlayCircle, visible: can('mt_balance_initialize') },
    { key: 'points', label: 'Points de service', icon: MapPin, visible: true },
    { key: 'services', label: 'Services', icon: ArrowRightLeft, visible: can('mt_services_manage') },
    { key: 'grossistes', label: 'Grossistes', icon: Users, visible: can('mt_wholesaler_view') },
    { key: 'config', label: 'Configuration', icon: Settings2, visible: true },
  ] satisfies { key: SettingsTab; label: string; icon: any; visible: boolean }[]).filter(t => t.visible);

  const currentTab = tabs.some(tab => tab.key === activeTab) ? activeTab : tabs[0].key;

  return (
    <div className="mx-auto max-w-[1100px] space-y-4">
      <h2 className="text-base font-bold">Paramètres</h2>
      <nav aria-label="Paramètres du transfert d’argent" className="flex flex-wrap gap-1 border-b border-[var(--w-separator)] pb-2">
        {tabs.map(tab => (
          <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)}
            aria-current={currentTab === tab.key ? 'page' : undefined}
            className={`btn-ghost min-h-9 flex-wrap px-2.5 py-1.5 text-xs ${currentTab === tab.key ? 'bg-[var(--w-active)] font-semibold !text-[var(--w-text)]' : ''}`}>
            <tab.icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {tab.label}
          </button>
        ))}
      </nav>

      <div>
        {currentTab === 'initialisation' && can('mt_balance_initialize') && <MTInitialisation onValidated={onValidated} />}
        {currentTab === 'points' && <MTServicePoints />}
        {currentTab === 'services' && can('mt_services_manage') && <MTServices />}
        {currentTab === 'grossistes' && can('mt_wholesaler_view') && <MTWholesalers />}
        {currentTab === 'config' && (
          <div className="lg:max-w-[700px] rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)] p-4 sm:p-5 space-y-4">
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

/* ============================================ */
/* DÉPENSES                                     */
/* ============================================ */
function MTExpenses() {
  const { tenant, profile } = useApp();
  const toast = useToast();
  const { can } = usePermissions();
  const [expenses, setExpenses] = useState<any[]>([]);
  const [expenseToCancel, setExpenseToCancel] = useState<{ id: string; status: string; service_point_id: string; amount: number } | null>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [points, setPoints] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showCatForm, setShowCatForm] = useState(false);
  const [filterPoint, setFilterPoint] = useState<string>('');
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [filterPeriod, setFilterPeriod] = useState<'today' | 'week' | 'month' | 'all'>('month');
  const [form, setForm] = useState({ service_point_id: '', category_id: '', amount: '', description: '' });
  const [catForm, setCatForm] = useState({ name: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!tenant) return;
    const [{ data: e }, { data: c }, { data: p }] = await Promise.all([
      supabase.from('mt_expenses').select('*').eq('tenant_id', tenant.id).order('expense_date', { ascending: false }).limit(200),
      supabase.from('mt_expense_categories').select('*').eq('tenant_id', tenant.id).eq('is_active', true).order('name'),
      supabase.from('mt_service_points').select('*').eq('tenant_id', tenant.id).eq('status', 'active').order('name'),
    ]);
    setExpenses(e || []);
    setCategories(c || []);
    setPoints(p || []);
    if (p && p.length === 1) setForm(f => ({ ...f, service_point_id: f.service_point_id || p[0].id }));
    setLoading(false);
  }, [tenant]);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(['mt_expenses', 'mt_expense_categories', 'mt_accounts', 'mt_service_points'], load);

  const filtered = useMemo(() => {
    let out = expenses;
    if (filterPoint) out = out.filter(e => e.service_point_id === filterPoint);
    if (filterCategory) out = out.filter(e => e.category_id === filterCategory);
    if (filterPeriod !== 'all') {
      const now = new Date();
      const start = new Date(now);
      if (filterPeriod === 'today') start.setHours(0, 0, 0, 0);
      else if (filterPeriod === 'week') start.setDate(now.getDate() - 7);
      else if (filterPeriod === 'month') start.setDate(now.getDate() - 30);
      out = out.filter(e => new Date(e.expense_date) >= start);
    }
    return out;
  }, [expenses, filterPoint, filterCategory, filterPeriod]);

  const stats = useMemo(() => {
    const valid = filtered.filter(e => e.status === 'validee');
    const total = valid.reduce((s, e) => s + Number(e.amount || 0), 0);
    const byCat = new Map<string, number>();
    for (const e of valid) {
      const key = e.category_id || 'none';
      byCat.set(key, (byCat.get(key) || 0) + Number(e.amount || 0));
    }
    return { total, count: valid.length, byCat };
  }, [filtered]);

  const saveCat = async () => {
    if (!tenant || !catForm.name.trim()) return;
    setSaving(true);
    const { error } = await supabase.from('mt_expense_categories').insert({ tenant_id: tenant.id, name: catForm.name.trim() });
    if (error) toast.error('Erreur : ' + error.message);
    else { toast.success('Catégorie créée'); setCatForm({ name: '' }); setShowCatForm(false); load(); }
    setSaving(false);
  };

  const save = async () => {
    if (!tenant) return;
    if (!form.service_point_id) { toast.error('Sélectionnez un point de service.'); return; }
    if (!Number(form.amount) || Number(form.amount) <= 0) { toast.error('Montant invalide.'); return; }
    setSaving(true);
    const amt = Number(form.amount);
    const { error } = await supabase.from('mt_expenses').insert({
      tenant_id: tenant.id,
      service_point_id: form.service_point_id,
      category_id: form.category_id || null,
      amount: amt,
      source: 'cash',
      description: form.description || null,
      operated_by: profile?.id || null,
    });
    if (error) { toast.error('Erreur : ' + error.message); setSaving(false); return; }
    await updateBalance(tenant.id, form.service_point_id, null, 'cash', -amt);
    toast.success('Dépense enregistrée');
    setForm({ service_point_id: points.length === 1 ? points[0].id : '', category_id: '', amount: '', description: '' });
    setShowForm(false);
    setSaving(false);
    load();
  };

  const cancelExpense = async (e: any) => {
    if (e.status !== 'validee') return;
    await supabase.from('mt_expenses').update({ status: 'annulee', cancelled_by: profile?.id, cancelled_at: new Date().toISOString() }).eq('id', e.id);
    await updateBalance(tenant!.id, e.service_point_id, null, 'cash', Number(e.amount));
    toast.success('Dépense annulée');
    load();
  };

  const getCatName = (id: string | null) => categories.find(c => c.id === id)?.name || 'Sans catégorie';
  const getPointName = (id: string | null) => points.find(p => p.id === id)?.name || '—';

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-5 h-5 animate-spin text-neutral-400" /></div>;

  return (
    <div className="lg:max-w-[1200px] mx-auto min-w-0 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-bold text-[var(--w-text)]">Dépenses</h2>

        </div>
        {can('mt_expense_manage') && !showForm && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setShowCatForm(true)} className="btn-secondary min-h-9 px-3 py-1.5 text-xs">
              <Settings2 className="w-4 h-4" />Catégories
            </button>
            <button onClick={() => setShowForm(true)} className="btn-primary min-h-9 px-3 py-1.5 text-xs">
              <Plus className="w-4 h-4" />Nouvelle dépense
            </button>
          </div>
        )}
      </div>

      {/* Synthèse */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)] p-3.5">
          <p className="text-xs font-medium text-[var(--w-text-sec)]">Total période</p>
          <p className="text-lg font-bold text-neutral-900 mt-1">{fmt(stats.total)} <span className="text-xs font-normal text-neutral-400">FCFA</span></p>
          <p className="text-[10px] text-neutral-400 mt-0.5">{stats.count} dépense{stats.count > 1 ? 's' : ''}</p>
        </div>
        <div className="rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)] p-3.5">
          <p className="text-xs font-medium text-[var(--w-text-sec)]">Points concernés</p>
          <p className="text-lg font-bold text-neutral-900 mt-1">{new Set(filtered.filter(e => e.status === 'validee').map(e => e.service_point_id)).size}</p>
        </div>
        <div className="rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)] p-3.5">
          <p className="text-xs font-medium text-[var(--w-text-sec)]">Catégories actives</p>
          <p className="text-lg font-bold text-neutral-900 mt-1">{categories.length}</p>
        </div>
      </div>

      <Modal open={showCatForm} onClose={() => { if (!saving) setShowCatForm(false); }} title="Catégories de dépense"
        size="sm" layer="top" panelClassName="!h-auto" focusOnOpen
        footer={<MTFormActions cancel={() => setShowCatForm(false)} submit={saveCat} label="Ajouter" busy={saving} disabled={!catForm.name.trim()} />}>
        {categories.length > 0 ? (
          <ul className="mb-3 divide-y divide-[var(--w-separator-l)]">
            {categories.map(category => <li key={category.id} className="py-2 text-sm">{category.name}</li>)}
          </ul>
        ) : <MTEmpty>Aucune catégorie créée</MTEmpty>}
        <label className="label">Nom de la catégorie
          <input value={catForm.name} onChange={e => setCatForm({ name: e.target.value })} placeholder="Ex. Carburant" className="input mt-1" />
        </label>
      </Modal>

      <Modal open={showForm} onClose={() => { if (!saving) setShowForm(false); }} title="Nouvelle dépense"
        size="md" layer="top" panelClassName="!h-auto" focusOnOpen
        footer={<MTFormActions cancel={() => setShowForm(false)} submit={save} label="Enregistrer" busy={saving}
          disabled={!form.service_point_id || !form.amount} />}>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <label className="label">Point de service <span aria-hidden="true">*</span>
            <select value={form.service_point_id} onChange={e => setForm({ ...form, service_point_id: e.target.value })} className="input mt-1" required>
              <option value="">Sélectionner un point</option>
              {points.map(point => <option key={point.id} value={point.id}>{point.name}</option>)}
            </select>
          </label>
          <label className="label">Catégorie
            <select value={form.category_id} onChange={e => setForm({ ...form, category_id: e.target.value })} className="input mt-1">
              <option value="">Sans catégorie</option>
              {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
          <label className="label">Montant (FCFA) <span aria-hidden="true">*</span>
            <input value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0" type="number" inputMode="decimal" min="0" className="input num mt-1 text-base font-semibold" required />
          </label>
          <div className="self-center text-sm text-[var(--w-text-sec)]">Source │ Caisse</div>
          <label className="label sm:col-span-2">Description
            <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="input mt-1" />
          </label>
        </div>
      </Modal>

      {/* Filtres */}
      <div className="flex items-center gap-2 flex-wrap">
        <SearchableSelect ariaLabel="Point de service" value={filterPoint} onChange={setFilterPoint}
          className="min-w-0 max-w-full" searchable={points.length > 8} clearable={false} wrapLabels
          options={[{ value: '', label: 'Tous les points' }, ...points.map(point => ({ value: point.id, label: point.name }))]} />
        <SearchableSelect ariaLabel="Catégorie de dépense" value={filterCategory} onChange={setFilterCategory}
          className="min-w-0 max-w-full" searchable={categories.length > 8} clearable={false} wrapLabels
          options={[{ value: '', label: 'Toutes les catégories' }, ...categories.map(category => ({ value: category.id, label: category.name }))]} />
        <div className="flex gap-1 bg-neutral-100 rounded-lg p-0.5">
          {(['today', 'week', 'month', 'all'] as const).map(p => (
            <button key={p} onClick={() => setFilterPeriod(p)} className={`px-2.5 py-1 text-xs font-medium rounded-md ${filterPeriod === p ? 'bg-white text-neutral-900 ' : 'text-neutral-500'}`}>
              {p === 'today' ? "Aujourd’hui" : p === 'week' ? '7 jours' : p === 'month' ? '30 jours' : 'Tout'}
            </button>
          ))}
        </div>
      </div>

      {/* Liste */}
      {filtered.length === 0 ? (
        <MTEmpty>Aucune dépense sur cette période</MTEmpty>
      ) : (
        <div className="rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)] overflow-hidden">
          <div className="divide-y divide-neutral-100 max-h-[600px] overflow-y-auto">
            {filtered.map(e => (
              <div key={e.id} className="px-4 py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-neutral-50 flex items-center justify-center shrink-0">
                  <Receipt className="w-4 h-4 text-neutral-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-neutral-900">{getCatName(e.category_id)}</p>
                  </div>
                  <p className="text-xs text-neutral-500 mt-0.5 break-words">{getPointName(e.service_point_id)}{e.description ? ` │ ${e.description}` : ''}</p>
                  <p className="text-[11px] text-neutral-400 mt-0.5">{new Date(e.expense_date).toLocaleDateString('fr-FR')} {new Date(e.expense_date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-red-600">-{fmt(e.amount)} <span className="text-[10px] font-normal text-neutral-400">FCFA</span></p>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${e.status === 'validee' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{e.status === 'validee' ? 'Validée' : 'Annulée'}</span>
                </div>
                {e.status === 'validee' && can('mt_expense_cancel') && (
                  <button onClick={() => setExpenseToCancel(e)} className="p-1.5 rounded-lg hover:bg-red-50 text-neutral-300 hover:text-red-500 shrink-0" title="Annuler">
                    <XCircle className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <ConfirmDialog open={!!expenseToCancel} onClose={() => setExpenseToCancel(null)}
        onConfirm={() => { if (expenseToCancel) void cancelExpense(expenseToCancel); }}
        title="Annuler la dépense" message="Le solde de caisse sera recrédité." confirmLabel="Annuler la dépense" danger layer="top" />
    </div>
  );
}

/* ============================================ */
/* CLIENTS & CRÉANCES                           */
/* ============================================ */
type MTCustomer = { id: string; code: string | null; name: string; phone: string | null; address: string | null; notes: string | null; status: string };
type LedgerEntry = { id: string; customer_id: string; service_point_id: string | null; entry_type: string; amount: number; balance_delta: number; creance_delta: number; comment: string | null; operated_at: string; operation_id: string | null };
type CustomerAgg = { balance: number; creance: number };

function MTCustomers() {
  const { tenant, profile } = useApp();
  const toast = useToast();
  const { can } = usePermissions();
  const [customers, setCustomers] = useState<MTCustomer[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [ledgerEntryToCancel, setLedgerEntryToCancel] = useState<LedgerEntry | null>(null);
  const [points, setPoints] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<MTCustomer | null>(null);
  const [movementModal, setMovementModal] = useState<'depot' | 'retrait' | 'remboursement' | null>(null);
  const [movementForm, setMovementForm] = useState({ amount: '', service_point_id: '', comment: '' });
  const [customerForm, setCustomerForm] = useState({ code: '', name: '', phone: '', address: '', notes: '' });
  const [operationModal, setOperationModal] = useState(false);
  const [opForm, setOpForm] = useState({ service_point_id: '', service_id: '', amount: '', comment: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!tenant) return;
    const [{ data: c }, { data: l }, { data: p }, { data: s }, { data: a }] = await Promise.all([
      supabase.from('mt_customers').select('*').eq('tenant_id', tenant.id).order('name'),
      supabase.from('mt_customer_ledger').select('*').eq('tenant_id', tenant.id).order('operated_at', { ascending: false }).limit(500),
      supabase.from('mt_service_points').select('*').eq('tenant_id', tenant.id).eq('status', 'active').order('name'),
      supabase.from('mt_services').select('*').eq('tenant_id', tenant.id).eq('status', 'active').order('name'),
      supabase.from('mt_accounts').select('*').eq('tenant_id', tenant.id),
    ]);
    setCustomers(c || []);
    setLedger(l || []);
    setPoints(p || []);
    setServices((s || []).filter((x: any) => (x.name || '').trim() !== ''));
    setAccounts(a || []);
    setLoading(false);
  }, [tenant]);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(['mt_customers', 'mt_customer_ledger', 'mt_operations'], load);

  const aggregates = useMemo(() => {
    const map = new Map<string, CustomerAgg>();
    for (const e of ledger) {
      const cur = map.get(e.customer_id) || { balance: 0, creance: 0 };
      cur.balance += Number(e.balance_delta || 0);
      cur.creance += Number(e.creance_delta || 0);
      map.set(e.customer_id, cur);
    }
    return map;
  }, [ledger]);

  const totals = useMemo(() => {
    let balance = 0, creance = 0;
    for (const v of aggregates.values()) { balance += v.balance; creance += v.creance; }
    return { balance, creance, count: customers.filter(c => c.status === 'actif').length, withCreance: [...aggregates.values()].filter(v => v.creance > 0.01).length };
  }, [aggregates, customers]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return customers;
    return customers.filter(c => c.name.toLowerCase().includes(q) || (c.phone || '').toLowerCase().includes(q) || (c.code || '').toLowerCase().includes(q));
  }, [customers, search]);

  const selected = customers.find(c => c.id === selectedId) || null;
  const selectedAgg = selectedId ? aggregates.get(selectedId) || { balance: 0, creance: 0 } : null;
  const selectedLedger = selectedId ? ledger.filter(e => e.customer_id === selectedId) : [];

  const openNewCustomer = () => { setEditingCustomer(null); setCustomerForm({ code: '', name: '', phone: '', address: '', notes: '' }); setShowCustomerForm(true); };
  const openEditCustomer = (c: MTCustomer) => { setEditingCustomer(c); setCustomerForm({ code: c.code || '', name: c.name, phone: c.phone || '', address: c.address || '', notes: c.notes || '' }); setShowCustomerForm(true); };

  const saveCustomer = async () => {
    if (!tenant || !customerForm.name.trim()) return;
    setSaving(true);
    const payload = { code: customerForm.code.trim() || null, name: customerForm.name.trim(), phone: customerForm.phone.trim() || null, address: customerForm.address.trim() || null, notes: customerForm.notes.trim() || null, updated_at: new Date().toISOString() };
    if (editingCustomer) {
      const { error } = await supabase.from('mt_customers').update(payload).eq('id', editingCustomer.id);
      if (error) toast.error('Erreur : ' + error.message);
      else { toast.success('Client mis à jour'); setShowCustomerForm(false); load(); }
    } else {
      const { error } = await supabase.from('mt_customers').insert({ ...payload, tenant_id: tenant.id });
      if (error) toast.error('Erreur : ' + error.message);
      else { toast.success('Client créé'); setShowCustomerForm(false); load(); }
    }
    setSaving(false);
  };

  const toggleStatus = async (c: MTCustomer) => {
    const newStatus = c.status === 'actif' ? 'inactif' : 'actif';
    await supabase.from('mt_customers').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', c.id);
    load();
  };

  const openMovement = (kind: 'depot' | 'retrait' | 'remboursement') => {
    setMovementForm({ amount: '', service_point_id: points.length === 1 ? points[0].id : '', comment: '' });
    setMovementModal(kind);
  };

  const saveMovement = async () => {
    if (!tenant || !selectedId || !movementModal) return;
    const amt = Number(movementForm.amount);
    if (!amt || amt <= 0) { toast.error('Montant invalide.'); return; }
    if (!movementForm.service_point_id) { toast.error('Sélectionnez un point de service.'); return; }
    if (movementModal === 'retrait' && (selectedAgg?.balance || 0) < amt) { toast.error('Solde client insuffisant.'); return; }
    if (movementModal === 'remboursement' && (selectedAgg?.creance || 0) < amt - 0.01) { toast.error('Créance inférieure au montant remboursé.'); return; }
    setSaving(true);
    let balance_delta = 0, creance_delta = 0;
    if (movementModal === 'depot') balance_delta = amt;
    else if (movementModal === 'retrait') balance_delta = -amt;
    else if (movementModal === 'remboursement') creance_delta = -amt;
    const { error } = await supabase.from('mt_customer_ledger').insert({
      tenant_id: tenant.id,
      customer_id: selectedId,
      service_point_id: movementForm.service_point_id,
      entry_type: movementModal,
      amount: amt,
      balance_delta,
      creance_delta,
      comment: movementForm.comment || null,
      operated_by: profile?.id || null,
    });
    if (error) { toast.error('Erreur : ' + error.message); setSaving(false); return; }
    // Contrepartie cash au point
    if (movementModal === 'depot' || movementModal === 'remboursement') {
      await updateBalance(tenant.id, movementForm.service_point_id, null, 'cash', amt);
    } else if (movementModal === 'retrait') {
      await updateBalance(tenant.id, movementForm.service_point_id, null, 'cash', -amt);
    }
    const labels = { depot: 'Dépôt enregistré', retrait: 'Retrait enregistré', remboursement: 'Remboursement enregistré' };
    toast.success(labels[movementModal]);
    setMovementModal(null);
    setSaving(false);
    load();
  };

  const openOperation = () => {
    setOpForm({ service_point_id: points.length === 1 ? points[0].id : '', service_id: '', amount: '', comment: '' });
    setOperationModal(true);
  };

  const opService = services.find(s => s.id === opForm.service_id) || null;
  const opTargetType: 'stock_credit' | 'uv' = opService?.family === 'credit_telephone' ? 'stock_credit' : 'uv';
  const opAmount = Number(opForm.amount) || 0;
  const opServiceBalance = useMemo(() => accounts
    .filter(a => a.type === opTargetType && a.service_point_id === opForm.service_point_id && a.service_id === opForm.service_id)
    .reduce((s, a) => s + Number(a.balance || 0), 0),
    [accounts, opTargetType, opForm.service_point_id, opForm.service_id]);
  const custBalance = selectedAgg?.balance || 0;
  const balancePart = Math.min(opAmount, Math.max(0, custBalance));
  const creancePart = Math.max(0, opAmount - balancePart);

  const opError = useMemo(() => {
    if (!operationModal) return null;
    if (!opForm.service_point_id) return 'Sélectionnez un point de service.';
    if (!opForm.service_id) return 'Sélectionnez un service.';
    if (opAmount <= 0) return 'Montant invalide.';
    if (opServiceBalance < opAmount) return `Solde ${opTargetType === 'stock_credit' ? 'stock crédit' : 'UV'} insuffisant sur ce point (${fmt(opServiceBalance)} FCFA disponibles).`;
    return null;
  }, [operationModal, opForm, opAmount, opServiceBalance, opTargetType]);

  const saveOperation = async () => {
    if (!tenant || !selectedId || !operationModal) return;
    if (opError) { toast.error(opError); return; }
    setSaving(true);
    const opType = opService?.family === 'credit_telephone' ? 'vente_credit' : 'transfert_service';
    const commentTag = `[client:${selectedId}]`;
    const balBefore = opServiceBalance;
    const balAfter = opServiceBalance - opAmount;

    const opPayload: any = {
      tenant_id: tenant.id,
      service_point_id: opForm.service_point_id,
      service_id: opForm.service_id,
      type: opType,
      amount: opAmount,
      commission: 0,
      status: 'validee',
      comment: `${commentTag}${opForm.comment ? ' ' + opForm.comment : ''}`,
      operated_by: profile?.id || null,
      validated_by: profile?.id || null,
      balance_before_uv: balBefore,
      balance_after_uv: balAfter,
    };
    const { data: opRow, error: opErr } = await supabase.from('mt_operations').insert(opPayload).select().maybeSingle();
    if (opErr || !opRow) { toast.error('Erreur : ' + (opErr?.message || 'insertion échouée')); setSaving(false); return; }

    await updateBalance(tenant.id, opForm.service_point_id, opForm.service_id, opTargetType, -opAmount);

    const svcName = opService?.name || '';
    const entryType = balancePart > 0 ? 'operation_solde' : 'creance';
    const comment = creancePart > 0 && balancePart > 0
      ? `${svcName} │ ${fmt(balancePart)} sur solde, ${fmt(creancePart)} en créance`
      : balancePart > 0
        ? `${svcName} │ réglé sur solde`
        : `${svcName} │ totalement en créance`;

    const { error: ledErr } = await supabase.from('mt_customer_ledger').insert({
      tenant_id: tenant.id,
      customer_id: selectedId,
      service_point_id: opForm.service_point_id,
      operation_id: opRow.id,
      entry_type: entryType,
      amount: opAmount,
      balance_delta: -balancePart,
      creance_delta: creancePart,
      comment: opForm.comment ? `${comment} │ ${opForm.comment}` : comment,
      operated_by: profile?.id || null,
    });
    if (ledErr) { toast.error('Erreur ledger : ' + ledErr.message); setSaving(false); return; }

    toast.success(creancePart > 0 ? `Opération enregistrée (${fmt(creancePart)} FCFA en créance)` : 'Opération enregistrée');
    setOperationModal(false);
    setSaving(false);
    load();
  };

  const cancelLedgerEntry = async (e: LedgerEntry) => {
    if (!tenant) return;
    if (e.operation_id) {
      const { data: op } = await supabase.from('mt_operations').select('*').eq('id', e.operation_id).maybeSingle();
      if (op) {
        await supabase.from('mt_operations').update({ status: 'annulee', cancelled_by: profile?.id, cancelled_at: new Date().toISOString() }).eq('id', op.id);
        const svc = services.find(s => s.id === op.service_id);
        const targetType = svc?.family === 'credit_telephone' ? 'stock_credit' : 'uv';
        await updateBalance(tenant.id, op.service_point_id, op.service_id, targetType, Number(op.amount));
      }
    }
    await supabase.from('mt_customer_ledger').insert({
      tenant_id: tenant.id,
      customer_id: e.customer_id,
      service_point_id: e.service_point_id || null,
      operation_id: e.operation_id || null,
      entry_type: 'ajustement',
      amount: Math.abs(Number(e.amount)),
      balance_delta: -Number(e.balance_delta || 0),
      creance_delta: -Number(e.creance_delta || 0),
      comment: `Annulation │ ${e.comment || ''}`.trim(),
      operated_by: profile?.id || null,
    });
    toast.success('Opération annulée');
    load();
  };

  const getPointName = (id: string | null) => points.find(p => p.id === id)?.name || '—';

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-5 h-5 animate-spin text-neutral-400" /></div>;

  return (
    <div className="lg:max-w-[1200px] mx-auto min-w-0 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-bold text-[var(--w-text)]">Clients et créances</h2>

        </div>
        {can('mt_customer_manage') && (
          <button onClick={openNewCustomer} className="btn-primary min-h-9 px-3 py-1.5 text-xs">
            <Plus className="w-4 h-4" />Nouveau client
          </button>
        )}
      </div>

      <dl className="grid divide-y divide-[var(--w-separator-l)] rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)] sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4">
        {[
          { label: 'Clients actifs', value: totals.count, money: false },
          { label: 'Solde total clients', value: totals.balance, money: true },
          { label: 'Créances en cours', value: totals.creance, money: true },
          { label: 'Clients avec créance', value: totals.withCreance, money: false },
        ].map(({ label, value, money }) => (
          <div key={label} className="flex min-w-0 flex-wrap items-baseline justify-between gap-1.5 px-3 py-2.5 xl:justify-start">
            <dt className="text-xs text-[var(--w-text-sec)]">{label}</dt>
            <dd className="font-semibold">{money ? <MTMoney value={value} /> : <span className="num">{value}</span>}</dd>
          </div>
        ))}
      </dl>

      <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className={`min-w-0 rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)] ${selected ? 'hidden lg:block' : ''}`}>
          <div className="border-b border-[var(--w-separator)] p-3">
            <PageSearch value={search} onChange={setSearch} placeholder="Rechercher un client…" />
          </div>
          <div className="divide-y divide-neutral-100 max-h-[600px] overflow-y-auto">
            {filtered.length === 0 && <p className="text-sm text-neutral-400 p-6 text-center">Aucun client</p>}
            {filtered.map(c => {
              const agg = aggregates.get(c.id) || { balance: 0, creance: 0 };
              return (
                <button key={c.id} onClick={() => setSelectedId(c.id)}
                  aria-pressed={selectedId === c.id}
                  className="w-full px-3 py-2.5 text-left hover:bg-[var(--w-hover)] aria-pressed:bg-[var(--w-active)]">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-neutral-900 break-words flex-1">{c.name}</p>
                    {c.status === 'inactif' && <span className="text-[10px] text-neutral-400">inactif</span>}
                  </div>
                  {c.phone && <p className="text-[11px] text-neutral-400 flex items-center gap-1 mt-0.5"><Phone className="w-3 h-3" />{c.phone}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-[11px] text-neutral-500">Solde <span className="font-semibold text-neutral-900"><MTMoney value={agg.balance} /></span></span>
                    {agg.creance > 0.01 && <span className="text-[11px] text-red-600 font-medium">Créance <MTMoney value={agg.creance} /></span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className={`min-w-0 rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)] ${!selected ? 'hidden lg:block' : ''}`}>
          {!selected ? (
            <MTEmpty>Sélectionnez un client pour voir son détail</MTEmpty>
          ) : (
            <div className="flex flex-col h-full">
              <div className="border-b border-[var(--w-separator)] p-3.5">
                <button type="button" onClick={() => setSelectedId(null)} className="btn-ghost mb-2 min-h-9 px-0 text-xs lg:hidden">
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Tous les clients
                </button>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-neutral-900">{selected.name}</h3>
                    <p className="text-xs text-neutral-500">{selected.phone || '—'}{selected.address ? ` │ ${selected.address}` : ''}</p>
                    {selected.code && <p className="text-[11px] text-neutral-400 mt-0.5">Code : {selected.code}</p>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {can('mt_customer_manage') && (
                      <>
                        <button onClick={() => openEditCustomer(selected)} className="btn-icon shrink-0 text-neutral-500" title="Modifier"><Edit2 className="w-4 h-4" /></button>
                        <button onClick={() => toggleStatus(selected)} className="btn-icon shrink-0 text-neutral-500" title={selected.status === 'actif' ? 'Désactiver' : 'Activer'}>{selected.status === 'actif' ? <XCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}</button>
                      </>
                    )}
                  </div>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg bg-neutral-50 p-3">
                    <p className="text-xs font-medium text-[var(--w-text-sec)]">Solde disponible</p>
                    <p className="text-lg font-bold text-neutral-900 mt-1"><MTMoney value={selectedAgg?.balance || 0} /></p>
                  </div>
                  <div className={`rounded-lg p-3 ${(selectedAgg?.creance || 0) > 0.01 ? 'bg-red-50' : 'bg-neutral-50'}`}>
                    <p className="text-xs font-medium text-[var(--w-text-sec)]">Créance en cours</p>
                    <p className={`text-lg font-bold mt-1 ${(selectedAgg?.creance || 0) > 0.01 ? 'text-red-600' : 'text-neutral-900'}`}><MTMoney value={selectedAgg?.creance || 0} /></p>
                  </div>
                </div>
                <div className="flex gap-2 mt-3 flex-wrap">
                  {can('mt_customer_credit') && <button onClick={openOperation} className="btn-primary min-h-9 px-3 py-1.5 text-xs"><ArrowRightLeft className="w-3.5 h-3.5" />Opération</button>}
                  {can('mt_customer_manage') && <button onClick={() => openMovement('depot')} className="btn-secondary min-h-9 px-3 py-1.5 text-xs"><ArrowDownLeft className="w-3.5 h-3.5" />Dépôt</button>}
                  {can('mt_customer_manage') && <button onClick={() => openMovement('retrait')} className="btn-secondary min-h-9 px-3 py-1.5 text-xs"><ArrowUpRight className="w-3.5 h-3.5" />Retrait</button>}
                  {can('mt_customer_repay') && (selectedAgg?.creance || 0) > 0.01 && <button onClick={() => openMovement('remboursement')} className="btn-secondary min-h-9 px-3 py-1.5 text-xs"><HandCoins className="w-3.5 h-3.5" />Remboursement</button>}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto max-h-[400px]">
                {selectedLedger.length === 0 ? (
                  <p className="text-sm text-neutral-400 p-6 text-center">Aucun mouvement</p>
                ) : (
                  <div className="divide-y divide-neutral-100">
                    {selectedLedger.map(e => {
                      const isPositive = Number(e.balance_delta) > 0 || Number(e.creance_delta) < 0;
                      const label = ({ depot: 'Dépôt', retrait: 'Retrait', operation_solde: 'Opération (solde)', creance: 'Opération (créance)', remboursement: 'Remboursement', ajustement: 'Ajustement' } as any)[e.entry_type] || e.entry_type;
                      const cancellable = (e.entry_type === 'operation_solde' || e.entry_type === 'creance') && can('mt_customer_credit');
                      return (
                        <div key={e.id} className="px-4 py-2.5 flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium text-neutral-900">{label}</p>
                              {Number(e.creance_delta) > 0 && <span className="text-[10px] font-medium bg-red-50 text-red-600 px-1.5 py-0.5 rounded">+créance {fmt(Number(e.creance_delta))}</span>}
                              {Number(e.balance_delta) < 0 && e.entry_type !== 'retrait' && <span className="text-[10px] font-medium bg-neutral-100 text-neutral-600 px-1.5 py-0.5 rounded">solde -{fmt(Math.abs(Number(e.balance_delta)))}</span>}
                            </div>
                            <p className="text-[11px] text-neutral-400">{new Date(e.operated_at).toLocaleDateString('fr-FR')} {new Date(e.operated_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}{e.comment ? ` │ ${e.comment}` : ''}</p>
                          </div>
                          <MTMoney value={Math.abs(Number(e.amount)) * (isPositive ? 1 : -1)} className={`shrink-0 text-xs font-semibold ${isPositive ? 'text-[var(--w-success)]' : 'text-[var(--w-error)]'}`} />
                          {cancellable && (
                            <button onClick={() => setLedgerEntryToCancel(e)} className="p-1.5 rounded-lg hover:bg-red-50 text-neutral-300 hover:text-red-500 shrink-0" title="Annuler l'opération">
                              <XCircle className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal open={showCustomerForm} onClose={() => { if (!saving) setShowCustomerForm(false); }}
        title={editingCustomer ? 'Modifier le client' : 'Nouveau client'} size="sm" layer="top" panelClassName="!h-auto" focusOnOpen
        footer={<MTFormActions cancel={() => setShowCustomerForm(false)} submit={saveCustomer} label={editingCustomer ? 'Mettre à jour' : 'Créer'}
          busy={saving} disabled={!customerForm.name.trim()} />}>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <label className="label sm:col-span-2">Nom du client <span aria-hidden="true">*</span>
            <input value={customerForm.name} onChange={e => setCustomerForm({ ...customerForm, name: e.target.value })} required className="input mt-1" />
          </label>
          <label className="label">Téléphone
            <input value={customerForm.phone} onChange={e => setCustomerForm({ ...customerForm, phone: e.target.value })} type="tel" className="input mt-1" />
          </label>
          <label className="label">Code interne
            <input value={customerForm.code} onChange={e => setCustomerForm({ ...customerForm, code: e.target.value })} className="input mt-1" />
          </label>
          <label className="label sm:col-span-2">Adresse
            <input value={customerForm.address} onChange={e => setCustomerForm({ ...customerForm, address: e.target.value })} className="input mt-1" />
          </label>
          <label className="label sm:col-span-2">Notes
            <textarea value={customerForm.notes} onChange={e => setCustomerForm({ ...customerForm, notes: e.target.value })} rows={2} className="input mt-1" />
          </label>
        </div>
      </Modal>

      {movementModal && selected && (
        <Modal open onClose={() => { if (!saving) setMovementModal(null); }}
          title={movementModal === 'depot' ? 'Dépôt de solde' : movementModal === 'retrait' ? 'Retrait de solde' : 'Remboursement de créance'}
          size="sm" layer="top" panelClassName="!h-auto" focusOnOpen
          footer={<MTFormActions cancel={() => setMovementModal(null)} submit={saveMovement} label="Enregistrer" busy={saving}
            disabled={!movementForm.amount || !movementForm.service_point_id} />}>
          <div className="space-y-3">
            <p className="text-sm text-[var(--w-text-sec)]">{selected.name}</p>
            <label className="label">Point de service <span aria-hidden="true">*</span>
              <select value={movementForm.service_point_id} onChange={e => setMovementForm({ ...movementForm, service_point_id: e.target.value })} className="input mt-1" required>
                <option value="">Sélectionner un point</option>
                {points.map(point => <option key={point.id} value={point.id}>{point.name}</option>)}
              </select>
            </label>
            <label className="label">Montant (FCFA) <span aria-hidden="true">*</span>
              <input value={movementForm.amount} onChange={e => setMovementForm({ ...movementForm, amount: e.target.value })} placeholder="0" type="number" inputMode="decimal" className="input num mt-1 font-semibold" required />
            </label>
            <label className="label">Commentaire
              <input value={movementForm.comment} onChange={e => setMovementForm({ ...movementForm, comment: e.target.value })} className="input mt-1" />
            </label>
            <dl className="space-y-1.5 border-t border-[var(--w-separator)] pt-2 text-xs">
              <div className="flex justify-between gap-2"><dt>Solde actuel</dt><dd><MTMoney value={selectedAgg?.balance || 0} className="font-semibold" /></dd></div>
              <div className="flex justify-between gap-2"><dt>Créance actuelle</dt><dd><MTMoney value={selectedAgg?.creance || 0} className="font-semibold" /></dd></div>
            </dl>
          </div>
        </Modal>
      )}

      {operationModal && selected && (
        <Modal open onClose={() => { if (!saving) setOperationModal(false); }} title={`Opération pour ${selected.name}`}
          size="md" layer="top" panelClassName="!h-auto" focusOnOpen
          footer={<MTFormActions cancel={() => setOperationModal(false)} submit={saveOperation} label="Valider l’opération" busy={saving} disabled={!!opError} />}>
          <div className="space-y-3">
            <p className="text-sm text-[var(--w-text-sec)]">Le montant est d’abord débité du solde client. Le reste est porté en créance.</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-[var(--w-text-sec)] mb-1">Point de service *</label>
                <select value={opForm.service_point_id} onChange={e => setOpForm({ ...opForm, service_point_id: e.target.value, service_id: '' })} className="input">
                  <option value="">Sélectionner...</option>
                  {points.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--w-text-sec)] mb-1">Service *</label>
                <select value={opForm.service_id} onChange={e => setOpForm({ ...opForm, service_id: e.target.value })} className="input" disabled={!opForm.service_point_id}>
                  <option value="">Sélectionner...</option>
                  {services.map(s => <option key={s.id} value={s.id}>{s.name}{s.family === 'credit_telephone' ? ' (crédit)' : ''}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[var(--w-text-sec)] mb-1">Montant demandé (FCFA) *</label>
                <input value={opForm.amount} onChange={e => setOpForm({ ...opForm, amount: e.target.value })} placeholder="0" type="number" min="0" className="input text-lg font-bold" />
              </div>
              <div className="sm:col-span-2">
                <input value={opForm.comment} onChange={e => setOpForm({ ...opForm, comment: e.target.value })} placeholder="Commentaire (optionnel)" className="input" />
              </div>
            </div>

            {opAmount > 0 && opForm.service_id && opForm.service_point_id && (
              <div className="rounded-md border border-[var(--w-separator)] bg-[var(--w-surface-el)] p-3 space-y-2">
                <p className="text-[11px] font-semibold text-neutral-500 uppercase">Répartition du règlement</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-white border border-neutral-200 p-2.5">
                    <p className="text-[10px] font-medium text-neutral-500 uppercase">Sur solde client</p>
                    <p className="text-sm font-bold text-neutral-900 mt-0.5">{fmt(balancePart)} <span className="text-[10px] font-normal text-neutral-400">FCFA</span></p>
                    <p className="text-[10px] text-neutral-400 mt-0.5">Solde disponible : {fmt(custBalance)}</p>
                  </div>
                  <div className={`rounded-lg border p-2.5 ${creancePart > 0 ? 'bg-red-50 border-red-100' : 'bg-white border-neutral-200'}`}>
                    <p className="text-[10px] font-medium text-neutral-500 uppercase">Passe en créance</p>
                    <p className={`text-sm font-bold mt-0.5 ${creancePart > 0 ? 'text-red-600' : 'text-neutral-900'}`}>{fmt(creancePart)} <span className="text-[10px] font-normal text-neutral-400">FCFA</span></p>
                    {creancePart > 0 && <p className="text-[10px] text-red-500 mt-0.5">Créance actuelle : {fmt(selectedAgg?.creance || 0)}</p>}
                  </div>
                </div>
                <div className="rounded-lg bg-white border border-neutral-200 p-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-medium text-neutral-500 uppercase">Solde {opTargetType === 'stock_credit' ? 'stock crédit' : 'UV'} du service</p>
                    <p className="text-[10px] text-neutral-400 mt-0.5">{opService?.name} │ {getPointName(opForm.service_point_id)}</p>
                  </div>
                  <div className="text-right">
                    <div className="flex items-baseline gap-1 justify-end">
                      <span className="text-xs text-neutral-400 line-through">{fmt(opServiceBalance)}</span>
                      <span className="text-sm font-bold text-neutral-900">{fmt(opServiceBalance - opAmount)}</span>
                    </div>
                    <p className="text-[10px] text-red-500">-{fmt(opAmount)} FCFA</p>
                  </div>
                </div>
              </div>
            )}

            {opError && opAmount > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-100 px-3 py-2">
                <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                <p className="text-xs text-red-700">{opError}</p>
              </div>
            )}

          </div>
        </Modal>
      )}
      <ConfirmDialog open={!!ledgerEntryToCancel} onClose={() => setLedgerEntryToCancel(null)}
        onConfirm={() => { if (ledgerEntryToCancel) void cancelLedgerEntry(ledgerEntryToCancel); }}
        title="Annuler l’opération client" message="Les soldes seront recrédités." confirmLabel="Annuler l’opération" danger layer="top" />
    </div>
  );
}
