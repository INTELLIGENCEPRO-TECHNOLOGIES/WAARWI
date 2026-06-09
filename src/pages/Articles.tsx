import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Search, Package, Trash2, Loader2, X, Car, DollarSign, Boxes, Info,
  CreditCard as Edit2, Filter, ChevronDown, Tag, TrendingUp, TrendingDown,
  Barcode, Layers, MapPin, Hash, CheckCircle2, AlertTriangle, AlertCircle,
  Image as ImageIcon, Upload, Camera, CheckSquare, Square,
  Library, ArrowRight, Lightbulb, MousePointerClick, Download, ChevronRight,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { usePermissions } from '../lib/permissions';
import { useToast } from '../context/ToastContext';
import { formatFCFA } from '../lib/format';
import { desktopAutoFocus } from '../lib/device';
import { consumeNavContext } from '../lib/navHighlight';
import { ConfirmDialog, Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import type { Article, Category, VehicleBrand } from '../lib/types';
import { isAutoParts, BUSINESS_TYPE_LABELS } from '../lib/types';

type Form = Partial<Article> & { stock_init?: number };
type Compat = { id?: string; brand_id: string; model_id: string; year_start: number; year_end: number; notes: string };

type TabKey = 'infos' | 'prix' | 'stock' | 'compat' | 'image';

export function Articles({ onNavigate }: { onNavigate?: (route: string) => void } = {}) {
  const { tenant, currentSite, dataTick } = useApp();
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
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const [form, setForm] = useState<Form>({});
  const [compats, setCompats] = useState<Compat[]>([]);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<TabKey>('infos');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageDeletePending, setImageDeletePending] = useState(false);

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
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('is_active', true)
        .order('name')
        .range(from, from + batchSize - 1);
      if (!sharedArticles && currentSite) {
        query = query.or(`site_id.eq.${currentSite.id},site_id.is.null`);
      }
      const { data, error: e } = await query;
      if (e || !data) break;
      allArts = allArts.concat(data);
      if (data.length < batchSize) break;
      from += batchSize;
    }

    const [{ data: cats }, { data: stk }, { data: b }, { data: m }, { data: sup }] = await Promise.all([
      supabase.from('part_categories').select('*').eq('tenant_id', tenant.id).eq('is_active', true).order('name'),
      supabase.from('stock_levels').select('article_id, quantity').eq('tenant_id', tenant.id),
      supabase.from('vehicle_brands').select('*').eq('tenant_id', tenant.id).eq('is_active', true).order('name'),
      supabase.from('vehicle_models').select('*').eq('tenant_id', tenant.id).order('name'),
      supabase.from('suppliers').select('id, name').eq('tenant_id', tenant.id).eq('is_active', true).order('name'),
    ]);
    setArticles(allArts);
    setCategories(cats || []);
    setBrands(b || []);
    setModels(m || []);
    setSuppliers(sup || []);
    const map: Record<string, number> = {};
    (stk || []).forEach((r: any) => { map[r.article_id] = (map[r.article_id] || 0) + Number(r.quantity); });
    setStockMap(map);
    if (!silent) setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenant?.id, currentSite?.id, sharedArticles]);
  useEffect(() => { if (dataTick > 0) load(true); /* eslint-disable-next-line */ }, [dataTick]);

  useEffect(() => {
    const ctx = consumeNavContext();
    if (ctx?.target === 'newArticle') openCreate();
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return articles.filter(a => {
      if (categoryFilter && a.category_id !== categoryFilter) return false;
      if (!q) return true;
      return a.name.toLowerCase().includes(q) || a.internal_ref.toLowerCase().includes(q)
        || (a.oem_ref || '').toLowerCase().includes(q) || (a.supplier_ref || '').toLowerCase().includes(q)
        || (a.barcode || '').toLowerCase().includes(q);
    });
  }, [articles, search, categoryFilter]);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [search, categoryFilter]);

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
    setDrawerOpen(true);
  };

  const openEdit = async (a: Article) => {
    setEditing(a);
    setTab('infos');
    setImageFile(null);
    setImagePreview(a.image_url || null);
    setImageDeletePending(false);
    setForm({ ...a, stock_init: 0 });
    const { data } = await supabase.from('article_compatibilities').select('*').eq('article_id', a.id);
    setCompats((data || []).map((c: any) => ({ id: c.id, brand_id: c.brand_id || '', model_id: c.model_id || '', year_start: c.year_start || 0, year_end: c.year_end || 0, notes: c.notes || '' })));
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
      }

      success(editing ? 'Article modifié' : 'Article créé');
      setDrawerOpen(false);
      await load();
    } catch (e: any) {
      error(e.message?.includes('unique') ? 'Cette référence existe déjà' : (e.message || 'Erreur d\'enregistrement'));
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!toDelete) return;
    const { error: hardErr } = await supabase.rpc('tenant_delete_article_safe', { p_id: toDelete.id });
    if (!hardErr) { success('Article supprimé définitivement'); load(); return; }
    const { error: softErr } = await supabase.from('articles').update({ is_active: false }).eq('id', toDelete.id);
    if (softErr) error(softErr.message);
    else { success('Article désactivé (opérations associées conservées)'); load(); }
  };

  const toggleSelectionMode = () => {
    setSelectionMode(m => {
      if (m) setSelectedIds(new Set());
      return !m;
    });
  };

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedIds(new Set(filtered.map(a => a.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    let deleted = 0;
    let deactivated = 0;
    try {
      const ids = Array.from(selectedIds);
      for (const id of ids) {
        const { error: hardErr } = await supabase.rpc('tenant_delete_article_safe', { p_id: id });
        if (!hardErr) { deleted++; continue; }
        const { error: softErr } = await supabase.from('articles').update({ is_active: false }).eq('id', id);
        if (!softErr) deactivated++;
      }
      if (deleted + deactivated > 0) {
        success(`${deleted} supprimé(s), ${deactivated} désactivé(s)`);
      }
      setBulkConfirmOpen(false);
      setSelectedIds(new Set());
      setSelectionMode(false);
      await load();
    } catch (e: any) {
      error(e.message || 'Erreur lors de la suppression en masse');
    } finally {
      setBulkDeleting(false);
    }
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
    const { data, error: expErr } = await supabase.rpc('export_tenant_articles');
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
      r.stock_initial || 0,
      r.emplacement || '', r.description || '',
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
      const norm = h.label.trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_')
        .replace(/_+$/, '').replace(/^_+/, '');
      labelToKey.set(norm, h.key);
    });

    const parsed = raw.map(r => {
      const row: any = {};
      for (const k of Object.keys(r)) {
        const norm = k.trim().toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_')
          .replace(/_+$/, '').replace(/^_+/, '');
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
    setImportingArticles(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc('bulk_import_tenant_articles', { p_rows: importRows });
      if (rpcErr) throw rpcErr;
      setImportResult(data as any);
      success('Import terminé');
      await load();
    } catch (e: any) {
      error(e.message);
    } finally {
      setImportingArticles(false);
    }
  };

  const resetImport = () => {
    setImportRows([]);
    setImportFilename('');
    setImportResult(null);
  };

  // ── Guide catalogue maître (bannière interactive dismissible) ──
  const guideKey = tenant ? `waarwi:articles_guide_dismissed:${tenant.id}` : '';
  const [guideDismissed, setGuideDismissed] = useState<boolean>(() => {
    try { return guideKey ? localStorage.getItem(guideKey) === '1' : false; } catch { return false; }
  });
  const [guideStep, setGuideStep] = useState(0);
  const dismissGuide = () => {
    setGuideDismissed(true);
    try { if (guideKey) localStorage.setItem(guideKey, '1'); } catch {}
  };
  const reopenGuide = () => {
    setGuideDismissed(false);
    setGuideStep(0);
    try { if (guideKey) localStorage.removeItem(guideKey); } catch {}
  };
  const goToMasterCatalog = () => {
    onNavigate?.('master_catalog');
  };

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

  return (
    <div className="space-y-3 pb-6">
      {/* ── Header premium unifié (title + search + filters) ────────── */}
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-5 lg:-mx-8 px-3 sm:px-5 lg:px-8 pb-3 pt-3 sm:pt-4 lg:pt-6 -mt-3 sm:-mt-4 lg:-mt-6 bg-slate-50/95 backdrop-blur-sm flex items-center gap-2">
        <div className="flex-1 min-w-0 flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 rounded-2xl bg-white border border-slate-200 shadow-sm hover:shadow-md focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-500/20 transition-all">
          <div className="flex items-center gap-2 pr-2 border-r border-slate-200 shrink-0">
            <div className="leading-tight">
              <h1 className="text-sm font-bold tracking-tight text-slate-900 leading-none">Articles</h1>
              <div className="text-[9px] font-semibold tracking-wider uppercase text-slate-400 leading-none mt-0.5 hidden sm:block">{businessLabel}</div>
              <div className="text-[9px] font-semibold tracking-wider uppercase text-slate-400 leading-none mt-0.5 sm:hidden">Catalogue</div>
            </div>
          </div>
          <input
            value={searchInput}
            onChange={e => handleSearchInput(e.target.value)}
            placeholder="Rechercher…"
            className="flex-1 min-w-0 w-0 bg-transparent text-xs focus:outline-none placeholder:text-slate-400"
          />
          {search && (
            <button onClick={() => setSearch('')} className="shrink-0 p-1 text-slate-400 hover:text-slate-600 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => setFilterOpen(true)}
            className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-all ${
              categoryFilter
                ? 'bg-brand-50 text-brand-700 border border-brand-200'
                : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span className="hidden md:inline max-w-[120px] truncate">{categoryFilter ? selectedCategoryName : 'Catégorie'}</span>
          </button>
          <button
            onClick={toggleSelectionMode}
            className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-all ${
              selectionMode
                ? 'bg-brand-600 text-white border border-brand-700 shadow-glow'
                : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100'
            }`}
            aria-label="Mode sélection"
          >
            <CheckSquare className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{selectionMode ? 'Quitter' : 'Sélectionner'}</span>
          </button>
          <button
            onClick={() => setImportExportOpen(true)}
            className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100 transition-all"
            aria-label="Import / Export"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Excel</span>
          </button>
          <button
            onClick={openCreate}
            className="shrink-0 w-8 h-8 rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 flex items-center justify-center shadow-glow hover:shadow-premium active:scale-95 transition-all"
            aria-label="Nouvel article"
          >
            <Plus className="w-3.5 h-3.5 text-white" />
          </button>
        </div>
      </div>

      {/* ── Guide interactif catalogue maître ─────────────────────── */}
      {!guideDismissed && (
        <MasterCatalogGuide
          step={guideStep}
          articleCount={articles.length}
          onStep={setGuideStep}
          onDismiss={dismissGuide}
          onGo={goToMasterCatalog}
        />
      )}
      {guideDismissed && (
        <button
          onClick={reopenGuide}
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-brand-700 transition-colors px-1"
        >
          <Lightbulb className="w-3.5 h-3.5" />
          Revoir le guide d'ajout depuis le catalogue maître
        </button>
      )}

      {/* ── Barre de sélection en masse ─────────────────────────────── */}
      {selectionMode && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-gradient-to-r from-brand-50 to-white border border-brand-200 shadow-sm animate-fade-in">
          <button
            onClick={allFilteredSelected ? clearSelection : selectAllFiltered}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold text-brand-700 hover:bg-brand-100 transition-colors"
          >
            {allFilteredSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
            {allFilteredSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
          </button>
          <div className="flex-1 text-[11px] font-semibold text-slate-600 truncate">
            <span className="num font-bold text-brand-700">{selectedIds.size}</span> sélectionné{selectedIds.size > 1 ? 's' : ''}
            {filtered.length > 0 && <span className="text-slate-400"> / {filtered.length}</span>}
          </div>
          <button
            onClick={() => setBulkConfirmOpen(true)}
            disabled={selectedIds.size === 0}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-red-600 text-white shadow-sm hover:bg-red-700 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Supprimer
          </button>
        </div>
      )}

      {/* Inline stats chips */}
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider overflow-x-auto no-scrollbar whitespace-nowrap">
        <span className="shrink-0 px-2 py-1 rounded-full bg-slate-100 text-slate-600 num">{filtered.length} / {articles.length}</span>
        {stats.inStock > 0 && <span className="shrink-0 px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />{stats.inStock} en stock</span>}
        {stats.low > 0 && <span className="shrink-0 px-2 py-1 rounded-full bg-amber-50 text-amber-700">{stats.low} stock bas</span>}
        {stats.out > 0 && <span className="shrink-0 px-2 py-1 rounded-full bg-red-50 text-red-700">{stats.out} rupture{stats.out > 1 ? 's' : ''}</span>}
        {categoryFilter && (
          <button onClick={() => setCategoryFilter('')} className="shrink-0 px-2 py-1 rounded-full bg-brand-50 text-brand-700 border border-brand-200 inline-flex items-center gap-1">
            {selectedCategoryName} <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* ── Liste ─────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="py-20 flex items-center justify-center rounded-2xl bg-white shadow-card border border-slate-100">
          <Loader2 className="w-6 h-6 animate-spin text-brand-700" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl bg-white shadow-card border border-slate-100">
          <EmptyState
            icon={Package}
            title={search || categoryFilter ? 'Aucun article trouvé' : 'Aucun article'}
            description={search || categoryFilter ? 'Essayez d\'autres critères de recherche.' : 'Créez votre premier article pour démarrer.'}
            action={!search && !categoryFilter ? (
              <button onClick={openCreate} className="h-10 px-4 rounded-xl bg-gradient-to-br from-brand-600 to-brand-700 text-white text-sm font-semibold shadow-glow hover:shadow-premium active:scale-95 transition-all inline-flex items-center gap-2">
                <Plus className="w-4 h-4" />Nouvel article
              </button>
            ) : undefined}
          />
        </div>
      ) : (
        <>
          {/* Mobile: cartes */}
          <div className="md:hidden space-y-2.5">
            {paginated.map(a => (
              <ArticleCard
                key={a.id}
                article={a}
                category={categoryMap.get(a.category_id || '')}
                qty={stockMap[a.id] || 0}
                onEdit={() => selectionMode ? toggleSelected(a.id) : openEdit(a)}
                onDelete={() => setToDelete(a)}
                selectionMode={selectionMode}
                selected={selectedIds.has(a.id)}
                onToggleSelect={() => toggleSelected(a.id)}
                showMargin={can('view_margins')}
                showStock={can('view_stock_levels')}
              />
            ))}
          </div>

          {/* Desktop: tableau premium */}
          <div className="hidden md:block rounded-2xl bg-white shadow-card border border-slate-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/70 text-[10px] uppercase text-slate-500 tracking-wider border-b border-slate-100">
                <tr>
                  {selectionMode && (
                    <th className="px-3 py-3 w-10">
                      <button
                        onClick={allFilteredSelected ? clearSelection : selectAllFiltered}
                        className="inline-flex items-center justify-center text-brand-700 hover:text-brand-900 transition-colors"
                        aria-label={allFilteredSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
                      >
                        {allFilteredSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                      </button>
                    </th>
                  )}
                  <th className="px-4 py-3 text-left font-semibold">Article</th>
                  <th className="px-4 py-3 text-left font-semibold">Référence</th>
                  <th className="px-4 py-3 text-left font-semibold">Catégorie</th>
                  <th className="px-4 py-3 text-right font-semibold">Prix vente</th>
                  {can('view_margins') && <th className="px-4 py-3 text-right font-semibold">Marge</th>}
                  {can('view_stock_levels') && <th className="px-4 py-3 text-right font-semibold">Stock</th>}
                  <th className="px-4 py-3 text-right font-semibold"></th>
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
                    <tr
                      key={a.id}
                      className={`group transition-colors ${isSel ? 'bg-brand-50/60' : 'hover:bg-brand-50/30'} ${selectionMode ? 'cursor-pointer' : ''}`}
                      onClick={selectionMode ? () => toggleSelected(a.id) : undefined}
                    >
                      {selectionMode && (
                        <td className="px-3 py-3 w-10">
                          <span className="inline-flex items-center justify-center text-brand-700">
                            {isSel ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-slate-400" />}
                          </span>
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${mStatus.bg}`}>
                            <Package className={`w-4 h-4 ${mStatus.icon}`} />
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 truncate">{a.name}</div>
                            {a.oem_ref && <div className="text-[11px] text-slate-400 font-mono truncate">OEM: {a.oem_ref}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{a.internal_ref}</td>
                      <td className="px-4 py-3 text-slate-600 text-xs truncate max-w-[140px]">{cat?.name || '—'}</td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900 num">{formatFCFA(a.sale_price)}</td>
                      {can('view_margins') && (
                        <td className="px-4 py-3 text-right">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold num ${mgTone}`}>
                            {mg.toFixed(0)}%
                          </span>
                        </td>
                      )}
                      {can('view_stock_levels') && (
                        <td className="px-4 py-3 text-right">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold num ${mStatus.badge}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${mStatus.dot}`} />
                            {qty}
                          </span>
                        </td>
                      )}
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => openEdit(a)} className="p-1.5 rounded-lg hover:bg-brand-100 text-slate-600 hover:text-brand-700 transition-colors" aria-label="Modifier">
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => setToDelete(a)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors" aria-label="Supprimer">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 bg-white border border-slate-100 rounded-2xl shadow-card mt-3">
              <div className="text-xs text-slate-500">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} sur {filtered.length} articles
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(0)} disabled={page === 0} className="px-2 py-1 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-30 transition-colors">1</button>
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-30 transition-colors">Prec</button>
                <span className="px-3 py-1 rounded-lg text-xs font-bold bg-brand-50 text-brand-700 border border-brand-200">{page + 1}/{totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-30 transition-colors">Suiv</button>
                <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} className="px-2 py-1 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-30 transition-colors">{totalPages}</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Sous-modale filtre catégories ─────────────────────────────── */}
      {filterOpen && (
        <CategoryFilterSheet
          categories={categories}
          value={categoryFilter}
          onChange={v => { setCategoryFilter(v); setFilterOpen(false); }}
          onClose={() => setFilterOpen(false)}
        />
      )}

      {/* ── Drawer article ────────────────────────────────────────────── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <div className="relative w-full sm:max-w-2xl lg:max-w-3xl bg-white sm:rounded-2xl shadow-premium flex flex-col max-h-[95vh] sm:max-h-[90vh] animate-slide-up">
            {/* Header */}
            <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5 border-b border-slate-100 shrink-0">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-600 to-brand-700 flex items-center justify-center shadow-glow shrink-0">
                {editing ? <Edit2 className="w-5 h-5 text-white" /> : <Plus className="w-5 h-5 text-white" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wider text-brand-700/80">
                  {editing ? 'Modification' : 'Nouvel article'}
                </div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900 truncate leading-tight">
                  {editing ? editing.name : 'Nouvel article'}
                </h2>
              </div>
              <button onClick={() => setDrawerOpen(false)} className="shrink-0 p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs pills */}
            <div className="px-3 sm:px-5 pt-3 pb-2 shrink-0 overflow-x-auto no-scrollbar">
              <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-2xl">
                {TABS.map(t => {
                  const Icon = t.icon;
                  const active = tab === t.k;
                  return (
                    <button
                      key={t.k}
                      onClick={() => setTab(t.k)}
                      className={`relative shrink-0 inline-flex items-center gap-1.5 px-3 sm:px-4 h-9 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all ${
                        active
                          ? 'bg-white text-brand-700 shadow-card'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {t.l}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4">
              {tab === 'infos' && (
                <InfosTab
                  form={form} setForm={setForm} editing={!!editing}
                  categories={categories} suppliers={suppliers} onGenerateRef={generateRef}
                  autoMode={autoMode}
                />
              )}
              {tab === 'prix' && (
                <PrixTab form={form} setForm={setForm} marginValue={marginValue} marginStr={marginStr} showPurchasePrice={can('view_purchase_prices')} showMargin={can('view_margins')} />
              )}
              {tab === 'stock' && (
                <StockTab form={form} setForm={setForm} editing={!!editing} currentArticle={editing} stockMap={stockMap} />
              )}
              {tab === 'compat' && autoMode && (
                <CompatTab
                  compats={compats} brands={brands} models={models}
                  onAdd={addCompat} onRemove={removeCompat}
                  onUpdate={(i, patch) => setCompats(arr => arr.map((x, j) => j === i ? { ...x, ...patch } : x))}
                />
              )}
              {tab === 'image' && (
                <ImageTab
                  currentUrl={imagePreview}
                  uploading={imageUploading}
                  onFileSelect={file => {
                    setImageFile(file);
                    setImageDeletePending(false);
                    const url = URL.createObjectURL(file);
                    setImagePreview(url);
                  }}
                  onDelete={() => {
                    setImageFile(null);
                    setImagePreview(null);
                    setImageDeletePending(true);
                  }}
                />
              )}
            </div>

            {/* Footer sticky */}
            <div className="shrink-0 border-t border-slate-100 bg-white/95 backdrop-blur-md px-4 sm:px-5 py-3 flex items-center gap-2.5 safe-bottom">
              <div className="hidden sm:block text-[11px] text-slate-400 font-mono truncate flex-1">
                {editing ? editing.internal_ref : (form.internal_ref || 'Auto')}
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="flex-1 sm:flex-none h-11 px-4 rounded-xl bg-slate-100 text-slate-700 text-sm font-semibold hover:bg-slate-200 active:scale-95 transition-all"
              >
                Annuler
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="flex-[2] sm:flex-none h-11 px-6 rounded-xl bg-gradient-to-br from-brand-600 to-brand-700 text-white text-sm font-bold shadow-glow hover:shadow-premium active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {editing ? 'Enregistrer' : 'Créer l\'article'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={del}
        title="Supprimer l'article ?"
        message={`"${toDelete?.name}" sera supprimé définitivement s'il n'est utilisé dans aucune opération, sinon simplement désactivé.`}
        confirmLabel="Supprimer"
        danger
      />

      <ConfirmDialog
        open={bulkConfirmOpen}
        onClose={() => { if (!bulkDeleting) setBulkConfirmOpen(false); }}
        onConfirm={bulkDelete}
        title={`Supprimer ${selectedIds.size} article${selectedIds.size > 1 ? 's' : ''} ?`}
        message={`Les articles sélectionnés seront supprimés définitivement s'ils ne sont utilisés dans aucune opération, sinon simplement désactivés (les ventes et opérations restent intactes). Cette action ne peut pas être annulée.`}
        confirmLabel={bulkDeleting ? 'Suppression…' : 'Supprimer la sélection'}
        danger
      />

      {/* ── Import / Export Modal ────────────────────────────────────── */}
      <Modal
        open={importExportOpen}
        onClose={() => { setImportExportOpen(false); resetImport(); }}
        title="Import / Export Excel"
        size="md"
        footer={
          importRows.length > 0 ? (
            <>
              <button onClick={resetImport} className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100">Annuler</button>
              <button onClick={runArticleImport} disabled={importingArticles} className="px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-brand-600 to-brand-700 text-white shadow-glow inline-flex items-center gap-1.5 disabled:opacity-50">
                {importingArticles ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                {importingArticles ? 'Import...' : `Importer ${importRows.length} article${importRows.length > 1 ? 's' : ''}`}
              </button>
            </>
          ) : (
            <button onClick={() => { setImportExportOpen(false); resetImport(); }} className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white">Fermer</button>
          )
        }
      >
        <div className="space-y-4">
          {/* Actions */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button onClick={downloadArticleTemplate} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-sky-300 hover:bg-sky-50/50 transition text-left">
              <div className="w-9 h-9 rounded-xl bg-sky-100 flex items-center justify-center shrink-0">
                <Download className="w-4 h-4 text-sky-600" />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-900">Modele Excel</div>
                <div className="text-[10px] text-slate-500">Fichier vierge avec un exemple</div>
              </div>
            </button>
            <button onClick={exportArticles} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/50 transition text-left">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                <Upload className="w-4 h-4 text-emerald-600" />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-900">Exporter mes articles</div>
                <div className="text-[10px] text-slate-500">{articles.length} articles (format re-importable)</div>
              </div>
            </button>
          </div>

          {/* Column reference */}
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Colonnes attendues</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
              {TENANT_IMPORT_HEADERS.map(h => (
                <div key={h.key} className={`text-[10px] px-2 py-1 rounded-md ${h.required ? 'bg-brand-50 border border-brand-200 font-bold text-brand-800' : 'bg-white border border-slate-100 text-slate-600'}`}>
                  {h.label}
                </div>
              ))}
            </div>
          </div>

          {/* File upload */}
          <div>
            <label className="flex flex-col items-center justify-center gap-2 p-5 border-2 border-dashed border-slate-300 rounded-2xl cursor-pointer hover:border-brand-400 hover:bg-brand-50/30 transition">
              <Upload className="w-5 h-5 text-slate-400" />
              <div className="text-xs text-slate-600 text-center">Cliquez ou glissez un fichier Excel (.xlsx)</div>
              {importFilename && <div className="text-[11px] font-semibold text-brand-700">{importFilename} — {importRows.length} ligne{importRows.length > 1 ? 's' : ''}</div>}
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ''; }} />
            </label>
          </div>

          {/* Import result */}
          {importResult && (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-100 text-center">
                  <div className="text-[9px] font-bold uppercase text-emerald-700">Crees</div>
                  <div className="text-lg font-bold text-emerald-800 num">{importResult.imported}</div>
                </div>
                <div className="p-2.5 rounded-xl bg-sky-50 border border-sky-100 text-center">
                  <div className="text-[9px] font-bold uppercase text-sky-700">Mis à jour</div>
                  <div className="text-lg font-bold text-sky-800 num">{importResult.updated}</div>
                </div>
                <div className="p-2.5 rounded-xl bg-red-50 border border-red-100 text-center">
                  <div className="text-[9px] font-bold uppercase text-red-700">Erreurs</div>
                  <div className="text-lg font-bold text-red-800 num">{importResult.errors?.length || 0}</div>
                </div>
              </div>
              {importResult.errors && importResult.errors.length > 0 && (
                <div className="max-h-32 overflow-auto bg-slate-50 rounded-xl p-2 space-y-0.5">
                  {importResult.errors.map((e: any, i: number) => (
                    <div key={i} className="text-[10px] text-red-700">Ligne {e.row}: {e.error}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function stockStatus(qty: number, min: number) {
  if (qty === 0) return {
    label: 'Rupture',
    bg: 'bg-red-50', icon: 'text-red-500', badge: 'bg-red-50 text-red-700 border border-red-100', dot: 'bg-red-500',
  };
  if (qty <= min) return {
    label: 'Stock bas',
    bg: 'bg-amber-50', icon: 'text-amber-600', badge: 'bg-amber-50 text-amber-700 border border-amber-100', dot: 'bg-amber-500',
  };
  return {
    label: 'En stock',
    bg: 'bg-emerald-50', icon: 'text-emerald-600', badge: 'bg-emerald-50 text-emerald-700 border border-emerald-100', dot: 'bg-emerald-500',
  };
}

// ─── Article card (mobile) ───────────────────────────────────────────

function ArticleCard({ article, category, qty, onEdit, onDelete, selectionMode, selected, onToggleSelect, showMargin = true, showStock = true }: {
  article: Article;
  category: Category | undefined;
  qty: number;
  onEdit: () => void;
  onDelete: () => void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  showMargin?: boolean;
  showStock?: boolean;
}) {
  const min = Number(article.stock_min || 0);
  const st = stockStatus(qty, min);
  const mg = article.sale_price > 0 ? ((article.sale_price - article.purchase_price) / article.sale_price) * 100 : 0;
  const mgTone = mg >= 30 ? 'text-emerald-700 bg-emerald-50' : mg >= 15 ? 'text-amber-700 bg-amber-50' : 'text-red-700 bg-red-50';

  return (
    <div className={`group rounded-2xl bg-white shadow-card border p-3.5 active:scale-[0.99] transition-all ${selected ? 'border-brand-400 ring-2 ring-brand-500/20' : 'border-slate-100'}`}>
      <div className="flex items-start gap-3">
        {selectionMode && (
          <button
            onClick={onToggleSelect}
            className="shrink-0 mt-1 inline-flex items-center justify-center w-6 h-6 rounded-md text-brand-700"
            aria-label={selected ? 'Désélectionner' : 'Sélectionner'}
          >
            {selected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-slate-400" />}
          </button>
        )}
        <button
          onClick={onEdit}
          className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 overflow-hidden ${st.bg} active:scale-95 transition-transform`}
        >
          {article.image_url ? (
            <img src={article.image_url} alt={article.name} className="w-full h-full object-cover" />
          ) : (
            <Package className={`w-5 h-5 ${st.icon}`} />
          )}
        </button>
        <div className="flex-1 min-w-0" onClick={onEdit}>
          <div className="font-semibold text-slate-900 text-[15px] leading-snug line-clamp-2">{article.name}</div>
          <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px]">
            <span className="font-mono text-slate-500 truncate max-w-[120px]">{article.internal_ref}</span>
            {category && (
              <span className="inline-flex items-center gap-1 text-slate-400 truncate max-w-[110px]">
                <Tag className="w-3 h-3 shrink-0" />{category.name}
              </span>
            )}
          </div>
          {article.oem_ref && (
            <div className="mt-1 text-[11px] text-slate-400 font-mono truncate">OEM · {article.oem_ref}</div>
          )}
        </div>
        {!selectionMode && (
          <button
            onClick={onDelete}
            className="shrink-0 p-2 rounded-xl text-slate-300 hover:bg-red-50 hover:text-red-500 transition-colors"
            aria-label="Supprimer"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 overflow-hidden">
          {showStock && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold num shrink-0 ${st.badge}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
              {qty} <span className="opacity-70">{st.label}</span>
            </span>
          )}
          {showMargin && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold num shrink-0 ${mgTone}`}>
              {mg.toFixed(0)}%
            </span>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Vente</div>
          <div className="text-base font-bold text-slate-900 num leading-none">{formatFCFA(article.sale_price)}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Category filter sheet ───────────────────────────────────────────

function CategoryFilterSheet({ categories, value, onChange, onClose }: {
  categories: Category[];
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
}) {
  const roots = categories.filter(c => !c.parent_id);
  return (
    <div className="fixed inset-0 z-[55] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-white sm:rounded-2xl shadow-premium flex flex-col max-h-[85vh] animate-slide-up">
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-100 shrink-0">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-brand-700/80">Filtrer</div>
            <h3 className="text-base font-bold text-slate-900">Catégorie</h3>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <button
            onClick={() => onChange('')}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              !value ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'hover:bg-slate-50 text-slate-700 border border-transparent'
            }`}
          >
            <span className="inline-flex items-center gap-2"><Layers className="w-4 h-4" />Toutes les catégories</span>
            {!value && <CheckCircle2 className="w-4 h-4 text-brand-600" />}
          </button>
          {roots.length === 0 && (
            <div className="text-center text-xs text-slate-400 py-6">Aucune catégorie disponible</div>
          )}
          {roots.map(c => {
            const children = categories.filter(s => s.parent_id === c.id);
            const selected = value === c.id;
            return (
              <div key={c.id}>
                <button
                  onClick={() => onChange(c.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    selected ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'hover:bg-slate-50 text-slate-800 border border-transparent'
                  }`}
                >
                  <span className="truncate">{c.name}</span>
                  {selected && <CheckCircle2 className="w-4 h-4 text-brand-600" />}
                </button>
                {children.map(s => {
                  const sel = value === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => onChange(s.id)}
                      className={`w-full flex items-center justify-between pl-8 pr-3 py-2 rounded-xl text-sm transition-all ${
                        sel ? 'bg-brand-50 text-brand-700 border border-brand-200 font-semibold' : 'hover:bg-slate-50 text-slate-600 border border-transparent'
                      }`}
                    >
                      <span className="truncate">{s.name}</span>
                      {sel && <CheckCircle2 className="w-4 h-4 text-brand-600" />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Infos tab ───────────────────────────────────────────────────────

function InfosTab({ form, setForm, editing, categories, suppliers, onGenerateRef, autoMode }: {
  form: Form; setForm: (f: (prev: Form) => Form) => void; editing: boolean;
  categories: Category[]; suppliers: any[]; onGenerateRef: () => void; autoMode: boolean;
}) {
  const namePlaceholder = autoMode
    ? 'Ex: Filtre à huile Toyota Corolla E150'
    : 'Ex: T-shirt coton col rond — Taille M';
  return (
    <div className="space-y-3.5">
      <Field label="Désignation" required icon={<Package className="w-3.5 h-3.5" />}>
        <input
          value={form.name || ''}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          autoFocus={desktopAutoFocus}
          placeholder={namePlaceholder}
          className="premium-input"
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <Field label="Référence interne" required icon={<Hash className="w-3.5 h-3.5" />}>
          <div className="flex gap-2">
            <input
              value={form.internal_ref || ''}
              onChange={e => setForm(f => ({ ...f, internal_ref: e.target.value }))}
              placeholder="FIL-HUI-001"
              className="premium-input font-mono flex-1"
            />
            {!editing && (
              <button
                type="button"
                onClick={onGenerateRef}
                className="shrink-0 px-3 h-11 rounded-xl bg-brand-50 text-brand-700 text-xs font-bold border border-brand-200 hover:bg-brand-100 active:scale-95 transition-all"
              >
                Auto
              </button>
            )}
          </div>
        </Field>

        <Field label="Code-barres" icon={<Barcode className="w-3.5 h-3.5" />}>
          <input
            value={form.barcode || ''}
            onChange={e => setForm(f => ({ ...f, barcode: e.target.value }))}
            className="premium-input font-mono"
            placeholder="3610123456789"
          />
        </Field>

        <Field label="Catégorie" icon={<Tag className="w-3.5 h-3.5" />}>
          <PremiumSelect
            value={form.category_id || ''}
            onChange={v => setForm(f => ({ ...f, category_id: v || undefined }))}
            placeholder="Choisir une catégorie"
            options={[
              { value: '', label: 'Sans catégorie' },
              ...categories.filter(c => !c.parent_id).flatMap(c => [
                { value: c.id, label: c.name, bold: true },
                ...categories.filter(s => s.parent_id === c.id).map(s => ({ value: s.id, label: `  ↳ ${s.name}` })),
              ]),
            ]}
          />
        </Field>

        <Field label="Marque">
          <input
            value={form.brand || ''}
            onChange={e => setForm(f => ({ ...f, brand: e.target.value }))}
            placeholder={autoMode ? 'Bosch, NGK, Valeo…' : 'Marque du produit'}
            className="premium-input"
          />
        </Field>

        {autoMode && (
          <Field label="Référence OEM">
            <input
              value={form.oem_ref || ''}
              onChange={e => setForm(f => ({ ...f, oem_ref: e.target.value }))}
              placeholder="90915-YZZD4"
              className="premium-input font-mono"
            />
          </Field>
        )}

        <Field label="Référence fournisseur">
          <input
            value={form.supplier_ref || ''}
            onChange={e => setForm(f => ({ ...f, supplier_ref: e.target.value }))}
            className="premium-input font-mono"
          />
        </Field>

        <Field label="Fournisseur principal">
          <PremiumSelect
            value={form.supplier_id || ''}
            onChange={v => setForm(f => ({ ...f, supplier_id: v || undefined }))}
            placeholder="Aucun"
            options={[{ value: '', label: '—' }, ...suppliers.map(s => ({ value: s.id, label: s.name }))]}
          />
        </Field>

        {autoMode && (
          <Field label="État">
            <PremiumSelect
              value={form.condition || 'neuf'}
              onChange={v => setForm(f => ({ ...f, condition: v }))}
              options={[
                { value: 'neuf', label: 'Neuf' },
                { value: 'occasion', label: 'Occasion' },
                { value: 'reconditionne', label: 'Reconditionné' },
              ]}
            />
          </Field>
        )}

        <Field label="Unité">
          <PremiumSelect
            value={form.unit || (autoMode ? 'pièce' : 'unité')}
            onChange={v => setForm(f => ({ ...f, unit: v }))}
            options={autoMode ? [
              { value: 'pièce', label: 'Pièce' },
              { value: 'kit', label: 'Kit' },
              { value: 'litre', label: 'Litre' },
              { value: 'bidon', label: 'Bidon' },
              { value: 'flacon', label: 'Flacon' },
              { value: 'paire', label: 'Paire' },
            ] : [
              { value: 'unité', label: 'Unité' },
              { value: 'pièce', label: 'Pièce' },
              { value: 'paire', label: 'Paire' },
              { value: 'lot', label: 'Lot' },
              { value: 'paquet', label: 'Paquet' },
              { value: 'carton', label: 'Carton' },
              { value: 'kg', label: 'Kilogramme' },
              { value: 'g', label: 'Gramme' },
              { value: 'litre', label: 'Litre' },
              { value: 'ml', label: 'Millilitre' },
              { value: 'mètre', label: 'Mètre' },
              { value: 'heure', label: 'Heure' },
              { value: 'jour', label: 'Jour' },
              { value: 'service', label: 'Service' },
            ]}
          />
        </Field>
      </div>

      <Field label="Description">
        <textarea
          value={form.description || ''}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          rows={3}
          placeholder="Notes, caractéristiques, dimensions…"
          className="premium-input resize-none"
        />
      </Field>
    </div>
  );
}

// ─── Prix tab ────────────────────────────────────────────────────────

function PrixTab({ form, setForm, marginValue, marginStr, showPurchasePrice = true, showMargin = true }: {
  form: Form; setForm: (f: (prev: Form) => Form) => void;
  marginValue: number; marginStr: string;
  showPurchasePrice?: boolean; showMargin?: boolean;
}) {
  const achat = Number(form.purchase_price || 0);
  const vente = Number(form.sale_price || 0);
  const marginFcfa = vente - achat;

  const marginTone = marginValue >= 30
    ? { bg: 'from-emerald-500 to-emerald-600', text: 'text-emerald-50', icon: TrendingUp, label: 'Marge rentable' }
    : marginValue >= 15
      ? { bg: 'from-amber-500 to-amber-600', text: 'text-amber-50', icon: TrendingUp, label: 'Marge correcte' }
      : { bg: 'from-red-500 to-red-600', text: 'text-red-50', icon: TrendingDown, label: 'Marge faible' };
  const MgIcon = marginTone.icon;

  return (
    <div className="space-y-4">
      {/* Marge KPI hero card */}
      {showMargin && (
        <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${marginTone.bg} p-5 shadow-premium`}>
          <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/10" />
          <div className="absolute -bottom-10 -left-6 w-28 h-28 rounded-full bg-black/10" />
          <div className="relative">
            <div className="flex items-center gap-2 text-white/80 text-[10px] font-bold uppercase tracking-wider">
              <MgIcon className="w-3.5 h-3.5" />
              {marginTone.label}
            </div>
            <div className="mt-2 flex items-end gap-3">
              <div className={`text-5xl font-bold ${marginTone.text} num leading-none`}>{marginStr}<span className="text-2xl ml-1">%</span></div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-3 py-2">
                <div className="text-[10px] text-white/70 font-semibold uppercase tracking-wider">Gain unitaire</div>
                <div className="text-white font-bold num text-sm mt-0.5">{formatFCFA(marginFcfa)}</div>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-3 py-2">
                <div className="text-[10px] text-white/70 font-semibold uppercase tracking-wider">Coefficient</div>
                <div className="text-white font-bold num text-sm mt-0.5">
                  {achat > 0 ? (vente / achat).toFixed(2) : '—'}×
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Prix grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        {showPurchasePrice && (
          <Field label="Prix d'achat" hint="FCFA HT">
            <PriceInput value={form.purchase_price} onChange={v => setForm(f => ({ ...f, purchase_price: v }))} />
          </Field>
        )}
        <Field label="Prix de vente" required hint="FCFA TTC">
          <PriceInput value={form.sale_price} onChange={v => setForm(f => ({ ...f, sale_price: v }))} emphasize />
        </Field>
        <Field label="Prix minimum" hint="Seuil plancher">
          <PriceInput value={form.min_price} onChange={v => setForm(f => ({ ...f, min_price: v }))} />
        </Field>
        <Field label="Prix grossiste" hint="Revendeurs">
          <PriceInput value={form.wholesale_price} onChange={v => setForm(f => ({ ...f, wholesale_price: v }))} />
        </Field>
        <Field label="TVA applicable">
          <PremiumSelect
            value={String(form.vat_rate ?? 0)}
            onChange={v => setForm(f => ({ ...f, vat_rate: Number(v) }))}
            options={[
              { value: '0', label: 'Hors taxe (0%)' },
              { value: '18', label: 'TVA Sénégal (18%)' },
            ]}
          />
        </Field>
      </div>
    </div>
  );
}

function PriceInput({ value, onChange, emphasize }: { value: number | undefined; onChange: (v: number) => void; emphasize?: boolean }) {
  return (
    <div className="relative">
      <input
        type="number"
        inputMode="decimal"
        min={0}
        value={value ?? ''}
        onChange={e => onChange(Number(e.target.value))}
        placeholder="0"
        className={`premium-input pr-14 num ${emphasize ? 'text-lg font-bold text-brand-800' : 'text-base font-semibold text-slate-900'}`}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-wider text-slate-400 pointer-events-none">FCFA</span>
    </div>
  );
}

// ─── Stock tab ───────────────────────────────────────────────────────

function StockTab({ form, setForm, editing, currentArticle, stockMap }: {
  form: Form; setForm: (f: (prev: Form) => Form) => void;
  editing: boolean; currentArticle: Article | null; stockMap: Record<string, number>;
}) {
  const currentQty = currentArticle ? (stockMap[currentArticle.id] || 0) : 0;
  const st = editing && currentArticle
    ? stockStatus(currentQty, Number(currentArticle.stock_min || 0))
    : null;

  return (
    <div className="space-y-4">
      {editing && st && currentArticle && (
        <div className="rounded-2xl bg-slate-900 text-white p-4 shadow-premium relative overflow-hidden">
          <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full bg-white/5" />
          <div className="relative flex items-center gap-4">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${st.bg}`}>
              <Boxes className={`w-6 h-6 ${st.icon}`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Stock actuel</div>
              <div className="text-3xl font-bold num leading-tight">{currentQty}</div>
              <div className="text-xs text-slate-300 mt-0.5">{st.label}</div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3.5">
        <Field label="Stock minimum" hint="Alerte réappro.">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={form.stock_min ?? ''}
            onChange={e => setForm(f => ({ ...f, stock_min: Number(e.target.value) }))}
            className="premium-input num font-semibold"
            placeholder="0"
          />
        </Field>
        <Field label="Stock maximum" hint="Capacité rayon">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={form.stock_max ?? ''}
            onChange={e => setForm(f => ({ ...f, stock_max: Number(e.target.value) }))}
            className="premium-input num font-semibold"
            placeholder="0"
          />
        </Field>
      </div>

      <Field label="Emplacement" icon={<MapPin className="w-3.5 h-3.5" />}>
        <input
          value={form.location || ''}
          onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
          placeholder="Rayon A-1, Casier 3…"
          className="premium-input"
        />
      </Field>

      {!editing && (
        <Field label="Stock initial" hint="Magasin actuel">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={form.stock_init ?? ''}
            onChange={e => setForm(f => ({ ...f, stock_init: Number(e.target.value) }))}
            className="premium-input num font-semibold"
            placeholder="0"
          />
          <p className="text-[11px] text-slate-400 mt-1.5 px-1">Entrez la quantité physique actuellement en stock.</p>
        </Field>
      )}

      {editing && (
        <div className="rounded-2xl bg-brand-50/60 border border-brand-100 p-4 flex gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-100 flex items-center justify-center shrink-0">
            <AlertCircle className="w-4 h-4 text-brand-700" />
          </div>
          <div className="text-xs text-brand-900 leading-relaxed">
            <div className="font-bold mb-0.5">Modifier la quantité ?</div>
            Utilisez le module <span className="font-bold">Stock</span> → Entrée / Sortie manuelle pour garder une traçabilité complète.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Compat tab ──────────────────────────────────────────────────────

function CompatTab({ compats, brands, models, onAdd, onRemove, onUpdate }: {
  compats: Compat[]; brands: VehicleBrand[]; models: any[];
  onAdd: () => void; onRemove: (i: number) => void;
  onUpdate: (i: number, patch: Partial<Compat>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-900">Véhicules compatibles</div>
          <p className="text-[11px] text-slate-500 mt-0.5">{compats.length} compatibilité{compats.length > 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={onAdd}
          className="shrink-0 h-9 px-3 rounded-xl bg-brand-600 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-glow hover:shadow-premium active:scale-95 transition-all"
        >
          <Plus className="w-3.5 h-3.5" />Ajouter
        </button>
      </div>

      {compats.length === 0 && (
        <button
          onClick={onAdd}
          className="w-full rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-8 flex flex-col items-center gap-2 text-slate-400 hover:border-brand-300 hover:bg-brand-50/30 hover:text-brand-700 transition-all active:scale-[0.99]"
        >
          <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center shadow-card">
            <Car className="w-5 h-5" />
          </div>
          <div className="text-sm font-semibold">Aucune compatibilité</div>
          <div className="text-[11px]">Appuyez pour ajouter un véhicule compatible</div>
        </button>
      )}

      <div className="space-y-2.5">
        {compats.map((c, i) => {
          const brand = brands.find(b => b.id === c.brand_id);
          const model = models.find(m => m.id === c.model_id);
          return (
            <div key={i} className="group rounded-2xl bg-white border border-slate-200 shadow-card overflow-hidden">
              <div className="px-3.5 py-2.5 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100 flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
                  <Car className="w-4 h-4 text-brand-700" />
                </div>
                <div className="flex-1 min-w-0 text-xs">
                  <div className="font-bold text-slate-900 truncate">
                    {brand?.name || 'Marque ?'} {model?.name && <span className="text-slate-500 font-medium">· {model.name}</span>}
                  </div>
                  {(c.year_start || c.year_end) ? (
                    <div className="text-[10px] text-slate-400 num">{c.year_start || '?'} – {c.year_end || 'auj.'}</div>
                  ) : (
                    <div className="text-[10px] text-slate-400">Toutes années</div>
                  )}
                </div>
                <button
                  onClick={() => onRemove(i)}
                  className="shrink-0 p-1.5 rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-500 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-3 space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <MiniField label="Marque">
                    <PremiumSelect
                      value={c.brand_id}
                      onChange={v => onUpdate(i, { brand_id: v, model_id: '' })}
                      placeholder="—"
                      options={[{ value: '', label: '—' }, ...brands.map(b => ({ value: b.id, label: b.name }))]}
                      compact
                    />
                  </MiniField>
                  <MiniField label="Modèle">
                    <PremiumSelect
                      value={c.model_id}
                      onChange={v => onUpdate(i, { model_id: v })}
                      placeholder="—"
                      disabled={!c.brand_id}
                      options={[{ value: '', label: '—' }, ...models.filter(m => m.brand_id === c.brand_id).map(m => ({ value: m.id, label: m.name }))]}
                      compact
                    />
                  </MiniField>
                  <MiniField label="Année début">
                    <input
                      type="number"
                      inputMode="numeric"
                      value={c.year_start || ''}
                      onChange={e => onUpdate(i, { year_start: Number(e.target.value) })}
                      placeholder="2005"
                      className="w-full h-10 px-3 rounded-xl bg-slate-50 border border-slate-200 text-sm num font-semibold focus:bg-white focus:border-brand-400 focus:ring-2 focus:ring-brand-500/15 outline-none transition-all"
                    />
                  </MiniField>
                  <MiniField label="Année fin">
                    <input
                      type="number"
                      inputMode="numeric"
                      value={c.year_end || ''}
                      onChange={e => onUpdate(i, { year_end: Number(e.target.value) })}
                      placeholder="2015"
                      className="w-full h-10 px-3 rounded-xl bg-slate-50 border border-slate-200 text-sm num font-semibold focus:bg-white focus:border-brand-400 focus:ring-2 focus:ring-brand-500/15 outline-none transition-all"
                    />
                  </MiniField>
                </div>
                <MiniField label="Notes moteur / boîte">
                  <input
                    value={c.notes}
                    onChange={e => onUpdate(i, { notes: e.target.value })}
                    placeholder="Moteur 1.6 VVTi, boîte manuelle…"
                    className="w-full h-10 px-3 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:bg-white focus:border-brand-400 focus:ring-2 focus:ring-brand-500/15 outline-none transition-all"
                  />
                </MiniField>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Image tab ───────────────────────────────────────────────────────

function ImageTab({ currentUrl, uploading, onFileSelect, onDelete }: {
  currentUrl: string | null;
  uploading: boolean;
  onFileSelect: (file: File) => void;
  onDelete: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      alert('Image trop lourde. Maximum 5 Mo.');
      return;
    }
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      alert('Format accepté : JPG, PNG, WEBP uniquement.');
      return;
    }
    onFileSelect(file);
    // Reset input so the same file can be re-selected
    e.target.value = '';
  };

  return (
    <div className="space-y-4">
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 px-1">Photo article</div>

      {/* Preview zone */}
      <div className="relative group">
        {currentUrl ? (
          <div className="relative rounded-2xl overflow-hidden border border-slate-200 shadow-card bg-slate-50">
            <img
              src={currentUrl}
              alt="Aperçu article"
              className="w-full max-h-72 object-contain bg-gradient-to-br from-slate-50 to-slate-100"
            />
            {uploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
                <div className="flex items-center gap-2 text-white text-sm font-semibold">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Enregistrement…
                </div>
              </div>
            )}
            {/* Action overlay */}
            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-3 py-2.5 bg-gradient-to-t from-slate-900/80 to-transparent">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/20 backdrop-blur border border-white/30 text-white text-xs font-semibold hover:bg-white/30 transition-all active:scale-95"
              >
                <Upload className="w-3.5 h-3.5" />
                Remplacer
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/80 backdrop-blur border border-red-400/30 text-white text-xs font-semibold hover:bg-red-600/90 transition-all active:scale-95"
              >
                <X className="w-3.5 h-3.5" />
                Supprimer
              </button>
            </div>
          </div>
        ) : (
          /* Drop / click zone */
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="w-full flex flex-col items-center justify-center gap-3 py-14 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-brand-300 transition-all active:scale-[0.99] group"
          >
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100 flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
              <ImageIcon className="w-7 h-7 text-brand-600" />
            </div>
            <div className="text-center">
              <div className="text-sm font-bold text-slate-700">Ajouter une photo</div>
              <div className="text-xs text-slate-400 mt-0.5">JPG, PNG, WEBP · Max 5 Mo</div>
            </div>
            <div className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 text-white text-xs font-bold shadow-glow">
              <Camera className="w-3.5 h-3.5" />
              Choisir un fichier
            </div>
          </button>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        onChange={handleFile}
        className="hidden"
      />

      {/* Tips */}
      <div className="flex items-start gap-2 p-3 rounded-xl bg-blue-50 border border-blue-100">
        <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
        <div className="text-[11px] text-blue-700 leading-relaxed">
          <span className="font-bold">Conseils : </span>
          fond blanc ou neutre, bonne luminosité, article bien cadré. L'image s'affichera sur la boutique en ligne et dans les fiches produits.
        </div>
      </div>
    </div>
  );
}

// ─── Master catalog interactive guide ────────────────────────────────

function MasterCatalogGuide({ step, articleCount, onStep, onDismiss, onGo }: {
  step: number;
  articleCount: number;
  onStep: (s: number) => void;
  onDismiss: () => void;
  onGo: () => void;
}) {
  const STEPS = [
    {
      icon: Library,
      title: 'Gagnez du temps avec le catalogue maître',
      body: 'Plutôt que de saisir chaque article manuellement, importez en quelques clics depuis notre catalogue partagé (références, prix, photos déjà prêts).',
    },
    {
      icon: MousePointerClick,
      title: 'Ouvrez le catalogue maître',
      body: 'Allez sur la page « Catalogue maître » dans le menu latéral, ou cliquez sur le bouton ci-dessous.',
    },
    {
      icon: CheckSquare,
      title: 'Sélectionnez vos articles',
      body: 'Filtrez par catégorie, cochez les articles qui vous intéressent puis lancez l\'import. Les fiches s\'ajoutent automatiquement à votre catalogue.',
    },
    {
      icon: Download,
      title: 'Personnalisez après import',
      body: 'Une fois importés, ajustez prix de vente, stock initial et marge depuis cette page « Articles ». Vos modifications n\'affectent pas le catalogue partagé.',
    },
  ];
  const total = STEPS.length;
  const current = Math.min(Math.max(step, 0), total - 1);
  const S = STEPS[current];
  const Icon = S.icon;
  const isLast = current === total - 1;
  const isFirst = current === 0;

  // Suggestion contextuelle : afficher le bouton « Aller au catalogue » dès l'étape 2 et après.
  const showGoButton = current >= 1;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-800 text-white shadow-premium animate-fade-in">
      <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10 pointer-events-none" />
      <div className="absolute -bottom-12 -left-8 w-32 h-32 rounded-full bg-black/10 pointer-events-none" />

      <button
        onClick={onDismiss}
        className="absolute top-2.5 right-2.5 p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors z-10"
        aria-label="Fermer le guide"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="relative p-4 sm:p-5">
        {/* Step indicator */}
        <div className="flex items-center gap-1.5 mb-3">
          {STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => onStep(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === current ? 'bg-white w-8' : i < current ? 'bg-white/70 w-4' : 'bg-white/30 w-4 hover:bg-white/50'
              }`}
              aria-label={`Étape ${i + 1}`}
            />
          ))}
          <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-white/70 num">
            {current + 1} / {total}
          </span>
        </div>

        <div className="flex items-start gap-3 sm:gap-4">
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-white/15 backdrop-blur-sm border border-white/20 flex items-center justify-center shrink-0 shadow-sm">
            <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-white/70 mb-0.5 flex items-center gap-1.5">
              <Lightbulb className="w-3 h-3" />
              Astuce — Étape {current + 1}
            </div>
            <h3 className="text-sm sm:text-base font-bold leading-tight">{S.title}</h3>
            <p className="text-xs sm:text-[13px] text-white/85 mt-1 leading-relaxed pr-2">{S.body}</p>

            {current === 0 && articleCount === 0 && (
              <div className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 backdrop-blur-sm border border-white/20 text-[11px] font-semibold">
                <Tag className="w-3 h-3" />
                Catalogue vide — c'est le moment idéal !
              </div>
            )}

            {/* Actions */}
            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              {!isFirst && (
                <button
                  onClick={() => onStep(current - 1)}
                  className="h-8 px-3 rounded-xl bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/20 text-xs font-semibold transition-all active:scale-95"
                >
                  Précédent
                </button>
              )}
              {!isLast && (
                <button
                  onClick={() => onStep(current + 1)}
                  className="h-8 px-3.5 rounded-xl bg-white text-brand-800 text-xs font-bold shadow-sm hover:shadow-md active:scale-95 transition-all inline-flex items-center gap-1.5"
                >
                  Suivant <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
              {isLast && (
                <button
                  onClick={onDismiss}
                  className="h-8 px-3.5 rounded-xl bg-white text-brand-800 text-xs font-bold shadow-sm hover:shadow-md active:scale-95 transition-all inline-flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  J'ai compris
                </button>
              )}
              {showGoButton && (
                <button
                  onClick={onGo}
                  className="h-8 px-3.5 rounded-xl bg-emerald-400 text-emerald-950 text-xs font-bold shadow-sm hover:bg-emerald-300 active:scale-95 transition-all inline-flex items-center gap-1.5"
                >
                  <Library className="w-3.5 h-3.5" />
                  Ouvrir le catalogue maître
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={onDismiss}
                className="h-8 px-2.5 rounded-xl text-white/70 hover:text-white hover:bg-white/10 text-xs font-semibold transition-all"
              >
                Ne plus afficher
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Reusable premium primitives ─────────────────────────────────────

function Field({ label, required, hint, icon, children }: {
  label: string; required?: boolean; hint?: string; icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between mb-1.5 px-1">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-600">
          {icon && <span className="text-slate-400">{icon}</span>}
          {label}
          {required && <span className="text-red-500">*</span>}
        </span>
        {hint && <span className="text-[10px] text-slate-400 font-medium">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

function MiniField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 px-0.5">{label}</div>
      {children}
    </div>
  );
}

function PremiumSelect({ value, onChange, options, placeholder, disabled, compact }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; bold?: boolean }[];
  placeholder?: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className={`w-full appearance-none ${compact ? 'h-10 text-sm' : 'h-11 text-sm'} pl-3 pr-9 rounded-xl bg-slate-50 border border-slate-200 font-medium text-slate-800 focus:bg-white focus:border-brand-400 focus:ring-2 focus:ring-brand-500/15 outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {placeholder && !value && <option value="">{placeholder}</option>}
        {options.map(o => (
          <option key={o.value} value={o.value} style={o.bold ? { fontWeight: 700 } : undefined}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
    </div>
  );
}
