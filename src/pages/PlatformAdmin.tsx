import { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowUpRight, Ban, Building2, Check, CircleDollarSign, Clock,
  CreditCard as Edit2, Gauge, Layers, LineChart, Loader2, LogOut, Mail, MessageSquare, Pause, Plus,
  Power, Search, Send, Shield, RotateCcw, Trash2, TrendingUp, Users, Zap, X,
  Wrench as Wrench_, Store as Store_, ShoppingBag as ShoppingBag_, Shirt as Shirt_, Cpu as Cpu_,
  CreditCard as CreditCard_, Package as Package_, Boxes as Boxes_, FileText as FileText_,
  Globe as Globe_, BookOpen as BookOpen_, Settings as Settings_, Info as Info_, Library,
  ShoppingCart, Truck, Wallet, BarChart3, Receipt, Eye, Monitor, Globe, ImagePlus, HeartPulse, Bell, ArrowRightLeft,
  Rocket, Sparkles, Bug,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { Modal, ConfirmDialog } from '../components/Modal';
import { formatCompactFCFA, formatDate, formatDateTime, formatFCFA } from '../lib/format';
import { MasterCatalogAdmin } from '../components/MasterCatalogAdmin';
import { LandingConfigSection as LandingConfigSectionNew } from '../components/LandingConfigSection';

type Section = 'overview' | 'tenants' | 'plans' | 'subscriptions' | 'messages' | 'activity' | 'master_catalogs' | 'login_config' | 'landing' | 'releases';

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

const sidebarGroups = [
  {
    label: 'PLATEFORME',
    items: [
      { k: 'overview' as Section, l: 'Vue d\'ensemble', icon: Gauge },
      { k: 'tenants' as Section, l: 'Tenants', icon: Building2 },
      { k: 'subscriptions' as Section, l: 'Abonnements', icon: CircleDollarSign },
      { k: 'plans' as Section, l: 'Plans & tarifs', icon: Layers },
    ],
  },
  {
    label: 'CONFIGURATION',
    items: [
      { k: 'master_catalogs' as Section, l: 'Catalogues métiers', icon: Library },
      { k: 'login_config' as Section, l: 'Écran d\'accueil', icon: Monitor },
      { k: 'landing' as Section, l: 'Landing page', icon: Globe },
      { k: 'releases' as Section, l: 'Mises à jour', icon: Rocket },
      { k: 'messages' as Section, l: 'Messages', icon: MessageSquare },
    ],
  },
  {
    label: 'SURVEILLANCE',
    items: [
      { k: 'activity' as Section, l: 'Activité', icon: Activity },
    ],
  },
];

export function PlatformAdmin() {
  const [section, setSection] = useState<Section>('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-full min-h-screen lg:min-h-0">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed lg:sticky top-0 left-0 z-50 lg:z-auto h-screen lg:h-screen w-[240px] bg-white border-r border-[#E5E7EB] flex flex-col overflow-y-auto transition-transform lg:transition-none ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="p-4 border-b border-[#E5E7EB]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#111111] flex items-center justify-center overflow-hidden p-0.5">
              <img src="/newlogo.png" alt="W" className="w-full h-full object-contain invert" />
            </div>
            <div>
              <div className="text-sm font-bold text-[#0F172A] leading-tight">Waarwi</div>
              <div className="text-[10px] text-[#64748B] font-medium">Console plateforme</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-5">
          {sidebarGroups.map(group => (
            <div key={group.label}>
              <div className="text-[10px] font-bold text-[#64748B] tracking-wider uppercase px-2.5 mb-1.5">{group.label}</div>
              <div className="space-y-0.5">
                {group.items.map(item => {
                  const I = item.icon;
                  const active = section === item.k;
                  return (
                    <button
                      key={item.k}
                      onClick={() => { setSection(item.k); setSidebarOpen(false); }}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                        active
                          ? 'bg-[#0F172A] text-white'
                          : 'text-[#64748B] hover:bg-[#F7F8FA] hover:text-[#0F172A]'
                      }`}
                    >
                      <I className="w-4 h-4 shrink-0" />
                      <span>{item.l}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-[#E5E7EB]">
          <div className="flex items-center gap-2 px-2.5 py-2 text-[11px] text-[#64748B]">
            <Shield className="w-3.5 h-3.5" />
            <span className="font-medium">Super admin</span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 bg-[#F7F8FA]">
        {/* Compact top bar */}
        <div className="sticky top-0 z-30 bg-white/80 backdrop-blur-sm border-b border-[#E5E7EB] px-4 sm:px-6 py-3 flex items-center gap-3">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-1.5 rounded-lg hover:bg-[#F7F8FA] text-[#64748B]">
            <Layers className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold text-[#0F172A]">
              {sidebarGroups.flatMap(g => g.items).find(i => i.k === section)?.l || 'Console'}
            </h1>
            <p className="text-[11px] text-[#64748B]">Pilotage global de Waarwi</p>
          </div>
          <button
            onClick={() => supabase.auth.signOut()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#E5E7EB] text-xs font-medium text-[#64748B] hover:text-[#0F172A] hover:bg-[#F7F8FA] transition-colors"
            title="Déconnexion"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Déconnexion</span>
          </button>
        </div>

        {/* Page content */}
        <div className="p-4 sm:p-6">
          {section === 'overview' && <OverviewSection />}
          {section === 'tenants' && <TenantsSection />}
          {section === 'plans' && <PlansSection />}
          {section === 'subscriptions' && <SubscriptionsSection />}
          {section === 'messages' && <MessagesSection />}
          {section === 'login_config' && <LoginConfigSection />}
          {section === 'landing' && <LandingConfigSectionNew />}
          {section === 'master_catalogs' && <MasterCatalogAdmin />}
          {section === 'releases' && <ReleasesSection />}
          {section === 'activity' && <ActivitySection />}
        </div>
      </main>
    </div>
  );
}

/* ============== OVERVIEW ============== */
function OverviewSection() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { error } = useToast();

  useEffect(() => {
    (async () => {
      try { setData(await call('platform_overview')); }
      catch (e: any) { error(e.message); }
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="py-20 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#64748B]" /></div>;
  if (!data) return null;

  const planColors: Record<string, string> = {
    trial: 'bg-[#94A3B8]',
    starter: 'bg-[#0F172A]',
    pro: 'bg-[#10B981]',
    enterprise: 'bg-[#F59E0B]',
  };

  const pendingTenants = data.tenants_total - data.tenants_active - data.tenants_suspended;
  const hasAlerts = data.tenants_suspended > 0 || data.expiring_soon?.length > 0;

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={Building2} label="Tenants actifs" value={data.tenants_active} sub={`${data.tenants_total} total`} />
        <KpiCard icon={Wallet} label="MRR" value={formatCompactFCFA(data.mrr)} sub="Revenu mensuel" />
        <KpiCard icon={Users} label="Utilisateurs" value={data.users_total} sub="Tous tenants" />
        <KpiCard icon={AlertTriangle} label="Alertes" value={data.tenants_suspended + (data.expiring_soon?.length || 0)} sub={hasAlerts ? 'Actions requises' : 'Aucune alerte'} alert={hasAlerts} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Plan distribution */}
        <div className="lg:col-span-2 bg-white border border-[#E5E7EB] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[#0F172A]">Répartition par plan</h3>
            <span className="text-[11px] text-[#64748B] font-medium">{data.tenants_total} tenants</span>
          </div>
          <div className="space-y-3">
            {Object.entries(data.by_plan as Record<string, number>).map(([plan, count]) => {
              const pct = data.tenants_total ? (count as number) / data.tenants_total * 100 : 0;
              return (
                <div key={plan}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="capitalize font-medium text-[#0F172A]">{plan}</span>
                    <span className="text-[#64748B]">{count} <span className="text-[#94A3B8]">({pct.toFixed(0)}%)</span></span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#F1F5F9] overflow-hidden">
                    <div className={`h-full rounded-full ${planColors[plan] || 'bg-[#94A3B8]'} transition-all duration-500`} style={{ width: `${Math.max(pct, 2)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Expiring soon */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[#0F172A]">Expirations proches</h3>
            <Clock className="w-4 h-4 text-[#F59E0B]" />
          </div>
          {data.expiring_soon.length === 0 ? (
            <div className="py-8 text-center">
              <Check className="w-8 h-8 text-[#10B981] mx-auto mb-2 opacity-50" />
              <p className="text-xs text-[#64748B]">Aucune expiration dans les 7 jours.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {data.expiring_soon.slice(0, 6).map((t: any) => (
                <div key={t.id} className="flex items-center justify-between text-xs py-2 border-b border-[#F1F5F9] last:border-0">
                  <span className="font-medium text-[#0F172A] truncate">{t.name}</span>
                  <span className="text-[#F59E0B] bg-[#FFFBEB] px-2 py-0.5 rounded text-[10px] font-semibold shrink-0 ml-2">{formatDate(t.plan_expires_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Actions and activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Actions a traiter */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[#0F172A]">Actions à traiter</h3>
            <Bell className="w-4 h-4 text-[#64748B]" />
          </div>
          <div className="space-y-2">
            {data.tenants_suspended > 0 && (
              <ActionItem icon={Ban} label={`${data.tenants_suspended} tenant(s) suspendu(s)`} severity="critical" />
            )}
            {data.expiring_soon?.length > 0 && (
              <ActionItem icon={Clock} label={`${data.expiring_soon.length} expiration(s) dans 7 jours`} severity="warning" />
            )}
            {pendingTenants > 0 && (
              <ActionItem icon={Clock} label={`${pendingTenants} tenant(s) en attente d'approbation`} severity="info" />
            )}
            {data.tenants_suspended === 0 && (data.expiring_soon?.length || 0) === 0 && pendingTenants <= 0 && (
              <div className="py-6 text-center">
                <Check className="w-8 h-8 text-[#10B981] mx-auto mb-2 opacity-50" />
                <p className="text-xs text-[#64748B]">Aucune action en attente.</p>
              </div>
            )}
          </div>
        </div>

        {/* Recent activity */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[#0F172A]">Activité récente</h3>
            <Activity className="w-4 h-4 text-[#64748B]" />
          </div>
          {data.recent_events.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-xs text-[#64748B]">Aucune activité récente.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {data.recent_events.slice(0, 8).map((ev: any) => (
                <EventRow key={ev.id} ev={ev} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionItem({ icon: Icon, label, severity }: { icon: any; label: string; severity: 'critical' | 'warning' | 'info' }) {
  const styles = {
    critical: 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]',
    warning: 'bg-[#FFFBEB] border-[#FDE68A] text-[#92400E]',
    info: 'bg-[#F8FAFC] border-[#E2E8F0] text-[#475569]',
  };
  return (
    <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-xs font-medium ${styles[severity]}`}>
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span>{label}</span>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub, alert }: { icon: any; label: string; value: any; sub: string; alert?: boolean }) {
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${alert ? 'bg-[#FEF2F2] text-[#EF4444]' : 'bg-[#F8FAFC] text-[#64748B]'}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className="text-2xl font-bold text-[#0F172A] leading-tight">{value}</div>
      <div className="text-[11px] font-medium text-[#64748B] mt-0.5">{label}</div>
      <div className="text-[10px] text-[#94A3B8] mt-0.5">{sub}</div>
    </div>
  );
}

function EventRow({ ev }: { ev: any }) {
  const icons: Record<string, any> = {
    'tenant.suspend': Ban, 'tenant.reactivate': Power, 'tenant.update': Edit2,
    'subscription.create': Plus, 'subscription.cancel': X,
    'plan.upsert': Layers, 'plan.delete': Trash2,
    'message.create': MessageSquare, 'message.delete': X,
  };
  const I = icons[ev.action] || Activity;
  const tenantName = ev.tenants?.name || (ev.payload?.name) || (ev.tenant_id ? 'Tenant' : 'Plateforme');
  return (
    <div className="flex items-center gap-2.5 text-[12px] py-2 border-b border-[#F1F5F9] last:border-0">
      <div className="w-6 h-6 shrink-0 rounded-md bg-[#F8FAFC] text-[#64748B] flex items-center justify-center">
        <I className="w-3 h-3" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="font-medium text-[#0F172A]">{ev.action}</span>
        <span className="text-[#94A3B8] ml-1.5">{tenantName}</span>
      </div>
      <div className="text-[10px] text-[#94A3B8] shrink-0">{formatDateTime(ev.created_at)}</div>
    </div>
  );
}

/* ============== TENANTS ============== */
function TenantsSection() {
  const [tenants, setTenants] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'active' | 'suspended' | 'expiring' | 'expired' | 'never_connected'>('all');
  const [detail, setDetail] = useState<any>(null);
  const [actionsOpen, setActionsOpen] = useState<string | null>(null);
  const { success, error } = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const [t, p] = await Promise.all([call('list_tenants'), call('list_plans')]);
      setTenants(t.tenants || []);
      setPlans(p.plans || []);
    } catch (e: any) { error(e.message); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const now = new Date();
    const in7 = new Date(Date.now() + 7 * 86400000);
    return tenants.filter(t => {
      if (q && !`${t.name} ${t.email} ${t.phone} ${t.subdomain || ''} ${t.custom_domain || ''}`.toLowerCase().includes(q.toLowerCase())) return false;
      const exp = t.plan_expires_at ? new Date(t.plan_expires_at) : null;
      const approval = t.approval_status || 'approved';
      if (filter === 'pending' && approval !== 'pending') return false;
      if (filter === 'active' && (!t.is_active || approval !== 'approved')) return false;
      if (filter === 'suspended' && t.is_active) return false;
      if (filter === 'expiring' && (!exp || exp < now || exp > in7)) return false;
      if (filter === 'expired' && (!exp || exp >= now)) return false;
      if (filter === 'never_connected' && t.last_active_at) return false;
      return true;
    });
  }, [tenants, q, filter]);

  const planByCode = useMemo(() => Object.fromEntries(plans.map(p => [p.code, p])), [plans]);

  const suspend = async (t: any, reason: string) => {
    try { await call('suspend_tenant', { tenant_id: t.id, reason }); success('Tenant suspendu'); load(); }
    catch (e: any) { error(e.message); }
  };
  const reactivate = async (t: any) => {
    try { await call('reactivate_tenant', { tenant_id: t.id }); success('Tenant réactivé'); load(); }
    catch (e: any) { error(e.message); }
  };
  const approve = async (t: any) => {
    try { await call('approve_tenant', { tenant_id: t.id }); success('Tenant approuvé'); load(); }
    catch (e: any) { error(e.message); }
  };
  const reject = async (t: any, reason: string) => {
    try { await call('reject_tenant', { tenant_id: t.id, reason }); success('Tenant rejeté'); load(); }
    catch (e: any) { error(e.message); }
  };
  const [deleting, setDeleting] = useState<any>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  const deleteTenant = async () => {
    if (!deleting) return;
    setDeleteLoading(true);
    try {
      const res = await call('delete_tenant', { tenant_id: deleting.id, reason: deleteReason });
      success(`Tenant "${res.tenant_name}" supprimé définitivement (${res.users_deleted} utilisateur(s) supprimé(s))`);
      setDeleting(null);
      setDeleteConfirmName('');
      setDeleteReason('');
      setDetail(null);
      load();
    } catch (e: any) { error(e.message); }
    setDeleteLoading(false);
  };

  const pendingCount = tenants.filter(t => (t.approval_status || 'approved') === 'pending').length;

  const filterDefs: { k: typeof filter; l: string }[] = [
    { k: 'all', l: 'Tous' },
    { k: 'active', l: 'Actifs' },
    { k: 'pending', l: 'En attente' },
    { k: 'suspended', l: 'Suspendus' },
    { k: 'expiring', l: 'Expirent bientôt' },
    { k: 'expired', l: 'Expirés' },
    { k: 'never_connected', l: 'Jamais connectés' },
  ];

  return (
    <div className="space-y-4">
      {/* Search + filters */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Rechercher un tenant..."
            className="w-full h-10 pl-10 pr-4 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#0F172A] focus:ring-1 focus:ring-[#0F172A] transition-colors"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {filterDefs.map(f => (
            <button key={f.k} onClick={() => setFilter(f.k)}
              className={`relative px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all ${
                filter === f.k
                  ? 'bg-[#0F172A] text-white'
                  : 'bg-white border border-[#E5E7EB] text-[#64748B] hover:border-[#CBD5E1] hover:text-[#0F172A]'
              }`}>
              {f.l}
              {f.k === 'pending' && pendingCount > 0 && filter !== f.k && (
                <span className="ml-1.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-[#F59E0B] text-white text-[9px] font-bold">{pendingCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tenant count */}
      {!loading && (
        <div className="text-[11px] text-[#94A3B8] font-medium">
          {filtered.length} tenant{filtered.length !== 1 ? 's' : ''} {filter !== 'all' ? 'filtrés' : 'au total'}
        </div>
      )}

      {loading ? (
        <div className="py-20 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#64748B]" /></div>
      ) : (
        <div className="space-y-2">
          {filtered.map(t => {
            const plan = planByCode[t.plan];
            const exp = t.plan_expires_at ? new Date(t.plan_expires_at) : null;
            const now = new Date();
            const expired = exp && exp < now;
            const expiringSoon = exp && !expired && exp < new Date(Date.now() + 7 * 86400000);
            const approval = t.approval_status || 'approved';
            const isPending = approval === 'pending';
            const isRejected = approval === 'rejected';
            const neverConnected = !t.last_active_at;

            const getStatusBadge = () => {
              if (isPending) return <span className="inline-flex items-center text-[10px] px-2 py-0.5 rounded bg-[#F8FAFC] text-[#64748B] border border-[#E2E8F0] font-medium">En attente</span>;
              if (isRejected) return <span className="inline-flex items-center text-[10px] px-2 py-0.5 rounded bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA] font-medium">Rejeté</span>;
              if (!t.is_active) return <span className="inline-flex items-center text-[10px] px-2 py-0.5 rounded bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA] font-medium">Suspendu</span>;
              if (expired) return <span className="inline-flex items-center text-[10px] px-2 py-0.5 rounded bg-[#FFFBEB] text-[#D97706] border border-[#FDE68A] font-medium">Expiré</span>;
              if (expiringSoon) return <span className="inline-flex items-center text-[10px] px-2 py-0.5 rounded bg-[#FFFBEB] text-[#D97706] border border-[#FDE68A] font-medium">Expire bientôt</span>;
              if (neverConnected) return <span className="inline-flex items-center text-[10px] px-2 py-0.5 rounded bg-[#F8FAFC] text-[#94A3B8] border border-[#E2E8F0] font-medium">Jamais connecté</span>;
              return <span className="inline-flex items-center text-[10px] px-2 py-0.5 rounded bg-[#F0FDF4] text-[#16A34A] border border-[#BBF7D0] font-medium">Actif</span>;
            };

            return (
              <div key={t.id} className="bg-white border border-[#E5E7EB] rounded-xl p-4 hover:border-[#CBD5E1] transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                  {/* Left: avatar + info */}
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className={`w-10 h-10 rounded-lg font-bold text-sm flex items-center justify-center shrink-0 ${
                      isPending ? 'bg-[#FEF3C7] text-[#D97706]'
                        : !t.is_active ? 'bg-[#FEE2E2] text-[#DC2626]'
                        : 'bg-[#F1F5F9] text-[#0F172A]'
                    }`}>
                      {(t.name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      {/* Row 1: Name + plan badge */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-[#0F172A] text-sm">{t.name}</span>
                        <PlanBadge plan={plan} code={t.plan} />
                        {getStatusBadge()}
                      </div>
                      {/* Row 2: Details */}
                      <div className="text-xs text-[#64748B] mt-0.5 leading-relaxed">
                        {t.email || '—'}
                        <span className="text-[#CBD5E1] mx-1.5">|</span>
                        {(t.profiles || []).length} utilisateur{(t.profiles || []).length !== 1 ? 's' : ''}
                        <span className="text-[#CBD5E1] mx-1.5">|</span>
                        Créé {formatDate(t.created_at)}
                        {t.last_active_at && <><span className="text-[#CBD5E1] mx-1.5">|</span>Actif {formatDate(t.last_active_at)}</>}
                      </div>
                      {/* Row 3: Pending extra info */}
                      {isPending && (t.whatsapp_phone || t.city || t.selected_plan_code) && (
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                          {t.whatsapp_phone && <span className="text-[10px] text-[#16A34A] font-medium">WhatsApp: {t.whatsapp_phone}</span>}
                          {t.city && <span className="text-[10px] text-[#64748B]">Ville: {t.city}</span>}
                          {t.selected_plan_code && <span className="text-[10px] text-[#2563EB] font-medium">Plan souhaité: {t.selected_plan_code}</span>}
                        </div>
                      )}
                      {/* Expiration date if exists */}
                      {exp && (
                        <div className="mt-1">
                          <span className={`text-[11px] font-medium ${expired ? 'text-[#DC2626]' : expiringSoon ? 'text-[#D97706]' : 'text-[#64748B]'}`}>
                            {expired ? 'Expiré le' : 'Expire le'} {formatDate(exp)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right: actions */}
                  <div className="flex items-center gap-2 shrink-0 sm:pt-0.5">
                    {isPending && (
                      <>
                        <button
                          onClick={() => approve(t)}
                          className="h-8 px-3 rounded-md bg-[#16A34A] text-white text-xs font-medium hover:bg-[#15803D] flex items-center gap-1.5 transition-colors"
                        ><Check className="w-3.5 h-3.5" />Approuver</button>
                        <button
                          onClick={() => { const reason = prompt('Motif du rejet ? (optionnel)') || ''; reject(t, reason); }}
                          className="h-8 w-8 rounded-md bg-[#FEF2F2] text-[#DC2626] hover:bg-[#FEE2E2] flex items-center justify-center transition-colors"
                          title="Rejeter"
                        ><Ban className="w-3.5 h-3.5" /></button>
                      </>
                    )}
                    <button
                      onClick={() => setDetail(t)}
                      className="h-8 px-3 rounded-md bg-[#0F172A] text-white text-xs font-medium hover:bg-[#1E293B] flex items-center gap-1.5 transition-colors"
                    >Gérer<ArrowUpRight className="w-3 h-3" /></button>

                    {/* Actions menu */}
                    <div className="relative">
                      <button
                        onClick={() => setActionsOpen(actionsOpen === t.id ? null : t.id)}
                        className="h-8 w-8 rounded-md border border-[#E5E7EB] text-[#64748B] hover:bg-[#F8FAFC] hover:text-[#0F172A] flex items-center justify-center transition-colors"
                      >
                        <span className="text-sm leading-none font-bold tracking-wider">...</span>
                      </button>
                      {actionsOpen === t.id && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setActionsOpen(null)} />
                          <div className="absolute right-0 top-full mt-1 z-50 w-44 bg-white border border-[#E5E7EB] rounded-lg shadow-lg py-1">
                            {!isPending && t.is_active && (
                              <button
                                onClick={() => { setActionsOpen(null); const reason = prompt('Raison de la suspension ?') || ''; suspend(t, reason); }}
                                className="w-full text-left px-3 py-2 text-xs text-[#64748B] hover:bg-[#F8FAFC] hover:text-[#0F172A] flex items-center gap-2"
                              ><Pause className="w-3.5 h-3.5" />Suspendre</button>
                            )}
                            {!isPending && !t.is_active && (
                              <button
                                onClick={() => { setActionsOpen(null); reactivate(t); }}
                                className="w-full text-left px-3 py-2 text-xs text-[#64748B] hover:bg-[#F8FAFC] hover:text-[#0F172A] flex items-center gap-2"
                              ><Power className="w-3.5 h-3.5" />Réactiver</button>
                            )}
                            <button
                              onClick={() => { setActionsOpen(null); setDeleting(t); setDeleteConfirmName(''); setDeleteReason(''); }}
                              className="w-full text-left px-3 py-2 text-xs text-[#DC2626] hover:bg-[#FEF2F2] flex items-center gap-2"
                            ><Trash2 className="w-3.5 h-3.5" />Supprimer</button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-center py-16">
              <Building2 className="w-10 h-10 text-[#E2E8F0] mx-auto mb-3" />
              <p className="text-sm font-medium text-[#64748B]">Aucun tenant trouvé</p>
              <p className="text-xs text-[#94A3B8] mt-1">Essayez de modifier votre recherche ou vos filtres.</p>
              {filter !== 'all' && (
                <button onClick={() => { setFilter('all'); setQ(''); }} className="mt-3 text-xs font-medium text-[#0F172A] hover:underline">
                  Réinitialiser les filtres
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {detail && <TenantDetailModal tenant={detail} plans={plans} onClose={() => setDetail(null)} onRefresh={load} onDelete={(t: any) => { setDeleting(t); setDeleteConfirmName(''); setDeleteReason(''); }} />}

      {/* Delete tenant confirmation modal */}
      <Modal open={!!deleting} onClose={() => { if (!deleteLoading) { setDeleting(null); setDeleteConfirmName(''); setDeleteReason(''); } }} title="" size="md" footer={null}>
        {deleting && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#FEF2F2] flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-[#DC2626]" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#0F172A]">Supprimer définitivement</h3>
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
              <label className="block text-xs font-medium text-[#0F172A] mb-1">Motif de la suppression</label>
              <input
                value={deleteReason}
                onChange={e => setDeleteReason(e.target.value)}
                className="w-full h-9 px-3 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#DC2626] focus:ring-1 focus:ring-[#DC2626]"
                placeholder="Ex: Demande du client, compte test, doublon..."
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#0F172A] mb-1">
                Tapez <span className="font-mono font-bold bg-[#FEF2F2] text-[#DC2626] px-1.5 py-0.5 rounded">{deleting.name}</span> pour confirmer
              </label>
              <input
                value={deleteConfirmName}
                onChange={e => setDeleteConfirmName(e.target.value)}
                className="w-full h-9 px-3 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#0F172A] font-mono placeholder:text-[#94A3B8] focus:outline-none focus:border-[#DC2626] focus:ring-1 focus:ring-[#DC2626]"
                placeholder={deleting.name}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => { setDeleting(null); setDeleteConfirmName(''); setDeleteReason(''); }}
                disabled={deleteLoading}
                className="h-9 px-4 rounded-lg border border-[#E5E7EB] text-sm font-medium text-[#64748B] hover:bg-[#F8FAFC] transition-colors"
              >Annuler</button>
              <button
                onClick={deleteTenant}
                disabled={deleteConfirmName !== deleting.name || deleteLoading}
                className="h-9 px-4 rounded-lg bg-[#DC2626] text-white text-sm font-medium hover:bg-[#B91C1C] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
              >
                {deleteLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Supprimer définitivement
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function PlanBadge({ plan, code }: { plan: any; code: string }) {
  const colors: Record<string, string> = {
    trial: 'bg-[#F8FAFC] text-[#64748B] border-[#E2E8F0]',
    starter: 'bg-[#F8FAFC] text-[#0F172A] border-[#E2E8F0]',
    pro: 'bg-[#F0FDF4] text-[#16A34A] border-[#BBF7D0]',
    enterprise: 'bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]',
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded font-semibold border ${colors[code] || 'bg-[#F8FAFC] text-[#64748B] border-[#E2E8F0]'}`}>
      {plan?.name || code}
    </span>
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
  { key: 'sales', name: 'Journal des ventes', desc: 'Liste et rapports ventes', icon: LineChart, color: 'sky' },
  { key: 'articles', name: 'Articles', desc: 'Catalogue produits', icon: Package_, color: 'amber' },
  { key: 'stock', name: 'Stock', desc: 'Inventaire, mouvements', icon: Boxes_, color: 'amber' },
  { key: 'billing', name: 'Facturation', desc: 'Devis, factures, avoirs', icon: FileText_, color: 'emerald' },
  { key: 'online_orders', name: 'Commandes en ligne', desc: 'Boutique en ligne', icon: Globe_, color: 'emerald' },
  { key: 'tiers', name: 'Tiers', desc: 'Clients & fournisseurs', icon: Users, color: 'sky' },
  { key: 'supplier_orders', name: 'Commandes fournisseurs', desc: 'Approvisionnement', icon: ShoppingBag_, color: 'slate' },
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
            <h4 className="text-sm font-semibold text-[#0F172A]">Type de commerce</h4>
            <p className="text-[11px] text-[#64748B] mt-0.5">Determine le catalogue maitre importable pour ce tenant.</p>
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
                className={`text-left p-3 rounded-lg border transition-all ${active ? 'border-[#0F172A] bg-[#0F172A] text-white' : 'border-[#E5E7EB] bg-white hover:border-[#CBD5E1]'}`}>
                <div className="flex items-center gap-2 mb-0.5">
                  <I className={`w-3.5 h-3.5 ${active ? 'text-white/70' : 'text-[#64748B]'}`} />
                  <span className="font-medium text-xs">{a.name}</span>
                </div>
                {a.description && <div className={`text-[10px] leading-snug ${active ? 'text-white/60' : 'text-[#94A3B8]'}`}>{a.description}</div>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Modules */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h4 className="text-sm font-semibold text-[#0F172A]">Modules accessibles</h4>
            <p className="text-[11px] text-[#64748B] mt-0.5">Pages visibles dans la barre laterale du tenant.</p>
          </div>
          <div className="flex gap-1.5">
            <button onClick={minimal} className="text-[11px] px-2.5 py-1 rounded-md border border-[#E5E7EB] text-[#64748B] hover:bg-[#F8FAFC] font-medium">Minimal</button>
            <button onClick={allOn} className="text-[11px] px-2.5 py-1 rounded-md bg-[#0F172A] text-white hover:bg-[#1E293B] font-medium">Tout activer</button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {MODULE_DEFS.map(m => {
            const on = modules.includes(m.key);
            const I = m.icon;
            return (
              <button key={m.key} onClick={() => toggle(m.key)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all text-left ${on ? 'border-[#0F172A] bg-[#F8FAFC]' : 'border-[#E5E7EB] bg-white hover:border-[#CBD5E1]'}`}>
                <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${on ? 'bg-[#0F172A] text-white' : 'bg-[#F1F5F9] text-[#64748B]'}`}>
                  <I className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-xs text-[#0F172A] truncate">{m.name}</div>
                  <div className="text-[10px] text-[#94A3B8] truncate">{m.desc}</div>
                </div>
                <div className={`shrink-0 w-8 h-4.5 rounded-full relative transition-colors ${on ? 'bg-[#0F172A]' : 'bg-[#E2E8F0]'}`}>
                  <span className={`absolute top-0.5 ${on ? 'right-0.5' : 'left-0.5'} w-3.5 h-3.5 bg-white rounded-full shadow-sm transition-all`} />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Usage */}
      {usage && (
        <div className="rounded-lg border border-[#E5E7EB] p-4 bg-[#F8FAFC]">
          <div className="text-[11px] font-semibold text-[#64748B] mb-3">Usage vs limites du plan ({usage.plan_code || 'aucun'})</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <UsageBar label="Magasins" current={usage.sites_count} limit={usage.plan_limits?.sites} />
            <UsageBar label="Utilisateurs" current={usage.users_count} limit={usage.plan_limits?.users} />
            <UsageBar label="Articles" current={usage.articles_count} limit={usage.plan_limits?.articles} />
          </div>
        </div>
      )}

      <div className="flex justify-end pt-2">
        <button onClick={onSave} disabled={saving} className="h-9 px-4 rounded-lg bg-[#0F172A] text-white text-sm font-medium hover:bg-[#1E293B] flex items-center gap-2 transition-colors disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}Enregistrer
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
    <div className="bg-white border border-[#E5E7EB] rounded-lg p-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-medium text-[#64748B]">{label}</span>
        <span className={`text-[11px] font-semibold ${reached ? 'text-[#DC2626]' : 'text-[#0F172A]'}`}>
          {current}{unlimited ? ' / --' : ` / ${limit}`}
        </span>
      </div>
      <div className="h-1 rounded-full bg-[#F1F5F9] overflow-hidden">
        <div className={`h-full rounded-full ${reached ? 'bg-[#DC2626]' : 'bg-[#0F172A]'} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function TenantDetailModal({ tenant, plans, onClose, onRefresh, onDelete }: { tenant: any; plans: any[]; onClose: () => void; onRefresh: () => void; onDelete?: (t: any) => void }) {
  const [detail, setDetail] = useState<any>(null);
  const [tab, setTab] = useState<'info' | 'sub' | 'modules' | 'users' | 'history' | 'danger'>('info');
  const [form, setForm] = useState<any>({
    ...tenant,
    plan_expires_at: tenant.plan_expires_at?.slice(0, 10) || '',
    business_type: tenant.business_type || 'auto_parts',
    business_activity_type_id: tenant.business_activity_type_id || null,
    enabled_modules: Array.isArray(tenant.enabled_modules) ? tenant.enabled_modules : ['dashboard','pos','cash_history','articles','stock','tiers','sales','billing','supplier_orders','online_orders','accounting','settings','reports'],
  });
  const [saving, setSaving] = useState(false);
  const [subForm, setSubForm] = useState<any>({ plan_code: tenant.plan, billing_cycle: tenant.billing_cycle || 'monthly', amount: 0, auto_renew: tenant.auto_renew !== false, started_at: new Date().toISOString().slice(0, 10), ends_at: '' });
  const { success, error } = useToast();

  useEffect(() => {
    (async () => {
      try { setDetail(await call('tenant_detail', { tenant_id: tenant.id })); }
      catch (e: any) { error(e.message); }
    })();
  }, [tenant.id]);

  const saveInfo = async () => {
    setSaving(true);
    try {
      await call('update_tenant', {
        tenant_id: tenant.id,
        patch: {
          name: form.name, legal_name: form.legal_name, email: form.email, phone: form.phone,
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
    const plan = plans.find(p => p.code === subForm.plan_code);
    const amount = Number(subForm.amount) || (plan ? (subForm.billing_cycle === 'yearly' ? plan.price_yearly : plan.price_monthly) : 0);
    try {
      const customLimits = subForm.custom_limits || {};
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
  };

  const cancelSub = async (id: string) => {
    const reason = prompt('Raison de l\'annulation ?') || '';
    try {
      await call('cancel_subscription', { subscription_id: id, reason });
      success('Abonnement annulé');
      const d = await call('tenant_detail', { tenant_id: tenant.id });
      setDetail(d);
      onRefresh();
    } catch (e: any) { error(e.message); }
  };

  const tabs: { k: typeof tab; l: string }[] = [
    { k: 'info', l: 'Résumé' },
    { k: 'sub', l: 'Abonnement' },
    { k: 'modules', l: 'Modules' },
    { k: 'users', l: 'Utilisateurs' },
    { k: 'history', l: 'Historique' },
    { k: 'danger', l: 'Zone danger' },
  ];

  return (
    <Modal open onClose={onClose} title={tenant.name} size="lg" footer={null} fullMobile>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="shrink-0 px-3 pt-3 pb-0 bg-white border-b border-[#E5E7EB] sm:px-5 sm:pt-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-[#F1F5F9] text-[#0F172A] font-bold text-sm flex items-center justify-center shrink-0">
              {tenant.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <PlanBadge plan={plans.find(p => p.code === tenant.plan)} code={tenant.plan} />
                {tenant.is_active ? (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[#F0FDF4] text-[#16A34A] border border-[#BBF7D0] font-medium">Actif</span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA] font-medium">Suspendu</span>
                )}
              </div>
              <div className="text-xs text-[#64748B] truncate mt-0.5">{tenant.email || '—'}</div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-0.5 overflow-x-auto -mb-px">
            {tabs.map(t => (
              <button key={t.k} onClick={() => setTab(t.k)}
                className={`px-3 py-2 text-xs font-medium border-b-2 whitespace-nowrap transition-colors ${
                  tab === t.k
                    ? 'border-[#0F172A] text-[#0F172A]'
                    : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
                } ${t.k === 'danger' ? 'ml-auto text-[#DC2626]' : ''}`}>
                {t.l}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-5 bg-[#F8FAFC]">
          {!detail ? (
            <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#64748B]" /></div>
          ) : (
            <>
              {tab === 'info' && (
                <div className="bg-white border border-[#E5E7EB] rounded-xl p-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-medium text-[#64748B] mb-1">Nom</label>
                      <input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full h-9 px-3 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#0F172A] focus:outline-none focus:border-[#0F172A] focus:ring-1 focus:ring-[#0F172A]" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[#64748B] mb-1">Raison sociale</label>
                      <input value={form.legal_name || ''} onChange={e => setForm({ ...form, legal_name: e.target.value })} className="w-full h-9 px-3 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#0F172A] focus:outline-none focus:border-[#0F172A] focus:ring-1 focus:ring-[#0F172A]" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[#64748B] mb-1">Email</label>
                      <input value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} className="w-full h-9 px-3 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#0F172A] focus:outline-none focus:border-[#0F172A] focus:ring-1 focus:ring-[#0F172A]" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[#64748B] mb-1">Téléphone</label>
                      <input value={form.phone || ''} onChange={e => setForm({ ...form, phone: e.target.value })} className="w-full h-9 px-3 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#0F172A] focus:outline-none focus:border-[#0F172A] focus:ring-1 focus:ring-[#0F172A]" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[#64748B] mb-1">Statut</label>
                      <select value={form.status || 'active'} onChange={e => setForm({ ...form, status: e.target.value })} className="w-full h-9 px-3 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#0F172A] focus:outline-none focus:border-[#0F172A] focus:ring-1 focus:ring-[#0F172A]">
                        <option value="active">Actif</option><option value="suspended">Suspendu</option><option value="cancelled">Annulé</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[#64748B] mb-1">Sous-domaine</label>
                      <div className="flex items-center gap-1.5">
                        <input value={form.subdomain || ''} onChange={e => setForm({ ...form, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} placeholder="nom" className="flex-1 h-9 px-3 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#0F172A] focus:outline-none focus:border-[#0F172A] focus:ring-1 focus:ring-[#0F172A]" />
                        <span className="text-[11px] text-[#94A3B8]">.votreapp.com</span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[#64748B] mb-1">Domaine personnalisé</label>
                      <input value={form.custom_domain || ''} onChange={e => setForm({ ...form, custom_domain: e.target.value.toLowerCase().trim() })} placeholder="caisse.domain.sn" className="w-full h-9 px-3 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#0F172A] focus:outline-none focus:border-[#0F172A] focus:ring-1 focus:ring-[#0F172A]" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="flex items-center gap-2 text-xs text-[#0F172A] cursor-pointer">
                        <input type="checkbox" checked={form.is_active !== false} onChange={e => setForm({ ...form, is_active: e.target.checked })} className="rounded border-[#E5E7EB]" />
                        Tenant actif (accès à l'application)
                      </label>
                    </div>
                    <div className="sm:col-span-2 flex justify-end pt-2">
                      <button onClick={saveInfo} disabled={saving} className="h-9 px-4 rounded-lg bg-[#0F172A] text-white text-sm font-medium hover:bg-[#1E293B] flex items-center gap-2 transition-colors disabled:opacity-50">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}Enregistrer
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {tab === 'sub' && (
                <div className="space-y-4">
                  {/* Current state */}
                  <div className="bg-white border border-[#E5E7EB] rounded-xl p-4">
                    <div className="text-[11px] font-medium text-[#64748B] mb-2">État actuel</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-[#0F172A]">Plan {tenant.plan || '—'}</span>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${
                        tenant.subscription_status === 'active' ? 'bg-[#F0FDF4] text-[#16A34A] border border-[#BBF7D0]'
                          : tenant.subscription_status === 'trial_active' ? 'bg-[#EFF6FF] text-[#2563EB] border border-[#BFDBFE]'
                          : tenant.subscription_status === 'expired' ? 'bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]'
                          : 'bg-[#FFFBEB] text-[#D97706] border border-[#FDE68A]'
                      }`}>{tenant.subscription_status || 'N/A'}</span>
                      <span className="text-xs text-[#64748B]">{tenant.billing_cycle === 'yearly' ? 'Annuel' : tenant.billing_cycle === 'lifetime' ? 'A vie' : 'Mensuel'}</span>
                      {tenant.plan_expires_at && <span className="text-xs text-[#64748B]">Expire : {formatDate(tenant.plan_expires_at)}</span>}
                      {tenant.auto_renew && <span className="text-[10px] bg-[#F1F5F9] text-[#64748B] px-1.5 py-0.5 rounded border border-[#E5E7EB]">Auto-renew</span>}
                    </div>
                  </div>

                  {/* Plan picker */}
                  <div className="bg-white border border-[#E5E7EB] rounded-xl p-4">
                    <div className="text-[11px] font-medium text-[#64748B] mb-3">Sélectionner un plan</div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {plans.map(p => {
                        const active = subForm.plan_code === p.code;
                        return (
                          <button key={p.code} onClick={() => setSubForm({ ...subForm, plan_code: p.code, amount: subForm.billing_cycle === 'lifetime' ? (p.price_lifetime || 0) : subForm.billing_cycle === 'yearly' ? p.price_yearly : p.price_monthly })}
                            className={`text-left p-3 rounded-lg border transition-all ${active ? 'border-[#0F172A] bg-[#0F172A] text-white' : 'border-[#E5E7EB] bg-white hover:border-[#CBD5E1]'}`}>
                            <div className={`text-[10px] font-medium ${active ? 'text-white/60' : 'text-[#94A3B8]'}`}>{p.code}</div>
                            <div className="font-semibold text-sm mt-0.5">{p.name}</div>
                            <div className={`text-[11px] mt-1 ${active ? 'text-white/70' : 'text-[#64748B]'}`}>
                              {subForm.billing_cycle === 'lifetime' ? `${formatCompactFCFA(p.price_lifetime || 0)} (a vie)` : `${formatCompactFCFA(subForm.billing_cycle === 'yearly' ? p.price_yearly : p.price_monthly)}/${subForm.billing_cycle === 'yearly' ? 'an' : 'mois'}`}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                      <div>
                        <label className="block text-[11px] font-medium text-[#64748B] mb-1">Cycle</label>
                        <select value={subForm.billing_cycle} onChange={e => {
                          const plan = plans.find(p => p.code === subForm.plan_code);
                          const cycle = e.target.value;
                          const amount = plan ? (cycle === 'lifetime' ? (plan.price_lifetime || 0) : cycle === 'yearly' ? plan.price_yearly : plan.price_monthly) : subForm.amount;
                          setSubForm({ ...subForm, billing_cycle: cycle, amount, ends_at: cycle === 'lifetime' ? '' : subForm.ends_at });
                        }} className="w-full h-9 px-3 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#0F172A] focus:outline-none focus:border-[#0F172A] focus:ring-1 focus:ring-[#0F172A]">
                          <option value="monthly">Mensuel</option><option value="yearly">Annuel</option><option value="lifetime">A vie</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-[#64748B] mb-1">Montant (FCFA)</label>
                        <input type="number" value={subForm.amount || 0} onChange={e => setSubForm({ ...subForm, amount: Number(e.target.value) })} className="w-full h-9 px-3 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#0F172A] focus:outline-none focus:border-[#0F172A] focus:ring-1 focus:ring-[#0F172A]" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-[#64748B] mb-1">Début</label>
                        <input type="date" value={subForm.started_at} onChange={e => setSubForm({ ...subForm, started_at: e.target.value })} className="w-full h-9 px-3 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#0F172A] focus:outline-none focus:border-[#0F172A] focus:ring-1 focus:ring-[#0F172A]" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-[#64748B] mb-1">Fin</label>
                        <input type="date" value={subForm.ends_at} onChange={e => setSubForm({ ...subForm, ends_at: e.target.value })} className="w-full h-9 px-3 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#0F172A] focus:outline-none focus:border-[#0F172A] focus:ring-1 focus:ring-[#0F172A]" />
                      </div>
                      <label className="sm:col-span-2 flex items-center gap-2 text-xs text-[#0F172A] cursor-pointer">
                        <input type="checkbox" checked={subForm.auto_renew} onChange={e => setSubForm({ ...subForm, auto_renew: e.target.checked })} className="rounded border-[#E5E7EB]" />
                        Renouvellement automatique
                      </label>
                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-medium text-[#64748B] mb-1">Notes</label>
                        <input value={subForm.notes || ''} onChange={e => setSubForm({ ...subForm, notes: e.target.value })} className="w-full h-9 px-3 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#0F172A] focus:outline-none focus:border-[#0F172A] focus:ring-1 focus:ring-[#0F172A]" placeholder="Réf. facture, conditions..." />
                      </div>
                    </div>

                    {/* Custom limits */}
                    <div className="mt-4 pt-4 border-t border-[#F1F5F9]">
                      <div className="text-[11px] font-medium text-[#64748B] mb-1">Limites personnalisées (override)</div>
                      <p className="text-[10px] text-[#94A3B8] mb-2">Laisser vide pour utiliser les limites du plan.</p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {([['articles', 'Articles'], ['sites', 'Magasins'], ['users', 'Utilisateurs']] as [string, string][]).map(([key, label]) => (
                          <div key={key}>
                            <label className="text-[10px] font-medium text-[#94A3B8]">{label}</label>
                            <input type="number" placeholder="plan" value={subForm.custom_limits?.[key] ?? ''} onChange={e => setSubForm({ ...subForm, custom_limits: { ...(subForm.custom_limits || {}), [key]: e.target.value === '' ? undefined : Number(e.target.value) } })} className="w-full h-8 px-2 bg-white border border-[#E5E7EB] rounded-md text-xs text-[#0F172A] focus:outline-none focus:border-[#0F172A]" />
                          </div>
                        ))}
                      </div>
                    </div>

                    <button onClick={applyPlan} className="mt-4 w-full h-9 rounded-lg bg-[#0F172A] text-white text-sm font-medium hover:bg-[#1E293B] flex items-center justify-center gap-2 transition-colors">
                      <Zap className="w-4 h-4" />Appliquer ce plan
                    </button>
                  </div>

                  {/* Subscription history */}
                  <div className="bg-white border border-[#E5E7EB] rounded-xl p-4">
                    <div className="text-[11px] font-medium text-[#64748B] mb-3">Historique d'abonnements</div>
                    <div className="space-y-1.5">
                      {(detail.subscriptions || []).map((s: any) => (
                        <div key={s.id} className="flex items-center gap-2 bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg px-3 py-2 text-xs">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.status === 'active' ? 'bg-[#16A34A]' : s.status === 'cancelled' ? 'bg-[#DC2626]' : 'bg-[#94A3B8]'}`} />
                          <span className="font-semibold text-[#0F172A] uppercase">{s.plan_code}</span>
                          <span className="text-[#94A3B8]">·</span>
                          <span className="text-[#64748B]">{formatFCFA(s.amount)} {s.billing_cycle === 'lifetime' ? '(a vie)' : `/ ${s.billing_cycle === 'yearly' ? 'an' : 'mois'}`}</span>
                          <span className="text-[#94A3B8]">·</span>
                          <span className="text-[#64748B]">{formatDate(s.started_at)}{s.ends_at ? ` → ${formatDate(s.ends_at)}` : ''}</span>
                          <span className={`ml-auto px-2 py-0.5 rounded text-[10px] font-medium ${s.status === 'active' ? 'bg-[#F0FDF4] text-[#16A34A]' : 'bg-[#F8FAFC] text-[#64748B]'}`}>{s.status}</span>
                          {s.status === 'active' && (
                            <button onClick={() => cancelSub(s.id)} className="text-[#DC2626] hover:bg-[#FEF2F2] p-1 rounded" title="Annuler">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                      {(detail.subscriptions || []).length === 0 && <div className="text-xs text-[#94A3B8] py-4 text-center">Aucun abonnement.</div>}
                    </div>
                  </div>
                </div>
              )}

              {tab === 'modules' && (
                <ModulesTab form={form} setForm={setForm} onSave={saveInfo} saving={saving} usage={detail.usage} />
              )}

              {tab === 'users' && (
                <div className="bg-white border border-[#E5E7EB] rounded-xl divide-y divide-[#F1F5F9]">
                  {(detail.users || []).length === 0 ? (
                    <div className="py-10 text-center">
                      <Users className="w-8 h-8 text-[#E2E8F0] mx-auto mb-2" />
                      <p className="text-xs text-[#94A3B8]">Aucun utilisateur.</p>
                    </div>
                  ) : (detail.users || []).map((u: any) => (
                    <div key={u.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="w-8 h-8 rounded-md bg-[#F1F5F9] text-[#0F172A] font-semibold text-xs flex items-center justify-center shrink-0">
                        {(u.full_name || u.email).charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-[#0F172A] truncate">{u.full_name || u.email}</div>
                        <div className="text-[11px] text-[#64748B] truncate">{u.email}</div>
                      </div>
                      <span className="text-[10px] font-medium text-[#64748B] bg-[#F8FAFC] border border-[#E5E7EB] px-2 py-0.5 rounded">{u.role}</span>
                      {!u.is_active && <span className="text-[10px] bg-[#FEF2F2] text-[#DC2626] px-1.5 py-0.5 rounded font-medium">Inactif</span>}
                    </div>
                  ))}
                </div>
              )}

              {tab === 'history' && (
                <div className="bg-white border border-[#E5E7EB] rounded-xl p-4">
                  {(detail.events || []).length === 0 ? (
                    <div className="py-10 text-center">
                      <Activity className="w-8 h-8 text-[#E2E8F0] mx-auto mb-2" />
                      <p className="text-xs text-[#94A3B8]">Aucun historique disponible pour ce tenant.</p>
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
                  <div className="bg-white border border-[#FECACA] rounded-xl p-5">
                    <div className="flex items-start gap-3 mb-4">
                      <div className="w-9 h-9 rounded-lg bg-[#FEF2F2] flex items-center justify-center shrink-0">
                        <AlertTriangle className="w-4.5 h-4.5 text-[#DC2626]" />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-[#0F172A]">Zone de danger</h4>
                        <p className="text-[11px] text-[#64748B] mt-0.5">Ces actions peuvent affecter l'acces du tenant ou supprimer definitivement ses donnees.</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {/* Suspend / Reactivate */}
                      <div className="flex items-center justify-between py-3 border-t border-[#F1F5F9]">
                        <div>
                          <div className="text-xs font-medium text-[#0F172A]">{tenant.is_active ? 'Suspendre le tenant' : 'Réactiver le tenant'}</div>
                          <div className="text-[11px] text-[#64748B]">{tenant.is_active ? 'Bloque l\'acces a l\'application pour tous les utilisateurs.' : 'Restaure l\'acces a l\'application.'}</div>
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
                            <div className="text-[11px] text-[#64748B]">Supprime toutes les donnees du tenant de maniere irreversible.</div>
                          </div>
                          <button
                            onClick={() => { onClose(); setTimeout(() => onDelete(tenant), 150); }}
                            className="h-8 px-3 rounded-md bg-[#DC2626] text-white text-xs font-medium hover:bg-[#B91C1C] transition-colors flex items-center gap-1.5"
                          ><Trash2 className="w-3.5 h-3.5" />Supprimer</button>
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
function PlansSection() {
  const [plans, setPlans] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [toDelete, setToDelete] = useState<any>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const { success, error } = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const [p, t] = await Promise.all([call('list_plans'), call('list_tenants')]);
      setPlans(p.plans || []);
      setTenants(t.tenants || []);
    } catch (e: any) { error(e.message); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.code || !form.name) { error('Code et nom requis'); return; }
    try {
      const featuresArr = Array.isArray(form.features) ? form.features : String(form.features || '').split('\n').map((s: string) => s.trim()).filter(Boolean);
      const rawLimits = form.limits || {};
      const limits: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rawLimits)) {
        if (typeof v === 'boolean') { limits[k] = v; }
        else { limits[k] = v === '' || v === null || v === undefined ? -1 : Number(v); }
      }
      await call('upsert_plan', {
        plan: {
          code: form.code,
          name: form.name,
          description: form.description || '',
          price_monthly: Number(form.price_monthly) || 0,
          price_yearly: Number(form.price_yearly) || 0,
          currency: form.currency || 'FCFA',
          features: featuresArr,
          limits,
          is_public: form.is_public !== false,
          sort_order: Number(form.sort_order) || 0,
        },
      });
      success('Plan enregistré');
      setOpen(false); load();
    } catch (e: any) { error(e.message); }
  };

  const planUsage = useMemo(() => {
    const usage: Record<string, number> = {};
    for (const t of tenants) { usage[t.plan] = (usage[t.plan] || 0) + 1; }
    return usage;
  }, [tenants]);

  const mostUsedPlan = useMemo(() => {
    let max = 0; let code = '-';
    for (const [k, v] of Object.entries(planUsage)) { if (v > max) { max = v; code = k; } }
    return code;
  }, [planUsage]);

  const publicPlans = plans.filter(p => p.is_public !== false).length;

  if (loading) return <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#0F172A]" /></div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[#0F172A]">Plans & tarifs</h2>
          <p className="text-sm text-[#64748B] mt-0.5">Configurez les offres commerciales de Waarwi</p>
        </div>
        <button
          onClick={() => { setForm({ features: '', is_public: true, sort_order: plans.length, limits: { articles: -1, sites: 1, users: 2, max_clients: -1, max_suppliers: -1, max_invoices_month: -1, monthly_sales: -1, online_shop: false, accounting: false, supplier_orders: false, has_whatsapp: false, has_multi_store: false, has_advanced_reports: false, has_accounting_export: false } }); setOpen(true); }}
          className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-[#111111] hover:bg-[#333333] text-white text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />Nouveau plan
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-[#F7F8FA] flex items-center justify-center">
              <Layers className="w-4 h-4 text-[#0F172A]" />
            </div>
          </div>
          <div className="text-2xl font-bold text-[#0F172A]">{publicPlans}</div>
          <div className="text-xs text-[#64748B] mt-0.5">Plans actifs</div>
        </div>
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
            </div>
          </div>
          <div className="text-2xl font-bold text-[#0F172A] truncate">{mostUsedPlan}</div>
          <div className="text-xs text-[#64748B] mt-0.5">Plan le plus utilisé</div>
        </div>
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-[#F7F8FA] flex items-center justify-center">
              <Building2 className="w-4 h-4 text-[#64748B]" />
            </div>
          </div>
          <div className="text-2xl font-bold text-[#0F172A]">{tenants.length}</div>
          <div className="text-xs text-[#64748B] mt-0.5">Tenants abonnés</div>
        </div>
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
              <Clock className="w-4 h-4 text-blue-500" />
            </div>
          </div>
          <div className="text-2xl font-bold text-[#0F172A]">{tenants.filter(t => t.plan === 'trial' || t.plan === 'free').length}</div>
          <div className="text-xs text-[#64748B] mt-0.5">Tenants en essai</div>
        </div>
      </div>

      {/* Plan Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {plans.map(p => {
          const usage = planUsage[p.code] || 0;
          const isPopular = p.code === mostUsedPlan && usage > 0;
          const isInactive = p.is_public === false;
          return (
            <div key={p.code} className={`relative bg-white rounded-lg border border-[#E5E7EB] p-5 transition-all hover:shadow-sm ${isInactive ? 'opacity-60' : ''}`}>
              {/* Header row */}
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-[#0F172A]">{p.name}</h3>
                    {isPopular && <span className="text-[10px] font-medium bg-[#0F172A] text-white px-2 py-0.5 rounded">Populaire</span>}
                    {isInactive && <span className="text-[10px] font-medium bg-slate-100 text-[#64748B] border border-[#E5E7EB] px-2 py-0.5 rounded">Inactif</span>}
                  </div>
                  <div className="text-[11px] font-mono text-[#94A3B8] mt-0.5">{p.code}</div>
                </div>
                <div className="relative">
                  <button
                    onClick={() => setMenuOpen(menuOpen === p.code ? null : p.code)}
                    className="p-1.5 rounded-md hover:bg-[#F7F8FA] text-[#64748B] transition-colors"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><circle cx="10" cy="4" r="2"/><circle cx="10" cy="10" r="2"/><circle cx="10" cy="16" r="2"/></svg>
                  </button>
                  {menuOpen === p.code && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(null)} />
                      <div className="absolute right-0 top-8 z-20 bg-white border border-[#E5E7EB] rounded-lg shadow-lg py-1 w-40">
                        <button
                          onClick={() => { setForm({ ...p, features: (p.features || []).join('\n'), limits: p.limits || {} }); setOpen(true); setMenuOpen(null); }}
                          className="w-full text-left px-3 py-2 text-sm text-[#0F172A] hover:bg-[#F7F8FA] flex items-center gap-2"
                        >
                          <Edit2 className="w-3.5 h-3.5" />Modifier
                        </button>
                        <button
                          onClick={() => { setToDelete(p); setMenuOpen(null); }}
                          className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                        >
                          <Trash2 className="w-3.5 h-3.5" />Supprimer
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Description */}
              {p.description && <p className="text-xs text-[#64748B] mb-4 line-clamp-2">{p.description}</p>}

              {/* Pricing */}
              <div className="mb-4 pb-4 border-b border-[#E5E7EB]">
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-[#0F172A]">{formatCompactFCFA(p.price_monthly)}</span>
                  <span className="text-sm text-[#64748B]">/ mois</span>
                </div>
                {p.price_yearly > 0 && (
                  <div className="text-xs text-[#94A3B8] mt-0.5">{formatCompactFCFA(p.price_yearly)} / an</div>
                )}
              </div>

              {/* Limits */}
              {p.limits && (
                <div className="flex flex-wrap gap-2 mb-4">
                  <span className="text-[11px] font-medium bg-[#F7F8FA] text-[#0F172A] border border-[#E5E7EB] px-2 py-1 rounded">
                    {p.limits.users === -1 ? 'Illimité' : p.limits.users} utilisateur{(p.limits.users !== 1) ? 's' : ''}
                  </span>
                  <span className="text-[11px] font-medium bg-[#F7F8FA] text-[#0F172A] border border-[#E5E7EB] px-2 py-1 rounded">
                    {p.limits.sites === -1 ? 'Illimité' : p.limits.sites} site{(p.limits.sites !== 1) ? 's' : ''}
                  </span>
                  <span className="text-[11px] font-medium bg-[#F7F8FA] text-[#0F172A] border border-[#E5E7EB] px-2 py-1 rounded">
                    {p.limits.articles === -1 ? 'Illimité' : p.limits.articles} article{(p.limits.articles !== 1) ? 's' : ''}
                  </span>
                </div>
              )}

              {/* Features */}
              {Array.isArray(p.features) && p.features.length > 0 && (
                <div className="space-y-1.5 mb-4">
                  {p.features.slice(0, 5).map((f: string, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-[#64748B]">
                      <Check className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                      <span>{f}</span>
                    </div>
                  ))}
                  {p.features.length > 5 && (
                    <div className="text-[11px] text-[#94A3B8] pl-5">+{p.features.length - 5} fonctionnalité{p.features.length - 5 > 1 ? 's' : ''}</div>
                  )}
                </div>
              )}

              {/* Footer */}
              <div className="flex items-center justify-between pt-3 border-t border-[#E5E7EB]">
                <span className="text-[11px] text-[#94A3B8]">{usage} tenant{usage !== 1 ? 's' : ''}</span>
                <button
                  onClick={() => { setForm({ ...p, features: (p.features || []).join('\n'), limits: p.limits || {} }); setOpen(true); }}
                  className="px-3.5 py-1.5 rounded-md bg-[#111111] hover:bg-[#333333] text-white text-xs font-medium transition-colors"
                >
                  Modifier
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {plans.length === 0 && (
        <div className="bg-white rounded-lg border border-[#E5E7EB] py-12 text-center">
          <Layers className="w-8 h-8 text-[#94A3B8] mx-auto mb-2" />
          <div className="text-sm text-[#64748B]">Aucun plan configuré</div>
          <p className="text-xs text-[#94A3B8] mt-1">Créez votre premier plan pour démarrer.</p>
        </div>
      )}

      {/* Modal */}
      <Modal open={open} onClose={() => setOpen(false)} title={form.code && plans.some(p => p.code === form.code) ? 'Modifier le plan' : 'Nouveau plan'} size="lg"
        footer={<>
          <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-md border border-[#E5E7EB] text-sm font-medium text-[#0F172A] hover:bg-[#F7F8FA] transition-colors">Annuler</button>
          <button onClick={save} className="px-4 py-2 rounded-md bg-[#111111] hover:bg-[#333333] text-white text-sm font-medium transition-colors">Enregistrer</button>
        </>}>
        <div className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">
          {/* General info */}
          <div>
            <p className="text-xs font-semibold text-[#0F172A] uppercase tracking-wider mb-3">Informations générales</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className="text-[11px] font-medium text-[#64748B] block mb-1">Code *</label><input value={form.code || ''} onChange={e => setForm({ ...form, code: e.target.value })} className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-md bg-white text-[#0F172A] font-mono focus:outline-none focus:ring-1 focus:ring-[#0F172A]" placeholder="starter" /></div>
              <div><label className="text-[11px] font-medium text-[#64748B] block mb-1">Nom *</label><input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-md bg-white text-[#0F172A] focus:outline-none focus:ring-1 focus:ring-[#0F172A]" /></div>
              <div className="sm:col-span-2"><label className="text-[11px] font-medium text-[#64748B] block mb-1">Description</label><input value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-md bg-white text-[#0F172A] focus:outline-none focus:ring-1 focus:ring-[#0F172A]" /></div>
            </div>
          </div>

          {/* Pricing */}
          <div className="border-t border-[#E5E7EB] pt-4">
            <p className="text-xs font-semibold text-[#0F172A] uppercase tracking-wider mb-3">Tarifs</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className="text-[11px] font-medium text-[#64748B] block mb-1">Prix mensuel (FCFA)</label><input type="number" value={form.price_monthly || 0} onChange={e => setForm({ ...form, price_monthly: e.target.value })} className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-md bg-white text-[#0F172A] focus:outline-none focus:ring-1 focus:ring-[#0F172A]" /></div>
              <div><label className="text-[11px] font-medium text-[#64748B] block mb-1">Prix annuel (FCFA)</label><input type="number" value={form.price_yearly || 0} onChange={e => setForm({ ...form, price_yearly: e.target.value })} className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-md bg-white text-[#0F172A] focus:outline-none focus:ring-1 focus:ring-[#0F172A]" /></div>
            </div>
          </div>

          {/* Limits */}
          <div className="border-t border-[#E5E7EB] pt-4">
            <p className="text-xs font-semibold text-[#0F172A] uppercase tracking-wider mb-1">Limites</p>
            <p className="text-[11px] text-[#94A3B8] mb-3">-1 = illimité</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {([['articles', 'Articles max'], ['sites', 'Magasins max'], ['users', 'Utilisateurs max'], ['max_clients', 'Clients max'], ['max_suppliers', 'Fournisseurs max'], ['max_invoices_month', 'Factures/mois max'], ['monthly_sales', 'Ventes/mois max']] as [string, string][]).map(([key, label]) => (
                <div key={key}>
                  <label className="text-[11px] font-medium text-[#64748B] block mb-1">{label}</label>
                  <input type="number" value={form.limits?.[key] ?? ''} onChange={e => setForm({ ...form, limits: { ...form.limits, [key]: e.target.value === '' ? -1 : Number(e.target.value) } })} className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-md bg-white text-[#0F172A] focus:outline-none focus:ring-1 focus:ring-[#0F172A]" placeholder="-1" />
                </div>
              ))}
            </div>
          </div>

          {/* Modules */}
          <div className="border-t border-[#E5E7EB] pt-4">
            <p className="text-xs font-semibold text-[#0F172A] uppercase tracking-wider mb-1">Modules inclus</p>
            <p className="text-[11px] text-[#94A3B8] mb-3">Les modules liés au type d'activité sont gérés au niveau du tenant.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {([['online_shop', 'Boutique en ligne'], ['accounting', 'Comptabilité'], ['supplier_orders', 'Commandes fournisseurs'], ['has_whatsapp', 'Notifications WhatsApp'], ['has_multi_store', 'Multi-magasins'], ['has_advanced_reports', 'Rapports avancés'], ['has_accounting_export', 'Export comptable']] as [string, string][]).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2.5 text-sm cursor-pointer py-2 px-3 rounded-md border border-[#E5E7EB] hover:bg-[#F7F8FA] transition-colors">
                  <input type="checkbox" checked={!!form.limits?.[key]} onChange={e => setForm({ ...form, limits: { ...form.limits, [key]: e.target.checked } })} className="rounded border-[#E5E7EB] text-[#0F172A] focus:ring-[#0F172A]" />
                  <span className="text-[#0F172A] text-xs">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Marketing features */}
          <div className="border-t border-[#E5E7EB] pt-4">
            <p className="text-xs font-semibold text-[#0F172A] uppercase tracking-wider mb-1">Fonctionnalités marketing</p>
            <p className="text-[11px] text-[#94A3B8] mb-3">Texte affiché aux clients (une par ligne)</p>
            <textarea value={form.features || ''} onChange={e => setForm({ ...form, features: e.target.value })} className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-md bg-white text-[#0F172A] resize-none focus:outline-none focus:ring-1 focus:ring-[#0F172A]" rows={4} placeholder="Une fonctionnalité par ligne" />
          </div>

          {/* Status */}
          <div className="border-t border-[#E5E7EB] pt-4">
            <p className="text-xs font-semibold text-[#0F172A] uppercase tracking-wider mb-3">Statut</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className="text-[11px] font-medium text-[#64748B] block mb-1">Ordre d'affichage</label><input type="number" value={form.sort_order || 0} onChange={e => setForm({ ...form, sort_order: e.target.value })} className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-md bg-white text-[#0F172A] focus:outline-none focus:ring-1 focus:ring-[#0F172A]" /></div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2.5 text-sm cursor-pointer py-2 px-3 rounded-md border border-[#E5E7EB] hover:bg-[#F7F8FA] transition-colors">
                  <input type="checkbox" checked={form.is_public !== false} onChange={e => setForm({ ...form, is_public: e.target.checked })} className="rounded border-[#E5E7EB] text-[#0F172A] focus:ring-[#0F172A]" />
                  <span className="text-xs text-[#0F172A]">Visible publiquement</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)}
        onConfirm={async () => {
          try { await call('delete_plan', { code: toDelete.code }); success('Plan supprimé'); setToDelete(null); load(); }
          catch (e: any) { error(e.message); }
        }}
        title="Supprimer ce plan ?" message={`Le plan "${toDelete?.name}" sera retiré. Les abonnements existants ne seront pas supprimés.`} danger />
    </div>
  );
}

/* ============== SUBSCRIPTIONS ============== */
function SubscriptionsSection() {
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expiring, setExpiring] = useState<any[]>([]);
  const [reminderDays, setReminderDays] = useState(7);
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const { success, error } = useToast();

  const loadExpiring = async (days: number) => {
    try { const res = await call('list_expiring_tenants', { days }); setExpiring(res.tenants || []); }
    catch (e: any) { error(e.message); }
  };

  useEffect(() => {
    (async () => {
      try { setTenants((await call('list_tenants')).tenants || []); }
      catch (e: any) { error(e.message); }
      setLoading(false);
    })();
    loadExpiring(reminderDays);
  }, []);

  const sendReminder = async (tenantId: string) => {
    setSendingReminder(tenantId);
    try {
      const res = await call('send_payment_reminder', { tenant_id: tenantId });
      success(`Rappel envoyé à ${res.tenant_name}`);
    } catch (e: any) { error(e.message); }
    setSendingReminder(null);
  };

  const rows = useMemo(() => {
    const out: any[] = [];
    for (const t of tenants) {
      for (const s of (t.tenant_subscriptions || [])) {
        out.push({ ...s, tenant_name: t.name, tenant_id: t.id, tenant_email: t.email, tenant_subdomain: t.subdomain });
      }
    }
    return out.sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''));
  }, [tenants]);

  const totalMRR = rows.filter(r => r.status === 'active' && r.billing_cycle !== 'lifetime').reduce((s, r) => s + Number(r.amount || 0) / (r.billing_cycle === 'yearly' ? 12 : 1), 0);
  const activeCount = rows.filter(r => r.status === 'active').length;
  const pendingCount = rows.filter(r => r.status === 'pending').length;

  const statusLabel = (s: string) => {
    const map: Record<string, string> = { active: 'Actif', pending: 'En attente', superseded: 'Remplacé', expired: 'Expiré', cancelled: 'Annulé', trial: 'Essai', suspended: 'Suspendu' };
    return map[s] || s;
  };
  const statusStyle = (s: string) => {
    const map: Record<string, string> = {
      active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      pending: 'bg-slate-50 text-slate-600 border-slate-200',
      superseded: 'bg-gray-50 text-gray-500 border-gray-200',
      expired: 'bg-orange-50 text-orange-700 border-orange-200',
      cancelled: 'bg-red-50 text-red-600 border-red-200',
      trial: 'bg-blue-50 text-blue-600 border-blue-200',
      suspended: 'bg-red-50 text-red-700 border-red-200',
    };
    return map[s] || 'bg-slate-50 text-slate-600 border-slate-200';
  };
  const cycleLabel = (c: string) => {
    const map: Record<string, string> = { monthly: 'Mensuel', yearly: 'Annuel', lifetime: 'Illimité', trial: 'Essai' };
    return map[c] || c;
  };

  const filters: { key: string; label: string }[] = [
    { key: 'all', label: 'Tous' },
    { key: 'active', label: 'Actifs' },
    { key: 'pending', label: 'En attente' },
    { key: 'expired', label: 'Expirés' },
    { key: 'superseded', label: 'Remplacés' },
    { key: 'cancelled', label: 'Annulés' },
    { key: 'expiring_soon', label: 'Expirent bientôt' },
  ];

  const filtered = useMemo(() => {
    const now = Date.now();
    const in7 = now + 7 * 86400000;
    return rows.filter(r => {
      if (q) {
        const search = q.toLowerCase();
        if (!`${r.tenant_name} ${r.plan_code} ${statusLabel(r.status)}`.toLowerCase().includes(search)) return false;
      }
      if (statusFilter === 'all') return true;
      if (statusFilter === 'expiring_soon') {
        if (r.status !== 'active') return false;
        const end = r.ends_at ? new Date(r.ends_at).getTime() : 0;
        return end > now && end < in7;
      }
      return r.status === statusFilter;
    });
  }, [rows, q, statusFilter]);

  const resetFilters = () => { setQ(''); setStatusFilter('all'); };

  if (loading) return <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#0F172A]" /></div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-[#0F172A]">Abonnements</h2>
        <p className="text-sm text-[#64748B] mt-0.5">Suivi des plans, cycles, paiements et expirations des tenants</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-[#F7F8FA] flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-[#0F172A]" />
            </div>
          </div>
          <div className="text-2xl font-bold text-[#0F172A]">{formatCompactFCFA(totalMRR)}</div>
          <div className="text-xs text-[#64748B] mt-0.5">MRR (revenu mensuel)</div>
        </div>
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
              <Check className="w-4 h-4 text-emerald-600" />
            </div>
          </div>
          <div className="text-2xl font-bold text-[#0F172A]">{activeCount}</div>
          <div className="text-xs text-[#64748B] mt-0.5">Abonnements actifs</div>
        </div>
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center">
              <Clock className="w-4 h-4 text-[#64748B]" />
            </div>
          </div>
          <div className="text-2xl font-bold text-[#0F172A]">{pendingCount}</div>
          <div className="text-xs text-[#64748B] mt-0.5">En attente</div>
        </div>
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center">
              <Bell className="w-4 h-4 text-orange-500" />
            </div>
          </div>
          <div className="text-2xl font-bold text-[#0F172A]">{expiring.length}</div>
          <div className="text-xs text-[#64748B] mt-0.5">Expirations proches</div>
        </div>
      </div>

      {/* Payment Reminders */}
      <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E5E7EB]">
          <div className="flex items-center gap-2.5">
            <Bell className="w-4 h-4 text-[#0F172A]" />
            <span className="text-sm font-semibold text-[#0F172A]">Rappels de paiement</span>
            {expiring.length > 0 && <span className="text-[11px] font-medium bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 rounded-full">{expiring.length}</span>}
          </div>
          <select
            value={reminderDays}
            onChange={e => { const d = Number(e.target.value); setReminderDays(d); loadExpiring(d); }}
            className="text-xs border border-[#E5E7EB] rounded-md px-2.5 py-1.5 bg-white text-[#0F172A] focus:outline-none focus:ring-1 focus:ring-[#0F172A]"
          >
            <option value={3}>3 jours</option>
            <option value={5}>5 jours</option>
            <option value={7}>7 jours</option>
            <option value={14}>14 jours</option>
            <option value={30}>30 jours</option>
          </select>
        </div>
        {expiring.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-[#64748B]">Aucun rappel de paiement pour le moment.</div>
        ) : (
          <div className="divide-y divide-[#E5E7EB]">
            {expiring.map(t => {
              const days = Math.ceil((new Date(t.plan_expires_at).getTime() - Date.now()) / 86400000);
              const isUrgent = days <= 3;
              return (
                <div key={t.id} className="px-5 py-3.5 flex items-center gap-4 hover:bg-[#F7F8FA] transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[#0F172A] truncate">{t.name}</div>
                    <div className="text-xs text-[#64748B] mt-0.5 flex items-center gap-2 flex-wrap">
                      <span>Plan {t.plan}</span>
                      <span className="text-[#E5E7EB]">|</span>
                      <span>{t.billing_cycle === 'yearly' ? 'Annuel' : 'Mensuel'}</span>
                      <span className="text-[#E5E7EB]">|</span>
                      <span className={`font-medium ${isUrgent ? 'text-red-600' : 'text-orange-600'}`}>
                        {days <= 0 ? 'Expiré' : `Expire dans ${days}j`}
                      </span>
                      <span className="text-[#94A3B8]">
                        ({new Date(t.plan_expires_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })})
                      </span>
                      {t.auto_renew && <span className="text-[10px] bg-[#F7F8FA] text-[#64748B] border border-[#E5E7EB] px-1.5 py-0.5 rounded">auto-renew</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => sendReminder(t.id)}
                    disabled={sendingReminder === t.id}
                    className="shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-[#111111] hover:bg-[#333333] text-white text-xs font-medium transition-colors disabled:opacity-50"
                  >
                    {sendingReminder === t.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bell className="w-3 h-3" />}
                    Rappeler
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Search + Filters */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Rechercher par tenant, plan ou statut..."
            className="w-full pl-10 pr-4 py-2.5 text-sm border border-[#E5E7EB] rounded-lg bg-white text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:ring-1 focus:ring-[#0F172A] focus:border-[#0F172A]"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                statusFilter === f.key
                  ? 'bg-[#111111] text-white border-[#111111]'
                  : 'bg-white text-[#64748B] border-[#E5E7EB] hover:border-[#0F172A] hover:text-[#0F172A]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table (desktop) / Cards (mobile) */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-[#E5E7EB] py-12 text-center">
          <div className="text-sm text-[#64748B]">Aucun abonnement trouvé</div>
          <p className="text-xs text-[#94A3B8] mt-1">Essayez de modifier votre recherche ou vos filtres.</p>
          {(q || statusFilter !== 'all') && (
            <button onClick={resetFilters} className="mt-3 text-xs font-medium text-[#0F172A] border border-[#E5E7EB] px-3 py-1.5 rounded-md hover:bg-[#F7F8FA] transition-colors">
              Réinitialiser les filtres
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
            <div className="grid grid-cols-[1.4fr_0.8fr_0.7fr_0.8fr_1fr_0.7fr] gap-3 px-5 py-3 bg-[#F7F8FA] border-b border-[#E5E7EB]">
              <div className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">Tenant</div>
              <div className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">Plan</div>
              <div className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">Cycle</div>
              <div className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider text-right">Montant</div>
              <div className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">Période</div>
              <div className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">Statut</div>
            </div>
            <div className="divide-y divide-[#E5E7EB]">
              {filtered.map(r => (
                <div
                  key={r.id}
                  className={`grid grid-cols-[1.4fr_0.8fr_0.7fr_0.8fr_1fr_0.7fr] gap-3 px-5 py-3.5 items-center hover:bg-[#F7F8FA] transition-colors ${r.status === 'superseded' ? 'opacity-50' : ''}`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[#0F172A] truncate">{r.tenant_name}</div>
                    {(r.tenant_email || r.tenant_subdomain) && (
                      <div className="text-xs text-[#94A3B8] truncate mt-0.5">{r.tenant_subdomain || r.tenant_email}</div>
                    )}
                  </div>
                  <div>
                    <span className="text-xs font-medium text-[#0F172A] bg-[#F7F8FA] border border-[#E5E7EB] px-2 py-0.5 rounded">{r.plan_code}</span>
                  </div>
                  <div className="text-xs text-[#64748B]">{cycleLabel(r.billing_cycle)}</div>
                  <div className="text-sm font-semibold text-[#0F172A] text-right">{formatFCFA(r.amount)}</div>
                  <div className="text-xs text-[#64748B]">
                    {formatDate(r.started_at)}{r.ends_at ? ` - ${formatDate(r.ends_at)}` : ''}
                  </div>
                  <div>
                    <span className={`inline-flex text-[11px] font-medium px-2 py-0.5 rounded-full border ${statusStyle(r.status)}`}>
                      {statusLabel(r.status)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {filtered.map(r => (
              <div key={r.id} className={`bg-white rounded-lg border border-[#E5E7EB] p-4 ${r.status === 'superseded' ? 'opacity-50' : ''}`}>
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-[#0F172A] truncate">{r.tenant_name}</div>
                    {(r.tenant_email || r.tenant_subdomain) && (
                      <div className="text-xs text-[#94A3B8] truncate">{r.tenant_subdomain || r.tenant_email}</div>
                    )}
                  </div>
                  <span className={`inline-flex text-[11px] font-medium px-2 py-0.5 rounded-full border shrink-0 ${statusStyle(r.status)}`}>
                    {statusLabel(r.status)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-y-2 gap-x-4 mt-3">
                  <div>
                    <div className="text-[10px] uppercase text-[#94A3B8] font-medium tracking-wider">Plan</div>
                    <div className="text-xs text-[#0F172A] font-medium mt-0.5">{r.plan_code}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-[#94A3B8] font-medium tracking-wider">Cycle</div>
                    <div className="text-xs text-[#64748B] mt-0.5">{cycleLabel(r.billing_cycle)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-[#94A3B8] font-medium tracking-wider">Montant</div>
                    <div className="text-sm font-semibold text-[#0F172A] mt-0.5">{formatFCFA(r.amount)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-[#94A3B8] font-medium tracking-wider">Période</div>
                    <div className="text-xs text-[#64748B] mt-0.5">{formatDate(r.started_at)}{r.ends_at ? ` - ${formatDate(r.ends_at)}` : ''}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ============== MESSAGES ============== */
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
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{messages.length} message{messages.length > 1 ? 's' : ''} publié(s)</p>
        <button onClick={() => setOpen(true)} className="btn-primary"><Send className="w-4 h-4" />Nouveau message</button>
      </div>

      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
      ) : (
        <div className="space-y-2">
          {messages.map(m => {
            const sev = SEV[m.severity as keyof typeof SEV] || SEV.info;
            const expired = m.expires_at && new Date(m.expires_at) < new Date();
            return (
              <div key={m.id} className={`bg-white border-l-4 ${sev.border} border-y border-r border-slate-200/70 rounded-2xl p-4 shadow-card`}>
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-xl ${sev.bg} ${sev.icon} flex items-center justify-center shrink-0 border ${sev.border}`}>
                    {m.severity === 'critical' ? <AlertTriangle className="w-5 h-5" /> : m.severity === 'warning' ? <AlertTriangle className="w-5 h-5" /> : <MessageSquare className="w-5 h-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-900">{m.title}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${sev.bg} ${sev.text}`}>{sev.label}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider bg-slate-100 text-slate-600">
                        {m.target === 'all' ? 'Tous' : m.target === 'tenant' ? `Tenant: ${m.tenants?.name || ''}` : `Plan: ${m.plan_code}`}
                      </span>
                      {expired && <span className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-bold uppercase">Expiré</span>}
                    </div>
                    <p className="text-sm text-slate-600 mt-1 line-clamp-2">{m.body}</p>
                    <div className="text-[11px] text-slate-400 mt-1">Publié {formatDateTime(m.created_at)}{m.expires_at ? ` · expire ${formatDate(m.expires_at)}` : ''}</div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => setPreview(m)} className="p-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200" title="Prévisualiser"><Search className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setToDelete(m)} className="p-1.5 rounded-lg bg-red-50 text-red-500 hover:bg-red-100"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              </div>
            );
          })}
          {messages.length === 0 && <div className="text-center text-slate-400 py-10 text-sm">Aucun message publié.</div>}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Nouveau message" size="md"
        footer={<><button onClick={() => setOpen(false)} className="btn-secondary">Annuler</button><button onClick={save} className="btn-primary"><Send className="w-4 h-4" />Publier</button></>}>
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
        <Modal open onClose={() => setPreview(null)} title="Prévisualisation" size="sm" footer={<button onClick={() => setPreview(null)} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>}>
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
  const [events, setEvents] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'overview' | 'log'>('overview');
  const { error } = useToast();

  useEffect(() => {
    (async () => {
      try {
        const [evRes, actRes] = await Promise.all([
          call('list_events', { limit: 200 }),
          call('tenant_activity_overview'),
        ]);
        setEvents(evRes.events || []);
        setActivity(actRes.activity || []);
      } catch (e: any) { error(e.message); }
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>;

  const now = Date.now();
  const activeCount = activity.filter(a => a.last_active_at && (now - new Date(a.last_active_at).getTime()) < 7 * 86400000).length;
  const inactiveCount = activity.filter(a => !a.last_active_at || (now - new Date(a.last_active_at).getTime()) >= 30 * 86400000).length;

  return (
    <div className="space-y-4">
      {/* Tab toggles */}
      <div className="inline-flex rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <button onClick={() => setTab('overview')} className={`px-4 py-2 text-xs font-bold transition-all ${tab === 'overview' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
          <Eye className="w-3.5 h-3.5 inline mr-1.5" />Vue globale
        </button>
        <button onClick={() => setTab('log')} className={`px-4 py-2 text-xs font-bold border-l border-slate-200 transition-all ${tab === 'log' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
          <Activity className="w-3.5 h-3.5 inline mr-1.5" />Journal
        </button>
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          {/* KPI */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white border border-slate-200/70 rounded-2xl p-4 shadow-card">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Tenants actifs (7j)</div>
              <div className="text-2xl font-extrabold text-emerald-700 mt-1">{activeCount}</div>
            </div>
            <div className="bg-white border border-slate-200/70 rounded-2xl p-4 shadow-card">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Inactifs (30j+)</div>
              <div className="text-2xl font-extrabold text-red-600 mt-1">{inactiveCount}</div>
            </div>
            <div className="bg-white border border-slate-200/70 rounded-2xl p-4 shadow-card">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Total ventes</div>
              <div className="text-2xl font-extrabold text-slate-800 mt-1">{activity.reduce((s, a) => s + (a.total_sales || 0), 0)}</div>
            </div>
            <div className="bg-white border border-slate-200/70 rounded-2xl p-4 shadow-card">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Total articles</div>
              <div className="text-2xl font-extrabold text-slate-800 mt-1">{activity.reduce((s, a) => s + (a.total_articles || 0), 0)}</div>
            </div>
          </div>

          {/* Activity table */}
          <div className="bg-white border border-slate-200/70 rounded-3xl shadow-card overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center gap-2">
              <LineChart className="w-4 h-4 text-brand-700" />
              <h3 className="text-sm font-bold text-slate-900">Activite des tenants approuves</h3>
              <span className="ml-auto text-xs text-slate-500">{activity.length} tenants</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/80">
                    <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Tenant</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-center">Utilisateurs</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-center">Articles</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-center">Ventes</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Derniere activite</th>
                    <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.map(a => {
                    const lastMs = a.last_active_at ? now - new Date(a.last_active_at).getTime() : null;
                    const isActive = lastMs !== null && lastMs < 7 * 86400000;
                    const isRecent = lastMs !== null && lastMs < 30 * 86400000;
                    const statusLabel = lastMs === null ? 'Jamais connecte' : isActive ? 'Actif' : isRecent ? 'Recemment' : 'Inactif';
                    const statusColor = lastMs === null ? 'bg-slate-100 text-slate-600' : isActive ? 'bg-emerald-100 text-emerald-700' : isRecent ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
                    return (
                      <tr key={a.tenant_id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-2.5">
                          <div className="text-xs font-semibold text-slate-900">{a.tenant_name}</div>
                          <div className="text-[10px] text-slate-400">Cree {formatDate(a.created_at)}</div>
                        </td>
                        <td className="px-3 py-2.5 text-center text-xs font-bold text-slate-700">{a.total_users}</td>
                        <td className="px-3 py-2.5 text-center text-xs font-bold text-slate-700">{a.total_articles}</td>
                        <td className="px-3 py-2.5 text-center text-xs font-bold text-slate-700">{a.total_sales}</td>
                        <td className="px-3 py-2.5 text-xs text-slate-600">
                          {a.last_active_at ? formatDateTime(a.last_active_at) : <span className="text-slate-400 italic">Jamais</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusColor}`}>{statusLabel}</span>
                        </td>
                      </tr>
                    );
                  })}
                  {activity.length === 0 && (
                    <tr><td colSpan={6} className="py-10 text-center text-sm text-slate-400">Aucun tenant approuve.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'log' && (
        <div className="bg-white border border-slate-200/70 rounded-3xl p-5 shadow-card">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-brand-700" />
            <h3 className="text-sm font-bold text-slate-900">Journal d'activite plateforme</h3>
            <span className="ml-auto text-xs text-slate-500">{events.length} evenement{events.length > 1 ? 's' : ''}</span>
          </div>
          <div className="space-y-1">
            {events.map(ev => <EventRow key={ev.id} ev={ev} />)}
            {events.length === 0 && <div className="text-center text-slate-400 py-10 text-sm">Aucune activite enregistree.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============== LOGIN CONFIG ============== */

const ICON_MAP_ADMIN: Record<string, any> = {
  ShoppingCart, Package: Package_, FileText: FileText_, Users, Truck,
  Globe: Globe_, BarChart3, TrendingUp, Shield, Zap, Receipt,
  Monitor, Wallet, Layers, Settings: Settings_,
};

const ALL_APP_FEATURES: { icon: string; label: string; desc: string; color: string }[] = [
  { icon: 'ShoppingCart', label: 'Point de vente', desc: 'Caisse rapide et intuitive', color: 'text-teal-600 bg-teal-50' },
  { icon: 'Package', label: 'Stock', desc: 'Maîtrisez vos stocks', color: 'text-neutral-700 bg-neutral-50' },
  { icon: 'FileText', label: 'Facturation', desc: 'Devis et factures pro', color: 'text-amber-600 bg-amber-50' },
  { icon: 'Users', label: 'Clients & Tiers', desc: 'CRM et créances', color: 'text-emerald-600 bg-emerald-50' },
  { icon: 'Truck', label: 'Fournisseurs', desc: 'Commandes et dettes', color: 'text-orange-600 bg-orange-50' },
  { icon: 'Globe', label: 'Boutique en ligne', desc: 'Vitrine et commandes web', color: 'text-cyan-600 bg-cyan-50' },
  { icon: 'BarChart3', label: 'Comptabilité', desc: 'Suivi financier complet', color: 'text-rose-600 bg-rose-50' },
  { icon: 'TrendingUp', label: 'Rapports', desc: 'Analyses et tableaux de bord', color: 'text-neutral-700 bg-neutral-50' },
  { icon: 'Shield', label: 'Sécurité', desc: 'Rôles et permissions', color: 'text-slate-600 bg-slate-100' },
];

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

type LoginModule = { icon: string; label: string; desc: string };

function LoginConfigSection() {
  const { success, error } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [headline, setHeadline] = useState('');
  const [headlineAccent, setHeadlineAccent] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [loginBgUrl, setLoginBgUrl] = useState<string | null>(null);
  const [modules, setModules] = useState<LoginModule[]>([]);
  const [previewSlide, setPreviewSlide] = useState(0);
  const [previewAnim, setPreviewAnim] = useState<'in' | 'out'>('in');
  const [activeTab, setActiveTab] = useState<'textes' | 'modules'>('textes');

  useEffect(() => {
    (async () => {
      try {
        const data = await call('get_login_config');
        setHeadline(data.headline || '');
        setHeadlineAccent(data.headline_accent || '');
        setSubtitle(data.subtitle || '');
        setLoginBgUrl(data.login_bg_url || null);
        setModules(data.modules || []);
      } catch (e: any) { error(e.message); }
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await call('update_login_config', { headline, headline_accent: headlineAccent, subtitle, modules, login_bg_url: loginBgUrl });
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
      {/* Header */}
      <div className="bg-white border border-slate-200/70 rounded-3xl p-5 shadow-card">
        <div className="flex items-center gap-2 mb-1">
          <Eye className="w-4 h-4 text-brand-700" />
          <h3 className="text-sm font-bold text-slate-900">Interface de connexion</h3>
        </div>
        <p className="text-xs text-slate-500">Personnalisez les textes et modules affichés sur l'écran de connexion WAARWI. Les changements sont visibles immédiatement.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* Left: Editor */}
        <div className="space-y-4">
          {/* Tabs */}
          <div className="flex bg-slate-100 rounded-xl p-1 border border-slate-200">
            <button
              onClick={() => setActiveTab('textes')}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${activeTab === 'textes' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Textes
            </button>
            <button
              onClick={() => setActiveTab('modules')}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${activeTab === 'modules' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Modules ({modules.length})
            </button>
          </div>

          {activeTab === 'textes' && (
            <div className="bg-white border border-slate-200/70 rounded-3xl p-5 shadow-card space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Titre principal</label>
                <input
                  value={headline}
                  onChange={e => setHeadline(e.target.value)}
                  placeholder="La plateforme qui simplifie,"
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400"
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
                <label className="block text-xs font-semibold text-slate-700 mb-1">Image de fond</label>
                <div className="flex items-center gap-3">
                  {loginBgUrl && (
                    <img src={loginBgUrl} alt="Fond" className="w-24 h-14 object-cover rounded-xl border border-slate-200" />
                  )}
                  <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 transition-colors">
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

          {activeTab === 'modules' && (
            <div className="bg-white border border-slate-200/70 rounded-3xl p-5 shadow-card space-y-4">
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

              <div className="space-y-2 max-h-[420px] overflow-y-auto -mr-1 pr-1">
                {modules.map((mod, idx) => {
                  const IconComp = ICON_MAP_ADMIN[mod.icon] || Shield;
                  return (
                    <div key={idx} className="p-2.5 rounded-xl border border-slate-100 bg-slate-50/60 group space-y-2">
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
                        <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                          <IconComp className="w-3.5 h-3.5 text-teal-600" />
                        </div>
                        {/* Icon select */}
                        <select
                          value={mod.icon}
                          onChange={e => updateModule(idx, 'icon', e.target.value)}
                          className="h-8 px-2 rounded-lg border border-slate-200 text-[11px] text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-brand-400 shrink-0"
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
          <div className="bg-white border border-slate-200/70 rounded-3xl shadow-card overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs font-bold text-slate-700">Aperçu en direct</span>
              </div>
              <span className="text-[10px] text-slate-400">Écran de connexion</span>
            </div>
            <div className="p-4 bg-[#f0f4f8]">
              {/* Mini mockup of login screen left panel */}
              <div className="rounded-xl bg-white border border-slate-200 shadow-sm p-4 space-y-3">
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
                    <div key={i} className="rounded-lg p-1.5 bg-slate-50 border border-slate-100">
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
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-black text-slate-900">Mises à jour</h2>
          <p className="text-sm text-slate-500 mt-0.5">Gérez les notifications de mise à jour affichées aux utilisateurs</p>
        </div>
        <button onClick={openNew} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-all shadow-sm">
          <Plus className="w-4 h-4" />Nouvelle version
        </button>
      </div>

      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : releases.length === 0 ? (
        <div className="py-16 text-center text-sm text-slate-400">Aucune mise à jour créée</div>
      ) : (
        <div className="space-y-3">
          {releases.map(r => (
            <div key={r.id} className={`rounded-xl border p-4 transition-all ${r.is_published ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 bg-white'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-black text-slate-900">{r.title}</span>
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-bold">v{r.version}</span>
                    {r.is_published && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-bold flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />Publiée
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">{formatDate(r.release_date)}</div>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                    {r.features.length > 0 && (
                      <span className="flex items-center gap-1"><Sparkles className="w-3 h-3 text-emerald-500" />{r.features.length} nouveauté{r.features.length > 1 ? 's' : ''}</span>
                    )}
                    {r.fixes.length > 0 && (
                      <span className="flex items-center gap-1"><Bug className="w-3 h-3 text-sky-500" />{r.fixes.length} correction{r.fixes.length > 1 ? 's' : ''}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => togglePublish(r)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${r.is_published ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}>
                    {r.is_published ? 'Dépublier' : 'Publier'}
                  </button>
                  <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><Edit2 className="w-4 h-4" /></button>
                  <button onClick={() => setDeleteConfirm(r.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit/Create Modal */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={editId ? 'Modifier la mise à jour' : 'Nouvelle mise à jour'} size="lg">
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
              <span className="flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-emerald-500" />Nouveautés</span>
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
            <button onClick={() => setEditOpen(false)} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">Annuler</button>
            <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-all disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {editId ? 'Enregistrer' : 'Créer'}
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
