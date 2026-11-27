import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { calculatePurchaseInvoice, reconcilePurchaseInvoice } from '../lib/purchaseInvoiceAmounts.mjs';

type Order = {id:string;order_number:string;total:number;received_date:string; supplier_id:string};
type Line = {net:string;rate:string;deductible:string};
const blank = ():Line => ({net:'',rate:'',deductible:''});
function hundredths(value:string):number {
  const clean=value.trim().replace(/\s/g,'').replace(',','.');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) throw new Error('Saisissez un montant ou un taux positif avec deux décimales au maximum.');
  const [whole,frac='']=clean.split('.');
  const n=Number(whole)*100+Number(frac.padEnd(2,'0'));
  if (!Number.isSafeInteger(n)) throw new Error('Montant trop élevé.');
  return n;
}
const fcfa=(minor:number)=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(minor/100)+' FCFA';
const errorText=(e:unknown)=>e && typeof e==='object' && 'message' in e ? String(e.message) : 'Opération impossible.';

export function AccountingPurchaseInvoice({tenantId,onPosted}:{tenantId:string;onPosted:()=>void}) {
  const [orders,setOrders]=useState<Order[]>([]);
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState(false);
  const inFlight=useRef(false);
  const [search,setSearch]=useState('');
  const [page,setPage]=useState(0);
  const [more,setMore]=useState(false);
  const [selected,setSelected]=useState<Order|null>(null);
  const [number,setNumber]=useState('');
  const [date,setDate]=useState('');
  const [lines,setLines]=useState<Line[]>([blank()]);
  const [declaredNet,setDeclaredNet]=useState('');
  const [declaredVat,setDeclaredVat]=useState('');
  const [declaredGross,setDeclaredGross]=useState('');
  const [confirmed,setConfirmed]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [refresh,setRefresh]=useState(0);
  useEffect(()=>{
    let active=true;
    setLoading(true);
    setError('');
    void (async()=>{
      try {
        let q=supabase.from('supplier_orders').select('id,order_number,total,received_date,supplier_id')
          .eq('tenant_id',tenantId).eq('status','received')
          .not('supplier_id','is',null).is('accounting_entry_id',null)
          .or('accounting_status.is.null,accounting_status.eq.not_accounted');
        const term=search.trim().replace(/[%_\\]/g,'');
        if(term) q=q.ilike('order_number','%'+term+'%');
        const {data,error:err}=await q.order('received_date',{ascending:false}).order('id').range(page*20,page*20+20);
        if(err) throw err;
        if(active){setOrders((data??[]).slice(0,20) as Order[]);setMore((data??[]).length>20);}
      } catch(e){if(active){setError(errorText(e));setOrders([]);setMore(false);}}
      finally {if(active)setLoading(false);}
    })();
    return ()=>{active=false;};
  },[tenantId,search,page,refresh]);
  const select=(o:Order)=>{
    setSelected(o);setNumber('');setDate(o.received_date||'');setLines([blank()]);
    setDeclaredNet('');setDeclaredVat('');setDeclaredGross(String(o.total));
    setConfirmed(false);setError('');setNotice('');
  };
  const change=(i:number,k:keyof Line,v:string)=>{
    setLines(old=>old.map((l,j)=>j===i?{...l,[k]:v}:l));setConfirmed(false);
  };
  let preview:ReturnType<typeof calculatePurchaseInvoice>|null=null;
  let validation='';
  try {
    if(selected) {
      const parsed=lines.map(l=>({netMinor:hundredths(l.net),vatBps:hundredths(l.rate),deductibleBps:hundredths(l.deductible)}));
      preview=calculatePurchaseInvoice(parsed);
      reconcilePurchaseInvoice(parsed,{netMinor:hundredths(declaredNet),vatMinor:hundredths(declaredVat),grossMinor:hundredths(declaredGross)});
      if(hundredths(String(selected.total))!==preview.grossMinor) throw new Error('Le TTC doit correspondre au total de la commande.');
    }
  } catch(e){validation=errorText(e);}
  const post=async()=>{
    if(!selected||!preview||validation||!confirmed||!number.trim()||!date||inFlight.current)return;
    inFlight.current=true;setBusy(true);setError('');setNotice('');
    try{
      const payload=lines.map(l=>({netMinor:hundredths(l.net),vatBps:hundredths(l.rate),deductibleBps:hundredths(l.deductible)}));
      const {data,error:err}=await supabase.rpc('post_purchase_invoice',{
        p_tenant_id:tenantId,p_order_id:selected.id,p_invoice_number:number.trim(),p_invoice_date:date,p_lines:payload,
        p_declared:{netMinor:hundredths(declaredNet),vatMinor:hundredths(declaredVat),grossMinor:hundredths(declaredGross)}
      });
      if(err)throw err;
      if(!data?.success)throw new Error(data?.error||'Comptabilisation non confirmée.');
      setNotice('Facture comptabilisée : '+String(data.piece_number??''));
      setSelected(null);setConfirmed(false);setPage(0);setRefresh(n=>n+1);onPosted();
    }catch(e){setError(errorText(e));setConfirmed(false);}
    finally{inFlight.current=false;setBusy(false);}
  };
  const input=(label:string,value:string,changeValue:(v:string)=>void,placeholder='')=>(
    <label className="min-w-0 text-xs font-medium text-neutral-700">{label}
      <input type="text" inputMode="decimal" className="input mt-1 w-full" value={value} placeholder={placeholder} disabled={busy}
        onChange={e=>{changeValue(e.target.value);setConfirmed(false);}}/>
    </label>);
  return <section className="acc-section-block space-y-3" aria-label="Factures fournisseurs">
    <div><h2 className="text-sm font-semibold text-neutral-900">Factures fournisseurs</h2>
      <p className="mt-1 text-xs text-neutral-600">Une facture par commande reçue. Le total TTC doit correspondre à la dette existante. Aucun stock ni paiement supplémentaire ne sera créé.</p></div>
    {error&&<p role="alert" className="text-sm text-red-700 break-words">{error}</p>}
    {notice&&<p role="status" className="text-sm text-neutral-700">{notice}</p>}
    {!selected?<div className="space-y-3">
      <label className="block text-xs text-neutral-600">Rechercher une commande
        <input className="input mt-1 w-full" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} placeholder="Numéro de commande"/>
      </label>
      {loading?<p role="status" className="text-sm text-neutral-500">Chargement…</p>:orders.length===0?<p className="text-sm text-neutral-500">Aucune commande reçue à comptabiliser.</p>:<ul className="divide-y divide-neutral-200">
        {orders.map(o=><li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><div className="min-w-0"><p className="text-sm font-medium break-words">{o.order_number}</p><p className="text-xs text-neutral-500">{o.received_date} · {fcfa(Number(o.total)*100)}</p></div><button type="button" className="btn btn-secondary" onClick={()=>select(o)}>Saisir la facture</button></li>)}
      </ul>}
      <div className="flex justify-between gap-2"><button type="button" className="btn btn-secondary" disabled={loading||page===0} onClick={()=>setPage(p=>p-1)}>Précédente</button><button type="button" className="btn btn-secondary" disabled={loading||!more} onClick={()=>setPage(p=>p+1)}>Suivante</button></div>
    </div>:<form className="space-y-4" onSubmit={e=>{e.preventDefault();void post();}}>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{selected.order_number} · {fcfa(Number(selected.total)*100)}</p><button type="button" disabled={busy} className="btn btn-secondary" onClick={()=>{setSelected(null);setConfirmed(false);setError('');}}>Retour</button></div>
      <div className="acc-fields acc-fields-2">
        <label className="text-xs font-medium">Numéro de facture<input required maxLength={120} className="input mt-1 w-full" value={number} disabled={busy} onChange={e=>{setNumber(e.target.value);setConfirmed(false);}}/></label>
        <label className="text-xs font-medium">Date de facture<input required type="date" max={new Date().toISOString().slice(0,10)} className="input mt-1 w-full" value={date} disabled={busy} onChange={e=>{setDate(e.target.value);setConfirmed(false);}}/></label>
      </div>
      <div className="acc-fields acc-fields-3">
        {input('HT indiqué sur la facture',declaredNet,setDeclaredNet)}
        {input('TVA indiquée sur la facture',declaredVat,setDeclaredVat)}
        {input('TTC indiqué sur la facture',declaredGross,setDeclaredGross)}
      </div>
      <div className="space-y-3"><h3 className="text-sm font-semibold">Ventilation de la TVA</h3><p className="text-xs text-neutral-500">Montants HT après remises. Saisissez explicitement le taux et la part déductible (0 à 100 %), même en cas d’exonération.</p>
      {lines.map((l,i)=><div key={i} className="acc-fields acc-fields-4 acc-field-row">
        {input('Montant HT',l.net,v=>change(i,'net',v))}
        {input('Taux TVA (%)',l.rate,v=>change(i,'rate',v),'18 ou 0')}
        {input('Part déductible (%)',l.deductible,v=>change(i,'deductible',v),'100 ou 0')}
        <button type="button" className="btn btn-secondary" disabled={busy||lines.length===1} onClick={()=>{setLines(p=>p.filter((_,j)=>j!==i));setConfirmed(false);}}>Retirer</button>
      </div>)}
      <button type="button" className="btn btn-secondary" disabled={busy||lines.length>=500} onClick={()=>{setLines(p=>[...p,blank()]);setConfirmed(false);}}>Ajouter une ligne</button></div>
      {preview&&<div className="acc-summary">{[['Achats à débiter',preview.expenseMinor],['TVA récupérable à débiter',preview.deductibleVatMinor],['Fournisseur à créditer',preview.grossMinor],['TVA non récupérable',preview.nonDeductibleVatMinor]].map(([label,amount])=><div key={String(label)}><span>{label}</span><strong>{fcfa(Number(amount))}</strong></div>)}</div>}
      {validation&&<p className="text-xs text-neutral-600">{validation}</p>}
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} disabled={busy||!!validation||!preview} onChange={e=>setConfirmed(e.target.checked)}/> Je confirme les montants, la déductibilité et le justificatif fournisseur.</label>
      <button type="submit" className="btn btn-primary" disabled={busy||!confirmed||!preview||!!validation||!number.trim()||!date}>{busy?'Comptabilisation…':'Comptabiliser la facture'}</button>
    </form>}
  </section>;
}
