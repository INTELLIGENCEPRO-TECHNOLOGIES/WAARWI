import { useEffect, useState } from 'react';
import { Loader2, Printer, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { printDocumentA4, type PrintTenant } from '../lib/print';
import { formatDate, formatFCFA } from '../lib/format';

type publicPayload = {
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

const SALE_STATUS: Record<string, { label: string; color: string }> = {
  paid:       { label: 'Payée',     color: 'text-emerald-600' },
  partial:    { label: 'Partielle', color: 'text-amber-600' },
  credit:     { label: 'Crédit',    color: 'text-rose-600' },
  cancelled:  { label: 'Annulée',   color: 'text-neutral-400' },
};

export function PublicInvoice({ token }: { token: string }) {
  const [data, setData] = useState<publicPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      const { data: r, error } = await supabase.rpc('get_public_sale_invoice', { p_token: token });
      if (error) setErr(error.message);
      else if (!r) setErr("Facture introuvable ou lien invalide.");
      else setData(r as publicPayload);
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
    return <div className="min-h-screen flex items-center justify-center bg-neutral-50"><Loader2 className="w-6 h-6 animate-spin text-neutral-700" /></div>;
  }
  if (err || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 p-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-neutral-200 shadow-sm p-8 text-center">
          <AlertCircle className="w-10 h-10 text-rose-500 mx-auto mb-3" />
          <h1 className="text-lg font-bold text-neutral-900">Lien invalide</h1>
          <p className="text-sm text-neutral-500 mt-2">{err || "Cette facture n'existe pas ou a été supprimée."}</p>
        </div>
      </div>
    );
  }

  const { sale, customer, tenant, items, payments } = data;
  const due = Math.max(0, Number(sale.total) - Number(sale.paid));
  const st = SALE_STATUS[sale.status] || { label: sale.status, color: 'text-neutral-500' };
  const dh = sale.doc_header;

  // Header fields for 2-column grid
  const headerFields: { label: string; value: string }[] = [
    { label: 'Date', value: formatDate(sale.created_at) },
    { label: 'Client', value: customer?.name ?? 'Comptoir' },
  ];
  if (dh?.reference) headerFields.push({ label: 'Référence', value: dh.reference });
  if (dh?.delivery_date) headerFields.push({ label: 'Livraison', value: new Date(dh.delivery_date).toLocaleDateString('fr-FR') });
  if (dh?.warranty) headerFields.push({ label: 'Garantie', value: dh.warranty });
  if (dh?.representative) headerFields.push({ label: 'Représentant', value: dh.representative });
  if (customer?.phone) headerFields.push({ label: 'Téléphone', value: customer.phone });

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Top bar — stays outside the "paper" */}
      <div className="sticky top-0 z-10 bg-white border-b border-neutral-200">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {tenant.logo_url && (
              <img src={tenant.logo_url} alt="" className="w-9 h-9 rounded-lg object-contain bg-neutral-50 shrink-0" />
            )}
            <div className="min-w-0">
              <div className="text-[9px] uppercase tracking-widest text-neutral-400 font-semibold">Facture</div>
              <div className="text-[13px] font-bold text-neutral-900 truncate">{tenant.name}</div>
            </div>
          </div>
          <button
            onClick={doPrint}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-neutral-900 text-white font-bold text-[13px] hover:bg-neutral-800 transition active:scale-95 shrink-0"
          >
            <Printer className="w-4 h-4" />
            <span className="hidden sm:inline">Imprimer / PDF</span>
            <span className="sm:hidden">PDF</span>
          </button>
        </div>
      </div>

      {/* ── Invoice "paper" — minimalist, no cards ── */}
      <div className="max-w-3xl mx-auto px-3 sm:px-8 py-5 sm:py-8">
        <div className="bg-white sm:shadow-sm sm:rounded-lg px-4 sm:px-10 py-6 sm:py-10">

          {/* ── Document title ── */}
          <div className="flex items-start justify-between mb-5">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">Facture</div>
              <div className="text-2xl font-bold text-neutral-900 leading-tight mt-0.5">{sale.sale_number}</div>
            </div>
            <div className={`text-[12px] font-bold uppercase tracking-wider ${st.color}`}>
              {st.label}
            </div>
          </div>

          {/* ── Header fields — 2 columns, underline only ── */}
          <div className="grid grid-cols-2 gap-x-6 sm:gap-x-10 mb-6">
            {headerFields.map((f, i) => (
              <div key={i} className="py-1.5">
                <div className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wider text-neutral-400">{f.label}</div>
                <div className="text-[12px] sm:text-[13px] font-semibold text-neutral-800 leading-tight mt-0.5 break-words">{f.value}</div>
                <div className="border-b border-neutral-200 mt-1" />
              </div>
            ))}
          </div>

          {/* ── Customer address (if any) — single line ── */}
          {customer?.address && (
            <div className="text-[11px] text-neutral-500 mb-4 -mt-2">{customer.address}</div>
          )}

          {/* ── Items — line separators, no cards ── */}
          <div className="mb-6">
            {items.map((item, idx) => {
              const lineTotal = Number(item.total) || (Number(item.quantity) * Number(item.unit_price) - Number(item.discount ?? 0));
              return (
                <div key={idx} className="py-2 border-b border-neutral-100 last:border-b-0">
                  {/* Line 1-2: designation */}
                  <div className="text-[13px] font-semibold text-neutral-900 leading-snug">
                    {item.name}
                  </div>
                  {/* Line 3: qty / PU / total */}
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-neutral-500">
                    <span className="num font-medium">
                      <span className="font-bold text-neutral-700">{item.quantity}</span>
                      <span className="text-neutral-400 ml-0.5">x</span>
                    </span>
                    <span className="num">{formatFCFA(Number(item.unit_price))}</span>
                    <span className="ml-auto text-[13px] font-bold text-neutral-900 num">{formatFCFA(lineTotal)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Totals — clean, right-aligned, no card ── */}
          <div className="flex justify-end mb-4">
            <div className="w-full sm:w-72 space-y-1">
              {Number(sale.discount) > 0 && (
                <>
                  <div className="flex items-center justify-between py-1 text-[12px]">
                    <span className="text-neutral-500">Sous-total</span>
                    <span className="num font-medium text-neutral-700">{formatFCFA(Number(sale.subtotal))}</span>
                  </div>
                  <div className="flex items-center justify-between py-1 text-[12px] border-b border-neutral-100">
                    <span className="text-neutral-500">Remise</span>
                    <span className="num font-medium text-rose-600">– {formatFCFA(Number(sale.discount))}</span>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between py-2 border-b-2 border-neutral-900">
                <span className="text-[12px] font-bold uppercase tracking-wider text-neutral-700">Total</span>
                <span className="text-xl font-black text-neutral-900 num">{formatFCFA(Number(sale.total))}</span>
              </div>
              {Number(sale.paid) > 0 && (
                <div className="flex items-center justify-between py-1.5 text-[12px]">
                  <span className="text-neutral-500">Déjà payé</span>
                  <span className="num font-semibold text-emerald-600">{formatFCFA(Number(sale.paid))}</span>
                </div>
              )}
              {due > 0 && (
                <div className="flex items-center justify-between py-2">
                  <span className="text-[12px] font-bold uppercase tracking-wider text-rose-600">Reste à payer</span>
                  <span className="text-lg font-black text-rose-600 num">{formatFCFA(due)}</span>
                </div>
              )}
            </div>
          </div>

          {/* ── Payments — minimal ── */}
          {payments.length > 0 && (
            <div className="mb-4">
              <div className="text-[9px] font-bold uppercase tracking-wider text-neutral-400 mb-2">Paiements reçus</div>
              {payments.map((p, idx) => (
                <div key={idx} className="flex items-center justify-between py-1 text-[12px] border-b border-neutral-100 last:border-0">
                  <span className="text-neutral-600">{p.method_name}</span>
                  <span className="num font-semibold text-emerald-600">{formatFCFA(Number(p.amount))}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── Note ── */}
          {sale.note && (
            <div className="text-[11px] text-neutral-500 italic mb-4">{sale.note}</div>
          )}

          {/* ── Tenant footer ── */}
          <div className="pt-4 border-t border-neutral-100 space-y-0.5">
            {tenant.legal_name && <div className="text-[11px] font-semibold text-neutral-700">{tenant.legal_name}</div>}
            {tenant.address && <div className="text-[10px] text-neutral-400">{tenant.address}</div>}
            {tenant.phone && <div className="text-[10px] text-neutral-400">Tél : {tenant.phone}</div>}
            {(tenant.ninea || tenant.rccm) && (
              <div className="text-[10px] text-neutral-400">
                {tenant.ninea && `NINEA : ${tenant.ninea}`}
                {tenant.ninea && tenant.rccm && ' — '}
                {tenant.rccm && `RCCM : ${tenant.rccm}`}
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 text-center text-[10px] text-neutral-300 uppercase tracking-widest">
          Propulsée par <span className="font-bold text-neutral-500">WAARWI</span>
        </div>
      </div>
    </div>
  );
}
