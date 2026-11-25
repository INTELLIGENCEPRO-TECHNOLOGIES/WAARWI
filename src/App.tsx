import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, CheckCircle, XCircle, WifiOff, Wifi, LogOut, ShieldX, Phone, Headphones, AlertCircle, Ban, Power } from 'lucide-react';
import { AppProvider, useApp } from './context/AppContext';
import { WindowManagerProvider } from './context/WindowManagerContext';
import { usePermissions, type PermissionKey } from './lib/permissions';
import { ToastProvider } from './context/ToastContext';
import { Auth } from './pages/Auth';
import { ApproveRegistration } from './pages/ApproveRegistration';
import { Registration } from './pages/Registration';
import { loadRegistrationDraft } from './lib/registration';

import { Shell, type Route } from './components/Shell';
import { Dashboard } from './pages/Dashboard';
import { TenantMessagePopup } from './components/TenantMessagePopup';
import { MultiCashAnnouncement } from './components/MultiCashAnnouncement';
import { PendingApproval } from './components/PendingApproval';
import { SubscriptionHistoryAccess } from './components/SubscriptionHistory';
import { SubscriptionPaymentDialog, SubscriptionPaymentPanel, SubscriptionPaymentReturn, useCanPaySubscription } from './components/SubscriptionPaymentPanel';
import UpdateNotification from './components/UpdateNotification';
import { useToast } from './context/ToastContext';
import { installDraftFlushListeners, setDraftErrorHandler, hasAnyDraft, hasPendingWrite, flushAllPendingDrafts } from './lib/draftRecovery';

