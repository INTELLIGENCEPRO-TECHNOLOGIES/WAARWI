import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Loader2, Truck, CheckCircle, AlertTriangle, Split, ChevronDown, Check } from 'lucide-react';
import { formatNum } from '../../lib/format';
import {
  computeAutoDistribution,
  type DistributeMode,
  type StockLevelMap,
  type DistributeItem,
} from '../../lib/autoDistribute';

// ─── Types ──────────────────────────────────────────────────────

export type DispatchLineItem = {
  itemId: string;
  articleId: string;
  name: string;
  supplierRef?: string;
  receivedQty: number;
};

export type Destination = {
  id: string;
  name: string;
  isWarehouse?: boolean;
};

export type DispatchStepProps = {
  items: DispatchLineItem[];
  destinations: Destination[];
  dispatchData: Record<string, Record<string, number>>;
  setDispatchData: (fn: (prev: Record<string, Record<string, number>>) => Record<string, Record<string, number>>) => void;
  stockLevels: StockLevelMap | null;
  stockLoading: boolean;
  onConfirm: () => void;
  onBack: () => void;
  saving: boolean;
};

// ─── Mode options ───────────────────────────────────────────────

const MODE_OPTIONS: { value: DistributeMode; label: string }[] = [
  { value: 'equitable', label: 'Équitable' },
  { value: 'by_stock', label: 'Selon stock' },
];

// ─── Inline dropdown ────────────────────────────────────────────

