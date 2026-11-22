import { useEffect, useRef, useState, type FormEvent, type InputHTMLAttributes } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Eye, EyeOff } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Modal } from '../components/Modal';
import { SubscriptionPaymentPanel, useCanPaySubscription } from '../components/SubscriptionPaymentPanel';
import { formatFCFA } from '../lib/format';
import { renderMarkdown } from '../lib/markdown';
import { clearRegistrationDraft, getTermsVersion, loadRegistrationDraft, registerCompany, registrationError, type RegistrationRequest } from '../lib/registration';
import { supabase } from '../lib/supabase';
import { RegistrationLayout } from './RegistrationLayout';

const steps = ['Entreprise', 'Compte', 'Offre', 'Paiement'] as const;
const stepTitles = ['Votre entreprise', 'Votre compte administrateur', 'Choisissez votre offre', 'Paiement de l’abonnement'];
const stepDescriptions = [
  'Renseignez votre entreprise et son activité.',
  'Renseignez vos coordonnées de connexion.',
  'Choisissez votre plan et consultez les conditions.',
  '',
];

type Activity = { id: string; name: string };
type Plan = { code: string; name: string; description: string; price_monthly: number; price_yearly: number; trial_days: number };
type Terms = { markdown: string; version: string };

function isFreePlan(plan: Plan, cycle: RegistrationRequest['cycle']) {
  return Number(cycle === 'yearly' ? plan.price_yearly : plan.price_monthly) === 0;
}

function RegistrationField({ label, optional, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; optional?: boolean }) {
  return (
    <label className="registration-field">
      <span>{label}{optional && <small>Facultatif</small>}</span>
      <input {...props} />
    </label>
  );
}

function PlanPrice({ plan, cycle }: { plan: Plan; cycle: RegistrationRequest['cycle'] }) {
  const amount = Number(cycle === 'yearly' ? plan.price_yearly : plan.price_monthly);
  return amount > 0
    ? <>{formatFCFA(amount)} <small>/ {cycle === 'yearly' ? 'an' : 'mois'}</small></>
    : <>Gratuit{plan.trial_days > 0 && <small> · {plan.trial_days} jours</small>}</>;
}

