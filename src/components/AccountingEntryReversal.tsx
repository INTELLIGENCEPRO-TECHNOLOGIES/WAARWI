import {useAccountingWindowId,mayCloseAccountingWindow} from '../context/AccountingWindowContext';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '../lib/supabase';
import {formatDate} from '../lib/format';
type Entry={id:string;entry_number:string;entry_date:string;source_type:string|null;source_id:string|null;status:string;reversal_reason:string|null;total_debit:number;total_credit:number};
const fields='id,entry_number,entry_date,source_type,source_id,status,reversal_reason,total_debit,total_credit';
const message=(e:unknown)=>e&&typeof e==='object'&&'message' in e?String(e.message):'Opération impossible.';
const today=()=>new Date().toISOString().slice(0,10);
export function AccountingEntryReversal({tenantId,entryId,canManage,onPosted,initialOpen=false}:{tenantId:string;entryId:string;canManage:boolean;onPosted?:()=>void;initialOpen?:boolean}){
 const [entry,setEntry]=useState<Entry|null>(null);
 const [linked,setLinked]=useState<Entry|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [date,setDate]=useState(today);
 const [reason,setReason]=useState('');
 const [open,setOpen]=useState(false);
 const [busy,setBusy]=useState(false);
 const [revision,setRevision]=useState(0);
 const [notice,setNotice]=useState('');
 const lock=useRef(false);
 const windowId=useAccountingWindowId();
 useEffect(()=>{const guard=(event:Event)=>{if(!mayCloseAccountingWindow(event,windowId)||event.defaultPrevented)return;if(lock.current||(open&&!!reason.trim())&&!window.confirm("Un motif d’extourne est en cours de saisie. Fermer ?"))event.preventDefault();};window.addEventListener('waarwi:accounting-before-navigate',guard);return()=>window.removeEventListener('waarwi:accounting-before-navigate',guard);},[windowId,open,reason]);
 useEffect(()=>{
  let active=true;setLoading(true);setEntry(null);setLinked(null);setError('');setOpen(false);
  void(async()=>{try{
   const {data,error:err}=await supabase.from('journal_entries').select(fields).eq('tenant_id',tenantId).eq('id',entryId).single();
   if(err)throw err;
   const e=data as Entry;
   let q=supabase.from('journal_entries').select(fields).eq('tenant_id',tenantId);
   q=e.source_type==='reversal'?q.eq('id',e.source_id??'00000000-0000-0000-0000-000000000000'):q.eq('source_type','reversal').eq('source_id',e.id);
   const {data:other,error:otherErr}=await q.maybeSingle();
   if(otherErr)throw otherErr;
   if(active){setEntry(e);setLinked(other as Entry|null);if(initialOpen&&revision===0&&canManage&&e.source_type==='manual'&&e.status==='posted'&&!other){setDate(today());setReason('');setOpen(true);}}
  }catch(e){if(active)setError(message(e));}finally{if(active)setLoading(false);}})();
  return()=>{active=false;};
 },[tenantId,entryId,revision,initialOpen,canManage]);
 const valid=!!entry&&!!date&&date>=entry.entry_date&&date<=today()&&!!reason.trim()&&reason.trim().length<=500;
 const post=async()=>{
  if(!entry||!valid||!canManage||linked||lock.current||entry.source_type!=='manual'||entry.status!=='posted')return;
  lock.current=true;setBusy(true);setError('');
  try{
   const {data,error:err}=await supabase.rpc('reverse_manual_accounting_entry',{p_tenant_id:tenantId,p_entry_id:entry.id,p_date:date,p_reason:reason.trim()});
   if(err)throw err;
   if(!data?.success)throw new Error(data?.error||'Extourne non confirmée.');
   setNotice('Extourne enregistrée : '+String(data.piece_number??''));setReason('');setOpen(false);setRevision(v=>v+1);onPosted?.();
  }catch(e){setError(message(e));}finally{setBusy(false);lock.current=false;}
 };
 if(loading)return <p role="status" className="text-xs text-neutral-500">Vérification des corrections…</p>;
 if(!entry)return error?<p role="alert" className="text-xs text-red-700">{error}</p>:null;
 const isReversal=entry.source_type==='reversal';
 return <section className="border-t border-neutral-200 pt-3 space-y-2">
  <h3 className="text-sm font-semibold">Correction comptable</h3>
  {notice&&<p role="status" className="text-sm text-neutral-700">{notice}</p>}
  {error&&<p role="alert" className="text-xs text-red-700 break-words">{error}</p>}
  {isReversal?<div className="text-sm space-y-1"><p>Extourne de la pièce {linked?.entry_number??'Pièce d’origine indisponible'}</p><p className="text-xs text-neutral-600 break-words">Motif : {entry.reversal_reason??'—'}</p></div>:linked?<div className="text-sm space-y-1"><p className="font-medium">Écriture extournée · {linked.entry_number} du {formatDate(linked.entry_date)}</p><p className="text-xs text-neutral-600 break-words">Motif : {linked.reversal_reason??'—'}</p><p className="text-xs text-neutral-500">L’écriture d’origine demeure dans les journaux.</p></div>:entry.source_type!=='manual'?<p className="text-xs text-neutral-500">Corrigez cette opération depuis sa pièce commerciale d’origine.</p>:entry.status!=='posted'?<p className="text-xs text-neutral-500">Seules les écritures manuelles validées sont extournables.</p>:canManage&&!open?<button type="button" className="btn btn-secondary" onClick={()=>{setDate(today());setReason('');setOpen(true);setError('');}}>Extourner l’écriture</button>:!canManage?<p className="text-xs text-neutral-500">Le droit de gestion comptable est requis pour extourner.</p>:null}
  {open&&!linked&&canManage&&entry.source_type==='manual'&&entry.status==='posted'&&<form className="space-y-3" onSubmit={e=>{e.preventDefault();void post();}}>
   <p className="text-xs text-neutral-600">Une nouvelle pièce inverse les débits et crédits sans modifier l’original. La date choisie doit appartenir à une période ouverte. Délettrez d’abord les lignes concernées.</p>
   <label className="block text-xs font-medium">Date de contrepassation<input className="input mt-1 w-full" type="date" min={entry.entry_date} max={today()} required value={date} disabled={busy} onChange={e=>setDate(e.target.value)}/></label>
   <label className="block text-xs font-medium">Motif obligatoire<textarea className="input mt-1 w-full" value={reason} maxLength={500} required disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
   <div className="flex flex-wrap gap-2"><button className="btn btn-primary" type="submit" disabled={!valid||busy}>{busy?'Enregistrement…':'Confirmer l’extourne'}</button><button className="btn btn-secondary" type="button" disabled={busy} onClick={()=>setOpen(false)}>Annuler</button></div>
  </form>}
 </section>;
}
