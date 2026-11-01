import { supabase } from './supabase';

// Server-side aggregate: covers every prepayment of the customer, whatever the caller may see in detail.
export async function fetchPrepayAvailable(customerIds: string[] | null): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc('get_customer_prepay_available', { p_customer_ids: customerIds });
  if (error) throw error;
  const out: Record<string, number> = {};
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const [id, v] of Object.entries(data as Record<string, unknown>)) out[id] = Number(v) || 0;
  }
  return out;
}
