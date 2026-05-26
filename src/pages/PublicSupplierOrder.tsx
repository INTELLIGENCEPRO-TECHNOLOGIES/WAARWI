import { useEffect, useState } from 'react';
import { Loader2, Printer, Download, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { printDocumentA4, type PrintTenant } from '../lib/print';
import { formatFCFA, formatDate } from '../lib/format';

type PublicPayload = {
  order: {
    order_number: string;
    created_at: string;
    expected_date: string | null;
    status: string;
    subtotal: number;
    discount: number;
    total: number;
    note: string | null;
  };
  supplier: { name: string; phone: string | null; email: string | null; address: string | null } | null;
  tenant: PrintTenant;
  items: { name: string; supplier_ref: string | null; internal_ref: string | null; oem_ref: string | null; quantity_ordered: number; quantity_received: number; unit_price: number; total: number }[];
};

export function PublicSupplierOrder({ token }: { token: string }) {
  const [data, setData] = useState<PublicPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      const { data: r, error } = await supabase.rpc('get_public_supplier_order', { p_token: token });
      if (error) setErr(error.message);
      else if (!r) setErr("Commande introuvable ou lien invalide.");
      else setData(r as PublicPayload);
      setLoading(false);
    })();
  }, [token]);

  const doPrint = () => {
    if (!data) return;
    printDocumentA4({
      tenant: data.tenant,
      docLabel: 'BON DE COMMANDE',
      docNumber: data.order.order_number,
      docDate: formatDate(data.order.created_at),
      customer: data.supplier ? { name: data.supplier.name, phone: data.supplier.phone, address: data.supplier.address } : null,
      extraMeta: data.order.expected_date ? [{ label: 'Livraison prévue', value: formatDate(data.order.expected_date) }] : [],
      items: data.items.map(i => ({ name: i.name, supplier_ref: i.supplier_ref || null, oem_ref: i.oem_ref || null, quantity: Number(i.quantity_ordered), unit_price: Number(i.unit_price), discount: 0 })),
      subtotal: Number(data.order.subtotal),
      discount: Number(data.order.discount),
      total: Number(data.order.total),
      footerNote: data.order.note || undefined,
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
          <p className="text-sm text-slate-500 mt-2">{err || 'Cette commande n\'existe pas ou a été supprimée.'}</p>
        </div>
      </div>
    );
  }

  const { order, supplier, tenant, items } = data;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto p-4 sm:p-8">
        {/* Action bar */}
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            {tenant.logo_url && <img src={tenant.logo_url} alt="" className="w-10 h-10 rounded-xl object-contain bg-white border border-slate-200" />}
            <div>
              <div className="text-xs uppercase tracking-widest text-slate-400 font-semibold">Bon de commande</div>
              <div className="text-base font-bold text-slate-900">{tenant.name}</div>
            </div>
          </div>
          <button onClick={doPrint} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-700 text-white font-semibold text-sm shadow-sm hover:bg-brand-800 transition">
            <Download className="w-4 h-4" />
            Télécharger / Imprimer
          </button>
        </div>

        {/* Document */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 sm:p-8 border-b border-slate-200 flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="inline-block px-2.5 py-1 rounded-md bg-slate-900 text-white text-[10px] uppercase tracking-widest font-bold">Bon de commande</div>
              <h1 className="text-2xl font-extrabold text-slate-900 mt-2">N° {order.order_number}</h1>
              <div className="text-xs text-slate-500 mt-1">Émis le {formatDate(order.created_at)}</div>
              {order.expected_date && <div className="text-xs text-slate-500">Livraison prévue : {formatDate(order.expected_date)}</div>}
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">Total</div>
              <div className="text-2xl font-extrabold text-slate-900 num">{formatFCFA(order.total)}</div>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4 p-6 sm:p-8 border-b border-slate-200 bg-slate-50/60">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-1">Émetteur</div>
              <div className="text-sm font-bold text-slate-900">{tenant.legal_name || tenant.name}</div>
              {tenant.address && <div className="text-xs text-slate-500">{tenant.address}</div>}
              {tenant.phone && <div className="text-xs text-slate-500">Tél : {tenant.phone}</div>}
              {tenant.email && <div className="text-xs text-slate-500">{tenant.email}</div>}
              {tenant.ninea && <div className="text-xs text-slate-500">NINEA : {tenant.ninea}</div>}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-1">Destinataire</div>
              {supplier ? (
                <>
                  <div className="text-sm font-bold text-slate-900">{supplier.name}</div>
                  {supplier.phone && <div className="text-xs text-slate-500">Tél : {supplier.phone}</div>}
                  {supplier.email && <div className="text-xs text-slate-500">{supplier.email}</div>}
                  {supplier.address && <div className="text-xs text-slate-500">{supplier.address}</div>}
                </>
              ) : <div className="text-xs text-slate-400 italic">—</div>}
            </div>
          </div>

          <div className="p-6 sm:p-8">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-900 text-white">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wider">Désignation</th>
                    <th className="text-center px-3 py-2 text-xs font-semibold uppercase tracking-wider">Qté</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold uppercase tracking-wider">P.U.</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold uppercase tracking-wider">Montant</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((i, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-3">
                        <div className="font-semibold text-slate-900">{i.name}</div>
                        {(i.supplier_ref || i.internal_ref) && <div className="text-[11px] text-slate-400 font-mono mt-0.5">{i.supplier_ref || i.internal_ref}</div>}
                        {i.oem_ref && <div className="text-[11px] text-slate-400 font-mono">OEM: {i.oem_ref}</div>}
                      </td>
                      <td className="px-3 py-3 text-center font-semibold num">{i.quantity_ordered}</td>
                      <td className="px-3 py-3 text-right num">{formatFCFA(i.unit_price)}</td>
                      <td className="px-3 py-3 text-right font-semibold num">{formatFCFA(i.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end mt-4">
              <div className="w-full sm:w-80">
                <div className="flex justify-between py-1.5 text-sm border-b border-slate-100">
                  <span className="text-slate-500">Sous-total</span>
                  <span className="num font-semibold">{formatFCFA(order.subtotal)}</span>
                </div>
                {Number(order.discount) > 0 && (
                  <div className="flex justify-between py-1.5 text-sm border-b border-slate-100">
                    <span className="text-slate-500">Remise</span>
                    <span className="num font-semibold">-{formatFCFA(order.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between py-3 border-t-2 border-slate-900 mt-2">
                  <span className="font-bold text-slate-900">TOTAL</span>
                  <span className="num font-extrabold text-lg text-slate-900">{formatFCFA(order.total)}</span>
                </div>
              </div>
            </div>

            {order.note && (
              <div className="mt-6 p-4 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-600 italic">
                {order.note}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 text-center text-[10px] text-slate-400 tracking-widest uppercase">
          Propulsée par <span className="font-bold text-slate-600">WAARWI</span> — Plateforme Business 2.0
        </div>

        <div className="mt-4 flex justify-center sm:hidden">
          <button onClick={doPrint} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-700 text-white font-semibold text-sm shadow-sm">
            <Printer className="w-4 h-4" />
            Imprimer / PDF
          </button>
        </div>
      </div>
    </div>
  );
}
