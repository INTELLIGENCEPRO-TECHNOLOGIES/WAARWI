import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Search, Package, Truck, CheckCircle2, ShoppingBag,
  Ban, Phone, MapPin, Loader2, AlertCircle, Clock,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatFCFA, formatDateTime } from '../lib/format';

type TrackedItem = { article_name: string; internal_ref: string; quantity: number; unit_price: number; line_total: number };
type TrackedHistory = { old_status: string; new_status: string; note: string; created_at: string };
type TrackedOrder = {
  id: string; order_number: string; status: string; payment_status: string;
  delivery_mode: string; delivery_address: string; payment_mode: string;
  customer_name: string; customer_phone: string; customer_note: string;
  subtotal: number; total: number; delivery_fee: number;
  created_at: string; updated_at: string;
  items: TrackedItem[]; history: TrackedHistory[];
};

const STEPS: { key: string; label: string; icon: any }[] = [
  { key: 'nouvelle',       label: 'Commande reçue', icon: ShoppingBag },
  { key: 'confirmee',      label: 'Confirmée',      icon: CheckCircle2 },
  { key: 'en_preparation', label: 'En préparation', icon: Package },
  { key: 'prete',          label: 'Prête',          icon: ShoppingBag },
  { key: 'livree',         label: 'Livrée',         icon: Truck },
];

const STATUS_LABEL: Record<string, string> = {
  nouvelle: 'Commande reçue', confirmee: 'Confirmée', en_preparation: 'En préparation',
  prete: 'Prête', livree: 'Livrée', annulee: 'Annulée',
};
const PAY_LABEL: Record<string, string> = {
  non_paye: 'Non payé', en_attente: 'En attente', paye: 'Payé', rembourse: 'Remboursé',
};

