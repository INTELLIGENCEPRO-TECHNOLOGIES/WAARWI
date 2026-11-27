import {useAccountingWindowId,mayCloseAccountingWindow} from '../context/AccountingWindowContext';
import { useEffect,useRef,useState } from 'react';
import {supabase} from '../lib/supabase';
import {formatDate} from '../lib/format';
import {AccountingTable,AccountingPagination,useAccountingPagination} from './AccountingWorkspace';
import {Download,Lock,Check,Search} from './Icons';

type Account={code:string;name:string;class:number;is_active:boolean};
type Row={account_code:string;account_name:string;account_class:number;opening:number;debit:number;credit:number;balance:number};
type Carry={account_code:string;account_name:string;account_class:number;balance:number};
type Snapshot={year:number;date_from:string;date_to:string;closed_months:number;months:{month:string;closed:boolean;closed_at:string|null}[];entries:number;prior_missing:boolean;inconsistent_entries:number;duplicate_sources:number;unposted_entries:number;unsupported_accounts:number;inconsistent_accounts:number;result_account_valid:boolean;profit_code:string;loss_code:string;result_account:string|null;result:number;movement_debit:number;movement_credit:number;opening_debit:number;opening_credit:number;carry_debit:number;carry_credit:number;rows:Row[];carry:Carry[];blocked:boolean};
type Preview={closed:boolean;closed_at?:string;note?:string;snapshot:Snapshot;review_token?:string};
const nowYear=()=>new Date().getUTCFullYear();
const money=(v:number)=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(Number(v))+' FCFA';
const errorText=(e:unknown)=>e&&typeof e==='object'&&'message' in e?String(e.message):'Opération impossible.';
const csv=(v:unknown)=>{if(typeof v==='number'&&Number.isFinite(v))return String(v).replace('.',',');let s=String(v??'');if(/^[\s\u0000-\u001f]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};

export function AccountingFiscalYear({tenantId,canManage}:{tenantId:string;canManage:boolean}){
 const [year,setYear]=useState(String(nowYear()));
 const [profit,setProfit]=useState('1310000');
 const [loss,setLoss]=useState('1390000');
 const [accounts,setAccounts]=useState<Account[]>([]);
 const [query,setQuery]=useState({year:nowYear(),profit:'1310000',loss:'1390000',rev:0});
 const [preview,setPreview]=useState<Preview|null>(null);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [note,setNote]=useState('');
 const [confirm,setConfirm]=useState(false);
 const [tab,setTab]=useState<'carry'|'balance'>('carry');
 const [search,setSearch]=useState('');
 const lock=useRef(false);
 const windowId=useAccountingWindowId();
 useEffect(()=>{const guard=(event:Event)=>{if(!mayCloseAccountingWindow(event,windowId)||event.defaultPrevented)return;if(lock.current||(!!note.trim()||confirm)&&!window.confirm("Une clôture est en préparation. Quitter cet écran ?"))event.preventDefault();};window.addEventListener('waarwi:accounting-before-navigate',guard);return()=>window.removeEventListener('waarwi:accounting-before-navigate',guard);},[note,confirm,windowId]);
 useEffect(()=>{let live=true;void(async()=>{const {data,error:err}=await supabase.from('accounts').select('code,name,class,is_active').eq('tenant_id',tenantId).eq('class',1).or('code.like.131%,code.like.139%').order('code');if(live){if(err)setError(errorText(err));else setAccounts((data??[]) as Account[]);}})();return()=>{live=false;};},[tenantId]);
 useEffect(()=>{let live=true;setLoading(true);setPreview(null);setError('');setConfirm(false);
 void(async()=>{try{
 const {data,error:err}=await supabase.rpc('preview_fiscal_year',{p_tenant_id:tenantId,p_year:query.year,p_profit_code:query.profit,p_loss_code:query.loss});
 if(err)throw err;if(live)setPreview(data as Preview);
 }catch(e){if(live)setError(errorText(e));}finally{if(live)setLoading(false);}})();return()=>{live=false;};},[tenantId,query]);
 const valid=/^\d{4}$/.test(year)&&Number(year)>=2000&&Number(year)<=Math.min(2099,nowYear()+1);
 const changed=Number(year)!==query.year||profit!==query.profit||loss!==query.loss;
 const submit=()=>{if(!valid||busy)return;setNote('');setNotice('');setQuery({year:Number(year),profit,loss,rev:query.rev+1});};
 const close=async()=>{
  if(!preview||preview.closed||preview.snapshot.blocked||changed||!confirm||!note.trim()||lock.current||!canManage)return;
  lock.current=true;setBusy(true);setError('');
  try{
   const {data,error:err}=await supabase.rpc('close_fiscal_year',{p_tenant_id:tenantId,p_year:query.year,p_profit_code:query.profit,p_loss_code:query.loss,p_review_token:preview.review_token,p_note:note.trim()});
   if(err)throw err;if(!data?.success)throw Error('Clôture non confirmée.');
   setConfirm(false);setNote('');setNotice('Exercice clôturé. Les reports d’ouverture sont conservés.');setQuery(p=>({...p,rev:p.rev+1}));
  }catch(e){setError(errorText(e));setConfirm(false);}finally{lock.current=false;setBusy(false);}
 };
 const exportCsv=()=>{
  if(!preview)return;const s=preview.snapshot;
  const header=tab==='carry'?['Compte','Intitulé','Classe','Débit ouverture','Crédit ouverture']:['Compte','Intitulé','Classe','Solde initial signé','Débit période','Crédit période','Solde final signé'];
  const values=tab==='carry'?s.carry.map(r=>[r.account_code,r.account_name,r.account_class,Math.max(0,Number(r.balance)),Math.max(0,-Number(r.balance))]):s.rows.map(r=>[r.account_code,r.account_name,r.account_class,Number(r.opening),Number(r.debit),Number(r.credit),Number(r.balance)]);
  const rows:unknown[][]=[[tab==='carry'?'Reports d’ouverture '+(s.year+1):'Balance annuelle '+s.year,preview.closed?'Arrêté validé':'Simulation non validée'],header,...values];
  const blob=new Blob(['\uFEFF'+rows.map(r=>r.map(csv).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=(tab==='carry'?'RAN-':'Balance-')+s.year+(preview.closed?'':'-simulation')+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 const s=preview?.snapshot;
 const filters=(r:Row|Carry)=>(r.account_code+' '+r.account_name).toLocaleLowerCase('fr-FR').includes(search.trim().toLocaleLowerCase('fr-FR'));
 const carryPaging=useAccountingPagination((s?.carry??[]).filter(filters),query.year+'|'+search);
 const balancePaging=useAccountingPagination((s?.rows??[]).filter(filters),query.year+'|'+search);
 const issues=s?[s.prior_missing?'L’exercice précédent doit être clôturé avant celui-ci.':'',s.closed_months!==12?'Les 12 mois doivent être clôturés.':'',s.inconsistent_entries?s.inconsistent_entries+' écriture(s) incohérente(s).':'',s.duplicate_sources?s.duplicate_sources+' source(s) dupliquée(s).':'',s.unposted_entries?s.unposted_entries+' écriture(s) en attente.':'',s.unsupported_accounts||s.inconsistent_accounts?'Des comptes sont absents, reclassés ou hors classes 1 à 8.':'',!s.result_account_valid?'Compte de résultat absent ou inactif.':'',Number(s.carry_debit)!==Number(s.carry_credit)?'Reports d’ouverture déséquilibrés.':'',Number(s.opening_debit)!==Number(s.opening_credit)||Number(s.movement_debit)!==Number(s.movement_credit)?'Balance ou mouvements déséquilibrés.':'',s.date_to>=new Date().toISOString().slice(0,10)?'L’exercice doit être terminé avant sa clôture.':''].filter(Boolean):[];
 return <section className="acc-fill space-y-4 min-w-0">
  <form className="acc-toolbar acc-fixed acc-form-grid" onSubmit={e=>{e.preventDefault();submit();}}>
   <label className="text-xs font-medium min-w-0">Exercice civil<input className="input mt-1 w-full" inputMode="numeric" maxLength={4} required value={year} disabled={busy} onChange={e=>setYear(e.target.value)}/></label>
   <label className="text-xs font-medium min-w-0">Compte de bénéfice<select className="input mt-1 w-full" value={profit} disabled={busy} onChange={e=>setProfit(e.target.value)}>{!accounts.some(a=>a.code===profit)&&<option value={profit}>{profit}</option>}{accounts.filter(a=>a.code.startsWith('131')&&a.is_active).map(a=><option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}</select></label>
   <label className="text-xs font-medium min-w-0">Compte de perte<select className="input mt-1 w-full" value={loss} disabled={busy} onChange={e=>setLoss(e.target.value)}>{!accounts.some(a=>a.code===loss)&&<option value={loss}>{loss}</option>}{accounts.filter(a=>a.code.startsWith('139')&&a.is_active).map(a=><option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}</select></label>
   <button className="btn btn-primary" type="submit" disabled={!valid||loading||busy}><Search size={16}/>Contrôler l’exercice</button>
  </form>
  {changed&&<p className="text-xs text-neutral-600">Actualisez pour appliquer les nouveaux critères.</p>}
  {loading&&<p role="status" className="py-5 text-sm text-neutral-500">Calcul de la situation annuelle…</p>}
  {error&&<p role="alert" className="text-sm text-red-700 break-words">{error}</p>}
  {notice&&<p role="status" className="text-sm text-neutral-700">{notice}</p>}
  {preview&&s&&<div className="acc-fill space-y-4">
   <div className="acc-section-head space-y-1"><div className="flex flex-wrap justify-between items-center gap-2"><h2 className="text-sm font-semibold">Exercice {s.year}</h2><span className="acc-status">{preview.closed&&<Lock size={14}/>} {preview.closed?'Clôturé':'Simulation │ exercice ouvert'}</span></div><p className="text-xs text-neutral-500">{formatDate(s.date_from)} au {formatDate(s.date_to)} │ {s.entries} écritures validées</p><p className="text-xs text-neutral-600">Le résultat provient des écritures comptabilisées ; il ne remplace pas les travaux d’inventaire et la validation des états financiers.</p>{preview.closed&&<p className="text-xs break-words">Clôturé le {formatDate(preview.closed_at??'')} │ {preview.note}</p>}</div>
   <div className="acc-summary">{[['Résultat comptable',money(s.result)],['Mois clôturés',s.closed_months+'/12'],['Total débit exercice',money(s.movement_debit)],['Total crédit exercice',money(s.movement_credit)]].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
   <div className="acc-section-head space-y-2"><h3 className="text-sm font-semibold">Contrôle des périodes</h3><div className="acc-months">{s.months.map(m=><div key={m.month}><span className="capitalize">{new Intl.DateTimeFormat('fr-FR',{month:'short',timeZone:'UTC'}).format(new Date(m.month+'T00:00:00Z'))}</span><span className={'acc-status '+(m.closed?'valid':'draft')}>{m.closed?<Check size={14}/>:null}{m.closed?'Clôturé':'Ouvert'}</span></div>)}</div>
   {!preview.closed&&issues.length>0&&<div className="border-t border-neutral-200 pt-2"><p className="text-xs font-semibold">Contrôles bloquants</p><ul className="list-disc pl-4 text-xs text-red-700 space-y-1">{issues.map(i=><li key={i}>{i}</li>)}</ul></div>}
   </div>
   <div className="acc-fill acc-section-head space-y-3"><div className="flex flex-wrap gap-2 justify-between items-center"><div className="acc-tabs"><button aria-pressed={tab==='carry'} className="acc-tab" type="button" onClick={()=>setTab('carry')}>Reports à nouveau</button><button aria-pressed={tab==='balance'} className="acc-tab" type="button" onClick={()=>setTab('balance')}>Balance annuelle</button></div><button type="button" className="btn btn-secondary" onClick={exportCsv}><Download size={16}/>Exporter CSV</button></div>
   <p className="text-xs text-neutral-600">{tab==='carry'?'Ouverture '+(s.year+1)+' │ comptes de bilan uniquement. Le résultat est repris sur '+(s.result_account??'aucun compte (résultat nul)')+'. Pas de double mouvement dans les journaux.':'Solde initial, mouvements et solde final par compte. D positif, C négatif.'}</p>
   {tab==='carry'&&<div className="acc-fields acc-fields-2"><p className="text-sm">Débit : <strong>{money(s.carry_debit)}</strong></p><p className="text-sm">Crédit : <strong>{money(s.carry_credit)}</strong></p></div>}
   <input className="input w-full" placeholder="Rechercher un compte" value={search} onChange={e=>setSearch(e.target.value)}/>
   {tab==='carry'?<AccountingTable fill footer={<AccountingPagination {...carryPaging}/>}><table><thead><tr><th className="text-left">Compte / intitulé</th><th className="text-right">Débit ouverture</th><th className="text-right">Crédit ouverture</th></tr></thead><tbody>{carryPaging.rows.map(r=><tr key={r.account_code}><td><strong>{r.account_code}</strong><span className="block text-[11px] text-neutral-500">{r.account_name}</span></td><td className="text-right">{Number(r.balance)>0?Number(r.balance).toLocaleString('fr-FR'):'—'}</td><td className="text-right">{Number(r.balance)<0?Math.abs(Number(r.balance)).toLocaleString('fr-FR'):'—'}</td></tr>)}{!carryPaging.total&&<tr><td colSpan={3}>Aucun compte.</td></tr>}</tbody></table></AccountingTable>:<AccountingTable fill footer={<AccountingPagination {...balancePaging}/>}><table><thead><tr><th className="text-left">Compte / intitulé</th><th className="text-right hidden sm:table-cell">Initial</th><th className="text-right">Débit</th><th className="text-right">Crédit</th><th className="text-right">Final</th></tr></thead><tbody>{balancePaging.rows.map(r=><tr key={r.account_code}><td><strong>{r.account_code}</strong><span className="block text-[11px] text-neutral-500">{r.account_name}</span><span className="block sm:hidden text-[11px]">Initial : {money(r.opening)}</span></td><td className="text-right hidden sm:table-cell">{Number(r.opening).toLocaleString('fr-FR')}</td><td className="text-right">{Number(r.debit).toLocaleString('fr-FR')}</td><td className="text-right">{Number(r.credit).toLocaleString('fr-FR')}</td><td className="text-right">{Number(r.balance).toLocaleString('fr-FR')}</td></tr>)}{!balancePaging.total&&<tr><td colSpan={5}>Aucun compte.</td></tr>}</tbody></table></AccountingTable>}
   </div>
   {!preview.closed&&canManage&&<div className="acc-section-head space-y-3"><h3 className="text-sm font-semibold">Clôture définitive</h3><p className="text-xs text-neutral-600">La clôture fige l’arrêté et les reports d’ouverture. Vérifiez les observations mensuelles, l’inventaire, les régularisations et les comptes de résultat avant validation.</p><label className="block text-xs font-medium">Note de clôture obligatoire<textarea className="input mt-1 w-full" maxLength={500} value={note} disabled={busy||s.blocked||changed} onChange={e=>{setNote(e.target.value);setConfirm(false);}}/></label><label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={confirm} disabled={busy||s.blocked||changed||!note.trim()} onChange={e=>setConfirm(e.target.checked)}/> Je confirme les contrôles et la clôture irréversible de l’exercice.</label><button type="button" className="btn btn-primary" disabled={busy||s.blocked||changed||!confirm||!note.trim()} onClick={()=>void close()}>{busy?'Clôture…':'Clôturer l’exercice'}</button></div>}
  </div>}
 </section>;
}
