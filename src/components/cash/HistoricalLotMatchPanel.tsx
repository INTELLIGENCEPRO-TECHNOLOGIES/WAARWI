import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

type MatchLine = { sale_item_id: string; name: string; quantity: number; site_id: string | null; linked_quantity: number };
type Deduction = { deduction_id: string; lot_id: string; batch_number: string; site_id: string; site_name: string; quantity: number };
type Match = { deduction_id: string; sale_item_id: string; quantity: number };
type MatchData = { lines: MatchLine[]; deductions: Deduction[]; matches: Match[]; prior_returns: boolean };
const key = (deduction: string, line: string) => deduction + ':' + line;
const equal = (a: number, b: number) => Math.abs(a - b) < 1e-8;

type PriorReturn = {return_item_id:string;return_number:string;created_at:string;name:string;quantity:number;restock:boolean;source_complete:boolean;lots:{lot_id:string;batch_number:string;site_name:string;available:number}[]};
function PriorReturnMatch({item,onDone}:{item:PriorReturn;onDone:()=>void}){
 const [values,setValues]=useState<Record<string,string>>({});
 const [evidence,setEvidence]=useState('');
 const [confirmed,setConfirmed]=useState(false);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState('');
 const allocations=item.lots.map(l=>({lot_id:l.lot_id,quantity:Number(values[l.lot_id]||0)}));
 const total=allocations.reduce((sum,l)=>sum+l.quantity,0);
 const valid=item.source_complete&&item.lots.length>0&&equal(total,Number(item.quantity))&&allocations.every((a,index)=>Number.isFinite(a.quantity)&&a.quantity>=0&&a.quantity<=Number(item.lots[index].available));
 const save=async()=>{
  if(!valid||!confirmed||evidence.trim().length<8||saving)return;
  setSaving(true);setError('');
  try{
   const {error:err}=await supabase.rpc('save_historical_return_lot_match',{p_return_item_id:item.return_item_id,p_lots:allocations.filter(a=>a.quantity>0),p_evidence:evidence.trim(),p_physical_verified:item.restock&&confirmed});
   if(err)throw err;onDone();
  }catch(e){setError((e as {message?:string})?.message||'Rapprochement non confirmé. Rechargez avant de modifier.');}
  finally{setSaving(false);}
 };
 return <div className="min-w-0 rounded border border-neutral-200 p-3 space-y-2">
  <div className="text-xs font-semibold break-words">{item.return_number} │ {item.name} │ {item.quantity}</div>
  <p className="text-xs text-neutral-600">{item.restock?'Ancien retour physique':'Ancien retour sans remise en stock'} │ {new Date(item.created_at).toLocaleDateString('fr-FR')}</p>
  {!item.source_complete?<p className="text-xs text-amber-800">Rapprochez d'abord les sorties d'origine de la vente. Si aucune preuve n'existe, ne choisissez pas de lot arbitrairement.</p>:<fieldset disabled={saving} className="space-y-2 min-w-0">
   {item.lots.map(l=><label key={l.lot_id} className="flex items-center gap-2 min-w-0 text-xs"><span className="min-w-0 flex-1 break-words">{l.batch_number||'Lot sans numéro'} │ {l.site_name} │ Disponible : {l.available}</span><input type="number" inputMode="decimal" min={0} max={l.available} step="any" aria-label={'Quantité ancien retour lot '+l.batch_number} className="min-h-10 w-20 shrink-0 border-b border-neutral-300 bg-transparent text-right tabular-nums" value={values[l.lot_id]||''} onChange={e=>setValues(v=>({...v,[l.lot_id]:e.target.value}))}/></label>)}
   <p className="text-xs tabular-nums">Affecté : {total} / {item.quantity}</p>
   <label className="block text-xs">Référence du justificatif<textarea className="mt-1 w-full rounded border border-neutral-300 p-2 text-sm" rows={2} maxLength={1000} value={evidence} onChange={e=>setEvidence(e.target.value)}/></label>
   <label className="flex gap-2 items-start text-xs"><input type="checkbox" className="mt-0.5 shrink-0" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>{item.restock?'Je confirme les quantités et les mouvements physiques déjà vérifiés. Aucun stock ni remboursement supplémentaire ne sera créé.':'Je confirme les affectations selon les justificatifs. Aucun remboursement supplémentaire ne sera créé.'}</span></label>
   <button type="button" disabled={!valid||!confirmed||evidence.trim().length<8||saving} onClick={save} className="min-h-10 w-full rounded bg-neutral-900 text-white text-xs font-semibold disabled:opacity-40">{saving?'Enregistrement…':'Rapprocher cet ancien retour'}</button>
   {error&&<p role="alert" className="text-xs text-red-700 break-words">{error}</p>}
  </fieldset>}
 </div>;
}

