import { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowUpRight, Ban, Building2, Check, CircleDollarSign, Clock,
  CreditCard as Edit2, Gauge, Layers, LineChart, Loader2, Mail, MessageSquare, Pause, Plus,
  Power, Search, Send, Shield, Sparkles, Trash2, TrendingUp, Users, Zap, X,
  Wrench as Wrench_, Store as Store_, ShoppingBag as ShoppingBag_, Shirt as Shirt_, Cpu as Cpu_,
  CreditCard as CreditCard_, Package as Package_, Boxes as Boxes_, FileText as FileText_,
  Globe as Globe_, BookOpen as BookOpen_, Settings as Settings_, Info as Info_, Library,
  ShoppingCart, Truck, Wallet, BarChart3, Receipt, Eye, Monitor, Globe, ImagePlus,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { Modal, ConfirmDialog } from '../components/Modal';
import { formatCompactFCFA, formatDate, formatDateTime, formatFCFA } from '../lib/format';
import { MasterCatalogAdmin } from '../components/MasterCatalogAdmin';

type Section = 'overview' | 'tenants' | 'plans' | 'subscriptions' | 'messages' | 'activity' | 'master_catalogs' | 'login_config';

async function call(action: string, payload: Record<string, unknown> = {}) {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erreur');
  return data;
}

const SEV = {
  info: { bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-800', icon: 'text-sky-600', label: 'Info' },
  success: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-800', icon: 'text-emerald-600', label: 'Succès' },
  warning: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800', icon: 'text-amber-600', label: 'Avertissement' },
  critical: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800', icon: 'text-red-600', label: 'Critique' },
} as const;

export function PlatformAdmin() {
  const [section, setSection] = useState<Section>('overview');

  const sections: { k: Section; l: string; icon: any }[] = [
    { k: 'overview', l: 'Vue d\'ensemble', icon: Gauge },
    { k: 'tenants', l: 'Tenants', icon: Building2 },
    { k: 'plans', l: 'Plans', icon: Layers },
    { k: 'subscriptions', l: 'Abonnements', icon: CircleDollarSign },
    { k: 'messages', l: 'Messages', icon: MessageSquare },
    { k: 'login_config', l: 'Écran d\'accueil', icon: Store_ },
    { k: 'master_catalogs', l: 'Catalogues maîtres', icon: Library },
    { k: 'activity', l: 'Activité', icon: Activity },
  ];

  return (
    <div className="space-y-6">
      {/* Premium header */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-6 text-white shadow-premium">
        <div className="absolute top-0 right-0 w-72 h-72 bg-gradient-to-br from-emerald-500/20 to-transparent rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-72 h-72 bg-gradient-to-tr from-teal-500/20 to-transparent rounded-full blur-3xl" />
        <div className="relative flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white flex items-center justify-center shadow-lg overflow-hidden p-1">
            <img src="/Picsart_26-05-30_02-43-37-384.png" alt="WAARWI" className="w-full h-full object-contain" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">WAARWI · Console plateforme</h1>
              <span className="text-[10px] font-bold bg-amber-500/20 border border-amber-400/30 text-amber-200 px-2 py-0.5 rounded-full uppercase tracking-wider">Super admin</span>
            </div>
            <p className="text-sm text-slate-300 mt-0.5">Plateforme Business 2.0 made in Sénégal · Pilotage global</p>
          </div>
        </div>
      </div>

      {/* Section nav */}
      <div className="flex overflow-x-auto gap-1 bg-white/60 border border-slate-200/70 rounded-2xl p-1 shadow-sm">
        {sections.map(s => {
          const I = s.icon;
          const active = section === s.k;
          return (
            <button
              key={s.k}
              onClick={() => setSection(s.k)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-semibold whitespace-nowrap transition-all ${
                active ? 'bg-slate-900 text-white shadow' : 'text-slate-600 hover:bg-white hover:text-slate-900'
              }`}
            >
              <I className="w-4 h-4" />{s.l}
            </button>
          );
        })}
      </div>

      {section === 'overview' && <OverviewSection />}
      {section === 'tenants' && <TenantsSection />}
      {section === 'plans' && <PlansSection />}
      {section === 'subscriptions' && <SubscriptionsSection />}
      {section === 'messages' && <MessagesSection />}
      {section === 'login_config' && <LoginConfigSection />}
      {section === 'master_catalogs' && <MasterCatalogAdmin />}
      {section === 'activity' && <ActivitySection />}
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

  if (loading) return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>;
  if (!data) return null;

  const planColors: Record<string, string> = {
    trial: 'from-slate-500 to-slate-700',
    starter: 'from-sky-500 to-sky-700',
    pro: 'from-emerald-500 to-teal-700',
    enterprise: 'from-amber-500 to-amber-700',
  };

  return (
    <div className="space-y-4">
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={Building2} label="Tenants" value={data.tenants_total} sub={`${data.tenants_active} actifs`} trend="up" color="emerald" />
        <KpiCard icon={CircleDollarSign} label="MRR" value={formatCompactFCFA(data.mrr)} sub="Revenu mensuel récurrent" color="amber" />
        <KpiCard icon={Users} label="Utilisateurs" value={data.users_total} sub="Tous tenants" color="sky" />
        <KpiCard icon={Ban} label="Suspendus" value={data.tenants_suspended} sub="À surveiller" color="red" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Plan distribution */}
        <div className="lg:col-span-2 bg-white border border-slate-200/70 rounded-3xl p-5 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Répartition par plan</h3>
              <p className="text-xs text-slate-500">Distribution des tenants actifs</p>
            </div>
            <Layers className="w-5 h-5 text-slate-300" />
          </div>
          <div className="space-y-2.5">
            {Object.entries(data.by_plan as Record<string, number>).map(([plan, count]) => {
              const pct = data.tenants_total ? (count as number) / data.tenants_total * 100 : 0;
              return (
                <div key={plan}>
                  <div className="flex items-center justify-between text-xs font-semibold mb-1">
                    <span className="capitalize text-slate-700">{plan}</span>
                    <span className="text-slate-500">{count} <span className="text-slate-400">· {pct.toFixed(0)}%</span></span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className={`h-full bg-gradient-to-r ${planColors[plan] || 'from-slate-400 to-slate-600'} transition-all duration-500`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Expiring soon */}
        <div className="bg-white border border-slate-200/70 rounded-3xl p-5 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Expirations proches</h3>
              <p className="text-xs text-slate-500">7 prochains jours</p>
            </div>
            <Clock className="w-5 h-5 text-amber-400" />
          </div>
          {data.expiring_soon.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">Aucune expiration proche.</p>
          ) : (
            <div className="space-y-2">
              {data.expiring_soon.slice(0, 6).map((t: any) => (
                <div key={t.id} className="flex items-center justify-between text-xs border-b border-slate-100 pb-2 last:border-0">
                  <span className="font-semibold text-slate-700 truncate">{t.name}</span>
                  <span className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full font-semibold shrink-0 ml-2">{formatDate(t.plan_expires_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent activity */}
      <div className="bg-white border border-slate-200/70 rounded-3xl p-5 shadow-card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Activité récente</h3>
            <p className="text-xs text-slate-500">Dernières actions plateforme</p>
          </div>
          <Activity className="w-5 h-5 text-slate-300" />
        </div>
        {data.recent_events.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">Aucune activité.</p>
        ) : (
          <div className="space-y-1.5">
            {data.recent_events.map((ev: any) => (
              <EventRow key={ev.id} ev={ev} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub, color }: any) {
  const colors: Record<string, string> = {
    emerald: 'from-emerald-500 to-teal-600 shadow-emerald-500/30',
    amber: 'from-amber-500 to-orange-600 shadow-amber-500/30',
    sky: 'from-sky-500 to-blue-600 shadow-sky-500/30',
    red: 'from-red-500 to-rose-600 shadow-red-500/30',
  };
  return (
    <div className="relative overflow-hidden bg-white border border-slate-200/70 rounded-3xl p-4 shadow-card">
      <div className={`absolute -top-4 -right-4 w-20 h-20 rounded-full bg-gradient-to-br ${colors[color]} opacity-10 blur-xl`} />
      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${colors[color]} text-white flex items-center justify-center mb-3 shadow-lg`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-2xl font-bold text-slate-900 leading-tight">{value}</div>
      <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>
    </div>
  );
}

function EventRow({ ev }: { ev: any }) {
  const icons: Record<string, any> = {
    'tenant.suspend': Ban, 'tenant.reactivate': Power, 'tenant.update': Edit2,
    'subscription.create': Sparkles, 'subscription.cancel': X,
    'plan.upsert': Layers, 'plan.delete': Trash2,
    'message.create': MessageSquare, 'message.delete': X,
  };
  const I = icons[ev.action] || Activity;
  const tenantName = ev.tenants?.name || (ev.payload?.name) || (ev.tenant_id ? 'Tenant' : 'Plateforme');
  return (
    <div className="flex items-start gap-2.5 text-[12px] py-1.5">
      <div className="w-7 h-7 shrink-0 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center">
        <I className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-slate-800">{ev.action}</div>
        <div className="text-[11px] text-slate-500 truncate">{tenantName} · {ev.actor_email}</div>
      </div>
      <div className="text-[10px] text-slate-400 shrink-0 uppercase tracking-wider">{formatDateTime(ev.created_at)}</div>
    </div>
  );
}

/* ============== TENANTS ============== */
function TenantsSection() {
  const [tenants, setTenants] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'active' | 'suspended' | 'expiring' | 'expired'>('all');
  const [detail, setDetail] = useState<any>(null);
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
      if (q && !`${t.name} ${t.email} ${t.phone}`.toLowerCase().includes(q.toLowerCase())) return false;
      const exp = t.plan_expires_at ? new Date(t.plan_expires_at) : null;
      const approval = t.approval_status || 'approved';
      if (filter === 'pending' && approval !== 'pending') return false;
      if (filter === 'active' && (!t.is_active || approval !== 'approved')) return false;
      if (filter === 'suspended' && t.is_active) return false;
      if (filter === 'expiring' && (!exp || exp < now || exp > in7)) return false;
      if (filter === 'expired' && (!exp || exp >= now)) return false;
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

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher un tenant…" className="input pl-9" />
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {(['all', 'pending', 'active', 'suspended', 'expiring', 'expired'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`relative px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                filter === f
                  ? (f === 'pending' ? 'bg-amber-500 text-white' : 'bg-slate-900 text-white')
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}>
              {f === 'all' ? 'Tous'
                : f === 'pending' ? 'En attente'
                : f === 'active' ? 'Actifs'
                : f === 'suspended' ? 'Suspendus'
                : f === 'expiring' ? 'Expirent bientôt' : 'Expirés'}
              {f === 'pending' && pendingCount > 0 && filter !== f && (
                <span className="ml-1.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-white text-[9px] font-bold">{pendingCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
      ) : (
        <div className="space-y-2">
          {filtered.map(t => {
            const plan = planByCode[t.plan];
            const exp = t.plan_expires_at ? new Date(t.plan_expires_at) : null;
            const expired = exp && exp < new Date();
            const approval = t.approval_status || 'approved';
            const isPending = approval === 'pending';
            const isRejected = approval === 'rejected';
            return (
              <div key={t.id} className={`bg-white border rounded-2xl shadow-card p-4 hover:border-slate-300 transition-colors ${
                isPending ? 'border-amber-300 ring-1 ring-amber-200' : 'border-slate-200/70'
              }`}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br text-white font-extrabold flex items-center justify-center shrink-0 ${
                      isPending ? 'from-amber-500 to-orange-600' : t.is_active ? 'from-emerald-500 to-teal-700' : 'from-slate-400 to-slate-600'
                    }`}>
                      {(t.name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 truncate">{t.name}</span>
                        <PlanBadge plan={plan} code={t.plan} />
                        {isPending && <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">En attente</span>}
                        {isRejected && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Rejeté</span>}
                        {!isPending && !isRejected && !t.is_active && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Suspendu</span>}
                        {expired && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Expiré</span>}
                      </div>
                      <div className="text-xs text-slate-500 truncate">{t.email || '—'} · {(t.profiles || []).length} utilisateur(s) · Créé {formatDate(t.created_at)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs shrink-0">
                    {exp && (
                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-wider text-slate-400">Expire</div>
                        <div className={`font-bold ${expired ? 'text-red-600' : 'text-slate-700'}`}>{formatDate(exp)}</div>
                      </div>
                    )}
                    <div className="flex gap-1">
                      {isPending && (
                        <>
                          <button
                            onClick={() => approve(t)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 flex items-center gap-1"
                            title="Approuver"
                          ><Check className="w-3.5 h-3.5" />Approuver</button>
                          <button
                            onClick={() => {
                              const reason = prompt('Motif du rejet ? (optionnel)') || '';
                              reject(t, reason);
                            }}
                            className="p-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100"
                            title="Rejeter"
                          ><Ban className="w-3.5 h-3.5" /></button>
                        </>
                      )}
                      <button onClick={() => setDetail(t)} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 flex items-center gap-1">
                        Gérer <ArrowUpRight className="w-3 h-3" />
                      </button>
                      {!isPending && (t.is_active ? (
                        <button
                          onClick={() => {
                            const reason = prompt('Raison de la suspension ?') || '';
                            suspend(t, reason);
                          }}
                          className="p-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100"
                          title="Suspendre"
                        ><Pause className="w-3.5 h-3.5" /></button>
                      ) : (
                        <button onClick={() => reactivate(t)} className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100" title="Réactiver">
                          <Power className="w-3.5 h-3.5" />
                        </button>
                      ))}
                      <button
                        onClick={() => { setDeleting(t); setDeleteConfirmName(''); setDeleteReason(''); }}
                        className="p-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100"
                        title="Supprimer définitivement"
                      ><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <div className="text-center text-slate-400 py-10 text-sm">Aucun tenant ne correspond.</div>}
        </div>
      )}

      {detail && <TenantDetailModal tenant={detail} plans={plans} onClose={() => setDetail(null)} onRefresh={load} onDelete={(t: any) => { setDeleting(t); setDeleteConfirmName(''); setDeleteReason(''); }} />}

      {/* Delete tenant confirmation modal */}
      <Modal open={!!deleting} onClose={() => { if (!deleteLoading) { setDeleting(null); setDeleteConfirmName(''); setDeleteReason(''); } }} title="" size="md" footer={null}>
        {deleting && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-red-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-red-900">Supprimer definitivement</h3>
                <p className="text-sm text-red-700">Cette action est irreversible !</p>
              </div>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-2">
              <p className="text-sm text-red-800 font-semibold">Toutes les donnees suivantes seront supprimees :</p>
              <ul className="text-xs text-red-700 space-y-1 ml-4 list-disc">
                <li>Tous les articles, categories et compatibilites</li>
                <li>Toutes les ventes, factures, devis et avoirs</li>
                <li>Tous les clients, fournisseurs et commandes fournisseurs</li>
                <li>Tout le stock, mouvements et sessions de caisse</li>
                <li>La boutique en ligne et les commandes</li>
                <li>La comptabilite et les ecritures</li>
                <li>Les abonnements et sauvegardes</li>
                <li>Tous les comptes utilisateurs du tenant</li>
              </ul>
            </div>

            <div>
              <label className="label text-red-800">Motif de la suppression</label>
              <input
                value={deleteReason}
                onChange={e => setDeleteReason(e.target.value)}
                className="input border-red-200 focus:ring-red-500 focus:border-red-500"
                placeholder="Ex: Demande du client, compte test, doublon..."
              />
            </div>

            <div>
              <label className="label text-red-800">
                Tapez <span className="font-mono font-bold bg-red-100 px-1.5 py-0.5 rounded">{deleting.name}</span> pour confirmer
              </label>
              <input
                value={deleteConfirmName}
                onChange={e => setDeleteConfirmName(e.target.value)}
                className="input border-red-200 focus:ring-red-500 focus:border-red-500 font-mono"
                placeholder={deleting.name}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => { setDeleting(null); setDeleteConfirmName(''); setDeleteReason(''); }}
                disabled={deleteLoading}
                className="btn-secondary"
              >Annuler</button>
              <button
                onClick={deleteTenant}
                disabled={deleteConfirmName !== deleting.name || deleteLoading}
                className="px-4 py-2 rounded-xl bg-red-600 text-white font-semibold text-sm hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
              >
                {deleteLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Supprimer definitivement
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
    trial: 'bg-slate-100 text-slate-700 border-slate-200',
    starter: 'bg-sky-50 text-sky-700 border-sky-200',
    pro: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    enterprise: 'bg-amber-50 text-amber-700 border-amber-200',
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border uppercase tracking-wider ${colors[code] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
      {plan?.name || code}
    </span>
  );
}

const ACTIVITY_ICONS: Record<string, any> = {
  auto_parts: Wrench_,
  alimentaire: ShoppingBag_,
  electromenager: Cpu_,
  textile: Shirt_,
  cosmetique: Sparkles,
  librairie: BookOpen_,
  mercerie: Package_,
  quincaillerie: Wrench_,
  services: Sparkles,
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
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <h4 className="text-sm font-bold text-slate-900">Type de commerce</h4>
            <p className="text-xs text-slate-500">Aligné sur les catalogues maîtres: détermine le catalogue importable pour ce tenant.</p>
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
                className={`text-left p-3 rounded-2xl border-2 transition-all ${active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <I className={`w-4 h-4 ${active ? 'text-amber-400' : 'text-slate-500'}`} />
                  <span className="font-bold text-sm">{a.name}</span>
                </div>
                <div className={`text-[11px] leading-snug ${active ? 'text-slate-300' : 'text-slate-500'}`}>{a.description}</div>
              </button>
            );
          })}
        </div>
        {form.business_activity_type_id || form.business_type === 'auto_parts' ? (
          <div className="mt-2 flex items-start gap-2 text-[11px] bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-2.5">
            <Sparkles className="w-4 h-4 shrink-0 mt-px text-amber-600" />
            <span>Le tenant pourra importer depuis le catalogue maître correspondant. Les articles ne sont copiés que sur action du tenant.</span>
          </div>
        ) : (
          <div className="mt-2 flex items-start gap-2 text-[11px] bg-sky-50 border border-sky-200 text-sky-800 rounded-xl p-2.5">
            <Info_ className="w-4 h-4 shrink-0 mt-px text-sky-600" />
            <span>Sélectionnez un type d'activité pour activer l'accès au catalogue maître correspondant.</span>
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <h4 className="text-sm font-bold text-slate-900">Modules accessibles</h4>
            <p className="text-xs text-slate-500">Cochez les pages que le tenant pourra voir dans la barre latérale.</p>
          </div>
          <div className="flex gap-1">
            <button onClick={minimal} className="text-[11px] px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold">Minimal</button>
            <button onClick={allOn} className="text-[11px] px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold">Tout activer</button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {MODULE_DEFS.map(m => {
            const on = modules.includes(m.key);
            const I = m.icon;
            return (
              <button key={m.key} onClick={() => toggle(m.key)}
                className={`flex items-center gap-3 p-3 rounded-2xl border-2 transition-all text-left ${on ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${on ? 'bg-gradient-to-br from-emerald-500 to-teal-700 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  <I className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm text-slate-900 truncate">{m.name}</div>
                  <div className="text-[11px] text-slate-500 truncate">{m.desc}</div>
                </div>
                <div className={`shrink-0 w-9 h-5 rounded-full relative transition-colors ${on ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                  <span className={`absolute top-0.5 ${on ? 'right-0.5' : 'left-0.5'} w-4 h-4 bg-white rounded-full shadow transition-all`} />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {usage && (
        <div className="rounded-2xl border border-slate-200 p-3 bg-slate-50">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Usage vs limites du plan</div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <UsageBar label="Magasins" current={usage.sites_count} limit={usage.plan_limits?.sites} />
            <UsageBar label="Utilisateurs" current={usage.users_count} limit={usage.plan_limits?.users} />
            <UsageBar label="Articles" current={usage.articles_count} limit={usage.plan_limits?.articles} />
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button onClick={onSave} disabled={saving} className="btn-primary">
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
    <div className="bg-white border border-slate-200 rounded-xl p-2.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
        <span className={`text-xs font-bold ${reached ? 'text-red-600' : 'text-slate-800'}`}>
          {current}{unlimited ? ' / ∞' : ` / ${limit}`}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full ${reached ? 'bg-red-500' : 'bg-emerald-500'} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function TenantDetailModal({ tenant, plans, onClose, onRefresh, onDelete }: { tenant: any; plans: any[]; onClose: () => void; onRefresh: () => void; onDelete?: (t: any) => void }) {
  const [detail, setDetail] = useState<any>(null);
  const [tab, setTab] = useState<'info' | 'sub' | 'modules' | 'users' | 'history'>('info');
  const [form, setForm] = useState<any>({
    ...tenant,
    plan_expires_at: tenant.plan_expires_at?.slice(0, 10) || '',
    business_type: tenant.business_type || 'auto_parts',
    business_activity_type_id: tenant.business_activity_type_id || null,
    enabled_modules: Array.isArray(tenant.enabled_modules) ? tenant.enabled_modules : ['dashboard','pos','cash_history','articles','stock','tiers','sales','billing','supplier_orders','online_orders','accounting','settings'],
  });
  const [saving, setSaving] = useState(false);
  const [subForm, setSubForm] = useState<any>({ plan_code: tenant.plan, billing_cycle: 'monthly', amount: 0, auto_renew: true, started_at: new Date().toISOString().slice(0, 10), ends_at: '' });
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
          status: form.status, is_active: form.is_active, plan_expires_at: form.plan_expires_at || null,
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
      await call('create_subscription', {
        tenant_id: tenant.id,
        plan_code: subForm.plan_code,
        billing_cycle: subForm.billing_cycle,
        amount,
        started_at: new Date(subForm.started_at).toISOString(),
        ends_at: subForm.ends_at ? new Date(subForm.ends_at).toISOString() : null,
        auto_renew: subForm.auto_renew,
        notes: subForm.notes || '',
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

  return (
    <Modal open onClose={onClose} title="" size="lg" footer={null}>
      <div className="-m-6">
        {/* Header */}
        <div className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white p-5 rounded-t-2xl">
          <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-500/20 rounded-full blur-3xl" />
          <div className="relative flex items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-white/10 border border-white/20 backdrop-blur flex items-center justify-center font-extrabold text-xl">
              {tenant.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-lg font-bold truncate">{tenant.name}</div>
              <div className="text-xs text-slate-300 truncate">{tenant.email || '—'}</div>
            </div>
            <button onClick={onClose} className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="mt-4 flex gap-1">
            {(['info', 'sub', 'modules', 'users', 'history'] as const).map(k => (
              <button key={k} onClick={() => setTab(k)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${tab === k ? 'bg-white text-slate-900' : 'text-slate-300 hover:bg-white/10'}`}>
                {k === 'info' ? 'Infos' : k === 'sub' ? 'Abonnement' : k === 'modules' ? 'Modules & Commerce' : k === 'users' ? 'Utilisateurs' : 'Historique'}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5 bg-white max-h-[60vh] overflow-y-auto">
          {!detail ? (
            <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
          ) : (
            <>
              {tab === 'info' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2"><label className="label">Nom</label><input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} className="input" /></div>
                  <div><label className="label">Raison sociale</label><input value={form.legal_name || ''} onChange={e => setForm({ ...form, legal_name: e.target.value })} className="input" /></div>
                  <div><label className="label">Email</label><input value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} className="input" /></div>
                  <div><label className="label">Téléphone</label><input value={form.phone || ''} onChange={e => setForm({ ...form, phone: e.target.value })} className="input" /></div>
                  <div><label className="label">Statut</label>
                    <select value={form.status || 'active'} onChange={e => setForm({ ...form, status: e.target.value })} className="input">
                      <option value="active">Actif</option><option value="suspended">Suspendu</option><option value="cancelled">Annulé</option>
                    </select>
                  </div>
                  <div><label className="label">Expiration abonnement</label><input type="date" value={form.plan_expires_at || ''} onChange={e => setForm({ ...form, plan_expires_at: e.target.value })} className="input" /></div>
                  <div>
                    <label className="label">Sous-domaine</label>
                    <div className="flex items-center gap-1.5">
                      <input value={form.subdomain || ''} onChange={e => setForm({ ...form, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} placeholder="sad" className="input flex-1" />
                      <span className="text-xs text-slate-500 whitespace-nowrap">.votreapp.com</span>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">Accès instantané sans DNS client</p>
                  </div>
                  <div>
                    <label className="label">Domaine personnalisé</label>
                    <input value={form.custom_domain || ''} onChange={e => setForm({ ...form, custom_domain: e.target.value.toLowerCase().trim() })} placeholder="caisse.sadpiecesauto.sn" className="input" />
                    <p className="text-[10px] text-slate-400 mt-1">CNAME à configurer vers votreapp.com</p>
                  </div>
                  <label className="sm:col-span-2 flex items-center gap-2 text-sm cursor-pointer mt-1">
                    <input type="checkbox" checked={form.is_active !== false} onChange={e => setForm({ ...form, is_active: e.target.checked })} className="rounded" />
                    Tenant actif (accès à l'application)
                  </label>

                  <div className="sm:col-span-2 flex justify-end mt-2">
                    <button onClick={saveInfo} disabled={saving} className="btn-primary">
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}Enregistrer
                    </button>
                  </div>

                  {/* Danger zone */}
                  {onDelete && (
                    <div className="sm:col-span-2 mt-6 border-t border-red-200 pt-4">
                      <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-2xl p-4">
                        <div className="flex items-center gap-3">
                          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
                          <div>
                            <div className="text-sm font-bold text-red-900">Zone de danger</div>
                            <div className="text-xs text-red-700">Supprimer definitivement ce tenant et toutes ses donnees.</div>
                          </div>
                        </div>
                        <button
                          onClick={() => { onClose(); setTimeout(() => onDelete(tenant), 150); }}
                          className="px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 flex items-center gap-1.5 shrink-0 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />Supprimer
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {tab === 'sub' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {plans.map(p => {
                      const active = subForm.plan_code === p.code;
                      return (
                        <button key={p.code} onClick={() => setSubForm({ ...subForm, plan_code: p.code, amount: subForm.billing_cycle === 'yearly' ? p.price_yearly : p.price_monthly })}
                          className={`text-left p-3 rounded-2xl border-2 transition-all ${active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                          <div className="text-[10px] uppercase tracking-wider font-bold opacity-70">{p.code}</div>
                          <div className="font-bold">{p.name}</div>
                          <div className="text-xs mt-1">{formatCompactFCFA(subForm.billing_cycle === 'yearly' ? p.price_yearly : p.price_monthly)}/{subForm.billing_cycle === 'yearly' ? 'an' : 'mois'}</div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div><label className="label">Cycle</label>
                      <select value={subForm.billing_cycle} onChange={e => {
                        const plan = plans.find(p => p.code === subForm.plan_code);
                        setSubForm({ ...subForm, billing_cycle: e.target.value, amount: plan ? (e.target.value === 'yearly' ? plan.price_yearly : plan.price_monthly) : subForm.amount });
                      }} className="input">
                        <option value="monthly">Mensuel</option><option value="yearly">Annuel</option>
                      </select>
                    </div>
                    <div><label className="label">Montant (FCFA)</label><input type="number" value={subForm.amount || 0} onChange={e => setSubForm({ ...subForm, amount: Number(e.target.value) })} className="input" /></div>
                    <div><label className="label">Début</label><input type="date" value={subForm.started_at} onChange={e => setSubForm({ ...subForm, started_at: e.target.value })} className="input" /></div>
                    <div><label className="label">Fin</label><input type="date" value={subForm.ends_at} onChange={e => setSubForm({ ...subForm, ends_at: e.target.value })} className="input" /></div>
                    <label className="sm:col-span-2 flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={subForm.auto_renew} onChange={e => setSubForm({ ...subForm, auto_renew: e.target.checked })} className="rounded" />
                      Renouvellement automatique
                    </label>
                    <div className="sm:col-span-2"><label className="label">Notes</label><input value={subForm.notes || ''} onChange={e => setSubForm({ ...subForm, notes: e.target.value })} className="input" placeholder="Réf. facture, conditions particulières…" /></div>
                  </div>
                  <button onClick={applyPlan} className="btn-primary w-full"><Zap className="w-4 h-4" />Appliquer ce plan</button>

                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Historique d'abonnements</div>
                    <div className="space-y-1.5">
                      {(detail.subscriptions || []).map((s: any) => (
                        <div key={s.id} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${s.status === 'active' ? 'bg-emerald-500' : s.status === 'cancelled' ? 'bg-red-400' : 'bg-slate-400'}`} />
                          <span className="font-bold uppercase tracking-wider">{s.plan_code}</span>
                          <span className="text-slate-500">·</span>
                          <span>{formatFCFA(s.amount)} / {s.billing_cycle === 'yearly' ? 'an' : 'mois'}</span>
                          <span className="text-slate-500">·</span>
                          <span>{formatDate(s.started_at)}{s.ends_at ? ` → ${formatDate(s.ends_at)}` : ''}</span>
                          <span className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${s.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{s.status}</span>
                          {s.status === 'active' && (
                            <button onClick={() => cancelSub(s.id)} className="text-red-500 hover:bg-red-50 p-1 rounded" title="Annuler">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                      {(detail.subscriptions || []).length === 0 && <div className="text-sm text-slate-400 py-2">Aucun abonnement.</div>}
                    </div>
                  </div>
                </div>
              )}

              {tab === 'modules' && (
                <ModulesTab form={form} setForm={setForm} onSave={saveInfo} saving={saving} usage={detail.usage} />
              )}

              {tab === 'users' && (
                <div className="space-y-2">
                  {(detail.users || []).map((u: any) => (
                    <div key={u.id} className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                      <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 text-white font-bold flex items-center justify-center shrink-0">
                        {(u.full_name || u.email).charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{u.full_name || u.email}</div>
                        <div className="text-xs text-slate-500 truncate">{u.email}</div>
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 bg-white border border-slate-200 px-2 py-0.5 rounded-full">{u.role}</span>
                      {!u.is_active && <span className="text-[10px] bg-red-50 text-red-700 px-1.5 py-0.5 rounded">Inactif</span>}
                    </div>
                  ))}
                </div>
              )}

              {tab === 'history' && (
                <div className="space-y-1">
                  {(detail.events || []).map((ev: any) => <EventRow key={ev.id} ev={ev} />)}
                  {(detail.events || []).length === 0 && <div className="text-sm text-slate-400 py-2">Aucune action enregistrée.</div>}
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
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [toDelete, setToDelete] = useState<any>(null);
  const { success, error } = useToast();

  const load = async () => {
    setLoading(true);
    try { setPlans((await call('list_plans')).plans || []); }
    catch (e: any) { error(e.message); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.code || !form.name) { error('Code et nom requis'); return; }
    try {
      const featuresArr = Array.isArray(form.features) ? form.features : String(form.features || '').split('\n').map((s: string) => s.trim()).filter(Boolean);
      await call('upsert_plan', {
        plan: {
          code: form.code,
          name: form.name,
          description: form.description || '',
          price_monthly: Number(form.price_monthly) || 0,
          price_yearly: Number(form.price_yearly) || 0,
          currency: form.currency || 'FCFA',
          features: featuresArr,
          limits: form.limits || {},
          is_public: form.is_public !== false,
          sort_order: Number(form.sort_order) || 0,
        },
      });
      success('Plan enregistré');
      setOpen(false); load();
    } catch (e: any) { error(e.message); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{plans.length} plan{plans.length > 1 ? 's' : ''} configuré(s)</p>
        <button onClick={() => { setForm({ features: '', is_public: true, sort_order: plans.length }); setOpen(true); }} className="btn-primary">
          <Plus className="w-4 h-4" />Nouveau plan
        </button>
      </div>

      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {plans.map(p => (
            <div key={p.code} className="relative overflow-hidden bg-white border border-slate-200/70 rounded-3xl p-5 shadow-card">
              {p.code === 'pro' && <div className="absolute top-3 right-3 text-[9px] font-bold bg-gradient-to-r from-amber-400 to-amber-600 text-white px-2 py-0.5 rounded-full uppercase tracking-wider">Populaire</div>}
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{p.code}</div>
              <div className="text-xl font-bold text-slate-900">{p.name}</div>
              <p className="text-xs text-slate-500 mt-1 h-8 line-clamp-2">{p.description}</p>
              <div className="my-3 pb-3 border-b border-slate-100">
                <div className="text-2xl font-extrabold text-slate-900">{formatCompactFCFA(p.price_monthly)}<span className="text-xs text-slate-400 font-semibold"> /mois</span></div>
                <div className="text-[11px] text-slate-500">{formatCompactFCFA(p.price_yearly)} /an</div>
              </div>
              <div className="space-y-1 mb-3">
                {(Array.isArray(p.features) ? p.features : []).slice(0, 5).map((f: string, i: number) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs text-slate-600">
                    <Check className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                    <span className="truncate">{f}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-1">
                <button onClick={() => { setForm({ ...p, features: (p.features || []).join('\n') }); setOpen(true); }} className="flex-1 btn-secondary text-xs"><Edit2 className="w-3 h-3" />Modifier</button>
                <button onClick={() => setToDelete(p)} className="p-2 rounded-lg bg-red-50 text-red-500 hover:bg-red-100"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={form.code ? 'Modifier plan' : 'Nouveau plan'} size="md"
        footer={<><button onClick={() => setOpen(false)} className="btn-secondary">Annuler</button><button onClick={save} className="btn-primary">Enregistrer</button></>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="label">Code *</label><input value={form.code || ''} onChange={e => setForm({ ...form, code: e.target.value })} className="input font-mono" placeholder="starter" /></div>
          <div><label className="label">Nom *</label><input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} className="input" /></div>
          <div className="sm:col-span-2"><label className="label">Description</label><input value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} className="input" /></div>
          <div><label className="label">Prix mensuel</label><input type="number" value={form.price_monthly || 0} onChange={e => setForm({ ...form, price_monthly: e.target.value })} className="input" /></div>
          <div><label className="label">Prix annuel</label><input type="number" value={form.price_yearly || 0} onChange={e => setForm({ ...form, price_yearly: e.target.value })} className="input" /></div>
          <div className="sm:col-span-2"><label className="label">Fonctionnalités (une par ligne)</label><textarea value={form.features || ''} onChange={e => setForm({ ...form, features: e.target.value })} className="input resize-none" rows={5} /></div>
          <div><label className="label">Ordre</label><input type="number" value={form.sort_order || 0} onChange={e => setForm({ ...form, sort_order: e.target.value })} className="input" /></div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.is_public !== false} onChange={e => setForm({ ...form, is_public: e.target.checked })} className="rounded" />
            Visible publiquement
          </label>
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
  const { error } = useToast();

  useEffect(() => {
    (async () => {
      try { setTenants((await call('list_tenants')).tenants || []); }
      catch (e: any) { error(e.message); }
      setLoading(false);
    })();
  }, []);

  const rows = useMemo(() => {
    const out: any[] = [];
    for (const t of tenants) {
      for (const s of (t.tenant_subscriptions || [])) {
        out.push({ ...s, tenant_name: t.name, tenant_id: t.id });
      }
    }
    return out.sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''));
  }, [tenants]);

  const totalMRR = rows.filter(r => r.status === 'active').reduce((s, r) => s + Number(r.amount || 0) / (r.billing_cycle === 'yearly' ? 12 : 1), 0);

  if (loading) return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <KpiCard icon={TrendingUp} label="MRR" value={formatCompactFCFA(totalMRR)} sub="Actifs mensuels" color="emerald" />
        <KpiCard icon={CircleDollarSign} label="Abonnements actifs" value={rows.filter(r => r.status === 'active').length} sub={`sur ${rows.length}`} color="sky" />
        <KpiCard icon={X} label="Annulés" value={rows.filter(r => r.status === 'cancelled').length} sub="Total historique" color="red" />
      </div>

      <div className="bg-white border border-slate-200/70 rounded-3xl overflow-hidden shadow-card">
        <div className="hidden sm:grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_auto] gap-3 px-4 py-2.5 bg-slate-50 border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          <div>Tenant</div><div>Plan</div><div>Cycle</div><div>Montant</div><div>Période</div><div>Statut</div>
        </div>
        <div className="divide-y divide-slate-100">
          {rows.map(r => (
            <div key={r.id} className="px-4 py-3 grid grid-cols-2 sm:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_auto] gap-x-3 gap-y-1 text-sm hover:bg-slate-50/50">
              <div className="font-semibold text-slate-800 truncate col-span-2 sm:col-span-1">{r.tenant_name}</div>
              <div className="text-xs text-slate-600 uppercase tracking-wider font-bold">{r.plan_code}</div>
              <div className="text-xs text-slate-500">{r.billing_cycle === 'yearly' ? 'Annuel' : 'Mensuel'}</div>
              <div className="text-xs font-bold">{formatFCFA(r.amount)}</div>
              <div className="text-xs text-slate-500">{formatDate(r.started_at)}{r.ends_at ? ` → ${formatDate(r.ends_at)}` : ''}</div>
              <div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                  r.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                  r.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                  'bg-slate-200 text-slate-600'
                }`}>{r.status}</span>
              </div>
            </div>
          ))}
          {rows.length === 0 && <div className="text-center text-slate-400 py-10 text-sm">Aucun abonnement.</div>}
        </div>
      </div>
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
          <div className="grid grid-cols-2 gap-3">
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
          <div className="grid grid-cols-2 gap-3">
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
        <Modal open onClose={() => setPreview(null)} title="Prévisualisation" size="sm" footer={<button onClick={() => setPreview(null)} className="btn-secondary">Fermer</button>}>
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
  const [loading, setLoading] = useState(true);
  const { error } = useToast();

  useEffect(() => {
    (async () => {
      try { setEvents((await call('list_events', { limit: 200 })).events || []); }
      catch (e: any) { error(e.message); }
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>;

  return (
    <div className="bg-white border border-slate-200/70 rounded-3xl p-5 shadow-card">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-4 h-4 text-brand-700" />
        <h3 className="text-sm font-bold text-slate-900">Journal d'activité plateforme</h3>
        <span className="ml-auto text-xs text-slate-500">{events.length} événement{events.length > 1 ? 's' : ''}</span>
      </div>
      <div className="space-y-1">
        {events.map(ev => <EventRow key={ev.id} ev={ev} />)}
        {events.length === 0 && <div className="text-center text-slate-400 py-10 text-sm">Aucune activité enregistrée.</div>}
      </div>
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
  { icon: 'Package', label: 'Stock', desc: 'Maîtrisez vos stocks', color: 'text-sky-600 bg-sky-50' },
  { icon: 'FileText', label: 'Facturation', desc: 'Devis et factures pro', color: 'text-amber-600 bg-amber-50' },
  { icon: 'Users', label: 'Clients & Tiers', desc: 'CRM et créances', color: 'text-emerald-600 bg-emerald-50' },
  { icon: 'Truck', label: 'Fournisseurs', desc: 'Commandes et dettes', color: 'text-orange-600 bg-orange-50' },
  { icon: 'Globe', label: 'Boutique en ligne', desc: 'Vitrine et commandes web', color: 'text-cyan-600 bg-cyan-50' },
  { icon: 'BarChart3', label: 'Comptabilité', desc: 'Suivi financier complet', color: 'text-rose-600 bg-rose-50' },
  { icon: 'TrendingUp', label: 'Rapports', desc: 'Analyses et tableaux de bord', color: 'text-violet-600 bg-violet-50' },
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
                    <Sparkles className="w-3 h-3" /> Tout rétablir
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
                    <div key={idx} className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-100 bg-slate-50/60 group">
                      {/* Drag handle / order */}
                      <div className="flex flex-col gap-0.5 shrink-0">
                        <button onClick={() => moveModule(idx, -1)} disabled={idx === 0} className="text-slate-300 hover:text-slate-500 disabled:opacity-20 transition-colors">
                          <ArrowUpRight className="w-3 h-3 rotate-[-90deg]" />
                        </button>
                        <button onClick={() => moveModule(idx, 1)} disabled={idx === modules.length - 1} className="text-slate-300 hover:text-slate-500 disabled:opacity-20 transition-colors">
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
                      {/* Delete */}
                      <button onClick={() => removeModule(idx)} className="shrink-0 p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
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
                  <img src="/Picsart_26-05-30_02-43-37-384.png" alt="WAARWI" className="h-8 w-auto object-contain" />
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
