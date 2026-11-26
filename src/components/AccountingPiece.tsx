import {useEffect,useState} from 'react';
import {useApp} from '../context/AppContext';
import {usePermissions} from '../lib/permissions';
import {useAccountingWork,type AccountingPieceRequest} from '../context/AccountingWindowContext';
import {supabase} from '../lib/supabase';
import {formatDate} from '../lib/format';
import {AccountingEntryReversal} from './AccountingEntryReversal';
import {AccountingTable,AccountingPagination,useAccountingPagination} from './AccountingWorkspace';
import {RefreshCw,Search} from './Icons';
type Entry={id:string;entry_number:string;entry_date:string;journal_type:string;description:string|null;reference:string|null;source_type:string|null;status:string;total_debit:number;total_credit:number;posted_at:string|null;reversal_reason:string|null;source_id:string|null};
type Line={id:string;account_code:string;account_name:string;label:string;debit:number;credit:number;third_party_id:string|null};
const money=(n:number)=>Number(n).toLocaleString('fr-FR',{maximumFractionDigits:2});
const status=(s:string)=>s==='posted'?'Validée':s==='cancelled'?'Annulée':'Brouillon';
export function AccountingPiece({request,onPosted}:{request:AccountingPieceRequest;onPosted:()=>void}){
 const {tenant}=useApp();const {can}=usePermissions();const work=useAccountingWork();
 const [entry,setEntry]=useState<Entry|null>(null),[lines,setLines]=useState<Line[]>([]),[busy,setBusy]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 const paging=useAccountingPagination(lines,request.entryNumber);
 useEffect(()=>{if(!tenant)return;let active=true;setBusy(true);setError('');void(async()=>{
  try{
   let q=supabase.from('journal_entries').select('id,entry_number,entry_date,journal_type,description,reference,source_type,status,total_debit,total_credit,posted_at,reversal_reason,source_id').eq('tenant_id',tenant.id);
   q=request.entryId?q.eq('id',request.entryId):q.eq('entry_number',request.entryNumber);
   const {data:e,error:err}=await q.single();if(err)throw err;if(!e||e.entry_number!==request.entryNumber)throw new Error('Pièce introuvable.');
   const all:Line[]=[];for(let off=0;;off+=250){const {data:l,error:le}=await supabase.from('journal_lines').select('id,account_code,account_name,label,debit,credit,third_party_id').eq('tenant_id',tenant.id).eq('entry_id',e.id).order('created_at').order('id').range(off,off+249);if(le)throw le;if(!active)return;all.push(...((l??[]) as Line[]));if((l??[]).length<250)break;}
   if(active){setEntry(e as Entry);setLines(all);}
  }catch(e){if(active){setEntry(null);setLines([]);setError(e&&typeof e==='object'&&'message' in e?String(e.message):'Chargement impossible.');}}finally{if(active)setBusy(false);}
 })();return()=>{active=false;};},[tenant?.id,request.entryId,request.entryNumber,revision,work?.revision]);
 const d=lines.reduce((a,l)=>a+Number(l.debit),0),c=lines.reduce((a,l)=>a+Number(l.credit),0);
 return <div className="accounting-workspace acc-piece-workspace">
  <div className="acc-toolbar acc-fixed"><strong className="text-sm">{request.entryNumber}</strong>{entry&&<span className="acc-status">{status(entry.status)}</span>}<span className="acc-spacer"/><button type="button" className="btn-secondary" disabled={busy} onClick={()=>setRevision(v=>v+1)}><RefreshCw size={15}/>Actualiser</button></div>
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
  {busy&&!entry?<p role="status" className="text-sm">Chargement de la pièce…</p>:entry&&tenant&&<>
   <dl className="acc-piece-meta"><div><dt>Journal</dt><dd>{entry.journal_type}</dd></div><div><dt>Date</dt><dd>{formatDate(entry.entry_date)}</dd></div><div><dt>Référence</dt><dd>{entry.reference||'—'}</dd></div><div><dt>Origine</dt><dd>{entry.source_type==='manual'?'Saisie manuelle':entry.source_type==='reversal'?'Extourne':entry.source_type||'—'}</dd></div><div className="acc-piece-description"><dt>Libellé</dt><dd>{entry.description||'—'}</dd></div></dl>
   <AccountingEntryReversal key={entry.id} tenantId={tenant.id} entryId={entry.id} canManage={can('manage_accounting')} initialOpen={request.reverse} onPosted={()=>{onPosted();setRevision(v=>v+1);}}/>
   <AccountingTable footer={<AccountingPagination {...paging} disabled={busy}/>}>
    <table><thead><tr><th className="text-left">Compte</th><th className="text-left">Intitulé / libellé</th><th className="text-right">Débit</th><th className="text-right">Crédit</th></tr></thead><tbody>{paging.rows.map(l=><tr key={l.id}><td>{work?<button type="button" className="font-medium hover:underline" title="Interroger le compte" onClick={()=>work.openAccount(l.account_code)}>{l.account_code}<Search size={12} className="inline ml-1"/></button>:l.account_code}</td><td>{l.account_name}<span className="block text-[11px] text-neutral-500">{l.label}</span></td><td className="text-right">{Number(l.debit)?money(l.debit):'—'}</td><td className="text-right">{Number(l.credit)?money(l.credit):'—'}</td></tr>)}{!lines.length&&<tr><td colSpan={4}>Aucune ligne disponible.</td></tr>}</tbody><tfoot><tr><td colSpan={2}>Total de la pièce (FCFA)</td><td className="text-right">{money(d)}</td><td className="text-right">{money(c)}</td></tr></tfoot></table>
   </AccountingTable>
   <div className="acc-toolbar"><span className="text-xs">{lines.length} ligne(s)</span><span className="acc-spacer"/><strong className="text-xs">{lines.length&&Math.abs(d-c)<0.005?'Équilibrée':'Écart : '+money(d-c)+' FCFA'}</strong></div>
  </>}
 </div>;
}
