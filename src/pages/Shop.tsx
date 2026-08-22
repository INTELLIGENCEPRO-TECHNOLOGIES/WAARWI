import { useEffect, useMemo, useState } from 'react';
import {
  Search,
  X,
  Package,
  MessageCircle,
  ShoppingCart,
  Loader2,
  ChevronRight,
  ChevronLeft,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  User,
  Truck,
  CreditCard,
  PartyPopper,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatFCFA } from '../lib/format';
import { ShopTrackOrder } from '../components/ShopTrackOrder';
import type {
  ShopTenant,
  ShopSettings,
  ShopArticle,
  Compat,
  Category,
  VehicleBrand,
  VehicleModel,
  CartItem,
  CheckoutForm,
  OrderConfirmation,
} from '../lib/shopTypes';
import { DELIVERY_LABELS, PAYMENT_LABELS } from '../lib/shopTypes';
import { getTheme } from '../lib/shopThemes';
import { usePersistentCart } from '../components/shop/usePersistentCart';
import { ShopLazyImage } from '../components/shop/ShopLazyImage';
import { ShopProductCard } from '../components/shop/ShopProductCard';
import { ShopSearchBar } from '../components/shop/ShopSearchBar';
import { ShopFilters } from '../components/shop/ShopFilters';
import { ShopCartDrawer } from '../components/shop/ShopCartDrawer';
import { ShopProductDetail } from '../components/shop/ShopProductDetail';
import { ShopHero } from '../components/shop/ShopHero';
import { ShopFooter } from '../components/shop/ShopFooter';
import { ShopFeaturedRow } from '../components/shop/ShopFeaturedRow';
import { ShopCategoryScroller } from '../components/shop/ShopCategoryScroller';

// ─── Meta helpers ─────────────────────────────────────────────────────

function setMetaTag(attr: 'property' | 'name', key: string, content: string) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

const DEFAULT_TITLE = 'WAARWI — Plateforme Business 2.0 made in Sénégal';
const DEFAULT_DESC = 'WAARWI — Plateforme Business 2.0 made in Sénégal';
const DEFAULT_OG_IMAGE = '/waarwi-mark.png';

function applyShopMeta(name: string, tagline: string, logo: string) {
  document.title = `${name} — WAARWI`;
  setMetaTag('property', 'og:title', name);
  setMetaTag('property', 'og:description', tagline);
  setMetaTag('property', 'og:image', logo || DEFAULT_OG_IMAGE);
  setMetaTag('name', 'twitter:title', name);
  setMetaTag('name', 'twitter:description', tagline);
  setMetaTag('name', 'twitter:image', logo || DEFAULT_OG_IMAGE);
}

