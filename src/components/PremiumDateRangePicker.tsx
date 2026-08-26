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
                className={`relative aspect-square flex items-center justify-center text-[11px] font-semibold rounded-md transition-all
                  ${isEnd ? 'bg-black text-white scale-105 z-10' : ''}
                  ${inRange ? 'bg-slate-100 text-slate-900 rounded-none' : ''}
                  ${!isEnd && !inRange ? 'text-slate-700 hover:bg-slate-50' : ''}
                  ${isToday && !isEnd && !inRange ? 'ring-1 ring-slate-300 font-bold' : ''}
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
      <div className={`relative w-full max-w-2xl bg-white rounded-xl shadow-premium animate-scale-in flex flex-col max-h-[92vh] overflow-hidden`}>
        <div className="relative px-4 py-3 bg-black text-white shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/60">Sélection de période</div>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <div className="text-xs font-bold num">{fmtLbl(localFrom)}</div>
                <ChevronRight className="w-3.5 h-3.5 text-white/40" />
                <div className="text-xs font-bold num">{fmtLbl(localTo)}</div>
              </div>
            </div>
            <button onClick={onClose} className="w-8 h-8 shrink-0 rounded-lg hover:bg-white/10 flex items-center justify-center transition-all"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row flex-1 min-h-0 overflow-y-auto">
          <div className="lg:w-40 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 p-2 flex lg:flex-col gap-0.5 overflow-x-auto lg:overflow-x-visible lg:overflow-y-auto">
            {presets.map(p => (
              <button key={p.l} onClick={() => { const r = p.f(); setLocalFrom(r.f); setLocalTo(r.t); const ld = new Date(r.f); const rd = new Date(r.t); setLeftMonth(new Date(ld.getFullYear(), ld.getMonth(), 1)); setRightMonth(ld.getMonth() === rd.getMonth() && ld.getFullYear() === rd.getFullYear() ? new Date(rd.getFullYear(), rd.getMonth() + 1, 1) : new Date(rd.getFullYear(), rd.getMonth(), 1)); }}
                className="shrink-0 lg:shrink px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-left text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition whitespace-nowrap lg:whitespace-normal">
                {p.l}
              </button>
            ))}
            {extraFilters && (
              <>
                <div className="hidden lg:block h-px bg-slate-200 my-1" />
                <div className="hidden lg:block px-2.5 py-1">
                  {extraFilters}
                </div>
              </>
            )}
          </div>

          <div className="flex-1 p-4 bg-white">
            <div className="grid gap-0 grid-cols-1 sm:grid-cols-[1fr_auto_1fr]">
              <div className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <button onClick={() => setLeftMonth(new Date(leftMonth.getFullYear(), leftMonth.getMonth() - 1, 1))} className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500 transition"><ChevronLeft className="w-3.5 h-3.5" /></button>
                  <div className="text-xs font-bold capitalize text-slate-900">{monthLabel(leftMonth)}</div>
                  <button onClick={() => setLeftMonth(new Date(leftMonth.getFullYear(), leftMonth.getMonth() + 1, 1))} className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500 transition"><ChevronRight className="w-3.5 h-3.5" /></button>
                </div>
                {renderMonth(leftMonth)}
              </div>
              <div className="h-px sm:h-auto sm:w-px bg-slate-200 mx-3 sm:mx-0 sm:my-2" />
              <div className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <button onClick={() => setRightMonth(new Date(rightMonth.getFullYear(), rightMonth.getMonth() - 1, 1))} className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500 transition"><ChevronLeft className="w-3.5 h-3.5" /></button>
                  <div className="text-xs font-bold capitalize text-slate-900">{monthLabel(rightMonth)}</div>
                  <button onClick={() => setRightMonth(new Date(rightMonth.getFullYear(), rightMonth.getMonth() + 1, 1))} className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500 transition"><ChevronRight className="w-3.5 h-3.5" /></button>
                </div>
                {renderMonth(rightMonth)}
              </div>
            </div>
            {extraFilters && (
              <div className="lg:hidden border-t border-slate-200 pt-3 mt-3 space-y-3">
                {extraFilters}
              </div>
            )}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-slate-200 bg-white flex items-center justify-end gap-2 flex-wrap shrink-0">
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
