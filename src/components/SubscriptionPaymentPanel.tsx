import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CreditCard, Loader2, RefreshCw } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatDateTime, formatFCFA } from '../lib/format';
import {
  callSubscriptionPayments, subscriptionCycleLabels, subscriptionPaymentLabel,
  type SubscriptionPaymentContext,
} from '../lib/subscriptionPayments';

export function useCanPaySubscription() {
  const { profile, tenant, isOwner } = useApp();
  return !!tenant && profile?.role === 'admin' && profile.is_active !== false && (isOwner || !tenant.owner_user_id);
}

export function SubscriptionPaymentPanel({ paymentId }: { paymentId?: string }) {
  const { tenant, refresh } = useApp();
  const canPay = useCanPaySubscription();
  const [context, setContext] = useState<SubscriptionPaymentContext>();
  const [busy, setBusy] = useState<'start' | 'reconcile' | null>(null);
  const [error, setError] = useState('');
  const refreshedPayment = useRef<string>();
  const payment = context?.payment;
  const quote = paymentId ? null : context?.quote;
  const tenantId = tenant?.id;

  useEffect(() => {
    if (!canPay) return;
    let current = true;
    let polls = 0;
    const read = async () => {
      try {
        const result = await callSubscriptionPayments<SubscriptionPaymentContext>({
          action: 'context', payment_id: paymentId,
        });
        if (current) {
          setContext(result);
          setError('');
          if (result.payment?.state !== 'pending' && result.payment?.state !== 'creating') {
            window.clearInterval(timer);
          }
        }
      } catch (cause) {
        if (current && paymentId) setError((cause as Error).message);
      }
    };

    const timer = paymentId ? window.setInterval(() => {
      if (++polls <= 12) void read();
      else window.clearInterval(timer);
    }, 4000) : undefined;
    void read();
    return () => { current = false; window.clearInterval(timer); };
  }, [canPay, paymentId, tenantId]);

  useEffect(() => {
    if (payment?.subscription_id && payment.id !== refreshedPayment.current) {
      refreshedPayment.current = payment.id;
      void refresh();
    }
  }, [payment, refresh]);

  const verify = useCallback(async () => {
    if (!payment) return;
    setBusy('reconcile');
    setError('');
    try {
      setContext(await callSubscriptionPayments<SubscriptionPaymentContext>({
        action: 'reconcile', payment_id: payment.id,
      }));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }, [payment]);

  const start = async () => {
    setBusy('start');
    setError('');
    try {
      if (payment?.state === 'pending' && payment.checkout_url) {
        window.location.assign(payment.checkout_url);
        return;
      }
      const result = await callSubscriptionPayments<{ checkout_url: string }>({ action: 'start' });
      window.location.assign(result.checkout_url);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!canPay) return null;
  if (!paymentId && (!context?.enabled || (!quote && !payment))) return null;

  const isPending = payment?.state === 'pending';
  const checkoutAvailable = !!quote || isPending;
  const creating = payment?.state === 'creating';
  const label = isPending ? 'Reprendre le paiement'
    : quote?.purpose === 'initial' ? 'Payer l’abonnement'
    : 'Payer la prochaine échéance';

  return (
    <section className="space-y-3 border-y border-[var(--w-separator)] py-4 text-left" aria-label="Paiement de l’abonnement">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--w-text)]">
            <CreditCard className="h-4 w-4 shrink-0" />
            {paymentId ? 'Suivi du paiement' : 'Paiement en ligne'}
          </h3>
          {quote && (
            <p className="mt-1.5 text-sm text-[var(--w-text-sec)]">
              {quote.plan_name} · {subscriptionCycleLabels[quote.billing_cycle]}
            </p>
          )}
        </div>
        {(quote || payment) && (
          <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--w-text)]">
            {formatFCFA(quote?.amount ?? payment?.amount)}
          </span>
        )}
      </div>

      {context?.environment === 'test' && <p className="text-xs font-medium text-amber-700">Mode test PayTech</p>}
      {payment && (
        <div className="space-y-1 text-xs text-[var(--w-text-sec)]" aria-live="polite">
          <p className="font-medium text-[var(--w-text)]">{quote && 'Dernier paiement · '}{subscriptionPaymentLabel(payment)}</p>
          {payment.paid_at && <p>{formatDateTime(payment.paid_at)}{payment.payment_method && ' · ' + payment.payment_method}</p>}
          {paymentId && <p className="break-all">Référence {payment.id}</p>}
          {payment.review_reason && <p>Contactez l’équipe Waarwi avec la référence {payment.id}.</p>}
          {payment.state === 'paid' && payment.subscription_id && <p>Votre abonnement a été mis à jour.</p>}
        </div>
      )}
      {paymentId && !context && !error && <p className="text-sm text-[var(--w-text-sec)]">Vérification du paiement…</p>}
      {paymentId && context && !payment && <p className="text-sm text-[var(--w-text-sec)]">Paiement indisponible sur ce compte.</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      {(checkoutAvailable || creating) && (
        <div className="flex flex-wrap items-center gap-3">
          {checkoutAvailable && (
            <button type="button" onClick={() => void start()} disabled={!!busy}
              className="inline-flex min-h-10 items-center gap-2 bg-neutral-900 px-3.5 text-sm font-semibold text-white disabled:opacity-60">
              {busy === 'start' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
              {label}
            </button>
          )}
          {(isPending || creating) && (
            <button type="button" onClick={() => void verify()} disabled={!!busy}
              className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-[var(--w-text)] hover:underline disabled:opacity-60">
              <RefreshCw className={'h-4 w-4' + (busy === 'reconcile' ? ' animate-spin' : '')} />
              Vérifier le statut
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function SubscriptionPaymentReturn({ paymentId, onClose }: { paymentId: string; onClose: () => void }) {
  return (
    <main className="min-h-[100dvh] bg-[var(--w-surface)] px-5 py-12">
      <div className="mx-auto max-w-md space-y-6">
        <img src="/newlogo.png" alt="Waarwi" className="h-8 w-auto object-contain w-platform-logo" />
        <h1 className="text-xl font-semibold text-[var(--w-text)]">Votre abonnement Waarwi</h1>
        <SubscriptionPaymentPanel paymentId={paymentId} />
        <button type="button" onClick={onClose} className="min-h-10 text-sm font-semibold text-[var(--w-text)] underline underline-offset-4">
          Revenir à Waarwi
        </button>
      </div>
    </main>
  );
}
