import { useRealtimeTick } from '../lib/useRealtimeData';
import { useEffect, useState } from 'react';
import { ArrowRight, LogOut } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { RegistrationLayout } from '../pages/RegistrationLayout';
import { SubscriptionPaymentPanel, useCanPaySubscription } from './SubscriptionPaymentPanel';
import { SubscriptionHistoryAccess } from './SubscriptionHistory';

const approvalSteps = ['Demande reçue', 'Vérification', 'Activation'];
const rejectedSteps = ['Demande reçue', 'Demande non validée'];

export function PendingApproval({ onEnter }: { onEnter?: () => void }) {
  const { tenant, user, signOut } = useApp();
  const canPay = useCanPaySubscription();
  const rejected = tenant?.approval_status === 'rejected';
  const planTick = useRealtimeTick(['plans']);
  const planCode = tenant?.selected_plan_code || tenant?.plan;
  const activityName = tenant?.registration_other_activity || tenant?.business_activity_type_name;
  const legacyType = !activityName && !tenant?.business_activity_type_id && tenant?.business_type !== 'generic'
    ? tenant?.business_type
    : undefined;
  const [legacyActivity, setLegacyActivity] = useState<{ code: string; name: string }>();
  const displayedActivity = activityName || (legacyActivity?.code === legacyType ? legacyActivity?.name : null);
  const [plan, setPlan] = useState<{ code: string; name: string }>();
  const planName = plan?.code === planCode ? plan?.name : null;

  useEffect(() => {
    if (!planCode) return;
    let current = true;
    void supabase.from('plans').select('name').eq('code', planCode).maybeSingle().then(({ data }) => {
      if (current && data?.name) setPlan({ code: planCode, name: data.name });
    });
    return () => { current = false; };
  }, [planCode, planTick]);

  useEffect(() => {
    if (!legacyType) return;
    let current = true;
    void supabase.from('business_activity_types').select('name,slug,legacy_business_type').then(({ data }) => {
      const match = data?.find(activity => activity.slug === legacyType)
        || data?.find(activity => activity.legacy_business_type === legacyType);
      if (current && match?.name) setLegacyActivity({ code: legacyType, name: match.name });
    });
    return () => { current = false; };
  }, [legacyType]);

  return (
    <RegistrationLayout
      steps={rejected ? rejectedSteps : approvalSteps}
      activeStep={onEnter ? 2 : 1}
      title={onEnter ? 'Inscription validée' : rejected ? 'Demande non validée' : 'Validation en cours'}
      description={onEnter ? 'Votre espace est prêt. Vous pouvez vous connecter directement.' : rejected
        ? 'Votre demande a été examinée par l’équipe Waarwi.'
        : 'L’équipe Waarwi examine votre demande et vous contactera par WhatsApp.'}
      headerAction={
        <button type="button" className="registration-link" onClick={() => void signOut()}>
          Se déconnecter<LogOut size={15} aria-hidden="true" />
        </button>
      }
    >
      <div className="registration-stage">
        <div className="registration-stage-content">
          <dl className="registration-approval-details">
            <div><dt>Entreprise</dt><dd>{tenant?.name || 'Votre entreprise'}</dd></div>
            {displayedActivity && <div><dt>Activité</dt><dd>{displayedActivity}</dd></div>}
            {planName && <div><dt>Offre</dt><dd>{planName}</dd></div>}
            {tenant?.whatsapp_phone && <div><dt>WhatsApp</dt><dd>{tenant.whatsapp_phone}</dd></div>}
          </dl>
          {onEnter && user?.email && (
            <p className="registration-approval-reason" role="status">
              Identifiant de connexion <strong>{user.email}</strong>
            </p>
          )}
          {rejected && tenant?.rejection_reason && (
            <section className="registration-approval-reason">
              <h2>Motif de la décision</h2>
              <p>{tenant.rejection_reason}</p>
            </section>
          )}
          {!onEnter && !rejected && canPay && (
            <div className="registration-payment registration-approval-payment">
              <SubscriptionPaymentPanel />
            </div>
          )}
        </div>
        <div className="registration-stage-footer">
          <div className="registration-actions registration-approval-actions">
            {!onEnter && canPay && <SubscriptionHistoryAccess />}
            <a href="tel:+221775254101" className="registration-link">Assistance Waarwi</a>
            {onEnter && (
              <button type="button" className="registration-primary" onClick={onEnter}>
                Se connecter<ArrowRight size={17} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>
    </RegistrationLayout>
  );
}
