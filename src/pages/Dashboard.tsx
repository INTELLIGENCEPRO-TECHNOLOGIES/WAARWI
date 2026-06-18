import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { usePermissions } from '../lib/permissions';
import { formatFCFA, formatCompactFCFA } from '../lib/format';
import { setNavContext, type NavContext } from '../lib/navHighlight';
import { Modal } from '../components/Modal';
import { SearchableSelect } from '../components/SearchableSelect';
import { desktopAutoFocus } from '../lib/device';
import { printStockMovementA4, printStockMovement80, type PrintTenant } from '../lib/print';
import {
  TrendingUp, TrendingDown, AlertTriangle, Package, Loader2,
  Users, FileText, ExternalLink, Globe,
  ShoppingCart, ChevronRight, Bell, Calendar,
  CheckCircle, Clock, Receipt, Wallet, ArrowUpRight, ArrowDownRight,
  ArrowUpLeft, CreditCard, Truck, Activity, Eye, EyeOff, X,
  Share2, Copy, Check as CheckIcon, MessageCircle, RefreshCw,
  ClipboardList, Coins, RotateCcw,
  ArrowDownCircle, ArrowUpCircle, ArrowRightLeft, BarChart3, Store,
  Network, Palette,
} from 'lucide-react';

type ShopInfo = { slug: string | null; isActive: boolean };

type ActivityItem = {
  id: string;
  type: 'sale' | 'quote' | 'supplier_order' | 'payment_received' | 'online_order' | 'stock_movement' | 'return';
  title: string;
  detail: string;
  amount: number | null;
  amountType: 'positive' | 'negative' | 'neutral';
  time: string;
  route: string;
  routeCtx?: NavContext;
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
  todayCount: number;
  yesterdaySales: number;
  monthSales: number;
  monthMargin: number;
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

export function Dashboard({ onNavigate }: { onNavigate?: (route: string) => void }) {
  const { tenant, dataTick, profile, currentSite } = useApp();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [shopInfo, setShopInfo] = useState<ShopInfo | null>(null);
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

  useEffect(() => {
    if (!tenant || !currentSite) return;
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

      const periodQuery = supabase.from('sales').select('total, created_at, sale_items(unit_price, quantity, discount, purchase_cost)').eq('tenant_id', tenant.id).eq('site_id', siteId).gte('created_at', periodStart.toISOString()).neq('status', 'cancelled');
      if (periodEnd) periodQuery.lt('created_at', periodEnd.toISOString());

      const [
        todayData, yestData, monthData, articlesCount, stockData, recent,
        custData, suppData, quotesData, returnsData, shopData,
        webNewData, webPrepData, webReadyData, webTodayData, webWaitData, lastWebOrderData,
        openSessions, stockInTodayData,
      ] = await Promise.all([
        periodQuery,
        supabase.from('sales').select('total').eq('tenant_id', tenant.id).eq('site_id', siteId).gte('created_at', yest.toISOString()).lt('created_at', today.toISOString()).neq('status', 'cancelled'),
        supabase.from('sales').select('total, sale_items(total, purchase_cost, quantity)').eq('tenant_id', tenant.id).eq('site_id', siteId).gte('created_at', firstOfMonth.toISOString()).neq('status', 'cancelled'),
        supabase.from('articles').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('is_active', true),
        supabase.from('stock_levels').select('quantity, articles!inner(stock_min, purchase_price)').eq('tenant_id', tenant.id).eq('site_id', siteId),
        supabase.from('sales').select('id, sale_number, total, created_at, customers(name), sale_payments(method_name)').eq('tenant_id', tenant.id).eq('site_id', siteId).neq('status', 'cancelled').order('created_at', { ascending: false }).limit(5),
        supabase.from('customers').select('id').eq('tenant_id', tenant.id).eq('is_active', true),
        supabase.from('suppliers').select('id').eq('tenant_id', tenant.id).eq('is_active', true),
        supabase.from('quotes').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('site_id', siteId).in('status', ['draft', 'sent']),
        supabase.from('sale_returns').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('site_id', siteId).eq('status', 'pending'),
        supabase.from('tenants').select('public_slug').eq('id', tenant.id).maybeSingle(),
        supabase.from('online_orders').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('status', 'nouvelle'),
        supabase.from('online_orders').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('status', 'en_preparation'),
        supabase.from('online_orders').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('status', 'prete'),
        supabase.from('online_orders').select('total').eq('tenant_id', tenant.id).gte('created_at', periodStart.toISOString()).neq('status', 'annulee'),
        supabase.from('online_orders').select('created_at').eq('tenant_id', tenant.id).eq('status', 'nouvelle').order('created_at', { ascending: true }).limit(1),
        supabase.from('online_orders').select('order_number, customer_name, total, created_at').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('cash_sessions').select('id, opening_amount, theoretical_amount, counted_cash, opened_at').eq('tenant_id', tenant.id).eq('site_id', siteId).eq('status', 'open'),
        supabase.from('stock_movements').select('quantity').eq('tenant_id', tenant.id).eq('site_id', siteId).in('movement_type', ['purchase', 'adjustment_in']).gte('created_at', periodStart.toISOString()),
      ]);

      if (shopData.data?.public_slug) {
        const { data: ss } = await supabase.from('shop_settings').select('is_active').eq('tenant_id', tenant.id).maybeSingle();
        setShopInfo({ slug: shopData.data.public_slug, isActive: ss?.is_active ?? false });
      } else {
        setShopInfo({ slug: null, isActive: false });
      }

      const todaySales = (todayData.data || []).reduce((s, r) => s + Number(r.total), 0);
      let todayMargin = 0;
      for (const sale of (todayData.data || []) as any[]) {
        for (const item of (sale.sale_items || [])) {
          const rev = (Number(item.unit_price) * Number(item.quantity)) - Number(item.discount || 0);
          todayMargin += rev - (Number(item.purchase_cost || 0) * Number(item.quantity));
        }
      }
      const yesterdaySales = (yestData.data || []).reduce((s, r) => s + Number(r.total), 0);
      const monthSales = (monthData.data || []).reduce((s, r) => s + Number(r.total), 0);

      let monthMargin = 0;
      for (const sale of (monthData.data || []) as any[]) {
        for (const item of (sale.sale_items || [])) {
          monthMargin += Number(item.total) - (Number(item.purchase_cost) * Number(item.quantity));
        }
      }

      const stockRows = stockData.data || [];
      const low = stockRows.filter((r: any) => Number(r.quantity) > 0 && Number(r.articles?.stock_min || 0) > 0 && Number(r.quantity) <= Number(r.articles.stock_min)).length;
      const out = stockRows.filter((r: any) => Number(r.quantity) <= 0).length;
      const stockValue = stockRows.reduce((s: number, r: any) => s + (Number(r.quantity || 0) * Number(r.articles?.purchase_price || 0)), 0);
      const articlesInStockCount = stockRows.filter((r: any) => Number(r.quantity) > 0).length;

      const webTodayRows = (webTodayData.data || []) as any[];
      const webTodayTotal = webTodayRows.reduce((s, r) => s + Number(r.total || 0), 0);

      const { data: unpaidOrders } = await supabase
        .from('supplier_orders')
        .select('total, paid, supplier_id')
        .eq('tenant_id', tenant.id)
        .neq('status', 'cancelled');
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
        .neq('status', 'paid');
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
          .select('kind, amount')
          .eq('tenant_id', tenant.id)
          .eq('cash_session_id', currentSession.id);
        for (const m of (sessionMovs || []) as any[]) {
          if (m.kind === 'expense') sessionMovExpense += Number(m.amount || 0);
          else sessionMovIncome += Number(m.amount || 0);
        }

        cashBalance = Number(currentSession.opening_amount || 0) + sessionPaymentsTotal + sessionMovIncome - sessionMovExpense;
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
        .neq('status', 'cancelled');
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
      const [actSales, actQuotes, actSupOrders, actOnline, actReturns, actPayments] = await Promise.all([
        supabase.from('sales').select('id, sale_number, total, created_at, status, customers(name), sale_payments(method_name)').eq('tenant_id', tenant.id).eq('site_id', siteId).order('created_at', { ascending: false }).limit(8),
        supabase.from('quotes').select('id, quote_number, total, created_at, status, customers(name)').eq('tenant_id', tenant.id).eq('site_id', siteId).order('created_at', { ascending: false }).limit(5),
        supabase.from('supplier_orders').select('id, order_number, total, created_at, status, suppliers(name)').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(5),
        supabase.from('online_orders').select('id, order_number, total, created_at, status, customer_name').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(5),
        supabase.from('sale_returns').select('id, return_number, total, created_at, status, customers(name)').eq('tenant_id', tenant.id).eq('site_id', siteId).order('created_at', { ascending: false }).limit(3),
        supabase.from('sale_payments').select('id, amount, created_at, method_name, sales!inner(sale_number, site_id, customers(name))').eq('tenant_id', tenant.id).eq('sales.site_id', siteId).order('created_at', { ascending: false }).limit(5),
      ]);

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
        });
      }

      for (const q of (actQuotes.data || []) as any[]) {
        const client = q.customers?.name || 'Client';
        const statusLabel = q.status === 'sent' ? 'Envoye' : q.status === 'accepted' ? 'Accepte' : q.status === 'converted' ? 'Converti' : 'Brouillon';
        activities.push({
          id: `quote-${q.id}`,
          type: 'quote',
          title: `Devis ${q.quote_number}`,
          detail: `${client} · ${statusLabel}`,
          amount: Number(q.total),
          amountType: 'neutral',
          time: q.created_at,
          route: 'sales',
        });
      }

      for (const o of (actSupOrders.data || []) as any[]) {
        const supplier = o.suppliers?.name || 'Fournisseur';
        const statusLabel = o.status === 'delivered' ? 'Livree' : o.status === 'sent' ? 'Envoyee' : o.status === 'partial' ? 'Partielle' : 'Brouillon';
        activities.push({
          id: `suporder-${o.id}`,
          type: 'supplier_order',
          title: `Commande ${o.order_number}`,
          detail: `${supplier} · ${statusLabel}`,
          amount: Number(o.total),
          amountType: 'negative',
          time: o.created_at,
          route: 'supplier_orders',
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
        });
      }

      activities.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
      const recentActivities = activities.slice(0, 15);

      // ── Intelligent Alerts ──
      const [alertStockOut, alertStockLow, alertAdjustments, alertModifiedSales] = await Promise.all([
        supabase.from('stock_levels').select('quantity, articles!inner(id, name, internal_ref, stock_min)').eq('tenant_id', tenant.id).eq('site_id', siteId).lte('quantity', 0),
        supabase.from('stock_levels').select('quantity, articles!inner(id, name, internal_ref, stock_min)').eq('tenant_id', tenant.id).eq('site_id', siteId).gt('quantity', 0),
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
        todaySales, todayCount: todayData.data?.length || 0,
        yesterdaySales,
        monthSales, monthMargin,
        todayMargin,
        cashBalance, sessionExpenses: sessionMovExpense, sessionCashIn: sessionMovIncome,
        sessionInfo,
        receivables, payables,
        articlesCount: articlesCount.count || 0,
        lowStockCount: low, outOfStockCount: out,
        stockValue,
        articlesInStockCount,
        customersCount: (custData.data || []).length,
        suppliersCount: (suppData.data || []).length,
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
      if (!cancelled) { setStats(next); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [tenant, dataTick, currentSite?.id, period]);

  const nav = (route: string, ctx?: NavContext) => {
    setNavContext(ctx || null);
    onNavigate?.(route);
  };

  if (loading || !stats) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-brand-500/20 blur-xl animate-pulse" />
          <Loader2 className="relative w-6 h-6 animate-spin text-brand-600" />
        </div>
        <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-[0.2em]">Chargement</span>
      </div>
    );
  }

  const now = new Date();
  const hourGreet = now.getHours() < 12 ? 'Bonjour' : now.getHours() < 18 ? 'Bon après-midi' : 'Bonsoir';
  const marginPct = can('view_margins') && stats.monthSales > 0 ? Math.round(stats.monthMargin / stats.monthSales * 100) : 0;
  const dayMarginPct = can('view_margins') && stats.todaySales > 0 ? Math.round(stats.todayMargin / stats.todaySales * 100) : 0;
  const dayDelta = stats.yesterdaySales > 0
    ? Math.round(((stats.todaySales - stats.yesterdaySales) / stats.yesterdaySales) * 100)
    : (stats.todaySales > 0 ? 100 : 0);

  const firstName = (profile?.full_name || '').split(' ')[0];

  return (
    <>
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
        />
      </div>

      <div className="hidden lg:block">
        <DesktopDashboard
          stats={can('view_dashboard_stats') ? stats : { ...stats, todaySales: 0, yesterdaySales: 0, monthSales: 0, monthMargin: 0, cashBalance: 0, sessionCashIn: 0, sessionExpenses: 0, receivables: 0, payables: 0 }}
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
        />
      </div>
    </>
  );
}

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "A l'instant";
  if (min < 60) return `Il y a ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Il y a ${h}h`;
  return `Il y a ${Math.floor(h / 24)}j`;
}

