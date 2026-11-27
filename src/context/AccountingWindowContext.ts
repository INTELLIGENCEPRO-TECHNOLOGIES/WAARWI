import {createContext,useContext} from 'react';
import type {EntryTemplateSource} from '../components/AccountingTemplateWorkspace';
export const AccountingWindowId=createContext<string|null>(null);
export const useAccountingWindowId=()=>useContext(AccountingWindowId);
export function mayCloseAccountingWindow(event:Event,id:string|null){
 const scope=(event as CustomEvent<{windowId?:string}>).detail?.windowId;
 return !scope||scope===id;
}

export type AccountingPieceRequest={entryId?:string;entryNumber:string;reverse?:boolean;selectTemplateLines?:boolean;templateSelectionRequest?:number};
export type AccountingWorkActions={openPiece:(request:AccountingPieceRequest)=>void;openAccount:(code:string)=>void;openPlanImport:()=>void;openEntry:(journal:string,showTemplates?:boolean)=>void;openTemplate:(source:EntryTemplateSource)=>void;refresh:()=>void;revision:number};
export const AccountingWorkContext=createContext<AccountingWorkActions|null>(null);
export const useAccountingWork=()=>useContext(AccountingWorkContext);

// null outside the accounting desktop; false for reduced/hidden windows.
export const AccountingWindowVisible=createContext<boolean|null>(null);
export const useAccountingWindowVisible=()=>useContext(AccountingWindowVisible);
