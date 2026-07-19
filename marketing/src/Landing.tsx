import { useEffect, useRef, useState, useCallback } from 'react';
import {
  ShoppingCart, Package, FileText, Users, Truck, Globe,
  BarChart3, TrendingUp, Shield, Zap, Wallet, Layers, Monitor,
  Receipt, ArrowRight, Check, Phone, Menu, X, Wrench, Shirt,
  Cpu, Boxes, HeartPulse, BookOpen, Store, Gem, Sparkles, Building2,
  MapPin, Headphones, RefreshCw, UsersRound, Clock, MessageCircle,
  Mail, ChevronDown, LayoutDashboard, ClipboardList, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { supabase, APP_URL } from './lib/supabase';

type LandingFeature = { icon: string; title: string; desc: string };
type DemoShot = { src: string; alt: string; label: string };
type WhyItem = { icon: string; title: string; desc: string };
type FaqItem = { q: string; a: string };
type LandingConfig = {
  hero_headline: string;
  hero_accent: string;
  hero_subtitle: string;
  hero_cta_label: string;
  hero_image_url: string;
  stats_label_tenants: string;
  stats_label_sectors: string;
  stats_label_uptime: string;
  pricing_visible: boolean;
  features: LandingFeature[];
  footer_tagline: string;
  contact_email?: string;
  contact_hours?: string;
  testimonials?: { quote: string; author: string; role?: string; company?: string }[];
  client_logos?: { name: string; logo_url?: string }[];
  demo_desktop?: DemoShot[];
  demo_mobile?: DemoShot[];
  why_waarwi?: WhyItem[];
  faq_items?: FaqItem[];
  section_titles?: Record<string, string>;
  whatsapp_url?: string;
  phone_display?: string;
  phone_tel?: string;
};
type LandingStats = { active_tenants: number; active_sectors: number; uptime_percent: number };

type BusinessActivityType = {
  id: string;
  name: string;
  slug: string;
  description: string;
};

type Plan = {
  code: string;
  name: string;
  description: string;
  price_monthly: number;
  features: string[];
  is_public: boolean;
  sort_order: number;
};

const DEFAULT_CONFIG: LandingConfig = {
  hero_headline: 'Gérez votre caisse, vos ventes et votre stock depuis une seule plateforme.',
  hero_accent: '',
  hero_subtitle:
    "Waarwi centralise la facturation, les achats, le stock, les clients, la comptabilité SYSCOHADA et votre boutique en ligne. Une solution simple, accessible et adaptée aux commerçants sénégalais.",
  hero_cta_label: "Démarrer l'essai gratuit",
  hero_image_url: '/desktop.png',
  stats_label_tenants: 'entreprises accompagnées',
  stats_label_sectors: 'secteurs couverts',
  stats_label_uptime: 'Accompagnement local au Sénégal',
  pricing_visible: true,
  features: [],
  footer_tagline: 'Conçu au Sénégal, propulsé par INTELLIGENCEPRO TECHNOLOGIES',
  contact_email: '',
  contact_hours: '',
  testimonials: [],
  client_logos: [],
  demo_desktop: [],
  demo_mobile: [],
  why_waarwi: [],
  faq_items: [],
  section_titles: {},
  whatsapp_url: 'https://wa.me/221775254101',
  phone_display: '77 525 41 01',
  phone_tel: '+221775254101',
};

const ICON_MAP: Record<string, any> = {
  ShoppingCart, Package, FileText, Users, Truck, Globe,
  BarChart3, TrendingUp, Shield, Zap, Wallet, Layers, Monitor, Receipt,
  Sparkles, MapPin, Headphones, RefreshCw, UsersRound, Store, Boxes,
  BookOpen, Shirt, Cpu, HeartPulse, Building2, Gem, Wrench,
};

const SECTOR_ICONS: Record<string, any> = {
  auto_parts: Wrench,
  textile: Shirt,
  electromenager: Cpu,
  smartphones: Monitor,
  cosmetique: Sparkles,
  pharmacie: HeartPulse,
  quincaillerie: Boxes,
  librairie: BookOpen,
  mercerie: Layers,
  alimentaire: Store,
  services: Building2,
  bijoux: Gem,
  'bijoux-accessoires': Gem,
};

const DEFAULT_FEATURES: LandingFeature[] = [
  { icon: 'ShoppingCart', title: 'Point de vente', desc: 'Caisse rapide et intuitive, encaissement multi-moyens, sessions de caisse sécurisées.' },
  { icon: 'Package', title: 'Stock & inventaire', desc: 'Suivi en temps réel, alertes de rupture, gestion par lot et par site.' },
  { icon: 'FileText', title: 'Facturation', desc: 'Devis, factures, avoirs et retours conformes, conversion en vente en un clic.' },
  { icon: 'Users', title: 'Clients & tiers', desc: 'CRM complet, suivi des créances, plafonds de crédit et historique d\'achat.' },
  { icon: 'Truck', title: 'Fournisseurs', desc: 'Commandes d\'achat, réception, suivi des dettes et règlements.' },
  { icon: 'Globe', title: 'Boutique en ligne', desc: 'Vitrine web personnalisée, commandes en ligne, paiement à la livraison.' },
  { icon: 'BarChart3', title: 'Comptabilité', desc: 'Plan comptable SYSCOHADA, journal, balance, grand livre et clôture.' },
  { icon: 'TrendingUp', title: 'Rapports', desc: 'Tableaux de bord, analyses de ventes, marges et performance par produit.' },
  { icon: 'Shield', title: 'Sécurité & rôles', desc: "Permissions granulaires par utilisateur, journaux d'activité, sauvegardes." },
];

const DEFAULT_WHY_WAARWI: WhyItem[] = [
  { icon: 'MapPin', title: 'Conçu au Sénégal', desc: "Une solution pensée pour les réalités du commerce sénégalais, pas adaptée d'un logiciel étranger." },
  { icon: 'Headphones', title: 'Accompagnement local', desc: 'Une équipe sur place pour vous aider au démarrage et tout au long de votre utilisation.' },
  { icon: 'Shield', title: 'Sauvegardes & sécurité', desc: 'Vos données sont sauvegardées et protégées. Les rôles contrôlent qui voit quoi.' },
  { icon: 'UsersRound', title: 'Multi-utilisateurs', desc: 'Donnez accès à vos vendeurs, caissiers et comptables avec des permissions adaptées.' },
  { icon: 'RefreshCw', title: 'Synchronisation temps réel', desc: 'Vos ventes, votre stock et vos rapports se mettent à jour instantanément.' },
  { icon: 'Layers', title: 'Adapté à votre secteur', desc: 'Catalogues et configurations pré-remplis selon votre activité.' },
];

const DEFAULT_FAQ_ITEMS: FaqItem[] = [
  { q: 'Faut-il installer un logiciel ?', a: 'Non. Waarwi fonctionne directement dans votre navigateur, sur ordinateur, tablette ou téléphone. Aucune installation n\'est nécessaire.' },
  { q: "L'application fonctionne-t-elle sur téléphone ?", a: 'Oui. Waarwi est accessible depuis un navigateur web sur smartphone, et l\'interface de caisse est conçue pour un usage quotidien sur mobile.' },
  { q: 'Les données sont-elles sauvegardées ?', a: 'Oui. Vos données sont stockées de manière sécurisée et sauvegardées. Vous pouvez également exporter vos informations.' },
  { q: 'Peut-on gérer plusieurs utilisateurs ou magasins ?', a: 'Oui. Le plan Business inclut plusieurs magasins et plusieurs utilisateurs avec des permissions adaptées à chaque rôle (caissier, vendeur, gérant, comptable).' },
  { q: 'Quelles activités sont prises en charge ?', a: 'Waarwi couvre les pièces auto, le textile, l\'électroménager, les smartphones, la cosmétique, la pharmacie, la quincaillerie, la librairie, la mercerie, l\'alimentaire, les services et la bijouterie, avec des catalogues pré-remplis.' },
  { q: 'Comment fonctionne l\'essai gratuit ?', a: 'Vous bénéficiez de 14 jours d\'accès sans carte bancaire. À la fin de l\'essai, vous choisissez le plan qui vous convient, sans engagement.' },
  { q: 'Peut-on être accompagné lors du démarrage ?', a: 'Oui. Notre équipe vous accompagne dans la configuration de votre compte, votre catalogue et votre caisse pour démarrer sereinement.' },
];

const DEFAULT_DESKTOP_SHOTS: DemoShot[] = [
  { src: '/desktop.png', alt: 'Tableau de bord Waarwi — vue d\'ensemble des ventes et du stock', label: 'Tableau de bord' },
];

const DEFAULT_MOBILE_SHOTS: DemoShot[] = [
  { src: '/mobile.png', alt: 'Interface de caisse Waarwi sur mobile', label: 'Caisse' },
];

const DEFAULT_WHATSAPP_URL = 'https://wa.me/221775254101';
const DEFAULT_PHONE_DISPLAY = '77 525 41 01';
const DEFAULT_PHONE_TEL = '+221775254101';

function useCountUp(target: number, durationMs = 1400, start: boolean) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!start || target <= 0) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min((t - t0) / durationMs, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, start]);
  return val;
}

