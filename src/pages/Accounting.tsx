import {useDocumentEditLease} from '../lib/useDocumentEditLease';
import {DocumentEditLeaseBar} from '../components/DocumentEditLeaseBar';
import {AccountingPeriodBooks} from '../components/AccountingPeriodBooks';
import { useRealtimeTick } from '../lib/useRealtimeData';
import { useRealtimeRefresh } from '../lib/useRealtimeData';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Loader2, Save, Pencil as Edit2, Search, CheckCircle, PlayCircle, X, Check, Trash2, Download, FileText } from '../components/Icons';
import {useAccountingJournals} from '../lib/accountingJournals';
import { SearchableSelect } from '../components/SearchableSelect';
import {AccountingEntryTemplates,type EntryTemplate} from '../components/AccountingEntryTemplates';
import {AccountingTemplateWorkspace,type EntryTemplateSource} from '../components/AccountingTemplateWorkspace';
import {AccountingGuide} from '../components/AccountingGuide';
import {AccountingAnalytics} from '../components/AccountingAnalytics';
import {AccountingFixedAssets} from '../components/AccountingFixedAssets';
import {AccountingRevision} from '../components/AccountingRevision';
import {AccountingAging} from '../components/AccountingAging';
import {AccountingJournalSettings} from '../components/AccountingJournalSettings';
import {AccountingOverview} from '../components/AccountingOverview';
import { AccountingPagination, AccountingTable, AccountingRowActions, useAccountingPagination } from '../components/AccountingWorkspace';
import { AccountingMobileActions, AccountingMobileFilters } from '../components/AccountingMobileControls';
import { Modal } from '../components/Modal';
import './accounting-graphite.css';
import { AccountingPlanIO } from '../components/AccountingPlanIO';
import { AccountingCashReview } from '../components/AccountingCashReview';
import { AccountingPurchaseInvoice } from '../components/AccountingPurchaseInvoice';
import { AccountingVatReport } from '../components/AccountingVatReport';
import { AccountingAccountStatement } from '../components/AccountingAccountStatement';
import { AccountingBankReconciliation } from '../components/AccountingBankReconciliation';
import { AccountingFiscalYear } from '../components/AccountingFiscalYear';
import { AccountingFinancialReports } from '../components/AccountingFinancialReports';
import { AccountingSearch } from '../components/AccountingSearch';
import { AccountingPeriodControls } from '../components/AccountingPeriodControls';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import {useAccountingWindowId,mayCloseAccountingWindow,useAccountingWork,useAccountingMobile} from '../context/AccountingWindowContext';
import { useToast } from '../context/ToastContext';
import { usePermissions } from '../lib/permissions';
import { formatDate } from '../lib/format';
import { sanitizeCsvValue } from '../lib/csvSanitize';

type TabKey = 'analytics' | 'assets' | 'revision' | 'aging' | 'journal_settings' | 'overview' | 'entry' | 'templates' | 'guide' | 'plan' | 'journals' | 'balance' | 'grandlivre' | 'tiers' | 'search' | 'cloture' | 'vat' | 'statement' | 'bank' | 'fiscal' | 'financial';


type AccountingProps = {
  section?: TabKey;
  onNavigate?: (route: string) => void;
  inWindow?: boolean;
  onExit?: () => void;
  initialJournal?: string;
  openTemplatesRequest?: number;
  templateSource?: EntryTemplateSource;
};

export function Accounting({ section = 'plan', onNavigate, inWindow = false, onExit, initialJournal, openTemplatesRequest, templateSource }: AccountingProps) {
  const {tenant}=useApp();const {can}=usePermissions();
  const titles: Record<TabKey, string> = {
    analytics: 'Analytique et budgets',
    assets: 'Immobilisations et amortissements',
    revision: 'Révision comptable',
    aging: 'Balance âgée et échéances',
    journal_settings: 'Codes journaux',
    overview: 'Bureau comptable',
    entry: 'Saisie des écritures',
    plan: 'Plan comptable',
    templates: 'Modèles de saisie',
    guide: 'Guide de la comptabilité',
    journals: 'Journaux comptables',
    balance: 'Balance générale',
    grandlivre: 'Grand livre',
    tiers: 'Balance des tiers',
    search: 'Recherche des écritures',
    cloture: 'Clôtures mensuelles',
    vat: 'Situation de TVA',
    statement: 'Interrogation et lettrage',
    bank: 'Rapprochement bancaire',
    fiscal: 'Exercices et reports à nouveau',
    financial: 'États financiers',
  };
  return (
    <div className="accounting-workspace">
      {!inWindow && <header className="acc-titlebar"><h1>{titles[section]}</h1></header>}
      <div className="acc-body" key={section}>
      {section === 'journal_settings' && <AccountingJournalSettings/>}
      {section === 'plan' && <PlanTab />}
      {section === 'overview' && tenant && <AccountingOverview key={tenant.id} tenantId={tenant.id} canManage={can('manage_accounting')} onNavigate={r=>onNavigate?.(r)}/>}
      {section === 'entry' && can('manage_accounting') && <JournalsTab entryOnly initialJournal={initialJournal} openTemplatesRequest={openTemplatesRequest} onManageTemplates={onNavigate ? () => onNavigate('acc_templates') : undefined} onExit={onExit ?? (() => onNavigate?.('acc_journals'))}/>}
      {section === 'journals' && <JournalsTab onNew={onNavigate ? () => onNavigate('acc_entry') : undefined}/>}
      {section === 'templates' && tenant && <AccountingTemplateWorkspace tenantId={tenant.id} canManage={can('manage_accounting')} source={templateSource}/>}
      {section === 'guide' && <AccountingGuide/>}
      {section === 'balance' && <BalanceTab />}
      {section === 'grandlivre' && <GrandLivreTab />}
      {section === 'tiers' && <TiersTab />}
      {section === 'aging' && <AccountingAging/>}
      {section === 'revision' && <AccountingRevision/>}
      {section === 'assets' && <AccountingFixedAssets/>}
      {section === 'analytics' && <AccountingAnalytics/>}
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
  const mobile=useAccountingMobile();
  const work=useAccountingWork();
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

  const planSequence=useRef(0);
  const [planLoading,setPlanLoading]=useState(false),[planError,setPlanError]=useState('');
  const load = async () => {
    if(!tenant)return;const seq=++planSequence.current;setPlanLoading(true);setPlanError('');
    try{const all:any[]=[];for(let offset=0;;offset+=500){const {data,error:e}=await supabase.from('accounts').select('*').eq('tenant_id',tenant.id).order('code').range(offset,offset+499);if(e)throw e;if(seq!==planSequence.current)return;all.push(...(data??[]));if((data??[]).length<500)break;}if(seq===planSequence.current)setList(all);}
    catch(e){if(seq===planSequence.current){setList([]);setPlanError(e&&typeof e==='object'&&'message'in e?String(e.message):'Plan comptable indisponible.');}}
    finally{if(seq===planSequence.current)setPlanLoading(false);}
  };
  useEffect(() => { void load();return()=>{planSequence.current++;}; }, [tenant?.id,work?.revision]);
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
    success(editing ? 'Modifié' : 'Créé'); setOpen(false); work?.refresh();void load();
  };

  const [classFilter,setClassFilter]=useState('');
  const visible=useMemo(()=>filtered.filter(a=>!classFilter||String(a.class)===classFilter),[filtered,classFilter]);
  const paging=useAccountingPagination(visible,search+'|'+classFilter);

  return (
    <div className="acc-fill space-y-3">
      {(!mobile||!open)&&<div className={mobile?'acc-mobile-command-bar':'acc-toolbar acc-fixed'}>
        <input aria-label="Rechercher un compte" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Code ou intitulé…" className={mobile?'input acc-mobile-command-wide acc-mobile-search-input':'input flex-1 min-w-0 sm:max-w-xs'}/>
        <SearchableSelect ariaLabel="Classe" className={mobile?'acc-mobile-selection':'acc-toolbar-select w-40'} searchable={false} clearable={false} wrapLabels={mobile}
          value={classFilter} onChange={setClassFilter}
          options={[{value:'',label:'Toutes les classes'}, ...Array.from({length:8},(_,i)=>({value:String(i+1),label:'Classe '+(i+1)}))]}/>
        {!mobile&&<><span className="acc-spacer"/><AccountingPlanIO accounts={planLoading||planError?[]:list} onImportDone={()=>{work?.refresh();void load();}}/></>}
        {canManage&&<button type="button" onClick={()=>{setEditing(null);setForm({});setOpen(true);}} className="btn-primary"><Plus size={16}/>Nouveau compte</button>}
        {mobile&&<AccountingPlanIO accounts={planLoading||planError?[]:list} onImportDone={()=>{work?.refresh();void load();}}/>}
      </div>}
      {planError&&<p role="alert" className="text-xs text-red-700">{planError}</p>}{planLoading&&<p role="status" className="text-xs">Chargement du plan comptable…</p>}
      {(!mobile||!open)&&<AccountingTable fill footer={<AccountingPagination {...paging} disabled={planLoading}/>}>
        <table><thead><tr><th className="text-left">Compte</th><th className="text-left">Intitulé</th><th className="text-left hidden sm:table-cell">Classe</th><th className="text-right">Actions</th></tr></thead>
          <tbody>{paging.rows.map(a=><tr key={a.id}><td className="font-medium whitespace-nowrap"><button type="button" className="hover:underline" onClick={()=>work?.openAccount(a.code)}>{a.code}</button></td><td>{a.name}</td><td className="hidden sm:table-cell">{a.class}</td><td className="text-right">{canManage&&<button type="button" className="acc-icon" aria-label={'Modifier '+a.code} onClick={()=>{setEditing(a);setForm({...a});setOpen(true);}}><Edit2 size={16}/></button>}</td></tr>)}
          {!visible.length&&<tr><td colSpan={4} className="text-center text-neutral-500">Aucun compte correspondant.</td></tr>}</tbody>
        </table>
      </AccountingTable>}

      {open&&<section className="acc-section-head acc-catalog-editor space-y-2"><div className="acc-toolbar acc-catalog-toolbar"><strong className="text-sm">{editing?'Modifier le compte':'Nouveau compte'}</strong>{!mobile&&<><span className="acc-spacer"/><button type="button" className="btn-secondary" disabled={saving} onClick={()=>setOpen(false)}>Annuler</button><button type="button" className="btn-primary" disabled={saving} onClick={save}>{saving?<Loader2 size={15} className="animate-spin"/>:<Save size={15}/>}Enregistrer</button></>}</div><div className="acc-fields acc-fields-account">
          <div>
            <label className="label">Code (7 chiffres) *</label>
            <input aria-label="Code du compte" inputMode="numeric" value={form.code || ''} onChange={e => setForm({ ...form, code: e.target.value })} className="input font-mono" placeholder="5710000" maxLength={7} disabled={!!editing} />
            {form.code?.length === 7 && <p className="text-xs text-slate-500 mt-1">Classe {form.code.charAt(0)}</p>}
          </div>
          <div><label className="label">Intitulé *<input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} className="input" /></label></div>
        </div>{mobile&&<div className="acc-editor-actions">
          <button type="button" className="btn-secondary" disabled={saving} onClick={()=>setOpen(false)}>Annuler</button>
          <button type="button" className="btn-primary" disabled={saving} onClick={save}>{saving?<Loader2 size={15} className="animate-spin"/>:<Save size={15}/>}Enregistrer</button>
        </div>}</section>}
    </div>
  );
}

