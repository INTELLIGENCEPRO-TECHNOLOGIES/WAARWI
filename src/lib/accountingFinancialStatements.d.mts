export type SourceRow={account_code:string;account_name:string;account_class:number;opening:number;debit:number;credit:number;balance:number};
export type FinancialSnapshot={rows:SourceRow[];result:number;prior_missing:boolean};
export const balanceLabels:Record<string,string>;
export const incomeLabels:Record<string,string>;
export type FinancialStatements={balance:Record<string,number>;income:Record<string,number>;totalAssets:number;totalLiabilities:number;result:number;unknown:{code:string;name:string;amount:number}[];issues:string[];accounts:{code:string;name:string;section:string|null;opening:number;debit:number;credit:number;balance:number}[];cash:{opening:number;closing:number;variation:number}};
export function buildFinancialStatements(snapshot:FinancialSnapshot):FinancialStatements;
