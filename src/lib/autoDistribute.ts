/**
 * Pure auto-distribution logic for supplier order dispatch.
 * Shared between mobile (SupplierOrders.tsx) and desktop (SupplierOrderInstance.tsx).
 */

export type DistributeMode = 'equitable' | 'by_stock';

export type DistributeItem = {
  itemId: string;
  articleId: string;
  receivedQty: number;
};

export type DistributeResult =
  | { ok: true; dispatch: Record<string, Record<string, number>> }
  | { ok: false; reason: string };

/** articleId → siteId → stock quantity (null = unknown). */
export type StockLevelMap = Record<string, Record<string, number | null>>;

export function computeAutoDistribution(
  items: DistributeItem[],
  selectedSiteIds: string[],
  stockLevels: StockLevelMap,
  mode: DistributeMode,
): DistributeResult {
  if (selectedSiteIds.length === 0) {
    return { ok: false, reason: 'Aucune destination sélectionnée' };
  }
  if (mode === 'equitable') {
    return distributeEquitable(items, selectedSiteIds, stockLevels);
  }
  return distributeByStock(items, selectedSiteIds, stockLevels);
}

// ── Equitable mode ──────────────────────────────────────────────────

function distributeEquitable(
  items: DistributeItem[],
  siteIds: string[],
  stockLevels: StockLevelMap,
): DistributeResult {
  const n = siteIds.length;
  const dispatch: Record<string, Record<string, number>> = {};
  const cumAlloc: Record<string, Record<string, number>> = {};

  for (const item of items) {
    const qty = item.receivedQty;
    if (qty <= 0) continue;

    const base = Math.floor(qty / n);
    const remainder = qty - base * n;

    const row: Record<string, number> = {};
    for (const sid of siteIds) row[sid] = base;

    if (remainder > 0) {
      const ranked = rankByEffectiveStock(
        siteIds, item.articleId, stockLevels, cumAlloc,
      );
      for (let i = 0; i < remainder; i++) {
        row[ranked[i]] += 1;
      }
    }

    dispatch[item.itemId] = row;
    accumulateAlloc(cumAlloc, item.articleId, siteIds, row);
  }

  return { ok: true, dispatch };
}

// ── By-stock mode ───────────────────────────────────────────────────

function distributeByStock(
  items: DistributeItem[],
  siteIds: string[],
  stockLevels: StockLevelMap,
): DistributeResult {
  const dispatch: Record<string, Record<string, number>> = {};

  for (const sid of siteIds) {
    for (const item of items) {
      if (getStock(stockLevels, item.articleId, sid) === null) {
        return { ok: false, reason: `Stock inconnu pour un article sur un emplacement` };
      }
    }
  }

  const cumAlloc: Record<string, Record<string, number>> = {};

  for (const item of items) {
    const qty = item.receivedQty;
    if (qty <= 0) continue;

    const effective: Record<string, number> = {};
    for (const sid of siteIds) {
      effective[sid] =
        (getStock(stockLevels, item.articleId, sid) ?? 0) +
        (cumAlloc[item.articleId]?.[sid] || 0);
    }

    const row = levelingDistribute(siteIds, effective, qty);
    dispatch[item.itemId] = row;
    accumulateAlloc(cumAlloc, item.articleId, siteIds, row);
  }

  return { ok: true, dispatch };
}

/**
 * Leveling: bring the lowest-stock sites up to the next level, repeat.
 *
 * Example: qty=60, stocks {A:12, B:3, C:21}
 *   Level B (3) up to A (12): costs 9 → remaining 51, stocks {A:12, B:12, C:21}
 *   Level A,B (12) up to C (21): costs 9×2=18 → remaining 33, stocks {A:21, B:21, C:21}
 *   Distribute 33 among 3: 11 each → final {A:32, B:32, C:32}, alloc {A:20, B:29, C:11}
 */
