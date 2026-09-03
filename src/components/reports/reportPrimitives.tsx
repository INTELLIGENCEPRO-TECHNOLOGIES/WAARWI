import type { ReactNode } from 'react';

// ── Metric strip (no cards, thin separators) ──────────────────────────────────

export type Metric = { label: string; value: ReactNode; hint?: string };

export function MetricStrip({ items }: { items: Metric[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 border-t border-neutral-900">
      {items.map((m, i) => {
        const cls = [
          'px-3 py-3 md:px-4',
          i % 2 !== 0 ? 'border-l border-neutral-200' : '',
          i >= 2 ? 'border-t border-neutral-200 md:border-t-0' : '',
          i % 4 !== 0 ? 'md:border-l md:border-neutral-200' : 'md:border-l-0',
        ].join(' ');
        return (
          <div key={i} className={cls}>
            <div className="text-[11px] leading-tight text-neutral-500">{m.label}</div>
            <div className="mt-1 text-[17px] md:text-[19px] font-bold text-neutral-900 tabular-nums leading-tight break-words">
              {m.value}
            </div>
            {m.hint && <div className="mt-0.5 text-[11px] text-neutral-400 leading-tight">{m.hint}</div>}
          </div>
        );
      })}
    </div>
  );
}

// ── Section title ─────────────────────────────────────────────────────────────

export function SectionTitle({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <div className="mt-7 mb-2 flex items-end justify-between gap-3 border-b border-neutral-900 pb-1">
      <h2 className="text-[13px] font-bold text-neutral-900 leading-tight">{children}</h2>
      {note && <span className="text-[11px] text-neutral-400 shrink-0">{note}</span>}
    </div>
  );
}

// ── Table primitives ──────────────────────────────────────────────────────────

export const thCls = 'text-[11px] font-semibold text-neutral-500 py-2 px-2 border-b border-neutral-900 whitespace-nowrap text-left';
export const thR = thCls + ' text-right';
export const thC = thCls + ' text-center';
export const tdCls = 'text-[12px] text-neutral-800 py-2 px-2 border-b border-neutral-100 align-middle';
export const tdR = tdCls + ' text-right tabular-nums';
export const tdC = tdCls + ' text-center tabular-nums';
export const tdMuted = tdCls + ' text-neutral-400';
export const totalTd = 'text-[12px] font-bold text-neutral-900 py-2 px-2 border-t border-neutral-900';
export const totalTdR = totalTd + ' text-right tabular-nums';

export function ReportTable({ children, minWidth }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
      <table className="w-full border-collapse" style={minWidth ? { minWidth } : undefined}>
        {children}
      </table>
    </div>
  );
}

export function AmountNote() {
  return <div className="text-[11px] text-neutral-400 mb-1">Montants en FCFA</div>;
}

export const DASH = '—';

// ── Monochrome daily bar chart ────────────────────────────────────────────────

export function DailyBars({ data }: { data: { date: string; value: number; label?: string }[] }) {
  if (data.length < 2) return null;
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  const H = 96;
  return (
    <div className="border-t border-neutral-200 pt-3">
      <div className="flex items-end gap-[3px] overflow-x-auto no-scrollbar" style={{ height: H }}>
        {data.map((d, i) => {
          const h = Math.max(1, Math.round((Math.abs(d.value) / max) * (H - 8)));
          const neg = d.value < 0;
          return (
            <div key={i} className="flex-1 min-w-[6px] flex flex-col justify-end h-full" title={`${d.label || d.date}`}>
              <div
                className={neg ? 'w-full bg-neutral-300' : 'w-full bg-neutral-800'}
                style={{ height: h }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Loading skeleton (discrete gray lines, no big spinner) ─────────────────────

export function ReportSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="grid grid-cols-2 md:grid-cols-4 border-t border-neutral-900">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`px-3 py-3 md:px-4 ${i % 2 !== 0 ? 'border-l border-neutral-200' : ''} ${i >= 2 ? 'border-t border-neutral-200 md:border-t-0' : ''} ${i % 4 !== 0 ? 'md:border-l' : ''}`}>
            <div className="h-2.5 w-16 bg-neutral-200 rounded" />
            <div className="mt-2 h-4 w-24 bg-neutral-200 rounded" />
          </div>
        ))}
      </div>
      <div className="mt-7 h-3 w-40 bg-neutral-200 rounded" />
      <div className="mt-3 border-b border-neutral-200" />
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-2.5 border-b border-neutral-100">
          <div className="h-2.5 flex-1 bg-neutral-100 rounded" />
          <div className="h-2.5 w-16 bg-neutral-100 rounded" />
          <div className="h-2.5 w-16 bg-neutral-100 rounded" />
        </div>
      ))}
    </div>
  );
}
