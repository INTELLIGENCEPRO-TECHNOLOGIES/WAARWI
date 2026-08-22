import type { Category } from '../../lib/shopTypes';
import type { ShopThemeConfig } from '../../lib/shopThemes';

type Props = {
  categories: Category[];
  filterCat: string;
  onCat: (id: string) => void;
  theme: ShopThemeConfig;
};

export function ShopCategoryScroller({ categories, filterCat, onCat }: Props) {
  const roots = categories.filter((c) => !c.parent_id);
  if (roots.length === 0) return null;

  const items = [{ id: '', name: 'Tout' }, ...roots];

  return (
    <div className="border-b border-neutral-100 overflow-x-auto scrollbar-none">
      <div className="flex items-center min-w-max">
        {items.map((cat, idx) => {
          const active = cat.id === filterCat || (cat.id === '' && !filterCat);
          return (
            <button
              key={cat.id || '__all'}
              onClick={() => onCat(cat.id)}
              className={`relative px-4 py-3 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap transition-colors ${
                active ? 'text-neutral-900' : 'text-neutral-400 hover:text-neutral-600'
              }`}
            >
              {cat.name}
              {active && (
                <span className="absolute bottom-0 left-4 right-4 h-[2px] bg-neutral-900" />
              )}
              {idx < items.length - 1 && !active && (
                <span className="absolute right-0 top-1/2 -translate-y-1/2 w-px h-3 bg-neutral-200" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
