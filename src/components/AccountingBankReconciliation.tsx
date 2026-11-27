import {useAccountingWindowId,mayCloseAccountingWindow,useAccountingWork} from '../context/AccountingWindowContext';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '../lib/supabase';
import {AccountingTable,AccountingPagination,useAccountingPagination} from './AccountingWorkspace';
import {formatDate} from '../lib/format';
import {AccountingBankImport} from './AccountingBankImport';
import {bankMinor} from '../lib/bankStatementImport.mjs';
import {Search,Check,RefreshCw,Plus} from './Icons';

type Account={code:string;name:string;is_active:boolean};
type Statement={id:string;reference:string;account_code:string;date_from:string;date_to:string;opening_balance:number;closing_balance:number;status:'draft'|'final'|'cancelled';final_snapshot?:{book_balance:number;unpointed_amount:number;difference:number;book_pending_count:number};cancel_reason?:string};
type BankLine={id:string;operation_date:string;reference:string;label:string;amount:number;journal_line_id:string|null;matched_piece?:string;matched_date?:string};
type BookLine={id:string;entry_date:string;entry_number:string;label:string;reference:string;amount:number};
type Report={statement:Statement;book_balance:number;unpointed_amount:number;adjusted_book:number;difference:number;opening_drift:number;bank_pending_count:number;bank_pending_amount:number;book_pending_count:number;bank_rows:BankLine[];book_rows:BookLine[]};
type Proposal={bank_id:string;book_id:string;entry_id:string;entry_number:string;entry_date:string;operation_date:string;bank_label:string;book_label:string;amount:number;ref_equal:boolean;days:number};
type Suggestions={rows:Proposal[];pending:number;suggested:number;ambiguous:number};
type DraftLine={date:string;reference:string;label:string;amount:string};
const today=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Dakar'});
const money=(n:number)=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(Number(n))+' FCFA';
const message=(e:unknown)=>e&&typeof e==='object'&&'message' in e?String(e.message):'Opération impossible.';
const statusLabel=(s:string)=>s==='draft'?'En cours':s==='final'?'Validé':'Annulé';
const minor=bankMinor;
const blank=():DraftLine=>({date:today(),reference:'',label:'',amount:''});

