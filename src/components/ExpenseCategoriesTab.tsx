import { useEffect, useState } from 'react';
import { Loader2, Plus, Check, X, TrendingDown, Info, CreditCard as Edit2, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';

type ExpenseCategory = {
  id: string;
  name: string;
  is_active: boolean;
};

const DEFAULT_NAMES = [
  'Loyer', 'Carburant', 'Électricité & eau', 'Fournitures',
  'Transport', 'Salaires & personnel', 'Entretien & réparations', 'Divers',
];

export function ExpenseCategoriesTab() {
  const { tenant } = useApp();
  const { success, error } = useToast();
  const [loading, setLoading] = useState(true);
  const [cats, setCats] = useState<ExpenseCategory[]>([]);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [seeding, setSeeding] = useState(false);

  const load = async () => {
    if (!tenant) return;
    const { data, error: e } = await supabase
      .from('expense_categories')
      .select('id, name, is_active')
      .eq('tenant_id', tenant.id)
      .order('name');
    if (e) { error(e.message); setLoading(false); return; }
    setCats(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [tenant?.id]);

  const add = async () => {
    const name = newName.trim();
    if (!tenant || !name) return;
    setAdding(true);
    const { error: e } = await supabase
      .from('expense_categories')
      .insert({ tenant_id: tenant.id, name });
    setAdding(false);
    if (e) {
      error(e.code === '23505' ? 'Ce type de dépense existe déjà' : e.message);
      return;
    }
    setNewName('');
    success('Type de dépense ajouté');
    load();
  };

  const rename = async (id: string) => {
    const name = editName.trim();
    if (!name) return;
    const { error: e } = await supabase
      .from('expense_categories')
      .update({ name })
      .eq('id', id);
    if (e) {
      error(e.code === '23505' ? 'Ce type de dépense existe déjà' : e.message);
      return;
    }
    setEditingId(null);
    success('Type de dépense renommé');
    load();
  };

  const toggle = async (c: ExpenseCategory) => {
    const { error: e } = await supabase
      .from('expense_categories')
      .update({ is_active: !c.is_active })
      .eq('id', c.id);
    if (e) { error(e.message); return; }
    setCats(prev => prev.map(x => x.id === c.id ? { ...x, is_active: !c.is_active } : x));
  };

  const seedDefaults = async () => {
    if (!tenant) return;
    setSeeding(true);
    const { error: e } = await supabase
      .from('expense_categories')
      .insert(DEFAULT_NAMES.map(name => ({ tenant_id: tenant.id, name })));
    setSeeding(false);
    if (e) { error(e.message); return; }
    success('Types de dépenses par défaut créés');
    load();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-slate-300" /></div>;
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-slate-100">
          <div className="w-9 h-9 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center">
            <TrendingDown className="w-4.5 h-4.5 text-red-600" />
          </div>
          <div>
            <div className="text-[14px] font-bold text-slate-900">Types de dépenses</div>
            <div className="text-[11px] text-slate-500">Catégories proposées lors de l'enregistrement d'une dépense en caisse</div>
          </div>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') add(); }}
              className="flex-1 h-10 rounded-xl border border-slate-200 bg-white text-[13px] text-slate-800 px-3 outline-none focus:border-slate-400 transition-colors"
              placeholder="Nouveau type de dépense (ex: Carburant)"
            />
            <button
              onClick={add}
              disabled={adding || !newName.trim()}
              className="btn-icon-primary"
              title="Ajouter"
            >
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            </button>
          </div>

          {cats.length === 0 ? (
            <div className="text-center py-8 space-y-3">
              <p className="text-sm text-slate-500">Aucun type de dépense configuré.</p>
              <button
                onClick={seedDefaults}
                disabled={seeding}
                className="btn-icon"
                title="Créer les types par défaut"
              >
                {seeding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
              {cats.map(c => (
                <div key={c.id} className={`flex items-center gap-2 px-3 py-2 transition-colors ${c.is_active ? 'bg-white' : 'bg-slate-50'}`}>
                  {editingId === c.id ? (
                    <>
                      <input
                        autoFocus
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') rename(c.id); if (e.key === 'Escape') setEditingId(null); }}
                        className="flex-1 h-8 rounded-lg border border-slate-300 bg-white text-[13px] text-slate-800 px-2.5 outline-none focus:border-slate-400"
                      />
                      <button onClick={() => rename(c.id)} className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 hover:bg-emerald-100 transition-colors" title="Valider">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setEditingId(null)} className="w-7 h-7 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-colors" title="Annuler">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className={`flex-1 text-[13px] font-semibold truncate ${c.is_active ? 'text-slate-800' : 'text-slate-400 line-through'}`}>{c.name}</span>
                      <button
                        onClick={() => { setEditingId(c.id); setEditName(c.name); }}
                        className="w-7 h-7 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-colors"
                        title="Renommer"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => toggle(c)} className="shrink-0 relative" title={c.is_active ? 'Désactiver' : 'Activer'}>
                        <div className={`w-10 h-[20px] rounded-full transition-colors relative ${c.is_active ? 'bg-brand-600' : 'bg-slate-200'}`}>
                          <div className={`absolute top-0.5 bg-white rounded-full h-[15px] w-[15px] transition-transform shadow-sm ${c.is_active ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                        </div>
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-start gap-2 text-[11px] bg-slate-50 border border-slate-200 text-slate-600 rounded-xl px-3 py-2.5">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
            <span>
              Les types désactivés ne sont plus proposés en caisse mais restent visibles dans l'historique et les états.
              Les dépenses sont suivies dans l'état « Dépenses » pour calculer la marge nette après dépenses.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
