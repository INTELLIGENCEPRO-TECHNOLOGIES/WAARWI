import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowUpRight, Building2, Check, CircleDollarSign, Clock,
  Pencil as Edit2, Gauge, LineChart, Loader2, LogOut, Mail, MessageSquare, Pause, Plus,
  Power, Search, Send, Shield, RotateCcw, Trash2, Users, X,
  ShoppingBag as ShoppingBag_,
  CreditCard as CreditCard_, Package as Package_, Boxes as Boxes_, FileText as FileText_,
  Globe as Globe_, BookOpen as BookOpen_, Settings as Settings_, Library,
  BarChart3, Monitor, Globe, HeartPulse, Bell, ArrowRightLeft,
  RefreshCw, Lock, HardDrive, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Menu,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { useApp } from '../context/AppContext';
import './PlatformAdmin.css';
import { PlatformConfirmation, PlatformWorkPage } from '../components/PlatformWorkPage';
import { formatCompactFCFA, formatDate, formatDateTime, formatFCFA } from '../lib/format';
import { formatSubscriptionDiscount } from '../lib/subscriptionPayments';
import { MasterCatalogAdmin } from '../components/MasterCatalogAdmin';
import { AdminSubscriptionPayments } from '../components/AdminSubscriptionPayments';
import { CentralizedBackups } from '../components/CentralizedBackups';
import { LandingConfigSection } from '../components/LandingConfigSection';
import { LOGIN_ICON_MAP, DEFAULT_LOGIN_CONFIG, DEFAULT_LOGIN_MODULES, type LoginConfig, type LoginModule, type TextAccent } from '../lib/loginConfig';
import { AccentedText } from '../components/AccentedText';

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

const messageTypes: Record<string, string> = {
  info: 'Information', success: 'Succès', warning: 'Avertissement', critical: 'Critique',
};

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
  const { setInlineTarget } = useToast();
  const [section, setSection] = useState<Section>('overview');
  const [subscription, setSubscription] = useState<SubscriptionSelection>({ tab: 'followup', filter: 'all' });
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const title = navigationItems.find(item => item.key === section)?.label;
  const operator = profile?.full_name || 'Super-administrateur';

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeMenu = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    desktop.addEventListener('change', closeMenu);
    return () => desktop.removeEventListener('change', closeMenu);
  }, []);

  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 0;
  }, [section, subscription.tab, menuOpen]);

  const goTo = (next: Section) => {
    setSection(next);
    setMenuOpen(false);
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
      <header className="pa-topbar">
        <button type="button" className="pa-icon-button pa-menu-trigger"
          aria-label={menuOpen ? 'Fermer le menu' : 'Ouvrir le menu'} aria-expanded={menuOpen} aria-controls="platform-mobile-menu"
          onClick={() => setMenuOpen(value => !value)}>
          {menuOpen ? <X size={19} /> : <Menu size={19} />}
        </button>
        <picture className="pa-brand">
          <source media="(max-width: 600px)" srcSet="/newlogoo.png" />
          <img src="/newlogo.png" alt="Waarwi" className="w-platform-logo" />
        </picture>
        <div className="pa-topbar-body">
          <span className="pa-topbar-context">Administration</span>
          <div ref={setInlineTarget} className="pa-notice-slot" />
        </div>
        <div className="pa-topbar-user">
          {profile?.full_name && <span className="pa-header-operator" title={operator}>{operator}</span>}
          <button type="button" className="pa-topbar-logout pa-link" onClick={() => void signOut()}
            aria-label="Déconnexion" title="Déconnexion">
            <LogOut size={16} aria-hidden="true" />
            <span>Déconnexion</span>
          </button>
        </div>
      </header>
      <aside className="pa-sidebar" aria-label="Menu de la console">
        {menu(collapsed)}
        <footer className="pa-sidebar-footer">
          <button type="button" className="pa-icon-button" onClick={() => setCollapsed(value => !value)}
            aria-label={collapsed ? 'Développer le menu' : 'Réduire le menu'} aria-expanded={!collapsed}
            title={collapsed ? 'Développer le menu' : 'Réduire le menu'}>
            {collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
            <span className="pa-nav-item-label text-xs">Réduire le menu</span>
          </button>
        </footer>
      </aside>

      <div ref={scroll} className="pa-scroll" role="region" aria-label={menuOpen ? 'Menu' : title}>
        <div className="pa-content">
          <div id="platform-mobile-menu" className="pa-mobile-menu" hidden={!menuOpen}>
            <h1 className="pa-page-title">Menu</h1>
            {menu()}
          </div>
          <div hidden={menuOpen}>
            <h1 className="pa-page-title">{title}</h1>
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
            {section === 'login_config' && <LoginConfigSection />}
            {section === 'landing' && <LandingConfigSection />}
            {section === 'master_catalogs' && <MasterCatalogAdmin />}
            {section === 'releases' && <ReleasesSection />}
            {section === 'backups' && <CentralizedBackups />}
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
    if (!deleting || deleteLoading || normalizeName(deleteConfirmName) !== normalizeName(deleting.name)) return;
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

  if (deleting) {
    return (
      <PlatformWorkPage title={'Supprimer ' + deleting.name} backLabel="Retour à la fiche" onBack={() => setDeleting(null)} busy={deleteLoading}>
        <p className="pa-copy">La suppression est définitive. Elle efface les données commerciales, comptables et de caisse, les comptes utilisateurs, les abonnements et les sauvegardes de cette entreprise.</p>
        <form className="pa-form" onSubmit={event => { event.preventDefault(); void deleteTenant(); }}>
          <label className="pa-field-label">Motif de la suppression
            <input className="w-input-ul" value={deleteReason} onChange={event => setDeleteReason(event.target.value)} />
          </label>
          <label className="pa-field-label">
            <span>Tape <strong>{normalizeName(deleting.name)}</strong> pour confirmer</span>
            <input className="w-input-ul" value={deleteConfirmName} autoComplete="off" spellCheck={false}
              onChange={event => setDeleteConfirmName(event.target.value)} />
          </label>
          <div className="pa-form-actions">
            <button type="submit" className="pa-link pa-danger" disabled={deleteLoading || normalizeName(deleteConfirmName) !== normalizeName(deleting.name)}>
              {deleteLoading ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} Supprimer définitivement
            </button>
          </div>
        </form>
      </PlatformWorkPage>
    );
  }

  if (suspending) {
    return (
      <PlatformWorkPage title={'Suspendre ' + suspending.name} backLabel="Retour à la fiche" onBack={() => setSuspending(null)} busy={updating}>
        <p className="pa-copy">La suspension bloque l’accès à Waarwi pour les utilisateurs de l’entreprise.</p>
        <form className="pa-form" onSubmit={event => { event.preventDefault(); void updateAccess(suspending, 'suspend_tenant'); }}>
          <label className="pa-field-label">Motif de la suspension
            <textarea rows={3} className="w-input-ul" value={suspensionReason} onChange={event => setSuspensionReason(event.target.value)} />
          </label>
          <div className="pa-form-actions">
            <button type="submit" className="pa-link pa-danger" disabled={updating}>
              {updating ? <Loader2 size={16} className="animate-spin" /> : <Pause size={16} />} Suspendre l’accès
            </button>
          </div>
        </form>
      </PlatformWorkPage>
    );
  }

  if (detail) {
    return (
      <TenantDetailPage key={detail.id} tenant={detail} plans={plans} onClose={() => setDetailId(undefined)}
        onRefresh={load} onDelete={startDelete} onOpenSubscription={onOpenSubscription}
        onSuspend={() => { setSuspensionReason(''); setSuspending(detail); }}
        onReactivate={() => void updateAccess(detail, 'reactivate_tenant')} accessBusy={updating} />
    );
  }

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
                  </div>
                </div>
              );
            })}
          </div>
          <PlatformPagination page={currentPage} total={filtered.length} onPage={setPage} />
        </>
      )}

    </div>
  );
}