export function AccountingBankReconciliation({tenantId,canManage}:{tenantId:string;canManage:boolean}){
 const work=useAccountingWork();
 const [accounts,setAccounts]=useState<Account[]>([]);
 const [account,setAccount]=useState('');
 const [statements,setStatements]=useState<Statement[]>([]);
 const [selected,setSelected]=useState('');
 const [report,setReport]=useState<Report|null>(null);
 const [offset,setOffset]=useState(0);
 const [revision,setRevision]=useState(0);
 const [loading,setLoading]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [open,setOpen]=useState(false);
 const [reference,setReference]=useState('');
 const [from,setFrom]=useState(()=>today().slice(0,7)+'-01');
 const [to,setTo]=useState(today);
 const [opening,setOpening]=useState('');
 const [closing,setClosing]=useState('');
 const [lines,setLines]=useState<DraftLine[]>([]);
 const [bankLine,setBankLine]=useState('');
 const [bookLine,setBookLine]=useState('');
 const [confirm,setConfirm]=useState<'final'|'cancel'|null>(null);
 const [reason,setReason]=useState('');
 const lock=useRef(false);
 const [importing,setImporting]=useState(false),[suggestions,setSuggestions]=useState<Suggestions|null>(null),[roots,setRoots]=useState<string[]>([]),[missing,setMissing]=useState<{id:string;amount:number;counter:string;reason:string}|null>(null),[counterAccounts,setCounterAccounts]=useState<Account[]>([]),[counterBusy,setCounterBusy]=useState(false);
 const discard=()=>!lock.current&&!importing&&(!(open||confirm||missing||roots.length)||window.confirm('Abandonner les travaux en cours ?'));
 const proposalPaging=useAccountingPagination(suggestions?.rows??[],selected+revision);
 const draftPaging=useAccountingPagination(lines,reference);
 useEffect(()=>{setSuggestions(null);setRoots([]);setMissing(null);},[selected,revision]);
 useEffect(()=>{if(!missing)return;let live=true;setCounterBusy(true);setCounterAccounts([]);void(async()=>{try{const list:Account[]=[];for(let i=0;;i+=200){const {data,error:e}=await supabase.from('accounts').select('code,name,is_active').eq('tenant_id',tenantId).eq('is_active',true).eq('account_type','general').eq('class',missing.amount<0?6:7).order('code').range(i,i+199);if(e)throw e;if(!live)return;list.push(...(data??[]));if((data??[]).length<200)break;}if(live)setCounterAccounts(list);}catch(e){if(live)setError(message(e));}finally{if(live)setCounterBusy(false);}})();return()=>{live=false;};},[tenantId,missing?.id]);
 const windowId=useAccountingWindowId();
 useEffect(()=>{const guard=(event:Event)=>{if(!mayCloseAccountingWindow(event,windowId)||event.defaultPrevented)return;if(lock.current||importing||(open||!!confirm||!!missing||roots.length>0)&&!window.confirm("Un relevé ou une validation est en cours. Quitter cet écran ?"))event.preventDefault();};window.addEventListener('waarwi:accounting-before-navigate',guard);return()=>window.removeEventListener('waarwi:accounting-before-navigate',guard);},[open,confirm,windowId,importing,missing,roots]);
 useEffect(()=>{let live=true;void(async()=>{try{
  const {data,error:err}=await supabase.from('accounts').select('code,name,is_active').eq('tenant_id',tenantId).eq('class',5).or('code.like.52%,code.like.53%,code.like.55%').order('code').limit(500);
  if(err)throw err;if(live){setAccounts((data??[]) as Account[]);setAccount(data?.[0]?.code??'');}
 }catch(e){if(live)setError(message(e));}})();return()=>{live=false;};},[tenantId]);
 useEffect(()=>{let live=true;setStatements([]);if(!account)return;void(async()=>{try{
  const all:Statement[]=[];for(let i=0;;i+=200){const {data,error:err}=await supabase.from('accounting_bank_statements').select('*').eq('tenant_id',tenantId).eq('account_code',account).order('date_to',{ascending:false}).order('id').range(i,i+199);if(err)throw err;if(!live)return;all.push(...((data??[]) as Statement[]));if((data??[]).length<200)break;}if(live)setStatements(all);
 }catch(e){if(live)setError(message(e));}})();return()=>{live=false;};},[tenantId,account,revision]);
 useEffect(()=>{let live=true;setReport(null);if(!selected){setLoading(false);return;}setLoading(true);
 void(async()=>{try{const {data,error:err}=await supabase.rpc('bank_statement_report',{p_tenant_id:tenantId,p_statement_id:selected,p_offset:offset});if(err)throw err;if(live)setReport(data as Report);}
 catch(e){if(live)setError(message(e));}finally{if(live)setLoading(false);}})();return()=>{live=false;};},[tenantId,selected,offset,revision,work?.revision]);
 const last=statements.find(s=>s.status==='final');
 const draft=statements.find(s=>s.status==='draft');
 const create=()=>{if(!discard())return;setOpen(true);setSelected('');setReport(null);setReference('');setLines([]);setClosing('');setNotice('');setError('');setConfirm(null);
  if(last){const d=new Date(last.date_to+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);setFrom(d.toISOString().slice(0,10));setOpening(String(last.closing_balance));}else{setFrom(today().slice(0,7)+'-01');setOpening('');}setTo(today());};
 const run=async(action:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');try{await action();setRevision(v=>v+1);}catch(e){setError(message(e));}finally{lock.current=false;setBusy(false);}};
 const save=()=>{if(importing||!canManage)return;void run(async()=>{
  const a=minor(opening),b=minor(closing);
  if(!reference.trim()||!from||!to||from>to)throw Error('Référence et dates obligatoires.');
  const values=lines.map(l=>{if(!l.label.trim()||!l.date||l.date<from||l.date>to)throw Error('Vérifiez les dates et libellés du relevé.');const n=minor(l.amount);if(!n)throw Error('Montant nul interdit.');return {...l,amount:n/100};});
  if(BigInt(a)+lines.reduce((sum,l)=>sum+BigInt(minor(l.amount)),0n)!==BigInt(b))throw Error('Le solde initial augmenté des mouvements doit correspondre au solde final.');
  const {data,error:err}=await supabase.rpc('create_bank_statement',{p_tenant_id:tenantId,p_account_code:account,p_reference:reference.trim(),p_from:from,p_to:to,p_opening:a/100,p_closing:b/100,p_rows:values});
  if(err)throw err;if(!data?.success||!data.id)throw Error('Création non confirmée.');setOpen(false);setSelected(data.id);setOffset(0);setNotice('Relevé enregistré.');
 });};
 const point=(id:string,journal:string|null)=>void run(async()=>{
  const {data,error:err}=await supabase.rpc('point_bank_statement_line',{p_tenant_id:tenantId,p_statement_id:selected,p_bank_line_id:id,p_journal_line_id:journal});
  if(err)throw err;if(!data?.success)throw Error('Pointage non confirmé.');setBankLine('');setBookLine('');setOffset(0);setNotice(journal?'Écriture pointée.':'Pointage annulé.');
 });
 const analyze=async()=>{if(lock.current||!selected||!canManage)return;lock.current=true;setBusy(true);setError('');setNotice('');setSuggestions(null);setRoots([]);setMissing(null);try{const {data,error:e}=await supabase.rpc('bank_pointing_suggestions',{p_tenant_id:tenantId,p_statement_id:selected});if(e)throw e;setSuggestions(data as Suggestions);}catch(e){setError(message(e));}finally{lock.current=false;setBusy(false);}};
 const batch=()=>{if(!roots.length||!suggestions||!window.confirm('Pointer '+roots.length+' paire(s) après contrôle ?'))return;const pairs=suggestions.rows.filter(r=>roots.includes(r.bank_id)).map(r=>({bank_id:r.bank_id,book_id:r.book_id}));void run(async()=>{const {data,error:e}=await supabase.rpc('confirm_bank_pointing_batch',{p_tenant_id:tenantId,p_statement_id:selected,p_pairs:pairs});if(e)throw e;if(!data?.success)throw Error('Pointage non confirmé.');setNotice(data.count+' opération(s) pointée(s).');setOffset(0);setBankLine('');setBookLine('');work?.refresh();});};
 const postMissing=()=>{if(!missing||!missing.counter||!missing.reason.trim()||!window.confirm('Comptabiliser la totalité de cette opération et la pointer ?'))return;void run(async()=>{const {data,error:e}=await supabase.rpc('post_missing_bank_operation',{p_tenant_id:tenantId,p_statement_id:selected,p_bank_line_id:missing.id,p_counter_account:missing.counter,p_expected_amount:missing.amount,p_reason:missing.reason});if(e)throw e;if(!data?.success)throw Error('Comptabilisation non confirmée.');setNotice('Pièce '+data.piece_number+' créée et pointée.');setOffset(0);setBankLine('');setBookLine('');work?.refresh();});};
 const finish=()=>void run(async()=>{
  const {data,error:err}=await supabase.rpc('finish_bank_statement',{p_tenant_id:tenantId,p_statement_id:selected,p_cancel_reason:confirm==='cancel'?reason.trim():null});
  if(err)throw err;if(!data?.success)throw Error('Opération non confirmée.');setNotice(confirm==='cancel'?'Relevé annulé.':'Rapprochement validé.');setConfirm(null);setReason('');
 });
 const bankPaging=useAccountingPagination(report?.bank_rows??[],selected);
 const statementPaging=useAccountingPagination(statements,account);
 const b=report?.bank_rows.find(l=>l.id===bankLine);const j=report?.book_rows.find(l=>l.id===bookLine);
 const canPoint=!!b&&!!j&&Number(b.amount)===Number(j.amount)&&!b.journal_line_id;
 const isDraft=canManage&&report?.statement.status==='draft';
 const canFinish=!!report&&report.bank_pending_count===0&&Number(report.difference)===0&&Number(report.opening_drift)===0;
 let predicted='—';try{predicted=money((minor(opening)+lines.reduce((s,l)=>s+minor(l.amount),0))/100);}catch{}
 const changeLine=(i:number,key:keyof DraftLine,value:string)=>setLines(p=>p.map((l,k)=>i===k?{...l,[key]:value}:l));
 const choose=(id:string)=>{setSelected(id);setOpen(false);setOffset(0);setBankLine('');setBookLine('');setConfirm(null);setError('');setNotice('');};
 return <section className="space-y-3 min-w-0 acc-bank-workspace">
  <div className="acc-section-head space-y-2">
   <label className="block text-xs font-medium">Compte à rapprocher<select className="input mt-1 w-full" value={account} disabled={busy||importing} onChange={e=>{if(discard()){setAccount(e.target.value);choose('');}}}><option value="">Choisir un compte</option>{accounts.map(a=><option key={a.code} value={a.code}>{a.code} — {a.name}{a.is_active?'':' (inactif)'}</option>)}</select></label>
   <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Relevés</h2>{canManage&&<button type="button" className="btn-primary" disabled={!account||!!draft||busy||importing||!accounts.find(a=>a.code===account)?.is_active} onClick={create}><Plus size={15}/>Nouveau relevé</button>}</div>
   {statements.length===0&&<p className="text-xs text-neutral-500">Aucun relevé enregistré.</p>}
   <AccountingTable footer={<AccountingPagination {...statementPaging}/>}>
    <table><thead><tr><th className="text-left">Relevé</th><th className="text-left hidden sm:table-cell">Période</th><th className="text-left">Statut</th><th className="text-right">Solde final</th></tr></thead><tbody>{statementPaging.rows.map(s=><tr key={s.id} data-selected={selected===s.id}><td><button className="font-medium text-left hover:underline" type="button" disabled={busy||importing} onClick={()=>{if(discard())choose(s.id);}}>{s.reference}</button><span className="block sm:hidden text-[11px] text-neutral-500">{formatDate(s.date_from)} — {formatDate(s.date_to)}</span></td><td className="hidden sm:table-cell">{formatDate(s.date_from)} au {formatDate(s.date_to)}</td><td>{statusLabel(s.status)}</td><td className="text-right">{Number(s.closing_balance).toLocaleString('fr-FR')}</td></tr>)}</tbody></table>
   </AccountingTable>
  </div>
  {notice&&<p role="status" className="text-sm text-neutral-700">{notice}</p>}{error&&<p role="alert" className="text-sm text-red-700 break-words">{error}</p>}
  {open&&<form className="acc-section-head space-y-3" onSubmit={e=>{e.preventDefault();save();}}>
   <h2 className="text-sm font-semibold">Saisie du relevé bancaire</h2>
   <p className="text-xs text-neutral-600">Saisissez les montants du point de vue de l’entreprise : encaissement positif, décaissement négatif. Le premier relevé doit démarrer sur une date déjà rapprochée.</p>
   <label className="block text-xs font-medium">Référence<input className="input mt-1 w-full" required maxLength={120} value={reference} disabled={busy} onChange={e=>setReference(e.target.value)}/></label>
   <div className="acc-fields acc-fields-2"><label className="text-xs font-medium">Du<input className="input mt-1 w-full" type="date" required value={from} disabled={busy||!!last} onChange={e=>setFrom(e.target.value)}/></label><label className="text-xs font-medium">Au<input className="input mt-1 w-full" type="date" required value={to} min={from} max={today()} disabled={busy} onChange={e=>setTo(e.target.value)}/></label><label className="text-xs font-medium">Solde initial<input className="input mt-1 w-full" inputMode="decimal" required value={opening} disabled={busy||!!last} onChange={e=>setOpening(e.target.value)}/></label><label className="text-xs font-medium">Solde final indiqué<input className="input mt-1 w-full" inputMode="decimal" required value={closing} disabled={busy} onChange={e=>setClosing(e.target.value)}/></label></div>
   <AccountingBankImport disabled={busy} hasRows={lines.length>0} onImport={rows=>{setLines(rows);draftPaging.setPage(0);}} onBusy={setImporting}/>
   {draftPaging.rows.map((l,index)=>{const i=draftPaging.page*draftPaging.size+index;return <div key={i} className="acc-fields acc-fields-5 acc-field-row">
    <label className="text-xs">Date<input className="input mt-1 w-full" type="date" value={l.date} disabled={busy} onChange={e=>changeLine(i,'date',e.target.value)}/></label>
    <label className="text-xs">Référence<input className="input mt-1 w-full" value={l.reference} maxLength={120} disabled={busy} onChange={e=>changeLine(i,'reference',e.target.value)}/></label>
    <label className="text-xs">Libellé<input className="input mt-1 w-full" required value={l.label} maxLength={500} disabled={busy} onChange={e=>changeLine(i,'label',e.target.value)}/></label>
    <label className="text-xs">Montant signé<input className="input mt-1 w-full" inputMode="decimal" required value={l.amount} disabled={busy} onChange={e=>changeLine(i,'amount',e.target.value)}/></label>
    <button className="btn-secondary" type="button" disabled={busy} onClick={()=>setLines(p=>p.filter((_,k)=>k!==i))}>Retirer</button>
   </div>;})}
   {lines.length>0&&<AccountingPagination {...draftPaging} disabled={busy||importing}/>}
   <button type="button" className="btn-secondary" disabled={busy||importing||lines.length>=500} onClick={()=>setLines(p=>[...p,{...blank(),date:to}])}>Ajouter une opération</button>
   <p className="text-sm font-medium">Solde final calculé : {predicted}</p>
   <div className="flex flex-wrap gap-2"><button type="submit" className="btn-primary" disabled={busy||importing}>Enregistrer le relevé</button><button type="button" className="btn-secondary" disabled={busy||importing} onClick={()=>{if(discard())setOpen(false);}}>Annuler</button></div>
  </form>}
  {loading&&<p role="status" className="text-sm text-neutral-500">Chargement du rapprochement…</p>}
  {report&&<div className="space-y-4">
   <div className="flex flex-wrap justify-between items-center gap-2"><h2 className="text-sm font-semibold">{report.statement.reference} · {statusLabel(report.statement.status)}</h2><button type="button" className="btn-secondary" disabled={busy} onClick={()=>{if(discard())setRevision(v=>v+1);}}><RefreshCw size={15}/>Actualiser</button></div>
   <div className="acc-summary">{[['Solde comptable',report.book_balance],['Mouvements comptables non pointés',report.unpointed_amount],['Solde comptable ajusté',report.adjusted_book],['Solde du relevé',report.statement.closing_balance]].map(([label,amount])=><div key={String(label)}><span>{label}</span><strong>{money(Number(amount))}</strong></div>)}</div>
   <div className="acc-section-head space-y-1"><p className="text-xs text-neutral-500">Écart de rapprochement</p><p className={'text-xl font-semibold '+(Number(report.difference)===0?'text-neutral-900':'text-red-700')}>{money(report.difference)}</p><p className="text-xs text-neutral-600">{report.bank_pending_count} opération(s) bancaire(s) non pointée(s) · {report.book_pending_count} écriture(s) comptable(s) en attente.</p>{Number(report.opening_drift)!==0&&<p className="text-xs text-red-700">Le solde comptable antérieur au premier relevé a changé : {money(report.opening_drift)}.</p>}{report.statement.final_snapshot&&(Number(report.statement.final_snapshot.book_balance)!==Number(report.book_balance)||Number(report.statement.final_snapshot.unpointed_amount)!==Number(report.unpointed_amount)||Number(report.statement.final_snapshot.book_pending_count)!==Number(report.book_pending_count))&&<p className="text-xs text-amber-800">Le solde comptable a évolué depuis la validation. Vérifiez les écritures rétroactives.</p>}</div>
   {isDraft&&<section className="acc-section-head space-y-2"><div className="acc-toolbar"><strong className="text-sm">Pointage assisté</strong><span className="acc-spacer"/><button type="button" className="btn-secondary" disabled={busy||loading} onClick={()=>void analyze()}><Search size={15}/>Analyser les correspondances</button></div>
   {suggestions&&<><p className="text-xs">{suggestions.suggested} proposition(s) unique(s) · {suggestions.ambiguous} ambiguë(s) · {suggestions.pending-suggestions.suggested-suggestions.ambiguous} sans proposition. Montant et sens exacts ; même date ou référence identique à 7 jours maximum. Les ambiguïtés restent manuelles.</p><div className="acc-toolbar"><button type="button" className="btn-secondary" disabled={busy||!suggestions.rows.length} onClick={()=>setRoots(suggestions.rows.slice(0,100).map(p=>p.bank_id))}>Sélectionner jusqu’à 100</button><button type="button" className="btn-secondary" disabled={busy||!roots.length} onClick={()=>setRoots([])}>Désélectionner</button><span className="acc-spacer"/><button type="button" className="btn-primary" disabled={busy||!roots.length} onClick={batch}><Check size={15}/>Pointer {roots.length}</button></div>
   <AccountingTable footer={<AccountingPagination {...proposalPaging} disabled={busy}/>}><table><thead><tr><th>Sélection</th><th>Banque</th><th>Comptabilité</th><th>Critère</th><th className="text-right">Montant</th></tr></thead><tbody>{proposalPaging.rows.map(p=><tr key={p.bank_id}><td><input type="checkbox" aria-label={'Pointer '+p.bank_label} checked={roots.includes(p.bank_id)} disabled={busy||roots.length>=100&&!roots.includes(p.bank_id)} onChange={()=>setRoots(old=>old.includes(p.bank_id)?old.filter(x=>x!==p.bank_id):[...old,p.bank_id])}/></td><td>{p.bank_label}<span className="block text-xs">{formatDate(p.operation_date)}</span></td><td><button type="button" className="hover:underline" onClick={()=>work?.openPiece({entryId:p.entry_id,entryNumber:p.entry_number})}>{p.entry_number}</button><span className="block text-xs">{formatDate(p.entry_date)} · {p.book_label}</span></td><td>{p.ref_equal?'Référence identique':'Date identique'}</td><td className="text-right">{money(p.amount)}</td></tr>)}{!suggestions.rows.length&&<tr><td colSpan={5}>Aucune proposition suffisamment fiable.</td></tr>}</tbody></table></AccountingTable></>}
   </section>}
   <div className="acc-bank-panels">
    <section className="min-w-0 space-y-2"><h3 className="text-sm font-semibold">Relevé bancaire</h3>
     <AccountingTable footer={<AccountingPagination {...bankPaging} disabled={busy}/>}>
      <table><thead><tr><th className="text-left"><span className="sr-only">Sélection</span></th><th className="text-left">Opération</th><th className="text-right">Montant</th><th className="text-left">Pointage</th></tr></thead><tbody>{bankPaging.rows.map(l=><tr key={l.id}><td>{!l.journal_line_id&&isDraft&&<input type="radio" name={'bankLine-'+windowId} aria-label={'Sélectionner '+l.label} checked={bankLine===l.id} disabled={busy} onChange={()=>{setBankLine(l.id);setBookLine('');setMissing(null);}}/>}</td><td><span className="font-medium">{l.label}</span><span className="block text-[11px] text-neutral-500">{formatDate(l.operation_date)} · {l.reference}</span></td><td className="text-right">{Number(l.amount).toLocaleString('fr-FR')}</td><td>{l.journal_line_id?<><span>Pointée</span>{l.matched_piece&&<button type="button" className="block text-xs hover:underline" onClick={()=>work?.openPiece({entryNumber:l.matched_piece!})}>{l.matched_piece}</button>}{isDraft&&<button type="button" className="block underline text-xs" disabled={busy} onClick={()=>point(l.id,null)}>Dépointer</button>}</>:<span className="text-neutral-500">À pointer</span>}</td></tr>)}{!bankPaging.total&&<tr><td colSpan={4} className="text-center text-neutral-500">Aucun mouvement.</td></tr>}</tbody></table>
     </AccountingTable></section>
    <section className="min-w-0 space-y-2"><h3 className="text-sm font-semibold">Écritures comptables non pointées</h3>
     <AccountingTable footer={<div className="acc-pagination"><button type="button" className="btn-secondary" disabled={busy||offset===0} onClick={()=>{setOffset(v=>v-50);setBookLine('');}}>Précédente</button><span>{offset/50+1} / {Math.max(1,Math.ceil(report.book_pending_count/50))}</span><button type="button" className="btn-secondary" disabled={busy||offset+50>=report.book_pending_count} onClick={()=>{setOffset(v=>v+50);setBookLine('');}}>Suivante</button></div>}>
      <table><thead><tr><th className="text-left"><span className="sr-only">Sélection</span></th><th className="text-left">Pièce / libellé</th><th className="text-right">Montant</th></tr></thead><tbody>{report.book_rows.map(l=><tr key={l.id}><td>{isDraft&&<input type="radio" name={'bookLine-'+windowId} aria-label={'Sélectionner '+l.entry_number} checked={bookLine===l.id} disabled={busy||!b||Number(b.amount)!==Number(l.amount)} onChange={()=>setBookLine(l.id)}/>}</td><td><button type="button" className="font-medium hover:underline" onClick={()=>work?.openPiece({entryNumber:l.entry_number})}>{l.entry_number}</button><span className="block text-[11px] text-neutral-500">{formatDate(l.entry_date)} · {l.label||l.reference}</span></td><td className="text-right">{Number(l.amount).toLocaleString('fr-FR')}</td></tr>)}{!report.book_rows.length&&<tr><td colSpan={3} className="text-center text-neutral-500">Aucune écriture en attente.</td></tr>}</tbody></table>
     </AccountingTable></section>
   </div>
   {isDraft&&<div className="acc-section-head space-y-2"><div className="acc-toolbar">{b&&!b.journal_line_id&&<button type="button" className="btn-secondary" disabled={busy} onClick={()=>setMissing({id:b.id,amount:Number(b.amount),counter:'',reason:''})}>Comptabiliser une opération absente</button>}<button type="button" className="btn-primary" disabled={busy||!canPoint} onClick={()=>point(bankLine,bookLine)}>Pointer les deux opérations</button></div>{missing&&<section className="acc-section-head space-y-2"><strong className="text-sm">Opération bancaire absente : {money(missing.amount)}</strong><p className="text-xs text-neutral-500">Réservé aux frais ou produits bancaires réellement non comptabilisés. Vérifiez les écritures existantes et le justificatif ; ne pas utiliser pour solder un règlement partiel.</p><div className="acc-toolbar"><label className="text-xs">Contrepartie<select className="input" value={missing.counter} disabled={busy||counterBusy} onChange={e=>setMissing({...missing,counter:e.target.value})}><option value="">Choisir un compte {missing.amount<0?'de charge':'de produit'}</option>{counterAccounts.map(a=><option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}</select></label><label className="text-xs flex-1">Motif<input className="input w-full" value={missing.reason} maxLength={300} disabled={busy} onChange={e=>setMissing({...missing,reason:e.target.value})}/></label><button type="button" className="btn-secondary" disabled={busy} onClick={()=>setMissing(null)}>Annuler</button><button type="button" className="btn-primary" disabled={busy||counterBusy||!missing.counter||!missing.reason.trim()} onClick={postMissing}>Comptabiliser et pointer</button></div></section>}<p className="text-xs text-neutral-500">Le pointage exige un montant et un sens identiques. Les écritures comptables non pointées restent en attente pour le relevé suivant.</p><div className="flex flex-wrap gap-2"><button type="button" className="btn-primary" disabled={busy||!canFinish} onClick={()=>setConfirm('final')}>Valider le rapprochement</button><button type="button" className="btn-secondary" disabled={busy} onClick={()=>{setReason('');setConfirm('cancel');}}>Annuler le relevé</button></div>
   {confirm&&<div className="space-y-2 border-t border-neutral-200 pt-2"><p className="text-sm">{confirm==='final'?'Confirmer la validation définitive du relevé ?':'Motif de l’annulation du relevé'}</p>{confirm==='cancel'&&<textarea className="input w-full" value={reason} maxLength={500} disabled={busy} onChange={e=>setReason(e.target.value)}/>}<div className="flex flex-wrap gap-2"><button type="button" className="btn-primary" disabled={busy||(confirm==='cancel'?!reason.trim():!canFinish)} onClick={finish}>Confirmer</button><button type="button" className="btn-secondary" disabled={busy} onClick={()=>setConfirm(null)}>Retour</button></div></div>}</div>}
  </div>}
 </section>;
}
