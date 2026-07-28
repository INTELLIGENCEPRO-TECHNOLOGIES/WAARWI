import type { ShopSettings, ShopThemeId, CardDensity } from '../lib/shopTypes';

export type ShopThemeConfig = {
  id: ShopThemeId;
  label: string;
  description: string;
  // Header
  headerBg: string;
  headerBorder: string;
  // Hero
  heroClassName: string;
  heroOverlayClassName: string;
  heroTitleClass: string;
  heroSubtitleClass: string;
  heroAccentColor: string;
  // Search bar
  searchBarInset: string;
  // Category bar
  showCategoryBar: boolean;
  // Cards
  cardClassName: string;
  cardImageBg: string;
  cardImageAspect: string;
  cardImagePadding: string;
  cardBodyClass: string;
  cardTitleClass: string;
  cardPriceClass: string;
  // Grid
  gridClassName: string;
  // Perks
  perksBg: string;
  perksBorder: string;
  // Footer
  footerClassName: string;
};

export const SHOP_THEMES: Record<ShopThemeId, ShopThemeConfig> = {
  premium_minimal: {
    id: 'premium_minimal',
    label: 'Premium Minimal',
    description: 'Élégant, institutionnel, mise en page épurée',
    headerBg: 'bg-white/90 backdrop-blur-xl',
    headerBorder: 'border-b border-neutral-200/60',
    heroClassName: 'bg-gradient-to-br from-neutral-50 via-white to-neutral-100',
    heroOverlayClassName: '',
    heroTitleClass: 'text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight',
    heroSubtitleClass: 'text-[13px] sm:text-sm text-slate-600 max-w-xl',
    heroAccentColor: '#0a0a0a',
    searchBarInset: '-mt-6',
    showCategoryBar: false,
    cardClassName: 'bg-white border border-neutral-200/80 rounded-2xl shadow-card hover:shadow-elevated transition-shadow',
    cardImageBg: 'bg-neutral-50',
    cardImageAspect: 'aspect-[4/5]',
    cardImagePadding: 'p-2',
    cardBodyClass: 'p-3',
    cardTitleClass: 'text-[13px] font-semibold text-slate-900 leading-snug',
    cardPriceClass: 'text-[15px] font-bold text-slate-900',
    gridClassName: 'shop-grid-premium',
    perksBg: 'bg-white/60 border border-neutral-200/60 backdrop-blur-sm',
    perksBorder: 'border-white/15',
    footerClassName: 'border-t border-neutral-200 bg-gradient-to-b from-white to-neutral-50',
  },

  marketplace: {
    id: 'marketplace',
    label: 'Marketplace Moderne',
    description: 'Dense, optimisé pour un grand catalogue',
    headerBg: 'bg-white/95 backdrop-blur-xl',
    headerBorder: 'border-b border-neutral-200',
    heroClassName: 'bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900',
    heroOverlayClassName: 'bg-gradient-to-r from-brand-600/20 to-transparent',
    heroTitleClass: 'text-2xl sm:text-4xl font-extrabold text-white tracking-tight',
    heroSubtitleClass: 'text-[13px] sm:text-sm text-white/80 max-w-xl',
    heroAccentColor: '#525252',
    searchBarInset: '-mt-8',
    showCategoryBar: true,
    cardClassName: 'bg-white border border-neutral-200 rounded-xl shadow-card hover:shadow-elevated transition-all hover:-translate-y-0.5',
    cardImageBg: 'bg-white',
    cardImageAspect: 'aspect-[4/5]',
    cardImagePadding: 'p-1.5',
    cardBodyClass: 'p-2.5',
    cardTitleClass: 'text-[12.5px] font-semibold text-slate-900 leading-snug',
    cardPriceClass: 'text-[14px] font-bold text-slate-900',
    gridClassName: 'shop-grid-marketplace',
    perksBg: 'bg-white/8 border border-white/15 backdrop-blur-sm',
    perksBorder: 'border-white/15',
    footerClassName: 'border-t border-neutral-200 bg-white',
  },

  immersive: {
    id: 'immersive',
    label: 'Boutique Immersive',
    description: 'Image de couverture, identité forte, éditorial',
    headerBg: 'bg-white/90 backdrop-blur-xl',
    headerBorder: 'border-b border-neutral-200/60',
    heroClassName: 'shop-hero-immersive',
    heroOverlayClassName: '',
    heroTitleClass: 'text-3xl sm:text-5xl font-extrabold text-white tracking-tight',
    heroSubtitleClass: 'text-sm sm:text-base text-white/90 max-w-2xl',
    heroAccentColor: '#ffffff',
    searchBarInset: '-mt-8',
    showCategoryBar: false,
    cardClassName: 'bg-white border border-neutral-200/60 rounded-2xl shadow-card hover:shadow-premium transition-all hover:-translate-y-1',
    cardImageBg: 'bg-neutral-50',
    cardImageAspect: 'aspect-[4/5]',
    cardImagePadding: 'p-3',
    cardBodyClass: 'p-3.5',
    cardTitleClass: 'text-sm font-semibold text-slate-900 leading-snug',
    cardPriceClass: 'text-base font-bold text-slate-900',
    gridClassName: 'shop-grid-immersive',
    perksBg: 'bg-white/8 border border-white/15 backdrop-blur-sm',
    perksBorder: 'border-white/15',
    footerClassName: 'border-t border-neutral-200 bg-gradient-to-b from-white to-neutral-50',
  },
};

export function getTheme(settings: ShopSettings | null): ShopThemeConfig {
  const themeId = settings?.theme || 'premium_minimal';
  return SHOP_THEMES[themeId] || SHOP_THEMES.premium_minimal;
}

export function densityGap(density: CardDensity): string {
  switch (density) {
    case 'compact':
      return 'gap-2 sm:gap-2.5';
    case 'spacious':
      return 'gap-4 sm:gap-6';
    default:
      return 'gap-3 sm:gap-4';
  }
}

export function densityPadding(density: CardDensity): string {
  switch (density) {
    case 'compact':
      return 'p-2';
    case 'spacious':
      return 'p-4';
    default:
      return 'p-2.5 sm:p-3';
  }
}
