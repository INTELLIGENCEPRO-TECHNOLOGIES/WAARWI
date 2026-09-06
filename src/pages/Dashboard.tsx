import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { usePermissions } from '../lib/permissions';
import { formatFCFA, formatCompactFCFA, formatDateTime } from '../lib/format';
import { setNavContext, type NavContext } from '../lib/navHighlight';
import { Modal } from '../components/Modal';
import { desktopAutoFocus } from '../lib/device';
import {
  TrendingUp, TrendingDown, AlertTriangle, Package, Loader2,
  Users, FileText, ExternalLink, Globe,
  ShoppingCart, ChevronRight, Bell, Calendar,
  CheckCircle, Clock, Receipt, Wallet, ArrowUpRight, ArrowDownRight,
  ArrowUpLeft, CreditCard, Truck, Activity, Eye, EyeOff, X,
  Share2, Copy, Check as CheckIcon, MessageCircle, RefreshCw,
  ClipboardList, Coins, RotateCcw,
  ArrowDownCircle, ArrowUpCircle, ArrowRightLeft, BarChart3, Store,
  Network, Award, Menu, ChevronDown, Monitor, LogOut,
  LayoutDashboard,
} from 'lucide-react';

type ShopInfo = { slug: string | null; isActive: boolean };

type ActivityItem = {
  id: string;
  type: 'sale' | 'quote' | 'supplier_order' | 'payment_received' | 'online_order' | 'stock_movement' | 'return' | 'expense';
  title: string;
  detail: string;
  amount: number | null;
  amountType: 'positive' | 'negative' | 'neutral';
  time: string;
  route: string;
  routeCtx?: NavContext;
  siteName?: string;
  userName?: string;
  highlightId?: string;
};

type AlertItem = {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  time: string | null;
  route: string;
  routeCtx?: NavContext;
};

type OrderDetail = {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  status: string;
  deliveryMode: string;
  deliveryAddress: string;
  total: number;
  createdAt: string;
  items: Array<{ name: string; qty: number; price: number }>;
};

type Stats = {
  todaySales: number;
  todayCollected: number;
  todayDirectCash: number;
  todayCount: number;
  todayPaid: number;
  todayReceivable: number;
  yesterdaySales: number;
  monthSales: number;
  monthMargin: number;
  monthTauxMarge: number;
  cashBalance: number;
  sessionExpenses: number;
  sessionCashIn: number;
  sessionInfo: { id: string; openedAt: string; openingAmount: number } | null;
  receivables: number;
  payables: number;
  articlesCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  customersCount: number;
  suppliersCount: number;
  customersToChase: number;
  suppliersToChase: number;
  pendingQuotes: number;
  pendingReturns: number;
  stockInToday: number;
  stockOutToday: number;
  stockValue: number;
  todayMargin: number;
  periodTauxMarge: number;
  periodCaNet: number;
  periodMargeBrute: number;
  periodNbVentes: number;
  periodNbRetours: number;
  periodRetours: number;
  periodCharges: number;
  periodResultat: number;
  periodExpenses: number;
  periodRefunds: number;
  periodWithdrawals: number;
  periodCustomerLoans: number;
  periodCashBalance: number;
  // Session financial data (from RPC)
  sessionCaNet: number;
  sessionMargeBrute: number;
  sessionTauxMarge: number;
  sessionNbVentes: number;
  sessionNbRetours: number;
  sessionRetours: number;
  sessionDepenses: number;
  sessionRemboursements: number;
  sessionRetraits: number;
  sessionPretsClients: number;
  sessionEntreesDirectes: number;
  sessionEncaissements: number;
  sessionCreditTotal: number;
  sessionCreditOutstanding: number;
  sessionCreditCount: number;
  sessionResultat: number;
  sessionOpenedBy: string;
  articlesInStockCount: number;
  recentSales: Array<{
    id: string; sale_number: string; total: number; created_at: string;
    customers: { name: string } | null;
    sale_payments?: Array<{ method_name?: string | null }>;
  }>;
  recentActivities: ActivityItem[];
  alerts: AlertItem[];
  activeOrders: OrderDetail[];
  webNew: number;
  webPrep: number;
  webReady: number;
  webTodayCount: number;
  webTodayTotal: number;
  webAvgWait: number;
  lastWebOrder: { order_number: string; customer_name: string | null; total: number; created_at: string } | null;
  hourlySales: number[];
  weeklySales: { day: string; total: number }[];
  weekTotal: number;
};

const dashCache: { stats: Stats | null; shopInfo: ShopInfo | null; key: string; ts: number } = { stats: null, shopInfo: null, key: '', ts: 0 };

