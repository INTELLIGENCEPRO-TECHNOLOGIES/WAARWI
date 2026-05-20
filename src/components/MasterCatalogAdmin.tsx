import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Pencil, Trash2, Loader2, Search, X, Download, Upload, FileText,
  Package, Tag, ChevronRight, Check, AlertCircle, Power, PowerOff, Save, Folder
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
  const { success, error: toastError } = useToast();
  const [tab, setTab] = useState<Tab>('catalogs');

  const [activities, setActivities] = useState<ActivityType[]>([]);
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedCatalogId, setSelectedCatalogId] = useState<string>('');

  const reload = async () => {
    setLoading(true);
    const [a, c, cats, its] = await Promise.all([
      supabase.from('business_activity_types').select('*').order('name'),
      supabase.from('master_catalogs').select('*').order('name'),
      supabase.from('master_catalog_categories').select('*').order('sort_order'),
      supabase.from('master_catalog_items').select('*').order('designation'),
    ]);
    setActivities((a.data || []) as ActivityType[]);
    setCatalogs((c.data || []) as Catalog[]);
    setCategories((cats.data || []) as Category[]);
    setItems((its.data || []) as Item[]);
    if (!selectedCatalogId && c.data && c.data.length > 0) setSelectedCatalogId(c.data[0].id);
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
          {tab === 'items' && <ItemsTab catalogs={catalogs} categories={categories} items={items} selectedCatalogId={selectedCatalogId} onSelectCatalog={setSelectedCatalogId} onChange={reload} />}
          {tab === 'import' && <ImportTab onChange={reload} />}
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
function ItemsTab({ catalogs, categories, items, selectedCatalogId, onSelectCatalog, onChange }: { catalogs: Catalog[]; categories: Category[]; items: Item[]; selectedCatalogId: string; onSelectCatalog: (id: string) => void; onChange: () => void }) {
  const { success, error: toastError } = useToast();
  const [editing, setEditing] = useState<Item | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [search, setSearch] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const catalogItems = items.filter(i => i.master_catalog_id === selectedCatalogId);
  const catalogCats = categories.filter(c => c.master_catalog_id === selectedCatalogId);
  const rootCats = catalogCats.filter(c => !c.parent_id);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return catalogItems;
    return catalogItems.filter(i => `${i.designation} ${i.brand} ${i.manufacturer_ref} ${i.model}`.toLowerCase().includes(q));
  }, [catalogItems, search]);

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
      onChange();
    } catch (e: any) { toastError(e.message); }
  };

  const doDelete = async () => {
    if (!deleteId) return;
    try {
      const { error } = await supabase.from('master_catalog_items').delete().eq('id', deleteId);
      if (error) throw error;
      success('Article supprimé');
      setDeleteId(null);
      onChange();
    } catch (e: any) { toastError(e.message); }
  };

  if (!selectedCatalogId) return <div className="text-center py-12 text-sm text-slate-500">Sélectionnez d'abord un catalogue.</div>;

  const subcatsFor = (catId: string | null) => catId ? catalogCats.filter(c => c.parent_id === catId) : [];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <select value={selectedCatalogId} onChange={e => onSelectCatalog(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20">
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

      <div className="text-xs font-bold uppercase tracking-wider text-slate-500">{filtered.length} / {catalogItems.length} article{catalogItems.length > 1 ? 's' : ''}</div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
        {filtered.map(i => (
          <div key={i.id} className="card-premium p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-slate-900 break-words">{i.designation}</div>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {i.brand && <span className="text-[10px] font-semibold text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded">{i.brand}</span>}
                  {i.manufacturer_ref && <span className="text-[10px] font-mono text-slate-500">{i.manufacturer_ref}</span>}
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
        ))}
        {filtered.length === 0 && <div className="col-span-full card-premium p-6 text-center text-sm text-slate-500">Aucun article.</div>}
      </div>

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

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={doDelete} title="Supprimer cet article ?" message="Cette action est irréversible. Les tenants qui l'ont déjà importé conservent leur copie." confirmLabel="Supprimer" />
    </div>
  );
}

/* ============== IMPORT EXCEL ============== */
const EXCEL_HEADERS = [
  'type_activite','catalogue','categorie','sous_categorie','marque','reference_constructeur',
  'designation','modele','unite','prix_achat','prix_vente','taux_tva',
  'code_barres','description','image_url','source_url','source_nom','niveau_fiabilite'
];

async function parseExcel(buf: ArrayBuffer): Promise<any[]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '', raw: false });
  return raw.map(r => {
    const row: any = {};
    for (const k of Object.keys(r)) {
      row[k.trim().toLowerCase()] = String(r[k] ?? '').trim();
    }
    return row;
  });
}

