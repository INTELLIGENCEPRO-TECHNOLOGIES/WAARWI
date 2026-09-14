// Per-tab draft recovery for windowed editors (Achats, Facturation).
// Uses sessionStorage so state is isolated per browser tab and cleared when
// the tab closes. Drafts are versioned and scoped to (user, tenant, site).
// This is NOT for cross-device sync — that is Supabase's job elsewhere.
// Business writes (invoices, receptions, payments) go to Supabase; this
// file only handles the local scratch layer that survives an accidental
// reload before the user hits "Save".

export const DRAFT_VERSION = 1;
const KEY_PREFIX = 'waarwi:draft:v1';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type DraftKind = 'invoice' | 'quote' | 'supplier_order';
export type DraftScope = { userId: string; tenantId: string; siteId: string };

export type LayoutWindow = {
  windowId: string;
  kind: DraftKind;
  descriptor: any;
  rect?: { x: number; y: number; w: number; h: number };
  minimized?: boolean;
};

export type PageLayout = {
  version: number;
  savedAt: number;
  scope: DraftScope;
  pageWindowOpen: boolean;
  windows: LayoutWindow[];
  billSourceSiteId?: string;
};

export type OpInProgress = null | 'save' | 'receive';

export type FormDraft<T = any> = {
  version: number;
  savedAt: number;
  scope: DraftScope;
  kind: DraftKind;
  windowId: string;
  documentId: string | null;
  mode: string;
  data: T;
  opInProgress: OpInProgress;
};

// ── Error surfacing ────────────────────────────────────────────────
// A toast handler is registered once from App.tsx. Failures to persist
// (quota exceeded, storage disabled) are also flagged in a small external
// store so editor components can render a persistent warning banner.

let onError: ((msg: string) => void) | null = null;
export function setDraftErrorHandler(fn: ((msg: string) => void) | null) {
  onError = fn;
}

type StorageErrorState = { windowIds: Set<string>; version: number };
const storageErrorState: StorageErrorState = { windowIds: new Set(), version: 0 };
const errorListeners = new Set<() => void>();

function emitStorageError(windowId: string | null) {
  if (windowId) storageErrorState.windowIds.add(windowId);
  storageErrorState.version += 1;
  errorListeners.forEach(l => { try { l(); } catch {} });
}
function clearStorageError(windowId: string) {
  if (storageErrorState.windowIds.delete(windowId)) {
    storageErrorState.version += 1;
    errorListeners.forEach(l => { try { l(); } catch {} });
  }
}

export function subscribeStorageErrors(listener: () => void): () => void {
  errorListeners.add(listener);
  return () => { errorListeners.delete(listener); };
}
export function hasStorageErrorFor(windowId: string): boolean {
  return storageErrorState.windowIds.has(windowId);
}
export function getStorageErrorVersion(): number {
  return storageErrorState.version;
}

// ── Safe storage wrappers ──────────────────────────────────────────

function safeSet(key: string, value: string, windowId: string | null): boolean {
  try {
    sessionStorage.setItem(key, value);
    if (windowId) clearStorageError(windowId);
    return true;
  } catch {
    try { onError?.('Impossible d\'enregistrer votre brouillon local (stockage plein ou bloqué). Enregistrez maintenant pour ne rien perdre.'); } catch {}
    emitStorageError(windowId);
    return false;
  }
}
function safeGet(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function safeRemove(key: string) {
  try { sessionStorage.removeItem(key); } catch {}
}

function scopeMatch(a: DraftScope, b: DraftScope): boolean {
  return a.userId === b.userId && a.tenantId === b.tenantId && a.siteId === b.siteId;
}

// ── Layout (page-level windows) ─────────────────────────────────────

export function layoutKey(page: 'billing' | 'supplier-orders', scope: DraftScope): string {
  return `${KEY_PREFIX}:layout:${page}:${scope.userId}:${scope.tenantId}:${scope.siteId}`;
}

export function saveLayout(page: 'billing' | 'supplier-orders', layout: Omit<PageLayout, 'version' | 'savedAt'>): void {
  const full: PageLayout = { ...layout, version: DRAFT_VERSION, savedAt: Date.now() };
  safeSet(layoutKey(page, layout.scope), JSON.stringify(full), null);
}

export function loadLayout(page: 'billing' | 'supplier-orders', scope: DraftScope): PageLayout | null {
  const raw = safeGet(layoutKey(page, scope));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PageLayout;
    if (!parsed || parsed.version !== DRAFT_VERSION) return null;
    if (!parsed.scope || !scopeMatch(parsed.scope, scope)) return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) { safeRemove(layoutKey(page, scope)); return null; }
    return parsed;
  } catch { return null; }
}

