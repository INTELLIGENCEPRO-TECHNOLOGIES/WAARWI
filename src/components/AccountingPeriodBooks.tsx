import {useEffect,useState} from 'react';
import {useApp} from '../context/AppContext';
import {useAccountingWork} from '../context/AccountingWindowContext';
import {supabase} from '../lib/supabase';
import {useRealtimeTick} from '../lib/useRealtimeData';
import {AccountingTable,AccountingPagination} from './AccountingWorkspace';
import {Search,Download,RefreshCw} from './Icons';
type Balance={account_code:string;account_name:string;account_class:number;opening:number;debit:number;credit:number;closing:number;movement_count:number};
type Ledger={account_code:string;account_name:string;entry_date:string;entry_number:string|null;entry_id:string|null;line_id:string|null;journal_type:string|null;label:string;reference:string|null;debit:number;credit:number;running_balance:number;account_opening:number;account_debit:number;account_credit:number;account_closing:number};
type Totals={accounts:number;movements:number;opening_debit:number;opening_credit:number;debit:number;credit:number;closing_debit:number;closing_credit:number;unknown_accounts:number};
type Report={opening_mode:'fiscal'|'provisional'|'first';prior_year:number|null;from:string;to:string;count:number;totals:Totals;rows:(Balance|Ledger)[]};
const today=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Dakar'});
const money=(x:number)=>Number(x).toLocaleString('fr-FR',{maximumFractionDigits:2});
const amount=(x:number)=>Number(x)?money(x):'—';
const dc=(x:number)=>Number(x)===0?'0':money(Math.abs(Number(x)))+(Number(x)>0?' D':' C');
const msg=(e:unknown)=>e&&typeof e==='object'&&'message'in e?String(e.message):'Chargement impossible.';
const date=(s:string)=>s.split('-').reverse().join('/');
const clean=(v:unknown)=>typeof v==='string'&&/^[\s\u0000-\u001f]*[=+@-]/.test(v)?"'"+v:v;
export function AccountingPeriodBooks({mode}:{mode:'balance'|'ledger'}){
 const {tenant}=useApp();const work=useAccountingWork();const tick=useRealtimeTick(['journal_entries','journal_lines','accounts','accounting_fiscal_years']);
 const initial={from:today().slice(0,4)+'-01-01',to:today(),search:''};
 const [form,setForm]=useState(initial),[criteria,setCriteria]=useState(initial),[page,setPage]=useState(0),[size,setSize]=useState(20),[rev,setRev]=useState(0);
 const [data,setData]=useState<Report|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[exporting,setExporting]=useState(false);
 const changed=JSON.stringify(form)!==JSON.stringify(criteria);
 const query=async(p:number,n:number)=>{if(!tenant)throw Error('Entreprise indisponible.');const {data:d,error:e}=await supabase.rpc('accounting_period_books',{p_tenant_id:tenant.id,p_from:criteria.from,p_to:criteria.to,p_mode:mode,p_search:criteria.search.trim()||null,p_offset:p,p_size:n});if(e)throw e;return d as Report;};
 useEffect(()=>{let live=true;setLoading(true);setData(null);setError('');void(async()=>{try{const r=await query(page*size,size);if(live){setData(r);const last=Math.max(0,Math.ceil(r.count/size)-1);if(page>last)setPage(last);}}catch(e){if(live)setError(msg(e));}finally{if(live)setLoading(false);}})();return()=>{live=false;};},[tenant?.id,mode,criteria,page,size,rev,tick,work?.revision]);
 const submit=()=>{if(!form.from||!form.to||form.from>form.to||form.to>today()||form.from.slice(0,4)!==form.to.slice(0,4)){setError('Choisissez des dates non futures dans un seul exercice.');return;}setPage(0);setCriteria({...form});setRev(v=>v+1);};
 const exportExcel=async()=>{if(!data||exporting)return;setExporting(true);setError('');try{const count=data.count;if(count>5000)throw Error('Plus de 5 000 lignes : réduisez la période ou filtrez les comptes.');const p=await query(0,5000);if(p.count!==count||JSON.stringify(p.totals)!==JSON.stringify(data.totals)||p.opening_mode!==data.opening_mode)throw Error('Les données ont changé. Actualisez avant export.');const rows=p.rows;if(rows.length!==count||new Set(rows.map(r=>'line_id'in r?r.line_id??'opening:'+r.account_code:r.account_code)).size!==count)throw Error('Export incohérent. Actualisez.');
 const X=await import('xlsx');const wb=X.utils.book_new();const head=mode==='balance'?['Compte','Intitulé','Ouverture D','Ouverture C','Débit période','Crédit période','Clôture D','Clôture C']:['Compte','Intitulé','Date','Pièce','Journal','Libellé','Ouverture signée','Débit','Crédit','Solde cumulé','Total D compte','Total C compte','Clôture signée'];
 const matrix=rows.map(r=>'line_id'in r?[r.account_code,r.account_name,r.entry_date,r.entry_number??'',r.journal_type??'',r.label,Number(r.account_opening),Number(r.debit),Number(r.credit),Number(r.running_balance),Number(r.account_debit),Number(r.account_credit),Number(r.account_closing)]:[r.account_code,r.account_name,Math.max(0,Number(r.opening)),Math.max(0,-Number(r.opening)),Number(r.debit),Number(r.credit),Math.max(0,Number(r.closing)),Math.max(0,-Number(r.closing))]);
 const ws=X.utils.aoa_to_sheet([[tenant?.name??'',mode==='balance'?'Balance générale':'Grand livre'],['Du',criteria.from,'Au',criteria.to],['Ouverture',data.opening_mode==='fiscal'?'Report arrêté':data.opening_mode==='first'?'Premier exercice':'Historique provisoire'],head,...matrix.map(row=>row.map(clean))]);X.utils.book_append_sheet(wb,ws,mode==='balance'?'Balance':'Grand livre');const totals=X.utils.aoa_to_sheet([['Totaux de la sélection (FCFA)'],['Ouverture D','Ouverture C','Débit période','Crédit période','Clôture D','Clôture C'],[data.totals.opening_debit,data.totals.opening_credit,data.totals.debit,data.totals.credit,data.totals.closing_debit,data.totals.closing_credit].map(Number)]);X.utils.book_append_sheet(wb,totals,'Totaux');X.writeFile(wb,mode+'-'+criteria.from+'-'+criteria.to+'.xlsx');
 }catch(e){setError(msg(e));}finally{setExporting(false);}};
 const t=data?.totals;
 const balanceRows = (data?.rows ?? []).filter((row): row is Balance => !('line_id' in row));
 const ledgerRows = (data?.rows ?? []).filter((row): row is Ledger => 'line_id' in row);
 return <section className="acc-fill acc-period-books space-y-2">
 <form className="acc-toolbar acc-fixed" onSubmit={e=>{e.preventDefault();submit();}}><label className="text-xs">Du <input className="input" type="date" value={form.from} onChange={e=>setForm(p=>({...p,from:e.target.value}))}/></label><label className="text-xs">Au <input className="input" type="date" max={today()} value={form.to} onChange={e=>setForm(p=>({...p,to:e.target.value}))}/></label><input className="input flex-1 min-w-0" aria-label="Compte ou intitulé" placeholder="Compte ou intitulé" value={form.search} onChange={e=>setForm(p=>({...p,search:e.target.value}))}/><button className="btn-primary" disabled={loading||exporting}><Search size={15}/>Afficher</button><button type="button" className="btn-secondary" disabled={loading||exporting} onClick={()=>setRev(v=>v+1)}><RefreshCw size={15}/>Actualiser</button><button type="button" className="btn-secondary" disabled={!data||loading||exporting||changed} onClick={()=>void exportExcel()}><Download size={15}/>{exporting?'Export…':'Excel complet'}</button></form>
 {changed&&<p className="text-xs">Appliquez les critères pour actualiser l’état.</p>}
 {error&&<p role="alert" className="text-xs text-red-700">{error}</p>}
 {data&&<p className="text-xs text-neutral-600">{data.opening_mode==='fiscal'?'Report à nouveau arrêté de '+data.prior_year+' puis mouvements antérieurs à la période.':data.opening_mode==='provisional'?'Ouverture provisoire : exercice précédent non clôturé ; reprise continue des écritures depuis le dernier arrêté disponible. Les comptes de gestion peuvent conserver des soldes antérieurs.':'Premier exercice : solde issu des mouvements antérieurs à la période.'} Les reports ne sont pas des pièces supplémentaires.</p>}
 {t&&<div className="acc-summary"><div><span>Comptes / mouvements</span><strong>{t.accounts} / {t.movements}</strong></div><div><span>Débit période (FCFA)</span><strong>{money(t.debit)}</strong></div><div><span>Crédit période (FCFA)</span><strong>{money(t.credit)}</strong></div><div><span>Solde net sélection</span><strong>{dc(Number(t.closing_debit)-Number(t.closing_credit))}</strong></div></div>}
 {t&&t.unknown_accounts>0&&<p className="text-xs text-red-700">{t.unknown_accounts} compte(s) absent(s) du plan : à contrôler.</p>}
 <AccountingTable fill footer={<AccountingPagination page={page} size={size} total={data?.count??0} setPage={setPage} setSize={n=>{setSize(n);setPage(0);}} disabled={loading||exporting}/>}>
 {mode==='balance'?<table className="acc-period-wide"><thead><tr><th rowSpan={2}>Compte / intitulé</th><th colSpan={2} className="text-center">Ouverture</th><th colSpan={2} className="text-center">Mouvements</th><th colSpan={2} className="text-center">Clôture (FCFA)</th></tr><tr>{Array.from({length:3},(_,i)=><FragmentPair key={i}/>)}</tr></thead><tbody>{balanceRows.map(r=><tr key={r.account_code}><td><button type="button" className="font-medium hover:underline" onClick={()=>work?.openAccount(r.account_code)}>{r.account_code}</button><span className="block text-xs">{r.account_name}</span></td>{[Math.max(0,r.opening),Math.max(0,-r.opening),r.debit,r.credit,Math.max(0,r.closing),Math.max(0,-r.closing)].map((n,i)=><td className="text-right" key={i}>{amount(n)}</td>)}</tr>)}{!data?.rows.length&&<tr><td colSpan={7}>{loading?'Chargement…':'Aucun compte pour la sélection.'}</td></tr>}</tbody>{t&&<tfoot><tr><td>TOTAL</td>{[t.opening_debit,t.opening_credit,t.debit,t.credit,t.closing_debit,t.closing_credit].map((n,i)=><td key={i} className="text-right">{money(n)}</td>)}</tr></tfoot>}</table>:
 <table className="acc-period-wide"><thead><tr><th>Compte</th><th>Date / pièce</th><th>Libellé</th><th className="text-right">Débit</th><th className="text-right">Crédit</th><th className="text-right">Solde cumulé</th></tr></thead><tbody>{ledgerRows.map((r,i,all)=><LedgerRows key={r.line_id??r.account_code} row={r} first={i===0||all[i-1].account_code!==r.account_code} last={i===all.length-1||all[i+1].account_code!==r.account_code} openAccount={()=>work?.openAccount(r.account_code)} openPiece={()=>r.entry_number&&work?.openPiece({entryId:r.entry_id??undefined,entryNumber:r.entry_number})}/>)}{!data?.rows.length&&<tr><td colSpan={6}>{loading?'Chargement…':'Aucun compte pour la sélection.'}</td></tr>}</tbody></table>}

 <table className="acc-period-compact">
  {mode === 'balance' ? <>
    <thead><tr><th scope="col" className="text-left">Compte</th><th scope="col" className="text-right">Montants (FCFA)</th></tr></thead>
    <tbody>
      {balanceRows.map(row => <tr key={row.account_code}>
        <td><button type="button" className="acc-table-link" onClick={() => work?.openAccount(row.account_code)}>{row.account_code}</button><span className="acc-table-meta">{row.account_name}</span></td>
        <td><BookAmounts values={[
          ['Ouverture', dc(row.opening)],
          ['Débit', amount(row.debit)], ['Crédit', amount(row.credit)], ['Clôture', dc(row.closing)],
        ]}/></td>
      </tr>)}
    </tbody>
    {t && <tfoot><tr><td>Total</td><td><BookAmounts values={[
      ['Ouverture D', money(t.opening_debit)], ['Ouverture C', money(t.opening_credit)],
      ['Débit', money(t.debit)], ['Crédit', money(t.credit)],
      ['Clôture D', money(t.closing_debit)], ['Clôture C', money(t.closing_credit)],
    ]}/></td></tr></tfoot>}
  </> : <>
    <thead><tr><th scope="col" className="text-left">Compte / pièce</th><th scope="col" className="text-right">Montants (FCFA)</th></tr></thead>
    <tbody>{ledgerRows.map((row, index) => (
      <CompactLedgerRows key={row.line_id ?? row.account_code} row={row}
        first={index === 0 || ledgerRows[index - 1].account_code !== row.account_code}
        last={index === ledgerRows.length - 1 || ledgerRows[index + 1].account_code !== row.account_code}
        openAccount={() => work?.openAccount(row.account_code)}
        openPiece={() => row.entry_number && work?.openPiece({ entryId: row.entry_id ?? undefined, entryNumber: row.entry_number })} />
    ))}</tbody>
  </>}
  {!data?.rows.length && <tbody><tr><td colSpan={2} className="acc-table-empty" role="status">{loading ? 'Chargement…' : 'Aucun compte pour la sélection.'}</td></tr></tbody>}
 </table>
 </AccountingTable>
 </section>;
}
function FragmentPair(){return <><th className="text-right">Débit</th><th className="text-right">Crédit</th></>;}
function LedgerRows({row:r,first,last,openAccount,openPiece}:{row:Ledger;first:boolean;last:boolean;openAccount:()=>void;openPiece:()=>void}){
 return <>{first&&<tr className="acc-total-row"><td colSpan={4}><button type="button" className="hover:underline font-medium" onClick={openAccount}>{r.account_code} — {r.account_name}</button></td><td>Ouverture</td><td className="text-right">{dc(r.account_opening)}</td></tr>}
 <tr><td>{r.account_code}</td><td>{date(r.entry_date)}<br/>{r.entry_number&&<button type="button" className="hover:underline font-medium" onClick={openPiece}>{r.entry_number}</button>}</td><td>{r.label||r.reference||'—'}{r.journal_type&&<span className="block text-xs">{r.journal_type}</span>}</td><td className="text-right">{amount(r.debit)}</td><td className="text-right">{amount(r.credit)}</td><td className="text-right">{dc(r.running_balance)}</td></tr>
 {last&&<tr className="acc-total-row"><td colSpan={3}>Total du compte sur la période (toutes pages)</td><td className="text-right">{money(r.account_debit)}</td><td className="text-right">{money(r.account_credit)}</td><td className="text-right">{dc(r.account_closing)}</td></tr>}</>;
}


