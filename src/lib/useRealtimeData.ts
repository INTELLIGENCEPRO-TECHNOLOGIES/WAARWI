import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { useAccountingWindowVisible } from '../context/AccountingWindowContext';

export function useRealtimeRefresh(tables: readonly string[], refresh: () => void | Promise<unknown>, enabled = true) {
  const { onDataChange } = useApp();
  const visible=useAccountingWindowVisible();
  const scoped=visible!==null;
  const visibility=useRef(visible);
  visibility.current=visible;
  const pending=useRef(false);
  const flush=useRef<()=>void>(()=>{});
  const latest = useRef(refresh);
  latest.current = refresh;
  const tableKey = tables.join(',');

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let running = false;
    let repeat = false;
    let timer:ReturnType<typeof setTimeout>|undefined;

    const update = async () => {
      if(disposed)return;
      if(scoped&&visibility.current===false){pending.current=true;return;}
      if (running) { repeat = true; return; }
      running = true;
      try {
        do {
          repeat = false;
          if(scoped&&visibility.current===false){pending.current=true;break;}
          pending.current=false;
          try { await latest.current(); } catch { /* the next event can retry */ }
        } while (!disposed && repeat);
      } finally {
        running = false;
      }
    };

    const schedule=()=>{
      if(!scoped){void update();return;}
      if(visibility.current===false){pending.current=true;return;}
      if(timer!==undefined)return;
      timer=setTimeout(()=>{timer=undefined;void update();},150);
    };
    flush.current=schedule;
    const unsubscribe = onDataChange(tableKey.split(','), schedule);
    return () => { disposed = true; if(timer!==undefined)clearTimeout(timer);flush.current=()=>{};pending.current=false;unsubscribe(); };
  }, [onDataChange, tableKey, enabled,scoped]);
  useEffect(()=>{if(enabled&&visible===true&&pending.current)flush.current();},[enabled,visible]);
}

export function useRealtimeTick(tables: readonly string[], enabled = true) {
  const [tick, setTick] = useState(0);
  useRealtimeRefresh(tables, () => setTick(value => value + 1), enabled);
  return tick;
}
