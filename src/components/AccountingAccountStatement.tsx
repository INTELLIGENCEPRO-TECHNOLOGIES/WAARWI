import { useEffect,useRef,useState } from 'react';
import { supabase } from '../lib/supabase';
import { AccountingTable } from './AccountingWorkspace';
import { ChevronLeft, ChevronRight, Search, MoreHorizontal } from './Icons';
import { formatDate } from '../lib/format';

type Account={code:string;name:string;account_type:string;is_active:boolean};
type Line={line_id:string;entry_id:string;entry_date:string;entry_number:string;journal_type:string;reference:string|null;description:string;source_type:string|null;source_id:string|null;status:string;label:string|null;debit:number;credit:number;running_balance:number;match_group_id:string|null;match_code:string|null};
type Suggestion={root:string;root_piece:string;first_date:string;last_date:string;amount:number;line_ids:string[];entries:string[]};
type Suggestions={total:number;rows:Suggestion[]};
type Statement={opening_mode?:'fiscal'|'continuous';account:Account;opening_balance:number;total_debit:number;total_credit:number;closing_balance:number;row_count:number;rows:Line[]};
const money=(n:number)=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(Number(n))+' FCFA';
const balance=(n:number)=>Number(n)===0?'0 FCFA':money(Math.abs(Number(n)))+(Number(n)>0?' D':' C');
const today=()=>new Date().toISOString().slice(0,10);
const msg=(e:unknown)=>e&&typeof e==='object'&&'message' in e?String(e.message):'Chargement impossible.';
function csv(v:unknown){if(typeof v==='number'&&Number.isFinite(v))return String(v).replace('.',',');let s=String(v??'');if(/^[\s\u0000-\u001f]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}

export function AccountingAccountStatement({tenantId,onView,initialAccount='',canManage=false,refreshRevision=0}:{tenantId:string;onView:(entry:Line)=>void;initialAccount?:string;canManage?:boolean;refreshRevision?:number}) {
 const [search,setSearch]=useState(initialAccount);
 const [chooseAccount,setChooseAccount]=useState(!initialAccount);
 const [matchingOpen,setMatchingOpen]=useState(false);
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
 const [chosen,setChosen]=useState<Record<string,Line>>({});
 const [saving,setSaving]=useState(false);
 const writeLock=useRef(false);
 const [writeError,setWriteError]=useState('');
 const [notice,setNotice]=useState('');
 const [release,setRelease]=useState<{group:string;code:string;reason:string}|null>(null);
 const [suggestions,setSuggestions]=useState<Suggestions|null>(null);
 const [suggestionBusy,setSuggestionBusy]=useState(false);
 const [confirmSuggestion,setConfirmSuggestion]=useState<string|null>(null);
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
 },[tenantId,request,refreshRevision]);
 const valid=!!code&&!!from&&!!to&&from<=to&&(Date.parse(to)-Date.parse(from))/86400000<=366;
 const changed=!!request&&(code!==request.code||from!==request.from||to!==request.to);
 useEffect(()=>{setChosen({});setRelease(null);setSuggestions(null);setConfirmSuggestion(null);},[refreshRevision]);
 const canMatch=canManage&&result?.account.account_type==='auxiliary'&&/^(401|411)/.test(result.account.code);
 const selected=Object.values(chosen);
 const sumDebit=selected.reduce((n,l)=>n+Math.round(Number(l.debit)*100),0);
 const sumCredit=selected.reduce((n,l)=>n+Math.round(Number(l.credit)*100),0);
 const equal=selected.length>=2&&sumDebit>0&&sumDebit===sumCredit;
 const run=()=>{if(valid&&!saving&&!suggestionBusy){setChosen({});setRelease(null);setSuggestions(null);setConfirmSuggestion(null);setWriteError('');setNotice('');setRequest({code,from,to,offset:0,revision:(request?.revision??0)+1});}};
 const toggle=(line:Line)=>{
  setChosen(old=>{const next={...old};if(next[line.line_id])delete next[line.line_id];else if(Object.keys(next).length<100)next[line.line_id]=line;return next;});
 };
 const loadSuggestions=async()=>{
  if(!request||!canMatch||changed||suggestionBusy||saving)return;
  setSuggestionBusy(true);setWriteError('');setConfirmSuggestion(null);
  try{
   const {data,error:err}=await supabase.rpc('accounting_matching_suggestions',{p_tenant_id:tenantId,p_account_code:request.code,p_date_to:request.to});
   if(err)throw err;setSuggestions(data as Suggestions);
  }catch(e){setWriteError(msg(e));setSuggestions(null);}finally{setSuggestionBusy(false);}
 };
 const apply=async(unmatch=false,ids?:string[])=>{
  if(!request||!canMatch||changed||writeLock.current||busy||suggestionBusy||(!unmatch&&!ids&&!equal)||(unmatch&&!release?.reason.trim()))return;
  writeLock.current=true;setSaving(true);setWriteError('');setNotice('');
  try{
   const response=unmatch&&release
    ?await supabase.rpc('unmatch_accounting_lines',{p_tenant_id:tenantId,p_account_code:request.code,p_group_id:release.group,p_reason:release.reason.trim()})
    :await supabase.rpc('match_accounting_lines',{p_tenant_id:tenantId,p_account_code:request.code,p_line_ids:ids??selected.map(l=>l.line_id)});
   if(response.error)throw response.error;
   if(!response.data?.success)throw new Error('Opération non confirmée.');
   setChosen({});setRelease(null);setSuggestions(null);setConfirmSuggestion(null);
   setNotice(unmatch?'Lettrage annulé et motif enregistré.':'Lignes lettrées avec succès.');
   setRequest(p=>p&&({...p,revision:p.revision+1}));
  }catch(e){setWriteError(msg(e));}
  finally{setSaving(false);writeLock.current=false;}
 };
 const download=()=>{
  if(!result||!request)return;
  const rows:unknown[][]=[['Interrogation du compte',result.account.code,result.account.name],['Période',request.from,request.to],['Solde initial (D positif/C négatif)',Number(result.opening_balance)],['Débit période',Number(result.total_debit)],['Crédit période',Number(result.total_credit)],['Solde final (D positif/C négatif)',Number(result.closing_balance)],['Date','Pièce','Journal','Référence','Libellé','Débit','Crédit','Solde cumulé','Groupe de lettrage'],...result.rows.map(r=>[r.entry_date,r.entry_number,r.journal_type,r.reference,r.label||r.description,Number(r.debit),Number(r.credit),Number(r.running_balance),r.match_code??''])];
  const blob=new Blob(['\uFEFF'+rows.map(r=>r.map(csv).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='Compte-'+request.code+'-'+request.from+'-'+request.to+'-page-'+(request.offset/50+1)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 return <section className="space-y-4 min-w-0">
  <div className="space-y-2">
   <div className="acc-toolbar"><button type="button" className="btn-secondary" aria-expanded={chooseAccount} onClick={()=>setChooseAccount(v=>!v)}><Search size={16}/>Choisir un compte</button><span className="text-xs text-neutral-500">{code||'Aucun compte sélectionné'}</span></div>
   {chooseAccount&&<div className="space-y-2">
   <form className="flex flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();setSearchQuery({term:search,offset:0});}}>
    <input aria-label="Rechercher un compte" className="input flex-1 min-w-0" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Code ou intitulé"/>
    <button className="btn-secondary" disabled={accountBusy}>Rechercher</button>
   </form>
   {accountError&&<p role="alert" className="text-xs text-red-700">{accountError}</p>}
   {accountBusy?<p role="status" className="text-xs text-neutral-500">Recherche…</p>:<div className="acc-account-picker">{accounts.map(a=><button type="button" key={a.code} aria-pressed={code===a.code} onClick={()=>{setCode(a.code);setChooseAccount(false);}}><strong>{a.code}</strong><span>{a.name}</span><small>{a.account_type==='auxiliary'?'Auxiliaire':'Général'}{a.is_active?'':' · Inactif'}</small></button>)}{!accounts.length&&<p className="text-xs text-neutral-500">Aucun compte trouvé.</p>}</div>}
   <div className="acc-pagination"><button className="acc-icon" aria-label="Comptes précédents" type="button" disabled={accountBusy||searchQuery.offset===0} onClick={()=>setSearchQuery(p=>({...p,offset:p.offset-24}))}><ChevronLeft size={17}/></button><span>Page {searchQuery.offset/24+1}</span><button className="acc-icon" aria-label="Comptes suivants" type="button" disabled={accountBusy||!accountMore} onClick={()=>setSearchQuery(p=>({...p,offset:p.offset+24}))}><ChevronRight size={17}/></button></div></div>}
   <form className="grid gap-2 sm:grid-cols-4 sm:items-end" onSubmit={e=>{e.preventDefault();run();}}>
    <label className="text-xs font-medium min-w-0">Compte sélectionné<input className="input mt-1 w-full" value={code} onChange={e=>setCode(e.target.value.trim())} required placeholder="Numéro exact"/></label>
    <label className="text-xs font-medium min-w-0">Du<input className="input mt-1 w-full" type="date" value={from} onChange={e=>setFrom(e.target.value)} required/></label>
    <label className="text-xs font-medium min-w-0">Au<input className="input mt-1 w-full" type="date" value={to} onChange={e=>setTo(e.target.value)} required/></label>
    <button className="btn btn-primary" disabled={!valid||busy||saving||suggestionBusy}>Interroger</button>
   </form>
   {changed&&<p className="text-xs text-neutral-600">Interrogez le compte pour appliquer les nouveaux critères.</p>}
  </div>
  {busy&&<p role="status" className="text-sm text-neutral-500 py-6 text-center">Chargement du compte…</p>}
  {error&&<p role="alert" className="text-sm text-red-700 break-words">{error}</p>}
  {result&&request&&<div className="space-y-4">
   <div className="flex flex-wrap justify-between gap-2 items-center"><div><h2 className="text-sm font-semibold break-words">{result.account.code} · {result.account.name}</h2><p className="text-xs text-neutral-500">{formatDate(request.from)} au {formatDate(request.to)} · Écritures validées</p></div><button className="btn btn-secondary" onClick={download}>Exporter cette page (CSV)</button></div>
   <div className="acc-summary">{[['Solde initial',balance(result.opening_balance)],['Débit période',money(result.total_debit)],['Crédit période',money(result.total_credit)],['Solde final',balance(result.closing_balance)]].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
   <p className="text-xs text-neutral-500">D : débiteur · C : créditeur. {result.opening_mode==='fiscal'?'Solde d’ouverture certifié de l’exercice, puis mouvements validés.':'Historique continu des écritures validées, sans arrêté précédent.'}</p>
   {canMatch&&<div className="acc-toolbar"><button type="button" className="btn-secondary" aria-expanded={matchingOpen} onClick={()=>setMatchingOpen(v=>!v)}><MoreHorizontal size={16}/>Lettrage et propositions</button><span className="text-xs">{selected.length} ligne(s) · Écart : {money((sumDebit-sumCredit)/100)}</span><span className="acc-spacer"/><button type="button" className="btn-primary" disabled={!equal||saving||suggestionBusy||changed||!!release} onClick={()=>void apply()}>Lettrer</button></div>}
   {canMatch&&(matchingOpen||!!release)&&<div className="space-y-3 border-b border-neutral-200 pb-3">
    <h3 className="text-sm font-semibold">Lettrage manuel</h3>
    <p className="text-xs text-neutral-600">Cochez les factures et règlements correspondants. Vous pouvez sélectionner des lignes sur plusieurs pages ; seuls les groupes exactement équilibrés sont acceptés.</p>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
     <div>Lignes sélectionnées <strong className="block text-sm">{selected.length}</strong></div>
     <div>Débit <strong className="block text-sm break-words">{money(sumDebit/100)}</strong></div>
     <div>Crédit <strong className="block text-sm break-words">{money(sumCredit/100)}</strong></div>
     <div>Écart <strong className="block text-sm break-words">{money((sumDebit-sumCredit)/100)}</strong></div>
    </div>
    <div className="flex flex-wrap gap-2"><button type="button" className="btn btn-primary" disabled={!equal||saving||suggestionBusy||changed||!!release} onClick={()=>void apply()}>Lettrer la sélection</button><button type="button" className="btn btn-secondary" disabled={!selected.length||saving} onClick={()=>setChosen({})}>Vider la sélection</button></div>
    {release&&<div className="space-y-2 border-t border-neutral-200 pt-3"><p className="text-sm font-medium">Délettrer le groupe {release.code} dans son intégralité</p><label className="block text-xs font-medium">Motif obligatoire<textarea className="input mt-1 w-full" maxLength={500} value={release.reason} disabled={saving} onChange={e=>setRelease(p=>p&&({...p,reason:e.target.value}))}/></label><div className="flex gap-2"><button type="button" className="btn btn-primary" disabled={saving||changed||!release.reason.trim()} onClick={()=>void apply(true)}>Confirmer le délettrage</button><button type="button" className="btn btn-secondary" disabled={saving} onClick={()=>setRelease(null)}>Annuler</button></div></div>}
    <div className="border-t border-neutral-200 pt-3 space-y-2">
     <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold">Propositions automatiques</h4><button type="button" className="btn btn-secondary" disabled={suggestionBusy||saving||changed} onClick={()=>void loadSuggestions()}>{suggestionBusy?'Analyse…':'Rechercher les correspondances'}</button></div>
     <p className="text-xs text-neutral-500">Correspondances fondées sur les liens facture-règlement ou avoir existants, jusqu’au {formatDate(request.to)}, y compris les périodes antérieures. Aucune association par montant seul.</p>
     {suggestions&&<div className="space-y-2"><p className="text-xs text-neutral-600">{suggestions.total} groupe(s) proposé(s){suggestions.total>25?' · 25 premiers affichés':''}.</p>
      {suggestions.rows.map(x=><div key={x.root} className="border border-neutral-200 rounded-lg p-3 space-y-2">
       <div className="flex flex-wrap justify-between gap-2"><span className="text-sm font-medium">{x.root_piece} · {x.line_ids.length} lignes</span><strong className="text-sm tabular-nums">{money(x.amount)}</strong></div>
       <p className="text-xs text-neutral-600 break-words">Pièces : {x.entries.join(' · ')}</p>
       {confirmSuggestion===x.root?<div className="flex flex-wrap gap-2"><button type="button" className="btn btn-primary" disabled={saving||changed||!!release} onClick={()=>void apply(false,x.line_ids)}>Confirmer le groupe</button><button type="button" className="btn btn-secondary" disabled={saving} onClick={()=>setConfirmSuggestion(null)}>Annuler</button></div>:<button type="button" className="btn btn-secondary" disabled={saving||changed||!!release} onClick={()=>setConfirmSuggestion(x.root)}>Lettrer ce groupe</button>}
      </div>)}</div>}
    </div>
    {writeError&&<p role="alert" className="text-xs text-red-700 break-words">{writeError}</p>}
    {notice&&<p role="status" className="text-xs text-neutral-700">{notice}</p>}
   </div>}
   <AccountingTable><table><thead><tr>{canMatch&&<th className="text-left"><span className="sr-only">Sélection</span></th>}<th className="text-left">Pièce / libellé</th><th className="text-right">Débit</th><th className="text-right">Crédit</th><th className="text-right hidden sm:table-cell">Solde</th><th className="text-center">Lettrage</th></tr></thead><tbody>
    {!result.rows.length&&<tr><td colSpan={canMatch?6:5} className="text-center text-neutral-500">Aucun mouvement dans cette période.</td></tr>}
    {result.rows.map(r=><tr key={r.line_id}>{canMatch&&<td>{!r.match_group_id&&<input type="checkbox" aria-label={'Sélectionner '+r.entry_number} checked={!!chosen[r.line_id]} disabled={saving||changed||(!chosen[r.line_id]&&selected.length>=100)} onChange={()=>toggle(r)}/>}</td>}
     <td><button type="button" className="font-medium underline-offset-2 hover:underline text-left break-words" onClick={()=>onView(r)}>{r.entry_number}</button><span className="block text-[11px] text-neutral-500">{formatDate(r.entry_date)} · {r.journal_type}</span><span className="block text-[11px] break-words">{r.label||r.description}</span><span className="block sm:hidden text-[11px] text-neutral-500">Solde : {balance(r.running_balance)}</span></td>
     <td className="text-right">{Number(r.debit)?Number(r.debit).toLocaleString('fr-FR'):'—'}</td><td className="text-right">{Number(r.credit)?Number(r.credit).toLocaleString('fr-FR'):'—'}</td><td className="text-right hidden sm:table-cell">{balance(r.running_balance)}</td>
     <td className="text-center">{r.match_group_id?<div><strong>{r.match_code??'—'}</strong>{canMatch&&<button className="block text-[10px] underline" type="button" disabled={saving||changed} onClick={()=>setRelease({group:r.match_group_id!,code:r.match_code??'—',reason:''})}>Délettrer</button>}</div>:'—'}</td></tr>)}
    </tbody></table></AccountingTable>
   <nav aria-label="Pages du compte" className="acc-pagination"><button type="button" className="btn btn-secondary" disabled={saving||suggestionBusy||changed||request.offset===0} onClick={()=>setRequest(p=>p&&({...p,offset:p.offset-50}))}>Précédente</button><span className="text-xs text-neutral-500">{result.row_count} mouvements · Page {request.offset/50+1}/{Math.max(1,Math.ceil(result.row_count/50))}</span><button type="button" className="btn btn-secondary" disabled={saving||suggestionBusy||changed||request.offset+50>=result.row_count} onClick={()=>setRequest(p=>p&&({...p,offset:p.offset+50}))}>Suivante</button></nav>
  </div>}
 </section>;
}