function BookAmounts({ values }: { values: [label: string, value: string][] }) {
 return <dl className="acc-period-amounts">
  {values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
 </dl>;
}

function CompactLedgerRows({ row, first, last, openAccount, openPiece }: { row: Ledger; first: boolean; last: boolean; openAccount: () => void; openPiece: () => void }) {
 return <>
  {first && <tr className="acc-total-row">
   <td><button type="button" className="acc-table-link" onClick={openAccount}>{row.account_code}</button><span className="acc-table-meta">{row.account_name}</span></td>
   <td><BookAmounts values={[[ 'Ouverture', dc(row.account_opening) ]]}/></td>
  </tr>}
  <tr>
   <td>{row.entry_number && <button type="button" className="acc-table-link" onClick={openPiece}>{row.entry_number}</button>}
    <span className="acc-table-meta">{date(row.entry_date)}{row.journal_type ? ` · ${row.journal_type}` : ''}</span>
    <span>{row.label || row.reference || '—'}</span>
   </td>
   <td><BookAmounts values={[[ 'Débit', amount(row.debit) ], [ 'Crédit', amount(row.credit) ], [ 'Solde cumulé', dc(row.running_balance) ]]}/></td>
  </tr>
  {last && <tr className="acc-total-row">
   <td>Total du compte sur la période</td>
   <td><BookAmounts values={[[ 'Débit', money(row.account_debit) ], [ 'Crédit', money(row.account_credit) ], [ 'Clôture', dc(row.account_closing) ]]}/></td>
  </tr>}
 </>;
}
