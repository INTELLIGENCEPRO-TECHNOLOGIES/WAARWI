import { useCallback, useEffect, useState } from 'react';
import type { CartItem } from '../../lib/shopTypes';

const PREFIX = 'waarwi_shop_cart_';

function storageKey(tenantId: string): string {
  return `${PREFIX}${tenantId}`;
}

export function usePersistentCart(tenantId: string | null) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage on tenant change
  useEffect(() => {
    if (!tenantId) return;
    try {
      const raw = localStorage.getItem(storageKey(tenantId));
      if (raw) {
        const parsed: CartItem[] = JSON.parse(raw);
        if (Array.isArray(parsed)) setCart(parsed);
      } else {
        setCart([]);
      }
    } catch {
      setCart([]);
    }
    setHydrated(true);
  }, [tenantId]);

  // Persist on change (only after initial hydration to avoid overwriting)
  useEffect(() => {
    if (!tenantId || !hydrated) return;
    try {
      localStorage.setItem(storageKey(tenantId), JSON.stringify(cart));
    } catch {
      // localStorage might be full or disabled — silently ignore
    }
  }, [cart, tenantId, hydrated]);

  const addToCart = useCallback((article: CartItem['article']) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.article.id === article.id);
      if (existing) {
        const newQty = existing.qty + 1;
        if (newQty > article.stock_qty) return prev;
        return prev.map((i) =>
          i.article.id === article.id ? { ...i, qty: newQty } : i,
        );
      }
      if (article.stock_qty === 0) return prev;
      return [...prev, { article, qty: 1, unit_price: article.sale_price }];
    });
  }, []);

  const setCartQty = useCallback(
    (articleId: string, qty: number, maxStock: number) => {
      if (qty < 1) {
        setCart((prev) => prev.filter((i) => i.article.id !== articleId));
        return;
      }
      const safe = Math.min(qty, maxStock);
      setCart((prev) =>
        prev.map((i) => (i.article.id === articleId ? { ...i, qty: safe } : i)),
      );
    },
    [],
  );

  const removeFromCart = useCallback((articleId: string) => {
    setCart((prev) => prev.filter((i) => i.article.id !== articleId));
  }, []);

  const clearCart = useCallback(() => setCart([]), []);

  return {
    cart,
    addToCart,
    setCartQty,
    removeFromCart,
    clearCart,
    hydrated,
  };
}
