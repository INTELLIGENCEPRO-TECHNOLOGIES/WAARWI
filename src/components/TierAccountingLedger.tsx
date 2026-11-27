import { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Printer, RotateCcw } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { readAccountingAccountStatement, ACCOUNT_STATEMENT_PAGE_SIZE, type AccountStatement, type AccountStatementLine } from '../lib/accountingAccountStatement';
import { formatDate, formatNumber } from '../lib/format';
import { buildPrintTenant, printCustomerStatementA4 } from '../lib/print';
import { useRealtimeTick } from '../lib/useRealtimeData';
import { PremiumDateRangePicker } from './PremiumDateRangePicker';

type Party = { name: string; account_code?: string | null; phone?: string; address?: string };
type Request = { from: string; to: string; offset: number };
type LoadResult = { request: Request; revision: number; statement?: AccountStatement; error?: string };

const initialRequest = (): Request => {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Dakar' });
  return { from: today.slice(0, 4) + '-01-01', to: today, offset: 0 };
};
const dateLabel = (iso: string) => formatDate(iso + 'T12:00:00');
const amount = (value: number) => formatNumber(Number(value), { maximumFractionDigits: 2 });
const balance = (value: number) => {
  const number = Number(value);
  const direction = number > 0 ? ' débiteur' : number < 0 ? ' créditeur' : '';
  return amount(Math.abs(number)) + ' FCFA' + direction;
};
const origin = (row: AccountStatementLine) => row.source_type === 'manual' ? 'Écriture manuelle' : row.source_type === 'reversal' ? 'Extourne' : '';
const description = (row: AccountStatementLine) => row.label || row.description || '';
const statementTotals = (result: AccountStatement) => [
  result.row_count, result.opening_balance, result.total_debit, result.total_credit, result.closing_balance,
].map(Number).join('|');

