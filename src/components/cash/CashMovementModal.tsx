import { useEffect, useState } from 'react';
import { Loader2, Check, Printer, ArrowUpRight, ArrowDownRight, Banknote, ArrowDownToLine, HandCoins, User, Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { fetchPrepayAvailable } from '../../lib/customerCredit';
import { useApp } from '../../context/AppContext';
import { usePermissions } from '../../lib/permissions';
import { useToast } from '../../context/ToastContext';
import { formatFCFA } from '../../lib/format';
import { CashModal } from '../CashModal';
import { SearchableSelect } from '../SearchableSelect';
import { printEncaissementTicket80 } from '../../lib/print';
import { newIdempotencyKey } from '../../lib/cashSession';
import type { Customer, PaymentMethod } from '../../lib/types';
import type { CashOpContext } from './cashOpContext';

interface Props {
  ctx: CashOpContext;
  onClose: () => void;
  onDone: () => void;
}

export function CashMovementModal({ ctx, onClose, onDone }: Props) {
  const { tenant } = useApp();
  const { can } = usePermissions();
  const { success, error } = useToast();
  const [bound] = useState(ctx);
  const [opKey, setOpKey] = useState(newIdempotencyKey);
  const [expenseCats, setExpenseCats] = useState<{ id: string; name: string }[]>([]);
  const [mvKind, setMvKind] = useState<'expense' | 'income' | 'customer_prepayment' | 'customer_withdrawal' | 'customer_loan' | 'refund'>('expense');
  const [mvCustPrepay, setMvCustPrepay] = useState(0);
  const [mvCustBalance, setMvCustBalance] = useState(0);
  const [mvAmount, setMvAmount] = useState(0);
  const [mvReason, setMvReason] = useState('');
  const [mvExpenseCat, setMvExpenseCat] = useState('');
  const [mvNote, setMvNote] = useState('');
  const [mvRef, setMvRef] = useState('');
  const [mvMethod, setMvMethod] = useState<PaymentMethod | null>(null);
  const [mvCustomer, setMvCustomer] = useState<Customer | null>(null);
  const [mvCustSearch, setMvCustSearch] = useState('');
  const [mvSubmitting, setMvSubmitting] = useState(false);
  const [mvPrint, setMvPrint] = useState(true);

  useEffect(() => {
    setMvMethod(bound.methods[0] || null);
    supabase.rpc('get_effective_expense_categories', { p_site_id: bound.siteId, p_include_inactive: false })
      .then(({ data }) => setExpenseCats((data as { id: string; name: string }[]) || []));
  }, [bound]);

  const submitMovement = async () => {
    if (!can('pos_cash_movement')) { error('Vous n\'avez pas la permission d\'enregistrer un mouvement de caisse'); return; }
    if (mvKind === 'customer_withdrawal' && !can('pos_customer_withdrawal')) { error('Vous n\'avez pas la permission d\'effectuer un retrait sur acompte client'); return; }
    if (mvKind === 'customer_loan' && !can('pos_customer_loan')) { error('Vous n\'avez pas la permission d\'accorder un prêt client'); return; }
    if (mvAmount <= 0) { error('Montant invalide'); return; }
    if (mvKind !== 'expense' && mvKind !== 'customer_withdrawal' && mvKind !== 'customer_loan' && !mvMethod) { error('Mode de règlement requis'); return; }
    if (mvKind === 'customer_prepayment' && !mvCustomer) { error('Client obligatoire'); return; }
    if (mvKind === 'customer_withdrawal' && !mvCustomer) { error('Client obligatoire'); return; }
    if (mvKind === 'customer_loan' && !mvCustomer) { error('Client obligatoire'); return; }
    const mvCustDebt = Math.max(0, mvCustBalance);
    const mvCustNet = mvCustPrepay - mvCustDebt;
    if (mvKind === 'customer_withdrawal' && mvCustPrepay <= 0) { error('Ce client n\'a aucun acompte disponible'); return; }
    if (mvKind === 'customer_withdrawal' && mvCustNet <= 0) { error(`Le client a une dette de ${formatFCFA(mvCustDebt)} qui couvre son acompte de ${formatFCFA(mvCustPrepay)}. Retrait impossible.`); return; }
    if (mvKind === 'customer_withdrawal' && mvAmount > mvCustNet) { error(`Montant supérieur au retrait maximum (${formatFCFA(mvCustNet)}). Le client a un acompte de ${formatFCFA(mvCustPrepay)} et une dette de ${formatFCFA(mvCustDebt)} à déduire.`); return; }
    if (mvKind === 'expense' && expenseCats.length > 0 && !mvExpenseCat) { error('Sélectionnez un type de dépense'); return; }
    const expenseCatName = mvKind === 'expense' ? (expenseCats.find(c => c.id === mvExpenseCat)?.name || '') : '';
    setMvSubmitting(true);
    const common = {
      
      
      p_kind: mvKind,
      p_amount: mvAmount,
      p_reason: mvKind === 'expense' ? (expenseCatName || mvReason) : mvReason,
      p_expense_category_id: mvKind === 'expense' ? (mvExpenseCat || null) : null,
      p_note: mvNote,
      p_reference: mvRef,
      p_customer_id: mvCustomer?.id || null,
      p_payment_method_id: mvMethod?.id || null,
      p_method_name: mvMethod?.name || '',
    };
    const { data, error: e } = bound.mode === 'supervision'
      ? await supabase.rpc('cash_supervision_record_movement', { p_session_id: bound.sessionId, ...common, p_idempotency_key: opKey })
      : await supabase.rpc('record_cash_movement', { p_cash_session_id: bound.sessionId, p_site_id: bound.siteId, ...common });
    if (e) { setMvSubmitting(false); error(e.message); return; }
    const autoApplied = Number((data as any)?.auto_applied || 0);

    const wantsReceipt = mvPrint && (mvKind === 'income' || mvKind === 'customer_prepayment' || mvKind === 'customer_withdrawal' || mvKind === 'customer_loan') && !!tenant;
    if (wantsReceipt && tenant && mvMethod) {
      const prefix = mvKind === 'customer_prepayment' ? 'ACO' : mvKind === 'customer_withdrawal' ? 'RET' : mvKind === 'customer_loan' ? 'PRT' : 'ENC';
      const kindLabel = mvKind === 'customer_prepayment' ? 'acompte_client' : mvKind === 'customer_withdrawal' ? 'retrait_client' : mvKind === 'customer_loan' ? 'pret_client' : 'entree_caisse';
      const { data: numData } = await supabase.rpc('next_doc_number', {
        p_tenant_id: tenant.id, p_kind: kindLabel, p_prefix: prefix,
      });
      const recNum = (numData as string) || (`${prefix}-` + Date.now());
      try {
        printEncaissementTicket80({
          receiptNumber: recNum,
          amount: mvAmount,
          method: mvMethod.name,
          label: mvKind === 'customer_prepayment'
            ? (mvReason ? `Acompte · ${mvReason}` : 'Acompte client')
            : mvKind === 'customer_withdrawal'
              ? (mvReason ? `Retrait · ${mvReason}` : 'Retrait client')
              : mvKind === 'customer_loan'
                ? (mvReason ? `Prêt · ${mvReason}` : 'Prêt client')
                : (mvReason || undefined),
          reference: mvRef || undefined,
          customerName: mvCustomer?.name || null,
          createdAt: new Date().toISOString(),
          tenant: bound.printTenant,
          cashier: bound.userName,
        });
      } catch {}
    }

    setMvSubmitting(false);
    if (mvKind === 'customer_prepayment' && autoApplied > 0) {
      success(`Acompte enregistré · ${formatFCFA(autoApplied)} imputé automatiquement`);
    } else if (mvKind === 'customer_withdrawal') {
      success('Retrait client enregistré');
    } else if (mvKind === 'customer_loan') {
      success('Prêt client enregistré · créance ajoutée');
    } else if (mvKind === 'expense') {
      success('Dépense enregistrée');
    } else if (mvKind === 'income') {
      success('Entrée enregistrée');
    } else {
      success('Acompte enregistré · en attente de facture');
    }

    if (mvPrint) {
      setMvAmount(0);
      setMvReason('');
      setMvNote('');
      setMvRef('');
      setMvCustomer(null);
      setMvCustSearch('');
      setMvCustPrepay(0);
      setMvCustBalance(0);
      setOpKey(newIdempotencyKey());
      onDone();
    } else {
      onDone();
      onClose();
    }
  };

  return (
        <CashModal open={true} onClose={() => onClose()} title="Mouvement de caisse"
          footerLeft={
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={mvPrint} onChange={e => setMvPrint(e.target.checked)}
                className="w-4 h-4 rounded" />
              <Printer className="w-4 h-4 text-neutral-400" />
              <span className="text-[12px] font-medium text-neutral-600 hidden sm:inline">Imprimer le reçu</span>
              <span className="text-[12px] font-medium text-neutral-600 sm:hidden">Imprimer</span>
            </label>
          }
          footer={<>
              <button onClick={() => onClose()} className="px-3 sm:px-4 h-8 rounded-[4px] border border-neutral-200 text-[12px] font-semibold text-neutral-900 hover:bg-neutral-50 transition-colors">Annuler</button>
              <button onClick={submitMovement} disabled={mvSubmitting || mvAmount <= 0}
                className="px-3 sm:px-4 h-8 rounded-[4px] bg-neutral-900 text-white text-[12px] font-semibold hover:bg-neutral-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
                {mvSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                <span className="sm:hidden">Valider</span>
                <span className="hidden sm:inline">Valider le mouvement</span>
              </button>
          </>}>
          <div>
            {/* Type — flat horizontal nav */}
            <div className="-mx-4 px-4 border-b border-neutral-200">
              <div className="flex items-stretch w-full">
                <button type="button" onClick={() => setMvKind('expense')}
                  className={`relative flex-1 flex flex-col items-center gap-1 py-4 transition-colors ${mvKind === 'expense' ? 'text-[var(--w-text)] after:absolute after:left-1/2 after:-translate-x-1/2 after:bottom-0 after:w-full after:h-[3px] after:bg-red-500' : 'text-neutral-600 hover:text-neutral-900'}`}>
                  <ArrowUpRight className={`w-6 h-6 ${mvKind === 'expense' ? 'text-red-500' : 'text-neutral-400'}`} />
                  <span className={`text-[12px] font-semibold ${mvKind === 'expense' ? 'text-[var(--w-text)]' : 'text-neutral-600'}`}>Dépense</span>
                </button>
                <button type="button" onClick={() => setMvKind('income')}
                  className={`relative flex-1 flex flex-col items-center gap-1 py-4 transition-colors ${mvKind === 'income' ? 'text-[var(--w-text)] after:absolute after:left-1/2 after:-translate-x-1/2 after:bottom-0 after:w-full after:h-[3px] after:bg-red-500' : 'text-neutral-600 hover:text-neutral-900'}`}>
                  <ArrowDownRight className={`w-6 h-6 ${mvKind === 'income' ? 'text-red-500' : 'text-neutral-400'}`} />
                  <span className={`text-[12px] font-semibold ${mvKind === 'income' ? 'text-[var(--w-text)]' : 'text-neutral-600'}`}>Entrée</span>
                </button>
                <button type="button" onClick={() => setMvKind('customer_prepayment')}
                  className={`relative flex-1 flex flex-col items-center gap-1 py-4 transition-colors ${mvKind === 'customer_prepayment' ? 'text-[var(--w-text)] after:absolute after:left-1/2 after:-translate-x-1/2 after:bottom-0 after:w-full after:h-[3px] after:bg-red-500' : 'text-neutral-600 hover:text-neutral-900'}`}>
                  <Banknote className={`w-6 h-6 ${mvKind === 'customer_prepayment' ? 'text-red-500' : 'text-neutral-400'}`} />
                  <span className={`text-[12px] font-semibold ${mvKind === 'customer_prepayment' ? 'text-[var(--w-text)]' : 'text-neutral-600'}`}>Acompte</span>
                </button>
                {can('pos_customer_withdrawal') && !!(tenant as any)?.settings?.enable_customer_withdrawals && (
                <button type="button" onClick={() => { setMvKind('customer_withdrawal'); setMvCustPrepay(0); setMvCustBalance(0); }}
                  className={`relative flex-1 flex flex-col items-center gap-1 py-4 transition-colors ${mvKind === 'customer_withdrawal' ? 'text-[var(--w-text)] after:absolute after:left-1/2 after:-translate-x-1/2 after:bottom-0 after:w-full after:h-[3px] after:bg-red-500' : 'text-neutral-600 hover:text-neutral-900'}`}>
                  <ArrowDownToLine className={`w-6 h-6 ${mvKind === 'customer_withdrawal' ? 'text-red-500' : 'text-neutral-400'}`} />
                  <span className={`text-[12px] font-semibold ${mvKind === 'customer_withdrawal' ? 'text-[var(--w-text)]' : 'text-neutral-600'}`}>Retrait</span>
                </button>
                )}
                {can('pos_customer_loan') && !!(tenant as any)?.settings?.enable_customer_loans && (
                <button type="button" onClick={() => { setMvKind('customer_loan'); setMvCustPrepay(0); setMvCustBalance(0); }}
                  className={`relative flex-1 flex flex-col items-center gap-1 py-4 transition-colors ${mvKind === 'customer_loan' ? 'text-[var(--w-text)] after:absolute after:left-1/2 after:-translate-x-1/2 after:bottom-0 after:w-full after:h-[3px] after:bg-red-500' : 'text-neutral-600 hover:text-neutral-900'}`}>
                  <HandCoins className={`w-6 h-6 ${mvKind === 'customer_loan' ? 'text-red-500' : 'text-neutral-400'}`} />
                  <span className={`text-[12px] font-semibold ${mvKind === 'customer_loan' ? 'text-[var(--w-text)]' : 'text-neutral-600'}`}>Prêt</span>
                </button>
                )}
              </div>
            </div>

            {/* Customer section (for prepayment/withdrawal/loan) */}
            {(mvKind === 'customer_prepayment' || mvKind === 'customer_withdrawal' || mvKind === 'customer_loan') && (
              <div className="pt-5 pb-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-2">Client</div>
                {mvCustomer ? (
                  <div className="flex items-center gap-2.5 py-1">
                    <User className="w-4 h-4 text-neutral-400 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-neutral-900 truncate">{mvCustomer.name}</div>
                      {mvCustomer.phone && <div className="text-[11px] text-neutral-500 truncate">{mvCustomer.phone}</div>}
                    </div>
                    <button onClick={() => { setMvCustomer(null); setMvCustPrepay(0); setMvCustBalance(0); }} className="text-[11px] font-semibold text-neutral-600 hover:text-neutral-900 transition-colors shrink-0">Changer</button>
                  </div>
                ) : (
                  <>
                    <div className="relative group">
                      <Search className="w-4 h-4 absolute left-0 top-1/2 -translate-y-1/2 text-neutral-400" />
                      <input autoFocus value={mvCustSearch} onChange={e => setMvCustSearch(e.target.value)}
                        className="w-input-ul pl-6 text-[13px]" placeholder="Rechercher un client…" />
                    </div>
                    <div className="mt-1 max-h-32 overflow-y-auto divide-y divide-neutral-100">
                      {bound.customers
                        .filter(cu => {
                          const q = mvCustSearch.toLowerCase().trim();
                          if (!q) return true;
                          return cu.name.toLowerCase().includes(q) || (cu.phone || '').includes(q);
                        })
                        .slice(0, 15)
                        .map(cu => (
                          <button key={cu.id} onClick={async () => {
                            setMvCustomer(cu);
                            if (mvKind === 'customer_withdrawal') {
                              let avail = 0;
                              try {
                                const ppMap = await fetchPrepayAvailable([cu.id]);
                                avail = ppMap[cu.id] || 0;
                              } catch (e: any) {
                                error(`Acompte disponible indisponible : ${e.message}`);
                              }
                              setMvCustPrepay(avail);
                              const custBalance = Math.max(0, Number(cu.balance || 0));
                              setMvCustBalance(custBalance);
                            }
                            if (mvKind === 'customer_loan') {
                              setMvCustBalance(Math.max(0, Number(cu.balance || 0)));
                            }
                          }}
                            className="w-full flex items-center gap-2.5 py-1.5 hover:bg-neutral-50 text-left transition-colors">
                            <User className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                            <span className="text-[12px] font-semibold text-neutral-800 truncate">{cu.name}</span>
                            {cu.phone && <span className="text-[11px] text-neutral-500 ml-auto shrink-0">{cu.phone}</span>}
                          </button>
                        ))}
                    </div>
                  </>
                )}
                {mvKind === 'customer_withdrawal' && mvCustomer && (() => {
                  const debt = Math.max(0, mvCustBalance);
                  const net = mvCustPrepay - debt;
                  if (mvCustPrepay <= 0) {
                    return <div className="mt-2 text-[12px] font-semibold text-red-600">Aucun acompte disponible pour ce client</div>;
                  }
                  return (
                    <div className="mt-2 space-y-0.5">
                      {debt > 0 ? (
                        <>
                          <div className="flex justify-between text-[12px]"><span className="text-neutral-500">Acompte disponible</span><span className="font-bold num text-neutral-900">{formatFCFA(mvCustPrepay)}</span></div>
                          <div className="flex justify-between text-[12px]"><span className="text-neutral-500">Dette en cours</span><span className="font-bold num text-red-600">-{formatFCFA(debt)}</span></div>
                          <div className="flex justify-between text-[12px] pt-1 border-t border-neutral-100"><span className="font-semibold text-neutral-900">Retrait maximum</span><span className={`font-bold num ${net > 0 ? 'text-neutral-900' : 'text-red-600'}`}>{formatFCFA(net)}</span></div>
                        </>
                      ) : (
                        <div className="flex justify-between text-[12px]"><span className="text-neutral-500">Retrait maximum</span><span className="font-bold num text-neutral-900">{formatFCFA(net)}</span></div>
                      )}
                      {net <= 0 && <div className="text-[11px] font-semibold text-red-600 mt-1">La dette couvre l'acompte. Retrait impossible.</div>}
                    </div>
                  );
                })()}
                {mvKind === 'customer_loan' && mvCustomer && (
                  <div className="mt-2 space-y-0.5">
                    <div className="flex justify-between text-[12px]"><span className="text-neutral-500">Créance actuelle</span><span className="font-bold num text-neutral-900">{formatFCFA(Math.max(0, mvCustBalance))}</span></div>
                    <div className="text-[11px] text-neutral-500 mt-1">Le montant du prêt sera ajouté à la créance du client.</div>
                  </div>
                )}
              </div>
            )}

            {/* Form fields */}
            <div className="pt-5">
              <div className="grid grid-cols-2 gap-6">
                <div className="group">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1">Montant</div>
                  <input type="number" value={mvAmount || ''} onChange={e => setMvAmount(Math.max(0, Number(e.target.value)))}
                    className="w-input-ul text-2xl font-bold num" placeholder="0 FCFA" min={0} />
                </div>
                <div className="group">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1">{mvKind === 'expense' ? 'Type de dépense' : 'Motif'}</div>
                  {mvKind === 'expense' && expenseCats.length > 0 ? (
                    <SearchableSelect
                      value={mvExpenseCat}
                      onChange={setMvExpenseCat}
                      options={expenseCats.map(c => ({ value: c.id, label: c.name }))}
                      placeholder="Sélectionner…"
                    />
                  ) : (
                    <input value={mvReason} onChange={e => setMvReason(e.target.value)}
                      className="w-input-ul text-[13px]" placeholder={mvKind === 'expense' ? 'Carburant…' : 'Motif'} />
                  )}
                </div>
              </div>

              {(mvKind === 'income' || mvKind === 'customer_prepayment') && (
                <div className="mt-5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-2">Mode de règlement</div>
                  <div className="flex flex-wrap gap-3">
                    {bound.methods.map(m => (
                      <button key={m.id} type="button" onClick={() => setMvMethod(m)}
                        className={`px-0 py-1 text-[12px] font-semibold border-b-2 transition-all ${mvMethod?.id === m.id ? 'border-neutral-900 text-neutral-900' : 'border-transparent text-neutral-500 hover:text-neutral-700'}`}>
                        {m.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-6 mt-5">
                <div className="group">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1">Référence</div>
                  <input value={mvRef} onChange={e => setMvRef(e.target.value)}
                    className="w-input-ul text-[13px]" placeholder="N° pièce…" />
                </div>
                <div className="group">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1">Note</div>
                  <input value={mvNote} onChange={e => setMvNote(e.target.value)}
                    className="w-input-ul text-[13px]" placeholder="Ajouter une note…" />
                </div>
              </div>
            </div>
          </div>
        </CashModal>
  );
}
