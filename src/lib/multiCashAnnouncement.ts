const HOUR_MS = 3_600_000;
const DEFAULT_START = '2026-10-31T00:00:00Z';

function parseStart(raw: unknown): number {
  const fromEnv = typeof raw === 'string' && raw.trim() ? Date.parse(raw.trim()) : NaN;
  return Number.isFinite(fromEnv) ? fromEnv : Date.parse(DEFAULT_START);
}

const startsAt = parseStart(import.meta.env.VITE_MULTICASH_ANNOUNCE_START);

export const MULTI_CASH_CAMPAIGN = {
  id: 'multi-cash-launch-2026',
  startsAt,
  endsAt: startsAt + 120 * HOUR_MS,
} as const;

export function isCampaignActive(now: number, campaign: { startsAt: number; endsAt: number } = MULTI_CASH_CAMPAIGN): boolean {
  return now >= campaign.startsAt && now < campaign.endsAt;
}

function dismissKey(userId: string, tenantId: string) {
  return `waarwi_announce:${MULTI_CASH_CAMPAIGN.id}:${tenantId}:${userId}`;
}

export function isDismissedForever(userId: string, tenantId: string): boolean {
  try { return localStorage.getItem(dismissKey(userId, tenantId)) === 'dismissed'; } catch { return false; }
}

export function dismissForever(userId: string, tenantId: string) {
  try { localStorage.setItem(dismissKey(userId, tenantId), 'dismissed'); } catch { /* private mode: falls back to per-opening dismissal */ }
}
