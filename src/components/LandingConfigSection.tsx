import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, Globe, Eye, Loader2, Plus, RotateCcw, Trash2, Shield, Image as ImageIcon, Users, MessageSquare, HelpCircle, Sparkles, ShoppingCart, Package, FileText, Truck, BarChart3, TrendingUp, Zap, Wallet, Layers, Monitor, Receipt, MapPin, Headphones, RefreshCw, Store, Boxes, BookOpen, Shirt, Cpu, HeartPulse, Building2, Gem, Wrench, Upload, Replace } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';

type LandingFeatureItem = { icon: string; title: string; desc: string; image_url?: string; image_alt?: string; image_position?: 'left' | 'center' | 'right' };
type DemoShot = { src: string; alt: string; label: string };
type WhyItem = { icon: string; title: string; desc: string; image_url?: string; image_alt?: string; image_position?: 'left' | 'center' | 'right' };
type SectorItem = { id: string; name: string; slug: string; description?: string; is_active: boolean; image_url?: string | null; image_alt?: string | null; image_position?: string | null };
type FaqItem = { q: string; a: string };
type Testimonial = { quote: string; author: string; role?: string; company?: string };
type ClientLogo = { name: string; logo_url?: string };

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

const inputCls = "w-full h-10 px-3 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400";

async function call(action: string, payload: Record<string, unknown> = {}) {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erreur');
  return data;
}

const POSITION_OPTIONS = [
  { value: 'center', label: 'Centre' },
  { value: 'left', label: 'Gauche' },
  { value: 'right', label: 'Droite' },
] as const;

function CardImageManager({
  imageUrl, imageAlt, imagePosition, uploading, onUpload, onReplace, onRemove, onAlt, onPosition,
}: {
  imageUrl?: string | null;
  imageAlt?: string | null;
  imagePosition?: string | null;
  uploading: boolean;
  onUpload: (f: File) => void;
  onReplace: (f: File) => void;
  onRemove: () => void;
  onAlt: (v: string) => void;
  onPosition: (v: 'left' | 'center' | 'right') => void;
}) {
  const has = !!imageUrl;
  const pos = (imagePosition === 'left' || imagePosition === 'right') ? imagePosition : 'center';
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-2.5">
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-24 h-16 rounded-lg overflow-hidden border border-slate-200 bg-slate-50 flex items-center justify-center">
          {has ? (
            <img src={imageUrl!} alt={imageAlt || ''} className="w-full h-full object-cover" style={{ objectPosition: pos }} />
          ) : (
            <ImageIcon className="w-5 h-5 text-slate-300" />
          )}
        </div>
        <div className="flex-1 space-y-1.5 min-w-0">
          <div className="flex flex-wrap gap-1.5">
            {!has && (
              <label className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-brand-50 text-brand-700 text-[10px] font-semibold hover:bg-brand-100 cursor-pointer transition-colors">
                {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                Ajouter une image
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); e.currentTarget.value = ''; }} disabled={uploading} />
              </label>
            )}
            {has && (
              <>
                <label className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 text-slate-700 text-[10px] font-semibold hover:bg-slate-200 cursor-pointer transition-colors">
                  {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Replace className="w-3 h-3" />}
                  Remplacer
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onReplace(f); e.currentTarget.value = ''; }} disabled={uploading} />
                </label>
                <button onClick={onRemove} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-red-600 hover:bg-red-50 text-[10px] font-semibold transition-colors">
                  <Trash2 className="w-3 h-3" /> Supprimer
                </button>
              </>
            )}
          </div>
          {has && (
            <>
              <input value={imageAlt || ''} onChange={e => onAlt(e.target.value)} placeholder="Texte alternatif (obligatoire)" className="w-full h-7 px-2 rounded-lg border border-slate-200 text-[11px] text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-400" />
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-slate-500 font-semibold">Position</span>
                {POSITION_OPTIONS.map(o => (
                  <button key={o.value} onClick={() => onPosition(o.value)} className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors ${pos === o.value ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{o.label}</button>
                ))}
              </div>
            </>
          )}
          {!has && <p className="text-[10px] text-slate-400">Aucune image — l'icône actuelle sert de secours. PNG, JPEG ou WebP (max 5 Mo).</p>}
        </div>
      </div>
    </div>
  );
}

