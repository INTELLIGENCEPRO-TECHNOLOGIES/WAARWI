import { useRealtimeTick } from '../lib/useRealtimeData';
import { useRealtimeRefresh } from '../lib/useRealtimeData';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Loader2, Save, Pencil as Edit2, Search, Eye, FileText, CheckCircle, PlayCircle, X, Check, Trash2, Download } from '../components/Icons';
import { AccountingPagination, AccountingTable, AccountingRowActions, useAccountingPagination } from '../components/AccountingWorkspace';
import './accounting-graphite.css';
import { AccountingPlanIO } from '../components/AccountingPlanIO';
import { AccountingCashReview } from '../components/AccountingCashReview';
import { AccountingPurchaseInvoice } from '../components/AccountingPurchaseInvoice';
import { AccountingVatReport } from '../components/AccountingVatReport';
import { AccountingAccountStatement } from '../components/AccountingAccountStatement';
import { AccountingBankReconciliation } from '../components/AccountingBankReconciliation';
import { AccountingFiscalYear } from '../components/AccountingFiscalYear';
import { AccountingFinancialReports } from '../components/AccountingFinancialReports';
import { AccountingEntryReversal } from '../components/AccountingEntryReversal';
import { AccountingPeriodControls } from '../components/AccountingPeriodControls';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { usePermissions } from '../lib/permissions';
import { Modal, ConfirmDialog } from '../components/Modal';
import { SearchableSelect } from '../components/SearchableSelect';
import { formatDate } from '../lib/format';
import { sanitizeCsvValue } from '../lib/csvSanitize';

type TabKey = 'plan' | 'journals' | 'balance' | 'grandlivre' | 'tiers' | 'search' | 'cloture' | 'vat' | 'statement' | 'bank' | 'fiscal' | 'financial';

const JOURNAL_TYPES: Record<string, string> = {
  VE: 'Journal des ventes', AC: 'Journal des achats',
  CA: 'Journal de caisse', BQ: 'Journal de banque',
  OD: 'Opérations diverses',
};

export function Accounting({ section = 'plan' }: { section?: TabKey }) {
  const titles: Record<TabKey, { t: string; s: string }> = {
    plan: { t: 'Plan comptable', s: 'Plan comptable SYSCOHADA.' },
    journals: { t: 'Journaux', s: "Journaux d'écritures comptables." },
    balance: { t: 'Balance générale', s: 'Balance des comptes par période.' },
    grandlivre: { t: 'Grand Livre', s: 'Détail des mouvements par compte.' },
    tiers: { t: 'Tiers', s: 'Balance et interrogation des comptes clients/fournisseurs.' },
    search: { t: 'Recherche', s: "Recherche avancée d'écritures comptables." },
    cloture: { t: 'Clôtures', s: 'Contrôles et clôture mensuelle' },
    vat: { t: 'Situation de TVA', s: 'TVA collectée, récupérable et contrôles par période.' },
    statement: { t: 'Interrogation des comptes', s: 'Mouvements, soldes et pièces des comptes généraux et auxiliaires.' },
    bank: { t: 'Rapprochement bancaire', s: 'Relevés, pointage des écritures et contrôle des soldes.' },
    fiscal: { t: 'Exercices et reports à nouveau', s: 'Arrêtés annuels, balance et ouverture du prochain exercice.' },
    financial: { t: 'États financiers', s: 'Bilan, compte de résultat, comparatifs et contrôles.' },
  };
  const meta = titles[section];
  return (
    <div className="accounting-workspace">
      <header className="acc-titlebar"><div><h1>{meta.t}</h1><p>{meta.s}</p></div><span className="acc-module">Comptabilité</span></header>
      <div className="acc-body" key={section}>
      {section === 'plan' && <PlanTab />}
      {section === 'journals' && <JournalsTab />}
      {section === 'balance' && <BalanceTab />}
      {section === 'grandlivre' && <GrandLivreTab />}
      {section === 'tiers' && <TiersTab />}
      {section === 'search' && <SearchTab />}
      {section === 'cloture' && <ClotureTab />}
      {section === 'vat' && <VatTab />}
      {section === 'statement' && <AccountStatementTab />}
      {section === 'bank' && <BankReconciliationTab />}
      {section === 'fiscal' && <FiscalYearTab />}
      {section === 'financial' && <FinancialReportsTab />}
      </div>
    </div>
  );
}

/* ===================== PLAN COMPTABLE ===================== */
function PlanTab() {
  const { tenant } = useApp();
  const { success, error } = useToast();
  const { can } = usePermissions();
  const canManage = can('manage_accounting');
  const [list, setList] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const load = async () => {
    if (!tenant) return;
    const { data } = await supabase.from('accounts').select('*').eq('tenant_id', tenant.id).order('code');
    setList(data || []);
  };
  useEffect(() => { load(); }, [tenant?.id]);
  useRealtimeRefresh(['accounts', 'accounting_accounts', 'accounting_account_mappings'], load);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return list;
    return list.filter(a => a.code.includes(q) || a.name.toLowerCase().includes(q));
  }, [list, search]);

  const save = async () => {
    if (!tenant || !form.code || !form.name) { error('Code et intitulé obligatoires'); return; }
    if (!editing && (form.code.length !== 7 || !/^\d+$/.test(form.code))) { error('Le code doit contenir exactement 7 chiffres'); return; }
    setSaving(true);
    const { data, error: e } = await supabase.rpc('save_accounting_account', {
      p_tenant_id: tenant.id,
      p_account_id: editing?.id || null,
      p_code: editing ? null : form.code,
      p_name: form.name,
    });
    setSaving(false);
    if (e) { error(e.message); return; }
    if (!(data as any)?.success) { error((data as any)?.error || 'Erreur'); return; }
    success(editing ? 'Modifié' : 'Créé'); setOpen(false); load();
  };

  const [classFilter,setClassFilter]=useState('');
  const visible=useMemo(()=>filtered.filter(a=>!classFilter||String(a.class)===classFilter),[filtered,classFilter]);
  const paging=useAccountingPagination(visible,search+'|'+classFilter);

  return (
    <div className="space-y-3">
      <div className="acc-toolbar acc-fixed">
        <input aria-label="Rechercher un compte" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Code ou intitulé…" className="input flex-1 min-w-0 sm:max-w-xs"/>
        <select aria-label="Classe" value={classFilter} onChange={e=>setClassFilter(e.target.value)} className="input w-auto"><option value="">Toutes les classes</option>{[1,2,3,4,5,6,7,8].map(c=><option key={c} value={c}>Classe {c}</option>)}</select>
        <span className="acc-spacer"/><AccountingPlanIO accounts={list} onImportDone={load}/>
        {canManage&&<button type="button" onClick={()=>{setEditing(null);setForm({});setOpen(true);}} className="btn-primary"><Plus size={16}/>Nouveau compte</button>}
      </div>
      <AccountingTable footer={<AccountingPagination {...paging}/>}>
        <table><thead><tr><th className="text-left">Compte</th><th className="text-left">Intitulé</th><th className="text-left hidden sm:table-cell">Classe</th><th className="text-right">Actions</th></tr></thead>
          <tbody>{paging.rows.map(a=><tr key={a.id}><td className="font-medium whitespace-nowrap">{a.code}</td><td>{a.name}</td><td className="hidden sm:table-cell">{a.class}</td><td className="text-right">{canManage&&<button type="button" className="acc-icon" aria-label={'Modifier '+a.code} onClick={()=>{setEditing(a);setForm({...a});setOpen(true);}}><Edit2 size={16}/></button>}</td></tr>)}
          {!visible.length&&<tr><td colSpan={4} className="text-center text-neutral-500">Aucun compte correspondant.</td></tr>}</tbody>
        </table>
      </AccountingTable>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Modifier le compte' : 'Nouveau compte'} size="sm"
        footer={<><button onClick={() => setOpen(false)} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button><button onClick={save} disabled={saving} className="btn-icon-primary" title="Enregistrer">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}</button></>}>
        <div className="space-y-3">
          <div>
            <label className="label">Code (7 chiffres) *</label>
            <input value={form.code || ''} onChange={e => setForm({ ...form, code: e.target.value })} className="input font-mono" placeholder="5710000" maxLength={7} disabled={!!editing} />
            {form.code?.length === 7 && <p className="text-xs text-slate-500 mt-1">Classe {form.code.charAt(0)}</p>}
          </div>
          <div><label className="label">Intitulé *</label><input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} className="input" /></div>
        </div>
      </Modal>
    </div>
  );
}

