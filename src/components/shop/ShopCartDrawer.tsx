import { useEffect } from 'react';
import { X, Minus, Plus, Trash2 } from 'lucide-react';
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
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative w-full sm:w-[420px] bg-white sm:h-full flex flex-col max-h-[92vh] sm:max-h-full sm:border-l sm:border-neutral-200 animate-sheet-up sm:animate-slide-up">
        {/* Mobile handle */}
        <div className="pt-3 pb-1 sm:hidden flex justify-center">
          <div className="w-10 h-1 rounded-full bg-neutral-200" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100 shrink-0">
          <div>
            <h3 className="text-base font-bold text-neutral-900">Panier</h3>
            <div className="text-[11px] text-neutral-400">
              {cart.length} article{cart.length > 1 ? 's' : ''}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-neutral-400 hover:text-neutral-700 transition-colors"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center px-5">
              <div className="text-sm text-neutral-400">Votre panier est vide</div>
            </div>
          ) : (
            <div className="divide-y divide-neutral-100">
              {cart.map((item) => (
                <CartLine
                  key={item.article.id}
                  item={item}
                  onQtyChange={(qty) => onQtyChange(item.article.id, qty, item.article.stock_qty)}
                  onRemove={() => onRemove(item.article.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {cart.length > 0 && (
          <div className="shrink-0 border-t border-neutral-100 px-5 py-4 space-y-3 safe-bottom">
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-500">Total</span>
              <span className="text-lg font-bold text-neutral-900 num">{formatFCFA(cartTotal)}</span>
            </div>
            <button
              onClick={onCheckout}
              className="w-full h-12 bg-neutral-900 text-white text-sm font-bold hover:bg-neutral-800 active:scale-[0.98] transition-all"
            >
              Commander
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CartLine({
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
    <div className="flex items-start gap-3 px-5 py-4">
      <div className="w-12 h-12 bg-neutral-50 border border-neutral-100 overflow-hidden shrink-0">
        <ShopLazyImage
          src={item.article.image_url}
          alt={item.article.name}
          className="w-full h-full object-contain p-1"
          fallbackClassName="w-full h-full"
          fallbackIconSize={18}
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-neutral-900 leading-snug line-clamp-2">
          {item.article.name}
        </div>
        {item.article.internal_ref && (
          <div className="text-[10px] text-neutral-400 mt-0.5">{item.article.internal_ref}</div>
        )}
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => onQtyChange(item.qty - 1)}
              className="w-7 h-7 border border-neutral-200 flex items-center justify-center hover:bg-neutral-50 active:scale-90 transition-all"
              aria-label="Diminuer"
            >
              <Minus className="w-3 h-3 text-neutral-600" />
            </button>
            <span className="w-8 text-center text-sm font-bold text-neutral-900 num">{item.qty}</span>
            <button
              onClick={() => onQtyChange(item.qty + 1)}
              disabled={maxReached}
              className={`w-7 h-7 border border-neutral-200 flex items-center justify-center active:scale-90 transition-all ${
                maxReached ? 'opacity-30 cursor-not-allowed' : 'hover:bg-neutral-50'
              }`}
              aria-label="Augmenter"
            >
              <Plus className="w-3 h-3 text-neutral-600" />
            </button>
          </div>
          <div className="text-sm font-bold text-neutral-900 num">
            {formatFCFA(item.unit_price * item.qty)}
          </div>
        </div>
      </div>

      <button
        onClick={onRemove}
        className="shrink-0 p-1 text-neutral-300 hover:text-red-500 transition-colors"
        aria-label="Retirer"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}
