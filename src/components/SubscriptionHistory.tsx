import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatDate, formatDateTime, formatFCFA } from '../lib/format';
import {
  callSubscriptionRecords, hasSubscriptionReceipt, subscriptionCycleLabels,
  subscriptionPaymentDuration, subscriptionPaymentLabel,
  type SubscriptionCycle, type SubscriptionPayment,
} from '../lib/subscriptionPayments';
import { Modal } from './Modal';
import { SubscriptionReceiptButton } from './SubscriptionReceiptButton';

type Dates = { started_at: string; ends_at: string | null };
type Period = Dates & { id: string; plan_name: string; billing_cycle: SubscriptionCycle | null; status: string };
type PaidRecord = SubscriptionPayment & { plan_name: string; period: Dates | null };
type History = { periods?: Period[]; payments?: PaidRecord[]; has_more: boolean };
type Section = 'periods' | 'payments';

function periodLabel({ started_at, ends_at }: Dates) {
  return ends_at ? `Du ${formatDate(started_at)} au ${formatDate(ends_at)}`
    : `À compter du ${formatDate(started_at)} · Sans échéance`;
}

function periodStatus(period: Period) {
  if (period.status === 'cancelled') return 'Annulée';
  if (period.status === 'superseded') return 'Remplacée';
  if (period.status === 'pending') return 'En attente';
  if (period.status === 'suspended') return 'Suspendue';
  if (period.status === 'expired') return 'Expirée';
  if (new Date(period.started_at).getTime() > Date.now()) return 'À venir';
  if (period.ends_at && new Date(period.ends_at).getTime() <= Date.now()) return 'Terminée';
  return 'En cours';
}

export function SubscriptionHistory({ initialSection = 'periods' }: { initialSection?: Section }) {
  const [section, setSection] = useState<Section>(initialSection);
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const [history, setHistory] = useState<History>();
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    void callSubscriptionRecords<History>({ action: 'history', section, page }).then(data => {
      if (current) setHistory(data);
    }).catch(cause => {
      if (current) setError(cause instanceof Error ? cause.message : 'Historique indisponible.');
    });
    return () => { current = false; };
  }, [section, page, retry]);

  function changePage(next: number) {
    setHistory(undefined);
    setError('');
    setPage(next);
  }

  const periods = history?.periods ?? [];
  const payments = history?.payments ?? [];

  return (
    <section aria-labelledby="subscription-history" className="space-y-3">
      <h2 id="subscription-history" className="text-base font-semibold text-[var(--w-text)]">Historique de l’abonnement</h2>
      <div className="flex flex-wrap gap-x-5 border-b border-[var(--w-separator)]">
        {([{ key: 'periods', label: 'Périodes' }, { key: 'payments', label: 'Paiements et reçus' }] as const).map(option => (
          <button key={option.key} type="button" aria-pressed={section === option.key}
            onClick={() => { if (section !== option.key) { setSection(option.key); changePage(0); } }}
            className={`min-h-10 border-b-2 text-sm font-medium ${section === option.key
              ? 'border-current text-[var(--w-text)]' : 'border-transparent text-[var(--w-text-sec)]'}`}>
            {option.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="space-y-2 text-sm">
          <p role="alert" className="text-red-700">{error}</p>
          <button type="button" onClick={() => { setError(''); setRetry(value => value + 1); }}
            className="min-h-10 font-semibold underline underline-offset-4">Réessayer</button>
        </div>
      ) : !history ? (
        <p role="status" className="py-2 text-sm text-[var(--w-text-sec)]">Chargement de l’historique…</p>
      ) : section === 'periods' ? (
        periods.length ? (
          <ul className="divide-y divide-[var(--w-separator)]">
            {periods.map(period => (
              <li key={period.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-[var(--w-text)]">{period.plan_name}</p>
                  <p className="mt-1 text-xs text-[var(--w-text-sec)]">
                    {period.billing_cycle && `${subscriptionCycleLabels[period.billing_cycle]} · `}
                    {periodLabel(period)}
                  </p>
                </div>
                <span className="text-xs font-medium text-[var(--w-text-sec)]">{periodStatus(period)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="py-2 text-sm text-[var(--w-text-sec)]">Aucune période d’abonnement enregistrée.</p>
      ) : payments.length ? (
        <ul className="divide-y divide-[var(--w-separator)]">
          {payments.map(payment => (
            <li key={payment.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-3">
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold text-[var(--w-text)]">
                  {payment.plan_name} · {subscriptionPaymentDuration(payment)} · {formatFCFA(payment.amount)}
                </p>
                <p className="mt-1 text-xs text-[var(--w-text-sec)]">
                  {payment.paid_at && `${formatDateTime(payment.paid_at)} · `}{subscriptionPaymentLabel(payment)}
                </p>
                <p className="mt-1 text-xs text-[var(--w-text-sec)]">
                  {payment.period ? periodLabel(payment.period) : 'Période à confirmer'}
                </p>
              </div>
              {hasSubscriptionReceipt(payment) && <SubscriptionReceiptButton paymentId={payment.id} />}
            </li>
          ))}
        </ul>
      ) : <p className="py-2 text-sm text-[var(--w-text-sec)]">Aucun paiement en ligne accompagné d’un reçu pour le moment.</p>}

      {history && (page > 0 || history.has_more) && (
        <nav aria-label="Pages de l’historique" className="flex flex-wrap items-center gap-3 border-t border-[var(--w-separator)] pt-2 text-xs">
          <button type="button" disabled={page === 0} onClick={() => changePage(page - 1)}
            className="inline-flex min-h-10 items-center gap-1 font-medium disabled:opacity-40">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Précédente
          </button>
          <span className="text-[var(--w-text-sec)]">Page {page + 1}</span>
          <button type="button" disabled={!history.has_more} onClick={() => changePage(page + 1)}
            className="inline-flex min-h-10 items-center gap-1 font-medium disabled:opacity-40">
            Suivante <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </nav>
      )}
    </section>
  );
}

export function SubscriptionHistoryAccess() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog"
        className="min-h-10 text-sm font-semibold text-[var(--w-text)] underline underline-offset-4">
        Voir mes reçus
      </button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title="Mes documents d’abonnement" size="md" layer="top" focusOnOpen>
          <SubscriptionHistory initialSection="payments" />
        </Modal>
      )}
    </>
  );
}