export function Dashboard({ onNavigate }: { onNavigate?: (route: string) => void }) {
  const { tenant, profile, currentSite, onDataChange } = useApp();
  const { error: toastError } = useToast();
  const cacheKey = `${tenant?.id}:${currentSite?.id}`;
  const hasCached = dashCache.key === cacheKey && dashCache.stats !== null;
  const [stats, setStats] = useState<Stats | null>(hasCached ? dashCache.stats : null);
  const [loading, setLoading] = useState(!hasCached);
  const [shopInfo, setShopInfo] = useState<ShopInfo | null>(hasCached ? dashCache.shopInfo : null);
  const [refreshTick, setRefreshTick] = useState(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!tenant) return;
    const unsub = onDataChange(
      ['sales', 'sale_payments', 'cash_movements', 'cash_sessions', 'customers', 'suppliers', 'articles', 'stock_levels', 'quotes', 'sale_returns', 'online_orders', 'supplier_orders'],
      () => {
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => setRefreshTick(t => t + 1), 150);
      }
    );
    return () => { unsub(); if (refreshTimer.current) clearTimeout(refreshTimer.current); };
  }, [tenant?.id, onDataChange]);
  const [balanceHidden, setBalanceHidden] = useState(() => {
    try { return localStorage.getItem('dashboardBalanceHidden') === '1'; } catch { return false; }
  });
  const toggleBalanceHidden = () => {
    setBalanceHidden(prev => {
      const next = !prev;
      try { localStorage.setItem('dashboardBalanceHidden', next ? '1' : '0'); } catch {}
      return next;
    });
  };
  const [heroLight, setHeroLight] = useState(() => {
    try { return localStorage.getItem('dashboard_hero_light') === '1'; } catch { return false; }
  });
  const toggleHeroTheme = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !heroLight;
    setHeroLight(next);
    try { localStorage.setItem('dashboard_hero_light', next ? '1' : '0'); } catch {}
  };
  const { can } = usePermissions();

  const [period, setPeriod] = useState<string>('today');
  const [showPeriodMenu, setShowPeriodMenu] = useState(false);
  const periodOptions = [
    { value: 'today', label: `Aujourd'hui, ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}` },
    { value: 'yesterday', label: 'Hier' },
    { value: 'this_week', label: 'Cette semaine' },
    { value: 'last_week', label: 'Semaine dernière' },
    { value: 'this_month', label: 'Ce mois' },
    { value: 'last_month', label: 'Mois dernier' },
  ];
  const periodLabel = periodOptions.find(o => o.value === period)?.label || 'Aujourd\'hui';

  const [viewMode, setViewMode] = useState<'period' | 'session'>(() => {
    try { return (localStorage.getItem('dashboard_view_mode') as 'period' | 'session') || 'period'; } catch { return 'period'; }
  });
  const toggleViewMode = (mode: 'period' | 'session') => {
    setViewMode(mode);
    try { localStorage.setItem('dashboard_view_mode', mode); } catch {}
  };

  useEffect(() => {
    if (!tenant || !currentSite) return;
    const sharedSuppliers = (tenant as any)?.settings?.shared_suppliers !== false;
    const sharedArticles = (tenant as any)?.settings?.shared_articles !== false;
    let cancelled = false;
    (async () => {
      const now = new Date();
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const yest = new Date(today); yest.setDate(yest.getDate() - 1);

      let periodStart: Date;
      let periodEnd: Date | null;
      if (period === 'yesterday') {
        periodStart = yest;
        periodEnd = today;
      } else if (period === 'this_week') {
        periodStart = new Date(today);
        const dow = periodStart.getDay();
        periodStart.setDate(periodStart.getDate() - (dow === 0 ? 6 : dow - 1));
        periodEnd = null;
      } else if (period === 'last_week') {
        periodStart = new Date(today);
        const dow = periodStart.getDay();
        periodStart.setDate(periodStart.getDate() - (dow === 0 ? 6 : dow - 1) - 7);
        periodEnd = new Date(periodStart);
        periodEnd.setDate(periodEnd.getDate() + 7);
      } else if (period === 'this_month') {
        periodStart = new Date(today.getFullYear(), today.getMonth(), 1);
        periodEnd = null;
      } else if (period === 'last_month') {
        periodStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        periodEnd = new Date(today.getFullYear(), today.getMonth(), 1);
      } else {
        periodStart = today;
        periodEnd = null;
      }

      const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const siteId = currentSite.id;

      const periodQuery = supabase.from('sales').select('total, paid, status, created_at').eq('tenant_id', tenant.id).eq('site_id', siteId).gte('created_at', periodStart.toISOString()).neq('status', 'cancelled');
      if (periodEnd) periodQuery.lt('created_at', periodEnd.toISOString());

      const periodFromDate = periodStart.toISOString().slice(0, 10);
      const periodToDate = periodEnd ? new Date(periodEnd.getTime() - 1).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
      const yestDate = yest.toISOString().slice(0, 10);

      const [
        todayData, _yestRpc, _monthRpc, _periodRpc, articlesCount, trackedArticlesCount, recent,
        custData, suppData, quotesData, returnsData, shopData,
        webNewData, webPrepData, webReadyData, webTodayData, webWaitData, lastWebOrderData,
        openSessions, stockInTodayData,
      ] = await Promise.all([
        periodQuery,
        supabase.rpc('get_financial_summary', { p_site_id: siteId, p_from: yestDate, p_to: yestDate }),
        supabase.rpc('get_financial_summary', { p_site_id: siteId, p_from: firstOfMonth.toISOString().slice(0, 10), p_to: new Date().toISOString().slice(0, 10) }),
        supabase.rpc('get_financial_summary', { p_site_id: siteId, p_from: periodFromDate, p_to: periodToDate }),
        sharedArticles
          ? supabase.from('articles').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('is_active', true)
          : supabase.from('articles').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('site_id', siteId).eq('is_active', true),
        sharedArticles
          ? supabase.from('articles').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('is_active', true).eq('track_stock', true)
          : supabase.from('articles').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('site_id', siteId).eq('is_active', true).eq('track_stock', true),
        supabase.from('sales').select('id, sale_number, total, created_at, customers(name), sale_payments(method_name)').eq('tenant_id', tenant.id).eq('site_id', siteId).neq('status', 'cancelled').order('created_at', { ascending: false }).limit(5),
        supabase.from('customers').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('is_active', true),
        sharedSuppliers
          ? supabase.from('suppliers').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('is_active', true)
          : supabase.from('suppliers').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('site_id', siteId).eq('is_active', true),
        supabase.from('quotes').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('site_id', siteId).in('status', ['draft', 'sent']),
        supabase.from('sale_returns').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('site_id', siteId).eq('status', 'pending'),
        supabase.from('tenants').select('public_slug').eq('id', tenant.id).maybeSingle(),
        supabase.from('online_orders').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('status', 'nouvelle'),
        supabase.from('online_orders').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('status', 'en_preparation'),
        supabase.from('online_orders').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('status', 'prete'),
        supabase.from('online_orders').select('total').eq('tenant_id', tenant.id).gte('created_at', periodStart.toISOString()).neq('status', 'annulee'),
        supabase.from('online_orders').select('created_at').eq('tenant_id', tenant.id).eq('status', 'nouvelle').order('created_at', { ascending: true }).limit(1),
        supabase.from('online_orders').select('order_number, customer_name, total, created_at').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('cash_sessions').select('id, opening_amount, theoretical_amount, counted_cash, opened_at, user_id').eq('tenant_id', tenant.id).eq('site_id', siteId).eq('status', 'open'),
        supabase.from('stock_movements').select('quantity').eq('tenant_id', tenant.id).eq('site_id', siteId).in('movement_type', ['purchase', 'adjustment_in']).gte('created_at', periodStart.toISOString()),
      ]);

      // Paginate stock_levels to bypass server-side 1000-row cap
      let allStockRows: any[] = [];
      let stkFrom = 0;
      while (true) {
        const { data, error: stkErr } = await supabase
          .from('stock_levels')
          .select('quantity, articles!inner(stock_min, purchase_price, track_stock, category_id)')
          .eq('tenant_id', tenant.id)
          .eq('site_id', siteId)
          .eq('articles.track_stock', true)
          .range(stkFrom, stkFrom + 999);
        if (stkErr || !data || data.length === 0) break;
        allStockRows = allStockRows.concat(data);
        if (data.length < 1000) break;
        stkFrom += 1000;
      }

      let newShopInfo: ShopInfo;
      if (shopData.data?.public_slug) {
        const { data: ss } = await supabase.from('shop_settings').select('is_active').eq('tenant_id', tenant.id).maybeSingle();
        newShopInfo = { slug: shopData.data.public_slug, isActive: ss?.is_active ?? false };
      } else {
        newShopInfo = { slug: null, isActive: false };
      }

      const yestRpc = (_yestRpc.data || {}) as any;
      const monthRpc = (_monthRpc.data || {}) as any;
      const periodRpc = (_periodRpc.data || {}) as any;

      const todaySales = Number(periodRpc.ca_net || 0);
      const todayPaid = (todayData.data || []).reduce((s: number, r: any) => s + Math.min(Number(r.total || 0), Number(r.paid || 0)), 0);
      const todayReceivable = Math.max(0, (todayData.data || []).reduce((s: number, r: any) => s + Number(r.total || 0), 0) - todayPaid);

      const periodEndIso = periodEnd ? periodEnd.toISOString() : null;
      const periodPaymentsQuery = supabase.from('sale_payments').select('amount, sales!inner(site_id)').eq('tenant_id', tenant.id).eq('sales.site_id', siteId).gte('created_at', periodStart.toISOString());
      if (periodEndIso) periodPaymentsQuery.lt('created_at', periodEndIso);
      const periodMovsQuery = supabase.from('cash_movements').select('kind, amount, reason').eq('tenant_id', tenant.id).eq('site_id', siteId).gte('created_at', periodStart.toISOString());
      if (periodEndIso) periodMovsQuery.lt('created_at', periodEndIso);
      const [{ data: periodPayments }, { data: periodMovs }] = await Promise.all([periodPaymentsQuery, periodMovsQuery]);
      const todayPaymentsTotal = (periodPayments || []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
      const todayMovIncome = (periodMovs || [])
        .filter((m: any) => m.kind !== 'expense' && m.kind !== 'refund' && m.kind !== 'withdrawal' && m.kind !== 'customer_loan' && m.kind !== 'vault_withdrawal' && m.kind !== 'vault_deposit' && !(m.kind === 'income' && typeof m.reason === 'string' && m.reason.startsWith('Règlement ') && !m.reason.startsWith('Règlement solde')))
        .reduce((s: number, m: any) => s + Number(m.amount || 0), 0);
      const todayCollected = todayPaymentsTotal + todayMovIncome;
      const periodExpenses = (periodMovs || []).filter((m: any) => m.kind === 'expense').reduce((s: number, m: any) => s + Number(m.amount || 0), 0);
      const periodRefunds = (periodMovs || []).filter((m: any) => m.kind === 'refund').reduce((s: number, m: any) => s + Number(m.amount || 0), 0);
      const periodWithdrawals = (periodMovs || []).filter((m: any) => m.kind === 'withdrawal').reduce((s: number, m: any) => s + Number(m.amount || 0), 0);
      const periodCustomerLoans = (periodMovs || []).filter((m: any) => m.kind === 'customer_loan').reduce((s: number, m: any) => s + Number(m.amount || 0), 0);
      const periodVaultIn = (periodMovs || []).filter((m: any) => m.kind === 'vault_withdrawal').reduce((s: number, m: any) => s + Number(m.amount || 0), 0);
      const periodVaultOut = (periodMovs || []).filter((m: any) => m.kind === 'vault_deposit').reduce((s: number, m: any) => s + Number(m.amount || 0), 0);
      const periodCashBalance = todayCollected + periodVaultIn - periodExpenses - periodRefunds - periodWithdrawals - periodCustomerLoans - periodVaultOut;
      const todayMargin = Number(periodRpc.marge_brute || 0);
      const yesterdaySales = Number(yestRpc.ca_net || 0);
      const monthSales = Number(monthRpc.ca_net || 0);
      const monthMargin = Number(monthRpc.marge_brute || 0);

      const stockRows = allStockRows;
      const siteArticlesTotal = trackedArticlesCount.count || 0;
      const low = stockRows.filter((r: any) => Number(r.quantity) > 0 && Number(r.articles?.stock_min || 0) > 0 && Number(r.quantity) <= Number(r.articles.stock_min)).length;
      const outInLevels = stockRows.filter((r: any) => Number(r.quantity) <= 0).length;
      const articlesInStockCount = stockRows.filter((r: any) => Number(r.quantity) > 0).length;
      const articlesWithLevels = stockRows.length;
      const articlesWithoutLevels = Math.max(0, siteArticlesTotal - articlesWithLevels);
      const out = outInLevels + articlesWithoutLevels;
      const stockValue = stockRows.reduce((s: number, r: any) => s + (Number(r.quantity || 0) * Number(r.articles?.purchase_price || 0)), 0);

      const webTodayRows = (webTodayData.data || []) as any[];
      const webTodayTotal = webTodayRows.reduce((s, r) => s + Number(r.total || 0), 0);

      const unpaidOrdersQuery = supabase
        .from('supplier_orders')
        .select('total, paid, supplier_id')
        .eq('tenant_id', tenant.id)
        .neq('status', 'cancelled')
        .limit(5000);
      if (!sharedSuppliers) unpaidOrdersQuery.eq('site_id', siteId);
      const { data: unpaidOrders } = await unpaidOrdersQuery;
      const payables = (unpaidOrders || []).reduce((s: number, o: any) => {
        const remaining = Number(o.total || 0) - Number(o.paid || 0);
        return s + Math.max(0, remaining);
      }, 0);
      const payablesSupplierIds = new Set(
        (unpaidOrders || []).filter((o: any) => Number(o.total || 0) - Number(o.paid || 0) > 0).map((o: any) => o.supplier_id)
      );
      const payablesSupplierCount = payablesSupplierIds.size;

      const { data: unpaidSales } = await supabase
        .from('sales')
        .select('total, paid, customer_id')
        .eq('tenant_id', tenant.id)
        .eq('site_id', siteId)
        .not('customer_id', 'is', null)
        .neq('status', 'cancelled')
        .neq('status', 'paid')
        .limit(5000);
      const receivables = (unpaidSales || []).reduce((s: number, sale: any) => {
        const remaining = Number(sale.total || 0) - Number(sale.paid || 0);
        return s + Math.max(0, remaining);
      }, 0);
      const receivablesCustomerIds = new Set(
        (unpaidSales || []).filter((s: any) => Number(s.total || 0) - Number(s.paid || 0) > 0).map((s: any) => s.customer_id)
      );
      const customersToChaseCount = receivablesCustomerIds.size;

      const currentSession = (openSessions.data || []).length > 0
        ? (openSessions.data as any[]).sort((a: any, b: any) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime())[0]
        : null;

      let cashBalance = 0;
      let sessionMovIncome = 0;
      let sessionMovExpense = 0;
      let sessionInfo: Stats['sessionInfo'] = null;

      if (currentSession) {
        sessionInfo = {
          id: currentSession.id,
          openedAt: currentSession.opened_at,
          openingAmount: Number(currentSession.opening_amount || 0),
        };

        const { data: sessionPayments } = await supabase
          .from('sale_payments')
          .select('amount')
          .eq('tenant_id', tenant.id)
          .eq('cash_session_id', currentSession.id);
        const sessionPaymentsTotal = (sessionPayments || []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);

        const { data: sessionMovs } = await supabase
          .from('cash_movements')
          .select('kind, amount, reason')
          .eq('tenant_id', tenant.id)
          .eq('cash_session_id', currentSession.id);
        for (const m of (sessionMovs || []) as any[]) {
          if (m.kind === 'expense') sessionMovExpense += Number(m.amount || 0);
          else if (m.kind !== 'refund' && m.kind !== 'withdrawal' && m.kind !== 'customer_loan' && m.kind !== 'vault_withdrawal' && m.kind !== 'vault_deposit' && !(m.kind === 'income' && typeof m.reason === 'string' && m.reason.startsWith('Règlement ') && !m.reason.startsWith('Règlement solde'))) sessionMovIncome += Number(m.amount || 0);
        }
      }

      // Session financial summary via dedicated RPC
      let sessionFinancials: any = {};
      if (currentSession) {
        const { data: sfData } = await supabase.rpc('get_session_financial_summary', {
          p_cash_session_id: currentSession.id
        });
        sessionFinancials = sfData || {};
        
        // Fetch the user who opened the session
        const { data: sessionProfile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', currentSession.user_id || '')
          .maybeSingle();
        sessionFinancials._openedBy = sessionProfile?.full_name || '';
      }

      if (currentSession) {
        cashBalance = Number(currentSession.opening_amount || 0) + Number(sessionFinancials.encaissements || 0) + Number(sessionFinancials.entrees_directes || 0) - Number(sessionFinancials.depenses_session || 0) - Number(sessionFinancials.remboursements || 0) - Number(sessionFinancials.retraits || 0) - Number(sessionFinancials.prets_clients || 0);
      }

      const stockIn = (stockInTodayData.data || []).reduce((s: number, r: any) => s + Number(r.quantity || 0), 0);

      // Stock out for period
      const { data: stockOutTodayData2 } = await supabase
        .from('stock_movements')
        .select('quantity')
        .eq('tenant_id', tenant.id)
        .eq('site_id', siteId)
        .in('movement_type', ['sale', 'adjustment_out'])
        .gte('created_at', periodStart.toISOString());
      const stockOut = (stockOutTodayData2 || []).reduce((s: number, r: any) => s + Math.abs(Number(r.quantity || 0)), 0);

      // Hourly sales breakdown for intraday chart
      const hourlySales = new Array(24).fill(0);
      for (const sale of (todayData.data || []) as any[]) {
        const h = new Date(sale.created_at || today).getHours();
        hourlySales[h] += Number(sale.total || 0);
      }

      // Weekly sales (last 7 days)
      const weekStart = new Date(today);
      weekStart.setDate(weekStart.getDate() - 6);
      const { data: weekSalesRaw } = await supabase
        .from('sales')
        .select('total, created_at')
        .eq('tenant_id', tenant.id)
        .eq('site_id', siteId)
        .gte('created_at', weekStart.toISOString())
        .in('status', ['paid', 'partial', 'validated']);
      const dayNames = ['Dim.', 'Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.'];
      const weeklySales: { day: string; total: number }[] = [];
      let weekTotal = 0;
      for (let i = 0; i < 7; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - 6 + i);
        const dayStr = d.toISOString().slice(0, 10);
        const dayTotal = (weekSalesRaw || [])
          .filter((r: any) => (r.created_at || '').slice(0, 10) === dayStr)
          .reduce((s: number, r: any) => s + Number(r.total || 0), 0);
        weeklySales.push({ day: dayNames[d.getDay()], total: dayTotal });
        weekTotal += dayTotal;
      }

      const firstWaitRow = (webWaitData.data || [])[0];
      const avgWaitMin = firstWaitRow ? Math.max(0, Math.floor((Date.now() - new Date(firstWaitRow.created_at).getTime()) / 60000)) : 0;

      // Fetch recent activities from multiple sources for intelligent feed
      const [actSales, actQuotes, actSupOrders, actOnline, actReturns, actPayments, actMovements] = await Promise.all([
        supabase.from('sales').select('id, sale_number, total, created_at, status, site_id, user_id, customers(name), sale_payments(method_name)').eq('tenant_id', tenant.id).eq('site_id', siteId).order('created_at', { ascending: false }).limit(8),
        supabase.from('quotes').select('id, quote_number, total, created_at, status, site_id, user_id, customers(name)').eq('tenant_id', tenant.id).eq('site_id', siteId).order('created_at', { ascending: false }).limit(5),
        sharedSuppliers
          ? supabase.from('supplier_orders').select('id, order_number, total, created_at, status, site_id, user_id, suppliers(name)').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(5)
          : supabase.from('supplier_orders').select('id, order_number, total, created_at, status, site_id, user_id, suppliers(name)').eq('tenant_id', tenant.id).eq('site_id', siteId).order('created_at', { ascending: false }).limit(5),
        supabase.from('online_orders').select('id, order_number, total, created_at, status, customer_name').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(5),
        supabase.from('sale_returns').select('id, return_number, total, created_at, status, site_id, user_id, customers(name)').eq('tenant_id', tenant.id).eq('site_id', siteId).order('created_at', { ascending: false }).limit(3),
        supabase.from('sale_payments').select('id, amount, created_at, method_name, sales!inner(sale_number, site_id, user_id, customers(name))').eq('tenant_id', tenant.id).eq('sales.site_id', siteId).order('created_at', { ascending: false }).limit(5),
        supabase.from('cash_movements').select('id, kind, amount, note, created_at, site_id, user_id, customers(name)').eq('tenant_id', tenant.id).eq('site_id', siteId).in('kind', ['expense', 'refund', 'customer_loan', 'withdrawal', 'deposit', 'customer_prepayment']).order('created_at', { ascending: false }).limit(8),
      ]);

      // Batch-fetch profile names for all user_ids referenced in activities
      const activityUserIds = new Set<string>();
      for (const s of (actSales.data || []) as any[]) if (s.user_id) activityUserIds.add(s.user_id);
      for (const q of (actQuotes.data || []) as any[]) if (q.user_id) activityUserIds.add(q.user_id);
      for (const o of (actSupOrders.data || []) as any[]) if (o.user_id) activityUserIds.add(o.user_id);
      for (const r of (actReturns.data || []) as any[]) if (r.user_id) activityUserIds.add(r.user_id);
      for (const p of (actPayments.data || []) as any[]) if (p.sales?.user_id) activityUserIds.add(p.sales.user_id);
      for (const m of (actMovements.data || []) as any[]) if (m.user_id) activityUserIds.add(m.user_id);
      let activityProfileMap: Record<string, string> = {};
      if (activityUserIds.size > 0) {
        const { data: actProfiles } = await supabase.from('profiles').select('id, full_name').in('id', Array.from(activityUserIds));
        for (const p of (actProfiles || []) as any[]) activityProfileMap[p.id] = p.full_name || '';
      }
      const siteNameMap: Record<string, string> = {};
      for (const s of (tenant as any)?.sites || []) siteNameMap[s.id] = s.name;
      if (currentSite) siteNameMap[currentSite.id] = currentSite.name;
      const hasMultiSitesAct = ((tenant as any)?.sites?.length || 0) > 1;

      const activities: ActivityItem[] = [];

      for (const s of (actSales.data || []) as any[]) {
        const client = s.customers?.name || 'Client comptoir';
        const method = s.sale_payments?.[0]?.method_name || '';
        const statusLabel = s.status === 'paid' ? 'Payée' : s.status === 'partial' ? 'Partielle' : s.status === 'cancelled' ? 'Annulée' : 'Créée';
        activities.push({
          id: `sale-${s.id}`,
          type: 'sale',
          title: `Vente ${s.sale_number}`,
          detail: `${client}${method ? ' · ' + method : ''} · ${statusLabel}`,
          amount: Number(s.total),
          amountType: s.status === 'cancelled' ? 'negative' : 'positive',
          time: s.created_at,
          route: 'sales',
          siteName: hasMultiSitesAct ? (siteNameMap[s.site_id] || '') : '',
          userName: s.user_id ? (activityProfileMap[s.user_id] || '') : '',
          highlightId: s.id,
        });
      }

      for (const q of (actQuotes.data || []) as any[]) {
        const client = q.customers?.name || 'Client';
        const statusLabel = q.status === 'sent' ? 'Envoyé' : q.status === 'accepted' ? 'Accepté' : q.status === 'converted' ? 'Converti' : 'Brouillon';
        activities.push({
          id: `quote-${q.id}`,
          type: 'quote',
          title: `Devis ${q.quote_number}`,
          detail: `${client} · ${statusLabel}`,
          amount: Number(q.total),
          amountType: 'neutral',
          time: q.created_at,
          route: 'sales',
          siteName: hasMultiSitesAct ? (siteNameMap[q.site_id] || '') : '',
          userName: q.user_id ? (activityProfileMap[q.user_id] || '') : '',
          highlightId: q.id,
        });
      }

      for (const o of (actSupOrders.data || []) as any[]) {
        const supplier = o.suppliers?.name || 'Fournisseur';
        const statusLabel = o.status === 'delivered' ? 'Livrée' : o.status === 'sent' ? 'Envoyée' : o.status === 'partial' ? 'Partielle' : 'Brouillon';
        activities.push({
          id: `suporder-${o.id}`,
          type: 'supplier_order',
          title: `Commande ${o.order_number}`,
          detail: `${supplier} · ${statusLabel}`,
          amount: Number(o.total),
          amountType: 'negative',
          time: o.created_at,
          route: 'supplier_orders',
          siteName: hasMultiSitesAct ? (siteNameMap[o.site_id] || '') : '',
          userName: o.user_id ? (activityProfileMap[o.user_id] || '') : '',
          highlightId: o.id,
        });
      }

      for (const o of (actOnline.data || []) as any[]) {
        const client = o.customer_name || 'Client web';
        const statusLabel = o.status === 'nouvelle' ? 'Nouvelle' : o.status === 'en_preparation' ? 'En préparation' : o.status === 'prete' ? 'Prête' : o.status === 'livree' ? 'Livrée' : o.status;
        activities.push({
          id: `online-${o.id}`,
          type: 'online_order',
          title: `Commande en ligne ${o.order_number}`,
          detail: `${client} · ${statusLabel}`,
          amount: Number(o.total),
          amountType: 'positive',
          time: o.created_at,
          route: 'online_orders',
          highlightId: o.id,
        });
      }

      for (const r of (actReturns.data || []) as any[]) {
        const client = r.customers?.name || 'Client';
        activities.push({
          id: `return-${r.id}`,
          type: 'return',
          title: `Retour ${r.return_number || ''}`,
          detail: `${client} · ${r.status === 'pending' ? 'En attente' : 'Traité'}`,
          amount: Number(r.total || 0),
          amountType: 'negative',
          time: r.created_at,
          route: 'sales',
          siteName: hasMultiSitesAct ? (siteNameMap[r.site_id] || '') : '',
          userName: r.user_id ? (activityProfileMap[r.user_id] || '') : '',
          highlightId: r.id,
        });
      }

      for (const p of (actPayments.data || []) as any[]) {
        const saleRef = p.sales?.sale_number || '';
        const client = p.sales?.customers?.name || 'Client';
        activities.push({
          id: `payment-${p.id}`,
          type: 'payment_received',
          title: `Règlement ${saleRef}`,
          detail: `${client} · ${p.method_name || 'Espèces'}`,
          amount: Number(p.amount),
          amountType: 'positive',
          time: p.created_at,
          route: 'sales',
          siteName: hasMultiSitesAct ? (siteNameMap[p.sales?.site_id] || '') : '',
          userName: p.sales?.user_id ? (activityProfileMap[p.sales.user_id] || '') : '',
          highlightId: p.sales?.id || p.id,
        });
      }

      for (const m of (actMovements.data || []) as any[]) {
        const kindLabels: Record<string, string> = { expense: 'Sortie', refund: 'Remboursement', customer_loan: 'Prêt client', withdrawal: 'Retrait', deposit: 'Entrée', customer_prepayment: 'Acompte' };
        const label = kindLabels[m.kind] || m.kind;
        const client = m.customers?.name;
        activities.push({
          id: `movement-${m.id}`,
          type: m.kind === 'expense' ? 'expense' : m.kind === 'refund' ? 'return' : 'payment_received',
          title: label,
          detail: `${client ? client + ' · ' : ''}${m.note || ''}`.replace(/ · $/, '') || label,
          amount: Number(m.amount),
          amountType: (m.kind === 'deposit' || m.kind === 'customer_prepayment') ? 'positive' : 'negative',
          time: m.created_at,
          route: 'cash_history',
          siteName: hasMultiSitesAct ? (siteNameMap[m.site_id] || '') : '',
          userName: m.user_id ? (activityProfileMap[m.user_id] || '') : '',
          highlightId: m.id,
        });
      }

      activities.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
      const recentActivities = activities.slice(0, 15);

      // ── Intelligent Alerts ──
      const [alertStockOut, alertStockLow, alertAdjustments, alertModifiedSales] = await Promise.all([
        supabase.from('stock_levels').select('quantity, articles!inner(id, name, internal_ref, stock_min, track_stock, category_id)').eq('tenant_id', tenant.id).eq('site_id', siteId).eq('articles.track_stock', true).lte('quantity', 0).limit(10000),
        supabase.from('stock_levels').select('quantity, articles!inner(id, name, internal_ref, stock_min, track_stock, category_id)').eq('tenant_id', tenant.id).eq('site_id', siteId).eq('articles.track_stock', true).gt('quantity', 0).limit(10000),
        supabase.from('stock_movements').select('id, movement_type, quantity, note, created_at, articles(name)').eq('tenant_id', tenant.id).eq('site_id', siteId).in('movement_type', ['adjustment_in', 'adjustment_out']).order('created_at', { ascending: false }).limit(5),
        supabase.from('sales').select('id, sale_number, total, created_at, customers(name)').eq('tenant_id', tenant.id).eq('site_id', siteId).neq('status', 'cancelled').order('created_at', { ascending: false }).limit(10),
      ]);

      const alerts: AlertItem[] = [];

      const outItems = (alertStockOut.data || []).filter((r: any) => Number(r.articles?.stock_min || 0) > 0);
      for (const item of outItems.slice(0, 5) as any[]) {
        alerts.push({
          id: `rupture-${item.articles.id}`,
          severity: 'critical',
          title: `Rupture : ${item.articles.name}`,
          detail: `Réf. ${item.articles.internal_ref || '-'} · Stock: ${item.quantity}`,
          time: null,
          route: 'stock',
          routeCtx: { filter: 'rupture' },
        });
      }

      const lowItems = (alertStockLow.data || []).filter((r: any) => Number(r.articles?.stock_min || 0) > 0 && Number(r.quantity) <= Number(r.articles.stock_min));
      for (const item of lowItems.slice(0, 5) as any[]) {
        alerts.push({
          id: `low-${item.articles.id}`,
          severity: 'warning',
          title: `Stock bas : ${item.articles.name}`,
          detail: `Réf. ${item.articles.internal_ref || '-'} · Stock: ${item.quantity} / Min: ${item.articles.stock_min}`,
          time: null,
          route: 'stock',
          routeCtx: { filter: 'bas' },
        });
      }

      for (const adj of (alertAdjustments.data || []) as any[]) {
        const dir = adj.movement_type === 'adjustment_in' ? 'Entrée' : 'Sortie';
        alerts.push({
          id: `adj-${adj.id}`,
          severity: 'info',
          title: `Ajustement stock (${dir})`,
          detail: `${adj.articles?.name || 'Article'} · Qté: ${adj.quantity}${adj.note ? ' · ' + adj.note : ''}`,
          time: adj.created_at,
          route: 'stock',
        });
      }

      const modifiedSales = (alertModifiedSales.data || []).filter((s: any) => {
        return false;
      });
      for (const s of modifiedSales.slice(0, 3) as any[]) {
        alerts.push({
          id: `mod-sale-${s.id}`,
          severity: 'info',
          title: `Facture modifiée : ${s.sale_number}`,
          detail: `${s.customers?.name || 'Client'} · ${formatCompactFCFA(s.total)}`,
          time: s.created_at,
          route: 'sales',
        });
      }

      if (!currentSession) {
        alerts.push({
          id: 'no-session',
          severity: 'warning',
          title: 'Session caisse fermée',
          detail: 'Aucune session de caisse n\'est ouverte',
          time: null,
          route: 'pos',
        });
      }

      alerts.sort((a, b) => {
        const sev = { critical: 0, warning: 1, info: 2 };
        return sev[a.severity] - sev[b.severity];
      });

      // ── Active Orders with full details ──
      const { data: activeOrdersRaw } = await supabase
        .from('online_orders')
        .select('id, order_number, customer_name, customer_phone, status, delivery_mode, delivery_address, total, created_at, online_order_items(article_name, quantity, unit_price)')
        .eq('tenant_id', tenant.id)
        .in('status', ['nouvelle', 'en_preparation', 'prete'])
        .order('created_at', { ascending: false })
        .limit(10);

      const activeOrders: OrderDetail[] = ((activeOrdersRaw || []) as any[]).map((o) => ({
        id: o.id,
        orderNumber: o.order_number,
        customerName: o.customer_name || 'Client',
        customerPhone: o.customer_phone || '',
        status: o.status,
        deliveryMode: o.delivery_mode || 'retrait',
        deliveryAddress: o.delivery_address || '',
        total: Number(o.total),
        createdAt: o.created_at,
        items: (o.online_order_items || []).map((i: any) => ({
          name: i.article_name,
          qty: i.quantity,
          price: Number(i.unit_price),
        })),
      }));

      const next: Stats = {
        todaySales, todayCollected, todayDirectCash: todayMovIncome, todayCount: todayData.data?.length || 0,
        todayPaid, todayReceivable,
        yesterdaySales,
        monthSales, monthMargin,
        monthTauxMarge: Number(monthRpc.taux_marge || 0),
        todayMargin,
        periodTauxMarge: Number(periodRpc.taux_marge || 0),
        periodCaNet: Number(periodRpc.ca_net || 0),
        periodMargeBrute: Number(periodRpc.marge_brute || 0),
        periodNbVentes: Number(periodRpc.nb_ventes || 0),
        periodNbRetours: Number(periodRpc.nb_retours || 0),
        periodRetours: Number(periodRpc.retours || 0),
      periodCharges: Number(periodRpc.charges_exploitation || 0),
      periodResultat: Number(periodRpc.resultat_exploitation || 0),
        cashBalance, sessionExpenses: sessionMovExpense, sessionCashIn: sessionMovIncome, periodExpenses, periodRefunds, periodWithdrawals, periodCustomerLoans, periodCashBalance,
        sessionCaNet: Number(sessionFinancials.ca_net || 0),
        sessionMargeBrute: Number(sessionFinancials.marge_brute || 0),
        sessionTauxMarge: Number(sessionFinancials.taux_marge || 0),
        sessionNbVentes: Number(sessionFinancials.nb_ventes || 0),
        sessionNbRetours: Number(sessionFinancials.nb_retours || 0),
        sessionRetours: Number(sessionFinancials.retours || 0),
        sessionDepenses: Number(sessionFinancials.depenses_session || 0),
        sessionRemboursements: Number(sessionFinancials.remboursements || 0),
        sessionRetraits: Number(sessionFinancials.retraits || 0),
        sessionPretsClients: Number(sessionFinancials.prets_clients || 0),
        sessionEntreesDirectes: Number(sessionFinancials.entrees_directes || 0),
        sessionEncaissements: Number(sessionFinancials.encaissements || 0),
        sessionCreditTotal: Number(sessionFinancials.credit_sales_total || 0),
        sessionCreditOutstanding: Number(sessionFinancials.credit_sales_outstanding || 0),
        sessionCreditCount: Number(sessionFinancials.credit_sales_count || 0),
        sessionResultat: Number(sessionFinancials.resultat_exploitation || 0),
        sessionOpenedBy: sessionFinancials._openedBy || '',
        sessionInfo,
        receivables, payables,
        articlesCount: articlesCount.count || 0,
        lowStockCount: low, outOfStockCount: out,
        stockValue,
        articlesInStockCount,
        customersCount: custData.count || 0,
        suppliersCount: suppData.count || 0,
        customersToChase: customersToChaseCount,
        suppliersToChase: payablesSupplierCount,
        pendingQuotes: quotesData.count || 0,
        pendingReturns: returnsData.count || 0,
        stockInToday: stockIn,
        stockOutToday: stockOut,
        recentSales: (recent.data as any) || [],
        recentActivities,
        alerts,
        activeOrders,
        webNew: webNewData.count || 0,
        webPrep: webPrepData.count || 0,
        webReady: webReadyData.count || 0,
        webTodayCount: webTodayRows.length,
        webTodayTotal,
        webAvgWait: avgWaitMin,
        lastWebOrder: lastWebOrderData.data as any || null,
        hourlySales,
        weeklySales,
        weekTotal,
      };
      if (!cancelled) {
        dashCache.stats = next;
        dashCache.shopInfo = newShopInfo;
        dashCache.key = `${tenant.id}:${siteId}`;
        dashCache.ts = Date.now();
        setStats(next);
        setShopInfo(newShopInfo);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tenant, refreshTick, currentSite?.id, period]);

  const nav = (route: string, ctx?: NavContext) => {
    setNavContext(ctx || null);
    onNavigate?.(route);
  };

  if (loading || !stats) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-[#0B0F19] z-[9999] overflow-hidden">
        {/* Ambient glow orbs */}
        <div className="absolute top-1/4 left-1/4 w-[50vw] h-[50vw] rounded-full bg-teal-500/8 blur-[120px] animate-[dashPulse_3s_ease-in-out_infinite]" />
        <div className="absolute bottom-1/4 right-1/4 w-[40vw] h-[40vw] rounded-full bg-cyan-500/6 blur-[100px] animate-[dashPulse_3s_ease-in-out_infinite_1.5s]" />

        {/* Dashboard icon with orbiting rings */}
        <div className="relative flex items-center justify-center mb-8">
          <div className="absolute w-24 h-24 rounded-full border border-white/5" />
          <div className="absolute w-16 h-16 rounded-full border border-white/10 animate-[dashSpin_2s_linear_infinite]" style={{ borderTopColor: 'rgba(20,184,166,0.6)' }} />
          <div className="absolute w-20 h-20 rounded-full border border-white/5 animate-[dashSpin_3s_linear_infinite_reverse]" style={{ borderBottomColor: 'rgba(6,182,212,0.4)' }} />
          <div className="relative w-12 h-12 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center shadow-[0_0_30px_rgba(20,184,166,0.4)]">
            <LayoutDashboard className="w-6 h-6 text-white" />
          </div>
        </div>

        {/* Progress dots */}
        <div className="flex items-center gap-1.5 mb-4">
          <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-[dashBounce_1.4s_ease-in-out_infinite]" />
          <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-[dashBounce_1.4s_ease-in-out_infinite_0.2s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-[dashBounce_1.4s_ease-in-out_infinite_0.4s]" />
        </div>

        {/* Status text */}
        <p className="text-[13px] font-medium text-slate-300 tracking-wide">
          Préparation de votre tableau de bord
        </p>
        <p className="text-[10px] text-slate-600 mt-1 tracking-[0.15em] uppercase">
          Chargement des données
        </p>
      </div>
    );
  }

  const now = new Date();
  const hourGreet = now.getHours() < 12 ? 'Bonjour' : now.getHours() < 18 ? 'Bon après-midi' : 'Bonsoir';
  const marginPct = can('view_margins') ? Math.round(stats.monthTauxMarge) : 0;
  const dayMarginPct = can('view_margins') ? Math.round(stats.periodTauxMarge) : 0;
  const dayDelta = stats.yesterdaySales > 0
    ? Math.round(((stats.todaySales - stats.yesterdaySales) / stats.yesterdaySales) * 100)
    : (stats.todaySales > 0 ? 100 : 0);

  const firstName = (profile?.full_name || '').split(' ')[0];

  return (
    <>
      <h1 className="sr-only">Tableau de bord</h1>
      <div className="lg:hidden space-y-2.5">
        <MobileDashboard
          stats={stats}
          shopInfo={shopInfo}
          dayDelta={dayDelta}
          marginPct={marginPct}
          dayMarginPct={dayMarginPct}
          nav={nav}
          balanceHidden={balanceHidden || !can('view_dashboard_stats')}
          toggleBalanceHidden={toggleBalanceHidden}
          heroLight={heroLight}
          toggleHeroTheme={toggleHeroTheme}
          canViewMargin={can('view_margins')}
          viewMode={viewMode}
          toggleViewMode={toggleViewMode}
          period={period}
          setPeriod={setPeriod}
          periodLabel={periodLabel}
          periodOptions={periodOptions}
          showPeriodMenu={showPeriodMenu}
          setShowPeriodMenu={setShowPeriodMenu}
        />
      </div>

      <div className="hidden lg:block">
        <DesktopDashboard
          stats={can('view_dashboard_stats') ? stats : { ...stats, todaySales: 0, todayCollected: 0, todayDirectCash: 0, todayPaid: 0, todayReceivable: 0, yesterdaySales: 0, monthSales: 0, monthMargin: 0, monthTauxMarge: 0, cashBalance: 0, sessionCashIn: 0, sessionExpenses: 0, receivables: 0, payables: 0, periodTauxMarge: 0, periodCaNet: 0, periodMargeBrute: 0, periodNbVentes: 0, periodNbRetours: 0, periodRetours: 0, periodCharges: 0, periodResultat: 0, periodExpenses: 0, periodRefunds: 0, periodWithdrawals: 0, periodCustomerLoans: 0, periodCashBalance: 0, sessionCaNet: 0, sessionMargeBrute: 0, sessionTauxMarge: 0, sessionNbVentes: 0, sessionNbRetours: 0, sessionRetours: 0, sessionDepenses: 0, sessionRemboursements: 0, sessionRetraits: 0, sessionPretsClients: 0, sessionEntreesDirectes: 0, sessionEncaissements: 0, sessionCreditTotal: 0, sessionCreditOutstanding: 0, sessionCreditCount: 0, sessionResultat: 0, sessionOpenedBy: '' }}
          shopInfo={shopInfo}
          greet={hourGreet}
          firstName={firstName}
          dayDelta={can('view_dashboard_stats') ? dayDelta : 0}
          dayMarginPct={can('view_margins') ? dayMarginPct : 0}
          marginPct={marginPct}
          nav={nav}
          period={period}
          setPeriod={setPeriod}
          showPeriodMenu={showPeriodMenu}
          setShowPeriodMenu={setShowPeriodMenu}
          periodOptions={periodOptions}
          periodLabel={periodLabel}
          heroLight={heroLight}
          toggleHeroTheme={toggleHeroTheme}
          canViewMargin={can('view_margins')}
          viewMode={viewMode}
          toggleViewMode={toggleViewMode}
        />
      </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 *  MOBILE DASHBOARD — Ultra-compact Premium Fintech 2026
 * ════════════════════════════════════════════════════════════════════════════ */
function MobileDashboard({
  stats, shopInfo, dayDelta, marginPct, dayMarginPct, nav,
  balanceHidden, toggleBalanceHidden, heroLight, toggleHeroTheme, canViewMargin,
  viewMode, toggleViewMode, period, setPeriod, periodLabel, periodOptions, showPeriodMenu, setShowPeriodMenu,
}: any) {
  const { tenant, currentSite, sites, setCurrentSite } = useApp();

  // ── Subscription info ─────────────────────────────────────────────────
  const [subInfo, setSubInfo] = useState<{ planName: string; status: string; startsAt: string | null; expiresAt: string | null; price: number; billingCycle: string } | null>(null);
  useEffect(() => {
    if (!tenant) return;
    const planCode = (tenant as any)?.plan || (tenant as any)?.selected_plan_code;
    const approvalStatus = (tenant as any)?.approval_status;
    const trialStart = (tenant as any)?.trial_start_date || null;
    const trialEnd = (tenant as any)?.trial_end_date || null;
    const subStart = (tenant as any)?.subscription_start_date || null;
    const planExpires = (tenant as any)?.plan_expires_at || null;
    const billingCycle = (tenant as any)?.billing_cycle || 'monthly';
    const now = Date.now();

    let status: string;
    let startsAt: string | null;
    let expiresAt: string | null;

    if (approvalStatus !== 'approved') {
      status = 'pending_review';
      startsAt = null;
      expiresAt = null;
    } else if (billingCycle === 'lifetime') {
      status = 'active';
      startsAt = subStart || trialStart;
      expiresAt = null;
    } else if (trialEnd && new Date(trialEnd).getTime() > now) {
      status = 'trial_active';
      startsAt = trialStart;
      expiresAt = trialEnd;
    } else if (planExpires && new Date(planExpires).getTime() < now) {
      status = 'expired';
      startsAt = subStart || trialStart;
      expiresAt = planExpires;
    } else {
      status = 'active';
      startsAt = subStart || trialStart;
      expiresAt = planExpires;
    }

    if (planCode) {
      supabase.from('plans').select('name, price_monthly, price_yearly, price_lifetime').eq('code', planCode).maybeSingle().then(({ data }) => {
        const price = billingCycle === 'lifetime' ? (data?.price_lifetime || 0) : billingCycle === 'yearly' ? (data?.price_yearly || 0) : (data?.price_monthly || 0);
        setSubInfo({ planName: data?.name || planCode, status, startsAt, expiresAt, price, billingCycle });
      });
    } else {
      setSubInfo({ planName: 'Standard', status, startsAt, expiresAt, price: 0, billingCycle });
    }
  }, [tenant]);

  // ── Multi-site overview ────────────────────────────────────────────────
  type SiteStat = { id: string; name: string; todaySales: number; todayCollected: number; todayDirectCash: number; salesCount: number; cashBalance: number; openingAmount: number; sessionOpen: boolean; expenses: number };
  const [multiSiteStats, setMultiSiteStats] = useState<SiteStat[]>([]);
  const hasMultiSites = sites.length > 1;

  useEffect(() => {
    if (!hasMultiSites || !tenant) return;
    let cancelled = false;
    (async () => {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      let pStart = today; let pEnd: Date | null = null;
      if (period === 'yesterday') { pStart = new Date(today); pStart.setDate(pStart.getDate() - 1); pEnd = today; }
      else if (period === 'this_week') { pStart = new Date(today); const d = pStart.getDay(); pStart.setDate(pStart.getDate() - (d === 0 ? 6 : d - 1)); }
      else if (period === 'last_week') { pStart = new Date(today); const d = pStart.getDay(); pStart.setDate(pStart.getDate() - (d === 0 ? 6 : d - 1) - 7); pEnd = new Date(pStart); pEnd.setDate(pEnd.getDate() + 7); }
      else if (period === 'this_month') { pStart = new Date(today.getFullYear(), today.getMonth(), 1); }
      else if (period === 'last_month') { pStart = new Date(today.getFullYear(), today.getMonth() - 1, 1); pEnd = new Date(today.getFullYear(), today.getMonth(), 1); }
      const results: SiteStat[] = [];
      for (const site of sites) {
        const { data: sessData } = await supabase.from('cash_sessions').select('id, opening_amount, status').eq('tenant_id', tenant.id).eq('site_id', site.id).eq('status', 'open').order('opened_at', { ascending: false }).limit(1);
        const session = (sessData || [])[0];
        const salesQ = supabase.from('sales').select('total').eq('tenant_id', tenant.id).eq('site_id', site.id).gte('created_at', pStart.toISOString()).in('status', ['paid', 'partial', 'validated']);
        if (pEnd) salesQ.lt('created_at', pEnd.toISOString());
        const pmtQ = supabase.from('sale_payments').select('amount, sales!inner(site_id)').eq('tenant_id', tenant.id).eq('sales.site_id', site.id).gte('created_at', pStart.toISOString());
        if (pEnd) pmtQ.lt('created_at', pEnd.toISOString());
        const movQ = supabase.from('cash_movements').select('kind, amount, reason').eq('tenant_id', tenant.id).eq('site_id', site.id).gte('created_at', pStart.toISOString());
        if (pEnd) movQ.lt('created_at', pEnd.toISOString());
        const [{ data: salesData }, { data: collectedPmts }, { data: collectedMovs }, { data: sfData }] = await Promise.all([
          salesQ,
          pmtQ,
          movQ,
          session ? supabase.rpc('get_session_financial_summary', { p_cash_session_id: session.id }) : Promise.resolve({ data: null }),
        ]);
        const sf: any = sfData || {};
        const salesCount = (salesData || []).length;
        const todaySales = (salesData || []).reduce((s: number, r: any) => s + Number(r.total), 0);
        const todayDirectCash = (collectedMovs || []).filter((m: any) => m.kind !== 'expense' && m.kind !== 'refund' && m.kind !== 'withdrawal' && m.kind !== 'customer_loan' && m.kind !== 'vault_withdrawal' && m.kind !== 'vault_deposit' && !(m.kind === 'income' && typeof m.reason === 'string' && m.reason.startsWith('Règlement ') && !m.reason.startsWith('Règlement solde'))).reduce((s: number, m: any) => s + Number(m.amount || 0), 0);
        const todayCollected = (collectedPmts || []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0) + todayDirectCash;
        const periodExpenses = (collectedMovs || []).filter((m: any) => m.kind === 'expense').reduce((s: number, m: any) => s + Number(m.amount || 0), 0);
        const periodRefunds = (collectedMovs || []).filter((m: any) => m.kind === 'refund').reduce((s: number, m: any) => s + Number(m.amount || 0), 0);
        const periodWithdrawals = (collectedMovs || []).filter((m: any) => m.kind === 'withdrawal').reduce((s: number, m: any) => s + Number(m.amount || 0), 0);
        const periodLoans = (collectedMovs || []).filter((m: any) => m.kind === 'customer_loan').reduce((s: number, m: any) => s + Number(m.amount || 0), 0);
        const periodCashBalance = todayCollected - periodExpenses - periodRefunds - periodWithdrawals - periodLoans;
        const openingAmount = session ? Number(session.opening_amount || 0) : 0;
        const sessionEncaissements = Number(sf.encaissements || 0);
        const sessionEntrees = Number(sf.entrees_directes || 0);
        const sessionDepenses = Number(sf.depenses_session || 0);
        const sessionRemboursements = Number(sf.remboursements || 0);
        const sessionRetraits = Number(sf.retraits || 0);
        const sessionPrets = Number(sf.prets_clients || 0);
        const sessionTotalOutflows = sessionDepenses + sessionRemboursements + sessionRetraits + sessionPrets;
        const sessionCashBalance = session ? openingAmount + sessionEncaissements + sessionEntrees - sessionTotalOutflows : 0;
        const sessionSales = Number(sf.ventes_validees || 0);
        const sessionCollected = sessionEncaissements + sessionEntrees;
        const sessionSalesCount = Number(sf.nb_ventes || 0);
        results.push({
          id: site.id, name: site.name,
          todaySales: viewMode === 'session' ? sessionSales : todaySales,
          todayCollected: viewMode === 'session' ? sessionCollected : todayCollected,
          todayDirectCash: viewMode === 'session' ? sessionEntrees : todayDirectCash,
          salesCount: viewMode === 'session' ? sessionSalesCount : salesCount,
          cashBalance: viewMode === 'session' ? sessionCashBalance : periodCashBalance,
          openingAmount,
          sessionOpen: !!session,
          expenses: viewMode === 'session' ? sessionTotalOutflows : periodExpenses,
        });
      }
      if (!cancelled) setMultiSiteStats(results);
    })();
    return () => { cancelled = true; };
  }, [hasMultiSites, tenant?.id, sites.length, stats.todaySales, viewMode, period]);

  // ── Web order notification (blink + sound) ──────────────────────────────
  const prevWebNew = useRef(stats.webNew);
  const webCardRef = useRef<HTMLButtonElement>(null);
  const [webBlink, setWebBlink] = useState(false);

  // ── Share shop modal ─────────────────────────────────────────────────────
  const [shareOpen, setShareOpen] = useState(false);
  const [waNumber, setWaNumber] = useState('');
  const [copied, setCopied] = useState(false);
  const shopUrl = shopInfo?.slug ? `${window.location.origin}/shop/${shopInfo.slug}` : '';


  const copyLink = () => {
    navigator.clipboard.writeText(shopUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const sendWhatsApp = () => {
    const clean = waNumber.replace(/\D/g, '');
    if (!clean) return;
    const msg = encodeURIComponent(`Bonjour ! Voici le lien de notre boutique en ligne : ${shopUrl}`);
    window.open(`https://wa.me/${clean}?text=${msg}`, '_blank');
  };

  useEffect(() => {
    if (stats.webNew > 0 && stats.webNew >= prevWebNew.current) {
      setWebBlink(true);
      // Try to play a notification sound (short beep via AudioContext)
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.4);
      } catch { /* AudioContext blocked is fine */ }
    }
    if (stats.webNew === 0) setWebBlink(false);
    prevWebNew.current = stats.webNew;
  }, [stats.webNew]);

  return (
    <div className="space-y-0 animate-fade-in pb-16">

      {/* ── SUBSCRIPTION INFO (discrete) ── */}
      {subInfo && (
        <button onClick={() => nav('settings', { target: 'subscription' })} className="w-full text-left px-1 -mb-1">
          <span className="text-[10px] text-neutral-400">
            Plan {subInfo.planName}
            {subInfo.expiresAt && (
              <>
                {' · '}
                <span className={(() => {
                  const days = Math.ceil((new Date(subInfo.expiresAt).getTime() - Date.now()) / 86400000);
                  return days <= 0 ? 'text-red-500' : '';
                })()}>
                  {(() => {
                    const days = Math.ceil((new Date(subInfo.expiresAt).getTime() - Date.now()) / 86400000);
                    if (days <= 0) return 'Expiré';
                    return `jusqu'au ${new Date(subInfo.expiresAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`;
                  })()}
                </span>
              </>
            )}
            {subInfo.billingCycle === 'lifetime' && ' · À vie'}
          </span>
        </button>
      )}

      {/* ── VIEW MODE TABS ── */}
      <div className="flex items-center gap-6 px-1">
        <button
          onClick={() => toggleViewMode('period')}
          className={`relative pb-2 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
            viewMode === 'period'
              ? 'text-neutral-900'
              : 'text-neutral-400'
          }`}
        >
          Période
          {viewMode === 'period' && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-neutral-900 rounded-full" />}
        </button>
        <button
          onClick={() => toggleViewMode('session')}
          className={`relative pb-2 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
            viewMode === 'session'
              ? 'text-neutral-900'
              : 'text-neutral-400'
          }`}
        >
          Session
          {viewMode === 'session' && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-neutral-900 rounded-full" />}
        </button>
      </div>

      {/* ── PERIOD SELECTOR (only in period mode) ── */}
      {viewMode === 'period' && (
        <div className="relative">
          <button
            onClick={() => setShowPeriodMenu(!showPeriodMenu)}
            className="w-full flex items-center justify-between px-1 py-2 border-b border-neutral-100 active:bg-neutral-50/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-neutral-400" />
              <span className="text-[11px] font-semibold text-neutral-700">{periodLabel}</span>
            </div>
            <ChevronRight className={`w-3.5 h-3.5 text-neutral-300 transition-transform ${showPeriodMenu ? 'rotate-90' : ''}`} />
          </button>
          {showPeriodMenu && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl border border-neutral-200 shadow-lg z-50 py-1 animate-fade-in">
              {periodOptions.map((opt: any) => (
                <button
                  key={opt.value}
                  onClick={() => { setPeriod(opt.value); setShowPeriodMenu(false); }}
                  className={`w-full text-left px-3.5 py-2 text-[11px] font-semibold transition-colors ${
                    period === opt.value ? 'text-neutral-900 bg-neutral-50' : 'text-neutral-500 hover:bg-neutral-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {viewMode === 'session' && !stats.sessionInfo ? (
        <div className="mt-4 rounded-[18px] bg-white p-6 text-center" style={{ boxShadow: '0 4px 20px rgba(15,23,42,0.08)' }}>
          <div className="w-14 h-14 mx-auto rounded-full bg-neutral-100 flex items-center justify-center mb-3">
            <Wallet className="w-6 h-6 text-neutral-400" />
          </div>
          <p className="text-sm font-bold text-neutral-700">Aucune session de caisse ouverte</p>
          <p className="text-xs text-neutral-400 mt-1">Ouvrez une session au POS pour voir les données de session.</p>
          <button onClick={() => nav('pos')} className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-neutral-900 text-white text-xs font-bold">
            <Store className="w-3.5 h-3.5" /> Ouvrir le POS
          </button>
        </div>
      ) : (
      <button
        onClick={() => nav('sales')}
        className={`w-full text-left relative overflow-hidden rounded-xl p-3.5 mt-4 active:scale-[0.985] transition-transform duration-200 ${heroLight ? '' : ''}`}
        style={heroLight
          ? { background: '#ffffff', boxShadow: '0 1px 4px rgba(15,23,42,0.06), 0 0 0 1px rgba(226,232,240,0.5)' }
          : { background: '#000000', boxShadow: '0 2px 8px rgba(0,0,0,0.25)' }
        }
      >
        {!heroLight && (
          <div className="absolute inset-0 pointer-events-none" />
        )}

        <div className="relative">
          {/* Header row */}
          <div className="flex items-center justify-between mb-1.5">
            {viewMode === 'session' && (
              <span className={`text-[9px] font-bold uppercase tracking-[0.15em] ${heroLight ? 'text-neutral-400' : 'text-white/60'}`}>Session de caisse</span>
            )}
            {viewMode !== 'session' && <div />}
            <div className="flex items-center gap-2">
              {shopInfo?.isActive && shopUrl && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShareOpen(true); }}
                  className="active:scale-90 transition-transform"
                  aria-label="Partager la boutique"
                >
                  <Share2 className={`w-3 h-3 ${heroLight ? 'text-neutral-400' : 'text-white/50'}`} />
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); toggleBalanceHidden(); }}
                className="active:scale-90 transition-transform"
              >
                {balanceHidden
                  ? <Eye className={`w-3 h-3 ${heroLight ? 'text-neutral-400' : 'text-white/50'}`} />
                  : <EyeOff className={`w-3 h-3 ${heroLight ? 'text-neutral-400' : 'text-white/50'}`} />}
              </button>
              <button
                onClick={toggleHeroTheme}
                className={`text-[10px] font-semibold active:scale-95 transition-transform ${heroLight ? 'text-neutral-400 hover:text-neutral-700' : 'text-white/40 hover:text-white/80'}`}
                aria-label="Changer le thème"
              >
                {heroLight ? 'Clair' : 'Sombre'}
              </button>
            </div>
          </div>

          {/* Main amount + delta */}
          <div className="flex items-end gap-3 mb-2.5">
            <div className={`num font-black leading-none tracking-tight ${heroLight ? 'text-neutral-900' : 'text-white'}`} style={{ fontSize: 'clamp(22px, 7vw, 30px)' }}>
              {balanceHidden ? '••••••' : formatFCFA(viewMode === 'session' ? stats.sessionCaNet : stats.todayCollected)}
            </div>
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className={`text-[8px] num ${heroLight ? 'text-neutral-500' : 'text-white/45'}`}>{viewMode === 'session' ? stats.sessionNbVentes : stats.todayCount} ticket{(viewMode === 'session' ? stats.sessionNbVentes : stats.todayCount) > 1 ? 's' : ''}</span>
            </div>
          </div>

          {/* Stats rows list */}
          <div style={{ borderTop: heroLight ? '1px solid rgba(226,232,240,0.8)' : '1px solid rgba(255,255,255,0.08)' }} className="pt-2 space-y-0">

            {/* Session info */}
            {stats.sessionInfo && (
              <div className={`flex items-center gap-1 mb-1.5 text-[8px] font-semibold uppercase tracking-[0.1em] ${heroLight ? 'text-neutral-400' : 'text-white/40'}`}>
                <Clock className="w-2.5 h-2.5" />
                Session depuis {new Date(stats.sessionInfo.openedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
              </div>
            )}

            {viewMode === 'session' ? (<>
            {/* SESSION: Encaissements */}
            <div className="flex items-center justify-between py-1.5" style={{ borderBottom: heroLight ? '1px solid rgba(226,232,240,0.6)' : '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-2">
                <Wallet className={`w-2.5 h-2.5 ${heroLight ? 'text-neutral-700' : 'text-white/80'}`} />
                <span className={`text-[9px] font-bold uppercase tracking-[0.07em] ${heroLight ? 'text-neutral-600' : 'text-white/70'}`}>Encaissements</span>
              </div>
              <span className={`num text-[13px] font-black ${heroLight ? 'text-neutral-900' : 'text-white'}`}>
                {balanceHidden ? '•••' : formatFCFA(stats.sessionEncaissements)}
              </span>
            </div>
            {/* SESSION: Marge brute */}
            {canViewMargin && (
            <div className="flex items-center justify-between py-1.5" style={{ borderBottom: heroLight ? '1px solid rgba(226,232,240,0.6)' : '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-2">
                <TrendingUp className={`w-2.5 h-2.5 ${heroLight ? 'text-neutral-700' : 'text-white/80'}`} />
                <span className={`text-[9px] font-bold uppercase tracking-[0.07em] ${heroLight ? 'text-neutral-600' : 'text-white/70'}`}>Marge brute</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`num text-[13px] font-black ${heroLight ? 'text-neutral-800' : 'text-white/85'}`}>
                  {balanceHidden ? '•••' : formatFCFA(stats.sessionMargeBrute)}
                </span>
                {stats.sessionTauxMarge > 0 && <span className={`text-[8px] font-bold num ${heroLight ? 'text-neutral-400' : 'text-white/50'}`}>{Math.round(stats.sessionTauxMarge)}%</span>}
              </div>
            </div>
            )}
            {/* SESSION: Ventes à crédit */}
            {stats.sessionCreditCount > 0 && (
            <div className="flex items-center justify-between py-1.5" style={{ borderBottom: heroLight ? '1px solid rgba(226,232,240,0.6)' : '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-2">
                <Users className={`w-2.5 h-2.5 ${heroLight ? 'text-amber-600' : 'text-amber-300'}`} />
                <span className={`text-[9px] font-bold uppercase tracking-[0.07em] ${heroLight ? 'text-neutral-600' : 'text-white/70'}`}>Ventes à crédit</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`num text-[13px] font-black ${heroLight ? 'text-amber-700' : 'text-amber-200'}`}>
                  {balanceHidden ? '•••' : formatFCFA(stats.sessionCreditTotal)}
                </span>
                <span className={`text-[8px] font-bold num ${heroLight ? 'text-neutral-400' : 'text-white/50'}`}>{stats.sessionCreditCount}</span>
              </div>
            </div>
            )}
            {/* SESSION: Dépenses */}
            <div className="flex items-center justify-between py-1.5" style={{ borderBottom: heroLight ? '1px solid rgba(226,232,240,0.6)' : '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-2">
                <ArrowUpLeft className={`w-2.5 h-2.5 ${heroLight ? 'text-rose-500' : 'text-rose-300'}`} />
                <span className={`text-[9px] font-bold uppercase tracking-[0.07em] ${heroLight ? 'text-neutral-600' : 'text-white/70'}`}>Dépenses</span>
              </div>
              <span className={`num text-[13px] font-black ${heroLight ? 'text-neutral-800' : 'text-white/80'}`}>
                {balanceHidden ? '•••' : formatFCFA(stats.sessionDepenses)}
              </span>
            </div>
            {/* SESSION: Caisse théorique */}
            <div className="flex items-center justify-between py-1.5" style={{ borderBottom: heroLight ? '1px solid rgba(226,232,240,0.6)' : '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-2">
                <Wallet className={`w-2.5 h-2.5 ${heroLight ? 'text-neutral-700' : 'text-white/70'}`} />
                <span className={`text-[9px] font-bold uppercase tracking-[0.07em] ${heroLight ? 'text-neutral-600' : 'text-white/70'}`}>Caisse théorique</span>
              </div>
              <span className={`num text-[13px] font-black ${heroLight ? 'text-neutral-900' : 'text-white'}`}>
                {balanceHidden ? '•••' : formatFCFA((stats.sessionInfo?.openingAmount || 0) + stats.sessionEncaissements + stats.sessionEntreesDirectes - stats.sessionDepenses - stats.sessionRemboursements - stats.sessionRetraits - stats.sessionPretsClients)}
              </span>
            </div>
            </>) : (<>
            {/* PÉRIODE: CA net */}
            <div className="flex items-center justify-between py-1.5" style={{ borderBottom: heroLight ? '1px solid rgba(226,232,240,0.6)' : '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-2">
                <Receipt className={`w-2.5 h-2.5 ${heroLight ? 'text-neutral-700' : 'text-white/80'}`} />
                <span className={`text-[9px] font-bold uppercase tracking-[0.07em] ${heroLight ? 'text-neutral-600' : 'text-white/70'}`}>CA net</span>
              </div>
              <span className={`num text-[13px] font-black ${heroLight ? 'text-neutral-800' : 'text-white/85'}`}>
                {balanceHidden ? '•••' : formatFCFA(stats.todaySales)}
              </span>
            </div>
            {/* PÉRIODE: Encaissements directs */}
            <div className="flex items-center justify-between py-1.5" style={{ borderBottom: heroLight ? '1px solid rgba(226,232,240,0.6)' : '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-2">
                <Wallet className={`w-2.5 h-2.5 ${heroLight ? 'text-neutral-700' : 'text-white/80'}`} />
                <span className={`text-[9px] font-bold uppercase tracking-[0.07em] ${heroLight ? 'text-neutral-600' : 'text-white/70'}`}>Encaiss. directs</span>
              </div>
              <span className={`num text-[13px] font-black ${heroLight ? 'text-neutral-900' : 'text-white'}`}>
                {balanceHidden ? '•••' : formatFCFA(stats.todayDirectCash)}
              </span>
            </div>
            {/* PÉRIODE: Dépenses */}
            <div className="flex items-center justify-between py-1.5" style={{ borderBottom: heroLight ? '1px solid rgba(226,232,240,0.6)' : '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-2">
                <ArrowUpLeft className={`w-2.5 h-2.5 ${heroLight ? 'text-rose-500' : 'text-rose-300'}`} />
                <span className={`text-[9px] font-bold uppercase tracking-[0.07em] ${heroLight ? 'text-neutral-600' : 'text-white/70'}`}>Dépenses</span>
              </div>
              <span className={`num text-[13px] font-black ${heroLight ? 'text-neutral-800' : 'text-white/80'}`}>
                {balanceHidden ? '•••' : formatFCFA(stats.periodExpenses)}
              </span>
            </div>
            {/* PÉRIODE: Solde caisse */}
            <div className="flex items-center justify-between py-1.5" style={{ borderBottom: heroLight ? '1px solid rgba(226,232,240,0.6)' : '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-2">
                <Wallet className={`w-2.5 h-2.5 ${heroLight ? 'text-neutral-700' : 'text-white/70'}`} />
                <span className={`text-[9px] font-bold uppercase tracking-[0.07em] ${heroLight ? 'text-neutral-600' : 'text-white/70'}`}>Solde caisse</span>
              </div>
              <span className={`num text-[13px] font-black ${heroLight ? 'text-neutral-900' : 'text-white'}`}>
                {balanceHidden ? '•••' : formatFCFA(stats.periodCashBalance)}
              </span>
            </div>
            </>)}

            {/* CRÉANCES CLIENTS row - period only */}
            {viewMode !== 'session' && stats.receivables > 0 && (
              <div className="flex items-center justify-between py-1.5" style={{ borderBottom: heroLight ? '1px solid rgba(226,232,240,0.6)' : '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center gap-2">
                  <Users className={`w-2.5 h-2.5 ${heroLight ? 'text-amber-600' : 'text-amber-300'}`} />
                  <span className={`text-[9px] font-bold uppercase tracking-[0.07em] ${heroLight ? 'text-neutral-600' : 'text-white/70'}`}>Créances</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`num text-[13px] font-black ${heroLight ? 'text-amber-700' : 'text-amber-200'}`}>
                    {balanceHidden ? '•••' : formatFCFA(stats.receivables)}
                  </span>
                  <span className={`text-[8px] font-bold num ${heroLight ? 'text-neutral-400' : 'text-white/50'}`}>{stats.customersToChase} client{stats.customersToChase > 1 ? 's' : ''}</span>
                </div>
              </div>
            )}

            {/* MARGE DU JOUR row - period only */}
            {viewMode !== 'session' && !balanceHidden && dayMarginPct > 0 && (
              <div className="flex items-center justify-between py-1.5" style={{ borderBottom: heroLight ? '1px solid rgba(226,232,240,0.6)' : '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center gap-2">
                  <TrendingUp className={`w-2.5 h-2.5 ${heroLight ? 'text-neutral-700' : 'text-white/80'}`} />
                  <span className={`text-[9px] font-bold uppercase tracking-[0.07em] ${heroLight ? 'text-neutral-600' : 'text-white/70'}`}>Marge jour</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`num text-[13px] font-black ${heroLight ? 'text-neutral-900' : 'text-white'}`}>
                    {formatFCFA(stats.todayMargin)}
                  </span>
                  <span className={`text-[8px] font-bold num ${heroLight ? 'text-neutral-400' : 'text-white/50'}`}>{dayMarginPct}%</span>
                </div>
              </div>
            )}

            {/* MOIS row */}
            {!balanceHidden && (
              <div className="flex items-center justify-between py-1.5">
                <div className="flex items-center gap-2">
                  <BarChart3 className={`w-2.5 h-2.5 ${heroLight ? 'text-neutral-400' : 'text-white/50'}`} />
                  <span className={`text-[9px] font-bold uppercase tracking-[0.07em] ${heroLight ? 'text-neutral-400' : 'text-white/50'}`}>CA du mois</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`num text-[13px] font-black ${heroLight ? 'text-neutral-700' : 'text-white/70'}`}>{formatCompactFCFA(stats.monthSales)}</span>
                  {marginPct > 0 && <span className={`text-[8px] font-bold num ${heroLight ? 'text-neutral-400' : 'text-white/50'}`}>marge {marginPct}%</span>}
                </div>
              </div>
            )}
          </div>
        </div>
      </button>
      )}

      {/* ── MULTI-SITE STRIP (mobile) — compact list ── */}
      {sites.length > 1 && multiSiteStats.length > 0 && (
        <div className="pt-4">
          <div className="flex items-center justify-between px-1 mb-2">
            <span className="text-[10px] font-bold text-neutral-900 uppercase tracking-wider">Magasins</span>
            <span className="text-[9px] font-semibold text-neutral-400 num">Total: {formatCompactFCFA(multiSiteStats.reduce((s, x) => s + (viewMode === 'session' && !x.sessionOpen ? 0 : x.todayCollected), 0))}</span>
          </div>
          <div className="border-t border-neutral-100" />
          <div className="divide-y divide-neutral-100">
            {multiSiteStats.map(site => {
              const isCurrent = site.id === currentSite?.id;
              return (
                <button
                  key={site.id}
                  onClick={() => { const s = sites.find((x: any) => x.id === site.id); if (s) setCurrentSite(s); }}
                  className={`w-full px-3.5 py-2.5 text-left active:bg-neutral-50 transition-colors ${isCurrent ? 'bg-neutral-50/40' : ''}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${site.sessionOpen ? 'bg-neutral-900' : 'bg-neutral-300'}`} />
                      <span className={`text-[11px] truncate ${isCurrent ? 'font-bold text-neutral-900' : 'font-semibold text-neutral-700'}`}>{site.name}</span>
                      {isCurrent && <span className="text-[8px] font-bold text-neutral-900 bg-neutral-200 px-1 py-0.5 rounded shrink-0">Actif</span>}
                    </div>
                    <span className={`text-[10px] font-bold ${site.sessionOpen ? 'text-neutral-700' : 'text-neutral-400'}`}>{site.sessionOpen ? 'Ouverte' : 'Fermée'}</span>
                  </div>
                  <div className="flex items-center gap-3 ml-3">
                    <span className="text-[9px] text-neutral-400">Facturé <span className="font-bold text-neutral-700 num">{viewMode === 'session' && !site.sessionOpen ? '--' : formatCompactFCFA(site.todaySales)}</span></span>
                    <span className="text-[9px] text-neutral-400">Encaissé <span className="font-bold text-neutral-900 num">{viewMode === 'session' && !site.sessionOpen ? '--' : formatCompactFCFA(site.todayCollected)}</span></span>
                    <span className="text-[9px] text-neutral-400">Dép. <span className="font-bold text-red-600 num">{viewMode === 'session' && !site.sessionOpen ? '--' : (site.expenses > 0 ? `-${formatCompactFCFA(site.expenses)}` : '0')}</span></span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── FINANCES ── */}
      <div className="pt-4">
        <div className="flex items-center justify-between px-1 mb-2">
          <span className="text-[10px] font-bold text-neutral-900 uppercase tracking-wider">Finances</span>
          <button onClick={() => nav('accounting')} className="text-[9px] font-semibold text-neutral-400 flex items-center gap-0.5">
            Voir tout <ChevronRight className="w-2.5 h-2.5" />
          </button>
        </div>
        <div className="border-t border-neutral-100" />
        <span className="text-[8px] font-semibold text-neutral-400 uppercase tracking-wider px-1 pt-2 block">Situation actuelle</span>
        <div className="grid grid-cols-2 mt-1">
          <button onClick={() => nav('tiers', { target: 'receivables' })} className="px-1 py-2.5 text-left active:bg-neutral-50/50 transition-colors border-r border-neutral-100">
            <div className="text-[9px] text-neutral-400 font-medium mb-0.5">Créances</div>
            <div className="num text-[15px] font-black text-neutral-900 leading-tight">{balanceHidden ? '•••' : formatFCFA(stats.receivables)}</div>
            <div className="text-[9px] text-neutral-400 mt-0.5">{stats.customersToChase} client{stats.customersToChase > 1 ? 's' : ''}</div>
          </button>
          <button onClick={() => nav('supplier_orders', { target: 'payables' })} className="px-3 py-2.5 text-left active:bg-neutral-50/50 transition-colors">
            <div className="text-[9px] text-neutral-400 font-medium mb-0.5">Fournisseurs</div>
            <div className="num text-[15px] font-black text-neutral-900 leading-tight">{balanceHidden ? '•••' : formatFCFA(stats.payables)}</div>
            <div className="text-[9px] text-neutral-400 mt-0.5">{stats.suppliersToChase} fournisseur{stats.suppliersToChase > 1 ? 's' : ''}</div>
          </button>
        </div>
      </div>

      {/* ── ALERTES ── */}
      {(stats.lowStockCount > 0 || stats.outOfStockCount > 0 || stats.pendingQuotes > 0) && (
        <div className="pt-4">
          <div className="flex items-center justify-between px-1 mb-2">
            <span className="text-[10px] font-bold text-neutral-900 uppercase tracking-wider">Alertes</span>
            <button onClick={() => nav('stock')} className="text-[9px] font-semibold text-neutral-400 flex items-center gap-0.5">
              Voir tout <ChevronRight className="w-2.5 h-2.5" />
            </button>
          </div>
          <div className="border-t border-neutral-100" />
          <div className="divide-y divide-neutral-100">
            {stats.outOfStockCount > 0 && (
              <button onClick={() => nav('stock', { target: 'outOfStock' })} className="w-full px-1 py-2.5 text-left flex items-center gap-2.5 active:bg-neutral-50/50 transition-colors">
                <AlertTriangle className="w-3 h-3 text-rose-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold text-neutral-800">{stats.outOfStockCount} rupture{stats.outOfStockCount > 1 ? 's' : ''} de stock</div>
                  <div className="text-[9px] text-neutral-400">À commander d'urgence</div>
                </div>
                <ChevronRight className="w-3 h-3 text-neutral-300 shrink-0" />
              </button>
            )}
            {stats.lowStockCount > 0 && (
              <button onClick={() => nav('stock', { target: 'lowStock' })} className="w-full px-1 py-2.5 text-left flex items-center gap-2.5 active:bg-neutral-50/50 transition-colors">
                <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold text-neutral-800">{stats.lowStockCount} stock{stats.lowStockCount > 1 ? 's' : ''} bas</div>
                  <div className="text-[9px] text-neutral-400">Seuil minimum atteint</div>
                </div>
                <ChevronRight className="w-3 h-3 text-neutral-300 shrink-0" />
              </button>
            )}
            {stats.pendingQuotes > 0 && (
              <button onClick={() => nav('billing', { target: 'quotes' })} className="w-full px-1 py-2.5 text-left flex items-center gap-2.5 active:bg-neutral-50/50 transition-colors">
                <FileText className="w-3 h-3 text-neutral-600 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold text-neutral-800">{stats.pendingQuotes} devis en attente</div>
                  <div className="text-[9px] text-neutral-400">À traiter</div>
                </div>
                <ChevronRight className="w-3 h-3 text-neutral-300 shrink-0" />
              </button>
            )}
          </div>
        </div>
      )}


      {/* ── SANTÉ BUSINESS ── */}
      <div className="pt-4">
        <div className="flex items-center justify-between px-1 mb-2">
          <span className="text-[10px] font-bold text-neutral-900 uppercase tracking-wider">Santé business</span>
          <button onClick={() => nav('sales')} className="text-[9px] font-semibold text-neutral-400 flex items-center gap-0.5">
            Voir le journal <ChevronRight className="w-2.5 h-2.5" />
          </button>
        </div>
        <div className="border-t border-neutral-100" />
        <div className="grid grid-cols-2 mt-1">
          <div className="px-1 py-2.5 border-r border-neutral-100">
            <div className="text-[9px] font-medium text-neutral-400 uppercase tracking-wider mb-0.5">Ticket moyen</div>
            <div className="num text-[15px] font-black text-neutral-900 leading-tight">
              {balanceHidden ? '•••' : formatFCFA((viewMode === 'session' ? stats.sessionNbVentes : stats.todayCount) > 0 ? Math.round((viewMode === 'session' ? stats.sessionCaNet : stats.todaySales) / (viewMode === 'session' ? stats.sessionNbVentes : stats.todayCount)) : 0)}
            </div>
          </div>
          <div className="px-3 py-2.5">
            <div className="text-[9px] font-medium text-neutral-400 uppercase tracking-wider mb-0.5">Dernière vente</div>
            <div className="num text-[15px] font-black text-neutral-900 leading-tight">
              {stats.recentSales.length > 0 ? (balanceHidden ? '•••' : formatFCFA(stats.recentSales[0].total)) : '-'}
            </div>
          </div>
        </div>
        <div className="border-t border-neutral-100" />
        {stats.recentSales.length > 0 && (
          <button onClick={() => nav('sales')} className="w-full flex items-center gap-2.5 px-1 py-2.5 active:bg-neutral-50/50 transition-colors text-left border-b border-neutral-100">
            <CheckCircle className="w-3 h-3 text-neutral-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold text-neutral-800 truncate">
                {(stats.recentSales[0] as any).customers?.name || 'Client comptoir'}
                <span className="font-mono text-[9px] font-bold text-neutral-500 ml-1">· {stats.recentSales[0].sale_number}</span>
              </div>
              <div className="text-[9px] text-neutral-400 num">{formatDateTime(stats.recentSales[0].created_at)}</div>
            </div>
            <ChevronRight className="w-3 h-3 text-neutral-300 shrink-0" />
          </button>
        )}
        <div className="grid grid-cols-3 border-t border-neutral-100">
          <button onClick={() => nav('articles')} className="flex items-center gap-1.5 px-1 py-2.5 active:bg-neutral-50/50 transition-colors border-r border-neutral-100">
            <Package className="w-3 h-3 text-neutral-400 shrink-0" />
            <div>
              <div className="num text-[13px] font-extrabold text-neutral-900 leading-none">{stats.articlesCount}</div>
              <div className="text-[9px] text-neutral-400 font-medium mt-0.5">Articles</div>
            </div>
          </button>
          <button onClick={() => nav('tiers')} className="flex items-center gap-1.5 px-2.5 py-2.5 active:bg-neutral-50/50 transition-colors border-r border-neutral-100">
            <Users className="w-3 h-3 text-neutral-400 shrink-0" />
            <div>
              <div className="num text-[13px] font-extrabold text-neutral-900 leading-none">{stats.customersCount}</div>
              <div className="text-[9px] text-neutral-400 font-medium mt-0.5">Clients</div>
            </div>
          </button>
          <button onClick={() => nav('tiers')} className="flex items-center gap-1.5 px-2.5 py-2.5 active:bg-neutral-50/50 transition-colors">
            <Truck className="w-3 h-3 text-neutral-400 shrink-0" />
            <div>
              <div className="num text-[13px] font-extrabold text-neutral-900 leading-none">{stats.suppliersCount}</div>
              <div className="text-[9px] text-neutral-400 font-medium mt-0.5">Fourn.</div>
            </div>
          </button>
        </div>
      </div>



      {/* ── SHARE SHOP MODAL ── */}
      {shareOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 pb-8" onClick={() => setShareOpen(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-sm rounded-[24px] overflow-hidden"
            style={{ background: '#0a0a0a', boxShadow: '0 32px 64px -16px rgba(0,0,0,0.8)' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Decorative glow */}
            <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full bg-white/5 blur-3xl pointer-events-none" />

            <div className="relative p-5">
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center">
                    <Share2 className="w-4 h-4 text-white/80" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white leading-tight">Partager la boutique</div>
                    <div className="text-[10px] text-white/40 font-medium">Boutique en ligne active</div>
                  </div>
                </div>
                <button
                  onClick={() => setShareOpen(false)}
                  className="w-7 h-7 rounded-full bg-white/8 border border-white/10 flex items-center justify-center"
                >
                  <X className="w-3.5 h-3.5 text-white/60" />
                </button>
              </div>

              {/* Link field */}
              <div className="mb-3">
                <div className="text-[9px] font-bold text-white/40 uppercase tracking-[0.1em] mb-1.5">Lien de la boutique</div>
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <Globe className="w-3.5 h-3.5 text-white/40 shrink-0" />
                  <span className="flex-1 text-[11px] text-white/70 font-medium truncate min-w-0">{shopUrl}</span>
                  <button
                    onClick={copyLink}
                    className={`shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${copied ? 'bg-white/15 text-white' : 'bg-white/8 text-white/60 active:bg-white/15'}`}
                  >
                    {copied ? <CheckIcon className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copied ? 'Copié !' : 'Copier'}
                  </button>
                </div>
              </div>

              {/* WhatsApp section */}
              <div className="mb-4">
                <div className="text-[9px] font-bold text-white/40 uppercase tracking-[0.1em] mb-1.5">Envoyer par WhatsApp</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <MessageCircle className="w-3.5 h-3.5 text-white/40 shrink-0" />
                    <input
                      type="tel"
                      value={waNumber}
                      onChange={e => setWaNumber(e.target.value)}
                      placeholder="Numéro (ex: 221771234567)"
                      className="flex-1 bg-transparent text-[11px] text-white/80 placeholder:text-white/25 font-medium outline-none min-w-0"
                    />
                  </div>
                  <button
                    onClick={sendWhatsApp}
                    disabled={!waNumber.replace(/\D/g, '')}
                    className="shrink-0 h-10 px-3 rounded-xl text-[11px] font-bold text-white transition-all disabled:opacity-30 active:scale-95"
                    style={{ background: 'linear-gradient(135deg, #25d366 0%, #128c7e 100%)' }}
                  >
                    Envoyer
                  </button>
                </div>
              </div>

              {/* Open in browser */}
              <button
                onClick={() => window.open(shopUrl, '_blank')}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[11px] font-bold text-white/60 transition-colors active:bg-white/5"
                style={{ border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Ouvrir la boutique
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


/* ════════════════════════════════════════════════════════════════════════════
 *  KPI helpers — divider-separated inline KPIs (no mini-cards)
 * ════════════════════════════════════════════════════════════════════════════ */
function KpiItem({ light, label, value, sub, negative, accent }: {
  light: boolean; label: string; value: string; sub?: string; negative?: boolean; accent?: 'amber';
}) {
  const valColor = negative
    ? (light ? 'text-red-600' : 'text-rose-300')
    : accent === 'amber'
      ? (light ? 'text-amber-700' : 'text-amber-200')
      : (light ? 'text-neutral-900' : 'text-white');
  return (
    <div className="flex flex-col">
      <p className={`text-[10px] font-medium uppercase tracking-wide mb-0.5 ${light ? 'text-neutral-500' : 'text-white/50'}`}>{label}</p>
      <p className={`text-lg font-bold num leading-tight ${valColor}`}>{value}</p>
      {sub && <p className={`text-[9px] mt-0.5 ${light ? 'text-neutral-400' : 'text-white/40'}`}>{sub}</p>}
    </div>
  );
}

function KpiDivider({ light }: { light: boolean }) {
  return <div className={`self-stretch w-px ${light ? 'bg-neutral-200' : 'bg-white/10'}`} style={{ minHeight: 36 }} />;
}


/* ════════════════════════════════════════════════════════════════════════════
 *  DESKTOP DASHBOARD — Exact match to capture specification
 * ════════════════════════════════════════════════════════════════════════════ */

function HeroChart({ data }: { data: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const currentHour = new Date().getHours();
  const sliced = data.slice(0, Math.max(currentHour + 1, 1));
  const max = Math.max(...sliced, 1000);

  const w = 800;
  const h = 150;
  const padL = 38;
  const padR = 20;
  const padT = 10;
  const padB = 22;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  const points = sliced.map((v, i) => ({
    x: padL + (i / 23) * chartW,
    y: padT + (1 - v / max) * chartH,
    value: v,
    hour: i,
  }));

  const pathD = points.length < 2 ? '' : points.reduce((d, p, i) => {
    if (i === 0) return `M ${p.x} ${p.y}`;
    const prev = points[i - 1];
    const cx1 = prev.x + (p.x - prev.x) * 0.4;
    const cx2 = p.x - (p.x - prev.x) * 0.4;
    return `${d} C ${cx1} ${prev.y}, ${cx2} ${p.y}, ${p.x} ${p.y}`;
  }, '');

  const areaD = pathD && points.length > 0
    ? `${pathD} L ${points[points.length - 1].x} ${padT + chartH} L ${points[0].x} ${padT + chartH} Z`
    : '';

  const yTicks = [0, max * 0.33, max * 0.66, max].map(v => Math.round(v));
  const xTicks = [0, 6, 12, 18, 24];

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || points.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * w;
    let closest = 0;
    let minDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dist = Math.abs(points[i].x - relX);
      if (dist < minDist) { minDist = dist; closest = i; }
    }
    setHover(closest);
  };

  const hp = hover !== null && hover < points.length ? points[hover] : null;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${w} ${h}`}
      className="w-full h-full cursor-crosshair block"
      preserveAspectRatio="xMidYMid meet"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHover(null)}
    >
      <defs>
        <linearGradient id="heroGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a3a3a3" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#a3a3a3" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {yTicks.map((v, i) => {
        const y = padT + (1 - v / max) * chartH;
        return (
          <g key={i}>
            <line x1={padL} y1={y} x2={w - padR} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
            <text x={padL - 4} y={y + 3} textAnchor="end" fill="rgba(255,255,255,0.45)" fontSize="9" fontWeight="500">
              {v >= 1000 ? `${Math.round(v / 1000)}K` : v}
            </text>
          </g>
        );
      })}
      {xTicks.map((hr) => {
        const x = padL + (hr / 24) * chartW;
        return (
          <text key={hr} x={x} y={h - 5} textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize="9" fontWeight="500">
            {String(hr).padStart(2, '0')}:00
          </text>
        );
      })}
      {areaD && <path d={areaD} fill="url(#heroGrad)" />}
      {pathD && <path d={pathD} fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />}
      {hp && (
        <>
          <line x1={hp.x} y1={padT} x2={hp.x} y2={padT + chartH} stroke="#ffffff" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.7" />
          <circle cx={hp.x} cy={hp.y} r="4" fill="#fff" stroke="#171717" strokeWidth="2" />
          <rect x={Math.min(Math.max(hp.x - 40, 2), w - 82)} y={hp.y - 28} width="80" height="22" rx="4" fill="rgba(0,0,0,0.85)" />
          <text x={Math.min(Math.max(hp.x, 42), w - 42)} y={hp.y - 14} textAnchor="middle" fill="#ffffff" fontSize="10" fontWeight="700">
            {formatCompactFCFA(hp.value)} - {String(hp.hour).padStart(2, '0')}h
          </text>
        </>
      )}
    </svg>
  );
}

function WeekBarChart({ data }: { data: { day: string; total: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map(d => d.total), 1);
  const w = 280;
  const h = 120;
  const padL = 30;
  const padB = 20;
  const padT = 10;
  const chartW = w - padL - 10;
  const chartH = h - padB - padT;
  const barGap = chartW / data.length;
  const barW = barGap * 0.6;

  const yTicks = [0, max * 0.33, max * 0.66, max];

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: 120 }}>
        {yTicks.map((v, i) => {
          const y = padT + (1 - v / max) * chartH;
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={w - 10} y2={y} stroke="#e5e5e5" strokeWidth="0.5" />
              <text x={padL - 4} y={y + 3} textAnchor="end" fill="#a3a3a3" fontSize="8" fontWeight="500">
                {v >= 1000 ? `${Math.round(v / 1000)}K` : Math.round(v)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const barH = (d.total / max) * chartH;
          const x = padL + i * barGap + (barGap - barW) / 2;
          const y = padT + chartH - barH;
          const isHov = hover === i;
          return (
            <g key={i}>
              <rect
                x={x} y={y} width={barW} height={barH}
                rx="3" fill={isHov ? '#171717' : '#171717'}
                opacity={isHov ? 1 : 0.75}
                className="transition-opacity duration-150"
              />
              <rect
                x={padL + i * barGap} y={0} width={barGap} height={h}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                className="cursor-pointer"
              />
              <text x={x + barW / 2} y={h - 5} textAnchor="middle" fill="#737373" fontSize="8" fontWeight="600">
                {d.day}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div
          className="absolute pointer-events-none z-10 px-2 py-1 rounded bg-neutral-900 text-white text-[10px] font-semibold shadow-lg"
          style={{ left: `${((hover + 0.5) / data.length) * 100}%`, top: 0, transform: 'translateX(-50%)' }}
        >
          {formatCompactFCFA(data[hover].total)}
        </div>
      )}
    </div>
  );
}

function DesktopDashboard({ stats, shopInfo, greet, firstName, dayDelta, dayMarginPct, marginPct, nav, period, setPeriod, showPeriodMenu, setShowPeriodMenu, periodOptions, periodLabel, heroLight, toggleHeroTheme, canViewMargin, viewMode, toggleViewMode }: any) {
  const { tenant, currentSite, sites, setCurrentSite, profile, signOut } = useApp();
  const { can } = usePermissions();

  // ── Subscription info ─────────────────────────────────────────────────
  const [subInfo, setSubInfo] = useState<{ planName: string; status: string; startsAt: string | null; expiresAt: string | null; price: number; billingCycle: string } | null>(null);
  useEffect(() => {
    if (!tenant) return;
    const planCode = (tenant as any)?.plan || (tenant as any)?.selected_plan_code;
    const approvalStatus = (tenant as any)?.approval_status;
    const trialStart = (tenant as any)?.trial_start_date || null;
    const trialEnd = (tenant as any)?.trial_end_date || null;
    const subStart = (tenant as any)?.subscription_start_date || null;
    const planExpires = (tenant as any)?.plan_expires_at || null;
    const billingCycle = (tenant as any)?.billing_cycle || 'monthly';
    const now = Date.now();

    let status: string;
    let startsAt: string | null;
    let expiresAt: string | null;

    if (approvalStatus !== 'approved') {
      status = 'pending_review';
      startsAt = null;
      expiresAt = null;
    } else if (billingCycle === 'lifetime') {
      status = 'active';
      startsAt = subStart || trialStart;
      expiresAt = null;
    } else if (trialEnd && new Date(trialEnd).getTime() > now) {
      status = 'trial_active';
      startsAt = trialStart;
      expiresAt = trialEnd;
    } else if (planExpires && new Date(planExpires).getTime() < now) {
      status = 'expired';
      startsAt = subStart || trialStart;
      expiresAt = planExpires;
    } else {
      status = 'active';
      startsAt = subStart || trialStart;
      expiresAt = planExpires;
    }

    if (planCode) {
      supabase.from('plans').select('name, price_monthly, price_yearly, price_lifetime').eq('code', planCode).maybeSingle().then(({ data }) => {
        const price = billingCycle === 'lifetime' ? (data?.price_lifetime || 0) : billingCycle === 'yearly' ? (data?.price_yearly || 0) : (data?.price_monthly || 0);
        setSubInfo({ planName: data?.name || planCode, status, startsAt, expiresAt, price, billingCycle });
      });
    } else {
      setSubInfo({ planName: 'Standard', status, startsAt, expiresAt, price: 0, billingCycle });
    }
  }, [tenant]);

  // ── Multi-site overview ────────────────────────────────────────────────
  type SiteStat = { id: string; name: string; todaySales: number; todayCollected: number; todayDirectCash: number; salesCount: number; cashBalance: number; openingAmount: number; sessionOpen: boolean; expenses: number };
  const [multiSiteStats, setMultiSiteStats] = useState<SiteStat[]>([]);
  const [multiSiteView, setMultiSiteView] = useState<'all' | string>('current');
  const hasMultiSites = sites.length > 1;

  useEffect(() => {
    if (!hasMultiSites || !tenant) return;
    let cancelled = false;
    (async () => {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      let pStart = today; let pEnd: Date | null = null;
      if (period === 'yesterday') { pStart = new Date(today); pStart.setDate(pStart.getDate() - 1); pEnd = today; }
      else if (period === 'this_week') { pStart = new Date(today); const d = pStart.getDay(); pStart.setDate(pStart.getDate() - (d === 0 ? 6 : d - 1)); }
      else if (period === 'last_week') { pStart = new Date(today); const d = pStart.getDay(); pStart.setDate(pStart.getDate() - (d === 0 ? 6 : d - 1) - 7); pEnd = new Date(pStart); pEnd.setDate(pEnd.getDate() + 7); }
      else if (period === 'this_month') { pStart = new Date(today.getFullYear(), today.getMonth(), 1); }
      else if (period === 'last_month') { pStart = new Date(today.getFullYear(), today.getMonth() - 1, 1); pEnd = new Date(today.getFullYear(), today.getMonth(), 1); }
      const results: SiteStat[] = [];
      for (const site of sites) {
        const { data: sessData } = await supabase.from('cash_sessions').select('id, opening_amount, status').eq('tenant_id', tenant.id).eq('site_id', site.id).eq('status', 'open').order('opened_at', { ascending: false }).limit(1);
        const session = (sessData || [])[0];
        const salesQ = supabase.from('sales').select('total').eq('tenant_id', tenant.id).eq('site_id', site.id).gte('created_at', pStart.toISOString()).in('status', ['paid', 'partial', 'validated']);
        if (pEnd) salesQ.lt('created_at', pEnd.toISOString());
        const pmtQ = supabase.from('sale_payments').select('amount, sales!inner(site_id)').eq('tenant_id', tenant.id).eq('sales.site_id', site.id).gte('created_at', pStart.toISOString());
        if (pEnd) pmtQ.lt('created_at', pEnd.toISOString());
        const movQ = supabase.from('cash_movements').select('kind, amount, reason').eq('tenant_id', tenant.id).eq('site_id', site.id).gte('created_at', pStart.toISOString());
        if (pEnd) movQ.lt('created_at', pEnd.toISOString());
        const [{ data: salesData }, { data: collectedPmts }, { data: collectedMovs }, { data: sfData }] = await Promise.all([
          salesQ,
          pmtQ,
          movQ,
          session ? supabase.rpc('get_session_financial_summary', { p_cash_session_id: session.id }) : Promise.resolve({ data: null }),
        ]);
        const sf: any = sfData || {};
        const salesCount = (salesData || []).length;
        const todaySales = (salesData || []).reduce((s: number, r: any) => s + Number(r.total), 0);
        const todayDirectCash = (collectedMovs || []).filter((m: any) => m.kind !== 'expense' && m.kind !== 'refund' && m.kind !== 'withdrawal' && m.kind !== 'customer_loan' && m.kind !== 'vault_withdrawal' && m.kind !== 'vault_deposit' && !(m.kind === 'income' && typeof m.reason === 'string' && m.reason.startsWith('Règlement ') && !m.reason.startsWith('Règlement solde'))).reduce((s: number, m: any) => s + Number(m.amount || 0), 0);
        const todayCollected = (collectedPmts || []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0) + todayDirectCash;
        const periodExpenses = (collectedMovs || []).filter((m: any) => m.kind === 'expense').reduce((s: number, m: any) => s + Number(m.amount || 0), 0);
        const periodRefunds = (collectedMovs || []).filter((m: any) => m.kind === 'refund').reduce((s: number, m: any) => s + Number(m.amount || 0), 0);
        const periodWithdrawals = (collectedMovs || []).filter((m: any) => m.kind === 'withdrawal').reduce((s: number, m: any) => s + Number(m.amount || 0), 0);
        const periodLoans = (collectedMovs || []).filter((m: any) => m.kind === 'customer_loan').reduce((s: number, m: any) => s + Number(m.amount || 0), 0);
        const periodCashBalance = todayCollected - periodExpenses - periodRefunds - periodWithdrawals - periodLoans;
        const openingAmount = session ? Number(session.opening_amount || 0) : 0;
        const sessionEncaissements = Number(sf.encaissements || 0);
        const sessionEntrees = Number(sf.entrees_directes || 0);
        const sessionDepenses = Number(sf.depenses_session || 0);
        const sessionRemboursements = Number(sf.remboursements || 0);
        const sessionRetraits = Number(sf.retraits || 0);
        const sessionPrets = Number(sf.prets_clients || 0);
        const sessionTotalOutflows = sessionDepenses + sessionRemboursements + sessionRetraits + sessionPrets;
        const sessionCashBalance = session ? openingAmount + sessionEncaissements + sessionEntrees - sessionTotalOutflows : 0;
        const sessionSales = Number(sf.ventes_validees || 0);
        const sessionCollected = sessionEncaissements + sessionEntrees;
        const sessionSalesCount = Number(sf.nb_ventes || 0);
        results.push({
          id: site.id, name: site.name,
          todaySales: viewMode === 'session' ? sessionSales : todaySales,
          todayCollected: viewMode === 'session' ? sessionCollected : todayCollected,
          todayDirectCash: viewMode === 'session' ? sessionEntrees : todayDirectCash,
          salesCount: viewMode === 'session' ? sessionSalesCount : salesCount,
          cashBalance: viewMode === 'session' ? sessionCashBalance : periodCashBalance,
          openingAmount,
          sessionOpen: !!session,
          expenses: viewMode === 'session' ? sessionTotalOutflows : periodExpenses,
        });
      }
      if (!cancelled) setMultiSiteStats(results);
    })();
    return () => { cancelled = true; };
  }, [hasMultiSites, tenant?.id, sites.length, stats.todaySales, viewMode, period]);

  // ── Top articles du jour (single-site fallback) ─────────────────────────
  type TopArticle = { article_id: string; name: string; quantity: number; total: number };
  const [topArticles, setTopArticles] = useState<TopArticle[]>([]);
  const [topArticlesLoading, setTopArticlesLoading] = useState(false);
  useEffect(() => {
    if (hasMultiSites || !tenant || !currentSite) return;
    let cancelled = false;
    (async () => {
      setTopArticlesLoading(true);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const yest = new Date(today); yest.setDate(yest.getDate() - 1);
      let periodStart: Date;
      let periodEnd: Date | null;
      if (period === 'yesterday') {
        periodStart = yest;
        periodEnd = today;
      } else if (period === 'this_week') {
        periodStart = new Date(today);
        const dow = periodStart.getDay();
        periodStart.setDate(periodStart.getDate() - (dow === 0 ? 6 : dow - 1));
        periodEnd = null;
      } else if (period === 'last_week') {
        periodStart = new Date(today);
        const dow = periodStart.getDay();
        periodStart.setDate(periodStart.getDate() - (dow === 0 ? 6 : dow - 1) - 7);
        periodEnd = new Date(periodStart);
        periodEnd.setDate(periodEnd.getDate() + 7);
      } else if (period === 'this_month') {
        periodStart = new Date(today.getFullYear(), today.getMonth(), 1);
        periodEnd = null;
      } else if (period === 'last_month') {
        periodStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        periodEnd = new Date(today.getFullYear(), today.getMonth(), 1);
      } else {
        periodStart = today;
        periodEnd = null;
      }
      const salesQ = supabase
        .from('sales')
        .select('id')
        .eq('tenant_id', tenant.id)
        .eq('site_id', currentSite.id)
        .gte('created_at', periodStart.toISOString())
        .in('status', ['paid', 'partial', 'validated']);
      if (periodEnd) salesQ.lt('created_at', periodEnd.toISOString());
      const { data: salesRows } = await salesQ;
      const saleIds = (salesRows || []).map((r: any) => r.id);
      if (saleIds.length === 0) {
        if (!cancelled) { setTopArticles([]); setTopArticlesLoading(false); }
        return;
      }
      const { data: items } = await supabase
        .from('sale_items')
        .select('article_id, name, quantity, total')
        .eq('tenant_id', tenant.id)
        .in('sale_id', saleIds);
      const agg = new Map<string, TopArticle>();
      for (const it of items || []) {
        const key = String(it.article_id);
        const prev = agg.get(key);
        if (prev) {
          prev.quantity += Number(it.quantity || 0);
          prev.total += Number(it.total || 0);
        } else {
          agg.set(key, {
            article_id: key,
            name: String(it.name || '—'),
            quantity: Number(it.quantity || 0),
            total: Number(it.total || 0),
          });
        }
      }
      const list = Array.from(agg.values()).sort((a, b) => b.total - a.total).slice(0, 50);
      if (!cancelled) { setTopArticles(list); setTopArticlesLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [hasMultiSites, tenant?.id, currentSite?.id, stats.todaySales, period]);

  const lastSaleTime = stats.recentSales.length > 0
    ? new Date(stats.recentSales[0].created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : null;

  // ── Quick-action FAB overlay ──────────────────────────────────────────
  const [fabOpen, setFabOpen] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);

  return (
    <div className="min-h-full bg-white animate-fade-in">
      {/* ── STICKY: TOP BAR ONLY ── */}
      <div className="sticky top-0 z-20 bg-white border-b border-neutral-100">
      {/* ── TOP BAR — single clean row ── */}
      <div className="pl-14 pr-5 xl:pr-8 h-[72px] flex items-center gap-6">
        {/* LEFT: title */}
        <h1 className="text-[15px] font-bold text-neutral-900 tracking-tight whitespace-nowrap shrink-0">Tableau de bord</h1>

        {/* CENTER group */}
        <div className="flex items-center gap-5 ml-2">
          {/* Période / Session — underline tabs, no card */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => toggleViewMode('period')}
              className={`relative pb-1 text-xs font-semibold transition-colors ${
                viewMode === 'period' ? 'text-neutral-900' : 'text-neutral-400 hover:text-neutral-600'
              }`}
            >
              Période
              {viewMode === 'period' && <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-neutral-900 rounded-full" />}
            </button>
            <button
              onClick={() => toggleViewMode('session')}
              className={`relative pb-1 text-xs font-semibold transition-colors ${
                viewMode === 'session' ? 'text-neutral-900' : 'text-neutral-400 hover:text-neutral-600'
              }`}
            >
              Session
              {viewMode === 'session' && <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-neutral-900 rounded-full" />}
            </button>
          </div>

          {/* Subtle vertical separator */}
          <div className="w-px h-5 bg-neutral-200" />

          {/* Date selector — no card, inline */}
          {viewMode !== 'session' && (
            <div className="relative">
              <button
                onClick={() => setShowPeriodMenu(!showPeriodMenu)}
                className="flex items-center gap-1.5 text-xs text-neutral-600 hover:text-neutral-900 transition-colors"
              >
                <Calendar className="w-3.5 h-3.5 text-neutral-400" />
                <span className="font-medium">{periodLabel}</span>
                <ChevronDown className={`w-3.5 h-3.5 text-neutral-400 transition-transform ${showPeriodMenu ? 'rotate-180' : ''}`} />
              </button>
              {showPeriodMenu && (
                <div className="absolute top-full left-0 mt-2 w-56 bg-white rounded-xl border border-neutral-200 shadow-elevated z-50 py-1">
                  {periodOptions.map((opt: any) => (
                    <button
                      key={opt.value}
                      onClick={() => { setPeriod(opt.value); setShowPeriodMenu(false); }}
                      className={`w-full text-left px-4 py-2.5 text-xs font-medium transition-colors ${period === opt.value ? 'bg-neutral-100 text-neutral-900 font-semibold' : 'text-neutral-600 hover:bg-neutral-50'}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Actions rapides — inline, no card */}
          <button
            onClick={() => setFabOpen(true)}
            className="flex items-center gap-1.5 text-xs text-neutral-600 hover:text-neutral-900 transition-colors active:scale-95"
          >
            <Activity className="w-3.5 h-3.5 text-neutral-400" />
            <span className="font-medium">Actions rapides</span>
          </button>
        </div>

        {/* RIGHT group */}
        <div className="ml-auto flex items-center gap-4">
          {/* Subscription badge — compact with expiry */}
          {subInfo && (
            <button onClick={() => nav('settings', { target: 'subscription' })} className="flex items-center gap-1.5 text-xs hover:opacity-70 transition-opacity">
              <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
                subInfo.status === 'trial_active' ? 'bg-blue-50 text-blue-600'
                  : subInfo.status === 'active' ? 'bg-emerald-50 text-emerald-600'
                  : subInfo.status === 'expired' ? 'bg-red-50 text-red-600'
                  : 'bg-amber-50 text-amber-600'
              }`}>
                {subInfo.status === 'trial_active' ? 'Essai' : subInfo.status === 'active' ? 'Actif' : subInfo.status === 'expired' ? 'Expiré' : 'En attente'}
              </span>
              <span className="font-semibold text-neutral-700 max-w-[100px] truncate">{subInfo.planName}</span>
              {subInfo.expiresAt && (
                <span className={`text-[10px] font-medium ${subInfo.status === 'expired' ? 'text-red-500' : 'text-neutral-400'}`}>
                  {subInfo.status === 'expired' ? 'Expiré le' : "jusqu'au"} {new Date(subInfo.expiresAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
              )}
              {subInfo.billingCycle === 'lifetime' && !subInfo.expiresAt && (
                <span className="text-[10px] font-medium text-emerald-500">à vie</span>
              )}
            </button>
          )}

          {/* Subtle vertical separator */}
          <div className="w-px h-5 bg-neutral-200" />

          {/* Site selector — inline, no card */}
          {hasMultiSites && (
            <div className="relative">
              <button
                onClick={() => setSiteOpen(!siteOpen)}
                className="flex items-center gap-1.5 text-xs text-neutral-700 hover:text-neutral-900 transition-colors"
              >
                <Network className="w-3.5 h-3.5 text-neutral-400" />
                <span className="font-semibold">{currentSite?.name}</span>
                <ChevronDown className={`w-3.5 h-3.5 text-neutral-400 transition-transform ${siteOpen ? 'rotate-180' : ''}`} />
              </button>
              {siteOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setSiteOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 w-60 bg-white rounded-xl border border-neutral-200 shadow-elevated py-1 z-50 max-h-80 overflow-y-auto">
                    <div className="px-3 py-1.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">Magasins</div>
                    {sites.map((s: any) => {
                      const isActive = currentSite?.id === s.id;
                      return (
                        <div
                          key={s.id}
                          className={`flex items-center gap-2 px-2.5 py-2 mx-1 rounded-lg cursor-pointer transition-colors ${isActive ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}
                          onClick={() => { if (isActive) { setSiteOpen(false); return; } setCurrentSite(s); setSiteOpen(false); }}
                        >
                          <div className={`w-[18px] h-[18px] rounded border-2 flex items-center justify-center shrink-0 ${isActive ? 'border-neutral-900 bg-neutral-900' : 'border-neutral-300'}`}>
                            {isActive && <CheckIcon className="w-2.5 h-2.5 text-white" />}
                          </div>
                          <span className={`flex-1 text-sm truncate ${isActive ? 'font-semibold text-neutral-900' : 'text-neutral-600'}`}>{s.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* User — compact, no card */}
          <div className="relative">
            <button
              onClick={() => setUserOpen(v => !v)}
              className="flex items-center gap-2 pl-0.5 pr-1 h-9 rounded-lg hover:bg-neutral-50 transition-colors"
            >
              <div className="w-7 h-7 rounded-lg bg-neutral-900 flex items-center justify-center text-white text-[11px] font-bold">
                {(profile?.full_name || profile?.email || '?').charAt(0).toUpperCase()}
              </div>
              <div className="text-left leading-tight">
                <div className="text-[12px] font-semibold text-neutral-900 whitespace-nowrap max-w-[120px] truncate">{profile?.full_name || profile?.email}</div>
                <div className="text-[9px] text-neutral-400 uppercase tracking-wider font-medium">{profile?.role}</div>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-neutral-400" />
            </button>
            {userOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setUserOpen(false)} />
                <div className="absolute right-0 mt-2 w-56 bg-white border border-neutral-200 rounded-xl shadow-elevated py-1 animate-slide-down z-20">
                  <div className="px-3 py-2.5 border-b border-neutral-100">
                    <div className="text-sm font-semibold text-neutral-900 truncate">{profile?.full_name}</div>
                    <div className="text-xs text-neutral-500 truncate">{profile?.email}</div>
                  </div>
                  <button onClick={() => { setUserOpen(false); nav('settings'); }} className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-50 flex items-center gap-2 transition-colors">
                    <Monitor className="w-4 h-4 text-neutral-400" /> Paramètres
                  </button>
                  <button onClick={() => { setUserOpen(false); signOut(); }} className="w-full text-left px-3 py-2 text-sm hover:bg-red-50 text-red-600 flex items-center gap-2 transition-colors">
                    <LogOut className="w-4 h-4" /> Déconnexion
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── FAB Overlay — Quick actions ── */}
      {fabOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
          <div className="absolute inset-0 bg-white/80 backdrop-blur-sm" onClick={() => setFabOpen(false)} />
          <div className="relative z-10 w-full max-w-lg px-6">
            <div className="bg-white rounded-xl border border-neutral-200 shadow-premium p-6 animate-scale-in">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-base font-bold text-neutral-900">Actions rapides</h2>
                <button onClick={() => setFabOpen(false)} className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { icon: ShoppingCart, label: 'Nouvelle vente', color: 'text-neutral-700', bg: 'bg-neutral-100', action: () => { setFabOpen(false); nav('pos', { target: 'directPos' }); } },
                  { icon: CreditCard, label: 'Encaisser', color: 'text-neutral-700', bg: 'bg-neutral-100', action: () => { setFabOpen(false); nav('pos', { target: 'directPos' }); } },
                  { icon: ClipboardList, label: 'Nouvelle commande', color: 'text-neutral-700', bg: 'bg-neutral-100', action: () => { setFabOpen(false); nav('supplier_orders', { target: 'newOrder' }); } },
                  { icon: Users, label: 'Nouveau client', color: 'text-neutral-700', bg: 'bg-neutral-100', action: () => { setFabOpen(false); nav('tiers', { target: 'newCustomer' }); } },
                  { icon: Truck, label: 'Nouveau fournisseur', color: 'text-neutral-700', bg: 'bg-neutral-100', action: () => { setFabOpen(false); nav('tiers', { target: 'newSupplier' }); } },
                  { icon: ArrowDownCircle, label: 'Entrée stock', color: 'text-neutral-700', bg: 'bg-neutral-100', action: () => { setFabOpen(false); nav('stock', { target: 'stockIn' }); } },
                  { icon: ArrowUpCircle, label: 'Sortie stock', color: 'text-neutral-700', bg: 'bg-neutral-100', action: () => { setFabOpen(false); nav('stock', { target: 'stockOut' }); } },
                  { icon: ArrowRightLeft, label: 'Transfert', color: 'text-neutral-700', bg: 'bg-neutral-100', action: () => { setFabOpen(false); nav('stock', { target: 'stockTransfer' }); } },
                  { icon: BarChart3, label: 'Rapport', color: 'text-neutral-700', bg: 'bg-neutral-100', action: () => { setFabOpen(false); nav('reports'); } },
                ].map(item => (
                  <button
                    key={item.label}
                    onClick={item.action}
                    className="flex flex-col items-center gap-2 p-4 rounded-xl border border-neutral-100 hover:border-neutral-200 hover:bg-neutral-50 transition-all active:scale-[0.96] group"
                  >
                    <div className={`w-9 h-9 rounded-lg ${item.bg} flex items-center justify-center`}>
                      <item.icon className={`w-[18px] h-[18px] ${item.color}`} />
                    </div>
                    <span className="text-[11px] font-medium text-neutral-700 text-center leading-tight">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      </div>{/* closes sticky top bar wrapper */}

      {/* ── Hero + Rentabilité (left column) + Situation actuelle (right column) ── */}
      <div className="px-1 xl:px-2 pt-2 pb-1">
        <div className="flex gap-2 items-stretch">
          {/* Left column: Hero + Rentabilité stacked */}
          <div className="flex-1 flex flex-col gap-2 min-w-0">
          {/* Situation du jour */}
          <div
            className="relative overflow-hidden rounded-xl p-5 flex flex-col transition-all duration-300"
            style={heroLight
              ? { background: '#ffffff', boxShadow: '0 4px 20px rgba(15,23,42,0.08), 0 0 0 1px rgba(226,232,240,0.6)' }
              : { background: '#000000', boxShadow: '0 16px 32px -8px rgba(0,0,0,0.55), 0 6px 12px -4px rgba(0,0,0,0.25)' }
            }
          >
            {!heroLight && (
              <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-xl">
                <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-gradient-to-br from-white/5 to-transparent blur-3xl" />
                <div className="absolute -bottom-20 -left-10 w-48 h-48 rounded-full bg-gradient-to-tr from-white/3 to-transparent blur-3xl" />
              </div>
            )}
            <div className="relative flex flex-col h-full">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <TrendingUp className={`w-5 h-5 ${heroLight ? 'text-neutral-700' : 'text-white/70'}`} />
                <h2 className={`text-base font-bold ${heroLight ? 'text-neutral-900' : 'text-white'}`}>{viewMode === 'session' ? 'Session de caisse' : `Situation ${period === 'today' ? 'du jour' : period === 'yesterday' ? "d'hier" : ''}`}</h2>
              </div>
              <button
                onClick={toggleHeroTheme}
                className={`text-xs font-semibold active:scale-95 transition-transform ${heroLight ? 'text-neutral-400 hover:text-neutral-700' : 'text-white/40 hover:text-white/80'}`}
                aria-label="Changer le thème"
              >
                {heroLight ? 'Clair' : 'Sombre'}
              </button>
            </div>

            <div className="grid grid-cols-[minmax(185px,1.35fr)_minmax(0,4fr)] items-center gap-5 flex-1 min-h-0">
              {/* Main amount */}
              <div>
                <p className={`text-[11px] font-medium mb-1 ${heroLight ? 'text-neutral-400' : 'text-white/50'}`}>{viewMode === 'session' ? 'CA net session' : `Encaissements ${period === 'today' ? 'du jour' : period === 'yesterday' ? "d'hier" : 'de la période'}`}</p>
                <p className={`text-3xl font-bold num tracking-tight leading-none ${heroLight ? 'text-neutral-900' : 'text-white'}`}>{formatFCFA(viewMode === 'session' ? stats.sessionCaNet : stats.todayCollected)}</p>
              </div>

              {/* KPI Line — divider-separated, no mini-cards */}
              {viewMode === 'session' ? (
                <div className="flex items-center gap-3 min-w-0">
                  <KpiItem light={heroLight} label="Nb ventes" value={String(stats.sessionNbVentes)} />
                  <KpiDivider light={heroLight} />
                  <KpiItem light={heroLight} label="Encaissements" value={formatCompactFCFA(stats.sessionEncaissements)} />
                  {canViewMargin && <>
                    <KpiDivider light={heroLight} />
                    <KpiItem light={heroLight} label="Marge brute" value={formatCompactFCFA(stats.sessionMargeBrute)} sub={stats.sessionTauxMarge > 0 ? `${Math.round(stats.sessionTauxMarge)}%` : undefined} />
                  </>}
                  <KpiDivider light={heroLight} />
                  <KpiItem light={heroLight} label="Ventes à crédit" value={String(stats.sessionCreditCount)} sub={formatCompactFCFA(stats.sessionCreditTotal)} />
                  <KpiDivider light={heroLight} />
                  <KpiItem light={heroLight} label="Dépenses" value={formatCompactFCFA(stats.sessionDepenses)} negative />
                  <KpiDivider light={heroLight} />
                  <KpiItem light={heroLight} label="Caisse théorique" value={formatCompactFCFA((stats.sessionInfo?.openingAmount || 0) + stats.sessionEncaissements + stats.sessionEntreesDirectes - stats.sessionDepenses - stats.sessionRemboursements - stats.sessionRetraits - stats.sessionPretsClients)} />
                </div>
              ) : (
                <div className="flex items-center gap-3 min-w-0">
                  <KpiItem light={heroLight} label="CA net" value={formatCompactFCFA(stats.todaySales)} />
                  <KpiDivider light={heroLight} />
                  <KpiItem light={heroLight} label="Encaiss. directs" value={formatCompactFCFA(stats.todayDirectCash)} />
                  <KpiDivider light={heroLight} />
                  <KpiItem light={heroLight} label="Ventes" value={String(stats.todayCount)} />
                  <KpiDivider light={heroLight} />
                  <KpiItem light={heroLight} label="Solde caisse" value={formatCompactFCFA(stats.periodCashBalance)} />
                  <KpiDivider light={heroLight} />
                  <KpiItem light={heroLight} label="Dépenses" value={formatCompactFCFA(stats.periodExpenses)} negative />
                  <KpiDivider light={heroLight} />
                  <KpiItem light={heroLight} label="Créances" value={formatCompactFCFA(stats.receivables)} sub={`${stats.customersToChase} client${stats.customersToChase > 1 ? 's' : ''}`} accent={stats.receivables > 0 ? 'amber' : undefined} />
                </div>
              )}
            </div>

            {/* Footer */}
            <div className={`flex items-center justify-between pt-3 mt-3 border-t ${heroLight ? 'border-neutral-100' : 'border-white/10'}`}>
              {lastSaleTime && (
                <div className={`flex items-center gap-1.5 text-xs ${heroLight ? 'text-neutral-400' : 'text-white/40'}`}>
                  <Clock className="w-3.5 h-3.5" />
                  Dernière vente à {lastSaleTime}
                </div>
              )}
              <button onClick={() => nav('sales')} className={`flex items-center gap-1 text-xs font-semibold transition-colors ml-auto ${heroLight ? 'text-neutral-900 hover:text-neutral-600' : 'text-white/80 hover:text-white'}`}>
                Voir le détail <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          </div>

          {/* ── RENTABILITÉ — single analytical band (permission-gated) ── */}
          {canViewMargin && (
            <div className="bg-white rounded-xl border border-neutral-200 px-5 py-3">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-neutral-700" />
                <h2 className="text-sm font-bold text-neutral-900">{viewMode === 'session' ? 'Rentabilité · Session' : 'Rentabilité'}</h2>
                <span className="text-[10px] text-neutral-400 font-medium ml-1">{viewMode === 'session' ? 'Session en cours' : periodLabel}</span>
              </div>
              <div className="grid grid-cols-4 items-stretch gap-x-6">
                <div className="flex flex-col">
                  <p className="text-[10px] font-medium text-neutral-500 uppercase tracking-wide mb-0.5">Marge brute</p>
                  <p className="text-lg font-bold text-neutral-900 num leading-tight">{formatCompactFCFA(viewMode === 'session' ? stats.sessionMargeBrute : stats.periodMargeBrute)}</p>
                  {(viewMode === 'session' ? stats.sessionTauxMarge : stats.periodTauxMarge) > 0 && <p className="text-[10px] text-neutral-400 mt-0.5 num">{Math.round(viewMode === 'session' ? stats.sessionTauxMarge : stats.periodTauxMarge)}% de marge</p>}
                </div>
                <div className="flex flex-col border-l border-neutral-200 pl-6">
                  <p className="text-[10px] font-medium text-neutral-500 uppercase tracking-wide mb-0.5">{viewMode === 'session' ? 'Dépenses session' : 'Charges exploit.'}</p>
                  <p className={`text-lg font-bold num leading-tight ${(viewMode === 'session' ? stats.sessionDepenses : stats.periodCharges) > 0 ? 'text-red-600' : 'text-neutral-900'}`}>{formatCompactFCFA(viewMode === 'session' ? stats.sessionDepenses : stats.periodCharges)}</p>
                </div>
                <div className="flex flex-col border-l border-neutral-200 pl-6">
                  <p className="text-[10px] font-medium text-neutral-500 uppercase tracking-wide mb-0.5">{viewMode === 'session' ? 'Résultat session' : 'Résultat exploit.'}</p>
                  <p className={`text-lg font-bold num leading-tight ${(viewMode === 'session' ? stats.sessionResultat : stats.periodResultat) < 0 ? 'text-red-600' : 'text-neutral-900'}`}>{(viewMode === 'session' ? stats.sessionResultat : stats.periodResultat) < 0 ? '-' : ''}{formatCompactFCFA(Math.abs(viewMode === 'session' ? stats.sessionResultat : stats.periodResultat))}</p>
                </div>
                <div className="flex flex-col border-l border-neutral-200 pl-6">
                  <p className="text-[10px] font-medium text-neutral-500 uppercase tracking-wide mb-0.5">Ticket moyen</p>
                  <p className="text-lg font-bold text-neutral-900 num leading-tight">{(viewMode === 'session' ? stats.sessionNbVentes : stats.todayCount) > 0 ? formatCompactFCFA(Math.round((viewMode === 'session' ? stats.sessionCaNet : stats.todaySales) / (viewMode === 'session' ? stats.sessionNbVentes : stats.todayCount))) : '--'}</p>
                </div>
              </div>
            </div>
          )}
          </div>

          {/* Right column — single "Situation actuelle" block */}
          <div className="w-[300px] shrink-0 flex flex-col bg-white rounded-xl border border-neutral-200 px-5 py-4">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-neutral-900">Situation actuelle</h2>
              </div>
              <span className="text-[8px] font-bold text-neutral-400 uppercase tracking-wider">État de l'entreprise</span>
            </div>

            {/* Créances clients */}
            <button onClick={() => nav('tiers')} className="flex items-center justify-between py-3 border-b border-neutral-100 text-left group">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Users className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                  <span className="text-xs font-semibold text-neutral-600">Créances clients</span>
                </div>
                <p className="text-[11px] text-neutral-400 mt-0.5 ml-5.5">{stats.customersToChase} client{stats.customersToChase > 1 ? 's' : ''} a relancer</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-lg font-bold text-neutral-900 num tracking-tight">{formatFCFA(stats.receivables)}</span>
                <ChevronRight className="w-3.5 h-3.5 text-neutral-300 group-hover:text-neutral-500 transition-colors" />
              </div>
            </button>

            {/* Dettes fournisseurs */}
            <button onClick={() => nav('supplier_orders')} className="flex items-center justify-between py-3 border-b border-neutral-100 text-left group">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Truck className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                  <span className="text-xs font-semibold text-neutral-600">Dettes fournisseurs</span>
                </div>
                <p className="text-[11px] text-neutral-400 mt-0.5 ml-5.5">{stats.suppliersToChase} fournisseur{stats.suppliersToChase > 1 ? 's' : ''} a payer</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-lg font-bold text-neutral-900 num tracking-tight">{formatFCFA(stats.payables)}</span>
                <ChevronRight className="w-3.5 h-3.5 text-neutral-300 group-hover:text-neutral-500 transition-colors" />
              </div>
            </button>

            {/* Stock à surveiller */}
            <button onClick={() => nav('stock')} className="flex-1 flex flex-col justify-center py-3 text-left group min-h-0">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Package className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                  <span className="text-xs font-semibold text-neutral-600">Stock a surveiller</span>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-neutral-300 group-hover:text-neutral-500 transition-colors" />
              </div>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 ml-5.5">
                <div className="flex items-baseline gap-1">
                  <span className="text-sm font-bold text-red-600 num">{stats.outOfStockCount}</span>
                  <span className="text-[9px] text-neutral-400">Ruptures</span>
                </div>
                <div className="w-px h-3 bg-neutral-200" />
                <div className="flex items-baseline gap-1">
                  <span className="text-sm font-bold text-neutral-700 num">{stats.lowStockCount}</span>
                  <span className="text-[9px] text-neutral-400">Stock bas</span>
                </div>
                <div className="w-px h-3 bg-neutral-200" />
                <div className="flex items-baseline gap-1">
                  <span className="text-sm font-bold text-neutral-900 num">{stats.outOfStockCount + stats.lowStockCount}</span>
                  <span className="text-[9px] text-neutral-400">A commander</span>
                </div>
              </div>
            </button>
          </div>
        </div>

      </div>{/* closes normal-scroll section: hero + rentabilité */}

      {/* ── Cards area (scrolls below hero) ── */}
      <div className="relative z-0 px-1 xl:px-2 pt-2 pb-2 space-y-2">

        {/* ── ROW 2: Vue multi-magasins (2+ sites) ou Top articles du jour (1 site) ── */}
        {hasMultiSites ? (multiSiteStats.length > 0 && (
          <div className="bg-white rounded-xl border border-neutral-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <Network className="w-4.5 h-4.5 text-neutral-700" />
                <h2 className="text-sm font-bold text-neutral-900">Vue multi-magasins</h2>
                <span className="text-[10px] text-neutral-500 font-semibold">{sites.length} magasins</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-neutral-400">Total encaissé :</span>
                <span className="text-xs font-bold text-neutral-900 num">{formatFCFA(multiSiteStats.reduce((s: number, x: any) => s + (viewMode === 'session' && !x.sessionOpen ? 0 : x.todayCollected), 0))}</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider border-b border-neutral-100">
                    <th className="text-left py-2.5 pl-2 pr-4">Magasin</th>
                    <th className="text-right py-2.5 px-3">Facturé</th>
                    <th className="text-right py-2.5 px-3">Encaissé</th>
                    <th className="text-right py-2.5 px-3">Dépenses</th>
                    <th className="text-right py-2.5 px-3">Solde caisse</th>
                    <th className="text-right py-2.5 pl-3 pr-2">État</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-50">
                  {multiSiteStats.map((site: any) => {
                    const isCurrent = site.id === currentSite?.id;
                    return (
                      <tr
                        key={site.id}
                        onClick={() => { const s = sites.find((x: any) => x.id === site.id); if (s) setCurrentSite(s); }}
                        className={`cursor-pointer transition-colors ${isCurrent ? 'bg-neutral-50/60' : 'hover:bg-neutral-50/40'}`}
                      >
                        <td className="py-3 pl-2 pr-4">
                          <div className="flex items-center gap-2">
                            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${site.sessionOpen ? 'bg-neutral-900' : 'bg-neutral-300'}`} />
                            <span className={`text-sm truncate ${isCurrent ? 'font-bold text-neutral-900' : 'font-semibold text-neutral-700'}`}>{site.name}</span>
                            {isCurrent && <span className="text-[8px] font-bold text-neutral-500 shrink-0 uppercase tracking-wider">Actif</span>}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right text-sm font-bold text-neutral-800 num">{viewMode === 'session' && !site.sessionOpen ? '—' : formatCompactFCFA(site.todaySales)}</td>
                        <td className="py-3 px-3 text-right text-sm font-bold text-neutral-900 num">{viewMode === 'session' && !site.sessionOpen ? '—' : formatCompactFCFA(site.todayCollected)}</td>
                        <td className="py-3 px-3 text-right text-sm font-bold text-red-600 num">{viewMode === 'session' && !site.sessionOpen ? '—' : (site.expenses > 0 ? `-${formatCompactFCFA(site.expenses)}` : '0')}</td>
                        <td className={`py-3 px-3 text-right text-sm font-black num ${site.sessionOpen ? 'text-neutral-900' : 'text-neutral-400'}`}>{site.sessionOpen ? formatCompactFCFA(site.cashBalance) : '—'}</td>
                        <td className="py-3 pl-3 pr-2 text-right">
                          <span className={`text-[10px] font-bold ${site.sessionOpen ? 'text-neutral-700' : 'text-neutral-400'}`}>{site.sessionOpen ? 'Ouverte' : 'Fermée'}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )) : (
          <div className="bg-white rounded-xl border border-neutral-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Award className="w-5 h-5 text-neutral-700" />
                <h2 className="text-base font-bold text-neutral-900">Top articles</h2>
                <span className="text-xs text-neutral-500 font-semibold">{periodLabel}</span>
                {topArticles.length > 0 && (
                  <span className="text-xs text-neutral-500 font-semibold">{topArticles.length}</span>
                )}
              </div>
              <button
                onClick={() => nav('sales')}
                className="inline-flex items-center gap-1 text-xs font-semibold text-neutral-500 hover:text-neutral-900 transition-colors"
              >
                Voir le journal des ventes
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
            {topArticlesLoading ? (
              <div className="flex items-center justify-center py-12 text-neutral-400">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : topArticles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="w-12 h-12 rounded-full bg-neutral-50 flex items-center justify-center mb-3">
                  <Package className="w-5 h-5 text-neutral-300" />
                </div>
                <p className="text-sm font-semibold text-neutral-700">Aucune vente sur la période</p>
                <p className="text-xs text-neutral-400 mt-1">Les articles vendus apparaitront ici en temps reel.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-neutral-100">
                <div className="max-h-[330px] overflow-y-auto">
                  <table className="w-full">
                    <thead className="sticky top-0 z-10 bg-neutral-50/95 backdrop-blur">
                      <tr className="border-b border-neutral-100">
                        <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400 w-10">#</th>
                        <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Article</th>
                        <th className="text-right px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400 w-28">Quantité</th>
                        <th className="text-right px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400 w-32">Chiffre d&apos;affaires</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {(() => {
                        const maxTotal = Math.max(...topArticles.map(a => a.total), 1);
                        return topArticles.map((art, idx) => {
                          const pct = Math.round((art.total / maxTotal) * 100);
                          return (
                            <tr key={art.article_id} className="hover:bg-neutral-50/50 transition-colors">
                              <td className="px-4 py-3">
                                <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold ${idx === 0 ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'}`}>
                                  {idx + 1}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="text-sm font-semibold text-neutral-900 truncate max-w-md">{art.name}</div>
                                <div className="mt-1.5 h-1 rounded-full bg-neutral-100 overflow-hidden">
                                  <div className="h-full bg-neutral-900 rounded-full transition-all" style={{ width: `${pct}%` }} />
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right text-sm font-bold text-neutral-800 num">{art.quantity}</td>
                              <td className="px-4 py-3 text-right text-sm font-bold text-neutral-900 num">{formatFCFA(art.total)}</td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── ROW 3: Activité récente + Priorités du jour + Mouvements de caisse ── */}
        <div className="flex flex-col xl:flex-row gap-2">
          {/* Activité récente */}
          <div className="flex-1 min-w-0 bg-white rounded-xl border border-neutral-200 p-3 flex flex-col h-[260px]">
            <div className="flex items-center justify-between mb-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <Clock className="w-4 h-4 text-neutral-500" />
                <h2 className="text-sm font-bold text-neutral-900">Activités récentes</h2>
              </div>
              {stats.recentActivities.length > 0 && (
                <button onClick={() => nav('sales')} className="flex items-center gap-1 text-xs font-bold text-neutral-900 hover:text-neutral-600 transition-colors shrink-0">
                  Voir toute l'activité <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 pr-1.5 -mr-1.5" style={{ scrollbarGutter: 'stable' } as React.CSSProperties}>
              <table className="w-full">
                <thead className="sticky top-0 bg-white z-10">
                  <tr className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider border-b border-neutral-100">
                    <th className="text-left py-2 pr-1 w-10">Type</th>
                    <th className="text-left py-2 pr-2">Réf</th>
                    <th className="text-left py-2 pr-2">Tiers</th>
                    <th className="text-left py-2 pr-2 whitespace-nowrap">Par</th>
                    <th className="text-right py-2 pr-2 whitespace-nowrap">Date</th>
                    <th className="text-right py-2">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recentActivities.slice(0, 9).map((act: ActivityItem) => {
                    const codeMap: Record<ActivityItem['type'], string> = {
                      sale: 'VTE',
                      quote: 'DEV',
                      supplier_order: 'CMD',
                      payment_received: 'REG',
                      online_order: 'WEB',
                      stock_movement: 'STK',
                      return: 'RET',
                      expense: 'MVT',
                    };
                    const isMovement = act.type === 'expense';
                    const refPart = isMovement ? act.title : act.title.split(' ').slice(1).join(' ');
                    const clientPart = isMovement ? '' : act.detail.split(' · ')[0];
                    const d = act.time ? new Date(act.time) : null;
                    const dateStr = d
                      ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
                      : '';
                    return (
                      <tr key={act.id} onClick={() => nav(act.route, act.highlightId ? { highlightId: act.highlightId, ...(act.routeCtx || {}) } : act.routeCtx)} className="border-b border-neutral-50 hover:bg-neutral-50/50 cursor-pointer transition-colors whitespace-nowrap">
                        <td className="py-2 pr-1">
                          <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wide">{codeMap[act.type]}</span>
                        </td>
                        <td className="py-2 pr-2">
                          <span className="text-xs font-semibold text-neutral-700 truncate max-w-[100px] inline-block align-bottom">{refPart}</span>
                        </td>
                        <td className="py-2 pr-2 max-w-[120px]">
                          {clientPart ? <span className="text-xs text-neutral-500 truncate inline-block align-bottom max-w-full">{clientPart}</span> : <span className="text-[10px] text-neutral-300">—</span>}
                        </td>
                        <td className="py-2 pr-2">
                          {act.userName ? <span className="text-[10px] text-neutral-400 font-medium whitespace-nowrap">{act.userName}</span> : <span className="text-[10px] text-neutral-300">—</span>}
                        </td>
                        <td className="py-2 pr-2 text-right">
                          <span className="text-[10px] text-neutral-400 num whitespace-nowrap">{dateStr}</span>
                        </td>
                        <td className="py-2 text-right">
                          {act.amount !== null && (
                            <span className={`text-xs font-bold num ${act.amountType === 'positive' ? 'text-neutral-900' : act.amountType === 'negative' ? 'text-rose-500' : 'text-neutral-600'}`}>
                              {act.amountType === 'positive' ? '+' : act.amountType === 'negative' ? '-' : ''}{formatCompactFCFA(Math.abs(act.amount))}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {stats.recentActivities.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Activity className="w-8 h-8 text-neutral-200 mb-2" />
                  <p className="text-xs text-neutral-400">Aucune activité récente</p>
                </div>
              )}
            </div>
          </div>

          {/* Mouvements de caisse + Priorités du jour — carte fusionnée */}
          <div className="w-full xl:w-[500px] shrink-0 bg-white rounded-xl border border-neutral-200 p-3 flex flex-col overflow-hidden xl:h-[260px]">
            {/* Section haute: Mouvements de caisse */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <Coins className="w-4 h-4 text-neutral-700 shrink-0" />
                <h2 className="text-sm font-bold text-neutral-900 truncate">Mouvements de caisse</h2>
              </div>
              <span className="text-[10px] font-medium text-neutral-500 shrink-0 ml-2">{viewMode === 'session' ? 'Session' : periodLabel}</span>
            </div>
            <div className="space-y-1">
              {viewMode === 'session' ? (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs text-neutral-500 leading-tight">Solde d'ouverture</span>
                    <span className="text-xs font-semibold text-neutral-800 num text-right shrink-0">{formatCompactFCFA(stats.sessionInfo?.openingAmount || 0)}</span>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs text-neutral-500 leading-tight">Encaissements</span>
                    <span className="text-xs font-bold text-neutral-900 num text-right shrink-0">+{formatCompactFCFA(stats.sessionEncaissements)}</span>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs text-neutral-500 leading-tight">Entrées directes</span>
                    <span className="text-xs font-bold text-neutral-900 num text-right shrink-0">+{formatCompactFCFA(stats.sessionEntreesDirectes)}</span>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs text-neutral-500 leading-tight">Dépenses</span>
                    <span className="text-xs font-bold text-rose-500 num text-right shrink-0">-{formatCompactFCFA(stats.sessionDepenses)}</span>
                  </div>
                  {stats.sessionRemboursements > 0 && (
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs text-neutral-500 leading-tight">Remboursements</span>
                      <span className="text-xs font-bold text-rose-500 num text-right shrink-0">-{formatCompactFCFA(stats.sessionRemboursements)}</span>
                    </div>
                  )}
                  {stats.sessionRetraits > 0 && (
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs text-neutral-500 leading-tight">Retraits</span>
                      <span className="text-xs font-bold text-rose-500 num text-right shrink-0">-{formatCompactFCFA(stats.sessionRetraits)}</span>
                    </div>
                  )}
                  {stats.sessionPretsClients > 0 && (
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs text-neutral-500 leading-tight">Prêts clients</span>
                      <span className="text-xs font-bold text-rose-500 num text-right shrink-0">-{formatCompactFCFA(stats.sessionPretsClients)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 pt-1.5 mt-1 border-t border-neutral-200">
                    <button onClick={() => nav('cash_history')} className="flex items-center gap-1 text-xs font-bold text-neutral-900 hover:text-neutral-600 transition-colors">
                      Voir le détail <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                    <div className="flex items-baseline gap-2 shrink-0">
                      <span className="text-xs font-bold text-neutral-900 leading-tight">Solde actuel</span>
                      <span className="text-sm font-black text-neutral-900 num text-right">{formatCompactFCFA(stats.cashBalance)}</span>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs text-neutral-500 leading-tight">Encaissements</span>
                    <span className="text-xs font-bold text-neutral-900 num text-right shrink-0">+{formatCompactFCFA(stats.todayCollected)}</span>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs text-neutral-500 leading-tight">Dépenses</span>
                    <span className="text-xs font-bold text-rose-500 num text-right shrink-0">-{formatCompactFCFA(stats.periodExpenses)}</span>
                  </div>
                  {stats.periodRefunds > 0 && (
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs text-neutral-500 leading-tight">Remboursements</span>
                      <span className="text-xs font-bold text-rose-500 num text-right shrink-0">-{formatCompactFCFA(stats.periodRefunds)}</span>
                    </div>
                  )}
                  {stats.periodWithdrawals > 0 && (
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs text-neutral-500 leading-tight">Retraits</span>
                      <span className="text-xs font-bold text-rose-500 num text-right shrink-0">-{formatCompactFCFA(stats.periodWithdrawals)}</span>
                    </div>
                  )}
                  {stats.periodCustomerLoans > 0 && (
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs text-neutral-500 leading-tight">Prêts clients</span>
                      <span className="text-xs font-bold text-rose-500 num text-right shrink-0">-{formatCompactFCFA(stats.periodCustomerLoans)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 pt-1.5 mt-1 border-t border-neutral-200">
                    <button onClick={() => nav('cash_history')} className="flex items-center gap-1 text-xs font-bold text-neutral-900 hover:text-neutral-600 transition-colors">
                      Voir le détail <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                    <div className="flex items-baseline gap-2 shrink-0">
                      <span className="text-xs font-bold text-neutral-900 leading-tight">Solde période</span>
                      <span className="text-sm font-black text-neutral-900 num text-right">{formatCompactFCFA(stats.periodCashBalance)}</span>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Trait fin de séparation */}
            <div className="my-2.5 h-px bg-neutral-100" />

            {/* Section basse: Priorités du jour */}
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              <h2 className="text-sm font-bold text-neutral-900 truncate">Priorités du jour</h2>
            </div>
            <div className="space-y-0.5">
              {stats.receivables > 0 && (
                <button onClick={() => nav('tiers')} className="w-full flex items-center gap-2 py-2 px-1.5 rounded-xl hover:bg-neutral-50 active:scale-[0.98] transition-all text-left group">
                  <div className="w-2 h-2 rounded-full bg-neutral-300 shrink-0" />
                  <span className="flex-1 text-xs text-neutral-700 group-hover:text-neutral-900 transition-colors leading-tight">Relancer clients</span>
                  <span className="text-xs font-bold text-neutral-500 shrink-0">{stats.customersToChase}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-neutral-300 shrink-0" />
                </button>
              )}
              {stats.payables > 0 && (
                <button onClick={() => nav('supplier_orders')} className="w-full flex items-center gap-2 py-2 px-1.5 rounded-xl hover:bg-neutral-50 active:scale-[0.98] transition-all text-left group">
                  <div className="w-2 h-2 rounded-full bg-neutral-300 shrink-0" />
                  <span className="flex-1 text-xs text-neutral-700 group-hover:text-neutral-900 transition-colors leading-tight">Payer fournisseurs</span>
                  <span className="text-xs font-bold text-neutral-500 shrink-0">{stats.suppliersToChase}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-neutral-300 shrink-0" />
                </button>
              )}
              {stats.pendingReturns > 0 && (
                <button onClick={() => nav('sales')} className="w-full flex items-center gap-2 py-2 px-1.5 rounded-xl hover:bg-neutral-50 active:scale-[0.98] transition-all text-left group">
                  <div className="w-2 h-2 rounded-full bg-neutral-300 shrink-0" />
                  <span className="flex-1 text-xs text-neutral-700 group-hover:text-neutral-900 transition-colors leading-tight">Réception fournisseur</span>
                  <span className="text-xs font-bold text-neutral-500 shrink-0">{stats.pendingReturns}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-neutral-300 shrink-0" />
                </button>
              )}
              {stats.sessionInfo && (
                <button onClick={() => nav('pos')} className="w-full flex items-center gap-2 py-2 px-1.5 rounded-xl hover:bg-neutral-50 active:scale-[0.98] transition-all text-left group">
                  <div className="w-2 h-2 rounded-full bg-neutral-300 shrink-0" />
                  <span className="flex-1 text-xs text-neutral-700 group-hover:text-neutral-900 transition-colors leading-tight">Clôturer caisse</span>
                  <span className="text-[10px] font-bold text-neutral-500 shrink-0">{periodLabel}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-neutral-300 shrink-0" />
                </button>
              )}
              {!stats.receivables && !stats.payables && !stats.pendingReturns && !stats.sessionInfo && (
                <div className="flex items-center gap-2 py-2">
                  <CheckCircle className="w-4 h-4 text-neutral-400 shrink-0" />
                  <p className="text-xs font-semibold text-neutral-500">Tout est en ordre</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
