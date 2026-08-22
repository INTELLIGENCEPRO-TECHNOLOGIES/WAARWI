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
  { key: 'nouvelle',       label: 'Commande recue',  icon: ShoppingBag },
  { key: 'confirmee',      label: 'Confirmee',       icon: CheckCircle2 },
  { key: 'en_preparation', label: 'En preparation',  icon: Package },
  { key: 'prete',          label: 'Prete',           icon: ShoppingBag },
  { key: 'livree',         label: 'Livree',          icon: Truck },
];

const STATUS_LABEL: Record<string, string> = {
  nouvelle: 'Commande recue', confirmee: 'Confirmee', en_preparation: 'En preparation',
  prete: 'Prete', livree: 'Livree', annulee: 'Annulee',
};
const PAY_LABEL: Record<string, string> = {
  non_paye: 'Non paye', en_attente: 'En attente', paye: 'Paye', rembourse: 'Rembourse',
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
        if (!silent) { setResult(null); setErr('Aucune commande trouvee avec ce numero et ce telephone.'); }
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
    if (!orderNumber.trim() || !phone.trim()) { setErr('Veuillez saisir le numero de commande et votre telephone.'); return; }
    const n = orderNumber.trim(); const p = phone.trim();
    lastArgsRef.current = { n, p };
    setErr(''); setSearched(true);
    await doFetch(n, p, false);
  };

  useEffect(() => {
    if (!result?.id) return;
    const channel = supabase
      .channel(`track-order:${result.id}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'online_orders', filter: `id=eq.${result.id}` },
        () => { const a = lastArgsRef.current; if (a) doFetch(a.n, a.p, true); })
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'online_order_status_history', filter: `order_id=eq.${result.id}` },
        () => { const a = lastArgsRef.current; if (a) doFetch(a.n, a.p, true); })
      .subscribe();

    const poll = setInterval(() => {
      const a = lastArgsRef.current;
      if (a && !document.hidden) doFetch(a.n, a.p, true);
    }, 20000);

    return () => { supabase.removeChannel(channel); clearInterval(poll); };
  }, [result?.id]);

  const isCancelled = result?.status === 'annulee';
  const currentStepIdx = result ? STEPS.findIndex(s => s.key === result.status) : -1;

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-neutral-100">
        <div className="max-w-2xl mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-3 py-3">
            <button onClick={onBack} className="p-2 -ml-2 text-neutral-500 hover:text-neutral-900 transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              {shopLogo && (
                <img src={shopLogo} alt={shopName} className="h-8 max-w-[80px] object-contain shrink-0" />
              )}
              <div className="min-w-0">
                <div className="text-xs font-bold text-neutral-900 truncate">{shopName}</div>
                <div className="text-[10px] text-neutral-400">Suivi de commande</div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Search form */}
        <div>
          <h1 className="text-lg font-bold text-neutral-900 mb-1">Suivre ma commande</h1>
          <p className="text-sm text-neutral-400 mb-6">Saisissez votre numero de commande et votre telephone</p>

          <div className="space-y-5">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 block mb-2">Numero de commande</label>
              <input
                value={orderNumber}
                onChange={e => setOrderNumber(e.target.value.toUpperCase())}
                placeholder="WEB-000123"
                className="bare-input text-sm font-bold text-neutral-900 tracking-wider pb-2"
              />
              <div className="h-px bg-neutral-200" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 block mb-2">Telephone utilise lors de la commande</label>
              <input
                value={phone}
                onChange={e => setPhone(e.target.value)}
                inputMode="tel"
                placeholder="77 123 45 67"
                className="bare-input text-sm text-neutral-900 pb-2"
              />
              <div className="h-px bg-neutral-200" />
            </div>
            <button
              onClick={search}
              disabled={loading}
              className="h-11 px-8 bg-neutral-900 text-white text-sm font-bold hover:bg-neutral-800 active:scale-[0.98] transition-all disabled:opacity-50 inline-flex items-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {loading ? 'Recherche...' : 'Rechercher ma commande'}
            </button>
            {err && (
              <div className="flex items-start gap-2 text-sm text-red-600">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{err}</span>
              </div>
            )}
          </div>
        </div>

        {/* Results */}
        {result && (
          <div className="space-y-6 animate-scale-in">
            {isCancelled ? (
              <div className="border border-red-200 p-5 flex items-center gap-3">
                <Ban className="w-5 h-5 text-red-500 shrink-0" />
                <div>
                  <div className="font-bold text-red-900">Commande annulee</div>
                  <div className="text-xs text-red-600 mt-0.5">Contactez-nous pour plus d'informations.</div>
                </div>
              </div>
            ) : (
              <div className="border border-neutral-200 p-5">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Commande</div>
                    <div className="font-bold text-lg text-neutral-900 tracking-wider">{result.order_number}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Statut</div>
                    <div className="font-bold text-neutral-900">{STATUS_LABEL[result.status] || result.status}</div>
                  </div>
                </div>
                <ol className="space-y-3">
                  {STEPS.map((step, idx) => {
                    const Icon = step.icon;
                    const done = currentStepIdx >= idx;
                    const current = currentStepIdx === idx;
                    return (
                      <li key={step.key} className="flex items-center gap-3">
                        <div className={`relative w-8 h-8 flex items-center justify-center shrink-0 transition-all ${
                          done ? 'bg-neutral-900' : 'border border-neutral-200'
                        }`}>
                          <Icon className={`w-4 h-4 ${done ? 'text-white' : 'text-neutral-300'}`} />
                          {current && <span className="absolute inset-0 bg-neutral-400/30 animate-ping" />}
                        </div>
                        <div className="flex-1">
                          <div className={`text-sm ${done ? 'font-bold text-neutral-900' : 'text-neutral-400'}`}>{step.label}</div>
                          {current && <div className="text-[10px] font-bold text-neutral-500">Etape actuelle</div>}
                        </div>
                        {done && idx < currentStepIdx && <CheckCircle2 className="w-4 h-4 text-neutral-400 shrink-0" />}
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="border border-neutral-200 p-4">
                <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1">Paiement</div>
                <div className="font-bold text-neutral-900 text-sm">{PAY_LABEL[result.payment_status] || result.payment_status}</div>
                <div className="text-xs text-neutral-400 mt-0.5 capitalize">{(result.payment_mode || '').replace(/_/g, ' ')}</div>
              </div>
              <div className="border border-neutral-200 p-4">
                <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1">Total</div>
                <div className="font-bold text-neutral-900">{formatFCFA(result.total)}</div>
                <div className="text-xs text-neutral-400 mt-0.5">{formatDateTime(result.created_at)}</div>
              </div>
            </div>

            {/* Items */}
            <div className="border border-neutral-200">
              <div className="px-4 py-3 border-b border-neutral-100">
                <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Articles commandes</div>
              </div>
              <div className="divide-y divide-neutral-100">
                {result.items.map((it, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-3">
                    <div className="min-w-0 flex-1 mr-3">
                      <div className="text-sm font-medium text-neutral-900 truncate">{it.article_name}</div>
                      <div className="text-xs text-neutral-400">Qte {it.quantity} x {formatFCFA(it.unit_price)}</div>
                    </div>
                    <div className="text-sm font-bold text-neutral-900 shrink-0 num">{formatFCFA(it.line_total)}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Delivery */}
            <div className="border border-neutral-200 p-4 flex items-start gap-3">
              {result.delivery_mode === 'livraison' ? <Truck className="w-5 h-5 text-neutral-400 shrink-0" /> : <ShoppingBag className="w-5 h-5 text-neutral-400 shrink-0" />}
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">{result.delivery_mode === 'livraison' ? 'Livraison' : 'Retrait'}</div>
                <div className="text-sm text-neutral-800 font-medium">
                  {result.delivery_mode === 'livraison' ? (result.delivery_address || '\u2014') : 'Retrait en boutique'}
                </div>
              </div>
            </div>

            {/* History */}
            {result.history && result.history.length > 0 && (
              <div className="border border-neutral-200 p-4">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-3">
                  <Clock className="w-3.5 h-3.5" /> Historique
                </div>
                <div className="space-y-2">
                  {result.history.map((h, i) => (
                    <div key={i} className="flex items-center gap-2.5 text-sm">
                      <div className="w-1.5 h-1.5 rounded-full bg-neutral-900 shrink-0" />
                      <div className="flex-1 text-neutral-700">{STATUS_LABEL[h.new_status] || h.new_status}</div>
                      <div className="text-xs text-neutral-400">{formatDateTime(h.created_at)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {shopPhone && (
              <a href={`tel:${shopPhone}`}
                className="flex items-center justify-center gap-2 h-11 border border-neutral-200 text-neutral-700 font-medium text-sm hover:bg-neutral-50 active:scale-[0.98] transition-all">
                <Phone className="w-4 h-4" /> Contacter {shopName}
              </a>
            )}
          </div>
        )}

        {!searched && !result && (
          <div className="text-center text-sm text-neutral-400 py-12">
            <MapPin className="w-8 h-8 mx-auto text-neutral-200 mb-3" />
            Saisissez les informations ci-dessus pour suivre votre commande.
          </div>
        )}
      </div>
    </div>
  );
}
