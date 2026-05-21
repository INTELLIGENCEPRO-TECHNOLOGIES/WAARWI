import { useEffect, useState, useMemo } from 'react';
import { Loader2, ArrowRight, ArrowLeft, Mail, Lock, Building2, User, Eye, EyeOff, CheckCircle2, ChevronDown, Sparkles, Zap, Shield, BarChart3, Globe, BookOpen, Calculator, Truck, ShoppingBag, Users, Package, Receipt, CreditCard, Layers } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { useTenantBranding } from '../lib/tenantBranding';
import { supabase } from '../lib/supabase';

const ALL_FEATURES = [
  { icon: Zap, text: 'Point de vente rapide et intuitif' },
  { icon: BarChart3, text: 'Suivi des ventes et du stock en temps réel' },
  { icon: Shield, text: 'Sécurité et contrôle multi-utilisateurs' },
  { icon: Globe, text: 'Boutique en ligne intégrée' },
  { icon: BookOpen, text: 'Catalogues maîtres par activité' },
  { icon: Calculator, text: 'Comptabilité générale automatisée' },
  { icon: Truck, text: 'Gestion des commandes fournisseurs' },
  { icon: ShoppingBag, text: 'Commandes en ligne et suivi client' },
  { icon: Users, text: 'Gestion des clients et fournisseurs' },
  { icon: Package, text: 'Contrôle du stock et mouvements' },
  { icon: Receipt, text: 'Devis et factures professionnels' },
  { icon: CreditCard, text: 'Sessions de caisse et contrôle financier' },
  { icon: Layers, text: 'Multi-sites et gestion centralisée' },
];

type BusinessActivityType = {
  id: string;
  name: string;
  slug: string;
  description: string;
  legacy_business_type: string;
  is_active: boolean;
};

