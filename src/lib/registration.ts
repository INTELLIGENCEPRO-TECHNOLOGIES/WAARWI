import { supabase } from './supabase';

export type RegistrationRequest = {
  email: string;
  company: string;
  city: string;
  address: string;
  activity: string;
  otherActivity: string;
  fullName: string;
  phone: string;
  position: string;
  plan: string;
  cycle: 'monthly' | 'yearly';
};

const draftKey = 'waarwi:registration-email-confirmation';

export function saveRegistrationDraft(request: RegistrationRequest) {
  try { localStorage.setItem(draftKey, JSON.stringify({ request, savedAt: Date.now() })); } catch { /* storage unavailable */ }
}

export function loadRegistrationDraft(email: string | undefined): RegistrationRequest | undefined {
  try {
    const raw = localStorage.getItem(draftKey);
    if (!raw) return;
    const { request, savedAt } = JSON.parse(raw);
    if (Date.now() - savedAt > 24 * 60 * 60 * 1000) {
      localStorage.removeItem(draftKey);
      return;
    }
    if (email && request?.email === email.toLowerCase()) return request;
  } catch { /* invalid or unavailable draft */ }
}

export function clearRegistrationDraft() {
  try { localStorage.removeItem(draftKey); } catch { /* storage unavailable */ }
}

export async function registerCompany(request: RegistrationRequest, password: string, termsVersion: string) {
  const { data: current } = await supabase.auth.getSession();
  let session = current.session;
  if (!session) {
    const returnURL = new URL('/login?mode=register', window.location.origin);
    const { data, error } = await supabase.auth.signUp({
      email: request.email, password, options: { emailRedirectTo: returnURL.toString() },
    });
    if (error?.code === 'user_already_exists' || error?.message.toLowerCase().includes('already registered')) {
      const login = await supabase.auth.signInWithPassword({ email: request.email, password });
      if (login.error) throw login.error;
      session = login.data.session;
    } else {
      if (error) throw error;
      session = data.session;
    }
    if (!session) {
      saveRegistrationDraft(request);
      return { awaitingEmail: true } as const;
    }
  }

  if (session.user.email?.toLowerCase() !== request.email) {
    throw new Error('Cette session correspond à une autre adresse e-mail. Déconnectez-vous pour poursuivre.');
  }

  const { data, error } = await supabase.rpc('register_waarwi_company', {
    p_company_name: request.company.trim(),
    p_activity_type_id: request.activity === '__other__' ? null : request.activity,
    p_other_activity: request.activity === '__other__' ? request.otherActivity.trim() : '',
    p_city: request.city.trim(),
    p_address: request.address.trim(),
    p_user_full_name: request.fullName.trim(),
    p_whatsapp_phone: request.phone.replace(/[\s.()-]/g, ''),
    p_responsible_title: request.position.trim(),
    p_plan: request.plan,
    p_cycle: request.cycle,
    p_terms_accepted: true,
    p_terms_version: termsVersion,
  });

  if (error) throw error;
  clearRegistrationDraft();
  if (data.created) {
    void supabase.functions.invoke('send-notification-email', {
      body: { type: 'new_signup', tenant_id: data.tenant_id },
    }).catch(() => {});
  }
  return { tenantId: data.tenant_id as string } as const;
}

export async function getTermsVersion(content: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function registrationError(cause: unknown) {
  const error = cause as { code?: string; message?: string };
  if (error.code === 'weak_password') return 'Choisissez un mot de passe accepté par Waarwi.';
  if (error.code === 'over_email_send_rate_limit') return 'Veuillez patienter avant de demander un nouvel e-mail.';
  if (error.code === 'invalid_credentials') return 'Cette adresse est déjà utilisée. Vérifiez le mot de passe ou accédez à la connexion.';
  return error.message || 'Impossible de poursuivre l’inscription. Réessayez.';
}
