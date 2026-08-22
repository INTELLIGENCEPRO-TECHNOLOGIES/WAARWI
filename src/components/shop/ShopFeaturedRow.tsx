import { ShoppingCart, Plus, Minus } from 'lucide-react';
import type { ShopArticle, CartItem } from '../../lib/shopTypes';
import { formatFCFA } from '../../lib/format';
import type { ShopThemeConfig } from '../../lib/shopThemes';
import { ShopLazyImage } from './ShopLazyImage';

type Props = {
  articles: ShopArticle[];
  cart: CartItem[];
  onDetail: (a: ShopArticle) => void;
  onAddToCart: (a: ShopArticle) => void;
  onSetQty: (id: string, qty: number) => void;
  theme: ShopThemeConfig;
};

export function ShopFeaturedRow({ articles, cart, onDetail, onAddToCart, onSetQty }: Props) {
  if (articles.length === 0) return null;

  return (
    <section className="px-4 sm:px-6 py-6 border-b border-neutral-100">
      <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-400 mb-4">Produits populaires</h2>
      <div className="flex gap-4 overflow-x-auto scrollbar-none pb-2">
        {articles.slice(0, 8).map((article) => {
          const cartQty = cart.find((i) => i.article.id === article.id)?.qty || 0;
          const inCart = cartQty > 0;
          const outOfStock = article.stock_qty === 0;

          return (
            <div key={article.id} className="shrink-0 w-[180px] flex flex-col border border-neutral-100 bg-white hover:border-neutral-200 transition-colors">
              <button
                onClick={() => onDetail(article)}
                className="relative w-full aspect-square overflow-hidden bg-neutral-50 shrink-0"
              >
                <ShopLazyImage
                  src={article.image_url}
                  alt={article.name}
                  className="w-full h-full object-contain p-3"
                  fallbackClassName="w-full h-full p-3"
                  fallbackIconSize={24}
                />
              </button>
              <div className="p-2.5 flex-1 flex flex-col">
                <button onClick={() => onDetail(article)} className="text-left flex-1">
                  <div className="text-[12px] font-medium text-neutral-900 leading-snug line-clamp-2">
                    {article.name}
                  </div>
                  <div className="mt-1.5 text-sm font-bold text-neutral-900 num">
                    {formatFCFA(article.sale_price)}
                  </div>
                </button>
                <div className="mt-2">
                  {outOfStock ? (
                    <div className="text-[10px] font-medium text-neutral-400">Rupture</div>
                  ) : inCart ? (
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => onSetQty(article.id, cartQty - 1)}
                        className="w-7 h-7 border border-neutral-200 flex items-center justify-center hover:bg-neutral-50 active:scale-90 transition-all"
                      >
                        <Minus className="w-3 h-3 text-neutral-600" />
                      </button>
                      <span className="w-7 text-center text-xs font-bold num">{cartQty}</span>
                      <button
                        onClick={() => onAddToCart(article)}
                        disabled={cartQty >= article.stock_qty}
                        className="w-7 h-7 border border-neutral-200 flex items-center justify-center hover:bg-neutral-50 active:scale-90 transition-all disabled:opacity-30"
                      >
                        <Plus className="w-3 h-3 text-neutral-600" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => onAddToCart(article)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-neutral-900 text-white text-[10px] font-bold hover:bg-neutral-800 active:scale-95 transition-all"
                    >
                      <ShoppingCart className="w-3 h-3" />
                      Ajouter
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
