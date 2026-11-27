import {returnLotAllocation,type ReturnLotLine} from '../../lib/returnLotAllocation';

export function ReturnLotFields({line,restock,onChange}:{line:ReturnLotLine;restock:boolean;onChange:(values:Record<string,string>)=>void}){
 const lots=line.returnLots||[];
 if(!lots.length)return null;
 const result=returnLotAllocation(line,restock);
 const total=result.lots.reduce((s,l)=>s+l.quantity,0);
 return <div className="min-w-0 space-y-2 border-l-2 border-[var(--w-separator)] pl-3 py-2 text-sm">
  <div className="font-semibold">Lots d’origine</div>
  <p className="text-xs text-[var(--w-text-secondary)]">{result.manual?(restock?'Indiquez les quantités réellement retournées par lot.':'Affectation facultative si le retour est uniquement financier.'):'Affectation automatique des quantités.'}</p>
  {lots.map(l=>{
   const qty=result.manual?(line.lotQuantities?.[l.lot_id]||''):String(result.lots.find(x=>x.lot_id===l.lot_id)?.quantity||0);
   return <div key={l.lot_id} className="flex min-w-0 items-center gap-3 py-1">
    <div className="min-w-0 flex-1"><div className="break-words font-medium">{l.batch_number||'Lot sans numéro'}</div><div className="break-words text-xs text-[var(--w-text-secondary)]">{l.site_name} │ Restant : {l.available} / {l.sold}{l.expiry_date?' │ Péremption : '+l.expiry_date.split('-').reverse().join('/') : ''}</div></div>
    {result.manual&&Number(l.available)>0?<input type="number" inputMode="decimal" min={0} max={l.available} step="any" aria-label={'Quantité à retourner, lot '+l.batch_number} value={qty} onChange={e=>onChange({...line.lotQuantities,[l.lot_id]:e.target.value})} className="min-h-11 w-20 shrink-0 border-b border-[var(--w-separator)] bg-transparent text-right tabular-nums"/>:<span className="shrink-0 tabular-nums">{qty||0}</span>}
   </div>;
  })}
  <div className="flex items-center justify-between gap-2 text-xs" aria-live="polite"><span>{result.valid?'Total affecté':'Vérifiez les quantités par lot'}</span><strong className="tabular-nums">{total} / {line.quantity}</strong></div>
 </div>;
}
