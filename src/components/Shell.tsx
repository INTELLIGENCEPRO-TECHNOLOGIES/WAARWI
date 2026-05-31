import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard, ShoppingCart, Package, Boxes, Users,
  BookOpen, Settings, LogOut, Menu, Store, ChevronDown, Calculator,
  Receipt, ShoppingBag, History, FileText, TrendingUp, Globe, Bell, Crown, Library,
  Plus, CreditCard, Wallet, ChevronRight, Truck, BarChart3, ClipboardList, Star,
  PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { usePermissions, type PermissionKey } from '../lib/permissions';
import { supabase } from '../lib/supabase';

export type Route =
  | 'dashboard' | 'pos' | 'cash_history' | 'articles' | 'stock' | 'tiers'
  | 'sales' | 'billing' | 'supplier_orders' | 'online_orders' | 'master_catalog'
  | 'acc_plan' | 'acc_journals' | 'acc_balance' | 'settings' | 'platform_admin' | 'reports';

const NAV_GROUPS: { title: string; items: { key: Route; label: string; icon: any }[] }[] = [
  { title: 'Pilotage', items: [
    { key: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
  ]},
  { title: 'Caisse', items: [
    { key: 'pos', label: 'Caisse', icon: ShoppingCart },
    { key: 'sales', label: 'Journal des ventes', icon: Calculator },
    { key: 'cash_history', label: 'Historique caisse', icon: History },
  ]},
  { title: 'Catalogue & Stock', items: [
    { key: 'articles', label: 'Articles', icon: Package },
    { key: 'master_catalog', label: 'Catalogue maître', icon: Library },
    { key: 'stock', label: 'Stock', icon: Boxes },
  ]},
  { title: 'Commercial', items: [
    { key: 'billing', label: 'Facturation', icon: ClipboardList },
    { key: 'online_orders', label: 'Commandes en ligne', icon: Globe },
  ]},
  { title: 'Tiers', items: [
    { key: 'tiers', label: 'Gestion des tiers', icon: Users },
    { key: 'supplier_orders', label: 'Commandes fournisseurs', icon: ShoppingBag },
  ]},
  { title: 'Comptabilité', items: [
    { key: 'acc_plan', label: 'Plan comptable', icon: BookOpen },
    { key: 'acc_journals', label: 'Journaux', icon: FileText },
    { key: 'acc_balance', label: 'Balance', icon: TrendingUp },
  ]},
  { title: 'Rapports', items: [
    { key: 'reports', label: 'États', icon: BarChart3 },
  ]},
];

const MOBILE_TABS: { key: Route; label: string; icon: any }[] = [
  { key: 'dashboard', label: 'Accueil', icon: LayoutDashboard },
  { key: 'pos', label: 'Caisse', icon: ShoppingCart },
  { key: 'online_orders', label: 'Commandes', icon: Globe },
  { key: 'sales', label: 'Journal', icon: Calculator },
];

const ROUTE_MODULE: Record<string, string> = {
  dashboard: 'dashboard', pos: 'pos', sales: 'sales', cash_history: 'cash_history',
  articles: 'articles', master_catalog: 'articles', stock: 'stock',
  billing: 'billing', online_orders: 'online_orders',
  tiers: 'tiers', supplier_orders: 'supplier_orders',
  acc_plan: 'accounting', acc_journals: 'accounting', acc_balance: 'accounting',
  settings: 'settings', reports: 'reports',
};

const ROUTE_PERMISSION: Partial<Record<Route, PermissionKey>> = {
  sales: 'view_sales_history',
  cash_history: 'view_cash_sessions',
  stock: 'view_stock_levels',
  supplier_orders: 'manage_supplier_orders',
  online_orders: 'manage_online_orders',
  acc_plan: 'view_accounting',
  acc_journals: 'view_accounting',
  acc_balance: 'view_accounting',
  settings: 'manage_settings',
};

export function Shell({ route, onRoute, children }: { route: Route; onRoute: (r: Route) => void; children: ReactNode }) {
  const { tenant, profile, signOut, sites, currentSite, setCurrentSite, setDefaultSite, posCartCount, posCartOpen, setPosCart } = useApp();
  const { can } = usePermissions();
  const isSuperAdmin = profile?.role === 'super_admin';
  const enabledModules: string[] = Array.isArray((tenant as any)?.enabled_modules)
    ? (tenant as any).enabled_modules
    : ['dashboard','pos','cash_history','articles','stock','tiers','sales','billing','supplier_orders','online_orders','accounting','settings','reports'];
  const routeVisible = (key: Route) => {
    const mod = ROUTE_MODULE[key];
    if (mod && !enabledModules.includes(mod)) return false;
    const perm = ROUTE_PERMISSION[key];
    if (perm && !can(perm)) return false;
    return true;
  };

  const visibleNav = NAV_GROUPS
    .map(g => ({ ...g, items: g.items.filter(i => routeVisible(i.key)) }))
    .filter(g => g.items.length > 0);
  const visibleMobileTabs = MOBILE_TABS.filter(t => routeVisible(t.key));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [newOrdersCount, setNewOrdersCount] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    if (!tenant) return;
    let active = true;
    const load = async () => {
      const { count } = await supabase
        .from('online_orders')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant.id)
        .eq('status', 'nouvelle');
      if (active) setNewOrdersCount(count || 0);
    };
    load();
    const chan = supabase.channel(`shell_online_orders_${tenant.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'online_orders', filter: `tenant_id=eq.${tenant.id}` }, () => load())
      .subscribe();
    return () => { active = false; supabase.removeChannel(chan); };
  }, [tenant]);

  const badgeFor = (key: Route) => {
    if (key === 'online_orders' && newOrdersCount > 0) return newOrdersCount;
    return 0;
  };
  const [closing, setClosing] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);

  const isPOS = route === 'pos';

  // Swipe-to-close
  const panelRef = useRef<HTMLElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const touch = useRef<{ x: number; y: number; active: boolean; dx: number }>({ x: 0, y: 0, active: false, dx: 0 });

  // Swipe-to-open: track touch on the left edge of the main area
  const openTouch = useRef<{ x: number; y: number; active: boolean; moved: boolean }>({ x: 0, y: 0, active: false, moved: false });

  const onMainTouchStart = (e: React.TouchEvent) => {
    if (mobileOpen) return;
    const t = e.touches[0];
    if (t.clientX > 28) return; // only trigger from the very left edge
    openTouch.current = { x: t.clientX, y: t.clientY, active: true, moved: false };
  };
  const onMainTouchMove = (e: React.TouchEvent) => {
    if (!openTouch.current.active) return;
    const t = e.touches[0];
    const dx = t.clientX - openTouch.current.x;
    const dy = Math.abs(t.clientY - openTouch.current.y);
    if (dy > Math.abs(dx) + 8) { openTouch.current.active = false; return; }
    if (dx > 10) openTouch.current.moved = true;
  };
  const onMainTouchEnd = () => {
    if (openTouch.current.active && openTouch.current.moved) {
      setMobileOpen(true);
    }
    openTouch.current = { x: 0, y: 0, active: false, moved: false };
  };

  const closeDrawer = () => {
    setClosing(true);
    setTimeout(() => { setMobileOpen(false); setClosing(false); }, 220);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (!panelRef.current) return;
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY, active: true, dx: 0 };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!touch.current.active || !panelRef.current) return;
    const t = e.touches[0];
    const dx = t.clientX - touch.current.x;
    const dy = t.clientY - touch.current.y;
    if (Math.abs(dy) > Math.abs(dx) + 8) { touch.current.active = false; return; }
    if (dx < 0) {
      touch.current.dx = dx;
      panelRef.current.style.transform = `translateX(${dx}px)`;
      if (overlayRef.current) overlayRef.current.style.opacity = String(Math.max(0, 1 + dx / 280));
    }
  };
  const onTouchEnd = () => {
    if (!touch.current.active || !panelRef.current) { touch.current.active = false; return; }
    touch.current.active = false;
    const dx = touch.current.dx;
    if (dx < -90) {
      panelRef.current.style.transition = 'transform 220ms cubic-bezier(0.22,1,0.36,1)';
      panelRef.current.style.transform = 'translateX(-110%)';
      if (overlayRef.current) {
        overlayRef.current.style.transition = 'opacity 220ms';
        overlayRef.current.style.opacity = '0';
      }
      setTimeout(() => setMobileOpen(false), 220);
    } else {
      panelRef.current.style.transition = 'transform 220ms cubic-bezier(0.22,1,0.36,1)';
      panelRef.current.style.transform = '';
      if (overlayRef.current) {
        overlayRef.current.style.transition = 'opacity 220ms';
        overlayRef.current.style.opacity = '';
      }
      setTimeout(() => {
        if (panelRef.current) panelRef.current.style.transition = '';
        if (overlayRef.current) overlayRef.current.style.transition = '';
      }, 240);
    }
  };

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDrawer(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const NavList = () => (
    <nav className={`flex-1 overflow-y-auto py-4 space-y-5 ${sidebarCollapsed ? 'px-1.5' : 'px-3'}`}>
      {isSuperAdmin ? (
        <div>
          {!sidebarCollapsed && <div className="px-3 mb-1.5 text-[10px] font-bold tracking-[0.08em] uppercase text-slate-400">Plateforme</div>}
          <button
            onClick={() => { onRoute('platform_admin'); setMobileOpen(false); }}
            className={`nav-item ${route === 'platform_admin' ? 'nav-item-active' : 'nav-item-idle'} ${sidebarCollapsed ? 'justify-center px-0' : ''}`}
            title={sidebarCollapsed ? 'Console plateforme' : undefined}
          >
            <Crown className={`w-[18px] h-[18px] flex-shrink-0 ${route === 'platform_admin' ? 'text-white' : 'text-amber-500'}`} />
            {!sidebarCollapsed && <span>Console plateforme</span>}
          </button>
        </div>
      ) : (
      <>
      {visibleNav.map(group => (
        <div key={group.title}>
          {!sidebarCollapsed && (
            <div className="px-3 mb-1.5 text-[10px] font-bold tracking-[0.08em] uppercase text-slate-400">
              {group.title}
            </div>
          )}
          <div className="space-y-0.5">
            {group.items.map(item => {
              const Icon = item.icon;
              const active = route === item.key;
              const badge = badgeFor(item.key);
              return (
                <button
                  key={item.key}
                  onClick={() => { onRoute(item.key); setMobileOpen(false); }}
                  className={`nav-item ${active ? 'nav-item-active' : 'nav-item-idle'} ${sidebarCollapsed ? 'justify-center px-0' : ''}`}
                  title={sidebarCollapsed ? item.label : undefined}
                >
                  <Icon className={`w-[18px] h-[18px] flex-shrink-0 ${active ? 'text-white' : 'text-slate-400'}`} />
                  {!sidebarCollapsed && <span className="whitespace-nowrap">{item.label}</span>}
                  {!sidebarCollapsed && badge > 0 && (
                    <span className={`ml-auto min-w-[20px] h-5 px-1.5 inline-flex items-center justify-center rounded-full text-[10px] font-bold ${active ? 'bg-white text-brand-800' : 'bg-rose-500 text-white animate-pulse'}`}>{badge > 99 ? '99+' : badge}</span>
                  )}
                  {!sidebarCollapsed && badge === 0 && active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-white/80" />}
                  {sidebarCollapsed && badge > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-rose-500 text-white text-[8px] font-bold flex items-center justify-center">{badge > 9 ? '9+' : badge}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {routeVisible('settings') && (
        <div>
          {!sidebarCollapsed && <div className="px-3 mb-1.5 text-[10px] font-bold tracking-[0.08em] uppercase text-slate-400">Système</div>}
          <button
            onClick={() => { onRoute('settings'); setMobileOpen(false); }}
            className={`nav-item ${route === 'settings' ? 'nav-item-active' : 'nav-item-idle'} ${sidebarCollapsed ? 'justify-center px-0' : ''}`}
            title={sidebarCollapsed ? 'Paramètres' : undefined}
          >
            <Settings className={`w-[18px] h-[18px] flex-shrink-0 ${route === 'settings' ? 'text-white' : 'text-slate-400'}`} />
            {!sidebarCollapsed && <span className="whitespace-nowrap">Paramètres</span>}
          </button>
        </div>
      )}
      </>
      )}
    </nav>
  );

  return (
    <div className="min-h-screen h-screen flex flex-col overflow-hidden">
      {/* Unified desktop header — spans full width, logo area aligns with sidebar */}
      <header
        className="hidden lg:flex items-center h-16 border-b border-slate-200/60 bg-white sticky top-0 z-30 flex-shrink-0"
        style={{ boxShadow: '0 1px 3px rgba(15,23,42,0.04)' }}
      >
        <div className={`flex items-center gap-2.5 px-5 h-full border-r border-slate-200/60 transition-all duration-300 ${sidebarCollapsed ? 'w-[68px]' : 'w-[260px]'}`}>
          {tenant?.logo_url ? (
            <img
              src={tenant.logo_url}
              alt={tenant.name}
              className="w-10 h-10 object-contain flex-shrink-0 header-logo-reveal drop-shadow-[0_4px_12px_rgba(15,23,42,0.12)]"
            />
          ) : (
            <img
              src="/Picsart_26-05-30_02-43-37-384.png"
              alt="WAARWI"
              className="h-8 w-auto max-w-[130px] object-contain flex-shrink-0 header-logo-reveal"
            />
          )}
          {!sidebarCollapsed && (
            <div className="leading-tight min-w-0">
              {tenant?.logo_url && (
                <div className="text-sm font-bold text-slate-900 tracking-tight">{tenant?.name || 'WAARWI'}</div>
              )}
              {!tenant?.logo_url && (
                <div className="text-[9px] font-semibold text-slate-400 leading-tight tracking-wide uppercase">Plateforme Business 2.0</div>
              )}
              {tenant?.slogan && <div className="text-[10px] font-medium text-slate-500 leading-tight">{tenant.slogan}</div>}
            </div>
          )}
        </div>
        <div className="flex-1 flex items-center gap-3 px-5">
          <div className="flex-1" />
          <div className="flex items-center gap-1.5 shrink-0">
            {newOrdersCount > 0 && (
              <button
                onClick={() => onRoute('online_orders')}
                className="relative w-10 h-10 rounded-2xl bg-white/70 hover:bg-white border border-slate-200/60 hover:border-rose-200 flex items-center justify-center transition-all active:scale-90 shadow-sm"
                aria-label="Notifications"
              >
                <Bell className="w-[17px] h-[17px] text-slate-700" strokeWidth={2.2} />
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-extrabold flex items-center justify-center border-2 border-white animate-pulse num">
                  {newOrdersCount > 9 ? '9+' : newOrdersCount}
                </span>
              </button>
            )}
            <div className="relative">
              <button
                onClick={() => setUserOpen(v => !v)}
                className="flex items-center gap-2 pl-1 pr-1.5 h-10 rounded-2xl hover:bg-slate-50 transition-colors active:scale-95"
              >
                <div className="w-[34px] h-[34px] rounded-2xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 flex items-center justify-center text-white text-[13px] font-extrabold shadow-glow ring-2 ring-white/80">
                  {(profile?.full_name || profile?.email || '?').charAt(0).toUpperCase()}
                </div>
                <div className="text-left leading-tight pr-1">
                  <div className="text-[12px] font-bold text-slate-900 max-w-[120px] truncate">{profile?.full_name || profile?.email}</div>
                  <div className="text-[9px] text-slate-400 uppercase tracking-wider font-bold leading-none">{profile?.role}</div>
                </div>
              </button>
              {userOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setUserOpen(false)} />
                  <div className="absolute right-0 mt-2 w-60 bg-white border border-slate-200 rounded-2xl shadow-premium py-1.5 animate-slide-down z-20">
                    <div className="px-3.5 py-2.5 border-b border-slate-100">
                      <div className="text-sm font-semibold text-slate-900 truncate">{profile?.full_name}</div>
                      <div className="text-xs text-slate-500 truncate">{profile?.email}</div>
                    </div>
                    <button onClick={() => { setUserOpen(false); onRoute('settings'); }} className="w-full text-left px-3.5 py-2 text-sm hover:bg-slate-50 flex items-center gap-2 transition-colors">
                      <Settings className="w-4 h-4 text-slate-400" /> Paramètres
                    </button>
                    <button onClick={signOut} className="w-full text-left px-3.5 py-2 text-sm hover:bg-red-50 text-red-600 flex items-center gap-2 transition-colors">
                      <LogOut className="w-4 h-4" /> Déconnexion
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Desktop sidebar — below unified header */}
      <aside className={`hidden lg:flex flex-col flex-shrink-0 h-full border-r border-slate-200/60 bg-white/80 backdrop-blur-sm transition-all duration-300 ${sidebarCollapsed ? 'w-[68px]' : 'w-[260px]'}`}>
        <NavList />
        <div className="p-3 border-t border-slate-100 space-y-2">
          {sites.length > 0 && !sidebarCollapsed && (
            <div className="relative">
              <div className="text-[10px] font-bold tracking-[0.08em] uppercase text-slate-400 px-1 mb-1">Point de vente</div>
              <button
                onClick={() => setSiteOpen(v => !v)}
                className="w-full flex items-center gap-2 px-3 h-11 rounded-xl bg-white border border-slate-200 hover:border-brand-300 hover:bg-brand-50/40 text-[13px] font-semibold text-slate-800 transition-all shadow-sm"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                <Store className="w-4 h-4 text-brand-700 shrink-0" />
                <span className="flex-1 text-left truncate">{currentSite?.name || 'Sélectionner'}</span>
                <ChevronDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${siteOpen ? 'rotate-180' : ''}`} />
              </button>
              {siteOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setSiteOpen(false)} />
                  <div className="absolute left-0 right-0 bottom-[calc(100%+6px)] bg-white border border-slate-200 rounded-2xl shadow-premium py-1.5 animate-slide-down z-20 max-h-64 overflow-auto">
                    {sites.map(s => {
                      const isDefault = (profile as any)?.default_site_id === s.id;
                      return (
                        <div key={s.id} className={`flex items-center gap-1 px-2 py-1 transition-colors ${currentSite?.id === s.id ? 'bg-brand-50/70' : 'hover:bg-slate-50'}`}>
                          <button
                            onClick={() => { setCurrentSite(s); setSiteOpen(false); onRoute('dashboard'); }}
                            className={`flex-1 text-left flex items-center gap-2 px-1.5 py-1 text-sm rounded-lg transition-colors ${currentSite?.id === s.id ? 'text-brand-800 font-semibold' : 'text-slate-700'}`}
                          >
                            <Store className={`w-4 h-4 ${currentSite?.id === s.id ? 'text-brand-600' : 'text-slate-400'}`} />
                            <span className="truncate">{s.name}</span>
                          </button>
                          <button
                            title={isDefault ? 'Magasin par défaut' : 'Définir comme défaut'}
                            onClick={() => { setDefaultSite(s); setSiteOpen(false); onRoute('dashboard'); }}
                            className={`shrink-0 p-1.5 rounded-lg transition-colors ${isDefault ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'}`}
                          >
                            <Star className="w-3.5 h-3.5" fill={isDefault ? 'currentColor' : 'none'} />
                          </button>
                        </div>
                      );
                    })}
                    <div className="px-3 pt-1.5 pb-0.5 border-t border-slate-100 mt-0.5">
                      <p className="text-[9px] text-slate-400 flex items-center gap-1">
                        <Star className="w-2.5 h-2.5 text-amber-400" fill="currentColor" /> = magasin par défaut (persiste entre connexions)
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
          <button onClick={signOut} className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-slate-600 hover:bg-slate-100 transition-colors ${sidebarCollapsed ? 'justify-center' : ''}`}>
            <LogOut className="w-4 h-4 flex-shrink-0" /> {!sidebarCollapsed && 'Déconnexion'}
          </button>
          <button
            onClick={() => setSidebarCollapsed(v => !v)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors justify-center"
            title={sidebarCollapsed ? 'Ouvrir le menu' : 'Réduire le menu'}
          >
            {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>
      </aside>

      {/* Mobile floating sidebar — Samsung Notes inspired */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" style={{ perspective: '1400px' }}>
          <div
            ref={overlayRef}
            className={closing ? 'float-sidebar-overlay float-sidebar-overlay-out' : 'float-sidebar-overlay'}
            onClick={closeDrawer}
          />
          <aside
            ref={panelRef}
            className={closing ? 'float-sidebar-panel float-sidebar-panel-out' : 'float-sidebar-panel'}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            <span className="float-sidebar-glow" aria-hidden />
            <div className="float-sidebar-content">
              <div className="flex items-center justify-between px-3.5 pt-3 pb-2">
                <div className="flex items-center gap-2 min-w-0">
                  {tenant?.logo_url ? (
                    <img
                      src={tenant.logo_url}
                      alt={tenant.name}
                      className="w-9 h-9 object-contain shrink-0 header-logo-reveal drop-shadow-[0_3px_10px_rgba(15,23,42,0.12)]"
                    />
                  ) : (
                    <img
                      src="/Picsart_26-05-30_02-43-37-384.png"
                      alt="WAARWI"
                      className="h-7 w-auto max-w-[110px] object-contain shrink-0 header-logo-reveal"
                    />
                  )}
                  <div className="min-w-0">
                    {tenant?.logo_url && (
                      <div className="text-[13px] font-bold text-slate-900 tracking-tight truncate leading-tight">{tenant?.name || 'WAARWI'}</div>
                    )}
                    <div className="text-[9px] text-slate-500 leading-tight font-medium truncate">
                      {tenant?.logo_url ? (tenant?.slogan || profile?.email) : 'Plateforme Business 2.0'}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => { onRoute('settings'); closeDrawer(); }}
                  className="float-close-btn shrink-0"
                  aria-label="Paramètres"
                >
                  <Settings className="w-[17px] h-[17px]" />
                </button>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-0.5 space-y-1.5 scrollbar-hide">
                {isSuperAdmin && (
                  <div>
                    <div className="px-2.5 mb-px text-[9px] font-bold tracking-[0.1em] uppercase text-slate-400">Plateforme</div>
                    <button
                      onClick={() => { onRoute('platform_admin'); closeDrawer(); }}
                      className={`float-nav-item-compact ${route === 'platform_admin' ? 'float-nav-item-active' : ''}`}
                    >
                      <Crown className="w-4 h-4 shrink-0 text-amber-500" />
                      <span className="truncate">Console plateforme</span>
                    </button>
                  </div>
                )}
                {!isSuperAdmin && visibleNav.map(group => (
                  <div key={group.title}>
                    <div className="px-2.5 mb-px text-[9px] font-bold tracking-[0.1em] uppercase text-slate-400">
                      {group.title}
                    </div>
                    <div>
                      {group.items.map(item => {
                        const Icon = item.icon;
                        const active = route === item.key;
                        const badge = badgeFor(item.key);
                        return (
                          <button
                            key={item.key}
                            onClick={() => { onRoute(item.key); closeDrawer(); }}
                            className={`float-nav-item-compact ${active ? 'float-nav-item-active' : ''}`}
                          >
                            <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-brand-700' : 'text-slate-500'}`} />
                            <span className="truncate">{item.label}</span>
                            {badge > 0 && (
                              <span className="ml-auto min-w-[20px] h-5 px-1.5 inline-flex items-center justify-center rounded-full text-[10px] font-bold bg-rose-500 text-white">{badge > 99 ? '99+' : badge}</span>
                            )}
                            {badge === 0 && active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-brand-600" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="px-2.5 pt-1.5 pb-2 border-t border-slate-100/70 space-y-1.5" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
                {sites.length > 0 && (
                  <div>
                    <div className="px-1 mb-1 text-[9px] font-bold tracking-[0.1em] uppercase text-slate-400">Point de vente</div>
                    <div className="max-h-32 overflow-auto space-y-0.5">
                      {sites.map(s => {
                        const isDefault = (profile as any)?.default_site_id === s.id;
                        return (
                          <div key={s.id} className={`flex items-center gap-1 rounded-lg transition-colors ${currentSite?.id === s.id ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
                            <button
                              onClick={() => { setCurrentSite(s); onRoute('dashboard'); closeDrawer(); }}
                              className={`flex-1 flex items-center gap-2 px-2.5 py-1.5 text-[12.5px] font-medium transition-colors ${currentSite?.id === s.id ? 'text-brand-700 font-semibold' : 'text-slate-600'}`}
                            >
                              <Store className={`w-3.5 h-3.5 ${currentSite?.id === s.id ? 'text-brand-600' : 'text-slate-400'}`} />
                              <span className="truncate flex-1 text-left">{s.name}</span>
                            </button>
                            <button
                              onClick={() => { setDefaultSite(s); onRoute('dashboard'); closeDrawer(); }}
                              title={isDefault ? 'Défaut' : 'Définir défaut'}
                              className={`shrink-0 p-1.5 transition-colors ${isDefault ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'}`}
                            >
                              <Star className="w-3 h-3" fill={isDefault ? 'currentColor' : 'none'} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <button onClick={signOut} className="float-logout-btn">
                  <LogOut className="w-4 h-4" />
                  <span>Déconnexion</span>
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0"
        onTouchStart={onMainTouchStart}
        onTouchMove={onMainTouchMove}
        onTouchEnd={onMainTouchEnd}
      >
        {/* Floating mobile hamburger — detached, glassmorphism */}
        <button
          onClick={() => setMobileOpen(true)}
          className="lg:hidden fixed z-40 flex items-center justify-center transition-all active:scale-90 hover:scale-105"
          style={{
            top: 'calc(env(safe-area-inset-top) + 6px)',
            left: '8px',
            width: '44px',
            height: '44px',
            borderRadius: '16px',
            background: 'rgba(255,255,255,0.65)',
            backdropFilter: 'saturate(1.8) blur(20px)',
            WebkitBackdropFilter: 'saturate(1.8) blur(20px)',
            border: '1px solid rgba(255,255,255,0.8)',
            boxShadow: '0 6px 20px -4px rgba(15,23,42,0.18), 0 2px 6px rgba(15,23,42,0.06), inset 0 1px 0 rgba(255,255,255,0.95)',
          }}
          aria-label="Menu"
        >
          <Menu className="w-[20px] h-[20px] text-slate-800" strokeWidth={2.4} />
        </button>

        <header
          className="lg:hidden sticky top-0 z-30 flex items-center gap-2 px-3 sm:px-5 border-b border-slate-200/40 pl-[60px]"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top) + 8px)',
            paddingBottom: '8px',
            minHeight: 'calc(56px + env(safe-area-inset-top))',
            background: 'rgba(255,255,255,0.72)',
            backdropFilter: 'saturate(1.6) blur(22px)',
            WebkitBackdropFilter: 'saturate(1.6) blur(22px)',
            boxShadow: '0 1px 0 rgba(15,23,42,0.03), 0 4px 20px -12px rgba(15,23,42,0.08)',
          }}
        >
          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              {tenant?.logo_url ? (
                <img
                  src={tenant.logo_url}
                  alt={tenant.name}
                  className="h-8 max-w-[40px] object-contain shrink-0 header-logo-reveal drop-shadow-[0_4px_12px_rgba(15,23,42,0.14)]"
                />
              ) : (
                <img
                  src="/Picsart_26-05-30_02-43-37-384.png"
                  alt="WAARWI"
                  className="h-7 w-auto max-w-[100px] object-contain shrink-0 header-logo-reveal"
                />
              )}
              {tenant?.logo_url && (
                <div
                  className={`font-extrabold tracking-tight text-slate-900 leading-tight truncate ${(tenant?.name || '').length > 18 ? 'text-[12px]' : (tenant?.name || '').length > 12 ? 'text-[13px]' : 'text-[14.5px]'}`}
                >
                  {tenant?.name || 'WAARWI'}
                </div>
              )}
            </div>
            {!tenant?.logo_url && (
              <div className="text-[9px] font-semibold text-slate-400 leading-tight mt-0.5 uppercase tracking-wide">Plateforme Business 2.0</div>
            )}
            {tenant?.slogan && (
              <div className="text-[10px] font-medium text-slate-500 leading-tight mt-0.5 truncate">
                {tenant.slogan}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
          {newOrdersCount > 0 && (
            <button
              onClick={() => onRoute('online_orders')}
              className="relative w-10 h-10 rounded-2xl bg-white/70 hover:bg-white border border-slate-200/60 hover:border-rose-200 flex items-center justify-center transition-all active:scale-90 shadow-sm"
              aria-label="Notifications"
            >
              <Bell className="w-[17px] h-[17px] text-slate-700" strokeWidth={2.2} />
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-extrabold flex items-center justify-center border-2 border-white animate-pulse num">
                {newOrdersCount > 9 ? '9+' : newOrdersCount}
              </span>
            </button>
          )}
          <div className="relative">
            <button
              onClick={() => setUserOpen(v => !v)}
              className="flex items-center gap-2 pl-1 pr-1.5 h-10 rounded-2xl hover:bg-white/60 transition-colors active:scale-95"
            >
              <div className="w-[34px] h-[34px] rounded-2xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 flex items-center justify-center text-white text-[13px] font-extrabold shadow-glow ring-2 ring-white/80">
                {(profile?.full_name || profile?.email || '?').charAt(0).toUpperCase()}
              </div>
            </button>
            {userOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setUserOpen(false)} />
                <div className="absolute right-0 mt-2 w-60 bg-white border border-slate-200 rounded-2xl shadow-premium py-1.5 animate-slide-down z-20">
                  <div className="px-3.5 py-2.5 border-b border-slate-100">
                    <div className="text-sm font-semibold text-slate-900 truncate">{profile?.full_name}</div>
                    <div className="text-xs text-slate-500 truncate">{profile?.email}</div>
                  </div>
                  <button onClick={() => { setUserOpen(false); onRoute('settings'); }} className="w-full text-left px-3.5 py-2 text-sm hover:bg-slate-50 flex items-center gap-2 transition-colors">
                    <Settings className="w-4 h-4 text-slate-400" /> Paramètres
                  </button>
                  <button onClick={signOut} className="w-full text-left px-3.5 py-2 text-sm hover:bg-red-50 text-red-600 flex items-center gap-2 transition-colors">
                    <LogOut className="w-4 h-4" /> Déconnexion
                  </button>
                </div>
              </>
            )}
          </div>
          </div>
        </header>

        <main className={`flex-1 w-full min-h-0 ${isPOS ? 'flex flex-col max-w-none p-0 overflow-hidden' : 'overflow-y-auto overflow-x-hidden'}`}>
          {isPOS ? (
            <div className="flex-1 flex flex-col min-h-0 pb-[64px] lg:pb-0">{children}</div>
          ) : (
            <div className="w-full max-w-[1600px] mx-auto px-3 sm:px-5 lg:px-8 pt-3 sm:pt-4 lg:pt-6 pb-[76px] lg:pb-8">{children}</div>
          )}
        </main>

        {/* Bottom nav — dark teal, full width, with FAB notch */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 pointer-events-none" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="pointer-events-auto">
            <div
              className="relative flex items-center justify-around h-[54px]"
              style={{
                background: 'linear-gradient(135deg, #0f766e 0%, #064e3b 100%)',
                boxShadow: '0 -2px 12px -4px rgba(15,118,110,0.3)',
              }}
            >
              {(() => {
                const tabs = isSuperAdmin ? [{ key: 'platform_admin' as Route, label: 'Plateforme', icon: Crown }] : visibleMobileTabs;
                const mid = Math.floor(tabs.length / 2);
                const left = tabs.slice(0, mid);
                const right = tabs.slice(mid);
                return (
                  <>
                    {left.map(tab => {
                      const Icon = tab.icon;
                      const active = route === tab.key;
                      const badge = tab.key === 'online_orders' ? badgeFor(tab.key) : 0;
                      return (
                        <button
                          key={tab.key}
                          onClick={() => onRoute(tab.key)}
                          className="relative flex flex-col items-center justify-center gap-[2px] transition-all duration-200 active:scale-[0.88] min-w-0 flex-1 h-full"
                        >
                          <div className="relative flex items-center justify-center">
                            <Icon className={`w-[18px] h-[18px] transition-all duration-200 ${active ? 'text-white' : 'text-white/50'}`} strokeWidth={active ? 2.3 : 1.8} />
                            {badge > 0 && (
                              <span className="absolute -top-1 -right-1.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-rose-500 text-white text-[7px] font-extrabold flex items-center justify-center border-[1.5px] border-teal-800 num">
                                {badge > 9 ? '9+' : badge}
                              </span>
                            )}
                          </div>
                          <span className={`text-[8.5px] font-semibold leading-none ${active ? 'text-white' : 'text-white/45'}`}>{tab.label}</span>
                          {active && <span aria-hidden className="absolute bottom-[6px] left-1/2 -translate-x-1/2 w-3.5 h-[2px] rounded-full bg-white/80" />}
                        </button>
                      );
                    })}
                    {/* Center spacer for FAB */}
                    <div className="w-[60px] shrink-0" />
                    {right.map(tab => {
                      const Icon = tab.icon;
                      const active = route === tab.key;
                      const badge = tab.key === 'online_orders' ? badgeFor(tab.key) : 0;
                      return (
                        <button
                          key={tab.key}
                          onClick={() => onRoute(tab.key)}
                          className="relative flex flex-col items-center justify-center gap-[2px] transition-all duration-200 active:scale-[0.88] min-w-0 flex-1 h-full"
                        >
                          <div className="relative flex items-center justify-center">
                            <Icon className={`w-[18px] h-[18px] transition-all duration-200 ${active ? 'text-white' : 'text-white/50'}`} strokeWidth={active ? 2.3 : 1.8} />
                            {badge > 0 && (
                              <span className="absolute -top-1 -right-1.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-rose-500 text-white text-[7px] font-extrabold flex items-center justify-center border-[1.5px] border-teal-800 num">
                                {badge > 9 ? '9+' : badge}
                              </span>
                            )}
                          </div>
                          <span className={`text-[8.5px] font-semibold leading-none ${active ? 'text-white' : 'text-white/45'}`}>{tab.label}</span>
                          {active && <span aria-hidden className="absolute bottom-[6px] left-1/2 -translate-x-1/2 w-3.5 h-[2px] rounded-full bg-white/80" />}
                        </button>
                      );
                    })}
                  </>
                );
              })()}
            </div>
          </div>
        </nav>

        {/* FAB overlay */}
        {fabOpen && (
          <div
            className="lg:hidden fixed inset-0 z-[42]"
            style={{ background: 'rgba(15,23,42,0.35)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
            onClick={() => setFabOpen(false)}
          />
        )}

        {/* FAB actions panel */}
        {fabOpen && (
          <div className="lg:hidden fixed inset-x-0 z-[44] flex justify-center px-3 animate-scale-in" style={{ bottom: 'calc(max(6px, env(safe-area-inset-bottom)) + 72px)' }}>
            <div
              className="w-full max-w-[340px] rounded-[22px] overflow-hidden"
              style={{
                background: 'rgba(255,255,255,0.97)',
                backdropFilter: 'saturate(1.8) blur(24px)',
                WebkitBackdropFilter: 'saturate(1.8) blur(24px)',
                boxShadow: '0 24px 60px -12px rgba(15,23,42,0.35), 0 6px 16px -4px rgba(15,23,42,0.12)',
                border: '1px solid rgba(255,255,255,0.9)',
              }}
            >
              <div className="px-4 pt-3 pb-2 border-b border-slate-100/60">
                <div className="text-[11px] font-bold text-slate-800">Actions rapides</div>
                <div className="text-[9px] text-slate-400 font-medium">Raccourcis intelligents</div>
              </div>
              <div className="p-2 space-y-0.5">
                {[
                  { icon: CreditCard, label: 'Encaisser client', desc: 'Règlement facture', route: 'tiers' as Route },
                  { icon: Wallet, label: 'Saisir acompte', desc: 'Paiement partiel', route: 'tiers' as Route },
                  { icon: Receipt, label: 'Réimprimer ticket', desc: 'Session en cours', route: 'sales' as Route },
                  { icon: ShoppingCart, label: 'Vente rapide', desc: 'Ouvrir la caisse', route: 'pos' as Route },
                  { icon: Package, label: 'Entrée stock', desc: 'Réception rapide', route: 'stock' as Route },
                  { icon: FileText, label: 'Nouveau devis', desc: 'Créer un devis', route: 'billing' as Route },
                ].map((a, i) => {
                  const Icon = a.icon;
                  return (
                    <button
                      key={i}
                      onClick={() => { onRoute(a.route); setFabOpen(false); }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl active:scale-[0.97] active:bg-teal-50/60 transition-all text-left"
                    >
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-50 to-emerald-50 border border-teal-100/60 flex items-center justify-center shrink-0">
                        <Icon className="w-4 h-4 text-teal-700" strokeWidth={2} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-bold text-slate-800">{a.label}</div>
                        <div className="text-[9px] text-slate-400 font-medium">{a.desc}</div>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* FAB button — centered over nav bar top edge, below modals (z-50) */}
        {/* In POS mode: becomes the cart button */}
        {route === 'pos' ? (
          <button
            onClick={() => setPosCart(posCartCount, !posCartOpen)}
            className={`lg:hidden fixed z-[45] left-1/2 flex items-center justify-center transition-all duration-300 active:scale-90${posCartCount > 0 && !posCartOpen ? ' cart-fab-blink' : ''}`}
            style={{
              bottom: 'calc(env(safe-area-inset-bottom) + 28px)',
              transform: 'translateX(-50%)',
              width: '50px',
              height: '50px',
              borderRadius: '50%',
              background: posCartOpen
                ? 'linear-gradient(135deg, #1e293b, #0f172a)'
                : posCartCount > 0
                  ? 'linear-gradient(135deg, #0f766e 0%, #064e3b 100%)'
                  : 'linear-gradient(145deg, #ccfbf1 0%, #5eead4 50%, #2dd4bf 100%)',
              boxShadow: posCartOpen
                ? '0 6px 20px -4px rgba(15,23,42,0.6)'
                : '0 4px 14px -3px rgba(13,148,136,0.5)',
              border: '3px solid #064e3b',
            }}
          >
            <ShoppingCart className={`w-5 h-5 ${posCartOpen || posCartCount > 0 ? 'text-white' : 'text-teal-900'}`} strokeWidth={2.5} />
            {posCartCount > 0 && !posCartOpen && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 text-[9px] rounded-full bg-red-500 text-white flex items-center justify-center font-bold border-2 border-white">{posCartCount}</span>
            )}
          </button>
        ) : (
          <button
            onClick={() => setFabOpen(v => !v)}
            className="lg:hidden fixed z-[45] left-1/2 flex items-center justify-center transition-all duration-300 active:scale-90"
            style={{
              bottom: 'calc(env(safe-area-inset-bottom) + 28px)',
              transform: `translateX(-50%) ${fabOpen ? 'rotate(135deg)' : 'rotate(0deg)'}`,
              width: '50px',
              height: '50px',
              borderRadius: '50%',
              background: fabOpen
                ? 'linear-gradient(135deg, #1e293b, #0f172a)'
                : 'linear-gradient(145deg, #ccfbf1 0%, #5eead4 50%, #2dd4bf 100%)',
              boxShadow: fabOpen
                ? '0 6px 20px -4px rgba(15,23,42,0.6)'
                : '0 4px 14px -3px rgba(13,148,136,0.5)',
              border: '3px solid #064e3b',
            }}
          >
            <Plus className={`w-5 h-5 ${fabOpen ? 'text-white' : 'text-teal-900'}`} strokeWidth={fabOpen ? 2.5 : 2.8} />
          </button>
        )}
      </div>
      </div>
    </div>
  );
}
