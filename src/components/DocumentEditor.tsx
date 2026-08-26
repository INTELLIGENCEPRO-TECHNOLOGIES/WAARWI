import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  X, Check, Loader2, Lock, Trash2, Search, Package, Car,
  Printer, Link2, MessageCircle, Pencil, ArrowRight, CreditCard,
  Plus, Minus, ShieldCheck, Columns3, ChevronDown, RotateCcw,
  CheckCircle, RefreshCw, Coins, BookOpen, Ban, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { formatFCFA, formatNum } from '../lib/format';
import { type DocSettings, type DocColumn, DEFAULT_COLUMNS } from './DocumentSettingsTab';
import { type SalesRepresentative, repDisplayName } from '../lib/repCommission';
import { type IpmDocuments as IpmDocsType } from '../lib/ipm';

// ─── Types ───────────────────────────────────────────────────────

export type DocType = 'invoice' | 'quote' | 'return' | 'credit_note';
export type DocMode = 'create' | 'view' | 'edit';

export type DocLineItem = {
  id?: string;
  article_id: string | null;
  name: string;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
  tier_name?: string;
  ipm_eligible?: boolean;
};

export type DocHeaderForm = {
  customer_id: string;
  note: string;
  doc_date: string;
  delivery_date: string;
  reference: string;
  warranty: string;
  representative: string;
  imei: string;
  valid_until: string;
};

export type DocPaymentLine = {
  method_id: string;
  method_name: string;
  amount: number;
  reference: string;
};

export type DocumentEditorProps = {
  docType: DocType;
  mode: DocMode;
  // Data
  articles: any[];
  customers: any[];
  headerForm: DocHeaderForm;
  setHeaderForm: (fn: any) => void;
  items: DocLineItem[];
  setItems: (fn: any) => void;
  // Calculations
  subtotal: number;
  // Save
  saving: boolean;
  onSave?: (opts?: { silent?: boolean }) => void;
  onClose: () => void;
  // Document identity
  editingId?: string | null;
  documentNumber?: string;
  documentStatus?: string;
  // Settings
  docSettings: DocSettings;
  autoMode?: boolean;
  onVehiclePicker?: (idx: number | null) => void;
  // Quick create
  onCreateArticle?: (name: string) => void;
  onCreateCustomer?: (name: string) => void;
  // Representatives
  reps?: SalesRepresentative[];
  // Payments (invoice only)
  paymentMethods?: any[];
  payments?: DocPaymentLine[];
  setPayments?: (fn: any) => void;
  totalPaid?: number;
  isCredit?: boolean;
  setIsCredit?: (v: boolean) => void;
  // IPM (pharmacy)
  isPharmacy?: boolean;
  ipmLoading?: boolean;
  ipmBeneficiaire?: any;
  ipmTaux?: number;
  ipmConvention?: any;
  ipmPartIpm?: number;
  ipmPartClient?: number;
  ipmConfig?: any;
  ipmDocuments?: IpmDocsType;
  setIpmDocuments?: (fn: any) => void;
  ipmDocValidation?: { valide: boolean; champs_manquants: string[] };
  // View-mode actions
  onEdit?: () => void;
  onPay?: () => void;
  onCopyLink?: () => void;
  onWhatsApp?: () => void;
  onCancel?: () => void;
  onComptabiliser?: () => void;
  accountingStatus?: string;
  invoiceDue?: number;
  // Quote-specific actions
  onChangeStatus?: (status: string) => void;
  onConvert?: () => void;
  onPrint?: () => void;
  // Transformation
  onTransformToReturn?: (config: { reason: string; restock: boolean; selectedItems: ReturnLineItem[] }) => void;
  onTransformToAvoir?: () => void;
  transformReturnLines?: ReturnLineItem[];
  loadReturnLines?: (saleId: string) => void;
  // Return-specific view actions
  onRefundCash?: () => void;
  onApproveAvoir?: () => void;
  // Navigation between documents
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  // Search / jump to document
  onSearchOpen?: () => void;
  // Post-creation mode (invoice)
  postCreation?: { saleNumber: string; createdAt: string; createdBy: string } | null;
  onNewInvoice?: () => void;
  docCreatedInfo?: { createdAt: string; createdBy: string } | null;
};

export type ReturnLineItem = {
  item_id: string;
  article_id: string;
  name: string;
  max_qty: number;
  quantity: number;
  unit_price: number;
  purchase_cost: number;
  selected: boolean;
};

// ─── Column width constants (strict grid) ────────────────────────

const COL_WIDTHS: Record<string, string> = {
  article: 'w-[16%]',
  designation: 'flex-1 min-w-0',
  qty: 'w-[72px]',
  unit_price: 'w-[110px]',
  discount: 'w-[90px]',
  total: 'w-[110px]',
};

const COL_ALIGN: Record<string, string> = {
  article: 'text-left',
  designation: 'text-left',
  qty: 'text-center',
  unit_price: 'text-right',
  discount: 'text-right',
  total: 'text-right',
};

function colClass(key: string) {
  return `${COL_WIDTHS[key] || ''} ${COL_ALIGN[key] || 'text-left'}`;
}

// ─── Doc type labels ─────────────────────────────────────────────

const DOC_LABELS: Record<DocType, { create: string; edit: string; view: string }> = {
  invoice: { create: 'Nouvelle facture', edit: 'Modifier la facture', view: 'Facture' },
  quote: { create: 'Nouveau devis', edit: 'Modifier le devis', view: 'Devis' },
  return: { create: 'Facture de retour', edit: 'Modifier le retour', view: 'Retour' },
  credit_note: { create: 'Nouvel avoir', edit: 'Modifier l\'avoir', view: 'Avoir' },
};

// ─── Main Component ──────────────────────────────────────────────

