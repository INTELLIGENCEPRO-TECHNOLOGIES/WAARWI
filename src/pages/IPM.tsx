import { useEffect, useMemo, useState } from 'react';
import { HeartPulse, Building2, FileText, Users, Receipt, CreditCard, AlertTriangle, Plus, Search, CreditCard as Edit2, Check, X, Loader2, Wallet, BarChart3, Ban, RefreshCw, Settings2, CheckCircle2, Printer } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { formatFCFA, formatDate } from '../lib/format';
import { Modal } from '../components/Modal';

type Section = 'dashboard' | 'organismes' | 'conventions' | 'beneficiaires' | 'bordereaux' | 'factures' | 'reglements' | 'rejets' | 'parametres';

const SECTIONS: { key: Section; label: string; shortLabel: string; icon: any }[] = [
  { key: 'dashboard', label: 'Vue', shortLabel: 'Vue', icon: BarChart3 },
  { key: 'organismes', label: 'Organismes', shortLabel: 'Org.', icon: Building2 },
  { key: 'conventions', label: 'Conventions', shortLabel: 'Conv.', icon: FileText },
  { key: 'beneficiaires', label: 'Bénéficiaires', shortLabel: 'Bénéf.', icon: Users },
  { key: 'bordereaux', label: 'Bordereaux', shortLabel: 'Bord.', icon: Receipt },
  { key: 'factures', label: 'Factures', shortLabel: 'Fact.', icon: CreditCard },
  { key: 'reglements', label: 'Règlements', shortLabel: 'Règl.', icon: Wallet },
  { key: 'rejets', label: 'Rejets', shortLabel: 'Rejets', icon: AlertTriangle },
  { key: 'parametres', label: 'Paramètres', shortLabel: 'Param.', icon: Settings2 },
];

