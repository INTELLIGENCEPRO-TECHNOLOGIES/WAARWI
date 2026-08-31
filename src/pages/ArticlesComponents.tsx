import { useState, useRef, useMemo, useEffect, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Package, Trash2, X, Plus, Search, ChevronDown, ChevronUp, ChevronRight, CheckSquare, Square, Pencil, Lightbulb, MousePointerClick, ArrowRight, Library, Camera, Loader2, ArrowLeft, ArrowRight as ArrowRightIcon, Info, Tags, Boxes, Car, CheckCircle2, Percent, ShieldCheck, ToggleLeft, ToggleRight, Settings2, Eye, EyeOff } from 'lucide-react';
import { formatFCFA } from '../lib/format';
import type { Article, Category, VehicleBrand } from '../lib/types';
type TierDefinition = { id: string; tier_name: string; sort_order: number; is_default: boolean };
type Form = Partial<Article> & { stock_init?: number };
type Compat = { id?: string; brand_id: string; model_id: string; year_start: number; year_end: number; notes: string };
type TabKey = 'infos' | 'prix' | 'stock' | 'compat' | 'image';

// ── Utilities ──────────────────────────────────────────────

export function stockStatus(qty: number, min: number) {
  if (qty === 0) return { bg: 'bg-red-50', icon: 'text-red-500', badge: 'text-red-600', dot: 'bg-red-500', label: 'Rupture' };
  if (qty <= min) return { bg: 'bg-amber-50', icon: 'text-amber-500', badge: 'text-amber-600', dot: 'bg-amber-500', label: 'Stock bas' };
  return { bg: 'bg-emerald-50', icon: 'text-emerald-500', badge: 'text-emerald-600', dot: 'bg-emerald-500', label: 'En stock' };
}

// ── Field & Form Primitives ────────────────────────────────

export function Field({ label, children, hint, className = '' }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-[11px] font-bold text-neutral-500 uppercase tracking-wider mb-1">{label}</label>
      {children}
      <div className="h-px bg-neutral-200 mt-1" />
      {hint && <p className="text-[10px] text-neutral-400 mt-1">{hint}</p>}
    </div>
  );
}

export function PremiumSelect({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string; bold?: boolean }[];
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)} className="bare-input appearance-none pr-8 text-sm py-1.5 w-full">
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 pointer-events-none" />
    </div>
  );
}

export function PriceInput({ value, onChange, placeholder }: { value: number | '' | undefined; onChange: (v: number | '') => void; placeholder?: string }) {
  const displayVal = value === 0 || value === undefined ? '' : value;
  return (
    <>
    <input
      type="number"
      value={displayVal}
      onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      placeholder={placeholder || '0'}
      className="bare-input text-sm num w-full py-1.5"
      min="0"
    />
    </>
  );
}

// ── ArticleCard (mobile) ───────────────────────────────────

