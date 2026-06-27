import { useEffect, useState, useMemo, useRef } from 'react';
import {
  Loader2, ArrowRight, ArrowLeft, Mail, Lock, Building2, User, Eye, EyeOff,
  CheckCircle2, ChevronDown, Briefcase, Shield, Package, Receipt, BarChart3,
  Globe, Monitor, FileText, Zap, ShoppingCart, Users, TrendingUp,
  Truck, CreditCard, Wallet, Layers, Settings, BookOpen, Phone,
  MapPin, Check, Star, MessageCircle,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { useTenantBranding } from '../lib/tenantBranding';
import { supabase } from '../lib/supabase';

const ICON_MAP: Record<string, any> = {
  Zap, Package, Receipt, Globe, BarChart3, Shield, Monitor, FileText,
  ShoppingCart, Users, Truck, CreditCard, Wallet, Layers, Settings, BookOpen,
  TrendingUp,
};

type LoginConfig = {
  headline: string;
  headline_accent: string;
  subtitle: string;
  modules: { icon: string; label: string; desc: string }[];
  login_bg_url: string | null;
};

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

/* ---- Shared UI primitives ---- */

function AuthInput({ icon: Icon, label, value, onChange, placeholder, type = 'text', required, hint }: {
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
          className="w-full h-11 pl-10 pr-4 rounded-xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400
            focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900
            hover:border-slate-300 transition-all text-sm"
        />
      </div>
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

function AuthPassword({ value, onChange, show, toggleShow, placeholder }: {
  value: string; onChange: (v: string) => void; show: boolean; toggleShow: () => void; placeholder: string;
}) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
        Mot de passe<span className="text-red-400 ml-0.5">*</span>
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
          className="w-full h-11 pl-10 pr-10 rounded-xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400
            focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900
            hover:border-slate-300 transition-all text-sm"
        />
        <button type="button" onClick={toggleShow} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

function AuthBtn({ children, loading, disabled, onClick, type = 'button', variant = 'primary' }: {
  children: React.ReactNode; loading?: boolean; disabled?: boolean;
  onClick?: () => void; type?: 'button' | 'submit'; variant?: 'primary' | 'secondary';
}) {
  if (variant === 'secondary') return (
    <button type="button" onClick={onClick}
      className="h-11 px-5 rounded-xl border border-slate-200 bg-white text-slate-600 font-medium hover:bg-slate-50 hover:border-slate-300 transition-all active:scale-[0.98] inline-flex items-center justify-center gap-2 text-sm">
      <ArrowLeft className="w-4 h-4" />{children}
    </button>
  );
  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className="w-full h-11 rounded-xl bg-slate-900 text-white font-semibold text-sm
        hover:bg-black active:scale-[0.98] transition-all
        disabled:opacity-40 disabled:cursor-not-allowed
        inline-flex items-center justify-center gap-2"
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>{children}<ArrowRight className="w-4 h-4" /></>}
    </button>
  );
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className="flex-1 h-1 rounded-full overflow-hidden bg-slate-100">
          <div
            className={`h-full rounded-full transition-all duration-500 ${i < current ? 'bg-slate-900' : ''}`}
            style={{ width: i < current ? '100%' : '0%' }}
          />
        </div>
      ))}
      <span className="text-[10px] font-bold text-slate-400 tabular-nums shrink-0">{current}/{total}</span>
    </div>
  );
}