export function IPM() {
  const { tenant } = useApp();
  const [section, setSection] = useState<Section>('dashboard');
  const [dbReady, setDbReady] = useState<boolean | null>(null);

  useEffect(() => {
    if (!tenant) return;
    (async () => {
      const { error } = await supabase.from('ipm_organismes').select('id').eq('tenant_id', tenant.id).limit(1);
      setDbReady(!error || error.code !== 'PGRST205');
    })();
  }, [tenant?.id]);

  if (!tenant) return null;

  if (dbReady === false) {
    return (
      <div className="min-h-full flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-8 h-8 text-amber-500" />
          </div>
          <h2 className="text-lg font-bold text-neutral-900 mb-2">Module IPM en cours de configuration</h2>
          <p className="text-sm text-neutral-600 mb-4">
            Les tables de base de données pour le module IPM n'ont pas encore été créées.
            Veuillez contacter l'administrateur de la plateforme pour finaliser l'installation.
          </p>
          <div className="p-3 rounded-xl bg-neutral-50 border border-neutral-200 text-left">
            <p className="text-[11px] font-mono text-neutral-500">Erreur : table 'ipm_organismes' introuvable</p>
          </div>
        </div>
      </div>
    );
  }

  if (dbReady === null) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-neutral-700" />
      </div>
    );
  }

  return (
    <div className="w-full bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 shrink-0 rounded-xl bg-neutral-900 flex items-center justify-center">
          <HeartPulse className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-bold text-neutral-900 truncate">IPM / Tiers payant</h1>
          <p className="text-[11px] text-neutral-400 truncate">Organismes payeurs et créances</p>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="overflow-x-auto scrollbar-hide -mx-3 sm:-mx-5 lg:-mx-8 px-3 sm:px-5 lg:px-8 mb-4">
        <div className="flex gap-1.5 w-max pb-2">
          {SECTIONS.map(s => (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                section === s.key
                  ? 'bg-neutral-900 text-white'
                  : 'bg-neutral-100 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200'
              }`}
            >
              <s.icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{s.label}</span>
              <span className="sm:hidden">{s.shortLabel}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="w-full">
        {section === 'dashboard' && <IpmDashboard tenantId={tenant.id} />}
        {section === 'organismes' && <IpmOrganismes tenantId={tenant.id} />}
        {section === 'conventions' && <IpmConventions tenantId={tenant.id} />}
        {section === 'beneficiaires' && <IpmBeneficiaires tenantId={tenant.id} />}
        {section === 'bordereaux' && <IpmBordereaux tenantId={tenant.id} />}
        {section === 'factures' && <IpmFactures tenantId={tenant.id} />}
        {section === 'reglements' && <IpmReglements tenantId={tenant.id} />}
        {section === 'rejets' && <IpmRejets tenantId={tenant.id} />}
        {section === 'parametres' && <IpmParametres tenantId={tenant.id} />}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * TABLEAU DE BORD IPM
 * ═══════════════════════════════════════════════════════════════════ */
function IpmDashboard({ tenantId }: { tenantId: string }) {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [
        { data: ventes },
        { data: reglements },
        { data: rejets },
        { data: organismes },
        { data: beneficiaires },
        { data: conventions },
      ] = await Promise.all([
        supabase.from('ipm_ventes').select('part_ipm, statut, organisme_id').eq('tenant_id', tenantId),
        supabase.from('ipm_reglements').select('montant_recu').eq('tenant_id', tenantId),
        supabase.from('ipm_rejets').select('montant_rejete, statut').eq('tenant_id', tenantId),
        supabase.from('ipm_organismes').select('id, nom, is_active').eq('tenant_id', tenantId).eq('is_active', true),
        supabase.from('ipm_beneficiaires').select('id, statut, date_fin_couverture').eq('tenant_id', tenantId),
        supabase.from('ipm_conventions').select('id, date_fin, is_active').eq('tenant_id', tenantId).eq('is_active', true),
      ]);

      const ventesData = ventes || [];
      const totalCreances = ventesData.reduce((s: number, v: any) => s + Number(v.part_ipm || 0), 0);
      const enAttente = ventesData.filter((v: any) => v.statut === 'en_attente').reduce((s: number, v: any) => s + Number(v.part_ipm || 0), 0);
      const facturee = ventesData.filter((v: any) => v.statut === 'facturee' || v.statut === 'bordereau').reduce((s: number, v: any) => s + Number(v.part_ipm || 0), 0);
      const reglee = ventesData.filter((v: any) => v.statut === 'reglee').reduce((s: number, v: any) => s + Number(v.part_ipm || 0), 0);
      const totalRegle = (reglements || []).reduce((s: number, r: any) => s + Number(r.montant_recu || 0), 0);
      const dossiers = ventesData.filter((v: any) => v.statut === 'en_attente').length;
      const rejetsNouveaux = (rejets || []).filter((r: any) => r.statut === 'nouveau').length;

      const today = new Date().toISOString().slice(0, 10);
      const conventionsExpirees = (conventions || []).filter((c: any) => c.date_fin && c.date_fin < today).length;
      const benefExpires = (beneficiaires || []).filter((b: any) => b.statut === 'expire' || (b.date_fin_couverture && b.date_fin_couverture < today)).length;

      const topOrganismes: { nom: string; montant: number }[] = [];
      const orgMap = new Map<string, number>();
      for (const v of ventesData) {
        orgMap.set(v.organisme_id, (orgMap.get(v.organisme_id) || 0) + Number(v.part_ipm || 0));
      }
      for (const [orgId, montant] of Array.from(orgMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
        const org = (organismes || []).find((o: any) => o.id === orgId);
        topOrganismes.push({ nom: org?.nom || 'Inconnu', montant });
      }

      setStats({
        totalCreances, enAttente, facturee, reglee, totalRegle,
        resteAPayer: totalCreances - totalRegle,
        dossiers, rejetsNouveaux, conventionsExpirees, benefExpires,
        topOrganismes,
        nbOrganismes: (organismes || []).length,
        nbBeneficiaires: (beneficiaires || []).length,
      });
      setLoading(false);
    })();
  }, [tenantId]);

  if (loading) return <DashSkeleton />;
  if (!stats) return <EmptyIpm message="Aucune donnée IPM disponible" />;

  return (
    <div className="space-y-4">
      {/* Carte principale Créances IPM */}
      <div className="bg-white rounded-xl border border-neutral-200 p-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-3">Créances IPM</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-[10px] text-neutral-500 mb-0.5">Créances ouvertes</p>
            <p className="text-base font-bold text-neutral-900 tabular-nums">{formatFCFA(stats.enAttente)}</p>
          </div>
          <div>
            <p className="text-[10px] text-neutral-500 mb-0.5">Montant réglé</p>
            <p className="text-base font-bold text-emerald-600 tabular-nums">{formatFCFA(stats.totalRegle)}</p>
          </div>
          <div>
            <p className="text-[10px] text-neutral-500 mb-0.5">Reste à payer</p>
            <p className="text-base font-bold text-neutral-900 tabular-nums">{formatFCFA(stats.resteAPayer)}</p>
          </div>
          <div>
            <p className="text-[10px] text-neutral-500 mb-0.5">Dossiers à transmettre</p>
            <p className="text-base font-bold text-neutral-900">{stats.dossiers}</p>
          </div>
        </div>
      </div>

      {/* Alertes compactes */}
      {(stats.conventionsExpirees > 0 || stats.benefExpires > 0 || stats.rejetsNouveaux > 0) && (
        <div className="space-y-1.5">
          {stats.conventionsExpirees > 0 && (
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-neutral-200 bg-neutral-50">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <p className="text-[11px] text-neutral-700"><span className="font-semibold">{stats.conventionsExpirees}</span> convention(s) expirée(s)</p>
            </div>
          )}
          {stats.benefExpires > 0 && (
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-neutral-200 bg-neutral-50">
              <Ban className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <p className="text-[11px] text-neutral-700"><span className="font-semibold">{stats.benefExpires}</span> bénéficiaire(s) expiré(s)</p>
            </div>
          )}
          {stats.rejetsNouveaux > 0 && (
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-neutral-200 bg-neutral-50">
              <X className="w-3.5 h-3.5 text-red-500 shrink-0" />
              <p className="text-[11px] text-neutral-700"><span className="font-semibold">{stats.rejetsNouveaux}</span> rejet(s) à traiter</p>
            </div>
          )}
        </div>
      )}

      {/* Top Organismes */}
      {stats.topOrganismes.length > 0 && (
        <div className="bg-white rounded-xl border border-neutral-200 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-2.5">Top organismes</h3>
          <div className="space-y-0">
            {stats.topOrganismes.map((o: any, i: number) => (
              <div key={i} className="flex items-center justify-between py-1.5 border-b border-neutral-50 last:border-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-4 h-4 rounded-full bg-neutral-100 text-neutral-600 text-[9px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                  <span className="text-xs text-neutral-700 truncate">{o.nom}</span>
                </div>
                <span className="text-xs font-bold text-neutral-900 tabular-nums shrink-0 ml-3">{formatFCFA(o.montant)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Résumé */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="bg-white rounded-lg border border-neutral-200 px-3 py-2.5 text-center">
          <p className="text-lg font-bold text-neutral-900">{stats.nbOrganismes}</p>
          <p className="text-[9px] text-neutral-400 font-medium uppercase tracking-wide">Organismes actifs</p>
        </div>
        <div className="bg-white rounded-lg border border-neutral-200 px-3 py-2.5 text-center">
          <p className="text-lg font-bold text-neutral-900">{stats.nbBeneficiaires}</p>
          <p className="text-[9px] text-neutral-400 font-medium uppercase tracking-wide">Bénéficiaires</p>
        </div>
        <div className="bg-white rounded-lg border border-neutral-200 px-3 py-2.5 text-center">
          <p className="text-lg font-bold text-emerald-600 tabular-nums">{formatFCFA(stats.totalRegle)}</p>
          <p className="text-[9px] text-neutral-400 font-medium uppercase tracking-wide">Total encaissé</p>
        </div>
        <div className="bg-white rounded-lg border border-neutral-200 px-3 py-2.5 text-center">
          <p className="text-lg font-bold text-neutral-900 tabular-nums">{formatFCFA(stats.resteAPayer)}</p>
          <p className="text-[9px] text-neutral-400 font-medium uppercase tracking-wide">Créances ouvertes</p>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * ORGANISMES IPM
 * ═══════════════════════════════════════════════════════════════════ */
function IpmOrganismes({ tenantId }: { tenantId: string }) {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ nom: '', code: '', adresse: '', telephone: '', email: '', contact_facturation: '', delai_paiement_jours: 30, conditions_paiement: '', observations: '' });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data } = await supabase.from('ipm_organismes').select('*').eq('tenant_id', tenantId).order('nom');
    setList(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [tenantId]);

  const filtered = useMemo(() => {
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(o => o.nom.toLowerCase().includes(q) || (o.code || '').toLowerCase().includes(q));
  }, [list, search]);

  const openNew = () => {
    setEditing(null);
    setForm({ nom: '', code: '', adresse: '', telephone: '', email: '', contact_facturation: '', delai_paiement_jours: 30, conditions_paiement: '', observations: '' });
    setShowForm(true);
  };
  const openEdit = (o: any) => {
    setEditing(o);
    setForm({ nom: o.nom, code: o.code || '', adresse: o.adresse || '', telephone: o.telephone || '', email: o.email || '', contact_facturation: o.contact_facturation || '', delai_paiement_jours: o.delai_paiement_jours || 30, conditions_paiement: o.conditions_paiement || '', observations: o.observations || '' });
    setShowForm(true);
  };
  const save = async () => {
    if (!form.nom.trim()) return;
    setSaving(true);
    if (editing) {
      await supabase.from('ipm_organismes').update({ ...form, updated_at: new Date().toISOString() }).eq('id', editing.id);
    } else {
      await supabase.from('ipm_organismes').insert({ ...form, tenant_id: tenantId });
    }
    setSaving(false);
    setShowForm(false);
    load();
  };
  const toggleActive = async (o: any) => {
    await supabase.from('ipm_organismes').update({ is_active: !o.is_active }).eq('id', o.id);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4 text-neutral-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un organisme..." className="bare-input w-full text-sm py-1.5" />
          <div className="h-px bg-neutral-200 mt-1" />
        </div>
        {search && <button onClick={() => setSearch('')} className="shrink-0 p-1 text-neutral-400 hover:text-neutral-600"><X className="w-4 h-4" /></button>}
        <button onClick={openNew} className="shrink-0 p-1.5 text-neutral-500 hover:text-brand-700 transition-colors" title="Nouvel organisme">
          <Building2 className="w-4 h-4" />
        </button>
      </div>

      {loading ? <TableSkeleton /> : filtered.length === 0 ? (
        <EmptyIpm message="Aucun organisme IPM configuré" action="Créez votre premier organisme pour commencer" />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-2 lg:hidden">
            {filtered.map(o => (
              <div key={o.id} className="bg-white rounded-xl border border-neutral-200 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-neutral-900 truncate">{o.nom}</p>
                      <span className={`shrink-0 text-[8px] font-bold px-1.5 py-0.5 rounded-full uppercase ${o.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-100 text-neutral-500'}`}>
                        {o.is_active ? 'Actif' : 'Inactif'}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11px] text-neutral-500">
                      {o.code && <span>Code : {o.code}</span>}
                      {o.telephone && <span>{o.telephone}</span>}
                      <span>Délai : {o.delai_paiement_jours}j</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => openEdit(o)} className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-500 transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
                    <button onClick={() => toggleActive(o)} className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-500 transition-colors">{o.is_active ? <Ban className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {/* Desktop table */}
          <div className="hidden lg:block bg-white rounded-2xl border border-neutral-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-neutral-100">
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Organisme</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Code</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Contact</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Délai</th>
                    <th className="text-center px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Statut</th>
                    <th className="text-right px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filtered.map(o => (
                    <tr key={o.id} className="hover:bg-neutral-50/50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="text-sm font-semibold text-neutral-900">{o.nom}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-neutral-600">{o.code || '-'}</td>
                      <td className="px-4 py-3 text-xs text-neutral-600">{o.telephone || o.email || '-'}</td>
                      <td className="px-4 py-3 text-xs text-neutral-600">{o.delai_paiement_jours}j</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${o.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-100 text-neutral-500'}`}>
                          {o.is_active ? 'Actif' : 'Inactif'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEdit(o)} className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-500 transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
                          <button onClick={() => toggleActive(o)} className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-500 transition-colors">{o.is_active ? <Ban className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {showForm && (
        <Modal open title={editing ? 'Modifier l\'organisme' : 'Nouvel organisme IPM'} onClose={() => setShowForm(false)}>
          <div className="space-y-3 p-1">
            <FormField label="Nom de l'organisme *" value={form.nom} onChange={v => setForm({ ...form, nom: v })} />
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Code interne" value={form.code} onChange={v => setForm({ ...form, code: v })} />
              <FormField label="Délai paiement (jours)" value={String(form.delai_paiement_jours)} onChange={v => setForm({ ...form, delai_paiement_jours: Number(v) || 30 })} type="number" />
            </div>
            <FormField label="Adresse" value={form.adresse} onChange={v => setForm({ ...form, adresse: v })} />
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Téléphone" value={form.telephone} onChange={v => setForm({ ...form, telephone: v })} />
              <FormField label="Email" value={form.email} onChange={v => setForm({ ...form, email: v })} />
            </div>
            <FormField label="Contact facturation" value={form.contact_facturation} onChange={v => setForm({ ...form, contact_facturation: v })} />
            <FormField label="Conditions de paiement" value={form.conditions_paiement} onChange={v => setForm({ ...form, conditions_paiement: v })} />
            <FormField label="Observations" value={form.observations} onChange={v => setForm({ ...form, observations: v })} multiline />
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowForm(false)} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
              <button onClick={save} disabled={saving || !form.nom.trim()} className="btn-icon-primary" title="Enregistrer">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (editing ? 'Enregistrer' : 'Créer')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * CONVENTIONS IPM
 * ═══════════════════════════════════════════════════════════════════ */
function IpmConventions({ tenantId }: { tenantId: string }) {
  const [list, setList] = useState<any[]>([]);
  const [organismes, setOrganismes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({
    organisme_id: '', nom: '', code: '', date_debut: '', date_fin: '',
    taux_defaut: 80, plafond_facture: '', plafond_jour: '', plafond_mois: '', plafond_annuel: '',
    ordonnance_obligatoire: false, bon_prise_en_charge_obligatoire: false,
    numero_bon_obligatoire: false, numero_ordonnance_obligatoire: false,
    medecin_prescripteur_obligatoire: false, matricule_obligatoire: true,
    mode_arrondi: 'round', mode_calcul: 'ligne_par_ligne', application_plafond: 'apres_calcul',
    forcer_montant_ipm: false, justification_si_force: true,
  });
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const load = async () => {
    const [{ data: conv }, { data: orgs }] = await Promise.all([
      supabase.from('ipm_conventions').select('*, ipm_organismes(nom)').eq('tenant_id', tenantId).order('nom'),
      supabase.from('ipm_organismes').select('id, nom').eq('tenant_id', tenantId).eq('is_active', true).order('nom'),
    ]);
    setList(conv || []);
    setOrganismes(orgs || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [tenantId]);

  const filtered = useMemo(() => {
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(c => (c.nom || '').toLowerCase().includes(q) || (c.code || '').toLowerCase().includes(q) || (c.ipm_organismes?.nom || '').toLowerCase().includes(q));
  }, [list, search]);

  const openNew = () => {
    setEditing(null);
    setForm({
      organisme_id: organismes[0]?.id || '', nom: '', code: '', date_debut: '', date_fin: '',
      taux_defaut: 80, plafond_facture: '', plafond_jour: '', plafond_mois: '', plafond_annuel: '',
      ordonnance_obligatoire: false, bon_prise_en_charge_obligatoire: false,
      numero_bon_obligatoire: false, numero_ordonnance_obligatoire: false,
      medecin_prescripteur_obligatoire: false, matricule_obligatoire: true,
      mode_arrondi: 'round', mode_calcul: 'ligne_par_ligne', application_plafond: 'apres_calcul',
      forcer_montant_ipm: false, justification_si_force: true,
    });
    setShowForm(true);
  };
  const openEdit = (c: any) => {
    setEditing(c);
    setForm({
      organisme_id: c.organisme_id, nom: c.nom, code: c.code || '', date_debut: c.date_debut || '', date_fin: c.date_fin || '',
      taux_defaut: c.taux_defaut, plafond_facture: c.plafond_facture || '', plafond_jour: c.plafond_jour || '', plafond_mois: c.plafond_mois || '', plafond_annuel: c.plafond_annuel || '',
      ordonnance_obligatoire: c.ordonnance_obligatoire, bon_prise_en_charge_obligatoire: c.bon_prise_en_charge_obligatoire,
      numero_bon_obligatoire: c.numero_bon_obligatoire, numero_ordonnance_obligatoire: c.numero_ordonnance_obligatoire,
      medecin_prescripteur_obligatoire: c.medecin_prescripteur_obligatoire, matricule_obligatoire: c.matricule_obligatoire,
      mode_arrondi: c.mode_arrondi, mode_calcul: c.mode_calcul, application_plafond: c.application_plafond,
      forcer_montant_ipm: c.forcer_montant_ipm, justification_si_force: c.justification_si_force,
    });
    setShowForm(true);
  };
  const save = async () => {
    if (!form.nom.trim() || !form.organisme_id) return;
    setSaving(true);
    const payload = {
      ...form,
      taux_defaut: Number(form.taux_defaut) || 80,
      plafond_facture: form.plafond_facture ? Number(form.plafond_facture) : null,
      plafond_jour: form.plafond_jour ? Number(form.plafond_jour) : null,
      plafond_mois: form.plafond_mois ? Number(form.plafond_mois) : null,
      plafond_annuel: form.plafond_annuel ? Number(form.plafond_annuel) : null,
      date_debut: form.date_debut || null,
      date_fin: form.date_fin || null,
    };
    if (editing) {
      await supabase.from('ipm_conventions').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editing.id);
    } else {
      await supabase.from('ipm_conventions').insert({ ...payload, tenant_id: tenantId });
    }
    setSaving(false);
    setShowForm(false);
    load();
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4 text-neutral-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher une convention..." className="bare-input w-full text-sm py-1.5" />
          <div className="h-px bg-neutral-200 mt-1" />
        </div>
        {search && <button onClick={() => setSearch('')} className="shrink-0 p-1 text-neutral-400 hover:text-neutral-600"><X className="w-4 h-4" /></button>}
        <button onClick={openNew} disabled={organismes.length === 0} className="shrink-0 p-1.5 text-neutral-500 hover:text-brand-700 disabled:opacity-40 transition-colors" title="Nouvelle convention">
          <FileText className="w-4 h-4" />
        </button>
      </div>

      {organismes.length === 0 && !loading && (
        <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-800">
          Créez d'abord un organisme IPM avant de pouvoir ajouter une convention.
        </div>
      )}

      {loading ? <TableSkeleton /> : filtered.length === 0 ? (
        <EmptyIpm message="Aucune convention IPM" action="Configurez vos conventions pour définir les taux de prise en charge" />
      ) : (
        <div className="grid gap-3">
          {filtered.map(c => {
            const expired = c.date_fin && c.date_fin < today;
            return (
              <div key={c.id} className={`bg-white rounded-xl border p-4 transition-all hover:shadow-sm ${expired ? 'border-amber-200 bg-amber-50/30' : 'border-neutral-200'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="text-sm font-bold text-neutral-900 truncate">{c.nom}</h4>
                      {expired && <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 uppercase">Expirée</span>}
                      {!c.is_active && <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-500 uppercase">Inactive</span>}
                    </div>
                    <p className="text-xs text-neutral-500">{c.ipm_organismes?.nom || '-'} {c.code ? `· ${c.code}` : ''}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-neutral-600">
                      <span>Taux : <b>{c.taux_defaut}%</b></span>
                      {c.plafond_facture && <span>Plafond/fact. : <b>{formatFCFA(c.plafond_facture)}</b></span>}
                      {c.plafond_mois && <span>Plafond/mois : <b>{formatFCFA(c.plafond_mois)}</b></span>}
                      <span>Calcul : <b>{c.mode_calcul === 'ligne_par_ligne' ? 'Ligne par ligne' : c.mode_calcul === 'total_facture' ? 'Total facture' : 'Articles éligibles'}</b></span>
                    </div>
                    {c.date_debut && (
                      <p className="text-[10px] text-neutral-400 mt-1">
                        Du {c.date_debut} {c.date_fin ? `au ${c.date_fin}` : '(sans fin)'}
                      </p>
                    )}
                  </div>
                  <button onClick={() => openEdit(c)} className="shrink-0 p-2 rounded-lg hover:bg-neutral-100 text-neutral-400 transition-colors">
                    <Edit2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <Modal open title={editing ? 'Modifier la convention' : 'Nouvelle convention IPM'} onClose={() => setShowForm(false)} size="lg">
          <div className="space-y-4 p-1 max-h-[70vh] overflow-y-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-neutral-500 mb-1 block">Organisme IPM *</label>
                <select value={form.organisme_id} onChange={e => setForm({ ...form, organisme_id: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-neutral-200 text-sm focus:border-neutral-400 outline-none">
                  {organismes.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
                </select>
              </div>
              <FormField label="Nom de la convention *" value={form.nom} onChange={v => setForm({ ...form, nom: v })} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <FormField label="Code" value={form.code} onChange={v => setForm({ ...form, code: v })} />
              <FormField label="Taux par défaut (%)" value={String(form.taux_defaut)} onChange={v => setForm({ ...form, taux_defaut: v })} type="number" />
              <FormField label="Date début" value={form.date_debut} onChange={v => setForm({ ...form, date_debut: v })} type="date" />
              <FormField label="Date fin" value={form.date_fin} onChange={v => setForm({ ...form, date_fin: v })} type="date" />
            </div>

            <fieldset className="border border-neutral-200 rounded-lg p-3">
              <legend className="text-[10px] font-bold text-neutral-400 uppercase px-1">Plafonds</legend>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <FormField label="Par facture" value={form.plafond_facture} onChange={v => setForm({ ...form, plafond_facture: v })} type="number" placeholder="Illimité" />
                <FormField label="Par jour" value={form.plafond_jour} onChange={v => setForm({ ...form, plafond_jour: v })} type="number" placeholder="Illimité" />
                <FormField label="Par mois" value={form.plafond_mois} onChange={v => setForm({ ...form, plafond_mois: v })} type="number" placeholder="Illimité" />
                <FormField label="Annuel" value={form.plafond_annuel} onChange={v => setForm({ ...form, plafond_annuel: v })} type="number" placeholder="Illimité" />
              </div>
            </fieldset>

            <fieldset className="border border-neutral-200 rounded-lg p-3">
              <legend className="text-[10px] font-bold text-neutral-400 uppercase px-1">Documents obligatoires</legend>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <CheckboxField label="Ordonnance" checked={form.ordonnance_obligatoire} onChange={v => setForm({ ...form, ordonnance_obligatoire: v })} />
                <CheckboxField label="Bon de prise en charge" checked={form.bon_prise_en_charge_obligatoire} onChange={v => setForm({ ...form, bon_prise_en_charge_obligatoire: v })} />
                <CheckboxField label="Numéro de bon" checked={form.numero_bon_obligatoire} onChange={v => setForm({ ...form, numero_bon_obligatoire: v })} />
                <CheckboxField label="Numéro ordonnance" checked={form.numero_ordonnance_obligatoire} onChange={v => setForm({ ...form, numero_ordonnance_obligatoire: v })} />
                <CheckboxField label="Médecin prescripteur" checked={form.medecin_prescripteur_obligatoire} onChange={v => setForm({ ...form, medecin_prescripteur_obligatoire: v })} />
                <CheckboxField label="Matricule bénéficiaire" checked={form.matricule_obligatoire} onChange={v => setForm({ ...form, matricule_obligatoire: v })} />
              </div>
            </fieldset>

            <fieldset className="border border-neutral-200 rounded-lg p-3">
              <legend className="text-[10px] font-bold text-neutral-400 uppercase px-1">Règles de calcul</legend>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-neutral-500 mb-1 block">Mode de calcul</label>
                  <select value={form.mode_calcul} onChange={e => setForm({ ...form, mode_calcul: e.target.value })} className="w-full h-9 px-3 rounded-lg border border-neutral-200 text-xs focus:border-neutral-400 outline-none">
                    <option value="ligne_par_ligne">Ligne par ligne</option>
                    <option value="total_facture">Total facture</option>
                    <option value="articles_eligibles">Articles éligibles seuls</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-medium text-neutral-500 mb-1 block">Application du plafond</label>
                  <select value={form.application_plafond} onChange={e => setForm({ ...form, application_plafond: e.target.value })} className="w-full h-9 px-3 rounded-lg border border-neutral-200 text-xs focus:border-neutral-400 outline-none">
                    <option value="apres_calcul">Après calcul</option>
                    <option value="avant_calcul">Avant calcul</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-medium text-neutral-500 mb-1 block">Arrondi</label>
                  <select value={form.mode_arrondi} onChange={e => setForm({ ...form, mode_arrondi: e.target.value })} className="w-full h-9 px-3 rounded-lg border border-neutral-200 text-xs focus:border-neutral-400 outline-none">
                    <option value="round">Arrondi standard</option>
                    <option value="floor">Arrondi inférieur</option>
                    <option value="ceil">Arrondi supérieur</option>
                  </select>
                </div>
              </div>
              <div className="flex flex-wrap gap-4 mt-3">
                <CheckboxField label="Permettre de forcer le montant IPM" checked={form.forcer_montant_ipm} onChange={v => setForm({ ...form, forcer_montant_ipm: v })} />
                {form.forcer_montant_ipm && (
                  <CheckboxField label="Justification obligatoire si forcé" checked={form.justification_si_force} onChange={v => setForm({ ...form, justification_si_force: v })} />
                )}
              </div>
            </fieldset>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowForm(false)} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
              <button onClick={save} disabled={saving || !form.nom.trim() || !form.organisme_id} className="btn-icon-primary" title="Enregistrer">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Enregistrer'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * BÉNÉFICIAIRES IPM
 * ═══════════════════════════════════════════════════════════════════ */
function IpmBeneficiaires({ tenantId }: { tenantId: string }) {
  const [list, setList] = useState<any[]>([]);
  const [organismes, setOrganismes] = useState<any[]>([]);
  const [conventions, setConventions] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({
    customer_id: '', organisme_id: '', convention_id: '', matricule: '',
    nom_titulaire: '', lien_titulaire: 'lui_meme',
    date_debut_couverture: '', date_fin_couverture: '',
    plafond_individuel: '', statut: 'actif', observations: '',
  });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [{ data: benef }, { data: orgs }, { data: convs }, { data: custs }] = await Promise.all([
      supabase.from('ipm_beneficiaires').select('*, customers(name, phone), ipm_organismes(nom), ipm_conventions(nom)').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
      supabase.from('ipm_organismes').select('id, nom').eq('tenant_id', tenantId).eq('is_active', true),
      supabase.from('ipm_conventions').select('id, nom, organisme_id').eq('tenant_id', tenantId).eq('is_active', true),
      supabase.from('customers').select('id, name, phone').eq('tenant_id', tenantId).eq('is_active', true).order('name'),
    ]);
    setList(benef || []);
    setOrganismes(orgs || []);
    setConventions(convs || []);
    setCustomers(custs || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [tenantId]);

  const filtered = useMemo(() => {
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(b => (b.customers?.name || '').toLowerCase().includes(q) || (b.matricule || '').toLowerCase().includes(q) || (b.nom_titulaire || '').toLowerCase().includes(q));
  }, [list, search]);

  const openNew = () => {
    setEditing(null);
    setForm({ customer_id: '', organisme_id: organismes[0]?.id || '', convention_id: '', matricule: '', nom_titulaire: '', lien_titulaire: 'lui_meme', date_debut_couverture: '', date_fin_couverture: '', plafond_individuel: '', statut: 'actif', observations: '' });
    setShowForm(true);
  };
  const save = async () => {
    if (!form.customer_id || !form.organisme_id) return;
    setSaving(true);
    const payload = { ...form, plafond_individuel: form.plafond_individuel ? Number(form.plafond_individuel) : null, date_debut_couverture: form.date_debut_couverture || null, date_fin_couverture: form.date_fin_couverture || null, convention_id: form.convention_id || null };
    if (editing) {
      await supabase.from('ipm_beneficiaires').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editing.id);
    } else {
      await supabase.from('ipm_beneficiaires').insert({ ...payload, tenant_id: tenantId });
    }
    setSaving(false);
    setShowForm(false);
    load();
  };

  const filteredConvs = conventions.filter(c => c.organisme_id === form.organisme_id);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4 text-neutral-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher par nom, matricule..." className="bare-input w-full text-sm py-1.5" />
          <div className="h-px bg-neutral-200 mt-1" />
        </div>
        {search && <button onClick={() => setSearch('')} className="shrink-0 p-1 text-neutral-400 hover:text-neutral-600"><X className="w-4 h-4" /></button>}
        <button onClick={openNew} disabled={organismes.length === 0} className="shrink-0 p-1.5 text-neutral-500 hover:text-brand-700 disabled:opacity-40 transition-colors" title="Nouveau bénéficiaire">
          <Users className="w-4 h-4" />
        </button>
      </div>

      {loading ? <TableSkeleton /> : filtered.length === 0 ? (
        <EmptyIpm message="Aucun bénéficiaire IPM" action="Associez un client à un organisme IPM" />
      ) : (
        <div className="grid gap-2">
          {filtered.map(b => {
            const expired = b.date_fin_couverture && b.date_fin_couverture < today;
            return (
              <div key={b.id} className={`bg-white rounded-xl border p-3.5 ${expired || b.statut === 'expire' ? 'border-amber-200' : b.statut === 'suspendu' ? 'border-rose-200' : 'border-neutral-200'}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-neutral-900 truncate">{b.customers?.name || '-'}</p>
                      <span className={`shrink-0 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase ${b.statut === 'actif' && !expired ? 'bg-emerald-100 text-emerald-700' : b.statut === 'suspendu' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                        {expired ? 'Expiré' : b.statut}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11px] text-neutral-500">
                      <span>{b.ipm_organismes?.nom}</span>
                      {b.matricule && <span>Mat. {b.matricule}</span>}
                      {b.ipm_conventions?.nom && <span>Conv. {b.ipm_conventions.nom}</span>}
                      {b.date_fin_couverture && <span>Fin : {b.date_fin_couverture}</span>}
                    </div>
                  </div>
                  <button onClick={() => { setEditing(b); setForm({ customer_id: b.customer_id, organisme_id: b.organisme_id, convention_id: b.convention_id || '', matricule: b.matricule || '', nom_titulaire: b.nom_titulaire || '', lien_titulaire: b.lien_titulaire, date_debut_couverture: b.date_debut_couverture || '', date_fin_couverture: b.date_fin_couverture || '', plafond_individuel: b.plafond_individuel || '', statut: b.statut, observations: b.observations || '' }); setShowForm(true); }} className="p-2 rounded-lg hover:bg-neutral-100 text-neutral-400">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <Modal open title={editing ? 'Modifier le bénéficiaire' : 'Nouveau bénéficiaire IPM'} onClose={() => setShowForm(false)} size="lg">
          <div className="space-y-3 p-1 max-h-[70vh] overflow-y-auto">
            <div>
              <label className="text-[11px] font-medium text-neutral-500 mb-1 block">Client *</label>
              <select value={form.customer_id} onChange={e => setForm({ ...form, customer_id: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-neutral-200 text-sm focus:border-neutral-400 outline-none">
                <option value="">-- Sélectionner --</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name} {c.phone ? `(${c.phone})` : ''}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-neutral-500 mb-1 block">Organisme IPM *</label>
                <select value={form.organisme_id} onChange={e => setForm({ ...form, organisme_id: e.target.value, convention_id: '' })} className="w-full h-10 px-3 rounded-lg border border-neutral-200 text-sm focus:border-neutral-400 outline-none">
                  {organismes.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-neutral-500 mb-1 block">Convention</label>
                <select value={form.convention_id} onChange={e => setForm({ ...form, convention_id: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-neutral-200 text-sm focus:border-neutral-400 outline-none">
                  <option value="">-- Par défaut --</option>
                  {filteredConvs.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Matricule assuré" value={form.matricule} onChange={v => setForm({ ...form, matricule: v })} />
              <FormField label="Nom du titulaire" value={form.nom_titulaire} onChange={v => setForm({ ...form, nom_titulaire: v })} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] font-medium text-neutral-500 mb-1 block">Lien avec titulaire</label>
                <select value={form.lien_titulaire} onChange={e => setForm({ ...form, lien_titulaire: e.target.value })} className="w-full h-9 px-3 rounded-lg border border-neutral-200 text-xs focus:border-neutral-400 outline-none">
                  <option value="lui_meme">Lui-même</option>
                  <option value="conjoint">Conjoint</option>
                  <option value="enfant">Enfant</option>
                  <option value="parent">Parent</option>
                  <option value="autre">Autre</option>
                </select>
              </div>
              <FormField label="Début couverture" value={form.date_debut_couverture} onChange={v => setForm({ ...form, date_debut_couverture: v })} type="date" />
              <FormField label="Fin couverture" value={form.date_fin_couverture} onChange={v => setForm({ ...form, date_fin_couverture: v })} type="date" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Plafond individuel (FCFA)" value={form.plafond_individuel} onChange={v => setForm({ ...form, plafond_individuel: v })} type="number" placeholder="Selon convention" />
              <div>
                <label className="text-[11px] font-medium text-neutral-500 mb-1 block">Statut</label>
                <select value={form.statut} onChange={e => setForm({ ...form, statut: e.target.value })} className="w-full h-9 px-3 rounded-lg border border-neutral-200 text-xs focus:border-neutral-400 outline-none">
                  <option value="actif">Actif</option>
                  <option value="suspendu">Suspendu</option>
                  <option value="expire">Expiré</option>
                </select>
              </div>
            </div>
            <FormField label="Observations" value={form.observations} onChange={v => setForm({ ...form, observations: v })} multiline />
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowForm(false)} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
              <button onClick={save} disabled={saving || !form.customer_id || !form.organisme_id} className="btn-icon-primary" title="Enregistrer">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Enregistrer'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * BORDEREAUX IPM
 * ═══════════════════════════════════════════════════════════════════ */
function IpmBordereaux({ tenantId }: { tenantId: string }) {
  const { tenant } = useApp();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [organismes, setOrganismes] = useState<any[]>([]);
  const [selectedOrg, setSelectedOrg] = useState('');
  const [periodeDebut, setPeriodeDebut] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); });
  const [periodeFin, setPeriodeFin] = useState(() => new Date().toISOString().slice(0, 10));
  const [pendingVentes, setPendingVentes] = useState<any[]>([]);
  const [loadingVentes, setLoadingVentes] = useState(false);
  const [printTarget, setPrintTarget] = useState<any>(null);
  const [printVentes, setPrintVentes] = useState<any[]>([]);
  const [search, setSearch] = useState('');

  const load = async () => {
    const { data } = await supabase.from('ipm_bordereaux').select('*, ipm_organismes(nom)').eq('tenant_id', tenantId).order('created_at', { ascending: false });
    setList(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [tenantId]);

  const filteredBord = useMemo(() => {
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(b => (b.ipm_organismes?.nom || '').toLowerCase().includes(q) || (b.numero || '').toLowerCase().includes(q) || (b.statut || '').toLowerCase().includes(q));
  }, [list, search]);

  useEffect(() => {
    if (!showCreate) return;
    (async () => {
      const { data } = await supabase.from('ipm_organismes').select('id, nom').eq('tenant_id', tenantId).eq('is_active', true);
      setOrganismes(data || []);
    })();
  }, [showCreate, tenantId]);

  useEffect(() => {
    if (!selectedOrg) { setPendingVentes([]); return; }
    setLoadingVentes(true);
    (async () => {
      let q = supabase.from('ipm_ventes').select('id, date_vente, part_ipm, part_client, montant_total, ipm_beneficiaires(matricule, customers(name))')
        .eq('tenant_id', tenantId).eq('organisme_id', selectedOrg).eq('statut', 'en_attente');
      if (periodeDebut) q = q.gte('date_vente', periodeDebut);
      if (periodeFin) q = q.lte('date_vente', periodeFin);
      const { data } = await q.order('date_vente', { ascending: true });
      setPendingVentes(data || []);
      setLoadingVentes(false);
    })();
  }, [selectedOrg, tenantId, periodeDebut, periodeFin]);

  const createBordereau = async () => {
    if (!selectedOrg || pendingVentes.length === 0) return;
    setCreating(true);
    const totalPartIpm = pendingVentes.reduce((s, v) => s + Number(v.part_ipm || 0), 0);
    const numero = `BRD-${Date.now().toString(36).toUpperCase()}`;
    const { data: brd, error: err } = await supabase.from('ipm_bordereaux').insert({
      tenant_id: tenantId, organisme_id: selectedOrg,
      numero, periode_debut: periodeDebut, periode_fin: periodeFin,
      total_part_ipm: totalPartIpm, nombre_factures: pendingVentes.length,
      statut: 'brouillon',
    }).select('id').single();
    if (!err && brd) {
      await supabase.from('ipm_ventes').update({ statut: 'bordereau', bordereau_id: brd.id })
        .in('id', pendingVentes.map(v => v.id));
    }
    setCreating(false);
    setShowCreate(false);
    setSelectedOrg('');
    load();
  };

  const printBordereau = async (b: any) => {
    const { data: ventes } = await supabase.from('ipm_ventes')
      .select('date_vente, part_ipm, part_client, montant_total, ipm_beneficiaires(matricule, customers(name))')
      .eq('bordereau_id', b.id).order('date_vente', { ascending: true });
    setPrintVentes(ventes || []);
    setPrintTarget(b);
  };

  useEffect(() => {
    if (!printTarget || !tenant) return;
    const orgNom = printTarget.ipm_organismes?.nom || '';
    const ventes = printVentes;
    const totalIpm = ventes.reduce((s: number, v: any) => s + Number(v.part_ipm || 0), 0);
    const totalVentes = ventes.reduce((s: number, v: any) => s + Number(v.montant_total || 0), 0);
    const totalClient = ventes.reduce((s: number, v: any) => s + Number(v.part_client || 0), 0);
    const fmtN = (n: number) => n.toLocaleString('fr-FR');
    const fmtD = (d: string) => d ? new Date(d + 'T00:00:00').toLocaleDateString('fr-FR') : '-';
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Bordereau IPM ${printTarget.numero}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;font-size:10px;color:#1e293b;padding:12mm 15mm;line-height:1.4}
@page{size:A4;margin:12mm 15mm}
@media print{body{padding:0}}

.page-header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:2px solid #1e293b;margin-bottom:16px}
.tenant-block h1{font-size:15px;font-weight:800;color:#0f172a;margin-bottom:1px;letter-spacing:-0.3px}
.tenant-block p{font-size:9px;color:#475569;line-height:1.5}
.doc-block{text-align:right}
.doc-block h2{font-size:13px;font-weight:800;color:#0f172a;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px}
.doc-block table{margin-left:auto}
.doc-block table td{font-size:9px;padding:1px 0;color:#475569}
.doc-block table td:first-child{font-weight:600;color:#1e293b;padding-right:8px;text-align:right}

.two-col{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px}
.block{border:1px solid #cbd5e1;border-radius:4px;padding:10px 12px}
.block h3{font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#64748b;margin-bottom:6px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
.block p{font-size:9.5px;color:#1e293b;line-height:1.6}
.block p span{color:#64748b}

.financial-summary{margin-bottom:16px;border:1px solid #1e293b;border-radius:4px;overflow:hidden}
.financial-summary table{width:100%;border-collapse:collapse}
.financial-summary th{font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;text-align:left;padding:6px 10px;background:#f8fafc;border-bottom:1px solid #e2e8f0}
.financial-summary td{font-size:10px;padding:7px 10px;border-bottom:1px solid #f1f5f9}
.financial-summary td:last-child{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
.financial-summary tr.net{background:#f8fafc;border-top:2px solid #1e293b}
.financial-summary tr.net td{font-size:12px;font-weight:800;padding:9px 10px}

.detail-table{width:100%;border-collapse:collapse;margin-bottom:14px;border:1px solid #cbd5e1;border-radius:4px;overflow:hidden}
.detail-table thead th{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;padding:6px 8px;background:#f8fafc;border-bottom:1.5px solid #cbd5e1;text-align:left}
.detail-table thead th.right{text-align:right}
.detail-table thead th.center{text-align:center}
.detail-table tbody td{padding:5px 8px;border-bottom:1px solid #e2e8f0;font-size:9.5px}
.detail-table tfoot td{font-size:10px;font-weight:800;padding:7px 8px;border-top:2px solid #1e293b;background:#f8fafc}

.section-title{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#1e293b;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #e2e8f0}

.signatures{margin-top:28px;display:grid;grid-template-columns:1fr 1fr;gap:40px}
.sig-block{text-align:center}
.sig-block p{font-size:9px;font-weight:600;color:#1e293b;margin-bottom:40px}
.sig-block .line{border-bottom:1px solid #94a3b8;width:70%;margin:0 auto}

.footer{margin-top:20px;padding-top:8px;border-top:1px solid #cbd5e1;display:flex;justify-content:space-between;font-size:8px;color:#94a3b8}
</style></head><body>

<div class="page-header">
  <div class="tenant-block">
    <h1>${tenant.name || ''}</h1>
    ${(tenant as any).legal_name ? `<p><strong>${(tenant as any).legal_name}</strong></p>` : ''}
    ${tenant.address ? `<p>${tenant.address}</p>` : ''}
    ${tenant.phone ? `<p>Tél : ${tenant.phone}</p>` : ''}
    ${(tenant as any).email ? `<p>${(tenant as any).email}</p>` : ''}
    ${(tenant as any).ninea ? `<p>NINEA : ${(tenant as any).ninea}</p>` : ''}
    ${(tenant as any).rccm ? `<p>RCCM : ${(tenant as any).rccm}</p>` : ''}
  </div>
  <div class="doc-block">
    <h2>Bordereau IPM</h2>
    <table>
      <tr><td>N° :</td><td>${printTarget.numero}</td></tr>
      <tr><td>Date :</td><td>${new Date().toLocaleDateString('fr-FR')}</td></tr>
      <tr><td>Période :</td><td>${fmtD(printTarget.periode_debut)} au ${fmtD(printTarget.periode_fin)}</td></tr>
      <tr><td>Statut :</td><td style="font-weight:700;text-transform:uppercase">${printTarget.statut}</td></tr>
    </table>
  </div>
</div>

<div class="two-col">
  <div class="block">
    <h3>Organisme IPM</h3>
    <p><strong>${orgNom}</strong></p>
  </div>
  <div class="block">
    <h3>Récapitulatif</h3>
    <p><span>Nombre de prestations :</span> ${ventes.length}</p>
    <p><span>Montant total ventes :</span> ${fmtN(totalVentes)} FCFA</p>
    <p><span>Part clients :</span> ${fmtN(totalClient)} FCFA</p>
    <p><span>Créance IPM :</span> <strong>${fmtN(totalIpm)} FCFA</strong></p>
  </div>
</div>

<div class="section-title">Détail des ventes couvertes</div>
<table class="detail-table">
  <thead>
    <tr>
      <th class="center">#</th>
      <th>Date</th>
      <th>Bénéficiaire</th>
      <th>Matricule</th>
      <th class="right">Total</th>
      <th class="right">Part IPM</th>
      <th class="right">Part Client</th>
    </tr>
  </thead>
  <tbody>
    ${ventes.map((v: any, i: number) => `<tr>
      <td style="text-align:center;color:#94a3b8">${i + 1}</td>
      <td style="color:#475569">${fmtD(v.date_vente)}</td>
      <td style="color:#1e293b;font-weight:500">${v.ipm_beneficiaires?.customers?.name || '-'}</td>
      <td style="color:#64748b">${v.ipm_beneficiaires?.matricule || '-'}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;color:#1e293b">${fmtN(Number(v.montant_total || 0))}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;font-weight:700;color:#0f172a">${fmtN(Number(v.part_ipm || 0))}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;color:#64748b">${fmtN(Number(v.part_client || 0))}</td>
    </tr>`).join('')}
  </tbody>
  <tfoot>
    <tr>
      <td colspan="4" style="font-weight:700">TOTAUX</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums">${fmtN(totalVentes)}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums">${fmtN(totalIpm)}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums">${fmtN(totalClient)}</td>
    </tr>
  </tfoot>
</table>

<div class="financial-summary">
  <table>
    <thead><tr><th>Désignation</th><th style="text-align:right">Montant (FCFA)</th></tr></thead>
    <tbody>
      <tr><td>Montant total des ventes couvertes</td><td>${fmtN(totalVentes)}</td></tr>
      <tr><td>Part clients encaissée</td><td>${fmtN(totalClient)}</td></tr>
      <tr class="net"><td>CRÉANCE IPM (Part à facturer)</td><td>${fmtN(totalIpm)} FCFA</td></tr>
    </tbody>
  </table>
</div>

<div class="signatures">
  <div class="sig-block">
    <p>Cachet et signature de la pharmacie</p>
    <div class="line"></div>
  </div>
  <div class="sig-block">
    <p>Cachet et visa ${orgNom}</p>
    <div class="line"></div>
  </div>
</div>

<div class="footer">
  <span>Bordereau IPM ${printTarget.numero} — Généré le ${new Date().toLocaleDateString('fr-FR')}</span>
  <span>Propulsé par WAARWI</span>
</div>

</body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 400);
    setPrintTarget(null);
  }, [printTarget, printVentes, tenant]);

  const validateBordereau = async (b: any) => {
    await supabase.from('ipm_bordereaux').update({ statut: 'valide' }).eq('id', b.id);
    load();
  };

  const statusColors: Record<string, string> = {
    brouillon: 'bg-neutral-100 text-neutral-600',
    valide: 'bg-neutral-100 text-neutral-800',
    transmis: 'bg-neutral-100 text-neutral-800',
    facture: 'bg-neutral-100 text-neutral-800',
    regle: 'bg-emerald-100 text-emerald-700',
    partiellement_regle: 'bg-amber-100 text-amber-700',
    rejete: 'bg-red-100 text-red-700',
    annule: 'bg-neutral-100 text-neutral-400',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4 text-neutral-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un bordereau..." className="bare-input w-full text-sm py-1.5" />
          <div className="h-px bg-neutral-200 mt-1" />
        </div>
        {search && <button onClick={() => setSearch('')} className="shrink-0 p-1 text-neutral-400 hover:text-neutral-600"><X className="w-4 h-4" /></button>}
        <button onClick={() => setShowCreate(true)} className="shrink-0 p-1.5 text-neutral-500 hover:text-brand-700 transition-colors" title="Générer un bordereau">
          <Receipt className="w-4 h-4" />
        </button>
      </div>

      {loading ? <TableSkeleton /> : filteredBord.length === 0 ? (
        <EmptyIpm message="Aucun bordereau IPM" action="Générez un bordereau à partir des ventes IPM en attente" />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-2 lg:hidden">
            {filteredBord.map(b => (
              <div key={b.id} className="bg-white rounded-xl border border-neutral-200 p-3.5">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-neutral-900 truncate">{b.ipm_organismes?.nom || '-'}</p>
                    <p className="text-[10px] text-neutral-400 mt-0.5">{b.numero}</p>
                  </div>
                  <span className={`shrink-0 inline-flex px-2 py-0.5 rounded-full text-[8px] font-bold uppercase ${statusColors[b.statut] || statusColors.brouillon}`}>
                    {b.statut}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                  <div><span className="text-neutral-400">Part IPM</span><p className="font-bold text-neutral-900 tabular-nums">{formatFCFA(b.total_part_ipm)}</p></div>
                  <div><span className="text-neutral-400">Ventes</span><p className="font-semibold text-neutral-700">{b.nombre_factures}</p></div>
                  {b.periode_debut && <div className="col-span-2"><span className="text-neutral-400">Période</span><p className="text-neutral-600">{b.periode_debut} → {b.periode_fin}</p></div>}
                  {b.total_accepte != null && <div><span className="text-neutral-400">Accepté</span><p className="font-semibold text-emerald-600 tabular-nums">{formatFCFA(b.total_accepte)}</p></div>}
                  {b.total_rejete != null && Number(b.total_rejete) > 0 && <div><span className="text-neutral-400">Rejeté</span><p className="font-semibold text-red-600 tabular-nums">{formatFCFA(b.total_rejete)}</p></div>}
                </div>
                <div className="flex items-center justify-end gap-1 mt-2 pt-2 border-t border-neutral-100">
                  {b.statut === 'brouillon' && (
                    <button onClick={() => validateBordereau(b)} className="p-1.5 rounded-lg hover:bg-emerald-50 text-neutral-500 hover:text-emerald-600 transition-colors" title="Valider">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button onClick={() => printBordereau(b)} className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-500 hover:text-neutral-700 transition-colors" title="Imprimer">
                    <Printer className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {/* Desktop table */}
          <div className="hidden lg:block bg-white rounded-2xl border border-neutral-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-neutral-100">
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">N°</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Organisme</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Période</th>
                    <th className="text-right px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Part IPM</th>
                    <th className="text-right px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Accepté</th>
                    <th className="text-right px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Rejeté</th>
                    <th className="text-right px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Écart</th>
                    <th className="text-center px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Ventes</th>
                    <th className="text-center px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Statut</th>
                    <th className="text-center px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400 w-20">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filteredBord.map(b => (
                    <tr key={b.id} className="hover:bg-neutral-50/50">
                      <td className="px-4 py-3 text-xs font-semibold text-neutral-900">{b.numero}</td>
                      <td className="px-4 py-3 text-xs text-neutral-600">{b.ipm_organismes?.nom || '-'}</td>
                      <td className="px-4 py-3 text-xs text-neutral-500">{b.periode_debut} → {b.periode_fin}</td>
                      <td className="px-4 py-3 text-xs font-bold text-neutral-800 text-right tabular-nums">{formatFCFA(b.total_part_ipm)}</td>
                      <td className="px-4 py-3 text-xs font-bold text-emerald-600 text-right tabular-nums">{b.total_accepte != null ? formatFCFA(b.total_accepte) : '—'}</td>
                      <td className="px-4 py-3 text-xs font-bold text-red-600 text-right tabular-nums">{b.total_rejete != null && Number(b.total_rejete) > 0 ? formatFCFA(b.total_rejete) : '—'}</td>
                      <td className="px-4 py-3 text-xs font-bold text-amber-600 text-right tabular-nums">{b.total_ecart != null && Number(b.total_ecart) !== 0 ? formatFCFA(b.total_ecart) : '—'}</td>
                      <td className="px-4 py-3 text-xs text-neutral-600 text-center">{b.nombre_factures}{b.nb_factures_rejetees > 0 && <span className="text-red-500 ml-1">({b.nb_factures_rejetees} rej.)</span>}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${statusColors[b.statut] || statusColors.brouillon}`}>
                          {b.statut}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {b.statut === 'brouillon' && (
                            <button onClick={() => validateBordereau(b)} className="p-1.5 rounded-lg hover:bg-emerald-50 text-neutral-500 hover:text-emerald-600 transition-colors" title="Valider le bordereau">
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button onClick={() => printBordereau(b)} className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-500 hover:text-neutral-700 transition-colors" title="Imprimer">
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {showCreate && (
        <Modal open title="Générer un bordereau IPM" onClose={() => setShowCreate(false)} size="lg">
          <div className="space-y-4">
            <div>
              <label className="text-[11px] font-medium text-neutral-500 mb-1 block">Organisme</label>
              <select value={selectedOrg} onChange={e => setSelectedOrg(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-neutral-200 text-sm">
                <option value="">Sélectionnez un organisme</option>
                {organismes.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-neutral-500 mb-1 block">Période du</label>
                <input type="date" value={periodeDebut} onChange={e => setPeriodeDebut(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-neutral-200 text-sm" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-neutral-500 mb-1 block">au</label>
                <input type="date" value={periodeFin} onChange={e => setPeriodeFin(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-neutral-200 text-sm" />
              </div>
            </div>
            {selectedOrg && (
              <div className="space-y-2">
                {loadingVentes ? (
                  <div className="flex items-center gap-2 text-xs text-neutral-500 py-4"><Loader2 className="w-4 h-4 animate-spin" /> Chargement...</div>
                ) : pendingVentes.length === 0 ? (
                  <p className="text-xs text-neutral-500 py-4 text-center">Aucune vente IPM en attente pour cette période</p>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-neutral-700">{pendingVentes.length} vente(s) en attente</p>
                      <p className="text-xs font-bold text-neutral-800">Total : {formatFCFA(pendingVentes.reduce((s, v) => s + Number(v.part_ipm), 0))}</p>
                    </div>
                    <div className="max-h-48 overflow-y-auto border border-neutral-200 rounded-lg divide-y divide-neutral-100">
                      {pendingVentes.map((v, i) => (
                        <div key={v.id} className="flex items-center justify-between px-3 py-2 text-xs hover:bg-neutral-50">
                          <span className="text-neutral-400 w-6">{i + 1}</span>
                          <span className="text-neutral-600 flex-1">{v.date_vente}</span>
                          <span className="text-neutral-500 flex-1 truncate">{v.ipm_beneficiaires?.customers?.name || '-'}</span>
                          <span className="font-bold text-neutral-800 tabular-nums">{formatFCFA(v.part_ipm)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowCreate(false)} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
              <button onClick={createBordereau} disabled={creating || !selectedOrg || pendingVentes.length === 0}
                className="btn-icon-primary" title="Générer le bordereau">
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * FACTURES IPM PAYEUR
 * ═══════════════════════════════════════════════════════════════════ */
function IpmFactures({ tenantId }: { tenantId: string }) {
  const { tenant } = useApp();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [organismes, setOrganismes] = useState<any[]>([]);
  const [selectedOrg, setSelectedOrg] = useState('');
  const [bordereaux, setBordereaux] = useState<any[]>([]);
  const [selectedBordereaux, setSelectedBordereaux] = useState<string[]>([]);
  const [printing, setPrinting] = useState(false);
  const [search, setSearch] = useState('');

  const load = async () => {
    const { data } = await supabase.from('ipm_factures').select('*, ipm_organismes(nom, code, adresse, telephone, email, contact_facturation, delai_paiement_jours, conditions_paiement)').eq('tenant_id', tenantId).order('created_at', { ascending: false });
    setList(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [tenantId]);

  const filteredFact = useMemo(() => {
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(f => (f.ipm_organismes?.nom || '').toLowerCase().includes(q) || (f.numero || '').toLowerCase().includes(q) || (f.statut || '').toLowerCase().includes(q));
  }, [list, search]);

  useEffect(() => {
    if (!showCreate) return;
    (async () => {
      const { data } = await supabase.from('ipm_organismes').select('id, nom').eq('tenant_id', tenantId).eq('is_active', true);
      setOrganismes(data || []);
    })();
  }, [showCreate, tenantId]);

  useEffect(() => {
    if (!selectedOrg) { setBordereaux([]); return; }
    (async () => {
      const { data } = await supabase.from('ipm_bordereaux').select('id, numero, total_part_ipm, nombre_factures, periode_debut, periode_fin, statut')
        .eq('tenant_id', tenantId).eq('organisme_id', selectedOrg).in('statut', ['valide']);
      setBordereaux(data || []);
    })();
  }, [selectedOrg, tenantId]);

  const createFacture = async () => {
    if (!selectedOrg || selectedBordereaux.length === 0) return;
    setCreating(true);
    const brdList = bordereaux.filter(b => selectedBordereaux.includes(b.id));
    const totalMontant = brdList.reduce((s, b) => s + Number(b.total_part_ipm || 0), 0);
    const numero = `FIPM-${Date.now().toString(36).toUpperCase()}`;
    const today = new Date().toISOString().slice(0, 10);
    const { data: inserted, error: err } = await supabase.from('ipm_factures').insert({
      tenant_id: tenantId, organisme_id: selectedOrg,
      bordereau_id: brdList[0]?.id || null,
      numero, date_facture: today,
      montant_total: totalMontant, montant_regle: 0, reste_a_payer: totalMontant,
      statut: 'emise',
    }).select('id').single();
    if (!err && inserted) {
      await supabase.from('ipm_bordereaux').update({ statut: 'facture', facture_ipm_id: inserted.id })
        .eq('tenant_id', tenantId).in('id', selectedBordereaux);
      await supabase.from('ipm_ventes').update({ statut: 'facture' })
        .eq('tenant_id', tenantId).in('bordereau_id', selectedBordereaux);
    }
    setCreating(false);
    setShowCreate(false);
    setSelectedOrg('');
    setSelectedBordereaux([]);
    load();
  };

  const printFacture = async (f: any) => {
    if (!tenant || printing) return;
    setPrinting(true);

    const org = f.ipm_organismes || {};

    // Fetch only bordereaux linked to THIS specific facture
    const { data: brdData } = await supabase.from('ipm_bordereaux')
      .select('id, numero, periode_debut, periode_fin, nombre_factures, total_part_ipm')
      .eq('facture_ipm_id', f.id);
    let linkedBordereaux = brdData || [];

    // Fallback for old factures without facture_ipm_id: use bordereau_id FK
    if (linkedBordereaux.length === 0 && f.bordereau_id) {
      const { data: fallback } = await supabase.from('ipm_bordereaux')
        .select('id, numero, periode_debut, periode_fin, nombre_factures, total_part_ipm')
        .eq('id', f.bordereau_id);
      linkedBordereaux = fallback || [];
    }

    const { data: convData } = await supabase.from('ipm_conventions')
      .select('nom, code, taux_defaut, ordonnance_obligatoire, bon_prise_en_charge_obligatoire')
      .eq('tenant_id', tenantId).eq('organisme_id', f.organisme_id).eq('is_active', true).limit(1);
    const convention = convData?.[0];

    const totalNbVentes = linkedBordereaux.reduce((s, b) => s + (b.nombre_factures || 0), 0);
    const totalPartIpm = linkedBordereaux.reduce((s, b) => s + Number(b.total_part_ipm || 0), 0);
    const montantRegle = Number(f.montant_regle || 0);
    const netAPayer = Number(f.reste_a_payer || 0);
    const periodeDebut = linkedBordereaux.length > 0 ? linkedBordereaux.reduce((min, b) => b.periode_debut < min ? b.periode_debut : min, linkedBordereaux[0].periode_debut) : '';
    const periodeFin = linkedBordereaux.length > 0 ? linkedBordereaux.reduce((max, b) => b.periode_fin > max ? b.periode_fin : max, linkedBordereaux[0].periode_fin) : '';

    const fmtN = (n: number) => n.toLocaleString('fr-FR');
    const fmtD = (d: string) => d ? new Date(d + 'T00:00:00').toLocaleDateString('fr-FR') : '-';

    const bordereauRows = linkedBordereaux.map((b, i) => `
      <tr>
        <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;font-size:10px;font-weight:600;color:#1e293b">${b.numero}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;font-size:10px;color:#475569">${fmtD(b.periode_debut)} au ${fmtD(b.periode_fin)}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;font-size:10px;text-align:center;color:#475569">${b.nombre_factures || 0}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;font-size:10px;text-align:right;font-weight:700;color:#0f172a;font-variant-numeric:tabular-nums">${fmtN(Number(b.total_part_ipm || 0))}</td>
      </tr>`).join('');

    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) { setPrinting(false); return; }

    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Facture IPM Payeur ${f.numero}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;font-size:10px;color:#1e293b;padding:12mm 15mm;line-height:1.4}
@page{size:A4;margin:12mm 15mm}
@media print{body{padding:0}}

.page-header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:2px solid #1e293b;margin-bottom:16px}
.tenant-block h1{font-size:15px;font-weight:800;color:#0f172a;margin-bottom:1px;letter-spacing:-0.3px}
.tenant-block p{font-size:9px;color:#475569;line-height:1.5}
.doc-block{text-align:right}
.doc-block h2{font-size:13px;font-weight:800;color:#0f172a;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px}
.doc-block table{margin-left:auto}
.doc-block table td{font-size:9px;padding:1px 0;color:#475569}
.doc-block table td:first-child{font-weight:600;color:#1e293b;padding-right:8px;text-align:right}

.two-col{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px}
.block{border:1px solid #cbd5e1;border-radius:4px;padding:10px 12px}
.block h3{font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#64748b;margin-bottom:6px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
.block p{font-size:9.5px;color:#1e293b;line-height:1.6}
.block p span{color:#64748b}

.financial-summary{margin-bottom:16px;border:1px solid #1e293b;border-radius:4px;overflow:hidden}
.financial-summary table{width:100%;border-collapse:collapse}
.financial-summary th{font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;text-align:left;padding:6px 10px;background:#f8fafc;border-bottom:1px solid #e2e8f0}
.financial-summary td{font-size:10px;padding:7px 10px;border-bottom:1px solid #f1f5f9}
.financial-summary td:last-child{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
.financial-summary tr.net{background:#f8fafc;border-top:2px solid #1e293b}
.financial-summary tr.net td{font-size:12px;font-weight:800;padding:9px 10px}

.brd-table{width:100%;border-collapse:collapse;margin-bottom:14px;border:1px solid #cbd5e1;border-radius:4px;overflow:hidden}
.brd-table thead th{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;padding:7px 10px;background:#f8fafc;border-bottom:1.5px solid #cbd5e1;text-align:left}
.brd-table thead th.right{text-align:right}
.brd-table thead th.center{text-align:center}
.brd-table tfoot td{font-size:10px;font-weight:800;padding:8px 10px;border-top:2px solid #1e293b;background:#f8fafc}

.section-title{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#1e293b;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #e2e8f0}

.mention{margin-top:14px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;font-size:8.5px;color:#475569;line-height:1.6;font-style:italic}

.pieces{margin-top:12px}
.pieces ul{list-style:none;padding:0}
.pieces li{font-size:9px;color:#475569;padding:2px 0;padding-left:12px;position:relative}
.pieces li::before{content:"\\2022";position:absolute;left:0;color:#94a3b8}

.signatures{margin-top:28px;display:grid;grid-template-columns:1fr 1fr;gap:40px}
.sig-block{text-align:center}
.sig-block p{font-size:9px;font-weight:600;color:#1e293b;margin-bottom:40px}
.sig-block .line{border-bottom:1px solid #94a3b8;width:70%;margin:0 auto}

.conditions{margin-top:14px;padding:10px 12px;border:1px solid #e2e8f0;border-radius:4px}
.conditions p{font-size:9px;color:#475569;line-height:1.6}
.conditions strong{color:#1e293b}

.footer{margin-top:20px;padding-top:8px;border-top:1px solid #cbd5e1;display:flex;justify-content:space-between;font-size:8px;color:#94a3b8}
</style></head><body>

<div class="page-header">
  <div class="tenant-block">
    <h1>${tenant.name || ''}</h1>
    ${(tenant as any).legal_name ? `<p><strong>${(tenant as any).legal_name}</strong></p>` : ''}
    ${tenant.address ? `<p>${tenant.address}</p>` : ''}
    ${tenant.phone ? `<p>Tél : ${tenant.phone}</p>` : ''}
    ${(tenant as any).email ? `<p>${(tenant as any).email}</p>` : ''}
    ${(tenant as any).ninea ? `<p>NINEA : ${(tenant as any).ninea}</p>` : ''}
    ${(tenant as any).rccm ? `<p>RCCM : ${(tenant as any).rccm}</p>` : ''}
  </div>
  <div class="doc-block">
    <h2>Facture IPM Payeur</h2>
    <table>
      <tr><td>N° Facture :</td><td>${f.numero}</td></tr>
      <tr><td>Date :</td><td>${fmtD(f.date_facture)}</td></tr>
      ${periodeDebut ? `<tr><td>Période :</td><td>${fmtD(periodeDebut)} au ${fmtD(periodeFin)}</td></tr>` : ''}
      <tr><td>Statut :</td><td style="font-weight:700;text-transform:uppercase">${f.statut}</td></tr>
      ${f.date_echeance ? `<tr><td>Échéance :</td><td>${fmtD(f.date_echeance)}</td></tr>` : `<tr><td>Échéance :</td><td>${org.delai_paiement_jours ? fmtD(new Date(new Date(f.date_facture).getTime() + org.delai_paiement_jours * 86400000).toISOString().slice(0, 10)) : 'À réception'}</td></tr>`}
    </table>
  </div>
</div>

<div class="two-col">
  <div class="block">
    <h3>Facturé à</h3>
    <p><strong>${org.nom || ''}</strong></p>
    ${org.code ? `<p><span>Code :</span> ${org.code}</p>` : ''}
    ${org.adresse ? `<p>${org.adresse}</p>` : ''}
    ${org.telephone ? `<p><span>Tél :</span> ${org.telephone}</p>` : ''}
    ${org.email ? `<p><span>Email :</span> ${org.email}</p>` : ''}
    ${org.contact_facturation ? `<p><span>Contact facturation :</span> ${org.contact_facturation}</p>` : ''}
    ${convention ? `<p><span>Convention :</span> ${convention.nom}${convention.code ? ` (${convention.code})` : ''}</p>` : ''}
  </div>
  <div class="block">
    <h3>Références</h3>
    <p><span>Nombre de bordereaux :</span> ${linkedBordereaux.length}</p>
    ${periodeDebut ? `<p><span>Période couverte :</span> ${fmtD(periodeDebut)} au ${fmtD(periodeFin)}</p>` : ''}
    <p><span>Total ventes couvertes :</span> ${totalNbVentes}</p>
    ${convention ? `<p><span>Taux convention :</span> ${convention.taux_defaut}%</p>` : ''}
    ${org.conditions_paiement ? `<p><span>Conditions :</span> ${org.conditions_paiement}</p>` : `<p><span>Délai :</span> ${org.delai_paiement_jours || 30} jours</p>`}
  </div>
</div>

<div class="section-title">Résumé financier</div>
<div class="financial-summary">
  <table>
    <thead><tr><th>Désignation</th><th style="text-align:right">Montant (FCFA)</th></tr></thead>
    <tbody>
      <tr><td>Part IPM facturée (total des bordereaux)</td><td style="text-align:right;font-variant-numeric:tabular-nums;font-weight:700">${fmtN(totalPartIpm)}</td></tr>
      <tr><td>Déjà réglé par l'IPM</td><td style="text-align:right;font-variant-numeric:tabular-nums;color:#059669">${fmtN(montantRegle)}</td></tr>
      <tr class="net"><td>NET À PAYER PAR L'IPM</td><td>${fmtN(netAPayer)} FCFA</td></tr>
    </tbody>
  </table>
</div>

<div class="section-title">Bordereaux rattachés</div>
<table class="brd-table">
  <thead>
    <tr>
      <th>N° Bordereau</th>
      <th>Période</th>
      <th class="center">Nb ventes</th>
      <th class="right">Montant Part IPM</th>
    </tr>
  </thead>
  <tbody>
    ${bordereauRows || '<tr><td colspan="4" style="text-align:center;padding:12px;color:#94a3b8;font-style:italic">Aucun bordereau rattaché</td></tr>'}
  </tbody>
  <tfoot>
    <tr>
      <td colspan="2" style="font-weight:700">TOTAL</td>
      <td style="text-align:center;font-weight:700">${totalNbVentes}</td>
      <td style="text-align:right;font-weight:800;font-variant-numeric:tabular-nums">${fmtN(totalPartIpm)} FCFA</td>
    </tr>
  </tfoot>
</table>

<div class="mention">
  Cette facture concerne uniquement la part prise en charge par l'organisme IPM sur les ventes déjà réalisées aux bénéficiaires. Le détail des ventes est disponible dans chaque bordereau rattaché.
</div>

<div class="pieces">
  <div class="section-title">Pièces justificatives</div>
  <ul>
    <li>Bordereau(x) IPM détaillé(s) ci-joints</li>
    ${convention?.ordonnance_obligatoire ? '<li>Ordonnances médicales</li>' : ''}
    ${convention?.bon_prise_en_charge_obligatoire ? '<li>Bons de prise en charge IPM</li>' : ''}
    <li>Liste des bénéficiaires</li>
  </ul>
</div>

<div class="conditions">
  <div class="section-title" style="margin-top:0;border:none;padding:0;margin-bottom:4px">Conditions de règlement</div>
  <p><strong>Mode :</strong> ${org.conditions_paiement || 'Virement bancaire ou chèque à l\'ordre de ' + (tenant.name || '')}</p>
  <p><strong>Délai :</strong> ${org.delai_paiement_jours || 30} jours à compter de la date de facture</p>
</div>

<div class="signatures">
  <div class="sig-block">
    <p>Cachet et signature de la pharmacie</p>
    <div class="line"></div>
  </div>
  <div class="sig-block">
    <p>Cachet / Visa de l'organisme IPM</p>
    <div class="line"></div>
  </div>
</div>

<div class="footer">
  <span>Facture IPM Payeur ${f.numero} — Émise le ${fmtD(f.date_facture)}</span>
  <span>Propulsé par WAARWI</span>
</div>

</body></html>`);
    w.document.close();
    setTimeout(() => { w.print(); setPrinting(false); }, 500);
  };

  const statusColors: Record<string, string> = {
    emise: 'bg-neutral-100 text-neutral-800',
    validee: 'bg-neutral-100 text-neutral-800',
    transmise: 'bg-neutral-100 text-neutral-800',
    partiellement_regle: 'bg-amber-100 text-amber-700',
    regle: 'bg-emerald-100 text-emerald-700',
    rejetee: 'bg-red-100 text-red-700',
    annulee: 'bg-neutral-100 text-neutral-400',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4 text-neutral-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher une facture..." className="bare-input w-full text-sm py-1.5" />
          <div className="h-px bg-neutral-200 mt-1" />
        </div>
        {search && <button onClick={() => setSearch('')} className="shrink-0 p-1 text-neutral-400 hover:text-neutral-600"><X className="w-4 h-4" /></button>}
        <button onClick={() => setShowCreate(true)} className="shrink-0 p-1.5 text-neutral-500 hover:text-brand-700 transition-colors" title="Nouvelle facture IPM">
          <CreditCard className="w-4 h-4" />
        </button>
      </div>

      {loading ? <TableSkeleton /> : filteredFact.length === 0 ? (
        <EmptyIpm message="Aucune facture IPM payeur" action="Générez une facture à partir d'un bordereau validé" />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-2 lg:hidden">
            {filteredFact.map(f => (
              <div key={f.id} className="bg-white rounded-xl border border-neutral-200 p-3.5">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-neutral-900 truncate">{f.ipm_organismes?.nom || '-'}</p>
                    <p className="text-[10px] text-neutral-400 mt-0.5">{f.numero} · {f.date_facture}</p>
                  </div>
                  <span className={`shrink-0 inline-flex px-2 py-0.5 rounded-full text-[8px] font-bold uppercase ${statusColors[f.statut] || 'bg-neutral-100 text-neutral-600'}`}>{f.statut.replace(/_/g, ' ')}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                  <div><span className="text-neutral-400">Part IPM</span><p className="font-bold text-neutral-900 tabular-nums">{formatFCFA(f.montant_total)}</p></div>
                  <div><span className="text-neutral-400">Net à payer</span><p className="font-bold text-amber-700 tabular-nums">{formatFCFA(f.reste_a_payer)}</p></div>
                  <div><span className="text-neutral-400">Réglé</span><p className="font-semibold text-emerald-600 tabular-nums">{formatFCFA(f.montant_regle)}</p></div>
                </div>
                <div className="flex items-center justify-end mt-2 pt-2 border-t border-neutral-100">
                  <button onClick={() => printFacture(f)} disabled={printing} className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-500 hover:text-neutral-700 transition-colors disabled:opacity-40" title="Imprimer">
                    <Printer className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {/* Desktop table */}
          <div className="hidden lg:block bg-white rounded-2xl border border-neutral-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-neutral-100">
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">N°</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Organisme</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Date</th>
                    <th className="text-right px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Part IPM</th>
                    <th className="text-right px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Réglé</th>
                    <th className="text-right px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Net à payer</th>
                    <th className="text-center px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Statut</th>
                    <th className="text-center px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filteredFact.map(f => (
                    <tr key={f.id} className="hover:bg-neutral-50/50">
                      <td className="px-4 py-3 text-xs font-semibold text-neutral-900">{f.numero}</td>
                      <td className="px-4 py-3 text-xs text-neutral-600">{f.ipm_organismes?.nom || '-'}</td>
                      <td className="px-4 py-3 text-xs text-neutral-500">{f.date_facture}</td>
                      <td className="px-4 py-3 text-xs font-bold text-neutral-900 text-right tabular-nums">{formatFCFA(f.montant_total)}</td>
                      <td className="px-4 py-3 text-xs text-emerald-600 text-right tabular-nums">{formatFCFA(f.montant_regle)}</td>
                      <td className="px-4 py-3 text-xs font-bold text-amber-700 text-right tabular-nums">{formatFCFA(f.reste_a_payer)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${statusColors[f.statut] || 'bg-neutral-100 text-neutral-600'}`}>{f.statut.replace(/_/g, ' ')}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => printFacture(f)} disabled={printing} className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-500 hover:text-neutral-700 transition-colors disabled:opacity-40" title="Imprimer facture IPM payeur">
                          <Printer className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {showCreate && (
        <Modal open title="Nouvelle facture IPM payeur" onClose={() => setShowCreate(false)} size="lg">
          <div className="space-y-4">
            <div>
              <label className="text-[11px] font-medium text-neutral-500 mb-1 block">Organisme</label>
              <select value={selectedOrg} onChange={e => { setSelectedOrg(e.target.value); setSelectedBordereaux([]); }} className="w-full h-9 px-3 rounded-lg border border-neutral-200 text-sm">
                <option value="">Sélectionnez un organisme</option>
                {organismes.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
              </select>
            </div>
            {selectedOrg && (
              <div className="space-y-2">
                {bordereaux.length === 0 ? (
                  <p className="text-xs text-neutral-500 py-4 text-center">Aucun bordereau valide disponible pour cet organisme. Validez d'abord un bordereau.</p>
                ) : (
                  <>
                    <p className="text-xs font-semibold text-neutral-700">Sélectionnez les bordereaux validés à facturer :</p>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {bordereaux.map(b => (
                        <label key={b.id} className="flex items-center gap-3 px-3 py-2.5 bg-neutral-50 rounded-lg cursor-pointer hover:bg-neutral-100 transition-colors">
                          <input type="checkbox" checked={selectedBordereaux.includes(b.id)} onChange={e => {
                            setSelectedBordereaux(prev => e.target.checked ? [...prev, b.id] : prev.filter(x => x !== b.id));
                          }} className="w-4 h-4 rounded border-neutral-300 text-neutral-700" />
                          <div className="flex-1">
                            <span className="text-xs font-semibold text-neutral-700">{b.numero}</span>
                            <span className="text-[10px] text-neutral-500 ml-2">{b.nombre_factures} ventes · {b.periode_debut} au {b.periode_fin}</span>
                          </div>
                          <span className="text-xs font-bold text-neutral-800 tabular-nums">{formatFCFA(b.total_part_ipm)}</span>
                        </label>
                      ))}
                    </div>
                    {selectedBordereaux.length > 0 && (
                      <div className="flex items-center justify-between px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-lg">
                        <span className="text-xs font-semibold text-neutral-800">{selectedBordereaux.length} bordereau(x) sélectionné(s)</span>
                        <span className="text-xs font-bold text-neutral-800">Total part IPM : {formatFCFA(bordereaux.filter(b => selectedBordereaux.includes(b.id)).reduce((s, b) => s + Number(b.total_part_ipm), 0))}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowCreate(false)} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
              <button onClick={createFacture} disabled={creating || selectedBordereaux.length === 0}
                className="btn-icon-primary" title="Créer la facture IPM">
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * RÈGLEMENTS IPM
 * ═══════════════════════════════════════════════════════════════════ */
function IpmReglements({ tenantId }: { tenantId: string }) {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [organismes, setOrganismes] = useState<any[]>([]);
  const [pendingFactures, setPendingFactures] = useState<any[]>([]);
  const [loadingFactures, setLoadingFactures] = useState(false);
  const [form, setForm] = useState({ organisme_id: '', montant_recu: '', mode_reglement: 'virement', reference: '', date_reglement: new Date().toISOString().slice(0, 10) });
  const [search, setSearch] = useState('');

  const montantAttendu = useMemo(() => pendingFactures.reduce((s, f) => s + Number(f.reste_a_payer || 0), 0), [pendingFactures]);
  const montantRecu = Number(form.montant_recu) || 0;

  const distribution = useMemo(() => {
    let remaining = montantRecu;
    return pendingFactures.map(f => {
      const reste = Number(f.reste_a_payer || 0);
      const allocated = Math.min(remaining, reste);
      remaining -= allocated;
      return { ...f, allocated, newReste: reste - allocated };
    });
  }, [pendingFactures, montantRecu]);

  const load = async () => {
    const { data } = await supabase.from('ipm_reglements').select('*, ipm_organismes(nom)').eq('tenant_id', tenantId).order('created_at', { ascending: false });
    setList(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [tenantId]);

  const filteredRegl = useMemo(() => {
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(r => (r.ipm_organismes?.nom || '').toLowerCase().includes(q) || (r.reference || '').toLowerCase().includes(q) || (r.mode_reglement || '').toLowerCase().includes(q));
  }, [list, search]);

  useEffect(() => {
    if (!showCreate) return;
    (async () => {
      const { data } = await supabase.from('ipm_organismes').select('id, nom').eq('tenant_id', tenantId).eq('is_active', true);
      setOrganismes(data || []);
    })();
  }, [showCreate, tenantId]);

  const loadPendingFactures = async (orgId: string) => {
    if (!orgId) { setPendingFactures([]); return; }
    setLoadingFactures(true);
    const { data } = await supabase.from('ipm_factures')
      .select('id, numero, montant_total, montant_regle, reste_a_payer, date_facture, statut')
      .eq('tenant_id', tenantId)
      .eq('organisme_id', orgId)
      .in('statut', ['emise', 'partiellement_regle'])
      .gt('reste_a_payer', 0)
      .order('date_facture', { ascending: true });
    setPendingFactures(data || []);
    setLoadingFactures(false);
  };

  const handleOrgChange = (orgId: string) => {
    setForm(f => ({ ...f, organisme_id: orgId, montant_recu: '' }));
    loadPendingFactures(orgId);
  };

  const createReglement = async () => {
    if (!form.organisme_id || montantRecu <= 0) return;
    setCreating(true);

    await supabase.from('ipm_reglements').insert({
      tenant_id: tenantId,
      organisme_id: form.organisme_id,
      montant_attendu: montantAttendu,
      montant_recu: montantRecu,
      ecart: montantRecu - montantAttendu,
      mode_reglement: form.mode_reglement,
      reference: form.reference,
      date_reglement: form.date_reglement,
    });

    for (const item of distribution) {
      if (item.allocated <= 0) continue;
      const newMontantRegle = Math.round((Number(item.montant_regle || 0) + item.allocated) * 100) / 100;
      const newReste = Math.round(Math.max(0, item.newReste) * 100) / 100;
      const newStatut = newReste <= 0 ? 'regle' : 'partiellement_regle';
      await supabase.from('ipm_factures').update({
        montant_regle: newMontantRegle,
        reste_a_payer: newReste,
        statut: newStatut,
      }).eq('id', item.id);
    }

    setCreating(false);
    setShowCreate(false);
    setPendingFactures([]);
    setForm({ organisme_id: '', montant_recu: '', mode_reglement: 'virement', reference: '', date_reglement: new Date().toISOString().slice(0, 10) });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4 text-neutral-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un règlement..." className="bare-input w-full text-sm py-1.5" />
          <div className="h-px bg-neutral-200 mt-1" />
        </div>
        {search && <button onClick={() => setSearch('')} className="shrink-0 p-1 text-neutral-400 hover:text-neutral-600"><X className="w-4 h-4" /></button>}
        <button onClick={() => setShowCreate(true)} className="shrink-0 p-1.5 text-neutral-500 hover:text-brand-700 transition-colors" title="Enregistrer un règlement">
          <Wallet className="w-4 h-4" />
        </button>
      </div>

      {loading ? <TableSkeleton /> : filteredRegl.length === 0 ? (
        <EmptyIpm message="Aucun règlement IPM enregistré" action="Enregistrez les paiements reçus des organismes IPM" />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-2 lg:hidden">
            {filteredRegl.map(r => (
              <div key={r.id} className="bg-white rounded-xl border border-neutral-200 p-3.5">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-neutral-900 truncate">{r.ipm_organismes?.nom || '-'}</p>
                    <p className="text-[10px] text-neutral-400 mt-0.5">{r.date_reglement} · {r.mode_reglement}</p>
                  </div>
                  {r.ecart !== 0 && (
                    <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded ${r.ecart < 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {r.ecart > 0 ? '+' : ''}{formatFCFA(r.ecart)}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                  <div><span className="text-neutral-400">Attendu</span><p className="font-semibold text-neutral-700 tabular-nums">{formatFCFA(r.montant_attendu)}</p></div>
                  <div><span className="text-neutral-400">Reçu</span><p className="font-bold text-emerald-600 tabular-nums">{formatFCFA(r.montant_recu)}</p></div>
                </div>
              </div>
            ))}
          </div>
          {/* Desktop table */}
          <div className="hidden lg:block bg-white rounded-2xl border border-neutral-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-neutral-100">
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Date</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Organisme</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Mode</th>
                    <th className="text-right px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Attendu</th>
                    <th className="text-right px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Reçu</th>
                    <th className="text-right px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">Écart</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filteredRegl.map(r => (
                    <tr key={r.id} className="hover:bg-neutral-50/50">
                      <td className="px-4 py-3 text-xs text-neutral-900">{r.date_reglement}</td>
                      <td className="px-4 py-3 text-xs text-neutral-600">{r.ipm_organismes?.nom || '-'}</td>
                      <td className="px-4 py-3 text-xs text-neutral-500 capitalize">{r.mode_reglement}</td>
                      <td className="px-4 py-3 text-xs text-neutral-600 text-right tabular-nums">{formatFCFA(r.montant_attendu)}</td>
                      <td className="px-4 py-3 text-xs font-bold text-emerald-600 text-right tabular-nums">{formatFCFA(r.montant_recu)}</td>
                      <td className="px-4 py-3 text-xs text-right tabular-nums">
                        {r.ecart !== 0 && <span className={r.ecart < 0 ? 'text-red-600 font-bold' : 'text-neutral-500'}>{r.ecart > 0 ? '+' : ''}{formatFCFA(r.ecart)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {showCreate && (
        <Modal open title="Enregistrer un règlement IPM" onClose={() => { setShowCreate(false); setPendingFactures([]); }} size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-neutral-500 mb-1 block">Organisme</label>
                <select value={form.organisme_id} onChange={e => handleOrgChange(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-neutral-200 text-sm">
                  <option value="">Sélectionnez un organisme</option>
                  {organismes.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-neutral-500 mb-1 block">Date du règlement</label>
                <input type="date" value={form.date_reglement} onChange={e => setForm(f => ({ ...f, date_reglement: e.target.value }))} className="w-full h-9 px-3 rounded-lg border border-neutral-200 text-sm" />
              </div>
            </div>

            {form.organisme_id && (
              <>
                <div className="border border-neutral-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-neutral-50 border-b border-neutral-200 flex items-center justify-between">
                    <span className="text-[11px] font-bold text-neutral-600 uppercase tracking-wider">Factures en attente</span>
                    <span className="text-xs font-bold text-neutral-800">{formatFCFA(montantAttendu)}</span>
                  </div>
                  {loadingFactures ? (
                    <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-neutral-400" /></div>
                  ) : pendingFactures.length === 0 ? (
                    <p className="text-xs text-neutral-500 py-6 text-center">Aucune facture en attente pour cet organisme</p>
                  ) : (
                    <div className="divide-y divide-neutral-100 max-h-56 overflow-y-auto">
                      {distribution.map(f => (
                        <div key={f.id} className="px-4 py-2.5 flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-neutral-800">{f.numero}</span>
                              <span className="text-[10px] text-neutral-400">{f.date_facture}</span>
                            </div>
                            <div className="flex gap-3 mt-0.5 text-[10px] text-neutral-500">
                              <span>Total : {formatFCFA(f.montant_total)}</span>
                              <span>Reste : {formatFCFA(f.reste_a_payer)}</span>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            {f.allocated > 0 ? (
                              <div>
                                <span className="text-xs font-bold text-emerald-600">{formatFCFA(f.allocated)}</span>
                                {f.newReste <= 0 ? (
                                  <span className="block text-[9px] font-bold text-emerald-500 uppercase">Soldée</span>
                                ) : (
                                  <span className="block text-[9px] text-neutral-400">Reste : {formatFCFA(f.newReste)}</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-[10px] text-neutral-400">-</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {pendingFactures.length > 0 && (
                  <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-3.5">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-semibold text-neutral-800">Montant attendu</span>
                      <span className="text-sm font-bold text-neutral-800 tabular-nums">{formatFCFA(montantAttendu)}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] font-medium text-neutral-800 mb-1 block">Montant reçu</label>
                        <input type="number" value={form.montant_recu} onChange={e => setForm(f => ({ ...f, montant_recu: e.target.value }))}
                          className="w-full h-9 px-3 rounded-lg border border-neutral-300 bg-white text-sm font-semibold" placeholder={String(montantAttendu)} />
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-neutral-800 mb-1 block">Écart</label>
                        <div className={`h-9 flex items-center px-3 rounded-lg border text-sm font-bold tabular-nums ${montantRecu - montantAttendu === 0 ? 'border-neutral-200 text-neutral-400 bg-neutral-50' : montantRecu - montantAttendu < 0 ? 'border-red-200 text-red-600 bg-red-50' : 'border-emerald-200 text-emerald-600 bg-emerald-50'}`}>
                          {montantRecu > 0 ? `${montantRecu - montantAttendu > 0 ? '+' : ''}${formatFCFA(montantRecu - montantAttendu)}` : '-'}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-medium text-neutral-500 mb-1 block">Mode de règlement</label>
                    <select value={form.mode_reglement} onChange={e => setForm(f => ({ ...f, mode_reglement: e.target.value }))} className="w-full h-9 px-3 rounded-lg border border-neutral-200 text-sm">
                      <option value="virement">Virement bancaire</option>
                      <option value="cheque">Chèque</option>
                      <option value="especes">Espèces</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-neutral-500 mb-1 block">Référence</label>
                    <input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} className="w-full h-9 px-3 rounded-lg border border-neutral-200 text-sm" placeholder="N° chèque, ref virement..." />
                  </div>
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-neutral-100">
              <button onClick={() => { setShowCreate(false); setPendingFactures([]); }} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
              <button onClick={createReglement} disabled={creating || !form.organisme_id || montantRecu <= 0 || pendingFactures.length === 0}
                className="btn-icon-primary" title="Enregistrer le règlement">
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * REJETS IPM
 * ═══════════════════════════════════════════════════════════════════ */
function IpmRejets({ tenantId }: { tenantId: string }) {
  const [ventes, setVentes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'en_attente' | 'rejet_partiel' | 'rejet_total' | 'ecart_a_regulariser' | 'validee' | 'payee'>('all');
  const [showRetour, setShowRetour] = useState(false);
  const [selectedVente, setSelectedVente] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [retourForm, setRetourForm] = useState({
    montant_accepte: '',
    montant_paye: '',
    motif_rejet: '',
    commentaire: '',
    date_retour: new Date().toISOString().slice(0, 10),
    reference_reglement: '',
  });
  const [showRegul, setShowRegul] = useState(false);
  const [regulVente, setRegulVente] = useState<any>(null);

  const MOTIFS_REJET = [
    'Article non éligible',
    'Document obligatoire manquant',
    'Bénéficiaire non actif',
    'Plafond dépassé',
    'Taux incorrect',
    'Quantité refusée',
    'Prescription non conforme',
    'Date expirée',
    'Doublon',
    'Autre',
  ];

  const ACTIONS_REGULARISATION = [
    { key: 'refacturer_beneficiaire', label: 'Refacturer au bénéficiaire' },
    { key: 'perte_pharmacie', label: 'Passer en perte / remise pharmacie' },
    { key: 'contester_ipm', label: 'Contester auprès de l\'IPM' },
    { key: 'corriger_renvoyer', label: 'Corriger et renvoyer' },
    { key: 'avoir_ajustement', label: 'Créer un avoir / ajustement' },
    { key: 'regularise', label: 'Marquer comme régularisé' },
  ];

  const load = async () => {
    let q = supabase.from('ipm_ventes')
      .select('*, ipm_organismes(nom), ipm_beneficiaires(matricule, customers(name))')
      .eq('tenant_id', tenantId)
      .order('date_vente', { ascending: false });
    if (filter === 'en_attente') q = q.in('statut', ['en_attente', 'bordereau']);
    else if (filter !== 'all') q = q.eq('statut', filter);
    const { data } = await q.limit(200);
    setVentes(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [tenantId, filter]);

  const openRetour = (v: any) => {
    setSelectedVente(v);
    setRetourForm({
      montant_accepte: String(v.part_ipm || 0),
      montant_paye: '',
      motif_rejet: '',
      commentaire: '',
      date_retour: new Date().toISOString().slice(0, 10),
      reference_reglement: '',
    });
    setShowRetour(true);
  };

  const saveRetour = async () => {
    if (!selectedVente) return;
    const montantAccepte = Number(retourForm.montant_accepte) || 0;
    const montantPaye = Number(retourForm.montant_paye) || 0;
    const partIpmAttendue = Number(selectedVente.part_ipm) || 0;
    const montantRejete = Math.max(0, partIpmAttendue - montantAccepte);
    const ecart = partIpmAttendue - montantAccepte;

    if (montantAccepte < 0 || montantPaye < 0) return;
    if (montantAccepte > partIpmAttendue) return;
    if (montantPaye > montantAccepte) return;

    let newStatut = 'en_attente';
    if (montantAccepte === partIpmAttendue && montantPaye === montantAccepte) {
      newStatut = 'payee';
    } else if (montantAccepte === partIpmAttendue && montantPaye < montantAccepte) {
      newStatut = 'validee';
    } else if (montantAccepte > 0 && montantAccepte < partIpmAttendue) {
      newStatut = 'rejet_partiel';
    } else if (montantAccepte === 0 && partIpmAttendue > 0) {
      newStatut = 'rejet_total';
    }

    setSaving(true);
    await supabase.from('ipm_ventes').update({
      montant_ipm_accepte: montantAccepte,
      montant_ipm_paye: montantPaye || null,
      montant_rejete: montantRejete,
      ecart_ipm: ecart,
      motif_rejet: retourForm.motif_rejet || null,
      commentaire_retour: retourForm.commentaire || null,
      date_retour_ipm: retourForm.date_retour || null,
      reference_reglement: retourForm.reference_reglement || null,
      statut: newStatut,
    }).eq('id', selectedVente.id);

    // Mettre à jour le statut de la vente si IPM payée
    if (newStatut === 'payee' && selectedVente.sale_id) {
      await supabase.from('sales').update({ status: 'paid' }).eq('id', selectedVente.sale_id);
    }

    setSaving(false);
    setShowRetour(false);
    setSelectedVente(null);
    load();
  };

  const openRegularisation = (v: any) => {
    setRegulVente(v);
    setShowRegul(true);
  };

  const applyRegularisation = async (action: string) => {
    if (!regulVente) return;
    setSaving(true);
    const newStatut = action === 'regularise' ? 'regularisee' : (action === 'contester_ipm' ? 'contestee' : 'ecart_a_regulariser');
    await supabase.from('ipm_ventes').update({
      action_regularisation: action,
      statut: newStatut,
    }).eq('id', regulVente.id);
    setSaving(false);
    setShowRegul(false);
    setRegulVente(null);
    load();
  };

  const statutLabel = (s: string) => {
    const map: Record<string, string> = {
      en_attente: 'En attente IPM',
      bordereau: 'En attente IPM',
      validee: 'Validée IPM',
      payee: 'Payée IPM',
      rejet_partiel: 'Rejet partiel',
      rejet_total: 'Rejet total',
      ecart_a_regulariser: 'Écart à régulariser',
      contestee: 'Contestée',
      regularisee: 'Régularisée',
      annulee: 'Annulée',
    };
    return map[s] || s;
  };

  const statutColor = (s: string) => {
    const map: Record<string, string> = {
      en_attente: 'bg-amber-100 text-amber-700',
      bordereau: 'bg-neutral-100 text-neutral-800',
      validee: 'bg-neutral-50 text-neutral-800',
      payee: 'bg-emerald-100 text-emerald-700',
      rejet_partiel: 'bg-orange-100 text-orange-700',
      rejet_total: 'bg-red-100 text-red-700',
      ecart_a_regulariser: 'bg-red-50 text-red-600',
      contestee: 'bg-neutral-100 text-neutral-600',
      regularisee: 'bg-neutral-100 text-neutral-800',
      annulee: 'bg-neutral-100 text-neutral-400',
    };
    return map[s] || 'bg-neutral-100 text-neutral-600';
  };

  const ecartCalc = Number(retourForm.montant_accepte || 0) - Number(selectedVente?.part_ipm || 0);
  const ecartPaiement = Number(retourForm.montant_paye || 0) - Number(retourForm.montant_accepte || 0);

  const stats = useMemo(() => {
    const total = ventes.length;
    const enAttente = ventes.filter(v => ['en_attente', 'bordereau'].includes(v.statut)).length;
    const rejets = ventes.filter(v => ['rejet_partiel', 'rejet_total'].includes(v.statut)).length;
    const totalEcart = ventes.reduce((s, v) => s + Math.max(0, Number(v.ecart_ipm || 0)), 0);
    const totalPaye = ventes.reduce((s, v) => s + Number(v.montant_ipm_paye || 0), 0);
    return { total, enAttente, rejets, totalEcart, totalPaye };
  }, [ventes]);

  return (
    <div className="space-y-4">
      {/* KPI compacts */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="bg-white rounded-lg border border-neutral-200 px-3 py-2">
          <p className="text-[9px] font-bold uppercase tracking-wider text-neutral-400">En attente</p>
          <p className="text-sm font-bold text-amber-600 mt-0.5 tabular-nums">{stats.enAttente}</p>
        </div>
        <div className="bg-white rounded-lg border border-neutral-200 px-3 py-2">
          <p className="text-[9px] font-bold uppercase tracking-wider text-neutral-400">Rejets</p>
          <p className="text-sm font-bold text-red-600 mt-0.5 tabular-nums">{stats.rejets}</p>
        </div>
        <div className="bg-white rounded-lg border border-neutral-200 px-3 py-2">
          <p className="text-[9px] font-bold uppercase tracking-wider text-neutral-400">Total écarts</p>
          <p className="text-sm font-bold text-neutral-800 mt-0.5 tabular-nums">{formatFCFA(stats.totalEcart)}</p>
        </div>
        <div className="bg-white rounded-lg border border-neutral-200 px-3 py-2">
          <p className="text-[9px] font-bold uppercase tracking-wider text-neutral-400">Total payé</p>
          <p className="text-sm font-bold text-emerald-600 mt-0.5 tabular-nums">{formatFCFA(stats.totalPaye)}</p>
        </div>
      </div>

      {/* Filtres compacts */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {([['all', 'Toutes'], ['en_attente', 'En attente'], ['rejet_partiel', 'Partiel'], ['rejet_total', 'Total'], ['ecart_a_regulariser', 'À régulariser'], ['validee', 'Validées'], ['payee', 'Payées']] as [string, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setFilter(key as any)} className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${filter === key ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Liste des ventes IPM */}
      {loading ? <TableSkeleton /> : ventes.length === 0 ? (
        <EmptyIpm message="Aucune vente IPM trouvée" action="Les ventes IPM avec leurs retours apparaîtront ici" />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-2 lg:hidden">
            {ventes.map(v => {
              const ecart = Number(v.ecart_ipm || 0);
              const hasEcart = ecart !== 0 && v.date_retour_ipm;
              return (
                <div key={v.id} className="bg-white rounded-xl border border-neutral-200 p-3.5">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-neutral-900 truncate">{v.ipm_beneficiaires?.customers?.name || '-'}</p>
                      <p className="text-[10px] text-neutral-400 mt-0.5">{formatDate(v.date_vente)} · {v.ipm_organismes?.nom || '-'}</p>
                    </div>
                    <span className={`shrink-0 inline-flex px-2 py-0.5 rounded-full text-[8px] font-bold ${statutColor(v.statut)}`}>
                      {statutLabel(v.statut)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                    <div><span className="text-neutral-400">Total facture</span><p className="font-semibold text-neutral-700 tabular-nums">{formatFCFA(v.montant_total)}</p></div>
                    <div><span className="text-neutral-400">Part IPM</span><p className="font-bold text-neutral-900 tabular-nums">{formatFCFA(v.part_ipm)}</p></div>
                    {v.montant_ipm_accepte != null && <div><span className="text-neutral-400">Accepté</span><p className="font-semibold text-neutral-700 tabular-nums">{formatFCFA(v.montant_ipm_accepte)}</p></div>}
                    {hasEcart && <div><span className="text-neutral-400">Écart</span><p className={`font-bold tabular-nums ${ecart < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatFCFA(Math.abs(ecart))}</p></div>}
                  </div>
                  {(['en_attente', 'bordereau', 'validee', 'rejet_partiel', 'rejet_total', 'ecart_a_regulariser'].includes(v.statut)) && (
                    <div className="flex items-center justify-end gap-1 mt-2 pt-2 border-t border-neutral-100">
                      {['en_attente', 'bordereau', 'validee'].includes(v.statut) && (
                        <button onClick={() => openRetour(v)} className="p-1.5 rounded-lg hover:bg-neutral-50 text-neutral-400 hover:text-neutral-700 transition-colors" title="Saisir retour IPM">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {['rejet_partiel', 'rejet_total', 'ecart_a_regulariser'].includes(v.statut) && (
                        <button onClick={() => openRegularisation(v)} className="p-1.5 rounded-lg hover:bg-amber-50 text-neutral-400 hover:text-amber-600 transition-colors" title="Régulariser">
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {/* Desktop table */}
          <div className="hidden lg:block bg-white rounded-2xl border border-neutral-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-neutral-100">
                    <th className="text-left px-3 py-2.5 text-[9px] font-bold uppercase tracking-wider text-neutral-400">Date</th>
                    <th className="text-left px-3 py-2.5 text-[9px] font-bold uppercase tracking-wider text-neutral-400">Bénéficiaire</th>
                    <th className="text-left px-3 py-2.5 text-[9px] font-bold uppercase tracking-wider text-neutral-400">Organisme</th>
                    <th className="text-right px-3 py-2.5 text-[9px] font-bold uppercase tracking-wider text-neutral-400">Total</th>
                    <th className="text-right px-3 py-2.5 text-[9px] font-bold uppercase tracking-wider text-neutral-400">Part IPM</th>
                    <th className="text-right px-3 py-2.5 text-[9px] font-bold uppercase tracking-wider text-neutral-400">Accepté</th>
                    <th className="text-right px-3 py-2.5 text-[9px] font-bold uppercase tracking-wider text-neutral-400">Écart</th>
                    <th className="text-center px-3 py-2.5 text-[9px] font-bold uppercase tracking-wider text-neutral-400">Statut</th>
                    <th className="text-center px-3 py-2.5 text-[9px] font-bold uppercase tracking-wider text-neutral-400 w-24">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-50">
                  {ventes.map(v => {
                    const ecart = Number(v.ecart_ipm || 0);
                    const hasEcart = ecart !== 0 && v.date_retour_ipm;
                    return (
                      <tr key={v.id} className="hover:bg-neutral-50/50">
                        <td className="px-3 py-2.5 text-xs text-neutral-600">{formatDate(v.date_vente)}</td>
                        <td className="px-3 py-2.5 text-xs font-medium text-neutral-900 truncate max-w-[140px]">{v.ipm_beneficiaires?.customers?.name || '-'}</td>
                        <td className="px-3 py-2.5 text-xs text-neutral-500">{v.ipm_organismes?.nom || '-'}</td>
                        <td className="px-3 py-2.5 text-xs text-neutral-700 text-right tabular-nums">{formatFCFA(v.montant_total)}</td>
                        <td className="px-3 py-2.5 text-xs font-bold text-neutral-800 text-right tabular-nums">{formatFCFA(v.part_ipm)}</td>
                        <td className="px-3 py-2.5 text-xs text-right tabular-nums">{v.montant_ipm_accepte != null ? formatFCFA(v.montant_ipm_accepte) : <span className="text-neutral-300">—</span>}</td>
                        <td className="px-3 py-2.5 text-xs text-right tabular-nums">{hasEcart ? <span className={ecart < 0 ? 'text-red-600 font-bold' : 'text-emerald-600'}>{formatFCFA(Math.abs(ecart))}</span> : <span className="text-neutral-300">—</span>}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[8px] font-bold ${statutColor(v.statut)}`}>
                            {statutLabel(v.statut)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {['en_attente', 'bordereau', 'validee'].includes(v.statut) && (
                              <button onClick={() => openRetour(v)} className="p-1.5 rounded-lg hover:bg-neutral-50 text-neutral-400 hover:text-neutral-700 transition-colors" title="Saisir retour IPM">
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {['rejet_partiel', 'rejet_total', 'ecart_a_regulariser'].includes(v.statut) && (
                              <button onClick={() => openRegularisation(v)} className="p-1.5 rounded-lg hover:bg-amber-50 text-neutral-400 hover:text-amber-600 transition-colors" title="Régulariser">
                                <RefreshCw className="w-3.5 h-3.5" />
                              </button>
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
        </>
      )}

      {/* Modal saisie retour IPM */}
      {showRetour && selectedVente && (
        <Modal open title="Saisir le retour IPM" onClose={() => setShowRetour(false)} size="lg">
          <div className="space-y-4">
            {/* Récapitulatif vente */}
            <div className="p-3 rounded-xl bg-neutral-50 border border-neutral-200">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div>
                  <p className="text-[9px] font-bold uppercase text-neutral-400">Total facture</p>
                  <p className="text-sm font-bold text-neutral-900 tabular-nums">{formatFCFA(selectedVente.montant_total)}</p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase text-neutral-400">Part bénéficiaire</p>
                  <p className="text-sm font-bold text-neutral-700 tabular-nums">{formatFCFA(selectedVente.part_client)}</p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase text-neutral-500">Part IPM attendue</p>
                  <p className="text-sm font-bold text-neutral-800 tabular-nums">{formatFCFA(selectedVente.part_ipm)}</p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase text-neutral-400">Bénéficiaire</p>
                  <p className="text-xs font-medium text-neutral-700 truncate">{selectedVente.ipm_beneficiaires?.customers?.name || '-'}</p>
                </div>
              </div>
            </div>

            {/* Saisie */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-neutral-600 mb-1 block">Montant IPM accepté *</label>
                <input type="number" value={retourForm.montant_accepte} onChange={e => setRetourForm(f => ({ ...f, montant_accepte: e.target.value }))}
                  className="w-full h-9 px-3 rounded-lg border border-neutral-200 text-sm tabular-nums" placeholder="0" min="0" max={selectedVente.part_ipm} />
              </div>
              <div>
                <label className="text-[11px] font-medium text-neutral-600 mb-1 block">Montant IPM payé</label>
                <input type="number" value={retourForm.montant_paye} onChange={e => setRetourForm(f => ({ ...f, montant_paye: e.target.value }))}
                  className="w-full h-9 px-3 rounded-lg border border-neutral-200 text-sm tabular-nums" placeholder="0 (si déjà payé)" min="0" max={retourForm.montant_accepte || '0'} />
              </div>
              <div>
                <label className="text-[11px] font-medium text-neutral-600 mb-1 block">Date du retour IPM</label>
                <input type="date" value={retourForm.date_retour} onChange={e => setRetourForm(f => ({ ...f, date_retour: e.target.value }))}
                  className="w-full h-9 px-3 rounded-lg border border-neutral-200 text-sm" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-neutral-600 mb-1 block">Référence règlement / bordereau</label>
                <input type="text" value={retourForm.reference_reglement} onChange={e => setRetourForm(f => ({ ...f, reference_reglement: e.target.value }))}
                  className="w-full h-9 px-3 rounded-lg border border-neutral-200 text-sm" placeholder="REF-..." />
              </div>
            </div>

            {/* Motif rejet (si écart) */}
            {ecartCalc < 0 && (
              <div>
                <label className="text-[11px] font-medium text-red-600 mb-1 block">Motif du rejet *</label>
                <select value={retourForm.motif_rejet} onChange={e => setRetourForm(f => ({ ...f, motif_rejet: e.target.value }))}
                  className="w-full h-9 px-3 rounded-lg border border-red-200 text-sm bg-red-50">
                  <option value="">— Sélectionnez un motif —</option>
                  {MOTIFS_REJET.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className="text-[11px] font-medium text-neutral-600 mb-1 block">Commentaire</label>
              <textarea value={retourForm.commentaire} onChange={e => setRetourForm(f => ({ ...f, commentaire: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-neutral-200 text-sm h-16 resize-none" placeholder="Observations..." />
            </div>

            {/* Calcul automatique écart */}
            <div className="p-3 rounded-xl border border-neutral-200 bg-neutral-50">
              <p className="text-[10px] font-bold uppercase text-neutral-400 mb-2">Calcul automatique</p>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-[9px] text-neutral-400">Écart IPM</p>
                  <p className={`text-sm font-bold tabular-nums ${ecartCalc < 0 ? 'text-red-600' : ecartCalc === 0 ? 'text-emerald-600' : 'text-neutral-600'}`}>
                    {ecartCalc === 0 ? 'Aucun' : formatFCFA(Math.abs(ecartCalc))}
                    {ecartCalc < 0 && <span className="text-[9px] ml-1">(rejeté)</span>}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] text-neutral-400">Montant rejeté</p>
                  <p className="text-sm font-bold text-red-600 tabular-nums">{formatFCFA(Math.max(0, -ecartCalc))}</p>
                </div>
                <div>
                  <p className="text-[9px] text-neutral-400">Écart paiement</p>
                  <p className={`text-sm font-bold tabular-nums ${ecartPaiement < 0 ? 'text-amber-600' : 'text-neutral-400'}`}>
                    {!retourForm.montant_paye ? '—' : ecartPaiement === 0 ? 'Aucun' : formatFCFA(Math.abs(ecartPaiement))}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowRetour(false)} className="btn-icon" title="Annuler"><X className="w-4 h-4" /></button>
              <button onClick={saveRetour} disabled={saving || (ecartCalc < 0 && !retourForm.motif_rejet)}
                className="btn-icon-primary" title="Enregistrer le retour">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal régularisation */}
      {showRegul && regulVente && (
        <Modal open title="Régularisation de l'écart IPM" onClose={() => setShowRegul(false)}>
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-red-50 border border-red-200">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-[9px] font-bold uppercase text-red-400">Part IPM attendue</p>
                  <p className="text-sm font-bold text-neutral-900 tabular-nums">{formatFCFA(regulVente.part_ipm)}</p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase text-red-400">Montant accepté</p>
                  <p className="text-sm font-bold text-neutral-800 tabular-nums">{formatFCFA(regulVente.montant_ipm_accepte || 0)}</p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase text-red-400">Écart</p>
                  <p className="text-sm font-bold text-red-600 tabular-nums">{formatFCFA(Math.abs(Number(regulVente.ecart_ipm || 0)))}</p>
                </div>
              </div>
              {regulVente.motif_rejet && (
                <p className="text-xs text-red-600 mt-2 text-center">Motif : {regulVente.motif_rejet}</p>
              )}
            </div>

            <div>
              <p className="text-[11px] font-bold text-neutral-700 mb-2">Choisissez une action de régularisation :</p>
              <div className="grid gap-2">
                {ACTIONS_REGULARISATION.map(a => (
                  <button key={a.key} onClick={() => applyRegularisation(a.key)} disabled={saving}
                    className="w-full text-left px-4 py-3 rounded-xl border border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50/30 transition-all text-sm font-medium text-neutral-700">
                    {a.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button onClick={() => setShowRegul(false)} className="btn-icon" title="Fermer"><X className="w-4 h-4" /></button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * PARAMÈTRES IPM
 * ═══════════════════════════════════════════════════════════════════ */
function IpmParametres({ tenantId }: { tenantId: string }) {
  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-neutral-200 p-5">
        <h3 className="text-sm font-bold text-neutral-900 mb-1">Configuration générale IPM</h3>
        <p className="text-xs text-neutral-500 mb-4">Tous les paramètres IPM sont définis au niveau des conventions. Chaque convention porte ses propres taux, plafonds et règles de calcul.</p>
        <div className="space-y-3">
          <div className="p-3 rounded-lg border border-neutral-100 bg-neutral-50/50">
            <p className="text-xs font-semibold text-neutral-700">Taux de prise en charge</p>
            <p className="text-[11px] text-neutral-500 mt-0.5">Défini par convention, par famille d'articles, ou par article individuel via les règles de convention.</p>
          </div>
          <div className="p-3 rounded-lg border border-neutral-100 bg-neutral-50/50">
            <p className="text-xs font-semibold text-neutral-700">Plafonds</p>
            <p className="text-[11px] text-neutral-500 mt-0.5">Par facture, par jour, par mois ou annuel — configurable dans chaque convention.</p>
          </div>
          <div className="p-3 rounded-lg border border-neutral-100 bg-neutral-50/50">
            <p className="text-xs font-semibold text-neutral-700">Documents obligatoires</p>
            <p className="text-[11px] text-neutral-500 mt-0.5">Ordonnance, bon de prise en charge, matricule — activables convention par convention.</p>
          </div>
          <div className="p-3 rounded-lg border border-neutral-100 bg-neutral-50/50">
            <p className="text-xs font-semibold text-neutral-700">Règles d'éligibilité</p>
            <p className="text-[11px] text-neutral-500 mt-0.5">Articles/familles couverts ou exclus — gérés dans les règles de convention (onglet Conventions).</p>
          </div>
          <div className="p-3 rounded-lg border border-neutral-100 bg-neutral-50/50">
            <p className="text-xs font-semibold text-neutral-700">Mode de calcul</p>
            <p className="text-[11px] text-neutral-500 mt-0.5">Ligne par ligne, total facture, ou articles éligibles uniquement. Configurable par convention.</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-neutral-200 p-5">
        <h3 className="text-sm font-bold text-neutral-900 mb-3">Principe de fonctionnement</h3>
        <ol className="space-y-2 text-xs text-neutral-600">
          <li className="flex gap-2"><span className="shrink-0 w-5 h-5 rounded-full bg-neutral-50 text-neutral-800 text-[10px] font-bold flex items-center justify-center">1</span><span>Configurez vos organismes IPM et leurs conventions</span></li>
          <li className="flex gap-2"><span className="shrink-0 w-5 h-5 rounded-full bg-neutral-50 text-neutral-800 text-[10px] font-bold flex items-center justify-center">2</span><span>Associez vos clients bénéficiaires à un organisme/convention</span></li>
          <li className="flex gap-2"><span className="shrink-0 w-5 h-5 rounded-full bg-neutral-50 text-neutral-800 text-[10px] font-bold flex items-center justify-center">3</span><span>Lors de la vente, le système calcule automatiquement la part IPM</span></li>
          <li className="flex gap-2"><span className="shrink-0 w-5 h-5 rounded-full bg-neutral-50 text-neutral-800 text-[10px] font-bold flex items-center justify-center">4</span><span>Encaissez uniquement la part client, la part IPM devient une créance</span></li>
          <li className="flex gap-2"><span className="shrink-0 w-5 h-5 rounded-full bg-neutral-50 text-neutral-800 text-[10px] font-bold flex items-center justify-center">5</span><span>Générez des bordereaux pour regrouper les ventes IPM</span></li>
          <li className="flex gap-2"><span className="shrink-0 w-5 h-5 rounded-full bg-neutral-50 text-neutral-800 text-[10px] font-bold flex items-center justify-center">6</span><span>Facturez l'organisme IPM et suivez les règlements</span></li>
        </ol>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * COMPOSANTS UTILITAIRES
 * ═══════════════════════════════════════════════════════════════════ */
function FormField({ label, value, onChange, type = 'text', placeholder, multiline }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; multiline?: boolean;
}) {
  const cls = "w-full px-3 rounded-lg border border-neutral-200 text-sm focus:border-neutral-400 focus:ring-2 focus:ring-neutral-900/10 outline-none transition-all";
  return (
    <div>
      <label className="text-[11px] font-medium text-neutral-500 mb-1 block">{label}</label>
      {multiline ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={`${cls} h-20 py-2 resize-none`} />
      ) : (
        <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={`${cls} h-9`} />
      )}
    </div>
  );
}

function CheckboxField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="w-4 h-4 rounded border-neutral-300 text-neutral-700 focus:ring-neutral-900" />
      <span className="text-xs text-neutral-700">{label}</span>
    </label>
  );
}

function EmptyIpm({ message, action }: { message: string; action?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4">
      <div className="w-14 h-14 rounded-2xl bg-neutral-100 flex items-center justify-center mb-3">
        <HeartPulse className="w-6 h-6 text-neutral-400" />
      </div>
      <p className="text-sm font-semibold text-neutral-700 text-center">{message}</p>
      {action && <p className="text-xs text-neutral-500 text-center mt-1">{action}</p>}
    </div>
  );
}

function DashSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[0, 1, 2, 3, 4].map(i => <div key={i} className="h-20 rounded-xl bg-neutral-100" />)}
      </div>
      <div className="h-40 rounded-2xl bg-neutral-100" />
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      {[0, 1, 2].map(i => <div key={i} className="h-14 rounded-xl bg-neutral-100" />)}
    </div>
  );
}
