export type BankImportRow={date:string;reference:string;label:string;amount:string};
export type BankImportMode='signed'|'bank'|'company';
export function normalizeBankHeader(v:unknown):string;
export function bankMinor(v:unknown):number;
export function bankDate(v:unknown):string;
export function parseDelimited(text:string,delimiter:string):string[][];
export function bankRows(matrix:unknown[][],mode?:BankImportMode):BankImportRow[];
export function bankCsv(text:string,mode?:BankImportMode):BankImportRow[];
