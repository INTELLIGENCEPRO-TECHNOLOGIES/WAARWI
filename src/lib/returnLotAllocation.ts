import {supabase} from './supabase';

export type ReturnLot={lot_id:string;batch_number:string;expiry_date:string|null;site_name:string;sold:number;available:number};
export type ReturnLotLine={quantity:number;returnLots?:ReturnLot[];lotQuantities?:Record<string,string>};
export type ReturnLotInput={lot_id:string;quantity:number};

export async function loadReturnLots(saleId:string):Promise<Record<string,ReturnLot[]>>{
 const {data,error}=await supabase.rpc('read_fiscal_return_lots',{p_sale_id:saleId});
 if(error)throw error;
 return (data||{}) as Record<string,ReturnLot[]>;
}
export function returnLotAllocation(line:ReturnLotLine,restock:boolean):{valid:boolean;manual:boolean;lots:ReturnLotInput[]}{
 const available=(line.returnLots||[]).filter(l=>Number(l.available)>0);
 const qty=Number(line.quantity),sum=available.reduce((s,l)=>s+Number(l.available),0);
 const eq=(a:number,b:number)=>Math.abs(a-b)<1e-8;
 if(!line.returnLots?.length)return {valid:true,manual:false,lots:[]};
 if(!Number.isFinite(qty)||qty<=0||qty>sum+1e-8)return {valid:false,manual:false,lots:[]};
 if(available.length===1)return {valid:true,manual:false,lots:[{lot_id:available[0].lot_id,quantity:qty}]};
 if(eq(sum,qty))return {valid:true,manual:false,lots:available.map(l=>({lot_id:l.lot_id,quantity:Number(l.available)}))};
 const values=available.map(l=>({lot_id:l.lot_id,quantity:Number(line.lotQuantities?.[l.lot_id]||0),max:Number(l.available)}));
 const validValues=values.every(v=>Number.isFinite(v.quantity)&&v.quantity>=0&&v.quantity<=v.max);
 const total=values.reduce((s,v)=>s+v.quantity,0);
 return {valid:validValues&&(eq(total,qty)||(!restock&&total===0)),manual:true,lots:values.filter(v=>v.quantity>0).map(({lot_id,quantity})=>({lot_id,quantity}))};
}
