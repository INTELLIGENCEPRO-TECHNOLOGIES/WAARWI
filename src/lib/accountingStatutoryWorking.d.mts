import type {FinancialSnapshot} from './accountingFinancialStatements.mjs';
export const assetLabels:Record<string,string>;
export const flowLabels:Record<string,string>;
export const flowInputKeys:string[];
export const annexLabels:Record<string,string>;
export type AssetValues={gross:number;impairment:number;net:number};
export function detailedAssets(snapshot:FinancialSnapshot,expectedNet:number):{rows:Record<string,AssetValues>;total:AssetValues;issues:string[]};
export function suggestIndirect(snapshot:FinancialSnapshot):{proposed:Record<string,number>;notes:string[]};
export function indirectFlow(opening:number,closing:number,inputs:Record<string,number|string|null|undefined>):{values:Record<string,number|null>;missing:string[];gap:number|null;complete:boolean};
