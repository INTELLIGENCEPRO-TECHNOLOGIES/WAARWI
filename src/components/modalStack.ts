import { useEffect, useRef, useState } from 'react';

// Shared stack for "top-layer" modals opened above the desktop window system.
// Each entry represents one open modal; the last entry is the visible top.
// The base z-index sits above WindowTaskbar (z-[9999]) and every DesktopWindow.
const BASE_Z = 10010;
const stack: symbol[] = [];
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function useTopLayer(open: boolean): { isTop: boolean; zIndex: number } {
  const idRef = useRef<symbol | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    if (!open) return;
    const id = Symbol('modal');
    idRef.current = id;
    stack.push(id);
    notify();
    const listener = () => force((t) => t + 1);
    listeners.add(listener);
    return () => {
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
      listeners.delete(listener);
      idRef.current = null;
      notify();
    };
  }, [open]);

  if (!open || !idRef.current) return { isTop: false, zIndex: BASE_Z };
  const idx = stack.indexOf(idRef.current);
  const isTop = idx === stack.length - 1;
  return { isTop, zIndex: BASE_Z + Math.max(0, idx) * 10 };
}