export function clearLayout(page: 'billing' | 'supplier-orders', scope: DraftScope): void {
  safeRemove(layoutKey(page, scope));
}

// ── Form drafts (per-window) ────────────────────────────────────────

export function formKey(scope: DraftScope, windowId: string): string {
  return `${KEY_PREFIX}:form:${scope.userId}:${scope.tenantId}:${scope.siteId}:${windowId}`;
}

export function saveFormDraft<T>(scope: DraftScope, draft: Omit<FormDraft<T>, 'version' | 'savedAt' | 'scope'>): void {
  const full: FormDraft<T> = {
    ...draft,
    scope,
    version: DRAFT_VERSION,
    savedAt: Date.now(),
  };
  safeSet(formKey(scope, draft.windowId), JSON.stringify(full), draft.windowId);
}

export function loadFormDraft<T = any>(scope: DraftScope, windowId: string): FormDraft<T> | null {
  const raw = safeGet(formKey(scope, windowId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as FormDraft<T>;
    if (!parsed || parsed.version !== DRAFT_VERSION) return null;
    if (!parsed.scope || !scopeMatch(parsed.scope, scope)) return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) { safeRemove(formKey(scope, windowId)); return null; }
    return parsed;
  } catch { return null; }
}

export function clearFormDraft(scope: DraftScope, windowId: string): void {
  // Cancel any pending debounced write for this key so an in-flight timer
  // cannot rewrite the key we just removed.
  cancelScheduledSave(scope, windowId);
  safeRemove(formKey(scope, windowId));
  clearStorageError(windowId);
}

// ── Presence check (used by lazyWithRetry to avoid silent reloads) ─
// Scope-agnostic: only asks "does any draft exist in this tab, or is a
// write still buffered in a debounce timer?".

export function hasAnyDraft(): boolean {
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(`${KEY_PREFIX}:form:`)) return true;
    }
  } catch {}
  return false;
}

export function hasPendingWrite(): boolean {
  return debounceEntries.size > 0;
}

export function listFormDraftKeys(): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(`${KEY_PREFIX}:form:`)) out.push(k);
    }
  } catch {}
  return out;
}

// ── Debounced writer (per-window) ───────────────────────────────────
// Each entry keeps BOTH the timer AND the last pending payload, so a
// synchronous flush can write it out even if the timer has not fired.

type DebounceEntry = {
  timer: ReturnType<typeof setTimeout>;
  scope: DraftScope;
  draft: Omit<FormDraft<any>, 'version' | 'savedAt' | 'scope'>;
};
const debounceEntries = new Map<string, DebounceEntry>();

export function scheduleSaveFormDraft<T>(
  scope: DraftScope,
  draft: Omit<FormDraft<T>, 'version' | 'savedAt' | 'scope'>,
  delayMs = 400,
): void {
  const key = formKey(scope, draft.windowId);
  const existing = debounceEntries.get(key);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    debounceEntries.delete(key);
    saveFormDraft(scope, draft);
  }, delayMs);
  debounceEntries.set(key, { timer, scope, draft });
}

// Flush a single pending write to sessionStorage NOW (used before reload).
// If nothing is pending, this is a no-op. Never just discards the payload.
export function flushFormDraft(scope: DraftScope, windowId: string): void {
  const key = formKey(scope, windowId);
  const entry = debounceEntries.get(key);
  if (!entry) return;
  clearTimeout(entry.timer);
  debounceEntries.delete(key);
  saveFormDraft(entry.scope, entry.draft);
}

// Cancel a pending write WITHOUT persisting it (used when the draft is
// being cleared or when a save succeeded and the buffered payload is
// stale). Does not touch sessionStorage.
export function cancelScheduledSave(scope: DraftScope, windowId: string): void {
  const key = formKey(scope, windowId);
  const entry = debounceEntries.get(key);
  if (!entry) return;
  clearTimeout(entry.timer);
  debounceEntries.delete(key);
}

// Flush every pending write synchronously. Called on pagehide / beforeunload
// / visibilitychange→hidden so a reload never loses the last keystroke.
export function flushAllPendingDrafts(): void {
  if (debounceEntries.size === 0) return;
  const snapshot = Array.from(debounceEntries.values());
  debounceEntries.forEach(e => clearTimeout(e.timer));
  debounceEntries.clear();
  for (const entry of snapshot) {
    saveFormDraft(entry.scope, entry.draft);
  }
}

// Install once from App.tsx. Idempotent.
let listenersInstalled = false;
export function installDraftFlushListeners(): void {
  if (listenersInstalled || typeof window === 'undefined') return;
  listenersInstalled = true;
  const flush = () => flushAllPendingDrafts();
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}
