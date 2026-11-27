import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Loader2, Minus, Plus, RefreshCw, Search } from 'lucide-react';
import {loadReturnLots,returnLotAllocation,type ReturnLotLine} from '../../lib/returnLotAllocation';
import {ReturnLotFields} from '../billing/ReturnLotFields';
import {HistoricalLotMatchPanel} from './HistoricalLotMatchPanel';
import { desktopAutoFocus } from '../../lib/device';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../context/AppContext';
import { usePermissions } from '../../lib/permissions';
import { useToast } from '../../context/ToastContext';
import { formatFCFA } from '../../lib/format';
import { CashModal } from '../CashModal';
import {ReturnRecoveryPanel} from '../ReturnRecoveryPanel';
import {submitReturnRequest} from '../../lib/returnRequestJournal';
import { printReturnTicket80 as printReturnTicket80Shared } from '../../lib/print';
import { newIdempotencyKey } from '../../lib/cashSession';
import { cashOpError, permsPendingMessage, type CashOpContext, type SessionSale } from './cashOpContext';

interface Props {
  ctx: CashOpContext;
  onClose: () => void;
  onDone: () => void;
}

export function SaleReturnModal({ ctx, onClose, onDone }: Props) {
  const { tenant, profile, isOwner } = useApp();
  const mayMatch = isOwner || profile?.role === 'admin' || profile?.role === 'super_admin';
  const { can, loading: permsLoading, error: permsError, reload: reloadPerms } = usePermissions();
  const permsPending = permsPendingMessage(permsLoading, permsError);
  const returnsAllowed = can('pos_returns');
  const { success, error } = useToast();
  const [bound] = useState(ctx);
  const [opKey, setOpKey] = useState(newIdempotencyKey);
  const [restock,setRestock]=useState(true);
  const [refundMode,setRefundMode]=useState<'cash'|'avoir'|'deferred'>('cash');
  const [financialReason,setFinancialReason]=useState('');
  const [matchArticle,setMatchArticle]=useState<string|null>(null);
  const [pendingReturn,setPendingReturn]=useState<boolean|null>(null);
  const inFlight=useRef(false);
  const [returnSearch, setReturnSearch] = useState('');
  const [returnSales, setReturnSales] = useState<SessionSale[]>([]);
  const [returnLoading, setReturnLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [started, setStarted] = useState(false);
  const [returnSelected, setReturnSelected] = useState<SessionSale | null>(null);
  const [returnLines, setReturnLines] = useState<(ReturnLotLine & { sale_item_id: string; article_id: string; name: string; quantity: number; unit_price: number; purchase_cost: number; maxQty: number; selected: boolean })[]>([]);
  const lotLoadRequest=useRef(0);
  const [lotLoad,setLotLoad]=useState({busy:false,error:''});

  const loadReturnSales = async () => {
    if (!tenant || permsPending || !returnsAllowed) return;
    setReturnLoading(true);
    setLoadError('');
    const loadFail = 'Impossible de charger les ventes de la session.';
    try {
    const { data, error: salesErr } = await supabase
      .from('sales')
      .select('id, sale_number, total, customer_id, created_at, customers(name, phone, address), status, sale_items(id, article_id, name, quantity, unit_price, purchase_cost, vat_net_amount, vat_amount)')
      .eq('tenant_id', tenant.id)
      .eq('cash_session_id', bound.sessionId)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false });
    if (salesErr) { setLoadError(cashOpError(salesErr, loadFail)); return; }

    // Fetch already-returned quantities for these sales (by sale_item_id)
    const saleIds = (data || []).map((s: any) => s.id);
    const returned = new Map<string, { quantity: number; total: number }>();
    if (saleIds.length > 0) {
      const { data: retData, error: retErr } = await supabase
        .from('sale_returns')
        .select('sale_id, sale_return_items(sale_item_id, quantity, total)')
        .eq('tenant_id', tenant.id)
        .in('sale_id', saleIds).in('status', ['approved', 'pending']);
      if (retErr) { setLoadError(cashOpError(retErr, loadFail)); return; }
      for (const ret of retData || []) {
        for (const ri of (ret as any).sale_return_items || []) {
          if (ri.sale_item_id) {
            const previous = returned.get(ri.sale_item_id) ?? { quantity: 0, total: 0 };
            returned.set(ri.sale_item_id, { quantity: previous.quantity + Number(ri.quantity), total: previous.total + Number(ri.total) });
          }
        }
      }
    }

    setReturnSales((data || []).map((s: any) => {
      const items = (s.sale_items || []).map((i: any) => {
        const previous = returned.get(i.id);
        const remaining = Number(i.quantity) - (previous?.quantity ?? 0);
        const displayPrice = i.vat_net_amount != null && remaining > 0
          ? (Number(i.vat_net_amount) + Number(i.vat_amount) - (previous?.total ?? 0)) / remaining
          : Number(i.unit_price);
        return { sale_item_id: i.id, article_id: i.article_id || '', name: i.name, quantity: Number(i.quantity),
          unit_price: displayPrice, purchase_cost: Number(i.purchase_cost ?? 0), returned: previous?.quantity ?? 0 };
      });
      const fullyReturned = items.every((i: any) => i.returned >= i.quantity);
      return {
        id: s.id, sale_number: s.sale_number, total: Number(s.total), customer_id: s.customer_id || null,
        created_at: s.created_at, customer_name: s.customers?.name || null, customer_phone: s.customers?.phone || null, customer_address: s.customers?.address || null, status: s.status,
        items, fullyReturned,
      };
    }) as any);
    } catch (e) {
      setLoadError(cashOpError(e as { message?: string }, loadFail));
    } finally {
      setReturnLoading(false);
    }
  };

  useEffect(() => {
    if (started || permsPending || !returnsAllowed) return;
    setStarted(true);
    loadReturnSales();
  }, [started, permsPending, returnsAllowed]);

  const selectReturnSale = (s: SessionSale) => {
    if(inFlight.current||pendingReturn!==false)return;
    setOpKey(newIdempotencyKey());setRestock(true);setRefundMode('cash');setFinancialReason('');setMatchArticle(null);
    const req=++lotLoadRequest.current;setLotLoad({busy:true,error:''});
    setReturnSelected(s);
    setReturnSearch('');
    setReturnLines(s.items.map(i => {
      const remaining = i.quantity - (i.returned || 0);
      return { ...i, purchase_cost: i.purchase_cost || 0, quantity: remaining, maxQty: remaining, selected: remaining > 0,returnLots:[],lotQuantities:{} };
    }));
    void loadReturnLots(s.id).then(lots=>{if(req===lotLoadRequest.current){setReturnLines(lines=>lines.map(l=>({...l,returnLots:lots[l.sale_item_id]||[]})));setLotLoad({busy:false,error:''});}}).catch(e=>{if(req===lotLoadRequest.current)setLotLoad({busy:false,error:e?.message||'Impossible de charger les lots d’origine.'});});
  };

  const [returnProcessing, setReturnProcessing] = useState(false);

  const processReturn = async () => {
    if (!returnSelected || !tenant || inFlight.current || returnProcessing || pendingReturn!==false || lotLoad.busy || lotLoad.error || matchArticle) return;
    if (permsPending) { error(permsPending); return; }
    if (!can('pos_returns')) { error('Vous n\'avez pas la permission d\'effectuer des retours'); return; }
    const lines = returnLines.filter(l => l.selected && l.quantity > 0);
    if (lines.length === 0) { error('Aucun article sélectionné'); return; }
    const returnTotal = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);

    if(refundMode==='avoir'&&!returnSelected.customer_id){error('Associez un client à la vente avant d’émettre un avoir.');return;}
    if(restock && lines.some(l=>!returnLotAllocation(l,true).valid)){error('Vérifiez les quantités par lot.');return;}
    if(!restock && financialReason.trim().length<8){error('Précisez le motif du retour sans remise en stock.');return;}
    const items = lines.map(l => ({ sale_item_id: l.sale_item_id, quantity: l.quantity,lots:restock?returnLotAllocation(l,true).lots:[] }));
    const reason=restock?'Retour au POS':'Retour financier au POS : '+financialReason.trim();
    inFlight.current=true;setReturnProcessing(true);setPendingReturn(null);
    try {
      const result=await submitReturnRequest({
        key:opKey,flow:bound.mode==='supervision'?'supervision':'pos',saleId:returnSelected.id,siteId:bound.siteId,sessionId:bound.sessionId,
        items,reason,restock,mode:refundMode
      });
      if(!result?.success||!result?.return_id)throw new Error('Retour non confirmé. Consultez le panneau de reprise.');
      const refunded = Number(result?.total ?? returnTotal);
      const settledMode = result.refund_method==='avoir'?'avoir':result.refunded===true?'cash':'deferred';
      const retNum = result?.return_number || 'RET-?';
      try {printReturnTicket80Shared(returnSelected.sale_number, lines, refunded, bound.printTenant, bound.userName, retNum, returnSelected.customer_name, result, settledMode);} catch {error('Retour enregistré, mais impression du ticket impossible.');}

      setReturnSelected(null);setReturnLines([]);setPendingReturn(true);
      success(settledMode==='avoir'?`Avoir de ${formatFCFA(refunded)} enregistré`:settledMode==='cash'?`Retour effectué : ${formatFCFA(refunded)} remboursés`:`Retour enregistré : ${formatFCFA(refunded)} à traiter depuis la facturation`);
      onDone();
    } catch (e: any) {
      error(e?.message || 'Retour non confirmé. Consultez le panneau de reprise.');
    } finally {
      inFlight.current=false;setReturnProcessing(false);
    }
  };

  const filteredReturnSales = useMemo(() => {
    const q = returnSearch.toLowerCase().trim();
    if (!q) return returnSales;
    return returnSales.filter(s => s.sale_number.toLowerCase().includes(q) || (s.customer_name || '').toLowerCase().includes(q));
  }, [returnSales, returnSearch]);


  return (
      <CashModal open={true} onClose={() => {if(!inFlight.current)onClose();}} title="Ticket de retour"
        footer={!returnSelected ? (
          <button onClick={() => { onClose(); setReturnSelected(null); }} className="btn-secondary text-xs">Fermer</button>
        ) : (
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <button disabled={returnProcessing} onClick={() => { onClose(); setReturnSelected(null); }} className="btn-secondary text-xs disabled:opacity-40">{pendingReturn?'Fermer':'Annuler'}</button>
            <button onClick={processReturn} disabled={returnProcessing || pendingReturn!==false || lotLoad.busy || !!lotLoad.error || !!permsPending || !returnsAllowed || !!matchArticle || returnLines.filter(l => l.selected && l.quantity>0).length === 0 || (restock&&returnLines.some(l=>l.selected&&!returnLotAllocation(l,true).valid)) || (!restock&&financialReason.trim().length<8) || (refundMode==='avoir'&&!returnSelected.customer_id)} className="btn-primary text-xs">
              {returnProcessing ? <Loader2 className="w-4 h-4 animate-spin mx-2" /> : 'Valider le retour'}
            </button>
          </div>
        )}
      >
        <ReturnRecoveryPanel enabled={!permsPending&&returnsAllowed} onActiveChange={setPendingReturn} onResolved={()=>{setReturnSelected(null);setReturnLines([]);setOpKey(newIdempotencyKey());void loadReturnSales();onDone();}}/>
        {!started ? (
          permsLoading ? (
            <div className="py-12 flex flex-col items-center gap-2 text-xs text-neutral-500"><Loader2 className="w-6 h-6 animate-spin text-brand-700" />Vérification des autorisations…</div>
          ) : (
            <div className="py-8 text-center">
              <p className="text-sm text-red-700">{permsPending || 'Vous n\'avez pas la permission d\'effectuer des retours.'}</p>
              {permsError && <button onClick={reloadPerms} className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-neutral-900 underline underline-offset-4"><RefreshCw className="w-3.5 h-3.5" />Réessayer</button>}
            </div>
          )
        ) : returnLoading ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
        ) : loadError ? (
          <div className="py-8 text-center">
            <p className="text-sm text-red-700">{loadError}</p>
            <button onClick={() => loadReturnSales()} className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-neutral-900 underline underline-offset-4"><RefreshCw className="w-3.5 h-3.5" />Réessayer</button>
          </div>
        ) : !returnSelected ? (
          <div>
            {/* Search */}
            <div className="relative group mb-4">
              <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <input value={returnSearch} onChange={e => setReturnSearch(e.target.value)} placeholder="Rechercher un ticket de la session..." className="w-input-ul pl-6 text-[13px]" autoFocus={desktopAutoFocus} />
            </div>
            {/* List */}
            {filteredReturnSales.length === 0 ? (
              <div className="py-8 text-center text-sm text-neutral-500">Aucun ticket dans cette session.</div>
            ) : (
              <div>
                {filteredReturnSales.map(s => (
                  <button key={s.id} onClick={() => !s.fullyReturned && selectReturnSale(s)} disabled={s.fullyReturned||pendingReturn!==false} className={`w-full text-left py-2.5 border-b border-neutral-100 last:border-b-0 flex items-center justify-between gap-2 transition-colors ${s.fullyReturned ? 'opacity-40 cursor-not-allowed' : ''}`}>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-bold text-neutral-900 doc-number">{s.sale_number}</div>
                      <div className="text-[12px] text-neutral-500 mt-0.5">
                        {s.customer_name || 'Client comptoir'}
                        {s.fullyReturned && <span className="ml-2 text-[10px] font-bold uppercase text-neutral-500 bg-neutral-100 px-1.5 py-0.5 rounded">Retourné</span>}
                      </div>
                      <div className="text-[10px] text-neutral-400 num mt-0.5">{new Date(s.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })} - {new Date(s.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[13px] font-bold text-neutral-900 num">{formatFCFA(s.total)}</span>
                      <ChevronRight className="w-3.5 h-3.5 text-neutral-300" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div>
            {/* Selected ticket header */}
            <div className="flex items-center justify-between pb-3 border-b border-neutral-200">
              <span className="text-[15px] font-bold text-neutral-900 doc-number">{returnSelected.sale_number}</span>
              <button disabled={returnProcessing||pendingReturn!==false} onClick={() => {lotLoadRequest.current++;setReturnSelected(null);setMatchArticle(null);}} className="text-[13px] text-neutral-600 underline underline-offset-2 hover:text-neutral-900 transition-colors">Changer</button>
            </div>

            {lotLoad.busy&&<p role="status" className="py-2 text-xs text-neutral-500">Chargement des lots d’origine…</p>}
            {lotLoad.error&&<div role="alert" className="py-2 text-sm"><p>{lotLoad.error}</p><button type="button" className="underline" onClick={()=>selectReturnSale(returnSelected)}>Réessayer</button></div>}
            {matchArticle&&<HistoricalLotMatchPanel key={matchArticle} saleId={returnSelected.id} articleId={matchArticle} onCancel={()=>setMatchArticle(null)} onDone={()=>{setMatchArticle(null);selectReturnSale(returnSelected);}}/>}
            <fieldset disabled={returnProcessing||pendingReturn!==false||!!matchArticle} className="min-w-0">
              <div className="space-y-2 border-b border-[var(--w-separator)] py-3">
                <p className="text-xs font-semibold">Traitement du stock</p>
                <label className="flex items-center gap-2 text-xs"><input type="radio" name="return-stock-mode" checked={restock} onChange={()=>setRestock(true)}/>Retour avec remise en stock</label>
                <label className="flex items-center gap-2 text-xs"><input type="radio" name="return-stock-mode" checked={!restock} onChange={()=>setRestock(false)}/>Retour sans remise en stock</label>
                {!restock&&<><p className="text-xs text-amber-800">Le retour sera enregistré sans réintégrer les articles au stock. Ne choisissez ce mode que si le retour est uniquement financier ou la marchandise n'est pas remise en stock.</p><label className="block text-xs">Motif obligatoire<textarea className="w-textarea-ul mt-1 w-full py-2 text-sm" rows={2} maxLength={500} value={financialReason} onChange={e=>setFinancialReason(e.target.value)}/></label></>}
              </div>
              <div className="border-b border-[var(--w-separator)] py-3">
                <p className="text-xs font-semibold mb-2">Traitement du montant</p>
                <div className="space-y-0.5">
                  {([{value:'cash',label:'Rembourser en espèces',hint:'Décaissement immédiat'},{value:'avoir',label:'Émettre un avoir',hint:returnSelected.customer_id?'Crédit du client':'Client identifié requis'},{value:'deferred',label:'Traiter plus tard',hint:'Depuis la facturation'}] as const).map(option=>
                    <label key={option.value} className={`w-option flex items-start gap-2 rounded-md p-2 text-xs ${refundMode === option.value ? 'w-option-selected' : ''} ${option.value === 'avoir' && !returnSelected.customer_id ? 'opacity-50' : ''}`}>
                      <input type="radio" name="return-refund-mode" value={option.value} checked={refundMode===option.value} disabled={option.value==='avoir'&&!returnSelected.customer_id} onChange={()=>setRefundMode(option.value)} />
                      <span className="min-w-0"><span className="block font-semibold">{option.label}</span><span className="block mt-1 text-neutral-500">{option.hint}</span></span>
                    </label>)}
                </div>
                {refundMode==='deferred'&&<p className="mt-2 text-xs text-neutral-600">Aucun décaissement immédiat. Le retour reste à traiter dans la facturation.</p>}
              </div>
            {/* Instructions */}
            <p className="text-[13px] text-neutral-600 mt-4 mb-4 leading-relaxed">Sélectionnez les articles à retourner et ajustez les quantités.</p>

            {/* Article list */}
            <div>
              {returnLines.map((l, i) => {
                const toggle = (v: boolean) => setReturnLines(lines => lines.map((x, j) => j === i ? { ...x, selected: v } : x));
                const setQ = (q: number) => setReturnLines(lines => lines.map((x, j) => j === i ? { ...x, quantity: Math.min(l.maxQty, Math.max(Math.min(1,l.maxQty), q)),lotQuantities:{} } : x));
                return (
                  <div key={i} className="py-4 border-b border-neutral-100 last:border-b-0">
                    <div className="flex items-start gap-3">
                      <input type="checkbox" checked={l.selected} disabled={l.maxQty <= 0} onChange={event => toggle(event.target.checked)}
                        aria-label={`Retourner ${l.name}`} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--w-accent)]" />
                      <div className="min-w-0 flex-1">
                        <div className="break-words text-sm font-semibold leading-snug text-[var(--w-text)]">{l.name}</div>
                        <div className="text-[12px] text-neutral-500 mt-1 num">{formatFCFA(l.unit_price)} │ Qté achetée : {l.maxQty}</div>
                        {l.selected && (
                          <div className="text-[12px] text-red-600 font-medium mt-0.5 num">Montant du retour : -{formatFCFA(l.quantity * l.unit_price)}</div>
                        )}
                        {l.selected && (
                          <div className="mt-3 flex items-center justify-between">
                            <span className="text-[12px] text-neutral-600">Quantité à retourner</span>
                            <div className="flex items-center gap-3">
                              <button type="button" onClick={() => setQ(l.quantity - 1)} className="w-8 h-8 flex items-center justify-center text-neutral-600 hover:text-neutral-900 transition-colors"><Minus className="w-4 h-4" /></button>
                              <span className="text-[15px] font-bold num w-6 text-center">{l.quantity}</span>
                              <button type="button" onClick={() => setQ(l.quantity + 1)} className="w-8 h-8 flex items-center justify-center text-neutral-600 hover:text-neutral-900 transition-colors"><Plus className="w-4 h-4" /></button>
                            </div>
                          </div>
                        )}
                        {restock&&l.selected&&!lotLoad.busy&&!lotLoad.error&&<ReturnLotFields line={l} restock={true} onChange={lotQuantities=>setReturnLines(lines=>lines.map((x,j)=>j===i?{...x,lotQuantities}:x))}/>}
                        {mayMatch&&restock&&l.selected&&l.article_id&&<button type="button" onClick={()=>setMatchArticle(l.article_id)} className="mt-2 text-xs font-medium underline underline-offset-2">Rapprocher les lots historiques</button>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            </fieldset>
            {/* Total avoir */}
            <div className="flex items-center justify-between pt-4 mt-2 border-t border-neutral-200">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-900">Montant estimé du retour</div>
                <div className="text-[11px] text-neutral-500 mt-0.5">{returnLines.filter(l => l.selected).length} article{returnLines.filter(l => l.selected).length > 1 ? 's' : ''}</div>
              </div>
              <div className="text-xl font-bold text-red-600 num">
                - {formatFCFA(returnLines.filter(l => l.selected).reduce((s, l) => s + l.quantity * l.unit_price, 0))}
              </div>
            </div>
          </div>
        )}
      </CashModal>
  );
}
