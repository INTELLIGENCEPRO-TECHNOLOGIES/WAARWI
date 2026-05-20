import { useEffect, useMemo, useState } from 'react';
import { Plus, Loader2, Save, CreditCard as Edit2, Search, Eye } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { Modal } from '../components/Modal';
import { formatFCFA, formatDate } from '../lib/format';

type TabKey = 'plan' | 'journals' | 'balance';

const JOURNAL_TYPES: Record<string, string> = {
  VE: 'Journal des ventes', AC: 'Journal des achats',
  CA: 'Journal de caisse', BQ: 'Journal de banque',
  OD: 'Opérations diverses',
};

export function Accounting({ section = 'plan' }: { section?: TabKey }) {
  const titles: Record<TabKey, { t: string; s: string }> = {
    plan: { t: 'Plan comptable', s: 'Plan comptable SYSCOHADA.' },
    journals: { t: 'Journaux', s: "Journaux d'écritures comptables." },
    balance: { t: 'Balance', s: 'Balance générale des comptes.' },
  };
  const meta = titles[section];
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{meta.t}</h1>
        <p className="text-sm text-slate-500 mt-1">{meta.s}</p>
      </div>
      {section === 'plan' && <PlanTab />}
      {section === 'journals' && <JournalsTab />}
      {section === 'balance' && <BalanceTab />}
    </div>
  );
}

