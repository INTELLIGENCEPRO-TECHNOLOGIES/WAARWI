import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Search } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { formatDateTime, formatFCFA } from '../lib/format';
import {
  callSubscriptionPayments, subscriptionCycleLabels, subscriptionPaymentDuration, subscriptionPaymentLabel,
  type SubscriptionPayment,
} from '../lib/subscriptionPayments';
import { Modal } from './Modal';

type PaymentList = {
  payments: SubscriptionPayment[];
  total: number;
  page_size: number;
  environment: 'prod' | 'test' | null;
  configuration?: { missing: string[]; invalid: string[] };
};

const statuses = [
  { key: 'all', label: 'Tous les statuts' },
  { key: 'open', label: 'En attente' },
  { key: 'paid', label: 'Confirmés' },
  { key: 'cancelled', label: 'Annulés' },
  { key: 'failed', label: 'Échecs' },
  { key: 'refunded', label: 'Remboursés' },
  { key: 'review', label: 'À rapprocher' },
];

const reviewReasons: Record<string, string> = {
  tenant_missing: 'Entreprise supprimée',
  tenant_unavailable: 'Accès de l’entreprise suspendu ou inscription rejetée',
  plan_changed: 'Plan ou cycle modifié après l’ouverture du paiement',
  period_changed: 'Échéance modifiée après l’ouverture du paiement',
  refunded: 'Remboursement confirmé par PayTech',
};

const fieldClass = 'min-h-10 border-b border-[var(--w-separator)] bg-transparent px-1 text-sm text-[var(--w-text)] outline-none focus:border-[var(--w-text)]';

