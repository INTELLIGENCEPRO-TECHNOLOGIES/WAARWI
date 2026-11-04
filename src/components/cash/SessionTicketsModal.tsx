import { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, ChevronRight, FileText, HandCoins, List, Loader2, Printer, RefreshCw, RotateCcw, Wallet } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../context/AppContext';
import { usePermissions } from '../../lib/permissions';
import { formatFCFA, formatDateTime } from '../../lib/format';
import { CashModal } from '../CashModal';
import { isSaleSettlementIncome } from '../../lib/cashMovements';
import { cashOpError, type CashOpContext, type SessionSale } from './cashOpContext';
import { printEncaissementTicket80, printDecaissementTicket80, type PrintTenant } from '../../lib/print';
import { printSaleTicketDoc, printSaleInvoiceDoc, type PrintableSale } from './saleDocPrint';
interface Props {
  ctx: CashOpContext;
  onClose: () => void;
}

export function SessionTicketsModal({ ctx, onClose }: Props) {
  const { tenant } = useApp();
  const { can } = usePermissions();
  const [bound] = useState(ctx);
  const authorName = (userId?: string | null) => (userId && sessionProfileNames[userId]) || bound.operatorName || bound.userName;
  const printSaleTicket = (sale: PrintableSale, docHeader: Record<string, string | null> | null | undefined, sellerId: string | null | undefined) => printSaleTicketDoc(sale, docHeader ?? null, bound.printTenant, authorName(sellerId));
  const printSaleInvoice = (sale: PrintableSale, docHeader: Record<string, string | null> | null | undefined, sellerId: string | null | undefined) => printSaleInvoiceDoc(sale, docHeader ?? null, bound.printTenant, authorName(sellerId), (sellerId && sessionProfileNames[sellerId]) || 'Utilisateur non renseigné');
  const [sessionSales, setSessionSales] = useState<SessionSale[]>([]);
  const [sessionProfileNames, setSessionProfileNames] = useState<Record<string, string>>({});
  const [sessionMovements, setSessionMovements] = useState<{ id: string; kind: 'expense' | 'income' | 'customer_prepayment' | 'customer_withdrawal' | 'customer_loan' | 'refund'; amount: number; reason: string; method_name: string; reference: string; customer_name: string | null; created_at: string; user_id: string | null }[]>([]);
  const [sessionInvPayments, setSessionInvPayments] = useState<{ sale_number: string; amount: number; method_name: string; customer_name: string | null; created_at: string }[]>([]);
  const [ticketsExpanded, setTicketsExpanded] = useState<'tickets' | 'encDirect' | 'acomptes' | 'depenses' | 'remboursements' | 'retraits' | 'prets' | 'reglements' | null>('tickets');
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [sessionEncaisse, setSessionEncaisse] = useState(0);

const load = async () => {
    if (!tenant) return;
    setLoadingTickets(true);
    setLoadError('');
    try {
    const results = await Promise.all([
      supabase
        .from('sales')
        .select('id, sale_number, total, paid, created_at, customers(name, phone, address), status, sale_items(article_id, name, quantity, unit_price), doc_header, user_id')
        .eq('tenant_id', tenant.id)
        .eq('cash_session_id', bound.sessionId)
        .order('created_at', { ascending: false }),
      supabase
        .from('sale_returns')
        .select('id, return_number, total, created_at, sale_id, customer_id, customers(name, phone, address)')
        .eq('tenant_id', tenant.id)
        .eq('cash_session_id', bound.sessionId)
        .order('created_at', { ascending: false }),
      supabase
        .from('cash_movements')
        .select('id, kind, amount, reason, method_name, reference, created_at, user_id, customers(name)')
        .eq('tenant_id', tenant.id)
        .eq('cash_session_id', bound.sessionId)
        .order('created_at', { ascending: false }),
      supabase
        .from('sale_payments')
        .select('amount, reference, method_name, created_at, sales(sale_number, cash_session_id, customers(name))')
        .eq('tenant_id', tenant.id)
        .eq('cash_session_id', bound.sessionId)
        .order('created_at'),
      supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('tenant_id', tenant.id),
    ]);
    const failed = results.find(r => r.error);
    if (failed) { setLoadError(cashOpError(failed.error, 'Impossible de charger les tickets de la session.')); return; }
    const [{ data }, { data: retData }, { data: mvData }, { data: pmtData }, { data: profData }] = results;
    const profMap: Record<string, string> = {};
    (profData || []).forEach((p: any) => { profMap[p.id] = p.full_name || p.email || ''; });
    setSessionProfileNames(profMap);
    const sales: SessionSale[] = (data || []).map((s: any) => ({
      id: s.id, sale_number: s.sale_number, total: Number(s.total), paid: Math.min(Number(s.total || 0), Number(s.paid || 0)),
      created_at: s.created_at, customer_name: s.customers?.name || null, customer_phone: s.customers?.phone || null, customer_address: s.customers?.address || null, status: s.status,
      items: (s.sale_items || []).map((i: any) => ({ article_id: i.article_id || '', name: i.name, quantity: Number(i.quantity), unit_price: Number(i.unit_price) })),
      doc_header: s.doc_header || null,
      user_id: s.user_id || null,
    }));
    const returns: SessionSale[] = (retData || []).map((r: any) => ({
      id: r.id, sale_number: r.return_number, total: -Number(r.total), paid: -Number(r.total),
      created_at: r.created_at, customer_name: r.customers?.name || null, customer_phone: r.customers?.phone || null, customer_address: r.customers?.address || null, status: 'return',
      items: [],
    }));
    setSessionSales([...sales, ...returns].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
    const movs = (mvData || []).map((m: any) => ({
      id: m.id,
      kind: m.kind as 'expense' | 'income' | 'customer_prepayment' | 'customer_withdrawal' | 'customer_loan' | 'refund',
      amount: Number(m.amount), reason: m.reason || '',
      method_name: m.method_name || '', reference: m.reference || '',
      customer_name: m.customers?.name || null,
      created_at: m.created_at || '',
      user_id: m.user_id || null,
    })).filter(m => !isSaleSettlementIncome(m.kind, m.reason));
    setSessionMovements(movs);
    const invPayments = (pmtData || [])
      .filter((p: any) => (p.reference && p.reference.startsWith('Règlement facture')) || !p.sales || p.sales.cash_session_id !== bound.sessionId)
      .map((p: any) => ({
        sale_number: p.sales?.sale_number || '',
        amount: Number(p.amount),
        method_name: p.method_name || '',
        customer_name: p.sales?.customers?.name || null,
        created_at: p.created_at || '',
      }));
    setSessionInvPayments(invPayments);
    const pmtTotal = (pmtData || []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
    const movEncaisseTotal = (mvData || [])
      .filter((m: any) => m.kind !== 'expense' && m.kind !== 'refund' && m.kind !== 'customer_withdrawal' && m.kind !== 'customer_loan' && !isSaleSettlementIncome(m.kind, m.reason))
      .reduce((s: number, m: any) => s + Number(m.amount || 0), 0);
    setSessionEncaisse(pmtTotal + movEncaisseTotal);
    setTicketsExpanded('tickets');
    } catch (e) {
      setLoadError(cashOpError(e as { message?: string }, 'Impossible de charger les tickets de la session.'));
    } finally {
      setLoadingTickets(false);
    }
  };

  useEffect(() => { load(); }, [bound, tenant?.id]);

  return (
    <>
      {/* Session tickets list */}
      <CashModal open={true} onClose={() => onClose()} title="Tickets de la session"
        footer={<button onClick={() => onClose()} className="px-4 py-2 text-[13px] font-semibold text-neutral-700 border border-neutral-200 rounded-md hover:bg-neutral-50 transition-colors">Fermer</button>}
      >
        {loadingTickets ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
        ) : loadError ? (
          <div className="py-8 text-center">
            <p className="text-sm text-red-700">{loadError}</p>
            <p className="mt-1 text-xs text-neutral-500">La liste n'est pas affichée tant que les données ne sont pas chargées.</p>
            <button onClick={() => load()} className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-neutral-900 underline underline-offset-4"><RefreshCw className="w-3.5 h-3.5" />Réessayer</button>
          </div>
        ) : sessionSales.length === 0 && sessionMovements.length === 0 && sessionInvPayments.length === 0 ? (
          <div className="py-8 text-center text-sm text-neutral-500">Aucune activité dans cette session.</div>
        ) : (() => {
          const encDirectList = sessionMovements.filter(m => m.kind === 'income');
          const acomptesList = sessionMovements.filter(m => m.kind === 'customer_prepayment');
          const depensesList = sessionMovements.filter(m => m.kind === 'expense');
          const remboursementsList = sessionMovements.filter(m => m.kind === 'refund');
          const retraitsList = sessionMovements.filter(m => m.kind === 'customer_withdrawal');
          const pretsList = sessionMovements.filter(m => m.kind === 'customer_loan');
          const encDirectTotal = encDirectList.reduce((s, m) => s + m.amount, 0);
          const acomptesTotal = acomptesList.reduce((s, m) => s + m.amount, 0);
          const depensesTotal = depensesList.reduce((s, m) => s + m.amount, 0);
          const remboursementsTotal = remboursementsList.reduce((s, m) => s + m.amount, 0);
          const retraitsTotal = retraitsList.reduce((s, m) => s + m.amount, 0);
          const pretsTotal = pretsList.reduce((s, m) => s + m.amount, 0);
          return (
          <div>
            {/* KPI strip */}
            {can('pos_view_session_stats') && (
            <div className="flex items-center border-b border-neutral-200 pb-4 mb-4">
              <div className="flex-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-0.5">Tickets</div>
                <div className="text-xl font-bold text-neutral-900 num">{sessionSales.filter(x => x.status !== 'return').length}</div>
              </div>
              <div className="w-px h-8 bg-neutral-200 mx-4 shrink-0" />
              <div className="flex-1 text-right">
                <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-0.5">Total encaissé</div>
                <div className="text-xl font-bold text-neutral-900 num">{formatFCFA(sessionEncaisse)}</div>
              </div>
            </div>
            )}

            {/* Tickets de vente section */}
            <div>
              <button onClick={() => setTicketsExpanded(ticketsExpanded === 'tickets' ? null : 'tickets')} className="w-full flex items-center justify-between py-2 text-left transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <List className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                  <span className="text-[13px] font-semibold text-neutral-900">Tickets de vente</span>
                  <span className="text-[11px] text-neutral-400">{sessionSales.length}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {can('pos_view_session_stats') && <span className="text-[13px] font-bold text-neutral-900 num">{formatFCFA(sessionSales.reduce((s, x) => s + x.total, 0))}</span>}
                  <ChevronRight className={`w-3.5 h-3.5 text-neutral-300 transition-transform duration-200 ${ticketsExpanded === 'tickets' ? 'rotate-90' : ''}`} />
                </div>
              </button>
              {ticketsExpanded === 'tickets' && (
                <div className="mt-1">
                  {sessionSales.length === 0 ? (
                    <div className="text-center py-4 text-[12px] text-neutral-500">Aucun ticket.</div>
                  ) : sessionSales.map(s => (
                    <div key={s.id} className={`py-3 border-b border-neutral-100 last:border-b-0 ${s.status === 'return' ? 'bg-red-50/20' : ''}`}>
                      <div className="flex items-center justify-between">
                        <div className={`text-[13px] font-semibold truncate ${s.status === 'return' ? 'text-red-700' : 'text-neutral-900'}`}>
                          {s.customer_name || (s.status === 'return' ? 'Remboursement' : 'Client comptoir')}
                          {s.status === 'return' && <span className="ml-1.5 text-[10px] font-bold uppercase text-red-600">Retour</span>}
                        </div>
                        <span className={`text-[13px] font-bold num shrink-0 ml-3 ${s.total < 0 ? 'text-red-600' : 'text-neutral-900'}`}>{s.total < 0 ? '-' : ''}{formatFCFA(Math.abs(s.total))}</span>
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <div className="flex items-center gap-0 text-[11px] text-neutral-400 num whitespace-nowrap">
                          <span className={`font-semibold ${s.status === 'return' ? 'text-red-500' : ''}`}>{s.sale_number}</span>
                          <span className="mx-1.5">·</span>
                          <span>{formatDateTime(s.created_at)}</span>
                        </div>
                        {s.status !== 'return' && can('pos_reprint') && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button title="Ticket 80mm" onClick={() => {
                              const fakeSale = {
                                sale_number: s.sale_number, created_at: s.created_at, total: s.total, discount: 0,
                                items: s.items.map(i => ({ ...i, discount: 0, article_id: '', internal_ref: '', stock_available: 0, purchase_cost: 0 })),
                                payments: [{ payment_method_id: null, method_name: 'Règlement', amount: s.paid, reference: '' }],
                                customer: s.customer_name ? { id: '', tenant_id: '', name: s.customer_name, phone: s.customer_phone || '', email: '', address: s.customer_address || '', customer_type: '', balance: 0 } : null,
                              };
                              printSaleTicket(fakeSale as any, s.doc_header, s.user_id);
                            }} className="p-1 text-neutral-400 hover:text-neutral-700 transition-colors">
                              <Printer className="w-3.5 h-3.5" />
                            </button>
                            <button title="Facture A4" onClick={() => {
                              const fakeSale = {
                                sale_number: s.sale_number, created_at: s.created_at, total: s.total, discount: 0,
                                items: s.items.map(i => ({ ...i, discount: 0, article_id: '', internal_ref: '', stock_available: 0, purchase_cost: 0 })),
                                payments: [{ payment_method_id: null, method_name: 'Règlement', amount: s.paid, reference: '' }],
                                customer: s.customer_name ? { id: '', tenant_id: '', name: s.customer_name, phone: s.customer_phone || '', email: '', address: s.customer_address || '', customer_type: '', balance: 0 } : null,
                              };
                              printSaleInvoice(fakeSale as any, s.doc_header, s.user_id);
                            }} className="p-1 text-neutral-400 hover:text-neutral-700 transition-colors">
                              <FileText className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Other sections */}
            <div className="border-t border-neutral-200 mt-2 pt-1">
              {encDirectList.length > 0 && (
                <div className="border-b border-neutral-100">
                  <button onClick={() => setTicketsExpanded(ticketsExpanded === 'encDirect' ? null : 'encDirect')} className="w-full flex items-center justify-between py-3 text-left transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <ArrowDownRight className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                      <span className="text-[13px] font-semibold text-neutral-900">Encaissements directs</span>
                      <span className="text-[11px] text-neutral-400">{encDirectList.length}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {can('pos_view_session_stats') && <span className="text-[13px] font-bold text-neutral-900 num">+{formatFCFA(encDirectTotal)}</span>}
                      <ChevronRight className={`w-3.5 h-3.5 text-neutral-300 transition-transform duration-200 ${ticketsExpanded === 'encDirect' ? 'rotate-90' : ''}`} />
                    </div>
                  </button>
                  {ticketsExpanded === 'encDirect' && (
                    <div className="pb-2">
                      {encDirectList.map((m, i) => (
                        <div key={i} className="py-2.5 pl-6 border-b border-neutral-100 last:border-b-0">
                          <div className="flex items-center justify-between">
                            <div className="text-[13px] font-semibold text-neutral-900 truncate">{m.reason || 'Encaissement direct'}</div>
                            <span className="text-[13px] font-bold text-neutral-900 num shrink-0 ml-3">+{formatFCFA(m.amount)}</span>
                          </div>
                          <div className="flex items-center justify-between mt-0.5">
                            <div className="text-[11px] text-neutral-400 num">
                              <span>{m.method_name || 'Espèces'}</span>
                              <span className="mx-1.5">·</span>
                              <span>{formatDateTime(m.created_at)}</span>
                            </div>
                            {can('pos_reprint') && <button
                              title="Réimprimer le reçu"
                              onClick={() => {
                                try {
                                  printEncaissementTicket80({
                                    receiptNumber: `ENC-${String(m.id).slice(0, 8).toUpperCase()}`,
                                    amount: m.amount,
                                    method: m.method_name || 'Espèces',
                                    label: m.reason || undefined,
                                    reference: m.reference || undefined,
                                    customerName: m.customer_name,
                                    createdAt: m.created_at,
                                    tenant: bound.printTenant as PrintTenant,
                                    cashier: authorName(m.user_id),
                                  });
                                } catch {}
                              }}
                              className="p-1 text-neutral-400 hover:text-neutral-700 transition-colors"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </button>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {sessionInvPayments.length > 0 && (
                <div className="border-b border-neutral-100">
                  <button onClick={() => setTicketsExpanded(ticketsExpanded === 'reglements' ? null : 'reglements')} className="w-full flex items-center justify-between py-3 text-left transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <Wallet className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                      <span className="text-[13px] font-semibold text-neutral-900">Reglements factures</span>
                      <span className="text-[11px] text-neutral-400">{sessionInvPayments.length}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {can('pos_view_session_stats') && <span className="text-[13px] font-bold text-neutral-900 num">+{formatFCFA(sessionInvPayments.reduce((s, p) => s + p.amount, 0))}</span>}
                      <ChevronRight className={`w-3.5 h-3.5 text-neutral-300 transition-transform duration-200 ${ticketsExpanded === 'reglements' ? 'rotate-90' : ''}`} />
                    </div>
                  </button>
                  {ticketsExpanded === 'reglements' && (
                    <div className="pb-2">
                      {sessionInvPayments.map((p, i) => (
                        <div key={i} className="py-2.5 pl-6 border-b border-neutral-100 last:border-b-0">
                          <div className="flex items-center justify-between">
                            <div className="text-[13px] font-semibold text-neutral-900 truncate">{p.customer_name || 'Client'}</div>
                            <span className="text-[13px] font-bold text-neutral-900 num shrink-0 ml-3">+{formatFCFA(p.amount)}</span>
                          </div>
                          <div className="text-[11px] text-neutral-400 num mt-0.5">
                            <span className="font-semibold">{p.sale_number}</span>
                            {p.method_name && <><span className="mx-1.5">·</span><span>{p.method_name}</span></>}
                            <span className="mx-1.5">·</span>
                            <span>{formatDateTime(p.created_at)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {acomptesList.length > 0 && (
                <div className="border-b border-neutral-100">
                  <button onClick={() => setTicketsExpanded(ticketsExpanded === 'acomptes' ? null : 'acomptes')} className="w-full flex items-center justify-between py-3 text-left transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <Wallet className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                      <span className="text-[13px] font-semibold text-neutral-900">Acomptes clients</span>
                      <span className="text-[11px] text-neutral-400">{acomptesList.length}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {can('pos_view_session_stats') && <span className="text-[13px] font-bold text-neutral-900 num">+{formatFCFA(acomptesTotal)}</span>}
                      <ChevronRight className={`w-3.5 h-3.5 text-neutral-300 transition-transform duration-200 ${ticketsExpanded === 'acomptes' ? 'rotate-90' : ''}`} />
                    </div>
                  </button>
                  {ticketsExpanded === 'acomptes' && (
                    <div className="pb-2">
                      {acomptesList.map((m, i) => (
                        <div key={i} className="py-2.5 pl-6 border-b border-neutral-100 last:border-b-0">
                          <div className="flex items-center justify-between">
                            <div className="text-[13px] font-semibold text-neutral-900 truncate">{m.customer_name || 'Client'}</div>
                            <span className="text-[13px] font-bold text-neutral-900 num shrink-0 ml-3">+{formatFCFA(m.amount)}</span>
                          </div>
                          <div className="flex items-center justify-between mt-0.5">
                            <div className="text-[11px] text-neutral-400 num">
                              <span>{m.method_name || 'Acompte'}</span>
                              <span className="mx-1.5">·</span>
                              <span>{formatDateTime(m.created_at)}</span>
                            </div>
                            {can('pos_reprint') && <button
                              title="Réimprimer le reçu"
                              onClick={() => {
                                try {
                                  printEncaissementTicket80({
                                    receiptNumber: `ACO-${String(m.id).slice(0, 8).toUpperCase()}`,
                                    amount: m.amount,
                                    method: m.method_name || 'Espèces',
                                    label: m.reason ? `Acompte · ${m.reason}` : 'Acompte client',
                                    reference: m.reference || undefined,
                                    customerName: m.customer_name,
                                    createdAt: m.created_at,
                                    tenant: bound.printTenant as PrintTenant,
                                    cashier: authorName(m.user_id),
                                  });
                                } catch {}
                              }}
                              className="p-1 text-neutral-400 hover:text-neutral-700 transition-colors"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </button>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {depensesList.length > 0 && (
                <div className="border-b border-neutral-100">
                  <button onClick={() => setTicketsExpanded(ticketsExpanded === 'depenses' ? null : 'depenses')} className="w-full flex items-center justify-between py-3 text-left transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <ArrowUpRight className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                      <span className="text-[13px] font-semibold text-neutral-900">Décaissements</span>
                      <span className="text-[11px] text-neutral-400">{depensesList.length}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {can('pos_view_session_stats') && <span className="text-[13px] font-bold text-neutral-900 num">-{formatFCFA(depensesTotal)}</span>}
                      <ChevronRight className={`w-3.5 h-3.5 text-neutral-300 transition-transform duration-200 ${ticketsExpanded === 'depenses' ? 'rotate-90' : ''}`} />
                    </div>
                  </button>
                  {ticketsExpanded === 'depenses' && (
                    <div className="pb-2">
                      {depensesList.map((m, i) => (
                        <div key={i} className="py-2.5 pl-6 border-b border-neutral-100 last:border-b-0">
                          <div className="flex items-center justify-between">
                            <div className="text-[13px] font-semibold text-neutral-900 truncate">{m.reason || 'Dépense'}</div>
                            <span className="text-[13px] font-bold text-neutral-900 num shrink-0 ml-3">-{formatFCFA(m.amount)}</span>
                          </div>
                          <div className="flex items-center justify-between mt-0.5">
                            <div className="text-[11px] text-neutral-400 num">
                              <span>{m.method_name || 'Espèces'}</span>
                              <span className="mx-1.5">·</span>
                              <span>{formatDateTime(m.created_at)}</span>
                            </div>
                            {can('pos_reprint') && <button
                              title="Réimprimer le bon"
                              onClick={() => {
                                try {
                                  printDecaissementTicket80({
                                    receiptNumber: `DEC-${String(m.id).slice(0, 8).toUpperCase()}`,
                                    amount: m.amount,
                                    method: m.method_name || 'Espèces',
                                    label: m.reason || undefined,
                                    reference: m.reference || undefined,
                                    beneficiary: m.customer_name,
                                    createdAt: m.created_at,
                                    tenant: bound.printTenant as PrintTenant,
                                    cashier: authorName(m.user_id),
                                  });
                                } catch {}
                              }}
                              className="p-1 text-neutral-400 hover:text-neutral-700 transition-colors"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </button>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {remboursementsList.length > 0 && (
                <div className="border-b border-neutral-100">
                  <button onClick={() => setTicketsExpanded(ticketsExpanded === 'remboursements' ? null : 'remboursements')} className="w-full flex items-center justify-between py-3 text-left transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <RotateCcw className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                      <span className="text-[13px] font-semibold text-neutral-900">Remboursements</span>
                      <span className="text-[11px] text-neutral-400">{remboursementsList.length}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {can('pos_view_session_stats') && <span className="text-[13px] font-bold text-neutral-900 num">-{formatFCFA(remboursementsTotal)}</span>}
                      <ChevronRight className={`w-3.5 h-3.5 text-neutral-300 transition-transform duration-200 ${ticketsExpanded === 'remboursements' ? 'rotate-90' : ''}`} />
                    </div>
                  </button>
                  {ticketsExpanded === 'remboursements' && (
                    <div className="pb-2">
                      {remboursementsList.map((m, i) => (
                        <div key={i} className="py-2.5 pl-6 border-b border-neutral-100 last:border-b-0">
                          <div className="flex items-center justify-between">
                            <div className="text-[13px] font-semibold text-neutral-900 truncate">{m.reason || 'Remboursement'}</div>
                            <span className="text-[13px] font-bold text-neutral-900 num shrink-0 ml-3">-{formatFCFA(m.amount)}</span>
                          </div>
                          <div className="text-[11px] text-neutral-400 num mt-0.5">
                            <span>{m.method_name || 'Espèces'}</span>
                            <span className="mx-1.5">·</span>
                            <span>{formatDateTime(m.created_at)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {retraitsList.length > 0 && (
                <div className="border-b border-neutral-100">
                  <button onClick={() => setTicketsExpanded(ticketsExpanded === 'retraits' ? null : 'retraits')} className="w-full flex items-center justify-between py-3 text-left transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <ArrowUpRight className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                      <span className="text-[13px] font-semibold text-neutral-900">Retraits clients</span>
                      <span className="text-[11px] text-neutral-400">{retraitsList.length}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {can('pos_view_session_stats') && <span className="text-[13px] font-bold text-neutral-900 num">-{formatFCFA(retraitsTotal)}</span>}
                      <ChevronRight className={`w-3.5 h-3.5 text-neutral-300 transition-transform duration-200 ${ticketsExpanded === 'retraits' ? 'rotate-90' : ''}`} />
                    </div>
                  </button>
                  {ticketsExpanded === 'retraits' && (
                    <div className="pb-2">
                      {retraitsList.map((m, i) => (
                        <div key={i} className="py-2.5 pl-6 border-b border-neutral-100 last:border-b-0">
                          <div className="flex items-center justify-between">
                            <div className="text-[13px] font-semibold text-neutral-900 truncate">{m.customer_name || 'Client'}</div>
                            <span className="text-[13px] font-bold text-neutral-900 num shrink-0 ml-3">-{formatFCFA(m.amount)}</span>
                          </div>
                          <div className="text-[11px] text-neutral-400 num mt-0.5">
                            <span>{m.method_name || 'Espèces'}</span>
                            <span className="mx-1.5">·</span>
                            <span>{formatDateTime(m.created_at)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {pretsList.length > 0 && (
                <div className="border-b border-neutral-100">
                  <button onClick={() => setTicketsExpanded(ticketsExpanded === 'prets' ? null : 'prets')} className="w-full flex items-center justify-between py-3 text-left transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <HandCoins className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                      <span className="text-[13px] font-semibold text-neutral-900">Prêts clients</span>
                      <span className="text-[11px] text-neutral-400">{pretsList.length}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {can('pos_view_session_stats') && <span className="text-[13px] font-bold text-neutral-900 num">-{formatFCFA(pretsTotal)}</span>}
                      <ChevronRight className={`w-3.5 h-3.5 text-neutral-300 transition-transform duration-200 ${ticketsExpanded === 'prets' ? 'rotate-90' : ''}`} />
                    </div>
                  </button>
                  {ticketsExpanded === 'prets' && (
                    <div className="pb-2">
                      {pretsList.map((m, i) => (
                        <div key={i} className="py-2.5 pl-6 border-b border-neutral-100 last:border-b-0">
                          <div className="flex items-center justify-between">
                            <div className="text-[13px] font-semibold text-neutral-900 truncate">{m.customer_name || 'Client'}</div>
                            <span className="text-[13px] font-bold text-neutral-900 num shrink-0 ml-3">-{formatFCFA(m.amount)}</span>
                          </div>
                          <div className="text-[11px] text-neutral-400 num mt-0.5">
                            <span>Prêt</span>
                            <span className="mx-1.5">·</span>
                            <span>{formatDateTime(m.created_at)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          );
        })()}
      </CashModal>
    </>
  );
}
