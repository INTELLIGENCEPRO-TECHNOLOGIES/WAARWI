import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AppProvider, useApp } from './context/AppContext';
import { usePermissions, type PermissionKey } from './lib/permissions';
import { ToastProvider } from './context/ToastContext';
import { Auth } from './pages/Auth';
import { TenantWelcome } from './components/TenantWelcome';
import { Shell, type Route } from './components/Shell';
import { Dashboard } from './pages/Dashboard';
import { TenantMessagePopup } from './components/TenantMessagePopup';
import { PendingApproval } from './components/PendingApproval';

// Recharge automatique si un chunk est introuvable (ancien index.html qui pointe
// vers des assets hashés obsolètes après un déploiement).
function lazyWithRetry<T extends { default: any }>(factory: () => Promise<T>) {
  return lazy(() => factory().catch((err) => {
    const msg = String(err?.message || err);
    const isChunkErr = /Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(msg);
    if (isChunkErr && typeof window !== 'undefined') {
      const KEY = '__chunk_retry__';
      if (!sessionStorage.getItem(KEY)) {
        sessionStorage.setItem(KEY, '1');
        window.location.reload();
        return new Promise<T>(() => {});
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

const PublicSupplierOrder = lazyWithRetry(() => import('./pages/PublicSupplierOrder').then(m => ({ default: m.PublicSupplierOrder })));
const PublicInvoice = lazyWithRetry(() => import('./pages/PublicInvoice').then(m => ({ default: m.PublicInvoice })));

const ROUTE_MODULE: Record<string, string> = {
  dashboard: 'dashboard', pos: 'pos', sales: 'sales', cash_history: 'cash_history',
  articles: 'articles', master_catalog: 'articles', stock: 'stock', billing: 'billing', online_orders: 'online_orders',
  tiers: 'tiers', supplier_orders: 'supplier_orders',
  acc_plan: 'accounting', acc_journals: 'accounting', acc_balance: 'accounting', acc_grandlivre: 'accounting', acc_tiers: 'accounting', acc_search: 'accounting', acc_cloture: 'accounting',
  settings: 'settings', reports: 'reports',
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
  settings: 'manage_settings',
};

function Inner() {
  const { loading, user, tenant, profile } = useApp();
  const { can } = usePermissions();
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
    : ['dashboard','pos','cash_history','articles','stock','tiers','sales','billing','supplier_orders','online_orders','accounting','settings','reports'];

  useEffect(() => {
    if (!tenant && isSuperAdmin) { setRoute('platform_admin'); return; }
    if (isSuperAdmin) return;
    const mod = ROUTE_MODULE[route];
    if (mod && !enabled.includes(mod)) { setRoute('pos'); return; }
    const perm = ROUTE_PERMISSION[route];
    if (perm && !can(perm)) {
      const fallbackRoutes: Route[] = ['pos', 'dashboard', 'articles', 'billing', 'tiers', 'sales'];
      const fallback = fallbackRoutes.find(r => {
        const rp = ROUTE_PERMISSION[r];
        return !rp || can(rp as any);
      }) || 'pos';
      if (route !== fallback) setRoute(fallback);
    }
  }, [tenant, isSuperAdmin, route, enabled.join(','), can]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-brand-50/30">
        <div className="flex flex-col items-center gap-3">
          <div className="w-24 h-24 rounded-3xl bg-white border border-slate-200 shadow-sm flex items-center justify-center overflow-hidden p-3">
            <img src="/Picsart_26-05-30_02-43-37-384.png" alt="WAARWI" className="w-full h-full object-contain" />
          </div>
          <div className="text-sm font-bold tracking-[0.2em] text-slate-800">WAARWI</div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">Plateforme Business 2.0 made in Sénégal</div>
          <Loader2 className="w-5 h-5 animate-spin text-brand-700 mt-2" />
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
        {route === 'dashboard' && <Dashboard onNavigate={(r) => setRoute(r as any)} />}
        {route === 'pos' && <POS onLeave={() => setRoute('dashboard')} onNavigate={(r) => setRoute(r as any)} />}
        {route === 'articles' && <Articles onNavigate={(r) => setRoute(r as any)} />}
        {route === 'master_catalog' && <MasterCatalog />}
        {route === 'stock' && <Stock />}
        {route === 'sales' && <Sales onNavigate={(r) => setRoute(r as any)} />}
        {route === 'tiers' && <Tiers />}
        {route === 'billing' && <Billing onNavigate={(r) => setRoute(r as any)} />}
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
        {route === 'platform_admin' && isSuperAdmin && <PlatformAdmin />}
      </Suspense>
      <TenantMessagePopup />
    </Shell>
    </>
  );
}

export default function App() {
  const shopRoute = getShopRoute();
  const poToken = getPublicOrderToken();
  const invToken = getPublicInvoiceToken();

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
    <ToastProvider>
      <AppProvider>
        <Inner />
      </AppProvider>
    </ToastProvider>
  );
}
