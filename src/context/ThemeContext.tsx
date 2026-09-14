import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

type ThemeCtx = {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (m: ThemeMode, clickCoords?: { x: number; y: number }) => void;
};

const STORAGE_KEY = 'waarwi:theme';

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolve(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? getSystemTheme() : mode;
}

function applyTheme(resolved: ResolvedTheme) {
  document.documentElement.setAttribute('data-theme', resolved);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#111111' : '#ffffff');
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const Ctx = createContext<ThemeCtx>({ mode: 'light', resolved: 'light', setMode: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'dark' || stored === 'light' || stored === 'system') return stored;
    } catch {}
    return 'light';
  });
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(mode));
  const isInitial = useRef(true);

  const setMode = useCallback((m: ThemeMode, clickCoords?: { x: number; y: number }) => {
    const r = resolve(m);
    const oldResolved = resolve(mode);
    const themeActuallyChanges = r !== oldResolved;

    const commit = () => {
      setModeState(m);
      try { localStorage.setItem(STORAGE_KEY, m); } catch {}
      setResolved(r);
      applyTheme(r);
    };

    if (
      !themeActuallyChanges ||
      isInitial.current ||
      prefersReducedMotion() ||
      !(document as any).startViewTransition
    ) {
      commit();
      return;
    }

    const x = clickCoords?.x ?? window.innerWidth / 2;
    const y = clickCoords?.y ?? 48;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );

    document.documentElement.style.setProperty('--vt-x', `${x}px`);
    document.documentElement.style.setProperty('--vt-y', `${y}px`);
    document.documentElement.style.setProperty('--vt-r', `${endRadius}px`);

    const transition = (document as any).startViewTransition(commit);
    transition.ready.then(() => {
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${endRadius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 450,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          pseudoElement: '::view-transition-new(root)',
        },
      );
    }).catch(() => {});
  }, [mode]);

  useEffect(() => {
    const r = resolve(mode);
    setResolved(r);
    applyTheme(r);
    isInitial.current = false;
  }, []);

  useEffect(() => {
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const r = getSystemTheme();
      setResolved(r);
      applyTheme(r);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode]);

  return <Ctx.Provider value={{ mode, resolved, setMode }}>{children}</Ctx.Provider>;
}

export function useTheme() { return useContext(Ctx); }
