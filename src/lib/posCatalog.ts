import { supabase } from './supabase';

const articleColumns = 'id, internal_ref, name, oem_ref, sale_price, purchase_price, category_id, image_url, ipm_eligible, track_stock';

export type PosArticle = {
  id: string; internal_ref: string; name: string; oem_ref: string;
  sale_price: number; purchase_price: number; stock_available: number;
  category_id: string | null; image_url: string | null; ipm_eligible: boolean;
  track_stock: boolean;
};

export type PosArticleTier = { article_id: string; tier_name: string; price: number };

function articleQuery(tenantId: string, catalogSiteId: string | null) {
  const query = supabase.from('articles').select(articleColumns).eq('tenant_id', tenantId).eq('is_active', true);
  return catalogSiteId ? query.eq('site_id', catalogSiteId) : query;
}

function batches(ids: string[]) {
  const unique = [...new Set(ids)];
  const result: string[][] = [];
  for (let start = 0; start < unique.length; start += 60) result.push(unique.slice(start, start + 60));
  return result;
}

export async function fetchPosStock(tenantId: string, stockSiteId: string, ids: string[], signal: AbortSignal) {
  const results = await Promise.all(batches(ids).map(batch => supabase.from('stock_levels')
    .select('article_id, quantity').eq('tenant_id', tenantId).eq('site_id', stockSiteId)
    .in('article_id', batch).abortSignal(signal)));
  const stock = new Map<string, number>();
  for (const { data, error } of results) {
    if (error) throw error;
    for (const row of data) stock.set(row.article_id, Number(row.quantity));
  }
  return stock;
}

function mapArticle(a: Record<string, any>, stock: Map<string, number>): PosArticle {
  return {
    id: a.id, internal_ref: a.internal_ref || '', name: a.name, oem_ref: a.oem_ref || '',
    sale_price: Number(a.sale_price), purchase_price: Number(a.purchase_price),
    stock_available: stock.get(a.id) ?? 0, category_id: a.category_id ?? null,
    image_url: a.image_url ?? null, ipm_eligible: a.ipm_eligible !== false,
    track_stock: a.track_stock !== false,
  };
}

export async function fetchPosArticlesById(tenantId: string, catalogSiteId: string | null, stockSiteId: string, ids: string[], signal: AbortSignal) {
  const [results, stock] = await Promise.all([
    Promise.all(batches(ids).map(batch => articleQuery(tenantId, catalogSiteId).in('id', batch).abortSignal(signal))),
    fetchPosStock(tenantId, stockSiteId, ids, signal),
  ]);
  return results.flatMap(({ data, error }) => {
    if (error) throw error;
    return data.map(row => mapArticle(row, stock));
  });
}

export async function fetchPosCatalog({
  tenantId, catalogSiteId, stockSiteId, search, categories, scores, signal,
}: {
  tenantId: string; catalogSiteId: string | null; stockSiteId: string;
  search: string; categories: string[]; scores: Record<string, number>; signal: AbortSignal;
}) {
  const limit = search || categories.length > 0 ? 300 : 120;
  const browseQuery = () => {
    const query = articleQuery(tenantId, catalogSiteId);
    if (categories.length > 0) query.in('category_id', categories);
    if (search) {
      // Quote the PostgREST filter value and treat SQL pattern characters literally.
      const term = search.replace(/[\\%_]/g, '\\$&').replace(/[\\"]/g, '\\$&');
      query.or(`name.ilike."%${term}%",internal_ref.ilike."%${term}%"`);
    }
    return query;
  };
  const popularIds = Object.keys(scores).sort((a, b) => scores[b] - scores[a]).slice(0, limit);
  const results = await Promise.all([
    browseQuery().order('name').order('id').limit(limit).abortSignal(signal),
    ...batches(popularIds).map(batch => browseQuery().in('id', batch).abortSignal(signal)),
  ]);
  const unique = new Map<string, Record<string, any>>();
  for (const { data, error } of results) {
    if (error) throw error;
    for (const row of data) unique.set(row.id, row);
  }
  const rows = [...unique.values()].sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0)
    || a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }) || a.id.localeCompare(b.id)).slice(0, limit);
  const stock = await fetchPosStock(tenantId, stockSiteId, rows.filter(row => row.track_stock !== false).map(row => row.id), signal);
  return rows.map(row => mapArticle(row, stock));
}
