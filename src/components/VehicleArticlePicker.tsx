import { useEffect, useState } from 'react';
import { ChevronRight, Search, Car, Package, X, ArrowLeft, Loader2, Grid3x3 as Grid3X3, Cog, Filter as FilterIcon, Disc, Wrench, Navigation, Zap, Lightbulb, PaintBucket, Armchair, Sparkles, Circle, Droplet, Hammer, Box, Settings2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getBrandLogo } from '../lib/brandLogos';
import { formatFCFA } from '../lib/format';
import { desktopAutoFocus } from '../lib/device';

type VehicleBrand = { id: string; name: string; logo_url?: string | null };
type VehicleModel = { id: string; name: string; year_start: number | null; year_end: number | null };

type MainCategoryKey =
  | 'moteur' | 'filtration' | 'freinage' | 'suspension' | 'direction'
  | 'transmission' | 'electricite' | 'eclairage' | 'carrosserie' | 'interieur'
  | 'accessoires' | 'pneumatiques' | 'lubrifiants' | 'outillage' | 'consommables';

type MainCategory = { key: MainCategoryKey; label: string; keywords: string[]; icon: JSX.Element };

const MAIN_CATEGORIES: MainCategory[] = [
  { key: 'moteur', label: 'Moteur', icon: <Cog className="w-5 h-5" />, keywords: ['moteur', 'engine', 'allumage', 'bougie', 'echappement', 'échappement', 'refroidissement', 'radiateur', 'turbo', 'injection', 'pompe eau', 'courroie', 'distribution', 'culasse', 'piston', 'vilebrequin'] },
  { key: 'filtration', label: 'Filtration', icon: <FilterIcon className="w-5 h-5" />, keywords: ['filtre', 'filtration', 'filter'] },
  { key: 'freinage', label: 'Freinage', icon: <Disc className="w-5 h-5" />, keywords: ['frein', 'brake', 'plaquette', 'disque', 'etrier', 'étrier', 'abs', 'maitre cylindre', 'maître cylindre'] },
  { key: 'suspension', label: 'Suspension', icon: <Wrench className="w-5 h-5" />, keywords: ['suspension', 'amortisseur', 'ressort', 'silent bloc', 'triangle', 'rotule', 'biellette', 'barre stabilisatrice'] },
  { key: 'direction', label: 'Direction', icon: <Navigation className="w-5 h-5" />, keywords: ['direction', 'crémaillere', 'crémaillère', 'cremaillere', 'volant', 'colonne direction', 'embout direction'] },
  { key: 'transmission', label: 'Transmission', icon: <Settings2 className="w-5 h-5" />, keywords: ['transmission', 'embrayage', 'boite', 'boîte', 'cardan', 'boite vitesses', 'differentiel', 'différentiel', 'arbre transmission'] },
  { key: 'electricite', label: 'Électricité', icon: <Zap className="w-5 h-5" />, keywords: ['batterie', 'alternateur', 'demarreur', 'démarreur', 'electricite', 'électricité', 'electrique', 'électrique', 'capteur', 'sonde', 'relais', 'fusible', 'faisceau', 'bobine', 'calculateur'] },
  { key: 'eclairage', label: 'Éclairage', icon: <Lightbulb className="w-5 h-5" />, keywords: ['éclairage', 'eclairage', 'phare', 'ampoule', 'feu', 'led', 'xenon', 'xénon', 'clignotant', 'antibrouillard', 'optique'] },
  { key: 'carrosserie', label: 'Carrosserie', icon: <PaintBucket className="w-5 h-5" />, keywords: ['carrosserie', 'pare-choc', 'pare choc', 'parechoc', 'aile', 'capot', 'portiere', 'portière', 'retroviseur', 'rétroviseur', 'pare-brise', 'pare brise', 'vitre', 'calandre', 'coffre', 'hayon'] },
  { key: 'interieur', label: 'Intérieur', icon: <Armchair className="w-5 h-5" />, keywords: ['interieur', 'intérieur', 'siege', 'siège', 'tapis', 'moquette', 'ciel de toit', 'garniture', 'tableau bord', 'planche bord', 'sellerie'] },
  { key: 'accessoires', label: 'Accessoires', icon: <Sparkles className="w-5 h-5" />, keywords: ['accessoire', 'accessoires', 'porte-bagage', 'attelage', 'barre toit', 'film', 'antivol'] },
  { key: 'pneumatiques', label: 'Pneumatiques', icon: <Circle className="w-5 h-5" />, keywords: ['pneu', 'pneumatique', 'jante', 'roue', 'chambre air', 'valve', 'equilibrage', 'équilibrage'] },
  { key: 'lubrifiants', label: 'Lubrifiants', icon: <Droplet className="w-5 h-5" />, keywords: ['huile', 'lubrifiant', 'graisse', 'liquide', 'antigel', 'lave glace', 'lave-glace', 'adblue', 'additif'] },
  { key: 'outillage', label: 'Outillage', icon: <Hammer className="w-5 h-5" />, keywords: ['outil', 'outillage', 'cle', 'clé', 'cric', 'chandelle', 'tournevis', 'pince'] },
  { key: 'consommables', label: 'Consommables', icon: <Box className="w-5 h-5" />, keywords: ['consommable', 'visserie', 'ecrou', 'écrou', 'boulon', 'joint', 'vis', 'rondelle', 'colle', 'silicone', 'chiffon', 'gant'] },
];

