import { useEffect, useMemo, useState } from 'react';
import { Plus, Loader2, Save, CreditCard as Edit2, Search, Eye, FileText, CheckCircle, PlayCircle, Lock, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { Modal, ConfirmDialog } from '../components/Modal';
import { SearchableSelect } from '../components/SearchableSelect';
import { formatDate } from '../lib/format';

type TabKey = 'plan' | 'journals' | 'balance' | 'grandlivre' | 'tiers' | 'search' | 'cloture';

const JOURNAL_TYPES: Record<string, string> = {
  VE: 'Journal des ventes', AC: 'Journal des achats',
  CA: 'Journal de caisse', BQ: 'Journal de banque',
  OD: 'Opérations diverses',
};

export function Accounting({ section = 'plan' }: { section?: TabKey }) {
  const titles: Record<TabKey, { t: string; s: string }> = {
    plan: { t: 'Plan comptable', s: 'Plan comptable SYSCOHADA.' },
    journals: { t: 'Journaux', s: "Journaux d'écritures comptables." },
    balance: { t: 'Balance générale', s: 'Balance des comptes par période.' },
    grandlivre: { t: 'Grand Livre', s: 'Détail des mouvements par compte.' },
    tiers: { t: 'Tiers', s: 'Balance et interrogation des comptes clients/fournisseurs.' },
    search: { t: 'Recherche', s: "Recherche avancée d'écritures comptables." },
    cloture: { t: 'Clôtures', s: 'Clôture des journaux et exercices.' },
  };
  const meta = titles[section];
  return (
    <div className="space-y-5">
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-5 lg:-mx-8 px-3 sm:px-5 lg:px-8 pb-3 pt-3 sm:pt-4 lg:pt-6 -mt-3 sm:-mt-4 lg:-mt-6 bg-neutral-50/95 backdrop-blur-sm">
        <h1 className="text-2xl font-bold text-neutral-900">{meta.t}</h1>
        <p className="text-sm text-neutral-500 mt-1">{meta.s}</p>
      </div>
      {section === 'plan' && <PlanTab />}
      {section === 'journals' && <JournalsTab />}
      {section === 'balance' && <BalanceTab />}
      {section === 'grandlivre' && <GrandLivreTab />}
      {section === 'tiers' && <TiersTab />}
      {section === 'search' && <SearchTab />}
      {section === 'cloture' && <ClotureTab />}
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
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un compte…" className="input pl-9" />
        </div>
        <button onClick={() => { setEditing(null); setForm({}); setOpen(true); }} className="btn-primary"><Plus className="w-4 h-4" />Nouveau compte</button>
      </div>

      <div className="space-y-3">
        {byClass.map(({ cl, label, items }) => (
          <div key={cl} className="card overflow-hidden">
            <div className="px-4 py-2.5 bg-neutral-50 border-b border-neutral-100 flex items-center gap-2">
              <span className="w-6 h-6 rounded bg-brand-100 text-brand-800 text-xs font-bold flex items-center justify-center">{cl}</span>
              <span className="text-sm font-semibold text-neutral-800">Classe {cl} — {label}</span>
              <span className="ml-auto text-xs text-neutral-400">{items.length} compte{items.length > 1 ? 's' : ''}</span>
            </div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-neutral-100">
                {items.map(a => (
                  <tr key={a.id} className="hover:bg-neutral-50/60">
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
        {byClass.length === 0 && <div className="card py-10 text-center text-sm text-neutral-500">Aucun compte correspondant.</div>}
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
      status: 'posted', posted_at: new Date().toISOString(),
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
            <div className="py-12 text-center text-sm text-neutral-500">Aucune écriture comptable pour le moment.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-xs uppercase text-neutral-600">
                  <tr>
                    <th className="px-4 py-3 text-left">N° Pièce</th>
                    <th className="px-4 py-3 text-left hidden sm:table-cell">Date</th>
                    <th className="px-4 py-3 text-left hidden sm:table-cell">Journal</th>
                    <th className="px-4 py-3 text-left">Description</th>
                    <th className="px-4 py-3 text-center hidden md:table-cell">Statut</th>
                    <th className="px-4 py-3 text-right hidden md:table-cell">Débit</th>
                    <th className="px-4 py-3 text-right hidden md:table-cell">Crédit</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {entries.map(e => (
                    <tr key={e.id} className="hover:bg-neutral-50/60">
                      <td className="px-4 py-3 font-mono text-xs text-neutral-600">{e.entry_number}</td>
                      <td className="px-4 py-3 text-xs hidden sm:table-cell text-neutral-600">{formatDate(e.entry_date)}</td>
                      <td className="px-4 py-3 hidden sm:table-cell"><span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-brand-50 text-brand-700">{e.journal_type}</span></td>
                      <td className="px-4 py-3 text-neutral-700 max-w-xs truncate">{e.description}</td>
                      <td className="px-4 py-3 text-center hidden md:table-cell">
                        {e.status === 'posted' ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-teal-50 text-teal-700 border border-teal-200"><CheckCircle className="w-3 h-3" />Validé</span>
                        ) : e.status === 'cancelled' ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-50 text-red-700 border border-red-200">Annulé</span>
                        ) : (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Brouillon</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right hidden md:table-cell font-mono text-xs">{Number(e.total_debit).toLocaleString('fr-FR')}</td>
                      <td className="px-4 py-3 text-right hidden md:table-cell font-mono text-xs">{Number(e.total_credit).toLocaleString('fr-FR')}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => openDetail(e)} className="p-1.5 rounded hover:bg-neutral-100 text-neutral-600"><Eye className="w-4 h-4" /></button>
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
                    <SearchableSelect
                      options={accounts.map(a => ({ value: a.code, label: `${a.code} ${a.name}` }))}
                      value={l.account_code}
                      onChange={v => updateLine(idx, 'account_code', v)}
                      placeholder="— Compte —"
                    />
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
                    <button onClick={() => setEntryLines(p => p.filter((_, i) => i !== idx))} disabled={entryLines.length <= 2} className="p-1 rounded hover:bg-red-50 text-red-400 disabled:opacity-30 text-xs">x</button>
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
        footer={<button onClick={() => setDetailOpen(false)} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>}>
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div className="card p-3"><div className="text-xs text-slate-500">Journal</div><div className="font-semibold mt-0.5">{JOURNAL_TYPES[selected.journal_type] || selected.journal_type}</div></div>
              <div className="card p-3"><div className="text-xs text-slate-500">Date</div><div className="font-semibold mt-0.5">{formatDate(selected.entry_date)}</div></div>
              <div className="card p-3"><div className="text-xs text-slate-500">Total débit</div><div className="font-bold mt-0.5">{Number(selected.total_debit).toLocaleString('fr-FR')} FCFA</div></div>
              <div className="card p-3"><div className="text-xs text-slate-500">Total crédit</div><div className="font-bold mt-0.5">{Number(selected.total_credit).toLocaleString('fr-FR')} FCFA</div></div>
            </div>
            {selected.source_type && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <FileText className="w-3.5 h-3.5" />
                <span>Source : {selected.source_type} ({selected.reference})</span>
              </div>
            )}
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr><th className="px-4 py-2 text-left">Compte</th><th className="px-4 py-2 text-left">Libellé</th><th className="px-4 py-2 text-right">Débit</th><th className="px-4 py-2 text-right">Crédit</th></tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
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

/* ===================== BALANCE GENERALE (via RPC) ===================== */
function BalanceTab() {
  const { tenant } = useApp();
  const { success, error: toastError } = useToast();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'month' | 'year' | 'all'>('year');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkPayBusy, setBulkPayBusy] = useState(false);
  const [bulkAchatBusy, setBulkAchatBusy] = useState(false);
  const [bulkPayFournBusy, setBulkPayFournBusy] = useState(false);

  const load = async () => {
    if (!tenant) return;
    setLoading(true);
    const now = new Date();
    let dateFrom: string | null = null;
    if (period === 'month') dateFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    else if (period === 'year') dateFrom = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);

    const { data: rows, error } = await supabase.rpc('balance_generale', {
      p_tenant_id: tenant.id,
      p_date_from: dateFrom,
      p_date_to: null,
    });
    if (error) { toastError(error.message); setLoading(false); return; }
    setData(rows || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [tenant?.id, period]);

  const totalDebit = data.reduce((s: number, r: any) => s + Number(r.total_debit), 0);
  const totalCredit = data.reduce((s: number, r: any) => s + Number(r.total_credit), 0);

  const comptabiliserTout = async () => {
    if (!tenant || bulkBusy) return;
    setBulkBusy(true);
    try {
      const { data: result, error } = await supabase.rpc('comptabiliser_ventes_en_masse', { p_tenant_id: tenant.id });
      if (error) throw error;
      const r = result as any;
      success(`${r.accounted} vente${r.accounted > 1 ? 's' : ''} comptabilisée${r.accounted > 1 ? 's' : ''} ${r.errors > 0 ? `(${r.errors} erreur${r.errors > 1 ? 's' : ''})` : ''}`);
      load();
    } catch (e: any) { toastError(e.message); }
    finally { setBulkBusy(false); }
  };

  const comptabiliserReglements = async () => {
    if (!tenant || bulkPayBusy) return;
    setBulkPayBusy(true);
    try {
      const { data: result, error } = await supabase.rpc('comptabiliser_reglements_clients_en_masse', { p_tenant_id: tenant.id });
      if (error) throw error;
      const r = result as any;
      success(`${r.accounted} règlement${r.accounted > 1 ? 's' : ''} client${r.accounted > 1 ? 's' : ''} comptabilisé${r.accounted > 1 ? 's' : ''} ${r.errors > 0 ? `(${r.errors} erreur${r.errors > 1 ? 's' : ''})` : ''}`);
      load();
    } catch (e: any) { toastError(e.message); }
    finally { setBulkPayBusy(false); }
  };

  const comptabiliserAchats = async () => {
    if (!tenant || bulkAchatBusy) return;
    setBulkAchatBusy(true);
    try {
      const { data: result, error } = await supabase.rpc('comptabiliser_achats_en_masse', { p_tenant_id: tenant.id });
      if (error) throw error;
      const r = result as any;
      success(`${r.accounted} achat${r.accounted > 1 ? 's' : ''} comptabilisé${r.accounted > 1 ? 's' : ''} ${r.errors > 0 ? `(${r.errors} erreur${r.errors > 1 ? 's' : ''})` : ''}`);
      load();
    } catch (e: any) { toastError(e.message); }
    finally { setBulkAchatBusy(false); }
  };

  const comptabiliserReglFourn = async () => {
    if (!tenant || bulkPayFournBusy) return;
    setBulkPayFournBusy(true);
    try {
      const { data: result, error } = await supabase.rpc('comptabiliser_reglements_fournisseurs_en_masse', { p_tenant_id: tenant.id });
      if (error) throw error;
      const r = result as any;
      success(`${r.accounted} règlement${r.accounted > 1 ? 's' : ''} fournisseur${r.accounted > 1 ? 's' : ''} comptabilisé${r.accounted > 1 ? 's' : ''} ${r.errors > 0 ? `(${r.errors} erreur${r.errors > 1 ? 's' : ''})` : ''}`);
      load();
    } catch (e: any) { toastError(e.message); }
    finally { setBulkPayFournBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <select value={period} onChange={e => setPeriod(e.target.value as any)} className="input w-48">
          <option value="month">Mois en cours</option>
          <option value="year">Exercice en cours</option>
          <option value="all">Tout</option>
        </select>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={comptabiliserTout} disabled={bulkBusy} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100 transition disabled:opacity-50">
            {bulkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
            Ventes
          </button>
          <button onClick={comptabiliserReglements} disabled={bulkPayBusy} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-neutral-50 text-neutral-800 border border-neutral-200 hover:bg-neutral-100 transition disabled:opacity-50">
            {bulkPayBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
            Rglts clients
          </button>
          <button onClick={comptabiliserAchats} disabled={bulkAchatBusy} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition disabled:opacity-50">
            {bulkAchatBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
            Achats
          </button>
          <button onClick={comptabiliserReglFourn} disabled={bulkPayFournBusy} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 transition disabled:opacity-50">
            {bulkPayFournBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
            Rglts fournisseurs
          </button>
        </div>
      </div>

      {loading ? <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
        : data.length === 0 ? (
          <div className="card py-12 text-center text-sm text-neutral-500">Aucune écriture pour la période sélectionnée.</div>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-xs uppercase text-neutral-600">
                  <tr>
                    <th className="px-4 py-3 text-left">Compte</th>
                    <th className="px-4 py-3 text-left">Intitulé</th>
                    <th className="px-4 py-3 text-right">Débit (FCFA)</th>
                    <th className="px-4 py-3 text-right">Crédit (FCFA)</th>
                    <th className="px-4 py-3 text-right">Solde débiteur</th>
                    <th className="px-4 py-3 text-right">Solde créditeur</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {data.map((r: any) => (
                    <tr key={r.account_code} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2.5 font-mono text-xs text-brand-700">{r.account_code}</td>
                      <td className="px-4 py-2.5 text-neutral-700">{r.account_name}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">{Number(r.total_debit) > 0 ? Number(r.total_debit).toLocaleString('fr-FR') : '—'}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">{Number(r.total_credit) > 0 ? Number(r.total_credit).toLocaleString('fr-FR') : '—'}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold text-emerald-700">{Number(r.solde_debiteur) > 0 ? Number(r.solde_debiteur).toLocaleString('fr-FR') : '—'}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold text-red-600">{Number(r.solde_crediteur) > 0 ? Number(r.solde_crediteur).toLocaleString('fr-FR') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-neutral-50 border-t-2 border-neutral-200 font-semibold text-sm">
                  <tr>
                    <td className="px-4 py-3" colSpan={2}>TOTAL</td>
                    <td className="px-4 py-3 text-right font-mono">{totalDebit.toLocaleString('fr-FR')}</td>
                    <td className="px-4 py-3 text-right font-mono">{totalCredit.toLocaleString('fr-FR')}</td>
                    <td className="px-4 py-3 text-right font-mono text-emerald-700">{Math.max(0, totalDebit - totalCredit).toLocaleString('fr-FR')}</td>
                    <td className="px-4 py-3 text-right font-mono text-red-600">{Math.max(0, totalCredit - totalDebit).toLocaleString('fr-FR')}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
    </div>
  );
}

/* ===================== GRAND LIVRE ===================== */
function GrandLivreTab() {
  const { tenant } = useApp();
  const { error: toastError } = useToast();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'month' | 'year' | 'all'>('month');
  const [accountFilter, setAccountFilter] = useState('');
  const [accounts, setAccounts] = useState<any[]>([]);

  useEffect(() => {
    if (!tenant) return;
    supabase.from('accounts').select('code, name').eq('tenant_id', tenant.id).order('code').then(({ data }) => setAccounts(data || []));
  }, [tenant?.id]);

  const load = async () => {
    if (!tenant) return;
    setLoading(true);
    const now = new Date();
    let dateFrom: string | null = null;
    if (period === 'month') dateFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    else if (period === 'year') dateFrom = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);

    const { data: rows, error } = await supabase.rpc('grand_livre', {
      p_tenant_id: tenant.id,
      p_date_from: dateFrom,
      p_date_to: null,
      p_account_code: accountFilter || null,
    });
    if (error) { toastError(error.message); setLoading(false); return; }
    setData(rows || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [tenant?.id, period, accountFilter]);

  const groupedByAccount = useMemo(() => {
    const map: Record<string, { code: string; name: string; lines: any[]; totalDebit: number; totalCredit: number }> = {};
    data.forEach((r: any) => {
      if (!map[r.account_code]) map[r.account_code] = { code: r.account_code, name: r.account_name, lines: [], totalDebit: 0, totalCredit: 0 };
      map[r.account_code].lines.push(r);
      map[r.account_code].totalDebit += Number(r.debit);
      map[r.account_code].totalCredit += Number(r.credit);
    });
    return Object.values(map).sort((a, b) => a.code.localeCompare(b.code));
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <select value={period} onChange={e => setPeriod(e.target.value as any)} className="input w-48">
          <option value="month">Mois en cours</option>
          <option value="year">Exercice en cours</option>
          <option value="all">Tout</option>
        </select>
        <div className="w-64">
          <SearchableSelect
            options={[{ value: '', label: 'Tous les comptes' }, ...accounts.map(a => ({ value: a.code, label: `${a.code} — ${a.name}` }))]}
            value={accountFilter}
            onChange={v => setAccountFilter(v)}
            placeholder="Tous les comptes"
          />
        </div>
        <p className="text-sm text-slate-500 ml-auto">{data.length} mouvement{data.length > 1 ? 's' : ''}</p>
      </div>

      {loading ? <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
        : groupedByAccount.length === 0 ? (
          <div className="card py-12 text-center text-sm text-neutral-500">Aucun mouvement pour la période sélectionnée.</div>
        ) : (
          <div className="space-y-4">
            {groupedByAccount.map(group => {
              const solde = group.totalDebit - group.totalCredit;
              return (
                <div key={group.code} className="card overflow-hidden">
                  <div className="px-4 py-2.5 bg-neutral-50 border-b border-neutral-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-brand-700 font-bold">{group.code}</span>
                      <span className="text-sm font-semibold text-neutral-800">{group.name}</span>
                    </div>
                    <span className={`text-xs font-bold font-mono ${solde >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                      Solde : {solde.toLocaleString('fr-FR')} FCFA
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-[10px] uppercase text-neutral-500 bg-white">
                        <tr>
                          <th className="px-4 py-2 text-left">Date</th>
                          <th className="px-4 py-2 text-left">N° Pièce</th>
                          <th className="px-4 py-2 text-left">Journal</th>
                          <th className="px-4 py-2 text-left">Libellé</th>
                          <th className="px-4 py-2 text-right">Débit</th>
                          <th className="px-4 py-2 text-right">Crédit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-50">
                        {group.lines.map((l: any, idx: number) => (
                          <tr key={idx} className="hover:bg-neutral-50/40">
                            <td className="px-4 py-2 text-xs text-neutral-600">{formatDate(l.entry_date)}</td>
                            <td className="px-4 py-2 font-mono text-xs text-neutral-500">{l.entry_number}</td>
                            <td className="px-4 py-2"><span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-neutral-100 text-neutral-600">{l.journal_type}</span></td>
                            <td className="px-4 py-2 text-neutral-700 text-xs">{l.label || l.reference || '—'}</td>
                            <td className="px-4 py-2 text-right font-mono text-xs">{Number(l.debit) > 0 ? Number(l.debit).toLocaleString('fr-FR') : ''}</td>
                            <td className="px-4 py-2 text-right font-mono text-xs">{Number(l.credit) > 0 ? Number(l.credit).toLocaleString('fr-FR') : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-neutral-50 border-t border-neutral-200 text-xs font-semibold">
                        <tr>
                          <td className="px-4 py-2" colSpan={4}>TOTAL</td>
                          <td className="px-4 py-2 text-right font-mono">{group.totalDebit.toLocaleString('fr-FR')}</td>
                          <td className="px-4 py-2 text-right font-mono">{group.totalCredit.toLocaleString('fr-FR')}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}

/* ===================== BALANCE DES TIERS ===================== */
function TiersTab() {
  const { tenant } = useApp();
  const { error: toastError } = useToast();
  const [tiers, setTiers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<'client' | 'fournisseur'>('client');
  const [selected, setSelected] = useState<any | null>(null);
  const [extrait, setExtrait] = useState<any[]>([]);
  const [extraitLoading, setExtraitLoading] = useState(false);

  useEffect(() => {
    if (!tenant) return;
    setLoading(true);
    supabase.rpc('balance_tiers', { p_tenant_id: tenant.id, p_tiers_type: type === 'fournisseur' ? 'supplier' : 'client' })
      .then(({ data, error }) => {
        if (error) toastError(error.message);
        else setTiers(data || []);
        setLoading(false);
      });
  }, [tenant, type]);

  function loadExtrait(account: any) {
    setSelected(account);
    setExtraitLoading(true);
    supabase.rpc('interrogation_tiers', { p_tenant_id: tenant!.id, p_tiers_id: account.tiers_id, p_tiers_type: type === 'fournisseur' ? 'supplier' : 'client' })
      .then(({ data, error }) => {
        if (error) toastError(error.message);
        else setExtrait(data || []);
        setExtraitLoading(false);
      });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => { setType('client'); setSelected(null); }} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${type === 'client' ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
          Clients
        </button>
        <button onClick={() => { setType('fournisseur'); setSelected(null); }} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${type === 'fournisseur' ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
          Fournisseurs
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-brand-700" /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Balance list */}
          <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-neutral-50 border-b border-neutral-200">
              <h3 className="text-sm font-semibold text-slate-700">Balance des {type === 'client' ? 'clients' : 'fournisseurs'}</h3>
            </div>
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 sticky top-0">
                  <tr className="text-xs text-neutral-500 uppercase">
                    <th className="px-3 py-2 text-left">Compte</th>
                    <th className="px-3 py-2 text-left">Nom</th>
                    <th className="px-3 py-2 text-right">Débit</th>
                    <th className="px-3 py-2 text-right">Crédit</th>
                    <th className="px-3 py-2 text-right">Solde</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-50">
                  {tiers.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-neutral-400">Aucun tiers trouvé</td></tr>
                  )}
                  {tiers.map((t: any) => (
                    <tr key={t.account_code} onClick={() => loadExtrait(t)} className={`cursor-pointer hover:bg-brand-50/40 transition ${selected?.account_code === t.account_code ? 'bg-brand-50' : ''}`}>
                      <td className="px-3 py-2 font-mono text-xs text-brand-700">{t.account_code}</td>
                      <td className="px-3 py-2 text-neutral-700 truncate max-w-[140px]">{t.tiers_name}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{Number(t.total_debit) > 0 ? Number(t.total_debit).toLocaleString('fr-FR') : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{Number(t.total_credit) > 0 ? Number(t.total_credit).toLocaleString('fr-FR') : '—'}</td>
                      <td className={`px-3 py-2 text-right font-mono text-xs font-semibold ${Number(t.solde) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                        {Number(t.solde).toLocaleString('fr-FR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Extrait de compte */}
          <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-neutral-50 border-b border-neutral-200">
              <h3 className="text-sm font-semibold text-slate-700">
                {selected ? `Extrait — ${selected.account_code} ${selected.tiers_name}` : 'Sélectionnez un tiers'}
              </h3>
            </div>
            {!selected ? (
              <div className="flex items-center justify-center py-16 text-sm text-neutral-400">Cliquez sur un tiers pour voir son extrait</div>
            ) : extraitLoading ? (
              <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-brand-700" /></div>
            ) : (
              <div className="max-h-[60vh] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50 sticky top-0">
                    <tr className="text-xs text-neutral-500 uppercase">
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Pièce</th>
                      <th className="px-3 py-2 text-left">Libellé</th>
                      <th className="px-3 py-2 text-right">Débit</th>
                      <th className="px-3 py-2 text-right">Crédit</th>
                      <th className="px-3 py-2 text-right">Solde</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-50">
                    {extrait.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-neutral-400">Aucune écriture</td></tr>
                    )}
                    {extrait.map((e: any, idx: number) => (
                      <tr key={idx} className="hover:bg-slate-50/40">
                        <td className="px-3 py-2 text-xs text-neutral-600">{formatDate(e.entry_date)}</td>
                        <td className="px-3 py-2 font-mono text-xs text-neutral-500">{e.entry_number}</td>
                        <td className="px-3 py-2 text-neutral-700 text-xs">{e.label || '—'}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{Number(e.debit) > 0 ? Number(e.debit).toLocaleString('fr-FR') : ''}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{Number(e.credit) > 0 ? Number(e.credit).toLocaleString('fr-FR') : ''}</td>
                        <td className={`px-3 py-2 text-right font-mono text-xs font-semibold ${Number(e.solde_cumule) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                          {Number(e.solde_cumule).toLocaleString('fr-FR')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ===================== RECHERCHE ECRITURES ===================== */
function SearchTab() {
  const { tenant } = useApp();
  const { error: toastError } = useToast();
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ text: '', journal: '', dateFrom: '', dateTo: '', amountMin: '', amountMax: '' });
  const [detail, setDetail] = useState<any | null>(null);

  function doSearch() {
    if (!tenant) return;
    setLoading(true);
    const params: any = { p_tenant_id: tenant.id };
    if (filters.text) params.p_search = filters.text;
    if (filters.journal) params.p_journal_type = filters.journal;
    if (filters.dateFrom) params.p_date_from = filters.dateFrom;
    if (filters.dateTo) params.p_date_to = filters.dateTo;
    if (filters.amountMin) params.p_amount_min = Number(filters.amountMin);
    if (filters.amountMax) params.p_amount_max = Number(filters.amountMax);

    supabase.rpc('recherche_ecritures', params)
      .then(({ data, error }) => {
        if (error) toastError(error.message);
        else setResults(data || []);
        setLoading(false);
      });
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <input type="text" placeholder="Texte libre (libellé, pièce...)" value={filters.text} onChange={e => setFilters(f => ({ ...f, text: e.target.value }))} className="rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none" />
          <select value={filters.journal} onChange={e => setFilters(f => ({ ...f, journal: e.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none">
            <option value="">Tous journaux</option>
            {Object.entries(JOURNAL_TYPES).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
          </select>
          <input type="date" value={filters.dateFrom} onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none" placeholder="Date début" />
          <input type="date" value={filters.dateTo} onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none" placeholder="Date fin" />
          <input type="number" placeholder="Montant min" value={filters.amountMin} onChange={e => setFilters(f => ({ ...f, amountMin: e.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none" />
          <input type="number" placeholder="Montant max" value={filters.amountMax} onChange={e => setFilters(f => ({ ...f, amountMax: e.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none" />
          <div className="sm:col-span-2 lg:col-span-2 flex items-end">
            <button onClick={doSearch} disabled={loading} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-brand-700 text-white rounded-lg text-sm font-medium hover:bg-brand-800 transition disabled:opacity-50">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Rechercher
            </button>
          </div>
        </div>
      </div>

      {results.length > 0 && (
        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-neutral-50 border-b border-neutral-200 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">{results.length} résultat{results.length > 1 ? 's' : ''}</span>
          </div>
          <div className="max-h-[50vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 sticky top-0">
                <tr className="text-xs text-slate-500 uppercase">
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-left">Pièce</th>
                  <th className="px-4 py-2 text-left">Journal</th>
                  <th className="px-4 py-2 text-left">Compte</th>
                  <th className="px-4 py-2 text-left">Libellé</th>
                  <th className="px-4 py-2 text-right">Débit</th>
                  <th className="px-4 py-2 text-right">Crédit</th>
                  <th className="px-4 py-2 text-center">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {results.map((r: any, idx: number) => (
                  <tr key={idx} onClick={() => setDetail(r)} className="hover:bg-neutral-50/60 cursor-pointer">
                    <td className="px-4 py-2 text-xs text-neutral-600">{formatDate(r.entry_date)}</td>
                    <td className="px-4 py-2 font-mono text-xs text-neutral-500">{r.entry_number}</td>
                    <td className="px-4 py-2"><span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-neutral-100 text-neutral-600">{r.journal_type}</span></td>
                    <td className="px-4 py-2 font-mono text-xs text-brand-700">{r.account_code}</td>
                    <td className="px-4 py-2 text-neutral-700 text-xs max-w-[200px] truncate">{r.label || r.reference || '—'}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{Number(r.debit) > 0 ? Number(r.debit).toLocaleString('fr-FR') : ''}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{Number(r.credit) > 0 ? Number(r.credit).toLocaleString('fr-FR') : ''}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold ${r.status === 'validated' ? 'bg-emerald-100 text-emerald-700' : r.status === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                        {r.status === 'validated' ? 'OK' : r.status === 'cancelled' ? 'ANN' : 'BR'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detail && (
        <Modal open onClose={() => setDetail(null)} title="Détail écriture">
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div><span className="text-slate-500">Pièce:</span> <span className="font-mono font-semibold">{detail.entry_number}</span></div>
              <div><span className="text-slate-500">Journal:</span> <span className="font-semibold">{detail.journal_type}</span></div>
              <div><span className="text-slate-500">Date:</span> {formatDate(detail.entry_date)}</div>
              <div><span className="text-slate-500">Compte:</span> <span className="font-mono text-brand-700">{detail.account_code}</span></div>
            </div>
            <div><span className="text-slate-500">Libellé:</span> {detail.label || '—'}</div>
            <div className="flex gap-6">
              <div><span className="text-slate-500">Débit:</span> <span className="font-mono font-semibold">{Number(detail.debit).toLocaleString('fr-FR')}</span></div>
              <div><span className="text-slate-500">Crédit:</span> <span className="font-mono font-semibold">{Number(detail.credit).toLocaleString('fr-FR')}</span></div>
            </div>
            {detail.reference && <div><span className="text-slate-500">Référence:</span> {detail.reference}</div>}
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ===================== CLOTURES ===================== */
function ClotureTab() {
  const { tenant } = useApp();
  const { success, error: toastError } = useToast();
  const [journalType, setJournalType] = useState('VE');
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [exercice, setExercice] = useState(() => String(new Date().getFullYear()));
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmJournal, setConfirmJournal] = useState(false);
  const [confirmExercice, setConfirmExercice] = useState(false);

  async function clotureJournal() {
    if (!tenant) return;
    setBusy('journal');
    const { data, error } = await supabase.rpc('cloturer_journal', {
      p_tenant_id: tenant.id,
      p_journal_type: journalType,
      p_month: month + '-01',
    });
    if (error) toastError(error.message);
    else success(`Journal ${journalType} clôturé pour ${month} — ${data?.closed_count || 0} écritures validées`);
    setBusy(null);
    setConfirmJournal(false);
  }

  async function clotureExercice() {
    if (!tenant) return;
    setBusy('exercice');
    const { data, error } = await supabase.rpc('cloturer_exercice', {
      p_tenant_id: tenant.id,
      p_year: Number(exercice),
    });
    if (error) toastError(error.message);
    else success(`Exercice ${exercice} clôturé — ${data?.closed_count || 0} écritures validées`);
    setBusy(null);
    setConfirmExercice(false);
  }

  return (
    <div className="space-y-6">
      {/* Clôture journal */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h3 className="text-base font-semibold text-slate-800 mb-1">Clôture de journal</h3>
        <p className="text-xs text-slate-500 mb-4">Valider toutes les écritures brouillon d'un journal pour un mois donné. Cette action est irréversible.</p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Journal</label>
            <select value={journalType} onChange={e => setJournalType(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none">
              {Object.entries(JOURNAL_TYPES).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Mois</label>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none" />
          </div>
          <button onClick={() => setConfirmJournal(true)} disabled={busy === 'journal'} className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 transition disabled:opacity-50">
            {busy === 'journal' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            Clôturer
          </button>
        </div>
      </div>

      {/* Clôture exercice */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h3 className="text-base font-semibold text-slate-800 mb-1">Clôture d'exercice</h3>
        <p className="text-xs text-slate-500 mb-4">Valider toutes les écritures brouillon de l'année complète. Cette action est irréversible et concerne tous les journaux.</p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Exercice</label>
            <input type="number" min="2020" max="2030" value={exercice} onChange={e => setExercice(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm w-32 focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none" />
          </div>
          <button onClick={() => setConfirmExercice(true)} disabled={busy === 'exercice'} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition disabled:opacity-50">
            {busy === 'exercice' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            Clôturer l'exercice
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmJournal}
        title="Confirmer la clôture"
        message={`Vous allez clôturer le journal ${journalType} pour ${month}. Toutes les écritures brouillon seront validées et ne pourront plus être modifiées.`}
        onConfirm={clotureJournal}
        onClose={() => setConfirmJournal(false)}
      />
      <ConfirmDialog
        open={confirmExercice}
        title="Confirmer la clôture d'exercice"
        message={`Vous allez clôturer l'exercice ${exercice} pour tous les journaux. Toutes les écritures brouillon de l'année seront validées et ne pourront plus être modifiées.`}
        onConfirm={clotureExercice}
        onClose={() => setConfirmExercice(false)}
      />
    </div>
  );
}
