import { useEffect, useState } from 'react';
import { Loader2, Printer, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { printDocumentA4, type PrintTenant } from '../lib/print';
import { formatDate } from '../lib/format';
import { DocHeader, DocItems, DocTotals } from '../components/DocLayout';
import type { DocItem } from '../components/DocLayout';

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

const ORDER_STATUS: Record<string, { label: string; color: 'amber' | 'teal' | 'emerald' | 'slate' | 'rose' }> = {
  draft:      { label: 'Brouillon',    color: 'slate' },
  sent:       { label: 'Envoyée',      color: 'blue' as any },
  received:   { label: 'Reçue',        color: 'emerald' },
  partial:    { label: 'Partielle',    color: 'amber' },
  cancelled:  { label: 'Annulée',      color: 'rose' },
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
          <p className="text-sm text-slate-500 mt-2">{err || "Cette commande n'existe pas ou a été supprimée."}</p>
        </div>
      </div>
    );
  }

  const { order, supplier, tenant, items } = data;
  const st = ORDER_STATUS[order.status] || { label: order.status, color: 'slate' as const };

  const docItems: DocItem[] = items.map(i => ({
    name: i.name,
    supplier_ref: i.supplier_ref,
    internal_ref: i.internal_ref,
    oem_ref: i.oem_ref,
    quantity: Number(i.quantity_ordered),
    quantity_ordered: Number(i.quantity_ordered),
    quantity_received: Number(i.quantity_received),
    unit_price: Number(i.unit_price),
    total: Number(i.total),
  }));

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-2xl mx-auto p-4 sm:p-6">
        {/* Barre du haut */}
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            {tenant.logo_url && (
              <img src={tenant.logo_url} alt="" className="w-10 h-10 rounded-xl object-contain bg-white border border-slate-200" />
            )}
            <div>
              <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">Bon de commande</div>
              <div className="text-[14px] font-bold text-slate-900">{tenant.name}</div>
            </div>
          </div>
          <button
            onClick={doPrint}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white font-bold text-sm hover:bg-slate-800 transition active:scale-95"
          >
            <Printer className="w-4 h-4" />
            Imprimer / PDF
          </button>
        </div>

        {/* Document card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 sm:p-5 space-y-4">
            {/* Émetteur + destinataire */}
            <div className="grid grid-cols-2 gap-3 pb-3 border-b border-slate-100">
              <div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">Émetteur</div>
                <div className="text-[12px] font-bold text-slate-900">{tenant.legal_name || tenant.name}</div>
                {tenant.address && <div className="text-[11px] text-slate-500">{tenant.address}</div>}
                {tenant.phone && <div className="text-[11px] text-slate-500">Tél : {tenant.phone}</div>}
                {tenant.ninea && <div className="text-[11px] text-slate-400">NINEA : {tenant.ninea}</div>}
              </div>
              <div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">Destinataire</div>
                {supplier ? (
                  <>
                    <div className="text-[12px] font-bold text-slate-900">{supplier.name}</div>
                    {supplier.phone && <div className="text-[11px] text-slate-500">Tél : {supplier.phone}</div>}
                    {supplier.email && <div className="text-[11px] text-slate-500">{supplier.email}</div>}
                    {supplier.address && <div className="text-[11px] text-slate-500">{supplier.address}</div>}
                  </>
                ) : <div className="text-[11px] text-slate-400 italic">—</div>}
              </div>
            </div>

            {/* En-tête standard */}
            <DocHeader
              docType="Bon de commande"
              docNumber={order.order_number}
              date={formatDate(order.created_at)}
              status={{ label: st.label, color: st.color as any }}
              extra={[
                ...(order.expected_date ? [{ label: 'Livraison prévue', value: formatDate(order.expected_date) }] : []),
              ]}
            />

            {/* Articles */}
            <DocItems items={docItems} qtyLabel="Qté cmd." showReceived />

            {/* Totaux */}
            <DocTotals
              subtotal={Number(order.subtotal)}
              discount={Number(order.discount)}
              total={Number(order.total)}
              totalLabel="Total commande"
            />

            {/* Note */}
            {order.note && (
              <div className="px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[12px] text-amber-800 italic">
                {order.note}
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-col items-center gap-3">
          <button
            onClick={doPrint}
            className="sm:hidden inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white font-bold text-sm active:scale-95"
          >
            <Printer className="w-4 h-4" />
            Imprimer / PDF
          </button>
          <div className="text-[10px] text-slate-400 uppercase tracking-widest text-center">
            Propulsée par <span className="font-bold text-slate-600">WAARWI</span> — Plateforme Business 2.0
          </div>
        </div>
      </div>
    </div>
  );
}
