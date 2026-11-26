import {supabase} from './supabase';
export const RETURN_REQUEST_CHANGED='waarwi:return-request-changed';
export type ReturnMode='cash'|'avoir'|'deferred';
export type ReturnFlow='invoice'|'pos'|'supervision';
export type ReturnRequestInput={key:string;flow:ReturnFlow;saleId:string;siteId:string;sessionId:string|null;items:unknown[];reason:string;restock:boolean;mode:ReturnMode};
export type ReturnRequestResult={id?:string;return_id?:string;return_number?:string;total?:number;success?:boolean;refunded?:boolean;refund_method?:string;status?:string};
export type ActiveReturnRequest={request_key:string;state:'pending'|'succeeded';flow?:ReturnFlow;sale_number?:string;site_name?:string;access_revoked?:boolean;payload?:{items?:unknown[];restock?:boolean;mode?:ReturnMode;reason?:string};result?:ReturnRequestResult};
function changed(){window.dispatchEvent(new Event(RETURN_REQUEST_CHANGED));}
export async function readActiveReturnRequest():Promise<ActiveReturnRequest|null>{
 const {data,error}=await supabase.rpc('read_active_return_request');
 if(error)throw error;
 if(data===null)return null;
 if(!data?.request_key||!['pending','succeeded'].includes(data.state))throw new Error('État de reprise non confirmé.');
 return data as ActiveReturnRequest;
}
export async function executeReturnRequest(key:string):Promise<ReturnRequestResult>{
 try{
  const {data,error}=await supabase.rpc('execute_return_request',{p_key:key});
  if(error)throw error;
  if(!data?.id&&!data?.return_id)throw new Error('Retour non confirmé. Consultez la demande de reprise.');
  return data as ReturnRequestResult;
 }finally{changed();}
}
export async function submitReturnRequest(input:ReturnRequestInput):Promise<ReturnRequestResult>{
 try{
  const {data,error}=await supabase.rpc('stage_return_request',{
   p_key:input.key,p_flow:input.flow,p_sale_id:input.saleId,p_site_id:input.siteId,p_session_id:input.sessionId,
   p_items:input.items,p_reason:input.reason,p_restock:input.restock,p_mode:input.mode
  });
  if(error)throw error;
  if(data?.request_key!==input.key)throw new Error('Demande non confirmée. Consultez la demande de reprise.');
  return await executeReturnRequest(input.key);
 }finally{changed();}
}
export async function finishReturnRequest(key:string,action:'ack'|'cancel'):Promise<void>{
 try{
  const {data,error}=await supabase.rpc('finish_return_request',{p_key:key,p_action:action});
  if(error)throw error;
  if(data?.state!==(action==='ack'?'acknowledged':'cancelled'))throw new Error('État de reprise non confirmé.');
 }finally{changed();}
}
