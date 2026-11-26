import {AccountingPeriodBooks} from '../components/AccountingPeriodBooks';
import { useRealtimeTick } from '../lib/useRealtimeData';
import { useRealtimeRefresh } from '../lib/useRealtimeData';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Loader2, Save, Pencil as Edit2, Search, CheckCircle, PlayCircle, X, Check, Trash2, Download } from '../components/Icons';
import {useAccountingJournals} from '../lib/accountingJournals';
import {AccountingEntryTemplates,type EntryTemplate} from '../components/AccountingEntryTemplates';
import {AccountingAnalytics} from '../components/AccountingAnalytics';
import {AccountingFixedAssets} from '../components/AccountingFixedAssets';
import {AccountingRevision} from '../components/AccountingRevision';
import {AccountingAging} from '../components/AccountingAging';
import {AccountingJournalSettings} from '../components/AccountingJournalSettings';
import {AccountingOverview} from '../components/AccountingOverview';
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
import { AccountingSearch } from '../components/AccountingSearch';
import { AccountingPeriodControls } from '../components/AccountingPeriodControls';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import {useAccountingWindowId,mayCloseAccountingWindow,useAccountingWork} from '../context/AccountingWindowContext';
import { useToast } from '../context/ToastContext';
import { usePermissions } from '../lib/permissions';
import { SearchableSelect } from '../components/SearchableSelect';
import { formatDate } from '../lib/format';
import { sanitizeCsvValue } from '../lib/csvSanitize';

type TabKey = 'analytics' | 'assets' | 'revision' | 'aging' | 'journal_settings' | 'overview' | 'entry' | 'plan' | 'journals' | 'balance' | 'grandlivre' | 'tiers' | 'search' | 'cloture' | 'vat' | 'statement' | 'bank' | 'fiscal' | 'financial';


