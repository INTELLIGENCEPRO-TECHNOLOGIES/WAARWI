import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import {
  ShoppingBag, Loader2, Search, RefreshCw, ClipboardList,
  CheckCircle, Truck, X, Calendar,
  User, MessageCircle, Link2,
  Printer, Pencil, Ban, ChevronLeft, ChevronRight, AlertTriangle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { usePermissions } from '../lib/permissions';
import { useToast } from '../context/ToastContext';
import { Modal, ConfirmDialog } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { isAutoParts } from '../lib/types';
import { formatFCFA, formatDate } from '../lib/format';
import { printDocumentA4, buildPrintTenantForSite, type PrintTenant } from '../lib/print';
import { consumeNavContext } from '../lib/navHighlight';
import { MobileBillingWizard } from '../components/MobileBillingWizard';
import { DesktopWindow } from '../components/DesktopWindow';
import { useWindowManager } from '../context/WindowManagerContext';
import { SupplierOrderInstance, type SupplierOrderWindowDescriptor } from '../components/supplier/SupplierOrderInstance';
import type { SOLineItem, SOHeaderForm, ReceiveQtyMap, ReceiveLotMap, SOMode } from '../components/SupplierOrderEditor';
import { loadLayout, saveLayout, clearFormDraft, type LayoutWindow } from '../lib/draftRecovery';
import { RotateCcw } from 'lucide-react';
import { DispatchStep, type DispatchLineItem } from '../components/supplier/DispatchStep';
import { buildStockLevelMap, type StockLevelMap } from '../lib/autoDistribute';

type SupplierOrder = {
  id: string; order_number: string; total: number; status: string;
  created_at: string; expected_date: string | null;
  public_token?: string | null;
  public_code?: string | null;
  supplier_id?: string | null;
  note?: string | null;
  user_id?: string | null;
  suppliers: { name: string; phone?: string | null; whatsapp?: string | null; email?: string | null; address?: string | null } | null;
  doc_header?: any;
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon', sent: 'Envoyée', confirmed: 'Confirmée',
  partial: 'Partielle', received: 'Reçue', cancelled: 'Annulée',
};

const STATUS_COLORS: Record<string, string> = {
  draft: 'text-slate-500', sent: 'text-neutral-700', confirmed: 'text-brand-600',
  partial: 'text-amber-600', received: 'text-emerald-600', cancelled: 'text-red-600',
};

const FILTERS: { key: string; label: string }[] = [
  { key: '',          label: 'Toutes' },
  { key: 'draft',     label: 'Brouillon' },
  { key: 'sent',      label: 'Envoyée' },
  { key: 'confirmed', label: 'Confirmée' },
  { key: 'partial',   label: 'Partielle' },
  { key: 'received',  label: 'Reçue' },
  { key: 'cancelled', label: 'Annulée' },
];

const SUPPLIER_ORDERS_PAGE_ID = 'supplier-orders-page';
const SUPPLIER_ORDERS_GROUP = 'supplier-orders';

export function SupplierOrders({ visible = true, onNavigate }: { visible?: boolean; onNavigate?: (r: string) => void } = {}) {
  const { tenant, currentSite, sites, depots, dataTick, profile, user } = useApp();
  const { can } = usePermissions();
  const autoMode = isAutoParts(tenant);
  const { success, error } = useToast();
  const sharedSuppliers = (tenant as any)?.settings?.shared_suppliers !== false;
  const stockMethod = (tenant as any)?.settings?.stock_method || 'none';
  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024;

  // ── Window manager (desktop) ────────────────────────────────────
  const {
    windows: wmWindows,
    tileVisibleWindows,
    focus: focusWindow,
    minimize: minimizeWindow,
    minimizeGroup,
    restore: restoreWindow,
  } = useWindowManager();
  const [windowsMap, setWindowsMap] = useState<Map<string, SupplierOrderWindowDescriptor>>(new Map());
  const windowCounter = useRef(0);
  const [pageWindowOpen, setPageWindowOpen] = useState(true);
  const prevRouteRef = useRef<string | null>(null);
  const prevVisible = useRef(visible);

  // ── Draft recovery scope + pending offer ─────────────────
  const userId = profile?.id || user?.id || '';
  const scope = useMemo(
    () => ({ userId, tenantId: tenant?.id || '', siteId: currentSite?.id || '' }),
    [userId, tenant?.id, currentSite?.id],
  );
  const [pendingRecovery, setPendingRecovery] = useState<LayoutWindow[] | null>(null);
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const recoveryOfferedRef = useRef<string>('');

  // ── List state ──────────────────────────────────────────────────
  const PAGE_SIZE = 50;
  const [list, setList] = useState<SupplierOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);
  const [page, setPage] = useState(1);
  const [filteredCount, setFilteredCount] = useState(0);
  const [allCount, setAllCount] = useState(0);
  const [serverStatusCounts, setServerStatusCounts] = useState<Record<string, number>>({});
  const [serverPending, setServerPending] = useState<{ pending_count: number; pending_total: number }>({ pending_count: 0, pending_total: 0 });
  const [statusFilter, setStatusFilter] = useState('');
  const [toCancel, setToCancel] = useState<SupplierOrder | null>(null);
  const [flashList, setFlashList] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Data sources ────────────────────────────────────────────────
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [articles, setArticles] = useState<any[]>([]);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});

  // ── Editor state ────────────────────────────────────────────────
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'view' | 'edit' | 'receive'>('create');
  const [editorOrderId, setEditorOrderId] = useState<string | null>(null);
  const [editorOrder, setEditorOrder] = useState<SupplierOrder | null>(null);
  const [headerForm, setHeaderForm] = useState<SOHeaderForm>({ supplier_id: '', expected_date: '', note: '' });
  const [editorItems, setEditorItems] = useState<SOLineItem[]>([]);
  const [saving, setSaving] = useState(false);

  // ── Receive state ───────────────────────────────────────────────
  const [receiveQty, setReceiveQty] = useState<ReceiveQtyMap>({});
  const [receiveLotData, setReceiveLotData] = useState<ReceiveLotMap>({});

  // ── Dispatch state (multi-site) ────────────────────────────────
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchData, setDispatchData] = useState<Record<string, Record<string, number>>>({});
  const receiveIdemRef = useRef<string>('');
  const [dispatchStockLevels, setDispatchStockLevels] = useState<StockLevelMap | null>(null);
  const [dispatchStockLoading, setDispatchStockLoading] = useState(false);

  // ── Mobile create state ─────────────────────────────────────────
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileForm, setMobileForm] = useState<{ supplier_id: string; expected_date: string; note: string }>({ supplier_id: '', expected_date: '', note: '' });
  const [mobileItems, setMobileItems] = useState<any[]>([{ article_id: '', name: '', supplier_ref: '', quantity_ordered: 1, unit_price: 0, total: 0 }]);



  // ── Page window lifecycle: minimize group on leave, restore on return ──
  useEffect(() => {
    if (!isDesktop) { prevVisible.current = visible; return; }
    if (prevVisible.current && !visible) minimizeGroup(SUPPLIER_ORDERS_GROUP);
    if (!prevVisible.current && visible) {
      if (!pageWindowOpen) setPageWindowOpen(true);
      else restoreWindow(SUPPLIER_ORDERS_PAGE_ID);
    }
    prevVisible.current = visible;
  }, [visible, isDesktop]);

  useEffect(() => { if (!visible) prevRouteRef.current = null; }, [visible]);

  const closeAchatsPage = useCallback(() => {
    setPageWindowOpen(false);
    onNavigate?.(prevRouteRef.current && prevRouteRef.current !== 'supplier_orders' ? prevRouteRef.current : 'dashboard');
  }, [onNavigate]);

  // Clear windows on tenant change.
  const prevTenantId = useRef(tenant?.id);
  useEffect(() => {
    if (prevTenantId.current && tenant?.id !== prevTenantId.current) setWindowsMap(new Map());
    prevTenantId.current = tenant?.id;
  }, [tenant?.id]);

  // Auto-minimize off-site windows on active-site change.
  const prevSiteId = useRef(currentSite?.id);
  useEffect(() => {
    if (!currentSite?.id || currentSite.id === prevSiteId.current) { prevSiteId.current = currentSite?.id; return; }
    prevSiteId.current = currentSite.id;
    if (!isDesktop) return;
    for (const w of wmWindows) {
      if (w.siteId && w.siteId !== currentSite.id && !w.minimized) minimizeWindow(w.id);
    }
  }, [currentSite?.id, isDesktop]);

  // ── Recovery offer: load layout once scope is fully known ───────
  useEffect(() => {
    if (!isDesktop) return;
    if (!scope.userId || !scope.tenantId || !scope.siteId) return;
    const key = `${scope.userId}|${scope.tenantId}|${scope.siteId}`;
    if (recoveryOfferedRef.current === key) return;
    recoveryOfferedRef.current = key;
    const layout = loadLayout('supplier-orders', scope);
    const matching = layout ? layout.windows.filter(w => w.kind === 'supplier_order') : [];
    if (matching.length > 0) {
      setPendingRecovery(matching);
    } else {
      setRecoveryChecked(true);
    }
  }, [isDesktop, scope.userId, scope.tenantId, scope.siteId]);

  const acceptRecovery = useCallback(() => {
    if (!pendingRecovery) return;
    setWindowsMap(prev => {
      const m = new Map(prev);
      for (const w of pendingRecovery) {
        const desc = w.descriptor as SupplierOrderWindowDescriptor;
        if (!desc || m.has(w.windowId)) continue;
        // Only rehydrate windows that belong to this active site.
        if (desc.siteId && desc.siteId !== scope.siteId) continue;
        m.set(w.windowId, desc);
      }
      return m;
    });
    setPendingRecovery(null);
    setRecoveryChecked(true);
  }, [pendingRecovery, scope.siteId]);

  const dismissRecovery = useCallback(() => {
    if (pendingRecovery) {
      for (const w of pendingRecovery) clearFormDraft(scope, w.windowId);
    }
    setPendingRecovery(null);
    setRecoveryChecked(true);
    // Clear stored layout for this scope so we don't offer it again.
    saveLayout('supplier-orders', { scope, pageWindowOpen: true, windows: [] });
  }, [pendingRecovery, scope]);

  // ── Persist layout on every windows / wm-rect change ──────────
  useEffect(() => {
    if (!isDesktop) return;
    if (!recoveryChecked) return;
    if (!scope.userId || !scope.tenantId || !scope.siteId) return;
    const windowsList: LayoutWindow[] = Array.from(windowsMap.values()).map(desc => {
      const wm = wmWindows.find(w => w.id === desc.windowId);
      return {
        windowId: desc.windowId,
        kind: 'supplier_order',
        descriptor: desc,
        rect: wm?.rect,
        minimized: wm?.minimized,
      };
    });
    saveLayout('supplier-orders', { scope, pageWindowOpen, windows: windowsList });
  }, [isDesktop, recoveryChecked, scope, pageWindowOpen, windowsMap, wmWindows]);

  // ── Desktop window helpers ─────────────────────────────────────
  const pushWindow = (orderId: string | null, mode: SOMode) => {
    if (!tenant || !currentSite) return;
    if (orderId) {
      const existing = Array.from(windowsMap.values()).find(w => w.orderId === orderId);
      if (existing) { restoreWindow(existing.windowId); focusWindow(existing.windowId); return; }
    }
    windowCounter.current += 1;
    const id = `supplier-order-${Date.now()}-${windowCounter.current}`;
    const desc: SupplierOrderWindowDescriptor = {
      windowId: id, orderId, mode,
      siteId: currentSite.id, tenantId: tenant.id,
    };
    setWindowsMap(prev => { const m = new Map(prev); m.set(id, desc); return m; });
    if (windowsMap.size >= 1) setTimeout(() => tileVisibleWindows(), 50);
  };

  const closeWindow = (id: string) => {
    // User-initiated close: drop the form draft for this window.
    if (scope.userId) clearFormDraft(scope, id);
    setWindowsMap(prev => { const m = new Map(prev); m.delete(id); return m; });
  };

  const handleOrderCreated = (id: string, o: { id: string; order_number: string }) => {
    setWindowsMap(prev => {
      const m = new Map(prev);
      const cur = m.get(id);
      if (cur) m.set(id, { ...cur, orderId: o.id, mode: 'view' });
      return m;
    });
  };

  const handleModeChange = (id: string, mode: SOMode) => {
    setWindowsMap(prev => {
      const m = new Map(prev);
      const cur = m.get(id);
      if (cur) m.set(id, { ...cur, mode });
      return m;
    });
  };

  // ── Debounce search ────────────────────────────────────────────
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search]);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [debouncedSearch, statusFilter, tenant?.id, currentSite?.id]);

  // ── Load data ──────────────────────────────────────────────────

  const load = useCallback(async (silent = false) => {
    if (!tenant || !currentSite) return;
    if (!silent) setLoading(true); else setRefreshing(true);
    setLoadError(null);
    const myReqId = ++reqIdRef.current;

    const params: Record<string, unknown> = {
      p_tenant_id: tenant.id,
      p_site_id: currentSite.id,
      p_page: page,
      p_page_size: PAGE_SIZE,
    };
    if (debouncedSearch) params.p_search = debouncedSearch;
    if (statusFilter) params.p_status_filter = statusFilter;

    const { data, error: rpcErr } = await supabase.rpc('rpc_paginated_supplier_orders', params);
    if (myReqId !== reqIdRef.current) return;

    if (rpcErr || !data) {
      setLoadError(rpcErr?.message || 'Impossible de charger les commandes');
      setList([]); setFilteredCount(0); setAllCount(0);
      setServerStatusCounts({}); setServerPending({ pending_count: 0, pending_total: 0 });
      setLoading(false); setRefreshing(false);
      return;
    }

    const rows = ((data.rows || []) as any[]).map((r: any) => ({
      ...r,
      suppliers: r.supplier_name ? {
        name: r.supplier_name, phone: r.supplier_phone,
        whatsapp: r.supplier_whatsapp, email: r.supplier_email, address: r.supplier_address,
      } : null,
    })) as SupplierOrder[];
    setList(rows);
    setFilteredCount(data.filtered_count || 0);
    setAllCount(data.all_count || 0);
    setServerStatusCounts(data.status_counts || {});
    setServerPending(data.pending || { pending_count: 0, pending_total: 0 });
    setLoadError(null);
    setLoading(false); setRefreshing(false);
  }, [tenant?.id, currentSite?.id, page, debouncedSearch, statusFilter]);

  useEffect(() => {
    if (!tenant) return;
    supabase.from('profiles').select('id, full_name, email').eq('tenant_id', tenant.id).then(({ data }) => {
      const m: Record<string, string> = {};
      (data || []).forEach((p: any) => { m[p.id] = p.full_name || p.email || ''; });
      setProfileNames(m);
    });
  }, [tenant?.id]);

  const creatorName = (userId?: string | null) => (userId && profileNames[userId]) || 'Utilisateur non renseigné';

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (dataTick > 0) { const t = setTimeout(() => load(true), 400); return () => clearTimeout(t); } }, [dataTick, load]);

  useEffect(() => {
    const ctx = consumeNavContext();
    if (!ctx) return;
    if (ctx.highlightId) {
      setHighlightId(ctx.highlightId);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = setTimeout(() => setHighlightId(null), 6800);
    }
    if (ctx.target === 'payables') {
      setStatusFilter('');
      setFlashList(true);
      setTimeout(() => setFlashList(false), 6800);
    }
    if (ctx.target === 'newOrder') {
      openCreate();
    }
  }, []);

  useEffect(() => {
    if (!highlightId || loading) return;
    let raf: number;
    let tries = 0;
    const tryScroll = () => {
      const el = document.querySelector(`[data-row-id="${highlightId}"]`);
      if (el) {
        el.classList.remove('waarwi-flash');
        void el.offsetWidth;
        el.classList.add('waarwi-flash');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (++tries < 20) raf = requestAnimationFrame(tryScroll);
    };
    raf = requestAnimationFrame(tryScroll);
    return () => cancelAnimationFrame(raf);
  }, [highlightId, list, loading]);

  const loadRefData = async () => {
    if (!tenant) return;
    const isShared = (tenant as any)?.settings?.shared_articles !== false;
    const isSharedSup = (tenant as any)?.settings?.shared_suppliers !== false;

    const all: any[] = [];
    const pageSize = 1000;
    let from = 0;
    while (true) {
      let q = supabase
        .from('articles')
        .select('id, name, purchase_price, sale_price, supplier_ref, internal_ref, category_id')
        .eq('tenant_id', tenant.id)
        .eq('is_active', true)
        .order('name')
        .range(from, from + pageSize - 1);
      if (!isShared && currentSite) q = q.eq('site_id', currentSite.id);
      const { data, error: articleError } = await q;
      if (articleError) {
        console.error('[SupplierOrders] Impossible de charger les articles', articleError);
        break;
      }
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
    }

    // Load stock quantities from stock_levels
    const stockMap: Record<string, number> = {};
    if (all.length > 0) {
      let slq = supabase
        .from('stock_levels')
        .select('article_id, quantity')
        .eq('tenant_id', tenant.id);
      if (currentSite) slq = slq.eq('site_id', currentSite.id);
      const { data: slData, error: slError } = await slq;
      if (slError) {
        console.error('[SupplierOrders] Impossible de charger le stock', slError);
      } else if (slData) {
        for (const sl of slData) {
          stockMap[sl.article_id] = Number(sl.quantity || 0);
        }
      }
    }

    setArticles(all.map(a => ({ ...a, stock_quantity: stockMap[a.id] ?? null })));

    let sq = supabase.from('suppliers').select('id, name, phone, balance, credit_limit, credit_blocked').eq('tenant_id', tenant.id).eq('is_active', true).order('name');
    if (!isSharedSup && currentSite) sq = sq.or(`site_id.eq.${currentSite.id},site_id.is.null`);
    const { data: supData, error: supError } = await sq;
    if (supError) console.error('[SupplierOrders] Impossible de charger les fournisseurs', supError);
    setSuppliers(supData || []);
  };

  useEffect(() => { loadRefData(); }, [tenant?.id, currentSite?.id]);

  // ── Server-side filtering — list is already filtered ────────────
  const filtered = list;
  const counts = useMemo(() => {
    const c: Record<string, number> = { '': allCount };
    for (const [k, v] of Object.entries(serverStatusCounts)) c[k] = Number(v) || 0;
    return c;
  }, [allCount, serverStatusCounts]);
  const totalPending = serverPending.pending_total;
  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));

  // ── Editor helpers ──────────────────────────────────────────────

  const editorSubtotal = editorItems.filter(i => i.name.trim()).reduce((s, i) => s + Number(i.total || 0), 0);

  const openCreate = () => {
    if (articles.length === 0) loadRefData();
    if (isDesktop) {
      pushWindow(null, 'create');
      return;
    }
    {
      setMobileForm({ supplier_id: '', expected_date: '', note: '' });
      setMobileItems([{ article_id: '', name: '', supplier_ref: '', quantity_ordered: 1, unit_price: 0, total: 0 }]);
      setMobileOpen(true);
    }
  };

  const loadOrderItems = async (orderId: string) => {
    const { data } = await supabase.from('supplier_order_items')
      .select('*, articles(internal_ref, oem_ref)')
      .eq('order_id', orderId);
    return (data || []).map((i: any) => ({
      id: i.id,
      article_id: i.article_id || null,
      name: i.name,
      supplier_ref: i.supplier_ref || '',
      quantity_ordered: Number(i.quantity_ordered),
      unit_price: Number(i.unit_price),
      total: Number(i.total),
      quantity_received: Number(i.quantity_received || 0),
    })) as SOLineItem[];
  };

  const openOrderView = async (o: SupplierOrder) => {
    if (isDesktop) { pushWindow(o.id, 'view'); return; }
    const items = await loadOrderItems(o.id);
    setEditorOrderId(o.id);
    setEditorOrder(o);
    setHeaderForm({ supplier_id: o.supplier_id || '', expected_date: o.expected_date || '', note: o.note || '' });
    setEditorItems(items);
    setEditorMode('view');
    setEditorOpen(true);
  };

  const openOrderEdit = async (o: SupplierOrder) => {
    if (isDesktop) { pushWindow(o.id, 'edit'); return; }
    const items = await loadOrderItems(o.id);
    setEditorOrderId(o.id);
    setEditorOrder(o);
    setHeaderForm({ supplier_id: o.supplier_id || '', expected_date: o.expected_date || '', note: o.note || '' });
    setEditorItems(items);
    setEditorMode('edit');
    setEditorOpen(true);
  };

  const openOrderReceive = async (o: SupplierOrder) => {
    if (isDesktop) { pushWindow(o.id, 'receive'); return; }
    const items = await loadOrderItems(o.id);
    setEditorOrderId(o.id);
    setEditorOrder(o);
    setHeaderForm({ supplier_id: o.supplier_id || '', expected_date: o.expected_date || '', note: o.note || '' });
    setEditorItems(items);
    const rq: ReceiveQtyMap = {};
    items.forEach(it => {
      const remaining = Math.max(0, (it.quantity_ordered || 0) - (it.quantity_received || 0));
      rq[it.id || `idx-${items.indexOf(it)}`] = remaining;
    });
    setReceiveQty(rq);
    setReceiveLotData({});
    receiveIdemRef.current = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID() : `recv-${o.id}-${Date.now()}`;
    setEditorMode('receive');
    setEditorOpen(true);
  };

  // Destinations autorisées pour la réception : magasin de la commande,
  // ses dépôts rattachés, et les autres magasins si le partage fournisseurs est actif.
  const receiveDestinations = useMemo(() => {
    const orderSiteId = (editorOrder as any)?.site_id || currentSite?.id || '';
    if (!orderSiteId) return [] as { id: string; name: string }[];
    const out: { id: string; name: string }[] = [];
    const store = sites.find(s => s.id === orderSiteId)
      || (currentSite && currentSite.id === orderSiteId ? currentSite : null);
    out.push({ id: orderSiteId, name: store?.name || 'Magasin principal' });
    depots
      .filter(d => d.parent_site_id === orderSiteId)
      .forEach(d => out.push({ id: d.id, name: d.name }));
    if (sharedSuppliers) {
      sites
        .filter(s => s.id !== orderSiteId)
        .forEach(s => { if (!out.some(x => x.id === s.id)) out.push({ id: s.id, name: s.name }); });
    }
    return out;
  }, [editorOrder, sites, depots, currentSite, sharedSuppliers]);

  const openDetail = async (o: SupplierOrder) => {
    if (!isDesktop) {
      await openOrderView(o);
      return;
    }
    if (['draft', 'sent', 'confirmed', 'partial'].includes(o.status)) {
      await openOrderView(o);
    } else {
      await openOrderView(o);
    }
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditorOrderId(null);
    setEditorOrder(null);
    setEditorItems([]);
    setHeaderForm({ supplier_id: '', expected_date: '', note: '' });
  };

  // ── Status change ───────────────────────────────────────────────

  const changeStatus = async (o: SupplierOrder, status: string) => {
    if (!can('edit_supplier_orders')) { error('Permission insuffisante'); return; }
    await supabase.from('supplier_orders').update({ status }).eq('id', o.id);
    success('Statut mis à jour');
    load();
    if (editorOrder?.id === o.id) {
      setEditorOrder({ ...o, status });
    }
  };

  // ── Receive logic ───────────────────────────────────────────────

  const confirmReceive = async () => {
    if (!editorOrder || !tenant || !currentSite) return;
    if (!can('manage_supplier_orders')) { error('Permission insuffisante'); return; }

    // Validation : quantité reçue vs restant à recevoir
    for (const item of editorItems) {
      const itemId = item.id || '';
      const addQty = Number(receiveQty[itemId] || 0);
      const remaining = Math.max(0, Number(item.quantity_ordered || 0) - Number(item.quantity_received || 0));
      if (addQty < 0) { error(`Quantité négative interdite pour ${item.name}`); return; }
      if (addQty > remaining) { error(`Quantité reçue supérieure au restant pour ${item.name}`); return; }
    }
    const anyQty = editorItems.some(it => Number(receiveQty[it.id || ''] || 0) > 0 && it.article_id);
    if (!anyQty) { error('Aucune quantité à réceptionner'); return; }

    const mainId = receiveDestinations[0]?.id || currentSite.id;
    // Préremplir la totalité sur le magasin principal
    const dd: Record<string, Record<string, number>> = {};
    for (const [idx, item] of editorItems.entries()) {
      const itemId = item.id || `idx-${idx}`;
      const addQty = Number(receiveQty[itemId] || 0);
      if (addQty > 0 && item.article_id) dd[itemId] = { [mainId]: addQty };
    }

    if (receiveDestinations.length > 1) {
      setDispatchData(dd);
      setDispatchOpen(true);
      loadStockForDispatch(editorItems, receiveDestinations.map(d => d.id));
    } else {
      await submitReception(dd);
    }
  };

  const isDispatchValid = () => {
    for (const [idx, item] of editorItems.entries()) {
      const itemId = item.id || `idx-${idx}`;
      const addQty = Number(receiveQty[itemId] || 0);
      if (addQty <= 0 || !item.article_id) continue;
      const values = Object.values(dispatchData[itemId] || {}).map(v => Number(v || 0));
      if (values.some(v => v < 0)) return false;
      if (values.reduce((s, v) => s + v, 0) !== addQty) return false;
    }
    return true;
  };

  const loadStockForDispatch = async (lineItems: SOLineItem[], siteIds: string[]) => {
    setDispatchStockLoading(true);
    const articleIds = [...new Set(lineItems.filter(i => i.article_id).map(i => i.article_id!))];
    const { data, error: e } = await supabase
      .from('stock_levels')
      .select('article_id, site_id, quantity')
      .in('article_id', articleIds)
      .in('site_id', siteIds);
    setDispatchStockLoading(false);
    if (e) { setDispatchStockLevels(null); return; }
    setDispatchStockLevels(buildStockLevelMap(data || [], articleIds, siteIds));
  };

  const dispatchLineItems: DispatchLineItem[] = useMemo(
    () => editorItems
      .filter((it, idx) => {
        const itemId = it.id || `idx-${idx}`;
        return (receiveQty[itemId] || 0) > 0 && it.article_id;
      })
      .map((it, idx) => ({
        itemId: it.id || `idx-${idx}`,
        articleId: it.article_id!,
        name: it.name,
        supplierRef: it.supplier_ref || undefined,
        receivedQty: Number(receiveQty[it.id || `idx-${idx}`] || 0),
      })),
    [editorItems, receiveQty],
  );

  const submitReception = async (dd: Record<string, Record<string, number>>) => {
    if (!editorOrder || !tenant) return;

    // Validation par ligne : somme répartie == quantité reçue, pas de négatif
    for (const item of editorItems) {
      const itemId = item.id || '';
      const addQty = Number(receiveQty[itemId] || 0);
      if (addQty <= 0 || !item.article_id) continue;
      const alloc = dd[itemId] || {};
      const values = Object.values(alloc).map(v => Number(v || 0));
      if (values.some(v => v < 0)) { error(`Répartition négative pour ${item.name}`); return; }
      const sum = values.reduce((s, v) => s + v, 0);
      if (sum !== addQty) { error(`Répartition incomplète pour ${item.name} (${sum}/${addQty})`); return; }
    }

    const allocations: Array<{ item_id: string; site_id: string; quantity: number; batch_number: string; expiry_date: string | null }> = [];
    for (const [idx, item] of editorItems.entries()) {
      const itemId = item.id || `idx-${idx}`;
      const addQty = Number(receiveQty[itemId] || 0);
      if (addQty <= 0 || !item.article_id || !item.id) continue;
      const lot = receiveLotData[itemId] || { batch_number: '', expiry_date: '' };
      for (const [siteId, qty] of Object.entries(dd[itemId] || {})) {
        if (Number(qty) <= 0) continue;
        allocations.push({
          item_id: item.id, site_id: siteId, quantity: Number(qty),
          batch_number: lot.batch_number || '', expiry_date: lot.expiry_date || null,
        });
      }
    }
    if (allocations.length === 0) { error('Aucune quantité à réceptionner'); return; }

    setSaving(true);
    const { data, error: e } = await supabase.rpc('receive_supplier_order', {
      p_order_id: editorOrder.id,
      p_allocations: allocations,
      p_idempotency_key: receiveIdemRef.current || `recv-${editorOrder.id}-${Date.now()}`,
    });
    setSaving(false);
    if (e) { error(e.message || 'Erreur lors de la réception'); return; }
    const status = (data as any)?.status;
    success(status === 'received' ? 'Commande entièrement réceptionnée' : 'Réception partielle enregistrée');
    setDispatchOpen(false);
    closeEditor();
    load();
  };

  // ── Print / link / WhatsApp ─────────────────────────────────────

  const tenantForPrint = (): PrintTenant => buildPrintTenantForSite(tenant, currentSite);

  const printFromEditor = () => {
    if (!editorOrder || !tenant) return;
    const sup = suppliers.find(s => s.id === headerForm.supplier_id);
    const pitems = editorItems.filter(i => i.name.trim()).map(i => ({
      name: i.name, supplier_ref: i.supplier_ref || null, oem_ref: null,
      quantity: Number(i.quantity_ordered), unit_price: Number(i.unit_price), discount: 0,
    }));
    const psubtotal = pitems.reduce((s, i) => s + i.quantity * i.unit_price, 0);
    printDocumentA4({
      tenant: tenantForPrint(), docLabel: 'BON DE COMMANDE',
      docNumber: editorOrder.order_number, docDate: formatDate(editorOrder.created_at),
      customer: sup ? { name: sup.name, phone: sup.phone, address: sup.address } : null,
      extraMeta: editorOrder.expected_date ? [{ label: 'Livraison prévue', value: formatDate(editorOrder.expected_date) }] : [],
      items: pitems, subtotal: psubtotal, total: psubtotal,
      footerNote: 'Merci de confirmer réception et délai de livraison.',
      issuedBy: creatorName(editorOrder.user_id),
      docHeader: editorOrder.doc_header ?? null,
    });
  };

  const publicOrderUrl = (o: SupplierOrder | null) => {
    const code = o?.public_code || o?.public_token;
    if (!code) return '';
    return `${window.location.origin}/po/${code}`;
  };

  const copyLinkFor = async (o: SupplierOrder) => {
    const url = publicOrderUrl(o);
    if (!url) { error('Lien indisponible'); return; }
    try { await navigator.clipboard.writeText(url); success('Lien copié'); }
    catch { window.prompt('Copiez le lien :', url); }
  };

  const sendWhatsAppFor = (o: SupplierOrder) => {
    const sup = o.suppliers;
    if (!sup) { error('Fournisseur introuvable'); return; }
    const phoneRaw = ((sup as any).whatsapp || sup.phone || '').replace(/[^0-9]/g, '');
    if (!phoneRaw) { error('Aucun numéro WhatsApp/téléphone'); return; }
    const phone = phoneRaw.startsWith('221') ? phoneRaw : phoneRaw.length === 9 ? `221${phoneRaw}` : phoneRaw;
    const link = publicOrderUrl(o);
    const msg = [
      `Bonjour ${sup.name || ''},`, '',
      `Notre commande *${o.order_number}* du ${formatDate(o.created_at)}.`,
      o.expected_date ? `Livraison souhaitée : ${formatDate(o.expected_date)}` : '',
      `*Total : ${formatFCFA(o.total)}*`,
      link ? `\nBon de commande (PDF) : ${link}` : '', '',
      'Merci de confirmer.',
    ].filter(Boolean).join('\n');
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  // ── Mobile save ─────────────────────────────────────────────────

  const mobileSave = async () => {
    if (!tenant || !currentSite) { error('Magasin introuvable'); return; }
    if (!mobileForm.supplier_id) { error('Sélectionnez un fournisseur'); return; }
    const validItems = mobileItems.filter((i: any) => i.name.trim());
    if (validItems.length === 0) { error('Ajoutez au moins un article'); return; }
    const total = validItems.reduce((s: number, i: any) => s + Number(i.total), 0);
    setSaving(true);
    const { data: numData } = await supabase.rpc('next_doc_number', {
      p_tenant_id: tenant.id, p_kind: 'supplier_order', p_prefix: 'CMD',
    });
    const oNum = (numData as string) || ('CMD-' + Date.now());
    const { data: o, error: e } = await supabase.from('supplier_orders').insert({
      tenant_id: tenant.id, site_id: currentSite.id,
      supplier_id: mobileForm.supplier_id,
      order_number: oNum, subtotal: total, discount: 0, total,
      expected_date: mobileForm.expected_date || null, note: mobileForm.note, status: 'draft',
    }).select().single();
    if (e || !o) { error(e?.message || 'Erreur'); setSaving(false); return; }
    await supabase.from('supplier_order_items').insert(validItems.map((i: any) => ({
      tenant_id: tenant.id, order_id: o.id,
      article_id: i.article_id || null, name: i.name, supplier_ref: i.supplier_ref || '',
      quantity_ordered: i.quantity_ordered, quantity_received: 0,
      unit_price: i.unit_price, total: i.total,
    })));
    setSaving(false);
    success('Commande créée');
    setMobileOpen(false);
    load();
  };

  const mobileUpdateItem = (idx: number, field: string, val: any) => {
    setMobileItems((prev: any[]) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      if (field === 'article_id') {
        const art = articles.find((a: any) => a.id === val);
        if (art) {
          next[idx].name = art.name;
          next[idx].unit_price = art.purchase_price;
          next[idx].supplier_ref = art.supplier_ref || '';
          if (!Number(next[idx].quantity_ordered) || Number(next[idx].quantity_ordered) < 1) next[idx].quantity_ordered = 1;
        }
      }
      next[idx].total = Number(next[idx].quantity_ordered || 0) * Number(next[idx].unit_price || 0);
      return next;
    });
  };

  // ─── Render ────────────────────────────────────────────────────

  const pageContent = (
    <div className="space-y-0 px-3 sm:px-5 lg:px-8 py-4">
      {isDesktop && pendingRecovery && pendingRecovery.length > 0 && (
        <div className="mb-3 px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2 text-xs text-amber-900">
          <RotateCcw className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-semibold">Travail non enregistré détecté</div>
            <div className="mt-0.5">
              {pendingRecovery.length} fenêtre{pendingRecovery.length > 1 ? 's' : ''} de la session précédente peut être restaurée. Aucun enregistrement ne sera relancé automatiquement.
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-1">
            <button onClick={acceptRecovery} className="px-2 py-1 rounded bg-neutral-900 text-white text-[11px] font-semibold hover:bg-neutral-800 transition">Restaurer</button>
            <button onClick={dismissRecovery} className="px-2 py-1 rounded text-[11px] font-semibold text-amber-800 hover:bg-amber-100 transition">Ignorer</button>
          </div>
        </div>
      )}
      {/* ═══ Header ═══ */}
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-5 lg:-mx-8 px-4 sm:px-5 lg:px-8 pb-3 pt-4 -mt-3 sm:-mt-4 lg:-mt-6 bg-white space-y-3 border-b border-neutral-100">
        {/* Mobile: title + right-aligned action button (unchanged) */}
        <div className="md:hidden flex items-start justify-between">
          <h1 className="text-lg font-bold text-neutral-900 leading-tight">Achats</h1>
          <button onClick={openCreate} className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-700 hover:text-brand-700 transition-colors">
            <ClipboardList className="w-4 h-4" /><span className="hidden sm:inline">Nouvelle commande</span>
          </button>
        </div>

        {/* Mobile: search row (unchanged) */}
        <div className="md:hidden flex items-center gap-2">
          <div className="flex-1 min-w-0 relative">
            <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400 pointer-events-none" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher une commande…"
              className="w-input-ul w-full text-sm py-1.5 pl-5" />
          </div>
          {search && <button onClick={() => setSearch('')} className="shrink-0 p-1 text-neutral-400 hover:text-neutral-600"><X className="w-4 h-4" /></button>}
          <button onClick={() => load(true)} className="shrink-0 p-1.5 text-neutral-400 hover:text-neutral-600 transition" title="Rafraîchir">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Desktop: single compact toolbar row – search, refresh, action */}
        <div className="hidden md:flex items-end gap-6">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="N° commande, fournisseur ou référence…"
              className="w-input-ul w-full text-sm py-1.5 pl-5 pr-6"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-600 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {(serverPending.pending_count > 0 || totalPending > 0) && (
            <div className="shrink-0 hidden lg:inline-flex items-center gap-3 pb-1.5 text-[11px] font-semibold">
              {serverPending.pending_count > 0 && (
                <span className="text-amber-600 num">{serverPending.pending_count} en attente</span>
              )}
              {totalPending > 0 && (
                <span className="text-brand-700 num">{formatFCFA(totalPending)} à recevoir</span>
              )}
            </div>
          )}
          <button
            onClick={() => load(true)}
            className="shrink-0 inline-flex items-center justify-center pb-1.5 text-neutral-500 hover:text-neutral-800 transition-colors"
            title="Rafraîchir"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={openCreate}
            className="shrink-0 inline-flex items-center gap-1.5 pb-1.5 text-xs font-semibold text-neutral-700 hover:text-brand-700 transition-colors"
          >
            <ClipboardList className="w-4 h-4" /><span>Nouvelle commande</span>
          </button>
        </div>

        {/* Mobile: centered tabs with dividers, no counts/badges */}
        <div className="md:hidden flex items-stretch text-[13px] font-bold overflow-x-auto no-scrollbar">
          {FILTERS.map((f, i) => {
            const active = statusFilter === f.key;
            return (
              <div key={f.key} className="flex items-stretch shrink-0 min-w-[80px]">
                {i > 0 && <div className="w-px bg-neutral-200 shrink-0" />}
                <button
                  onClick={() => setStatusFilter(f.key)}
                  className={`flex-1 flex items-center justify-center py-2 px-3 transition-all ${
                    active
                      ? 'text-neutral-900 bg-neutral-100/80 border-b-2 border-neutral-900 font-bold'
                      : 'text-neutral-400 hover:text-neutral-600 border-b-2 border-transparent'
                  }`}
                >
                  {f.label}
                </button>
              </div>
            );
          })}
        </div>

        {/* Desktop: bigger, more impactful tab bar with counts */}
        <div className="hidden md:flex items-center gap-1 border-b border-neutral-200 -mb-3 overflow-x-auto no-scrollbar whitespace-nowrap">
          {FILTERS.map(f => {
            const active = statusFilter === f.key;
            const count = counts[f.key] || 0;
            return (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={`group shrink-0 inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                  active
                    ? 'text-neutral-900 border-neutral-900'
                    : 'text-neutral-500 border-transparent hover:text-neutral-800 hover:border-neutral-200'
                }`}
              >
                <span>{f.label}</span>
                <span className={`num text-[11px] px-1.5 py-0.5 rounded-full min-w-[22px] text-center ${active ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-500 group-hover:bg-neutral-200'}`}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ═══ List ═══ */}
      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
      ) : loadError ? (
        <div className="py-12 flex flex-col items-center gap-3">
          <AlertTriangle className="w-6 h-6 text-amber-500" />
          <p className="text-sm text-neutral-700 font-semibold">Chargement impossible</p>
          <p className="text-xs text-neutral-500 max-w-xs text-center">{loadError}</p>
          <button onClick={() => load()} className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:text-brand-800 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> Réessayer
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="Aucune commande"
          description="Créez votre première commande fournisseur."
          action={<button onClick={openCreate} className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-700 hover:text-brand-700 transition-colors"><ClipboardList className="w-4 h-4" />Nouvelle commande</button>}
        />
      ) : (
        <div className={flashList ? 'waarwi-flash waarwi-flash-scroll' : ''}>
          {/* Desktop table header */}
          <div className="hidden lg:flex items-center px-8 h-8 border-b border-neutral-200 bg-neutral-50/60 text-[10px] font-bold text-neutral-500 uppercase tracking-wider">
            <div className="w-[140px]">N° Commande</div>
            <div className="flex-1 min-w-0">Fournisseur</div>
            <div className="w-[100px]">Statut</div>
            <div className="w-[120px] text-right">Date</div>
            <div className="w-[130px] text-right">Montant</div>
            <div className="w-[100px] text-right pr-1">Actions</div>
          </div>
          <div className="divide-y divide-neutral-100">
            {filtered.map(o => {
              const stColor = STATUS_COLORS[o.status] || 'text-slate-500';
              const stLabel = STATUS_LABELS[o.status] || o.status;
              const canReceive = ['sent', 'confirmed', 'partial'].includes(o.status);
              return (
                <div
                  key={o.id}
                  data-row-id={o.id}
                  onClick={() => openDetail(o)}
                  className="group cursor-pointer transition hover:bg-neutral-50/60"
                >
                  {/* Desktop: single row */}
                  <div className="hidden lg:flex items-center px-8 h-10">
                    <div className="w-[140px] text-[13px] font-semibold text-neutral-800 truncate">{o.order_number}</div>
                    <div className="flex-1 min-w-0 text-xs text-neutral-600 truncate">{o.suppliers?.name || '—'}</div>
                    <div className="w-[100px]"><span className={`text-[11px] font-semibold ${stColor}`}>{stLabel}</span></div>
                    <div className="w-[120px] text-right text-xs text-neutral-500 num whitespace-nowrap">{formatDate(o.created_at)}</div>
                    <div className="w-[130px] text-right text-sm font-extrabold text-neutral-900 num whitespace-nowrap">{formatFCFA(o.total)}</div>
                    <div className="w-[100px] flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={e => { e.stopPropagation(); sendWhatsAppFor(o); }} className="p-1.5 rounded-lg hover:bg-[var(--w-hover)] text-[#25D366] transition" title="WhatsApp"><MessageCircle className="w-3.5 h-3.5" /></button>
                      <button onClick={e => { e.stopPropagation(); copyLinkFor(o); }} className="p-1.5 rounded-lg hover:bg-[var(--w-hover)] text-[var(--w-text-secondary)] transition" title="Copier le lien"><Link2 className="w-3.5 h-3.5" /></button>
                      {o.status === 'draft' && <button onClick={e => { e.stopPropagation(); changeStatus(o, 'sent'); }} className="p-1.5 rounded-lg hover:bg-[var(--w-hover)] text-[var(--w-text-secondary)] transition" title="Marquer envoyée"><CheckCircle className="w-3.5 h-3.5" /></button>}
                      {canReceive && <button onClick={e => { e.stopPropagation(); openOrderReceive(o); }} className="p-1.5 rounded-lg hover:bg-[var(--w-hover)] text-emerald-500 transition" title="Réceptionner"><Truck className="w-3.5 h-3.5" /></button>}
                    </div>
                  </div>
                  {/* Mobile: 3-line layout */}
                  <div className="lg:hidden px-4 py-2.5">
                    {/* Line 1: supplier only */}
                    <div className="text-xs font-medium text-neutral-700 truncate">{o.suppliers?.name || '—'}</div>
                    {/* Line 2: order#, date, status */}
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[13px] font-semibold text-neutral-900 shrink-0">{o.order_number}</span>
                      <span className={`text-[10px] font-semibold ${stColor} shrink-0`}>{stLabel}</span>
                      <span className="text-xs text-neutral-400 shrink-0">{formatDate(o.created_at)}</span>
                    </div>
                    {/* Line 3: icon buttons + amount */}
                    <div className="flex items-center gap-1 mt-1.5">
                      <button onClick={e => { e.stopPropagation(); sendWhatsAppFor(o); }} className="p-1.5 rounded-md hover:bg-[var(--w-hover)] text-[#25D366] transition" title="WhatsApp"><MessageCircle className="w-4 h-4" /></button>
                      <button onClick={e => { e.stopPropagation(); copyLinkFor(o); }} className="p-1.5 rounded-md hover:bg-[var(--w-hover)] text-[var(--w-text-muted)] transition" title="Copier le lien"><Link2 className="w-4 h-4" /></button>
                      {o.status === 'draft' && <button onClick={e => { e.stopPropagation(); changeStatus(o, 'sent'); }} className="p-1.5 rounded-md hover:bg-[var(--w-hover)] text-[var(--w-text-muted)] transition" title="Marquer envoyée"><CheckCircle className="w-4 h-4" /></button>}
                      {canReceive && <button onClick={e => { e.stopPropagation(); openOrderReceive(o); }} className="p-1.5 rounded-md hover:bg-[var(--w-hover)] text-emerald-500 transition" title="Réceptionner"><Truck className="w-4 h-4" /></button>}
                      <div className="flex-1" />
                      <div className="w-px h-5 bg-neutral-200 mx-1" />
                      <span className="text-sm font-extrabold text-neutral-900 num whitespace-nowrap shrink-0">{formatFCFA(o.total)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 py-3">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 text-xs font-semibold text-neutral-600 hover:text-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" /> Précédent
              </button>
              <span className="text-[11px] text-neutral-500 num">{page} / {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                className="inline-flex items-center gap-1 text-xs font-semibold text-neutral-600 hover:text-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Suivant <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}


      {/* ═══ Mobile view/receive ═══ */}
      {editorOpen && !isDesktop && editorMode !== 'create' && (
        <MobileOrderDetail
          mode={editorMode as 'view' | 'receive'}
          order={editorOrder}
          items={editorItems}
          articles={articles}
          suppliers={suppliers}
          headerForm={headerForm}
          subtotal={editorSubtotal}
          saving={saving}
          onClose={closeEditor}
          onPrint={editorOrderId ? printFromEditor : undefined}
          onCopyLink={editorOrder ? () => copyLinkFor(editorOrder) : undefined}
          onWhatsApp={editorOrder?.suppliers ? () => sendWhatsAppFor(editorOrder!) : undefined}
          onEdit={editorOrder && ['draft', 'sent', 'confirmed', 'partial'].includes(editorOrder.status) ? () => { if (editorOrder) openOrderEdit(editorOrder); } : undefined}
          onStartReceive={editorOrder && ['sent', 'confirmed', 'partial'].includes(editorOrder.status) ? () => { if (editorOrder) openOrderReceive(editorOrder); } : undefined}
          onChangeStatus={editorOrder ? (status: string) => { changeStatus(editorOrder, status); setEditorOrder({ ...editorOrder, status }); } : undefined}
          onCancel={editorOrder && ['draft', 'sent'].includes(editorOrder.status) ? () => setToCancel(editorOrder) : undefined}
          receiveQty={receiveQty}
          setReceiveQty={setReceiveQty}
          receiveLotData={receiveLotData}
          setReceiveLotData={setReceiveLotData}
          stockMethod={stockMethod}
          onConfirmReceive={editorMode === 'receive' ? confirmReceive : undefined}
        />
      )}

      {/* ═══ Mobile create wizard (unchanged) ═══ */}
      {mobileOpen && !isDesktop && (
        <MobileBillingWizard
          open={true}
          onClose={() => setMobileOpen(false)}
          title="Nouvelle commande fournisseur"
          headerFields={[
            { key: 'supplier_id', label: 'Fournisseur', type: 'select', required: true, options: suppliers.map(s => ({ value: s.id, label: s.name })), placeholder: 'Sélectionner...' },
            { key: 'expected_date', label: 'Livraison prévue', type: 'date' },
            { key: 'note', label: 'Note', type: 'text', placeholder: 'Note optionnelle...' },
          ]}
          headerValues={mobileForm}
          onHeaderChange={(k, v) => setMobileForm(f => ({ ...f, [k]: v }))}
          items={mobileItems.map(i => ({
            article_id: i.article_id || null, name: i.name,
            quantity: i.quantity_ordered, unit_price: i.unit_price, discount: 0, total: i.total,
            supplier_ref: i.supplier_ref,
          }))}
          onAddItem={(articleId) => {
            const art = articles.find(a => a.id === articleId);
            if (!art) return;
            setMobileItems(p => [...p, { article_id: articleId, name: art.name, supplier_ref: art.supplier_ref || '', quantity_ordered: 1, unit_price: art.purchase_price || 0, total: art.purchase_price || 0 }]);
          }}
          onUpdateItem={(idx, field, val) => {
            if (field === 'quantity') mobileUpdateItem(idx, 'quantity_ordered', val);
            else mobileUpdateItem(idx, field, val);
          }}
          onRemoveItem={(idx) => setMobileItems(p => p.filter((_, i) => i !== idx))}
          articles={articles}
          saving={saving}
          onSave={mobileSave}
          total={mobileItems.reduce((s: number, i: any) => s + Number(i.total || 0), 0)}
          saveLabel="Créer commande"
          itemPriceField="purchase_price"

        />
      )}

      {/* ═══ Cancel confirmation ═══ */}
      <ConfirmDialog
        open={!!toCancel}
        onClose={() => setToCancel(null)}
        onConfirm={async () => {
          if (!toCancel) return;
          await changeStatus(toCancel, 'cancelled');
          setToCancel(null);
          if (editorOrder?.id === toCancel.id) closeEditor();
        }}
        title="Annuler la commande ?"
        message={`La commande "${toCancel?.order_number}" sera annulée.`}
        danger
      />

      {/* ═══ Dispatch step for multi-site reception ═══ */}
      {dispatchOpen && (
        <div className="fixed inset-0 z-[65] flex flex-col bg-[var(--w-bg)] animate-fade-in">
          <DispatchStep
            items={dispatchLineItems}
            destinations={receiveDestinations}
            dispatchData={dispatchData}
            setDispatchData={setDispatchData}
            stockLevels={dispatchStockLevels}
            stockLoading={dispatchStockLoading}
            onConfirm={() => submitReception(dispatchData)}
            onBack={() => setDispatchOpen(false)}
            saving={saving}
          />
        </div>
      )}

    </div>
  );

  return (
    <>
      {isDesktop && pageWindowOpen && (
        <DesktopWindow
          id={SUPPLIER_ORDERS_PAGE_ID}
          title="Achats"
          icon={<ShoppingBag className="w-4 h-4" />}
          onClose={closeAchatsPage}
          minW={480}
          minH={320}
          background
          groupId={SUPPLIER_ORDERS_GROUP}
        >
          <div className="flex flex-col h-full min-h-0">
            <div className="flex-1 min-h-0 overflow-auto">{pageContent}</div>
            {(() => {
              const groupMinimized = wmWindows.filter(w => w.groupId === SUPPLIER_ORDERS_GROUP && w.id !== SUPPLIER_ORDERS_PAGE_ID && w.minimized);
              if (groupMinimized.length === 0) return null;
              return (
                <div className="shrink-0 h-9 border-t border-[var(--w-separator)] bg-[var(--w-surface-el)] flex items-center gap-1 px-2 overflow-x-auto">
                  {groupMinimized.map(w => (
                    <button
                      key={w.id}
                      onClick={() => { restoreWindow(w.id); focusWindow(w.id); }}
                      className="flex items-center gap-1.5 px-2.5 h-7 rounded-md bg-[var(--w-hover)] hover:bg-[var(--w-active)] text-xs font-medium text-[var(--w-text)] transition-colors truncate max-w-[220px]"
                    >
                      {w.icon && <span className="[&>svg]:w-3.5 [&>svg]:h-3.5 text-[var(--w-text-muted)]">{w.icon}</span>}
                      <span className="truncate">{w.title}</span>
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        </DesktopWindow>
      )}
      {!isDesktop && visible && pageContent}

      {isDesktop && Array.from(windowsMap.values()).map(desc => {
        const titleOrder = list.find(o => o.id === desc.orderId);
        const title = desc.orderId
          ? `Commande ${titleOrder?.order_number || ''}`.trim()
          : 'Nouvelle commande';
        const idx = Array.from(windowsMap.keys()).indexOf(desc.windowId);
        return (
          <DesktopWindow
            key={desc.windowId}
            id={desc.windowId}
            title={title}
            icon={<ClipboardList className="w-4 h-4" />}
            onClose={() => closeWindow(desc.windowId)}
            siteId={desc.siteId || undefined}
            initialRect={{ x: 60 + idx * 30, y: 20 + idx * 20, w: Math.min(1400, window.innerWidth - 100), h: Math.min(900, window.innerHeight - 60) }}
            minW={600}
            minH={400}
            groupId={SUPPLIER_ORDERS_GROUP}
          >
            <SupplierOrderInstance
              descriptor={desc}
              articles={articles}
              suppliers={suppliers}
              sites={sites}
              depots={depots}
              autoMode={autoMode}
              stockMethod={stockMethod}
              sharedSuppliers={sharedSuppliers}
              profileNames={profileNames}
              onClose={() => closeWindow(desc.windowId)}
              onSaved={() => load(true)}
              onOrderCreated={handleOrderCreated}
              onModeChange={handleModeChange}
            />
          </DesktopWindow>
        );
      })}
    </>
  );
}

// ─── Mobile Order Detail (view / receive) ─────────────────────────

const MOBILE_STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon', sent: 'Envoyée', confirmed: 'Confirmée',
  partial: 'Partielle', received: 'Reçue', cancelled: 'Annulée',
};
const MOBILE_STATUS_COLORS: Record<string, string> = {
  draft: 'text-slate-500', sent: 'text-neutral-700', confirmed: 'text-brand-600',
  partial: 'text-amber-600', received: 'text-emerald-600', cancelled: 'text-red-600',
};

function MobileOrderDetail({
  mode, order, items, headerForm, subtotal, saving,
  onClose, onPrint, onCopyLink, onWhatsApp, onEdit, onStartReceive,
  onChangeStatus, onCancel,
  receiveQty, setReceiveQty, receiveLotData, setReceiveLotData,
  stockMethod, onConfirmReceive,
}: {
  mode: 'view' | 'receive';
  order: any; items: SOLineItem[]; articles: any[]; suppliers: any[];
  headerForm: SOHeaderForm; subtotal: number; saving: boolean;
  onClose: () => void;
  onPrint?: () => void; onCopyLink?: () => void; onWhatsApp?: () => void;
  onEdit?: () => void; onStartReceive?: () => void;
  onChangeStatus?: (s: string) => void; onCancel?: () => void;
  receiveQty: ReceiveQtyMap; setReceiveQty: React.Dispatch<React.SetStateAction<ReceiveQtyMap>>;
  receiveLotData: ReceiveLotMap; setReceiveLotData: React.Dispatch<React.SetStateAction<ReceiveLotMap>>;
  stockMethod: string; onConfirmReceive?: () => void;
}) {
  const stLabel = MOBILE_STATUS_LABELS[order?.status || ''] || order?.status;
  const stColor = MOBILE_STATUS_COLORS[order?.status || ''] || 'text-slate-500';
  const supplierName = order?.suppliers?.name || '—';
  const validItems = items.filter(i => i.name.trim());

  return (
    <div className="fixed inset-0 z-[55] bg-white flex flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-neutral-200 shrink-0">
        <button onClick={onClose} className="p-1"><X className="w-5 h-5 text-neutral-700" /></button>
        <div className="text-center flex-1 min-w-0">
          <div className="text-sm font-bold text-neutral-900 truncate">{order?.order_number || 'Commande'}</div>
        </div>
        <span className={`text-xs font-semibold ${stColor}`}>{stLabel}</span>
      </div>

      {/* Receive banner */}
      {mode === 'receive' && (
        <div className="px-4 py-2.5 border-b border-[var(--w-separator)]">
          <div className="flex items-center gap-2">
            <Truck className="w-4 h-4 text-emerald-500" />
            <span className="text-xs font-semibold text-[var(--w-text)]">Mode réception</span>
          </div>
        </div>
      )}

      {/* Order info */}
      <div className="px-4 py-3 border-b border-neutral-100 space-y-1">
        <div className="flex items-center gap-2 text-xs text-neutral-700">
          <User className="w-3.5 h-3.5 text-neutral-400" />
          <span className="font-medium">{supplierName}</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-neutral-500">
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {formatDate(order?.created_at)}
          </span>
          {order?.expected_date && (
            <span>Livraison : {formatDate(order.expected_date)}</span>
          )}
        </div>
        {order?.note && <div className="text-xs text-neutral-400 italic">{order.note}</div>}
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto">
        {mode === 'view' ? (
          <div className="divide-y divide-neutral-100">
            {validItems.map((item, idx) => (
              <div key={idx} className="px-4 py-2.5">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-neutral-800 truncate">{item.name}</div>
                    {item.supplier_ref && <div className="text-[10px] text-neutral-400 font-mono">{item.supplier_ref}</div>}
                  </div>
                  <div className="text-sm font-bold text-neutral-900 num shrink-0 ml-2">{formatFCFA(item.total)}</div>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-neutral-500">
                  <span>{item.quantity_ordered} x {formatFCFA(item.unit_price)}</span>
                  {(item.quantity_received || 0) > 0 && (
                    <span className="text-emerald-600 font-medium">
                      {item.quantity_received}/{item.quantity_ordered} reçu
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Receive mode */
          <div className="divide-y divide-neutral-100">
            {validItems.map((item, idx) => {
              const itemId = item.id || `idx-${idx}`;
              const remaining = Math.max(0, (item.quantity_ordered || 0) - (item.quantity_received || 0));
              const todayQty = receiveQty[itemId] ?? remaining;
              const lotData = receiveLotData[itemId] || { batch_number: '', expiry_date: '' };
              if (remaining <= 0) return null;
              return (
                <div key={idx} className="px-4 py-3 space-y-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-neutral-800 truncate">{item.name}</div>
                    {item.supplier_ref && <div className="text-[10px] text-neutral-400 font-mono">{item.supplier_ref}</div>}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-neutral-400 mb-0.5">Commandé</div>
                      <div className="font-semibold text-neutral-700 num">{item.quantity_ordered}</div>
                    </div>
                    <div>
                      <div className="text-neutral-400 mb-0.5">Déjà reçu</div>
                      <div className="font-semibold text-neutral-700 num">{item.quantity_received || 0}</div>
                    </div>
                    <div>
                      <div className="text-neutral-400 mb-0.5">Restant</div>
                      <div className="font-semibold text-amber-600 num">{remaining}</div>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-neutral-500 block mb-0.5">Qte à recevoir</label>
                    <input
                      type="number" min={0} max={remaining} value={todayQty}
                      onChange={e => setReceiveQty(prev => ({ ...prev, [itemId]: Math.max(0, Math.min(remaining, Number(e.target.value) || 0)) }))}
                      className="w-input-ul text-sm font-semibold num py-1"
                    />
                  </div>
                  {stockMethod === 'lot' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-neutral-400 block mb-0.5">N° Lot</label>
                        <input
                          value={lotData.batch_number} placeholder="LOT-..."
                          onChange={e => setReceiveLotData(prev => ({ ...prev, [itemId]: { ...lotData, batch_number: e.target.value } }))}
                          className="w-input-ul text-xs py-1"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-neutral-400 block mb-0.5">Expiration</label>
                        <input
                          type="date" value={lotData.expiry_date}
                          onChange={e => setReceiveLotData(prev => ({ ...prev, [itemId]: { ...lotData, expiry_date: e.target.value } }))}
                          className="w-input-ul text-xs py-1"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-neutral-200 px-4 py-3 space-y-2 shrink-0 bg-white">
        <div className="flex items-center justify-between">
          <span className="text-xs text-neutral-500">{validItems.length} article{validItems.length > 1 ? 's' : ''}</span>
          <span className="text-base font-extrabold text-neutral-900 num">{formatFCFA(subtotal)}</span>
        </div>
        {mode === 'view' && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {onEdit && (
              <button onClick={onEdit} className="btn-icon" title="Modifier"><Pencil className="w-4 h-4" /></button>
            )}
            {order?.status === 'draft' && onChangeStatus && (
              <button onClick={() => onChangeStatus('sent')} className="btn-icon" title="Envoyer"><CheckCircle className="w-4 h-4" /></button>
            )}
            {onCopyLink && (
              <button onClick={onCopyLink} className="btn-icon" title="Copier le lien"><Link2 className="w-4 h-4" /></button>
            )}
            {onWhatsApp && (
              <button onClick={onWhatsApp} className="btn-icon" title="WhatsApp"><MessageCircle className="w-4 h-4" /></button>
            )}
            {onCancel && (
              <button onClick={onCancel} className="btn-icon-danger" title="Annuler"><Ban className="w-4 h-4" /></button>
            )}
            <span className="flex-1" />
            {onStartReceive && (
              <button onClick={onStartReceive} className="btn-icon-primary" title="Réceptionner"><Truck className="w-4 h-4" /></button>
            )}
            {onPrint && (
              <button onClick={onPrint} className="btn-icon-primary" title="Imprimer"><Printer className="w-4 h-4" /></button>
            )}
          </div>
        )}
        {mode === 'receive' && onConfirmReceive && (
          <button
            onClick={onConfirmReceive}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-neutral-900 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
            Confirmer la réception
          </button>
        )}
      </div>
    </div>
  );
}