function ImportTab({ onChange }: { onChange: () => void }) {
  const { success, error: toastError } = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [filename, setFilename] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; updated: number; errors: any[]; total: number } | null>(null);

  const downloadTemplate = async () => {
    const XLSX = await import('xlsx');
    const sample = [{
      type_activite: 'electromenager',
      catalogue: 'Catalogue Électroménager',
      categorie: 'Gros électroménager',
      sous_categorie: 'Réfrigérateurs',
      marque: 'Samsung',
      reference_constructeur: 'RT29K5030S8',
      designation: 'Réfrigérateur 2 portes 300L',
      modele: 'RT29K5030S8/EF',
      unite: 'pièce',
      prix_achat: 250000,
      prix_vente: 310000,
      taux_tva: 18,
      code_barres: '8806088123456',
      description: 'Réfrigérateur No Frost 300L',
      image_url: '',
      source_url: '',
      source_nom: 'Samsung Sénégal',
      niveau_fiabilite: 'fiable',
    }];
    const ws = XLSX.utils.json_to_sheet(sample, { header: EXCEL_HEADERS });
    ws['!cols'] = EXCEL_HEADERS.map(h => ({ wch: Math.max(14, h.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Catalogue');
    XLSX.writeFile(wb, 'modele-catalogue-maitre.xlsx');
  };

  const exportCurrent = async () => {
    const XLSX = await import('xlsx');
    const { data, error } = await supabase.rpc('export_master_catalog_items');
    const rowsToExport: any[] = error || !data
      ? []
      : (data as any[]).map(r => ({
          type_activite: r.activity_slug || '',
          catalogue: r.catalog_name || '',
          categorie: r.category_name || '',
          sous_categorie: r.subcategory_name || '',
          marque: r.brand || '',
          reference_constructeur: r.manufacturer_ref || '',
          designation: r.designation || '',
          modele: r.model || '',
          unite: r.unit || '',
          prix_achat: Number(r.purchase_price || 0),
          prix_vente: Number(r.sale_price || 0),
          taux_tva: Number(r.vat_rate || 0),
          code_barres: r.barcode || '',
          description: r.description || '',
          image_url: r.image_url || '',
          source_url: r.source_url || '',
          source_nom: r.source_name || '',
          niveau_fiabilite: r.reliability_level || '',
        }));
    const ws = XLSX.utils.json_to_sheet(rowsToExport, { header: EXCEL_HEADERS });
    ws['!cols'] = EXCEL_HEADERS.map(h => ({ wch: Math.max(14, h.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Catalogue');
    XLSX.writeFile(wb, 'export-catalogue-maitre.xlsx');
  };

  const handleFile = async (f: File) => {
    setFilename(f.name);
    const buf = await f.arrayBuffer();
    const parsed = await parseExcel(buf);
    if (parsed.length === 0) { toastError('Fichier vide ou invalide'); return; }
    const first = parsed[0];
    const missing = ['type_activite', 'designation'].filter(k => !(k in first));
    if (missing.length > 0) { toastError(`Colonnes manquantes : ${missing.join(', ')}`); return; }
    setRows(parsed);
    setResult(null);
  };

  const runImport = async () => {
    if (rows.length === 0) return;
    setImporting(true);
    try {
      const { data, error } = await supabase.rpc('bulk_upsert_master_catalog_items', { p_rows: rows });
      if (error) throw error;
      setResult(data as any);
      onChange();
      success('Import terminé');
    } catch (e: any) {
      toastError(e.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="card-premium p-4">
        <div className="flex items-start gap-3">
          <FileText className="w-5 h-5 text-brand-700 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-bold text-slate-900">Modèle Excel</div>
            <div className="text-xs text-slate-600 mt-0.5">Téléchargez un modèle vierge avec les bonnes colonnes et un exemple, ou exportez le catalogue actuel.</div>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button onClick={downloadTemplate} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white border border-slate-200 hover:border-brand-300 text-slate-800 transition active:scale-95">
              <Download className="w-3.5 h-3.5" /> Modèle Excel
            </button>
            <button onClick={exportCurrent} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white transition active:scale-95">
              <Download className="w-3.5 h-3.5" /> Exporter tout
            </button>
          </div>
        </div>
      </div>

      <div className="card-premium p-4">
        <div className="text-sm font-bold text-slate-900 mb-2">Fichier à importer</div>
        <label className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-slate-300 rounded-2xl cursor-pointer hover:border-brand-400 hover:bg-brand-50/30 transition">
          <Upload className="w-6 h-6 text-slate-400" />
          <div className="text-xs text-slate-600">Cliquez pour sélectionner un fichier Excel (.xlsx, .xls)</div>
          {filename && <div className="text-[11px] font-semibold text-brand-700">{filename} · {rows.length} ligne{rows.length > 1 ? 's' : ''}</div>}
          <input type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        </label>
        {rows.length > 0 && (
          <div className="mt-3 flex items-center justify-end gap-2">
            <button onClick={() => { setRows([]); setFilename(''); setResult(null); }} className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100">Annuler</button>
            <button onClick={runImport} disabled={importing} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-brand-600 to-brand-700 text-white shadow-glow disabled:opacity-50">
              {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              {importing ? 'Import…' : `Importer ${rows.length} ligne${rows.length > 1 ? 's' : ''}`}
            </button>
          </div>
        )}
      </div>

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
                <div key={i} className="text-[11px] text-slate-700 break-words">Ligne {e.row}: {e.error}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
