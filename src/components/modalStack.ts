import { useLayoutEffect, useRef, useState } from 'react';

// Top layers are above both the window manager and its taskbar (z-index 9999).
const TOP_Z = 10010;
const BASE_Z = 50;
const topStack: symbol[] = [];
const baseStack: symbol[] = [];
const listeners = new Set<() => void>();
let scrollLocks = 0;

function useLayer(open: boolean, layer: 'base' | 'top'): { isTop: boolean; zIndex: number } {
  const stack = layer === 'top' ? topStack : baseStack;
  const start = layer === 'top' ? TOP_Z : BASE_Z;
  const idRef = useRef<symbol | null>(null);
  const [, refresh] = useState(0);

  useLayoutEffect(() => {
    if (!open) return;
    const id = Symbol(layer);
    idRef.current = id;
    stack.push(id);
    const listener = () => refresh(version => version + 1);
    listeners.add(listener);
    listeners.forEach(update => update());

    return () => {
      const index = stack.indexOf(id);
      if (index >= 0) stack.splice(index, 1);
      listeners.delete(listener);
      idRef.current = null;
      listeners.forEach(update => update());
    };
  }, [open, layer, stack]);

  const index = idRef.current ? stack.indexOf(idRef.current) : -1;
  const isTop = open && index >= 0 && index === stack.length - 1 && (layer === 'top' || !topStack.length);
  return { isTop, zIndex: start + Math.max(0, index) * (layer === 'top' ? 10 : 1) };
}

export function useTopLayer(open: boolean) {
  return useLayer(open, 'top');
}

export function useBaseLayer(open: boolean) {
  return useLayer(open, 'base');
}

export function useBodyScrollLock(open: boolean) {
  useLayoutEffect(() => {
    if (!open) return;
    const body = document.body;
    scrollLocks += 1;
    body.setAttribute('data-waarwi-scroll-lock', '');

    return () => {
      scrollLocks -= 1;
      if (!scrollLocks) body.removeAttribute('data-waarwi-scroll-lock');
    };
  }, [open]);
}
