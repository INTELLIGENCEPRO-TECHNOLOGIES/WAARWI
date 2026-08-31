import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  X, Check, Loader2, Trash2, Search, Package, Car,
  Printer, Link2, MessageCircle, Pencil, Plus, Minus,
  CheckCircle, Truck, Ban, ChevronLeft, ChevronRight,
  User, FileText, Calendar, Columns3,
} from 'lucide-react';
import { formatFCFA, formatNum } from '../lib/format';

// ─── Types ───────────────────────────────────────────────────────

export type SOMode = 'create' | 'view' | 'edit' | 'receive';

export type SOLineItem = {
  id?: string;
  article_id: string | null;
  name: string;
  supplier_ref: string;
  quantity_ordered: number;
  unit_price: number;
  total: number;
  quantity_received?: number;
};

export type SOHeaderForm = {
  supplier_id: string;
  expected_date: string;
  note: string;
};

export type ReceiveQtyMap = Record<string, number>;
export type ReceiveLotMap = Record<string, { batch_number: string; expiry_date: string }>;

export type SupplierOrderEditorProps = {
  mode: SOMode;
  articles: any[];
  suppliers: any[];
  headerForm: SOHeaderForm;
  setHeaderForm: (fn: any) => void;
  items: SOLineItem[];
  setItems: (fn: any) => void;
  subtotal: number;
  saving: boolean;
  onSave?: () => void;
  onClose: () => void;
  // Document identity
  editingId?: string | null;
  documentNumber?: string;
  documentStatus?: string;
  autoMode?: boolean;
  onVehiclePicker?: () => void;
  // View-mode actions
  onEdit?: () => void;
  onPrint?: () => void;
  onCopyLink?: () => void;
  onWhatsApp?: () => void;
  onCancel?: () => void;
  onChangeStatus?: (status: string) => void;
  // Receive mode
  receiveQty?: ReceiveQtyMap;
  setReceiveQty?: (fn: any) => void;
  receiveLotData?: ReceiveLotMap;
  setReceiveLotData?: (fn: any) => void;
  stockMethod?: string;
  onConfirmReceive?: () => void;
  onStartReceive?: () => void;
  // Navigation
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
};

// ─── Column widths (matching DocumentEditor grid) ────────────────

const COL_WIDTHS: Record<string, string> = {
  article: 'w-[16%]',
  designation: 'flex-1 min-w-0',
  qty: 'w-[72px]',
  unit_price: 'w-[110px]',
  total: 'w-[110px]',
};

const COL_ALIGN: Record<string, string> = {
  article: 'text-left',
  designation: 'text-left',
  qty: 'text-center',
  unit_price: 'text-right',
  total: 'text-right',
};

function colClass(key: string) {
  return `${COL_WIDTHS[key] || ''} ${COL_ALIGN[key] || 'text-left'}`;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon', sent: 'Envoyée', confirmed: 'Confirmée',
  partial: 'Partielle', received: 'Reçue', cancelled: 'Annulée',
};

const COLS = [
  { key: 'article', label: 'Article' },
  { key: 'designation', label: 'Désignation' },
  { key: 'qty', label: 'Qté' },
  { key: 'unit_price', label: 'P.U. Achat' },
  { key: 'total', label: 'Total' },
];

// ─── Main Component ──────────────────────────────────────────────

