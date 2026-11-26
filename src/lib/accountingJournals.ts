import {useEffect,useState} from 'react';
import {supabase} from './supabase';
export const SYSTEM_JOURNALS=[{code:'AC',name:'Journal des achats'},{code:'BQ',name:'Journal de banque'},{code:'CA',name:'Journal de caisse'},{code:'OD',name:'Opérations diverses'},{code:'VE',name:'Journal des ventes'}] as const;
export type AccountingJournal={code:string;name:string;is_active:boolean;is_system:boolean;revision:number};
export function useAccountingJournals(tenantId:string|undefined,revision=0){
 const [rows,setRows]=useState<AccountingJournal[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{let alive=true;setRows([]);setError('');setLoading(true);if(!tenantId){setLoading(false);return;}
 void(async()=>{try{const {data,error:e}=await supabase.rpc('list_accounting_journals',{p_tenant_id:tenantId});if(e)throw e;if(alive)setRows(data??[]);}catch(e){if(alive)setError(e&&typeof e==='object'&&'message' in e?String(e.message):'Impossible de charger les journaux.');}finally{if(alive)setLoading(false);}})();return()=>{alive=false;};},[tenantId,revision]);
 return {rows,loading,error};
}
