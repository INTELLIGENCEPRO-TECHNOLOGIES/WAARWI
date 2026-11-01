import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, Search, X, Users, CreditCard as Edit2, Info, Monitor, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { Modal } from './Modal';
import { usePermissions } from '../lib/permissions';
import { desktopAutoFocus } from '../lib/device';
import { MultiCashModeSection } from './MultiCashModeSection';

type Assignee = { user_id: string; full_name: string | null; email: string | null; role: string | null };

type Register = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  is_default: boolean;
  active_assignment_count: number;
  has_open_session: boolean;
  open_session_user_name: string | null;
  open_session_opened_at: string | null;
  assignees: Assignee[] | null;
};

type EligibleUser = { user_id: string; full_name: string | null; email: string | null; role: string | null; assignment_status: 'active' | 'inactive' | 'none' };

type FormState = { id: string; site_id: string; code: string; name: string; is_active: boolean; is_default: boolean };

const ROLE_LABELS: Record<string, string> = { super_admin: 'Super admin', admin: 'Administrateur', manager: 'Gérant', cashier: 'Caissier', viewer: 'Lecteur' };

const roleLabel = (r: string | null) => (r && ROLE_LABELS[r]) || r || '—';
const displayName = (u: { full_name: string | null; email: string | null }) => (u.full_name || '').trim() || u.email || 'Sans nom';

