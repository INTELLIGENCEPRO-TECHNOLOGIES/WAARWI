import {useEffect,useRef,useState} from 'react';
import {supabase} from './supabase';
import type {DocumentEditLease} from './useDocumentEditLease';
export type QuoteBaseline={quoteId:string;version:string};
export type LockedQuoteSnapshot={version:string;quote:{id:string;site_id:string;customer_id:string|null;doc_header:Record<string,string|null>|null;created_at:string;representative_id:string|null;total:number;subtotal:number;discount:number;status:string;quote_number:string;valid_until:string|null;note:string;converted_sale_id:string|null;user_id:string|null};items:{id:string;article_id:string|null;name:string;quantity:number;unit_price:number;discount:number;total:number}[]};
export function quoteSnapshotForm(s:LockedQuoteSnapshot){
 const q=s.quote,h=q.doc_header||{};
 return {customer_id:q.customer_id||'',doc_date:h.doc_date||new Date(q.created_at).toLocaleDateString('sv-SE',{timeZone:'Africa/Dakar'}),delivery_date:h.delivery_date||'',reference:h.reference||'',warranty:h.warranty||'',representative:q.representative_id||'',imei:h.imei||'',valid_until:q.valid_until||'',note:q.note||''};
}
type State={key:string;ready:boolean;conflict:boolean;error:string};
export function useLockedQuoteSnapshot({tenantId,quoteId,lease,enabled,baseline,preserveDraft,hydrate,onBaseline}:{tenantId?:string;quoteId:string|null;lease:DocumentEditLease;enabled:boolean;baseline:QuoteBaseline|null;preserveDraft:boolean;hydrate:(s:LockedQuoteSnapshot)=>void;onBaseline:(b:QuoteBaseline)=>void}){
 const key=enabled&&lease.held&&lease.token&&tenantId&&quoteId?tenantId+':'+quoteId+':'+lease.windowId+':'+lease.token:'';
 const [state,setState]=useState<State|null>(null),[retry,setRetry]=useState(0);
 const force=useRef(false);
 const current=useRef({baseline,preserveDraft,hydrate,onBaseline});current.current={baseline,preserveDraft,hydrate,onBaseline};
 useEffect(()=>{
  if(!key||!quoteId||!tenantId||!lease.token){setState(null);return;}
  let alive=true;const forceReload=force.current;force.current=false;
  setState({key,ready:false,conflict:false,error:''});
  void(async()=>{
   try{
    const {data,error}=await supabase.rpc('load_locked_quote_edit',{p_tenant_id:tenantId,p_quote_id:quoteId,p_window_id:lease.windowId,p_lock_token:lease.token});
    if(error)throw error;if(!alive)return;
    const snap=data as LockedQuoteSnapshot;
    if(!snap?.version||snap.quote?.id!==quoteId||!Array.isArray(snap.items))throw new Error('Devis indisponible.');
    if(snap.quote.converted_sale_id||!['draft','sent'].includes(snap.quote.status))throw new Error('Ce devis ne peut plus être modifié.');
    const prior=current.current.baseline?.quoteId===quoteId?current.current.baseline.version:null;
    if(!forceReload&&((prior&&prior!==snap.version)||(!prior&&current.current.preserveDraft))){
     setState({key,ready:false,conflict:true,error:'Le devis a changé depuis votre ouverture. Rechargez le devis avant de poursuivre.'});return;
    }
    if(forceReload||!prior){current.current.hydrate(snap);current.current.onBaseline({quoteId,version:snap.version});}
    setState({key,ready:true,conflict:false,error:''});
   }catch(e){if(alive)setState({key,ready:false,conflict:false,error:e&&typeof e==='object'&&'message' in e?String(e.message):'Chargement impossible.'});}
  })();
  return()=>{alive=false;};
 },[key,retry,quoteId,tenantId,lease.windowId,lease.token]);
 const valid=state?.key===key?state:null;
 return {ready:!!key&&!!valid?.ready,conflict:!!valid?.conflict,error:valid?.error||'',checking:!!key&&(!valid||(!valid.ready&&!valid.error)),reload:()=>{force.current=true;setRetry(n=>n+1);},retry:()=>setRetry(n=>n+1)};
}
export async function readQuoteActionSnapshot(tenantId:string,quoteId:string){
 const {data,error}=await supabase.rpc('read_quote_action_snapshot',{p_tenant_id:tenantId,p_quote_id:quoteId});
 if(error)throw error;
 const snap=data as LockedQuoteSnapshot;
 if(!snap?.version||snap.quote?.id!==quoteId||!Array.isArray(snap.items))throw new Error('Devis indisponible.');
 return snap;
}
