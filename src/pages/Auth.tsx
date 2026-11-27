import { useEffect, useState } from 'react';
import { Loader2, Eye, EyeOff, Shield } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { useTenantBranding } from '../lib/tenantBranding';
import { AccentedText } from '../components/AccentedText';
import { useLoginConfig, LOGIN_ICON_MAP } from '../lib/loginConfig';

function AuthLoadingOverlay({ logoSrc, brandName }: { logoSrc: string; brandName: string }) {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-white">
      <img src={logoSrc} alt={brandName} className="h-8 w-auto object-contain mb-6 w-platform-logo" />
      <Loader2 className="w-5 h-5 animate-spin text-neutral-400" />
    </div>
  );
}

type LucideIcon = React.ComponentType<{ className?: string }>;

function UnderlineInput({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  required,
  icon: Icon,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  icon?: LucideIcon;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-neutral-500 uppercase tracking-wide mb-1">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      <div className="relative">
        {Icon && (
          <Icon className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-300 pointer-events-none" />
        )}
        <input
          required={required}
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-input-ul h-11 text-[15px] ${Icon ? 'pl-6' : 'pl-0'} pr-0`}
        />
      </div>
      {hint && <p className="mt-1 text-[11px] text-neutral-400">{hint}</p>}
    </div>
  );
}

export function Auth({ onRegister }: { onRegister: () => void }) {
  const { signIn } = useApp();
  const { error: showError } = useToast();
  const { branding } = useTenantBranding();
  const { config: loginConfig } = useLoginConfig();

  const isTenantBranded = !!branding;
  const brandName = branding?.name || 'WAARWI';

  /* ---- Carousel state ---- */
  const [carouselSlide, setCarouselSlide] = useState(0);
  const [carouselAnim, setCarouselAnim] = useState<'in' | 'out'>('in');
  const carouselModules = loginConfig.modules;
  const carouselTotalSlides = Math.ceil(carouselModules.length / 3);
  const carouselSlideModules = carouselModules.slice(carouselSlide * 3, carouselSlide * 3 + 3);

  useEffect(() => {
    if (carouselTotalSlides <= 1) return;
    const interval = loginConfig.carousel_interval_ms || 4000;
    const timer = setInterval(() => {
      setCarouselAnim('out');
      setTimeout(() => {
        setCarouselSlide(prev => (prev + 1) % carouselTotalSlides);
        setCarouselAnim('in');
      }, 300);
    }, interval);
    return () => clearInterval(timer);
  }, [carouselTotalSlides, loginConfig.carousel_interval_ms]);

  /* ---- Form state ---- */
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState(() => localStorage.getItem('waarwi_remember_email') || '');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(() => !!localStorage.getItem('waarwi_remember_email'));
  const [showPassword, setShowPassword] = useState(false);

  /* ---- Submit login ---- */
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
  const year = new Date().getFullYear();

  if (loading) return <AuthLoadingOverlay logoSrc={logoSrc} brandName={brandName} />;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-white">
      {/* Top: logo left aligned, desktop only */}
      <header className="hidden lg:flex items-center px-10 pt-8">
        <img src={logoSrc} alt={brandName} className="h-8 w-auto w-platform-logo" />
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-8 lg:px-10">
        <div className="w-full max-w-[1060px]">
          <div className="grid items-center gap-10 lg:grid-cols-[1fr_420px] lg:gap-24">

            {/* LEFT: Editorial zone — hidden on mobile */}
            <div className="hidden lg:block max-w-[500px]">
              {/* Eyebrow */}
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400 mb-5">
                {loginConfig.eyebrow}
              </p>

              {/* Headline with accents */}
              <h1 className="text-[clamp(34px,4vw,52px)] leading-[1.06] tracking-[-0.03em] font-bold text-neutral-900">
                <AccentedText
                  text={loginConfig.headline + ' ' + loginConfig.headline_accent}
                  accents={loginConfig.text_accents}
                />
              </h1>

              {/* Subtitle */}
              <p className="mt-5 max-w-[420px] text-[15px] leading-[1.75] text-neutral-500">
                <AccentedText text={loginConfig.subtitle} accents={loginConfig.text_accents} />
              </p>

              {/* Carousel — NO cards, just content on white */}
              {carouselModules.length > 0 && (
                <div className="mt-10">
                  <div
                    style={{
                      opacity: carouselAnim === 'in' ? 1 : 0,
                      transform: carouselAnim === 'in' ? 'translateY(0)' : 'translateY(6px)',
                      transition: 'opacity 0.3s ease, transform 0.3s ease',
                    }}
                    className="space-y-3"
                  >
                    {carouselSlideModules.map((m, i) => {
                      const IconC = LOGIN_ICON_MAP[m.icon] || Shield;
                      return (
                        <div key={`${carouselSlide}-${i}`} className="flex items-center gap-4">
                          <div className="w-9 h-9 rounded-full bg-neutral-50 flex items-center justify-center flex-shrink-0">
                            <IconC className="w-4 h-4 text-neutral-600" />
                          </div>
                          <div>
                            <p className="text-[13px] font-bold text-neutral-800 leading-tight">{m.label}</p>
                            <p className="text-[11px] text-neutral-400 leading-snug mt-0.5">{m.desc}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Dots */}
                  {carouselTotalSlides > 1 && (
                    <div className="flex gap-1.5 mt-5">
                      {Array.from({ length: carouselTotalSlides }).map((_, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            setCarouselAnim('out');
                            setTimeout(() => { setCarouselSlide(i); setCarouselAnim('in'); }, 300);
                          }}
                          className={`rounded-full transition-all ${
                            i === carouselSlide
                              ? 'w-5 h-1 bg-neutral-900'
                              : 'w-1.5 h-1 bg-neutral-300 hover:bg-neutral-400'
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* RIGHT: Login form — NO card wrapper */}
            <div className="w-full max-w-[400px] mx-auto lg:mx-0">
              {/* Mobile logo */}
              <div className="lg:hidden flex justify-center mb-12">
                <img src={logoSrc} alt={brandName} className="h-9 w-auto w-platform-logo" />
              </div>

              <div className="mb-8">
                <h2 className="text-[26px] font-bold text-neutral-900 tracking-[-0.02em]">
                  <AccentedText text={loginConfig.login_title} accents={loginConfig.text_accents} />
                </h2>
                <p className="mt-2 text-[14px] text-neutral-400">
                  <AccentedText text={loginConfig.login_subtitle} accents={loginConfig.text_accents} />
                </p>
              </div>

              <form onSubmit={loginSubmit} className="space-y-6">
                {/* Email */}
                <UnderlineInput
                  label="Adresse email"
                  type="email"
                  required
                  value={email}
                  onChange={setEmail}
                  placeholder="vous@entreprise.com"
                />

                {/* Password with forgot link */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[13px] font-medium text-neutral-500 uppercase tracking-wide">
                      Mot de passe
                    </label>
                    <button
                      type="button"
                      className="text-[11px] font-medium text-neutral-400 hover:text-neutral-900 transition-colors"
                    >
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
                      className="w-input-ul h-11 text-[15px] pl-0 pr-8"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-0 top-1/2 -translate-y-1/2 text-neutral-300 hover:text-neutral-600 transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Remember me */}
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={e => setRememberMe(e.target.checked)}
                    className="w-3.5 h-3.5 rounded-sm border-neutral-300 text-neutral-900 focus:ring-neutral-900/10"
                  />
                  <span className="text-[13px] text-neutral-400">Se souvenir de moi</span>
                </label>

                {/* COMPACT button - NOT full width */}
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={loading}
                    className="h-11 px-10 bg-neutral-900 text-white text-[14px] font-semibold hover:bg-black transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Se connecter'}
                  </button>
                </div>
              </form>

              {/* Secondary links */}
              {!isTenantBranded && (
                <div className="mt-8 space-y-2">
                  <p className="text-[13px] text-neutral-400">
                    Nouveau sur Waarwi ?{' '}
                    <button
                      onClick={onRegister}
                      className="font-semibold text-neutral-900 hover:underline underline-offset-4"
                    >
                      Créer un compte
                    </button>
                  </p>
                  <p className="text-[12px] text-neutral-400">
                    Besoin d'aide ?{' '}
                    <a
                      href="https://wa.me/221775254101"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-neutral-500 hover:text-neutral-900 transition-colors"
                    >
                      Contacter l'assistance
                    </a>
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-4 px-6 text-center lg:text-left">
        <div className="max-w-[1060px] mx-auto flex flex-col lg:flex-row lg:items-center lg:justify-between gap-1">
          <p className="text-[11px] text-neutral-400">
            &copy; {year} Waarwi │ Intelligencepro Technologies
          </p>
          <p className="text-[11px] text-neutral-400">
            <a href="https://wa.me/221775254101" className="hover:text-neutral-600 transition-colors">Assistance</a>
            {' │ '}
            <a href="https://waarwi.com/confidentialite" className="hover:text-neutral-600 transition-colors">Confidentialité</a>
            {' │ '}
            <a href="https://waarwi.com/cgu" className="hover:text-neutral-600 transition-colors">CGU</a>
            {' │ '}
            <span>Conçu au Sénégal</span>
          </p>
        </div>
      </footer>
    </div>
  );
}
