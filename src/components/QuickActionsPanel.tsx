import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { X, Search, Star, Settings2, GripVertical, RotateCcw } from 'lucide-react';
import { QUICK_ACTIONS, QUICK_ACTION_CATEGORIES, getDefaultFavoriteIds, type QuickAction } from '../lib/quickActionsRegistry';
import { usePermissions, type PermissionKey } from '../lib/permissions';
import { useApp } from '../context/AppContext';
import { useQuickAction } from '../context/QuickActionContext';
import { supabase } from '../lib/supabase';

const PREFS_KEY = 'quick_actions_prefs';

type UserPrefs = {
  favorites: string[];
  hidden: string[];
};

function loadLocalPrefs(tenantId: string): UserPrefs | null {
  try {
    const raw = localStorage.getItem(`waarwi:qa_prefs:${tenantId}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveLocalPrefs(tenantId: string, prefs: UserPrefs) {
  try { localStorage.setItem(`waarwi:qa_prefs:${tenantId}`, JSON.stringify(prefs)); } catch {}
}

export function QuickActionsPanel({ onClose }: { onClose: () => void }) {
  const { tenant, profile } = useApp();
  const { can } = usePermissions();
  const { dispatch } = useQuickAction();
  const [search, setSearch] = useState('');
  const [customizing, setCustomizing] = useState(false);
  const [prefs, setPrefs] = useState<UserPrefs>({ favorites: getDefaultFavoriteIds(), hidden: [] });
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const enabledModules: string[] = Array.isArray((tenant as any)?.enabled_modules)
    ? (tenant as any).enabled_modules
    : ['dashboard','pos','cash_history','articles','stock','tiers','sales','billing','supplier_orders','online_orders','accounting','settings','reports','ipm'];

  const isActionAllowed = useCallback((a: QuickAction) => {
    if (a.module && !enabledModules.includes(a.module)) return false;
    return a.permissions.every(p => can(p as PermissionKey));
  }, [enabledModules, can]);

  const allowedActions = useMemo(() => QUICK_ACTIONS.filter(isActionAllowed), [isActionAllowed]);

  // Load prefs from profile
  useEffect(() => {
    if (!tenant || !profile) return;
    const local = loadLocalPrefs(tenant.id);
    if (local) { setPrefs(local); setPrefsLoaded(true); return; }

    const saved = (profile as any)?.auto_print_prefs;
    if (saved && typeof saved === 'object' && saved[PREFS_KEY]) {
      setPrefs(saved[PREFS_KEY]);
      saveLocalPrefs(tenant.id, saved[PREFS_KEY]);
    }
    setPrefsLoaded(true);
  }, [tenant?.id, profile]);

  const persistPrefs = useCallback(async (next: UserPrefs) => {
    setPrefs(next);
    if (!tenant) return;
    saveLocalPrefs(tenant.id, next);
    // Also persist to profile for cross-device sync
    const existing = (profile as any)?.auto_print_prefs || {};
    await supabase.from('profiles').update({
      auto_print_prefs: { ...existing, [PREFS_KEY]: next },
    }).eq('id', (profile as any)?.id);
  }, [tenant, profile]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Keyboard: Escape closes, arrow keys navigate
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); e.preventDefault(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const favoriteActions = useMemo(() => {
    return prefs.favorites
      .map(id => allowedActions.find(a => a.id === id))
      .filter((a): a is QuickAction => !!a && !prefs.hidden.includes(a.id));
  }, [prefs.favorites, prefs.hidden, allowedActions]);

  const filteredActions = useMemo(() => {
    if (!search.trim()) return allowedActions.filter(a => !prefs.hidden.includes(a.id));
    const q = search.toLowerCase();
    return allowedActions.filter(a =>
      !prefs.hidden.includes(a.id) &&
      (a.label.toLowerCase().includes(q) ||
       a.keywords.some(k => k.toLowerCase().includes(q)))
    );
  }, [search, allowedActions, prefs.hidden]);

  const groupedActions = useMemo(() => {
    return QUICK_ACTION_CATEGORIES.map(cat => ({
      ...cat,
      actions: filteredActions.filter(a => a.category === cat.key),
    })).filter(g => g.actions.length > 0);
  }, [filteredActions]);

  const handleAction = (a: QuickAction) => {
    dispatch(a.navTarget, a.route);
    onClose();
  };

  const toggleFavorite = (id: string) => {
    const next = { ...prefs };
    if (next.favorites.includes(id)) {
      next.favorites = next.favorites.filter(f => f !== id);
    } else {
      next.favorites = [...next.favorites, id];
    }
    persistPrefs(next);
  };

  const toggleHidden = (id: string) => {
    const next = { ...prefs };
    if (next.hidden.includes(id)) {
      next.hidden = next.hidden.filter(h => h !== id);
    } else {
      next.hidden = [...next.hidden, id];
      next.favorites = next.favorites.filter(f => f !== id);
    }
    persistPrefs(next);
  };

  const resetPrefs = () => {
    persistPrefs({ favorites: getDefaultFavoriteIds(), hidden: [] });
  };

  const moveFavorite = (from: number, to: number) => {
    if (to < 0 || to >= prefs.favorites.length) return;
    const next = [...prefs.favorites];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    persistPrefs({ ...prefs, favorites: next });
  };

  if (!prefsLoaded) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[60] bg-neutral-900/40 animate-fade-in" onClick={onClose} />

      {/* Panel */}
      <div className="fixed z-[61] inset-x-0 bottom-0 md:inset-auto md:right-0 md:top-0 md:bottom-0 md:w-[400px] bg-white shadow-premium flex flex-col animate-fade-in max-h-[85vh] md:max-h-full rounded-t-2xl md:rounded-none">
        {/* Header */}
        <div className="shrink-0 px-4 pt-4 pb-3 border-b border-neutral-100">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-neutral-900">Actions rapides</h2>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCustomizing(!customizing)}
                className={`p-1.5 rounded-lg transition-colors ${customizing ? 'text-neutral-900 bg-neutral-100' : 'text-neutral-400 hover:text-neutral-700'}`}
                title="Personnaliser"
              >
                <Settings2 className="w-4 h-4" />
              </button>
              <button onClick={onClose} className="p-1.5 text-neutral-400 hover:text-neutral-700 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-neutral-400 shrink-0" />
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher une action…"
              className="bare-input w-full text-sm py-1"
            />
            {search && (
              <button onClick={() => setSearch('')} className="shrink-0 p-1 text-neutral-400 hover:text-neutral-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="h-px bg-neutral-200 mt-1" />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {customizing ? (
            /* ── Customization mode ── */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Personnaliser mes actions</span>
                <button onClick={resetPrefs} className="inline-flex items-center gap-1 text-[10px] font-semibold text-neutral-500 hover:text-neutral-700 transition-colors">
                  <RotateCcw className="w-3 h-3" />Par défaut
                </button>
              </div>

              {/* Favorites order */}
              <div className="space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">Mes favoris (glisser pour réordonner)</div>
                {favoriteActions.map((a, i) => {
                  const Icon = a.icon;
                  return (
                    <div
                      key={a.id}
                      draggable
                      onDragStart={() => setDragIdx(i)}
                      onDragOver={e => e.preventDefault()}
                      onDrop={() => { if (dragIdx !== null) moveFavorite(dragIdx, i); setDragIdx(null); }}
                      className="flex items-center gap-2 py-1.5 px-1 rounded-lg hover:bg-neutral-50 cursor-grab active:cursor-grabbing"
                    >
                      <GripVertical className="w-3.5 h-3.5 text-neutral-300 shrink-0" />
                      <Icon className="w-4 h-4 text-neutral-600 shrink-0" />
                      <span className="text-xs font-medium text-neutral-800 flex-1 truncate">{a.label}</span>
                      <button onClick={() => toggleFavorite(a.id)} className="p-1 text-amber-500 hover:text-amber-600 shrink-0">
                        <Star className="w-3.5 h-3.5 fill-current" />
                      </button>
                    </div>
                  );
                })}
                {favoriteActions.length === 0 && (
                  <p className="text-xs text-neutral-400 py-2">Aucun favori. Ajoutez-en ci-dessous.</p>
                )}
              </div>

              {/* All actions toggle */}
              <div className="space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">Toutes les actions</div>
                {allowedActions.map(a => {
                  const Icon = a.icon;
                  const isFav = prefs.favorites.includes(a.id);
                  const isHidden = prefs.hidden.includes(a.id);
                  return (
                    <div key={a.id} className={`flex items-center gap-2 py-1.5 px-1 rounded-lg ${isHidden ? 'opacity-40' : ''}`}>
                      <Icon className="w-4 h-4 text-neutral-500 shrink-0" />
                      <span className="text-xs font-medium text-neutral-800 flex-1 truncate">{a.label}</span>
                      <button onClick={() => toggleFavorite(a.id)} className={`p-1 shrink-0 transition-colors ${isFav ? 'text-amber-500' : 'text-neutral-300 hover:text-amber-400'}`} title={isFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}>
                        <Star className={`w-3.5 h-3.5 ${isFav ? 'fill-current' : ''}`} />
                      </button>
                      <button onClick={() => toggleHidden(a.id)} className={`p-1 shrink-0 text-xs font-semibold transition-colors ${isHidden ? 'text-neutral-400 hover:text-neutral-600' : 'text-neutral-300 hover:text-red-500'}`} title={isHidden ? 'Afficher' : 'Masquer'}>
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* ── Normal mode ── */
            <>
              {/* Favorites */}
              {!search && favoriteActions.length > 0 && (
                <div className="-mx-4 -mt-3 px-4 py-4 bg-gradient-to-br from-white via-neutral-50 to-neutral-200">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-2">Mes actions</div>
                  <div className="grid grid-cols-2 gap-1">
                    {favoriteActions.slice(0, 8).map(a => {
                      const Icon = a.icon;
                      return (
                        <button
                          key={a.id}
                          onClick={() => handleAction(a)}
                          className="flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-white/80 active:bg-white rounded-lg transition-colors"
                        >
                          <Icon className="w-4 h-4 text-neutral-600 shrink-0" />
                          <span className="text-xs font-semibold text-neutral-800 truncate">{a.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* All actions by category */}
              {(!search && favoriteActions.length > 0) && (
                <div className="h-px bg-neutral-100" />
              )}
              <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1">
                {search ? `Résultats pour "${search}"` : 'Toutes les actions'}
              </div>
              {groupedActions.length === 0 && (
                <p className="text-xs text-neutral-400 py-4 text-center">Aucune action trouvée</p>
              )}
              {groupedActions.map((group, gi) => (
                <div key={group.key}>
                  {gi > 0 && <div className="h-px bg-neutral-100 mb-1" />}
                  <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider py-1">{group.label}</div>
                  {group.actions.map(a => {
                    const Icon = a.icon;
                    return (
                      <button
                        key={a.id}
                        onClick={() => handleAction(a)}
                        className="w-full flex items-center gap-3 px-2 py-2 text-left hover:bg-neutral-50 active:bg-neutral-100 rounded-lg transition-colors"
                      >
                        <Icon className="w-4 h-4 text-neutral-500 shrink-0" />
                        <span className="text-xs font-medium text-neutral-800">{a.label}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer hint */}
        <div className="shrink-0 px-4 py-2 border-t border-neutral-100">
          <div className="text-[10px] text-neutral-400 text-center">
            {customizing ? 'Cliquez sur ★ pour ajouter aux favoris' : 'Alt+A pour ouvrir · Esc pour fermer'}
          </div>
        </div>
      </div>
    </>
  );
}
