import { useEffect } from 'react';
import {
  X,
  Plus,
  Minus,
  Car,
  Info,
  ShoppingCart,
} from 'lucide-react';
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const badge = stockBadge(article.stock_qty, lowStockThreshold);
  const cat = categories.find((c) => c.id === article.category_id);
  const canAdd = article.stock_qty > 0 && cartQty < article.stock_qty;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full sm:max-w-lg bg-white sm:rounded-2xl shadow-premium flex flex-col max-h-[92vh] animate-sheet-up sm:animate-slide-up">
        <div className="pt-3 pb-1 sm:hidden flex justify-center">
          <div className="w-10 h-1.5 rounded-full bg-slate-200" />
        </div>
        <button
          onClick={onClose}
          className="hidden sm:flex absolute top-3 right-3 z-10 p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 transition-colors"
          aria-label="Fermer"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex-1 overflow-y-auto">
          {/* Image hero */}
          <div className="relative w-full aspect-video sm:max-h-64 bg-white border-b border-slate-100 flex items-center justify-center overflow-hidden">
            <ShopLazyImage
              src={article.image_url}
              alt={article.name}
              className="w-full h-full object-contain p-4"
              fallbackClassName="flex items-center justify-center w-full h-full"
              fallbackIconSize={80}
            />
            <div className="absolute top-3 left-3">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${badge.cls}`}
              >
                <span className={`w-2 h-2 rounded-full ${badge.dot}`} />
                {badge.label}
                {article.stock_qty > 0 && (
                  <span className="opacity-60">· {article.stock_qty}</span>
                )}
              </span>
            </div>
            <button
              onClick={onClose}
              className="sm:hidden absolute top-3 right-3 p-2 rounded-xl bg-white/80 backdrop-blur text-slate-600 shadow-sm"
              aria-label="Fermer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 sm:p-5 space-y-4">
            <div>
              {cat && (
                <div className="text-[10px] font-bold uppercase tracking-wider text-brand-600/80 mb-1">
                  {cat.name}
                </div>
              )}
              <h2 className="text-xl font-bold text-slate-900 leading-snug shop-product-name">
                {article.name}
              </h2>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {article.internal_ref && (
                  <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                    {article.internal_ref}
                  </span>
                )}
                {article.oem_ref && (
                  <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                    OEM {article.oem_ref}
                  </span>
                )}
                {article.brand && (
                  <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                    {article.brand}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-end justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Prix unitaire
                </div>
                <div className="text-3xl font-bold text-slate-900 num">
                  {formatFCFA(article.sale_price)}
                </div>
                {article.old_price != null && article.old_price > article.sale_price && (
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-sm text-slate-400 line-through num">{formatFCFA(article.old_price)}</span>
                    <span className="text-xs font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-md">
                      -{Math.round(((article.old_price - article.sale_price) / article.old_price) * 100)}%
                    </span>
                  </div>
                )}
                <div className="text-xs text-slate-500 mt-0.5">
                  par {article.unit}
                </div>
              </div>
              <div
                className={`px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wide ${
                  article.condition === 'neuf'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                    : article.condition === 'occasion'
                      ? 'bg-amber-50 text-amber-700 border border-amber-100'
                      : 'bg-neutral-50 text-neutral-800 border border-neutral-200'
                }`}
              >
                {article.condition}
              </div>
            </div>

            {article.description && (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Info className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Description
                  </span>
                </div>
                <p className="text-sm text-slate-700 leading-relaxed">
                  {article.description}
                </p>
              </div>
            )}

            {article.compatibilities.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Car className="w-4 h-4 text-brand-600" />
                  <span className="text-sm font-bold text-slate-800">
                    Compatibilités
                  </span>
                </div>
                <div className="space-y-1.5">
                  {article.compatibilities.map((c, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 border border-slate-100"
                    >
                      <div className="font-semibold text-sm text-slate-800">
                        {c.brand_name}
                        {c.model_name && (
                          <span className="text-slate-500 font-medium">
                            {' '}
                            · {c.model_name}
                          </span>
                        )}
                      </div>
                      {(c.year_start || c.year_end) && (
                        <div className="text-xs text-slate-400 num">
                          {c.year_start || '?'} – {c.year_end || 'auj.'}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer CTA */}
        <div className="shrink-0 border-t border-slate-100 bg-white/95 backdrop-blur-md px-5 pt-5 pb-6 safe-bottom">
          {cartQty > 0 ? (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={onRemoveOne}
                  className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center hover:bg-slate-200 active:scale-90 transition-all shop-touch-target"
                  aria-label="Retirer un"
                >
                  <Minus className="w-4 h-4 text-slate-700" />
                </button>
                <span className="w-10 text-center font-bold text-lg text-slate-900 num">
                  {cartQty}
                </span>
                <button
                  onClick={onAddToCart}
                  disabled={!canAdd}
                  className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all active:scale-90 shop-touch-target ${
                    canAdd
                      ? 'bg-brand-50 border border-brand-200 hover:bg-brand-100'
                      : 'bg-slate-50 border border-slate-100 opacity-40 cursor-not-allowed'
                  }`}
                  aria-label="Ajouter un"
                >
                  <Plus className="w-4 h-4 text-brand-700" />
                </button>
              </div>
              <div className="flex-1 h-12 rounded-xl bg-brand-50 border border-brand-200 flex items-center justify-center text-brand-800 text-sm font-bold">
                {formatFCFA(article.sale_price * cartQty)} dans le panier
              </div>
            </div>
          ) : (
            <button
              onClick={onAddToCart}
              disabled={article.stock_qty === 0}
              className={`w-full h-13 rounded-xl font-bold text-sm transition-all active:scale-95 inline-flex items-center justify-center gap-2 ${
                article.stock_qty === 0
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  : 'bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-glow hover:shadow-premium'
              }`}
            >
              {article.stock_qty === 0 ? (
                'Rupture de stock'
              ) : (
                <>
                  <ShoppingCart className="w-4 h-4" />
                  Ajouter au panier
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
