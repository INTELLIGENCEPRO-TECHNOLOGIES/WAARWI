import { type ReactNode, useEffect, useRef, useCallback, useState } from 'react';
import { Minus, Maximize2, Minimize2, X, LayoutGrid } from 'lucide-react';
import { useWindowManager, getWorkArea } from '../context/WindowManagerContext';

type Props = {
  id: string;
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  initialRect?: { x?: number; y?: number; w?: number; h?: number };
  minW?: number;
  minH?: number;
  siteId?: string;
  background?: boolean;
  groupId?: string;
};

const HEADER_H = 38;
const MIN_W_DEFAULT = 480;
const MIN_H_DEFAULT = 320;

export function DesktopWindow({ id, title, icon, children, onClose, initialRect, minW = MIN_W_DEFAULT, minH = MIN_H_DEFAULT, siteId, background, groupId }: Props) {
  const { windows, register, unregister, focus, minimize, updateRect, tileVisibleWindows } = useWindowManager();
  const win = windows.find(w => w.id === id);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const resizing = useRef<string | null>(null);
  const dragStart = useRef({ mx: 0, my: 0, wx: 0, wy: 0, ww: 0, wh: 0 });

  const [maximized, setMaximized] = useState(false);
  const preMaxRect = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => {
    register(id, title, initialRect, icon, siteId, background, groupId);
    return () => unregister(id);
  }, [id]);

  const clamp = useCallback((rect: { x: number; y: number; w: number; h: number }) => {
    const wa = getWorkArea();
    const maxW = wa.w - 8;
    const maxH = wa.h - 8;
    const w = Math.max(minW, Math.min(rect.w, maxW));
    const h = Math.max(minH, Math.min(rect.h, maxH));
    const x = Math.max(wa.x, Math.min(rect.x, wa.x + wa.w - Math.min(120, w)));
    const y = Math.max(wa.y, Math.min(rect.y, wa.y + wa.h - 60));
    return { w, h, x, y };
  }, [minW, minH]);

  // Recalculate bounds on viewport / sidebar changes
  useEffect(() => {
    const recalc = () => {
      if (!win) return;
      if (maximized) { updateRect(id, maxRect()); return; }
      updateRect(id, clamp(win.rect));
    };
    window.addEventListener('resize', recalc);
    const mo = new MutationObserver(recalc);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    return () => { window.removeEventListener('resize', recalc); mo.disconnect(); };
  }, [id, win, maximized, clamp, updateRect]);

  const maxRect = () => {
    const wa = getWorkArea();
    return { x: wa.x, y: wa.y, w: wa.w, h: wa.h };
  };

  const onPointerDownHeader = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    focus(id);
    if (maximized) return;
    dragging.current = true;
    const r = win?.rect || { x: 0, y: 0, w: 800, h: 600 };
    dragStart.current = { mx: e.clientX, my: e.clientY, wx: r.x, wy: r.y, ww: r.w, wh: r.h };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [id, focus, win, maximized]);

  const onPointerMoveHeader = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - dragStart.current.mx;
    const dy = e.clientY - dragStart.current.my;
    updateRect(id, clamp({
      x: dragStart.current.wx + dx,
      y: dragStart.current.wy + dy,
      w: dragStart.current.ww,
      h: dragStart.current.wh,
    }));
  }, [id, updateRect, clamp]);

  const onPointerUpHeader = useCallback(() => { dragging.current = false; }, []);

  const onResizePointerDown = useCallback((edge: string, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    focus(id);
    if (maximized) return;
    resizing.current = edge;
    const r = win?.rect || { x: 0, y: 0, w: 800, h: 600 };
    dragStart.current = { mx: e.clientX, my: e.clientY, wx: r.x, wy: r.y, ww: r.w, wh: r.h };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [id, focus, win, maximized]);

  const onResizePointerMove = useCallback((e: React.PointerEvent) => {
    if (!resizing.current) return;
    const dx = e.clientX - dragStart.current.mx;
    const dy = e.clientY - dragStart.current.my;
    const s = dragStart.current;
    const edge = resizing.current;
    let { x, y, w, h } = { x: s.wx, y: s.wy, w: s.ww, h: s.wh };

    if (edge.includes('e')) w = s.ww + dx;
    if (edge.includes('w')) { w = s.ww - dx; x = s.wx + dx; }
    if (edge.includes('s')) h = s.wh + dy;
    if (edge.includes('n')) { h = s.wh - dy; y = s.wy + dy; }

    updateRect(id, clamp({ x, y, w, h }));
  }, [id, updateRect, clamp]);

  const onResizePointerUp = useCallback(() => { resizing.current = null; }, []);

  const toggleMaximize = useCallback(() => {
    if (maximized) {
      if (preMaxRect.current) updateRect(id, clamp(preMaxRect.current));
      setMaximized(false);
    } else {
      preMaxRect.current = win?.rect || null;
      updateRect(id, maxRect());
      setMaximized(true);
    }
  }, [maximized, id, updateRect, win, clamp]);

  const onDoubleClickHeader = useCallback(() => toggleMaximize(), [toggleMaximize]);

  if (!win) return null;

  const { x, y, w, h } = maximized ? maxRect() : win.rect;

  const edgeCls = 'absolute z-10';
  const cornerSize = 12;
  const edgeThick = 5;

  return (
    <div
      ref={containerRef}
      className="fixed flex flex-col shadow-2xl bg-[var(--w-surface)] border border-[var(--w-separator)] overflow-hidden"
      style={{
        left: x, top: y, width: w, height: h,
        zIndex: win.zIndex,
        borderRadius: maximized ? 0 : 10,
        display: win.minimized ? 'none' : undefined,
      }}
      onPointerDown={() => focus(id)}
    >
      {/* Title bar */}
      <div
        className="flex items-center gap-2 px-3 bg-[var(--w-surface-el)] border-b border-[var(--w-separator)] select-none shrink-0 cursor-grab active:cursor-grabbing"
        style={{ height: HEADER_H }}
        onPointerDown={onPointerDownHeader}
        onPointerMove={onPointerMoveHeader}
        onPointerUp={onPointerUpHeader}
        onDoubleClick={onDoubleClickHeader}
      >
        {icon && <span className="text-[var(--w-text-muted)] flex-shrink-0 [&>svg]:w-4 [&>svg]:h-4">{icon}</span>}
        <span className="text-sm font-semibold text-[var(--w-text)] truncate flex-1">{title}</span>
        {windows.filter(w => !w.minimized).length >= 2 && (
          <button onClick={tileVisibleWindows} className="p-1 rounded hover:bg-[var(--w-hover)] text-[var(--w-text-muted)] transition-colors" title="Répartir les fenêtres">
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
        )}
        <button onClick={() => minimize(id)} className="p-1 rounded hover:bg-[var(--w-hover)] text-[var(--w-text-muted)] transition-colors" title="Réduire">
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button onClick={toggleMaximize} className="p-1 rounded hover:bg-[var(--w-hover)] text-[var(--w-text-muted)] transition-colors" title={maximized ? 'Restaurer' : 'Agrandir'}>
          {maximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
        <button onClick={onClose} className="p-1 rounded hover:bg-red-500/20 text-[var(--w-text-muted)] hover:text-red-500 transition-colors" title="Fermer">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>

      {/* Resize edges (hidden when maximized) */}
      {!maximized && <>
        <div className={`${edgeCls} top-0 left-[${cornerSize}px] right-[${cornerSize}px] cursor-n-resize`} style={{ height: edgeThick, left: cornerSize, right: cornerSize }}
          onPointerDown={e => onResizePointerDown('n', e)} onPointerMove={onResizePointerMove} onPointerUp={onResizePointerUp} />
        <div className={`${edgeCls} bottom-0 cursor-s-resize`} style={{ height: edgeThick, left: cornerSize, right: cornerSize }}
          onPointerDown={e => onResizePointerDown('s', e)} onPointerMove={onResizePointerMove} onPointerUp={onResizePointerUp} />
        <div className={`${edgeCls} left-0 top-[${cornerSize}px] bottom-[${cornerSize}px] cursor-w-resize`} style={{ width: edgeThick, top: cornerSize, bottom: cornerSize }}
          onPointerDown={e => onResizePointerDown('w', e)} onPointerMove={onResizePointerMove} onPointerUp={onResizePointerUp} />
        <div className={`${edgeCls} right-0 cursor-e-resize`} style={{ width: edgeThick, top: cornerSize, bottom: cornerSize }}
          onPointerDown={e => onResizePointerDown('e', e)} onPointerMove={onResizePointerMove} onPointerUp={onResizePointerUp} />
        {/* Corners */}
        <div className={`${edgeCls} top-0 left-0 cursor-nw-resize`} style={{ width: cornerSize, height: cornerSize }}
          onPointerDown={e => onResizePointerDown('nw', e)} onPointerMove={onResizePointerMove} onPointerUp={onResizePointerUp} />
        <div className={`${edgeCls} top-0 right-0 cursor-ne-resize`} style={{ width: cornerSize, height: cornerSize }}
          onPointerDown={e => onResizePointerDown('ne', e)} onPointerMove={onResizePointerMove} onPointerUp={onResizePointerUp} />
        <div className={`${edgeCls} bottom-0 left-0 cursor-sw-resize`} style={{ width: cornerSize, height: cornerSize }}
          onPointerDown={e => onResizePointerDown('sw', e)} onPointerMove={onResizePointerMove} onPointerUp={onResizePointerUp} />
        <div className={`${edgeCls} bottom-0 right-0 cursor-se-resize`} style={{ width: cornerSize, height: cornerSize }}
          onPointerDown={e => onResizePointerDown('se', e)} onPointerMove={onResizePointerMove} onPointerUp={onResizePointerUp} />
      </>}
    </div>
  );
}

export function WindowTaskbar({ onBeforeRestore, activeSiteId }: { onBeforeRestore?: (id: string) => void; activeSiteId?: string } = {}) {
  const { windows, restore, focus } = useWindowManager();

  // Groups whose parent (a non-minimized window with id === groupId + '-page') is currently visible
  // are hidden from the global taskbar; those children live in the parent window's internal strip.
  const hiddenGroups = new Set<string>();
  for (const w of windows) {
    if (!w.groupId) continue;
    const parentId = `${w.groupId}-page`;
    const parent = windows.find(p => p.id === parentId);
    if (parent && !parent.minimized) hiddenGroups.add(w.groupId);
  }

  const minimized = windows.filter(w => {
    if (!w.minimized) return false;
    if (w.groupId && hiddenGroups.has(w.groupId)) return false;
    if (activeSiteId && w.siteId && w.siteId !== activeSiteId) return false;
    return true;
  });
  if (minimized.length === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 h-10 bg-[var(--w-surface-el)]/95 backdrop-blur-md border-t border-[var(--w-separator)] flex items-center gap-1 px-2 z-[9999]">
      {minimized.map(w => (
        <button
          key={w.id}
          onClick={() => { onBeforeRestore?.(w.id); restore(w.id); focus(w.id); }}
          className="flex items-center gap-1.5 px-3 h-7 rounded-md bg-[var(--w-hover)] hover:bg-[var(--w-active)] text-xs font-medium text-[var(--w-text)] transition-colors truncate max-w-[200px]"
        >
          {w.icon && <span className="[&>svg]:w-3.5 [&>svg]:h-3.5 text-[var(--w-text-muted)]">{w.icon}</span>}
          <span className="truncate">{w.title}</span>
        </button>
      ))}
    </div>
  );
}
