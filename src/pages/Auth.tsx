import { useEffect, useState, useMemo, useRef } from 'react';
import {
  Loader2, ArrowRight, ArrowLeft, Mail, Lock, Building2, User, Eye, EyeOff,
  CheckCircle2, ChevronDown, Sparkles, Shield, Package, Receipt, BarChart3,
  Globe, Monitor, FileText, Zap, ShoppingCart, Users, TrendingUp,
  Truck, CreditCard, Wallet, Layers, Settings, BookOpen,
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

/* ─── Shared components ─────────────────────────────────────────────────── */

function InputField({ icon: Icon, label, value, onChange, placeholder, type = 'text', required }: {
  icon: any; label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1.5">{label}</label>
      <div className="relative">
        <Icon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          required={required}
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full h-11 pl-10 pr-4 rounded-xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400
            focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400
            hover:border-slate-300 transition-all text-sm shadow-sm"
        />
      </div>
    </div>
  );
}

function PasswordField({ value, onChange, show, toggleShow, placeholder }: {
  value: string; onChange: (v: string) => void; show: boolean; toggleShow: () => void; placeholder: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1.5">Mot de passe</label>
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
            focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400
            hover:border-slate-300 transition-all text-sm shadow-sm"
        />
        <button type="button" onClick={toggleShow} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

function PrimaryBtn({ children, loading, disabled, onClick, type = 'button', className = '' }: {
  children: React.ReactNode; loading?: boolean; disabled?: boolean;
  onClick?: () => void; type?: 'button' | 'submit'; className?: string;
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className={`group relative w-full h-12 rounded-xl bg-gradient-to-r from-teal-600 to-teal-500 text-white font-bold text-sm
        shadow-[0_4px_16px_-4px_rgba(13,148,136,0.45)] hover:shadow-[0_6px_24px_-4px_rgba(13,148,136,0.55)]
        hover:from-teal-500 hover:to-teal-400
        transition-all duration-200 active:scale-[0.98]
        disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none
        inline-flex items-center justify-center gap-2 overflow-hidden ${className}`}
    >
      <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.12] to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-600" />
      <span className="relative inline-flex items-center gap-2">
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {children}
        {!loading && <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />}
      </span>
    </button>
  );
}

function SecondaryBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex-1 h-12 rounded-xl border border-slate-200 bg-white text-slate-600 font-semibold hover:bg-slate-50 hover:border-slate-300 transition-all active:scale-[0.98] inline-flex items-center justify-center gap-2 text-sm shadow-sm">
      <ArrowLeft className="w-4 h-4" />{children}
    </button>
  );
}

function ModeTabs({ mode, setMode, setStep }: { mode: string; setMode: (m: 'login' | 'register') => void; setStep: (s: number) => void }) {
  return (
    <div className="flex gap-0 bg-slate-100 rounded-xl p-1 border border-slate-200">
      <button
        onClick={() => { setMode('login'); setStep(1); }}
        className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-lg transition-all duration-200
          ${mode === 'login'
            ? 'bg-white text-teal-700 shadow-sm border border-teal-100 shadow-teal-50'
            : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'
          }`}
      >
        <User className="w-3.5 h-3.5" />
        Connexion
      </button>
      <button
        onClick={() => { setMode('register'); setStep(1); }}
        className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-lg transition-all duration-200
          ${mode === 'register'
            ? 'bg-white text-teal-700 shadow-sm border border-teal-100 shadow-teal-50'
            : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'
          }`}
      >
        <Building2 className="w-3.5 h-3.5" />
        Inscription
      </button>
    </div>
  );
}

function StepBar({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2">
      {[1, 2, 3].map(s => (
        <div key={s} className="flex-1 h-1 rounded-full overflow-hidden bg-slate-100">
          <div
            className={`h-full rounded-full transition-all duration-500 ${s <= step ? 'bg-teal-500' : ''}`}
            style={{ width: s <= step ? '100%' : '0%' }}
          />
        </div>
      ))}
      <span className="text-[10px] font-bold text-slate-400 tabular-nums">{step}/3</span>
    </div>
  );
}

