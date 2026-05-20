const KEY = 'waarwi:navCtx';

export type NavContext = {
  target?: 'receivables' | 'payables' | 'lowStock' | 'outOfStock' | 'quotes' | 'returns' | 'webNew' | 'webPrep' | 'webReady' | 'stockIn' | 'recentSales' | 'customers' | 'suppliers' | 'articles';
  highlightId?: string;
  filter?: string;
};

export function setNavContext(ctx: NavContext | null) {
  try {
    if (ctx) sessionStorage.setItem(KEY, JSON.stringify(ctx));
    else sessionStorage.removeItem(KEY);
  } catch {}
}

export function consumeNavContext(): NavContext | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    return JSON.parse(raw);
  } catch { return null; }
}

export function peekNavContext(): NavContext | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
