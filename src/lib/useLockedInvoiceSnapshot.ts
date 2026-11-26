import {useEffect,useRef,useState} from 'react';
import {supabase} from './supabase';
import type {DocumentEditLease} from './useDocumentEditLease';
export type InvoiceBaseline={saleId:string;version:string};
export type LockedInvoiceSnapshot={version:string;sale:{id:string;customer_id:string|null;doc_header:Record<string,string|null>|null;created_at:string;representative_id:string|null;total:number;paid:number;status:string;vat_enabled_at_issue:boolean;vat_net_amount:number|null;vat_amount:number|null;accounting_status:string};items:{article_id:string;name:string;quantity:number;unit_price:number;discount:number;total:number}[]};
type State={key:string;ready:boolean;conflict:boolean;error:string};
export function invoiceSnapshotForm(s:LockedInvoiceSnapshot){
 const h=s.sale.doc_header||{};
 return {customer_id:s.sale.customer_id||'',doc_date:h.doc_date||new Date(s.sale.created_at).toISOString().slice(0,10),delivery_date:h.delivery_date||'',reference:h.reference||'',warranty:h.warranty||'',representative:s.sale.representative_id||'',imei:h.imei||''};
}
export function useLockedInvoiceSnapshot({tenantId,saleId,lease,enabled,baseline,preserveDraft,hydrate,onBaseline}:{tenantId?:string;saleId:string|null;lease:DocumentEditLease;enabled:boolean;baseline:InvoiceBaseline|null;preserveDraft:boolean;hydrate:(s:LockedInvoiceSnapshot)=>void;onBaseline:(b:InvoiceBaseline)=>void}){
 const key=enabled&&lease.held&&lease.token&&tenantId&&saleId?tenantId+':'+saleId+':'+lease.windowId+':'+lease.token:'';
 const [state,setState]=useState<State|null>(null),[retry,setRetry]=useState(0);
 const force=useRef(false);
 const current=useRef({baseline,preserveDraft,hydrate,onBaseline});current.current={baseline,preserveDraft,hydrate,onBaseline};
 useEffect(()=>{
  if(!key||!saleId||!tenantId||!lease.token){setState(null);return;}
  let alive=true;const forceReload=force.current;force.current=false;
  setState({key,ready:false,conflict:false,error:''});
  void(async()=>{
   try{
    const {data,error}=await supabase.rpc('load_locked_invoice_edit',{p_tenant_id:tenantId,p_sale_id:saleId,p_window_id:lease.windowId,p_lock_token:lease.token});
    if(error)throw error;
    if(!alive)return;
    const snap=data as LockedInvoiceSnapshot;
    if(!snap?.version||snap.sale?.id!==saleId||!Array.isArray(snap.items))throw new Error('Facture indisponible.');
    const prior=current.current.baseline?.saleId===saleId?current.current.baseline.version:null;
    if(!forceReload&&((prior&&prior!==snap.version)||(!prior&&current.current.preserveDraft))){
     setState({key,ready:false,conflict:true,error:'La version de votre brouillon ne correspond plus à la facture enregistrée. Rechargez la facture avant de la modifier.'});return;
    }
    if(forceReload||!prior){current.current.hydrate(snap);current.current.onBaseline({saleId,version:snap.version});}
    setState({key,ready:true,conflict:false,error:''});
   }catch(e){if(alive)setState({key,ready:false,conflict:false,error:e&&typeof e==='object'&&'message' in e?String(e.message):'Chargement impossible.'});}
  })();
  return()=>{alive=false;};
 },[key,retry,saleId,tenantId,lease.windowId,lease.token]);
 const validState=state?.key===key?state:null;
 return {ready:!!key&&!!validState?.ready,conflict:!!validState?.conflict,error:validState?.error||'',checking:!!key&&(!validState||(!validState.ready&&!validState.error)),reload:()=>{force.current=true;setRetry(n=>n+1);},retry:()=>setRetry(n=>n+1)};
}
