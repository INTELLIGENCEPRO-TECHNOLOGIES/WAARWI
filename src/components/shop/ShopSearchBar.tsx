import { Search, X, SlidersHorizontal } from 'lucide-react';

type Props = {
  value: string;
  onChange: (v: string) => void;
  onOpenFilters: () => void;
  activeFilterCount: number;
  isAutoParts: boolean;
};

export function ShopSearchBar({
  value,
  onChange,
  onOpenFilters,
  activeFilterCount,
  isAutoParts,
}: Props) {
  const placeholder = isAutoParts
    ? 'Rechercher un produit, un service...'
    : 'Rechercher un produit, un service...';

  return (
    <div className="flex items-center gap-4">
      <div className="flex-1 flex items-center gap-3 border-b border-neutral-200 pb-2">
        <Search className="w-5 h-5 text-neutral-400 shrink-0" strokeWidth={1.8} />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="bare-input flex-1 text-sm text-neutral-900 placeholder-neutral-400 font-normal"
        />
        {value && (
          <button
            onClick={() => onChange('')}
            className="p-1 text-neutral-400 hover:text-neutral-600 transition-colors"
            aria-label="Effacer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      <button
        onClick={onOpenFilters}
        className="shrink-0 flex items-center gap-2 px-4 py-2 border border-neutral-200 text-sm font-medium text-neutral-700 hover:border-neutral-400 transition-colors"
        aria-label="Filtres"
      >
        <SlidersHorizontal className="w-4 h-4" />
        <span>Filtres</span>
        {activeFilterCount > 0 && (
          <span className="w-5 h-5 rounded-full bg-neutral-900 text-white text-[10px] font-bold flex items-center justify-center">
            {activeFilterCount}
          </span>
        )}
      </button>
    </div>
  );
}
