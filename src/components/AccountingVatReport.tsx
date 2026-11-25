import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatDate } from '../lib/format';

type TaxLine={id:string;entry_date:string;entry_number:string;journal_type:string;reference:string;description:string;source_type:string;account_code:string;account_name:string;debit:number;credit:number;category:string;nature:string};
type Report={output_account:string;input_account:string;output_sales:number;input_purchases:number;net_trade:number;output_adjustments:number;input_adjustments:number;net_movements:number;other_count:number;row_count:number;pending_sales:number;pending_sales_vat:number;pending_returns:number;pending_returns_vat:number;pending_purchases:number;rows:TaxLine[]};
const money=(v:number)=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(Number(v))+' FCFA';
const category=(v:string)=>v==='output'?'TVA collectée':v==='input'?'TVA récupérable':'Autre compte de TVA';
const nature=(v:string)=>v==='sales'?'Ventes et avoirs':v==='purchases'?'Achats':'Autres mouvements';
const csv=(v:unknown)=>{let s=String(v??'');if(/^[\s\u0000-\u001f]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
const initialDates=()=>{const t=new Date().toISOString().slice(0,10);return {from:t.slice(0,7)+'-01',to:t};};
export function AccountingVatReport({tenantId}:{tenantId:string}) {
 const [dates,setDates]=useState(initialDates);
 const [query,setQuery]=useState(()=>({...initialDates(),offset:0,revision:0}));
 const [report,setReport]=useState<Report|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 useEffect(()=>{
  let active=true;setLoading(true);setReport(null);setError('');
  void (async()=>{try{
   const {data,error:err}=await supabase.rpc('accounting_vat_report',{p_tenant_id:tenantId,p_date_from:query.from,p_date_to:query.to,p_offset:query.offset});
   if(err)throw err;
   if(active)setReport(data as Report);
  }catch(e){if(active)setError(e&&typeof e==='object'&&'message' in e?String(e.message):'Impossible de charger la situation de TVA.');}
  finally{if(active)setLoading(false);}})();
  return()=>{active=false;};
 },[tenantId,query]);
 const changed=dates.from!==query.from||dates.to!==query.to;
 const valid=!!dates.from&&!!dates.to&&dates.from<=dates.to&&(Date.parse(dates.to)-Date.parse(dates.from))/86400000<=366;
 const exportPage=()=>{
  if(!report)return;
  const header=['Date','Pièce','Journal','Référence','Libellé','Compte','Intitulé','Type','Nature','Débit FCFA','Crédit FCFA'];
  const rows=report.rows.map(r=>[r.entry_date,r.entry_number,r.journal_type,r.reference,r.description,r.account_code,r.account_name,category(r.category),nature(r.nature),r.debit,r.credit]);
  const blob=new Blob(['\uFEFF'+[header,...rows].map(r=>r.map(csv).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='TVA-'+query.from+'-'+query.to+'-page-'+(query.offset/50+1)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 return <section className="space-y-4 min-w-0">
  <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end print:hidden" onSubmit={e=>{e.preventDefault();if(valid)setQuery({...dates,offset:0,revision:query.revision+1});}}>
   <label className="min-w-0 text-xs font-medium">Du<input className="input mt-1 w-full" type="date" required value={dates.from} onChange={e=>setDates(p=>({...p,from:e.target.value}))}/></label>
   <label className="min-w-0 text-xs font-medium">Au<input className="input mt-1 w-full" type="date" required value={dates.to} onChange={e=>setDates(p=>({...p,to:e.target.value}))}/></label>
   <button className="btn btn-primary" type="submit" disabled={!valid||loading}>Actualiser</button>
  </form>
  {!valid&&<p className="text-xs text-red-700">Sélectionnez une période valide de 367 jours maximum.</p>}
  {changed&&<p className="text-xs text-neutral-600">Actualisez pour appliquer la nouvelle période.</p>}
  {loading&&<p role="status" className="py-8 text-center text-sm text-neutral-500">Chargement de la situation de TVA…</p>}
  {error&&<p role="alert" className="text-sm text-red-700 break-words">{error}</p>}
  {report&&<div className="space-y-4">
   <p className="text-xs text-neutral-600">Situation du {formatDate(query.from)} au {formatDate(query.to)} · Écritures validées uniquement.</p>
   <div className="grid gap-3 sm:grid-cols-3">
    {[['TVA collectée nette (ventes et avoirs)',report.output_sales],['TVA récupérable sur achats',report.input_purchases],['Différence sur opérations commerciales',report.net_trade]].map(([label,amount])=><div key={String(label)} className="card p-4 min-w-0"><p className="text-xs text-neutral-600">{label}</p><p className="mt-2 text-lg font-bold tabular-nums break-words">{money(Number(amount))}</p></div>)}
   </div>
   <div className="card p-4 space-y-2"><h2 className="text-sm font-semibold">Autres mouvements comptables</h2>
    <div className="flex flex-wrap justify-between gap-2 text-sm"><span>TVA collectée · autres mouvements</span><strong className="tabular-nums">{money(report.output_adjustments)}</strong></div>
    <div className="flex flex-wrap justify-between gap-2 text-sm"><span>TVA récupérable · autres mouvements</span><strong className="tabular-nums">{money(report.input_adjustments)}</strong></div>
    <div className="border-t border-neutral-200 pt-2 flex flex-wrap justify-between gap-2 text-sm"><span>Solde des mouvements des deux comptes affectés</span><strong className="tabular-nums">{money(report.net_movements)}</strong></div>
    <p className="text-xs text-neutral-500">Comptes : {report.output_account} et {report.input_account}. Ce solde de période ne constitue pas une déclaration de TVA ni un montant définitif à payer : reports antérieurs et traitements fiscaux restent à vérifier.</p>
   </div>
   <div className="card p-4 space-y-2"><h2 className="text-sm font-semibold">Contrôles avant déclaration</h2>
    <div className="grid gap-2 sm:grid-cols-2 text-sm">
     <div>Ventes avec TVA non comptabilisées : <strong>{report.pending_sales}</strong><p className="text-xs text-neutral-600">{money(report.pending_sales_vat)} de TVA</p></div>
     <div>Avoirs avec TVA non comptabilisés : <strong>{report.pending_returns}</strong><p className="text-xs text-neutral-600">{money(report.pending_returns_vat)} de TVA</p></div>
     <div>Commandes reçues non comptabilisées : <strong>{report.pending_purchases}</strong></div>
     <div>Lignes sur autres comptes 443 / 445 : <strong>{report.other_count}</strong></div>
    </div>
    {(report.pending_sales>0||report.pending_returns>0||report.pending_purchases>0||report.other_count>0)&&<p role="status" className="text-xs text-amber-800">Des opérations ou comptes supplémentaires nécessitent une vérification avant déclaration.</p>}
    <p className="text-xs text-neutral-500">Les achats historiques sans détail fiscal ne permettent pas de reconstituer automatiquement la TVA récupérable.</p>
   </div>
   <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Détail des écritures de TVA ({report.row_count})</h2><button type="button" className="btn btn-secondary print:hidden" disabled={!report.rows.length} onClick={exportPage}>Exporter cette page (CSV)</button></div>
   {report.rows.length===0?<p className="text-sm text-neutral-500">Aucun mouvement de TVA sur cette page.</p>:<ul className="divide-y divide-neutral-200 border-y border-neutral-200">
    {report.rows.map(r=><li key={r.id} className="py-3 grid gap-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
     <div className="min-w-0"><p className="text-sm font-medium break-words">{r.entry_number} · {formatDate(r.entry_date)}</p><p className="text-xs text-neutral-600 break-words">{r.reference||r.description}</p></div>
     <div className="min-w-0"><p className="text-sm break-words">{r.account_code} · {category(r.category)}</p><p className="text-xs text-neutral-500 break-words">{nature(r.nature)}</p></div>
     <div className="grid grid-cols-2 gap-2 sm:text-right"><div><p className="text-xs text-neutral-500">Débit</p><p className="text-sm font-medium tabular-nums break-words">{money(r.debit)}</p></div><div><p className="text-xs text-neutral-500">Crédit</p><p className="text-sm font-medium tabular-nums break-words">{money(r.credit)}</p></div></div>
    </li>)}
   </ul>}
   <nav className="flex flex-wrap items-center justify-between gap-2 print:hidden" aria-label="Pages des écritures de TVA"><button type="button" className="btn btn-secondary" disabled={query.offset===0||changed} onClick={()=>setQuery(p=>({...p,offset:Math.max(0,p.offset-50)}))}>Précédente</button><span className="text-xs text-neutral-500">Page {query.offset/50+1} / {Math.max(1,Math.ceil(report.row_count/50))}</span><button type="button" className="btn btn-secondary" disabled={query.offset+50>=report.row_count||changed} onClick={()=>setQuery(p=>({...p,offset:p.offset+50}))}>Suivante</button></nav>
  </div>}
 </section>;
}
