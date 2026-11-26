import {createContext,useContext} from 'react';
export const AccountingWindowId=createContext<string|null>(null);
export const useAccountingWindowId=()=>useContext(AccountingWindowId);
export function mayCloseAccountingWindow(event:Event,id:string|null){
 const scope=(event as CustomEvent<{windowId?:string}>).detail?.windowId;
 return !scope||scope===id;
}

export type AccountingPieceRequest={entryId?:string;entryNumber:string;reverse?:boolean};
export type AccountingWorkActions={openPiece:(request:AccountingPieceRequest)=>void;openAccount:(code:string)=>void;revision:number};
export const AccountingWorkContext=createContext<AccountingWorkActions|null>(null);
export const useAccountingWork=()=>useContext(AccountingWorkContext);
