import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard, ShoppingCart, Package, Boxes, Users,
  BookOpen, Settings, LogOut, Menu, Store, ChevronDown, Calculator,
  Receipt, ShoppingBag, History, FileText, TrendingUp, Globe, Bell, Crown, Library,
  Plus, CreditCard, Wallet, ChevronRight, BarChart3, ClipboardList, Star,
  PanelLeftClose, PanelLeftOpen, Search, Lock, HeartPulse, ShieldCheck,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { usePermissions, type PermissionKey } from '../lib/permissions';
import { supabase } from '../lib/supabase';

export type Route =
  | 'dashboard' | 'pos' | 'cash_history' | 'articles' | 'stock' | 'tiers'
  | 'sales' | 'billing' | 'supplier_orders' | 'online_orders' | 'master_catalog'
  | 'acc_plan' | 'acc_journals' | 'acc_balance' | 'acc_grandlivre' | 'acc_tiers' | 'acc_search' | 'acc_cloture'
  | 'ipm' | 'warranties'
  | 'settings' | 'platform_admin' | 'reports';

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
    { key: 'master_catalog', label: 'Catalogue maitre', icon: Library },
    { key: 'stock', label: 'Stock', icon: Boxes },
  ]},
  { title: 'Commercial', items: [
    { key: 'billing', label: 'Facturation', icon: ClipboardList },
    { key: 'online_orders', label: 'Commandes en ligne', icon: Globe },
    { key: 'warranties', label: 'Garanties & IMEI', icon: ShieldCheck },
  ]},
  { title: 'Tiers', items: [
    { key: 'tiers', label: 'Gestion des tiers', icon: Users },
    { key: 'supplier_orders', label: 'Commandes fournisseurs', icon: ShoppingBag },
  ]},
  { title: 'Comptabilite', items: [
    { key: 'acc_plan', label: 'Plan comptable', icon: BookOpen },
    { key: 'acc_journals', label: 'Journaux', icon: FileText },
    { key: 'acc_balance', label: 'Balance', icon: TrendingUp },
    { key: 'acc_grandlivre', label: 'Grand Livre', icon: BookOpen },
    { key: 'acc_tiers', label: 'Tiers', icon: Users },
    { key: 'acc_search', label: 'Recherche', icon: Search },
    { key: 'acc_cloture', label: 'Clôtures', icon: Lock },
  ]},
  { title: 'Rapports', items: [
    { key: 'reports', label: 'Etats', icon: BarChart3 },
  ]},
  { title: 'Pharmacie', items: [
    { key: 'ipm', label: 'IPM / Tiers payant', icon: HeartPulse },
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
  billing: 'billing', online_orders: 'online_orders', warranties: 'billing',
  tiers: 'tiers', supplier_orders: 'supplier_orders',
  acc_plan: 'accounting', acc_journals: 'accounting', acc_balance: 'accounting', acc_grandlivre: 'accounting', acc_tiers: 'accounting', acc_search: 'accounting', acc_cloture: 'accounting',
  ipm: 'ipm',
  settings: 'settings', reports: 'reports',
};

const ROUTE_PERMISSION: Partial<Record<Route, PermissionKey>> = {
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

export function Shell({ route, onRoute, children }: { route: Route; onRoute: (r: Route) => void; children: ReactNode }) {
  const { tenant, profile, signOut, sites, currentSite, setCurrentSite, setDefaultSite, posCartCount, posCartOpen, setPosCart } = useApp();
  const { can, loading: permsLoading } = usePermissions();
  const isSuperAdmin = profile?.role === 'super_admin';
  const isPharmacy = (tenant?.business_activity_type_name || '').toLowerCase() === 'pharmacie';
  const activityLower = (tenant?.business_activity_type_name || '').toLowerCase().trim();
  const isImeiActivity = ['électroménager', 'electromenager', 'smartphones et accessoires', 'smartphones'].some(t => activityLower.includes(t));
  const enabledModules: string[] = Array.isArray((tenant as any)?.enabled_modules)
    ? (tenant as any).enabled_modules
    : ['dashboard','pos','cash_history','articles','stock','tiers','sales','billing','supplier_orders','online_orders','accounting','settings','reports','ipm'];
  const routeVisible = (key: Route) => {
    if (key === 'ipm' && !isPharmacy) return false;
    if (key === 'warranties' && !isImeiActivity) return false;
    const mod = ROUTE_MODULE[key];
    if (mod && !enabledModules.includes(mod)) return false;
    if (permsLoading) return true;
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
  const isDashboard = route === 'dashboard';
  const [dashMenuOpen, setDashMenuOpen] = useState(false);
  useEffect(() => { if (!isDashboard) setDashMenuOpen(false); }, [isDashboard]);

  const panelRef = useRef<HTMLElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const touch = useRef<{ x: number; y: number; active: boolean; dx: number }>({ x: 0, y: 0, active: false, dx: 0 });
  const openTouch = useRef<{ x: number; y: number; active: boolean; moved: boolean }>({ x: 0, y: 0, active: false, moved: false });

  const onMainTouchStart = (e: React.TouchEvent) => {
    if (mobileOpen) return;
    const t = e.touches[0];
    if (t.clientX > 28) return;
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
    if (openTouch.current.active && openTouch.current.moved) setMobileOpen(true);
    openTouch.current = { x: 0, y: 0, active: false, moved: false };
  };

  const closeDrawer = () => {
    setClosing(true);
    setTimeout(() => { setMobileOpen(false); setClosing(false); }, 200);
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
      panelRef.current.style.transition = 'transform 200ms ease';
      panelRef.current.style.transform = 'translateX(-110%)';
      if (overlayRef.current) { overlayRef.current.style.transition = 'opacity 200ms'; overlayRef.current.style.opacity = '0'; }
      setTimeout(() => setMobileOpen(false), 200);
    } else {
      panelRef.current.style.transition = 'transform 200ms ease';
      panelRef.current.style.transform = '';
      if (overlayRef.current) { overlayRef.current.style.transition = 'opacity 200ms'; overlayRef.current.style.opacity = ''; }
      setTimeout(() => { if (panelRef.current) panelRef.current.style.transition = ''; if (overlayRef.current) overlayRef.current.style.transition = ''; }, 220);
    }
  };

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDrawer(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const NavList = () => (
    <nav className={`flex-1 overflow-y-auto py-4 space-y-4 ${sidebarCollapsed ? 'px-2' : 'px-3'}`}>
      {isSuperAdmin ? (
        <div>
          {!sidebarCollapsed && <div className="px-3 mb-1 text-[10px] font-semibold tracking-widest uppercase text-neutral-400">Plateforme</div>}
          <button
            onClick={() => { onRoute('platform_admin'); setMobileOpen(false); }}
            className={`nav-item ${route === 'platform_admin' ? 'nav-item-active' : 'nav-item-idle'} ${sidebarCollapsed ? 'justify-center px-0' : ''}`}
            title={sidebarCollapsed ? 'Console plateforme' : undefined}
          >
            <Crown className={`w-[17px] h-[17px] flex-shrink-0 ${route === 'platform_admin' ? 'text-white' : 'text-neutral-400'}`} />
            {!sidebarCollapsed && <span>Console plateforme</span>}
          </button>
        </div>
      ) : (
      <>
      {visibleNav.map(group => (
        <div key={group.title}>
          {!sidebarCollapsed && (
            <div className="px-3 mb-1 text-[10px] font-semibold tracking-widest uppercase text-neutral-400">
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
                  <Icon className={`w-[17px] h-[17px] flex-shrink-0 ${active ? 'text-white' : 'text-neutral-400'}`} />
                  {!sidebarCollapsed && <span className="whitespace-nowrap">{item.label}</span>}
                  {!sidebarCollapsed && badge > 0 && (
                    <span className={`ml-auto min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full text-[10px] font-bold ${active ? 'bg-white text-neutral-900' : 'bg-red-500 text-white'}`}>{badge > 99 ? '99+' : badge}</span>
                  )}
                  {!sidebarCollapsed && badge === 0 && active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-white/70" />}
                  {sidebarCollapsed && badge > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center">{badge > 9 ? '9+' : badge}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {routeVisible('settings') && (
        <div>
          {!sidebarCollapsed && <div className="px-3 mb-1 text-[10px] font-semibold tracking-widest uppercase text-neutral-400">Systeme</div>}
          <button
            onClick={() => { onRoute('settings'); setMobileOpen(false); }}
            className={`nav-item ${route === 'settings' ? 'nav-item-active' : 'nav-item-idle'} ${sidebarCollapsed ? 'justify-center px-0' : ''}`}
            title={sidebarCollapsed ? 'Paramètres' : undefined}
          >
            <Settings className={`w-[17px] h-[17px] flex-shrink-0 ${route === 'settings' ? 'text-white' : 'text-neutral-400'}`} />
            {!sidebarCollapsed && <span className="whitespace-nowrap">Paramètres</span>}
          </button>
        </div>
      )}
      </>
      )}
    </nav>
  );

  return (
    <div className="min-h-screen h-screen flex flex-col overflow-hidden bg-white">
      {/* Desktop header */}
      <header
        className={`${isDashboard && !dashMenuOpen ? 'hidden' : 'hidden lg:flex'} items-center h-14 border-b border-neutral-200 bg-white sticky top-0 z-30 flex-shrink-0`}
      >
        <div className={`flex items-center gap-2.5 px-4 h-full transition-all duration-200 ${sidebarCollapsed ? 'w-[64px]' : ''}`}>
          {tenant?.logo_url ? (
            <img src={tenant.logo_url} alt={tenant.name} className="w-9 h-9 object-contain flex-shrink-0" />
          ) : (
            <img src="/newlogo.png" alt="WAARWI" className="h-7 w-auto max-w-[120px] object-contain flex-shrink-0" />
          )}
          {!sidebarCollapsed && (
            <div className="leading-tight">
              {tenant?.logo_url && <div className="text-sm font-bold text-neutral-900 tracking-tight whitespace-nowrap">{tenant?.name || 'WAARWI'}</div>}
              {tenant?.slogan && <div className="text-[10px] text-neutral-500 leading-tight whitespace-nowrap">{tenant.slogan}</div>}
            </div>
          )}
        </div>
        <div className="flex-1 flex items-center gap-3 px-5">
          <div className="flex-1" />
          <div className="flex items-center gap-2 shrink-0">
            {newOrdersCount > 0 && (
              <button
                onClick={() => onRoute('online_orders')}
                className="relative w-9 h-9 rounded-lg border border-neutral-200 flex items-center justify-center hover:bg-neutral-50 transition-colors"
              >
                <Bell className="w-4 h-4 text-neutral-700" />
                <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center border-2 border-white num">
                  {newOrdersCount > 9 ? '9+' : newOrdersCount}
                </span>
              </button>
            )}
            <div className="relative">
              <button
                onClick={() => setUserOpen(v => !v)}
                className="flex items-center gap-2 pl-1 pr-2 h-9 rounded-lg hover:bg-neutral-50 transition-colors"
              >
                <div className="w-8 h-8 rounded-lg bg-neutral-900 flex items-center justify-center text-white text-[12px] font-bold">
                  {(profile?.full_name || profile?.email || '?').charAt(0).toUpperCase()}
                </div>
                <div className="text-left leading-tight">
                  <div className="text-[12px] font-semibold text-neutral-900 max-w-[120px] truncate">{profile?.full_name || profile?.email}</div>
                  <div className="text-[9px] text-neutral-400 uppercase tracking-wider font-medium">{profile?.role}</div>
                </div>
              </button>
              {userOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setUserOpen(false)} />
                  <div className="absolute right-0 mt-2 w-56 bg-white border border-neutral-200 rounded-xl shadow-elevated py-1 animate-slide-down z-20">
                    <div className="px-3 py-2.5 border-b border-neutral-100">
                      <div className="text-sm font-semibold text-neutral-900 truncate">{profile?.full_name}</div>
                      <div className="text-xs text-neutral-500 truncate">{profile?.email}</div>
                    </div>
                    <button onClick={() => { setUserOpen(false); onRoute('settings'); }} className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-50 flex items-center gap-2 transition-colors">
                      <Settings className="w-4 h-4 text-neutral-400" /> Paramètres
                    </button>
                    <button onClick={signOut} className="w-full text-left px-3 py-2 text-sm hover:bg-red-50 text-red-600 flex items-center gap-2 transition-colors">
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
      {/* Desktop sidebar */}
      <aside className={`${isDashboard && !dashMenuOpen ? 'hidden' : 'hidden lg:flex'} flex-col flex-shrink-0 h-full border-r border-neutral-200 bg-white transition-all duration-200 ${sidebarCollapsed ? 'w-[64px]' : 'w-[240px]'}`}>
        <NavList />
        <div className="p-3 border-t border-neutral-100 space-y-2">
          {sites.length > 0 && !sidebarCollapsed && (
            <div className="relative">
              <div className="text-[10px] font-semibold tracking-widest uppercase text-neutral-400 px-1 mb-1">Point de vente</div>
              <button
                onClick={() => setSiteOpen(v => !v)}
                className="w-full flex items-center gap-2 px-3 h-10 rounded-lg bg-white border border-neutral-200 hover:border-neutral-300 text-[13px] font-medium text-neutral-800 transition-all"
              >
                <Store className="w-4 h-4 text-neutral-500 shrink-0" />
                <span className="flex-1 text-left truncate">{currentSite?.name || 'Selectionner'}</span>
                <ChevronDown className={`w-3.5 h-3.5 text-neutral-400 shrink-0 transition-transform ${siteOpen ? 'rotate-180' : ''}`} />
              </button>
              {siteOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setSiteOpen(false)} />
                  <div className="absolute left-0 right-0 bottom-[calc(100%+6px)] bg-white border border-neutral-200 rounded-xl shadow-elevated py-1 animate-slide-down z-20 max-h-64 overflow-auto">
                    {sites.map(s => {
                      const isDefault = (profile as any)?.default_site_id === s.id;
                      return (
                        <div key={s.id} className={`flex items-center gap-1 px-2 py-0.5 transition-colors ${currentSite?.id === s.id ? 'bg-neutral-50' : 'hover:bg-neutral-50'}`}>
                          <button
                            onClick={() => { setCurrentSite(s); setSiteOpen(false); onRoute('dashboard'); }}
                            className={`flex-1 text-left flex items-center gap-2 px-1.5 py-1.5 text-sm rounded-lg transition-colors ${currentSite?.id === s.id ? 'text-neutral-900 font-semibold' : 'text-neutral-600'}`}
                          >
                            <Store className={`w-4 h-4 ${currentSite?.id === s.id ? 'text-neutral-900' : 'text-neutral-400'}`} />
                            <span className="truncate">{s.name}</span>
                          </button>
                          <button
                            title={isDefault ? 'Magasin par défaut' : 'Définir comme défaut'}
                            onClick={() => { setDefaultSite(s); setSiteOpen(false); onRoute('dashboard'); }}
                            className={`shrink-0 p-1.5 rounded-lg transition-colors ${isDefault ? 'text-neutral-900' : 'text-neutral-300 hover:text-neutral-600'}`}
                          >
                            <Star className="w-3.5 h-3.5" fill={isDefault ? 'currentColor' : 'none'} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
          <button onClick={signOut} className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800 transition-colors ${sidebarCollapsed ? 'justify-center' : ''}`}>
            <LogOut className="w-4 h-4 flex-shrink-0" /> {!sidebarCollapsed && 'Déconnexion'}
          </button>
          <button
            onClick={() => setSidebarCollapsed(v => !v)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-neutral-400 hover:bg-neutral-50 hover:text-neutral-700 transition-colors justify-center"
            title={sidebarCollapsed ? 'Ouvrir le menu' : 'Réduire le menu'}
          >
            {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>
      </aside>

      {/* Mobile floating sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
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
            <div className="float-sidebar-content">
              <div className="flex items-center justify-between px-4 pt-4 pb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  {tenant?.logo_url ? (
                    <img src={tenant.logo_url} alt={tenant.name} className="w-8 h-8 object-contain shrink-0" />
                  ) : (
                    <img src="/newlogo.png" alt="WAARWI" className="h-6 w-auto max-w-[100px] object-contain shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold text-neutral-900 truncate">{tenant?.name || 'WAARWI'}</div>
                    {profile?.full_name && (
                      <div className="text-[10px] text-neutral-500 truncate">{profile.full_name}</div>
                    )}
                  </div>
                </div>
                <button onClick={() => { onRoute('settings'); closeDrawer(); }} className="float-close-btn shrink-0">
                  <Settings className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-2.5 pb-1 space-y-1.5 scrollbar-hide">
                {isSuperAdmin && (
                  <div>
                    <div className="px-2.5 mb-0.5 text-[9px] font-semibold tracking-widest uppercase text-neutral-400">Plateforme</div>
                    <button
                      onClick={() => { onRoute('platform_admin'); closeDrawer(); }}
                      className={`float-nav-item-compact ${route === 'platform_admin' ? 'float-nav-item-active' : ''}`}
                    >
                      <Crown className={`w-4 h-4 shrink-0 ${route === 'platform_admin' ? 'text-white' : 'text-neutral-400'}`} />
                      <span className="truncate">Console plateforme</span>
                    </button>
                  </div>
                )}
                {!isSuperAdmin && visibleNav.map(group => (
                  <div key={group.title}>
                    <div className="px-2.5 mb-0.5 text-[9px] font-semibold tracking-widest uppercase text-neutral-400">
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
                            <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-white' : 'text-neutral-500'}`} />
                            <span className="truncate">{item.label}</span>
                            {badge > 0 && (
                              <span className="ml-auto min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full text-[10px] font-bold bg-red-500 text-white">{badge > 99 ? '99+' : badge}</span>
                            )}
                            {badge === 0 && active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-white" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="px-3 pt-2 pb-2.5 border-t border-neutral-100 space-y-1.5" style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))' }}>
                {sites.length > 0 && (
                  <div>
                    <div className="px-1 mb-1 text-[9px] font-semibold tracking-widest uppercase text-neutral-400">Point de vente</div>
                    <div className="max-h-28 overflow-auto space-y-0.5">
                      {sites.map(s => {
                        const isDefault = (profile as any)?.default_site_id === s.id;
                        return (
                          <div key={s.id} className={`flex items-center gap-1 rounded-lg transition-colors ${currentSite?.id === s.id ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}>
                            <button
                              onClick={() => { setCurrentSite(s); onRoute('dashboard'); closeDrawer(); }}
                              className={`flex-1 flex items-center gap-2 px-2.5 py-1.5 text-[12px] font-medium transition-colors ${currentSite?.id === s.id ? 'text-neutral-900 font-semibold' : 'text-neutral-600'}`}
                            >
                              <Store className={`w-3.5 h-3.5 ${currentSite?.id === s.id ? 'text-neutral-900' : 'text-neutral-400'}`} />
                              <span className="truncate flex-1 text-left">{s.name}</span>
                            </button>
                            <button
                              onClick={() => { setDefaultSite(s); onRoute('dashboard'); closeDrawer(); }}
                              title={isDefault ? 'Défaut' : 'Définir défaut'}
                              className={`shrink-0 p-1.5 transition-colors ${isDefault ? 'text-neutral-900' : 'text-neutral-300 hover:text-neutral-600'}`}
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
        {/* Floating mobile hamburger with logo */}
        <button
          onClick={() => setMobileOpen(true)}
          className="lg:hidden fixed z-40 flex items-center justify-center transition-all active:scale-90"
          style={{
            top: 'calc(env(safe-area-inset-top) + 14px)',
            left: '12px',
            height: '48px',
            borderRadius: '12px',
            background: '#ffffff',
            border: '1px solid #e5e5e5',
            boxShadow: '0 2px 8px -2px rgba(0,0,0,0.08)',
            paddingLeft: '10px',
            paddingRight: '8px',
            gap: '8px',
          }}
          aria-label="Menu"
        >
          <Menu className="w-5 h-5 text-neutral-800 shrink-0" strokeWidth={2.2} />
          {tenant?.logo_url ? (
            <img src={tenant.logo_url} alt="" className="h-8 w-8 object-contain rounded" />
          ) : (
            <img src="/newlogo.png" alt="" className="h-5 w-auto max-w-[48px] object-contain" />
          )}
        </button>

        {/* Desktop dashboard menu button */}
        {isDashboard && !dashMenuOpen && (
          <button
            onClick={() => setDashMenuOpen(true)}
            className="hidden lg:flex fixed z-40 items-center gap-2 px-3 py-2 rounded-lg transition-all active:scale-95"
            style={{
              top: '12px',
              left: '16px',
              background: '#ffffff',
              border: '1px solid #e5e5e5',
              boxShadow: '0 2px 8px -2px rgba(0,0,0,0.06)',
            }}
          >
            <Menu className="w-4 h-4 text-neutral-700" strokeWidth={2} />
            <span className="text-xs font-medium text-neutral-600">Menu</span>
          </button>
        )}

        {/* Mobile header */}
        <header
          className="lg:hidden sticky top-0 z-30 flex items-center border-b border-neutral-200 bg-white"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top) + 12px)',
            paddingBottom: '12px',
            paddingLeft: '108px',
            paddingRight: '12px',
            minHeight: 'calc(76px + env(safe-area-inset-top))',
          }}
        >
          <div className="flex-1 min-w-0 px-2">
            <div className="font-bold tracking-tight text-neutral-900 text-[13px] leading-[1.2]"
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                wordBreak: 'break-word',
              }}
            >
              {tenant?.name || 'WAARWI'}
            </div>
            {tenant?.slogan && <div className="text-[10px] text-neutral-500 leading-tight mt-0.5 truncate">{tenant.slogan}</div>}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
          {newOrdersCount > 0 && (
            <button
              onClick={() => onRoute('online_orders')}
              className="relative w-9 h-9 rounded-lg border border-neutral-200 flex items-center justify-center hover:bg-neutral-50 transition-colors"
            >
              <Bell className="w-4 h-4 text-neutral-700" />
              <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center border-2 border-white num">
                {newOrdersCount > 9 ? '9+' : newOrdersCount}
              </span>
            </button>
          )}
          <div className="relative">
            <button
              onClick={() => setUserOpen(v => !v)}
              className="w-10 h-10 rounded-xl bg-neutral-900 flex items-center justify-center text-white text-[13px] font-bold"
            >
              {(profile?.full_name || profile?.email || '?').charAt(0).toUpperCase()}
            </button>
            {userOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setUserOpen(false)} />
                <div className="absolute right-0 mt-2 w-56 bg-white border border-neutral-200 rounded-xl shadow-elevated py-1 animate-slide-down z-20">
                  <div className="px-3 py-2.5 border-b border-neutral-100">
                    <div className="text-sm font-semibold text-neutral-900 truncate">{profile?.full_name}</div>
                    <div className="text-xs text-neutral-500 truncate">{profile?.email}</div>
                  </div>
                  <button onClick={() => { setUserOpen(false); onRoute('settings'); }} className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-50 flex items-center gap-2 transition-colors">
                    <Settings className="w-4 h-4 text-neutral-400" /> Paramètres
                  </button>
                  <button onClick={signOut} className="w-full text-left px-3 py-2 text-sm hover:bg-red-50 text-red-600 flex items-center gap-2 transition-colors">
                    <LogOut className="w-4 h-4" /> Déconnexion
                  </button>
                </div>
              </>
            )}
          </div>
          </div>
        </header>

        <main className={`flex-1 w-full min-h-0 ${isPOS ? 'flex flex-col max-w-none p-0 overflow-hidden' : (isDashboard && !dashMenuOpen) ? 'flex flex-col max-w-none p-0 overflow-y-auto overflow-x-hidden scrollbar-hide' : 'overflow-y-auto overflow-x-hidden scrollbar-hide'}`}>
          {isPOS ? (
            <div className="flex-1 flex flex-col min-h-0 pb-[60px] lg:pb-0">{children}</div>
          ) : (isDashboard && !dashMenuOpen) ? (
            <div className="flex-1 min-h-0 px-2 sm:px-3 lg:px-0 pt-3 lg:pt-0 pb-[100px] lg:pb-0">{children}</div>
          ) : (
            <div className="w-full max-w-[1600px] mx-auto px-3 sm:px-5 lg:px-8 pt-3 sm:pt-4 lg:pt-6 pb-[72px] lg:pb-8">{children}</div>
          )}
        </main>

        {/* Bottom nav */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 pointer-events-none" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="pointer-events-auto">
            <div className="relative flex items-center justify-around h-[52px] bg-neutral-900 border-t border-neutral-800">
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
                          className="relative flex flex-col items-center justify-center gap-[2px] transition-all duration-150 active:scale-[0.88] min-w-0 flex-1 h-full"
                        >
                          <div className="relative flex items-center justify-center">
                            <Icon className={`w-[17px] h-[17px] ${active ? 'text-white' : 'text-neutral-500'}`} strokeWidth={active ? 2.2 : 1.8} />
                            {badge > 0 && (
                              <span className="absolute -top-1 -right-1.5 min-w-[12px] h-[12px] px-0.5 rounded-full bg-red-500 text-white text-[7px] font-bold flex items-center justify-center num">
                                {badge > 9 ? '9+' : badge}
                              </span>
                            )}
                          </div>
                          <span className={`text-[8px] font-medium leading-none ${active ? 'text-white' : 'text-neutral-500'}`}>{tab.label}</span>
                          {active && <span className="absolute bottom-[5px] left-1/2 -translate-x-1/2 w-3 h-[1.5px] rounded-full bg-white" />}
                        </button>
                      );
                    })}
                    <div className="w-[56px] shrink-0" />
                    {right.map(tab => {
                      const Icon = tab.icon;
                      const active = route === tab.key;
                      const badge = tab.key === 'online_orders' ? badgeFor(tab.key) : 0;
                      return (
                        <button
                          key={tab.key}
                          onClick={() => onRoute(tab.key)}
                          className="relative flex flex-col items-center justify-center gap-[2px] transition-all duration-150 active:scale-[0.88] min-w-0 flex-1 h-full"
                        >
                          <div className="relative flex items-center justify-center">
                            <Icon className={`w-[17px] h-[17px] ${active ? 'text-white' : 'text-neutral-500'}`} strokeWidth={active ? 2.2 : 1.8} />
                            {badge > 0 && (
                              <span className="absolute -top-1 -right-1.5 min-w-[12px] h-[12px] px-0.5 rounded-full bg-red-500 text-white text-[7px] font-bold flex items-center justify-center num">
                                {badge > 9 ? '9+' : badge}
                              </span>
                            )}
                          </div>
                          <span className={`text-[8px] font-medium leading-none ${active ? 'text-white' : 'text-neutral-500'}`}>{tab.label}</span>
                          {active && <span className="absolute bottom-[5px] left-1/2 -translate-x-1/2 w-3 h-[1.5px] rounded-full bg-white" />}
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
          <div className="lg:hidden fixed inset-0 z-[42] bg-black/30 backdrop-blur-sm" onClick={() => setFabOpen(false)} />
        )}

        {/* FAB actions panel */}
        {fabOpen && (
          <div className="lg:hidden fixed inset-x-0 z-[44] flex justify-center px-3 animate-scale-in" style={{ bottom: 'calc(max(6px, env(safe-area-inset-bottom)) + 68px)' }}>
            <div className="w-full max-w-[320px] rounded-xl overflow-hidden bg-white border border-neutral-200 shadow-premium">
              <div className="px-4 pt-3 pb-2 border-b border-neutral-100">
                <div className="text-[12px] font-bold text-neutral-900">Actions rapides</div>
              </div>
              <div className="p-1.5 space-y-0.5">
                {[
                  { icon: CreditCard, label: 'Encaisser client', desc: 'Reglement facture', route: 'tiers' as Route },
                  { icon: Wallet, label: 'Saisir acompte', desc: 'Paiement partiel', route: 'tiers' as Route },
                  { icon: Receipt, label: 'Reimprimer ticket', desc: 'Session en cours', route: 'sales' as Route },
                  { icon: ShoppingCart, label: 'Vente rapide', desc: 'Ouvrir la caisse', route: 'pos' as Route },
                  { icon: Package, label: 'Entrée stock', desc: 'Réception rapide', route: 'stock' as Route },
                  { icon: FileText, label: 'Nouveau devis', desc: 'Creer un devis', route: 'billing' as Route },
                ].map((a, i) => {
                  const Icon = a.icon;
                  return (
                    <button
                      key={i}
                      onClick={() => { onRoute(a.route); setFabOpen(false); }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg active:scale-[0.97] hover:bg-neutral-50 transition-all text-left"
                    >
                      <div className="w-8 h-8 rounded-lg bg-neutral-100 flex items-center justify-center shrink-0">
                        <Icon className="w-4 h-4 text-neutral-700" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-semibold text-neutral-900">{a.label}</div>
                        <div className="text-[10px] text-neutral-400">{a.desc}</div>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-neutral-300 shrink-0" />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* FAB button */}
        {route === 'pos' ? (
          <button
            onClick={() => setPosCart(posCartCount, !posCartOpen)}
            className={`lg:hidden fixed z-[45] left-1/2 flex items-center justify-center transition-all duration-200 active:scale-90${posCartCount > 0 && !posCartOpen ? ' cart-fab-blink' : ''}`}
            style={{
              bottom: 'calc(env(safe-area-inset-bottom) + 26px)',
              transform: 'translateX(-50%)',
              width: '48px',
              height: '48px',
              borderRadius: '14px',
              background: posCartOpen ? '#0a0a0a' : posCartCount > 0 ? '#0a0a0a' : '#ffffff',
              boxShadow: '0 4px 12px -2px rgba(0,0,0,0.15)',
              border: posCartOpen || posCartCount > 0 ? 'none' : '1px solid #e5e5e5',
            }}
          >
            <ShoppingCart className={`w-5 h-5 ${posCartOpen || posCartCount > 0 ? 'text-white' : 'text-neutral-900'}`} strokeWidth={2} />
            {posCartCount > 0 && !posCartOpen && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 text-[9px] rounded-full bg-red-500 text-white flex items-center justify-center font-bold">{posCartCount}</span>
            )}
          </button>
        ) : (
          <button
            onClick={() => setFabOpen(v => !v)}
            className="lg:hidden fixed z-[45] left-1/2 flex items-center justify-center transition-all duration-200 active:scale-90"
            style={{
              bottom: 'calc(env(safe-area-inset-bottom) + 26px)',
              transform: `translateX(-50%) ${fabOpen ? 'rotate(135deg)' : 'rotate(0deg)'}`,
              width: '48px',
              height: '48px',
              borderRadius: '14px',
              background: fabOpen ? '#0a0a0a' : '#ffffff',
              boxShadow: '0 4px 12px -2px rgba(0,0,0,0.12)',
              border: fabOpen ? 'none' : '1px solid #e5e5e5',
            }}
          >
            <Plus className={`w-5 h-5 ${fabOpen ? 'text-white' : 'text-neutral-900'}`} strokeWidth={2} />
          </button>
        )}
      </div>
      </div>
    </div>
  );
}
