import {useAccountingWindowId,mayCloseAccountingWindow} from '../context/AccountingWindowContext';
import { useEffect, useRef, useState } from 'react';
import {AccountingTable,AccountingPagination,useAccountingPagination} from './AccountingWorkspace';
import {Check,Lock,Search} from './Icons';
import { formatDate, formatDateTime, formatNumber } from '../lib/format';
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
type ClosedMonth = {
  status: 'closed';
  closed_at: string;
  closed_by_name: string | null;
  note: string | null;
  snapshot: { journal: { entries: number; debit: number; credit: number } };
};
type MonthClosure = ClosedMonth | { status: 'in_progress' } | {
  status: 'open';
  blocked: boolean;
  has_observations: boolean;
  review_token: string;
  unposted_entries: number;
};
type Report = {
  from: string; to: string;
  journal: { entries: number; debit: number; credit: number; inconsistent_entries: number; duplicate_sources: number };
  accounts: Compare & { lines: number; inconsistent_accounts: number };
  journal_examples: string[];
  account_examples: string[];
  third_parties: ThirdPartyCheck[];
  coverage: Coverage[];
  issues: Issue[];
  month_closure: MonthClosure | null;
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

function Operations({ data, issues }: { data: Coverage; issues: Issue[] }) {
  const issueCount = data.missing + data.invalid + data.date_differences;
  const paging=useAccountingPagination(issues,data.family);
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
          <AccountingTable footer={<AccountingPagination {...paging}/>}><table><thead><tr><th className="text-left">Référence / date</th><th className="text-left">Écart</th><th className="text-right">Montant (FCFA)</th></tr></thead><tbody>{paging.rows.map(issue=><tr key={issue.id}><td>{issue.reference}<span className="block text-[11px] text-neutral-500">{dateLabel(issue.operation_date)}</span></td><td>{ISSUE_LABELS[issue.issue]}{issue.issue==='date'&&issue.entry_date&&<span className="block text-[11px]">Journal : {dateLabel(issue.entry_date)}</span>}</td><td className="text-right">{count(issue.amount)}</td></tr>)}</tbody></table></AccountingTable>
        </details>
      )}
    </section>
  );
}

