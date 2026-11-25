import {useEffect,useState} from 'react';
import {supabase} from '../lib/supabase';
import {buildFinancialStatements,balanceLabels,incomeLabels,type FinancialStatements,type FinancialSnapshot} from '../lib/accountingFinancialStatements.mjs';
type Preview={closed:boolean;snapshot:FinancialSnapshot&{entries:number;opening_debit:number;opening_credit:number;year:number;closed_months:number}};
type CashReport={opening:number;closing:number;variation:number;operating:number;investment:number;financing:number;unknown:number;unknown_count:number;prior_missing:boolean;unknown_rows:{id:string;entry_date:string;entry_number:string;description:string;amount:number}[]};
type Period={report:FinancialStatements;cashReport:CashReport|null;cashError:string;closed:boolean;available:boolean;year:number;closedMonths:number};
const money=(n:number|null)=>n===null?'—':new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(n)+' FCFA';
const dateYear=()=>new Date().getUTCFullYear();
const active=['immobilisations','stocks','clients','otherReceivables','cash'];
const passive=['equity','result','financialDebt','suppliers','otherDebt','cashDebt'];
const incomeOrder=Object.keys(incomeLabels);
const cashLabels={opening:'Trésorerie nette d’ouverture indicative',operating:'Flux opérationnels proposés',investment:'Flux d’investissement proposés',financing:'Flux de financement proposés',unknown:'Flux à classer',variation:'Variation nette constatée',closing:'Trésorerie nette de clôture indicative'};
type Tab='balance'|'income'|'cash'|'notes';
type DisplayRow={label:string;key:string;n:number|null;p:number|null;total?:boolean};
const errorText=(e:unknown)=>e&&typeof e==='object'&&'message' in e?String(e.message):'Impossible de charger les états.';
const clean=(v:string)=>/^[\s\u0000-\u001f]*[=+@-]/.test(v)?"'"+v:v;