function levelingDistribute(
  siteIds: string[],
  currentStock: Record<string, number>,
  totalQty: number,
): Record<string, number> {
  const alloc: Record<string, number> = {};
  for (const id of siteIds) alloc[id] = 0;

  let remaining = totalQty;
  if (remaining <= 0) return alloc;

  const levels = siteIds.map(id => ({
    id,
    stock: currentStock[id],
  }));
  levels.sort((a, b) => a.stock - b.stock || a.id.localeCompare(b.id));

  let groupStart = 0;

  while (remaining > 0 && groupStart < levels.length) {
    const currentLevel = levels[groupStart].stock;

    let groupEnd = groupStart + 1;
    while (groupEnd < levels.length && levels[groupEnd].stock === currentLevel) {
      groupEnd++;
    }
    const groupSize = groupEnd - groupStart;

    if (groupEnd >= levels.length) {
      const base = Math.floor(remaining / groupSize);
      const rem = remaining - base * groupSize;
      for (let j = 0; j < groupSize; j++) {
        alloc[levels[groupStart + j].id] += base + (j < rem ? 1 : 0);
      }
      remaining = 0;
    } else {
      const nextLevel = levels[groupEnd].stock;
      const gap = nextLevel - currentLevel;
      const needed = gap * groupSize;

      if (needed <= remaining) {
        for (let j = 0; j < groupSize; j++) {
          alloc[levels[groupStart + j].id] += gap;
          levels[groupStart + j].stock = nextLevel;
        }
        remaining -= needed;
        groupStart = 0;
        levels.sort((a, b) => a.stock - b.stock || a.id.localeCompare(b.id));
      } else {
        const base = Math.floor(remaining / groupSize);
        const rem = remaining - base * groupSize;
        for (let j = 0; j < groupSize; j++) {
          alloc[levels[groupStart + j].id] += base + (j < rem ? 1 : 0);
        }
        remaining = 0;
      }
    }
  }

  return alloc;
}

// ── Helpers ─────────────────────────────────────────────────────────

function rankByEffectiveStock(
  siteIds: string[],
  articleId: string,
  stockLevels: StockLevelMap,
  cumAlloc: Record<string, Record<string, number>>,
): string[] {
  return [...siteIds].sort((a, b) => {
    const sa = (getStock(stockLevels, articleId, a) ?? 0) + (cumAlloc[articleId]?.[a] || 0);
    const sb = (getStock(stockLevels, articleId, b) ?? 0) + (cumAlloc[articleId]?.[b] || 0);
    return sa !== sb ? sa - sb : a.localeCompare(b);
  });
}

function accumulateAlloc(
  cumAlloc: Record<string, Record<string, number>>,
  articleId: string,
  siteIds: string[],
  row: Record<string, number>,
) {
  if (!cumAlloc[articleId]) cumAlloc[articleId] = {};
  for (const sid of siteIds) {
    cumAlloc[articleId][sid] = (cumAlloc[articleId][sid] || 0) + (row[sid] || 0);
  }
}

function getStock(
  stockLevels: StockLevelMap,
  articleId: string,
  siteId: string,
): number | null {
  const a = stockLevels[articleId];
  if (!a) return null;
  const v = a[siteId];
  return v === undefined ? null : v;
}

/**
 * Build a StockLevelMap from DB rows. Missing (article, site) pairs
 * for known articles/sites default to 0 (no row = zero stock).
 */
export function buildStockLevelMap(
  rows: Array<{ article_id: string; site_id: string; quantity: number }>,
  articleIds: string[],
  siteIds: string[],
): StockLevelMap {
  const map: StockLevelMap = {};
  for (const aid of articleIds) {
    map[aid] = {};
    for (const sid of siteIds) {
      map[aid][sid] = 0;
    }
  }
  for (const row of rows) {
    if (map[row.article_id]) {
      map[row.article_id][row.site_id] = row.quantity;
    }
  }
  return map;
}