/* ─── Auth page ──────────────────────────────────────────────────────────── */

export function Auth() {
  const { signIn, signUp } = useApp();
  const { error: showError } = useToast();
  const { branding } = useTenantBranding();
  useEffect(() => { if (branding) setMode('login'); }, [branding]);
  const isTenantBranded = !!branding;
  const brandName = branding?.name || 'WAARWI';
  const brandTagline = branding?.tagline || '';

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
  const [mounted, setMounted] = useState(false);
  const [carouselSlide, setCarouselSlide] = useState(0);
  const [carouselAnim, setCarouselAnim] = useState<'in' | 'out'>('in');
  const [config, setConfig] = useState<LoginConfig | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('business_activity_types').select('*').eq('is_active', true).order('name');
      if (data) setActivityTypes(data);
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

  const carouselRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    carouselRef.current = setInterval(() => {
      setCarouselAnim('out');
      setTimeout(() => {
        setCarouselSlide(prev => {
          const totalFeats = (config?.modules?.length ? config.modules.length : 9);
          const totalSlides = Math.ceil(totalFeats / 3);
          return (prev + 1) % totalSlides;
        });
        setCarouselAnim('in');
      }, 320);
    }, 3500);
    return () => { if (carouselRef.current) clearInterval(carouselRef.current); };
  }, [config]);

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

  /* ── Default feature list (all app modules) ──────────────────────────── */
  const allFeatures = [
    { icon: ShoppingCart, label: 'Point de vente', desc: 'Caisse rapide et intuitive', color: 'text-teal-600 bg-teal-50 border-teal-100' },
    { icon: Package, label: 'Stock', desc: 'Maîtrisez vos stocks', color: 'text-sky-600 bg-sky-50 border-sky-100' },
    { icon: FileText, label: 'Facturation', desc: 'Devis et factures pro', color: 'text-amber-600 bg-amber-50 border-amber-100' },
    { icon: Users, label: 'Clients & Tiers', desc: 'CRM et créances', color: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
    { icon: Truck, label: 'Fournisseurs', desc: 'Commandes et dettes', color: 'text-orange-600 bg-orange-50 border-orange-100' },
    { icon: Globe, label: 'Boutique en ligne', desc: 'Vitrine et commandes web', color: 'text-cyan-600 bg-cyan-50 border-cyan-100' },
    { icon: BarChart3, label: 'Comptabilité', desc: 'Suivi financier complet', color: 'text-rose-600 bg-rose-50 border-rose-100' },
    { icon: TrendingUp, label: 'Rapports', desc: 'Analyses et tableaux de bord', color: 'text-violet-600 bg-violet-50 border-violet-100' },
    { icon: Shield, label: 'Sécurité', desc: 'Rôles et permissions', color: 'text-slate-600 bg-slate-50 border-slate-200' },
  ];

  const hasModules = !!(config?.modules?.length);
  const features = hasModules
    ? config!.modules.map(m => ({ icon: ICON_MAP[m.icon] || Shield, label: m.label, desc: m.desc, color: 'text-teal-600 bg-teal-50 border-teal-100' }))
    : allFeatures;

  /* ── Form content ─────────────────────────────────────────────────────── */
  const formInner = submitted ? (
    <div className="text-center space-y-4 py-4">
      <div className="w-14 h-14 mx-auto rounded-2xl bg-teal-50 flex items-center justify-center border border-teal-100">
        <CheckCircle2 className="w-7 h-7 text-teal-600" />
      </div>
      <div>
        <h2 className="text-base font-bold text-slate-900">Compte en attente de validation</h2>
        <p className="text-sm text-slate-500 leading-relaxed mt-2">
          Merci pour votre inscription. Un administrateur doit approuver votre compte avant activation.
        </p>
      </div>
      <button onClick={() => { setSubmitted(false); setMode('login'); setStep(1); }}
        className="text-sm font-semibold text-teal-600 hover:text-teal-700 transition-colors">
        ← Retour à la connexion
      </button>
    </div>
  ) : mode === 'login' ? (
    <form onSubmit={submit} className="space-y-4">
      <InputField icon={Mail} type="email" label="Adresse email" value={email} onChange={setEmail} placeholder="votre@email.com" required />
      <PasswordField value={password} onChange={setPassword} show={showPassword} toggleShow={() => setShowPassword(!showPassword)} placeholder="••••••••••" />
      <PrimaryBtn loading={loading} type="submit">Se connecter</PrimaryBtn>
    </form>
  ) : step === 1 ? (
    <div className="space-y-4">
      <InputField icon={Building2} label="Nom de l'entreprise" value={companyName} onChange={setCompanyName} placeholder="Ex : Sénégal Auto Parts" required />
      <InputField icon={User} label="Responsable" value={fullName} onChange={setFullName} placeholder="Nom complet" required />
      <PrimaryBtn disabled={!step1Valid} onClick={() => setStep(2)}>Continuer</PrimaryBtn>
    </div>
  ) : step === 2 ? (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">Activité</label>
        <div className="relative">
          <select
            value={businessType}
            onChange={e => setBusinessType(e.target.value)}
            className="w-full h-11 pl-4 pr-10 rounded-xl bg-white border border-slate-200 text-slate-900
              focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400
              hover:border-slate-300 transition-all text-sm appearance-none cursor-pointer shadow-sm"
          >
            {activityTypes.map(bt => (
              <option key={bt.id} value={bt.slug}>{bt.name}</option>
            ))}
            <option value="__other__">Autre activité</option>
          </select>
          <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
        {selectedActivity?.description && businessType !== '__other__' && (
          <p className="mt-1.5 text-[11px] text-slate-500 leading-relaxed">{selectedActivity.description}</p>
        )}
      </div>
      {businessType === '__other__' && (
        <InputField icon={Sparkles} label="Précisez votre activité" value={customActivity} onChange={setCustomActivity} placeholder="Import/Export, Pharmacie..." required />
      )}
      <div className="flex gap-3">
        <SecondaryBtn onClick={() => setStep(1)}>Retour</SecondaryBtn>
        <PrimaryBtn disabled={!step2Valid} onClick={() => setStep(3)} className="flex-[2]">Continuer</PrimaryBtn>
      </div>
    </div>
  ) : (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-1.5">
        {[
          ['Entreprise', companyName],
          ['Responsable', fullName],
          ['Activité', selectedActivityLabel],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between">
            <span className="text-[11px] text-slate-500 font-medium">{k}</span>
            <span className="text-[11px] font-semibold text-slate-700 truncate ml-2">{v}</span>
          </div>
        ))}
      </div>
      <InputField icon={Mail} type="email" label="Adresse email" value={email} onChange={setEmail} placeholder="vous@entreprise.sn" required />
      <PasswordField value={password} onChange={setPassword} show={showPassword} toggleShow={() => setShowPassword(!showPassword)} placeholder="6 caractères minimum" />
      <div className="flex gap-3">
        <SecondaryBtn onClick={() => setStep(2)}>Retour</SecondaryBtn>
        <PrimaryBtn loading={loading} disabled={!step3Valid} type="submit" className="flex-[2]">Créer mon compte</PrimaryBtn>
      </div>
      <p className="text-[10px] text-slate-400 text-center">Soumis à validation par un administrateur WAARWI.</p>
    </form>
  );

  /* ── Logo ─────────────────────────────────────────────────────────────── */
  const logoSrc = isTenantBranded && branding?.logo_url ? branding.logo_url : '/Picsart_26-05-30_02-43-37-384.png';

  const loginBgUrl = config?.login_bg_url;

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#f0f4f8]">
      {/* Animated mesh gradient background */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-[#edf2f7] via-[#f0f4f8] to-[#e8f4f1]" />
        <div className="auth-mesh-gradient">
          <div className="auth-orb-1" />
          <div className="auth-orb-2" />
          <div className="auth-orb-3" />
        </div>
      </div>
      {loginBgUrl && (
        <div className="absolute inset-0 z-[1]">
          <img src={loginBgUrl} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-white/70 backdrop-blur-[2px]" />
        </div>
      )}

      {/* ══════════ DESKTOP ══════════ */}
      <div className={`hidden lg:flex h-full relative z-10 transition-all duration-500 ${mounted ? 'opacity-100' : 'opacity-0'}`}>

        {/* LEFT + RIGHT: aligned at bottom using items-end */}
        <div className="flex-1 flex items-end px-14 xl:px-20 pb-12 pt-10">

          {/* LEFT COLUMN */}
          <div className={`w-full max-w-lg transition-all duration-500 delay-200 ${mounted ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}>

            {/* Logo + slogan */}
            <div className="mb-8">
              <img src={logoSrc} alt={brandName} className="h-14 xl:h-16 w-auto object-contain" />
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mt-2">
                Plateforme Business 2.0
              </p>
            </div>

            {config?.headline ? (
              <h1 className="text-3xl xl:text-4xl font-extrabold text-slate-900 leading-[1.15] tracking-tight mb-4">
                {config.headline}
                {config.headline_accent && (
                  <> <span className="text-teal-600">{config.headline_accent}</span></>
                )}
              </h1>
            ) : (
              <h1 className="text-3xl xl:text-4xl font-extrabold text-slate-900 leading-[1.15] tracking-tight mb-4">
                La plateforme qui simplifie,<br />connecte et propulse votre{' '}
                <span className="text-teal-600">business.</span>
              </h1>
            )}

            <p className="text-sm xl:text-base text-slate-500 leading-relaxed mb-7">
              {config?.subtitle || 'Gérez vos ventes, stocks, clients et finances depuis un seul espace, en toute sécurité.'}
            </p>

            {/* Animated feature carousel — 3 per slide */}
            {(() => {
              const slideFeatures = features.slice(carouselSlide * 3, carouselSlide * 3 + 3);
              const totalSlides = Math.ceil(features.length / 3);
              return (
                <div className="mb-7">
                  <div
                    className="grid grid-cols-3 gap-3"
                    style={{
                      opacity: carouselAnim === 'in' ? 1 : 0,
                      transform: carouselAnim === 'in' ? 'translateY(0)' : 'translateY(6px)',
                      transition: 'opacity 0.32s ease, transform 0.32s ease',
                    }}
                  >
                    {slideFeatures.map((f, i) => (
                      <div key={`${carouselSlide}-${i}`}
                        className="rounded-xl bg-white/80 border border-slate-200 p-3.5">
                        <f.icon className={`w-4 h-4 mb-2.5 ${f.color.split(' ')[0]}`} />
                        <p className="text-xs font-bold text-slate-800 mb-0.5">{f.label}</p>
                        <p className="text-[10px] text-slate-500 leading-snug">{f.desc}</p>
                      </div>
                    ))}
                  </div>
                  {/* Slide indicators */}
                  <div className="flex items-center justify-center gap-1.5 mt-3">
                    {Array.from({ length: totalSlides }).map((_, i) => (
                      <button
                        key={i}
                        onClick={() => { setCarouselAnim('out'); setTimeout(() => { setCarouselSlide(i); setCarouselAnim('in'); }, 320); }}
                        className={`rounded-full transition-all duration-300 ${i === carouselSlide ? 'w-4 h-1.5 bg-teal-500' : 'w-1.5 h-1.5 bg-slate-300 hover:bg-slate-400'}`}
                      />
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Dashboard mockup preview — aligns to form bottom */}
            <div className="rounded-2xl bg-white border border-slate-200 shadow-xl overflow-hidden">
              <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 border-b border-slate-100">
                <div className="w-2 h-2 rounded-full bg-slate-200" />
                <div className="w-2 h-2 rounded-full bg-slate-200" />
                <div className="w-2 h-2 rounded-full bg-slate-200" />
                <div className="ml-2 flex items-center gap-3">
                  <div className="w-20 h-1.5 rounded-full bg-teal-100" />
                  <div className="w-14 h-1.5 rounded-full bg-slate-100" />
                  <div className="w-16 h-1.5 rounded-full bg-slate-100" />
                </div>
              </div>
              <div className="p-4 flex gap-3">
                {/* Sidebar mock */}
                <div className="w-24 flex-shrink-0 space-y-1">
                  <div className="h-3 w-16 rounded bg-teal-100 mb-1.5" />
                  {['Tableau de bord', 'Ventes', 'Caisse', 'Stock', 'Clients', 'Fournisseurs', 'Facturation', 'Rapports'].map((item, i) => (
                    <div key={i} className={`h-2.5 rounded flex items-center px-1.5 ${i === 0 ? 'bg-teal-500' : 'bg-slate-50'}`}>
                      <span className={`text-[6px] font-medium truncate ${i === 0 ? 'text-white' : 'text-slate-400'}`}>{item}</span>
                    </div>
                  ))}
                </div>
                {/* Content mock */}
                <div className="flex-1 min-w-0 space-y-2">
                  <div>
                    <div className="text-[8px] text-slate-400 font-medium">Encaissement du jour</div>
                    <div className="text-sm font-black text-slate-900 num">2 212 000 FCFA</div>
                    <div className="text-[8px] text-teal-600 font-bold">↗ +26% vs hier</div>
                  </div>
                  <div className="h-12 flex items-end gap-0.5">
                    {[25, 40, 30, 55, 45, 70, 60, 80, 65, 90, 75, 95, 70, 85, 60, 78, 88, 72, 95, 80].map((h, i) => (
                      <div key={i} className={`flex-1 rounded-sm ${i === 12 ? 'bg-teal-500' : 'bg-teal-200/60'}`} style={{ height: `${h}%` }} />
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 pt-1">
                    {[
                      { label: 'SOLDE CAISSE', val: '1 820 000', color: 'text-teal-600 bg-teal-50' },
                      { label: 'DÉPENSES', val: '25 000', color: 'text-rose-600 bg-rose-50' },
                      { label: 'ENTRÉES', val: '10 000', color: 'text-emerald-600 bg-emerald-50' },
                    ].map((s, i) => (
                      <div key={i} className={`rounded-lg p-1.5 ${s.color}`}>
                        <div className="text-[6px] font-bold uppercase opacity-70">{s.label}</div>
                        <div className="text-[8px] font-black num">{s.val} FCFA</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom trust */}
            <div className={`flex items-center gap-5 mt-6 transition-all duration-500 delay-600 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
              {[
                { icon: Shield, label: 'Données sécurisées', sub: 'Chiffrement SSL 256 bits', flag: false },
                { icon: Globe, label: 'Hébergement cloud', sub: 'Haute disponibilité', flag: false },
                { icon: null, label: 'Made in Sénégal', sub: 'Conçu pour les entreprises locales', flag: true },
              ].map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-white border border-slate-200 shadow-sm flex items-center justify-center flex-shrink-0">
                    {t.flag ? (
                      <svg className="w-3.5 h-2.5" viewBox="0 0 21 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect width="7" height="14" fill="#00853F" opacity="0.85" />
                        <rect x="7" width="7" height="14" fill="#FDEF42" opacity="0.85" />
                        <rect x="14" width="7" height="14" fill="#E31B23" opacity="0.85" />
                        <path d="M10.5 5.2L10.9 6.4H12.1L11.1 7.1L11.5 8.3L10.5 7.6L9.5 8.3L9.9 7.1L8.9 6.4H10.1L10.5 5.2Z" fill="#00853F" opacity="0.9" />
                      </svg>
                    ) : (
                      t.icon && <t.icon className="w-3 h-3 text-teal-600" />
                    )}
                  </div>
                  <div>
                    <p className="text-[9px] font-bold text-slate-700 leading-tight">{t.label}</p>
                    <p className="text-[8px] text-slate-400 leading-tight">{t.sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT PANEL - Form — also bottom-aligned */}
        <div className={`w-[460px] xl:w-[500px] flex-shrink-0 flex items-end justify-center px-10 xl:px-12 pb-12 pt-10 transition-all duration-500 delay-300 ${mounted ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4'}`}>
          <div className="w-full">
            {/* Card */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_8px_40px_-8px_rgba(0,0,0,0.12)] p-7 xl:p-8">
              {/* Card header */}
              <div className="text-center mb-6">
                <h2 className="text-xl font-extrabold text-slate-900">
                  Bienvenue sur{' '}
                  <span className="text-teal-600">{isTenantBranded ? brandName : 'Waarwi'}</span>
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  {submitted ? 'Inscription soumise' : mode === 'login' ? 'Connectez-vous à votre espace' : 'Créez votre espace business'}
                </p>
              </div>

              {/* Tabs */}
              {!isTenantBranded && !submitted && (
                <div className="mb-5">
                  <ModeTabs mode={mode} setMode={setMode} setStep={setStep} />
                </div>
              )}

              {/* Step bar for register */}
              {!submitted && mode === 'register' && (
                <div className="mb-5">
                  <StepBar step={step} />
                </div>
              )}

              {formInner}
            </div>

            {/* Below card */}
            <div className="flex items-center justify-center gap-1.5 mt-4">
              <div className="w-px h-3 bg-slate-200" />
              <span className="text-[10px] text-slate-400">© {new Date().getFullYear()} WAARWI</span>
              <div className="w-px h-3 bg-slate-200" />
              <span className="text-[10px] text-slate-400">Infrastructure sécurisée</span>
            </div>
          </div>
        </div>
      </div>

      {/* ══════════ MOBILE ══════════ */}
      <div className={`flex lg:hidden flex-col h-full relative z-10 overflow-y-auto transition-all duration-500 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
        <div className="flex flex-col min-h-full px-5 pt-5 pb-4">

          {/* Logo */}
          <div className="flex flex-col items-center text-center mb-3">
            <img src={logoSrc} alt={brandName} className="h-10 w-auto object-contain mb-1" />
            <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider">Plateforme Business 2.0</p>
          </div>

          {/* Feature pills */}
          <div className="grid grid-cols-3 gap-1.5 mb-4">
            {features.map((f, i) => (
              <div key={i} className="rounded-lg bg-white border border-slate-200 px-2 py-1.5 text-center">
                <f.icon className={`w-3.5 h-3.5 mx-auto mb-1 ${f.color.split(' ')[0]}`} />
                <p className="text-[8.5px] font-bold text-slate-700 leading-tight">{f.label}</p>
              </div>
            ))}
          </div>

          {/* Form card */}
          <div className="flex-1 flex flex-col justify-center">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_4px_24px_-4px_rgba(0,0,0,0.10)] p-5">
              <div className="text-center mb-4">
                <h2 className="text-base font-extrabold text-slate-900">
                  Bienvenue sur <span className="text-teal-600">{isTenantBranded ? brandName : 'Waarwi'}</span>
                </h2>
              </div>

              {!isTenantBranded && !submitted && (
                <div className="mb-4">
                  <ModeTabs mode={mode} setMode={setMode} setStep={setStep} />
                </div>
              )}
              {!submitted && mode === 'register' && (
                <div className="mb-4"><StepBar step={step} /></div>
              )}
              {formInner}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-center gap-3 mt-5 text-[10px] text-slate-400">
            <Shield className="w-3 h-3 text-teal-500" />
            <span>Connexion sécurisée</span>
            <div className="w-px h-3 bg-slate-200" />
            <span>© {new Date().getFullYear()} WAARWI</span>
          </div>
        </div>
      </div>
    </div>
  );
}
