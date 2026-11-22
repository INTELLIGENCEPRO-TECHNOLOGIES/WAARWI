import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowUpRight, Building2, Check, CircleDollarSign, Clock,
  Pencil as Edit2, Gauge, Layers, LineChart, Loader2, LogOut, Mail, MessageSquare, Pause, Plus,
  Power, Search, Send, Shield, RotateCcw, Trash2, Users, X,
  Wrench as Wrench_, Store as Store_, ShoppingBag as ShoppingBag_, Shirt as Shirt_, Cpu as Cpu_,
  CreditCard as CreditCard_, Package as Package_, Boxes as Boxes_, FileText as FileText_,
  Globe as Globe_, BookOpen as BookOpen_, Settings as Settings_, Info as Info_, Library,
  ShoppingCart, Truck, BarChart3, Monitor, Globe, ImagePlus, HeartPulse, Bell, ArrowRightLeft,
  Bug, RefreshCw, Lock, HardDrive, ChevronLeft, ChevronRight, Menu, MoreHorizontal,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { useApp } from '../context/AppContext';
import './PlatformAdmin.css';
import { Modal, ConfirmDialog } from '../components/Modal';
import { formatCompactFCFA, formatDate, formatDateTime, formatFCFA } from '../lib/format';
import { formatSubscriptionDiscount } from '../lib/subscriptionPayments';
import { MasterCatalogAdmin } from '../components/MasterCatalogAdmin';
import { AdminSubscriptionPayments } from '../components/AdminSubscriptionPayments';
import { CentralizedBackups } from '../components/CentralizedBackups';
import { LandingConfigSection as LandingConfigSectionNew } from '../components/LandingConfigSection';
import { LOGIN_ICON_MAP, DEFAULT_LOGIN_MODULES, type LoginModule, type TextAccent } from '../lib/loginConfig';

async function call(action: string, payload: Record<string, unknown> = {}) {
  const doFetch = async (accessToken: string) => {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
    return res;
  };

  let { data: sess } = await supabase.auth.getSession();
  let token = sess.session?.access_token;
  if (!token) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    token = refreshed.session?.access_token;
  }
  if (!token) throw new Error('Session expirée — veuillez vous reconnecter');

  let res = await doFetch(token);
  if (res.status === 401) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    const newToken = refreshed.session?.access_token;
    if (!newToken) throw new Error('Session expirée — veuillez vous reconnecter');
    res = await doFetch(newToken);
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erreur');
  return data;
}

const SEV = {
  info: { bg: 'bg-neutral-50', border: 'border-neutral-200', text: 'text-neutral-800', icon: 'text-neutral-700', label: 'Info' },
  success: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-800', icon: 'text-emerald-600', label: 'Succès' },
  warning: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800', icon: 'text-amber-600', label: 'Avertissement' },
  critical: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800', icon: 'text-red-600', label: 'Critique' },
} as const;

const navigation = [
  {
    label: 'Gestion',
    items: [
      { key: 'overview' as const, label: 'Vue d’ensemble', icon: Gauge },
      { key: 'tenants' as const, label: 'Entreprises', icon: Building2 },
      { key: 'subscriptions' as const, label: 'Abonnements', icon: CircleDollarSign },
      { key: 'messages' as const, label: 'Messages', icon: MessageSquare },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { key: 'master_catalogs' as const, label: 'Catalogues métiers', icon: Library },
      { key: 'login_config' as const, label: 'Écran de connexion', icon: Monitor },
      { key: 'landing' as const, label: 'Site vitrine', icon: Globe },
      { key: 'releases' as const, label: 'Mises à jour', icon: FileText_ },
    ],
  },
  {
    label: 'Supervision',
    items: [
      { key: 'activity' as const, label: 'Activité', icon: Activity },
      { key: 'backups' as const, label: 'Sauvegardes', icon: HardDrive },
    ],
  },
];

type NavigationItem = typeof navigation[number]['items'][number];
type Section = NavigationItem['key'];
const navigationItems = navigation.flatMap<NavigationItem>(group => group.items);
type SubscriptionTab = 'followup' | 'payments' | 'plans';
type SubscriptionFilter = 'all' | 'pending' | 'due' | 'expired' | 'active' | 'trial' | 'suspended' | 'rejected' | 'cancelled' | 'completed' | 'none';
type SubscriptionSelection = { tab: SubscriptionTab; filter: SubscriptionFilter; tenantId?: string };

const subscriptionTabs: { key: SubscriptionTab; label: string }[] = [
  { key: 'followup', label: 'Suivi' },
  { key: 'payments', label: 'Encaissements' },
  { key: 'plans', label: 'Offres et tarifs' },
];

function PlatformLoading() {
  return <div className="pa-empty" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Chargement…</div>;
}