function ModeDropdown({ value, onChange, compact }: {
  value: DistributeMode;
  onChange: (m: DistributeMode) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  const selected = MODE_OPTIONS.find(o => o.value === value)!;

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const menuW = Math.max(r.width, 140);
    const menuH = MODE_OPTIONS.length * 36 + 2;
    let top = r.bottom + 4;
    let left = r.left;
    if (top + menuH > window.innerHeight) top = r.top - menuH - 4;
    if (left + menuW > window.innerWidth) left = window.innerWidth - menuW - 8;
    if (left < 4) left = 4;
    setPos({ top, left, width: menuW });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePos();
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (triggerRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [open, updatePos]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1 border border-[var(--w-separator)] rounded px-1.5 bg-[var(--w-surface)] text-[var(--w-text)] hover:bg-[var(--w-hover)] transition-colors select-none ${compact ? 'h-6 text-[10px]' : 'h-6 text-[10px]'}`}
      >
        <span className="truncate">{selected.label}</span>
        <ChevronDown className={`w-3 h-3 text-[var(--w-text-muted)] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 2147483000 }}
          className="bg-[var(--w-surface)] border border-[var(--w-separator)] rounded-lg shadow-lg overflow-hidden"
        >
          {MODE_OPTIONS.map(opt => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[11px] transition-colors ${active ? 'bg-[var(--w-active)] font-semibold text-[var(--w-text)]' : 'text-[var(--w-text-secondary)] hover:bg-[var(--w-hover)]'}`}
              >
                <span className="flex-1">{opt.label}</span>
                {active && <Check className="w-3.5 h-3.5 shrink-0 text-emerald-500" />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

// ─── Component ──────────────────────────────────────────────────

export function DispatchStep({
  items, destinations, dispatchData, setDispatchData,
  stockLevels, stockLoading, onConfirm, onBack, saving,
}: DispatchStepProps) {
  const [selectedSites, setSelectedSites] = useState<Set<string>>(
    () => new Set(destinations.map(d => d.id)),
  );
  const [itemModes, setItemModes] = useState<Record<string, DistributeMode>>({});

  const getItemMode = (itemId: string): DistributeMode => itemModes[itemId] || 'equitable';
  const setItemMode = useCallback((itemId: string, mode: DistributeMode) => {
    setItemModes(p => ({ ...p, [itemId]: mode }));
  }, []);

  const toggleSite = useCallback((id: string) => {
    setSelectedSites(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectedDests = useMemo(
    () => destinations.filter(d => selectedSites.has(d.id)),
    [destinations, selectedSites],
  );

  // ── Validation ──

  const validation = useMemo(() => {
    const perItem: Record<string, { allocated: number; expected: number; valid: boolean }> = {};
    let allValid = true;
    for (const item of items) {
      const row = dispatchData[item.itemId] || {};
      const allocated = Object.values(row).reduce((s, v) => s + (Number(v) || 0), 0);
      const valid = allocated === item.receivedQty && !Object.values(row).some(v => (Number(v) || 0) < 0);
      perItem[item.itemId] = { allocated, expected: item.receivedQty, valid };
      if (!valid) allValid = false;
    }
    return { perItem, allValid };
  }, [items, dispatchData]);

  // ── Per-article auto-distribute ──

  const canAutoDistribute = !!stockLevels && !stockLoading && selectedSites.size > 0;

  const applyForItem = useCallback((item: DispatchLineItem) => {
    if (!stockLevels) return;
    const mode = getItemMode(item.itemId);
    const distItems: DistributeItem[] = [{
      itemId: item.itemId,
      articleId: item.articleId,
      receivedQty: item.receivedQty,
    }];
    const siteIds = [...selectedSites];
    const result = computeAutoDistribution(distItems, siteIds, stockLevels, mode);
    if (result.ok) {
      setDispatchData(prev => ({
        ...prev,
        [item.itemId]: result.dispatch[item.itemId] || prev[item.itemId],
      }));
    }
  }, [stockLevels, selectedSites, itemModes, setDispatchData]);

  const applyAll = useCallback(() => {
    if (!stockLevels) return;
    const siteIds = [...selectedSites];
    const next: Record<string, Record<string, number>> = {};
    for (const item of items) {
      const mode = getItemMode(item.itemId);
      const distItems: DistributeItem[] = [{
        itemId: item.itemId,
        articleId: item.articleId,
        receivedQty: item.receivedQty,
      }];
      const result = computeAutoDistribution(distItems, siteIds, stockLevels, mode);
      if (result.ok) {
        next[item.itemId] = result.dispatch[item.itemId] || {};
      }
    }
    setDispatchData(prev => ({ ...prev, ...next }));
  }, [items, stockLevels, selectedSites, itemModes, setDispatchData]);

  const updateCell = useCallback((itemId: string, siteId: string, value: number) => {
    setDispatchData(prev => ({
      ...prev,
      [itemId]: { ...(prev[itemId] || {}), [siteId]: Math.max(0, value) },
    }));
  }, [setDispatchData]);

  const getStock = (articleId: string, siteId: string): number | null => {
    if (!stockLevels) return null;
    const a = stockLevels[articleId];
    if (!a) return null;
    const v = a[siteId];
    return v === undefined ? null : v;
  };

  const ulInput = 'w-16 text-xs h-7 px-1 bg-transparent border-0 border-b border-[var(--w-separator)] text-center num focus:border-[var(--w-text)] outline-none transition-colors';

  return (
    <div className="flex flex-col h-full">
      {/* ── Step indicator + back ── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--w-separator)]">
        <button onClick={onBack} className="p-1 rounded hover:bg-[var(--w-surface)] transition-colors text-[var(--w-text-muted)]">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 text-xs">
          <span className="flex items-center gap-1 text-[var(--w-text-muted)]">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
            1. Réception
          </span>
          <span className="text-[var(--w-text-muted)]">/</span>
          <span className="font-semibold text-[var(--w-text)]">2. Dispatching</span>
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto">
        {/* Destination selection */}
        <div className="px-4 py-3 border-b border-[var(--w-separator)]">
          <div className="text-[10px] uppercase tracking-wider text-[var(--w-text-muted)] font-semibold mb-2">Destinations</div>
          <div className="flex flex-wrap gap-2">
            {destinations.map(d => (
              <label key={d.id} className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={selectedSites.has(d.id)}
                  onChange={() => toggleSite(d.id)}
                  className="w-3.5 h-3.5 rounded border-[var(--w-separator)] text-[var(--w-text)] focus:ring-0 focus:ring-offset-0"
                />
                <span className="text-xs text-[var(--w-text)]">{d.name}</span>
                {d.isWarehouse && <span className="text-[9px] text-[var(--w-text-muted)]">(dépôt)</span>}
              </label>
            ))}
          </div>
        </div>

        {/* Global apply-all shortcut */}
        <div className="px-4 py-2.5 border-b border-[var(--w-separator)] flex items-center justify-center gap-3">
          <button
            onClick={applyAll}
            disabled={!canAutoDistribute}
            className="inline-flex items-center gap-1.5 h-7 px-3.5 text-[11px] font-semibold text-[var(--w-accent-text)] bg-[var(--w-accent)] border border-[var(--w-accent-border)] rounded hover:bg-[var(--w-accent-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Split className="w-3.5 h-3.5" />
            Répartir tous les articles
          </button>
          {stockLoading && (
            <span className="flex items-center gap-1 text-[11px] text-[var(--w-text-muted)]">
              <Loader2 className="w-3 h-3 animate-spin" /> Chargement stock...
            </span>
          )}
          {!stockLevels && !stockLoading && (
            <span className="flex items-center gap-1 text-[11px] text-amber-600">
              <AlertTriangle className="w-3 h-3" /> Stock inconnu
            </span>
          )}
        </div>

        {/* ── Dispatch table (desktop) ── */}
        <div className="hidden sm:block">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--w-separator)]">
                <th className="text-left px-4 py-1.5 text-[10px] font-semibold text-[var(--w-text-muted)] uppercase tracking-wider w-[30%]">Article</th>
                <th className="text-center px-2 py-1.5 text-[10px] font-semibold text-[var(--w-text-muted)] uppercase tracking-wider w-[60px]">Reçu</th>
                {selectedDests.map(d => (
                  <th key={d.id} className="text-center px-2 py-1.5 text-[10px] font-semibold text-[var(--w-text)] uppercase tracking-wider">
                    {d.name}
                  </th>
                ))}
                <th className="text-center px-2 py-1.5 text-[10px] font-semibold text-[var(--w-text-muted)] uppercase tracking-wider w-[80px]">Total</th>
                <th className="text-center px-2 py-1.5 text-[10px] font-semibold text-[var(--w-text-muted)] uppercase tracking-wider w-[160px]">Répartition</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const v = validation.perItem[item.itemId];
                const mode = getItemMode(item.itemId);
                return (
                  <tr key={item.itemId} className="border-b border-[var(--w-separator)]">
                    <td className="px-4 py-2">
                      <div className="font-medium text-[var(--w-text)]">{item.name}</div>
                      {item.supplierRef && <div className="text-[10px] text-[var(--w-text-muted)] font-mono">{item.supplierRef}</div>}
                    </td>
                    <td className="text-center font-semibold text-[var(--w-text)] num">{item.receivedQty}</td>
                    {selectedDests.map(d => {
                      const val = dispatchData[item.itemId]?.[d.id] || 0;
                      const stock = getStock(item.articleId, d.id);
                      return (
                        <td key={d.id} className="text-center px-2 py-1.5">
                          <input
                            type="number" min={0} value={val}
                            onChange={e => updateCell(item.itemId, d.id, Number(e.target.value) || 0)}
                            className={ulInput}
                          />
                          {stock !== null && (
                            <div className="text-[9px] text-[var(--w-text-muted)] mt-0.5 tabular-nums">
                              {stock} → {stock + val}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="text-center px-2">
                      <span className={`font-semibold num ${v?.valid ? 'text-emerald-600' : 'text-red-500'}`}>
                        {v?.allocated || 0}
                      </span>
                      <span className="text-[var(--w-text-muted)]"> / {item.receivedQty}</span>
                    </td>
                    <td className="text-center px-2">
                      <div className="flex items-center justify-center gap-1">
                        <ModeDropdown value={mode} onChange={m => setItemMode(item.itemId, m)} />
                        <button
                          onClick={() => applyForItem(item)}
                          disabled={!canAutoDistribute}
                          className="p-1 rounded hover:bg-[var(--w-hover)] text-[var(--w-text-muted)] hover:text-[var(--w-text)] transition-colors disabled:opacity-30"
                          title="Répartir cet article"
                        >
                          <Split className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Dispatch rows (mobile) ── */}
        <div className="sm:hidden">
          {items.map(item => {
            const v = validation.perItem[item.itemId];
            const mode = getItemMode(item.itemId);
            return (
              <div key={item.itemId} className="border-b border-[var(--w-separator)] px-4 py-3 space-y-2">
                <div className="text-sm font-medium text-[var(--w-text)] break-words">{item.name}</div>
                {item.supplierRef && <div className="text-[10px] text-[var(--w-text-muted)] font-mono">{item.supplierRef}</div>}

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-[var(--w-text-muted)]">Reçu</span>
                    <span className="text-sm font-semibold text-[var(--w-text)] num">{item.receivedQty}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <ModeDropdown value={mode} onChange={m => setItemMode(item.itemId, m)} compact />
                    <button
                      onClick={() => applyForItem(item)}
                      disabled={!canAutoDistribute}
                      className="inline-flex items-center gap-1 h-6 px-2 text-[10px] font-medium text-[var(--w-text)] border border-[var(--w-separator)] rounded hover:bg-[var(--w-hover)] transition-colors disabled:opacity-30"
                      title="Répartir"
                    >
                      <Split className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {selectedDests.map(d => {
                    const val = dispatchData[item.itemId]?.[d.id] || 0;
                    const stock = getStock(item.articleId, d.id);
                    return (
                      <div key={d.id} className="flex items-center gap-2">
                        <span className="text-xs text-[var(--w-text-secondary)] flex-1 truncate">{d.name}</span>
                        <input
                          type="number" min={0} value={val}
                          onChange={e => updateCell(item.itemId, d.id, Number(e.target.value) || 0)}
                          className={ulInput + ' w-20'}
                        />
                        {stock !== null && (
                          <span className="text-[9px] text-[var(--w-text-muted)] tabular-nums w-16 text-right shrink-0">
                            {stock}→{stock + val}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="text-[11px] font-medium">
                  {v?.valid ? (
                    <span className="text-emerald-600 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> {v.allocated}/{item.receivedQty}
                    </span>
                  ) : (
                    <span className="text-red-500">{v?.allocated || 0}/{item.receivedQty} — incomplet</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Fixed footer ── */}
      <div className="border-t border-[var(--w-separator)] px-4 py-2 flex items-center justify-between gap-2 flex-shrink-0">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--w-text-muted)] hover:text-[var(--w-text)] hover:bg-[var(--w-surface)] rounded transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Retour
        </button>
        <button
          onClick={onConfirm}
          disabled={saving || !validation.allValid}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-[var(--w-accent-text)] bg-[var(--w-accent)] border border-[var(--w-accent-border)] rounded hover:bg-[var(--w-accent-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Truck className="w-3.5 h-3.5" />}
          Confirmer la réception
        </button>
      </div>
    </div>
  );
}
