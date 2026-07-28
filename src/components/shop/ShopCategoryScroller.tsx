import type { Category } from '../../lib/shopTypes';
import type { ShopThemeConfig } from '../../lib/shopThemes';

type Props = {
  categories: Category[];
  filterCat: string;
  onCat: (id: string) => void;
  theme: ShopThemeConfig;
};

export function ShopCategoryScroller({ categories, filterCat, onCat, theme }: Props) {
  const roots = categories.filter((c) => !c.parent_id);
  if (roots.length === 0) return null;

  return (
    <div className="shop-fluid py-3 border-b border-slate-100">
      <div className="shop-cat-bar">
        <button
          onClick={() => onCat('')}
          className={`shop-cat-chip ${!filterCat
            ? `${theme.cardButtonClass} shadow-sm`
            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          Tout
        </button>
        {roots.map((cat) => (
          <button
            key={cat.id}
            onClick={() => onCat(cat.id)}
            className={`shop-cat-chip ${filterCat === cat.id
              ? `${theme.cardButtonClass} shadow-sm`
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>
    </div>
  );
}