function resetMeta() {
  document.title = DEFAULT_TITLE;
  setMetaTag('property', 'og:title', DEFAULT_TITLE);
  setMetaTag('property', 'og:description', DEFAULT_DESC);
  setMetaTag('property', 'og:image', DEFAULT_OG_IMAGE);
  setMetaTag('name', 'twitter:title', DEFAULT_TITLE);
  setMetaTag('name', 'twitter:description', DEFAULT_DESC);
  setMetaTag('name', 'twitter:image', DEFAULT_OG_IMAGE);
}

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
  const [featuredIds, setFeaturedIds] = useState<string[]>([]);

  // ── UI state ──
  const [detail, setDetail] = useState<ShopArticle | null>(null);
  const [cartOpen, setCartOpen] = useState(false);

  // ── Cart (persisted in localStorage per tenant) ──
  const { cart, addToCart, setCartQty, removeFromCart, clearCart } = usePersistentCart(tenant?.id || null);

  // ── View ──
  const [view, setView] = useState<'shop' | 'checkout' | 'confirmation' | 'track'>(initialView);
  const [page, setPage] = useState(1);
  const ITEMS_PER_PAGE = 20;
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
      .select('*')
      .eq('tenant_id', tenantRow.id).maybeSingle();
    if (!settings) {
      settings = {
        shop_name: tenantRow.name, tagline: '', logo_url: tenantRow.logo_url || '',
        phone: tenantRow.phone || '', whatsapp: '', address: '',
        welcome_msg: '', footer_text: '',
        delivery_modes: ['retrait', 'livraison'], payment_modes: ['livraison', 'retrait'],
        primary_color: '#0f766e',
        theme: 'premium_minimal', secondary_color: '#0f172a',
        cover_image_url: '', cover_image_alt: '',
        cover_focal_x: 50, cover_focal_y: 50,
        cover_overlay: 'dark', cover_overlay_intensity: 40,
        show_references: true, show_stock: true, low_stock_threshold: 3,
        show_perks: true, card_density: 'comfortable',
        section_order: ['hero', 'categories', 'products', 'perks', 'footer'],
        appearance_config: {},
      } as any;
    }
    setShopSettings(settings as ShopSettings);

    const [
      { data: arts }, { data: cats }, { data: vBrands }, { data: vModels },
      { data: compats },
    ] = await Promise.all([
      supabase.from('articles').select('id,name,internal_ref,oem_ref,brand,category_id,sale_price,old_price,image_url,description,unit,condition').eq('tenant_id', tenantRow.id).eq('is_active', true).order('name'),
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

    // Fetch most-sold articles for featured row
    try {
      const { data: topSold } = await supabase
        .from('sale_items')
        .select('article_id, quantity')
        .eq('tenant_id', tenantRow.id)
        .order('quantity', { ascending: false })
        .limit(200);

      const { data: topOnline } = await supabase
        .from('online_order_items')
        .select('article_id, quantity')
        .eq('tenant_id', tenantRow.id)
        .limit(200);

      const salesCount: Record<string, number> = {};
      [...(topSold || []), ...(topOnline || [])].forEach((r: any) => {
        salesCount[r.article_id] = (salesCount[r.article_id] || 0) + Number(r.quantity || 1);
      });

      const sorted = Object.entries(salesCount).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => id);
      setFeaturedIds(sorted);
    } catch {
      setFeaturedIds([]);
    }

    setLoading(false);
  };

  // ── Cart helpers ──
  const cartTotal = useMemo(() => cart.reduce((s, i) => s + i.unit_price * i.qty, 0), [cart]);
  const cartCount = useMemo(() => cart.reduce((s, i) => s + i.qty, 0), [cart]);

  const handleOrderConfirmed = (conf: OrderConfirmation) => {
    setConfirmation(conf);
    clearCart();
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

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paginatedArticles = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  useEffect(() => { setPage(1); }, [search, filterCat, filterBrand, filterModel, filterAvail]);

  const autoMode = (tenant?.business_type || 'auto_parts') === 'auto_parts';
  const theme = getTheme(shopSettings);
  const shopName = shopSettings?.shop_name || tenant?.name || 'Boutique';
  const shopPhone = shopSettings?.phone || tenant?.phone || '';
  const shopWhatsApp = shopSettings?.whatsapp || '';
  const shopLogo = shopSettings?.logo_url || tenant?.logo_url || '';

  useEffect(() => {
    if (!loading && !notFound && shopName) {
      const tagline = shopSettings?.tagline || `${shopName} sur WAARWI`;
      applyShopMeta(shopName, tagline, shopLogo);
    }
    return () => { resetMeta(); };
  }, [loading, notFound, shopName, shopLogo, shopSettings?.tagline]);

  // ── Featured articles (most sold) ──
  const featuredArticles = useMemo(() => {
    if (featuredIds.length > 0) {
      return featuredIds.map(id => articles.find(a => a.id === id)).filter(Boolean) as ShopArticle[];
    }
    return articles.slice(0, 6);
  }, [featuredIds, articles]);

  if (loading) return <ShopLoader />;
  if (notFound || !tenant) return <ShopNotFound slug={slug} />;

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

  // ── Shop view ──
  return (
    <div className="min-h-screen bg-white shop-container">
      {/* Sticky header + search */}
      <div className="sticky top-0 z-40 bg-white border-b border-neutral-100">
        <header className="px-4 sm:px-6">
          <div className="flex items-center gap-3 py-3">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              {shopLogo && (
                <img src={shopLogo} alt={shopName} className="h-8 object-contain shrink-0" />
              )}
              <div className="min-w-0 leading-tight">
                <div className="text-sm font-bold text-neutral-900 truncate uppercase tracking-wide">{shopName}</div>
              </div>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <button onClick={() => setView('track')}
                className="text-xs font-medium text-neutral-500 hover:text-neutral-900 transition-colors">
                Suivi
              </button>
              <button onClick={() => setCartOpen(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-neutral-700 hover:text-neutral-900 transition-colors">
                <ShoppingCart className="w-4 h-4" />
                {cartCount > 0 && <span className="font-bold">{cartCount}</span>}
              </button>
            </div>
          </div>
        </header>

        {/* Promo banner */}
        {shopSettings?.promo_banner_active && shopSettings.promo_banner_text && (
          <div className="overflow-hidden" style={{ background: shopSettings.promo_banner_color || '#dc2626' }}>
            <div className="py-1.5 flex">
              <span className="shop-promo-text text-xs font-bold text-white px-4">
                {shopSettings.promo_banner_text} &nbsp;&nbsp;&bull;&nbsp;&nbsp; {shopSettings.promo_banner_text} &nbsp;&nbsp;&bull;&nbsp;&nbsp; {shopSettings.promo_banner_text} &nbsp;&nbsp;&bull;&nbsp;&nbsp; {shopSettings.promo_banner_text}
              </span>
            </div>
          </div>
        )}

        {/* Search bar */}
        <div className="px-4 sm:px-6 py-3">
          <ShopSearchBar
            value={search}
            onChange={setSearch}
            onOpenFilters={() => setFiltersOpen(true)}
            activeFilterCount={activeFilters}
            isAutoParts={autoMode}
          />
        </div>
      </div>

      {/* Hero */}
      <ShopHero
        tenant={tenant}
        settings={shopSettings}
        shopName={shopName}
        theme={theme}
      />

      {/* Category bar */}
      {theme.showCategoryBar && (
        <ShopCategoryScroller
          categories={categories}
          filterCat={filterCat}
          onCat={setFilterCat}
          theme={theme}
        />
      )}

      {/* Featured row */}
      {theme.showFeaturedRow && featuredArticles.length > 0 && !search && !filterCat && (
        <ShopFeaturedRow
          articles={featuredArticles}
          cart={cart}
          onDetail={(a) => setDetail(a)}
          onAddToCart={(a) => addToCart(a)}
          onSetQty={(id, qty) => setCartQty(id, qty, articles.find(a => a.id === id)?.stock_qty || 99)}
          theme={theme}
        />
      )}

      {/* Active filter chips */}
      {activeFilters > 0 && (
        <div className="px-4 sm:px-6 pt-3 flex items-center gap-2 flex-wrap">
          {filterCat && <FilterChip label={categories.find(c => c.id === filterCat)?.name || 'Catégorie'} onRemove={() => setFilterCat('')} />}
          {autoMode && filterBrand && <FilterChip label={vehicleBrands.find(b => b.id === filterBrand)?.name || 'Constructeur'} onRemove={() => { setFilterBrand(''); setFilterModel(''); }} />}
          {autoMode && filterModel && <FilterChip label={vehicleModels.find(m => m.id === filterModel)?.name || 'Modèle'} onRemove={() => setFilterModel('')} />}
          {filterAvail && <FilterChip label="En stock" onRemove={() => setFilterAvail(false)} />}
          <button onClick={() => { setFilterCat(''); setFilterBrand(''); setFilterModel(''); setFilterAvail(false); }} className="text-xs text-neutral-500 hover:text-red-600 font-medium transition-colors">Effacer</button>
        </div>
      )}

      {/* Results count */}
      <div className="px-4 sm:px-6 pt-4 pb-2">
        <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">
          {filtered.length === 0 ? 'Aucun résultat' : `${filtered.length} article${filtered.length > 1 ? 's' : ''}`}
          {search && <span className="normal-case"> pour « {search} »</span>}
        </div>
      </div>

      {/* Product grid */}
      <main className="px-4 sm:px-6 pb-32 sm:pb-16">
        {filtered.length === 0 ? (
          <EmptyResults search={search} hasFilters={activeFilters > 0}
            onClear={() => { setSearch(''); setFilterCat(''); setFilterBrand(''); setFilterModel(''); setFilterAvail(false); }} />
        ) : (
          <>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-px bg-neutral-100">
            {paginatedArticles.map(art => (
              <ShopProductCard
                key={art.id}
                article={art}
                categories={categories}
                cartQty={cart.find(i => i.article.id === art.id)?.qty || 0}
                onDetail={() => setDetail(art)}
                onAddToCart={() => addToCart(art)}
                theme={theme}
                showReferences={shopSettings?.show_references ?? true}
                showStock={shopSettings?.show_stock ?? true}
                lowStockThreshold={shopSettings?.low_stock_threshold ?? 3}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1 pt-6 pb-2">
              <button
                onClick={() => { setPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                disabled={page === 1}
                className="w-9 h-9 border border-neutral-200 text-neutral-700 hover:bg-neutral-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center justify-center"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                .reduce<(number | 'dots')[]>((acc, p, idx, arr) => {
                  if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('dots');
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, i) =>
                  p === 'dots' ? (
                    <span key={`d${i}`} className="w-8 text-center text-neutral-400 text-sm">...</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                      className={`w-9 h-9 text-sm font-bold transition-all ${
                        p === page ? 'bg-neutral-900 text-white' : 'border border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                      }`}
                    >
                      {p}
                    </button>
                  )
                )}
              <button
                onClick={() => { setPage(p => Math.min(totalPages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                disabled={page === totalPages}
                className="w-9 h-9 border border-neutral-200 text-neutral-700 hover:bg-neutral-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center justify-center"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Results count */}
          <div className="text-center text-xs text-neutral-400 pt-2 pb-4">
            {filtered.length} produit{filtered.length > 1 ? 's' : ''}
            {totalPages > 1 && ` · Page ${page}/${totalPages}`}
          </div>
          </>
        )}
      </main>

      {/* Footer */}
      <ShopFooter
        tenant={tenant}
        settings={shopSettings}
        shopName={shopName}
        shopPhone={shopPhone}
        shopWhatsApp={shopWhatsApp}
        shopLogo={shopLogo}
        theme={theme}
      />

      {/* Mobile sticky cart button */}
      {cartCount > 0 && (
        <div className="fixed bottom-4 inset-x-4 z-40 sm:hidden">
          <button
            onClick={() => setCartOpen(true)}
            className="w-full h-12 bg-neutral-900 text-white shadow-lg flex items-center justify-between px-4 active:scale-[0.98] transition-all"
          >
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4" />
              <span className="font-bold text-sm">Panier ({cartCount})</span>
            </div>
            <span className="font-bold text-sm num">{formatFCFA(cartTotal)}</span>
          </button>
        </div>
      )}

      {/* Filters */}
      {filtersOpen && (
        <ShopFilters
          categories={categories}
          vehicleBrands={autoMode ? vehicleBrands : []}
          vehicleModels={autoMode ? modelsForBrand : []}
          filterCat={filterCat}
          filterBrand={filterBrand}
          filterModel={filterModel}
          filterAvail={filterAvail}
          onCat={setFilterCat}
          onBrand={v => { setFilterBrand(v); setFilterModel(''); }}
          onModel={setFilterModel}
          onAvail={setFilterAvail}
          onClose={() => setFiltersOpen(false)}
        />
      )}

      {/* Detail */}
      {detail && (
        <ShopProductDetail
          article={detail}
          categories={categories}
          shopWhatsApp={shopWhatsApp}
          shopName={shopName}
          cartQty={cart.find(i => i.article.id === detail.id)?.qty || 0}
          onAddToCart={() => addToCart(detail)}
          onRemoveOne={() => setCartQty(detail.id, (cart.find(i => i.article.id === detail.id)?.qty || 1) - 1, detail.stock_qty)}
          onClose={() => setDetail(null)}
          lowStockThreshold={shopSettings?.low_stock_threshold ?? 3}
        />
      )}

      {/* Cart */}
      {cartOpen && (
        <ShopCartDrawer
          cart={cart}
          cartTotal={cartTotal}
          onClose={() => setCartOpen(false)}
          onQtyChange={(id, qty, max) => setCartQty(id, qty, max)}
          onRemove={removeFromCart}
          onCheckout={() => { setCartOpen(false); setView('checkout'); }}
        />
      )}
    </div>
  );
}

// ─── Checkout flow ───────────────────────────────────────────────────

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
        unit_price: i.unit_price,
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
    { k: 'recap', label: 'Récapitulatif', icon: CheckCircle2 },
  ];
  const stepIdx = steps.findIndex(s => s.k === step);

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-40 bg-white border-b border-neutral-100">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button onClick={onBack} className="p-2 text-neutral-500 hover:text-neutral-900 transition-colors shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-neutral-900 truncate">{shopName}</div>
            <div className="text-[10px] text-neutral-400">Finaliser la commande</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[10px] text-neutral-400">Total</div>
            <div className="text-sm font-bold text-neutral-900 num">{formatFCFA(cartTotal)}</div>
          </div>
        </div>

        <div className="max-w-2xl mx-auto px-4 sm:px-6 pb-3">
          <div className="flex items-center gap-3">
            {steps.map((s, i) => {
              const done = i < stepIdx;
              const active = i === stepIdx;
              return (
                <div key={s.k} className="flex items-center gap-2">
                  <span className={`text-xs font-bold transition-all ${
                    active ? 'text-neutral-900' : done ? 'text-neutral-400' : 'text-neutral-300'
                  }`}>{s.label}</span>
                  {i < steps.length - 1 && <ChevronRight className="w-3 h-3 text-neutral-300 shrink-0" />}
                </div>
              );
            })}
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-5 pb-24">
        {formError && (
          <div className="flex items-start gap-2 text-sm text-red-600">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{formError}</span>
          </div>
        )}

        {step === 'client' && (
          <div className="space-y-5">
            <SectionTitle icon={<User className="w-4 h-4" />} title="Vos coordonnees" />
            <CField label="Nom complet" required>
              <input value={form.customer_name} onChange={e => patch({ customer_name: e.target.value })}
                placeholder="Mamadou Diallo" autoFocus className="bare-input text-sm text-neutral-900 pb-2" />
              <div className="h-px bg-neutral-200" />
            </CField>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <CField label="Telephone" required>
                <input value={form.customer_phone} onChange={e => patch({ customer_phone: e.target.value })}
                  type="tel" placeholder="+221 77 123 45 67" inputMode="tel" className="bare-input text-sm text-neutral-900 pb-2" />
                <div className="h-px bg-neutral-200" />
              </CField>
              <CField label="WhatsApp">
                <input value={form.customer_whatsapp} onChange={e => patch({ customer_whatsapp: e.target.value })}
                  type="tel" placeholder="+221 77 123 45 67" inputMode="tel" className="bare-input text-sm text-neutral-900 pb-2" />
                <div className="h-px bg-neutral-200" />
              </CField>
            </div>
            <CField label="Email">
              <input value={form.customer_email} onChange={e => patch({ customer_email: e.target.value })}
                type="email" placeholder="email@exemple.com" inputMode="email" className="bare-input text-sm text-neutral-900 pb-2" />
              <div className="h-px bg-neutral-200" />
            </CField>
            <CField label="Commentaire">
              <textarea value={form.customer_note} onChange={e => patch({ customer_note: e.target.value })}
                rows={3} placeholder="Precisions, questions..." className="bare-input text-sm text-neutral-900 pb-2 resize-none" />
              <div className="h-px bg-neutral-200" />
            </CField>
          </div>
        )}

        {step === 'livraison' && (
          <div className="space-y-5">
            <SectionTitle icon={<Truck className="w-4 h-4" />} title="Mode de livraison" />
            <div className="space-y-1">
              {deliveryModes.map(mode => (
                <label key={mode} className={`flex items-center gap-3 px-4 py-3 border cursor-pointer transition-all ${form.delivery_mode === mode ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200 hover:border-neutral-300'}`}>
                  <input type="radio" name="delivery" value={mode} checked={form.delivery_mode === mode}
                    onChange={() => patch({ delivery_mode: mode as any })} className="w-4 h-4 accent-neutral-900" />
                  <div>
                    <div className="font-medium text-sm text-neutral-900">{DELIVERY_LABELS[mode] || mode}</div>
                    {mode === 'retrait' && shopSettings?.address && <div className="text-xs text-neutral-500 mt-0.5">{shopSettings.address}</div>}
                    {mode === 'livraison' && <div className="text-xs text-neutral-400 mt-0.5">Contactez-nous pour les frais</div>}
                  </div>
                </label>
              ))}
            </div>

            {form.delivery_mode === 'livraison' && (
              <CField label="Adresse de livraison" required>
                <textarea value={form.delivery_address} onChange={e => patch({ delivery_address: e.target.value })}
                  rows={2} placeholder="Votre adresse complete..." className="bare-input text-sm text-neutral-900 pb-2 resize-none" />
                <div className="h-px bg-neutral-200" />
              </CField>
            )}

            <SectionTitle icon={<CreditCard className="w-4 h-4" />} title="Mode de paiement" />
            <div className="space-y-1">
              {paymentModes.map(mode => (
                <label key={mode} className={`flex items-center gap-3 px-4 py-3 border cursor-pointer transition-all ${form.payment_mode === mode ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200 hover:border-neutral-300'}`}>
                  <input type="radio" name="payment" value={mode} checked={form.payment_mode === mode}
                    onChange={() => patch({ payment_mode: mode })} className="w-4 h-4 accent-neutral-900" />
                  <div>
                    <div className="font-medium text-sm text-neutral-900">{PAYMENT_LABELS[mode] || mode}</div>
                    {['wave', 'orange_money', 'free_money'].includes(mode) && (
                      <div className="text-xs text-amber-600 mt-0.5">Instructions de paiement envoyees apres confirmation</div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {step === 'recap' && (
          <div className="space-y-5">
            <SectionTitle icon={<CheckCircle2 className="w-4 h-4" />} title="Recapitulatif" />

            <div className="border border-neutral-200 divide-y divide-neutral-100">
              {cart.map(item => (
                <div key={item.article.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-10 h-10 bg-neutral-50 border border-neutral-100 flex items-center justify-center overflow-hidden shrink-0">
                    <ShopLazyImage src={item.article.image_url} alt={item.article.name} className="w-full h-full object-contain p-0.5" fallbackClassName="w-full h-full" fallbackIconSize={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-neutral-900 truncate">{item.article.name}</div>
                    <div className="text-xs text-neutral-400">Qte {item.qty} x {formatFCFA(item.unit_price)}</div>
                  </div>
                  <div className="text-sm font-bold text-neutral-900 num shrink-0">{formatFCFA(item.unit_price * item.qty)}</div>
                </div>
              ))}
              <div className="flex items-center justify-between px-4 py-3 bg-neutral-50">
                <span className="font-bold text-sm text-neutral-700">Total</span>
                <span className="text-lg font-bold text-neutral-900 num">{formatFCFA(cartTotal)}</span>
              </div>
            </div>

            <div className="border border-neutral-200 p-4 space-y-2.5">
              <InfoRow label="Client" value={form.customer_name} />
              <InfoRow label="Telephone" value={form.customer_phone} />
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

      <div className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-neutral-100 px-4 py-3 safe-bottom">
        <div className="max-w-2xl mx-auto flex gap-2.5">
          {step !== 'client' && (
            <button
              onClick={() => setStep(step === 'recap' ? 'livraison' : 'client')}
              className="h-11 px-5 border border-neutral-200 text-neutral-700 font-medium text-sm hover:bg-neutral-50 transition-all inline-flex items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Retour
            </button>
          )}
          {step !== 'recap' ? (
            <button
              onClick={handleNext}
              className="flex-1 h-11 bg-neutral-900 text-white font-bold text-sm hover:bg-neutral-800 active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2"
            >
              Continuer
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex-1 h-11 bg-neutral-900 text-white font-bold text-sm hover:bg-neutral-800 active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {submitting ? 'Enregistrement...' : 'Confirmer la commande'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Order confirmation view ─────────────────────────────────────────

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
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <div className="w-16 h-16 bg-neutral-900 flex items-center justify-center">
            <PartyPopper className="w-7 h-7 text-white" />
          </div>
        </div>

        <div className="text-center">
          <div className="text-xl font-bold text-neutral-900">Commande confirmee</div>
          <p className="text-sm text-neutral-500 mt-1.5 leading-relaxed">
            Votre commande a bien ete enregistree.<br />Nous vous contacterons pour confirmation.
          </p>
        </div>

        <div className="bg-neutral-900 p-5 text-center">
          <div className="text-neutral-400 text-[10px] font-bold uppercase tracking-widest mb-1">Numero de commande</div>
          <div className="text-3xl font-bold text-white tracking-widest num">{confirmation.order_number}</div>
          <div className="text-neutral-400 text-xs mt-1">Conservez ce numero pour le suivi</div>
        </div>

        <div className="border border-neutral-200 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-neutral-100 bg-neutral-50">
            <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Recapitulatif</div>
          </div>
          <div className="divide-y divide-neutral-100">
            {confirmation.items.map(item => (
              <div key={item.article.id} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0 flex-1 mr-3">
                  <div className="text-sm font-medium text-neutral-900 truncate">{item.article.name}</div>
                  <div className="text-xs text-neutral-400">Qte {item.qty} x {formatFCFA(item.unit_price)}</div>
                </div>
                <div className="text-sm font-bold text-neutral-900 num shrink-0">{formatFCFA(item.unit_price * item.qty)}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between px-4 py-3 bg-neutral-50 border-t border-neutral-100">
            <span className="font-bold text-sm text-neutral-700">Total commande</span>
            <span className="text-lg font-bold text-neutral-900 num">{formatFCFA(confirmation.total)}</span>
          </div>
        </div>

        <div className="border border-neutral-200 p-4 space-y-2.5">
          <InfoRow label="Client" value={confirmation.customer_name} />
          <InfoRow label="Livraison" value={DELIVERY_LABELS[confirmation.delivery_mode] || confirmation.delivery_mode} />
          <InfoRow label="Paiement" value={PAYMENT_LABELS[confirmation.payment_mode] || confirmation.payment_mode} />
        </div>

        <div className="space-y-2">
          <button onClick={onTrack}
            className="w-full h-11 bg-neutral-900 text-white font-bold text-sm inline-flex items-center justify-center gap-2 hover:bg-neutral-800 active:scale-[0.98] transition-all">
            <CheckCircle2 className="w-4 h-4" />
            Suivre ma commande
          </button>
          {waUrl && (
            <a href={waUrl} target="_blank" rel="noopener noreferrer"
              className="w-full h-11 bg-emerald-600 text-white font-bold text-sm inline-flex items-center justify-center gap-2 hover:bg-emerald-700 active:scale-[0.98] transition-all">
              <MessageCircle className="w-4 h-4" />
              Confirmer via WhatsApp
            </a>
          )}
          <button onClick={onBackToShop}
            className="w-full h-11 border border-neutral-200 text-neutral-700 font-medium text-sm hover:bg-neutral-50 active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            Retour a la boutique
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-neutral-200 text-neutral-700 text-xs font-medium">
      {label}
      <button onClick={onRemove} className="ml-0.5 hover:text-red-500 transition-colors"><X className="w-3 h-3" /></button>
    </span>
  );
}

function EmptyResults({ search, hasFilters, onClear }: { search: string; hasFilters: boolean; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <Search className="w-8 h-8 text-neutral-300 mb-4" />
      <h3 className="text-base font-bold text-neutral-700 mb-1">Aucun article trouve</h3>
      <p className="text-sm text-neutral-400 max-w-xs mb-5">{search ? `Aucun resultat pour \u00ab ${search} \u00bb` : 'Aucun article ne correspond a vos filtres.'}</p>
      {(search || hasFilters) && (
        <button onClick={onClear} className="px-5 py-2.5 bg-neutral-900 text-white text-sm font-bold hover:bg-neutral-800 active:scale-[0.98] transition-all">Effacer</button>
      )}
    </div>
  );
}

function ShopLoader() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-white">
      <div className="w-12 h-12 bg-neutral-900 flex items-center justify-center">
        <Package className="w-6 h-6 text-white" />
      </div>
      <div className="text-center">
        <div className="text-sm font-bold text-neutral-700">Chargement...</div>
        <div className="text-xs text-neutral-400 mt-0.5">Preparation du catalogue</div>
      </div>
      <div className="flex gap-1.5 mt-2">
        {[0, 1, 2].map(i => (
          <div key={i} className="w-1.5 h-1.5 bg-neutral-900 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
    </div>
  );
}

function ShopNotFound({ slug }: { slug: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-5 bg-white p-6 text-center">
      <AlertCircle className="w-8 h-8 text-neutral-400" />
      <div>
        <h2 className="text-lg font-bold text-neutral-800 mb-1">Boutique introuvable</h2>
        <p className="text-sm text-neutral-500 max-w-xs">La boutique <span className="font-mono text-neutral-700">\u00ab {slug} \u00bb</span> n'existe pas ou n'est pas encore ouverte.</p>
      </div>
      <a href="/" className="inline-flex items-center gap-2 px-5 py-2.5 bg-neutral-900 text-white text-sm font-bold hover:bg-neutral-800 active:scale-[0.98] transition-all">
        <ArrowLeft className="w-4 h-4" />Retour
      </a>
    </div>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 pb-1">
      <span className="text-neutral-500">{icon}</span>
      <h3 className="font-bold text-neutral-800 text-sm uppercase tracking-wide">{title}</h3>
    </div>
  );
}

function CField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-2">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </div>
      {children}
    </label>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-neutral-400 font-medium shrink-0">{label}</span>
      <span className="text-neutral-900 font-medium text-right">{value}</span>
    </div>
  );
}
