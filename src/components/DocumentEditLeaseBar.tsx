import {Lock,Unlock,Clock,RefreshCw} from 'lucide-react';
import type {DocumentEditLease} from '../lib/useDocumentEditLease';
import './document-edit-lease.css';
export function DocumentEditLeaseBar({lease,dirty,saving,label}:{lease:DocumentEditLease;dirty:boolean;saving:boolean;label:string}){
 const r=lease.result,request=r?.request_state==='pending';
 const seconds=request&&r?.requested_at?Math.max(0,60-Math.floor((lease.now-Date.parse(r.requested_at))/1000)):0;
 const release=()=>{if(dirty&&!window.confirm('Libérer le document sans valider la saisie ? Le brouillon restera dans cette fenêtre, sans droit d’enregistrement.'))return;void lease.action('release');};
 const message=lease.error?'Connexion ou accès indisponible. La saisie ne peut pas être enregistrée.':lease.checking?'Vérification de l’accès…':lease.held?(request?(r?.requester_name||'Un utilisateur')+' demande à reprendre '+label+'.':'Vous disposez de l’accès en modification.'):(lease.released?'Accès libéré. Le brouillon reste dans cette fenêtre.':r?.state==='busy'?(r.owner_name||'Un utilisateur')+' utilise actuellement '+label+'.':r?.state==='expired'?'Le verrou précédent a expiré.':'Accès en modification non détenu.');
 return <aside className="waarwi-edit-bar" aria-live="polite">
  <div className="waarwi-edit-main"><span className="waarwi-edit-icon">{lease.held?<Unlock size={17}/>:<Lock size={17}/>}</span><div><strong>{lease.held?(request?'Demande de libération':'Accès en modification'):'Accès protégé'}</strong><p>{message}</p>{!lease.held&&dirty&&<p>Brouillon conservé dans cette fenêtre. Vérifiez la saisie avant de reprendre.</p>}{request&&<p className="waarwi-edit-countdown"><Clock size={13}/>{seconds>0?'Délai de réponse : '+seconds+' s':'Délai écoulé · reprise si le titulaire est inactif'}</p>}{r?.request_state==='declined'&&!lease.held&&<p>Le titulaire a indiqué qu’il travaille encore sur ce document.</p>}</div></div>
  <div className="waarwi-edit-actions">
   {lease.error?<button type="button" className="btn-secondary" onClick={()=>void lease.action('status')}><RefreshCw size={14}/>Réessayer</button>:lease.held?<>{request&&<button type="button" className="btn-secondary" disabled={saving} onClick={()=>void lease.action('decline')}>Je travaille encore</button>}<button type="button" className={request?'btn-primary':'btn-secondary'} disabled={saving} onClick={release}>Libérer</button></>:!lease.checking&&<>{r?.state==='busy'&&!request&&r.request_state!=='declined'?<button type="button" className="btn-primary" onClick={()=>void lease.action('request')}>Demander la libération</button>:r?.can_takeover?<button type="button" className="btn-primary" onClick={()=>void lease.action('takeover')}>Reprendre l’accès</button>:(!request||r?.state==='free'||r?.state==='expired')?<button type="button" className="btn-secondary" onClick={()=>void lease.action('acquire')}>Reprendre l’accès</button>:null}</>}
  </div>
 </aside>;
}