export function Accounting({ section = 'plan',onNavigate,inWindow=false,onExit }: { section?: TabKey;onNavigate?:(route:string)=>void;inWindow?:boolean;onExit?:()=>void }) {
  const {tenant}=useApp();const {can}=usePermissions();
  const titles: Record<TabKey, { t: string; s: string }> = {
    analytics:{t:'Analytique et budgets',s:'Ventilation des charges et produits, budgets et réalisations.'},
    assets:{t:'Immobilisations et amortissements',s:'Registre des biens, plans et dotations comptables.'},
    revision:{t:'Révision comptable',s:'Dossiers mensuels, contrôles et justificatifs.'},
    aging:{t:'Balance âgée et échéances',s:'Postes ouverts et échéances comptables.'},
    journal_settings:{t:'Codes journaux',s:'Paramétrage des journaux comptables.'},
    overview: {t:'Accueil comptable',s:'Situation et accès directs.'},
    entry: {t:'Saisie des écritures',s:'Nouvelle pièce comptable.'},
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
      {!inWindow&&<header className="acc-titlebar"><div><h1>{meta.t}</h1><p>{meta.s}</p></div><span className="acc-module">Comptabilité</span></header>}
      <div className="acc-body" key={section}>
      {section === 'journal_settings' && <AccountingJournalSettings/>}
      {section === 'plan' && <PlanTab />}
      {section === 'overview' && tenant && <AccountingOverview key={tenant.id} tenantId={tenant.id} canManage={can('manage_accounting')} onNavigate={r=>onNavigate?.(r)}/>}
      {section === 'entry' && can('manage_accounting') && <JournalsTab entryOnly onExit={onExit??(()=>onNavigate?.('acc_journals'))}/>}
      {section === 'journals' && <JournalsTab onNew={onNavigate?()=>onNavigate('acc_entry'):undefined}/>}
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
    <div className="space-y-3">
      <div className="acc-toolbar acc-fixed">
        <input aria-label="Rechercher un compte" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Code ou intitulé…" className="input flex-1 min-w-0 sm:max-w-xs"/>
        <select aria-label="Classe" value={classFilter} onChange={e=>setClassFilter(e.target.value)} className="input w-auto"><option value="">Toutes les classes</option>{[1,2,3,4,5,6,7,8].map(c=><option key={c} value={c}>Classe {c}</option>)}</select>
        <span className="acc-spacer"/><AccountingPlanIO accounts={planLoading||planError?[]:list} onImportDone={()=>{work?.refresh();void load();}}/>
        {canManage&&<button type="button" onClick={()=>{setEditing(null);setForm({});setOpen(true);}} className="btn-primary"><Plus size={16}/>Nouveau compte</button>}
      </div>
      {planError&&<p role="alert" className="text-xs text-red-700">{planError}</p>}{planLoading&&<p role="status" className="text-xs">Chargement du plan comptable…</p>}
      <AccountingTable footer={<AccountingPagination {...paging} disabled={planLoading}/>}>
        <table><thead><tr><th className="text-left">Compte</th><th className="text-left">Intitulé</th><th className="text-left hidden sm:table-cell">Classe</th><th className="text-right">Actions</th></tr></thead>
          <tbody>{paging.rows.map(a=><tr key={a.id}><td className="font-medium whitespace-nowrap"><button type="button" className="hover:underline" onClick={()=>work?.openAccount(a.code)}>{a.code}</button></td><td>{a.name}</td><td className="hidden sm:table-cell">{a.class}</td><td className="text-right">{canManage&&<button type="button" className="acc-icon" aria-label={'Modifier '+a.code} onClick={()=>{setEditing(a);setForm({...a});setOpen(true);}}><Edit2 size={16}/></button>}</td></tr>)}
          {!visible.length&&<tr><td colSpan={4} className="text-center text-neutral-500">Aucun compte correspondant.</td></tr>}</tbody>
        </table>
      </AccountingTable>

      {open&&<section className="acc-section-head space-y-2"><div className="acc-toolbar"><strong className="text-sm">{editing?'Modifier le compte':'Nouveau compte'}</strong><span className="acc-spacer"/><button type="button" className="btn-secondary" disabled={saving} onClick={()=>setOpen(false)}>Annuler</button><button type="button" className="btn-primary" disabled={saving} onClick={save}>{saving?<Loader2 size={15} className="animate-spin"/>:<Save size={15}/>}Enregistrer</button></div><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div>
            <label className="label">Code (7 chiffres) *</label>
            <input value={form.code || ''} onChange={e => setForm({ ...form, code: e.target.value })} className="input font-mono" placeholder="5710000" maxLength={7} disabled={!!editing} />
            {form.code?.length === 7 && <p className="text-xs text-slate-500 mt-1">Classe {form.code.charAt(0)}</p>}
          </div>
          <div><label className="label">Intitulé *</label><input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} className="input" /></div>
        </div></section>}
    </div>
  );
}