function PlanCard({ plan, selected, onSelect, popular, billingCycle = 'monthly' }: { plan: Plan; selected: boolean; onSelect: () => void; popular?: boolean; billingCycle?: 'monthly' | 'yearly' }) {
  const limits = plan.limits || {};
  const modules: { key: string; label: string }[] = [
    { key: 'online_shop', label: 'Boutique en ligne' },
    { key: 'supplier_orders', label: 'Commandes fournisseurs' },
    { key: 'accounting', label: 'Comptabilité' },
    { key: 'has_multi_store', label: 'Multi-magasins' },
    { key: 'has_advanced_reports', label: 'Rapports avancés' },
    { key: 'has_whatsapp', label: 'WhatsApp' },
    { key: 'has_accounting_export', label: 'Export comptable' },
  ];
  const enabledModules = modules.filter(m => !!limits[m.key]);

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

      <div className="mb-2">
        <h3 className="text-base font-bold text-slate-900">{plan.name}</h3>
        {plan.description && <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{plan.description}</p>}
      </div>

      <div className="mb-3">
        {isYearly ? (
          <>
            <span className="text-xl font-extrabold text-slate-900">
              {price > 0 ? `${Number(price).toLocaleString('fr-FR')}` : 'Gratuit'}
            </span>
            {price > 0 && <span className="text-xs text-slate-500 ml-1">FCFA/an</span>}
            {monthlyEquivalent && (
              <span className="block text-[11px] text-slate-500 mt-0.5">
                soit {monthlyEquivalent.toLocaleString('fr-FR')} FCFA/mois
              </span>
            )}
          </>
        ) : (
          <>
            <span className="text-xl font-extrabold text-slate-900">
              {price > 0 ? `${Number(price).toLocaleString('fr-FR')}` : 'Gratuit'}
            </span>
            {price > 0 && <span className="text-xs text-slate-500 ml-1">FCFA/mois</span>}
          </>
        )}
        {plan.trial_days > 0 && (
          <span className="ml-2 text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
            {plan.trial_days}j d&apos;essai
          </span>
        )}
      </div>

      <div className="space-y-1.5 mb-3">
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

      {enabledModules.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {enabledModules.map(m => (
            <span key={m.key} className="text-[9px] font-medium bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
              {m.label}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

/* ---- Main Auth component ---- */

export function Auth() {
  const { signIn, signUp } = useApp();
  const { error: showError } = useToast();
  const { branding } = useTenantBranding();
  useEffect(() => { if (branding) setMode('login'); }, [branding]);
  const isTenantBranded = !!branding;
  const brandName = branding?.name || 'WAARWI';

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
  const [step, setStep] = useState(1);
  const [mounted, setMounted] = useState(false);
  const [config, setConfig] = useState<LoginConfig | null>(null);

  const TOTAL_STEPS = 5;

  useEffect(() => { setMounted(true); }, []);

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
        if (data.length > 0 && !selectedPlan) {
          const pro = data.find((p: any) => p.code === 'starter');
          setSelectedPlan(pro ? pro.code : data[0].code);
        }
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('platform_login_config').select('*').eq('id', 'default').maybeSingle();
      if (data) {
        setConfig({
          headline: data.headline || '',
          headline_accent: data.headline_accent || '',
          subtitle: data.subtitle || '',
          modules: Array.isArray(data.modules) ? data.modules : [],
          login_bg_url: data.login_bg_url || null,
        });
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
      await signIn(email, password);
    } catch (err: any) {
      showError(err.message || 'Une erreur est survenue');
    } finally {
      setLoading(false);
    }
  };

  /* ---- Features for left panel ---- */
  const allFeatures = [
    { icon: ShoppingCart, label: 'Point de vente', desc: 'Caisse rapide et intuitive' },
    { icon: Package, label: 'Stock', desc: 'Maîtrisez vos stocks' },
    { icon: FileText, label: 'Facturation', desc: 'Devis et factures pro' },
    { icon: Users, label: 'Clients & Tiers', desc: 'CRM et créances' },
    { icon: Truck, label: 'Fournisseurs', desc: 'Commandes et dettes' },
    { icon: Globe, label: 'Boutique en ligne', desc: 'Vitrine et commandes web' },
    { icon: BarChart3, label: 'Comptabilité', desc: 'Suivi financier complet' },
    { icon: TrendingUp, label: 'Rapports', desc: 'Analyses et tableaux de bord' },
    { icon: Shield, label: 'Sécurité', desc: 'Rôles et permissions' },
  ];
  const features = config?.modules?.length
    ? config.modules.map(m => ({ icon: ICON_MAP[m.icon] || Shield, label: m.label, desc: m.desc }))
    : allFeatures;

  const logoSrc = isTenantBranded && branding?.logo_url ? branding.logo_url : '/newlogo.png';

  /* ---- Render: Confirmation after signup ---- */
  if (submitted) {
    return (
      <div className="fixed inset-0 overflow-auto bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-xl p-8 text-center space-y-5">
          <div className="w-16 h-16 mx-auto rounded-full bg-emerald-50 flex items-center justify-center border border-emerald-100">
            <CheckCircle2 className="w-8 h-8 text-emerald-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Demande d'inscription envoyée</h2>
            <p className="text-sm text-slate-500 leading-relaxed mt-2">
              Votre compte Waarwi est actuellement en attente de validation.
              Notre équipe vous contactera par WhatsApp ou par email après vérification.
            </p>
          </div>

          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-left space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-500">Statut</span>
              <span className="text-[11px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">En attente de validation</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-500">Plan demandé</span>
              <span className="text-[11px] font-bold text-slate-800">{selectedPlanObj?.name || selectedPlan}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-500">Contact WhatsApp</span>
              <span className="text-[11px] font-bold text-slate-800">{whatsappPhone}</span>
            </div>
            {email && (
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-500">Email</span>
                <span className="text-[11px] font-bold text-slate-800 truncate ml-2">{email}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-500">Canal de contact principal</span>
              <span className="text-[11px] font-bold text-emerald-700 inline-flex items-center gap-1">
                <MessageCircle className="w-3 h-3" />WhatsApp
              </span>
            </div>
          </div>

          <button onClick={() => { setSubmitted(false); setMode('login'); setStep(1); }}
            className="text-sm font-semibold text-slate-900 hover:underline underline-offset-4 transition-colors">
            Retour à la connexion
          </button>
        </div>
      </div>
    );
  }

  /* ---- Render: Registration Steps ---- */
  const registerContent = (
    <div className="space-y-5">
      <StepIndicator current={step} total={TOTAL_STEPS} />

      {step === 1 && (
        <div className="space-y-4 animate-in fade-in duration-300">
          <div>
            <h3 className="text-base font-bold text-slate-900">Votre entreprise</h3>
            <p className="text-xs text-slate-500 mt-0.5">Parlez-nous de votre activité commerciale.</p>
          </div>
          <AuthInput icon={Building2} label="Nom de l'entreprise" value={companyName} onChange={setCompanyName} placeholder="Ex : Saloum Electronique" required />
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
              Type d'activité<span className="text-red-400 ml-0.5">*</span>
            </label>
            <div className="relative">
              <select
                value={businessType}
                onChange={e => setBusinessType(e.target.value)}
                className="w-full h-11 pl-4 pr-10 rounded-xl bg-white border border-slate-200 text-slate-900
                  focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900
                  hover:border-slate-300 transition-all text-sm appearance-none cursor-pointer"
              >
                {activityTypes.map(bt => (
                  <option key={bt.id} value={bt.slug}>{bt.name}</option>
                ))}
                <option value="__other__">Autre activité</option>
              </select>
              <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            </div>
            {selectedActivity?.description && businessType !== '__other__' && (
              <p className="mt-1.5 text-[11px] text-slate-500">{selectedActivity.description}</p>
            )}
          </div>
          {businessType === '__other__' && (
            <AuthInput icon={Briefcase} label="Précisez votre activité" value={customActivity} onChange={setCustomActivity} placeholder="Import/Export, Couture..." required />
          )}
          <AuthInput icon={MapPin} label="Ville" value={city} onChange={setCity} placeholder="Dakar, Thies, Saint-Louis..." />
          <AuthInput icon={MapPin} label="Adresse" value={address} onChange={setAddress} placeholder="Adresse complète (facultatif)" hint="Optionnel" />
          <AuthBtn disabled={!step1Valid} onClick={() => setStep(2)}>Continuer</AuthBtn>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4 animate-in fade-in duration-300">
          <div>
            <h3 className="text-base font-bold text-slate-900">Le responsable</h3>
            <p className="text-xs text-slate-500 mt-0.5">Vos coordonnées pour la gestion du compte.</p>
          </div>
          <AuthInput icon={User} label="Nom complet" value={fullName} onChange={setFullName} placeholder="Prénom et nom" required />
          <AuthInput icon={Phone} label="Numéro WhatsApp" value={whatsappPhone} onChange={setWhatsappPhone} placeholder="+221 77 123 45 67" required hint="Canal principal de communication" />
          <AuthInput icon={Mail} label="Adresse email" value={email} onChange={setEmail} placeholder="vous@entreprise.sn" type="email" hint="Recommandé mais non obligatoire" />
          <AuthInput icon={Briefcase} label="Fonction" value={responsibleTitle} onChange={setResponsibleTitle} placeholder="Gérant, Directeur, Responsable..." hint="Optionnel" />
          <div className="flex gap-3">
            <AuthBtn variant="secondary" onClick={() => setStep(1)}>Retour</AuthBtn>
            <div className="flex-1">
              <AuthBtn disabled={!step2Valid} onClick={() => setStep(3)}>Continuer</AuthBtn>
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4 animate-in fade-in duration-300">
          <div>
            <h3 className="text-base font-bold text-slate-900">Choisissez votre plan</h3>
            <p className="text-xs text-slate-500 mt-0.5">14 jours d'essai gratuit inclus. L'abonnement débute après la période d'essai.</p>
          </div>
          <div className="flex items-center justify-center gap-1 bg-slate-100 rounded-xl p-1 border border-slate-200">
            <button
              type="button"
              onClick={() => setBillingCycle('monthly')}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${billingCycle === 'monthly' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Mensuel
            </button>
            <button
              type="button"
              onClick={() => setBillingCycle('yearly')}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${billingCycle === 'yearly' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Annuel <span className="text-[9px] font-bold text-emerald-600 ml-1">-17%</span>
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 max-h-[40vh] overflow-y-auto pr-1">
            {plans.map(plan => (
              <PlanCard
                key={plan.code}
                plan={plan}
                selected={selectedPlan === plan.code}
                onSelect={() => setSelectedPlan(plan.code)}
                popular={plan.code === 'pro'}
                billingCycle={billingCycle}
              />
            ))}
          </div>
          <div className="flex gap-3">
            <AuthBtn variant="secondary" onClick={() => setStep(2)}>Retour</AuthBtn>
            <div className="flex-1">
              <AuthBtn disabled={!step3Valid} onClick={() => setStep(4)}>Continuer</AuthBtn>
            </div>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4 animate-in fade-in duration-300">
          <div>
            <h3 className="text-base font-bold text-slate-900">Sécurisez votre compte</h3>
            <p className="text-xs text-slate-500 mt-0.5">Créez vos identifiants de connexion.</p>
          </div>
          <AuthInput icon={Mail} label="Adresse email" value={email} onChange={setEmail} placeholder="vous@entreprise.sn" type="email" required />
          <AuthPassword value={password} onChange={setPassword} show={showPassword} toggleShow={() => setShowPassword(!showPassword)} placeholder="6 caractères minimum" />
          <div className="flex gap-3">
            <AuthBtn variant="secondary" onClick={() => setStep(3)}>Retour</AuthBtn>
            <div className="flex-1">
              <AuthBtn disabled={!step4Valid} onClick={() => setStep(5)}>Vérifier</AuthBtn>
            </div>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="space-y-4 animate-in fade-in duration-300">
          <div>
            <h3 className="text-base font-bold text-slate-900">Récapitulatif</h3>
            <p className="text-xs text-slate-500 mt-0.5">Vérifiez vos informations avant de valider.</p>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2.5">
            {[
              ['Entreprise', companyName],
              ['Activité', selectedActivityLabel],
              ['Ville', city || '—'],
              ['Responsable', fullName],
              ['WhatsApp', whatsappPhone],
              ['Email', email || '—'],
              ['Plan choisi', selectedPlanObj?.name || selectedPlan],
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
              <div key={k} className="flex items-center justify-between">
                <span className="text-[11px] text-slate-500">{k}</span>
                <span className="text-[11px] font-semibold text-slate-800 truncate ml-3 max-w-[60%] text-right">{v}</span>
              </div>
            ))}
          </div>

          {selectedPlanObj && (
            <div className="rounded-xl border border-slate-200 p-3">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Limites du plan</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-sm font-bold text-slate-900">{selectedPlanObj.limits?.articles === -1 ? '∞' : selectedPlanObj.limits?.articles || 100}</div>
                  <div className="text-[9px] text-slate-500">Articles</div>
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-900">{selectedPlanObj.limits?.users === -1 ? '∞' : selectedPlanObj.limits?.users || 2}</div>
                  <div className="text-[9px] text-slate-500">Utilisateurs</div>
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-900">{selectedPlanObj.limits?.sites === -1 ? '∞' : selectedPlanObj.limits?.sites || 1}</div>
                  <div className="text-[9px] text-slate-500">Magasins</div>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <AuthBtn variant="secondary" onClick={() => setStep(4)}>Retour</AuthBtn>
            <div className="flex-1">
              <AuthBtn loading={loading} onClick={submit}>Envoyer ma demande</AuthBtn>
            </div>
          </div>
          <p className="text-[10px] text-slate-400 text-center">Votre compte sera activé après validation par l'équipe Waarwi.</p>
        </div>
      )}
    </div>
  );

  /* ---- Render: Login form ---- */
  const loginContent = (
    <form onSubmit={loginSubmit} className="space-y-4">
      <AuthInput icon={Mail} type="email" label="Adresse email" value={email} onChange={setEmail} placeholder="votre@email.com" required />
      <AuthPassword value={password} onChange={setPassword} show={showPassword} toggleShow={() => setShowPassword(!showPassword)} placeholder="Votre mot de passe" />
      <AuthBtn loading={loading} type="submit">Se connecter</AuthBtn>
    </form>
  );

  /* ---- Render: Main layout ---- */
  return (
    <div className={`fixed inset-0 overflow-hidden bg-white transition-opacity duration-500 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
      {config?.login_bg_url && (
        <div className="absolute inset-0 z-[1]">
          <img src={config.login_bg_url} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-white/80 backdrop-blur-[2px]" />
        </div>
      )}

      {/* ---- DESKTOP ---- */}
      <div className="hidden lg:flex h-full relative z-10">
        {/* Left panel - branding */}
        <div className="flex-1 flex flex-col justify-center px-14 xl:px-20">
          <div className="w-full max-w-lg">
            <img src={logoSrc} alt={brandName} className="h-12 xl:h-14 w-auto object-contain mb-8" />
            {config?.headline ? (
              <h1 className="text-3xl xl:text-4xl font-extrabold text-slate-900 leading-[1.15] tracking-tight mb-4">
                {config.headline}
                {config.headline_accent && <> <span className="text-slate-900">{config.headline_accent}</span></>}
              </h1>
            ) : (
              <h1 className="text-3xl xl:text-4xl font-extrabold text-slate-900 leading-[1.15] tracking-tight mb-4">
                La plateforme qui simplifie,<br />connecte et propulse votre{' '}
                <span className="text-slate-900">business.</span>
              </h1>
            )}
            <p className="text-sm xl:text-base text-slate-500 leading-relaxed mb-8">
              {config?.subtitle || 'Gérez vos ventes, stocks, clients et finances depuis un seul espace, en toute sécurité.'}
            </p>
            <div className="grid grid-cols-3 gap-3">
              {features.slice(0, 6).map((f, i) => (
                <div key={i} className="rounded-xl bg-white border border-slate-200 p-3.5">
                  <f.icon className="w-4 h-4 mb-2.5 text-slate-700" strokeWidth={1.6} />
                  <p className="text-xs font-bold text-slate-800 mb-0.5">{f.label}</p>
                  <p className="text-[10px] text-slate-500 leading-snug">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right panel - form */}
        <div className="w-[480px] xl:w-[520px] flex flex-col justify-center px-10 xl:px-14 border-l border-slate-100 bg-white/80 backdrop-blur-sm">
          <div className="w-full max-w-sm mx-auto">
            {/* Tabs */}
            {!isTenantBranded && (
              <div className="flex gap-0 bg-slate-100 rounded-xl p-1 border border-slate-200 mb-6">
                <button
                  onClick={() => { setMode('login'); setStep(1); }}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-lg transition-all duration-200 ${
                    mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <User className="w-3.5 h-3.5" />Connexion
                </button>
                <button
                  onClick={() => { setMode('register'); setStep(1); }}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-lg transition-all duration-200 ${
                    mode === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Building2 className="w-3.5 h-3.5" />Inscription
                </button>
              </div>
            )}
            {isTenantBranded && (
              <div className="mb-6">
                <h2 className="text-lg font-bold text-slate-900">Connexion</h2>
                <p className="text-xs text-slate-500">{brandName}</p>
              </div>
            )}

            <div className="max-h-[70vh] overflow-y-auto pr-1">
              {mode === 'login' ? loginContent : registerContent}
            </div>
          </div>
        </div>
      </div>

      {/* ---- MOBILE ---- */}
      <div className="lg:hidden h-full flex flex-col overflow-auto">
        <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-sm border-b border-slate-100 px-5 py-4">
          <div className="flex items-center justify-between">
            <img src={logoSrc} alt={brandName} className="h-8 w-auto object-contain" />
            {mode === 'register' && step > 1 && !submitted && (
              <button onClick={() => setStep(step - 1)} className="text-xs font-medium text-slate-600 flex items-center gap-1">
                <ArrowLeft className="w-3.5 h-3.5" />Retour
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 px-5 py-6">
          {/* Tabs (mobile) */}
          {!isTenantBranded && !submitted && (
            <div className="grid grid-cols-2 border-b border-slate-200 mb-6">
              <button
                onClick={() => { setMode('login'); setStep(1); }}
                className={`relative flex items-center justify-center gap-2 py-3 text-[14px] font-medium transition-colors ${
                  mode === 'login' ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <User className="w-4 h-4" />Connexion
                {mode === 'login' && <span className="absolute bottom-[-1px] left-0 right-0 h-[2px] bg-slate-900" />}
              </button>
              <button
                onClick={() => { setMode('register'); setStep(1); }}
                className={`relative flex items-center justify-center gap-2 py-3 text-[14px] font-medium transition-colors ${
                  mode === 'register' ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <Building2 className="w-4 h-4" />Inscription
                {mode === 'register' && <span className="absolute bottom-[-1px] left-0 right-0 h-[2px] bg-slate-900" />}
              </button>
            </div>
          )}

          {mode === 'login' ? loginContent : registerContent}
        </div>
      </div>
    </div>
  );
}
