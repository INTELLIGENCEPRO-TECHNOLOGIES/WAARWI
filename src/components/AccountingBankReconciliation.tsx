import { useEffect, useId, useRef, useState } from 'react';
import { mayCloseAccountingWindow, useAccountingWindowId, useAccountingWork } from '../context/AccountingWindowContext';
import { bankMinor } from '../lib/bankStatementImport.mjs';
import { formatDate } from '../lib/format';
import { supabase } from '../lib/supabase';
import { AccountingBankImport } from './AccountingBankImport';
import { AccountingPagination, AccountingTable, useAccountingPagination } from './AccountingWorkspace';
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Plus, RefreshCw, Search } from './Icons';
import { Modal } from './Modal';
import './accounting-bank-reconciliation.css';

type Account = { code: string; name: string; is_active: boolean };
type Statement = {
  id: string;
  reference: string;
  account_code: string;
  date_from: string;
  date_to: string;
  opening_balance: number;
  closing_balance: number;
  status: 'draft' | 'final' | 'cancelled';
  final_snapshot?: { book_balance: number; unpointed_amount: number; difference: number; book_pending_count: number };
  cancel_reason?: string;
};
type BankLine = { id: string; operation_date: string; reference: string; label: string; amount: number; journal_line_id: string | null; matched_piece?: string };
type BookLine = { id: string; entry_date: string; entry_number: string; label: string; reference: string; amount: number };
type Report = {
  statement: Statement;
  book_balance: number;
  unpointed_amount: number;
  adjusted_book: number;
  difference: number;
  opening_drift: number;
  bank_pending_count: number;
  book_pending_count: number;
  bank_rows: BankLine[];
  book_rows: BookLine[];
};
type Proposal = {
  bank_id: string;
  book_id: string;
  entry_id: string;
  entry_number: string;
  entry_date: string;
  operation_date: string;
  bank_label: string;
  book_label: string;
  amount: number;
  ref_equal: boolean;
};
type Suggestions = { rows: Proposal[]; pending: number; suggested: number; ambiguous: number };
type DraftLine = { date: string; reference: string; label: string; amount: string };
type Phase = 'statements' | 'pointing' | 'review';
type PointingMode = 'manual' | 'suggestions';
type Confirmation = 'finish' | 'cancel' | 'batch';
type MissingOperation = { id: string; label: string; amount: number; counter: string; reason: string };

const PHASES: { key: Phase; label: string }[] = [
  { key: 'statements', label: 'Relevés' },
  { key: 'pointing', label: 'Pointage' },
  { key: 'review', label: 'Contrôle' },
];
const HELP = { statements: 'rapprochement-releves', pointing: 'rapprochement-pointage', review: 'rapprochement-controle' };
const STATUS = { draft: 'En cours', final: 'Validé', cancelled: 'Annulé' };
const CONFIRMATION_TITLES = { finish: 'Valider le rapprochement', cancel: 'Annuler le relevé', batch: 'Confirmer les pointages' };
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Dakar' });
const amountFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const amount = (n: number) => amountFormat.format(Number(n));
const money = (n: number) => amount(n) + ' FCFA';
const message = (e: unknown) => e && typeof e === 'object' && 'message' in e ? String(e.message) : 'Opération impossible.';

