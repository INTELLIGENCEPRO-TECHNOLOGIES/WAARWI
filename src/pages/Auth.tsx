import { useEffect, useState, useMemo, useRef } from 'react';
import {
  Loader2, Mail, Lock, Building2, User, Eye, EyeOff,
  CheckCircle2, ChevronDown, Briefcase, Package,
  Users, Phone, MapPin, Check, Star, ArrowLeft, ArrowRight, Search, Shield,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { useTenantBranding } from '../lib/tenantBranding';
import { useLoginConfig, LOGIN_ICON_MAP } from '../lib/loginConfig';
import { supabase } from '../lib/supabase';
import { Stepper } from '../components/FormPrimitives';

/* ---- Simple light loading screen ---- */
function AuthLoadingOverlay({ logoSrc, brandName }: { logoSrc: string; brandName: string }) {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#F8FAFC]">
      <img src={logoSrc} alt={brandName} className="w-[140px] h-auto object-contain mb-6" />
      <Loader2 className="w-5 h-5 animate-spin text-[#0f766e]" />
    </div>
  );
}

type BusinessActivityType = {
  id: string;
  name: string;
  slug: string;
  description: string;
  legacy_business_type: string;
  is_active: boolean;
};

type Plan = {
  code: string;
  name: string;
  description: string;
  price_monthly: number;
  price_yearly: number;
  limits: Record<string, any>;
  features: string[];
  trial_days: number;
  is_public: boolean;
  sort_order: number;
};

/* ---- Registration sub-components ---- */

