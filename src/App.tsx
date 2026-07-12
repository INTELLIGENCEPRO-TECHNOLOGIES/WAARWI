import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Loader2, CheckCircle, XCircle, WifiOff, Wifi, LogOut, ShieldX, Phone, Headphones } from 'lucide-react';
import { AppProvider, useApp } from './context/AppContext';
import { usePermissions, type PermissionKey } from './lib/permissions';
import { ToastProvider } from './context/ToastContext';
import { Auth } from './pages/Auth';
import { TenantWelcome } from './components/TenantWelcome';
import { Shell, type Route } from './components/Shell';
import { Dashboard } from './pages/Dashboard';
import { TenantMessagePopup } from './components/TenantMessagePopup';
import { PendingApproval } from './components/PendingApproval';
import UpdateNotification from './components/UpdateNotification';

function SuspendedTenant() {
  const { tenant, signOut } = useApp();
  return (
    <div className="h-screen bg-white flex flex-col items-center justify-center px-4">
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

function ApproveTokenPage({ token }: { token: string }) {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'auto_approve_by_token', token }),
        });
        const data = await res.json();
        if (data.success) {
          setStatus('success');
          setMessage(data.tenant_name ? `Le tenant "${data.tenant_name}" a ete approuve avec succes.` : 'Tenant approuve avec succes.');
        } else {
          setStatus('error');
          setMessage(data.error || 'Ce lien est invalide ou a deja ete utilise.');
        }
      } catch {
        setStatus('error');
        setMessage('Erreur de connexion au serveur.');
      }
    })();
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-emerald-50/30 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <span className="text-2xl font-extrabold tracking-[0.2em] text-slate-800">WAARWI</span>
        </div>
        <div className="bg-white rounded-3xl border border-slate-200 shadow-premium p-8 text-center">
          {status === 'loading' && (
            <div className="space-y-4">
              <Loader2 className="w-10 h-10 animate-spin text-brand-700 mx-auto" />
              <p className="text-slate-600 font-medium">Approbation en cours...</p>
            </div>
          )}
          {status === 'success' && (
            <div className="space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
                <CheckCircle className="w-9 h-9 text-emerald-600" />
              </div>
              <h2 className="text-xl font-bold text-slate-900">Tenant approuve !</h2>
              <p className="text-slate-600 text-sm">{message}</p>
              <p className="text-xs text-slate-400">Un email de bienvenue a ete envoye au tenant.</p>
              <a href="/" className="inline-block mt-4 px-6 py-2.5 rounded-xl bg-brand-700 text-white font-semibold text-sm hover:bg-brand-800 transition-colors">
                Acceder a la plateforme
              </a>
            </div>
          )}
          {status === 'error' && (
            <div className="space-y-4">
              <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto">
                <XCircle className="w-9 h-9 text-red-600" />
              </div>
              <h2 className="text-xl font-bold text-slate-900">Approbation impossible</h2>
              <p className="text-slate-600 text-sm">{message}</p>
              <a href="/" className="inline-block mt-4 px-6 py-2.5 rounded-xl bg-slate-700 text-white font-semibold text-sm hover:bg-slate-800 transition-colors">
                Retour a l'accueil
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const PublicSupplierOrder = lazyWithRetry(() => import('./pages/PublicSupplierOrder').then(m => ({ default: m.PublicSupplierOrder })));
const PublicInvoice = lazyWithRetry(() => import('./pages/PublicInvoice').then(m => ({ default: m.PublicInvoice })));

const ROUTE_MODULE: Record<string, string> = {
  dashboard: 'dashboard', pos: 'pos', sales: 'sales', cash_history: 'cash_history',
  articles: 'articles', master_catalog: 'articles', stock: 'stock', billing: 'billing', online_orders: 'online_orders',
  tiers: 'tiers', supplier_orders: 'supplier_orders',
  acc_plan: 'accounting', acc_journals: 'accounting', acc_balance: 'accounting', acc_grandlivre: 'accounting', acc_tiers: 'accounting', acc_search: 'accounting', acc_cloture: 'accounting',
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
  money_transfer: 'access_money_transfer',
  representatives: 'rep_view',
  settings: 'manage_settings',
};

function Inner() {
  const { loading, user, tenant, profile } = useApp();
  const { can, loading: permsLoading } = usePermissions();
  const isSuperAdmin = profile?.role === 'super_admin';
  const [route, setRoute] = useState<Route>('dashboard');
  const [showWelcome, setShowWelcome] = useState(false);
  const prevUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    const prev = prevUserIdRef.current;
    const curr = user?.id || null;
    if (!prev && curr) {
      setShowWelcome(true);
    }
    prevUserIdRef.current = curr;
  }, [user?.id]);

  const enabled: string[] = Array.isArray((tenant as any)?.enabled_modules)
    ? (tenant as any).enabled_modules
    : ['dashboard','pos','cash_history','articles','stock','tiers','sales','billing','supplier_orders','online_orders','accounting','settings','reports','ipm'];

  useEffect(() => {
    if (!tenant && isSuperAdmin) { setRoute('platform_admin'); return; }
    if (isSuperAdmin) return;
    if (permsLoading) return;
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
  }, [tenant, isSuperAdmin, route, enabled.join(','), can, permsLoading]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-brand-50/30">
        <div className="flex flex-col items-center gap-4">
          <img src="/newlogo.png" alt="" className="w-44 h-44 object-contain" />
          <Loader2 className="w-5 h-5 animate-spin text-brand-700" />
        </div>
      </div>
    );
  }

  if (!user) return <Auth />;
  if (!tenant && !isSuperAdmin) return <Auth />;

  const approvalStatus = (tenant as any)?.approval_status;
  if (tenant && !isSuperAdmin && approvalStatus && approvalStatus !== 'approved') {
    return <PendingApproval />;
  }

  const tenantSuspended = tenant && !isSuperAdmin && ((tenant as any)?.is_active === false || (tenant as any)?.status === 'suspended');
  if (tenantSuspended) {
    return <SuspendedTenant />;
  }

  const welcomeName = tenant?.name || (isSuperAdmin ? 'Console plateforme' : 'WAARWI');
  const welcomeLogo = (tenant as any)?.logo_url || null;
  const welcomeTagline = tenant?.slogan || null;

  return (
    <>
      {showWelcome && (
        <TenantWelcome
          logoUrl={welcomeLogo}
          name={welcomeName}
          tagline={welcomeTagline}
          onDone={() => setShowWelcome(false)}
        />
      )}
    <Shell route={route} onRoute={setRoute}>
      <Suspense fallback={<div className="p-6 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-brand-700" /></div>}>
        {route === 'dashboard' && <Dashboard onNavigate={(r: string) => setRoute(r as any)} />}
        {route === 'pos' && <POS onLeave={() => setRoute('dashboard')} onNavigate={(r: string) => setRoute(r as any)} />}
        {route === 'articles' && <Articles onNavigate={(r: string) => setRoute(r as any)} />}
        {route === 'master_catalog' && <MasterCatalog />}
        {route === 'stock' && <Stock />}
        {route === 'sales' && <Sales onNavigate={(r: string) => setRoute(r as any)} />}
        {route === 'tiers' && <Tiers />}
        {route === 'billing' && <Billing onNavigate={(r: string) => setRoute(r as any)} />}
        {route === 'supplier_orders' && <SupplierOrders />}
        {route === 'online_orders' && <OnlineOrders />}
        {route === 'cash_history' && <CashHistory />}
        {route === 'acc_plan' && <Accounting section="plan" />}
        {route === 'acc_journals' && <Accounting section="journals" />}
        {route === 'acc_balance' && <Accounting section="balance" />}
        {route === 'acc_grandlivre' && <Accounting section="grandlivre" />}
        {route === 'acc_tiers' && <Accounting section="tiers" />}
        {route === 'acc_search' && <Accounting section="search" />}
        {route === 'acc_cloture' && <Accounting section="cloture" />}
        {route === 'settings' && <Settings />}
        {route === 'reports' && <Reports />}
        {route === 'ipm' && <IPM />}
        {route === 'warranties' && <Warranties />}
        {route === 'money_transfer' && <MoneyTransfer />}
        {route === 'representatives' && <Representatives />}
        {route === 'platform_admin' && isSuperAdmin && <PlatformAdmin />}
      </Suspense>
      <TenantMessagePopup />
      <UpdateNotification />
    </Shell>
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

  if (approveToken) {
    return <ApproveTokenPage token={approveToken} />;
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
        <AppProvider>
          <Inner />
        </AppProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
