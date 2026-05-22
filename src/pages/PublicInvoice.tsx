import { useEffect, useState } from 'react';
import { Loader2, Printer, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { printDocumentA4, type PrintTenant } from '../lib/print';
import { formatFCFA, formatDate } from '../lib/format';

type PublicPayload = {
  sale: {
    sale_number: string;
    created_at: string;
    status: string;
    subtotal: number;
    discount: number;
    total: number;
    paid: number;
    note: string | null;
  };
  customer: { name: string; phone: string | null; email: string | null; address: string | null } | null;
  tenant: PrintTenant;
  items: { name: string; quantity: number; unit_price: number; discount: number; total: number }[];
  payments: { method_name: string; amount: number }[];
};

export function PublicInvoice({ token }: { token: string }) {
  const [data, setData] = useState<PublicPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      const { data: r, error } = await supabase.rpc('get_public_sale_invoice', { p_token: token });
      if (error) setErr(error.message);
      else if (!r) setErr("Facture introuvable ou lien invalide.");
      else setData(r as PublicPayload);
      setLoading(false);
    })();
  }, [token]);

  const doPrint = () => {
    if (!data) return;
    printDocumentA4({
      tenant: data.tenant,
      docLabel: 'FACTURE',
      docNumber: data.sale.sale_number,
      docDate: formatDate(data.sale.created_at),
      customer: data.customer ? { name: data.customer.name, phone: data.customer.phone, address: data.customer.address } : null,
      items: data.items.map(i => ({ name: i.name, internal_ref: null, oem_ref: null, quantity: Number(i.quantity), unit_price: Number(i.unit_price), discount: Number(i.discount) })),
      subtotal: Number(data.sale.subtotal),
      discount: Number(data.sale.discount),
      total: Number(data.sale.total),
      payments: data.payments.map(p => ({ method_name: p.method_name, amount: Number(p.amount) })),
      paid: Number(data.sale.paid),
    });
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>;
  }
  if (err || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
          <AlertCircle className="w-10 h-10 text-rose-500 mx-auto mb-3" />
          <h1 className="text-lg font-bold text-slate-900">Lien invalide</h1>
          <p className="text-sm text-slate-500 mt-2">{err || 'Cette facture n\'existe pas ou a été supprimée.'}</p>
        </div>
      </div>
    );
  }

  const { sale, customer, tenant, items, payments } = data;
  const due = Math.max(0, Number(sale.total) - Number(sale.paid));

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto p-4 sm:p-8">
        {/* Action bar */}
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            {tenant.logo_url && <img src={tenant.logo_url} alt="" className="w-10 h-10 rounded-xl object-contain bg-white border border-slate-200" />}
            <div>
              <div className="text-xs uppercase tracking-widest text-slate-400 font-semibold">Facture</div>
              <div className="text-base font-bold text-slate-900">{tenant.name}</div>
            </div>
          </div>
          <button onClick={doPrint} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 transition shadow-sm active:scale-95">
            <Printer className="w-4 h-4" />
            Télécharger / Imprimer
          </button>
        </div>

        {/* Invoice card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Header */}
          <div className="px-6 py-5 border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="text-2xl font-bold text-slate-900 font-mono">{sale.sale_number}</div>
                <div className="text-sm text-slate-500 mt-1">{formatDate(sale.created_at)}</div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-slate-900">{formatFCFA(sale.total)}</div>
                {due > 0 && <div className="text-sm font-semibold text-amber-700 mt-0.5">Reste à payer : {formatFCFA(due)}</div>}
                {due === 0 && Number(sale.paid) > 0 && <div className="text-sm font-semibold text-emerald-700 mt-0.5">Payée intégralement</div>}
              </div>
            </div>
          </div>

          {/* Customer info */}
          {customer && (
            <div className="px-6 py-4 border-b border-slate-100">
              <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-1">Client</div>
              <div className="text-sm font-semibold text-slate-800">{customer.name}</div>
              {customer.phone && <div className="text-sm text-slate-500">{customer.phone}</div>}
              {customer.address && <div className="text-sm text-slate-500">{customer.address}</div>}
            </div>
          )}

          {/* Items */}
          <div className="px-6 py-4">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
                <tr>
                  <th className="text-left py-2 font-semibold">Article</th>
                  <th className="text-right py-2 font-semibold">Qté</th>
                  <th className="text-right py-2 font-semibold">P.U.</th>
                  <th className="text-right py-2 font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {items.map((item, i) => (
                  <tr key={i}>
                    <td className="py-2.5 text-slate-700">{item.name}</td>
                    <td className="py-2.5 text-right text-slate-600 tabular-nums">{item.quantity}</td>
                    <td className="py-2.5 text-right text-slate-600 tabular-nums">{formatFCFA(item.unit_price)}</td>
                    <td className="py-2.5 text-right font-semibold text-slate-800 tabular-nums">{formatFCFA(item.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="px-6 py-4 bg-slate-50/50 border-t border-slate-100">
            <div className="max-w-xs ml-auto space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Sous-total</span>
                <span className="font-semibold text-slate-800 tabular-nums">{formatFCFA(sale.subtotal)}</span>
              </div>
              {Number(sale.discount) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Remise</span>
                  <span className="font-semibold text-red-600 tabular-nums">-{formatFCFA(sale.discount)}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold pt-1.5 border-t border-slate-200">
                <span className="text-slate-900">Total</span>
                <span className="text-slate-900 tabular-nums">{formatFCFA(sale.total)}</span>
              </div>
              {Number(sale.paid) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-emerald-700">Payé</span>
                  <span className="font-semibold text-emerald-700 tabular-nums">{formatFCFA(sale.paid)}</span>
                </div>
              )}
              {due > 0 && (
                <div className="flex justify-between text-sm font-bold">
                  <span className="text-amber-700">Reste à payer</span>
                  <span className="text-amber-700 tabular-nums">{formatFCFA(due)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Payments */}
          {payments.length > 0 && (
            <div className="px-6 py-4 border-t border-slate-100">
              <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2">Paiements reçus</div>
              <div className="space-y-1">
                {payments.map((p, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-slate-600">{p.method_name}</span>
                    <span className="font-semibold text-slate-800 tabular-nums">{formatFCFA(p.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tenant footer */}
          <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/30 text-xs text-slate-400 space-y-0.5">
            {tenant.legal_name && <div>{tenant.legal_name}</div>}
            {tenant.address && <div>{tenant.address}</div>}
            {tenant.phone && <div>Tél : {tenant.phone}</div>}
            {tenant.ninea && <div>NINEA : {tenant.ninea}</div>}
            {tenant.rccm && <div>RCCM : {tenant.rccm}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