export function HistoricalLotMatchPanel({saleId,articleId,onDone,onCancel}:{
  saleId:string;articleId:string;onDone:()=>void;onCancel:()=>void;
}) {
  const [data,setData]=useState<MatchData|null>(null);
  const [priorReturns,setPriorReturns]=useState<PriorReturn[]>([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [evidence,setEvidence]=useState('');
  const [confirmed,setConfirmed]=useState(false);
  const [values,setValues]=useState<Record<string,string>>({});
  const [reload,setReload]=useState(0);
  useEffect(()=>{
    let live=true;
    setLoading(true);setError('');setData(null);setPriorReturns([]);setValues({});setEvidence('');setConfirmed(false);
    void (async()=>{
      try {
        const [saleResult,returnResult]=await Promise.all([
          supabase.rpc('read_historical_sale_lot_match',{p_sale_id:saleId,p_article_id:articleId}),
          supabase.rpc('read_historical_return_lot_matches',{p_sale_id:saleId,p_article_id:articleId})
        ]);
        if(saleResult.error)throw saleResult.error;
        if(returnResult.error)throw returnResult.error;
        const result=saleResult.data;
        if(live){
          const d=result as MatchData;
          setData(d);setPriorReturns((returnResult.data||[]) as PriorReturn[]);
          setValues(Object.fromEntries(d.matches.map(m=>[key(m.deduction_id,m.sale_item_id),String(m.quantity)])));
        }
      }catch(e){if(live)setError((e as {message?:string})?.message||'Impossible de charger le rapprochement.');}
      finally{if(live)setLoading(false);}
    })();
    return()=>{live=false;};
  },[saleId,articleId,reload]);
  const qty=(d:string,l:string)=>Number(values[key(d,l)]||0);
  const complete=!!data && data.deductions.length>0 && data.lines.length>0 &&
    data.deductions.every(d=>data.lines.every(l=>{
      const v=qty(d.deduction_id,l.sale_item_id);
      return Number.isFinite(v)&&v>=0&&(!l.site_id||l.site_id===d.site_id||v===0);
    })&&equal(data.lines.reduce((sum,l)=>sum+qty(d.deduction_id,l.sale_item_id),0),Number(d.quantity))) &&
    data.lines.every(l=>equal(Number(l.linked_quantity)+data.deductions.reduce((sum,d)=>sum+qty(d.deduction_id,l.sale_item_id),0),Number(l.quantity)));
  const already=!!data?.matches.length;
  const save=async()=>{
    if(!data||!complete||!confirmed||evidence.trim().length<8||saving||already)return;
    setSaving(true);setError('');
    try{
      const matches=data.deductions.flatMap(d=>data.lines.map(l=>({deduction_id:d.deduction_id,sale_item_id:l.sale_item_id,quantity:qty(d.deduction_id,l.sale_item_id)}))).filter(m=>m.quantity>0);
      const {error:err}=await supabase.rpc('save_historical_sale_lot_match',{p_sale_id:saleId,p_article_id:articleId,p_matches:matches,p_evidence:evidence.trim()});
      if(err)throw err;
      onDone();
    }catch(e){setError((e as {message?:string})?.message||'Rapprochement non confirmé. Rechargez avant de modifier les données.');}
    finally{setSaving(false);}
  };
  return <section className="mt-3 min-w-0 space-y-3 border border-neutral-200 rounded-lg p-3" aria-label="Rapprochement des lots historiques">
    <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h4 className="text-sm font-semibold">Rapprochement des lots historiques</h4><p className="mt-1 text-xs text-neutral-600">Associez les sorties réellement enregistrées aux lignes de vente selon vos justificatifs. Aucun mouvement de stock n'est créé.</p></div><button type="button" disabled={saving} onClick={onCancel} className="text-xs underline shrink-0">Fermer</button></div>
    {loading&&<p role="status" className="text-xs">Chargement des sorties historiques…</p>}
    {error&&<div role="alert" className="text-xs text-red-700 break-words">{error} <button type="button" disabled={saving} onClick={()=>setReload(n=>n+1)} className="underline">Recharger</button></div>}
    {data&&<fieldset disabled={saving||already} className="min-w-0 space-y-3">
      {already&&<p className="text-xs font-medium">Rapprochement déjà enregistré. Les affectations sont en lecture seule.</p>}
      {data.prior_returns&&!already&&<p className="text-xs text-amber-800">Des retours antérieurs existent. Rapprochez d'abord les sorties de la vente, puis les anciens retours approuvés. Les retours en attente doivent être traités avant le rapprochement.</p>}
      {!data.deductions.length&&<p className="text-xs text-neutral-600">Aucune sortie de lot sans lien n'a été retrouvée. N'inventez pas de lot.</p>}
      {data.deductions.map(d=><div key={d.deduction_id} className="min-w-0 border-t border-neutral-200 pt-2 space-y-2">
        <div className="text-xs font-semibold break-words">{d.batch_number||'Lot sans numéro'} │ {d.site_name} │ {d.quantity} à affecter</div>
        {data.lines.map((l,index)=><label key={l.sale_item_id} className="flex items-center gap-2 text-xs min-w-0">
          <span className="min-w-0 flex-1 break-words">Ligne {index+1} │ {l.name} ({l.quantity})</span>
          <input type="number" inputMode="decimal" min={0} max={d.quantity} step="any" disabled={!!l.site_id&&l.site_id!==d.site_id} aria-label={'Quantité lot '+d.batch_number+' ligne '+(index+1)} className="w-20 shrink-0 min-h-10 border-b border-neutral-300 bg-transparent text-right tabular-nums" value={values[key(d.deduction_id,l.sale_item_id)]||''} onChange={e=>setValues(v=>({...v,[key(d.deduction_id,l.sale_item_id)]:e.target.value}))}/>
        </label>)}
        <p className="text-xs text-neutral-600 tabular-nums">Affecté : {data.lines.reduce((sum,l)=>sum+qty(d.deduction_id,l.sale_item_id),0)} / {d.quantity}</p>
      </div>)}
      {data.deductions.length>0&&!already&&<>
        <div className="border-t border-neutral-200 pt-2 text-xs space-y-1" aria-live="polite">{data.lines.map((l,index)=><div key={l.sale_item_id} className="flex justify-between gap-2"><span>Ligne {index+1}</span><strong className="tabular-nums">{Number(l.linked_quantity)+data.deductions.reduce((sum,d)=>sum+qty(d.deduction_id,l.sale_item_id),0)} / {l.quantity}</strong></div>)}</div>
        <label className="block text-xs font-medium">Référence du justificatif<textarea className="mt-1 w-full border border-neutral-300 rounded p-2 text-sm" rows={2} maxLength={1000} value={evidence} onChange={e=>setEvidence(e.target.value)} placeholder="Ex. bordereau de livraison, référence d'inventaire"/></label>
        <label className="flex gap-2 items-start text-xs"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} className="mt-0.5 shrink-0"/><span>Je confirme que les affectations correspondent aux documents vérifiés.</span></label>
        <button type="button" disabled={!complete||!confirmed||evidence.trim().length<8||saving} onClick={save} className="w-full min-h-10 rounded bg-neutral-900 text-white text-xs font-semibold disabled:opacity-40">{saving?'Enregistrement…':'Enregistrer le rapprochement'}</button>
      </>}
    </fieldset>}
    {priorReturns.length>0&&<div className="space-y-2 border-t border-neutral-200 pt-3"><h4 className="text-sm font-semibold">Anciens retours à rapprocher</h4>{priorReturns.map(item=><PriorReturnMatch key={item.return_item_id} item={item} onDone={onDone}/>)}</div>}
  </section>;
}
