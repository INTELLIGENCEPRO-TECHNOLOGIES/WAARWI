import { createContext, useContext, useCallback, useState, type ReactNode } from 'react';

export type WinState = {
  id: string;
  title: string;
  minimized: boolean;
  zIndex: number;
  rect: { x: number; y: number; w: number; h: number };
  icon?: ReactNode;
  siteId?: string;
  background?: boolean;
  groupId?: string;
};

type Ctx = {
  windows: WinState[];
  register: (id: string, title: string, rect?: Partial<WinState['rect']>, icon?: ReactNode, siteId?: string, background?: boolean, groupId?: string) => void;
  unregister: (id: string) => void;
  focus: (id: string) => void;
  minimize: (id: string) => void;
  minimizeAll: () => void;
  minimizeGroup: (groupId: string) => void;
  restore: (id: string) => void;
  updateRect: (id: string, rect: Partial<WinState['rect']>) => void;
  updateTitle: (id: string, title: string) => void;
  tileVisibleWindows: () => void;
  topZ: number;
};

const WindowManagerContext = createContext<Ctx | null>(null);

export function useWindowManager() {
  const ctx = useContext(WindowManagerContext);
  if (!ctx) throw new Error('useWindowManager must be inside WindowManagerProvider');
  return ctx;
}

export function getWorkArea() {
  const cs = getComputedStyle(document.documentElement);
  const sidebar = parseInt(cs.getPropertyValue('--w-sidebar-w')) || 0;
  const topbar = parseInt(cs.getPropertyValue('--w-topbar-h')) || 56;
  const taskbar = parseInt(cs.getPropertyValue('--w-taskbar-h')) || 0;
  const x = sidebar;
  const y = topbar;
  const w = Math.max(320, window.innerWidth - sidebar);
  const h = Math.max(240, window.innerHeight - topbar - taskbar);
  return { x, y, w, h };
}

export function WindowManagerProvider({ children }: { children: ReactNode }) {
  const [windows, setWindows] = useState<WinState[]>([]);
  const [topZ, setTopZ] = useState(100);

  const register = useCallback((id: string, title: string, rect?: Partial<WinState['rect']>, icon?: ReactNode, siteId?: string, background?: boolean, groupId?: string) => {
    setWindows(prev => {
      if (prev.find(w => w.id === id)) return prev;
      const nextZ = Math.max(100, ...prev.map(w => w.zIndex)) + 1;
      setTopZ(nextZ);
      const wa = getWorkArea();
      const defaultW = Math.min(1200, wa.w - 40);
      const defaultH = Math.min(800, wa.h - 40);
      return [...prev, {
        id,
        title,
        minimized: false,
        zIndex: nextZ,
        rect: {
          x: rect?.x ?? Math.max(wa.x + 20, wa.x + (wa.w - defaultW) / 2),
          y: rect?.y ?? Math.max(wa.y + 20, wa.y + (wa.h - defaultH) / 2),
          w: rect?.w ?? defaultW,
          h: rect?.h ?? defaultH,
        },
        icon,
        siteId,
        background,
        groupId,
      }];
    });
  }, []);

  const unregister = useCallback((id: string) => {
    setWindows(prev => prev.filter(w => w.id !== id));
  }, []);

  const focus = useCallback((id: string) => {
    setWindows(prev => {
      const maxZ = Math.max(100, ...prev.map(w => w.zIndex));
      const target = prev.find(w => w.id === id);
      if (!target || target.zIndex === maxZ) return prev;
      const nextZ = maxZ + 1;
      setTopZ(nextZ);
      return prev.map(w => w.id === id ? { ...w, zIndex: nextZ, minimized: false } : w);
    });
  }, []);

  const minimize = useCallback((id: string) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, minimized: true } : w));
  }, []);

  const minimizeAll = useCallback(() => {
    setWindows(prev => prev.map(w => w.minimized ? w : { ...w, minimized: true }));
  }, []);

  const minimizeGroup = useCallback((groupId: string) => {
    setWindows(prev => prev.map(w => (w.groupId === groupId && !w.minimized) ? { ...w, minimized: true } : w));
  }, []);

  const restore = useCallback((id: string) => {
    focus(id);
    setWindows(prev => prev.map(w => w.id === id ? { ...w, minimized: false } : w));
  }, [focus]);

  const updateRect = useCallback((id: string, rect: Partial<WinState['rect']>) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, rect: { ...w.rect, ...rect } } : w));
  }, []);

  const updateTitle = useCallback((id: string, title: string) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, title } : w));
  }, []);

  const tileVisibleWindows = useCallback(() => {
    setWindows(prev => {
      const bg = prev.filter(w => !w.minimized && w.background).map(w => w.id);
      const visible = prev.filter(w => !w.minimized && !w.background);
      if (visible.length < 2 && bg.length === 0) return prev;
      if (visible.length < 2) return prev.map(w => bg.includes(w.id) ? { ...w, minimized: true } : w);
      const wa = getWorkArea();
      const gap = 8;
      let cols: number, rows: number;
      if (visible.length === 2) { cols = 2; rows = 1; }
      else if (visible.length <= 4) { cols = 2; rows = Math.ceil(visible.length / 2); }
      else { cols = Math.ceil(Math.sqrt(visible.length)); rows = Math.ceil(visible.length / cols); }
      const cellW = Math.floor((wa.w - gap * (cols + 1)) / cols);
      const cellH = Math.floor((wa.h - gap * (rows + 1)) / rows);
      let baseZ = Math.max(100, ...prev.map(w => w.zIndex)) + 1;
      const idToRect = new Map<string, { rect: WinState['rect']; zIndex: number }>();
      visible.forEach((w, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        idToRect.set(w.id, {
          rect: { x: wa.x + gap + col * (cellW + gap), y: wa.y + gap + row * (cellH + gap), w: cellW, h: cellH },
          zIndex: baseZ + i,
        });
      });
      setTopZ(baseZ + visible.length);
      return prev.map(w => {
        if (bg.includes(w.id)) return { ...w, minimized: true };
        const t = idToRect.get(w.id);
        return t ? { ...w, rect: t.rect, zIndex: t.zIndex, minimized: false } : w;
      });
    });
  }, []);

  return (
    <WindowManagerContext.Provider value={{ windows, register, unregister, focus, minimize, minimizeAll, minimizeGroup, restore, updateRect, updateTitle, tileVisibleWindows, topZ }}>
      {children}
    </WindowManagerContext.Provider>
  );
}
