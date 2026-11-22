import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUpRight, BarChart3, Bold, BookOpen, Boxes, Building2, Check, ChevronDown, ChevronRight, ChevronUp, Cpu, FileText,
  Gem, Globe, Heading1, Heading2, Heading3, Headphones, HeartPulse, Italic, Layers, Link2, List, ListOrdered, Loader2,
  MapPin, Monitor, Package, Plus, Receipt, RefreshCw, RotateCcw, Shield, Shirt, ShoppingCart, Sparkles, Store, Trash2,
  TrendingUp, Truck, Users, Wallet, Wrench, Zap,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { renderMarkdown } from '../lib/markdown';
import { PlatformWorkPage } from './PlatformWorkPage';
import { DEFAULT_LEGAL_MENTIONS, DEFAULT_PRIVACY_POLICY, DEFAULT_TERMS_OF_SERVICE } from '../lib/legalContent';

type LandingFeatureItem = { icon: string; title: string; desc: string; image_url?: string; image_alt?: string; image_position?: 'left' | 'center' | 'right' };
type DemoShot = { src: string; alt: string; label: string };
type WhyItem = { icon: string; title: string; desc: string; image_url?: string; image_alt?: string; image_position?: 'left' | 'center' | 'right' };
type SectorItem = { id: string; name: string; slug: string; description?: string; is_active: boolean; image_url?: string | null; image_alt?: string | null; image_position?: string | null };
type FaqItem = { q: string; a: string };
type Testimonial = { quote: string; author: string; role?: string; company?: string };
type ClientLogo = { name: string; logo_url?: string };
type GlobalEffects = {
  enabled: boolean;
  brightness: number;
  contrast: number;
  saturate: number;
  blur: number;
  grayscale: number;
  sepia: number;
  hueRotate: number;
};
const DEFAULT_EFFECTS: GlobalEffects = { enabled: false, brightness: 100, contrast: 100, saturate: 100, blur: 0, grayscale: 0, sepia: 0, hueRotate: 0 };
function buildFilterString(e: GlobalEffects): string {
  if (!e.enabled) return 'none';
  const parts: string[] = [];
  if (e.brightness !== 100) parts.push(`brightness(${e.brightness}%)`);
  if (e.contrast !== 100) parts.push(`contrast(${e.contrast}%)`);
  if (e.saturate !== 100) parts.push(`saturate(${e.saturate}%)`);
  if (e.blur > 0) parts.push(`blur(${e.blur}px)`);
  if (e.grayscale > 0) parts.push(`grayscale(${e.grayscale}%)`);
  if (e.sepia > 0) parts.push(`sepia(${e.sepia}%)`);
  if (e.hueRotate > 0) parts.push(`hue-rotate(${e.hueRotate}deg)`);
  return parts.length ? parts.join(' ') : 'none';
}

const ICON_MAP_ADMIN: Record<string, any> = {
  ShoppingCart, Package, FileText, Users, Truck, Globe,
  BarChart3, TrendingUp, Shield, Zap, Wallet, Layers, Monitor, Receipt,
  Sparkles, MapPin, Headphones, RefreshCw, Store, Boxes, BookOpen,
  Shirt, Cpu, HeartPulse, Building2, Gem, Wrench,
};

const SECTOR_ICONS_ADMIN: Record<string, any> = {
  auto_parts: Wrench, textile: Shirt, electromenager: Cpu, smartphones: Monitor,
  cosmetique: Sparkles, pharmacie: HeartPulse, quincaillerie: Boxes, librairie: BookOpen,
  mercerie: Layers, alimentaire: Store, services: Building2, bijoux: Gem, 'bijoux-accessoires': Gem,
};

const AVAILABLE_ICONS = [
  { value: 'ShoppingCart', label: 'Panier (POS)' },
  { value: 'Package', label: 'Colis (Stock)' },
  { value: 'FileText', label: 'Document (Facturation)' },
  { value: 'Users', label: 'Utilisateurs (Clients)' },
  { value: 'Truck', label: 'Camion (Fournisseurs)' },
  { value: 'Globe', label: 'Globe (Boutique)' },
  { value: 'BarChart3', label: 'Graphique (Comptabilité)' },
  { value: 'TrendingUp', label: 'Tendance (Rapports)' },
  { value: 'Shield', label: 'Bouclier (Sécurité)' },
  { value: 'Zap', label: 'Éclair' },
  { value: 'Wallet', label: 'Portefeuille' },
  { value: 'Layers', label: 'Couches' },
  { value: 'Monitor', label: 'Écran' },
  { value: 'Receipt', label: 'Reçu' },
  { value: 'Sparkles', label: 'Étincelle' },
  { value: 'MapPin', label: 'Localisation' },
  { value: 'Headphones', label: 'Support' },
  { value: 'RefreshCw', label: 'Synchro' },
  { value: 'Store', label: 'Boutique' },
  { value: 'Boxes', label: 'Boîtes' },
  { value: 'BookOpen', label: 'Livre' },
  { value: 'Shirt', label: 'Vêtement' },
  { value: 'Cpu', label: 'CPU' },
  { value: 'HeartPulse', label: 'Santé' },
  { value: 'Building2', label: 'Bâtiment' },
  { value: 'Gem', label: 'Bijou' },
  { value: 'Wrench', label: 'Clé' },
];

const DEFAULT_LANDING_FEATURES: LandingFeatureItem[] = [
  { icon: 'ShoppingCart', title: 'Point de vente', desc: 'Caisse rapide et intuitive, encaissement multi-moyens, sessions de caisse sécurisées.' },
  { icon: 'Package', title: 'Stock & inventaire', desc: 'Suivi en temps réel, alertes de rupture, gestion par lot et par site.' },
  { icon: 'FileText', title: 'Facturation', desc: 'Devis, factures, avoirs et retours conformes, conversion en vente en un clic.' },
  { icon: 'Users', title: 'Clients & tiers', desc: 'CRM complet, suivi des créances, plafonds de crédit et historique d\'achat.' },
  { icon: 'Truck', title: 'Fournisseurs', desc: 'Commandes d\'achat, réception, suivi des dettes et règlements.' },
  { icon: 'Globe', title: 'Boutique en ligne', desc: 'Vitrine web personnalisée, commandes en ligne, paiement à la livraison.' },
  { icon: 'BarChart3', title: 'Comptabilité', desc: 'Plan comptable SYSCOHADA, journal, balance, grand livre et clôture.' },
  { icon: 'TrendingUp', title: 'Rapports', desc: 'Tableaux de bord, analyses de ventes, marges et performance par produit.' },
  { icon: 'Shield', title: 'Sécurité & rôles', desc: 'Permissions granulaires par utilisateur, journaux d\'activité, sauvegardes.' },
];

