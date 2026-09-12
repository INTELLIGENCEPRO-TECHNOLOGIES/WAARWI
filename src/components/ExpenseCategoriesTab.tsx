import { useEffect, useState, useCallback, useRef } from 'react';
import { Loader2, Plus, Check, X, Info, CreditCard as Edit2, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';

type EffectiveCategory = {
  id: string;
  name: string;
  site_id: string | null;
  scope: 'legacy_global' | 'site';
  effective_enabled: boolean;
};

const DEFAULT_NAMES = [
  'Loyer', 'Carburant', 'Électricité & eau', 'Fournitures',
  'Transport', 'Salaires & personnel', 'Entretien & réparations', 'Divers',
];

export function ExpenseCategoriesTab() {
  const { tenant, currentSite } = useApp();
  const rootSiteId = currentSite?.is_warehouse ? currentSite?.parent_site_id : currentSite?.id;
  const { success, error } = useToast();
  const [loading, setLoading] = useState(true);
  const [cats, setCats] = useState<EffectiveCategory[]>([]);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [seeding, setSeeding] = useState(false);
  const loadRef = useRef(0);

  const load = useCallback(async () => {
    if (!tenant || !currentSite?.id) return;
    const token = ++loadRef.current;
    setLoading(true);
    const { data, error: e } = await supabase.rpc('get_effective_expense_categories', {
      p_site_id: currentSite.id,
      p_include_inactive: true,
    });
    if (token !== loadRef.current) return;
    if (e) { error(e.message); setLoading(false); return; }
    setCats((data as EffectiveCategory[]) || []);
    setLoading(false);
  }, [tenant?.id, currentSite?.id]);

  useEffect(() => {
    setEditingId(null);
    setNewName('');
    load();
  }, [load]);

  const add = async () => {
    const name = newName.trim();
    if (!tenant || !name || !currentSite?.id) return;
    setAdding(true);
    const { error: e } = await supabase.rpc('create_expense_category_for_site', {
      p_site_id: currentSite.id,
      p_name: name,
    });
    setAdding(false);
    if (e) {
      error(e.message.includes('23505') || e.message.includes('duplicate') ? 'Ce type de dépense existe déjà' : e.message);
      return;
    }
    setNewName('');
    success('Type de dépense ajouté');
    load();
  };

  const rename = async (id: string) => {
    const name = editName.trim();
    if (!name || !tenant || !rootSiteId) return;
    const { error: e } = await supabase
      .from('expense_categories')
      .update({ name })
      .eq('id', id)
      .eq('tenant_id', tenant.id)
      .eq('site_id', rootSiteId);
    if (e) {
      error(e.code === '23505' ? 'Ce type de dépense existe déjà' : e.message);
      return;
    }
    setEditingId(null);
    success('Type de dépense renommé');
    load();
  };

  const toggle = async (c: EffectiveCategory) => {
    if (!currentSite?.id) return;
    const { error: e } = await supabase.rpc('set_expense_category_enabled_for_site', {
      p_site_id: currentSite.id,
      p_category_id: c.id,
      p_enabled: !c.effective_enabled,
    });
    if (e) { error(e.message); return; }
    setCats(prev => prev.map(x => x.id === c.id ? { ...x, effective_enabled: !c.effective_enabled } : x));
  };

  const seedDefaults = async () => {
    if (!tenant || !currentSite?.id) return;
    setSeeding(true);
    for (const name of DEFAULT_NAMES) {
      await supabase.rpc('create_expense_category_for_site', {
        p_site_id: currentSite.id,
        p_name: name,
      });
    }
    setSeeding(false);
    success('Types de dépenses par défaut créés');
    load();
  };

  const storeName = currentSite?.is_warehouse
    ? (currentSite as any)?.parent_site_name || 'Magasin parent'
    : currentSite?.name || '';

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-neutral-400" /></div>;
  }

  const canRename = (c: EffectiveCategory) => c.scope === 'site' && c.site_id === rootSiteId;

  return (
    <div className="space-y-6 max-w-2xl">
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Types de dépenses</h2>
            <p className="text-[11px] text-neutral-500 mt-1">
              Catégories proposées lors de l'enregistrement d'une dépense en caisse
              {storeName && <span className="font-medium text-neutral-700"> — {storeName}</span>}
            </p>
          </div>
        </div>

        {!rootSiteId ? (
          <div className="text-center py-8">
            <p className="text-sm text-neutral-500">Aucun magasin sélectionné. Changez de point de vente pour gérer les types de dépenses.</p>
          </div>
        ) : (
          <>
            <div className="flat-form flex items-center gap-3 pt-2 border-t border-neutral-200">
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') add(); }}
                className="input flex-1"
                placeholder="Nouveau type de dépense (ex: Carburant)"
              />
              <button
                onClick={add}
                disabled={adding || !newName.trim()}
                className="inline-flex items-center justify-center w-9 h-9 bg-neutral-900 text-white rounded-md hover:bg-neutral-800 transition active:scale-[0.97] disabled:opacity-50 shrink-0"
              >
                {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              </button>
            </div>

            {cats.length === 0 ? (
              <div className="text-center py-8 space-y-3">
                <p className="text-sm text-neutral-500">Aucun type de dépense configuré.</p>
                <button
                  onClick={seedDefaults}
                  disabled={seeding}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-neutral-700 hover:text-neutral-900 transition"
                >
                  {seeding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  Créer les types par défaut
                </button>
              </div>
            ) : (
              <div className="divide-y divide-neutral-200">
                {cats.map(c => (
                  <div key={c.id} className="flex items-center gap-3 py-3">
                    {editingId === c.id ? (
                      <>
                        <input
                          autoFocus
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') rename(c.id); if (e.key === 'Escape') setEditingId(null); }}
                          className="flex-1 w-input-ul bg-transparent px-0 py-1 text-sm text-neutral-900 outline-none focus:border-neutral-900 transition"
                        />
                        <button onClick={() => rename(c.id)} className="p-1.5 rounded-md hover:bg-neutral-100 text-emerald-600 transition" title="Valider">
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setEditingId(null)} className="p-1.5 rounded-md hover:bg-neutral-100 text-neutral-500 transition" title="Annuler">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className={`flex-1 text-sm font-medium truncate ${c.effective_enabled ? 'text-neutral-900' : 'text-neutral-400 line-through'}`}>{c.name}</span>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${c.scope === 'site' ? 'bg-[var(--w-active)] text-[var(--w-text-sec)]' : 'bg-neutral-100 text-neutral-500'}`}>
                          {c.scope === 'site' ? 'Ce magasin' : 'Type existant'}
                        </span>
                        {canRename(c) && (
                          <button
                            onClick={() => { setEditingId(c.id); setEditName(c.name); }}
                            className="p-1.5 rounded-md hover:bg-neutral-100 text-neutral-500 transition"
                            title="Renommer"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button onClick={() => toggle(c)} className="shrink-0 relative" title={c.effective_enabled ? 'Désactiver' : 'Activer'}>
                          <div className={`w-9 h-5 rounded-full transition-colors relative ${c.effective_enabled ? 'bg-neutral-900' : 'bg-neutral-200'}`}>
                            <div className={`absolute top-0.5 bg-white rounded-full h-4 w-4 transition-transform shadow-sm ${c.effective_enabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                          </div>
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <p className="text-[11px] text-neutral-500 flex items-start gap-1.5">
        <Info className="w-3 h-3 shrink-0 mt-0.5 text-neutral-400" />
        Les types désactivés ne sont plus proposés en caisse mais restent visibles dans l'historique et les états.
      </p>
    </div>
  );
}
