import { useState, useRef, useMemo, useEffect, useId, ReactNode } from 'react';
import { Package, Trash2, X, Plus, Search, ChevronDown, ChevronUp, ChevronRight, CheckSquare, Square, Pencil, ArrowRight, Camera, Loader2, ArrowLeft, ArrowRight as ArrowRightIcon, Info, Tags, Boxes, Car, CheckCircle2, Percent, Settings2, Eye, EyeOff } from 'lucide-react';
import { formatFCFA } from '../lib/format';
import type { Article, Category, VehicleBrand } from '../lib/types';
import { DocPanel, Modal } from '../components/Modal';
import { PageSearch } from '../components/PageSearch';
import './ArticleCatalog.css';
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

export function Field({ label, inputId, children, hint, className = '' }: { label: string; inputId?: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <div className={className}>
      {inputId ? <label className="label mb-1 text-xs font-semibold" htmlFor={inputId}>{label}</label>
        : <span className="label mb-1 text-xs font-semibold">{label}</span>}
      {children}
      {hint && <p className="text-[11px] text-[var(--w-text-sec)] mt-1">{hint}</p>}
    </div>
  );
}

export function PremiumSelect({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string; bold?: boolean }[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [highlighted, setHighlighted] = useState(-1);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => { if (open) setHighlighted(-1); }, [open]);

  const allOptions = placeholder ? [{ value: '', label: placeholder }, ...options] : options;
  const selected = allOptions.find(o => o.value === value);
  const label = selected?.label || placeholder || '— Choisir —';

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (open && highlighted >= 0) { onChange(allOptions[highlighted].value); setOpen(false); } else setOpen(true); }
    else if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); else setHighlighted(i => Math.min(i + 1, allOptions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(i => Math.max(i - 1, 0)); }
  };

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)} onKeyDown={handleKey} aria-expanded={open}
        className={`article-select
          ${!value && placeholder ? 'text-[var(--w-text-muted)]' : 'text-[var(--w-text)]'}`}>
        <span className="min-w-0 break-words">{label}</span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-[var(--w-text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="article-popover absolute z-50 left-0 right-0 top-full mt-1 max-h-60 overflow-y-auto py-1">
          {allOptions.map((o, i) => (
            <button key={o.value} type="button"
              onMouseEnter={() => setHighlighted(i)}
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors
                ${o.bold ? 'font-semibold' : ''}
                ${o.value === value ? 'bg-[var(--w-active)] font-semibold' : 'text-[var(--w-text)]'}
                ${i === highlighted ? 'bg-[var(--w-hover)]' : 'hover:bg-[var(--w-hover)]'}`}>
              {o.label}
            </button>
          ))}
        </div>
      )}
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
      className="w-input-ul article-input num"
      min="0"
    />
    </>
  );
}

// ── ArticleCard (mobile) ───────────────────────────────────

export function ArticleCard({ article, category, qty, onEdit, selectionMode, selected, onToggleSelect, showStock }: {
  article: Article; category?: Category; qty: number;
  onEdit: () => void; onDelete: () => void;
  selectionMode: boolean; selected: boolean; onToggleSelect: () => void;
  showMargin: boolean; showStock: boolean;
}) {
  const reference = article.oem_ref || article.internal_ref;
  return (
    <button type="button" className="article-list-item" aria-pressed={selectionMode ? selected : undefined}
      onClick={selectionMode ? onToggleSelect : onEdit}>
      {selectionMode && (selected ? <CheckSquare size={17} aria-hidden="true" /> : <Square size={17} aria-hidden="true" />)}
      <span className="article-list-item-main">
        <strong>{article.name}</strong>
        {(reference || category) && <span className="article-muted">{[reference, category?.name].filter(Boolean).join(' │ ')}</span>}
        {showStock && article.track_stock !== false && <span className="article-muted">Stock <span className="num">{qty}</span></span>}
      </span>
      <strong className="num article-money">{formatFCFA(article.sale_price)}</strong>
    </button>
  );
}

// ── MasterCatalogGuide ─────────────────────────────────────

export function MasterCatalogGuide({ step, articleCount: _articleCount, onStep, onDismiss, onGo }: {
  step: number; articleCount: number; onStep: (s: number) => void; onDismiss: () => void; onGo: () => void;
}) {
  const steps = [
    { title: 'Ajouter des articles', detail: 'Créez un article ou reprenez ses références dans le catalogue maître.' },
    { title: 'Choisir dans le catalogue maître', detail: 'Sélectionnez les références utiles puis vérifiez les prix après l’import.' },
    { title: 'Importer depuis Excel', detail: 'Téléchargez le modèle depuis le bouton Excel puis importez votre fichier rempli.' },
  ];
  const current = steps[step];

  return (
    <aside className="article-guide">
      <div>
        <h2>{current.title}</h2>
        <p>{current.detail}</p>
      </div>
      <button type="button" onClick={onDismiss} className="waarwi-window-button" aria-label="Masquer le guide">
        <X size={16} aria-hidden="true" />
      </button>
      <button type="button" onClick={step < steps.length - 1 ? () => onStep(step + 1) : onGo} className="btn-ghost article-button">
        {step < steps.length - 1 ? 'Suivant' : 'Ouvrir le catalogue maître'} <ArrowRight size={14} aria-hidden="true" />
      </button>
    </aside>
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
  const formId = useId();
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatParent, setNewCatParent] = useState('');
  const [creatingCat, setCreatingCat] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setExpanded(new Set());
    setShowNewCat(false);
    setNewCatName('');
    setNewCatParent('');
  }, [open]);

  const parents = useMemo(() => categories.filter(category => !category.parent_id), [categories]);
  const childMap = useMemo(() => {
    const result = new Map<string, Category[]>();
    for (const category of categories) {
      if (!category.parent_id) continue;
      const siblings = result.get(category.parent_id) ?? [];
      siblings.push(category);
      result.set(category.parent_id, siblings);
    }
    return result;
  }, [categories]);
  const query = search.trim().toLocaleLowerCase('fr');
  const results = query ? parents.flatMap(parent => {
    const parentMatches = parent.name.toLocaleLowerCase('fr').includes(query);
    return [
      ...(parentMatches ? [{ category: parent, parentName: '' }] : []),
      ...(childMap.get(parent.id) ?? [])
        .filter(child => parentMatches || child.name.toLocaleLowerCase('fr').includes(query))
        .map(child => ({ category: child, parentName: parent.name })),
    ];
  }) : [];
  const toggleExpand = (id: string) => setExpanded(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const submitNewCategory = async () => {
    if (!newCatName.trim() || !createCategory || creatingCat) return;
    setCreatingCat(true);
    try {
      const id = await createCategory(newCatName.trim(), newCatParent || null);
      if (id) {
        onSelect(id);
        setShowNewCat(false);
        setNewCatName('');
        setNewCatParent('');
      }
    } finally {
      setCreatingCat(false);
    }
  };
  const close = () => {
    if (creatingCat) return;
    if (showNewCat) setShowNewCat(false);
    else onClose();
  };

  return (
    <Modal open={open} onClose={close} title={showNewCat ? 'Nouvelle catégorie' : 'Catégories'}
      size="sm" layer="top" variant="flat" focusOnOpen
      footer={showNewCat ? <>
        <button type="button" onClick={close} disabled={creatingCat} className="btn-secondary article-button"><X size={15} aria-hidden="true" />Annuler</button>
        <button type="submit" form={formId} disabled={!newCatName.trim() || creatingCat} className="btn-primary article-button">
          {creatingCat ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
          Créer
        </button>
      </> : createCategory ? <button type="button" onClick={() => setShowNewCat(true)} className="btn-primary article-button"><Plus size={15} aria-hidden="true" />Nouvelle catégorie</button> : undefined}
    >
      {showNewCat ? (
        <form id={formId} className="space-y-3 flat-form" onSubmit={event => { event.preventDefault(); void submitNewCategory(); }}>
          <label>
            <span className="label">Nom de la catégorie</span>
            <input required value={newCatName} onChange={event => setNewCatName(event.target.value)} className="input text-sm" />
          </label>
          <label className="block">
            <span className="label">Catégorie parente</span>
            <select value={newCatParent} onChange={event => setNewCatParent(event.target.value)} className="input text-sm">
              <option value="">Aucune</option>
              {parents.map(parent => <option key={parent.id} value={parent.id}>{parent.name}</option>)}
            </select>
          </label>
        </form>
      ) : (
        <div className="space-y-2">
          <PageSearch value={search} onChange={setSearch} placeholder="Rechercher une catégorie…" />
          {query ? (
            results.length ? results.map(({ category, parentName }) => (
              <button key={category.id} type="button" className="article-category-row" aria-pressed={selected === category.id} onClick={() => onSelect(category.id)}>
                <span>{category.name}{parentName && <small>{parentName}</small>}</span>
                {selected === category.id && <CheckCircle2 size={15} aria-hidden="true" />}
              </button>
            )) : <p className="article-muted py-3">Aucune catégorie trouvée.</p>
          ) : (
            <>
              <button type="button" className="article-category-row" aria-pressed={!selected} onClick={() => onSelect('')}>
                <span>Toutes les catégories</span>{!selected && <CheckCircle2 size={15} aria-hidden="true" />}
              </button>
              {parents.map(parent => {
                const children = childMap.get(parent.id) ?? [];
                const isOpen = expanded.has(parent.id);
                return (
                  <div key={parent.id}>
                    <div className="article-category-parent">
                      {children.length > 0 && <button type="button" className="waarwi-window-button" aria-expanded={isOpen}
                        aria-label={`${isOpen ? 'Replier' : 'Déplier'} ${parent.name}`} onClick={() => toggleExpand(parent.id)}>
                        <ChevronRight size={15} className={isOpen ? 'rotate-90' : ''} aria-hidden="true" />
                      </button>}
                      <button type="button" className="article-category-row" aria-pressed={selected === parent.id} onClick={() => onSelect(parent.id)}>
                        <span>{parent.name}</span>{selected === parent.id && <CheckCircle2 size={15} aria-hidden="true" />}
                      </button>
                    </div>
                    {isOpen && <div className="article-category-children">{children.map(child => (
                      <button key={child.id} type="button" className="article-category-row" aria-pressed={selected === child.id} onClick={() => onSelect(child.id)}>
                        <span>{child.name}</span>{selected === child.id && <CheckCircle2 size={15} aria-hidden="true" />}
                      </button>
                    ))}</div>}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

// ── InfosTab ───────────────────────────────────────────────

export function InfosTab({ form, setForm, editing, categories, onGenerateRef, autoMode, createCategory }: {
  form: Form; setForm: (f: Form | ((p: Form) => Form)) => void;
  editing: boolean; categories: Category[]; suppliers: any[];
  onGenerateRef: () => void; autoMode: boolean;
  createCategory?: (name: string, parentId: string | null) => Promise<string | null>;
}) {
  const [catPickerOpen, setCatPickerOpen] = useState(false);
  const prefix = useId();

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
        <Field label="Désignation *" inputId={prefix + '-name'} className="sm:col-span-2">
          <input id={prefix + '-name'} data-field="designation" value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="w-input-ul article-input" placeholder="Nom de l'article" autoFocus={!form.name} />
        </Field>
        <Field label="Référence interne *" inputId={prefix + '-ref'}>
          <div className="flex gap-2">
            <input id={prefix + '-ref'} value={form.internal_ref || ''} onChange={e => setForm(f => ({ ...f, internal_ref: e.target.value }))} className="w-input-ul article-input min-w-0 flex-1 font-mono" placeholder="REF-0001" />
            {!editing && <button type="button" onClick={onGenerateRef} className="btn-secondary article-button shrink-0">Générer</button>}
          </div>
        </Field>
        <Field label="Catégorie">
          <button type="button" onClick={() => setCatPickerOpen(true)}
            className="article-select" aria-haspopup="dialog">
            <span className={selectedCatLabel ? '' : 'article-muted'}>{selectedCatLabel || 'Choisir une catégorie'}</span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
        </Field>
        {autoMode && (
          <Field label="Marque" inputId={prefix + '-brand'}>
            <input id={prefix + '-brand'} value={form.brand || ''} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} className="w-input-ul article-input" placeholder="Marque" />
          </Field>
        )}
        <Field label="Réf. OEM" inputId={prefix + '-oem'}>
          <input id={prefix + '-oem'} value={form.oem_ref || ''} onChange={e => setForm(f => ({ ...f, oem_ref: e.target.value }))} className="w-input-ul article-input font-mono" placeholder="Référence fabricant" />
        </Field>
        <Field label="Code-barres" inputId={prefix + '-barcode'}>
          <input id={prefix + '-barcode'} value={form.barcode || ''} onChange={e => setForm(f => ({ ...f, barcode: e.target.value }))} className="w-input-ul article-input font-mono" placeholder="EAN / UPC" />
        </Field>
        <Field label="Unité">
          <PremiumSelect value={form.unit || 'pièce'} onChange={v => setForm(f => ({ ...f, unit: v }))}
            options={[{ value: 'unité', label: 'Unité' }, { value: 'pièce', label: 'Pièce' }, { value: 'paire', label: 'Paire' }, { value: 'lot', label: 'Lot' }, { value: 'kg', label: 'Kilogramme' }, { value: 'litre', label: 'Litre' }, { value: 'mètre', label: 'Mètre' }]} />
        </Field>
        <Field label="Description" inputId={prefix + '-description'} className="sm:col-span-2">
          <textarea id={prefix + '-description'} value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="w-textarea-ul" placeholder="Description optionnelle" />
        </Field>
      </div>

      <CategoryPickerModal
        open={catPickerOpen}
        onClose={() => setCatPickerOpen(false)}
        categories={categories}
        selected={form.category_id ?? undefined}
        onSelect={value => { handleCategoryChange(value); setCatPickerOpen(false); }}
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
  const mgTone = marginValue >= 30 ? 'text-emerald-700' : marginValue >= 15 ? 'text-amber-700' : 'text-[var(--w-error)]';

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {showPurchasePrice && (
          <Field label="Prix d'achat (FCFA)">
            <PriceInput value={form.purchase_price} onChange={v => setForm(f => ({ ...f, purchase_price: v === '' ? 0 : v }))} placeholder="Prix d'achat" />
          </Field>
        )}
        <Field label="Prix de vente détail HT (FCFA)">
          <PriceInput value={form.sale_price} onChange={v => setForm(f => ({ ...f, sale_price: v === '' ? 0 : v }))} placeholder="Prix de vente" />
        </Field>
        <Field label="TVA (%)">
          <PriceInput value={form.vat_rate} onChange={v => setForm(f => ({ ...f, vat_rate: v === '' ? 0 : v }))} placeholder="Taux TVA" />
        </Field>
      </div>

      {showMargin && form.sale_price !== undefined && Number(form.sale_price) > 0 && (
        <div className={`flex items-center gap-1.5 text-xs font-bold ${mgTone}`}>
          <Percent className="w-3.5 h-3.5" aria-hidden="true" />
          Marge <span className="num">{marginStr}%</span>
        </div>
      )}

      {/* Pricing tiers */}
      {tierDefinitions.length > 0 && (
        <div className="article-separator space-y-2">
          <h3 className="text-sm font-semibold">Catégories tarifaires</h3>
          <div className="space-y-2">
            {formTiers.map((tier, idx) => (
              <label key={tier.tier_name} className="grid grid-cols-2 items-center gap-2">
                <span className="text-xs font-semibold break-words">{tier.tier_name}</span>
                <PriceInput value={tier.price} onChange={v => {
                  const updated = [...formTiers];
                  updated[idx] = { ...updated[idx], price: v };
                  setFormTiers(updated);
                }} placeholder="Prix" />
              </label>
            ))}
          </div>
          <p className="article-muted">Seuls les tarifs renseignés sont proposés lors de la vente.</p>
        </div>
      )}

      {isPharmacy && (
        <label className="article-check-row">
          <input type="checkbox" checked={form.ipm_eligible !== false} onChange={event => {
            const checked = event.target.checked;
            setForm(previous => ({ ...previous, ipm_eligible: checked }));
          }} />
          <span><strong>Éligible à l’IPM</strong><span className="article-muted block">Article pris en charge par les conventions IPM</span></span>
        </label>
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
      <label className="article-check-row">
        <input type="checkbox" checked={trackStock} onChange={event => {
          const checked = event.target.checked;
          setForm(previous => ({ ...previous, track_stock: checked }));
        }} />
        <span><strong>Suivre le stock</strong><span className="article-muted block">
          {trackStock ? 'Les ventes et mouvements affectent le stock.' : 'La vente est possible sans contrainte de quantité.'}
        </span></span>
      </label>

      {trackStock && (
        <>
          {editing && currentArticle && mStatus && (
            <div className="flex items-center gap-2 py-1">
              <Package className={`w-4 h-4 ${mStatus.icon} shrink-0`} />
              <div>
                <div className="text-sm font-semibold">Stock actuel <span className="num">{currentQty}</span> {form.unit || 'unité(s)'}</div>
                <div className={`text-[10px] font-semibold ${mStatus.icon}`}>{mStatus.label}</div>
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Stock minimum (alerte)">
              <input type="number" value={form.stock_min || ''} onChange={e => setForm(f => ({ ...f, stock_min: Number(e.target.value) }))} className="w-input-ul article-input num" min="0" placeholder="0" />
            </Field>
            <Field label="Stock maximum">
              <input type="number" value={form.stock_max || ''} onChange={e => setForm(f => ({ ...f, stock_max: Number(e.target.value) }))} className="w-input-ul article-input num" min="0" placeholder="0" />
            </Field>
            <Field label="Emplacement">
              <input value={form.location || ''} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} className="w-input-ul article-input" placeholder="Rayon / Étagère" />
            </Field>
            {!editing && (
              <Field label="Stock initial">
                <input type="number" value={form.stock_init || ''} onChange={e => setForm(f => ({ ...f, stock_init: Number(e.target.value) }))} className="w-input-ul article-input num" min="0" placeholder="0" />
              </Field>
            )}
          </div>
        </>
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
      <div className="article-editor-tools">
        <h3 className="text-sm font-semibold">Véhicules compatibles</h3>
        <button type="button" onClick={onAdd} className="btn-secondary article-button">
          <Plus size={15} aria-hidden="true" />Ajouter un véhicule
        </button>
      </div>
      {compats.length === 0 && <p className="article-muted">Aucun véhicule associé.</p>}
      {compats.map((c, i) => (
        <div key={i} className="article-separator space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <PremiumSelect value={c.brand_id} onChange={v => onUpdate(i, { brand_id: v, model_id: '' })} placeholder="Marque"
              options={brands.map(b => ({ value: b.id, label: b.name }))} />
            <PremiumSelect value={c.model_id} onChange={v => onUpdate(i, { model_id: v })} placeholder="Modèle"
              options={models.filter(m => m.brand_id === c.brand_id).map(m => ({ value: m.id, label: m.name }))} />
            <input type="number" value={c.year_start || ''} onChange={e => onUpdate(i, { year_start: Number(e.target.value) })} className="w-input-ul article-input num" placeholder="Année début" />
            <input type="number" value={c.year_end || ''} onChange={e => onUpdate(i, { year_end: Number(e.target.value) })} className="w-input-ul article-input num" placeholder="Année fin" />
          </div>
          <input value={c.notes || ''} onChange={e => onUpdate(i, { notes: e.target.value })} className="w-input-ul article-input" placeholder="Notes (motorisation, variante...)" />
          <button type="button" onClick={() => onRemove(i)} className="btn-ghost article-button" aria-label={`Retirer le véhicule ${i + 1}`}><Trash2 size={15} aria-hidden="true" />Retirer</button>
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
  const fileInputId = useId();
  return (
    <div className="space-y-4">
      {currentUrl ? (
        <div className="space-y-2">
          <img src={currentUrl} alt="Image de l’article" className="article-image-preview" />
          <button type="button" onClick={onDelete} className="btn-secondary article-button">
            <Trash2 size={15} aria-hidden="true" />Supprimer l’image
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <label htmlFor={fileInputId} className="label">Ajouter une image</label>
          <input id={fileInputId} type="file" accept="image/*" className="article-file-input" disabled={uploading} aria-describedby={fileInputId + '-hint'}
            onChange={event => { const file = event.target.files?.[0]; if (file) onFileSelect(file); }} />
          <p id={fileInputId + '-hint'} className="article-muted">JPG, PNG │ 5 Mo maximum</p>
        </div>
      )}
      {uploading && (
        <div className="article-status-line" role="status">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />Téléversement en cours…
        </div>
      )}
    </div>
  );
}

// ── MobileArticleEdit (swipe-based, native-feel modal) ─────

export function MobileArticleEdit({ form, setForm, editing, tab, setTab, save, saveAndNew, saveAndClose: saveAndCloseIntent, saving, switchingArticle, saveState, formMode, compats, setCompats, categories, suppliers, brands, models, autoMode, generateRef, addCompat, removeCompat, createCategory, imagePreview, imageUploading, onFileSelect, onDeleteImage, marginValue, marginStr, showPurchasePrice, showMargin, stockMap, formTiers, setFormTiers, tierDefinitions, isPharmacy, onClose, onPrev, onNext, editingIndex, totalCount }: {
  form: Form; setForm: (f: Form | ((p: Form) => Form)) => void;
  editing: Article | null; tab: TabKey; setTab: (t: TabKey) => void;
  save: () => Promise<boolean>; saveAndNew: () => Promise<void>; saveAndClose: () => Promise<void>;
  saving: boolean; switchingArticle: boolean; saveState?: string; formMode?: string;
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
  const BLOCKS: { key: TabKey; label: string; icon: typeof Info }[] = [
    { key: 'infos', label: 'Infos', icon: Info },
    { key: 'prix', label: 'Prix', icon: Tags },
    { key: 'stock', label: 'Stock', icon: Boxes },
    ...(autoMode ? [{ key: 'compat' as TabKey, label: 'Véhicules', icon: Car }] : []),
    { key: 'image', label: 'Image', icon: Camera },
  ];
  const tabKeys = BLOCKS.map(b => b.key);
  const activeIdx = Math.max(0, tabKeys.indexOf(tab));


  // Swipe gesture state
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [dragX, setDragX] = useState(0);

  const goToTab = (next: TabKey) => {
    setDragX(0);
    setTab(next);
  };

  const goDelta = (delta: number) => {
    const nextIdx = activeIdx + delta;
    if (nextIdx < 0 || nextIdx >= tabKeys.length) return;
    goToTab(tabKeys[nextIdx]);
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
    <Modal open onClose={onClose} title={form.name || 'Nouvel article'} size="xl" fullscreenMobile
      panelClassName="article-editor" footer={
        formMode === 'create' ? <>
          <button type="button" onClick={saveAndNew} disabled={saving || switchingArticle} className="btn-secondary article-button"><Plus size={15} aria-hidden="true" />Enregistrer et nouveau</button>
          <button type="button" onClick={saveAndCloseIntent} disabled={saving || switchingArticle} className="btn-primary article-button">
            {saving ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={15} aria-hidden="true" />}
            Enregistrer et fermer
          </button>
        </> : <button type="button" onClick={save} disabled={saving || switchingArticle} className="btn-primary article-button">
          {saving ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={15} aria-hidden="true" />}
          Enregistrer
        </button>
      }
    >
      {(editing || saveState === 'saving' || saveState === 'saved' || saveState === 'error') && (
        <div className="article-editor-tools">
          <span className="article-muted" role="status">
            {switchingArticle && !saving ? 'Chargement de la fiche…' : saveState === 'saving' ? 'Enregistrement…' : saveState === 'saved' ? 'Enregistré' : saveState === 'error' ? 'Échec de l’enregistrement' : ''}
          </span>
          {editing && totalCount > 0 && (
            <div className="article-toolbar">
              <button type="button" onClick={onPrev} disabled={!onPrev} aria-label="Article précédent" className="waarwi-window-button"><ArrowLeft size={16} aria-hidden="true" /></button>
              {editingIndex >= 0 && <span className="num article-muted">{editingIndex + 1} / {totalCount}</span>}
              <button type="button" onClick={onNext} disabled={!onNext} aria-label="Article suivant" className="waarwi-window-button"><ArrowRightIcon size={16} aria-hidden="true" /></button>
            </div>
          )}
        </div>
      )}
      <nav className="article-tabs" aria-label="Fiche article">
        {BLOCKS.map((block, index) => (
          <button key={block.key} type="button" aria-pressed={index === activeIdx} onClick={() => goToTab(block.key)}>
            <block.icon size={15} aria-hidden="true" />{block.label}
          </button>
        ))}
      </nav>
      <div className="article-edit-body touch-pan-y"
        style={{ transform: dragX ? `translateX(${dragX * 0.35}px)` : undefined, transition: dragX ? 'none' : 'transform 0.24s cubic-bezier(0.22,1,0.36,1)' }}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        <fieldset key={tab} disabled={switchingArticle} className="min-w-0" aria-busy={switchingArticle}>
          {tab === 'infos' && <InfosTab form={form} setForm={setForm} editing={!!editing} categories={categories} suppliers={suppliers} onGenerateRef={generateRef} autoMode={autoMode} createCategory={createCategory} />}
          {tab === 'prix' && <PrixTab form={form} setForm={setForm} marginValue={marginValue} marginStr={marginStr} showPurchasePrice={showPurchasePrice} showMargin={showMargin} formTiers={formTiers} setFormTiers={setFormTiers} tierDefinitions={tierDefinitions} isPharmacy={isPharmacy} />}
          {tab === 'stock' && <StockTab form={form} setForm={setForm} editing={!!editing} currentArticle={editing} stockMap={stockMap} />}
          {tab === 'compat' && autoMode && <CompatTab compats={compats} brands={brands} models={models} onAdd={addCompat} onRemove={removeCompat} onUpdate={(i, patch) => setCompats((arr: Compat[]) => arr.map((x, j) => j === i ? { ...x, ...patch } : x))} />}
          {tab === 'image' && <ImageTab currentUrl={imagePreview} uploading={imageUploading} onFileSelect={onFileSelect} onDelete={onDeleteImage} />}
        </fieldset>
      </div>
    </Modal>
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
      <button type="button" onClick={() => setOpen(value => !value)} className="waarwi-window-button" aria-label="Colonnes visibles" aria-expanded={open}>
        <Settings2 className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="article-popover absolute right-0 top-full mt-1 w-44 py-1.5 z-50">
          {ALL_OPTIONAL_COLUMNS.map(col => (
            <button type="button" key={col.key} onClick={() => onToggle(col.key)} aria-pressed={visible.has(col.key)} className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--w-hover)]">
              {visible.has(col.key) ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
              <span className={`text-xs ${visible.has(col.key) ? 'font-medium' : 'text-[var(--w-text-sec)]'}`}>{col.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function DesktopListView({ articles, categoryMap: _categoryMap, stockMap, categories, listEdits, onUpdateEdit, selectionMode, selectedIds, onToggleSelect, onSelectAll, allSelected, onOpenFullScreen, onDelete, showMargin: _showMargin, showStock, showPurchase: _showPurchase, sortCol, sortDir, onSort }: {
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


  const SortIcon = ({ col }: { col: string }) => {
    if (!onSort) return null;
    if (sortCol === col) return sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-brand-600" /> : <ChevronDown className="w-3 h-3 text-brand-600" />;
    return <ChevronDown className="w-3 h-3 opacity-30" />;
  };

  const showCol = (k: ColumnKey) => visibleCols.has(k) && (k !== 'stock' || showStock) && (k !== 'purchase_price' || _showPurchase);

  return (
    <div className="border-y border-[var(--w-separator)]">
      <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 300px)' }}>
        <table className="w-full text-xs">
          <thead className="bg-[var(--w-surface-el)] text-[11px] text-[var(--w-text-sec)] border-b border-[var(--w-separator)] sticky top-0 z-10">
            <tr>
              {selectionMode && (
                <th className="px-2 py-2.5 w-8 bg-[var(--w-surface-el)]">
                  <button onClick={onSelectAll} className="text-brand-700">{allSelected ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}</button>
                </th>
              )}
              <th className="px-2 py-2.5 text-left font-semibold min-w-[280px] bg-[var(--w-surface-el)] cursor-pointer select-none hover:text-brand-700 transition-colors" onClick={() => onSort?.('name')}>
                <span className="inline-flex items-center gap-1">Désignation <SortIcon col="name" /></span>
              </th>
              {showCol('internal_ref') && (
                <th className="px-2 py-2.5 text-left font-semibold min-w-[110px] bg-[var(--w-surface-el)] cursor-pointer select-none hover:text-brand-700 transition-colors" onClick={() => onSort?.('ref')}>
                  <span className="inline-flex items-center gap-1">Réf. interne <SortIcon col="ref" /></span>
                </th>
              )}
              {showCol('oem_ref') && (
                <th className="px-2 py-2.5 text-left font-semibold min-w-[110px] bg-[var(--w-surface-el)] cursor-pointer select-none hover:text-brand-700 transition-colors" onClick={() => onSort?.('oem_ref')}>
                  <span className="inline-flex items-center gap-1">Réf. OEM <SortIcon col="oem_ref" /></span>
                </th>
              )}
              {showCol('category') && (
                <th className="px-2 py-2.5 text-left font-semibold min-w-[120px] bg-[var(--w-surface-el)] cursor-pointer select-none hover:text-brand-700 transition-colors" onClick={() => onSort?.('category')}>
                  <span className="inline-flex items-center gap-1">Catégorie <SortIcon col="category" /></span>
                </th>
              )}
              {showCol('brand') && (
                <th className="px-2 py-2.5 text-left font-semibold min-w-[100px] bg-[var(--w-surface-el)]">
                  <span className="inline-flex items-center gap-1">Marque</span>
                </th>
              )}
              {showCol('barcode') && (
                <th className="px-2 py-2.5 text-left font-semibold min-w-[120px] bg-[var(--w-surface-el)]">
                  <span className="inline-flex items-center gap-1">Code barre</span>
                </th>
              )}
              {showCol('unit') && (
                <th className="px-2 py-2.5 text-left font-semibold min-w-[70px] bg-[var(--w-surface-el)]">
                  <span className="inline-flex items-center gap-1">Unité</span>
                </th>
              )}
              {showCol('sale_price') && (
                <th className="px-2 py-2.5 text-right font-semibold min-w-[90px] bg-[var(--w-surface-el)] cursor-pointer select-none hover:text-brand-700 transition-colors" onClick={() => onSort?.('price')}>
                  <span className="inline-flex items-center gap-1 justify-end">Prix de vente <SortIcon col="price" /></span>
                </th>
              )}
              {showCol('purchase_price') && (
                <th className="px-2 py-2.5 text-right font-semibold min-w-[90px] bg-[var(--w-surface-el)] cursor-pointer select-none hover:text-brand-700 transition-colors" onClick={() => onSort?.('purchase_price')}>
                  <span className="inline-flex items-center gap-1 justify-end">Prix d'achat <SortIcon col="purchase_price" /></span>
                </th>
              )}
              {showCol('stock') && (
                <th className="px-2 py-2.5 text-right font-semibold min-w-[50px] bg-[var(--w-surface-el)] cursor-pointer select-none hover:text-brand-700 transition-colors" onClick={() => onSort?.('stock')}>
                  <span className="inline-flex items-center gap-1 justify-end">Stock <SortIcon col="stock" /></span>
                </th>
              )}
              <th className="px-2 py-2.5 text-center font-semibold w-20 bg-[var(--w-surface-el)]">
                <div className="inline-flex items-center gap-1">
                  <span>Actions</span>
                  <ColumnSettingsDropdown visible={visibleCols} onToggle={toggleCol} />
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--w-separator-l)]">
            {articles.map(a => {
              const edited = listEdits.has(a.id);
              const qty = stockMap[a.id] || 0;
              const tracksStock = (a as any).track_stock !== false;
              const mStatus = tracksStock ? stockStatus(qty, Number(a.stock_min || 0)) : { badge: 'text-slate-400', dot: 'bg-slate-300', label: 'Service' };
              return (
                <tr key={a.id} className={edited || selectedIds.has(a.id) ? 'bg-[var(--w-active)]' : 'hover:bg-[var(--w-hover)]'}>
                  {selectionMode && (
                    <td className="px-2 py-1.5">
                      <button onClick={() => onToggleSelect(a.id)} className="text-brand-700">{selectedIds.has(a.id) ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5 text-slate-400" />}</button>
                    </td>
                  )}
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <input value={getVal(a, 'name') || ''} onChange={e => onUpdateEdit(a.id, 'name', e.target.value)}
                        title={getVal(a, 'name') || ''}
                        className="w-input-ul flex-1 min-w-0 text-xs font-semibold text-slate-900" />
                      {!tracksStock && <span className="shrink-0 text-[8px] font-bold text-[var(--w-text-muted)] whitespace-nowrap">Service</span>}
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
                        className="w-input-ul text-left px-0.5 py-0.5 text-xs truncate">
                        {(() => { const cid = getVal(a, 'category_id'); const cat = categories.find(c => c.id === cid); return cat ? cat.name : '—'; })()}
                      </button>
                    </td>
                  )}
                  {showCol('brand') && (
                    <td className="px-2 py-1.5">
                      <input value={getVal(a, 'brand' as any) || ''} onChange={e => onUpdateEdit(a.id, 'brand', e.target.value)}
                        className="w-input-ul w-full text-xs text-slate-600" />
                    </td>
                  )}
                  {showCol('barcode') && (
                    <td className="px-2 py-1.5">
                      <input value={getVal(a, 'barcode' as any) || ''} onChange={e => onUpdateEdit(a.id, 'barcode', e.target.value)}
                        className="w-input-ul w-full text-xs font-mono text-slate-600" />
                    </td>
                  )}
                  {showCol('unit') && (
                    <td className="px-2 py-1.5">
                      <input value={getVal(a, 'unit' as any) || ''} onChange={e => onUpdateEdit(a.id, 'unit', e.target.value)}
                        className="w-input-ul w-full text-xs text-slate-600" />
                    </td>
                  )}
                  {showCol('sale_price') && (
                    <td className="px-2 py-1.5">
                      <input type="number" value={getVal(a, 'sale_price') || ''} onChange={e => onUpdateEdit(a.id, 'sale_price', e.target.value)}
                        className="w-input-ul w-full text-xs font-bold text-right text-slate-900 num" min="0" />
                    </td>
                  )}
                  {showCol('purchase_price') && (
                    <td className="px-2 py-1.5">
                      <input type="number" value={getVal(a, 'purchase_price') || ''} onChange={e => onUpdateEdit(a.id, 'purchase_price', e.target.value)}
                        className="w-input-ul w-full text-xs font-bold text-right text-slate-900 num" min="0" />
                    </td>
                  )}
                  {showCol('stock') && (
                    <td className="px-2 py-1.5 text-right">
                      {tracksStock ? (
                        <span className={`text-[10px] font-bold num ${mStatus.badge}`}>{qty}</span>
                      ) : (
                        <span className="text-[9px] font-semibold text-[var(--w-text-muted)]">—</span>
                      )}
                    </td>
                  )}
                  <td className="px-2 py-1.5 text-center">
                    <div className="inline-flex gap-1">
                      <button type="button" onClick={() => onOpenFullScreen(a)} className="waarwi-window-button" aria-label={`Modifier ${a.name}`}><Pencil size={14} aria-hidden="true" /></button>
                      <button type="button" onClick={() => onDelete(a)} className="waarwi-window-button article-error-text" aria-label={`Supprimer ${a.name}`}><Trash2 size={14} aria-hidden="true" /></button>
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

export function FullScreenArticleEdit({ form, setForm, editing, tab, setTab, TABS: _TABS, save, saveAndNew, saveAndClose: saveAndCloseIntent, saving, switchingArticle, saveState, formMode, compats, setCompats, categories, suppliers, brands, models, autoMode, generateRef, addCompat, removeCompat, createCategory, imagePreview, imageUploading, onFileSelect, onDeleteImage, marginValue, marginStr, showPurchasePrice, showMargin, stockMap, formTiers, setFormTiers, tierDefinitions, isPharmacy, onClose, onPrev, onNext, editingIndex, totalCount, filtered, onJumpTo }: {
  form: Form; setForm: (f: Form | ((p: Form) => Form)) => void;
  editing: Article | null; tab: TabKey; setTab: (t: TabKey) => void;
  TABS: { k: TabKey; l: string; icon: any }[];
  save: () => Promise<boolean>; saveAndNew: () => Promise<void>; saveAndClose: () => Promise<void>;
  saving: boolean; switchingArticle: boolean; saveState?: string; formMode?: string;
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
  filtered: Article[]; onJumpTo: (a: Article) => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [localSearch, setLocalSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const searchResults = useMemo(() => {
    if (!localSearch.trim()) return [];
    const q = localSearch.toLowerCase();
    return filtered.filter(a => a.name.toLowerCase().includes(q) || a.internal_ref?.toLowerCase().includes(q)).slice(0, 8);
  }, [localSearch, filtered]);

  const BLOCKS: { key: TabKey; label: string; icon: typeof Info }[] = [
    { key: 'infos', label: 'Informations générales', icon: Info },
    { key: 'prix', label: 'Prix et tarifs', icon: Tags },
    { key: 'stock', label: 'Stock', icon: Boxes },
    ...(autoMode ? [{ key: 'compat' as TabKey, label: 'Compatibilité véhicules', icon: Car }] : []),
    { key: 'image', label: 'Image', icon: Camera },
  ];

  const isCreate = formMode === 'create';

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (saving || switchingArticle) return;
        if (e.shiftKey) { saveAndCloseIntent(); }
        else if (isCreate) { saveAndNew(); }
        else { save(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isCreate, save, saveAndNew, saveAndCloseIntent, saving, switchingArticle]);

  const saveStateLabel = switchingArticle && !saving ? 'Chargement de la fiche…'
    : saveState === 'saving' ? 'Enregistrement…'
    : saveState === 'saved' ? 'Enregistré'
    : saveState === 'dirty' ? 'Modifications en cours…'
    : saveState === 'error' ? 'Échec'
    : null;

  return (
    <DocPanel open onClose={onClose} title={form.name || 'Nouvel article'} fullscreen fullscreenMobile
      footer={isCreate ? <>
        <button type="button" onClick={saveAndNew} disabled={saving || switchingArticle} className="btn-secondary article-button" title="Ctrl+Entrée">
          <Plus size={15} aria-hidden="true" />Enregistrer et nouveau
        </button>
        <button type="button" onClick={saveAndCloseIntent} disabled={saving || switchingArticle} className="btn-primary article-button" title="Ctrl+Maj+Entrée">
          {saving ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={15} aria-hidden="true" />}
          Enregistrer et fermer
        </button>
      </> : (
        <button type="button" onClick={save} disabled={saving || switchingArticle} className="btn-primary article-button">
          {saving ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={15} aria-hidden="true" />}
          Enregistrer
        </button>
      )}>
      <div className="article-edit-desktop">
        <div className="article-editor-tools">
          <span className="article-muted" role="status">{saveStateLabel}</span>
          <div className="article-toolbar">
            <button type="button" disabled={switchingArticle || saving} onClick={() => { setSearchOpen(!searchOpen); setLocalSearch(''); }} className="btn-secondary article-button" aria-expanded={searchOpen}>
              <Search size={15} aria-hidden="true" />Rechercher
            </button>
            {!isCreate && <>
              <button type="button" onClick={onPrev} disabled={!onPrev} aria-label="Article précédent" className="waarwi-window-button"><ArrowLeft size={16} aria-hidden="true" /></button>
              {editingIndex >= 0 && <span className="num article-muted">{editingIndex + 1} / {totalCount}</span>}
              <button type="button" onClick={onNext} disabled={!onNext} aria-label="Article suivant" className="waarwi-window-button"><ArrowRightIcon size={16} aria-hidden="true" /></button>
            </>}
          </div>
        </div>
        {searchOpen && (
          <div className="article-search-list">
            <input ref={searchRef} autoFocus aria-label="Rechercher un article" value={localSearch} onChange={event => setLocalSearch(event.target.value)}
              placeholder="Rechercher un article…" className="w-input-ul" />
            {searchResults.map(article => (
              <button key={article.id} type="button" onClick={() => { onJumpTo(article); setSearchOpen(false); setLocalSearch(''); }} className="article-category-row">
                <span>{article.name}<small>{article.internal_ref}</small></span>
              </button>
            ))}
            {localSearch && !searchResults.length && <p className="article-muted py-2">Aucun article trouvé.</p>}
          </div>
        )}
        <nav className="article-tabs" aria-label="Fiche article">
          {BLOCKS.map(({ key, label, icon: Icon }) => (
            <button type="button" key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>
              <Icon size={15} aria-hidden="true" />{label}
            </button>
          ))}
        </nav>
        <fieldset className="article-edit-body min-w-0" disabled={switchingArticle} aria-busy={switchingArticle}>
          {tab === 'infos' && <InfosTab form={form} setForm={setForm} editing={!!editing} categories={categories} suppliers={suppliers} onGenerateRef={generateRef} autoMode={autoMode} createCategory={createCategory} />}
          {tab === 'prix' && <PrixTab form={form} setForm={setForm} marginValue={marginValue} marginStr={marginStr} showPurchasePrice={showPurchasePrice} showMargin={showMargin} formTiers={formTiers} setFormTiers={setFormTiers} tierDefinitions={tierDefinitions} isPharmacy={isPharmacy} />}
          {tab === 'stock' && <StockTab form={form} setForm={setForm} editing={!!editing} currentArticle={editing} stockMap={stockMap} />}
          {tab === 'compat' && autoMode && <CompatTab compats={compats} brands={brands} models={models} onAdd={addCompat} onRemove={removeCompat} onUpdate={(i, patch) => setCompats((arr: Compat[]) => arr.map((x, j) => j === i ? { ...x, ...patch } : x))} />}
          {tab === 'image' && <ImageTab currentUrl={imagePreview} uploading={imageUploading} onFileSelect={onFileSelect} onDelete={onDeleteImage} />}
        </fieldset>
      </div>
    </DocPanel>
  );
}