function RegInput({ icon: Icon, label, value, onChange, placeholder, type = 'text', required, hint }: {
  icon: any; label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; required?: boolean; hint?: string;
}) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      <div className="relative">
        <Icon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          required={required}
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full h-[48px] md:h-[50px] pl-10 pr-4 rounded-[10px] bg-white border border-[#dbe3ef] text-slate-900 placeholder-slate-400
            focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900
            hover:border-slate-300 transition-all text-[15px]"
        />
      </div>
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

function ActivityTypeSelect({ activityTypes, value, onChange }: {
  activityTypes: BusinessActivityType[]; value: string; onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const allOptions = useMemo(() => [
    ...activityTypes.map(t => ({ id: t.id, slug: t.slug, name: t.name })),
    { id: '__other__', slug: '__other__', name: 'Autre activité' },
  ], [activityTypes]);

  const filtered = useMemo(() => {
    if (!search.trim()) return allOptions;
    const q = search.toLowerCase();
    return allOptions.filter(o => o.name.toLowerCase().includes(q));
  }, [search, allOptions]);

  const selectedLabel = allOptions.find(o => o.slug === value)?.name || 'Sélectionner...';

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
        Type d'activité<span className="text-red-400 ml-0.5">*</span>
      </label>
      <button
        type="button"
        onClick={() => { setOpen(!open); setSearch(''); }}
        className="w-full h-[48px] md:h-[50px] pl-4 pr-10 rounded-[10px] bg-white border border-[#dbe3ef] text-left text-[15px] text-slate-900
          focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900
          hover:border-slate-300 transition-all cursor-pointer"
      >
        {selectedLabel}
        <ChevronDown className={`absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-[#e2e8f0] rounded-xl shadow-[0_8px_24px_rgba(15,23,42,0.08)] overflow-hidden">
          <div className="p-2 border-b border-[#f1f5f9]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Rechercher..."
                className="w-full h-[36px] pl-8 pr-3 rounded-lg bg-[#f8fafc] border border-[#e2e8f0] text-[13px] text-slate-900 placeholder-slate-400
                  focus:outline-none focus:ring-1 focus:ring-slate-900/10 focus:border-slate-300"
              />
            </div>
          </div>
          <div className="max-h-[200px] overflow-y-auto py-1">
            {filtered.length === 0 && (
              <p className="text-center text-[13px] text-slate-400 py-3">Aucun résultat</p>
            )}
            {filtered.map(opt => (
              <button
                key={opt.id}
                type="button"
                onClick={() => { onChange(opt.slug); setOpen(false); setSearch(''); }}
                className={`w-full text-left px-4 py-2.5 text-[14px] transition-colors flex items-center justify-between
                  ${opt.slug === value ? 'bg-[#f8fafc] text-[#0f172a] font-medium' : 'text-slate-700 hover:bg-[#f8fafc]'}`}
              >
                {opt.name}
                {opt.slug === value && <Check className="w-3.5 h-3.5 text-[#0f172a]" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RegPassword({ value, onChange, show, toggleShow, placeholder, label }: {
  value: string; onChange: (v: string) => void; show: boolean; toggleShow: () => void; placeholder: string; label?: string;
}) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
        {label || 'Mot de passe'}<span className="text-red-400 ml-0.5">*</span>
      </label>
      <div className="relative">
        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          required
          type={show ? 'text' : 'password'}
          minLength={6}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full h-[48px] md:h-[50px] pl-10 pr-10 rounded-[10px] bg-white border border-[#dbe3ef] text-slate-900 placeholder-slate-400
            focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900
            hover:border-slate-300 transition-all text-[15px]"
        />
        <button type="button" onClick={toggleShow} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}



function PlanCard({ plan, selected, onSelect, popular, billingCycle = 'monthly' }: { plan: Plan; selected: boolean; onSelect: () => void; popular?: boolean; billingCycle?: 'monthly' | 'yearly' }) {
  const limits = plan.limits || {};
  const isYearly = billingCycle === 'yearly';
  const price = isYearly ? plan.price_yearly : plan.price_monthly;
  const monthlyEquivalent = isYearly && plan.price_yearly > 0 ? Math.round(plan.price_yearly / 12) : null;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`relative text-left w-full rounded-2xl border-2 p-4 transition-all ${
        selected
          ? 'border-slate-900 bg-slate-50 shadow-lg'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-md'
      }`}
    >
      {popular && (
        <span className="absolute -top-2.5 left-4 text-[9px] font-bold bg-slate-900 text-white px-2.5 py-0.5 rounded-full uppercase tracking-wider inline-flex items-center gap-1">
          <Star className="w-2.5 h-2.5" />Recommandé
        </span>
      )}
      {selected && (
        <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-slate-900 flex items-center justify-center">
          <Check className="w-3 h-3 text-white" />
        </div>
      )}
      <h3 className="text-base font-bold text-slate-900">{plan.name}</h3>
      {plan.description && <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{plan.description}</p>}
      <div className="mt-2 mb-3">
        {isYearly ? (
          <>
            <span className="text-xl font-extrabold text-slate-900">{price > 0 ? `${Number(price).toLocaleString('fr-FR')}` : 'Gratuit'}</span>
            {price > 0 && <span className="text-xs text-slate-500 ml-1">FCFA/an</span>}
            {monthlyEquivalent && <span className="block text-[11px] text-slate-500 mt-0.5">soit {monthlyEquivalent.toLocaleString('fr-FR')} FCFA/mois</span>}
          </>
        ) : (
          <>
            <span className="text-xl font-extrabold text-slate-900">{price > 0 ? `${Number(price).toLocaleString('fr-FR')}` : 'Gratuit'}</span>
            {price > 0 && <span className="text-xs text-slate-500 ml-1">FCFA/mois</span>}
          </>
        )}
        {plan.trial_days > 0 && (
          <span className="ml-2 text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">{plan.trial_days}j d'essai</span>
        )}
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <Package className="w-3 h-3 text-slate-400" />
          <span>{limits.articles === -1 ? 'Articles illimités' : `${limits.articles || 100} articles`}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <Users className="w-3 h-3 text-slate-400" />
          <span>{limits.users === -1 ? 'Utilisateurs illimités' : `${limits.users || 2} utilisateur${(limits.users || 2) > 1 ? 's' : ''}`}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <Building2 className="w-3 h-3 text-slate-400" />
          <span>{limits.sites === -1 ? 'Magasins illimités' : `${limits.sites || 1} magasin${(limits.sites || 1) > 1 ? 's' : ''}`}</span>
        </div>
      </div>
    </button>
  );
}

/* ---- Main Auth component ---- */

export function Auth() {
  const { signIn, signUp } = useApp();
  const { error: showError } = useToast();
  const { branding } = useTenantBranding();
  const { config: loginConfig } = useLoginConfig();
  useEffect(() => { if (branding) setMode('login'); }, [branding]);
  const isTenantBranded = !!branding;
  const brandName = branding?.name || 'WAARWI';

  // Carousel state for login modules
  const [carouselSlide, setCarouselSlide] = useState(0);
  const [carouselAnim, setCarouselAnim] = useState<'in' | 'out'>('in');
  const carouselModules = loginConfig.modules;
  const carouselTotalSlides = Math.ceil(carouselModules.length / 3);
  const carouselSlideModules = carouselModules.slice(carouselSlide * 3, carouselSlide * 3 + 3);

  useEffect(() => {
    if (carouselTotalSlides <= 1) return;
    const timer = setInterval(() => {
      setCarouselAnim('out');
      setTimeout(() => {
        setCarouselSlide(prev => (prev + 1) % carouselTotalSlides);
        setCarouselAnim('in');
      }, 300);
    }, 4000);
    return () => clearInterval(timer);
  }, [carouselTotalSlides]);

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState(() => localStorage.getItem('waarwi_remember_email') || '');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(() => !!localStorage.getItem('waarwi_remember_email'));
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [responsibleTitle, setResponsibleTitle] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [customActivity, setCustomActivity] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<string>('');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [submitted, setSubmitted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [activityTypes, setActivityTypes] = useState<BusinessActivityType[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [pendingPlanCode, setPendingPlanCode] = useState<string | null>(null);
  const [step, setStep] = useState(1);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'register') setMode('register');
    const planParam = params.get('plan');
    if (planParam) setPendingPlanCode(planParam);
  }, []);

  const TOTAL_STEPS = 5;

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('business_activity_types').select('*').eq('is_active', true).order('name');
      if (data) {
        setActivityTypes(data);
        if (data.length > 0 && !businessType) setBusinessType(data[0].slug);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('plans').select('*').eq('is_public', true).order('sort_order');
      if (data) {
        setPlans(data as Plan[]);
        if (pendingPlanCode && data.some((p: any) => p.code === pendingPlanCode)) {
          setSelectedPlan(pendingPlanCode);
        } else if (data.length > 0 && !selectedPlan) {
          const pro = data.find((p: any) => p.code === 'starter');
          setSelectedPlan(pro ? pro.code : data[0].code);
        }
      }
    })();
  }, []);

  const selectedActivity = useMemo(() => {
    if (businessType === '__other__') return null;
    return activityTypes.find(t => t.slug === businessType) || null;
  }, [businessType, activityTypes]);

  const selectedActivityLabel = useMemo(() => {
    if (businessType === '__other__') return customActivity || 'Autre activité';
    return selectedActivity?.name || businessType;
  }, [businessType, selectedActivity, customActivity]);

  const selectedPlanObj = useMemo(() => plans.find(p => p.code === selectedPlan) || null, [plans, selectedPlan]);

  const isValidPhone = (phone: string) => {
    const cleaned = phone.replace(/[\s\-\.]/g, '');
    return /^(\+?\d{8,15})$/.test(cleaned);
  };

  const step1Valid = companyName.trim().length >= 2 && (businessType !== '__other__' || customActivity.trim().length >= 2);
  const step2Valid = fullName.trim().length >= 2 && isValidPhone(whatsappPhone);
  const step3Valid = !!selectedPlan;
  const step4Valid = email.includes('@') && password.length >= 6;

  const submit = async () => {
    setLoading(true);
    try {
      const typeForProvision = businessType === '__other__'
        ? 'generic'
        : (selectedActivity?.legacy_business_type || businessType);
      const activityTypeId = businessType !== '__other__' ? selectedActivity?.id : null;
      await signUp(email, password, fullName, companyName, typeForProvision, activityTypeId, {
        city,
        whatsapp_phone: whatsappPhone,
        responsible_title: responsibleTitle,
        selected_plan: selectedPlan,
        billing_cycle: billingCycle,
      });
      setSubmitted(true);
    } catch (err: any) {
      showError(err.message || 'Une erreur est survenue');
    } finally {
      setLoading(false);
    }
  };

  const loginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (rememberMe) localStorage.setItem('waarwi_remember_email', email);
      else localStorage.removeItem('waarwi_remember_email');
      await signIn(email, password);
    } catch (err: any) {
      showError(err.message || 'Une erreur est survenue');
      setLoading(false);
    }
  };

  const logoSrc = isTenantBranded && branding?.logo_url ? branding.logo_url : '/newlogo.png';

  /* ---- Render: Confirmation after signup ---- */
  if (submitted) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-5">
        <div className="w-full max-w-md p-8 text-center space-y-5">
          <div className="w-16 h-16 mx-auto rounded-full bg-emerald-50 flex items-center justify-center border border-emerald-100">
            <CheckCircle2 className="w-8 h-8 text-emerald-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#0f172a]">Demande d'inscription envoyée</h2>
            <p className="text-sm text-slate-500 leading-relaxed mt-2">
              Votre compte est en attente de validation.
              Notre équipe vous contactera par WhatsApp ou email.
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-left space-y-2">
            {[
              ['Statut', <span className="text-[11px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">En attente</span>],
              ['Plan', selectedPlanObj?.name || selectedPlan],
              ['WhatsApp', whatsappPhone],
              ['Email', email || '\u2014'],
            ].map(([k, v]) => (
              <div key={k as string} className="flex items-center justify-between">
                <span className="text-[11px] text-slate-500">{k}</span>
                <span className="text-[11px] font-bold text-slate-800">{v}</span>
              </div>
            ))}
          </div>
          <button onClick={() => { setSubmitted(false); setMode('login'); setStep(1); }}
            className="text-sm font-semibold text-[#0f172a] hover:underline underline-offset-4">
            Retour à la connexion
          </button>
        </div>
      </div>
    );
  }

  /* ---- Render: Registration multi-step (full-page, white background) ---- */
  if (mode === 'register') {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4 py-6">
        <div className="w-full max-w-[520px]">
          <div className="flex items-center justify-between mb-5">
            <img src={logoSrc} alt={brandName} className="h-7 w-auto object-contain" />
            <button onClick={() => { setMode('login'); setStep(1); }} className="text-[13px] font-medium text-slate-500 hover:text-slate-900 transition-colors">
              Se connecter
            </button>
          </div>

          <div className="space-y-5">
            <Stepper
              current={step}
              steps={[
                { label: 'Entreprise' },
                { label: 'Responsable' },
                { label: 'Plan' },
                { label: 'Compte' },
                { label: 'Récap' },
              ]}
            />

            {step === 1 && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-bold text-[#0f172a]">Votre entreprise</h3>
                  <p className="text-sm text-slate-500 mt-0.5">Parlez-nous de votre activité.</p>
                </div>
                <RegInput icon={Building2} label="Nom de l'entreprise" value={companyName} onChange={setCompanyName} required />
                <ActivityTypeSelect
                  activityTypes={activityTypes}
                  value={businessType}
                  onChange={setBusinessType}
                />
                {selectedActivity?.description && businessType !== '__other__' && (
                  <p className="-mt-2 text-[11px] text-slate-500">{selectedActivity.description}</p>
                )}
                {businessType === '__other__' && (
                  <RegInput icon={Briefcase} label="Précisez votre activité" value={customActivity} onChange={setCustomActivity} required />
                )}
                <RegInput icon={MapPin} label="Ville" value={city} onChange={setCity} />
                <RegInput icon={MapPin} label="Adresse" value={address} onChange={setAddress} hint="Optionnel" />
                <button
                  type="button"
                  disabled={!step1Valid}
                  onClick={() => setStep(2)}
                  className="w-full h-[50px] md:h-[52px] rounded-[10px] bg-[#0f172a] text-white font-semibold text-[15px]
                    hover:bg-black transition-all disabled:opacity-40 disabled:cursor-not-allowed
                    flex items-center justify-center gap-2"
                >
                  Continuer <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-bold text-[#0f172a]">Le responsable</h3>
                  <p className="text-sm text-slate-500 mt-0.5">Vos coordonnées de contact.</p>
                </div>
                <RegInput icon={User} label="Nom complet" value={fullName} onChange={setFullName} required />
                <RegInput icon={Phone} label="Numéro WhatsApp" value={whatsappPhone} onChange={setWhatsappPhone} required hint="Canal principal de communication" />
                <RegInput icon={Mail} label="Adresse email" value={email} onChange={setEmail} type="email" hint="Recommandé" />
                <RegInput icon={Briefcase} label="Fonction" value={responsibleTitle} onChange={setResponsibleTitle} hint="Optionnel" />
                <div className="flex gap-3">
                  <button type="button" onClick={() => setStep(1)}
                    className="h-[48px] md:h-[50px] px-5 rounded-[10px] border border-[#dbe3ef] bg-white text-slate-600 font-semibold hover:bg-slate-50 transition-all flex items-center gap-2">
                    <ArrowLeft className="w-4 h-4" />Retour
                  </button>
                  <button type="button" disabled={!step2Valid} onClick={() => setStep(3)}
                    className="flex-1 h-[50px] md:h-[52px] rounded-[10px] bg-[#0f172a] text-white font-semibold text-[15px]
                      hover:bg-black transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                    Continuer <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-bold text-[#0f172a]">Choisissez votre plan</h3>
                  <p className="text-sm text-slate-500 mt-0.5">Essai gratuit inclus.</p>
                </div>
                <div className="flex items-center justify-center gap-1 bg-slate-100 rounded-xl p-1 border border-slate-200">
                  <button type="button" onClick={() => setBillingCycle('monthly')}
                    className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${billingCycle === 'monthly' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                    Mensuel
                  </button>
                  <button type="button" onClick={() => setBillingCycle('yearly')}
                    className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${billingCycle === 'yearly' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                    Annuel <span className="text-[9px] font-bold text-emerald-600 ml-1">-17%</span>
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-3 max-h-[300px] overflow-y-auto pr-1">
                  {plans.map(plan => (
                    <PlanCard key={plan.code} plan={plan} selected={selectedPlan === plan.code} onSelect={() => setSelectedPlan(plan.code)} popular={plan.code === 'pro'} billingCycle={billingCycle} />
                  ))}
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setStep(2)}
                    className="h-[48px] md:h-[50px] px-5 rounded-[10px] border border-[#dbe3ef] bg-white text-slate-600 font-semibold hover:bg-slate-50 transition-all flex items-center gap-2">
                    <ArrowLeft className="w-4 h-4" />Retour
                  </button>
                  <button type="button" disabled={!step3Valid} onClick={() => setStep(4)}
                    className="flex-1 h-[50px] md:h-[52px] rounded-[10px] bg-[#0f172a] text-white font-semibold text-[15px]
                      hover:bg-black transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                    Continuer <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-bold text-[#0f172a]">Sécurisez votre compte</h3>
                  <p className="text-sm text-slate-500 mt-0.5">Créez vos identifiants.</p>
                </div>
                <RegInput icon={Mail} label="Adresse email" value={email} onChange={setEmail} type="email" required />
                <RegPassword value={password} onChange={setPassword} show={showPassword} toggleShow={() => setShowPassword(!showPassword)} placeholder="" />
                <div className="flex gap-3">
                  <button type="button" onClick={() => setStep(3)}
                    className="h-[48px] md:h-[50px] px-5 rounded-[10px] border border-[#dbe3ef] bg-white text-slate-600 font-semibold hover:bg-slate-50 transition-all flex items-center gap-2">
                    <ArrowLeft className="w-4 h-4" />Retour
                  </button>
                  <button type="button" disabled={!step4Valid} onClick={() => setStep(5)}
                    className="flex-1 h-[50px] md:h-[52px] rounded-[10px] bg-[#0f172a] text-white font-semibold text-[15px]
                      hover:bg-black transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                    Vérifier <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {step === 5 && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-bold text-[#0f172a]">Récapitulatif</h3>
                  <p className="text-sm text-slate-500 mt-0.5">Vérifiez avant de valider.</p>
                </div>
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2.5">
                  {[
                    ['Entreprise', companyName],
                    ['Activité', selectedActivityLabel],
                    ['Ville', city || '\u2014'],
                    ['Responsable', fullName],
                    ['WhatsApp', whatsappPhone],
                    ['Email', email || '\u2014'],
                    ['Plan', selectedPlanObj?.name || selectedPlan],
                    ['Cycle', billingCycle === 'yearly' ? 'Annuel' : 'Mensuel'],
                    ['Prix', (() => {
                      if (!selectedPlanObj) return 'Gratuit';
                      const p = billingCycle === 'yearly' ? selectedPlanObj.price_yearly : selectedPlanObj.price_monthly;
                      if (!p || p <= 0) return 'Gratuit';
                      return billingCycle === 'yearly'
                        ? `${Number(p).toLocaleString('fr-FR')} FCFA/an`
                        : `${Number(p).toLocaleString('fr-FR')} FCFA/mois`;
                    })()],
                    ...(selectedPlanObj?.trial_days ? [['Essai gratuit', `${selectedPlanObj.trial_days} jours`]] : []),
                  ].map(([k, v]) => (
                    <div key={k as string} className="flex items-center justify-between">
                      <span className="text-[11px] text-slate-500">{k}</span>
                      <span className="text-[11px] font-semibold text-slate-800 truncate ml-3 max-w-[60%] text-right">{v}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setStep(4)}
                    className="h-[48px] md:h-[50px] px-5 rounded-[10px] border border-[#dbe3ef] bg-white text-slate-600 font-semibold hover:bg-slate-50 transition-all flex items-center gap-2">
                    <ArrowLeft className="w-4 h-4" />Retour
                  </button>
                  <button type="button" disabled={loading} onClick={submit}
                    className="flex-1 h-[50px] md:h-[52px] rounded-[10px] bg-[#0f172a] text-white font-semibold text-[15px]
                      hover:bg-black transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Envoyer ma demande'}
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 text-center">Votre compte sera activé après validation par l'équipe Waarwi.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ---- Render: Login page ---- */
  if (loading && mode === 'login') {
    return <AuthLoadingOverlay logoSrc={logoSrc} brandName={brandName} />;
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#F8FAFC]">
      {/* Logo header (desktop only) */}
      <header className="hidden lg:block px-6 pt-8">
        <img src={logoSrc} alt={brandName} className="w-[160px] h-auto object-contain" />
      </header>

      {/* Main content */}
      <main className="flex-1 flex items-center justify-center px-3 py-8 lg:px-10">
        <div className="w-full max-w-[1060px]">
          <div className="grid items-center gap-10 lg:grid-cols-[1fr_450px] lg:gap-20">
            {/* Left: promotional (hidden on mobile) */}
            <div className="hidden lg:block max-w-[480px]">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 mb-4">
                LA PLATEFORME QUI AVANCE AVEC VOUS
              </p>
              <h1 className="text-[clamp(32px,3.8vw,48px)] leading-[1.08] tracking-[-0.035em] font-bold text-[#0f172a]">
                {loginConfig.headline}{' '}
                {loginConfig.headline_accent && (
                  <span className="text-[#0f766e]">{loginConfig.headline_accent}</span>
                )}
              </h1>
              <p className="mt-5 max-w-[400px] text-[15px] leading-[1.7] text-slate-500">
                {loginConfig.subtitle}
              </p>

              {/* Module carousel */}
              {carouselModules.length > 0 && (
                <div className="mt-8">
                  <div
                    className="grid grid-cols-3 gap-3"
                    style={{
                      opacity: carouselAnim === 'in' ? 1 : 0,
                      transform: carouselAnim === 'in' ? 'translateY(0)' : 'translateY(6px)',
                      transition: 'opacity 0.3s ease, transform 0.3s ease',
                    }}
                  >
                    {carouselSlideModules.map((m, i) => {
                      const IconC = LOGIN_ICON_MAP[m.icon] || Shield;
                      return (
                        <div key={`${carouselSlide}-${i}`} className="rounded-xl border border-slate-200/80 bg-white/60 p-3.5 hover:shadow-sm transition-shadow">
                          <div className="w-9 h-9 rounded-lg bg-[#0f766e]/8 flex items-center justify-center mb-2.5">
                            <IconC className="w-4.5 h-4.5 text-[#0f766e]" />
                          </div>
                          <p className="text-[13px] font-bold text-slate-800 leading-tight">{m.label}</p>
                          <p className="text-[11px] text-slate-400 leading-snug mt-0.5">{m.desc}</p>
                        </div>
                      );
                    })}
                  </div>
                  {carouselTotalSlides > 1 && (
                    <div className="flex items-center justify-center gap-1.5 mt-4">
                      {Array.from({ length: carouselTotalSlides }).map((_, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            setCarouselAnim('out');
                            setTimeout(() => { setCarouselSlide(i); setCarouselAnim('in'); }, 300);
                          }}
                          className={`rounded-full transition-all ${i === carouselSlide ? 'w-5 h-1.5 bg-[#0f766e]' : 'w-1.5 h-1.5 bg-slate-300 hover:bg-slate-400'}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right: login form card */}
            <div className="w-full max-w-[450px] mx-auto">
              {/* Mobile logo */}
              <div className="lg:hidden flex justify-center mb-10">
                <img src={logoSrc} alt={brandName} className="w-[150px] h-auto object-contain" />
              </div>

              <div className="bg-white rounded-[16px] border border-[#E2E8F0] shadow-[0_2px_8px_rgba(15,23,42,0.04)] p-6 sm:p-8">
                <div className="mb-6">
                  <h2 className="text-[22px] sm:text-[24px] font-bold text-[#0f172a] tracking-[-0.02em]">
                    Accédez à votre espace
                  </h2>
                  <p className="mt-1.5 text-[14px] text-slate-500">
                    Connectez-vous pour gérer votre activité.
                  </p>
                </div>

                <form onSubmit={loginSubmit} className="space-y-4">
                  {/* Email field */}
                  <div>
                    <label className="block text-[13px] font-medium text-[#0f172a] mb-1.5">
                      Adresse email
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="vous@entreprise.com"
                      className="w-full h-[52px] px-4 rounded-[11px] bg-white border border-[#E2E8F0] text-[#0f172a] text-[15px]
                        placeholder:text-slate-400
                        focus:outline-none focus:ring-2 focus:ring-[#0f766e]/20 focus:border-[#0f766e]
                        hover:border-slate-300 transition-all"
                    />
                  </div>

                  {/* Password field */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[13px] font-medium text-[#0f172a]">
                        Mot de passe
                      </label>
                      <button type="button" className="text-[12px] font-medium text-[#0f766e] hover:text-[#0d5f59] transition-colors">
                        Mot de passe oublié ?
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="Votre mot de passe"
                        className="w-full h-[52px] px-4 pr-11 rounded-[11px] bg-white border border-[#E2E8F0] text-[#0f172a] text-[15px]
                          placeholder:text-slate-400
                          focus:outline-none focus:ring-2 focus:ring-[#0f766e]/20 focus:border-[#0f766e]
                          hover:border-slate-300 transition-all"
                      />
                      <button type="button" onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                        {showPassword ? <EyeOff className="w-[18px] h-[18px]" /> : <Eye className="w-[18px] h-[18px]" />}
                      </button>
                    </div>
                  </div>

                  {/* Remember me */}
                  <label className="flex items-center gap-2.5 cursor-pointer select-none group pt-0.5">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={e => setRememberMe(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-[#0f766e] focus:ring-[#0f766e]/20 cursor-pointer"
                    />
                    <span className="text-[13px] text-slate-500 group-hover:text-slate-700 transition-colors">Se souvenir de moi</span>
                  </label>

                  {/* Submit button */}
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full h-[52px] rounded-none bg-transparent border-l-2 border-r-2 border-[#0f172a] text-[#0f172a] font-semibold text-[15px]
                      hover:bg-[#0f172a]/[0.03] active:scale-[0.99] transition-all
                      disabled:opacity-50 disabled:cursor-not-allowed
                      flex items-center justify-center gap-2"
                  >
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Se connecter'}
                  </button>
                </form>

                {/* Register link & help */}
                {!isTenantBranded && (
                  <div className="mt-5 pt-5 border-t border-[#E2E8F0] space-y-2.5 text-center">
                    <p className="text-[13px] text-slate-500">
                      Nouveau sur Waarwi ?{' '}
                      <button
                        type="button"
                        onClick={() => { setMode('register'); setStep(1); }}
                        className="font-semibold text-[#0f766e] hover:text-[#0d5f59] transition-colors"
                      >
                        Créer un compte
                      </button>
                    </p>
                    <p className="text-[12px] text-slate-400">
                      Besoin d'aide ?{' '}
                      <a
                        href="https://wa.me/221781234567"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-slate-500 hover:text-[#0f172a] transition-colors"
                      >
                        Contacter l'assistance
                      </a>
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Mini-footer */}
      <footer className="py-4 px-6 text-center lg:text-left">
        <div className="max-w-[1060px] mx-auto flex flex-col lg:flex-row lg:items-center lg:justify-between gap-1">
          <p className="text-[11px] text-slate-400">
            &copy; {new Date().getFullYear()} Waarwi &middot; Un produit IntelligencePro Technologies
          </p>
          <p className="text-[11px] text-slate-400">
            <a href="https://wa.me/221781234567" className="hover:text-slate-600 transition-colors">Assistance</a>
            {' · '}
            <a href="https://waarwi.com/confidentialite" className="hover:text-slate-600 transition-colors">Confidentialité</a>
            {' · '}
            <a href="https://waarwi.com/cgu" className="hover:text-slate-600 transition-colors">CGU</a>
            {' · '}
            <span>Conçu au Sénégal</span>
          </p>
        </div>
      </footer>
    </div>
  );
}