/* ===================== JOURNAUX ===================== */
function JournalsTab() {
  const { tenant } = useApp();
  const { success, error } = useToast();
  const { can } = usePermissions();
  const canManage = can('manage_accounting');
  const [entries, setEntries] = useState<any[]>([]);
  const [journalPage,setJournalPage]=useState(0);
  const [journalSize,setJournalSize]=useState(20);
  const [journalTotal,setJournalTotal]=useState(0);
  const [journalError,setJournalError]=useState('');
  const [fromDate,setFromDate]=useState('');
  const [toDate,setToDate]=useState('');
  const [contextRow,setContextRow]=useState<{id:string;x:number;y:number}|null>(null);
  const loadSequence=useRef(0);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [journalType, setJournalType] = useState('');
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState<any[]>([]);

  const canView = can('view_accounting');
  const [exportOpen, setExportOpen] = useState(false);
  const [exportDateFrom, setExportDateFrom] = useState('');
  const [exportDateTo, setExportDateTo] = useState('');
  const [exportJournal, setExportJournal] = useState('');
  const [exportFormat, setExportFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [exportLoading, setExportLoading] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [exportData, setExportData] = useState<{ rows: any[]; totalCount: number; totalDebitSum: number; totalCreditSum: number; entryCount: number } | null>(null);
  const [exportError, setExportError] = useState('');

  const [form, setForm] = useState({ journal_type: 'OD', entry_date: new Date().toISOString().slice(0, 10), description: '', reference: '' });
  const [entryLines, setEntryLines] = useState<{ account_code: string; account_name: string; debit: number; credit: number; label: string }[]>([
    { account_code: '', account_name: '', debit: 0, credit: 0, label: '' },
    { account_code: '', account_name: '', debit: 0, credit: 0, label: '' },
  ]);

  const load = async (silent = false) => {
    if (!tenant) return;
    if (!silent) setLoading(true);
    const seq=++loadSequence.current;
    setJournalError('');
    let q = supabase.from('journal_entries').select('*',{count:'exact'}).eq('tenant_id',tenant.id).order('entry_date',{ascending:false}).order('entry_number',{ascending:false}).order('id',{ascending:false});
    if(journalType)q=q.eq('journal_type',journalType);
    if(fromDate)q=q.gte('entry_date',fromDate);
    if(toDate)q=q.lte('entry_date',toDate);
    const {data,count,error:queryError}=await q.range(journalPage*journalSize,(journalPage+1)*journalSize-1);
    if(seq!==loadSequence.current)return;
    if(queryError){setJournalError(queryError.message);setEntries([]);setJournalTotal(0);}
    else{setJournalTotal(count??0);setEntries(data??[]);const max=Math.max(0,Math.ceil((count??0)/journalSize)-1);if(journalPage>max)setJournalPage(max);}
    setLoading(false);
  };
  useEffect(()=>{void load();return()=>{loadSequence.current++;};},[tenant?.id,journalType,journalPage,journalSize,fromDate,toDate]);
  useRealtimeRefresh(['journal_entries', 'journal_lines'], () => load(true));
  useEffect(() => {
    if (!tenant) return;
    supabase.from('accounts').select('code, name').eq('tenant_id', tenant.id).order('code').then(({ data }) => setAccounts(data || []));
  }, [tenant?.id]);
  const openExportModal = () => {
    const now = new Date();
    setExportDateFrom(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`);
    setExportDateTo(now.toISOString().slice(0, 10));
    setExportJournal('');
    setExportFormat('xlsx');
    setExportError('');
    setExportData(null);
    setExportProgress(null);
    setExportOpen(true);
  };

  const prepareExport = async () => {
    if (!tenant) return;
    setExportLoading(true);
    setExportError('');
    setExportProgress(null);
    setExportData(null);
    try {
      const PAGE = 1000;
      let offset = 0;
      let allRows: any[] = [];
      let totalCount = 0;

      while (true) {
        const { data, error: rpcErr } = await supabase.rpc('export_accounting_entries', {
          p_tenant_id: tenant.id,
          p_date_from: exportDateFrom,
          p_date_to: exportDateTo,
          p_journal_type: exportJournal || null,
          p_page_size: PAGE,
          p_offset: offset,
        });
        if (rpcErr) { setExportError(rpcErr.message); return; }
        const res = data as any;
        if (!res?.success) { setExportError(res?.error || 'Erreur serveur'); return; }
        totalCount = res.total_count;
        const rows = res.rows || [];
        allRows = allRows.concat(rows);
        setExportProgress({ loaded: allRows.length, total: totalCount });
        if (allRows.length >= totalCount || rows.length < PAGE) break;
        offset += PAGE;
      }

      if (allRows.length === 0) { setExportError('Aucune écriture validée sur cette période'); return; }

      const totalDebitSum = allRows.reduce((s: number, r: any) => s + Number(r.debit), 0);
      const totalCreditSum = allRows.reduce((s: number, r: any) => s + Number(r.credit), 0);
      const entryNumbers = new Set(allRows.map((r: any) => r.entry_number));
      setExportData({ rows: allRows, totalCount, totalDebitSum, totalCreditSum, entryCount: entryNumbers.size });
    } catch (e: any) {
      setExportError(e.message || 'Erreur export');
    } finally {
      setExportLoading(false);
    }
  };

  const downloadExport = async () => {
    if (!tenant || !exportData) return;
    try {
      const isCsv = exportFormat === 'csv';
      const exportRows = exportData.rows.map(r => ({
        'Date': isCsv ? sanitizeCsvValue(String(r.entry_date)) : String(r.entry_date),
        'Journal': isCsv ? sanitizeCsvValue(String(r.journal_code)) : String(r.journal_code),
        'N° Pièce': isCsv ? sanitizeCsvValue(String(r.entry_number)) : String(r.entry_number),
        'Référence': isCsv ? sanitizeCsvValue(String(r.reference)) : String(r.reference),
        'Compte': isCsv ? sanitizeCsvValue(String(r.account_code)) : String(r.account_code),
        'Intitulé compte': isCsv ? sanitizeCsvValue(String(r.account_name)) : String(r.account_name),
        'Libellé': isCsv ? sanitizeCsvValue(String(r.line_label)) : String(r.line_label),
        'Débit': Number(r.debit),
        'Crédit': Number(r.credit),
        'Source': isCsv ? sanitizeCsvValue(String(r.source_type)) : String(r.source_type),
      }));

      const XLSX = await import('xlsx');
      const tenantName = (tenant as any).name || (tenant as any).company_name || tenant.id.slice(0, 8);

      if (!isCsv) {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(exportRows);
        ws['!cols'] = [{ wch: 12 }, { wch: 6 }, { wch: 16 }, { wch: 20 }, { wch: 10 }, { wch: 35 }, { wch: 35 }, { wch: 14 }, { wch: 14 }, { wch: 10 }];
        XLSX.utils.book_append_sheet(wb, ws, 'Écritures');

        const infoRows = [
          { 'Champ': 'Entreprise', 'Valeur': tenantName },
          { 'Champ': 'Période du', 'Valeur': exportDateFrom },
          { 'Champ': 'Période au', 'Valeur': exportDateTo },
          { 'Champ': 'Journal', 'Valeur': exportJournal ? (JOURNAL_TYPES[exportJournal] || exportJournal) : 'Tous' },
          { 'Champ': 'Écritures', 'Valeur': String(exportData.entryCount) },
          { 'Champ': 'Lignes exportées', 'Valeur': String(exportData.totalCount) },
          { 'Champ': 'Total débit', 'Valeur': exportData.totalDebitSum.toLocaleString('fr-FR') },
          { 'Champ': 'Total crédit', 'Valeur': exportData.totalCreditSum.toLocaleString('fr-FR') },
          { 'Champ': 'Équilibre', 'Valeur': Math.abs(exportData.totalDebitSum - exportData.totalCreditSum) < 0.01 ? 'Équilibré' : 'Non équilibré' },
          { 'Champ': 'Date export', 'Valeur': new Date().toLocaleString('fr-FR') },
        ];
        const wsInfo = XLSX.utils.json_to_sheet(infoRows);
        wsInfo['!cols'] = [{ wch: 20 }, { wch: 30 }];
        XLSX.utils.book_append_sheet(wb, wsInfo, 'Informations');
        XLSX.writeFile(wb, `ecritures_${tenantName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${exportDateFrom}_${exportDateTo}.xlsx`);
      } else {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(exportRows);
        XLSX.utils.book_append_sheet(wb, ws, 'Écritures');
        const csvContent = XLSX.utils.sheet_to_csv(ws, { FS: ';' });
        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `ecritures_${tenantName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${exportDateFrom}_${exportDateTo}.csv`;
        link.click();
        URL.revokeObjectURL(url);
      }

      success('Export terminé');
      setExportOpen(false);
    } catch (e: any) {
      error(e.message || 'Erreur export');
    }
  };

  const totalDebit = entryLines.reduce((s, l) => s + Number(l.debit), 0);
  const totalCredit = entryLines.reduce((s, l) => s + Number(l.credit), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;

  const updateLine = (idx: number, field: string, val: any) => {
    setEntryLines(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      if (field === 'account_code') {
        const acc = accounts.find(a => a.code === val);
        if (acc) next[idx].account_name = acc.name;
      }
      return next;
    });
  };

  const save = async () => {
    if (!tenant) return;
    if (!form.description.trim()) { error('Description obligatoire'); return; }
    if (!isBalanced) { error("L'écriture n'est pas équilibrée (débit ≠ crédit)"); return; }
    const validLines = entryLines.filter(l => l.account_code && (l.debit > 0 || l.credit > 0));
    if (validLines.length < 2) { error('Au moins 2 lignes sont nécessaires'); return; }
    setSaving(true);
    const { data, error: e } = await supabase.rpc('create_manual_journal_entry', {
      p_tenant_id: tenant.id,
      p_journal_type: form.journal_type,
      p_entry_date: form.entry_date,
      p_description: form.description,
      p_reference: form.reference || '',
      p_lines: validLines.map(l => ({ account_code: l.account_code, debit: l.debit, credit: l.credit, label: l.label })),
    });
    setSaving(false);
    if (e) { error(e.message); return; }
    if (!(data as any)?.success) { error((data as any)?.error || 'Erreur'); return; }
    success(`Écriture ${(data as any).piece_number} enregistrée`);
    setOpen(false);
    setEntryLines([{ account_code: '', account_name: '', debit: 0, credit: 0, label: '' }, { account_code: '', account_name: '', debit: 0, credit: 0, label: '' }]);
    setForm({ journal_type: 'OD', entry_date: new Date().toISOString().slice(0, 10), description: '', reference: '' });
    load();
  };

  const openDetail = async (e: any) => {
    if(!tenant)return;
    setLines([]);setSelected(e); setDetailOpen(true);
    const { data } = await supabase.from('journal_lines').select('*').eq('tenant_id',tenant.id).eq('entry_id', e.id).order('created_at');
    setLines(data || []);
  };

  return (
    <div className="space-y-3">
      <div className="acc-toolbar acc-fixed">
        <select aria-label="Journal" value={journalType} onChange={e=>{setJournalPage(0);setJournalType(e.target.value);}} className="input w-auto"><option value="">Tous les journaux</option>{Object.entries(JOURNAL_TYPES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
        <label>Du <input aria-label="Date de début" type="date" className="input w-auto" value={fromDate} onChange={e=>{setJournalPage(0);setFromDate(e.target.value);}}/></label>
        <label>Au <input aria-label="Date de fin" type="date" className="input w-auto" value={toDate} onChange={e=>{setJournalPage(0);setToDate(e.target.value);}}/></label>
        <span className="acc-spacer"/>
        {canView&&<button onClick={openExportModal} className="btn-secondary"><Download size={16}/>Exporter</button>}
        {canManage&&<button onClick={()=>setOpen(true)} className="btn-primary"><Plus size={16}/>Nouvelle écriture</button>}
      </div>
      {journalError&&<p role="alert" className="text-sm text-red-700">{journalError}</p>}
      <AccountingTable footer={<AccountingPagination page={journalPage} size={journalSize} total={journalTotal} setPage={n=>{setContextRow(null);setJournalPage(n);}} setSize={n=>{setJournalPage(0);setJournalSize(n);}} disabled={loading}/>}>
        <table><thead><tr><th className="text-left">Pièce</th><th className="text-left hidden md:table-cell">Date</th><th className="text-left hidden md:table-cell">Journal</th><th className="text-left">Libellé</th><th className="text-left hidden lg:table-cell">Statut</th><th className="text-right">Débit</th><th className="text-right hidden sm:table-cell">Crédit</th><th className="text-right"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{loading?<tr><td colSpan={8} className="text-center"><Loader2 className="mx-auto animate-spin" size={20}/></td></tr>:entries.length===0?<tr><td colSpan={8} className="text-center text-neutral-500">Aucune écriture sur cette période.</td></tr>:entries.map(e=><tr key={e.id} onContextMenu={event=>{event.preventDefault();setContextRow({id:e.id,x:event.clientX,y:event.clientY});}}>
          <td><button type="button" className="text-left font-medium underline-offset-2 hover:underline" onClick={()=>void openDetail(e)}>{e.entry_number}</button><span className="block md:hidden text-[11px] text-neutral-500">{formatDate(e.entry_date)} · {e.journal_type}</span></td>
          <td className="hidden md:table-cell whitespace-nowrap">{formatDate(e.entry_date)}</td><td className="hidden md:table-cell">{e.journal_type}</td>
          <td className="break-words">{e.description}<span className="block lg:hidden text-[11px] text-neutral-500">{e.status==='posted'?'Validée':e.status==='cancelled'?'Annulée':'Brouillon'}</span></td>
          <td className="hidden lg:table-cell"><span className={'acc-status '+(e.status==='posted'?'valid':e.status==='cancelled'?'cancelled':'draft')}>{e.status==='posted'&&<Check size={13}/>} {e.status==='posted'?'Validée':e.status==='cancelled'?'Annulée':'Brouillon'}</span></td>
          <td className="text-right">{Number(e.total_debit).toLocaleString('fr-FR')}<span className="block sm:hidden text-[10px] text-neutral-500">C : {Number(e.total_credit).toLocaleString('fr-FR')}</span></td>
          <td className="text-right hidden sm:table-cell">{Number(e.total_credit).toLocaleString('fr-FR')}</td>
          <td className="text-right"><AccountingRowActions piece={e.entry_number} onView={()=>void openDetail(e)} anchor={contextRow?.id===e.id?contextRow:undefined} onDismiss={()=>setContextRow(null)}/></td>
        </tr>)}</tbody></table>
      </AccountingTable>

      {/* Create modal */}
      <Modal open={open} onClose={() => setOpen(false)} title="Nouvelle écriture comptable" size="lg"
        footer={<><button onClick={() => setOpen(false)} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button><button onClick={save} disabled={saving || !isBalanced} className="btn-icon-primary disabled:opacity-50" title="Enregistrer">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}</button></>}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="label">Journal *</label>
              <select value={form.journal_type} onChange={e => setForm(f => ({ ...f, journal_type: e.target.value }))} className="input">
                {Object.entries(JOURNAL_TYPES).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Date *</label>
              <input type="date" value={form.entry_date} onChange={e => setForm(f => ({ ...f, entry_date: e.target.value }))} className="input" />
            </div>
            <div>
              <label className="label">Référence</label>
              <input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} className="input" placeholder="N° facture, chèque…" />
            </div>
          </div>
          <div>
            <label className="label">Description *</label>
            <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="input" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Lignes d'écriture</label>
              <button onClick={() => setEntryLines(p => [...p, { account_code: '', account_name: '', debit: 0, credit: 0, label: '' }])} className="btn-icon" title="Ajouter une ligne"><Plus className="w-4 h-4" /></button>
            </div>
            <div className="space-y-2">
              {entryLines.map((l, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-1.5 items-start">
                  <div className="col-span-3">
                    <SearchableSelect
                      options={accounts.map(a => ({ value: a.code, label: `${a.code} ${a.name}` }))}
                      value={l.account_code}
                      onChange={v => updateLine(idx, 'account_code', v)}
                      placeholder="— Compte —"
                    />
                  </div>
                  <div className="col-span-4">
                    <input value={l.label} onChange={e => updateLine(idx, 'label', e.target.value)} placeholder="Libellé" className="input text-xs" />
                  </div>
                  <div className="col-span-2">
                    <input type="number" value={l.debit || ''} onChange={e => updateLine(idx, 'debit', Number(e.target.value))} placeholder="Débit" className="input text-xs" min="0" />
                  </div>
                  <div className="col-span-2">
                    <input type="number" value={l.credit || ''} onChange={e => updateLine(idx, 'credit', Number(e.target.value))} placeholder="Crédit" className="input text-xs" min="0" />
                  </div>
                  <div className="col-span-1 flex items-center justify-end pt-1">
                    <button onClick={() => setEntryLines(p => p.filter((_, i) => i !== idx))} disabled={entryLines.length <= 2} className="p-1 rounded hover:bg-red-50 text-red-400 disabled:opacity-30 text-xs">x</button>
                  </div>
                </div>
              ))}
            </div>
            <div className={`mt-3 pt-3 border-t flex justify-end gap-6 text-sm font-mono ${isBalanced ? 'border-emerald-200' : 'border-slate-200'}`}>
              <span>Débit : <strong>{totalDebit.toLocaleString('fr-FR')}</strong></span>
              <span>Crédit : <strong>{totalCredit.toLocaleString('fr-FR')}</strong></span>
              <span className={isBalanced ? 'text-emerald-700 font-semibold' : 'text-red-600'}>{isBalanced ? 'Équilibrée' : `Écart : ${(totalDebit - totalCredit).toLocaleString('fr-FR')}`}</span>
            </div>
          </div>
        </div>
      </Modal>

      {/* Export modal */}
      <Modal open={exportOpen} onClose={() => !exportLoading && setExportOpen(false)} title="Exporter les écritures comptables" size="lg"
        footer={<>
          <button onClick={() => setExportOpen(false)} disabled={exportLoading} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
          {!exportData ? (
            <button onClick={prepareExport} disabled={exportLoading || !exportDateFrom || !exportDateTo} className="btn-icon-primary disabled:opacity-50" title="Préparer l'export">
              {exportLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            </button>
          ) : (
            <button onClick={downloadExport} className="btn-icon-primary" title="Télécharger">
              <Download className="w-4 h-4" />
            </button>
          )}
        </>}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Date de début *</label>
              <input type="date" value={exportDateFrom} onChange={e => { setExportDateFrom(e.target.value); setExportData(null); }} className="input" disabled={exportLoading} />
            </div>
            <div>
              <label className="label">Date de fin *</label>
              <input type="date" value={exportDateTo} onChange={e => { setExportDateTo(e.target.value); setExportData(null); }} className="input" disabled={exportLoading} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Journal</label>
              <select value={exportJournal} onChange={e => { setExportJournal(e.target.value); setExportData(null); }} className="input" disabled={exportLoading}>
                <option value="">Tous les journaux</option>
                {Object.entries(JOURNAL_TYPES).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Format</label>
              <select value={exportFormat} onChange={e => setExportFormat(e.target.value as 'xlsx' | 'csv')} className="input" disabled={exportLoading}>
                <option value="xlsx">Excel (.xlsx)</option>
                <option value="csv">CSV (séparateur ;)</option>
              </select>
            </div>
          </div>

          {exportError && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              <X className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{exportError}</span>
            </div>
          )}

          {exportProgress && !exportData && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-neutral-500">
                <span>Chargement des lignes…</span>
                <span>{exportProgress.loaded.toLocaleString('fr-FR')} / {exportProgress.total.toLocaleString('fr-FR')}</span>
              </div>
              <div className="w-full bg-neutral-200 rounded-full h-2">
                <div className="bg-brand-600 h-2 rounded-full transition-all" style={{ width: `${exportProgress.total > 0 ? Math.min(100, (exportProgress.loaded / exportProgress.total) * 100) : 0}%` }} />
              </div>
            </div>
          )}

          {exportData && (
            <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                <CheckCircle className="w-4 h-4 shrink-0" />
                <span>Export prêt — choisissez le format puis téléchargez</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-emerald-700">
                <div><span className="font-medium">Période :</span> {exportDateFrom} au {exportDateTo}</div>
                <div><span className="font-medium">Journal :</span> {exportJournal ? (JOURNAL_TYPES[exportJournal] || exportJournal) : 'Tous'}</div>
                <div><span className="font-medium">Écritures :</span> {exportData.entryCount.toLocaleString('fr-FR')}</div>
                <div><span className="font-medium">Lignes :</span> {exportData.totalCount.toLocaleString('fr-FR')}</div>
                <div><span className="font-medium">Total débit :</span> {exportData.totalDebitSum.toLocaleString('fr-FR')}</div>
                <div><span className="font-medium">Total crédit :</span> {exportData.totalCreditSum.toLocaleString('fr-FR')}</div>
              </div>
              <div className={`text-xs font-semibold ${Math.abs(exportData.totalDebitSum - exportData.totalCreditSum) < 0.01 ? 'text-emerald-700' : 'text-red-700'}`}>
                {Math.abs(exportData.totalDebitSum - exportData.totalCreditSum) < 0.01 ? 'Équilibré' : `Non équilibré — écart : ${(exportData.totalDebitSum - exportData.totalCreditSum).toLocaleString('fr-FR')}`}
              </div>
            </div>
          )}

          {!exportData && (
            <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200 text-xs text-neutral-500 space-y-1">
              <p>Seules les écritures <strong>validées</strong> (statut « Validé ») sont exportées.</p>
              <p>Un contrôle d'intégrité (équilibre débit/crédit) est effectué avant chaque export.</p>
              <p>Période maximale : 366 jours.</p>
            </div>
          )}
        </div>
      </Modal>

      {/* Detail modal */}
      <Modal open={detailOpen} onClose={() => setDetailOpen(false)} title={selected ? `Écriture ${selected.entry_number}` : ''} size="lg"
        footer={<button onClick={() => setDetailOpen(false)} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>}>
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div className="card p-3"><div className="text-xs text-slate-500">Journal</div><div className="font-semibold mt-0.5">{JOURNAL_TYPES[selected.journal_type] || selected.journal_type}</div></div>
              <div className="card p-3"><div className="text-xs text-slate-500">Date</div><div className="font-semibold mt-0.5">{formatDate(selected.entry_date)}</div></div>
              <div className="card p-3"><div className="text-xs text-slate-500">Total débit</div><div className="font-bold mt-0.5">{Number(selected.total_debit).toLocaleString('fr-FR')} FCFA</div></div>
              <div className="card p-3"><div className="text-xs text-slate-500">Total crédit</div><div className="font-bold mt-0.5">{Number(selected.total_credit).toLocaleString('fr-FR')} FCFA</div></div>
            </div>
            {selected.source_type && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <FileText className="w-3.5 h-3.5" />
                <span>Source : {selected.source_type === 'reversal' ? 'Extourne' : selected.source_type === 'manual' ? 'Saisie manuelle' : selected.source_type} ({selected.reference})</span>
              </div>
            )}
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[var(--w-surface-el)] text-xs uppercase text-slate-500">
                  <tr><th className="px-1 md:px-4 py-2 text-left">Compte</th><th className="px-1 md:px-4 py-2 text-left">Libellé</th><th className="px-1 md:px-4 py-2 text-right">Débit</th><th className="px-1 md:px-4 py-2 text-right">Crédit</th></tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {lines.map(l => <tr key={l.id}><td className="px-1 md:px-4 py-2.5 font-mono text-xs text-brand-700">{l.account_code}</td><td className="px-1 md:px-4 py-2.5 text-slate-600">{l.label || l.account_name}</td><td className="px-1 md:px-4 py-2.5 text-right font-mono text-xs">{l.debit > 0 ? Number(l.debit).toLocaleString('fr-FR') : '—'}</td><td className="px-1 md:px-4 py-2.5 text-right font-mono text-xs">{l.credit > 0 ? Number(l.credit).toLocaleString('fr-FR') : '—'}</td></tr>)}
                </tbody>
                <tfoot className="bg-[var(--w-surface-el)] border-t border-slate-200 text-xs font-semibold">
                  <tr><td className="px-1 md:px-4 py-2" colSpan={2}>TOTAL</td><td className="px-1 md:px-4 py-2 text-right font-mono">{Number(selected.total_debit).toLocaleString('fr-FR')}</td><td className="px-1 md:px-4 py-2 text-right font-mono">{Number(selected.total_credit).toLocaleString('fr-FR')}</td></tr>
                </tfoot>
              </table>
            </div>
            {tenant && <AccountingEntryReversal key={selected.id} tenantId={tenant.id} entryId={selected.id} canManage={canManage} onPosted={()=>void load(true)} />}
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ===================== BALANCE GENERALE (via RPC) ===================== */
function BalanceTab() {
  const { tenant } = useApp();
  const { success, error: toastError } = useToast();
  const { can } = usePermissions();
  const canManage = can('manage_accounting');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'month' | 'year' | 'all'>('year');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkPayBusy, setBulkPayBusy] = useState(false);
  const [showPurchaseInvoice, setShowPurchaseInvoice] = useState(false);
  const [bulkPayFournBusy, setBulkPayFournBusy] = useState(false);
  const [showCashReview, setShowCashReview] = useState(false);

  const load = async (silent = false) => {
    if (!tenant) return;
    if (!silent) setLoading(true);
    const now = new Date();
    let dateFrom: string | null = null;
    if (period === 'month') dateFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    else if (period === 'year') dateFrom = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);

    const { data: rows, error } = await supabase.rpc('balance_generale', {
      p_tenant_id: tenant.id,
      p_date_from: dateFrom,
      p_date_to: null,
    });
    if (error) { toastError(error.message); setLoading(false); return; }
    setData(rows || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [tenant?.id, period]);
  useRealtimeRefresh(['journal_entries', 'journal_lines', 'accounts'], () => load(true));

  const totalDebit = data.reduce((s: number, r: any) => s + Number(r.total_debit), 0);
  const totalCredit = data.reduce((s: number, r: any) => s + Number(r.total_credit), 0);
  const totalSoldeDebiteur = data.reduce((s: number, r: any) => s + Number(r.solde_debiteur), 0);
  const totalSoldeCrediteur = data.reduce((s: number, r: any) => s + Number(r.solde_crediteur), 0);
  const balancePaging=useAccountingPagination(data,period);

  const comptabiliserTout = async () => {
    if (!tenant || bulkBusy) return;
    setBulkBusy(true);
    try {
      const { data: result, error } = await supabase.rpc('comptabiliser_ventes_en_masse', { p_tenant_id: tenant.id });
      if (error) throw error;
      const r = result as any;
      success(`${r.accounted} vente${r.accounted > 1 ? 's' : ''} comptabilisée${r.accounted > 1 ? 's' : ''} ${r.errors > 0 ? `(${r.errors} erreur${r.errors > 1 ? 's' : ''})` : ''}`);
      load();
    } catch (e: any) { toastError(e.message); }
    finally { setBulkBusy(false); }
  };

  const comptabiliserReglements = async () => {
    if (!tenant || bulkPayBusy) return;
    setBulkPayBusy(true);
    try {
      const { data: result, error } = await supabase.rpc('comptabiliser_reglements_clients_en_masse', { p_tenant_id: tenant.id });
      if (error) throw error;
      const r = result as any;
      success(`${r.accounted} règlement${r.accounted > 1 ? 's' : ''} client${r.accounted > 1 ? 's' : ''} comptabilisé${r.accounted > 1 ? 's' : ''} ${r.errors > 0 ? `(${r.errors} erreur${r.errors > 1 ? 's' : ''})` : ''}`);
      load();
    } catch (e: any) { toastError(e.message); }
    finally { setBulkPayBusy(false); }
  };

  const comptabiliserReglFourn = async () => {
    if (!tenant || bulkPayFournBusy) return;
    setBulkPayFournBusy(true);
    try {
      const { data: result, error } = await supabase.rpc('comptabiliser_reglements_fournisseurs_en_masse', { p_tenant_id: tenant.id });
      if (error) throw error;
      const r = result as any;
      success(`${r.accounted} règlement${r.accounted > 1 ? 's' : ''} fournisseur${r.accounted > 1 ? 's' : ''} comptabilisé${r.accounted > 1 ? 's' : ''} ${r.errors > 0 ? `(${r.errors} erreur${r.errors > 1 ? 's' : ''})` : ''}`);
      if (r.skipped_vault_unconfigured > 0) {
        const count = Number(r.skipped_vault_unconfigured);
        toastError(`${count} règlement${count > 1 ? 's' : ''} en attente. Renseignez le compte du coffre dans Mouvements de caisse.`);
        setShowCashReview(true);
      }
      load();
    } catch (e: any) { toastError(e.message); }
    finally { setBulkPayFournBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="acc-toolbar acc-fixed">
        <select value={period} onChange={e => setPeriod(e.target.value as any)} className="input w-48">
          <option value="month">Mois en cours</option>
          <option value="year">Exercice en cours</option>
          <option value="all">Tout</option>
        </select>
        {canManage && <div className="flex items-center gap-2 flex-wrap">
          <button onClick={comptabiliserTout} disabled={bulkBusy} className="btn-secondary">
            {bulkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
            Ventes
          </button>
          <button onClick={comptabiliserReglements} disabled={bulkPayBusy} className="btn-secondary">
            {bulkPayBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
            Rglts clients
          </button>
          <button type="button" className="btn btn-secondary" aria-expanded={showPurchaseInvoice} onClick={() => setShowPurchaseInvoice(show => !show)}>
            Factures fournisseurs
          </button>
          <button onClick={comptabiliserReglFourn} disabled={bulkPayFournBusy} className="btn-secondary">
            {bulkPayFournBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
            Rglts fournisseurs
          </button>
          <button type="button" className="btn btn-secondary" aria-expanded={showCashReview}
            onClick={() => setShowCashReview(show => !show)}>
            Mouvements de caisse
          </button>
        </div>}
      </div>

      {canManage && tenant && showPurchaseInvoice && (
        <AccountingPurchaseInvoice key={tenant.id} tenantId={tenant.id} onPosted={() => void load(true)} />
      )}
      {canManage && tenant && showCashReview && (
        <AccountingCashReview key={tenant.id} tenantId={tenant.id} onPosted={() => void load(true)} />
      )}

      {loading ? <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
        : data.length === 0 ? (
          <div className="card py-12 text-center text-sm text-neutral-500">Aucune écriture pour la période sélectionnée.</div>
        ) : (
          <AccountingTable footer={<AccountingPagination {...balancePaging}/>}>
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-xs uppercase text-neutral-600">
                  <tr>
                    <th className="px-1 md:px-4 py-3 text-left">Compte</th>
                    <th className="px-1 md:px-4 py-3 text-left">Intitulé</th>
                    <th className="px-1 md:px-4 py-3 text-right">Débit (FCFA)</th>
                    <th className="px-1 md:px-4 py-3 text-right">Crédit (FCFA)</th>
                    <th className="px-1 md:px-4 py-3 text-right">Solde débiteur</th>
                    <th className="px-1 md:px-4 py-3 text-right">Solde créditeur</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {balancePaging.rows.map((r: any) => (
                    <tr key={r.account_code} className="hover:bg-[var(--w-surface-el)]/60">
                      <td className="px-1 md:px-4 py-2.5 font-mono text-xs text-brand-700">{r.account_code}</td>
                      <td className="px-1 md:px-4 py-2.5 text-neutral-700">{r.account_name}</td>
                      <td className="px-1 md:px-4 py-2.5 text-right font-mono text-xs">{Number(r.total_debit) > 0 ? Number(r.total_debit).toLocaleString('fr-FR') : '—'}</td>
                      <td className="px-1 md:px-4 py-2.5 text-right font-mono text-xs">{Number(r.total_credit) > 0 ? Number(r.total_credit).toLocaleString('fr-FR') : '—'}</td>
                      <td className="px-1 md:px-4 py-2.5 text-right font-mono text-xs font-semibold text-neutral-900">{Number(r.solde_debiteur) > 0 ? Number(r.solde_debiteur).toLocaleString('fr-FR') : '—'}</td>
                      <td className="px-1 md:px-4 py-2.5 text-right font-mono text-xs font-semibold text-neutral-900">{Number(r.solde_crediteur) > 0 ? Number(r.solde_crediteur).toLocaleString('fr-FR') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-neutral-50 border-t-2 border-neutral-200 font-semibold text-sm">
                  <tr>
                    <td className="px-1 md:px-4 py-3" colSpan={2}>TOTAL</td>
                    <td className="px-1 md:px-4 py-3 text-right font-mono">{totalDebit.toLocaleString('fr-FR')}</td>
                    <td className="px-1 md:px-4 py-3 text-right font-mono">{totalCredit.toLocaleString('fr-FR')}</td>
                    <td className="px-1 md:px-4 py-3 text-right font-mono text-neutral-900">{totalSoldeDebiteur.toLocaleString('fr-FR')}</td>
                    <td className="px-1 md:px-4 py-3 text-right font-mono text-neutral-900">{totalSoldeCrediteur.toLocaleString('fr-FR')}</td>
                  </tr>
                </tfoot>
              </table>
          </AccountingTable>
        )}
    </div>
  );
}

/* ===================== GRAND LIVRE ===================== */
function GrandLivreTab() {
  const { tenant } = useApp();
  const { error: toastError } = useToast();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'month' | 'year' | 'all'>('month');
  const [accountFilter, setAccountFilter] = useState('');
  const [accounts, setAccounts] = useState<any[]>([]);

  useEffect(() => {
    if (!tenant) return;
    supabase.from('accounts').select('code, name').eq('tenant_id', tenant.id).order('code').then(({ data }) => setAccounts(data || []));
  }, [tenant?.id]);

  const load = async (silent = false) => {
    if (!tenant) return;
    if (!silent) setLoading(true);
    const now = new Date();
    let dateFrom: string | null = null;
    if (period === 'month') dateFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    else if (period === 'year') dateFrom = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);

    const { data: rows, error } = await supabase.rpc('grand_livre', {
      p_tenant_id: tenant.id,
      p_date_from: dateFrom,
      p_date_to: null,
      p_account_code: accountFilter || null,
    });
    if (error) { toastError(error.message); setLoading(false); return; }
    setData(rows || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [tenant?.id, period, accountFilter]);
  useRealtimeRefresh(['journal_entries', 'journal_lines', 'accounts'], () => load(true));

  const groupedByAccount = useMemo(() => {
    const map: Record<string, { code: string; name: string; lines: any[]; totalDebit: number; totalCredit: number }> = {};
    data.forEach((r: any) => {
      if (!map[r.account_code]) map[r.account_code] = { code: r.account_code, name: r.account_name, lines: [], totalDebit: 0, totalCredit: 0 };
      map[r.account_code].lines.push(r);
      map[r.account_code].totalDebit += Number(r.debit);
      map[r.account_code].totalCredit += Number(r.credit);
    });
    return Object.values(map).sort((a, b) => a.code.localeCompare(b.code));
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <select value={period} onChange={e => setPeriod(e.target.value as any)} className="input w-48">
          <option value="month">Mois en cours</option>
          <option value="year">Exercice en cours</option>
          <option value="all">Tout</option>
        </select>
        <div className="w-64">
          <SearchableSelect
            options={[{ value: '', label: 'Tous les comptes' }, ...accounts.map(a => ({ value: a.code, label: `${a.code} — ${a.name}` }))]}
            value={accountFilter}
            onChange={v => setAccountFilter(v)}
            placeholder="Tous les comptes"
          />
        </div>
        <p className="text-sm text-slate-500 ml-auto">{data.length} mouvement{data.length > 1 ? 's' : ''}</p>
      </div>

      {loading ? <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
        : groupedByAccount.length === 0 ? (
          <div className="card py-12 text-center text-sm text-neutral-500">Aucun mouvement pour la période sélectionnée.</div>
        ) : (
          <div className="space-y-4">
            {groupedByAccount.map(group => {
              const solde = group.totalDebit - group.totalCredit;
              return (
                <div key={group.code} className="card overflow-hidden">
                  <div className="px-1 md:px-4 py-2.5 bg-neutral-50 border-b border-neutral-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-brand-700 font-bold">{group.code}</span>
                      <span className="text-sm font-semibold text-neutral-800">{group.name}</span>
                    </div>
                    <span className={`text-xs font-bold font-mono ${solde >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                      Solde : {solde.toLocaleString('fr-FR')} FCFA
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-[10px] uppercase text-neutral-500 bg-white">
                        <tr>
                          <th className="px-1 md:px-4 py-2 text-left">Date</th>
                          <th className="px-1 md:px-4 py-2 text-left">N° Pièce</th>
                          <th className="px-1 md:px-4 py-2 text-left">Journal</th>
                          <th className="px-1 md:px-4 py-2 text-left">Libellé</th>
                          <th className="px-1 md:px-4 py-2 text-right">Débit</th>
                          <th className="px-1 md:px-4 py-2 text-right">Crédit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--w-separator-l)]">
                        {group.lines.map((l: any, idx: number) => (
                          <tr key={idx} className="hover:bg-neutral-50/40">
                            <td className="px-1 md:px-4 py-2 text-xs text-neutral-600">{formatDate(l.entry_date)}</td>
                            <td className="px-1 md:px-4 py-2 font-mono text-xs text-neutral-500">{l.entry_number}</td>
                            <td className="px-1 md:px-4 py-2"><span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-neutral-100 text-neutral-600">{l.journal_type}</span></td>
                            <td className="px-1 md:px-4 py-2 text-neutral-700 text-xs">{l.label || l.reference || '—'}</td>
                            <td className="px-1 md:px-4 py-2 text-right font-mono text-xs">{Number(l.debit) > 0 ? Number(l.debit).toLocaleString('fr-FR') : ''}</td>
                            <td className="px-1 md:px-4 py-2 text-right font-mono text-xs">{Number(l.credit) > 0 ? Number(l.credit).toLocaleString('fr-FR') : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-neutral-50 border-t border-neutral-200 text-xs font-semibold">
                        <tr>
                          <td className="px-1 md:px-4 py-2" colSpan={4}>TOTAL</td>
                          <td className="px-1 md:px-4 py-2 text-right font-mono">{group.totalDebit.toLocaleString('fr-FR')}</td>
                          <td className="px-1 md:px-4 py-2 text-right font-mono">{group.totalCredit.toLocaleString('fr-FR')}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}

/* ===================== BALANCE DES TIERS ===================== */
function TiersTab() {
  const { tenant } = useApp();
  const { error: toastError } = useToast();
  const [tiers, setTiers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<'client' | 'fournisseur'>('client');
  const [selected, setSelected] = useState<any | null>(null);
  const [extrait, setExtrait] = useState<any[]>([]);
  const [extraitLoading, setExtraitLoading] = useState(false);

  const realtimeTick = useRealtimeTick(['journal_entries', 'journal_lines', 'customers', 'suppliers']);

  useEffect(() => {
    if (!tenant) return;
    setLoading(true);
    supabase.rpc('balance_tiers', { p_tenant_id: tenant.id, p_tiers_type: type === 'fournisseur' ? 'supplier' : 'client' })
      .then(({ data, error }) => {
        if (error) toastError(error.message);
        else setTiers(data || []);
        setLoading(false);
      });
  }, [tenant, type, realtimeTick]);

  function loadExtrait(account: any) {
    setSelected(account);
    setExtraitLoading(true);
    supabase.rpc('interrogation_tiers', { p_tenant_id: tenant!.id, p_tiers_id: account.tiers_id, p_tiers_type: type === 'fournisseur' ? 'supplier' : 'client' })
      .then(({ data, error }) => {
        if (error) toastError(error.message);
        else setExtrait(data || []);
        setExtraitLoading(false);
      });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => { setType('client'); setSelected(null); }} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${type === 'client' ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
          Clients
        </button>
        <button onClick={() => { setType('fournisseur'); setSelected(null); }} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${type === 'fournisseur' ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
          Fournisseurs
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-brand-700" /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Balance list */}
          <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
            <div className="px-1 md:px-4 py-3 bg-neutral-50 border-b border-neutral-200">
              <h3 className="text-sm font-semibold text-slate-700">Balance des {type === 'client' ? 'clients' : 'fournisseurs'}</h3>
            </div>
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 sticky top-0">
                  <tr className="text-xs text-neutral-500 uppercase">
                    <th className="px-1 md:px-3 py-2 text-left">Compte</th>
                    <th className="px-1 md:px-3 py-2 text-left">Nom</th>
                    <th className="px-1 md:px-3 py-2 text-right">Débit</th>
                    <th className="px-1 md:px-3 py-2 text-right">Crédit</th>
                    <th className="px-1 md:px-3 py-2 text-right">Solde</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--w-separator-l)]">
                  {tiers.length === 0 && (
                    <tr><td colSpan={5} className="px-1 md:px-4 py-8 text-center text-neutral-400">Aucun tiers trouvé</td></tr>
                  )}
                  {tiers.map((t: any) => (
                    <tr key={t.account_code} onClick={() => loadExtrait(t)} className={`cursor-pointer hover:bg-brand-50/40 transition ${selected?.account_code === t.account_code ? 'bg-brand-50' : ''}`}>
                      <td className="px-1 md:px-3 py-2 font-mono text-xs text-brand-700">{t.account_code}</td>
                      <td className="px-1 md:px-3 py-2 text-neutral-700 truncate max-w-[140px]">{t.tiers_name}</td>
                      <td className="px-1 md:px-3 py-2 text-right font-mono text-xs">{Number(t.total_debit) > 0 ? Number(t.total_debit).toLocaleString('fr-FR') : '—'}</td>
                      <td className="px-1 md:px-3 py-2 text-right font-mono text-xs">{Number(t.total_credit) > 0 ? Number(t.total_credit).toLocaleString('fr-FR') : '—'}</td>
                      <td className={`px-1 md:px-3 py-2 text-right font-mono text-xs font-semibold ${Number(t.solde) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                        {Number(t.solde).toLocaleString('fr-FR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Extrait de compte */}
          <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
            <div className="px-1 md:px-4 py-3 bg-neutral-50 border-b border-neutral-200">
              <h3 className="text-sm font-semibold text-slate-700">
                {selected ? `Extrait — ${selected.account_code} ${selected.tiers_name}` : 'Sélectionnez un tiers'}
              </h3>
            </div>
            {!selected ? (
              <div className="flex items-center justify-center py-16 text-sm text-neutral-400">Cliquez sur un tiers pour voir son extrait</div>
            ) : extraitLoading ? (
              <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-brand-700" /></div>
            ) : (
              <div className="max-h-[60vh] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50 sticky top-0">
                    <tr className="text-xs text-neutral-500 uppercase">
                      <th className="px-1 md:px-3 py-2 text-left">Date</th>
                      <th className="px-1 md:px-3 py-2 text-left">Pièce</th>
                      <th className="px-1 md:px-3 py-2 text-left">Libellé</th>
                      <th className="px-1 md:px-3 py-2 text-right">Débit</th>
                      <th className="px-1 md:px-3 py-2 text-right">Crédit</th>
                      <th className="px-1 md:px-3 py-2 text-right">Solde</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--w-separator-l)]">
                    {extrait.length === 0 && (
                      <tr><td colSpan={6} className="px-1 md:px-4 py-8 text-center text-neutral-400">Aucune écriture</td></tr>
                    )}
                    {extrait.map((e: any, idx: number) => (
                      <tr key={idx} className="hover:bg-[var(--w-surface-el)]/40">
                        <td className="px-1 md:px-3 py-2 text-xs text-neutral-600">{formatDate(e.entry_date)}</td>
                        <td className="px-1 md:px-3 py-2 font-mono text-xs text-neutral-500">{e.entry_number}</td>
                        <td className="px-1 md:px-3 py-2 text-neutral-700 text-xs">{e.label || '—'}</td>
                        <td className="px-1 md:px-3 py-2 text-right font-mono text-xs">{Number(e.debit) > 0 ? Number(e.debit).toLocaleString('fr-FR') : ''}</td>
                        <td className="px-1 md:px-3 py-2 text-right font-mono text-xs">{Number(e.credit) > 0 ? Number(e.credit).toLocaleString('fr-FR') : ''}</td>
                        <td className={`px-1 md:px-3 py-2 text-right font-mono text-xs font-semibold ${Number(e.solde_cumule) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                          {Number(e.solde_cumule).toLocaleString('fr-FR')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ===================== RECHERCHE ECRITURES ===================== */
function SearchTab() {
  const { tenant } = useApp();
  const { error: toastError } = useToast();
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ text: '', journal: '', dateFrom: '', dateTo: '', amountMin: '', amountMax: '' });
  const [detail, setDetail] = useState<any | null>(null);

  const resultPaging=useAccountingPagination(results,JSON.stringify(filters));
  function doSearch() {
    if (!tenant) return;
    setLoading(true);
    const params: any = { p_tenant_id: tenant.id };
    if (filters.text) params.p_search = filters.text;
    if (filters.journal) params.p_journal_type = filters.journal;
    if (filters.dateFrom) params.p_date_from = filters.dateFrom;
    if (filters.dateTo) params.p_date_to = filters.dateTo;
    if (filters.amountMin) params.p_amount_min = Number(filters.amountMin);
    if (filters.amountMax) params.p_amount_max = Number(filters.amountMax);

    supabase.rpc('recherche_ecritures', params)
      .then(({ data, error }) => {
        if (error) toastError(error.message);
        else setResults(data || []);
        setLoading(false);
      });
  }

  return (
    <div className="space-y-4">
      <div className="acc-toolbar">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <input type="text" placeholder="Texte libre (libellé, pièce...)" value={filters.text} onChange={e => setFilters(f => ({ ...f, text: e.target.value }))} className="rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none" />
          <select value={filters.journal} onChange={e => setFilters(f => ({ ...f, journal: e.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none">
            <option value="">Tous journaux</option>
            {Object.entries(JOURNAL_TYPES).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
          </select>
          <input type="date" value={filters.dateFrom} onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none" placeholder="Date début" />
          <input type="date" value={filters.dateTo} onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none" placeholder="Date fin" />
          <input type="number" placeholder="Montant min" value={filters.amountMin} onChange={e => setFilters(f => ({ ...f, amountMin: e.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none" />
          <input type="number" placeholder="Montant max" value={filters.amountMax} onChange={e => setFilters(f => ({ ...f, amountMax: e.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none" />
          <div className="sm:col-span-2 lg:col-span-2 flex items-end">
            <button onClick={doSearch} disabled={loading} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-brand-700 text-white rounded-lg text-sm font-medium hover:bg-brand-800 transition disabled:opacity-50">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Rechercher
            </button>
          </div>
        </div>
      </div>

      {results.length > 0 && (
        <div className="min-w-0">
          <div className="px-1 md:px-4 py-3 bg-neutral-50 border-b border-neutral-200 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">{results.length} résultat{results.length > 1 ? 's' : ''}</span>
          </div>
          <AccountingTable footer={<AccountingPagination {...resultPaging}/>}>
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 sticky top-0">
                <tr className="text-xs text-slate-500 uppercase">
                  <th className="px-1 md:px-4 py-2 text-left">Date</th>
                  <th className="px-1 md:px-4 py-2 text-left">Pièce</th>
                  <th className="px-1 md:px-4 py-2 text-left">Journal</th>
                  <th className="px-1 md:px-4 py-2 text-left">Description</th>
                  <th className="px-1 md:px-4 py-2 text-left hidden sm:table-cell">Référence</th>
                  <th className="px-1 md:px-4 py-2 text-right">Débit</th>
                  <th className="px-1 md:px-4 py-2 text-right">Crédit</th>
                  <th className="px-1 md:px-4 py-2 text-center">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--w-separator-l)]">
                {resultPaging.rows.map((r: any) => (
                  <tr key={r.entry_id} onClick={() => setDetail(r)} className="hover:bg-neutral-50/60 cursor-pointer">
                    <td className="px-1 md:px-4 py-2 text-xs text-neutral-600">{formatDate(r.entry_date)}</td>
                    <td className="px-1 md:px-4 py-2 font-mono text-xs text-neutral-500">{r.entry_number}</td>
                    <td className="px-1 md:px-4 py-2"><span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-neutral-100 text-neutral-600">{r.journal_type}</span></td>
                    <td className="px-1 md:px-4 py-2 text-neutral-700 text-xs max-w-[200px] truncate">{r.description || '—'}</td>
                    <td className="px-1 md:px-4 py-2 text-neutral-500 text-xs max-w-[140px] truncate hidden sm:table-cell">{r.reference || ''}</td>
                    <td className="px-1 md:px-4 py-2 text-right font-mono text-xs">{Number(r.total_debit) > 0 ? Number(r.total_debit).toLocaleString('fr-FR') : ''}</td>
                    <td className="px-1 md:px-4 py-2 text-right font-mono text-xs">{Number(r.total_credit) > 0 ? Number(r.total_credit).toLocaleString('fr-FR') : ''}</td>
                    <td className="px-1 md:px-4 py-2 text-center">
                      <span className={'acc-status '+(r.status==='posted'?'valid':r.status==='cancelled'?'cancelled':'draft')}>
                        {r.status === 'posted' ? 'Validée' : r.status === 'cancelled' ? 'Annulée' : 'Brouillon'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AccountingTable>
        </div>
      )}

      {detail && <SearchDetailModal entry={detail} tenant={tenant!} onClose={() => setDetail(null)} />}
    </div>
  );
}

/* ===================== SEARCH DETAIL MODAL ===================== */
function SearchDetailModal({ entry, tenant, onClose, onReversed }: { entry: any; tenant: { id: string }; onClose: () => void; onReversed?: () => void }) {
  const { can } = usePermissions();
  const [lines, setLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    supabase
      .from('journal_lines')
      .select('id, created_at, account_code, account_name, label, debit, credit')
      .eq('tenant_id', tenant.id)
      .eq('entry_id', entry.entry_id)
      .order('created_at')
      .order('id')
      .then(({ data, error }) => {
        if (error) {
          setLoadError(true);
        } else {
          setLines(data || []);
        }
        setLoading(false);
      });
  }, [entry.entry_id, tenant.id]);

  const totalD = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalC = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const hasLines = lines.length > 0;
  const isBalanced = hasLines && totalD > 0 && totalC > 0 && Math.abs(totalD - totalC) < 0.01;

  return (
    <Modal open onClose={onClose} title={`Écriture ${entry.entry_number}`} size="lg"
      footer={<button onClick={onClose} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>}>
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><span className="text-slate-500">Pièce :</span> <span className="font-mono font-semibold">{entry.entry_number}</span></div>
          <div><span className="text-slate-500">Journal :</span> <span className="font-semibold">{entry.journal_type}</span></div>
          <div><span className="text-slate-500">Date :</span> {formatDate(entry.entry_date)}</div>
          <div>
            <span className="text-slate-500">Statut :</span>{' '}
            <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold ${entry.status === 'posted' ? 'bg-emerald-100 text-emerald-700' : entry.status === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
              {entry.status === 'posted' ? 'Validée' : entry.status === 'cancelled' ? 'Annulée' : 'Brouillon'}
            </span>
          </div>
        </div>
        {entry.description && <div><span className="text-slate-500">Description :</span> {entry.description}</div>}
        {entry.reference && <div><span className="text-slate-500">Référence :</span> {entry.reference}</div>}

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-brand-700" /></div>
        ) : loadError ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center text-sm text-red-700">
            Impossible de charger les lignes de cette écriture
          </div>
        ) : !hasLines ? (
          <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4 text-center text-sm text-neutral-500">
            Aucune ligne comptable
          </div>
        ) : (
          <div className="overflow-x-auto border border-neutral-200 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50">
                <tr className="text-xs text-neutral-500 uppercase">
                  <th className="px-3 py-2 text-left">Compte</th>
                  <th className="px-3 py-2 text-left">Intitulé</th>
                  <th className="px-3 py-2 text-left">Libellé</th>
                  <th className="px-3 py-2 text-right">Débit</th>
                  <th className="px-3 py-2 text-right">Crédit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-2 font-mono text-xs text-brand-700">{l.account_code}</td>
                    <td className="px-3 py-2 text-neutral-700 text-xs">{l.account_name || '—'}</td>
                    <td className="px-3 py-2 text-neutral-600 text-xs">{l.label || '—'}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{Number(l.debit) > 0 ? Number(l.debit).toLocaleString('fr-FR') : ''}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{Number(l.credit) > 0 ? Number(l.credit).toLocaleString('fr-FR') : ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-neutral-50 border-t border-neutral-200">
                <tr className="text-xs font-semibold">
                  <td colSpan={3} className="px-3 py-2 text-right">Total</td>
                  <td className="px-3 py-2 text-right font-mono">{totalD.toLocaleString('fr-FR')}</td>
                  <td className="px-3 py-2 text-right font-mono">{totalC.toLocaleString('fr-FR')}</td>
                </tr>
                {isBalanced ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-1 text-right text-xs font-semibold text-emerald-700">Équilibrée</td>
                  </tr>
                ) : (
                  <tr>
                    <td colSpan={5} className="px-3 py-1 text-right text-xs font-semibold text-red-600">
                      Écart : {(totalD - totalC).toLocaleString('fr-FR')}
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        )}
        <AccountingEntryReversal key={entry.entry_id} tenantId={tenant.id} entryId={entry.entry_id} canManage={can('manage_accounting')} onPosted={onReversed} />
      </div>
    </Modal>
  );
}

/* ===================== CLOTURES ===================== */
function ClotureTab() {
  const { tenant } = useApp();
  const { can } = usePermissions();
  return tenant ? <AccountingPeriodControls key={tenant.id} tenantId={tenant.id} canClose={can('manage_accounting')} /> : null;
}

function VatTab() {
  const { tenant } = useApp();
  return tenant ? <AccountingVatReport key={tenant.id} tenantId={tenant.id} /> : null;
}

function AccountStatementTab() {
  const { tenant } = useApp();
  const { can } = usePermissions();
  const [detail,setDetail]=useState<any>(null);
  const [statementRevision,setStatementRevision]=useState(0);
  useEffect(()=>setDetail(null),[tenant?.id]);
  return tenant ? <><AccountingAccountStatement key={tenant.id} tenantId={tenant.id} canManage={can('manage_accounting')} onView={setDetail} refreshRevision={statementRevision} />{detail&&<SearchDetailModal entry={detail} tenant={tenant} onClose={()=>setDetail(null)} onReversed={()=>setStatementRevision(v=>v+1)} />}</> : null;
}

function BankReconciliationTab() {
 const {tenant}=useApp();
 const {can}=usePermissions();
 return tenant?<AccountingBankReconciliation key={tenant.id} tenantId={tenant.id} canManage={can('manage_accounting')}/>:null;
}

function FiscalYearTab() {
 const {tenant}=useApp();
 const {can}=usePermissions();
 return tenant?<AccountingFiscalYear key={tenant.id} tenantId={tenant.id} canManage={can('manage_accounting')}/>:null;
}

function FinancialReportsTab() {
 const {tenant}=useApp();
 const {can}=usePermissions();
 return tenant?<AccountingFinancialReports key={tenant.id} tenantId={tenant.id} tenantName={tenant.name} canManage={can('manage_accounting')}/>:null;
}