function mapArticleToMainCategory(categoryName: string | null | undefined, articleName: string | undefined): MainCategoryKey | null {
  const hay = `${(categoryName || '').toLowerCase()} ${(articleName || '').toLowerCase()}`;
  if (!hay.trim()) return null;
  for (const c of MAIN_CATEGORIES) {
    for (const kw of c.keywords) {
      if (hay.includes(kw)) return c.key;
    }
  }
  return null;
}

type CompatibleArticle = PickedArticle & { category_name: string | null; main_cat: MainCategoryKey | null };

export type PickedArticle = {
  id: string;
  internal_ref: string;
  name: string;
  sale_price: number;
  purchase_price: number;
  stock_available: number;
  oem_ref?: string;
  supplier_ref?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSelect: (article: PickedArticle) => void;
  priceMode?: 'sale' | 'purchase';
  tenantId: string;
  siteId: string;
};

type Step = 'brand' | 'model' | 'category' | 'articles';

export function VehicleArticlePicker({ open, onClose, onSelect, priceMode = 'sale', tenantId, siteId }: Props) {
  const [step, setStep] = useState<Step>('brand');
  const [brands, setBrands] = useState<VehicleBrand[]>([]);
  const [models, setModels] = useState<VehicleModel[]>([]);
  const [compatibleArticles, setCompatibleArticles] = useState<CompatibleArticle[]>([]);
  const [selectedBrand, setSelectedBrand] = useState<VehicleBrand | null>(null);
  const [selectedModel, setSelectedModel] = useState<VehicleModel | null>(null);
  const [selectedMainCat, setSelectedMainCat] = useState<MainCategoryKey | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    reset();
    loadBrands();
  }, [open, tenantId]);

  const reset = () => {
    setStep('brand');
    setSelectedBrand(null);
    setSelectedModel(null);
    setSelectedMainCat(null);
    setSearch('');
    setCompatibleArticles([]);
  };

  const loadBrands = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('vehicle_brands')
      .select('id, name, logo_url')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('name');
    setBrands(data || []);
    setLoading(false);
  };

  const selectBrand = async (brand: VehicleBrand) => {
    setSelectedBrand(brand);
    setSearch('');
    setLoading(true);
    const { data } = await supabase
      .from('vehicle_models')
      .select('id, name, year_start, year_end')
      .eq('tenant_id', tenantId)
      .eq('brand_id', brand.id)
      .eq('is_active', true)
      .order('name');
    setModels(data || []);
    setLoading(false);
    setStep('model');
  };

  const selectModel = async (model: VehicleModel) => {
    setSelectedModel(model);
    setSearch('');
    setLoading(true);

    const { data: compatData } = await supabase
      .from('article_compatibilities')
      .select('article_id')
      .eq('tenant_id', tenantId)
      .eq('brand_id', selectedBrand!.id)
      .eq('model_id', model.id);

    const articleIds = (compatData || []).map((r: any) => r.article_id);

    if (articleIds.length === 0) {
      setCompatibleArticles([]);
      setLoading(false);
      setStep('category');
      return;
    }

    const [{ data: artData }, { data: catData }, { data: stkData }] = await Promise.all([
      supabase
        .from('articles')
        .select('id, internal_ref, name, sale_price, purchase_price, oem_ref, supplier_ref, category_id')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .in('id', articleIds)
        .order('name')
        .limit(1000),
      supabase.from('part_categories').select('id, name').eq('tenant_id', tenantId),
      supabase.from('stock_levels').select('article_id, quantity').eq('tenant_id', tenantId).eq('site_id', siteId),
    ]);

    const catMap = new Map((catData || []).map((c: any) => [c.id, c.name as string]));
    const qmap = new Map((stkData || []).map((r: any) => [r.article_id, Number(r.quantity)]));

    const mapped: CompatibleArticle[] = (artData || []).map((a: any) => {
      const cname = a.category_id ? (catMap.get(a.category_id) || null) : null;
      return {
        id: a.id,
        internal_ref: a.internal_ref,
        name: a.name,
        sale_price: Number(a.sale_price),
        purchase_price: Number(a.purchase_price),
        stock_available: qmap.get(a.id) || 0,
        oem_ref: a.oem_ref || '',
        supplier_ref: a.supplier_ref || '',
        category_name: cname,
        main_cat: mapArticleToMainCategory(cname, a.name),
      };
    });

    setCompatibleArticles(mapped);
    setLoading(false);
    setStep('category');
  };

  const selectCategory = (key: MainCategoryKey | null) => {
    setSelectedMainCat(key);
    setSearch('');
    setStep('articles');
  };

  const goBack = () => {
    setSearch('');
    if (step === 'model') setStep('brand');
    else if (step === 'category') setStep('model');
    else if (step === 'articles') setStep('category');
  };

  if (!open) return null;

  const q = search.toLowerCase().trim();
  const filteredBrands = q ? brands.filter(b => b.name.toLowerCase().includes(q)) : brands;
  const filteredModels = q ? models.filter(m => m.name.toLowerCase().includes(q)) : models;

  const articlesByCategory = selectedMainCat
    ? compatibleArticles.filter(a => a.main_cat === selectedMainCat)
    : compatibleArticles;

  const filteredArticles = q
    ? articlesByCategory.filter(a =>
        a.name.toLowerCase().includes(q) ||
        a.internal_ref.toLowerCase().includes(q) ||
        (a.oem_ref || '').toLowerCase().includes(q)
      )
    : articlesByCategory;

  const selectedMainCatLabel = selectedMainCat
    ? MAIN_CATEGORIES.find(c => c.key === selectedMainCat)?.label || ''
    : 'Toutes les catégories';

  const breadcrumb = [
    selectedBrand && { label: selectedBrand.name, onClick: () => { setStep('brand'); setSearch(''); } },
    selectedModel && step !== 'model' && { label: selectedModel.name, onClick: () => { setStep('model'); setSearch(''); } },
    step === 'articles' && { label: selectedMainCatLabel, onClick: () => { setStep('category'); setSearch(''); } },
  ].filter(Boolean) as { label: string; onClick: () => void }[];

  const stepTitle: Record<Step, string> = {
    brand: 'Choisir le constructeur',
    model: 'Choisir le modèle',
    category: 'Choisir la catégorie',
    articles: selectedMainCat ? `${selectedMainCatLabel}` : `Toutes les pièces compatibles`,
  };

  const showSearch = step !== 'category';

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-white sm:rounded-2xl shadow-elevated animate-slide-up max-h-[95vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3.5 border-b border-slate-100 bg-white sm:rounded-t-2xl">
          {step !== 'brand' && (
            <button onClick={goBack} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 shrink-0 transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div className="flex-1 min-w-0">
            {breadcrumb.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap mb-0.5">
                {breadcrumb.map((crumb, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <ChevronRight className="w-3 h-3 text-slate-300 shrink-0" />}
                    <button onClick={crumb.onClick} className="text-xs text-slate-400 hover:text-brand-700 transition-colors truncate max-w-[100px]">
                      {crumb.label}
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="text-sm font-semibold text-slate-900 truncate">{stepTitle[step]}</div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search bar — shown on brand, model, articles */}
        {showSearch && (
          <div className="px-4 py-2.5 border-b border-slate-100 bg-white">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={step === 'articles' ? 'Nom, référence, OEM…' : 'Rechercher…'}
                className="input pl-9 text-sm py-2"
                autoFocus={desktopAutoFocus}
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-5 h-5 animate-spin text-brand-700" />
            </div>
          ) : step === 'brand' ? (
            <BrandGrid brands={filteredBrands} onSelect={selectBrand} />
          ) : step === 'model' ? (
            <ModelList models={filteredModels} onSelect={selectModel} />
          ) : step === 'category' ? (
            <CategoryGrid
              compatibleArticles={compatibleArticles}
              onSelect={selectCategory}
            />
          ) : (
            <ArticleList
              articles={filteredArticles}
              totalCompatible={compatibleArticles.length}
              selectedCategoryLabel={selectedMainCat ? selectedMainCatLabel : null}
              priceMode={priceMode}
              onSelect={article => { onSelect(article); onClose(); }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Brand grid ────────────────────────────────────────────────────────────────

function BrandGrid({ brands, onSelect }: { brands: VehicleBrand[]; onSelect: (b: VehicleBrand) => void }) {
  if (brands.length === 0) return <EmptyMsg text="Aucun constructeur disponible" />;
  return (
    <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
      {brands.map(b => {
        const inlineLogo = getBrandLogo(b.name);
        return (
          <button
            key={b.id}
            onClick={() => onSelect(b)}
            className="flex flex-col items-center gap-2.5 p-4 rounded-xl border border-slate-200 hover:border-brand-400 hover:bg-brand-50/30 transition-all group active:scale-95"
          >
            <div className="w-14 h-10 flex items-center justify-center overflow-hidden">
              {inlineLogo
                ? <div className="w-full h-full">{inlineLogo}</div>
                : <Car className="w-7 h-7 text-slate-300 group-hover:text-brand-400 transition-colors" />
              }
            </div>
            <span className="text-xs font-semibold text-slate-700 group-hover:text-brand-700 text-center leading-tight transition-colors">{b.name}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Model list ────────────────────────────────────────────────────────────────

function ModelList({ models, onSelect }: { models: VehicleModel[]; onSelect: (m: VehicleModel) => void }) {
  if (models.length === 0) return <EmptyMsg text="Aucun modèle disponible" />;
  return (
    <div className="divide-y divide-slate-100">
      {models.map(m => (
        <button
          key={m.id}
          onClick={() => onSelect(m)}
          className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 text-left transition-colors group"
        >
          <div>
            <div className="text-sm font-semibold text-slate-900 group-hover:text-brand-700 transition-colors">{m.name}</div>
            {(m.year_start || m.year_end) && (
              <div className="text-xs text-slate-400 mt-0.5">{m.year_start || '?'} – {m.year_end || 'auj.'}</div>
            )}
          </div>
          <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-brand-600 shrink-0 transition-colors" />
        </button>
      ))}
    </div>
  );
}

// ─── Category grid — 15 fixed main categories ─────────────────────────────────

function CategoryGrid({ compatibleArticles, onSelect }: {
  compatibleArticles: CompatibleArticle[];
  onSelect: (key: MainCategoryKey | null) => void;
}) {
  const countByKey = new Map<MainCategoryKey, number>();
  for (const a of compatibleArticles) {
    if (a.main_cat) countByKey.set(a.main_cat, (countByKey.get(a.main_cat) || 0) + 1);
  }
  const totalCompat = compatibleArticles.length;

  return (
    <div className="p-4 space-y-3">
      <button
        onClick={() => onSelect(null)}
        className="w-full flex items-center gap-3 p-3.5 rounded-xl border-2 border-brand-200 bg-brand-50/50 hover:bg-brand-50 hover:border-brand-400 transition-all group text-left"
      >
        <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center shrink-0">
          <Grid3X3 className="w-5 h-5 text-brand-700" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-brand-800">Toutes les catégories</div>
          <div className="text-xs text-brand-600 mt-0.5">{totalCompat} pièce{totalCompat > 1 ? 's' : ''} compatible{totalCompat > 1 ? 's' : ''}</div>
        </div>
        <ChevronRight className="w-4 h-4 text-brand-400 group-hover:text-brand-600 shrink-0" />
      </button>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {MAIN_CATEGORIES.map(cat => {
          const count = countByKey.get(cat.key) || 0;
          const hasItems = count > 0;
          return (
            <button
              key={cat.key}
              onClick={() => onSelect(cat.key)}
              className={`relative flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all group ${
                hasItems
                  ? 'border-slate-200 bg-white hover:border-brand-400 hover:bg-brand-50/60 hover:shadow-sm'
                  : 'border-slate-150 bg-slate-50/40 opacity-60'
              }`}
            >
              <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${hasItems ? 'bg-brand-50 text-brand-700 group-hover:bg-brand-100' : 'bg-slate-100 text-slate-400'} transition-colors`}>
                {cat.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-semibold truncate transition-colors ${hasItems ? 'text-slate-800 group-hover:text-brand-700' : 'text-slate-500'}`}>
                  {cat.label}
                </div>
                <div className={`text-[10px] font-bold num mt-0.5 ${hasItems ? 'text-brand-600' : 'text-slate-400'}`}>
                  {count} pièce{count > 1 ? 's' : ''}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Article list ──────────────────────────────────────────────────────────────

function ArticleList({ articles, totalCompatible, selectedCategoryLabel, priceMode, onSelect }: {
  articles: PickedArticle[];
  totalCompatible: number;
  selectedCategoryLabel: string | null;
  priceMode: 'sale' | 'purchase';
  onSelect: (a: PickedArticle) => void;
}) {
  if (articles.length === 0) {
    const inCategory = selectedCategoryLabel !== null;
    return (
      <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
          <Package className="w-7 h-7 text-slate-300" />
        </div>
        {inCategory && totalCompatible > 0 ? (
          <>
            <p className="text-slate-800 font-semibold text-sm">Aucun article trouvé dans cette catégorie pour ce véhicule.</p>
            <p className="text-xs text-slate-500 mt-2 max-w-sm leading-relaxed">
              L'article recherché n'existe peut-être pas encore ou n'a pas été correctement catégorisé.
            </p>
            <p className="text-xs text-slate-500 mt-1.5 max-w-sm leading-relaxed">
              Essayez une recherche manuelle par nom, référence ou OEM.
            </p>
          </>
        ) : (
          <>
            <p className="text-slate-800 font-semibold text-sm">Aucune pièce compatible avec ce véhicule.</p>
            <p className="text-xs text-slate-500 mt-2 max-w-sm">Aucun article n'a encore été rattaché à ce véhicule dans votre catalogue.</p>
          </>
        )}
      </div>
    );
  }

  const inStockCount = articles.filter(a => a.stock_available > 0).length;

  return (
    <div>
      <div className="px-4 py-2.5 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between">
        <span className="text-xs text-slate-500">{articles.length} pièce{articles.length > 1 ? 's' : ''}</span>
        <span className="text-xs text-emerald-600 font-medium">{inStockCount} en stock</span>
      </div>
      <div className="divide-y divide-slate-100">
        {articles.map(a => {
          const price = priceMode === 'sale' ? a.sale_price : a.purchase_price;
          const inStock = a.stock_available > 0;
          const lowStock = a.stock_available > 0 && a.stock_available <= 3;
          return (
            <button
              key={a.id}
              onClick={() => onSelect(a)}
              className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 text-left transition-colors group"
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                inStock ? (lowStock ? 'bg-amber-50' : 'bg-emerald-50') : 'bg-red-50'
              }`}>
                <Package className={`w-4 h-4 ${
                  inStock ? (lowStock ? 'text-amber-500' : 'text-emerald-600') : 'text-red-400'
                }`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-900 group-hover:text-brand-700 transition-colors truncate">{a.name}</div>
                <div className="flex items-center gap-2.5 mt-0.5 flex-wrap">
                  <span className="text-xs font-mono text-slate-400">{a.internal_ref}</span>
                  {a.oem_ref && <span className="text-xs text-slate-400">OEM: {a.oem_ref}</span>}
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded-md ${
                    !inStock ? 'bg-red-100 text-red-600' :
                    lowStock ? 'bg-amber-100 text-amber-700' :
                    'bg-emerald-100 text-emerald-700'
                  }`}>
                    {!inStock ? 'Rupture' : `Stock: ${a.stock_available}`}
                  </span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-bold text-slate-900">{formatFCFA(price)}</div>
                {a.supplier_ref && <div className="text-xs text-slate-400 mt-0.5">{a.supplier_ref}</div>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EmptyMsg({ text }: { text: string }) {
  return <div className="flex items-center justify-center py-16 text-sm text-slate-400">{text}</div>;
}
