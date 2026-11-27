import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { CalendarDays, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { useAccountingWindowId, mayCloseAccountingWindow, useAccountingMobile, useAccountingWork } from '../context/AccountingWindowContext';
import { useAccountingJournals } from '../lib/accountingJournals';
import {
  defaultTemplateLine, normalizeTemplateLine, templateError, validateTemplateShape,
  type AmountRule, type AmountSide, type EntryTemplate, type EntryTemplateSource, type RuleLine, type ValueRule,
} from '../lib/accountingEntryTemplates';
import { formatDate } from '../lib/format';
import { supabase } from '../lib/supabase';
import { useAccountingTemplateRows } from '../lib/useAccountingTemplateRows';
import { AccountingPagination, AccountingTable, useAccountingPagination } from './AccountingWorkspace';
import { Modal } from './Modal';
import { SearchableSelect } from './SearchableSelect';

export type { EntryTemplateSource } from '../lib/accountingEntryTemplates';

type Draft = {
  id: string | null;
  revision: number | null;
  name: string;
  journal: string;
  description: string;
  lines: RuleLine[];
  scheduled: boolean;
};

function templateDraft(template?: EntryTemplate, source?: EntryTemplateSource): Draft {
  return {
    id: template?.id ?? null,
    revision: template?.revision ?? null,
    name: template?.name ?? '',
    journal: template?.journal_code ?? source?.journal ?? '',
    description: template?.description ?? source?.description ?? '',
    lines: (template?.lines ?? source?.lines)?.map(normalizeTemplateLine)
      ?? [defaultTemplateLine('debit'), defaultTemplateLine('auto')],
    scheduled: !!template?.next_due_on,
  };
}

const valueRules: { value: ValueRule; title: string }[] = [
  { value: 'fixed', title: 'Fixe' }, { value: 'input', title: 'À saisir' }, { value: 'repeat', title: 'Répéter' },
];
const amountRules: { value: AmountRule; title: string }[] = [...valueRules, { value: 'balance', title: 'Équilibrer' }];

function TemplateLineFields({ line, index, datalistId, update, remove, canRemove }: {
  line: RuleLine;
  index: number;
  datalistId: string;
  update: (patch: Partial<RuleLine>) => void;
  remove: () => void;
  canRemove: boolean;
}) {
  const mobile = useAccountingMobile();
  const number = index + 1;
  const displayAmount = line.amount_side === 'credit' ? line.credit : line.debit;
  function setAmountSide(side: AmountSide) {
    update({ amount_side: side, debit: side === 'debit' ? displayAmount : 0, credit: side === 'credit' ? displayAmount : 0 });
  }

  const fields = (
    <fieldset className="min-w-0 border-t border-[var(--w-separator)] pt-2 pb-3">
      <legend className="text-xs font-semibold pr-2">Ligne {number}</legend>
      <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.45fr)_auto]">
        <div className="min-w-0 space-y-1">
          {mobile ? <SearchableSelect label="Compte" ariaLabel={`Règle du compte ligne ${number}`}
            value={line.account_rule} searchable={false} clearable={false}
            options={valueRules.map(rule=>({value:rule.value,label:rule.title,disabled:index===0&&rule.value==='repeat'}))}
            onChange={value=>update({account_rule:value as ValueRule})}/> : <label className="label">Compte
            <select className="input mt-1 w-full" aria-label={`Règle du compte ligne ${number}`} value={line.account_rule}
              onChange={event => update({ account_rule: event.target.value as ValueRule })}>
              {valueRules.map(rule => <option key={rule.value} value={rule.value} disabled={index === 0 && rule.value === 'repeat'}>{rule.title}</option>)}
            </select>
          </label>}
          {line.account_rule === 'fixed' && <input className="input w-full" list={datalistId} aria-label={`Compte fixe ligne ${number}`}
            value={line.account_code} onChange={event => update({ account_code: event.target.value })} autoComplete="off" placeholder="Code ou intitulé" />}
        </div>
        <div className="min-w-0 space-y-1">
          {mobile ? <SearchableSelect label="Libellé" ariaLabel={`Règle du libellé ligne ${number}`}
            value={line.label_rule} searchable={false} clearable={false}
            options={valueRules.map(rule=>({value:rule.value,label:rule.title,disabled:index===0&&rule.value==='repeat'}))}
            onChange={value=>update({label_rule:value as ValueRule})}/> : <label className="label">Libellé
            <select className="input mt-1 w-full" aria-label={`Règle du libellé ligne ${number}`} value={line.label_rule}
              onChange={event => update({ label_rule: event.target.value as ValueRule })}>
              {valueRules.map(rule => <option key={rule.value} value={rule.value} disabled={index === 0 && rule.value === 'repeat'}>{rule.title}</option>)}
            </select>
          </label>}
          {line.label_rule === 'fixed' && <input className="input w-full" aria-label={`Libellé fixe ligne ${number}`} maxLength={500}
            value={line.label} onChange={event => update({ label: event.target.value })} />}
        </div>
        <div className="min-w-0 space-y-1">
          <div className="grid grid-cols-2 gap-1.5">
            {mobile ? <SearchableSelect label="Montant" ariaLabel={`Règle du montant ligne ${number}`} value={line.amount_rule}
              searchable={false} clearable={false}
              options={amountRules.map(rule=>({value:rule.value,label:rule.title,disabled:index===0&&rule.value==='repeat'}))}
              onChange={value=>{
                const amount_rule=value as AmountRule;
                update({amount_rule,amount_side:amount_rule==='balance'?'auto':line.amount_side==='auto'?'credit':line.amount_side});
              }}/> : <label className="label min-w-0">Montant
              <select className="input mt-1 w-full" aria-label={`Règle du montant ligne ${number}`} value={line.amount_rule}
                onChange={event => {
                  const amount_rule = event.target.value as AmountRule;
                  update({ amount_rule, amount_side: amount_rule === 'balance' ? 'auto' : line.amount_side === 'auto' ? 'credit' : line.amount_side });
                }}>
                {amountRules.map(rule => <option key={rule.value} value={rule.value} disabled={index === 0 && rule.value === 'repeat'}>{rule.title}</option>)}
              </select>
            </label>}
            {mobile ? <SearchableSelect label="Sens" ariaLabel={`Sens du montant ligne ${number}`} value={line.amount_side}
              searchable={false} clearable={false}
              options={line.amount_rule==='balance'?[{value:'auto',label:'Automatique'}]:[{value:'debit',label:'Débit'},{value:'credit',label:'Crédit'}]}
              onChange={value=>setAmountSide(value as AmountSide)}/> : <label className="label min-w-0">Sens
              <select className="input mt-1 w-full" aria-label={`Sens du montant ligne ${number}`} value={line.amount_side}
                onChange={event => setAmountSide(event.target.value as AmountSide)}>
                <option value="debit">Débit</option><option value="credit">Crédit</option>
                {line.amount_rule === 'balance' && <option value="auto">Automatique</option>}
              </select>
            </label>}
          </div>
          {line.amount_rule === 'fixed' && <input className="input w-full" type="number" min="0" step="0.01" inputMode="decimal"
            aria-label={`Montant fixe ligne ${number} en FCFA`} value={displayAmount || ''}
            onChange={event => update({ [line.amount_side === 'credit' ? 'credit' : 'debit']: Number(event.target.value) })}
            placeholder="Montant fixe en FCFA" />}
        </div>
        <button className="acc-icon justify-self-end self-start sm:mt-5" type="button" disabled={!canRemove} onClick={remove}
          aria-label={`Retirer la ligne ${number}`} title={`Retirer la ligne ${number}`}><Trash2 size={16} /></button>
      </div>
    </fieldset>
  );
  return mobile?<details className="acc-mobile-template-line"><summary>Ligne {number}</summary>{fields}</details>:fields;
}