/* ===================== JOURNAUX ===================== */
type JournalsTabProps = {
  entryOnly?: boolean;
  onExit?: () => void;
  onNew?: () => void;
  onManageTemplates?: () => void;
  initialJournal?: string;
  openTemplatesRequest?: number;
};

function JournalsTab({entryOnly=false,onExit,onNew,onManageTemplates,initialJournal,openTemplatesRequest}:JournalsTabProps={}) {
  const mobile=useAccountingMobile();
  const windowId=useAccountingWindowId();
  const work=useAccountingWork();
  const { tenant, user } = useApp();
  const journalCatalog=useAccountingJournals(tenant?.id,work?.revision??0);
  const journalOptions=journalCatalog.rows.map(j=>({code:j.code,name:j.name,active:j.is_active}));
  const journalLabels=Object.fromEntries(journalOptions.map(j=>[j.code,j.name]));
  const journalFilterOptions = [
    { value: '', label: 'Tous les journaux' },
    ...journalOptions.map(journal => ({ value: journal.code, label: journal.code + ' — ' + journal.name + (journal.active ? '' : ' (désactivé)') })),
  ];
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
  const [journalDraft,setJournalDraft]=useState<{journal:string;from:string;to:string}|null>(null);
  const [journalDraftError,setJournalDraftError]=useState('');
  const [contextRow,setContextRow]=useState<{id:string;x:number;y:number}|null>(null);
  const loadSequence=useRef(0);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [journalType, setJournalType] = useState('');
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState<{code:string;name:string}[]>([]);
  const [accountLoading,setAccountLoading]=useState(false),[accountError,setAccountError]=useState('');
  const gridRef=useRef<HTMLDivElement>(null);
  const lineSeq=useRef(2);
  const newLine=()=>({key:++lineSeq.current,account_code:'',account_name:'',debit:0,credit:0,label:''});

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

  const [occurrence,setOccurrence]=useState<{id:string;due:string;name:string}|null>(null);
  const [form, setForm] = useState({ journal_type: initialJournal || 'OD', entry_date: new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Dakar'}), description: '', reference: '' });
  const [entryLines, setEntryLines] = useState<{key:number;account_code: string; account_name: string; debit: number; credit: number; label: string }[]>([
    {key:1, account_code: '', account_name: '', debit: 0, credit: 0, label: '' },
    {key:2, account_code: '', account_name: '', debit: 0, credit: 0, label: '' },
  ]);

  const load = async (silent = false) => {
    if (!tenant) return;
    if(entryOnly)return;
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
  useEffect(()=>{void load();return()=>{loadSequence.current++;};},[tenant?.id,journalType,journalPage,journalSize,fromDate,toDate,work?.revision]);
  useRealtimeRefresh(['journal_entries', 'journal_lines'], () => load(true));
  useEffect(()=>{if(!tenant||(!entryOnly&&!open))return;let alive=true;setAccountLoading(true);setAccountError('');void(async()=>{try{const all:{code:string;name:string}[]=[];for(let offset=0;;offset+=500){const {data,error:e}=await supabase.from('accounts').select('code,name').eq('tenant_id',tenant.id).eq('is_active',true).order('code').range(offset,offset+499);if(e)throw e;if(!alive)return;all.push(...(data??[]));if((data??[]).length<500)break;}if(alive)setAccounts(all);}catch(e){if(alive){setAccounts([]);setAccountError(e&&typeof e==='object'&&'message'in e?String(e.message):'Plan comptable indisponible.');}}finally{if(alive)setAccountLoading(false);}})();return()=>{alive=false;};},[tenant?.id,entryOnly,open,work?.revision]);
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
          { 'Champ': 'Journal', 'Valeur': exportJournal ? (journalLabels[exportJournal] || exportJournal) : 'Tous' },
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

  const minor=(v:number)=>Number.isFinite(v)&&v>=0&&Number.isSafeInteger(Math.round(v*100))&&Math.abs(v*100-Math.round(v*100))<0.00001?Math.round(v*100):NaN;
  const debitCents=entryLines.reduce((s,l)=>s+minor(l.debit),0),creditCents=entryLines.reduce((s,l)=>s+minor(l.credit),0);
  const totalDebit=debitCents/100,totalCredit=creditCents/100;
  const isBalanced=Number.isSafeInteger(debitCents)&&debitCents>0&&debitCents===creditCents;
  const usedLines=entryLines.filter(l=>l.account_code||l.label.trim()||l.debit!==0||l.credit!==0);
  const readyLines=usedLines.length>=2&&usedLines.every(l=>accounts.some(a=>a.code===l.account_code)&&Number.isFinite(minor(l.debit))&&Number.isFinite(minor(l.credit))&&(l.debit>0)!==(l.credit>0));
  const updateLine=(idx:number,field:'account_code'|'label'|'debit'|'credit',val:string|number)=>{
    setEntryLines(prev=>prev.map((l,i)=>{if(i!==idx)return l;const next={...l,[field]:val};if(field==='account_code'){next.account_name=accounts.find(a=>a.code===val)?.name??'';if(!next.label&&next.account_name)next.label=form.description;}if(field==='debit'&&Number(val)>0)next.credit=0;if(field==='credit'&&Number(val)>0)next.debit=0;return next;}));
  };
  const focusCell=(key:number,col:string)=>requestAnimationFrame(()=>gridRef.current?.querySelector<HTMLInputElement>('[data-entry-key="'+key+'"][data-entry-col="'+col+'"]')?.focus());
  const addLine=()=>{if(entryLines.length>=500)return;const l=newLine();setEntryLines(p=>[...p,l]);focusCell(l.key,'account');};
  const balanceLine=(idx:number)=>{const l=entryLines[idx];if(!l||!l.account_code||!Number.isSafeInteger(debitCents)||!Number.isSafeInteger(creditCents))return;const diff=debitCents-creditCents-minor(l.debit)+minor(l.credit);if(!Number.isSafeInteger(diff)||!diff)return;setEntryLines(p=>p.map((row,i)=>i===idx?{...row,debit:Math.max(0,-diff)/100,credit:Math.max(0,diff)/100}:row));};
  const applyTemplate = (template: EntryTemplate, scheduled = false) => {
    const journal = template.journal_code;
    const due = scheduled ? template.next_due_on : null;
    if (!journal || (scheduled && !due)) return false;
    if (!journalOptions.some(option => option.code === journal && option.active)
        || template.lines.some(line => !accounts.some(account => account.code === line.account_code))) {
      error('Le modèle comporte un journal ou un compte inactif.');
      return false;
    }
    if ((form.description.trim() || form.reference.trim() || usedLines.length)
        && !window.confirm('Remplacer la saisie actuelle par ce modèle ?')) return false;
    setOccurrence(due ? { id: template.id, due, name: template.name } : null);
    setForm(previous => ({ ...previous, journal_type: journal, entry_date: due ?? previous.entry_date, description: template.description, reference: '' }));
    setEntryLines(template.lines.map(line => ({
      ...newLine(), ...line, account_name: accounts.find(account => account.code === line.account_code)?.name ?? '',
    })));
    return true;
  };
  const dirtyEntry=!!(form.description.trim()||form.reference.trim()||usedLines.length);
  const editLease=useDocumentEditLease({tenantId:tenant?.id,userId:user?.id,kind:'accounting_journal',resource:form.journal_type+':'+form.entry_date.slice(0,7),enabled:canManage&&(entryOnly||open)&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(form.entry_date),dirty:dirtyEntry,saving});
  const savingLock=useRef(false);
  const save = async (releaseAfter=false) => {
    if (!tenant || savingLock.current || !canManage) return;
    if(!editLease.held||!editLease.token){error('Vous ne détenez pas l’accès en modification de ce journal.');return;}
    if(journalCatalog.loading||journalCatalog.error||!journalOptions.some(j=>j.code===form.journal_type&&j.active)){error('Sélectionnez un journal actif.');return;}
    if (!form.description.trim()) { error('Description obligatoire'); return; }
    if (!isBalanced||!readyLines||accountLoading||accountError) { error('Contrôlez les comptes, les montants et l’équilibre de la pièce.'); return; }
    const validLines=entryLines.filter(l=>l.account_code||l.label.trim()||l.debit!==0||l.credit!==0);
    if(validLines.length<2){error('Au moins 2 lignes sont nécessaires');return;}
    if(validLines.some(l=>!l.account_code||!Number.isFinite(l.debit)||!Number.isFinite(l.credit)||l.debit<0||l.credit<0||(l.debit>0)===(l.credit>0))){error('Chaque ligne renseignée doit comporter un compte et un seul montant positif au débit ou au crédit.');return;}
    savingLock.current=true;
    setSaving(true);
    try{
      const payload={p_tenant_id:tenant.id,p_description:form.description,p_reference:form.reference||'',p_lines:validLines.map(l=>({account_code:l.account_code,debit:l.debit,credit:l.credit,label:l.label}))};
      const manualPayload={...payload,p_journal_type:form.journal_type,p_entry_date:form.entry_date};
      let pendingKey:string|null=null;
      let requestId:string|null=null;
      if(!occurrence){
        if(!user?.id)throw new Error('Session utilisateur indisponible.');
        // Preserve the request identity through a lost response or reload in this tab.
        // Only a digest and UUID are stored, never the contents of the accounting entry.
        const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(manualPayload)));
        const fingerprint=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
        const prefix='waarwi:manual-post:'+user.id+':'+tenant.id+':';
        pendingKey=prefix+fingerprint;
        requestId=sessionStorage.getItem(pendingKey);
        if(!requestId){
          const otherPending=Array.from({length:sessionStorage.length},(_,i)=>sessionStorage.key(i)).some(k=>k?.startsWith(prefix));
          if(otherPending&&!window.confirm('Une autre demande de comptabilisation reste sans confirmation. Vérifiez le journal avant de créer cette nouvelle écriture. Continuer ?'))return;
          requestId=crypto.randomUUID();
          sessionStorage.setItem(pendingKey,requestId);
        }
      }
      const {data,error:e}=occurrence?await supabase.rpc(releaseAfter?'post_locked_template_and_release':'post_locked_template_occurrence',{...payload,p_template_id:occurrence.id,p_due_on:occurrence.due,p_window_id:editLease.windowId,p_lock_token:editLease.token}):await supabase.rpc(releaseAfter?'post_locked_manual_entry_and_release':'post_locked_manual_entry',{...manualPayload,p_request_id:requestId,p_window_id:editLease.windowId,p_lock_token:editLease.token});
      if(e){error(e.message+(!occurrence?' — En cas de réponse incertaine, réessayez la même saisie sans la modifier.':''));return;}
      if(!(data as any)?.success){error((data as any)?.error||'Erreur');return;}
      if(pendingKey&&sessionStorage.getItem(pendingKey)===requestId)sessionStorage.removeItem(pendingKey);
      success('Écriture '+(data as any).piece_number+' enregistrée'+(releaseAfter&&(data as any).lock_released?' │ accès libéré':''));
      if(releaseAfter)void editLease.action('status');
      setOpen(false);
      setOccurrence(null);setEntryLines([newLine(),newLine()]);
      setForm(p=>({...p,entry_date:occurrence?new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Dakar'}):p.entry_date,description:'',reference:''}));
      work?.refresh();void load();
    }catch(e){error(e instanceof Error?e.message:'Impossible d’enregistrer l’écriture.');}
    finally{savingLock.current=false;setSaving(false);}
  };

  const openDetail = (e:any,reverse=false)=>work?.openPiece({entryId:e.id,entryNumber:e.entry_number,reverse});

  useEffect(()=>{
    if(!entryOnly&&!open)return;
    const beforeNavigate=(event:Event)=>{
      if(!mayCloseAccountingWindow(event,windowId)||event.defaultPrevented)return;
      if(savingLock.current){event.preventDefault();return;}
      const dirty=!!(form.description.trim()||form.reference.trim()||entryLines.some(l=>l.account_code||l.label||l.debit||l.credit));
      if(dirty&&!window.confirm('Une écriture est en cours de saisie. Quitter sans enregistrer ?'))event.preventDefault();
    };
    window.addEventListener('waarwi:accounting-before-navigate',beforeNavigate);
    return()=>window.removeEventListener('waarwi:accounting-before-navigate',beforeNavigate);
  },[entryOnly,open,form,entryLines,windowId]);
  const closeEntry=()=>{if(saving)return;if(entryOnly&&windowId){onExit?.();return;}const dirty=!!(form.description.trim()||form.reference.trim()||entryLines.some(l=>l.account_code||l.label||l.debit||l.credit));if(dirty&&!window.confirm('Abandonner la saisie en cours ?'))return;if(entryOnly)onExit?.();else setOpen(false);};
  const entryForm=( <div className="acc-entry-body space-y-2" onPointerDownCapture={editLease.markActivity} onKeyDownCapture={editLease.markActivity} onInputCapture={editLease.markActivity}>
                  <div className="acc-entry-header">
            <div>
              <label className="label">Journal *</label>
              {mobile?<SearchableSelect ariaLabel="Journal de saisie" value={form.journal_type} clearable={false} wrapLabels
                searchable={journalOptions.length>10} disabled={saving||!!occurrence||!!initialJournal||journalCatalog.loading||!!journalCatalog.error}
                options={journalOptions.filter(j=>j.active||j.code===form.journal_type).map(j=>({value:j.code,label:j.code+' — '+j.name,disabled:!j.active}))}
                onChange={value=>setForm(f=>({...f,journal_type:value}))}/>:<select aria-label="Journal de saisie" value={form.journal_type} onChange={e => setForm(f => ({ ...f, journal_type: e.target.value }))} className="input" disabled={saving||!!occurrence||!!initialJournal||journalCatalog.loading||!!journalCatalog.error}>
                {journalOptions.filter(j=>j.active||j.code===form.journal_type).map(j => <option key={j.code} value={j.code} disabled={!j.active}>{j.code} — {j.name}{!j.active?' (désactivé)':''}</option>)}
              </select>}
            </div>
            <div>
              <label className="label">Date *</label>
              <input type="date" aria-label="Date comptable" min="2000-01-01" max={new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Dakar'})} value={form.entry_date} onChange={e => setForm(f => ({ ...f, entry_date: e.target.value }))} className="input" disabled={saving||!!occurrence} />
            </div>
          </div>
        <DocumentEditLeaseBar lease={editLease} dirty={dirtyEntry} saving={saving} label={form.journal_type+" │ "+form.entry_date.slice(0,7)} onSaveAndRelease={dirtyEntry&&isBalanced&&readyLines&&!!form.description.trim()&&!accountLoading&&!accountError&&!journalCatalog.loading&&!journalCatalog.error?()=>void save(true):undefined}/>
        {tenant&&<AccountingEntryTemplates
          tenantId={tenant.id}
          canSave={canManage&&isBalanced&&readyLines&&!!form.description.trim()&&journalOptions.some(j=>j.code===form.journal_type&&j.active)&&!accountLoading&&!accountError}
          journal={form.journal_type}
          description={form.description}
          lines={usedLines.map(({account_code,label,debit,credit})=>({account_code,label,debit,credit}))}
          onApply={applyTemplate}
          onCreate={work?.openTemplate}
          onManage={onManageTemplates}
          openRequest={openTemplatesRequest}
          accounts={accounts}
          readyToApply={!saving&&!accountLoading&&!accountError&&!journalCatalog.loading&&!journalCatalog.error}
        />}
        <fieldset disabled={saving||!editLease.held} className="space-y-2" onKeyDown={e=>{if((e.target as HTMLElement).closest('.acc-template-strip'))return;if(e.ctrlKey&&e.key==='Enter'){e.preventDefault();void save();}else if(e.key==='F2'){e.preventDefault();addLine();}}}>
          {(journalCatalog.error||accountError)&&<p role="alert" className="text-xs text-red-700">{journalCatalog.error||accountError}</p>}
          {occurrence&&<div className="acc-toolbar"><strong className="text-xs">Échéance mensuelle : {occurrence.name} │ {formatDate(occurrence.due)}</strong><span className="acc-spacer"/><button type="button" className="btn-secondary" onClick={()=>{if(window.confirm('Détacher cette échéance ? La saisie actuelle sera effacée et l’échéance restera à traiter.')){setOccurrence(null);setEntryLines([newLine(),newLine()]);setForm(p=>({...p,description:'',reference:'',entry_date:new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Dakar'})}));}}}>Annuler l’échéance</button></div>}
          <div className="acc-entry-descriptions">
            <label className="label">Référence
              <input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} className="input" placeholder="N° facture, chèque…" />
            </label>
            <label className="label">Description *
            <input aria-label="Description de l’écriture" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="input" />
            </label>
          </div>

          <div className="acc-entry-grid" ref={gridRef}>
            <div className="acc-toolbar"><strong className="text-xs">Lignes d'écriture</strong><span className="acc-spacer"/><span className="text-[11px] text-neutral-500 hidden md:inline">F2 Ajouter │ F4 Contrepartie │ Ctrl+Entrée Valider</span><button type="button" className="btn-secondary" onClick={addLine} disabled={entryLines.length>=500}><Plus size={15}/>Ligne</button></div>
            {accountLoading&&<p className="text-xs">Chargement du plan comptable…</p>}
            <datalist id={'acc-entry-accounts-'+windowId}>{accounts.map(a=><option key={a.code} value={a.code}>{a.name}</option>)}</datalist>
            <div className="acc-entry-grid-head"><span>N°</span><span>Compte / intitulé</span><span>Libellé</span><span>Débit (FCFA)</span><span>Crédit (FCFA)</span><span>Actions</span></div>
            {entryLines.map((l,idx)=><div className="acc-entry-grid-row" key={l.key} onKeyDown={e=>{
              const col=(e.target as HTMLElement).dataset.entryCol;if(!col)return;
              if(e.key==='F4'){e.preventDefault();balanceLine(idx);return;}
              if(e.key==='Enter'&&!e.ctrlKey&&!e.altKey){e.preventDefault();const cols=['account','label','debit','credit'];const i=cols.indexOf(col);if(i>=0&&i<3)focusCell(l.key,cols[i+1]);else if(idx+1<entryLines.length)focusCell(entryLines[idx+1].key,'account');else addLine();}
            }}>
              <span className="acc-line-number">{mobile?'Ligne ':''}{idx+1}</span>
              <div className="acc-entry-account"><input list={'acc-entry-accounts-'+windowId} aria-label={'Compte ligne '+(idx+1)} className="input" data-entry-key={l.key} data-entry-col="account" value={l.account_code} onChange={e=>updateLine(idx,'account_code',e.target.value)} placeholder="N° compte" autoComplete="off"/><span className="text-[10px] text-neutral-500">{l.account_name||(!l.account_code?'':accountLoading?'Chargement…':'Compte à vérifier')}</span></div>
              <input aria-label={'Libellé ligne '+(idx+1)} className="input" data-entry-key={l.key} data-entry-col="label" value={l.label} onChange={e=>updateLine(idx,'label',e.target.value)} placeholder="Libellé"/>
              {(['debit','credit'] as const).map(side=>{
                const label=side==='debit'?'Débit':'Crédit';
                const input=<input key={side} type="number" inputMode="decimal" aria-label={label+' ligne '+(idx+1)} className="input acc-entry-amount" min="0" step="0.01" data-entry-key={l.key} data-entry-col={side} value={l[side]||''} onChange={e=>updateLine(idx,side,Number(e.target.value))} placeholder={mobile?'0':label}/>;
                return mobile?<label className="acc-mobile-field acc-entry-amount-field" data-side={side} key={side}>{label}{input}</label>:input;
              })}
              <div className="acc-entry-line-actions"><button type="button" className={mobile?'btn-secondary':'acc-icon'} title="Calculer la contrepartie (F4)" aria-label={'Contrepartie ligne '+(idx+1)} disabled={!l.account_code} onClick={()=>balanceLine(idx)}><Check size={14}/>{mobile&&'Contrepartie'}</button><button type="button" className="acc-icon" aria-label={'Retirer ligne '+(idx+1)} disabled={entryLines.length<=2} onClick={()=>setEntryLines(p=>p.filter(row=>row.key!==l.key))}><Trash2 size={14}/></button></div>
            </div>)}
          </div>

        </fieldset></div> );
  const entryFooter=<div className="acc-entry-footer"><div className="acc-entry-totals"><span>Débit <strong>{totalDebit.toLocaleString('fr-FR')}</strong></span><span>Crédit <strong>{totalCredit.toLocaleString('fr-FR')}</strong></span><span className={isBalanced?'text-neutral-900':'text-red-600'}>{isBalanced?'Équilibrée':'Écart : '+(totalDebit-totalCredit).toLocaleString('fr-FR')}</span></div><div className="acc-editor-actions flex flex-wrap justify-end gap-2"><button type="button" onClick={closeEntry} className="btn-secondary" disabled={saving}>Annuler</button><button type="button" onClick={()=>void save()} className="btn-primary" disabled={saving||!editLease.held||!isBalanced||!readyLines||accountLoading||!!accountError||journalCatalog.loading||!!journalCatalog.error||!journalOptions.some(j=>j.code===form.journal_type&&j.active)}>{saving?<Loader2 size={16} className="animate-spin"/>:<Save size={16}/>}Enregistrer</button></div></div>;
  if(entryOnly)return <section className="acc-entry-page">{entryForm}{entryFooter}</section>;

    const journalFilters=<>
        <SearchableSelect ariaLabel="Journal" className="acc-toolbar-select w-52" searchable={false} clearable={false} wrapLabels
          value={journalType} options={journalFilterOptions} onChange={value=>{setJournalPage(0);setJournalType(value);}}/>
        <label>Du <input aria-label="Date de début" type="date" className="input w-auto" value={fromDate} onChange={e=>{setJournalPage(0);setFromDate(e.target.value);}}/></label>
        <label>Au <input aria-label="Date de fin" type="date" className="input w-auto" value={toDate} onChange={e=>{setJournalPage(0);setToDate(e.target.value);}}/></label>
    </>;
    const newEntry=()=>work&&journalOptions.some(j=>j.code===journalType&&j.active)?work.openEntry(journalType):onNew?onNew():setOpen(true);
    const applyJournalFilters=()=>{
      if(!journalDraft)return;
      if(journalDraft.from&&journalDraft.to&&journalDraft.from>journalDraft.to){setJournalDraftError('La date de fin doit suivre la date de début.');return;}
      setJournalPage(0);
      setJournalType(journalDraft.journal);
      setFromDate(journalDraft.from);
      setToDate(journalDraft.to);
      setJournalDraft(null);
    };
    const activeFilterCount=Number(!!journalType)+Number(!!fromDate||!!toDate);
    const closeExport=()=>{if(!exportLoading)setExportOpen(false);};
    const exportActions=<>
      <button type="button" className="btn-secondary" disabled={exportLoading} onClick={closeExport}>Fermer</button>
      {exportData?<button type="button" className="btn-primary" onClick={downloadExport}><Download size={15}/>Télécharger</button>:
        <button type="button" className="btn-primary" disabled={exportLoading||!exportDateFrom||!exportDateTo} onClick={prepareExport}>
          {exportLoading?<Loader2 size={15} className="animate-spin"/>:<Search size={15}/>}Préparer
        </button>}
    </>;
    const exportFields=exportOpen&&<div className="space-y-3">
      <div className={mobile?'acc-mobile-date-fields':'acc-fields acc-fields-2'}>
        <label className={mobile?'acc-mobile-field':'label'}>Date de début *
          <input type="date" value={exportDateFrom} onChange={e=>{setExportDateFrom(e.target.value);setExportData(null);}} className="input" disabled={exportLoading}/>
        </label>
        <label className={mobile?'acc-mobile-field':'label'}>Date de fin *
          <input type="date" value={exportDateTo} onChange={e=>{setExportDateTo(e.target.value);setExportData(null);}} className="input" disabled={exportLoading}/>
        </label>
      </div>
      <div className={mobile?'acc-mobile-filter-fields':'acc-fields acc-fields-2'}>
        <SearchableSelect label="Journal" className={mobile?'':'acc-filter-select'} searchable={false} clearable={false} wrapLabels
          value={exportJournal} options={journalFilterOptions} disabled={exportLoading}
          onChange={value=>{setExportJournal(value);setExportData(null);}}/>
        <SearchableSelect label="Format" className={mobile?'':'acc-filter-select'} searchable={false} clearable={false} wrapLabels
          value={exportFormat} options={[{value:'xlsx',label:'Excel (.xlsx)'},{value:'csv',label:'CSV (séparateur ;)'}]}
          disabled={exportLoading} onChange={value=>setExportFormat(value as 'xlsx' | 'csv')}/>
      </div>
      {exportError&&<div role="alert" className="flex items-start gap-2 text-xs text-red-700"><X className="w-4 h-4 mt-0.5 shrink-0"/>{exportError}</div>}
      {exportProgress&&!exportData&&<div className="space-y-1">
        <div className="flex justify-between text-xs text-neutral-500"><span>Chargement des lignes…</span>
          <span>{exportProgress.loaded.toLocaleString('fr-FR')} / {exportProgress.total.toLocaleString('fr-FR')}</span>
        </div>
        <progress className="acc-progress" aria-label="Progression de l’export comptable" max={exportProgress.total||1} value={exportProgress.loaded}/>
      </div>}
      {exportData&&<div className="acc-section-head space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900"><CheckCircle className="w-4 h-4 shrink-0"/>
          <span>Export prêt — choisissez le format puis téléchargez</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-neutral-700">
          <div><span className="font-medium">Période :</span> {exportDateFrom} au {exportDateTo}</div>
          <div><span className="font-medium">Journal :</span> {exportJournal?(journalLabels[exportJournal]||exportJournal):'Tous'}</div>
          <div><span className="font-medium">Écritures :</span> {exportData.entryCount.toLocaleString('fr-FR')}</div>
          <div><span className="font-medium">Lignes :</span> {exportData.totalCount.toLocaleString('fr-FR')}</div>
          <div><span className="font-medium">Total débit :</span> {exportData.totalDebitSum.toLocaleString('fr-FR')}</div>
          <div><span className="font-medium">Total crédit :</span> {exportData.totalCreditSum.toLocaleString('fr-FR')}</div>
        </div>
        <div className={`text-xs font-semibold ${Math.abs(exportData.totalDebitSum-exportData.totalCreditSum)<0.01?'text-emerald-700':'text-red-700'}`}>
          {Math.abs(exportData.totalDebitSum-exportData.totalCreditSum)<0.01?'Équilibré':`Non équilibré — écart : ${(exportData.totalDebitSum-exportData.totalCreditSum).toLocaleString('fr-FR')}`}
        </div>
      </div>}
      {!exportData&&<p className="text-xs text-neutral-500">L’export contient les écritures validées sur une période de 366 jours au maximum. Waarwi vérifie leur équilibre avant le téléchargement.</p>}
    </div>;
    return (
    <div className="acc-fill space-y-3">
      {mobile?<div className="acc-mobile-command-bar acc-mobile-journal-commands">
        <button type="button" className="btn-secondary" aria-haspopup="dialog" onClick={()=>{
          setJournalDraft({journal:journalType,from:fromDate,to:toDate});setJournalDraftError('');
        }}>Filtres{activeFilterCount?' ('+activeFilterCount+')':''}</button>
        {canManage&&<button type="button" onClick={newEntry} className="btn-primary"><Plus size={16}/>Nouvelle écriture</button>}
        <AccountingMobileActions title="Actions du journal" actions={[
          ...(canView?[{label:'Exporter',icon:<Download size={16}/>,run:openExportModal}]:[]),
          ...(canManage&&work?[{label:'Appeler un modèle',icon:<FileText size={16}/>,run:()=>work.openEntry(journalOptions.some(j=>j.code===journalType&&j.active)?journalType:'',true)}]:[]),
        ]}/>
        {activeFilterCount>0&&<p className="acc-mobile-command-wide acc-mobile-command-caption">{journalLabels[journalType]||'Tous les journaux'}{fromDate?' │ Du '+formatDate(fromDate):''}{toDate?' │ Au '+formatDate(toDate):''}</p>}
        {journalDraft&&<AccountingMobileFilters open title="Filtres des journaux" onClose={()=>setJournalDraft(null)} onReset={()=>{
          setJournalDraft({journal:'',from:'',to:''});setJournalDraftError('');
        }} onApply={applyJournalFilters}>
          <SearchableSelect label="Journal" searchable={false} clearable={false} wrapLabels value={journalDraft.journal} options={journalFilterOptions}
            onChange={value=>setJournalDraft(previous=>previous&&({...previous,journal:value}))}/>
          <div className="acc-mobile-date-fields">
            <label className="acc-mobile-field">Du<input type="date" aria-label="Date de début" className="input" value={journalDraft.from}
              onChange={event=>{const value=event.target.value;setJournalDraft(previous=>previous&&({...previous,from:value}));setJournalDraftError('');}}/></label>
            <label className="acc-mobile-field">Au<input type="date" aria-label="Date de fin" className="input" value={journalDraft.to}
              onChange={event=>{const value=event.target.value;setJournalDraft(previous=>previous&&({...previous,to:value}));setJournalDraftError('');}}/></label>
          </div>
          {journalDraftError&&<p role="alert" className="text-xs text-red-700">{journalDraftError}</p>}
        </AccountingMobileFilters>}
      </div>:<div className="acc-toolbar acc-fixed">
        {journalFilters}
        <span className="acc-spacer"/>
        {canView&&<button onClick={openExportModal} className="btn-secondary"><Download size={16}/>Exporter</button>}
        {canManage&&work&&<button type="button" onClick={()=>work.openEntry(journalOptions.some(j=>j.code===journalType&&j.active)?journalType:'',true)} className="btn-secondary"><FileText size={16}/>Appeler un modèle</button>}
        {canManage&&<button type="button" onClick={newEntry} className="btn-primary"><Plus size={16}/>Nouvelle écriture</button>}
      </div>}
      {journalError&&<p role="alert" className="text-sm text-red-700">{journalError}</p>}
      <AccountingTable fill label="Écritures du journal" footer={<AccountingPagination page={journalPage} size={journalSize} total={journalTotal} setPage={n=>{setContextRow(null);setJournalPage(n);}} setSize={n=>{setJournalPage(0);setJournalSize(n);}} disabled={loading}/>}>
        <table><thead><tr><th className="text-left">{mobile?'Pièce / date':'Pièce'}</th><th className="text-left hidden md:table-cell acc-desktop-only">Date</th><th className="text-left hidden md:table-cell acc-desktop-only">Journal</th><th className="text-left acc-desktop-only">Libellé</th><th className="text-left hidden lg:table-cell">Statut</th><th className="text-right">Débit</th><th className={mobile?'text-right':'text-right hidden sm:table-cell'}>Crédit</th><th className="text-right"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{loading?<tr><td colSpan={8} className="text-center"><Loader2 className="mx-auto animate-spin" size={20}/></td></tr>:entries.length===0?<tr><td colSpan={8} className="text-center text-neutral-500">Aucune écriture sur cette période.</td></tr>:entries.map(e=><tr key={e.id} onContextMenu={event=>{event.preventDefault();setContextRow({id:e.id,x:event.clientX,y:event.clientY});}}>
          <td>{mobile?<details className="acc-mobile-line">
           <summary>{e.entry_number}<span>{formatDate(e.entry_date)}</span></summary>
           <span>{e.description}</span>
           <span>{e.journal_type} │ {e.status==='posted'?'Validée':e.status==='cancelled'?'Annulée':'Brouillon'}</span>
           <button type="button" onClick={()=>void openDetail(e)}>Ouvrir la pièce</button>
          </details>:<button type="button" className="text-left font-medium underline-offset-2 hover:underline" onClick={()=>void openDetail(e)}>{e.entry_number}</button>}</td>
          <td className="hidden md:table-cell whitespace-nowrap acc-desktop-only">{formatDate(e.entry_date)}</td><td className="hidden md:table-cell acc-desktop-only">{e.journal_type}</td>
          <td className="break-words acc-desktop-only">{e.description}<span className="block lg:hidden text-[11px] text-neutral-500">{e.status==='posted'?'Validée':e.status==='cancelled'?'Annulée':'Brouillon'}</span></td>
          <td className="hidden lg:table-cell"><span className={'acc-status '+(e.status==='posted'?'valid':e.status==='cancelled'?'cancelled':'draft')}>{e.status==='posted'&&<Check size={13}/>} {e.status==='posted'?'Validée':e.status==='cancelled'?'Annulée':'Brouillon'}</span></td>
          <td className="text-right">{Number(e.total_debit).toLocaleString('fr-FR')}{!mobile&&<span className="block sm:hidden text-[10px] text-neutral-500">C : {Number(e.total_credit).toLocaleString('fr-FR')}</span>}</td>
          <td className={mobile?'text-right':'text-right hidden sm:table-cell'}>{Number(e.total_credit).toLocaleString('fr-FR')}</td>
          <td className="text-right"><AccountingRowActions piece={e.entry_number} onView={()=>openDetail(e)} onTemplate={canManage&&work&&e.status!=='cancelled'?()=>work.openPiece({entryId:e.id,entryNumber:e.entry_number,selectTemplateLines:true}):undefined} onReverse={canManage&&e.source_type==='manual'&&e.status==='posted'?()=>void openDetail(e,true):undefined} reverseDisabledReason={canManage?(e.source_type==='reversal'?'Pièce d’extourne':e.source_type!=='manual'?'Corriger la pièce d’origine':e.status!=='posted'?'Écriture non validée':undefined):'Droit de gestion requis'} anchor={contextRow&&contextRow.id===e.id?contextRow:undefined} onDismiss={()=>setContextRow(null)}/></td>
        </tr>)}</tbody></table>
      </AccountingTable>

      {/* Create modal — retained fallback for embedded use */}
      {open&&<section className="acc-section-head">{entryForm}{entryFooter}</section>}

      {exportOpen&&(mobile?<Modal open title="Export comptable" onClose={closeExport} size="sm" layer="top" variant="flat" focusOnOpen
        panelClassName="accounting-workspace acc-mobile-sheet acc-mobile-export-sheet" footer={exportActions}>{exportFields}</Modal>:
        <section className="acc-section-head space-y-3">
          <div className="acc-toolbar"><strong className="text-sm">Export comptable</strong><span className="acc-spacer"/>{exportActions}</div>
          {exportFields}
        </section>)}

    </div>
  );
}

/* ===================== BALANCE GENERALE (via RPC) ===================== */
function BalanceTab() {
  const work=useAccountingWork();
  const { tenant } = useApp();
  const { success, error: toastError } = useToast();
  const { can } = usePermissions();
  const canManage = can('manage_accounting');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkReport,setBulkReport]=useState<{label:string;posted:number;errors:number;details:{reference:string;error:string}[];skipped:string[]}|null>(null);
  const showBulkReport=(label:string,r:any,client=false)=>{
    if(r?.success!==true)throw new Error(r?.error??'Comptabilisation non confirmée.');
    const posted=Number(r.accounted??0)+(client?Number(r.balance_payments_accounted??0):0);
    const errors=Number(r.errors??0)+(client?Number(r.balance_payments_errors??0):0);
    const details=(Array.isArray(r.error_details)?r.error_details:[]).map((x:any)=>({reference:String(x.sale??x.order??x.payment_id??x.customer_payment_id??'—'),error:String(x.error??'Erreur non précisée')}));
    const skipped=[['skipped_no_balance','Sans effet sur le solde'],['skipped_overpaid','Trop-perçus'],['skipped_unconfirmed','Non confirmés'],['skipped_invalid','Données invalides'],['skipped_order_not_accounted','Achats non comptabilisés'],['skipped_vault_unconfigured','Coffre non configuré'],['skipped_treasury_unconfigured','Trésorerie non configurée']].filter(([k])=>Number(r[k]??0)>0).map(([k,l])=>l+' : '+Number(r[k]));
    setBulkReport({label,posted,errors,details,skipped});
    if(errors>0)toastError(posted+' pièce(s) comptabilisée(s), '+errors+' erreur(s). Consultez le compte rendu.');
    else success(posted+' pièce(s) comptabilisée(s).');
  };
  const [bulkPayBusy, setBulkPayBusy] = useState(false);
  const [showPurchaseInvoice, setShowPurchaseInvoice] = useState(false);
  const [bulkPayFournBusy, setBulkPayFournBusy] = useState(false);
  const [showCashReview, setShowCashReview] = useState(false);

  const load=()=>work?.refresh();

  const comptabiliserTout = async () => {
    if (!tenant || !canManage || bulkBusy || bulkPayBusy || bulkPayFournBusy) return;
    setBulkReport(null);
    setBulkBusy(true);
    try {
      const { data: result, error } = await supabase.rpc('comptabiliser_ventes_en_masse', { p_tenant_id: tenant.id });
      if (error) throw error;
      const r = result as any;
      showBulkReport('Ventes',r);
      load();
    } catch (e: any) { toastError(e.message); }
    finally { setBulkBusy(false); }
  };

  const comptabiliserReglements = async () => {
    if (!tenant || !canManage || bulkBusy || bulkPayBusy || bulkPayFournBusy) return;
    setBulkReport(null);
    setBulkPayBusy(true);
    try {
      const { data: result, error } = await supabase.rpc('comptabiliser_reglements_clients_en_masse', { p_tenant_id: tenant.id });
      if (error) throw error;
      const r = result as any;
      showBulkReport('Règlements clients',r,true);
      load();
    } catch (e: any) { toastError(e.message); }
    finally { setBulkPayBusy(false); }
  };

  const comptabiliserReglFourn = async () => {
    if (!tenant || !canManage || bulkBusy || bulkPayBusy || bulkPayFournBusy) return;
    setBulkReport(null);
    setBulkPayFournBusy(true);
    try {
      const { data: result, error } = await supabase.rpc('comptabiliser_reglements_fournisseurs_en_masse', { p_tenant_id: tenant.id });
      if (error) throw error;
      const r = result as any;
      showBulkReport('Règlements fournisseurs',r);
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
    <div className="acc-fill space-y-4">
      {canManage && <div className="acc-toolbar acc-posting-actions" aria-label="Comptabilisation des opérations">
          <span className="acc-field-label">Comptabiliser</span>
          <button onClick={comptabiliserTout} disabled={bulkBusy||bulkPayBusy||bulkPayFournBusy} className="btn-secondary">
            {bulkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
            Ventes
          </button>
          <button onClick={comptabiliserReglements} disabled={bulkBusy||bulkPayBusy||bulkPayFournBusy} className="btn-secondary">
            {bulkPayBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
            Règlements clients
          </button>
          <button type="button" className="btn btn-secondary" aria-expanded={showPurchaseInvoice} onClick={() => setShowPurchaseInvoice(show => !show)}>
            Factures fournisseurs
          </button>
          <button onClick={comptabiliserReglFourn} disabled={bulkBusy||bulkPayBusy||bulkPayFournBusy} className="btn-secondary">
            {bulkPayFournBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
            Règlements fournisseurs
          </button>
          <button type="button" className="btn btn-secondary" aria-expanded={showCashReview}
            onClick={() => setShowCashReview(show => !show)}>
            Mouvements de caisse
          </button>
      </div>}

      {canManage && tenant && showPurchaseInvoice && (
        <AccountingPurchaseInvoice key={tenant.id} tenantId={tenant.id} onPosted={() => void load()} />
      )}
      {canManage && tenant && showCashReview && (
        <AccountingCashReview key={tenant.id} tenantId={tenant.id} onPosted={() => void load()} />
      )}

      {bulkReport&&<section className="acc-section-head space-y-2" aria-live="polite">
        <div className="acc-toolbar"><strong className="text-sm">Compte rendu — {bulkReport.label}</strong><span className="acc-spacer"/><button type="button" className="btn-secondary" onClick={()=>setBulkReport(null)}>Fermer</button></div>
        <p className="text-xs">{bulkReport.posted} pièce(s) comptabilisée(s) │ {bulkReport.errors} erreur(s)</p>
        {bulkReport.skipped.length>0&&<p className="text-xs">{bulkReport.skipped.join(' │ ')}</p>}
        {bulkReport.details.length>0&&<details open><summary className="text-xs cursor-pointer">Détail des opérations en erreur ({bulkReport.details.length})</summary><div className="max-h-64 overflow-auto"><table className="w-full text-xs"><thead><tr><th>Référence</th><th>Motif</th></tr></thead><tbody>{bulkReport.details.map((d,i)=><tr key={i}><td className="break-all">{d.reference}</td><td>{d.error}</td></tr>)}</tbody></table></div></details>}
      </section>}
      <AccountingPeriodBooks mode="balance"/>
    </div>
  );
}

/* ===================== GRAND LIVRE ===================== */
function GrandLivreTab(){return <AccountingPeriodBooks mode="ledger"/>;}

/* ===================== BALANCE DES TIERS ===================== */
type ThirdPartyBalance = {
  tiers_id: string;
  account_code: string;
  tiers_name: string;
  total_debit: number;
  total_credit: number;
  solde: number;
};

type ThirdPartyLine = {
  entry_number: string;
  entry_date: string;
  label: string | null;
  debit: number;
  credit: number;
  solde_cumule: number;
};

const formatAccountingAmount = (value: number) => Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
const formatMovement = (value: number) => Number(value) ? formatAccountingAmount(value) : '—';

function TiersTab() {
  const { tenant } = useApp();
  const work = useAccountingWork();
  const { error: toastError } = useToast();
  const [tiers, setTiers] = useState<ThirdPartyBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<'client' | 'fournisseur'>('client');
  const [selected, setSelected] = useState<ThirdPartyBalance | null>(null);
  const [extrait, setExtrait] = useState<ThirdPartyLine[]>([]);
  const [extraitLoading, setExtraitLoading] = useState(false);
  const extractRequest = useRef(0);
  const realtimeTick = useRealtimeTick(['journal_entries', 'journal_lines', 'customers', 'suppliers']);
  const apiType = type === 'fournisseur' ? 'supplier' : 'client';

  useEffect(() => {
    if (!tenant) return;
    let active = true;
    setLoading(true);
    void supabase.rpc('balance_tiers', { p_tenant_id: tenant.id, p_tiers_type: apiType })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) toastError(error.message);
        setTiers(error ? [] : (data ?? []) as ThirdPartyBalance[]);
        setLoading(false);
      });
    return () => { active = false; };
  }, [tenant?.id, apiType, realtimeTick]);

  useEffect(() => () => { extractRequest.current++; }, [tenant?.id]);
  const tiersPaging = useAccountingPagination(tiers, type);
  const extraitPaging = useAccountingPagination(extrait, selected?.tiers_id ?? '');

  const selectType = (next: typeof type) => {
    if (next === type) return;
    extractRequest.current++;
    setType(next);
    setSelected(null);
    setExtrait([]);
    setExtraitLoading(false);
  };

  const loadExtrait = async (account: ThirdPartyBalance) => {
    if (!tenant) return;
    const request = ++extractRequest.current;
    setSelected(account);
    setExtrait([]);
    setExtraitLoading(true);
    const { data, error } = await supabase.rpc('interrogation_tiers', {
      p_tenant_id: tenant.id,
      p_tiers_id: account.tiers_id,
      p_tiers_type: apiType,
    });
    if (request !== extractRequest.current) return;
    if (error) toastError(error.message);
    else setExtrait((data ?? []) as ThirdPartyLine[]);
    setExtraitLoading(false);
  };

  const category = type === 'client' ? 'clients' : 'fournisseurs';
  return <section className="acc-third-parties acc-fill space-y-3">
    <div className="acc-tabs" role="group" aria-label="Type de tiers">
      <button type="button" className="acc-tab" aria-pressed={type === 'client'} onClick={() => selectType('client')}>Clients</button>
      <button type="button" className="acc-tab" aria-pressed={type === 'fournisseur'} onClick={() => selectType('fournisseur')}>Fournisseurs</button>
    </div>
    <div className="acc-third-party-panels">
      <section className="acc-third-party-pane" aria-label={`Balance des ${category}`}>
        <h2 className="acc-section-title">Balance des {category}</h2>
        <AccountingTable fill label={`Balance des ${category}`} footer={<AccountingPagination {...tiersPaging} disabled={loading} />}>
          <table className="acc-third-party-table">
            <thead><tr><th className="text-left">Tiers / compte</th><th className="text-right acc-amount-col">Débit</th><th className="text-right acc-amount-col">Crédit</th><th className="text-right">Solde (FCFA)</th></tr></thead>
            <tbody>
              {!loading && tiersPaging.rows.map(row => (
                <tr key={`${row.tiers_id}:${row.account_code}`} data-selected={selected?.tiers_id === row.tiers_id}>
                  <td><button type="button" className="acc-table-link" aria-pressed={selected?.tiers_id === row.tiers_id} onClick={() => void loadExtrait(row)}>{row.tiers_name}</button><span className="acc-table-meta">{row.account_code}</span><span className="acc-table-meta acc-amount-compact">D {formatMovement(row.total_debit)} │ C {formatMovement(row.total_credit)}</span></td>
                  <td className="text-right acc-amount-col">{formatMovement(row.total_debit)}</td>
                  <td className="text-right acc-amount-col">{formatMovement(row.total_credit)}</td>
                  <td className="text-right font-semibold">{formatAccountingAmount(row.solde)}</td>
                </tr>
              ))}
              {(loading || !tiersPaging.total) && <tr><td colSpan={4} className="acc-table-empty" role="status">{loading ? 'Chargement de la balance…' : 'Aucun tiers à afficher.'}</td></tr>}
            </tbody>
          </table>
        </AccountingTable>
      </section>

      {selected && <section className="acc-third-party-pane" aria-label="Extrait du tiers">
        <div className="acc-section-title"><h2>{selected.tiers_name}</h2><span className="acc-table-meta">Extrait │ {selected.account_code}</span></div>
        <AccountingTable fill label="Mouvements du tiers" footer={<AccountingPagination {...extraitPaging} disabled={extraitLoading} />}>
          <table className="acc-third-party-table">
            <thead><tr><th className="text-left">Pièce / libellé</th><th className="text-right acc-amount-col">Débit</th><th className="text-right acc-amount-col">Crédit</th><th className="text-right">Solde (FCFA)</th></tr></thead>
            <tbody>
              {!extraitLoading && extraitPaging.rows.map((line, index) => (
                <tr key={`${line.entry_number}:${index}`}>
                  <td><button type="button" className="acc-table-link" onClick={() => work?.openPiece({entryNumber: line.entry_number})}>{line.entry_number}</button><span className="acc-table-meta">{formatDate(line.entry_date)}</span>{line.label && <span className="acc-table-meta">{line.label}</span>}<span className="acc-table-meta acc-amount-compact">D {formatMovement(line.debit)} │ C {formatMovement(line.credit)}</span></td>
                  <td className="text-right acc-amount-col">{formatMovement(line.debit)}</td>
                  <td className="text-right acc-amount-col">{formatMovement(line.credit)}</td>
                  <td className="text-right font-semibold">{formatAccountingAmount(line.solde_cumule)}</td>
                </tr>
              ))}
              {(extraitLoading || !extraitPaging.total) && <tr><td colSpan={4} className="acc-table-empty" role="status">{extraitLoading ? 'Chargement de l’extrait…' : 'Aucune écriture pour ce tiers.'}</td></tr>}
            </tbody>
          </table>
        </AccountingTable>
      </section>}
    </div>
  </section>;
}

/* ===================== RECHERCHE ECRITURES ===================== */
function SearchTab(){return <AccountingSearch/>;}

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
  const {tenant}=useApp();const {can}=usePermissions();const work=useAccountingWork();
  return tenant?<AccountingAccountStatement key={tenant.id} tenantId={tenant.id} canManage={can('manage_accounting')} refreshRevision={work?.revision??0} onView={r=>work?.openPiece({entryId:r.entry_id,entryNumber:r.entry_number})}/>:null;
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