const DEFAULT_WHY: WhyItem[] = [
  { icon: 'MapPin', title: 'Conçu au Sénégal', desc: "Une solution pensée pour les réalités du commerce sénégalais, pas adaptée d'un logiciel étranger." },
  { icon: 'Headphones', title: 'Accompagnement local', desc: 'Une équipe sur place pour vous aider au démarrage et tout au long de votre utilisation.' },
  { icon: 'Shield', title: 'Sauvegardes & sécurité', desc: 'Vos données sont sauvegardées et protégées. Les rôles contrôlent qui voit quoi.' },
  { icon: 'Users', title: 'Multi-utilisateurs', desc: 'Donnez accès à vos vendeurs, caissiers et comptables avec des permissions adaptées.' },
  { icon: 'RefreshCw', title: 'Synchronisation temps réel', desc: 'Vos ventes, votre stock et vos rapports se mettent à jour instantanément.' },
  { icon: 'Layers', title: 'Adapté à votre secteur', desc: 'Catalogues et configurations pré-remplis selon votre activité.' },
];

const DEFAULT_FAQ: FaqItem[] = [
  { q: 'Faut-il installer un logiciel ?', a: 'Non. Waarwi fonctionne directement dans votre navigateur, sur ordinateur, tablette ou téléphone. Aucune installation n\'est nécessaire.' },
  { q: "L'application fonctionne-t-elle sur téléphone ?", a: 'Oui. Waarwi est accessible depuis un navigateur web sur smartphone, et l\'interface de caisse est conçue pour un usage quotidien sur mobile.' },
  { q: 'Les données sont-elles sauvegardées ?', a: 'Oui. Vos données sont stockées de manière sécurisée et sauvegardées. Vous pouvez également exporter vos informations.' },
  { q: 'Peut-on gérer plusieurs utilisateurs ou magasins ?', a: 'Oui. Le plan Business inclut plusieurs magasins et plusieurs utilisateurs avec des permissions adaptées à chaque rôle (caissier, vendeur, gérant, comptable).' },
  { q: 'Quelles activités sont prises en charge ?', a: 'Waarwi couvre les pièces auto, le textile, l\'électroménager, les smartphones, la cosmétique, la pharmacie, la quincaillerie, la librairie, la mercerie, l\'alimentaire, les services et la bijouterie, avec des catalogues pré-remplis.' },
  { q: 'Comment fonctionne l\'essai gratuit ?', a: 'Vous bénéficiez de 14 jours d\'accès sans carte bancaire. À la fin de l\'essai, vous choisissez le plan qui vous convient, sans engagement.' },
  { q: 'Peut-on être accompagné lors du démarrage ?', a: 'Oui. Notre équipe vous accompagne dans la configuration de votre compte, votre catalogue et votre caisse pour démarrer sereinement.' },
];


async function call(action: string, payload: Record<string, unknown> = {}) {
  const doFetch = async (accessToken: string) => {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
    return res;
  };

  let { data: sess } = await supabase.auth.getSession();
  let token = sess.session?.access_token;
  if (!token) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    token = refreshed.session?.access_token;
  }
  if (!token) throw new Error('Session expirée — veuillez vous reconnecter');

  let res = await doFetch(token);
  if (res.status === 401) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    const newToken = refreshed.session?.access_token;
    if (!newToken) throw new Error('Session expirée — veuillez vous reconnecter');
    res = await doFetch(newToken);
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erreur');
  return data;
}

const POSITION_OPTIONS = [
  { value: 'center', label: 'Centre' },
  { value: 'left', label: 'Gauche' },
  { value: 'right', label: 'Droite' },
] as const;

async function uploadLandingMedia(file: File, folder: string): Promise<{ url: string; path: string }> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('Format non supporté. Utilisez PNG, JPEG ou WebP.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Image trop lourde (max 5 Mo).');
  }
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: upErr } = await supabase.storage.from('landing-media').upload(path, file, {
    cacheControl: '86400', upsert: false, contentType: file.type,
  });
  if (upErr) throw new Error(upErr.message);
  const { data: { publicUrl } } = supabase.storage.from('landing-media').getPublicUrl(path);
  return { url: publicUrl, path };
}

function pathFromLandingUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const idx = u.pathname.indexOf('/landing-media/');
    if (idx < 0) return null;
    return decodeURIComponent(u.pathname.slice(idx + '/landing-media/'.length));
  } catch { return null; }
}

async function removeLandingMedia(url: string | null | undefined): Promise<void> {
  if (!url) return;
  const p = pathFromLandingUrl(url);
  if (!p) return;
  await supabase.storage.from('landing-media').remove([p]);
}

function move<T>(arr: T[], idx: number, dir: -1 | 1): T[] {
  const next = idx + dir;
  if (next < 0 || next >= arr.length) return arr;
  const a = [...arr]; [a[idx], a[next]] = [a[next], a[idx]]; return a;
}

type Tab = 'contenu' | 'modules' | 'secteurs' | 'demo' | 'preuves' | 'whyfaq' | 'legal' | 'effets';

