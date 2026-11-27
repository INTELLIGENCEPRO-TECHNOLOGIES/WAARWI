import {useEffect,useRef,useState} from 'react';
import {useApp} from '../context/AppContext';
import {usePermissions} from '../lib/permissions';
import {useAccountingWork} from '../context/AccountingWindowContext';
import {useAccountingJournals} from '../lib/accountingJournals';
import {supabase} from '../lib/supabase';
import {formatDate} from '../lib/format';
import {Search,RefreshCw,Download,Loader2} from './Icons';
import {AccountingTable,AccountingPagination,AccountingRowActions} from './AccountingWorkspace';
import {sanitizeCsvValue} from '../lib/csvSanitize';
type Filters={piece:string;description:string;reference:string;account:string;journal:string;from:string;to:string;min:string;max:string;status:string};
type Row={id:string;entry_number:string;entry_date:string;journal_type:string;description:string|null;reference:string|null;total_debit:number;total_credit:number;source_type:string|null;status:string};
const empty:Filters={piece:'',description:'',reference:'',account:'',journal:'',from:'',to:'',min:'',max:'',status:''};
const money=(n:number)=>Number(n).toLocaleString('fr-FR',{maximumFractionDigits:2});
const statusLabel=(s:string)=>s==='posted'?'Validée':s==='cancelled'?'Annulée':'Brouillon';
export function AccountingSearch(){
 const {tenant}=useApp();const {can}=usePermissions();const work=useAccountingWork();const journalCatalog=useAccountingJournals(tenant?.id,work?.revision??0);
 const [filters,setFilters]=useState<Filters>({...empty}),[applied,setApplied]=useState<Filters|null>(null),[page,setPage]=useState(0),[size,setSize]=useState(20),[total,setTotal]=useState(0),[rows,setRows]=useState<Row[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0),[context,setContext]=useState<{id:string;x:number;y:number}|null>(null);
 const seq=useRef(0);const change=(k:keyof Filters,v:string)=>setFilters(f=>({...f,[k]:v}));
 const validate=()=>{if(filters.from&&filters.to&&filters.from>filters.to)return 'La date de fin doit suivre la date de début.';if([filters.min,filters.max].some(v=>v!==''&&(!Number.isFinite(Number(v))||Number(v)<0)))return 'Montants positifs ou nuls requis.';if(filters.min!==''&&filters.max!==''&&Number(filters.min)>Number(filters.max))return 'Le minimum doit être inférieur ou égal au maximum.';return '';};
 const submit=()=>{const err=validate();if(err){setError(err);return;}setPage(0);setApplied({...filters});setRevision(v=>v+1);setContext(null);};
 useEffect(()=>{if(!tenant||!applied)return;const n=++seq.current;const controller=new AbortController();setBusy(true);setError('');setRows([]);setContext(null);const f=applied;
 void(async()=>{try{
  const columns='id,entry_number,entry_date,journal_type,description,reference,total_debit,total_credit,source_type,status';
  let q=supabase.from('journal_entries').select(f.account.trim()?columns+',matching_lines:journal_lines!fk_journal_lines_tenant_entry!inner(account_code)':columns,{count:'exact'}).eq('tenant_id',tenant.id);
  if(f.account.trim())q=q.eq('matching_lines.account_code',f.account.trim());
  if(f.piece.trim())q=q.ilike('entry_number','%'+f.piece.trim()+'%');
  if(f.description.trim())q=q.ilike('description','%'+f.description.trim()+'%');
  if(f.reference.trim())q=q.ilike('reference','%'+f.reference.trim()+'%');
  if(f.journal)q=q.eq('journal_type',f.journal);
  if(f.status)q=q.eq('status',f.status);
  if(f.from)q=q.gte('entry_date',f.from);if(f.to)q=q.lte('entry_date',f.to);
  if(f.min!=='')q=q.gte('total_debit',Number(f.min));if(f.max!=='')q=q.lte('total_debit',Number(f.max));
  const {data,count,error:err}=await q.order('entry_date',{ascending:false}).order('entry_number',{ascending:false}).order('id',{ascending:false}).range(page*size,(page+1)*size-1).abortSignal(controller.signal);
  if(err)throw err;if(n!==seq.current)return;const nextTotal=count??0;setTotal(nextTotal);setRows((data??[]) as unknown as Row[]);if(page>Math.max(0,Math.ceil(nextTotal/size)-1))setPage(Math.max(0,Math.ceil(nextTotal/size)-1));
 }catch(e){if(n===seq.current){setTotal(0);setError(e&&typeof e==='object'&&'message' in e?String(e.message):'Recherche impossible.');}}finally{if(n===seq.current)setBusy(false);}})();
 return()=>{seq.current++;controller.abort();};},[tenant?.id,applied,page,size,revision,work?.revision]);
 const unapplied=!!applied&&Object.keys(empty).some(k=>filters[k as keyof Filters]!==applied[k as keyof Filters]);
 const reset=()=>{seq.current++;setFilters({...empty});setApplied(null);setRows([]);setPage(0);setTotal(0);setBusy(false);setError('');setContext(null);};
 const view=(r:Row,reverse=false)=>work?.openPiece({entryId:r.id,entryNumber:r.entry_number,reverse});
 const exportPage=()=>{const csv=[['Date','Pièce','Journal','Libellé','Référence','Débit','Crédit','Statut'],...rows.map(r=>[r.entry_date,r.entry_number,r.journal_type,r.description??'',r.reference??'',String(r.total_debit),String(r.total_credit),statusLabel(r.status)])].map(row=>row.map(v=>'"'+sanitizeCsvValue(v).replace(/"/g,'""')+'"').join(';')).join('\r\n');const url=URL.createObjectURL(new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='recherche-ecritures-page-'+(page+1)+'.csv';a.click();URL.revokeObjectURL(url);};
 const field=(k:keyof Filters,label:string,props:{type?:string;placeholder?:string}={})=><label className={'acc-search-field acc-search-'+k}><span>{label}</span><input className="input" value={filters[k]} onChange={e=>change(k,e.target.value)} type={props.type??'text'} placeholder={props.placeholder} {...(props.type==='number'?{min:0,step:'0.01'}:{})}/></label>;
 return <div className="acc-fill acc-search-workspace">
  <form className="acc-search-form" onSubmit={e=>{e.preventDefault();submit();}}>
   <div className="acc-search-fields">
    {field('piece','N° de pièce',{placeholder:'OD260…'})}{field('description','Libellé')}{field('account','N° de compte',{placeholder:'Compte exact'})}
    <label className="acc-search-field acc-search-journal"><span>Journal</span><select className="input" value={filters.journal} onChange={e=>change('journal',e.target.value)}><option value="">Tous</option>{journalCatalog.rows.map(j=><option key={j.code} value={j.code}>{j.code} — {j.name}{!j.is_active?' (désactivé)':''}</option>)}</select></label>
    {field('from','Du',{type:'date'})}{field('to','Au',{type:'date'})}
   </div>
   <details className="acc-search-extra">
    <summary>Filtres avancés{[filters.reference,filters.status,filters.min,filters.max].some(Boolean)&&' · filtres renseignés'}</summary>
    <div className="acc-search-fields">
     {field('reference','Référence')}
     <label className="acc-search-field acc-search-status"><span>Statut</span><select className="input" value={filters.status} onChange={e=>change('status',e.target.value)}><option value="">Tous</option><option value="posted">Validées</option><option value="draft">Brouillons</option><option value="cancelled">Annulées</option></select></label>
     {field('min','Débit min. (FCFA)',{type:'number'})}{field('max','Débit max. (FCFA)',{type:'number'})}
    </div>
   </details>
   <div className="acc-search-actions"><button type="submit" className="btn-primary" disabled={busy&&!unapplied}>{busy?<Loader2 size={15} className="animate-spin"/>:<Search size={15}/>}Rechercher</button><button type="button" className="btn-secondary" onClick={reset}><RefreshCw size={15}/>Réinitialiser</button><span className="acc-spacer"/><button type="button" className="btn-secondary" disabled={busy||unapplied||!rows.length} onClick={exportPage}><Download size={15}/>Exporter la page</button></div>
  </form>
  {(error||journalCatalog.error)&&<p role="alert" className="text-xs text-red-700">{error||journalCatalog.error}</p>}
  {unapplied&&<p className="acc-search-pending" role="status">Critères modifiés : relancez la recherche. Les résultats ci-dessous correspondent aux critères précédents.</p>}
  <div className="acc-search-result-label" role="status">{busy?'Recherche en cours…':applied?total.toLocaleString('fr-FR')+' écriture(s) trouvée(s)':'Renseignez les critères ou recherchez toutes les écritures.'}</div>
  <AccountingTable fill label="Résultats de la recherche d’écritures" footer={<AccountingPagination page={page} size={size} total={total} setPage={setPage} setSize={n=>{setPage(0);setSize(n);}} disabled={busy||!applied||unapplied}/>}>
   <table><thead><tr><th className="text-left">Date / pièce</th><th className="text-left acc-search-journal-col">Journal</th><th className="text-left">Libellé / référence</th><th className="text-right acc-search-amount-col">Débit</th><th className="text-right acc-search-amount-col">Crédit</th><th className="text-left acc-search-status-col">Statut</th><th className="text-right"><span className="sr-only">Actions</span></th></tr></thead><tbody>{rows.map(r=><tr key={r.id} onDoubleClick={()=>view(r)} onContextMenu={e=>{e.preventDefault();setContext({id:r.id,x:e.clientX,y:e.clientY});}}><td><span className="block text-[11px] text-neutral-500">{formatDate(r.entry_date)}</span><button type="button" className="font-medium hover:underline text-left" onClick={()=>view(r)}>{r.entry_number}</button><span className="acc-search-compact-meta">{r.journal_type} · {statusLabel(r.status)}</span></td><td className="acc-search-journal-col">{r.journal_type}</td><td>{r.description||'—'}{r.reference&&<span className="acc-table-meta">{r.reference}</span>}<span className="acc-table-meta acc-search-compact-amounts">D {money(r.total_debit)} · C {money(r.total_credit)}</span></td><td className="text-right acc-search-amount-col">{money(r.total_debit)}</td><td className="text-right acc-search-amount-col">{money(r.total_credit)}</td><td className="acc-search-status-col"><span className="acc-status">{statusLabel(r.status)}</span></td><td className="text-right"><AccountingRowActions piece={r.entry_number} onView={()=>view(r)} onReverse={can('manage_accounting')&&r.source_type==='manual'&&r.status==='posted'?()=>view(r,true):undefined} reverseDisabledReason={!can('manage_accounting')?'Droit de gestion requis':r.source_type==='reversal'?'Pièce d’extourne':r.source_type!=='manual'?'Corriger la pièce d’origine':r.status!=='posted'?'Écriture non validée':undefined} anchor={context?.id===r.id?context:undefined} onDismiss={()=>setContext(null)}/></td></tr>)}{!rows.length&&<tr><td colSpan={7} className="text-center text-neutral-500">{busy?'Chargement…':applied?'Aucun résultat.':'Aucune recherche lancée.'}</td></tr>}</tbody></table>
  </AccountingTable>
 </div>;
}
