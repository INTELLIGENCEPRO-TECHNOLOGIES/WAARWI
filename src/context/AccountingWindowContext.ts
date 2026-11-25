import {createContext,useContext} from 'react';
export const AccountingWindowId=createContext<string|null>(null);
export const useAccountingWindowId=()=>useContext(AccountingWindowId);
export function mayCloseAccountingWindow(event:Event,id:string|null){
 const scope=(event as CustomEvent<{windowId?:string}>).detail?.windowId;
 return !scope||scope===id;
}
