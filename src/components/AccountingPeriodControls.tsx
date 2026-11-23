import { useState } from 'react';
import { formatDate, formatNumber } from '../lib/format';
import { supabase } from '../lib/supabase';

type Family = 'cash' | 'vault' | 'supplier';
type Coverage = {
  family: Family; total: number; linked: number; missing: number; invalid: number;
  excluded: number; date_differences: number; amount_to_check: number;
};
type Issue = {
  family: Family; id: string; reference: string; operation_date: string; entry_date: string | null;
  amount: number; issue: 'missing' | 'invalid' | 'date';
};
type Compare = { ledger_debit: number; ledger_credit: number; balance_debit: number; balance_credit: number };
type ThirdPartyCheck = Compare & { family: 'client' | 'supplier'; configured: boolean; unassigned_lines: number };
type Report = {
  from: string; to: string;
  journal: { entries: number; debit: number; credit: number; inconsistent_entries: number; duplicate_sources: number };
  accounts: Compare & { lines: number; inconsistent_accounts: number };
  journal_examples: string[];
  account_examples: string[];
  third_parties: ThirdPartyCheck[];
  coverage: Coverage[];
  issues: Issue[];
};

const FAMILY_LABELS: Record<Family, string> = { cash: 'Caisse', vault: 'Coffre', supplier: 'Règlements fournisseurs' };
const ISSUE_LABELS: Record<Issue['issue'], string> = {
  missing: 'Aucun lien enregistré', invalid: 'Lien incohérent', date: 'Date comptable différente',
};

function count(value: number) {
  return Number(value).toLocaleString('fr-FR');
}

function money(value: number) {
  return `${formatNumber(Number(value), { maximumFractionDigits: 2 })}\u00a0FCFA`;
}

function dateLabel(value: string) {
  return formatDate(`${value}T12:00:00`);
}

function Amounts({ debit, credit }: { debit: number; credit: number }) {
  return (
    <>
      <div className="text-right"><dt className="text-xs text-neutral-500">Débit</dt><dd className="tabular-nums">{money(debit)}</dd></div>
      <div className="text-right"><dt className="text-xs text-neutral-500">Crédit</dt><dd className="tabular-nums">{money(credit)}</dd></div>
    </>
  );
}

