import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, X, Package, Phone, MessageCircle, ChevronDown, SlidersHorizontal,
  Tag, Car, CheckCircle2, AlertCircle, MapPin, Zap, ArrowLeft, Info,
  ShoppingCart, Plus, Minus, Trash2, Loader2, ChevronRight, Store,
  ClipboardCheck, User, Truck, CreditCard, PartyPopper, ClipboardList,
  Shield, Star, ShoppingBag, Wrench, Shirt, Cookie, Mail, Globe as GlobeIcon,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatFCFA } from '../lib/format';
import { ShopTrackOrder } from '../components/ShopTrackOrder';

// ─── Local types ─────────────────────────────────────────────────────

type ShopTenant = { id: string; name: string; legal_name?: string; logo_url: string; phone: string; email?: string; address?: string; website?: string; currency: string; business_type?: string };
type ShopSettings = {
  shop_name: string; tagline: string; logo_url: string; phone: string;
  whatsapp: string; address: string; welcome_msg: string; footer_text: string;
  delivery_modes: string[]; payment_modes: string[];
};
type ShopArticle = {
  id: string; name: string; internal_ref: string; oem_ref: string; brand: string;
  category_id: string | null; sale_price: number; image_url: string | null;
  description: string; unit: string; condition: string;
  stock_qty: number; compatibilities: Compat[];
};
type Compat = { brand_name: string; model_name: string; year_start: number; year_end: number };
type Category = { id: string; name: string; parent_id: string | null };
type VehicleBrand = { id: string; name: string };
type VehicleModel = { id: string; name: string; brand_id: string };

type CartItem = {
  article: ShopArticle;
  qty: number;
  unit_price: number; // frozen at add time
};

type CheckoutForm = {
  customer_name: string;
  customer_phone: string;
  customer_whatsapp: string;
  customer_email: string;
  customer_address: string;
  customer_note: string;
  delivery_mode: 'retrait' | 'livraison';
  delivery_address: string;
  payment_mode: string;
};