export function SupplierOrderEditor(props: SupplierOrderEditorProps) {
  const {
    mode, articles, suppliers, headerForm, setHeaderForm,
    items, setItems, subtotal, saving, onSave, onClose,
    editingId, documentNumber, documentStatus,
    autoMode, onVehiclePicker,
    onEdit, onPrint, onCopyLink, onWhatsApp, onCancel, onChangeStatus,
    receiveQty, setReceiveQty, receiveLotData, setReceiveLotData,
    stockMethod, onConfirmReceive, onStartReceive,
    onPrev, onNext, hasPrev, hasNext,
  } = props;

  const isView = mode === 'view';
  const isCreate = mode === 'create';
  const isReceive = mode === 'receive';
  const canEdit = isCreate || mode === 'edit';

  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const emptyInput = { article_id: null as string | null, name: '', supplier_ref: '', quantity_ordered: 1, unit_price: 0 };
  const [inputRow, setInputRow] = useState(emptyInput);
  const inputRefRef = useRef<HTMLInputElement>(null);
  const inputQtyRef = useRef<HTMLInputElement>(null);
  const [articleSearchQuery, setArticleSearchQuery] = useState('');
  const [articleSearchOpen, setArticleSearchOpen] = useState(false);

  const validItems = useMemo(() => items.filter(it => it.name.trim() && it.unit_price > 0), [items]);
  const totalQtyItems = validItems.reduce((s, i) => s + (i.quantity_ordered || 0), 0);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (articleSearchOpen) { setArticleSearchOpen(false); return; }
        if (editingIdx !== null) { cancelEdit(); return; }
        onClose();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, editingIdx, articleSearchOpen]);

  // ─── Line item logic ────────────────────────────────────────

  const calc = (q: number, p: number) => Math.max(0, (q || 1) * p);

  const commitRow = () => {
    if (!inputRow.name.trim() || inputRow.unit_price <= 0) return;
    const total = calc(inputRow.quantity_ordered, inputRow.unit_price);
    const item: SOLineItem = { ...inputRow, total };
    if (editingIdx !== null) {
      setItems((prev: SOLineItem[]) => prev.map((it: SOLineItem, i: number) => i === editingIdx ? item : it));
      setEditingIdx(null);
    } else {
      setItems((prev: SOLineItem[]) => {
        const kept = prev.filter((it: SOLineItem) => it.name.trim());
        return [...kept, item];
      });
    }
    setInputRow(emptyInput);
    setArticleSearchQuery('');
    setTimeout(() => inputRefRef.current?.focus(), 30);
  };

  const startEdit = (vIdx: number) => {
    if (!canEdit) return;
    const it = validItems[vIdx];
    const realIdx = items.indexOf(it);
    setEditingIdx(realIdx);
    setInputRow({
      article_id: it.article_id,
      name: it.name,
      supplier_ref: it.supplier_ref || '',
      quantity_ordered: it.quantity_ordered,
      unit_price: it.unit_price,
    });
    const art = it.article_id ? articles.find((a: any) => a.id === it.article_id) : null;
    setArticleSearchQuery(art?.internal_ref || art?.name || it.name);
    setTimeout(() => inputRefRef.current?.focus(), 30);
  };

  const cancelEdit = () => { setEditingIdx(null); setInputRow(emptyInput); setArticleSearchQuery(''); };

  const removeItem = (vIdx: number) => {
    const it = validItems[vIdx];
    const realIdx = items.indexOf(it);
    if (editingIdx === realIdx) cancelEdit();
    setItems((p: SOLineItem[]) => p.filter((_: SOLineItem, i: number) => i !== realIdx));
  };

  const pickArticle = (a: any) => {
    setInputRow(prev => ({
      ...prev,
      article_id: a.id,
      name: a.name,
      unit_price: a.purchase_price || prev.unit_price,
      supplier_ref: a.supplier_ref || '',
    }));
    setArticleSearchQuery(a.internal_ref || a.name);
    setArticleSearchOpen(false);
    setTimeout(() => inputQtyRef.current?.focus(), 30);
  };

  const handleArticleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (articleSearchQuery.trim() && !inputRow.article_id) {
        e.preventDefault();
        setArticleSearchOpen(true);
        return;
      }
      if (e.key === 'Tab' && inputRow.article_id) return;
      if (e.key === 'Enter') { e.preventDefault(); commitRow(); }
    }
  };

  const handleInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commitRow(); }
  };

  const title = isReceive
    ? `Réception ${documentNumber || ''}`
    : isView
      ? `Commande ${documentNumber || ''}`
      : editingId
        ? `Commande ${documentNumber || ''}`
        : 'Nouvelle commande fournisseur';

  const inputCls = 'w-full text-xs h-7 px-2 bg-white border border-neutral-300 rounded focus:border-neutral-500 focus:ring-1 focus:ring-neutral-200 outline-none transition-all';
  const headerInputCls = 'w-full text-xs h-8 px-2 bg-transparent border-b border-[#C9C9C9] focus:border-black outline-none transition-colors';

  const selectedSupplier = suppliers.find(s => s.id === headerForm.supplier_id);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-white animate-fade-in">

      {/* ═══ Title bar ═══ */}
      <div className="flex items-center justify-between px-4 h-11 border-b border-[#D4D4D4] flex-shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          {(onPrev || onNext) && (
            <div className="flex items-center gap-0.5 mr-1">
              <button onClick={onPrev} disabled={!hasPrev} className="p-0.5 rounded hover:bg-neutral-100 text-neutral-500 disabled:opacity-25 disabled:pointer-events-none transition-colors" title="Précédent">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button onClick={onNext} disabled={!hasNext} className="p-0.5 rounded hover:bg-neutral-100 text-neutral-500 disabled:opacity-25 disabled:pointer-events-none transition-colors" title="Suivant">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
          <h2 className="text-sm font-bold text-neutral-900 tracking-tight truncate">{title}</h2>
          {documentStatus && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-500 uppercase tracking-wider">
              {STATUS_LABELS[documentStatus] || documentStatus}
            </span>
          )}
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin text-neutral-400 shrink-0" />}
        </div>
        <SOToolbar
          mode={mode}
          saving={saving}
          onSave={onSave}
          onClose={onClose}
          onPrint={onPrint}
          onEdit={onEdit}
          onCopyLink={onCopyLink}
          onWhatsApp={onWhatsApp}
          onCancel={onCancel}
          onChangeStatus={onChangeStatus}
          documentStatus={documentStatus}
          editingId={editingId}
          autoMode={autoMode}
          onVehiclePicker={onVehiclePicker}
          onConfirmReceive={onConfirmReceive}
          onStartReceive={onStartReceive}
        />
      </div>

      {/* ═══ Header fields (create/edit) ═══ */}
      {canEdit && (
        <div className="px-4 py-2.5 border-b border-neutral-100 flex-shrink-0">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="w-56">
              <SupplierSearchDropdown
                suppliers={suppliers}
                value={headerForm.supplier_id}
                onSelect={(s) => setHeaderForm((f: any) => ({ ...f, supplier_id: s.id }))}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Truck className="w-3.5 h-3.5 text-neutral-400" />
              <input
                type="date"
                value={headerForm.expected_date}
                onChange={e => setHeaderForm((f: any) => ({ ...f, expected_date: e.target.value }))}
                className={`${headerInputCls} w-36`}
                placeholder="Date livraison"
              />
            </div>
            <div className="flex items-center gap-1.5 flex-1 max-w-[260px]">
              <FileText className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
              <input
                value={headerForm.note}
                onChange={e => setHeaderForm((f: any) => ({ ...f, note: e.target.value }))}
                placeholder="Note interne..."
                className={headerInputCls}
              />
            </div>
          </div>
        </div>
      )}

      {/* ═══ View-mode header summary ═══ */}
      {(isView || isReceive) && (
        <div className="px-4 py-1.5 border-b border-neutral-100 bg-neutral-50/50 flex-shrink-0">
          <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
            {selectedSupplier && <span className="font-medium text-neutral-700">{selectedSupplier.name}</span>}
            {headerForm.expected_date && <span className="text-neutral-500">Livraison: {headerForm.expected_date}</span>}
            {headerForm.note && <span className="text-neutral-400 italic truncate max-w-[200px]">"{headerForm.note}"</span>}
          </div>
        </div>
      )}

      {/* ═══ Receive banner ═══ */}
      {isReceive && (
        <div className="px-4 py-2 bg-emerald-50/80 border-b border-emerald-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Truck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="text-xs font-semibold text-emerald-800">Mode réception — saisissez les quantités reçues pour chaque ligne</span>
          </div>
        </div>
      )}

      {/* ═══ Column headers ═══ */}
      {!isReceive && (
        <div className="flex-shrink-0 border-b border-[#D4D4D4] bg-[#F8F8F8]">
          <div className="flex items-center px-2 h-7">
            <div className="w-8 shrink-0" />
            {COLS.map(col => (
              <div key={col.key} className={`px-2 text-[10px] font-bold text-[#444444] uppercase tracking-wider ${colClass(col.key)}`}>
                {col.label}
              </div>
            ))}
            {canEdit && <div className="w-8 shrink-0" />}
          </div>
        </div>
      )}

      {/* ═══ Input row (create/edit only) ═══ */}
      {canEdit && (
        <div className="flex-shrink-0 border-b-2 border-[#D4D4D4] bg-neutral-50/40">
          <div className="flex items-center px-2 py-1">
            <div className="w-8 shrink-0 text-center">
              {editingIdx !== null ? (
                <button onClick={cancelEdit} className="p-0.5 rounded hover:bg-neutral-200 text-neutral-400" title="Annuler"><X className="w-3 h-3" /></button>
              ) : (
                <span className="text-[9px] font-bold text-neutral-300">+</span>
              )}
            </div>
            {COLS.map(col => {
              const w = `${COL_WIDTHS[col.key] || ''} px-1`;
              switch (col.key) {
                case 'article': return (
                  <div key="article" className={w}>
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-neutral-400 pointer-events-none" />
                      <input
                        ref={inputRefRef}
                        value={articleSearchQuery}
                        onChange={e => {
                          setArticleSearchQuery(e.target.value);
                          if (inputRow.article_id) setInputRow(p => ({ ...p, article_id: null, name: '', unit_price: 0, supplier_ref: '' }));
                        }}
                        onKeyDown={handleArticleKeyDown}
                        placeholder="Ref / article..."
                        className={inputCls + ' pl-7'}
                        autoComplete="off"
                      />
                    </div>
                  </div>
                );
                case 'designation': return (
                  <div key="designation" className={w}>
                    <input
                      value={inputRow.name}
                      onChange={e => setInputRow(p => ({ ...p, name: e.target.value }))}
                      onKeyDown={handleInputKey}
                      placeholder="Désignation"
                      className={inputCls}
                      readOnly={!!inputRow.article_id}
                    />
                  </div>
                );
                case 'qty': return (
                  <div key="qty" className={w}>
                    <input
                      ref={inputQtyRef}
                      type="number"
                      value={inputRow.quantity_ordered || ''}
                      onChange={e => setInputRow(p => ({ ...p, quantity_ordered: Number(e.target.value) || 0 }))}
                      onKeyDown={handleInputKey}
                      className={inputCls + ' text-center'}
                      min="1"
                    />
                  </div>
                );
                case 'unit_price': return (
                  <div key="unit_price" className={w}>
                    <input
                      type="number"
                      value={inputRow.unit_price || ''}
                      onChange={e => setInputRow(p => ({ ...p, unit_price: Number(e.target.value) || 0 }))}
                      onKeyDown={handleInputKey}
                      className={inputCls + ' text-right num'}
                    />
                  </div>
                );
                case 'total': return (
                  <div key="total" className={`${COL_WIDTHS[col.key]} px-1 text-right`}>
                    <span className="text-xs font-bold text-neutral-800 num leading-7">
                      {formatNum(calc(inputRow.quantity_ordered, inputRow.unit_price))}
                    </span>
                  </div>
                );
                default: return null;
              }
            })}
            <div className="w-8 shrink-0 text-center">
              <button
                onClick={commitRow}
                disabled={!inputRow.name.trim() || inputRow.unit_price <= 0}
                className="p-1 rounded bg-neutral-900 text-white disabled:opacity-20 hover:bg-neutral-700 transition-colors"
                title="Valider (Entrée)"
              >
                <Check className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Rows (scrollable) ═══ */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isReceive ? (
          <ReceiveRows
            items={items}
            articles={articles}
            receiveQty={receiveQty || {}}
            setReceiveQty={setReceiveQty}
            receiveLotData={receiveLotData || {}}
            setReceiveLotData={setReceiveLotData}
            stockMethod={stockMethod || 'none'}
          />
        ) : validItems.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-neutral-300 text-xs select-none">
            {canEdit ? 'Saisissez un article et appuyez Entrée' : 'Aucun article'}
          </div>
        ) : (
          <div>
            {validItems.map((it, vIdx) => {
              const isEditingThis = editingIdx !== null && items.indexOf(it) === editingIdx;
              const received = Number(it.quantity_received || 0);
              const ordered = Number(it.quantity_ordered || 0);
              return (
                <div
                  key={vIdx}
                  onClick={() => { if (canEdit && !isEditingThis) startEdit(vIdx); }}
                  className={`flex items-center px-2 border-b border-[#D4D4D4] transition-colors group ${
                    canEdit ? 'cursor-pointer' : ''
                  } ${isEditingThis ? 'bg-amber-50/50' : vIdx % 2 === 1 ? 'bg-[#FAFAFA]' : ''} ${canEdit && !isEditingThis ? 'hover:bg-neutral-50' : ''}`}
                  style={{ height: '28px' }}
                >
                  <div className="w-8 shrink-0 text-center">
                    <span className="text-[10px] text-neutral-300 group-hover:text-neutral-500 tabular-nums">{vIdx + 1}</span>
                  </div>
                  <div className={`px-2 text-xs truncate ${colClass('article')} text-neutral-500`}>
                    {it.article_id ? (articles.find((a: any) => a.id === it.article_id)?.internal_ref || it.supplier_ref || '—') : (it.supplier_ref || '—')}
                  </div>
                  <div className={`px-2 text-xs truncate ${colClass('designation')} font-medium text-neutral-800`}>
                    {it.name}
                  </div>
                  <div className={`px-2 text-xs truncate ${colClass('qty')} text-neutral-700 num`}>
                    {isView && received > 0 ? (
                      <span>{received}<span className="text-neutral-400">/{ordered}</span></span>
                    ) : ordered}
                  </div>
                  <div className={`px-2 text-xs truncate ${colClass('unit_price')} text-neutral-700 num`}>
                    {formatNum(it.unit_price)}
                  </div>
                  <div className={`px-2 text-xs truncate ${colClass('total')} font-semibold text-neutral-900 num`}>
                    {formatNum(it.total)}
                  </div>
                  {canEdit && (
                    <div className="w-8 shrink-0 text-center">
                      <button
                        onClick={e => { e.stopPropagation(); removeItem(vIdx); }}
                        className="p-0.5 rounded text-neutral-200 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ═══ Footer ═══ */}
      <div className="border-t border-[#D4D4D4] bg-white px-4 py-2 flex flex-col gap-1 flex-shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-neutral-500 tabular-nums">
            {validItems.length} ligne{validItems.length !== 1 ? 's' : ''}
            {' · '}{totalQtyItems} article{totalQtyItems !== 1 ? 's' : ''}
          </span>
          <span className="text-xs font-black text-neutral-900 num px-3 min-w-[100px] text-right">
            TOTAL {formatFCFA(subtotal)}
          </span>
        </div>
      </div>

      {/* ═══ Article Search Modal ═══ */}
      {articleSearchOpen && (
        <ArticleSearchModal
          articles={articles}
          initialQuery={articleSearchQuery}
          onSelect={pickArticle}
          onClose={() => setArticleSearchOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Toolbar ─────────────────────────────────────────────────────

function SOToolbar({ mode, saving, onSave, onClose, onPrint, onEdit, onCopyLink, onWhatsApp, onCancel, onChangeStatus, documentStatus, editingId, autoMode, onVehiclePicker, onConfirmReceive, onStartReceive }: {
  mode: SOMode;
  saving: boolean;
  onSave?: () => void;
  onClose: () => void;
  onPrint?: () => void;
  onEdit?: () => void;
  onCopyLink?: () => void;
  onWhatsApp?: () => void;
  onCancel?: () => void;
  onChangeStatus?: (status: string) => void;
  documentStatus?: string;
  editingId?: string | null;
  autoMode?: boolean;
  onVehiclePicker?: () => void;
  onConfirmReceive?: () => void;
  onStartReceive?: () => void;
}) {
  const isView = mode === 'view';
  const isReceive = mode === 'receive';
  const canEdit = mode === 'create' || mode === 'edit';

  const btnCls = 'p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-600 transition-colors';

  return (
    <div className="flex items-center gap-0.5">
      {/* View mode actions */}
      {isView && (
        <>
          {onPrint && <button onClick={onPrint} className={btnCls} title="Imprimer"><Printer className="w-4 h-4" /></button>}
          {onCopyLink && <button onClick={onCopyLink} className={btnCls} title="Copier le lien"><Link2 className="w-4 h-4" /></button>}
          {onWhatsApp && <button onClick={onWhatsApp} className={`${btnCls} !text-[#25D366]`} title="WhatsApp"><MessageCircle className="w-4 h-4" /></button>}
          {onEdit && ['draft', 'sent', 'confirmed', 'partial'].includes(documentStatus || '') && (
            <button onClick={onEdit} className={btnCls} title="Modifier"><Pencil className="w-4 h-4" /></button>
          )}
          {documentStatus === 'draft' && onChangeStatus && (
            <button onClick={() => onChangeStatus('sent')} className={btnCls} title="Marquer envoyée"><CheckCircle className="w-4 h-4" /></button>
          )}
          {['sent', 'confirmed', 'partial'].includes(documentStatus || '') && onStartReceive && (
            <button onClick={onStartReceive} className="p-1.5 rounded-lg hover:bg-emerald-50 text-emerald-600 transition-colors" title="Réceptionner">
              <Truck className="w-4 h-4" />
            </button>
          )}
          {['draft', 'sent'].includes(documentStatus || '') && onCancel && (
            <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 transition-colors" title="Annuler"><Ban className="w-4 h-4" /></button>
          )}
        </>
      )}
      {/* Receive mode actions */}
      {isReceive && (
        <>
          {onConfirmReceive && (
            <button
              onClick={onConfirmReceive}
              disabled={saving}
              className="ml-1 h-7 px-3 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Truck className="w-3.5 h-3.5" />}
              Confirmer réception
            </button>
          )}
        </>
      )}
      {/* Create/Edit mode actions */}
      {canEdit && (
        <>
          {autoMode && onVehiclePicker && (
            <button onClick={onVehiclePicker} className={btnCls} title="Par véhicule"><Car className="w-4 h-4" /></button>
          )}
          {editingId && onPrint && <button onClick={onPrint} className={btnCls} title="Imprimer"><Printer className="w-4 h-4" /></button>}
          {editingId && documentStatus === 'draft' && onChangeStatus && (
            <button onClick={() => onChangeStatus('sent')} className={btnCls} title="Marquer envoyée"><CheckCircle className="w-4 h-4" /></button>
          )}
          {onSave && (
            <button
              onClick={onSave}
              disabled={saving}
              className="ml-1 h-7 px-3 rounded-lg bg-neutral-900 text-white text-xs font-semibold hover:bg-neutral-800 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {editingId ? 'Enregistrer' : 'Créer'}
            </button>
          )}
        </>
      )}
      <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-500 transition-colors ml-0.5" title="Fermer">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

// ─── Receive Rows ────────────────────────────────────────────────

function ReceiveRows({ items, articles, receiveQty, setReceiveQty, receiveLotData, setReceiveLotData, stockMethod }: {
  items: SOLineItem[];
  articles: any[];
  receiveQty: ReceiveQtyMap;
  setReceiveQty?: (fn: any) => void;
  receiveLotData: ReceiveLotMap;
  setReceiveLotData?: (fn: any) => void;
  stockMethod: string;
}) {
  const validItems = items.filter(it => it.name.trim());

  return (
    <div className="divide-y divide-neutral-100">
      {/* Column header for receive mode */}
      <div className="flex items-center px-4 py-1.5 bg-neutral-50/70">
        <div className="w-8 shrink-0" />
        <div className="flex-1 min-w-0 text-[10px] font-bold text-neutral-500 uppercase tracking-wider">Article</div>
        <div className="w-[80px] text-center text-[10px] font-bold text-neutral-500 uppercase tracking-wider">Commandé</div>
        <div className="w-[80px] text-center text-[10px] font-bold text-neutral-500 uppercase tracking-wider">Déjà reçu</div>
        <div className="w-[80px] text-center text-[10px] font-bold text-neutral-500 uppercase tracking-wider">Restant</div>
        <div className="w-[120px] text-center text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Reçu auj.</div>
        <div className="w-[110px] text-right text-[10px] font-bold text-neutral-500 uppercase tracking-wider pr-2">Total</div>
      </div>
      {validItems.map((it, idx) => {
        const ordered = Number(it.quantity_ordered || 0);
        const received = Number(it.quantity_received || 0);
        const remaining = Math.max(0, ordered - received);
        const itemId = it.id || `idx-${idx}`;
        const qty = receiveQty[itemId] ?? remaining;
        const art = it.article_id ? articles.find((a: any) => a.id === it.article_id) : null;

        return (
          <div key={itemId}>
            <div className="flex items-center px-4 py-2 hover:bg-neutral-50/40 transition-colors">
              <div className="w-8 shrink-0 text-center">
                <span className="text-[10px] text-neutral-300 tabular-nums">{idx + 1}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-neutral-800 truncate">{it.name}</div>
                {(it.supplier_ref || art?.internal_ref) && (
                  <div className="text-[10px] text-neutral-400 font-mono truncate">{it.supplier_ref || art?.internal_ref}</div>
                )}
              </div>
              <div className="w-[80px] text-center text-xs text-neutral-700 num">{ordered}</div>
              <div className="w-[80px] text-center text-xs text-neutral-500 num">{received}</div>
              <div className="w-[80px] text-center text-xs font-semibold text-amber-700 num">{remaining}</div>
              <div className="w-[120px] flex justify-center">
                <input
                  type="number"
                  min={0}
                  max={remaining}
                  value={qty}
                  onChange={e => setReceiveQty?.((p: ReceiveQtyMap) => ({
                    ...p,
                    [itemId]: Math.max(0, Math.min(remaining, Number(e.target.value) || 0)),
                  }))}
                  className="w-16 text-xs h-7 px-2 bg-white border border-emerald-300 rounded text-center num focus:border-emerald-500 focus:ring-1 focus:ring-emerald-200 outline-none transition-all"
                />
              </div>
              <div className="w-[110px] text-right text-xs font-semibold text-neutral-900 num pr-2">
                {formatNum(it.total)}
              </div>
            </div>
            {stockMethod === 'lot' && qty > 0 && (
              <div className="flex items-center gap-3 px-12 pb-2">
                <div className="flex-1 max-w-[200px]">
                  <label className="text-[10px] text-neutral-500 font-medium">N° Lot</label>
                  <input
                    type="text"
                    placeholder="Batch..."
                    value={receiveLotData[itemId]?.batch_number || ''}
                    onChange={e => setReceiveLotData?.((p: ReceiveLotMap) => ({
                      ...p,
                      [itemId]: { ...(p[itemId] || { batch_number: '', expiry_date: '' }), batch_number: e.target.value },
                    }))}
                    className="w-full text-xs h-7 px-2 bg-white border border-neutral-300 rounded focus:border-neutral-500 outline-none transition-all mt-0.5"
                  />
                </div>
                <div className="flex-1 max-w-[200px]">
                  <label className="text-[10px] text-neutral-500 font-medium">Date d'expiration</label>
                  <input
                    type="date"
                    value={receiveLotData[itemId]?.expiry_date || ''}
                    onChange={e => setReceiveLotData?.((p: ReceiveLotMap) => ({
                      ...p,
                      [itemId]: { ...(p[itemId] || { batch_number: '', expiry_date: '' }), expiry_date: e.target.value },
                    }))}
                    className="w-full text-xs h-7 px-2 bg-white border border-neutral-300 rounded focus:border-neutral-500 outline-none transition-all mt-0.5"
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Article Search Modal (matches DocumentEditor exactly) ──────

const SEARCH_COLS = [
  { key: 'ref', label: 'Référence', align: 'left', w: 'w-[18%]' },
  { key: 'name', label: 'Désignation', align: 'left', w: 'flex-1 min-w-0' },
  { key: 'category', label: 'Catégorie', align: 'left', w: 'w-[14%]' },
  { key: 'salePrice', label: 'Prix vente', align: 'right', w: 'w-[12%]' },
  { key: 'purchasePrice', label: "Prix d'achat", align: 'right', w: 'w-[12%]' },
  { key: 'stock', label: 'Stock', align: 'right', w: 'w-[10%]' },
];

function ArticleSearchModal({ articles, initialQuery, onSelect, onClose }: {
  articles: any[];
  initialQuery: string;
  onSelect: (a: any) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [highlighted, setHighlighted] = useState(0);
  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>({
    ref: true, name: true, salePrice: true, purchasePrice: true, stock: true, category: true,
  });
  const [showColMenu, setShowColMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const colMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (colMenuRef.current && !colMenuRef.current.contains(e.target as Node)) setShowColMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return articles.slice(0, 100);
    const q = query.toLowerCase().trim();
    const exact: any[] = [];
    const partial: any[] = [];
    for (const a of articles) {
      const ref = (a.internal_ref || '').toLowerCase();
      const name = a.name.toLowerCase();
      const supRef = (a.supplier_ref || '').toLowerCase();
      if (ref === q || name === q) exact.push(a);
      else if (ref.includes(q) || name.includes(q) || supRef.includes(q)) partial.push(a);
    }
    return [...exact, ...partial].slice(0, 100);
  }, [query, articles]);

  useEffect(() => { setHighlighted(0); }, [query]);

  useEffect(() => {
    const el = listRef.current?.children[highlighted] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[highlighted]) onSelect(filtered[highlighted]); }
    else if (e.key === 'Escape') { onClose(); }
  };

  const activeCols = SEARCH_COLS.filter(c => visibleCols[c.key]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/20" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white w-full max-w-4xl h-[80vh] flex flex-col rounded-lg shadow-xl mx-4" onClick={e => e.stopPropagation()}>
        {/* Search header */}
        <div className="flex items-center gap-2 px-4 h-12 border-b border-neutral-200 flex-shrink-0">
          <Search className="w-4 h-4 text-neutral-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Rechercher par référence ou désignation..."
            className="flex-1 text-sm outline-none bg-transparent"
            autoComplete="off"
          />
          {/* Column toggle */}
          <div className="relative" ref={colMenuRef}>
            <button onClick={() => setShowColMenu(!showColMenu)} className="p-1.5 rounded hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors" title="Colonnes">
              <Columns3 className="w-4 h-4" />
            </button>
            {showColMenu && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-neutral-200 rounded-lg shadow-lg py-1 w-44 z-10">
                {SEARCH_COLS.map(col => (
                  <label key={col.key} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-neutral-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={visibleCols[col.key]}
                      onChange={e => setVisibleCols(prev => ({ ...prev, [col.key]: e.target.checked }))}
                      className="w-3.5 h-3.5 rounded"
                    />
                    <span className="text-neutral-700">{col.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Table header */}
        <div className="flex items-center px-4 h-7 border-b border-neutral-200 bg-neutral-50/70 flex-shrink-0">
          {activeCols.map(col => (
            <div key={col.key} className={`px-2 text-[10px] font-bold text-neutral-500 uppercase tracking-wider ${col.w} ${col.align === 'right' ? 'text-right' : 'text-left'}`}>
              {col.label}
            </div>
          ))}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto min-h-0" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-neutral-400 text-xs">Aucun article trouvé</div>
          ) : (
            filtered.map((a, i) => (
              <div
                key={a.id}
                onClick={() => setHighlighted(i)}
                onDoubleClick={() => onSelect(a)}
                className={`flex items-center px-4 border-b border-neutral-50 cursor-pointer transition-colors ${
                  i === highlighted ? 'bg-neutral-100' : 'hover:bg-neutral-50'
                }`}
                style={{ height: '30px' }}
              >
                {activeCols.map(col => {
                  const base = `px-2 text-xs truncate ${col.w} ${col.align === 'right' ? 'text-right' : 'text-left'}`;
                  switch (col.key) {
                    case 'ref': return <div key="ref" className={`${base} text-neutral-500 num`}>{a.internal_ref || '—'}</div>;
                    case 'name': return <div key="name" className={`${base} font-medium text-neutral-800`}>{a.name}</div>;
                    case 'category': return <div key="category" className={`${base} text-neutral-400`}>{a.categories?.name || '—'}</div>;
                    case 'salePrice': return <div key="salePrice" className={`${base} text-neutral-700 num`}>{formatNum(a.sale_price)}</div>;
                    case 'purchasePrice': return <div key="purchasePrice" className={`${base} text-neutral-700 num font-semibold`}>{formatNum(a.purchase_price)}</div>;
                    case 'stock': return <div key="stock" className={`${base} num ${(a.stock_quantity || 0) <= 0 ? 'text-red-400' : 'text-neutral-700'}`}>{a.stock_quantity ?? '—'}</div>;
                    default: return null;
                  }
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 h-10 border-t border-neutral-200 flex-shrink-0">
          <span className="text-[11px] text-neutral-500">{filtered.length} résultat{filtered.length !== 1 ? 's' : ''}</span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1 text-[11px] font-medium text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 rounded transition-colors">Annuler</button>
            <button
              onClick={() => { if (filtered[highlighted]) onSelect(filtered[highlighted]); }}
              disabled={filtered.length === 0}
              className="px-3 py-1 text-[11px] font-semibold bg-neutral-900 text-white rounded hover:bg-neutral-800 disabled:opacity-40 transition-colors"
            >
              Sélectionner
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Supplier Search Dropdown ────────────────────────────────────

function SupplierSearchDropdown({ suppliers, value, onSelect }: {
  suppliers: any[];
  value: string;
  onSelect: (s: any) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const selected = suppliers.find(s => s.id === value);

  const filtered = useMemo(() => {
    if (!query.trim()) return suppliers.slice(0, 20);
    const q = query.toLowerCase().trim();
    return suppliers.filter((s: any) =>
      s.name.toLowerCase().includes(q) || (s.phone || '').toLowerCase().includes(q)
    ).slice(0, 30);
  }, [query, suppliers]);

  useEffect(() => { setHighlighted(0); }, [filtered.length]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) { if (e.key === 'ArrowDown') setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && filtered[highlighted]) { e.preventDefault(); e.stopPropagation(); onSelect(filtered[highlighted]); setOpen(false); setQuery(''); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400" />
        <input
          value={open ? query : (selected?.name || '')}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { setQuery(''); setOpen(true); }}
          onKeyDown={handleKeyDown}
          placeholder="Rechercher fournisseur..."
          className="w-full text-xs h-8 pl-8 pr-2 bg-transparent border-b border-[#C9C9C9] focus:border-black outline-none transition-colors"
          autoComplete="off"
        />
      </div>
      {open && (
        <div className="absolute z-50 left-0 top-full mt-1 bg-white border border-neutral-200 rounded-xl shadow-lg max-h-56 overflow-y-auto min-w-[260px]">
          {filtered.map((s: any, i: number) => (
            <button
              key={s.id}
              onMouseDown={e => { e.preventDefault(); onSelect(s); setOpen(false); setQuery(''); }}
              onMouseEnter={() => setHighlighted(i)}
              className={`w-full text-left px-3 py-2 flex items-center gap-2 text-xs transition-colors ${i === highlighted ? 'bg-neutral-100 text-neutral-900' : 'hover:bg-neutral-50 text-neutral-700'}`}
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{s.name}</p>
                {s.phone && <p className="text-[10px] text-neutral-400">{s.phone}</p>}
              </div>
            </button>
          ))}
          {filtered.length === 0 && query.trim() && (
            <div className="px-3 py-3 text-center text-xs text-neutral-400">Aucun fournisseur trouvé</div>
          )}
        </div>
      )}
    </div>
  );
}
