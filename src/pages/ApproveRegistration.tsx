import { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { RegistrationLayout } from './RegistrationLayout';

type Approval =
  | { status: 'loading' }
  | { status: 'success'; company?: string }
  | { status: 'error'; message: string };

export function ApproveRegistration({ token }: { token: string }) {
  const [approval, setApproval] = useState<Approval>({ status: 'loading' });
  const requestedToken = useRef<string>();

  useEffect(() => {
    if (requestedToken.current === token) return;
    requestedToken.current = token;

    void (async () => {
      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action: 'auto_approve_by_token', token }),
        });
        const data = await response.json();
        if (requestedToken.current !== token) return;
        if (response.ok && data.success === true) {
          setApproval({ status: 'success', company: data.tenant_name });
        } else {
          setApproval({
            status: 'error',
            message: data.error || 'Ce lien est invalide ou cette inscription a déjà été traitée.',
          });
        }
      } catch {
        if (requestedToken.current === token) {
          setApproval({ status: 'error', message: 'La connexion à Waarwi a échoué.' });
        }
      }
    })();
  }, [token]);

  const title = approval.status === 'success'
    ? 'Inscription validée'
    : approval.status === 'error' ? 'Approbation impossible' : 'Approbation en cours';

  return (
    <RegistrationLayout
      steps={['Demande reçue', 'Validation']}
      activeStep={1}
      title={title}
      description={approval.status === 'success' ? 'L’entreprise peut maintenant se connecter à son espace Waarwi.' : undefined}
      headerAction={null}
    >
      <div className="registration-stage">
        <div className="registration-stage-content" aria-live="polite" aria-busy={approval.status === 'loading'}>
          {approval.status === 'loading' && <p>Vérification de la demande…</p>}
          {approval.status === 'success' && (
            <dl className="registration-approval-details">
              {approval.company && <div><dt>Entreprise</dt><dd>{approval.company}</dd></div>}
              <div><dt>Statut du compte</dt><dd>Actif</dd></div>
            </dl>
          )}
          {approval.status === 'error' && <p role="alert">{approval.message}</p>}
        </div>
        {approval.status !== 'loading' && (
          <div className="registration-stage-footer">
            <div className="registration-actions registration-approval-actions">
              <a href="/" className="registration-primary">
                Ouvrir la console Waarwi<ArrowRight size={17} aria-hidden="true" />
              </a>
            </div>
          </div>
        )}
      </div>
    </RegistrationLayout>
  );
}
