import { useEffect, useState } from 'react';
import { Loader2, Printer, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { printDocumentA4, type PrintTenant } from '../lib/print';
import { formatDate } from '../lib/format';
import { DocHeader, DocItems, DocTotals, DocPayments } from '../components/DocLayout';
import type { DocItem, DocPayment } from '../components/DocLayout';

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
    doc_header?: { delivery_date?: string | null; reference?: string | null; warranty?: string | null; representative?: string | null } | null;
  };
  customer: { name: string; phone: string | null; email: string | null; address: string | null } | null;
  tenant: PrintTenant;
  items: { name: string; quantity: number; unit_price: number; discount: number; total: number }[];
  payments: { method_name: string; amount: number }[];
};

const SALE_STATUS: Record<string, { label: string; color: 'emerald' | 'amber' | 'rose' | 'slate' }> = {
  paid:       { label: 'Payée',          color: 'emerald' },
  partial:    { label: 'Partielle',      color: 'amber' },
  credit:     { label: 'Crédit',         color: 'rose' },
  cancelled:  { label: 'Annulée',        color: 'slate' },
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
      docHeader: data.sale.doc_header ?? null,
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
          <p className="text-sm text-slate-500 mt-2">{err || "Cette facture n'existe pas ou a été supprimée."}</p>
        </div>
      </div>
    );
  }

  const { sale, customer, tenant, items, payments } = data;
  const due = Math.max(0, Number(sale.total) - Number(sale.paid));
  const st = SALE_STATUS[sale.status] || { label: sale.status, color: 'slate' as const };

  const docItems: DocItem[] = items.map(i => ({
    name: i.name,
    quantity: Number(i.quantity),
    unit_price: Number(i.unit_price),
    discount: Number(i.discount),
    total: Number(i.total),
  }));

  const docPayments: DocPayment[] = payments.map(p => ({
    method_name: p.method_name,
    amount: Number(p.amount),
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
              <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">Facture</div>
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
            {/* En-tête standard */}
            <DocHeader
              docType="Facture"
              docNumber={sale.sale_number}
              date={formatDate(sale.created_at)}
              status={{ label: st.label, color: st.color }}
              customerName={customer?.name ?? null}
              extra={[
                { label: 'Total', value: `${Number(sale.total).toLocaleString('fr-FR')} FCFA` },
                ...(due > 0 ? [{ label: 'Reste dû', value: `${due.toLocaleString('fr-FR')} FCFA` }] : []),
                ...(sale.doc_header?.reference ? [{ label: 'Référence', value: sale.doc_header.reference }] : []),
                ...(sale.doc_header?.delivery_date ? [{ label: 'Livraison prévue', value: new Date(sale.doc_header.delivery_date).toLocaleDateString('fr-FR') }] : []),
                ...(sale.doc_header?.warranty ? [{ label: 'Garantie', value: sale.doc_header.warranty }] : []),
                ...(sale.doc_header?.representative ? [{ label: 'Représentant', value: sale.doc_header.representative }] : []),
              ]}
            />

            {/* Coordonnées client étendues */}
            {customer && (customer.phone || customer.address || customer.email) && (
              <div className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/80 text-[12px] text-slate-600 space-y-0.5">
                {customer.phone && <div>Tél : {customer.phone}</div>}
                {customer.email && <div>{customer.email}</div>}
                {customer.address && <div>{customer.address}</div>}
              </div>
            )}

            {/* Articles */}
            <DocItems items={docItems} />

            {/* Totaux */}
            <DocTotals
              subtotal={Number(sale.subtotal)}
              discount={Number(sale.discount)}
              total={Number(sale.total)}
              paid={Number(sale.paid) > 0 ? Number(sale.paid) : undefined}
              remaining={due > 0 ? due : undefined}
            />

            {/* Paiements */}
            <DocPayments payments={docPayments} />

            {/* Note */}
            {sale.note && (
              <div className="px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[12px] text-amber-800 italic">
                {sale.note}
              </div>
            )}
          </div>

          {/* Pied tenant */}
          <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/40 space-y-0.5">
            {tenant.legal_name && <div className="text-[11px] font-semibold text-slate-700">{tenant.legal_name}</div>}
            {tenant.address && <div className="text-[10px] text-slate-400">{tenant.address}</div>}
            {tenant.phone && <div className="text-[10px] text-slate-400">Tél : {tenant.phone}</div>}
            {tenant.ninea && <div className="text-[10px] text-slate-400">NINEA : {tenant.ninea}</div>}
            {tenant.rccm && <div className="text-[10px] text-slate-400">RCCM : {tenant.rccm}</div>}
          </div>
        </div>

        <div className="mt-5 text-center text-[10px] text-slate-400 uppercase tracking-widest">
          Propulsée par <span className="font-bold text-slate-600">WAARWI</span> — Plateforme Business 2.0
        </div>
      </div>
    </div>
  );
}