function formatOpened(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${checked ? 'bg-neutral-900' : 'bg-neutral-300'}`}>
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </button>
  );
}

export function CashRegistersTab() {
  const { sites, depots, currentSite, loading: appLoading } = useApp();
  const { can } = usePermissions();
  const canEdit = can('manage_cash_sessions') && can('manage_settings');
  const canEditAssignments = canEdit && can('manage_users');
  const { success, error } = useToast();
  const allSites = useMemo(() => [...sites.filter(s => !s.is_warehouse), ...depots], [sites, depots]);
  const [siteId, setSiteId] = useState<string>('');
  const [registers, setRegisters] = useState<Register[]>([]);
  const [canAssign, setCanAssign] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [editing, setEditing] = useState<Register | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<Register | null>(null);
  const loadRef = useRef(0);

  // The settings page owns its own store choice: it starts from the app's current store when there is one, but never waits for it.
  useEffect(() => {
    if (appLoading) return;
    if (siteId && allSites.some(s => s.id === siteId)) return;
    const preferred = currentSite ? allSites.find(s => s.id === currentSite.id) : undefined;
    setSiteId(preferred?.id || allSites[0]?.id || '');
  }, [allSites, currentSite?.id, appLoading, siteId]);

  const load = useCallback(async () => {
    const token = ++loadRef.current;
    if (!siteId) { setRegisters([]); setLoading(false); return; }
    setLoading(true);
    setLoadError(null);
    const { data, error: e } = await supabase.rpc('cash_registers_admin_list', { p_site_id: siteId });
    if (token !== loadRef.current) return;
    setLoading(false);
    if (e) { setLoadError(e.message); setRegisters([]); setCanAssign(false); return; }
    const payload = data as { can_manage_assignments?: boolean; registers?: Register[] } | null;
    if (!payload || !Array.isArray(payload.registers)) { setLoadError('Réponse inattendue du serveur'); setRegisters([]); setCanAssign(false); return; }
    setRegisters(payload.registers);
    setCanAssign(!!payload.can_manage_assignments && canEditAssignments);
  }, [siteId, canEditAssignments]);

  useEffect(() => { load(); }, [load]);

  const changeSite = (id: string) => {
    if (id === siteId) return;
    setFormOpen(false);
    setForm(null);
    setEditing(null);
    setFormError(null);
    setAssignFor(null);
    setRegisters([]);
    setCanAssign(false);
    setLoadError(null);
    setSiteId(id);
  };

  const openCreate = () => {
    setEditing(null);
    const n = registers.length + 1;
    setForm({ id: crypto.randomUUID(), site_id: siteId, code: `CAISSE-${n}`, name: `Caisse ${n}`, is_active: true, is_default: false });
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (r: Register) => {
    setEditing(r);
    setForm({ id: r.id, site_id: siteId, code: r.code, name: r.name, is_active: r.is_active, is_default: r.is_default });
    setFormError(null);
    setFormOpen(true);
  };

  const save = async () => {
    if (!form || !form.site_id) return;
    if (!form.code.trim() || !form.name.trim()) { setFormError('Le code et le nom sont obligatoires'); return; }
    const targetSite = form.site_id;
    setSaving(true);
    setFormError(null);
    const { error: e } = await supabase.rpc('cash_register_upsert', {
      p_register_id: form.id, p_site_id: targetSite, p_code: form.code, p_name: form.name,
      p_is_active: form.is_active, p_is_default: form.is_default,
    });
    setSaving(false);
    if (e) { setFormError(e.message); return; }
    success(editing ? 'Caisse modifiée' : 'Caisse créée');
    setFormOpen(false);
    load();
  };

  const siteLabel = (id: string) => {
    const s = allSites.find(x => x.id === id);
    return s ? (s.is_warehouse ? `Dépôt · ${s.name}` : s.name) : '';
  };
  const lockActive = !!editing && (editing.is_default || (editing.is_active && editing.has_open_session));
  const lockDefault = !!editing && editing.is_default;

  return (
    <div className="max-w-none">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-6">
        <div>
          <h3 className="text-base sm:text-[17px] font-bold text-neutral-900 leading-snug">Caisses</h3>
          <p className="hidden sm:block mt-1 text-[13px] text-neutral-500 leading-relaxed">Créez plusieurs caisses par magasin et choisissez les collaborateurs autorisés sur chacune.</p>
        </div>
        {canEdit && <button onClick={openCreate} disabled={!siteId || loading || !!loadError}
          className="inline-flex items-center justify-center gap-2 px-4 h-10 bg-neutral-900 text-white text-[13px] font-bold rounded-[5px] hover:bg-neutral-800 transition active:translate-y-px shrink-0 disabled:opacity-40">
          <Plus className="w-4 h-4" />Nouvelle caisse
        </button>}
      </div>

      <MultiCashModeSection onChanged={load} />

      <div className="flex items-center gap-3 h-[52px] border-t border-b border-neutral-200">
        <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-neutral-500 shrink-0">Magasin</span>
        <select value={siteId} onChange={e => changeSite(e.target.value)} disabled={saving} aria-label="Magasin"
          className="flex-1 min-w-0 max-w-[360px] bg-transparent text-[13px] font-semibold text-neutral-900 outline-none cursor-pointer disabled:opacity-50">
          {allSites.length === 0 && <option value="">{appLoading ? 'Chargement…' : 'Aucun magasin accessible'}</option>}
          {allSites.map(s => <option key={s.id} value={s.id}>{s.is_warehouse ? `Dépôt · ${s.name}` : s.name}</option>)}
        </select>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />}
      </div>

      {loadError ? (
        <div className="py-10 text-center text-[13px] text-red-600">{loadError}</div>
      ) : (
        <div>
          {registers.map(r => (
            <div key={r.id} className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 py-4 border-b border-neutral-100 hover:bg-neutral-50/40 transition-colors">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 ${r.is_active ? 'bg-neutral-100 text-neutral-700' : 'bg-neutral-50 text-neutral-300'}`}>
                  <Monitor className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-bold ${r.is_active ? 'text-neutral-900' : 'text-neutral-400'}`}>{r.name}</span>
                    {r.is_default && <span className="px-1.5 py-0.5 rounded border border-neutral-300 text-[10px] font-bold uppercase tracking-wide text-neutral-600">Par défaut</span>}
                  </div>
                  <div className="font-mono text-[11.5px] text-neutral-400 mt-0.5">{r.code}</div>
                </div>
              </div>

              <div className="flex items-center gap-5 sm:gap-6 text-[12.5px] flex-wrap">
                <span className={`inline-flex items-center gap-1.5 font-semibold ${r.is_active ? 'text-emerald-700' : 'text-neutral-400'}`}>
                  {r.is_active && <span className="w-[6px] h-[6px] rounded-full bg-emerald-600" />}
                  {r.is_active ? 'Active' : 'Inactive'}
                </span>
                <span className="inline-flex items-center gap-1.5 text-neutral-600" title="Collaborateurs affectés">
                  <Users className="w-3.5 h-3.5 text-neutral-400" />{r.active_assignment_count}
                </span>
                <span className="text-neutral-500 min-w-[150px]">
                  {r.has_open_session
                    ? <span className="inline-flex items-center gap-1.5"><span className="w-[6px] h-[6px] rounded-full bg-amber-500 animate-pulse" />Ouverte · {r.open_session_user_name || '—'} · {formatOpened(r.open_session_opened_at)}</span>
                    : <span className="text-neutral-400">Aucune session ouverte</span>}
                </span>
              </div>

              <div className="flex items-center gap-1 sm:justify-end shrink-0">
                {canEdit && <button onClick={() => openEdit(r)} className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md text-[12.5px] font-semibold text-neutral-700 hover:bg-neutral-100 transition">
                  <Edit2 className="w-3.5 h-3.5 text-neutral-400" />Modifier
                </button>}
                {canAssign && (
                  <button onClick={() => setAssignFor(r)} className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md text-[12.5px] font-semibold text-neutral-700 hover:bg-neutral-100 transition">
                    <Users className="w-3.5 h-3.5 text-neutral-400" />Collaborateurs
                  </button>
                )}
              </div>
            </div>
          ))}
          {!loading && registers.length === 0 && siteId && (
            <div className="py-10 text-center text-[13px] text-neutral-400">Aucune caisse pour ce magasin</div>
          )}
        </div>
      )}

      <div className="flex gap-3 mt-6 pt-4 border-t border-neutral-200">
        <Info className="w-4 h-4 text-neutral-500 shrink-0 mt-0.5" />
        <p className="text-xs text-neutral-500 leading-relaxed">Chaque collaborateur se connecte avec son propre compte (email et mot de passe). L'affectation à une caisse s'ajoute à ses permissions : elle ne les remplace pas. L'ouverture simultanée de plusieurs caisses dans un même magasin n'est pas encore activée.</p>
      </div>

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? 'Modifier la caisse' : 'Nouvelle caisse'} size="sm" fullscreenMobile
        footer={<><button onClick={() => setFormOpen(false)} className="text-xs font-medium text-neutral-500 hover:text-neutral-700 transition">Annuler</button><button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 bg-neutral-900 text-white text-xs font-medium rounded-md hover:bg-neutral-800 transition active:scale-[0.97] disabled:opacity-50">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Enregistrer'}</button></>}>
        {form && (
          <div className="flat-form space-y-4">
            <p className="text-[12px] text-neutral-500">Magasin : <span className="font-semibold text-neutral-800">{siteLabel(form.site_id)}</span></p>
            <div><label className="label">Nom *</label><input value={form.name} maxLength={60} onChange={e => setForm({ ...form, name: e.target.value })} className="input" autoFocus={desktopAutoFocus} /></div>
            <div><label className="label">Code *</label><input value={form.code} maxLength={20} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} className="input font-mono" placeholder="CAISSE-2" /></div>
            <div className="flex items-start justify-between gap-4 pt-1">
              <div>
                <div className="text-[13px] font-semibold text-neutral-800">Caisse active</div>
                <div className="text-[11.5px] text-neutral-500 mt-0.5">{lockActive ? (editing?.is_default ? 'La caisse par défaut reste toujours active.' : 'Une session est ouverte sur cette caisse.') : 'Une caisse inactive ne peut plus être utilisée.'}</div>
              </div>
              <Switch checked={form.is_active} disabled={lockActive} onChange={v => setForm({ ...form, is_active: v, is_default: v ? form.is_default : false })} />
            </div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[13px] font-semibold text-neutral-800">Caisse par défaut</div>
                <div className="text-[11.5px] text-neutral-500 mt-0.5">{lockDefault ? 'Pour changer, définissez une autre caisse par défaut.' : "Remplacera l'actuelle caisse par défaut du magasin."}</div>
              </div>
              <Switch checked={form.is_default} disabled={lockDefault || !form.is_active} onChange={v => setForm({ ...form, is_default: v })} />
            </div>
            {formError && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{formError}</div>}
          </div>
        )}
      </Modal>

      {assignFor && (
        <AssignmentsModal key={assignFor.id} register={assignFor} onClose={() => setAssignFor(null)}
          onSaved={() => { setAssignFor(null); success('Affectations enregistrées'); load(); }}
          onLoadError={(m) => { setAssignFor(null); error(m); }} />
      )}
    </div>
  );
}

function AssignmentsModal({ register, onClose, onSaved, onLoadError }: { register: Register; onClose: () => void; onSaved: () => void; onLoadError: (m: string) => void }) {
  const [users, setUsers] = useState<EligibleUser[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: e } = await supabase.rpc('cash_register_eligible_users', { p_register_id: register.id });
      if (cancelled) return;
      if (e || !Array.isArray(data)) { onLoadError(e?.message || 'Réponse inattendue du serveur'); return; }
      const list = data as EligibleUser[];
      setUsers(list);
      setSelected(new Set(list.filter(u => u.assignment_status === 'active').map(u => u.user_id)));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [register.id]);

  const eligibleIds = useMemo(() => new Set(users.map(u => u.user_id)), [users]);
  const noLongerEligible = (register.assignees || []).filter(a => !eligibleIds.has(a.user_id));

  const q = search.trim().toLowerCase();
  const filtered = q ? users.filter(u => `${u.full_name || ''} ${u.email || ''} ${roleLabel(u.role)}`.toLowerCase().includes(q)) : users;

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    const { error: e } = await supabase.rpc('cash_register_set_assignments', { p_register_id: register.id, p_user_ids: Array.from(selected) });
    setSaving(false);
    if (e) { setSaveError(e.message); return; }
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title={`Collaborateurs · ${register.name}`} size="md" fullscreenMobile
      footer={<><span className="mr-auto text-[12px] text-neutral-500">{selected.size} sélectionné{selected.size > 1 ? 's' : ''}</span><button onClick={onClose} className="text-xs font-medium text-neutral-500 hover:text-neutral-700 transition">Annuler</button><button onClick={save} disabled={saving || loading} className="inline-flex items-center gap-1.5 px-4 py-2 bg-neutral-900 text-white text-xs font-medium rounded-md hover:bg-neutral-800 transition active:scale-[0.97] disabled:opacity-50">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Enregistrer'}</button></>}>
      <div className="space-y-3">
        <div className="flex items-center gap-2.5 h-10 px-3 rounded-md border border-neutral-200 focus-within:border-neutral-400 transition-colors">
          <Search className="w-4 h-4 text-neutral-400 shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un collaborateur..." className="w-full bg-transparent text-[13px] text-neutral-900 placeholder:text-neutral-400 outline-none" autoFocus={desktopAutoFocus} />
          {search && <button onClick={() => setSearch('')} className="p-0.5 text-neutral-400 hover:text-neutral-600"><X className="w-3.5 h-3.5" /></button>}
        </div>

        {loading ? (
          <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-neutral-400" /></div>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto -mx-1">
            {filtered.map(u => {
              const on = selected.has(u.user_id);
              return (
                <button key={u.user_id} type="button" onClick={() => toggle(u.user_id)}
                  className="w-full flex items-center gap-3 px-1 py-2.5 border-b border-neutral-100 text-left hover:bg-neutral-50 transition-colors">
                  <span className={`w-[18px] h-[18px] rounded border flex items-center justify-center shrink-0 transition-colors ${on ? 'bg-neutral-900 border-neutral-900' : 'border-neutral-300 bg-white'}`}>
                    {on && <Check className="w-3 h-3 text-white" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-neutral-900 truncate">{displayName(u)}</span>
                    <span className="block text-[11.5px] text-neutral-500 truncate">{u.email || '—'}</span>
                  </span>
                  <span className="text-[11px] font-semibold text-neutral-500 shrink-0">{roleLabel(u.role)}</span>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="py-8 text-center text-[13px] text-neutral-400">{q ? 'Aucun collaborateur trouvé' : 'Aucun collaborateur éligible pour ce magasin'}</div>
            )}
          </div>
        )}

        {noLongerEligible.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
            {noLongerEligible.map(displayName).join(', ')} {noLongerEligible.length > 1 ? 'ne sont plus éligibles et seront retirés' : "n'est plus éligible et sera retiré"} à l'enregistrement.
          </div>
        )}
        <p className="text-[11.5px] text-neutral-500 leading-relaxed">Seuls les collaborateurs actifs, ayant accès à ce magasin et disposant des permissions « Accès au POS » et « Ouvrir une session » sont proposés.</p>
        {saveError && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{saveError}</div>}
      </div>
    </Modal>
  );
}
