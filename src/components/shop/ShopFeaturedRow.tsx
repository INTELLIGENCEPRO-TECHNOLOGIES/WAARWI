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

export function ShopFeaturedRow({ articles, cart, onDetail, onAddToCart, onSetQty, theme }: Props) {
  if (articles.length === 0) return null;

  return (
    <section className="shop-fluid py-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg sm:text-xl font-bold text-slate-900">Produits populaires</h2>
      </div>
      <div className="shop-featured-scroll">
        {articles.slice(0, 8).map((article) => {
          const cartQty = cart.find((i) => i.article.id === article.id)?.qty || 0;
          const inCart = cartQty > 0;
          const outOfStock = article.stock_qty === 0;

          return (
            <div
              key={article.id}
              className="shrink-0 w-[200px] sm:w-[220px] flex flex-col bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
            >
              <button
                onClick={() => onDetail(article)}
                className="relative w-full aspect-square overflow-hidden rounded-t-2xl bg-slate-50 shrink-0"
              >
                <ShopLazyImage
                  src={article.image_url}
                  alt={article.name}
                  className="w-full h-full object-contain p-3"
                  fallbackClassName="w-full h-full p-3"
                  fallbackIconSize={28}
                />
              </button>
              <div className="p-3 flex-1 flex flex-col">
                <button onClick={() => onDetail(article)} className="text-left flex-1">
                  <div className="text-sm font-semibold text-slate-900 leading-snug shop-product-name line-clamp-2">
                    {article.name}
                  </div>
                  <div className="mt-1.5 text-base font-bold text-slate-900 num">
                    {formatFCFA(article.sale_price)}
                  </div>
                </button>
                <div className="mt-2.5">
                  {outOfStock ? (
                    <div className="w-full h-9 rounded-lg bg-slate-100 text-slate-400 text-[11px] font-semibold flex items-center justify-center">
                      Rupture
                    </div>
                  ) : inCart ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => onSetQty(article.id, cartQty - 1)}
                        className="w-9 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors active:scale-90"
                      >
                        <Minus className="w-3.5 h-3.5 text-slate-700" />
                      </button>
                      <span className="flex-1 text-center text-sm font-bold num">{cartQty}</span>
                      <button
                        onClick={() => onAddToCart(article)}
                        disabled={cartQty >= article.stock_qty}
                        className="w-9 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors active:scale-90 disabled:opacity-40"
                      >
                        <Plus className="w-3.5 h-3.5 text-slate-700" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => onAddToCart(article)}
                      className={`w-full h-9 rounded-lg text-[11px] font-bold inline-flex items-center justify-center gap-1.5 transition-all active:scale-95 ${theme.cardButtonClass}`}
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