const MODULE_DEFS: { key: string; name: string; desc: string; icon: typeof Gauge }[] = [
  { key: 'dashboard', name: 'Tableau de bord', desc: 'KPIs et vue d\'ensemble', icon: Gauge },
  { key: 'pos', name: 'Caisse (POS)', desc: 'Encaissement, ventes', icon: CreditCard_ },
  { key: 'cash_history', name: 'Historique caisse', desc: 'Sessions, ouvertures/clôtures', icon: Clock },
  { key: 'vault', name: 'Coffre', desc: 'Coffre physique par point de vente', icon: Lock },
  { key: 'sales', name: 'Journal des ventes', desc: 'Liste et rapports ventes', icon: LineChart },
  { key: 'articles', name: 'Articles', desc: 'Catalogue produits', icon: Package_ },
  { key: 'stock', name: 'Stock', desc: 'Inventaire, mouvements', icon: Boxes_ },
  { key: 'billing', name: 'Facturation', desc: 'Devis, factures, avoirs', icon: FileText_ },
  { key: 'online_orders', name: 'Commandes en ligne', desc: 'Boutique en ligne', icon: Globe_ },
  { key: 'tiers', name: 'Tiers', desc: 'Clients & fournisseurs', icon: Users },
  { key: 'supplier_orders', name: 'Achats', desc: 'Approvisionnement', icon: ShoppingBag_ },
  { key: 'accounting', name: 'Comptabilité', desc: 'Plan comptable SYSCOHADA', icon: BookOpen_ },
  { key: 'reports', name: 'États / Rapports', desc: 'Statistiques et rapports', icon: BarChart3 },
  { key: 'ipm', name: 'IPM / Tiers payant', desc: 'Gestion mutuelle pharmacie', icon: HeartPulse },
  { key: 'money_transfer', name: 'Transfert d\'argent', desc: 'Gestion des transferts nationaux et internationaux', icon: ArrowRightLeft },
  { key: 'settings', name: 'Paramètres', desc: 'Configuration tenant', icon: Settings_ },
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

  const currentType = activityTypes.find(item => form.business_activity_type_id
    ? form.business_activity_type_id === item.id
    : form.business_type === (item.legacy_business_type || item.slug));

  return (
    <div className="pa-page">
      <label className="pa-field-label pa-form">Type de commerce
        <select className="w-input-ul" value={currentType?.id || ''} onChange={event => {
          const activity = activityTypes.find(item => item.id === event.target.value);
          if (activity) selectActivity(activity);
        }}>
          <option value="" disabled>Choisir une activité</option>
          {activityTypes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>

      {usage && (
        <section className="pa-panel">
          <h3 className="pa-heading">Utilisation de l’offre</h3>
          <dl className="pa-record-summary">
            <UsageLine label="Magasins" current={usage.sites_count} limit={usage.plan_limits?.sites} />
            <UsageLine label="Utilisateurs" current={usage.users_count} limit={usage.plan_limits?.users} />
            <UsageLine label="Articles" current={usage.articles_count} limit={usage.plan_limits?.articles} />
          </dl>
        </section>
      )}

      <section className="pa-panel">
        <div className="pa-section-head">
          <h3 className="pa-heading">Modules accessibles</h3>
          <div className="pa-inline">
            <button type="button" onClick={minimal} className="pa-link">Sélection minimale</button>
            <button type="button" onClick={allOn} className="pa-link">Tout activer</button>
          </div>
        </div>
        <div className="pa-toggle-list">
          {MODULE_DEFS.map(({ key, name, desc, icon: Icon }) => (
            <label className="pa-toggle-row" key={key}>
              <Icon size={16} aria-hidden="true" />
              <span><strong>{name}</strong><small>{desc}</small></span>
              <input type="checkbox" checked={modules.includes(key)} onChange={() => toggle(key)} />
            </label>
          ))}
        </div>
      </section>

      <div className="pa-form-actions">
        <button type="button" onClick={onSave} disabled={saving} className="pa-button" data-variant="primary">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Enregistrer les modules
        </button>
      </div>
    </div>
  );
}

function UsageLine({ label, current, limit }: { label: string; current?: number; limit?: number }) {
  return <div><dt>{label}</dt><dd>{current ?? 0}{limit != null && limit >= 0 ? ' / ' + limit : ' · sans limite'}</dd></div>;
}

function TenantDetailPage({ tenant, plans, onClose, onRefresh, onDelete, onOpenSubscription, subscriptionMode = false, noticeActions, onSuspend, onReactivate, accessBusy }: {
  tenant: any; plans: any[]; onClose: () => void; onRefresh: () => void;
  onDelete?: (tenant: any) => void; onOpenSubscription?: (tenantId: string) => void;
  subscriptionMode?: boolean;
  onSuspend?: () => void;
  onReactivate?: () => void;
  accessBusy?: boolean;
  noticeActions?: { busy: 'reminder' | 'email' | null; send: (kind: 'reminder' | 'email') => void };
}) {
  const [detail, setDetail] = useState<any>(null);
  const [tab, setTab] = useState<'info' | 'sub' | 'modules' | 'users' | 'history' | 'danger'>(subscriptionMode ? 'sub' : 'info');
  const [form, setForm] = useState<any>({
    ...tenant,
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
          business_type: form.business_type,
          business_activity_type_id: form.business_activity_type_id || null,
          enabled_modules: form.enabled_modules,
          subdomain: form.subdomain || null,
          custom_domain: form.custom_domain || null,
        },
      });
      success('Entreprise mise à jour');
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
    { k: 'info', l: 'Identité' },
    { k: 'modules', l: 'Modules' },
    { k: 'users', l: 'Utilisateurs' },
    { k: 'history', l: 'Historique' },
    { k: 'danger', l: 'Accès' },
  ];

  return (
    <PlatformWorkPage title={tenant.name} backLabel={subscriptionMode ? 'Retour aux abonnements' : 'Retour aux entreprises'}
      onBack={onClose} busy={saving} actions={!subscriptionMode && onOpenSubscription && (
        <button type="button" className="pa-link" onClick={() => onOpenSubscription(tenant.id)}>
          Gérer l’abonnement <ChevronRight size={15} />
        </button>
      )}>
      <div className="pa-page">
        {!subscriptionMode && (
          <>
            <nav className="pa-tabs" aria-label="Fiche de l’entreprise">
              {tabs.map(item => <button type="button" key={item.k} aria-current={tab === item.k ? 'page' : undefined} onClick={() => setTab(item.k)}>{item.l}</button>)}
            </nav>
          </>
        )}
        <div>
          {!detail ? <PlatformLoading /> : (
            <>
              {tab === 'info' && (
                <form className="pa-form" onSubmit={event => { event.preventDefault(); void saveInfo(); }}>
                  <div className="pa-form-grid">
                    {([['name', 'Nom'], ['legal_name', 'Raison sociale'], ['email', 'E-mail'], ['phone', 'Téléphone'], ['whatsapp_phone', 'WhatsApp']] as const).map(([key, label]) => (
                      <label key={key} className="pa-field-label">{label}
                        <input className="w-input-ul" value={form[key] || ''} required={key === 'name'}
                          onChange={event => setForm({ ...form, [key]: event.target.value })} />
                      </label>
                    ))}
                    <label className="pa-field-label">Sous-domaine
                      <input className="w-input-ul" value={form.subdomain || ''}
                        onChange={event => setForm({ ...form, subdomain: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} />
                    </label>
                    <label className="pa-field-label">Domaine personnalisé
                      <input className="w-input-ul" value={form.custom_domain || ''}
                        onChange={event => setForm({ ...form, custom_domain: event.target.value.toLowerCase().trim() })} />
                    </label>
                  </div>
                  <div className="pa-form-actions">
                    <button type="submit" className="pa-button" data-variant="primary" disabled={saving}>
                      {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Enregistrer l’identité
                    </button>
                  </div>
                </form>
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
                (detail.users || []).length === 0 ? <p className="pa-empty">Aucun utilisateur.</p> : (
                  <div className="pa-divided">
                    {detail.users.map((user: any) => (
                      <div className="pa-setting-row" key={user.id}>
                        <div className="min-w-0">
                          <strong className="pa-break">{user.full_name || user.email}</strong>
                          {user.full_name && <p className="pa-row-subtitle pa-break">{user.email}</p>}
                        </div>
                        <span className="pa-muted">{user.role} · {user.is_active ? 'Actif' : 'Inactif'}</span>
                      </div>
                    ))}
                  </div>
                )
              )}

              {tab === 'history' && (
                (detail.events || []).length === 0 ? <p className="pa-empty">Aucun événement pour cette entreprise.</p> : (
                  <div className="pa-divided">
                    {detail.events.map((event: PlatformEvent) => <EventRow key={event.id} ev={event} />)}
                  </div>
                )
              )}

              {tab === 'danger' && (
                <div className="pa-divided">
                  <div className="pa-setting-row">
                    <div>
                      <strong>Restauration et réinitialisation</strong>
                      <p className="pa-row-subtitle">Accès aux opérations de restauration, de réinitialisation et d’import pour cette entreprise.</p>
                    </div>
                    <label className="pa-inline">
                      <input type="checkbox" checked={activationLock === true} disabled={activationLoading || activationLock === null}
                        onChange={() => void toggleActivation()} />
                      Autoriser
                    </label>
                  </div>
                  {tenant.approval_status !== 'pending' && (
                    <div className="pa-setting-row">
                      <div>
                        <strong>Accès à Waarwi</strong>
                        <p className="pa-row-subtitle">{tenant.is_active ? 'L’entreprise peut utiliser son espace.' : 'L’accès de l’entreprise est suspendu.'}</p>
                      </div>
                      {tenant.is_active ? (
                        <button type="button" onClick={onSuspend} disabled={accessBusy} className="pa-link">
                          <Pause size={16} /> Suspendre
                        </button>
                      ) : (
                        <button type="button" onClick={onReactivate} disabled={accessBusy} className="pa-link">
                          <Power size={16} /> Réactiver
                        </button>
                      )}
                    </div>
                  )}
                  {onDelete && (
                    <div className="pa-setting-row">
                      <div>
                        <strong>Suppression de l’entreprise</strong>
                        <p className="pa-row-subtitle">Efface définitivement son espace et ses données.</p>
                      </div>
                      <button type="button" onClick={() => onDelete(tenant)} className="pa-link pa-danger">
                        <Trash2 size={16} /> Supprimer
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </PlatformWorkPage>
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

  if (toDelete) {
    return (
      <PlatformConfirmation title="Supprimer cette offre ?" backLabel="Retour à l’offre" onBack={() => setToDelete(null)}
        message={'Supprimer l’offre « ' + toDelete.name + ' » du catalogue.'} label="Supprimer l’offre" danger
        onConfirm={async () => {
          await call('delete_plan', { code: toDelete.code });
          success('Offre supprimée');
          setToDelete(null);
          setForm(null);
          await load();
        }} />
    );
  }

  if (form) {
    return (
      <PlatformWorkPage title={editing ? 'Modifier l’offre' : 'Nouvelle offre'} backLabel="Retour aux offres"
        onBack={() => setForm(null)} busy={saving}>
        <form className="pa-form" onSubmit={event => { event.preventDefault(); void save(); }}>
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
            <h3 className="pa-heading">Tarifs</h3>
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
            <h3 className="pa-heading">Remises sur le paiement d’avance</h3>
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
            <summary className="pa-expander">Limites et modules</summary>
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
          <div className="pa-form-actions">
            {editing && <button type="button" className="pa-link pa-danger mr-auto" disabled={saving}
              onClick={() => setToDelete({ code: form.code, name: form.name })}>Supprimer l’offre</button>}
            <button type="submit" className="pa-button" data-variant="primary" disabled={saving}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Enregistrer l’offre
            </button>
          </div>
        </form>
      </PlatformWorkPage>
    );
  }

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

  if (selected) {
    return (
      <TenantDetailPage key={selected.id} tenant={selected} plans={plans} subscriptionMode
        onClose={() => setSelectedId(undefined)} onRefresh={refresh}
        noticeActions={reminderIds.has(selected.id) ? { busy: sending, send: kind => void sendNotice(selected.id, kind) } : undefined} />
    );
  }

  if (rulesOpen) {
    return (
      <PlatformWorkPage title="Règles de suivi" backLabel="Retour aux abonnements" onBack={() => setRulesOpen(false)} busy={!!rulesBusy}>
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
      </PlatformWorkPage>
    );
  }

  return (
    <div className="pa-page">
      <nav className="pa-status-strip" aria-label="Accès rapide aux statuts">
        {([
          ['pending', 'Inscriptions à valider', rows.filter(row => row.status === 'pending').length],
          ['due', 'Échéances sous ' + reminderDays + ' jours', dueLoading ? '—' : dueIds.size],
          ['expired', 'Abonnements expirés', rows.filter(row => row.status === 'expired').length],
          ['active', 'Abonnements actifs', rows.filter(row => row.status === 'active').length],
        ] as const).map(([key, label, count]) => (
          <button type="button" className="pa-link" key={key} aria-label={label + ' ' + count}
            aria-pressed={statusFilter === key} onClick={() => selectFilter(statusFilter === key ? 'all' : key)}>
            <span>{label}</span> <strong>{count}</strong>
          </button>
        ))}
      </nav>

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
    </div>
  );
}

function MessagesSection() {
  const [messages, setMessages] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
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
    if (!form.title?.trim() || publishing) return;
    setPublishing(true);
    try {
      await call('create_message', { ...form, expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null });
      success('Message publié');
      setOpen(false); setForm({ severity: 'info', target: 'all', requires_ack: true }); load();
    } catch (e: any) { error(e.message); }
    finally { setPublishing(false); }
  };

  if (toDelete) {
    return (
      <PlatformConfirmation title="Supprimer ce message ?" backLabel="Retour aux messages" onBack={() => setToDelete(null)}
        message={'Le message « ' + toDelete.title + ' » cessera d’être affiché.'} label="Supprimer le message" danger
        onConfirm={async () => {
          await call('delete_message', { id: toDelete.id });
          success('Message supprimé');
          setToDelete(null);
          setPreview(null);
          await load();
        }} />
    );
  }

  if (preview) {
    const target = preview.target === 'tenant' ? preview.tenants?.name || 'Entreprise sélectionnée'
      : preview.target === 'plan' ? plans.find(plan => plan.code === preview.plan_code)?.name || preview.plan_code : 'Toutes les entreprises';
    return (
      <PlatformWorkPage title={preview.title} backLabel="Retour aux messages" onBack={() => setPreview(null)}
        actions={<button type="button" className="pa-link pa-danger" onClick={() => setToDelete(preview)}><Trash2 size={16} /> Supprimer</button>}>
        <dl className="pa-record-summary">
          <div><dt>Destinataires</dt><dd>{target}</dd></div>
          <div><dt>Type</dt><dd>{messageTypes[preview.severity] || messageTypes.info}</dd></div>
          <div><dt>Publié le</dt><dd>{formatDateTime(preview.created_at)}</dd></div>
          {preview.expires_at && <div><dt>Expiration</dt><dd>{formatDateTime(preview.expires_at)}</dd></div>}
        </dl>
        <p className="pa-copy whitespace-pre-wrap">{preview.body}</p>
        {preview.cta_label && (
          <dl className="pa-keyvals">
            <div><dt>Bouton</dt><dd>{preview.cta_label}</dd></div>
            {preview.cta_url && <div><dt>Adresse</dt><dd>{preview.cta_url}</dd></div>}
          </dl>
        )}
      </PlatformWorkPage>
    );
  }

  if (open) {
    return (
      <PlatformWorkPage title="Nouveau message" backLabel="Retour aux messages" onBack={() => setOpen(false)} busy={publishing}>
        <form className="pa-form" onSubmit={event => { event.preventDefault(); void save(); }}>
          <label className="pa-field-label">Titre
            <input className="w-input-ul" required value={form.title || ''} onChange={event => setForm({ ...form, title: event.target.value })} />
          </label>
          <label className="pa-field-label">Message
            <textarea rows={4} className="w-input-ul" value={form.body || ''} onChange={event => setForm({ ...form, body: event.target.value })} />
          </label>
          <div className="pa-form-grid">
            <label className="pa-field-label">Type
              <select className="w-input-ul" value={form.severity} onChange={event => setForm({ ...form, severity: event.target.value })}>
                {Object.entries(messageTypes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <label className="pa-field-label">Destinataires
              <select className="w-input-ul" value={form.target} onChange={event => setForm({ ...form, target: event.target.value })}>
                <option value="all">Toutes les entreprises</option><option value="tenant">Une entreprise</option><option value="plan">Les abonnés à une offre</option>
              </select>
            </label>
            {form.target === 'tenant' && (
              <label className="pa-field-label">Entreprise
                <select className="w-input-ul" required value={form.tenant_id || ''} onChange={event => setForm({ ...form, tenant_id: event.target.value })}>
                  <option value="">Choisir une entreprise</option>
                  {tenants.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
            )}
            {form.target === 'plan' && (
              <label className="pa-field-label">Offre
                <select className="w-input-ul" required value={form.plan_code || ''} onChange={event => setForm({ ...form, plan_code: event.target.value })}>
                  <option value="">Choisir une offre</option>
                  {plans.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
                </select>
              </label>
            )}
            <label className="pa-field-label">Expiration
              <input className="w-input-ul" type="datetime-local" value={form.expires_at || ''} onChange={event => setForm({ ...form, expires_at: event.target.value })} />
            </label>
            <label className="pa-field-label">Libellé du bouton
              <input className="w-input-ul" value={form.cta_label || ''} onChange={event => setForm({ ...form, cta_label: event.target.value })} />
            </label>
            <label className="pa-field-label">Adresse du bouton
              <input className="w-input-ul" value={form.cta_url || ''} onChange={event => setForm({ ...form, cta_url: event.target.value })} />
            </label>
          </div>
          <label className="pa-inline">
            <input type="checkbox" checked={form.requires_ack !== false} onChange={event => setForm({ ...form, requires_ack: event.target.checked })} />
            Demander un accusé de lecture
          </label>
          <div className="pa-form-actions">
            <button type="submit" className="pa-button" data-variant="primary" disabled={publishing}>
              {publishing ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Publier le message
            </button>
          </div>
        </form>
      </PlatformWorkPage>
    );
  }

  return (
    <div className="pa-page">
      <div className="pa-section-head">
        <span className="pa-muted text-sm">{messages.length} message{messages.length > 1 ? 's' : ''}</span>
        <button type="button" onClick={() => setOpen(true)} className="pa-button" data-variant="primary"><Plus size={16} /> Nouveau message</button>
      </div>
      {loading ? <PlatformLoading /> : messages.length === 0 ? <p className="pa-empty">Aucun message publié.</p> : (
        <div className="pa-divided">
          {messages.map(message => {
            const severity = messageTypes[message.severity] || messageTypes.info;
            const expired = message.expires_at && Date.parse(message.expires_at) < Date.now();
            const target = message.target === 'all' ? 'Toutes les entreprises' : message.target === 'tenant'
              ? message.tenants?.name || 'Entreprise' : message.plan_code;
            return (
              <article className="pa-message-row" key={message.id}>
                <div className="min-w-0">
                  <button type="button" onClick={() => setPreview(message)} className="pa-name-button">{message.title}</button>
                  <p className="pa-row-subtitle">{target} · {severity} · {formatDateTime(message.created_at)}{expired ? ' · Expiré' : ''}</p>
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

const accentNames: Record<TextAccent['effect'], string> = {
  underline: 'Soulignement', wavyUnderline: 'Soulignement ondulé', shortUnderline: 'Trait court',
  paint: 'Peinture', paintStroke: 'Coup de pinceau', marker: 'Marqueur', highlight: 'Surlignage',
  brush: 'Trait épais', circle: 'Cercle', starburst: 'Rayons', boxed: 'Encadré',
  glow: 'Lueur', splash: 'Couleur en italique', strikethrough: 'Barré',
};

type LoginEditorTab = 'textes' | 'modules' | 'effets' | 'apercu';
type EditableLogin = Pick<LoginConfig, 'headline' | 'headline_accent' | 'eyebrow' | 'subtitle' | 'login_title' | 'login_subtitle' | 'login_bg_url' | 'modules' | 'text_accents'>;
type LoginRowDraft =
  | { kind: 'module'; index: number | null; value: LoginModule }
  | { kind: 'accent'; index: number | null; value: TextAccent };

const loginTabs: { key: LoginEditorTab; label: string }[] = [
  { key: 'textes', label: 'Textes et image' }, { key: 'modules', label: 'Modules' },
  { key: 'effets', label: 'Mise en forme' }, { key: 'apercu', label: 'Aperçu' },
];

function LoginConfigSection() {
  const { success, error } = useToast();
  const [config, setConfig] = useState<EditableLogin | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [tab, setTab] = useState<LoginEditorTab>('textes');
  const [draft, setDraft] = useState<LoginRowDraft | null>(null);
  const [previewSlide, setPreviewSlide] = useState(0);

  useEffect(() => {
    call('get_login_config').then(data => setConfig({
      headline: data.headline ?? '', headline_accent: data.headline_accent ?? '',
      subtitle: data.subtitle ?? '', eyebrow: data.eyebrow ?? '',
      login_title: data.login_title ?? '', login_subtitle: data.login_subtitle ?? '',
      login_bg_url: data.login_bg_url ?? null,
      modules: Array.isArray(data.modules) ? data.modules : [],
      text_accents: Array.isArray(data.text_accents) ? data.text_accents : [],
    })).catch(cause => error(cause.message)).finally(() => setLoading(false));
  }, []);

  if (loading) return <PlatformLoading />;
  if (!config) return <p className="pa-empty">La configuration de la connexion est indisponible.</p>;

  const update = <K extends keyof EditableLogin,>(key: K, value: EditableLogin[K]) => {
    setConfig(previous => previous && { ...previous, [key]: value });
  };
  const save = async () => {
    setSaving(true);
    try {
      await call('update_login_config', config);
      success('Configuration de l’écran de connexion enregistrée');
    } catch (cause) { error((cause as Error).message); }
    finally { setSaving(false); }
  };
  const upload = async (file: File) => {
    if (file.size > 3 * 1024 * 1024) { error('Image trop lourde. Taille maximale de 3 Mo.'); return; }
    setUploading(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = 'platform/login-bg-' + Date.now() + '.' + ext;
      const bucket = supabase.storage.from('tenant-logos');
      const { error: uploadError } = await bucket.upload(path, file, { cacheControl: '86400', upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;
      update('login_bg_url', bucket.getPublicUrl(path).data.publicUrl);
      success('Image chargée');
    } catch (cause) { error((cause as Error).message); }
    finally { setUploading(false); }
  };
  const moveModule = (index: number, step: -1 | 1) => {
    const modules = config.modules.slice();
    const next = index + step;
    if (next < 0 || next >= modules.length) return;
    [modules[index], modules[next]] = [modules[next], modules[index]];
    update('modules', modules);
  };
  const applyDraft = () => {
    if (draft?.kind === 'module') {
      const modules = config.modules.slice();
      modules[draft.index ?? modules.length] = { ...draft.value, label: draft.value.label.trim() };
      update('modules', modules);
    } else if (draft) {
      const accents = config.text_accents.slice();
      accents[draft.index ?? accents.length] = { ...draft.value, text: draft.value.text.trim() };
      update('text_accents', accents);
    }
    setDraft(null);
  };

  return (
    <div className="pa-page">
      <div className="pa-editor-nav">
        <nav className="pa-tabs" aria-label="Configuration de la connexion">
          {loginTabs.map(item => (
            <button type="button" key={item.key} aria-current={tab === item.key ? 'page' : undefined}
              onClick={() => { setDraft(null); setTab(item.key); }}>{item.label}</button>
          ))}
        </nav>
        {!draft && <button type="button" className="pa-button" data-variant="primary" onClick={() => void save()} disabled={saving || uploading}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Enregistrer les modifications
        </button>}
      </div>

      {draft ? (
        <PlatformWorkPage title={draft.kind === 'module' ? (draft.index === null ? 'Ajouter un module' : 'Modifier le module')
          : (draft.index === null ? 'Ajouter une mise en forme' : 'Modifier la mise en forme')}
          backLabel={draft.kind === 'module' ? 'Retour aux modules' : 'Retour aux mises en forme'} onBack={() => setDraft(null)}>
          <form className="pa-form" onSubmit={event => { event.preventDefault(); applyDraft(); }}>
            {draft.kind === 'module' ? (
              <div className="pa-form-grid">
                <label className="pa-field-label">Nom du module
                  <input required className="w-input-ul" value={draft.value.label} onChange={event => setDraft({ ...draft, value: { ...draft.value, label: event.target.value } })} />
                </label>
                <label className="pa-field-label">Icône
                  <select className="w-input-ul" value={draft.value.icon} onChange={event => setDraft({ ...draft, value: { ...draft.value, icon: event.target.value } })}>
                    {AVAILABLE_ICONS.map(icon => <option value={icon.value} key={icon.value}>{icon.label}</option>)}
                  </select>
                </label>
                <label className="pa-field-label">Description
                  <input className="w-input-ul" value={draft.value.desc} onChange={event => setDraft({ ...draft, value: { ...draft.value, desc: event.target.value } })} />
                </label>
              </div>
            ) : (
              <div className="pa-form-grid">
                <label className="pa-field-label">Texte à mettre en valeur
                  <input required className="w-input-ul" value={draft.value.text} onChange={event => setDraft({ ...draft, value: { ...draft.value, text: event.target.value } })} />
                </label>
                <label className="pa-field-label">Style
                  <select className="w-input-ul" value={draft.value.effect}
                    onChange={event => setDraft({ ...draft, value: { ...draft.value, effect: event.target.value as TextAccent['effect'] } })}>
                    {Object.entries(accentNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="pa-field-label">Couleur
                  <input type="color" value={draft.value.color} onChange={event => setDraft({ ...draft, value: { ...draft.value, color: event.target.value } })} />
                </label>
                {draft.value.text && <p className="pa-copy"><AccentedText text={draft.value.text} accents={[draft.value]} /></p>}
              </div>
            )}
            <div className="pa-form-actions">
              <button type="submit" className="pa-button" data-variant="primary"><Check size={16} /> Appliquer</button>
            </div>
          </form>
        </PlatformWorkPage>
      ) : tab === 'textes' ? (
        <div className="pa-form">
          <section className="space-y-2">
            <h2 className="pa-heading">Présentation de Waarwi</h2>
            <div className="pa-form-grid">
              {([['headline', 'Début du titre'], ['headline_accent', 'Suite du titre'], ['eyebrow', 'Texte au-dessus du titre']] as const).map(([key, label]) => (
                <label className="pa-field-label" key={key}>{label}
                  <input className="w-input-ul" value={config[key]} placeholder={DEFAULT_LOGIN_CONFIG[key]} onChange={event => update(key, event.target.value)} />
                </label>
              ))}
              <label className="pa-field-label">Texte de présentation
                <textarea className="w-input-ul" rows={2} value={config.subtitle} onChange={event => update('subtitle', event.target.value)} />
              </label>
            </div>
          </section>
          <section className="pa-panel space-y-2">
            <h2 className="pa-heading">Formulaire de connexion</h2>
            <div className="pa-form-grid">
              <label className="pa-field-label">Titre de la connexion
                <input className="w-input-ul" value={config.login_title} placeholder={DEFAULT_LOGIN_CONFIG.login_title} onChange={event => update('login_title', event.target.value)} />
              </label>
              <label className="pa-field-label">Sous-titre de la connexion
                <input className="w-input-ul" value={config.login_subtitle} onChange={event => update('login_subtitle', event.target.value)} />
              </label>
            </div>
          </section>
          <section className="pa-panel">
            <h2 className="pa-heading">Image de fond</h2>
            <div className="pa-setting-row">
              {config.login_bg_url && <img src={config.login_bg_url} alt="Image de fond enregistrée" className="h-16 max-w-40 object-contain" />}
              <label className="pa-field-label">Choisir une image, 3 Mo maximum
                <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} className="pa-file"
                  onChange={event => {
                    const file = event.target.files?.[0];
                    if (file) void upload(file);
                    event.target.value = '';
                  }} />
              </label>
              {config.login_bg_url && <button type="button" className="pa-link pa-danger" onClick={() => update('login_bg_url', null)}>Retirer l’image</button>}
              {uploading && <Loader2 size={16} className="animate-spin" />}
            </div>
          </section>
        </div>
      ) : tab === 'modules' ? (
        <section className="pa-page">
          <div className="pa-section-head">
            <h2 className="pa-heading">Modules affichés</h2>
            <div className="pa-inline">
              <button type="button" className="pa-link" onClick={() => update('modules', DEFAULT_LOGIN_MODULES.slice())}><RotateCcw size={15} /> Rétablir la liste</button>
              <button type="button" className="pa-button" data-variant="primary" onClick={() => setDraft({ kind: 'module', index: null, value: { icon: 'ShoppingCart', label: '', desc: '' } })}>
                <Plus size={16} /> Ajouter un module
              </button>
            </div>
          </div>
          {config.modules.length === 0 ? <p className="pa-empty">La liste de modules par défaut s’affiche à la connexion.</p> : (
            <div className="pa-divided">
              {config.modules.map((module, index) => {
                const Icon = LOGIN_ICON_MAP[module.icon] || Shield;
                return (
                  <div className="pa-setting-row" key={index}>
                    <div className="pa-inline">
                      <Icon size={16} aria-hidden="true" />
                      <div><button type="button" className="pa-name-button"
                        onClick={() => setDraft({ kind: 'module', index, value: module })}>{module.label || 'Module sans nom'}</button>
                        <p className="pa-row-subtitle">{module.desc}</p></div>
                    </div>
                    <div className="pa-row-actions">
                      <button type="button" aria-label={'Monter ' + module.label} className="pa-icon-button" disabled={index === 0} onClick={() => moveModule(index, -1)}><ChevronUp size={16} /></button>
                      <button type="button" aria-label={'Descendre ' + module.label} className="pa-icon-button" disabled={index >= config.modules.length - 1} onClick={() => moveModule(index, 1)}><ChevronDown size={16} /></button>
                      <button type="button" aria-label={'Modifier ' + module.label} className="pa-icon-button" onClick={() => setDraft({ kind: 'module', index, value: module })}><Edit2 size={16} /></button>
                      <button type="button" aria-label={'Retirer ' + module.label} className="pa-icon-button pa-danger" onClick={() => update('modules', config.modules.filter((_, i) => i !== index))}><Trash2 size={16} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : tab === 'effets' ? (
        <section className="pa-page">
          <div className="pa-section-head">
            <h2 className="pa-heading">Mise en forme des textes publics</h2>
            <button type="button" className="pa-button" data-variant="primary"
              onClick={() => setDraft({ kind: 'accent', index: null, value: { text: '', effect: 'underline', color: '#141414' } })}>
              <Plus size={16} /> Ajouter une mise en forme
            </button>
          </div>
          {config.text_accents.length === 0 ? <p className="pa-empty">Aucune mise en forme personnalisée.</p> : (
            <div className="pa-divided">
              {config.text_accents.map((accent, index) => (
                <div className="pa-setting-row" key={index}>
                  <div>
                    <button type="button" className="pa-name-button" onClick={() => setDraft({ kind: 'accent', index, value: accent })}>{accent.text || 'Texte à renseigner'}</button>
                    <p className="pa-row-subtitle">{accentNames[accent.effect]}</p>
                  </div>
                  <div className="pa-row-actions">
                    <button type="button" aria-label={'Modifier ' + accent.text} className="pa-icon-button" onClick={() => setDraft({ kind: 'accent', index, value: accent })}><Edit2 size={16} /></button>
                    <button type="button" aria-label={'Retirer ' + accent.text} className="pa-icon-button pa-danger" onClick={() => update('text_accents', config.text_accents.filter((_, i) => i !== index))}><Trash2 size={16} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <LoginContentPreview config={config} slide={previewSlide} onSlide={setPreviewSlide} />
      )}
    </div>
  );
}

function LoginContentPreview({ config, slide, onSlide }: { config: EditableLogin; slide: number; onSlide: (value: number) => void }) {
  const modules = config.modules.length > 0 ? config.modules : DEFAULT_LOGIN_MODULES;
  const slides = Math.ceil(modules.length / 3);
  const current = Math.min(slide, slides - 1);
  const accents = config.text_accents.filter(item => item.text);
  const headline = (config.headline || DEFAULT_LOGIN_CONFIG.headline) + ' ' + (config.headline_accent || DEFAULT_LOGIN_CONFIG.headline_accent);
  return (
    <div className="pa-overview-grid">
      <section className="space-y-3">
        <h2 className="pa-heading">Présentation</h2>
        <p className="pa-muted text-xs">{config.eyebrow || DEFAULT_LOGIN_CONFIG.eyebrow}</p>
        <p className="pa-preview-heading"><AccentedText text={headline} accents={accents} /></p>
        <p className="pa-copy"><AccentedText text={config.subtitle || DEFAULT_LOGIN_CONFIG.subtitle} accents={accents} /></p>
        <div className="pa-divided">
          {modules.slice(current * 3, current * 3 + 3).map((module, index) => {
            const Icon = LOGIN_ICON_MAP[module.icon] || Shield;
            return <div className="pa-setting-row justify-start" key={index}><Icon size={16} /><div><strong>{module.label}</strong><p className="pa-row-subtitle">{module.desc}</p></div></div>;
          })}
        </div>
        {slides > 1 && <nav className="pa-inline text-xs" aria-label="Aperçu des modules">
          <button type="button" className="pa-icon-button" aria-label="Modules précédents" disabled={current === 0} onClick={() => onSlide(current - 1)}><ChevronLeft size={16} /></button>
          <span>{current + 1} / {slides}</span>
          <button type="button" className="pa-icon-button" aria-label="Modules suivants" disabled={current === slides - 1} onClick={() => onSlide(current + 1)}><ChevronRight size={16} /></button>
        </nav>}
      </section>
      <section className="space-y-3">
        <h2 className="pa-heading">Connexion</h2>
        <p className="pa-preview-heading"><AccentedText text={config.login_title || DEFAULT_LOGIN_CONFIG.login_title} accents={accents} /></p>
        <p className="pa-copy"><AccentedText text={config.login_subtitle || DEFAULT_LOGIN_CONFIG.login_subtitle} accents={accents} /></p>
      </section>
    </div>
  );
}

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
    const { error: failure } = await supabase.from('app_releases').update({
      is_published: newState,
      published_at: newState ? new Date().toISOString() : null,
    }).eq('id', r.id);
    if (failure) { error(failure.message); return; }
    success(newState ? 'Publiée ! Les utilisateurs verront la notification.' : 'Dépubliée.');
    load();
  };

  const deleteRelease = async (id: string) => {
    const { error: failure } = await supabase.from('app_releases').delete().eq('id', id);
    if (failure) throw failure;
    setDeleteConfirm(null);
    success('Supprimée');
    load();
  };

  if (deleteConfirm) {
    return (
      <PlatformConfirmation title="Supprimer cette mise à jour ?" backLabel="Retour aux versions" onBack={() => setDeleteConfirm(null)}
        message="La suppression est définitive." label="Supprimer la version" danger onConfirm={() => deleteRelease(deleteConfirm)} />
    );
  }

  if (editOpen) {
    return (
      <PlatformWorkPage title={editId ? 'Modifier la mise à jour' : 'Nouvelle mise à jour'} backLabel="Retour aux versions"
        busy={saving} onBack={() => setEditOpen(false)}>
        <form className="pa-form" onSubmit={event => { event.preventDefault(); void save(); }}>
          <div className="pa-form-grid">
            <label className="pa-field-label">Version
              <input className="w-input-ul" required value={form.version} onChange={event => setForm({ ...form, version: event.target.value })} />
            </label>
            <label className="pa-field-label">Date
              <input className="w-input-ul" type="date" value={form.release_date} onChange={event => setForm({ ...form, release_date: event.target.value })} />
            </label>
          </div>
          <label className="pa-field-label">Titre
            <input className="w-input-ul" value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} />
          </label>
          <label className="pa-field-label">Nouveautés, une par ligne
            <textarea className="w-input-ul" rows={4} value={form.features} onChange={event => setForm({ ...form, features: event.target.value })} />
          </label>
          <label className="pa-field-label">Corrections, une par ligne
            <textarea className="w-input-ul" rows={4} value={form.fixes} onChange={event => setForm({ ...form, fixes: event.target.value })} />
          </label>
          <div className="pa-form-actions">
            <button type="submit" disabled={saving} className="pa-button" data-variant="primary">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Enregistrer la version
            </button>
          </div>
        </form>
      </PlatformWorkPage>
    );
  }

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

    </div>
  );
}
