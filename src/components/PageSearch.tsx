import { Search, X } from 'lucide-react';

interface PageSearchProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  rightSlot?: React.ReactNode;
}

export function PageSearch({ value, onChange, placeholder = 'Rechercher...', onFocus, onBlur, rightSlot }: PageSearchProps) {
  return (
    <div className="flex items-center gap-2 border-b border-neutral-200 pb-2">
      <Search className="w-4 h-4 text-neutral-400 shrink-0" />
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        className="flex-1 min-w-0 bg-transparent text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none"
      />
      {value && (
        <button onClick={() => onChange('')} className="shrink-0 p-0.5 text-neutral-400 hover:text-neutral-600 transition-colors">
          <X className="w-4 h-4" />
        </button>
      )}
      {rightSlot}
    </div>
  );
}
