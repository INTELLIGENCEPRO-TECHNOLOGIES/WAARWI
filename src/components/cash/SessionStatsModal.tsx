import { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, ChevronRight, CreditCard, HandCoins, Loader2, Lock, Package, Printer, RefreshCw, Wallet, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../context/AppContext';
import { formatFCFA, formatNumber } from '../../lib/format';
import { CashModal } from '../CashModal';
import { isSaleSettlementIncome, type CashMovementKind } from '../../lib/cashMovements';
import { cashOpError, type CashOpContext, type CashSessionSnapshot } from './cashOpContext';
import type { ControlLine } from '../../lib/cashClose';
import { printXReport, type SessionStats, type SessionRegularization } from './xReport';
interface Props {
  ctx: CashOpContext;
  session: CashSessionSnapshot;
  onClose: () => void;
}

export function SessionStatsModal({ ctx, session, onClose }: Props) {
  const { tenant } = useApp();
  const [bound] = useState(ctx);
  const [statsData, setStatsData] = useState<SessionStats | null>(null);
  const [sessionRegs, setSessionRegs] = useState<SessionRegularization[]>([]);
  const [loadingStats, setLoadingStats] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [controls, setControls] = useState<ControlLine[]>([]);
  const [statsExpanded, setStatsExpanded] = useState<'reglements' | 'modes' | 'articles' | 'controls' | 'encDirect' | 'acomptes' | 'depenses' | 'retraits' | 'prets' | 'vaultIn' | 'vaultOut' | null>(null);

const load = async () => {
    if (!tenant) return;
    setLoadingStats(true);
    setLoadError('');
    setStatsData(null);
    try {
    const closed = session.status !== 'open';
    const [salesRes, pmtRes, mvRes, regRes, ctlRes] = await Promise.all([
      supabase.from('sales').select('id, total, sale_items(name, quantity, total)').eq('tenant_id', tenant.id).eq('cash_session_id', bound.sessionId).neq('status', 'cancelled'),
      supabase.from('sale_payments').select('method_name, amount, created_at, reference, sale_id, sales(sale_number, cash_session_id, customers(name))').eq('tenant_id', tenant.id).eq('cash_session_id', bound.sessionId).order('created_at'),
      supabase.from('cash_movements').select('kind, amount, reason, method_name, customers(name)').eq('tenant_id', tenant.id).eq('cash_session_id', bound.sessionId).order('created_at'),
      supabase.from('cash_regularizations').select('id, reg_type, amount, reason, note').eq('tenant_id', tenant.id).eq('cash_session_id', bound.sessionId).order('created_at'),
      closed
        ? supabase.from('cash_control_lines').select('payment_method_id, method_name, theoretical_amount, counted_amount, difference_amount').eq('tenant_id', tenant.id).eq('cash_session_id', bound.sessionId).order('created_at')
        : Promise.resolve({ data: [], error: null }),
    ]);
    const failed = [salesRes, pmtRes, mvRes, regRes, ctlRes].find(r => r.error);
    if (failed) { setLoadError(cashOpError(failed.error, 'Impossible de charger les statistiques de la session.')); return; }
    const salesList = salesRes.data || [];
    const pmtList = pmtRes.data || [];
    const movs = (mvRes.data || []).map((m: any) => ({
      kind: m.kind as CashMovementKind,
      amount: Number(m.amount), reason: m.reason || '',
      method_name: m.method_name || '', customer_name: m.customers?.name || null,
    })).filter(m => !isSaleSettlementIncome(m.kind, m.reason));
    const byMethod: Record<string, number> = {};
    pmtList.forEach((p: any) => { byMethod[p.method_name] = (byMethod[p.method_name] || 0) + Number(p.amount); });
    movs.forEach(m => {
      if (m.kind !== 'income' && m.kind !== 'customer_prepayment' && m.kind !== 'expense' && m.kind !== 'refund') return;
      const method = m.method_name || 'Espèces';
      const signed = (m.kind === 'expense' || m.kind === 'refund') ? -Number(m.amount) : Number(m.amount);
      byMethod[method] = (byMethod[method] || 0) + signed;
    });
    const invoicePayments = pmtList
      .filter((p: any) => (p.reference && p.reference.startsWith('Règlement facture')) || !p.sales || p.sales.cash_session_id !== bound.sessionId)
      .map((p: any) => ({
        sale_number: p.sales?.sale_number || '',
        amount: Number(p.amount),
        method_name: p.method_name || '',
        customer_name: p.sales?.customers?.name || null,
        created_at: p.created_at || '',
        user_name: null,
      }));
    const articleMap: Record<string, { name: string; qty: number; total: number }> = {};
    salesList.forEach((s: any) => {
      (s.sale_items || []).forEach((item: any) => {
        if (!articleMap[item.name]) articleMap[item.name] = { name: item.name, qty: 0, total: 0 };
        articleMap[item.name].qty += Number(item.quantity);
        articleMap[item.name].total += Number(item.total);
      });
    });
    const topArticles = Object.values(articleMap).sort((a, b) => b.total - a.total).slice(0, 10);
    const movExpense = movs.filter(m => m.kind === 'expense').reduce((s, m) => s + m.amount, 0);
    const movRefund = movs.filter(m => m.kind === 'refund').reduce((s, m) => s + m.amount, 0);
    const movWithdrawal = movs.filter(m => m.kind === 'customer_withdrawal').reduce((s, m) => s + m.amount, 0);
    const movLoan = movs.filter(m => m.kind === 'customer_loan').reduce((s, m) => s + m.amount, 0);
    const movIncome = movs.filter(m => m.kind === 'income').reduce((s, m) => s + m.amount, 0);
    const movPrepay = movs.filter(m => m.kind === 'customer_prepayment').reduce((s, m) => s + m.amount, 0);
    const movVaultIn = movs.filter(m => m.kind === 'vault_withdrawal').reduce((s, m) => s + m.amount, 0);
    const movVaultOut = movs.filter(m => m.kind === 'vault_deposit').reduce((s, m) => s + m.amount, 0);
    const totalPayments = pmtList.reduce((s: number, p: any) => s + Number(p.amount), 0);
    setSessionRegs((regRes.data || []).map((r: any) => ({ ...r, amount: Number(r.amount) })));
    setControls((ctlRes.data || []).map((c: any) => ({
      payment_method_id: c.payment_method_id, method_name: c.method_name,
      theoretical_amount: Number(c.theoretical_amount), counted_amount: Number(c.counted_amount),
    })));
    setStatsData({
      count: salesList.length,
      total: totalPayments,
      totalPayments,
      byMethod: Object.entries(byMethod).map(([method_name, amount]) => ({ method_name, amount })),
      topArticles,
      movements: movs,
      invoicePayments,
      movExpense, movIncome, movPrepay, movWithdrawal, movLoan, movRefund,
      movVaultIn, movVaultOut,
      netTotal: totalPayments + movIncome + movPrepay + movVaultIn - movExpense - movRefund - movWithdrawal - movLoan - movVaultOut,
    });
    } catch (e) {
      setLoadError(cashOpError(e as { message?: string }, 'Impossible de charger les statistiques de la session.'));
    } finally {
      setLoadingStats(false);
    }
  };

  useEffect(() => { load(); }, [bound, tenant?.id]);

  return (
    <>
      <CashModal open={true} onClose={() => onClose()} title="Statistiques de la session"
        footer={<>
          <button onClick={() => onClose()} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>
          {statsData && !loadError && !loadingStats && (
            <button onClick={() => printXReport(
              session, controls, statsData, sessionRegs,
              bound.printTenant,
              bound.operatorName, bound.siteName,
              { registerLabel: bound.registerLabel, printedBy: bound.mode === 'supervision' ? bound.userName : undefined }
            )} className="btn-icon-primary" title="Imprimer rapport">
              <Printer className="w-4 h-4" />
            </button>
          )}
        </>}
      >
        {loadingStats ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
        ) : loadError ? (
          <div className="py-8 text-center">
            <p className="text-sm text-red-700">{loadError}</p>
            <p className="mt-1 text-xs text-neutral-500">Aucun total n'est affiché tant que les données ne sont pas chargées.</p>
            <button onClick={() => load()} className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-neutral-900 underline underline-offset-4"><RefreshCw className="w-3.5 h-3.5" />Réessayer</button>
          </div>
        ) : statsData ? (
          <div>
            {/* KPI strip: ventes + net */}
            <div className="flex items-end gap-4 border-b border-neutral-200 pb-3 mb-1">
              <div className="shrink-0 text-center pr-3 border-r border-neutral-200">
                <div className="text-[8px] font-bold uppercase tracking-widest text-neutral-500 mb-0.5">Ventes</div>
                <div className="text-sm font-black text-neutral-900 num">{statsData.count}</div>
              </div>
              <div className="flex-1 text-left">
                <div className="text-[9px] font-bold uppercase tracking-widest text-neutral-500 mb-0.5">Net</div>
                <div className="text-xl font-black text-neutral-900 num leading-none">
                  {formatNumber(statsData.netTotal)} <span className="text-[11px] font-bold text-neutral-500">FCFA</span>
                </div>
              </div>
            </div>

            {/* Collapsible sections */}
            <div className="divide-y divide-neutral-100">
              {/* Encaissements par mode */}
              {statsData.byMethod.length > 0 && (
                <div>
                  <button onClick={() => setStatsExpanded(statsExpanded === 'modes' ? null : 'modes')} className="w-full flex items-center justify-between py-3 text-left active:bg-neutral-50 transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <CreditCard className="w-4 h-4 text-neutral-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-neutral-900">Encaissements par mode</div>
                        <div className="text-[10px] text-neutral-500">{statsData.byMethod.length} mode{statsData.byMethod.length > 1 ? 's' : ''}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[13px] font-bold text-neutral-900 num">{formatFCFA(statsData.byMethod.reduce((s, m) => s + m.amount, 0))}</span>
                      <ChevronRight className={`w-4 h-4 text-neutral-400 transition-transform duration-200 ${statsExpanded === 'modes' ? 'rotate-90' : ''}`} />
                    </div>
                  </button>
                  {statsExpanded === 'modes' && (() => {
                    const totalMethods = statsData.byMethod.reduce((s, m) => s + m.amount, 0);
                    return (
                      <div className="pb-3 animate-in fade-in slide-in-from-top-1 duration-200">
                        <div className="border border-neutral-100 rounded-md overflow-hidden">
                          <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-3 py-1.5 bg-neutral-50 border-b border-neutral-100">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-neutral-500">Mode de paiement</span>
                            <span className="text-[9px] font-bold uppercase tracking-wider text-neutral-500 text-right">Montant</span>
                            <span className="text-[9px] font-bold uppercase tracking-wider text-neutral-500 text-right w-12">%</span>
                          </div>
                          {statsData.byMethod.map(m => {
                            const pct = totalMethods > 0 ? (m.amount / totalMethods * 100) : 0;
                            return (
                              <div key={m.method_name} className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-3 py-2 border-b border-[var(--w-separator-l)] last:border-b-0">
                                <span className="text-xs text-neutral-800 truncate">{m.method_name}</span>
                                <span className="text-xs font-semibold text-neutral-900 num text-right">{formatFCFA(m.amount)}</span>
                                <span className="text-xs text-neutral-500 num text-right w-12">{pct.toFixed(0)}%</span>
                              </div>
                            );
                          })}
                          <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-3 py-2 bg-neutral-50 border-t border-neutral-200">
                            <span className="text-xs font-bold text-neutral-900">Total</span>
                            <span className="text-xs font-bold text-neutral-900 num text-right">{formatFCFA(totalMethods)}</span>
                            <span className="text-xs font-bold text-neutral-900 num text-right w-12">100%</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Reglements */}
              {statsData.invoicePayments.length > 0 && (
                <div>
                  <button onClick={() => setStatsExpanded(statsExpanded === 'reglements' ? null : 'reglements')} className="w-full flex items-center justify-between py-3 text-left active:bg-neutral-50 transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Wallet className="w-4 h-4 text-neutral-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-neutral-900">Règlements factures</div>
                        <div className="text-[10px] text-neutral-500">{statsData.invoicePayments.length} règlement{statsData.invoicePayments.length > 1 ? 's' : ''}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[13px] font-bold text-emerald-700 num">+{formatFCFA(statsData.invoicePayments.reduce((s, p) => s + p.amount, 0))}</span>
                      <ChevronRight className={`w-4 h-4 text-neutral-400 transition-transform duration-200 ${statsExpanded === 'reglements' ? 'rotate-90' : ''}`} />
                    </div>
                  </button>
                  {statsExpanded === 'reglements' && (
                    <div className="pb-3 divide-y divide-[var(--w-separator-l)] animate-in fade-in slide-in-from-top-1 duration-200">
                      {statsData.invoicePayments.map((p, i) => (
                        <div key={i} className="flex items-center justify-between py-2 pl-7 gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-neutral-800 truncate">
                              <span className="doc-number">{p.sale_number}</span>
                              {p.customer_name && <span className="text-neutral-500 ml-1">- {p.customer_name}</span>}
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px] text-neutral-400 num">
                              <span>{p.method_name}</span>
                              {p.user_name && <span>{p.user_name}</span>}
                            </div>
                          </div>
                          <span className="text-xs font-semibold text-emerald-700 num shrink-0">+{formatFCFA(p.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Encaissements directs */}
              {statsData.movIncome > 0 && (
                <div>
                  <button onClick={() => setStatsExpanded(statsExpanded === 'encDirect' ? null : 'encDirect')} className="w-full flex items-center justify-between py-3 text-left active:bg-neutral-50 transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <ArrowDownRight className="w-4 h-4 text-neutral-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-neutral-900">Encaissements directs</div>
                        <div className="text-[10px] text-neutral-500">{statsData.movements.filter(m => m.kind === 'income').length} encaissement{statsData.movements.filter(m => m.kind === 'income').length > 1 ? 's' : ''}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[13px] font-bold text-emerald-700 num">+{formatFCFA(statsData.movIncome)}</span>
                      <ChevronRight className={`w-4 h-4 text-neutral-400 transition-transform duration-200 ${statsExpanded === 'encDirect' ? 'rotate-90' : ''}`} />
                    </div>
                  </button>
                  {statsExpanded === 'encDirect' && (
                    <div className="pb-3 divide-y divide-[var(--w-separator-l)] animate-in fade-in slide-in-from-top-1 duration-200">
                      {statsData.movements.filter(m => m.kind === 'income').map((m, i) => (
                        <div key={i} className="flex items-center justify-between py-2 pl-7 gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-neutral-800 truncate">{m.reason || 'Encaissement direct'}</div>
                            <div className="flex items-center gap-1.5 text-[10px] text-neutral-400 num">
                              {m.method_name && <span>{m.method_name}</span>}
                              {m.customer_name && <span>{m.customer_name}</span>}
                            </div>
                          </div>
                          <span className="text-xs font-semibold text-emerald-700 num shrink-0">+{formatFCFA(m.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Acomptes */}
              {statsData.movPrepay > 0 && (
                <div>
                  <button onClick={() => setStatsExpanded(statsExpanded === 'acomptes' ? null : 'acomptes')} className="w-full flex items-center justify-between py-3 text-left active:bg-neutral-50 transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Wallet className="w-4 h-4 text-neutral-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-neutral-900">Acomptes clients</div>
                        <div className="text-[10px] text-neutral-500">{statsData.movements.filter(m => m.kind === 'customer_prepayment').length} acompte{statsData.movements.filter(m => m.kind === 'customer_prepayment').length > 1 ? 's' : ''}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[13px] font-bold text-emerald-700 num">+{formatFCFA(statsData.movPrepay)}</span>
                      <ChevronRight className={`w-4 h-4 text-neutral-400 transition-transform duration-200 ${statsExpanded === 'acomptes' ? 'rotate-90' : ''}`} />
                    </div>
                  </button>
                  {statsExpanded === 'acomptes' && (
                    <div className="pb-3 divide-y divide-[var(--w-separator-l)] animate-in fade-in slide-in-from-top-1 duration-200">
                      {statsData.movements.filter(m => m.kind === 'customer_prepayment').map((m, i) => (
                        <div key={i} className="flex items-center justify-between py-2 pl-7 gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-neutral-800 truncate">{m.customer_name || 'Client'}</div>
                            <div className="flex items-center gap-1.5 text-[10px] text-neutral-400 num">
                              {m.method_name && <span>{m.method_name}</span>}
                              {m.reason && <span className="truncate">{m.reason}</span>}
                            </div>
                          </div>
                          <span className="text-xs font-semibold text-emerald-700 num shrink-0">+{formatFCFA(m.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Décaissements */}
              {(statsData.movExpense + statsData.movRefund) > 0 && (
                <div>
                  <button onClick={() => setStatsExpanded(statsExpanded === 'depenses' ? null : 'depenses')} className="w-full flex items-center justify-between py-3 text-left active:bg-neutral-50 transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <ArrowUpRight className="w-4 h-4 text-neutral-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-neutral-900">Décaissements</div>
                        <div className="text-[10px] text-neutral-500">{statsData.movements.filter(m => m.kind === 'expense' || m.kind === 'refund').length} mouvement{statsData.movements.filter(m => m.kind === 'expense' || m.kind === 'refund').length > 1 ? 's' : ''}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[13px] font-bold text-red-600 num">-{formatFCFA(statsData.movExpense + statsData.movRefund)}</span>
                      <ChevronRight className={`w-4 h-4 text-neutral-400 transition-transform duration-200 ${statsExpanded === 'depenses' ? 'rotate-90' : ''}`} />
                    </div>
                  </button>
                  {statsExpanded === 'depenses' && (
                    <div className="pb-3 divide-y divide-[var(--w-separator-l)] animate-in fade-in slide-in-from-top-1 duration-200">
                      {statsData.movements.filter(m => m.kind === 'refund').map((m, i) => (
                        <div key={`ref-${i}`} className="flex items-center justify-between py-2 pl-7 gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-neutral-800 truncate">{m.reason || 'Remboursement'}</div>
                            <div className="text-[10px] text-neutral-400">Remboursement</div>
                          </div>
                          <span className="text-xs font-semibold text-red-600 num shrink-0">-{formatFCFA(m.amount)}</span>
                        </div>
                      ))}
                      {statsData.movements.filter(m => m.kind === 'expense').map((m, i) => (
                        <div key={i} className="flex items-center justify-between py-2 pl-7 gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-neutral-800 truncate">{m.reason || 'Dépense'}</div>
                            {m.method_name && <div className="text-[10px] text-neutral-400">{m.method_name}</div>}
                          </div>
                          <span className="text-xs font-semibold text-red-600 num shrink-0">-{formatFCFA(m.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Retraits clients */}
              {(statsData.movWithdrawal || 0) > 0 && (
                <div>
                  <button onClick={() => setStatsExpanded(statsExpanded === 'retraits' ? null : 'retraits')} className="w-full flex items-center justify-between py-3 text-left active:bg-neutral-50 transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <ArrowUpRight className="w-4 h-4 text-neutral-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-neutral-900">Retraits clients</div>
                        <div className="text-[10px] text-neutral-500">{statsData.movements.filter(m => m.kind === 'customer_withdrawal').length} retrait{statsData.movements.filter(m => m.kind === 'customer_withdrawal').length > 1 ? 's' : ''}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[13px] font-bold text-red-600 num">-{formatFCFA(statsData.movWithdrawal || 0)}</span>
                      <ChevronRight className={`w-4 h-4 text-neutral-400 transition-transform duration-200 ${statsExpanded === 'retraits' ? 'rotate-90' : ''}`} />
                    </div>
                  </button>
                  {statsExpanded === 'retraits' && (
                    <div className="pb-3 divide-y divide-[var(--w-separator-l)] animate-in fade-in slide-in-from-top-1 duration-200">
                      {statsData.movements.filter(m => m.kind === 'customer_withdrawal').map((m, i) => (
                        <div key={i} className="flex items-center justify-between py-2 pl-7 gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-neutral-800 truncate">{m.customer_name || 'Client'}</div>
                            {m.method_name && <div className="text-[10px] text-neutral-400">{m.method_name}</div>}
                          </div>
                          <span className="text-xs font-semibold text-red-600 num shrink-0">-{formatFCFA(m.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Prêts clients */}
              {(statsData.movLoan || 0) > 0 && (
                <div>
                  <button onClick={() => setStatsExpanded(statsExpanded === 'prets' ? null : 'prets')} className="w-full flex items-center justify-between py-3 text-left active:bg-neutral-50 transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <HandCoins className="w-4 h-4 text-neutral-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-neutral-900">Prêts clients</div>
                        <div className="text-[10px] text-neutral-500">{statsData.movements.filter(m => m.kind === 'customer_loan').length} prêt{statsData.movements.filter(m => m.kind === 'customer_loan').length > 1 ? 's' : ''}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[13px] font-bold text-red-600 num">-{formatFCFA(statsData.movLoan || 0)}</span>
                      <ChevronRight className={`w-4 h-4 text-neutral-400 transition-transform duration-200 ${statsExpanded === 'prets' ? 'rotate-90' : ''}`} />
                    </div>
                  </button>
                  {statsExpanded === 'prets' && (
                    <div className="pb-3 divide-y divide-[var(--w-separator-l)] animate-in fade-in slide-in-from-top-1 duration-200">
                      {statsData.movements.filter(m => m.kind === 'customer_loan').map((m, i) => (
                        <div key={i} className="flex items-center justify-between py-2 pl-7 gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-neutral-800 truncate">{m.customer_name || 'Client'}</div>
                            {m.reason && <div className="text-[10px] text-neutral-400 truncate">{m.reason}</div>}
                          </div>
                          <span className="text-xs font-semibold text-red-600 num shrink-0">-{formatFCFA(m.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Transfert reçu du coffre */}
              {(statsData.movVaultIn || 0) > 0 && (
                <div>
                  <button onClick={() => setStatsExpanded(statsExpanded === 'vaultIn' ? null : 'vaultIn')} className="w-full flex items-center justify-between py-3 text-left active:bg-neutral-50 transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <ArrowDownRight className="w-4 h-4 text-neutral-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-neutral-900">Transfert reçu du coffre</div>
                        <div className="text-[10px] text-neutral-500">{statsData.movements.filter(m => m.kind === 'vault_withdrawal').length} transfert{statsData.movements.filter(m => m.kind === 'vault_withdrawal').length > 1 ? 's' : ''}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[13px] font-bold text-emerald-700 num">+{formatFCFA(statsData.movVaultIn || 0)}</span>
                      <ChevronRight className={`w-4 h-4 text-neutral-400 transition-transform duration-200 ${statsExpanded === 'vaultIn' ? 'rotate-90' : ''}`} />
                    </div>
                  </button>
                  {statsExpanded === 'vaultIn' && (
                    <div className="pb-3 divide-y divide-[var(--w-separator-l)] animate-in fade-in slide-in-from-top-1 duration-200">
                      {statsData.movements.filter(m => m.kind === 'vault_withdrawal').map((m, i) => (
                        <div key={i} className="flex items-center justify-between py-2 pl-7 gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-neutral-800 truncate">{m.reason || 'Transfert reçu du coffre'}</div>
                            {m.method_name && <div className="text-[10px] text-neutral-400">{m.method_name}</div>}
                          </div>
                          <span className="text-xs font-semibold text-emerald-700 num shrink-0">+{formatFCFA(m.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Versement au coffre */}
              {(statsData.movVaultOut || 0) > 0 && (
                <div>
                  <button onClick={() => setStatsExpanded(statsExpanded === 'vaultOut' ? null : 'vaultOut')} className="w-full flex items-center justify-between py-3 text-left active:bg-neutral-50 transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <ArrowUpRight className="w-4 h-4 text-neutral-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-neutral-900">Versement au coffre</div>
                        <div className="text-[10px] text-neutral-500">{statsData.movements.filter(m => m.kind === 'vault_deposit').length} versement{statsData.movements.filter(m => m.kind === 'vault_deposit').length > 1 ? 's' : ''}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[13px] font-bold text-red-600 num">-{formatFCFA(statsData.movVaultOut || 0)}</span>
                      <ChevronRight className={`w-4 h-4 text-neutral-400 transition-transform duration-200 ${statsExpanded === 'vaultOut' ? 'rotate-90' : ''}`} />
                    </div>
                  </button>
                  {statsExpanded === 'vaultOut' && (
                    <div className="pb-3 divide-y divide-[var(--w-separator-l)] animate-in fade-in slide-in-from-top-1 duration-200">
                      {statsData.movements.filter(m => m.kind === 'vault_deposit').map((m, i) => (
                        <div key={i} className="flex items-center justify-between py-2 pl-7 gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-neutral-800 truncate">{m.reason || 'Versement au coffre'}</div>
                            {m.method_name && <div className="text-[10px] text-neutral-400">{m.method_name}</div>}
                          </div>
                          <span className="text-xs font-semibold text-red-600 num shrink-0">-{formatFCFA(m.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {session.status !== 'open' && (
                <div>
                  <button onClick={() => setStatsExpanded(statsExpanded === 'controls' ? null : 'controls')} className="w-full flex items-center justify-between py-3 text-left active:bg-neutral-50 transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Lock className="w-4 h-4 text-neutral-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-neutral-900">Contrôle de clôture</div>
                        <div className="text-[10px] text-neutral-500">{controls.length > 0 ? `${controls.length} mode${controls.length > 1 ? 's' : ''} compté${controls.length > 1 ? 's' : ''}` : 'Aucun comptage enregistré'}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[13px] font-bold text-neutral-900 num">Écart {session.variance == null ? '—' : `${Number(session.variance) >= 0 ? '+' : ''}${formatFCFA(Number(session.variance))}`}</span>
                      <ChevronRight className={`w-4 h-4 text-neutral-400 transition-transform duration-200 ${statsExpanded === 'controls' ? 'rotate-90' : ''}`} />
                    </div>
                  </button>
                  {statsExpanded === 'controls' && (
                    <div className="pb-3 divide-y divide-[var(--w-separator-l)] animate-in fade-in slide-in-from-top-1 duration-200">
                      {controls.map((c, i) => (
                        <div key={`${c.method_name}-${i}`} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 py-2 pl-7 text-xs">
                          <span className="text-neutral-800 truncate">{c.method_name}</span>
                          <span className="text-neutral-500 num text-right">Théo. {formatFCFA(c.theoretical_amount)}</span>
                          <span className="text-neutral-900 num text-right">Compté {formatFCFA(c.counted_amount)}</span>
                          <span className="font-semibold text-neutral-900 num text-right">{c.counted_amount - c.theoretical_amount >= 0 ? '+' : ''}{formatFCFA(c.counted_amount - c.theoretical_amount)}</span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between py-2 pl-7 text-xs">
                        <span className="text-neutral-500">Montant compté enregistré</span>
                        <span className="font-semibold text-neutral-900 num">{session.closing_amount == null ? '—' : formatFCFA(Number(session.closing_amount))}</span>
                      </div>
                      <div className="flex items-center justify-between py-2 pl-7 text-xs">
                        <span className="text-neutral-500">Solde théorique enregistré</span>
                        <span className="font-semibold text-neutral-900 num">{session.theoretical_amount == null ? '—' : formatFCFA(Number(session.theoretical_amount))}</span>
                      </div>
                      {session.closing_note && <div className="py-2 pl-7 text-xs text-neutral-600">Note : {session.closing_note}</div>}
                    </div>
                  )}
                </div>
              )}

              {/* Top articles */}
              {statsData.topArticles.length > 0 && (
                <div>
                  <button onClick={() => setStatsExpanded(statsExpanded === 'articles' ? null : 'articles')} className="w-full flex items-center justify-between py-3 text-left active:bg-neutral-50 transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Package className="w-4 h-4 text-neutral-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-neutral-900">Top articles</div>
                        <div className="text-[10px] text-neutral-500">{statsData.topArticles.length} article{statsData.topArticles.length > 1 ? 's' : ''}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[13px] font-bold text-amber-700 num">{formatFCFA(statsData.topArticles.reduce((s, a) => s + a.total, 0))}</span>
                      <ChevronRight className={`w-4 h-4 text-neutral-400 transition-transform duration-200 ${statsExpanded === 'articles' ? 'rotate-90' : ''}`} />
                    </div>
                  </button>
                  {statsExpanded === 'articles' && (
                    <div className="pb-3 divide-y divide-[var(--w-separator-l)] animate-in fade-in slide-in-from-top-1 duration-200">
                      {statsData.topArticles.map((a, i) => (
                        <div key={a.name} className="py-2 pl-1">
                          <div className="text-[11px] font-medium text-neutral-800 leading-snug">{a.name}</div>
                          <div className="flex items-center justify-between mt-0.5">
                            <span className="text-[10px] text-neutral-400 num">Qté: {a.qty}</span>
                            <span className="text-[11px] font-semibold text-amber-700 num">{formatFCFA(a.total)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </CashModal>
    </>
  );
}
