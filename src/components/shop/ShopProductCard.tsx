import { Plus, Car } from 'lucide-react';
import type { ShopArticle, Category } from '../../lib/shopTypes';
import { stockBadge } from '../../lib/shopTypes';
import { formatFCFA } from '../../lib/format';
import type { ShopThemeConfig } from '../../lib/shopThemes';
import { ShopLazyImage } from './ShopLazyImage';

type Props = {
  article: ShopArticle;
  categories: Category[];
  cartQty: number;
  onDetail: () => void;
  onAddToCart: () => void;
  theme: ShopThemeConfig;
  showReferences: boolean;
  showStock: boolean;
  lowStockThreshold: number;
};

export function ShopProductCard({
  article,
  categories,
  cartQty,
  onDetail,
  onAddToCart,
  theme,
  showReferences,
  showStock,
  lowStockThreshold,
}: Props) {
  const badge = stockBadge(article.stock_qty, lowStockThreshold);
  const cat = categories.find((c) => c.id === article.category_id);
  const inCart = cartQty > 0;
  const outOfStock = article.stock_qty === 0;
  const maxReached = cartQty >= article.stock_qty;
  return (
    <div className={`group relative flex flex-col ${theme.cardClassName}`}>
      {/* Image */}
      <button
        onClick={onDetail}
        className={`relative w-full ${theme.cardImageAspect} rounded-t-2xl overflow-hidden ${theme.cardImageBg} ${theme.cardImagePadding} shrink-0`}
        aria-label={`Voir ${article.name}`}
      >
        <ShopLazyImage
          src={article.image_url}
          alt={article.name}
          className={`w-full h-full object-contain ${theme.cardImagePadding}`}
          fallbackClassName={`w-full h-full ${theme.cardImagePadding}`}
          fallbackIconSize={28}
        />
        {showStock && (
          <div className="absolute top-1.5 left-1.5">
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold ${badge.cls}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${badge.dot}`} />
              {badge.label}
            </span>
          </div>
        )}
        {inCart && (
          <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-brand-700 text-white text-[9px] font-bold flex items-center justify-center shadow-glow">
            {cartQty}
          </div>
        )}
      </button>

      {/* Info */}
      <div className={`flex-1 flex flex-col min-w-0 ${theme.cardBodyClass}`}>
        <button onClick={onDetail} className="flex-1 text-left">
          {cat && (
            <div className="text-[9px] font-bold uppercase tracking-wider text-brand-600/70 mb-0.5 truncate">
              {cat.name}
            </div>
          )}
          <div
            className={`${theme.cardTitleClass} shop-product-name mb-1`}
          >
            {article.name}
          </div>
          {showReferences && article.internal_ref && (
            <div className="text-[10px] font-mono text-slate-400 truncate">
              {article.internal_ref}
            </div>
          )}
          {showReferences && article.oem_ref && (
            <div className="text-[10px] font-mono text-slate-400 truncate">
              OEM: {article.oem_ref}
            </div>
          )}
          {article.compatibilities.length > 0 && (
            <div className="text-[10px] text-slate-500 truncate flex items-center gap-1 mt-0.5">
              <Car className="w-2.5 h-2.5 shrink-0 text-slate-400" />
              {article.compatibilities[0].brand_name}{' '}
              {article.compatibilities[0].model_name}
              {article.compatibilities.length > 1 && (
                <span className="text-slate-400">
                  +{article.compatibilities.length - 1}
                </span>
              )}
            </div>
          )}
          <div className={`${theme.cardPriceClass} num mt-1.5 leading-none`}>
            {formatFCFA(article.sale_price)}
          </div>
        </button>

        {/* Add to cart */}
        <button
          onClick={onAddToCart}
          disabled={outOfStock || maxReached}
          className={`mt-2 w-full h-9 rounded-xl text-xs font-bold transition-all active:scale-95 inline-flex items-center justify-center gap-1 ${
            outOfStock || maxReached
              ? 'bg-neutral-100 text-neutral-400 cursor-not-allowed'
              : inCart
                ? 'bg-brand-50 text-brand-700 border border-brand-200 hover:bg-brand-100'
                : 'bg-gradient-to-r from-brand-600 to-brand-700 text-white shadow-sm hover:shadow-glow'
          }`}
        >
          {outOfStock ? (
            'Rupture'
          ) : maxReached ? (
            'Max stock'
          ) : (
            <>
              <Plus className="w-3 h-3" />
              {inCart ? 'Ajouter encore' : 'Ajouter'}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// Skeleton card for loading state
export function ShopProductCardSkeleton({ theme }: { theme: ShopThemeConfig }) {
  return (
    <div className={`flex flex-col ${theme.cardClassName}`}>
      <div
        className={`w-full ${theme.cardImageAspect} rounded-t-2xl shop-skeleton`}
      />
      <div className={theme.cardBodyClass}>
        <div className="h-3 shop-skeleton mb-2 w-3/4" />
        <div className="h-2.5 shop-skeleton mb-1 w-1/2" />
        <div className="h-4 shop-skeleton mt-2 w-1/3" />
        <div className="h-8 shop-skeleton mt-2 w-full rounded-xl" />
      </div>
    </div>
  );
}
