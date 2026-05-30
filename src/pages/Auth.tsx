import { useEffect, useState, useMemo } from 'react';
import {
  Loader2, ArrowRight, ArrowLeft, Mail, Lock, Building2, User, Eye, EyeOff,
  CheckCircle2, ChevronDown, Sparkles, Zap, Shield, Globe, Package,
  Receipt, BarChart3, Monitor, FileText, Leaf,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { useTenantBranding } from '../lib/tenantBranding';
import { supabase } from '../lib/supabase';

const ICON_MAP: Record<string, any> = { Zap, Package, Receipt, Globe, BarChart3, Shield, Monitor, FileText };

type LoginConfig = {
  headline: string;
  headline_accent: string;
  subtitle: string;
  modules: { icon: string; label: string; desc: string }[];
};

/* ─── Types ───────────────────────────────────────────────────────────────── */

type BusinessActivityType = {
  id: string;
  name: string;
  slug: string;
  description: string;
  legacy_business_type: string;
  is_active: boolean;
};

/* ─── Composants partagés (design system unifié) ──────────────────────────── */

function InputField({ icon: Icon, label, value, onChange, placeholder, type = 'text', required }: {
  icon: any; label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">{label}</label>
      <div className="relative">
        <Icon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
        <input
          required={required}
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full h-11 pl-10 pr-4 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white placeholder-slate-600 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40 transition-all text-sm"
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
      <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Mot de passe</label>
      <div className="relative">
        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
        <input
          required
          type={show ? 'text' : 'password'}
          minLength={6}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full h-11 pl-10 pr-10 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white placeholder-slate-600 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40 transition-all text-sm"
        />
        <button type="button" onClick={toggleShow} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
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
      className={`group relative w-full h-11 rounded-xl bg-gradient-to-r from-brand-500 via-brand-600 to-brand-700 text-white font-semibold text-sm
        shadow-[0_6px_24px_-6px_rgba(13,148,136,0.5)] hover:shadow-[0_10px_36px_-6px_rgba(13,148,136,0.6)]
        hover:from-brand-400 hover:via-brand-500 hover:to-brand-600
        transition-all duration-300 active:scale-[0.97]
        disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none
        inline-flex items-center justify-center gap-2 overflow-hidden ${className}`}
    >
      <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
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
    <button type="button" onClick={onClick} className="flex-1 h-11 rounded-xl border border-white/[0.08] bg-white/[0.03] text-slate-300 font-semibold hover:bg-white/[0.06] transition-all active:scale-[0.97] inline-flex items-center justify-center gap-2 text-sm">
      <ArrowLeft className="w-4 h-4" />{children}
    </button>
  );
}

function ModeTabs({ mode, setMode, setStep }: { mode: string; setMode: (m: 'login' | 'register') => void; setStep: (s: number) => void }) {
  return (
    <div className="flex bg-white/[0.04] rounded-xl p-1 border border-white/[0.05]">
      <button
        onClick={() => { setMode('login'); setStep(1); }}
        className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all duration-300 ${mode === 'login' ? 'bg-brand-600/90 text-white shadow-lg shadow-brand-900/30' : 'text-slate-400 hover:text-white'}`}
      >Connexion</button>
      <button
        onClick={() => { setMode('register'); setStep(1); }}
        className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all duration-300 ${mode === 'register' ? 'bg-brand-600/90 text-white shadow-lg shadow-brand-900/30' : 'text-slate-400 hover:text-white'}`}
      >Inscription</button>
    </div>
  );
}

function StepBar({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {[1, 2, 3].map(s => (
        <div key={s} className="flex-1 h-1 rounded-full overflow-hidden bg-white/[0.06]">
          <div className={`h-full rounded-full transition-all duration-500 ${s <= step ? 'bg-gradient-to-r from-brand-400 to-brand-500' : ''}`} style={{ width: s <= step ? '100%' : '0%' }} />
        </div>
      ))}
      <span className="text-[10px] font-bold text-slate-500 ml-1 tabular-nums">{step}/3</span>
    </div>
  );
}

function TrustSignals() {
  return (
    <div className="flex items-center justify-center gap-4 text-[10px] text-slate-600">
      <span>Chiffrement SSL</span>
      <div className="w-px h-3 bg-white/[0.06]" />
      <span>Cloud sécurisé</span>
    </div>
  );
}