export function AdminSubscriptionPayments() {
  const [result, setResult] = useState<PaymentList>();
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState('');
  const [search, setSearch] = useState('');
  const [state, setState] = useState('all');
  const [environment, setEnvironment] = useState<'prod' | 'test'>('prod');
  const [from, setFrom] = useState('');
  const [through, setThrough] = useState('');
  const [page, setPage] = useState(0);
  const [reload, setReload] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const { success, error } = useToast();

  useEffect(() => {
    let current = true;
    setLoading(true);
    setFailure('');
    const timer = window.setTimeout(async () => {
      try {
        const data = await callSubscriptionPayments<PaymentList>({
          action: 'admin_list', search, state, environment, page, from, through,
        });
        if (current) setResult(data);
      } catch (cause) {
        if (current) setFailure((cause as Error).message);
      } finally {
        if (current) setLoading(false);
      }
    }, search ? 250 : 0);
    return () => { current = false; window.clearTimeout(timer); };
  }, [search, state, environment, page, from, through, reload]);

  const selected = result?.payments.find(payment => payment.id === selectedId);
  const total = result?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (result?.page_size ?? 50)));
  const refresh = () => setReload(previous => previous + 1);

  const verify = async () => {
    if (!selected) return;
    setChecking(true);
    try {
      const { verified } = await callSubscriptionPayments<{ verified: boolean }>({
        action: 'admin_reconcile', payment_id: selected.id,
      });
      success(verified ? 'Statut vérifié auprès de PayTech' : 'PayTech indique un statut encore en attente');
      refresh();
    } catch (cause) {
      error((cause as Error).message);
    } finally {
      setChecking(false);
    }
  };

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-[var(--w-text)]">Encaissements des abonnements</h2>
          <p className="mt-1 text-sm text-[var(--w-text-sec)]">Premiers paiements et renouvellements PayTech</p>
        </div>
        <button type="button" onClick={refresh} disabled={loading}
          className="inline-flex min-h-10 items-center gap-2 border-b border-[var(--w-separator)] text-sm font-medium text-[var(--w-text)] disabled:opacity-60">
          <RefreshCw className={'h-4 w-4' + (loading ? ' animate-spin' : '')} />
          Actualiser
        </button>
      </header>

      {result && !result.environment && (
        <div className="space-y-1 border-l-2 border-amber-500 pl-3 text-sm text-[var(--w-text-sec)]">
          <p>PayTech est en attente de configuration.</p>
          {!!result.configuration?.missing.length && (
            <p>Ajoute {result.configuration.missing.join(', ')} dans les secrets Supabase.</p>
          )}
          {!!result.configuration?.invalid.length && (
            <p>Vérifie la valeur de {result.configuration.invalid.join(', ')} dans Supabase.</p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <label className="flex min-w-[220px] flex-1 items-center gap-2 border-b border-[var(--w-separator)]">
          <Search className="h-4 w-4 text-[var(--w-text-muted)]" />
          <input aria-label="Entreprise ou référence" className="min-h-10 w-full bg-transparent text-sm text-[var(--w-text)] outline-none"
            placeholder="Entreprise ou référence" value={search}
            onChange={event => { setSearch(event.target.value); setPage(0); }} />
        </label>
        <select aria-label="Statut" className={fieldClass} value={state}
          onChange={event => { setState(event.target.value); setPage(0); }}>
          {statuses.map(status => <option key={status.key} value={status.key}>{status.label}</option>)}
        </select>
        <select aria-label="Environnement" className={fieldClass} value={environment}
          onChange={event => { setEnvironment(event.target.value === 'test' ? 'test' : 'prod'); setPage(0); }}>
          <option value="prod">Production</option>
          <option value="test">Mode test</option>
        </select>
        <label className="flex flex-col text-xs text-[var(--w-text-sec)]">
          Du
          <input type="date" className={fieldClass} value={from} max={through || undefined}
            onChange={event => { setFrom(event.target.value); setPage(0); }} />
        </label>
        <label className="flex flex-col text-xs text-[var(--w-text-sec)]">
          Au
          <input type="date" className={fieldClass} value={through} min={from || undefined}
            onChange={event => { setThrough(event.target.value); setPage(0); }} />
        </label>
      </div>

      {failure ? <p role="alert" className="text-sm text-red-700">{failure}</p>
        : loading ? <div className="py-12 flex justify-center" role="status"><Loader2 aria-label="Chargement" className="h-5 w-5 animate-spin" /></div>
        : !result?.payments.length ? <p className="py-8 text-sm text-[var(--w-text-sec)]">Aucun paiement pour ces filtres.</p>
        : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[650px] whitespace-nowrap text-left text-sm">
                <thead>
                  <tr className="border-y border-[var(--w-separator)] text-xs font-semibold text-[var(--w-text-sec)]">
                    <th scope="col" className="py-3 pr-4">Entreprise</th>
                    <th scope="col" className="py-3 pr-4">Type</th>
                    <th scope="col" className="py-3 pr-4 text-right">Montant</th>
                    <th scope="col" className="py-3 pr-4">Statut</th>
                    <th scope="col" className="py-3 pr-4">Date</th>
                    <th scope="col" className="sr-only">Détail</th>
                  </tr>
                </thead>
                <tbody>
                  {result.payments.map(payment => (
                    <tr key={payment.id} className="border-b border-[var(--w-separator)]">
                      <td className="py-3 pr-4 font-semibold text-[var(--w-text)]">{payment.tenant_name}</td>
                      <td className="py-3 pr-4 text-[var(--w-text-sec)]">{payment.purpose === 'initial' ? 'Inscription' : 'Renouvellement'}</td>
                      <td className="py-3 pr-4 text-right tabular-nums text-[var(--w-text)]">{formatFCFA(payment.amount)}</td>
                      <td className={'py-3 pr-4 ' + (payment.review_reason ? 'font-semibold text-amber-700' : 'text-[var(--w-text-sec)]')}>
                        {subscriptionPaymentLabel(payment)}
                      </td>
                      <td className="py-3 pr-4 tabular-nums text-[var(--w-text-sec)]">{formatDateTime(payment.paid_at ?? payment.created_at)}</td>
                      <td className="py-3 text-right">
                        <button type="button" className="font-medium text-[var(--w-text)] hover:underline"
                          aria-label={'Détail du paiement de ' + payment.tenant_name}
                          onClick={() => setSelectedId(payment.id)}>Détail</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-[var(--w-text-sec)]">
              <span>{total} paiement{total === 1 ? '' : 's'}</span>
              <div className="flex items-center gap-3">
                <button type="button" aria-label="Page précédente" disabled={page === 0}
                  onClick={() => setPage(page - 1)} className="p-2 disabled:opacity-35"><ChevronLeft className="h-4 w-4" /></button>
                <span>{page + 1} / {pages}</span>
                <button type="button" aria-label="Page suivante" disabled={page + 1 >= pages}
                  onClick={() => setPage(page + 1)} className="p-2 disabled:opacity-35"><ChevronRight className="h-4 w-4" /></button>
              </div>
            </div>
          </>
        )}

      {selected && (
        <Modal open onClose={() => setSelectedId(null)} title="Détail de l’encaissement">
          <dl className="divide-y divide-[var(--w-separator)] text-sm">
            {[
              ['Entreprise', selected.tenant_name],
              ['Référence', selected.id],
              ['Plan', selected.plan_code + ' · ' + subscriptionCycleLabels[selected.billing_cycle]],
              ['Durée', subscriptionPaymentDuration(selected)],
              ['Montant', formatFCFA(selected.amount)],
              ['Statut', subscriptionPaymentLabel(selected)],
              ['Moyen de paiement', selected.payment_method],
              ['Confirmé le', selected.paid_at && formatDateTime(selected.paid_at)],
              ['Abonnement', selected.subscription_id],
              ['Motif de rapprochement', selected.review_reason && reviewReasons[selected.review_reason]],
            ].filter(([, value]) => value).map(([label, value]) => (
              <div key={label} className="flex flex-wrap justify-between gap-x-3 gap-y-1 py-2.5">
                <dt className="text-[var(--w-text-sec)]">{label}</dt>
                <dd className="break-all font-medium text-[var(--w-text)]">{value}</dd>
              </div>
            ))}
          </dl>
          {selected.state !== 'creating' && selected.state !== 'failed' && (
            <button type="button" onClick={() => void verify()} disabled={checking}
              className="mt-4 inline-flex min-h-10 items-center gap-2 bg-neutral-900 px-3.5 text-sm font-semibold text-white disabled:opacity-60">
              <RefreshCw className={'h-4 w-4' + (checking ? ' animate-spin' : '')} />
              Vérifier auprès de PayTech
            </button>
          )}
        </Modal>
      )}
    </section>
  );
}