function CardPreview({ imageUrl, imageAlt, imagePosition, title, desc, fallback }: {
  imageUrl?: string | null;
  imageAlt?: string | null;
  imagePosition?: string | null;
  title: string;
  desc: string;
  fallback: React.ReactNode;
}) {
  const has = !!imageUrl;
  const pos = (imagePosition === 'left' || imagePosition === 'right') ? imagePosition : 'center';
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white flex h-28">
      {has ? (
        <div className="w-[38%] shrink-0 bg-slate-100 overflow-hidden">
          <img src={imageUrl!} alt={imageAlt || ''} className="w-full h-full object-cover" style={{ objectPosition: pos }} />
        </div>
      ) : (
        <div className="w-[38%] shrink-0 bg-teal-50 flex items-center justify-center">{fallback}</div>
      )}
      <div className="flex-1 p-3 flex flex-col justify-center min-w-0">
        <p className="text-xs font-bold text-slate-900 leading-snug truncate">{title || 'Titre'}</p>
        <p className="text-[11px] text-slate-600 leading-relaxed line-clamp-3 mt-1">{desc || 'Description'}</p>
      </div>
    </div>
  );
}

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

type Tab = 'contenu' | 'modules' | 'secteurs' | 'demo' | 'preuves' | 'whyfaq';

