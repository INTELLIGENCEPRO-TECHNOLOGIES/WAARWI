import { useEffect } from 'react';
import { X, CheckCircle2, ChevronDown, Tag } from 'lucide-react';
import type { Category, VehicleBrand, VehicleModel } from '../../lib/shopTypes';

type Props = {
  categories: Category[];
  vehicleBrands: VehicleBrand[];
  vehicleModels: VehicleModel[];
  filterCat: string;
  filterBrand: string;
  filterModel: string;
  filterAvail: boolean;
  onCat: (v: string) => void;
  onBrand: (v: string) => void;
  onModel: (v: string) => void;
  onAvail: (v: boolean) => void;
  onClose: () => void;
};

export function ShopFilters({
  categories,
  vehicleBrands,
  vehicleModels,
  filterCat,
  filterBrand,
  filterModel,
  filterAvail,
  onCat,
  onBrand,
  onModel,
  onAvail,
  onClose,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const roots = categories.filter((c) => !c.parent_id);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full sm:max-w-md bg-white sm:rounded-2xl shadow-premium flex flex-col max-h-[88vh] animate-sheet-up sm:animate-slide-up">
        <div className="pt-3 pb-1 sm:hidden">
          <div className="sheet-handle mx-auto" />
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-brand-700/70">
              Affiner
            </div>
            <h3 className="text-base font-bold text-slate-900">Filtres</h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-slate-100 text-slate-500"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Disponibilité */}
          <section>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
              Disponibilité
            </div>
            <button
              onClick={() => onAvail(!filterAvail)}
              className={`w-full flex items-center justify-between px-3 py-3 rounded-xl border text-sm font-semibold transition-all ${
                filterAvail
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <span className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                En stock uniquement
              </span>
              <div
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                  filterAvail
                    ? 'bg-emerald-600 border-emerald-600'
                    : 'border-slate-300'
                }`}
              >
                {filterAvail && <CheckCircle2 className="w-3 h-3 text-white" />}
              </div>
            </button>
          </section>

          {/* Constructeur */}
          {vehicleBrands.length > 0 && (
            <section>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                Constructeur
              </div>
              <div className="relative">
                <select
                  value={filterBrand}
                  onChange={(e) => onBrand(e.target.value)}
                  className="w-full h-11 pl-3 pr-9 rounded-xl bg-slate-50 border border-slate-200 text-sm font-medium appearance-none focus:bg-white focus:border-brand-400 focus:ring-2 focus:ring-brand-500/15 outline-none transition-all"
                >
                  <option value="">Tous les constructeurs</option>
                  {vehicleBrands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
            </section>
          )}

          {/* Modèle */}
          {filterBrand && vehicleModels.length > 0 && (
            <section>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                Modèle
              </div>
              <div className="relative">
                <select
                  value={filterModel}
                  onChange={(e) => onModel(e.target.value)}
                  className="w-full h-11 pl-3 pr-9 rounded-xl bg-slate-50 border border-slate-200 text-sm font-medium appearance-none focus:bg-white focus:border-brand-400 focus:ring-2 focus:ring-brand-500/15 outline-none transition-all"
                >
                  <option value="">Tous les modèles</option>
                  {vehicleModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
            </section>
          )}

          {/* Catégorie */}
          {roots.length > 0 && (
            <section>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                Catégorie
              </div>
              <div className="space-y-1">
                <button
                  onClick={() => onCat('')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    !filterCat
                      ? 'bg-brand-50 text-brand-700 border border-brand-200'
                      : 'text-slate-700 hover:bg-slate-50 border border-transparent'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Tag className="w-4 h-4" />
                    Toutes
                  </span>
                  {!filterCat && <CheckCircle2 className="w-4 h-4 text-brand-600" />}
                </button>
                {roots.map((root) => {
                  const children = categories.filter(
                    (c) => c.parent_id === root.id,
                  );
                  const sel = filterCat === root.id;
                  return (
                    <div key={root.id}>
                      <button
                        onClick={() => onCat(root.id)}
                        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                          sel
                            ? 'bg-brand-50 text-brand-700 border border-brand-200'
                            : 'text-slate-800 hover:bg-slate-50 border border-transparent'
                        }`}
                      >
                        <span className="truncate">{root.name}</span>
                        {sel && <CheckCircle2 className="w-4 h-4 text-brand-600" />}
                      </button>
                      {children.map((child) => {
                        const csel = filterCat === child.id;
                        return (
                          <button
                            key={child.id}
                            onClick={() => onCat(child.id)}
                            className={`w-full flex items-center justify-between pl-8 pr-3 py-2 rounded-xl text-sm transition-all ${
                              csel
                                ? 'bg-brand-50 text-brand-700 border border-brand-200 font-semibold'
                                : 'text-slate-600 hover:bg-slate-50 border border-transparent'
                            }`}
                          >
                            <span className="truncate">↳ {child.name}</span>
                            {csel && <CheckCircle2 className="w-4 h-4 text-brand-600" />}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-100 px-4 py-3 safe-bottom">
          <button
            onClick={onClose}
            className="w-full h-11 rounded-xl bg-gradient-to-br from-brand-600 to-brand-700 text-white text-sm font-bold shadow-glow hover:shadow-premium active:scale-95 transition-all"
          >
            Voir les résultats
          </button>
        </div>
      </div>
    </div>
  );
}
