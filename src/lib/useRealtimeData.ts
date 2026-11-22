import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';

export function useRealtimeRefresh(tables: readonly string[], refresh: () => void | Promise<unknown>, enabled = true) {
  const { onDataChange } = useApp();
  const latest = useRef(refresh);
  latest.current = refresh;
  const tableKey = tables.join(',');

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let running = false;
    let repeat = false;

    const update = async () => {
      if (running) { repeat = true; return; }
      running = true;
      try {
        do {
          repeat = false;
          try { await latest.current(); } catch { /* the next event can retry */ }
        } while (!disposed && repeat);
      } finally {
        running = false;
      }
    };

    const unsubscribe = onDataChange(tableKey.split(','), () => { void update(); });
    return () => { disposed = true; unsubscribe(); };
  }, [onDataChange, tableKey, enabled]);
}

export function useRealtimeTick(tables: readonly string[], enabled = true) {
  const [tick, setTick] = useState(0);
  useRealtimeRefresh(tables, () => setTick(value => value + 1), enabled);
  return tick;
}