function MonthClosing({ tenantId, report, canClose, onClosed, onPendingChange }: {
  tenantId: string; report: Report; canClose: boolean;
  onClosed: (receipt: ClosedMonth) => void; onPendingChange: (pending: boolean) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const month = report.month_closure;
  const lock=useRef(false);
 const windowId=useAccountingWindowId();
 useEffect(()=>{const guard=(event:Event)=>{if(!mayCloseAccountingWindow(event,windowId)||event.defaultPrevented)return;if(lock.current||(confirming)&&!window.confirm("Une clôture mensuelle est en préparation. Fermer ?"))event.preventDefault();};window.addEventListener('waarwi:accounting-before-navigate',guard);return()=>window.removeEventListener('waarwi:accounting-before-navigate',guard);},[windowId,confirming]);

  const close = async () => {
    if (month?.status !== 'open' || !canClose || month.blocked
        || submitting || lock.current || (month.has_observations && !note.trim())) return;
    lock.current=true;
    setSubmitting(true);
    onPendingChange(true);
    setError('');
    try {
      const { data, error: rpcError } = await supabase.rpc('close_accounting_month', {
        p_tenant_id: tenantId, p_month_start: report.from,
        p_review_token: month.review_token, p_note: note.trim() || null,
      });
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      onClosed(data as ClosedMonth);
    } catch {
      setError('La clôture n’a pas été confirmée. Contrôlez à nouveau la période.');
    } finally {
      lock.current=false;
      setSubmitting(false);
      onPendingChange(false);
    }
  };

  if (!month || month.status === 'in_progress') {
    return canClose ? <p className="text-sm text-neutral-600">Sélectionnez un mois civil terminé pour le clôturer.</p> : null;
  }
  if (month.status === 'closed') {
    return (
      <section className="space-y-1 border-y border-neutral-200 py-3">
        <h2 className="text-sm font-semibold flex items-center gap-2"><Lock size={16}/>Mois clôturé</h2>
        <p className="text-xs text-neutral-600">
          {formatDateTime(month.closed_at)}{month.closed_by_name && ` · ${month.closed_by_name}`}
        </p>
        <p className="text-xs text-neutral-600">Écritures validées à la clôture · {count(month.snapshot.journal.entries)}</p>
        {month.note && <p className="whitespace-pre-wrap break-words text-sm">{month.note}</p>}
      </section>
    );
  }
  return (
    <section className="space-y-2 border-y border-neutral-200 py-3">
      <h2 className="text-sm font-semibold">Clôture mensuelle</h2>
      {month.blocked ? (
        <p className="text-sm text-neutral-700">Corrigez les incohérences du journal et validez les écritures en attente avant la clôture.</p>
      ) : <p className="text-sm text-neutral-600">Mois ouvert</p>}
      {month.unposted_entries > 0 && <p className="text-xs text-neutral-600">Écritures à valider · {count(month.unposted_entries)}</p>}
      {canClose && !month.blocked && (
        confirming ? (
          <>
            <p className="text-sm">La clôture verrouille les écritures du {dateLabel(report.from)} au {dateLabel(report.to)}.</p>
            <label className="block max-w-xl text-xs text-neutral-600">
              {month.has_observations ? 'Note sur les écarts constatés (obligatoire)' : 'Note de clôture (facultative)'}
              <textarea className="input mt-1" rows={2} maxLength={500} value={note} disabled={submitting}
                onChange={event => setNote(event.target.value)} />
            </label>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" disabled={submitting}
                onClick={() => { setConfirming(false); setError(''); }}>Annuler</button>
              <button type="button" className="btn-primary" onClick={() => void close()}
                disabled={submitting || (month.has_observations && !note.trim())}>
                {submitting ? 'Clôture en cours…' : 'Confirmer la clôture'}
              </button>
            </div>
          </>
        ) : <button type="button" className="btn-secondary" onClick={() => setConfirming(true)}><Lock size={16}/>Clôturer le mois</button>
      )}
    </section>
  );
}

export function AccountingPeriodControls({ tenantId, canClose }: { tenantId: string; canClose: boolean }) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const [dateFrom, setDateFrom] = useState(new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10));
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState('');
  const busy = loading || closing;

  const check = async () => {
    if (busy) return;
    setReport(null);
    setLoading(true);
    setError('');
    try {
      const { data, error: requestError } = await supabase.rpc('preview_accounting_closure', {
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
      <form className="acc-toolbar acc-fixed" onSubmit={event => { event.preventDefault(); void check(); }}>
        <label className="min-w-0 flex-1 text-xs text-neutral-600 sm:flex-none">
          Du
          <input type="date" className="input mt-1" value={dateFrom} max={dateTo} required disabled={busy}
            onChange={event => { setDateFrom(event.target.value); setReport(null); setError(''); }} />
        </label>
        <label className="min-w-0 flex-1 text-xs text-neutral-600 sm:flex-none">
          Au
          <input type="date" className="input mt-1" value={dateTo} min={dateFrom} required disabled={busy}
            onChange={event => { setDateTo(event.target.value); setReport(null); setError(''); }} />
        </label>
        <button type="submit" className="btn-primary" disabled={busy || !dateFrom || !dateTo || dateFrom > dateTo}>
          <Search size={16}/>{loading ? 'Contrôle en cours…' : 'Contrôler la période'}
        </button>
      </form>
      {loading && <p role="status" className="text-sm text-neutral-600">Lecture du journal et des mouvements de la période.</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {report && bookRows && (
        <>
          <div className="acc-summary"><div><span>Période contrôlée</span><strong className="text-sm">{dateLabel(report.from)} — {dateLabel(report.to)}</strong></div><div><span>Écritures validées</span><strong>{count(report.journal.entries)}</strong></div><div><span>Écart journal / balance</span><strong>{money(report.journal.debit-report.accounts.balance_debit)} / {money(report.journal.credit-report.accounts.balance_credit)}</strong></div><div><span>Contrôles du journal</span><strong className="flex items-center gap-1">{report.journal.inconsistent_entries+report.journal.duplicate_sources===0?<Check size={15}/>:null}{count(report.journal.inconsistent_entries+report.journal.duplicate_sources)} anomalie(s)</strong></div></div>
          <MonthClosing tenantId={tenantId} report={report} canClose={canClose}
            onPendingChange={setClosing}
            onClosed={receipt => setReport(current => current && ({ ...current, month_closure: receipt }))} />
          <section className="space-y-2" aria-label="Vérification du journal et des comptes">
            <h2 className="text-sm font-semibold text-neutral-900">Écritures et comptes</h2>
            <AccountingTable><table><thead><tr><th className="text-left">Contrôle</th><th className="text-right">Débit (FCFA)</th><th className="text-right">Crédit (FCFA)</th></tr></thead><tbody>{bookRows.map(row=><tr key={row.label}><td><strong>{row.label}</strong>{row.detail&&<span className="block text-[11px] text-neutral-500">{row.detail}</span>}</td><td className="text-right">{count(row.debit)}</td><td className="text-right">{count(row.credit)}</td></tr>)}</tbody></table></AccountingTable>
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
                      <div className="text-right"><dt className="text-xs text-neutral-500">Débit</dt><dd>{money(row.ledger_debit-row.balance_debit)}</dd></div><div className="text-right"><dt className="text-xs text-neutral-500">Crédit</dt><dd>{money(row.ledger_credit-row.balance_credit)}</dd></div>
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
