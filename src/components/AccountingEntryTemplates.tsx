import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Copy, FileText, Settings2 } from 'lucide-react';
import { useAccountingWork } from '../context/AccountingWindowContext';
import {
  normalizeTemplateLine, resolveEntryTemplate,
  type EntryTemplate, type EntryTemplateSource, type TemplateInputs, type TemplateLine,
} from '../lib/accountingEntryTemplates';
import { formatDate } from '../lib/format';
import { useAccountingTemplateRows } from '../lib/useAccountingTemplateRows';
import { Modal } from './Modal';

export type { EntryTemplate, TemplateLine } from '../lib/accountingEntryTemplates';

export type AppliedEntryTemplate = EntryTemplate & { journal_code: string; lines: TemplateLine[] };

type Props = {
  tenantId: string;
  canSave: boolean;
  journal: string;
  description: string;
  lines: TemplateLine[];
  onApply: (template: AppliedEntryTemplate, scheduled?: boolean) => boolean | void;
  onCreate?: (source: EntryTemplateSource) => void;
  onManage?: () => void;
  openRequest?: number;
  accounts?: { code: string; name: string }[];
  readyToApply?: boolean;
};

const amountFormat = new Intl.NumberFormat('fr-SN', { maximumFractionDigits: 2 });

export function AccountingEntryTemplates({
  tenantId, canSave, journal, description, lines, onApply, onCreate, onManage, openRequest, accounts, readyToApply = true,
}: Props) {
  const work = useAccountingWork();
  const accountListId = useId();
  const templateList = useAccountingTemplateRows(tenantId, work?.revision ?? 0);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState('');
  const [preparing, setPreparing] = useState<{ template: EntryTemplate; scheduled: boolean } | null>(null);
  const [values, setValues] = useState<TemplateInputs>({});
  const handledRequest = useRef<number>();
  const scoped = templateList.rows.filter(template => !template.journal_code || template.journal_code === journal);
  const selected = scoped.find(template => template.id === chosen);
  const ruleLines = useMemo(() => preparing?.template.lines.map(normalizeTemplateLine) ?? [], [preparing]);
  const preview = useMemo(() => resolveEntryTemplate(ruleLines, values), [ruleLines, values]);
  const accountNames = useMemo(() => new Map(accounts?.map(account => [account.code, account.name])), [accounts]);
  const invalidAccount = readyToApply && accounts && preview.postingLines.find(line => !accountNames.has(line.account_code));
  const issue = preview.issue || (invalidAccount ? `Le compte ${invalidAccount.account_code} est inactif ou inconnu.` : '');
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Dakar' });

  useEffect(() => {
    if (!journal || openRequest == null || handledRequest.current === openRequest) return;
    handledRequest.current = openRequest;
    setChosen('');
    setPreparing(null);
    setOpen(true);
  }, [journal, openRequest]);

  function close() {
    setOpen(false);
    setPreparing(null);
    setValues({});
  }

  function prepare(scheduled: boolean) {
    if (!selected || (scheduled && (!selected.next_due_on || selected.next_due_on > today))) return;
    setValues({});
    setPreparing({ template: selected, scheduled });
  }

  function updateValue(index: number, field: 'account' | 'label' | 'amount', value: string) {
    setValues(previous => ({ ...previous, [index]: { ...previous[index], [field]: value } }));
  }

  function apply() {
    if (!preparing || issue || !journal || !readyToApply) return;
    const { template, scheduled } = preparing;
    if (template.journal_code && template.journal_code !== journal) return;
    const result = onApply({ ...template, journal_code: template.journal_code ?? journal, lines: preview.postingLines }, scheduled);
    if (result !== false) close();
  }

  return (
    <div className="acc-template-strip">
      <div className="acc-toolbar">
        <button type="button" className="btn-secondary" disabled={!journal} onClick={() => { setChosen(''); setOpen(true); }}>
          <FileText size={16} />Appeler un modèle
        </button>
        {onCreate && <button type="button" className="btn-secondary" disabled={!canSave}
          onClick={() => onCreate({ journal, description, lines })}><Copy size={16} />Créer un modèle depuis la saisie</button>}
        {onManage && <button type="button" className="btn-secondary" onClick={onManage}><Settings2 size={16} />Modèles de saisie</button>}
      </div>
      <Modal open={open} onClose={close} title={preparing ? 'Préparer le modèle' : 'Appeler un modèle'} size={preparing ? 'lg' : 'md'}
        focusOnOpen layer="top"
        footer={preparing ? <>
          <button type="button" className="btn-secondary" onClick={() => setPreparing(null)}>Retour</button>
          <button type="button" className="btn-primary" disabled={!!issue || !readyToApply} onClick={apply}>Reprendre en saisie</button>
        </> : <>
          <button type="button" className="btn-secondary" onClick={close}>Fermer</button>
          {selected?.next_due_on && selected.next_due_on <= today && <button type="button" className="btn-secondary"
            onClick={() => prepare(true)}>Préparer l’échéance</button>}
          <button type="button" className="btn-primary" disabled={!selected || templateList.loading} onClick={() => prepare(false)}>Préparer le modèle</button>
        </>}
      >
        {!preparing ? (
          <div className="space-y-3">
            <p className="text-sm text-[var(--w-text-sec)]">Journal {journal}. La liste inclut les modèles disponibles dans tous les journaux.</p>
            <label className="label">Modèle de saisie
              <select className="input mt-1 w-full" value={chosen} disabled={templateList.loading || !scoped.length}
                onChange={event => setChosen(event.target.value)}>
                <option value="">{templateList.loading ? 'Chargement…' : 'Choisir un modèle'}</option>
                {scoped.map(template => <option key={template.id} value={template.id}>
                  {template.name}{!template.journal_code ? ' │ Tous les journaux' : ''}
                </option>)}
              </select>
            </label>
            {selected && <div className="text-sm">
              <p>{selected.description}</p>
              {selected.next_due_on && <p className="mt-1 text-[var(--w-text-sec)]">Prochaine échéance le {formatDate(selected.next_due_on)}.</p>}
            </div>}
            {templateList.error ? <p role="alert" className="text-sm text-red-700">{templateList.error}</p>
              : !templateList.loading && !scoped.length && <p role="status" className="text-sm">Aucun modèle disponible pour ce journal.</p>}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="border-b border-[var(--w-separator)] pb-2">
              <p className="break-words text-sm font-semibold">{preparing.template.name}</p>
              <p className="break-words text-sm text-[var(--w-text-sec)]">{preparing.template.description}</p>
              {preparing.scheduled && preparing.template.next_due_on &&
                <p className="mt-1 text-sm">Échéance du {formatDate(preparing.template.next_due_on)}</p>}
            </div>
            <datalist id={accountListId}>{accounts?.map(account => <option key={account.code} value={account.code}>{account.name}</option>)}</datalist>
            {ruleLines.map((line, index) => {
              const number = index + 1;
              const result = preview.records[index];
              const amount = result?.debit || result?.credit || 0;
              const side = result?.debit ? 'Débit' : result?.credit ? 'Crédit' : line.amount_side === 'debit' ? 'Débit' : line.amount_side === 'credit' ? 'Crédit' : 'Contrepartie';
              return (
                <fieldset key={index} className="min-w-0 border-b border-[var(--w-separator)] pb-2">
                  <legend className="mb-1 text-xs font-semibold">Ligne {number}</legend>
                  <div className="grid items-start gap-2 sm:grid-cols-3">
                    {line.account_rule === 'input' ? <label className="label">Compte
                      <input aria-label={`Compte ligne ${number}`} className="input mt-1 w-full" value={values[index]?.account ?? ''}
                        autoComplete="off" list={accountListId} onChange={event => updateValue(index, 'account', event.target.value)} />
                    </label> : <div className="min-w-0 text-sm break-words"><p className="text-xs text-[var(--w-text-sec)]">Compte</p>
                      <p>{result?.account_code || '—'} {result?.account_code ? accountNames.get(result.account_code) : ''}</p></div>}
                    {line.label_rule === 'input' ? <label className="label">Libellé
                      <input aria-label={`Libellé ligne ${number}`} className="input mt-1 w-full" value={values[index]?.label ?? ''}
                        maxLength={500} onChange={event => updateValue(index, 'label', event.target.value)} />
                    </label> : <div className="min-w-0 text-sm break-words"><p className="text-xs text-[var(--w-text-sec)]">Libellé</p><p>{result?.label || '—'}</p></div>}
                    {line.amount_rule === 'input' ? <label className="label">{side} (FCFA)
                      <input aria-label={`Montant ligne ${number} en FCFA`} className="input mt-1 w-full" value={values[index]?.amount ?? ''}
                        inputMode="decimal" maxLength={16} onChange={event => updateValue(index, 'amount', event.target.value)} />
                    </label> : <div className="min-w-0 text-sm tabular-nums"><p className="text-xs text-[var(--w-text-sec)]">
                      {side}{line.amount_rule === 'balance' ? ' calculé' : ''}</p><p>{amount ? `${amountFormat.format(amount)} FCFA` : '—'}</p></div>}
                  </div>
                </fieldset>
              );
            })}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
              <span>Débit <strong>{amountFormat.format(preview.totalDebit)} FCFA</strong></span>
              <span>Crédit <strong>{amountFormat.format(preview.totalCredit)} FCFA</strong></span>
            </div>
            {issue && <p className="text-sm text-[var(--w-text-sec)]" role="status">{issue}</p>}
            {!readyToApply && <p className="text-sm text-[var(--w-text-sec)]" role="status">Vérification du plan comptable en cours.</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
