import { useEffect, useState } from 'react';
import {
  Plus, Pencil, Trash2, Loader2, Search, Download, Upload, FileText,
  Package, Tag, ChevronRight, Save, Folder, AlertCircle
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { Modal, ConfirmDialog } from './Modal';
import { formatFCFA } from '../lib/format';

type ActivityType = { id: string; name: string; slug: string; description: string; is_active: boolean; legacy_business_type: string | null };
type Catalog = { id: string; business_activity_type_id: string; name: string; description: string; is_active: boolean };
type Category = { id: string; master_catalog_id: string; name: string; slug: string; parent_id: string | null; sort_order: number; is_active: boolean };
type Item = {
  id: string; master_catalog_id: string; category_id: string | null; subcategory_id: string | null;
  manufacturer_ref: string; designation: string; brand: string; model: string; unit: string;
  purchase_price: number; sale_price: number; vat_rate: number; barcode: string;
  description: string; image_url: string; is_active: boolean;
};

type Tab = 'activities' | 'catalogs' | 'categories' | 'items' | 'import';

export function MasterCatalogAdmin() {
  const [tab, setTab] = useState<Tab>('catalogs');

  const [activities, setActivities] = useState<ActivityType[]>([]);
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedCatalogId, setSelectedCatalogId] = useState<string>('');

  const reload = async () => {
    setLoading(true);
    const [a, c, cats] = await Promise.all([
      supabase.from('business_activity_types').select('*').order('name'),
      supabase.from('master_catalogs').select('*').order('name'),
      supabase.from('master_catalog_categories').select('*').order('sort_order'),
    ]);
    setActivities((a.data || []) as ActivityType[]);
    setCatalogs((c.data || []) as Catalog[]);
    setCategories((cats.data || []) as Category[]);
    const catId = selectedCatalogId || (c.data && c.data.length > 0 ? c.data[0].id : '');
    if (!selectedCatalogId && catId) setSelectedCatalogId(catId);
    setLoading(false);
  };

  useEffect(() => { reload(); }, []);

  const tabs: { key: Tab; label: string; icon: any }[] = [
    { key: 'catalogs', label: 'Catalogues', icon: Folder },
    { key: 'activities', label: 'Types d\'activités', icon: Tag },
    { key: 'categories', label: 'Catégories', icon: FileText },
    { key: 'items', label: 'Articles', icon: Package },
    { key: 'import', label: 'Import Excel', icon: Upload },
  ];

  return (
    <div className="space-y-3">
      <div className="flex overflow-x-auto gap-1 bg-white/60 border border-slate-200/70 rounded-2xl p-1 shadow-sm">
        {tabs.map(t => {
          const I = t.icon;
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${active ? 'bg-slate-900 text-white shadow' : 'text-slate-600 hover:bg-white hover:text-slate-900'}`}>
              <I className="w-3.5 h-3.5" />{t.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
      ) : (
        <>
          {tab === 'activities' && <ActivitiesTab activities={activities} onChange={reload} />}
          {tab === 'catalogs' && <CatalogsTab catalogs={catalogs} activities={activities} onChange={reload} selectedId={selectedCatalogId} onSelect={setSelectedCatalogId} />}
          {tab === 'categories' && <CategoriesTab catalogs={catalogs} categories={categories} selectedCatalogId={selectedCatalogId} onSelectCatalog={setSelectedCatalogId} onChange={reload} />}
          {tab === 'items' && <ItemsTab catalogs={catalogs} categories={categories} selectedCatalogId={selectedCatalogId} onSelectCatalog={setSelectedCatalogId} onChange={reload} />}
          {tab === 'import' && <ImportTab catalogs={catalogs} selectedCatalogId={selectedCatalogId} onSelectCatalog={setSelectedCatalogId} onChange={reload} />}
        </>
      )}
    </div>
  );
}

/* ============== ACTIVITIES ============== */
function ActivitiesTab({ activities, onChange }: { activities: ActivityType[]; onChange: () => void }) {
  const { success, error: toastError } = useToast();
  const [editing, setEditing] = useState<ActivityType | null>(null);
  const [isNew, setIsNew] = useState(false);

  const openNew = () => { setIsNew(true); setEditing({ id: '', name: '', slug: '', description: '', is_active: true, legacy_business_type: null }); };
  const openEdit = (a: ActivityType) => { setIsNew(false); setEditing({ ...a }); };

  const save = async () => {
    if (!editing) return;
    try {
      if (!editing.name.trim() || !editing.slug.trim()) { toastError('Nom et slug requis'); return; }
      if (isNew) {
        const { error } = await supabase.from('business_activity_types').insert({
          name: editing.name.trim(), slug: editing.slug.trim().toLowerCase(),
          description: editing.description, is_active: editing.is_active,
          legacy_business_type: editing.legacy_business_type,
        });
        if (error) throw error;
        success('Type d\'activité créé');
      } else {
        const { error } = await supabase.from('business_activity_types')
          .update({
            name: editing.name.trim(), description: editing.description,
            is_active: editing.is_active, legacy_business_type: editing.legacy_business_type,
          })
          .eq('id', editing.id);
        if (error) throw error;
        success('Type d\'activité mis à jour');
      }
      setEditing(null);
      onChange();
    } catch (e: any) { toastError(e.message); }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-500">{activities.length} type{activities.length > 1 ? 's' : ''} d'activité</div>
        <button onClick={openNew} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-brand-600 to-brand-700 text-white shadow-glow hover:shadow-lg transition active:scale-95">
          <Plus className="w-3.5 h-3.5" /> Nouveau type
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
        {activities.map(a => (
          <div key={a.id} className="card-premium p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-slate-900 truncate">{a.name}</div>
                <div className="text-[10px] font-mono text-slate-500 mt-0.5">{a.slug}</div>
                {a.description && <div className="text-[11px] text-slate-600 mt-1 break-words">{a.description}</div>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full ${a.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{a.is_active ? 'Actif' : 'Inactif'}</span>
                <button onClick={() => openEdit(a)} className="p-1.5 rounded-lg hover:bg-slate-100"><Pencil className="w-3.5 h-3.5 text-slate-600" /></button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={isNew ? 'Nouveau type d\'activité' : 'Modifier le type d\'activité'} size="sm"
        footer={<>
          <button onClick={() => setEditing(null)} className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100">Annuler</button>
          <button onClick={save} className="px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-brand-600 to-brand-700 text-white shadow-glow inline-flex items-center gap-1.5"><Save className="w-3.5 h-3.5" />Enregistrer</button>
        </>}>
        {editing && (
          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Nom</label>
              <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Slug (identifiant unique)</label>
              <input value={editing.slug} disabled={!isNew} onChange={e => setEditing({ ...editing, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20 font-mono disabled:bg-slate-50 disabled:text-slate-500" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Description</label>
              <textarea value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} rows={2} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Business type legacy (auto_parts, electronics, fashion, grocery, generic, services)</label>
              <input value={editing.legacy_business_type || ''} onChange={e => setEditing({ ...editing, legacy_business_type: e.target.value || null })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20 font-mono" />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={editing.is_active} onChange={e => setEditing({ ...editing, is_active: e.target.checked })} />
              Actif
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ============== CATALOGS ============== */
function CatalogsTab({ catalogs, activities, onChange, selectedId, onSelect }: { catalogs: Catalog[]; activities: ActivityType[]; onChange: () => void; selectedId: string; onSelect: (id: string) => void }) {
  const { success, error: toastError } = useToast();
  const [editing, setEditing] = useState<Catalog | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    (async () => {
      const results: Record<string, number> = {};
      await Promise.all(catalogs.map(async (c) => {
        const { count } = await supabase
          .from('master_catalog_items')
          .select('*', { count: 'exact', head: true })
          .eq('master_catalog_id', c.id);
        results[c.id] = count || 0;
      }));
      setCounts(results);
    })();
  }, [catalogs]);

  const openNew = () => {
    setIsNew(true);
    setEditing({ id: '', business_activity_type_id: activities[0]?.id || '', name: '', description: '', is_active: true });
  };
  const openEdit = (c: Catalog) => { setIsNew(false); setEditing({ ...c }); };

  const save = async () => {
    if (!editing) return;
    try {
      if (!editing.name.trim() || !editing.business_activity_type_id) { toastError('Nom et type d\'activité requis'); return; }
      if (isNew) {
        const { error } = await supabase.from('master_catalogs').insert({
          business_activity_type_id: editing.business_activity_type_id,
          name: editing.name.trim(), description: editing.description, is_active: editing.is_active,
        });
        if (error) throw error;
        success('Catalogue créé');
      } else {
        const { error } = await supabase.from('master_catalogs').update({
          name: editing.name.trim(), description: editing.description, is_active: editing.is_active,
        }).eq('id', editing.id);
        if (error) throw error;
        success('Catalogue mis à jour');
      }
      setEditing(null);
      onChange();
    } catch (e: any) { toastError(e.message); }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-500">{catalogs.length} catalogue{catalogs.length > 1 ? 's' : ''}</div>
        <button onClick={openNew} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-brand-600 to-brand-700 text-white shadow-glow hover:shadow-lg transition active:scale-95">
          <Plus className="w-3.5 h-3.5" /> Nouveau catalogue
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
        {catalogs.map(c => {
          const activity = activities.find(a => a.id === c.business_activity_type_id);
          const isSel = selectedId === c.id;
          return (
            <button key={c.id} onClick={() => onSelect(c.id)} className={`card-premium p-3 text-left transition ${isSel ? 'ring-2 ring-brand-500 border-brand-400' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-slate-900 truncate">{c.name}</div>
                  <div className="text-[10px] font-semibold text-brand-700 mt-0.5 truncate">{activity?.name || '—'}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{counts[c.id] !== undefined ? `${counts[c.id]} article${counts[c.id] > 1 ? 's' : ''}` : '...'}</div>
                  {c.description && <div className="text-[11px] text-slate-600 mt-1 break-words line-clamp-2">{c.description}</div>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full ${c.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{c.is_active ? 'Actif' : 'Inactif'}</span>
                  <span onClick={(e) => { e.stopPropagation(); openEdit(c); }} className="p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"><Pencil className="w-3.5 h-3.5 text-slate-600" /></span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={isNew ? 'Nouveau catalogue' : 'Modifier le catalogue'} size="sm"
        footer={<>
          <button onClick={() => setEditing(null)} className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100">Annuler</button>
          <button onClick={save} className="px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-brand-600 to-brand-700 text-white shadow-glow inline-flex items-center gap-1.5"><Save className="w-3.5 h-3.5" />Enregistrer</button>
        </>}>
        {editing && (
          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Type d'activité</label>
              <select value={editing.business_activity_type_id} disabled={!isNew} onChange={e => setEditing({ ...editing, business_activity_type_id: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-50">
                {activities.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Nom</label>
              <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Description</label>
              <textarea value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} rows={2} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20" />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={editing.is_active} onChange={e => setEditing({ ...editing, is_active: e.target.checked })} />
              Actif
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ============== CATEGORIES ============== */
function CategoriesTab({ catalogs, categories, selectedCatalogId, onSelectCatalog, onChange }: { catalogs: Catalog[]; categories: Category[]; selectedCatalogId: string; onSelectCatalog: (id: string) => void; onChange: () => void }) {
  const { success, error: toastError } = useToast();
  const [editing, setEditing] = useState<Category | null>(null);
  const [isNew, setIsNew] = useState(false);

  const catalogCats = categories.filter(c => c.master_catalog_id === selectedCatalogId);
  const rootCats = catalogCats.filter(c => !c.parent_id);

  const openNewRoot = () => { setIsNew(true); setEditing({ id: '', master_catalog_id: selectedCatalogId, name: '', slug: '', parent_id: null, sort_order: 0, is_active: true }); };
  const openNewChild = (parentId: string) => { setIsNew(true); setEditing({ id: '', master_catalog_id: selectedCatalogId, name: '', slug: '', parent_id: parentId, sort_order: 0, is_active: true }); };
  const openEdit = (c: Category) => { setIsNew(false); setEditing({ ...c }); };

  const save = async () => {
    if (!editing) return;
    try {
      if (!editing.name.trim()) { toastError('Nom requis'); return; }
      const slug = editing.slug.trim() || editing.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
      if (isNew) {
        const { error } = await supabase.from('master_catalog_categories').insert({
          master_catalog_id: editing.master_catalog_id, name: editing.name.trim(), slug,
          parent_id: editing.parent_id, sort_order: editing.sort_order, is_active: editing.is_active,
        });
        if (error) throw error;
        success('Catégorie créée');
      } else {
        const { error } = await supabase.from('master_catalog_categories').update({
          name: editing.name.trim(), sort_order: editing.sort_order, is_active: editing.is_active,
        }).eq('id', editing.id);
        if (error) throw error;
        success('Catégorie mise à jour');
      }
      setEditing(null);
      onChange();
    } catch (e: any) { toastError(e.message); }
  };

  if (!selectedCatalogId) return <div className="text-center py-12 text-sm text-slate-500">Sélectionnez d'abord un catalogue.</div>;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <select value={selectedCatalogId} onChange={e => onSelectCatalog(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20">
            {catalogs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <button onClick={openNewRoot} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-brand-600 to-brand-700 text-white shadow-glow">
          <Plus className="w-3.5 h-3.5" /> Catégorie racine
        </button>
      </div>

      <div className="space-y-1">
        {rootCats.map(cat => {
          const subs = catalogCats.filter(c => c.parent_id === cat.id);
          return (
            <div key={cat.id} className="card-premium p-3">
              <div className="flex items-center gap-2">
                <Folder className="w-4 h-4 text-brand-700 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-slate-900 truncate">{cat.name}</div>
                  <div className="text-[10px] font-mono text-slate-500">{cat.slug}</div>
                </div>
                <button onClick={() => openNewChild(cat.id)} className="p-1.5 rounded-lg hover:bg-slate-100" title="Ajouter une sous-catégorie"><Plus className="w-3.5 h-3.5 text-slate-600" /></button>
                <button onClick={() => openEdit(cat)} className="p-1.5 rounded-lg hover:bg-slate-100"><Pencil className="w-3.5 h-3.5 text-slate-600" /></button>
              </div>
              {subs.length > 0 && (
                <div className="mt-2 ml-6 space-y-1">
                  {subs.map(sub => (
                    <div key={sub.id} className="flex items-center gap-2 p-2 rounded-lg bg-slate-50">
                      <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-slate-800 truncate">{sub.name}</div>
                      </div>
                      <button onClick={() => openEdit(sub)} className="p-1 rounded-lg hover:bg-white"><Pencil className="w-3 h-3 text-slate-600" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {rootCats.length === 0 && (
          <div className="card-premium p-6 text-center text-sm text-slate-500">Aucune catégorie dans ce catalogue.</div>
        )}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={isNew ? (editing?.parent_id ? 'Nouvelle sous-catégorie' : 'Nouvelle catégorie') : 'Modifier la catégorie'} size="sm"
        footer={<>
          <button onClick={() => setEditing(null)} className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100">Annuler</button>
          <button onClick={save} className="px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-brand-600 to-brand-700 text-white shadow-glow inline-flex items-center gap-1.5"><Save className="w-3.5 h-3.5" />Enregistrer</button>
        </>}>
        {editing && (
          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Nom</label>
              <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value, slug: isNew ? e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-') : editing.slug })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Ordre d'affichage</label>
              <input type="number" value={editing.sort_order} onChange={e => setEditing({ ...editing, sort_order: Number(e.target.value) })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20 num" />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={editing.is_active} onChange={e => setEditing({ ...editing, is_active: e.target.checked })} />
              Actif
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ============== ITEMS ============== */
const PAGE_SIZE = 50;

function ItemsTab({ catalogs, categories, selectedCatalogId, onSelectCatalog, onChange }: { catalogs: Catalog[]; categories: Category[]; selectedCatalogId: string; onSelectCatalog: (id: string) => void; onChange: () => void }) {
  const { success, error: toastError } = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [loadingItems, setLoadingItems] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteAllOpen, setBulkDeleteAllOpen] = useState(false);

  const catalogCats = categories.filter(c => c.master_catalog_id === selectedCatalogId);
  const rootCats = catalogCats.filter(c => !c.parent_id);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { setSearchDebounced(search); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Load items with server-side pagination
  const loadPage = async () => {
    if (!selectedCatalogId) return;
    setLoadingItems(true);
    const from = page * PAGE_SIZE;
    let query = supabase
      .from('master_catalog_items')
      .select('*', { count: 'exact' })
      .eq('master_catalog_id', selectedCatalogId)
      .order('designation')
      .range(from, from + PAGE_SIZE - 1);
    if (searchDebounced.trim()) {
      query = query.or(`designation.ilike.%${searchDebounced.trim()}%,brand.ilike.%${searchDebounced.trim()}%,manufacturer_ref.ilike.%${searchDebounced.trim()}%`);
    }
    const { data, count } = await query;
    setItems((data || []) as Item[]);
    setTotalCount(count || 0);
    setLoadingItems(false);
  };

  useEffect(() => { loadPage(); setSelected(new Set()); }, [selectedCatalogId, page, searchDebounced]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const openNew = () => {
    setIsNew(true);
    setEditing({
      id: '', master_catalog_id: selectedCatalogId, category_id: null, subcategory_id: null,
      manufacturer_ref: '', designation: '', brand: '', model: '', unit: 'pièce',
      purchase_price: 0, sale_price: 0, vat_rate: 0, barcode: '', description: '', image_url: '', is_active: true,
    });
  };
  const openEdit = (i: Item) => { setIsNew(false); setEditing({ ...i }); };

  const save = async () => {
    if (!editing) return;
    try {
      if (!editing.designation.trim()) { toastError('Désignation requise'); return; }
      const payload = {
        master_catalog_id: editing.master_catalog_id,
        category_id: editing.category_id, subcategory_id: editing.subcategory_id,
        manufacturer_ref: editing.manufacturer_ref.trim(),
        designation: editing.designation.trim(), brand: editing.brand.trim(),
        model: editing.model.trim(), unit: editing.unit.trim() || 'pièce',
        purchase_price: Number(editing.purchase_price) || 0,
        sale_price: Number(editing.sale_price) || 0,
        vat_rate: Number(editing.vat_rate) || 0,
        barcode: editing.barcode.trim(), description: editing.description,
        image_url: editing.image_url.trim(), is_active: editing.is_active,
      };
      if (isNew) {
        const { error } = await supabase.from('master_catalog_items').insert(payload);
        if (error) throw error;
        success('Article créé');
      } else {
        const { error } = await supabase.from('master_catalog_items').update(payload).eq('id', editing.id);
        if (error) throw error;
        success('Article mis à jour');
      }
      setEditing(null);
      loadPage();
    } catch (e: any) { toastError(e.message); }
  };

  const doDelete = async () => {
    if (!deleteId) return;
    try {
      const { error } = await supabase.from('master_catalog_items').delete().eq('id', deleteId);
      if (error) throw error;
      success('Article supprimé');
      setDeleteId(null);
      loadPage();
    } catch (e: any) { toastError(e.message); }
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map(i => i.id)));
    }
  };

  const doBulkDelete = async () => {
    if (selected.size === 0) return;
    setBulkDeleting(true);
    try {
      const ids = Array.from(selected);
      const batchSize = 100;
      for (let i = 0; i < ids.length; i += batchSize) {
        const batch = ids.slice(i, i + batchSize);
        const { error } = await supabase.from('master_catalog_items').delete().in('id', batch);
        if (error) throw error;
      }
      success(`${ids.length} article${ids.length > 1 ? 's' : ''} supprimé${ids.length > 1 ? 's' : ''}`);
      setSelected(new Set());
      setBulkDeleteOpen(false);
      loadPage();
    } catch (e: any) { toastError(e.message); } finally { setBulkDeleting(false); }
  };

  const doBulkDeleteAll = async () => {
    if (!selectedCatalogId) return;
    setBulkDeleting(true);
    try {
      const { error } = await supabase.from('master_catalog_items').delete().eq('master_catalog_id', selectedCatalogId);
      if (error) throw error;
      success(`Tous les articles du catalogue ont été supprimés`);
      setSelected(new Set());
      setBulkDeleteAllOpen(false);
      loadPage();
      onChange();
    } catch (e: any) { toastError(e.message); } finally { setBulkDeleting(false); }
  };

  if (!selectedCatalogId) return <div className="text-center py-12 text-sm text-slate-500">Sélectionnez d'abord un catalogue.</div>;

  const subcatsFor = (catId: string | null) => catId ? catalogCats.filter(c => c.parent_id === catId) : [];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <select value={selectedCatalogId} onChange={e => { onSelectCatalog(e.target.value); setPage(0); }} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20">
            {catalogs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher…" className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20" />
        </div>
        <button onClick={openNew} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-brand-600 to-brand-700 text-white shadow-glow">
          <Plus className="w-3.5 h-3.5" /> Nouvel article
        </button>
      </div>

      {/* Bulk actions bar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
            <input type="checkbox" checked={items.length > 0 && selected.size === items.length} onChange={toggleSelectAll} className="rounded" />
            Tout sélectionner ({selected.size}/{items.length})
          </label>
          <span className="text-xs font-bold text-slate-500">{totalCount} article{totalCount > 1 ? 's' : ''} au total</span>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <button onClick={() => setBulkDeleteOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition">
              <Trash2 className="w-3.5 h-3.5" /> Supprimer ({selected.size})
            </button>
          )}
          {totalCount > 0 && (
            <button onClick={() => setBulkDeleteAllOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-red-600 text-white hover:bg-red-700 transition">
              <Trash2 className="w-3.5 h-3.5" /> Vider le catalogue
            </button>
          )}
        </div>
      </div>

      {loadingItems ? (
        <div className="py-12 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-brand-600" /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {items.map(i => {
              const isSel = selected.has(i.id);
              return (
                <div key={i.id} className={`card-premium p-3 transition ${isSel ? 'ring-2 ring-red-300 bg-red-50/30' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      <input type="checkbox" checked={isSel} onChange={() => toggleSelect(i.id)} className="mt-1 rounded shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-slate-900 break-words">{i.designation}</div>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          {i.brand && <span className="text-[10px] font-semibold text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded">{i.brand}</span>}
                          {i.manufacturer_ref && <span className="text-[10px] font-mono text-slate-500">{i.manufacturer_ref}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => openEdit(i)} className="p-1.5 rounded-lg hover:bg-slate-100"><Pencil className="w-3.5 h-3.5 text-slate-600" /></button>
                      <button onClick={() => setDeleteId(i.id)} className="p-1.5 rounded-lg hover:bg-red-50"><Trash2 className="w-3.5 h-3.5 text-red-600" /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 pt-1.5 mt-1.5 border-t border-slate-100">
                    <div><div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Achat</div><div className="text-[11px] font-bold text-slate-800 num mt-0.5">{formatFCFA(i.purchase_price)}</div></div>
                    <div><div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Vente</div><div className="text-[11px] font-bold text-brand-700 num mt-0.5">{formatFCFA(i.sale_price)}</div></div>
                    <div><div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">TVA</div><div className="text-[11px] font-semibold text-slate-600 num mt-0.5">{i.vat_rate}%</div></div>
                  </div>
                </div>
              );
            })}
            {items.length === 0 && <div className="col-span-full card-premium p-6 text-center text-sm text-slate-500">Aucun article.</div>}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1 pt-2">
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 disabled:opacity-40 hover:bg-slate-50 transition">Préc.</button>
              <span className="px-3 py-1.5 text-xs font-bold text-slate-700">Page {page + 1} / {totalPages}</span>
              <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 disabled:opacity-40 hover:bg-slate-50 transition">Suiv.</button>
            </div>
          )}
        </>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={isNew ? 'Nouvel article' : 'Modifier l\'article'} size="md"
        footer={<>
          <button onClick={() => setEditing(null)} className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100">Annuler</button>
          <button onClick={save} className="px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-brand-600 to-brand-700 text-white shadow-glow inline-flex items-center gap-1.5"><Save className="w-3.5 h-3.5" />Enregistrer</button>
        </>}>
        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div><label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Désignation *</label><input value={editing.designation} onChange={e => setEditing({ ...editing, designation: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm" /></div>
              <div><label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Marque</label><input value={editing.brand} onChange={e => setEditing({ ...editing, brand: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm" /></div>
              <div><label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Réf. constructeur</label><input value={editing.manufacturer_ref} onChange={e => setEditing({ ...editing, manufacturer_ref: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono" /></div>
              <div><label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Modèle</label><input value={editing.model} onChange={e => setEditing({ ...editing, model: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm" /></div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Catégorie</label>
                <select value={editing.category_id || ''} onChange={e => setEditing({ ...editing, category_id: e.target.value || null, subcategory_id: null })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm">
                  <option value="">—</option>
                  {rootCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Sous-catégorie</label>
                <select value={editing.subcategory_id || ''} onChange={e => setEditing({ ...editing, subcategory_id: e.target.value || null })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm">
                  <option value="">—</option>
                  {subcatsFor(editing.category_id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div><label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Unité</label><input value={editing.unit} onChange={e => setEditing({ ...editing, unit: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm" /></div>
              <div><label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Code-barres</label><input value={editing.barcode} onChange={e => setEditing({ ...editing, barcode: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono" /></div>
              <div><label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Prix achat</label><input type="number" value={editing.purchase_price} onChange={e => setEditing({ ...editing, purchase_price: Number(e.target.value) })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm num" /></div>
              <div><label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Prix vente</label><input type="number" value={editing.sale_price} onChange={e => setEditing({ ...editing, sale_price: Number(e.target.value) })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm num" /></div>
              <div><label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">TVA (%)</label><input type="number" value={editing.vat_rate} onChange={e => setEditing({ ...editing, vat_rate: Number(e.target.value) })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm num" /></div>
              <div><label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Image URL</label><input value={editing.image_url} onChange={e => setEditing({ ...editing, image_url: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm" /></div>
            </div>
            <div><label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Description</label><textarea value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} rows={2} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm" /></div>
            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={editing.is_active} onChange={e => setEditing({ ...editing, is_active: e.target.checked })} />Actif</label>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={doDelete} title="Supprimer cet article ?" message="Cette action est irréversible." confirmLabel="Supprimer" />
      <ConfirmDialog open={bulkDeleteOpen} onClose={() => setBulkDeleteOpen(false)} onConfirm={doBulkDelete} title={`Supprimer ${selected.size} article${selected.size > 1 ? 's' : ''} ?`} message="Cette action est irréversible. Les tenants qui les ont déjà importés conservent leur copie." confirmLabel={bulkDeleting ? 'Suppression…' : 'Supprimer'} />
      <ConfirmDialog open={bulkDeleteAllOpen} onClose={() => setBulkDeleteAllOpen(false)} onConfirm={doBulkDeleteAll} title="Vider tout le catalogue ?" message={`Tous les ${totalCount} articles de ce catalogue seront supprimés définitivement. Les tenants qui les ont déjà importés conservent leur copie.`} confirmLabel={bulkDeleting ? 'Suppression…' : 'Tout supprimer'} />
    </div>
  );
}

/* ============== IMPORT EXCEL ============== */
const IMPORT_HEADERS = [
  { key: 'designation', label: 'Désignation *', required: true },
  { key: 'marque', label: 'Marque', required: false },
  { key: 'reference', label: 'Référence constructeur', required: false },
  { key: 'categorie', label: 'Catégorie', required: false },
  { key: 'sous_categorie', label: 'Sous-catégorie', required: false },
  { key: 'modele', label: 'Modèle', required: false },
  { key: 'unite', label: 'Unité', required: false },
  { key: 'prix_achat', label: 'Prix achat', required: false },
  { key: 'prix_vente', label: 'Prix vente', required: false },
  { key: 'taux_tva', label: 'TVA (%)', required: false },
  { key: 'code_barres', label: 'Code-barres', required: false },
  { key: 'description', label: 'Description', required: false },
  { key: 'image_url', label: 'Image URL', required: false },
];

async function parseExcel(buf: ArrayBuffer): Promise<any[]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '', raw: false });

  // Build label-to-key mapping from IMPORT_HEADERS
  const labelToKey = new Map<string, string>();
  IMPORT_HEADERS.forEach(h => {
    labelToKey.set(normalizeHeader(h.label), h.key);
  });

  return raw.map(r => {
    const row: any = {};
    for (const k of Object.keys(r)) {
      const norm = normalizeHeader(k);
      const key = labelToKey.get(norm) || norm;
      row[key] = String(r[k] ?? '').trim();
    }
    return row;
  });
}

function normalizeHeader(s: string): string {
  return s.trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+$/, '')
    .replace(/^_+/, '');
}

function ImportTab({ catalogs, selectedCatalogId, onSelectCatalog, onChange }: { catalogs: Catalog[]; selectedCatalogId: string; onSelectCatalog: (id: string) => void; onChange: () => void }) {
  const { success, error: toastError } = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [filename, setFilename] = useState('');
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number; elapsed: number; lotsDone: number; lotsTotal: number } | null>(null);
  const [result, setResult] = useState<{ imported: number; updated: number; errors: any[]; total: number } | null>(null);

  const CHUNK_SIZE = 1000;

  const downloadTemplate = async () => {
    const XLSX = await import('xlsx');
    const headerRow = IMPORT_HEADERS.map(h => h.label);
    const sampleRow = ['Plaquette de frein avant', 'Bosch', '0986AB1234', 'Freinage', 'Plaquettes', '', 'pièce', '15000', '25000', '18', '', 'Plaquette haute performance', ''];
    const ws = XLSX.utils.aoa_to_sheet([headerRow, sampleRow]);
    ws['!cols'] = headerRow.map(h => ({ wch: Math.max(16, h.length + 4) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Catalogue');

    const catName = catalogs.find(c => c.id === selectedCatalogId)?.name || 'catalogue';
    XLSX.writeFile(wb, `modele-import-${catName.toLowerCase().replace(/\s+/g, '-')}.xlsx`);
  };

  const exportCatalog = async () => {
    if (!selectedCatalogId) { toastError('Sélectionnez un catalogue'); return; }
    const XLSX = await import('xlsx');
    const { data, error } = await supabase.rpc('export_master_catalog_by_id', { p_catalog_id: selectedCatalogId });
    if (error) { toastError(error.message); return; }
    const rows = (data || []) as any[];
    if (rows.length === 0) { toastError('Catalogue vide'); return; }

    const headerRow = IMPORT_HEADERS.map(h => h.label);
    const dataRows = rows.map((r: any) => [
      r.designation || '', r.marque || '', r.reference || '',
      r.categorie || '', r.sous_categorie || '',
      r.modele || '', r.unite || '',
      r.prix_achat || 0, r.prix_vente || 0, r.taux_tva || 0,
      r.code_barres || '', r.description || '', r.image_url || '',
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
    ws['!cols'] = headerRow.map(h => ({ wch: Math.max(16, h.length + 4) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Catalogue');

    const catName = catalogs.find(c => c.id === selectedCatalogId)?.name || 'catalogue';
    XLSX.writeFile(wb, `export-${catName.toLowerCase().replace(/\s+/g, '-')}.xlsx`);
    success(`${rows.length} articles exportés`);
  };

  const handleFile = async (f: File) => {
    setFilename(f.name);
    const buf = await f.arrayBuffer();
    const parsed = await parseExcel(buf);
    if (parsed.length === 0) { toastError('Fichier vide ou invalide'); return; }
    setRows(parsed);
    setResult(null);
  };

  const runImport = async () => {
    if (rows.length === 0 || !selectedCatalogId) return;
    setImporting(true);
    const startTime = Date.now();
    const lotsTotal = Math.ceil(rows.length / CHUNK_SIZE);
    setImportProgress({ done: 0, total: rows.length, elapsed: 0, lotsDone: 0, lotsTotal });
    const totalImported = { imported: 0, updated: 0, errors: [] as any[] };
    try {
      for (let i = 0, lotsDone = 0; i < rows.length; i += CHUNK_SIZE, lotsDone++) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        const { data, error } = await supabase.rpc('import_to_master_catalog', {
          p_catalog_id: selectedCatalogId,
          p_rows: chunk,
        });
        if (error) throw error;
        const r = data as any;
        totalImported.imported += r.imported || 0;
        totalImported.updated += r.updated || 0;
        if (r.errors?.length) totalImported.errors.push(...r.errors);
        setImportProgress({
          done: Math.min(i + CHUNK_SIZE, rows.length),
          total: rows.length,
          elapsed: Math.round((Date.now() - startTime) / 1000),
          lotsDone: lotsDone + 1,
          lotsTotal,
        });
      }
      setResult({ ...totalImported, total: rows.length });
      onChange();
      success(`Import terminé — ${totalImported.imported} créés, ${totalImported.updated} mis à jour`);
    } catch (e: any) {
      toastError(e.message);
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* Catalog selector */}
      <div className="card-premium p-4">
        <div className="flex items-center gap-3">
          <Folder className="w-5 h-5 text-brand-700 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-slate-900 mb-1">Catalogue cible</div>
            <select value={selectedCatalogId} onChange={e => onSelectCatalog(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20">
              {catalogs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Template + Export */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="card-premium p-4">
          <div className="flex items-start gap-3">
            <Download className="w-5 h-5 text-sky-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-bold text-slate-900">Modele Excel</div>
              <div className="text-[11px] text-slate-500 mt-0.5 mb-2">Fichier avec les colonnes attendues et un exemple. Les champs marques * sont obligatoires.</div>
              <button onClick={downloadTemplate} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white border border-slate-200 hover:border-sky-300 text-slate-800 transition active:scale-95">
                <Download className="w-3.5 h-3.5" /> Telecharger le modele
              </button>
            </div>
          </div>
        </div>

        <div className="card-premium p-4">
          <div className="flex items-start gap-3">
            <Upload className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-bold text-slate-900">Exporter le catalogue</div>
              <div className="text-[11px] text-slate-500 mt-0.5 mb-2">Exporte tous les articles du catalogue sélectionné au même format que le modèle (ré-importable).</div>
              <button onClick={exportCatalog} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white transition active:scale-95">
                <Download className="w-3.5 h-3.5" /> Exporter
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Column reference */}
      <div className="card-premium p-4">
        <div className="text-xs font-bold text-slate-900 mb-2">Colonnes attendues</div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-1.5">
          {IMPORT_HEADERS.map(h => (
            <div key={h.key} className={`text-[11px] px-2 py-1.5 rounded-lg ${h.required ? 'bg-brand-50 border border-brand-200 font-bold text-brand-800' : 'bg-slate-50 border border-slate-100 text-slate-600'}`}>
              {h.label}
            </div>
          ))}
        </div>
        <div className="text-[10px] text-slate-400 mt-2">Les colonnes marquees * sont obligatoires. Les autres sont optionnelles.</div>
      </div>

      {/* File upload */}
      <div className="card-premium p-4">
        <div className="text-sm font-bold text-slate-900 mb-2">Importer un fichier</div>
        <label className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-slate-300 rounded-2xl cursor-pointer hover:border-brand-400 hover:bg-brand-50/30 transition">
          <Upload className="w-6 h-6 text-slate-400" />
          <div className="text-xs text-slate-600 text-center">Cliquez ou glissez un fichier Excel (.xlsx, .xls)</div>
          {filename && <div className="text-[11px] font-semibold text-brand-700">{filename} — {rows.length} ligne{rows.length > 1 ? 's' : ''} detectees</div>}
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
        </label>

        {rows.length > 0 && (
          <>
            {rows.length > CHUNK_SIZE && (
              <div className="mt-3 flex items-start gap-2 p-3 rounded-xl bg-sky-50 border border-sky-200">
                <AlertCircle className="w-4 h-4 text-sky-600 mt-0.5 shrink-0" />
                <div className="text-[11px] text-sky-800">
                  <span className="font-bold">{rows.length} articles détectés.</span> Import en{' '}
                  <span className="font-bold">{Math.ceil(rows.length / CHUNK_SIZE)} lot{Math.ceil(rows.length / CHUNK_SIZE) > 1 ? 's' : ''} de {CHUNK_SIZE}</span> — traitement ensembliste optimisé, pas de timeout attendu.
                </div>
              </div>
            )}

            {/* Progress bar */}
            {importProgress && (
              <div className="mt-3 space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700">
                  <span>Lot <span className="num">{importProgress.lotsDone}</span> / <span className="num">{importProgress.lotsTotal}</span></span>
                  <span className="num text-slate-500">{importProgress.done.toLocaleString()} / {importProgress.total.toLocaleString()} articles • {importProgress.elapsed}s</span>
                </div>
                <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-brand-500 via-brand-500 to-emerald-500 rounded-full transition-all duration-500"
                    style={{ width: `${Math.round((importProgress.done / importProgress.total) * 100)}%` }}
                  />
                </div>
                <div className="text-[10px] text-slate-400 text-center font-semibold">
                  {Math.round((importProgress.done / importProgress.total) * 100)}% — Ne fermez pas cette page…
                </div>
              </div>
            )}

            <div className="mt-3 flex items-center justify-between">
              <button onClick={() => { setRows([]); setFilename(''); setResult(null); }} disabled={importing} className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50">Annuler</button>
              <button onClick={runImport} disabled={importing || !selectedCatalogId} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-brand-600 to-brand-700 text-white shadow-glow disabled:opacity-50">
                {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                {importing
                  ? `Lot ${importProgress?.lotsDone ?? 0} / ${importProgress?.lotsTotal ?? Math.ceil(rows.length / CHUNK_SIZE)}…`
                  : `Importer ${rows.length.toLocaleString()} article${rows.length > 1 ? 's' : ''}${rows.length > CHUNK_SIZE ? ` (${Math.ceil(rows.length / CHUNK_SIZE)} lots)` : ''}`
                }
              </button>
            </div>
          </>
        )}
      </div>

      {/* Results */}
      {result && (
        <div className="card-premium p-4 space-y-2">
          <div className="text-sm font-bold text-slate-900">Rapport d'import</div>
          <div className="grid grid-cols-3 gap-2">
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100"><div className="text-[10px] font-bold uppercase text-emerald-700">Créés</div><div className="text-2xl font-bold text-emerald-800 num mt-1">{result.imported}</div></div>
            <div className="p-3 rounded-xl bg-sky-50 border border-sky-100"><div className="text-[10px] font-bold uppercase text-sky-700">Mis à jour</div><div className="text-2xl font-bold text-sky-800 num mt-1">{result.updated}</div></div>
            <div className="p-3 rounded-xl bg-red-50 border border-red-100"><div className="text-[10px] font-bold uppercase text-red-700">Erreurs</div><div className="text-2xl font-bold text-red-800 num mt-1">{result.errors?.length || 0}</div></div>
          </div>
          {result.errors && result.errors.length > 0 && (
            <div className="max-h-40 overflow-auto bg-slate-50 rounded-xl p-2 space-y-1">
              {result.errors.map((e: any, i: number) => (
                <div key={i} className="text-[11px] text-red-700 break-words">Ligne {e.row}: {e.error}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