/* ===================== PLAN COMPTABLE ===================== */
function PlanTab() {
  const { tenant } = useApp();
  const { success, error } = useToast();
  const [list, setList] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const load = async () => {
    if (!tenant) return;
    const { data } = await supabase.from('accounts').select('*').eq('tenant_id', tenant.id).order('code');
    setList(data || []);
  };
  useEffect(() => { load(); }, [tenant?.id]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return list;
    return list.filter(a => a.code.includes(q) || a.name.toLowerCase().includes(q));
  }, [list, search]);

  const save = async () => {
    if (!tenant || !form.code || !form.name) { error('Code et intitulé obligatoires'); return; }
    if (form.code.length !== 7 || !/^\d+$/.test(form.code)) { error('Le code doit contenir exactement 7 chiffres'); return; }
    setSaving(true);
    const payload = { tenant_id: tenant.id, code: form.code, name: form.name, class: Number(form.code.charAt(0)), is_active: true };
    const { error: e } = editing
      ? await supabase.from('accounts').update({ name: form.name }).eq('id', editing.id)
      : await supabase.from('accounts').insert(payload);
    setSaving(false);
    if (e) error(e.message.includes('unique') ? 'Ce code existe déjà' : e.message);
    else { success(editing ? 'Modifié' : 'Créé'); setOpen(false); load(); }
  };

  const byClass = [1, 2, 3, 4, 5, 6, 7, 8].map(cl => ({
    cl, label: { 1: 'Ressources durables', 2: 'Actif immobilisé', 3: 'Stocks', 4: 'Tiers', 5: 'Trésorerie', 6: 'Charges', 7: 'Produits', 8: 'Autres' }[cl] || '',
    items: filtered.filter(a => a.class === cl),
  })).filter(g => g.items.length > 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un compte…" className="input pl-9" />
        </div>
        <button onClick={() => { setEditing(null); setForm({}); setOpen(true); }} className="btn-primary"><Plus className="w-4 h-4" />Nouveau compte</button>
      </div>

      <div className="space-y-3">
        {byClass.map(({ cl, label, items }) => (
          <div key={cl} className="card overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
              <span className="w-6 h-6 rounded bg-brand-100 text-brand-800 text-xs font-bold flex items-center justify-center">{cl}</span>
              <span className="text-sm font-semibold text-slate-800">Classe {cl} — {label}</span>
              <span className="ml-auto text-xs text-slate-400">{items.length} compte{items.length > 1 ? 's' : ''}</span>
            </div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {items.map(a => (
                  <tr key={a.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2.5 font-mono text-xs w-24 text-brand-700">{a.code}</td>
                    <td className="px-4 py-2.5 font-medium">{a.name}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => { setEditing(a); setForm({ ...a }); setOpen(true); }} className="p-1 rounded hover:bg-slate-100">
                        <Edit2 className="w-3.5 h-3.5 text-slate-400" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {byClass.length === 0 && <div className="card py-10 text-center text-sm text-slate-500">Aucun compte correspondant.</div>}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Modifier le compte' : 'Nouveau compte'} size="sm"
        footer={<><button onClick={() => setOpen(false)} className="btn-secondary">Annuler</button><button onClick={save} disabled={saving} className="btn-primary">{saving && <Loader2 className="w-4 h-4 animate-spin" />}Enregistrer</button></>}>
        <div className="space-y-3">
          <div>
            <label className="label">Code (7 chiffres) *</label>
            <input value={form.code || ''} onChange={e => setForm({ ...form, code: e.target.value })} className="input font-mono" placeholder="5710000" maxLength={7} disabled={!!editing} />
            {form.code?.length === 7 && <p className="text-xs text-slate-500 mt-1">Classe {form.code.charAt(0)}</p>}
          </div>
          <div><label className="label">Intitulé *</label><input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} className="input" /></div>
        </div>
      </Modal>
    </div>
  );
}

/* ===================== JOURNAUX ===================== */
function JournalsTab() {
  const { tenant } = useApp();
  const { success, error } = useToast();
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [journalType, setJournalType] = useState('');
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState<any[]>([]);

  const [form, setForm] = useState({ journal_type: 'OD', entry_date: new Date().toISOString().slice(0, 10), description: '', reference: '' });
  const [entryLines, setEntryLines] = useState<{ account_code: string; account_name: string; debit: number; credit: number; label: string }[]>([
    { account_code: '', account_name: '', debit: 0, credit: 0, label: '' },
    { account_code: '', account_name: '', debit: 0, credit: 0, label: '' },
  ]);

  const load = async () => {
    if (!tenant) return;
    setLoading(true);
    let q = supabase.from('journal_entries').select('*').eq('tenant_id', tenant.id).order('entry_date', { ascending: false }).limit(200);
    if (journalType) q = q.eq('journal_type', journalType);
    const { data } = await q;
    setEntries(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [tenant?.id, journalType]);
  useEffect(() => {
    if (!tenant) return;
    supabase.from('accounts').select('code, name').eq('tenant_id', tenant.id).order('code').then(({ data }) => setAccounts(data || []));
  }, [tenant?.id]);

  const totalDebit = entryLines.reduce((s, l) => s + Number(l.debit), 0);
  const totalCredit = entryLines.reduce((s, l) => s + Number(l.credit), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;

  const updateLine = (idx: number, field: string, val: any) => {
    setEntryLines(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      if (field === 'account_code') {
        const acc = accounts.find(a => a.code === val);
        if (acc) next[idx].account_name = acc.name;
      }
      return next;
    });
  };

  const save = async () => {
    if (!tenant) return;
    if (!form.description.trim()) { error('Description obligatoire'); return; }
    if (!isBalanced) { error("L'écriture n'est pas équilibrée (débit ≠ crédit)"); return; }
    const validLines = entryLines.filter(l => l.account_code && (l.debit > 0 || l.credit > 0));
    if (validLines.length < 2) { error('Au moins 2 lignes sont nécessaires'); return; }
    setSaving(true);
    const eNum = form.journal_type + '-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    const { data: entry, error: e } = await supabase.from('journal_entries').insert({
      tenant_id: tenant.id, entry_number: eNum,
      journal_type: form.journal_type, entry_date: form.entry_date,
      description: form.description, reference: form.reference,
      total_debit: totalDebit, total_credit: totalCredit, is_balanced: true,
    }).select().single();
    if (e || !entry) { error(e?.message || 'Erreur'); setSaving(false); return; }
    await supabase.from('journal_lines').insert(validLines.map(l => ({ tenant_id: tenant.id, entry_id: entry.id, account_code: l.account_code, account_name: l.account_name, debit: l.debit, credit: l.credit, label: l.label })));
    setSaving(false);
    success('Écriture enregistrée');
    setOpen(false);
    setEntryLines([{ account_code: '', account_name: '', debit: 0, credit: 0, label: '' }, { account_code: '', account_name: '', debit: 0, credit: 0, label: '' }]);
    setForm({ journal_type: 'OD', entry_date: new Date().toISOString().slice(0, 10), description: '', reference: '' });
    load();
  };

  const openDetail = async (e: any) => {
    setSelected(e); setDetailOpen(true);
    const { data } = await supabase.from('journal_lines').select('*').eq('entry_id', e.id).order('created_at');
    setLines(data || []);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <select value={journalType} onChange={e => setJournalType(e.target.value)} className="input sm:w-56">
          <option value="">Tous les journaux</option>
          {Object.entries(JOURNAL_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button onClick={() => setOpen(true)} className="btn-primary"><Plus className="w-4 h-4" />Nouvelle écriture</button>
      </div>

      <div className="card overflow-hidden">
        {loading ? <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
          : entries.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">Aucune écriture comptable pour le moment.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-600">
                  <tr>
                    <th className="px-4 py-3 text-left">N° Écriture</th>
                    <th className="px-4 py-3 text-left hidden sm:table-cell">Date</th>
                    <th className="px-4 py-3 text-left hidden sm:table-cell">Journal</th>
                    <th className="px-4 py-3 text-left">Description</th>
                    <th className="px-4 py-3 text-right hidden md:table-cell">Débit</th>
                    <th className="px-4 py-3 text-right hidden md:table-cell">Crédit</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {entries.map(e => (
                    <tr key={e.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{e.entry_number}</td>
                      <td className="px-4 py-3 text-xs hidden sm:table-cell text-slate-600">{formatDate(e.entry_date)}</td>
                      <td className="px-4 py-3 hidden sm:table-cell"><span className="badge bg-brand-50 text-brand-700">{e.journal_type}</span></td>
                      <td className="px-4 py-3 text-slate-700 max-w-xs truncate">{e.description}</td>
                      <td className="px-4 py-3 text-right hidden md:table-cell font-mono text-xs">{Number(e.total_debit).toLocaleString('fr-FR')}</td>
                      <td className="px-4 py-3 text-right hidden md:table-cell font-mono text-xs">{Number(e.total_credit).toLocaleString('fr-FR')}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => openDetail(e)} className="p-1.5 rounded hover:bg-slate-100 text-slate-600"><Eye className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {/* Create modal */}
      <Modal open={open} onClose={() => setOpen(false)} title="Nouvelle écriture comptable" size="lg"
        footer={<><button onClick={() => setOpen(false)} className="btn-secondary">Annuler</button><button onClick={save} disabled={saving || !isBalanced} className="btn-primary disabled:opacity-50">{saving && <Loader2 className="w-4 h-4 animate-spin" />}<Save className="w-4 h-4" />Enregistrer</button></>}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="label">Journal *</label>
              <select value={form.journal_type} onChange={e => setForm(f => ({ ...f, journal_type: e.target.value }))} className="input">
                {Object.entries(JOURNAL_TYPES).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Date *</label>
              <input type="date" value={form.entry_date} onChange={e => setForm(f => ({ ...f, entry_date: e.target.value }))} className="input" />
            </div>
            <div>
              <label className="label">Référence</label>
              <input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} className="input" placeholder="N° facture, chèque…" />
            </div>
          </div>
          <div>
            <label className="label">Description *</label>
            <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="input" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Lignes d'écriture</label>
              <button onClick={() => setEntryLines(p => [...p, { account_code: '', account_name: '', debit: 0, credit: 0, label: '' }])} className="text-xs text-brand-700 hover:underline flex items-center gap-1"><Plus className="w-3 h-3" />Ajouter</button>
            </div>
            <div className="space-y-2">
              {entryLines.map((l, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-1.5 items-start">
                  <div className="col-span-3">
                    <select value={l.account_code} onChange={e => updateLine(idx, 'account_code', e.target.value)} className="input text-xs font-mono">
                      <option value="">— Compte —</option>
                      {accounts.map(a => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
                    </select>
                  </div>
                  <div className="col-span-4">
                    <input value={l.label} onChange={e => updateLine(idx, 'label', e.target.value)} placeholder="Libellé" className="input text-xs" />
                  </div>
                  <div className="col-span-2">
                    <input type="number" value={l.debit || ''} onChange={e => updateLine(idx, 'debit', Number(e.target.value))} placeholder="Débit" className="input text-xs" min="0" />
                  </div>
                  <div className="col-span-2">
                    <input type="number" value={l.credit || ''} onChange={e => updateLine(idx, 'credit', Number(e.target.value))} placeholder="Crédit" className="input text-xs" min="0" />
                  </div>
                  <div className="col-span-1 flex items-center justify-end pt-1">
                    <button onClick={() => setEntryLines(p => p.filter((_, i) => i !== idx))} disabled={entryLines.length <= 2} className="p-1 rounded hover:bg-red-50 text-red-400 disabled:opacity-30 text-xs">✕</button>
                  </div>
                </div>
              ))}
            </div>
            <div className={`mt-3 pt-3 border-t flex justify-end gap-6 text-sm font-mono ${isBalanced ? 'border-emerald-200' : 'border-slate-200'}`}>
              <span>Débit : <strong>{totalDebit.toLocaleString('fr-FR')}</strong></span>
              <span>Crédit : <strong>{totalCredit.toLocaleString('fr-FR')}</strong></span>
              <span className={isBalanced ? 'text-emerald-700 font-semibold' : 'text-red-600'}>{isBalanced ? 'Équilibrée' : `Écart : ${(totalDebit - totalCredit).toLocaleString('fr-FR')}`}</span>
            </div>
          </div>
        </div>
      </Modal>

      {/* Detail modal */}
      <Modal open={detailOpen} onClose={() => setDetailOpen(false)} title={selected ? `Écriture ${selected.entry_number}` : ''} size="lg"
        footer={<button onClick={() => setDetailOpen(false)} className="btn-secondary">Fermer</button>}>
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div className="card p-3"><div className="text-xs text-slate-500">Journal</div><div className="font-semibold mt-0.5">{JOURNAL_TYPES[selected.journal_type] || selected.journal_type}</div></div>
              <div className="card p-3"><div className="text-xs text-slate-500">Date</div><div className="font-semibold mt-0.5">{formatDate(selected.entry_date)}</div></div>
              <div className="card p-3"><div className="text-xs text-slate-500">Total débit</div><div className="font-bold mt-0.5">{Number(selected.total_debit).toLocaleString('fr-FR')} FCFA</div></div>
              <div className="card p-3"><div className="text-xs text-slate-500">Total crédit</div><div className="font-bold mt-0.5">{Number(selected.total_credit).toLocaleString('fr-FR')} FCFA</div></div>
            </div>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr><th className="px-4 py-2 text-left">Compte</th><th className="px-4 py-2 text-left">Libellé</th><th className="px-4 py-2 text-right">Débit</th><th className="px-4 py-2 text-right">Crédit</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map(l => <tr key={l.id}><td className="px-4 py-2.5 font-mono text-xs text-brand-700">{l.account_code}</td><td className="px-4 py-2.5 text-slate-600">{l.label || l.account_name}</td><td className="px-4 py-2.5 text-right font-mono text-xs">{l.debit > 0 ? Number(l.debit).toLocaleString('fr-FR') : '—'}</td><td className="px-4 py-2.5 text-right font-mono text-xs">{l.credit > 0 ? Number(l.credit).toLocaleString('fr-FR') : '—'}</td></tr>)}
                </tbody>
                <tfoot className="bg-slate-50 border-t border-slate-200 text-xs font-semibold">
                  <tr><td className="px-4 py-2" colSpan={2}>TOTAL</td><td className="px-4 py-2 text-right font-mono">{Number(selected.total_debit).toLocaleString('fr-FR')}</td><td className="px-4 py-2 text-right font-mono">{Number(selected.total_credit).toLocaleString('fr-FR')}</td></tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ===================== BALANCE ===================== */
function BalanceTab() {
  const { tenant } = useApp();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'month' | 'year' | 'all'>('month');

  useEffect(() => {
    if (!tenant) return;
    (async () => {
      setLoading(true);
      const now = new Date();
      let dateFrom: string | null = null;
      if (period === 'month') dateFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      else if (period === 'year') dateFrom = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);

      const { data: entries } = await supabase.from('journal_entries').select('id').eq('tenant_id', tenant.id).gte('entry_date', dateFrom || '2000-01-01');
      const entryIds = (entries || []).map((e: any) => e.id);

      if (entryIds.length === 0) { setData([]); setLoading(false); return; }

      const { data: lines } = await supabase.from('journal_lines').select('account_code, account_name, debit, credit').in('entry_id', entryIds);

      const map: Record<string, { code: string; name: string; debit: number; credit: number }> = {};
      (lines || []).forEach((l: any) => {
        if (!map[l.account_code]) map[l.account_code] = { code: l.account_code, name: l.account_name || l.account_code, debit: 0, credit: 0 };
        map[l.account_code].debit += Number(l.debit);
        map[l.account_code].credit += Number(l.credit);
      });

      const sorted = Object.values(map).sort((a, b) => a.code.localeCompare(b.code));
      setData(sorted);
      setLoading(false);
    })();
  }, [tenant?.id, period]);

  const totalDebit = data.reduce((s, r) => s + r.debit, 0);
  const totalCredit = data.reduce((s, r) => s + r.credit, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <select value={period} onChange={e => setPeriod(e.target.value as any)} className="input w-48">
          <option value="month">Mois en cours</option>
          <option value="year">Exercice en cours</option>
          <option value="all">Tout</option>
        </select>
        <p className="text-sm text-slate-500">{data.length} compte{data.length > 1 ? 's' : ''} mouvementés</p>
      </div>

      {loading ? <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
        : data.length === 0 ? (
          <div className="card py-12 text-center text-sm text-slate-500">Aucune écriture pour la période sélectionnée.</div>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-600">
                  <tr>
                    <th className="px-4 py-3 text-left">Compte</th>
                    <th className="px-4 py-3 text-left">Intitulé</th>
                    <th className="px-4 py-3 text-right">Débit (FCFA)</th>
                    <th className="px-4 py-3 text-right">Crédit (FCFA)</th>
                    <th className="px-4 py-3 text-right">Solde (FCFA)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.map(r => {
                    const solde = r.debit - r.credit;
                    return (
                      <tr key={r.code} className="hover:bg-slate-50/60">
                        <td className="px-4 py-2.5 font-mono text-xs text-brand-700">{r.code}</td>
                        <td className="px-4 py-2.5 text-slate-700">{r.name}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs">{r.debit > 0 ? r.debit.toLocaleString('fr-FR') : '—'}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs">{r.credit > 0 ? r.credit.toLocaleString('fr-FR') : '—'}</td>
                        <td className={`px-4 py-2.5 text-right font-mono text-xs font-semibold ${solde > 0 ? 'text-emerald-700' : solde < 0 ? 'text-red-600' : 'text-slate-500'}`}>
                          {solde !== 0 ? solde.toLocaleString('fr-FR') : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-50 border-t-2 border-slate-200 font-semibold text-sm">
                  <tr>
                    <td className="px-4 py-3" colSpan={2}>TOTAL</td>
                    <td className="px-4 py-3 text-right font-mono">{totalDebit.toLocaleString('fr-FR')}</td>
                    <td className="px-4 py-3 text-right font-mono">{totalCredit.toLocaleString('fr-FR')}</td>
                    <td className={`px-4 py-3 text-right font-mono ${Math.abs(totalDebit - totalCredit) < 0.01 ? 'text-emerald-700' : 'text-red-600'}`}>
                      {Math.abs(totalDebit - totalCredit) < 0.01 ? 'Équilibrée' : (totalDebit - totalCredit).toLocaleString('fr-FR')}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
    </div>
  );
}