/* ===================== JOURNAUX ===================== */
function JournalsTab({entryOnly=false,onExit,onNew}:{entryOnly?:boolean;onExit?:()=>void;onNew?:()=>void}={}) {
  const windowId=useAccountingWindowId();
  const work=useAccountingWork();
  const { tenant } = useApp();
  const journalCatalog=useAccountingJournals(tenant?.id,work?.revision??0);
  const journalOptions=journalCatalog.rows.map(j=>({code:j.code,name:j.name,active:j.is_active}));
  const journalLabels=Object.fromEntries(journalOptions.map(j=>[j.code,j.name]));
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
  const [form, setForm] = useState({ journal_type: 'OD', entry_date: new Date().toISOString().slice(0, 10), description: '', reference: '' });
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
  const applyTemplate=(t:EntryTemplate,scheduled=false)=>{if(scheduled&&!t.next_due_on)return;if((form.description.trim()||form.reference.trim()||usedLines.length)&&!window.confirm('Remplacer la saisie actuelle par ce modèle ?'))return;if(!journalOptions.some(j=>j.code===t.journal_code&&j.active)||t.lines.some(l=>!accounts.some(a=>a.code===l.account_code))){error('Le modèle comporte un journal ou un compte inactif.');return;}setOccurrence(scheduled&&t.next_due_on?{id:t.id,due:t.next_due_on,name:t.name}:null);setForm(p=>({...p,journal_type:t.journal_code,entry_date:scheduled&&t.next_due_on?t.next_due_on:p.entry_date,description:t.description,reference:''}));setEntryLines(t.lines.map(l=>({...newLine(),...l,account_name:accounts.find(a=>a.code===l.account_code)?.name??''})));};
  const savingLock=useRef(false);
  const save = async () => {
    if (!tenant || savingLock.current || !canManage) return;
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
      const {data,error:e}=occurrence?await supabase.rpc('post_accounting_template_occurrence',{...payload,p_template_id:occurrence.id,p_due_on:occurrence.due}):await supabase.rpc('create_manual_journal_entry',{...payload,p_journal_type:form.journal_type,p_entry_date:form.entry_date});
      if(e){error(e.message);return;}
      if(!(data as any)?.success){error((data as any)?.error||'Erreur');return;}
      success('Écriture '+(data as any).piece_number+' enregistrée');
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
  const entryForm=( <fieldset disabled={saving} className="acc-entry-body space-y-2" onKeyDown={e=>{if((e.target as HTMLElement).closest('.acc-template-strip'))return;if(e.ctrlKey&&e.key==='Enter'){e.preventDefault();void save();}else if(e.key==='F2'){e.preventDefault();addLine();}}}>
          {(journalCatalog.error||accountError)&&<p role="alert" className="text-xs text-red-700">{journalCatalog.error||accountError}</p>}
          {tenant&&<AccountingEntryTemplates tenantId={tenant.id} canSave={canManage&&isBalanced&&readyLines&&!!form.description.trim()&&journalOptions.some(j=>j.code===form.journal_type&&j.active)&&!accountLoading&&!accountError} journal={form.journal_type} description={form.description} lines={usedLines.map(({account_code,label,debit,credit})=>({account_code,label,debit,credit}))} onApply={applyTemplate}/>}
          {occurrence&&<div className="acc-toolbar"><strong className="text-xs">Échéance mensuelle : {occurrence.name} · {formatDate(occurrence.due)}</strong><span className="acc-spacer"/><button type="button" className="btn-secondary" onClick={()=>{if(window.confirm('Détacher cette échéance ? La saisie actuelle sera effacée et l’échéance restera à traiter.')){setOccurrence(null);setEntryLines([newLine(),newLine()]);setForm(p=>({...p,description:'',reference:'',entry_date:new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Dakar'})}));}}}>Annuler l’échéance</button></div>}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="label">Journal *</label>
              <select value={form.journal_type} onChange={e => setForm(f => ({ ...f, journal_type: e.target.value }))} className="input" disabled={!!occurrence||journalCatalog.loading||!!journalCatalog.error}>
                {journalOptions.filter(j=>j.active||j.code===form.journal_type).map(j => <option key={j.code} value={j.code} disabled={!j.active}>{j.code} — {j.name}{!j.active?' (désactivé)':''}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Date *</label>
              <input type="date" value={form.entry_date} onChange={e => setForm(f => ({ ...f, entry_date: e.target.value }))} className="input" disabled={!!occurrence} />
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

          <div className="acc-entry-grid" ref={gridRef}>
            <div className="acc-toolbar"><strong className="text-xs">Lignes d'écriture</strong><span className="acc-spacer"/><span className="text-[11px] text-neutral-500 hidden md:inline">F2 Ajouter · F4 Contrepartie · Ctrl+Entrée Valider</span><button type="button" className="btn-secondary" onClick={addLine} disabled={entryLines.length>=500}><Plus size={15}/>Ligne</button></div>
            {accountLoading&&<p className="text-xs">Chargement du plan comptable…</p>}
            <datalist id={'acc-entry-accounts-'+windowId}>{accounts.map(a=><option key={a.code} value={a.code}>{a.name}</option>)}</datalist>
            <div className="acc-entry-grid-head"><span>N°</span><span>Compte / intitulé</span><span>Libellé</span><span>Débit (FCFA)</span><span>Crédit (FCFA)</span><span>Actions</span></div>
            {entryLines.map((l,idx)=><div className="acc-entry-grid-row" key={l.key} onKeyDown={e=>{
              const col=(e.target as HTMLElement).dataset.entryCol;if(!col)return;
              if(e.key==='F4'){e.preventDefault();balanceLine(idx);return;}
              if(e.key==='Enter'&&!e.ctrlKey&&!e.altKey){e.preventDefault();const cols=['account','label','debit','credit'];const i=cols.indexOf(col);if(i>=0&&i<3)focusCell(l.key,cols[i+1]);else if(idx+1<entryLines.length)focusCell(entryLines[idx+1].key,'account');else addLine();}
            }}>
              <span className="acc-line-number">{idx+1}</span>
              <div className="acc-entry-account"><input list={'acc-entry-accounts-'+windowId} aria-label={'Compte ligne '+(idx+1)} className="input" data-entry-key={l.key} data-entry-col="account" value={l.account_code} onChange={e=>updateLine(idx,'account_code',e.target.value)} placeholder="N° compte" autoComplete="off"/><span className="text-[10px] text-neutral-500">{l.account_name||(!l.account_code?'':accountLoading?'Chargement…':'Compte à vérifier')}</span></div>
              <input aria-label={'Libellé ligne '+(idx+1)} className="input" data-entry-key={l.key} data-entry-col="label" value={l.label} onChange={e=>updateLine(idx,'label',e.target.value)} placeholder="Libellé"/>
              <input type="number" inputMode="decimal" aria-label={'Débit ligne '+(idx+1)} className="input acc-entry-amount" min="0" step="0.01" data-entry-key={l.key} data-entry-col="debit" value={l.debit||''} onChange={e=>updateLine(idx,'debit',Number(e.target.value))} placeholder="Débit"/>
              <input type="number" inputMode="decimal" aria-label={'Crédit ligne '+(idx+1)} className="input acc-entry-amount" min="0" step="0.01" data-entry-key={l.key} data-entry-col="credit" value={l.credit||''} onChange={e=>updateLine(idx,'credit',Number(e.target.value))} placeholder="Crédit"/>
              <div className="acc-entry-line-actions"><button type="button" className="acc-icon" title="Calculer la contrepartie (F4)" aria-label={'Contrepartie ligne '+(idx+1)} disabled={!l.account_code} onClick={()=>balanceLine(idx)}><Check size={14}/></button><button type="button" className="acc-icon" aria-label={'Retirer ligne '+(idx+1)} disabled={entryLines.length<=2} onClick={()=>setEntryLines(p=>p.filter(row=>row.key!==l.key))}><Trash2 size={14}/></button></div>
            </div>)}
          </div>

        </fieldset> );
  const entryFooter=<div className="acc-entry-footer"><div className="acc-entry-totals"><span>Débit <strong>{totalDebit.toLocaleString('fr-FR')}</strong></span><span>Crédit <strong>{totalCredit.toLocaleString('fr-FR')}</strong></span><span className={isBalanced?'text-neutral-900':'text-red-600'}>{isBalanced?'Équilibrée':'Écart : '+(totalDebit-totalCredit).toLocaleString('fr-FR')}</span></div><div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={closeEntry} className="btn-secondary" disabled={saving}>Annuler</button><button type="button" onClick={save} className="btn-primary" disabled={saving||!isBalanced||!readyLines||accountLoading||!!accountError||journalCatalog.loading||!!journalCatalog.error||!journalOptions.some(j=>j.code===form.journal_type&&j.active)}>{saving?<Loader2 size={16} className="animate-spin"/>:<Save size={16}/>}Enregistrer</button></div></div>;
  if(entryOnly)return <section className="acc-entry-page">{entryForm}{entryFooter}</section>;

    return (
    <div className="space-y-3">
      <div className="acc-toolbar acc-fixed">
        <select aria-label="Journal" value={journalType} onChange={e=>{setJournalPage(0);setJournalType(e.target.value);}} className="input w-auto"><option value="">Tous les journaux</option>{journalOptions.map(j=><option key={j.code} value={j.code}>{j.code} — {j.name}{!j.active?' (désactivé)':''}</option>)}</select>
        <label>Du <input aria-label="Date de début" type="date" className="input w-auto" value={fromDate} onChange={e=>{setJournalPage(0);setFromDate(e.target.value);}}/></label>
        <label>Au <input aria-label="Date de fin" type="date" className="input w-auto" value={toDate} onChange={e=>{setJournalPage(0);setToDate(e.target.value);}}/></label>
        <span className="acc-spacer"/>
        {canView&&<button onClick={openExportModal} className="btn-secondary"><Download size={16}/>Exporter</button>}
        {canManage&&<button onClick={()=>onNew?onNew():setOpen(true)} className="btn-primary"><Plus size={16}/>Nouvelle écriture</button>}
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
          <td className="text-right"><AccountingRowActions piece={e.entry_number} onView={()=>void openDetail(e)} onReverse={canManage&&e.source_type==='manual'&&e.status==='posted'?()=>void openDetail(e,true):undefined} reverseDisabledReason={canManage?(e.source_type==='reversal'?'Pièce d’extourne':e.source_type!=='manual'?'Corriger la pièce d’origine':e.status!=='posted'?'Écriture non validée':undefined):'Droit de gestion requis'} anchor={contextRow?.id===e.id?contextRow:undefined} onDismiss={()=>setContextRow(null)}/></td>
        </tr>)}</tbody></table>
      </AccountingTable>

      {/* Create modal — retained fallback for embedded use */}
      {open&&<section className="acc-section-head">{entryForm}{entryFooter}</section>}

      {/* Export modal */}
      {exportOpen&&<section className="acc-section-head space-y-3"><div className="acc-toolbar"><strong className="text-sm">Export comptable</strong><span className="acc-spacer"/><button type="button" className="btn-secondary" disabled={exportLoading} onClick={()=>setExportOpen(false)}>Fermer</button>{!exportData?<button type="button" className="btn-primary" disabled={exportLoading||!exportDateFrom||!exportDateTo} onClick={prepareExport}>{exportLoading?<Loader2 size={15} className="animate-spin"/>:<Search size={15}/>}Préparer</button>:<button type="button" className="btn-primary" onClick={downloadExport}><Download size={15}/>Télécharger</button>}</div><div className="space-y-3">
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
                {journalOptions.map(j => <option key={j.code} value={j.code}>{j.code} — {j.name}{!j.active?' (désactivé)':''}</option>)}
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
            <div className="flex items-start gap-2 text-xs text-red-700">
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
            <div className="acc-section-head space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
                <CheckCircle className="w-4 h-4 shrink-0" />
                <span>Export prêt — choisissez le format puis téléchargez</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-neutral-700">
                <div><span className="font-medium">Période :</span> {exportDateFrom} au {exportDateTo}</div>
                <div><span className="font-medium">Journal :</span> {exportJournal ? (journalLabels[exportJournal] || exportJournal) : 'Tous'}</div>
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
            <div className="text-xs text-neutral-500 space-y-1">
              <p>Seules les écritures <strong>validées</strong> (statut « Validé ») sont exportées.</p>
              <p>Un contrôle d'intégrité (équilibre débit/crédit) est effectué avant chaque export.</p>
              <p>Période maximale : 366 jours.</p>
            </div>
          )}
        </div></section>}


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
  const [bulkPayBusy, setBulkPayBusy] = useState(false);
  const [showPurchaseInvoice, setShowPurchaseInvoice] = useState(false);
  const [bulkPayFournBusy, setBulkPayFournBusy] = useState(false);
  const [showCashReview, setShowCashReview] = useState(false);

  const load=()=>work?.refresh();

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
        <AccountingPurchaseInvoice key={tenant.id} tenantId={tenant.id} onPosted={() => void load()} />
      )}
      {canManage && tenant && showCashReview && (
        <AccountingCashReview key={tenant.id} tenantId={tenant.id} onPosted={() => void load()} />
      )}

      <AccountingPeriodBooks mode="balance"/>
    </div>
  );
}

/* ===================== GRAND LIVRE ===================== */
function GrandLivreTab(){return <AccountingPeriodBooks mode="ledger"/>;}

/* ===================== BALANCE DES TIERS ===================== */
function TiersTab() {
  const { tenant } = useApp();
  const work=useAccountingWork();
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

  const tiersPaging=useAccountingPagination(tiers,type);
  const extraitPaging=useAccountingPagination(extrait,selected?.account_code??'');
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
          <div className="min-w-0 border-t border-neutral-200">
            <div className="px-1 md:px-4 py-3 bg-neutral-50 border-b border-neutral-200">
              <h3 className="text-sm font-semibold text-slate-700">Balance des {type === 'client' ? 'clients' : 'fournisseurs'}</h3>
            </div>
            <AccountingTable footer={<AccountingPagination {...tiersPaging}/>}>
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
                  {tiersPaging.rows.map((t: any) => (
                    <tr key={t.account_code} onClick={() => loadExtrait(t)} className={`cursor-pointer hover:bg-brand-50/40 transition ${selected?.account_code === t.account_code ? 'bg-brand-50' : ''}`}>
                      <td className="px-1 md:px-3 py-2 font-mono text-xs text-brand-700">{t.account_code}</td>
                      <td className="px-1 md:px-3 py-2 text-neutral-700 truncate max-w-[140px]">{t.tiers_name}</td>
                      <td className="px-1 md:px-3 py-2 text-right font-mono text-xs">{Number(t.total_debit) > 0 ? Number(t.total_debit).toLocaleString('fr-FR') : '—'}</td>
                      <td className="px-1 md:px-3 py-2 text-right font-mono text-xs">{Number(t.total_credit) > 0 ? Number(t.total_credit).toLocaleString('fr-FR') : '—'}</td>
                      <td className={`px-1 md:px-3 py-2 text-right font-mono text-xs font-semibold ${Number(t.solde) >= 0 ? 'text-neutral-900' : 'text-neutral-900'}`}>
                        {Number(t.solde).toLocaleString('fr-FR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AccountingTable>
          </div>

          {/* Extrait de compte */}
          <div className="min-w-0 border-t border-neutral-200">
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
              <AccountingTable footer={<AccountingPagination {...extraitPaging}/>}>
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
                    {extraitPaging.rows.map((e: any, idx: number) => (
                      <tr key={idx} className="hover:bg-[var(--w-surface-el)]/40">
                        <td className="px-1 md:px-3 py-2 text-xs text-neutral-600">{formatDate(e.entry_date)}</td>
                        <td className="px-1 md:px-3 py-2 text-xs"><button type="button" className="font-medium hover:underline" onClick={()=>work?.openPiece({entryNumber:e.entry_number})}>{e.entry_number}</button></td>
                        <td className="px-1 md:px-3 py-2 text-neutral-700 text-xs">{e.label || '—'}</td>
                        <td className="px-1 md:px-3 py-2 text-right font-mono text-xs">{Number(e.debit) > 0 ? Number(e.debit).toLocaleString('fr-FR') : ''}</td>
                        <td className="px-1 md:px-3 py-2 text-right font-mono text-xs">{Number(e.credit) > 0 ? Number(e.credit).toLocaleString('fr-FR') : ''}</td>
                        <td className={`px-1 md:px-3 py-2 text-right font-mono text-xs font-semibold ${Number(e.solde_cumule) >= 0 ? 'text-neutral-900' : 'text-neutral-900'}`}>
                          {Number(e.solde_cumule).toLocaleString('fr-FR')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </AccountingTable>
            )}
          </div>
        </div>
      )}
    </div>
  );
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
