import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { usePermissions } from '../lib/permissions';
import { formatFCFA, formatCompactFCFA } from '../lib/format';
import { setNavContext, type NavContext } from '../lib/navHighlight';
import {
  TrendingUp, TrendingDown, AlertTriangle, Package, Loader2,
  Users, FileText, RotateCcw, ExternalLink, Globe,
  ShoppingCart, ChevronRight, Bell,
  CheckCircle, Clock, Receipt, Wallet, ArrowUpRight, ArrowDownRight,
  ArrowUpLeft, CreditCard, Truck, Activity, Eye, EyeOff, Plus, X,
} from 'lucide-react';

type ShopInfo = { slug: string | null; isActive: boolean };

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
  pendingQuotes: number;
  pendingReturns: number;
  stockInToday: number;
  recentSales: Array<{
    id: string; sale_number: string; total: number; created_at: string;
    customers: { name: string } | null;
    sale_payments?: Array<{ method_name?: string | null }>;
  }>;
  webNew: number;
  webPrep: number;
  webReady: number;
  webTodayCount: number;
  webTodayTotal: number;
  webAvgWait: number;
  lastWebOrder: { order_number: string; customer_name: string | null; total: number; created_at: string } | null;
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

  useEffect(() => {
    if (!tenant || !currentSite) return;
    let cancelled = false;
    (async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const yest = new Date(today); yest.setDate(yest.getDate() - 1);
      const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const siteId = currentSite.id;

      const [
        todayData, yestData, monthData, articlesCount, stockData, recent,
        custData, suppData, quotesData, returnsData, shopData,
        webNewData, webPrepData, webReadyData, webTodayData, webWaitData, lastWebOrderData,
        openSessions, stockInTodayData,
      ] = await Promise.all([
        supabase.from('sales').select('total').eq('tenant_id', tenant.id).eq('site_id', siteId).gte('created_at', today.toISOString()).neq('status', 'cancelled'),
        supabase.from('sales').select('total').eq('tenant_id', tenant.id).eq('site_id', siteId).gte('created_at', yest.toISOString()).lt('created_at', today.toISOString()).neq('status', 'cancelled'),
        supabase.from('sales').select('total, sale_items(total, purchase_cost, quantity)').eq('tenant_id', tenant.id).eq('site_id', siteId).gte('created_at', firstOfMonth.toISOString()).neq('status', 'cancelled'),
        supabase.from('articles').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('is_active', true),
        supabase.from('stock_levels').select('quantity, articles!inner(stock_min)').eq('tenant_id', tenant.id).eq('site_id', siteId),
        supabase.from('sales').select('id, sale_number, total, created_at, customers(name), sale_payments(method_name)').eq('tenant_id', tenant.id).eq('site_id', siteId).neq('status', 'cancelled').order('created_at', { ascending: false }).limit(5),
        supabase.from('customers').select('id').eq('tenant_id', tenant.id).eq('is_active', true),
        supabase.from('suppliers').select('id').eq('tenant_id', tenant.id).eq('is_active', true),
        supabase.from('quotes').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('site_id', siteId).in('status', ['draft', 'sent']),
        supabase.from('sale_returns').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('site_id', siteId).eq('status', 'pending'),
        supabase.from('tenants').select('public_slug').eq('id', tenant.id).maybeSingle(),
        supabase.from('online_orders').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('status', 'nouvelle'),
        supabase.from('online_orders').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('status', 'en_preparation'),
        supabase.from('online_orders').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('status', 'prete'),
        supabase.from('online_orders').select('total').eq('tenant_id', tenant.id).gte('created_at', today.toISOString()).neq('status', 'annulee'),
        supabase.from('online_orders').select('created_at').eq('tenant_id', tenant.id).eq('status', 'nouvelle').order('created_at', { ascending: true }).limit(1),
        supabase.from('online_orders').select('order_number, customer_name, total, created_at').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('cash_sessions').select('id, opening_amount, theoretical_amount, counted_cash, opened_at').eq('tenant_id', tenant.id).eq('site_id', siteId).eq('status', 'open'),
        supabase.from('stock_movements').select('quantity').eq('tenant_id', tenant.id).eq('site_id', siteId).in('movement_type', ['purchase', 'adjustment_in']).gte('created_at', today.toISOString()),
      ]);

      if (shopData.data?.public_slug) {
        const { data: ss } = await supabase.from('shop_settings').select('is_active').eq('tenant_id', tenant.id).maybeSingle();
        setShopInfo({ slug: shopData.data.public_slug, isActive: ss?.is_active ?? false });
      } else {
        setShopInfo({ slug: null, isActive: false });
      }

      const todaySales = (todayData.data || []).reduce((s, r) => s + Number(r.total), 0);
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
      // Only count as rupture if stock_min > 0 (merchant actively tracks this item's minimum)
      const out = stockRows.filter((r: any) => Number(r.quantity) <= 0 && Number(r.articles?.stock_min || 0) > 0).length;

      const webTodayRows = (webTodayData.data || []) as any[];
      const webTodayTotal = webTodayRows.reduce((s, r) => s + Number(r.total || 0), 0);

      const { data: unpaidOrders } = await supabase
        .from('supplier_orders')
        .select('total, paid')
        .eq('tenant_id', tenant.id)
        .neq('status', 'cancelled');
      const payables = (unpaidOrders || []).reduce((s: number, o: any) => {
        const remaining = Number(o.total || 0) - Number(o.paid || 0);
        return s + Math.max(0, remaining);
      }, 0);
      const customersCount = (custData.data || []).length;

      const { data: unpaidSales } = await supabase
        .from('sales')
        .select('total, paid')
        .eq('tenant_id', tenant.id)
        .eq('site_id', siteId)
        .not('customer_id', 'is', null)
        .neq('status', 'cancelled')
        .neq('status', 'paid');
      const receivables = (unpaidSales || []).reduce((s: number, sale: any) => {
        const remaining = Number(sale.total || 0) - Number(sale.paid || 0);
        return s + Math.max(0, remaining);
      }, 0);

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

      const firstWaitRow = (webWaitData.data || [])[0];
      const avgWaitMin = firstWaitRow ? Math.max(0, Math.floor((Date.now() - new Date(firstWaitRow.created_at).getTime()) / 60000)) : 0;

      const next: Stats = {
        todaySales, todayCount: todayData.data?.length || 0,
        yesterdaySales,
        monthSales, monthMargin,
        cashBalance, sessionExpenses: sessionMovExpense, sessionCashIn: sessionMovIncome,
        sessionInfo,
        receivables, payables,
        articlesCount: articlesCount.count || 0,
        lowStockCount: low, outOfStockCount: out,
        customersCount,
        suppliersCount: (suppData.data || []).length,
        pendingQuotes: quotesData.count || 0,
        pendingReturns: returnsData.count || 0,
        stockInToday: stockIn,
        recentSales: (recent.data as any) || [],
        webNew: webNewData.count || 0,
        webPrep: webPrepData.count || 0,
        webReady: webReadyData.count || 0,
        webTodayCount: webTodayRows.length,
        webTodayTotal,
        webAvgWait: avgWaitMin,
        lastWebOrder: lastWebOrderData.data as any || null,
      };
      if (!cancelled) { setStats(next); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [tenant, dataTick, currentSite?.id]);

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
          greet={hourGreet}
          firstName={firstName}
          tenantName={tenant?.name || ''}
          tenantLegal={tenant?.legal_name || 'Business 2.0'}
          dayDelta={dayDelta}
          marginPct={marginPct}
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
          marginPct={marginPct}
          nav={nav}
        />
      </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 *  MOBILE DASHBOARD — Ultra-compact Premium Fintech 2026
 * ════════════════════════════════════════════════════════════════════════════ */
function MobileDashboard({
  stats, shopInfo, greet, firstName, dayDelta, marginPct, nav,
  balanceHidden, toggleBalanceHidden,
}: any) {
  const now = new Date();

  return (
    <div className="space-y-2 animate-fade-in pb-2">
      {/* ── GREETING ── */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold text-slate-800 tracking-tight">
            {greet}{firstName ? `, ${firstName}` : ''}
          </div>
          <div className="text-[10px] text-slate-400 font-medium capitalize">
            {now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
        </div>
        {shopInfo?.isActive && shopInfo.slug && (
          <button
            onClick={() => window.open(`${window.location.origin}/shop/${shopInfo.slug}`, '_blank')}
            className="flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-bold active:scale-95 shrink-0 border bg-emerald-50 border-emerald-200 text-emerald-700"
          >
            <span className="relative flex w-1.5 h-1.5">
              <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-75" />
              <span className="relative rounded-full bg-emerald-500 w-1.5 h-1.5" />
            </span>
            Boutique
            <ExternalLink className="w-2.5 h-2.5" />
          </button>
        )}
      </div>

      {/* ── HERO CARD — Clean, fluid, minimal internal borders ── */}
      <button
        onClick={() => nav('sales')}
        className="w-full text-left relative overflow-hidden rounded-[20px] p-4 active:scale-[0.985] transition-transform duration-200"
        style={{
          background: 'linear-gradient(145deg, #021e2f 0%, #053d47 40%, #0a5e58 70%, #0d8f82 100%)',
          boxShadow: '0 20px 40px -12px rgba(5, 61, 71, 0.55), 0 6px 12px -4px rgba(13, 148, 136, 0.25)',
        }}
      >
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-gradient-to-br from-teal-300/20 to-transparent blur-3xl animate-pulse-slow" />
          <div className="absolute -bottom-20 -left-10 w-52 h-52 rounded-full bg-gradient-to-tr from-cyan-300/10 to-transparent blur-3xl" />
        </div>

        <div className="relative">
          <div className="flex items-start justify-between mb-0.5">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-teal-300 animate-pulse" />
              <span className="text-[9px] font-bold text-teal-200/70 uppercase tracking-[0.15em]">
                Encaissement du jour
              </span>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); toggleBalanceHidden(); }}
              className="w-6 h-6 rounded-full bg-white/8 border border-white/10 flex items-center justify-center active:scale-90 transition-transform"
              aria-label={balanceHidden ? 'Afficher' : 'Masquer'}
            >
              {balanceHidden ? <Eye className="w-3 h-3 text-white/60" /> : <EyeOff className="w-3 h-3 text-white/60" />}
            </button>
          </div>

          {/* Main amount - auto-sizing for large amounts */}
          <div className="num font-black text-white leading-none tracking-tight" style={{ fontSize: 'clamp(22px, 7vw, 30px)' }}>
            {balanceHidden ? '••••••' : formatFCFA(stats.todaySales)}
          </div>

          {/* Delta + tickets inline */}
          {!balanceHidden && (
            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${dayDelta >= 0 ? 'bg-emerald-400/15 text-emerald-200' : 'bg-rose-400/15 text-rose-200'}`}>
                {dayDelta >= 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                {dayDelta >= 0 ? '+' : ''}{dayDelta}%
              </span>
              <span className="text-[9px] text-white/40 font-medium">vs hier</span>
              <span className="ml-auto inline-flex items-center gap-1 text-[9px] text-white/50 font-medium">
                <Receipt className="w-2.5 h-2.5" />
                {stats.todayCount} ticket{stats.todayCount > 1 ? 's' : ''}
              </span>
            </div>
          )}

          {/* Session metrics - subtle separation, no hard borders */}
          <div className="mt-3 pt-2.5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            {stats.sessionInfo ? (
              <div className="flex items-center gap-1 mb-2 text-[8px] text-teal-200/50 font-semibold uppercase tracking-[0.1em]">
                <Clock className="w-2.5 h-2.5" />
                Session {new Date(stats.sessionInfo.openedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
              </div>
            ) : (
              <div className="flex items-center gap-1 mb-2 text-[8px] text-white/25 font-medium">
                Aucune session
              </div>
            )}

            <div className="flex items-center gap-2">
              <HeroMetric label="Caisse" value={balanceHidden ? '•••' : formatCompactFCFA(stats.cashBalance)} icon={Wallet} />
              <div className="w-px h-5 bg-white/8 shrink-0" />
              <HeroMetric label="Entrées" value={balanceHidden ? '•••' : formatCompactFCFA(stats.sessionCashIn)} icon={ArrowDownRight} positive />
              <div className="w-px h-5 bg-white/8 shrink-0" />
              <HeroMetric label="Dépenses" value={balanceHidden ? '•••' : formatCompactFCFA(stats.sessionExpenses)} icon={ArrowUpLeft} negative />
            </div>

            {!balanceHidden && (
              <div className="mt-2 flex items-center justify-between text-[9px]">
                <span className="text-white/40 font-medium">Mois</span>
                <span className="text-white/90 font-bold num">{formatCompactFCFA(stats.monthSales)}</span>
                {marginPct > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-emerald-400/10 text-emerald-200 text-[8px] font-bold">
                    marge {marginPct}%
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </button>

      {/* ── KPI GRID — No scroll, compact 2x3 grid ── */}
      <div className="grid grid-cols-3 gap-1">
        <KpiCard
          tone="blue"
          icon={CreditCard}
          label="Créances"
          value={balanceHidden ? '•••' : formatCompactFCFA(stats.receivables)}
          onClick={() => nav('tiers', { target: 'receivables' })}
        />
        <KpiCard
          tone="amber"
          icon={Truck}
          label="Fournisseurs"
          value={balanceHidden ? '•••' : formatCompactFCFA(stats.payables)}
          onClick={() => nav('supplier_orders', { target: 'payables' })}
        />
        <KpiCard
          tone={stats.outOfStockCount > 0 ? 'rose' : 'slate'}
          icon={AlertTriangle}
          label="Ruptures"
          value={String(stats.outOfStockCount)}
          onClick={() => nav('stock', { target: 'outOfStock' })}
          pulse={stats.outOfStockCount > 0}
        />
        <KpiCard
          tone="emerald"
          icon={Package}
          label="Stock"
          value={`+${stats.stockInToday}`}
          onClick={() => nav('stock', { target: 'stockIn' })}
        />
        <KpiCard
          tone="blue"
          icon={FileText}
          label="Devis"
          value={String(stats.pendingQuotes)}
          onClick={() => nav('billing', { target: 'quotes' })}
        />
        <KpiCard
          tone="teal"
          icon={Globe}
          label="Web"
          value={String(stats.webNew)}
          onClick={() => nav('online_orders', stats.webNew > 0 ? { target: 'webNew' } : undefined)}
          pulse={stats.webNew > 0}
        />
      </div>

      {/* ── ONLINE ORDERS — Compact funnel ── */}
      {(stats.webNew > 0 || stats.webPrep > 0 || stats.webReady > 0) && (
        <div
          className="rounded-2xl overflow-hidden bg-white"
          style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.04)', border: '1px solid rgba(226,232,240,0.6)' }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100/60">
            <div className="flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-teal-600" />
              <span className="text-[11px] font-bold text-slate-800">Commandes en ligne</span>
            </div>
            <button onClick={() => nav('online_orders')} className="text-[9px] font-bold text-brand-700 flex items-center gap-0.5">
              Voir <ChevronRight className="w-2.5 h-2.5" />
            </button>
          </div>
          <div className="grid grid-cols-3 divide-x divide-slate-100/60">
            <FunnelCell count={stats.webNew} label="Nouvelles" tone="rose" onClick={() => nav('online_orders', { target: 'webNew' })} pulse />
            <FunnelCell count={stats.webPrep} label="Préparation" tone="amber" onClick={() => nav('online_orders', { target: 'webPrep' })} />
            <FunnelCell count={stats.webReady} label="Prêtes" tone="emerald" onClick={() => nav('online_orders', { target: 'webReady' })} />
          </div>
        </div>
      )}

      {/* ── INTELLIGENT ALERTS ── */}
      <IntelligentAlerts stats={stats} nav={nav} />

      {/* ── BUSINESS PULSE — Compact summary replacing verbose activity ── */}
      <BusinessPulse stats={stats} balanceHidden={balanceHidden} nav={nav} />

      {/* ── FOOTER STATS ── */}
      <div className="grid grid-cols-3 gap-1">
        <FooterChip icon={Package} value={stats.articlesCount} label="Articles" onClick={() => nav('articles')} />
        <FooterChip icon={Users} value={stats.customersCount} label="Clients" onClick={() => nav('tiers')} />
        <FooterChip icon={Truck} value={stats.suppliersCount} label="Fourn." onClick={() => nav('tiers')} />
      </div>

      {shopInfo && !shopInfo.isActive && shopInfo.slug === null && (
        <button
          onClick={() => nav('settings')}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-2xl bg-slate-50 border border-dashed border-slate-200 active:bg-slate-100"
        >
          <Globe className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="text-[10px] text-slate-500 font-semibold flex-1 text-left">Activer la boutique en ligne</span>
          <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />
        </button>
      )}

    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 *  DESKTOP DASHBOARD — cockpit
 * ════════════════════════════════════════════════════════════════════════════ */
function DesktopDashboard({ stats, shopInfo, greet, firstName, dayDelta, marginPct, nav }: any) {
  const now = new Date();

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
            {greet}{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="text-sm text-slate-500 font-medium capitalize mt-0.5">
            {now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {shopInfo?.isActive && shopInfo.slug && (
            <button
              onClick={() => window.open(`${window.location.origin}/shop/${shopInfo.slug}`, '_blank')}
              className="inline-flex items-center gap-2 h-10 px-3.5 rounded-2xl bg-white border border-emerald-200 text-emerald-700 text-sm font-bold hover:bg-emerald-50 transition-colors"
            >
              <span className="relative flex w-1.5 h-1.5">
                <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-75" />
                <span className="relative rounded-full bg-emerald-500 w-1.5 h-1.5" />
              </span>
              Boutique en ligne active
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => nav('pos')}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-2xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 transition-colors shadow-lg shadow-slate-900/20"
          >
            <ShoppingCart className="w-4 h-4" />
            Ouvrir la caisse
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-5 items-stretch">
        <div className="col-span-12 xl:col-span-8 space-y-5">
          {/* Hero */}
          <button
            onClick={() => nav('sales')}
            className="w-full text-left relative overflow-hidden rounded-[32px] p-6 group hover:scale-[1.005] transition-transform"
            style={{
              background: 'linear-gradient(135deg, #041d2e 0%, #063b44 45%, #0d5c5c 75%, #0d9488 100%)',
              boxShadow: '0 25px 60px -20px rgba(6, 59, 68, 0.55), 0 10px 24px -10px rgba(13, 148, 136, 0.35), inset 0 1px 0 rgba(255,255,255,0.1)',
            }}
          >
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-gradient-to-br from-teal-300/30 via-teal-400/10 to-transparent blur-3xl animate-pulse-slow" />
              <div className="absolute -bottom-32 -left-16 w-80 h-80 rounded-full bg-gradient-to-tr from-cyan-300/20 to-transparent blur-3xl" />
              <div
                className="absolute inset-0 opacity-[0.08]"
                style={{
                  backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
                  backgroundSize: '28px 28px',
                  maskImage: 'radial-gradient(ellipse at top right, black 0%, transparent 70%)',
                  WebkitMaskImage: 'radial-gradient(ellipse at top right, black 0%, transparent 70%)',
                }}
              />
            </div>

            <div className="relative flex items-center justify-between gap-6">
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="w-1 h-1 rounded-full bg-teal-300 animate-pulse" />
                  <span className="text-[11px] font-bold text-teal-100/90 uppercase tracking-[0.2em]">
                    Encaissement du jour
                  </span>
                </div>
                <div className="text-[44px] font-black text-white leading-none tracking-tight num whitespace-nowrap">
                  {formatFCFA(stats.todaySales)}
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
                      dayDelta >= 0 ? 'bg-emerald-400/20 text-emerald-200' : 'bg-rose-400/20 text-rose-200'
                    }`}
                  >
                    {dayDelta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {dayDelta >= 0 ? '+' : ''}{dayDelta}% vs hier
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-sm text-white/70">
                    <FileText className="w-3.5 h-3.5" />
                    {stats.todayCount} tickets
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-sm text-white/70">
                    <Wallet className="w-3.5 h-3.5" />
                    Mois : <span className="text-white font-bold num">{formatFCFA(stats.monthSales)}</span>
                    {marginPct > 0 && <span className="text-emerald-300 font-bold">· marge {marginPct}%</span>}
                  </span>
                </div>
              </div>
              <div className="w-14 h-14 rounded-3xl bg-white/10 backdrop-blur-sm border border-white/15 flex items-center justify-center group-hover:bg-white/15">
                <ArrowUpRight className="w-6 h-6 text-white" />
              </div>
            </div>

            <div className="relative mt-5 pt-5 border-t border-white/10">
              {stats.sessionInfo && (
                <div className="flex items-center gap-1.5 mb-3 text-[10px] text-white/50 font-medium uppercase tracking-wider">
                  <Clock className="w-3 h-3" />
                  Session ouverte le {new Date(stats.sessionInfo.openedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })} à {new Date(stats.sessionInfo.openedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
              {!stats.sessionInfo && (
                <div className="flex items-center gap-1.5 mb-3 text-[10px] text-white/40 font-medium">
                  Aucune session ouverte
                </div>
              )}
              <div className="grid grid-cols-3 gap-3">
                <InnerBankMetric label="Solde caisse" value={formatFCFA(stats.cashBalance)} icon={Wallet} />
                <InnerBankMetric label="Entrées" value={formatFCFA(stats.sessionCashIn)} icon={ArrowDownRight} positive />
                <InnerBankMetric label="Dépenses" value={formatFCFA(stats.sessionExpenses)} icon={ArrowUpLeft} negative />
              </div>
            </div>
          </button>

          {/* Online orders */}
          <Section
            icon={Globe}
            iconGradient="from-teal-500 to-teal-700"
            title="Centre de commandes en ligne"
            subtitle={`${stats.webTodayCount} aujourd'hui · ${formatFCFA(stats.webTodayTotal)}`}
            action={{ label: 'Gérer', onClick: () => nav('online_orders'), dark: true }}
            desktop
          >
            <div className="grid grid-cols-3 divide-x divide-slate-100">
              <FunnelCell count={stats.webNew} label="Nouvelles" tone="rose" onClick={() => nav('online_orders')} pulse large />
              <FunnelCell count={stats.webPrep} label="Préparation" tone="amber" onClick={() => nav('online_orders')} large />
              <FunnelCell count={stats.webReady} label="Prêtes" tone="emerald" onClick={() => nav('online_orders')} large />
            </div>
            {stats.lastWebOrder && (
              <button onClick={() => nav('online_orders')} className="w-full flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-50 hover:bg-slate-50/70 text-left">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-2xl bg-teal-50 border border-teal-100 flex items-center justify-center">
                    <Clock className="w-4 h-4 text-teal-600" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-900">
                      {stats.lastWebOrder.order_number} · {stats.lastWebOrder.customer_name || 'Client'}
                    </div>
                    <div className="text-xs text-slate-500 font-medium">
                      {getTimeAgo(stats.lastWebOrder.created_at)}{stats.webAvgWait > 0 && stats.webNew > 0 ? ` · attente ${stats.webAvgWait}min` : ''}
                    </div>
                  </div>
                </div>
                <span className="text-base font-extrabold text-slate-900 num">{formatFCFA(stats.lastWebOrder.total)}</span>
              </button>
            )}
          </Section>

          {/* Timeline */}
          <Section
            icon={Activity}
            iconGradient="from-slate-700 to-slate-900"
            title="Dernières transactions"
            subtitle="Flux temps réel"
            action={{ label: 'Journal complet', onClick: () => nav('sales') }}
            desktop
          >
            {stats.recentSales.length === 0 ? (
              <button onClick={() => nav('pos')} className="w-full py-10 text-center hover:bg-slate-50/50">
                <div className="w-12 h-12 mx-auto mb-3 rounded-3xl bg-brand-50 border border-brand-100 flex items-center justify-center">
                  <ShoppingCart className="w-5 h-5 text-brand-600" />
                </div>
                <div className="text-sm text-slate-500 font-semibold">Aucune vente aujourd'hui</div>
                <div className="text-xs text-brand-600 font-bold mt-1">Ouvrir la caisse →</div>
              </button>
            ) : (
              <div className="divide-y divide-slate-50">
                {stats.recentSales.slice(0, 4).map((s: any) => (
                  <button
                    key={s.id}
                    onClick={() => nav('sales')}
                    className="w-full flex items-center gap-4 px-5 py-3 hover:bg-slate-50/60 text-left"
                  >
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-[0_4px_12px_-2px_rgba(16,185,129,0.5)]">
                      <CheckCircle className="w-4 h-4 text-white" strokeWidth={2.5} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-slate-900 truncate">{s.customers?.name || 'Client comptoir'}</div>
                      <div className="text-xs text-slate-500 font-medium">
                        {s.sale_number} · {getTimeAgo(s.created_at)}
                        {s.sale_payments?.[0]?.method_name && ` · ${s.sale_payments[0].method_name}`}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-base font-extrabold text-slate-900 num whitespace-nowrap">+{formatFCFA(s.total)}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Section>

          <div className="grid grid-cols-3 gap-2">
            <FooterChip icon={Package} value={stats.articlesCount} label="Articles" onClick={() => nav('articles')} />
            <FooterChip icon={Users} value={stats.customersCount} label="Clients" onClick={() => nav('tiers')} />
            <FooterChip icon={Truck} value={stats.suppliersCount} label="Fourn." onClick={() => nav('tiers')} />
          </div>
        </div>

        {/* RIGHT column */}
        <div className="col-span-12 xl:col-span-4 flex flex-col gap-5 h-full">
          <div className="space-y-3">
            <DesktopFinanceRow tone="blue" icon={CreditCard} label="Créances clients" value={formatFCFA(stats.receivables)} sub={`${stats.customersCount} clients`} onClick={() => nav('tiers', { target: 'receivables' })} />
            <DesktopFinanceRow tone="amber" icon={Truck} label="Dettes fournisseurs" value={formatFCFA(stats.payables)} sub={`${stats.suppliersCount} fournisseurs`} onClick={() => nav('supplier_orders', { target: 'payables' })} />
            <DesktopFinanceRow tone={stats.outOfStockCount > 0 ? 'rose' : 'slate'} icon={AlertTriangle} label="Ruptures de stock" value={String(stats.outOfStockCount)} sub={stats.lowStockCount > 0 ? `${stats.lowStockCount} stocks bas` : 'stocks à jour'} onClick={() => nav('stock', { target: 'outOfStock' })} />
            <DesktopFinanceRow tone="emerald" icon={Package} label="Entrées stock" value={String(stats.stockInToday)} sub="aujourd'hui" onClick={() => nav('stock', { target: 'stockIn' })} />
          </div>
          <IntelligentAlerts stats={stats} nav={nav} />
          <div className="flex-1 flex flex-col min-h-[140px]">
            <CashActivityCard stats={stats} marginPct={marginPct} nav={nav} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 *  REUSABLE SUB-COMPONENTS
 * ════════════════════════════════════════════════════════════════════════════ */

function HeroMetric({ label, value, icon: Icon, positive, negative }: any) {
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-1 mb-0.5">
        <Icon className={`w-2.5 h-2.5 shrink-0 ${positive ? 'text-emerald-300' : negative ? 'text-rose-300' : 'text-white/50'}`} />
        <span className="text-[8px] font-semibold text-white/40 uppercase tracking-wider truncate">{label}</span>
      </div>
      <div className="text-[11px] font-bold text-white/90 num leading-tight truncate">{value}</div>
    </div>
  );
}

function InnerBankMetric({ label, value, icon: Icon, positive, negative }: any) {
  return (
    <div className="rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 p-2.5 min-w-0 overflow-hidden">
      <div className="flex items-center gap-1">
        <Icon className={`w-2.5 h-2.5 shrink-0 ${positive ? 'text-emerald-300' : negative ? 'text-rose-300' : 'text-white/60'}`} />
        <span className="text-[9px] font-bold text-white/60 uppercase tracking-wider leading-tight break-words">{label}</span>
      </div>
      <div className="text-xl font-black text-white num mt-1 leading-tight break-all">{value}</div>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, tone, onClick, pulse }: any) {
  const tones: Record<string, any> = {
    blue:    { iconBg: 'bg-blue-50', iconColor: 'text-blue-600', border: 'border-blue-100/60' },
    amber:   { iconBg: 'bg-amber-50', iconColor: 'text-amber-600', border: 'border-amber-100/60' },
    rose:    { iconBg: 'bg-rose-50', iconColor: 'text-rose-600', border: 'border-rose-100/60' },
    emerald: { iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600', border: 'border-emerald-100/60' },
    teal:    { iconBg: 'bg-teal-50', iconColor: 'text-teal-600', border: 'border-teal-100/60' },
    slate:   { iconBg: 'bg-slate-100', iconColor: 'text-slate-500', border: 'border-slate-200/60' },
  };
  const t = tones[tone] || tones.slate;
  return (
    <button
      onClick={onClick}
      className={`relative rounded-xl bg-white border ${t.border} p-1.5 text-left active:scale-[0.96] transition-all overflow-hidden`}
      style={{ boxShadow: '0 1px 3px rgba(15,23,42,0.04)' }}
    >
      <div className="flex items-center justify-between mb-0.5">
        <div className={`w-5 h-5 rounded-md ${t.iconBg} flex items-center justify-center`}>
          <Icon className={`w-2.5 h-2.5 ${t.iconColor}`} />
        </div>
        {pulse && <span className="relative flex w-1.5 h-1.5"><span className="absolute inset-0 rounded-full bg-rose-500 animate-ping" /><span className="relative rounded-full bg-rose-500 w-1.5 h-1.5" /></span>}
      </div>
      <div className="text-[7.5px] font-bold text-slate-400 uppercase tracking-wider leading-tight">{label}</div>
      <div className="num font-extrabold text-slate-900 leading-tight mt-0.5" style={{ fontSize: 'clamp(9px, 2.8vw, 12px)' }}>{value}</div>
    </button>
  );
}

function DesktopFinanceRow({ icon: Icon, label, value, sub, tone, onClick }: any) {
  const tones: Record<string, any> = {
    blue:    { iconBg: 'bg-blue-50', iconColor: 'text-blue-600' },
    amber:   { iconBg: 'bg-amber-50', iconColor: 'text-amber-600' },
    rose:    { iconBg: 'bg-rose-50', iconColor: 'text-rose-600' },
    emerald: { iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600' },
    slate:   { iconBg: 'bg-slate-100', iconColor: 'text-slate-500' },
  };
  const t = tones[tone] || tones.slate;
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-4 rounded-2xl bg-white border border-slate-200/70 hover:border-slate-300 hover:shadow-md transition-all text-left group"
    >
      <div className={`w-11 h-11 rounded-2xl ${t.iconBg} flex items-center justify-center shrink-0`}>
        <Icon className={`w-5 h-5 ${t.iconColor}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{label}</div>
        <div className="text-xl font-extrabold text-slate-900 num leading-tight mt-0.5 break-all">{value}</div>
        <div className="text-[11px] text-slate-500 font-medium">{sub}</div>
      </div>
      <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
    </button>
  );
}

function Section({ icon: Icon, iconGradient, title, subtitle, action, children, desktop }: any) {
  return (
    <div
      className="relative rounded-2xl overflow-hidden bg-white"
      style={{
        boxShadow: '0 1px 4px rgba(15,23,42,0.04)',
        border: '1px solid rgba(226,232,240,0.6)',
      }}
    >
      <div className={`flex items-center justify-between ${desktop ? 'px-5 py-4' : 'px-3 py-2'} border-b border-slate-100/60`}>
        <div className="flex items-center gap-2">
          <div className={`${desktop ? 'w-9 h-9 rounded-2xl' : 'w-6 h-6 rounded-lg'} bg-gradient-to-br ${iconGradient} flex items-center justify-center`}>
            <Icon className={`${desktop ? 'w-4 h-4' : 'w-3 h-3'} text-white`} />
          </div>
          <div>
            <div className={`${desktop ? 'text-sm' : 'text-[11px]'} font-bold text-slate-800 leading-tight`}>{title}</div>
            {subtitle && <div className={`${desktop ? 'text-xs' : 'text-[9px]'} text-slate-400 font-medium`}>{subtitle}</div>}
          </div>
        </div>
        {action && (
          action.dark ? (
            <button onClick={action.onClick} className="inline-flex items-center gap-1 h-8 px-3 rounded-xl bg-slate-900 text-white text-[11px] font-bold hover:bg-slate-800">
              {action.label} <ChevronRight className="w-3 h-3" />
            </button>
          ) : (
            <button onClick={action.onClick} className="text-[9px] font-bold text-brand-700 flex items-center gap-0.5">
              {action.label} <ChevronRight className="w-2.5 h-2.5" />
            </button>
          )
        )}
      </div>
      {children}
    </div>
  );
}

function FunnelCell({ count, label, tone, onClick, pulse, large }: any) {
  const tones: Record<string, any> = {
    rose: { text: count > 0 ? 'text-rose-600' : 'text-slate-300', label: 'text-rose-700', hover: 'hover:bg-rose-50/40', dot: 'bg-rose-500' },
    amber: { text: count > 0 ? 'text-amber-600' : 'text-slate-300', label: 'text-amber-700', hover: 'hover:bg-amber-50/40', dot: 'bg-amber-500' },
    emerald: { text: count > 0 ? 'text-emerald-600' : 'text-slate-300', label: 'text-emerald-700', hover: 'hover:bg-emerald-50/40', dot: 'bg-emerald-500' },
  };
  const t = tones[tone];
  return (
    <button onClick={onClick} className={`relative flex flex-col items-center justify-center gap-0.5 ${large ? 'py-5' : 'py-2.5'} transition-colors ${t.hover} active:scale-95`}>
      {pulse && count > 0 && (
        <span className="absolute top-1.5 right-1/3 flex w-1.5 h-1.5">
          <span className={`absolute inset-0 rounded-full ${t.dot} animate-ping opacity-75`} />
          <span className={`relative rounded-full ${t.dot} w-1.5 h-1.5`} />
        </span>
      )}
      <span className={`${large ? 'text-3xl' : 'text-lg'} font-black num leading-none ${t.text}`}>{count}</span>
      <span className={`text-[9px] font-bold uppercase tracking-wider ${t.label}`}>{label}</span>
    </button>
  );
}

function IntelligentAlerts({ stats, nav }: any) {
  const alerts: { icon: any; title: string; detail: string; tone: string; route: string; ctx?: NavContext }[] = [
    ...(stats.outOfStockCount > 0 ? [{ icon: AlertTriangle, title: `${stats.outOfStockCount} rupture${stats.outOfStockCount > 1 ? 's' : ''} de stock`, detail: 'À commander en priorité', tone: 'rose', route: 'stock', ctx: { target: 'outOfStock' as const } }] : []),
    ...(stats.webNew > 0 ? [{ icon: Globe, title: `${stats.webNew} commande${stats.webNew > 1 ? 's' : ''} web`, detail: 'En attente de traitement', tone: 'teal', route: 'online_orders', ctx: { target: 'webNew' as const } }] : []),
    ...(stats.lowStockCount > 0 ? [{ icon: Package, title: `${stats.lowStockCount} stock${stats.lowStockCount > 1 ? 's' : ''} bas`, detail: 'Seuil minimum atteint', tone: 'amber', route: 'stock', ctx: { target: 'lowStock' as const } }] : []),
    ...(stats.pendingQuotes > 0 ? [{ icon: FileText, title: `${stats.pendingQuotes} devis`, detail: 'En attente de validation', tone: 'blue', route: 'billing', ctx: { target: 'quotes' as const } }] : []),
    ...(stats.pendingReturns > 0 ? [{ icon: RotateCcw, title: `${stats.pendingReturns} retour${stats.pendingReturns > 1 ? 's' : ''}`, detail: 'À valider', tone: 'amber', route: 'billing', ctx: { target: 'returns' as const } }] : []),
  ];

  if (alerts.length === 0) return null;

  const toneMap: Record<string, any> = {
    rose: { bg: 'bg-rose-50', border: 'border-rose-100', iconBg: 'bg-rose-500', text: 'text-rose-900' },
    amber: { bg: 'bg-amber-50', border: 'border-amber-100', iconBg: 'bg-amber-500', text: 'text-amber-900' },
    blue: { bg: 'bg-blue-50', border: 'border-blue-100', iconBg: 'bg-blue-500', text: 'text-blue-900' },
    teal: { bg: 'bg-teal-50', border: 'border-teal-100', iconBg: 'bg-teal-500', text: 'text-teal-900' },
  };

  return (
    <div className="space-y-1">
      {alerts.slice(0, 3).map((a, i) => {
        const Icon = a.icon;
        const t = toneMap[a.tone];
        return (
          <button
            key={i}
            onClick={() => nav(a.route, a.ctx)}
            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl ${t.bg} ${t.border} border active:scale-[0.98] transition-all text-left`}
          >
            <div className={`w-6 h-6 rounded-lg ${t.iconBg} flex items-center justify-center shrink-0`}>
              <Icon className="w-3 h-3 text-white" strokeWidth={2.5} />
            </div>
            <div className="flex-1 min-w-0">
              <div className={`text-[10px] font-bold ${t.text} truncate`}>{a.title}</div>
              <div className="text-[8px] text-slate-500 font-medium">{a.detail}</div>
            </div>
            <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />
          </button>
        );
      })}
    </div>
  );
}

function BusinessPulse({ stats, balanceHidden, nav }: any) {
  const avgTicket = stats.todayCount > 0 ? Math.round(stats.todaySales / stats.todayCount) : 0;
  const topSale = stats.recentSales.length > 0 ? stats.recentSales[0] : null;

  return (
    <div
      className="rounded-2xl overflow-hidden bg-white"
      style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.04)', border: '1px solid rgba(226,232,240,0.6)' }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100/60">
        <div className="flex items-center gap-1.5">
          <Activity className="w-3 h-3 text-slate-500" />
          <span className="text-[10px] font-bold text-slate-700">Santé business</span>
        </div>
        <button onClick={() => nav('sales')} className="text-[9px] font-bold text-brand-700 flex items-center gap-0.5">
          Journal <ChevronRight className="w-2.5 h-2.5" />
        </button>
      </div>
      <div className="grid grid-cols-2 divide-x divide-slate-100/60">
        <div className="px-3 py-2">
          <div className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">Ticket moyen</div>
          <div className="text-[13px] font-extrabold text-slate-900 num leading-tight mt-0.5">
            {balanceHidden ? '•••' : formatFCFA(avgTicket)}
          </div>
        </div>
        <div className="px-3 py-2">
          <div className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">Dernière vente</div>
          <div className="text-[13px] font-extrabold text-slate-900 num leading-tight mt-0.5 truncate">
            {topSale ? (balanceHidden ? '•••' : formatFCFA(topSale.total)) : '-'}
          </div>
        </div>
      </div>
      {topSale && (
        <button
          onClick={() => nav('sales')}
          className="w-full flex items-center gap-2 px-3 py-1.5 border-t border-slate-100/60 active:bg-slate-50/50 text-left"
        >
          <div className="w-5 h-5 rounded-md bg-emerald-50 flex items-center justify-center shrink-0">
            <CheckCircle className="w-2.5 h-2.5 text-emerald-600" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold text-slate-700 truncate">
              {topSale.customers?.name || 'Client comptoir'}
            </div>
          </div>
          <div className="text-[9px] text-slate-400 font-medium shrink-0">
            {getTimeAgo(topSale.created_at)}
          </div>
        </button>
      )}
    </div>
  );
}


function FooterChip({ icon: Icon, value, label, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-xl bg-white border border-slate-200/60 px-2 py-1.5 active:scale-[0.97] transition-all"
      style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.03)' }}
    >
      <Icon className="w-3 h-3 text-slate-400 shrink-0" />
      <div className="flex-1 text-left min-w-0">
        <div className="text-[12px] font-extrabold text-slate-900 num leading-none">{value}</div>
        <div className="text-[8px] text-slate-400 font-semibold mt-0.5 truncate">{label}</div>
      </div>
    </button>
  );
}

function CashActivityCard({ stats, marginPct, nav }: { stats: Stats; marginPct: number; nav: (r: string) => void }) {
  const netCash = stats.sessionCashIn - stats.sessionExpenses;
  const avgTicket = stats.todayCount > 0 ? Math.round(stats.todaySales / stats.todayCount) : 0;

  return (
    <div
      className="relative rounded-[20px] overflow-hidden bg-white flex-1 flex flex-col"
      style={{
        boxShadow: '0 2px 12px -4px rgba(15,23,42,0.07), 0 1px 2px rgba(15,23,42,0.03)',
        border: '1px solid rgba(226,232,240,0.7)',
      }}
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-teal-600 to-teal-800 flex items-center justify-center">
            <Wallet className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-900">Activité caisse</div>
            <div className="text-xs text-slate-500 font-medium">
              {stats.sessionInfo
                ? `Session du ${new Date(stats.sessionInfo.openedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} à ${new Date(stats.sessionInfo.openedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
                : 'Aucune session ouverte'}
            </div>
          </div>
        </div>
        <button onClick={() => nav('cash_history')} className="text-xs font-bold text-brand-700 hover:text-brand-800 flex items-center gap-1">
          Historique <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-2 divide-x divide-slate-100">
        <div className="px-4 py-3">
          <div className="flex items-center gap-1.5">
            <ArrowUpRight className="w-3 h-3 text-emerald-600" />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Entrées</span>
          </div>
          <div className="text-[15px] font-extrabold text-slate-900 num leading-tight mt-1">{formatFCFA(stats.sessionCashIn)}</div>
        </div>
        <div className="px-4 py-3">
          <div className="flex items-center gap-1.5">
            <ArrowDownRight className="w-3 h-3 text-rose-600" />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Dépenses</span>
          </div>
          <div className="text-[15px] font-extrabold text-slate-900 num leading-tight mt-1">{formatFCFA(stats.sessionExpenses)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 divide-x divide-slate-100 border-t border-slate-100">
        <div className="px-4 py-3">
          <div className="flex items-center gap-1.5">
            <Activity className="w-3 h-3 text-slate-500" />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Flux net</span>
          </div>
          <div className={`text-[15px] font-extrabold num leading-tight mt-1 ${netCash >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
            {netCash >= 0 ? '+' : ''}{formatFCFA(netCash)}
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="flex items-center gap-1.5">
            <Receipt className="w-3 h-3 text-slate-500" />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Ticket moyen</span>
          </div>
          <div className="text-[15px] font-extrabold text-slate-900 num leading-tight mt-1">{formatFCFA(avgTicket)}</div>
        </div>
      </div>

      <div className="px-4 py-3 bg-gradient-to-r from-slate-50/80 to-transparent border-t border-slate-100 flex items-center justify-between flex-1">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-xl bg-emerald-50 flex items-center justify-center">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Marge du mois</div>
            <div className="text-[13px] font-extrabold text-slate-900 num leading-tight">{marginPct}%</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Ventes</div>
          <div className="text-[13px] font-extrabold text-slate-900 num leading-tight">{stats.todayCount}</div>
        </div>
      </div>
    </div>
  );
}

function getTimeAgo(dateStr: string): string {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
