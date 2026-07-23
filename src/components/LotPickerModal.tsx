import { useState, useEffect, useMemo } from 'react';
import { Loader2, PackageOpen, Calendar, Zap, AlertTriangle, Check, X } from 'lucide-react';
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
};

export function LotPickerModal({ open, onClose, items, onConfirm, title = 'Selection des lots', confirmLabel = 'Confirmer' }: Props) {
  const { tenant, currentSite } = useApp();
  const [loading, setLoading] = useState(true);
  const [selections, setSelections] = useState<ArticleLotSelection[]>([]);

  useEffect(() => {
    if (!open || !tenant || !currentSite || items.length === 0) return;
    loadLots();
  }, [open, items]);

  const loadLots = async () => {
    if (!tenant || !currentSite) return;
    setLoading(true);
    const result: ArticleLotSelection[] = [];

    for (const item of items) {
      const { data: lots } = await supabase
        .from('stock_lots')
        .select('id, batch_number, expiry_date, remaining_quantity, purchase_price')
        .eq('tenant_id', tenant.id)
        .eq('site_id', currentSite.id)
        .eq('article_id', item.article_id)
        .gt('remaining_quantity', 0)
        .order('expiry_date', { ascending: true });

      result.push({
        article_id: item.article_id,
        article_name: item.name,
        needed: item.quantity,
        assignments: (lots || []).map(l => ({
          lot_id: l.id,
          batch_number: l.batch_number,
          expiry_date: l.expiry_date,
          quantity: 0,
          available: Number(l.remaining_quantity),
        })),
      });
    }
    setSelections(result);
    setLoading(false);
  };

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
    return selections.every(s => {
      const total = s.assignments.reduce((sum, a) => sum + a.quantity, 0);
      return total >= s.needed || s.assignments.length === 0;
    });
  }, [selections]);

  const today = new Date().toISOString().split('T')[0];

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg"
      footer={<>
        <button onClick={onClose} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
        <button onClick={autoFEFO} className="btn-icon" title="Auto (FEFO)"><Zap className="w-4 h-4" /></button>
        <button onClick={() => onConfirm(selections)} disabled={!allValid} className="btn-icon-primary" title={confirmLabel}>
          <Check className="w-4 h-4" />
        </button>
      </>}
    >
      {loading ? (
        <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
      ) : (
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {selections.map((s, si) => {
            const totalAssigned = s.assignments.reduce((sum, a) => sum + a.quantity, 0);
            const shortage = s.needed - totalAssigned;
            return (
              <div key={s.article_id} className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-slate-800">{s.article_name}</span>
                    <span className="text-[10px] text-slate-500 ml-2">Besoin: {s.needed}</span>
                  </div>
                  <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${shortage <= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {totalAssigned} / {s.needed}
                  </div>
                </div>

                {s.assignments.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-amber-600 flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5" /> Aucun lot disponible pour cet article
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {s.assignments.map((a, li) => {
                      const isExpired = a.expiry_date && a.expiry_date <= today;
                      return (
                        <div key={a.lot_id} className={`px-3 py-2 flex items-center gap-3 ${isExpired ? 'bg-red-50/50' : ''}`}>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 text-xs">
                              <PackageOpen className="w-3 h-3 text-slate-400 shrink-0" />
                              <span className="font-semibold text-slate-700">{a.batch_number}</span>
                              {a.expiry_date && (
                                <span className={`inline-flex items-center gap-1 ${isExpired ? 'text-red-600' : 'text-slate-500'}`}>
                                  <Calendar className="w-3 h-3" />
                                  {new Date(a.expiry_date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' })}
                                </span>
                              )}
                              <span className="text-slate-400 ml-auto">Dispo: {a.available}</span>
                            </div>
                          </div>
                          <input
                            type="number"
                            min={0}
                            max={a.available}
                            value={a.quantity || ''}
                            onChange={e => setQty(si, li, Number(e.target.value) || 0)}
                            className="w-16 text-center text-xs font-bold num border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400"
                            placeholder="0"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
