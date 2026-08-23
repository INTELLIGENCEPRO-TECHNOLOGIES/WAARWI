import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, Loader2, Package, Check, Download, X, Filter,
  ChevronRight, ChevronDown, AlertCircle, CheckCircle2, Layers, RefreshCw
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { formatFCFA } from '../lib/format';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';

type ActivityType = { id: string; name: string; slug: string };
type Catalog = { id: string; name: string; description: string };
type Category = { id: string; name: string; slug: string; parent_id: string | null };
type Item = {
  id: string; designation: string; brand: string; model: string;
  manufacturer_ref: string; unit: string;
  purchase_price: number; sale_price: number; vat_rate: number;
  barcode: string; description: string; image_url: string;
  category_id: string | null; subcategory_id: string | null;
  is_active: boolean;
};
type FilterStatus = 'all' | 'imported' | 'available';

export function MasterCatalog() {
  const { tenant, currentSite, sites } = useApp();
  const { success, error: toastError } = useToast();
  const sharedArticles = (tenant as any)?.settings?.shared_articles !== false;
  const isMultiSite = sites.length > 1;

  const [activity, setActivity] = useState<ActivityType | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [subcategoryId, setSubcategoryId] = useState<string>('');
  const [brandFilter, setBrandFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 60;
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchInput = (val: string) => {
    setSearchInput(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(val), 200);
  };

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState<null | { mode: 'selected' | 'category' | 'subcategory' | 'all'; label: string; count: number }>(null);
  const [lastResult, setLastResult] = useState<{ imported: number; skipped: number; errors: any[] } | null>(null);
  const [lotOpen, setLotOpen] = useState(false);

  const MAX_IMPORT = 500;

  const activityTypeId = (tenant as any)?.business_activity_type_id || null;

  useEffect(() => {
    if (!tenant) return;
    let cancelled = false;
    (async () => {
      setLoading(true);

      // Si pas d'activity configurée sur tenant, fallback via business_type texte
      let actId = activityTypeId;
      if (!actId && (tenant as any)?.business_type) {
        const { data: bat } = await supabase
          .from('business_activity_types')
          .select('id, name, slug')
          .eq('legacy_business_type', (tenant as any).business_type)
          .maybeSingle();
        if (bat) actId = bat.id;
      }

      if (!actId) { if (!cancelled) { setLoading(false); } return; }

      const { data: activityRow } = await supabase
        .from('business_activity_types')
        .select('id, name, slug')
        .eq('id', actId)
        .maybeSingle();

      const { data: catalogRow } = await supabase
        .from('master_catalogs')
        .select('id, name, description')
        .eq('business_activity_type_id', actId)
        .eq('is_active', true)
        .order('created_at')
        .limit(1)
        .maybeSingle();

      if (!catalogRow) {
        if (!cancelled) { setActivity(activityRow); setCatalog(null); setLoading(false); }
        return;
      }

      const { data: cats } = await supabase
        .from('master_catalog_categories').select('id, name, slug, parent_id')
        .eq('master_catalog_id', catalogRow.id).eq('is_active', true).order('sort_order');

      // Paginate imported IDs — PostgREST caps at 1000 rows per request
      const allImportedIds: string[] = [];
      {
        let from = 0;
        const batchSize = 1000;
        let hasMore = true;
        while (hasMore) {
          let q = supabase.from('articles')
            .select('master_catalog_item_id')
            .eq('tenant_id', tenant.id)
            .not('master_catalog_item_id', 'is', null)
            .range(from, from + batchSize - 1);
          if (!sharedArticles && currentSite) {
            q = q.eq('site_id', currentSite.id);
          }
          const { data: batch } = await q;
          const rows = batch || [];
          allImportedIds.push(...rows.map((a: any) => a.master_catalog_item_id).filter(Boolean));
          hasMore = rows.length === batchSize;
          from += batchSize;
        }
      }

      // Load all catalog items with pagination (PostgREST default limit is 1000)
      const allItems: Item[] = [];
      let from = 0;
      const pageSize = 1000;
      let hasMore = true;
      while (hasMore) {
        const { data: page } = await supabase
          .from('master_catalog_items')
          .select('id, designation, brand, model, manufacturer_ref, unit, purchase_price, sale_price, vat_rate, barcode, description, image_url, category_id, subcategory_id, is_active')
          .eq('master_catalog_id', catalogRow.id).eq('is_active', true)
          .order('designation')
          .range(from, from + pageSize - 1);
        const rows = (page || []) as Item[];
        allItems.push(...rows);
        hasMore = rows.length === pageSize;
        from += pageSize;
      }

      if (cancelled) return;
      setActivity(activityRow);
      setCatalog(catalogRow);
      setCategories((cats || []) as Category[]);
      setItems(allItems);
      setImportedIds(new Set(allImportedIds));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tenant?.id, activityTypeId, currentSite?.id, sharedArticles]);

  // Helper to re-fetch just the importedIds (lightweight, paginated)
  const refreshImportedIds = async (silent = false) => {
    if (!tenant) return;
    if (!silent) setRefreshing(true);
    const allIds: string[] = [];
    let from = 0;
    const batchSize = 1000;
    let hasMore = true;
    while (hasMore) {
      let q = supabase.from('articles')
        .select('master_catalog_item_id')
        .eq('tenant_id', tenant.id)
        .not('master_catalog_item_id', 'is', null)
        .range(from, from + batchSize - 1);
      if (!sharedArticles && currentSite) {
        q = q.eq('site_id', currentSite.id);
      }
      const { data } = await q;
      const rows = data || [];
      allIds.push(...rows.map((a: any) => a.master_catalog_item_id).filter(Boolean));
      hasMore = rows.length === batchSize;
      from += batchSize;
    }
    setImportedIds(new Set(allIds));
    if (!silent) setRefreshing(false);
  };

  // Realtime: auto-update importedIds when articles are inserted/deleted for this tenant
  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(`master-catalog-imported-${tenant.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'articles',
        filter: `tenant_id=eq.${tenant.id}`,
      }, (payload) => {
        const id = (payload.new as any)?.master_catalog_item_id;
        if (id) setImportedIds(prev => new Set([...prev, id]));
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'articles',
        filter: `tenant_id=eq.${tenant.id}`,
      }, () => {
        // On delete, do a full refresh to stay consistent
        refreshImportedIds(true);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tenant?.id]);

  const rootCategories = useMemo(() => categories.filter(c => !c.parent_id), [categories]);
  const subcategories = useMemo(
    () => categoryId ? categories.filter(c => c.parent_id === categoryId) : [],
    [categories, categoryId]
  );
  const brands = useMemo(() => {
    const set = new Set<string>();
    items.forEach(i => { if (i.brand) set.add(i.brand); });
    return Array.from(set).sort();
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(i => {
      if (categoryId && i.category_id !== categoryId) return false;
      if (subcategoryId && i.subcategory_id !== subcategoryId) return false;
      if (brandFilter && i.brand !== brandFilter) return false;
      if (statusFilter === 'imported' && !importedIds.has(i.id)) return false;
      if (statusFilter === 'available' && importedIds.has(i.id)) return false;
      if (q) {
        const hay = `${i.designation} ${i.brand} ${i.model} ${i.manufacturer_ref} ${i.barcode}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, search, categoryId, subcategoryId, brandFilter, statusFilter, importedIds]);

  useEffect(() => { setPage(0); }, [search, categoryId, subcategoryId, brandFilter, statusFilter]);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);

  const selectableFiltered = filtered.filter(i => !importedIds.has(i.id));
  const allFilteredSelected = selectableFiltered.length > 0 && selectableFiltered.every(i => selected.has(i.id));

  const toggleSelect = (id: string) => {
    if (importedIds.has(id)) return;
    setSelected(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  // Remove from selection any item that becomes imported (e.g. after an import runs)
  useEffect(() => {
    setSelected(s => {
      const cleaned = new Set([...s].filter(id => !importedIds.has(id)));
      return cleaned.size === s.size ? s : cleaned;
    });
  }, [importedIds]);

  const toggleAllFiltered = () => {
    setSelected(s => {
      const n = new Set(s);
      if (allFilteredSelected) {
        selectableFiltered.forEach(i => n.delete(i.id));
      } else {
        selectableFiltered.forEach(i => n.add(i.id));
      }
      return n;
    });
  };

  const selectBatch = (n: number) => {
    setSelected(s => {
      const n2 = new Set(s);
      let added = 0;
      for (const i of selectableFiltered) {
        if (added >= n) break;
        if (!n2.has(i.id)) { n2.add(i.id); added++; }
      }
      return n2;
    });
  };

  const selectPage = () => {
    setSelected(s => {
      const n2 = new Set(s);
      paginated.forEach(i => { if (!importedIds.has(i.id)) n2.add(i.id); });
      return n2;
    });
  };

  const clearFilters = () => {
    setSearch(''); setSearchInput(''); setCategoryId(''); setSubcategoryId(''); setBrandFilter(''); setStatusFilter('all');
    setFiltersOpen(false);
  };

  const activeFilterCount = [categoryId, subcategoryId, brandFilter, statusFilter !== 'all' ? statusFilter : ''].filter(Boolean).length;

  const runImport = async (mode: 'selected' | 'category' | 'subcategory' | 'all') => {
    if (!confirmOpen) return;
    if (confirmOpen.count > MAX_IMPORT) {
      toastError(`Maximum ${MAX_IMPORT} articles par import. Sélectionnez un lot plus petit.`);
      return;
    }
    setImporting(true);
    try {
      const payload: any = {
        p_item_ids: null,
        p_category_id: null,
        p_subcategory_id: null,
        p_import_all: false,
        p_site_id: (!sharedArticles && currentSite) ? currentSite.id : null,
      };
      if (mode === 'selected') {
        payload.p_item_ids = Array.from(selected);
      } else if (mode === 'category') {
        payload.p_category_id = categoryId || null;
      } else if (mode === 'subcategory') {
        payload.p_subcategory_id = subcategoryId || null;
      } else if (mode === 'all') {
        payload.p_import_all = true;
      }

      const { data, error } = await supabase.rpc('import_master_catalog_items_to_tenant', payload);
      if (error) throw error;

      const result = data as { imported: number; skipped: number; errors: any[] };
      setLastResult(result);
      setSelected(new Set());
      setConfirmOpen(null);

      // Refresh imported IDs
      await refreshImportedIds(true);

      if (result.imported > 0) success(`${result.imported} article${result.imported > 1 ? 's' : ''} importé${result.imported > 1 ? 's' : ''}`);
      if (result.skipped > 0 && result.imported === 0) toastError(`${result.skipped} article(s) déjà importé${result.skipped > 1 ? 's' : ''} (statut actualisé)`);
    } catch (e: any) {
      toastError(e.message || 'Erreur lors de l\'import');
      setConfirmOpen(null);
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return (
      <div className="py-16 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-brand-700" />
      </div>
    );
  }

  if (!catalog) {
    return (
      <div>
        <EmptyState
          icon={Package}
          title="Aucun catalogue maître disponible"
          description={
            activity
              ? `Aucun catalogue n'est encore configuré pour l'activité "${activity.name}". Contactez l'équipe plateforme.`
              : 'Votre type d\'activité n\'est pas configuré. Contactez l\'équipe plateforme.'
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-6">
      {/* Header */}
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-5 lg:-mx-8 px-4 sm:px-5 lg:px-8 pb-3 pt-4 -mt-3 sm:-mt-4 lg:-mt-6 bg-white space-y-3 border-b border-neutral-100">
      <div className="flex items-start justify-between">
        <h1 className="text-lg font-bold text-neutral-900 leading-tight">Catalogue maître</h1>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => refreshImportedIds()}
            disabled={refreshing}
            className="shrink-0 p-1.5 text-neutral-500 hover:text-neutral-700 transition-colors disabled:opacity-50"
            title="Actualiser le statut des articles importés"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          {selected.size > 0 ? (
            <button
              disabled={importing}
              onClick={() => setConfirmOpen({ mode: 'selected', label: 'la sélection', count: selected.size })}
              className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold transition-colors disabled:opacity-50 ${selected.size > MAX_IMPORT ? 'text-red-600 hover:text-red-700' : 'text-brand-700 hover:text-brand-800'}`}
              title={`Importer la sélection (${selected.size})`}
            >
              {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              <span className="num">{selected.size}</span>
            </button>
          ) : (
            <button
              disabled={importing}
              onClick={() => {
                const count = items.filter(i => !importedIds.has(i.id)).length;
                setConfirmOpen({ mode: 'all', label: 'tout le catalogue', count });
              }}
              className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold text-neutral-700 hover:text-neutral-900 transition-colors disabled:opacity-50"
              title="Importer tout le catalogue"
            >
              {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4 text-neutral-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <input
            value={searchInput}
            onChange={e => handleSearchInput(e.target.value)}
            placeholder="Désignation, marque, référence…"
            className="bare-input w-full text-sm py-1.5"
          />
          <div className="h-px bg-neutral-200 mt-1" />
        </div>
        {search && (
          <button onClick={() => { setSearch(''); setSearchInput(''); }} className="shrink-0 p-1 text-neutral-400 hover:text-neutral-600"><X className="w-4 h-4" /></button>
        )}
        <button
          onClick={() => setFiltersOpen(true)}
          className={`shrink-0 inline-flex items-center gap-1.5 text-[11px] font-semibold transition-colors ${activeFilterCount > 0 ? 'text-brand-700' : 'text-neutral-500 hover:text-neutral-700'}`}
        >
          <Filter className="w-3.5 h-3.5" />
          {activeFilterCount > 0 && <span className="num">{activeFilterCount}</span>}
        </button>
      </div>

      {/* Selection stats */}
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider overflow-x-auto no-scrollbar whitespace-nowrap">
        <span className="shrink-0 text-neutral-500 num">{filtered.length} / {items.length}</span>
        <span className="shrink-0 text-emerald-600 inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{importedIds.size} importé{importedIds.size > 1 ? 's' : ''}</span>
        {selected.size > 0 && (
          <span className={`shrink-0 inline-flex items-center gap-1 font-bold ${selected.size > MAX_IMPORT ? 'text-red-600' : 'text-brand-700'}`}>
            {selected.size > MAX_IMPORT && <AlertCircle className="w-3 h-3" />}
            {selected.size} sélectionné{selected.size > 1 ? 's' : ''}
            {selected.size > MAX_IMPORT && ` (max ${MAX_IMPORT})`}
          </span>
        )}
        {activeFilterCount > 0 && <button onClick={clearFilters} className="btn-icon" title="Effacer"><X className="w-4 h-4" /></button>}
      </div>

      {/* Selection tools — one line */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 shrink-0">Sélection</span>
        <div className="relative">
          <button
            onClick={() => setLotOpen(v => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-brand-700 transition-colors"
          >
            <Layers className="w-3.5 h-3.5" />Lot
            <ChevronDown className={`w-3 h-3 transition-transform ${lotOpen ? 'rotate-180' : ''}`} />
          </button>
          {lotOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setLotOpen(false)} />
              <div className="absolute top-full left-0 mt-1 z-50 bg-white rounded-xl shadow-premium border border-slate-100 py-1 min-w-[150px] animate-scale-in origin-top-left">
                {[100, 200, 300, 400, 500].map(n => (
                  <button
                    key={n}
                    onClick={() => { selectBatch(n); setLotOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-brand-700 hover:bg-brand-50/50 transition-colors"
                  >
                    {n} articles
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {paginated.some(i => !importedIds.has(i.id)) && (
          <button onClick={selectPage}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 hover:text-brand-700 transition-colors">
            <Check className="w-3.5 h-3.5" />Page
          </button>
        )}
        {selectableFiltered.length > 0 && (
          <button onClick={toggleAllFiltered}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 hover:text-brand-700 transition-colors">
            {allFilteredSelected ? 'Désélectionner filtrés' : `Tout (${selectableFiltered.length})`}
          </button>
        )}
        {selected.size > 0 && (
          <button onClick={() => setSelected(new Set())}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-700 transition-colors">
            <X className="w-3 h-3" />Effacer
          </button>
        )}
        {categoryId && !subcategoryId && (
          <button
            disabled={importing}
            onClick={() => {
              const cat = rootCategories.find(c => c.id === categoryId);
              const count = items.filter(i => i.category_id === categoryId && !importedIds.has(i.id)).length;
              setConfirmOpen({ mode: 'category', label: `la catégorie "${cat?.name}"`, count });
            }}
            className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 hover:text-brand-700 transition-colors disabled:opacity-50"
            title="Importer la catégorie"
          >
            <Download className="w-3.5 h-3.5" />Catégorie
          </button>
        )}
        {subcategoryId && (
          <button
            disabled={importing}
            onClick={() => {
              const sc = subcategories.find(c => c.id === subcategoryId);
              const count = items.filter(i => i.subcategory_id === subcategoryId && !importedIds.has(i.id)).length;
              setConfirmOpen({ mode: 'subcategory', label: `la sous-catégorie "${sc?.name}"`, count });
            }}
            className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 hover:text-brand-700 transition-colors disabled:opacity-50"
            title="Importer la sous-catégorie"
          >
            <Download className="w-3.5 h-3.5" />Sous-cat.
          </button>
        )}
      </div>
      </div>

      {/* Items grid */}
      {filtered.length === 0 ? (
        <div className="py-12"><EmptyState icon={Package} title="Aucun article" description="Ajustez vos filtres ou votre recherche." /></div>
      ) : (
        <>
        {/* Desktop: thin list with header */}
        <div className="hidden md:block">
          <div className="grid grid-cols-[28px_1fr_120px_140px_100px_90px_36px] gap-2 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-neutral-200 sticky top-[52px] z-10 bg-slate-50/95 backdrop-blur-sm">
            <div></div>
            <div>Désignation</div>
            <div>Marque</div>
            <div>Réf. fabricant</div>
            <div className="text-right">Achat</div>
            <div className="text-right">Vente</div>
            <div className="text-center">Unité</div>
          </div>
          {paginated.map(i => {
            const isImported = importedIds.has(i.id);
            const isSelected = selected.has(i.id);
            return (
              <div
                key={i.id}
                className={`grid grid-cols-[28px_1fr_120px_140px_100px_90px_36px] gap-2 px-3 py-2 items-center text-[12px] border-b border-neutral-100 last:border-b-0 transition-colors ${isSelected ? 'bg-brand-50/40' : isImported ? 'bg-emerald-50/20' : 'hover:bg-neutral-50'}`}
              >
                <div className="flex items-center justify-center">
                  {!isImported ? (
                    <button
                      onClick={() => toggleSelect(i.id)}
                      className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all ${isSelected ? 'bg-black border-black' : 'border-slate-400 hover:border-black'}`}
                      aria-label="Sélectionner"
                    >
                      {isSelected && <Check className="w-2 h-2 text-white" strokeWidth={3} />}
                    </button>
                  ) : (
                    <div className="w-3.5 h-3.5 rounded bg-emerald-500 border border-emerald-500 flex items-center justify-center" title="Déjà importé">
                      <Check className="w-2 h-2 text-white" strokeWidth={3} />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 truncate leading-tight">{i.designation}</div>
                  {isImported && <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-700">Importé</span>}
                </div>
                <div className="truncate">{i.brand && <span className="text-[10px] font-semibold text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded">{i.brand}</span>}</div>
                <div className="font-mono text-slate-500 text-[11px] truncate">{i.manufacturer_ref || '—'}</div>
                <div className="text-right font-bold text-slate-800 num">{formatFCFA(i.purchase_price)}</div>
                <div className="text-right font-bold text-brand-700 num">{formatFCFA(i.sale_price)}</div>
                <div className="text-center text-slate-600 font-medium truncate">{i.unit}</div>
              </div>
            );
          })}
        </div>
        {/* Mobile: card grid */}
        <div className="md:hidden">
          {paginated.map(i => {
            const isImported = importedIds.has(i.id);
            const isSelected = selected.has(i.id);
            return (
              <div
                key={i.id}
                className={`flex items-start gap-2 py-2.5 px-1 border-b border-neutral-100 last:border-b-0 transition-colors ${isSelected ? 'bg-brand-50/40' : isImported ? 'bg-emerald-50/20' : ''}`}
              >
                {!isImported ? (
                  <button
                    onClick={() => toggleSelect(i.id)}
                    className={`shrink-0 w-4 h-4 mt-0.5 rounded border flex items-center justify-center transition-all ${isSelected ? 'bg-black border-black' : 'border-slate-400 hover:border-black'}`}
                    aria-label="Sélectionner"
                  >
                    {isSelected && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                  </button>
                ) : (
                  <div className="shrink-0 w-4 h-4 mt-0.5 rounded bg-emerald-500 border border-emerald-500 flex items-center justify-center" title="Déjà importé">
                    <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                  </div>
                )}
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="text-[11px] font-semibold text-slate-900 line-clamp-2">{i.designation}</div>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    {i.brand && <span className="text-[9px] font-semibold text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded">{i.brand}</span>}
                    {i.manufacturer_ref && <span className="text-[9px] font-mono text-slate-400 truncate">{i.manufacturer_ref}</span>}
                    {isImported && <span className="text-[9px] font-bold text-emerald-700 inline-flex items-center gap-0.5"><CheckCircle2 className="w-2.5 h-2.5" />Importé</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Achat <span className="text-slate-700 num">{formatFCFA(i.purchase_price)}</span></span>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Vente <span className="text-brand-700 num">{formatFCFA(i.sale_price)}</span></span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 mt-3">
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

      {/* Filters modal */}
      <Modal open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filtres" size="sm"
        footer={<>
          <button onClick={clearFilters} className="btn-icon" title="Effacer"><X className="w-4 h-4" /></button>
          <button onClick={() => setFiltersOpen(false)} className="btn-icon-primary" title="Appliquer"><Check className="w-4 h-4" /></button>
        </>}
      >
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Catégorie</label>
            <select value={categoryId} onChange={e => { setCategoryId(e.target.value); setSubcategoryId(''); }} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20">
              <option value="">Toutes les catégories</option>
              {rootCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {subcategories.length > 0 && (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Sous-catégorie</label>
              <select value={subcategoryId} onChange={e => setSubcategoryId(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20">
                <option value="">Toutes les sous-catégories</option>
                {subcategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Marque</label>
            <select value={brandFilter} onChange={e => setBrandFilter(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20">
              <option value="">Toutes les marques</option>
              {brands.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Statut</label>
            <div className="mt-1 grid grid-cols-3 gap-1.5">
              {(['all', 'available', 'imported'] as FilterStatus[]).map(s => (
                <button key={s} onClick={() => setStatusFilter(s)}
                  className={`px-2 py-2 rounded-xl text-[11px] font-semibold transition ${statusFilter === s ? 'bg-brand-600 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}>
                  {s === 'all' ? 'Tous' : s === 'available' ? 'Disponibles' : 'Déjà importés'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      {/* Confirm modal */}
      <Modal open={!!confirmOpen} onClose={() => !importing && setConfirmOpen(null)} title="Confirmer l'import" size="sm"
        footer={<>
          <button onClick={() => setConfirmOpen(null)} disabled={importing} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
          <button
            onClick={() => confirmOpen && runImport(confirmOpen.mode)}
            disabled={importing || (confirmOpen?.count ?? 0) > MAX_IMPORT}
            className="btn-icon-primary" title="Confirmer l'import"
          >
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          </button>
        </>}
      >
        {confirmOpen && (
          <div className="space-y-3">
            {confirmOpen.count > MAX_IMPORT ? (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200">
                <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
                <div className="space-y-1.5">
                  <div className="text-sm font-bold text-red-800">Limite d'import dépassée</div>
                  <div className="text-xs text-red-700">
                    Vous ne pouvez importer que <span className="font-bold">{MAX_IMPORT} articles maximum</span> par opération.
                    Vous en avez sélectionné <span className="font-bold">{confirmOpen.count}</span>.
                  </div>
                  <div className="text-xs text-red-600 mt-1 font-medium">
                    Utilisez les boutons <strong>"Sélectionner par lot"</strong> (100, 200, 300, 400 ou 500) pour importer progressivement.
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start gap-2 p-3 rounded-xl bg-brand-50/60 border border-brand-100">
                  <AlertCircle className="w-4 h-4 text-brand-700 mt-0.5 shrink-0" />
                  <div className="text-xs text-slate-700">
                    Vous êtes sur le point d'importer {confirmOpen.label}. <span className="font-semibold">{confirmOpen.count}</span> article{confirmOpen.count !== 1 ? 's' : ''} seront ajoutés à votre catalogue. Les articles déjà importés seront ignorés automatiquement.
                  </div>
                </div>
                {isMultiSite && !sharedArticles && currentSite && (
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200">
                    <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                    <div className="text-xs text-amber-800">
                      <span className="font-bold">Mode catalogues indépendants actif.</span> Les articles seront importés uniquement dans le magasin <span className="font-semibold">« {currentSite.name} »</span>. Pour importer les articles dans vos {sites.length} magasins simultanément, activez le mode « Catalogue partagé » dans Paramètres &gt; Gestion des stocks.
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Modal>

      {/* Last result modal */}
      <Modal open={!!lastResult} onClose={() => setLastResult(null)} title="Résultat de l'import" size="sm"
        footer={<button onClick={() => setLastResult(null)} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>}
      >
        {lastResult && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Importés</div>
                <div className="text-2xl font-bold text-emerald-800 num mt-1">{lastResult.imported}</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Ignorés (doublons)</div>
                <div className="text-2xl font-bold text-slate-700 num mt-1">{lastResult.skipped}</div>
              </div>
            </div>
            {lastResult.errors && lastResult.errors.length > 0 && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-100 max-h-40 overflow-auto">
                <div className="text-[10px] font-bold uppercase tracking-wider text-red-700 mb-1">Erreurs ({lastResult.errors.length})</div>
                <div className="space-y-1 text-[11px] text-red-800">
                  {lastResult.errors.slice(0, 10).map((e: any, idx: number) => (
                    <div key={idx} className="break-words">· {e.designation || e.item_id}: {e.error}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