function Operations({ data, issues }: { data: Coverage; issues: Issue[] }) {
  const issueCount = data.missing + data.invalid + data.date_differences;
  return (
    <section className="space-y-2 border-t border-neutral-200 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-neutral-900">{FAMILY_LABELS[data.family]}</h3>
        <p className="text-xs text-neutral-600">Rattachements {count(data.linked)} / {count(data.total - data.excluded)}</p>
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
        <span>{count(data.missing)} sans lien enregistré</span>
        <span>{count(data.invalid)} avec un lien incohérent</span>
        <span>{count(data.date_differences)} avec une date différente</span>
        {data.excluded > 0 && <span>Exclusions du rapprochement de caisse · {count(data.excluded)}</span>}
      </p>
      {data.missing + data.invalid > 0 && (
        <p className="text-xs text-neutral-600">Montant des mouvements dont le lien est à contrôler {money(data.amount_to_check)}.</p>
      )}
      {issues.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-neutral-800">
            {issues.length === issueCount ? 'Voir les écarts' : `Voir ${count(issues.length)} des ${count(issueCount)} écarts`}
          </summary>
          <ul className="mt-2 divide-y divide-neutral-200 border-t border-neutral-200">
            {issues.map(issue => (
              <li key={issue.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 py-2 text-sm">
                <div className="min-w-0 break-words">
                  <p>{issue.reference}</p>
                  <p className="text-xs text-neutral-600">
                    {dateLabel(issue.operation_date)} · {ISSUE_LABELS[issue.issue]}
                    {issue.issue === 'date' && issue.entry_date && ` · Journal ${dateLabel(issue.entry_date)}`}
                  </p>
                </div>
                <p className="text-right tabular-nums">{money(issue.amount)}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export function AccountingPeriodControls({ tenantId }: { tenantId: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(today.slice(0, 8) + '01');
  const [dateTo, setDateTo] = useState(today);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const check = async () => {
    setReport(null);
    setLoading(true);
    setError('');
    try {
      const { data, error: requestError } = await supabase.rpc('accounting_period_controls', {
        p_tenant_id: tenantId, p_date_from: dateFrom, p_date_to: dateTo,
      });
      if (requestError) {
        setError(requestError.message);
        return;
      }
      setReport(data as Report);
    } catch {
      setError('Le contrôle n’a pas abouti. Relancez-le sur la période.');
    } finally {
      setLoading(false);
    }
  };

  const bookRows = report && [
    { label: 'Journal', debit: report.journal.debit, credit: report.journal.credit, detail: `Écritures validées · ${count(report.journal.entries)}` },
    { label: 'Grand livre', debit: report.accounts.ledger_debit, credit: report.accounts.ledger_credit, detail: `Lignes · ${count(report.accounts.lines)}` },
    { label: 'Balance générale', debit: report.accounts.balance_debit, credit: report.accounts.balance_credit },
  ];

  return (
    <div className="space-y-5">
      <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void check(); }}>
        <label className="min-w-0 flex-1 text-xs text-neutral-600 sm:flex-none">
          Du
          <input type="date" className="input mt-1" value={dateFrom} max={dateTo} required disabled={loading}
            onChange={event => { setDateFrom(event.target.value); setReport(null); setError(''); }} />
        </label>
        <label className="min-w-0 flex-1 text-xs text-neutral-600 sm:flex-none">
          Au
          <input type="date" className="input mt-1" value={dateTo} min={dateFrom} required disabled={loading}
            onChange={event => { setDateTo(event.target.value); setReport(null); setError(''); }} />
        </label>
        <button type="submit" className="btn-primary" disabled={loading || !dateFrom || !dateTo || dateFrom > dateTo}>
          {loading ? 'Contrôle en cours…' : 'Contrôler la période'}
        </button>
      </form>
      {loading && <p role="status" className="text-sm text-neutral-600">Lecture du journal et des mouvements de la période.</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {report && bookRows && (
        <>
          <p role="status" className="text-sm text-neutral-600">Du {dateLabel(report.from)} au {dateLabel(report.to)} · Contrôle en lecture seule</p>
          <section className="space-y-2" aria-label="Vérification du journal et des comptes">
            <h2 className="text-sm font-semibold text-neutral-900">Écritures et comptes</h2>
            <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
              {bookRows.map(row => (
                <li key={row.label} className="py-2">
                  <dl className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 text-sm sm:gap-x-6">
                    <div className="min-w-0 break-words"><dt className="font-medium">{row.label}</dt>
                      {row.detail && <dd className="text-xs text-neutral-600">{row.detail}</dd>}
                    </div>
                    <Amounts debit={row.debit} credit={row.credit} />
                  </dl>
                </li>
              ))}
            </ul>
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
              <span>Écritures incohérentes · {count(report.journal.inconsistent_entries)}</span>
              <span>Sources avec plusieurs écritures · {count(report.journal.duplicate_sources)}</span>
              <span>Comptes avec un écart · {count(report.accounts.inconsistent_accounts)}</span>
            </p>
            {report.journal_examples.length > 0 && <p className="break-words text-xs">Pièces relevées · {report.journal_examples.join(', ')}</p>}
            {report.account_examples.length > 0 && <p className="break-words text-xs">Comptes relevés · {report.account_examples.join(', ')}</p>}
          </section>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-neutral-900">Mouvements à rapprocher</h2>
            <p className="text-xs text-neutral-600">Un mouvement sans lien enregistré peut déjà avoir une écriture à rapprocher.</p>
            {report.coverage.map(row => <Operations key={row.family} data={row}
              issues={report.issues.filter(issue => issue.family === row.family)} />)}
          </section>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-neutral-900">Comptes de tiers</h2>
            {report.third_parties.map(row => (
              <section key={row.family} className="space-y-1 border-t border-neutral-200 py-2">
                <h3 className="text-sm font-medium">{row.family === 'client' ? 'Clients' : 'Fournisseurs'}</h3>
                {row.configured ? (
                  <>
                    <p className="text-xs text-neutral-600">Lignes sans tiers correspondant · {count(row.unassigned_lines)}</p>
                    <dl className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 text-sm sm:gap-x-6">
                      <dt>Écart grand livre / balance des tiers</dt>
                      <Amounts debit={row.ledger_debit - row.balance_debit} credit={row.ledger_credit - row.balance_credit} />
                    </dl>
                  </>
                ) : <p className="text-xs text-neutral-600">Compte collectif à paramétrer.</p>}
              </section>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
