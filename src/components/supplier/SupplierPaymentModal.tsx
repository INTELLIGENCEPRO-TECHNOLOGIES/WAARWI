import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, X, AlertCircle, RotateCcw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getOperationalCashContext, missingSessionMessage, newIdempotencyKey } from '../../lib/cashSession';
import { useApp } from '../../context/AppContext';
import { usePermissions } from '../../lib/permissions';
import { useToast } from '../../context/ToastContext';
import { Modal } from '../Modal';
import { SearchableSelect } from '../SearchableSelect';
import { RecentPaymentsAccordion } from '../RecentPaymentsAccordion';
import { formatFCFA } from '../../lib/format';
import { isOrderPayable, orderBlockReason, orderRemaining } from '../../lib/supplierPayment';

export type SupplierPaymentResult = { orderId: string | null; amount: number; funding: 'cash' | 'vault' };

type Props = {
  supplier: { id: string; name: string; balance?: number | null };
  initialOrderId?: string | null;
  siteId: string | null;
  onSuccess?: (result: SupplierPaymentResult) => void;
  onStale?: () => void;
  onClose: () => void;
};

type OrderRow = { id: string; order_number: string; total: number; paid: number; status: string; created_at: string; site_id: string | null };
type Method = { id: string; name: string; payment_type: string };
type Payment = { id: string; amount: number; method_name: string; reference: string | null; order_id: string | null; created_at: string; paid_at: string | null };
type Attempt = { sig: string; key: string; uncertain: boolean; sessionId: string | null; snapshot: Set<string> | null };

const ORDER_COLS = 'id, order_number, total, paid, status, created_at, site_id';
const BALANCE_ID = '__balance__';

const isNetworkError = (e: { code?: string } | null | undefined) => !!e && !e.code;

