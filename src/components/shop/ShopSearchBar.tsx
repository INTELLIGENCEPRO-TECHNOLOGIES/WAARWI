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
  const longPlaceholder = isAutoParts
    ? 'Référence, OEM, pièce, véhicule…'
    : 'Rechercher un produit…';
  const shortPlaceholder = 'Rechercher…';

  return (
    <div className="flex gap-2">
      <div className="flex-1 relative group">
        <div className="absolute inset-0 rounded-2xl bg-white shadow-premium border border-neutral-200/80" />
        <Search
          className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-700 pointer-events-none z-10"
          strokeWidth={2.3}
        />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={shortPlaceholder}
          aria-label={longPlaceholder}
          className="shop-search-input relative w-full h-12 pl-11 pr-4 rounded-2xl bg-transparent text-sm font-medium text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/25 transition-all"
        />
        {value && (
          <button
            onClick={() => onChange('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-neutral-100 transition-colors z-10"
            aria-label="Effacer la recherche"
          >
            <X className="w-3.5 h-3.5 text-slate-400" />
          </button>
        )}
      </div>
      <button
        onClick={onOpenFilters}
        className={`relative shrink-0 h-12 px-4 rounded-2xl text-sm font-bold transition-all active:scale-95 inline-flex items-center gap-1.5 shop-touch-target ${
          activeFilterCount > 0
            ? 'bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-glow'
            : 'bg-white text-neutral-700 border border-neutral-200/80 shadow-premium hover:border-neutral-300'
        }`}
        aria-label="Ouvrir les filtres"
      >
        <SlidersHorizontal className="w-4 h-4" />
        <span className="hidden sm:inline">Filtres</span>
        {activeFilterCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-white">
            {activeFilterCount}
          </span>
        )}
      </button>
    </div>
  );
}
