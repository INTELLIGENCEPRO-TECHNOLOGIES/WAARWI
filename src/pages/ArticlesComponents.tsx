import { useState, useRef, useMemo, ReactNode } from 'react';
import { Package, Trash2, X, Plus, Search, ChevronDown, ChevronRight, Tag, Barcode, Hash, MapPin, CheckSquare, Square, CreditCard as Edit2, Lightbulb, MousePointerClick, ArrowRight, Library, Upload, Camera, Loader2, ArrowLeft, ArrowRight as ArrowRightIcon, Save, Info, DollarSign, Boxes, Car, Image as ImageIcon, CheckCircle2, AlertTriangle, AlertCircle, Percent, Layers } from 'lucide-react';
import { formatFCFA } from '../lib/format';
import type { Article, Category, VehicleBrand } from '../lib/types';

type PricingTier = { id: string; article_id: string; tier_name: string; price: number; sort_order: number };
type TierDefinition = { id: string; tier_name: string; sort_order: number; is_default: boolean };
type Form = Partial<Article> & { stock_init?: number };
type Compat = { id?: string; brand_id: string; model_id: string; year_start: number; year_end: number; notes: string };
type TabKey = 'infos' | 'prix' | 'stock' | 'compat' | 'image';

// ── Utilities ──────────────────────────────────────────────