/* ════════════════════════════════════════════════════════════════════════════
 *  MOBILE DASHBOARD — Ultra-compact Premium Fintech 2026
 * ════════════════════════════════════════════════════════════════════════════ */
function MobileDashboard({
  stats, shopInfo, dayDelta, marginPct, dayMarginPct, nav,
  balanceHidden, toggleBalanceHidden,
}: any) {
  const { tenant, currentSite, sites, setCurrentSite } = useApp();

  // ── Multi-site overview ────────────────────────────────────────────────
  type SiteStat = { id: string; name: string; todaySales: number; salesCount: number; cashBalance: number; openingAmount: number; sessionOpen: boolean };
  const [multiSiteStats, setMultiSiteStats] = useState<SiteStat[]>([]);
  const hasMultiSites = sites.length > 1;

  useEffect(() => {
    if (!hasMultiSites || !tenant) return;
    let cancelled = false;
    (async () => {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const results: SiteStat[] = [];
      for (const site of sites) {
        const [{ data: salesData }, { data: sessData }, { data: pmtData }] = await Promise.all([
          supabase.from('sales').select('total').eq('tenant_id', tenant.id).eq('site_id', site.id).gte('created_at', today.toISOString()).neq('status', 'cancelled'),
          supabase.from('cash_sessions').select('id, opening_amount, status').eq('tenant_id', tenant.id).eq('site_id', site.id).eq('status', 'open').limit(1),
          supabase.from('sale_payments').select('amount, cash_session_id').eq('tenant_id', tenant.id).in('cash_session_id', (await supabase.from('cash_sessions').select('id').eq('tenant_id', tenant.id).eq('site_id', site.id).eq('status', 'open')).data?.map((s: any) => s.id) || []),
        ]);
        const salesCount = (salesData || []).length;
        const todaySales = (salesData || []).reduce((s: number, r: any) => s + Number(r.total), 0);
        const session = (sessData || [])[0];
        const openingAmount = session ? Number(session.opening_amount || 0) : 0;
        const sessionPayTotal = (pmtData || []).reduce((s: number, p: any) => s + Number(p.amount), 0);
        const cashBalance = session ? openingAmount + sessionPayTotal : 0;
        results.push({ id: site.id, name: site.name, todaySales, salesCount, cashBalance, openingAmount, sessionOpen: !!session });
      }
      if (!cancelled) setMultiSiteStats(results);
    })();
    return () => { cancelled = true; };
  }, [hasMultiSites, tenant?.id, sites.length, stats.todaySales]);

  // ── Web order notification (blink + sound) ──────────────────────────────
  const prevWebNew = useRef(stats.webNew);
  const webCardRef = useRef<HTMLButtonElement>(null);
  const [webBlink, setWebBlink] = useState(false);

  // ── Share shop modal ─────────────────────────────────────────────────────
  const [shareOpen, setShareOpen] = useState(false);
  const [waNumber, setWaNumber] = useState('');
  const [copied, setCopied] = useState(false);
  const shopUrl = shopInfo?.slug ? `${window.location.origin}/shop/${shopInfo.slug}` : '';

  // ── Hero card theme toggle ─────────────────────────────────────────────
  const [heroLight, setHeroLight] = useState(() => {
    try { return localStorage.getItem('dashboard_hero_light') === '1'; } catch { return false; }
  });
  const toggleHeroTheme = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !heroLight;
    setHeroLight(next);
    try { localStorage.setItem('dashboard_hero_light', next ? '1' : '0'); } catch {}
  };

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

  const netCaisse = stats.cashBalance - stats.sessionExpenses;

  return (
    <div className="space-y-1.5 animate-fade-in pb-1">

      {/* ── HERO CARD ── */}
      <button
        onClick={() => nav('sales')}
        className={`w-full text-left relative overflow-hidden rounded-[18px] p-3.5 active:scale-[0.985] transition-transform duration-200 ${heroLight ? '' : ''}`}
        style={heroLight
          ? { background: '#ffffff', boxShadow: '0 4px 20px rgba(15,23,42,0.08), 0 12px 40px rgba(15,23,42,0.05), 0 0 0 1px rgba(226,232,240,0.6)' }
          : { background: 'linear-gradient(160deg, #021e2f 0%, #053d47 35%, #0a5e58 65%, #0d8f82 100%)', boxShadow: '0 16px 32px -8px rgba(5, 61, 71, 0.55), 0 6px 12px -4px rgba(13, 148, 136, 0.25)' }
        }
      >
        {!heroLight && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-gradient-to-br from-teal-300/15 to-transparent blur-3xl animate-pulse-slow" />
            <div className="absolute -bottom-20 -left-10 w-48 h-48 rounded-full bg-gradient-to-tr from-cyan-300/8 to-transparent blur-3xl" />
          </div>
        )}

        <div className="relative">
          {/* Header row */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${heroLight ? 'bg-teal-500' : 'bg-teal-300'}`} />
              <span className={`text-[9px] font-bold uppercase tracking-[0.15em] ${heroLight ? 'text-slate-400' : 'text-teal-200/70'}`}>Encaissement du jour</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-bold ${heroLight ? 'bg-teal-50 text-teal-600 border border-teal-100' : 'bg-teal-400/15 text-teal-200'}`}>
                <span className={`w-1 h-1 rounded-full animate-pulse ${heroLight ? 'bg-teal-500' : 'bg-teal-400'}`} />LIVE
              </span>
              {shopInfo?.isActive && shopUrl && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShareOpen(true); }}
                  className={`w-5 h-5 rounded-full flex items-center justify-center active:scale-90 transition-transform ${heroLight ? 'bg-slate-100 border border-slate-200' : 'bg-white/10 border border-white/15'}`}
                  aria-label="Partager la boutique"
                >
                  <Share2 className={`w-2.5 h-2.5 ${heroLight ? 'text-slate-500' : 'text-white/70'}`} />
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); toggleBalanceHidden(); }}
                className={`w-5 h-5 rounded-full flex items-center justify-center active:scale-90 transition-transform ${heroLight ? 'bg-slate-100 border border-slate-200' : 'bg-white/8 border border-white/10'}`}
              >
                {balanceHidden
                  ? <Eye className={`w-2.5 h-2.5 ${heroLight ? 'text-slate-500' : 'text-white/60'}`} />
                  : <EyeOff className={`w-2.5 h-2.5 ${heroLight ? 'text-slate-500' : 'text-white/60'}`} />}
              </button>
              <button
                onClick={toggleHeroTheme}
                className={`w-5 h-5 rounded-full flex items-center justify-center active:scale-90 transition-transform ${heroLight ? 'bg-slate-100 border border-slate-200' : 'bg-white/8 border border-white/10'}`}
                aria-label="Changer le thème"
              >
                <Palette className={`w-2.5 h-2.5 ${heroLight ? 'text-slate-500' : 'text-white/60'}`} />
              </button>
            </div>
          </div>

          {/* Main amount + delta */}
          <div className="flex items-end gap-3 mb-2.5">
            <div className={`num font-black leading-none tracking-tight ${heroLight ? 'text-slate-900' : 'text-white'}`} style={{ fontSize: 'clamp(22px, 7vw, 30px)' }}>
              {balanceHidden ? '••••••' : formatFCFA(stats.todaySales)}
            </div>
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[8px] font-bold ${
                heroLight
                  ? (dayDelta >= 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-100')
                  : (dayDelta >= 0 ? 'bg-emerald-400/15 text-emerald-200' : 'bg-rose-400/15 text-rose-200')
              }`}>
                {dayDelta >= 0 ? <TrendingUp className="w-2 h-2" /> : <TrendingDown className="w-2 h-2" />}
                {dayDelta >= 0 ? '+' : ''}{dayDelta}%
              </span>
              <span className={`text-[8px] ${heroLight ? 'text-slate-400' : 'text-white/35'}`}>vs hier</span>
              <span className={`text-[8px] ${heroLight ? 'text-slate-300' : 'text-white/35'}`}>·</span>
              <span className={`text-[8px] num ${heroLight ? 'text-slate-500' : 'text-white/45'}`}>{stats.todayCount} ticket{stats.todayCount > 1 ? 's' : ''}</span>
            </div>
          </div>

          {/* Stats rows list */}
          <div style={{ borderTop: heroLight ? '1px solid rgba(226,232,240,0.8)' : '1px solid rgba(255,255,255,0.08)' }} className="pt-2 space-y-0">

            {/* Session info */}
            {stats.sessionInfo && (
              <div className={`flex items-center gap-1 mb-1.5 text-[8px] font-semibold uppercase tracking-[0.1em] ${heroLight ? 'text-teal-600/60' : 'text-teal-200/40'}`}>
                <Clock className="w-2.5 h-2.5" />
                Session depuis {new Date(stats.sessionInfo.openedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
              </div>
            )}

            {/* CAISSE row */}
            <div className="flex items-center justify-between py-1.5" style={{ borderBottom: heroLight ? '1px solid rgba(226,232,240,0.6)' : '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: heroLight ? 'rgba(20,184,166,0.08)' : 'rgba(255,255,255,0.07)' }}>
                  <Wallet className={`w-2.5 h-2.5 ${heroLight ? 'text-teal-600' : 'text-white/70'}`} />
                </div>
                <span className={`text-[9px] font-bold uppercase tracking-[0.07em] ${heroLight ? 'text-slate-600' : 'text-white/70'}`}>Solde caisse</span>
              </div>
              <span className={`num text-[13px] font-black ${heroLight ? 'text-teal-700' : 'text-teal-300'}`}>
                {balanceHidden ? '•••' : formatFCFA(stats.cashBalance)}
              </span>
            </div>

            {/* DEPENSES row */}
            <div className="flex items-center justify-between py-1.5" style={{ borderBottom: heroLight ? '1px solid rgba(226,232,240,0.6)' : '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: heroLight ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.15)' }}>
                  <ArrowUpLeft className={`w-2.5 h-2.5 ${heroLight ? 'text-rose-500' : 'text-rose-300'}`} />
                </div>
                <span className={`text-[9px] font-bold uppercase tracking-[0.07em] ${heroLight ? 'text-slate-600' : 'text-white/70'}`}>Dépenses</span>
              </div>
              <span className={`num text-[13px] font-black ${heroLight ? 'text-slate-800' : 'text-white/80'}`}>
                {balanceHidden ? '•••' : formatFCFA(stats.sessionExpenses)}
              </span>
            </div>

            {/* ENTREES row */}
            <div className="flex items-center justify-between py-1.5" style={{ borderBottom: heroLight ? '1px solid rgba(226,232,240,0.6)' : '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: heroLight ? 'rgba(16,185,129,0.08)' : 'rgba(16,185,129,0.15)' }}>
                  <ArrowDownRight className={`w-2.5 h-2.5 ${heroLight ? 'text-emerald-500' : 'text-emerald-300'}`} />
                </div>
                <span className={`text-[9px] font-bold uppercase tracking-[0.07em] ${heroLight ? 'text-slate-600' : 'text-white/70'}`}>Entrées</span>
              </div>
              <span className={`num text-[13px] font-black ${heroLight ? 'text-slate-800' : 'text-white/80'}`}>
                {balanceHidden ? '•••' : formatFCFA(stats.sessionCashIn)}
              </span>
            </div>

            {/* NET CAISSE row */}
            <div className="flex items-center justify-between py-1.5" style={{ borderBottom: heroLight ? '1px solid rgba(226,232,240,0.6)' : '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: heroLight ? 'rgba(20,184,166,0.08)' : 'rgba(20,184,166,0.15)' }}>
                  <ArrowUpRight className={`w-2.5 h-2.5 ${heroLight ? 'text-teal-600' : 'text-teal-300'}`} />
                </div>
                <span className={`text-[9px] font-bold uppercase tracking-[0.07em] ${heroLight ? 'text-slate-600' : 'text-white/70'}`}>Net caisse</span>
              </div>
              <span className={`num text-[13px] font-black ${heroLight ? (netCaisse >= 0 ? 'text-emerald-600' : 'text-rose-600') : (netCaisse >= 0 ? 'text-emerald-300' : 'text-rose-300')}`}>
                {balanceHidden ? '•••' : formatFCFA(netCaisse)}
              </span>
            </div>

            {/* MARGE DU JOUR row */}
            {!balanceHidden && dayMarginPct > 0 && (
              <div className="flex items-center justify-between py-1.5" style={{ borderBottom: heroLight ? '1px solid rgba(226,232,240,0.6)' : '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: heroLight ? 'rgba(52,211,153,0.08)' : 'rgba(52,211,153,0.15)' }}>
                    <TrendingUp className={`w-2.5 h-2.5 ${heroLight ? 'text-emerald-500' : 'text-emerald-300'}`} />
                  </div>
                  <span className={`text-[9px] font-bold uppercase tracking-[0.07em] ${heroLight ? 'text-slate-600' : 'text-white/70'}`}>Marge jour</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`num text-[13px] font-black ${heroLight ? 'text-emerald-600' : 'text-emerald-300'}`}>
                    {formatFCFA(stats.todayMargin)}
                  </span>
                  <span className={`text-[8px] font-bold num ${heroLight ? 'text-emerald-500/60' : 'text-emerald-400/60'}`}>{dayMarginPct}%</span>
                </div>
              </div>
            )}

            {/* MOIS row */}
            {!balanceHidden && (
              <div className="flex items-center justify-between py-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: heroLight ? 'rgba(226,232,240,0.5)' : 'rgba(255,255,255,0.06)' }}>
                    <BarChart3 className={`w-2.5 h-2.5 ${heroLight ? 'text-slate-400' : 'text-white/50'}`} />
                  </div>
                  <span className={`text-[9px] font-bold uppercase tracking-[0.07em] ${heroLight ? 'text-slate-400' : 'text-white/50'}`}>CA du mois</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`num text-[13px] font-black ${heroLight ? 'text-slate-700' : 'text-white/70'}`}>{formatCompactFCFA(stats.monthSales)}</span>
                  {marginPct > 0 && <span className={`text-[8px] font-bold num ${heroLight ? 'text-emerald-500/60' : 'text-emerald-400/60'}`}>marge {marginPct}%</span>}
                </div>
              </div>
            )}
          </div>
        </div>
      </button>

      {/* ── MULTI-SITE STRIP (mobile) ── */}
      {sites.length > 1 && multiSiteStats.length > 0 && (
        <div className="rounded-xl bg-white overflow-hidden" style={{ boxShadow: '0 2px 8px rgba(15,23,42,0.06), 0 8px 24px rgba(15,23,42,0.04), 0 0 0 1px rgba(226,232,240,0.5)', border: '1px solid rgba(226,232,240,0.6)' }}>
          <div className="flex items-center justify-between px-3 py-2 border-b border-brand-100/50 bg-gradient-to-r from-brand-50/80 to-white">
            <div className="flex items-center gap-1.5">
              <Network className="w-3.5 h-3.5 text-brand-600" />
              <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">Magasins</span>
            </div>
            <span className="text-[9px] font-bold text-slate-400 num">Total: {formatCompactFCFA(multiSiteStats.reduce((s, x) => s + x.todaySales, 0))}</span>
          </div>
          <div className="flex overflow-x-auto gap-1.5 p-2 no-scrollbar">
            {multiSiteStats.map(site => {
              const isCurrent = site.id === currentSite?.id;
              return (
                <button
                  key={site.id}
                  onClick={() => { const s = sites.find((x: any) => x.id === site.id); if (s) setCurrentSite(s); }}
                  className={`shrink-0 p-2.5 rounded-xl border min-w-[135px] text-left transition-all ${isCurrent ? 'border-brand-300 bg-brand-50/50' : 'border-slate-200 bg-white active:bg-slate-50'}`}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${site.sessionOpen ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                    <span className="text-[10px] font-bold text-slate-800">{site.name}</span>
                  </div>
                  <div className="text-[13px] font-black num text-slate-900 mb-1">{formatCompactFCFA(site.todaySales)}</div>
                  <div className="space-y-0.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[8px] text-slate-400 font-semibold">Tickets</span>
                      <span className="text-[9px] font-bold text-slate-700 num">{site.salesCount}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[8px] text-slate-400 font-semibold">Caisse</span>
                      <span className={`text-[9px] font-bold num ${site.sessionOpen ? 'text-teal-700' : 'text-slate-400'}`}>{site.sessionOpen ? formatCompactFCFA(site.cashBalance) : 'Fermée'}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── FINANCES ── */}
      <div className="rounded-xl bg-white overflow-hidden" style={{ boxShadow: '0 2px 8px rgba(15,23,42,0.06), 0 8px 24px rgba(15,23,42,0.04), 0 0 0 1px rgba(226,232,240,0.5)', border: '1px solid rgba(226,232,240,0.6)' }}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-blue-100/50 bg-gradient-to-r from-blue-50/80 to-white">
          <div className="flex items-center gap-1.5">
            <CreditCard className="w-3.5 h-3.5 text-blue-500" />
            <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">Finances</span>
          </div>
          <button onClick={() => nav('accounting')} className="text-[9px] font-bold text-slate-400 flex items-center gap-0.5">
            Voir tout <ChevronRight className="w-2.5 h-2.5" />
          </button>
        </div>
        <div className="grid grid-cols-2 divide-x divide-slate-100">
          <button onClick={() => nav('tiers', { target: 'receivables' })} className="px-3 py-2 text-left active:bg-slate-50 transition-colors">
            <div className="text-[8px] text-slate-400 font-semibold mb-0.5">Créances</div>
            <div className="num text-[14px] font-black text-slate-900 leading-tight">{balanceHidden ? '•••' : formatFCFA(stats.receivables)}</div>
            <div className="flex items-center justify-between mt-0.5">
              <div className="text-[8px] text-slate-400">{stats.customersCount} client{stats.customersCount > 1 ? 's' : ''}</div>
              <ChevronRight className="w-2.5 h-2.5 text-slate-300" />
            </div>
          </button>
          <button onClick={() => nav('supplier_orders', { target: 'payables' })} className="px-3 py-2 text-left active:bg-slate-50 transition-colors">
            <div className="text-[8px] text-slate-400 font-semibold mb-0.5">Fournisseurs</div>
            <div className="num text-[14px] font-black text-slate-900 leading-tight">{balanceHidden ? '•••' : formatFCFA(stats.payables)}</div>
            <div className="flex items-center justify-between mt-0.5">
              <div className="text-[8px] text-slate-400">{stats.suppliersCount} fournisseur{stats.suppliersCount > 1 ? 's' : ''}</div>
              <ChevronRight className="w-2.5 h-2.5 text-slate-300" />
            </div>
          </button>
        </div>
      </div>

      {/* ── ALERTES ── */}
      {(stats.lowStockCount > 0 || stats.outOfStockCount > 0 || stats.pendingQuotes > 0) && (
        <div className="rounded-xl overflow-hidden" style={{ background: '#fffbf0', border: '1px solid rgba(245,158,11,0.2)', boxShadow: '0 2px 8px rgba(245,158,11,0.08), 0 8px 24px rgba(245,158,11,0.05)' }}>
          <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'rgba(245,158,11,0.15)' }}>
            <div className="flex items-center gap-1.5">
              <Bell className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">Alertes</span>
            </div>
            <button onClick={() => nav('stock')} className="text-[9px] font-bold text-amber-600 flex items-center gap-0.5">
              Voir tout <ChevronRight className="w-2.5 h-2.5" />
            </button>
          </div>
          <div className="divide-y" style={{ borderColor: 'rgba(245,158,11,0.1)' }}>
            {stats.outOfStockCount > 0 && (
              <button onClick={() => nav('stock', { target: 'outOfStock' })} className="w-full px-3 py-2 text-left flex items-center gap-2 active:bg-rose-50 transition-colors">
                <div className="w-7 h-7 rounded-lg bg-rose-100 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-bold text-slate-800">{stats.outOfStockCount} rupture{stats.outOfStockCount > 1 ? 's' : ''} de stock</div>
                  <div className="text-[8px] text-slate-500">À commander d'urgence</div>
                </div>
                <ChevronRight className="w-3 h-3 text-slate-300 shrink-0" />
              </button>
            )}
            {stats.lowStockCount > 0 && (
              <button onClick={() => nav('stock', { target: 'lowStock' })} className="w-full px-3 py-2 text-left flex items-center gap-2 active:bg-amber-50 transition-colors">
                <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-bold text-slate-800">{stats.lowStockCount} stock{stats.lowStockCount > 1 ? 's' : ''} bas</div>
                  <div className="text-[8px] text-slate-500">Seuil minimum atteint</div>
                </div>
                <ChevronRight className="w-3 h-3 text-slate-300 shrink-0" />
              </button>
            )}
            {stats.pendingQuotes > 0 && (
              <button onClick={() => nav('billing', { target: 'quotes' })} className="w-full px-3 py-2 text-left flex items-center gap-2 active:bg-amber-50 transition-colors">
                <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                  <FileText className="w-3.5 h-3.5 text-blue-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-bold text-slate-800">{stats.pendingQuotes} devis en attente</div>
                  <div className="text-[8px] text-slate-500">À traiter</div>
                </div>
                <ChevronRight className="w-3 h-3 text-slate-300 shrink-0" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── ACTIVITÉ ── */}
      <div className="rounded-xl bg-white overflow-hidden" style={{ boxShadow: '0 2px 8px rgba(15,23,42,0.06), 0 8px 24px rgba(15,23,42,0.04), 0 0 0 1px rgba(226,232,240,0.5)', border: '1px solid rgba(226,232,240,0.6)' }}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-emerald-100/50 bg-gradient-to-r from-emerald-50/80 to-white">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">Activité</span>
          </div>
          <button onClick={() => nav('stock')} className="text-[9px] font-bold text-slate-400 flex items-center gap-0.5">
            Voir tout <ChevronRight className="w-2.5 h-2.5" />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2 p-2">
          <button onClick={() => nav('stock')} className="flex flex-col p-3 rounded-xl text-left active:scale-95 transition-all" style={{ background: 'linear-gradient(135deg,#f0fdf4 0%,#ffffff 100%)', boxShadow: '0 4px 14px rgba(16,185,129,0.13),0 1px 3px rgba(0,0,0,0.05)', border: '1px solid rgba(16,185,129,0.18)' }}>
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center mb-2 shadow-sm">
              <Package className="w-4 h-4 text-white" />
            </div>
            <div className="text-[8px] font-bold text-emerald-700/70 mb-0.5 uppercase tracking-wide">Stock</div>
            <div className="num text-[15px] font-black text-slate-900 leading-tight">{stats.articlesInStockCount}</div>
            <div className="text-[8px] text-slate-400 mt-0.5 leading-tight">{stats.stockValue > 0 ? formatCompactFCFA(stats.stockValue) : `+${stats.stockInToday} aujourd'hui`}</div>
          </button>
          <button
            ref={webCardRef}
            onClick={() => { setWebBlink(false); nav('online_orders'); }}
            className="flex flex-col p-3 rounded-xl text-left transition-all active:scale-95"
            style={webBlink
              ? { background: 'linear-gradient(135deg,#ccfbf1 0%,#f0fdfa 100%)', boxShadow: '0 4px 20px rgba(20,184,166,0.30),0 1px 3px rgba(0,0,0,0.05)', border: '1px solid rgba(20,184,166,0.40)' }
              : { background: 'linear-gradient(135deg,#f0fdfa 0%,#ffffff 100%)', boxShadow: '0 4px 14px rgba(20,184,166,0.12),0 1px 3px rgba(0,0,0,0.05)', border: '1px solid rgba(20,184,166,0.18)' }}
          >
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center mb-2 shadow-sm ${webBlink ? 'bg-gradient-to-br from-teal-400 to-teal-600 animate-pulse' : 'bg-gradient-to-br from-teal-400 to-teal-600'}`}>
              <Globe className="w-4 h-4 text-white" />
            </div>
            <div className="text-[8px] font-bold text-teal-700/70 mb-0.5 uppercase tracking-wide">Web</div>
            <div className={`num text-[15px] font-black leading-tight ${webBlink ? 'text-teal-600' : 'text-slate-900'}`}>{stats.webNew}</div>
            <div className="text-[8px] text-slate-400 mt-0.5">{stats.webNew === 0 ? 'Aucune commande' : `${stats.webNew} nouvelle${stats.webNew > 1 ? 's' : ''}`}</div>
          </button>
          <button onClick={() => nav('billing', { target: 'quotes' })} className="flex flex-col p-3 rounded-xl text-left active:scale-95 transition-all" style={{ background: 'linear-gradient(135deg,#eff6ff 0%,#ffffff 100%)', boxShadow: '0 4px 14px rgba(59,130,246,0.12),0 1px 3px rgba(0,0,0,0.05)', border: '1px solid rgba(59,130,246,0.18)' }}>
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center mb-2 shadow-sm">
              <FileText className="w-4 h-4 text-white" />
            </div>
            <div className="text-[8px] font-bold text-blue-700/70 mb-0.5 uppercase tracking-wide">Devis</div>
            <div className="num text-[15px] font-black text-slate-900 leading-tight">{stats.pendingQuotes}</div>
            <div className="text-[8px] text-slate-400 mt-0.5">{stats.pendingQuotes === 0 ? 'Aucun devis' : `${stats.pendingQuotes} en attente`}</div>
          </button>
        </div>
      </div>

      {/* ── SANTÉ BUSINESS ── */}
      <div className="rounded-xl bg-white overflow-hidden" style={{ boxShadow: '0 2px 8px rgba(15,23,42,0.06), 0 8px 24px rgba(15,23,42,0.04), 0 0 0 1px rgba(226,232,240,0.5)', border: '1px solid rgba(226,232,240,0.6)' }}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-teal-100/50 bg-gradient-to-r from-teal-50/80 to-white">
          <div className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-teal-500" />
            <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">Santé business</span>
          </div>
          <button onClick={() => nav('sales')} className="text-[9px] font-bold text-teal-600 flex items-center gap-0.5">
            Voir le journal <ChevronRight className="w-2.5 h-2.5" />
          </button>
        </div>
        <div className="grid grid-cols-2 divide-x divide-slate-100 border-b border-slate-100">
          <div className="px-3 py-2">
            <div className="text-[8px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Ticket moyen</div>
            <div className="num text-[13px] font-black text-slate-900 leading-tight">
              {balanceHidden ? '•••' : formatFCFA(stats.todayCount > 0 ? Math.round(stats.todaySales / stats.todayCount) : 0)}
            </div>
          </div>
          <div className="px-3 py-2">
            <div className="text-[8px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Dernière vente</div>
            <div className="num text-[13px] font-black text-slate-900 leading-tight">
              {stats.recentSales.length > 0 ? (balanceHidden ? '•••' : formatFCFA(stats.recentSales[0].total)) : '-'}
            </div>
          </div>
        </div>
        {stats.recentSales.length > 0 && (
          <button onClick={() => nav('sales')} className="w-full flex items-center gap-2 px-3 py-2 active:bg-slate-50 transition-colors text-left border-b border-slate-100">
            <div className="w-7 h-7 rounded-full bg-emerald-50 flex items-center justify-center shrink-0">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-semibold text-slate-800 truncate">
                {(stats.recentSales[0] as any).customers?.name || 'Client comptoir'}
              </div>
              <div className="text-[8px] text-slate-400">{getTimeAgo(stats.recentSales[0].created_at)}</div>
            </div>
            <ChevronRight className="w-3 h-3 text-slate-300 shrink-0" />
          </button>
        )}
        <div className="grid grid-cols-3 divide-x divide-slate-100">
          <button onClick={() => nav('articles')} className="flex items-center gap-1.5 px-2.5 py-2 active:bg-slate-50 transition-colors">
            <Package className="w-3 h-3 text-slate-400 shrink-0" />
            <div>
              <div className="num text-[12px] font-extrabold text-slate-900 leading-none">{stats.articlesCount}</div>
              <div className="text-[8px] text-slate-400 font-semibold mt-0.5">Articles</div>
            </div>
          </button>
          <button onClick={() => nav('tiers')} className="flex items-center gap-1.5 px-2.5 py-2 active:bg-slate-50 transition-colors">
            <Users className="w-3 h-3 text-slate-400 shrink-0" />
            <div>
              <div className="num text-[12px] font-extrabold text-slate-900 leading-none">{stats.customersCount}</div>
              <div className="text-[8px] text-slate-400 font-semibold mt-0.5">Clients</div>
            </div>
          </button>
          <button onClick={() => nav('tiers')} className="flex items-center gap-1.5 px-2.5 py-2 active:bg-slate-50 transition-colors">
            <Truck className="w-3 h-3 text-slate-400 shrink-0" />
            <div>
              <div className="num text-[12px] font-extrabold text-slate-900 leading-none">{stats.suppliersCount}</div>
              <div className="text-[8px] text-slate-400 font-semibold mt-0.5">Fourn.</div>
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
            style={{ background: 'linear-gradient(160deg, #021e2f 0%, #053d47 60%, #0a5e58 100%)', boxShadow: '0 32px 64px -16px rgba(5,61,71,0.8)' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Decorative glow */}
            <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full bg-teal-400/20 blur-3xl pointer-events-none" />

            <div className="relative p-5">
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-2xl bg-teal-400/15 border border-teal-300/20 flex items-center justify-center">
                    <Share2 className="w-4 h-4 text-teal-300" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white leading-tight">Partager la boutique</div>
                    <div className="text-[10px] text-teal-200/50 font-medium">Boutique en ligne active</div>
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
                <div className="text-[9px] font-bold text-teal-200/50 uppercase tracking-[0.1em] mb-1.5">Lien de la boutique</div>
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <Globe className="w-3.5 h-3.5 text-teal-300/60 shrink-0" />
                  <span className="flex-1 text-[11px] text-white/70 font-medium truncate min-w-0">{shopUrl}</span>
                  <button
                    onClick={copyLink}
                    className={`shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${copied ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/8 text-white/60 active:bg-white/15'}`}
                  >
                    {copied ? <CheckIcon className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copied ? 'Copié !' : 'Copier'}
                  </button>
                </div>
              </div>

              {/* WhatsApp section */}
              <div className="mb-4">
                <div className="text-[9px] font-bold text-teal-200/50 uppercase tracking-[0.1em] mb-1.5">Envoyer par WhatsApp</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <MessageCircle className="w-3.5 h-3.5 text-emerald-300/60 shrink-0" />
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
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[11px] font-bold text-teal-200/70 transition-colors active:bg-white/5"
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
          <stop offset="0%" stopColor="#5eead4" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#5eead4" stopOpacity="0.02" />
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
      {pathD && <path d={pathD} fill="none" stroke="#5eead4" strokeWidth="2" strokeLinecap="round" />}
      {hp && (
        <>
          <line x1={hp.x} y1={padT} x2={hp.x} y2={padT + chartH} stroke="#5eead4" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.7" />
          <circle cx={hp.x} cy={hp.y} r="4" fill="#fff" stroke="#0d9488" strokeWidth="2" />
          <rect x={Math.min(Math.max(hp.x - 40, 2), w - 82)} y={hp.y - 28} width="80" height="22" rx="4" fill="rgba(0,0,0,0.85)" />
          <text x={Math.min(Math.max(hp.x, 42), w - 42)} y={hp.y - 14} textAnchor="middle" fill="#5eead4" fontSize="10" fontWeight="700">
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
              <line x1={padL} y1={y} x2={w - 10} y2={y} stroke="#e2e8f0" strokeWidth="0.5" />
              <text x={padL - 4} y={y + 3} textAnchor="end" fill="#94a3b8" fontSize="8" fontWeight="500">
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
                rx="3" fill={isHov ? '#0d9488' : '#0d9488'}
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
              <text x={x + barW / 2} y={h - 5} textAnchor="middle" fill="#64748b" fontSize="8" fontWeight="600">
                {d.day}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div
          className="absolute pointer-events-none z-10 px-2 py-1 rounded bg-slate-900 text-white text-[10px] font-semibold shadow-lg"
          style={{ left: `${((hover + 0.5) / data.length) * 100}%`, top: 0, transform: 'translateX(-50%)' }}
        >
          {formatCompactFCFA(data[hover].total)}
        </div>
      )}
    </div>
  );
}

