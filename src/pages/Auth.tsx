import { useEffect, useState, useMemo, useRef } from 'react';
import {
  Loader2, Mail, Lock, Building2, User, Eye, EyeOff,
  CheckCircle2, ChevronDown, Briefcase, Package,
  Users, Phone, MapPin, Check, Star, ArrowLeft, ArrowRight, Search, Shield,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { useTenantBranding } from '../lib/tenantBranding';
import { useLoginConfig, LOGIN_ICON_MAP, TextAccent } from '../lib/loginConfig';
import { supabase } from '../lib/supabase';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  AuthLoadingOverlay                                                 */
/* ------------------------------------------------------------------ */

function AuthLoadingOverlay({ logoSrc, brandName }: { logoSrc: string; brandName: string }) {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-white">
      <img src={logoSrc} alt={brandName} className="h-8 w-auto object-contain mb-6" />
      <Loader2 className="w-5 h-5 animate-spin text-neutral-400" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AccentedText                                                       */
/* ------------------------------------------------------------------ */

function AccentedText({ text, accents }: { text: string; accents: TextAccent[] }) {
  if (!accents || accents.length === 0) return <>{text}</>;

  type Segment = { content: string; accent?: TextAccent };
  let segments: Segment[] = [{ content: text }];

  for (const accent of accents) {
    const next: Segment[] = [];
    for (const seg of segments) {
      if (seg.accent) {
        next.push(seg);
        continue;
      }
      const idx = seg.content.indexOf(accent.text);
      if (idx === -1) {
        next.push(seg);
        continue;
      }
      if (idx > 0) next.push({ content: seg.content.slice(0, idx) });
      next.push({ content: accent.text, accent });
      const rest = seg.content.slice(idx + accent.text.length);
      if (rest) next.push({ content: rest });
    }
    segments = next;
  }

  return (
    <>
      {segments.map((seg, i) => {
        if (!seg.accent) return <span key={i}>{seg.content}</span>;
        const { effect, color } = seg.accent;

        if (effect === 'underline') {
          return (
            <span
              key={i}
              style={{
                backgroundImage: `linear-gradient(120deg, ${color}44 0%, ${color}66 100%)`,
                backgroundSize: '100% 6px',
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'bottom',
                paddingBottom: 2,
              }}
            >
              {seg.content}
            </span>
          );
        }
        if (effect === 'paint') {
          return (
            <span
              key={i}
              className="relative inline"
              style={{ padding: '0 4px' }}
            >
              <span
                className="absolute inset-0 -skew-x-1"
                style={{ background: `${color}25`, borderRadius: 3, transform: 'skewX(-2deg) scaleY(0.85)' }}
              />
              <span className="relative">{seg.content}</span>
            </span>
          );
        }
        if (effect === 'highlight') {
          return (
            <span
              key={i}
              style={{
                background: `${color}22`,
                padding: '2px 6px',
                borderRadius: 2,
              }}
            >
              {seg.content}
            </span>
          );
        }
        if (effect === 'brush') {
          return (
            <span
              key={i}
              style={{
                borderBottom: `3px solid ${color}`,
                paddingBottom: 2,
                display: 'inline',
              }}
            >
              {seg.content}
            </span>
          );
        }
        if (effect === 'splash') {
          return (
            <span
              key={i}
              style={{
                color,
                fontStyle: 'italic',
              }}
            >
              {seg.content}
            </span>
          );
        }
        if (effect === 'circle') {
          return (
            <span key={i} className="relative inline-block">
              <svg
                className="absolute pointer-events-none"
                style={{ left: '-12%', top: '-20%', width: '124%', height: '140%' }}
                viewBox="0 0 200 100"
                fill="none"
                preserveAspectRatio="none"
              >
                <path
                  d="M30 50 C30 25, 60 12, 100 10 C140 8, 175 22, 178 48 C181 74, 150 90, 105 92 C60 94, 25 78, 28 55 C29 52, 30 50, 32 48"
                  stroke={color}
                  strokeWidth="3"
                  strokeLinecap="round"
                  fill="none"
                  opacity="0.85"
                />
              </svg>
              <span className="relative">{seg.content}</span>
            </span>
          );
        }
        if (effect === 'starburst') {
          return (
            <span key={i} className="relative inline-block">
              <svg
                className="absolute pointer-events-none"
                style={{ left: '-25%', top: '-50%', width: '150%', height: '200%' }}
                viewBox="0 0 100 100"
                fill="none"
                preserveAspectRatio="none"
              >
                {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
                  const rad = (angle * Math.PI) / 180;
                  const x1 = 50 + 24 * Math.cos(rad);
                  const y1 = 50 + 24 * Math.sin(rad);
                  const x2 = 50 + 40 * Math.cos(rad);
                  const y2 = 50 + 40 * Math.sin(rad);
                  return (
                    <line key={angle} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="2.5" strokeLinecap="round" />
                  );
                })}
                {[22, 67, 112, 157, 202, 247, 292, 337].map((angle) => {
                  const rad = (angle * Math.PI) / 180;
                  const x1 = 50 + 26 * Math.cos(rad);
                  const y1 = 50 + 26 * Math.sin(rad);
                  const x2 = 50 + 34 * Math.cos(rad);
                  const y2 = 50 + 34 * Math.sin(rad);
                  return (
                    <line key={`s${angle}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="1.5" strokeLinecap="round" />
                  );
                })}
                {[0, 90, 180, 270].map((angle) => {
                  const rad = (angle * Math.PI) / 180;
                  const cx = 50 + 44 * Math.cos(rad);
                  const cy = 50 + 44 * Math.sin(rad);
                  return (
                    <circle key={`d${angle}`} cx={cx} cy={cy} r="1.8" fill={color} />
                  );
                })}
              </svg>
              <span className="relative" style={{ color }}>{seg.content}</span>
            </span>
          );
        }
        if (effect === 'marker') {
          return (
            <span key={i} className="relative inline">
              <span
                className="absolute left-[-2px] right-[-2px]"
                style={{
                  background: `linear-gradient(92deg, ${color}99 0%, ${color}77 30%, ${color}88 60%, ${color}99 100%)`,
                  height: '55%',
                  bottom: '12%',
                  borderRadius: '2px 4px 3px 2px',
                  transform: 'skewX(-2deg) rotate(-0.3deg)',
                }}
              />
              <span className="relative">{seg.content}</span>
            </span>
          );
        }
        if (effect === 'wavyUnderline') {
          return (
            <span key={i} className="relative inline-block">
              <svg
                className="absolute left-0 pointer-events-none"
                style={{ bottom: '-4px', width: '100%', height: '10px' }}
                viewBox="0 0 120 10"
                fill="none"
                preserveAspectRatio="none"
              >
                <path
                  d="M0 6 C5 2, 10 2, 15 6 S25 10, 30 6 S40 2, 45 6 S55 10, 60 6 S70 2, 75 6 S85 10, 90 6 S100 2, 105 6 S115 10, 120 6"
                  stroke={color}
                  strokeWidth="3"
                  strokeLinecap="round"
                  fill="none"
                  opacity="0.8"
                />
              </svg>
              <span className="relative">{seg.content}</span>
            </span>
          );
        }
        if (effect === 'shortUnderline') {
          return (
            <span key={i} className="relative inline-block">
              <span
                className="absolute left-1/4 right-1/4"
                style={{
                  bottom: '-2px',
                  height: '4px',
                  background: color,
                  borderRadius: '2px',
                }}
              />
              <span className="relative">{seg.content}</span>
            </span>
          );
        }
        if (effect === 'paintStroke') {
          return (
            <span key={i} className="relative inline">
              <svg
                className="absolute pointer-events-none left-[-4px] right-[-4px]"
                style={{ top: '15%', width: 'calc(100% + 8px)', height: '70%' }}
                viewBox="0 0 200 40"
                fill="none"
                preserveAspectRatio="none"
              >
                <path
                  d="M4 20 C20 8, 50 32, 80 18 C110 4, 140 30, 170 16 C185 10, 195 22, 198 20"
                  stroke={color}
                  strokeWidth="28"
                  strokeLinecap="round"
                  fill="none"
                  opacity="0.25"
                />
              </svg>
              <span className="relative">{seg.content}</span>
            </span>
          );
        }
        if (effect === 'strikethrough') {
          return (
            <span key={i} className="relative inline">
              <span
                className="absolute left-0 right-0"
                style={{
                  top: '50%',
                  height: '3px',
                  background: color,
                  borderRadius: '1px',
                  transform: 'rotate(-1deg)',
                }}
              />
              <span className="relative">{seg.content}</span>
            </span>
          );
        }
        if (effect === 'glow') {
          return (
            <span
              key={i}
              style={{
                color,
                textShadow: `0 0 8px ${color}66, 0 0 20px ${color}33`,
              }}
            >
              {seg.content}
            </span>
          );
        }
        if (effect === 'boxed') {
          return (
            <span
              key={i}
              style={{
                border: `2.5px solid ${color}`,
                padding: '1px 8px',
                borderRadius: '4px',
                display: 'inline',
              }}
            >
              {seg.content}
            </span>
          );
        }
        return <span key={i}>{seg.content}</span>;
      })}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  UnderlineInput                                                     */
/* ------------------------------------------------------------------ */

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
          className={`w-full h-11 bg-transparent border-0 border-b border-neutral-200 focus:border-neutral-900 focus:outline-none focus:ring-0 text-[15px] text-neutral-900 placeholder:text-neutral-300 transition-colors ${Icon ? 'pl-6' : 'pl-0'} pr-0`}
        />
      </div>
      {hint && <p className="mt-1 text-[11px] text-neutral-400">{hint}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  UnderlinePassword                                                  */
/* ------------------------------------------------------------------ */

function UnderlinePassword({
  value,
  onChange,
  show,
  toggleShow,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  toggleShow: () => void;
  placeholder?: string;
  label?: string;
}) {
  return (
    <div>
      {label && (
        <label className="block text-[13px] font-medium text-neutral-500 uppercase tracking-wide mb-1">
          {label}<span className="text-red-400 ml-0.5">*</span>
        </label>
      )}
      <div className="relative">
        <input
          required
          type={show ? 'text' : 'password'}
          minLength={6}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full h-11 bg-transparent border-0 border-b border-neutral-200 focus:border-neutral-900 focus:outline-none focus:ring-0 text-[15px] text-neutral-900 placeholder:text-neutral-300 transition-colors pl-0 pr-8"
        />
        <button
          type="button"
          onClick={toggleShow}
          className="absolute right-0 top-1/2 -translate-y-1/2 text-neutral-300 hover:text-neutral-600 transition-colors"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ActivityTypeSelect                                                 */
/* ------------------------------------------------------------------ */

function ActivityTypeSelect({
  activityTypes,
  value,
  onChange,
}: {
  activityTypes: BusinessActivityType[];
  value: string;
  onChange: (v: string) => void;
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
      <label className="block text-[13px] font-medium text-neutral-500 uppercase tracking-wide mb-1">
        Type d'activité<span className="text-red-400 ml-0.5">*</span>
      </label>
      <button
        type="button"
        onClick={() => { setOpen(!open); setSearch(''); }}
        className="w-full h-11 bg-transparent border-0 border-b border-neutral-200 focus:border-neutral-900 focus:outline-none text-left text-[15px] text-neutral-900 transition-colors cursor-pointer relative pr-8"
      >
        <span className={value ? 'text-neutral-900' : 'text-neutral-300'}>{selectedLabel}</span>
        <ChevronDown className={`absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-2 bg-white shadow-[0_8px_30px_rgba(0,0,0,0.08)] overflow-hidden">
          <div className="p-2 border-b border-neutral-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Rechercher..."
                className="w-full h-9 pl-8 pr-3 bg-neutral-50 border-0 text-[13px] text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-0"
              />
            </div>
          </div>
          <div className="max-h-[200px] overflow-y-auto py-1">
            {filtered.length === 0 && (
              <p className="text-center text-[13px] text-neutral-400 py-3">Aucun résultat</p>
            )}
            {filtered.map(opt => (
              <button
                key={opt.id}
                type="button"
                onClick={() => { onChange(opt.slug); setOpen(false); setSearch(''); }}
                className={`w-full text-left px-4 py-2.5 text-[14px] transition-colors flex items-center justify-between ${
                  opt.slug === value
                    ? 'bg-neutral-50 text-neutral-900 font-medium'
                    : 'text-neutral-700 hover:bg-neutral-50'
                }`}
              >
                {opt.name}
                {opt.slug === value && <Check className="w-3.5 h-3.5 text-neutral-900" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PlanCard                                                           */
/* ------------------------------------------------------------------ */

function PlanCard({
  plan,
  selected,
  onSelect,
  popular,
  billingCycle = 'monthly',
}: {
  plan: Plan;
  selected: boolean;
  onSelect: () => void;
  popular?: boolean;
  billingCycle?: 'monthly' | 'yearly';
}) {
  const limits = plan.limits || {};
  const isYearly = billingCycle === 'yearly';
  const price = isYearly ? plan.price_yearly : plan.price_monthly;
  const monthlyEquivalent = isYearly && plan.price_yearly > 0 ? Math.round(plan.price_yearly / 12) : null;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`relative text-left w-full border p-4 transition-all ${
        selected
          ? 'border-neutral-900 bg-white'
          : 'border-neutral-200 bg-white hover:border-neutral-400'
      }`}
    >
      {popular && (
        <span className="absolute -top-2.5 left-4 text-[9px] font-bold bg-neutral-900 text-white px-2.5 py-0.5 uppercase tracking-wider inline-flex items-center gap-1">
          <Star className="w-2.5 h-2.5" />Recommandé
        </span>
      )}
      {selected && (
        <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-neutral-900 flex items-center justify-center">
          <Check className="w-3 h-3 text-white" />
        </div>
      )}
      <h3 className="text-base font-bold text-neutral-900">{plan.name}</h3>
      {plan.description && <p className="text-[11px] text-neutral-500 mt-0.5 line-clamp-1">{plan.description}</p>}
      <div className="mt-2 mb-3">
        {isYearly ? (
          <>
            <span className="text-xl font-extrabold text-neutral-900">{price > 0 ? `${Number(price).toLocaleString('fr-FR')}` : 'Gratuit'}</span>
            {price > 0 && <span className="text-xs text-neutral-500 ml-1">FCFA/an</span>}
            {monthlyEquivalent && <span className="block text-[11px] text-neutral-500 mt-0.5">soit {monthlyEquivalent.toLocaleString('fr-FR')} FCFA/mois</span>}
          </>
        ) : (
          <>
            <span className="text-xl font-extrabold text-neutral-900">{price > 0 ? `${Number(price).toLocaleString('fr-FR')}` : 'Gratuit'}</span>
            {price > 0 && <span className="text-xs text-neutral-500 ml-1">FCFA/mois</span>}
          </>
        )}
        {plan.trial_days > 0 && (
          <span className="ml-2 text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">{plan.trial_days}j d'essai</span>
        )}
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-xs text-neutral-600">
          <Package className="w-3 h-3 text-neutral-400" />
          <span>{limits.articles === -1 ? 'Articles illimités' : `${limits.articles || 100} articles`}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-600">
          <Users className="w-3 h-3 text-neutral-400" />
          <span>{limits.users === -1 ? 'Utilisateurs illimités' : `${limits.users || 2} utilisateur${(limits.users || 2) > 1 ? 's' : ''}`}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-600">
          <Building2 className="w-3 h-3 text-neutral-400" />
          <span>{limits.sites === -1 ? 'Magasins illimités' : `${limits.sites || 1} magasin${(limits.sites || 1) > 1 ? 's' : ''}`}</span>
        </div>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Inline Stepper                                                     */
/* ------------------------------------------------------------------ */

function InlineStepper({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-0">
      {Array.from({ length: total }).map((_, i) => {
        const stepNum = i + 1;
        const isActive = stepNum === current;
        const isDone = stepNum < current;
        return (
          <div key={i} className="flex items-center">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all ${
                isActive
                  ? 'bg-neutral-900 text-white'
                  : isDone
                    ? 'bg-neutral-900 text-white'
                    : 'bg-neutral-100 text-neutral-400'
              }`}
            >
              {isDone ? <Check className="w-3 h-3" /> : stepNum}
            </div>
            {i < total - 1 && (
              <div className={`w-8 h-px mx-1 ${isDone ? 'bg-neutral-900' : 'bg-neutral-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Auth component                                                */
/* ------------------------------------------------------------------ */

export function Auth() {
  const { signIn, signUp } = useApp();
  const { error: showError } = useToast();
  const { branding } = useTenantBranding();
  const { config: loginConfig } = useLoginConfig();

  useEffect(() => {
    if (branding) setMode('login');
  }, [branding]);

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

  /* ---- URL params ---- */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'register') setMode('register');
    const planParam = params.get('plan');
    if (planParam) setPendingPlanCode(planParam);
  }, []);

  const TOTAL_STEPS = 5;

  /* ---- Fetch activity types ---- */
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('business_activity_types').select('*').eq('is_active', true).order('name');
      if (data) {
        setActivityTypes(data);
        if (data.length > 0 && !businessType) setBusinessType(data[0].slug);
      }
    })();
  }, []);

  /* ---- Fetch plans ---- */
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

  /* ---- Derived values ---- */
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

  /* ---- Submit registration ---- */
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

  /* ================================================================ */
  /*  Render: Post-signup confirmation                                 */
  /* ================================================================ */

  if (submitted) {
    return (
      <div className="min-h-[100dvh] bg-white flex items-center justify-center p-5">
        <div className="w-full max-w-md text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-emerald-50 flex items-center justify-center border border-emerald-100 mb-6">
            <CheckCircle2 className="w-8 h-8 text-emerald-600" />
          </div>

          <h2 className="text-lg font-bold text-neutral-900">Demande d'inscription envoyée</h2>
          <p className="text-sm text-neutral-500 leading-relaxed mt-2 max-w-sm mx-auto">
            Votre compte est en attente de validation.
            Notre équipe vous contactera par WhatsApp ou email.
          </p>

          <div className="mt-8 text-left">
            {([
              ['Statut', <span key="s" className="text-[11px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">En attente</span>],
              ['Plan', selectedPlanObj?.name || selectedPlan],
              ['WhatsApp', whatsappPhone],
              ['Email', email || '\u2014'],
            ] as [string, React.ReactNode][]).map(([k, v], i, arr) => (
              <div
                key={k}
                className={`flex items-center justify-between py-3 ${
                  i < arr.length - 1 ? 'border-b border-neutral-100' : ''
                }`}
              >
                <span className="text-[12px] text-neutral-500">{k}</span>
                <span className="text-[12px] font-semibold text-neutral-800">{v}</span>
              </div>
            ))}
          </div>

          <button
            onClick={() => { setSubmitted(false); setMode('login'); setStep(1); }}
            className="mt-8 text-[13px] font-semibold text-neutral-900 hover:underline underline-offset-4"
          >
            Retour à la connexion
          </button>
        </div>
      </div>
    );
  }

  /* ================================================================ */
  /*  Render: Registration multi-step                                  */
  /* ================================================================ */

  if (mode === 'register') {
    return (
      <div className="min-h-[100dvh] bg-white flex items-center justify-center px-4 py-6">
        <div className="w-full max-w-[520px]">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <img src={logoSrc} alt={brandName} className="h-7 w-auto object-contain" />
            <button
              onClick={() => { setMode('login'); setStep(1); }}
              className="text-[13px] font-medium text-neutral-400 hover:text-neutral-900 transition-colors"
            >
              Se connecter
            </button>
          </div>

          {/* Stepper */}
          <div className="mb-8">
            <InlineStepper current={step} total={TOTAL_STEPS} />
          </div>

          {/* Step 1: Entreprise */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-bold text-neutral-900">Votre entreprise</h3>
                <p className="text-sm text-neutral-500 mt-0.5">Parlez-nous de votre activité.</p>
              </div>
              <UnderlineInput icon={Building2} label="Nom de l'entreprise" value={companyName} onChange={setCompanyName} required />
              <ActivityTypeSelect
                activityTypes={activityTypes}
                value={businessType}
                onChange={setBusinessType}
              />
              {selectedActivity?.description && businessType !== '__other__' && (
                <p className="-mt-2 text-[11px] text-neutral-500">{selectedActivity.description}</p>
              )}
              {businessType === '__other__' && (
                <UnderlineInput icon={Briefcase} label="Précisez votre activité" value={customActivity} onChange={setCustomActivity} required />
              )}
              <UnderlineInput icon={MapPin} label="Ville" value={city} onChange={setCity} />
              <UnderlineInput icon={MapPin} label="Adresse" value={address} onChange={setAddress} hint="Optionnel" />
              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  disabled={!step1Valid}
                  onClick={() => setStep(2)}
                  className="h-11 px-10 bg-neutral-900 text-white text-[14px] font-semibold hover:bg-black transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  Continuer <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Responsable */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-bold text-neutral-900">Le responsable</h3>
                <p className="text-sm text-neutral-500 mt-0.5">Vos coordonnées de contact.</p>
              </div>
              <UnderlineInput icon={User} label="Nom complet" value={fullName} onChange={setFullName} required />
              <UnderlineInput icon={Phone} label="Numéro WhatsApp" value={whatsappPhone} onChange={setWhatsappPhone} required hint="Canal principal de communication" />
              <UnderlineInput icon={Mail} label="Adresse email" value={email} onChange={setEmail} type="email" hint="Recommandé" />
              <UnderlineInput icon={Briefcase} label="Fonction" value={responsibleTitle} onChange={setResponsibleTitle} hint="Optionnel" />
              <div className="pt-2 flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="h-11 px-5 text-neutral-600 text-[14px] font-semibold border-b-2 border-neutral-300 hover:border-neutral-900 hover:text-neutral-900 transition-all flex items-center gap-2 bg-transparent"
                >
                  <ArrowLeft className="w-4 h-4" />Retour
                </button>
                <button
                  type="button"
                  disabled={!step2Valid}
                  onClick={() => setStep(3)}
                  className="h-11 px-10 bg-neutral-900 text-white text-[14px] font-semibold hover:bg-black transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  Continuer <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Plan */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-bold text-neutral-900">Choisissez votre plan</h3>
                <p className="text-sm text-neutral-500 mt-0.5">Essai gratuit inclus.</p>
              </div>
              <div className="flex items-center justify-center gap-0 border-b border-neutral-200">
                <button
                  type="button"
                  onClick={() => setBillingCycle('monthly')}
                  className={`flex-1 py-2.5 text-xs font-semibold transition-all border-b-2 -mb-px ${
                    billingCycle === 'monthly'
                      ? 'border-neutral-900 text-neutral-900'
                      : 'border-transparent text-neutral-400 hover:text-neutral-600'
                  }`}
                >
                  Mensuel
                </button>
                <button
                  type="button"
                  onClick={() => setBillingCycle('yearly')}
                  className={`flex-1 py-2.5 text-xs font-semibold transition-all border-b-2 -mb-px ${
                    billingCycle === 'yearly'
                      ? 'border-neutral-900 text-neutral-900'
                      : 'border-transparent text-neutral-400 hover:text-neutral-600'
                  }`}
                >
                  Annuel <span className="text-[9px] font-bold text-emerald-600 ml-1">-17%</span>
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 max-h-[300px] overflow-y-auto pr-1">
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
              <div className="pt-2 flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="h-11 px-5 text-neutral-600 text-[14px] font-semibold border-b-2 border-neutral-300 hover:border-neutral-900 hover:text-neutral-900 transition-all flex items-center gap-2 bg-transparent"
                >
                  <ArrowLeft className="w-4 h-4" />Retour
                </button>
                <button
                  type="button"
                  disabled={!step3Valid}
                  onClick={() => setStep(4)}
                  className="h-11 px-10 bg-neutral-900 text-white text-[14px] font-semibold hover:bg-black transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  Continuer <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Compte */}
          {step === 4 && (
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-bold text-neutral-900">Sécurisez votre compte</h3>
                <p className="text-sm text-neutral-500 mt-0.5">Créez vos identifiants.</p>
              </div>
              <UnderlineInput icon={Mail} label="Adresse email" value={email} onChange={setEmail} type="email" required />
              <UnderlinePassword
                value={password}
                onChange={setPassword}
                show={showPassword}
                toggleShow={() => setShowPassword(!showPassword)}
                placeholder=""
                label="Mot de passe"
              />
              <div className="pt-2 flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="h-11 px-5 text-neutral-600 text-[14px] font-semibold border-b-2 border-neutral-300 hover:border-neutral-900 hover:text-neutral-900 transition-all flex items-center gap-2 bg-transparent"
                >
                  <ArrowLeft className="w-4 h-4" />Retour
                </button>
                <button
                  type="button"
                  disabled={!step4Valid}
                  onClick={() => setStep(5)}
                  className="h-11 px-10 bg-neutral-900 text-white text-[14px] font-semibold hover:bg-black transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  Vérifier <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 5: Récapitulatif */}
          {step === 5 && (
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-bold text-neutral-900">Récapitulatif</h3>
                <p className="text-sm text-neutral-500 mt-0.5">Vérifiez avant de valider.</p>
              </div>

              <div>
                {([
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
                ] as [string, React.ReactNode][]).map(([k, v], i, arr) => (
                  <div
                    key={k}
                    className={`flex items-center justify-between py-3 ${
                      i < arr.length - 1 ? 'border-b border-neutral-100' : ''
                    }`}
                  >
                    <span className="text-[12px] text-neutral-500">{k}</span>
                    <span className="text-[12px] font-semibold text-neutral-800 truncate ml-3 max-w-[60%] text-right">{v}</span>
                  </div>
                ))}
              </div>

              <div className="pt-2 flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => setStep(4)}
                  className="h-11 px-5 text-neutral-600 text-[14px] font-semibold border-b-2 border-neutral-300 hover:border-neutral-900 hover:text-neutral-900 transition-all flex items-center gap-2 bg-transparent"
                >
                  <ArrowLeft className="w-4 h-4" />Retour
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={submit}
                  className="h-11 px-10 bg-neutral-900 text-white text-[14px] font-semibold hover:bg-black transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Envoyer ma demande'}
                </button>
              </div>
              <p className="text-[11px] text-neutral-400 text-center">Votre compte sera activé après validation par l'équipe Waarwi.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ================================================================ */
  /*  Render: Login loading overlay                                    */
  /* ================================================================ */

  if (loading && mode === 'login') {
    return <AuthLoadingOverlay logoSrc={logoSrc} brandName={brandName} />;
  }

  /* ================================================================ */
  /*  Render: Login page                                               */
  /* ================================================================ */

  return (
    <div className="min-h-[100dvh] flex flex-col bg-white">
      {/* Top: logo left aligned, desktop only */}
      <header className="hidden lg:flex items-center px-10 pt-8">
        <img src={logoSrc} alt={brandName} className="h-8 w-auto" />
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
                <img src={logoSrc} alt={brandName} className="h-9 w-auto" />
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
                      className="w-full h-11 bg-transparent border-0 border-b border-neutral-200 focus:border-neutral-900 focus:outline-none focus:ring-0 text-[15px] text-neutral-900 placeholder:text-neutral-300 transition-colors pl-0 pr-8"
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
                      onClick={() => { setMode('register'); setStep(1); }}
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
            &copy; {year} Waarwi &middot; Intelligencepro Technologies
          </p>
          <p className="text-[11px] text-neutral-400">
            <a href="https://wa.me/221775254101" className="hover:text-neutral-600 transition-colors">Assistance</a>
            {' · '}
            <a href="https://waarwi.com/confidentialite" className="hover:text-neutral-600 transition-colors">Confidentialité</a>
            {' · '}
            <a href="https://waarwi.com/cgu" className="hover:text-neutral-600 transition-colors">CGU</a>
            {' · '}
            <span>Conçu au Sénégal</span>
          </p>
        </div>
      </footer>
    </div>
  );
}
