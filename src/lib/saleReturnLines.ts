import { supabase } from './supabase';
import {loadReturnLots} from './returnLotAllocation';

export async function loadInvoiceReturnLines(saleId: string) {
  const { data: items, error: itemsError } = await supabase.from('sale_items')
    .select('id, article_id, name, quantity, unit_price, purchase_cost, vat_net_amount, vat_amount').eq('sale_id', saleId);
  if (itemsError) throw itemsError;
  const fiscal = items.some(item => item.vat_net_amount != null);
  const returnLots = fiscal ? await loadReturnLots(saleId) : {};
  const alreadyReturned = new Map<string, { quantity: number; total: number }>();

  if (fiscal) {
    const { data, error } = await supabase.from('sale_return_items')
      .select('sale_item_id, quantity, total, sale_returns!inner(sale_id, status)')
      .eq('sale_returns.sale_id', saleId).in('sale_returns.status', ['approved', 'pending']);
    if (error) throw error;
    for (const item of data) {
      const previous = alreadyReturned.get(item.sale_item_id) ?? { quantity: 0, total: 0 };
      alreadyReturned.set(item.sale_item_id, {
        quantity: previous.quantity + Number(item.quantity),
        total: previous.total + Number(item.total),
      });
    }
  } else {
    const { data, error } = await supabase.rpc('get_sale_returned_quantities', { p_sale_id: saleId });
    if (error) throw error;
    for (const item of data || []) {
      alreadyReturned.set(item.article_id, { quantity: Number(item.total_returned), total: 0 });
    }
  }

  return items.flatMap(item => {
    const previous = alreadyReturned.get(fiscal ? item.id : item.article_id);
    const remaining = Math.max(0, Number(item.quantity) - (previous?.quantity ?? 0));
    if (remaining === 0) return [];
    const netPerUnit = fiscal
      ? (Number(item.vat_net_amount ?? 0) + Number(item.vat_amount ?? 0) - (previous?.total ?? 0)) / remaining
      : Number(item.unit_price);
    return [{
      item_id: item.id, article_id: item.article_id, name: item.name,
      max_qty: remaining, quantity: Math.min(remaining, 1), unit_price: netPerUnit,
      purchase_cost: Number(item.purchase_cost ?? 0), selected: false, returnLots: returnLots[item.id] || [], lotQuantities: {},
    }];
  });
}
