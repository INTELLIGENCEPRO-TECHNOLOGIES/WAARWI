import { useEffect, useState, type ReactNode } from 'react';
import {
  Plus, Pencil, Trash2, Loader2, Search, Download, Upload,
  ChevronLeft, ChevronRight, Check
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { PlatformConfirmation, PlatformWorkPage } from './PlatformWorkPage';
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

  const tabs: { key: Tab; label: string }[] = [
    { key: 'catalogs', label: 'Catalogues' },
    { key: 'activities', label: 'Types d’activités' },
    { key: 'categories', label: 'Catégories' },
    { key: 'items', label: 'Articles' },
    { key: 'import', label: 'Import Excel' },
  ];

  return (
    <div className="space-y-3">
      <nav className="pa-tabs" aria-label="Référentiels métiers">
        {tabs.map(item => (
          <button type="button" key={item.key} aria-current={tab === item.key ? 'page' : undefined} onClick={() => setTab(item.key)}>
            {item.label}
          </button>
        ))}
      </nav>

      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
      ) : (
        <>
          {tab === 'activities' && <ActivitiesTab activities={activities} onChange={reload} />}
          {tab === 'catalogs' && <CatalogsTab catalogs={catalogs} activities={activities} onChange={reload} onBrowse={id => { setSelectedCatalogId(id); setTab('items'); }} />}
          {tab === 'categories' && <CategoriesTab catalogs={catalogs} categories={categories} selectedCatalogId={selectedCatalogId} onSelectCatalog={setSelectedCatalogId} onChange={reload} />}
          {tab === 'items' && <ItemsTab catalogs={catalogs} categories={categories} selectedCatalogId={selectedCatalogId} onSelectCatalog={setSelectedCatalogId} onChange={reload} />}
          {tab === 'import' && <ImportTab catalogs={catalogs} selectedCatalogId={selectedCatalogId} onSelectCatalog={setSelectedCatalogId} onChange={reload} />}
        </>
      )}
    </div>
  );
}