export function DocumentEditor(props: DocumentEditorProps) {
  const {
    docType, mode, articles, customers, headerForm, setHeaderForm,
    items, setItems, subtotal, saving, onSave, onClose,
    editingId, documentNumber, documentStatus,
    docSettings, autoMode, onVehiclePicker,
    onCreateArticle, onCreateCustomer, reps,
    paymentMethods, payments, setPayments, totalPaid = 0,
    isCredit, setIsCredit,
    isPharmacy, ipmLoading, ipmBeneficiaire, ipmTaux, ipmConvention,
    ipmPartIpm = 0, ipmPartClient = 0, ipmConfig,
    ipmDocuments, setIpmDocuments, ipmDocValidation,
    onChangeStatus, onConvert, onPrint,
    onTransformToReturn, onTransformToAvoir,
    transformReturnLines, loadReturnLines,
    onRefundCash, onApproveAvoir,
    onEdit, onPay, onCopyLink, onWhatsApp, onCancel, onComptabiliser,
    accountingStatus, invoiceDue = 0,
  } = props;
  const { onPrev, onNext, hasPrev, hasNext, onSearchOpen, postCreation, onNewInvoice, docCreatedInfo } = props;

  const isView = mode === 'view';
  const isCreate = mode === 'create';
  const isEdit = mode === 'edit';
  const canEdit = isCreate || isEdit;

  const [headerValidated, setHeaderValidated] = useState(!docSettings.require_header_lock);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const emptyInput = { article_id: null as string | null, name: '', quantity: 1, unit_price: 0, discount: 0 };
  const [inputRow, setInputRow] = useState(emptyInput);
  const inputRefRef = useRef<HTMLInputElement>(null);
  const inputQtyRef = useRef<HTMLInputElement>(null);
  const [articleSearchQuery, setArticleSearchQuery] = useState('');
  const [articleSearchOpen, setArticleSearchOpen] = useState(false);

  // Payment state (invoice only)
  const [payMethodId, setPayMethodId] = useState(paymentMethods?.[0]?.id || '');
  const [payAmt, setPayAmt] = useState('');

  const validItems = useMemo(() => items.filter(it => it.name.trim() && (it.unit_price > 0 || it.total > 0)), [items]);

  const cols = useMemo(() => {
    const raw = docSettings.columns_config?.length ? docSettings.columns_config : DEFAULT_COLUMNS;
    return raw.filter(c => c.visible).sort((a, b) => a.order - b.order);
  }, [docSettings.columns_config]);

  const itemsLocked = docSettings.require_header_lock && !headerValidated;

  const repLabel = useCallback((id?: string | null) => {
    const r = (reps || []).find(x => x.id === id);
    return r ? repDisplayName(r) : '';
  }, [reps]);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Escape handler
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

  const calc = (q: number, p: number, d: number) => Math.max(0, (q || 1) * p - (d || 0));

  const commitRow = () => {
    if (!inputRow.name.trim() || inputRow.unit_price <= 0) return;
    const total = calc(inputRow.quantity, inputRow.unit_price, inputRow.discount);
    const item: DocLineItem = { ...inputRow, quantity: inputRow.quantity || 1, discount: inputRow.discount || 0, total };
    if (editingIdx !== null) {
      setItems((prev: DocLineItem[]) => prev.map((it: DocLineItem, i: number) => i === editingIdx ? item : it));
      setEditingIdx(null);
    } else {
      setItems((prev: DocLineItem[]) => {
        const kept = prev.filter((it: DocLineItem) => it.name.trim());
        return [...kept, item];
      });
    }
    setInputRow(emptyInput);
    setArticleSearchQuery('');
    setTimeout(() => inputRefRef.current?.focus(), 30);
    if (canEdit && docType === 'quote') setTimeout(() => onSave?.({ silent: true }), 100);
  };

  const startEdit = (vIdx: number) => {
    if (isView) return;
    const it = validItems[vIdx];
    const realIdx = items.indexOf(it);
    setEditingIdx(realIdx);
    setInputRow({ article_id: it.article_id, name: it.name, quantity: it.quantity, unit_price: it.unit_price, discount: it.discount });
    const art = it.article_id ? articles.find((a: any) => a.id === it.article_id) : null;
    setArticleSearchQuery(art?.internal_ref || art?.name || it.name);
    setTimeout(() => inputRefRef.current?.focus(), 30);
  };

  const cancelEdit = () => { setEditingIdx(null); setInputRow(emptyInput); setArticleSearchQuery(''); };

  const removeItem = (vIdx: number) => {
    const it = validItems[vIdx];
    const realIdx = items.indexOf(it);
    if (editingIdx === realIdx) cancelEdit();
    setItems((p: DocLineItem[]) => p.filter((_: DocLineItem, i: number) => i !== realIdx));
  };

  const pickArticle = (a: any) => {
    setInputRow(prev => ({ ...prev, article_id: a.id, name: a.name, unit_price: a.sale_price || prev.unit_price }));
    setArticleSearchQuery(a.internal_ref || a.name);
    setArticleSearchOpen(false);
    setTimeout(() => inputQtyRef.current?.focus(), 30);
  };

  // Article search field handlers
  const handleArticleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (articleSearchQuery.trim() && !inputRow.article_id) {
        e.preventDefault();
        setArticleSearchOpen(true);
        return;
      }
      if (e.key === 'Tab' && inputRow.article_id) return; // normal tab
      if (e.key === 'Enter') { e.preventDefault(); commitRow(); }
    }
  };

  const handleInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commitRow(); }
  };

  // Payment logic (invoice)
  const addPayment = () => {
    if (!setPayments || !paymentMethods) return;
    const amt = Number(payAmt);
    if (!amt || amt <= 0) return;
    const pm = paymentMethods.find((m: any) => m.id === payMethodId);
    if (!pm) return;
    setPayments((prev: any[]) => [...prev, { method_id: pm.id, method_name: pm.name, amount: amt, reference: '' }]);
    setPayAmt('');
  };

  const clientDue = ipmBeneficiaire && ipmPartIpm > 0 ? ipmPartClient : subtotal;
  const balance = clientDue - totalPaid;

  const labels = DOC_LABELS[docType];
  const title = postCreation
    ? `Facture ${postCreation.saleNumber}`
    : isView
      ? `${labels.view}${documentNumber ? ` ${documentNumber}` : ''}`
      : editingId ? labels.edit : labels.create;

  const inputCls = 'w-full text-xs h-7 px-2 bg-white border border-neutral-300 rounded focus:border-neutral-500 focus:ring-1 focus:ring-neutral-200 outline-none transition-all';
  const headerInputCls = 'w-full text-xs h-8 px-2 bg-transparent border-b border-neutral-300 focus:border-neutral-900 outline-none transition-colors';

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-white animate-fade-in">

      {/* ═══ Title bar ═══ */}
      <div className="flex items-center justify-between px-4 h-11 border-b border-neutral-200 flex-shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Navigation arrows */}
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
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-500 uppercase tracking-wider">{documentStatus}</span>
          )}
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin text-neutral-400 shrink-0" />}
        </div>
        <DocumentToolbar
          docType={docType}
          mode={postCreation ? 'view' : mode}
          saving={saving}
          onSave={postCreation ? () => {} : onSave}
          onClose={onClose}
          onPrint={onPrint}
          onConvert={onConvert}
          onChangeStatus={onChangeStatus}
          documentStatus={documentStatus}
          editingId={editingId}
          ipmDocValidation={ipmDocValidation}
          ipmBeneficiaire={ipmBeneficiaire}
          onTransformToReturn={onTransformToReturn}
          onTransformToAvoir={onTransformToAvoir}
          transformReturnLines={transformReturnLines}
          loadReturnLines={loadReturnLines}
          articles={articles}
          onEdit={onEdit}
          onPay={onPay}
          onCopyLink={onCopyLink}
          onWhatsApp={onWhatsApp}
          onCancel={onCancel}
          onComptabiliser={onComptabiliser}
          accountingStatus={accountingStatus}
          invoiceDue={invoiceDue}
          onRefundCash={onRefundCash}
          onApproveAvoir={onApproveAvoir}
          onSearchOpen={onSearchOpen}
          onNewInvoice={postCreation ? onNewInvoice : undefined}
        />
      </div>

      {/* ═══ Header fields ═══ */}
      {canEdit && (
        headerValidated ? (
          <ValidatedHeader
            headerForm={headerForm}
            customers={customers}
            docSettings={docSettings}
            repLabel={repLabel}
            onUnlock={() => setHeaderValidated(false)}
          />
        ) : (
          <EditableHeader
            headerForm={headerForm}
            setHeaderForm={setHeaderForm}
            customers={customers}
            docSettings={docSettings}
            docType={docType}
            autoMode={autoMode}
            onVehiclePicker={onVehiclePicker}
            onCreateCustomer={onCreateCustomer}
            reps={reps}
            headerInputCls={headerInputCls}
            onValidate={docSettings.require_header_lock ? () => setHeaderValidated(true) : undefined}
            postCreation={postCreation}
            totalPaid={totalPaid}
          />
        )
      )}

      {isView && headerForm.customer_id && (
        <div className="px-4 py-1.5 border-b border-neutral-100 bg-neutral-50/50 flex-shrink-0">
          <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
            {headerForm.customer_id && <span className="font-medium text-neutral-700">{customers.find((c: any) => c.id === headerForm.customer_id)?.name || ''}</span>}
            {headerForm.doc_date && <span className="text-neutral-500">Date: {headerForm.doc_date}</span>}
            {headerForm.reference && <span className="text-neutral-500">Ref: {headerForm.reference}</span>}
            {headerForm.delivery_date && <span className="text-neutral-500">Livr: {headerForm.delivery_date}</span>}
            {headerForm.warranty && <span className="text-neutral-500">Gar: {headerForm.warranty}</span>}
            {headerForm.imei && <span className="text-neutral-500">IMEI: {headerForm.imei}</span>}
            {headerForm.representative && <span className="text-neutral-500">Rep: {repLabel(headerForm.representative)}</span>}
            {headerForm.note && <span className="text-neutral-400 italic truncate max-w-[200px]">"{headerForm.note}"</span>}
          </div>
        </div>
      )}

      {/* IPM Banner */}
      {isPharmacy && headerForm.customer_id && (
        <IpmBanner
          ipmLoading={ipmLoading}
          ipmBeneficiaire={ipmBeneficiaire}
          ipmTaux={ipmTaux}
          ipmConvention={ipmConvention}
          ipmPartIpm={ipmPartIpm}
          ipmPartClient={ipmPartClient}
          ipmConfig={ipmConfig}
          ipmDocuments={ipmDocuments}
          setIpmDocuments={setIpmDocuments}
          ipmDocValidation={ipmDocValidation}
          subtotal={subtotal}
        />
      )}

      {/* ═══ Column headers ═══ */}
      <div className="flex-shrink-0 border-b border-neutral-200 bg-neutral-50/70">
        <div className="flex items-center px-2 h-7">
          <div className="w-8 shrink-0" />
          {cols.map(col => (
            <div key={col.key} className={`px-2 text-[10px] font-bold text-neutral-500 uppercase tracking-wider ${colClass(col.key)}`}>
              {col.label}
            </div>
          ))}
          {canEdit && <div className="w-8 shrink-0" />}
        </div>
      </div>

      {/* ═══ Input row (create/edit only) ═══ */}
      {canEdit && (
        <div className={`flex-shrink-0 border-b-2 border-neutral-300 bg-neutral-50/40 ${itemsLocked ? 'pointer-events-none opacity-30' : ''}`}>
          {itemsLocked ? (
            <div className="flex items-center justify-center py-3 gap-2">
              <Lock className="w-4 h-4 text-neutral-300" />
              <span className="text-xs text-neutral-400">Validez l'en-tête</span>
            </div>
          ) : (
            <div className="flex items-center px-2 py-1">
              <div className="w-8 shrink-0 text-center">
                {editingIdx !== null ? (
                  <button onClick={cancelEdit} className="p-0.5 rounded hover:bg-neutral-200 text-neutral-400" title="Annuler"><X className="w-3 h-3" /></button>
                ) : (
                  <span className="text-[9px] font-bold text-neutral-300">+</span>
                )}
              </div>
              {cols.map(col => {
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
                            if (inputRow.article_id) setInputRow(p => ({ ...p, article_id: null, name: '', unit_price: 0 }));
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
                        placeholder="Designation"
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
                        value={inputRow.quantity || ''}
                        onChange={e => setInputRow(p => ({ ...p, quantity: Number(e.target.value) || 0 }))}
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
                  case 'discount': return (
                    <div key="discount" className={w}>
                      <input
                        type="number"
                        value={inputRow.discount || ''}
                        onChange={e => setInputRow(p => ({ ...p, discount: Number(e.target.value) || 0 }))}
                        onKeyDown={handleInputKey}
                        className={inputCls + ' text-right num'}
                      />
                    </div>
                  );
                  case 'total': return (
                    <div key="total" className={`${COL_WIDTHS[col.key]} px-1 text-right`}>
                      <span className="text-xs font-bold text-neutral-800 num leading-7">{formatNum(calc(inputRow.quantity, inputRow.unit_price, inputRow.discount))}</span>
                    </div>
                  );
                  default: return null;
                }
              })}
              <div className="w-8 shrink-0 text-center">
                <button onClick={commitRow} disabled={!inputRow.name.trim() || inputRow.unit_price <= 0} className="p-1 rounded bg-neutral-900 text-white disabled:opacity-20 hover:bg-neutral-700 transition-colors" title="Valider (Entree)"><Check className="w-3 h-3" /></button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ Validated rows (scrollable) ═══ */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {validItems.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-neutral-300 text-xs select-none">
            {canEdit ? 'Saisissez un article et appuyez Entrée' : 'Aucun article'}
          </div>
        ) : (
          <div>
            {validItems.map((it, vIdx) => {
              const isEditingThis = editingIdx !== null && items.indexOf(it) === editingIdx;
              return (
                <div
                  key={vIdx}
                  onClick={() => { if (canEdit && !isEditingThis) startEdit(vIdx); }}
                  className={`flex items-center px-2 border-b border-neutral-100 transition-colors group ${
                    canEdit ? 'cursor-pointer' : ''
                  } ${isEditingThis ? 'bg-amber-50/50' : canEdit ? 'hover:bg-neutral-50' : ''}`}
                  style={{ height: '28px' }}
                >
                  <div className="w-8 shrink-0 text-center">
                    <span className="text-[10px] text-neutral-300 group-hover:text-neutral-500 tabular-nums">{vIdx + 1}</span>
                  </div>
                  {cols.map(col => {
                    const base = `px-2 text-xs truncate ${colClass(col.key)}`;
                    switch (col.key) {
                      case 'article': return (
                        <div key="article" className={`${base} text-neutral-500`}>
                          {it.article_id ? (articles.find((a: any) => a.id === it.article_id)?.internal_ref || '—') : '—'}
                        </div>
                      );
                      case 'designation': return (
                        <div key="designation" className={`${base} font-medium text-neutral-800`}>
                          {it.name}
                          {it.tier_name && <span className="text-[9px] text-neutral-400 ml-1">{it.tier_name}</span>}
                        </div>
                      );
                      case 'qty': return <div key="qty" className={`${base} text-neutral-700 num`}>{it.quantity}</div>;
                      case 'unit_price': return <div key="unit_price" className={`${base} text-neutral-700 num`}>{formatNum(it.unit_price)}</div>;
                      case 'discount': return <div key="discount" className={`${base} text-neutral-400 num`}>{it.discount > 0 ? formatNum(it.discount) : '—'}</div>;
                      case 'total': return <div key="total" className={`${base} font-semibold text-neutral-900 num`}>{formatNum(it.total)}</div>;
                      default: return null;
                    }
                  })}
                  {canEdit && (
                    <div className="w-8 shrink-0 text-center">
                      <button onClick={e => { e.stopPropagation(); removeItem(vIdx); }} className="p-0.5 rounded text-neutral-200 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Payment section (invoice create/edit only) */}
        {docType === 'invoice' && canEdit && !editingId && validItems.length > 0 && paymentMethods && setPayments && (
          <PaymentSection
            ipmBeneficiaire={ipmBeneficiaire}
            ipmPartIpm={ipmPartIpm}
            ipmPartClient={ipmPartClient}
            isCredit={isCredit}
            setIsCredit={setIsCredit}
            paymentMethods={paymentMethods}
            payments={payments || []}
            setPayments={setPayments}
            balance={balance}
            payMethodId={payMethodId}
            setPayMethodId={setPayMethodId}
            payAmt={payAmt}
            setPayAmt={setPayAmt}
            addPayment={addPayment}
          />
        )}
      </div>

      {/* ═══ Footer ═══ */}
      <div className="border-t border-neutral-200 bg-white px-4 py-2 flex flex-col gap-1 flex-shrink-0">
        {(postCreation || docCreatedInfo) && (() => {
          const info = postCreation || docCreatedInfo!;
          return (
            <div className="text-[10px] text-neutral-400">
              Créée le {new Date(info.createdAt).toLocaleDateString('fr-FR')} à {new Date(info.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} par {info.createdBy}
            </div>
          );
        })()}
        <div className="flex items-center justify-between">
        <span className="text-[11px] text-neutral-500 tabular-nums">
          {validItems.length} ligne{validItems.length !== 1 ? 's' : ''}
          {(payments?.length || 0) > 0 && ` · ${payments!.length} règl.`}
        </span>
        <div className="flex items-center gap-0 divide-x divide-neutral-200">
          {ipmBeneficiaire && ipmPartIpm > 0 && <span className="text-xs font-bold text-teal-600 num px-3 min-w-[100px] text-right">IPM {formatFCFA(ipmPartIpm)}</span>}
          {ipmBeneficiaire && ipmPartIpm > 0 && <span className="text-xs font-bold text-neutral-600 num px-3 min-w-[100px] text-right">Client {formatFCFA(ipmPartClient)}</span>}
          {totalPaid > 0 && <span className="text-xs font-bold text-emerald-600 num px-3 min-w-[100px] text-right">Payé {formatFCFA(totalPaid)}</span>}
          {balance > 0 && totalPaid > 0 && <span className="text-xs font-bold text-amber-600 num px-3 min-w-[100px] text-right">Reste {formatFCFA(balance)}</span>}
          <span className="text-xs font-black text-neutral-900 num px-3 min-w-[100px] text-right">TOTAL {formatFCFA(subtotal)}</span>
        </div>
        </div>
      </div>

      {/* ═══ Article Search Modal ═══ */}
      {articleSearchOpen && (
        <ArticleSearchModal
          articles={articles}
          initialQuery={articleSearchQuery}
          onSelect={pickArticle}
          onClose={() => setArticleSearchOpen(false)}
          cols={cols}
        />
      )}
    </div>
  );
}

// ─── Toolbar ─────────────────────────────────────────────────────

function DocumentToolbar({ docType, mode, saving, onSave, onClose, onPrint, onConvert, onChangeStatus, documentStatus, editingId, ipmDocValidation, ipmBeneficiaire, onTransformToReturn, onTransformToAvoir, transformReturnLines, loadReturnLines, articles, onEdit, onPay, onCopyLink, onWhatsApp, onCancel, onComptabiliser, accountingStatus, invoiceDue, onRefundCash, onApproveAvoir, onSearchOpen, onNewInvoice }: {
  docType: DocType;
  mode: DocMode;
  saving: boolean;
  onSave?: (opts?: { silent?: boolean }) => void;
  onClose: () => void;
  onPrint?: () => void;
  onConvert?: () => void;
  onChangeStatus?: (status: string) => void;
  documentStatus?: string;
  editingId?: string | null;
  ipmDocValidation?: { valide: boolean; champs_manquants: string[] };
  ipmBeneficiaire?: any;
  onTransformToReturn?: (config: { reason: string; restock: boolean; selectedItems: ReturnLineItem[] }) => void;
  onTransformToAvoir?: () => void;
  transformReturnLines?: ReturnLineItem[];
  loadReturnLines?: (saleId: string) => void;
  articles?: any[];
  onEdit?: () => void;
  onPay?: () => void;
  onCopyLink?: () => void;
  onWhatsApp?: () => void;
  onCancel?: () => void;
  onComptabiliser?: () => void;
  accountingStatus?: string;
  invoiceDue?: number;
  onRefundCash?: () => void;
  onApproveAvoir?: () => void;
  onSearchOpen?: () => void;
  onNewInvoice?: () => void;
}) {
  const canEdit = mode === 'create' || mode === 'edit';
  const btnCls = 'flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded transition-colors';
  const btnLight = `${btnCls} text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100`;

  const [transformOpen, setTransformOpen] = useState(false);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const transformRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (transformRef.current && !transformRef.current.contains(e.target as Node)) setTransformOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Determine available transformations
  const transformations: { key: string; label: string; icon: any; action: () => void }[] = [];

  if (docType === 'quote' && editingId && documentStatus === 'accepted' && onConvert) {
    transformations.push({ key: 'to_invoice', label: 'Convertir en facture', icon: ArrowRight, action: () => { setTransformOpen(false); onConvert(); } });
  }
  if (docType === 'invoice' && editingId && onTransformToReturn) {
    transformations.push({ key: 'to_return', label: 'Facture de retour', icon: RotateCcw, action: () => {
      setTransformOpen(false);
      if (loadReturnLines && editingId) loadReturnLines(editingId);
      setReturnDialogOpen(true);
    }});
  }
  if (docType === 'return' && editingId && onTransformToAvoir && documentStatus === 'pending') {
    transformations.push({ key: 'to_avoir', label: 'Transformer en avoir', icon: CreditCard, action: () => { setTransformOpen(false); onTransformToAvoir(); } });
  }

  const hasTransformations = transformations.length > 0;
  const isView = mode === 'view';
  const notCancelled = documentStatus !== 'cancelled';
  const notAccounted = accountingStatus !== 'accounted';

  return (
    <div className="flex items-center gap-0.5 shrink-0">
      {/* View-mode actions */}
      {isView && editingId && (
        <>
          {onEdit && notCancelled && notAccounted && (
            <button onClick={onEdit} className={btnLight}><Pencil className="w-3 h-3" /> Modifier</button>
          )}
          {onPay && docType === 'invoice' && (invoiceDue ?? 0) > 0 && notCancelled && (
            <button onClick={onPay} className={`${btnCls} text-emerald-700 hover:bg-emerald-50`}><Coins className="w-3 h-3" /> Régler</button>
          )}
          {false && onComptabiliser && docType === 'invoice' && notAccounted && notCancelled && (
            <button onClick={onComptabiliser} className={`${btnCls} text-teal-700 hover:bg-teal-50`}><BookOpen className="w-3 h-3" /> Comptabiliser</button>
          )}
          {accountingStatus === 'accounted' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-teal-50 text-teal-700 border border-teal-200"><BookOpen className="w-3 h-3" />Comptabilisé</span>
          )}
          {onCopyLink && (
            <button onClick={onCopyLink} className={btnLight}><Link2 className="w-3 h-3" /> Lien</button>
          )}
          {onWhatsApp && (
            <button onClick={onWhatsApp} className={`${btnCls} text-green-600 hover:bg-green-50`}><MessageCircle className="w-3 h-3" /> WhatsApp</button>
          )}
          {onCancel && notCancelled && notAccounted && (
            <button onClick={onCancel} className={`${btnCls} text-rose-600 hover:bg-rose-50`}><Ban className="w-3 h-3" /> Annuler</button>
          )}
        </>
      )}

      {/* Quote status actions */}
      {docType === 'quote' && editingId && onChangeStatus && (
        <>
          {documentStatus === 'draft' && (
            <button onClick={() => onChangeStatus('sent')} className={btnLight}><Check className="w-3 h-3" /> Envoyé</button>
          )}
          {(documentStatus === 'draft' || documentStatus === 'sent') && (
            <button onClick={() => onChangeStatus('accepted')} className={btnLight}><Check className="w-3 h-3" /> Accepter</button>
          )}
        </>
      )}

      {/* Return-specific actions */}
      {docType === 'return' && isView && editingId && documentStatus === 'pending' && (
        <>
          {onRefundCash && (
            <button onClick={onRefundCash} className={`${btnCls} text-emerald-700 hover:bg-emerald-50`}><Coins className="w-3 h-3" /> Rembourser</button>
          )}
          {onApproveAvoir && (
            <button onClick={onApproveAvoir} className={`${btnCls} text-blue-700 hover:bg-blue-50`}><CreditCard className="w-3 h-3" /> Avoir</button>
          )}
        </>
      )}

      {/* Print */}
      {onPrint && editingId && (
        <button onClick={onPrint} className={btnLight}><Printer className="w-3 h-3" /> Imprimer</button>
      )}

      {/* Transformer dropdown */}
      {hasTransformations && (
        <div className="relative" ref={transformRef}>
          <button onClick={() => setTransformOpen(!transformOpen)} className={btnLight}>
            <RefreshCw className="w-3 h-3" /> Transformer <ChevronDown className="w-2.5 h-2.5" />
          </button>
          {transformOpen && (
            <div className="absolute right-0 top-full mt-1 bg-white border border-neutral-200 rounded-lg shadow-lg py-1 w-52 z-20">
              {transformations.map(t => (
                <button key={t.key} onClick={t.action} className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-neutral-50 text-neutral-700 transition-colors">
                  <t.icon className="w-3.5 h-3.5 text-neutral-400" />
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Search / jump to document */}
      {onSearchOpen && (
        <button onClick={onSearchOpen} className={btnLight} title="Atteindre une facture"><Search className="w-3 h-3" /> Atteindre</button>
      )}

      {/* Separator */}
      {editingId && <div className="w-px h-4 bg-neutral-200 mx-1" />}

      {/* Nouveau (post-creation) */}
      {onNewInvoice && (
        <button onClick={onNewInvoice} className="flex items-center gap-1 px-3 py-1 text-[11px] font-semibold text-white bg-neutral-900 hover:bg-neutral-800 rounded transition-colors"><Plus className="w-3 h-3" />Nouveau</button>
      )}

      {/* Close */}
      <button onClick={onClose} className={`${btnCls} text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100`}>
        Fermer
      </button>

      {/* Save */}
      {canEdit && (
        <button
          onClick={() => onSave()}
          disabled={saving || (ipmBeneficiaire && ipmDocValidation && !ipmDocValidation.valide)}
          className="flex items-center gap-1 px-3 py-1 text-[11px] font-semibold bg-neutral-900 text-white rounded hover:bg-neutral-800 disabled:opacity-40 transition-colors"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
          {editingId ? 'Mettre à jour' : 'Enregistrer'}
        </button>
      )}

      {/* Return config dialog (intermediate step) */}
      {returnDialogOpen && onTransformToReturn && (
        <ReturnConfigDialog
          lines={transformReturnLines || []}
          onConfirm={(config) => { setReturnDialogOpen(false); onTransformToReturn(config); }}
          onClose={() => setReturnDialogOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Return Config Dialog (intermediate step) ───────────────────

function ReturnConfigDialog({ lines, onConfirm, onClose }: {
  lines: ReturnLineItem[];
  onConfirm: (config: { reason: string; restock: boolean; selectedItems: ReturnLineItem[] }) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);
  const [localLines, setLocalLines] = useState<ReturnLineItem[]>([]);

  useEffect(() => { setLocalLines(lines.map(l => ({ ...l }))); }, [lines]);

  const toggleItem = (idx: number) => setLocalLines(p => p.map((x, i) => i === idx ? { ...x, selected: !x.selected } : x));
  const setQty = (idx: number, q: number) => setLocalLines(p => p.map((x, i) => i === idx ? { ...x, quantity: Math.min(x.max_qty, Math.max(1, q)) } : x));
  const selected = localLines.filter(i => i.selected && i.quantity > 0);
  const total = selected.reduce((s, i) => s + i.quantity * i.unit_price, 0);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/20" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white w-full max-w-sm rounded-lg shadow-xl mx-4 flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 bg-neutral-900 rounded-t-lg flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="text-sm font-bold text-white">Facture de retour</h3>
            <p className="text-[11px] text-neutral-400 mt-0.5">Sélectionnez les articles à retourner</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-neutral-400"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-3">
          {localLines.length === 0 ? (
            <div className="py-6 text-center text-xs text-neutral-400">Tous les articles de cette facture ont déjà été retournés.</div>
          ) : (
            <div className="space-y-1">
              {localLines.map((it, idx) => (
                <div key={idx} className={`flex items-center gap-2 px-2 py-2 border-b border-neutral-100 transition-colors ${it.selected ? 'bg-neutral-50/50' : ''}`}>
                  <button type="button" onClick={() => toggleItem(idx)} className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all ${it.selected ? 'bg-neutral-900 border-neutral-900' : 'bg-white border-neutral-300'}`}>
                    {it.selected && <Check className="w-2.5 h-2.5 text-white" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-neutral-800 truncate">{it.name}</div>
                    <div className="text-[10px] text-neutral-500 num">{formatNum(it.unit_price)} x max {it.max_qty}</div>
                  </div>
                  {it.selected && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button type="button" onClick={() => setQty(idx, it.quantity - 1)} className="w-6 h-6 rounded bg-neutral-200 flex items-center justify-center hover:bg-neutral-300"><Minus className="w-3 h-3" /></button>
                      <input type="number" value={it.quantity} onChange={e => setQty(idx, Number(e.target.value))} min={1} max={it.max_qty} className="w-8 text-center text-xs font-bold num bg-transparent outline-none" />
                      <button type="button" onClick={() => setQty(idx, it.quantity + 1)} className="w-6 h-6 rounded bg-neutral-200 flex items-center justify-center hover:bg-neutral-300"><Plus className="w-3 h-3" /></button>
                    </div>
                  )}
                  <span className="num text-xs font-bold text-neutral-700 shrink-0 w-16 text-right">
                    {it.selected ? formatNum(it.quantity * it.unit_price) : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div>
            <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1 block">Motif du retour</label>
            <input value={reason} onChange={e => setReason(e.target.value)} className="w-full text-xs h-8 px-1 bg-transparent border-b border-neutral-300 focus:border-neutral-900 outline-none transition-colors" placeholder="Motif..." />
          </div>

          <label className="flex items-center gap-2 cursor-pointer px-2 py-2">
            <input type="checkbox" checked={restock} onChange={e => setRestock(e.target.checked)} className="w-3.5 h-3.5 rounded" />
            <span className="text-xs font-medium text-neutral-700">Remettre en stock automatiquement</span>
          </label>

          {selected.length > 0 && (
            <div className="flex items-center justify-between px-2 py-2 border-t border-neutral-200">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Total retour</div>
                <div className="text-[10px] text-neutral-400">{selected.length} article{selected.length > 1 ? 's' : ''}</div>
              </div>
              <div className="num text-base font-bold text-neutral-900">{formatFCFA(total)}</div>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-neutral-100 flex items-center justify-end gap-2 flex-shrink-0">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-700 transition-colors">Annuler</button>
          <button
            onClick={() => onConfirm({ reason, restock, selectedItems: selected })}
            disabled={selected.length === 0}
            className="px-4 py-1.5 text-xs font-semibold bg-neutral-900 text-white rounded hover:bg-neutral-800 disabled:opacity-40 transition-colors flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" /> Créer le retour
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Validated Header (collapsed) ────────────────────────────────

function ValidatedHeader({ headerForm, customers, docSettings, repLabel, onUnlock }: {
  headerForm: DocHeaderForm;
  customers: any[];
  docSettings: DocSettings;
  repLabel: (id?: string | null) => string;
  onUnlock: () => void;
}) {
  return (
    <div className="px-4 py-1.5 border-b border-neutral-100 bg-neutral-50/50 flex-shrink-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 min-w-0 text-[11px]">
          <span className="font-semibold text-emerald-700 flex items-center gap-1"><Lock className="w-3 h-3" />Valide</span>
          {headerForm.customer_id && <span className="text-neutral-700 font-medium truncate max-w-[160px]">{customers.find((c: any) => c.id === headerForm.customer_id)?.name || ''}</span>}
          {headerForm.reference && <span className="text-neutral-500">Ref: {headerForm.reference}</span>}
          {headerForm.delivery_date && <span className="text-neutral-500">Livr: {headerForm.delivery_date}</span>}
          {headerForm.warranty && <span className="text-neutral-500 truncate max-w-[120px]">Gar: {headerForm.warranty}</span>}
          {headerForm.imei && <span className="text-neutral-500 truncate max-w-[140px]">IMEI: {headerForm.imei}</span>}
          {headerForm.representative && <span className="text-neutral-500">Rep: {repLabel(headerForm.representative)}</span>}
          {headerForm.doc_date && <span className="text-neutral-500">Date: {headerForm.doc_date}</span>}
        </div>
        <button onClick={onUnlock} className="text-[10px] font-medium text-neutral-500 hover:text-neutral-700 underline underline-offset-2 shrink-0">Modifier</button>
      </div>
    </div>
  );
}

// ─── Editable Header ─────────────────────────────────────────────

function EditableHeader({ headerForm, setHeaderForm, customers, docSettings, docType, autoMode, onVehiclePicker, onCreateCustomer, reps, headerInputCls, onValidate, postCreation, totalPaid }: {
  headerForm: DocHeaderForm;
  setHeaderForm: (fn: any) => void;
  customers: any[];
  docSettings: DocSettings;
  docType: DocType;
  autoMode?: boolean;
  onVehiclePicker?: (idx: number | null) => void;
  onCreateCustomer?: (name: string) => void;
  reps?: SalesRepresentative[];
  headerInputCls: string;
  onValidate?: () => void;
  postCreation?: { saleNumber: string; createdAt: string; createdBy: string } | null;
  totalPaid?: number;
}) {
  const isLocked = !!postCreation;
  const dateLocked = isLocked || (totalPaid || 0) > 0;
  return (
    <div className={`px-4 py-2 border-b flex-shrink-0 ${onValidate ? 'border-neutral-200 bg-neutral-50/60' : 'border-neutral-100'}`}>
      {onValidate && (
        <div className="flex items-center gap-1.5 mb-2">
          <Lock className="w-3 h-3 text-neutral-500" />
          <span className="text-[10px] font-bold text-neutral-600 uppercase tracking-wide">Valider l'en-tête avant la saisie</span>
        </div>
      )}
      <div className="grid grid-cols-[1fr] sm:grid-cols-2 lg:grid-cols-4 gap-x-3 gap-y-2 items-end">
        <div>
          <label className="text-[10px] font-medium text-neutral-500 mb-0.5 block">Client</label>
          {isLocked ? (
            <span className="text-xs font-medium text-neutral-800 h-8 flex items-center">{customers.find((c: any) => c.id === headerForm.customer_id)?.name || '—'}</span>
          ) : (
            <CustomerSearchInline
              customers={customers}
              value={headerForm.customer_id}
              onSelect={(c) => setHeaderForm((f: any) => ({ ...f, customer_id: c?.id || '' }))}
              onCreateNew={onCreateCustomer}
            />
          )}
        </div>
        <div>
          <label className="text-[10px] font-medium text-neutral-500 mb-0.5 block">Date</label>
          {dateLocked ? (
            <span className="text-xs font-medium text-neutral-800 h-8 flex items-center">{headerForm.doc_date || '—'}</span>
          ) : (
            <input type="date" value={headerForm.doc_date} onChange={e => setHeaderForm((f: any) => ({ ...f, doc_date: e.target.value }))} className={headerInputCls} />
          )}
        </div>
        {docType === 'quote' && (
          <div>
            <label className="text-[10px] font-medium text-neutral-500 mb-0.5 block">Note</label>
            <input value={headerForm.note} onChange={e => setHeaderForm((f: any) => ({ ...f, note: e.target.value }))} placeholder="Note optionnelle..." className={headerInputCls} disabled={isLocked} />
          </div>
        )}
        {docType === 'quote' && (
          <div>
            <label className="text-[10px] font-medium text-neutral-500 mb-0.5 block">Valide jusqu'au</label>
            <input type="date" value={headerForm.valid_until} onChange={e => setHeaderForm((f: any) => ({ ...f, valid_until: e.target.value }))} className={headerInputCls} disabled={isLocked} />
          </div>
        )}
        {docSettings.show_reference && (
          <div><label className="text-[10px] font-medium text-neutral-500 mb-0.5 block">Référence</label><input value={headerForm.reference} onChange={e => setHeaderForm((f: any) => ({ ...f, reference: e.target.value }))} placeholder="REF-..." className={headerInputCls} disabled={isLocked} /></div>
        )}
        {docSettings.show_delivery_date && (
          <div><label className="text-[10px] font-medium text-neutral-500 mb-0.5 block">Date de livraison</label><input type="date" value={headerForm.delivery_date} onChange={e => setHeaderForm((f: any) => ({ ...f, delivery_date: e.target.value }))} className={headerInputCls} disabled={isLocked} /></div>
        )}
        {docSettings.show_warranty && (
          <div><label className="text-[10px] font-medium text-neutral-500 mb-0.5 block">Garantie</label><input value={headerForm.warranty} onChange={e => setHeaderForm((f: any) => ({ ...f, warranty: e.target.value }))} placeholder="Ex: 6 mois" className={headerInputCls} disabled={isLocked} /></div>
        )}
        {docSettings.show_imei && (
          <div><label className="text-[10px] font-medium text-neutral-500 mb-0.5 block">IMEI / Téléphone</label><input value={headerForm.imei} onChange={e => setHeaderForm((f: any) => ({ ...f, imei: e.target.value }))} placeholder="Numéro..." className={headerInputCls} disabled={isLocked} /></div>
        )}
        {docSettings.show_representative && (
          <div><label className="text-[10px] font-medium text-neutral-500 mb-0.5 block">Représentant</label>
            <select value={headerForm.representative} onChange={e => setHeaderForm((f: any) => ({ ...f, representative: e.target.value }))} className={headerInputCls + ' cursor-pointer'}>
              <option value="">Aucun</option>
              {(reps || []).map(r => <option key={r.id} value={r.id}>{repDisplayName(r)}</option>)}
            </select>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 mt-2">
        {autoMode && onVehiclePicker && (
          <button onClick={() => onVehiclePicker(null)} className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded bg-neutral-100 text-neutral-600 hover:bg-neutral-200 transition-colors"><Car className="w-3 h-3" />Par véhicule</button>
        )}
        {onValidate && (
          <button onClick={onValidate} className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-semibold bg-neutral-900 text-white hover:bg-neutral-800 transition-colors ml-auto"><Lock className="w-3 h-3" /> Valider</button>
        )}
      </div>
    </div>
  );
}

// ─── Customer Search (inline, for header) ────────────────────────

function CustomerSearchInline({ customers, value, onSelect, onCreateNew }: {
  customers: any[];
  value: string;
  onSelect: (c: any) => void;
  onCreateNew?: (name: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const selected = customers.find((c: any) => c.id === value);

  useEffect(() => {
    if (!open) setQuery(selected?.name || '');
  }, [open, selected]);

  const filtered = useMemo(() => {
    if (!query.trim()) return customers.slice(0, 20);
    const q = query.toLowerCase().trim();
    return customers.filter((c: any) => c.name.toLowerCase().includes(q) || (c.phone || '').includes(q)).slice(0, 30);
  }, [query, customers]);

  useEffect(() => { setHighlighted(0); }, [filtered.length]);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleKey = (e: React.KeyboardEvent) => {
    if (!open) { if (e.key === 'ArrowDown') setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlighted === 0) { onSelect(null); setOpen(false); }
      else if (filtered[highlighted - 1]) { onSelect(filtered[highlighted - 1]); setOpen(false); }
    }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <input
        value={open ? query : (selected?.name || '')}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKey}
        placeholder="Rechercher client..."
        className="w-full text-xs h-8 px-2 bg-transparent border-b border-neutral-300 focus:border-neutral-900 outline-none transition-colors"
        autoComplete="off"
      />
      {open && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-neutral-200 rounded shadow-lg max-h-60 overflow-y-auto">
          <button
            onMouseDown={e => { e.preventDefault(); onSelect(null); setOpen(false); }}
            onMouseEnter={() => setHighlighted(0)}
            className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${highlighted === 0 ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-500 hover:bg-neutral-50'}`}
          >
            Client comptoir
          </button>
          {filtered.map((c, i) => (
            <button
              key={c.id}
              onMouseDown={e => { e.preventDefault(); onSelect(c); setOpen(false); }}
              onMouseEnter={() => setHighlighted(i + 1)}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${highlighted === i + 1 ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-700 hover:bg-neutral-50'}`}
            >
              <span className="font-medium">{c.name}</span>
              {c.phone && <span className="text-neutral-400 ml-2">{c.phone}</span>}
            </button>
          ))}
          {onCreateNew && query.trim() && (
            <button
              onMouseDown={e => { e.preventDefault(); onCreateNew(query); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-xs text-teal-700 font-medium border-t border-neutral-100 hover:bg-teal-50"
            >
              + Créer "{query}"
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── IPM Banner ──────────────────────────────────────────────────

function IpmBanner({ ipmLoading, ipmBeneficiaire, ipmTaux, ipmConvention, ipmPartIpm, ipmPartClient, ipmConfig, ipmDocuments, setIpmDocuments, ipmDocValidation, subtotal }: {
  ipmLoading?: boolean;
  ipmBeneficiaire?: any;
  ipmTaux?: number;
  ipmConvention?: any;
  ipmPartIpm?: number;
  ipmPartClient?: number;
  ipmConfig?: any;
  ipmDocuments?: IpmDocsType;
  setIpmDocuments?: (fn: any) => void;
  ipmDocValidation?: { valide: boolean; champs_manquants: string[] };
  subtotal: number;
}) {
  return (
    <div className="px-4 py-1.5 border-b border-neutral-100 flex-shrink-0">
      {ipmLoading ? (
        <div className="flex items-center gap-2 text-[11px] text-neutral-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Vérification IPM...</div>
      ) : ipmBeneficiaire ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-3 px-3 py-2 rounded bg-teal-50 border border-teal-200 text-[11px]">
            <ShieldCheck className="w-4 h-4 text-teal-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="font-bold text-teal-800">IPM -- {ipmBeneficiaire.ipm_organismes?.nom}</span>
              {ipmBeneficiaire.matricule && <span className="text-teal-600 ml-2">Mat. {ipmBeneficiaire.matricule}</span>}
              <span className="text-teal-600 ml-2">Taux {ipmTaux}%</span>
              {ipmConvention?.plafond_facture && <span className="text-teal-600 ml-1">Plafond {formatFCFA(ipmConvention.plafond_facture)}</span>}
            </div>
            {subtotal > 0 && (
              <div className="text-right shrink-0 text-[10px]">
                <span className="text-teal-600">IPM: <b>{formatFCFA(ipmPartIpm)}</b></span>
                <span className="text-teal-800 font-bold ml-2">Client: {formatFCFA(ipmPartClient)}</span>
              </div>
            )}
          </div>
          {ipmConfig && setIpmDocuments && ipmDocuments && (ipmConfig.ordonnance_obligatoire || ipmConfig.numero_ordonnance_obligatoire || ipmConfig.medecin_prescripteur_obligatoire || ipmConfig.bon_prise_en_charge_obligatoire || ipmConfig.numero_bon_obligatoire) && (
            <div className="flex items-center gap-2 flex-wrap px-2 py-1.5 rounded bg-teal-50/50 border border-teal-100">
              {(ipmConfig.ordonnance_obligatoire || ipmConfig.numero_ordonnance_obligatoire) && <input className="text-[11px] px-2 py-1 rounded border border-teal-300 bg-white w-36" placeholder="N° ordonnance *" value={ipmDocuments.numero_ordonnance} onChange={e => setIpmDocuments((d: any) => ({ ...d, numero_ordonnance: e.target.value }))} />}
              {ipmConfig.medecin_prescripteur_obligatoire && <input className="text-[11px] px-2 py-1 rounded border border-teal-300 bg-white w-40" placeholder="Médecin *" value={ipmDocuments.medecin} onChange={e => setIpmDocuments((d: any) => ({ ...d, medecin: e.target.value }))} />}
              {(ipmConfig.bon_prise_en_charge_obligatoire || ipmConfig.numero_bon_obligatoire) && <input className="text-[11px] px-2 py-1 rounded border border-teal-300 bg-white w-40" placeholder="N bon PEC *" value={ipmDocuments.numero_bon} onChange={e => setIpmDocuments((d: any) => ({ ...d, numero_bon: e.target.value }))} />}
              {ipmDocValidation && !ipmDocValidation.valide && <span className="text-[10px] text-red-600 font-medium">Manquant : {ipmDocValidation.champs_manquants.join(', ')}</span>}
            </div>
          )}
        </div>
      ) : (
        <p className="text-[10px] text-neutral-400 italic">Ce client n'est pas bénéficiaire d'un IPM actif</p>
      )}
    </div>
  );
}

// ─── Payment Section ─────────────────────────────────────────────

function PaymentSection({ ipmBeneficiaire, ipmPartIpm, ipmPartClient, isCredit, setIsCredit, paymentMethods, payments, setPayments, balance, payMethodId, setPayMethodId, payAmt, setPayAmt, addPayment }: {
  ipmBeneficiaire?: any;
  ipmPartIpm?: number;
  ipmPartClient?: number;
  isCredit?: boolean;
  setIsCredit?: (v: boolean) => void;
  paymentMethods: any[];
  payments: DocPaymentLine[];
  setPayments: (fn: any) => void;
  balance: number;
  payMethodId: string;
  setPayMethodId: (v: string) => void;
  payAmt: string;
  setPayAmt: (v: string) => void;
  addPayment: () => void;
}) {
  return (
    <div className="px-4 py-3 border-t border-neutral-200">
      {ipmBeneficiaire && (ipmPartIpm || 0) > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 mb-2 bg-teal-50 border border-teal-200 rounded text-[11px] text-teal-800 font-medium">
          <ShieldCheck className="w-3.5 h-3.5 text-teal-600 shrink-0" />
          <span>IPM : <b>{formatFCFA(ipmPartIpm)}</b> ({ipmBeneficiaire.ipm_organismes?.nom})</span>
          {(ipmPartClient || 0) > 0 && <span className="ml-auto">Client : <b>{formatFCFA(ipmPartClient)}</b></span>}
          {ipmPartClient === 0 && <span className="ml-auto font-bold">100% couvert</span>}
        </div>
      )}
      {ipmPartClient === 0 && ipmBeneficiaire ? (
        <div className="text-[11px] text-teal-600 font-medium text-center py-1">Entièrement couvert par l'IPM</div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">Règlement{ipmBeneficiaire ? ' (part client)' : ''}</span>
            {!ipmBeneficiaire && setIsCredit && (
              <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                <input type="checkbox" checked={isCredit || false} onChange={e => setIsCredit!(e.target.checked)} className="sr-only peer" />
                <div className="relative w-8 h-[18px] bg-neutral-200 peer-checked:bg-amber-500 rounded-full transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-[14px] after:w-[14px] after:transition-transform peer-checked:after:translate-x-[14px]" />
                <span className={`text-[11px] font-medium ${isCredit ? 'text-amber-700' : 'text-neutral-500'}`}>À crédit</span>
              </label>
            )}
          </div>
          {!isCredit && (
            <>
              <div className="flex items-center gap-2 mb-2">
                <select value={payMethodId} onChange={e => setPayMethodId(e.target.value)} className="text-[11px] font-medium text-neutral-700 bg-transparent border-b border-neutral-300 outline-none py-1 pr-5 cursor-pointer">
                  {paymentMethods.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <input type="number" value={payAmt} onChange={e => setPayAmt(e.target.value)} placeholder={formatNum(balance > 0 ? balance : 0)} min="0" className="text-xs h-7 w-28 px-2 border-b border-neutral-300 focus:border-neutral-900 outline-none text-right num bg-transparent" onFocus={() => { if (!payAmt && balance > 0) setPayAmt(String(balance)); }} />
                <button onClick={addPayment} disabled={!payAmt || Number(payAmt) <= 0} className="px-2.5 py-1 rounded text-[11px] font-semibold bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-30 transition-colors"><Plus className="w-3 h-3 inline" /> Ajouter</button>
              </div>
              {payments.length > 0 && (
                <div className="divide-y divide-neutral-100">
                  {payments.map((p, i) => (
                    <div key={i} className="flex items-center justify-between px-1 py-1.5 text-[11px]">
                      <span className="text-neutral-600">{p.method_name}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-emerald-700 num">{formatFCFA(p.amount)}</span>
                        <button onClick={() => setPayments((prev: any[]) => prev.filter((_: any, j: number) => j !== i))} className="p-0.5 rounded hover:bg-red-50 text-neutral-300 hover:text-red-500"><X className="w-3 h-3" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {isCredit && (
            <div className="flex items-center gap-2 px-2 py-2 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-800"><CreditCard className="w-3.5 h-3.5 text-amber-600 shrink-0" /> À crédit — règlement ultérieur</div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Article Search Modal ────────────────────────────────────────

function ArticleSearchModal({ articles, initialQuery, onSelect, onClose, cols }: {
  articles: any[];
  initialQuery: string;
  onSelect: (article: any) => void;
  onClose: () => void;
  cols: DocColumn[];
}) {
  const [query, setQuery] = useState(initialQuery);
  const [highlighted, setHighlighted] = useState(0);
  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>({
    ref: true, name: true, price: true, stock: true, category: true,
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
      if (ref === q || name === q) exact.push(a);
      else if (ref.includes(q) || name.includes(q)) partial.push(a);
    }
    return [...exact, ...partial].slice(0, 100);
  }, [query, articles]);

  useEffect(() => { setHighlighted(0); }, [query]);

  // Scroll highlighted into view
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

  const SEARCH_COLS = [
    { key: 'ref', label: 'Référence', align: 'left', w: 'w-[18%]' },
    { key: 'name', label: 'Désignation', align: 'left', w: 'flex-1 min-w-0' },
    { key: 'category', label: 'Catégorie', align: 'left', w: 'w-[14%]' },
    { key: 'price', label: 'Prix vente', align: 'right', w: 'w-[12%]' },
    { key: 'stock', label: 'Stock', align: 'right', w: 'w-[10%]' },
  ];

  const activeCols = SEARCH_COLS.filter(c => visibleCols[c.key]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
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
                    case 'price': return <div key="price" className={`${base} text-neutral-700 num`}>{formatNum(a.sale_price)}</div>;
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