/* ─── Page Auth ───────────────────────────────────────────────────────────── */

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
  const [config, setConfig] = useState<LoginConfig | null>(null);

  useEffect(() => { setMounted(true); }, []);

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

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('platform_login_config')
        .select('*')
        .eq('id', 'default')
        .maybeSingle();
      if (data) {
        setConfig({
          headline: data.headline || '',
          headline_accent: data.headline_accent || '',
          subtitle: data.subtitle || '',
          modules: Array.isArray(data.modules) ? data.modules : [],
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

  /* ── Contenu du formulaire (partagé mobile & desktop) ───────────────────── */

  const formInner = submitted ? (
    <div className="text-center space-y-4 py-2">
      <div className="w-14 h-14 mx-auto rounded-2xl bg-brand-500/15 flex items-center justify-center ring-1 ring-brand-500/20">
        <CheckCircle2 className="w-7 h-7 text-brand-400" />
      </div>
      <h2 className="text-lg font-bold text-white">Compte en attente de validation</h2>
      <p className="text-sm text-slate-400 leading-relaxed">
        Merci pour votre inscription. Un administrateur doit approuver votre compte avant activation.
      </p>
      <button onClick={() => { setSubmitted(false); setMode('login'); setStep(1); }} className="text-sm font-medium text-brand-400 hover:text-brand-300 transition-colors">
        Retour à la connexion
      </button>
    </div>
  ) : mode === 'login' ? (
    <form onSubmit={submit} className="space-y-4">
      <InputField icon={Mail} type="email" label="Adresse email" value={email} onChange={setEmail} placeholder="vous@entreprise.sn" required />
      <PasswordField value={password} onChange={setPassword} show={showPassword} toggleShow={() => setShowPassword(!showPassword)} placeholder="Votre mot de passe" />
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
        <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Activité</label>
        <div className="relative">
          <select
            value={businessType}
            onChange={e => setBusinessType(e.target.value)}
            className="w-full h-11 pl-4 pr-10 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40 transition-all text-sm appearance-none cursor-pointer [&>option]:bg-ink-800 [&>option]:text-white"
          >
            {activityTypes.map(bt => (
              <option key={bt.id} value={bt.slug}>{bt.name}</option>
            ))}
            <option value="__other__">Autre activité</option>
          </select>
          <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
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
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 space-y-1.5">
        {[
          ['Entreprise', companyName],
          ['Responsable', fullName],
          ['Activité', selectedActivityLabel],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between">
            <span className="text-[11px] text-slate-500">{k}</span>
            <span className="text-[11px] font-medium text-slate-300 truncate ml-2">{v}</span>
          </div>
        ))}
      </div>
      <InputField icon={Mail} type="email" label="Adresse email" value={email} onChange={setEmail} placeholder="vous@entreprise.sn" required />
      <PasswordField value={password} onChange={setPassword} show={showPassword} toggleShow={() => setShowPassword(!showPassword)} placeholder="6 caractères minimum" />
      <div className="flex gap-3">
        <SecondaryBtn onClick={() => setStep(2)}>Retour</SecondaryBtn>
        <PrimaryBtn loading={loading} disabled={!step3Valid} type="submit" className="flex-[2]">Créer mon compte</PrimaryBtn>
      </div>
      <p className="text-[10px] text-slate-600 text-center">Soumis à validation par un administrateur WAARWI.</p>
    </form>
  );

  /* ── Couches de fond partagées ──────────────────────────────────────────── */

  const bgLayers = (
    <>
      <div className="absolute inset-0 bg-gradient-to-br from-ink-900 via-[#0b1222] to-ink-900" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(13,148,136,0.10),transparent_55%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_80%,rgba(20,184,166,0.06),transparent_50%)]" />
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-brand-500/20 to-transparent" />
      <div className="absolute inset-0 opacity-[0.015]" style={{
        backgroundImage: 'radial-gradient(rgba(255,255,255,0.25) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
      }} />
    </>
  );

  /* ── Carte glass (wrapper formulaire) ───────────────────────────────────── */

  const glassCard = (compact?: boolean) => (
    <div className={`bg-white/[0.03] backdrop-blur-xl border border-white/[0.07] rounded-2xl shadow-[0_24px_64px_-16px_rgba(0,0,0,0.45)] ring-1 ring-white/[0.03] ${compact ? 'p-5' : 'p-6'}`}>
      {!submitted && mode === 'login' && (
        <p className={`text-slate-400 font-medium ${compact ? 'text-xs mb-3' : 'text-[13px] mb-4'}`}>Connectez-vous à votre espace</p>
      )}
      {!isTenantBranded && !submitted && (
        <div className="mb-4">
          <ModeTabs mode={mode} setMode={setMode} setStep={setStep} />
        </div>
      )}
      {!submitted && mode === 'register' && <div className="mb-4"><StepBar step={step} /></div>}
      {formInner}
    </div>
  );

  /* ── Logo ────────────────────────────────────────────────────────────────── */

  const logo = (size: 'sm' | 'md' | 'lg') => {
    const h = size === 'sm' ? 'h-10' : size === 'md' ? 'h-16' : 'h-20 xl:h-24';
    const src = isTenantBranded && branding?.logo_url ? branding.logo_url : '/waarwi-logo.png';
    const alt = isTenantBranded ? brandName : 'WAARWI';
    const animated = size === 'lg' || size === 'md';
    return <img src={src} alt={alt} className={`${h} w-auto object-contain ${animated ? 'animate-float drop-shadow-[0_4px_24px_rgba(13,148,136,0.25)]' : ''}`} />;
  };

  /* ── Badge slogan ───────────────────────────────────────────────────────── */

  const sloganBadge = brandTagline ? (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-500/10 border border-brand-500/15">
      <div className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
      <span className="text-[11px] font-semibold text-brand-300/90 tracking-wide">{brandTagline}</span>
    </div>
  ) : null;

  /* ── Titre principal ────────────────────────────────────────────────────── */

  const hasHeadline = !!(config?.headline || config?.headline_accent);
  const headline = (mobile?: boolean) => hasHeadline ? (
    <h1 className={`font-bold text-white leading-[1.12] tracking-tight ${mobile ? 'text-xl' : 'text-3xl xl:text-4xl'}`}>
      {config!.headline}{config!.headline_accent && <>{mobile ? ' ' : <br />}<span className="bg-gradient-to-r from-brand-300 via-brand-400 to-teal-300 bg-clip-text text-transparent">{config!.headline_accent}</span></>}
    </h1>
  ) : null;

  /* ── Sous-titre ─────────────────────────────────────────────────────────── */

  const subtitle = (mobile?: boolean) => config?.subtitle ? (
    <p className={`text-slate-400 leading-relaxed ${mobile ? 'text-xs' : 'text-sm xl:text-base max-w-md'}`}>
      {config.subtitle}
    </p>
  ) : null;

  /* ── Cartes modules métier (desktop) ────────────────────────────────────── */

  const hasModules = !!(config?.modules?.length);
  const moduleCards = hasModules ? (
    <div className="grid grid-cols-3 gap-2">
      {config!.modules.map((m, i) => {
        const Icon = ICON_MAP[m.icon] || Shield;
        return (
          <div key={i} className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 hover:bg-white/[0.05] transition-all duration-300 group">
            <Icon className="w-4 h-4 text-brand-400 mb-2 group-hover:scale-110 transition-transform" />
            <div className="text-xs font-semibold text-white mb-0.5">{m.label}</div>
            <div className="text-[10px] text-slate-500 leading-snug">{m.desc}</div>
          </div>
        );
      })}
    </div>
  ) : null;

  /* ── Pills modules (mobile) ─────────────────────────────────────────────── */

  const mobilePills = hasModules ? (
    <div className="grid grid-cols-2 gap-2 max-w-xs mx-auto">
      {config!.modules.slice(0, 4).map((m, i) => {
        const Icon = ICON_MAP[m.icon] || Shield;
        return (
          <div key={i} className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
            <Icon className="w-3.5 h-3.5 text-brand-400 shrink-0" />
            <span className="text-xs font-medium text-slate-300">{m.label}</span>
          </div>
        );
      })}
    </div>
  ) : null;

  /* ── Pied de page ───────────────────────────────────────────────────────── */

  const hasLeftContent = !!(sloganBadge || hasHeadline || config?.subtitle || hasModules);

  const ecoBadge = (
    <div className="flex items-center justify-center gap-2">
      <Leaf className="w-3 h-3 text-emerald-400 shrink-0" />
      <span className="text-[10px] text-emerald-300/80 font-medium leading-tight">L'impression quand c'est nécessaire.</span>
    </div>
  );

  const footer = (
    <div className="space-y-3">
      {ecoBadge}
      <div className="flex items-center justify-between text-[10px] text-slate-600">
        <span>&copy; {new Date().getFullYear()} WAARWI</span>
        <span>Infrastructure sécurisée</span>
      </div>
    </div>
  );

  /* ──────────────────────────────────────────────────────────────────────── */

  return (
    <div className="fixed inset-0 overflow-hidden">

      {/* ══════════ DESKTOP ══════════ */}
      <div className="hidden lg:flex lg:flex-col h-full relative">
        {bgLayers}
        {/* Halo lumineux cloud -> blanc derriere le logo */}
        <div className="absolute top-0 left-0 w-[50%] h-[35%] bg-[radial-gradient(ellipse_at_12%_8%,rgba(255,255,255,0.12)_0%,rgba(255,255,255,0.04)_35%,transparent_70%)] z-[1]" />
        <div className="absolute top-[12%] left-[8%] w-[280px] h-[280px] rounded-full bg-brand-500/[0.05] blur-[90px] animate-pulse-slow" />
        <div className="absolute bottom-[18%] left-[5%] w-[220px] h-[220px] rounded-full bg-brand-400/[0.04] blur-[70px] animate-pulse-slow" style={{ animationDelay: '2s' }} />
        <div className="absolute top-[20%] right-[10%] w-48 h-48 rounded-full bg-brand-500/[0.03] blur-[60px]" />
        {hasLeftContent && <div className="absolute left-[55%] top-[8%] bottom-[8%] w-px bg-gradient-to-b from-transparent via-white/[0.06] to-transparent z-10" />}

        <div className={`relative z-10 flex flex-col h-full p-10 xl:p-14 transition-all duration-700 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
          {/* Logo */}
          <div className={`shrink-0 transition-all duration-600 ${mounted ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0'}`}>
            {logo('lg')}
          </div>

          {/* Zone centrale */}
          <div className="flex-1 flex items-center">
            {hasLeftContent ? (
              <div className="w-full grid items-end" style={{ gridTemplateColumns: '55% 1fr' }}>
                <div className={`pr-16 xl:pr-20 pb-7 transition-all duration-700 delay-150 ${mounted ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}>
                  <div className="max-w-xl">
                    {sloganBadge && <div className="mb-5">{sloganBadge}</div>}
                    {headline()}
                    {subtitle() && <div className="mt-4">{subtitle()}</div>}
                    {moduleCards && <div className={`mt-8 transition-all duration-700 delay-400 ${mounted ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`}>{moduleCards}</div>}
                  </div>
                </div>
                <div className={`pl-8 transition-all duration-700 delay-300 ${mounted ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
                  <div className="w-full max-w-[400px] mx-auto">
                    {glassCard()}
                    <div className="mt-3">{TrustSignals()}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className={`w-full flex justify-center transition-all duration-700 delay-300 ${mounted ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
                <div className="w-full max-w-[400px]">
                  {glassCard()}
                  <div className="mt-3">{TrustSignals()}</div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className={`shrink-0 transition-all duration-500 delay-700 ${mounted ? 'opacity-100' : 'opacity-0'}`} style={{ maxWidth: '55%' }}>
            {footer}
          </div>
        </div>
      </div>

      {/* ══════════ MOBILE ══════════ */}
      <div className="flex lg:hidden flex-col h-full relative overflow-hidden">
        {bgLayers}
        <div className="absolute top-0 left-0 w-full h-[30%] bg-[radial-gradient(ellipse_at_50%_0%,rgba(255,255,255,0.12)_0%,rgba(255,255,255,0.04)_40%,transparent_70%)] z-[1]" />
        <div className="absolute top-[5%] right-[-10%] w-[200px] h-[200px] rounded-full bg-brand-500/[0.06] blur-[60px] animate-pulse-slow" />

        <div className="relative z-10 flex flex-col h-full overflow-y-auto">
          <div className="flex flex-col min-h-full px-5 pt-6 pb-4">

            {/* Logo */}
            <div className={`shrink-0 flex flex-col items-center text-center mb-6 transition-all duration-600 ${mounted ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0'}`}>
              {logo('md')}
            </div>

            {mobilePills && (
              <div className={`shrink-0 mb-5 transition-all duration-600 delay-100 ${mounted ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}>
                {mobilePills}
              </div>
            )}

            {/* Carte formulaire */}
            <div className={`flex-1 flex flex-col justify-center min-h-0 transition-all duration-600 delay-200 ${mounted ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}>
              {glassCard(true)}
            </div>

            {/* Pied de page + confiance */}
            <div className={`shrink-0 mt-4 space-y-3 transition-all duration-500 delay-400 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
              {ecoBadge}
              {TrustSignals()}
              <div className="text-center text-[10px] text-slate-600">
                &copy; {new Date().getFullYear()} WAARWI
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