export function Registration({ onExit, onRegistered, paymentId, resumePayment }: {
  onExit: () => void; onRegistered: (tenantId: string) => void; paymentId?: string; resumePayment: boolean;
}) {
  const { user, tenant, refresh, signOut } = useApp();
  const canPay = useCanPaySubscription();
  const [startingDraft] = useState(() => loadRegistrationDraft(user?.email));
  const [request, setRequest] = useState<RegistrationRequest>(() => startingDraft ?? ({
    company: '', city: '', address: '', activity: '', otherActivity: '',
    fullName: '', phone: '', position: '', email: user?.email.toLowerCase() ?? '', plan: '', cycle: 'monthly',
  }));
  const [step, setStep] = useState(resumePayment ? 3 : startingDraft ? 2 : 0);
  const [password, setPassword] = useState('');
  const [visiblePassword, setVisiblePassword] = useState(false);
  const [activities, setActivities] = useState<Activity[]>();
  const [plans, setPlans] = useState<Plan[]>();
  const [terms, setTerms] = useState<Terms>();
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [catalogError, setCatalogError] = useState(false);
  const [termsError, setTermsError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [awaitingEmail, setAwaitingEmail] = useState(false);
  const [registeredId, setRegisteredId] = useState<string>();
  const heading = useRef<HTMLHeadingElement>(null);
  const formContent = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const stepShown = resumePayment || registeredId ? 3 : step;
  const selectedPlan = plans?.find(plan => plan.code === request.plan);
  const activeActivity = activities?.find(activity => activity.id === request.activity);
  const activityLabel = request.activity === '__other__' ? request.otherActivity.trim() : activeActivity?.name;
  const paidPlans = plans?.filter(plan => Number(plan.price_monthly) > 0 || Number(plan.price_yearly) > 0);
  const canSelectYearly = paidPlans?.some(plan => Number(plan.price_yearly) > 0);
  const cyclePlans = plans?.filter(plan => request.cycle === 'yearly'
    ? Number(plan.price_yearly) > 0
    : Number(plan.price_monthly) > 0 || Number(plan.price_yearly) === 0);
  const trial = selectedPlan ? isFreePlan(selectedPlan, request.cycle) : tenant?.plan === 'trial';
  const canContinueToPayment = !!tenant && (!registeredId || registeredId === tenant.id);

  useEffect(() => {
    const oldTitle = document.title;
    document.title = 'Inscription | Waarwi';
    return () => { document.title = oldTitle; };
  }, []);

  useEffect(() => {
    if (stepShown === 3) return;
    let active = true;
    setCatalogError(false);
    setTermsError(false);

    void Promise.all([
      supabase.from('business_activity_types').select('id,name').eq('is_active', true).order('name'),
      supabase.from('plans').select('code,name,description,price_monthly,price_yearly,trial_days').eq('is_public', true).order('sort_order'),
    ]).then(([activityResult, planResult]) => {
      if (!active) return;
      if (activityResult.error || planResult.error || !planResult.data?.length) {
        setCatalogError(true);
        return;
      }
      setActivities(activityResult.data);
      setPlans(planResult.data);
      const linkedPlan = new URLSearchParams(window.location.search).get('plan');
      const linked = linkedPlan && planResult.data.find(plan => plan.code === linkedPlan);
      if (linked) {
        setRequest(current => current.plan ? current : {
          ...current,
          plan: linked.code,
          cycle: Number(linked.price_monthly) === 0 && Number(linked.price_yearly) > 0 ? 'yearly' : current.cycle,
        });
      }
    });

    void (async () => {
      try {
        const { data, error: cause } = await supabase.from('landing_config').select('terms_of_service').eq('id', 'default').maybeSingle();
        if (cause || !data?.terms_of_service?.trim()) throw cause || new Error();
        const version = await getTermsVersion(data.terms_of_service);
        if (active) setTerms({ markdown: data.terms_of_service, version });
      } catch {
        if (active) setTermsError(true);
      }
    })();

    return () => { active = false; };
  }, [loadAttempt, stepShown === 3]);

  // Verification may complete in another tab while this screen remains open.
  useEffect(() => {
    if (!awaitingEmail || user?.email.toLowerCase() !== request.email.toLowerCase()) return;
    setAwaitingEmail(false);
    setTermsAccepted(false);
    setError('');
  }, [awaitingEmail, user?.email, request.email]);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    if (formContent.current) formContent.current.scrollTop = 0;
    window.scrollTo(0, 0);
  }, [stepShown, awaitingEmail]);

  function update<K extends keyof RegistrationRequest>(field: K, value: RegistrationRequest[K]) {
    setRequest(current => ({ ...current, [field]: value }));
    setError('');
  }

  function goTo(next: number) {
    setError('');
    setStep(next);
  }

  function chooseCycle(cycle: RegistrationRequest['cycle']) {
    const yearlyPrice = Number(selectedPlan?.price_yearly ?? 0);
    const staysAvailable = cycle === 'yearly' ? yearlyPrice > 0 : Number(selectedPlan?.price_monthly ?? 0) > 0 || yearlyPrice === 0;
    setRequest(current => ({ ...current, cycle, plan: staysAvailable ? current.plan : '' }));
    setError('');
  }

  async function next(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;

    if (step === 0) {
      if (request.company.trim().length < 2) { setError('Saisissez le nom de votre entreprise.'); return; }
      if (!activeActivity && request.activity !== '__other__') { setError('Cochez l’activité principale de votre entreprise.'); return; }
      if (request.activity === '__other__' && request.otherActivity.trim().length < 2) { setError('Précisez votre activité.'); return; }
      goTo(1);
      return;
    }

    if (step === 1) {
      if (request.fullName.trim().length < 2) { setError('Saisissez le nom complet du responsable.'); return; }
      if (!/^\+?\d{8,15}$/.test(request.phone.replace(/[\s.()-]/g, ''))) { setError('Saisissez un numéro WhatsApp valide.'); return; }
      goTo(2);
      return;
    }

    if (!cyclePlans?.some(plan => plan.code === request.plan)) { setError('Choisissez une offre pour continuer.'); return; }
    if (!terms || !termsAccepted) { setError('Acceptez les conditions générales d’utilisation pour continuer.'); return; }

    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const email = (user?.email || request.email).trim().toLowerCase();
      const result = await registerCompany({ ...request, email }, password, terms.version);
      setPassword('');
      if (result.awaitingEmail) {
        setAwaitingEmail(true);
      } else {
        setRegisteredId(result.tenantId);
        onRegistered(result.tenantId);
        await refresh();
      }
    } catch (cause) {
      setError(registrationError(cause));
      if ((cause as { code?: string }).code === 'WR001') {
        setTerms(undefined);
        setTermsAccepted(false);
        setLoadAttempt(value => value + 1);
      }
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }

  const title = awaitingEmail ? 'Confirmez votre adresse e-mail' : trial && stepShown === 3 ? 'Votre demande a été envoyée' : stepTitles[stepShown];
  const termsArticle = terms && renderMarkdown(terms.markdown.replace(/^\s*#\s+[^\n]+\r?\n/, ''));

  return (
    <>
      <RegistrationLayout steps={steps} activeStep={stepShown} title={title}
        description={stepShown < 3 && !awaitingEmail ? stepDescriptions[stepShown] : undefined}
        headingRef={heading}
        headerAction={
          <button type="button" onClick={onExit} className="registration-link" disabled={busy}>
            {stepShown === 3 ? 'Quitter l’inscription' : 'Se connecter'}<ArrowUpRight size={15} aria-hidden="true" />
          </button>
        }
        summary={(request.company.trim() || tenant?.name || selectedPlan) && (
          <dl className="registration-summary">
            {(request.company.trim() || tenant?.name) && <div><dt>Entreprise</dt><dd>{request.company.trim() || tenant?.name}</dd></div>}
            {activityLabel && <div><dt>Activité</dt><dd>{activityLabel}</dd></div>}
            {selectedPlan && <div><dt>Offre</dt><dd>{selectedPlan.name} <span><PlanPrice plan={selectedPlan} cycle={request.cycle} /></span></dd></div>}
          </dl>
        )}
      >
        {stepShown === 3 ? (
          <div className="registration-stage">
            <div className="registration-stage-content">
              <div className="registration-payment">
                <p role="status">
                  {tenant?.approval_status === 'approved'
                    ? 'Votre espace Waarwi est actif.'
                    : 'Votre demande est en cours de validation par l’équipe Waarwi.'}
                </p>
                {canContinueToPayment && canPay && (!trial || paymentId) && (
                  <SubscriptionPaymentPanel paymentId={paymentId} inDialog />
                )}
                {!canContinueToPayment && (busy
                  ? <p role="status">Chargement de votre espace…</p>
                  : <button type="button" className="registration-link" onClick={() => void refresh()}>Charger mon espace</button>)}
              </div>
            </div>
            <div className="registration-stage-footer">
              <div className="registration-actions">
                <button type="button" className="registration-primary" onClick={onExit} disabled={!canContinueToPayment}>
                  {tenant?.approval_status === 'approved' ? 'Accéder à mon espace' : 'Suivre ma demande'}<ArrowRight size={17} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        ) : awaitingEmail ? (
          <div className="registration-stage">
            <div className="registration-stage-content">
              <div className="registration-payment">
                <p>Ouvrez le lien envoyé à <strong>{request.email}</strong> pour reprendre l’inscription.</p>
              </div>
            </div>
            <div className="registration-stage-footer">
              <div className="registration-actions">
                <button type="button" className="registration-link" onClick={() => { clearRegistrationDraft(); setAwaitingEmail(false); goTo(1); }}>
                  <ArrowLeft size={17} aria-hidden="true" />Modifier mon adresse e-mail
                </button>
              </div>
            </div>
          </div>
        ) : (
          <form className="registration-stage" onSubmit={next}>
            <div className="registration-stage-content" ref={formContent}>
              {step === 0 && (
                <>
                  <div className="registration-fields registration-company">
                    <RegistrationField name="company" label="Nom de l’entreprise" value={request.company} onChange={event => update('company', event.target.value)} required minLength={2} maxLength={160} autoComplete="organization" />
                    <RegistrationField name="city" label="Ville" value={request.city} onChange={event => update('city', event.target.value)} optional maxLength={100} autoComplete="address-level2" />
                    <RegistrationField name="address" label="Adresse" value={request.address} onChange={event => update('address', event.target.value)} optional maxLength={250} autoComplete="street-address" />
                  </div>
                  <fieldset className="registration-fieldset">
                    <legend>Activité principale <span aria-hidden="true">*</span></legend>
                    {activities ? (
                      <>
                        <div className="registration-activities">
                          {activities.map(activity => (
                            <label key={activity.id} className="registration-choice">
                              <input type="checkbox" name="activity" checked={request.activity === activity.id}
                                onChange={event => update('activity', event.target.checked ? activity.id : '')} />
                              <span>{activity.name}</span>
                            </label>
                          ))}
                        </div>
                        <div className="registration-other">
                          <label className="registration-choice">
                            <input type="checkbox" name="activity" checked={request.activity === '__other__'}
                              onChange={event => update('activity', event.target.checked ? '__other__' : '')} />
                            <span>Autre activité</span>
                          </label>
                          {request.activity === '__other__' && (
                            <RegistrationField name="otherActivity" label="Précisez l’activité" value={request.otherActivity} onChange={event => update('otherActivity', event.target.value)} required minLength={2} maxLength={160} />
                          )}
                        </div>
                      </>
                    ) : !catalogError && <p role="status">Chargement des activités…</p>}
                  </fieldset>
                </>
              )}

              {step === 1 && (
                <div className="registration-fields">
                  <RegistrationField name="fullName" label="Nom et prénom" value={request.fullName} onChange={event => update('fullName', event.target.value)} minLength={2} maxLength={160} required autoComplete="name" />
                  <RegistrationField name="position" label="Fonction" value={request.position} onChange={event => update('position', event.target.value)} optional maxLength={100} autoComplete="organization-title" />
                  <RegistrationField name="phone" type="tel" label="Numéro WhatsApp" value={request.phone} onChange={event => update('phone', event.target.value)} maxLength={28} required autoComplete="tel" placeholder="+221" />
                  <RegistrationField name="email" type="email" label="Adresse e-mail" value={user?.email || request.email} onChange={event => update('email', event.target.value)} readOnly={!!user} required maxLength={254} autoComplete="email" />
                  {!user && (
                    <div className="registration-password">
                      <RegistrationField name="password" type={visiblePassword ? 'text' : 'password'} label="Mot de passe" value={password} onChange={event => setPassword(event.target.value)} required minLength={6} autoComplete="new-password" aria-describedby="registration-password-hint" />
                      <button type="button" aria-label={visiblePassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                        onClick={() => setVisiblePassword(value => !value)}>
                        {visiblePassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                      <small id="registration-password-hint">Au moins 6 caractères.</small>
                    </div>
                  )}
                  {user && <button type="button" className="registration-link self-end justify-self-start" onClick={() => void signOut()}>Utiliser un autre compte</button>}
                </div>
              )}

              {step === 2 && (
                <>
                  {canSelectYearly && (
                    <fieldset className="registration-cycle">
                      <legend>Facturation</legend>
                      {(['monthly', 'yearly'] as const).map(cycle => (
                        <label className="registration-choice" key={cycle}>
                          <input type="radio" name="cycle" checked={request.cycle === cycle} onChange={() => chooseCycle(cycle)} disabled={busy} />
                          <span>{cycle === 'monthly' ? 'Mensuelle' : 'Annuelle'}</span>
                        </label>
                      ))}
                    </fieldset>
                  )}
                  <fieldset className="registration-fieldset registration-plans">
                    <legend>Offres disponibles</legend>
                    {cyclePlans ? cyclePlans.map(plan => (
                      <label key={plan.code} className="registration-plan">
                        <input type="radio" name="plan" value={plan.code} checked={request.plan === plan.code} disabled={busy}
                          onChange={() => update('plan', plan.code)} />
                        <span className="registration-plan-name"><strong>{plan.name}</strong>{plan.description && <small>{plan.description}</small>}</span>
                        <span className="registration-plan-price"><PlanPrice plan={plan} cycle={request.cycle} /></span>
                      </label>
                    )) : !catalogError && <p role="status">Chargement des offres…</p>}
                  </fieldset>
                  <div className="registration-consent">
                    <label className="registration-choice">
                      <input type="checkbox" name="terms" checked={termsAccepted} onChange={event => { setTermsAccepted(event.target.checked); setError(''); }}
                        required disabled={!terms || busy} />
                      <span>J’accepte les conditions générales d’utilisation.</span>
                    </label>
                    <button type="button" className="registration-link" onClick={() => setTermsOpen(true)} disabled={!terms}
                      aria-haspopup="dialog">
                      Lire les CGU<ArrowUpRight size={15} aria-hidden="true" />
                    </button>
                    {termsError && <p role="alert">Les conditions générales sont momentanément indisponibles. <button type="button" className="registration-link" onClick={() => setLoadAttempt(value => value + 1)}>Réessayer</button></p>}
                    {!terms && !termsError && <p role="status">Chargement des conditions générales…</p>}
                  </div>
                </>
              )}

              {catalogError && <p role="alert" className="registration-error">Impossible de charger les activités ou les offres. <button type="button" className="registration-link" onClick={() => setLoadAttempt(value => value + 1)}>Réessayer</button></p>}
            </div>
            <div className="registration-stage-footer">
              {error && <p role="alert" className="registration-error">{error}</p>}
              <div className="registration-actions">
                {step > 0 && <button type="button" onClick={() => goTo(step - 1)} className="registration-link" disabled={busy}>
                  <ArrowLeft size={17} aria-hidden="true" />Retour
                </button>}
                <button type="submit" className="registration-primary" disabled={busy || (step === 0 && !activities) || (step === 2 && (!plans || !terms))}>
                  {busy ? 'Envoi en cours…' : step === 2 ? 'Envoyer ma demande' : 'Continuer'}
                  <ArrowRight size={17} aria-hidden="true" />
                </button>
              </div>
            </div>
          </form>
        )}
      </RegistrationLayout>
      <Modal open={termsOpen} onClose={() => setTermsOpen(false)} title="Conditions générales d’utilisation"
        size="lg" layer="top" fullscreenMobile focusOnOpen panelClassName="registration-terms-panel"
        footer={<button type="button" onClick={() => setTermsOpen(false)} className="registration-primary">Revenir à l’inscription</button>}>
        {termsArticle && <article className="registration-terms" dangerouslySetInnerHTML={{ __html: termsArticle }} />}
      </Modal>
    </>
  );
}
