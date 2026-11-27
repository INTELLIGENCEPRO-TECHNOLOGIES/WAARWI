import { useState } from 'react';
import './document-edit-lease.css';

type Props = {
  document?: 'facture' | 'devis';
  state: {
    checking: boolean;
    conflict: boolean;
    error: string;
    reload: () => void;
    retry: () => void;
  };
};

export function InvoiceEditSnapshotBar({ state, document = 'facture' }: Props) {
  const [confirm, setConfirm] = useState(false);
  if (!state.error && !state.checking) return null;

  return (
    <div className="waarwi-edit-bar waarwi-edit-snapshot">
      <div className="waarwi-edit-main" role="status">
        <div className="waarwi-edit-copy">
          <strong>{state.checking ? 'Vérification de la version…' : state.conflict ? 'Version à vérifier' : 'Chargement indisponible'}</strong>
          {state.error && <p>{state.error}</p>}
        </div>
      </div>
      {!state.checking && (
        <div className="waarwi-edit-actions">
          {state.conflict ? (
            <button type="button" className="btn-secondary" onClick={() => setConfirm(true)}>
              {document === 'devis' ? 'Recharger le devis' : 'Recharger la facture'}
            </button>
          ) : <button type="button" className="btn-secondary" onClick={state.retry}>Réessayer</button>}
        </div>
      )}
      {state.conflict && confirm && (
        <div className="waarwi-edit-confirm">
          <span>Remplacer le brouillon par la version enregistrée ?</span>
          <button type="button" className="btn-secondary" onClick={() => setConfirm(false)}>Annuler</button>
          <button type="button" className="btn-primary" onClick={() => { setConfirm(false); state.reload(); }}>Confirmer</button>
        </div>
      )}
    </div>
  );
}
