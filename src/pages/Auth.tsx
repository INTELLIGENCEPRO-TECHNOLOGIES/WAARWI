import { useEffect, useState } from 'react';
import { Loader2, Car, Shirt, Cpu, Apple, Briefcase, Store, ArrowRight, Mail, Lock, Building2, User } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { useTenantBranding } from '../lib/tenantBranding';

const BUSINESS_TYPES = [
  { value: 'auto_parts', label: 'Pièces automobiles', desc: 'Catalogue de marques et pièces pré-chargé', icon: Car },
  { value: 'fashion', label: 'Mode & Textile', desc: 'Vêtements, chaussures, accessoires', icon: Shirt },
  { value: 'electronics', label: 'Électronique', desc: 'Téléphonie, informatique, high-tech', icon: Cpu },
  { value: 'grocery', label: 'Alimentation', desc: 'Supérette, épicerie, produits frais', icon: Apple },
  { value: 'services', label: 'Services', desc: 'Prestations, conseil, artisanat', icon: Briefcase },
  { value: 'generic', label: 'Autre commerce', desc: 'Catalogue vierge, à vous de créer', icon: Store },
];

export function Auth() {
  const { signIn, signUp } = useApp();
  const { error } = useToast();
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
  const [submitted, setSubmitted] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'login') {
        await signIn(email, password);
      } else {
        await signUp(email, password, fullName, companyName, businessType);
        setSubmitted(true);
      }
    } catch (err: any) {
      error(err.message || 'Une erreur est survenue');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <AuthShell>
        <div className="w-full max-w-md mx-auto">
          <div className="bg-white/80 backdrop-blur-xl border border-white/60 rounded-3xl shadow-[0_20px_80px_-20px_rgba(15,23,42,0.25)] p-8 text-center">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-100 flex items-center justify-center mb-4">
              <Loader2 className="w-7 h-7 text-amber-600 animate-spin" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Compte en attente de validation</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Merci pour votre inscription. Un administrateur de la plateforme doit approuver votre compte avant que vous puissiez accéder à l'application. Vous recevrez un email dès validation.
            </p>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="w-full max-w-md mx-auto">
        {/* Brand block — logo + nom, puis slogan (pas de doublon) */}
        <div className="flex flex-col items-center mb-8 relative">
          {/* Soft aura behind logo */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-48 rounded-full bg-gradient-to-br from-brand-400/30 via-brand-300/20 to-transparent blur-3xl tenant-glow-aura" aria-hidden />

          {isTenantBranded && branding?.logo_url ? (
            <img
              src={branding.logo_url}
              alt={brandName}
              className="relative w-32 h-32 object-contain tenant-logo-reveal drop-shadow-[0_10px_30px_rgba(15,23,42,0.15)]"
            />
          ) : (
            <img
              src="/waarwi-logo.png"
              alt="WAARWI"
              className="relative w-48 h-auto object-contain tenant-logo-reveal drop-shadow-[0_10px_30px_rgba(15,23,42,0.15)]"
            />
          )}

          {/* Nom tenant : affiché uniquement si on est sur un tenant ET que le logo seul ne contient pas déjà le nom.
              Pour WAARWI en fallback, le logo contient déjà le mot "WAARWI", donc on ne le répète pas. */}
          {isTenantBranded && (
            <h1 className="relative text-2xl font-bold text-slate-900 text-center mt-3 tenant-name-reveal">
              {brandName}
            </h1>
          )}

          {brandTagline && (
            <p className="relative text-[13px] text-slate-600 mt-2 text-center tenant-sub-reveal max-w-xs">
              {brandTagline}
            </p>
          )}
        </div>

        {/* Card */}
        <div className="bg-white/85 backdrop-blur-xl border border-white/70 rounded-3xl shadow-[0_30px_80px_-30px_rgba(15,23,42,0.3)] p-6 sm:p-8 ring-1 ring-slate-900/[0.02]">
          {!isTenantBranded && (
            <div className="flex bg-slate-100/80 rounded-xl p-1 mb-6">
              <button
                onClick={() => setMode('login')}
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >Connexion</button>
              <button
                onClick={() => setMode('register')}
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${mode === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >Créer un compte</button>
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            {mode === 'register' && (
              <>
                <InputField icon={Building2} label="Nom de l'entreprise" value={companyName} onChange={setCompanyName} placeholder="Ex: Sénégal Auto Parts" required />
                <InputField icon={User} label="Votre nom complet" value={fullName} onChange={setFullName} placeholder="Ex: Amadou Diallo" required />
                <div>
                  <label className="label">Type de commerce</label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    {BUSINESS_TYPES.map(bt => {
                      const Icon = bt.icon;
                      const active = businessType === bt.value;
                      return (
                        <button
                          key={bt.value}
                          type="button"
                          onClick={() => setBusinessType(bt.value)}
                          className={`text-left p-3 rounded-xl border-2 transition-all ${active ? 'border-brand-600 bg-brand-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                        >
                          <Icon className={`w-4 h-4 mb-1.5 ${active ? 'text-brand-700' : 'text-slate-500'}`} />
                          <div className={`text-xs font-semibold ${active ? 'text-brand-900' : 'text-slate-800'}`}>{bt.label}</div>
                          <div className="text-[10px] text-slate-500 leading-tight mt-0.5">{bt.desc}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
            <InputField icon={Mail} type="email" label="Email" value={email} onChange={setEmail} placeholder="vous@entreprise.sn" required />
            <InputField icon={Lock} type="password" label="Mot de passe" value={password} onChange={setPassword} placeholder="6 caractères minimum" required minLength={6} />

            <button
              disabled={loading}
              type="submit"
              className="group relative w-full py-3 rounded-xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-800 text-white font-semibold shadow-[0_10px_30px_-10px_rgba(15,118,110,0.6)] hover:shadow-[0_14px_40px_-12px_rgba(15,118,110,0.7)] hover:from-brand-500 hover:to-brand-800 transition-all duration-300 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 overflow-hidden"
            >
              <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" aria-hidden />
              <span className="relative inline-flex items-center gap-2">
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {mode === 'login' ? 'Se connecter' : 'Créer mon entreprise'}
                {!loading && <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />}
              </span>
            </button>

            {mode === 'register' && (
              <p className="text-[11px] text-slate-500 text-center leading-relaxed">
                Votre compte sera soumis à validation par un administrateur avant activation.
              </p>
            )}
          </form>
        </div>

        {/* Footer : Propulsée par WAARWI en gras, slogan ligne suivante */}
        <div className="mt-8 text-center space-y-1">
          <div className="text-[13px] font-bold text-slate-700 tracking-wide">
            Propulsée par WAARWI
          </div>
          <div className="text-[11px] text-slate-500 font-normal">
            Plateforme Business 2.0 made in Sénégal
          </div>
        </div>
      </div>
    </AuthShell>
  );
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center p-4"
         style={{
           background:
             'radial-gradient(1400px 700px at 85% -20%, rgba(13,148,136,0.12), transparent 60%),' +
             'radial-gradient(1200px 600px at -10% 120%, rgba(20,184,166,0.10), transparent 60%),' +
             'radial-gradient(800px 400px at 50% 50%, rgba(15,118,110,0.04), transparent 70%),' +
             'linear-gradient(180deg, #f8fafc 0%, #ffffff 60%, #f1f5f9 100%)',
         }}
    >
      {/* subtle animated orbs */}
      <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] rounded-full bg-gradient-to-br from-brand-400/20 via-brand-300/10 to-transparent blur-3xl tenant-glow-aura" aria-hidden />
      <div className="absolute bottom-[-15%] left-[-15%] w-[600px] h-[600px] rounded-full bg-gradient-to-tr from-teal-300/15 via-brand-200/10 to-transparent blur-3xl" aria-hidden />

      {/* grid dot pattern */}
      <div
        className="absolute inset-0 opacity-[0.25] pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(rgba(15,23,42,0.08) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          maskImage: 'radial-gradient(ellipse at center, black 40%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, black 40%, transparent 75%)',
        }}
        aria-hidden
      />

      <div className="relative z-10 w-full">
        {children}
      </div>
    </div>
  );
}

function InputField({
  icon: Icon, label, value, onChange, placeholder, type = 'text', required, minLength,
}: {
  icon: any; label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; required?: boolean; minLength?: number;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="relative">
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          required={required}
          type={type}
          minLength={minLength}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="input pl-10"
        />
      </div>
    </div>
  );
}