function SuspendedTenant() {
  const { tenant, signOut } = useApp();
  const canViewHistory = useCanPaySubscription();
  return (
    <div className="min-h-[100dvh] bg-[var(--w-surface)] flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md text-center space-y-5">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-red-50 border-2 border-red-200 flex items-center justify-center">
            <ShieldX className="w-8 h-8 text-red-500" />
          </div>
        </div>
        <div>
          <h2 className="text-xl font-black text-slate-900">{tenant?.name || 'Votre compte'}</h2>
          <p className="text-sm text-slate-600 mt-2">Votre compte a été suspendu. Vous n'avez plus accès à l'application.</p>
          <p className="text-xs text-slate-400 mt-1">Veuillez contacter l'équipe Waarwi pour plus d'informations.</p>
        </div>
        <SubscriptionPaymentPanel />
        {canViewHistory && <SubscriptionHistoryAccess />}
        <div className="flex flex-col items-center gap-3 pt-4">
          <button onClick={signOut} className="flex items-center gap-2.5 px-8 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 text-sm font-bold transition-all">
            <LogOut className="w-4 h-4" />Se déconnecter
          </button>
          <div className="flex items-center gap-3 text-xs text-slate-400 font-medium">
            <span className="flex items-center gap-1.5"><Headphones className="w-3.5 h-3.5" />Assistance</span>
            <span className="text-slate-200">|</span>
            <span className="flex items-center gap-1.5 text-slate-600 font-bold"><Phone className="w-3.5 h-3.5" />77 525 41 01</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Recharge automatique si un chunk est introuvable (ancien index.html qui pointe
// vers des assets hashés obsolètes après un déploiement).
function lazyWithRetry<T extends React.ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(() => factory().catch((err) => {
    const msg = String(err?.message || err);
    const isChunkErr = /Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(msg);
    if (isChunkErr && typeof window !== 'undefined') {
      // Never silently reload if the user has unsaved work — either a draft
      // already in sessionStorage or a debounced write still buffered in a
      // pending timer. Flush pending writes first so they survive the manual
      // reload the user will trigger from the ErrorBoundary.
      try { flushAllPendingDrafts(); } catch {}
      if (hasAnyDraft() || hasPendingWrite()) throw err;
      const KEY = '__chunk_retry__';
      if (!sessionStorage.getItem(KEY)) {
        sessionStorage.setItem(KEY, '1');
        window.location.reload();
        return new Promise<{ default: T }>(() => {});
      }
    }
    throw err;
  }));
}

const Articles = lazyWithRetry(() => import('./pages/Articles').then(m => ({ default: m.Articles })));
const Stock = lazyWithRetry(() => import('./pages/Stock').then(m => ({ default: m.Stock })));
const POS = lazyWithRetry(() => import('./pages/POS').then(m => ({ default: m.POS })));
const Sales = lazyWithRetry(() => import('./pages/Sales').then(m => ({ default: m.Sales })));
const Tiers = lazyWithRetry(() => import('./pages/Tiers').then(m => ({ default: m.Tiers })));
const Accounting = lazyWithRetry(() => import('./pages/Accounting').then(m => ({ default: m.Accounting })));
const Settings = lazyWithRetry(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const Billing = lazyWithRetry(() => import('./pages/Billing').then(m => ({ default: m.Billing })));
const SupplierOrders = lazyWithRetry(() => import('./pages/SupplierOrders').then(m => ({ default: m.SupplierOrders })));
const CashHistory = lazyWithRetry(() => import('./pages/CashHistory').then(m => ({ default: m.CashHistory })));
const Coffre = lazyWithRetry(() => import('./pages/Coffre').then(m => ({ default: m.Coffre })));
const Shop = lazyWithRetry(() => import('./pages/Shop').then(m => ({ default: m.Shop })));
const OnlineOrders = lazyWithRetry(() => import('./pages/OnlineOrders').then(m => ({ default: m.OnlineOrders })));
const MasterCatalog = lazyWithRetry(() => import('./pages/MasterCatalog').then(m => ({ default: m.MasterCatalog })));
const PlatformAdmin = lazyWithRetry(() => import('./pages/PlatformAdmin').then(m => ({ default: m.PlatformAdmin })));
const Reports = lazyWithRetry(() => import('./pages/Reports').then(m => ({ default: m.Reports })));
const IPM = lazyWithRetry(() => import('./pages/IPM').then(m => ({ default: m.IPM })));
const Warranties = lazyWithRetry(() => import('./pages/Warranties').then(m => ({ default: m.Warranties })));
const MoneyTransfer = lazyWithRetry(() => import('./pages/MoneyTransfer').then(m => ({ default: m.MoneyTransfer })));
const Representatives = lazyWithRetry(() => import('./pages/Representatives').then(m => ({ default: m.Representatives })));

function getShopRoute(): { slug: string; initialView: 'shop' | 'track' } | null {
  const m = window.location.pathname.match(/^\/shop\/([^/]+)(\/track)?/);
  if (!m) return null;
  return { slug: decodeURIComponent(m[1]), initialView: m[2] ? 'track' : 'shop' };
}

function getPublicOrderToken(): string | null {
  const m = window.location.pathname.match(/^\/po\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

function getPublicInvoiceToken(): string | null {
  const m = window.location.pathname.match(/^\/inv\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

function getApproveToken(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('approve_token');
}

function getActionResult(): { result: string; tenantName: string; status: string; message: string } | null {
  const params = new URLSearchParams(window.location.search);
  const r = params.get('action_result');
  if (!r) return null;
  return {
    result: r,
    tenantName: params.get('tenant_name') || '',
    status: params.get('status') || '',
    message: params.get('message') || '',
  };
}

function ActionResultPage({ data }: { data: { result: string; tenantName: string; status: string; message: string } }) {
  const config: Record<string, { icon: typeof CheckCircle; color: string; bg: string; title: string; message: string }> = {
    suspended: {
      icon: Ban,
      color: '#dc2626',
      bg: '#fef2f2',
      title: 'Client suspendu',
      message: `Le compte de ${data.tenantName} a été suspendu avec succès. L'accès est immédiatement bloqué.`,
    },
    reactivated: {
      icon: Power,
      color: '#059669',
      bg: '#f0fdf4',
      title: 'Client réactivé',
      message: `Le compte de ${data.tenantName} a été réactivé avec succès. L'accès est de nouveau fonctionnel.`,
    },
    already_suspended: {
      icon: AlertCircle,
      color: '#d97706',
      bg: '#fffbeb',
      title: 'Déjà suspendu',
      message: `Le compte de ${data.tenantName} était déjà suspendu.`,
    },
    already_active: {
      icon: AlertCircle,
      color: '#d97706',
      bg: '#fffbeb',
      title: 'Déjà actif',
      message: `Le compte de ${data.tenantName} était déjà actif.`,
    },
    already_used: {
      icon: AlertCircle,
      color: '#d97706',
      bg: '#fffbeb',
      title: 'Lien déjà utilisé',
      message: `Ce lien a déjà été utilisé. Le compte de ${data.tenantName} est actuellement ${data.status}.`,
    },
    error: {
      icon: XCircle,
      color: '#dc2626',
      bg: '#fef2f2',
      title: 'Erreur',
      message: data.message || 'Une erreur est survenue.',
    },
  };

  const c = config[data.result] || config.error;
  const Icon = c.icon;

  return (
    <div className="min-h-screen bg-[#f1f5f9] flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-sm border border-[#e2e8f0] p-10 max-w-md w-full text-center">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
          style={{ backgroundColor: c.bg }}
        >
          <Icon className="w-8 h-8" style={{ color: c.color }} />
        </div>
        <h1 className="text-xl font-bold text-[#0f172a] mb-3">{c.title}</h1>
        <p className="text-[15px] text-[#64748b] leading-relaxed mb-8">{c.message}</p>
        <a
          href={window.location.origin + window.location.pathname}
          className="inline-block px-6 py-2.5 rounded-lg bg-[#0f172a] text-white text-sm font-medium hover:bg-[#1e293b] transition-colors"
        >
          Ouvrir WAARWI
        </a>
        <div className="mt-8 text-xs text-[#94a3b8] font-semibold tracking-widest">WAARWI</div>
      </div>
    </div>
  );
}

const PublicSupplierOrder = lazyWithRetry(() => import('./pages/PublicSupplierOrder').then(m => ({ default: m.PublicSupplierOrder })));
const PublicInvoice = lazyWithRetry(() => import('./pages/PublicInvoice').then(m => ({ default: m.PublicInvoice })));

const ROUTE_MODULE: Record<string, string> = {
  dashboard: 'dashboard', pos: 'pos', sales: 'sales', cash_history: 'cash_history',
  articles: 'articles', master_catalog: 'articles', stock: 'stock', billing: 'billing', online_orders: 'online_orders',
  coffre: 'vault',
  tiers: 'tiers', supplier_orders: 'supplier_orders',
  acc_plan: 'accounting', acc_journals: 'accounting', acc_balance: 'accounting', acc_grandlivre: 'accounting', acc_tiers: 'accounting', acc_search: 'accounting', acc_cloture: 'accounting', acc_vat: 'accounting',
  ipm: 'ipm', money_transfer: 'money_transfer', settings: 'settings', reports: 'reports',
  representatives: 'billing',
};

const ROUTE_PERMISSION: Partial<Record<string, PermissionKey>> = {
  dashboard: 'access_dashboard',
  pos: 'access_pos',
  articles: 'access_articles',
  master_catalog: 'access_master_catalog',
  billing: 'access_billing',
  tiers: 'access_tiers',
  reports: 'access_reports',
  sales: 'view_sales_history',
  cash_history: 'view_cash_sessions',
  coffre: 'access_vault',
  stock: 'view_stock_levels',
  supplier_orders: 'manage_supplier_orders',
  online_orders: 'manage_online_orders',
  acc_plan: 'view_accounting',
  acc_journals: 'view_accounting',
  acc_balance: 'view_accounting',
  acc_grandlivre: 'view_accounting',
  acc_tiers: 'view_accounting',
  acc_search: 'view_accounting',
  acc_cloture: 'view_accounting',
  acc_vat: 'view_accounting',
  money_transfer: 'access_money_transfer',
  representatives: 'rep_view',
  settings: 'manage_settings',
};

function Inner() {
  const { loading, user, tenant, profile, currentSite } = useApp();
  const { can, loading: permsLoading } = usePermissions();
  const isSuperAdmin = profile?.role === 'super_admin';
  const canPaySubscription = useCanPaySubscription();
  const [paymentDialogTenantId, setPaymentDialogTenantId] = useState<string>();
  const closePaymentDialog = useCallback(() => setPaymentDialogTenantId(undefined), []);
  const onOpenSubscription = canPaySubscription && tenant &&
    !(tenant.billing_cycle === 'lifetime' && tenant.subscription_status === 'active')
    ? () => setPaymentDialogTenantId(tenant.id)
    : undefined;
  const [registrationMode, setRegistrationMode] = useState<'default' | 'open' | 'closed'>(() =>
    new URLSearchParams(window.location.search).get('mode') === 'register' ? 'open' : 'default',
  );
  const [registeredTenantId, setRegisteredTenantId] = useState(() => {
    try { return sessionStorage.getItem('waarwi:registration-tenant'); } catch { return null; }
  });
  const openRegistration = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('mode', 'register');
    window.history.replaceState(window.history.state, '', url);
    setRegistrationMode('open');
  }, []);
  const onRegistered = useCallback((tenantId: string) => {
    try { sessionStorage.setItem('waarwi:registration-tenant', tenantId); } catch { /* storage unavailable */ }
    setRegisteredTenantId(tenantId);
  }, []);
  const [paymentReturn, setPaymentReturn] = useState(() => {
    const reference = new URLSearchParams(window.location.search).get('subscription_payment');
    return reference && /^[0-9a-f-]{36}$/i.test(reference) ? reference : null;
  });
  const [route, setRoute] = useState<Route>('dashboard');
  const [billingMounted, setBillingMounted] = useState(false);
  useEffect(() => { if (route === 'billing') setBillingMounted(true); }, [route]);
  const [supplierOrdersMounted, setSupplierOrdersMounted] = useState(false);
  useEffect(() => { if (route === 'supplier_orders') setSupplierOrdersMounted(true); }, [route]);
  const [tiersMounted, setTiersMounted] = useState(false);
  useEffect(() => { if (route === 'tiers') setTiersMounted(true); }, [route]);
  const [settingsEntry, setSettingsEntry] = useState<{ n: number; tab?: 'cash_registers' | 'subscription' }>({ n: 0 });
  useEffect(() => {
    if (route !== 'settings') setSettingsEntry(e => (e.tab ? { n: e.n } : e));
  }, [route]);


  const enabled: string[] = Array.isArray((tenant as any)?.enabled_modules)
    ? (tenant as any).enabled_modules
    : ['dashboard','pos','cash_history','articles','stock','tiers','sales','billing','supplier_orders','online_orders','accounting','settings','reports','ipm'];

  useEffect(() => {
    if (loading || !user || !profile || permsLoading) return;
    if (!tenant && isSuperAdmin) { setRoute('platform_admin'); return; }
    if (isSuperAdmin) return;
    const mod = ROUTE_MODULE[route];
    if (mod && mod !== 'ipm' && !enabled.includes(mod)) { setRoute('pos'); return; }
    const perm = ROUTE_PERMISSION[route];
    if (perm && !can(perm)) {
      const fallbackRoutes: Route[] = ['pos', 'dashboard', 'articles', 'billing', 'tiers', 'sales'];
      const fallback = fallbackRoutes.find(r => {
        const rp = ROUTE_PERMISSION[r];
        return !rp || can(rp as any);
      }) || 'pos';
      if (route !== fallback) setRoute(fallback);
    }
  }, [loading, user, profile, tenant, isSuperAdmin, route, enabled.join(','), can, permsLoading]);

  const approvalStatus = tenant?.approval_status;
  const tenantPending = tenant && !isSuperAdmin && approvalStatus && approvalStatus !== 'approved';
  const tenantSuspended = tenant && !isSuperAdmin && ((tenant as any)?.is_active === false || tenant.status === 'suspended');
  const registeredHere = !!tenant && tenant.id === registeredTenantId;
  const registrationPayment = canPaySubscription && (registeredHere || approvalStatus === 'pending');
  const approvalKey = tenant && user && !isSuperAdmin ? `${user.id}:${tenant.id}` : null;
  const [waitingForApproval, setWaitingForApproval] = useState(() => {
    try { return sessionStorage.getItem('waarwi:waiting-for-approval'); } catch { return null; }
  });

  useEffect(() => {
    if (!approvalKey || !tenantPending) return;
    setWaitingForApproval(approvalKey);
    try { sessionStorage.setItem('waarwi:waiting-for-approval', approvalKey); } catch { /* storage unavailable */ }
  }, [approvalKey, !!tenantPending]);

  const registering = registrationMode === 'open';
  const hasDraft = !tenant && registrationMode === 'default' && !!loadRegistrationDraft(user?.email);
  const justApproved = approvalStatus === 'approved' && !tenantSuspended && approvalKey
    && (waitingForApproval === approvalKey || registeredHere);

  const closeRegistration = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('mode');
    url.searchParams.delete('plan');
    url.searchParams.delete('subscription_payment');
    window.history.replaceState(window.history.state, '', url);
    try { sessionStorage.removeItem('waarwi:registration-tenant'); } catch { /* storage unavailable */ }
    setRegisteredTenantId(null);
    setRegistrationMode('closed');
    setPaymentReturn(null);
  };

  const enterApprovedSpace = () => {
    setWaitingForApproval(null);
    try { sessionStorage.removeItem('waarwi:waiting-for-approval'); } catch { /* storage unavailable */ }
    closeRegistration();
    setRoute('dashboard');
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center" style={{ background: 'var(--w-bg)' }}>
        <img src="/newlogo.png" alt="" className="w-[140px] h-auto object-contain w-platform-logo" />
      </div>
    );
  }

  if (justApproved && !paymentReturn) return <PendingApproval onEnter={enterApprovedSpace} />;

  if ((!isSuperAdmin && !tenant && (registering || hasDraft)) || ((registering || paymentReturn || registeredHere) && registrationPayment)) {
    return <Registration onExit={justApproved ? enterApprovedSpace : closeRegistration} onRegistered={onRegistered}
      paymentId={paymentReturn || undefined} resumePayment={registrationPayment} />;
  }

  if (!user || (!tenant && !isSuperAdmin)) return <Auth onRegister={openRegistration} />;

  if (paymentReturn && canPaySubscription) {
    const closeReturn = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('subscription_payment');
      window.history.replaceState(window.history.state, '', url);
      setPaymentReturn(null);
    };
    return <SubscriptionPaymentReturn paymentId={paymentReturn} onClose={closeReturn} onOpenHistory={tenantPending || tenantSuspended ? undefined : () => {
      closeReturn();
      setSettingsEntry(entry => ({ n: entry.n + 1, tab: 'subscription' }));
      setRoute('settings');
    }} />;
  }

  if (tenantPending) {
    return <PendingApproval />;
  }

  if (tenantSuspended) {
    return <SuspendedTenant />;
  }

  return (
    <>
    <Shell route={route} onRoute={setRoute} onOpenSubscription={onOpenSubscription}>
      <Suspense fallback={<div className="p-6 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-brand-700" /></div>}>
        {route === 'dashboard' && <Dashboard onNavigate={(r: string) => setRoute(r as Route)} onOpenSubscription={onOpenSubscription} />}
        {route === 'pos' && <POS key={[profile?.id, tenant?.id, currentSite?.id].join(":")} onLeave={() => setRoute('dashboard')} onNavigate={(r: string) => setRoute(r as any)} />}
        {route === 'articles' && <Articles onNavigate={(r: string) => setRoute(r as any)} />}
        {route === 'master_catalog' && <MasterCatalog />}
        {route === 'stock' && <Stock />}
        {route === 'sales' && <Sales onNavigate={(r: string) => setRoute(r as any)} />}
        {tiersMounted && <Tiers visible={route === 'tiers'} onNavigate={(r: string) => setRoute(r as any)} />}
        {billingMounted && <Billing visible={route === 'billing'} onNavigate={(r: string) => setRoute(r as any)} />}
        {supplierOrdersMounted && <SupplierOrders visible={route === 'supplier_orders'} onNavigate={(r: string) => setRoute(r as any)} />}
        {route === 'online_orders' && <OnlineOrders />}
        {route === 'cash_history' && <CashHistory />}
        {route === 'coffre' && <Coffre />}
        {route === 'acc_plan' && <Accounting section="plan" />}
        {route === 'acc_journals' && <Accounting section="journals" />}
        {route === 'acc_balance' && <Accounting section="balance" />}
        {route === 'acc_grandlivre' && <Accounting section="grandlivre" />}
        {route === 'acc_tiers' && <Accounting section="tiers" />}
        {route === 'acc_search' && <Accounting section="search" />}
        {route === 'acc_cloture' && <Accounting section="cloture" />}
        {route === 'acc_vat' && <Accounting section="vat" />}
        {route === 'settings' && <Settings key={settingsEntry.n} initialTab={settingsEntry.tab} />}
        {route === 'reports' && <Reports />}
        {route === 'ipm' && <IPM />}
        {route === 'warranties' && <Warranties />}
        {route === 'money_transfer' && <MoneyTransfer />}
        {route === 'representatives' && <Representatives />}
        {route === 'platform_admin' && isSuperAdmin && <PlatformAdmin />}
      </Suspense>
      {route !== 'platform_admin' && (
        <>
          <TenantMessagePopup />
          <MultiCashAnnouncement key={`${user.id}:${tenant?.id || ''}`} route={route}
            onConfigure={() => { setSettingsEntry(e => ({ n: e.n + 1, tab: 'cash_registers' })); setRoute('settings'); }} />
          <UpdateNotification />
        </>
      )}
    </Shell>
    {onOpenSubscription && paymentDialogTenantId && paymentDialogTenantId === tenant?.id && (
      <SubscriptionPaymentDialog onClose={closePaymentDialog} />
    )}
    </>
  );
}

function NetworkBanner() {
  const [online, setOnline] = useState(navigator.onLine);
  const [showReconnect, setShowReconnect] = useState(false);

  useEffect(() => {
    const goOffline = () => { setOnline(false); setShowReconnect(false); };
    const goOnline = () => { setOnline(true); setShowReconnect(true); setTimeout(() => setShowReconnect(false), 3000); };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, []);

  if (online && !showReconnect) return null;

  return (
    <div className={`fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-2 py-2 px-4 text-sm font-medium transition-all duration-300 ${
      online ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
    }`}>
      {online ? (
        <><Wifi className="w-4 h-4" /><span>Connexion rétablie</span></>
      ) : (
        <><WifiOff className="w-4 h-4" /><span>Hors ligne — les modifications ne seront pas enregistrées</span></>
      )}
    </div>
  );
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-neutral-50 p-6">
          <div className="w-full max-w-md text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-red-100 flex items-center justify-center mx-auto">
              <XCircle className="w-7 h-7 text-red-600" />
            </div>
            <h1 className="text-xl font-bold text-neutral-900">Une erreur est survenue</h1>
            <p className="text-sm text-neutral-500">L'application a rencontre un probleme inattendu.</p>
            <pre className="text-xs text-left bg-neutral-100 rounded-xl p-3 overflow-auto max-h-32 text-red-700">{this.state.error?.message}</pre>
            <button onClick={() => window.location.reload()} className="px-5 py-2.5 bg-neutral-900 text-white rounded-xl text-sm font-semibold hover:bg-neutral-800 transition-colors">
              Recharger l'application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const shopRoute = getShopRoute();
  const poToken = getPublicOrderToken();
  const invToken = getPublicInvoiceToken();
  const approveToken = getApproveToken();
  const actionResult = getActionResult();

  if (actionResult) {
    return <ActionResultPage data={actionResult} />;
  }

  if (approveToken) {
    return <ApproveRegistration token={approveToken} />;
  }

  if (poToken) {
    return (
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>}>
        <PublicSupplierOrder token={poToken} />
      </Suspense>
    );
  }

  if (invToken) {
    return (
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>}>
        <PublicInvoice token={invToken} />
      </Suspense>
    );
  }

  if (shopRoute) {
    return (
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>}>
        <Shop slug={shopRoute.slug} initialView={shopRoute.initialView} />
      </Suspense>
    );
  }

  return (
    <ErrorBoundary>
      <NetworkBanner />
      <ToastProvider>
        <DraftRecoveryBootstrap />
        <AppProvider>
          <WindowManagerProvider>
            <Inner />
          </WindowManagerProvider>
        </AppProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}

function DraftRecoveryBootstrap() {
  const { error: toastError } = useToast();
  const errRef = useRef(toastError);
  errRef.current = toastError;
  useEffect(() => {
    installDraftFlushListeners();
    setDraftErrorHandler((msg) => { errRef.current(msg); });
    return () => { setDraftErrorHandler(null); };
  }, []);
  return null;
}