export function PlatformAdmin() {
  const { profile, signOut } = useApp();
  const [section, setSection] = useState<Section>('overview');
  const [subscription, setSubscription] = useState<SubscriptionSelection>({ tab: 'followup', filter: 'all' });
  const [collapsed, setCollapsed] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const title = navigationItems.find(item => item.key === section)?.label;
  const operator = profile?.full_name || 'Super-administrateur';

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeDrawer = () => {
      if (desktop.matches && drawer.current?.open) drawer.current.close();
    };
    desktop.addEventListener('change', closeDrawer);
    return () => desktop.removeEventListener('change', closeDrawer);
  }, []);

  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 0;
  }, [section, subscription.tab]);

  const goTo = (next: Section) => {
    setSection(next);
    if (drawer.current?.open) drawer.current.close();
  };

  const openSubscriptions = (filter: SubscriptionFilter = 'all', tenantId?: string) => {
    setSubscription({ tab: 'followup', filter, tenantId });
    goTo('subscriptions');
  };

  const menu = (compact = false) => (
    <nav aria-label="Navigation de la plateforme" className="pa-nav">
      {navigation.map(group => (
        <div key={group.label} className="pa-nav-group">
          <div className="pa-nav-group-label">{group.label}</div>
          {group.items.map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" className="pa-nav-item"
              aria-label={label} aria-current={key === section ? 'page' : undefined}
              title={compact ? label : undefined} onClick={() => goTo(key)}>
              <Icon size={17} strokeWidth={1.75} aria-hidden="true" />
              <span className="pa-nav-item-label">{label}</span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="platform-console" data-collapsed={collapsed || undefined}>
      <aside className="pa-sidebar" aria-label="Menu de la console">
        <div className="pa-sidebar-brand">
          <img src={collapsed ? '/newlogoo.png' : '/newlogo.png'} alt="Waarwi" className="w-platform-logo" />
        </div>
        {menu(collapsed)}
        <footer className="pa-sidebar-footer">
          <div className="pa-operator" title={operator}>
            <span>{operator}</span>
            {profile?.full_name && <small>Super-administrateur</small>}
          </div>
          <button type="button" className="pa-icon-button" onClick={() => setCollapsed(value => !value)}
            aria-label={collapsed ? 'Développer le menu' : 'Réduire le menu'} aria-expanded={!collapsed}
            title={collapsed ? 'Développer le menu' : 'Réduire le menu'}>
            {collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
          </button>
        </footer>
      </aside>

      <dialog className="pa-drawer" ref={drawer} aria-label="Menu de la console"
        onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
        <div className="pa-drawer-content">
          <div className="pa-sidebar-brand">
            <img src="/newlogo.png" alt="Waarwi" className="w-platform-logo" />
            <button type="button" className="pa-icon-button" aria-label="Fermer le menu" onClick={() => drawer.current?.close()}>
              <X size={18} />
            </button>
          </div>
          {menu()}
          <footer className="pa-sidebar-footer"><span className="pa-muted">{operator}</span></footer>
        </div>
      </dialog>

      <div className="pa-workspace">
        <header className="pa-topbar">
          <button type="button" className="pa-icon-button pa-menu-trigger" aria-label="Ouvrir le menu"
            aria-haspopup="dialog" onClick={() => drawer.current?.showModal()}>
            <Menu size={20} />
          </button>
          <img src="/newlogoo.png" alt="Waarwi" className="pa-mobile-logo w-platform-logo" />
          <span className="pa-topbar-context">Administration</span>
          <h1>{title}</h1>
          <button type="button" className="pa-topbar-logout pa-icon-button" onClick={() => void signOut()}
            aria-label="Déconnexion" title="Déconnexion">
            <LogOut size={16} aria-hidden="true" />
            <span>Déconnexion</span>
          </button>
        </header>

        <div ref={scroll} className="pa-scroll" role="region" aria-label={title}>
          <div className="pa-content">
            {section === 'overview' && <OverviewSection onNavigate={goTo} onSubscriptions={openSubscriptions} />}
            {section === 'tenants' && <TenantsSection onOpenSubscription={id => openSubscriptions('all', id)} />}
            {section === 'subscriptions' && (
              <>
                <nav className="pa-tabs" aria-label="Gestion des abonnements">
                  {subscriptionTabs.map(item => (
                    <button key={item.key} type="button"
                      aria-current={subscription.tab === item.key ? 'page' : undefined}
                      onClick={() => setSubscription(current => ({ ...current, tab: item.key, tenantId: undefined }))}>
                      {item.label}
                    </button>
                  ))}
                </nav>
                {subscription.tab === 'followup' && (
                  <SubscriptionsSection
                    initialFilter={subscription.filter}
                    focusTenantId={subscription.tenantId}
                    onFocusConsumed={() => setSubscription(current => ({ ...current, tenantId: undefined }))}
                  />
                )}
                {subscription.tab === 'payments' && <AdminSubscriptionPayments />}
                {subscription.tab === 'plans' && <PlansSection />}
              </>
            )}
            {section === 'messages' && <MessagesSection />}
            {section === 'activity' && <ActivitySection />}
            {section === 'login_config' && <div className="pa-configuration"><LoginConfigSection /></div>}
            {section === 'landing' && <div className="pa-configuration"><LandingConfigSectionNew /></div>}
            {section === 'master_catalogs' && <div className="pa-configuration"><MasterCatalogAdmin /></div>}
            {section === 'releases' && <div className="pa-configuration"><ReleasesSection /></div>}
            {section === 'backups' && <div className="pa-configuration"><CentralizedBackups focusMode={collapsed} onToggleFocus={() => setCollapsed(value => !value)} /></div>}
          </div>
        </div>
      </div>
    </div>
  );
}

type PlatformEvent = {
  id: string;
  action: string;
  tenant_id?: string;
  tenants?: { name?: string };
  payload?: { name?: string };
  created_at: string;
};

type OverviewData = {
  tenants_total: number;
  tenants_active: number;
  tenants_pending?: number;
  tenants_suspended: number;
  users_total: number;
  mrr: number;
  by_plan: Record<string, number>;
  expiring_soon: { id: string; name: string; plan_expires_at: string }[];
  recent_events: PlatformEvent[];
};

function OverviewSection({ onNavigate, onSubscriptions }: {
  onNavigate: (section: Section) => void;
  onSubscriptions: (filter?: SubscriptionFilter, tenantId?: string) => void;
}) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const { error } = useToast();

  useEffect(() => {
    let current = true;
    call('platform_overview').then(result => {
      if (current) setData(result);
    }).catch(cause => {
      if (current) error(cause.message);
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, []);

  if (loading) return <PlatformLoading />;
  if (!data) return <p className="pa-empty">La vue d’ensemble est indisponible.</p>;

  return (
    <div className="pa-page">
      <dl className="pa-metrics">
        <div><dt>Entreprises actives</dt><dd>{data.tenants_active}<small> sur {data.tenants_total}</small></dd></div>
        <div><dt>Revenu mensuel prévu</dt><dd>{formatCompactFCFA(data.mrr)}</dd></div>
        <div><dt>Utilisateurs</dt><dd>{data.users_total}</dd></div>
        <div><dt>Échéances sous 7 jours</dt><dd><button className="pa-link" onClick={() => onSubscriptions('due')}>{data.expiring_soon.length}</button></dd></div>
      </dl>

      <div className="pa-overview-grid">
        <section>
          <div className="pa-section-head">
            <h2>À traiter</h2>
            <button type="button" className="pa-link" onClick={() => onSubscriptions()}>Tous les abonnements <ArrowUpRight size={14} /></button>
          </div>
          <div className="pa-divided">
            <button type="button" className="pa-dashboard-link" aria-label="Inscriptions à valider" onClick={() => onSubscriptions('pending')}>
              <span>Inscriptions à valider</span>
              <span className="tabular-nums">{data.tenants_pending ?? '—'}</span>
            </button>
            <button type="button" className="pa-dashboard-link" onClick={() => onSubscriptions('suspended')}>
              <span>Entreprises suspendues</span><span className="tabular-nums">{data.tenants_suspended}</span>
            </button>
          </div>
          <h3 className="pa-heading mt-5">Prochaines échéances</h3>
          <div className="pa-divided">
            {data.expiring_soon.slice(0, 6).map(tenant => (
              <button type="button" key={tenant.id} className="pa-dashboard-link" onClick={() => onSubscriptions('due', tenant.id)}>
                <span className="truncate">{tenant.name}</span><span className="pa-muted shrink-0">{formatDate(tenant.plan_expires_at)}</span>
              </button>
            ))}
            {!data.expiring_soon.length && <p className="pa-empty">Aucune échéance dans les 7 jours.</p>}
          </div>
        </section>

        <section>
          <div className="pa-section-head">
            <h2>Activité récente</h2>
            <button type="button" className="pa-link" onClick={() => onNavigate('activity')}>Tout voir <ArrowUpRight size={14} /></button>
          </div>
          <div className="pa-divided">
            {data.recent_events.slice(0, 6).map(event => <EventRow key={event.id} ev={event} />)}
            {!data.recent_events.length && <p className="pa-empty">Aucune activité récente.</p>}
          </div>
        </section>

        <section>
          <div className="pa-section-head"><h2>Répartition par offre</h2></div>
          <dl className="pa-divided">
            {Object.entries(data.by_plan ?? {}).sort((a, b) => b[1] - a[1]).map(([plan, count]) => (
              <div key={plan} className="pa-distribution">
                <dt className="capitalize">{plan}</dt><dd>{count} <span className="pa-muted">entreprise{count !== 1 ? 's' : ''}</span></dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}

const eventLabels: Record<string, string> = {
  'tenant.approve': 'Inscription approuvée', 'tenant.reject': 'Inscription rejetée',
  'tenant.suspend': 'Entreprise suspendue', 'tenant.auto_suspended': 'Suspension automatique',
  'tenant.reactivate': 'Entreprise réactivée', 'tenant.update': 'Entreprise mise à jour',
  'tenant.delete': 'Entreprise supprimée',
  'subscription.create': 'Abonnement enregistré', 'subscription.cancel': 'Abonnement annulé',
  'subscription.payment_applied': 'Paiement d’abonnement confirmé',
  'subscription.auto_renewed': 'Abonnement renouvelé', 'subscription.expired': 'Abonnement expiré',
  'plan.upsert': 'Offre enregistrée', 'plan.delete': 'Offre supprimée',
  'message.create': 'Message publié', 'message.delete': 'Message supprimé',
};

function EventRow({ ev }: { ev: PlatformEvent }) {
  const tenant = ev.tenants?.name || ev.payload?.name || (ev.tenant_id ? 'Entreprise' : 'Plateforme');
  return (
    <div className="pa-event-row">
      <div className="min-w-0"><div className="truncate font-medium">{eventLabels[ev.action] ?? ev.action}</div><small className="pa-muted">{tenant}</small></div>
      <time className="pa-muted shrink-0" dateTime={ev.created_at}>{formatDateTime(ev.created_at)}</time>
    </div>
  );
}

/* ============== TENANTS ============== */
const platformPageSize = 20;

function PlatformPagination({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / platformPageSize));
  if (pages < 2) return null;
  return (
    <nav className="pa-section-head pa-muted text-xs" aria-label="Pagination">
      <span>{page * platformPageSize + 1}–{Math.min(total, (page + 1) * platformPageSize)} sur {total}</span>
      <div className="pa-inline">
        <button type="button" className="pa-icon-button" aria-label="Page précédente" disabled={page === 0} onClick={() => onPage(page - 1)}><ChevronLeft size={16} /></button>
        <button type="button" className="pa-icon-button" aria-label="Page suivante" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}><ChevronRight size={16} /></button>
      </div>
    </nav>
  );
}

const companyStatuses = {
  pending: 'À valider',
  active: 'Active',
  suspended: 'Suspendue',
  rejected: 'Rejetée',
};

function companyStatus(tenant: { approval_status?: string; is_active?: boolean; status?: string }) {
  if (tenant.approval_status === 'pending') return 'pending';
  if (tenant.approval_status === 'rejected') return 'rejected';
  return tenant.is_active && tenant.status !== 'suspended' ? 'active' : 'suspended';
}

function TenantsSection({ onOpenSubscription }: { onOpenSubscription: (tenantId: string) => void }) {
  const [tenants, setTenants] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [detailId, setDetailId] = useState<string>();
  const [actionsOpen, setActionsOpen] = useState<string>();
  const [suspending, setSuspending] = useState<any>(null);
  const [suspensionReason, setSuspensionReason] = useState('');
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState<any>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const { success, error } = useToast();

  const load = async () => {
    try {
      const [companyData, planData] = await Promise.all([call('list_tenants'), call('list_plans')]);
      setTenants(companyData.tenants || []);
      setPlans(planData.plans || []);
    } catch (cause) { error((cause as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const planNames = useMemo(() => new Map(plans.map(plan => [plan.code, plan.name])), [plans]);
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return tenants.filter(tenant => {
      const fields = [tenant.name, tenant.email, tenant.phone, tenant.whatsapp_phone, tenant.subdomain, tenant.custom_domain];
      const matches = fields.some(value => String(value ?? '').toLowerCase().includes(query));
      if (!matches) return false;
      if (filter === 'all') return true;
      if (filter === 'never_connected') return !tenant.last_active_at;
      return companyStatus(tenant) === filter;
    });
  }, [tenants, q, filter]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / platformPageSize) - 1));
  const detail = tenants.find(tenant => tenant.id === detailId);

  const startDelete = (tenant: any) => {
    setActionsOpen(undefined);
    setDeleting(tenant);
    setDeleteConfirmName('');
    setDeleteReason('');
  };

  const updateAccess = async (tenant: any, action: 'suspend_tenant' | 'reactivate_tenant') => {
    setUpdating(true);
    try {
      await call(action, { tenant_id: tenant.id, ...(action === 'suspend_tenant' ? { reason: suspensionReason } : {}) });
      success(action === 'suspend_tenant' ? 'Entreprise suspendue' : 'Entreprise réactivée');
      setSuspending(null);
      await load();
    } catch (cause) { error((cause as Error).message); }
    finally { setUpdating(false); }
  };

  const normalizeName = (name: string) => (name || '').replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim();

  const deleteTenant = async () => {
    if (!deleting) return;
    setDeleteLoading(true);
    try {
      const response = await call('delete_tenant', { tenant_id: deleting.id, reason: deleteReason });
      success('Entreprise « ' + response.tenant_name + ' » supprimée.');
      setDeleting(null);
      setDeleteConfirmName('');
      setDeleteReason('');
      setDetailId(undefined);
      await load();
    } catch (cause) { error((cause as Error).message); }
    finally { setDeleteLoading(false); }
  };

  return (
    <div className="pa-page">
      <div className="pa-toolbar">
        <label className="pa-search">
          <Search size={16} aria-hidden="true" />
          <input value={q} aria-label="Rechercher une entreprise" placeholder="Entreprise, contact ou domaine"
            onChange={event => { setQ(event.target.value); setPage(0); }} />
        </label>
        <select className="pa-field" aria-label="Statut de l’entreprise" value={filter}
          onChange={event => { setFilter(event.target.value); setPage(0); }}>
          <option value="all">Tous les statuts</option>
          {Object.entries(companyStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          <option value="never_connected">Jamais connectée</option>
        </select>
        {!loading && <span className="pa-muted text-xs">{filtered.length} entreprise{filtered.length !== 1 ? 's' : ''}</span>}
      </div>
      {loading ? <PlatformLoading /> : filtered.length === 0 ? <p className="pa-empty">Aucune entreprise trouvée.</p> : (
        <>
          <div className="pa-table pa-tenant-list" role="table" aria-label="Entreprises">
            <div className="pa-list-head" role="row">
              {['Entreprise', 'Offre', 'Dernière activité', 'Statut', 'Actions'].map(label => <span key={label} role="columnheader">{label}</span>)}
            </div>
            {filtered.slice(currentPage * platformPageSize, (currentPage + 1) * platformPageSize).map(tenant => {
              const status = companyStatus(tenant);
              const planCode = status === 'pending' ? tenant.selected_plan_code || tenant.plan : tenant.plan;
              return (
                <div className="pa-list-row" key={tenant.id} role="row">
                  <div className="pa-row-title" role="cell">
                    <button type="button" className="pa-name-button" onClick={() => setDetailId(tenant.id)}>{tenant.name}</button>
                    <div className="pa-row-subtitle truncate">{tenant.email || tenant.whatsapp_phone || tenant.phone || '—'}</div>
                  </div>
                  <div className="pa-row-plan" role="cell">
                    <span>{planNames.get(planCode) || planCode || '—'}</span>
                    <div className="pa-row-subtitle pa-desktop-cell">{(tenant.profiles || []).length} utilisateur{(tenant.profiles || []).length !== 1 ? 's' : ''}</div>
                  </div>
                  <div className="pa-desktop-cell pa-muted" role="cell">
                    {tenant.last_active_at ? formatDate(tenant.last_active_at) : 'Jamais connectée'}
                  </div>
                  <div className="pa-row-status pa-status" data-alert={status !== 'active'} role="cell">{companyStatuses[status]}</div>
                  <div className="pa-row-actions" role="cell">
                    {status === 'pending' ? (
                      <button type="button" className="pa-link" onClick={() => onOpenSubscription(tenant.id)}>Inscription <ArrowUpRight size={13} /></button>
                    ) : (
                      <button type="button" className="pa-link" onClick={() => setDetailId(tenant.id)}>Ouvrir <ArrowUpRight size={13} /></button>
                    )}
                    <div className="relative" onKeyDown={event => { if (event.key === 'Escape') setActionsOpen(undefined); }}>
                      <button type="button" className="pa-icon-button" aria-label={'Actions de ' + tenant.name}
                        aria-expanded={actionsOpen === tenant.id} onClick={() => setActionsOpen(actionsOpen === tenant.id ? undefined : tenant.id)}>
                        <MoreHorizontal size={18} />
                      </button>
                      {actionsOpen === tenant.id && (
                        <>
                          <div className="fixed inset-0 z-30" onClick={() => setActionsOpen(undefined)} />
                          <div className="pa-popover">
                            <button type="button" onClick={() => { setActionsOpen(undefined); onOpenSubscription(tenant.id); }}>Gérer l’abonnement</button>
                            {status !== 'pending' && (tenant.is_active ? (
                              <button type="button" onClick={() => { setActionsOpen(undefined); setSuspensionReason(''); setSuspending(tenant); }}>Suspendre</button>
                            ) : (
                              <button type="button" disabled={updating} onClick={() => { setActionsOpen(undefined); void updateAccess(tenant, 'reactivate_tenant'); }}>Réactiver</button>
                            ))}
                            <button type="button" className="pa-danger" onClick={() => startDelete(tenant)}>Supprimer</button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <PlatformPagination page={currentPage} total={filtered.length} onPage={setPage} />
        </>
      )}

      {detail && (
        <TenantDetailModal key={detail.id} tenant={detail} plans={plans} onClose={() => setDetailId(undefined)}
          onRefresh={load} onDelete={startDelete} onOpenSubscription={onOpenSubscription} />
      )}
      {suspending && (
        <Modal open title={'Suspendre ' + suspending.name} size="sm" variant="flat" layer="top" panelClassName="pa-modal"
          onClose={() => { if (!updating) setSuspending(null); }}
          footer={
            <button type="button" className="pa-button pa-danger" disabled={updating}
              onClick={() => void updateAccess(suspending, 'suspend_tenant')}>Suspendre l’accès</button>
          }>
          <label className="pa-field-label">
            Motif de la suspension
            <textarea rows={3} className="pa-field" value={suspensionReason} onChange={event => setSuspensionReason(event.target.value)} />
          </label>
        </Modal>
      )}

      {/* Delete tenant confirmation modal */}
      <Modal open={!!deleting} onClose={() => { if (!deleteLoading) { setDeleting(null); setDeleteConfirmName(''); setDeleteReason(''); } }} title="Supprimer une entreprise" size="md" footer={null} variant="flat" layer="top" panelClassName="pa-modal">
        {deleting && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#FEF2F2] flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-[#DC2626]" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[var(--w-text)]">Supprimer définitivement</h3>
                <p className="text-xs text-[#DC2626]">Cette action est irréversible</p>
              </div>
            </div>

            <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-lg p-4 space-y-2">
              <p className="text-xs text-[#991B1B] font-semibold">Toutes les données suivantes seront supprimées :</p>
              <ul className="text-[11px] text-[#991B1B] space-y-1 ml-4 list-disc">
                <li>Tous les articles, catégories et compatibilités</li>
                <li>Toutes les ventes, factures, devis et avoirs</li>
                <li>Tous les clients, fournisseurs et commandes</li>
                <li>Tout le stock, mouvements et sessions de caisse</li>
                <li>La boutique en ligne et les commandes</li>
                <li>La comptabilité et les écritures</li>
                <li>Les abonnements et sauvegardes</li>
                <li>Tous les comptes utilisateurs du tenant</li>
              </ul>
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--w-text)] mb-1">Motif de la suppression</label>
              <input
                value={deleteReason}
                onChange={e => setDeleteReason(e.target.value)}
                className="w-full h-9 px-3 bg-[var(--w-surface)] border border-[var(--w-separator)] rounded-lg text-sm text-[var(--w-text)] placeholder:text-[var(--w-text-muted)] focus:outline-none focus:border-[#DC2626] focus:ring-1 focus:ring-[#DC2626]"
                placeholder="Ex: Demande du client, compte test, doublon..."
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--w-text)] mb-1">
                Tapez <span className="font-mono font-bold bg-[#FEF2F2] text-[#DC2626] px-1.5 py-0.5 rounded">{normalizeName(deleting.name)}</span> pour confirmer
              </label>
              <input
                value={deleteConfirmName}
                onChange={e => setDeleteConfirmName(e.target.value)}
                className="w-full h-9 px-3 bg-[var(--w-surface)] border border-[var(--w-separator)] rounded-lg text-sm text-[var(--w-text)] font-mono placeholder:text-[var(--w-text-muted)] focus:outline-none focus:border-[#DC2626] focus:ring-1 focus:ring-[#DC2626]"
                placeholder={normalizeName(deleting.name)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => { setDeleting(null); setDeleteConfirmName(''); setDeleteReason(''); }}
                disabled={deleteLoading}
                className="btn-icon" title="Annuler"
              ><X className="w-4 h-4" /></button>
              <button
                onClick={deleteTenant}
                disabled={normalizeName(deleteConfirmName) !== normalizeName(deleting.name) || deleteLoading}
                className="btn-icon-danger-solid" title="Supprimer définitivement"
              >
                {deleteLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

const ACTIVITY_ICONS: Record<string, any> = {
  auto_parts: Wrench_,
  alimentaire: ShoppingBag_,
  electromenager: Cpu_,
  textile: Shirt_,
  cosmetique: ShoppingBag_,
  librairie: BookOpen_,
  mercerie: Package_,
  quincaillerie: Wrench_,
  services: Layers,
  generic: Store_,
};

const MODULE_DEFS: { key: string; name: string; desc: string; icon: any; color: string }[] = [
  { key: 'dashboard', name: 'Tableau de bord', desc: 'KPIs et vue d\'ensemble', icon: Gauge, color: 'sky' },
  { key: 'pos', name: 'Caisse (POS)', desc: 'Encaissement, ventes', icon: CreditCard_, color: 'emerald' },
  { key: 'cash_history', name: 'Historique caisse', desc: 'Sessions, ouvertures/clôtures', icon: Clock, color: 'slate' },
  { key: 'vault', name: 'Coffre', desc: 'Coffre physique par point de vente', icon: Lock, color: 'slate' },
  { key: 'sales', name: 'Journal des ventes', desc: 'Liste et rapports ventes', icon: LineChart, color: 'sky' },
  { key: 'articles', name: 'Articles', desc: 'Catalogue produits', icon: Package_, color: 'amber' },
  { key: 'stock', name: 'Stock', desc: 'Inventaire, mouvements', icon: Boxes_, color: 'amber' },
  { key: 'billing', name: 'Facturation', desc: 'Devis, factures, avoirs', icon: FileText_, color: 'emerald' },
  { key: 'online_orders', name: 'Commandes en ligne', desc: 'Boutique en ligne', icon: Globe_, color: 'emerald' },
  { key: 'tiers', name: 'Tiers', desc: 'Clients & fournisseurs', icon: Users, color: 'sky' },
  { key: 'supplier_orders', name: 'Achats', desc: 'Approvisionnement', icon: ShoppingBag_, color: 'slate' },
  { key: 'accounting', name: 'Comptabilité', desc: 'Plan comptable SYSCOHADA', icon: BookOpen_, color: 'amber' },
  { key: 'reports', name: 'États / Rapports', desc: 'Statistiques et rapports', icon: BarChart3, color: 'sky' },
  { key: 'ipm', name: 'IPM / Tiers payant', desc: 'Gestion mutuelle pharmacie', icon: HeartPulse, color: 'emerald' },
  { key: 'money_transfer', name: 'Transfert d\'argent', desc: 'Gestion des transferts nationaux et internationaux', icon: ArrowRightLeft, color: 'sky' },
  { key: 'settings', name: 'Paramètres', desc: 'Configuration tenant', icon: Settings_, color: 'slate' },
];

function ModulesTab({ form, setForm, onSave, saving, usage }: any) {
  const [activityTypes, setActivityTypes] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('business_activity_types')
        .select('id, slug, name, description, legacy_business_type, is_active')
        .eq('is_active', true)
        .order('name');
      setActivityTypes(data || []);
    })();
  }, []);

  const modules: string[] = Array.isArray(form.enabled_modules) ? form.enabled_modules : [];
  const toggle = (key: string) => {
    const next = modules.includes(key) ? modules.filter(m => m !== key) : [...modules, key];
    setForm({ ...form, enabled_modules: next });
  };
  const allOn = () => setForm({ ...form, enabled_modules: MODULE_DEFS.map(m => m.key) });
  const minimal = () => setForm({ ...form, enabled_modules: ['dashboard', 'pos', 'articles', 'settings'] });
  const selectActivity = (a: any) => setForm({
    ...form,
    business_activity_type_id: a.id,
    business_type: a.legacy_business_type || a.slug,
  });

  return (
    <div className="space-y-6">
      {/* Activity type */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h4 className="text-sm font-semibold text-[var(--w-text)]">Type de commerce</h4>
            <p className="text-[11px] text-[var(--w-text-sec)] mt-0.5">Determine le catalogue maitre importable pour ce tenant.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {activityTypes.map(a => {
            const active = form.business_activity_type_id
              ? form.business_activity_type_id === a.id
              : form.business_type === (a.legacy_business_type || a.slug);
            const I = ACTIVITY_ICONS[a.slug] || ACTIVITY_ICONS[a.legacy_business_type || ''] || Store_;
            return (
              <button key={a.id} onClick={() => selectActivity(a)}
                className={`text-left p-3 rounded-lg border transition-all ${active ? 'border-[#0F172A] bg-[#0F172A] text-white' : 'border-[var(--w-separator)] bg-[var(--w-surface)] hover:border-[var(--w-text-disabled)]'}`}>
                <div className="flex items-center gap-2 mb-0.5">
                  <I className={`w-3.5 h-3.5 ${active ? 'text-white/70' : 'text-[var(--w-text-sec)]'}`} />
                  <span className="font-medium text-xs">{a.name}</span>
                </div>
                {a.description && <div className={`text-[10px] leading-snug ${active ? 'text-white/60' : 'text-[var(--w-text-muted)]'}`}>{a.description}</div>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Modules */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h4 className="text-sm font-semibold text-[var(--w-text)]">Modules accessibles</h4>
            <p className="text-[11px] text-[var(--w-text-sec)] mt-0.5">Pages visibles dans la barre laterale du tenant.</p>
          </div>
          <div className="flex gap-1.5">
            <button onClick={minimal} className="text-[11px] px-2.5 py-1 rounded-md border border-[var(--w-separator)] text-[var(--w-text-sec)] hover:bg-[var(--w-hover)] font-medium">Minimal</button>
            <button onClick={allOn} className="text-[11px] px-2.5 py-1 rounded-md bg-[#0F172A] text-white hover:bg-[#1E293B] font-medium">Tout activer</button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {MODULE_DEFS.map(m => {
            const on = modules.includes(m.key);
            const I = m.icon;
            return (
              <button key={m.key} onClick={() => toggle(m.key)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all text-left ${on ? 'border-[#0F172A] bg-[var(--w-surface-el)]' : 'border-[var(--w-separator)] bg-[var(--w-surface)] hover:border-[var(--w-text-disabled)]'}`}>
                <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${on ? 'bg-[#0F172A] text-white' : 'bg-[var(--w-hover)] text-[var(--w-text-sec)]'}`}>
                  <I className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-xs text-[var(--w-text)] truncate">{m.name}</div>
                  <div className="text-[10px] text-[var(--w-text-muted)] truncate">{m.desc}</div>
                </div>
                <div className={`shrink-0 w-8 h-4.5 rounded-full relative transition-colors ${on ? 'bg-[#0F172A]' : 'bg-[#E2E8F0]'}`}>
                  <span className={`absolute top-0.5 ${on ? 'right-0.5' : 'left-0.5'} w-3.5 h-3.5 bg-[var(--w-surface)] rounded-full shadow-sm transition-all`} />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Usage */}
      {usage && (
        <div className="rounded-lg border border-[var(--w-separator)] p-4 bg-[var(--w-surface-el)]">
          <div className="text-[11px] font-semibold text-[var(--w-text-sec)] mb-3">Usage vs limites du plan ({usage.plan_code || 'aucun'})</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <UsageBar label="Magasins" current={usage.sites_count} limit={usage.plan_limits?.sites} />
            <UsageBar label="Utilisateurs" current={usage.users_count} limit={usage.plan_limits?.users} />
            <UsageBar label="Articles" current={usage.articles_count} limit={usage.plan_limits?.articles} />
          </div>
        </div>
      )}

      <div className="flex justify-end pt-2">
        <button onClick={onSave} disabled={saving} className="btn-icon-primary" title="Enregistrer">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

function UsageBar({ label, current, limit }: { label: string; current: number; limit: number | undefined }) {
  const unlimited = limit === -1 || limit === undefined;
  const pct = unlimited ? 20 : Math.min(100, (current / Math.max(1, limit!)) * 100);
  const reached = !unlimited && current >= limit!;
  return (
    <div className="bg-[var(--w-surface)] border border-[var(--w-separator)] rounded-lg p-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-medium text-[var(--w-text-sec)]">{label}</span>
        <span className={`text-[11px] font-semibold ${reached ? 'text-[#DC2626]' : 'text-[var(--w-text)]'}`}>
          {current}{unlimited ? ' / --' : ` / ${limit}`}
        </span>
      </div>
      <div className="h-1 rounded-full bg-[var(--w-hover)] overflow-hidden">
        <div className={`h-full rounded-full ${reached ? 'bg-[#DC2626]' : 'bg-[#0F172A]'} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function TenantDetailModal({ tenant, plans, onClose, onRefresh, onDelete, onOpenSubscription, subscriptionMode = false, noticeActions }: {
  tenant: any; plans: any[]; onClose: () => void; onRefresh: () => void;
  onDelete?: (tenant: any) => void; onOpenSubscription?: (tenantId: string) => void;
  subscriptionMode?: boolean;
  noticeActions?: { busy: 'reminder' | 'email' | null; send: (kind: 'reminder' | 'email') => void };
}) {
  const [detail, setDetail] = useState<any>(null);
  const [tab, setTab] = useState<'info' | 'sub' | 'modules' | 'users' | 'history' | 'danger'>(subscriptionMode ? 'sub' : 'info');
  const [form, setForm] = useState<any>({
    ...tenant,
    plan_expires_at: tenant.plan_expires_at?.slice(0, 10) || '',
    business_type: tenant.business_type || 'auto_parts',
    business_activity_type_id: tenant.business_activity_type_id || null,
    enabled_modules: Array.isArray(tenant.enabled_modules) ? tenant.enabled_modules : ['dashboard','pos','cash_history','articles','stock','tiers','sales','billing','supplier_orders','online_orders','accounting','settings','reports'],
  });
  const [saving, setSaving] = useState(false);
  const cycle = tenant.billing_cycle || 'monthly';
  const contract = findCurrentContract(tenant, detail?.subscriptions ?? tenant.tenant_subscriptions);
  const planRate = (plan: any, cycle: string) => Number(cycle === 'yearly' ? plan?.price_yearly
    : cycle === 'lifetime' ? plan?.price_lifetime : plan?.price_monthly) || 0;
  const offeredRate = (planCode: string, billingCycle: string) => {
    if (planCode === tenant.plan && billingCycle === cycle && contract?.amount != null) return Number(contract.amount);
    return planRate(plans.find(plan => plan.code === planCode), billingCycle);
  };
  const [subForm, setSubForm] = useState<any>(() => ({
    plan_code: tenant.plan, billing_cycle: cycle, auto_renew: tenant.auto_renew !== false,
    started_at: new Date().toISOString().slice(0, 10), ends_at: '',
  }));
  const [activationLock, setActivationLock] = useState<boolean | null>(null);
  const [activationLoading, setActivationLoading] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [decisionReason, setDecisionReason] = useState('');
  const [cancelling, setCancelling] = useState<string>();
  const [cancellationReason, setCancellationReason] = useState('');
  const { success, error } = useToast();
  const registrationPending = tenant.approval_status === 'pending';
  const detailPlanCode = registrationPending ? tenant.selected_plan_code || tenant.plan : tenant.plan;
  const detailStatus = (tenant.subscription_status === 'trial_active' ? 'trial'
    : companyStatus(tenant) === 'suspended' ? 'suspended' : tenant.subscription_status || 'none') as SubscriptionFilter;

  const decideRegistration = async (action: 'approve_tenant' | 'reject_tenant') => {
    setSaving(true);
    try {
      await call(action, { tenant_id: tenant.id, ...(action === 'reject_tenant' ? { reason: decisionReason } : {}) });
      success(action === 'approve_tenant' ? 'Inscription approuvée' : 'Inscription rejetée');
      onRefresh();
      onClose();
    } catch (cause) { error((cause as Error).message); }
    finally { setSaving(false); }
  };

  const loadActivation = async () => {
    const { data } = await supabase.from('_br_tenant_activation').select('enabled').eq('tenant_id', tenant.id).maybeSingle();
    setActivationLock(data?.enabled ?? false);
  };

  const toggleActivation = async () => {
    setActivationLoading(true);
    const now = new Date().toISOString();
    const newVal = !activationLock;
    const { error: e } = await supabase.from('_br_tenant_activation').upsert({
      tenant_id: tenant.id,
      enabled: newVal,
      enabled_at: newVal ? now : null,
      disabled_at: newVal ? null : now,
    }, { onConflict: 'tenant_id' });
    setActivationLoading(false);
    if (e) { error(e.message); return; }
    setActivationLock(newVal);
    success(newVal ? 'Opérations backup/restore activées' : 'Opérations backup/restore verrouillées');
  };

  useEffect(() => {
    (async () => {
      try { setDetail(await call('tenant_detail', { tenant_id: tenant.id })); }
      catch (e: any) { error(e.message); }
    })();
    if (!subscriptionMode) void loadActivation();
  }, [tenant.id]);

  const saveInfo = async () => {
    setSaving(true);
    try {
      await call('update_tenant', {
        tenant_id: tenant.id,
        patch: {
          name: form.name, legal_name: form.legal_name, email: form.email, phone: form.phone, whatsapp_phone: form.whatsapp_phone,
          status: form.status, is_active: form.is_active,
          business_type: form.business_type,
          business_activity_type_id: form.business_activity_type_id || null,
          enabled_modules: form.enabled_modules,
          subdomain: form.subdomain || null,
          custom_domain: form.custom_domain || null,
        },
      });
      success('Tenant mis à jour');
      onRefresh();
    } catch (e: any) { error(e.message); }
    setSaving(false);
  };

  const applyPlan = async () => {
    const amount = Number(subForm.amount ?? offeredRate(subForm.plan_code, subForm.billing_cycle));
    setSaving(true);
    try {
      const customLimits = subForm.custom_limits ?? (subForm.plan_code === tenant.plan ? contract?.custom_limits : null) ?? {};
      const cleanCustom: Record<string, number> = {};
      for (const [k, v] of Object.entries(customLimits)) {
        if (v !== undefined && v !== null && v !== '') cleanCustom[k] = Number(v);
      }
      await call('create_subscription', {
        tenant_id: tenant.id,
        plan_code: subForm.plan_code,
        billing_cycle: subForm.billing_cycle,
        amount,
        started_at: new Date(subForm.started_at).toISOString(),
        ends_at: subForm.ends_at ? new Date(subForm.ends_at).toISOString() : null,
        auto_renew: subForm.auto_renew,
        notes: subForm.notes || '',
        custom_limits: Object.keys(cleanCustom).length > 0 ? cleanCustom : null,
      });
      success('Abonnement appliqué');
      onRefresh();
      const d = await call('tenant_detail', { tenant_id: tenant.id });
      setDetail(d);
    } catch (e: any) { error(e.message); }
    finally { setSaving(false); }
  };

  const cancelSub = async (id: string) => {
    setSaving(true);
    try {
      await call('cancel_subscription', { subscription_id: id, reason: cancellationReason });
      success('Abonnement annulé');
      setCancelling(undefined);
      const d = await call('tenant_detail', { tenant_id: tenant.id });
      setDetail(d);
      onRefresh();
    } catch (e: any) { error(e.message); }
    finally { setSaving(false); }
  };

  const tabs: { k: typeof tab; l: string }[] = [
    { k: 'info', l: 'Résumé' },
    { k: 'modules', l: 'Modules' },
    { k: 'users', l: 'Utilisateurs' },
    { k: 'history', l: 'Historique' },
    { k: 'danger', l: 'Accès et sécurité' },
  ];

  return (
    <Modal open onClose={onClose} title={tenant.name} size="lg" footer={null} fullMobile variant="flat" layer="top" panelClassName="pa-modal">
      <div className="pa-page">
        {!subscriptionMode && (
          <>
            <div className="pa-section-head text-sm">
              <span className="pa-muted pa-break">{tenant.email || '—'}</span>
              <button type="button" className="pa-link" onClick={() => onOpenSubscription?.(tenant.id)}>Gérer l’abonnement <ArrowUpRight size={14} /></button>
            </div>
            <nav className="pa-tabs" aria-label="Fiche de l’entreprise">
              {tabs.map(item => <button type="button" key={item.k} aria-current={tab === item.k ? 'page' : undefined} onClick={() => setTab(item.k)}>{item.l}</button>)}
            </nav>
          </>
        )}
        <div>
          {!detail ? <PlatformLoading /> : (
            <>
          {tab === 'info' && (
                <div className="bg-[var(--w-surface)] border border-[var(--w-separator)] rounded-xl p-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-medium text-[var(--w-text-sec)] mb-1">Nom</label>
                      <input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full h-9 px-3 bg-[var(--w-surface)] border border-[var(--w-separator)] rounded-lg text-sm text-[var(--w-text)] focus:outline-none focus:border-[var(--w-text)] focus:ring-1 focus:ring-[var(--w-text)]" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[var(--w-text-sec)] mb-1">Raison sociale</label>
                      <input value={form.legal_name || ''} onChange={e => setForm({ ...form, legal_name: e.target.value })} className="w-full h-9 px-3 bg-[var(--w-surface)] border border-[var(--w-separator)] rounded-lg text-sm text-[var(--w-text)] focus:outline-none focus:border-[var(--w-text)] focus:ring-1 focus:ring-[var(--w-text)]" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[var(--w-text-sec)] mb-1">Email</label>
                      <input value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} className="w-full h-9 px-3 bg-[var(--w-surface)] border border-[var(--w-separator)] rounded-lg text-sm text-[var(--w-text)] focus:outline-none focus:border-[var(--w-text)] focus:ring-1 focus:ring-[var(--w-text)]" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[var(--w-text-sec)] mb-1">Téléphone</label>
                      <input value={form.phone || ''} onChange={e => setForm({ ...form, phone: e.target.value })} className="w-full h-9 px-3 bg-[var(--w-surface)] border border-[var(--w-separator)] rounded-lg text-sm text-[var(--w-text)] focus:outline-none focus:border-[var(--w-text)] focus:ring-1 focus:ring-[var(--w-text)]" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[var(--w-text-sec)] mb-1">WhatsApp</label>
                      <input value={form.whatsapp_phone || ''} onChange={e => setForm({ ...form, whatsapp_phone: e.target.value })} className="w-full h-9 px-3 bg-[var(--w-surface)] border border-[var(--w-separator)] rounded-lg text-sm text-[var(--w-text)] focus:outline-none focus:border-[var(--w-text)] focus:ring-1 focus:ring-[var(--w-text)]" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[var(--w-text-sec)] mb-1">Statut</label>
                      <select value={form.status || 'active'} onChange={e => setForm({ ...form, status: e.target.value })} className="w-full h-9 px-3 bg-[var(--w-surface)] border border-[var(--w-separator)] rounded-lg text-sm text-[var(--w-text)] focus:outline-none focus:border-[var(--w-text)] focus:ring-1 focus:ring-[var(--w-text)]">
                        <option value="active">Actif</option><option value="suspended">Suspendu</option><option value="cancelled">Annulé</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[var(--w-text-sec)] mb-1">Sous-domaine</label>
                      <div className="flex items-center gap-1.5">
                        <input value={form.subdomain || ''} onChange={e => setForm({ ...form, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} placeholder="nom" className="flex-1 h-9 px-3 bg-[var(--w-surface)] border border-[var(--w-separator)] rounded-lg text-sm text-[var(--w-text)] focus:outline-none focus:border-[var(--w-text)] focus:ring-1 focus:ring-[var(--w-text)]" />
                        <span className="text-[11px] text-[var(--w-text-muted)]">.votreapp.com</span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[var(--w-text-sec)] mb-1">Domaine personnalisé</label>
                      <input value={form.custom_domain || ''} onChange={e => setForm({ ...form, custom_domain: e.target.value.toLowerCase().trim() })} placeholder="caisse.domain.sn" className="w-full h-9 px-3 bg-[var(--w-surface)] border border-[var(--w-separator)] rounded-lg text-sm text-[var(--w-text)] focus:outline-none focus:border-[var(--w-text)] focus:ring-1 focus:ring-[var(--w-text)]" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="flex items-center gap-2 text-xs text-[var(--w-text)] cursor-pointer">
                        <input type="checkbox" checked={form.is_active !== false} onChange={e => setForm({ ...form, is_active: e.target.checked })} className="rounded border-[var(--w-separator)]" />
                        Tenant actif (accès à l'application)
                      </label>
                    </div>
                    <div className="sm:col-span-2 flex justify-end pt-2">
                      <button onClick={saveInfo} disabled={saving} className="btn-icon-primary" title="Enregistrer">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {tab === 'sub' && (
                <div className="pa-page">
                  <dl className="pa-detail-list">
                    <div><dt>Offre</dt><dd>{plans.find(plan => plan.code === detailPlanCode)?.name || detailPlanCode || '—'}</dd></div>
                    <div><dt>Statut</dt><dd>{registrationPending ? 'Inscription à valider' : subscriptionStatuses[detailStatus] || '—'}</dd></div>
                    {!registrationPending && contract?.amount != null && (
                      <div><dt>Tarif {cycle === 'monthly' ? 'mensuel' : cycle === 'yearly' ? 'annuel' : 'contractuel'}</dt><dd>{formatFCFA(Number(contract.amount))}</dd></div>
                    )}
                    <div><dt>Échéance</dt><dd>{tenant.plan_expires_at ? formatDate(tenant.plan_expires_at) : tenant.billing_cycle === 'lifetime' ? 'À vie' : '—'}</dd></div>
                    <div><dt>Contact</dt><dd>{tenant.email || tenant.whatsapp_phone || tenant.phone || '—'}</dd></div>
                  </dl>

                  {registrationPending && (
                    <section className="pa-panel space-y-3">
                      <h4 className="pa-heading">Valider l’inscription</h4>
                      <dl className="pa-detail-list">
                        <div><dt>Inscrite le</dt><dd>{formatDate(tenant.created_at)}</dd></div>
                        {tenant.city && <div><dt>Ville</dt><dd>{tenant.city}</dd></div>}
                        {tenant.responsible_name && <div><dt>Responsable</dt><dd>{tenant.responsible_name}</dd></div>}
                        {tenant.whatsapp_phone && <div><dt>WhatsApp</dt><dd>{tenant.whatsapp_phone}</dd></div>}
                        {tenant.first_payment?.state === 'paid' && <div><dt>Premier règlement</dt><dd>Payé · {formatFCFA(tenant.first_payment.amount)}</dd></div>}
                        {['creating', 'pending'].includes(tenant.first_payment?.state) && <div><dt>Premier règlement</dt><dd>En attente</dd></div>}
                      </dl>
                      {rejecting ? (
                        <form className="space-y-2" onSubmit={event => { event.preventDefault(); void decideRegistration('reject_tenant'); }}>
                          <label className="pa-field-label">
                            Motif du rejet
                            <textarea className="pa-field" rows={2} value={decisionReason} onChange={event => setDecisionReason(event.target.value)} />
                          </label>
                          <div className="pa-inline">
                            <button type="submit" className="pa-button pa-danger" disabled={saving}>Confirmer le rejet</button>
                            <button type="button" className="pa-link" disabled={saving} onClick={() => setRejecting(false)}>Annuler</button>
                          </div>
                        </form>
                      ) : (
                        <div className="pa-inline">
                          <button type="button" className="pa-button" data-variant="primary" disabled={saving} onClick={() => void decideRegistration('approve_tenant')}>
                            <Check size={15} /> Approuver l’inscription
                          </button>
                          <button type="button" className="pa-link pa-danger" disabled={saving} onClick={() => { setDecisionReason(''); setRejecting(true); }}>Rejeter</button>
                        </div>
                      )}
                    </section>
                  )}

                  {noticeActions && (
                    <section className="pa-panel space-y-2">
                      <h4 className="pa-heading">Rappels d’échéance</h4>
                      <div className="pa-inline">
                        <button type="button" className="pa-button" disabled={!!noticeActions.busy} onClick={() => noticeActions.send('reminder')}>
                          {noticeActions.busy === 'reminder' ? <Loader2 size={15} className="animate-spin" /> : <Bell size={15} />} Rappeler dans Waarwi
                        </button>
                        <button type="button" className="pa-link" disabled={!!noticeActions.busy} onClick={() => noticeActions.send('email')}>
                          {noticeActions.busy === 'email' ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />} Envoyer une alerte par e-mail
                        </button>
                      </div>
                    </section>
                  )}

                  {!registrationPending && tenant.approval_status !== 'rejected' && (
                    <details className="pa-panel">
                      <summary className="pa-heading cursor-pointer">{detail.subscriptions?.length ? 'Enregistrer un renouvellement' : 'Enregistrer un abonnement'}</summary>
                      <form className="mt-3 space-y-4" onSubmit={event => { event.preventDefault(); void applyPlan(); }}>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3">
                          <label className="pa-field-label">Offre
                            <select className="pa-field" value={subForm.plan_code} required
                              onChange={event => setSubForm({ ...subForm, plan_code: event.target.value, amount: undefined, custom_limits: undefined })}>
                              <option value="">Choisir l’offre</option>
                              {plans.map(plan => <option key={plan.code} value={plan.code}>{plan.name}{plan.is_public === false ? ' · privée' : ''}</option>)}
                            </select>
                          </label>
                          <label className="pa-field-label">Cycle
                            <select className="pa-field" value={subForm.billing_cycle}
                              onChange={event => {
                                const cycle = event.target.value;
                                setSubForm({ ...subForm, billing_cycle: cycle, amount: undefined, ends_at: cycle === 'lifetime' ? '' : subForm.ends_at });
                              }}>
                              <option value="monthly">Mensuel</option><option value="yearly">Annuel</option><option value="lifetime">À vie</option>
                            </select>
                          </label>
                          <label className="pa-field-label">Tarif de l’abonnement (FCFA)
                            <input className="pa-field" type="number" min={0} required value={subForm.amount ?? offeredRate(subForm.plan_code, subForm.billing_cycle)}
                              onChange={event => setSubForm({ ...subForm, amount: event.target.value })} />
                          </label>
                          <label className="pa-field-label">Début
                            <input className="pa-field" type="date" required value={subForm.started_at}
                              onChange={event => setSubForm({ ...subForm, started_at: event.target.value })} />
                          </label>
                          {subForm.billing_cycle !== 'lifetime' && <label className="pa-field-label">Fin
                            <input className="pa-field" type="date" value={subForm.ends_at} min={subForm.started_at || undefined}
                              onChange={event => setSubForm({ ...subForm, ends_at: event.target.value })} />
                          </label>}
                          <label className="pa-field-label">Notes
                            <input className="pa-field" value={subForm.notes || ''} placeholder="Référence de facture ou conditions"
                              onChange={event => setSubForm({ ...subForm, notes: event.target.value })} />
                          </label>
                          <label className="pa-inline text-sm sm:col-span-2">
                            <input type="checkbox" checked={!tenant.subscription_billing_online && subForm.auto_renew} disabled={tenant.subscription_billing_online || subForm.billing_cycle === 'lifetime'}
                              onChange={event => setSubForm({ ...subForm, auto_renew: event.target.checked })} />
                            Renouvellement automatique
                          </label>
                        </div>
                        <details>
                          <summary className="text-sm font-medium cursor-pointer">Limites personnalisées</summary>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
                            {([['articles', 'Articles'], ['sites', 'Magasins'], ['users', 'Utilisateurs']] as const).map(([key, label]) => (
                              <label key={key} className="pa-field-label">{label}
                                <input type="number" className="pa-field" placeholder="Limite de l’offre"
                                  value={(subForm.custom_limits ?? (subForm.plan_code === tenant.plan ? contract?.custom_limits : null))?.[key] ?? ''}
                                  onChange={event => {
                                    const limits = subForm.custom_limits ?? (subForm.plan_code === tenant.plan ? contract?.custom_limits : null);
                                    setSubForm({ ...subForm, custom_limits: { ...limits, [key]: event.target.value === '' ? undefined : Number(event.target.value) } });
                                  }} />
                              </label>
                            ))}
                          </div>
                        </details>
                        <button type="submit" className="pa-button" data-variant="primary" disabled={saving}>Enregistrer l’abonnement</button>
                      </form>
                    </details>
                  )}

                  <section className="space-y-2">
                    <h4 className="pa-heading">Historique des abonnements</h4>
                    <div className="pa-divided">
                      {(detail.subscriptions || []).map((entry: any) => (
                        <div className="py-2 space-y-2" key={entry.id}>
                          <div className="pa-section-head text-sm">
                            <div className="min-w-0">
                              <p className="font-medium">{plans.find(plan => plan.code === entry.plan_code)?.name || entry.plan_code} · {formatFCFA(entry.amount)}</p>
                              <p className="pa-row-subtitle">{formatDate(entry.started_at)}{entry.ends_at ? ' – ' + formatDate(entry.ends_at) : ''}</p>
                            </div>
                            <div className="pa-inline">
                              <span className="pa-status">{subscriptionStatuses[entry.status as SubscriptionFilter] || entry.status}</span>
                              {entry.status === 'active' && <button type="button" className="pa-link pa-danger" disabled={saving}
                                onClick={() => { setCancellationReason(''); setCancelling(entry.id); }}>Annuler</button>}
                            </div>
                          </div>
                          {cancelling === entry.id && (
                            <form className="space-y-2" onSubmit={event => { event.preventDefault(); void cancelSub(entry.id); }}>
                              <label className="pa-field-label">Motif de l’annulation
                                <input className="pa-field" value={cancellationReason} onChange={event => setCancellationReason(event.target.value)} />
                              </label>
                              <div className="pa-inline">
                                <button type="submit" className="pa-button pa-danger" disabled={saving}>Confirmer l’annulation</button>
                                <button type="button" className="pa-link" disabled={saving} onClick={() => setCancelling(undefined)}>Revenir</button>
                              </div>
                            </form>
                          )}
                        </div>
                      ))}
                      {!detail.subscriptions?.length && <p className="pa-empty">Aucun abonnement enregistré.</p>}
                    </div>
                  </section>
                </div>
              )}

              {tab === 'modules' && (
                <ModulesTab form={form} setForm={setForm} onSave={saveInfo} saving={saving} usage={detail.usage} />
              )}

              {tab === 'users' && (
                <div className="bg-[var(--w-surface)] border border-[var(--w-separator)] rounded-xl divide-y divide-[#F1F5F9]">
                  {(detail.users || []).length === 0 ? (
                    <div className="py-10 text-center">
                      <Users className="w-8 h-8 text-[var(--w-text-disabled)] mx-auto mb-2" />
                      <p className="text-xs text-[var(--w-text-muted)]">Aucun utilisateur.</p>
                    </div>
                  ) : (detail.users || []).map((u: any) => (
                    <div key={u.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="w-8 h-8 rounded-md bg-[var(--w-hover)] text-[var(--w-text)] font-semibold text-xs flex items-center justify-center shrink-0">
                        {(u.full_name || u.email).charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-[var(--w-text)] truncate">{u.full_name || u.email}</div>
                        <div className="text-[11px] text-[var(--w-text-sec)] truncate">{u.email}</div>
                      </div>
                      <span className="text-[10px] font-medium text-[var(--w-text-sec)] bg-[var(--w-surface-el)] border border-[var(--w-separator)] px-2 py-0.5 rounded">{u.role}</span>
                      {!u.is_active && <span className="text-[10px] bg-[#FEF2F2] text-[#DC2626] px-1.5 py-0.5 rounded font-medium">Inactif</span>}
                    </div>
                  ))}
                </div>
              )}

              {tab === 'history' && (
                <div className="bg-[var(--w-surface)] border border-[var(--w-separator)] rounded-xl p-4">
                  {(detail.events || []).length === 0 ? (
                    <div className="py-10 text-center">
                      <Activity className="w-8 h-8 text-[var(--w-text-disabled)] mx-auto mb-2" />
                      <p className="text-xs text-[var(--w-text-muted)]">Aucun historique disponible pour ce tenant.</p>
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {(detail.events || []).map((ev: any) => <EventRow key={ev.id} ev={ev} />)}
                    </div>
                  )}
                </div>
              )}

              {tab === 'danger' && (
                <div className="space-y-4">
                  <div className="bg-[var(--w-surface)] border border-[#FECACA] rounded-xl p-5">
                    <div className="flex items-start gap-3 mb-4">
                      <div className="w-9 h-9 rounded-lg bg-[#FEF2F2] flex items-center justify-center shrink-0">
                        <AlertTriangle className="w-4.5 h-4.5 text-[#DC2626]" />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-[var(--w-text)]">Zone de danger</h4>
                        <p className="text-[11px] text-[var(--w-text-sec)] mt-0.5">Ces actions peuvent affecter l'acces du tenant ou supprimer definitivement ses donnees.</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {/* Activation lock for backup/restore */}
                      <div className="flex items-center justify-between py-3 border-t border-[var(--w-hover)]">
                        <div>
                          <div className="text-xs font-medium text-[var(--w-text)]">Verrou sauvegarde / restauration</div>
                          <div className="text-[11px] text-[var(--w-text-sec)]">Autorise les opérations destructrices (restauration, réinitialisation, import) pour ce tenant.</div>
                        </div>
                        <button
                          onClick={toggleActivation}
                          disabled={activationLoading || activationLock === null}
                          className="shrink-0 relative"
                        >
                          <div className={`w-9 h-5 rounded-full transition-colors relative ${activationLock ? 'bg-[#16A34A]' : 'bg-[#D1D5DB]'}`}>
                            <div className={`absolute top-0.5 bg-[var(--w-surface)] rounded-full h-4 w-4 transition-transform shadow-sm ${activationLock ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                          </div>
                        </button>
                      </div>

                      {/* Suspend / Reactivate */}
                      <div className="flex items-center justify-between py-3 border-t border-[var(--w-hover)]">
                        <div>
                          <div className="text-xs font-medium text-[var(--w-text)]">{tenant.is_active ? 'Suspendre le tenant' : 'Réactiver le tenant'}</div>
                          <div className="text-[11px] text-[var(--w-text-sec)]">{tenant.is_active ? 'Bloque l\'acces a l\'application pour tous les utilisateurs.' : 'Restaure l\'acces a l\'application.'}</div>
                        </div>
                        {tenant.is_active ? (
                          <button
                            onClick={() => { const reason = prompt('Raison de la suspension ?') || ''; if (reason || confirm('Suspendre sans motif ?')) { call('suspend_tenant', { tenant_id: tenant.id, reason }).then(() => { onRefresh(); onClose(); }); } }}
                            className="h-8 px-3 rounded-md border border-[#FDE68A] bg-[#FFFBEB] text-[#D97706] text-xs font-medium hover:bg-[#FEF3C7] transition-colors flex items-center gap-1.5"
                          ><Pause className="w-3.5 h-3.5" />Suspendre</button>
                        ) : (
                          <button
                            onClick={() => { call('reactivate_tenant', { tenant_id: tenant.id }).then(() => { onRefresh(); onClose(); }); }}
                            className="h-8 px-3 rounded-md border border-[#BBF7D0] bg-[#F0FDF4] text-[#16A34A] text-xs font-medium hover:bg-[#DCFCE7] transition-colors flex items-center gap-1.5"
                          ><Power className="w-3.5 h-3.5" />Réactiver</button>
                        )}
                      </div>

                      {/* Delete */}
                      {onDelete && (
                        <div className="flex items-center justify-between py-3 border-t border-[#FECACA]">
                          <div>
                            <div className="text-xs font-medium text-[#DC2626]">Supprimer definitivement</div>
                            <div className="text-[11px] text-[var(--w-text-sec)]">Supprime toutes les donnees du tenant de maniere irreversible.</div>
                          </div>
                          <button
                            onClick={() => { onClose(); setTimeout(() => onDelete(tenant), 150); }}
                            className="btn-icon-danger"
                            title="Supprimer"
                          ><Trash2 className="w-4 h-4" /></button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ============== PLANS ============== */
const prepaidPeriods = [3, 6, 12] as const;
const discountField = (months: typeof prepaidPeriods[number]) => 'discount_percent_' + months + '_months';

function PlansSection() {
  const [plans, setPlans] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<any>(null);
  const { success, error } = useToast();

  const load = async () => {
    try {
      const [offerData, companyData] = await Promise.all([call('list_plans'), call('list_tenants')]);
      setPlans(offerData.plans || []);
      setTenants(companyData.tenants || []);
    } catch (cause) { error((cause as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const openOffer = (plan?: any) => {
    setEditing(!!plan);
    setForm(plan ? { ...plan, features: Array.isArray(plan.features) ? plan.features.join('\n') : plan.features || '' } : {
      code: '', name: '', features: '', is_public: true, sort_order: plans.length,
      limits: { articles: -1, sites: 1, users: 2, max_clients: -1, max_suppliers: -1, max_invoices_month: -1, monthly_sales: -1,
        online_shop: false, accounting: false, supplier_orders: false, has_whatsapp: false, has_multi_store: false, has_advanced_reports: false, has_accounting_export: false },
    });
  };

  const save = async () => {
    if (!form || saving) return;
    if (!String(form.code).trim() || !String(form.name).trim()) { error('Code et nom requis'); return; }
    const discounts = Object.fromEntries(prepaidPeriods.map(months => [discountField(months), Number(form[discountField(months)] || 0)]));
    if (Object.values(discounts).some(value => !Number.isFinite(value) || value < 0 || value > 99.99)) {
      error('Saisis des remises comprises entre 0 et 99,99 %.');
      return;
    }
    const limits = Object.fromEntries(Object.entries(form.limits || {}).map(([key, value]) => [
      key, typeof value === 'boolean' ? value : value === '' || value == null ? -1 : Number(value),
    ]));
    setSaving(true);
    try {
      await call('upsert_plan', {
        plan: {
          code: String(form.code).trim(), name: String(form.name).trim(), description: form.description || '',
          price_monthly: Number(form.price_monthly) || 0, price_yearly: Number(form.price_yearly) || 0,
          price_lifetime: form.price_lifetime == null || form.price_lifetime === '' ? null : Number(form.price_lifetime),
          currency: form.currency || 'FCFA',
          features: String(form.features || '').split('\n').map(line => line.trim()).filter(Boolean),
          limits, is_public: form.is_public !== false, sort_order: Number(form.sort_order) || 0,
          ...discounts,
        },
      });
      success('Offre enregistrée');
      setForm(null);
      await load();
    } catch (cause) { error((cause as Error).message); }
    finally { setSaving(false); }
  };

  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const company of tenants) counts.set(company.plan, (counts.get(company.plan) ?? 0) + 1);
    return counts;
  }, [tenants]);
  const limits = [['articles', 'Articles'], ['sites', 'Magasins'], ['users', 'Utilisateurs'], ['max_clients', 'Clients'],
    ['max_suppliers', 'Fournisseurs'], ['max_invoices_month', 'Factures par mois'], ['monthly_sales', 'Ventes par mois']] as const;
  const features = [['online_shop', 'Boutique en ligne'], ['accounting', 'Comptabilité'], ['supplier_orders', 'Achats'],
    ['has_whatsapp', 'Notifications WhatsApp'], ['has_multi_store', 'Multi-magasins'], ['has_advanced_reports', 'Rapports avancés'],
    ['has_accounting_export', 'Export comptable']] as const;

  return (
    <div className="pa-page">
      <div className="pa-section-head">
        <span className="pa-muted text-sm">{plans.length} offre{plans.length !== 1 ? 's' : ''}</span>
        <button type="button" className="pa-button" data-variant="primary" onClick={() => openOffer()}><Plus size={16} /> Nouvelle offre</button>
      </div>
      {loading ? <PlatformLoading /> : plans.length === 0 ? <p className="pa-empty">Aucune offre disponible.</p> : (
        <div className="pa-table pa-offers-list" role="table" aria-label="Offres et tarifs">
          <div className="pa-list-head" role="row">
            {['Offre', 'Mensuel', 'Annuel', 'Remises prépayées', 'Visibilité', 'Actions'].map(label => <span role="columnheader" key={label}>{label}</span>)}
          </div>
          {plans.map(plan => {
            const companies = usage.get(plan.code) ?? 0;
            return (
              <div className="pa-list-row" role="row" key={plan.code}>
                <div role="cell" className="pa-row-title">
                  <button type="button" className="pa-name-button" onClick={() => openOffer(plan)}>{plan.name}</button>
                  <div className="pa-row-subtitle">{plan.code} · {companies} entreprise{companies !== 1 ? 's' : ''}</div>
                </div>
                <div role="cell" className="pa-row-amount">{formatFCFA(plan.price_monthly)} <span className="pa-mobile-meta pa-muted">/ mois</span></div>
                <div role="cell" className="pa-row-date">{formatFCFA(plan.price_yearly)} <span className="pa-mobile-meta pa-muted">/ an</span></div>
                <div role="cell" className="pa-row-plan pa-muted">
                  {prepaidPeriods.filter(months => Number(plan[discountField(months)]) > 0)
                    .map(months => months + ' m −' + formatSubscriptionDiscount(Number(plan[discountField(months)]))).join(' · ') || '—'}
                </div>
                <div role="cell" className="pa-row-status pa-status">{plan.is_public === false ? 'Privée' : 'Publique'}</div>
                <div role="cell" className="pa-row-actions">
                  <button type="button" className="pa-link" aria-label={'Modifier ' + plan.name} onClick={() => openOffer(plan)}>Modifier <ArrowUpRight size={13} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {form && (
        <Modal open onClose={() => { if (!saving) setForm(null); }} title={editing ? 'Modifier l’offre' : 'Nouvelle offre'}
          variant="flat" layer="top" panelClassName="pa-modal" size="lg" fullMobile
          footer={<>
            {editing && <button type="button" className="pa-link pa-danger mr-auto" disabled={saving} onClick={() => {
              setToDelete({ code: form.code, name: form.name });
              setForm(null);
            }}>Supprimer l’offre</button>}
            <button type="button" className="pa-link" disabled={saving} onClick={() => setForm(null)}>Annuler</button>
            <button type="submit" form="platform-offer-form" className="pa-button" data-variant="primary" disabled={saving}>Enregistrer l’offre</button>
          </>}>
          <form id="platform-offer-form" className="pa-page" onSubmit={event => { event.preventDefault(); void save(); }}>
            <div className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2">
              <label className="pa-field-label">Code de l’offre
                <input className="pa-field" required readOnly={editing} value={form.code}
                  onChange={event => setForm({ ...form, code: event.target.value })} />
              </label>
              <label className="pa-field-label">Nom
                <input className="pa-field" required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} />
              </label>
              <label className="pa-field-label sm:col-span-2">Description
                <input className="pa-field" value={form.description || ''} onChange={event => setForm({ ...form, description: event.target.value })} />
              </label>
            </div>

            <section className="pa-panel space-y-3">
              <h4 className="pa-heading">Tarifs</h4>
              <div className="grid gap-x-5 gap-y-3 sm:grid-cols-3">
                {([['price_monthly', 'Mensuel (FCFA)'], ['price_yearly', 'Annuel (FCFA)'], ['price_lifetime', 'À vie (FCFA)']] as const).map(([key, label]) => (
                  <label key={key} className="pa-field-label">{label}
                    <input className="pa-field" type="number" min={0} step="1" value={form[key] ?? ''}
                      onChange={event => setForm({ ...form, [key]: event.target.value })} />
                  </label>
                ))}
              </div>
            </section>

            <section className="pa-panel space-y-3">
              <h4 className="pa-heading">Remises sur le paiement d’avance</h4>
              <div className="grid gap-x-5 gap-y-3 sm:grid-cols-3">
                {prepaidPeriods.map(months => {
                  const key = discountField(months);
                  const rate = Math.round(Number(form[key] || 0) * 100);
                  const quote = Math.round(Number(form.price_monthly || 0) * months * (10000 - rate) / 10000);
                  return (
                    <div key={months}>
                      <label className="pa-field-label">Remise {months} mois (%)
                        <input className="pa-field" type="number" min={0} max={99.99} step={0.01}
                          value={form[key] ?? 0} onChange={event => setForm({ ...form, [key]: event.target.value })} />
                      </label>
                      <p className="pa-row-subtitle mt-1">{formatFCFA(quote)} au tarif de l’offre</p>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="pa-panel grid gap-3 sm:grid-cols-2">
              <label className="pa-inline text-sm">
                <input type="checkbox" checked={form.is_public !== false}
                  onChange={event => setForm({ ...form, is_public: event.target.checked })} />
                Visible à l’inscription
              </label>
              <label className="pa-field-label">Ordre d’affichage
                <input className="pa-field" type="number" value={form.sort_order ?? 0}
                  onChange={event => setForm({ ...form, sort_order: event.target.value })} />
              </label>
            </section>

            <details className="pa-panel">
              <summary className="pa-heading cursor-pointer">Limites et modules</summary>
              <p className="pa-row-subtitle mt-2">Saisir −1 pour une limite illimitée.</p>
              <div className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3 mt-3">
                {limits.map(([key, label]) => (
                  <label className="pa-field-label" key={key}>{label}
                    <input className="pa-field" type="number" min={-1} placeholder="-1" value={form.limits?.[key] ?? ''}
                      onChange={event => setForm({ ...form, limits: { ...form.limits, [key]: event.target.value } })} />
                  </label>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 mt-4">
                {features.map(([key, label]) => (
                  <label key={key} className="pa-inline text-sm">
                    <input type="checkbox" checked={!!form.limits?.[key]}
                      onChange={event => setForm({ ...form, limits: { ...form.limits, [key]: event.target.checked } })} />
                    {label}
                  </label>
                ))}
              </div>
            </details>

            <label className="pa-field-label">Fonctionnalités affichées, une par ligne
              <textarea className="pa-field" rows={3} value={form.features} onChange={event => setForm({ ...form, features: event.target.value })} />
            </label>
          </form>
        </Modal>
      )}

      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          try { await call('delete_plan', { code: toDelete.code }); success('Offre supprimée'); setToDelete(null); await load(); }
          catch (cause) { error((cause as Error).message); }
        }}
        title="Supprimer cette offre ?" message={'L’offre « ' + toDelete?.name + ' » sera supprimée.'} danger />
    </div>
  );
}

const subscriptionStatuses: Record<SubscriptionFilter, string> = {
  all: 'Tous les statuts',
  pending: 'Inscription à valider',
  due: 'Échéance proche',
  expired: 'Expiré',
  active: 'Actif',
  trial: 'En essai',
  suspended: 'Suspendu',
  rejected: 'Inscription rejetée',
  cancelled: 'Annulé',
  completed: 'Terminé',
  none: 'Sans abonnement',
};

const billingCycles: Record<string, string> = { monthly: 'Mensuel', yearly: 'Annuel', lifetime: 'À vie', trial: 'Essai' };

type Contract = {
  plan_code: string; billing_cycle: string; status: string; amount: number | string | null;
  started_at: string; ends_at: string | null; created_at?: string;
  custom_limits?: Record<string, number>;
};

function findCurrentContract(tenant: { plan: string; billing_cycle?: string; plan_expires_at?: string }, subscriptions: Contract[] = []) {
  return subscriptions.filter(item => item.plan_code === tenant.plan
    && item.billing_cycle === (tenant.billing_cycle || 'monthly')
    && (item.ends_at ?? null) === (tenant.plan_expires_at ?? null)
    && ['active', 'pending', 'expired', 'cancelled'].includes(item.status))
    .sort((a, b) => (b.created_at || b.started_at || '').localeCompare(a.created_at || a.started_at || ''))[0];
}

function SubscriptionsSection({ initialFilter, focusTenantId, onFocusConsumed }: {
  initialFilter: SubscriptionFilter;
  focusTenantId?: string;
  onFocusConsumed: () => void;
}) {
  const [tenants, setTenants] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expiring, setExpiring] = useState<any[]>([]);
  const [reminderDays, setReminderDays] = useState(7);
  const [dueLoading, setDueLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sending, setSending] = useState<'reminder' | 'email' | null>(null);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<SubscriptionFilter>(initialFilter);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string>();
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rules, setRules] = useState<{ enabled: boolean; days: number } | null>(null);
  const [rulesBusy, setRulesBusy] = useState<'save' | 'run' | null>(null);
  const [lastResult, setLastResult] = useState<{ renewed?: number; expired?: number; suspended?: number; reminders_sent?: number } | null>(null);
  const { success, error } = useToast();

  const load = async () => {
    try {
      const [companyData, planData] = await Promise.all([call('list_tenants'), call('list_plans')]);
      setTenants(companyData.tenants || []);
      setPlans(planData.plans || []);
    } catch (cause) { error((cause as Error).message); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => { setStatusFilter(initialFilter); setPage(0); }, [initialFilter]);
  useEffect(() => {
    let current = true;
    setDueLoading(true);
    call('list_expiring_tenants', { days: reminderDays }).then(result => {
      if (current) setExpiring(result.tenants || []);
    }).catch(cause => {
      if (current) { setExpiring([]); error(cause.message); }
    }).finally(() => { if (current) setDueLoading(false); });
    return () => { current = false; };
  }, [reminderDays, refreshKey]);
  useEffect(() => {
    if (!focusTenantId || loading) return;
    if (tenants.some(tenant => tenant.id === focusTenantId)) setSelectedId(focusTenantId);
    onFocusConsumed();
  }, [focusTenantId, loading, tenants]);

  const refresh = () => {
    void load();
    setRefreshKey(value => value + 1);
  };

  const openRules = async () => {
    setRules(null);
    setRulesOpen(true);
    try {
      const current = await call('get_auto_suspend_settings');
      setRules({ enabled: !!current.auto_suspend_enabled, days: Number(current.auto_suspend_grace_days) || 7 });
    } catch (cause) {
      error((cause as Error).message);
      setRulesOpen(false);
    }
  };

  const saveRules = async () => {
    if (!rules || rulesBusy) return;
    setRulesBusy('save');
    try {
      await call('update_auto_suspend_settings', { auto_suspend_enabled: rules.enabled, auto_suspend_grace_days: rules.days });
      success('Règles de suspension enregistrées');
      setRulesOpen(false);
      refresh();
    } catch (cause) { error((cause as Error).message); }
    finally { setRulesBusy(null); }
  };

  const runLifecycle = async () => {
    if (rulesBusy) return;
    setRulesBusy('run');
    try {
      setLastResult(await call('run_subscription_lifecycle'));
      success('Traitement quotidien terminé');
      refresh();
    } catch (cause) { error((cause as Error).message); }
    finally { setRulesBusy(null); }
  };

  const sendNotice = async (tenantId: string, kind: 'reminder' | 'email') => {
    if (sending) return;
    setSending(kind);
    try {
      await call(kind === 'reminder' ? 'send_payment_reminder' : 'send_expiration_alert', { tenant_id: tenantId });
      success(kind === 'reminder' ? 'Rappel affiché dans l’application de l’entreprise' : 'Alerte d’échéance envoyée par e-mail');
    } catch (cause) { error((cause as Error).message); }
    finally { setSending(null); }
  };

  const planNames = useMemo(() => new Map(plans.map(plan => [plan.code, plan.name])), [plans]);
  const reminderIds = useMemo(() => new Set(expiring.map(tenant => tenant.id)), [expiring]);
  const dueIds = useMemo(() => {
    const now = Date.now();
    return new Set(expiring.filter(tenant => new Date(tenant.plan_expires_at).getTime() >= now).map(tenant => tenant.id));
  }, [expiring]);
  const rows = useMemo(() => {
    const today = Date.now();
    const priority: Record<string, number> = { pending: 0, expired: 1, suspended: 2, trial: 3, active: 4 };
    return tenants.map(tenant => {
      const subscriptions = [...(tenant.tenant_subscriptions || [])].sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''));
      const planCode = tenant.approval_status === 'pending' ? tenant.selected_plan_code || tenant.plan : tenant.plan;
      const contract = findCurrentContract(tenant, subscriptions);
      const current = contract
        || subscriptions.find(item => item.status === 'active')
        || subscriptions.find(item => item.status === 'expired') || subscriptions[0];
      const expiry = tenant.plan_expires_at || current?.ends_at;
      const tenancy = companyStatus(tenant);
      let status: SubscriptionFilter;
      if (tenancy !== 'active') status = tenancy;
      else if (current?.status === 'cancelled') status = 'cancelled';
      else if (tenant.subscription_status === 'expired' || (expiry && new Date(expiry).getTime() < today)) status = 'expired';
      else if (tenant.subscription_status === 'trial_active' || current?.status === 'trial') status = 'trial';
      else if (tenant.subscription_status === 'active' || current?.status === 'active') status = 'active';
      else if (current?.status === 'completed') status = 'completed';
      else status = 'none';
      return { tenant, planCode, expiry, status, cycle: tenant.billing_cycle || current?.billing_cycle, amount: contract?.amount };
    }).sort((a, b) =>
      (priority[a.status] ?? 5) - (priority[b.status] ?? 5) ||
      (a.expiry || '9999').localeCompare(b.expiry || '9999') ||
      a.tenant.name.localeCompare(b.tenant.name));
  }, [tenants]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return rows.filter(row => {
      if (statusFilter === 'due' && !dueIds.has(row.tenant.id)) return false;
      if (statusFilter !== 'all' && statusFilter !== 'due' && row.status !== statusFilter) return false;
      return [row.tenant.name, row.planCode, planNames.get(row.planCode), subscriptionStatuses[row.status]]
        .some(value => String(value ?? '').toLowerCase().includes(query));
    });
  }, [rows, q, statusFilter, dueIds, planNames]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / platformPageSize) - 1));
  const selected = tenants.find(tenant => tenant.id === selectedId);

  const selectFilter = (filter: SubscriptionFilter) => { setStatusFilter(filter); setPage(0); };

  return (
    <div className="pa-page">
      <dl className="pa-metrics">
        {([
          ['pending', 'Inscriptions à valider', rows.filter(row => row.status === 'pending').length],
          ['due', 'Échéances sous ' + reminderDays + ' jours', dueLoading ? '—' : dueIds.size],
          ['expired', 'Abonnements expirés', rows.filter(row => row.status === 'expired').length],
          ['active', 'Abonnements actifs', rows.filter(row => row.status === 'active').length],
        ] as const).map(([key, label, count]) => (
          <div key={key}><dt>{label}</dt><dd>
            <button type="button" className="pa-link" aria-label={label + ' ' + count}
              aria-pressed={statusFilter === key} onClick={() => selectFilter(statusFilter === key ? 'all' : key)}>{count}</button>
          </dd></div>
        ))}
      </dl>

      <div className="pa-toolbar">
        <label className="pa-search">
          <Search size={16} aria-hidden="true" />
          <input value={q} aria-label="Rechercher un abonnement" placeholder="Entreprise ou offre"
            onChange={event => { setQ(event.target.value); setPage(0); }} />
        </label>
        <select className="pa-field" value={statusFilter} aria-label="Filtrer les abonnements"
          onChange={event => selectFilter(event.target.value as SubscriptionFilter)}>
          {Object.entries(subscriptionStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        {statusFilter === 'due' && (
          <select className="pa-field" aria-label="Fenêtre d’échéance" value={reminderDays}
            onChange={event => { setReminderDays(Number(event.target.value)); setPage(0); }}>
            {[3, 5, 7, 14, 30].map(days => <option key={days} value={days}>{days} jours</option>)}
          </select>
        )}
        <button type="button" className="pa-icon-button" aria-label="Actualiser les abonnements" title="Actualiser" onClick={refresh}><RefreshCw size={16} /></button>
        <button type="button" className="pa-button" onClick={() => void openRules()}><Settings_ size={15} /> Règles de suivi</button>
      </div>

      {loading || (statusFilter === 'due' && dueLoading) ? <PlatformLoading /> : filtered.length === 0 ? (
        <p className="pa-empty">Aucun abonnement pour cette recherche.</p>
      ) : (
        <>
          <div role="table" className="pa-table pa-subscription-list" aria-label="Suivi des abonnements">
            <div role="row" className="pa-list-head">
              {['Entreprise', 'Offre', 'Échéance', 'Tarif', 'Statut', 'Actions'].map(label => <span key={label} role="columnheader">{label}</span>)}
            </div>
            {filtered.slice(currentPage * platformPageSize, (currentPage + 1) * platformPageSize).map(row => {
              const tenant = row.tenant;
              const pending = row.status === 'pending';
              return (
                <div role="row" className="pa-list-row" key={tenant.id}>
                  <div role="cell" className="pa-row-title">
                    <button type="button" className="pa-name-button" onClick={() => setSelectedId(tenant.id)}>{tenant.name}</button>
                    <p className="pa-row-subtitle truncate">{tenant.email || tenant.city || '—'}</p>
                  </div>
                  <div role="cell" className="pa-row-plan">
                    {planNames.get(row.planCode) || row.planCode || '—'}
                    {row.cycle && <span className="pa-row-subtitle pa-row-cycle">{billingCycles[row.cycle] || row.cycle}</span>}
                  </div>
                  <div role="cell" className="pa-row-date">{row.expiry ? formatDate(row.expiry) : row.cycle === 'lifetime' ? 'À vie' : '—'}</div>
                  <div role="cell" className="pa-row-amount">
                    {pending && tenant.first_payment?.state === 'paid'
                      ? <><span>{formatFCFA(tenant.first_payment.amount)}</span><div className="pa-row-subtitle">Payé</div></>
                      : row.amount != null ? formatFCFA(Number(row.amount)) : '—'}
                  </div>
                  <div role="cell" className="pa-row-status pa-status" data-alert={['pending', 'expired', 'suspended', 'rejected'].includes(row.status)}>
                    {subscriptionStatuses[row.status]}
                  </div>
                  <div role="cell" className="pa-row-actions">
                    <button type="button" className="pa-link" aria-label={(pending ? 'Examiner ' : 'Gérer l’abonnement de ') + tenant.name}
                      onClick={() => setSelectedId(tenant.id)}>{pending ? 'Examiner' : 'Gérer'} <ArrowUpRight size={13} /></button>
                  </div>
                </div>
              );
            })}
          </div>
          <PlatformPagination page={currentPage} total={filtered.length} onPage={setPage} />
        </>
      )}
      {selected && (
        <TenantDetailModal key={selected.id} tenant={selected} plans={plans} subscriptionMode
          onClose={() => setSelectedId(undefined)} onRefresh={refresh}
          noticeActions={reminderIds.has(selected.id) ? {
            busy: sending, send: kind => void sendNotice(selected.id, kind),
          } : undefined} />
      )}
      {rulesOpen && (
        <Modal open size="md" title="Règles de suivi" variant="flat" panelClassName="pa-modal" layer="top"
          onClose={() => { if (!rulesBusy) setRulesOpen(false); }}>
          {!rules ? <PlatformLoading /> : <div className="pa-page">
            <form className="space-y-3" onSubmit={event => { event.preventDefault(); void saveRules(); }}>
              <label className="pa-inline text-sm">
                <input type="checkbox" checked={rules.enabled} onChange={event => setRules({ ...rules, enabled: event.target.checked })} />
                Suspendre les abonnements après expiration
              </label>
              <label className="pa-field-label w-fit">Délai de grâce en jours
                <input type="number" className="pa-field w-24" min={1} max={90} required value={rules.days || ''}
                  onChange={event => setRules({ ...rules, days: Number(event.target.value) })} />
              </label>
              <button type="submit" className="pa-button" data-variant="primary" disabled={!!rulesBusy}>Enregistrer les règles</button>
            </form>
            <div className="pa-panel">
              <button type="button" className="pa-button" disabled={!!rulesBusy} onClick={() => void runLifecycle()}>
                {rulesBusy === 'run' ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                Exécuter le traitement quotidien
              </button>
              {lastResult && <p className="pa-feedback" role="status">
                {lastResult.renewed || 0} renouvelés · {lastResult.expired || 0} expirés · {lastResult.suspended || 0} suspendus · {lastResult.reminders_sent || 0} rappels
              </p>}
            </div>
          </div>}
        </Modal>
      )}
    </div>
  );
}

function MessagesSection() {
  const [messages, setMessages] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ severity: 'info', target: 'all', requires_ack: true });
  const [preview, setPreview] = useState<any>(null);
  const [toDelete, setToDelete] = useState<any>(null);
  const { success, error } = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const [m, t, p] = await Promise.all([call('list_messages'), call('list_tenants'), call('list_plans')]);
      setMessages(m.messages || []); setTenants(t.tenants || []); setPlans(p.plans || []);
    } catch (e: any) { error(e.message); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.title) { error('Titre requis'); return; }
    try {
      await call('create_message', { ...form, expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null });
      success('Message publié');
      setOpen(false); setForm({ severity: 'info', target: 'all', requires_ack: true }); load();
    } catch (e: any) { error(e.message); }
  };

  return (
    <div className="pa-page">
      <div className="pa-section-head">
        <span className="pa-muted text-sm">{messages.length} message{messages.length > 1 ? 's' : ''}</span>
        <button type="button" onClick={() => setOpen(true)} className="pa-button" data-variant="primary"><Plus size={16} /> Nouveau message</button>
      </div>
      {loading ? <PlatformLoading /> : messages.length === 0 ? <p className="pa-empty">Aucun message publié.</p> : (
        <div className="pa-divided">
          {messages.map(message => {
            const severity = SEV[message.severity as keyof typeof SEV] || SEV.info;
            const expired = message.expires_at && Date.parse(message.expires_at) < Date.now();
            const target = message.target === 'all' ? 'Toutes les entreprises' : message.target === 'tenant'
              ? message.tenants?.name || 'Entreprise' : message.plan_code;
            return (
              <article className="pa-message-row" key={message.id}>
                <div className="min-w-0">
                  <button type="button" onClick={() => setPreview(message)} className="pa-name-button">{message.title}</button>
                  <p className="pa-row-subtitle">{target} · {severity.label} · {formatDateTime(message.created_at)}{expired ? ' · Expiré' : ''}</p>
                  {message.body && <p className="pa-muted text-sm line-clamp-2 mt-1">{message.body}</p>}
                </div>
                <div className="pa-row-actions">
                  <button type="button" onClick={() => setPreview(message)} className="pa-link">Aperçu</button>
                  <button type="button" onClick={() => setToDelete(message)} className="pa-icon-button pa-danger"
                    aria-label={'Supprimer ' + message.title} title="Supprimer"><Trash2 size={16} /></button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Nouveau message" size="md" variant="flat" layer="top" panelClassName="pa-modal flat-form"
        footer={<><button onClick={() => setOpen(false)} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button><button onClick={save} className="btn-icon-primary" title="Publier"><Send className="w-4 h-4" /></button></>}>
        <div className="space-y-3">
          <div><label className="label">Titre *</label><input value={form.title || ''} onChange={e => setForm({ ...form, title: e.target.value })} className="input" placeholder="Ex: Maintenance planifiée" /></div>
          <div><label className="label">Contenu</label><textarea value={form.body || ''} onChange={e => setForm({ ...form, body: e.target.value })} className="input resize-none" rows={4} /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="label">Sévérité</label>
              <select value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value })} className="input">
                <option value="info">Info</option><option value="success">Succès</option><option value="warning">Avertissement</option><option value="critical">Critique</option>
              </select>
            </div>
            <div><label className="label">Cible</label>
              <select value={form.target} onChange={e => setForm({ ...form, target: e.target.value })} className="input">
                <option value="all">Tous les tenants</option><option value="tenant">Tenant spécifique</option><option value="plan">Plan spécifique</option>
              </select>
            </div>
          </div>
          {form.target === 'tenant' && (
            <div><label className="label">Tenant</label>
              <select value={form.tenant_id || ''} onChange={e => setForm({ ...form, tenant_id: e.target.value })} className="input">
                <option value="">— Choisir —</option>
                {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
          {form.target === 'plan' && (
            <div><label className="label">Plan</label>
              <select value={form.plan_code || ''} onChange={e => setForm({ ...form, plan_code: e.target.value })} className="input">
                <option value="">— Choisir —</option>
                {plans.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="label">Libellé bouton</label><input value={form.cta_label || ''} onChange={e => setForm({ ...form, cta_label: e.target.value })} className="input" placeholder="En savoir plus" /></div>
            <div><label className="label">URL bouton</label><input value={form.cta_url || ''} onChange={e => setForm({ ...form, cta_url: e.target.value })} className="input" placeholder="https://…" /></div>
          </div>
          <div><label className="label">Expire le (optionnel)</label><input type="datetime-local" value={form.expires_at || ''} onChange={e => setForm({ ...form, expires_at: e.target.value })} className="input" /></div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.requires_ack !== false} onChange={e => setForm({ ...form, requires_ack: e.target.checked })} className="rounded" />
            Requiert un accusé de lecture (popup bloquante)
          </label>
        </div>
      </Modal>

      {preview && (
        <Modal open onClose={() => setPreview(null)} title="Aperçu du message" size="sm" variant="flat" layer="top" panelClassName="pa-modal" footer={<button onClick={() => setPreview(null)} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>}>
          <MessagePreview m={preview} />
        </Modal>
      )}

      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)}
        onConfirm={async () => {
          try { await call('delete_message', { id: toDelete.id }); success('Message supprimé'); setToDelete(null); load(); }
          catch (e: any) { error(e.message); }
        }}
        title="Supprimer ce message ?" message={`"${toDelete?.title}" ne sera plus affiché.`} danger />
    </div>
  );
}

function MessagePreview({ m }: { m: any }) {
  const sev = SEV[m.severity as keyof typeof SEV] || SEV.info;
  return (
    <div className={`${sev.bg} ${sev.border} border rounded-2xl p-5`}>
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className={`w-5 h-5 ${sev.icon}`} />
        <span className={`font-bold ${sev.text}`}>{m.title}</span>
      </div>
      <p className={`text-sm ${sev.text}`}>{m.body}</p>
      {m.cta_label && <button className="mt-3 btn-primary text-xs">{m.cta_label}</button>}
    </div>
  );
}

/* ============== ACTIVITY ============== */
function ActivitySection() {
  const [events, setEvents] = useState<PlatformEvent[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'overview' | 'log'>('overview');
  const [page, setPage] = useState(0);
  const { error } = useToast();

  useEffect(() => {
    (async () => {
      try {
        const [eventData, activityData] = await Promise.all([call('list_events', { limit: 200 }), call('tenant_activity_overview')]);
        setEvents(eventData.events || []);
        setActivity(activityData.activity || []);
      } catch (cause) { error((cause as Error).message); }
      finally { setLoading(false); }
    })();
  }, []);

  const now = Date.now();
  const lastSeen = (company: any) => company.last_active_at ? (now - new Date(company.last_active_at).getTime()) / 86400000 : null;
  const active = activity.filter(company => (lastSeen(company) ?? Infinity) < 7).length;
  const inactive = activity.filter(company => (lastSeen(company) ?? Infinity) >= 30).length;
  const current = tab === 'overview' ? activity : events;
  const visible = current.slice(page * platformPageSize, (page + 1) * platformPageSize);
  return (
    <div className="pa-page">
      <nav className="pa-tabs mb-0" aria-label="Activité de la plateforme">
        <button type="button" aria-current={tab === 'overview' ? 'page' : undefined} onClick={() => { setTab('overview'); setPage(0); }}>Entreprises</button>
        <button type="button" aria-current={tab === 'log' ? 'page' : undefined} onClick={() => { setTab('log'); setPage(0); }}>Journal</button>
      </nav>
      {loading ? <PlatformLoading /> : (
        <>
          {tab === 'overview' && <dl className="pa-metrics">
            <div><dt>Actives sur 7 jours</dt><dd>{active}</dd></div>
            <div><dt>Inactives depuis 30 jours</dt><dd>{inactive}</dd></div>
            <div><dt>Ventes enregistrées</dt><dd>{activity.reduce((sum, company) => sum + Number(company.total_sales || 0), 0)}</dd></div>
            <div><dt>Articles référencés</dt><dd>{activity.reduce((sum, company) => sum + Number(company.total_articles || 0), 0)}</dd></div>
          </dl>}
          {current.length === 0 ? <p className="pa-empty">Aucune activité enregistrée.</p> : tab === 'log' ? (
            <div className="pa-divided">{(visible as PlatformEvent[]).map(event => <EventRow key={event.id} ev={event} />)}</div>
          ) : (
            <div role="table" aria-label="Activité des entreprises" className="pa-table pa-activity-list">
              <div role="row" className="pa-list-head">
                {['Entreprise', 'Utilisateurs', 'Articles', 'Ventes', 'Dernière activité', 'Statut'].map(label => <span key={label} role="columnheader">{label}</span>)}
              </div>
              {visible.map(company => {
                const last = lastSeen(company);
                const status = last === null ? 'Jamais connectée' : last < 7 ? 'Active' : last < 30 ? 'Récente' : 'Inactive';
                return (
                  <div key={company.tenant_id} className="pa-list-row" role="row">
                    <div className="pa-row-title" role="cell"><strong>{company.tenant_name}</strong>
                      <p className="pa-row-subtitle pa-mobile-meta">{company.total_users} utilisateurs · {company.total_articles} articles · {company.total_sales} ventes</p>
                    </div>
                    <div className="pa-desktop-cell tabular-nums" role="cell">{company.total_users}</div>
                    <div className="pa-desktop-cell tabular-nums" role="cell">{company.total_articles}</div>
                    <div className="pa-desktop-cell tabular-nums" role="cell">{company.total_sales}</div>
                    <div className="pa-row-date pa-muted" role="cell">{company.last_active_at ? formatDateTime(company.last_active_at) : '—'}</div>
                    <div className="pa-row-status pa-status" role="cell">{status}</div>
                  </div>
                );
              })}
            </div>
          )}
          <PlatformPagination page={page} total={current.length} onPage={setPage} />
        </>
      )}
    </div>
  );
}

/* ============== LOGIN CONFIG ============== */

const ICON_MAP_ADMIN = LOGIN_ICON_MAP;

const ALL_APP_FEATURES = DEFAULT_LOGIN_MODULES.map(m => ({ ...m, color: 'text-teal-600 bg-teal-50' }));

const AVAILABLE_ICONS = [
  { value: 'ShoppingCart', label: 'Panier (POS)' },
  { value: 'Package', label: 'Colis (Stock)' },
  { value: 'FileText', label: 'Document (Facturation)' },
  { value: 'Users', label: 'Utilisateurs (Clients)' },
  { value: 'Truck', label: 'Camion (Fournisseurs)' },
  { value: 'Globe', label: 'Globe (Boutique)' },
  { value: 'BarChart3', label: 'Graphique (Comptabilité)' },
  { value: 'TrendingUp', label: 'Tendance (Rapports)' },
  { value: 'Shield', label: 'Bouclier (Sécurité)' },
  { value: 'Zap', label: 'Éclair' },
  { value: 'Wallet', label: 'Portefeuille' },
  { value: 'Layers', label: 'Couches' },
  { value: 'Monitor', label: 'Écran' },
  { value: 'Receipt', label: 'Reçu' },
];

function LoginConfigSection() {
  const { success, error } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [headline, setHeadline] = useState('');
  const [headlineAccent, setHeadlineAccent] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [loginBgUrl, setLoginBgUrl] = useState<string | null>(null);
  const [modules, setModules] = useState<LoginModule[]>([]);
  const [eyebrow, setEyebrow] = useState('');
  const [textAccents, setTextAccents] = useState<TextAccent[]>([]);
  const [loginTitle, setLoginTitle] = useState('');
  const [loginSubtitle, setLoginSubtitle] = useState('');
  const [previewSlide, setPreviewSlide] = useState(0);
  const [previewAnim, setPreviewAnim] = useState<'in' | 'out'>('in');
  const [activeTab, setActiveTab] = useState<'textes' | 'modules' | 'effets'>('textes');

  useEffect(() => {
    (async () => {
      try {
        const data = await call('get_login_config');
        setHeadline(data.headline || '');
        setHeadlineAccent(data.headline_accent || '');
        setSubtitle(data.subtitle || '');
        setLoginBgUrl(data.login_bg_url || null);
        setModules(data.modules || []);
        setEyebrow(data.eyebrow || '');
        setTextAccents(data.text_accents || []);
        setLoginTitle(data.login_title || '');
        setLoginSubtitle(data.login_subtitle || '');
      } catch (e: any) { error(e.message); }
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await call('update_login_config', { headline, headline_accent: headlineAccent, subtitle, modules, login_bg_url: loginBgUrl, eyebrow, text_accents: textAccents, login_title: loginTitle, login_subtitle: loginSubtitle });
      success('Configuration de l\'écran de connexion enregistrée');
    } catch (e: any) { error(e.message); }
    setSaving(false);
  };

  const updateModule = (idx: number, field: keyof LoginModule, value: string) => {
    setModules(prev => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m));
  };

  const removeModule = (idx: number) => setModules(prev => prev.filter((_, i) => i !== idx));

  const addModule = () => {
    setModules(prev => [...prev, { icon: 'ShoppingCart', label: '', desc: '' }]);
  };

  const useAllDefaults = () => setModules(ALL_APP_FEATURES.map(f => ({ icon: f.icon, label: f.label, desc: f.desc })));

  const moveModule = (idx: number, dir: -1 | 1) => {
    const next = idx + dir;
    if (next < 0 || next >= modules.length) return;
    setModules(prev => {
      const a = [...prev];
      [a[idx], a[next]] = [a[next], a[idx]];
      return a;
    });
  };

  const previewModules = modules.length > 0 ? modules : ALL_APP_FEATURES.map(f => ({ icon: f.icon, label: f.label, desc: f.desc }));
  const totalSlides = Math.ceil(previewModules.length / 3);
  const slideModules = previewModules.slice(previewSlide * 3, previewSlide * 3 + 3);

  const advancePreview = (idx: number) => {
    setPreviewAnim('out');
    setTimeout(() => { setPreviewSlide(idx); setPreviewAnim('in'); }, 260);
  };

  if (loading) return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* Left: Editor */}
        <div className="space-y-4">
          {/* Tabs */}
          <div className="pa-tabs" aria-label="Configuration de la connexion">
            <button
              onClick={() => setActiveTab('textes')}
              aria-current={activeTab === 'textes' ? 'page' : undefined}
            >
              Textes
            </button>
            <button
              onClick={() => setActiveTab('effets')}
              aria-current={activeTab === 'effets' ? 'page' : undefined}
            >
              Effets
            </button>
            <button
              onClick={() => setActiveTab('modules')}
              aria-current={activeTab === 'modules' ? 'page' : undefined}
            >
              Modules ({modules.length})
            </button>
          </div>

          {activeTab === 'textes' && (
            <div className="pa-panel space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Titre principal</label>
                <input
                  value={headline}
                  onChange={e => setHeadline(e.target.value)}
                  placeholder="La plateforme qui simplifie,"
                  className="w-full pa-field"
                />
                <p className="text-[10px] text-slate-400 mt-1">Première ligne du titre</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Accent (en couleur turquoise)</label>
                <input
                  value={headlineAccent}
                  onChange={e => setHeadlineAccent(e.target.value)}
                  placeholder="connecte et propulse votre business."
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm text-teal-600 font-semibold placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400"
                />
                <p className="text-[10px] text-slate-400 mt-1">Partie affichée en turquoise</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Sous-titre</label>
                <textarea
                  value={subtitle}
                  onChange={e => setSubtitle(e.target.value)}
                  rows={2}
                  placeholder="Gérez vos ventes, stocks, clients et finances..."
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Eyebrow (petit texte au-dessus du titre)</label>
                <input
                  value={eyebrow}
                  onChange={e => setEyebrow(e.target.value)}
                  placeholder="LA PLATEFORME QUI AVANCE AVEC VOUS"
                  className="w-full pa-field"
                />
                <p className="text-[10px] text-slate-400 mt-1">Texte en petites capitales au-dessus du titre principal</p>
              </div>
              <div className="border-t border-[var(--w-separator)] pt-4 mt-2">
                <p className="text-xs font-bold text-slate-700 mb-3">Zone de connexion (droite)</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Titre connexion</label>
                    <input
                      value={loginTitle}
                      onChange={e => setLoginTitle(e.target.value)}
                      placeholder="Accédez à votre espace"
                      className="w-full pa-field"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Sous-titre connexion</label>
                    <input
                      value={loginSubtitle}
                      onChange={e => setLoginSubtitle(e.target.value)}
                      placeholder="Connectez-vous pour gérer votre activité."
                      className="w-full pa-field"
                    />
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Image de fond</label>
                <div className="flex items-center gap-3">
                  {loginBgUrl && (
                    <img src={loginBgUrl} alt="Fond" className="w-24 h-14 object-cover rounded-xl border border-slate-200" />
                  )}
                  <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-[var(--w-surface-el)] hover:bg-slate-100 text-xs font-semibold text-slate-700 transition-colors">
                    <ImagePlus className="w-4 h-4 text-slate-500" />
                    {loginBgUrl ? 'Changer' : 'Uploader une image'}
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 3 * 1024 * 1024) { error('Image trop lourde (max 3 Mo)'); return; }
                      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
                      const path = `platform/login-bg-${Date.now()}.${ext}`;
                      const { error: upErr } = await supabase.storage.from('tenant-logos').upload(path, file, { cacheControl: '86400', upsert: true, contentType: file.type });
                      if (upErr) { error(upErr.message); return; }
                      const { data: { publicUrl } } = supabase.storage.from('tenant-logos').getPublicUrl(path);
                      setLoginBgUrl(publicUrl);
                      success('Image uploadee');
                    }} />
                  </label>
                  {loginBgUrl && (
                    <button type="button" onClick={() => setLoginBgUrl(null)} className="text-xs text-red-500 hover:text-red-700 font-semibold">
                      Supprimer
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-slate-400 mt-1.5">Affichee en arriere-plan avec transparence. JPG/WebP recommande, max 3 Mo. Si absente, le fond par defaut s'applique.</p>
              </div>
            </div>
          )}

          {activeTab === 'effets' && (
            <div className="pa-panel space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-bold text-slate-700">Effets graphiques sur le texte</p>
                  <button
                    type="button"
                    onClick={() => setTextAccents(prev => [...prev, { text: '', effect: 'underline', color: '#0f766e' }])}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-brand-50 text-brand-700 text-[11px] font-semibold hover:bg-brand-100 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Ajouter un effet
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 mb-3">Appliquez des effets visuels (soulignement, surlignage, peinture...) sur des mots ou portions de texte dans le titre ou sous-titre de la page de connexion.</p>
              </div>

              {textAccents.length === 0 && (
                <div className="text-center py-8 space-y-2">
                  <p className="text-xs text-slate-400">Aucun effet configuré.</p>
                  <p className="text-[10px] text-slate-400">Les titres s'afficheront sans mise en valeur particulière.</p>
                </div>
              )}

              <div className="space-y-3">
                {textAccents.map((accent, idx) => (
                  <div key={idx} className="p-3 rounded-xl border border-[var(--w-separator)] bg-[var(--w-surface-el)]/60 space-y-2.5 group">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase w-5 shrink-0">#{idx + 1}</span>
                      <input
                        value={accent.text}
                        onChange={e => setTextAccents(prev => prev.map((a, i) => i === idx ? { ...a, text: e.target.value } : a))}
                        placeholder="Texte à mettre en valeur"
                        className="flex-1 h-8 px-2.5 rounded-lg border border-slate-200 text-[12px] text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-400 min-w-0"
                      />
                      <button
                        type="button"
                        onClick={() => setTextAccents(prev => prev.filter((_, i) => i !== idx))}
                        className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={accent.effect}
                        onChange={e => setTextAccents(prev => prev.map((a, i) => i === idx ? { ...a, effect: e.target.value as TextAccent['effect'] } : a))}
                        className="h-8 px-2 rounded-lg border border-slate-200 text-[11px] text-slate-800 bg-[var(--w-surface)] focus:outline-none focus:ring-1 focus:ring-brand-400"
                      >
                        <option value="underline">Soulignement peinture</option>
                        <option value="wavyUnderline">Soulignement ondule</option>
                        <option value="shortUnderline">Trait court centre</option>
                        <option value="paint">Peinture / surlignage peint</option>
                        <option value="paintStroke">Coup de pinceau</option>
                        <option value="marker">Marqueur epais</option>
                        <option value="highlight">Surlignage clair</option>
                        <option value="brush">Trait solide en bas</option>
                        <option value="circle">Cercle autour du mot</option>
                        <option value="starburst">Rayons / etoile</option>
                        <option value="boxed">Encadre</option>
                        <option value="glow">Lueur / glow</option>
                        <option value="splash">Couleur + italique</option>
                        <option value="strikethrough">Barre / raye</option>
                      </select>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="color"
                          value={accent.color}
                          onChange={e => setTextAccents(prev => prev.map((a, i) => i === idx ? { ...a, color: e.target.value } : a))}
                          className="w-7 h-7 rounded-lg border border-slate-200 cursor-pointer p-0.5"
                        />
                        <span className="text-[10px] text-slate-500 font-mono">{accent.color}</span>
                      </div>
                    </div>
                    {/* Preview */}
                    {accent.text && (
                      <div className="pt-1 border-t border-[var(--w-separator)]">
                        <p className="text-[10px] text-slate-400 mb-1">Aperçu :</p>
                        <span className="text-sm font-bold text-slate-900 relative inline-block" style={
                          accent.effect === 'underline' ? {
                            backgroundImage: `linear-gradient(to right, ${accent.color}60, ${accent.color}60)`,
                            backgroundSize: '100% 4px',
                            backgroundRepeat: 'no-repeat',
                            backgroundPosition: 'bottom',
                            paddingBottom: '4px',
                          } : accent.effect === 'paint' ? {
                            background: `${accent.color}25`,
                            padding: '1px 5px',
                            display: 'inline',
                            borderRadius: '3px',
                            transform: 'skewX(-2deg)',
                          } : accent.effect === 'highlight' ? {
                            background: `${accent.color}22`,
                            padding: '2px 6px',
                            borderRadius: '2px',
                          } : accent.effect === 'brush' ? {
                            borderBottom: `3px solid ${accent.color}`,
                            paddingBottom: '2px',
                          } : accent.effect === 'splash' ? {
                            color: accent.color,
                            fontStyle: 'italic',
                          } : accent.effect === 'marker' ? {
                            background: `linear-gradient(transparent 40%, ${accent.color}88 40%, ${accent.color}88 85%, transparent 85%)`,
                            padding: '0 2px',
                          } : accent.effect === 'wavyUnderline' ? {
                            textDecoration: 'underline wavy',
                            textDecorationColor: accent.color,
                            textUnderlineOffset: '4px',
                            textDecorationThickness: '2px',
                          } : accent.effect === 'shortUnderline' ? {
                            borderBottom: `4px solid ${accent.color}`,
                            paddingBottom: '3px',
                            borderImage: `linear-gradient(to right, transparent 25%, ${accent.color} 25%, ${accent.color} 75%, transparent 75%) 1`,
                          } : accent.effect === 'paintStroke' ? {
                            background: `linear-gradient(95deg, ${accent.color}55 0%, ${accent.color}35 40%, ${accent.color}55 70%, ${accent.color}30 100%)`,
                            padding: '2px 4px',
                            borderRadius: '4px 2px 4px 2px',
                            transform: 'rotate(-0.5deg)',
                          } : accent.effect === 'circle' ? {
                            border: `2.5px dashed ${accent.color}`,
                            borderRadius: '50%',
                            padding: '2px 10px',
                          } : accent.effect === 'starburst' ? {
                            color: accent.color,
                            textShadow: `2px 2px 0 ${accent.color}33, -2px -2px 0 ${accent.color}33`,
                            fontWeight: 900,
                          } : accent.effect === 'boxed' ? {
                            border: `2.5px solid ${accent.color}`,
                            padding: '1px 8px',
                            borderRadius: '4px',
                          } : accent.effect === 'glow' ? {
                            color: accent.color,
                            textShadow: `0 0 8px ${accent.color}66, 0 0 20px ${accent.color}33`,
                          } : accent.effect === 'strikethrough' ? {
                            textDecoration: 'line-through',
                            textDecorationColor: accent.color,
                            textDecorationThickness: '3px',
                          } : {}
                        }>
                          {accent.text}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'modules' && (
            <div className="pa-panel space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-slate-700">Modules affichés ({modules.length})</p>
                  <p className="text-[10px] text-slate-400">Ils défilent 3 par 3 sur l'écran de connexion</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={useAllDefaults}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-semibold hover:bg-slate-200 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" /> Tout rétablir
                  </button>
                  <button
                    onClick={addModule}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-brand-50 text-brand-700 text-[11px] font-semibold hover:bg-brand-100 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Ajouter
                  </button>
                </div>
              </div>

              {modules.length === 0 && (
                <div className="text-center py-6 space-y-2">
                  <p className="text-xs text-slate-400">Aucun module configuré.</p>
                  <button onClick={useAllDefaults} className="text-xs font-semibold text-brand-600 hover:text-brand-700">
                    Utiliser tous les modules par défaut →
                  </button>
                </div>
              )}

              <div className="space-y-2">
                {modules.map((mod, idx) => {
                  const IconComp = ICON_MAP_ADMIN[mod.icon] || Shield;
                  return (
                    <div key={idx} className="p-2.5 rounded-xl border border-[var(--w-separator)] bg-[var(--w-surface-el)]/60 group space-y-2">
                      <div className="flex items-center gap-2">
                        {/* Drag handle / order */}
                        <div className="flex flex-col gap-0.5 shrink-0">
                          <button onClick={() => moveModule(idx, -1)} disabled={idx === 0} className="text-slate-400 hover:text-slate-600 disabled:opacity-20 transition-colors">
                            <ArrowUpRight className="w-3 h-3 rotate-[-90deg]" />
                          </button>
                          <button onClick={() => moveModule(idx, 1)} disabled={idx === modules.length - 1} className="text-slate-400 hover:text-slate-600 disabled:opacity-20 transition-colors">
                            <ArrowUpRight className="w-3 h-3 rotate-90" />
                          </button>
                        </div>
                        {/* Icon preview */}
                        <div className="w-8 h-8 rounded-lg bg-[var(--w-surface)] border border-slate-200 flex items-center justify-center shrink-0">
                          <IconComp className="w-3.5 h-3.5 text-teal-600" />
                        </div>
                        {/* Icon select */}
                        <select
                          value={mod.icon}
                          onChange={e => updateModule(idx, 'icon', e.target.value)}
                          className="h-8 px-2 rounded-lg border border-slate-200 text-[11px] text-slate-800 bg-[var(--w-surface)] focus:outline-none focus:ring-1 focus:ring-brand-400 shrink-0"
                        >
                          {AVAILABLE_ICONS.map(ic => (
                            <option key={ic.value} value={ic.value}>{ic.label}</option>
                          ))}
                        </select>
                        {/* Delete */}
                        <button onClick={() => removeModule(idx)} className="shrink-0 ml-auto p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all sm:opacity-0 sm:group-hover:opacity-100">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2">
                        {/* Label */}
                        <input
                          value={mod.label}
                          onChange={e => updateModule(idx, 'label', e.target.value)}
                          placeholder="Nom du module"
                          className="flex-1 h-8 px-2.5 rounded-lg border border-slate-200 text-[11px] text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-400 min-w-0"
                        />
                        {/* Desc */}
                        <input
                          value={mod.desc}
                          onChange={e => updateModule(idx, 'desc', e.target.value)}
                          placeholder="Description"
                          className="flex-1 h-8 px-2.5 rounded-lg border border-slate-200 text-[11px] text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-400 min-w-0"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right: Live Preview */}
        <div className="sticky top-4">
          <div className="pa-panel overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--w-separator)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs font-bold text-slate-700">Aperçu en direct</span>
              </div>
              <span className="text-[10px] text-slate-400">Écran de connexion</span>
            </div>
            <div className="p-4 bg-[#f0f4f8]">
              {/* Mini mockup of login screen left panel */}
              <div className="rounded-xl bg-[var(--w-surface)] border border-slate-200 shadow-sm p-4 space-y-3">
                {/* Logo */}
                <div>
                  <img src="/newlogo.png" alt="WAARWI" className="h-8 w-auto object-contain" />
                  <p className="text-[8px] font-semibold text-slate-400 uppercase tracking-wider mt-1">Plateforme Business 2.0</p>
                </div>
                {/* Headline */}
                <div>
                  <p className="text-sm font-extrabold text-slate-900 leading-tight">
                    {headline || 'La plateforme qui simplifie,'}
                    {headlineAccent && <span className="text-teal-600"> {headlineAccent}</span>}
                  </p>
                  {subtitle && <p className="text-[9px] text-slate-500 mt-1 leading-relaxed">{subtitle}</p>}
                </div>
                {/* Feature carousel preview */}
                <div>
                  <div
                    className="grid grid-cols-3 gap-1.5"
                    style={{
                      opacity: previewAnim === 'in' ? 1 : 0,
                      transform: previewAnim === 'in' ? 'translateY(0)' : 'translateY(4px)',
                      transition: 'opacity 0.26s ease, transform 0.26s ease',
                    }}
                  >
                    {slideModules.map((m, i) => {
                      const feat = ALL_APP_FEATURES.find(f => f.icon === m.icon);
                      const colorCls = feat?.color || 'text-teal-600 bg-teal-50';
                      const IconC = ICON_MAP_ADMIN[m.icon] || Shield;
                      return (
                        <div key={`${previewSlide}-${i}`} className={`rounded-lg border p-2 ${colorCls} border-current/20`}>
                          <div className={`w-5 h-5 rounded flex items-center justify-center mb-1 ${colorCls}`}>
                            <IconC className="w-3 h-3" />
                          </div>
                          <p className="text-[8px] font-bold text-slate-800 truncate">{m.label || '—'}</p>
                          <p className="text-[7px] text-slate-400 leading-tight truncate">{m.desc || '—'}</p>
                        </div>
                      );
                    })}
                  </div>
                  {/* Slide indicators */}
                  {totalSlides > 1 && (
                    <div className="flex items-center justify-center gap-1 mt-2">
                      {Array.from({ length: totalSlides }).map((_, i) => (
                        <button
                          key={i}
                          onClick={() => advancePreview(i)}
                          className={`rounded-full transition-all ${i === previewSlide ? 'w-3 h-1 bg-teal-500' : 'w-1 h-1 bg-slate-300'}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
                {/* Mini stats mockup */}
                <div className="grid grid-cols-3 gap-1 mt-1">
                  {[
                    { label: 'Slide actuel', val: `${previewSlide + 1} / ${totalSlides}` },
                    { label: 'Modules total', val: `${previewModules.length}` },
                    { label: 'Groupes de 3', val: `${totalSlides}` },
                  ].map((s, i) => (
                    <div key={i} className="rounded-lg p-1.5 bg-[var(--w-surface-el)] border border-[var(--w-separator)]">
                      <p className="text-[7px] text-slate-400 font-medium uppercase">{s.label}</p>
                      <p className="text-[9px] font-black text-slate-700">{s.val}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Save button */}
      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-brand-700 text-white text-sm font-semibold hover:bg-brand-800 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Enregistrer les modifications
        </button>
      </div>
    </div>
  );
}

// Legacy inline LandingConfigSection removed — now uses src/components/LandingConfigSection.tsx

// ─── Releases Section ────────────────────────────────────────────────────────

interface AppRelease {
  id: string;
  version: string;
  title: string;
  release_date: string;
  features: string[];
  fixes: string[];
  is_published: boolean;
  published_at: string | null;
  created_at: string;
}

function ReleasesSection() {
  const { success, error } = useToast();
  const [releases, setReleases] = useState<AppRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ version: '', title: 'Mise à jour', release_date: new Date().toISOString().split('T')[0], features: '', fixes: '' });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('app_releases')
      .select('*')
      .order('created_at', { ascending: false });
    setReleases((data || []) as AppRelease[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditId(null);
    setForm({ version: '', title: 'Mise à jour', release_date: new Date().toISOString().split('T')[0], features: '', fixes: '' });
    setEditOpen(true);
  };

  const openEdit = (r: AppRelease) => {
    setEditId(r.id);
    setForm({
      version: r.version,
      title: r.title,
      release_date: r.release_date,
      features: (r.features || []).join('\n'),
      fixes: (r.fixes || []).join('\n'),
    });
    setEditOpen(true);
  };

  const save = async () => {
    if (!form.version.trim()) { error('La version est requise'); return; }
    setSaving(true);
    const payload = {
      version: form.version.trim(),
      title: form.title.trim() || 'Mise à jour',
      release_date: form.release_date,
      features: form.features.split('\n').map(s => s.trim()).filter(Boolean),
      fixes: form.fixes.split('\n').map(s => s.trim()).filter(Boolean),
    };
    if (editId) {
      const { error: e } = await supabase.from('app_releases').update(payload).eq('id', editId);
      if (e) { error(e.message); setSaving(false); return; }
    } else {
      const { error: e } = await supabase.from('app_releases').insert(payload);
      if (e) { error(e.message); setSaving(false); return; }
    }
    setSaving(false);
    setEditOpen(false);
    success(editId ? 'Mise à jour modifiée' : 'Mise à jour créée');
    load();
  };

  const togglePublish = async (r: AppRelease) => {
    const newState = !r.is_published;
    await supabase.from('app_releases').update({
      is_published: newState,
      published_at: newState ? new Date().toISOString() : null,
    }).eq('id', r.id);
    success(newState ? 'Publiée ! Les utilisateurs verront la notification.' : 'Dépubliée.');
    load();
  };

  const deleteRelease = async (id: string) => {
    await supabase.from('app_releases').delete().eq('id', id);
    setDeleteConfirm(null);
    success('Supprimée');
    load();
  };

  return (
    <div className="pa-page">
      <div className="pa-section-head">
        <span className="pa-muted text-sm">{releases.length} version{releases.length !== 1 ? 's' : ''}</span>
        <button type="button" className="pa-button" data-variant="primary" onClick={openNew}><Plus size={16} /> Nouvelle version</button>
      </div>

      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : releases.length === 0 ? (
        <div className="py-16 text-center text-sm text-slate-400">Aucune mise à jour créée</div>
      ) : (
        <div className="pa-divided">
          {releases.map(release => (
            <div key={release.id} className="pa-message-row">
              <div className="min-w-0">
                <button type="button" className="pa-name-button" onClick={() => openEdit(release)}>{release.title}</button>
                <p className="pa-row-subtitle">v{release.version} · {formatDate(release.release_date)} · {release.is_published ? 'Publiée' : 'Brouillon'}</p>
                <p className="pa-row-subtitle">{release.features.length} nouveautés · {release.fixes.length} corrections</p>
              </div>
              <div className="pa-row-actions">
                <button type="button" className="pa-link" onClick={() => togglePublish(release)}>{release.is_published ? 'Dépublier' : 'Publier'}</button>
                <button type="button" className="pa-icon-button" aria-label={'Modifier ' + release.title} onClick={() => openEdit(release)}><Edit2 size={16} /></button>
                <button type="button" className="pa-icon-button pa-danger" aria-label={'Supprimer ' + release.title} onClick={() => setDeleteConfirm(release.id)}><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit/Create Modal */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={editId ? 'Modifier la mise à jour' : 'Nouvelle mise à jour'} size="lg" variant="flat" layer="top" panelClassName="pa-modal flat-form">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Version *</label>
              <input value={form.version} onChange={e => setForm({ ...form, version: e.target.value })} placeholder="ex: 2.5.0" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Date</label>
              <input type="date" value={form.release_date} onChange={e => setForm({ ...form, release_date: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Titre</label>
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Mise à jour majeure" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              <span className="flex items-center gap-1.5">Nouveautés</span>
            </label>
            <textarea value={form.features} onChange={e => setForm({ ...form, features: e.target.value })} rows={4} placeholder="Une nouveauté par ligne..." className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none resize-none" />
            <p className="text-[10px] text-slate-400 mt-0.5">Une nouveauté par ligne</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              <span className="flex items-center gap-1.5"><Bug className="w-3.5 h-3.5 text-sky-500" />Corrections</span>
            </label>
            <textarea value={form.fixes} onChange={e => setForm({ ...form, fixes: e.target.value })} rows={4} placeholder="Une correction par ligne..." className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none resize-none" />
            <p className="text-[10px] text-slate-400 mt-0.5">Une correction par ligne</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setEditOpen(false)} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
            <button onClick={save} disabled={saving} className="btn-icon-primary" title={editId ? 'Enregistrer' : 'Créer'}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => deleteConfirm && deleteRelease(deleteConfirm)}
        title="Supprimer cette mise à jour ?"
        message="Cette action est irréversible."
        confirmLabel="Supprimer"
        danger
      />
    </div>
  );
}
