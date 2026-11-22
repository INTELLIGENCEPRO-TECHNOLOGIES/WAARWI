import { useRealtimeTick } from '../lib/useRealtimeData';
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Search } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { formatDateTime, formatFCFA } from '../lib/format';
import {
  callSubscriptionPayments, subscriptionCycleLabels, subscriptionPaymentDuration, subscriptionPaymentLabel,
  type SubscriptionPayment,
} from '../lib/subscriptionPayments';
import { PlatformWorkPage } from './PlatformWorkPage';

type PaymentList = {
  payments: SubscriptionPayment[];
  total: number;
  page_size: number;
  environment: 'prod' | 'test' | null;
  checkout_paused?: boolean;
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
  const paymentTick = useRealtimeTick(['tenant_subscription_payments', 'tenants']);
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
  }, [search, state, environment, page, from, through, reload, paymentTick]);

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

  const savings = selected?.monthly_rate && selected.billing_months
    ? selected.monthly_rate * selected.billing_months - selected.amount : 0;

  if (selected) {
    return (
      <PlatformWorkPage title={selected.tenant_name || 'Détail de l’encaissement'} backLabel="Retour aux encaissements"
        onBack={() => setSelectedId(null)} busy={checking}>
          <dl className="pa-keyvals">
            {([
              ['Entreprise', selected.tenant_name],
              ['Référence', selected.id],
              ['Offre', selected.plan_code + ' · ' + subscriptionCycleLabels[selected.billing_cycle]],
              ['Durée', subscriptionPaymentDuration(selected)],
              ['Montant', formatFCFA(selected.amount)],
              ['Remise accordée', savings > 0 && formatFCFA(savings)],
              ['Statut', subscriptionPaymentLabel(selected)],
              ['Moyen de paiement', selected.payment_method],
              ['Confirmé le', selected.paid_at && formatDateTime(selected.paid_at)],
              ['Abonnement', selected.subscription_id],
              ['Motif de rapprochement', selected.review_reason && reviewReasons[selected.review_reason]],
            ] as const).filter(([, value]) => value).map(([label, value]) => (
              <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
            ))}
          </dl>
          {selected.state !== 'creating' && selected.state !== 'failed' && (
            <button type="button" onClick={() => void verify()} disabled={checking} className="pa-button mt-4">
              <RefreshCw size={15} className={checking ? 'animate-spin' : undefined} />
              Vérifier auprès de PayTech
            </button>
          )}
      </PlatformWorkPage>
    );
  }

  return (
    <section className="pa-page" aria-label="Encaissements des abonnements">
      <div className="pa-toolbar">
        <label className="pa-search">
          <Search size={16} aria-hidden="true" />
          <input aria-label="Entreprise ou référence" placeholder="Entreprise ou référence"
            value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} />
        </label>
        <select aria-label="Statut" className="pa-field" value={state}
          onChange={event => { setState(event.target.value); setPage(0); }}>
          {statuses.map(status => <option key={status.key} value={status.key}>{status.label}</option>)}
        </select>
        <select aria-label="Environnement" className="pa-field" value={environment}
          onChange={event => { setEnvironment(event.target.value === 'test' ? 'test' : 'prod'); setPage(0); }}>
          <option value="prod">Production</option>
          <option value="test">Mode test</option>
        </select>
        <button type="button" onClick={refresh} disabled={loading} className="pa-icon-button" aria-label="Actualiser" title="Actualiser">
          <RefreshCw size={16} className={loading ? 'animate-spin' : undefined} />
        </button>
      </div>

      <details className="pa-period-filter" open={from || through ? true : undefined}>
        <summary className="pa-heading cursor-pointer">Période</summary>
        <div className="pa-inline mt-2">
          <label className="pa-field-label">Du
            <input type="date" className="pa-field" value={from} max={through || undefined}
              onChange={event => { setFrom(event.target.value); setPage(0); }} />
          </label>
          <label className="pa-field-label">Au
            <input type="date" className="pa-field" value={through} min={from || undefined}
              onChange={event => { setThrough(event.target.value); setPage(0); }} />
          </label>
          {(from || through) && <button type="button" className="pa-link" onClick={() => { setFrom(''); setThrough(''); setPage(0); }}>Effacer</button>}
        </div>
      </details>

      {result && (result.checkout_paused || !result.environment) && (
        <div className="pa-feedback border-t border-[var(--w-separator)]">
          <p>{result.environment ? 'Paiement PayTech désactivé.' : 'PayTech est en attente de configuration.'}</p>
          {!!result.configuration?.missing.length && <p>Ajoute {result.configuration.missing.join(', ')} dans les secrets Supabase.</p>}
          {!!result.configuration?.invalid.length && <p>Vérifie la valeur de {result.configuration.invalid.join(', ')} dans Supabase.</p>}
        </div>
      )}

      {failure ? <p role="alert" className="pa-danger text-sm">{failure}</p>
        : loading ? <div className="pa-empty" role="status"><Loader2 size={16} className="animate-spin" /> Chargement…</div>
        : !result?.payments.length ? <p className="pa-empty">Aucun paiement pour ces filtres.</p>
        : (
          <>
            <div className="pa-table pa-payment-list" role="table" aria-label="Paiements">
              <div role="row" className="pa-list-head">
                {['Entreprise', 'Opération', 'Montant', 'Statut', 'Date', 'Actions'].map(label => <span key={label} role="columnheader">{label}</span>)}
              </div>
              {result.payments.map(payment => (
                <div key={payment.id} role="row" className="pa-list-row">
                  <div role="cell" className="pa-row-title"><button type="button" className="pa-name-button"
                    onClick={() => setSelectedId(payment.id)}>{payment.tenant_name || 'Entreprise'}</button></div>
                  <div role="cell" className="pa-row-plan">
                    {payment.purpose === 'initial' ? 'Inscription' : 'Renouvellement'}
                    <div className="pa-row-subtitle">{subscriptionPaymentDuration(payment)}</div>
                  </div>
                  <div role="cell" className="pa-row-amount font-medium">{formatFCFA(payment.amount)}</div>
                  <div role="cell" className="pa-row-status pa-status" data-alert={!!payment.review_reason}>{subscriptionPaymentLabel(payment)}</div>
                  <div role="cell" className="pa-row-date pa-muted">{formatDateTime(payment.paid_at ?? payment.created_at)}</div>
                  <div role="cell" className="pa-row-actions">
                    <button type="button" className="pa-link" aria-label={'Détail du paiement de ' + payment.tenant_name}
                      onClick={() => setSelectedId(payment.id)}>Détail</button>
                  </div>
                </div>
              ))}
            </div>
            <nav className="pa-section-head pa-muted text-xs" aria-label="Pagination des encaissements">
              <span>{total} paiement{total !== 1 ? 's' : ''}</span>
              {pages > 1 && <div className="pa-inline">
                <button type="button" aria-label="Page précédente" disabled={page === 0}
                  onClick={() => setPage(page - 1)} className="pa-icon-button"><ChevronLeft size={16} /></button>
                <span>{page + 1} / {pages}</span>
                <button type="button" aria-label="Page suivante" disabled={page + 1 >= pages}
                  onClick={() => setPage(page + 1)} className="pa-icon-button"><ChevronRight size={16} /></button>
              </div>}
            </nav>
          </>
        )}

    </section>
  );
}
