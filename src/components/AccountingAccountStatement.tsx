import { useEffect,useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatDate } from '../lib/format';

type Account={code:string;name:string;account_type:string;is_active:boolean};
type Line={line_id:string;entry_id:string;entry_date:string;entry_number:string;journal_type:string;reference:string|null;description:string;source_type:string|null;source_id:string|null;status:string;label:string|null;debit:number;credit:number;running_balance:number};
type Statement={account:Account;opening_balance:number;total_debit:number;total_credit:number;closing_balance:number;row_count:number;rows:Line[]};
const money=(n:number)=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(Number(n))+' FCFA';
const balance=(n:number)=>Number(n)===0?'0 FCFA':money(Math.abs(Number(n)))+(Number(n)>0?' D':' C');
const today=()=>new Date().toISOString().slice(0,10);
const msg=(e:unknown)=>e&&typeof e==='object'&&'message' in e?String(e.message):'Chargement impossible.';
function csv(v:unknown){if(typeof v==='number'&&Number.isFinite(v))return String(v).replace('.',',');let s=String(v??'');if(/^[\s\u0000-\u001f]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}

export function AccountingAccountStatement({tenantId,onView,initialAccount=''}:{tenantId:string;onView:(entry:Line)=>void;initialAccount?:string}) {
 const [search,setSearch]=useState(initialAccount);
 const [searchQuery,setSearchQuery]=useState({term:initialAccount,offset:0});
 const [accounts,setAccounts]=useState<Account[]>([]);
 const [accountMore,setAccountMore]=useState(false);
 const [accountBusy,setAccountBusy]=useState(true);
 const [accountError,setAccountError]=useState('');
 const [code,setCode]=useState(initialAccount);
 const [from,setFrom]=useState(()=>today().slice(0,4)+'-01-01');
 const [to,setTo]=useState(today);
 const [request,setRequest]=useState<{code:string;from:string;to:string;offset:number;revision:number}|null>(()=>initialAccount?{code:initialAccount,from:today().slice(0,4)+'-01-01',to:today(),offset:0,revision:0}:null);
 const [result,setResult]=useState<Statement|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 useEffect(()=>{
  let live=true;setAccountBusy(true);setAccountError('');
  void (async()=>{try{
   let q=supabase.from('accounts').select('code,name,account_type,is_active').eq('tenant_id',tenantId);
   const term=searchQuery.term.trim().replace(/[%_\\]/g,'');
   if(term)q=q.ilike(/^\d/.test(term)?'code':'name',/^\d/.test(term)?term+'%':'%'+term+'%');
   const {data,error:err}=await q.order('code').range(searchQuery.offset,searchQuery.offset+24);
   if(err)throw err;
   if(live){setAccounts((data??[]).slice(0,24) as Account[]);setAccountMore((data??[]).length>24);}
  }catch(e){if(live){setAccounts([]);setAccountMore(false);setAccountError(msg(e));}}
  finally{if(live)setAccountBusy(false);}})();
  return()=>{live=false;};
 },[tenantId,searchQuery]);
 useEffect(()=>{
  let live=true;setResult(null);setError('');
  if(!request){setBusy(false);return;}
  setBusy(true);
  void(async()=>{try{
   const {data,error:err}=await supabase.rpc('accounting_account_statement',{p_tenant_id:tenantId,p_account_code:request.code,p_date_from:request.from,p_date_to:request.to,p_offset:request.offset});
   if(err)throw err;
   if(live)setResult(data as Statement);
  }catch(e){if(live)setError(msg(e));}finally{if(live)setBusy(false);}})();
  return()=>{live=false;};
 },[tenantId,request]);
 const valid=!!code&&!!from&&!!to&&from<=to&&(Date.parse(to)-Date.parse(from))/86400000<=366;
 const changed=!!request&&(code!==request.code||from!==request.from||to!==request.to);
 const run=()=>{if(valid)setRequest({code,from,to,offset:0,revision:(request?.revision??0)+1});};
 const download=()=>{
  if(!result||!request)return;
  const rows:unknown[][]=[['Interrogation du compte',result.account.code,result.account.name],['Période',request.from,request.to],['Solde initial (D positif/C négatif)',Number(result.opening_balance)],['Débit période',Number(result.total_debit)],['Crédit période',Number(result.total_credit)],['Solde final (D positif/C négatif)',Number(result.closing_balance)],['Date','Pièce','Journal','Référence','Libellé','Débit','Crédit','Solde cumulé'],...result.rows.map(r=>[r.entry_date,r.entry_number,r.journal_type,r.reference,r.label||r.description,Number(r.debit),Number(r.credit),Number(r.running_balance)])];
  const blob=new Blob(['\uFEFF'+rows.map(r=>r.map(csv).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='Compte-'+request.code+'-'+request.from+'-'+request.to+'-page-'+(request.offset/50+1)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 return <section className="space-y-4 min-w-0">
  <div className="card p-3 space-y-3">
   <form className="flex flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();setSearchQuery({term:search,offset:0});}}>
    <label className="flex-1 min-w-0 text-xs font-medium">Rechercher un compte<input className="input mt-1 w-full" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Code ou intitulé"/></label>
    <button className="btn btn-secondary" disabled={accountBusy}>Rechercher</button>
   </form>
   {accountError&&<p role="alert" className="text-xs text-red-700">{accountError}</p>}
   {accountBusy?<p role="status" className="text-xs text-neutral-500">Recherche…</p>:<div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">{accounts.map(a=><button type="button" key={a.code} aria-pressed={code===a.code} className={'text-left rounded-lg p-2 border min-w-0 '+(code===a.code?'border-neutral-900 bg-neutral-100':'border-neutral-200')} onClick={()=>setCode(a.code)}><span className="block text-sm font-semibold">{a.code}</span><span className="block text-xs break-words">{a.name}</span><span className="text-xs text-neutral-500">{a.account_type==='auxiliary'?'Auxiliaire':'Général'}{a.is_active?'':' · Inactif'}</span></button>)}{!accounts.length&&<p className="text-xs text-neutral-500">Aucun compte trouvé.</p>}</div>}
   <div className="flex justify-between"><button className="btn btn-secondary" type="button" disabled={accountBusy||searchQuery.offset===0} onClick={()=>setSearchQuery(p=>({...p,offset:p.offset-24}))}>Précédent</button><button className="btn btn-secondary" type="button" disabled={accountBusy||!accountMore} onClick={()=>setSearchQuery(p=>({...p,offset:p.offset+24}))}>Suivant</button></div>
   <form className="grid gap-2 sm:grid-cols-4 sm:items-end" onSubmit={e=>{e.preventDefault();run();}}>
    <label className="text-xs font-medium min-w-0">Compte sélectionné<input className="input mt-1 w-full" value={code} onChange={e=>setCode(e.target.value.trim())} required placeholder="Numéro exact"/></label>
    <label className="text-xs font-medium min-w-0">Du<input className="input mt-1 w-full" type="date" value={from} onChange={e=>setFrom(e.target.value)} required/></label>
    <label className="text-xs font-medium min-w-0">Au<input className="input mt-1 w-full" type="date" value={to} onChange={e=>setTo(e.target.value)} required/></label>
    <button className="btn btn-primary" disabled={!valid||busy}>Interroger</button>
   </form>
   {changed&&<p className="text-xs text-neutral-600">Interrogez le compte pour appliquer les nouveaux critères.</p>}
  </div>
  {busy&&<p role="status" className="text-sm text-neutral-500 py-6 text-center">Chargement du compte…</p>}
  {error&&<p role="alert" className="text-sm text-red-700 break-words">{error}</p>}
  {result&&request&&<div className="space-y-4">
   <div className="flex flex-wrap justify-between gap-2 items-center"><div><h2 className="text-sm font-semibold break-words">{result.account.code} · {result.account.name}</h2><p className="text-xs text-neutral-500">{formatDate(request.from)} au {formatDate(request.to)} · Écritures validées</p></div><button className="btn btn-secondary" onClick={download}>Exporter cette page (CSV)</button></div>
   <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">{[['Solde initial',balance(result.opening_balance)],['Débit période',money(result.total_debit)],['Crédit période',money(result.total_credit)],['Solde final',balance(result.closing_balance)]].map(([label,value])=><div className="card p-3 min-w-0" key={label}><p className="text-xs text-neutral-500">{label}</p><p className="mt-1 font-semibold text-sm tabular-nums break-words">{value}</p></div>)}</div>
   <p className="text-xs text-neutral-500">D : débiteur · C : créditeur. Soldes calculés sur les écritures enregistrées, hors écritures annulées et brouillons.</p>
   <div className="divide-y divide-neutral-200 border-y border-neutral-200">
    {!result.rows.length&&<p className="py-5 text-sm text-neutral-500">Aucun mouvement dans cette période.</p>}
    {result.rows.map(r=><div key={r.line_id} className="py-3 grid gap-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_auto] items-start">
     <div className="min-w-0"><button type="button" className="text-sm font-semibold underline text-left break-words" onClick={()=>onView(r)}>{r.entry_number} · {formatDate(r.entry_date)}</button><p className="text-xs text-neutral-600 break-words">{r.journal_type} · {r.label||r.description}</p>{r.reference&&<p className="text-xs text-neutral-500 break-words">Réf. : {r.reference}</p>}</div>
     <div className="grid grid-cols-2 gap-2"><div><p className="text-xs text-neutral-500">Débit</p><p className="text-sm tabular-nums break-words">{money(r.debit)}</p></div><div><p className="text-xs text-neutral-500">Crédit</p><p className="text-sm tabular-nums break-words">{money(r.credit)}</p></div></div>
     <div><p className="text-xs text-neutral-500">Solde cumulé</p><p className="font-semibold text-sm tabular-nums break-words">{balance(r.running_balance)}</p></div>
    </div>)}
   </div>
   <nav aria-label="Pages du compte" className="flex flex-wrap justify-between items-center gap-2"><button type="button" className="btn btn-secondary" disabled={changed||request.offset===0} onClick={()=>setRequest(p=>p&&({...p,offset:p.offset-50}))}>Précédente</button><span className="text-xs text-neutral-500">{result.row_count} mouvements · Page {request.offset/50+1}/{Math.max(1,Math.ceil(result.row_count/50))}</span><button type="button" className="btn btn-secondary" disabled={changed||request.offset+50>=result.row_count} onClick={()=>setRequest(p=>p&&({...p,offset:p.offset+50}))}>Suivante</button></nav>
  </div>}
 </section>;
}
