import { Search, X } from 'lucide-react';

interface PageSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  rightSlot?: React.ReactNode;
}

export function PageSearch({ value, onChange, placeholder = 'Rechercher…', onFocus, onBlur, rightSlot }: PageSearchProps) {
  return (
    <div className="flex min-w-0 items-center gap-2 border-b border-[var(--w-separator)] pb-1.5 focus-within:border-[var(--w-text-sec)]">
      <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--w-text-muted)]" />
      <input
        aria-label={placeholder}
        value={value}
        onChange={event => onChange(event.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent py-0.5 text-[16px] text-[var(--w-text)] outline-none placeholder:text-[var(--w-text-muted)] sm:text-sm"
      />
      {value && (
        <button type="button" aria-label="Effacer la recherche" title="Effacer la recherche" onClick={() => onChange('')}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-sm text-[var(--w-text-muted)] hover:bg-[var(--w-hover)] hover:text-[var(--w-text)] focus-visible:outline focus-visible:-outline-offset-2">
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      )}
      {rightSlot}
    </div>
  );
}
