import { ShoppingCart } from 'lucide-react';
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
  showReferences,
  showStock,
  lowStockThreshold,
}: Props) {
  const badge = stockBadge(article.stock_qty, lowStockThreshold);
  const cat = categories.find((c) => c.id === article.category_id);
  const outOfStock = article.stock_qty === 0;
  const maxReached = cartQty >= article.stock_qty;

  return (
    <div className="group flex flex-col bg-white hover:bg-neutral-50/50 transition-colors">
      {/* Image */}
      <button
        onClick={onDetail}
        className="relative w-full aspect-square overflow-hidden bg-white shrink-0"
        aria-label={`Voir ${article.name}`}
      >
        <ShopLazyImage
          src={article.image_url}
          alt={article.name}
          className="w-full h-full object-contain p-2"
          fallbackClassName="w-full h-full p-2"
          fallbackIconSize={20}
        />
        {showStock && (
          <div className="absolute top-1.5 left-1.5 flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
            <span className="text-[9px] font-medium text-neutral-500">{badge.label}</span>
          </div>
        )}
      </button>

      {/* Info */}
      <div className="flex-1 flex flex-col px-2 pt-1.5 pb-2">
        <button onClick={onDetail} className="flex-1 text-left">
          <div className="text-[11px] font-semibold text-neutral-900 leading-tight line-clamp-2">
            {article.name}
          </div>
          {showReferences && article.internal_ref && (
            <div className="text-[9px] text-neutral-400 truncate mt-0.5">
              {article.internal_ref}
            </div>
          )}
        </button>

        <div className="text-[11px] font-bold text-neutral-900 num mt-1">
          {formatFCFA(article.sale_price)}
        </div>

        {/* CTA */}
        <button
          onClick={onAddToCart}
          disabled={outOfStock || maxReached}
          className={`mt-1.5 inline-flex items-center justify-center gap-1 px-2 py-0.5 text-[9px] font-bold transition-all ${
            outOfStock || maxReached
              ? 'border border-neutral-200 text-neutral-300 cursor-not-allowed'
              : 'bg-neutral-900 text-white hover:bg-neutral-800 active:scale-95'
          }`}
        >
          {outOfStock ? (
            'Rupture'
          ) : maxReached ? (
            'Max'
          ) : (
            <>
              <ShoppingCart className="w-2.5 h-2.5" />
              Ajouter
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export function ShopProductCardSkeleton({ theme }: { theme: ShopThemeConfig }) {
  return (
    <div className="flex flex-col bg-white">
      <div className="w-full aspect-square bg-neutral-50 animate-pulse" />
      <div className="px-2 pt-1.5 pb-2">
        <div className="h-2.5 bg-neutral-100 mb-1 w-3/4 animate-pulse" />
        <div className="h-2.5 bg-neutral-100 mt-1 w-1/3 animate-pulse" />
        <div className="h-5 bg-neutral-100 mt-1.5 w-12 animate-pulse" />
      </div>
    </div>
  );
}
