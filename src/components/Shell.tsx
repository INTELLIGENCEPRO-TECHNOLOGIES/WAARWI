import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutDashboard, ShoppingCart, Package, Boxes, Users,
  BookOpen, Settings, LogOut, Menu, Store, ChevronDown, Calculator,
  Receipt, ShoppingBag, History, FileText, TrendingUp, Globe, Bell, Crown, Library, Truck,
  Plus, CreditCard, Wallet, ChevronRight, BarChart3, ClipboardList, Star,
  PanelLeftClose, PanelLeftOpen, Search, Lock, HeartPulse, ShieldCheck, Palette, ArrowRightLeft, UserCheck,
  X, Monitor, Check,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { usePermissions, type PermissionKey } from '../lib/permissions';
import { supabase } from '../lib/supabase';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from './LanguageSwitcher';

export type Route =
  | 'dashboard' | 'pos' | 'cash_history' | 'articles' | 'stock' | 'tiers'
  | 'sales' | 'billing' | 'supplier_orders' | 'online_orders' | 'master_catalog'
  | 'acc_plan' | 'acc_journals' | 'acc_balance' | 'acc_grandlivre' | 'acc_tiers' | 'acc_search' | 'acc_cloture'
  | 'ipm' | 'warranties' | 'money_transfer' | 'representatives'
  | 'settings' | 'platform_admin' | 'reports';

type NavItem = { key: Route; labelKey: string; icon: any; children?: { key: Route; labelKey: string; icon: any }[]; aliases?: string[] };
type NavGroup = { titleKey: string; items: NavItem[] };

const NAV_ALIASES: Partial<Record<Route, string[]>> = {
  billing: ['devis', 'retour', 'retours', 'avoir', 'avoirs', 'facture', 'factures', 'quote', 'quotes', 'return', 'returns', 'credit', 'credits', 'invoice', 'invoices'],
  pos: ['vente', 'ventes', 'sale', 'sales', 'caisse', 'encaissement'],
  articles: ['produit', 'produits', 'piece', 'pieces', 'article', 'catalogue'],
  stock: ['inventaire', 'entrepot', 'depot', 'magasin'],
  tiers: ['client', 'clients', 'fournisseur', 'fournisseurs', 'customer', 'supplier'],
  sales: ['journal', 'historique', 'historique des ventes'],
  cash_history: ['caisse', 'session', 'sessions', 'cash'],
  supplier_orders: ['commande', 'commandes', 'achat', 'achats', 'purchase', 'orders'],
  online_orders: ['commande en ligne', 'commandes en ligne', 'online'],
  warranties: ['garantie', 'garanties', 'warranty', 'warranties'],
  representatives: ['representant', 'representants', 'rep', 'commission', 'commissions'],
  reports: ['rapport', 'rapports', 'statistique', 'statistiques', 'report', 'statistics'],
  money_transfer: ['transfert', 'transfert d argent', 'money', 'transfer', 'western union', 'ria', 'moneygram'],
  ipm: ['ipm', 'bordereau', 'bordereaux'],
  accounting: ['comptabilite', 'compte', 'comptes', 'journal', 'balance', 'grand livre', 'cloture'],
  settings: ['parametre', 'parametres', 'configuration', 'config', 'setting', 'reglage', 'reglages'],
};