function DesktopDashboard({ stats, shopInfo, greet, firstName, dayDelta, dayMarginPct, marginPct, nav, period, setPeriod, showPeriodMenu, setShowPeriodMenu, periodOptions, periodLabel }: any) {
  const { tenant, currentSite, sites, setCurrentSite, profile } = useApp();
  const netFlux = stats.cashBalance - stats.sessionExpenses;
  const { can } = usePermissions();

  // ── Multi-site overview ────────────────────────────────────────────────
  type SiteStat = { id: string; name: string; todaySales: number; salesCount: number; cashBalance: number; openingAmount: number; sessionOpen: boolean };
  const [multiSiteStats, setMultiSiteStats] = useState<SiteStat[]>([]);
  const [multiSiteView, setMultiSiteView] = useState<'all' | string>('current');
  const hasMultiSites = sites.length > 1;

  useEffect(() => {
    if (!hasMultiSites || !tenant) return;
    let cancelled = false;
    (async () => {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const results: SiteStat[] = [];
      for (const site of sites) {
        const [{ data: salesData }, { data: sessData }, { data: pmtData }] = await Promise.all([
          supabase.from('sales').select('total').eq('tenant_id', tenant.id).eq('site_id', site.id).gte('created_at', today.toISOString()).neq('status', 'cancelled'),
          supabase.from('cash_sessions').select('id, opening_amount, status').eq('tenant_id', tenant.id).eq('site_id', site.id).eq('status', 'open').limit(1),
          supabase.from('sale_payments').select('amount, cash_session_id').eq('tenant_id', tenant.id).in('cash_session_id', (await supabase.from('cash_sessions').select('id').eq('tenant_id', tenant.id).eq('site_id', site.id).eq('status', 'open')).data?.map((s: any) => s.id) || []),
        ]);
        const salesCount = (salesData || []).length;
        const todaySales = (salesData || []).reduce((s: number, r: any) => s + Number(r.total), 0);
        const session = (sessData || [])[0];
        const openingAmount = session ? Number(session.opening_amount || 0) : 0;
        const sessionPayTotal = (pmtData || []).reduce((s: number, p: any) => s + Number(p.amount), 0);
        const cashBalance = session ? openingAmount + sessionPayTotal : 0;
        results.push({ id: site.id, name: site.name, todaySales, salesCount, cashBalance, openingAmount, sessionOpen: !!session });
      }
      if (!cancelled) setMultiSiteStats(results);
    })();
    return () => { cancelled = true; };
  }, [hasMultiSites, tenant?.id, sites.length, stats.todaySales]);
  // ── Quick-action modal state ─────────────────────────────────────────────
  type QAModal = 'customer' | 'supplier' | 'stock_in' | 'stock_out' | 'stock_transfer' | null;
  const [qaModal, setQAModal] = useState<QAModal>(null);
  const [qaSaving, setQASaving] = useState(false);

  // Customer form
  const [custForm, setCustForm] = useState<any>({ customer_type: 'particulier' });
  // Supplier form
  const [supForm, setSupForm] = useState<any>({ country: 'Sénégal' });
  // Stock adj
  const [stockRows, setStockRows] = useState<{ article_id: string; name: string; internal_ref: string; quantity: number }[]>([]);
  const [adjArticleId, setAdjArticleId] = useState('');
  const [adjQty, setAdjQty] = useState<number | ''>('');
  const [adjNote, setAdjNote] = useState('');
  const [adjTargetSite, setAdjTargetSite] = useState('');

  const openModal = async (modal: QAModal) => {
    setQASaving(false);
    setCustForm({ customer_type: 'particulier' });
    setSupForm({ country: 'Sénégal' });
    setAdjQty(''); setAdjNote(''); setAdjTargetSite('');

    if (modal === 'stock_in' || modal === 'stock_out' || modal === 'stock_transfer') {
      if (tenant && currentSite) {
        const [{ data: arts }, { data: stk }] = await Promise.all([
          supabase.from('articles').select('id, name, internal_ref').eq('tenant_id', tenant.id).eq('is_active', true).order('name'),
          supabase.from('stock_levels').select('article_id, quantity').eq('tenant_id', tenant.id).eq('site_id', currentSite.id),
        ]);
        const qmap = new Map((stk || []).map((r: any) => [r.article_id, Number(r.quantity)]));
        const rows = (arts || []).map((a: any) => ({ article_id: a.id, name: a.name, internal_ref: a.internal_ref, quantity: qmap.get(a.id) ?? 0 }));
        setStockRows(rows);
        if (rows.length > 0) setAdjArticleId(rows[0].article_id);
      }
    }
    setQAModal(modal);
  };

  const saveCustomer = async () => {
    if (!tenant || !custForm.name?.trim()) return;
    setQASaving(true);
    const { error } = await supabase.from('customers').insert({
      tenant_id: tenant.id, name: custForm.name.trim(),
      phone: custForm.phone || '', email: custForm.email || '',
      address: custForm.address || '', whatsapp: custForm.whatsapp || '',
      customer_type: custForm.customer_type || 'particulier', is_active: true,
    });
    setQASaving(false);
    if (!error) { setQAModal(null); nav('tiers', { target: 'customers' }); }
  };

  const saveSupplier = async () => {
    if (!tenant || !supForm.name?.trim()) return;
    setQASaving(true);
    const { error } = await supabase.from('suppliers').insert({
      tenant_id: tenant.id, name: supForm.name.trim(),
      contact: supForm.contact || '', phone: supForm.phone || '',
      whatsapp: supForm.whatsapp || '', email: supForm.email || '',
      address: supForm.address || '', country: supForm.country || 'Sénégal',
      delivery_days: Number(supForm.delivery_days || 0),
      payment_terms: supForm.payment_terms || '', is_active: true,
    });
    setQASaving(false);
    if (!error) { setQAModal(null); nav('tiers', { target: 'suppliers' }); }
  };

  const [stockDone, setStockDone] = useState<{ articleName: string; articleRef: string; qty: number; type: string; label: string } | null>(null);

  const printStockDone = (format: 'a4' | '80') => {
    if (!stockDone || !tenant || !currentSite || !profile) return;
    const opts = {
      tenant: { name: tenant.name, phone: tenant.phone || '', address: tenant.address || '', logo_url: tenant.logo_url || '' } as PrintTenant,
      movementType: stockDone.type,
      movementLabel: stockDone.label,
      reference: `MOV-${Date.now().toString(36).toUpperCase()}`,
      date: new Date().toLocaleString('fr-FR'),
      user: profile.full_name || 'Utilisateur',
      siteName: currentSite.name,
      items: [{ ref: stockDone.articleRef, name: stockDone.articleName, quantity: stockDone.qty }],
      observation: adjNote || undefined,
    };
    if (format === 'a4') printStockMovementA4(opts);
    else printStockMovement80(opts);
  };

  const saveStockAdj = async () => {
    if (!tenant || !currentSite || !adjArticleId || adjQty === '' || Number(adjQty) <= 0) return;
    setQASaving(true);
    const movType = qaModal === 'stock_in' ? 'adjustment_in' : qaModal === 'stock_out' ? 'adjustment_out' : 'transfer_out';
    const articleRow = stockRows.find(r => r.article_id === adjArticleId);
    if (qaModal === 'stock_transfer') {
      if (!adjTargetSite) { setQASaving(false); return; }
      await supabase.rpc('adjust_stock', { p_article_id: adjArticleId, p_site_id: currentSite.id, p_quantity: -Number(adjQty), p_movement_type: 'transfer_out', p_note: adjNote || 'Transfert' });
      await supabase.rpc('adjust_stock', { p_article_id: adjArticleId, p_site_id: adjTargetSite, p_quantity: Number(adjQty), p_movement_type: 'transfer_in', p_note: adjNote || 'Transfert' });
    } else {
      const qty = qaModal === 'stock_in' ? Number(adjQty) : -Number(adjQty);
      await supabase.rpc('adjust_stock', { p_article_id: adjArticleId, p_site_id: currentSite.id, p_quantity: qty, p_movement_type: movType, p_note: adjNote || undefined });
    }
    setQASaving(false);
    setQAModal(null);
    setStockDone({
      articleName: articleRow?.name || 'Article',
      articleRef: articleRow?.internal_ref || '',
      qty: Number(adjQty),
      type: movType,
      label: qaModal === 'stock_in' ? 'Entrée de stock' : qaModal === 'stock_out' ? 'Sortie de stock' : 'Transfert',
    });
  };

  const adjRow = stockRows.find(r => r.article_id === adjArticleId);

  const lastSaleTime = stats.recentSales.length > 0
    ? new Date(stats.recentSales[0].created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : null;

  // ── Quick-action FAB overlay ──────────────────────────────────────────
  const [fabOpen, setFabOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#f8fafb] animate-fade-in">
      {/* ── TOP BAR ── */}
      <div className="sticky top-0 z-20 bg-white border-b border-slate-200/60" style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.03)' }}>
        <div className="pl-[120px] pr-5 xl:pr-8 py-3 flex items-center gap-4">
          <div className="flex items-center gap-3 shrink-0">
            <div className="relative">
              <button
                onClick={() => setShowPeriodMenu(!showPeriodMenu)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200/80 bg-white/85 backdrop-blur-sm hover:border-slate-300 transition-all"
                style={{ boxShadow: '0 2px 8px -2px rgba(15,23,42,0.06)' }}
              >
                <Calendar className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-semibold text-slate-600 hidden sm:inline">Période :</span>
                <span className="text-xs font-bold text-slate-900">{periodLabel}</span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400 rotate-90" />
              </button>
              {showPeriodMenu && (
                <div className="absolute top-full left-0 mt-1 w-56 bg-white rounded-xl border border-slate-200 shadow-lg z-50 py-1">
                  {periodOptions.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => { setPeriod(opt.value); setShowPeriodMenu(false); }}
                      className={`w-full text-left px-4 py-2.5 text-xs font-medium transition-colors ${period === opt.value ? 'bg-teal-50 text-teal-700 font-bold' : 'text-slate-700 hover:bg-slate-50'}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => setFabOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200/80 bg-white/85 backdrop-blur-sm text-slate-700 text-xs font-semibold transition-all active:scale-95 hover:border-slate-300"
              style={{ boxShadow: '0 2px 8px -2px rgba(15,23,42,0.06)' }}
            >
              <Activity className="w-3.5 h-3.5 text-teal-600" /> Actions rapides
            </button>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {hasMultiSites && (
              <div className="flex items-center gap-2">
                <Store className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-xs font-bold text-slate-700">{currentSite?.name}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── FAB Overlay — Quick actions ── */}
      {fabOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
          <div className="absolute inset-0 bg-white/70 backdrop-blur-md" onClick={() => setFabOpen(false)} />
          <div className="relative z-10 w-full max-w-lg px-6">
            <div className="bg-white rounded-3xl border border-slate-200 shadow-[0_32px_64px_-16px_rgba(15,23,42,0.15)] p-6 animate-scale-in">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-base font-bold text-slate-900">Actions rapides</h3>
                <button onClick={() => setFabOpen(false)} className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { icon: ShoppingCart, label: 'Nouvelle vente', color: 'text-teal-600', bg: 'bg-teal-50', action: () => { setFabOpen(false); nav('pos', { target: 'directPos' }); } },
                  { icon: CreditCard, label: 'Encaisser', color: 'text-teal-700', bg: 'bg-teal-50', action: () => { setFabOpen(false); nav('pos', { target: 'directPos' }); } },
                  { icon: ClipboardList, label: 'Nouvelle commande', color: 'text-slate-600', bg: 'bg-slate-100', action: () => { setFabOpen(false); nav('supplier_orders', { target: 'newOrder' }); } },
                  { icon: Users, label: 'Nouveau client', color: 'text-sky-600', bg: 'bg-sky-50', action: () => { setFabOpen(false); openModal('customer'); } },
                  { icon: Truck, label: 'Nouveau fournisseur', color: 'text-orange-600', bg: 'bg-orange-50', action: () => { setFabOpen(false); openModal('supplier'); } },
                  { icon: ArrowDownCircle, label: 'Entrée stock', color: 'text-emerald-600', bg: 'bg-emerald-50', action: () => { setFabOpen(false); openModal('stock_in'); } },
                  { icon: ArrowUpCircle, label: 'Sortie stock', color: 'text-rose-500', bg: 'bg-rose-50', action: () => { setFabOpen(false); openModal('stock_out'); } },
                  { icon: ArrowRightLeft, label: 'Transfert', color: 'text-blue-600', bg: 'bg-blue-50', action: () => { setFabOpen(false); openModal('stock_transfer'); } },
                  { icon: BarChart3, label: 'Rapport', color: 'text-amber-600', bg: 'bg-amber-50', action: () => { setFabOpen(false); nav('reports'); } },
                ].map(item => (
                  <button
                    key={item.label}
                    onClick={item.action}
                    className="flex flex-col items-center gap-2 p-4 rounded-2xl border border-slate-100 hover:border-slate-200 hover:shadow-sm transition-all active:scale-[0.96] group"
                  >
                    <div className={`w-10 h-10 rounded-xl ${item.bg} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                      <item.icon className={`w-5 h-5 ${item.color}`} />
                    </div>
                    <span className="text-[11px] font-semibold text-slate-700 text-center leading-tight">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="px-5 xl:px-8 py-4 space-y-4">

        {/* ── ROW 1: Situation du jour (left) + Right column (Créances, Dettes, Stock) ── */}
        <div className="grid grid-cols-[minmax(0,2fr)_380px] gap-4" style={{ height: 320 }}>
          {/* Situation du jour */}
          <div className="h-[320px] overflow-hidden bg-white rounded-2xl border border-slate-200/80 p-5 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-teal-600" />
                <h3 className="text-base font-bold text-slate-900">Situation {period === 'today' ? 'du jour' : period === 'yesterday' ? "d'hier" : ''}</h3>
              </div>
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${dayDelta >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                {dayDelta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {dayDelta >= 0 ? '+' : ''}{dayDelta}% vs hier
              </span>
            </div>

            {/* Main amount */}
            <div className="mb-4">
              <p className="text-[11px] text-slate-400 font-medium mb-1">Encaissements {period === 'today' ? 'du jour' : period === 'yesterday' ? "d'hier" : 'de la période'}</p>
              <p className="text-3xl font-black text-slate-900 num tracking-tight leading-none">{formatFCFA(stats.todaySales)}</p>
            </div>

            {/* KPI Grid */}
            <div className="grid grid-cols-3 gap-3 flex-1">
              <div className="rounded-xl bg-slate-50 px-3.5 py-3 flex flex-col justify-center">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Ventes</p>
                <p className="text-lg font-bold text-slate-900 num leading-tight">{stats.todayCount}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3.5 py-3 flex flex-col justify-center">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Solde caisse</p>
                <p className="text-lg font-bold text-slate-900 num leading-tight">{formatCompactFCFA(stats.cashBalance)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3.5 py-3 flex flex-col justify-center">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Net du jour</p>
                <p className="text-lg font-bold text-teal-700 num leading-tight">{formatCompactFCFA(netFlux)}</p>
              </div>
              <div className="rounded-xl bg-rose-50/60 px-3.5 py-3 flex flex-col justify-center">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Dépenses</p>
                <p className="text-lg font-bold text-rose-600 num leading-tight">{formatCompactFCFA(stats.sessionExpenses)}</p>
              </div>
              <div className="rounded-xl bg-emerald-50/60 px-3.5 py-3 flex flex-col justify-center">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Encaissements nets</p>
                <p className="text-lg font-bold text-emerald-700 num leading-tight">{formatCompactFCFA(stats.sessionCashIn)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3.5 py-3 flex flex-col justify-center">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Ticket moyen</p>
                <p className="text-lg font-bold text-slate-900 num leading-tight">{stats.todayCount > 0 ? formatCompactFCFA(Math.round(stats.todaySales / stats.todayCount)) : '--'}</p>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-100">
              {lastSaleTime && (
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <Clock className="w-3.5 h-3.5" />
                  Dernière vente à {lastSaleTime}
                </div>
              )}
              <button onClick={() => nav('sales')} className="flex items-center gap-1 text-xs font-bold text-teal-600 hover:text-teal-700 transition-colors ml-auto">
                Voir le détail <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Right column: Créances + Dettes + Stock */}
          <div className="h-[320px] flex flex-col gap-3">
            {/* Créances clients */}
            <div className="h-[92px] shrink-0 bg-white rounded-2xl border border-slate-200/80 px-4 py-3.5">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-teal-600" />
                  <h3 className="text-sm font-bold text-slate-900">Créances clients</h3>
                </div>
                <button onClick={() => nav('tiers')} className="flex items-center gap-0.5 text-[11px] font-bold text-teal-600 hover:text-teal-700 transition-colors">
                  Voir <ChevronRight className="w-3 h-3" />
                </button>
              </div>
              <p className="text-xl font-black text-slate-900 num tracking-tight">{formatFCFA(stats.receivables)}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">{stats.customersToChase} client{stats.customersToChase > 1 ? 's' : ''} à relancer</p>
            </div>

            {/* Dettes fournisseurs */}
            <div className="h-[92px] shrink-0 bg-white rounded-2xl border border-slate-200/80 px-4 py-3.5">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <Truck className="w-4 h-4 text-orange-500" />
                  <h3 className="text-sm font-bold text-slate-900">Dettes fournisseurs</h3>
                </div>
                <button onClick={() => nav('supplier_orders')} className="flex items-center gap-0.5 text-[11px] font-bold text-orange-600 hover:text-orange-700 transition-colors">
                  Voir <ChevronRight className="w-3 h-3" />
                </button>
              </div>
              <p className="text-xl font-black text-slate-900 num tracking-tight">{formatFCFA(stats.payables)}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">{stats.suppliersToChase} fournisseur{stats.suppliersToChase > 1 ? 's' : ''} à payer</p>
            </div>

            {/* Stock à surveiller */}
            <div className="flex-1 min-h-0 bg-white rounded-2xl border border-slate-200/80 px-4 py-3.5">
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-amber-600" />
                  <h3 className="text-sm font-bold text-slate-900">Stock à surveiller</h3>
                </div>
                <button onClick={() => nav('stock')} className="text-slate-400 hover:text-teal-600 transition-colors">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-[11px] font-semibold text-slate-400 mb-0.5">Rupture</p>
                  <p className="flex items-baseline gap-1">
                    <span className="text-lg font-black text-rose-600 num">{stats.outOfStockCount}</span>
                    <span className="text-[10px] text-slate-400">articles</span>
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-slate-400 mb-0.5">Stock bas</p>
                  <p className="flex items-baseline gap-1">
                    <span className="text-lg font-black text-amber-600 num">{stats.lowStockCount}</span>
                    <span className="text-[10px] text-slate-400">articles</span>
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-slate-400 mb-0.5">À commander</p>
                  <p className="flex items-baseline gap-1">
                    <span className="text-lg font-black text-slate-700 num">{stats.outOfStockCount + stats.lowStockCount}</span>
                    <span className="text-[10px] text-slate-400">articles</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── ROW 2: Vue multi-magasins (only if 2+ sites) ── */}
        {hasMultiSites && multiSiteStats.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Network className="w-5 h-5 text-teal-600" />
                <h3 className="text-base font-bold text-slate-900">Vue multi-magasins</h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 font-bold border border-teal-100">{sites.length} magasins</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Total du jour :</span>
                <span className="text-sm font-bold text-slate-900 num">{formatFCFA(multiSiteStats.reduce((s: number, x: any) => s + x.todaySales, 0))}</span>
              </div>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {multiSiteStats.map((site: any) => {
                const isCurrent = site.id === currentSite?.id;
                const avgTicket = site.salesCount > 0 ? Math.round(site.todaySales / site.salesCount) : 0;
                return (
                  <button
                    key={site.id}
                    onClick={() => { const s = sites.find((x: any) => x.id === site.id); if (s) setCurrentSite(s); }}
                    className={`p-5 rounded-xl border text-left transition-all duration-200 ${isCurrent ? 'border-teal-300 bg-teal-50/20' : 'border-slate-200 bg-white hover:border-teal-200'}`}
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-full ${site.sessionOpen ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                        <span className="text-sm font-bold text-slate-900">{site.name}</span>
                      </div>
                      {isCurrent && <span className="text-[10px] font-bold text-teal-600 bg-teal-100 px-2 py-0.5 rounded">Actif</span>}
                    </div>
                    <div className="grid grid-cols-4 gap-4">
                      <div>
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">CA jour</p>
                        <p className="text-sm font-bold text-slate-900 num">{formatCompactFCFA(site.todaySales)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Tickets</p>
                        <p className="text-sm font-bold text-slate-900 num">{site.salesCount}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Panier moy.</p>
                        <p className="text-sm font-bold text-slate-900 num">{avgTicket > 0 ? formatCompactFCFA(avgTicket) : '--'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Caisse</p>
                        <p className={`text-sm font-bold num ${site.sessionOpen ? 'text-teal-700' : 'text-slate-400'}`}>{site.sessionOpen ? formatCompactFCFA(site.cashBalance) : 'Fermée'}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── ROW 3: Activité récente + Priorités du jour + Mouvements de caisse ── */}
        <div className="grid grid-cols-12 gap-4">
          {/* Activité récente */}
          <div className="col-span-12 xl:col-span-6 bg-white rounded-2xl border border-slate-200/80 p-5 flex flex-col max-h-[400px]">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-5 h-5 text-slate-500" />
              <h3 className="text-base font-bold text-slate-900">Activités récentes</h3>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0">
              <table className="w-full">
                <thead>
                  <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                    <th className="text-left py-2 pr-2">Type</th>
                    <th className="text-left py-2 pr-2">Référence</th>
                    <th className="text-left py-2 pr-2">Client / Fournisseur</th>
                    <th className="text-right py-2 pr-2">Heure</th>
                    <th className="text-right py-2">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recentActivities.slice(0, 8).map((act: ActivityItem) => {
                    const iconMap: Record<ActivityItem['type'], { icon: typeof Receipt; bg: string; fg: string; label: string }> = {
                      sale: { icon: Receipt, bg: 'bg-emerald-50', fg: 'text-emerald-600', label: 'Vente' },
                      quote: { icon: ClipboardList, bg: 'bg-sky-50', fg: 'text-sky-600', label: 'Devis' },
                      supplier_order: { icon: Truck, bg: 'bg-orange-50', fg: 'text-orange-600', label: 'Commande' },
                      payment_received: { icon: Coins, bg: 'bg-teal-50', fg: 'text-teal-600', label: 'Règlement client' },
                      online_order: { icon: Globe, bg: 'bg-cyan-50', fg: 'text-cyan-600', label: 'Commande web' },
                      stock_movement: { icon: RefreshCw, bg: 'bg-slate-100', fg: 'text-slate-600', label: 'Entrée stock' },
                      return: { icon: RotateCcw, bg: 'bg-rose-50', fg: 'text-rose-500', label: 'Retour fournisseur' },
                    };
                    const cfg = iconMap[act.type];
                    const Icon = cfg.icon;
                    const refPart = act.title.split(' ').slice(1).join(' ');
                    const clientPart = act.detail.split(' · ')[0];
                    const timeStr = new Date(act.time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                    return (
                      <tr key={act.id} onClick={() => nav(act.route, act.routeCtx)} className="border-b border-slate-50 hover:bg-slate-50/50 cursor-pointer transition-colors">
                        <td className="py-2.5 pr-2">
                          <div className="flex items-center gap-2">
                            <div className={`w-7 h-7 rounded-lg ${cfg.bg} flex items-center justify-center shrink-0`}>
                              <Icon className={`w-3 h-3 ${cfg.fg}`} />
                            </div>
                            <span className="text-xs font-medium text-slate-600">{cfg.label}</span>
                          </div>
                        </td>
                        <td className="py-2.5 pr-2">
                          <span className="text-xs font-semibold text-slate-700">{refPart}</span>
                        </td>
                        <td className="py-2.5 pr-2">
                          <span className="text-xs text-slate-500">{clientPart}</span>
                        </td>
                        <td className="py-2.5 pr-2 text-right">
                          <span className="text-xs text-slate-400">{timeStr}</span>
                        </td>
                        <td className="py-2.5 text-right">
                          {act.amount !== null && (
                            <span className={`text-xs font-bold num ${act.amountType === 'positive' ? 'text-emerald-600' : act.amountType === 'negative' ? 'text-rose-500' : 'text-slate-600'}`}>
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
                  <Activity className="w-8 h-8 text-slate-200 mb-2" />
                  <p className="text-xs text-slate-400">Aucune activité récente</p>
                </div>
              )}
            </div>
            {stats.recentActivities.length > 0 && (
              <button onClick={() => nav('sales')} className="flex items-center gap-1 text-xs font-bold text-teal-600 hover:text-teal-700 mt-3 pt-3 border-t border-slate-100 transition-colors">
                Voir toute l'activité <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Priorités du jour */}
          <div className="col-span-12 xl:col-span-3 bg-white rounded-2xl border border-slate-200/80 p-5">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <h3 className="text-base font-bold text-slate-900">Priorités du jour</h3>
            </div>
            <div className="space-y-1">
              {stats.receivables > 0 && (
                <button onClick={() => nav('tiers')} className="w-full flex items-center gap-3 py-3 px-2 rounded-xl hover:bg-slate-50 active:scale-[0.98] transition-all text-left group">
                  <div className="w-2 h-2 rounded-full bg-slate-300 shrink-0" />
                  <span className="flex-1 text-sm text-slate-700 group-hover:text-teal-700 transition-colors">Relancer les clients</span>
                  <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded">{stats.customersToChase}</span>
                  <ChevronRight className="w-4 h-4 text-slate-300" />
                </button>
              )}
              {stats.payables > 0 && (
                <button onClick={() => nav('supplier_orders')} className="w-full flex items-center gap-3 py-3 px-2 rounded-xl hover:bg-slate-50 active:scale-[0.98] transition-all text-left group">
                  <div className="w-2 h-2 rounded-full bg-slate-300 shrink-0" />
                  <span className="flex-1 text-sm text-slate-700 group-hover:text-teal-700 transition-colors">Payer fournisseurs</span>
                  <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded">{stats.suppliersToChase}</span>
                  <ChevronRight className="w-4 h-4 text-slate-300" />
                </button>
              )}
              {stats.pendingReturns > 0 && (
                <button onClick={() => nav('sales')} className="w-full flex items-center gap-3 py-3 px-2 rounded-xl hover:bg-slate-50 active:scale-[0.98] transition-all text-left group">
                  <div className="w-2 h-2 rounded-full bg-slate-300 shrink-0" />
                  <span className="flex-1 text-sm text-slate-700 group-hover:text-teal-700 transition-colors">Réception fournisseur</span>
                  <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded">{stats.pendingReturns}</span>
                  <ChevronRight className="w-4 h-4 text-slate-300" />
                </button>
              )}
              {stats.sessionInfo && (
                <button onClick={() => nav('pos')} className="w-full flex items-center gap-3 py-3 px-2 rounded-xl hover:bg-slate-50 active:scale-[0.98] transition-all text-left group">
                  <div className="w-2 h-2 rounded-full bg-slate-300 shrink-0" />
                  <span className="flex-1 text-sm text-slate-700 group-hover:text-teal-700 transition-colors">Clôturer la caisse</span>
                  <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded">Aujourd'hui</span>
                  <ChevronRight className="w-4 h-4 text-slate-300" />
                </button>
              )}
              {!stats.receivables && !stats.payables && !stats.pendingReturns && !stats.sessionInfo && (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <CheckCircle className="w-8 h-8 text-emerald-300 mb-2" />
                  <p className="text-xs font-semibold text-emerald-600">Tout est en ordre</p>
                </div>
              )}
            </div>
          </div>

          {/* Mouvements de caisse */}
          <div className="col-span-12 xl:col-span-3 bg-white rounded-2xl border border-slate-200/80 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Coins className="w-5 h-5 text-teal-600" />
                <h3 className="text-sm font-bold text-slate-900">Mouvements de caisse</h3>
              </div>
              <span className="text-[10px] font-medium text-slate-400 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">Aujourd'hui</span>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">Solde d'ouverture</span>
                <span className="text-sm font-semibold text-slate-900 num">{formatCompactFCFA(stats.sessionInfo?.openingAmount || 0)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">Encaissements</span>
                <span className="text-sm font-bold text-teal-600 num">{formatCompactFCFA(stats.todaySales)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">Dépenses</span>
                <span className="text-sm font-bold text-rose-500 num">-{formatCompactFCFA(stats.sessionExpenses)}</span>
              </div>
              <div className="pt-3 mt-2 border-t border-slate-200">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-900">Solde actuel</span>
                  <span className="text-lg font-black text-teal-700 num">{formatCompactFCFA(stats.cashBalance)}</span>
                </div>
              </div>
              <button onClick={() => nav('cash_history')} className="flex items-center gap-1 text-xs font-bold text-teal-600 hover:text-teal-700 mt-2 transition-colors">
                Voir le détail de la caisse <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Quick-action modals ────────────────────────────────────────────── */}
      <Modal open={qaModal === 'customer'} onClose={() => setQAModal(null)} title="Nouveau client" size="sm"
        footer={<><button onClick={() => setQAModal(null)} className="btn-secondary">Annuler</button><button onClick={saveCustomer} disabled={qaSaving || !custForm.name?.trim()} className="btn-primary">{qaSaving && <Loader2 className="w-4 h-4 animate-spin" />}Créer le client</button></>}>
        <div className="space-y-3">
          <div>
            <label className="label">Nom *</label>
            <input value={custForm.name || ''} onChange={e => setCustForm((f: any) => ({ ...f, name: e.target.value }))} className="input" autoFocus={desktopAutoFocus} placeholder="Nom du client" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Type</label>
              <select value={custForm.customer_type || 'particulier'} onChange={e => setCustForm((f: any) => ({ ...f, customer_type: e.target.value }))} className="input">
                <option value="particulier">Particulier</option>
                <option value="professionnel">Professionnel</option>
                <option value="garage">Garage</option>
                <option value="revendeur">Revendeur</option>
                <option value="societe">Société</option>
              </select>
            </div>
            <div>
              <label className="label">Telephone</label>
              <input value={custForm.phone || ''} onChange={e => setCustForm((f: any) => ({ ...f, phone: e.target.value }))} className="input" placeholder="+221 77 000 00 00" />
            </div>
          </div>
          <div>
            <label className="label">WhatsApp</label>
            <input value={custForm.whatsapp || ''} onChange={e => setCustForm((f: any) => ({ ...f, whatsapp: e.target.value }))} className="input" placeholder="+221 77 000 00 00" />
          </div>
          <div>
            <label className="label">Adresse</label>
            <input value={custForm.address || ''} onChange={e => setCustForm((f: any) => ({ ...f, address: e.target.value }))} className="input" />
          </div>
        </div>
      </Modal>

      <Modal open={qaModal === 'supplier'} onClose={() => setQAModal(null)} title="Nouveau fournisseur" size="sm"
        footer={<><button onClick={() => setQAModal(null)} className="btn-secondary">Annuler</button><button onClick={saveSupplier} disabled={qaSaving || !supForm.name?.trim()} className="btn-primary">{qaSaving && <Loader2 className="w-4 h-4 animate-spin" />}Creer le fournisseur</button></>}>
        <div className="space-y-3">
          <div>
            <label className="label">Nom *</label>
            <input value={supForm.name || ''} onChange={e => setSupForm((f: any) => ({ ...f, name: e.target.value }))} className="input" autoFocus={desktopAutoFocus} placeholder="Nom du fournisseur" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Contact</label>
              <input value={supForm.contact || ''} onChange={e => setSupForm((f: any) => ({ ...f, contact: e.target.value }))} className="input" />
            </div>
            <div>
              <label className="label">Telephone</label>
              <input value={supForm.phone || ''} onChange={e => setSupForm((f: any) => ({ ...f, phone: e.target.value }))} className="input" placeholder="+221 33 000 00 00" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">WhatsApp</label>
              <input value={supForm.whatsapp || ''} onChange={e => setSupForm((f: any) => ({ ...f, whatsapp: e.target.value }))} className="input" />
            </div>
            <div>
              <label className="label">Pays</label>
              <input value={supForm.country || 'Senegal'} onChange={e => setSupForm((f: any) => ({ ...f, country: e.target.value }))} className="input" />
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={qaModal === 'stock_in' || qaModal === 'stock_out'}
        onClose={() => setQAModal(null)}
        title={qaModal === 'stock_in' ? 'Entrée de stock' : 'Sortie de stock'}
        size="sm"
        footer={<><button onClick={() => setQAModal(null)} className="btn-secondary">Annuler</button><button onClick={saveStockAdj} disabled={qaSaving || adjQty === '' || Number(adjQty) <= 0} className="btn-primary">{qaSaving && <Loader2 className="w-4 h-4 animate-spin" />}Valider</button></>}
      >
        <div className="space-y-3">
          {adjRow && (
            <div className="p-3 rounded-xl bg-gradient-to-br from-slate-50 to-white border border-slate-200">
              <div className="text-[12px] font-semibold text-slate-900 truncate">{adjRow.name}</div>
              <div className="text-[10px] text-slate-500 font-mono">{adjRow.internal_ref}</div>
              <div className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-700">
                Stock actuel : <span className="num">{adjRow.quantity}</span>
              </div>
            </div>
          )}
          <div>
            <label className="label">Article</label>
            <SearchableSelect
              options={stockRows.map(r => ({ value: r.article_id, label: r.name, sublabel: r.internal_ref }))}
              value={adjArticleId}
              onChange={v => setAdjArticleId(v)}
              placeholder="Rechercher un article..."
            />
          </div>
          <div>
            <label className="label">Quantite</label>
            <input type="number" min={1} value={adjQty} onChange={e => setAdjQty(Number(e.target.value))} className="input text-lg font-semibold" autoFocus={desktopAutoFocus} />
          </div>
          <div>
            <label className="label">Note / motif</label>
            <input value={adjNote} onChange={e => setAdjNote(e.target.value)} className="input" placeholder="Achat, retour, perte, correction..." />
          </div>
        </div>
      </Modal>

      <Modal open={qaModal === 'stock_transfer'} onClose={() => setQAModal(null)} title="Transfert de stock" size="sm"
        footer={<><button onClick={() => setQAModal(null)} className="btn-secondary">Annuler</button><button onClick={saveStockAdj} disabled={qaSaving || adjQty === '' || Number(adjQty) <= 0 || !adjTargetSite} className="btn-primary">{qaSaving && <Loader2 className="w-4 h-4 animate-spin" />}Transferer</button></>}>
        <div className="space-y-3">
          <div>
            <label className="label">Article</label>
            <SearchableSelect
              options={stockRows.map(r => ({ value: r.article_id, label: r.name, sublabel: r.internal_ref }))}
              value={adjArticleId}
              onChange={v => setAdjArticleId(v)}
              placeholder="Rechercher un article..."
            />
          </div>
          <div>
            <label className="label">Magasin de destination</label>
            <SearchableSelect
              options={sites.filter((s: any) => s.id !== currentSite?.id).map((s: any) => ({ value: s.id, label: s.name }))}
              value={adjTargetSite}
              onChange={v => setAdjTargetSite(v)}
              placeholder="-- Choisir --"
              searchable={false}
            />
          </div>
          <div>
            <label className="label">Quantite a transferer</label>
            <input type="number" min={1} value={adjQty} onChange={e => setAdjQty(Number(e.target.value))} className="input" autoFocus={desktopAutoFocus} />
          </div>
          <div>
            <label className="label">Note</label>
            <input value={adjNote} onChange={e => setAdjNote(e.target.value)} className="input" placeholder="Motif du transfert" />
          </div>
        </div>
      </Modal>

      <Modal open={!!stockDone} onClose={() => setStockDone(null)} title="Mouvement enregistré" size="sm"
        footer={<button onClick={() => setStockDone(null)} className="btn-primary">Fermer</button>}>
        {stockDone && (
          <div className="text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-full bg-emerald-50 flex items-center justify-center">
              <CheckIcon className="w-7 h-7 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">{stockDone.label}</p>
              <p className="text-xs text-slate-500 mt-1">{stockDone.articleName} - Qté: {stockDone.qty}</p>
            </div>
            <div className="flex items-center justify-center gap-2 pt-2">
              <button onClick={() => printStockDone('a4')} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                <FileText className="w-3.5 h-3.5" /> Imprimer A4
              </button>
              <button onClick={() => printStockDone('80')} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                <Receipt className="w-3.5 h-3.5" /> Ticket 80mm
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
