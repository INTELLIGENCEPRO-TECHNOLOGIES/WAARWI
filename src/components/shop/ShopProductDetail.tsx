import { useEffect } from 'react';
import { X, Plus, Minus, Car, Info, ShoppingCart } from 'lucide-react';
import type { ShopArticle, Category } from '../../lib/shopTypes';
import { stockBadge } from '../../lib/shopTypes';
import { formatFCFA } from '../../lib/format';
import { ShopLazyImage } from './ShopLazyImage';

type Props = {
  article: ShopArticle;
  categories: Category[];
  shopWhatsApp: string;
  shopName: string;
  cartQty: number;
  onAddToCart: () => void;
  onRemoveOne: () => void;
  onClose: () => void;
  lowStockThreshold: number;
};

export function ShopProductDetail({
  article,
  categories,
  cartQty,
  onAddToCart,
  onRemoveOne,
  onClose,
  lowStockThreshold,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  const badge = stockBadge(article.stock_qty, lowStockThreshold);
  const cat = categories.find((c) => c.id === article.category_id);
  const canAdd = article.stock_qty > 0 && cartQty < article.stock_qty;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center animate-fade-in">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-white sm:border sm:border-neutral-200 flex flex-col max-h-[92vh] animate-sheet-up sm:animate-slide-up">
        {/* Mobile handle */}
        <div className="pt-3 pb-1 sm:hidden flex justify-center">
          <div className="w-10 h-1 rounded-full bg-neutral-200" />
        </div>
        <button
          onClick={onClose}
          className="hidden sm:flex absolute top-3 right-3 z-10 p-2 text-neutral-400 hover:text-neutral-700 transition-colors"
          aria-label="Fermer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex-1 overflow-y-auto">
          {/* Image */}
          <div className="relative w-full aspect-video sm:max-h-64 bg-neutral-50 border-b border-neutral-100 flex items-center justify-center overflow-hidden">
            <ShopLazyImage
              src={article.image_url}
              alt={article.name}
              className="w-full h-full object-contain p-6"
              fallbackClassName="flex items-center justify-center w-full h-full"
              fallbackIconSize={64}
            />
            <div className="absolute top-3 left-3 flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${badge.dot}`} />
              <span className="text-[10px] font-medium text-neutral-600">{badge.label}</span>
              {article.stock_qty > 0 && <span className="text-[10px] text-neutral-400">({article.stock_qty})</span>}
            </div>
            <button
              onClick={onClose}
              className="sm:hidden absolute top-3 right-3 p-2 bg-white/80 text-neutral-600"
              aria-label="Fermer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            <div>
              {cat && (
                <div className="text-[9px] font-bold uppercase tracking-wider text-neutral-400 mb-1">{cat.name}</div>
              )}
              <h2 className="text-lg font-bold text-neutral-900 leading-snug">{article.name}</h2>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {article.internal_ref && (
                  <span className="text-[10px] text-neutral-500">{article.internal_ref}</span>
                )}
                {article.oem_ref && (
                  <span className="text-[10px] text-neutral-500">OEM {article.oem_ref}</span>
                )}
                {article.brand && (
                  <span className="text-[10px] font-medium text-neutral-600">{article.brand}</span>
                )}
              </div>
            </div>

            <div className="flex items-end justify-between border-t border-neutral-100 pt-4">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Prix unitaire</div>
                <div className="text-2xl font-bold text-neutral-900 num">{formatFCFA(article.sale_price)}</div>
                {article.old_price != null && article.old_price > article.sale_price && (
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-sm text-neutral-400 line-through num">{formatFCFA(article.old_price)}</span>
                    <span className="text-[10px] font-bold text-red-600">-{Math.round(((article.old_price - article.sale_price) / article.old_price) * 100)}%</span>
                  </div>
                )}
                <div className="text-[10px] text-neutral-400 mt-0.5">par {article.unit}</div>
              </div>
              {article.condition && (
                <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 border border-neutral-200 px-2 py-1">
                  {article.condition}
                </span>
              )}
            </div>

            {article.description && (
              <div className="border-t border-neutral-100 pt-4">
                <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-2">Description</div>
                <p className="text-sm text-neutral-700 leading-relaxed">{article.description}</p>
              </div>
            )}

            {article.compatibilities.length > 0 && (
              <div className="border-t border-neutral-100 pt-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <Car className="w-4 h-4 text-neutral-400" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Compatibilites</span>
                </div>
                <div className="divide-y divide-neutral-100">
                  {article.compatibilities.map((c, i) => (
                    <div key={i} className="flex items-center justify-between py-2">
                      <div className="text-sm text-neutral-800">
                        {c.brand_name}{c.model_name && <span className="text-neutral-500"> {c.model_name}</span>}
                      </div>
                      {(c.year_start || c.year_end) && (
                        <div className="text-xs text-neutral-400 num">{c.year_start || '?'} - {c.year_end || 'auj.'}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer CTA */}
        <div className="shrink-0 border-t border-neutral-100 px-5 py-4 safe-bottom">
          {cartQty > 0 ? (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-0.5">
                <button onClick={onRemoveOne} className="w-10 h-10 border border-neutral-200 flex items-center justify-center hover:bg-neutral-50 active:scale-90 transition-all" aria-label="Retirer un">
                  <Minus className="w-4 h-4 text-neutral-600" />
                </button>
                <span className="w-10 text-center font-bold text-lg text-neutral-900 num">{cartQty}</span>
                <button onClick={onAddToCart} disabled={!canAdd} className={`w-10 h-10 border border-neutral-200 flex items-center justify-center active:scale-90 transition-all ${canAdd ? 'hover:bg-neutral-50' : 'opacity-30 cursor-not-allowed'}`} aria-label="Ajouter un">
                  <Plus className="w-4 h-4 text-neutral-600" />
                </button>
              </div>
              <div className="flex-1 h-11 border border-neutral-200 flex items-center justify-center text-sm font-bold text-neutral-900 num">
                {formatFCFA(article.sale_price * cartQty)} dans le panier
              </div>
            </div>
          ) : (
            <button
              onClick={onAddToCart}
              disabled={article.stock_qty === 0}
              className={`w-full h-12 font-bold text-sm transition-all active:scale-[0.98] inline-flex items-center justify-center gap-2 ${
                article.stock_qty === 0
                  ? 'border border-neutral-200 text-neutral-400 cursor-not-allowed'
                  : 'bg-neutral-900 text-white hover:bg-neutral-800'
              }`}
            >
              {article.stock_qty === 0 ? 'Rupture de stock' : (<><ShoppingCart className="w-4 h-4" />Ajouter au panier</>)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
