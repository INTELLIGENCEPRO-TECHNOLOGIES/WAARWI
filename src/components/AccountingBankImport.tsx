import {useRef,useState} from 'react';
import {bankCsv,bankRows,type BankImportMode,type BankImportRow} from '../lib/bankStatementImport.mjs';
import {Upload,Download} from './Icons';
import { SearchableSelect } from './SearchableSelect';
import { useAccountingMobile } from '../context/AccountingWindowContext';
type Props={disabled:boolean;hasRows:boolean;onImport:(rows:BankImportRow[])=>void;onBusy:(busy:boolean)=>void};
const conventions = [
 {value:'signed',label:'Montant signé (entrée + / sortie −)'},
 {value:'bank',label:'Relevé banque : débit = sortie'},
 {value:'company',label:'Comptabilité : débit = entrée'},
];
export function AccountingBankImport({disabled,hasRows,onImport,onBusy}:Props){
 const mobile = useAccountingMobile();
 const [mode,setMode]=useState<BankImportMode>('signed'),[error,setError]=useState(''),[info,setInfo]=useState(''),[busy,setBusy]=useState(false);
 const fileRef=useRef<HTMLInputElement>(null);const lock=useRef(false);
 const sample=()=>{const headers=mode==='signed'?'Date;Référence;Libellé;Montant':'Date;Référence;Libellé;Débit;Crédit';const url=URL.createObjectURL(new Blob(['\ufeff',headers+'\r\n'],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='modele-releve-bancaire.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 const read=async(file:File)=>{if(lock.current||disabled)return;if(hasRows&&!window.confirm('Remplacer les opérations déjà saisies par le fichier ?'))return;lock.current=true;setBusy(true);onBusy(true);setError('');setInfo('');
 try{if(file.size>2*1024*1024)throw Error('Fichier limité à 2 Mo.');let rows:BankImportRow[];
 if(/\.csv$/i.test(file.name))rows=bankCsv(await file.text(),mode);
 else if(/\.xlsx$/i.test(file.name)){const XLSX=await import('xlsx');const book=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true,sheetRows:502});if(book.SheetNames.length!==1)throw Error('Le fichier Excel doit contenir une seule feuille de relevé.');const sheet=book.Sheets[book.SheetNames[0]];if(!sheet)throw Error('Feuille vide.');const range=sheet['!fullref']??sheet['!ref'];if(range){const r=XLSX.utils.decode_range(range);if(r.e.r-r.s.r+1>501||r.e.c-r.s.c+1>40)throw Error('Maximum 500 opérations et 40 colonnes.');}rows=bankRows(XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,raw:true,defval:''}),mode);}
 else throw Error('Formats acceptés : CSV UTF-8 et XLSX.');
 onImport(rows);setInfo(rows.length+' opérations importées. Vérifiez les dates, les signes et le solde avant enregistrement.');
 }catch(e){setError(e instanceof Error?e.message:'Import impossible.');}finally{lock.current=false;setBusy(false);onBusy(false);if(fileRef.current)fileRef.current.value='';}};
 return <section className="acc-bank-import space-y-1">
  <div className={mobile ? 'acc-mobile-command-bar' : 'acc-toolbar'}>
   {mobile ? <SearchableSelect label="Convention du fichier" className="acc-mobile-command-wide acc-mobile-selection"
    options={conventions} value={mode} disabled={busy || disabled} searchable={false} clearable={false} wrapLabels
    onChange={value => setMode(value as BankImportMode)} /> : <>
    <label className="text-xs">Convention du fichier <select className="input" value={mode}
     disabled={busy || disabled} onChange={event => setMode(event.target.value as BankImportMode)}>
     {conventions.map(({value,label}) => <option key={value} value={value}>{label}</option>)}
    </select></label><span className="acc-spacer" />
   </>}
   <button type="button" className="btn-secondary" disabled={busy || disabled} onClick={sample}><Download size={15} />Modèle CSV</button>
   <button type="button" className="btn-secondary" disabled={busy || disabled} onClick={() => fileRef.current?.click()}>
    <Upload size={15} />{busy ? 'Lecture…' : 'Importer CSV / Excel'}
   </button>
   <input ref={fileRef} type="file" accept=".csv,.xlsx" className="sr-only" disabled={busy || disabled} onChange={event => {
    const file = event.target.files?.[0];
    if (file) void read(file);
   }} />
  </div>
  <p className="text-xs text-neutral-500">En-têtes : Date, Référence (facultative), Libellé et {mode==='signed'?'Montant':'Débit, Crédit'}. Jusqu’à 500 opérations. Les colonnes supplémentaires ne sont pas importées ; aucun solde n’est déduit du fichier.</p>
  {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
  {info && <p role="status" className="text-xs">{info}</p>}
 </section>;
}