export function SupplierPaymentModal({ supplier, initialOrderId, siteId, onSuccess, onStale, onClose }: Props) {
  const { tenant, currentSite } = useApp();
  const { can } = usePermissions();
  const { success, error, toast } = useToast();
  const vaultEnabled = (tenant?.enabled_modules || []).includes('vault') && can('vault_pay_supplier');

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [target, setTarget] = useState<{ order: OrderRow | null; reason: string | null } | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [methods, setMethods] = useState<Method[]>([]);
  const [balance, setBalance] = useState<number>(Number(supplier.balance || 0));

  const [payOrder, setPayOrder] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('');
  const [payRef, setPayRef] = useState('');
  const [payFunding, setPayFunding] = useState<'cash' | 'vault'>('cash');
  const [paying, setPaying] = useState(false);

  const initializedRef = useRef(false);
  const inFlightRef = useRef(false);
  const attemptRef = useRef<Attempt | null>(null);
  const openedCtxRef = useRef({ tenantId: tenant?.id, siteId: currentSite?.id });
  const onStaleRef = useRef(onStale);
  onStaleRef.current = onStale;
  const tenantId = tenant?.id;

  useEffect(() => {
    const ctx = openedCtxRef.current;
    if (tenant?.id !== ctx.tenantId || currentSite?.id !== ctx.siteId) onClose();
  }, [tenant?.id, currentSite?.id, onClose]);

  const reload = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setLoadError(null);
    const [oRes, pRes, mRes, bRes, tRes] = await Promise.all([
      supabase.from('supplier_orders').select(ORDER_COLS).eq('tenant_id', tenantId).eq('supplier_id', supplier.id).order('created_at', { ascending: false }).limit(400),
      supabase.from('supplier_payments').select('id, amount, method_name, reference, order_id, created_at, paid_at').eq('tenant_id', tenantId).eq('supplier_id', supplier.id).order('paid_at', { ascending: false }).limit(20),
      supabase.from('payment_methods').select('id, name, payment_type').eq('tenant_id', tenantId).eq('is_active', true).neq('payment_type', 'credit').order('sort_order'),
      supabase.from('suppliers').select('balance').eq('id', supplier.id).eq('tenant_id', tenantId).maybeSingle(),
      initialOrderId
        ? supabase.from('supplier_orders').select(ORDER_COLS).eq('id', initialOrderId).eq('tenant_id', tenantId).eq('supplier_id', supplier.id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    const failed = [oRes, pRes, mRes, bRes, tRes].find(r => r.error);
    if (failed?.error) {
      setLoadError(isNetworkError(failed.error) ? 'Connexion impossible — vérifiez le réseau puis réessayez.' : 'Impossible de charger les données du fournisseur.');
      setLoading(false);
      return;
    }

    const list = ((oRes.data || []) as OrderRow[]).map(o => ({ ...o, total: Number(o.total), paid: Number(o.paid || 0) }));
    let nextTarget: { order: OrderRow | null; reason: string | null } | null = null;
    if (initialOrderId) {
      const raw = tRes.data as OrderRow | null;
      const t = raw ? { ...raw, total: Number(raw.total), paid: Number(raw.paid || 0) } : null;
      if (!t) nextTarget = { order: null, reason: 'Commande introuvable ou inaccessible.' };
      else if (siteId && t.site_id && t.site_id !== siteId) nextTarget = { order: null, reason: 'Cette commande appartient à un autre magasin.' };
      else {
        nextTarget = { order: t, reason: orderBlockReason(t) };
        const idx = list.findIndex(o => o.id === t.id);
        if (idx >= 0) list[idx] = t; else list.push(t);
      }
    }

    const ms = (mRes.data || []) as Method[];
    setOrders(list);
    setTarget(nextTarget);
    setPayments((pRes.data || []) as Payment[]);
    setMethods(ms);
    if (bRes.data) setBalance(Number(bRes.data.balance || 0));
    setPayMethod(prev => (prev && ms.some(m => m.id === prev)) ? prev : (ms[0]?.id || ''));

    if (!initializedRef.current) {
      initializedRef.current = true;
      if (nextTarget?.order) {
        setPayOrder(nextTarget.order.id);
        setPayAmount(nextTarget.reason ? '' : String(orderRemaining(nextTarget.order)));
      }
      if (nextTarget?.reason) onStaleRef.current?.();
    }
    setLoading(false);
  }, [tenantId, supplier.id, initialOrderId, siteId]);

  useEffect(() => { reload(); }, [reload]);

  const choices = useMemo(() => {
    const open = orders.filter(o => o.status !== 'cancelled' && o.paid < o.total);
    const invoiceDue = open.reduce((a, o) => a + orderRemaining(o), 0);
    const positionedDue = Math.max(0, balance - invoiceDue);
    const payable = orders.filter(isOrderPayable);
    return { payable, positionedDue };
  }, [orders, balance]);

  const blocked = target?.order && target.reason && payOrder === target.order.id ? target : null;
  const blockedMissing = !!(target && !target.order);

  const submitPayment = async () => {
    if (inFlightRef.current) return;
    if (blocked) { error(blocked.reason!); return; }
    if (blockedMissing) { error(target!.reason!); return; }
    const amt = Math.round((Number(payAmount) || 0) * 100) / 100;
    if (!amt || amt <= 0) { error('Montant invalide'); return; }
    const pm = methods.find(m => m.id === payMethod);
    if (!pm) { error('Mode de règlement requis'); return; }
    if (!tenant || !siteId) { error('Aucun magasin actif'); return; }
    const funding: 'cash' | 'vault' = vaultEnabled && payFunding === 'vault' ? 'vault' : 'cash';
    const isBalance = payOrder === BALANCE_ID;
    const orderId = isBalance || !payOrder ? null : payOrder;
    const reference = payRef || (isBalance ? `Règlement solde · ${supplier.name}` : '');

    const sig = JSON.stringify([funding, orderId, amt, pm.id, reference, siteId]);
    if (!attemptRef.current || attemptRef.current.sig !== sig) {
      attemptRef.current = { sig, key: newIdempotencyKey(), uncertain: false, sessionId: null, snapshot: null };
      const now = Date.now();
      const dup = payments.find(p => Number(p.amount) === amt && Math.abs(now - new Date(p.created_at || p.paid_at || 0).getTime()) < 60000);
      if (dup) toast(`Règlement de ${formatFCFA(amt)} effectué il y a moins d'une minute — vérifiez qu'il ne s'agit pas d'un doublon.`, 'info');
    }
    const attempt = attemptRef.current;

    inFlightRef.current = true;
    setPaying(true);
    try {
      let res: { data: unknown; error: { message: string; code?: string } | null };
      if (funding === 'vault') {
        res = await supabase.rpc('register_supplier_payment_from_vault', {
          p_supplier_id: supplier.id, p_payment_method_id: pm.id, p_method_name: pm.name,
          p_amount: amt, p_reference: reference, p_site_id: siteId, p_order_id: orderId,
          p_idempotency_key: attempt.key,
        });
      } else {
        const cashCtx = await getOperationalCashContext(siteId);
        const sess = cashCtx.session;
        if (!sess) { error(missingSessionMessage(cashCtx, "La caisse doit être ouverte d'abord")); return; }

        // Le circuit caisse n'a pas de clé d'idempotence : après une réponse perdue, on vérifie
        // si un règlement est apparu sur la session avant de renvoyer.
        const sessionPaymentIds = async () => {
          const { data, error: qe } = await supabase.from('supplier_payments').select('id')
            .eq('tenant_id', tenant.id).eq('supplier_id', supplier.id).eq('cash_session_id', sess.id)
            .order('created_at', { ascending: false }).limit(500);
          return qe ? null : new Set((data || []).map((r: { id: string }) => r.id));
        };
        if (attempt.uncertain && attempt.snapshot && attempt.sessionId === sess.id) {
          const now = await sessionPaymentIds();
          if (!now) { error('Connexion impossible — vérifiez le réseau puis réessayez.'); return; }
          if ([...now].some(id => !attempt.snapshot!.has(id))) {
            await finishSuccess(funding, orderId, amt, 'Règlement déjà enregistré avant la coupure réseau · caisse du jour');
            return;
          }
        } else {
          attempt.snapshot = await sessionPaymentIds();
          attempt.sessionId = sess.id;
        }

        const available = Number(sess.opening_amount || 0) + Number(sess.theoretical_amount || 0);
        if (available < amt) { error('Solde caisse insuffisant'); return; }
        res = await supabase.rpc('register_supplier_payment', {
          p_supplier_id: supplier.id, p_payment_method_id: pm.id, p_method_name: pm.name,
          p_amount: amt, p_reference: reference, p_cash_session_id: sess.id,
          p_order_id: orderId, p_from_cash: true,
        });
      }

      if (res.error) {
        if (isNetworkError(res.error)) {
          attempt.uncertain = true;
          error('Réponse du serveur non reçue — vérifiez la connexion puis validez à nouveau : le règlement ne sera pas enregistré deux fois.');
        } else {
          attemptRef.current = null;
          error(res.error.message);
        }
        return;
      }
      const body = res.data as { success?: boolean; error?: string } | null;
      if (!body || typeof body !== 'object' || body.success === false || typeof body.error === 'string') {
        attemptRef.current = null;
        error(body?.error || 'Règlement refusé par le serveur');
        return;
      }
      await finishSuccess(funding, orderId, amt, funding === 'vault' ? 'Règlement enregistré · imputé sur le coffre' : 'Règlement enregistré · imputé sur la caisse du jour');
    } catch {
      if (attemptRef.current) attemptRef.current.uncertain = true;
      error('Réponse du serveur non reçue — vérifiez la connexion puis validez à nouveau.');
    } finally {
      inFlightRef.current = false;
      setPaying(false);
    }
  };

  const finishSuccess = async (funding: 'cash' | 'vault', orderId: string | null, amount: number, message: string) => {
    attemptRef.current = null;
    success(message);
    setPayOrder(''); setPayAmount(''); setPayRef('');
    if (initialOrderId) initializedRef.current = false;
    onSuccess?.({ orderId, amount, funding });
    await reload();
  };

  const submitDisabled = paying || loading || !!loadError || !!blocked || blockedMissing || (Number(payAmount) || 0) <= 0;

  return (
    <Modal open onClose={onClose} title="Saisir un règlement" size="sm" layer="top" fullscreenMobile panelClassName="sm:!h-[500px]"
      footer={
        <div className="flex items-center gap-2">
          <button onClick={submitPayment} disabled={submitDisabled} className="btn-icon" title="Valider" aria-label="Valider le règlement">
            {paying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          </button>
          <button onClick={onClose} className="btn-icon" title="Fermer" aria-label="Fermer"><X className="w-4 h-4" /></button>
        </div>
      }>
      <div className="pb-3 border-b border-neutral-100">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-black truncate">{supplier.name}</div>
            <div className="text-[9px] font-semibold tracking-wider uppercase text-[var(--w-text-disabled)] mt-0.5">Règlement avec imputation</div>
          </div>
          <div className="text-right text-black shrink-0">
            <div className="text-[9px] font-bold uppercase tracking-wider opacity-50 leading-none">Solde comptable</div>
            <div className="text-sm font-bold tabular-nums leading-none mt-0.5">{loading ? '...' : formatFCFA(balance)}</div>
          </div>
        </div>
      </div>

      {loading && !orders.length ? (
        <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[var(--w-text-disabled)]" /></div>
      ) : loadError ? (
        <div className="py-10 flex flex-col items-center gap-3 text-center">
          <div className="text-sm text-[var(--w-text-sec)]">{loadError}</div>
          <button type="button" onClick={reload} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--w-text)] border-b border-[var(--w-text)] pb-0.5">
            <RotateCcw className="w-3.5 h-3.5" />Réessayer
          </button>
        </div>
      ) : (
        <>
          {target?.reason && (
            <div className="mt-3 flex items-start gap-2 text-[12px] text-[var(--w-text)]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
              <span>{target.order ? `${target.order.order_number} · ` : ''}{target.reason}</span>
            </div>
          )}
          <SupplierPaymentForm
            payable={choices.payable} positionedDue={choices.positionedDue} target={target?.order || null}
            methods={methods}
            payOrder={payOrder} setPayOrder={setPayOrder}
            payAmount={payAmount} setPayAmount={setPayAmount}
            payMethod={payMethod} setPayMethod={setPayMethod}
            payRef={payRef} setPayRef={setPayRef}
            payFunding={payFunding} setPayFunding={setPayFunding} vaultEnabled={vaultEnabled}
            recentPayments={payments.slice(0, 8).map(p => ({ ...p, order_number: orders.find(x => x.id === p.order_id)?.order_number }))}
          />
        </>
      )}
    </Modal>
  );
}

