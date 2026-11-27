import { useEffect, useState } from 'react';
import { Check, Lock } from './Icons';
import type { DocumentEditLease } from '../lib/useDocumentEditLease';
import './document-edit-lease.css';

type Props = {
  lease: DocumentEditLease;
  dirty: boolean;
  saving: boolean;
  label: string;
  onSaveAndRelease?: () => void;
};

export function DocumentEditLeaseBar({ lease, dirty, saving, label, onSaveAndRelease }: Props) {
  const result = lease.result;
  const requestPending = result?.request_state === 'pending';
  const requestDeclined = result?.request_state === 'declined';
  const [confirmRelease, setConfirmRelease] = useState(false);
  useEffect(() => setConfirmRelease(false), [lease.token]);

  let title = 'Modification protégée';
  let detail: string | undefined;
  if (lease.error) {
    title = 'Accès indisponible';
    detail = 'Impossible d’enregistrer pour le moment.';
  } else if (lease.checking) {
    title = 'Vérification de l’accès…';
  } else if (lease.held) {
    title = requestPending ? 'Demande de libération' : 'Modification active';
    if (requestPending) detail = `${result?.requester_name || 'Un utilisateur'} demande à reprendre ${label}.`;
  } else if (lease.released) {
    title = 'Accès libéré';
  } else if (result?.state === 'busy') {
    title = requestPending ? 'Demande envoyée' : 'Modification en cours';
    detail = requestDeclined
      ? 'Le titulaire travaille encore sur ce document.'
      : `${result.owner_name || 'Un utilisateur'} utilise ${label}.`;
  } else if (result?.state === 'expired') {
    title = 'Accès expiré';
  }
  const seconds = requestPending && result?.requested_at
    ? Math.max(0, 60 - Math.floor((lease.now - Date.parse(result.requested_at)) / 1000))
    : 0;
  const canRequest = result?.state === 'busy' && !requestPending && !requestDeclined;
  const canAcquire = !requestPending || result?.state === 'free' || result?.state === 'expired';

  return (
    <aside className="waarwi-edit-bar" aria-label="Accès à la modification">
      <div className="waarwi-edit-main">
        <span className="waarwi-edit-icon" aria-hidden="true">
          {lease.held ? <Check size={16} /> : <Lock size={16} />}
        </span>
        <div className="waarwi-edit-copy" aria-live="polite">
          <strong>{title}</strong>
          {detail && <p>{detail}</p>}
          {!lease.held && dirty && <p>Brouillon conservé dans cette fenêtre.</p>}
        </div>
        {requestPending && <span className="waarwi-edit-countdown" title="Délai de réponse">
          {seconds > 0 ? `${seconds} s` : 'Délai écoulé'}
        </span>}
      </div>
      <div className="waarwi-edit-actions">
        {lease.error ? (
          <button type="button" className="btn-secondary" onClick={() => void lease.action('status')}>Réessayer</button>
        ) : lease.held ? (
          <>
            {requestPending && <button type="button" className="btn-secondary" disabled={saving} onClick={() => void lease.action('decline')}>Je travaille encore</button>}
            {requestPending && onSaveAndRelease && <button type="button" className="btn-primary" disabled={saving} onClick={onSaveAndRelease}>Enregistrer et libérer</button>}
            <button type="button" className="btn-secondary" disabled={saving} onClick={() => dirty ? setConfirmRelease(true) : void lease.action('release')}>
              {dirty ? 'Libérer sans enregistrer' : 'Libérer'}
            </button>
          </>
        ) : !lease.checking && (
          <>
            {canRequest ? <button type="button" className="btn-primary" onClick={() => void lease.action('request')}>Demander la libération</button>
              : result?.can_takeover ? <button type="button" className="btn-primary" onClick={() => void lease.action('takeover')}>Reprendre l’accès</button>
              : canAcquire && <button type="button" className="btn-secondary" onClick={() => void lease.action('acquire')}>Reprendre l’accès</button>}
          </>
        )}
      </div>
      {confirmRelease && lease.held && dirty && (
        <div className="waarwi-edit-confirm">
          <span>Le brouillon restera dans cette fenêtre.</span>
          <button className="btn-secondary" type="button" onClick={() => setConfirmRelease(false)}>Annuler</button>
          <button className="btn-primary" type="button" disabled={saving} onClick={() => { setConfirmRelease(false); void lease.action('release'); }}>Confirmer la libération</button>
        </div>
      )}
    </aside>
  );
}
