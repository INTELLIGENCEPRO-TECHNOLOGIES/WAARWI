import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, Loader2, Minus, Plus, Search } from 'lucide-react';
import { desktopAutoFocus } from '../../lib/device';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../context/AppContext';
import { usePermissions } from '../../lib/permissions';
import { useToast } from '../../context/ToastContext';
import { formatFCFA } from '../../lib/format';
import { CashModal } from '../CashModal';
import { printReturnTicket80 as printReturnTicket80Shared } from '../../lib/print';
import { newIdempotencyKey } from '../../lib/cashSession';
import type { CashOpContext, SessionSale } from './cashOpContext';

interface Props {
  ctx: CashOpContext;
  onClose: () => void;
  onDone: () => void;
}

export function SaleReturnModal({ ctx, onClose, onDone }: Props) {
  const { tenant } = useApp();
  const { can } = usePermissions();
  const { success, error } = useToast();
  const [bound] = useState(ctx);
  const [opKey, setOpKey] = useState(newIdempotencyKey);
  const [returnSearch, setReturnSearch] = useState('');
  const [returnSales, setReturnSales] = useState<SessionSale[]>([]);
  const [returnLoading, setReturnLoading] = useState(false);
  const [returnSelected, setReturnSelected] = useState<SessionSale | null>(null);
  const [returnLines, setReturnLines] = useState<{ sale_item_id: string; article_id: string; name: string; quantity: number; unit_price: number; purchase_cost: number; maxQty: number; selected: boolean }[]>([]);

  const loadReturnSales = async () => {
    if (!tenant) return;
    if (!can('pos_returns')) { error('Vous n\'avez pas la permission d\'effectuer des retours'); return; }
    setReturnLoading(true);
    const { data } = await supabase
      .from('sales')
      .select('id, sale_number, total, created_at, customers(name, phone, address), status, sale_items(id, article_id, name, quantity, unit_price, purchase_cost)')
      .eq('tenant_id', tenant.id)
      .eq('cash_session_id', bound.sessionId)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false });

    // Fetch already-returned quantities for these sales (by sale_item_id)
    const saleIds = (data || []).map((s: any) => s.id);
    let returnedMap: Record<string, number> = {};
    if (saleIds.length > 0) {
      const { data: retData } = await supabase
        .from('sale_returns')
        .select('sale_id, sale_return_items(sale_item_id, quantity)')
        .eq('tenant_id', tenant.id)
        .in('sale_id', saleIds);
      for (const ret of retData || []) {
        for (const ri of (ret as any).sale_return_items || []) {
          if (ri.sale_item_id) {
            returnedMap[ri.sale_item_id] = (returnedMap[ri.sale_item_id] || 0) + Number(ri.quantity);
          }
        }
      }
    }

    setReturnSales((data || []).map((s: any) => {
      const items = (s.sale_items || []).map((i: any) => {
        const alreadyReturned = returnedMap[i.id] || 0;
        return { sale_item_id: i.id, article_id: i.article_id || '', name: i.name, quantity: Number(i.quantity), unit_price: Number(i.unit_price), returned: alreadyReturned };
      });
      const fullyReturned = items.every((i: any) => i.returned >= i.quantity);
      return {
        id: s.id, sale_number: s.sale_number, total: Number(s.total),
        created_at: s.created_at, customer_name: s.customers?.name || null, customer_phone: s.customers?.phone || null, customer_address: s.customers?.address || null, status: s.status,
        items, fullyReturned,
      };
    }) as any);
    setReturnLoading(false);
  };

  useEffect(() => { loadReturnSales(); }, [bound]);

  const selectReturnSale = (s: SessionSale) => {
    setReturnSelected(s);
    setReturnSearch('');
    setReturnLines(s.items.map(i => {
      const remaining = i.quantity - (i.returned || 0);
      return { ...i, purchase_cost: i.purchase_cost || 0, quantity: remaining, maxQty: remaining, selected: remaining > 0 };
    }));
  };

  const [returnProcessing, setReturnProcessing] = useState(false);

  const processReturn = async () => {
    if (!returnSelected || !tenant) return;
    if (!can('pos_returns')) { error('Vous n\'avez pas la permission d\'effectuer des retours'); return; }
    const lines = returnLines.filter(l => l.selected && l.quantity > 0);
    if (lines.length === 0) { error('Aucun article sélectionné'); return; }
    const returnTotal = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);

    setReturnProcessing(true);
    try {
      const items = lines.map(l => ({ sale_item_id: l.sale_item_id, quantity: l.quantity }));
      const { data: result, error: rpcErr } = bound.mode === 'supervision'
        ? await supabase.rpc('cash_supervision_sale_return', {
            p_session_id: bound.sessionId,
            p_sale_id: returnSelected.id,
            p_items: items,
            p_reason: 'Retour au POS',
            p_refund_method: null,
            p_idempotency_key: opKey,
          })
        : await supabase.rpc('process_sale_return', {
            p_sale_id: returnSelected.id,
            p_site_id: bound.siteId,
            p_cash_session_id: bound.sessionId,
            p_items: items,
            p_reason: 'Retour au POS',
            p_refund_now: true,
            p_restock: true,
            p_request_id: opKey,
          });

      if (rpcErr) throw new Error(rpcErr.message);

      const retNum = result?.return_number || 'RET-?';
      printReturnTicket80Shared(returnSelected.sale_number, lines, returnTotal, bound.printTenant, bound.userName, retNum, returnSelected.customer_name);

      setOpKey(newIdempotencyKey());
      onClose();
      success(`Retour effectué: -${formatFCFA(returnTotal)} remboursé`);
      onDone();
    } catch (e: any) {
      error(e.message || 'Erreur lors du retour');
    } finally {
      setReturnProcessing(false);
    }
  };

  const filteredReturnSales = useMemo(() => {
    const q = returnSearch.toLowerCase().trim();
    if (!q) return returnSales;
    return returnSales.filter(s => s.sale_number.toLowerCase().includes(q) || (s.customer_name || '').toLowerCase().includes(q));
  }, [returnSales, returnSearch]);


  return (
      <CashModal open={true} onClose={() => onClose()} title="Ticket de retour"
        footer={!returnSelected ? (
          <button onClick={() => { onClose(); setReturnSelected(null); }} className="px-4 py-2 text-[13px] font-semibold text-neutral-700 border border-neutral-200 rounded-md hover:bg-neutral-50 transition-colors">Fermer</button>
        ) : (
          <div className="flex items-center justify-end gap-3 w-full">
            <button onClick={() => { onClose(); setReturnSelected(null); }} className="px-4 py-2 text-[13px] font-semibold text-neutral-700 border border-neutral-200 rounded-md hover:bg-neutral-50 transition-colors">Annuler</button>
            <button onClick={processReturn} disabled={returnProcessing || returnLines.filter(l => l.selected).length === 0} className="px-4 py-2 text-[13px] font-semibold text-white bg-neutral-900 rounded-md hover:bg-neutral-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {returnProcessing ? <Loader2 className="w-4 h-4 animate-spin mx-2" /> : "Créer l'avoir"}
            </button>
          </div>
        )}
      >
        {returnLoading ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
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
                  <button key={s.id} onClick={() => !s.fullyReturned && selectReturnSale(s)} disabled={s.fullyReturned} className={`w-full text-left py-2.5 border-b border-neutral-100 last:border-b-0 flex items-center justify-between gap-2 transition-colors ${s.fullyReturned ? 'opacity-40 cursor-not-allowed' : ''}`}>
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
              <button onClick={() => setReturnSelected(null)} className="text-[13px] text-neutral-600 underline underline-offset-2 hover:text-neutral-900 transition-colors">Changer</button>
            </div>

            {/* Instructions */}
            <p className="text-[13px] text-neutral-600 mt-4 mb-4 leading-relaxed">Sélectionnez les articles à retourner et ajustez les quantités.</p>

            {/* Article list */}
            <div>
              {returnLines.map((l, i) => {
                const toggle = (v: boolean) => setReturnLines(lines => lines.map((x, j) => j === i ? { ...x, selected: v } : x));
                const setQ = (q: number) => setReturnLines(lines => lines.map((x, j) => j === i ? { ...x, quantity: Math.min(l.maxQty, Math.max(1, q)) } : x));
                return (
                  <div key={i} className="py-4 border-b border-neutral-100 last:border-b-0">
                    <div className="flex items-start gap-3">
                      <button type="button" onClick={() => toggle(!l.selected)} className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all ${l.selected ? 'bg-red-600 border-red-600' : 'bg-white border-neutral-300'}`}>
                        {l.selected && <Check className="w-3 h-3 text-white" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-bold text-neutral-900 leading-snug break-words uppercase">{l.name}</div>
                        <div className="text-[12px] text-neutral-500 mt-1 num">{formatFCFA(l.unit_price)} · Qté achetée : {l.maxQty}</div>
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
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Total avoir */}
            <div className="flex items-center justify-between pt-4 mt-2 border-t border-neutral-200">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-900">Avoir total</div>
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