type FormProps = {
  payable: OrderRow[]; positionedDue: number; target: OrderRow | null; methods: Method[];
  payOrder: string; setPayOrder: (v: string) => void;
  payAmount: string; setPayAmount: (v: string) => void;
  payMethod: string; setPayMethod: (v: string) => void;
  payRef: string; setPayRef: (v: string) => void;
  payFunding: 'cash' | 'vault'; setPayFunding: (v: 'cash' | 'vault') => void;
  vaultEnabled: boolean;
  recentPayments: (Payment & { order_number?: string })[];
};

function SupplierPaymentForm({
  payable, positionedDue, target, methods, payOrder, setPayOrder, payAmount, setPayAmount, payMethod, setPayMethod,
  payRef, setPayRef, payFunding, setPayFunding, vaultEnabled, recentPayments,
}: FormProps) {
  const isBalance = payOrder === BALANCE_ID;
  const selected = isBalance ? null : (payable.find(o => o.id === payOrder) || (target && target.id === payOrder ? target : null));
  const due = isBalance ? positionedDue : selected ? orderRemaining(selected) : 0;
  const amt = Number(payAmount) || 0;
  const remaining = Math.max(0, due - amt);
  const hasSelection = isBalance || !!selected;

  const options = [
    { value: '', label: 'Acompte libre (sans commande)' },
    ...payable.map(o => ({ value: o.id, label: `${o.order_number} · dû ${formatFCFA(orderRemaining(o))}` })),
  ];
  if (target && !payable.some(o => o.id === target.id)) {
    options.push({ value: target.id, label: `${target.order_number} · non réglable` });
  }

  const selectOrder = (id: string) => {
    setPayOrder(id);
    if (id === BALANCE_ID) { setPayAmount(String(positionedDue)); return; }
    const o = payable.find(x => x.id === id);
    if (o) setPayAmount(String(orderRemaining(o)));
  };

  return (
    <div className="pt-1">
      <div className="grid grid-cols-2 py-1">
        <div className="pr-4">
          <label htmlFor="sp-amount" className="text-[10px] uppercase font-semibold text-[var(--w-text-muted)] tracking-wide">Montant à régler</label>
          <div className="mt-1 flex items-baseline gap-1">
            <input id="sp-amount" type="number" inputMode="decimal" value={payAmount} onChange={e => setPayAmount(e.target.value)}
              className="text-lg font-bold text-[var(--w-text)] focus:outline-none flex-1 min-w-0 placeholder:text-slate-300 bg-transparent" placeholder="0" min={0} />
            <span className="text-xs text-[var(--w-text-muted)] font-medium">FCFA</span>
          </div>
        </div>
        <div className="pl-4 border-l border-neutral-200">
          {hasSelection ? (
            <>
              <div className="text-[10px] uppercase font-semibold text-[var(--w-text-muted)] tracking-wide">{isBalance ? 'Solde positionné' : `Dû · ${selected!.order_number}`}</div>
              <div className="mt-1 text-sm font-bold text-[var(--w-text)] num">{formatFCFA(due)}</div>
              {selected && (
                <div className="text-[10px] text-[var(--w-text-muted)] mt-0.5 num">Total {formatFCFA(selected.total)} · payé {formatFCFA(selected.paid)}</div>
              )}
              {amt > 0 && <div className="text-[11px] text-[var(--w-text-muted)] mt-0.5">Reste après : <span className="font-bold num text-[var(--w-text)]">{formatFCFA(remaining)}</span></div>}
            </>
          ) : (
            <>
              <div className="text-[10px] uppercase font-semibold text-[var(--w-text-muted)] tracking-wide">Imputation</div>
              <div className="mt-1 text-xs text-[var(--w-text-disabled)]">Aucune commande</div>
            </>
          )}
        </div>
      </div>

      <div className="mt-3">
        <label className="text-[10px] uppercase font-semibold text-[var(--w-text-muted)] tracking-wide mb-1 block">Imputer sur</label>
        <SearchableSelect
          variant="underline"
          options={options}
          value={payOrder}
          onChange={selectOrder}
          placeholder="Acompte libre (sans commande)"
        />
        {positionedDue > 0 && (
          <button type="button" onClick={() => selectOrder(BALANCE_ID)}
            className={`mt-1.5 text-[11px] font-medium transition-colors ${isBalance ? 'text-[var(--w-text)] font-semibold' : 'text-[var(--w-text-muted)] hover:text-[var(--w-text)]'}`}>
            Solde positionné · {formatFCFA(positionedDue)}
          </button>
        )}
        {payable.length === 0 && positionedDue <= 0 && <div className="text-[11px] text-emerald-700 mt-1 inline-flex items-center gap-1"><Check className="w-3 h-3" />Tout soldé</div>}
      </div>

      <div className="mt-3">
        <label className="text-[10px] uppercase font-semibold text-[var(--w-text-muted)] tracking-wide mb-1 block">Mode</label>
        <div className="flex items-center gap-4 flex-wrap">
          {methods.map(m => (
            <button key={m.id} type="button" onClick={() => setPayMethod(m.id)}
              className={`text-[12px] pb-1 transition-all border-b-2 ${payMethod === m.id ? 'border-[var(--w-text)] text-[var(--w-text)] font-semibold' : 'border-transparent text-[var(--w-text-disabled)] hover:text-[var(--w-text-sec)]'}`}>
              {m.name}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <label htmlFor="sp-ref" className="text-[10px] uppercase font-semibold text-[var(--w-text-muted)] tracking-wide mb-1 block">Référence (optionnel)</label>
        <input id="sp-ref" value={payRef} onChange={e => setPayRef(e.target.value)}
          className="bare-input text-sm py-1.5"
          placeholder="N° chèque, virement…" />
      </div>

      {vaultEnabled && (
        <div className="mt-3">
          <label className="text-[10px] uppercase font-semibold text-[var(--w-text-muted)] tracking-wide mb-1 block">Source des fonds</label>
          <div className="flex items-center gap-4">
            {(['cash', 'vault'] as const).map(f => (
              <button key={f} type="button" onClick={() => setPayFunding(f)}
                className={`text-[12px] pb-1 transition-all border-b-2 ${payFunding === f ? 'border-[var(--w-text)] text-[var(--w-text)] font-semibold' : 'border-transparent text-[var(--w-text-disabled)] hover:text-[var(--w-text-sec)]'}`}>
                {f === 'cash' ? 'Caisse' : 'Coffre'}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 text-[11px] text-[var(--w-text-muted)]">
        {vaultEnabled && payFunding === 'vault' ? 'Imputé sur le coffre' : 'Imputé sur la caisse du jour'}
      </div>

      {recentPayments.length > 0 && (
        <RecentPaymentsAccordion label="Derniers règlements">
          {recentPayments.map(p => (
            <div key={p.id} className="flex items-center justify-between py-1.5 border-b border-neutral-100 last:border-0">
              <div className="text-xs text-[var(--w-text-sec)]">{p.method_name}{p.reference ? ` · ${p.reference}` : ''}</div>
              <div className="text-xs text-[var(--w-text-disabled)]">{p.order_number || 'Acompte'}</div>
              <div className="text-xs font-bold text-emerald-700 num">{formatFCFA(p.amount)}</div>
            </div>
          ))}
        </RecentPaymentsAccordion>
      )}
    </div>
  );
}