export function AccountingTemplateWorkspace({ tenantId, canManage, source }: {
  tenantId: string;
  canManage: boolean;
  source?: EntryTemplateSource;
}) {
  const mobile = useAccountingMobile();
  const work = useAccountingWork();
  const windowId = useAccountingWindowId();
  const datalistId = useId();
  const [localRevision, setRevision] = useState(0);
  const templateList = useAccountingTemplateRows(tenantId, (work?.revision ?? 0) + localRevision);
  const journals = useAccountingJournals(tenantId, work?.revision ?? 0);
  const [accounts, setAccounts] = useState<{ code: string; name: string }[]>([]);
  const [accountError, setAccountError] = useState('');
  const [accountLoading, setAccountLoading] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(() => canManage && source ? templateDraft(undefined, source) : null);
  const initialDraft = useRef(draft ? JSON.stringify(draft) : '');
  const [query, setQuery] = useState('');
  const [journalFilter, setJournalFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [action, setAction] = useState<{ type: 'archive' | 'schedule'; template: EntryTemplate } | null>(null);
  const [firstDue, setFirstDue] = useState('');
  const lock = useRef(false);
  const accountCodes = useMemo(() => new Set(accounts.map(account => account.code)), [accounts]);
  const editorOpen = !!draft;
  const dirty = editorOpen && JSON.stringify(draft) !== initialDraft.current;
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Dakar' });

  useEffect(() => {
    if (!editorOpen) return;
    let live = true;
    setAccounts([]);
    setAccountError('');
    setAccountLoading(true);
    void (async () => {
      try {
        const items: typeof accounts = [];
        for (let offset = 0; ; offset += 500) {
          const { data, error: loadError } = await supabase.from('accounts').select('code,name').eq('tenant_id', tenantId)
            .eq('is_active', true).order('code').range(offset, offset + 499);
          if (loadError) throw loadError;
          if (!live) return;
          items.push(...(data ?? []));
          if ((data?.length ?? 0) < 500) break;
        }
        setAccounts(items);
      } catch (loadError) {
        if (live) setAccountError(templateError(loadError, 'Impossible de charger le plan comptable.'));
      } finally {
        if (live) setAccountLoading(false);
      }
    })();
    return () => { live = false; };
  }, [editorOpen, tenantId, work?.revision]);

  useEffect(() => {
    function guard(event: Event) {
      if (!mayCloseAccountingWindow(event, windowId) || event.defaultPrevented) return;
      if (lock.current || (dirty && !window.confirm('Abandonner les changements du modèle ?'))) event.preventDefault();
    }
    window.addEventListener('waarwi:accounting-before-navigate', guard);
    return () => window.removeEventListener('waarwi:accounting-before-navigate', guard);
  }, [windowId, dirty]);

  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('fr');
    return templateList.rows.filter(template => (!journalFilter ||
      (journalFilter === 'global' ? !template.journal_code : template.journal_code === journalFilter)) &&
      [template.name, template.description].some(value => value.toLocaleLowerCase('fr').includes(term)));
  }, [templateList.rows, query, journalFilter]);
  const paging = useAccountingPagination(visible, `${query}|${journalFilter}`);
  const validation = draft ? validateTemplateShape(draft.lines, accountCodes) : '';
  const selectedJournalUnavailable = !!draft?.journal && !journals.rows.some(journal => journal.code === draft.journal && journal.is_active);
  const canSave = canManage && !!draft?.name.trim() && !!draft.description.trim() && !validation && !busy &&
    !accountLoading && !accountError && !journals.loading && !journals.error && !selectedJournalUnavailable;

  function startEdit(template?: EntryTemplate) {
    if (!canManage) return;
    const next = templateDraft(template);
    initialDraft.current = JSON.stringify(next);
    setDraft(next);
    setError('');
    setNotice('');
  }

  function cancelEdit() {
    if (busy || (dirty && !window.confirm('Abandonner les changements du modèle ?'))) return;
    setDraft(null);
    setError('');
  }

  function reload() {
    if (work) work.refresh();
    else setRevision(revision => revision + 1);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || !canSave || lock.current) return;
    setBusy(true);
    setError('');
    lock.current = true;
    try {
      const { data, error: writeError } = await supabase.rpc('write_accounting_entry_template', {
        p_tenant_id: tenantId, p_id: draft.id, p_revision: draft.revision, p_name: draft.name, p_journal_code: draft.journal || null,
        p_description: draft.description, p_lines: draft.lines,
      });
      if (writeError) throw writeError;
      if (!data?.success) throw new Error('Enregistrement du modèle non confirmé.');
      setDraft(null);
      setNotice(draft.id ? 'Modèle modifié.' : 'Modèle enregistré.');
      if (journalFilter && journalFilter !== (draft.journal || 'global')) setJournalFilter('');
      if (query && ![draft.name, draft.description].some(value => value.toLocaleLowerCase('fr').includes(query.trim().toLocaleLowerCase('fr')))) setQuery('');
      reload();
    } catch (writeError) {
      setError(templateError(writeError, 'Impossible d’enregistrer le modèle.'));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function performAction() {
    if (!action || !canManage || lock.current || (action.type === 'schedule' && !firstDue)) return;
    setError('');
    setNotice('');
    setBusy(true);
    lock.current = true;
    try {
      const args = { p_tenant_id: tenantId, p_revision: action.template.revision };
      const result = action.type === 'archive'
        ? await supabase.rpc('archive_accounting_entry_template', { ...args, p_id: action.template.id })
        : await supabase.rpc('schedule_accounting_entry_template', { ...args, p_template_id: action.template.id, p_first_due: firstDue });
      if (result.error) throw result.error;
      if (!result.data?.success) throw new Error('Opération non confirmée.');
      setNotice(action.type === 'archive' ? 'Modèle archivé.' : 'Échéance mensuelle enregistrée.');
      setAction(null);
      reload();
    } catch (actionError) {
      setError(templateError(actionError, 'Opération impossible.'));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const editorActions = <>
    <button type="button" className="btn-secondary" disabled={busy} onClick={cancelEdit}>Annuler</button>
    <button type="submit" className="btn-primary" disabled={!canSave}><Save size={16} />{busy ? 'Enregistrement…' : mobile ? 'Enregistrer' : 'Enregistrer le modèle'}</button>
  </>;
  return draft ? (
    <form className="acc-catalog-editor space-y-3 min-w-0" onSubmit={save}>
      <div className="acc-toolbar acc-fixed">
        <strong>{draft.id ? 'Modifier le modèle' : 'Nouveau modèle'}</strong>
        {!mobile&&<><span className="acc-spacer" />{editorActions}</>}
      </div>
      {source && !draft.id && <p className="text-sm text-[var(--w-text-sec)]">Champs préremplis depuis l’écriture. Vérifiez les comptes et indiquez quelles valeurs seront saisies à chaque utilisation.</p>}
      <fieldset className="space-y-3 min-w-0" disabled={busy}>
        <div className="acc-fields acc-fields-2 acc-template-identity">
          <label className="label">Intitulé du modèle
            <input className="input mt-1 w-full" required maxLength={100} value={draft.name}
              onChange={event => setDraft({ ...draft, name: event.target.value })} />
          </label>
          {mobile ? <SearchableSelect label="Journal" ariaLabel="Journal" value={draft.journal} clearable={false}
            disabled={busy||draft.scheduled||journals.loading} wrapLabels searchable={journals.rows.length>10}
            options={[{value:'',label:'Tous les journaux'},...journals.rows.filter(journal=>journal.is_active||journal.code===draft.journal).map(journal=>({value:journal.code,label:journal.code+' — '+journal.name+(!journal.is_active?' (désactivé)':''),disabled:!journal.is_active})),
              ...(draft.journal&&!journals.rows.some(journal=>journal.code===draft.journal)?[{value:draft.journal,label:draft.journal}]:[])]}
            onChange={value=>setDraft({...draft,journal:value})}/> : <label className="label">Journal
            <select className="input mt-1 w-full" value={draft.journal} disabled={draft.scheduled || journals.loading}
              onChange={event => setDraft({ ...draft, journal: event.target.value })}>
              <option value="">Tous les journaux</option>
              {journals.rows.filter(journal => journal.is_active || journal.code === draft.journal).map(journal => (
                <option key={journal.code} value={journal.code} disabled={!journal.is_active}>{journal.code} — {journal.name}{!journal.is_active ? ' (désactivé)' : ''}</option>
              ))}
              {draft.journal && !journals.rows.some(journal => journal.code === draft.journal) && <option value={draft.journal}>{draft.journal}</option>}
            </select>
          </label>}
        </div>
        {draft.scheduled && <p className="text-xs text-[var(--w-text-sec)]">Le modèle est planifié dans ce journal.</p>}
        <label className="label">Libellé de l’écriture
          <input className="input mt-1 w-full" required maxLength={500} value={draft.description}
            onChange={event => setDraft({ ...draft, description: event.target.value })} />
        </label>
        <p className="text-xs text-[var(--w-text-sec)]">Répéter reprend la valeur de la ligne précédente. Équilibrer calcule la contrepartie avec les autres montants.</p>
        <datalist id={datalistId}>{accounts.map(account => <option key={account.code} value={account.code}>{account.name}</option>)}</datalist>
        {draft.lines.map((line, index) => <TemplateLineFields key={index} line={line} index={index} datalistId={datalistId}
          canRemove={draft.lines.length > 2}
          update={patch => setDraft({ ...draft, lines: draft.lines.map((item, i) => i === index ? { ...item, ...patch } : item) })}
          remove={() => setDraft({ ...draft, lines: draft.lines.filter((_, i) => i !== index) })} />)}
        <button type="button" className="btn-secondary" disabled={draft.lines.length >= 500}
          onClick={() => setDraft({ ...draft, lines: [...draft.lines, defaultTemplateLine('debit')] })}><Plus size={16} />Ajouter une ligne</button>
      </fieldset>
      {accountLoading && <p role="status" className="text-sm">Chargement du plan comptable…</p>}
      {(error || accountError || journals.error) && <p className="text-sm text-red-700" role="alert">{error || accountError || journals.error}</p>}
      {!accountLoading && !accountError && validation && <p className="text-sm text-[var(--w-text-sec)]">{validation}</p>}
      {!journals.loading && selectedJournalUnavailable && <p className="text-sm text-red-700" role="alert">Choisissez un journal actif.</p>}
      {mobile&&<div className="acc-editor-actions">{editorActions}</div>}
    </form>
  ) : (
    <section className="acc-fill space-y-3 min-w-0">
      <div className={mobile?'acc-mobile-command-bar':'acc-toolbar acc-fixed'}>
        <input className={mobile?'input acc-mobile-command-wide acc-mobile-search-input':'input min-w-0 flex-1 sm:max-w-xs'} aria-label="Rechercher un modèle" placeholder="Intitulé ou libellé…" value={query}
          onChange={event => setQuery(event.target.value)} />
        <SearchableSelect ariaLabel="Filtrer par journal" className={mobile?'acc-mobile-selection':'acc-toolbar-select w-52'} searchable={false} clearable={false} wrapLabels
          value={journalFilter} onChange={setJournalFilter} options={[
            {value:'',label:'Tous les modèles'}, {value:'global',label:'Sans journal attitré'},
            ...journals.rows.map(journal=>({value:journal.code,label:journal.code+' — '+journal.name})),
          ]}/>
        {!mobile&&<span className="acc-spacer" />}
        {canManage && <button type="button" className="btn-primary" onClick={() => startEdit()}><Plus size={16} />Nouveau modèle</button>}
      </div>
      {(templateList.error || (!action && error)) && <p role="alert" className="text-sm text-red-700">{templateList.error || error}</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      <AccountingTable fill footer={<AccountingPagination {...paging} disabled={templateList.loading} />}>
        <table>
          <thead><tr><th className="text-left">Intitulé</th><th className="text-left hidden sm:table-cell">Journal</th>
            <th className="text-left hidden md:table-cell">Prochaine échéance</th>{canManage && <th className="text-right"><span className="sr-only">Actions</span></th>}</tr></thead>
          <tbody>
            {paging.rows.map(template => <tr key={template.id}>
              <td className="break-words">
                {canManage ? <button type="button" className="text-left font-semibold hover:underline" onClick={() => startEdit(template)}>{template.name}</button>
                  : <strong>{template.name}</strong>}
                <span className="block text-xs text-[var(--w-text-sec)] sm:hidden">{template.journal_code ?? 'Tous les journaux'}</span>
                {template.next_due_on && <span className="block text-xs text-[var(--w-text-sec)] md:hidden">Échéance {formatDate(template.next_due_on)}</span>}
              </td>
              <td className="hidden sm:table-cell">{template.journal_code ?? 'Tous les journaux'}</td>
              <td className="hidden md:table-cell">{template.next_due_on ? formatDate(template.next_due_on) : '—'}</td>
              {canManage && <td><div className="flex flex-wrap justify-end gap-1">
                <button type="button" className="acc-icon" aria-label={`Modifier ${template.name}`} title="Modifier" onClick={() => startEdit(template)}><Pencil size={16} /></button>
                {template.journal_code && !template.next_due_on && <button type="button" className="acc-icon" aria-label={`Planifier ${template.name}`} title="Planifier chaque mois"
                  onClick={() => { setError(''); setFirstDue(today); setAction({ type: 'schedule', template }); }}><CalendarDays size={16} /></button>}
                <button type="button" className="acc-icon" aria-label={`Archiver ${template.name}`} title="Archiver"
                  onClick={() => { setError(''); setAction({ type: 'archive', template }); }}><Trash2 size={16} /></button>
              </div></td>}
            </tr>)}
            {!paging.rows.length && <tr><td colSpan={canManage ? 4 : 3} className="text-center text-[var(--w-text-sec)]">
              {templateList.loading ? 'Chargement des modèles…' : 'Aucun modèle trouvé.'}
            </td></tr>}
          </tbody>
        </table>
      </AccountingTable>
      <Modal open={!!action} onClose={() => { if (!busy) { setAction(null); setError(''); } }} size="sm" focusOnOpen layer="top"
        title={action?.type === 'archive' ? 'Archiver le modèle' : 'Planifier chaque mois'}
        footer={<><button className="btn-secondary" type="button" disabled={busy} onClick={() => { setAction(null); setError(''); }}>Annuler</button>
          <button className="btn-primary" type="button" disabled={busy || (action?.type === 'schedule' && !firstDue)} onClick={() => void performAction()}>
            {action?.type === 'archive' ? 'Archiver' : 'Planifier'}
          </button></>}>
        {action?.type === 'archive' ? <p className="text-sm">Archiver « {action.template.name} » ? Les écritures enregistrées sont conservées.</p>
          : <label className="label">Première échéance<input className="input mt-1 w-full" type="date" value={firstDue} onChange={event => setFirstDue(event.target.value)} disabled={busy} /></label>}
        {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      </Modal>
    </section>
  );
}
