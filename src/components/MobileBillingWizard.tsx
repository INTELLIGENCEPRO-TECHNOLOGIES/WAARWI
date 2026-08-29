import { useState, useMemo, useRef, useEffect, type ReactNode } from 'react';
import {
  X, Plus, Search, Trash2, ChevronRight,
  ChevronLeft, Loader2, Check, ShoppingCart, Delete,
} from 'lucide-react';
import { formatFCFA } from '../lib/format';
import { SearchableSelect } from './SearchableSelect';
import { QuickCreateButton } from './QuickCreate';

export type WizardItem = {
  article_id: string | null;
  name: string;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
  supplier_ref?: string;
};

export type WizardHeaderField = {
  key: string;
  label: string;
  type: 'select' | 'date' | 'text';
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  colSpan?: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  headerFields: WizardHeaderField[];
  headerValues: Record<string, string>;
  onHeaderChange: (key: string, value: string) => void;
  items: WizardItem[];
  onAddItem: (articleId: string) => void;
  onUpdateItem: (idx: number, field: string, val: any) => void;
  onRemoveItem: (idx: number) => void;
  articles: { id: string; name: string; sale_price?: number; purchase_price?: number; internal_ref?: string; supplier_ref?: string }[];
  saving: boolean;
  onSave: () => void;
  total: number;
  saveLabel?: string;
  itemPriceField?: 'sale_price' | 'purchase_price';
  banner?: ReactNode;
  onCreateArticle?: (name: string) => void;
  onCreateCustomer?: (name: string) => void;
  brandMode?: boolean; // deprecated — kept for call-site compat, ignored
};

