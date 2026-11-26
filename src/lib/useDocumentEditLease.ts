import {useEffect,useRef,useState,useCallback} from 'react';
import {supabase} from './supabase';

export type LeaseKind='accounting_journal'|'sale';
type Action='acquire'|'heartbeat'|'status'|'request'|'decline'|'release'|'takeover';
type Result={state:'held'|'busy'|'expired'|'free';token?:string|null;owner_name?:string;opened_at?:string;expires_at?:string;server_now:string;request_state?:'pending'|'declined'|null;requester_name?:string;requested_at?:string;can_takeover?:boolean};
type Snapshot={scope:string;windowId:string;result:Result|null;error:string;checking:boolean;validUntil:number;released:boolean};
type Wake=(p:unknown)=>void;
const channels=new Map<string,{channel:ReturnType<typeof supabase.channel>;listeners:Set<Wake>}>();
function listen(userId:string,fn:Wake){
 let record=channels.get(userId);
 if(!record){
  const listeners=new Set<Wake>();
  const channel=supabase.channel('waarwi-edit:'+userId,{config:{private:true}}).on('broadcast',{event:'changed'},m=>{for(const cb of listeners)cb(m.payload);}).subscribe();
  record={channel,listeners};channels.set(userId,record);
 }
 record.listeners.add(fn);
 return ()=>{record?.listeners.delete(fn);if(record&&!record.listeners.size&&channels.get(userId)===record){channels.delete(userId);void supabase.removeChannel(record.channel);}};
}
export function useDocumentEditLease({tenantId,userId,kind,resource,enabled,dirty,saving}:{tenantId?:string;userId?:string;kind:LeaseKind;resource:string;enabled:boolean;dirty:boolean;saving:boolean}){
 const scope=enabled&&tenantId&&userId&&resource?tenantId+':'+userId+':'+kind+':'+resource:'';
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
 const [now,setNow]=useState(Date.now());
 const actionRef=useRef<(a:Action)=>Promise<void>>(async()=>{});
 const inputRef=useRef(0);const latest=useRef({dirty,saving});latest.current={dirty,saving};
 const markActivity=useCallback(()=>{inputRef.current=Date.now();},[]);
 useEffect(()=>{
  if(!scope||!tenantId||!userId){setSnapshot(null);return;}
  const windowId=crypto.randomUUID();let alive=true,flight=false,token:string|null=null,observed:Result|null=null,released=false;
  inputRef.current=Date.now();
  const publish=(result:Result|null,error='',checking=false)=>{
   if(!alive)return;
   const remaining=result?.expires_at?Math.max(0,Date.parse(result.expires_at)-Date.parse(result.server_now)):0;
   setSnapshot({scope,windowId,result,error,checking,validUntil:Date.now()+remaining,released});
  };
  const rpc=async(action:Action,providedToken=token)=>{
   const {data,error}=await supabase.rpc('document_edit_lease',{p_tenant_id:tenantId,p_resource_type:kind,p_resource_key:resource,p_window_id:windowId,p_action:action,p_token:providedToken,p_active:document.visibilityState==='visible'&&Date.now()-inputRef.current<25000,p_dirty:latest.current.dirty});
   if(error)throw error;
   return data as Result;
  };
  const run=async(action:Action)=>{
   if(!alive||flight)return;
   if(action==='release'&&latest.current.saving)return;
   flight=true;
   try{
    let result=await rpc(action);
    if(!alive){if(result.state==='held'&&result.token)void rpc('release',result.token).catch(()=>{});return;}
    if(action==='release'&&result.state!=='held')released=true;
    if(action==='acquire'&&result.state==='held')released=false;
    if(action==='request')released=false;
    token=result.state==='held'?result.token??null:null;observed=result;
    if(!released&&result.can_takeover&&action!=='takeover'&&document.visibilityState==='visible'){
     result=await rpc('takeover');if(!alive){if(result.state==='held'&&result.token)void rpc('release',result.token).catch(()=>{});return;}
     observed=result;token=result.state==='held'?result.token??null:null;
    }
    publish(result);
   }catch(e){publish(observed,e&&typeof e==='object'&&'message' in e?String(e.message):'Connexion indisponible.');}
   finally{flight=false;}
  };
  actionRef.current=run;publish(null,'',true);
  const tick=()=>{if(alive)void run(token&&!released?'heartbeat':'status');};
  const unlisten=listen(userId,p=>{const v=p as {tenant_id?:string;resource_type?:string;resource_key?:string};if(v?.tenant_id===tenantId&&v.resource_type===kind&&v.resource_key===resource)tick();});
  void run('acquire');
  const interval=window.setInterval(tick,12000);
  const clock=window.setInterval(()=>setNow(Date.now()),1000);
  const offline=()=>publish(observed,'Connexion interrompue. Enregistrement suspendu.');
  window.addEventListener('online',tick);document.addEventListener('visibilitychange',tick);window.addEventListener('offline',offline);
  return()=>{alive=false;actionRef.current=async()=>{};clearInterval(interval);clearInterval(clock);unlisten();window.removeEventListener('online',tick);window.removeEventListener('offline',offline);document.removeEventListener('visibilitychange',tick);if(token&&!latest.current.saving)void rpc('release',token).catch(()=>{});};
 },[scope,tenantId,userId,kind,resource]);
 const current=snapshot?.scope===scope?snapshot:null;
 const valid=!!current&&!current.error&&!current.released&&current.result?.state==='held'&&!!current.result.token&&now<current.validUntil&&navigator.onLine;
 return {held:valid,windowId:current?.windowId??'',token:valid?current?.result?.token??null:null,result:current?.result??null,error:current?.error??'',checking:!!scope&&(!current||current.checking),released:current?.released??false,now,markActivity,action:(a:Action)=>actionRef.current(a)};
}
export type DocumentEditLease=ReturnType<typeof useDocumentEditLease>;