export function ShopTrackOrder({
  tenantId, shopName, shopLogo, shopPhone, onBack, initialOrderNumber, initialPhone,
}: {
  tenantId: string; shopName: string; shopLogo: string; shopPhone: string;
  onBack: () => void; initialOrderNumber?: string; initialPhone?: string;
}) {
  const [orderNumber, setOrderNumber] = useState(initialOrderNumber || '');
  const [phone, setPhone] = useState(initialPhone || '');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TrackedOrder | null>(null);
  const [err, setErr] = useState('');
  const [searched, setSearched] = useState(false);

  const lastArgsRef = useRef<{ n: string; p: string } | null>(null);

  const doFetch = async (n: string, p: string, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data, error } = await supabase.rpc('track_online_order', {
        p_tenant_id: tenantId, p_order_number: n, p_phone: p,
      });
      if (error) throw error;
      if (!data) {
        if (!silent) { setResult(null); setErr('Aucune commande trouvée avec ce numéro et ce téléphone.'); }
      } else {
        setResult(data as TrackedOrder);
        if (!silent) setErr('');
      }
    } catch (e: any) {
      if (!silent) { setErr(e.message || 'Erreur lors de la recherche.'); setResult(null); }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const search = async () => {
    if (!orderNumber.trim() || !phone.trim()) { setErr('Veuillez saisir le numéro de commande et votre téléphone.'); return; }
    const n = orderNumber.trim(); const p = phone.trim();
    lastArgsRef.current = { n, p };
    setErr(''); setSearched(true);
    await doFetch(n, p, false);
  };

  // Auto-refresh tracked order in realtime when its status changes server-side.
  useEffect(() => {
    if (!result?.id) return;
    const channel = supabase
      .channel(`track-order:${result.id}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'online_orders', filter: `id=eq.${result.id}` },
        () => {
          const a = lastArgsRef.current;
          if (a) doFetch(a.n, a.p, true);
        })
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'online_order_status_history', filter: `order_id=eq.${result.id}` },
        () => {
          const a = lastArgsRef.current;
          if (a) doFetch(a.n, a.p, true);
        })
      .subscribe();

    // Safety net: light poll every 20s while page is open
    const poll = setInterval(() => {
      const a = lastArgsRef.current;
      if (a && !document.hidden) doFetch(a.n, a.p, true);
    }, 20000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [result?.id]);

  const isCancelled = result?.status === 'annulee';
  const currentStepIdx = result ? STEPS.findIndex(s => s.key === result.status) : -1;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-3 py-3">
            <button onClick={onBack} className="p-2 -ml-2 rounded-xl hover:bg-slate-100 transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              {shopLogo ? (
                <img src={shopLogo} alt={shopName} className="h-9 max-w-[80px] object-contain shrink-0" />
              ) : (
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 flex items-center justify-center shrink-0 shadow-sm">
                  <Package className="w-4 h-4 text-white" />
                </div>
              )}
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wider text-brand-700/70 leading-none">Suivi de commande</div>
                <div className="text-base font-bold text-slate-900 truncate leading-tight">{shopName}</div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center">
              <Search className="w-4 h-4 text-brand-700" />
            </div>
            <div>
              <div className="font-bold text-slate-900">Suivre ma commande</div>
              <div className="text-xs text-slate-500">Saisissez votre numéro de commande et votre téléphone</div>
            </div>
          </div>
          <div className="space-y-2.5">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Numéro de commande</label>
              <input value={orderNumber} onChange={e => setOrderNumber(e.target.value.toUpperCase())} placeholder="WEB-000123"
                className="w-full h-11 px-3.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 focus:bg-white focus:border-brand-400 focus:ring-2 focus:ring-brand-500/15 outline-none transition-all font-semibold tracking-wider" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Téléphone utilisé lors de la commande</label>
              <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="77 123 45 67"
                className="w-full h-11 px-3.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 focus:bg-white focus:border-brand-400 focus:ring-2 focus:ring-brand-500/15 outline-none transition-all" />
            </div>
            <button onClick={search} disabled={loading}
              className="w-full h-12 rounded-xl bg-gradient-to-r from-brand-600 to-brand-800 text-white font-bold inline-flex items-center justify-center gap-2 hover:opacity-95 active:scale-[0.98] transition-all shadow-glow disabled:opacity-60">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {loading ? 'Recherche…' : 'Rechercher ma commande'}
            </button>
            {err && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{err}</span>
              </div>
            )}
          </div>
        </div>

        {result && (
          <div className="space-y-4 animate-scale-in">
            {isCancelled ? (
              <div className="bg-rose-50 border border-rose-200 rounded-2xl p-5 flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-rose-500 flex items-center justify-center shrink-0">
                  <Ban className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="font-bold text-rose-900">Commande annulée</div>
                  <div className="text-xs text-rose-700 mt-0.5">Cette commande a été annulée. Contactez-nous pour plus d'informations.</div>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Commande</div>
                    <div className="font-extrabold text-lg text-slate-900 tracking-wider">{result.order_number}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Statut actuel</div>
                    <div className="font-bold text-brand-800">{STATUS_LABEL[result.status] || result.status}</div>
                  </div>
                </div>
                <ol className="relative space-y-3">
                  {STEPS.map((step, idx) => {
                    const Icon = step.icon;
                    const done = currentStepIdx >= idx;
                    const current = currentStepIdx === idx;
                    return (
                      <li key={step.key} className="flex items-center gap-3">
                        <div className={`relative w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-all ${done ? 'bg-gradient-to-br from-brand-600 to-brand-800 shadow-glow' : 'bg-slate-100 border border-slate-200'}`}>
                          <Icon className={`w-4 h-4 ${done ? 'text-white' : 'text-slate-400'}`} />
                          {current && <span className="absolute inset-0 rounded-full bg-brand-500/30 animate-ping" />}
                        </div>
                        <div className="flex-1">
                          <div className={`text-sm font-semibold ${done ? 'text-slate-900' : 'text-slate-400'}`}>{step.label}</div>
                          {current && <div className="text-xs text-brand-700 font-medium">Étape actuelle</div>}
                        </div>
                        {done && idx < currentStepIdx && <CheckCircle2 className="w-4 h-4 text-brand-600 shrink-0" />}
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-4">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Paiement</div>
                <div className="font-bold text-slate-900 text-sm">{PAY_LABEL[result.payment_status] || result.payment_status}</div>
                <div className="text-xs text-slate-500 mt-0.5 capitalize">{(result.payment_mode || '').replace(/_/g, ' ')}</div>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-4">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Total</div>
                <div className="font-extrabold text-slate-900">{formatFCFA(result.total)}</div>
                <div className="text-xs text-slate-500 mt-0.5">{formatDateTime(result.created_at)}</div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-card overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Articles commandés</div>
              </div>
              <div className="divide-y divide-slate-100">
                {result.items.map((it, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-3">
                    <div className="min-w-0 flex-1 mr-3">
                      <div className="text-sm font-semibold text-slate-900 truncate">{it.article_name}</div>
                      <div className="text-xs text-slate-500">Qté {it.quantity} × {formatFCFA(it.unit_price)}</div>
                    </div>
                    <div className="text-sm font-bold text-slate-900 shrink-0">{formatFCFA(it.line_total)}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
                  {result.delivery_mode === 'livraison' ? <Truck className="w-4 h-4 text-brand-700" /> : <ShoppingBag className="w-4 h-4 text-brand-700" />}
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{result.delivery_mode === 'livraison' ? 'Livraison' : 'Retrait'}</div>
                  <div className="text-sm text-slate-800 font-medium">
                    {result.delivery_mode === 'livraison' ? (result.delivery_address || '—') : 'Retrait en boutique'}
                  </div>
                </div>
              </div>
            </div>

            {result.history && result.history.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-4">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2.5">
                  <Clock className="w-3.5 h-3.5" /> Historique
                </div>
                <div className="space-y-2">
                  {result.history.map((h, i) => (
                    <div key={i} className="flex items-center gap-2.5 text-sm">
                      <div className="w-2 h-2 rounded-full bg-brand-500 shrink-0" />
                      <div className="flex-1 text-slate-700">{STATUS_LABEL[h.new_status] || h.new_status}</div>
                      <div className="text-xs text-slate-400">{formatDateTime(h.created_at)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {shopPhone && (
              <a href={`tel:${shopPhone}`}
                className="flex items-center justify-center gap-2 w-full h-12 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm hover:bg-slate-200 active:scale-[0.98] transition-all">
                <Phone className="w-4 h-4" /> Contacter {shopName}
              </a>
            )}
          </div>
        )}

        {!searched && !result && (
          <div className="text-center text-xs text-slate-500 py-8">
            <MapPin className="w-8 h-8 mx-auto text-slate-300 mb-2" />
            Saisissez les informations ci-dessus pour suivre votre commande.
          </div>
        )}
      </div>
    </div>
  );
}