export function LandingConfigSection() {
  const { success, error } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('contenu');
  const [heroHeadline, setHeroHeadline] = useState('');
  const [heroAccent, setHeroAccent] = useState('');
  const [heroSubtitle, setHeroSubtitle] = useState('');
  const [heroCtaLabel, setHeroCtaLabel] = useState('Démarrer gratuitement');
  const [heroImageUrl, setHeroImageUrl] = useState('');
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

  useEffect(() => {
    (async () => {
      try {
        const data = await call('get_landing_config');
        setHeroHeadline(data.hero_headline || '');
        setHeroAccent(data.hero_accent || '');
        setHeroSubtitle(data.hero_subtitle || '');
        setHeroCtaLabel(data.hero_cta_label || 'Démarrer gratuitement');
        setHeroImageUrl(data.hero_image_url || '');
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
        stats_label_tenants: statsTenants, stats_label_sectors: statsSectors, stats_label_uptime: statsUptime,
        pricing_visible: pricingVisible, features, footer_tagline: footerTagline,
        demo_desktop: demoDesktop, demo_mobile: demoMobile,
        why_waarwi: whyWaarwi, faq_items: faqItems, section_titles: sectionTitles,
        whatsapp_url: whatsappUrl, phone_display: phoneDisplay, phone_tel: phoneTel,
        contact_email: contactEmail, contact_hours: contactHours,
        testimonials, client_logos: clientLogos,
      });
      success('Landing page enregistrée. Visible sur waarwi.com');
    } catch (e: any) { error(e.message); }
    setSaving(false);
  };

  const updateFeature = (idx: number, field: keyof LandingFeatureItem, value: string) =>
    setFeatures(features.map((m, i) => i === idx ? { ...m, [field]: value } : m));
  const removeFeature = (idx: number) => setFeatures(features.filter((_, i) => i !== idx));
  const addFeature = () => setFeatures([...features, { icon: 'ShoppingCart', title: '', desc: '' }]);
  const useDefaultFeatures = () => setFeatures(DEFAULT_LANDING_FEATURES.map(f => ({ ...f })));

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

  const uploadLogo = async (file: File) => {
    setUploadingKey('logo');
    try {
      const { url } = await uploadLandingMedia(file, 'client-logos');
      setClientLogos([...clientLogos, { name: '', logo_url: url }]);
      success('Logo ajouté');
    } catch (e: any) { error(e.message); }
    setUploadingKey(null);
  };

  if (loading) return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>;

  const tabs: { k: Tab; label: string; count?: number }[] = [
    { k: 'contenu', label: 'Contenu' },
    { k: 'modules', label: 'Fonctionnalités', count: features.length },
    { k: 'secteurs', label: 'Secteurs', count: sectors.length },
    { k: 'demo', label: 'Démonstration', count: demoDesktop.length + demoMobile.length },
    { k: 'preuves', label: 'Preuves', count: clientLogos.length + testimonials.length },
    { k: 'whyfaq', label: 'Pourquoi & FAQ', count: whyWaarwi.length + faqItems.length },
  ];

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200/70 rounded-3xl p-5 shadow-card">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Globe className="w-4 h-4 text-brand-700" />
              <h3 className="text-sm font-bold text-slate-900">Landing page waarwi.com</h3>
            </div>
            <p className="text-xs text-slate-500">Contenu de la page d'accueil publique. Tout est dynamique : textes, captures, preuves, FAQ et contact.</p>
          </div>
          <a href="https://waarwi.com" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 transition-colors">
            <Eye className="w-3.5 h-3.5" /> Voir la landing
          </a>
        </div>
      </div>

      <div className="flex bg-slate-100 rounded-xl p-1 border border-slate-200 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.k} onClick={() => setActiveTab(t.k)} className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all whitespace-nowrap ${activeTab === t.k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {t.label}{t.count !== undefined ? ` (${t.count})` : ''}
          </button>
        ))}
      </div>

      {activeTab === 'contenu' && (
        <div className="bg-white border border-slate-200/70 rounded-3xl p-5 shadow-card space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Titre hero (première ligne)</label>
            <input value={heroHeadline} onChange={e => setHeroHeadline(e.target.value)} placeholder="La plateforme qui simplifie, connecte et propulse" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Accent (en turquoise)</label>
            <input value={heroAccent} onChange={e => setHeroAccent(e.target.value)} placeholder="votre business." className={`${inputCls} text-teal-600 font-semibold`} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Sous-titre hero</label>
            <textarea value={heroSubtitle} onChange={e => setHeroSubtitle(e.target.value)} rows={2} placeholder="Gestion commerciale tout-en-un..." className={`${inputCls} h-auto py-2.5 resize-none`} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Label bouton CTA</label>
              <input value={heroCtaLabel} onChange={e => setHeroCtaLabel(e.target.value)} placeholder="Démarrer gratuitement" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Image hero (URL)</label>
              <input value={heroImageUrl} onChange={e => setHeroImageUrl(e.target.value)} placeholder="/desktop.png" className={inputCls} />
            </div>
          </div>
          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs font-bold text-slate-700 mb-3">Libellés des statistiques</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 mb-1">Compteur tenants</label>
                <input value={statsTenants} onChange={e => setStatsTenants(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 mb-1">Compteur secteurs</label>
                <input value={statsSectors} onChange={e => setStatsSectors(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 mb-1">Compteur uptime</label>
                <input value={statsUptime} onChange={e => setStatsUptime(e.target.value)} className={inputCls} />
              </div>
            </div>
          </div>
          <div className="border-t border-slate-100 pt-4">
            <label className="block text-xs font-semibold text-slate-700 mb-1">Tagline footer</label>
            <input value={footerTagline} onChange={e => setFooterTagline(e.target.value)} placeholder="Conçu au Sénégal..." className={inputCls} />
          </div>
          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs font-bold text-slate-700 mb-3">Coordonnées de contact</p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">WhatsApp (URL)</label>
                  <input value={whatsappUrl} onChange={e => setWhatsappUrl(e.target.value)} placeholder="https://wa.me/221..." className={inputCls} />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">Téléphone (affiché)</label>
                  <input value={phoneDisplay} onChange={e => setPhoneDisplay(e.target.value)} placeholder="77 525 41 01" className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">Téléphone (lien tel:)</label>
                  <input value={phoneTel} onChange={e => setPhoneTel(e.target.value)} placeholder="+221775254101" className={inputCls} />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">Email contact</label>
                  <input value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="contact@waarwi.com" className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 mb-1">Horaires / disponibilité</label>
                <input value={contactHours} onChange={e => setContactHours(e.target.value)} placeholder="Lun–Sam, 8h–19h" className={inputCls} />
              </div>
            </div>
          </div>
          <div className="border-t border-slate-100 pt-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-700">Section tarifs visible</p>
              <p className="text-[10px] text-slate-400">Affiche les plans publics sur la landing</p>
            </div>
            <button onClick={() => setPricingVisible(!pricingVisible)} className={`relative w-11 h-6 rounded-full transition-colors ${pricingVisible ? 'bg-brand-700' : 'bg-slate-200'}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${pricingVisible ? 'translate-x-5' : ''}`} />
            </button>
          </div>
        </div>
      )}

      {activeTab === 'modules' && (
        <div className="bg-white border border-slate-200/70 rounded-3xl p-5 shadow-card space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-700">Fonctionnalités affichées ({features.length})</p>
              <p className="text-[10px] text-slate-400">Grille de 3 colonnes sur la landing · images optionnelles (sinon icône)</p>
            </div>
            <div className="flex gap-2">
              <button onClick={useDefaultFeatures} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-semibold hover:bg-slate-200 transition-colors">
                <RotateCcw className="w-3 h-3" /> Tout rétablir
              </button>
              <button onClick={addFeature} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-brand-50 text-brand-700 text-[11px] font-semibold hover:bg-brand-100 transition-colors">
                <Plus className="w-3.5 h-3.5" /> Ajouter
              </button>
            </div>
          </div>
          {features.length === 0 && (
            <div className="text-center py-6 space-y-2">
              <p className="text-xs text-slate-400">Aucune fonctionnalité configurée.</p>
              <button onClick={useDefaultFeatures} className="text-xs font-semibold text-brand-600 hover:text-brand-700">Utiliser les modules par défaut →</button>
            </div>
          )}
          <div className="space-y-3 max-h-[520px] overflow-y-auto -mr-1 pr-1">
            {features.map((f, idx) => {
              const IconComp = ICON_MAP_ADMIN[f.icon] || Shield;
              return (
                <div key={idx} className="p-3 rounded-xl border border-slate-100 bg-slate-50/60 group space-y-2.5">
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button onClick={() => setFeatures(move(features, idx, -1))} disabled={idx === 0} className="text-slate-300 hover:text-slate-500 disabled:opacity-20 transition-colors"><ArrowUpRight className="w-3 h-3 rotate-[-90deg]" /></button>
                      <button onClick={() => setFeatures(move(features, idx, 1))} disabled={idx === features.length - 1} className="text-slate-300 hover:text-slate-500 disabled:opacity-20 transition-colors"><ArrowUpRight className="w-3 h-3 rotate-90" /></button>
                    </div>
                    <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                      <IconComp className="w-3.5 h-3.5 text-teal-600" />
                    </div>
                    <select value={f.icon} onChange={e => updateFeature(idx, 'icon', e.target.value)} className="h-8 px-2 rounded-lg border border-slate-200 text-[11px] text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-brand-400 shrink-0">
                      {AVAILABLE_ICONS.map(ic => <option key={ic.value} value={ic.value}>{ic.label}</option>)}
                    </select>
                    <input value={f.title} onChange={e => updateFeature(idx, 'title', e.target.value)} placeholder="Titre" className="flex-1 h-8 px-2.5 rounded-lg border border-slate-200 text-[11px] text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-400 min-w-0" />
                    <input value={f.desc} onChange={e => updateFeature(idx, 'desc', e.target.value)} placeholder="Description" className="flex-1 h-8 px-2.5 rounded-lg border border-slate-200 text-[11px] text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-400 min-w-0" />
                    <button onClick={() => removeFeature(idx)} className="shrink-0 p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                  <CardImageManager
                    imageUrl={f.image_url} imageAlt={f.image_alt} imagePosition={f.image_position || 'center'}
                    uploading={uploadingKey === `feat-${idx}`}
                    onUpload={file => uploadFeatureImage(idx, file, false)}
                    onReplace={file => uploadFeatureImage(idx, file, true)}
                    onRemove={() => removeFeatureImage(idx)}
                    onAlt={v => updateFeature(idx, 'image_alt', v)}
                    onPosition={v => updateFeature(idx, 'image_position', v)}
                  />
                  <CardPreview imageUrl={f.image_url} imageAlt={f.image_alt} imagePosition={f.image_position} title={f.title} desc={f.desc} fallback={<IconComp className="w-5 h-5 text-teal-600" />} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'secteurs' && (
        <div className="bg-white border border-slate-200/70 rounded-3xl p-5 shadow-card space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-700">Secteurs d’activité ({sectors.length})</p>
              <p className="text-[10px] text-slate-400">Images des cartes « Secteurs » sur la landing. Titres et descriptions non modifiables ici.</p>
            </div>
            {!sectorsLoaded && (
              <button onClick={loadSectors} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-brand-50 text-brand-700 text-[11px] font-semibold hover:bg-brand-100 transition-colors">
                <Eye className="w-3.5 h-3.5" /> Charger les secteurs
              </button>
            )}
          </div>
          {!sectorsLoaded ? (
            <p className="text-xs text-slate-400 py-6 text-center">Cliquez sur « Charger les secteurs » pour gérer les images.</p>
          ) : sectors.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">Aucun secteur configuré.</p>
          ) : (
            <div className="space-y-3 max-h-[520px] overflow-y-auto -mr-1 pr-1">
              {sectors.map((s) => {
                const SecIcon = SECTOR_ICONS_ADMIN[s.slug] || Store;
                return (
                  <div key={s.id} className="p-3 rounded-xl border border-slate-100 bg-slate-50/60 space-y-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                        <SecIcon className="w-3.5 h-3.5 text-teal-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-bold text-slate-900 truncate">{s.name}</p>
                        <p className="text-[10px] text-slate-400 truncate">{s.description || s.slug}</p>
                      </div>
                      {sectorBusy === s.id && <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-700 shrink-0" />}
                    </div>
                    <CardImageManager
                      imageUrl={s.image_url} imageAlt={s.image_alt} imagePosition={s.image_position || 'center'}
                      uploading={sectorBusy === s.id}
                      onUpload={file => uploadSectorImage(s.id, file, false)}
                      onReplace={file => uploadSectorImage(s.id, file, true)}
                      onRemove={() => removeSectorImage(s.id)}
                      onAlt={v => saveSectorMeta(s.id, { image_alt: v })}
                      onPosition={v => saveSectorMeta(s.id, { image_position: v })}
                    />
                    <CardPreview imageUrl={s.image_url} imageAlt={s.image_alt} imagePosition={s.image_position} title={s.name} desc={s.description || ''} fallback={<SecIcon className="w-5 h-5 text-teal-600" />} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'demo' && (
        <div className="bg-white border border-slate-200/70 rounded-3xl p-5 shadow-card">
          <div className="flex items-center gap-2 mb-1">
            <ImageIcon className="w-4 h-4 text-brand-700" />
            <h3 className="text-sm font-bold text-slate-900">Captures d'écran</h3>
          </div>
          <p className="text-xs text-slate-500 mb-4">PNG, JPEG ou WebP (max 5 Mo). Desktop = carrousel horizontal, Mobile = cartes empilées verticales. La navigation dans la lightbox se fait par colonne (desktop seul ou mobile seul).</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <DemoColumn title="Captures desktop" kind="desktop" items={demoDesktop} setItems={setDemoDesktop} onUpload={uploadShot} uploading={uploadingKey === 'desktop'} />
            <DemoColumn title="Captures mobile" kind="mobile" items={demoMobile} setItems={setDemoMobile} onUpload={uploadShot} uploading={uploadingKey === 'mobile'} />
          </div>
        </div>
      )}

      {activeTab === 'preuves' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200/70 rounded-3xl p-5 shadow-card space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-brand-700" />
              <h3 className="text-sm font-bold text-slate-900">Logos clients</h3>
            </div>
            <p className="text-xs text-slate-500">Logos en niveaux de gris sur la landing. PNG, JPEG ou WebP (max 5 Mo).</p>
            <div className="flex gap-2">
              <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-brand-50 text-brand-700 text-[11px] font-semibold hover:bg-brand-100 transition-colors cursor-pointer">
                {uploadingKey === 'logo' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Uploader un logo
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.currentTarget.value = ''; }} disabled={uploadingKey === 'logo'} />
              </label>
            </div>
            {clientLogos.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">Aucun logo client. La section reste masquée tant qu'aucun logo n'est ajouté.</p>
            ) : (
              <div className="space-y-2">
                {clientLogos.map((logo, idx) => (
                  <div key={idx} className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-100 bg-slate-50/60 group">
                    <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden">
                      {logo.logo_url ? <img src={logo.logo_url} alt={logo.name} className="w-full h-full object-contain" /> : <ImageIcon className="w-4 h-4 text-slate-300" />}
                    </div>
                    <input value={logo.name} onChange={e => setClientLogos(clientLogos.map((l, i) => i === idx ? { ...l, name: e.target.value } : l))} placeholder="Nom du client" className="flex-1 h-8 px-2.5 rounded-lg border border-slate-200 text-[11px] text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-400 min-w-0" />
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button onClick={() => setClientLogos(move(clientLogos, idx, -1))} disabled={idx === 0} className="text-slate-300 hover:text-slate-500 disabled:opacity-20 transition-colors"><ArrowUpRight className="w-3 h-3 rotate-[-90deg]" /></button>
                      <button onClick={() => setClientLogos(move(clientLogos, idx, 1))} disabled={idx === clientLogos.length - 1} className="text-slate-300 hover:text-slate-500 disabled:opacity-20 transition-colors"><ArrowUpRight className="w-3 h-3 rotate-90" /></button>
                    </div>
                    <button onClick={() => setClientLogos(clientLogos.filter((_, i) => i !== idx))} className="shrink-0 p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200/70 rounded-3xl p-5 shadow-card space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <MessageSquare className="w-4 h-4 text-brand-700" />
              <h3 className="text-sm font-bold text-slate-900">Témoignages</h3>
            </div>
            <p className="text-xs text-slate-500">Citations de clients. La section s'affiche uniquement si au moins un témoignage est renseigné.</p>
            <div className="flex justify-end">
              <button onClick={() => setTestimonials([...testimonials, { quote: '', author: '' }])} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-brand-50 text-brand-700 text-[11px] font-semibold hover:bg-brand-100 transition-colors">
                <Plus className="w-3.5 h-3.5" /> Ajouter
              </button>
            </div>
            {testimonials.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">Aucun témoignage.</p>
            ) : (
              <div className="space-y-3">
                {testimonials.map((t, idx) => (
                  <div key={idx} className="p-3 rounded-xl border border-slate-100 bg-slate-50/60 space-y-2 group">
                    <textarea value={t.quote} onChange={e => setTestimonials(testimonials.map((x, i) => i === idx ? { ...x, quote: e.target.value } : x))} rows={2} placeholder="Citation..." className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-[11px] text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-400 resize-none" />
                    <div className="grid grid-cols-3 gap-2">
                      <input value={t.author} onChange={e => setTestimonials(testimonials.map((x, i) => i === idx ? { ...x, author: e.target.value } : x))} placeholder="Auteur" className="h-8 px-2.5 rounded-lg border border-slate-200 text-[11px] text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-400" />
                      <input value={t.role || ''} onChange={e => setTestimonials(testimonials.map((x, i) => i === idx ? { ...x, role: e.target.value } : x))} placeholder="Rôle" className="h-8 px-2.5 rounded-lg border border-slate-200 text-[11px] text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-400" />
                      <input value={t.company || ''} onChange={e => setTestimonials(testimonials.map((x, i) => i === idx ? { ...x, company: e.target.value } : x))} placeholder="Société" className="h-8 px-2.5 rounded-lg border border-slate-200 text-[11px] text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-400" />
                    </div>
                    <div className="flex justify-end">
                      <button onClick={() => setTestimonials(testimonials.filter((_, i) => i !== idx))} className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'whyfaq' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200/70 rounded-3xl p-5 shadow-card space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-brand-700" />
                <h3 className="text-sm font-bold text-slate-900">Pourquoi Waarwi ({whyWaarwi.length})</h3>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setWhyWaarwi(DEFAULT_WHY.map(w => ({ ...w })))} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-semibold hover:bg-slate-200 transition-colors">
                  <RotateCcw className="w-3 h-3" /> Rétablir
                </button>
                <button onClick={() => setWhyWaarwi([...whyWaarwi, { icon: 'MapPin', title: '', desc: '' }])} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-brand-50 text-brand-700 text-[11px] font-semibold hover:bg-brand-100 transition-colors">
                  <Plus className="w-3.5 h-3.5" /> Ajouter
                </button>
              </div>
            </div>
            <div className="space-y-3 max-h-[520px] overflow-y-auto -mr-1 pr-1">
              {whyWaarwi.map((w, idx) => {
                const IconComp = ICON_MAP_ADMIN[w.icon] || Shield;
                return (
                  <div key={idx} className="p-3 rounded-xl border border-slate-100 bg-slate-50/60 group space-y-2.5">
                    <div className="flex items-start gap-2">
                      <div className="flex flex-col gap-0.5 shrink-0 pt-1">
                        <button onClick={() => setWhyWaarwi(move(whyWaarwi, idx, -1))} disabled={idx === 0} className="text-slate-300 hover:text-slate-500 disabled:opacity-20 transition-colors"><ArrowUpRight className="w-3 h-3 rotate-[-90deg]" /></button>
                        <button onClick={() => setWhyWaarwi(move(whyWaarwi, idx, 1))} disabled={idx === whyWaarwi.length - 1} className="text-slate-300 hover:text-slate-500 disabled:opacity-20 transition-colors"><ArrowUpRight className="w-3 h-3 rotate-90" /></button>
                      </div>
                      <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                        <IconComp className="w-3.5 h-3.5 text-teal-600" />
                      </div>
                      <div className="flex-1 space-y-1.5 min-w-0">
                        <select value={w.icon} onChange={e => setWhyWaarwi(whyWaarwi.map((x, i) => i === idx ? { ...x, icon: e.target.value } : x))} className="h-8 px-2 rounded-lg border border-slate-200 text-[11px] text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-brand-400">
                          {AVAILABLE_ICONS.map(ic => <option key={ic.value} value={ic.value}>{ic.label}</option>)}
                        </select>
                        <input value={w.title} onChange={e => setWhyWaarwi(whyWaarwi.map((x, i) => i === idx ? { ...x, title: e.target.value } : x))} placeholder="Titre" className="w-full h-8 px-2.5 rounded-lg border border-slate-200 text-[11px] text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-400" />
                        <input value={w.desc} onChange={e => setWhyWaarwi(whyWaarwi.map((x, i) => i === idx ? { ...x, desc: e.target.value } : x))} placeholder="Description" className="w-full h-8 px-2.5 rounded-lg border border-slate-200 text-[11px] text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-400" />
                      </div>
                      <button onClick={() => setWhyWaarwi(whyWaarwi.filter((_, i) => i !== idx))} className="shrink-0 p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100 mt-1"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                    <CardImageManager
                      imageUrl={w.image_url} imageAlt={w.image_alt} imagePosition={w.image_position || 'center'}
                      uploading={uploadingKey === `why-${idx}`}
                      onUpload={file => uploadWhyImage(idx, file, false)}
                      onReplace={file => uploadWhyImage(idx, file, true)}
                      onRemove={() => removeWhyImage(idx)}
                      onAlt={v => setWhyWaarwi(whyWaarwi.map((x, i) => i === idx ? { ...x, image_alt: v } : x))}
                      onPosition={v => setWhyWaarwi(whyWaarwi.map((x, i) => i === idx ? { ...x, image_position: v } : x))}
                    />
                    <CardPreview imageUrl={w.image_url} imageAlt={w.image_alt} imagePosition={w.image_position} title={w.title} desc={w.desc} fallback={<IconComp className="w-5 h-5 text-teal-600" />} />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white border border-slate-200/70 rounded-3xl p-5 shadow-card space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-brand-700" />
                <h3 className="text-sm font-bold text-slate-900">FAQ ({faqItems.length})</h3>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setFaqItems(DEFAULT_FAQ.map(f => ({ ...f })))} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-semibold hover:bg-slate-200 transition-colors">
                  <RotateCcw className="w-3 h-3" /> Rétablir
                </button>
                <button onClick={() => setFaqItems([...faqItems, { q: '', a: '' }])} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-brand-50 text-brand-700 text-[11px] font-semibold hover:bg-brand-100 transition-colors">
                  <Plus className="w-3.5 h-3.5" /> Ajouter
                </button>
              </div>
            </div>
            <div className="space-y-2 max-h-[400px] overflow-y-auto -mr-1 pr-1">
              {faqItems.map((f, idx) => (
                <div key={idx} className="p-2.5 rounded-xl border border-slate-100 bg-slate-50/60 space-y-1.5 group">
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button onClick={() => setFaqItems(move(faqItems, idx, -1))} disabled={idx === 0} className="text-slate-300 hover:text-slate-500 disabled:opacity-20 transition-colors"><ArrowUpRight className="w-3 h-3 rotate-[-90deg]" /></button>
                      <button onClick={() => setFaqItems(move(faqItems, idx, 1))} disabled={idx === faqItems.length - 1} className="text-slate-300 hover:text-slate-500 disabled:opacity-20 transition-colors"><ArrowUpRight className="w-3 h-3 rotate-90" /></button>
                    </div>
                    <input value={f.q} onChange={e => setFaqItems(faqItems.map((x, i) => i === idx ? { ...x, q: e.target.value } : x))} placeholder="Question" className="flex-1 h-8 px-2.5 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-400" />
                    <button onClick={() => setFaqItems(faqItems.filter((_, i) => i !== idx))} className="shrink-0 p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                  <textarea value={f.a} onChange={e => setFaqItems(faqItems.map((x, i) => i === idx ? { ...x, a: e.target.value } : x))} rows={2} placeholder="Réponse" className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-[11px] text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-400 resize-none" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-brand-700 text-white text-sm font-semibold hover:bg-brand-800 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Enregistrer
        </button>
      </div>
    </div>
  );
}

function DemoColumn({ title, kind, items, setItems, onUpload, uploading }: {
  title: string;
  kind: 'desktop' | 'mobile';
  items: DemoShot[];
  setItems: (i: DemoShot[]) => void;
  onUpload: (f: File, kind: 'desktop' | 'mobile') => void;
  uploading: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-slate-700">{title} ({items.length})</p>
        <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-brand-50 text-brand-700 text-[11px] font-semibold hover:bg-brand-100 transition-colors cursor-pointer">
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Uploader
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f, kind); e.currentTarget.value = ''; }} disabled={uploading} />
        </label>
      </div>
      {items.length === 0 ? (
        <div className="text-center py-8 rounded-xl border-2 border-dashed border-slate-200">
          <ImageIcon className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-xs text-slate-400">Aucune capture {kind}. Cliquez sur "Uploader".</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((shot, idx) => (
            <div key={idx} className="flex items-center gap-2 p-2 rounded-xl border border-slate-100 bg-slate-50/60 group">
              <div className={`shrink-0 rounded-lg overflow-hidden border border-slate-200 bg-white ${kind === 'desktop' ? 'w-16 h-10' : 'w-10 h-16'}`}>
                <img src={shot.src} alt={shot.alt || shot.label} className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 space-y-1 min-w-0">
                <input value={shot.label} onChange={e => setItems(items.map((s, i) => i === idx ? { ...s, label: e.target.value } : s))} placeholder="Label (ex: Tableau de bord)" className="w-full h-7 px-2 rounded-lg border border-slate-200 text-[11px] text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-400" />
                <input value={shot.alt} onChange={e => setItems(items.map((s, i) => i === idx ? { ...s, alt: e.target.value } : s))} placeholder="Texte alternatif (accessibilité)" className="w-full h-7 px-2 rounded-lg border border-slate-200 text-[11px] text-slate-500 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-400" />
              </div>
              <div className="flex flex-col gap-0.5 shrink-0">
                <button onClick={() => setItems(move(items, idx, -1))} disabled={idx === 0} className="text-slate-300 hover:text-slate-500 disabled:opacity-20 transition-colors"><ArrowUpRight className="w-3 h-3 rotate-[-90deg]" /></button>
                <button onClick={() => setItems(move(items, idx, 1))} disabled={idx === items.length - 1} className="text-slate-300 hover:text-slate-500 disabled:opacity-20 transition-colors"><ArrowUpRight className="w-3 h-3 rotate-90" /></button>
              </div>
              <button onClick={() => setItems(items.filter((_, i) => i !== idx))} className="shrink-0 p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
