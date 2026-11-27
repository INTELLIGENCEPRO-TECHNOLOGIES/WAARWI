import { useRealtimeRefresh } from '../lib/useRealtimeData';
import { useEffect, useId, useMemo, useState } from 'react';
import { Plus, Loader2, Pencil, BarChart3, Users, X, Power, Check, Download, Printer, Trash2, SlidersHorizontal } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { usePermissions } from '../lib/permissions';
import { useToast } from '../context/ToastContext';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { PageSearch } from '../components/PageSearch';
import { formatDate, formatDateTime, formatFCFA } from '../lib/format';
import { PremiumDateRangePicker } from '../components/PremiumDateRangePicker';
import { SearchableSelect } from '../components/SearchableSelect';
import {
  type SalesRepresentative, type RepCommissionSettings, DEFAULT_REP_SETTINGS,
  COMMISSION_TYPE_LABELS, COMMISSION_BASE_LABELS, repDisplayName, nextRepCode, effectiveRule,
} from '../lib/repCommission';
import { printHtmlReport } from '../lib/print';
import './Representatives.css';

type RepSale = {
  id: string; sale_number: string; total: number; discount: number; status: string;
  created_at: string; customer_id: string | null; site_id: string | null;
  representative_id: string; rep_commission: { amount?: number } | null;
  customers: { name: string } | null;
};

type Tab = 'list' | 'stats';

const formatPeriodDate = (date: string) => formatDate(new Date(`${date}T12:00:00`));