export function ArticleCard({ article, category, qty, onEdit, onDelete, selectionMode, selected, onToggleSelect, showMargin: _showMargin, showStock }: {
  article: Article; category?: Category; qty: number;
  onEdit: () => void; onDelete: () => void;
  selectionMode: boolean; selected: boolean; onToggleSelect: () => void;
  showMargin: boolean; showStock: boolean;
}) {
  return (
    <div className={`border-b border-neutral-100 last:border-b-0 py-2.5 px-1 flex items-end gap-2 transition-colors active:bg-neutral-50 ${selected ? 'bg-brand-50/40' : ''}`}
      onClick={selectionMode ? onToggleSelect : onEdit}>
      {selectionMode && (
        <span className="shrink-0 text-brand-700 pb-0.5">{selected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-slate-400" />}</span>
      )}
      <div className="min-w-0 flex-1 leading-tight">
        <div className="text-[11px] font-semibold text-slate-900 line-clamp-2">{article.name}</div>
        {article.oem_ref && <div className="text-[9px] text-slate-400 font-mono truncate mt-0.5">OEM: {article.oem_ref}</div>}
      </div>
      <span className="shrink-0 text-[11px] font-bold text-slate-900 tabular-nums pb-0.5">{formatFCFA(article.sale_price)}</span>
    </div>
  );
}

// ── CategoryFilterSheet ────────────────────────────────────

export function CategoryFilterSheet({ categories, value, onChange, onClose }: {
  categories: Category[]; value: string; onChange: (v: string) => void; onClose: () => void;
}) {
  const parents = categories.filter(c => !c.parent_id);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center animate-fade-in">
      <div className="absolute inset-0 bg-neutral-900/40" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white rounded-t-xl sm:rounded-xl shadow-lg max-h-[70vh] flex flex-col animate-sheet-up">
        <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between">
          <h3 className="font-bold text-neutral-900 text-sm">Filtrer par catégorie</h3>
          <button onClick={onClose} className="p-1.5 text-neutral-400 hover:text-neutral-600 transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-neutral-100">
          <button onClick={() => onChange('')} className={`w-full text-left px-4 py-3 text-sm font-semibold transition-colors ${!value ? 'text-brand-700' : 'text-neutral-700 hover:text-neutral-900'}`}>
            Toutes les catégories
          </button>
          {parents.map(c => (
            <div key={c.id}>
              <button onClick={() => onChange(c.id)} className={`w-full text-left px-4 py-3 text-sm font-semibold transition-colors ${value === c.id ? 'text-brand-700' : 'text-neutral-700 hover:text-neutral-900'}`}>
                {c.name}
              </button>
              {categories.filter(s => s.parent_id === c.id).map(s => (
                <button key={s.id} onClick={() => onChange(s.id)} className={`w-full text-left pl-8 pr-4 py-2.5 text-sm transition-colors ${value === s.id ? 'text-brand-700 font-semibold' : 'text-neutral-600 hover:text-neutral-900'}`}>
                  ↳ {s.name}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── MasterCatalogGuide ─────────────────────────────────────

export function MasterCatalogGuide({ step, articleCount: _articleCount, onStep, onDismiss, onGo }: {
  step: number; articleCount: number; onStep: (s: number) => void; onDismiss: () => void; onGo: () => void;
}) {
  const steps = [
    { title: 'Bienvenue dans votre catalogue', desc: 'Gérez vos articles, prix, et stocks depuis un seul endroit. Ajoutez manuellement ou depuis le catalogue maître.', icon: Library },
    { title: 'Catalogue maître', desc: 'Des milliers de pièces pré-renseignées : importez en un clic et personnalisez les prix.', icon: MousePointerClick },
    { title: 'Ajout rapide', desc: 'Cliquez sur le bouton "+" pour créer un article, ou importez un fichier Excel.', icon: Lightbulb },
  ];
  const s = steps[step];
  const Icon = s.icon;

  return (
    <div className="relative py-3 border-b border-neutral-100 animate-fade-in">
      <button onClick={onDismiss} className="absolute top-3 right-0 p-1 text-neutral-400 hover:text-neutral-600 transition-colors"><X className="w-4 h-4" /></button>
      <div className="flex items-start gap-3">
        <Icon className="w-5 h-5 text-brand-700 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 pr-6">
          <h4 className="text-sm font-bold text-neutral-900">{s.title}</h4>
          <p className="text-xs text-neutral-500 mt-0.5">{s.desc}</p>
          <div className="flex items-center gap-2 mt-3">
            {steps.map((_, i) => <span key={i} className={`w-1.5 h-1.5 rounded-full transition-all ${i === step ? 'bg-brand-600 w-4' : 'bg-neutral-200'}`} />)}
            <div className="flex-1" />
            {step < steps.length - 1 ? (
              <button onClick={() => onStep(step + 1)} className="inline-flex items-center gap-1 text-[11px] font-bold text-brand-700 hover:text-brand-800 transition-colors">
                Suivant <ArrowRight className="w-3 h-3" />
              </button>
            ) : (
              <button onClick={onGo} className="inline-flex items-center gap-1.5 text-[11px] font-bold text-brand-700 hover:text-brand-800 transition-colors">
                Voir le catalogue maître <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── CategoryPickerModal ───────────────────────────────────

export function CategoryPickerModal({ open, onClose, categories, onSelect, selected, createCategory }: {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  onSelect: (id: string) => void;
  selected?: string;
  createCategory?: (name: string, parentId: string | null) => Promise<string | null>;
}) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatParent, setNewCatParent] = useState('');
  const [creatingCat, setCreatingCat] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setSearch(''); setExpanded(new Set()); setTimeout(() => inputRef.current?.focus(), 50); } }, [open]);

  const parents = useMemo(() => categories.filter(c => !c.parent_id), [categories]);
  const childMap = useMemo(() => {
    const m = new Map<string, Category[]>();
    for (const c of categories) { if (c.parent_id) { const arr = m.get(c.parent_id) || []; arr.push(c); m.set(c.parent_id, arr); } }
    return m;
  }, [categories]);
  const childrenOf = (pid: string) => childMap.get(pid) || [];

  const normalizedSearch = search.toLowerCase().trim();
  const isSearching = normalizedSearch.length > 0;

  const flatResults = useMemo(() => {
    if (!isSearching) return null;
    const results: { id: string; name: string; breadcrumb: string }[] = [];
    for (const p of parents) {
      if (p.name.toLowerCase().includes(normalizedSearch)) {
        results.push({ id: p.id, name: p.name, breadcrumb: '' });
      }
      for (const c of childrenOf(p.id)) {
        if (c.name.toLowerCase().includes(normalizedSearch) || p.name.toLowerCase().includes(normalizedSearch)) {
          results.push({ id: c.id, name: c.name, breadcrumb: p.name });
        }
      }
    }
    return results;
  }, [parents, childMap, normalizedSearch]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const handleSelect = (id: string) => { onSelect(id); };

  const submitNewCategory = async () => {
    if (!newCatName.trim() || !createCategory) return;
    setCreatingCat(true);
    const id = await createCategory(newCatName.trim(), newCatParent || null);
    setCreatingCat(false);
    if (id) {
      handleSelect(id);
      setShowNewCat(false);
      setNewCatName('');
      setNewCatParent('');
    }
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center animate-fade-in" onClick={onClose}>
      <div className="absolute inset-0 bg-neutral-900/40" />
      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-xl animate-sheet-up max-h-[70vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Dark header */}
        <div className="bg-neutral-900 px-5 pt-4 pb-3 shrink-0 rounded-t-2xl">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">Catégorie</h3>
            <button onClick={onClose} className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className="px-4 pt-3 pb-2 shrink-0 border-b border-neutral-100">
          <div className="flex items-center gap-2 bg-neutral-100 rounded-lg px-3 py-2">
            <Search className="w-4 h-4 text-neutral-400 shrink-0" />
            <input
              ref={inputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 bg-transparent border-0 outline-none text-sm text-neutral-800 placeholder-neutral-400"
              placeholder="Rechercher une catégorie..."
            />
            {search && <button onClick={() => setSearch('')} className="text-neutral-400 hover:text-neutral-600"><X className="w-3.5 h-3.5" /></button>}
          </div>
        </div>

        {/* Category tree / search results */}
        <div className="flex-1 overflow-y-auto px-3 py-2 min-h-0">
          {createCategory && !isSearching && (
            <button onClick={() => setShowNewCat(true)} className="w-full flex items-center gap-2 px-3 py-2.5 border-b border-neutral-100 hover:bg-brand-50 text-brand-700 transition-colors">
              <Plus className="w-4 h-4" />
              <span className="text-xs font-semibold">Nouvelle catégorie</span>
            </button>
          )}

          {/* No category option */}
          {!isSearching && (
            <button onClick={() => handleSelect('')} className={`w-full flex items-center gap-2 px-3 py-2.5 border-b border-neutral-100 transition-colors ${!selected ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}>
              <span className={`text-xs ${!selected ? 'font-semibold text-neutral-700' : 'text-neutral-400 italic'}`}>Toutes les catégories</span>
              {!selected && <CheckCircle2 className="w-3.5 h-3.5 text-neutral-600 ml-auto" />}
            </button>
          )}

          {/* Search mode: flat results with breadcrumbs */}
          {isSearching && flatResults && (
            <>
              {flatResults.map(item => (
                <button key={item.id} onClick={() => handleSelect(item.id)}
                  className={`w-full text-left flex items-center gap-2 px-3 py-2.5 border-b border-neutral-100 transition-colors ${selected === item.id ? 'bg-blue-50' : 'hover:bg-neutral-50'}`}>
                  <div className="flex-1 min-w-0">
                    {item.breadcrumb && (
                      <div className="flex items-center gap-1 mb-0.5">
                        <span className="text-[10px] text-neutral-400 truncate">{item.breadcrumb}</span>
                        <ChevronRight className="w-2.5 h-2.5 text-neutral-300 shrink-0" />
                      </div>
                    )}
                    <span className={`text-xs truncate block ${selected === item.id ? 'font-bold text-blue-700' : 'text-neutral-800'}`}>{item.name}</span>
                  </div>
                  {selected === item.id && <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />}
                </button>
              ))}
              {flatResults.length === 0 && (
                <div className="py-8 text-center text-xs text-neutral-400">Aucune catégorie trouvée</div>
              )}
            </>
          )}

          {/* Tree mode: collapsible parent categories */}
          {!isSearching && parents.map(parent => {
            const children = childrenOf(parent.id);
            const hasChildren = children.length > 0;
            const isOpen = expanded.has(parent.id);
            const isSelected = selected === parent.id;
            return (
              <div key={parent.id} className="border-b border-neutral-100">
                <div className="flex items-center">
                  {hasChildren ? (
                    <button onClick={() => toggleExpand(parent.id)}
                      className="w-8 h-8 flex items-center justify-center text-neutral-400 hover:text-neutral-700 transition-all shrink-0">
                      <ChevronRight className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`} />
                    </button>
                  ) : <span className="w-8 shrink-0" />}
                  <button onClick={() => handleSelect(parent.id)}
                    className={`flex-1 text-left flex items-center justify-between px-2 py-2.5 transition-colors ${isSelected ? 'bg-blue-50' : 'hover:bg-neutral-50'}`}>
                    <span className={`text-xs truncate ${isSelected ? 'font-bold text-blue-700' : 'font-semibold text-neutral-800'}`}>
                      {parent.name}
                    </span>
                    <span className="flex items-center gap-1.5">
                      {hasChildren && <span className="text-[10px] text-neutral-400 bg-neutral-100 px-1.5 py-0.5 rounded-full tabular-nums">{children.length}</span>}
                      {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />}
                    </span>
                  </button>
                </div>
                {hasChildren && isOpen && (
                  <div className="ml-8 border-l-2 border-neutral-200 mb-1">
                    {children.map(child => {
                      const childSelected = selected === child.id;
                      return (
                        <button key={child.id} onClick={() => handleSelect(child.id)}
                          className={`w-full text-left flex items-center justify-between px-3 py-2 transition-colors ${childSelected ? 'bg-blue-50' : 'hover:bg-neutral-50'}`}>
                          <span className={`text-xs truncate ${childSelected ? 'font-bold text-blue-700' : 'text-neutral-600'}`}>{child.name}</span>
                          {childSelected && <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* New category inline form */}
        {showNewCat && (
          <div className="px-5 py-3 border-t border-neutral-200 bg-neutral-50 shrink-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 mb-2">Nouvelle catégorie</div>
            <div className="space-y-2.5">
              <input autoFocus value={newCatName} onChange={e => setNewCatName(e.target.value)}
                className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 text-sm text-neutral-800 placeholder-neutral-400"
                placeholder="Nom de la catégorie"
                onKeyDown={e => { if (e.key === 'Enter') submitNewCategory(); if (e.key === 'Escape') setShowNewCat(false); }} />
              <select value={newCatParent} onChange={e => setNewCatParent(e.target.value)}
                className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 text-xs text-neutral-700">
                <option value="">Pas de parent (catégorie principale)</option>
                {parents.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="flex items-center justify-end gap-2 mt-3">
              <button onClick={() => setShowNewCat(false)} className="text-xs font-semibold text-neutral-500 hover:text-neutral-900 transition-colors px-3 py-1.5 rounded-lg hover:bg-neutral-200">Annuler</button>
              <button onClick={submitNewCategory} disabled={!newCatName.trim() || creatingCat} className="inline-flex items-center gap-1 text-xs font-bold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 transition-colors px-3 py-1.5 rounded-lg">
                {creatingCat ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Créer
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ── InfosTab ───────────────────────────────────────────────

export function InfosTab({ form, setForm, editing, categories, suppliers, onGenerateRef, autoMode, createCategory }: {
  form: Form; setForm: (f: Form | ((p: Form) => Form)) => void;
  editing: boolean; categories: Category[]; suppliers: any[];
  onGenerateRef: () => void; autoMode: boolean;
  createCategory?: (name: string, parentId: string | null) => Promise<string | null>;
}) {
  const [catPickerOpen, setCatPickerOpen] = useState(false);

  const handleCategoryChange = (v: string) => {
    const cat = categories.find(c => c.id === v);
    setForm(f => ({
      ...f,
      category_id: v,
      ...(!editing && cat && (cat as any).track_stock !== undefined
        ? { track_stock: (cat as any).track_stock !== false }
        : {}),
    }));
  };

  const selectedCatLabel = useMemo(() => {
    if (!form.category_id) return '';
    const cat = categories.find(c => c.id === form.category_id);
    if (!cat) return '';
    if (cat.parent_id) {
      const parent = categories.find(p => p.id === cat.parent_id);
      return parent ? `${parent.name} > ${cat.name}` : cat.name;
    }
    return cat.name;
  }, [form.category_id, categories]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Désignation *" className="sm:col-span-2">
          <input value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="bare-input text-sm" placeholder="Nom de l'article" />
        </Field>
        <Field label="Référence interne *">
          <div className="flex gap-2">
            <input value={form.internal_ref || ''} onChange={e => setForm(f => ({ ...f, internal_ref: e.target.value }))} className="bare-input text-sm flex-1 font-mono" placeholder="REF-0001" />
            {!editing && <button type="button" onClick={onGenerateRef} className="px-2 text-xs font-semibold text-brand-700 hover:text-brand-800 transition-colors shrink-0">Auto</button>}
          </div>
        </Field>
        <Field label="Catégorie">
          <button type="button" onClick={() => setCatPickerOpen(true)}
            className="w-full text-left bg-transparent border-0 hover:border-brand-400 px-0 py-1 text-sm text-neutral-800 outline-none transition cursor-pointer flex items-center justify-between">
            <span className={selectedCatLabel ? 'text-neutral-800' : 'text-neutral-400'}>{selectedCatLabel || 'Choisir une catégorie'}</span>
            <ChevronDown className="w-3.5 h-3.5 text-neutral-400" />
          </button>
        </Field>
        {autoMode && (
          <Field label="Marque">
            <input value={form.brand || ''} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} className="bare-input text-sm" placeholder="Marque" />
          </Field>
        )}
        <Field label="Réf. OEM">
          <input value={form.oem_ref || ''} onChange={e => setForm(f => ({ ...f, oem_ref: e.target.value }))} className="bare-input text-sm font-mono" placeholder="Référence fabricant" />
        </Field>
        <Field label="Code-barres">
          <input value={form.barcode || ''} onChange={e => setForm(f => ({ ...f, barcode: e.target.value }))} className="bare-input text-sm font-mono" placeholder="EAN / UPC" />
        </Field>
        <Field label="Unité">
          <PremiumSelect value={form.unit || 'pièce'} onChange={v => setForm(f => ({ ...f, unit: v }))}
            options={[{ value: 'unité', label: 'Unité' }, { value: 'pièce', label: 'Pièce' }, { value: 'paire', label: 'Paire' }, { value: 'lot', label: 'Lot' }, { value: 'kg', label: 'Kilogramme' }, { value: 'litre', label: 'Litre' }, { value: 'mètre', label: 'Mètre' }]} />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <textarea value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="bare-input text-sm resize-none" placeholder="Description optionnelle" />
        </Field>
      </div>

      <CategoryPickerModal
        open={catPickerOpen}
        onClose={() => setCatPickerOpen(false)}
        categories={categories}
        onSelect={handleCategoryChange}
        createCategory={createCategory}
      />
    </div>
  );
}

// ── PrixTab ────────────────────────────────────────────────

export function PrixTab({ form, setForm, marginValue, marginStr, showPurchasePrice, showMargin, formTiers, setFormTiers, tierDefinitions, isPharmacy }: {
  form: Form; setForm: (f: Form | ((p: Form) => Form)) => void;
  marginValue: number; marginStr: string;
  showPurchasePrice: boolean; showMargin: boolean;
  formTiers: Array<{ tier_name: string; price: number | '' }>;
  setFormTiers: (t: Array<{ tier_name: string; price: number | '' }>) => void;
  tierDefinitions: TierDefinition[];
  isPharmacy?: boolean;
}) {
  const mgTone = marginValue >= 30 ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : marginValue >= 15 ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-red-700 bg-red-50 border-red-200';

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {showPurchasePrice && (
          <Field label="Prix d'achat (FCFA)">
            <PriceInput value={form.purchase_price} onChange={v => setForm(f => ({ ...f, purchase_price: v === '' ? 0 : v }))} placeholder="Prix d'achat" />
          </Field>
        )}
        <Field label="Prix de vente détail (FCFA)">
          <PriceInput value={form.sale_price} onChange={v => setForm(f => ({ ...f, sale_price: v === '' ? 0 : v }))} placeholder="Prix de vente" />
        </Field>
        <Field label="TVA (%)">
          <PriceInput value={form.vat_rate} onChange={v => setForm(f => ({ ...f, vat_rate: v === '' ? 0 : v }))} placeholder="Taux TVA" />
        </Field>
      </div>

      {showMargin && form.sale_price !== undefined && Number(form.sale_price) > 0 && (
        <div className={`flex items-center gap-1.5 text-xs font-bold ${mgTone.split(' ')[0]}`}>
          <Percent className="w-3.5 h-3.5" />
          Marge : {marginStr}%
        </div>
      )}

      {/* Pricing tiers */}
      {tierDefinitions.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">Catégories tarifaires</div>
          <div className="space-y-2">
            {formTiers.map((tier, idx) => (
              <div key={tier.tier_name} className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-700 w-32 truncate">{tier.tier_name}</span>
                <PriceInput value={tier.price} onChange={v => {
                  const updated = [...formTiers];
                  updated[idx] = { ...updated[idx], price: v };
                  setFormTiers(updated);
                }} placeholder="Prix" />
              </div>
            ))}
          </div>
          <p className="text-[10px] text-slate-400">Laissez vide si non applicable. Ces prix seront proposés lors de la vente.</p>
        </div>
      )}

      {isPharmacy && (
        <div className="flex items-center gap-3 py-1">
          <ShieldCheck className="w-4 h-4 text-teal-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-slate-700">Eligible IPM</div>
            <div className="text-[10px] text-slate-500">Cet article est pris en charge par les conventions IPM</div>
          </div>
          <button type="button" onClick={() => setForm(f => ({ ...f, ipm_eligible: f.ipm_eligible === false ? true : false }))}
            className={`relative w-10 h-5 rounded-full transition-colors ${form.ipm_eligible !== false ? 'bg-teal-500' : 'bg-slate-300'}`}>
            <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.ipm_eligible !== false ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── StockTab ───────────────────────────────────────────────

export function StockTab({ form, setForm, editing, currentArticle, stockMap }: {
  form: Form; setForm: (f: Form | ((p: Form) => Form)) => void;
  editing: boolean; currentArticle: Article | null; stockMap: Record<string, number>;
}) {
  const currentQty = currentArticle ? (stockMap[currentArticle.id] || 0) : 0;
  const trackStock = form.track_stock !== false;
  const mStatus = currentArticle && trackStock ? stockStatus(currentQty, Number(form.stock_min || 0)) : null;

  return (
    <div className="space-y-4">
      {/* Track stock toggle */}
      <button
        type="button"
        onClick={() => setForm(f => ({ ...f, track_stock: !trackStock }))}
        className="w-full flex items-center justify-between gap-3 py-2 transition-all"
      >
        <div className="text-left">
          <div className={`text-xs font-bold ${trackStock ? 'text-brand-800' : 'text-slate-600'}`}>
            {trackStock ? 'Stock suivi' : 'Stock non suivi'}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            {trackStock
              ? 'Les ventes et mouvements de cet article affectent le stock.'
              : 'Cet article (service, prestation…) ne génère aucun mouvement de stock.'}
          </div>
        </div>
        {trackStock
          ? <ToggleRight className="w-6 h-6 text-brand-600 shrink-0" />
          : <ToggleLeft className="w-6 h-6 text-slate-400 shrink-0" />}
      </button>

      {trackStock && (
        <>
          {editing && currentArticle && mStatus && (
            <div className="flex items-center gap-2 py-1">
              <Package className={`w-4 h-4 ${mStatus.icon} shrink-0`} />
              <div>
                <div className="text-xs font-bold text-slate-900">Stock actuel : <span className="num">{currentQty}</span> {form.unit || 'unité(s)'}</div>
                <div className={`text-[10px] font-semibold ${mStatus.icon}`}>{mStatus.label}</div>
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Stock minimum (alerte)">
              <input type="number" value={form.stock_min || ''} onChange={e => setForm(f => ({ ...f, stock_min: Number(e.target.value) }))} className="bare-input text-sm num" min="0" placeholder="0" />
            </Field>
            <Field label="Stock maximum">
              <input type="number" value={form.stock_max || ''} onChange={e => setForm(f => ({ ...f, stock_max: Number(e.target.value) }))} className="bare-input text-sm num" min="0" placeholder="0" />
            </Field>
            <Field label="Emplacement">
              <input value={form.location || ''} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} className="bare-input text-sm" placeholder="Rayon / Étagère" />
            </Field>
            {!editing && (
              <Field label="Stock initial">
                <input type="number" value={form.stock_init || ''} onChange={e => setForm(f => ({ ...f, stock_init: Number(e.target.value) }))} className="bare-input text-sm num" min="0" placeholder="0" />
              </Field>
            )}
          </div>
        </>
      )}

      {!trackStock && (
        <div className="flex items-center gap-2 text-slate-500 text-xs py-1">
          <Package className="w-4 h-4 text-slate-300 shrink-0" />
          Aucun suivi de stock pour cet article. Il peut être vendu sans contrainte de quantité.
        </div>
      )}
    </div>
  );
}

// ── CompatTab ──────────────────────────────────────────────

export function CompatTab({ compats, brands, models, onAdd, onRemove, onUpdate }: {
  compats: Compat[]; brands: VehicleBrand[]; models: any[];
  onAdd: () => void; onRemove: (i: number) => void;
  onUpdate: (i: number, patch: Partial<Compat>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-slate-700">Véhicules compatibles</h4>
        <button onClick={onAdd} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-brand-700 hover:bg-brand-50">
          <Plus className="w-3 h-3" />Ajouter
        </button>
      </div>
      {compats.length === 0 && <p className="text-xs text-slate-400 text-center py-4">Aucune compatibilité ajoutée</p>}
      {compats.map((c, i) => (
        <div key={i} className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-500 uppercase">Compatibilité {i + 1}</span>
            <button onClick={() => onRemove(i)} className="p-1 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <PremiumSelect value={c.brand_id} onChange={v => onUpdate(i, { brand_id: v, model_id: '' })} placeholder="Marque"
              options={brands.map(b => ({ value: b.id, label: b.name }))} />
            <PremiumSelect value={c.model_id} onChange={v => onUpdate(i, { model_id: v })} placeholder="Modèle"
              options={models.filter(m => m.brand_id === c.brand_id).map(m => ({ value: m.id, label: m.name }))} />
            <input type="number" value={c.year_start || ''} onChange={e => onUpdate(i, { year_start: Number(e.target.value) })} className="bare-input text-xs num" placeholder="Année début" />
            <input type="number" value={c.year_end || ''} onChange={e => onUpdate(i, { year_end: Number(e.target.value) })} className="bare-input text-xs num" placeholder="Année fin" />
          </div>
          <input value={c.notes || ''} onChange={e => onUpdate(i, { notes: e.target.value })} className="bare-input text-xs" placeholder="Notes (motorisation, variante...)" />
        </div>
      ))}
    </div>
  );
}

// ── ImageTab ───────────────────────────────────────────────

export function ImageTab({ currentUrl, uploading, onFileSelect, onDelete }: {
  currentUrl: string | null; uploading: boolean;
  onFileSelect: (f: File) => void; onDelete: () => void;
}) {
  return (
    <div className="space-y-4">
      {currentUrl ? (
        <div className="relative">
          <img src={currentUrl} alt="Article" className="w-full max-h-64 object-contain" />
          <button onClick={onDelete} className="absolute top-2 right-2 p-2 rounded-xl bg-red-600 text-white shadow-lg hover:bg-red-700">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <label className="flex flex-col items-center justify-center gap-3 py-8 cursor-pointer hover:opacity-70 transition">
          <Camera className="w-8 h-8 text-slate-300" />
          <div className="text-center">
            <div className="text-sm font-semibold text-slate-700">Ajouter une image</div>
            <div className="text-[11px] text-slate-400 mt-0.5">JPG, PNG — max 5 Mo</div>
          </div>
          <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFileSelect(f); }} />
        </label>
      )}
      {uploading && (
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <Loader2 className="w-4 h-4 animate-spin" />Téléversement en cours…
        </div>
      )}
    </div>
  );
}

// ── MobileArticleEdit (swipe-based, native-feel modal) ─────

export function MobileArticleEdit({ form, setForm, editing, tab, setTab, save, saving, compats, setCompats, categories, suppliers, brands, models, autoMode, generateRef, addCompat, removeCompat, createCategory, imagePreview, imageUploading, onFileSelect, onDeleteImage, marginValue, marginStr, showPurchasePrice, showMargin, stockMap, formTiers, setFormTiers, tierDefinitions, isPharmacy, onClose, onPrev, onNext, editingIndex, totalCount }: {
  form: Form; setForm: (f: Form | ((p: Form) => Form)) => void;
  editing: Article | null; tab: TabKey; setTab: (t: TabKey) => void;
  save: () => Promise<boolean>; saving: boolean;
  compats: Compat[]; setCompats: (c: Compat[] | ((p: Compat[]) => Compat[])) => void;
  categories: Category[]; suppliers: any[]; brands: VehicleBrand[]; models: any[];
  autoMode: boolean; generateRef: () => void; addCompat: () => void; removeCompat: (i: number) => void;
  createCategory?: (name: string, parentId: string | null) => Promise<string | null>;
  imagePreview: string | null; imageUploading: boolean;
  onFileSelect: (f: File) => void; onDeleteImage: () => void;
  marginValue: number; marginStr: string;
  showPurchasePrice: boolean; showMargin: boolean;
  stockMap: Record<string, number>;
  formTiers: Array<{ tier_name: string; price: number | '' }>;
  setFormTiers: (t: Array<{ tier_name: string; price: number | '' }>) => void;
  tierDefinitions: TierDefinition[];
  isPharmacy: boolean;
  onClose: () => void;
  onPrev?: () => void; onNext?: () => void;
  editingIndex: number; totalCount: number;
}) {
  const BLOCKS: { key: TabKey; label: string; icon: any; short: string }[] = [
    { key: 'infos', label: 'Informations', icon: Info, short: 'Infos' },
    { key: 'prix', label: 'Prix et tarifs', icon: Tags, short: 'Prix' },
    { key: 'stock', label: 'Stock', icon: Boxes, short: 'Stock' },
    ...(autoMode ? [{ key: 'compat' as TabKey, label: 'Compatibilité véhicules', icon: Car, short: 'Véhicules' }] : []),
    { key: 'image', label: 'Image', icon: Camera, short: 'Image' },
  ];
  const tabKeys = BLOCKS.map(b => b.key);
  const activeIdx = Math.max(0, tabKeys.indexOf(tab));
  const activeBlock = BLOCKS[activeIdx];

  // Swipe gesture state
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [slideDir, setSlideDir] = useState<'left' | 'right'>('right');
  const [dragX, setDragX] = useState(0);

  const goToTab = (next: TabKey, dir: 'left' | 'right') => {
    setSlideDir(dir);
    setDragX(0);
    setTab(next);
  };

  const goDelta = (delta: number) => {
    const nextIdx = activeIdx + delta;
    if (nextIdx < 0 || nextIdx >= tabKeys.length) return;
    goToTab(tabKeys[nextIdx], delta > 0 ? 'left' : 'right');
  };

  const onTouchStart = (e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    setDragX(0);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const dx = e.touches[0].clientX - touchStart.current.x;
    const dy = e.touches[0].clientY - touchStart.current.y;
    // Only follow horizontal drag if it's clearly horizontal (not vertical scroll)
    if (Math.abs(dx) > Math.abs(dy) * 1.4 && Math.abs(dx) > 10) {
      setDragX(dx);
    }
  };
  const onTouchEnd = () => {
    if (!touchStart.current) return;
    const threshold = 60;
    if (dragX <= -threshold) goDelta(1);
    else if (dragX >= threshold) goDelta(-1);
    setDragX(0);
    touchStart.current = null;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center animate-fade-in">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      {/* Full-screen sheet */}
      <div className="relative w-full bg-white shadow-premium flex flex-col h-full sm:max-w-none rounded-none animate-fade-in overflow-hidden">

        {/* Header with icon actions — no big footer buttons */}
        <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 border-b border-neutral-100">
          <button onClick={onClose} aria-label="Annuler"
            className="shrink-0 w-9 h-9 flex items-center justify-center text-neutral-900 active:scale-90 transition-all">
            <X className="w-[18px] h-[18px]" />
          </button>

          <div className="flex-1 min-w-0 px-1">
            <div className="text-[9px] font-bold uppercase tracking-wider text-neutral-400 leading-none">
              {editing ? 'Modification' : 'Nouvel article'}
              {totalCount > 0 && <span className="text-slate-400"> · {editingIndex + 1}/{totalCount}</span>}
            </div>
            <h2 className="text-sm font-bold text-slate-900 leading-tight mt-0.5 break-words">
              {form.name || 'Sans titre'}
            </h2>
          </div>

          {/* Prev/next article navigation (edit mode) */}
          {editing && (onPrev || onNext) && (
            <div className="shrink-0 flex items-center gap-0.5">
              <button onClick={onPrev} disabled={!onPrev} aria-label="Article précédent"
                className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-25 disabled:hover:bg-transparent active:scale-90 transition-all flex items-center justify-center">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <button onClick={onNext} disabled={!onNext} aria-label="Article suivant"
                className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-25 disabled:hover:bg-transparent active:scale-90 transition-all flex items-center justify-center">
                <ArrowRightIcon className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Save — compact branded icon button */}
          <button onClick={save} disabled={saving} aria-label="Enregistrer"
            className="shrink-0 w-9 h-9 flex items-center justify-center text-neutral-900 active:scale-90 transition-all disabled:opacity-50">
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
          </button>
        </div>

        {/* Section indicator — icon-only segmented control + active label */}
        <div className="shrink-0 px-3 pt-3 pb-2.5 border-b border-neutral-100">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="shrink-0 inline-flex items-center justify-center w-6 h-6 text-neutral-900">
                {(() => { const I = activeBlock.icon; return <I className="w-3.5 h-3.5" />; })()}
              </span>
              <span className="text-xs font-bold text-neutral-900 truncate">{activeBlock.label}</span>
            </div>
            <span className="text-[10px] font-bold text-neutral-400 tabular-nums shrink-0">
              {activeIdx + 1} / {tabKeys.length}
            </span>
          </div>

          {/* Icon-only segmented progress bar */}
          <div className="flex items-center gap-1.5">
            {BLOCKS.map((b, i) => {
              const I = b.icon;
              const active = i === activeIdx;
              const done = i < activeIdx;
              return (
                <button key={b.key} onClick={() => goToTab(b.key, i > activeIdx ? 'left' : 'right')}
                  className={`flex-1 h-8 flex items-center justify-center transition-all active:scale-95 ${active ? 'text-neutral-900' : done ? 'text-neutral-400' : 'text-neutral-300'}`}
                  aria-label={b.label}>
                  <I className="w-4 h-4" />
                </button>
              );
            })}
          </div>
        </div>

        {/* Swipeable content area — fixed via flex-1, only inner scrolls */}
        <div className="flex-1 overflow-hidden touch-pan-y" style={{ touchAction: 'pan-y' }}>
          <div
            className="h-full overflow-y-auto px-4 py-4"
            style={{ transform: dragX ? `translateX(${dragX * 0.35}px)` : undefined, transition: dragX ? 'none' : 'transform 0.24s cubic-bezier(0.22,1,0.36,1)' }}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            <div key={tab} className={slideDir === 'left' ? 'tab-slide-left' : 'tab-slide-right'}>
              {tab === 'infos' && <InfosTab form={form} setForm={setForm} editing={!!editing} categories={categories} suppliers={suppliers} onGenerateRef={generateRef} autoMode={autoMode} createCategory={createCategory} />}
              {tab === 'prix' && <PrixTab form={form} setForm={setForm} marginValue={marginValue} marginStr={marginStr} showPurchasePrice={showPurchasePrice} showMargin={showMargin} formTiers={formTiers} setFormTiers={setFormTiers} tierDefinitions={tierDefinitions} isPharmacy={isPharmacy} />}
              {tab === 'stock' && <StockTab form={form} setForm={setForm} editing={!!editing} currentArticle={editing} stockMap={stockMap} />}
              {tab === 'compat' && autoMode && <CompatTab compats={compats} brands={brands} models={models} onAdd={addCompat} onRemove={removeCompat} onUpdate={(i, patch) => setCompats((arr: Compat[]) => arr.map((x, j) => j === i ? { ...x, ...patch } : x))} />}
              {tab === 'image' && <ImageTab currentUrl={imagePreview} uploading={imageUploading} onFileSelect={onFileSelect} onDelete={onDeleteImage} />}
            </div>
          </div>
        </div>

        {/* Minimal bottom safe area */}
        <div className="shrink-0 h-[env(safe-area-inset-bottom,0px)] bg-white" />
      </div>
    </div>
  );
}

// ── DesktopListView (inline-editable table) ────────────────

const COLUMN_STORAGE_KEY = 'waarwi_article_columns';
type ColumnKey = 'internal_ref' | 'oem_ref' | 'category' | 'brand' | 'barcode' | 'unit' | 'sale_price' | 'purchase_price' | 'stock';
const ALL_OPTIONAL_COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: 'internal_ref', label: 'Réf. interne' },
  { key: 'oem_ref', label: 'Réf. OEM' },
  { key: 'category', label: 'Catégorie' },
  { key: 'brand', label: 'Marque' },
  { key: 'barcode', label: 'Code barre' },
  { key: 'unit', label: 'Unité' },
  { key: 'sale_price', label: 'Prix de vente' },
  { key: 'purchase_price', label: 'Prix d\'achat' },
  { key: 'stock', label: 'Stock' },
];
const DEFAULT_VISIBLE: ColumnKey[] = ['internal_ref', 'oem_ref', 'category', 'sale_price', 'stock'];

function useColumnPrefs(): [Set<ColumnKey>, (k: ColumnKey) => void] {
  const [visible, setVisible] = useState<Set<ColumnKey>>(() => {
    try {
      const stored = localStorage.getItem(COLUMN_STORAGE_KEY);
      if (stored) return new Set(JSON.parse(stored) as ColumnKey[]);
    } catch {}
    return new Set(DEFAULT_VISIBLE);
  });
  const toggle = (k: ColumnKey) => {
    setVisible(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  };
  return [visible, toggle];
}

function ColumnSettingsDropdown({ visible, onToggle }: { visible: Set<ColumnKey>; onToggle: (k: ColumnKey) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);
  return (
    <div className="relative inline-block" ref={ref}>
      <button onClick={() => setOpen(o => !o)} className={`p-1 rounded-lg transition-colors ${open ? 'bg-brand-100 text-brand-700' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`} title="Colonnes">
        <Settings2 className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl shadow-lg border border-slate-100 py-1.5 z-50 animate-fade-in">
          <div className="px-3 py-1.5 text-[9px] uppercase tracking-wider text-slate-400 font-bold">Colonnes visibles</div>
          {ALL_OPTIONAL_COLUMNS.map(col => (
            <button key={col.key} onClick={() => onToggle(col.key)} className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 transition-colors">
              {visible.has(col.key) ? <Eye className="w-3.5 h-3.5 text-brand-600" /> : <EyeOff className="w-3.5 h-3.5 text-slate-300" />}
              <span className={`text-xs ${visible.has(col.key) ? 'text-slate-800 font-medium' : 'text-slate-400'}`}>{col.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function DesktopListView({ articles, categoryMap: _categoryMap, stockMap, suppliers, categories, listEdits, onUpdateEdit, selectionMode, selectedIds, onToggleSelect, onSelectAll, allSelected, onOpenFullScreen, onDelete, showMargin: _showMargin, showStock, showPurchase: _showPurchase, sortCol, sortDir, onSort }: {
  articles: Article[]; categoryMap: Map<string, Category>; stockMap: Record<string, number>;
  suppliers: any[]; categories: Category[];
  listEdits: Map<string, Partial<Article>>; onUpdateEdit: (id: string, field: string, value: any) => void;
  selectionMode: boolean; selectedIds: Set<string>; onToggleSelect: (id: string) => void;
  onSelectAll: () => void; allSelected: boolean;
  onOpenFullScreen: (a: Article) => void; onDelete: (a: Article) => void;
  showMargin: boolean; showStock: boolean; showPurchase: boolean;
  sortCol?: string; sortDir?: 'asc' | 'desc'; onSort?: (col: string) => void;
}) {
  const [visibleCols, toggleCol] = useColumnPrefs();
  const [catPickOpen, setCatPickOpen] = useState(false);
  const [catPickArticle, setCatPickArticle] = useState<string | null>(null);
  const getVal = (a: Article, field: keyof Article) => {
    const edit = listEdits.get(a.id);
    if (edit && field in edit) return (edit as any)[field];
    return (a as any)[field];
  };

  const parents = categories.filter(c => !c.parent_id);
  const categoryOptions = parents.flatMap(c => [
    { value: c.id, label: c.name },
    ...categories.filter(s => s.parent_id === c.id).map(s => ({ value: s.id, label: `  ↳ ${s.name}` })),
  ]);

  const SortIcon = ({ col }: { col: string }) => {
    if (!onSort) return null;
    if (sortCol === col) return sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-brand-600" /> : <ChevronDown className="w-3 h-3 text-brand-600" />;
    return <ChevronDown className="w-3 h-3 opacity-30" />;
  };

  const showCol = (k: ColumnKey) => visibleCols.has(k) && (k !== 'stock' || showStock) && (k !== 'purchase_price' || _showPurchase);

  return (
    <div className="rounded-2xl bg-white shadow-card border border-slate-100 overflow-hidden">
      <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 300px)' }}>
        <table className="w-full text-xs">
          <thead className="bg-slate-50/70 text-[9px] uppercase text-slate-500 tracking-wider border-b border-slate-100 sticky top-0 z-10">
            <tr>
              {selectionMode && (
                <th className="px-2 py-2.5 w-8 bg-slate-50">
                  <button onClick={onSelectAll} className="text-brand-700">{allSelected ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}</button>
                </th>
              )}
              <th className="px-2 py-2.5 text-left font-semibold min-w-[280px] bg-slate-50 cursor-pointer select-none hover:text-brand-700 transition-colors" onClick={() => onSort?.('name')}>
                <span className="inline-flex items-center gap-1">Désignation <SortIcon col="name" /></span>
              </th>
              {showCol('internal_ref') && (
                <th className="px-2 py-2.5 text-left font-semibold min-w-[110px] bg-slate-50 cursor-pointer select-none hover:text-brand-700 transition-colors" onClick={() => onSort?.('ref')}>
                  <span className="inline-flex items-center gap-1">Réf. interne <SortIcon col="ref" /></span>
                </th>
              )}
              {showCol('oem_ref') && (
                <th className="px-2 py-2.5 text-left font-semibold min-w-[110px] bg-slate-50 cursor-pointer select-none hover:text-brand-700 transition-colors" onClick={() => onSort?.('oem_ref')}>
                  <span className="inline-flex items-center gap-1">Réf. OEM <SortIcon col="oem_ref" /></span>
                </th>
              )}
              {showCol('category') && (
                <th className="px-2 py-2.5 text-left font-semibold min-w-[120px] bg-slate-50 cursor-pointer select-none hover:text-brand-700 transition-colors" onClick={() => onSort?.('category')}>
                  <span className="inline-flex items-center gap-1">Catégorie <SortIcon col="category" /></span>
                </th>
              )}
              {showCol('brand') && (
                <th className="px-2 py-2.5 text-left font-semibold min-w-[100px] bg-slate-50">
                  <span className="inline-flex items-center gap-1">Marque</span>
                </th>
              )}
              {showCol('barcode') && (
                <th className="px-2 py-2.5 text-left font-semibold min-w-[120px] bg-slate-50">
                  <span className="inline-flex items-center gap-1">Code barre</span>
                </th>
              )}
              {showCol('unit') && (
                <th className="px-2 py-2.5 text-left font-semibold min-w-[70px] bg-slate-50">
                  <span className="inline-flex items-center gap-1">Unité</span>
                </th>
              )}
              {showCol('sale_price') && (
                <th className="px-2 py-2.5 text-right font-semibold min-w-[90px] bg-slate-50 cursor-pointer select-none hover:text-brand-700 transition-colors" onClick={() => onSort?.('price')}>
                  <span className="inline-flex items-center gap-1 justify-end">Prix de vente <SortIcon col="price" /></span>
                </th>
              )}
              {showCol('purchase_price') && (
                <th className="px-2 py-2.5 text-right font-semibold min-w-[90px] bg-slate-50 cursor-pointer select-none hover:text-brand-700 transition-colors" onClick={() => onSort?.('purchase_price')}>
                  <span className="inline-flex items-center gap-1 justify-end">Prix d'achat <SortIcon col="purchase_price" /></span>
                </th>
              )}
              {showCol('stock') && (
                <th className="px-2 py-2.5 text-right font-semibold min-w-[50px] bg-slate-50 cursor-pointer select-none hover:text-brand-700 transition-colors" onClick={() => onSort?.('stock')}>
                  <span className="inline-flex items-center gap-1 justify-end">Stock <SortIcon col="stock" /></span>
                </th>
              )}
              <th className="px-2 py-2.5 text-center font-semibold w-20 bg-slate-50">
                <div className="inline-flex items-center gap-1">
                  <span>Actions</span>
                  <ColumnSettingsDropdown visible={visibleCols} onToggle={toggleCol} />
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {articles.map(a => {
              const edited = listEdits.has(a.id);
              const qty = stockMap[a.id] || 0;
              const tracksStock = (a as any).track_stock !== false;
              const mStatus = tracksStock ? stockStatus(qty, Number(a.stock_min || 0)) : { badge: 'text-slate-400', dot: 'bg-slate-300', label: 'Service' };
              return (
                <tr key={a.id} className={`group transition-colors ${edited ? 'bg-brand-50/40' : 'hover:bg-slate-50/60'} ${selectedIds.has(a.id) ? 'bg-brand-50/60' : ''}`}>
                  {selectionMode && (
                    <td className="px-2 py-1.5">
                      <button onClick={() => onToggleSelect(a.id)} className="text-brand-700">{selectedIds.has(a.id) ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5 text-slate-400" />}</button>
                    </td>
                  )}
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <input value={getVal(a, 'name') || ''} onChange={e => onUpdateEdit(a.id, 'name', e.target.value)}
                        title={getVal(a, 'name') || ''}
                        className="flex-1 min-w-0 bg-transparent border-0 border-b border-transparent hover:border-slate-200 focus:border-brand-400 focus:bg-white px-1 py-0.5 rounded text-xs font-semibold text-slate-900 outline-none transition" />
                      {!tracksStock && <span className="shrink-0 text-[8px] font-bold text-purple-600 whitespace-nowrap">Service</span>}
                    </div>
                  </td>
                  {showCol('internal_ref') && (
                    <td className="px-2 py-1.5">
                      <span className="text-xs font-mono text-slate-500 truncate block" title={a.internal_ref || ''}>{a.internal_ref || '—'}</span>
                    </td>
                  )}
                  {showCol('oem_ref') && (
                    <td className="px-2 py-1.5">
                      <span className="text-xs font-mono text-slate-500 truncate block" title={a.oem_ref || ''}>{a.oem_ref || '—'}</span>
                    </td>
                  )}
                  {showCol('category') && (
                    <td className="px-2 py-1.5">
                      <button onClick={() => { setCatPickArticle(a.id); setCatPickOpen(true); }}
                        className="w-full text-left bg-transparent border-0 border-b border-transparent hover:border-slate-200 px-0.5 py-0.5 rounded text-xs text-slate-600 outline-none transition truncate">
                        {(() => { const cid = getVal(a, 'category_id'); const cat = categories.find(c => c.id === cid); return cat ? cat.name : '—'; })()}
                      </button>
                    </td>
                  )}
                  {showCol('brand') && (
                    <td className="px-2 py-1.5">
                      <input value={getVal(a, 'brand' as any) || ''} onChange={e => onUpdateEdit(a.id, 'brand', e.target.value)}
                        className="w-full bg-transparent border-0 border-b border-transparent hover:border-slate-200 focus:border-brand-400 focus:bg-white px-1 py-0.5 rounded text-xs text-slate-600 outline-none transition" />
                    </td>
                  )}
                  {showCol('barcode') && (
                    <td className="px-2 py-1.5">
                      <input value={getVal(a, 'barcode' as any) || ''} onChange={e => onUpdateEdit(a.id, 'barcode', e.target.value)}
                        className="w-full bg-transparent border-0 border-b border-transparent hover:border-slate-200 focus:border-brand-400 focus:bg-white px-1 py-0.5 rounded text-xs font-mono text-slate-600 outline-none transition" />
                    </td>
                  )}
                  {showCol('unit') && (
                    <td className="px-2 py-1.5">
                      <input value={getVal(a, 'unit' as any) || ''} onChange={e => onUpdateEdit(a.id, 'unit', e.target.value)}
                        className="w-full bg-transparent border-0 border-b border-transparent hover:border-slate-200 focus:border-brand-400 focus:bg-white px-1 py-0.5 rounded text-xs text-slate-600 outline-none transition" />
                    </td>
                  )}
                  {showCol('sale_price') && (
                    <td className="px-2 py-1.5">
                      <input type="number" value={getVal(a, 'sale_price') || ''} onChange={e => onUpdateEdit(a.id, 'sale_price', e.target.value)}
                        className="w-full bg-transparent border-0 border-b border-transparent hover:border-slate-200 focus:border-brand-400 focus:bg-white px-1 py-0.5 rounded text-xs font-bold text-right text-slate-900 num outline-none transition" min="0" />
                    </td>
                  )}
                  {showCol('purchase_price') && (
                    <td className="px-2 py-1.5">
                      <input type="number" value={getVal(a, 'purchase_price') || ''} onChange={e => onUpdateEdit(a.id, 'purchase_price', e.target.value)}
                        className="w-full bg-transparent border-0 border-b border-transparent hover:border-slate-200 focus:border-brand-400 focus:bg-white px-1 py-0.5 rounded text-xs font-bold text-right text-slate-900 num outline-none transition" min="0" />
                    </td>
                  )}
                  {showCol('stock') && (
                    <td className="px-2 py-1.5 text-right">
                      {tracksStock ? (
                        <span className={`text-[10px] font-bold num ${mStatus.badge}`}>{qty}</span>
                      ) : (
                        <span className="text-[9px] font-semibold text-purple-500">—</span>
                      )}
                    </td>
                  )}
                  <td className="px-2 py-1.5 text-center">
                    <div className="inline-flex gap-0.5 opacity-60 group-hover:opacity-100">
                      <button onClick={() => onOpenFullScreen(a)} className="p-1 rounded-lg hover:bg-brand-100 text-slate-600 hover:text-brand-700" title="Modifier"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => onDelete(a)} className="p-1 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600" title="Supprimer"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <CategoryPickerModal
        open={catPickOpen}
        onClose={() => setCatPickOpen(false)}
        categories={categories}
        selected={catPickArticle ? (getVal(articles.find(a => a.id === catPickArticle)!, 'category_id') || '') : ''}
        onSelect={(id) => { if (catPickArticle) onUpdateEdit(catPickArticle, 'category_id', id); setCatPickOpen(false); }}
      />
    </div>
  );
}

// ── FullScreenArticleEdit ──────────────────────────────────

export function FullScreenArticleEdit({ form, setForm, editing, tab, setTab, TABS: _TABS, save, saving, compats, setCompats, categories, suppliers, brands, models, autoMode, generateRef, addCompat, removeCompat, createCategory, imagePreview, imageUploading, onFileSelect, onDeleteImage, marginValue, marginStr, showPurchasePrice, showMargin, stockMap, formTiers, setFormTiers, tierDefinitions, onClose, onPrev, onNext, editingIndex, totalCount, filtered, onJumpTo }: {
  form: Form; setForm: (f: Form | ((p: Form) => Form)) => void;
  editing: Article | null; tab: TabKey; setTab: (t: TabKey) => void;
  TABS: { k: TabKey; l: string; icon: any }[];
  save: () => Promise<boolean>; saving: boolean;
  compats: Compat[]; setCompats: (c: Compat[] | ((p: Compat[]) => Compat[])) => void;
  categories: Category[]; suppliers: any[]; brands: VehicleBrand[]; models: any[];
  autoMode: boolean; generateRef: () => void; addCompat: () => void; removeCompat: (i: number) => void;
  createCategory?: (name: string, parentId: string | null) => Promise<string | null>;
  imagePreview: string | null; imageUploading: boolean;
  onFileSelect: (f: File) => void; onDeleteImage: () => void;
  marginValue: number; marginStr: string;
  showPurchasePrice: boolean; showMargin: boolean;
  stockMap: Record<string, number>;
  formTiers: Array<{ tier_name: string; price: number | '' }>;
  setFormTiers: (t: Array<{ tier_name: string; price: number | '' }>) => void;
  tierDefinitions: TierDefinition[];
  onClose: () => void;
  onPrev?: () => void; onNext?: () => void;
  editingIndex: number; totalCount: number;
  filtered: Article[]; onJumpTo: (a: Article) => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [localSearch, setLocalSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const searchResults = useMemo(() => {
    if (!localSearch.trim()) return [];
    const q = localSearch.toLowerCase();
    return filtered.filter(a => a.name.toLowerCase().includes(q) || a.internal_ref.toLowerCase().includes(q)).slice(0, 8);
  }, [localSearch, filtered]);

  const BLOCKS: { key: TabKey; label: string; icon: any }[] = [
    { key: 'infos', label: 'Informations générales', icon: Info },
    { key: 'prix', label: 'Prix et tarifs', icon: Tags },
    { key: 'stock', label: 'Stock', icon: Boxes },
    ...(autoMode ? [{ key: 'compat' as TabKey, label: 'Compatibilité véhicules', icon: Car }] : []),
    { key: 'image', label: 'Image', icon: Camera },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col animate-fade-in">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 lg:px-6 py-3 border-b border-neutral-200 bg-white shrink-0">
        <button onClick={onClose} className="p-2 text-neutral-900 hover:opacity-70 transition-opacity">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
            {editing ? 'Modification' : 'Nouvel article'}{totalCount > 0 && ` — ${editingIndex + 1}/${totalCount}`}
          </div>
          <h2 className="text-base font-bold text-neutral-900 break-words leading-tight">{form.name || 'Sans titre'}</h2>
        </div>

        {/* Search button */}
        <div className="relative">
          <button onClick={() => { setSearchOpen(!searchOpen); setLocalSearch(''); }} className="p-2 text-neutral-500 hover:text-neutral-900 transition-colors">
            <Search className="w-5 h-5" />
          </button>
          {searchOpen && (
            <div className="absolute top-full right-0 mt-1 w-72 bg-white rounded-xl shadow-premium border border-neutral-200 z-50 overflow-hidden">
              <div className="px-3 py-2 border-b border-neutral-100">
                <input ref={searchRef} autoFocus value={localSearch} onChange={e => setLocalSearch(e.target.value)} placeholder="Rechercher un article…" className="w-full text-sm outline-none" />
              </div>
              {searchResults.length > 0 && (
                <div className="max-h-48 overflow-y-auto">
                  {searchResults.map(a => (
                    <button key={a.id} onClick={() => { onJumpTo(a); setSearchOpen(false); setLocalSearch(''); }} className="w-full text-left px-3 py-2 hover:bg-neutral-50 text-sm">
                      <div className="font-semibold text-neutral-900 truncate">{a.name}</div>
                      <div className="text-[10px] text-neutral-400 font-mono">{a.internal_ref}</div>
                    </button>
                  ))}
                </div>
              )}
              {localSearch && searchResults.length === 0 && <div className="px-3 py-3 text-xs text-neutral-400 text-center">Aucun résultat</div>}
            </div>
          )}
        </div>

        {/* Prev/Next */}
        <div className="flex items-center gap-1">
          <button onClick={onPrev} disabled={!onPrev} className="p-2 text-neutral-500 hover:text-neutral-900 disabled:opacity-30 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button onClick={onNext} disabled={!onNext} className="p-2 text-neutral-500 hover:text-neutral-900 disabled:opacity-30 transition-colors">
            <ArrowRightIcon className="w-4 h-4" />
          </button>
        </div>

        <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 text-sm font-bold text-neutral-900 hover:opacity-70 disabled:opacity-50 transition-opacity">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          Enregistrer
        </button>
      </div>

      {/* Body: sidebar + content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar nav */}
        <div className="w-56 shrink-0 py-4 px-3 overflow-y-auto hidden lg:block">
          <nav className="space-y-1">
            {BLOCKS.map(b => {
              const Icon = b.icon;
              const active = tab === b.key;
              return (
                <button key={b.key} onClick={() => setTab(b.key)} className={`w-full text-left flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium transition-colors ${active ? 'text-neutral-900' : 'text-neutral-400 hover:text-neutral-900'}`}>
                  <Icon className={`w-4 h-4 ${active ? 'text-neutral-900' : 'text-neutral-300'}`} />
                  {b.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto px-6 lg:px-10 py-6">
          <div className="max-w-2xl mx-auto space-y-6">
            {/* Mobile tab bar */}
            <div className="lg:hidden overflow-x-auto no-scrollbar">
              <div className="inline-flex items-center gap-1">
                {BLOCKS.map(b => {
                  const Icon = b.icon;
                  return (
                    <button key={b.key} onClick={() => setTab(b.key)} className={`shrink-0 inline-flex items-center gap-1.5 px-3 h-9 text-xs font-semibold whitespace-nowrap transition-colors ${tab === b.key ? 'text-neutral-900' : 'text-neutral-400'}`}>
                      <Icon className="w-3.5 h-3.5" />{b.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {tab === 'infos' && <InfosTab form={form} setForm={setForm} editing={!!editing} categories={categories} suppliers={suppliers} onGenerateRef={generateRef} autoMode={autoMode} createCategory={createCategory} />}
            {tab === 'prix' && <PrixTab form={form} setForm={setForm} marginValue={marginValue} marginStr={marginStr} showPurchasePrice={showPurchasePrice} showMargin={showMargin} formTiers={formTiers} setFormTiers={setFormTiers} tierDefinitions={tierDefinitions} />}
            {tab === 'stock' && <StockTab form={form} setForm={setForm} editing={!!editing} currentArticle={editing} stockMap={stockMap} />}
            {tab === 'compat' && autoMode && <CompatTab compats={compats} brands={brands} models={models} onAdd={addCompat} onRemove={removeCompat} onUpdate={(i, patch) => setCompats((arr: Compat[]) => arr.map((x, j) => j === i ? { ...x, ...patch } : x))} />}
            {tab === 'image' && <ImageTab currentUrl={imagePreview} uploading={imageUploading} onFileSelect={onFileSelect} onDelete={onDeleteImage} />}
          </div>
        </div>
      </div>
    </div>
  );
}