export function AccountingFinancialReports({tenantId,tenantName}:{tenantId:string;tenantName:string}){
 const [year,setYear]=useState(String(dateYear()));const [query,setQuery]=useState({year:dateYear(),revision:0});
 const [current,setCurrent]=useState<Period|null>(null);const [previous,setPrevious]=useState<Period|null>(null);
 const [tab,setTab]=useState<Tab>('balance');const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [priorError,setPriorError]=useState('');const [exportError,setExportError]=useState('');const [exporting,setExporting]=useState(false);
 const valid=/^\d{4}$/.test(year)&&Number(year)>=2001&&Number(year)<=Math.min(2099,dateYear());
 useEffect(()=>{let live=true;setLoading(true);setCurrent(null);setPrevious(null);setError('');setPriorError('');
 const load=async(y:number):Promise<Period>=>{const {data,error:err}=await supabase.rpc('preview_fiscal_year',{p_tenant_id:tenantId,p_year:y});if(err)throw err;const p=data as Preview;
 const report=buildFinancialStatements(p.snapshot);const flow=await supabase.rpc('accounting_cash_flow_working',{p_tenant_id:tenantId,p_year:y});const cashReport=flow.error?null:flow.data as CashReport;
 if(cashReport&&(Number(cashReport.variation)!==report.cash.variation||Number(cashReport.closing)!==report.cash.closing||Number(cashReport.opening)!==report.cash.opening))report.issues.push('Les données de trésorerie diffèrent de la balance source : vérifiez l’ouverture et les écritures.');
 return {report,cashReport,cashError:flow.error?.message??'',closed:p.closed,available:p.closed||p.snapshot.entries>0||p.snapshot.opening_debit>0||p.snapshot.opening_credit>0,year:y,closedMonths:p.snapshot.closed_months};};
 void(async()=>{try{const n=await load(query.year);if(!live)return;setCurrent(n);try{const p=await load(query.year-1);if(live)setPrevious(p);}catch(e){if(live)setPriorError(errorText(e));}}catch(e){if(live)setError(errorText(e));}finally{if(live)setLoading(false);}})();
 return()=>{live=false;};},[tenantId,query]);
 const n=current?.report;const p=previous?.available?previous.report:null;
 const mapRows=(keys:string[],labels:Record<string,string>,get:(r:FinancialStatements,k:string)=>number):DisplayRow[]=>keys.map(key=>({key,label:labels[key],n:n?get(n,key):null,p:p?get(p,key):null,total:/^X[A-I]$/.test(key)}));
 const assets=mapRows(active,balanceLabels,(r,k)=>r.balance[k]);const liabilities=mapRows(passive,balanceLabels,(r,k)=>r.balance[k]);
 const totalAssets:DisplayRow={key:'totalA',label:'Total actif',n:n?.totalAssets??null,p:p?.totalAssets??null,total:true};
 const totalLiabilities:DisplayRow={key:'totalP',label:'Total passif',n:n?.totalLiabilities??null,p:p?.totalLiabilities??null,total:true};
 const income=mapRows(incomeOrder,incomeLabels,(r,k)=>r.income[k]);
 const cash:DisplayRow[]=Object.entries(cashLabels).map(([key,label])=>({key,label,n:current?.cashReport?Number(current.cashReport[key as keyof CashReport]):null,p:previous?.available&&previous.cashReport?Number(previous.cashReport[key as keyof CashReport]):null,total:key==='variation'||key==='closing'}));
 const table=(rows:DisplayRow[])=><div className="divide-y divide-neutral-200"><div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 py-2 text-xs text-neutral-500"><span>Rubrique</span><span className="text-right">{query.year}</span><span className="text-right">{query.year-1}</span></div>{rows.map(r=><div key={r.key} className={'grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 py-2 text-xs '+(r.total?'font-semibold bg-neutral-50':'')}><span className="break-words">{r.key.startsWith('X')?r.key+' · ':''}{r.label}</span><span className="text-right tabular-nums break-words">{money(r.n)}</span><span className="text-right tabular-nums break-words">{money(r.p)}</span></div>)}</div>;
 const excel=async()=>{if(!current||!n||exporting)return;setExporting(true);setExportError('');try{
 const XLSX=await import('xlsx');const wb=XLSX.utils.book_new();
 const add=(name:string,rows:DisplayRow[])=>{const ws=XLSX.utils.aoa_to_sheet([[clean(tenantName),'État de travail — non certifié'],['Rubrique',query.year,query.year-1],...rows.map(r=>[r.label,r.n,r.p])]);ws['!cols']=[{wch:44},{wch:18},{wch:18}];XLSX.utils.book_append_sheet(wb,ws,name);};
 add('Bilan',[...assets,totalAssets,...liabilities,totalLiabilities]);add('Compte de résultat',income);add('Variation de trésorerie',cash);
 const detail=XLSX.utils.aoa_to_sheet([['Compte','Intitulé','Classement','Solde initial','Débit','Crédit','Solde final'],...n.accounts.map(a=>[clean(a.code),clean(a.name),a.section??'À classer',a.opening,a.debit,a.credit,a.balance])]);XLSX.utils.book_append_sheet(wb,detail,'Comptes N');
 if(p){const prior=XLSX.utils.aoa_to_sheet([['Compte','Intitulé','Classement','Solde initial','Débit','Crédit','Solde final'],...p.accounts.map(a=>[clean(a.code),clean(a.name),a.section??'À classer',a.opening,a.debit,a.credit,a.balance])]);XLSX.utils.book_append_sheet(wb,prior,'Comptes N-1');}
 const warnings=XLSX.utils.aoa_to_sheet([['Contrôles et limites'],['Document de travail : ne constitue pas la liasse fiscale.'],['Tableau réglementaire des flux et notes annexes non finalisés.'],...(current.cashError?[[current.cashError]]:[]),...(current.cashReport?.unknown_rows??[]).map(x=>['Flux à classer',clean(x.entry_number),clean(x.description),Number(x.amount)]),...n.issues.map(x=>[x]),...(p?.issues??[]).map(x=>['N-1 : '+x]),...n.unknown.map(x=>[clean(x.code),clean(x.name),x.amount])]);XLSX.utils.book_append_sheet(wb,warnings,'Contrôles');XLSX.writeFile(wb,'Etats-travail-'+query.year+'.xlsx');
 }catch(e){setExportError(errorText(e));}finally{setExporting(false);}};
 const print=()=>{if(!current)return;window.print();};
 return <section className="min-w-0 space-y-4">
 <form className="card p-3 flex flex-wrap items-end gap-2 print:hidden" onSubmit={e=>{e.preventDefault();if(valid)setQuery(q=>({year:Number(year),revision:q.revision+1}));}}>
 <label className="text-xs font-medium flex-1">Exercice<input className="input mt-1 w-full" value={year} maxLength={4} inputMode="numeric" onChange={e=>setYear(e.target.value)}/></label><button className="btn btn-primary" disabled={!valid||loading}>Actualiser</button></form>
 {Number(year)!==query.year&&<p className="text-xs text-neutral-600 print:hidden">Actualisez pour appliquer le nouvel exercice.</p>}
 {loading&&<p role="status" className="py-6 text-sm text-neutral-500">Calcul des états financiers…</p>}{error&&<p role="alert" className="text-sm text-red-700 break-words">{error}</p>}
 {priorError&&<p role="alert" className="text-xs text-amber-800">Comparatif indisponible : {priorError}</p>}
 {current&&n&&<div className="space-y-4">
 <div className="card p-4 space-y-2"><h2 className="text-sm font-semibold">{tenantName} — États financiers {query.year}</h2><p className="text-xs text-neutral-600">États de travail selon le cadre SYSCOHADA · {current.closed?'Arrêté comptable enregistré':'Exercice non clôturé'} · {current.closedMonths}/12 mois clôturés.</p><p className="text-xs font-medium">Non certifiés : travaux d’inventaire, correspondances détaillées et annexes à valider.</p>{!current.available&&<p className="text-xs">Aucune donnée comptable pour l’exercice.</p>}{!previous?.available&&<p className="text-xs">N-1 non disponible : les cellules sont laissées vides.</p>}{previous?.available&&!previous.closed&&<p className="text-xs">N-1 : exercice non clôturé.</p>}<div className="flex flex-wrap gap-2 print:hidden"><button type="button" className="btn btn-secondary" disabled={exporting} onClick={()=>void excel()}>{exporting?'Export…':'Exporter Excel'}</button><button type="button" className="btn btn-secondary" onClick={print}>Imprimer / PDF</button></div>{exportError&&<p role="alert" className="text-xs text-red-700">{exportError}</p>}</div>
 {(n.issues.length>0||(p?.issues.length??0)>0)&&<div className="card p-3 space-y-1"><h3 className="text-sm font-semibold">Contrôles à traiter</h3>{n.issues.map(x=><p key={x} className="text-xs text-red-700">{x}</p>)}{p?.issues.map(x=><p key={x} className="text-xs text-amber-800">N-1 : {x}</p>)}</div>}
 <nav className="flex flex-wrap gap-2 print:hidden" aria-label="États financiers">{([['balance','Bilan'],['income','Compte de résultat'],['cash','Trésorerie'],['notes','Contrôles et annexes']] as const).map(([k,label])=><button key={k} className={'btn '+(tab===k?'btn-primary':'btn-secondary')} type="button" onClick={()=>setTab(k)}>{label}</button>)}</nav>
 {tab==='balance'&&<div className="grid gap-3 xl:grid-cols-2"><div className="card p-3 min-w-0"><h3 className="text-sm font-semibold">Actif</h3>{table([...assets,totalAssets])}</div><div className="card p-3 min-w-0"><h3 className="text-sm font-semibold">Passif</h3>{table([...liabilities,totalLiabilities])}</div></div>}
 {tab==='income'&&<div className="card p-3 min-w-0"><h3 className="text-sm font-semibold">Compte de résultat et SIG</h3>{table(income)}<p className="pt-2 text-xs text-neutral-600">Résultat source : {money(n.result)}.</p></div>}
 {tab==='cash'&&<div className="card p-3 space-y-2"><h3 className="text-sm font-semibold">Analyse directe des flux — état préparatoire</h3>{current.cashError&&<p role="alert" className="text-xs text-red-700">{current.cashError}</p>}{table(cash)}<p className="text-xs text-neutral-600">Ventilation proposée à partir des contreparties comptables. Une écriture mixte ou ambiguë reste à classer. Ce n’est pas le tableau réglementaire SYSCOHADA par méthode indirecte.</p>{current.cashReport&&<><p className="text-xs font-medium">{current.cashReport.unknown_count} écriture(s) à classer · 100 premières affichées.</p>{current.cashReport.unknown_rows.map(x=><div key={x.id} className="border-t py-2 flex flex-wrap justify-between gap-2 text-xs"><span>{x.entry_number} — {x.description}</span><strong>{money(Number(x.amount))}</strong></div>)}</>}</div>}
 {tab==='notes'&&<div className="card p-3 space-y-2"><h3 className="text-sm font-semibold">Comptes à classer et données annexes</h3><p className="text-xs text-neutral-600">Liste de contrôle, pas les notes annexes réglementaires. Les correspondances doivent être vérifiées selon le plan de comptes détaillé de l’entreprise.</p>{!n.unknown.length&&<p className="text-xs">Aucun compte non classé par le moteur de travail.</p>}{n.unknown.map(a=><div key={a.code} className="border-t py-2 text-xs">{a.code} — {a.name} · {money(a.amount)}</div>)}<h4 className="text-sm font-semibold">Détail des comptes</h4><div className="divide-y divide-neutral-200">{n.accounts.map(a=><div key={a.code} className="py-2 flex flex-wrap justify-between gap-2 text-xs"><span>{a.code} — {a.name}</span><strong>{money(a.balance)}</strong></div>)}</div></div>}
 </div>}
 </section>;
}