export function Representatives() {
  const { tenant, sites, profile } = useApp();
  const { can } = usePermissions();
  const { success, error } = useToast();
  const formId = useId();

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
  const [deleting, setDeleting] = useState(false);

  // Stats filters
  const [statRep, setStatRep] = useState('');
  const [statSite, setStatSite] = useState('');
  const [statFrom, setStatFrom] = useState('');
  const [statTo, setStatTo] = useState('');
  const [statStatus, setStatStatus] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const canManage = can('rep_manage');
  const canSeeCommission = can('rep_commission_view');
  const canViewStatistics = can('rep_stats_view');
  const canExport = can('rep_export');
  const activeTab = canViewStatistics ? tab : 'list';

  const load = async (silent = false) => {
    if (!tenant) return;
    if (!silent) setLoading(true);
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
  useRealtimeRefresh(['sales_representatives', 'rep_commission_settings', 'sales', 'sale_payments', 'sale_returns', 'sites'], () => load(true));


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
    if (!toDelete || !canManage || deleting) return;
    const used = repSales.some(s => s.representative_id === toDelete.id);
    if (used) {
      error('Ce représentant est lié à des ventes. Vous pouvez le désactiver.');
      setToDelete(null);
      return;
    }
    setDeleting(true);
    try {
      const { error: e } = await supabase.from('sales_representatives').delete().eq('id', toDelete.id);
      if (e) {
        error('Suppression impossible : ce représentant est lié à des documents.');
        return;
      }
      await logAudit('rep_deleted', toDelete.id, toDelete, null);
      success('Représentant supprimé');
      load();
    } finally {
      setDeleting(false);
      setToDelete(null);
    }
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

  const clearStatFilters = () => {
    setStatRep(''); setStatSite(''); setStatFrom(''); setStatTo(''); setStatStatus('');
  };

  const activeFilterCount = [statRep, statSite, statFrom, statTo, statStatus].filter(Boolean).length;

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
    return <p className="py-10 text-center text-sm text-[var(--w-text-sec)]">Vous n’avez pas accès à cette page.</p>;
  }

  const kpis = [
    { label: 'Ventes', value: String(kpi.count) },
    { label: 'Chiffre d’affaires', value: formatFCFA(kpi.ca) },
    { label: 'Remises', value: formatFCFA(kpi.remises) },
    { label: 'Panier moyen', value: formatFCFA(Math.round(kpi.panier)) },
    { label: 'Clients', value: String(kpi.clients) },
    ...(canSeeCommission ? [{ label: 'Commissions', value: formatFCFA(kpi.commission) }] : []),
  ];

  const dateSummary = statFrom && statFrom !== statTo && statTo
    ? `${formatPeriodDate(statFrom)} au ${formatPeriodDate(statTo)}`
    : statFrom ? formatPeriodDate(statFrom) : '';
  const statsSummary = [
    dateSummary,
    statRep ? repName(statRep) : '',
    statSite ? siteName(statSite) : '',
    statStatus === 'active' ? 'Ventes actives' : statStatus === 'cancelled' ? 'Ventes annulées' : '',
  ].filter(Boolean).join(' │ ');

  const closeForm = () => { if (!saving) setFormOpen(false); };
  const closeDelete = () => { if (!deleting) setToDelete(null); };
  const hasRowActions = canViewStatistics || canManage;

  return (
    <div className="rep-page">
      <header className="rep-header">
        <div className="rep-header-top">
          <h1>Représentants</h1>
          {canManage && (
            <button type="button" onClick={openCreate} className="btn-primary rep-button" aria-label="Nouveau représentant">
              <Plus size={16} aria-hidden="true" />
              Nouveau
            </button>
          )}
        </div>
        {canViewStatistics && (
          <nav className="rep-tabs" aria-label="Représentants">
            <button type="button" aria-pressed={activeTab === 'list'} onClick={() => setTab('list')}>Liste</button>
            <button type="button" aria-pressed={activeTab === 'stats'} onClick={() => setTab('stats')}>Statistiques</button>
          </nav>
        )}
      </header>

      {activeTab === 'list' ? (
        <section className="rep-section" aria-label="Liste des représentants">
          <PageSearch value={search} onChange={setSearch} placeholder="Rechercher par code ou nom…" />
          {!settings.enabled && !loading && (
            <p className="rep-note">Commissions désactivées dans Paramètres → Représentants et commissions.</p>
          )}
          {loading ? (
            <div className="rep-loading" role="status"><Loader2 size={16} className="animate-spin" /> Chargement des représentants…</div>
          ) : filteredReps.length === 0 ? (
            <EmptyState icon={Users} title={search.trim() ? 'Aucun résultat' : 'Aucun représentant'}
              description={search.trim() ? 'Essayez un autre code ou nom.' : undefined} />
          ) : (
            <table className="rep-table" aria-label="Représentants">
              <thead>
                <tr>
                  <th scope="col">Représentant</th>
                  <th scope="col">Statut</th>
                  <th scope="col" className="rep-number">Ventes</th>
                  <th scope="col" className="rep-number">Chiffre d’affaires</th>
                  {canSeeCommission && <th scope="col" className="rep-number">Commission</th>}
                  <th scope="col">Règle</th>
                  {hasRowActions && <th scope="col"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {filteredReps.map(rep => {
                  const activity = aggByRep.get(rep.id) ?? { count: 0, ca: 0, commission: 0, cancelled: 0 };
                  const rule = effectiveRule(rep, settings);
                  const name = `${rep.first_name} ${rep.last_name}`;
                  const statusAction = rep.status === 'actif' ? 'Désactiver' : 'Activer';
                  const ruleLabel = !rep.commission_override ? 'Règle globale' : rule.commission_type === 'fixe'
                    ? `${formatFCFA(rule.fixed_amount)} par vente`
                    : `${rule.rate} % │ ${rule.commission_type === 'pct_marge' ? 'Marge' : COMMISSION_BASE_LABELS[rule.commission_base]}`;
                  return (
                    <tr key={rep.id}>
                      <th scope="row" className="rep-identity">
                        <span className="rep-row-title">{name}</span>
                        <span className="rep-row-meta num">{rep.code}</span>
                      </th>
                      <td className="rep-status">
                        <span className={rep.status === 'actif' ? 'rep-status-active' : 'rep-status-muted'}>{rep.status === 'actif' ? 'Actif' : 'Inactif'}</span>
                      </td>
                      <td className="rep-number"><span className="rep-cell-label" aria-hidden="true">Ventes</span><span className="num">{activity.count}</span></td>
                      <td className="rep-number"><span className="rep-cell-label" aria-hidden="true">Chiffre d’affaires</span><span className="num rep-amount">{formatFCFA(activity.ca)}</span></td>
                      {canSeeCommission && <td className="rep-number"><span className="rep-cell-label" aria-hidden="true">Commission</span><span className="num rep-amount">{formatFCFA(activity.commission)}</span></td>}
                      <td><span className="rep-cell-label" aria-hidden="true">Règle</span>{ruleLabel}</td>
                      {hasRowActions && (
                        <td className="rep-actions">
                          <div>
                            {canViewStatistics && (
                              <button type="button" className="rep-row-action" title="Statistiques" aria-label={`Statistiques de ${name}`}
                                onClick={() => { setStatRep(rep.id); setTab('stats'); }}>
                                <BarChart3 size={15} aria-hidden="true" /><span>Statistiques</span>
                              </button>
                            )}
                            {canManage && (
                              <>
                                <button type="button" className="rep-row-action" title="Modifier" aria-label={`Modifier ${name}`} onClick={() => openEdit(rep)}>
                                  <Pencil size={15} aria-hidden="true" /><span>Modifier</span>
                                </button>
                                <button type="button" className="rep-row-action" title={statusAction} aria-label={`${statusAction} ${name}`} onClick={() => toggleStatus(rep)}>
                                  <Power size={15} aria-hidden="true" /><span>{statusAction}</span>
                                </button>
                                {activity.count === 0 && activity.cancelled === 0 && (
                                  <button type="button" className="rep-row-action rep-row-action-danger" title="Supprimer" aria-label={`Supprimer ${name}`} onClick={() => setToDelete(rep)}>
                                    <Trash2 size={15} aria-hidden="true" /><span>Supprimer</span>
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      ) : (
        <section className="rep-section" aria-label="Statistiques des représentants">
          <div className="rep-toolbar">
            <span className="rep-period">{statsSummary || 'Toutes les périodes'}</span>
            <div className="rep-tools">
              <button type="button" className="btn-secondary rep-button" onClick={() => setFiltersOpen(true)}>
                <SlidersHorizontal size={15} aria-hidden="true" />
                Filtres{activeFilterCount > 0 && <span className="num">({activeFilterCount})</span>}
              </button>
              {canExport && (
                <>
                  <button type="button" className="btn-secondary rep-button" onClick={printReport}><Printer size={15} aria-hidden="true" />Imprimer</button>
                  <button type="button" className="btn-secondary rep-button" onClick={exportExcel}><Download size={15} aria-hidden="true" />Excel</button>
                </>
              )}
            </div>
          </div>
          {loading ? (
            <div className="rep-loading" role="status"><Loader2 size={16} className="animate-spin" /> Chargement des statistiques…</div>
          ) : (
            <>
              <dl className="rep-kpis">
                {kpis.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd className="num">{value}</dd></div>)}
              </dl>
              {kpi.cancelled > 0 && (
                <p className="rep-note">
                  {kpi.cancelled === 1 ? '1 vente annulée' : `${kpi.cancelled} ventes annulées`}
                  {' │ '}<span className="num rep-amount">{formatFCFA(kpi.cancelledTotal)}</span>
                  {' │ '}Hors indicateurs
                </p>
              )}
              {statSales.length === 0 ? (
                <EmptyState icon={BarChart3} title="Aucune vente" description="Aucune vente avec représentant ne correspond aux filtres." />
              ) : (
                <>
                  <table className="rep-table" aria-label="Ventes par représentant">
                    <thead>
                      <tr>
                        <th scope="col">Document</th>
                        <th scope="col">Statut</th>
                        <th scope="col">Représentant</th>
                        <th scope="col">Client</th>
                        <th scope="col">Magasin</th>
                        <th scope="col" className="rep-number">Montant</th>
                        {canSeeCommission && <th scope="col" className="rep-number">Commission</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {statSales.slice(0, 300).map(sale => (
                        <tr key={sale.id}>
                          <th scope="row" className="rep-identity">
                            <span className="rep-row-title num">{sale.sale_number}</span>
                            <span className="rep-row-meta"><time dateTime={sale.created_at}>{formatDateTime(sale.created_at)}</time></span>
                          </th>
                          <td className="rep-status">
                            <span className={sale.status === 'cancelled' ? 'rep-status-muted' : 'rep-status-active'}>{sale.status === 'cancelled' ? 'Annulée' : 'Active'}</span>
                          </td>
                          <td><span className="rep-cell-label" aria-hidden="true">Représentant</span>{repName(sale.representative_id)}</td>
                          <td><span className="rep-cell-label" aria-hidden="true">Client</span>{sale.customers?.name || '—'}</td>
                          <td><span className="rep-cell-label" aria-hidden="true">Magasin</span>{siteName(sale.site_id)}</td>
                          <td className="rep-number"><span className="rep-cell-label" aria-hidden="true">Montant</span><span className="num rep-amount">{formatFCFA(Number(sale.total || 0))}</span></td>
                          {canSeeCommission && (
                            <td className="rep-number"><span className="rep-cell-label" aria-hidden="true">Commission</span><span className="num rep-amount">{formatFCFA(Number(sale.rep_commission?.amount || 0))}</span></td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {statSales.length > 300 && <p className="rep-note">Les 300 premières lignes sont affichées. Affinez les filtres{canExport ? ' ou exportez les résultats en Excel' : ''}.</p>}
                </>
              )}
            </>
          )}
        </section>
      )}

      <PremiumDateRangePicker
        open={activeTab === 'stats' && filtersOpen}
        onClose={() => setFiltersOpen(false)}
        from={statFrom}
        to={statTo}
        onApply={(from, to) => { setStatFrom(from); setStatTo(to); setFiltersOpen(false); }}
        onReset={clearStatFilters}
        extraFilters={
          <div className="rep-filter-fields">
            <SearchableSelect
              label="Représentant"
              variant="underline"
              wrapLabels
              searchable
              value={statRep}
              onChange={setStatRep}
              options={[{ value: '', label: 'Tous les représentants' }, ...reps.map(rep => ({ value: rep.id, label: repDisplayName(rep) }))]}
            />
            <SearchableSelect
              label="Magasin"
              variant="underline"
              wrapLabels
              searchable
              value={statSite}
              onChange={setStatSite}
              options={[{ value: '', label: 'Tous les magasins' }, ...sites.map(site => ({ value: site.id, label: site.name }))]}
            />
            <SearchableSelect
              label="Statut"
              variant="underline"
              wrapLabels
              searchable={false}
              value={statStatus}
              onChange={setStatStatus}
              options={[{ value: '', label: 'Tous les statuts' }, { value: 'active', label: 'Actives' }, { value: 'cancelled', label: 'Annulées' }]}
            />
          </div>
        }
      />

      <Modal
        open={canManage && formOpen}
        onClose={closeForm}
        title={editingId ? 'Modifier le représentant' : 'Nouveau représentant'}
        size="md"
        variant="flat"
        layer="top"
        focusOnOpen
        panelClassName="rep-sheet"
        footer={
          <>
            <button type="button" onClick={closeForm} disabled={saving} className="btn-secondary rep-button"><X size={15} aria-hidden="true" />Annuler</button>
            <button type="submit" form={formId} disabled={saving} className="btn-primary rep-button">
              {saving ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}
              {editingId ? 'Enregistrer' : 'Créer'}
            </button>
          </>
        }
      >
        <form id={formId} className="rep-form flat-form" onSubmit={event => { event.preventDefault(); void saveRep(); }}>
          <div className="rep-name-fields">
            <label className="rep-code-field">
              <span className="label">Code</span>
              <input required value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} className="input num" />
            </label>
            <label>
              <span className="label">Prénom</span>
              <input required value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} className="input" />
            </label>
            <label>
              <span className="label">Nom</span>
              <input required value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} className="input" />
            </label>
          </div>

          <label className="rep-check-row">
            <input type="checkbox" checked={form.status === 'actif'} onChange={e => setForm(f => ({ ...f, status: e.target.checked ? 'actif' : 'inactif' }))} />
            Représentant actif
          </label>

          {can('rep_settings_edit') && (
            <>
              <label className="rep-check-row">
                <input type="checkbox" checked={form.commission_override} onChange={e => setForm(f => ({ ...f, commission_override: e.target.checked }))} />
                Règle de commission spécifique
              </label>
              {form.commission_override && (
                <div className="rep-commission-fields">
                  <SearchableSelect
                    label="Type de commission"
                    variant="underline"
                    wrapLabels
                    searchable={false}
                    value={form.commission_type}
                    onChange={value => setForm(f => ({ ...f, commission_type: value as RepCommissionSettings['commission_type'] }))}
                    options={Object.entries(COMMISSION_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
                  />
                  {form.commission_type !== 'fixe' && (
                    <SearchableSelect
                      label="Base de calcul"
                      variant="underline"
                      wrapLabels
                      searchable={false}
                      value={form.commission_base}
                      onChange={value => setForm(f => ({ ...f, commission_base: value as RepCommissionSettings['commission_base'] }))}
                      options={Object.entries(COMMISSION_BASE_LABELS).map(([value, label]) => ({ value, label }))}
                    />
                  )}
                  {form.commission_type === 'fixe' ? (
                    <label>
                      <span className="label">Montant (FCFA)</span>
                      <input type="number" min="0" step="any" value={form.commission_fixed} onChange={e => setForm(f => ({ ...f, commission_fixed: e.target.value }))} className="input num" />
                    </label>
                  ) : (
                    <label>
                      <span className="label">Taux (%)</span>
                      <input type="number" min="0" step="any" value={form.commission_rate} onChange={e => setForm(f => ({ ...f, commission_rate: e.target.value }))} className="input num" />
                    </label>
                  )}
                </div>
              )}
            </>
          )}
        </form>
      </Modal>

      <Modal
        open={canManage && Boolean(toDelete)}
        onClose={closeDelete}
        title="Supprimer le représentant"
        size="sm"
        variant="flat"
        layer="top"
        focusOnOpen
        panelClassName="rep-sheet"
        footer={
          <>
            <button type="button" onClick={closeDelete} disabled={deleting} className="btn-secondary rep-button"><X size={15} aria-hidden="true" />Annuler</button>
            <button type="button" onClick={deleteRep} disabled={deleting} className="btn-danger rep-button">
              {deleting ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Trash2 size={15} aria-hidden="true" />}
              Supprimer
            </button>
          </>
        }
      >
        <p className="rep-confirm">Supprimer définitivement <strong>{toDelete ? repDisplayName(toDelete) : ''}</strong> ?</p>
      </Modal>
    </div>
  );
}
