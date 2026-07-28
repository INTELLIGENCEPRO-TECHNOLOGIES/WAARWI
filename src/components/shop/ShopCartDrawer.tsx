import { useEffect } from 'react';
import { X, ShoppingCart, Trash2, Minus, Plus, ClipboardCheck } from 'lucide-react';
import type { CartItem } from '../../lib/shopTypes';
import { formatFCFA } from '../../lib/format';
import { ShopLazyImage } from './ShopLazyImage';

type Props = {
  cart: CartItem[];
  cartTotal: number;
  onClose: () => void;
  onQtyChange: (id: string, qty: number, max: number) => void;
  onRemove: (id: string) => void;
  onCheckout: () => void;
};

export function ShopCartDrawer({
  cart,
  cartTotal,
  onClose,
  onQtyChange,
  onRemove,
  onCheckout,
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

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end animate-fade-in">
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative w-full sm:w-[440px] bg-white sm:h-full flex flex-col max-h-[92vh] sm:max-h-full rounded-t-3xl sm:rounded-none shadow-premium animate-sheet-up sm:animate-slide-up">
        <div className="pt-3 pb-1 sm:hidden flex justify-center shrink-0">
          <div className="w-10 h-1.5 rounded-full bg-slate-200" />
        </div>

        <div className="flex items-center justify-between px-6 py-5 border-b border-neutral-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-600 to-brand-700 flex items-center justify-center shadow-glow">
              <ShoppingCart className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Panier
              </div>
              <div className="text-lg font-bold text-slate-900">
                {cart.length} article{cart.length > 1 ? 's' : ''}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2.5 rounded-xl hover:bg-neutral-100 text-neutral-500 transition-colors shop-touch-target"
            aria-label="Fermer le panier"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
              <div className="w-18 h-18 rounded-2xl bg-neutral-100 flex items-center justify-center">
                <ShoppingCart className="w-8 h-8 text-slate-300" />
              </div>
              <div className="text-sm font-semibold text-slate-500">
                Votre panier est vide
              </div>
            </div>
          ) : (
            cart.map((item) => (
              <ShopCartLine
                key={item.article.id}
                item={item}
                onQtyChange={(qty) =>
                  onQtyChange(item.article.id, qty, item.article.stock_qty)
                }
                onRemove={() => onRemove(item.article.id)}
              />
            ))
          )}
        </div>

        {cart.length > 0 && (
          <div className="shrink-0 border-t border-neutral-100 bg-white/95 backdrop-blur-md px-6 pt-5 pb-6 space-y-4 safe-bottom">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-600">
                Total panier
              </span>
              <span className="text-xl font-bold text-slate-900 num">
                {formatFCFA(cartTotal)}
              </span>
            </div>
            <button
              onClick={onCheckout}
              className="w-full h-14 rounded-xl bg-gradient-to-br from-brand-600 to-brand-700 text-white font-bold text-[15px] shadow-glow hover:shadow-premium active:scale-95 transition-all inline-flex items-center justify-center gap-2"
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

function ShopCartLine({
  item,
  onQtyChange,
  onRemove,
}: {
  item: CartItem;
  onQtyChange: (qty: number) => void;
  onRemove: () => void;
}) {
  const maxReached = item.qty >= item.article.stock_qty;

  return (
    <div className="flex items-start gap-3 p-3 rounded-2xl border border-neutral-100 bg-neutral-50/50">
      <div className="w-14 h-14 rounded-xl bg-white border border-neutral-100 flex items-center justify-center overflow-hidden shrink-0">
        <ShopLazyImage
          src={item.article.image_url}
          alt={item.article.name}
          className="w-full h-full object-contain p-1"
          fallbackClassName="w-full h-full"
          fallbackIconSize={20}
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-900 leading-snug shop-product-name">
          {item.article.name}
        </div>
        {item.article.internal_ref && (
          <div className="text-[10px] font-mono text-slate-400 truncate mt-0.5">
            {item.article.internal_ref}
          </div>
        )}
        {item.article.oem_ref && (
          <div className="text-[10px] font-mono text-slate-400 truncate">
            OEM: {item.article.oem_ref}
          </div>
        )}
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => onQtyChange(item.qty - 1)}
              className="w-8 h-8 rounded-lg bg-white border border-neutral-200 flex items-center justify-center hover:bg-neutral-100 active:scale-90 transition-all shop-touch-target"
              aria-label="Diminuer la quantité"
            >
              <Minus className="w-3 h-3 text-slate-600" />
            </button>
            <span className="w-8 text-center text-sm font-bold text-slate-900 num">
              {item.qty}
            </span>
            <button
              onClick={() => onQtyChange(item.qty + 1)}
              disabled={maxReached}
              className={`w-8 h-8 rounded-lg border flex items-center justify-center active:scale-90 transition-all shop-touch-target ${
                maxReached
                  ? 'bg-neutral-50 border-neutral-100 opacity-40 cursor-not-allowed'
                  : 'bg-white border-neutral-200 hover:bg-neutral-100'
              }`}
              aria-label="Augmenter la quantité"
            >
              <Plus className="w-3 h-3 text-slate-600" />
            </button>
          </div>
          <div className="text-sm font-bold text-slate-900 num">
            {formatFCFA(item.unit_price * item.qty)}
          </div>
        </div>
        {maxReached && (
          <div className="text-[10px] text-amber-600 font-semibold mt-1">
            Stock maximum atteint
          </div>
        )}
      </div>

      <button
        onClick={onRemove}
        className="shrink-0 p-1.5 rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-500 transition-colors mt-0.5"
        aria-label="Retirer du panier"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