export function Auth() {
  const { signIn, signUp } = useApp();
  const { error: showError } = useToast();
  const { branding } = useTenantBranding();
  useEffect(() => { if (branding) setMode('login'); }, [branding]);
  const isTenantBranded = !!branding;
  const brandName = branding?.name || 'WAARWI';
  const brandTagline = isTenantBranded
    ? (branding?.tagline || '')
    : 'Plateforme Business 2.0 made in Sénégal';

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [businessType, setBusinessType] = useState('auto_parts');
  const [customActivity, setCustomActivity] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [activityTypes, setActivityTypes] = useState<BusinessActivityType[]>([]);
  const [step, setStep] = useState(1);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('business_activity_types')
        .select('*')
        .eq('is_active', true)
        .order('name');
      if (data) setActivityTypes(data);
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

  const step1Valid = companyName.trim().length >= 2 && fullName.trim().length >= 2;
  const step2Valid = businessType !== '__other__' || customActivity.trim().length >= 2;
  const step3Valid = email.includes('@') && password.length >= 6;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'login') {
        await signIn(email, password);
      } else {
        const typeForProvision = businessType === '__other__'
          ? 'generic'
          : (selectedActivity?.legacy_business_type || businessType);
        await signUp(email, password, fullName, companyName, typeForProvision);
        setSubmitted(true);
      }
    } catch (err: any) {
      showError(err.message || 'Une erreur est survenue');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <AuthLayout isTenantBranded={isTenantBranded} brandName={brandName} brandTagline={brandTagline} branding={branding}>
        <div className="flex-1 flex items-center justify-center p-0 lg:p-5">
          <div className="w-full max-w-[400px]">
            <div className="bg-white/95 backdrop-blur-2xl border border-white/60 rounded-3xl shadow-premium p-7 text-center">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-amber-100 to-amber-50 flex items-center justify-center mb-4 ring-1 ring-amber-200/50">
                <CheckCircle2 className="w-7 h-7 text-amber-600" />
              </div>
              <h2 className="text-lg font-bold text-slate-900 mb-2">Compte en attente de validation</h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                Merci pour votre inscription. Un administrateur doit approuver votre compte avant activation. Vous recevrez un email dès validation.
              </p>
              <button
                onClick={() => { setSubmitted(false); setMode('login'); setStep(1); }}
                className="mt-5 text-sm font-medium text-brand-700 hover:text-brand-800 transition-colors"
              >
                Retour à la connexion
              </button>
            </div>
          </div>
        </div>
      </AuthLayout>
    );
  }

  const renderLogin = () => (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-4">
        <AuthInput icon={Mail} type="email" label="Adresse email" value={email} onChange={setEmail} placeholder="vous@entreprise.sn" required />
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Mot de passe</label>
          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              required
              type={showPassword ? 'text' : 'password'}
              minLength={6}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Votre mot de passe"
              className="w-full h-11 pl-10 pr-10 rounded-xl bg-slate-50/80 border border-slate-200 text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 transition-all text-sm"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      <button
        disabled={loading}
        type="submit"
        className="group relative w-full py-3 rounded-xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-800 text-white font-semibold shadow-glow hover:shadow-[0_14px_40px_-12px_rgba(15,118,110,0.7)] hover:from-brand-500 hover:to-brand-800 transition-all duration-300 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 overflow-hidden"
      >
        <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" aria-hidden />
        <span className="relative inline-flex items-center gap-2">
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          Se connecter
          {!loading && <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />}
        </span>
      </button>
    </form>
  );

  const renderRegisterStep1 = () => (
    <div className="space-y-5">
      <div className="space-y-4">
        <AuthInput icon={Building2} label="Nom de l'entreprise" value={companyName} onChange={setCompanyName} placeholder="Ex: Sénégal Auto Parts" required />
        <AuthInput icon={User} label="Nom complet du responsable" value={fullName} onChange={setFullName} placeholder="Ex: Amadou Diallo" required />
      </div>
      <button
        type="button"
        disabled={!step1Valid}
        onClick={() => setStep(2)}
        className="group relative w-full py-3 rounded-xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-800 text-white font-semibold shadow-glow hover:from-brand-500 hover:to-brand-800 transition-all duration-300 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
      >
        <span className="relative inline-flex items-center gap-2">
          Continuer
          <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </button>
    </div>
  );

  const renderRegisterStep2 = () => (
    <div className="space-y-5">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Choisissez votre activité</label>
          <div className="relative">
            <select
              value={businessType}
              onChange={e => setBusinessType(e.target.value)}
              className="w-full h-12 pl-4 pr-10 rounded-xl bg-slate-50/80 border border-slate-200 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 transition-all text-sm appearance-none cursor-pointer"
            >
              {activityTypes.map(bt => (
                <option key={bt.id} value={bt.slug}>{bt.name}</option>
              ))}
              <option value="__other__">Autre activité</option>
            </select>
            <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          </div>
          {selectedActivity?.description && businessType !== '__other__' && (
            <p className="mt-2 text-xs text-slate-500 leading-relaxed">{selectedActivity.description}</p>
          )}
        </div>

        {businessType === '__other__' && (
          <AuthInput
            icon={Sparkles}
            label="Précisez votre activité"
            value={customActivity}
            onChange={setCustomActivity}
            placeholder="Ex: Import/Export, Pharmacie..."
            required
          />
        )}
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setStep(1)}
          className="flex-1 py-3 rounded-xl border border-slate-200 bg-white text-slate-700 font-semibold hover:bg-slate-50 transition-all duration-200 active:scale-[0.98] inline-flex items-center justify-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour
        </button>
        <button
          type="button"
          disabled={!step2Valid}
          onClick={() => setStep(3)}
          className="flex-[2] py-3 rounded-xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-800 text-white font-semibold shadow-glow hover:from-brand-500 hover:to-brand-800 transition-all duration-300 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
        >
          Continuer
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  const renderRegisterStep3 = () => (
    <form onSubmit={submit} className="space-y-5">
      <div className="bg-slate-50/80 rounded-xl p-3.5 border border-slate-100 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">Entreprise</span>
          <span className="text-xs font-medium text-slate-800 truncate ml-2">{companyName}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">Responsable</span>
          <span className="text-xs font-medium text-slate-800 truncate ml-2">{fullName}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">Activité</span>
          <span className="text-xs font-medium text-slate-800 truncate ml-2">{selectedActivityLabel}</span>
        </div>
      </div>

      <div className="space-y-4">
        <AuthInput icon={Mail} type="email" label="Adresse email" value={email} onChange={setEmail} placeholder="vous@entreprise.sn" required />
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Mot de passe</label>
          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              required
              type={showPassword ? 'text' : 'password'}
              minLength={6}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="6 caractères minimum"
              className="w-full h-11 pl-10 pr-10 rounded-xl bg-slate-50/80 border border-slate-200 text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 transition-all text-sm"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setStep(2)}
          className="flex-1 py-3 rounded-xl border border-slate-200 bg-white text-slate-700 font-semibold hover:bg-slate-50 transition-all duration-200 active:scale-[0.98] inline-flex items-center justify-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour
        </button>
        <button
          disabled={loading || !step3Valid}
          type="submit"
          className="flex-[2] py-3 rounded-xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-800 text-white font-semibold shadow-glow hover:from-brand-500 hover:to-brand-800 transition-all duration-300 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 overflow-hidden"
        >
          <span className="relative inline-flex items-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Créer mon entreprise
            {!loading && <ArrowRight className="w-4 h-4" />}
          </span>
        </button>
      </div>

      <p className="text-[11px] text-slate-500 text-center leading-relaxed">
        Votre compte sera soumis à validation par un administrateur WAARWI avant activation.
      </p>
    </form>
  );

  return (
    <AuthLayout isTenantBranded={isTenantBranded} brandName={brandName} brandTagline={brandTagline} branding={branding}>
      <div className="flex-1 flex flex-col justify-center p-0 lg:p-10">
        <div className="w-full max-w-[400px] lg:max-w-[440px] mx-auto">
          {/* Auth Card */}
          <div className="bg-white/95 backdrop-blur-2xl border border-white/70 rounded-3xl shadow-premium p-5 sm:p-6 ring-1 ring-slate-900/[0.03]">
            {/* Mode tabs */}
            {!isTenantBranded && (
              <div className="flex bg-slate-100/80 rounded-xl p-1 mb-5">
                <button
                  onClick={() => { setMode('login'); setStep(1); }}
                  className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all duration-200 ${mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >Connexion</button>
                <button
                  onClick={() => { setMode('register'); setStep(1); }}
                  className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all duration-200 ${mode === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >Créer un compte</button>
              </div>
            )}

            {/* Step indicator for register */}
            {mode === 'register' && (
              <div className="flex items-center gap-2 mb-5">
                {[1, 2, 3].map(s => (
                  <div key={s} className="flex-1 h-1.5 rounded-full transition-all duration-300">
                    <div className={`h-full rounded-full transition-all duration-500 ${s <= step ? 'bg-brand-500' : 'bg-slate-200'}`} />
                  </div>
                ))}
                <span className="text-xs font-medium text-slate-400 ml-1 shrink-0">{step}/3</span>
              </div>
            )}

            {mode === 'login' && renderLogin()}
            {mode === 'register' && step === 1 && renderRegisterStep1()}
            {mode === 'register' && step === 2 && renderRegisterStep2()}
            {mode === 'register' && step === 3 && renderRegisterStep3()}
          </div>
        </div>
      </div>
    </AuthLayout>
  );
}

function RotatingFeatures({ count = 4 }: { count?: number }) {
  const [visibleIndex, setVisibleIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setVisibleIndex(prev => (prev + 1) % ALL_FEATURES.length);
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  const visibleFeatures = useMemo(() => {
    const features = [];
    for (let i = 0; i < count; i++) {
      features.push(ALL_FEATURES[(visibleIndex + i) % ALL_FEATURES.length]);
    }
    return features;
  }, [visibleIndex, count]);

  return (
    <div className="space-y-3">
      {visibleFeatures.map((f, i) => {
        const Icon = f.icon;
        return (
          <div
            key={`${visibleIndex}-${i}`}
            className="flex items-center gap-3 animate-fade-in"
          >
            <div className="w-9 h-9 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center shrink-0">
              <Icon className="w-4 h-4 text-brand-400" />
            </div>
            <span className="text-sm text-slate-300">{f.text}</span>
          </div>
        );
      })}
    </div>
  );
}

function AuthLayout({ children, isTenantBranded, brandName, brandTagline, branding }: {
  children: React.ReactNode;
  isTenantBranded: boolean;
  brandName: string;
  brandTagline: string;
  branding: any;
}) {
  return (
    <div className="fixed inset-0 flex overflow-hidden">
      {/* Left marketing panel — desktop only */}
      <div className="hidden lg:flex lg:w-[48%] xl:w-[52%] relative flex-col overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-ink-900" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_50%,rgba(13,148,136,0.15),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_80%,rgba(20,184,166,0.08),transparent_50%)]" />

        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)',
            backgroundSize: '64px 64px',
          }}
        />

        <div className="relative z-10 flex flex-col justify-between h-full p-10 xl:p-14">
          {/* Top: Logo */}
          <div className="flex items-center gap-3 shrink-0">
            {isTenantBranded && branding?.logo_url ? (
              <img src={branding.logo_url} alt={brandName} className="w-10 h-10 object-contain" />
            ) : (
              <img src="/waarwi-logo.png" alt="WAARWI" className="h-14 w-auto object-contain brightness-0 invert" />
            )}
          </div>

          {/* Center: Hero */}
          <div className="flex-1 flex flex-col justify-center max-w-lg">
            <h1 className="text-3xl xl:text-[2.5rem] font-bold text-white leading-[1.15] tracking-tight">
              Gérez votre entreprise<br />
              <span className="bg-gradient-to-r from-brand-300 to-brand-400 bg-clip-text text-transparent">
                en toute simplicité
              </span>
            </h1>
            <p className="mt-4 text-base text-slate-400 leading-relaxed max-w-md">
              {brandTagline || 'Plateforme Business 2.0 made in Sénégal'}
            </p>

            <div className="mt-10">
              <RotatingFeatures count={4} />
            </div>
          </div>

          {/* Bottom */}
          <div className="shrink-0 space-y-2">
            <div className="text-sm text-slate-400 font-medium">
              Plateforme Business 2.0 made in Sénégal
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>&copy; {new Date().getFullYear()} WAARWI. Tous droits réservés.</span>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
                Sécurisé par Supabase
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile: dark full-screen fixed layout (no scroll) */}
      <div className="flex lg:hidden flex-col w-full h-full overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_20%,rgba(13,148,136,0.12),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_80%,rgba(20,184,166,0.06),transparent_50%)]" />

        <div className="relative z-10 flex flex-col h-full px-5 pt-8 pb-4">
          {/* Mobile Header: Logo + Tagline + Feature */}
          <div className="flex flex-col items-center text-center shrink-0">
            {isTenantBranded && branding?.logo_url ? (
              <img src={branding.logo_url} alt={brandName} className="w-14 h-14 object-contain mb-2" />
            ) : (
              <img src="/waarwi-logo.png" alt="WAARWI" className="w-20 h-auto object-contain mb-2 brightness-0 invert" />
            )}
            <h1 className="text-lg font-bold text-white leading-tight tracking-tight">
              Gérez votre entreprise{' '}
              <span className="bg-gradient-to-r from-brand-300 to-brand-400 bg-clip-text text-transparent">
                en toute simplicité
              </span>
            </h1>
            <p className="mt-1.5 text-xs text-slate-400">
              {brandTagline || 'Plateforme Business 2.0 made in Sénégal'}
            </p>

            {/* Single rotating feature */}
            <div className="mt-3 w-full max-w-xs">
              <RotatingFeatures count={1} />
            </div>
          </div>

          {/* Auth form card — fixed height container */}
          <div className="flex-1 flex flex-col justify-center min-h-0 my-4">
            <div className="overflow-y-auto">
              {children}
            </div>
          </div>

          {/* Footer — always visible */}
          <div className="shrink-0 text-center space-y-1">
            <div className="text-[11px] text-slate-500">
              &copy; {new Date().getFullYear()} WAARWI. Tous droits réservés.
            </div>
            <div className="flex items-center justify-center gap-1.5 text-[10px] text-slate-500">
              <div className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
              Sécurisé par Supabase
            </div>
          </div>
        </div>
      </div>

      {/* Right auth panel — desktop only */}
      <div className="hidden lg:flex flex-1 relative flex-col overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-slate-100/60" />
        <div className="absolute top-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-gradient-to-br from-brand-100/40 via-brand-50/20 to-transparent blur-3xl" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[400px] h-[400px] rounded-full bg-gradient-to-tr from-brand-50/30 to-transparent blur-3xl" />

        <div
          className="absolute inset-0 opacity-[0.12] pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(rgba(15,23,42,0.05) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
            maskImage: 'radial-gradient(ellipse at center, black 20%, transparent 70%)',
            WebkitMaskImage: 'radial-gradient(ellipse at center, black 20%, transparent 70%)',
          }}
        />

        <div className="relative z-10 flex-1 flex flex-col overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  );
}

function AuthInput({
  icon: Icon, label, value, onChange, placeholder, type = 'text', required,
}: {
  icon: any; label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
      <div className="relative">
        <Icon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          required={required}
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full h-11 pl-10 pr-4 rounded-xl bg-slate-50/80 border border-slate-200 text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 transition-all text-sm"
        />
      </div>
    </div>
  );
}
