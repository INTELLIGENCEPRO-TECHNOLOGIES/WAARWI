import { useRef, useState } from 'react';
import { Printer, Loader2, Search, User, ChevronRight, CheckCircle2, Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../context/AppContext';
import { usePermissions } from '../../lib/permissions';
import { useToast } from '../../context/ToastContext';
import { formatFCFA } from '../../lib/format';
import { CashModal } from '../CashModal';
import { printEncaissementTicket80 } from '../../lib/print';
import { newIdempotencyKey } from '../../lib/cashSession';
import type { Customer, PaymentMethod } from '../../lib/types';
import { permsPendingMessage, type CashOpContext } from './cashOpContext';

interface Props {
  ctx: CashOpContext;
  onClose: () => void;
  onDone: () => void;
}

export function CustomerPaymentModal({ ctx, onClose, onDone }: Props) {
  const { tenant } = useApp();
  const { can, loading: permsLoading, error: permsError } = usePermissions();
  const permsPending = permsPendingMessage(permsLoading, permsError);
  const directAllowed = !permsPending && can('pos_cash_movement');
  const directBlockedMsg = permsPending || 'Droit « mouvements de caisse » requis';
  const { success, error } = useToast();
  const [bound] = useState(ctx);
  const [custPayMode, setCustPayMode] = useState<'invoice' | 'direct'>('invoice');
  const [custPayLabel, setCustPayLabel] = useState('');
  const [custPayPrint, setCustPayPrint] = useState(true);
  const [custPayCustomer, setCustPayCustomer] = useState<Customer | null>(null);
  const [custPayUnpaid, setCustPayUnpaid] = useState<{ id: string; sale_number: string; total: number; paid: number; created_at: string }[]>([]);
  const [custPaySaleId, setCustPaySaleId] = useState<string>('');
  const [custPayAmount, setCustPayAmount] = useState<number>(0);
  const [custPayMethod, setCustPayMethod] = useState<PaymentMethod | null>(bound.methods[0] || null);
  const [custPayRef, setCustPayRef] = useState('');
  const [custPaySubmitting, setCustPaySubmitting] = useState(false);
  const [custPaySearch, setCustPaySearch] = useState('');
  const custPayIdemRef = useRef<string>(newIdempotencyKey());

  const loadCustomerUnpaid = async (c: Customer) => {
    if (!tenant) return;
    setCustPayCustomer(c);
    const { data } = await supabase.from('sales')
      .select('id, sale_number, total, paid, status, created_at')
      .eq('tenant_id', tenant.id).eq('customer_id', c.id).neq('status', 'cancelled')
      .order('created_at', { ascending: true });
    const unpaid = (data || [])
      .map((s: any) => ({ ...s, total: Number(s.total), paid: Number(s.paid) }))
      .filter((s: any) => s.paid < s.total);

    const customerBalance = Number((c as any).balance || 0);
    const invoiceDue = unpaid.reduce((a, s) => a + (s.total - s.paid), 0);
    const positionedDue = Math.max(0, customerBalance - invoiceDue);

    if (positionedDue > 0) {
      unpaid.unshift({
        id: '__balance__',
        sale_number: 'Report de solde',
        total: positionedDue,
        paid: 0,
        created_at: new Date(0).toISOString(),
      });
    }

    setCustPayUnpaid(unpaid);
    setCustPaySaleId('');
    setCustPayAmount(Math.max(0, customerBalance));
  };

  const submitCustomerPayment = async () => {
    if (!custPayCustomer || !custPayMethod || !tenant) return;
    if (custPayAmount <= 0) { error('Montant invalide'); return; }
    const paidAmount = custPayAmount;
    const customerName = custPayCustomer.name;
    const methodName = custPayMethod.name;
    const refValue = custPayRef;
    setCustPaySubmitting(true);
    let e: any = null;
    let pieceNumber: string | null = null;
    if (bound.mode === 'supervision') {
      const { data: rpcData, error: rpcErr } = await supabase.rpc('cash_supervision_customer_payment', {
        p_session_id: bound.sessionId,
        p_customer_id: custPayCustomer.id,
        p_sale_id: custPaySaleId && custPaySaleId !== '__balance__' ? custPaySaleId : null,
        p_balance: custPaySaleId === '__balance__',
        p_payment_method_id: custPayMethod.id,
        p_method_name: custPayMethod.name,
        p_amount: custPayAmount,
        p_reference: custPayRef,
        p_idempotency_key: custPayIdemRef.current,
      });
      e = rpcErr;
      if (!rpcErr && rpcData) pieceNumber = (rpcData as any).piece_number || null;
    } else if (custPaySaleId === '__balance__') {
      const idemKey = custPayIdemRef.current;
      const { data: rpcData, error: rpcErr } = await supabase.rpc('register_customer_balance_payment', {
        p_customer_id: custPayCustomer.id,
        p_payment_method_id: custPayMethod.id,
        p_method_name: custPayMethod.name,
        p_amount: custPayAmount,
        p_reference: custPayRef,
        p_cash_session_id: bound.sessionId,
        p_idempotency_key: idemKey,
      });
      e = rpcErr;
      if (!rpcErr && rpcData) pieceNumber = (rpcData as any).piece_number || null;
    } else {
      const { error: rpcErr } = await supabase.rpc('register_customer_payment', {
        p_customer_id: custPayCustomer.id,
        p_payment_method_id: custPayMethod.id,
        p_method_name: custPayMethod.name,
        p_amount: custPayAmount,
        p_reference: custPayRef,
        p_cash_session_id: bound.sessionId,
        p_sale_id: custPaySaleId || null,
      });
      e = rpcErr;
    }
    if (e) { setCustPaySubmitting(false); error(e.message); return; }

    if (custPayPrint) {
      const recNum = pieceNumber || ('REG-' + Date.now());
      try {
        printEncaissementTicket80({
          receiptNumber: recNum,
          amount: paidAmount,
          method: methodName,
          label: 'Règlement client',
          reference: refValue || undefined,
          customerName,
          createdAt: new Date().toISOString(),
          tenant: bound.printTenant,
          cashier: bound.userName,
        });
      } catch {}
    }

    custPayIdemRef.current = newIdempotencyKey();
    setCustPaySubmitting(false);
    success('Règlement encaissé');
    setCustPayCustomer(null);
    setCustPayUnpaid([]);
    setCustPaySaleId('');
    setCustPayAmount(0);
    setCustPayRef('');
    setCustPaySearch('');
    onDone();
  };

  const submitDirectEncaissement = async () => {
    if (!tenant) return;
    if (permsPending) { error(permsPending); return; }
    if (!can('pos_cash_movement')) { error('Vous n\'avez pas la permission d\'enregistrer un mouvement de caisse'); return; }
    if (custPayAmount <= 0) { error('Montant invalide'); return; }
    if (!custPayMethod) { error('Mode de règlement requis'); return; }
    const paidAmount = custPayAmount;
    const labelValue = custPayLabel.trim();
    const refValue = custPayRef;
    const methodName = custPayMethod.name;
    setCustPaySubmitting(true);
    const reason = labelValue || 'Encaissement direct';
    const common = {
      p_kind: 'income',
      p_amount: paidAmount,
      p_reason: reason,
      p_note: '',
      p_reference: refValue,
      p_customer_id: null,
      p_payment_method_id: custPayMethod.id,
      p_method_name: custPayMethod.name,
    };
    const { error: e } = bound.mode === 'supervision'
      ? await supabase.rpc('cash_supervision_record_movement', { p_session_id: bound.sessionId, ...common, p_expense_category_id: null, p_idempotency_key: custPayIdemRef.current })
      : await supabase.rpc('record_cash_movement', { p_cash_session_id: bound.sessionId, p_site_id: bound.siteId, ...common });
    if (e) { setCustPaySubmitting(false); error(e.message); return; }

    if (custPayPrint) {
      const { data: numData } = await supabase.rpc('next_doc_number', {
        p_tenant_id: tenant.id, p_kind: 'encaissement_direct', p_prefix: 'ENC',
      });
      const recNum = (numData as string) || ('ENC-' + Date.now());
      try {
        printEncaissementTicket80({
          receiptNumber: recNum,
          amount: paidAmount,
          method: methodName,
          label: labelValue || undefined,
          reference: refValue || undefined,
          customerName: null,
          createdAt: new Date().toISOString(),
          tenant: bound.printTenant,
          cashier: bound.userName,
        });
      } catch {}
    }

    setCustPaySubmitting(false);
    success('Encaissement enregistré');
    setCustPayAmount(0);
    setCustPayLabel('');
    setCustPayRef('');
    custPayIdemRef.current = newIdempotencyKey();
    onDone();
  };

  return (
        <CashModal open={true} onClose={() => onClose()} title="Encaisser un client"
          footerLeft={
            (custPayMode === 'direct' || (custPayMode === 'invoice' && custPayCustomer && custPayUnpaid.length > 0)) ? (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={custPayPrint} onChange={e => setCustPayPrint(e.target.checked)}
                  className="w-3.5 h-3.5 rounded" />
                <Printer className="w-3.5 h-3.5 text-neutral-400" />
                <span className="text-[12px] font-medium text-neutral-600"><span className="hidden sm:inline">Imprimer le reçu</span><span className="sm:hidden">Imprimer</span></span>
              </label>
            ) : undefined
          }
          footer={<>
              <button onClick={() => onClose()} className="px-4 py-2 text-[13px] font-semibold text-neutral-700 border border-neutral-200 rounded-md hover:bg-neutral-50 transition-colors">Annuler</button>
              {custPayMode === 'direct' ? (
                <button onClick={submitDirectEncaissement} disabled={custPaySubmitting || !directAllowed || !custPayMethod || custPayAmount <= 0}
                  className="px-5 py-2 text-[13px] font-semibold text-white bg-neutral-900 rounded-md hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  {custPaySubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Valider'}
                </button>
              ) : (
                <button onClick={submitCustomerPayment} disabled={custPaySubmitting || !custPayCustomer || !custPayMethod || custPayAmount <= 0}
                  className="px-5 py-2 text-[13px] font-semibold text-white bg-neutral-900 rounded-md hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  {custPaySubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Continuer'}
                </button>
              )}
          </>}>
          <div>
            {/* Flat tab navigation */}
            <div className="flex border-b border-neutral-200 mb-5">
              <button type="button"
                onClick={() => {
                  setCustPayMode('invoice');
                  setCustPayLabel('');
                  if (!custPayCustomer) setCustPayAmount(0);
                }}
                className={`px-0 mr-8 pb-3 text-[13px] font-semibold transition-colors border-b-2 -mb-px ${custPayMode === 'invoice' ? 'border-neutral-900 text-neutral-900' : 'border-transparent text-neutral-400 hover:text-neutral-600'}`}>
                Client en attente
              </button>
              <button type="button" disabled={!directAllowed} title={directAllowed ? undefined : directBlockedMsg}
                onClick={() => {
                  if (!directAllowed) return;
                  setCustPayMode('direct');
                  setCustPayCustomer(null);
                  setCustPayUnpaid([]);
                  setCustPaySaleId('');
                  setCustPayAmount(0);
                  if (!custPayMethod) setCustPayMethod(bound.methods[0] || null);
                }}
                className={`px-0 pb-3 text-[13px] font-semibold transition-colors border-b-2 -mb-px ${custPayMode === 'direct' ? 'border-neutral-900 text-neutral-900' : 'border-transparent text-neutral-400 hover:text-neutral-600'} disabled:text-neutral-300 disabled:hover:text-neutral-300 disabled:cursor-not-allowed`}>
                Encaissement direct
                {!directAllowed && <span className="block text-[10px] font-medium text-neutral-400 mt-0.5">{directBlockedMsg}</span>}
              </button>
            </div>

            {custPayMode === 'direct' ? (
              <div className="space-y-5">
                <div className="group">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1">Montant</div>
                  <input type="number" value={custPayAmount || ''} onChange={e => setCustPayAmount(Math.max(0, Number(e.target.value)))}
                    autoFocus className="w-input-ul text-lg font-bold num" placeholder="0" min={0} />
                </div>

                <div className="group">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1">Libellé (optionnel)</div>
                  <input value={custPayLabel} onChange={e => setCustPayLabel(e.target.value)}
                    className="w-input-ul text-[13px]" placeholder="Ex: Acompte travaux, location matériel…" />
                </div>

                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-2">Mode de règlement</div>
                  <div className="flex flex-wrap gap-3">
                    {bound.methods.map(m => (
                      <button key={m.id} type="button" onClick={() => setCustPayMethod(m)}
                        className={`px-0 py-1 text-[12px] font-semibold border-b-2 transition-all ${custPayMethod?.id === m.id ? 'border-neutral-900 text-neutral-900' : 'border-transparent text-neutral-500 hover:text-neutral-700'}`}>
                        {m.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="group">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1">Référence (optionnel)</div>
                  <input value={custPayRef} onChange={e => setCustPayRef(e.target.value)} className="w-input-ul text-[13px]" placeholder="N° bordereau, transaction…" />
                </div>
              </div>
            ) : !custPayCustomer ? (
              <div>
                <div className="text-[13px] font-semibold text-neutral-900 mb-2">Rechercher un client</div>
                <div className="group">
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-0 top-1/2 -translate-y-1/2 text-neutral-400" />
                    <input autoFocus value={custPaySearch} onChange={e => setCustPaySearch(e.target.value)}
                      className="w-input-ul pl-6 text-[13px]" placeholder="Nom, téléphone…" />
                  </div>
                </div>
                <div className="mt-3 max-h-72 overflow-y-auto -mx-1">
                  {bound.customers
                    .filter(c => {
                      const q = custPaySearch.toLowerCase().trim();
                      if (!q) return true;
                      return c.name.toLowerCase().includes(q) || (c.phone || '').includes(q);
                    })
                    .slice(0, 30)
                    .map(c => (
                      <button key={c.id} onClick={() => loadCustomerUnpaid(c)}
                        className="w-full flex items-center gap-3 px-1 py-3 text-left transition-colors hover:bg-neutral-50 active:bg-neutral-100 border-b border-neutral-100 last:border-b-0">
                        <User className="w-4 h-4 text-neutral-400 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-semibold text-neutral-900 truncate">{c.name}</div>
                          {c.phone && <div className="text-[11px] text-neutral-400 truncate">{c.phone}</div>}
                        </div>
                        <ChevronRight className="w-4 h-4 text-neutral-300 shrink-0" />
                      </button>
                    ))}
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex items-center gap-3 pb-4 border-b border-neutral-100">
                  <User className="w-4 h-4 text-neutral-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-bold text-neutral-900 truncate">{custPayCustomer.name}</div>
                    <div className="text-[11px] text-neutral-500">
                      {custPayUnpaid.filter(s => s.id !== '__balance__').length} facture(s) impayée(s) · Solde {formatFCFA(Number((custPayCustomer as any).balance || 0))}
                    </div>
                  </div>
                  <button onClick={() => setCustPayCustomer(null)} className="text-[11px] font-semibold text-neutral-500 hover:text-neutral-900 transition-colors shrink-0">Changer</button>
                </div>

                {custPayUnpaid.length === 0 && Number((custPayCustomer as any).balance || 0) <= 0 ? (
                  <div className="py-6 text-center">
                    <CheckCircle2 className="w-5 h-5 text-neutral-400 mx-auto mb-2" />
                    <div className="text-[13px] font-semibold text-neutral-900">Aucune facture en attente</div>
                    <div className="text-[11px] text-neutral-500 mt-0.5">Ce client est à jour.</div>
                  </div>
                ) : (
                  <>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-2">Imputation</div>
                      <div className="max-h-48 overflow-y-auto -mx-1">
                        <button type="button" onClick={() => { setCustPaySaleId(''); setCustPayAmount(custPayUnpaid.reduce((a, s) => a + (s.total - s.paid), 0)); }}
                          className={`w-full flex items-center gap-3 px-1 py-3 text-left transition-colors border-b border-neutral-100 ${!custPaySaleId ? 'bg-neutral-50' : 'hover:bg-neutral-50'}`}>
                          <div className="min-w-0 flex-1">
                            <div className={`text-[13px] truncate ${!custPaySaleId ? 'font-bold text-neutral-900' : 'font-medium text-neutral-700'}`}>Repartir automatiquement</div>
                            <div className="text-[11px] text-neutral-400">Plus ancienne d'abord</div>
                          </div>
                          {!custPaySaleId && <Check className="w-4 h-4 text-neutral-900 shrink-0" />}
                        </button>
                        {custPayUnpaid.map(s => (
                          <button key={s.id} type="button" onClick={() => { setCustPaySaleId(s.id); setCustPayAmount(s.total - s.paid); }}
                            className={`w-full flex items-center gap-3 px-1 py-3 text-left transition-colors border-b border-neutral-100 last:border-b-0 ${custPaySaleId === s.id ? 'bg-neutral-50' : 'hover:bg-neutral-50'}`}>
                            <div className="min-w-0 flex-1">
                              <div className={`text-[13px] truncate ${custPaySaleId === s.id ? 'font-bold text-neutral-900' : 'font-medium text-neutral-700'}`}>{s.sale_number} · dû {formatFCFA(s.total - s.paid)}</div>
                              <div className="text-[11px] text-neutral-400">{s.id === '__balance__' ? 'Solde positionné' : new Date(s.created_at).toLocaleDateString('fr-FR')}</div>
                            </div>
                            {custPaySaleId === s.id && <Check className="w-4 h-4 text-neutral-900 shrink-0" />}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="group">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1">Montant</div>
                      <input type="number" value={custPayAmount || ''} onChange={e => setCustPayAmount(Math.max(0, Number(e.target.value)))}
                        className="w-input-ul text-lg font-bold num" placeholder="0" min={0} />
                    </div>

                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-2">Mode de règlement</div>
                      <div className="flex flex-wrap gap-3">
                        {bound.methods.map(m => (
                          <button key={m.id} type="button" onClick={() => setCustPayMethod(m)}
                            className={`px-0 py-1 text-[12px] font-semibold border-b-2 transition-all ${custPayMethod?.id === m.id ? 'border-neutral-900 text-neutral-900' : 'border-transparent text-neutral-500 hover:text-neutral-700'}`}>
                            {m.name}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="group">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1">Référence (optionnel)</div>
                      <input value={custPayRef} onChange={e => setCustPayRef(e.target.value)} className="w-input-ul text-[13px]" placeholder="N° bordereau, transaction…" />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </CashModal>
  );
}