export function TierAccountingLedger({ party, kind }: { party: Party; kind: 'client' | 'fournisseur' }) {
  const { tenant } = useApp();
  const tenantId = tenant?.id;
  const accountCode = party.account_code?.trim();
  const [request, setRequest] = useState(initialRequest);
  const [result, setResult] = useState<LoadResult | null>(null);
  const [reload, setReload] = useState(0);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [periodError, setPeriodError] = useState('');
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState('');
  const printJob = useRef<AbortController | null>(null);
  const revision = useRealtimeTick(['journal_entries', 'journal_lines', 'accounting_fiscal_years'], !!tenantId && !!accountCode);
  const current = result?.request === request && result.revision === revision + reload ? result : null;
  const statement = current?.statement;
  const page = request.offset / ACCOUNT_STATEMENT_PAGE_SIZE + 1;
  const pageCount = Math.max(1, Math.ceil(Number(statement?.row_count ?? 0) / ACCOUNT_STATEMENT_PAGE_SIZE));

  useEffect(() => {
    if (!tenantId || !accountCode) return;
    const controller = new AbortController();
    void readAccountingAccountStatement(tenantId, { ...request, code: accountCode }, controller.signal)
      .then(data => {
        if (controller.signal.aborted) return;
        const lastOffset = Math.max(0, Math.ceil(Number(data.row_count) / ACCOUNT_STATEMENT_PAGE_SIZE) - 1) * ACCOUNT_STATEMENT_PAGE_SIZE;
        if (request.offset > lastOffset) {
          setRequest({ ...request, offset: lastOffset });
          return;
        }
        setResult({ request, revision: revision + reload, statement: data });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setResult({ request, revision: revision + reload, error: 'Impossible de charger le compte ' + accountCode + '.' });
        }
      });
    return () => controller.abort();
  }, [tenantId, accountCode, request, revision, reload]);

  useEffect(() => () => printJob.current?.abort(), [request, revision, reload]);

  if (!accountCode) {
    return <p className="py-6 text-sm text-[var(--w-text-muted)]">Le compte comptable de ce tiers n’est pas renseigné.</p>;
  }

  const periodLabel = 'Du ' + dateLabel(request.from) + ' au ' + dateLabel(request.to);
  const applyPeriod = (from: string, to: string) => {
    if (!from || !to || from > to || from.slice(0, 4) !== to.slice(0, 4)) {
      setPeriodError('Sélectionnez une période comprise dans un même exercice.');
      return;
    }
    setPrintError('');
    setRequest({ from, to, offset: 0 });
    setPeriodOpen(false);
  };

  const print = async () => {
    if (!tenant || !statement || printJob.current) return;
    const controller = new AbortController();
    printJob.current = controller;
    setPrinting(true);
    setPrintError('');
    try {
      const rows: AccountStatementLine[] = [];
      const totals = statementTotals(statement);
      for (let offset = 0; offset < Number(statement.row_count); offset += ACCOUNT_STATEMENT_PAGE_SIZE) {
        const part = offset === request.offset ? statement : await readAccountingAccountStatement(
          tenant.id, { ...request, code: accountCode, offset }, controller.signal,
        );
        if (statementTotals(part) !== totals) throw new Error('Les écritures ont changé. Actualisez avant d’imprimer.');
        rows.push(...part.rows);
      }
      if (rows.length !== Number(statement.row_count) || new Set(rows.map(row => row.line_id)).size !== rows.length) {
        throw new Error('Le relevé complet n’a pas pu être chargé. Actualisez avant d’imprimer.');
      }
      if (!controller.signal.aborted) {
        printCustomerStatementA4({
          tenant: buildPrintTenant(tenant),
          customer: { ...party, account_code: accountCode },
          accounting: kind,
          periodLabel,
          openingBalance: Number(statement.opening_balance),
          closingBalance: Number(statement.closing_balance),
          totalDebit: Number(statement.total_debit),
          totalCredit: Number(statement.total_credit),
          rows: rows.map(row => ({
            ts: row.entry_date + 'T12:00:00', piece: row.entry_number,
            label: [origin(row), description(row)].filter(Boolean).join(' │ '),
            debit: Number(row.debit), credit: Number(row.credit),
            running: Number(row.running_balance), affects: true,
          })),
        });
      }
    } catch (error) {
      if (!controller.signal.aborted) setPrintError(error instanceof Error ? error.message : 'Impression indisponible.');
    } finally {
      printJob.current = null;
      setPrinting(false);
    }
  };

  return <section aria-label="Grand livre comptable" className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">Compte {accountCode}</h2>
        <p className="text-xs text-[var(--w-text-muted)]">{periodLabel}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="btn-secondary min-h-10" disabled={printing} onClick={() => { setPeriodError(''); setPeriodOpen(true); }}>
          <Calendar size={15} aria-hidden="true" /> Période
        </button>
        <button type="button" className="btn-secondary min-h-10" disabled={!statement || printing} onClick={() => void print()}>
          <Printer size={15} aria-hidden="true" /> {printing ? 'Préparation…' : 'Imprimer'}
        </button>
      </div>
    </div>
    <PremiumDateRangePicker open={periodOpen} onClose={() => setPeriodOpen(false)} from={request.from} to={request.to}
      onApply={applyPeriod} onReset={() => { const range = initialRequest(); applyPeriod(range.from, range.to); }}
      extraFilters={periodError ? <p role="alert" className="text-xs text-red-700">{periodError}</p> : undefined} />
    {!current && <p role="status" className="py-6 text-sm text-[var(--w-text-muted)]">Chargement du grand livre…</p>}
    {current?.error && <div className="flex flex-wrap items-center gap-2">
      <p role="alert" className="text-sm text-red-700">{current.error}</p>
      <button type="button" className="btn-secondary" onClick={() => setReload(value => value + 1)}><RotateCcw size={15} /> Réessayer</button>
    </div>}
    {printError && <p role="alert" className="text-sm text-red-700">{printError}</p>}
    {statement && <>
      <dl className="grid grid-cols-2 gap-x-2 gap-y-2 border-y border-[var(--w-separator)] py-2 sm:grid-cols-4">
        <div><dt className="text-xs text-[var(--w-text-muted)]">Solde comptable</dt><dd className="num font-semibold">{balance(statement.closing_balance)}</dd></div>
        <div><dt className="text-xs text-[var(--w-text-muted)]">Solde d’ouverture</dt><dd className="num text-sm">{balance(statement.opening_balance)}</dd></div>
        <div><dt className="text-xs text-[var(--w-text-muted)]">Débit période</dt><dd className="num text-sm whitespace-nowrap">{amount(statement.total_debit)} FCFA</dd></div>
        <div><dt className="text-xs text-[var(--w-text-muted)]">Crédit période</dt><dd className="num text-sm whitespace-nowrap">{amount(statement.total_credit)} FCFA</dd></div>
      </dl>
      {statement.opening_mode === 'provisional' && <p className="text-xs text-[var(--w-text-muted)]">Solde d’ouverture provisoire, issu du dernier exercice arrêté et des mouvements suivants.</p>}
      <table className="w-full text-xs">
        <caption className="sr-only">Écritures validées du compte {accountCode}, montants en FCFA</caption>
        <thead className="border-b border-[var(--w-separator)] bg-[var(--w-surface)]">
          <tr>
            <th scope="col" className="py-2 pr-1 text-left">Date / pièce</th>
            <th scope="col" className="hidden px-2 py-2 text-left sm:table-cell">Libellé</th>
            <th scope="col" className="px-1 py-2 text-right">Débit</th>
            <th scope="col" className="pl-1 py-2 text-right">Crédit</th>
            <th scope="col" className="hidden pl-2 py-2 text-right sm:table-cell">Solde</th>
          </tr>
        </thead>
        <tbody>
          {!statement.rows.length && <tr><td colSpan={5} className="py-6 text-center text-[var(--w-text-muted)]">Aucune écriture sur cette période.</td></tr>}
          {statement.rows.map(row => <tr key={row.line_id} className="border-b border-[var(--w-separator)] align-top">
            <td className="py-2 pr-1">
              <div className="hidden sm:block"><strong>{row.entry_number}</strong><span className="block text-[var(--w-text-muted)]">{dateLabel(row.entry_date)}</span></div>
              <details className="group sm:hidden">
                <summary className="list-none cursor-pointer [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center gap-1 font-semibold"><ChevronRight size={12} aria-hidden="true" className="shrink-0 group-open:rotate-90" />{row.entry_number}</span>
                  <span className="block text-[var(--w-text-muted)]">{dateLabel(row.entry_date)}</span>
                </summary>
                <p className="mt-1 break-words">{[origin(row), description(row)].filter(Boolean).join(' │ ')}</p>
                <p className="mt-1">Solde {balance(row.running_balance)}</p>
              </details>
            </td>
            <td className="hidden px-2 py-2 sm:table-cell">
              {origin(row) && <span className="block font-medium">{origin(row)}</span>}
              <span className="break-words">{description(row)}</span>
            </td>
            <td className="num whitespace-nowrap px-1 py-2 text-right">{Number(row.debit) ? amount(row.debit) : '—'}</td>
            <td className="num whitespace-nowrap pl-1 py-2 text-right">{Number(row.credit) ? amount(row.credit) : '—'}</td>
            <td className="num hidden whitespace-nowrap pl-2 py-2 text-right sm:table-cell">{balance(row.running_balance)}</td>
          </tr>)}
        </tbody>
      </table>
      {pageCount > 1 && <nav aria-label="Pages du grand livre" className="flex items-center justify-between gap-2 text-xs">
        <button type="button" aria-label="Page précédente" className="btn-secondary h-10 w-10 p-0" disabled={printing || page === 1}
          onClick={() => setRequest(previous => ({ ...previous, offset: previous.offset - ACCOUNT_STATEMENT_PAGE_SIZE }))}><ChevronLeft size={16} /></button>
        <span>{statement.row_count} lignes │ Page {page} de {pageCount}</span>
        <button type="button" aria-label="Page suivante" className="btn-secondary h-10 w-10 p-0" disabled={printing || page >= pageCount}
          onClick={() => setRequest(previous => ({ ...previous, offset: previous.offset + ACCOUNT_STATEMENT_PAGE_SIZE }))}><ChevronRight size={16} /></button>
      </nav>}
    </>}
  </section>;
}
