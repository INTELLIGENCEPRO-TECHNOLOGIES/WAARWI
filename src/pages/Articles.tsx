import { useRealtimeTick } from '../lib/useRealtimeData';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Package, Trash2, Loader2, X, Car, DollarSign, Boxes, Info, Pencil, Filter, ChevronDown, ChevronUp, Upload, Camera, CheckSquare, Square, Lightbulb, Download, AlertTriangle, List, LayoutGrid, Save, MoreHorizontal, Check, ChevronLeft, ChevronRight, RefreshCw, PackagePlus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { usePermissions } from '../lib/permissions';
import { useToast } from '../context/ToastContext';
import { formatFCFA } from '../lib/format';
import { consumeNavContext } from '../lib/navHighlight';
import { ConfirmDialog, Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { PageSearch } from '../components/PageSearch';
import type { Article, Category, VehicleBrand } from '../lib/types';
import { isAutoParts } from '../lib/types';
import { Field, PremiumSelect, ArticleCard, CategoryPickerModal, MasterCatalogGuide, DesktopListView, FullScreenArticleEdit, MobileArticleEdit } from './ArticlesComponents';

type Form = Partial<Article> & { stock_init?: number };
type Compat = { id?: string; brand_id: string; model_id: string; year_start: number; year_end: number; notes: string };
type TierDefinition = { id: string; tier_name: string; sort_order: number; is_default: boolean };

type TabKey = 'infos' | 'prix' | 'stock' | 'compat' | 'image';
type FormMode = 'create' | 'edit';
type EditorSurface = 'mobile' | 'desktop';
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
type SaveIntent = 'stay' | 'new' | 'close';

export function Articles({ onNavigate }: { onNavigate?: (route: string) => void } = {}) {
  const { tenant, currentSite, sites, depots, refData } = useApp();
  const dataTick = useRealtimeTick(['articles', 'part_categories', 'stock_levels', 'stock_lots', 'article_pricing_tiers', 'vehicle_brands', 'vehicle_models', 'article_compatibilities']);
  const { can } = usePermissions();
  const autoMode = isAutoParts(tenant);
  const isPharmacy = (tenant?.business_activity_type_name || '').toLowerCase() === 'pharmacie' || (tenant?.enabled_modules || []).includes('ipm');
  const { success, error } = useToast();
  const [articles, setArticles] = useState<Article[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<VehicleBrand[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [serverStats, setServerStats] = useState({ in_stock: 0, low_stock: 0, out_stock: 0, total_articles: 0 });
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'in' | 'low' | 'out'>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [cursors, setCursors] = useState<{ val: string | null; id: string | null }[]>([]);
  const PAGE_SIZE = 50;
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);
  const [sortCol, setSortCol] = useState<'name' | 'ref' | 'oem_ref' | 'category' | 'price' | 'purchase_price' | 'stock'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const handleSearchInput = (val: string) => {
    setSearchInput(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setSearch(val); setPage(0); setCursors([]); }, 250);
  };
  const [editorSurface, setEditorSurface] = useState<EditorSurface | null>(null);
  const [switchingArticle, setSwitchingArticle] = useState(false);
  const articleTransitionRef = useRef(false);
  const [editing, setEditing] = useState<Article | null>(null);
  const [toDelete, setToDelete] = useState<Article | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [importExportOpen, setImportExportOpen] = useState(false);
  const [importRows, setImportRows] = useState<any[]>([]);
  const [importFilename, setImportFilename] = useState('');
  const [importingArticles, setImportingArticles] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; updated: number; errors: any[] } | null>(null);
  const [importTargetSite, setImportTargetSite] = useState<string>('');
  const [form, setForm] = useState<Form>({});
  const [compats, setCompats] = useState<Compat[]>([]);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<TabKey>('infos');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageDeletePending, setImageDeletePending] = useState(false);

  // ── Form state machine ──
  const [formMode, setFormMode] = useState<FormMode>('create');
  const [currentArticleId, setCurrentArticleId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const savedSnapshotRef = useRef<string>('');
  const userTouchedRef = useRef(false);
  const pendingReloadRef = useRef(false);

  // Nouveaux états pour le mode affichage, édition en liste, et affichage plein écran
  const [viewMode, setViewMode] = useState<'cards' | 'list'>(() => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    return isMobile ? 'cards' : 'list';
  });
  const [listEdits, setListEdits] = useState<Map<string, Partial<Article>>>(new Map());
  const [listSaving, setListSaving] = useState(false);
  const [bulkActionOpen, setBulkActionOpen] = useState(false);
  const [bulkAction, setBulkAction] = useState('');
  const [bulkActionValue, setBulkActionValue] = useState('');
  const [tierDefinitions, setTierDefinitions] = useState<TierDefinition[]>([]);
  const [formTiers, setFormTiers] = useState<Array<{ tier_name: string; price: number | '' }>>([]);

  const marginValue = form.purchase_price && form.sale_price && Number(form.sale_price) > 0
    ? ((Number(form.sale_price) - Number(form.purchase_price)) / Number(form.sale_price)) * 100
    : 0;
  const marginStr = marginValue.toFixed(1);

  const sharedArticles = (tenant as any)?.settings?.shared_articles !== false;

  // Server-paginated fetch
  const loadPage = useCallback(async (pageNum: number, isRefresh = false) => {
    if (!tenant) return;
    const myReqId = ++reqIdRef.current;
    if (isRefresh) setRefreshing(true);
    else if (pageNum === 0) setLoading(true);
    else setRefreshing(true);

    const cursor = pageNum > 0 && cursors[pageNum - 1] ? cursors[pageNum - 1] : { val: null, id: null };
    const stockSiteId = currentSite?.id || null;

    const params: Record<string, any> = {
      p_tenant_id: tenant.id,
      p_site_id: (!sharedArticles && currentSite) ? currentSite.id : null,
      p_stock_site_id: stockSiteId,
      p_page_size: PAGE_SIZE,
      p_search: search || null,
      p_category_id: categoryFilter || null,
      p_stock_filter: stockFilter !== 'all' ? stockFilter : null,
      p_sort_col: sortCol,
      p_sort_dir: sortDir,
      p_is_active: true,
      p_include_stock: true,
    };
    if (cursor.val && cursor.id) {
      params.p_cursor_val = cursor.val;
      params.p_cursor_id = cursor.id;
    }

    const { data, error } = await supabase.rpc('rpc_paginated_articles', params);
    if (myReqId !== reqIdRef.current) return;

    if (error || !data) {
      console.error('[Articles] rpc_paginated_articles error:', error?.message || 'no data');
      setLoadError(error?.message || 'Impossible de charger les articles');
      setLoading(false); setRefreshing(false);
      return;
    }
    setLoadError(null);

    const rows = (data.rows || []) as Article[];
    const newStockMap: Record<string, number> = {};
    rows.forEach((r: any) => { newStockMap[r.id] = Number(r.stock_quantity || 0); });

    setArticles(rows);
    setStockMap(newStockMap);
    setTotalCount(data.total_count || 0);
    setServerStats(data.totals || {});
    setHasMore(rows.length >= PAGE_SIZE);

    if (rows.length > 0) {
      const lastRow = rows[rows.length - 1] as any;
      const cursorVal = sortCol === 'name' ? lastRow.name :
        sortCol === 'ref' ? lastRow.internal_ref :
        sortCol === 'oem_ref' ? (lastRow.oem_ref || '') :
        sortCol === 'price' ? String(lastRow.sale_price ?? '') :
        sortCol === 'purchase_price' ? String(lastRow.purchase_price ?? '') :
        sortCol === 'stock' ? String(lastRow.stock_quantity ?? '') :
        sortCol === 'category' ? (lastRow.category_id || '') :
        lastRow.name || '';
      setCursors(prev => {
        const next = [...prev];
        next[pageNum] = { val: cursorVal, id: lastRow.id };
        return next;
      });
    }

    setLoading(false);
    setRefreshing(false);
    setInitialLoaded(true);
  }, [tenant, currentSite, sharedArticles, search, categoryFilter, stockFilter, sortCol, sortDir, cursors]);

  // Load suppliers and tier defs separately (not page-dependent)
  useEffect(() => {
    if (!tenant) return;
    supabase.from('suppliers').select('id, name').eq('tenant_id', tenant.id).eq('is_active', true).order('name').then(({ data }) => setSuppliers(data || []));
    supabase.from('pricing_tier_definitions').select('id, tier_name, sort_order, is_default, tenant_id').eq('tenant_id', tenant.id).order('sort_order').then(({ data }) => setTierDefinitions(data || []));
  }, [tenant?.id]);

  useEffect(() => { loadPage(page); /* eslint-disable-next-line */ }, [page, search, categoryFilter, stockFilter, sortCol, sortDir, tenant?.id, currentSite?.id, sharedArticles]);

  // Reset page when filters change
  useEffect(() => { setPage(0); setCursors([]); }, [search, categoryFilter, stockFilter, sortCol, sortDir, tenant?.id, currentSite?.id]);

  useEffect(() => { if (dataTick > 0) { const t = setTimeout(() => loadPage(page, true), 300); return () => clearTimeout(t); } /* eslint-disable-next-line */ }, [dataTick]);

  // Keep categories/brands/models in sync with refData so new categories appear without page reload
  useEffect(() => {
    if (refData) {
      setCategories(refData.categories || []);
      setBrands(refData.brands || []);
      setModels(refData.models || []);
    }
  }, [refData]);

  useEffect(() => {
    const ctx = consumeNavContext();
    if (ctx?.target === 'newArticle') openCreate();
  }, []);

  // Articles are already filtered/sorted/paginated server-side
  const paginated = articles;
  const editingIndex = paginated.findIndex(article => article.id === currentArticleId);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const categoryMap = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);

  const stats = useMemo(() => ({
    inStock: serverStats.in_stock || 0,
    low: serverStats.low_stock || 0,
    out: serverStats.out_stock || 0,
  }), [serverStats]);

  const getFormSnapshot = (f: Form, c: Compat[], t: typeof formTiers) => JSON.stringify({ f, c, t });

  const initCreateForm = () => {
    const newForm: Form = {
      internal_ref: '', name: '', brand: '', oem_ref: '', supplier_ref: '', barcode: '',
      condition: 'neuf', unit: 'pièce', purchase_price: 0, sale_price: 0, min_price: 0,
      wholesale_price: 0, vat_rate: 0, stock_min: 0, stock_max: 0, location: '', stock_init: 0,
    };
    const newTiers = tierDefinitions.map(t => ({ tier_name: t.tier_name, price: '' as number | '' }));
    const newCompats: Compat[] = [];
    setEditing(null);
    setForm(newForm);
    setCompats(newCompats);
    setFormTiers(newTiers);
    setTab('infos');
    setImageFile(null);
    setImagePreview(null);
    setImageDeletePending(false);
    setFormMode('create');
    setCurrentArticleId(null);
    setSaveState('idle');
    userTouchedRef.current = false;
    savedSnapshotRef.current = getFormSnapshot(newForm, newCompats, newTiers);
  };

  const openCreate = () => {
    if (articleTransitionRef.current) return;
    initCreateForm();
    setEditorSurface(window.innerWidth >= 768 ? 'desktop' : 'mobile');
  };

  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadArticle = async (article: Article) => {
    const [compatResult, tierResult] = await Promise.all([
      supabase.from('article_compatibilities').select('*').eq('article_id', article.id),
      supabase.from('article_pricing_tiers').select('*').eq('article_id', article.id).order('sort_order'),
    ]);
    if (compatResult.error || tierResult.error) {
      error('Impossible de charger cette fiche article. Réessayez.');
      return false;
    }

    const loadedCompats: Compat[] = (compatResult.data ?? []).map(row => ({
      id: row.id,
      brand_id: row.brand_id || '',
      model_id: row.model_id || '',
      year_start: row.year_start || 0,
      year_end: row.year_end || 0,
      notes: row.notes || '',
    }));
    const loadedTiers = tierResult.data ?? [];
    const nextTiers: typeof formTiers = tierDefinitions.map(definition => ({
      tier_name: definition.tier_name,
      price: loadedTiers.find(tier => tier.tier_name === definition.tier_name)?.price ?? '',
    }));
    const editForm = { ...article, stock_init: 0 };

    savedSnapshotRef.current = getFormSnapshot(editForm, loadedCompats, nextTiers);
    userTouchedRef.current = false;
    setEditing(article);
    setFormMode('edit');
    setCurrentArticleId(article.id);
    setSaveState('idle');
    setTab('infos');
    setImageFile(null);
    setImagePreview(article.image_url || null);
    setImageDeletePending(false);
    setForm(editForm);
    setCompats(loadedCompats);
    setFormTiers(nextTiers);
    return true;
  };

  const generateRef = async () => {
    if (!tenant) return;
    const cat = categories.find(c => c.id === form.category_id);
    const prefix = cat?.code || 'ART';
    const { data } = await supabase
      .from('articles')
      .select('internal_ref')
      .eq('tenant_id', tenant.id)
      .ilike('internal_ref', `${prefix}-%`)
      .order('internal_ref', { ascending: false })
      .limit(1)
      .maybeSingle();
    let nextNum = 1;
    if (data?.internal_ref) {
      const match = data.internal_ref.match(/(\d+)$/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    const ref = `${prefix}-${String(nextNum).padStart(4, '0')}`;
    setForm(f => ({ ...f, internal_ref: ref }));
  };

  const addCompat = () => setCompats(c => [...c, { brand_id: '', model_id: '', year_start: 0, year_end: 0, notes: '' }]);
  const removeCompat = (i: number) => setCompats(c => c.filter((_, idx) => idx !== i));

  const createCategory = async (name: string, parentId: string | null): Promise<string | null> => {
    if (!tenant) return null;
    const { data, error: e } = await supabase.from('part_categories').insert({
      tenant_id: tenant.id, name: name.trim(), parent_id: parentId || null, is_active: true,
    }).select().single();
    if (e) { error(e.message); return null; }
    const newCat = data as Category;
    setCategories(prev => [...prev, newCat]);
    return newCat.id;
  };

  const isDirty = useCallback(() => {
    return getFormSnapshot(form, compats, formTiers) !== savedSnapshotRef.current;
  }, [form, compats, formTiers]);

  const save = async (opts?: { silent?: boolean; intent?: SaveIntent }): Promise<boolean> => {
    const silent = opts?.silent ?? false;
    const intent = opts?.intent ?? 'stay';
    if (!tenant) return false;
    if (!can('manage_articles')) { if (!silent) error('Vous n\'avez pas la permission de modifier les articles'); return false; }
    if (!form.name?.trim()) { if (!silent) { error('Désignation obligatoire'); setTab('infos'); } return false; }
    if (!form.internal_ref?.trim()) { if (!silent) { error('Référence interne obligatoire'); setTab('infos'); } return false; }

    if (saving) return false;
    setSaving(true);
    setSaveState('saving');

    const isCreate = formMode === 'create' && !currentArticleId;

    try {
      let finalImageUrl: string | null = form.image_url || null;

      if (imageDeletePending) {
        finalImageUrl = null;
      } else if (imageFile) {
        setImageUploading(true);
        const ext = imageFile.name.split('.').pop()?.toLowerCase() || 'jpg';
        const tempKey = currentArticleId || `temp_${Date.now()}`;
        const path = `${tenant.id}/articles/${tempKey}/main.${ext}`;
        const { error: upErr } = await supabase.storage.from('article-images').upload(path, imageFile, { upsert: true, contentType: imageFile.type });
        setImageUploading(false);
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage.from('article-images').getPublicUrl(path);
        finalImageUrl = urlData.publicUrl + `?t=${Date.now()}`;
      }

      const payload: any = {
        tenant_id: tenant.id,
        internal_ref: form.internal_ref.trim(),
        name: form.name.trim(),
        description: form.description || '',
        category_id: form.category_id || null,
        brand: form.brand || '',
        oem_ref: form.oem_ref || '',
        supplier_ref: form.supplier_ref || '',
        barcode: form.barcode || '',
        supplier_id: form.supplier_id || null,
        condition: form.condition || 'neuf',
        unit: form.unit || 'pièce',
        purchase_price: Number(form.purchase_price || 0),
        sale_price: Number(form.sale_price || 0),
        min_price: Number(form.min_price || 0),
        wholesale_price: Number(form.wholesale_price || 0),
        vat_rate: Number(form.vat_rate || 0),
        stock_min: Number(form.stock_min || 0),
        stock_max: Number(form.stock_max || 0),
        location: form.location || '',
        image_url: finalImageUrl,
        ipm_eligible: form.ipm_eligible !== false,
        track_stock: form.track_stock !== false,
      };

      let articleId = currentArticleId;

      if (isCreate) {
        if (!sharedArticles && currentSite) payload.site_id = currentSite.id;
        const { data, error: e } = await supabase.from('articles').insert(payload).select().single();
        if (e) throw e;
        if (!data?.id) throw new Error('La référence de l’article créé est introuvable.');
        const createdArticleId: string = data.id;
        articleId = createdArticleId;

        // Re-upload image to real path
        if (imageFile && articleId && finalImageUrl) {
          const ext = imageFile.name.split('.').pop()?.toLowerCase() || 'jpg';
          const realPath = `${tenant.id}/articles/${articleId}/main.${ext}`;
          await supabase.storage.from('article-images').upload(realPath, imageFile, { upsert: true, contentType: imageFile.type });
          const { data: urlData } = supabase.storage.from('article-images').getPublicUrl(realPath);
          const realUrl = urlData.publicUrl + `?t=${Date.now()}`;
          await supabase.from('articles').update({ image_url: realUrl }).eq('id', articleId);
        }

        // Apply stock initial only once during creation
        if (form.stock_init && Number(form.stock_init) > 0 && currentSite) {
          await supabase.rpc('adjust_stock', {
            p_article_id: articleId, p_site_id: currentSite.id,
            p_quantity: Number(form.stock_init), p_movement_type: 'initial', p_note: 'Stock initial',
          });
        }

        // Transition to edit mode so subsequent saves are UPDATEs
        setCurrentArticleId(articleId);
        setFormMode('edit');
        setEditing(data as Article);
        setForm(f => ({ ...f, id: createdArticleId, stock_init: 0 }));
        setImageFile(null);
        pendingReloadRef.current = true;
      } else if (articleId) {
        const { error: e } = await supabase.from('articles').update(payload).eq('id', articleId);
        if (e) throw e;

        // Local update: patch article in list without reloading
        setArticles(prev => prev.map(a => a.id === articleId ? { ...a, ...payload, id: articleId } as Article : a));
      }

      // Save compats
      if (articleId) {
        if (!isCreate) await supabase.from('article_compatibilities').delete().eq('article_id', articleId);
        const newCompats = compats.filter(c => c.brand_id);
        if (newCompats.length > 0) {
          await supabase.from('article_compatibilities').insert(
            newCompats.map(c => ({ tenant_id: tenant.id, article_id: articleId, brand_id: c.brand_id || null, model_id: c.model_id || null, year_start: c.year_start || 0, year_end: c.year_end || 0, notes: c.notes || '' }))
          );
        }

        // Save pricing tiers
        if (!isCreate) await supabase.from('article_pricing_tiers').delete().eq('article_id', articleId);
        const tiersToSave = formTiers
          .filter(t => t.price !== '' && Number(t.price) > 0)
          .map((t, idx) => ({
            tenant_id: tenant.id,
            article_id: articleId,
            tier_name: t.tier_name,
            price: Number(t.price),
            sort_order: idx,
          }));
        if (tiersToSave.length > 0) {
          await supabase.from('article_pricing_tiers').insert(tiersToSave);
        }
      }

      // Update snapshot
      savedSnapshotRef.current = getFormSnapshot(form, compats, formTiers);
      setSaveState('saved');
      userTouchedRef.current = false;

      // Handle intent
      if (intent === 'new') {
        if (!silent) success('Article créé');
        initCreateForm();
        // Focus designation field after a tick
        setTimeout(() => { document.querySelector<HTMLInputElement>('[data-field="designation"]')?.focus(); }, 50);
      } else if (intent === 'close') {
        if (!silent) success(isCreate ? 'Article créé' : 'Article modifié');
        setEditorSurface(null);
        if (pendingReloadRef.current) { await loadPage(page, true); pendingReloadRef.current = false; }
      } else {
        if (!silent) success(isCreate ? 'Article créé' : 'Article modifié');
        if (!silent && !isCreate) {
          // Don't reload list on every auto-save, mark for reload on close
          pendingReloadRef.current = true;
        }
      }

      return true;
    } catch (e: any) {
      const msg = e.message || '';
      setSaveState('error');
      if (!silent) {
        if (msg.includes('Limite du plan')) {
          error(msg.replace('Mettez à niveau votre abonnement.', '').trim());
        } else if (msg.includes('unique')) {
          error('Cette référence existe déjà');
        } else {
          error(msg || 'Erreur d\'enregistrement');
        }
      }
      return false;
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!toDelete) return;
    if (!can('manage_articles')) { error('Vous n\'avez pas la permission de supprimer les articles'); return; }
    const { error: hardErr } = await supabase.rpc('tenant_delete_article_safe', { p_id: toDelete.id });
    if (!hardErr) { success('Article supprimé définitivement'); loadPage(page, true); return; }
    const { error: softErr } = await supabase.from('articles').update({ is_active: false }).eq('id', toDelete.id);
    if (softErr) error(softErr.message);
    else { success('Article désactivé (opérations associées conservées)'); loadPage(page, true); }
  };

  const toggleSelectionMode = () => {
    setSelectionMode(m => { if (m) setSelectedIds(new Set()); return !m; });
  };
  const toggleSelected = (id: string) => {
    setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const selectAllFiltered = () => setSelectedIds(new Set(paginated.map(a => a.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!can('manage_articles')) { error('Vous n\'avez pas la permission de supprimer les articles'); return; }
    setBulkDeleting(true);
    let deleted = 0, deactivated = 0;
    try {
      for (const id of Array.from(selectedIds)) {
        const { error: hardErr } = await supabase.rpc('tenant_delete_article_safe', { p_id: id });
        if (!hardErr) { deleted++; continue; }
        const { error: softErr } = await supabase.from('articles').update({ is_active: false }).eq('id', id);
        if (!softErr) deactivated++;
      }
      if (deleted + deactivated > 0) success(`${deleted} supprimé(s), ${deactivated} désactivé(s)`);
      setBulkConfirmOpen(false); setSelectedIds(new Set()); setSelectionMode(false);
      await loadPage(0, true); setPage(0);
    } catch (e: any) { error(e.message || 'Erreur'); }
    finally { setBulkDeleting(false); }
  };

  const applyBulkAction = async () => {
    if (selectedIds.size === 0 || !bulkAction) return;
    if (!can('manage_articles')) { error('Vous n\'avez pas la permission de modifier les articles'); return; }
    setBulkDeleting(true);
    try {
      const ids = Array.from(selectedIds);
      let payload: any = {};
      if (bulkAction === 'category') payload = { category_id: bulkActionValue || null };
      else if (bulkAction === 'supplier') payload = { supplier_id: bulkActionValue || null };
      else if (bulkAction === 'deactivate') payload = { is_active: false };
      else if (bulkAction === 'unit') payload = { unit: bulkActionValue };
      else if (bulkAction === 'track_stock_on') payload = { track_stock: true };
      else if (bulkAction === 'track_stock_off') payload = { track_stock: false };
      else return;
      for (const id of ids) {
        await supabase.from('articles').update(payload).eq('id', id);
      }
      success(`${ids.length} article(s) modifié(s)`);
      setBulkActionOpen(false); setSelectedIds(new Set()); setSelectionMode(false);
      setBulkAction(''); setBulkActionValue('');
      await loadPage(0, true); setPage(0);
    } catch (e: any) { error(e.message || 'Erreur'); }
    finally { setBulkDeleting(false); }
  };

  const saveListEdits = async () => {
    if (listEdits.size === 0 || !tenant) return;
    if (!can('manage_articles')) { error('Vous n\'avez pas la permission de modifier les articles'); return; }
    setListSaving(true);
    let count = 0;
    try {
      for (const [id, patch] of listEdits.entries()) {
        const clean: any = {};
        if (patch.name !== undefined) clean.name = patch.name;
        if (patch.internal_ref !== undefined) clean.internal_ref = patch.internal_ref;
        if (patch.category_id !== undefined) clean.category_id = patch.category_id || null;
        if (patch.sale_price !== undefined) clean.sale_price = Number(patch.sale_price || 0);
        if (patch.wholesale_price !== undefined) clean.wholesale_price = Number(patch.wholesale_price || 0);
        if (patch.stock_min !== undefined) clean.stock_min = Number(patch.stock_min || 0);
        if (patch.unit !== undefined) clean.unit = patch.unit;
        if (patch.brand !== undefined) clean.brand = patch.brand;
        if (patch.barcode !== undefined) clean.barcode = patch.barcode;
        if (patch.purchase_price !== undefined) clean.purchase_price = Number(patch.purchase_price || 0);
        if (patch.supplier_id !== undefined) clean.supplier_id = patch.supplier_id || null;
        if ((patch as any).is_active !== undefined) clean.is_active = (patch as any).is_active;
        if ((patch as any).track_stock !== undefined) clean.track_stock = (patch as any).track_stock;
        if (Object.keys(clean).length === 0) continue;
        const { error: e } = await supabase.from('articles').update(clean).eq('id', id);
        if (e) throw e;
        count++;
      }
      success(`${count} article(s) modifié(s)`);
      setListEdits(new Map());
      await loadPage(page, true);
    } catch (e: any) { error(e.message || 'Erreur'); }
    finally { setListSaving(false); }
  };

  const saveAndClose = async () => {
    if (articleTransitionRef.current || saving) return;
    if (autoSaveRef.current) { clearTimeout(autoSaveRef.current); autoSaveRef.current = null; }
    if ((formMode === 'create' && !currentArticleId && !form.name?.trim()) || !isDirty()) {
      setEditorSurface(null);
      if (pendingReloadRef.current) { loadPage(page, true); pendingReloadRef.current = false; }
      return;
    }
    await save({ intent: 'close' });
  };

  const saveAndNew = async () => {
    if (articleTransitionRef.current || saving) return;
    if (autoSaveRef.current) { clearTimeout(autoSaveRef.current); autoSaveRef.current = null; }
    await save({ intent: 'new' });
  };

  const openArticle = async (article: Article, surface: EditorSurface) => {
    if (articleTransitionRef.current || saving || (editorSurface && article.id === currentArticleId)) return;
    articleTransitionRef.current = true;
    setSwitchingArticle(true);
    if (autoSaveRef.current) { clearTimeout(autoSaveRef.current); autoSaveRef.current = null; }

    try {
      if (editorSurface && isDirty() && !await save({ silent: true })) {
        error('La fiche actuelle contient des modifications à enregistrer.');
        return;
      }
      if (await loadArticle(article)) setEditorSurface(surface);
    } catch {
      error('Impossible de charger cette fiche article. Réessayez.');
    } finally {
      articleTransitionRef.current = false;
      setSwitchingArticle(false);
    }
  };

  const openFullScreen = (article: Article) => void openArticle(article, 'desktop');

  const navigateArticle = (direction: -1 | 1) => {
    const article = paginated[editingIndex + direction];
    if (editorSurface && editingIndex >= 0 && article) void openArticle(article, editorSurface);
  };

  // Track user interaction for dirty detection
  const wrappedSetForm = useCallback((updater: Form | ((p: Form) => Form)) => {
    userTouchedRef.current = true;
    setSaveState(s => s === 'saved' || s === 'idle' ? 'dirty' : s);
    setForm(updater);
  }, []);

  useEffect(() => {
    if (editorSurface !== 'desktop' || articleTransitionRef.current) return;
    // Auto-save only for existing articles (edit mode with id)
    if (!currentArticleId) return;
    if (!userTouchedRef.current) return;
    if (!isDirty()) return;

    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(() => {
      if (!articleTransitionRef.current && form.name?.trim() && form.internal_ref?.trim()) {
        save({ silent: true });
      }
    }, 1200);
    return () => { if (autoSaveRef.current) clearTimeout(autoSaveRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, compats, formTiers, editorSurface, currentArticleId]);

  const allFilteredSelected = paginated.length > 0 && paginated.every(a => selectedIds.has(a.id));

  // ── Import / Export ──
  const TENANT_IMPORT_HEADERS = [
    { key: 'designation', label: 'Désignation *', required: true },
    { key: 'reference_interne', label: 'Référence interne', required: false },
    { key: 'categorie', label: 'Catégorie', required: false },
    { key: 'marque', label: 'Marque', required: false },
    { key: 'ref_oem', label: 'Réf OEM', required: false },
    { key: 'ref_fournisseur', label: 'Réf fournisseur', required: false },
    { key: 'code_barres', label: 'Code-barres', required: false },
    { key: 'unite', label: 'Unité', required: false },
    { key: 'prix_achat', label: 'Prix achat', required: false },
    { key: 'prix_vente', label: 'Prix vente', required: false },
    { key: 'prix_minimum', label: 'Prix minimum', required: false },
    { key: 'prix_gros', label: 'Prix gros', required: false },
    { key: 'taux_tva', label: 'TVA (%)', required: false },
    { key: 'stock_min', label: 'Stock min', required: false },
    { key: 'stock_max', label: 'Stock max', required: false },
    { key: 'stock_initial', label: 'Stock initial', required: false },
    { key: 'emplacement', label: 'Emplacement', required: false },
    { key: 'description', label: 'Description', required: false },
  ];

  const downloadArticleTemplate = async () => {
    const XLSX = await import('xlsx');
    const headerRow = TENANT_IMPORT_HEADERS.map(h => h.label);
    const sampleRow = ['Plaquette de frein avant', 'ART-0001', 'Freinage', 'Bosch', '0986AB1234', '', '', 'pièce', '15000', '25000', '20000', '22000', '18', '5', '50', '10', 'Rayon A1', ''];
    const ws = XLSX.utils.aoa_to_sheet([headerRow, sampleRow]);
    ws['!cols'] = headerRow.map(h => ({ wch: Math.max(16, h.length + 4) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Articles');
    XLSX.writeFile(wb, 'modele-import-articles.xlsx');
  };

  const exportArticles = async () => {
    const XLSX = await import('xlsx');
    const exportSite = importTargetSite || (!sharedArticles && currentSite ? currentSite.id : null);
    const { data, error: expErr } = await supabase.rpc('export_tenant_articles', exportSite ? { p_site_id: exportSite } : {});
    if (expErr) { error(expErr.message); return; }
    const rows = (data || []) as any[];
    if (rows.length === 0) { error('Aucun article à exporter'); return; }
    const headerRow = TENANT_IMPORT_HEADERS.map(h => h.label);
    const dataRows = rows.map((r: any) => [
      r.designation || '', r.reference_interne || '', r.categorie || '',
      r.marque || '', r.ref_oem || '', r.ref_fournisseur || '',
      r.code_barres || '', r.unite || '',
      r.prix_achat || 0, r.prix_vente || 0, r.prix_minimum || 0, r.prix_gros || 0,
      r.taux_tva || 0, r.stock_min || 0, r.stock_max || 0,
      r.stock_initial || 0, r.emplacement || '', r.description || '',
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
    ws['!cols'] = headerRow.map(h => ({ wch: Math.max(16, h.length + 4) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Articles');
    XLSX.writeFile(wb, `export-articles-${new Date().toISOString().slice(0, 10)}.xlsx`);
    success(`${rows.length} articles exportés`);
  };

  const handleImportFile = async (f: File) => {
    setImportFilename(f.name);
    const XLSX = await import('xlsx');
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) { error('Fichier vide'); return; }
    const sheet = wb.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '', raw: false });
    const labelToKey = new Map<string, string>();
    TENANT_IMPORT_HEADERS.forEach(h => {
      const norm = h.label.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_').replace(/_+$/, '').replace(/^_+/, '');
      labelToKey.set(norm, h.key);
    });
    const parsed = raw.map(r => {
      const row: any = {};
      for (const k of Object.keys(r)) {
        const norm = k.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_').replace(/_+$/, '').replace(/^_+/, '');
        const key = labelToKey.get(norm) || norm;
        row[key] = String(r[k] ?? '').trim();
      }
      return row;
    });
    if (parsed.length === 0) { error('Aucune ligne trouvée'); return; }
    setImportRows(parsed);
    setImportResult(null);
  };

  const runArticleImport = async () => {
    if (importRows.length === 0) return;
    // In independent catalog mode, a target site is mandatory
    const targetSite = importTargetSite || (currentSite?.id ?? null);
    if (!sharedArticles && !targetSite) {
      error('En mode catalogue indépendant, vous devez sélectionner un magasin cible pour l\'import');
      return;
    }
    setImportingArticles(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc('bulk_import_tenant_articles', {
        p_rows: importRows,
        p_site_id: targetSite,
      });
      if (rpcErr) throw rpcErr;
      setImportResult(data as any);
      success('Import terminé');
      await loadPage(0, true); setPage(0);
    } catch (e: any) { error(e.message); }
    finally { setImportingArticles(false); }
  };

  const resetImport = () => { setImportRows([]); setImportFilename(''); setImportResult(null); };

  // ── Guide catalogue maître ──
  const guideKey = tenant ? `waarwi:articles_guide_dismissed:${tenant.id}` : '';
  const [guideDismissed, setGuideDismissed] = useState<boolean>(() => {
    try { return guideKey ? localStorage.getItem(guideKey) === '1' : false; } catch { return false; }
  });
  const [guideStep, setGuideStep] = useState(0);
  const dismissGuide = () => { setGuideDismissed(true); try { if (guideKey) localStorage.setItem(guideKey, '1'); } catch {} };
  const reopenGuide = () => { setGuideDismissed(false); setGuideStep(0); try { if (guideKey) localStorage.removeItem(guideKey); } catch {} };
  const goToMasterCatalog = () => { onNavigate?.('master_catalog'); };

  const TABS: { k: TabKey; l: string; icon: any }[] = [
    { k: 'infos', l: 'Informations', icon: Info },
    { k: 'prix', l: 'Prix', icon: DollarSign },
    { k: 'stock', l: 'Stock', icon: Boxes },
    ...(autoMode ? [{ k: 'compat' as TabKey, l: 'Compatibilité', icon: Car }] : []),
    { k: 'image', l: 'Image', icon: Camera },
  ];

  const selectedCategoryName = categoryFilter
    ? categories.find(c => c.id === categoryFilter)?.name || 'Catégorie'
    : 'Toutes les catégories';

  const updateListEdit = (id: string, field: string, value: any) => {
    setListEdits(prev => {
      const n = new Map(prev);
      const existing = n.get(id) || {};
      n.set(id, { ...existing, [field]: value });
      return n;
    });
  };

  const listEditCount = listEdits.size;

  const saveListEditsRef = useRef(saveListEdits);
  saveListEditsRef.current = saveListEdits;

  useEffect(() => {
    return () => { saveListEditsRef.current(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="article-page space-y-3">
      <header className="article-page-header">
        <div className="article-page-title">
          <h1>Articles</h1>
          <button type="button" onClick={openCreate} className="btn-primary article-button">
            <PackagePlus size={16} aria-hidden="true" />Nouvel article
          </button>
        </div>
        <PageSearch value={searchInput} onChange={handleSearchInput} placeholder="Référence ou désignation…" />
        <div className="article-toolbar" aria-label="Actions du catalogue">
          <button type="button" onClick={() => setFilterOpen(true)} className="btn-secondary article-button">
            <Filter size={15} aria-hidden="true" />
            {categoryFilter ? selectedCategoryName : 'Catégorie'}
          </button>
          <button type="button" onClick={toggleSelectionMode} aria-pressed={selectionMode} className="btn-secondary article-button">
            <CheckSquare size={15} aria-hidden="true" />{selectionMode ? 'Quitter la sélection' : 'Sélectionner'}
          </button>
          <div className="hidden md:block">
            <button type="button" onClick={() => setViewMode(viewMode === 'list' ? 'cards' : 'list')} className="btn-secondary article-button">
              {viewMode === 'list' ? <LayoutGrid size={15} aria-hidden="true" /> : <List size={15} aria-hidden="true" />}
              {viewMode === 'list' ? 'Liste de consultation' : 'Édition en liste'}
            </button>
          </div>
          <button type="button" onClick={() => { if (!sharedArticles && currentSite) setImportTargetSite(currentSite.id); setImportExportOpen(true); }} className="btn-secondary article-button">
            <Download size={15} aria-hidden="true" />Excel
          </button>
        </div>
      </header>

      {/* ── Guide interactif ─────────────────────── */}
      {!guideDismissed && <MasterCatalogGuide step={guideStep} articleCount={totalCount} onStep={setGuideStep} onDismiss={dismissGuide} onGo={goToMasterCatalog} />}
      {guideDismissed && (
        <button onClick={reopenGuide} className="btn-ghost article-button">
          <Lightbulb className="w-3.5 h-3.5" />Revoir le guide d'ajout depuis le catalogue maître
        </button>
      )}

      {/* ── Barre de sélection en masse ────── */}
      {selectionMode && (
        <div className="article-toolbar article-separator">
          <button onClick={allFilteredSelected ? clearSelection : selectAllFiltered} className="btn-ghost article-button">
            {allFilteredSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
            {allFilteredSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
          </button>
          <div className="article-muted">
            <span className="num font-semibold">{selectedIds.size}</span> sélectionné{selectedIds.size > 1 ? 's' : ''}
          </div>
          <div className="flex-1" />
          <button onClick={() => { setBulkAction(''); setBulkActionValue(''); setBulkActionOpen(true); }} disabled={selectedIds.size === 0} className="btn-primary article-button">
            <MoreHorizontal className="w-3.5 h-3.5" />Action en masse
          </button>
          <button onClick={() => setBulkConfirmOpen(true)} disabled={selectedIds.size === 0} className="btn-danger article-button">
            <Trash2 className="w-3.5 h-3.5" />Supprimer
          </button>
        </div>
      )}

      {/* Stats chips */}
      <div className="article-toolbar text-xs font-semibold">
        <button onClick={() => setStockFilter('all')} className={`shrink-0 py-1 num transition-all ${stockFilter === 'all' ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}>{totalCount} article{totalCount > 1 ? 's' : ''}</button>
        {refreshing && <RefreshCw className="w-3 h-3 animate-spin text-neutral-400 shrink-0" />}
        {stats.inStock > 0 && <button type="button" aria-pressed={stockFilter === 'in'} onClick={() => setStockFilter(f => f === 'in' ? 'all' : 'in')} className={`shrink-0 py-1 inline-flex items-center gap-1 transition-all cursor-pointer ${stockFilter === 'in' ? 'text-emerald-700' : 'text-emerald-500/70 hover:text-emerald-700'}`}><span className={`w-1.5 h-1.5 rounded-full ${stockFilter === 'in' ? 'bg-emerald-600' : 'bg-emerald-400'}`} />{stats.inStock} en stock</button>}
        {stats.low > 0 && <button type="button" aria-pressed={stockFilter === 'low'} onClick={() => setStockFilter(f => f === 'low' ? 'all' : 'low')} className={`shrink-0 py-1 transition-all cursor-pointer ${stockFilter === 'low' ? 'text-amber-700' : 'text-amber-500/70 hover:text-amber-700'}`}>{stats.low} stock bas</button>}
        {stats.out > 0 && <button type="button" aria-pressed={stockFilter === 'out'} onClick={() => setStockFilter(f => f === 'out' ? 'all' : 'out')} className={`shrink-0 py-1 transition-all cursor-pointer ${stockFilter === 'out' ? 'text-red-700' : 'text-red-500/70 hover:text-red-700'}`}>{stats.out} rupture{stats.out > 1 ? 's' : ''}</button>}
        {categoryFilter && <button onClick={() => setCategoryFilter('')} className="shrink-0 py-1 text-brand-700 inline-flex items-center gap-1">{selectedCategoryName} <X className="w-3 h-3" /></button>}
        {stockFilter !== 'all' && <button onClick={() => setStockFilter('all')} className="shrink-0 py-1 text-slate-400 inline-flex items-center gap-1 hover:text-slate-600 transition-all"><X className="w-3 h-3" /> Effacer filtre</button>}
      </div>

      {/* ── Liste ─────────────────────────────── */}
      {loadError ? (
        <div className="article-status-line" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <div><strong>Chargement des articles impossible</strong><p className="article-muted">{loadError}</p></div>
          <button type="button" onClick={() => { setLoadError(null); loadPage(page); }} className="btn-secondary article-button">Réessayer</button>
        </div>
      ) : !initialLoaded && loading ? (
        <div className="article-status-line" role="status"><Loader2 size={16} className="animate-spin" aria-hidden="true" />Chargement des articles…</div>
      ) : paginated.length === 0 ? (
        <EmptyState icon={Package} title={search || categoryFilter || stockFilter !== 'all' ? 'Aucun article trouvé' : 'Aucun article'}
          description={search || categoryFilter || stockFilter !== 'all' ? 'Modifiez la recherche ou les filtres.' : undefined}
          action={!search && !categoryFilter && stockFilter === 'all' ? <button type="button" onClick={openCreate} className="btn-primary article-button"><PackagePlus size={16} aria-hidden="true" />Nouvel article</button> : undefined} />
      ) : (
        <>
          {/* Mobile: lignes */}
          <div className="md:hidden">
            {paginated.map(a => (
              <ArticleCard key={a.id} article={a} category={categoryMap.get(a.category_id || '')} qty={stockMap[a.id] || 0}
                onEdit={() => selectionMode ? toggleSelected(a.id) : void openArticle(a, 'mobile')} onDelete={() => setToDelete(a)}
                selectionMode={selectionMode} selected={selectedIds.has(a.id)} onToggleSelect={() => toggleSelected(a.id)}
                showMargin={can('view_margins')} showStock={can('view_stock_levels')} />
            ))}
          </div>

          {/* Desktop: vue liste éditable ou cartes */}
          <div className="hidden md:block">
            {viewMode === 'list' ? (
              <DesktopListView
                articles={paginated} categoryMap={categoryMap} stockMap={stockMap} suppliers={suppliers}
                categories={categories} listEdits={listEdits} onUpdateEdit={updateListEdit}
                selectionMode={selectionMode} selectedIds={selectedIds} onToggleSelect={toggleSelected}
                onSelectAll={allFilteredSelected ? clearSelection : selectAllFiltered} allSelected={allFilteredSelected}
                onOpenFullScreen={openFullScreen} onDelete={setToDelete}
                showMargin={can('view_margins')} showStock={can('view_stock_levels')} showPurchase={can('view_purchase_prices')}
                sortCol={sortCol} sortDir={sortDir}
                onSort={(col) => { setSortCol(col as any); setSortDir(d => sortCol === col ? (d === 'asc' ? 'desc' : 'asc') : 'asc'); }}
              />
            ) : (
              <div className="overflow-hidden">
                <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 300px)' }}>
                <table className="w-full text-sm">
                  <thead className="text-[11px] text-[var(--w-text-sec)] border-b border-[var(--w-separator)] sticky top-0 z-10 bg-[var(--w-surface-el)]">
                    <tr>
                      {selectionMode && <th className="px-3 py-3 w-10"><button onClick={allFilteredSelected ? clearSelection : selectAllFiltered} className="text-brand-700">{allFilteredSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}</button></th>}
                      <th className="px-4 py-3 text-left font-semibold cursor-pointer select-none hover:text-brand-700 transition-colors min-w-0" onClick={() => { setSortCol('name'); setSortDir(d => sortCol === 'name' ? (d === 'asc' ? 'desc' : 'asc') : 'asc'); }}>
                        <span className="inline-flex items-center gap-1">Article {sortCol === 'name' ? (sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-brand-600" /> : <ChevronDown className="w-3 h-3 text-brand-600" />) : <ChevronDown className="w-3 h-3 opacity-30" />}</span>
                      </th>
                      <th className="px-4 py-3 text-left font-semibold cursor-pointer select-none hover:text-brand-700 transition-colors" onClick={() => { setSortCol('category'); setSortDir(d => sortCol === 'category' ? (d === 'asc' ? 'desc' : 'asc') : 'asc'); }}>
                        <span className="inline-flex items-center gap-1">Catégorie {sortCol === 'category' ? (sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-brand-600" /> : <ChevronDown className="w-3 h-3 text-brand-600" />) : <ChevronDown className="w-3 h-3 opacity-30" />}</span>
                      </th>
                      <th className="px-4 py-3 text-right font-semibold cursor-pointer select-none hover:text-brand-700 transition-colors" onClick={() => { setSortCol('price'); setSortDir(d => sortCol === 'price' ? (d === 'asc' ? 'desc' : 'asc') : 'asc'); }}>
                        <span className="inline-flex items-center gap-1 justify-end">Prix vente {sortCol === 'price' ? (sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-brand-600" /> : <ChevronDown className="w-3 h-3 text-brand-600" />) : <ChevronDown className="w-3 h-3 opacity-30" />}</span>
                      </th>
                      {can('view_margins') && <th className="px-4 py-3 text-right font-semibold">Marge</th>}
                      <th className="px-4 py-3 text-right font-semibold"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--w-separator)]">
                    {paginated.map(a => {
                      const cat = categoryMap.get(a.category_id || '');
                      const mg = a.sale_price > 0 ? ((a.sale_price - a.purchase_price) / a.sale_price) * 100 : 0;
                      const mgTone = mg >= 30 ? 'text-emerald-600' : mg >= 15 ? 'text-amber-600' : 'text-red-600';
                      const isSel = selectedIds.has(a.id);
                      return (
                        <tr key={a.id} className={`group transition-colors ${isSel ? 'bg-[var(--w-active)]' : 'hover:bg-[var(--w-hover)]'} ${selectionMode ? 'cursor-pointer' : ''}`} onClick={selectionMode ? () => toggleSelected(a.id) : undefined}>
                          {selectionMode && <td className="px-3 py-3 w-10"><span className="text-brand-700">{isSel ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-slate-400" />}</span></td>}
                          <td className="px-4 py-3"><div className="min-w-0"><div className="font-semibold text-[var(--w-text)] break-words">{a.name}</div>{a.oem_ref && <div className="text-[11px] text-slate-400 font-mono truncate">OEM: {a.oem_ref}</div>}</div></td>
                          <td className="px-4 py-3 text-slate-600 text-xs truncate max-w-[160px]">{cat?.name || '—'}</td>
                          <td className="px-4 py-3 text-right font-bold text-slate-900 num">{formatFCFA(a.sale_price)}</td>
                          {can('view_margins') && <td className="px-4 py-3 text-right"><span className={`text-[10px] font-bold num ${mgTone}`}>{mg.toFixed(0)}%</span></td>}
                          <td className="px-4 py-3 text-right"><div className="inline-flex gap-1 opacity-60 group-hover:opacity-100"><button onClick={(e) => { e.stopPropagation(); openFullScreen(a); }} className="p-1.5 rounded-lg hover:bg-brand-100 text-slate-600 hover:text-brand-700"><Pencil className="w-4 h-4" /></button><button onClick={(e) => { e.stopPropagation(); setToDelete(a); }} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button></div></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </div>
            )}

            {/* List edit save bar */}
            {viewMode === 'list' && listEditCount > 0 && (
              <div className="article-toolbar article-separator">
                <Save className="w-4 h-4 text-brand-600" />
                <span className="text-xs font-semibold text-[var(--w-text)]">{listEditCount} modification{listEditCount > 1 ? 's' : ''} en attente</span>
                <div className="flex-1" />
                <button onClick={() => setListEdits(new Map())} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
                <button onClick={saveListEdits} disabled={listSaving} className="btn-primary article-button">
                  {listSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}Enregistrer
                </button>
              </div>
            )}
          </div>

          {/* Pagination */}
          {totalCount > PAGE_SIZE && (
            <div className="article-pagination">
              <div className="text-xs text-slate-500">{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} sur {totalCount} articles</div>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(0)} disabled={page === 0} className="px-2 py-1 rounded-lg text-[11px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">&laquo;&laquo;</button>
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-2 py-1 rounded-lg text-[11px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"><ChevronLeft className="w-3.5 h-3.5" /></button>
                <span className="article-page-number num">{page + 1} / {totalPages}</span>
                <button onClick={() => setPage(p => p + 1)} disabled={!hasMore} className="px-2 py-1 rounded-lg text-[11px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"><ChevronRight className="w-3.5 h-3.5" /></button>
                <button onClick={() => setPage(totalPages - 1)} disabled={!hasMore} className="px-2 py-1 rounded-lg text-[11px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">&raquo;&raquo;</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Category filter modal ────── */}
      <CategoryPickerModal open={filterOpen} onClose={() => setFilterOpen(false)} categories={categories} selected={categoryFilter} onSelect={v => { setCategoryFilter(v); setFilterOpen(false); }} />

      {/* ── Full-screen edit (desktop) ────── */}
      {editorSurface === 'desktop' && (
        <FullScreenArticleEdit
          form={form} setForm={wrappedSetForm} editing={editing} tab={tab} setTab={setTab}
          TABS={TABS} save={() => save()} saveAndNew={saveAndNew} saveAndClose={saveAndClose}
          saving={saving} switchingArticle={switchingArticle} saveState={saveState} formMode={formMode}
          compats={compats} setCompats={setCompats}
          categories={categories} suppliers={suppliers} brands={brands} models={models}
          autoMode={autoMode} generateRef={generateRef} addCompat={addCompat} removeCompat={removeCompat}
          createCategory={createCategory}
          imagePreview={imagePreview} imageUploading={imageUploading}
          onFileSelect={file => { setImageFile(file); setImageDeletePending(false); setImagePreview(URL.createObjectURL(file)); userTouchedRef.current = true; }}
          onDeleteImage={() => { setImageFile(null); setImagePreview(null); setImageDeletePending(true); userTouchedRef.current = true; }}
          marginValue={marginValue} marginStr={marginStr}
          showPurchasePrice={can('view_purchase_prices')} showMargin={can('view_margins')}
          stockMap={stockMap} formTiers={formTiers} setFormTiers={setFormTiers} tierDefinitions={tierDefinitions} isPharmacy={isPharmacy}
          onClose={saveAndClose}
          onPrev={!switchingArticle && !saving && editingIndex > 0 ? () => navigateArticle(-1) : undefined}
          onNext={!switchingArticle && !saving && editingIndex >= 0 && editingIndex < paginated.length - 1 ? () => navigateArticle(1) : undefined}
          editingIndex={editingIndex} totalCount={paginated.length}
          filtered={paginated} onJumpTo={openFullScreen}
        />
      )}

      {/* ── Drawer article (mobile + fallback) ────── */}
      {editorSurface === 'mobile' && (
        <MobileArticleEdit
          form={form} setForm={wrappedSetForm}
          editing={editing} tab={tab} setTab={setTab}
          save={() => save()} saveAndNew={saveAndNew} saveAndClose={saveAndClose}
          saving={saving} switchingArticle={switchingArticle} saveState={saveState} formMode={formMode}
          compats={compats} setCompats={setCompats}
          categories={categories} suppliers={suppliers}
          brands={brands} models={models}
          autoMode={autoMode} generateRef={generateRef}
          addCompat={addCompat} removeCompat={removeCompat}
          createCategory={createCategory}
          imagePreview={imagePreview} imageUploading={imageUploading}
          onFileSelect={(f) => { setImageFile(f); setImageDeletePending(false); setImagePreview(URL.createObjectURL(f)); userTouchedRef.current = true; }}
          onDeleteImage={() => { setImageFile(null); setImagePreview(null); setImageDeletePending(true); userTouchedRef.current = true; }}
          marginValue={marginValue} marginStr={marginStr}
          showPurchasePrice={can('view_purchase_prices')} showMargin={can('view_margins')}
          stockMap={stockMap}
          formTiers={formTiers} setFormTiers={setFormTiers} tierDefinitions={tierDefinitions}
          isPharmacy={isPharmacy}
          onClose={saveAndClose}
          onPrev={!switchingArticle && !saving && editingIndex > 0 ? () => navigateArticle(-1) : undefined}
          onNext={!switchingArticle && !saving && editingIndex >= 0 && editingIndex < paginated.length - 1 ? () => navigateArticle(1) : undefined}
          editingIndex={editingIndex} totalCount={paginated.length}
        />
      )}

      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={del} title="Supprimer l'article ?" message={`"${toDelete?.name}" sera supprimé définitivement s'il n'est utilisé dans aucune opération, sinon simplement désactivé.`} confirmLabel="Supprimer" danger />
      <ConfirmDialog open={bulkConfirmOpen} onClose={() => { if (!bulkDeleting) setBulkConfirmOpen(false); }} onConfirm={bulkDelete} title={`Supprimer ${selectedIds.size} article${selectedIds.size > 1 ? 's' : ''} ?`} message="Les articles sélectionnés seront supprimés ou désactivés. Cette action ne peut pas être annulée." confirmLabel={bulkDeleting ? 'Suppression…' : 'Supprimer la sélection'} danger />

      {/* ── Bulk action modal ────── */}
      <Modal open={bulkActionOpen} onClose={() => !bulkDeleting && setBulkActionOpen(false)} title={`Modifier ${selectedIds.size} article${selectedIds.size === 1 ? '' : 's'}`} size="sm" variant="flat" focusOnOpen
        footer={<>
          <button type="button" onClick={() => setBulkActionOpen(false)} disabled={bulkDeleting} className="btn-secondary article-button"><X size={15} aria-hidden="true" />Annuler</button>
          <button type="button" onClick={applyBulkAction} disabled={!bulkAction || bulkDeleting} className="btn-primary article-button">
            {bulkDeleting ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}Appliquer
          </button>
        </>}>
        <div className="space-y-3">
          <Field label="Action">
            <PremiumSelect value={bulkAction} onChange={v => { setBulkAction(v); setBulkActionValue(''); }}
              options={[
                { value: '', label: '— Choisir une action —' },
                { value: 'category', label: 'Changer la catégorie' },
                { value: 'supplier', label: 'Changer le fournisseur' },
                { value: 'unit', label: 'Modifier l\'unité' },
                { value: 'track_stock_on', label: 'Activer le suivi de stock' },
                { value: 'track_stock_off', label: 'Désactiver le suivi de stock (services)' },
                { value: 'deactivate', label: 'Mettre en sommeil' },
              ]} />
          </Field>
          {bulkAction === 'category' && (
            <Field label="Nouvelle catégorie">
              <PremiumSelect value={bulkActionValue} onChange={setBulkActionValue} placeholder="Choisir"
                options={[{ value: '', label: 'Sans catégorie' }, ...categories.filter(c => !c.parent_id).flatMap(c => [{ value: c.id, label: c.name, bold: true }, ...categories.filter(s => s.parent_id === c.id).map(s => ({ value: s.id, label: `  ↳ ${s.name}` }))])]} />
            </Field>
          )}
          {bulkAction === 'supplier' && (
            <Field label="Nouveau fournisseur">
              <PremiumSelect value={bulkActionValue} onChange={setBulkActionValue} placeholder="Choisir"
                options={[{ value: '', label: 'Aucun' }, ...suppliers.map(s => ({ value: s.id, label: s.name }))]} />
            </Field>
          )}
          {bulkAction === 'unit' && (
            <Field label="Nouvelle unité">
              <PremiumSelect value={bulkActionValue} onChange={setBulkActionValue}
                options={[{ value: 'unité', label: 'Unité' }, { value: 'pièce', label: 'Pièce' }, { value: 'paire', label: 'Paire' }, { value: 'lot', label: 'Lot' }, { value: 'kg', label: 'Kilogramme' }, { value: 'litre', label: 'Litre' }]} />
            </Field>
          )}
          {bulkAction === 'deactivate' && <p className="text-xs text-slate-500">Les {selectedIds.size} articles sélectionnés seront désactivés (mis en sommeil). Ils ne seront plus visibles dans le catalogue.</p>}
          {bulkAction === 'track_stock_on' && <p className="text-xs text-slate-500">Le suivi de stock sera <strong>activé</strong> pour les {selectedIds.size} articles sélectionnés.</p>}
          {bulkAction === 'track_stock_off' && <p className="text-xs text-amber-700 py-2 border-b border-amber-100">Le suivi de stock sera <strong>désactivé</strong> pour les {selectedIds.size} articles sélectionnés. Ils pourront être vendus sans contrainte de quantité (services, prestations).</p>}
        </div>
      </Modal>

      {/* ── Import / Export Modal ────── */}
      <Modal open={importExportOpen} onClose={() => { if (!importingArticles) { setImportExportOpen(false); resetImport(); } }} title="Import et export Excel" size="md" variant="flat" focusOnOpen
        footer={importRows.length > 0 ? <>
          <button type="button" onClick={resetImport} disabled={importingArticles} className="btn-secondary article-button"><X size={15} aria-hidden="true" />Effacer le fichier</button>
          <button type="button" onClick={runArticleImport} disabled={importingArticles} className="btn-primary article-button">
            {importingArticles ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Upload size={15} aria-hidden="true" />}
            Importer <span className="num">{importRows.length}</span>
          </button>
        </> : <button type="button" onClick={() => { setImportExportOpen(false); resetImport(); }} className="btn-secondary article-button">Fermer</button>}>
        <div className="space-y-4">
          {(() => {
            const ownDepots = depots.filter((d: any) => d.parent_site_id === currentSite?.id);
            const otherSites = sharedArticles ? sites.filter((s: any) => s.id !== currentSite?.id) : [];
            const otherDepots = sharedArticles ? depots.filter((d: any) => d.parent_site_id !== currentSite?.id) : [];
            const hasAlternatives = ownDepots.length > 0 || otherSites.length > 0 || otherDepots.length > 0;
            if (!hasAlternatives) return null;
            return (
              <div className="space-y-1.5">
                <label htmlFor="article-import-location" className="label">Emplacement du stock initial</label>
                <select
                  id="article-import-location"
                  value={importTargetSite}
                  onChange={e => setImportTargetSite(e.target.value)}
                  className="w-input-ul min-h-9"
                >
                  {sharedArticles && <option value="">Tous les emplacements (export agrégé)</option>}
                  {currentSite && <option value={currentSite.id}>{currentSite.name} (Magasin actuel)</option>}
                  {ownDepots.map((d: any) => (
                    <option key={d.id} value={d.id}>{d.name} (Dépôt)</option>
                  ))}
                  {otherSites.map((s: any) => (
                    <option key={s.id} value={s.id}>{s.name} (Magasin)</option>
                  ))}
                  {otherDepots.map((d: any) => (
                    <option key={d.id} value={d.id}>{d.name} (Dépôt)</option>
                  ))}
                </select>
                <p className="article-muted">
                  {sharedArticles
                    ? 'À l\'import, le stock initial sera affecté à cet emplacement. À l\'export, la colonne « Stock initial » reflétera le stock de cet emplacement.'
                    : 'Le stock initial sera affecté à l\'emplacement sélectionné (magasin actuel ou ses dépôts rattachés).'
                  }
                </p>
              </div>
            );
          })()}
          <div className="article-toolbar">
            <button type="button" onClick={downloadArticleTemplate} className="btn-secondary article-button"><Download size={15} aria-hidden="true" />Télécharger le modèle</button>
            <button type="button" onClick={exportArticles} className="btn-secondary article-button"><Upload size={15} aria-hidden="true" />Exporter les articles</button>
          </div>
          <div className="article-separator">
            <h3 className="text-sm font-semibold mb-2">Colonnes du fichier</h3>
            <ul className="article-import-columns">
              {TENANT_IMPORT_HEADERS.map(column => <li key={column.key}>{column.label}{column.required && ' *'}</li>)}
            </ul>
          </div>
          <label className="block min-w-0">
            <span className="label">Fichier Excel (.xlsx ou .xls)</span>
            <input type="file" accept=".xlsx,.xls" className="article-file-input" disabled={importingArticles}
              onChange={event => { const file = event.target.files?.[0]; if (file) void handleImportFile(file); event.target.value = ''; }} />
            {importFilename && <span className="article-muted block break-words mt-1">{importFilename} │ {importRows.length} ligne{importRows.length === 1 ? '' : 's'}</span>}
          </label>
          {importResult && (
            <div>
              <dl className="article-result-totals">
                <div><dt>Créés</dt><dd className="num">{importResult.imported}</dd></div>
                <div><dt>Mis à jour</dt><dd className="num">{importResult.updated}</dd></div>
                <div><dt>Erreurs</dt><dd className="num">{importResult.errors?.length || 0}</dd></div>
              </dl>
              {importResult.errors?.length > 0 && <ul className="article-result-errors">{importResult.errors.map((item, index) => <li key={index}>Ligne {item.row} │ {item.error}</li>)}</ul>}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}