export function LandingConfigSection() {
  const { success, error } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('contenu');
  const [document, setDocument] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [heroHeadline, setHeroHeadline] = useState('');
  const [heroAccent, setHeroAccent] = useState('');
  const [heroSubtitle, setHeroSubtitle] = useState('');
  const [heroCtaLabel, setHeroCtaLabel] = useState('Démarrer gratuitement');
  const [heroImageUrl, setHeroImageUrl] = useState('');
  const [heroMobileImageUrl, setHeroMobileImageUrl] = useState('');
  const [heroMobileVisible, setHeroMobileVisible] = useState(true);
  const [statsTenants, setStatsTenants] = useState('entreprises accompagnées');
  const [statsSectors, setStatsSectors] = useState('Secteurs couverts');
  const [statsUptime, setStatsUptime] = useState('Accompagnement local au Sénégal');
  const [pricingVisible, setPricingVisible] = useState(true);
  const [footerTagline, setFooterTagline] = useState('');
  const [whatsappUrl, setWhatsappUrl] = useState('https://wa.me/221775254101');
  const [phoneDisplay, setPhoneDisplay] = useState('77 525 41 01');
  const [phoneTel, setPhoneTel] = useState('+221775254101');
  const [contactEmail, setContactEmail] = useState('');
  const [contactHours, setContactHours] = useState('');
  const [features, setFeatures] = useState<LandingFeatureItem[]>([]);
  const [demoDesktop, setDemoDesktop] = useState<DemoShot[]>([]);
  const [demoMobile, setDemoMobile] = useState<DemoShot[]>([]);
  const [whyWaarwi, setWhyWaarwi] = useState<WhyItem[]>([]);
  const [faqItems, setFaqItems] = useState<FaqItem[]>([]);
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  const [clientLogos, setClientLogos] = useState<ClientLogo[]>([]);
  const [sectionTitles, setSectionTitles] = useState<Record<string, string>>({});
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [sectors, setSectors] = useState<SectorItem[]>([]);
  const [sectorsLoaded, setSectorsLoaded] = useState(false);
  const [sectorBusy, setSectorBusy] = useState<string | null>(null);
  const [legalMentions, setLegalMentions] = useState('');
  const [privacyPolicy, setPrivacyPolicy] = useState('');
  const [termsOfService, setTermsOfService] = useState('');
  const [globalEffects, setGlobalEffects] = useState<GlobalEffects>(DEFAULT_EFFECTS);

  useEffect(() => {
    (async () => {
      try {
        const data = await call('get_landing_config');
        setHeroHeadline(data.hero_headline || '');
        setHeroAccent(data.hero_accent || '');
        setHeroSubtitle(data.hero_subtitle || '');
        setHeroCtaLabel(data.hero_cta_label || 'Démarrer gratuitement');
        setHeroImageUrl(data.hero_image_url || '');
        setHeroMobileImageUrl(data.hero_mobile_image_url || '');
        setHeroMobileVisible(data.hero_mobile_visible !== false);
        setStatsTenants(data.stats_label_tenants || 'entreprises accompagnées');
        setStatsSectors(data.stats_label_sectors || 'Secteurs couverts');
        setStatsUptime(data.stats_label_uptime || 'Accompagnement local au Sénégal');
        setPricingVisible(data.pricing_visible !== false);
        setFooterTagline(data.footer_tagline || '');
        setWhatsappUrl(data.whatsapp_url || 'https://wa.me/221775254101');
        setPhoneDisplay(data.phone_display || '77 525 41 01');
        setPhoneTel(data.phone_tel || '+221775254101');
        setContactEmail(data.contact_email || '');
        setContactHours(data.contact_hours || '');
        setFeatures(Array.isArray(data.features) ? data.features : []);
        setDemoDesktop(Array.isArray(data.demo_desktop) ? data.demo_desktop : []);
        setDemoMobile(Array.isArray(data.demo_mobile) ? data.demo_mobile : []);
        setWhyWaarwi(Array.isArray(data.why_waarwi) && data.why_waarwi.length > 0 ? data.why_waarwi : DEFAULT_WHY);
        setFaqItems(Array.isArray(data.faq_items) && data.faq_items.length > 0 ? data.faq_items : DEFAULT_FAQ);
        setTestimonials(Array.isArray(data.testimonials) ? data.testimonials : []);
        setClientLogos(Array.isArray(data.client_logos) ? data.client_logos : []);
        setSectionTitles(data.section_titles || {});
        setLegalMentions(data.legal_mentions || '');
        setPrivacyPolicy(data.privacy_policy || '');
        setTermsOfService(data.terms_of_service || '');
        setGlobalEffects(data.global_effects ? { ...DEFAULT_EFFECTS, ...data.global_effects } : DEFAULT_EFFECTS);
        setLoaded(true);
      } catch (e: any) { error(e.message); }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (activeTab === 'secteurs') loadSectors();
  }, [activeTab]);

  const loadSectors = async () => {
    if (sectorsLoaded) return;
    try {
      const data = await call('get_sectors_admin');
      setSectors(Array.isArray(data.sectors) ? data.sectors : []);
      setSectorsLoaded(true);
    } catch (e: any) { error(e.message); }
  };

  const uploadFeatureImage = async (idx: number, file: File, replace: boolean) => {
    setUploadingKey(`feat-${idx}`);
    try {
      const oldUrl = replace ? features[idx]?.image_url : null;
      const { url } = await uploadLandingMedia(file, 'features');
      setFeatures(features.map((m, i) => i === idx ? { ...m, image_url: url, image_alt: m.image_alt || '' } : m));
      if (oldUrl) await removeLandingMedia(oldUrl);
      success('Image ajoutée');
    } catch (e: any) { error(e.message); }
    setUploadingKey(null);
  };

  const removeFeatureImage = async (idx: number) => {
    const oldUrl = features[idx]?.image_url;
    setFeatures(features.map((m, i) => i === idx ? { ...m, image_url: undefined, image_alt: undefined, image_position: 'center' } : m));
    if (oldUrl) await removeLandingMedia(oldUrl);
  };

  const uploadWhyImage = async (idx: number, file: File, replace: boolean) => {
    setUploadingKey(`why-${idx}`);
    try {
      const oldUrl = replace ? whyWaarwi[idx]?.image_url : null;
      const { url } = await uploadLandingMedia(file, 'why');
      setWhyWaarwi(whyWaarwi.map((m, i) => i === idx ? { ...m, image_url: url, image_alt: m.image_alt || '' } : m));
      if (oldUrl) await removeLandingMedia(oldUrl);
      success('Image ajoutée');
    } catch (e: any) { error(e.message); }
    setUploadingKey(null);
  };

  const removeWhyImage = async (idx: number) => {
    const oldUrl = whyWaarwi[idx]?.image_url;
    setWhyWaarwi(whyWaarwi.map((m, i) => i === idx ? { ...m, image_url: undefined, image_alt: undefined, image_position: 'center' } : m));
    if (oldUrl) await removeLandingMedia(oldUrl);
  };

  const uploadSectorImage = async (sectorId: string, file: File, replace: boolean) => {
    setSectorBusy(sectorId);
    try {
      const sec = sectors.find(s => s.id === sectorId);
      const oldUrl = replace ? sec?.image_url : null;
      const { url } = await uploadLandingMedia(file, `sectors/${sectorId.slice(0, 8)}`);
      const res = await call('update_sector_image', { sector_id: sectorId, image_url: url, image_alt: sec?.image_alt || '', image_position: sec?.image_position || 'center' });
      if (res.sector) setSectors(sectors.map(s => s.id === sectorId ? { ...s, ...res.sector } : s));
      if (oldUrl) await removeLandingMedia(oldUrl);
      success('Image secteur enregistrée');
    } catch (e: any) { error(e.message); }
    setSectorBusy(null);
  };

  const saveSectorMeta = async (sectorId: string, patch: Partial<Pick<SectorItem, 'image_alt' | 'image_position'>>) => {
    setSectors(sectors.map(s => s.id === sectorId ? { ...s, ...patch } : s));
    try {
      const sec = sectors.find(s => s.id === sectorId);
      const res = await call('update_sector_image', { sector_id: sectorId, image_alt: patch.image_alt !== undefined ? (patch.image_alt || null) : sec?.image_alt, image_position: patch.image_position !== undefined ? patch.image_position : sec?.image_position });
      if (res.sector) setSectors(sectors.map(s => s.id === sectorId ? { ...s, ...res.sector } : s));
    } catch (e: any) { error(e.message); }
  };

  const removeSectorImage = async (sectorId: string) => {
    const sec = sectors.find(s => s.id === sectorId);
    const oldUrl = sec?.image_url;
    setSectorBusy(sectorId);
    try {
      await call('delete_sector_image', { sector_id: sectorId });
      setSectors(sectors.map(s => s.id === sectorId ? { ...s, image_url: null, image_alt: null, image_position: 'center' } : s));
      if (oldUrl) await removeLandingMedia(oldUrl);
      success('Image secteur supprimée');
    } catch (e: any) { error(e.message); }
    setSectorBusy(null);
  };

  const save = async () => {
    setSaving(true);
    try {
      await call('update_landing_config', {
        hero_headline: heroHeadline, hero_accent: heroAccent, hero_subtitle: heroSubtitle,
        hero_cta_label: heroCtaLabel, hero_image_url: heroImageUrl,
        hero_mobile_image_url: heroMobileImageUrl, hero_mobile_visible: heroMobileVisible,
        stats_label_tenants: statsTenants, stats_label_sectors: statsSectors, stats_label_uptime: statsUptime,
        pricing_visible: pricingVisible, features, footer_tagline: footerTagline,
        demo_desktop: demoDesktop, demo_mobile: demoMobile,
        why_waarwi: whyWaarwi, faq_items: faqItems, section_titles: sectionTitles,
        whatsapp_url: whatsappUrl, phone_display: phoneDisplay, phone_tel: phoneTel,
        contact_email: contactEmail, contact_hours: contactHours,
        testimonials, client_logos: clientLogos,
        legal_mentions: legalMentions, privacy_policy: privacyPolicy, terms_of_service: termsOfService,
        global_effects: globalEffects,
      });
      success('Site vitrine enregistré');
    } catch (e: any) { error(e.message); }
    setSaving(false);
  };

  const uploadShot = async (file: File, kind: 'desktop' | 'mobile') => {
    setUploadingKey(kind);
    try {
      const { url } = await uploadLandingMedia(file, `demo-${kind}`);
      const shot: DemoShot = { src: url, alt: '', label: kind === 'desktop' ? 'Capture desktop' : 'Capture mobile' };
      if (kind === 'desktop') setDemoDesktop([...demoDesktop, shot]);
      else setDemoMobile([...demoMobile, shot]);
      success('Capture ajoutée');
    } catch (e: any) { error(e.message); }
    setUploadingKey(null);
  };

  const replaceShot = async (file: File, kind: 'desktop' | 'mobile', idx: number) => {
    setUploadingKey(`${kind}-${idx}`);
    try {
      const items = kind === 'desktop' ? demoDesktop : demoMobile;
      const oldUrl = items[idx]?.src;
      const { url } = await uploadLandingMedia(file, `demo-${kind}`);
      const updated = items.map((s, i) => i === idx ? { ...s, src: url } : s);
      if (kind === 'desktop') setDemoDesktop(updated); else setDemoMobile(updated);
      if (oldUrl) await removeLandingMedia(oldUrl);
      success('Capture remplacée');
    } catch (e: any) { error(e.message); }
    setUploadingKey(null);
  };

  const uploadLogo = async (file: File) => {
    setUploadingKey('logo');
    try {
      const { url } = await uploadLandingMedia(file, 'client-logos');
      setClientLogos([...clientLogos, { name: '', logo_url: url }]);
      success('Logo ajouté');
    } catch (e: any) { error(e.message); }
    setUploadingKey(null);
  };

  const uploadHeroImage = async (file: File) => {
    setUploadingKey('hero-desktop');
    try {
      const oldUrl = heroImageUrl;
      const { url } = await uploadLandingMedia(file, 'hero-desktop');
      setHeroImageUrl(url);
      if (oldUrl) await removeLandingMedia(oldUrl);
      success('Image hero mise à jour');
    } catch (e: any) { error(e.message); }
    setUploadingKey(null);
  };

  const removeHeroImage = async () => {
    const oldUrl = heroImageUrl;
    setHeroImageUrl('');
    if (oldUrl) await removeLandingMedia(oldUrl);
  };

  const uploadHeroMobileImage = async (file: File) => {
    setUploadingKey('hero-mobile');
    try {
      const oldUrl = heroMobileImageUrl;
      const { url } = await uploadLandingMedia(file, 'hero-mobile');
      setHeroMobileImageUrl(url);
      if (oldUrl) await removeLandingMedia(oldUrl);
      success('Image mobile mise à jour');
    } catch (e: any) { error(e.message); }
    setUploadingKey(null);
  };

  const removeHeroMobileImage = async () => {
    const oldUrl = heroMobileImageUrl;
    setHeroMobileImageUrl('');
    if (oldUrl) await removeLandingMedia(oldUrl);
  };

  if (loading) return <p className="pa-empty" role="status"><Loader2 size={16} className="animate-spin" /> Chargement…</p>;
  if (!loaded) return <p className="pa-empty">La configuration du site vitrine est indisponible.</p>;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'contenu', label: 'Accueil' }, { key: 'modules', label: 'Modules' }, { key: 'secteurs', label: 'Secteurs' },
    { key: 'demo', label: 'Captures' }, { key: 'preuves', label: 'Références clients' }, { key: 'whyfaq', label: 'Avantages et FAQ' },
    { key: 'legal', label: 'Documents légaux' }, { key: 'effets', label: 'Filtres visuels' },
  ];
  const legalDocuments = [
    { slug: '/mentions-legales', label: 'Mentions légales', value: legalMentions, set: setLegalMentions, initial: DEFAULT_LEGAL_MENTIONS },
    { slug: '/confidentialite', label: 'Politique de confidentialité', value: privacyPolicy, set: setPrivacyPolicy, initial: DEFAULT_PRIVACY_POLICY },
    { slug: '/cgu', label: 'Conditions générales d’utilisation', value: termsOfService, set: setTermsOfService, initial: DEFAULT_TERMS_OF_SERVICE },
  ];
  const currentDocument = legalDocuments.find(item => item.slug === document);
  const busy = saving || uploadingKey !== null || sectorBusy !== null;
  const saveAction = (
    <button type="button" className="pa-button" data-variant="primary" disabled={busy} onClick={() => void save()}>
      {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Enregistrer le site vitrine
    </button>
  );

  const renderFeatures = (kind: 'modules' | 'why') => {
    const isModules = kind === 'modules';
    const list = isModules ? features : whyWaarwi;
    const setList = isModules ? setFeatures : setWhyWaarwi;
    return (
      <section className="pa-page">
        <div className="pa-section-head">
          <h2 className="pa-heading">{isModules ? 'Modules présentés' : 'Pourquoi Waarwi'}</h2>
          <div className="pa-inline">
            <button type="button" className="pa-link" disabled={busy} onClick={() => setList((isModules ? DEFAULT_LANDING_FEATURES : DEFAULT_WHY).map(item => ({ ...item })))}>
              <RotateCcw size={15} /> Rétablir la liste
            </button>
            <button type="button" className="pa-button" data-variant="primary" disabled={busy}
              onClick={() => setList([...list, { icon: isModules ? 'ShoppingCart' : 'MapPin', title: '', desc: '' }])}>
              <Plus size={16} /> {isModules ? 'Ajouter un module' : 'Ajouter un avantage'}
            </button>
          </div>
        </div>
        {list.length === 0 ? <p className="pa-empty">Aucun élément personnalisé.</p> : (
          <div className="pa-divided">
            {list.map((item, index) => {
              const Icon = ICON_MAP_ADMIN[item.icon] || Shield;
              const update = (patch: Partial<LandingFeatureItem>) => setList(previous => previous.map((row, i) => i === index ? { ...row, ...patch } : row));
              const uploadImage = isModules ? uploadFeatureImage : uploadWhyImage;
              const removeImage = isModules ? removeFeatureImage : removeWhyImage;
              return (
                <LandingEntry key={index} title={item.title || (isModules ? 'Nouveau module' : 'Nouvel avantage')}
                  icon={<Icon size={16} />} initiallyOpen={!item.title}>
                  <div className="pa-form-grid">
                    <TextControl label="Titre" value={item.title} onChange={title => update({ title })} />
                    <label className="pa-field-label">Icône
                      <select className="w-input-ul" value={item.icon} onChange={event => update({ icon: event.target.value })}>
                        {AVAILABLE_ICONS.map(icon => <option key={icon.value} value={icon.value}>{icon.label}</option>)}
                      </select>
                    </label>
                    <TextControl label="Description" value={item.desc} onChange={desc => update({ desc })} rows={2} />
                  </div>
                  <ImageFields url={item.image_url} alt={item.image_alt} position={item.image_position}
                    busy={busy} onFile={file => uploadImage(index, file, !!item.image_url)} onRemove={() => removeImage(index)}
                    onAlt={image_alt => update({ image_alt })} onPosition={image_position => update({ image_position })} />
                  <OrderActions index={index} count={list.length} busy={busy}
                    onMove={step => setList(move(list, index, step))} onRemove={() => setList(list.filter((_, i) => i !== index))} />
                </LandingEntry>
              );
            })}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="pa-page">
      <div className="pa-editor-nav">
        <nav className="pa-tabs" aria-label="Configuration du site vitrine">
          {tabs.map(item => (
            <button type="button" key={item.key} aria-current={activeTab === item.key ? 'page' : undefined}
              onClick={() => { setActiveTab(item.key); setDocument(undefined); }}>{item.label}</button>
          ))}
        </nav>
        {!currentDocument && saveAction}
      </div>

      {activeTab === 'contenu' && (
        <div className="pa-form">
          <section className="space-y-2">
            <div className="pa-section-head">
              <h2 className="pa-heading">En-tête du site</h2>
              <a href="https://waarwi.com" target="_blank" rel="noreferrer" className="pa-link">Ouvrir le site public <ArrowUpRight size={15} /></a>
            </div>
            <div className="pa-form-grid">
              <TextControl label="Début du titre" value={heroHeadline} onChange={setHeroHeadline} />
              <TextControl label="Suite du titre" value={heroAccent} onChange={setHeroAccent} />
              <TextControl label="Texte de présentation" rows={2} value={heroSubtitle} onChange={setHeroSubtitle} />
              <TextControl label="Libellé du bouton d’inscription" value={heroCtaLabel} onChange={setHeroCtaLabel} />
            </div>
          </section>

          <section className="pa-panel space-y-2">
            <h2 className="pa-heading">Images de présentation</h2>
            <div className="pa-form-grid">
              <div>
                <FileControl label="Image pour ordinateur" busy={busy} onFile={uploadHeroImage} />
                {heroImageUrl && <div className="pa-inline">
                  <img src={heroImageUrl} alt="Présentation sur ordinateur" className="pa-media-thumb" />
                  <button type="button" className="pa-link pa-danger" disabled={busy} onClick={() => void removeHeroImage()}>Retirer l’image</button>
                </div>}
              </div>
              <div>
                <label className="pa-inline text-sm">
                  <input type="checkbox" checked={heroMobileVisible} onChange={event => setHeroMobileVisible(event.target.checked)} /> Afficher la superposition mobile
                </label>
                {heroMobileVisible && <FileControl label="Image de la superposition" busy={busy} onFile={uploadHeroMobileImage} />}
                {heroMobileVisible && heroMobileImageUrl && <div className="pa-inline">
                  <img src={heroMobileImageUrl} alt="Présentation sur téléphone" className="pa-media-thumb pa-media-phone" />
                  <button type="button" className="pa-link pa-danger" disabled={busy} onClick={() => void removeHeroMobileImage()}>Retirer l’image mobile</button>
                </div>}
              </div>
            </div>
          </section>

          <section className="pa-panel space-y-2">
            <h2 className="pa-heading">Chiffres et offres</h2>
            <div className="pa-form-grid">
              <TextControl label="Libellé des entreprises" value={statsTenants} onChange={setStatsTenants} />
              <TextControl label="Libellé des secteurs" value={statsSectors} onChange={setStatsSectors} />
              <TextControl label="Libellé de l’accompagnement" value={statsUptime} onChange={setStatsUptime} />
              <label className="pa-inline text-sm">
                <input type="checkbox" checked={pricingVisible} onChange={event => setPricingVisible(event.target.checked)} /> Afficher les offres publiques
              </label>
            </div>
          </section>

          <section className="pa-panel space-y-2">
            <h2 className="pa-heading">Contact et pied de page</h2>
            <div className="pa-form-grid">
              <TextControl label="Texte du pied de page" value={footerTagline} onChange={setFooterTagline} />
              <TextControl label="Adresse WhatsApp" value={whatsappUrl} onChange={setWhatsappUrl} />
              <TextControl label="Téléphone affiché" value={phoneDisplay} onChange={setPhoneDisplay} />
              <TextControl label="Numéro à appeler" value={phoneTel} onChange={setPhoneTel} />
              <TextControl label="E-mail de contact" value={contactEmail} onChange={setContactEmail} />
              <TextControl label="Horaires" value={contactHours} onChange={setContactHours} />
            </div>
          </section>
        </div>
      )}

      {activeTab === 'modules' && renderFeatures('modules')}

      {activeTab === 'secteurs' && (
        <section className="pa-page">
          <div className="pa-section-head">
            <h2 className="pa-heading">Images des secteurs d’activité</h2>
            {!sectorsLoaded && <button type="button" className="pa-link" onClick={() => void loadSectors()}><RefreshCw size={15} /> Charger les secteurs</button>}
          </div>
          {sectorsLoaded && sectors.length === 0 && <p className="pa-empty">Aucun secteur configuré.</p>}
          <div className="pa-divided">
            {sectors.map(item => {
              const Icon = SECTOR_ICONS_ADMIN[item.slug] || Store;
              return (
                <LandingEntry key={item.id} title={item.name} icon={<Icon size={16} />} note={item.image_url ? 'Image enregistrée' : undefined}>
                  {item.description && <p className="pa-copy">{item.description}</p>}
                  <ImageFields url={item.image_url} alt={item.image_alt} position={item.image_position} busy={busy} saveOnBlur
                    onFile={file => uploadSectorImage(item.id, file, !!item.image_url)} onRemove={() => removeSectorImage(item.id)}
                    onAlt={value => saveSectorMeta(item.id, { image_alt: value })} onPosition={value => saveSectorMeta(item.id, { image_position: value })} />
                </LandingEntry>
              );
            })}
          </div>
        </section>
      )}

      {activeTab === 'demo' && (
        <div className="pa-overview-grid">
          <DemoColumn title="Captures sur ordinateur" kind="desktop" items={demoDesktop} setItems={setDemoDesktop} busy={busy} onUpload={uploadShot} onReplace={replaceShot} />
          <DemoColumn title="Captures sur téléphone" kind="mobile" items={demoMobile} setItems={setDemoMobile} busy={busy} onUpload={uploadShot} onReplace={replaceShot} />
        </div>
      )}

      {activeTab === 'preuves' && (
        <div className="pa-overview-grid">
          <section className="pa-page">
            <h2 className="pa-heading">Logos clients</h2>
            <FileControl label="Ajouter un logo" busy={busy} onFile={uploadLogo} />
            {clientLogos.length === 0 ? <p className="pa-empty">Aucun logo ajouté.</p> : (
              <div className="pa-divided">
                {clientLogos.map((logo, index) => (
                  <LandingEntry key={index} title={logo.name || 'Logo client'}>
                    {logo.logo_url && <img src={logo.logo_url} alt={logo.name || ''} className="pa-media-thumb" />}
                    <TextControl label="Nom du client" value={logo.name}
                      onChange={name => setClientLogos(previous => previous.map((item, i) => i === index ? { ...item, name } : item))} />
                    <OrderActions index={index} count={clientLogos.length} busy={busy} onMove={step => setClientLogos(move(clientLogos, index, step))}
                      onRemove={() => setClientLogos(clientLogos.filter((_, i) => i !== index))} />
                  </LandingEntry>
                ))}
              </div>
            )}
          </section>
          <section className="pa-page">
            <div className="pa-section-head">
              <h2 className="pa-heading">Témoignages</h2>
              <button type="button" className="pa-button" data-variant="primary"
                onClick={() => setTestimonials([...testimonials, { quote: '', author: '' }])}><Plus size={16} /> Ajouter un témoignage</button>
            </div>
            {testimonials.length === 0 ? <p className="pa-empty">Aucun témoignage.</p> : (
              <div className="pa-divided">
                {testimonials.map((item, index) => {
                  const update = (patch: Partial<Testimonial>) => setTestimonials(previous => previous.map((row, i) => i === index ? { ...row, ...patch } : row));
                  return (
                    <LandingEntry key={index} title={item.author || 'Nouveau témoignage'} initiallyOpen={!item.author}>
                      <TextControl label="Citation" value={item.quote} onChange={quote => update({ quote })} rows={3} />
                      <div className="pa-form-grid">
                        <TextControl label="Auteur" value={item.author} onChange={author => update({ author })} />
                        <TextControl label="Fonction" value={item.role || ''} onChange={role => update({ role })} />
                        <TextControl label="Entreprise" value={item.company || ''} onChange={company => update({ company })} />
                      </div>
                      <button type="button" className="pa-link pa-danger" onClick={() => setTestimonials(testimonials.filter((_, i) => i !== index))}><Trash2 size={15} /> Retirer le témoignage</button>
                    </LandingEntry>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === 'whyfaq' && (
        <div className="pa-page">
          {renderFeatures('why')}
          <section className="pa-panel space-y-2">
            <div className="pa-section-head">
              <h2 className="pa-heading">Questions fréquentes</h2>
              <div className="pa-inline">
                <button type="button" className="pa-link" onClick={() => setFaqItems(DEFAULT_FAQ.map(item => ({ ...item })))}><RotateCcw size={15} /> Rétablir la liste</button>
                <button type="button" className="pa-button" data-variant="primary" onClick={() => setFaqItems([...faqItems, { q: '', a: '' }])}><Plus size={16} /> Ajouter une question</button>
              </div>
            </div>
            <div className="pa-divided">
              {faqItems.map((item, index) => {
                const update = (patch: Partial<FaqItem>) => setFaqItems(previous => previous.map((row, i) => i === index ? { ...row, ...patch } : row));
                return (
                  <LandingEntry key={index} title={item.q || 'Nouvelle question'} initiallyOpen={!item.q}>
                    <TextControl label="Question" value={item.q} onChange={q => update({ q })} />
                    <TextControl label="Réponse" value={item.a} onChange={a => update({ a })} rows={3} />
                    <OrderActions index={index} count={faqItems.length} onMove={step => setFaqItems(move(faqItems, index, step))}
                      onRemove={() => setFaqItems(faqItems.filter((_, i) => i !== index))} />
                  </LandingEntry>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {activeTab === 'legal' && (currentDocument ? (
        <PlatformWorkPage key={currentDocument.slug} title={currentDocument.label} backLabel="Retour aux documents légaux"
          onBack={() => setDocument(undefined)} actions={saveAction} busy={saving}>
          <MarkdownEditorPanel label={currentDocument.label} value={currentDocument.value}
            onChange={currentDocument.set} onReset={() => currentDocument.set(currentDocument.initial)} />
        </PlatformWorkPage>
      ) : (
        <div className="pa-divided">
          {legalDocuments.map(item => (
            <div key={item.slug} className="pa-setting-row">
              <div>
                <button type="button" className="pa-name-button" onClick={() => setDocument(item.slug)}>{item.label}</button>
                <p className="pa-row-subtitle">waarwi.com{item.slug}</p>
              </div>
              <button type="button" className="pa-link" onClick={() => setDocument(item.slug)} aria-label={'Modifier ' + item.label}>Modifier <ChevronRight size={15} /></button>
            </div>
          ))}
        </div>
      ))}

      {activeTab === 'effets' && (
        <section className="pa-form">
          <div className="pa-section-head">
            <label className="pa-inline text-sm">
              <input type="checkbox" checked={globalEffects.enabled}
                onChange={event => setGlobalEffects({ ...globalEffects, enabled: event.target.checked })} /> Activer les filtres du site public
            </label>
            <button type="button" className="pa-link" onClick={() => setGlobalEffects(DEFAULT_EFFECTS)}><RotateCcw size={15} /> Réinitialiser</button>
          </div>
          <div className="pa-form-grid">
            {([
              { key: 'brightness', label: 'Luminosité', min: 0, max: 200, step: 5, unit: '%' },
              { key: 'contrast', label: 'Contraste', min: 0, max: 200, step: 5, unit: '%' },
              { key: 'saturate', label: 'Saturation', min: 0, max: 200, step: 5, unit: '%' },
              { key: 'blur', label: 'Flou', min: 0, max: 20, step: 1, unit: ' px' },
              { key: 'grayscale', label: 'Niveaux de gris', min: 0, max: 100, step: 5, unit: '%' },
              { key: 'sepia', label: 'Sépia', min: 0, max: 100, step: 5, unit: '%' },
              { key: 'hueRotate', label: 'Teinte', min: 0, max: 360, step: 15, unit: '°' },
            ] as const).map(item => (
              <label key={item.key} className="pa-field-label">
                <span className="pa-section-head">{item.label}<span>{globalEffects[item.key]}{item.unit}</span></span>
                <input type="range" min={item.min} max={item.max} step={item.step} value={globalEffects[item.key]} disabled={!globalEffects.enabled}
                  onChange={event => setGlobalEffects({ ...globalEffects, [item.key]: Number(event.target.value) })} />
              </label>
            ))}
          </div>
          <details className="pa-panel">
            <summary className="pa-expander">Aperçu des filtres</summary>
            <img src={heroImageUrl || '/desktop.png'} alt="Aperçu de l’image du site public" className="max-h-64 object-contain"
              style={{ filter: buildFilterString(globalEffects) }} />
          </details>
        </section>
      )}
    </div>
  );
}

function TextControl({ label, value, onChange, rows }: { label: string; value: string; onChange: (value: string) => void; rows?: number }) {
  return <label className="pa-field-label">{label}
    {rows ? <textarea className="w-input-ul" rows={rows} value={value} onChange={event => onChange(event.target.value)} />
      : <input className="w-input-ul" value={value} onChange={event => onChange(event.target.value)} />}
  </label>;
}

function FileControl({ label, onFile, busy }: { label: string; onFile: (file: File) => void; busy?: boolean }) {
  return (
    <label className="pa-field-label">{label}
      <input type="file" disabled={busy} accept="image/png,image/jpeg,image/webp" className="pa-file"
        onChange={event => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = '';
        }} />
    </label>
  );
}

function LandingEntry({ title, note, icon, children, initiallyOpen }: { title: string; note?: string; icon?: ReactNode; children: ReactNode; initiallyOpen?: boolean }) {
  const [expanded, setExpanded] = useState(!!initiallyOpen);
  return (
    <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary className="pa-expander">
        <span className="pa-inline">{icon}<strong>{title}</strong></span>
        {note && <span className="pa-row-subtitle">{note}</span>}
      </summary>
      <div className="pa-form pb-3">{children}</div>
    </details>
  );
}

function OrderActions({ index, count, onMove, onRemove, busy }: { index: number; count: number; onMove: (step: -1 | 1) => void; onRemove: () => void; busy?: boolean }) {
  return (
    <div className="pa-inline">
      <button type="button" className="pa-link" disabled={busy || index === 0} onClick={() => onMove(-1)}><ChevronUp size={15} /> Monter</button>
      <button type="button" className="pa-link" disabled={busy || index === count - 1} onClick={() => onMove(1)}><ChevronDown size={15} /> Descendre</button>
      <button type="button" className="pa-link pa-danger" disabled={busy} onClick={onRemove}><Trash2 size={15} /> Retirer</button>
    </div>
  );
}

type ImagePosition = 'left' | 'center' | 'right';
function ImageFields({ url, alt, position, onAlt, onPosition, onFile, onRemove, busy, saveOnBlur }: {
  url?: string | null; alt?: string | null; position?: string | null; onAlt: (value: string) => void; onPosition: (value: ImagePosition) => void;
  onFile: (file: File) => void; onRemove: () => void; busy?: boolean; saveOnBlur?: boolean;
}) {
  const pos = position === 'left' || position === 'right' ? position : 'center';
  return (
    <div className="pa-form-grid">
      <div>
        <FileControl label={url ? 'Remplacer l’image' : 'Ajouter une image'} onFile={onFile} busy={busy} />
        {url && <div className="pa-inline">
          <img src={url} alt={alt || ''} className="pa-media-thumb object-cover" style={{ objectPosition: pos }} />
          <button type="button" className="pa-link pa-danger" disabled={busy} onClick={onRemove}>Retirer l’image</button>
        </div>}
      </div>
      {url && <div className="pa-form">
        {saveOnBlur ? (
          <label className="pa-field-label">Texte alternatif
            <input className="w-input-ul" key={url} defaultValue={alt || ''} onBlur={event => {
              if (event.target.value !== (alt || '')) onAlt(event.target.value);
            }} />
          </label>
        ) : <TextControl label="Texte alternatif" value={alt || ''} onChange={onAlt} />}
        <label className="pa-field-label">Cadrage de l’image
          <select className="w-input-ul" value={pos} onChange={event => onPosition(event.target.value as ImagePosition)}>
            {POSITION_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
      </div>}
    </div>
  );
}

function DemoColumn({ title, kind, items, setItems, onUpload, onReplace, busy }: {
  title: string; kind: 'desktop' | 'mobile'; items: DemoShot[]; setItems: (items: DemoShot[]) => void; busy: boolean;
  onUpload: (file: File, kind: 'desktop' | 'mobile') => void; onReplace: (file: File, kind: 'desktop' | 'mobile', index: number) => void;
}) {
  return (
    <section className="pa-page">
      <h2 className="pa-heading">{title}</h2>
      <FileControl label="Ajouter une capture" busy={busy} onFile={file => onUpload(file, kind)} />
      {items.length === 0 ? <p className="pa-empty">Aucune capture enregistrée.</p> : (
        <div className="pa-divided">
          {items.map((item, index) => {
            const update = (patch: Partial<DemoShot>) => setItems(items.map((shot, i) => i === index ? { ...shot, ...patch } : shot));
            return (
              <LandingEntry key={index} title={item.label || 'Capture sans titre'}>
                <div className="pa-form-grid">
                  <img src={item.src} alt={item.alt || ''} className={kind === 'mobile' ? 'pa-media-thumb pa-media-phone' : 'pa-media-thumb'} />
                  <FileControl label="Remplacer la capture" busy={busy} onFile={file => onReplace(file, kind, index)} />
                  <TextControl label="Titre de la capture" value={item.label} onChange={label => update({ label })} />
                  <TextControl label="Texte alternatif" value={item.alt} onChange={alt => update({ alt })} />
                </div>
                <OrderActions index={index} count={items.length} busy={busy} onMove={step => setItems(move(items, index, step))}
                  onRemove={() => setItems(items.filter((_, i) => i !== index))} />
              </LandingEntry>
            );
          })}
        </div>
      )}
    </section>
  );
}

function MarkdownEditorPanel({ label, value, onChange, onReset }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onReset: () => void;
}) {
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const ref = useRef<HTMLTextAreaElement>(null);

  const wrap = (before: string, after: string = before, placeholder = '') => {
    const ta = ref.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const sel = value.slice(start, end) || placeholder;
    const next = value.slice(0, start) + before + sel + after + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = start + before.length;
      ta.selectionEnd = start + before.length + sel.length;
    });
  };

  const prefixLine = (prefix: string) => {
    const ta = ref.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + prefix.length;
    });
  };

  const buttons = [
    { label: 'Titre 1', action: () => prefixLine('# '), icon: Heading1 },
    { label: 'Titre 2', action: () => prefixLine('## '), icon: Heading2 },
    { label: 'Titre 3', action: () => prefixLine('### '), icon: Heading3 },
    { label: 'Gras', action: () => wrap('**', '**', 'gras'), icon: Bold },
    { label: 'Italique', action: () => wrap('*', '*', 'italique'), icon: Italic },
    { label: 'Liste à puces', action: () => prefixLine('- '), icon: List },
    { label: 'Liste numérotée', action: () => prefixLine('1. '), icon: ListOrdered },
    { label: 'Insérer un lien', action: () => wrap('[', '](https://)', 'texte du lien'), icon: Link2 },
  ];

  return (
    <div className="pa-page">
      <div className="pa-editor-nav">
        <nav className="pa-tabs" aria-label="Édition du document">
          <button type="button" aria-current={view === 'edit' ? 'page' : undefined} onClick={() => setView('edit')}>Texte</button>
          <button type="button" aria-current={view === 'preview' ? 'page' : undefined} onClick={() => setView('preview')}>Aperçu</button>
        </nav>
        <button type="button" className="pa-link" onClick={onReset}><RotateCcw size={15} /> Rétablir le modèle</button>
      </div>

      {view === 'edit' ? (
        <div>
          <div className="pa-inline" role="group" aria-label="Mise en forme Markdown">
            {buttons.map(({ label, action, icon: Icon }) => (
              <button type="button" key={label} className="pa-icon-button" title={label} aria-label={label} onClick={action}><Icon size={16} /></button>
            ))}
          </div>
          <textarea ref={ref} value={value} onChange={event => onChange(event.target.value)} rows={16} lang="fr"
            className="pa-markdown w-input-ul font-mono" aria-label={label} />
          <p className="pa-row-subtitle">{value.length} caractères</p>
        </div>
      ) : value.trim() ? (
        <div className="legal-prose pa-markdown-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }} />
      ) : <p className="pa-empty">Aucun contenu.</p>}
    </div>
  );
}