export function MobileBillingWizard({
  open,
  onClose,
  title,
  headerFields,
  headerValues,
  onHeaderChange,
  items,
  onAddItem,
  onUpdateItem,
  onRemoveItem,
  articles,
  saving,
  onSave,
  total,
  saveLabel = 'Enregistrer',
  itemPriceField = 'sale_price',
  banner,
  onCreateArticle,
  onCreateCustomer,
}: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) { setStep(1); setSearchOpen(false); setEditingIdx(null); }
  }, [open]);

  useEffect(() => {
    if (searchOpen && searchRef.current) {
      setTimeout(() => searchRef.current?.focus(), 100);
    }
  }, [searchOpen]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const filteredArticles = useMemo(() => {
    if (!searchQuery.trim()) return articles.slice(0, 50);
    const q = searchQuery.toLowerCase();
    return articles.filter(a =>
      a.name.toLowerCase().includes(q) ||
      (a.internal_ref && a.internal_ref.toLowerCase().includes(q)) ||
      (a.supplier_ref && a.supplier_ref.toLowerCase().includes(q))
    ).slice(0, 50);
  }, [articles, searchQuery]);

  const validItems = items.filter(i => i.name.trim());
  const itemCount = validItems.length;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col animate-fade-in bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-neutral-200 flex-shrink-0">
        <button onClick={onClose} className="p-2 -ml-2 rounded-md hover:bg-neutral-100 text-neutral-600 active:scale-95 transition-all">
          <X className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-[14px] font-bold text-neutral-900 tracking-tight truncate">{title}</h2>
          <StepIndicator step={step} />
        </div>
      </div>

      {banner && <div className="flex-shrink-0">{banner}</div>}

      <div className="flex-1 overflow-y-auto">
        {step === 1 && (
          <Step1Header
            fields={headerFields}
            values={headerValues}
            onChange={onHeaderChange}
            onCreateCustomer={onCreateCustomer}
          />
        )}
        {step === 2 && (
          <Step2Articles
            items={validItems}
            allItems={items}
            onEdit={setEditingIdx}
          />
        )}
      </div>

      {/* Fixed footer */}
      <div className="flex-shrink-0 bg-white border-t border-neutral-200 pb-safe">
        {step === 1 && (
          <div className="flex items-center justify-between px-4 py-2.5">
            <button onClick={onClose} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
            <button
              onClick={() => setStep(2)}
              className="h-11 flex-1 ml-3 rounded-lg bg-neutral-900 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-all"
            >
              Articles <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
        {step === 2 && (
          <div className="px-4 py-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <button onClick={() => setStep(1)} className="h-9 px-3 rounded-md text-neutral-600 font-semibold text-sm flex items-center gap-1 active:scale-95 transition-all">
                <ChevronLeft className="w-4 h-4" /> Infos
              </button>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold">Total</div>
                <div className="text-lg font-black text-neutral-900 num">{formatFCFA(total)}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setSearchQuery(''); setSearchOpen(true); }}
                className="h-12 w-12 rounded-lg border border-neutral-200 bg-neutral-900 text-white flex items-center justify-center active:scale-90 transition-all flex-shrink-0"
              >
                <Plus className="w-5 h-5" />
              </button>
              <button
                onClick={onSave}
                disabled={saving || itemCount === 0}
                className="flex-1 h-12 rounded-lg bg-neutral-900 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                {saveLabel}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom sheet - article search */}
      {searchOpen && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-white animate-sheet-up">
          <div className="flex items-center gap-3 px-4 py-2.5 border-b border-neutral-200 flex-shrink-0">
            <button onClick={() => setSearchOpen(false)} className="p-2 -ml-2 rounded-md hover:bg-neutral-100 text-neutral-600 active:scale-95 transition-all">
              <X className="w-5 h-5" />
            </button>
            <div className="flex-1 relative">
              <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <input
                ref={searchRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Rechercher un article..."
                className="w-full h-11 pl-6 pr-4 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none bg-transparent border-b border-neutral-300 focus:border-neutral-500 transition-colors"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredArticles.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-neutral-400">
                <p className="text-sm">Aucun article trouvé</p>
              </div>
            )}
            <div className="divide-y divide-neutral-100">
              {filteredArticles.map(a => (
                <button
                  key={a.id}
                  onClick={() => { onAddItem(a.id); setSearchOpen(false); }}
                  className="w-full flex items-start gap-2.5 text-left active:scale-[0.98] transition-all px-4 py-2.5 hover:bg-neutral-50"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold text-neutral-900 leading-snug">{a.name}</div>
                    {a.internal_ref && <div className="text-[10px] font-mono text-neutral-400 mt-0.5">{a.internal_ref}</div>}
                  </div>
                  <div className="shrink-0 flex flex-col items-end">
                    <span className="text-[13px] font-bold text-neutral-900 num">
                      {a[itemPriceField] ? formatFCFA(a[itemPriceField]) : ''}
                    </span>
                  </div>
                </button>
              ))}
            </div>
            {onCreateArticle && (
              <div className="mt-2">
                <QuickCreateButton label="Créer un article" onClick={() => { onCreateArticle(searchQuery); setSearchOpen(false); }} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit article panel with numeric keypad */}
      {editingIdx !== null && items[editingIdx] && (
        <EditArticlePanel
          item={items[editingIdx]}
          idx={editingIdx}
          onUpdate={onUpdateItem}
          onRemove={() => { onRemoveItem(editingIdx); setEditingIdx(null); }}
          onClose={() => setEditingIdx(null)}
        />
      )}
    </div>
  );
}

function StepIndicator({ step }: { step: 1 | 2 }) {
  return (
    <div className="flex items-center gap-1.5 mt-0.5">
      <div className={`h-1 rounded-full transition-all duration-300 ${step === 1 ? 'w-5 bg-neutral-900' : 'w-2.5 bg-neutral-300'}`} />
      <div className={`h-1 rounded-full transition-all duration-300 ${step === 2 ? 'w-5 bg-neutral-900' : 'w-2.5 bg-neutral-300'}`} />
      <span className="text-[10px] text-neutral-500 font-medium ml-1">
        {step === 1 ? 'Informations' : 'Articles'}
      </span>
    </div>
  );
}

function Step1Header({ fields, values, onChange, onCreateCustomer }: {
  fields: WizardHeaderField[];
  values: Record<string, string>;
  onChange: (key: string, val: string) => void;
  onCreateCustomer?: (name: string) => void;
}) {
  const inputCls = 'w-full h-11 px-1 bg-transparent border-b border-neutral-300 focus:border-neutral-500 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none transition-colors';
  return (
    <div className="px-4 py-4 space-y-2.5">
      {fields.map(f => (
        <div key={f.key}>
          <label className="text-[11px] font-semibold text-neutral-600 mb-1 block">
            {f.label}{f.required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
          {f.type === 'select' && f.options ? (
            <>
              <SearchableSelect
                options={f.options}
                value={values[f.key] || ''}
                onChange={v => onChange(f.key, v)}
                placeholder={f.placeholder || '— Choisir —'}
                variant="underline"
              />
              {f.key === 'customer_id' && onCreateCustomer && (
                <div className="mt-1">
                  <QuickCreateButton label="Créer un client" onClick={() => onCreateCustomer('')} />
                </div>
              )}
            </>
          ) : f.type === 'date' ? (
            <input
              type="date"
              value={values[f.key] || ''}
              onChange={e => onChange(f.key, e.target.value)}
              className={inputCls}
            />
          ) : (
            <input
              type="text"
              value={values[f.key] || ''}
              onChange={e => onChange(f.key, e.target.value)}
              placeholder={f.placeholder}
              className={inputCls}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function Step2Articles({ items, allItems, onEdit }: {
  items: WizardItem[];
  allItems: WizardItem[];
  onEdit: (idx: number) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
        <ShoppingCart className="w-10 h-10 text-neutral-300 mb-3" />
        <p className="text-sm font-semibold text-neutral-600">Aucun article</p>
        <p className="text-xs text-neutral-400 mt-1">Appuyez sur + pour ajouter</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-neutral-100">
      <div className="flex items-center gap-2 px-4 py-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
          {items.length} article{items.length > 1 ? 's' : ''}
        </span>
      </div>
      {items.map((item) => {
        const realIdx = allItems.indexOf(item);
        return (
          <button
            key={realIdx}
            onClick={() => onEdit(realIdx)}
            className="w-full text-left px-4 py-2.5 active:scale-[0.98] transition-all flex flex-col gap-1"
          >
            <p className="text-[13px] font-semibold text-neutral-900 leading-snug w-full">{item.name}</p>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 text-[11px] text-neutral-500">
                <span>{item.quantity} x <span className="font-bold text-neutral-700 num">{formatFCFA(item.unit_price)}</span></span>
                {item.discount > 0 && <span className="text-amber-600 font-medium">-{formatFCFA(item.discount)}</span>}
              </div>
              <span className="text-[12px] font-black text-neutral-900 num">{formatFCFA(item.total)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

type NumField = 'qty' | 'price' | 'discount';

function EditArticlePanel({ item, idx, onUpdate, onRemove, onClose }: {
  item: WizardItem;
  idx: number;
  onUpdate: (idx: number, field: string, val: any) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [activeField, setActiveField] = useState<NumField>('qty');
  const [buffer, setBuffer] = useState(String(item.quantity));

  useEffect(() => {
    if (activeField === 'qty') setBuffer(String(item.quantity));
    else if (activeField === 'price') setBuffer(item.unit_price ? String(item.unit_price) : '');
    else setBuffer(item.discount ? String(item.discount) : '');
  }, [activeField]);

  const commit = (val: string) => {
    const n = Number(val) || 0;
    if (activeField === 'qty') onUpdate(idx, 'quantity', Math.max(1, n));
    else if (activeField === 'price') onUpdate(idx, 'unit_price', Math.max(0, n));
    else onUpdate(idx, 'discount', Math.max(0, n));
  };

  const pressKey = (key: string) => {
    if (key === 'backspace') {
      const next = buffer.slice(0, -1);
      setBuffer(next);
      commit(next);
    } else {
      const next = buffer + key;
      setBuffer(next);
      commit(next);
    }
  };

  const switchField = (field: NumField) => {
    commit(buffer);
    setActiveField(field);
  };

  const clearField = () => {
    setBuffer('');
    commit('0');
  };

  const fieldStyle = (f: NumField) =>
    `flex-1 py-2 flex flex-col items-center justify-center transition-all border-b-2 ${
      activeField === f ? 'border-neutral-900' : 'border-neutral-200'
    }`;

  return (
    <div className="fixed inset-0 z-[70] flex flex-col animate-fade-in">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="bg-white rounded-t-2xl shadow-2xl animate-sheet-up pb-safe flex flex-col">
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-start justify-between mb-2">
            <p className="text-[13px] font-bold text-neutral-900 leading-snug line-clamp-2 flex-1 pr-2">{item.name}</p>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button onClick={onRemove} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 active:scale-90 transition-all">
                <Trash2 className="w-4 h-4" />
              </button>
              <button onClick={onClose} className="p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-100 active:scale-90 transition-all">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3 mb-2">
            <button onClick={() => switchField('qty')} className={fieldStyle('qty')}>
              <span className="text-[9px] font-bold uppercase text-neutral-500">Qté</span>
              <span className="text-sm font-black num text-neutral-900">{activeField === 'qty' ? (buffer || '0') : item.quantity}</span>
            </button>
            <button onClick={() => switchField('price')} className={fieldStyle('price')}>
              <span className="text-[9px] font-bold uppercase text-neutral-500">Prix</span>
              <span className="text-sm font-black num text-neutral-900">{activeField === 'price' ? (buffer || '0') : item.unit_price}</span>
            </button>
            <button onClick={() => switchField('discount')} className={fieldStyle('discount')}>
              <span className="text-[9px] font-bold uppercase text-neutral-500">Remise</span>
              <span className="text-sm font-black num text-neutral-900">{activeField === 'discount' ? (buffer || '0') : item.discount}</span>
            </button>
            <div className="py-2 px-2 flex flex-col items-center justify-center border-b-2 border-neutral-200">
              <span className="text-[9px] font-bold uppercase text-neutral-500">Total</span>
              <span className="text-[11px] font-black num text-neutral-900">{formatFCFA(item.total)}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-px bg-neutral-200 border-t border-neutral-200">
          {['1','2','3','qty','4','5','6','discount','7','8','9','price','clear','0','ok','backspace'].map(key => {
            if (key === 'qty') return (
              <button key={key} onClick={() => switchField('qty')}
                className={`h-[52px] flex items-center justify-center text-base font-bold transition-all active:scale-95 ${activeField === 'qty' ? 'bg-neutral-200 text-neutral-900' : 'bg-neutral-50 text-neutral-600'}`}
              >Qté</button>
            );
            if (key === 'price') return (
              <button key={key} onClick={() => switchField('price')}
                className={`h-[52px] flex items-center justify-center text-base font-bold transition-all active:scale-95 ${activeField === 'price' ? 'bg-neutral-200 text-neutral-900' : 'bg-neutral-50 text-neutral-600'}`}
              >Prix</button>
            );
            if (key === 'discount') return (
              <button key={key} onClick={() => switchField('discount')}
                className={`h-[52px] flex items-center justify-center text-base font-bold transition-all active:scale-95 ${activeField === 'discount' ? 'bg-amber-100 text-amber-800' : 'bg-neutral-50 text-neutral-600'}`}
              >%</button>
            );
            if (key === 'clear') return (
              <button key={key} onClick={clearField}
                className="h-[52px] flex items-center justify-center text-sm font-bold bg-amber-50 text-amber-700 transition-all active:scale-95"
              >C</button>
            );
            if (key === 'ok') return (
              <button key={key} onClick={onClose}
                className="h-[52px] flex items-center justify-center bg-neutral-900 text-white transition-all active:scale-95"
              ><Check className="w-5 h-5" /></button>
            );
            if (key === 'backspace') return (
              <button key={key} onClick={() => pressKey('backspace')}
                className="h-[52px] flex items-center justify-center bg-red-50 text-red-600 transition-all active:scale-95"
              ><Delete className="w-5 h-5" /></button>
            );
            return (
              <button key={key} onClick={() => pressKey(key)}
                className="h-[52px] flex items-center justify-center text-xl font-semibold bg-white text-neutral-900 transition-all active:scale-95 active:bg-neutral-100"
              >{key}</button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
