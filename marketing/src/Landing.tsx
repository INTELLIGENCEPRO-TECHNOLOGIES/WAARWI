import { useEffect, useRef, useState } from 'react';
import {
  ShoppingCart, Package, FileText, Users, Truck, Globe,
  BarChart3, TrendingUp, Shield, Zap, Wallet, Layers, Monitor,
  Receipt, ArrowRight, Check, Phone, Menu, X, Wrench, Shirt,
  Cpu, Boxes, HeartPulse, BookOpen, Store, Gem, Sparkles, Building2,
} from 'lucide-react';
import { supabase, APP_URL } from './lib/supabase';

type LandingFeature = { icon: string; title: string; desc: string };
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
  hero_headline: 'La plateforme qui simplifie, connecte et propulse',
  hero_accent: 'votre business.',
  hero_subtitle: "Gestion commerciale tout-en-un : caisse, stock, facturation, comptabilité et boutique en ligne. Conçu pour les commerçants sénégalais.",
  hero_cta_label: 'Démarrer gratuitement',
  hero_image_url: '/desktop.png',
  stats_label_tenants: 'Businesss accompagnés',
  stats_label_sectors: 'Secteurs couverts',
  stats_label_uptime: 'Disponibilité',
  pricing_visible: true,
  features: [],
  footer_tagline: 'Conçu au Sénégal, propulsé par INTELLIGENCEPRO TECHNOLOGIES',
};

