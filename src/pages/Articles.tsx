import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Package, Trash2, Loader2, X, Car, DollarSign, Boxes, Info,
  CreditCard as Edit2, Filter, ChevronDown, ChevronUp,
  Upload, Camera, CheckSquare, Square,
  Lightbulb, Download,
  List, LayoutGrid, Save,
  MoreHorizontal, Check,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { usePermissions } from '../lib/permissions';
import { useToast } from '../context/ToastContext';
import { formatFCFA } from '../lib/format';
import { consumeNavContext } from '../lib/navHighlight';
import { ConfirmDialog, Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import type { Article, Category, VehicleBrand } from '../lib/types';
import { isAutoParts, BUSINESS_TYPE_LABELS } from '../lib/types';
import {
  stockStatus, Field, PremiumSelect,
  ArticleCard, CategoryFilterSheet, MasterCatalogGuide,
  DesktopListView, FullScreenArticleEdit, MobileArticleEdit,
} from './ArticlesComponents';

type Form = Partial<Article> & { stock_init?: number };
type Compat = { id?: string; brand_id: string; model_id: string; year_start: number; year_end: number; notes: string };
type PricingTier = { id: string; article_id: string; tier_name: string; price: number; sort_order: number };
type TierDefinition = { id: string; tier_name: string; sort_order: number; is_default: boolean };

type TabKey = 'infos' | 'prix' | 'stock' | 'compat' | 'image';

export function Articles({ onNavigate }: { onNavigate?: (route: string) => void } = {}) {
  const { tenant, currentSite, sites, depots, dataTick, refData } = useApp();
  const { can } = usePermissions();
  const autoMode = isAutoParts(tenant);
  const businessLabel = BUSINESS_TYPE_LABELS[tenant?.business_type || 'auto_parts'] || 'Catalogue';
  const { success, error } = useToast();
  const [articles, setArticles] = useState<Article[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<VehicleBrand[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'in' | 'low' | 'out'>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sortCol, setSortCol] = useState<'name' | 'ref' | 'category' | 'price' | 'stock'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const handleSearchInput = (val: string) => {
    setSearchInput(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(val), 200);
  };
  const [drawerOpen, setDrawerOpen] = useState(false);
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
  const [fullScreenOpen, setFullScreenOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState(-1);
  const [, setPricingTiers] = useState<PricingTier[]>([]);
  const [tierDefinitions, setTierDefinitions] = useState<TierDefinition[]>([]);
  const [formTiers, setFormTiers] = useState<Array<{ tier_name: string; price: number | '' }>>([]);

  const marginValue = form.purchase_price && form.sale_price && Number(form.sale_price) > 0
    ? ((Number(form.sale_price) - Number(form.purchase_price)) / Number(form.sale_price)) * 100
    : 0;
  const marginStr = marginValue.toFixed(1);

  const sharedArticles = (tenant as any)?.settings?.shared_articles !== false;

  const load = async (silent = false) => {
    if (!tenant) return;
    if (!silent) setLoading(true);

    // Fetch all articles in batches (Supabase default limit is 1000)
    let allArts: any[] = [];
    let from = 0;
    const batchSize = 1000;
    while (true) {
      let query = supabase
        .from('articles')
        .select('id, tenant_id, internal_ref, name, description, category_id, brand, oem_ref, supplier_ref, barcode, supplier_id, condition, unit, purchase_price, sale_price, min_price, wholesale_price, vat_rate, stock_min, stock_max, location, image_url, is_active, ipm_eligible, track_stock')
        .eq('tenant_id', tenant.id)
        .eq('is_active', true)
        .order('name')
        .range(from, from + batchSize - 1);
      if (!sharedArticles && currentSite) {
        query = query.eq('site_id', currentSite.id);
      }
      const { data, error: e } = await query;
      if (e || !data) break;
      allArts = allArts.concat(data);
      if (data.length < batchSize) break;
      from += batchSize;
    }

    const [{ data: stk }, { data: sup }, { data: tierDefs }] = await Promise.all([
      (async () => {
        let all: any[] = [];
        let f = 0;
        while (true) {
          const { data, error: e } = await supabase.from('stock_levels').select('article_id, quantity').eq('tenant_id', tenant.id).range(f, f + 999);
          if (e || !data) break;
          all = all.concat(data);
          if (data.length < 1000) break;
          f += 1000;
        }
        return { data: all };
      })(),
      supabase.from('suppliers').select('id, name').eq('tenant_id', tenant.id).eq('is_active', true).order('name'),
      supabase.from('pricing_tier_definitions').select('id, tier_name, sort_order, is_default, tenant_id').eq('tenant_id', tenant.id).order('sort_order'),
    ]);
    setArticles(allArts);
    setCategories(refData?.categories || []);
    setBrands(refData?.brands || []);
    setModels(refData?.models || []);
    setSuppliers(sup || []);
    setTierDefinitions(tierDefs || []);
    const map: Record<string, number> = {};
    (stk || []).forEach((r: any) => { map[r.article_id] = (map[r.article_id] || 0) + Number(r.quantity); });
    setStockMap(map);
    if (!silent) setLoading(false);
    setInitialLoaded(true);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenant?.id, currentSite?.id, sharedArticles]);
  useEffect(() => { if (dataTick > 0) { const t = setTimeout(() => load(true), 300); return () => clearTimeout(t); } /* eslint-disable-next-line */ }, [dataTick]);

  useEffect(() => {
    const ctx = consumeNavContext();
    if (ctx?.target === 'newArticle') openCreate();
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let result = articles.filter(a => {
      if (categoryFilter && a.category_id !== categoryFilter) return false;
      if (stockFilter !== 'all') {
        const qty = stockMap[a.id] || 0;
        const min = Number(a.stock_min || 0);
        if (stockFilter === 'out' && qty > 0) return false;
        if (stockFilter === 'low' && (qty <= 0 || qty > min)) return false;
        if (stockFilter === 'in' && (qty <= 0 || qty <= min)) return false;
      }
      if (!q) return true;
      return a.name.toLowerCase().includes(q) || a.internal_ref.toLowerCase().includes(q)
        || (a.oem_ref || '').toLowerCase().includes(q) || (a.supplier_ref || '').toLowerCase().includes(q)
        || (a.barcode || '').toLowerCase().includes(q);
    });
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'ref': cmp = (a.internal_ref || '').localeCompare(b.internal_ref || ''); break;
        case 'category': cmp = (a.category_id || '').localeCompare(b.category_id || ''); break;
        case 'price': cmp = (a.sale_price || 0) - (b.sale_price || 0); break;
        case 'stock': cmp = (stockMap[a.id] || 0) - (stockMap[b.id] || 0); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [articles, search, categoryFilter, stockFilter, stockMap, sortCol, sortDir]);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [search, categoryFilter, stockFilter, sortCol, sortDir]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);

  const categoryMap = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);

  const stats = useMemo(() => {
    let inStock = 0, low = 0, out = 0;
    for (const a of articles) {
      const q = stockMap[a.id] || 0;
      if (q === 0) out++;
      else if (q <= Number(a.stock_min || 0)) low++;
      else inStock++;
    }
    return { inStock, low, out };
  }, [articles, stockMap]);

  const openCreate = () => {
    setEditing(null);
    setCompats([]);
    setTab('infos');
    setImageFile(null);
    setImagePreview(null);
    setImageDeletePending(false);
    setForm({
      internal_ref: '', name: '', brand: '', oem_ref: '', supplier_ref: '', barcode: '',
      condition: 'neuf', unit: 'pièce', purchase_price: 0, sale_price: 0, min_price: 0,
      wholesale_price: 0, vat_rate: 0, stock_min: 0, stock_max: 0, location: '', stock_init: 0,
    });
    setFormTiers(tierDefinitions.map(t => ({ tier_name: t.tier_name, price: '' })));
    setDrawerOpen(true);
  };

  const openEdit = async (a: Article) => {
    setEditing(a);
    setTab('infos');
    setImageFile(null);
    setImagePreview(a.image_url || null);
    setImageDeletePending(false);
    setForm({ ...a, stock_init: 0 });

    const [{ data: compatData }, { data: tiersData }] = await Promise.all([
      supabase.from('article_compatibilities').select('*').eq('article_id', a.id),
      supabase.from('article_pricing_tiers').select('*').eq('article_id', a.id).order('sort_order'),
    ]);

    setCompats((compatData || []).map((c: any) => ({ id: c.id, brand_id: c.brand_id || '', model_id: c.model_id || '', year_start: c.year_start || 0, year_end: c.year_end || 0, notes: c.notes || '' })));
    setPricingTiers(tiersData || []);

    const loadedTiers = tiersData || [];
    const newFormTiers = tierDefinitions.map(def => {
      const existing = loadedTiers.find(t => t.tier_name === def.tier_name);
      return { tier_name: def.tier_name, price: existing?.price || '' };
    });
    setFormTiers(newFormTiers);
    setDrawerOpen(true);
  };

  const generateRef = () => {
    const cat = categories.find(c => c.id === form.category_id);
    const prefix = cat?.code || 'ART';
    const num = String(articles.length + 1).padStart(4, '0');
    setForm(f => ({ ...f, internal_ref: `${prefix}-${num}` }));
  };

  const addCompat = () => setCompats(c => [...c, { brand_id: '', model_id: '', year_start: 0, year_end: 0, notes: '' }]);
  const removeCompat = (i: number) => setCompats(c => c.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!tenant) return;
    if (!can('manage_articles')) { error('Vous n\'avez pas la permission de modifier les articles'); return; }
    if (!form.name?.trim()) { error('Désignation obligatoire'); setTab('infos'); return; }
    if (!form.internal_ref?.trim()) { error('Référence interne obligatoire'); setTab('infos'); return; }
    setSaving(true);
    try {
      // Handle image upload if a new file was selected
      let finalImageUrl: string | null = form.image_url || null;

      if (imageDeletePending) {
        finalImageUrl = null;
      } else if (imageFile) {
        setImageUploading(true);
        const ext = imageFile.name.split('.').pop()?.toLowerCase() || 'jpg';
        // Use a temp key for new articles (will be updated after insert), or article id for edits
        const tempKey = editing?.id || `temp_${Date.now()}`;
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
      if (!sharedArticles && currentSite && !editing) {
        payload.site_id = currentSite.id;
      }

      let articleId = editing?.id;
      if (editing) {
        const { error: e } = await supabase.from('articles').update(payload).eq('id', editing.id);
        if (e) throw e;
      } else {
        const { data, error: e } = await supabase.from('articles').insert(payload).select().single();
        if (e) throw e;
        articleId = data.id;
        // Re-upload image to real article id path (move from temp path)
        if (imageFile && articleId && finalImageUrl) {
          const ext = imageFile.name.split('.').pop()?.toLowerCase() || 'jpg';
          const realPath = `${tenant.id}/articles/${articleId}/main.${ext}`;
          await supabase.storage.from('article-images').upload(realPath, imageFile, { upsert: true, contentType: imageFile.type });
          const { data: urlData } = supabase.storage.from('article-images').getPublicUrl(realPath);
          const realUrl = urlData.publicUrl + `?t=${Date.now()}`;
          await supabase.from('articles').update({ image_url: realUrl }).eq('id', articleId);
        }
      }

      if (!editing && form.stock_init && Number(form.stock_init) > 0 && currentSite && articleId) {
        const { error: e } = await supabase.rpc('adjust_stock', {
          p_article_id: articleId, p_site_id: currentSite.id,
          p_quantity: Number(form.stock_init), p_movement_type: 'initial', p_note: 'Stock initial',
        });
        if (e) throw e;
      }

      if (articleId) {
        if (editing) await supabase.from('article_compatibilities').delete().eq('article_id', articleId);
        const newCompats = compats.filter(c => c.brand_id);
        if (newCompats.length > 0) {
          await supabase.from('article_compatibilities').insert(
            newCompats.map(c => ({ tenant_id: tenant.id, article_id: articleId, brand_id: c.brand_id || null, model_id: c.model_id || null, year_start: c.year_start || 0, year_end: c.year_end || 0, notes: c.notes || '' }))
          );
        }

        // Save pricing tiers
        if (editing) {
          await supabase.from('article_pricing_tiers').delete().eq('article_id', articleId);
        }
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
          const { error: tierErr } = await supabase.from('article_pricing_tiers').insert(tiersToSave);
          if (tierErr) throw tierErr;
        }
      }

      success(editing ? 'Article modifié' : 'Article créé');
      setDrawerOpen(false);
      await load();
    } catch (e: any) {
      const msg = e.message || '';
      if (msg.includes('Limite du plan')) {
        error(msg.replace('Mettez à niveau votre abonnement.', '').trim());
      } else if (msg.includes('unique')) {
        error('Cette référence existe déjà');
      } else {
        error(msg || 'Erreur d\'enregistrement');
      }
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!toDelete) return;
    if (!can('manage_articles')) { error('Vous n\'avez pas la permission de supprimer les articles'); return; }
    const { error: hardErr } = await supabase.rpc('tenant_delete_article_safe', { p_id: toDelete.id });
    if (!hardErr) { success('Article supprimé définitivement'); load(); return; }
    const { error: softErr } = await supabase.from('articles').update({ is_active: false }).eq('id', toDelete.id);
    if (softErr) error(softErr.message);
    else { success('Article désactivé (opérations associées conservées)'); load(); }
  };

  const toggleSelectionMode = () => {
    setSelectionMode(m => { if (m) setSelectedIds(new Set()); return !m; });
  };
  const toggleSelected = (id: string) => {
    setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const selectAllFiltered = () => setSelectedIds(new Set(filtered.map(a => a.id)));
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
      await load();
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
      await load();
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
      await load(true);
    } catch (e: any) { error(e.message || 'Erreur'); }
    finally { setListSaving(false); }
  };

  const openFullScreen = (a: Article) => {
    const idx = filtered.findIndex(x => x.id === a.id);
    setEditingIndex(idx >= 0 ? idx : 0);
    openEdit(a);
    setFullScreenOpen(true);
    setDrawerOpen(false);
  };

  const navigateArticle = async (dir: -1 | 1) => {
    const newIdx = editingIndex + dir;
    if (newIdx < 0 || newIdx >= filtered.length) return;
    setEditingIndex(newIdx);
    const a = filtered[newIdx];
    await openEdit(a);
    setDrawerOpen(false);
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every(a => selectedIds.has(a.id));

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
      await load();
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

  return (
    <div className="space-y-3 pb-6">
      {/* ── Header premium unifié ────────── */}
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-5 lg:-mx-8 px-3 sm:px-5 lg:px-8 pb-3 pt-3 sm:pt-4 lg:pt-6 -mt-3 sm:-mt-4 lg:-mt-6 bg-slate-50/95 backdrop-blur-sm flex items-center gap-2">
        <div className="flex-1 min-w-0 flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 rounded-2xl bg-white border border-slate-200 shadow-sm hover:shadow-md focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-500/20 transition-all">
          <div className="flex items-center gap-2 pr-2 border-r border-slate-200 shrink-0">
            <div className="leading-tight">
              <h1 className="text-sm font-bold tracking-tight text-slate-900 leading-none">Articles</h1>
              <div className="text-[9px] font-semibold tracking-wider uppercase text-slate-400 leading-none mt-0.5 hidden sm:block">{businessLabel}</div>
            </div>
          </div>
          <input
            value={searchInput}
            onChange={e => handleSearchInput(e.target.value)}
            placeholder="Rechercher…"
            className="flex-1 min-w-0 w-0 bg-transparent text-xs focus:outline-none placeholder:text-slate-400"
          />
          {search && (
            <button onClick={() => { setSearch(''); setSearchInput(''); }} className="shrink-0 p-1 text-slate-400 hover:text-slate-600">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={() => setFilterOpen(true)} className={`shrink-0 hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-all ${categoryFilter ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100'}`}>
            <Filter className="w-3.5 h-3.5" />
            <span className="max-w-[120px] truncate">{categoryFilter ? selectedCategoryName : 'Catégorie'}</span>
          </button>
          <button onClick={toggleSelectionMode} className={`shrink-0 hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-all ${selectionMode ? 'bg-brand-600 text-white border border-brand-700 shadow-glow' : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100'}`}>
            <CheckSquare className="w-3.5 h-3.5" />
            <span>{selectionMode ? 'Quitter' : 'Sélect.'}</span>
          </button>
          {/* Desktop view toggle */}
          <div className="shrink-0 hidden md:inline-flex items-center rounded-xl overflow-hidden border border-slate-200">
            <button onClick={() => setViewMode('list')} className={`p-1.5 transition-colors ${viewMode === 'list' ? 'bg-brand-600 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`} aria-label="Vue liste"><List className="w-3.5 h-3.5" /></button>
            <button onClick={() => setViewMode('cards')} className={`p-1.5 transition-colors ${viewMode === 'cards' ? 'bg-brand-600 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`} aria-label="Vue cartes"><LayoutGrid className="w-3.5 h-3.5" /></button>
          </div>
          <button onClick={() => { if (!sharedArticles && currentSite) setImportTargetSite(currentSite.id); setImportExportOpen(true); }} className="shrink-0 hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100">
            <Download className="w-3.5 h-3.5" /><span>Excel</span>
          </button>
          <button onClick={openCreate} className="shrink-0 w-8 h-8 rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 flex items-center justify-center shadow-glow hover:shadow-premium active:scale-95 transition-all" aria-label="Nouvel article">
            <Plus className="w-3.5 h-3.5 text-white" />
          </button>
        </div>
      </div>

      {/* ── Guide interactif ─────────────────────── */}
      {!guideDismissed && <MasterCatalogGuide step={guideStep} articleCount={articles.length} onStep={setGuideStep} onDismiss={dismissGuide} onGo={goToMasterCatalog} />}
      {guideDismissed && (
        <button onClick={reopenGuide} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-brand-700 transition-colors px-1">
          <Lightbulb className="w-3.5 h-3.5" />Revoir le guide d'ajout depuis le catalogue maître
        </button>
      )}

      {/* ── Barre de sélection en masse ────── */}
      {selectionMode && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-gradient-to-r from-brand-50 to-white border border-brand-200 shadow-sm animate-fade-in flex-wrap">
          <button onClick={allFilteredSelected ? clearSelection : selectAllFiltered} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold text-brand-700 hover:bg-brand-100">
            {allFilteredSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
            {allFilteredSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
          </button>
          <div className="text-[11px] font-semibold text-slate-600 truncate">
            <span className="num font-bold text-brand-700">{selectedIds.size}</span> sélectionné{selectedIds.size > 1 ? 's' : ''}
          </div>
          <div className="flex-1" />
          <button onClick={() => { setBulkAction(''); setBulkActionValue(''); setBulkActionOpen(true); }} disabled={selectedIds.size === 0} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:scale-95 transition-all disabled:opacity-50">
            <MoreHorizontal className="w-3.5 h-3.5" />Action en masse
          </button>
          <button onClick={() => setBulkConfirmOpen(true)} disabled={selectedIds.size === 0} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-red-600 text-white shadow-sm hover:bg-red-700 active:scale-95 transition-all disabled:opacity-50">
            <Trash2 className="w-3.5 h-3.5" />Supprimer
          </button>
        </div>
      )}

      {/* Stats chips */}
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider overflow-x-auto no-scrollbar whitespace-nowrap">
        <button onClick={() => setStockFilter('all')} className={`shrink-0 px-2 py-1 rounded-full num transition-all ${stockFilter === 'all' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{filtered.length} / {articles.length}</button>
        {stats.inStock > 0 && <button onClick={() => setStockFilter(f => f === 'in' ? 'all' : 'in')} className={`shrink-0 px-2 py-1 rounded-full inline-flex items-center gap-1 transition-all cursor-pointer ${stockFilter === 'in' ? 'bg-emerald-600 text-white ring-2 ring-emerald-300' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}><span className={`w-1.5 h-1.5 rounded-full ${stockFilter === 'in' ? 'bg-white' : 'bg-emerald-500'}`} />{stats.inStock} en stock</button>}
        {stats.low > 0 && <button onClick={() => setStockFilter(f => f === 'low' ? 'all' : 'low')} className={`shrink-0 px-2 py-1 rounded-full transition-all cursor-pointer ${stockFilter === 'low' ? 'bg-amber-600 text-white ring-2 ring-amber-300' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}>{stats.low} stock bas</button>}
        {stats.out > 0 && <button onClick={() => setStockFilter(f => f === 'out' ? 'all' : 'out')} className={`shrink-0 px-2 py-1 rounded-full transition-all cursor-pointer ${stockFilter === 'out' ? 'bg-red-600 text-white ring-2 ring-red-300' : 'bg-red-50 text-red-700 hover:bg-red-100'}`}>{stats.out} rupture{stats.out > 1 ? 's' : ''}</button>}
        {categoryFilter && <button onClick={() => setCategoryFilter('')} className="shrink-0 px-2 py-1 rounded-full bg-brand-50 text-brand-700 border border-brand-200 inline-flex items-center gap-1">{selectedCategoryName} <X className="w-3 h-3" /></button>}
        {stockFilter !== 'all' && <button onClick={() => setStockFilter('all')} className="shrink-0 px-2 py-1 rounded-full bg-slate-50 text-slate-500 border border-slate-200 inline-flex items-center gap-1 hover:bg-slate-100 transition-all"><X className="w-3 h-3" /> Effacer filtre</button>}
      </div>

      {/* ── Liste ─────────────────────────────── */}
      {!initialLoaded && loading ? (
        <div className="py-20 flex items-center justify-center rounded-2xl bg-white shadow-card border border-slate-100 opacity-0 animate-[fadeIn_0.3s_ease_0.4s_forwards]"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl bg-white shadow-card border border-slate-100">
          <EmptyState icon={Package} title={search || categoryFilter ? 'Aucun article trouvé' : 'Aucun article'} description={search || categoryFilter ? 'Essayez d\'autres critères.' : 'Créez votre premier article.'}
            action={!search && !categoryFilter ? <button onClick={openCreate} className="btn-icon-primary" title="Nouvel article"><Plus className="w-4 h-4" /></button> : undefined} />
        </div>
      ) : (
        <>
          {/* Mobile: cartes */}
          <div className="md:hidden grid grid-cols-1 gap-2">
            {paginated.map(a => (
              <ArticleCard key={a.id} article={a} category={categoryMap.get(a.category_id || '')} qty={stockMap[a.id] || 0}
                onEdit={() => selectionMode ? toggleSelected(a.id) : openEdit(a)} onDelete={() => setToDelete(a)}
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
              <div className="rounded-2xl bg-white shadow-card border border-slate-100 overflow-hidden">
                <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 300px)' }}>
                <table className="w-full text-sm">
                  <thead className="bg-slate-50/70 text-[10px] uppercase text-slate-500 tracking-wider border-b border-slate-100 sticky top-0 z-10">
                    <tr>
                      {selectionMode && <th className="px-3 py-3 w-10 bg-slate-50"><button onClick={allFilteredSelected ? clearSelection : selectAllFiltered} className="text-brand-700">{allFilteredSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}</button></th>}
                      <th className="px-4 py-3 text-left font-semibold cursor-pointer select-none hover:text-brand-700 transition-colors bg-slate-50" onClick={() => { setSortCol('name'); setSortDir(d => sortCol === 'name' ? (d === 'asc' ? 'desc' : 'asc') : 'asc'); }}>
                        <span className="inline-flex items-center gap-1">Article {sortCol === 'name' ? (sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-brand-600" /> : <ChevronDown className="w-3 h-3 text-brand-600" />) : <ChevronDown className="w-3 h-3 opacity-30" />}</span>
                      </th>
                      <th className="px-4 py-3 text-left font-semibold cursor-pointer select-none hover:text-brand-700 transition-colors bg-slate-50" onClick={() => { setSortCol('ref'); setSortDir(d => sortCol === 'ref' ? (d === 'asc' ? 'desc' : 'asc') : 'asc'); }}>
                        <span className="inline-flex items-center gap-1">Référence {sortCol === 'ref' ? (sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-brand-600" /> : <ChevronDown className="w-3 h-3 text-brand-600" />) : <ChevronDown className="w-3 h-3 opacity-30" />}</span>
                      </th>
                      <th className="px-4 py-3 text-left font-semibold cursor-pointer select-none hover:text-brand-700 transition-colors bg-slate-50" onClick={() => { setSortCol('category'); setSortDir(d => sortCol === 'category' ? (d === 'asc' ? 'desc' : 'asc') : 'asc'); }}>
                        <span className="inline-flex items-center gap-1">Catégorie {sortCol === 'category' ? (sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-brand-600" /> : <ChevronDown className="w-3 h-3 text-brand-600" />) : <ChevronDown className="w-3 h-3 opacity-30" />}</span>
                      </th>
                      <th className="px-4 py-3 text-right font-semibold cursor-pointer select-none hover:text-brand-700 transition-colors bg-slate-50" onClick={() => { setSortCol('price'); setSortDir(d => sortCol === 'price' ? (d === 'asc' ? 'desc' : 'asc') : 'asc'); }}>
                        <span className="inline-flex items-center gap-1 justify-end">Prix vente {sortCol === 'price' ? (sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-brand-600" /> : <ChevronDown className="w-3 h-3 text-brand-600" />) : <ChevronDown className="w-3 h-3 opacity-30" />}</span>
                      </th>
                      {can('view_margins') && <th className="px-4 py-3 text-right font-semibold bg-slate-50">Marge</th>}
                      {can('view_stock_levels') && <th className="px-4 py-3 text-right font-semibold cursor-pointer select-none hover:text-brand-700 transition-colors bg-slate-50" onClick={() => { setSortCol('stock'); setSortDir(d => sortCol === 'stock' ? (d === 'asc' ? 'desc' : 'asc') : 'asc'); }}>
                        <span className="inline-flex items-center gap-1 justify-end">Stock {sortCol === 'stock' ? (sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-brand-600" /> : <ChevronDown className="w-3 h-3 text-brand-600" />) : <ChevronDown className="w-3 h-3 opacity-30" />}</span>
                      </th>}
                      <th className="px-4 py-3 text-right font-semibold bg-slate-50"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paginated.map(a => {
                      const cat = categoryMap.get(a.category_id || '');
                      const qty = stockMap[a.id] || 0;
                      const mStatus = stockStatus(qty, Number(a.stock_min || 0));
                      const mg = a.sale_price > 0 ? ((a.sale_price - a.purchase_price) / a.sale_price) * 100 : 0;
                      const mgTone = mg >= 30 ? 'text-emerald-700 bg-emerald-50' : mg >= 15 ? 'text-amber-700 bg-amber-50' : 'text-red-700 bg-red-50';
                      const isSel = selectedIds.has(a.id);
                      return (
                        <tr key={a.id} className={`group transition-colors ${isSel ? 'bg-brand-50/60' : 'hover:bg-brand-50/30'} ${selectionMode ? 'cursor-pointer' : ''}`} onClick={selectionMode ? () => toggleSelected(a.id) : undefined}>
                          {selectionMode && <td className="px-3 py-3 w-10"><span className="text-brand-700">{isSel ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-slate-400" />}</span></td>}
                          <td className="px-4 py-3"><div className="flex items-center gap-3"><div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${mStatus.bg}`}><Package className={`w-4 h-4 ${mStatus.icon}`} /></div><div className="min-w-0"><div className="font-semibold text-slate-900 truncate">{a.name}</div>{a.oem_ref && <div className="text-[11px] text-slate-400 font-mono truncate">OEM: {a.oem_ref}</div>}</div></div></td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-600">{a.internal_ref}</td>
                          <td className="px-4 py-3 text-slate-600 text-xs truncate max-w-[140px]">{cat?.name || '—'}</td>
                          <td className="px-4 py-3 text-right font-bold text-slate-900 num">{formatFCFA(a.sale_price)}</td>
                          {can('view_margins') && <td className="px-4 py-3 text-right"><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold num ${mgTone}`}>{mg.toFixed(0)}%</span></td>}
                          {can('view_stock_levels') && <td className="px-4 py-3 text-right"><span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold num ${mStatus.badge}`}><span className={`w-1.5 h-1.5 rounded-full ${mStatus.dot}`} />{qty}</span></td>}
                          <td className="px-4 py-3 text-right"><div className="inline-flex gap-1 opacity-60 group-hover:opacity-100"><button onClick={(e) => { e.stopPropagation(); openFullScreen(a); }} className="p-1.5 rounded-lg hover:bg-brand-100 text-slate-600 hover:text-brand-700"><Edit2 className="w-4 h-4" /></button><button onClick={(e) => { e.stopPropagation(); setToDelete(a); }} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button></div></td>
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
              <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-brand-50 border border-brand-200 animate-fade-in">
                <Save className="w-4 h-4 text-brand-600" />
                <span className="text-xs font-semibold text-brand-800">{listEditCount} modification{listEditCount > 1 ? 's' : ''} en attente</span>
                <div className="flex-1" />
                <button onClick={() => setListEdits(new Map())} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
                <button onClick={saveListEdits} disabled={listSaving} className="px-4 py-1.5 text-[11px] font-bold bg-brand-600 text-white rounded-xl shadow-glow hover:bg-brand-700 disabled:opacity-50 inline-flex items-center gap-1.5">
                  {listSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}Enregistrer
                </button>
              </div>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 bg-white border border-slate-100 rounded-2xl shadow-card mt-3">
              <div className="text-xs text-slate-500">{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} sur {filtered.length} articles</div>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(0)} disabled={page === 0} className="px-2 py-1 rounded-lg text-[11px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">{'<<'}</button>
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-2 py-1 rounded-lg text-[11px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">{'<'}</button>
                <span className="px-3 py-1 rounded-lg text-[11px] font-bold bg-brand-50 text-brand-700 border border-brand-200">{page + 1} / {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="px-2 py-1 rounded-lg text-[11px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">{'>'}</button>
                <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} className="px-2 py-1 rounded-lg text-[11px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">{'>>'}</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Category filter sheet ────── */}
      {filterOpen && <CategoryFilterSheet categories={categories} value={categoryFilter} onChange={v => { setCategoryFilter(v); setFilterOpen(false); }} onClose={() => setFilterOpen(false)} />}

      {/* ── Full-screen edit (desktop) ────── */}
      {fullScreenOpen && (
        <FullScreenArticleEdit
          form={form} setForm={setForm} editing={editing} tab={tab} setTab={setTab}
          TABS={TABS} save={save} saving={saving} compats={compats} setCompats={setCompats}
          categories={categories} suppliers={suppliers} brands={brands} models={models}
          autoMode={autoMode} generateRef={generateRef} addCompat={addCompat} removeCompat={removeCompat}
          imagePreview={imagePreview} imageUploading={imageUploading}
          onFileSelect={file => { setImageFile(file); setImageDeletePending(false); setImagePreview(URL.createObjectURL(file)); }}
          onDeleteImage={() => { setImageFile(null); setImagePreview(null); setImageDeletePending(true); }}
          marginValue={marginValue} marginStr={marginStr}
          showPurchasePrice={can('view_purchase_prices')} showMargin={can('view_margins')}
          stockMap={stockMap} formTiers={formTiers} setFormTiers={setFormTiers} tierDefinitions={tierDefinitions}
          onClose={() => setFullScreenOpen(false)}
          onPrev={editingIndex > 0 ? () => navigateArticle(-1) : undefined}
          onNext={editingIndex < filtered.length - 1 ? () => navigateArticle(1) : undefined}
          editingIndex={editingIndex} totalCount={filtered.length}
          filtered={filtered} onJumpTo={async (a) => { const idx = filtered.indexOf(a); if (idx >= 0) { setEditingIndex(idx); await openEdit(a); setDrawerOpen(false); } }}
        />
      )}

      {/* ── Drawer article (mobile + fallback) ────── */}
      {drawerOpen && !fullScreenOpen && (
        <MobileArticleEdit
          form={form} setForm={setForm}
          editing={editing} tab={tab} setTab={setTab}
          save={save} saving={saving}
          compats={compats} setCompats={setCompats}
          categories={categories} suppliers={suppliers}
          brands={brands} models={models}
          autoMode={autoMode} generateRef={generateRef}
          addCompat={addCompat} removeCompat={removeCompat}
          imagePreview={imagePreview} imageUploading={imageUploading}
          onFileSelect={(f) => { setImageFile(f); setImageDeletePending(false); setImagePreview(URL.createObjectURL(f)); }}
          onDeleteImage={() => { setImageFile(null); setImagePreview(null); setImageDeletePending(true); }}
          marginValue={marginValue} marginStr={marginStr}
          showPurchasePrice={can('view_purchase_prices')} showMargin={can('view_margins')}
          stockMap={stockMap}
          formTiers={formTiers} setFormTiers={setFormTiers} tierDefinitions={tierDefinitions}
          isPharmacy={(tenant?.business_activity_type_name || '').toLowerCase() === 'pharmacie' || (tenant?.enabled_modules || []).includes('ipm')}
          onClose={() => setDrawerOpen(false)}
          onPrev={editing && editingIndex > 0 ? () => navigateArticle(-1) : undefined}
          onNext={editing && editingIndex < filtered.length - 1 ? () => navigateArticle(1) : undefined}
          editingIndex={editingIndex} totalCount={filtered.length}
        />
      )}

      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={del} title="Supprimer l'article ?" message={`"${toDelete?.name}" sera supprimé définitivement s'il n'est utilisé dans aucune opération, sinon simplement désactivé.`} confirmLabel="Supprimer" danger />
      <ConfirmDialog open={bulkConfirmOpen} onClose={() => { if (!bulkDeleting) setBulkConfirmOpen(false); }} onConfirm={bulkDelete} title={`Supprimer ${selectedIds.size} article${selectedIds.size > 1 ? 's' : ''} ?`} message="Les articles sélectionnés seront supprimés ou désactivés. Cette action ne peut pas être annulée." confirmLabel={bulkDeleting ? 'Suppression…' : 'Supprimer la sélection'} danger />

      {/* ── Bulk action modal ────── */}
      <Modal open={bulkActionOpen} onClose={() => setBulkActionOpen(false)} title={`Action en masse (${selectedIds.size} articles)`} size="sm"
        footer={<><button onClick={() => setBulkActionOpen(false)} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button><button onClick={applyBulkAction} disabled={!bulkAction || bulkDeleting} className="btn-icon-primary" title="Appliquer">{bulkDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}</button></>}>
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
          {bulkAction === 'track_stock_off' && <p className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2">Le suivi de stock sera <strong>désactivé</strong> pour les {selectedIds.size} articles sélectionnés. Ils pourront être vendus sans contrainte de quantité (services, prestations).</p>}
        </div>
      </Modal>

      {/* ── Import / Export Modal ────── */}
      <Modal open={importExportOpen} onClose={() => { setImportExportOpen(false); resetImport(); }} title="Import / Export Excel" size="md"
        footer={importRows.length > 0 ? (<><button onClick={resetImport} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button><button onClick={runArticleImport} disabled={importingArticles} className="btn-icon-primary" title={importingArticles ? 'Import...' : `Importer ${importRows.length} article${importRows.length > 1 ? 's' : ''}`}>{importingArticles ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}</button></>) : <button onClick={() => { setImportExportOpen(false); resetImport(); }} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>}>
        <div className="space-y-4">
          {(() => {
            const ownDepots = depots.filter((d: any) => d.parent_site_id === currentSite?.id);
            const otherSites = sharedArticles ? sites.filter((s: any) => s.id !== currentSite?.id) : [];
            const otherDepots = sharedArticles ? depots.filter((d: any) => d.parent_site_id !== currentSite?.id) : [];
            const hasAlternatives = ownDepots.length > 0 || otherSites.length > 0 || otherDepots.length > 0;
            if (!hasAlternatives) return null;
            return (
              <div className="p-3 rounded-xl border border-brand-200 bg-brand-50/40">
                <label className="text-[10px] font-bold uppercase tracking-wider text-brand-700">Emplacement (stock initial)</label>
                <select
                  value={importTargetSite}
                  onChange={e => setImportTargetSite(e.target.value)}
                  className="mt-1.5 w-full text-xs font-semibold px-2.5 py-2 rounded-lg border border-brand-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
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
                <p className="text-[10px] text-brand-700/80 mt-1.5 leading-relaxed">
                  {sharedArticles
                    ? 'À l\'import, le stock initial sera affecté à cet emplacement. À l\'export, la colonne « Stock initial » reflétera le stock de cet emplacement.'
                    : 'Le stock initial sera affecté à l\'emplacement sélectionné (magasin actuel ou ses dépôts rattachés).'
                  }
                </p>
              </div>
            );
          })()}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button onClick={downloadArticleTemplate} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-neutral-300 hover:bg-neutral-50/50 transition text-left">
              <div className="w-9 h-9 rounded-xl bg-neutral-100 flex items-center justify-center shrink-0"><Download className="w-4 h-4 text-neutral-700" /></div>
              <div><div className="text-xs font-bold text-slate-900">Modèle Excel</div><div className="text-[10px] text-slate-500">Fichier vierge avec un exemple</div></div>
            </button>
            <button onClick={exportArticles} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/50 transition text-left">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0"><Upload className="w-4 h-4 text-emerald-600" /></div>
              <div><div className="text-xs font-bold text-slate-900">Exporter mes articles</div><div className="text-[10px] text-slate-500">{articles.length} articles</div></div>
            </button>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Colonnes attendues</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
              {TENANT_IMPORT_HEADERS.map(h => (<div key={h.key} className={`text-[10px] px-2 py-1 rounded-md ${h.required ? 'bg-brand-50 border border-brand-200 font-bold text-brand-800' : 'bg-white border border-slate-100 text-slate-600'}`}>{h.label}</div>))}
            </div>
          </div>
          <label className="flex flex-col items-center justify-center gap-2 p-5 border-2 border-dashed border-slate-300 rounded-2xl cursor-pointer hover:border-brand-400 hover:bg-brand-50/30 transition">
            <Upload className="w-5 h-5 text-slate-400" />
            <div className="text-xs text-slate-600 text-center">Cliquez ou glissez un fichier Excel (.xlsx)</div>
            {importFilename && <div className="text-[11px] font-semibold text-brand-700">{importFilename} — {importRows.length} ligne{importRows.length > 1 ? 's' : ''}</div>}
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ''; }} />
          </label>
          {importResult && (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-100 text-center"><div className="text-[9px] font-bold uppercase text-emerald-700">Créés</div><div className="text-lg font-bold text-emerald-800 num">{importResult.imported}</div></div>
                <div className="p-2.5 rounded-xl bg-neutral-50 border border-neutral-200 text-center"><div className="text-[9px] font-bold uppercase text-neutral-700">Mis à jour</div><div className="text-lg font-bold text-neutral-800 num">{importResult.updated}</div></div>
                <div className="p-2.5 rounded-xl bg-red-50 border border-red-100 text-center"><div className="text-[9px] font-bold uppercase text-red-700">Erreurs</div><div className="text-lg font-bold text-red-800 num">{importResult.errors?.length || 0}</div></div>
              </div>
              {importResult.errors && importResult.errors.length > 0 && <div className="max-h-32 overflow-auto bg-slate-50 rounded-xl p-2 space-y-0.5">{importResult.errors.map((e: any, i: number) => <div key={i} className="text-[10px] text-red-700">Ligne {e.row}: {e.error}</div>)}</div>}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}