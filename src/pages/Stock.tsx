import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Boxes, Plus, Minus, Loader2, AlertTriangle, ArrowRightLeft, ClipboardList, ArrowDownCircle, ArrowUpCircle, X, TrendingDown, History, Calendar, BookOpen, PackageOpen, Clock, LayoutGrid, List, Check, Save, Printer, Info, Scroll, ChevronUp, ChevronDown, Trash2, MapPin, Filter, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { CategoryPickerModal } from './ArticlesComponents';
import { PageSearch } from '../components/PageSearch';
import { MoreMenu } from '../components/MoreMenu';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { usePermissions } from '../lib/permissions';
import { useToast } from '../context/ToastContext';
import { formatFCFA, formatDateTime } from '../lib/format';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { SearchableSelect } from '../components/SearchableSelect';
import { desktopAutoFocus } from '../lib/device';
import { PremiumDateRangePicker } from '../components/PremiumDateRangePicker';
import { consumeNavContext } from '../lib/navHighlight';
import { LotPickerModal, type ArticleLotSelection } from '../components/LotPickerModal';
import { printStockMovementA4, printStockMovement80, printInventoryBookA4, buildPrintTenantForSite, type PrintTenant } from '../lib/print';

type Row = {
  article_id: string;
  name: string;
  internal_ref: string;
  purchase_price: number;
  stock_min: number;
  stock_max: number;
  quantity: number;
  location: string;
  category_id: string;
};

type AdjustMode = 'in' | 'out' | 'transfer' | 'inventory';
type FilterKey = 'all' | 'instock' | 'low' | 'out';
type StockMethod = 'none' | 'cmup' | 'lot';

type LotRow = {
  id: string;
  article_id: string;
  article_name: string;
  article_ref: string;
  batch_number: string;
  expiry_date: string | null;
  remaining_quantity: number;
  initial_quantity: number;
  purchase_price: number;
  received_at: string;
};