function StatCard({ value, label, start, suffix }: { value: number; label: string; start: boolean; suffix?: string }) {
  const v = useCountUp(value, 1400, start);
  return (
    <div className="text-center">
      <div className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight tabular-nums">
        {v}{suffix}
      </div>
      <div className="mt-1.5 text-xs md:text-sm text-slate-500 font-medium">{label}</div>
    </div>
  );
}

function TextStatCard({ label, icon: Icon }: { label: string; icon: any }) {
  return (
    <div className="text-center">
      <div className="flex justify-center mb-2">
        <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center">
          <Icon className="w-5 h-5 text-teal-700" />
        </div>
      </div>
      <div className="text-sm md:text-base font-semibold text-slate-900 leading-snug">{label}</div>
    </div>
  );
}

function useScrollSpy(ids: string[]) {
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => {
    const sections = ids.map(id => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    if (sections.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: '-45% 0px -50% 0px', threshold: [0, 0.25, 0.5, 1] },
    );
    sections.forEach(s => obs.observe(s));
    return () => obs.disconnect();
  }, [ids.join(',')]);
  return activeId;
}

function FaqItem({ q, a, id }: { q: string; a: string; id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-slate-200">
      <h3>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          id={`${id}-button`}
          className="w-full flex items-center justify-between gap-4 py-5 text-left text-slate-900 font-semibold hover:text-teal-700 transition-colors"
        >
          <span>{q}</span>
          <ChevronDown
            className={`w-5 h-5 flex-shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
      </h3>
      <div
        id={`${id}-panel`}
        role="region"
        aria-labelledby={`${id}-button`}
        hidden={!open}
        className="pb-5 pr-8 text-sm leading-relaxed text-slate-600"
      >
        {a}
      </div>
    </div>
  );
}

export function Landing() {
  const [config, setConfig] = useState<LandingConfig>(DEFAULT_CONFIG);
  const [stats, setStats] = useState<LandingStats | null>(null);
  const [sectors, setSectors] = useState<BusinessActivityType[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [statsStart, setStatsStart] = useState(false);
  const statsRef = useRef<HTMLDivElement>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [lightbox, setLightbox] = useState<{ column: 'desktop' | 'mobile'; index: number } | null>(null);
  const activeSection = useScrollSpy(['fonctionnalites', 'secteurs', ...(config.pricing_visible ? ['tarifs'] : []), 'demonstration', 'faq', 'contact']);

  useEffect(() => {
    let active = true;
    (async () => {
      const [cfgRes, statsRes, secRes, planRes] = await Promise.all([
        supabase.from('landing_config').select('*').eq('id', 'default').maybeSingle(),
        supabase.rpc('get_landing_stats'),
        supabase.from('business_activity_types').select('id, name, slug, description').eq('is_active', true).order('name'),
        supabase.from('plans').select('code, name, description, price_monthly, features, is_public, sort_order').eq('is_public', true).order('sort_order'),
      ]);
      if (!active) return;
      if (cfgRes.data) {
        setConfig({
          ...DEFAULT_CONFIG,
          ...cfgRes.data,
          features: Array.isArray(cfgRes.data.features) && cfgRes.data.features.length > 0 ? cfgRes.data.features : DEFAULT_FEATURES,
        } as LandingConfig);
      }
      const sRow = Array.isArray(statsRes.data) ? statsRes.data[0] : statsRes.data;
      if (sRow) setStats(sRow as LandingStats);
      if (secRes.data) setSectors(secRes.data as BusinessActivityType[]);
      if (planRes.data) setPlans(planRes.data as Plan[]);
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const el = statsRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) { setStatsStart(true); obs.disconnect(); } },
      { threshold: 0.3 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loading]);

  const features = config.features?.length ? config.features : DEFAULT_FEATURES;
  const closeMobileNav = () => setMobileNav(false);
  const goLogin = () => { window.location.href = `${APP_URL}`; };
  const registerUrl = (planCode?: string) =>
    planCode ? `${APP_URL}/login?mode=register&plan=${encodeURIComponent(planCode)}` : `${APP_URL}/login?mode=register`;

  const testimonials = Array.isArray(config.testimonials) ? config.testimonials : [];
  const clientLogos = Array.isArray(config.client_logos) ? config.client_logos : [];
  const contactEmail = config.contact_email?.trim() || '';
  const contactHours = config.contact_hours?.trim() || '';
  const whatsappUrl = config.whatsapp_url?.trim() || DEFAULT_WHATSAPP_URL;
  const phoneDisplay = config.phone_display?.trim() || DEFAULT_PHONE_DISPLAY;
  const phoneTel = config.phone_tel?.trim() || DEFAULT_PHONE_TEL;
  const desktopShots = (Array.isArray(config.demo_desktop) && config.demo_desktop.length > 0) ? config.demo_desktop : DEFAULT_DESKTOP_SHOTS;
  const mobileShots = (Array.isArray(config.demo_mobile) && config.demo_mobile.length > 0) ? config.demo_mobile : DEFAULT_MOBILE_SHOTS;
  const whyItems = (Array.isArray(config.why_waarwi) && config.why_waarwi.length > 0) ? config.why_waarwi : DEFAULT_WHY_WAARWI;
  const faqItems = (Array.isArray(config.faq_items) && config.faq_items.length > 0) ? config.faq_items : DEFAULT_FAQ_ITEMS;

  const openLightbox = useCallback((column: 'desktop' | 'mobile', index: number) => setLightbox({ column, index }), []);
  const closeLightbox = useCallback(() => setLightbox(null), []);
  const navLightbox = useCallback((dir: 1 | -1) => {
    setLightbox(prev => {
      if (!prev) return prev;
      const list = prev.column === 'desktop' ? desktopShots : mobileShots;
      if (list.length === 0) return prev;
      return { ...prev, index: (prev.index + dir + list.length) % list.length };
    });
  }, [desktopShots, mobileShots]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowRight') navLightbox(1);
      if (e.key === 'ArrowLeft') navLightbox(-1);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [lightbox, closeLightbox, navLightbox]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <img src="/newlogo.png" alt="Waarwi" className="w-16 h-16 object-contain" />
          <div className="w-6 h-6 border-2 border-slate-200 border-t-teal-700 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  const navLinks = [
    { href: '#fonctionnalites', label: 'Fonctionnalités' },
    { href: '#secteurs', label: 'Secteurs' },
    ...(config.pricing_visible ? [{ href: '#tarifs', label: 'Tarifs' }] : []),
    { href: '#faq', label: 'FAQ' },
    { href: '#contact', label: 'Contact' },
  ];

  return (
    <div className="min-h-screen bg-white text-slate-900" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-3 focus:left-3 focus:px-4 focus:py-2 focus:bg-white focus:text-slate-900 focus:rounded-lg focus:shadow-lg focus:border focus:border-slate-200"
      >
        Aller au contenu principal
      </a>

      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-5 md:px-8 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center" aria-label="Waarwi — accueil">
            <img src="/newlogo.png" alt="Waarwi" className="h-10 md:h-12 w-auto object-contain" />
          </a>
          <nav className="hidden md:flex items-center gap-7" aria-label="Navigation principale">
            {navLinks.map((l) => {
              const isActive = activeSection === l.href.slice(1);
              return (
                <a key={l.href} href={l.href} className={`relative text-sm font-medium transition-colors ${isActive ? 'text-slate-900' : 'text-slate-600 hover:text-slate-900'}`}>
                  {l.label}
                  {isActive && <span className="absolute -bottom-1 left-0 right-0 h-0.5 bg-teal-600 rounded-full" />}
                </a>
              );
            })}
          </nav>
          <div className="hidden md:flex items-center gap-2.5">
            <a href={APP_URL} className="px-4 py-2 text-sm font-semibold text-slate-700 hover:text-slate-900 transition-colors">Se connecter</a>
            <a href={registerUrl('trial')} className="px-4 py-2 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors">Essai gratuit</a>
          </div>
          <button
            type="button"
            onClick={() => setMobileNav(!mobileNav)}
            className="md:hidden p-2 -mr-2 text-slate-700"
            aria-label={mobileNav ? 'Fermer le menu' : 'Ouvrir le menu'}
            aria-expanded={mobileNav}
            aria-controls="menu-mobile"
          >
            {mobileNav ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
        {mobileNav && (
          <div id="menu-mobile" className="md:hidden border-t border-slate-100 bg-white">
            <div className="px-5 py-4 space-y-1">
              {navLinks.map((l) => (
                <a key={l.href} href={l.href} onClick={closeMobileNav} className="block w-full py-2.5 text-sm text-slate-700 font-medium">
                  {l.label}
                </a>
              ))}
              <div className="pt-3 flex gap-2.5">
                <a href={APP_URL} onClick={closeMobileNav} className="flex-1 py-2.5 text-sm font-semibold text-slate-700 border border-slate-200 rounded-lg text-center">Se connecter</a>
                <a href={registerUrl('trial')} onClick={closeMobileNav} className="flex-1 py-2.5 text-sm font-semibold text-white bg-teal-700 rounded-lg text-center">Essai gratuit</a>
              </div>
            </div>
          </div>
        )}
      </header>

      <main id="contenu">
        {/* Hero */}
        <section className="relative overflow-hidden bg-gradient-to-b from-slate-50/60 to-white">
          <div className="max-w-6xl mx-auto px-5 md:px-8 pt-16 md:pt-24 pb-20 md:pb-28">
            <div className="grid lg:grid-cols-[1.1fr_1fr] gap-12 lg:gap-16 items-center">
              <div className="max-w-xl">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-teal-50 border border-teal-100 mb-6">
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-600 animate-pulse" />
                  <span className="text-xs font-semibold text-teal-700 tracking-wide">Gestion commerciale conçue au Sénégal</span>
                </div>
                <h1 className="text-4xl md:text-5xl lg:text-[54px] leading-[1.08] tracking-[-0.02em] font-bold text-slate-900">
                  {config.hero_headline}
                  {config.hero_accent && (
                    <>
                      {' '}<span className="text-teal-700">{config.hero_accent}</span>
                    </>
                  )}
                </h1>
                <p className="mt-5 text-lg leading-relaxed text-slate-600">
                  {config.hero_subtitle}
                </p>
                <div className="mt-8 flex flex-col sm:flex-row gap-3">
                  <a href={registerUrl('trial')} className="inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-teal-700 hover:bg-teal-800 text-white font-semibold rounded-xl transition-colors active:scale-[0.98]">
                    Démarrer l'essai gratuit <ArrowRight className="w-4 h-4" />
                  </a>
                  <a href="#demonstration" className="inline-flex items-center justify-center px-6 py-3.5 bg-white border border-slate-200 hover:border-slate-300 text-slate-800 font-semibold rounded-xl transition-colors">
                    Voir une démonstration
                  </a>
                </div>
                <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-500">
                  <span className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-teal-600" /> 14 jours gratuits</span>
                  <span className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-teal-600" /> Sans carte bancaire</span>
                  <span className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-teal-600" /> Accompagnement local</span>
                </div>
              </div>

              <div className="relative">
                <div className="relative rounded-2xl overflow-hidden shadow-[0_24px_60px_-20px_rgba(15,23,42,0.18),0_8px_24px_-8px_rgba(15,23,42,0.08)] border border-slate-200/70 bg-white">
                  <img
                    src={config.hero_image_url || '/desktop.png'}
                    alt="Interface Waarwi — gestion commerciale, caisse et stock"
                    className="w-full h-auto object-cover"
                    width={800}
                    height={500}
                    loading="eager"
                    onError={(e) => { (e.target as HTMLImageElement).src = '/desktop.png'; }}
                  />
                </div>
                <div className="hidden md:block absolute -bottom-6 -left-6 w-40 rounded-xl overflow-hidden shadow-[0_12px_30px_-12px_rgba(15,23,42,0.2)] border border-slate-200/70 bg-white">
                  <img src="/mobile.png" alt="Waarwi sur mobile" className="w-full h-auto" width={160} height={320} loading="lazy" />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Brand signature */}
        <section className="py-10 md:py-12 bg-white border-b border-slate-100">
          <div className="max-w-4xl mx-auto px-5 md:px-8 text-center">
            <p className="text-lg md:text-xl font-semibold text-slate-700 italic">
              La plateforme qui simplifie, connecte et propulse votre business.
            </p>
          </div>
        </section>

        {/* Stats */}
        {stats && (
          <section ref={statsRef} className="border-y border-slate-100 bg-white">
            <div className="max-w-6xl mx-auto px-5 md:px-8 py-12 md:py-14">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
                <StatCard value={stats.active_tenants} label={config.stats_label_tenants} start={statsStart} />
                <StatCard value={stats.active_sectors} label={config.stats_label_sectors} start={statsStart} />
                <TextStatCard label={config.stats_label_uptime || 'Accompagnement local au Sénégal'} icon={Headphones} />
              </div>
            </div>
          </section>
        )}

        {/* Client logos — only when real logos are provided */}
        {clientLogos.length > 0 && (
          <section className="py-10 bg-white border-b border-slate-100" aria-label="Ils utilisent Waarwi" aria-labelledby="logos-title">
            <div className="max-w-6xl mx-auto px-5 md:px-8">
              <h2 id="logos-title" className="text-center text-xs font-bold uppercase tracking-[0.15em] text-slate-400 mb-6">
                Ils utilisent Waarwi
              </h2>
              <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
                {clientLogos.map((logo, i) => (
                  <div key={i} className="flex items-center gap-2 text-slate-400">
                    {logo.logo_url ? (
                      <img src={logo.logo_url} alt={logo.name} className="h-8 w-auto object-contain grayscale opacity-70" loading="lazy" />
                    ) : (
                      <span className="text-base font-bold tracking-tight">{logo.name}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Why Waarwi */}
        <section id="pourquoi" className="py-20 md:py-28 bg-slate-50/60 border-b border-slate-100">
          <div className="max-w-6xl mx-auto px-5 md:px-8">
            <div className="max-w-2xl mb-12 md:mb-16">
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-teal-700 mb-3">Pourquoi Waarwi ?</p>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900 leading-tight">
                {config.section_titles?.why_title || 'Une solution de confiance, pensée pour le Sénégal.'}
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {whyItems.map((item, i) => {
                const Icon = ICON_MAP[item.icon] || Shield;
                return (
                  <div key={i} className="bg-white rounded-xl border border-slate-200/70 p-6 h-full">
                    <div className="w-11 h-11 rounded-xl bg-teal-50 flex items-center justify-center mb-4">
                      <Icon className="w-5 h-5 text-teal-700" />
                    </div>
                    <h3 className="text-base font-semibold text-slate-900 mb-2">{item.title}</h3>
                    <p className="text-sm leading-relaxed text-slate-600">{item.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="fonctionnalites" className="py-20 md:py-28">
          <div className="max-w-6xl mx-auto px-5 md:px-8">
            <div className="max-w-2xl mb-12 md:mb-16">
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-teal-700 mb-3">Fonctionnalités</p>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900 leading-tight">
                Tout ce dont votre business a besoin, dans une seule plateforme.
              </h2>
              <p className="mt-4 text-lg text-slate-600">
                Ne jonglez plus entre cinq logiciels. Waarwi centralise vos opérations commerciales de la caisse à la comptabilité.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-slate-100 rounded-2xl overflow-hidden border border-slate-100">
              {features.map((f, i) => {
                const Icon = ICON_MAP[f.icon] || Package;
                return (
                  <div key={i} className="bg-white p-7 md:p-8 hover:bg-slate-50/50 transition-colors flex flex-col">
                    <div className="w-11 h-11 rounded-xl bg-teal-50 flex items-center justify-center mb-5">
                      <Icon className="w-5 h-5 text-teal-700" />
                    </div>
                    <h3 className="text-base font-semibold text-slate-900 mb-2">{f.title}</h3>
                    <p className="text-sm leading-relaxed text-slate-600">{f.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Sectors */}
        <section id="secteurs" className="py-20 md:py-28 bg-slate-50/60 border-y border-slate-100">
          <div className="max-w-6xl mx-auto px-5 md:px-8">
            <div className="max-w-2xl mb-12 md:mb-16">
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-teal-700 mb-3">Secteurs d'activité</p>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900 leading-tight">
                Pensé pour les réalités du commerce sénégalais.
              </h2>
              <p className="mt-4 text-lg text-slate-600">
                {sectors.length} secteurs d'activité couverts, avec des catalogues et configurations métier pré-remplis.
              </p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
              {sectors.map((s) => {
                const Icon = SECTOR_ICONS[s.slug] || Store;
                return (
                  <div key={s.id} className="bg-white rounded-xl border border-slate-200/70 p-5 hover:border-teal-200 hover:shadow-sm transition-all group h-full flex flex-col">
                    <div className="w-9 h-9 rounded-lg bg-slate-50 group-hover:bg-teal-50 flex items-center justify-center mb-3 transition-colors">
                      <Icon className="text-slate-600 group-hover:text-teal-700 transition-colors" style={{ width: 18, height: 18 }} />
                    </div>
                    <h3 className="text-sm font-semibold text-slate-900 leading-snug">{s.name}</h3>
                    {s.description && <p className="mt-1 text-xs text-slate-500 leading-relaxed line-clamp-2">{s.description}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Demonstration — desktop carousel (horizontal) + mobile stacked cards */}
        <section id="demonstration" className="py-20 md:py-28 bg-white">
          <div className="max-w-6xl mx-auto px-5 md:px-8">
            <div className="max-w-2xl mb-12 md:mb-16">
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-teal-700 mb-3">Démonstration</p>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900 leading-tight">
                {config.section_titles?.demo_title || 'Une interface claire, du tableau de bord à la caisse.'}
              </h2>
              <p className="mt-4 text-lg text-slate-600">
                {config.section_titles?.demo_subtitle || 'Découvrez les écrans clés de Waarwi, sur ordinateur comme sur mobile.'}
              </p>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-start">
              <DesktopCarousel shots={desktopShots} onOpen={openLightbox} />
              <MobileStack shots={mobileShots} onOpen={openLightbox} />
            </div>
          </div>
        </section>

        {/* Testimonials — only when real testimonials are provided */}
        {testimonials.length > 0 && (
          <section className="py-20 md:py-28 bg-slate-50/60 border-y border-slate-100" aria-labelledby="temoignages-title">
            <div className="max-w-6xl mx-auto px-5 md:px-8">
              <div className="max-w-2xl mb-12 md:mb-16">
                <p className="text-xs font-bold uppercase tracking-[0.15em] text-teal-700 mb-3">Témoignages</p>
                <h2 id="temoignages-title" className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900 leading-tight">
                  Ce qu'en disent les commerçants.
                </h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {testimonials.map((t, i) => (
                  <figure key={i} className="bg-white rounded-xl border border-slate-200/70 p-6 h-full flex flex-col">
                    <blockquote className="text-sm leading-relaxed text-slate-700 flex-1">"{t.quote}"</blockquote>
                    <figcaption className="mt-4 pt-4 border-t border-slate-100">
                      <div className="text-sm font-semibold text-slate-900">{t.author}</div>
                      {(t.role || t.company) && (
                        <div className="text-xs text-slate-500 mt-0.5">{[t.role, t.company].filter(Boolean).join(' · ')}</div>
                      )}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Pricing */}
        {config.pricing_visible && plans.length > 0 && (
          <section id="tarifs" className="py-20 md:py-28">
            <div className="max-w-5xl mx-auto px-5 md:px-8">
              <div className="text-center max-w-2xl mx-auto mb-12 md:mb-16">
                <p className="text-xs font-bold uppercase tracking-[0.15em] text-teal-700 mb-3">Tarifs</p>
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900 leading-tight">
                  Des prix pensés pour les commerçants.
                </h2>
                <p className="mt-4 text-lg text-slate-600">
                  Sans engagement. Annulez à tout moment. Essai gratuit de 14 jours.
                </p>
              </div>
              <div className="grid md:grid-cols-2 gap-5 max-w-3xl mx-auto">
                {plans.map((plan) => {
                  const planFeatures: string[] = Array.isArray(plan.features) ? plan.features : [];
                  const isTrial = plan.code === 'trial';
                  const price = plan.price_monthly || 0;
                  return (
                    <div key={plan.code} className={`relative rounded-2xl border p-7 flex flex-col ${isTrial ? 'border-slate-200 bg-white' : 'border-teal-200 bg-white shadow-[0_8px_30px_-12px_rgba(13,148,136,0.15)]'}`}>
                      {!isTrial && (
                        <div className="absolute -top-3 left-7 px-3 py-1 bg-teal-700 text-white text-xs font-semibold rounded-full">Populaire</div>
                      )}
                      <h3 className="text-lg font-bold text-slate-900">{plan.name}</h3>
                      <p className="text-sm text-slate-500 mt-1">{plan.description}</p>
                      <div className="mt-5 mb-6">
                        <span className="text-4xl font-bold text-slate-900 tabular-nums">{price.toLocaleString('fr-FR')}</span>
                        <span className="text-sm text-slate-500 ml-1">FCFA{isTrial ? '' : '/mois'}</span>
                      </div>
                      <ul className="space-y-2.5 mb-7 flex-1">
                        {planFeatures.slice(0, 6).map((feat, i) => (
                          <li key={i} className="flex items-start gap-2.5 text-sm text-slate-700">
                            <Check className="w-4 h-4 text-teal-600 mt-0.5 flex-shrink-0" />
                            <span>{feat}</span>
                          </li>
                        ))}
                      </ul>
                      <a
                        href={registerUrl(plan.code)}
                        className={`w-full py-3 rounded-xl font-semibold text-sm transition-colors text-center ${isTrial ? 'bg-white border border-slate-200 text-slate-800 hover:border-slate-300' : 'bg-teal-700 text-white hover:bg-teal-800'}`}
                      >
                        {isTrial ? "Commencer l'essai" : 'Choisir ' + plan.name}
                      </a>
                    </div>
                  );
                })}
              </div>
              <p className="mt-8 text-center text-sm text-slate-500">
                Besoin de magasins ou d'utilisateurs supplémentaires ? Contactez-nous pour une offre adaptée.
              </p>
            </div>
          </section>
        )}

        {/* FAQ */}
        <section id="faq" className="py-20 md:py-28 bg-slate-50/60 border-y border-slate-100">
          <div className="max-w-3xl mx-auto px-5 md:px-8">
            <div className="mb-10 md:mb-12">
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-teal-700 mb-3">FAQ</p>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900 leading-tight">
                Questions fréquentes.
              </h2>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200/70 px-5 md:px-7">
              {faqItems.map((item, i) => (
                <FaqItem key={i} id={`faq-${i}`} q={item.q} a={item.a} />
              ))}
            </div>
          </div>
        </section>

        {/* Contact / CTA */}
        <section id="contact" className="py-20 md:py-28 bg-slate-900">
          <div className="max-w-4xl mx-auto px-5 md:px-8 text-center">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-white leading-tight">
              Prêt à digitaliser votre business ?
            </h2>
            <p className="mt-4 text-lg text-slate-300 max-w-xl mx-auto">
              Configurez votre compte en quelques minutes. Notre équipe vous accompagne au démarrage.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
              <a href={registerUrl('trial')} className="inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-teal-600 hover:bg-teal-500 text-white font-semibold rounded-xl transition-colors">
                Démarrer l'essai gratuit <ArrowRight className="w-4 h-4" />
              </a>
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-white/10 hover:bg-white/15 text-white font-semibold rounded-xl transition-colors border border-white/10">
                <MessageCircle className="w-4 h-4" /> Échanger sur WhatsApp
              </a>
            </div>
            <div className="mt-8 flex flex-col sm:flex-row gap-4 sm:gap-8 justify-center items-center text-sm text-slate-300">
              <a href={`tel:${phoneTel}`} className="inline-flex items-center gap-2 hover:text-white transition-colors">
                <Phone className="w-4 h-4" /> {phoneDisplay}
              </a>
              {contactEmail && (
                <a href={`mailto:${contactEmail}`} className="inline-flex items-center gap-2 hover:text-white transition-colors">
                  <Mail className="w-4 h-4" /> {contactEmail}
                </a>
              )}
              {contactHours && (
                <span className="inline-flex items-center gap-2">
                  <Clock className="w-4 h-4" /> {contactHours}
                </span>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-100 bg-white">
        <div className="max-w-6xl mx-auto px-5 md:px-8 py-12">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="md:col-span-2">
              <div className="flex items-center mb-3">
                <img src="/newlogo.png" alt="Waarwi" className="h-9 md:h-10 w-auto object-contain" />
              </div>
              <p className="text-sm text-slate-500 max-w-sm leading-relaxed">{config.footer_tagline}</p>
            </div>
            <div>
              <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-slate-400 mb-3">Produit</h2>
              <ul className="space-y-2 text-sm">
                <li><a href="#fonctionnalites" className="text-slate-600 hover:text-slate-900 transition-colors">Fonctionnalités</a></li>
                <li><a href="#secteurs" className="text-slate-600 hover:text-slate-900 transition-colors">Secteurs</a></li>
                <li><a href="#tarifs" className="text-slate-600 hover:text-slate-900 transition-colors">Tarifs</a></li>
                <li><a href="#faq" className="text-slate-600 hover:text-slate-900 transition-colors">FAQ</a></li>
              </ul>
            </div>
            <div>
              <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-slate-400 mb-3">Compte & légal</h2>
              <ul className="space-y-2 text-sm">
                <li><a href={APP_URL} className="text-slate-600 hover:text-slate-900 transition-colors">Se connecter</a></li>
                <li><a href={registerUrl('trial')} className="text-slate-600 hover:text-slate-900 transition-colors">Créer un compte</a></li>
                <li><a href="#contact" className="text-slate-600 hover:text-slate-900 transition-colors">Contact</a></li>
                <li><a href="/mentions-legales" className="text-slate-600 hover:text-slate-900 transition-colors">Mentions légales</a></li>
                <li><a href="/confidentialite" className="text-slate-600 hover:text-slate-900 transition-colors">Confidentialité</a></li>
                <li><a href="/cgu" className="text-slate-600 hover:text-slate-900 transition-colors">CGU</a></li>
              </ul>
            </div>
          </div>
          <div className="mt-10 pt-6 border-t border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <p className="text-xs text-slate-400">&copy; {new Date().getFullYear()} WAARWI. Tous droits réservés.</p>
            <p className="text-xs text-slate-400">Conçu au Sénégal · INTELLIGENCEPRO TECHNOLOGIES</p>
          </div>
        </div>
      </footer>

      {lightbox && (
        <Lightbox
          column={lightbox.column}
          index={lightbox.index}
          shots={lightbox.column === 'desktop' ? desktopShots : mobileShots}
          onClose={closeLightbox}
          onNav={navLightbox}
        />
      )}
    </div>
  );
}

function DesktopCarousel({ shots, onOpen }: { shots: DemoShot[]; onOpen: (column: 'desktop', index: number) => void }) {
  const [idx, setIdx] = useState(0);
  if (shots.length === 0) return null;
  const prev = () => setIdx(i => (i - 1 + shots.length) % shots.length);
  const next = () => setIdx(i => (i + 1) % shots.length);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-slate-500">Sur ordinateur</p>
        {shots.length > 1 && (
          <div className="flex gap-1.5">
            <button onClick={prev} aria-label="Précédent" className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"><ChevronLeft className="w-4 h-4" /></button>
            <button onClick={next} aria-label="Suivant" className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"><ChevronRight className="w-4 h-4" /></button>
          </div>
        )}
      </div>
      <div className="relative rounded-2xl overflow-hidden border border-slate-200/70 bg-white shadow-[0_24px_60px_-20px_rgba(15,23,42,0.12)] cursor-zoom-in group" onClick={() => onOpen('desktop', idx)}>
        <img src={shots[idx].src} alt={shots[idx].alt || shots[idx].label} className="w-full h-auto object-cover" loading="lazy" />
        <div className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/5 transition-colors" />
        <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-lg bg-white/90 backdrop-blur-sm text-[11px] font-semibold text-slate-800">
          {shots[idx].label}
        </div>
      </div>
      {shots.length > 1 && (
        <div className="flex justify-center gap-1.5">
          {shots.map((_, i) => (
            <button key={i} onClick={() => setIdx(i)} aria-label={`Capture ${i + 1}`} className={`h-1.5 rounded-full transition-all ${i === idx ? 'w-6 bg-teal-600' : 'w-1.5 bg-slate-300 hover:bg-slate-400'}`} />
          ))}
        </div>
      )}
    </div>
  );
}

function MobileStack({ shots, onOpen }: { shots: DemoShot[]; onOpen: (column: 'mobile', index: number) => void }) {
  if (shots.length === 0) return null;
  return (
    <div className="space-y-4">
      <p className="text-xs font-bold uppercase tracking-[0.15em] text-slate-500">Sur mobile</p>
      <div className="flex flex-col gap-4 max-h-[560px] overflow-y-auto pr-1 -mr-1 snap-y snap-mandatory scroll-smooth" style={{ scrollbarWidth: 'thin' }}>
        {shots.map((shot, i) => (
          <div key={i} className="shrink-0 snap-start relative rounded-2xl overflow-hidden border border-slate-200/70 bg-white shadow-sm cursor-zoom-in group mx-auto w-[200px]" onClick={() => onOpen('mobile', i)}>
            <img src={shot.src} alt={shot.alt || shot.label} className="w-full h-auto object-cover" loading="lazy" />
            <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-white/90 backdrop-blur-sm text-[10px] font-semibold text-slate-800">
              {shot.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Lightbox({ column, index, shots, onClose, onNav }: {
  column: 'desktop' | 'mobile';
  index: number;
  shots: DemoShot[];
  onClose: () => void;
  onNav: (dir: 1 | -1) => void;
}) {
  if (shots.length === 0) return null;
  const shot = shots[index] || shots[0];
  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/90 backdrop-blur-sm flex items-center justify-center p-4 md:p-8" onClick={onClose}>
      <div className="absolute top-4 right-4 flex items-center gap-3">
        <span className="text-xs font-medium text-slate-300">{column === 'desktop' ? 'Desktop' : 'Mobile'} — {index + 1}/{shots.length}</span>
        <button onClick={onClose} aria-label="Fermer" className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"><X className="w-5 h-5" /></button>
      </div>
      {shots.length > 1 && (
        <button onClick={(e) => { e.stopPropagation(); onNav(-1); }} aria-label="Précédent" className="absolute left-2 md:left-4 p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"><ChevronLeft className="w-5 h-5" /></button>
      )}
      <div className="max-w-4xl max-h-[85vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
        <img src={shot.src} alt={shot.alt || shot.label} className="max-w-full max-h-[78vh] object-contain rounded-lg" />
        <p className="mt-3 text-sm font-medium text-white">{shot.label}</p>
      </div>
      {shots.length > 1 && (
        <button onClick={(e) => { e.stopPropagation(); onNav(1); }} aria-label="Suivant" className="absolute right-2 md:right-4 p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"><ChevronRight className="w-5 h-5" /></button>
      )}
    </div>
  );
}