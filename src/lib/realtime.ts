import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type DataChanges = ReadonlySet<string>;

export function includesChanges(changes: DataChanges, tables: readonly string[]) {
  return changes.has('*') || tables.some(table => changes.has(table));
}

export function subscribeToDataChanges(topics: readonly string[], onChange: (changes: DataChanges) => void) {
  let stopped = false;
  let timer: number | undefined;
  const ready = new Set<string>();
  const joined = new Set<string>();
  const queued = new Set<string>();

  const enqueue = (table: string) => {
    if (stopped) return;
    queued.add(table);
    if (timer !== undefined) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      const changes = new Set(queued);
      queued.clear();
      onChange(changes);
    }, 180);
  };

  const channels = new Map<string, RealtimeChannel>();
  let connecting = false;
  const join = async () => {
    if (stopped || connecting || channels.size === topics.length) return;
    connecting = true;
    try {
      await supabase.realtime.setAuth();
      if (stopped) return;
      for (const topic of topics) {
        if (channels.has(topic)) continue;
        const channel = supabase.channel(topic, { config: { private: true } });
        channels.set(topic, channel);
        channel.on('broadcast', { event: 'data_changed' }, ({ payload }) => {
          if (typeof payload?.table === 'string' && /^[a-z_][a-z_0-9]*$/.test(payload.table)) {
            enqueue(payload.table);
          }
        }).subscribe(status => {
          if (stopped) return;
          if (status === 'SUBSCRIBED') {
            if (joined.has(topic) && !ready.has(topic)) enqueue('*');
            joined.add(topic);
            ready.add(topic);
          } else {
            ready.delete(topic);
            if (status === 'CLOSED') channels.delete(topic);
          }
        });
      }
    } catch {
      // Without a session or connection, the next catch-up will retry joining.
    } finally {
      connecting = false;
    }
  };
  void join();

  const catchUp = () => {
    if (document.hidden || !navigator.onLine) return;
    if (channels.size < topics.length) void join();
    enqueue('*');
  };
  const fallback = window.setInterval(() => {
    if (ready.size < topics.length) catchUp();
  }, 20000);
  document.addEventListener('visibilitychange', catchUp);
  window.addEventListener('online', catchUp);
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    window.clearInterval(fallback);
    document.removeEventListener('visibilitychange', catchUp);
    window.removeEventListener('online', catchUp);
    channels.forEach(channel => { void supabase.removeChannel(channel); });
  };
}