export function stockStatus(qty: number, min: number) {
  if (qty === 0) return { bg: 'bg-red-50', icon: 'text-red-500', badge: 'bg-red-50 text-red-700', dot: 'bg-red-500', label: 'Rupture' };
  if (qty <= min) return { bg: 'bg-amber-50', icon: 'text-amber-500', badge: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500', label: 'Stock bas' };
  return { bg: 'bg-emerald-50', icon: 'text-emerald-500', badge: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500', label: 'En stock' };
}

// ── Field & Form Primitives ────────────────────────────────

export function Field({ label, children, hint, className = '' }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-slate-400 mt-1">{hint}</p>}
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
      <select value={value} onChange={e => onChange(e.target.value)} className="premium-input appearance-none pr-8 text-sm">
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
    </div>
  );
}

export function PriceInput({ value, onChange, placeholder }: { value: number | '' | undefined; onChange: (v: number | '') => void; placeholder?: string }) {
  const displayVal = value === 0 || value === undefined ? '' : value;
  return (
    <input
      type="number"
      value={displayVal}
      onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      placeholder={placeholder || '0'}
      className="premium-input text-sm num"
      min="0"
    />
  );
}

// ── ArticleCard (mobile) ───────────────────────────────────

export function ArticleCard({ article, category, qty, onEdit, onDelete, selectionMode, selected, onToggleSelect, showMargin, showStock }: {
  article: Article; category?: Category; qty: number;
  onEdit: () => void; onDelete: () => void;
  selectionMode: boolean; selected: boolean; onToggleSelect: () => void;
  showMargin: boolean; showStock: boolean;
}) {
  const mStatus = stockStatus(qty, Number(article.stock_min || 0));
  const margin = article.sale_price > 0 ? ((article.sale_price - article.purchase_price) / article.sale_price) * 100 : 0;

  return (
    <div className={`rounded-2xl bg-white shadow-card border transition-all active:scale-[0.99] ${selected ? 'border-brand-400 bg-brand-50/40 ring-2 ring-brand-500/20' : 'border-slate-100 hover:shadow-premium'}`}
      onClick={selectionMode ? onToggleSelect : onEdit}>
      <div className="p-3 flex items-center gap-3">
        {selectionMode && (
          <span className="shrink-0 text-brand-700">{selected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-slate-400" />}</span>
        )}
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${mStatus.bg}`}>
          {article.image_url ? <img src={article.image_url} className="w-10 h-10 rounded-xl object-cover" alt="" /> : <Package className={`w-5 h-5 ${mStatus.icon}`} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-slate-900 truncate">{article.name}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] font-mono text-slate-500">{article.internal_ref}</span>
            {category && <span className="text-[10px] text-slate-400">• {category.name}</span>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-bold text-sm text-slate-900 num">{formatFCFA(article.sale_price)}</div>
          {showStock && (
            <div className={`inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${mStatus.badge}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${mStatus.dot}`} />{qty}
            </div>
          )}
        </div>
        {!selectionMode && (
          <button onClick={e => { e.stopPropagation(); onDelete(); }} className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
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
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white rounded-t-3xl sm:rounded-3xl shadow-premium max-h-[70vh] flex flex-col animate-sheet-up">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-slate-900">Filtrer par catégorie</h3>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-500"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <button onClick={() => onChange('')} className={`w-full text-left px-4 py-3 rounded-xl text-sm font-semibold transition-all ${!value ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'text-slate-700 hover:bg-slate-50'}`}>
            Toutes les catégories
          </button>
          {parents.map(c => (
            <div key={c.id}>
              <button onClick={() => onChange(c.id)} className={`w-full text-left px-4 py-3 rounded-xl text-sm font-semibold transition-all ${value === c.id ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'text-slate-700 hover:bg-slate-50'}`}>
                {c.name}
              </button>
              {categories.filter(s => s.parent_id === c.id).map(s => (
                <button key={s.id} onClick={() => onChange(s.id)} className={`w-full text-left pl-8 pr-4 py-2.5 rounded-xl text-sm transition-all ${value === s.id ? 'bg-brand-50 text-brand-700 border border-brand-200 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}>
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

export function MasterCatalogGuide({ step, articleCount, onStep, onDismiss, onGo }: {
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
    <div className="relative rounded-2xl border border-brand-100 bg-gradient-to-br from-white via-brand-50/30 to-white shadow-card p-4 animate-fade-in">
      <button onClick={onDismiss} className="absolute top-3 right-3 p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"><X className="w-4 h-4" /></button>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center shrink-0"><Icon className="w-5 h-5 text-brand-700" /></div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-bold text-slate-900">{s.title}</h4>
          <p className="text-xs text-slate-600 mt-0.5">{s.desc}</p>
          <div className="flex items-center gap-2 mt-3">
            {steps.map((_, i) => <span key={i} className={`w-2 h-2 rounded-full transition-all ${i === step ? 'bg-brand-600 w-5' : 'bg-slate-200'}`} />)}
            <div className="flex-1" />
            {step < steps.length - 1 ? (
              <button onClick={() => onStep(step + 1)} className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold text-brand-700 hover:bg-brand-50 rounded-lg">
                Suivant <ArrowRight className="w-3 h-3" />
              </button>
            ) : (
              <button onClick={onGo} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold bg-brand-600 text-white rounded-lg shadow-sm">
                Voir le catalogue maître <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── InfosTab ───────────────────────────────────────────────

export function InfosTab({ form, setForm, editing, categories, suppliers, onGenerateRef, autoMode }: {
  form: Form; setForm: (f: Form | ((p: Form) => Form)) => void;
  editing: boolean; categories: Category[]; suppliers: any[];
  onGenerateRef: () => void; autoMode: boolean;
}) {
  const parents = categories.filter(c => !c.parent_id);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Désignation *" className="sm:col-span-2">
          <input value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="premium-input text-sm" placeholder="Nom de l'article" />
        </Field>
        <Field label="Référence interne *">
          <div className="flex gap-2">
            <input value={form.internal_ref || ''} onChange={e => setForm(f => ({ ...f, internal_ref: e.target.value }))} className="premium-input text-sm flex-1 font-mono" placeholder="REF-0001" />
            {!editing && <button type="button" onClick={onGenerateRef} className="px-3 rounded-xl bg-slate-100 text-xs font-semibold text-slate-600 hover:bg-slate-200 shrink-0">Auto</button>}
          </div>
        </Field>
        <Field label="Catégorie">
          <PremiumSelect value={form.category_id || ''} onChange={v => setForm(f => ({ ...f, category_id: v }))} placeholder="Choisir"
            options={parents.flatMap(c => [{ value: c.id, label: c.name, bold: true }, ...categories.filter(s => s.parent_id === c.id).map(s => ({ value: s.id, label: `  ↳ ${s.name}` }))])} />
        </Field>
        {autoMode && (
          <Field label="Marque">
            <input value={form.brand || ''} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} className="premium-input text-sm" placeholder="Marque" />
          </Field>
        )}
        <Field label="Réf. OEM">
          <input value={form.oem_ref || ''} onChange={e => setForm(f => ({ ...f, oem_ref: e.target.value }))} className="premium-input text-sm font-mono" placeholder="Référence fabricant" />
        </Field>
        <Field label="Réf. fournisseur">
          <input value={form.supplier_ref || ''} onChange={e => setForm(f => ({ ...f, supplier_ref: e.target.value }))} className="premium-input text-sm font-mono" placeholder="Référence fournisseur" />
        </Field>
        <Field label="Code-barres">
          <input value={form.barcode || ''} onChange={e => setForm(f => ({ ...f, barcode: e.target.value }))} className="premium-input text-sm font-mono" placeholder="EAN / UPC" />
        </Field>
        <Field label="Fournisseur">
          <PremiumSelect value={form.supplier_id || ''} onChange={v => setForm(f => ({ ...f, supplier_id: v }))} placeholder="Aucun"
            options={suppliers.map(s => ({ value: s.id, label: s.name }))} />
        </Field>
        <Field label="État">
          <PremiumSelect value={form.condition || 'neuf'} onChange={v => setForm(f => ({ ...f, condition: v }))}
            options={[{ value: 'neuf', label: 'Neuf' }, { value: 'occasion', label: 'Occasion' }, { value: 'reconditionne', label: 'Reconditionné' }]} />
        </Field>
        <Field label="Unité">
          <PremiumSelect value={form.unit || 'pièce'} onChange={v => setForm(f => ({ ...f, unit: v }))}
            options={[{ value: 'unité', label: 'Unité' }, { value: 'pièce', label: 'Pièce' }, { value: 'paire', label: 'Paire' }, { value: 'lot', label: 'Lot' }, { value: 'kg', label: 'Kilogramme' }, { value: 'litre', label: 'Litre' }, { value: 'mètre', label: 'Mètre' }]} />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <textarea value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="premium-input text-sm resize-none" placeholder="Description optionnelle" />
        </Field>
      </div>
    </div>
  );
}

// ── PrixTab ────────────────────────────────────────────────

export function PrixTab({ form, setForm, marginValue, marginStr, showPurchasePrice, showMargin, formTiers, setFormTiers, tierDefinitions }: {
  form: Form; setForm: (f: Form | ((p: Form) => Form)) => void;
  marginValue: number; marginStr: string;
  showPurchasePrice: boolean; showMargin: boolean;
  formTiers: Array<{ tier_name: string; price: number | '' }>;
  setFormTiers: (t: Array<{ tier_name: string; price: number | '' }>) => void;
  tierDefinitions: TierDefinition[];
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
        <Field label="Prix minimum (FCFA)">
          <PriceInput value={form.min_price} onChange={v => setForm(f => ({ ...f, min_price: v === '' ? 0 : v }))} placeholder="Prix plancher" />
        </Field>
        <Field label="Prix grossiste (FCFA)">
          <PriceInput value={form.wholesale_price} onChange={v => setForm(f => ({ ...f, wholesale_price: v === '' ? 0 : v }))} placeholder="Prix de gros" />
        </Field>
        <Field label="TVA (%)">
          <PriceInput value={form.vat_rate} onChange={v => setForm(f => ({ ...f, vat_rate: v === '' ? 0 : v }))} placeholder="Taux TVA" />
        </Field>
      </div>

      {showMargin && form.sale_price !== undefined && Number(form.sale_price) > 0 && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold ${mgTone}`}>
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
    </div>
  );
}

// ── StockTab ───────────────────────────────────────────────

export function StockTab({ form, setForm, editing, currentArticle, stockMap }: {
  form: Form; setForm: (f: Form | ((p: Form) => Form)) => void;
  editing: boolean; currentArticle: Article | null; stockMap: Record<string, number>;
}) {
  const currentQty = currentArticle ? (stockMap[currentArticle.id] || 0) : 0;
  const mStatus = currentArticle ? stockStatus(currentQty, Number(form.stock_min || 0)) : null;

  return (
    <div className="space-y-4">
      {editing && currentArticle && mStatus && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl ${mStatus.bg}`}>
          <div className={`w-10 h-10 rounded-xl bg-white/60 flex items-center justify-center`}>
            <Package className={`w-5 h-5 ${mStatus.icon}`} />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-900">Stock actuel : <span className="num">{currentQty}</span> {form.unit || 'unité(s)'}</div>
            <div className={`text-[10px] font-semibold ${mStatus.icon}`}>{mStatus.label}</div>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Stock minimum (alerte)">
          <input type="number" value={form.stock_min || ''} onChange={e => setForm(f => ({ ...f, stock_min: Number(e.target.value) }))} className="premium-input text-sm num" min="0" placeholder="0" />
        </Field>
        <Field label="Stock maximum">
          <input type="number" value={form.stock_max || ''} onChange={e => setForm(f => ({ ...f, stock_max: Number(e.target.value) }))} className="premium-input text-sm num" min="0" placeholder="0" />
        </Field>
        <Field label="Emplacement">
          <input value={form.location || ''} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} className="premium-input text-sm" placeholder="Rayon / Étagère" />
        </Field>
        {!editing && (
          <Field label="Stock initial">
            <input type="number" value={form.stock_init || ''} onChange={e => setForm(f => ({ ...f, stock_init: Number(e.target.value) }))} className="premium-input text-sm num" min="0" placeholder="0" />
          </Field>
        )}
      </div>
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
        <div key={i} className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-500 uppercase">Compatibilité {i + 1}</span>
            <button onClick={() => onRemove(i)} className="p-1 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <PremiumSelect value={c.brand_id} onChange={v => onUpdate(i, { brand_id: v, model_id: '' })} placeholder="Marque"
              options={brands.map(b => ({ value: b.id, label: b.name }))} />
            <PremiumSelect value={c.model_id} onChange={v => onUpdate(i, { model_id: v })} placeholder="Modèle"
              options={models.filter(m => m.brand_id === c.brand_id).map(m => ({ value: m.id, label: m.name }))} />
            <input type="number" value={c.year_start || ''} onChange={e => onUpdate(i, { year_start: Number(e.target.value) })} className="premium-input text-xs num" placeholder="Année début" />
            <input type="number" value={c.year_end || ''} onChange={e => onUpdate(i, { year_end: Number(e.target.value) })} className="premium-input text-xs num" placeholder="Année fin" />
          </div>
          <input value={c.notes || ''} onChange={e => onUpdate(i, { notes: e.target.value })} className="premium-input text-xs" placeholder="Notes (motorisation, variante...)" />
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
          <img src={currentUrl} alt="Article" className="w-full max-h-64 object-contain rounded-xl border border-slate-200 bg-slate-50" />
          <button onClick={onDelete} className="absolute top-2 right-2 p-2 rounded-xl bg-red-600 text-white shadow-lg hover:bg-red-700">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <label className="flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed border-slate-300 rounded-2xl cursor-pointer hover:border-brand-400 hover:bg-brand-50/30 transition">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
            <Camera className="w-6 h-6 text-slate-400" />
          </div>
          <div className="text-center">
            <div className="text-sm font-semibold text-slate-700">Ajouter une image</div>
            <div className="text-[11px] text-slate-400 mt-0.5">JPG, PNG — max 5 Mo</div>
          </div>
          <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFileSelect(f); }} />
        </label>
      )}
      {uploading && (
        <div className="flex items-center gap-2 text-xs text-brand-700">
          <Loader2 className="w-4 h-4 animate-spin" />Téléversement en cours…
        </div>
      )}
    </div>
  );
}

// ── DesktopListView (inline-editable table) ────────────────

export function DesktopListView({ articles, categoryMap, stockMap, suppliers, categories, listEdits, onUpdateEdit, selectionMode, selectedIds, onToggleSelect, onSelectAll, allSelected, onOpenFullScreen, onDelete, showMargin, showStock, showPurchase }: {
  articles: Article[]; categoryMap: Map<string, Category>; stockMap: Record<string, number>;
  suppliers: any[]; categories: Category[];
  listEdits: Map<string, Partial<Article>>; onUpdateEdit: (id: string, field: string, value: any) => void;
  selectionMode: boolean; selectedIds: Set<string>; onToggleSelect: (id: string) => void;
  onSelectAll: () => void; allSelected: boolean;
  onOpenFullScreen: (a: Article) => void; onDelete: (a: Article) => void;
  showMargin: boolean; showStock: boolean; showPurchase: boolean;
}) {
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

  return (
    <div className="rounded-2xl bg-white shadow-card border border-slate-100 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50/70 text-[9px] uppercase text-slate-500 tracking-wider border-b border-slate-100">
            <tr>
              {selectionMode && (
                <th className="px-2 py-2.5 w-8">
                  <button onClick={onSelectAll} className="text-brand-700">{allSelected ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}</button>
                </th>
              )}
              <th className="px-2 py-2.5 text-left font-semibold min-w-[160px]">Désignation</th>
              <th className="px-2 py-2.5 text-left font-semibold min-w-[100px]">Référence</th>
              <th className="px-2 py-2.5 text-left font-semibold min-w-[120px]">Catégorie</th>
              <th className="px-2 py-2.5 text-right font-semibold min-w-[90px]">Prix détail</th>
              <th className="px-2 py-2.5 text-right font-semibold min-w-[90px]">Prix gros</th>
              <th className="px-2 py-2.5 text-right font-semibold min-w-[60px]">Stk min</th>
              <th className="px-2 py-2.5 text-left font-semibold min-w-[70px]">Unité</th>
              <th className="px-2 py-2.5 text-left font-semibold min-w-[100px]">Fournisseur</th>
              {showStock && <th className="px-2 py-2.5 text-right font-semibold min-w-[50px]">Stock</th>}
              <th className="px-2 py-2.5 text-center font-semibold w-16">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {articles.map(a => {
              const edited = listEdits.has(a.id);
              const qty = stockMap[a.id] || 0;
              const mStatus = stockStatus(qty, Number(a.stock_min || 0));
              return (
                <tr key={a.id} className={`group transition-colors ${edited ? 'bg-brand-50/40' : 'hover:bg-slate-50/60'} ${selectedIds.has(a.id) ? 'bg-brand-50/60' : ''}`}>
                  {selectionMode && (
                    <td className="px-2 py-1.5">
                      <button onClick={() => onToggleSelect(a.id)} className="text-brand-700">{selectedIds.has(a.id) ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5 text-slate-400" />}</button>
                    </td>
                  )}
                  <td className="px-2 py-1.5">
                    <input value={getVal(a, 'name') || ''} onChange={e => onUpdateEdit(a.id, 'name', e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-transparent hover:border-slate-200 focus:border-brand-400 focus:bg-white px-1 py-0.5 rounded text-xs font-semibold text-slate-900 outline-none transition" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input value={getVal(a, 'internal_ref') || ''} onChange={e => onUpdateEdit(a.id, 'internal_ref', e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-transparent hover:border-slate-200 focus:border-brand-400 focus:bg-white px-1 py-0.5 rounded text-xs font-mono text-slate-600 outline-none transition" />
                  </td>
                  <td className="px-2 py-1.5">
                    <select value={getVal(a, 'category_id') || ''} onChange={e => onUpdateEdit(a.id, 'category_id', e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-transparent hover:border-slate-200 focus:border-brand-400 focus:bg-white px-0.5 py-0.5 rounded text-xs text-slate-600 outline-none transition appearance-none">
                      <option value="">—</option>
                      {categoryOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" value={getVal(a, 'sale_price') || ''} onChange={e => onUpdateEdit(a.id, 'sale_price', e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-transparent hover:border-slate-200 focus:border-brand-400 focus:bg-white px-1 py-0.5 rounded text-xs font-bold text-right text-slate-900 num outline-none transition" min="0" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" value={getVal(a, 'wholesale_price') || ''} onChange={e => onUpdateEdit(a.id, 'wholesale_price', e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-transparent hover:border-slate-200 focus:border-brand-400 focus:bg-white px-1 py-0.5 rounded text-xs text-right text-slate-600 num outline-none transition" min="0" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" value={getVal(a, 'stock_min') || ''} onChange={e => onUpdateEdit(a.id, 'stock_min', e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-transparent hover:border-slate-200 focus:border-brand-400 focus:bg-white px-1 py-0.5 rounded text-xs text-right text-slate-600 num outline-none transition" min="0" />
                  </td>
                  <td className="px-2 py-1.5">
                    <select value={getVal(a, 'unit') || 'pièce'} onChange={e => onUpdateEdit(a.id, 'unit', e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-transparent hover:border-slate-200 focus:border-brand-400 focus:bg-white px-0.5 py-0.5 rounded text-xs text-slate-600 outline-none transition appearance-none">
                      <option value="unité">Unité</option>
                      <option value="pièce">Pièce</option>
                      <option value="paire">Paire</option>
                      <option value="lot">Lot</option>
                      <option value="kg">Kg</option>
                      <option value="litre">Litre</option>
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <select value={getVal(a, 'supplier_id') || ''} onChange={e => onUpdateEdit(a.id, 'supplier_id', e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-transparent hover:border-slate-200 focus:border-brand-400 focus:bg-white px-0.5 py-0.5 rounded text-xs text-slate-600 outline-none transition appearance-none">
                      <option value="">—</option>
                      {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </td>
                  {showStock && (
                    <td className="px-2 py-1.5 text-right">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold num ${mStatus.badge}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${mStatus.dot}`} />{qty}
                      </span>
                    </td>
                  )}
                  <td className="px-2 py-1.5 text-center">
                    <div className="inline-flex gap-0.5 opacity-60 group-hover:opacity-100">
                      <button onClick={() => onOpenFullScreen(a)} className="p-1 rounded-lg hover:bg-brand-100 text-slate-600 hover:text-brand-700" title="Modifier"><Edit2 className="w-3.5 h-3.5" /></button>
                      <button onClick={() => onDelete(a)} className="p-1 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600" title="Supprimer"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── FullScreenArticleEdit ──────────────────────────────────

export function FullScreenArticleEdit({ form, setForm, editing, tab, setTab, TABS, save, saving, compats, setCompats, categories, suppliers, brands, models, autoMode, generateRef, addCompat, removeCompat, imagePreview, imageUploading, onFileSelect, onDeleteImage, marginValue, marginStr, showPurchasePrice, showMargin, stockMap, formTiers, setFormTiers, tierDefinitions, onClose, onPrev, onNext, editingIndex, totalCount, filtered, onJumpTo }: {
  form: Form; setForm: (f: Form | ((p: Form) => Form)) => void;
  editing: Article | null; tab: TabKey; setTab: (t: TabKey) => void;
  TABS: { k: TabKey; l: string; icon: any }[];
  save: () => Promise<void>; saving: boolean;
  compats: Compat[]; setCompats: (c: Compat[] | ((p: Compat[]) => Compat[])) => void;
  categories: Category[]; suppliers: any[]; brands: VehicleBrand[]; models: any[];
  autoMode: boolean; generateRef: () => void; addCompat: () => void; removeCompat: (i: number) => void;
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
    { key: 'prix', label: 'Prix et tarifs', icon: DollarSign },
    { key: 'stock', label: 'Stock', icon: Boxes },
    ...(autoMode ? [{ key: 'compat' as TabKey, label: 'Compatibilité véhicules', icon: Car }] : []),
    { key: 'image', label: 'Image', icon: Camera },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col animate-fade-in">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 lg:px-6 py-3 border-b border-slate-200 bg-white shrink-0">
        <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-brand-700/80">
            {editing ? 'Modification' : 'Nouvel article'} — {editingIndex + 1}/{totalCount}
          </div>
          <h2 className="text-base font-bold text-slate-900 truncate">{form.name || 'Sans titre'}</h2>
        </div>

        {/* Search button */}
        <div className="relative">
          <button onClick={() => { setSearchOpen(!searchOpen); setLocalSearch(''); }} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500">
            <Search className="w-5 h-5" />
          </button>
          {searchOpen && (
            <div className="absolute top-full right-0 mt-1 w-72 bg-white rounded-xl shadow-premium border border-slate-200 z-50 overflow-hidden">
              <div className="px-3 py-2 border-b border-slate-100">
                <input ref={searchRef} autoFocus value={localSearch} onChange={e => setLocalSearch(e.target.value)} placeholder="Rechercher un article…" className="w-full text-sm outline-none" />
              </div>
              {searchResults.length > 0 && (
                <div className="max-h-48 overflow-y-auto">
                  {searchResults.map(a => (
                    <button key={a.id} onClick={() => { onJumpTo(a); setSearchOpen(false); setLocalSearch(''); }} className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm">
                      <div className="font-semibold text-slate-900 truncate">{a.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{a.internal_ref}</div>
                    </button>
                  ))}
                </div>
              )}
              {localSearch && searchResults.length === 0 && <div className="px-3 py-3 text-xs text-slate-400 text-center">Aucun résultat</div>}
            </div>
          )}
        </div>

        {/* Prev/Next */}
        <div className="flex items-center gap-1">
          <button onClick={onPrev} disabled={!onPrev} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 disabled:opacity-30">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button onClick={onNext} disabled={!onNext} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 disabled:opacity-30">
            <ArrowRightIcon className="w-4 h-4" />
          </button>
        </div>

        <button onClick={save} disabled={saving} className="px-5 py-2.5 rounded-xl bg-gradient-to-br from-brand-600 to-brand-700 text-white text-sm font-bold shadow-glow hover:shadow-premium disabled:opacity-60 inline-flex items-center gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          Enregistrer
        </button>
      </div>

      {/* Body: sidebar + content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar nav */}
        <div className="w-56 shrink-0 border-r border-slate-100 bg-slate-50/50 py-4 px-3 overflow-y-auto hidden lg:block">
          <nav className="space-y-1">
            {BLOCKS.map(b => {
              const Icon = b.icon;
              const active = tab === b.key;
              return (
                <button key={b.key} onClick={() => setTab(b.key)} className={`w-full text-left flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${active ? 'bg-white text-brand-700 shadow-card border border-brand-100' : 'text-slate-600 hover:bg-white hover:text-slate-900'}`}>
                  <Icon className={`w-4 h-4 ${active ? 'text-brand-600' : 'text-slate-400'}`} />
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
              <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-2xl">
                {BLOCKS.map(b => {
                  const Icon = b.icon;
                  return (
                    <button key={b.key} onClick={() => setTab(b.key)} className={`shrink-0 inline-flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${tab === b.key ? 'bg-white text-brand-700 shadow-card' : 'text-slate-500'}`}>
                      <Icon className="w-3.5 h-3.5" />{b.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {tab === 'infos' && <InfosTab form={form} setForm={setForm} editing={!!editing} categories={categories} suppliers={suppliers} onGenerateRef={generateRef} autoMode={autoMode} />}
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
