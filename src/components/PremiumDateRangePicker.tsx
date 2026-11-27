import { useEffect, useState, type ReactNode } from 'react';
import { X, ChevronLeft, ChevronRight, RotateCcw, Check } from 'lucide-react';
import { Modal } from './Modal';

type Range = { from: string; to: string };

const weekdays = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const monthFormat = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const dayFormat = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const rangeFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

function dateFromISO(iso: string) {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day);
}

function toISO(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function moveMonth(date: Date, offset = 0) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

function monthsFor(range: Range) {
  const end = range.to ? dateFromISO(range.to) : range.from ? dateFromISO(range.from) : new Date();
  const start = range.from ? moveMonth(dateFromISO(range.from)) : moveMonth(end, -1);
  const next = moveMonth(end);
  return { start: +start === +next ? moveMonth(next, -1) : start, end: next };
}

function recentRange(days: number): Range {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days + 1);
  return { from: toISO(first), to: toISO(today) };
}

const presets = [
  { label: 'Aujourd’hui', range: () => recentRange(1) },
  { label: '7 derniers jours', range: () => recentRange(7) },
  { label: 'Ce mois', range: () => {
    const today = new Date();
    return { from: toISO(moveMonth(today)), to: toISO(today) };
  } },
  { label: '30 derniers jours', range: () => recentRange(30) },
  { label: 'Mois dernier', range: () => {
    const today = new Date();
    return { from: toISO(moveMonth(today, -1)), to: toISO(new Date(today.getFullYear(), today.getMonth(), 0)) };
  } },
];

function MonthCalendar({ month, range, onMonth, onSelect, className = '' }: {
  month: Date;
  range: Range;
  onMonth: (month: Date) => void;
  onSelect: (date: string) => void;
  className?: string;
}) {
  const year = month.getFullYear();
  const index = month.getMonth();
  const offset = (month.getDay() + 6) % 7;
  const lastDay = new Date(year, index + 1, 0).getDate();
  const today = toISO(new Date());
  const monthLabel = monthFormat.format(month);

  return (
    <div className={`min-w-0 ${className}`}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <button type="button" aria-label={`Mois précédent pour ${monthLabel}`} onClick={() => onMonth(moveMonth(month, -1))} className="waarwi-window-button">
          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
        </button>
        <h4 className="text-center text-sm font-semibold capitalize">{monthLabel}</h4>
        <button type="button" aria-label={`Mois suivant pour ${monthLabel}`} onClick={() => onMonth(moveMonth(month, 1))} className="waarwi-window-button">
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {weekdays.map((day, i) => <div key={i} aria-hidden="true" className="pb-1 text-center text-[11px] text-[var(--w-text-muted)]">{day}</div>)}
        {Array.from({ length: offset }, (_, i) => <span aria-hidden="true" key={`offset-${i}`} />)}
        {Array.from({ length: lastDay }, (_, i) => {
          const date = new Date(year, index, i + 1);
          const iso = toISO(date);
          const endpoint = iso === range.from || iso === range.to;
          const within = !!range.from && !!range.to && iso > range.from && iso < range.to;
          return <button type="button" key={i} aria-label={dayFormat.format(date)} aria-pressed={endpoint} aria-current={iso === today ? 'date' : undefined}
            onClick={() => onSelect(iso)}
            className={`mx-px grid h-9 place-items-center rounded-sm text-xs font-medium num focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-[var(--w-text)]
              ${endpoint ? 'bg-[var(--w-accent)] text-[var(--w-accent-text)]' : within ? 'rounded-none bg-[var(--w-hover)] text-[var(--w-text)]' : 'text-[var(--w-text-sec)] hover:bg-[var(--w-hover)]'}
              ${iso === today && !endpoint ? 'ring-1 ring-inset ring-[var(--w-field-border)]' : ''}`}>
            {i + 1}
          </button>;
        })}
      </div>
    </div>
  );
}

export function PremiumDateRangePicker({ open, onClose, from, to, onApply, extraFilters, onReset }: {
  open: boolean; onClose: () => void; from: string; to: string;
  onApply: (from: string, to: string) => void;
  extraFilters?: ReactNode;
  onReset?: () => void;
}) {
  const [range, setRange] = useState<Range>({ from, to });
  const [months, setMonths] = useState(() => monthsFor({ from, to }));

  useEffect(() => {
    if (!open) return;
    setRange({ from, to });
    setMonths(monthsFor({ from, to }));
  }, [open, from, to]);

  const select = (iso: string) => setRange(current => {
    if (!current.from || current.to) return { from: iso, to: '' };
    return iso < current.from ? { from: iso, to: current.from } : { from: current.from, to: iso };
  });

  return (
    <Modal open={open} onClose={onClose} title="Période" size="lg" layer="top" footer={<>
      <button type="button" className="btn-ghost mr-auto text-xs" aria-label="Réinitialiser" onClick={() => { setRange({ from: '', to: '' }); onReset?.(); }}>
        <RotateCcw aria-hidden="true" className="h-4 w-4" /> <span className="max-[359px]:sr-only">Réinitialiser</span>
      </button>
      <button type="button" className="btn-secondary text-xs" onClick={onClose}>
        <X aria-hidden="true" className="h-4 w-4" /> Annuler
      </button>
      <button type="button" className="btn-primary text-xs" onClick={() => onApply(range.from, range.to || range.from)} disabled={!range.from}>
        <Check aria-hidden="true" className="h-4 w-4" /> Appliquer
      </button>
    </>}>
      <div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
        <div className="space-y-3 sm:border-r sm:border-[var(--w-separator)] sm:pr-3">
          <div className="flex flex-wrap gap-1 sm:flex-col sm:items-stretch">
            {presets.map(preset => {
              const value = preset.range();
              return <button key={preset.label} type="button"
                aria-pressed={range.from === value.from && range.to === value.to}
                className="rounded-sm px-2 py-1.5 text-left text-xs font-medium text-[var(--w-text-sec)] hover:bg-[var(--w-hover)] aria-pressed:bg-[var(--w-hover)] aria-pressed:text-[var(--w-text)]"
                onClick={() => { setRange(value); setMonths(monthsFor(value)); }}>
                {preset.label}
              </button>;
            })}
          </div>
          {extraFilters && <div className="space-y-2 border-t border-[var(--w-separator)] pt-2">{extraFilters}</div>}
        </div>
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 border-b border-[var(--w-separator)] pb-2 text-xs num" aria-live="polite">
            <div><span className="mr-2 text-[var(--w-text-muted)]">Du</span>{range.from ? <time dateTime={range.from}>{rangeFormat.format(dateFromISO(range.from))}</time> : '—'}</div>
            <div><span className="mr-2 text-[var(--w-text-muted)]">Au</span>{range.to ? <time dateTime={range.to}>{rangeFormat.format(dateFromISO(range.to))}</time> : '—'}</div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <MonthCalendar className="hidden border-r border-[var(--w-separator)] pr-3 md:block" month={months.start} range={range}
              onMonth={start => setMonths(current => ({ ...current, start }))} onSelect={select} />
            <MonthCalendar month={months.end} range={range}
              onMonth={end => setMonths(current => ({ ...current, end }))} onSelect={select} />
          </div>
        </div>
      </div>
    </Modal>
  );
}
