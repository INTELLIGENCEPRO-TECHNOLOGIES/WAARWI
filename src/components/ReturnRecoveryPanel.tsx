import {useCallback,useEffect,useRef,useState} from 'react';
import {RotateCcw,Loader2} from 'lucide-react';
import {useApp} from '../context/AppContext';
import {formatFCFA} from '../lib/format';
import {readActiveReturnRequest,executeReturnRequest,finishReturnRequest,RETURN_REQUEST_CHANGED,type ActiveReturnRequest} from '../lib/returnRequestJournal';

type Props={enabled:boolean;onActiveChange?:(active:boolean|null)=>void;onResolved?:()=>void};
export function ReturnRecoveryPanel({enabled,onActiveChange,onResolved}:Props){
 const {tenant,profile}=useApp();
 const [active,setActive]=useState<ActiveReturnRequest|null>(null);
 const [loading,setLoading]=useState(false);
 const [busy,setBusy]=useState(false);
 const [failure,setFailure]=useState('');
 const [actionError,setActionError]=useState('');
 const generation=useRef(0);
 const executing=useRef(false);
 const refresh=useCallback(async()=>{
  const id=++generation.current;
  if(!enabled||!tenant?.id||!profile?.id){setActive(null);onActiveChange?.(null);return;}
  setLoading(true);setFailure('');
  try{
   const result=await readActiveReturnRequest();
   if(id!==generation.current)return;
   setActive(result);onActiveChange?.(!!result);
  }catch(e:any){if(id===generation.current){setFailure(e?.message||'Impossible de vérifier les retours à reprendre.');onActiveChange?.(null);}}
  finally{if(id===generation.current)setLoading(false);}
 },[enabled,tenant?.id,profile?.id,onActiveChange]);
 useEffect(()=>{
  setActive(null);setActionError('');onActiveChange?.(null);
  void refresh();
  const update=()=>{void refresh();};
  window.addEventListener(RETURN_REQUEST_CHANGED,update);
  window.addEventListener('focus',update);
  return()=>{++generation.current;window.removeEventListener(RETURN_REQUEST_CHANGED,update);window.removeEventListener('focus',update);};
 },[refresh,onActiveChange]);
 const act=async(action:'resume'|'cancel'|'ack')=>{
  if(!active||executing.current)return;
  executing.current=true;setBusy(true);setActionError('');
  try{
   if(action==='resume')await executeReturnRequest(active.request_key);
   else{await finishReturnRequest(active.request_key,action);onResolved?.();}
  }catch(e:any){setActionError(e?.message||'Opération non confirmée. Actualisez la demande.');}
  finally{executing.current=false;setBusy(false);await refresh();}
 };
 if(!enabled)return null;
 if(!active&&!failure)return loading?<div role="status" className="flex items-center gap-2 py-2 text-xs text-neutral-500"><Loader2 className="h-4 w-4 animate-spin"/>Vérification des retours à reprendre…</div>:null;
 return <section className="rounded-lg border border-[var(--w-separator)] bg-[var(--w-surface)] p-3 my-2 text-sm" aria-label="Reprise des retours">
   <div className="flex items-start gap-2"><RotateCcw className="mt-0.5 h-4 w-4 shrink-0"/><div className="min-w-0 flex-1">
    <p className="font-semibold">Retour à reprendre</p>
    {failure&&<p role="alert" className="text-xs mt-1 text-red-700">{failure}</p>}
    {active?.access_revoked?<p className="text-xs mt-1">L’accès au magasin a changé. Une demande non exécutée peut être annulée.</p>:active&&<div className="mt-1 text-xs space-y-1">
      <p className="font-medium break-words">{active.sale_number||'Vente d’origine'} │ {active.site_name||'Magasin d’origine'}</p>
      <p>{active.payload?.mode==='cash'?'Espèces':active.payload?.mode==='avoir'?'Avoir':'Traitement différé'} │ {active.payload?.restock?'Avec remise en stock':'Sans remise en stock'}</p>
      {active.state==='succeeded'?<p className="font-medium">Enregistré : {active.result?.return_number||'Retour confirmé'}{active.result?.total!=null?' │ '+formatFCFA(Number(active.result.total)):''}. Aucun nouveau retour ne sera créé.</p>:<p>La demande originale est conservée sur le serveur. Reprenez-la à l’identique ou annulez-la avant de créer un nouveau retour.</p>}
    </div>}
    {actionError&&<p role="alert" className="text-xs text-red-700 mt-2">{actionError}</p>}
   </div></div>
   <div className="mt-3 flex flex-wrap gap-2 justify-end">
    <button type="button" disabled={busy||loading} onClick={()=>void refresh()} className="px-3 py-2 border border-neutral-300 rounded-md text-xs disabled:opacity-50">Actualiser</button>
    {active?.state==='pending'&&<><button type="button" disabled={busy||loading} onClick={()=>void act('cancel')} className="px-3 py-2 border border-neutral-300 rounded-md text-xs disabled:opacity-50">Annuler la demande</button>
    {!active.access_revoked&&<button type="button" disabled={busy||loading} onClick={()=>void act('resume')} className="px-3 py-2 bg-neutral-900 text-white rounded-md text-xs font-semibold disabled:opacity-50">Reprendre le retour</button>}</>}
    {active?.state==='succeeded'&&<button type="button" disabled={busy||loading} onClick={()=>void act('ack')} className="px-3 py-2 bg-neutral-900 text-white rounded-md text-xs font-semibold disabled:opacity-50">Terminer</button>}
   </div>
 </section>;
}