export function Stock() {
  const { tenant, currentSite, sites, depots, dataTick, profile, refData } = useApp();
  const { can } = usePermissions();
  const { success, error } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [serverTotals, setServerTotals] = useState({ in_stock: 0, low_stock: 0, out_stock: 0, total_value: 0 });
  const [hasMore, setHasMore] = useState(false);
  const [stkPage, setStkPage] = useState(0);
  const [stkCursors, setStkCursors] = useState<{ val: string | null; id: string | null }[]>([]);
  const stkReqIdRef = useRef(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [catPickerOpen, setCatPickerOpen] = useState(false);
  const categories = refData?.categories || [];
  const [stkSortCol, setStkSortCol] = useState<'name' | 'stock' | 'min' | 'price'>('name');
  const [stkSortDir, setStkSortDir] = useState<'asc' | 'desc'>('asc');
  const [tab, setTab] = useState<'stocks' | 'movements' | 'lots'>('stocks');
  const [mvSubTab, setMvSubTab] = useState<'movements' | 'documents'>('movements');
  const [moves, setMoves] = useState<any[]>([]);
  const [mvDateFrom, setMvDateFrom] = useState<string>('');
  const [mvDateTo, setMvDateTo] = useState<string>('');
  const [mvPickerOpen, setMvPickerOpen] = useState(false);
  const [mvPage, setMvPage] = useState(1);
  const [mvTotalCount, setMvTotalCount] = useState(0);
  const [mvLoading, setMvLoading] = useState(false);
  const MV_PAGE_SIZE = 50;
  const [mvSiteId, setMvSiteId] = useState<string>(() => {
    if (!tenant?.id || !profile?.id) return '';
    try {
      const stored = localStorage.getItem(`mvSiteId:${tenant.id}:${profile.id}`);
      return stored || '';
    } catch { return ''; }
  });
  const [pendingSiteChange, setPendingSiteChange] = useState<{ newSiteId: string; newSiteName: string; isDepot: boolean } | null>(null);
  const [viewMode, setViewMode] = useState<'cards' | 'list'>(() => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    return isMobile ? 'cards' : 'list';
  });
  const [listEditMode, setListEditMode] = useState<'in' | 'out' | 'inventory' | 'transfer'>('in');
  type ListEditEntry = { article_id: string; qty: number | ''; note: string; lot_number: string; };
  const [listEdits, setListEdits] = useState<Map<string, ListEditEntry>>(new Map());
  const [listSaving, setListSaving] = useState(false);
  const listInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const saveBulkRef = useRef<(() => void) | null>(null);
  const [listTransferTarget, setListTransferTarget] = useState('');
  const [listSourceSite, setListSourceSite] = useState('');
  const listSourceInitialized = useRef(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const [adjOpen, setAdjOpen] = useState(false);
  const [adjRow, setAdjRow] = useState<Row | null>(null);
  const [adjMode, setAdjMode] = useState<AdjustMode>('in');
  const [adjQty, setAdjQty] = useState<number | ''>('');
  const [adjNote, setAdjNote] = useState('');
  const [adjTargetSite, setAdjTargetSite] = useState('');
  const [adjSiteId, setAdjSiteId] = useState('');
  const [adjInventoryQty, setAdjInventoryQty] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);

  // Lot-specific fields
  const [adjBatchNumber, setAdjBatchNumber] = useState('');
  const [adjExpiryDate, setAdjExpiryDate] = useState('');
  const [adjPurchasePrice, setAdjPurchasePrice] = useState<number | ''>('');
  const [lots, setLots] = useState<LotRow[]>([]);

  const stockMethod: StockMethod = ((tenant as any)?.settings?.stock_method as StockMethod) || 'none';
  const sharedArticles = (tenant as any)?.settings?.shared_articles !== false;
  const interDepotTransfer = !!(tenant as any)?.settings?.inter_depot_transfer;

  // Transfer targets logic:
  // - Own depots (parent_site_id === currentSite.id): ALWAYS accessible
  // - Other stores: only if sharedArticles
  // - Depots of other stores: only if sharedArticles AND interDepotTransfer
  const allTransferTargets = (() => {
    const targets: typeof sites = [];
    // Own depots are always reachable
    for (const d of depots) {
      if (d.parent_site_id === currentSite?.id) targets.push(d);
    }
    // Main store is always reachable as a destination (for transfers from depots back to store)
    if (currentSite) {
      const storeObj: typeof sites[0] = { ...currentSite };
      targets.push(storeObj);
    }
    if (sharedArticles) {
      // Other stores
      for (const s of sites) {
        if (s.id !== currentSite?.id) targets.push(s);
      }
      // Depots of other stores (inter-depot)
      if (interDepotTransfer) {
        for (const d of depots) {
          if (d.parent_site_id !== currentSite?.id) targets.push(d);
        }
      }
    }
    // Deduplicate by id
    const seen = new Set<string>();
    return targets.filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });
  })();
  const canTransfer = allTransferTargets.length > 0;

  // Lot picker for sortie
  const [lotPickerOutOpen, setLotPickerOutOpen] = useState(false);
  const [lotPickerOutRow, setLotPickerOutRow] = useState<Row | null>(null);
  const [lotPickerOutQty, setLotPickerOutQty] = useState(0);

  // After a successful individual adjustment, show print options
  const [adjDone, setAdjDone] = useState(false);
  const [adjDoneData, setAdjDoneData] = useState<{ articleName: string; articleRef: string; qty: number; type: string; label: string } | null>(null);

  // After a successful bulk operation, show print modal
  const [bulkDoneOpen, setBulkDoneOpen] = useState(false);
  const [bulkDoneItems, setBulkDoneItems] = useState<{ ref: string; name: string; quantity: number }[]>([]);
  const [bulkDoneMode, setBulkDoneMode] = useState('');

  // Per-site stock map for bulk operations (key: site_id, value: Map<article_id, qty>)
  const [stockByLocation, setStockByLocation] = useState<Map<string, Map<string, number>>>(new Map());

  // Inventory book printing modal
  const [invBookOpen, setInvBookOpen] = useState(false);
  const [invBookScope, setInvBookScope] = useState<string>('');

  // Stock documents (bulk operations)
  type StockDocRow = {
    id: string;
    doc_number: string;
    doc_type: 'entry' | 'exit' | 'transfer' | 'inventory';
    site_id: string;
    dest_site_id: string | null;
    user_id: string | null;
    note: string;
    status: string;
    total_qty: number;
    line_count: number;
    created_at: string;
    user_email?: string | null;
  };
  const [stockDocs, setStockDocs] = useState<StockDocRow[]>([]);
  const [docsTypeFilter, setDocsTypeFilter] = useState<'all' | 'entry' | 'exit' | 'transfer' | 'inventory'>('all');
  const [docDetailOpen, setDocDetailOpen] = useState(false);
  const [docDetailDoc, setDocDetailDoc] = useState<StockDocRow | null>(null);
  const [docDetailLines, setDocDetailLines] = useState<any[]>([]);
  const [docDetailLoading, setDocDetailLoading] = useState(false);
  const [docEditOpen, setDocEditOpen] = useState(false);
  const [docEditDoc, setDocEditDoc] = useState<StockDocRow | null>(null);
  const [docEditEntries, setDocEditEntries] = useState<{ article_id: string; article_name: string; article_ref: string; quantity: number | ''; note: string }[]>([]);
  const [docEditNote, setDocEditNote] = useState('');
  const [docEditSaving, setDocEditSaving] = useState(false);
  const [docDeleteConfirm, setDocDeleteConfirm] = useState<StockDocRow | null>(null);
  const [docDeleting, setDocDeleting] = useState(false);

  const load = async (silent = false) => {
    if (!tenant || !currentSite) return;
    const myReqId = ++stkReqIdRef.current;
    if (!silent) setLoading(true); else setRefreshing(true);

    const cursor = stkPage > 0 && stkCursors[stkPage - 1] ? stkCursors[stkPage - 1] : { val: null, id: null };

    const params: Record<string, any> = {
      p_tenant_id: tenant.id,
      p_site_id: currentSite.id,
      p_page_size: 50,
      p_search: debouncedSearch || null,
      p_category_id: categoryFilter || null,
      p_stock_filter: filter !== 'all' ? filter : null,
      p_sort_col: stkSortCol,
      p_sort_dir: stkSortDir,
      p_shared_articles: sharedArticles,
    };
    if (cursor.val && cursor.id) {
      params.p_cursor_val = cursor.val;
      params.p_cursor_id = cursor.id;
    }

    const { data, error } = await supabase.rpc('rpc_paginated_stock', params);
    if (myReqId !== stkReqIdRef.current) return;

    if (error || !data) {
      setLoading(false); setRefreshing(false); return;
    }

    const newRows = (data.rows || []) as Row[];
    setRows(newRows);
    setTotalCount(data.total_count || 0);
    setServerTotals(data.totals || {});
    setHasMore(newRows.length >= 50);

    if (newRows.length > 0) {
      const last = newRows[newRows.length - 1];
      const cv = stkSortCol === 'name' ? last.name :
        stkSortCol === 'stock' ? String(last.quantity) :
        stkSortCol === 'min' ? String(last.stock_min) :
        stkSortCol === 'price' ? String(last.purchase_price) :
        last.name || '';
      setStkCursors(prev => {
        const next = [...prev];
        next[stkPage] = { val: cv, id: last.article_id };
        return next;
      });
    }

    setLoading(false);
    setRefreshing(false);
    setInitialLoaded(true);

    // Load stock-by-location for bulk operations (on first page only)
    if (stkPage === 0) {
      const ownDepotIds = depots.filter(d => d.parent_site_id === currentSite.id).map(d => d.id);
      const allLocationIds = [currentSite.id, ...ownDepotIds];
      if (allLocationIds.length > 0) {
        let allLocStk: any[] = [];
        let locFrom = 0;
        while (true) {
          const { data: ld, error: e } = await supabase.from('stock_levels').select('article_id, site_id, quantity').eq('tenant_id', tenant.id).in('site_id', allLocationIds).range(locFrom, locFrom + 999);
          if (e || !ld) break;
          allLocStk = allLocStk.concat(ld);
          if (ld.length < 1000) break;
          locFrom += 1000;
        }
        const byLoc = new Map<string, Map<string, number>>();
        for (const id of allLocationIds) byLoc.set(id, new Map());
        allLocStk.forEach((r: any) => { const m = byLoc.get(r.site_id); if (m) m.set(r.article_id, Number(r.quantity)); });
        setStockByLocation(byLoc);
      }
    }

    // Load lots if lot mode
    if (stockMethod === 'lot') {
      const { data: lotData } = await supabase
        .from('stock_lots')
        .select('id, article_id, batch_number, expiry_date, remaining_quantity, initial_quantity, purchase_price, received_at, articles(name, internal_ref)')
        .eq('tenant_id', tenant.id)
        .eq('site_id', currentSite.id)
        .gt('remaining_quantity', 0)
        .order('expiry_date', { ascending: true });
      setLots((lotData || []).map((l: any) => ({
        id: l.id, article_id: l.article_id,
        article_name: l.articles?.name || '', article_ref: l.articles?.internal_ref || '',
        batch_number: l.batch_number, expiry_date: l.expiry_date,
        remaining_quantity: Number(l.remaining_quantity), initial_quantity: Number(l.initial_quantity),
        purchase_price: Number(l.purchase_price), received_at: l.received_at,
      })));
    }
  };

  // Debounce search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setDebouncedSearch(search); setStkPage(0); setStkCursors([]); }, 250);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search]);

  useEffect(() => { if (tab === 'stocks') load(); /* eslint-disable-next-line */ }, [tab, tenant?.id, currentSite?.id, stkPage, debouncedSearch, filter, categoryFilter, stkSortCol, stkSortDir, sharedArticles]);

  // Reset page when filters change
  useEffect(() => { if (tab === 'stocks') { setStkPage(0); setStkCursors([]); } }, [filter, categoryFilter, stkSortCol, stkSortDir, tenant?.id, currentSite?.id]);

  // ── Load movements paginated with search/date filters ──────────────────────
  const accessibleSiteIds = useMemo(() => {
    if (!currentSite) return [] as string[];
    const ownDepotIds = depots.filter(d => d.parent_site_id === currentSite.id).map(d => d.id);
    return [currentSite.id, ...ownDepotIds];
  }, [currentSite?.id, depots]);

  useEffect(() => {
    if (mvSiteId && accessibleSiteIds.length > 0 && !accessibleSiteIds.includes(mvSiteId)) {
      setMvSiteId('');
      try { if (tenant?.id && profile?.id) localStorage.setItem(`mvSiteId:${tenant.id}:${profile.id}`, ''); } catch {}
    }
  }, [mvSiteId, accessibleSiteIds]);

  const loadMovements = async (page = 1) => {
    if (!tenant || !currentSite) return;
    setMvLoading(true);
    const from = (page - 1) * MV_PAGE_SIZE;
    const to = from + MV_PAGE_SIZE - 1;

    // If search is active, we need to find matching article IDs first
    let articleFilter: string[] | null = null;
    const q = search.toLowerCase().trim();
    if (q && tab === 'movements') {
      const matchingArticles = rows.filter(r =>
        r.name.toLowerCase().includes(q) || r.internal_ref.toLowerCase().includes(q)
      ).map(r => r.article_id);
      articleFilter = matchingArticles;
      if (matchingArticles.length === 0) {
        setMoves([]);
        setMvTotalCount(0);
        setMvLoading(false);
        return;
      }
    }

    let query = supabase
      .from('stock_movements')
      .select('id, movement_type, quantity, previous_qty, new_qty, note, created_at, article_id, site_id, stock_document_id, articles(name, internal_ref), stock_documents(site_id, dest_site_id, doc_number)', { count: 'exact' })
      .eq('tenant_id', tenant.id);

    if (mvSiteId) {
      query = query.eq('site_id', mvSiteId);
    } else {
      query = query.in('site_id', accessibleSiteIds);
    }

    if (articleFilter && articleFilter.length <= 200) {
      query = query.in('article_id', articleFilter);
    }
    if (mvDateFrom) {
      query = query.gte('created_at', mvDateFrom + 'T00:00:00');
    }
    if (mvDateTo) {
      query = query.lte('created_at', mvDateTo + 'T23:59:59');
    }

    query = query.order('created_at', { ascending: false }).range(from, to);

    const { data, count, error: e } = await query;
    if (!e) {
      setMoves(data || []);
      setMvTotalCount(count ?? 0);
    }
    setMvLoading(false);
  };

  useEffect(() => {
    if (tab === 'movements' && mvSubTab === 'movements') loadMovements(mvPage);
    /* eslint-disable-next-line */
  }, [tab, mvSubTab, mvPage, mvDateFrom, mvDateTo, tenant?.id, currentSite?.id, mvSiteId]);

  // Reset movements page when search or date changes
  useEffect(() => {
    if (tab === 'movements' && mvSubTab === 'movements') {
      setMvPage(1);
      loadMovements(1);
    }
    /* eslint-disable-next-line */
  }, [search]);

  // ── Load stock documents when entering documents sub-tab ────────────────────
  const loadStockDocs = async () => {
    if (!tenant) return;
    // Vider immédiatement l'ancienne liste pendant le chargement
    setStockDocs([]);
    if (!mvSiteId && accessibleSiteIds.length === 0) return;
    let query = supabase
      .from('stock_documents')
      .select('id, doc_number, doc_type, site_id, dest_site_id, user_id, note, status, total_qty, line_count, created_at')
      .eq('tenant_id', tenant.id)
      .order('created_at', { ascending: false });
    if (mvSiteId) {
      // Emplacement sélectionné : source OU destination (transferts entrants comme sortants)
      query = query.or(`site_id.eq.${mvSiteId},dest_site_id.eq.${mvSiteId}`);
    } else {
      // Tous les emplacements : magasin courant + ses dépôts accessibles
      const ids = accessibleSiteIds.join(',');
      query = query.or(`site_id.in.(${ids}),dest_site_id.in.(${ids})`);
    }
    if (mvDateFrom) {
      query = query.gte('created_at', mvDateFrom + 'T00:00:00');
    }
    if (mvDateTo) {
      query = query.lte('created_at', mvDateTo + 'T23:59:59');
    }
    const { data, error: e } = await query.limit(200);
    if (e) { setStockDocs([]); return; }
    setStockDocs((data || []) as StockDocRow[]);
  };
  useEffect(() => {
    if (tab === 'movements' && mvSubTab === 'documents') loadStockDocs();
    /* eslint-disable-next-line */
  }, [tab, mvSubTab, tenant?.id, currentSite?.id, dataTick, mvSiteId, mvDateFrom, mvDateTo]);

  const [flashKey, setFlashKey] = useState<string | null>(null);
  useEffect(() => {
    const ctx = consumeNavContext();
    if (!ctx?.target) return;
    if (ctx.target === 'outOfStock') { setTab('stocks'); setFilter('out'); setFlashKey('out'); }
    else if (ctx.target === 'lowStock') { setTab('stocks'); setFilter('low'); setFlashKey('low'); }
    else if (ctx.target === 'stockIn') { setTab('movements'); setFlashKey('stockIn'); }
    else if (ctx.target === 'articles') { setTab('stocks'); setFilter('all'); setFlashKey('articles'); }
    const t = setTimeout(() => setFlashKey(null), 6800);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => { if (dataTick > 0) { const t = setTimeout(() => load(true), 400); return () => clearTimeout(t); } /* eslint-disable-next-line */ }, [dataTick]);

  const lowCount = serverTotals.low_stock || 0;
  const outCount = serverTotals.out_stock || 0;
  const inStockCount = serverTotals.in_stock || 0;
  const totalValue = serverTotals.total_value || 0;

  const filteredMoves = moves;

  const mvTotalPages = Math.max(1, Math.ceil(mvTotalCount / MV_PAGE_SIZE));

  const printInventoryBook = () => {
    if (!tenant || !currentSite) return;
    const ownDepots = depots.filter(d => d.parent_site_id === currentSite.id);
    if (ownDepots.length === 0) {
      runPrintInventoryBook(currentSite.id);
      return;
    }
    setInvBookScope('');
    setInvBookOpen(true);
  };

  const runPrintInventoryBook = (scope: string) => {
    if (!tenant || !currentSite) return;
    const now = new Date();
    const refBase = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const dateStr = now.toLocaleString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const tenantInfo = buildPrintTenantForSite(tenant, currentSite);
    const ownDepots = depots.filter(d => d.parent_site_id === currentSite.id);
    const targets: { id: string; name: string }[] = scope === 'all'
      ? [{ id: currentSite.id, name: currentSite.name + ' (Magasin)' }, ...ownDepots.map(d => ({ id: d.id, name: d.name + ' (Dépôt)' }))]
      : [{ id: scope, name: (scope === currentSite.id ? currentSite.name + ' (Magasin)' : (ownDepots.find(d => d.id === scope)?.name || '') + ' (Dépôt)') }];

    targets.forEach((target, idx) => {
      const stockMap = stockByLocation.get(target.id) || new Map<string, number>();
      const items = rows
        .map(r => ({ ...r, _q: stockMap.get(r.article_id) ?? 0 }))
        .filter(r => r._q > 0)
        .sort((a, b) => a.name.localeCompare(b.name));
      if (items.length === 0 && scope === 'all') return;
      printInventoryBookA4({
        tenant: tenantInfo,
        siteName: target.name,
        items: items.map(r => ({
          ref: r.internal_ref, name: r.name, location: r.location,
          qty_theoretical: r._q, qty_real: r._q, purchase_price: r.purchase_price,
        })),
        date: dateStr,
        reference: targets.length > 1 ? `${refBase}-${idx + 1}` : refBase,
      });
    });
  };

  const tenantPrint: PrintTenant = buildPrintTenantForSite(tenant, currentSite);

  const printMovement = (m: any, format: 'a4' | '80') => {
    if (!tenant || !currentSite) return;
    const mvSiteName = mvSiteId
      ? (mvSiteId === currentSite.id
          ? currentSite.name
          : (depots.find(d => d.id === mvSiteId)?.name || currentSite.name))
      : currentSite.name;
    const opts = {
      tenant: tenantPrint,
      movementType: m.movement_type,
      movementLabel: mvTypeLabel[m.movement_type] || m.movement_type,
      reference: `MVT-${String(m.id).substring(0, 8).toUpperCase()}`,
      date: new Date(m.created_at).toLocaleString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      user: profile?.full_name || profile?.email || '',
      siteName: mvSiteName,
      items: [{ ref: (m.articles as any)?.internal_ref || '', name: (m.articles as any)?.name || '', quantity: Number(m.quantity) }],
      observation: m.note || undefined,
    };
    if (format === 'a4') printStockMovementA4(opts);
    else printStockMovement80(opts);
  };

  // ── Stock document helpers ───────────────────────────────────────────────────
  const docTypeMeta: Record<string, { label: string; color: string; mvType: string }> = {
    entry: { label: 'Entrée', color: 'text-emerald-700', mvType: 'adjustment_in' },
    exit: { label: 'Sortie', color: 'text-red-700', mvType: 'adjustment_out' },
    transfer: { label: 'Transfert', color: 'text-neutral-800', mvType: 'transfer_out' },
    inventory: { label: 'Inventaire', color: 'text-amber-700', mvType: 'inventory' },
  };

  const findSiteName = (id: string | null | undefined) => {
    if (!id) return '';
    if (currentSite?.id === id) return currentSite.name;
    const s = sites.find(x => x.id === id);
    if (s) return s.name;
    const d = depots.find(x => x.id === id);
    if (d) return d.name + ' (Dépôt)';
    return '—';
  };

  const openDocDetail = async (doc: StockDocRow) => {
    setDocDetailDoc(doc);
    setDocDetailOpen(true);
    setDocDetailLoading(true);
    setDocDetailLines([]);
    const { data } = await supabase
      .from('stock_movements')
      .select('id, movement_type, quantity, previous_qty, new_qty, note, created_at, article_id, articles(name, internal_ref)')
      .eq('stock_document_id', doc.id)
      .order('created_at', { ascending: true });
    setDocDetailLines(data || []);
    setDocDetailLoading(false);
  };

  const printStockDoc = (doc: StockDocRow, lines: any[], format: 'a4' | '80') => {
    if (!tenant) return;
    const meta = docTypeMeta[doc.doc_type];
    const items = lines
      .filter(l => doc.doc_type !== 'transfer' || l.movement_type === 'transfer_out')
      .map(l => ({
        ref: (l.articles as any)?.internal_ref || '',
        name: (l.articles as any)?.name || '',
        quantity: Math.abs(Number(l.quantity)),
      }));
    const siteName = findSiteName(doc.site_id) + (doc.dest_site_id ? ` → ${findSiteName(doc.dest_site_id)}` : '');
    const opts = {
      tenant: tenantPrint,
      movementType: meta?.mvType || doc.doc_type,
      movementLabel: meta?.label || doc.doc_type,
      reference: doc.doc_number,
      date: new Date(doc.created_at).toLocaleString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      user: profile?.full_name || profile?.email || '',
      siteName,
      items,
      observation: doc.note || undefined,
    };
    if (format === 'a4') printStockMovementA4(opts);
    else printStockMovement80(opts);
  };

  const reprintDocFromList = async (doc: StockDocRow, format: 'a4' | '80') => {
    const { data } = await supabase
      .from('stock_movements')
      .select('id, movement_type, quantity, article_id, articles(name, internal_ref)')
      .eq('stock_document_id', doc.id);
    printStockDoc(doc, data || [], format);
  };

  const openDocEdit = async (doc: StockDocRow) => {
    if (doc.status !== 'active') { error('Document déjà annulé ou édité'); return; }
    if (doc.doc_type === 'transfer') { error('Édition non supportée pour les transferts (annulez puis recréez)'); return; }
    setDocEditDoc(doc);
    setDocEditNote(doc.note || '');
    setDocEditSaving(false);
    const { data } = await supabase
      .from('stock_movements')
      .select('id, quantity, article_id, note, articles(name, internal_ref)')
      .eq('stock_document_id', doc.id);
    const entries = (data || []).map((l: any) => ({
      article_id: l.article_id,
      article_name: l.articles?.name || '',
      article_ref: l.articles?.internal_ref || '',
      quantity: Math.abs(Number(l.quantity)) as number | '',
      note: l.note || '',
    }));
    setDocEditEntries(entries);
    setDocEditOpen(true);
  };

  const saveDocEdit = async () => {
    if (!docEditDoc || !tenant) return;
    if (!can('manage_stock')) { error('Permission refusée'); return; }
    const valid = docEditEntries.filter(e => e.quantity !== '' && Number(e.quantity) > 0);
    if (valid.length === 0) { error('Aucune ligne valide'); return; }
    setDocEditSaving(true);
    try {
      // 1. Reverse old movements (returns stock to pre-document state)
      const { error: rErr } = await supabase.rpc('reverse_stock_document', { p_document_id: docEditDoc.id });
      if (rErr) throw rErr;

      // 2. Re-apply new entries linked to the SAME document id
      for (const entry of valid) {
        const qty = Number(entry.quantity);
        if (docEditDoc.doc_type === 'entry') {
          const { error: e } = await supabase.rpc('adjust_stock_with_doc', {
            p_article_id: entry.article_id, p_site_id: docEditDoc.site_id,
            p_quantity: qty, p_movement_type: 'adjustment_in',
            p_note: entry.note || 'Entrée stock (masse édité)',
            p_stock_document_id: docEditDoc.id,
          });
          if (e) throw e;
        } else if (docEditDoc.doc_type === 'exit') {
          const { error: e } = await supabase.rpc('adjust_stock_with_doc', {
            p_article_id: entry.article_id, p_site_id: docEditDoc.site_id,
            p_quantity: -qty, p_movement_type: 'adjustment_out',
            p_note: entry.note || 'Sortie stock (masse édité)',
            p_stock_document_id: docEditDoc.id,
          });
          if (e) throw e;
        } else if (docEditDoc.doc_type === 'inventory') {
          // For inventory, qty is the new real qty; compute diff against current level
          const { data: lvl } = await supabase
            .from('stock_levels')
            .select('quantity')
            .eq('article_id', entry.article_id).eq('site_id', docEditDoc.site_id).maybeSingle();
          const currentQty = Number(lvl?.quantity ?? 0);
          const diff = qty - currentQty;
          if (diff === 0) continue;
          const { error: e } = await supabase.rpc('adjust_stock_with_doc', {
            p_article_id: entry.article_id, p_site_id: docEditDoc.site_id,
            p_quantity: diff, p_movement_type: 'inventory',
            p_note: entry.note || `Inventaire édité: ${currentQty} -> ${qty}`,
            p_stock_document_id: docEditDoc.id,
          });
          if (e) throw e;
        }
      }

      // 3. Update document header
      const totalQty = valid.reduce((s, e) => s + Math.abs(Number(e.quantity) || 0), 0);
      await supabase.from('stock_documents').update({
        note: docEditNote,
        total_qty: totalQty,
        line_count: valid.length,
        updated_at: new Date().toISOString(),
      }).eq('id', docEditDoc.id);

      success(`Document ${docEditDoc.doc_number} mis à jour · stock régénéré`);
      setDocEditOpen(false);
      setDocEditDoc(null);
      await loadStockDocs();
      await load(true);
    } catch (e: any) {
      error(e.message || 'Erreur lors de la mise à jour');
    } finally {
      setDocEditSaving(false);
    }
  };

  const cancelDoc = async (doc: StockDocRow) => {
    if (!can('manage_stock')) { error('Permission refusée'); return; }
    setDocDeleting(true);
    try {
      const { error: rErr } = await supabase.rpc('reverse_stock_document', { p_document_id: doc.id });
      if (rErr) throw rErr;
      await supabase.from('stock_documents').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', doc.id);
      success(`Document ${doc.doc_number} annulé · stock régénéré`);
      setDocDeleteConfirm(null);
      await loadStockDocs();
      await load(true);
    } catch (e: any) {
      error(e.message || 'Erreur lors de l\'annulation');
    } finally {
      setDocDeleting(false);
    }
  };

  // Rows are already filtered/sorted/paginated server-side
  const filtered = rows;

  const PAGE_SIZE = 50;
  // Sync listSourceSite when currentSite changes (e.g. user switches via header)
  useEffect(() => {
    if (!currentSite?.id) return;
    if (!listSourceInitialized.current) {
      setListSourceSite(currentSite.id);
      listSourceInitialized.current = true;
      return;
    }
    const hasEdits = Array.from(listEdits.values()).some(e => e.qty !== '' && Number(e.qty) !== 0);
    if (!hasEdits) {
      setListSourceSite(currentSite.id);
    }
  }, [currentSite?.id]);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const visibleItems = rows;

  const openAdj = (r: Row, mode: AdjustMode) => {
    setAdjRow(r); setAdjMode(mode); setAdjQty(''); setAdjNote('');
    setAdjTargetSite(allTransferTargets[0]?.id || '');
    setAdjSiteId(currentSite?.id || '');
    setAdjInventoryQty(r.quantity);
    setAdjBatchNumber(''); setAdjExpiryDate(''); setAdjPurchasePrice(r.purchase_price || '');
    setAdjDone(false); setAdjDoneData(null);
    setAdjOpen(true);
  };

  const openAdjNew = (mode: AdjustMode) => {
    if (rows.length === 0) return;
    const first = rows[0];
    setAdjRow(first); setAdjMode(mode); setAdjQty(''); setAdjNote('');
    setAdjTargetSite(allTransferTargets[0]?.id || '');
    setAdjSiteId(currentSite?.id || '');
    setAdjInventoryQty(first.quantity);
    setAdjBatchNumber(''); setAdjExpiryDate(''); setAdjPurchasePrice(first.purchase_price || '');
    setAdjDone(false); setAdjDoneData(null);
    setAdjOpen(true);
  };

  const saveAdj = async () => {
    if (!adjRow || !currentSite) return;
    if (!can('manage_stock')) { error('Vous n\'avez pas la permission de gerer le stock'); return; }
    const qty = Number(adjQty);
    const targetSite = adjSiteId || currentSite.id;
    setSaving(true);
    try {
      let savedType = adjMode === 'in' ? 'adjustment_in' : adjMode === 'out' ? 'adjustment_out' : adjMode;
      let savedQty = qty;
      if (adjMode === 'inventory') {
        const realQty = Number(adjInventoryQty);
        const diff = realQty - adjRow.quantity;
        if (diff === 0) { setAdjOpen(false); setSaving(false); return; }
        const { error: e } = await supabase.rpc('adjust_stock', {
          p_article_id: adjRow.article_id, p_site_id: targetSite,
          p_quantity: diff, p_movement_type: 'inventory',
          p_note: adjNote || `Inventaire: ${adjRow.quantity} → ${realQty}`,
        });
        if (e) throw e;
        savedType = 'inventory'; savedQty = Math.abs(diff);
        success('Inventaire enregistré');
      } else if (adjMode === 'transfer') {
        if (!adjTargetSite) { error('Choisissez un magasin de destination'); setSaving(false); return; }
        if (!qty || qty <= 0) { error('Quantité invalide'); setSaving(false); return; }
        // Validate transfer is allowed based on catalog mode
        if (!allTransferTargets.some(t => t.id === adjTargetSite)) {
          error('Transfert non autorisé vers cette destination');
          setSaving(false); return;
        }
        const { error: e1 } = await supabase.rpc('adjust_stock', {
          p_article_id: adjRow.article_id, p_site_id: targetSite,
          p_quantity: -qty, p_movement_type: 'transfer_out', p_note: adjNote || 'Transfert sortie',
        });
        if (e1) throw e1;
        const { error: e2 } = await supabase.rpc('adjust_stock', {
          p_article_id: adjRow.article_id, p_site_id: adjTargetSite,
          p_quantity: qty, p_movement_type: 'transfer_in', p_note: adjNote || 'Transfert entrée',
        });
        if (e2) throw e2;
        savedType = 'transfer_out';
        success('Transfert effectué');
      } else if (adjMode === 'in' && stockMethod === 'lot') {
        if (!qty || qty <= 0) { error('Quantité invalide'); setSaving(false); return; }
        if (!adjBatchNumber.trim()) { error('Numéro de lot requis'); setSaving(false); return; }
        const { error: e } = await supabase.rpc('adjust_stock_lot', {
          p_article_id: adjRow.article_id, p_site_id: targetSite,
          p_quantity: qty, p_batch_number: adjBatchNumber.trim(),
          p_expiry_date: adjExpiryDate || null,
          p_purchase_price: Number(adjPurchasePrice) || adjRow.purchase_price,
          p_note: adjNote || `Lot ${adjBatchNumber.trim()}`,
        });
        if (e) throw e;
        success('Lot enregistré');
      } else if (adjMode === 'in' && stockMethod === 'cmup') {
        if (!qty || qty <= 0) { error('Quantité invalide'); setSaving(false); return; }
        const price = Number(adjPurchasePrice) || adjRow.purchase_price;
        const { error: e } = await supabase.rpc('adjust_stock', {
          p_article_id: adjRow.article_id, p_site_id: targetSite,
          p_quantity: qty, p_movement_type: 'adjustment_in',
          p_note: adjNote || 'Entrée stock (CMUP)',
        });
        if (e) throw e;
        const { error: e2 } = await supabase.rpc('recalculate_cmup', {
          p_article_id: adjRow.article_id, p_site_id: targetSite,
          p_new_quantity: qty, p_new_purchase_price: price,
        });
        if (e2) throw e2;
        success('Stock et CMUP mis à jour');
      } else if (adjMode === 'out' && stockMethod === 'lot') {
        if (!qty || qty <= 0) { error('Quantité invalide'); setSaving(false); return; }
        setLotPickerOutRow(adjRow);
        setLotPickerOutQty(qty);
        setAdjOpen(false);
        setSaving(false);
        setLotPickerOutOpen(true);
        return;
      } else {
        if (!qty || qty <= 0) { error('Quantité invalide'); setSaving(false); return; }
        const signedQty = adjMode === 'in' ? qty : -qty;
        const type = adjMode === 'in' ? 'adjustment_in' : 'adjustment_out';
        const { error: e } = await supabase.rpc('adjust_stock', {
          p_article_id: adjRow.article_id, p_site_id: targetSite,
          p_quantity: signedQty, p_movement_type: type,
          p_note: adjNote || (adjMode === 'in' ? 'Entrée stock' : 'Sortie stock'),
        });
        if (e) throw e;
        success('Stock mis à jour');
      }
      setAdjDoneData({ articleName: adjRow.name, articleRef: adjRow.internal_ref, qty: savedQty, type: savedType, label: mvTypeLabel[savedType] || savedType });
      setAdjDone(true);
      // Quick targeted refresh: update only the affected article's stock
      const { data: updatedStk } = await supabase.from('stock_levels').select('article_id, quantity').eq('tenant_id', tenant!.id).eq('site_id', targetSite).eq('article_id', adjRow.article_id).maybeSingle();
      if (updatedStk) {
        setRows(prev => prev.map(r => r.article_id === adjRow.article_id ? { ...r, quantity: Number(updatedStk.quantity) } : r));
      } else {
        setRows(prev => prev.map(r => r.article_id === adjRow.article_id ? { ...r, quantity: 0 } : r));
      }
      // Refresh movements if on that tab
      if (tab === 'movements' && mvSubTab === 'movements') loadMovements(mvPage);
    } catch (e: any) {
      error(e.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  const mvTypeLabel: Record<string, string> = {
    stock_initial: 'Initial', sale: 'Vente', adjustment_in: 'Entrée', adjustment_out: 'Sortie',
    initial: 'Initial', transfer_in: 'Transfert +', transfer_out: 'Transfert -',
    inventory: 'Inventaire', return: 'Retour', purchase: 'Achat',
  };

  const mvTypeColor: Record<string, string> = {
    stock_initial: 'text-slate-600', initial: 'text-slate-600',
    sale: 'text-red-600', adjustment_out: 'text-red-600', transfer_out: 'text-amber-600',
    adjustment_in: 'text-emerald-600', transfer_in: 'text-emerald-600',
    inventory: 'text-neutral-700', purchase: 'text-emerald-600', return: 'text-slate-600',
  };

  return (
    <div className="space-y-3 pb-6">
      {/* ── Page Header ────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-5 lg:-mx-8 px-4 sm:px-5 lg:px-8 pb-2 pt-3 -mt-3 sm:-mt-4 lg:-mt-6 bg-white space-y-1.5 border-b border-neutral-100">

        {/* Row 1: Title + stock value + view toggle + More menu */}
        <div className="flex items-center gap-2">
          {tab === 'lots' && (
            <button onClick={() => setTab('stocks')} className="p-1 -ml-1 text-neutral-400 hover:text-neutral-700 transition-colors shrink-0" aria-label="Retour à l'inventaire">
              <Boxes className="w-5 h-5" />
            </button>
          )}
          <div className="shrink-0">
            <h1 className="text-lg font-bold text-neutral-900 leading-tight">Stock</h1>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-400 mt-0.5">
              {tab === 'movements' ? 'Mouvements' : tab === 'lots' ? 'Lots' : (currentSite?.name || 'Inventaire')}
            </p>
          </div>
          {tab === 'stocks' && (
            <>
              <div className="hidden sm:block w-px h-8 bg-neutral-200 shrink-0" />
              <div className="hidden sm:block flex-1 min-w-0">
                {can('view_purchase_prices') ? (
                  <>
                    <div className="text-xl font-extrabold text-neutral-900 num tracking-tight leading-none truncate">{formatFCFA(totalValue)}</div>
                    <p className="text-[10px] text-neutral-500 mt-0.5">Valeur du stock</p>
                  </>
                ) : (
                  <>
                    <div className="text-xl font-extrabold text-neutral-900 num tracking-tight leading-none">{inStockCount}</div>
                    <p className="text-[10px] text-neutral-500 mt-0.5">Articles en stock</p>
                  </>
                )}
              </div>
            </>
          )}
          {tab !== 'stocks' && <div className="flex-1" />}
          {tab === 'stocks' && <div className="flex-1 sm:hidden" />}
          {can('manage_stock') && tab === 'stocks' && (
            <button
              onClick={() => { if (viewMode === 'list') saveBulkRef.current?.(); setViewMode(v => v === 'cards' ? 'list' : 'cards'); }}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
              aria-label={viewMode === 'cards' ? 'Vue liste' : 'Vue cartes'}
              title={viewMode === 'cards' ? 'Vue liste' : 'Vue cartes'}
            >
              {viewMode === 'cards' ? <List className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}
            </button>
          )}
          {can('manage_stock') && tab === 'stocks' && (
            <MoreMenu items={[
              { icon: <History className="w-4 h-4" />, label: 'Historique des mouvements', onClick: () => { if (viewMode === 'list') saveBulkRef.current?.(); setTab('movements'); } },
              { icon: <BookOpen className="w-4 h-4" />, label: "Livre d'inventaire", onClick: () => { if (viewMode === 'list') saveBulkRef.current?.(); printInventoryBook(); } },
              { icon: <PackageOpen className="w-4 h-4" />, label: 'Voir les lots', onClick: () => { if (viewMode === 'list') saveBulkRef.current?.(); setTab(t => t === 'lots' ? 'stocks' : 'lots'); }, hidden: stockMethod !== 'lot' },
              { icon: <Info className="w-4 h-4" />, label: 'Guide', onClick: () => setHelpOpen(true) },
            ]} />
          )}
          {can('manage_stock') && tab !== 'stocks' && (
            <MoreMenu items={[
              { icon: <Boxes className="w-4 h-4" />, label: 'Inventaire', onClick: () => setTab('stocks') },
              { icon: <History className="w-4 h-4" />, label: 'Mouvements', onClick: () => setTab('movements'), hidden: tab === 'movements' },
              { icon: <PackageOpen className="w-4 h-4" />, label: 'Lots', onClick: () => setTab('lots'), hidden: stockMethod !== 'lot' || tab === 'lots' },
              { icon: <BookOpen className="w-4 h-4" />, label: "Livre d'inventaire", onClick: printInventoryBook },
            ]} />
          )}
          {!can('manage_stock') && (
            <button
              onClick={() => setTab(t => t === 'stocks' ? 'movements' : 'stocks')}
              className={`shrink-0 w-7 h-7 flex items-center justify-center transition-colors ${tab === 'movements' ? 'text-teal-700' : 'text-neutral-400 hover:text-teal-700'}`}
              aria-label="Mouvements"
            >
              <History className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Mobile-only: Stock value on its own line */}
        {tab === 'stocks' && (
          <div className="sm:hidden">
            {can('view_purchase_prices') ? (
              <>
                <div className="text-xl font-extrabold text-neutral-900 num tracking-tight leading-none">{formatFCFA(totalValue)}</div>
                <p className="text-[10px] text-neutral-500 mt-0.5">Valeur du stock</p>
              </>
            ) : (
              <>
                <div className="text-xl font-extrabold text-neutral-900 num tracking-tight leading-none">{inStockCount}</div>
                <p className="text-[10px] text-neutral-500 mt-0.5">Articles en stock</p>
              </>
            )}
          </div>
        )}

        {/* Row 2: Stats badges */}
        <div className="flex items-center gap-2 text-[11px] font-semibold overflow-x-auto no-scrollbar whitespace-nowrap">
          <span className="shrink-0 text-neutral-500 num">{totalCount} article{totalCount > 1 ? 's' : ''}</span>
          {refreshing && <RefreshCw className="w-3 h-3 animate-spin text-neutral-400 shrink-0" />}
          <button
            onClick={() => setFilter('all')}
            className={`shrink-0 transition-colors ${filter === 'all' ? 'text-neutral-900' : 'text-neutral-500 hover:text-neutral-700'}`}
          >Tous</button>
          {inStockCount > 0 && (
            <button
              onClick={() => setFilter(f => f === 'instock' ? 'all' : 'instock')}
              className={`shrink-0 inline-flex items-center gap-1 transition-colors ${filter === 'instock' ? 'text-emerald-700 font-bold' : 'text-neutral-500 hover:text-emerald-700'}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />{inStockCount} En stock
            </button>
          )}
          <button
            onClick={() => setFilter(f => f === 'low' ? 'all' : 'low')}
            disabled={lowCount === 0}
            className={`shrink-0 inline-flex items-center gap-1 transition-colors disabled:opacity-30 ${filter === 'low' ? 'text-amber-700 font-bold' : 'text-neutral-500 hover:text-amber-700'}`}
          >
            <TrendingDown className="w-3 h-3" />{lowCount} seuil bas
          </button>
          <button
            onClick={() => setFilter(f => f === 'out' ? 'all' : 'out')}
            disabled={outCount === 0}
            className={`shrink-0 inline-flex items-center gap-1 transition-colors disabled:opacity-30 ${filter === 'out' ? 'text-red-600 font-bold' : 'text-neutral-500 hover:text-red-600'}`}
          >
            <AlertTriangle className="w-3 h-3" />{outCount} rupture{outCount > 1 ? 's' : ''}
          </button>
        </div>

        {/* Row 4: Search + Category filter */}
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <PageSearch
              value={search}
              onChange={setSearch}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder={tab === 'movements' ? "Rechercher un article…" : "Rechercher un article..."}
            />
          </div>
          {tab === 'stocks' && (
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => setCatPickerOpen(true)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${categoryFilter ? 'bg-blue-50 text-blue-700' : 'text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100'}`}
              >
                <Filter className="w-3.5 h-3.5" />
                {categoryFilter ? (categories.find(c => c.id === categoryFilter)?.name || 'Catégorie') : 'Catégorie'}
              </button>
              {categoryFilter && (
                <button onClick={() => setCategoryFilter('')} className="p-1 rounded-lg text-neutral-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Row 4: Unified operation buttons (stocks tab only) */}
        {can('manage_stock') && tab === 'stocks' && (
          <div className="flex items-center gap-3 overflow-x-auto no-scrollbar whitespace-nowrap">
            <button
              onClick={() => { if (viewMode === 'list') { saveBulkRef.current?.(); setListEditMode('in'); setListEdits(new Map()); } else openAdjNew('in'); }}
              className={`shrink-0 inline-flex items-center gap-1.5 text-[12px] font-semibold transition-all active:scale-95 ${viewMode === 'list' && listEditMode === 'in' ? 'text-emerald-700' : 'text-neutral-700 hover:text-emerald-700'}`}
            >
              <ArrowDownCircle className="w-4 h-4" />Entrée
            </button>
            <button
              onClick={() => { if (viewMode === 'list') { saveBulkRef.current?.(); setListEditMode('out'); setListEdits(new Map()); } else openAdjNew('out'); }}
              className={`shrink-0 inline-flex items-center gap-1.5 text-[12px] font-semibold transition-all active:scale-95 ${viewMode === 'list' && listEditMode === 'out' ? 'text-red-700' : 'text-neutral-700 hover:text-red-700'}`}
            >
              <ArrowUpCircle className="w-4 h-4" />Sortie
            </button>
            {canTransfer && (
              <button
                onClick={() => { if (viewMode === 'list') { saveBulkRef.current?.(); setListEditMode('transfer'); setListEdits(new Map()); } else openAdjNew('transfer'); }}
                className={`shrink-0 inline-flex items-center gap-1.5 text-[12px] font-semibold transition-all active:scale-95 ${viewMode === 'list' && listEditMode === 'transfer' ? 'text-amber-700' : 'text-neutral-700 hover:text-amber-700'}`}
              >
                <ArrowRightLeft className="w-4 h-4" />Transfert
              </button>
            )}
            <button
              onClick={() => { if (viewMode === 'list') { saveBulkRef.current?.(); setListEditMode('inventory'); setListEdits(new Map()); } else openAdjNew('inventory'); }}
              className={`shrink-0 inline-flex items-center gap-1.5 text-[12px] font-semibold transition-all active:scale-95 ${viewMode === 'list' && listEditMode === 'inventory' ? 'text-neutral-900' : 'text-neutral-700 hover:text-neutral-900'}`}
            >
              <ClipboardList className="w-4 h-4" />Inventaire
            </button>
          </div>
        )}

        {/* Sort controls — cards view only (desktop shows inline) */}
        {tab === 'stocks' && viewMode === 'cards' && (
          <div className="flex items-center gap-2.5 text-[10px] font-bold">
            <span className="text-neutral-400">Trier:</span>
            {([['name', 'Nom'], ['stock', 'Qté'], ['min', 'Min'], ['price', 'P.Achat']] as const).map(([col, label]) => (
              <button key={col} onClick={() => { setStkSortCol(col); setStkSortDir(d => stkSortCol === col ? (d === 'asc' ? 'desc' : 'asc') : 'asc'); }}
                className={`inline-flex items-center gap-0.5 transition-colors ${stkSortCol === col ? 'text-neutral-900' : 'text-neutral-500 hover:text-neutral-700'}`}
              >
                {label}
                {stkSortCol === col && (stkSortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === 'stocks' ? (
        (!initialLoaded && loading) ? (
          <div className="py-16 flex justify-center opacity-0 animate-[fadeIn_0.3s_ease_0.4s_forwards]"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Boxes} title="Aucun article" description="Créez des articles dans le module Articles." />
        ) : viewMode === 'list' ? (
          <>
          <StockListEditView
            filtered={rows}
            listEditMode={listEditMode}
            setListEditMode={setListEditMode}
            listEdits={listEdits}
            setListEdits={setListEdits}
            listSaving={listSaving}
            setListSaving={setListSaving}
            listInputRefs={listInputRefs}
            saveBulkRef={saveBulkRef}
            currentSite={currentSite}
            canViewPrices={can('view_purchase_prices')}
            canManageStock={can('manage_stock')}
            onSaved={async (bulkItems?: { ref: string; name: string; quantity: number }[], bulkMode?: string) => {
              if (bulkItems && bulkMode) {
                setBulkDoneItems(bulkItems);
                setBulkDoneMode(bulkMode);
                setBulkDoneOpen(true);
              }
              await load(true);
              setListEdits(new Map());
            }}
            successToast={success}
            errorToast={error}
            stockMethod={stockMethod}
            sites={allTransferTargets}
            depots={depots}
            listTransferTarget={listTransferTarget}
            setListTransferTarget={setListTransferTarget}
            listSourceSite={listSourceSite}
            setListSourceSite={(v: string) => {
              const hasEdits = Array.from(listEdits.values()).some(e => e.qty !== '' && Number(e.qty) !== 0);
              if (hasEdits && v !== listSourceSite) {
                const ownDepots = depots.filter(d => d.parent_site_id === currentSite?.id);
                const newSiteName = v === currentSite?.id
                  ? `${currentSite.name} (Magasin)`
                  : `${ownDepots.find(d => d.id === v)?.name || ''} (Dépôt)`;
                const isDepot = v !== currentSite?.id;
                setPendingSiteChange({ newSiteId: v, newSiteName, isDepot });
                return;
              }
              setListSourceSite(v);
            }}
            stockByLocation={stockByLocation}
            tenantId={tenant!.id}
            sortCol={stkSortCol}
            sortDir={stkSortDir}
            onSort={(col) => { setStkSortCol(col); setStkSortDir(d => stkSortCol === col ? (d === 'asc' ? 'desc' : 'asc') : 'asc'); }}
          />
          {/* Pagination (list mode) */}
          {totalCount > PAGE_SIZE && (
            <div className="flex items-center justify-between px-2 py-3 border-t border-slate-100">
              <span className="text-[11px] text-slate-500">
                {stkPage * PAGE_SIZE + 1}–{Math.min((stkPage + 1) * PAGE_SIZE, totalCount)} sur {totalCount} articles
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => setStkPage(0)} disabled={stkPage === 0} className="px-2 py-1 text-[11px] rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">{'<<'}</button>
                <button onClick={() => setStkPage(p => Math.max(0, p - 1))} disabled={stkPage === 0} className="px-2 py-1 text-[11px] rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"><ChevronLeft className="w-3 h-3" /></button>
                <span className="text-[11px] font-medium text-slate-700 px-2">{stkPage + 1} / {totalPages}</span>
                <button onClick={() => setStkPage(p => p + 1)} disabled={!hasMore} className="px-2 py-1 text-[11px] rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"><ChevronRight className="w-3 h-3" /></button>
                <button onClick={() => setStkPage(totalPages - 1)} disabled={!hasMore} className="px-2 py-1 text-[11px] rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">{'>>'}</button>
              </div>
            </div>
          )}
          </>
        ) : (
          <>
          <div className={`divide-y divide-neutral-100 ${flashKey === 'out' || flashKey === 'low' || flashKey === 'articles' ? 'waarwi-flash waarwi-flash-scroll' : ''}`}>
            {visibleItems.map(r => {
              const out = r.quantity <= 0;
              const low = !out && r.quantity <= r.stock_min;
              const value = r.quantity * r.purchase_price;
              return (
                <div key={r.article_id} className="py-2.5 px-3 transition-colors hover:bg-neutral-50 group">
                  {/* Top row: article name only — full width, no truncation on mobile */}
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold text-neutral-900 leading-tight">{r.name}</div>
                    {r.location && (
                      <div className="flex items-center gap-0.5 mt-0.5 text-[10px] text-neutral-400">
                        <MapPin className="w-2.5 h-2.5" />{r.location}
                      </div>
                    )}
                  </div>
                  {/* Bottom row: quantity + action buttons */}
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className={`text-[14px] font-bold num ${out ? 'text-red-600' : low ? 'text-amber-700' : 'text-neutral-900'}`}>{r.quantity}</span>
                    {can('view_purchase_prices') && <span className="text-[10px] text-neutral-500 num hidden sm:inline">{formatFCFA(value)}</span>}
                    <div className="flex-1" />
                    {can('manage_stock') && (
                    <div className="flex items-center gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openAdj(r, 'in')} className="p-1.5 rounded-lg hover:bg-emerald-50 text-neutral-500 hover:text-emerald-700 transition-colors" title="Entrée"><Plus className="w-3.5 h-3.5" /></button>
                      <button onClick={() => openAdj(r, 'out')} className="p-1.5 rounded-lg hover:bg-red-50 text-neutral-500 hover:text-red-700 transition-colors" title="Sortie"><Minus className="w-3.5 h-3.5" /></button>
                      {canTransfer && <button onClick={() => openAdj(r, 'transfer')} className="p-1.5 rounded-lg hover:bg-amber-50 text-neutral-400 hover:text-amber-700 transition-colors" title="Transfert"><ArrowRightLeft className="w-3.5 h-3.5" /></button>}
                      <button onClick={() => openAdj(r, 'inventory')} className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-neutral-800 transition-colors" title="Inventaire"><ClipboardList className="w-3.5 h-3.5" /></button>
                    </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {/* Pagination */}
          {totalCount > PAGE_SIZE && (
            <div className="flex items-center justify-between px-2 py-3 border-t border-slate-100">
              <span className="text-[11px] text-slate-500">
                {stkPage * PAGE_SIZE + 1}–{Math.min((stkPage + 1) * PAGE_SIZE, totalCount)} sur {totalCount} articles
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => setStkPage(0)} disabled={stkPage === 0} className="px-2 py-1 text-[11px] rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">{'<<'}</button>
                <button onClick={() => setStkPage(p => Math.max(0, p - 1))} disabled={stkPage === 0} className="px-2 py-1 text-[11px] rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"><ChevronLeft className="w-3 h-3" /></button>
                <span className="text-[11px] font-medium text-slate-700 px-2">{stkPage + 1} / {totalPages}</span>
                <button onClick={() => setStkPage(p => p + 1)} disabled={!hasMore} className="px-2 py-1 text-[11px] rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"><ChevronRight className="w-3 h-3" /></button>
                <button onClick={() => setStkPage(totalPages - 1)} disabled={!hasMore} className="px-2 py-1 text-[11px] rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">{'>>'}</button>
              </div>
            </div>
          )}
          </>
        )
      ) : tab === 'movements' ? (
        <>
          {/* Sub-tabs: Mouvements / Documents + period filter */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMvSubTab('movements')}
              className={`text-[11px] font-bold inline-flex items-center gap-1.5 transition-colors ${mvSubTab === 'movements' ? 'text-emerald-700' : 'text-neutral-500 hover:text-neutral-700'}`}
            >
              <History className="w-3.5 h-3.5" />Mouvements
            </button>
            <button
              onClick={() => setMvSubTab('documents')}
              className={`text-[11px] font-bold inline-flex items-center gap-1.5 transition-colors ${mvSubTab === 'documents' ? 'text-emerald-700' : 'text-neutral-500 hover:text-neutral-700'}`}
            >
              <ClipboardList className="w-3.5 h-3.5" />Documents
            </button>
            <div className="flex-1" />
            <button
              onClick={() => setMvPickerOpen(true)}
              className={`shrink-0 inline-flex items-center gap-1.5 text-[11px] font-semibold transition-colors ${
                (mvDateFrom || mvDateTo) ? 'text-brand-700' : 'text-neutral-500 hover:text-neutral-700'
              }`}
              title="Filtrer par période"
            >
              <Calendar className="w-3.5 h-3.5" />
              {(mvDateFrom || mvDateTo) ? (
                <span className="num max-w-[120px] truncate">
                  {mvDateFrom ? new Date(mvDateFrom).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '…'}
                  {' → '}
                  {mvDateTo ? new Date(mvDateTo).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '…'}
                </span>
              ) : (
                <span>Période</span>
              )}
            </button>
          </div>

          {/* Shared site selector for movements & documents */}
          {(() => {
            const ownDepots = depots.filter(d => d.parent_site_id === currentSite?.id);
            if (ownDepots.length === 0) return null;
            return (
              <div className="flex items-center gap-2 pb-1">
                <MapPin className="w-3 h-3 text-neutral-400 shrink-0" />
                <div className="relative flex-1 min-w-0">
                  <select
                    value={mvSiteId}
                    onChange={e => {
                      const newId = e.target.value;
                      setMvSiteId(newId);
                      setMvPage(1);
                      try {
                        if (tenant?.id && profile?.id) {
                          localStorage.setItem(`mvSiteId:${tenant.id}:${profile.id}`, newId);
                        }
                      } catch {}
                    }}
                    className="bare-input text-[11px] font-semibold py-1 w-full pr-5"
                  >
                    <option value="">Tous les emplacements</option>
                    {currentSite && <option value={currentSite.id}>{currentSite.name} (Magasin)</option>}
                    {ownDepots.map(d => (
                      <option key={d.id} value={d.id}>{d.name} (Dépôt)</option>
                    ))}
                  </select>
                  <ChevronDown className="w-3 h-3 text-neutral-400 absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
            );
          })()}

          {mvSubTab === 'movements' ? (
          <>
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
            <span className="shrink-0 text-neutral-500 num">{mvTotalCount} mouvement{mvTotalCount > 1 ? 's' : ''}</span>
            {search && tab === 'movements' && (
              <span className="shrink-0 text-blue-600 inline-flex items-center gap-1 normal-case tracking-normal text-[10px]">
                Filtre: "{search}"
              </span>
            )}
            {(mvDateFrom || mvDateTo) && (
              <span className="shrink-0 text-brand-700 inline-flex items-center gap-1 normal-case tracking-normal num text-[10px]">
                <Calendar className="w-3 h-3" />
                {mvDateFrom ? new Date(mvDateFrom).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '…'}
                {' → '}
                {mvDateTo ? new Date(mvDateTo).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '…'}
                <button onClick={() => { setMvDateFrom(''); setMvDateTo(''); setMvPage(1); }} className="ml-0.5 hover:text-brand-900"><X className="w-3 h-3" /></button>
              </span>
            )}
          </div>

          {mvLoading ? (
            <div className="py-12 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-brand-700" /></div>
          ) : filteredMoves.length === 0 ? (
            <EmptyState icon={History} title={(mvDateFrom || mvDateTo || search) ? 'Aucun mouvement trouvé' : 'Aucun mouvement'} description={(mvDateFrom || mvDateTo || search) ? 'Essayez une autre période ou un autre article.' : 'Les mouvements de stock apparaîtront ici après chaque opération.'} />
          ) : (
          <>
          <div className={`divide-y divide-neutral-100 ${flashKey === 'stockIn' ? 'waarwi-flash waarwi-flash-scroll' : ''}`}>
            {filteredMoves.map(m => {
              const qty = Number(m.quantity);
              const positive = qty >= 0;
              const isTransfer = m.movement_type === 'transfer_out' || m.movement_type === 'transfer_in';
              const doc = m.stock_documents as any;
              const transferFrom = isTransfer ? findSiteName(doc?.site_id) : '';
              const transferTo = isTransfer ? findSiteName(doc?.dest_site_id) : '';
              const mvSiteName = mvSiteId
                ? findSiteName(m.site_id)
                : findSiteName(m.site_id);
              return (
                <div key={m.id} className="flex items-center gap-2.5 px-1 py-3 transition-colors">
                  <div className={`shrink-0 ${
                    positive ? 'text-emerald-600' : 'text-red-600'
                  }`}>
                    {positive ? <ArrowDownCircle className="w-4 h-4" /> : <ArrowUpCircle className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-1.5 flex-wrap">
                      <span className="text-[12px] font-semibold text-neutral-900 break-words min-w-0">{(m.articles as any)?.name}</span>
                      <span className={`shrink-0 text-[9px] font-bold uppercase tracking-wider ${mvTypeColor[m.movement_type] || 'text-neutral-600'}`}>
                        {isTransfer
                          ? (m.movement_type === 'transfer_out' ? 'Transfert sortant' : 'Transfert entrant')
                          : (mvTypeLabel[m.movement_type] || m.movement_type)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-neutral-500">
                      <span className="font-mono truncate">{(m.articles as any)?.internal_ref}</span>
                      <span className="shrink-0">·</span>
                      <span className="shrink-0 num">{formatDateTime(m.created_at)}</span>
                    </div>
                    {isTransfer ? (
                      <div className="text-[10px] text-neutral-500 mt-0.5 break-words">
                        <span className="truncate">{transferFrom}</span>
                        <span className="shrink-0"> → </span>
                        <span className="truncate">{transferTo}</span>
                        {doc?.doc_number && <span className="shrink-0 font-mono ml-1">{doc.doc_number}</span>}
                      </div>
                    ) : mvSiteName ? (
                      <div className="text-[10px] text-neutral-500 mt-0.5 break-words">{mvSiteName}</div>
                    ) : null}
                    {m.note && <div className="text-[10px] text-neutral-400 break-words mt-0.5">{m.note}</div>}
                  </div>
                  <div className="text-right shrink-0 flex items-center gap-2">
                    <div>
                      <div className={`text-[13px] font-bold num ${positive ? 'text-emerald-700' : 'text-red-600'}`}>
                        {positive ? '+' : ''}{qty}
                      </div>
                      <div className="text-[9px] text-neutral-400 num mt-0.5">{m.previous_qty} → {m.new_qty}</div>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <button onClick={() => printMovement(m, 'a4')} className="w-6 h-6 flex items-center justify-center text-neutral-400 hover:text-neutral-700 transition-colors" title="Imprimer A4">
                        <Printer className="w-3 h-3" />
                      </button>
                      <button onClick={() => printMovement(m, '80')} className="w-6 h-6 flex items-center justify-center text-neutral-400 hover:text-neutral-700 transition-colors" title="Imprimer 80mm">
                        <Scroll className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Movements pagination */}
          {mvTotalPages > 1 && (
            <div className="flex items-center justify-between py-3 border-t border-neutral-100">
              <span className="text-[11px] text-neutral-500">
                {((mvPage - 1) * MV_PAGE_SIZE) + 1}–{Math.min(mvPage * MV_PAGE_SIZE, mvTotalCount)} sur {mvTotalCount}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => setMvPage(1)} disabled={mvPage === 1} className="px-2 py-1 text-[11px] rounded hover:bg-neutral-100 disabled:opacity-30 disabled:cursor-not-allowed">{'<<'}</button>
                <button onClick={() => setMvPage(p => Math.max(1, p - 1))} disabled={mvPage === 1} className="px-2 py-1 text-[11px] rounded hover:bg-neutral-100 disabled:opacity-30 disabled:cursor-not-allowed">{'<'}</button>
                <span className="text-[11px] font-medium text-neutral-700 px-2">{mvPage} / {mvTotalPages}</span>
                <button onClick={() => setMvPage(p => Math.min(mvTotalPages, p + 1))} disabled={mvPage === mvTotalPages} className="px-2 py-1 text-[11px] rounded hover:bg-neutral-100 disabled:opacity-30 disabled:cursor-not-allowed">{'>'}</button>
                <button onClick={() => setMvPage(mvTotalPages)} disabled={mvPage === mvTotalPages} className="px-2 py-1 text-[11px] rounded hover:bg-neutral-100 disabled:opacity-30 disabled:cursor-not-allowed">{'>>'}</button>
              </div>
            </div>
          )}
          </>
          )}
          </>
          ) : (
          /* ─────────── Documents sub-section ─────────── */
          <>
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider overflow-x-auto no-scrollbar whitespace-nowrap">
            <span className="shrink-0 text-neutral-500 num">
              {(() => { const sq = search.toLowerCase().trim(); return stockDocs.filter(d => { if (docsTypeFilter !== 'all' && d.doc_type !== docsTypeFilter) return false; if (sq) return d.doc_number.toLowerCase().includes(sq) || (d.note || '').toLowerCase().includes(sq); return true; }).length; })() } / {stockDocs.length}
            </span>
            {(['all', 'entry', 'exit', 'transfer', 'inventory'] as const).map(k => {
              const labels: Record<string, string> = { all: 'Tous', entry: 'Entrées', exit: 'Sorties', transfer: 'Transferts', inventory: 'Inventaires' };
              const active = docsTypeFilter === k;
              return (
                <button key={k}
                  onClick={() => setDocsTypeFilter(k)}
                  className={`shrink-0 inline-flex items-center gap-1 transition-colors ${active ? 'text-neutral-900 font-bold' : 'text-neutral-500 hover:text-neutral-700'}`}
                >{labels[k]}</button>
              );
            })}
          </div>

          {(() => {
            const sq = search.toLowerCase().trim();
            const filtered = stockDocs.filter(d => {
              if (docsTypeFilter !== 'all' && d.doc_type !== docsTypeFilter) return false;
              if (sq) return d.doc_number.toLowerCase().includes(sq) || (d.note || '').toLowerCase().includes(sq);
              return true;
            });
            if (filtered.length === 0) {
              return <EmptyState icon={ClipboardList} title="Aucun document" description="Les documents de stock (opérations en masse) apparaîtront ici." />;
            }
            return (
              <div className="divide-y divide-neutral-100">
                {filtered.map(d => {
                  const meta = docTypeMeta[d.doc_type] || { label: d.doc_type, color: 'text-neutral-600', mvType: '' };
                  const cancelled = d.status === 'cancelled';
                  return (
                    <div key={d.id} className={`flex items-center gap-2.5 px-1 py-3 transition-colors ${cancelled ? 'opacity-60' : ''}`}>
                      <div className={`shrink-0 ${meta.color}`}>
                        <ClipboardList className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-1.5 flex-wrap">
                          <span className="text-[12px] font-semibold text-neutral-900 break-words min-w-0 num">{d.doc_number}</span>
                          <span className={`shrink-0 text-[9px] font-bold uppercase tracking-wider ${meta.color}`}>
                            {meta.label}
                          </span>
                          {cancelled && (
                            <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-red-600">Annulé</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-neutral-500 flex-wrap">
                          <span className="num">{d.line_count} ligne{d.line_count > 1 ? 's' : ''}</span>
                          <span>·</span>
                          <span className="num">Total: {Number(d.total_qty).toLocaleString('fr-FR')}</span>
                          <span>·</span>
                          <span className="num">{formatDateTime(d.created_at)}</span>
                          {d.dest_site_id && (<><span>·</span><span className="truncate">{findSiteName(d.site_id)} → {findSiteName(d.dest_site_id)}</span></>)}
                        </div>
                        {d.note && <div className="text-[10px] text-neutral-400 break-words mt-0.5">{d.note}</div>}
                      </div>
                      <div className="shrink-0 flex items-center gap-1">
                        <button onClick={() => openDocDetail(d)} className="w-7 h-7 flex items-center justify-center text-neutral-500 hover:text-neutral-800 transition-colors" title="Détails">
                          <Info className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => reprintDocFromList(d, 'a4')} className="w-7 h-7 flex items-center justify-center text-neutral-500 hover:text-neutral-800 transition-colors" title="Imprimer A4">
                          <Printer className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => reprintDocFromList(d, '80')} className="w-7 h-7 flex items-center justify-center text-neutral-500 hover:text-neutral-800 transition-colors" title="Imprimer 80mm">
                          <Scroll className="w-3.5 h-3.5" />
                        </button>
                        {!cancelled && can('manage_stock') && d.doc_type !== 'transfer' && (
                          <button onClick={() => openDocEdit(d)} className="w-7 h-7 flex items-center justify-center text-neutral-500 hover:text-neutral-800 transition-colors" title="Éditer (régénère le stock)">
                            <Save className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {!cancelled && can('manage_stock') && (
                          <button onClick={() => setDocDeleteConfirm(d)} className="w-7 h-7 flex items-center justify-center text-neutral-400 hover:text-red-600 transition-colors" title="Annuler (régénère le stock)">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
          </>
          )}
        </>
      ) : null}

      {tab === 'lots' && (
        <LotsView lots={lots} stockMethod={stockMethod} />
      )}

      <PremiumDateRangePicker
        open={mvPickerOpen}
        onClose={() => setMvPickerOpen(false)}
        from={mvDateFrom}
        to={mvDateTo}
        onApply={(f, t) => { setMvDateFrom(f); setMvDateTo(t); setMvPage(1); setMvPickerOpen(false); }}
      />

      {/* Adjust modal */}
      <Modal open={adjOpen} onClose={() => { setAdjOpen(false); setAdjDone(false); }}
        title={adjDone ? 'Opération effectuée' : { in: 'Entrée de stock', out: 'Sortie de stock', transfer: 'Transfert de stock', inventory: 'Saisie d\'inventaire' }[adjMode]}
        size="sm"
        fullscreenMobile
        footer={adjDone ? (
          <div className="flex items-center gap-2 w-full">
            <button onClick={() => { setAdjOpen(false); setAdjDone(false); }} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>
            <div className="flex-1" />
            <button
              onClick={() => {
                if (!adjDoneData || !currentSite) return;
                const now = new Date();
                printStockMovement80({
                  tenant: tenantPrint, movementType: adjDoneData.type, movementLabel: adjDoneData.label,
                  reference: `MVT-${now.getTime().toString(36).toUpperCase().slice(-8)}`,
                  date: now.toLocaleString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
                  user: profile?.full_name || profile?.email || '', siteName: currentSite.name,
                  items: [{ ref: adjDoneData.articleRef, name: adjDoneData.articleName, quantity: adjDoneData.qty }],
                  observation: adjNote || undefined,
                });
              }}
              className="btn-icon" title="Imprimer 80mm"
            >
              <Scroll className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                if (!adjDoneData || !currentSite) return;
                const now = new Date();
                printStockMovementA4({
                  tenant: tenantPrint, movementType: adjDoneData.type, movementLabel: adjDoneData.label,
                  reference: `MVT-${now.getTime().toString(36).toUpperCase().slice(-8)}`,
                  date: now.toLocaleString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
                  user: profile?.full_name || profile?.email || '', siteName: currentSite.name,
                  items: [{ ref: adjDoneData.articleRef, name: adjDoneData.articleName, quantity: adjDoneData.qty }],
                  observation: adjNote || undefined,
                });
              }}
              className="btn-icon-primary" title="Imprimer A4"
            >
              <Printer className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <><button onClick={() => setAdjOpen(false)} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button><button onClick={saveAdj} disabled={saving} className="btn-icon-primary" title="Valider">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}</button></>
        )}
      >
        {adjDone && adjDoneData ? (
          <div className="py-4 text-center space-y-3">
            <div className="w-14 h-14 mx-auto rounded-full bg-emerald-50 border-2 border-emerald-200 flex items-center justify-center">
              <Check className="w-7 h-7 text-emerald-600" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900">{adjDoneData.articleName}</div>
              <div className="text-xs text-slate-500 mt-0.5">{adjDoneData.label} : {adjDoneData.qty} unité{adjDoneData.qty > 1 ? 's' : ''}</div>
            </div>
            <p className="text-[11px] text-slate-400">Vous pouvez imprimer le bon de mouvement.</p>
          </div>
        ) : adjRow && (
          <div className="space-y-4">
            <div>
              <div className="text-sm font-bold text-slate-900">{adjRow.name}</div>
              <div className="text-[11px] text-slate-400 font-mono mt-0.5">{adjRow.internal_ref}</div>
              <div className="text-[11px] text-slate-500 mt-1">Stock actuel : <span className="font-bold num text-slate-700">{adjRow.quantity}</span></div>
            </div>

            {adjMode !== 'transfer' && depots.filter(d => d.parent_site_id === currentSite?.id).length > 0 && (
              <div>
                <label className="label">Emplacement</label>
                <div className="relative">
                  <select
                    value={adjSiteId}
                    onChange={e => setAdjSiteId(e.target.value)}
                    className="bare-input text-sm py-2 w-full pr-6"
                  >
                    {currentSite && <option value={currentSite.id}>{currentSite.name} (Magasin)</option>}
                    {depots.filter(d => d.parent_site_id === currentSite?.id).map(d => (
                      <option key={d.id} value={d.id}>{d.name} (Dépôt)</option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-neutral-400 absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
                <div className="h-px bg-neutral-200 mt-1" />
              </div>
            )}

            <div>
              <label className="label">Article</label>
              <SearchableSelect
                options={rows.map(r => ({ value: r.article_id, label: r.name, sublabel: r.internal_ref }))}
                value={adjRow?.article_id || ''}
                onChange={v => { const r = rows.find(x => x.article_id === v); if (r) { setAdjRow(r); setAdjInventoryQty(r.quantity); } }}
                placeholder="Rechercher un article..."
                noBorder
              />
              <div className="h-px bg-neutral-200 mt-1" />
            </div>

            {adjMode === 'inventory' ? (
              <div>
                <label className="label">Quantité réelle comptée</label>
                <input type="number" min={0} value={adjInventoryQty} onChange={e => setAdjInventoryQty(e.target.value === '' ? '' : Number(e.target.value))} className="bare-input text-lg font-semibold py-2" autoFocus={desktopAutoFocus} />
                <div className="h-px bg-neutral-200 mt-1" />
                {adjInventoryQty !== '' && <p className="text-xs mt-1 text-slate-500">Écart : {Number(adjInventoryQty) - adjRow.quantity > 0 ? '+' : ''}{Number(adjInventoryQty) - adjRow.quantity}</p>}
              </div>
            ) : adjMode === 'transfer' ? (
              <>
                <div>
                  <label className="label">Source</label>
                  <div className="relative">
                    <select
                      value={adjSiteId}
                      onChange={e => setAdjSiteId(e.target.value)}
                      className="bare-input text-sm py-2 w-full pr-6"
                    >
                      {currentSite && <option value={currentSite.id}>{currentSite.name} (Magasin)</option>}
                      {depots.filter(d => d.parent_site_id === currentSite?.id).map(d => (
                        <option key={d.id} value={d.id}>{d.name} (Dépôt)</option>
                      ))}
                    </select>
                    <ChevronDown className="w-4 h-4 text-neutral-400 absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                  <div className="h-px bg-neutral-200 mt-1" />
                </div>
                <div>
                  <label className="label">Destination</label>
                  <SearchableSelect
                    options={allTransferTargets
                      .filter(s => s.id !== adjSiteId)
                      .map(s => ({ value: s.id, label: `${s.name}${s.is_warehouse ? ' (Dépôt)' : ' (Magasin)'}` }))}
                    value={adjTargetSite}
                    onChange={v => setAdjTargetSite(v)}
                    placeholder="— Choisir —"
                    searchable={false}
                    noBorder
                  />
                  <div className="h-px bg-neutral-200 mt-1" />
                </div>
                <div>
                  <label className="label">Quantité à transférer</label>
                  <input type="number" min={1} value={adjQty} onChange={e => setAdjQty(e.target.value === '' ? '' : Number(e.target.value))} className="bare-input text-sm py-2" autoFocus={desktopAutoFocus} />
                  <div className="h-px bg-neutral-200 mt-1" />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="label">Quantité</label>
                  <input type="number" min={1} value={adjQty} onChange={e => setAdjQty(e.target.value === '' ? '' : Number(e.target.value))} className="bare-input text-lg font-semibold py-2" autoFocus={desktopAutoFocus} />
                  <div className="h-px bg-neutral-200 mt-1" />
                </div>
                {adjMode === 'in' && stockMethod === 'lot' && (
                  <>
                    <div>
                      <label className="label">N° de lot *</label>
                      <input value={adjBatchNumber} onChange={e => setAdjBatchNumber(e.target.value)} className="bare-input text-sm py-2" placeholder="Ex: LOT-2026-001" />
                      <div className="h-px bg-neutral-200 mt-1" />
                    </div>
                    <div>
                      <label className="label">Date de péremption</label>
                      <input type="date" value={adjExpiryDate} onChange={e => setAdjExpiryDate(e.target.value)} className="bare-input text-sm py-2" />
                      <div className="h-px bg-neutral-200 mt-1" />
                    </div>
                    <div>
                      <label className="label">Prix d'achat (lot)</label>
                      <input type="number" min={0} value={adjPurchasePrice} onChange={e => setAdjPurchasePrice(e.target.value === '' ? '' : Number(e.target.value))} className="bare-input text-sm py-2" placeholder="FCFA" />
                      <div className="h-px bg-neutral-200 mt-1" />
                    </div>
                  </>
                )}
                {adjMode === 'in' && stockMethod === 'cmup' && (
                  <div>
                    <label className="label">Prix d'achat (cette entrée)</label>
                    <input type="number" min={0} value={adjPurchasePrice} onChange={e => setAdjPurchasePrice(e.target.value === '' ? '' : Number(e.target.value))} className="bare-input text-sm py-2" placeholder="FCFA" />
                    <div className="h-px bg-neutral-200 mt-1" />
                    <p className="text-[10px] text-slate-500 mt-1">Le CMUP sera recalculé automatiquement</p>
                  </div>
                )}
              </>
            )}

            <div>
              <label className="label">Note / motif</label>
              <input value={adjNote} onChange={e => setAdjNote(e.target.value)} className="bare-input text-sm py-2" placeholder="Achat, retour, perte, correction…" />
              <div className="h-px bg-neutral-200 mt-1" />
            </div>
          </div>
        )}
      </Modal>

      {/* Bulk operation success modal with print */}
      <Modal open={bulkDoneOpen} onClose={() => setBulkDoneOpen(false)}
        title="Opération en masse effectuée"
        size="sm"
        footer={
          <div className="flex items-center gap-2 w-full">
            <button onClick={() => setBulkDoneOpen(false)} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>
            <div className="flex-1" />
            <button
              onClick={() => {
                const now = new Date();
                printStockMovement80({
                  tenant: tenantPrint, movementType: bulkDoneMode,
                  movementLabel: bulkDoneMode === 'adjustment_in' ? 'Entrée (masse)' : bulkDoneMode === 'adjustment_out' ? 'Sortie (masse)' : bulkDoneMode === 'transfer_out' ? 'Transfert (masse)' : 'Inventaire (masse)',
                  reference: `BULK-${now.getTime().toString(36).toUpperCase().slice(-8)}`,
                  date: now.toLocaleString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
                  user: profile?.full_name || profile?.email || '', siteName: currentSite?.name || '',
                  items: bulkDoneItems,
                });
              }}
              className="btn-icon" title="Imprimer 80mm"
            >
              <Scroll className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                const now = new Date();
                printStockMovementA4({
                  tenant: tenantPrint, movementType: bulkDoneMode,
                  movementLabel: bulkDoneMode === 'adjustment_in' ? 'Entrée (masse)' : bulkDoneMode === 'adjustment_out' ? 'Sortie (masse)' : bulkDoneMode === 'transfer_out' ? 'Transfert (masse)' : 'Inventaire (masse)',
                  reference: `BULK-${now.getTime().toString(36).toUpperCase().slice(-8)}`,
                  date: now.toLocaleString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
                  user: profile?.full_name || profile?.email || '', siteName: currentSite?.name || '',
                  items: bulkDoneItems,
                });
              }}
              className="btn-icon-primary" title="Imprimer A4"
            >
              <Printer className="w-4 h-4" />
            </button>
          </div>
        }
      >
        <div className="py-4 text-center space-y-3">
          <div className="w-14 h-14 mx-auto rounded-full bg-emerald-50 border-2 border-emerald-200 flex items-center justify-center">
            <Check className="w-7 h-7 text-emerald-600" />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-900">
              {bulkDoneItems.length} article{bulkDoneItems.length > 1 ? 's' : ''} mis à jour
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {bulkDoneMode === 'adjustment_in' ? 'Entrée (masse)' : bulkDoneMode === 'adjustment_out' ? 'Sortie (masse)' : bulkDoneMode === 'transfer_out' ? 'Transfert (masse)' : 'Inventaire (masse)'}
            </div>
          </div>
          {bulkDoneItems.length <= 10 && (
            <div className="text-left mt-3 space-y-1 max-h-40 overflow-y-auto">
              {bulkDoneItems.map((item, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-50 text-[11px]">
                  <span className="font-semibold text-slate-800 truncate mr-2">{item.name}</span>
                  <span className="shrink-0 font-bold text-slate-600 num">{item.quantity}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-slate-400">Vous pouvez imprimer le bon de mouvement groupé.</p>
        </div>
      </Modal>

      {/* Inventory book — choose location */}
      <Modal
        open={invBookOpen}
        onClose={() => setInvBookOpen(false)}
        title="Livre d'inventaire — Choisir l'emplacement"
        size="sm"
        footer={
          <div className="flex items-center gap-1">
            <button
              onClick={() => setInvBookOpen(false)}
              className="inline-flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded transition-colors"
            >
              <X className="w-4 h-4" />
              <span>Annuler</span>
            </button>
            <button
              onClick={() => { if (invBookScope) { runPrintInventoryBook(invBookScope); setInvBookOpen(false); } }}
              disabled={!invBookScope}
              className="inline-flex items-center gap-1.5 px-2 py-1.5 text-xs font-bold text-neutral-900 hover:bg-neutral-100 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Printer className="w-4 h-4" />
              <span>Imprimer</span>
            </button>
          </div>
        }
      >
        <div>
          <p className="text-[11px] text-neutral-500 px-1 pb-3">Choisissez l'emplacement à imprimer. « Tous les emplacements » génère une page par dépôt.</p>
          <div className="divide-y divide-neutral-100">
            <button
              onClick={() => setInvBookScope('all')}
              className="w-full flex items-center justify-between py-3 px-1 text-left transition-colors hover:bg-neutral-50"
            >
              <div className="min-w-0">
                <div className={`text-xs ${invBookScope === 'all' ? 'font-bold text-neutral-900' : 'font-medium text-neutral-700'}`}>Tous les emplacements</div>
                <div className="text-[10px] text-neutral-400">{1 + depots.filter(d => d.parent_site_id === currentSite?.id).length} livre(s) — un par emplacement</div>
              </div>
              {invBookScope === 'all' && <Check className="w-4 h-4 text-neutral-900 shrink-0" />}
            </button>
            {currentSite && (
              <button
                onClick={() => setInvBookScope(currentSite.id)}
                className="w-full flex items-center justify-between py-3 px-1 text-left transition-colors hover:bg-neutral-50"
              >
                <div className="min-w-0">
                  <div className={`text-xs ${invBookScope === currentSite.id ? 'font-bold text-neutral-900' : 'font-medium text-neutral-700'}`}>{currentSite.name}</div>
                  <div className="text-[10px] text-neutral-400">Magasin principal</div>
                </div>
                {invBookScope === currentSite.id && <Check className="w-4 h-4 text-neutral-900 shrink-0" />}
              </button>
            )}
            {depots.filter(d => d.parent_site_id === currentSite?.id).map(d => (
              <button
                key={d.id}
                onClick={() => setInvBookScope(d.id)}
                className="w-full flex items-center justify-between py-3 px-1 text-left transition-colors hover:bg-neutral-50"
              >
                <div className="min-w-0">
                  <div className={`text-xs ${invBookScope === d.id ? 'font-bold text-neutral-900' : 'font-medium text-neutral-700'}`}>{d.name}</div>
                  <div className="text-[10px] text-neutral-400">Dépôt</div>
                </div>
                {invBookScope === d.id && <Check className="w-4 h-4 text-neutral-900 shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      </Modal>

      {/* Stock document detail */}
      <Modal
        open={docDetailOpen}
        onClose={() => { setDocDetailOpen(false); setDocDetailDoc(null); setDocDetailLines([]); }}
        title={docDetailDoc ? `Document ${docDetailDoc.doc_number}` : 'Document'}
        size="md"
        footer={docDetailDoc ? (
          <>
            <button onClick={() => { setDocDetailOpen(false); setDocDetailDoc(null); setDocDetailLines([]); }} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>
            <div className="flex-1" />
            <button onClick={() => printStockDoc(docDetailDoc, docDetailLines, '80')} className="btn-icon" title="Imprimer 80mm">
              <Scroll className="w-4 h-4" />
            </button>
            <button onClick={() => printStockDoc(docDetailDoc, docDetailLines, 'a4')} className="btn-icon-primary" title="Imprimer A4">
              <Printer className="w-4 h-4" />
            </button>
          </>
        ) : null}
      >
        {docDetailDoc && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-[11px] py-2 border-b border-neutral-100">
              <span className="font-bold text-neutral-900">{docTypeMeta[docDetailDoc.doc_type]?.label || docDetailDoc.doc_type}</span>
              <span className="text-neutral-400">·</span>
              <span className="font-semibold text-neutral-700 num">{formatDateTime(docDetailDoc.created_at)}</span>
              <span className="text-neutral-400">·</span>
              <span className="font-semibold text-neutral-700">{findSiteName(docDetailDoc.site_id)}{docDetailDoc.dest_site_id ? ` → ${findSiteName(docDetailDoc.dest_site_id)}` : ''}</span>
            </div>
            {docDetailDoc.note && (
              <div className="text-[11px] text-neutral-500 py-1">{docDetailDoc.note}</div>
            )}
            {docDetailLoading ? (
              <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-brand-700" /></div>
            ) : (
              <div className="divide-y divide-neutral-100">
                {docDetailLines
                  .filter(l => docDetailDoc.doc_type !== 'transfer' || l.movement_type === 'transfer_out')
                  .map((l, i) => (
                  <div key={l.id} className="flex items-center gap-2 py-2.5 text-[11px]">
                    <div className="w-5 h-5 flex items-center justify-center text-[9px] font-bold text-neutral-400 num shrink-0">{i + 1}</div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-neutral-900 truncate">{(l.articles as any)?.name}</div>
                      <div className="text-[10px] text-neutral-500 font-mono truncate">{(l.articles as any)?.internal_ref}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold text-neutral-900 num">{Math.abs(Number(l.quantity))}</div>
                      <div className="text-[9px] text-neutral-400 num">{l.previous_qty} → {l.new_qty}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Stock document edit (regenerate stock) */}
      <Modal
        open={docEditOpen}
        onClose={() => { if (!docEditSaving) { setDocEditOpen(false); setDocEditDoc(null); } }}
        title={docEditDoc ? `Éditer ${docEditDoc.doc_number}` : 'Éditer document'}
        size="md"
        footer={docEditDoc ? (
          <>
            <button onClick={() => setDocEditOpen(false)} disabled={docEditSaving} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
            <div className="flex-1" />
            <button onClick={saveDocEdit} disabled={docEditSaving} className="btn-icon-primary" title="Enregistrer & régénérer">
              {docEditSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            </button>
          </>
        ) : null}
      >
        {docEditDoc && (
          <div className="space-y-3">
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-2.5 text-[11px] text-amber-900 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                Modifier ce document <strong>annule</strong> les mouvements existants et <strong>régénère</strong> le stock avec les nouvelles quantités. L'historique reste lié au document.
              </div>
            </div>
            <div>
              <label className="label">Note du document</label>
              <input value={docEditNote} onChange={e => setDocEditNote(e.target.value)} className="bare-input text-sm py-2" placeholder="Note globale" />
              <div className="h-px bg-neutral-200 mt-1" />
            </div>
            <div className="divide-y divide-neutral-100">
              {docEditEntries.map((entry, idx) => (
                <div key={entry.article_id} className="flex items-center gap-2 py-2.5 text-[11px]">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-neutral-900 truncate">{entry.article_name}</div>
                    <div className="text-[10px] text-neutral-500 font-mono truncate">{entry.article_ref}</div>
                  </div>
                  <input
                    type="number" step="any" inputMode="decimal"
                    value={entry.quantity}
                    onChange={e => {
                      const v = e.target.value === '' ? '' : Number(e.target.value);
                      setDocEditEntries(prev => prev.map((p, i) => i === idx ? { ...p, quantity: v } : p));
                    }}
                    className="bare-input w-24 text-right num text-sm py-1"
                  />
                  <button
                    onClick={() => setDocEditEntries(prev => prev.filter((_, i) => i !== idx))}
                    className="w-6 h-6 flex items-center justify-center text-red-500 hover:text-red-700 transition-colors"
                    title="Retirer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {docEditEntries.length === 0 && (
                <div className="py-3 text-[11px] text-neutral-500 text-center">Aucune ligne -- ajoutez au moins une quantite.</div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Confirm cancel document */}
      <Modal
        open={!!docDeleteConfirm}
        onClose={() => { if (!docDeleting) setDocDeleteConfirm(null); }}
        title="Annuler ce document ?"
        size="sm"
        footer={
          <>
            <button onClick={() => setDocDeleteConfirm(null)} disabled={docDeleting} className="btn-icon" title="Non"><X className="w-4 h-4" /></button>
            <div className="flex-1" />
            <button
              onClick={() => docDeleteConfirm && cancelDoc(docDeleteConfirm)}
              disabled={docDeleting}
              className="btn-icon-danger-solid" title="Oui, annuler & régénérer"
            >
              {docDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </button>
          </>
        }
      >
        {docDeleteConfirm && (
          <div className="space-y-2 text-[12px] text-slate-700">
            <p>Le document <strong className="num">{docDeleteConfirm.doc_number}</strong> ({docTypeMeta[docDeleteConfirm.doc_type]?.label}) sera marqué comme annulé.</p>
            <p>Les <strong>{docDeleteConfirm.line_count}</strong> mouvements liés seront supprimés et le stock <strong>régénéré</strong> à l'état antérieur.</p>
            <div className="rounded-xl bg-red-50 border border-red-200 p-2.5 text-[11px] text-red-900 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Cette action est irréversible. Les niveaux de stock seront recalculés immédiatement.</span>
            </div>
          </div>
        )}
      </Modal>

      {/* Help/Guide modal */}
      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title="Guide de gestion du stock" size="md" fullscreenMobile>
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <HelpSection icon={<ArrowDownCircle className="w-4 h-4 text-emerald-600" />} title="Entrée de stock" color="emerald">
            Enregistre une réception de marchandise (achat, retour fournisseur, production). Le stock de l'article augmente de la quantité saisie.
          </HelpSection>
          <HelpSection icon={<ArrowUpCircle className="w-4 h-4 text-red-500" />} title="Sortie de stock" color="red">
            Enregistre une sortie manuelle (perte, casse, don, consommation interne). Le stock diminue de la quantité saisie. Les ventes déduisent automatiquement le stock.
          </HelpSection>
          {canTransfer && (
            <HelpSection icon={<ArrowRightLeft className="w-4 h-4 text-amber-600" />} title="Transfert" color="amber">
              Déplace une quantité d'un dépôt/site vers un autre. Le stock sort du site d'origine et entre dans le site de destination. Utile pour équilibrer les stocks entre magasins.
            </HelpSection>
          )}
          <HelpSection icon={<ClipboardList className="w-4 h-4 text-neutral-700" />} title="Inventaire" color="slate">
            Permet de corriger le stock réel après un comptage physique. Vous saisissez la quantité réellement comptée et le système calcule automatiquement l'écart (positif ou négatif).
          </HelpSection>
          <HelpSection icon={<BookOpen className="w-4 h-4 text-ink-900" />} title="Livre d'inventaire" color="slate">
            Génère un document imprimable A4 listant tous les articles en stock avec leurs quantités, emplacements et valeurs. Idéal pour les contrôles périodiques et les audits.
          </HelpSection>
          <HelpSection icon={<List className="w-4 h-4 text-neutral-700" />} title="Vue liste éditable" color="slate">
            Basculez en vue liste pour saisir rapidement des entrées, sorties ou inventaires en masse. Parcourez les articles avec les flèches du clavier, puis cliquez « Enregistrer » pour valider toutes les modifications en une seule fois.
          </HelpSection>
          <HelpSection icon={<History className="w-4 h-4 text-teal-700" />} title="Historique des mouvements" color="teal">
            Consultez la trace chronologique de toutes les opérations de stock (entrées, sorties, ventes, transferts, inventaires). Filtrable par période. Chaque mouvement peut être imprimé en A4 ou en ticket 80mm.
          </HelpSection>
          <HelpSection icon={<Printer className="w-4 h-4 text-slate-600" />} title="Impression mouvement" color="slate">
            Chaque mouvement dispose de deux formats d'impression : A4 (bon professionnel complet) et 80mm (ticket thermique compact). Le bon A4 inclut l'en-tête entreprise, les détails du mouvement et une zone signature.
          </HelpSection>
        </div>
      </Modal>

      {/* Lot picker for sortie */}
      <LotPickerModal
        open={lotPickerOutOpen}
        onClose={() => setLotPickerOutOpen(false)}
        items={lotPickerOutRow ? [{ article_id: lotPickerOutRow.article_id, name: lotPickerOutRow.name, quantity: lotPickerOutQty }] : []}
        onConfirm={async (selections) => {
          if (!currentSite || !selections[0]) return;
          setLotPickerOutOpen(false);
          const s = selections[0];
          const assignments = s.assignments.filter(a => a.quantity > 0).map(a => ({ lot_id: a.lot_id, quantity: a.quantity }));
          try {
            await supabase.rpc('deduct_stock_manual_lots', {
              p_article_id: s.article_id,
              p_site_id: currentSite.id,
              p_total_quantity: lotPickerOutQty,
              p_lot_assignments: assignments,
              p_movement_type: 'adjustment_out',
              p_note: adjNote || 'Sortie stock (lot)',
            });
            success('Sortie de stock effectuée');
            await load();
          } catch (e: any) {
            error(e.message || 'Erreur');
          }
        }}
        title="Choisir les lots pour la sortie"
        confirmLabel="Confirmer la sortie"
      />

      <CategoryPickerModal
        open={catPickerOpen}
        onClose={() => setCatPickerOpen(false)}
        categories={categories}
        selected={categoryFilter}
        onSelect={(id) => { setCategoryFilter(id); setCatPickerOpen(false); }}
      />

      {/* Site change confirmation modal — Waarwi style (white, no card, no border, separator lines) */}
      <Modal
        open={!!pendingSiteChange}
        onClose={() => setPendingSiteChange(null)}
        title="Changement d'emplacement"
        size="sm"
        footer={
          <>
            <button onClick={() => setPendingSiteChange(null)} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
            <div className="flex-1" />
            <button
              onClick={() => {
                if (!pendingSiteChange) return;
                setListSourceSite(pendingSiteChange.newSiteId);
                setListEdits(new Map());
                setPendingSiteChange(null);
              }}
              className="btn-icon-primary"
              title="Confirmer"
            >
              <Check className="w-4 h-4" />
            </button>
          </>
        }
      >
        {pendingSiteChange && (
          <div className="py-3">
            <div className="text-center">
              <p className="text-sm font-semibold text-neutral-900">
                Cette opération sera effectuée dans :
              </p>
            </div>
            <div className="h-px bg-neutral-200 my-3" />
            <div className="text-center">
              <p className="text-base font-bold text-neutral-900">{pendingSiteChange.newSiteName}</p>
              {pendingSiteChange.isDepot && currentSite && (
                <p className="text-[11px] text-neutral-500 mt-1">
                  et non dans le magasin principal : <span className="font-semibold">{currentSite.name}</span>
                </p>
              )}
            </div>
            <div className="h-px bg-neutral-200 my-3" />
            <p className="text-[11px] text-neutral-500 text-center">
              Les saisies en cours seront réinitialisées.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ===================== LOTS VIEW ===================== */
function LotsView({ lots, stockMethod }: { lots: LotRow[]; stockMethod: StockMethod }) {
  const [search, setSearch] = useState('');

  if (stockMethod !== 'lot') {
    return (
      <div className="py-10 text-center">
        <PackageOpen className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-sm font-semibold text-slate-600">Suivi par lot non activé</p>
        <p className="text-xs text-slate-400 mt-1">Activez la méthode "Par lot" dans Paramètres &gt; Gestion des stocks.</p>
      </div>
    );
  }

  const today = new Date().toISOString().split('T')[0];
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

  const filtered = lots.filter(l => {
    if (!search) return true;
    const q = search.toLowerCase();
    return l.article_name.toLowerCase().includes(q) || l.article_ref.toLowerCase().includes(q) || l.batch_number.toLowerCase().includes(q);
  });

  const expired = filtered.filter(l => l.expiry_date && l.expiry_date <= today);
  const expiringSoon = filtered.filter(l => l.expiry_date && l.expiry_date > today && l.expiry_date <= soon);
  const ok = filtered.filter(l => !l.expiry_date || l.expiry_date > soon);

  const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  const daysUntil = (d: string | null) => {
    if (!d) return null;
    const diff = Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
    return diff;
  };

  return (
    <div className="space-y-3">
      {/* Expiry alerts */}
      {expired.length > 0 && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200">
          <div className="flex items-center gap-2 text-xs font-bold text-red-700 mb-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />{expired.length} lot{expired.length > 1 ? 's' : ''} périmé{expired.length > 1 ? 's' : ''}
          </div>
          <div className="space-y-1">
            {expired.slice(0, 5).map(l => (
              <div key={l.id} className="text-[11px] text-red-600 flex items-center gap-2">
                <span className="font-semibold">{l.batch_number}</span>
                <span className="text-red-500">{l.article_name}</span>
                <span className="ml-auto font-mono">{formatDate(l.expiry_date)}</span>
              </div>
            ))}
            {expired.length > 5 && <div className="text-[10px] text-red-500">+{expired.length - 5} autres...</div>}
          </div>
        </div>
      )}

      {expiringSoon.length > 0 && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-700 mb-1.5">
            <Clock className="w-3.5 h-3.5" />{expiringSoon.length} lot{expiringSoon.length > 1 ? 's' : ''} expire{expiringSoon.length > 1 ? 'nt' : ''} dans les 30 jours
          </div>
          <div className="space-y-1">
            {expiringSoon.slice(0, 5).map(l => (
              <div key={l.id} className="text-[11px] text-amber-700 flex items-center gap-2">
                <span className="font-semibold">{l.batch_number}</span>
                <span className="text-amber-600">{l.article_name}</span>
                <span className="ml-auto font-mono">{daysUntil(l.expiry_date)}j</span>
              </div>
            ))}
            {expiringSoon.length > 5 && <div className="text-[10px] text-amber-500">+{expiringSoon.length - 5} autres...</div>}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-2">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher lot, article..."
          className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400"
        />
        <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap">{filtered.length} lot{filtered.length > 1 ? 's' : ''}</span>
      </div>

      {/* Lots list */}
      {filtered.length === 0 ? (
        <div className="py-8 text-center">
          <PackageOpen className="w-7 h-7 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-600">Aucun lot en stock</p>
          <p className="text-xs text-slate-400 mt-1">Les lots apparaîtront ici après une entrée de stock en mode lot.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map(l => {
            const days = daysUntil(l.expiry_date);
            const isExpired = l.expiry_date && l.expiry_date <= today;
            const isSoon = l.expiry_date && !isExpired && l.expiry_date <= soon;
            return (
              <div key={l.id} className={`p-3 rounded-xl border bg-white ${isExpired ? 'border-red-200 bg-red-50/50' : isSoon ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200'}`}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900 truncate">{l.article_name}</span>
                      <span className="text-[10px] font-mono text-slate-400">{l.article_ref}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[11px]">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 font-semibold">
                        <PackageOpen className="w-3 h-3" />{l.batch_number}
                      </span>
                      {l.expiry_date && (
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md font-semibold ${isExpired ? 'bg-red-100 text-red-700' : isSoon ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                          <Calendar className="w-3 h-3" />{formatDate(l.expiry_date)}
                          {days !== null && <span className="font-bold">({days}j)</span>}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-slate-900 num">{l.remaining_quantity}</div>
                    <div className="text-[9px] text-slate-400">/ {l.initial_quantity}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 *  STOCK LIST EDIT VIEW — Bulk inline editing
 * ════════════════════════════════════════════════════════════════════════════ */
type ListEditEntry = { article_id: string; qty: number | ''; note: string; lot_number: string };

function StockListEditView({
  filtered, listEditMode, setListEditMode, listEdits, setListEdits,
  listSaving, setListSaving, listInputRefs, saveBulkRef, currentSite,
  canViewPrices, canManageStock, onSaved, successToast, errorToast, stockMethod,
  sites, depots, listTransferTarget, setListTransferTarget,
  listSourceSite, setListSourceSite, stockByLocation, tenantId,
  sortCol, sortDir, onSort,
}: {
  filtered: Row[];
  listEditMode: 'in' | 'out' | 'inventory' | 'transfer';
  setListEditMode: (m: 'in' | 'out' | 'inventory' | 'transfer') => void;
  listEdits: Map<string, ListEditEntry>;
  setListEdits: (m: Map<string, ListEditEntry>) => void;
  listSaving: boolean;
  setListSaving: (s: boolean) => void;
  listInputRefs: React.MutableRefObject<Map<string, HTMLInputElement>>;
  saveBulkRef: React.MutableRefObject<(() => void) | null>;
  currentSite: any;
  canViewPrices: boolean;
  canManageStock: boolean;
  onSaved: (bulkItems?: { ref: string; name: string; quantity: number }[], bulkMode?: string) => Promise<void>;
  successToast: (m: string) => void;
  errorToast: (m: string) => void;
  stockMethod: string;
  sites: any[];
  depots: any[];
  listTransferTarget: string;
  setListTransferTarget: (v: string) => void;
  listSourceSite: string;
  setListSourceSite: (v: string) => void;
  stockByLocation: Map<string, Map<string, number>>;
  tenantId: string;
  sortCol: 'name' | 'stock' | 'min' | 'price';
  sortDir: 'asc' | 'desc';
  onSort: (col: 'name' | 'stock' | 'min' | 'price') => void;
}) {
  const lotMode = stockMethod === 'lot';
  const editCount = Array.from(listEdits.values()).filter(e => e.qty !== '' && Number(e.qty) !== 0).length;
  const sourceSiteId = listSourceSite || currentSite?.id || '';
  const sourceStockMap = stockByLocation.get(sourceSiteId) || new Map<string, number>();
  const stockAt = (articleId: string): number => {
    if (sourceSiteId === currentSite?.id) {
      const r = filtered.find(f => f.article_id === articleId);
      return r?.quantity ?? 0;
    }
    return sourceStockMap.get(articleId) ?? 0;
  };

  // Paginated table rendering
  const TABLE_PAGE = 100;
  const [tablePage, setTablePage] = useState(1);
  useEffect(() => { setTablePage(1); }, [filtered.length]);
  const tableTotalPages = Math.max(1, Math.ceil(filtered.length / TABLE_PAGE));
  const tableVisibleRows = useMemo(() => filtered.slice((tablePage - 1) * TABLE_PAGE, tablePage * TABLE_PAGE), [filtered, tablePage]);

  const updateEdit = (articleId: string, qty: number | '', note?: string, lot_number?: string) => {
    const next = new Map(listEdits);
    const existing = next.get(articleId);
    next.set(articleId, {
      article_id: articleId,
      qty,
      note: note ?? existing?.note ?? '',
      lot_number: lot_number ?? existing?.lot_number ?? '',
    });
    setListEdits(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      const nextRow = filtered[index + 1];
      if (nextRow) listInputRefs.current.get(nextRow.article_id)?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevRow = filtered[index - 1];
      if (prevRow) listInputRefs.current.get(prevRow.article_id)?.focus();
    }
  };

  const saveBulk = async () => {
    if (!currentSite) return;
    if (!canManageStock) { errorToast('Vous n\'avez pas la permission de gerer le stock'); return; }
    const entries = Array.from(listEdits.values()).filter(e => e.qty !== '' && Number(e.qty) !== 0);
    if (entries.length === 0) { return; }
    if (lotMode && listEditMode === 'in') {
      const missing = entries.find(e => !e.lot_number?.trim());
      if (missing) { errorToast('Numéro de lot requis pour toutes les entrées'); return; }
    }
    if (listEditMode === 'transfer' && !listTransferTarget) {
      errorToast('Choisissez un site de destination'); return;
    }
    const sourceSite = listSourceSite || currentSite.id;
    if (listEditMode === 'transfer' && sourceSite === listTransferTarget) {
      errorToast('La source et la destination doivent être différentes'); return;
    }
    // Validate transfer target is allowed based on catalog mode
    if (listEditMode === 'transfer' && ![...sites, ...depots].some((t: any) => t.id === listTransferTarget)) {
      errorToast('Transfert non autorisé vers cette destination en mode catalogue indépendant'); return;
    }
    setListSaving(true);
    let savedCount = 0;
    try {
      // ─── Create stock document header ──────────────────────────────────────
      const docTypeMap: Record<string, { type: 'entry' | 'exit' | 'transfer' | 'inventory'; kind: string; prefix: string }> = {
        in: { type: 'entry', kind: 'stock_entry', prefix: 'BE' },
        out: { type: 'exit', kind: 'stock_exit', prefix: 'BS' },
        transfer: { type: 'transfer', kind: 'stock_transfer', prefix: 'BT' },
        inventory: { type: 'inventory', kind: 'stock_inventory', prefix: 'BI' },
      };
      const docInfo = docTypeMap[listEditMode];
      const { data: docNum, error: docNumErr } = await supabase.rpc('next_doc_number', {
        p_tenant_id: tenantId,
        p_kind: docInfo.kind,
        p_prefix: docInfo.prefix,
      });
      if (docNumErr) throw docNumErr;
      const totalQty = entries.reduce((s, e) => s + Math.abs(Number(e.qty) || 0), 0);
      const headerNote = entries[0]?.note || '';
      const { data: docRow, error: docInsErr } = await supabase
        .from('stock_documents')
        .insert({
          tenant_id: tenantId,
          doc_number: docNum,
          doc_type: docInfo.type,
          site_id: sourceSite,
          dest_site_id: listEditMode === 'transfer' ? listTransferTarget : null,
          note: headerNote,
          total_qty: totalQty,
          line_count: entries.length,
        })
        .select('id, doc_number')
        .single();
      if (docInsErr) throw docInsErr;
      const documentId = docRow.id as string;

      for (const entry of entries) {
        const qty = Number(entry.qty);
        if (listEditMode === 'transfer') {
          const { error: e1 } = await supabase.rpc('adjust_stock_with_doc', {
            p_article_id: entry.article_id, p_site_id: sourceSite,
            p_quantity: -qty, p_movement_type: 'transfer_out',
            p_note: entry.note || 'Transfert sortie (masse)',
            p_stock_document_id: documentId,
          });
          if (e1) throw e1;
          const { error: e2 } = await supabase.rpc('adjust_stock_with_doc', {
            p_article_id: entry.article_id, p_site_id: listTransferTarget,
            p_quantity: qty, p_movement_type: 'transfer_in',
            p_note: entry.note || 'Transfert entrée (masse)',
            p_stock_document_id: documentId,
          });
          if (e2) throw e2;
        } else if (listEditMode === 'inventory') {
          const row = filtered.find(r => r.article_id === entry.article_id);
          if (!row) continue;
          const currentQty = stockAt(entry.article_id);
          const diff = qty - currentQty;
          if (diff === 0) continue;
          const { error: e } = await supabase.rpc('adjust_stock_with_doc', {
            p_article_id: entry.article_id, p_site_id: sourceSite,
            p_quantity: diff, p_movement_type: 'inventory',
            p_note: entry.note || `Inventaire: ${currentQty} -> ${qty}`,
            p_stock_document_id: documentId,
          });
          if (e) throw e;
        } else if (listEditMode === 'in' && lotMode) {
          const { error: e } = await supabase.rpc('adjust_stock_lot', {
            p_article_id: entry.article_id, p_site_id: sourceSite,
            p_quantity: qty, p_batch_number: entry.lot_number.trim(),
            p_expiry_date: null,
            p_purchase_price: filtered.find(r => r.article_id === entry.article_id)?.purchase_price ?? 0,
            p_note: entry.note || `Lot ${entry.lot_number.trim()}`,
          });
          if (e) throw e;
          // Link the freshly inserted movement to the stock document
          await supabase
            .from('stock_movements')
            .update({ stock_document_id: documentId })
            .eq('article_id', entry.article_id)
            .eq('site_id', sourceSite)
            .eq('movement_type', 'adjustment_in')
            .is('stock_document_id', null)
            .order('created_at', { ascending: false })
            .limit(1);
        } else {
          const signedQty = listEditMode === 'in' ? qty : -qty;
          const type = listEditMode === 'in' ? 'adjustment_in' : 'adjustment_out';
          const { error: e } = await supabase.rpc('adjust_stock_with_doc', {
            p_article_id: entry.article_id, p_site_id: sourceSite,
            p_quantity: signedQty, p_movement_type: type,
            p_note: entry.note || (listEditMode === 'in' ? 'Entrée stock (masse)' : 'Sortie stock (masse)'),
            p_stock_document_id: documentId,
          });
          if (e) throw e;
        }
        savedCount++;
      }
      successToast(`${savedCount} article${savedCount > 1 ? 's' : ''} mis à jour · ${docRow.doc_number}`);
      const modeType = listEditMode === 'transfer' ? 'transfer_out' : listEditMode === 'inventory' ? 'inventory' : listEditMode === 'in' ? 'adjustment_in' : 'adjustment_out';
      const items = entries.map(e => {
        const row = filtered.find(r => r.article_id === e.article_id);
        return { ref: row?.internal_ref || '', name: row?.name || '', quantity: Number(e.qty) };
      });
      await onSaved(items, modeType);
    } catch (e: any) {
      errorToast(e.message || 'Erreur lors de la sauvegarde');
    } finally {
      setListSaving(false);
    }
  };
  saveBulkRef.current = saveBulk;

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 180px)', minHeight: '400px' }}>
      {/* Source / Destination pickers + save button */}
      {(() => {
        const ownDepots = depots.filter((d: any) => d.parent_site_id === currentSite?.id);
        const showSourcePicker = ownDepots.length > 0;
        const isTransfer = listEditMode === 'transfer';
        if (!showSourcePicker && !isTransfer) {
          return (
            <div className="shrink-0 mb-2 flex items-center justify-end">
              <button onClick={saveBulk} disabled={editCount === 0 || listSaving} className="btn-icon-primary" title={`Enregistrer${editCount > 0 ? ` (${editCount})` : ''}`}>
                {listSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              </button>
            </div>
          );
        }
        return (
          <div className="shrink-0 mb-2 flex items-center gap-2">
            {showSourcePicker && (
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <span className="text-[11px] font-semibold text-slate-700 shrink-0">{isTransfer ? 'Source' : 'Empl.'}</span>
                <div className="relative flex-1 min-w-0">
                  <select
                    value={listSourceSite || currentSite?.id || ''}
                    onChange={e => setListSourceSite(e.target.value)}
                    className="bare-input text-xs font-semibold py-1 w-full pr-5"
                  >
                    {currentSite && <option value={currentSite.id}>{currentSite.name} (Magasin)</option>}
                    {ownDepots.map((d: any) => (
                      <option key={d.id} value={d.id}>{d.name} (Dépôt)</option>
                    ))}
                  </select>
                  <ChevronDown className="w-3 h-3 text-neutral-400 absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
                <div className="h-px bg-neutral-200 flex-1" />
              </div>
            )}
            {isTransfer && (
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <span className="text-[11px] font-semibold text-slate-700 shrink-0">Dest.</span>
                <div className="relative flex-1 min-w-0">
                  <select
                    value={listTransferTarget}
                    onChange={e => setListTransferTarget(e.target.value)}
                    className="bare-input text-xs font-semibold py-1 w-full pr-5"
                  >
                    <option value="">-- Choisir --</option>
                    {(() => {
                      const sourceId = listSourceSite || currentSite?.id || '';
                      const allTargets = [...(currentSite ? [currentSite] : []), ...sites];
                      const seen = new Set<string>();
                      return allTargets.filter((s: any) => {
                        if (s.id === sourceId) return false;
                        if (seen.has(s.id)) return false;
                        seen.add(s.id);
                        return true;
                      }).map((s: any) => {
                        const isDepot = !!s.is_warehouse || !!s.parent_site_id;
                        const ownDepot = isDepot && s.parent_site_id === currentSite?.id;
                        const label = isDepot
                          ? `${s.name} (Dépôt${ownDepot ? '' : ' ext.'})`
                          : `${s.name} (Magasin)`;
                        return <option key={s.id} value={s.id}>{label}</option>;
                      });
                    })()}
                  </select>
                  <ChevronDown className="w-3 h-3 text-neutral-400 absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
                <div className="h-px bg-neutral-200 flex-1" />
              </div>
            )}
            <button onClick={saveBulk} disabled={editCount === 0 || listSaving} className="btn-icon-primary shrink-0" title={`Enregistrer${editCount > 0 ? ` (${editCount})` : ''}`}>
              {listSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            </button>
          </div>
        );
      })()}

      {/* Table with sticky header and scrollable body */}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-left">
          <thead className="sticky top-0 z-[5]">
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 w-[30%] cursor-pointer select-none hover:text-brand-700" onClick={() => onSort('name')}>
                <span className="inline-flex items-center gap-0.5">Article {sortCol === 'name' && (sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}</span>
              </th>
              <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-center w-[80px] cursor-pointer select-none hover:text-brand-700" onClick={() => onSort('stock')}>
                <span className="inline-flex items-center gap-0.5 justify-center">Stock {sortCol === 'stock' && (sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}</span>
              </th>
              <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-center w-[100px]">
                {listEditMode === 'in' ? 'Qté entrée' : listEditMode === 'out' ? 'Qté sortie' : listEditMode === 'transfer' ? 'Qté transf.' : 'Nvelle qté'}
              </th>
              {lotMode && listEditMode === 'in' && (
                <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 w-[110px]">N° Lot *</th>
              )}
              <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 w-[120px] hidden md:table-cell">Note</th>
              <th className="px-2 py-2 w-[30px]"></th>
            </tr>
          </thead>
          <tbody>
              {tableVisibleRows.map((r, idx) => {
                const edit = listEdits.get(r.article_id);
                const hasValue = edit && edit.qty !== '' && Number(edit.qty) !== 0;
                const displayQty = stockAt(r.article_id);
                const out = displayQty <= 0;
                const low = !out && displayQty <= r.stock_min;
                return (
                  <tr key={r.article_id} className={`border-b border-slate-50 transition-colors ${hasValue ? 'bg-brand-50/30' : 'hover:bg-slate-50/50'}`}>
                    <td className="px-3 py-1.5 w-[30%]">
                      <div className="text-[11px] font-semibold text-neutral-900 leading-tight">{r.name}</div>
                    </td>
                    <td className="px-2 py-1.5 text-center w-[80px]">
                      <span className={`inline-block text-xs font-bold num ${out ? 'text-red-600' : low ? 'text-amber-700' : 'text-slate-800'}`}>
                        {displayQty}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 w-[100px]">
                      <input
                        ref={el => { if (el) listInputRefs.current.set(r.article_id, el); }}
                        type="number"
                        min={0}
                        placeholder={listEditMode === 'inventory' ? String(displayQty) : '0'}
                        value={edit?.qty ?? ''}
                        onChange={e => updateEdit(r.article_id, e.target.value === '' ? '' : Number(e.target.value), edit?.note, edit?.lot_number)}
                        onKeyDown={e => handleKeyDown(e, idx)}
                        className="w-full text-center text-xs font-bold num bg-transparent border-0 border-b border-neutral-200 focus:border-neutral-900 outline-none pb-1 pt-1 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </td>
                    {lotMode && listEditMode === 'in' && (
                      <td className="px-2 py-1.5 w-[110px]">
                        <input
                          type="text"
                          placeholder="LOT-…"
                          value={edit?.lot_number ?? ''}
                          onChange={e => updateEdit(r.article_id, edit?.qty ?? '', edit?.note, e.target.value)}
                          className={`w-full text-[10px] bg-transparent border-0 border-b outline-none pb-1 pt-1 transition-colors ${
                            hasValue && !edit?.lot_number?.trim()
                              ? 'border-red-400 focus:border-red-500'
                              : 'border-neutral-200 focus:border-neutral-900'
                          }`}
                        />
                      </td>
                    )}
                    <td className="px-2 py-1.5 hidden md:table-cell w-[120px]">
                      <input
                        type="text"
                        placeholder="..."
                        value={edit?.note ?? ''}
                        onChange={e => updateEdit(r.article_id, edit?.qty ?? '', e.target.value, edit?.lot_number)}
                        className="w-full text-[10px] bg-transparent border-0 border-b border-neutral-200 focus:border-neutral-900 outline-none pb-1 pt-1 transition-colors"
                      />
                    </td>
                    <td className="px-2 py-1.5 w-[30px]">
                      {hasValue && <Check className="w-3.5 h-3.5 text-emerald-500" />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {tableTotalPages > 1 && (
            <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100">
              <span className="text-[10px] text-slate-500">
                {((tablePage - 1) * TABLE_PAGE) + 1}–{Math.min(tablePage * TABLE_PAGE, filtered.length)} / {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => { saveBulk(); setTablePage(1); }} disabled={tablePage === 1} className="px-1.5 py-0.5 text-[10px] rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">{'<<'}</button>
                <button onClick={() => { saveBulk(); setTablePage(p => Math.max(1, p - 1)); }} disabled={tablePage === 1} className="px-1.5 py-0.5 text-[10px] rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">{'<'}</button>
                <span className="text-[10px] font-medium text-slate-700 px-1">{tablePage}/{tableTotalPages}</span>
                <button onClick={() => { saveBulk(); setTablePage(p => Math.min(tableTotalPages, p + 1)); }} disabled={tablePage === tableTotalPages} className="px-1.5 py-0.5 text-[10px] rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">{'>'}</button>
                <button onClick={() => { saveBulk(); setTablePage(tableTotalPages); }} disabled={tablePage === tableTotalPages} className="px-1.5 py-0.5 text-[10px] rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">{'>>'}</button>
              </div>
            </div>
          )}
        </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 *  HELP SECTION — Reusable row for the guide modal
 * ════════════════════════════════════════════════════════════════════════════ */
function HelpSection({ icon, title, color, children }: { icon: React.ReactNode; title: string; color: string; children: React.ReactNode }) {
  const bgMap: Record<string, string> = { emerald: 'bg-emerald-50 border-emerald-200', red: 'bg-red-50 border-red-200', amber: 'bg-amber-50 border-amber-200', slate: 'bg-neutral-50 border-neutral-200', teal: 'bg-teal-50 border-teal-200' };
  return (
    <div className={`p-3 rounded-xl border ${bgMap[color] || 'bg-slate-50 border-slate-200'}`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs font-bold text-slate-900">{title}</span>
      </div>
      <p className="text-[11px] text-slate-600 leading-relaxed">{children}</p>
    </div>
  );
}