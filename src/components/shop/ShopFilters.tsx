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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center animate-fade-in">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative w-full sm:max-w-md bg-white sm:border sm:border-neutral-200 flex flex-col max-h-[88vh] animate-sheet-up sm:animate-slide-up">
        {/* Handle mobile */}
        <div className="pt-3 pb-1 sm:hidden flex justify-center">
          <div className="w-10 h-1 rounded-full bg-neutral-200" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
          <h3 className="text-base font-bold text-neutral-900">Filtres</h3>
          <button
            onClick={onClose}
            className="p-2 text-neutral-400 hover:text-neutral-700 transition-colors"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {/* Disponibilite */}
          <section>
            <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-3">
              Disponibilite
            </div>
            <button
              onClick={() => onAvail(!filterAvail)}
              className="flex items-center gap-3 py-2 text-sm text-neutral-700"
            >
              <div className={`w-5 h-5 border flex items-center justify-center transition-all ${
                filterAvail ? 'bg-neutral-900 border-neutral-900' : 'border-neutral-300'
              }`}>
                {filterAvail && <CheckCircle2 className="w-3 h-3 text-white" />}
              </div>
              <span className={filterAvail ? 'font-bold text-neutral-900' : ''}>En stock uniquement</span>
            </button>
          </section>

          {/* Constructeur */}
          {vehicleBrands.length > 0 && (
            <section>
              <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-3">
                Constructeur
              </div>
              <div className="relative border-b border-neutral-200 pb-1">
                <select
                  value={filterBrand}
                  onChange={(e) => onBrand(e.target.value)}
                  className="bare-input text-sm text-neutral-900 font-medium pr-8 cursor-pointer"
                >
                  <option value="">Tous les constructeurs</option>
                  {vehicleBrands.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 pointer-events-none" />
              </div>
            </section>
          )}

          {/* Modele */}
          {filterBrand && vehicleModels.length > 0 && (
            <section>
              <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-3">
                Modele
              </div>
              <div className="relative border-b border-neutral-200 pb-1">
                <select
                  value={filterModel}
                  onChange={(e) => onModel(e.target.value)}
                  className="bare-input text-sm text-neutral-900 font-medium pr-8 cursor-pointer"
                >
                  <option value="">Tous les modeles</option>
                  {vehicleModels.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 pointer-events-none" />
              </div>
            </section>
          )}

          {/* Categorie */}
          {roots.length > 0 && (
            <section>
              <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-3">
                Categorie
              </div>
              <div className="space-y-0.5">
                <button
                  onClick={() => onCat('')}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                    !filterCat ? 'font-bold text-neutral-900 bg-neutral-50' : 'text-neutral-600 hover:bg-neutral-50'
                  }`}
                >
                  Toutes
                </button>
                {roots.map((root) => {
                  const children = categories.filter(c => c.parent_id === root.id);
                  const sel = filterCat === root.id;
                  return (
                    <div key={root.id}>
                      <button
                        onClick={() => onCat(root.id)}
                        className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                          sel ? 'font-bold text-neutral-900 bg-neutral-50' : 'text-neutral-600 hover:bg-neutral-50'
                        }`}
                      >
                        {root.name}
                      </button>
                      {children.map((child) => {
                        const csel = filterCat === child.id;
                        return (
                          <button
                            key={child.id}
                            onClick={() => onCat(child.id)}
                            className={`w-full text-left pl-7 pr-3 py-2 text-sm transition-colors ${
                              csel ? 'font-bold text-neutral-900 bg-neutral-50' : 'text-neutral-500 hover:bg-neutral-50'
                            }`}
                          >
                            {child.name}
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

        {/* Footer */}
        <div className="shrink-0 border-t border-neutral-100 px-5 py-4 safe-bottom">
          <button
            onClick={onClose}
            className="w-full h-11 bg-neutral-900 text-white text-sm font-bold hover:bg-neutral-800 active:scale-[0.98] transition-all"
          >
            Voir les resultats
          </button>
        </div>
      </div>
    </div>
  );
}
