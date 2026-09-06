import { createContext, useContext, useCallback, useState, useRef, type ReactNode } from 'react';
import { setNavContext, type NavContext } from '../lib/navHighlight';
import type { QuickActionNavTarget } from '../lib/quickActionsRegistry';

type DispatchFn = (target: QuickActionNavTarget, route: string) => void;

interface QuickActionContextValue {
  dispatch: DispatchFn;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
}

const Ctx = createContext<QuickActionContextValue>({
  dispatch: () => {},
  panelOpen: false,
  setPanelOpen: () => {},
});

export function QuickActionProvider({ children, onNavigate }: { children: ReactNode; onNavigate: (route: string) => void }) {
  const [panelOpen, setPanelOpen] = useState(false);
  const currentRouteRef = useRef('');

  const dispatch: DispatchFn = useCallback((target, route) => {
    setPanelOpen(false);

    setNavContext({ target: target as NavContext['target'] } as NavContext);

    if (currentRouteRef.current === route) {
      // Already on the target page — fire a storage event so the page re-consumes
      window.dispatchEvent(new CustomEvent('waarwi:quickaction', { detail: { target } }));
    } else {
      onNavigate(route);
    }
  }, [onNavigate]);

  return (
    <Ctx.Provider value={{ dispatch, panelOpen, setPanelOpen }}>
      {children}
    </Ctx.Provider>
  );
}

export function useQuickAction() {
  return useContext(Ctx);
}

export function useQuickActionCurrentRoute(route: string) {
  const ctx = useContext(Ctx);
  const ref = useRef('');
  ref.current = route;
  // Keep the ref in sync — provider reads it via closure
  // We use a simpler approach: the provider stores nothing, we fire custom events
}
