import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown, Check, X } from 'lucide-react';

export type SelectOption = {
  value: string;
  label: string;
  sublabel?: string;
};

type Props = {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  className?: string;
  searchable?: boolean;
  noBorder?: boolean;
  variant?: 'default' | 'underline';
  menuWidth?: number;
  wrapLabels?: boolean;
};

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = '— Choisir —',
  label,
  disabled = false,
  className = '',
  searchable = true,
  noBorder = false,
  variant = 'default',
  menuWidth,
  wrapLabels = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });

  const isUnderline = variant === 'underline';
  const selected = options.find(o => o.value === value);

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter(
      o => o.label.toLowerCase().includes(q) || (o.sublabel && o.sublabel.toLowerCase().includes(q))
    );
  }, [options, query]);

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const margin = 8;
    const maxW = window.innerWidth - margin * 2;
    const width = Math.min(menuWidth ?? rect.width, maxW);
    let left = rect.left;
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - margin - width);
    }
    setPos({ top: rect.bottom + 4, left, width });
  }, [menuWidth]);

  useEffect(() => {
    if (open) {
      updatePos();
      if (inputRef.current && searchable) inputRef.current.focus();
    }
  }, [open, searchable, updatePos]);

  useEffect(() => {
    setHighlightIdx(0);
  }, [filtered.length, query]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
      setQuery('');
    }
    function handleScroll() {
      updatePos();
    }
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', updatePos);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [open, updatePos]);

  useEffect(() => {
    if (open && listRef.current) {
      const active = listRef.current.querySelector('[data-active="true"]');
      if (active) active.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIdx, open]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIdx(i => Math.min(i + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIdx(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filtered[highlightIdx]) {
          onChange(filtered[highlightIdx].value);
          setOpen(false);
          setQuery('');
        }
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        setQuery('');
        break;
    }
  }

  const dropdownCls = isUnderline
    ? 'bg-white border border-neutral-200 rounded-lg shadow-md overflow-hidden'
    : 'bg-white border border-slate-200 rounded-xl shadow-lg shadow-slate-200/60 overflow-hidden';

  const searchInputCls = isUnderline
    ? 'w-full pl-8 pr-3 py-2 text-sm bg-transparent border-b border-neutral-200 focus:border-neutral-400 outline-none transition-all rounded-none'
    : 'w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-slate-100 bg-slate-50 focus:bg-white focus:border-teal-300 focus:ring-1 focus:ring-teal-100 outline-none transition-all';

  const dropdown = open ? createPortal(
    <div
      ref={dropdownRef}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
      className={dropdownCls}
    >
      {searchable && (
        <div className={isUnderline ? 'p-2' : 'p-2 border-b border-slate-100'}>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Rechercher..."
              className={searchInputCls}
            />
          </div>
        </div>
      )}
      <div ref={listRef} className="max-h-56 overflow-y-auto overscroll-contain">
        {filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-slate-400">Aucun resultat</div>
        ) : (
          isUnderline ? (
            <div className="divide-y divide-neutral-100">
              {filtered.map((opt, idx) => {
                const isSelected = opt.value === value;
                const isHighlighted = idx === highlightIdx;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    data-active={isHighlighted}
                    onClick={() => { onChange(opt.value); setOpen(false); setQuery(''); }}
                    onMouseEnter={() => setHighlightIdx(idx)}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors
                      ${isHighlighted ? 'bg-neutral-50' : ''}
                      ${isSelected ? 'text-neutral-900 font-medium' : 'text-neutral-700'}
                    `}
                  >
                    <div className="flex-1 min-w-0">
                      <div className={wrapLabels ? 'break-words' : 'truncate'}>{opt.label}</div>
                      {opt.sublabel && <div className={`text-[11px] text-neutral-400 mt-0.5 ${wrapLabels ? 'break-words' : 'truncate'}`}>{opt.sublabel}</div>}
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-neutral-600 shrink-0" />}
                  </button>
                );
              })}
            </div>
          ) : (
            filtered.map((opt, idx) => {
              const isSelected = opt.value === value;
              const isHighlighted = idx === highlightIdx;
              return (
                <button
                  key={opt.value}
                  type="button"
                  data-active={isHighlighted}
                  onClick={() => { onChange(opt.value); setOpen(false); setQuery(''); }}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors
                    ${isHighlighted ? 'bg-teal-50' : ''}
                    ${isSelected ? 'text-teal-700 font-medium' : 'text-slate-700'}
                  `}
                >
                  <div className="flex-1 min-w-0">
                    <div className={wrapLabels ? 'break-words' : 'truncate'}>{opt.label}</div>
                    {opt.sublabel && <div className={`text-[11px] text-slate-400 mt-0.5 ${wrapLabels ? 'break-words' : 'truncate'}`}>{opt.sublabel}</div>}
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-teal-600 shrink-0" />}
                </button>
              );
            })
          )
        )}
      </div>
    </div>,
    document.body
  ) : null;

  const triggerCls = isUnderline
    ? `w-full flex items-center justify-between gap-2 px-1 py-2.5 rounded-none border-0 border-b text-left text-sm transition-all bg-transparent
       ${open ? 'border-neutral-500' : 'border-neutral-300'}
       ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`
    : `w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-left text-sm transition-all
       ${noBorder ? 'border-transparent bg-transparent hover:bg-slate-50' : open ? 'border-teal-400 ring-2 ring-teal-100 bg-white' : 'border-slate-200 bg-white hover:border-slate-300'}
       ${disabled ? 'opacity-60 cursor-not-allowed bg-slate-50' : 'cursor-pointer'}`;

  return (
    <div className={isUnderline ? '' : className}>
      {label && <label className="label">{label}</label>}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => { if (!disabled) setOpen(!open); }}
        onKeyDown={handleKeyDown}
        className={triggerCls}
      >
        <span className={`flex-1 truncate ${selected ? 'text-neutral-900 font-medium' : 'text-neutral-400'}`}>
          {selected ? selected.label : placeholder}
        </span>
        {value && !disabled ? (
          <X
            className="w-3.5 h-3.5 text-neutral-400 hover:text-neutral-600 shrink-0"
            onClick={(e) => { e.stopPropagation(); onChange(''); setOpen(false); setQuery(''); }}
          />
        ) : (
          <ChevronDown className={`w-4 h-4 text-neutral-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        )}
      </button>
      {dropdown}
    </div>
  );
}
