import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Loader2, Pencil, BarChart3, Users, Search, X, Power, Check,
  BadgePercent, TrendingUp, Receipt, Wallet, UserCheck, Download, Printer, Trash2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { usePermissions } from '../lib/permissions';
import { useToast } from '../context/ToastContext';
import { Modal, ConfirmDialog } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { formatFCFA, formatDateTime } from '../lib/format';
import {
  type SalesRepresentative, type RepCommissionSettings, DEFAULT_REP_SETTINGS,
  COMMISSION_TYPE_LABELS, COMMISSION_BASE_LABELS, repDisplayName, nextRepCode, effectiveRule,
} from '../lib/repCommission';
import { printHtmlReport } from '../lib/print';

type RepSale = {
  id: string; sale_number: string; total: number; discount: number; status: string;
  created_at: string; customer_id: string | null; site_id: string | null;
  representative_id: string; rep_commission: { amount?: number } | null;
  customers: { name: string } | null;
};

type Tab = 'list' | 'stats';

export function Representatives() {
  const { tenant, sites, profile } = useApp();
  const { can } = usePermissions();
  const { success, error } = useToast();

  const [tab, setTab] = useState<Tab>('list');
  const [loading, setLoading] = useState(true);
  const [reps, setReps] = useState<SalesRepresentative[]>([]);
  const [repSales, setRepSales] = useState<RepSale[]>([]);
  const [settings, setSettings] = useState<RepCommissionSettings>(DEFAULT_REP_SETTINGS);
  const [search, setSearch] = useState('');

  // Form modal
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    code: '', first_name: '', last_name: '', status: 'actif' as 'actif' | 'inactif',
    commission_override: false,
    commission_type: 'pct_ca' as 'pct_ca' | 'fixe' | 'pct_marge',
    commission_base: 'ttc' as 'ht' | 'ttc' | 'net' | 'marge',
    commission_rate: '', commission_fixed: '',
  });
  const [toDelete, setToDelete] = useState<SalesRepresentative | null>(null);

  // Stats filters
  const [statRep, setStatRep] = useState('');
  const [statSite, setStatSite] = useState('');
  const [statFrom, setStatFrom] = useState('');
  const [statTo, setStatTo] = useState('');
  const [statStatus, setStatStatus] = useState('');

  const canManage = can('rep_manage');
  const canSeeCommission = can('rep_commission_view');

  const load = async () => {
    if (!tenant) return;
    setLoading(true);
    const [r, s, st] = await Promise.all([
      supabase.from('sales_representatives').select('*').eq('tenant_id', tenant.id).order('code'),
      supabase.from('sales')
        .select('id, sale_number, total, discount, status, created_at, customer_id, site_id, representative_id, rep_commission, customers(name)')
        .eq('tenant_id', tenant.id).not('representative_id', 'is', null)
        .order('created_at', { ascending: false }).limit(2000),
      supabase.from('rep_commission_settings').select('*').eq('tenant_id', tenant.id).maybeSingle(),
    ]);
    setReps((r.data as any) || []);
    setRepSales((s.data as any) || []);
    if (st.data) {
      setSettings({
        enabled: !!st.data.enabled,
        commission_type: st.data.commission_type || 'pct_ca',
        commission_base: st.data.commission_base || 'ttc',
        rate: Number(st.data.rate || 0),
        fixed_amount: Number(st.data.fixed_amount || 0),
      });
    }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenant?.id]);

  const activeSales = useMemo(() => repSales.filter(s => s.status !== 'cancelled'), [repSales]);

  const aggByRep = useMemo(() => {
    const map = new Map<string, { count: number; ca: number; commission: number; cancelled: number }>();
    for (const s of repSales) {
      const a = map.get(s.representative_id) || { count: 0, ca: 0, commission: 0, cancelled: 0 };
      if (s.status === 'cancelled') {
        a.cancelled += 1;
      } else {
        a.count += 1;
        a.ca += Number(s.total || 0);
        a.commission += Number(s.rep_commission?.amount || 0);
      }
      map.set(s.representative_id, a);
    }
    return map;
  }, [repSales]);

  const filteredReps = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return reps;
    return reps.filter(r =>
      r.code.toLowerCase().includes(q) ||
      r.first_name.toLowerCase().includes(q) ||
      r.last_name.toLowerCase().includes(q)
    );
  }, [reps, search]);

  // ── CRUD ──────────────────────────────────────────────────────
  const openCreate = () => {
    setEditingId(null);
    setForm({
      code: nextRepCode(reps), first_name: '', last_name: '', status: 'actif',
      commission_override: false, commission_type: settings.commission_type,
      commission_base: settings.commission_base, commission_rate: '', commission_fixed: '',
    });
    setFormOpen(true);
  };

  const openEdit = (r: SalesRepresentative) => {
    setEditingId(r.id);
    setForm({
      code: r.code, first_name: r.first_name, last_name: r.last_name, status: r.status,
      commission_override: !!r.commission_override,
      commission_type: (r.commission_type as any) || settings.commission_type,
      commission_base: (r.commission_base as any) || settings.commission_base,
      commission_rate: r.commission_rate != null ? String(r.commission_rate) : '',
      commission_fixed: r.commission_fixed != null ? String(r.commission_fixed) : '',
    });
    setFormOpen(true);
  };

  const logAudit = async (action: string, referenceId: string | null, oldValue: any, newValue: any) => {
    if (!tenant) return;
    await supabase.from('audit_logs').insert({
      tenant_id: tenant.id, user_id: profile?.id || null,
      action, module: 'representatives', reference_id: referenceId,
      old_value: oldValue, new_value: newValue,
    });
  };

  const saveRep = async () => {
    if (!tenant || saving) return;
    if (!canManage) { error('Vous n\'avez pas la permission de gérer les représentants'); return; }
    const code = form.code.trim().toUpperCase();
    if (!code) { error('Le code est obligatoire'); return; }
    if (!form.first_name.trim() || !form.last_name.trim()) { error('Prénom et nom sont obligatoires'); return; }
    setSaving(true);
    const payload = {
      code,
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      status: form.status,
      commission_override: form.commission_override,
      commission_type: form.commission_override ? form.commission_type : null,
      commission_base: form.commission_override ? form.commission_base : null,
      commission_rate: form.commission_override ? Number(form.commission_rate || 0) : 0,
      commission_fixed: form.commission_override ? Number(form.commission_fixed || 0) : 0,
      updated_at: new Date().toISOString(),
    };
    if (editingId) {
      const before = reps.find(r => r.id === editingId) || null;
      const { error: e } = await supabase.from('sales_representatives').update(payload).eq('id', editingId);
      setSaving(false);
      if (e) { error(e.message.includes('duplicate') ? 'Ce code est déjà utilisé' : e.message); return; }
      await logAudit('rep_updated', editingId, before, payload);
      success('Représentant mis à jour');
    } else {
      const { data, error: e } = await supabase.from('sales_representatives')
        .insert({ tenant_id: tenant.id, ...payload }).select('id').single();
      setSaving(false);
      if (e) { error(e.message.includes('duplicate') ? 'Ce code est déjà utilisé' : e.message); return; }
      await logAudit('rep_created', data?.id || null, null, payload);
      success('Représentant créé');
    }
    setFormOpen(false);
    load();
  };

  const toggleStatus = async (r: SalesRepresentative) => {
    if (!canManage) { error('Vous n\'avez pas la permission de gérer les représentants'); return; }
    const next = r.status === 'actif' ? 'inactif' : 'actif';
    const { error: e } = await supabase.from('sales_representatives')
      .update({ status: next, updated_at: new Date().toISOString() }).eq('id', r.id);
    if (e) { error(e.message); return; }
    await logAudit('rep_status_changed', r.id, { status: r.status }, { status: next });
    success(next === 'actif' ? 'Représentant activé' : 'Représentant désactivé');
    load();
  };

  const deleteRep = async () => {
    if (!toDelete || !canManage) return;
    const used = repSales.some(s => s.representative_id === toDelete.id);
    if (used) { error('Suppression impossible : ce représentant est lié à des ventes. Désactivez-le plutôt.'); setToDelete(null); return; }
    const { error: e } = await supabase.from('sales_representatives').delete().eq('id', toDelete.id);
    if (e) { error('Suppression impossible : ce représentant est lié à des documents.'); setToDelete(null); return; }
    await logAudit('rep_deleted', toDelete.id, toDelete, null);
    success('Représentant supprimé');
    setToDelete(null);
    load();
  };

  // ── Stats ─────────────────────────────────────────────────────
  const statSales = useMemo(() => {
    return repSales.filter(s => {
      if (statRep && s.representative_id !== statRep) return false;
      if (statSite && s.site_id !== statSite) return false;
      if (statStatus === 'cancelled' && s.status !== 'cancelled') return false;
      if (statStatus === 'active' && s.status === 'cancelled') return false;
      const d = s.created_at.slice(0, 10);
      if (statFrom && d < statFrom) return false;
      if (statTo && d > statTo) return false;
      return true;
    });
  }, [repSales, statRep, statSite, statStatus, statFrom, statTo]);

  const kpi = useMemo(() => {
    const act = statSales.filter(s => s.status !== 'cancelled');
    const cancelled = statSales.filter(s => s.status === 'cancelled');
    const ca = act.reduce((s, x) => s + Number(x.total || 0), 0);
    const remises = act.reduce((s, x) => s + Number(x.discount || 0), 0);
    const commission = act.reduce((s, x) => s + Number(x.rep_commission?.amount || 0), 0);
    const clients = new Set(act.filter(x => x.customer_id).map(x => x.customer_id)).size;
    return {
      count: act.length, ca, remises, commission, clients,
      panier: act.length > 0 ? ca / act.length : 0,
      cancelled: cancelled.length,
      cancelledTotal: cancelled.reduce((s, x) => s + Number(x.total || 0), 0),
    };
  }, [statSales]);

  const repName = (id: string) => {
    const r = reps.find(x => x.id === id);
    return r ? repDisplayName(r) : '—';
  };
  const siteName = (id: string | null) => sites.find(s => s.id === id)?.name || '—';

  const exportExcel = async () => {
    if (!can('rep_export')) { error('Vous n\'avez pas la permission d\'exporter'); return; }
    const XLSX = await import('xlsx');
    const rows = statSales.map(s => ({
      'N° document': s.sale_number,
      'Date': formatDateTime(s.created_at),
      'Représentant': repName(s.representative_id),
      'Client': s.customers?.name || '—',
      'Magasin': siteName(s.site_id),
      'Montant (FCFA)': Number(s.total || 0),
      'Remise (FCFA)': Number(s.discount || 0),
      ...(canSeeCommission ? { 'Commission (FCFA)': Number(s.rep_commission?.amount || 0) } : {}),
      'Statut': s.status === 'cancelled' ? 'Annulée' : 'Active',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Représentants');
    XLSX.writeFile(wb, `ventes-representants-${new Date().toISOString().slice(0, 10)}.xlsx`);
    success('Export généré');
  };

  const printReport = () => {
    if (!can('rep_export')) { error('Vous n\'avez pas la permission d\'imprimer'); return; }
    const rows = statSales.map(s => `
      <tr>
        <td>${s.sale_number}</td>
        <td>${formatDateTime(s.created_at)}</td>
        <td>${repName(s.representative_id)}</td>
        <td>${s.customers?.name || '—'}</td>
        <td style="text-align:right">${formatFCFA(Number(s.total || 0))}</td>
        ${canSeeCommission ? `<td style="text-align:right">${formatFCFA(Number(s.rep_commission?.amount || 0))}</td>` : ''}
        <td>${s.status === 'cancelled' ? 'Annulée' : 'Active'}</td>
      </tr>`).join('');
    printHtmlReport({
      title: 'Rapport des représentants',
      subtitle: `${tenant?.name || ''} — ${statFrom || '…'} au ${statTo || '…'}`,
      kpis: [
        { label: 'Nombre de ventes', value: String(kpi.count) },
        { label: 'CA total', value: formatFCFA(kpi.ca) },
        ...(canSeeCommission ? [{ label: 'Commission totale', value: formatFCFA(kpi.commission) }] : []),
        { label: 'Ventes annulées', value: String(kpi.cancelled) },
      ],
      tableHead: `<tr><th>N°</th><th>Date</th><th>Représentant</th><th>Client</th><th style="text-align:right">Montant</th>${canSeeCommission ? '<th style="text-align:right">Commission</th>' : ''}<th>Statut</th></tr>`,
      tableBody: rows,
    });
  };

  if (!can('rep_view')) {
    return <div className="py-16 text-center text-sm text-slate-500">Vous n'avez pas accès à cette page.</div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <h1 className="text-lg font-black text-neutral-900 flex items-center gap-2">
            <Users className="w-5 h-5 text-neutral-700" /> Représentants
          </h1>
          <p className="text-xs text-neutral-400">Gestion des représentants commerciaux et suivi des ventes</p>
        </div>
        {canManage && tab === 'list' && (
          <button onClick={openCreate} className="btn-icon-primary" title="Nouveau représentant">
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <button onClick={() => setTab('list')}
          className={`px-4 h-9 rounded-xl text-[13px] font-semibold border transition-colors ${tab === 'list' ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'}`}>
          Liste
        </button>
        {can('rep_stats_view') && (
          <button onClick={() => setTab('stats')}
            className={`px-4 h-9 rounded-xl text-[13px] font-semibold border transition-colors flex items-center gap-1.5 ${tab === 'stats' ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'}`}>
            <BarChart3 className="w-3.5 h-3.5" /> Statistiques
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-neutral-300" /></div>
      ) : tab === 'list' ? (
        <>
          {!settings.enabled && (
            <div className="text-[12px] bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-3 py-2.5">
              Les commissions sont désactivées. Activez-les dans <strong>Paramètres → Représentants & commissions</strong>.
            </div>
          )}
          <div className="relative max-w-sm">
            <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher par code, prénom, nom…"
              className="input pl-9 h-10 w-full text-sm" />
            {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="w-4 h-4 text-neutral-400" /></button>}
          </div>

          {filteredReps.length === 0 ? (
            <EmptyState icon={Users} title="Aucun représentant" description="Créez votre premier représentant commercial." />
          ) : (
            <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="bg-neutral-50 text-left text-[11px] uppercase tracking-wider text-neutral-400 border-b border-neutral-100">
                      <th className="px-4 py-3 font-semibold">Code</th>
                      <th className="px-4 py-3 font-semibold">Prénom</th>
                      <th className="px-4 py-3 font-semibold">Nom</th>
                      <th className="px-4 py-3 font-semibold text-right">Ventes</th>
                      <th className="px-4 py-3 font-semibold text-right">CA généré</th>
                      {canSeeCommission && <th className="px-4 py-3 font-semibold text-right">Commission</th>}
                      <th className="px-4 py-3 font-semibold">Règle</th>
                      <th className="px-4 py-3 font-semibold">Statut</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-50">
                    {filteredReps.map(r => {
                      const a = aggByRep.get(r.id) || { count: 0, ca: 0, commission: 0, cancelled: 0 };
                      const rule = effectiveRule(r, settings);
                      return (
                        <tr key={r.id} className="hover:bg-neutral-50/60 transition-colors">
                          <td className="px-4 py-3 font-bold text-neutral-900 num">{r.code}</td>
                          <td className="px-4 py-3 text-neutral-800">{r.first_name}</td>
                          <td className="px-4 py-3 text-neutral-800">{r.last_name}</td>
                          <td className="px-4 py-3 text-right num font-semibold">{a.count}</td>
                          <td className="px-4 py-3 text-right num font-semibold">{formatFCFA(a.ca)}</td>
                          {canSeeCommission && <td className="px-4 py-3 text-right num font-semibold text-emerald-700">{formatFCFA(a.commission)}</td>}
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${r.commission_override ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-neutral-50 text-neutral-500 border-neutral-200'}`}>
                              <BadgePercent className="w-3 h-3" />
                              {r.commission_override
                                ? (rule.commission_type === 'fixe' ? `${formatFCFA(rule.fixed_amount)} / vente` : `${rule.rate}% ${rule.commission_type === 'pct_marge' ? 'marge' : COMMISSION_BASE_LABELS[rule.commission_base]}`)
                                : 'Règle globale'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${r.status === 'actif' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-neutral-100 text-neutral-500 border-neutral-200'}`}>
                              {r.status === 'actif' ? 'Actif' : 'Inactif'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              {can('rep_stats_view') && (
                                <button onClick={() => { setStatRep(r.id); setTab('stats'); }} title="Statistiques"
                                  className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-500 transition-colors"><BarChart3 className="w-4 h-4" /></button>
                              )}
                              {canManage && (
                                <>
                                  <button onClick={() => openEdit(r)} title="Modifier"
                                    className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-500 transition-colors"><Pencil className="w-4 h-4" /></button>
                                  <button onClick={() => toggleStatus(r)} title={r.status === 'actif' ? 'Désactiver' : 'Activer'}
                                    className={`p-1.5 rounded-lg transition-colors ${r.status === 'actif' ? 'hover:bg-amber-50 text-amber-600' : 'hover:bg-emerald-50 text-emerald-600'}`}><Power className="w-4 h-4" /></button>
                                  {(aggByRep.get(r.id)?.count || 0) === 0 && (aggByRep.get(r.id)?.cancelled || 0) === 0 && (
                                    <button onClick={() => setToDelete(r)} title="Supprimer"
                                      className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {/* Filters */}
          <div className="bg-white border border-neutral-200 rounded-2xl p-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider block mb-1">Représentant</label>
              <select value={statRep} onChange={e => setStatRep(e.target.value)} className="input h-9 text-sm min-w-[180px]">
                <option value="">Tous</option>
                {reps.map(r => <option key={r.id} value={r.id}>{repDisplayName(r)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider block mb-1">Magasin</label>
              <select value={statSite} onChange={e => setStatSite(e.target.value)} className="input h-9 text-sm min-w-[150px]">
                <option value="">Tous</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider block mb-1">Du</label>
              <input type="date" value={statFrom} onChange={e => setStatFrom(e.target.value)} className="input h-9 text-sm" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider block mb-1">Au</label>
              <input type="date" value={statTo} onChange={e => setStatTo(e.target.value)} className="input h-9 text-sm" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider block mb-1">Statut</label>
              <select value={statStatus} onChange={e => setStatStatus(e.target.value)} className="input h-9 text-sm">
                <option value="">Tous</option>
                <option value="active">Actives</option>
                <option value="cancelled">Annulées</option>
              </select>
            </div>
            <div className="flex-1" />
            {can('rep_export') && (
              <div className="flex gap-2">
                <button onClick={printReport} className="btn-icon h-9" title="Imprimer"><Printer className="w-4 h-4" /></button>
                <button onClick={exportExcel} className="btn-icon h-9" title="Export Excel"><Download className="w-4 h-4" /></button>
              </div>
            )}
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'Nombre de ventes', value: String(kpi.count), icon: Receipt, color: 'text-neutral-700' },
              { label: 'CA total', value: formatFCFA(kpi.ca), icon: TrendingUp, color: 'text-emerald-700' },
              { label: 'Remises', value: formatFCFA(kpi.remises), icon: BadgePercent, color: 'text-amber-700' },
              { label: 'Panier moyen', value: formatFCFA(Math.round(kpi.panier)), icon: Wallet, color: 'text-neutral-700' },
              { label: 'Clients', value: String(kpi.clients), icon: UserCheck, color: 'text-neutral-700' },
              ...(canSeeCommission ? [{ label: 'Commission totale', value: formatFCFA(kpi.commission), icon: BadgePercent, color: 'text-teal-700' }] : []),
            ].map((k, i) => (
              <div key={i} className="bg-white border border-neutral-200 rounded-2xl p-3.5">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">
                  <k.icon className="w-3.5 h-3.5" /> {k.label}
                </div>
                <div className={`text-[15px] font-black num ${k.color} break-all`}>{k.value}</div>
              </div>
            ))}
          </div>
          {kpi.cancelled > 0 && (
            <div className="text-[12px] bg-red-50 border border-red-200 text-red-700 rounded-xl px-3 py-2">
              {kpi.cancelled} vente(s) annulée(s) sur la période pour un total de {formatFCFA(kpi.cancelledTotal)} — exclues des indicateurs ci-dessus.
            </div>
          )}

          {/* Detail table */}
          {statSales.length === 0 ? (
            <EmptyState icon={BarChart3} title="Aucune vente" description="Aucune vente avec représentant sur cette période." />
          ) : (
            <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="bg-neutral-50 text-left text-[11px] uppercase tracking-wider text-neutral-400 border-b border-neutral-100">
                      <th className="px-4 py-3 font-semibold">N° document</th>
                      <th className="px-4 py-3 font-semibold">Date</th>
                      <th className="px-4 py-3 font-semibold">Représentant</th>
                      <th className="px-4 py-3 font-semibold">Client</th>
                      <th className="px-4 py-3 font-semibold">Magasin</th>
                      <th className="px-4 py-3 font-semibold text-right">Montant</th>
                      {canSeeCommission && <th className="px-4 py-3 font-semibold text-right">Commission</th>}
                      <th className="px-4 py-3 font-semibold">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-50">
                    {statSales.slice(0, 300).map(s => (
                      <tr key={s.id} className={`hover:bg-neutral-50/60 transition-colors ${s.status === 'cancelled' ? 'opacity-60' : ''}`}>
                        <td className="px-4 py-2.5 font-semibold text-neutral-900 num">{s.sale_number}</td>
                        <td className="px-4 py-2.5 text-neutral-500 whitespace-nowrap">{formatDateTime(s.created_at)}</td>
                        <td className="px-4 py-2.5 text-neutral-800">{repName(s.representative_id)}</td>
                        <td className="px-4 py-2.5 text-neutral-600">{s.customers?.name || '—'}</td>
                        <td className="px-4 py-2.5 text-neutral-600">{siteName(s.site_id)}</td>
                        <td className="px-4 py-2.5 text-right num font-semibold">{formatFCFA(Number(s.total || 0))}</td>
                        {canSeeCommission && <td className="px-4 py-2.5 text-right num text-teal-700 font-semibold">{formatFCFA(Number(s.rep_commission?.amount || 0))}</td>}
                        <td className="px-4 py-2.5">
                          <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${s.status === 'cancelled' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                            {s.status === 'cancelled' ? 'Annulée' : 'Active'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {statSales.length > 300 && (
                <div className="px-4 py-2 text-[11px] text-neutral-400 border-t border-neutral-100">300 premières lignes affichées — affinez les filtres ou exportez en Excel.</div>
              )}
            </div>
          )}
        </>
      )}

      {/* Create / Edit modal */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editingId ? 'Modifier le représentant' : 'Nouveau représentant'} size="md"
        footer={<>
          <button onClick={() => setFormOpen(false)} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
          <button onClick={saveRep} disabled={saving} className="btn-icon-primary" title={editingId ? 'Enregistrer' : 'Créer'}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          </button>
        </>}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-neutral-500 block mb-1">Code *</label>
              <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="REP-001" className="input h-10 w-full text-sm num" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-neutral-500 block mb-1">Prénom *</label>
              <input value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} placeholder="Awa" className="input h-10 w-full text-sm" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-neutral-500 block mb-1">Nom *</label>
              <input value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} placeholder="Ndiaye" className="input h-10 w-full text-sm" />
            </div>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-neutral-500 block mb-1">Statut</label>
            <div className="flex gap-2">
              {(['actif', 'inactif'] as const).map(s => (
                <button key={s} onClick={() => setForm(f => ({ ...f, status: s }))}
                  className={`px-4 h-9 rounded-xl text-[12px] font-semibold border transition-colors ${form.status === s ? (s === 'actif' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-neutral-700 text-white border-neutral-700') : 'bg-white text-neutral-500 border-neutral-200'}`}>
                  {s === 'actif' ? 'Actif' : 'Inactif'}
                </button>
              ))}
            </div>
          </div>

          {can('rep_settings_edit') && (
            <div className="border border-neutral-200 rounded-2xl p-3.5 space-y-3">
              <label className="flex items-center justify-between cursor-pointer select-none">
                <div>
                  <div className="text-[13px] font-semibold text-neutral-800">Règle de commission spécifique</div>
                  <div className="text-[11px] text-neutral-400">Prioritaire sur la règle globale du tenant</div>
                </div>
                <input type="checkbox" checked={form.commission_override}
                  onChange={e => setForm(f => ({ ...f, commission_override: e.target.checked }))}
                  className="w-4 h-4 accent-neutral-900" />
              </label>
              {form.commission_override && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-neutral-500 block mb-1">Type</label>
                    <select value={form.commission_type} onChange={e => setForm(f => ({ ...f, commission_type: e.target.value as any }))} className="input h-10 w-full text-sm">
                      {Object.entries(COMMISSION_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  {form.commission_type !== 'fixe' && (
                    <div>
                      <label className="text-[11px] font-semibold text-neutral-500 block mb-1">Base de calcul</label>
                      <select value={form.commission_base} onChange={e => setForm(f => ({ ...f, commission_base: e.target.value as any }))} className="input h-10 w-full text-sm">
                        {Object.entries(COMMISSION_BASE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                  )}
                  {form.commission_type === 'fixe' ? (
                    <div>
                      <label className="text-[11px] font-semibold text-neutral-500 block mb-1">Montant fixe (FCFA)</label>
                      <input type="number" min="0" value={form.commission_fixed} onChange={e => setForm(f => ({ ...f, commission_fixed: e.target.value }))} className="input h-10 w-full text-sm num" />
                    </div>
                  ) : (
                    <div>
                      <label className="text-[11px] font-semibold text-neutral-500 block mb-1">Taux (%)</label>
                      <input type="number" min="0" step="0.01" value={form.commission_rate} onChange={e => setForm(f => ({ ...f, commission_rate: e.target.value }))} className="input h-10 w-full text-sm num" />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={deleteRep}
        title="Supprimer le représentant"
        message={`Supprimer définitivement ${toDelete ? repDisplayName(toDelete) : ''} ? Cette action est impossible si le représentant est lié à des ventes.`}
        confirmLabel="Supprimer"
        danger
      />
    </div>
  );
}
