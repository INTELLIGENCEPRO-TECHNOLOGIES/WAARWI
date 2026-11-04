import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, ChevronRight, Loader2, Lock, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../context/AppContext';
import { usePermissions } from '../../lib/permissions';
import { useToast } from '../../context/ToastContext';
import { formatFCFA } from '../../lib/format';
import { Modal } from '../Modal';
import { CashModal } from '../CashModal';
import { newIdempotencyKey } from '../../lib/cashSession';
import { buildCloseControlLines, type ControlLine } from '../../lib/cashClose';
import { isSaleSettlementIncome, type CashMovementKind } from '../../lib/cashMovements';
import { cashOpError, type CashOpContext, type CashSessionSnapshot } from './cashOpContext';
import { printXReport, type SessionStats, type SessionRegularization } from './xReport';

type CloseStep = 'control' | 'regularize' | 'confirm';

interface Props {
  ctx: CashOpContext;
  session: CashSessionSnapshot;
  multiEnabled: boolean;
  onClose: () => void;
  onClosed: () => void;
}

export function CashCloseModal({ ctx, session, multiEnabled, onClose, onClosed }: Props) {
  const { tenant, profile } = useApp();
  const { can, loading: permsLoading, error: permsError, reload: reloadPerms } = usePermissions();
  const { success, error } = useToast();
  const [bound] = useState(ctx);
  const openingAmount = session.opening_amount;
  const enabledModules: string[] = Array.isArray((tenant as any)?.enabled_modules)
    ? (tenant as any).enabled_modules
    : ['dashboard','pos','cash_history','articles','stock','tiers','sales','billing','supplier_orders','online_orders','accounting','settings','reports','ipm'];
  const hasModule = (m: string) => enabledModules.includes(m);
  const [regOpen, setRegOpen] = useState(false);
  const regKeyRef = useRef<string>(newIdempotencyKey());
  const [closeStep, setCloseStep] = useState<CloseStep>('control');
  const [controlLines, setControlLines] = useState<ControlLine[]>([]);
  const [loadingControl, setLoadingControl] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [closingNote, setClosingNote] = useState('');
  const [closing, setClosing] = useState(false);
  const [vaultAvailable, setVaultAvailable] = useState(false);
  const [depositMode, setDepositMode] = useState<'none' | 'full' | 'partial'>('none');
  const [depositPartial, setDepositPartial] = useState('');
  const closeIdemRef = useRef<string>('');
  const [regType, setRegType] = useState<'excedent' | 'manquant' | 'depot' | 'retrait'>('manquant');
  const [regAmount, setRegAmount] = useState(0);
  const [regReason, setRegReason] = useState('');
  const [regNote, setRegNote] = useState('');
  const [savingReg, setSavingReg] = useState(false);
  const [sessionRegs, setSessionRegs] = useState<SessionRegularization[]>([]);
  const [statsData, setStatsData] = useState<SessionStats | null>(null);
  const [started, setStarted] = useState(false);
  const closeAllowed = bound.mode === 'supervision' || can('pos_close_session');
  const permsBlocked = permsLoading || !!permsError || !closeAllowed;

  const loadControl = async () => {
    if (!tenant || permsBlocked) return;
    setCloseStep('control');
    setLoadingControl(true);
    setDepositMode('none');
    setDepositPartial('');
    closeIdemRef.current = newIdempotencyKey();
    setLoadError('');
    setStatsData(null);
    setControlLines([]);
    const loadFail = 'Impossible de charger les données de clôture de la session.';
    try {

    // Le coffre est-il disponible pour ce site (module activé + coffre initialisé) ?
    if (hasModule('vault') && can('vault_receive_from_cash')) {
      const { data: v, error: vErr } = await supabase.from('vaults').select('id')
        .eq('tenant_id', tenant.id).eq('site_id', bound.siteId).eq('is_active', true).maybeSingle();
      if (vErr) { setLoadError(cashOpError(vErr, loadFail)); return; }
      setVaultAvailable(!!v?.id);
    } else {
      setVaultAvailable(false);
    }

    const results = await Promise.all([
      supabase.from('sale_payments').select('payment_method_id, method_name, amount, created_at, reference, sales(sale_number, cash_session_id, customers(name))').eq('tenant_id', tenant.id).eq('cash_session_id', bound.sessionId).order('created_at'),
      supabase.from('cash_regularizations').select('id, reg_type, amount, reason, note').eq('tenant_id', tenant.id).eq('cash_session_id', bound.sessionId).order('created_at'),
      supabase.from('sales').select('id, total, sale_items(name, quantity, total)').eq('tenant_id', tenant.id).eq('cash_session_id', bound.sessionId).neq('status', 'cancelled'),
      supabase.from('cash_movements').select('kind, amount, payment_method_id, method_name, reason, customers(name)').eq('tenant_id', tenant.id).eq('cash_session_id', bound.sessionId).order('created_at'),
    ]);
    const failed = results.find(r => r.error);
    if (failed) { setLoadError(cashOpError(failed.error, loadFail)); return; }
    const [{ data: pmts }, { data: regs }, salesResult, { data: mvs }] = results;

    const pmtList = pmts || [];
    const lines = buildCloseControlLines(pmtList, (mvs || []) as any[], bound.methods, Number(openingAmount) || 0);

    // Build stats for X report
    const salesList = salesResult.data || [];
    const movList = (mvs || []).map((m: any) => ({
      kind: m.kind as CashMovementKind,
      amount: Number(m.amount), reason: m.reason || '',
      method_name: m.method_name || '', customer_name: m.customers?.name || null,
    })).filter(m => !isSaleSettlementIncome(m.kind, m.reason));
    const byMethod: Record<string, number> = {};
    pmtList.forEach((p: any) => { byMethod[p.method_name] = (byMethod[p.method_name] || 0) + Number(p.amount); });
    movList.forEach(m => {
      if (m.kind !== 'income' && m.kind !== 'customer_prepayment') return;
      const method = m.method_name || 'Espèces';
      byMethod[method] = (byMethod[method] || 0) + Number(m.amount);
    });
    const invoicePayments = pmtList
      .filter((p: any) => (p.reference && p.reference.startsWith('Règlement facture')) || !p.sales || p.sales.cash_session_id !== bound.sessionId)
      .map((p: any) => ({
        sale_number: p.sales?.sale_number || '',
        amount: Number(p.amount),
        method_name: p.method_name || '',
        customer_name: p.sales?.customers?.name || null,
        created_at: p.created_at || '',
        user_name: bound.operatorName || null,
      }));
    const articleMap: Record<string, { name: string; qty: number; total: number }> = {};
    salesList.forEach((s: any) => {
      (s.sale_items || []).forEach((item: any) => {
        if (!articleMap[item.name]) articleMap[item.name] = { name: item.name, qty: 0, total: 0 };
        articleMap[item.name].qty += Number(item.quantity);
        articleMap[item.name].total += Number(item.total);
      });
    });
    const movExpense = movList.filter(m => m.kind === 'expense').reduce((s, m) => s + m.amount, 0);
    const movRefund = movList.filter(m => m.kind === 'refund').reduce((s, m) => s + m.amount, 0);
    const movWithdrawal = movList.filter(m => m.kind === 'customer_withdrawal').reduce((s, m) => s + m.amount, 0);
    const movLoan = movList.filter(m => m.kind === 'customer_loan').reduce((s, m) => s + m.amount, 0);
    const movIncome = movList.filter(m => m.kind === 'income').reduce((s, m) => s + m.amount, 0);
    const movPrepay = movList.filter(m => m.kind === 'customer_prepayment').reduce((s, m) => s + m.amount, 0);
    const movVaultIn = movList.filter(m => m.kind === 'vault_withdrawal').reduce((s, m) => s + m.amount, 0);
    const movVaultOut = movList.filter(m => m.kind === 'vault_deposit').reduce((s, m) => s + m.amount, 0);
    const totalSales = salesList.reduce((s: number, r: any) => s + Number(r.total), 0);
    const totalPayments = pmtList.reduce((s: number, p: any) => s + Number(p.amount), 0);
    setStatsData({
      count: salesList.length,
      total: totalSales,
      totalPayments,
      byMethod: Object.entries(byMethod).map(([method_name, amount]) => ({ method_name, amount })),
      topArticles: Object.values(articleMap).sort((a, b) => b.total - a.total).slice(0, 10),
      movements: movList,
      invoicePayments,
      movExpense, movIncome, movPrepay, movWithdrawal, movLoan, movRefund,
      movVaultIn, movVaultOut,
      netTotal: totalPayments + movIncome + movPrepay + movVaultIn - movExpense - movRefund - movWithdrawal - movLoan - movVaultOut,
    });

    setControlLines(lines);
    setSessionRegs(regs || []);
    } catch (e) {
      setLoadError(cashOpError(e as { message?: string }, loadFail));
    } finally {
      setLoadingControl(false);
    }
  };

  // Starts once rights are confirmed; later rights refreshes must not reset the count or the idempotency key.
  useEffect(() => {
    if (started || permsBlocked) return;
    setStarted(true);
    loadControl();
  }, [started, permsBlocked]);

  const permsBlockedMsg = permsLoading
    ? 'Vérification de vos autorisations en cours.'
    : permsError
      ? 'Impossible de vérifier vos autorisations.'
      : 'Vous n\'avez pas la permission de clôturer la session.';

  const totalVariance = controlLines.reduce((s, c) => s + (c.counted_amount - c.theoretical_amount), 0);

  const vaultCloseEnabled = hasModule('vault') && vaultAvailable && can('vault_receive_from_cash');
  const countedCash = controlLines.reduce((s, c) => {
    const m = bound.methods.find(mm => mm.id === c.payment_method_id);
    const norm = c.method_name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const isCash = (m?.payment_type === 'cash') || norm.includes('espece') || norm.includes('liquide') || norm.includes('cash');
    return isCash ? s + c.counted_amount : s;
  }, 0);
  const depositAmount = depositMode === 'full'
    ? countedCash
    : depositMode === 'partial'
      ? Math.min(Math.max(Number(depositPartial) || 0, 0), countedCash)
      : 0;
  const retainedCash = Math.max(0, countedCash - depositAmount);

  const saveRegularization = async () => {
    if (!tenant || !profile) return;
    if (permsBlocked) { error(permsBlockedMsg); return; }
    if (regAmount <= 0) { error('Montant invalide'); return; }
    setSavingReg(true);
    const { data, error: e } = bound.mode === 'supervision'
      ? await supabase.rpc('cash_supervision_add_regularization', {
          p_session_id: bound.sessionId, p_reg_type: regType, p_amount: regAmount,
          p_reason: regReason, p_note: regNote, p_idempotency_key: regKeyRef.current,
        }).then(r => ({ data: r.data ? { id: (r.data as any).regularization_id } : null, error: r.error }))
      : await supabase.from('cash_regularizations').insert({
          tenant_id: tenant.id, cash_session_id: bound.sessionId,
          reg_type: regType, amount: regAmount, reason: regReason, note: regNote, user_id: profile.id,
        }).select('id').maybeSingle();
    setSavingReg(false);
    if (e) { error(e.message); return; }
    setSessionRegs(r => [...r, { id: (data as any)?.id, reg_type: regType, amount: regAmount, reason: regReason, note: regNote }]);
    regKeyRef.current = newIdempotencyKey();
    setRegOpen(false); setRegAmount(0); setRegReason(''); setRegNote('');
    success('Régularisation enregistrée');
  };

  const deleteRegularization = async (idx: number) => {
    const reg = sessionRegs[idx];
    if (!reg) return;
    if (reg.id) {
      const { error: e } = bound.mode === 'supervision'
        ? await supabase.rpc('cash_supervision_delete_regularization', { p_session_id: bound.sessionId, p_regularization_id: reg.id })
        : await supabase.from('cash_regularizations').delete().eq('id', reg.id);
      if (e) { error(e.message); return; }
    }
    setSessionRegs(r => r.filter((_, i) => i !== idx));
    success('Régularisation supprimée');
  };

  const confirmClose = async () => {
    if (!tenant) return;
    if (permsBlocked) { error(permsBlockedMsg); return; }
    setClosing(true);

    if (bound.mode === 'supervision' || multiEnabled) {
      const { error: e } = await supabase.rpc('cash_session_close', {
        p_session_id: bound.sessionId,
        p_control_lines: controlLines.map(c => ({
          payment_method_id: c.payment_method_id,
          method_name: c.method_name,
          theoretical_amount: c.theoretical_amount,
          counted_amount: c.counted_amount,
        })),
        p_closing_note: closingNote,
        p_vault_deposit_amount: vaultCloseEnabled ? depositAmount : 0,
        p_idempotency_key: closeIdemRef.current,
      });
      setClosing(false);
      if (e) { error(e.message); return; }
    } else if (vaultCloseEnabled) {
      // Clôture atomique via RPC : lignes de contrôle + versement éventuel au coffre.
      const { error: e } = await supabase.rpc('close_cash_session_v2', {
        p_session_id: bound.sessionId,
        p_control_lines: controlLines.map(c => ({
          payment_method_id: c.payment_method_id,
          method_name: c.method_name,
          theoretical_amount: c.theoretical_amount,
          counted_amount: c.counted_amount,
        })),
        p_closing_note: closingNote,
        p_vault_deposit_amount: depositAmount,
        p_idempotency_key: closeIdemRef.current,
      });
      setClosing(false);
      if (e) { error(e.message); return; }
    } else {
      // Comportement de clôture inchangé (module Coffre indisponible).
      const ctrlRows = controlLines.map(c => ({
        tenant_id: tenant.id, cash_session_id: bound.sessionId,
        payment_method_id: c.payment_method_id, method_name: c.method_name,
        theoretical_amount: c.theoretical_amount, counted_amount: c.counted_amount,
      }));
      await supabase.from('cash_control_lines').insert(ctrlRows);
      const countedTotal = controlLines.reduce((s, c) => s + c.counted_amount, 0);
      const theoreticalTotal = controlLines.reduce((s, c) => s + c.theoretical_amount, 0);
      const { error: e } = await supabase.from('cash_sessions').update({
        status: 'closed', closed_at: new Date().toISOString(),
        closing_amount: countedTotal, counted_cash: countedTotal,
        theoretical_amount: theoreticalTotal,
        variance: totalVariance, closing_note: closingNote, updated_at: new Date().toISOString(),
      }).eq('id', bound.sessionId);
      setClosing(false);
      if (e) { error(e.message); return; }
    }

    if (statsData) {
      printXReport(
        session, controlLines, statsData, sessionRegs,
        bound.printTenant, bound.operatorName || bound.userName, bound.siteName,
        { registerLabel: bound.registerLabel, printedBy: bound.mode === 'supervision' ? bound.userName : undefined }
      );
    }
    success('Caisse clôturée');
    onClosed();
  };

  return (
    <>
      <Modal open={regOpen} onClose={() => setRegOpen(false)} title="Régularisation d'écart" size="sm" layer="top"
        footer={<>
          <button onClick={() => setRegOpen(false)} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
          <button onClick={saveRegularization} disabled={savingReg || permsBlocked} className="btn-icon-primary" title="Enregistrer">
            {savingReg ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          </button>
        </>}
      >
        <div className="space-y-3">
          <div className="group">
            <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1">Type</div>
            <select value={regType} onChange={e => setRegType(e.target.value as any)} className="w-select-ul text-[13px]">
              <option value="manquant">Manquant (déficit)</option>
              <option value="excedent">Excédent (surplus)</option>
              <option value="depot">Dépôt</option>
              <option value="retrait">Retrait</option>
            </select>
          </div>
          <div className="group">
            <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1">Montant (FCFA)</div>
            <input type="number" value={regAmount || ''} onChange={e => setRegAmount(Number(e.target.value))} className="w-input-ul text-[13px]" min="0" />
          </div>
          <div className="group">
            <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1">Motif *</div>
            <input value={regReason} onChange={e => setRegReason(e.target.value)} className="w-input-ul text-[13px]" placeholder="Ex: Écart de monnaie, dépôt initial…" />
          </div>
          <div className="group">
            <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1">Note (optionnel)</div>
            <input value={regNote} onChange={e => setRegNote(e.target.value)} className="w-input-ul text-[13px]" />
          </div>
        </div>
      </Modal>

      <CashModal open={true} onClose={() => !closing && onClose()} title="Clôture de caisse"
        footer={
          closeStep === 'control' ? (
            <>
              <button onClick={() => onClose()} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
              <button onClick={() => setRegOpen(true)} disabled={!!loadError || loadingControl || permsBlocked} className="btn-icon" title="Régulariser"><Plus className="w-4 h-4" /></button>
              <button onClick={() => setCloseStep('regularize')} disabled={!!loadError || loadingControl || permsBlocked} className="btn-icon-primary" title="Suivant"><ChevronRight className="w-4 h-4" /></button>
            </>
          ) : closeStep === 'regularize' ? (
            <>
              <button onClick={() => setCloseStep('control')} className="btn-icon" title="Retour"><ArrowLeft className="w-4 h-4" /></button>
              <button onClick={() => setCloseStep('confirm')} disabled={!!loadError || permsBlocked} className="btn-icon-primary" title="Confirmer"><ChevronRight className="w-4 h-4" /></button>
            </>
          ) : (
            <>
              <button onClick={() => setCloseStep('regularize')} className="btn-icon" title="Retour"><ArrowLeft className="w-4 h-4" /></button>
              <button onClick={confirmClose} disabled={closing || !!loadError || !statsData || permsBlocked} className="btn-icon-primary" title="Clôturer">
                {closing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              </button>
            </>
          )
        }
      >
        {/* Minimal stepper — flat, bottom-border only */}
        <div className="flex items-center mb-4">
          {(['control', 'regularize', 'confirm'] as CloseStep[]).map((s, i) => {
            const labels = ['Contrôle', 'Régul.', 'Confirm.'];
            const active = closeStep === s;
            const done = (['control', 'regularize', 'confirm'] as CloseStep[]).indexOf(closeStep) > i;
            return (
              <div key={s} className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-2 flex-1 justify-center border-b-2 transition-colors ${active ? 'border-neutral-900 text-neutral-900' : done ? 'border-neutral-300 text-neutral-500' : 'border-neutral-100 text-neutral-400'}`}>
                {done ? <Check className="w-3 h-3" /> : <span className="text-[9px]">{i + 1}</span>}
                <span>{labels[i]}</span>
              </div>
            );
          })}
        </div>

        {started && permsBlocked && (
          <div className="mb-3 flex items-center justify-between gap-3 border-b border-red-200 pb-2">
            <p className="text-xs text-red-700">{permsBlockedMsg} Votre saisie est conservée, la clôture est bloquée.</p>
            {permsError && <button onClick={reloadPerms} className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-neutral-900 underline underline-offset-4"><RefreshCw className="w-3 h-3" />Réessayer</button>}
          </div>
        )}
        {!started ? (
          permsLoading ? (
            <div className="py-10 flex flex-col items-center gap-2 text-xs text-neutral-500"><Loader2 className="w-5 h-5 animate-spin text-brand-700" />Vérification des autorisations…</div>
          ) : (
            <div className="py-8 text-center">
              <p className="text-sm text-red-700">{permsBlockedMsg}</p>
              {permsError && <button onClick={reloadPerms} className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-neutral-900 underline underline-offset-4"><RefreshCw className="w-3.5 h-3.5" />Réessayer</button>}
            </div>
          )
        ) : loadingControl ? (
          <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-brand-700" /></div>
        ) : loadError ? (
          <div className="py-8 text-center">
            <p className="text-sm text-red-700">{loadError}</p>
            <p className="mt-1 text-xs text-neutral-500">La clôture reste bloquée tant que les montants théoriques ne sont pas chargés.</p>
            <button onClick={() => loadControl()} className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-neutral-900 underline underline-offset-4"><RefreshCw className="w-3.5 h-3.5" />Réessayer</button>
          </div>
        ) : closeStep === 'control' ? (
          <div className="space-y-0 count-up">
            <p className="text-[11px] text-neutral-500 uppercase tracking-wider font-semibold mb-2">Saisissez les montants comptés</p>
            <div>
              {controlLines.map((c, idx) => {
                const diff = c.counted_amount - c.theoretical_amount;
                const balanced = diff === 0 && c.counted_amount > 0;
                return (
                  <div key={c.method_name} className="border-b border-neutral-100 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-neutral-900 truncate">{c.method_name}</div>
                        <div className="text-[10px] text-neutral-500 num mt-0.5">Théorique: <span className="font-semibold text-neutral-700">{formatFCFA(c.theoretical_amount)}</span></div>
                      </div>
                      <input type="number" value={c.counted_amount || ''} onChange={e => setControlLines(lines => lines.map((l, i) => i === idx ? { ...l, counted_amount: Number(e.target.value) } : l))} className="w-24 px-2 py-1.5 text-xs text-right font-bold num bg-transparent focus:outline-none transition" min="0" placeholder="0" />
                      <div className={`text-[10px] font-bold num w-14 text-right ${balanced ? 'text-neutral-700' : diff < 0 ? 'text-red-600' : diff > 0 ? 'text-amber-600' : 'text-neutral-300'}`}>
                        {c.counted_amount === 0 ? '—' : diff === 0 ? 'OK' : `${diff > 0 ? '+' : ''}${formatFCFA(diff)}`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="py-2.5 border-t border-neutral-200 mt-1 flex items-center justify-between">
              <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Écart total</div>
              <div className={`num font-bold text-sm ${totalVariance > 0 ? 'text-amber-600' : totalVariance < 0 ? 'text-red-600' : 'text-neutral-800'}`}>
                {totalVariance === 0 ? <span className="flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Équilibré</span> : `${totalVariance > 0 ? '+' : ''}${formatFCFA(totalVariance)}`}
              </div>
            </div>
            {Math.abs(totalVariance) > 0 && (
              <div className={`flex items-start gap-2 py-2 text-[11px] ${totalVariance < 0 ? 'text-red-600' : 'text-amber-600'}`}>
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{totalVariance < 0 ? `Manquant de ${formatFCFA(-totalVariance)}` : `Excédent de ${formatFCFA(totalVariance)}`}</span>
              </div>
            )}
          </div>
        ) : closeStep === 'regularize' ? (
          <div className="space-y-3 count-up">
            <div className="divide-y divide-neutral-100 mb-3">
              <div className="flex items-center justify-between py-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-black">Écart</span>
                <span className={`text-sm font-bold num ${totalVariance === 0 ? 'text-neutral-800' : 'text-red-600'}`}>
                  {totalVariance === 0 ? 'OK' : `${totalVariance > 0 ? '+' : ''}${formatFCFA(totalVariance)}`}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-black">Régularisations</span>
                <span className="text-sm font-bold num">{sessionRegs.length}</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Total régularisations</span>
                <span className="text-sm font-bold num text-neutral-700">{formatFCFA(sessionRegs.reduce((s, r) => s + r.amount, 0))}</span>
              </div>
            </div>
            {sessionRegs.length > 0 ? (
              <div>
                {sessionRegs.map((r, i) => (
                  <div key={i} className="border-b border-neutral-100 py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold capitalize text-neutral-800">{r.reg_type}</div>
                      {r.reason && <div className="text-[10px] text-neutral-500 article-text line-clamp-1 mt-0.5">{r.reason}</div>}
                    </div>
                    <div className="num font-bold text-xs text-neutral-900 shrink-0">{formatFCFA(r.amount)}</div>
                    <button onClick={() => deleteRegularization(i)} className="shrink-0 p-1 rounded hover:bg-red-50 text-red-400 transition-colors" title="Supprimer">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4 text-[11px] text-neutral-500">Aucune régularisation.</div>
            )}
            <button onClick={() => setRegOpen(true)} className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold bg-white border border-dashed border-neutral-300 text-neutral-700 hover:border-brand-400 hover:bg-brand-50/40 transition">
              <Plus className="w-3.5 h-3.5" /> Ajouter une régularisation
            </button>
          </div>
        ) : (
          <div className="space-y-3 count-up">
            <div className="divide-y divide-neutral-100">
              <div className="flex items-center justify-between py-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-black">Fond ouverture</span>
                <span className="text-sm font-bold text-neutral-900 num">{formatFCFA(session?.opening_amount ?? 0)}</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-black">Total compté</span>
                <span className="text-sm font-bold text-neutral-900 num">{formatFCFA(controlLines.reduce((s, c) => s + c.counted_amount, 0))}</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-black">Écart final</span>
                <span className={`text-sm font-bold num ${totalVariance === 0 ? 'text-neutral-800' : totalVariance < 0 ? 'text-red-600' : 'text-amber-600'}`}>
                  {totalVariance === 0 ? 'Équilibré' : `${totalVariance > 0 ? '+' : ''}${formatFCFA(totalVariance)}`}
                </span>
              </div>
            </div>

            {vaultCloseEnabled && (
              <div className="border border-neutral-200 rounded-md p-3 space-y-2.5">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                  <Lock className="w-3 h-3" /> Versement au coffre
                </div>
                {([
                  { k: 'none', label: 'Ne rien verser' },
                  { k: 'full', label: 'Verser la totalité des espèces comptées' },
                  { k: 'partial', label: 'Verser un montant partiel' },
                ] as const).map(opt => (
                  <label key={opt.k} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="deposit-mode" checked={depositMode === opt.k}
                      onChange={() => setDepositMode(opt.k)} />
                    <span className="text-xs text-neutral-800">{opt.label}</span>
                  </label>
                ))}
                {depositMode === 'partial' && (
                  <input type="number" min={0} max={countedCash} value={depositPartial}
                    onChange={e => setDepositPartial(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm text-right font-bold num border border-neutral-200 rounded focus:outline-none focus:border-neutral-900"
                    placeholder="Montant à verser" />
                )}
                <div className="divide-y divide-neutral-100 pt-1">
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-[10px] text-neutral-500">Espèces comptées</span>
                    <span className="text-xs font-bold text-neutral-900 num">{formatFCFA(countedCash)}</span>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-[10px] text-neutral-500">Versé au coffre</span>
                    <span className="text-xs font-bold text-neutral-900 num">{formatFCFA(depositAmount)}</span>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-[10px] text-neutral-500">Conservé en caisse</span>
                    <span className="text-xs font-bold text-neutral-900 num">{formatFCFA(retainedCash)}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="group">
              <textarea value={closingNote} onChange={e => setClosingNote(e.target.value)} className="w-input-ul text-sm resize-none" rows={4} placeholder="Note de clôture (optionnel)" />
            </div>
            <div className="flex items-start gap-2 py-2 text-[11px] text-amber-600">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Action irréversible. La session sera verrouillée.</span>
            </div>
          </div>
        )}
      </CashModal>
    </>
  );
}