function nextDay(date: string) {
  const day = new Date(date + 'T00:00:00Z');
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

function StatementStatus({ status }: { status: Statement['status'] }) {
  return <span className="acc-bank-status" data-status={status}>{STATUS[status]}</span>;
}

export function AccountingBankReconciliation({ tenantId, canManage }: { tenantId: string; canManage: boolean }) {
  const work = useAccountingWork();
  const windowId = useAccountingWindowId();
  const inputId = useId();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [account, setAccount] = useState('');
  const [statements, setStatements] = useState<Statement[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [selected, setSelected] = useState('');
  const [phase, setPhase] = useState<Phase>('statements');
  const [mode, setMode] = useState<PointingMode>('manual');
  const [mobilePanel, setMobilePanel] = useState<'bank' | 'book'>('bank');
  const [bankFilter, setBankFilter] = useState<'all' | 'pending'>('all');
  const [report, setReport] = useState<Report | null>(null);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState('');
  const [from, setFrom] = useState(() => today().slice(0, 7) + '-01');
  const [to, setTo] = useState(today);
  const [opening, setOpening] = useState('');
  const [closing, setClosing] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [bankLine, setBankLine] = useState('');
  const [bookLine, setBookLine] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [reason, setReason] = useState('');
  const [importing, setImporting] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [proposalIds, setProposalIds] = useState<string[]>([]);
  const [missing, setMissing] = useState<MissingOperation | null>(null);
  const [counterAccounts, setCounterAccounts] = useState<Account[]>([]);
  const [counterBusy, setCounterBusy] = useState(false);
  const lock = useRef(false);

  const busyOrLoading = busy || loading;
  const hasWork = open || !!confirmation || !!missing || proposalIds.length > 0;
  const discard = () => !lock.current && !importing && (!hasWork || window.confirm('Quitter les travaux en cours ?'));
  const proposalPaging = useAccountingPagination(suggestions?.rows ?? [], selected + revision);
  const draftPaging = useAccountingPagination(lines, String(open));
  const bankRows = report?.bank_rows ?? [];
  const bankPaging = useAccountingPagination(bankFilter === 'pending' ? bankRows.filter(line => !line.journal_line_id) : bankRows, selected + bankFilter);
  const statementPaging = useAccountingPagination(statements, account);

  useEffect(() => {
    const guard = (event: Event) => {
      if (!mayCloseAccountingWindow(event, windowId) || event.defaultPrevented) return;
      if (lock.current || importing || (hasWork && !window.confirm('Un relevé ou une validation est en cours. Quitter cet écran ?'))) {
        event.preventDefault();
      }
    };
    window.addEventListener('waarwi:accounting-before-navigate', guard);
    return () => window.removeEventListener('waarwi:accounting-before-navigate', guard);
  }, [hasWork, windowId, importing]);

  useEffect(() => {
    let live = true;
    setAccounts([]);
    setAccount('');
    setSelected('');
    setListLoading(true);
    void (async () => {
      try {
        const { data, error: failure } = await supabase.from('accounts').select('code,name,is_active')
          .eq('tenant_id', tenantId).eq('class', 5).or('code.like.52%,code.like.53%,code.like.55%').order('code').limit(500);
        if (failure) throw failure;
        if (!live) return;
        const choices = (data ?? []) as Account[];
        setAccounts(choices);
        setAccount((choices.find(choice => choice.is_active) ?? choices[0])?.code ?? '');
      } catch (failure) {
        if (live) setError(message(failure));
      } finally {
        if (live) setListLoading(false);
      }
    })();
    return () => { live = false; };
  }, [tenantId]);

  useEffect(() => {
    if (!account) {
      setStatements([]);
      setListLoading(false);
      return;
    }
    let live = true;
    setListLoading(true);
    void (async () => {
      try {
        const all: Statement[] = [];
        for (let start = 0; ; start += 200) {
          const { data, error: failure } = await supabase.from('accounting_bank_statements').select('*')
            .eq('tenant_id', tenantId).eq('account_code', account).order('date_to', { ascending: false }).order('id').range(start, start + 199);
          if (failure) throw failure;
          if (!live) return;
          all.push(...((data ?? []) as Statement[]));
          if ((data ?? []).length < 200) break;
        }
        setStatements(all);
      } catch (failure) {
        if (live) setError(message(failure));
      } finally {
        if (live) setListLoading(false);
      }
    })();
    return () => { live = false; };
  }, [tenantId, account, revision]);

  useEffect(() => {
    if (!selected) {
      setReport(null);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    void (async () => {
      try {
        const { data, error: failure } = await supabase.rpc('bank_statement_report', {
          p_tenant_id: tenantId, p_statement_id: selected, p_offset: offset,
        });
        if (failure) throw failure;
        if (!live) return;
        const nextReport = data as Report;
        const lastOffset = Math.max(0, Math.ceil(nextReport.book_pending_count / 50) - 1) * 50;
        if (offset > lastOffset) {
          setOffset(lastOffset);
          return;
        }
        setReport(nextReport);
      } catch (failure) {
        if (live) {
          setReport(null);
          setError(message(failure));
        }
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [tenantId, selected, offset, revision, work?.revision]);

  const missingId = missing?.id;
  const counterClass = missing && missing.amount < 0 ? 6 : 7;
  useEffect(() => {
    if (!missingId) return;
    let live = true;
    setCounterBusy(true);
    setCounterAccounts([]);
    void (async () => {
      try {
        const list: Account[] = [];
        for (let start = 0; ; start += 200) {
          const { data, error: failure } = await supabase.from('accounts').select('code,name,is_active')
            .eq('tenant_id', tenantId).eq('is_active', true).eq('account_type', 'general').eq('class', counterClass)
            .order('code').range(start, start + 199);
          if (failure) throw failure;
          if (!live) return;
          list.push(...(data ?? []));
          if ((data ?? []).length < 200) break;
        }
        setCounterAccounts(list);
      } catch (failure) {
        if (live) setError(message(failure));
      } finally {
        if (live) setCounterBusy(false);
      }
    })();
    return () => { live = false; };
  }, [tenantId, missingId, counterClass]);

  const current = accounts.find(choice => choice.code === account);
  const last = statements.find(statement => statement.status === 'final');
  const draft = statements.find(statement => statement.status === 'draft');
  const chosen = report?.statement ?? statements.find(statement => statement.id === selected);
  const bankChoice = bankRows.find(line => line.id === bankLine);
  const bookChoice = report?.book_rows.find(line => line.id === bookLine);
  const editable = canManage && report?.statement.status === 'draft';
  const matches = !!bankChoice && !!bookChoice && !bankChoice.journal_line_id && Number(bankChoice.amount) === Number(bookChoice.amount);
  const sameAmountOnPage = bankChoice && report?.book_rows.some(line => Number(line.amount) === Number(bankChoice.amount));
  const bankComplete = report?.bank_pending_count === 0;
  const differenceIsZero = Number(report?.difference) === 0;
  const openingIsStable = Number(report?.opening_drift) === 0;
  const canFinish = bankComplete && differenceIsZero && openingIsStable;
  const snapshot = report?.statement.final_snapshot;
  const snapshotChanged = snapshot && report && (
    Number(snapshot.book_balance) !== Number(report.book_balance)
    || Number(snapshot.unpointed_amount) !== Number(report.unpointed_amount)
    || Number(snapshot.book_pending_count) !== Number(report.book_pending_count)
  );

  const resetMatching = () => {
    setSuggestions(null);
    setProposalIds([]);
    setBankLine('');
    setBookLine('');
    setMissing(null);
    setConfirmation(null);
    setMobilePanel('bank');
  };

  const choose = (id: string, nextPhase: Phase = 'statements') => {
    if (id !== selected) setReport(null);
    setSelected(id);
    setPhase(nextPhase);
    setOpen(false);
    setOffset(0);
    setMode('manual');
    setBankFilter('all');
    resetMatching();
    setError('');
    setNotice('');
  };

  const create = () => {
    if (!discard() || !current?.is_active || draft || listLoading) return;
    choose('');
    setReference('');
    setLines([]);
    setOpening(last ? String(last.closing_balance) : '');
    setClosing('');
    setFrom(last ? nextDay(last.date_to) : today().slice(0, 7) + '-01');
    setTo(today());
    setOpen(true);
  };

  const run = async (action: () => Promise<void>) => {
    if (lock.current || !canManage) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setRevision(value => value + 1);
    } catch (failure) {
      setError(message(failure));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const save = () => {
    if (importing || !current?.is_active || draft || listLoading) return;
    void run(async () => {
      if (!reference.trim() || !from || !to || from > to) throw Error('Indiquez la référence du relevé et vérifiez la période.');
      const openingMinor = bankMinor(opening);
      const closingMinor = bankMinor(closing);
      let calculated = BigInt(openingMinor);
      const rows = lines.map((line, index) => {
        if (!line.label.trim() || !line.date || line.date < from || line.date > to) {
          throw Error('Vérifiez la date et le libellé de l’opération ' + (index + 1) + '.');
        }
        const value = bankMinor(line.amount);
        if (!value) throw Error('Indiquez un montant non nul à l’opération ' + (index + 1) + '.');
        calculated += BigInt(value);
        return { ...line, amount: value / 100 };
      });
      if (calculated !== BigInt(closingMinor)) throw Error('Le solde initial augmenté des mouvements doit correspondre au solde final.');
      const { data, error: failure } = await supabase.rpc('create_bank_statement', {
        p_tenant_id: tenantId, p_account_code: account, p_reference: reference.trim(), p_from: from, p_to: to,
        p_opening: openingMinor / 100, p_closing: closingMinor / 100, p_rows: rows,
      });
      if (failure) throw failure;
      if (!data?.success || !data.id) throw Error('Création non confirmée.');
      choose(data.id, 'pointing');
      setNotice('Relevé enregistré. Vous pouvez commencer le pointage.');
    });
  };

  const point = (bankId: string, bookId: string | null) => {
    if (!editable || loading) return;
    void run(async () => {
      const { data, error: failure } = await supabase.rpc('point_bank_statement_line', {
        p_tenant_id: tenantId, p_statement_id: selected, p_bank_line_id: bankId, p_journal_line_id: bookId,
      });
      if (failure) throw failure;
      if (!data?.success) throw Error('Pointage non confirmé.');
      resetMatching();
      setOffset(0);
      setNotice(bookId ? 'Opérations pointées.' : 'Pointage annulé.');
    });
  };

  const analyze = async () => {
    if (lock.current || loading || !editable) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { data, error: failure } = await supabase.rpc('bank_pointing_suggestions', { p_tenant_id: tenantId, p_statement_id: selected });
      if (failure) throw failure;
      setSuggestions(data as Suggestions);
      setProposalIds([]);
      proposalPaging.setPage(0);
    } catch (failure) {
      setError(message(failure));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const batch = () => {
    if (!editable || !suggestions || !proposalIds.length || loading) return;
    const pairs = suggestions.rows.filter(row => proposalIds.includes(row.bank_id)).map(row => ({ bank_id: row.bank_id, book_id: row.book_id }));
    void run(async () => {
      const { data, error: failure } = await supabase.rpc('confirm_bank_pointing_batch', { p_tenant_id: tenantId, p_statement_id: selected, p_pairs: pairs });
      if (failure) throw failure;
      if (!data?.success) throw Error('Pointage non confirmé.');
      resetMatching();
      setNotice(data.count + ' opération(s) pointée(s).');
      setOffset(0);
      work?.refresh();
    });
  };

  const postMissing = () => {
    if (!editable || !missing?.counter || !missing.reason.trim() || loading) return;
    void run(async () => {
      const { data, error: failure } = await supabase.rpc('post_missing_bank_operation', {
        p_tenant_id: tenantId, p_statement_id: selected, p_bank_line_id: missing.id, p_counter_account: missing.counter,
        p_expected_amount: missing.amount, p_reason: missing.reason.trim(),
      });
      if (failure) throw failure;
      if (!data?.success) throw Error('Comptabilisation non confirmée.');
      resetMatching();
      setNotice('Pièce ' + data.piece_number + ' créée et pointée.');
      setOffset(0);
      work?.refresh();
    });
  };

  const finish = () => {
    if (!editable || !confirmation || confirmation === 'batch' || loading) return;
    const cancelling = confirmation === 'cancel';
    if (cancelling ? !reason.trim() : !canFinish) return;
    void run(async () => {
      const { data, error: failure } = await supabase.rpc('finish_bank_statement', {
        p_tenant_id: tenantId, p_statement_id: selected, p_cancel_reason: cancelling ? reason.trim() : null,
      });
      if (failure) throw failure;
      if (!data?.success) throw Error('Opération non confirmée.');
      resetMatching();
      setReason('');
      setNotice(cancelling ? 'Relevé annulé.' : 'Rapprochement validé.');
    });
  };

  const go = (destination: Phase) => {
    if (destination === phase || busy || importing) return;
    if (open) return;
    setPhase(destination);
  };

  const refresh = () => {
    if (!discard()) return;
    setError('');
    setNotice('');
    resetMatching();
    setRevision(value => value + 1);
  };

  const changeLine = (index: number, field: keyof DraftLine, value: string) => {
    setLines(previous => previous.map((line, position) => position === index ? { ...line, [field]: value } : line));
  };

  let predicted = '—';
  let indicatedMatches = false;
  try {
    const sum = lines.reduce((total, line) => total + BigInt(bankMinor(line.amount)), BigInt(bankMinor(opening)));
    predicted = money(Number(sum) / 100);
    indicatedMatches = closing.trim() !== '' && BigInt(bankMinor(closing)) === sum;
  } catch {
    // The amount is pending while one of the fields is incomplete.
  }

  const validationChecks = report ? [
    { label: 'Opérations du relevé restant à pointer', value: String(report.bank_pending_count), ok: bankComplete, action: 'Reprenez le pointage des opérations du relevé.' },
    { label: 'Écart de rapprochement', value: money(report.difference), ok: differenceIsZero, action: 'Comparez le solde final au relevé et vérifiez les écritures du compte.' },
    { label: 'Variation du solde d’ouverture', value: money(report.opening_drift), ok: openingIsStable, action: 'Vérifiez le solde comptable antérieur au premier relevé et les écritures rétroactives.' },
  ] : [];

  return (
    <section className="acc-bank-workspace acc-fill" aria-label="Rapprochement bancaire">
      <nav className="acc-bank-phases" aria-label="Étapes du rapprochement">
        {PHASES.map(step => (
          <button key={step.key} type="button" aria-current={phase === step.key ? 'step' : undefined}
            disabled={busy || importing || open || (step.key !== 'statements' && !selected)} onClick={() => go(step.key)}>{step.label}</button>
        ))}
        <a className="acc-bank-help" aria-label="Consulter le guide" href={'/guides/guide-comptabilite-waarwi.html#' + HELP[phase]} target="_blank" rel="noopener">
          <span className="acc-bank-full-label">Consulter le guide</span><span className="acc-bank-short-label">Guide</span>
        </a>
      </nav>

      {phase === 'statements' && !open && (
        <div className="acc-bank-screen acc-fill">
          <div className="acc-bank-toolbar">
            <label className="acc-bank-account">Compte bancaire ou de monnaie électronique
              <select className="input" value={account} disabled={busy || importing} onChange={event => {
                if (!discard()) return;
                setAccount(event.target.value);
                setStatements([]);
                choose('');
              }}>
                <option value="">Choisir un compte</option>
                {accounts.map(choice => <option key={choice.code} value={choice.code}>{choice.code} — {choice.name}{choice.is_active ? '' : ' (inactif)'}</option>)}
              </select>
            </label>
            <div className="acc-bank-actions">
              {draft && <button type="button" className="btn-primary" disabled={busy || listLoading} onClick={() => {
                if (discard()) choose(draft.id, 'pointing');
              }}>Reprendre le relevé<ArrowRight size={15} /></button>}
              {canManage && !draft && <button type="button" className="btn-primary" disabled={busy || listLoading || !current?.is_active} onClick={create}>
                <Plus size={15} />Nouveau relevé
              </button>}
              <button type="button" className="acc-icon" aria-label="Actualiser les relevés" title="Actualiser les relevés" disabled={busy || listLoading || !account} onClick={refresh}><RefreshCw size={16} /></button>
            </div>
          </div>
          {notice && <p role="status" className="acc-bank-message">{notice}</p>}
          {error && <p role="alert" className="acc-bank-message" data-tone="error">{error}</p>}
          <AccountingTable fill label="Relevés du compte" footer={<AccountingPagination {...statementPaging} disabled={busy || listLoading} />}>
            <table>
              <thead><tr><th>Relevé</th><th>Statut</th><th className="text-right">Solde final</th></tr></thead>
              <tbody>
                {statementPaging.rows.map(statement => (
                  <tr key={statement.id} data-selected={selected === statement.id}>
                    <td><button className="acc-table-link" type="button" disabled={busy || listLoading} onClick={() => {
                      if (discard()) choose(statement.id, statement.status === 'draft' ? 'pointing' : 'review');
                    }}>{statement.reference}</button>
                    <span className="acc-table-meta">{formatDate(statement.date_from)} au {formatDate(statement.date_to)}</span></td>
                    <td><StatementStatus status={statement.status} /></td>
                    <td className="text-right acc-bank-amount">{money(statement.closing_balance)}</td>
                  </tr>
                ))}
                {!statementPaging.total && <tr><td colSpan={3} className="acc-table-empty">{listLoading ? 'Chargement des relevés…' : account ? 'Aucun relevé pour ce compte.' : 'Choisissez un compte pour afficher ses relevés.'}</td></tr>}
              </tbody>
            </table>
          </AccountingTable>
        </div>
      )}

      {open && (
        <form className="acc-bank-screen acc-fill" onSubmit={event => { event.preventDefault(); save(); }}>
          <div className="acc-bank-toolbar">
            <h2>Nouveau relevé{account ? ' · ' + account : ''}</h2>
            <button type="button" className="btn-secondary" disabled={busy || importing} onClick={() => { if (discard()) setOpen(false); }}>
              <ArrowLeft size={15} />Retour aux relevés
            </button>
          </div>
          <div className="acc-bank-form-body">
            <div className="acc-bank-fieldset">
              <h3>Informations du relevé</h3>
              <p className="acc-bank-hint">{last ? 'La période commence le lendemain du dernier relevé validé avec son solde de clôture.' : 'Pour le premier relevé, choisissez une date de début précédée d’un solde bancaire et comptable identique.'}</p>
              <label className="acc-bank-field">Référence du relevé
                <input className="input" required maxLength={120} value={reference} disabled={busy} onChange={event => setReference(event.target.value)} />
              </label>
              <div className="acc-bank-form-grid">
                <label className="acc-bank-field">Du<input className="input" type="date" required value={from} max={today()} disabled={busy || !!last} onChange={event => setFrom(event.target.value)} /></label>
                <label className="acc-bank-field">Au<input className="input" type="date" required value={to} min={from} max={today()} disabled={busy} onChange={event => setTo(event.target.value)} /></label>
                <label className="acc-bank-field">Solde initial<input className="input" inputMode="decimal" required value={opening} disabled={busy || !!last} onChange={event => setOpening(event.target.value)} /></label>
                <label className="acc-bank-field">Solde final indiqué<input className="input" inputMode="decimal" required value={closing} disabled={busy} onChange={event => setClosing(event.target.value)} /></label>
              </div>
            </div>
            <div className="acc-bank-fieldset">
              <h3>Opérations du relevé</h3>
              <p className="acc-bank-hint">Importez le fichier ou saisissez les opérations. Du point de vue de l’entreprise, les encaissements sont positifs et les décaissements sont négatifs.</p>
              <AccountingBankImport disabled={busy} hasRows={lines.length > 0} onImport={rows => { setLines(rows); draftPaging.setPage(0); }} onBusy={setImporting} />
              {draftPaging.rows.map((line, pageIndex) => {
                const index = draftPaging.page * draftPaging.size + pageIndex;
                return <div key={index} className="acc-bank-draft-row">
                  <label className="acc-bank-field">Date<input className="input" type="date" required min={from} max={to} value={line.date} disabled={busy} onChange={event => changeLine(index, 'date', event.target.value)} /></label>
                  <label className="acc-bank-field">Référence<input className="input" value={line.reference} maxLength={120} disabled={busy} onChange={event => changeLine(index, 'reference', event.target.value)} /></label>
                  <label className="acc-bank-field">Libellé<input className="input" required value={line.label} maxLength={500} disabled={busy} onChange={event => changeLine(index, 'label', event.target.value)} /></label>
                  <label className="acc-bank-field">Montant signé<input className="input" inputMode="decimal" required value={line.amount} disabled={busy} onChange={event => changeLine(index, 'amount', event.target.value)} /></label>
                  <button className="btn-secondary" type="button" disabled={busy} onClick={() => setLines(previous => previous.filter((_, position) => position !== index))}>Retirer</button>
                </div>;
              })}
              {lines.length > 0 && <AccountingPagination {...draftPaging} disabled={busy || importing} />}
              <button type="button" className="btn-secondary" disabled={busy || importing || lines.length >= 500} onClick={() => {
                setLines(previous => [...previous, { date: to, reference: '', label: '', amount: '' }]);
                draftPaging.setPage(Math.floor(lines.length / draftPaging.size));
              }}><Plus size={15} />Ajouter une opération</button>
            </div>
          </div>
          {error && <p role="alert" className="acc-bank-message" data-tone="error">{error}</p>}
          <footer className="acc-bank-footer">
            <p>Solde final calculé <strong>{predicted}</strong>{indicatedMatches && <Check size={15} aria-label="Concorde avec le relevé" />}</p>
            <button type="submit" className="btn-primary" disabled={busy || importing || listLoading}>Enregistrer le relevé</button>
          </footer>
        </form>
      )}

      {phase !== 'statements' && chosen && (
        <div className="acc-bank-context">
          <div>
            <h2>{chosen.reference}</h2>
            <span className="acc-table-meta">{chosen.account_code} · {formatDate(chosen.date_from)} au {formatDate(chosen.date_to)}</span>
          </div>
          <StatementStatus status={chosen.status} />
          <button type="button" className="acc-icon" aria-label="Actualiser le rapprochement" title="Actualiser le rapprochement" disabled={busyOrLoading} onClick={refresh}>
            <RefreshCw size={16} />
          </button>
        </div>
      )}
      {phase !== 'statements' && notice && <p role="status" className="acc-bank-message">{notice}</p>}
      {phase !== 'statements' && error && !confirmation && !missing && <p role="alert" className="acc-bank-message" data-tone="error">{error}</p>}
      {phase !== 'statements' && loading && <p role="status" className="acc-bank-message">Chargement du rapprochement…</p>}

      {phase === 'pointing' && report && (
        <div className="acc-bank-screen acc-fill">
          {editable ? (
            <div className="acc-bank-toolbar acc-bank-point-toolbar">
              <div className="acc-bank-switch" role="group" aria-label="Mode de pointage">
                <button type="button" aria-pressed={mode === 'manual'} disabled={busy} onClick={() => setMode('manual')}>Manuel</button>
                <button type="button" aria-pressed={mode === 'suggestions'} disabled={busy} onClick={() => setMode('suggestions')}>Suggestions</button>
              </div>
              <p className="acc-bank-hint"><strong>{report.bank_pending_count}</strong> sur {bankRows.length} à pointer</p>
            </div>
          ) : <p className="acc-bank-hint acc-bank-guidance">Consultez les opérations et leurs pointages. {report.statement.status === 'draft' && 'Vous disposez d’un accès en lecture seule.'}</p>}

          {editable && mode === 'suggestions' ? (
            <>
              <div className="acc-bank-toolbar">
                <div className="acc-bank-guidance">
                  <h3>Correspondances proposées</h3>
                  <p className="acc-bank-hint">{suggestions
                    ? suggestions.suggested + ' unique(s) · ' + suggestions.ambiguous + ' ambiguë(s) · ' + Math.max(0, suggestions.pending - suggestions.suggested - suggestions.ambiguous) + ' sans proposition.'
                    : 'Le montant et le sens doivent être identiques. Waarwi propose une même date ou une même référence à sept jours près. Traitez les ambiguïtés en mode manuel.'}
                  </p>
                </div>
                <button type="button" className="btn-secondary" disabled={busyOrLoading || !report.bank_pending_count} onClick={() => void analyze()}>
                  <Search size={15} />Analyser les correspondances
                </button>
              </div>
              <AccountingTable fill label="Propositions de pointage" footer={<AccountingPagination {...proposalPaging} disabled={busyOrLoading} />}>
                <table>
                  <thead><tr><th className="acc-bank-choice"><span className="sr-only">Sélection</span></th><th>Opération bancaire</th><th>Écriture comptable</th><th className="text-right">Montant (FCFA)</th></tr></thead>
                  <tbody>
                    {proposalPaging.rows.map(row => (
                      <tr key={row.bank_id} data-selected={proposalIds.includes(row.bank_id)}>
                        <td><input type="checkbox" aria-label={'Sélectionner la proposition pour ' + row.bank_label} checked={proposalIds.includes(row.bank_id)}
                          disabled={busyOrLoading || (proposalIds.length >= 100 && !proposalIds.includes(row.bank_id))}
                          onChange={() => setProposalIds(previous => previous.includes(row.bank_id) ? previous.filter(id => id !== row.bank_id) : [...previous, row.bank_id])} /></td>
                        <td>{row.bank_label}<span className="acc-table-meta">{formatDate(row.operation_date)}</span></td>
                        <td><button type="button" className="acc-table-link" onClick={() => work?.openPiece({ entryId: row.entry_id, entryNumber: row.entry_number })}>{row.entry_number}</button>
                          <span className="acc-table-meta">{formatDate(row.entry_date)} · {row.book_label}</span>
                          <span className="acc-table-meta">{row.ref_equal ? 'Référence identique' : 'Date identique'}</span></td>
                        <td className="text-right acc-bank-amount">{amount(row.amount)}</td>
                      </tr>
                    ))}
                    {!proposalPaging.total && <tr><td colSpan={4} className="acc-table-empty">{suggestions ? 'Aucune correspondance unique proposée.' : 'Lancez l’analyse pour afficher les propositions.'}</td></tr>}
                  </tbody>
                </table>
              </AccountingTable>
              <footer className="acc-bank-footer">
                <div className="acc-bank-actions">
                  <button type="button" className="btn-secondary" disabled={busyOrLoading || !proposalPaging.total}
                    onClick={() => setProposalIds(suggestions?.rows.slice(0, 100).map(row => row.bank_id) ?? [])}>Sélectionner jusqu’à 100</button>
                  <button type="button" className="acc-bank-link" disabled={busyOrLoading || !proposalIds.length} onClick={() => setProposalIds([])}>Désélectionner</button>
                </div>
                <button type="button" className="btn-primary" disabled={busyOrLoading || !proposalIds.length} onClick={() => {
                  setError('');
                  setConfirmation('batch');
                }}>Pointer la sélection{proposalIds.length ? ' (' + proposalIds.length + ')' : ''}</button>
              </footer>
            </>
          ) : (
            <>
              {editable && <p className="acc-bank-hint acc-bank-guidance">{bankChoice
                ? 'Comparez la date et la référence avant de sélectionner l’écriture.'
                : 'Choisissez une opération, puis son écriture de même montant et de même sens.'}
              </p>}
              <div className="acc-bank-switch acc-bank-mobile-switch" role="group" aria-label="Tableau affiché">
                <button type="button" aria-pressed={mobilePanel === 'bank'} onClick={() => setMobilePanel('bank')}>Relevé</button>
                <button type="button" aria-pressed={mobilePanel === 'book'} onClick={() => setMobilePanel('book')}>Écritures</button>
              </div>
              <div className="acc-bank-pair">
                <section className="acc-bank-table-panel acc-fill" data-mobile-visible={mobilePanel === 'bank'}>
                  <div className="acc-bank-toolbar">
                    <h3>Relevé bancaire</h3>
                    <label className="sr-only" htmlFor={inputId + '-bank-filter'}>Filtrer le relevé bancaire</label>
                    <select id={inputId + '-bank-filter'} className="input" value={bankFilter} disabled={busy} onChange={event => setBankFilter(event.target.value as typeof bankFilter)}>
                      <option value="all">Toutes les opérations</option><option value="pending">À pointer</option>
                    </select>
                  </div>
                  <AccountingTable fill label="Opérations du relevé bancaire" footer={<AccountingPagination {...bankPaging} disabled={busyOrLoading} />}>
                    <table>
                      <thead><tr>{editable && <th className="acc-bank-choice"><span className="sr-only">Sélection</span></th>}<th>Opération</th><th className="text-right">Montant (FCFA)</th><th>Pointage</th></tr></thead>
                      <tbody>
                        {bankPaging.rows.map(row => (
                          <tr key={row.id} data-selected={bankLine === row.id}>
                            {editable && <td>{!row.journal_line_id && <input type="radio" id={inputId + '-bank-' + row.id} name={inputId + '-bank'} aria-label={'Sélectionner l’opération ' + row.label}
                              checked={bankLine === row.id} disabled={busyOrLoading} onChange={() => { setBankLine(row.id); setBookLine(''); }} />}</td>}
                            <td>
                              {editable && !row.journal_line_id ? (
                                <label className="font-medium cursor-pointer" htmlFor={inputId + '-bank-' + row.id}>{row.label}</label>
                              ) : <span className="font-medium">{row.label}</span>}
                              <span className="acc-table-meta">{formatDate(row.operation_date)}{row.reference ? ' · ' + row.reference : ''}</span>
                            </td>
                            <td className="text-right acc-bank-amount">{amount(row.amount)}</td>
                            <td>{row.journal_line_id ? <>
                              <span>Pointée</span>
                              {row.matched_piece && <button type="button" className="acc-table-link acc-bank-inline" onClick={() => work?.openPiece({ entryNumber: row.matched_piece! })}>{row.matched_piece}</button>}
                              {editable && <button type="button" className="acc-bank-link acc-bank-inline" disabled={busyOrLoading} onClick={() => point(row.id, null)}>Dépointer</button>}
                            </> : <span className="acc-bank-hint">À pointer</span>}</td>
                          </tr>
                        ))}
                        {!bankPaging.total && <tr><td colSpan={editable ? 4 : 3} className="acc-table-empty">{bankFilter === 'pending' ? 'Aucune opération à pointer.' : 'Aucune opération sur ce relevé.'}</td></tr>}
                      </tbody>
                    </table>
                  </AccountingTable>
                </section>

                <section className="acc-bank-table-panel acc-fill" data-mobile-visible={mobilePanel === 'book'}>
                  <div className="acc-bank-toolbar">
                    <h3>Écritures non pointées</h3><span className="acc-bank-hint">{report.book_pending_count} en attente</span>
                  </div>
                  <AccountingTable fill label="Écritures comptables non pointées" footer={
                    <nav className="acc-pagination" aria-label="Pagination des écritures comptables">
                      <span>{report.book_rows.length ? offset + 1 : 0}–{offset + report.book_rows.length} sur {report.book_pending_count}</span>
                      <div className="acc-page-buttons">
                        <button type="button" className="acc-icon" aria-label="Page comptable précédente" disabled={busyOrLoading || offset === 0}
                          onClick={() => { setOffset(offset - 50); setBookLine(''); }}><ChevronLeft size={17} /></button>
                        <span>{offset / 50 + 1} / {Math.max(1, Math.ceil(report.book_pending_count / 50))}</span>
                        <button type="button" className="acc-icon" aria-label="Page comptable suivante" disabled={busyOrLoading || offset + 50 >= report.book_pending_count}
                          onClick={() => { setOffset(offset + 50); setBookLine(''); }}><ChevronRight size={17} /></button>
                      </div>
                    </nav>
                  }>
                    <table>
                      <thead><tr>{editable && <th className="acc-bank-choice"><span className="sr-only">Sélection</span></th>}<th>Pièce comptable</th><th className="text-right">Montant (FCFA)</th></tr></thead>
                      <tbody>
                        {report.book_rows.map(row => (
                          <tr key={row.id} data-selected={bookLine === row.id}>
                            {editable && <td><input type="radio" name={inputId + '-book'} aria-label={'Sélectionner l’écriture ' + row.entry_number}
                              checked={bookLine === row.id} disabled={busyOrLoading || !bankChoice || Number(bankChoice.amount) !== Number(row.amount)} onChange={() => setBookLine(row.id)} /></td>}
                            <td><button type="button" className="acc-table-link" onClick={() => work?.openPiece({ entryNumber: row.entry_number })}>{row.entry_number}</button>
                              <span className="acc-table-meta">{formatDate(row.entry_date)}{row.label ? ' · ' + row.label : ''}</span>
                              {row.reference && <span className="acc-table-meta">{row.reference}</span>}</td>
                            <td className="text-right acc-bank-amount">{amount(row.amount)}</td>
                          </tr>
                        ))}
                        {!report.book_rows.length && <tr><td colSpan={editable ? 3 : 2} className="acc-table-empty">Aucune écriture en attente.</td></tr>}
                      </tbody>
                    </table>
                  </AccountingTable>
                </section>
              </div>
              <footer className="acc-bank-footer acc-bank-manual-footer">
                {editable && (
                  <>
                    <div className="acc-bank-selection" aria-live="polite">
                      {bankChoice
                        ? <><strong>{bankChoice.label} · {money(bankChoice.amount)}</strong>
                          <span>{bookChoice ? 'Pièce ' + bookChoice.entry_number + ' sélectionnée.' : sameAmountOnPage ? 'Sélectionnez la pièce correspondante.' : 'Aucun montant identique sur cette page. Consultez la page suivante si elle existe.'}</span></>
                        : <span>Choisissez une opération à pointer.</span>}
                    </div>
                    <div className="acc-bank-actions">
                      {bankChoice && !bankChoice.journal_line_id && <button type="button" className="acc-bank-link" aria-label="Comptabiliser une opération absente" disabled={busyOrLoading}
                        onClick={() => { setError(''); setMissing({ id: bankChoice.id, label: bankChoice.label, amount: Number(bankChoice.amount), counter: '', reason: '' }); }}>
                        <span className="acc-bank-full-label">Comptabiliser une opération absente</span><span className="acc-bank-short-label">Opération absente</span>
                      </button>}
                      <button type="button" className="btn-primary" aria-label="Pointer les opérations" disabled={busyOrLoading || !matches} onClick={() => point(bankLine, bookLine)}>
                        <span className="acc-bank-full-label">Pointer les opérations</span><span className="acc-bank-short-label">Pointer</span>
                      </button>
                    </div>
                  </>
                )}
                <button type="button" className="btn-secondary" aria-label="Contrôler le rapprochement" disabled={busyOrLoading} onClick={() => go('review')}>
                  <span className="acc-bank-full-label">Contrôler le rapprochement</span><span className="acc-bank-short-label">Contrôler</span><ArrowRight size={15} />
                </button>
              </footer>
            </>
          )}
        </div>
      )}

      {phase === 'review' && report && (
        <div className="acc-bank-screen acc-fill">
          <div className="acc-bank-review">
            <h3>Contrôles du rapprochement</h3>
            <dl className="acc-bank-checks">
              {validationChecks.map(check => (
                <div key={check.label} data-ok={check.ok}>
                  <dt>{check.label}{editable && !check.ok && <span className="acc-table-meta">{check.action}</span>}</dt>
                  <dd>{check.value}{check.ok && <Check size={15} aria-label="Contrôle satisfait" />}</dd>
                </div>
              ))}
            </dl>
            <h3>Calcul du solde rapproché</h3>
            <dl className="acc-bank-balances">
              <div><dt>Solde comptable</dt><dd>{money(report.book_balance)}</dd></div>
              <div><dt>Mouvements comptables non pointés</dt><dd>{money(report.unpointed_amount)}</dd></div>
              <div><dt>Solde comptable ajusté</dt><dd>{money(report.adjusted_book)}</dd></div>
              <div><dt>Solde final du relevé</dt><dd>{money(report.statement.closing_balance)}</dd></div>
            </dl>
            <p className="acc-bank-hint">Le solde comptable ajusté correspond au solde comptable diminué du montant net des écritures non pointées. Les {report.book_pending_count} écriture(s) comptable(s) non pointée(s) restent en attente pour le relevé suivant.</p>
            {snapshotChanged && <p className="acc-bank-message" data-tone="warning">Le solde comptable a évolué depuis la validation. Vérifiez les écritures rétroactives.</p>}
            {report.statement.cancel_reason && <p className="acc-bank-message"><strong>Motif d’annulation</strong> {report.statement.cancel_reason}</p>}
          </div>
          <footer className="acc-bank-footer">
            <button type="button" className="btn-secondary" disabled={busyOrLoading} onClick={() => go('pointing')}><ArrowLeft size={15} />Voir le pointage</button>
            {editable && <div className="acc-bank-actions">
              <button type="button" className="acc-bank-link" disabled={busyOrLoading} onClick={() => {
                setReason(''); setError(''); setConfirmation('cancel');
              }}>Annuler le relevé</button>
              <button type="button" className="btn-primary" disabled={busyOrLoading || !canFinish} onClick={() => {
                setError(''); setConfirmation('finish');
              }}><Check size={15} />Valider le rapprochement</button>
            </div>}
          </footer>
        </div>
      )}

      {confirmation && <Modal open title={CONFIRMATION_TITLES[confirmation]} layer="top" size="sm" focusOnOpen onClose={() => { if (!busy) { setError(''); setConfirmation(null); } }}
        footer={<>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setError(''); setConfirmation(null); }}>Retour</button>
          <button type="button" className={confirmation === 'cancel' ? 'btn-danger' : 'btn-primary'}
            disabled={busyOrLoading || (confirmation === 'cancel' ? !reason.trim() : confirmation === 'finish' ? !canFinish : !proposalIds.length)}
            onClick={confirmation === 'batch' ? batch : finish}>
            {confirmation === 'cancel' ? 'Confirmer l’annulation' : confirmation === 'finish' ? 'Confirmer la validation' : 'Confirmer le pointage'}
          </button>
        </>}>
        {confirmation === 'batch' && <p className="acc-bank-hint">Vérifiez les pièces sélectionnées. L’opération lie {proposalIds.length} paire(s) entre le relevé et la comptabilité.</p>}
        {confirmation === 'finish' && <p className="acc-bank-hint">Cette validation fige les pointages du relevé {chosen?.reference}. Vérifiez le solde final et les trois contrôles avant de confirmer.</p>}
        {confirmation === 'cancel' && <>
          <p className="acc-bank-hint">L’annulation libère les pointages du relevé {chosen?.reference}. Elle reste visible dans l’historique.</p>
          <label className="acc-bank-field">Motif de l’annulation<textarea className="input" required value={reason} maxLength={500} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
        </>}
        {error && <p role="alert" className="acc-bank-message" data-tone="error">{error}</p>}
      </Modal>}

      {missing && <Modal open title="Comptabiliser une opération absente" layer="top" size="sm" focusOnOpen onClose={() => { if (!busy) { setError(''); setMissing(null); } }}
        footer={<>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setError(''); setMissing(null); }}>Retour</button>
          <button type="button" className="btn-primary" disabled={busyOrLoading || counterBusy || !missing.counter || !missing.reason.trim()} onClick={postMissing}>Comptabiliser et pointer</button>
        </>}>
        <div className="acc-bank-fieldset">
          <p><strong>{missing.label} · {money(missing.amount)}</strong></p>
          <p className="acc-bank-hint">Réservé aux frais et produits bancaires réellement absents des journaux. Vérifiez le justificatif et les règlements déjà enregistrés, notamment les règlements partiels. La totalité de l’opération sera comptabilisée et pointée.</p>
          <label className="acc-bank-field">Compte de contrepartie
            <select className="input" value={missing.counter} disabled={busy || counterBusy} onChange={event => setMissing({ ...missing, counter: event.target.value })}>
              <option value="">{counterBusy ? 'Chargement…' : missing.amount < 0 ? 'Choisir un compte de charges' : 'Choisir un compte de produits'}</option>
              {counterAccounts.map(choice => <option key={choice.code} value={choice.code}>{choice.code} — {choice.name}</option>)}
            </select>
          </label>
          <label className="acc-bank-field">Motif<input className="input" required value={missing.reason} maxLength={300} disabled={busy} onChange={event => setMissing({ ...missing, reason: event.target.value })} /></label>
          {error && <p role="alert" className="acc-bank-message" data-tone="error">{error}</p>}
        </div>
      </Modal>}
    </section>
  );
}
