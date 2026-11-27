import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {useApp} from '../context/AppContext';
import {usePermissions} from '../lib/permissions';
import {useAccountingMobile,useAccountingWork,type AccountingPieceRequest} from '../context/AccountingWindowContext';
import {supabase} from '../lib/supabase';
import {formatDate} from '../lib/format';
import {AccountingEntryReversal} from './AccountingEntryReversal';
import {AccountingTable,AccountingPagination,useAccountingPagination} from './AccountingWorkspace';
import {FileText,RefreshCw,Search} from './Icons';
type Entry={id:string;entry_number:string;entry_date:string;journal_type:string;description:string|null;reference:string|null;source_type:string|null;status:string;total_debit:number;total_credit:number;posted_at:string|null;reversal_reason:string|null;source_id:string|null};
type Line={id:string;account_code:string;account_name:string;label:string;debit:number;credit:number;third_party_id:string|null};
const money=(n:number)=>Number(n).toLocaleString('fr-FR',{maximumFractionDigits:2});
const status=(s:string)=>s==='posted'?'Validée':s==='cancelled'?'Annulée':'Brouillon';
export function AccountingPiece({request,onPosted}:{request:AccountingPieceRequest;onPosted:()=>void}){
 const mobile=useAccountingMobile();
 const {tenant}=useApp();const {can}=usePermissions();const work=useAccountingWork();
 const [entry,setEntry]=useState<Entry|null>(null),[lines,setLines]=useState<Line[]>([]),[busy,setBusy]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 const paging=useAccountingPagination(lines,request.entryNumber);
 const [selectedIds,setSelectedIds]=useState<Set<string>>(()=>new Set());
 const [context,setContext]=useState<{x:number;y:number}|null>(null);
 const contextRef=useRef<HTMLDivElement>(null);
 const selectedFromJournal=useRef<number>();
 const canCreateTemplate=!!work&&can('manage_accounting')&&!!entry&&entry.status!=='cancelled';
 const selectedLines=lines.filter(line=>selectedIds.has(line.id));
 const setLineSelection=(id:string,checked:boolean)=>{
  setSelectedIds(previous=>{
   const next=new Set(previous);
   if(checked)next.add(id);else next.delete(id);
   return next;
  });
 };
 const selectAll=(checked:boolean)=>setSelectedIds(new Set(checked?lines.map(line=>line.id):[]));
 useEffect(()=>{
  if(!request.templateSelectionRequest||!lines.length||selectedFromJournal.current===request.templateSelectionRequest)return;
  selectedFromJournal.current=request.templateSelectionRequest;
  setSelectedIds(new Set(lines.map(line=>line.id)));
 },[request.templateSelectionRequest,lines]);
 useEffect(()=>{
  if(!context)return;
  contextRef.current?.querySelector('button')?.focus();
  const closeOutside=(event:PointerEvent)=>{if(!contextRef.current?.contains(event.target as Node))setContext(null);};
  const closeOnEscape=(event:KeyboardEvent)=>{if(event.key==='Escape')setContext(null);};
  const close=()=>setContext(null);
  document.addEventListener('pointerdown',closeOutside);
  document.addEventListener('keydown',closeOnEscape);
  window.addEventListener('resize',close);
  window.addEventListener('scroll',close,true);
  return()=>{
   document.removeEventListener('pointerdown',closeOutside);
   document.removeEventListener('keydown',closeOnEscape);
   window.removeEventListener('resize',close);
   window.removeEventListener('scroll',close,true);
  };
 },[context]);
 const createTemplate=()=>{
  setContext(null);
  if(!canCreateTemplate||!entry||selectedLines.length<2)return;
  work?.openTemplate({
   journal:entry.journal_type,
   description:entry.description??'',
   lines:selectedLines.map(line=>({account_code:line.account_code,label:line.label??'',debit:Number(line.debit),credit:Number(line.credit)})),
  });
 };

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
 return <div className="accounting-workspace acc-piece-workspace acc-fill">
  <div className="acc-toolbar acc-fixed"><strong className="text-sm">{request.entryNumber}</strong>{entry&&<span className="acc-status">{status(entry.status)}</span>}<span className="acc-spacer"/><button type="button" className="btn-secondary" disabled={busy} onClick={()=>setRevision(v=>v+1)}><RefreshCw size={15}/>Actualiser</button></div>
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
  {busy&&!entry?<p role="status" className="text-sm">Chargement de la pièce…</p>:entry&&tenant&&<>
   <dl className="acc-piece-meta"><div><dt>Journal</dt><dd>{entry.journal_type}</dd></div><div><dt>Date</dt><dd>{formatDate(entry.entry_date)}</dd></div><div><dt>Référence</dt><dd>{entry.reference||'—'}</dd></div><div><dt>Origine</dt><dd>{entry.source_type==='manual'?'Saisie manuelle':entry.source_type==='reversal'?'Extourne':entry.source_type||'—'}</dd></div><div className="acc-piece-description"><dt>Libellé</dt><dd>{entry.description||'—'}</dd></div></dl>
   <AccountingEntryReversal key={entry.id} tenantId={tenant.id} entryId={entry.id} canManage={can('manage_accounting')} initialOpen={request.reverse} onPosted={()=>{onPosted();setRevision(v=>v+1);}}/>
   {canCreateTemplate&&<div className="acc-toolbar acc-fixed">
    <span className="text-xs" aria-live="polite">{selectedLines.length ? selectedLines.length+' ligne(s) sélectionnée(s)' : 'Cochez les lignes à reprendre dans un modèle.'}</span>
    <span className="acc-spacer"/>
    <button type="button" className="btn-secondary" disabled={selectedLines.length<2} onClick={createTemplate}><FileText size={15}/>Créer un modèle de saisie</button>
   </div>}
   <AccountingTable fill label="Lignes de l’écriture" footer={<AccountingPagination {...paging} disabled={busy}/>}>
    <table>
     <thead>
      <tr>
       {canCreateTemplate&&<th className="w-9 text-center"><input type="checkbox" aria-label="Sélectionner toutes les lignes" disabled={!lines.length} checked={lines.length>0&&selectedLines.length===lines.length} onChange={event=>selectAll(event.target.checked)}/></th>}
       <th className="text-left">Compte</th>
       {!mobile&&<th className="text-left">Intitulé / libellé</th>}
       <th className="text-right">Débit</th>
       <th className="text-right">Crédit</th>
      </tr>
     </thead>
     <tbody>
      {paging.rows.map((line,index)=><tr key={line.id} data-selected={selectedIds.has(line.id)} onContextMenu={event=>{
       if(!canCreateTemplate||selectedLines.length<2||!selectedIds.has(line.id))return;
       event.preventDefault();
       setContext({x:event.clientX,y:event.clientY});
      }}>
       {canCreateTemplate&&<td className="text-center"><input type="checkbox" aria-label={'Sélectionner la ligne '+(paging.page*paging.size+index+1)} checked={selectedIds.has(line.id)} onChange={event=>setLineSelection(line.id,event.target.checked)}/></td>}
       <td>{mobile?<details className="acc-mobile-line">
        <summary>{line.account_code}</summary>
        <span>{line.account_name}</span>
        {line.label&&<span>{line.label}</span>}
        {work&&<button type="button" onClick={()=>work.openAccount(line.account_code)}>Interroger le compte</button>}
       </details>:work ? <button type="button" className="font-medium hover:underline" title="Interroger le compte" onClick={()=>work.openAccount(line.account_code)}>{line.account_code}<Search size={12} className="inline ml-1"/></button> : line.account_code}</td>
       {!mobile&&<td>{line.account_name}<span className="block text-[11px] text-neutral-500">{line.label}</span></td>}
       <td className="text-right">{Number(line.debit) ? money(line.debit) : '—'}</td>
       <td className="text-right">{Number(line.credit) ? money(line.credit) : '—'}</td>
      </tr>)}
      {!lines.length&&<tr><td colSpan={3+Number(canCreateTemplate)+Number(!mobile)}>Aucune ligne disponible.</td></tr>}
     </tbody>
     <tfoot><tr><td colSpan={1+Number(canCreateTemplate)+Number(!mobile)}>Total de la pièce (FCFA)</td><td className="text-right">{money(d)}</td><td className="text-right">{money(c)}</td></tr></tfoot>
    </table>
   </AccountingTable>
   <div className="acc-toolbar"><span className="text-xs">{lines.length} ligne(s)</span><span className="acc-spacer"/><strong className="text-xs">{lines.length&&Math.abs(d-c)<0.005?'Équilibrée':'Écart : '+money(d-c)+' FCFA'}</strong></div>
   {context&&createPortal(<div className="accounting-workspace acc-context-root">
    <div ref={contextRef} className="acc-context" style={{left:Math.max(8,Math.min(context.x,window.innerWidth-224)),top:Math.max(8,Math.min(context.y,window.innerHeight-76)),zIndex:10000}}>
     <button type="button" onClick={createTemplate}><FileText size={16}/>Créer un modèle de saisie</button>
    </div>
   </div>, document.body)}
  </>}
 </div>;
}
