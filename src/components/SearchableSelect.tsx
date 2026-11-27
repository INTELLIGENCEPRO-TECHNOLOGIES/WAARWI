import { useState, useRef, useEffect, useMemo, useCallback, useId, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown, Check, X } from 'lucide-react';
import './window-surfaces.css';

export type SelectOption = {
  value: string;
  label: string;
  sublabel?: string;
  disabled?: boolean;
};

type Props = {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  searchable?: boolean;
  clearable?: boolean;
  noBorder?: boolean;
  variant?: 'default' | 'underline';
  menuWidth?: number;
  wrapLabels?: boolean;
  maxResults?: number;
};

type MenuPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  above: boolean;
};

const dropdownHeight = 272;
const edge = 8;
const gap = 4;

function getPosition(rect: DOMRect, menuWidth?: number): MenuPosition {
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportRight = viewportLeft + (viewport?.width ?? window.innerWidth);
  const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
  const innerTop = viewportTop + edge;
  const innerBottom = viewportBottom - edge;
  const width = Math.min(menuWidth ?? rect.width, viewportRight - viewportLeft - edge * 2);
  const left = Math.max(viewportLeft + edge, Math.min(rect.left, viewportRight - edge - width));
  const belowAnchor = Math.max(innerTop, Math.min(innerBottom, rect.bottom + gap));
  const aboveAnchor = Math.max(innerTop, Math.min(innerBottom, rect.top - gap));
  const belowSpace = innerBottom - belowAnchor;
  const aboveSpace = aboveAnchor - innerTop;
  const above = belowSpace < dropdownHeight && aboveSpace > belowSpace;

  return {
    top: above ? aboveAnchor : belowAnchor,
    left,
    width,
    maxHeight: Math.min(dropdownHeight, above ? aboveSpace : belowSpace),
    above,
  };
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = '— Choisir —',
  label,
  ariaLabel,
  disabled = false,
  className = '',
  searchable = true,
  clearable = true,
  noBorder = false,
  variant = 'default',
  menuWidth,
  wrapLabels = false,
  maxResults,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [pos, setPos] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerId = useId();
  const listId = useId();

  const isUnderline = variant === 'underline';
  const selected = options.find(option => option.value === value);
  const visible = open && !disabled;
  const canClear = clearable && !!value && !disabled;
  const accessibleName = ariaLabel ?? label;
  const textOverflow = wrapLabels ? 'break-words' : 'truncate';

  const filtered = useMemo(() => {
    const filter = query.trim().toLowerCase();
    const result = filter ? options.filter(option =>
      option.label.toLowerCase().includes(filter) || option.sublabel?.toLowerCase().includes(filter),
    ) : options;
    return maxResults != null ? result.slice(0, maxResults) : result;
  }, [options, query, maxResults]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  const updatePos = useCallback(() => {
    if (triggerRef.current) setPos(getPosition(triggerRef.current.getBoundingClientRect(), menuWidth));
  }, [menuWidth]);

  const show = () => {
    if (disabled) return;
    updatePos();
    const selectedIndex = filtered.findIndex(option => option.value === value && !option.disabled);
    setHighlightIdx(selectedIndex >= 0 ? selectedIndex : filtered.findIndex(option => !option.disabled));
    setOpen(true);
  };

  useEffect(() => {
    if (visible && searchable) inputRef.current?.focus({ preventScroll: true });
  }, [visible, searchable]);

  useEffect(() => {
    setHighlightIdx(index => filtered[index] && !filtered[index].disabled && !query
      ? index
      : filtered.findIndex(option => !option.disabled));
  }, [filtered.length, query]);

  useEffect(() => {
    if (!visible) return;
    const viewport = window.visualViewport;
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !dropdownRef.current?.contains(target)) close();
    };

    document.addEventListener('pointerdown', dismissOutside);
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    viewport?.addEventListener('resize', updatePos);
    viewport?.addEventListener('scroll', updatePos);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
      viewport?.removeEventListener('resize', updatePos);
      viewport?.removeEventListener('scroll', updatePos);
    };
  }, [visible, updatePos, close]);

  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('[data-active="true"]');
    if (!visible || !list || !active) return;
    if (active.offsetTop < list.scrollTop) list.scrollTop = active.offsetTop;
    const end = active.offsetTop + active.offsetHeight;
    if (end > list.scrollTop + list.clientHeight) list.scrollTop = end - list.clientHeight;
  }, [visible, highlightIdx]);

  const choose = (option: string) => {
    onChange(option);
    triggerRef.current?.focus({ preventScroll: true });
    close();
  };

  function moveHighlight(direction: -1 | 1) {
    setHighlightIdx(current => {
      let index = current < 0 && direction < 0 ? filtered.length - 1 : current + direction;
      while (index >= 0 && index < filtered.length) {
        if (!filtered[index].disabled) return index;
        index += direction;
      }
      return current;
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement | HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (!visible) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
        event.preventDefault();
        show();
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveHighlight(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveHighlight(-1);
        break;
      case 'Enter':
        event.preventDefault();
        if (filtered[highlightIdx] && !filtered[highlightIdx].disabled) choose(filtered[highlightIdx].value);
        break;
      case 'Escape':
        event.preventDefault();
        triggerRef.current?.focus({ preventScroll: true });
        close();
        break;
      case 'Tab':
        triggerRef.current?.focus({ preventScroll: true });
        close();
        break;
    }
  }

  const activeOptionId = filtered[highlightIdx] ? `${listId}-${highlightIdx}` : undefined;
  const dropdown = visible && pos ? createPortal(
    <div ref={dropdownRef}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight, transform: pos.above ? 'translateY(-100%)' : undefined, zIndex: 2147483000 }}
      className="flex min-h-0 flex-col overflow-hidden rounded-md border border-[var(--w-separator)] bg-[var(--w-surface)] text-[var(--w-text)] shadow-md">
      {searchable && (
        <div className="relative shrink-0 border-b border-[var(--w-separator)]">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--w-text-muted)]" />
          <input ref={inputRef} role="combobox" aria-label={accessibleName ? `Rechercher : ${accessibleName}` : 'Rechercher une option'}
            aria-expanded="true" aria-autocomplete="list" aria-controls={listId} aria-activedescendant={activeOptionId}
            type="text" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={handleKeyDown}
            placeholder="Rechercher…" className="w-full bg-transparent py-2.5 pl-9 pr-3 text-[16px] text-[var(--w-text)] outline-none placeholder:text-[var(--w-text-muted)] sm:text-sm"/>
        </div>
      )}
      <div ref={listRef} id={listId} role="listbox" aria-label={accessibleName || 'Options'}
        className="relative min-h-0 flex-auto divide-y divide-[var(--w-separator-l)] overflow-y-auto overscroll-contain">
        {filtered.length === 0 ? (
          <p className="px-3 py-2.5 text-sm text-[var(--w-text-sec)]">Aucun résultat.</p>
        ) : filtered.map((option, index) => {
          const current = option.value === value;
          return (
            <button key={option.value} id={`${listId}-${index}`} type="button" role="option" tabIndex={-1}
              aria-selected={current} disabled={option.disabled} data-active={index === highlightIdx} onClick={() => choose(option.value)}
              onPointerEnter={event => { if (event.pointerType === 'mouse' && !option.disabled) setHighlightIdx(index); }}
              className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm data-[active=true]:bg-[var(--w-hover)] disabled:cursor-not-allowed disabled:opacity-50
                ${current ? 'font-medium text-[var(--w-text)]' : 'text-[var(--w-text-sec)]'}`}>
              <span className="min-w-0 flex-1">
                <span className={`block ${textOverflow}`}>{option.label}</span>
                {option.sublabel && <span className={`mt-0.5 block text-xs text-[var(--w-text-muted)] ${textOverflow}`}>{option.sublabel}</span>}
              </span>
              {current && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--w-text)]" />}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  ) : null;

  const triggerStyle = isUnderline
    ? 'rounded-none border-0 border-b bg-transparent px-1'
    : `rounded-md border px-3 ${noBorder ? 'bg-transparent hover:bg-[var(--w-hover)]' : 'bg-[var(--w-surface)]'}`;
  const borderStyle = visible ? 'border-[var(--w-text-sec)]' : noBorder && !isUnderline ? 'border-transparent' : 'border-[var(--w-separator)]';

  return (
    <div className={isUnderline ? '' : className}>
      {label && <label className="label" htmlFor={triggerId}>{label}</label>}
      <div className="relative min-w-0">
        <button ref={triggerRef} id={triggerId} type="button" disabled={disabled} aria-label={ariaLabel} aria-describedby={accessibleName ? triggerId + "-value" : undefined} aria-haspopup="listbox" aria-expanded={visible}
          aria-controls={visible ? listId : undefined} onClick={visible ? close : show} onKeyDown={handleKeyDown}
          className={`flex w-full min-w-0 items-center gap-2 py-2.5 text-left text-sm focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--w-text)] disabled:cursor-not-allowed disabled:opacity-60
            ${triggerStyle} ${borderStyle} ${canClear ? 'pr-9' : ''}`}>
          <span id={triggerId + '-value'} className={`min-w-0 flex-1 ${wrapLabels ? 'break-words' : 'truncate'} ${selected ? 'font-medium text-[var(--w-text)]' : 'text-[var(--w-text-muted)]'}`}>
            {selected ? selected.label : placeholder}
          </span>
          {!canClear && <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-[var(--w-text-muted)] ${visible ? 'rotate-180' : ''}`}/>}
        </button>
        {canClear && <button type="button" onClick={() => choose('')} aria-label="Effacer la sélection" title="Effacer la sélection"
          className="waarwi-window-button absolute right-0.5 top-1/2 -translate-y-1/2">
          <X aria-hidden="true" className="h-4 w-4" />
        </button>}
      </div>
      {dropdown}
    </div>
  );
}
