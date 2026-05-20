import { useEffect, useMemo, useState } from 'react';
import {
  Search, Loader2, Package, Check, Download, X, Filter,
  ChevronRight, ChevronDown, AlertCircle, Sparkles, CheckCircle2
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
  const { tenant } = useApp();
  const { success, error: toastError } = useToast();

  const [activity, setActivity] = useState<ActivityType | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [subcategoryId, setSubcategoryId] = useState<string>('');
  const [brandFilter, setBrandFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState<null | { mode: 'selected' | 'category' | 'subcategory' | 'all'; label: string; count: number }>(null);
  const [lastResult, setLastResult] = useState<{ imported: number; skipped: number; errors: any[] } | null>(null);

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

      const [{ data: cats }, { data: its }, { data: arts }] = await Promise.all([
        supabase.from('master_catalog_categories').select('id, name, slug, parent_id')
          .eq('master_catalog_id', catalogRow.id).eq('is_active', true).order('sort_order'),
        supabase.from('master_catalog_items')
          .select('id, designation, brand, model, manufacturer_ref, unit, purchase_price, sale_price, vat_rate, barcode, description, image_url, category_id, subcategory_id, is_active')
          .eq('master_catalog_id', catalogRow.id).eq('is_active', true).order('designation'),
        supabase.from('articles')
          .select('master_catalog_item_id')
          .eq('tenant_id', tenant.id)
          .not('master_catalog_item_id', 'is', null),
      ]);

      if (cancelled) return;
      setActivity(activityRow);
      setCatalog(catalogRow);
      setCategories((cats || []) as Category[]);
      setItems((its || []) as Item[]);
      setImportedIds(new Set((arts || []).map((a: any) => a.master_catalog_item_id).filter(Boolean)));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tenant?.id, activityTypeId]);

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

  const selectableFiltered = filtered.filter(i => !importedIds.has(i.id));
  const allFilteredSelected = selectableFiltered.length > 0 && selectableFiltered.every(i => selected.has(i.id));

  const toggleSelect = (id: string) => {
    setSelected(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

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

  const clearFilters = () => {
    setSearch(''); setCategoryId(''); setSubcategoryId(''); setBrandFilter(''); setStatusFilter('all');
    setFiltersOpen(false);
  };

  const activeFilterCount = [categoryId, subcategoryId, brandFilter, statusFilter !== 'all' ? statusFilter : ''].filter(Boolean).length;

  const runImport = async (mode: 'selected' | 'category' | 'subcategory' | 'all') => {
    setImporting(true);
    try {
      const payload: any = {
        p_item_ids: null,
        p_category_id: null,
        p_subcategory_id: null,
        p_import_all: false,
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
      if (tenant) {
        const { data: arts } = await supabase.from('articles')
          .select('master_catalog_item_id')
          .eq('tenant_id', tenant.id)
          .not('master_catalog_item_id', 'is', null);
        setImportedIds(new Set((arts || []).map((a: any) => a.master_catalog_item_id).filter(Boolean)));
      }

      if (result.imported > 0) success(`${result.imported} article${result.imported > 1 ? 's' : ''} importé${result.imported > 1 ? 's' : ''}`);
      if (result.skipped > 0 && result.imported === 0) toastError(`${result.skipped} article(s) déjà existants`);
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
      <div className="card-premium">
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
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 rounded-2xl bg-white border border-slate-200 shadow-sm hover:shadow-md focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-500/20 transition-all">
          <div className="flex items-center gap-2 pr-2 border-r border-slate-200 shrink-0">
            <div className="leading-tight">
              <h1 className="text-sm font-bold tracking-tight text-slate-900 leading-none">Catalogue maître</h1>
              <div className="text-[9px] font-semibold tracking-wider uppercase text-slate-400 leading-none mt-0.5 truncate max-w-[140px]">
                {activity?.name}
              </div>
            </div>
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Désignation, marque, référence…"
            className="flex-1 min-w-0 w-0 bg-transparent text-xs focus:outline-none placeholder:text-slate-400"
          />
          {search && (
            <button onClick={() => setSearch('')} className="shrink-0 p-1 text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>
          )}
          <button
            onClick={() => setFiltersOpen(true)}
            className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-all ${activeFilterCount > 0 ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100'}`}
          >
            <Filter className="w-3.5 h-3.5" />
            {activeFilterCount > 0 && <span className="num">{activeFilterCount}</span>}
          </button>
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 flex items-center justify-center shadow-glow shrink-0">
            <Search className="w-3.5 h-3.5 text-white" />
          </div>
        </div>
      </div>

      {/* Stats chips */}
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider overflow-x-auto no-scrollbar whitespace-nowrap">
        <span className="shrink-0 px-2 py-1 rounded-full bg-slate-100 text-slate-600 num">{filtered.length} / {items.length}</span>
        <span className="shrink-0 px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{importedIds.size} importé{importedIds.size > 1 ? 's' : ''}</span>
        {selected.size > 0 && <span className="shrink-0 px-2 py-1 rounded-full bg-brand-50 text-brand-700">{selected.size} sélectionné{selected.size > 1 ? 's' : ''}</span>}
        {activeFilterCount > 0 && <button onClick={clearFilters} className="shrink-0 px-2 py-1 rounded-full bg-slate-50 text-slate-400 hover:text-slate-600 inline-flex items-center gap-1">Effacer <X className="w-3 h-3" /></button>}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-1.5">
        {selected.size > 0 && (
          <button
            disabled={importing}
            onClick={() => setConfirmOpen({ mode: 'selected', label: 'la sélection', count: selected.size })}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-brand-600 to-brand-700 text-white shadow-glow hover:shadow-lg transition active:scale-95 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            Importer la sélection ({selected.size})
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
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 hover:border-brand-300 text-slate-800 transition active:scale-95 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            Importer la catégorie
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
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 hover:border-brand-300 text-slate-800 transition active:scale-95 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            Importer la sous-catégorie
          </button>
        )}
        <button
          disabled={importing}
          onClick={() => {
            const count = items.filter(i => !importedIds.has(i.id)).length;
            setConfirmOpen({ mode: 'all', label: 'tout le catalogue', count });
          }}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-ink-900 text-white hover:bg-slate-800 transition active:scale-95 disabled:opacity-50"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Importer tout le catalogue
        </button>
        {selectableFiltered.length > 0 && (
          <button
            onClick={toggleAllFiltered}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition"
          >
            {allFilteredSelected ? 'Désélectionner tout' : 'Sélectionner tout'}
          </button>
        )}
      </div>

      {/* Items grid */}
      {filtered.length === 0 ? (
        <div className="card-premium"><EmptyState icon={Package} title="Aucun article" description="Ajustez vos filtres ou votre recherche." /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
          {filtered.map(i => {
            const isImported = importedIds.has(i.id);
            const isSelected = selected.has(i.id);
            return (
              <div
                key={i.id}
                className={`card-premium p-3 flex flex-col gap-2 transition-all ${isSelected ? 'ring-2 ring-brand-500 border-brand-400' : ''} ${isImported ? 'bg-emerald-50/30 border-emerald-100' : ''}`}
              >
                <div className="flex items-start gap-2">
                  {!isImported ? (
                    <button
                      onClick={() => toggleSelect(i.id)}
                      className={`shrink-0 w-5 h-5 mt-0.5 rounded-md border-2 flex items-center justify-center transition-all ${isSelected ? 'bg-brand-600 border-brand-600' : 'border-slate-300 hover:border-brand-400'}`}
                      aria-label="Sélectionner"
                    >
                      {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                    </button>
                  ) : (
                    <div className="shrink-0 w-5 h-5 mt-0.5 rounded-md bg-emerald-500 border-2 border-emerald-500 flex items-center justify-center" title="Déjà importé">
                      <Check className="w-3 h-3 text-white" strokeWidth={3} />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-bold text-slate-900 leading-tight break-words">{i.designation}</div>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {i.brand && <span className="text-[10px] font-semibold text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded">{i.brand}</span>}
                      {i.manufacturer_ref && <span className="text-[10px] font-mono text-slate-500">{i.manufacturer_ref}</span>}
                      {isImported && <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5"><CheckCircle2 className="w-2.5 h-2.5" />Déjà importé</span>}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-1.5 pt-1.5 border-t border-slate-100">
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Achat</div>
                    <div className="text-[11px] font-bold text-slate-800 num leading-tight mt-0.5">{formatFCFA(i.purchase_price)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Vente</div>
                    <div className="text-[11px] font-bold text-brand-700 num leading-tight mt-0.5">{formatFCFA(i.sale_price)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Unité</div>
                    <div className="text-[11px] font-semibold text-slate-600 leading-tight mt-0.5 truncate">{i.unit}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Filters modal */}
      <Modal open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filtres" size="sm"
        footer={<>
          <button onClick={clearFilters} className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100">Effacer</button>
          <button onClick={() => setFiltersOpen(false)} className="px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-brand-600 to-brand-700 text-white shadow-glow">Appliquer</button>
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
          <button onClick={() => setConfirmOpen(null)} disabled={importing} className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50">Annuler</button>
          <button onClick={() => confirmOpen && runImport(confirmOpen.mode)} disabled={importing} className="px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-brand-600 to-brand-700 text-white shadow-glow inline-flex items-center gap-1.5 disabled:opacity-50">
            {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {importing ? 'Import en cours…' : 'Confirmer l\'import'}
          </button>
        </>}
      >
        {confirmOpen && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 p-3 rounded-xl bg-brand-50/60 border border-brand-100">
              <AlertCircle className="w-4 h-4 text-brand-700 mt-0.5 shrink-0" />
              <div className="text-xs text-slate-700">
                Vous êtes sur le point d'importer {confirmOpen.label}. <span className="font-semibold">{confirmOpen.count}</span> article{confirmOpen.count !== 1 ? 's' : ''} seront ajoutés à votre catalogue. Les articles déjà importés seront ignorés automatiquement.
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Last result modal */}
      <Modal open={!!lastResult} onClose={() => setLastResult(null)} title="Résultat de l'import" size="sm"
        footer={<button onClick={() => setLastResult(null)} className="px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-brand-600 to-brand-700 text-white shadow-glow">Fermer</button>}
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
