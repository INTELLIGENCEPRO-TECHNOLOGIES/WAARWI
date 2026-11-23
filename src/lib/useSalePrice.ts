import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export type PriceLine = {
  article_id: string | null;
  quantity: number;
  unit_price: number;
  discount?: number | null;
};

export type SalePrice = { enabled: boolean; subtotal: number; ht: number; vat: number; ttc: number };

export function useSalePrice(siteId: string | null | undefined, items: PriceLine[], discount = 0) {
  const payload = JSON.stringify(items.map(({ article_id, quantity, unit_price, discount }) => ({
    article_id, quantity, unit_price, discount,
  })));
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([siteId, payload, discount, revision]);
  const [result, setResult] = useState<{ key: string; price?: SalePrice; error?: string }>();
  const requested = !!siteId && items.length > 0;

  useEffect(() => {
    if (!requested) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void supabase.rpc('preview_sale_price', {
        p_site_id: siteId, p_items: JSON.parse(payload), p_discount: discount,
      }).abortSignal(controller.signal).then(({ data, error }) => {
        if (controller.signal.aborted) return;
        setResult(error ? { key, error: error.message } : { key, price: data as SalePrice });
      });
    }, 120);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [requested, siteId, payload, discount, key]);

  return {
    price: requested && result?.key === key ? result.price : undefined,
    error: requested && result?.key === key ? result.error : undefined,
    refresh: () => setRevision(previous => previous + 1),
  };
}