function CatalogEditor({ title, backLabel, onBack, onSave, children }: {
  title: string; backLabel: string; onBack: () => void; onSave: () => Promise<void>; children: ReactNode;
}) {
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { await onSave(); }
    finally { setSaving(false); }
  };
  return (
    <PlatformWorkPage title={title} backLabel={backLabel} onBack={onBack} busy={saving}>
      <form className="pa-form" onSubmit={event => { event.preventDefault(); if (!saving) void save(); }}>
        {children}
        <div className="pa-form-actions">
          <button type="submit" className="pa-button" data-variant="primary" disabled={saving}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Enregistrer
          </button>
        </div>
      </form>
    </PlatformWorkPage>
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

  if (editing) {
    return (
      <CatalogEditor title={isNew ? 'Nouveau type d’activité' : 'Modifier le type d’activité'}
        backLabel="Retour aux types d’activité" onBack={() => setEditing(null)} onSave={save}>
        <div className="pa-form-grid">
          <label className="pa-field-label">Nom
            <input className="w-input-ul" required value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} />
          </label>
          <label className="pa-field-label">Identifiant
            <input className="w-input-ul" required readOnly={!isNew} value={editing.slug}
              onChange={event => setEditing({ ...editing, slug: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })} />
          </label>
          <label className="pa-field-label">Type de commerce historique
            <input className="w-input-ul" value={editing.legacy_business_type || ''}
              onChange={event => setEditing({ ...editing, legacy_business_type: event.target.value || null })} />
          </label>
          <label className="pa-inline">
            <input type="checkbox" checked={editing.is_active} onChange={event => setEditing({ ...editing, is_active: event.target.checked })} /> Actif
          </label>
        </div>
        <label className="pa-field-label">Description
          <textarea className="w-input-ul" rows={3} value={editing.description || ''} onChange={event => setEditing({ ...editing, description: event.target.value })} />
        </label>
      </CatalogEditor>
    );
  }

  return (
    <div className="pa-page">
      <div className="pa-section-head">
        <span className="pa-muted text-sm">{activities.length} type{activities.length !== 1 ? 's' : ''} d’activité</span>
        <button type="button" onClick={openNew} className="pa-button" data-variant="primary"><Plus size={16} /> Nouveau type</button>
      </div>
      {activities.length === 0 ? <p className="pa-empty">Aucun type d’activité.</p> : (
        <div className="pa-divided">
          {activities.map(item => (
            <div key={item.id} className="pa-setting-row">
              <div>
                <button type="button" className="pa-name-button" onClick={() => openEdit(item)}>{item.name}</button>
                <p className="pa-row-subtitle">{item.slug}{item.description ? ' · ' + item.description : ''}</p>
              </div>
              <div className="pa-inline">
                <span className="pa-muted">{item.is_active ? 'Actif' : 'Inactif'}</span>
                <button type="button" className="pa-icon-button" aria-label={'Modifier ' + item.name} onClick={() => openEdit(item)}><Pencil size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============== CATALOGS ============== */
function CatalogsTab({ catalogs, activities, onChange, onBrowse }: { catalogs: Catalog[]; activities: ActivityType[]; onChange: () => void; onBrowse: (id: string) => void }) {
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

  if (editing) {
    return (
      <CatalogEditor title={isNew ? 'Nouveau catalogue' : 'Modifier le catalogue'}
        backLabel="Retour aux catalogues" onBack={() => setEditing(null)} onSave={save}>
        <div className="pa-form-grid">
          <label className="pa-field-label">Nom
            <input className="w-input-ul" required value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} />
          </label>
          <label className="pa-field-label">Type d’activité
            <select className="w-input-ul" required disabled={!isNew} value={editing.business_activity_type_id}
              onChange={event => setEditing({ ...editing, business_activity_type_id: event.target.value })}>
              <option value="">Choisir un type d’activité</option>
              {activities.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        </div>
        <label className="pa-field-label">Description
          <textarea className="w-input-ul" rows={3} value={editing.description || ''} onChange={event => setEditing({ ...editing, description: event.target.value })} />
        </label>
        <label className="pa-inline">
          <input type="checkbox" checked={editing.is_active} onChange={event => setEditing({ ...editing, is_active: event.target.checked })} /> Actif
        </label>
      </CatalogEditor>
    );
  }

  return (
    <div className="pa-page">
      <div className="pa-section-head">
        <span className="pa-muted text-sm">{catalogs.length} catalogue{catalogs.length !== 1 ? 's' : ''}</span>
        <button type="button" onClick={openNew} className="pa-button" data-variant="primary"><Plus size={16} /> Nouveau catalogue</button>
      </div>
      {catalogs.length === 0 ? <p className="pa-empty">Aucun catalogue.</p> : (
        <div className="pa-divided">
          {catalogs.map(item => {
            const activity = activities.find(type => type.id === item.business_activity_type_id);
            const count = counts[item.id];
            return (
              <div key={item.id} className="pa-setting-row">
                <div>
                  <button type="button" className="pa-name-button" onClick={() => onBrowse(item.id)}>{item.name}</button>
                  <p className="pa-row-subtitle">{activity?.name || '—'}{item.description ? ' · ' + item.description : ''}</p>
                </div>
                <div className="pa-inline">
                  <span className="pa-muted">{count == null ? '—' : count + (count === 1 ? ' article' : ' articles')}</span>
                  <span className="pa-muted">{item.is_active ? 'Actif' : 'Inactif'}</span>
                  <button type="button" className="pa-icon-button" aria-label={'Modifier ' + item.name} onClick={() => openEdit(item)}><Pencil size={16} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
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

  if (!selectedCatalogId) return <div className="pa-empty">Sélectionnez d'abord un catalogue.</div>;

  if (editing) {
    const parent = rootCats.find(item => item.id === editing.parent_id);
    return (
      <CatalogEditor title={isNew ? (parent ? 'Nouvelle sous-catégorie' : 'Nouvelle catégorie') : 'Modifier la catégorie'}
        backLabel="Retour aux catégories" onBack={() => setEditing(null)} onSave={save}>
        {parent && <p className="pa-copy">Catégorie parente · {parent.name}</p>}
        <div className="pa-form-grid">
          <label className="pa-field-label">Nom
            <input className="w-input-ul" required value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} />
          </label>
          <label className="pa-field-label">Ordre d’affichage
            <input className="w-input-ul" type="number" value={editing.sort_order}
              onChange={event => setEditing({ ...editing, sort_order: Number(event.target.value) })} />
          </label>
        </div>
        <label className="pa-inline">
          <input type="checkbox" checked={editing.is_active} onChange={event => setEditing({ ...editing, is_active: event.target.checked })} /> Actif
        </label>
      </CatalogEditor>
    );
  }

  return (
    <div className="pa-page">
      <div className="pa-toolbar">
        <CatalogSelect catalogs={catalogs} value={selectedCatalogId} onChange={onSelectCatalog} />
        <button type="button" onClick={openNewRoot} className="pa-button" data-variant="primary"><Plus size={16} /> Nouvelle catégorie</button>
      </div>
      {rootCats.length === 0 ? <p className="pa-empty">Aucune catégorie dans ce catalogue.</p> : (
        <div className="pa-divided">
          {rootCats.map(category => (
            <div key={category.id}>
              <div className="pa-setting-row">
                <button type="button" className="pa-name-button" onClick={() => openEdit(category)}>{category.name}</button>
                <div className="pa-inline">
                  <button type="button" className="pa-link" onClick={() => openNewChild(category.id)}><Plus size={15} /> Sous-catégorie</button>
                  <button type="button" className="pa-icon-button" aria-label={'Modifier ' + category.name} onClick={() => openEdit(category)}><Pencil size={16} /></button>
                </div>
              </div>
              {catalogCats.filter(item => item.parent_id === category.id).map(item => (
                <div key={item.id} className="pa-setting-row pa-subcategory">
                  <button type="button" className="pa-link" onClick={() => openEdit(item)}><ChevronRight size={14} /> {item.name}</button>
                  <button type="button" className="pa-icon-button" aria-label={'Modifier ' + item.name} onClick={() => openEdit(item)}><Pencil size={16} /></button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CatalogSelect({ catalogs, value, onChange }: { catalogs: Catalog[]; value: string; onChange: (id: string) => void }) {
  return (
    <label className="pa-field-label">Catalogue
      <select className="w-input-ul" value={value} onChange={event => onChange(event.target.value)}>
        {!value && <option value="">Choisir un catalogue</option>}
        {catalogs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>
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
    } catch (e: any) { toastError(e.message); }
  };

  const doBulkDeleteAll = async () => {
    if (!selectedCatalogId) return;
    try {
      const { error } = await supabase.from('master_catalog_items').delete().eq('master_catalog_id', selectedCatalogId);
      if (error) throw error;
      success(`Tous les articles du catalogue ont été supprimés`);
      setSelected(new Set());
      setBulkDeleteAllOpen(false);
      loadPage();
      onChange();
    } catch (e: any) { toastError(e.message); }
  };

  if (!selectedCatalogId) return <div className="pa-empty">Sélectionnez d'abord un catalogue.</div>;

  const subcatsFor = (catId: string | null) => catId ? catalogCats.filter(c => c.parent_id === catId) : [];

  if (deleteId) {
    return <PlatformConfirmation title="Supprimer cet article ?" backLabel="Retour aux articles" onBack={() => setDeleteId(null)}
      message="La suppression est définitive." label="Supprimer l’article" danger onConfirm={doDelete} />;
  }

  if (bulkDeleteOpen || bulkDeleteAllOpen) {
    return <PlatformConfirmation title={bulkDeleteAllOpen ? 'Vider le catalogue ?' : 'Supprimer les articles sélectionnés ?'}
      backLabel="Retour aux articles" onBack={() => { setBulkDeleteOpen(false); setBulkDeleteAllOpen(false); }}
      message={(bulkDeleteAllOpen ? totalCount : selected.size) + ' articles seront supprimés définitivement du catalogue. Les entreprises qui les ont déjà importés conservent leur copie.'}
      label={bulkDeleteAllOpen ? 'Vider le catalogue' : 'Supprimer la sélection'} danger
      onConfirm={bulkDeleteAllOpen ? doBulkDeleteAll : doBulkDelete} />;
  }

  if (editing) {
    return (
      <CatalogEditor title={isNew ? 'Nouvel article' : 'Modifier l’article'} backLabel="Retour aux articles" onBack={() => setEditing(null)} onSave={save}>
        <div className="pa-form-grid">
          {([
            ['designation', 'Désignation'], ['brand', 'Marque'], ['manufacturer_ref', 'Référence constructeur'],
            ['model', 'Modèle'], ['unit', 'Unité'], ['barcode', 'Code-barres'],
          ] as const).map(([key, label]) => (
            <label key={key} className="pa-field-label">{label}
              <input className="w-input-ul" required={key === 'designation'} value={editing[key] || ''}
                onChange={event => setEditing({ ...editing, [key]: event.target.value })} />
            </label>
          ))}
          <label className="pa-field-label">Catégorie
            <select className="w-input-ul" value={editing.category_id || ''}
              onChange={event => setEditing({ ...editing, category_id: event.target.value || null, subcategory_id: null })}>
              <option value="">—</option>
              {rootCats.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="pa-field-label">Sous-catégorie
            <select className="w-input-ul" value={editing.subcategory_id || ''}
              onChange={event => setEditing({ ...editing, subcategory_id: event.target.value || null })}>
              <option value="">—</option>
              {subcatsFor(editing.category_id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          {([['purchase_price', 'Prix d’achat'], ['sale_price', 'Prix de vente'], ['vat_rate', 'TVA (%)']] as const).map(([key, label]) => (
            <label key={key} className="pa-field-label">{label}
              <input className="w-input-ul" type="number" step="any" value={editing[key] ?? 0}
                onChange={event => setEditing({ ...editing, [key]: Number(event.target.value) })} />
            </label>
          ))}
          <label className="pa-field-label">Adresse de l’image
            <input className="w-input-ul" value={editing.image_url || ''} onChange={event => setEditing({ ...editing, image_url: event.target.value })} />
          </label>
        </div>
        <label className="pa-field-label">Description
          <textarea className="w-input-ul" rows={3} value={editing.description || ''} onChange={event => setEditing({ ...editing, description: event.target.value })} />
        </label>
        <label className="pa-inline">
          <input type="checkbox" checked={editing.is_active} onChange={event => setEditing({ ...editing, is_active: event.target.checked })} /> Actif
        </label>
      </CatalogEditor>
    );
  }

  return (
    <div className="pa-page">
      <div className="pa-toolbar">
        <CatalogSelect catalogs={catalogs} value={selectedCatalogId} onChange={id => { onSelectCatalog(id); setPage(0); }} />
        <label className="pa-search">
          <Search size={16} aria-hidden="true" />
          <input value={search} onChange={event => setSearch(event.target.value)} aria-label="Rechercher un article de catalogue" placeholder="Désignation, marque ou référence" />
        </label>
        <button type="button" onClick={openNew} className="pa-button" data-variant="primary"><Plus size={16} /> Nouvel article</button>
      </div>
      <div className="pa-toolbar">
        <label className="pa-inline text-xs">
          <input type="checkbox" checked={items.length > 0 && selected.size === items.length} onChange={toggleSelectAll} /> Sélectionner la page
        </label>
        <span className="pa-muted text-xs">{totalCount} article{totalCount !== 1 ? 's' : ''}</span>
        {selected.size > 0 && <button type="button" className="pa-link pa-danger" onClick={() => setBulkDeleteOpen(true)}>
          Supprimer la sélection ({selected.size})
        </button>}
        {totalCount > 0 && <button type="button" className="pa-link pa-danger ml-auto" onClick={() => setBulkDeleteAllOpen(true)}>Vider le catalogue</button>}
      </div>

      {loadingItems ? <p className="pa-empty" role="status"><Loader2 size={16} className="animate-spin" /> Chargement…</p>
        : items.length === 0 ? <p className="pa-empty">Aucun article.</p> : (
          <div className="pa-table pa-catalog-items" aria-label="Articles du catalogue" role="table">
            <div className="pa-list-head" role="row">
              <span role="columnheader"><span className="sr-only">Sélection</span></span>
              <span role="columnheader">Article</span>
              <span className="pa-catalog-prices" role="columnheader"><span>Achat</span><span>Vente</span><span>TVA</span></span>
              <span role="columnheader" className="text-right">Actions</span>
            </div>
            {items.map(item => (
              <div key={item.id} className="pa-list-row" role="row">
                <div className="pa-catalog-check" role="cell">
                  <input aria-label={'Sélectionner ' + item.designation} type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelect(item.id)} />
                </div>
                <div className="pa-catalog-name" role="cell">
                  <button type="button" className="pa-name-button" onClick={() => openEdit(item)}>{item.designation}</button>
                  <p className="pa-row-subtitle">{[item.brand, item.manufacturer_ref, !item.is_active ? 'Inactif' : ''].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="pa-catalog-prices" role="cell">
                  <span><small>Achat </small>{formatFCFA(item.purchase_price)}</span>
                  <span><small>Vente </small>{formatFCFA(item.sale_price)}</span>
                  <span><small>TVA </small>{item.vat_rate} %</span>
                </div>
                <div role="cell" className="pa-row-actions">
                  <button type="button" className="pa-icon-button" aria-label={'Modifier ' + item.designation} onClick={() => openEdit(item)}><Pencil size={16} /></button>
                  <button type="button" className="pa-icon-button pa-danger" aria-label={'Supprimer ' + item.designation} onClick={() => setDeleteId(item.id)}><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      {totalPages > 1 && <nav className="pa-inline justify-end text-xs" aria-label="Pages du catalogue">
        <button type="button" className="pa-icon-button" aria-label="Page précédente" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft size={16} /></button>
        <span>{page + 1} / {totalPages}</span>
        <button type="button" className="pa-icon-button" aria-label="Page suivante" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)}><ChevronRight size={16} /></button>
      </nav>}
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
    <div className="pa-page">
      <div className="pa-toolbar">
        <CatalogSelect catalogs={catalogs} value={selectedCatalogId} onChange={onSelectCatalog} />
        <button type="button" className="pa-link" onClick={downloadTemplate}><Download size={16} /> Télécharger le modèle</button>
        <button type="button" className="pa-link" disabled={!selectedCatalogId} onClick={exportCatalog}><Download size={16} /> Exporter le catalogue</button>
      </div>

      <section className="pa-panel space-y-3">
        <h3 className="pa-heading">Importer des articles</h3>
        <label className="pa-field-label">
          Fichier Excel (.xlsx ou .xls)
          <input type="file" className="pa-file" accept=".xlsx,.xls" disabled={importing}
            onChange={event => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
              event.target.value = '';
            }} />
        </label>
        {filename && <p className="pa-copy">{filename} · {rows.length} ligne{rows.length !== 1 ? 's' : ''}</p>}

        <details>
          <summary className="pa-link cursor-pointer">Colonnes attendues</summary>
          <p className="pa-row-subtitle">Les colonnes marquées d’un astérisque sont obligatoires.</p>
          <ul className="pa-column-list">
            {IMPORT_HEADERS.map(column => <li key={column.key}>{column.label}</li>)}
          </ul>
        </details>

        {importProgress && (
          <div className="space-y-1" role="status">
            <p className="pa-row-subtitle">Lot {importProgress.lotsDone} sur {importProgress.lotsTotal} · {importProgress.done} articles sur {importProgress.total} · {importProgress.elapsed} s</p>
            <progress className="pa-progress" value={importProgress.done} max={importProgress.total} aria-label="Progression de l’import" />
          </div>
        )}
        {rows.length > 0 && (
          <div className="pa-form-actions">
            <button type="button" className="pa-link" disabled={importing} onClick={() => { setRows([]); setFilename(''); setResult(null); }}>Annuler</button>
            <button type="button" className="pa-button" data-variant="primary" disabled={importing || !selectedCatalogId} onClick={() => void runImport()}>
              {importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              {importing ? 'Import en cours…' : 'Importer ' + rows.length + (rows.length === 1 ? ' article' : ' articles')}
            </button>
          </div>
        )}
      </section>

      {result && (
        <section className="pa-panel">
          <h3 className="pa-heading">Résultat de l’import</h3>
          <dl className="pa-record-summary">
            <div><dt>Créés</dt><dd>{result.imported}</dd></div>
            <div><dt>Mis à jour</dt><dd>{result.updated}</dd></div>
            <div><dt>Erreurs</dt><dd>{result.errors?.length || 0}</dd></div>
          </dl>
          {result.errors?.length > 0 && (
            <details>
              <summary className="pa-link cursor-pointer">Voir les lignes en erreur</summary>
              <ul className="pa-divided">
                {result.errors.map((item: any, idx: number) => (
                  <li key={idx} className="pa-setting-row pa-danger">Ligne {item.row} · {item.error}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
