import { useState, useEffect, useMemo } from 'react';
import { Loader2, Calendar, Check, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { Modal } from './Modal';

export type LotAssignment = {
  lot_id: string;
  batch_number: string;
  expiry_date: string | null;
  quantity: number;
  available: number;
};

export type ArticleLotSelection = {
  article_id: string;
  article_name: string;
  needed: number;
  assignments: LotAssignment[];
};

type Props = {
  open: boolean;
  onClose: () => void;
  items: { article_id: string; name: string; quantity: number }[];
  onConfirm: (selections: ArticleLotSelection[]) => void;
  title?: string;
  confirmLabel?: string;
  siteId?: string;
  strict?: boolean;
};

export function LotPickerModal({ open, onClose, items, onConfirm, title = 'Sélection des lots', confirmLabel = 'Confirmer', siteId, strict=false }: Props) {
  const { tenant, currentSite } = useApp();
  const [loading, setLoading] = useState(true);
  const [selections, setSelections] = useState<ArticleLotSelection[]>([]);
  const [loadError,setLoadError]=useState('');
  const sourceSiteId=siteId||currentSite?.id;

  useEffect(()=>{
    if(!open||!tenant?.id||!sourceSiteId||!items.length)return;
    let alive=true;setLoading(true);setSelections([]);setLoadError('');
    void(async()=>{
      try{
        const result:ArticleLotSelection[]=[];
        const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Dakar'});
        for(const item of items){
          let query=supabase.from('stock_lots').select('id,batch_number,expiry_date,remaining_quantity,purchase_price').eq('tenant_id',tenant.id).eq('site_id',sourceSiteId).eq('article_id',item.article_id).gt('remaining_quantity',0);
          if(strict)query=query.or('expiry_date.is.null,expiry_date.gte.'+today);
          const {data:lots,error}=await query.order('expiry_date',{ascending:true});
          if(error)throw error;
          if(!alive)return;
          result.push({article_id:item.article_id,article_name:item.name,needed:item.quantity,assignments:(lots||[]).map(l=>({lot_id:l.id,batch_number:l.batch_number,expiry_date:l.expiry_date,quantity:0,available:Number(l.remaining_quantity)}))});
        }
        if(alive)setSelections(result);
      }catch(e){if(alive)setLoadError(e&&typeof e==='object'&&'message' in e?String(e.message):'Impossible de charger les lots.');}
      finally{if(alive)setLoading(false);}
    })();
    return()=>{alive=false;};
  },[open,tenant?.id,sourceSiteId,items,strict]);

  const autoFEFO = () => {
    setSelections(prev => prev.map(s => {
      let remaining = s.needed;
      const newAssignments = s.assignments.map(a => {
        const qty = Math.min(a.available, remaining);
        remaining = Math.max(0, remaining - qty);
        return { ...a, quantity: qty };
      });
      return { ...s, assignments: newAssignments };
    }));
  };

  const setQty = (articleIdx: number, lotIdx: number, qty: number) => {
    setSelections(prev => prev.map((s, i) => {
      if (i !== articleIdx) return s;
      return {
        ...s,
        assignments: s.assignments.map((a, j) => j === lotIdx ? { ...a, quantity: Math.min(a.available, Math.max(0, qty)) } : a),
      };
    }));
  };

  const allValid = useMemo(() => {
    return !loading&&!loadError&&selections.length===items.length&&selections.every(s => {
      const total = s.assignments.reduce((sum, a) => sum + a.quantity, 0);
      return strict?Math.abs(total-s.needed)<1e-8:total>=s.needed||s.assignments.length===0;
    });
  }, [selections,loading,loadError,items.length,strict]);

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Dakar' });

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg" layer="top"
      footer={<>
        <button type="button" onClick={onClose} className="btn-secondary text-xs">
          <X aria-hidden="true" className="h-4 w-4" /> Annuler
        </button>
        <button type="button" onClick={autoFEFO} className="btn-secondary text-xs" disabled={loading || !!loadError || !selections.length}
          title="Attribuer en priorité les lots dont la péremption est la plus proche">
          <Calendar aria-hidden="true" className="h-4 w-4" /> Répartir
        </button>
        <button type="button" onClick={() => onConfirm(selections)} disabled={!allValid} className="btn-primary text-xs">
          <Check aria-hidden="true" className="h-4 w-4" /> {confirmLabel}
        </button>
      </>}
    >
      {loadError ? <p className="py-2 text-sm text-[var(--w-error)]" role="alert">{loadError}</p> : loading ? (
        <p className="flex items-center gap-2 py-3 text-sm text-[var(--w-text-sec)]" role="status">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> Chargement des lots…
        </p>
      ) : (
        <div className="space-y-4">
          {selections.map((selection, articleIndex) => {
            const assigned = selection.assignments.reduce((sum, lot) => sum + lot.quantity, 0);
            return (
              <section key={selection.article_id} className="border-b border-[var(--w-separator)]">
                <header className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-[var(--w-separator)] pb-2">
                  <h4 className="min-w-0 break-words text-sm font-semibold">{selection.article_name}</h4>
                  <p className="text-xs num text-[var(--w-text-sec)]">
                    Attribué <strong className="text-[var(--w-text)]">{assigned} / {selection.needed}</strong>
                  </p>
                </header>

                {selection.assignments.length === 0 ? (
                  <p className="py-2 text-xs text-[var(--w-text-sec)]">Aucun lot disponible pour cet article.</p>
                ) : (
                  <div className="divide-y divide-[var(--w-separator-l)]">
                    {selection.assignments.map((lot, lotIndex) => {
                      const expired = lot.expiry_date !== null && lot.expiry_date < today;
                      return (
                        <div key={lot.lot_id} className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-3 py-2">
                          <div className="min-w-0">
                            <span className="block break-words text-sm font-medium">{lot.batch_number}</span>
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--w-text-muted)]">
                              <span>Disponible <strong className="font-medium num text-[var(--w-text-sec)]">{lot.available}</strong></span>
                              {lot.expiry_date && <span className={expired ? 'text-[var(--w-error)]' : undefined}>
                                {expired ? 'Périmé le' : 'Péremption le'}{' '}
                                <time dateTime={lot.expiry_date}>{new Date(lot.expiry_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Dakar' })}</time>
                              </span>}
                            </div>
                          </div>
                          <input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={lot.available}
                            value={lot.quantity || ''}
                            onChange={event => setQty(articleIndex, lotIndex, Number(event.target.value) || 0)}
                            aria-label={`Quantité pour le lot ${lot.batch_number} de ${selection.article_name}`}
                            className="w-input-ul h-9 min-w-0 text-center num [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            placeholder="0"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
