import { useCallback, useEffect, useState } from 'react';
import type { CartItem, ShopArticle } from '../../lib/shopTypes';

const PREFIX = 'waarwi_shop_cart_';

function storageKey(tenantId: string, siteId: string): string {
  return `${PREFIX}${tenantId}_${siteId}`;
}

// Keeps only items still sold by this shop, with fresh price and stock.
function pruneCart(items: CartItem[], catalog: ShopArticle[]): CartItem[] {
  const byId = new Map(catalog.map((a) => [a.id, a]));
  const out: CartItem[] = [];
  for (const item of items) {
    const fresh = item?.article?.id ? byId.get(item.article.id) : undefined;
    if (!fresh || fresh.stock_qty <= 0) continue;
    const qty = Math.min(Math.max(1, Math.floor(Number(item.qty) || 1)), fresh.stock_qty);
    out.push({ article: fresh, qty, unit_price: fresh.sale_price });
  }
  return out;
}

export function usePersistentCart(tenantId: string | null, siteId: string | null, catalog: ShopArticle[] | null) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(false);
    if (!tenantId || !siteId || !catalog) return;
    try {
      const raw = localStorage.getItem(storageKey(tenantId, siteId));
      const parsed = raw ? JSON.parse(raw) : [];
      setCart(Array.isArray(parsed) ? pruneCart(parsed, catalog) : []);
    } catch {
      setCart([]);
    }
    try {
      localStorage.removeItem(`${PREFIX}${tenantId}`);
    } catch {
      // storage unavailable
    }
    setHydrated(true);
  }, [tenantId, siteId, catalog]);

  useEffect(() => {
    if (!tenantId || !siteId || !hydrated) return;
    try {
      localStorage.setItem(storageKey(tenantId, siteId), JSON.stringify(cart));
    } catch {
      // localStorage might be full or disabled
    }
  }, [cart, tenantId, siteId, hydrated]);

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
