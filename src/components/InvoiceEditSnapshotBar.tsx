import {useState} from 'react';
import {RefreshCw} from './Icons';
export function InvoiceEditSnapshotBar({state,document='facture'}:{document?:'facture'|'devis';state:{checking:boolean;conflict:boolean;error:string;reload:()=>void;retry:()=>void}}){
 const [confirm,setConfirm]=useState(false);
 if(!state.error&&!state.checking)return null;
 return <div className="waarwi-edit-bar" role="status"><div className="waarwi-edit-main"><div><strong>{state.checking?('Chargement '+(document==='devis'?'du devis':'de la facture')):state.conflict?'Version à vérifier':'Accès indisponible'}</strong><p>{state.error||'Vérification de la version enregistrée…'}</p></div></div>{state.conflict?<div className="waarwi-edit-actions">{confirm?<><span className="text-xs">Remplacer le brouillon par la version enregistrée ?</span><button type="button" className="btn-secondary" onClick={()=>setConfirm(false)}>Annuler</button><button type="button" className="btn-primary" onClick={()=>{setConfirm(false);state.reload();}}>Confirmer</button></>:<button type="button" className="btn-secondary" onClick={()=>setConfirm(true)}><RefreshCw size={14}/>{document==='devis'?'Recharger le devis':'Recharger la facture'}</button>}</div>:state.error?<button type="button" className="btn-secondary" onClick={state.retry}><RefreshCw size={14}/>Réessayer</button>:null}</div>;
}