type OrderConfirmation = {
  order_number: string;
  total: number;
  items: CartItem[];
  customer_name: string;
  delivery_mode: string;
  payment_mode: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────

function stockBadge(qty: number) {
  if (qty === 0) return { label: 'Rupture', cls: 'bg-red-50 text-red-700 border border-red-100', dot: 'bg-red-500' };
  if (qty <= 3) return { label: 'Stock faible', cls: 'bg-amber-50 text-amber-700 border border-amber-100', dot: 'bg-amber-500' };
  return { label: 'Disponible', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-100', dot: 'bg-emerald-500' };
}

type ActivityTheme = {
  heroGradient: string;
  heroOverlay: string;
  heroAccent: string;
  label: string;
  icon: any;
  tagline: string;
  perks: { icon: any; label: string; sub: string }[];
};

function activityTheme(businessType: string): ActivityTheme {
  switch (businessType) {
    case 'auto_parts':
      return {
        heroGradient: 'linear-gradient(135deg, #0f172a 0%, #1e293b 40%, #0d5c5c 75%, #0d9488 100%)',
        heroOverlay: 'radial-gradient(600px 320px at 85% 10%, rgba(20,184,166,0.35), transparent 65%), radial-gradient(500px 300px at 10% 100%, rgba(15,118,110,0.35), transparent 60%)',
        heroAccent: '#14b8a6',
        label: 'Pièces détachées auto',
        icon: Car,
        tagline: 'Références OEM · Compatibilités vérifiées · Stock en temps réel',
        perks: [
          { icon: Shield, label: 'Pièces garanties', sub: 'Qualité certifiée' },
          { icon: Car, label: 'Compatibilités', sub: 'Vérifiées par véhicule' },
          { icon: Truck, label: 'Livraison express', sub: 'Partout au Sénégal' },
        ],
      };
    case 'textile':
    case 'clothing':
      return {
        heroGradient: 'linear-gradient(135deg, #1a1a1a 0%, #2a1a2a 40%, #3d2b2b 75%, #c2410c 100%)',
        heroOverlay: 'radial-gradient(600px 320px at 85% 10%, rgba(251,146,60,0.3), transparent 65%), radial-gradient(500px 300px at 10% 100%, rgba(217,119,6,0.3), transparent 60%)',
        heroAccent: '#fb923c',
        label: 'Mode & Textile',
        icon: Shirt,
        tagline: 'Les dernières tendances · Tailles complètes · Style éditorial',
        perks: [
          { icon: Star, label: 'Nouveautés', sub: 'Chaque semaine' },
          { icon: Shirt, label: 'Toutes les tailles', sub: 'XS au XXL' },
          { icon: Truck, label: 'Livraison soignée', sub: 'Emballage premium' },
        ],
      };
    case 'food':
    case 'restaurant':
      return {
        heroGradient: 'linear-gradient(135deg, #0b2e13 0%, #14532d 40%, #166534 75%, #16a34a 100%)',
        heroOverlay: 'radial-gradient(600px 320px at 85% 10%, rgba(74,222,128,0.3), transparent 65%), radial-gradient(500px 300px at 10% 100%, rgba(22,163,74,0.3), transparent 60%)',
        heroAccent: '#4ade80',
        label: 'Alimentaire & Frais',
        icon: Cookie,
        tagline: 'Produits frais · Disponibilité immédiate · Livraison rapide',
        perks: [
          { icon: Zap, label: 'Livraison rapide', sub: '30 minutes en ville' },
          { icon: Cookie, label: 'Produits frais', sub: 'Qualité garantie' },
          { icon: CheckCircle2, label: 'Paiement sécurisé', sub: 'Mobile money accepté' },
        ],
      };
    case 'hardware':
    case 'quincaillerie':
      return {
        heroGradient: 'linear-gradient(135deg, #1c1917 0%, #292524 40%, #44403c 75%, #ca8a04 100%)',
        heroOverlay: 'radial-gradient(600px 320px at 85% 10%, rgba(234,179,8,0.3), transparent 65%), radial-gradient(500px 300px at 10% 100%, rgba(161,98,7,0.3), transparent 60%)',
        heroAccent: '#eab308',
        label: 'Quincaillerie & Matériaux',
        icon: Wrench,
        tagline: 'Outils professionnels · Matériaux robustes · Stock dépôt',
        perks: [
          { icon: Wrench, label: 'Pros & chantiers', sub: 'Marques reconnues' },
          { icon: Shield, label: 'Robuste', sub: 'Qualité industrielle' },
          { icon: Truck, label: 'Gros volumes', sub: 'Livraison adaptée' },
        ],
      };
    default:
      return {
        heroGradient: 'linear-gradient(135deg, #041d2e 0%, #063b44 40%, #0d5c5c 70%, #0d9488 100%)',
        heroOverlay: 'radial-gradient(600px 320px at 85% 10%, rgba(20,184,166,0.3), transparent 65%), radial-gradient(500px 300px at 10% 100%, rgba(15,118,110,0.3), transparent 60%)',
        heroAccent: '#14b8a6',
        label: 'Boutique en ligne',
        icon: ShoppingBag,
        tagline: 'Produits sélectionnés · Paiement sécurisé · Livraison rapide',
        perks: [
          { icon: Shield, label: 'Achat sécurisé', sub: 'Données protégées' },
          { icon: Truck, label: 'Livraison rapide', sub: 'Partout au Sénégal' },
          { icon: CreditCard, label: 'Paiement flexible', sub: 'Mobile money, cash' },
        ],
      };
  }
}

const DELIVERY_LABELS: Record<string, string> = {
  retrait: 'Retrait en magasin',
  livraison: 'Livraison à domicile',
};
const PAYMENT_LABELS: Record<string, string> = {
  livraison: 'Paiement à la livraison',
  retrait: 'Paiement au retrait',
  wave: 'Wave',
  orange_money: 'Orange Money',
  free_money: 'Free Money',
};

// ─── Main component ───────────────────────────────────────────────────

export function Shop({ slug, initialView = 'shop' }: { slug: string; initialView?: 'shop' | 'track' }) {
  // ── Data state ──
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [tenant, setTenant] = useState<ShopTenant | null>(null);
  const [shopSettings, setShopSettings] = useState<ShopSettings | null>(null);
  const [articles, setArticles] = useState<ShopArticle[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [vehicleBrands, setVehicleBrands] = useState<VehicleBrand[]>([]);
  const [vehicleModels, setVehicleModels] = useState<VehicleModel[]>([]);

  // ── Filter state ──
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [filterBrand, setFilterBrand] = useState('');
  const [filterModel, setFilterModel] = useState('');
  const [filterAvail, setFilterAvail] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // ── UI state ──
  const [detail, setDetail] = useState<ShopArticle | null>(null);
  const [cartOpen, setCartOpen] = useState(false);

  // ── Cart state ──
  const [cart, setCart] = useState<CartItem[]>([]);

  // ── View: 'shop' | 'checkout' | 'confirmation' ──
  const [view, setView] = useState<'shop' | 'checkout' | 'confirmation' | 'track'>(initialView);
  const [confirmation, setConfirmation] = useState<OrderConfirmation | null>(null);

  // ── Load ──
  useEffect(() => { if (slug) loadShop(slug); }, [slug]);

  const loadShop = async (tenantSlug: string) => {
    setLoading(true);
    setNotFound(false);

    const { data: tenantRow } = await supabase
      .from('tenants').select('id,name,legal_name,logo_url,phone,email,address,website,currency,enabled_modules,is_active,approval_status,business_type')
      .eq('public_slug', tenantSlug).maybeSingle();
    if (!tenantRow) { setNotFound(true); setLoading(false); return; }

    const modules: string[] = Array.isArray((tenantRow as any).enabled_modules)
      ? (tenantRow as any).enabled_modules
      : [];
    const moduleEnabled = modules.length === 0 || modules.includes('online_orders');
    const tenantOk = (tenantRow as any).is_active !== false
      && ((tenantRow as any).approval_status || 'approved') === 'approved';
    if (!moduleEnabled || !tenantOk) { setNotFound(true); setLoading(false); return; }

    setTenant(tenantRow);

    let { data: settings } = await supabase
      .from('shop_settings')
      .select('shop_name,tagline,logo_url,phone,whatsapp,address,welcome_msg,footer_text,delivery_modes,payment_modes')
      .eq('tenant_id', tenantRow.id).maybeSingle();
    if (!settings) {
      settings = {
        shop_name: tenantRow.name, tagline: '', logo_url: tenantRow.logo_url || '',
        phone: tenantRow.phone || '', whatsapp: '', address: '',
        welcome_msg: '', footer_text: '',
        delivery_modes: ['retrait', 'livraison'], payment_modes: ['livraison', 'retrait'],
      } as any;
    }
    setShopSettings(settings);

    const [
      { data: arts }, { data: cats }, { data: vBrands }, { data: vModels },
      { data: compats },
    ] = await Promise.all([
      supabase.from('articles').select('id,name,internal_ref,oem_ref,brand,category_id,sale_price,image_url,description,unit,condition').eq('tenant_id', tenantRow.id).eq('is_active', true).order('name'),
      supabase.from('part_categories').select('id,name,parent_id').eq('tenant_id', tenantRow.id).eq('is_active', true).order('name'),
      supabase.from('vehicle_brands').select('id,name').eq('tenant_id', tenantRow.id).eq('is_active', true).order('name'),
      supabase.from('vehicle_models').select('id,name,brand_id').eq('tenant_id', tenantRow.id).order('name'),
      supabase.from('article_compatibilities').select('article_id,brand_id,model_id,year_start,year_end').eq('tenant_id', tenantRow.id),
    ]);

    let stocks: any[] = [];
    let sFrom = 0;
    while (true) {
      const { data, error: e } = await supabase.from('stock_levels').select('article_id,quantity').eq('tenant_id', tenantRow.id).range(sFrom, sFrom + 999);
      if (e || !data || data.length === 0) break;
      stocks = stocks.concat(data);
      if (data.length < 1000) break;
      sFrom += 1000;
    }

    setCategories(cats || []);
    setVehicleBrands(vBrands || []);
    setVehicleModels(vModels || []);

    const stockMap: Record<string, number> = {};
    stocks.forEach((s: any) => { stockMap[s.article_id] = (stockMap[s.article_id] || 0) + Number(s.quantity); });

    const brandNameMap: Record<string, string> = {};
    (vBrands || []).forEach((b: any) => { brandNameMap[b.id] = b.name; });
    const modelNameMap: Record<string, string> = {};
    (vModels || []).forEach((m: any) => { modelNameMap[m.id] = m.name; });

    const compatMap: Record<string, Compat[]> = {};
    (compats || []).forEach((c: any) => {
      if (!compatMap[c.article_id]) compatMap[c.article_id] = [];
      compatMap[c.article_id].push({ brand_name: brandNameMap[c.brand_id] || '', model_name: modelNameMap[c.model_id] || '', year_start: c.year_start || 0, year_end: c.year_end || 0 });
    });

    setArticles((arts || []).map((a: any) => ({ ...a, stock_qty: stockMap[a.id] || 0, compatibilities: compatMap[a.id] || [] })));
    setLoading(false);
  };

  // ── Cart helpers ──
  const cartTotal = useMemo(() => cart.reduce((s, i) => s + i.unit_price * i.qty, 0), [cart]);
  const cartCount = useMemo(() => cart.reduce((s, i) => s + i.qty, 0), [cart]);

  const addToCart = useCallback((article: ShopArticle) => {
    setCart(prev => {
      const existing = prev.find(i => i.article.id === article.id);
      if (existing) {
        const newQty = existing.qty + 1;
        if (newQty > article.stock_qty) return prev; // stock limit
        return prev.map(i => i.article.id === article.id ? { ...i, qty: newQty } : i);
      }
      if (article.stock_qty === 0) return prev;
      return [...prev, { article, qty: 1, unit_price: article.sale_price }];
    });
  }, []);

  const setCartQty = useCallback((articleId: string, qty: number, maxStock: number) => {
    if (qty < 1) { removeFromCart(articleId); return; }
    const safe = Math.min(qty, maxStock);
    setCart(prev => prev.map(i => i.article.id === articleId ? { ...i, qty: safe } : i));
  }, []);

  const removeFromCart = useCallback((articleId: string) => {
    setCart(prev => prev.filter(i => i.article.id !== articleId));
  }, []);

  const clearCart = () => setCart([]);

  // ── Order submit ──
  const handleOrderConfirmed = (conf: OrderConfirmation) => {
    setConfirmation(conf);
    setCart([]);
    setCartOpen(false);
    setView('confirmation');
  };

  // ── Filtered articles ──
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return articles.filter(a => {
      if (filterAvail && a.stock_qty === 0) return false;
      if (filterCat && a.category_id !== filterCat) return false;
      if (filterBrand || filterModel) {
        const hasCompat = a.compatibilities.some(c => {
          const bMatch = !filterBrand || vehicleBrands.find(b => b.id === filterBrand)?.name === c.brand_name;
          const mMatch = !filterModel || vehicleModels.find(m => m.id === filterModel)?.name === c.model_name;
          return bMatch && mMatch;
        });
        if (!hasCompat) return false;
      }
      if (!q) return true;
      return a.name.toLowerCase().includes(q) || a.internal_ref.toLowerCase().includes(q)
        || (a.oem_ref || '').toLowerCase().includes(q) || (a.brand || '').toLowerCase().includes(q)
        || a.compatibilities.some(c => c.brand_name.toLowerCase().includes(q) || c.model_name.toLowerCase().includes(q));
    });
  }, [articles, search, filterCat, filterBrand, filterModel, filterAvail, vehicleBrands, vehicleModels]);

  const modelsForBrand = vehicleModels.filter(m => !filterBrand || m.brand_id === filterBrand);
  const activeFilters = [filterCat, filterBrand, filterModel, filterAvail].filter(Boolean).length;

  const autoMode = (tenant?.business_type || 'auto_parts') === 'auto_parts';
  const shopName = shopSettings?.shop_name || tenant?.name || 'Boutique';
  const shopPhone = shopSettings?.phone || tenant?.phone || '';
  const shopWhatsApp = shopSettings?.whatsapp || '';
  const shopLogo = shopSettings?.logo_url || tenant?.logo_url || '';

  if (loading) return <ShopLoader />;
  if (notFound) return <ShopNotFound slug={slug} />;

  // ── Checkout view ──
  if (view === 'checkout' && tenant) {
    return (
      <CheckoutFlow
        cart={cart}
        cartTotal={cartTotal}
        tenant={tenant}
        shopName={shopName}
        shopSettings={shopSettings}
        onBack={() => setView('shop')}
        onConfirmed={handleOrderConfirmed}
      />
    );
  }

  // ── Confirmation view ──
  if (view === 'confirmation' && confirmation) {
    return (
      <OrderConfirmationView
        confirmation={confirmation}
        shopName={shopName}
        shopWhatsApp={shopWhatsApp}
        onBackToShop={() => { setView('shop'); setConfirmation(null); }}
        onTrack={() => setView('track')}
      />
    );
  }

  // ── Track view ──
  if (view === 'track' && tenant) {
    return (
      <ShopTrackOrder
        tenantId={tenant.id}
        shopName={shopName}
        shopLogo={shopLogo}
        shopPhone={shopPhone}
        onBack={() => setView('shop')}
        initialOrderNumber={confirmation?.order_number}
      />
    );
  }

  const theme = activityTheme(tenant?.business_type || 'auto_parts');
  const ActivityIcon = theme.icon;
  const tenantAddress = shopSettings?.address || tenant?.address || '';
  const tenantEmail = (tenant as any)?.email || '';
  const tenantWebsite = (tenant as any)?.website || '';

  // ── Shop view ──
  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-50 via-white to-neutral-100">
      {/* ── Sticky compact header ──────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-white/85 backdrop-blur-xl border-b border-neutral-200/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-3 py-2.5">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              {shopLogo ? (
                <img src={shopLogo} alt={shopName} className="w-10 h-10 object-contain shrink-0 drop-shadow-[0_2px_6px_rgba(15,23,42,0.12)]" />
              ) : (
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 flex items-center justify-center shrink-0 shadow-sm">
                  <Store className="w-5 h-5 text-white" />
                </div>
              )}
              <div className="min-w-0 leading-tight">
                <div className="text-[9.5px] font-bold uppercase tracking-[0.15em] text-brand-700/80 leading-none">{theme.label}</div>
                <div className="text-[15px] font-extrabold text-slate-900 truncate leading-tight mt-0.5">{shopName}</div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {shopWhatsApp && (
                <a href={`https://wa.me/${shopWhatsApp.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-emerald-500 text-white text-xs font-bold hover:bg-emerald-600 active:scale-95 transition-all shadow-sm">
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">WhatsApp</span>
                </a>
              )}
              <button onClick={() => setView('track')}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-neutral-100 text-neutral-700 text-xs font-bold hover:bg-neutral-200 active:scale-95 transition-all">
                <ClipboardList className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Suivi</span>
              </button>
              {cartCount > 0 && (
                <button onClick={() => setCartOpen(true)}
                  className="hidden sm:inline-flex items-center gap-2 h-9 px-3.5 rounded-xl bg-gradient-to-r from-brand-600 to-brand-800 text-white text-xs font-bold shadow-glow hover:shadow-premium active:scale-95 transition-all">
                  <ShoppingCart className="w-3.5 h-3.5" />
                  {cartCount}
                  <span className="text-brand-200">·</span>
                  {formatFCFA(cartTotal)}
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ── Hero section (activity-aware premium) ──────────────── */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0"
          style={{ background: theme.heroGradient }}
          aria-hidden
        />
        <div
          className="absolute inset-0 opacity-90 pointer-events-none"
          style={{ background: theme.heroOverlay }}
          aria-hidden
        />
        <div
          className="absolute inset-0 opacity-[0.08] pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(rgba(255,255,255,0.6) 1px, transparent 1px)',
            backgroundSize: '26px 26px',
          }}
          aria-hidden
        />
        <div
          aria-hidden
          className="absolute -top-24 -right-20 w-[420px] h-[420px] rounded-full opacity-30 blur-3xl"
          style={{ background: `radial-gradient(circle, ${theme.heroAccent} 0%, transparent 70%)` }}
        />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          {/* Brand identity */}
          <div className="flex items-start gap-4 sm:gap-6 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 border border-white/20 backdrop-blur-sm mb-2">
                <ActivityIcon className="w-3 h-3 text-white" style={{ color: theme.heroAccent }} />
                <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-white">{theme.label}</span>
              </div>
              <h1 className="text-2xl sm:text-4xl font-extrabold text-white leading-tight tracking-tight" style={{ textShadow: '0 2px 12px rgba(0,0,0,0.25)' }}>
                {shopName}
              </h1>
              {tenant?.legal_name && tenant.legal_name !== shopName && (
                <div className="text-sm font-semibold text-white/80 mt-1">{tenant.legal_name}</div>
              )}
              <p className="text-[13px] sm:text-sm text-white/85 mt-2 max-w-xl leading-relaxed">
                {shopSettings?.tagline || theme.tagline}
              </p>

              {/* Tenant contact ribbon */}
              <div className="flex flex-wrap items-center justify-start gap-x-4 gap-y-1.5 mt-4">
                {shopPhone && (
                  <a href={`tel:${shopPhone}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/90 hover:text-white transition-colors">
                    <Phone className="w-3.5 h-3.5" style={{ color: theme.heroAccent }} />
                    {shopPhone}
                  </a>
                )}
                {tenantAddress && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-white/80">
                    <MapPin className="w-3.5 h-3.5" style={{ color: theme.heroAccent }} />
                    {tenantAddress}
                  </span>
                )}
                {tenantEmail && (
                  <a href={`mailto:${tenantEmail}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-white/80 hover:text-white transition-colors">
                    <Mail className="w-3.5 h-3.5" style={{ color: theme.heroAccent }} />
                    {tenantEmail}
                  </a>
                )}
                {tenantWebsite && (
                  <a href={tenantWebsite.startsWith('http') ? tenantWebsite : `https://${tenantWebsite}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-white/80 hover:text-white transition-colors">
                    <GlobeIcon className="w-3.5 h-3.5" style={{ color: theme.heroAccent }} />
                    {tenantWebsite.replace(/^https?:\/\//, '')}
                  </a>
                )}
              </div>

              {shopSettings?.welcome_msg && (
                <div className="mt-4 inline-flex items-start gap-2 px-3 py-2 rounded-xl bg-white/10 border border-white/15 backdrop-blur-sm max-w-xl">
                  <MessageCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: theme.heroAccent }} />
                  <span className="text-[12.5px] font-medium text-white/95 leading-snug">{shopSettings.welcome_msg}</span>
                </div>
              )}
            </div>
          </div>

          {/* Perks row */}
          <div className="grid grid-cols-3 gap-2 sm:gap-4 mt-6">
            {theme.perks.map((p, i) => {
              const PIcon = p.icon;
              return (
                <div key={i} className="flex items-center gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-xl bg-white/8 border border-white/15 backdrop-blur-sm">
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${theme.heroAccent}25`, border: `1px solid ${theme.heroAccent}40` }}>
                    <PIcon className="w-4 h-4 sm:w-5 sm:h-5" style={{ color: theme.heroAccent }} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] sm:text-xs font-bold text-white leading-tight truncate">{p.label}</div>
                    <div className="text-[9.5px] sm:text-[10.5px] text-white/70 leading-tight truncate mt-0.5">{p.sub}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Premium search bar ──────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 -mt-6 relative z-10">
        <div className="flex gap-2">
          <div className="flex-1 relative group">
            <div className="absolute inset-0 rounded-2xl bg-white shadow-premium border border-neutral-200/80" />
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-brand-700 pointer-events-none z-10" strokeWidth={2.3} />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)}
              placeholder={(tenant?.business_type || 'auto_parts') === 'auto_parts' ? 'Référence, OEM, pièce, véhicule…' : 'Rechercher un produit…'}
              className="relative w-full h-12 pl-11 pr-4 rounded-2xl bg-transparent text-sm font-medium text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/25 transition-all" />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-neutral-100 transition-colors z-10">
                <X className="w-3.5 h-3.5 text-slate-400" />
              </button>
            )}
          </div>
          <button onClick={() => setFiltersOpen(true)}
            className={`relative shrink-0 h-12 px-4 rounded-2xl text-sm font-bold transition-all active:scale-95 inline-flex items-center gap-1.5 ${activeFilters > 0 ? 'bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-glow' : 'bg-white text-neutral-700 border border-neutral-200/80 shadow-premium hover:border-neutral-300'}`}>
            <SlidersHorizontal className="w-4 h-4" />
            <span className="hidden sm:inline">Filtres</span>
            {activeFilters > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-white">{activeFilters}</span>
            )}
          </button>
        </div>
      </div>

      {/* ── Active filter chips ─────────────────────────────────── */}
      {activeFilters > 0 && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-3 flex items-center gap-2 flex-wrap">
          {filterCat && <FilterChip label={categories.find(c => c.id === filterCat)?.name || 'Catégorie'} icon={<Tag className="w-3 h-3" />} onRemove={() => setFilterCat('')} />}
          {autoMode && filterBrand && <FilterChip label={vehicleBrands.find(b => b.id === filterBrand)?.name || 'Constructeur'} icon={<Car className="w-3 h-3" />} onRemove={() => { setFilterBrand(''); setFilterModel(''); }} />}
          {autoMode && filterModel && <FilterChip label={vehicleModels.find(m => m.id === filterModel)?.name || 'Modèle'} icon={<Car className="w-3 h-3" />} onRemove={() => setFilterModel('')} />}
          {filterAvail && <FilterChip label="En stock" icon={<CheckCircle2 className="w-3 h-3" />} onRemove={() => setFilterAvail(false)} />}
          <button onClick={() => { setFilterCat(''); setFilterBrand(''); setFilterModel(''); setFilterAvail(false); }} className="text-xs text-slate-500 hover:text-red-600 font-medium transition-colors underline underline-offset-2">Effacer</button>
        </div>
      )}

      {/* ── Results count ───────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4 pb-2">
        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
          {filtered.length === 0 ? 'Aucun résultat' : `${filtered.length} article${filtered.length > 1 ? 's' : ''}`}
          {search && <span className="normal-case"> pour « {search} »</span>}
        </div>
      </div>

      {/* ── Product grid ────────────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 pb-32 sm:pb-16">
        {filtered.length === 0 ? (
          <EmptyResults search={search} hasFilters={activeFilters > 0}
            onClear={() => { setSearch(''); setFilterCat(''); setFilterBrand(''); setFilterModel(''); setFilterAvail(false); }} />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
            {filtered.map(art => (
              <ProductCard
                key={art.id}
                article={art}
                categories={categories}
                cartQty={cart.find(i => i.article.id === art.id)?.qty || 0}
                onDetail={() => setDetail(art)}
                onAddToCart={() => addToCart(art)}
              />
            ))}
          </div>
        )}
      </main>

      {/* ── Footer (full tenant info) ──────────────────────────── */}
      <footer className="mt-12 border-t border-neutral-200 bg-gradient-to-b from-white to-neutral-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <div className="flex items-center gap-3 mb-3">
                {shopLogo ? (
                  <img src={shopLogo} alt={shopName} className="w-11 h-11 object-contain shrink-0" />
                ) : (
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 flex items-center justify-center shrink-0">
                    <ActivityIcon className="w-5 h-5 text-white" />
                  </div>
                )}
                <div className="leading-tight">
                  <div className="text-base font-extrabold text-slate-900">{shopName}</div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-brand-700/70 mt-0.5">{theme.label}</div>
                </div>
              </div>
              {shopSettings?.footer_text && <div className="text-xs text-slate-500 leading-relaxed">{shopSettings.footer_text}</div>}
            </div>

            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Contact</div>
              {shopPhone && (
                <a href={`tel:${shopPhone}`} className="flex items-center gap-2 text-xs font-semibold text-neutral-700 hover:text-brand-700 transition-colors">
                  <Phone className="w-3.5 h-3.5 text-brand-600" /> {shopPhone}
                </a>
              )}
              {shopWhatsApp && (
                <a href={`https://wa.me/${shopWhatsApp.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs font-semibold text-slate-700 hover:text-emerald-600 transition-colors">
                  <MessageCircle className="w-3.5 h-3.5 text-emerald-600" /> {shopWhatsApp}
                </a>
              )}
              {tenantEmail && (
                <a href={`mailto:${tenantEmail}`} className="flex items-center gap-2 text-xs font-semibold text-slate-700 hover:text-brand-700 transition-colors">
                  <Mail className="w-3.5 h-3.5 text-brand-600" /> {tenantEmail}
                </a>
              )}
              {tenantWebsite && (
                <a href={tenantWebsite.startsWith('http') ? tenantWebsite : `https://${tenantWebsite}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs font-semibold text-slate-700 hover:text-brand-700 transition-colors">
                  <GlobeIcon className="w-3.5 h-3.5 text-brand-600" /> {tenantWebsite.replace(/^https?:\/\//, '')}
                </a>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Adresse</div>
              {(shopSettings?.address || tenantAddress) && (
                <div className="flex items-start gap-2 text-xs font-medium text-slate-600 leading-relaxed">
                  <MapPin className="w-3.5 h-3.5 text-brand-600 shrink-0 mt-0.5" />
                  <span>{shopSettings?.address || tenantAddress}</span>
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-neutral-200 mt-6 pt-4 text-center">
            <div className="text-[10px] text-slate-400">Propulsée par <span className="font-bold text-slate-600">WAARWI</span> — Plateforme Business 2.0 made in Sénégal</div>
          </div>
        </div>
      </footer>

      {/* ── Mobile sticky cart button ────────────────────────────── */}
      {cartCount > 0 && (
        <div className="fixed bottom-6 inset-x-4 z-40 sm:hidden">
          <button
            onClick={() => setCartOpen(true)}
            className="w-full h-14 rounded-2xl bg-gradient-to-r from-brand-600 to-brand-800 text-white shadow-premium flex items-center justify-between px-5 active:scale-95 transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="relative">
                <ShoppingCart className="w-5 h-5" />
                <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 text-[10px] font-bold flex items-center justify-center">{cartCount}</span>
              </div>
              <span className="font-bold text-sm">Mon panier</span>
            </div>
            <span className="font-bold text-base num">{formatFCFA(cartTotal)}</span>
          </button>
        </div>
      )}

      {/* ── Filter sheet ─────────────────────────────────────────── */}
      {filtersOpen && (
        <FilterSheet
          categories={categories} vehicleBrands={autoMode ? vehicleBrands : []}
          vehicleModels={autoMode ? modelsForBrand : []}
          filterCat={filterCat} filterBrand={filterBrand}
          filterModel={filterModel} filterAvail={filterAvail}
          onCat={setFilterCat}
          onBrand={v => { setFilterBrand(v); setFilterModel(''); }}
          onModel={setFilterModel} onAvail={setFilterAvail}
          onClose={() => setFiltersOpen(false)}
        />
      )}

      {/* ── Detail sheet ─────────────────────────────────────────── */}
      {detail && (
        <DetailSheet
          article={detail} categories={categories}
          shopWhatsApp={shopWhatsApp} shopName={shopName}
          cartQty={cart.find(i => i.article.id === detail.id)?.qty || 0}
          onAddToCart={() => addToCart(detail)}
          onRemoveOne={() => setCartQty(detail.id, (cart.find(i => i.article.id === detail.id)?.qty || 1) - 1, detail.stock_qty)}
          onClose={() => setDetail(null)}
        />
      )}

      {/* ── Cart drawer/sheet ─────────────────────────────────────── */}
      {cartOpen && (
        <CartDrawer
          cart={cart} cartTotal={cartTotal}
          onClose={() => setCartOpen(false)}
          onQtyChange={(id, qty, max) => setCartQty(id, qty, max)}
          onRemove={removeFromCart}
          onCheckout={() => { setCartOpen(false); setView('checkout'); }}
        />
      )}
    </div>
  );
}

// ─── Product card ─────────────────────────────────────────────────────

function ProductCard({ article, categories, cartQty, onDetail, onAddToCart }: {
  article: ShopArticle; categories: Category[];
  cartQty: number; onDetail: () => void; onAddToCart: () => void;
}) {
  const badge = stockBadge(article.stock_qty);
  const cat = categories.find(c => c.id === article.category_id);
  const [imgErr, setImgErr] = useState(false);
  const inCart = cartQty > 0;
  const outOfStock = article.stock_qty === 0;

  return (
    <div className="product-card group relative flex flex-col">
      {/* Image */}
      <button onClick={onDetail} className="relative w-full aspect-square rounded-xl overflow-hidden bg-white border border-neutral-100 mb-2 shrink-0">
        {article.image_url && !imgErr ? (
          <img src={article.image_url} alt={article.name} className="w-full h-full object-contain p-1.5" onError={() => setImgErr(true)} />
        ) : (
          <div className="w-full h-full flex items-center justify-center opacity-20">
            <Package className="w-8 h-8 text-slate-400" />
          </div>
        )}
        {/* Stock badge */}
        <div className="absolute top-1.5 left-1.5">
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold ${badge.cls}`}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${badge.dot}`} />{badge.label}
          </span>
        </div>
        {/* In-cart indicator */}
        {inCart && (
          <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-brand-700 text-white text-[9px] font-bold flex items-center justify-center shadow-glow">{cartQty}</div>
        )}
      </button>

      {/* Info */}
      <div className="flex-1 flex flex-col min-w-0 px-0.5 pb-1">
        <button onClick={onDetail} className="flex-1 text-left">
          {cat && <div className="text-[9px] font-bold uppercase tracking-wider text-brand-600/70 truncate mb-0.5">{cat.name}</div>}
          <div className="text-[13px] font-semibold text-slate-900 leading-snug line-clamp-2 mb-1">{article.name}</div>
          {article.internal_ref && <div className="text-[10px] font-mono text-slate-400 truncate">{article.internal_ref}</div>}
          {article.oem_ref && <div className="text-[10px] font-mono text-slate-400 truncate">OEM: {article.oem_ref}</div>}
          {article.compatibilities.length > 0 && (
            <div className="text-[10px] text-slate-500 truncate flex items-center gap-1 mt-0.5">
              <Car className="w-2.5 h-2.5 shrink-0 text-slate-400" />
              {article.compatibilities[0].brand_name} {article.compatibilities[0].model_name}
              {article.compatibilities.length > 1 && <span className="text-slate-400">+{article.compatibilities.length - 1}</span>}
            </div>
          )}
          <div className="text-[15px] font-bold text-slate-900 num mt-1.5 leading-none">{formatFCFA(article.sale_price)}</div>
        </button>

        {/* Add to cart */}
        <button
          onClick={onAddToCart}
          disabled={outOfStock || cartQty >= article.stock_qty}
          className={`mt-2 w-full h-8 rounded-xl text-xs font-bold transition-all active:scale-95 inline-flex items-center justify-center gap-1 ${
            outOfStock || cartQty >= article.stock_qty
              ? 'bg-neutral-100 text-neutral-400 cursor-not-allowed'
              : inCart
                ? 'bg-brand-50 text-brand-700 border border-brand-200 hover:bg-brand-100'
                : 'bg-gradient-to-r from-brand-600 to-brand-700 text-white shadow-sm hover:shadow-glow'
          }`}
        >
          {outOfStock ? 'Rupture' : cartQty >= article.stock_qty ? 'Max stock' : (<><Plus className="w-3 h-3" />{inCart ? 'Ajouter encore' : 'Ajouter'}</>)}
        </button>
      </div>
    </div>
  );
}

// ─── Cart drawer ──────────────────────────────────────────────────────

function CartDrawer({ cart, cartTotal, onClose, onQtyChange, onRemove, onCheckout }: {
  cart: CartItem[]; cartTotal: number;
  onClose: () => void;
  onQtyChange: (id: string, qty: number, max: number) => void;
  onRemove: (id: string) => void;
  onCheckout: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end animate-fade-in">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />

      {/* Mobile: bottom sheet | Desktop: side drawer */}
      <div className="relative w-full sm:w-[420px] bg-white sm:h-full flex flex-col max-h-[92vh] sm:max-h-full rounded-t-3xl sm:rounded-none shadow-premium animate-sheet-up sm:animate-slide-up">
        {/* Handle mobile */}
        <div className="pt-3 pb-1 sm:hidden flex justify-center shrink-0">
          <div className="w-10 h-1.5 rounded-full bg-slate-200" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-600 to-brand-700 flex items-center justify-center shadow-glow">
              <ShoppingCart className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Panier</div>
              <div className="text-base font-bold text-slate-900">{cart.length} article{cart.length > 1 ? 's' : ''}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-neutral-100 text-neutral-500 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
              <div className="w-16 h-16 rounded-2xl bg-neutral-100 flex items-center justify-center">
                <ShoppingCart className="w-7 h-7 text-slate-300" />
              </div>
              <div className="text-sm font-semibold text-slate-500">Panier vide</div>
            </div>
          ) : (
            cart.map(item => (
              <CartLine
                key={item.article.id}
                item={item}
                onQtyChange={(qty) => onQtyChange(item.article.id, qty, item.article.stock_qty)}
                onRemove={() => onRemove(item.article.id)}
              />
            ))
          )}
        </div>

        {/* Footer */}
        {cart.length > 0 && (
          <div className="shrink-0 border-t border-neutral-100 bg-white/95 backdrop-blur-md p-4 space-y-3 safe-bottom">
            {/* Total */}
            <div className="flex items-center justify-between px-1">
              <span className="text-sm font-semibold text-slate-600">Total panier</span>
              <span className="text-xl font-bold text-slate-900 num">{formatFCFA(cartTotal)}</span>
            </div>
            <button
              onClick={onCheckout}
              className="w-full h-13 py-3.5 rounded-xl bg-gradient-to-br from-brand-600 to-brand-700 text-white font-bold shadow-glow hover:shadow-premium active:scale-95 transition-all inline-flex items-center justify-center gap-2"
            >
              <ClipboardCheck className="w-5 h-5" />
              Commander · {formatFCFA(cartTotal)}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Cart line ────────────────────────────────────────────────────────

function CartLine({ item, onQtyChange, onRemove }: {
  item: CartItem;
  onQtyChange: (qty: number) => void;
  onRemove: () => void;
}) {
  const [imgErr, setImgErr] = useState(false);
  const maxReached = item.qty >= item.article.stock_qty;

  return (
    <div className="flex items-start gap-3 p-3 rounded-2xl border border-neutral-100 bg-neutral-50/50">
      {/* Image */}
      <div className="w-14 h-14 rounded-xl bg-white border border-neutral-100 flex items-center justify-center overflow-hidden shrink-0">
        {item.article.image_url && !imgErr ? (
          <img src={item.article.image_url} alt={item.article.name} className="w-full h-full object-contain p-1" onError={() => setImgErr(true)} />
        ) : (
          <Package className="w-5 h-5 text-slate-300" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-900 line-clamp-2 leading-snug">{item.article.name}</div>
        {item.article.internal_ref && (
          <div className="text-[10px] font-mono text-slate-400 truncate mt-0.5">{item.article.internal_ref}</div>
        )}
        {item.article.oem_ref && (
          <div className="text-[10px] font-mono text-slate-400 truncate">OEM: {item.article.oem_ref}</div>
        )}
        <div className="flex items-center justify-between mt-2">
          {/* Qty controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => onQtyChange(item.qty - 1)}
              className="w-7 h-7 rounded-lg bg-white border border-neutral-200 flex items-center justify-center hover:bg-neutral-100 active:scale-90 transition-all"
            ><Minus className="w-3 h-3 text-slate-600" /></button>
            <span className="w-8 text-center text-sm font-bold text-slate-900 num">{item.qty}</span>
            <button
              onClick={() => onQtyChange(item.qty + 1)}
              disabled={maxReached}
              className={`w-7 h-7 rounded-lg border flex items-center justify-center active:scale-90 transition-all ${maxReached ? 'bg-neutral-50 border-neutral-100 opacity-40 cursor-not-allowed' : 'bg-white border-neutral-200 hover:bg-neutral-100'}`}
            ><Plus className="w-3 h-3 text-slate-600" /></button>
          </div>
          <div className="text-sm font-bold text-slate-900 num">{formatFCFA(item.unit_price * item.qty)}</div>
        </div>
        {maxReached && (
          <div className="text-[10px] text-amber-600 font-semibold mt-1">Stock maximum atteint</div>
        )}
      </div>

      {/* Remove */}
      <button onClick={onRemove} className="shrink-0 p-1.5 rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-500 transition-colors mt-0.5">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── Checkout flow ────────────────────────────────────────────────────

type CheckoutStep = 'client' | 'livraison' | 'recap';

function CheckoutFlow({ cart, cartTotal, tenant, shopName, shopSettings, onBack, onConfirmed }: {
  cart: CartItem[]; cartTotal: number;
  tenant: ShopTenant; shopName: string;
  shopSettings: ShopSettings | null;
  onBack: () => void;
  onConfirmed: (conf: OrderConfirmation) => void;
}) {
  const [step, setStep] = useState<CheckoutStep>('client');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState<CheckoutForm>({
    customer_name: '', customer_phone: '', customer_whatsapp: '',
    customer_email: '', customer_address: '', customer_note: '',
    delivery_mode: 'retrait', delivery_address: '',
    payment_mode: 'livraison',
  });

  const patch = (p: Partial<CheckoutForm>) => setForm(f => ({ ...f, ...p }));

  const deliveryModes: string[] = shopSettings?.delivery_modes || ['retrait', 'livraison'];
  const paymentModes: string[] = shopSettings?.payment_modes || ['livraison', 'retrait'];

  const validateClient = () => {
    if (!form.customer_name.trim()) { setFormError('Le nom complet est obligatoire.'); return false; }
    if (!form.customer_phone.trim()) { setFormError('Le téléphone est obligatoire.'); return false; }
    setFormError('');
    return true;
  };

  const validateLivraison = () => {
    if (form.delivery_mode === 'livraison' && !form.delivery_address.trim()) {
      setFormError("L'adresse de livraison est obligatoire."); return false;
    }
    setFormError('');
    return true;
  };

  const handleNext = () => {
    if (step === 'client') { if (validateClient()) setStep('livraison'); }
    else if (step === 'livraison') { if (validateLivraison()) setStep('recap'); }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setFormError('');
    try {
      // Generate order number
      const { data: numData } = await supabase.rpc('next_online_order_number', { p_tenant_id: tenant.id });
      const orderNumber = numData || `WEB-${Date.now()}`;

      const subtotal = cart.reduce((s, i) => s + i.unit_price * i.qty, 0);
      const total = subtotal;

      const orderPayload = {
        tenant_id: tenant.id,
        order_number: orderNumber,
        customer_name: form.customer_name.trim(),
        customer_phone: form.customer_phone.trim(),
        customer_whatsapp: form.customer_whatsapp.trim(),
        customer_email: form.customer_email.trim(),
        customer_address: form.customer_address.trim(),
        customer_note: form.customer_note.trim(),
        delivery_mode: form.delivery_mode,
        delivery_address: form.delivery_mode === 'livraison' ? form.delivery_address.trim() : '',
        delivery_fee: 0,
        payment_mode: form.payment_mode,
        payment_status: ['wave', 'orange_money', 'free_money'].includes(form.payment_mode) ? 'en_attente' : 'non_paye',
        subtotal,
        total,
        status: 'nouvelle',
        internal_note: '',
        sale_id: null,
      };

      const { data: order, error: orderErr } = await supabase
        .from('online_orders').insert(orderPayload).select('id').single();
      if (orderErr) throw orderErr;

      const items = cart.map(i => ({
        tenant_id: tenant.id,
        order_id: order.id,
        article_id: i.article.id,
        article_name: i.article.name,
        internal_ref: i.article.internal_ref,
        quantity: i.qty,
        unit_price: i.unit_price,     // frozen price
        line_total: i.unit_price * i.qty,
      }));

      const { error: itemsErr } = await supabase.from('online_order_items').insert(items);
      if (itemsErr) throw itemsErr;

      onConfirmed({
        order_number: orderNumber,
        total,
        items: cart,
        customer_name: form.customer_name,
        delivery_mode: form.delivery_mode,
        payment_mode: form.payment_mode,
      });
    } catch (e: any) {
      setFormError(e.message || 'Erreur lors de la commande. Réessayez.');
    } finally {
      setSubmitting(false);
    }
  };

  const steps: { k: CheckoutStep; label: string; icon: any }[] = [
    { k: 'client', label: 'Coordonnées', icon: User },
    { k: 'livraison', label: 'Livraison & Paiement', icon: Truck },
    { k: 'recap', label: 'Récapitulatif', icon: ClipboardCheck },
  ];
  const stepIdx = steps.findIndex(s => s.k === step);

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-50 via-white to-neutral-100">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-neutral-200/80 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3.5 flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition-colors shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-brand-700/70">Commander</div>
            <div className="text-base font-bold text-slate-900 truncate">{shopName}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[10px] text-slate-400 font-semibold">Total</div>
            <div className="text-base font-bold text-slate-900 num">{formatFCFA(cartTotal)}</div>
          </div>
        </div>

        {/* Step indicator */}
        <div className="max-w-2xl mx-auto px-4 sm:px-6 pb-3">
          <div className="flex items-center gap-1">
            {steps.map((s, i) => {
              const Icon = s.icon;
              const done = i < stepIdx;
              const active = i === stepIdx;
              return (
                <div key={s.k} className="flex items-center gap-1 flex-1">
                  <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${active ? 'bg-brand-700 text-white shadow-glow' : done ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-400'}`}>
                    {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                    <span className="hidden sm:inline truncate">{s.label}</span>
                  </div>
                  {i < steps.length - 1 && <ChevronRight className="w-3 h-3 text-slate-300 shrink-0" />}
                </div>
              );
            })}
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-4 pb-24">
        {/* Error */}
        {formError && (
          <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-red-50 border border-red-100">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <span className="text-sm text-red-700 font-medium">{formError}</span>
          </div>
        )}

        {/* Step: client */}
        {step === 'client' && (
          <div className="space-y-3">
            <SectionTitle icon={<User className="w-4 h-4" />} title="Vos coordonnées" />
            <CField label="Nom complet" required>
              <input value={form.customer_name} onChange={e => patch({ customer_name: e.target.value })}
                placeholder="Mamadou Diallo" autoFocus className="checkout-input" />
            </CField>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <CField label="Téléphone" required>
                <input value={form.customer_phone} onChange={e => patch({ customer_phone: e.target.value })}
                  type="tel" placeholder="+221 77 123 45 67" inputMode="tel" className="checkout-input" />
              </CField>
              <CField label="WhatsApp">
                <input value={form.customer_whatsapp} onChange={e => patch({ customer_whatsapp: e.target.value })}
                  type="tel" placeholder="+221 77 123 45 67" inputMode="tel" className="checkout-input" />
              </CField>
            </div>
            <CField label="Email">
              <input value={form.customer_email} onChange={e => patch({ customer_email: e.target.value })}
                type="email" placeholder="email@exemple.com" inputMode="email" className="checkout-input" />
            </CField>
            <CField label="Commentaire">
              <textarea value={form.customer_note} onChange={e => patch({ customer_note: e.target.value })}
                rows={3} placeholder="Précisions, questions…" className="checkout-input resize-none" />
            </CField>
          </div>
        )}

        {/* Step: livraison */}
        {step === 'livraison' && (
          <div className="space-y-4">
            <SectionTitle icon={<Truck className="w-4 h-4" />} title="Mode de livraison" />
            <div className="space-y-2">
              {deliveryModes.map(mode => (
                <label key={mode} className={`flex items-center gap-3 p-4 rounded-2xl border cursor-pointer transition-all ${form.delivery_mode === mode ? 'border-brand-500 bg-brand-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                  <input type="radio" name="delivery" value={mode} checked={form.delivery_mode === mode}
                    onChange={() => patch({ delivery_mode: mode as any })} className="w-4 h-4 accent-brand-700" />
                  <div>
                    <div className="font-semibold text-sm text-slate-900">{DELIVERY_LABELS[mode] || mode}</div>
                    {mode === 'retrait' && shopSettings?.address && <div className="text-xs text-slate-500 mt-0.5">{shopSettings.address}</div>}
                    {mode === 'livraison' && <div className="text-xs text-slate-500 mt-0.5">Contactez-nous pour les frais</div>}
                  </div>
                </label>
              ))}
            </div>

            {form.delivery_mode === 'livraison' && (
              <CField label="Adresse de livraison" required>
                <textarea value={form.delivery_address} onChange={e => patch({ delivery_address: e.target.value })}
                  rows={2} placeholder="Votre adresse complète…" className="checkout-input resize-none" />
              </CField>
            )}

            <SectionTitle icon={<CreditCard className="w-4 h-4" />} title="Mode de paiement" />
            <div className="space-y-2">
              {paymentModes.map(mode => (
                <label key={mode} className={`flex items-center gap-3 p-4 rounded-2xl border cursor-pointer transition-all ${form.payment_mode === mode ? 'border-brand-500 bg-brand-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                  <input type="radio" name="payment" value={mode} checked={form.payment_mode === mode}
                    onChange={() => patch({ payment_mode: mode })} className="w-4 h-4 accent-brand-700" />
                  <div>
                    <div className="font-semibold text-sm text-slate-900">{PAYMENT_LABELS[mode] || mode}</div>
                    {['wave', 'orange_money', 'free_money'].includes(mode) && (
                      <div className="text-xs text-amber-600 font-medium mt-0.5">Instructions de paiement envoyées après confirmation</div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Step: recap */}
        {step === 'recap' && (
          <div className="space-y-4">
            <SectionTitle icon={<ClipboardCheck className="w-4 h-4" />} title="Récapitulatif" />

            {/* Articles */}
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden divide-y divide-slate-100">
              {cart.map(item => (
                <div key={item.article.id} className="flex items-center gap-3 p-3.5">
                  <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center overflow-hidden shrink-0">
                    {item.article.image_url ? (
                      <img src={item.article.image_url} alt={item.article.name} className="w-full h-full object-contain p-0.5" />
                    ) : (
                      <Package className="w-4 h-4 text-slate-300" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">{item.article.name}</div>
                    <div className="text-xs text-slate-500">Qté {item.qty} × {formatFCFA(item.unit_price)}</div>
                  </div>
                  <div className="text-sm font-bold text-slate-900 num shrink-0">{formatFCFA(item.unit_price * item.qty)}</div>
                </div>
              ))}
              <div className="flex items-center justify-between px-4 py-3 bg-slate-50">
                <span className="font-bold text-sm text-slate-700">Total</span>
                <span className="text-lg font-bold text-slate-900 num">{formatFCFA(cartTotal)}</span>
              </div>
            </div>

            {/* Summary info */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2.5">
              <InfoRow label="Client" value={form.customer_name} />
              <InfoRow label="Téléphone" value={form.customer_phone} />
              <InfoRow label="Livraison" value={DELIVERY_LABELS[form.delivery_mode] || form.delivery_mode} />
              {form.delivery_mode === 'livraison' && form.delivery_address && (
                <InfoRow label="Adresse" value={form.delivery_address} />
              )}
              <InfoRow label="Paiement" value={PAYMENT_LABELS[form.payment_mode] || form.payment_mode} />
              {form.customer_note && <InfoRow label="Note" value={form.customer_note} />}
            </div>
          </div>
        )}
      </div>

      {/* Sticky footer */}
      <div className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-100 px-4 py-3 safe-bottom">
        <div className="max-w-2xl mx-auto flex gap-2.5">
          {step !== 'client' && (
            <button
              onClick={() => setStep(step === 'recap' ? 'livraison' : 'client')}
              className="h-12 px-5 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm hover:bg-slate-200 active:scale-95 transition-all inline-flex items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Retour
            </button>
          )}
          {step !== 'recap' ? (
            <button
              onClick={handleNext}
              className="flex-1 h-12 rounded-xl bg-gradient-to-br from-brand-600 to-brand-700 text-white font-bold shadow-glow hover:shadow-premium active:scale-95 transition-all inline-flex items-center justify-center gap-2"
            >
              Continuer
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex-1 h-12 rounded-xl bg-gradient-to-br from-brand-600 to-brand-700 text-white font-bold shadow-glow hover:shadow-premium active:scale-95 transition-all inline-flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
              {submitting ? 'Enregistrement…' : 'Confirmer la commande'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Order confirmation view ──────────────────────────────────────────

function OrderConfirmationView({ confirmation, shopName, shopWhatsApp, onBackToShop, onTrack }: {
  confirmation: OrderConfirmation;
  shopName: string;
  shopWhatsApp: string;
  onBackToShop: () => void;
  onTrack: () => void;
}) {
  const waMsg = shopWhatsApp
    ? encodeURIComponent(`Bonjour ${shopName},\n\nJe viens de passer la commande n° *${confirmation.order_number}*.\nNom : ${confirmation.customer_name}\nTotal : ${formatFCFA(confirmation.total)}\n\nMerci de confirmer ma commande.`)
    : null;
  const waUrl = shopWhatsApp && waMsg ? `https://wa.me/${shopWhatsApp.replace(/\D/g, '')}?text=${waMsg}` : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-brand-50/30 flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-5 animate-scale-in">
        {/* Success icon */}
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-brand-600 to-brand-800 flex items-center justify-center shadow-premium">
            <PartyPopper className="w-9 h-9 text-white" />
          </div>
        </div>

        {/* Title */}
        <div className="text-center">
          <div className="text-2xl font-bold text-slate-900">Commande confirmée !</div>
          <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">
            Votre commande a bien été enregistrée.<br />Nous vous contacterons pour confirmation.
          </p>
        </div>

        {/* Order number */}
        <div className="bg-gradient-to-br from-brand-600 to-brand-800 rounded-2xl p-5 text-center shadow-premium">
          <div className="text-brand-200 text-xs font-bold uppercase tracking-widest mb-1">Numéro de commande</div>
          <div className="text-3xl font-bold text-white tracking-widest num">{confirmation.order_number}</div>
          <div className="text-brand-200 text-xs mt-1">Conservez ce numéro pour le suivi</div>
        </div>

        {/* Summary card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Récapitulatif</div>
          </div>
          <div className="divide-y divide-slate-100">
            {confirmation.items.map(item => (
              <div key={item.article.id} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0 flex-1 mr-3">
                  <div className="text-sm font-semibold text-slate-900 truncate">{item.article.name}</div>
                  <div className="text-xs text-slate-500">Qté {item.qty} × {formatFCFA(item.unit_price)}</div>
                </div>
                <div className="text-sm font-bold text-slate-900 num shrink-0">{formatFCFA(item.unit_price * item.qty)}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between px-4 py-3.5 bg-slate-50 border-t border-slate-100">
            <span className="font-bold text-sm text-slate-700">Total commande</span>
            <span className="text-xl font-bold text-slate-900 num">{formatFCFA(confirmation.total)}</span>
          </div>
        </div>

        {/* Info rows */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-4 space-y-2.5">
          <InfoRow label="Client" value={confirmation.customer_name} />
          <InfoRow label="Livraison" value={DELIVERY_LABELS[confirmation.delivery_mode] || confirmation.delivery_mode} />
          <InfoRow label="Paiement" value={PAYMENT_LABELS[confirmation.payment_mode] || confirmation.payment_mode} />
        </div>

        {/* CTA buttons */}
        <div className="space-y-2.5">
          <button onClick={onTrack}
            className="w-full h-12 rounded-xl bg-gradient-to-r from-brand-600 to-brand-800 text-white font-bold inline-flex items-center justify-center gap-2 hover:opacity-95 active:scale-[0.98] transition-all shadow-glow">
            <ClipboardCheck className="w-4 h-4" />
            Suivre ma commande
          </button>
          {waUrl && (
            <a href={waUrl} target="_blank" rel="noopener noreferrer"
              className="w-full h-13 py-3.5 rounded-xl bg-emerald-500 text-white font-bold inline-flex items-center justify-center gap-2 hover:bg-emerald-600 active:scale-95 transition-all shadow-sm">
              <MessageCircle className="w-5 h-5" />
              Confirmer via WhatsApp
            </a>
          )}
          <button onClick={onBackToShop}
            className="w-full h-12 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm hover:bg-slate-200 active:scale-95 transition-all inline-flex items-center justify-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            Retour à la boutique
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Detail sheet ─────────────────────────────────────────────────────

function DetailSheet({ article, categories, shopWhatsApp, shopName, cartQty, onAddToCart, onRemoveOne, onClose }: {
  article: ShopArticle; categories: Category[];
  shopWhatsApp: string; shopName: string;
  cartQty: number;
  onAddToCart: () => void;
  onRemoveOne: () => void;
  onClose: () => void;
}) {
  const badge = stockBadge(article.stock_qty);
  const cat = categories.find(c => c.id === article.category_id);
  const [imgErr, setImgErr] = useState(false);
  const canAdd = article.stock_qty > 0 && cartQty < article.stock_qty;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-white sm:rounded-2xl shadow-premium flex flex-col max-h-[92vh] animate-sheet-up sm:animate-slide-up">
        <div className="pt-3 pb-1 sm:hidden flex justify-center">
          <div className="w-10 h-1.5 rounded-full bg-slate-200" />
        </div>
        <button onClick={onClose} className="hidden sm:flex absolute top-3 right-3 z-10 p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 transition-colors">
          <X className="w-4 h-4" />
        </button>

        <div className="flex-1 overflow-y-auto">
          {/* Image hero */}
          <div className="relative w-full aspect-video sm:max-h-64 bg-white border-b border-slate-100 flex items-center justify-center overflow-hidden">
            {article.image_url && !imgErr ? (
              <img src={article.image_url} alt={article.name} className="w-full h-full object-contain p-4" onError={() => setImgErr(true)} />
            ) : (
              <div className="flex items-center justify-center opacity-20"><Package className="w-20 h-20 text-slate-400" /></div>
            )}
            <div className="absolute top-3 left-3">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${badge.cls}`}>
                <span className={`w-2 h-2 rounded-full ${badge.dot}`} />{badge.label}
                {article.stock_qty > 0 && <span className="opacity-60">· {article.stock_qty}</span>}
              </span>
            </div>
            <button onClick={onClose} className="sm:hidden absolute top-3 right-3 p-2 rounded-xl bg-white/80 backdrop-blur text-slate-600 shadow-sm">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 sm:p-5 space-y-4">
            <div>
              {cat && <div className="text-[10px] font-bold uppercase tracking-wider text-brand-600/80 mb-1">{cat.name}</div>}
              <h2 className="text-xl font-bold text-slate-900 leading-snug">{article.name}</h2>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {article.internal_ref && <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">{article.internal_ref}</span>}
                {article.oem_ref && <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">OEM {article.oem_ref}</span>}
                {article.brand && <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">{article.brand}</span>}
              </div>
            </div>

            <div className="flex items-end justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Prix unitaire</div>
                <div className="text-3xl font-bold text-slate-900 num">{formatFCFA(article.sale_price)}</div>
                <div className="text-xs text-slate-500 mt-0.5">par {article.unit}</div>
              </div>
              <div className={`px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wide ${article.condition === 'neuf' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : article.condition === 'occasion' ? 'bg-amber-50 text-amber-700 border border-amber-100' : 'bg-neutral-50 text-neutral-800 border border-neutral-200'}`}>
                {article.condition}
              </div>
            </div>

            {article.description && (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center gap-1.5 mb-1.5"><Info className="w-3.5 h-3.5 text-slate-400" /><span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Description</span></div>
                <p className="text-sm text-slate-700 leading-relaxed">{article.description}</p>
              </div>
            )}

            {article.compatibilities.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2"><Car className="w-4 h-4 text-brand-600" /><span className="text-sm font-bold text-slate-800">Compatibilités</span></div>
                <div className="space-y-1.5">
                  {article.compatibilities.map((c, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 border border-slate-100">
                      <div className="font-semibold text-sm text-slate-800">{c.brand_name}{c.model_name && <span className="text-slate-500 font-medium"> · {c.model_name}</span>}</div>
                      {(c.year_start || c.year_end) && <div className="text-xs text-slate-400 num">{c.year_start || '?'} – {c.year_end || 'auj.'}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer CTA */}
        <div className="shrink-0 border-t border-slate-100 bg-white/95 backdrop-blur-md p-4 safe-bottom">
          {cartQty > 0 ? (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <button onClick={onRemoveOne} className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center hover:bg-slate-200 active:scale-90 transition-all">
                  <Minus className="w-4 h-4 text-slate-700" />
                </button>
                <span className="w-10 text-center font-bold text-slate-900 num">{cartQty}</span>
                <button onClick={onAddToCart} disabled={!canAdd}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all active:scale-90 ${canAdd ? 'bg-brand-50 border border-brand-200 hover:bg-brand-100' : 'bg-slate-50 border border-slate-100 opacity-40 cursor-not-allowed'}`}>
                  <Plus className="w-4 h-4 text-brand-700" />
                </button>
              </div>
              <div className="flex-1 h-11 rounded-xl bg-brand-50 border border-brand-200 flex items-center justify-center text-brand-800 text-sm font-bold">
                {formatFCFA(article.sale_price * cartQty)} dans le panier
              </div>
            </div>
          ) : (
            <button onClick={onAddToCart} disabled={article.stock_qty === 0}
              className={`w-full h-12 rounded-xl font-bold text-sm transition-all active:scale-95 inline-flex items-center justify-center gap-2 ${article.stock_qty === 0 ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-glow hover:shadow-premium'}`}>
              {article.stock_qty === 0 ? 'Rupture de stock' : (<><ShoppingCart className="w-4 h-4" />Ajouter au panier</>)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Filter sheet ─────────────────────────────────────────────────────

function FilterSheet({ categories, vehicleBrands, vehicleModels, filterCat, filterBrand, filterModel, filterAvail, onCat, onBrand, onModel, onAvail, onClose }: {
  categories: Category[]; vehicleBrands: VehicleBrand[]; vehicleModels: VehicleModel[];
  filterCat: string; filterBrand: string; filterModel: string; filterAvail: boolean;
  onCat: (v: string) => void; onBrand: (v: string) => void; onModel: (v: string) => void;
  onAvail: (v: boolean) => void; onClose: () => void;
}) {
  const roots = categories.filter(c => !c.parent_id);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-white sm:rounded-2xl shadow-premium flex flex-col max-h-[88vh] animate-sheet-up sm:animate-slide-up">
        <div className="pt-3 pb-1 sm:hidden"><div className="sheet-handle" /></div>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <div><div className="text-[10px] font-bold uppercase tracking-wider text-brand-700/70">Affiner</div><h3 className="text-base font-bold text-slate-900">Filtres</h3></div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Disponibilité */}
          <section>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Disponibilité</div>
            <button onClick={() => onAvail(!filterAvail)}
              className={`w-full flex items-center justify-between px-3 py-3 rounded-xl border text-sm font-semibold transition-all ${filterAvail ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'}`}>
              <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />En stock uniquement</span>
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${filterAvail ? 'bg-emerald-600 border-emerald-600' : 'border-slate-300'}`}>
                {filterAvail && <CheckCircle2 className="w-3 h-3 text-white" />}
              </div>
            </button>
          </section>

          {/* Constructeur */}
          {vehicleBrands.length > 0 && (
            <section>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Constructeur</div>
              <div className="relative">
                <select value={filterBrand} onChange={e => onBrand(e.target.value)}
                  className="w-full h-11 pl-3 pr-9 rounded-xl bg-slate-50 border border-slate-200 text-sm font-medium appearance-none focus:bg-white focus:border-brand-400 focus:ring-2 focus:ring-brand-500/15 outline-none transition-all">
                  <option value="">Tous les constructeurs</option>
                  {vehicleBrands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
            </section>
          )}

          {/* Modèle */}
          {filterBrand && vehicleModels.length > 0 && (
            <section>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Modèle</div>
              <div className="relative">
                <select value={filterModel} onChange={e => onModel(e.target.value)}
                  className="w-full h-11 pl-3 pr-9 rounded-xl bg-slate-50 border border-slate-200 text-sm font-medium appearance-none focus:bg-white focus:border-brand-400 focus:ring-2 focus:ring-brand-500/15 outline-none transition-all">
                  <option value="">Tous les modèles</option>
                  {vehicleModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
            </section>
          )}

          {/* Catégorie */}
          {roots.length > 0 && (
            <section>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Catégorie</div>
              <div className="space-y-1">
                <button onClick={() => onCat('')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${!filterCat ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'text-slate-700 hover:bg-slate-50 border border-transparent'}`}>
                  <span className="flex items-center gap-2"><Tag className="w-4 h-4" />Toutes</span>
                  {!filterCat && <CheckCircle2 className="w-4 h-4 text-brand-600" />}
                </button>
                {roots.map(root => {
                  const children = categories.filter(c => c.parent_id === root.id);
                  const sel = filterCat === root.id;
                  return (
                    <div key={root.id}>
                      <button onClick={() => onCat(root.id)}
                        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${sel ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'text-slate-800 hover:bg-slate-50 border border-transparent'}`}>
                        <span className="truncate">{root.name}</span>
                        {sel && <CheckCircle2 className="w-4 h-4 text-brand-600" />}
                      </button>
                      {children.map(child => {
                        const csel = filterCat === child.id;
                        return (
                          <button key={child.id} onClick={() => onCat(child.id)}
                            className={`w-full flex items-center justify-between pl-8 pr-3 py-2 rounded-xl text-sm transition-all ${csel ? 'bg-brand-50 text-brand-700 border border-brand-200 font-semibold' : 'text-slate-600 hover:bg-slate-50 border border-transparent'}`}>
                            <span className="truncate">↳ {child.name}</span>
                            {csel && <CheckCircle2 className="w-4 h-4 text-brand-600" />}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
        <div className="shrink-0 border-t border-slate-100 px-4 py-3 safe-bottom">
          <button onClick={onClose} className="w-full h-11 rounded-xl bg-gradient-to-br from-brand-600 to-brand-700 text-white text-sm font-bold shadow-glow hover:shadow-premium active:scale-95 transition-all">
            Voir les résultats
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────

function FilterChip({ label, icon, onRemove }: { label: string; icon?: React.ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-50 text-brand-700 border border-brand-200 text-xs font-semibold">
      {icon}{label}
      <button onClick={onRemove} className="ml-0.5 hover:text-red-500 transition-colors"><X className="w-3 h-3" /></button>
    </span>
  );
}

function EmptyResults({ search, hasFilters, onClear }: { search: string; hasFilters: boolean; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center mb-5 shadow-inner">
        <Search className="w-8 h-8 text-slate-300" />
      </div>
      <h3 className="text-lg font-bold text-slate-700 mb-1">Aucun article trouvé</h3>
      <p className="text-sm text-slate-400 max-w-xs mb-5">{search ? `Aucun résultat pour « ${search} »` : 'Aucun article ne correspond à vos filtres.'}</p>
      {(search || hasFilters) && (
        <button onClick={onClear} className="px-5 py-2.5 rounded-xl bg-brand-700 text-white text-sm font-bold shadow-glow hover:shadow-premium active:scale-95 transition-all">Effacer</button>
      )}
    </div>
  );
}

function ShopLoader() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-slate-50 to-white">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 flex items-center justify-center shadow-glow animate-pulse">
        <Package className="w-7 h-7 text-white" />
      </div>
      <div className="text-center">
        <div className="text-base font-bold text-slate-700">Chargement boutique…</div>
        <div className="text-sm text-slate-400 mt-0.5">Préparation du catalogue</div>
      </div>
      <div className="flex gap-1.5 mt-2">
        {[0, 1, 2].map(i => (
          <div key={i} className="w-2 h-2 rounded-full bg-brand-600 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
    </div>
  );
}

function ShopNotFound({ slug }: { slug: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-5 bg-gradient-to-br from-slate-50 to-white p-6 text-center">
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-red-50 to-red-100 flex items-center justify-center shadow-inner">
        <AlertCircle className="w-9 h-9 text-red-400" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-slate-800 mb-1">Boutique introuvable</h2>
        <p className="text-sm text-slate-500 max-w-xs">La boutique <span className="font-mono text-slate-700">« {slug} »</span> n'existe pas ou n'est pas encore ouverte.</p>
      </div>
      <a href="/" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-700 text-white text-sm font-bold shadow-glow hover:shadow-premium active:scale-95 transition-all">
        <ArrowLeft className="w-4 h-4" />Retour à l'accueil
      </a>
    </div>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 pb-1">
      <div className="w-7 h-7 rounded-lg bg-brand-50 flex items-center justify-center text-brand-700">{icon}</div>
      <h3 className="font-bold text-slate-800">{title}</h3>
    </div>
  );
}

function CField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 px-0.5">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </div>
      {children}
    </label>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-slate-500 font-medium shrink-0">{label}</span>
      <span className="text-slate-900 font-semibold text-right">{value}</span>
    </div>
  );
}
