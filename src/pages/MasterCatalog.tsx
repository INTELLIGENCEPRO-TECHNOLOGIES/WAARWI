import { useRealtimeRefresh, useRealtimeTick } from '../lib/useRealtimeData';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Loader2, Package, Check, Download, X, Filter, CheckCircle2, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { formatFCFA } from '../lib/format';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { PageSearch } from '../components/PageSearch';
import './ArticleCatalog.css';

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
  const filterId = useId();
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

  const MAX_IMPORT = 500;

  const catalogTick = useRealtimeTick(['master_catalogs', 'master_catalog_categories', 'master_catalog_items', 'business_activity_types']);

  const activityTypeId = (tenant as any)?.business_activity_type_id || null;

  useEffect(() => {
    if (!tenant) return;
    let cancelled = false;
    (async () => {


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
  }, [tenant?.id, activityTypeId, currentSite?.id, sharedArticles, catalogTick]);

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

  useRealtimeRefresh(['articles'], () => refreshImportedIds(true), !!tenant?.id);

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
    if (searchTimer.current) clearTimeout(searchTimer.current);
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

  const setImportScope = (mode: 'category' | 'subcategory' | 'all') => {
    const scope = mode === 'category' ? rootCategories.find(item => item.id === categoryId)
      : mode === 'subcategory' ? subcategories.find(item => item.id === subcategoryId) : undefined;
    const count = items.filter(item => !importedIds.has(item.id) && (
      mode === 'all' || (mode === 'category' ? item.category_id === categoryId : item.subcategory_id === subcategoryId)
    )).length;
    setConfirmOpen({ mode, label: scope?.name || 'Tout le catalogue', count });
  };

  if (loading || !catalog) {
    return (
      <div className="article-page">
        <header className="article-page-header"><div className="article-page-title"><h1>Catalogue maître</h1></div></header>
        {loading ? (
          <div className="article-status-line mt-3" role="status"><Loader2 size={16} className="animate-spin" aria-hidden="true" />Chargement du catalogue…</div>
        ) : (
          <EmptyState icon={Package} title="Aucun catalogue maître disponible" description={activity
            ? `Le catalogue de l’activité « ${activity.name} » n’est pas configuré.`
            : 'Le type d’activité de l’entreprise n’est pas configuré.'} />
        )}
      </div>
    );
  }

  return (
    <div className="article-page space-y-3">
      <header className="article-page-header">
        <div className="article-page-title">
          <h1>Catalogue maître</h1>
          <button type="button" onClick={() => refreshImportedIds()} disabled={refreshing} className="btn-secondary article-button" aria-label="Actualiser le statut des articles importés">
            <RefreshCw size={15} aria-hidden="true" className={refreshing ? 'animate-spin' : ''} />
          </button>
          <button type="button" disabled={importing} className="btn-primary article-button"
            onClick={() => selected.size ? setConfirmOpen({ mode: 'selected', label: 'Sélection', count: selected.size }) : setImportScope('all')}>
            {importing ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
            {selected.size ? 'Importer la sélection' : 'Importer le catalogue'}
          </button>
        </div>
        <PageSearch value={searchInput} onChange={handleSearchInput} placeholder="Rechercher un article…"
          rightSlot={<button type="button" className="btn-secondary article-button" onClick={() => setFiltersOpen(true)}>
            <Filter size={15} aria-hidden="true" />Filtres{activeFilterCount > 0 && <span className="num">({activeFilterCount})</span>}
          </button>}
        />
        <div className="article-toolbar article-muted">
          <span className="num">{filtered.length} / {items.length} articles</span>
          <span className="num">{importedIds.size} importé{importedIds.size === 1 ? '' : 's'}</span>
          {selected.size > 0 && <span className={`num ${selected.size > MAX_IMPORT ? 'article-error-text' : ''}`}>
            {selected.size} sélectionné{selected.size === 1 ? '' : 's'}{selected.size > MAX_IMPORT ? ` (limite de ${MAX_IMPORT})` : ''}
          </span>}
          {activeFilterCount > 0 && <button type="button" className="btn-ghost article-button" onClick={clearFilters}><X size={14} aria-hidden="true" />Effacer les filtres</button>}
        </div>
      </header>

      <div className="article-toolbar" aria-label="Sélection dans le catalogue">
        <select aria-label="Sélection par lot" value="" className="article-page-select"
          onChange={event => { if (event.target.value) selectBatch(Number(event.target.value)); }}>
          <option value="">Sélection par lot</option>
          {[100, 200, 300, 400, 500].map(size => <option key={size} value={size}>{size} articles</option>)}
        </select>
        {paginated.some(item => !importedIds.has(item.id)) && <button type="button" onClick={selectPage} className="btn-ghost article-button">
          <Check size={15} aria-hidden="true" />Sélectionner la page
        </button>}
        {selectableFiltered.length > 0 && <button type="button" onClick={toggleAllFiltered} aria-pressed={allFilteredSelected} className="btn-ghost article-button">
          {allFilteredSelected ? 'Désélectionner les résultats' : `Tout sélectionner (${selectableFiltered.length})`}
        </button>}
        {selected.size > 0 && <button type="button" onClick={() => setSelected(new Set())} className="btn-ghost article-button"><X size={15} aria-hidden="true" />Effacer la sélection</button>}
        {categoryId && <button type="button" disabled={importing} onClick={() => setImportScope(subcategoryId ? 'subcategory' : 'category')} className="btn-secondary article-button">
          <Download size={15} aria-hidden="true" />{subcategoryId ? 'Importer la sous-catégorie' : 'Importer la catégorie'}
        </button>}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Package} title="Aucun article trouvé" description="Modifiez la recherche ou les filtres." />
      ) : (
        <>
          <table className="master-catalog-table" aria-label="Articles du catalogue maître">
            <thead>
              <tr>
                <th scope="col"><span className="sr-only">Sélection</span></th>
                <th scope="col">Désignation</th>
                <th scope="col">Marque</th>
                <th scope="col">Référence fabricant</th>
                <th scope="col" className="master-catalog-number">Achat</th>
                <th scope="col" className="master-catalog-number">Vente</th>
                <th scope="col">Unité</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map(item => {
                const imported = importedIds.has(item.id);
                return (
                  <tr key={item.id} data-selected={selected.has(item.id)}>
                    <td className="master-catalog-check">
                      {imported ? <CheckCircle2 size={17} title="Déjà importé" />
                        : <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelect(item.id)} aria-label={`Sélectionner ${item.designation}`} />}
                    </td>
                    <th scope="row" className="master-catalog-name">
                      <strong>{item.designation}</strong>
                      {imported && <small>Déjà importé</small>}
                    </th>
                    <td><span className="master-cell-label" aria-hidden="true">Marque</span>{item.brand || '—'}</td>
                    <td><span className="master-cell-label" aria-hidden="true">Référence fabricant</span>{item.manufacturer_ref || '—'}</td>
                    <td className="master-catalog-number"><span className="master-cell-label" aria-hidden="true">Achat</span><span className="num article-money">{formatFCFA(item.purchase_price)}</span></td>
                    <td className="master-catalog-number"><span className="master-cell-label" aria-hidden="true">Vente</span><span className="num article-money">{formatFCFA(item.sale_price)}</span></td>
                    <td><span className="master-cell-label" aria-hidden="true">Unité</span>{item.unit || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="article-pagination">
              <span className="article-muted num">{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} sur {filtered.length}</span>
              <nav className="article-toolbar" aria-label="Pages du catalogue">
                <button type="button" onClick={() => setPage(0)} disabled={page === 0} title="Première page" className="waarwi-window-button">1</button>
                <button type="button" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} aria-label="Page précédente" className="waarwi-window-button"><ChevronLeft size={16} aria-hidden="true" /></button>
                <span className="article-page-number num">{page + 1} / {totalPages}</span>
                <button type="button" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} aria-label="Page suivante" className="waarwi-window-button"><ChevronRight size={16} aria-hidden="true" /></button>
                <button type="button" onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} title="Dernière page" className="waarwi-window-button">{totalPages}</button>
              </nav>
            </div>
          )}
        </>
      )}

      <Modal open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filtres du catalogue" size="sm" variant="flat" focusOnOpen
        footer={<>
          <button type="button" onClick={clearFilters} className="btn-secondary article-button"><X size={15} aria-hidden="true" />Réinitialiser</button>
          <button type="button" onClick={() => setFiltersOpen(false)} className="btn-primary article-button"><Check size={15} aria-hidden="true" />Appliquer</button>
        </>}>
        <div className="space-y-3 flat-form">
          <div>
            <label htmlFor={filterId + '-category'} className="label">Catégorie</label>
            <select id={filterId + '-category'} value={categoryId} onChange={event => { setCategoryId(event.target.value); setSubcategoryId(''); }} className="input text-sm">
              <option value="">Toutes les catégories</option>
              {rootCategories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </div>
          {subcategories.length > 0 && <div>
            <label htmlFor={filterId + '-subcategory'} className="label">Sous-catégorie</label>
            <select id={filterId + '-subcategory'} value={subcategoryId} onChange={event => setSubcategoryId(event.target.value)} className="input text-sm">
              <option value="">Toutes les sous-catégories</option>
              {subcategories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </div>}
          <div>
            <label htmlFor={filterId + '-brand'} className="label">Marque</label>
            <select id={filterId + '-brand'} value={brandFilter} onChange={event => setBrandFilter(event.target.value)} className="input text-sm">
              <option value="">Toutes les marques</option>
              {brands.map(brand => <option key={brand} value={brand}>{brand}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={filterId + '-status'} className="label">Statut d’import</label>
            <select id={filterId + '-status'} value={statusFilter} onChange={event => setStatusFilter(event.target.value as FilterStatus)} className="input text-sm">
              <option value="all">Tous</option>
              <option value="available">Disponibles</option>
              <option value="imported">Déjà importés</option>
            </select>
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(confirmOpen)} onClose={() => !importing && setConfirmOpen(null)} title="Confirmer l’import" size="sm" variant="flat" focusOnOpen
        footer={<>
          <button type="button" onClick={() => setConfirmOpen(null)} disabled={importing} className="btn-secondary article-button"><X size={15} aria-hidden="true" />Annuler</button>
          <button type="button" onClick={() => confirmOpen && runImport(confirmOpen.mode)} disabled={importing || (confirmOpen?.count ?? 0) > MAX_IMPORT} className="btn-primary article-button">
            {importing ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}Importer
          </button>
        </>}>
        {confirmOpen && (
          <div className="space-y-3 text-sm">
            {confirmOpen.count > MAX_IMPORT ? (
              <p role="alert" className="article-error-text">La sélection contient <strong>{confirmOpen.count} articles</strong>. Choisissez un lot de {MAX_IMPORT} articles maximum.</p>
            ) : (
              <>
                <p className="article-muted">{confirmOpen.label}</p>
                <p><strong className="num">{confirmOpen.count}</strong> article{confirmOpen.count === 1 ? '' : 's'} à ajouter. Les articles déjà importés seront ignorés.</p>
                {isMultiSite && !sharedArticles && currentSite && (
                  <p className="article-muted">Catalogue indépendant · magasin <strong>{currentSite.name}</strong>.</p>
                )}
              </>
            )}
          </div>
        )}
      </Modal>

      <Modal open={Boolean(lastResult)} onClose={() => setLastResult(null)} title="Résultat de l’import" size="sm" variant="flat" focusOnOpen
        footer={<button type="button" onClick={() => setLastResult(null)} className="btn-secondary article-button">Fermer</button>}>
        {lastResult && (
          <div>
            <dl className="article-result-totals">
              <div><dt>Importés</dt><dd className="num">{lastResult.imported}</dd></div>
              <div><dt>Doublons ignorés</dt><dd className="num">{lastResult.skipped}</dd></div>
              <div><dt>Erreurs</dt><dd className="num">{lastResult.errors?.length || 0}</dd></div>
            </dl>
            {lastResult.errors?.length > 0 && <ul className="article-result-errors">{lastResult.errors.slice(0, 10).map((item, index) => (
              <li key={index}>{item.designation || item.item_id} · {item.error}</li>
            ))}</ul>}
          </div>
        )}
      </Modal>
    </div>
  );
}
