import { useEffect, useState, type ReactNode } from 'react';
import { X, ChevronLeft, ChevronRight, RotateCcw, Check } from 'lucide-react';

export function PremiumDateRangePicker({ open, onClose, from, to, onApply, extraFilters, onReset }: {
  open: boolean; onClose: () => void; from: string; to: string;
  onApply: (from: string, to: string) => void;
  extraFilters?: ReactNode;
  onReset?: () => void;
}) {
  const [leftMonth, setLeftMonth] = useState(() => {
    const d = from ? new Date(from) : new Date();
    return new Date(d.getFullYear(), d.getMonth() - 1, 1);
  });
  const [rightMonth, setRightMonth] = useState(() => {
    const d = to ? new Date(to) : (from ? new Date(from) : new Date());
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [localFrom, setLocalFrom] = useState<string>(from);
  const [localTo, setLocalTo] = useState<string>(to);

  useEffect(() => {
    if (open) {
      setLocalFrom(from); setLocalTo(to);
      const r = to ? new Date(to) : (from ? new Date(from) : new Date());
      const l = from ? new Date(from) : new Date(r.getFullYear(), r.getMonth() - 1, 1);
      setLeftMonth(new Date(l.getFullYear(), l.getMonth(), 1));
      const rSame = from && to && new Date(from).getFullYear() === r.getFullYear() && new Date(from).getMonth() === r.getMonth();
      setRightMonth(rSame ? new Date(r.getFullYear(), r.getMonth() + 1, 1) : new Date(r.getFullYear(), r.getMonth(), 1));
    }
  }, [open, from, to]);

  if (!open) return null;

  const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const handleDayClick = (d: Date) => {
    const iso = toISO(d);
    if (!localFrom || (localFrom && localTo)) {
      setLocalFrom(iso); setLocalTo('');
    } else {
      const fd = new Date(localFrom);
      if (d < fd) { setLocalFrom(iso); setLocalTo(localFrom); }
      else setLocalTo(iso);
    }
  };

  const renderMonth = (base: Date) => {
    const y = base.getFullYear(), m = base.getMonth();
    const first = new Date(y, m, 1);
    const startDay = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < startDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(y, m, d));
    while (cells.length % 7 !== 0) cells.push(null);
    const today = new Date();
    const fromD = localFrom ? new Date(localFrom) : null;
    const toD = localTo ? new Date(localTo) : null;
    return (
      <div>
        <div className="grid grid-cols-7 gap-0.5 mb-1">
          {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => (
            <div key={i} className="text-center text-[9px] font-bold uppercase tracking-wider text-slate-400 py-1">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const isToday = sameDay(d, today);
            const isFrom = fromD && sameDay(d, fromD);
            const isTo = toD && sameDay(d, toD);
            const inRange = fromD && toD && d > fromD && d < toD;
            const isEnd = isFrom || isTo;
            return (
              <button key={i} onClick={() => handleDayClick(d)}
                className={`relative aspect-square flex items-center justify-center text-[11px] font-semibold rounded-lg transition-all
                  ${isEnd ? 'bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-glow scale-105 z-10' : ''}
                  ${inRange ? 'bg-brand-50 text-brand-800 rounded-none' : ''}
                  ${!isEnd && !inRange ? 'text-slate-700 hover:bg-slate-100' : ''}
                  ${isToday && !isEnd && !inRange ? 'ring-1 ring-brand-300 text-brand-700' : ''}
                  ${fromD && isEnd && toD && d < toD ? 'rounded-r-none' : ''}
                  ${toD && isEnd && fromD && d > fromD ? 'rounded-l-none' : ''}
                `}>
                {d.getDate()}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const monthLabel = (d: Date) => d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  const presets = [
    { l: "Aujourd'hui", f: () => { const t = new Date(); return { f: toISO(t), t: toISO(t) }; } },
    { l: '7 derniers jours', f: () => { const t = new Date(); const f = new Date(); f.setDate(t.getDate() - 6); return { f: toISO(f), t: toISO(t) }; } },
    { l: 'Ce mois', f: () => { const t = new Date(); const f = new Date(t.getFullYear(), t.getMonth(), 1); return { f: toISO(f), t: toISO(t) }; } },
    { l: '30 derniers jours', f: () => { const t = new Date(); const f = new Date(); f.setDate(t.getDate() - 29); return { f: toISO(f), t: toISO(t) }; } },
    { l: 'Mois dernier', f: () => { const t = new Date(); const first = new Date(t.getFullYear(), t.getMonth() - 1, 1); const last = new Date(t.getFullYear(), t.getMonth(), 0); return { f: toISO(first), t: toISO(last) }; } },
  ];

  const fmtLbl = (iso: string) => iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 animate-fade-in">
      <div className="absolute inset-0 bg-ink-900/60 backdrop-blur-md" onClick={onClose} />
      <div className={`relative w-full ${extraFilters ? 'max-w-4xl' : 'max-w-2xl'} bg-white rounded-3xl shadow-premium animate-scale-in flex flex-col max-h-[92vh] overflow-hidden`}>
        <div className="relative p-4 bg-gradient-to-br from-ink-900 via-slate-800 to-ink-900 text-white overflow-hidden shrink-0">
          <div className="absolute inset-0 shimmer-bg opacity-20" />
          <div className="relative flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-brand-400">Sélection de période</div>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <div className={`px-2.5 py-1 rounded-lg text-xs font-bold num transition-all ${localFrom ? 'bg-brand-500/30 ring-1 ring-brand-400/50' : 'bg-white/10'}`}>{fmtLbl(localFrom)}</div>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                <div className={`px-2.5 py-1 rounded-lg text-xs font-bold num transition-all ${localTo ? 'bg-brand-500/30 ring-1 ring-brand-400/50' : 'bg-white/10'}`}>{fmtLbl(localTo)}</div>
              </div>
            </div>
            <button onClick={onClose} className="w-8 h-8 shrink-0 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row flex-1 min-h-0 overflow-y-auto">
          <div className="lg:w-44 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-100 p-2 flex lg:flex-col gap-1 overflow-x-auto lg:overflow-x-visible">
            {presets.map(p => (
              <button key={p.l} onClick={() => { const r = p.f(); setLocalFrom(r.f); setLocalTo(r.t); const ld = new Date(r.f); const rd = new Date(r.t); setLeftMonth(new Date(ld.getFullYear(), ld.getMonth(), 1)); setRightMonth(ld.getMonth() === rd.getMonth() && ld.getFullYear() === rd.getFullYear() ? new Date(rd.getFullYear(), rd.getMonth() + 1, 1) : new Date(rd.getFullYear(), rd.getMonth(), 1)); }}
                className="shrink-0 lg:shrink px-3 py-2 rounded-xl text-[11px] font-semibold text-left text-slate-600 hover:bg-brand-50 hover:text-brand-800 transition whitespace-nowrap lg:whitespace-normal">
                {p.l}
              </button>
            ))}
          </div>

          <div className="flex-1 p-3 bg-gradient-to-br from-slate-50 to-white">
            <div className={`grid gap-3 ${extraFilters ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]' : 'grid-cols-1 sm:grid-cols-2'}`}>
              <div className="rounded-2xl bg-white border border-slate-200 p-3 shadow-elevated hover:shadow-premium transition-shadow">
                <div className="flex items-center justify-between mb-2">
                  <button onClick={() => setLeftMonth(new Date(leftMonth.getFullYear(), leftMonth.getMonth() - 1, 1))} className="w-7 h-7 rounded-xl hover:bg-brand-50 hover:text-brand-700 flex items-center justify-center text-slate-500 transition"><ChevronLeft className="w-3.5 h-3.5" /></button>
                  <div className="text-xs font-bold capitalize text-slate-800">{monthLabel(leftMonth)}</div>
                  <button onClick={() => setLeftMonth(new Date(leftMonth.getFullYear(), leftMonth.getMonth() + 1, 1))} className="w-7 h-7 rounded-xl hover:bg-brand-50 hover:text-brand-700 flex items-center justify-center text-slate-500 transition"><ChevronRight className="w-3.5 h-3.5" /></button>
                </div>
                {renderMonth(leftMonth)}
              </div>
              <div className="rounded-2xl bg-white border border-slate-200 p-3 shadow-elevated hover:shadow-premium transition-shadow">
                <div className="flex items-center justify-between mb-2">
                  <button onClick={() => setRightMonth(new Date(rightMonth.getFullYear(), rightMonth.getMonth() - 1, 1))} className="w-7 h-7 rounded-xl hover:bg-brand-50 hover:text-brand-700 flex items-center justify-center text-slate-500 transition"><ChevronLeft className="w-3.5 h-3.5" /></button>
                  <div className="text-xs font-bold capitalize text-slate-800">{monthLabel(rightMonth)}</div>
                  <button onClick={() => setRightMonth(new Date(rightMonth.getFullYear(), rightMonth.getMonth() + 1, 1))} className="w-7 h-7 rounded-xl hover:bg-brand-50 hover:text-brand-700 flex items-center justify-center text-slate-500 transition"><ChevronRight className="w-3.5 h-3.5" /></button>
                </div>
                {renderMonth(rightMonth)}
              </div>
              {extraFilters && (
                <div className="sm:col-span-2 lg:col-span-1 rounded-2xl bg-white border border-slate-200 p-3 shadow-elevated space-y-3 lg:w-56 shrink-0">
                  {extraFilters}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/70 flex items-center justify-end gap-2 flex-wrap shrink-0">
          <button onClick={() => { setLocalFrom(''); setLocalTo(''); if (onReset) onReset(); }} className="btn-icon" title="Réinitialiser"><RotateCcw className="w-4 h-4" /></button>
          <button onClick={onClose} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
          <button onClick={() => onApply(localFrom, localTo)} disabled={!localFrom} className="btn-icon-primary" title="Appliquer">
            <Check className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