const ICON_MAP: Record<string, any> = {
  ShoppingCart, Package, FileText, Users, Truck, Globe,
  BarChart3, TrendingUp, Shield, Zap, Wallet, Layers, Monitor, Receipt,
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

export function Landing() {
  const [config, setConfig] = useState<LandingConfig>(DEFAULT_CONFIG);
  const [stats, setStats] = useState<LandingStats | null>(null);
  const [sectors, setSectors] = useState<BusinessActivityType[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [statsStart, setStatsStart] = useState(false);
  const statsRef = useRef<HTMLDivElement>(null);
  const [mobileNav, setMobileNav] = useState(false);

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
  const scrollTo = (id: string) => {
    setMobileNav(false);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const goLogin = () => { window.location.href = `${APP_URL}`; };
  const goRegister = () => { window.location.href = `${APP_URL}/login?mode=register`; };

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

  return (
    <div className="min-h-screen bg-white text-slate-900" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Navbar */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-5 md:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/newlogo.png" alt="Waarwi" className="h-8 w-8 object-contain" />
            <span className="text-lg font-bold tracking-tight text-slate-900">Waarwi</span>
          </div>
          <nav className="hidden md:flex items-center gap-7">
            <button onClick={() => scrollTo('features')} className="text-sm text-slate-600 hover:text-slate-900 font-medium transition-colors">Fonctionnalités</button>
            <button onClick={() => scrollTo('secteurs')} className="text-sm text-slate-600 hover:text-slate-900 font-medium transition-colors">Secteurs</button>
            {config.pricing_visible && <button onClick={() => scrollTo('tarifs')} className="text-sm text-slate-600 hover:text-slate-900 font-medium transition-colors">Tarifs</button>}
            <button onClick={() => scrollTo('contact')} className="text-sm text-slate-600 hover:text-slate-900 font-medium transition-colors">Contact</button>
          </nav>
          <div className="hidden md:flex items-center gap-2.5">
            <button onClick={goLogin} className="px-4 py-2 text-sm font-semibold text-slate-700 hover:text-slate-900 transition-colors">Se connecter</button>
            <button onClick={goRegister} className="px-4 py-2 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors">Essai gratuit</button>
          </div>
          <button onClick={() => setMobileNav(!mobileNav)} className="md:hidden p-2 -mr-2 text-slate-700">
            {mobileNav ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
        {mobileNav && (
          <div className="md:hidden border-t border-slate-100 bg-white">
            <div className="px-5 py-4 space-y-1">
              <button onClick={() => scrollTo('features')} className="block w-full text-left py-2.5 text-sm text-slate-700 font-medium">Fonctionnalités</button>
              <button onClick={() => scrollTo('secteurs')} className="block w-full text-left py-2.5 text-sm text-slate-700 font-medium">Secteurs</button>
              {config.pricing_visible && <button onClick={() => scrollTo('tarifs')} className="block w-full text-left py-2.5 text-sm text-slate-700 font-medium">Tarifs</button>}
              <button onClick={() => scrollTo('contact')} className="block w-full text-left py-2.5 text-sm text-slate-700 font-medium">Contact</button>
              <div className="pt-3 flex gap-2.5">
                <button onClick={goLogin} className="flex-1 py-2.5 text-sm font-semibold text-slate-700 border border-slate-200 rounded-lg">Se connecter</button>
                <button onClick={goRegister} className="flex-1 py-2.5 text-sm font-semibold text-white bg-teal-700 rounded-lg">Essai gratuit</button>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-slate-50/60 to-white">
        <div className="max-w-6xl mx-auto px-5 md:px-8 pt-16 md:pt-24 pb-20 md:pb-28">
          <div className="grid lg:grid-cols-[1.1fr_1fr] gap-12 lg:gap-16 items-center">
            <div className="max-w-xl">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-teal-50 border border-teal-100 mb-6">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-600 animate-pulse" />
                <span className="text-xs font-semibold text-teal-700 tracking-wide">Gestion commerciale · Sénégal</span>
              </div>
              <h1 className="text-4xl md:text-5xl lg:text-[54px] leading-[1.08] tracking-[-0.02em] font-bold text-slate-900">
                {config.hero_headline}{' '}
                <span className="text-teal-700">{config.hero_accent}</span>
              </h1>
              <p className="mt-5 text-lg leading-relaxed text-slate-600">
                {config.hero_subtitle}
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <button onClick={goRegister} className="inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-teal-700 hover:bg-teal-800 text-white font-semibold rounded-xl transition-colors active:scale-[0.98]">
                  {config.hero_cta_label} <ArrowRight className="w-4 h-4" />
                </button>
                <button onClick={goLogin} className="inline-flex items-center justify-center px-6 py-3.5 bg-white border border-slate-200 hover:border-slate-300 text-slate-800 font-semibold rounded-xl transition-colors">
                  Se connecter
                </button>
              </div>
              <div className="mt-6 flex items-center gap-5 text-xs text-slate-500">
                <span className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-teal-600" /> Sans carte bancaire</span>
                <span className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-teal-600" /> Essai 14 jours</span>
                <span className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-teal-600" /> Support en français</span>
              </div>
            </div>

            <div className="relative">
              <div className="relative rounded-2xl overflow-hidden shadow-[0_24px_60px_-20px_rgba(15,23,42,0.18),0_8px_24px_-8px_rgba(15,23,42,0.08)] border border-slate-200/70 bg-white">
                <img
                  src={config.hero_image_url || '/desktop.png'}
                  alt="Interface Waarwi — gestion commerciale, caisse et stock"
                  className="w-full h-auto object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).src = '/desktop.png'; }}
                />
              </div>
              <div className="hidden md:block absolute -bottom-6 -left-6 w-40 rounded-xl overflow-hidden shadow-[0_12px_30px_-12px_rgba(15,23,42,0.2)] border border-slate-200/70 bg-white">
                <img src="/mobile.png" alt="Waarwi sur mobile" className="w-full h-auto" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      {stats && (
        <section ref={statsRef} className="border-y border-slate-100 bg-white">
          <div className="max-w-6xl mx-auto px-5 md:px-8 py-12 md:py-14">
            <div className="grid grid-cols-3 gap-4 md:gap-8">
              <StatCard value={stats.active_tenants} label={config.stats_label_tenants} start={statsStart} />
              <StatCard value={stats.active_sectors} label={config.stats_label_sectors} start={statsStart} />
              <StatCard value={Math.floor(stats.uptime_percent)} label={config.stats_label_uptime} start={statsStart} suffix="%" />
            </div>
          </div>
        </section>
      )}

      {/* Features */}
      <section id="features" className="py-20 md:py-28">
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
                <div key={i} className="bg-white p-7 md:p-8 hover:bg-slate-50/50 transition-colors">
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
                <div key={s.id} className="bg-white rounded-xl border border-slate-200/70 p-5 hover:border-teal-200 hover:shadow-sm transition-all group">
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
                const features: string[] = Array.isArray(plan.features) ? plan.features : [];
                const isTrial = plan.code === 'trial';
                const price = plan.price_monthly || 0;
                return (
                  <div key={plan.code} className={`relative rounded-2xl border p-7 ${isTrial ? 'border-slate-200 bg-white' : 'border-teal-200 bg-white shadow-[0_8px_30px_-12px_rgba(13,148,136,0.15)]'}`}>
                    {!isTrial && (
                      <div className="absolute -top-3 left-7 px-3 py-1 bg-teal-700 text-white text-xs font-semibold rounded-full">Populaire</div>
                    )}
                    <h3 className="text-lg font-bold text-slate-900">{plan.name}</h3>
                    <p className="text-sm text-slate-500 mt-1">{plan.description}</p>
                    <div className="mt-5 mb-6">
                      <span className="text-4xl font-bold text-slate-900 tabular-nums">{price.toLocaleString('fr-FR')}</span>
                      <span className="text-sm text-slate-500 ml-1">FCFA{isTrial ? '' : '/mois'}</span>
                    </div>
                    <ul className="space-y-2.5 mb-7">
                      {features.slice(0, 6).map((feat, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-sm text-slate-700">
                          <Check className="w-4 h-4 text-teal-600 mt-0.5 flex-shrink-0" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                    <button
                      onClick={goRegister}
                      className={`w-full py-3 rounded-xl font-semibold text-sm transition-colors ${isTrial ? 'bg-white border border-slate-200 text-slate-800 hover:border-slate-300' : 'bg-teal-700 text-white hover:bg-teal-800'}`}
                    >
                      {isTrial ? 'Commencer l\'essai' : 'Choisir ' + plan.name}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

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
            <button onClick={goRegister} className="inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-teal-600 hover:bg-teal-500 text-white font-semibold rounded-xl transition-colors">
              {config.hero_cta_label} <ArrowRight className="w-4 h-4" />
            </button>
            <a href="tel:+221775254101" className="inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-white/10 hover:bg-white/15 text-white font-semibold rounded-xl transition-colors border border-white/10">
              <Phone className="w-4 h-4" /> 77 525 41 01
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-100 bg-white">
        <div className="max-w-6xl mx-auto px-5 md:px-8 py-10">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
            <div className="flex items-center gap-2.5">
              <img src="/newlogo.png" alt="Waarwi" className="h-7 w-7 object-contain" />
              <span className="text-base font-bold text-slate-900">Waarwi</span>
            </div>
            <p className="text-xs text-slate-500">{config.footer_tagline}</p>
            <p className="text-xs text-slate-400">&copy; {new Date().getFullYear()} WAARWI</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