const NAV_GROUPS: NavGroup[] = [
  { titleKey: 'nav.pilotage', items: [
    { key: 'dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  ]},
  { titleKey: 'nav.pos', items: [
    { key: 'pos', labelKey: 'nav.pos', icon: ShoppingCart },
    { key: 'sales', labelKey: 'nav.sales', icon: Calculator },
    { key: 'cash_history', labelKey: 'nav.cashHistory', icon: History },
  ]},
  { titleKey: 'nav.catalogStock', items: [
    { key: 'articles', labelKey: 'nav.articles', icon: Package },
    { key: 'master_catalog', labelKey: 'nav.masterCatalog', icon: Library },
    { key: 'stock', labelKey: 'nav.stock', icon: Boxes },
  ]},
  { titleKey: 'nav.commercial', items: [
    { key: 'billing', labelKey: 'nav.billing', icon: ClipboardList },
    { key: 'online_orders', labelKey: 'nav.onlineOrders', icon: Globe },
    { key: 'warranties', labelKey: 'nav.warranties', icon: ShieldCheck },
    { key: 'representatives', labelKey: 'nav.representatives', icon: UserCheck },
    { key: 'tiers', labelKey: 'nav.tiers', icon: Users },
    { key: 'supplier_orders', labelKey: 'nav.supplierOrders', icon: Truck },
  ]},
  { titleKey: 'nav.accounting', items: [
    { key: 'acc_plan', labelKey: 'nav.accounting', icon: BookOpen, children: [
      { key: 'acc_plan', labelKey: 'nav.accountingPlan', icon: BookOpen },
      { key: 'acc_journals', labelKey: 'nav.journals', icon: FileText },
      { key: 'acc_balance', labelKey: 'nav.balance', icon: TrendingUp },
      { key: 'acc_grandlivre', labelKey: 'nav.generalLedger', icon: BookOpen },
      { key: 'acc_tiers', labelKey: 'nav.tiers', icon: Users },
      { key: 'acc_search', labelKey: 'nav.journal', icon: Search },
      { key: 'acc_cloture', labelKey: 'nav.closings', icon: Lock },
    ]},
  ]},
  { titleKey: 'nav.tools', items: [
    { key: 'money_transfer', labelKey: 'nav.moneyTransfer', icon: ArrowRightLeft },
    { key: 'reports', labelKey: 'nav.reports', icon: BarChart3 },
    { key: 'ipm', labelKey: 'nav.ipm', icon: HeartPulse },
  ]},
];

// Mobile tabs are now contextual — see POS_MOBILE_TABS and DEFAULT_MOBILE_TABS below

const ROUTE_MODULE: Record<string, string> = {
  dashboard: 'dashboard', pos: 'pos', sales: 'sales', cash_history: 'cash_history',
  articles: 'articles', master_catalog: 'articles', stock: 'stock',
  billing: 'billing', online_orders: 'online_orders', warranties: 'billing', representatives: 'billing',
  tiers: 'tiers', supplier_orders: 'supplier_orders',
  acc_plan: 'accounting', acc_journals: 'accounting', acc_balance: 'accounting', acc_grandlivre: 'accounting', acc_tiers: 'accounting', acc_search: 'accounting', acc_cloture: 'accounting',
  ipm: 'ipm', money_transfer: 'money_transfer',
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
  money_transfer: 'access_money_transfer',
  representatives: 'rep_view',
  settings: 'manage_settings',
};

const BREADCRUMB_MAP: Record<string, { group: string; labelKey: string }> = {
  dashboard: { group: 'nav.pilotage', labelKey: 'nav.dashboard' },
  pos: { group: 'nav.pos', labelKey: 'nav.pos' },
  sales: { group: 'nav.pos', labelKey: 'nav.sales' },
  cash_history: { group: 'nav.pos', labelKey: 'nav.cashHistory' },
  articles: { group: 'nav.catalogStock', labelKey: 'nav.articles' },
  master_catalog: { group: 'nav.catalogStock', labelKey: 'nav.masterCatalog' },
  stock: { group: 'nav.catalogStock', labelKey: 'nav.stock' },
  billing: { group: 'nav.commercial', labelKey: 'nav.billing' },
  online_orders: { group: 'nav.commercial', labelKey: 'nav.onlineOrders' },
  warranties: { group: 'nav.commercial', labelKey: 'nav.warranties' },
  representatives: { group: 'nav.commercial', labelKey: 'nav.representatives' },
  tiers: { group: 'nav.commercial', labelKey: 'nav.tiers' },
  supplier_orders: { group: 'nav.commercial', labelKey: 'nav.supplierOrders' },
  acc_plan: { group: 'nav.accounting', labelKey: 'nav.accountingPlan' },
  acc_journals: { group: 'nav.accounting', labelKey: 'nav.journals' },
  acc_balance: { group: 'nav.accounting', labelKey: 'nav.balance' },
  acc_grandlivre: { group: 'nav.accounting', labelKey: 'nav.generalLedger' },
  acc_tiers: { group: 'nav.accounting', labelKey: 'nav.tiers' },
  acc_search: { group: 'nav.accounting', labelKey: 'nav.journal' },
  acc_cloture: { group: 'nav.accounting', labelKey: 'nav.closings' },
  money_transfer: { group: 'nav.tools', labelKey: 'nav.moneyTransfer' },
  reports: { group: 'nav.tools', labelKey: 'nav.reports' },
  ipm: { group: 'nav.tools', labelKey: 'nav.ipm' },
  settings: { group: 'nav.system', labelKey: 'nav.settings' },
  platform_admin: { group: 'nav.platform', labelKey: 'nav.platform' },
};

const POS_MOBILE_TABS: { key: Route; labelKey: string; icon: any }[] = [
  { key: 'dashboard', labelKey: 'nav.home', icon: LayoutDashboard },
  { key: 'pos', labelKey: 'nav.pos', icon: ShoppingCart },
  { key: 'tiers', labelKey: 'nav.tiers', icon: Users },
  { key: 'settings', labelKey: 'nav.settings', icon: Settings },
];

const DEFAULT_MOBILE_TABS: { key: Route; labelKey: string; icon: any }[] = [
  { key: 'dashboard', labelKey: 'nav.home', icon: LayoutDashboard },
  { key: 'billing', labelKey: 'nav.billing', icon: ClipboardList },
  { key: 'articles', labelKey: 'nav.articles', icon: Package },
  { key: 'settings', labelKey: 'nav.settings', icon: Settings },
];

function getUsageMap(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem('nav_usage') || '{}'); } catch { return {}; }
}
function trackUsage(key: Route) {
  try {
    const map = getUsageMap();
    map[key] = (map[key] || 0) + 1;
    localStorage.setItem('nav_usage', JSON.stringify(map));
  } catch {}
}

export function Shell({ route, onRoute, children }: { route: Route; onRoute: (r: Route) => void; children: ReactNode }) {
  const { t } = useTranslation();
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
    .map(g => ({
      ...g,
      items: g.items
        .filter(i => routeVisible(i.key))
        .map(i => (i as NavItem).children
          ? { ...i, children: (i as NavItem).children!.filter(c => routeVisible(c.key)) }
          : i
        ),
    }))
    .filter(g => g.items.length > 0);
  const visibleMobileTabs = (route === 'pos' ? POS_MOBILE_TABS : DEFAULT_MOBILE_TABS).filter(t => routeVisible(t.key));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileAcctOpen, setMobileAcctOpen] = useState<Route | null>(null);
  const [desktopAcctOpen, setDesktopAcctOpen] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [newOrdersCount, setNewOrdersCount] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarDark, setSidebarDark] = useState(() => {
    try { return localStorage.getItem('sidebar_dark') === '1'; } catch { return false; }
  });
  const toggleSidebarTheme = () => {
    setSidebarDark(prev => {
      const next = !prev;
      try { localStorage.setItem('sidebar_dark', next ? '1' : '0'); } catch {}
      return next;
    });
  };

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
  const [siteConfirmPending, setSiteConfirmPending] = useState<typeof sites[0] | null>(null);

  const isPOS = route === 'pos';
  const isDashboard = route === 'dashboard';
  const isPlatformAdmin = route === 'platform_admin';
  const [dashMenuOpen, setDashMenuOpen] = useState(false);
  useEffect(() => { if (!isDashboard) setDashMenuOpen(false); }, [isDashboard]);

  const accRoutes = ['acc_plan', 'acc_journals', 'acc_balance', 'acc_grandlivre', 'acc_tiers', 'acc_search', 'acc_cloture'];
  useEffect(() => {
    if (accRoutes.includes(route)) { setDesktopAcctOpen(true); setMobileAcctOpen('acc_plan'); }
  }, [route]);

  // Track page usage for dynamic nav ordering
  const [usageTick, setUsageTick] = useState(0);
  useEffect(() => { trackUsage(route); setUsageTick(t => t + 1); }, [route]);

  // Sidebar search
  const [navSearch, setNavSearch] = useState('');
  const navSearchRef = useRef<HTMLInputElement | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);

  // Build a flat searchable list of all nav items (including children)
  const allNavItems = useMemo(() => {
    const items: { key: Route; labelKey: string; icon: any; group: string }[] = [];
    for (const g of NAV_GROUPS) {
      for (const item of g.items) {
        items.push({ key: item.key, labelKey: item.labelKey, icon: item.icon, group: g.titleKey });
        if ((item as NavItem).children) {
          for (const child of (item as NavItem).children!) {
            items.push({ key: child.key, labelKey: child.labelKey, icon: child.icon, group: g.titleKey });
          }
        }
      }
    }
    items.push({ key: 'settings' as Route, labelKey: 'nav.settings', icon: Settings, group: 'nav.system' });
    return items;
  }, []);

  const searchResults = useMemo(() => {
    if (!navSearch.trim()) return [];
    const q = navSearch.toLowerCase().trim();
    return allNavItems.filter(item => {
      if (!routeVisible(item.key)) return false;
      const label = t(item.labelKey).toLowerCase();
      const aliases = NAV_ALIASES[item.key] || [];
      return label.includes(q) || item.key.toLowerCase().includes(q) || aliases.some(a => a.includes(q) || q.includes(a));
    }).slice(0, 8);
  }, [navSearch, usageTick]);

  // Sort nav groups items by usage (most used first) — only when not searching
  const sortedNav = useMemo(() => {
    if (navSearch.trim()) return visibleNav;
    const usage = getUsageMap();
    return visibleNav.map(g => ({
      ...g,
      items: [...g.items].sort((a, b) => {
        const aUsage = usage[a.key] || 0;
        const bUsage = usage[b.key] || 0;
        if (bUsage !== aUsage) return bUsage - aUsage;
        return 0;
      }),
    }));
  }, [navSearch, usageTick]);

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
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.closest('button[role="search-clear"]')) return;
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

  const navList = (
    <nav className={`flex-1 overflow-y-auto py-4 space-y-4 ${sidebarCollapsed ? 'px-2' : 'px-3'}`}>
      {isSuperAdmin ? (
        <div>
          {!sidebarCollapsed && <div className={`px-3 mb-1 text-[10px] font-semibold tracking-widest uppercase ${sidebarDark ? 'text-white/40' : 'text-neutral-400'}`}>Plateforme</div>}
          <button
            onClick={() => { onRoute('platform_admin'); setMobileOpen(false); }}
            className={`nav-item ${route === 'platform_admin' ? (sidebarDark ? 'bg-white/15 text-white' : 'nav-item-active') : (sidebarDark ? 'text-white/70 hover:bg-white/8 hover:text-white' : 'nav-item-idle')} ${sidebarCollapsed ? 'justify-center px-0' : ''}`}
            title={sidebarCollapsed ? t('nav.platform') : undefined}
          >
            <Crown className={`w-[17px] h-[17px] flex-shrink-0 ${route === 'platform_admin' ? 'text-white' : (sidebarDark ? 'text-white/50' : 'text-neutral-400')}`} />
            {!sidebarCollapsed && <span>{t('nav.platform')}</span>}
          </button>
        </div>
      ) : (
      <>
      {!sidebarCollapsed && (
        <div className="px-1 mb-1">
          {searchExpanded ? (
            <div className="relative flex items-center">
              <Search className={`absolute left-1 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${sidebarDark ? 'text-white/40' : 'text-neutral-400'}`} />
              <input
                ref={navSearchRef}
                autoFocus
                type="text"
                value={navSearch}
                onChange={e => setNavSearch(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => { setTimeout(() => setSearchFocused(false), 150); if (!navSearch) setSearchExpanded(false); }}
                placeholder={t('nav.search')}
                className={`w-full pl-7 pr-6 py-1.5 text-[13px] outline-none bg-transparent border-0 transition-colors ${sidebarDark ? 'text-white placeholder:text-white/50' : 'text-neutral-700 placeholder-neutral-400'}`}
              />
              {navSearch ? (
                <button onClick={() => { setNavSearch(''); navSearchRef.current?.focus(); }} className={`absolute right-1 top-1/2 -translate-y-1/2 ${sidebarDark ? 'text-white/40 hover:text-white/70' : 'text-neutral-400 hover:text-neutral-600'}`}>
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button onClick={() => setSearchExpanded(false)} className={`absolute right-1 top-1/2 -translate-y-1/2 ${sidebarDark ? 'text-white/40 hover:text-white/70' : 'text-neutral-400 hover:text-neutral-600'}`}>
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={() => { setSearchExpanded(true); setTimeout(() => navSearchRef.current?.focus(), 10); }}
              className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${sidebarDark ? 'text-white/50 hover:bg-white/8 hover:text-white/80' : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700'}`}
              title={t('nav.search')}
            >
              <Search className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
      {navSearch.trim() && searchResults.length > 0 && (
        <div className="space-y-0.5 px-1">
          {!sidebarCollapsed && <div className={`px-2 mb-1 text-[10px] font-semibold tracking-widest uppercase ${sidebarDark ? 'text-white/40' : 'text-neutral-400'}`}>{t('nav.searchResults')}</div>}
          {searchResults.map(item => {
            const Icon = item.icon;
            const active = route === item.key;
            return (
              <button
                key={item.key}
                onClick={() => { onRoute(item.key); setNavSearch(''); setMobileOpen(false); }}
                className={`nav-item ${active ? (sidebarDark ? 'bg-white/15 text-white' : 'nav-item-active') : (sidebarDark ? 'text-white/70 hover:bg-white/8 hover:text-white' : 'nav-item-idle')}`}
              >
                <Icon className={`w-[17px] h-[17px] flex-shrink-0 ${active ? 'text-white' : (sidebarDark ? 'text-white/50' : 'text-neutral-400')}`} />
                {!sidebarCollapsed && <span className="whitespace-nowrap">{t(item.labelKey)}</span>}
              </button>
            );
          })}
        </div>
      )}
      {navSearch.trim() && searchResults.length === 0 && !sidebarCollapsed && (
        <div className={`px-3 py-4 text-center text-[13px] ${sidebarDark ? 'text-white/40' : 'text-neutral-400'}`}>{t('nav.noResults')}</div>
      )}
      {!navSearch.trim() && sortedNav.map(group => (
        <div key={group.titleKey}>
          {!sidebarCollapsed && (
            <div className={`px-3 mb-1 text-[10px] font-semibold tracking-widest uppercase ${sidebarDark ? 'text-white/40' : 'text-neutral-400'}`}>
              {t(group.titleKey)}
            </div>
          )}
          <div className="space-y-0.5">
            {group.items.map(item => {
              const Icon = item.icon;
              const active = route === item.key;
              const badge = badgeFor(item.key);
              const hasChildren = !!(item as NavItem).children && (item as NavItem).children!.length > 0;
              const childActive = hasChildren && (item as NavItem).children!.some(c => c.key === route);
              return (
                <div key={item.key}>
                  <button
                    onClick={() => {
                      if (hasChildren) { setDesktopAcctOpen(o => !o); }
                      else { onRoute(item.key); setMobileOpen(false); }
                    }}
                    className={`nav-item ${(active || childActive) ? (sidebarDark ? 'bg-white/15 text-white' : 'nav-item-active') : (sidebarDark ? 'text-white/70 hover:bg-white/8 hover:text-white' : 'nav-item-idle')} ${sidebarCollapsed ? 'justify-center px-0' : ''}`}
                    title={sidebarCollapsed ? t(item.labelKey) : undefined}
                  >
                    <Icon className={`w-[17px] h-[17px] flex-shrink-0 ${(active || childActive) ? 'text-white' : (sidebarDark ? 'text-white/50' : 'text-neutral-400')}`} />
                    {!sidebarCollapsed && <span className="whitespace-normal break-words">{t(item.labelKey)}</span>}
                    {!sidebarCollapsed && hasChildren && (
                      <ChevronDown className={`ml-auto w-3.5 h-3.5 transition-transform ${desktopAcctOpen ? 'rotate-180' : ''} ${sidebarDark ? 'text-white/40' : 'text-neutral-400'}`} />
                    )}
                    {!sidebarCollapsed && !hasChildren && badge > 0 && (
                      <span className={`ml-auto min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full text-[10px] font-bold ${active ? 'bg-white text-neutral-900' : 'bg-red-500 text-white'}`}>{badge > 99 ? '99+' : badge}</span>
                    )}
                    {!sidebarCollapsed && !hasChildren && badge === 0 && active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-white/70" />}
                    {sidebarCollapsed && !hasChildren && badge > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center">{badge > 9 ? '9+' : badge}</span>
                    )}
                  </button>
                  {hasChildren && desktopAcctOpen && !sidebarCollapsed && (
                    <div className="ml-6 mt-0.5 space-y-0.5 animate-[fadeIn_0.15s_ease]">
                      {(item as NavItem).children!.filter(c => routeVisible(c.key)).map(child => {
                        const ChildIcon = child.icon;
                        const childActive2 = route === child.key;
                        return (
                          <button
                            key={child.key}
                            onClick={() => { onRoute(child.key); setMobileOpen(false); }}
                            className={`nav-item text-[13px] ${childActive2 ? (sidebarDark ? 'bg-white/15 text-white' : 'nav-item-active') : (sidebarDark ? 'text-white/60 hover:bg-white/8 hover:text-white' : 'nav-item-idle')}`}
                          >
                            <ChildIcon className={`w-[15px] h-[15px] flex-shrink-0 ${childActive2 ? 'text-white' : (sidebarDark ? 'text-white/40' : 'text-neutral-400')}`} />
                            <span className="whitespace-normal break-words">{t(child.labelKey)}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {routeVisible('settings') && (
        <div>
          {!sidebarCollapsed && <div className={`px-3 mb-1 text-[10px] font-semibold tracking-widest uppercase ${sidebarDark ? 'text-white/40' : 'text-neutral-400'}`}>{t('nav.system')}</div>}
          <button
            onClick={() => { onRoute('settings'); setMobileOpen(false); }}
            className={`nav-item ${route === 'settings' ? (sidebarDark ? 'bg-white/15 text-white' : 'nav-item-active') : (sidebarDark ? 'text-white/70 hover:bg-white/8 hover:text-white' : 'nav-item-idle')} ${sidebarCollapsed ? 'justify-center px-0' : ''}`}
            title={sidebarCollapsed ? t('nav.settings') : undefined}
          >
            <Settings className={`w-[17px] h-[17px] flex-shrink-0 ${route === 'settings' ? 'text-white' : (sidebarDark ? 'text-white/50' : 'text-neutral-400')}`} />
            {!sidebarCollapsed && <span className="whitespace-normal break-words">{t('nav.settings')}</span>}
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
        className={`${(isDashboard && !dashMenuOpen) || isPlatformAdmin ? 'hidden' : 'hidden lg:flex'} items-center h-14 border-b border-neutral-200 bg-white sticky top-0 z-30 flex-shrink-0`}
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
          {/* Desktop site selector dropdown */}
          {sites.length > 1 && (
            <div className="relative">
              <button
                onClick={() => setSiteOpen(!siteOpen)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50 transition-colors text-sm"
              >
                <Monitor className="w-3.5 h-3.5 text-neutral-500" />
                <span className="font-medium text-neutral-800 max-w-[160px] truncate">{currentSite?.name || 'Site'}</span>
                <ChevronDown className={`w-3.5 h-3.5 text-neutral-400 transition-transform ${siteOpen ? 'rotate-180' : ''}`} />
              </button>
              {siteOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setSiteOpen(false)} />
                  <div className="absolute right-0 top-full mt-1.5 w-60 bg-white rounded-xl shadow-elevated border border-neutral-200 py-1 z-50 max-h-80 overflow-y-auto">
                    <div className="px-3 py-1.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">Magasins</div>
                    {sites.map(s => {
                      const isActive = currentSite?.id === s.id;
                      const isDefault = profile?.default_site_id === s.id;
                      return (
                        <div
                          key={s.id}
                          className={`flex items-center gap-2 px-2.5 py-2 mx-1 rounded-lg cursor-pointer transition-colors ${isActive ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}
                          onClick={() => { if (isActive) { setSiteOpen(false); return; } setSiteConfirmPending(s); setSiteOpen(false); }}
                        >
                          <div className={`w-4.5 h-4.5 w-[18px] h-[18px] rounded border-2 flex items-center justify-center shrink-0 ${isActive ? 'border-neutral-900 bg-neutral-900' : 'border-neutral-300'}`}>
                            {isActive && <Check className="w-2.5 h-2.5 text-white" />}
                          </div>
                          <span className={`flex-1 text-sm truncate ${isActive ? 'font-semibold text-neutral-900' : 'text-neutral-600'}`}>{s.name}</span>
                          {isDefault && <Star className="w-3.5 h-3.5 text-neutral-900 shrink-0" fill="currentColor" />}
                          {!isDefault && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setDefaultSite(s); }}
                              className="shrink-0 p-0.5 rounded text-neutral-300 hover:text-neutral-700 transition-colors"
                              title="Definir comme defaut"
                            >
                              <Star className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
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
                  <div className="text-[12px] font-semibold text-neutral-900 whitespace-nowrap">{profile?.full_name || profile?.email}</div>
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
                      <Settings className="w-4 h-4 text-neutral-400" /> {t('nav.settings')}
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
      <aside
        className={`${(isDashboard && !dashMenuOpen) || isPlatformAdmin ? 'hidden' : 'hidden lg:flex'} flex-col flex-shrink-0 h-full border-r transition-all duration-300 ${sidebarCollapsed ? 'w-[64px]' : 'w-[240px]'} ${sidebarDark ? 'border-white/10' : 'border-neutral-200'}`}
        style={sidebarDark
          ? { background: 'linear-gradient(180deg, #0a0a0a 0%, #171717 40%, #262626 100%)' }
          : { background: '#ffffff' }
        }
      >
        {navList}
        <div className={`p-3 border-t space-y-2 ${sidebarDark ? 'border-white/10' : 'border-neutral-100'}`}>
          <button onClick={signOut} className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${sidebarCollapsed ? 'justify-center' : ''} ${sidebarDark ? 'text-white/50 hover:bg-white/8 hover:text-white/80' : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800'}`}>
            <LogOut className="w-4 h-4 flex-shrink-0" /> {!sidebarCollapsed && 'Déconnexion'}
          </button>
          <div className={`flex items-center ${sidebarCollapsed ? 'flex-col gap-1' : 'gap-1'}`}>
            <button
              onClick={() => setSidebarCollapsed(v => !v)}
              className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors justify-center ${sidebarDark ? 'text-white/40 hover:bg-white/8 hover:text-white/70' : 'text-neutral-400 hover:bg-neutral-50 hover:text-neutral-700'}`}
              title={sidebarCollapsed ? 'Ouvrir le menu' : 'Réduire le menu'}
            >
              {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            </button>
            <button
              onClick={toggleSidebarTheme}
              className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${sidebarDark ? 'text-white/40 hover:bg-white/8 hover:text-white/70' : 'text-neutral-400 hover:bg-neutral-50 hover:text-neutral-700'}`}
              title="Changer le thème du menu"
            >
              <Palette className="w-3.5 h-3.5" />
            </button>
          </div>
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
            <div
              className="float-sidebar-content"
              style={sidebarDark ? { background: 'linear-gradient(180deg, #0a0a0a 0%, #171717 40%, #262626 100%)', border: '1px solid rgba(255,255,255,0.08)' } : undefined}
            >
              <div className="flex items-center justify-between px-4 pt-4 pb-3">
                <div className="flex items-center min-w-0">
                  {tenant?.logo_url ? (
                    <img src={tenant.logo_url} alt={tenant.name} className="w-9 h-9 object-contain shrink-0" />
                  ) : (
                    <img src="/newlogo.png" alt="WAARWI" className={`h-7 w-auto max-w-[110px] object-contain shrink-0 ${sidebarDark ? 'brightness-0 invert' : ''}`} />
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={toggleSidebarTheme}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${sidebarDark ? 'text-white/40 hover:bg-white/10 hover:text-white/70' : 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600'}`}
                    title="Changer le thème"
                  >
                    <Palette className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => { onRoute('settings'); closeDrawer(); }} className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${sidebarDark ? 'text-white/60 hover:bg-white/10' : 'float-close-btn'}`}>
                    <Settings className="w-4 h-4" />
                  </button>
                  <LanguageSwitcher />
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-2.5 pb-1 space-y-1.5 scrollbar-hide">
                {isSuperAdmin && (
                  <div>
                    <div className={`px-2.5 mb-0.5 text-[9px] font-semibold tracking-widest uppercase ${sidebarDark ? 'text-white/40' : 'text-neutral-400'}`}>Plateforme</div>
                    <button
                      onClick={() => { onRoute('platform_admin'); closeDrawer(); }}
                      className={`float-nav-item-compact ${route === 'platform_admin' ? 'float-nav-item-active' : ''} ${sidebarDark && route !== 'platform_admin' ? 'float-nav-dark' : ''}`}
                    >
                      <Crown className={`w-4 h-4 shrink-0 ${route === 'platform_admin' ? 'text-white' : (sidebarDark ? 'text-white/50' : 'text-neutral-400')}`} />
                      <span className="truncate">{t('nav.platform')}</span>
                    </button>
                  </div>
                )}
                {!isSuperAdmin && (
                  <div className="px-1 mb-1">
                    {searchExpanded ? (
                      <div className="relative flex items-center">
                        <Search className={`absolute left-1 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${sidebarDark ? 'text-white/40' : 'text-neutral-400'}`} />
                        <input
                          ref={navSearchRef}
                          autoFocus
                          type="text"
                          value={navSearch}
                          onChange={e => setNavSearch(e.target.value)}
                          onBlur={() => { if (!navSearch) setSearchExpanded(false); }}
                          placeholder={t('nav.search')}
                          className={`w-full pl-7 pr-6 py-2 text-[13px] outline-none bg-transparent border-0 ${sidebarDark ? 'text-white placeholder:text-white/50' : 'text-neutral-700 placeholder-neutral-400'}`}
                        />
                        {navSearch ? (
                          <button onClick={() => { setNavSearch(''); navSearchRef.current?.focus(); }} className={`absolute right-1 top-1/2 -translate-y-1/2 ${sidebarDark ? 'text-white/40 hover:text-white/70' : 'text-neutral-400 hover:text-neutral-600'}`}>
                            <X className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button onClick={() => setSearchExpanded(false)} className={`absolute right-1 top-1/2 -translate-y-1/2 ${sidebarDark ? 'text-white/40 hover:text-white/70' : 'text-neutral-400 hover:text-neutral-600'}`}>
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => { setSearchExpanded(true); setTimeout(() => navSearchRef.current?.focus(), 10); }}
                        className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${sidebarDark ? 'text-white/50 hover:bg-white/8 hover:text-white/80' : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700'}`}
                        title={t('nav.search')}
                      >
                        <Search className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )}
                {navSearch.trim() && searchResults.length > 0 && (
                  <div className="space-y-0.5 px-1">
                    <div className={`px-2.5 mb-0.5 text-[9px] font-semibold tracking-widest uppercase ${sidebarDark ? 'text-white/40' : 'text-neutral-400'}`}>{t('nav.searchResults')}</div>
                    {searchResults.map(item => {
                      const Icon = item.icon;
                      const active = route === item.key;
                      return (
                        <button
                          key={item.key}
                          onClick={() => { onRoute(item.key); setNavSearch(''); closeDrawer(); }}
                          className={`float-nav-item-compact ${active ? 'float-nav-item-active' : ''} ${sidebarDark && !active ? 'float-nav-dark' : ''}`}
                        >
                          <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-white' : (sidebarDark ? 'text-white/50' : 'text-neutral-500')}`} />
                          <span className="truncate">{t(item.labelKey)}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {navSearch.trim() && searchResults.length === 0 && (
                  <div className={`px-3 py-4 text-center text-[13px] ${sidebarDark ? 'text-white/40' : 'text-neutral-400'}`}>{t('nav.noResults')}</div>
                )}
                {!isSuperAdmin && !navSearch.trim() && sortedNav.map(group => (
                  <div key={group.titleKey}>
                    <div className={`px-2.5 mb-0.5 text-[9px] font-semibold tracking-widest uppercase ${sidebarDark ? 'text-white/40' : 'text-neutral-400'}`}>
                      {t(group.titleKey)}
                    </div>
                    <div>
                      {group.items.map(item => {
                        const Icon = item.icon;
                        const active = route === item.key;
                        const badge = badgeFor(item.key);
                        const hasChildren = !!(item as NavItem).children && (item as NavItem).children!.length > 0;
                        const childActive = hasChildren && (item as NavItem).children!.some(c => c.key === route);
                        return (
                          <div key={item.key}>
                            <button
                              onClick={() => {
                                if (hasChildren) { setMobileAcctOpen(o => o === item.key ? null : item.key); }
                                else { onRoute(item.key); closeDrawer(); }
                              }}
                              className={`float-nav-item-compact ${(active || childActive) ? 'float-nav-item-active' : ''} ${sidebarDark && !active && !childActive ? 'float-nav-dark' : ''}`}
                            >
                              <Icon className={`w-4 h-4 shrink-0 ${(active || childActive) ? 'text-white' : (sidebarDark ? 'text-white/50' : 'text-neutral-500')}`} />
                              <span className="truncate">{t(item.labelKey)}</span>
                              {hasChildren && (
                                <ChevronDown className={`ml-auto w-3.5 h-3.5 transition-transform ${mobileAcctOpen === item.key ? 'rotate-180' : ''} ${sidebarDark ? 'text-white/40' : 'text-neutral-400'}`} />
                              )}
                              {!hasChildren && badge > 0 && (
                                <span className="ml-auto min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full text-[10px] font-bold bg-red-500 text-white">{badge > 99 ? '99+' : badge}</span>
                              )}
                              {!hasChildren && badge === 0 && active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-white" />}
                            </button>
                            {hasChildren && mobileAcctOpen === item.key && (
                              <div className="ml-5 mt-0.5 space-y-0.5 animate-[fadeIn_0.15s_ease]">
                                {(item as NavItem).children!.filter(c => routeVisible(c.key)).map(child => {
                                  const ChildIcon = child.icon;
                                  const childActive2 = route === child.key;
                                  return (
                                    <button
                                      key={child.key}
                                      onClick={() => { onRoute(child.key); closeDrawer(); }}
                                      className={`float-nav-item-compact text-[13px] ${childActive2 ? 'float-nav-item-active' : ''} ${sidebarDark && !childActive2 ? 'float-nav-dark' : ''}`}
                                    >
                                      <ChildIcon className={`w-3.5 h-3.5 shrink-0 ${childActive2 ? 'text-white' : (sidebarDark ? 'text-white/40' : 'text-neutral-400')}`} />
                                      <span className="truncate">{t(child.labelKey)}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className={`px-3 pt-2 pb-2.5 border-t space-y-1.5 ${sidebarDark ? 'border-white/10' : 'border-neutral-100'}`} style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))' }}>
                {sites.length > 0 && (
                  <div>
                    <div className={`px-1 mb-1 text-[9px] font-semibold tracking-widest uppercase ${sidebarDark ? 'text-white/40' : 'text-neutral-400'}`}>Point de vente</div>
                    <div className="max-h-28 overflow-auto space-y-0.5">
                      {sites.map(s => {
                        const isDefault = (profile as any)?.default_site_id === s.id;
                        return (
                          <div key={s.id} className={`flex items-center gap-1 rounded-lg transition-colors ${currentSite?.id === s.id ? (sidebarDark ? 'bg-white/10' : 'bg-neutral-100') : (sidebarDark ? 'hover:bg-white/6' : 'hover:bg-neutral-50')}`}>
                            <button
                              onClick={() => { if (s.id === currentSite?.id) { closeDrawer(); return; } setSiteConfirmPending(s); closeDrawer(); }}
                              className={`flex-1 flex items-center gap-2 px-2.5 py-1.5 text-[12px] font-medium transition-colors ${currentSite?.id === s.id ? (sidebarDark ? 'text-white font-semibold' : 'text-neutral-900 font-semibold') : (sidebarDark ? 'text-white/70' : 'text-neutral-600')}`}
                            >
                              <Store className={`w-3.5 h-3.5 ${currentSite?.id === s.id ? (sidebarDark ? 'text-white' : 'text-neutral-900') : (sidebarDark ? 'text-white/40' : 'text-neutral-400')}`} />
                              <span className="truncate flex-1 text-left">{s.name}</span>
                            </button>
                            <button
                              onClick={() => { setDefaultSite(s); closeDrawer(); }}
                              title={isDefault ? 'Défaut' : 'Définir défaut'}
                              className={`shrink-0 p-1.5 transition-colors ${isDefault ? (sidebarDark ? 'text-white' : 'text-neutral-900') : (sidebarDark ? 'text-white/30 hover:text-white/60' : 'text-neutral-300 hover:text-neutral-600')}`}
                            >
                              <Star className="w-3 h-3" fill={isDefault ? 'currentColor' : 'none'} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <button onClick={signOut} className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${sidebarDark ? 'text-red-400 hover:bg-red-500/10' : 'text-red-600 hover:bg-red-50'}`}>
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
        {!isPlatformAdmin && (
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
        )}

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
          className={`${isPlatformAdmin ? 'hidden' : 'lg:hidden'} sticky top-0 z-30 flex items-center border-b border-neutral-200 bg-white`}
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

        {/* Desktop breadcrumb bar */}
        {!isPOS && !isPlatformAdmin && !isSuperAdmin && BREADCRUMB_MAP[route] && (
          <div className="hidden lg:flex items-center gap-1.5 px-8 pt-3 pb-0 text-[12px] text-neutral-500">
            <span>{t(BREADCRUMB_MAP[route].group)}</span>
            <ChevronRight className="w-3 h-3 text-neutral-300" />
            <span className="font-medium text-neutral-700">{t(BREADCRUMB_MAP[route].labelKey)}</span>
          </div>
        )}

        <main className={`flex-1 w-full min-h-0 ${isPOS ? 'flex flex-col max-w-none p-0 overflow-hidden' : (isDashboard && !dashMenuOpen) || isPlatformAdmin ? 'flex flex-col max-w-none p-0 overflow-y-auto overflow-x-hidden overscroll-none scrollbar-hide' : 'overflow-y-auto overflow-x-hidden scrollbar-hide'}`}>
          {isPOS ? (
            <div className="flex-1 flex flex-col min-h-0 pb-[60px] lg:pb-0">{children}</div>
          ) : isPlatformAdmin ? (
            <div className="flex-1 min-h-0">{children}</div>
          ) : (isDashboard && !dashMenuOpen) ? (
            <div className="flex-1 min-h-0 px-2 sm:px-3 lg:px-0 pt-3 lg:pt-0 pb-[100px] lg:pb-0">{children}</div>
          ) : (
            <div className="w-full max-w-[1600px] mx-auto px-3 sm:px-5 lg:px-8 pt-3 sm:pt-4 lg:pt-6 pb-[72px] lg:pb-8">{children}</div>
          )}
        </main>

        {/* Bottom nav */}
        {!isPlatformAdmin && (
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 pointer-events-none" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="pointer-events-auto">
            <div className="relative flex items-center justify-around h-[52px] bg-neutral-900 border-t border-neutral-800">
              {(() => {
                const tabs = isSuperAdmin ? [{ key: 'platform_admin' as Route, labelKey: 'nav.platform', icon: Crown }] : visibleMobileTabs;
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
                          <span className={`text-[8px] font-medium leading-none ${active ? 'text-white' : 'text-neutral-500'}`}>{t(tab.labelKey)}</span>
                          {active && <span className="absolute bottom-[5px] left-1/2 -translate-x-1/2 w-3 h-[1.5px] rounded-full bg-white" />}
                        </button>
                      );
                    })}
                    <div className="w-[72px] shrink-0" />
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
                          <span className={`text-[8px] font-medium leading-none ${active ? 'text-white' : 'text-neutral-500'}`}>{t(tab.labelKey)}</span>
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
        )}

        {/* FAB overlay */}
        {fabOpen && (
          <div className="lg:hidden fixed inset-0 z-[42] bg-black/30 backdrop-blur-sm" onClick={() => setFabOpen(false)} />
        )}

        {/* FAB actions panel */}
        {fabOpen && (
          <div className="lg:hidden fixed inset-x-0 z-[44] flex justify-center px-3 animate-scale-in" style={{ bottom: 'calc(max(6px, env(safe-area-inset-bottom)) + 68px)' }}>
            <div className="w-full max-w-[320px] rounded-xl overflow-hidden bg-white border border-neutral-200 shadow-premium">
              <div className="px-4 pt-3 pb-2 border-b border-neutral-100">
                <div className="text-[12px] font-bold text-neutral-900">{t('quickAction.title')}</div>
              </div>
              <div className="p-1.5 space-y-0.5">
                {[
                  { icon: CreditCard, labelKey: 'quickAction.encaisser', descKey: 'quickAction.encaisserDesc', route: 'tiers' as Route },
                  { icon: Wallet, labelKey: 'quickAction.acompte', descKey: 'quickAction.acompteDesc', route: 'tiers' as Route },
                  { icon: Receipt, labelKey: 'quickAction.reprint', descKey: 'quickAction.reprintDesc', route: 'sales' as Route },
                  { icon: ShoppingCart, labelKey: 'quickAction.quickSale', descKey: 'quickAction.quickSaleDesc', route: 'pos' as Route },
                  { icon: Package, labelKey: 'quickAction.stockIn', descKey: 'quickAction.stockInDesc', route: 'stock' as Route },
                  { icon: FileText, labelKey: 'quickAction.newQuote', descKey: 'quickAction.newQuoteDesc', route: 'billing' as Route },
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
                        <div className="text-[12px] font-semibold text-neutral-900">{t(a.labelKey)}</div>
                        <div className="text-[10px] text-neutral-400">{t(a.descKey)}</div>
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
        {!isPlatformAdmin && (route === 'pos' ? (
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
        ))}
      </div>
      </div>

      {/* Site switch confirmation modal */}
      {siteConfirmPending && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={() => setSiteConfirmPending(null)} />
          <div className="relative bg-white rounded-2xl shadow-premium border border-neutral-200 w-[90vw] max-w-[340px] overflow-hidden animate-scale-in">
            <div className="px-5 pt-5 pb-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-lg bg-neutral-100 flex items-center justify-center">
                  <Monitor className="w-4.5 h-4.5 text-neutral-700" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-neutral-900">Changer de magasin</h3>
                  <p className="text-[11px] text-neutral-400">Confirmer la bascule</p>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-neutral-50 border border-neutral-100">
                  <div className="w-2 h-2 rounded-full bg-neutral-300" />
                  <span className="text-xs text-neutral-500 flex-1">Actuel</span>
                  <span className="text-xs font-medium text-neutral-700">{currentSite?.name}</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-800">
                  <div className="w-2 h-2 rounded-full bg-white" />
                  <span className="text-xs text-neutral-400 flex-1">Nouveau</span>
                  <span className="text-xs font-semibold text-white">{siteConfirmPending.name}</span>
                </div>
              </div>
            </div>
            <div className="flex border-t border-neutral-100">
              <button
                onClick={() => setSiteConfirmPending(null)}
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-3 text-xs font-medium text-neutral-500 hover:bg-neutral-50 transition-colors border-r border-neutral-100"
              >
                <X className="w-3.5 h-3.5" />
                Annuler
              </button>
              <button
                onClick={() => { setCurrentSite(siteConfirmPending); setSiteConfirmPending(null); }}
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-3 text-xs font-semibold text-neutral-900 hover:bg-neutral-50 transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
