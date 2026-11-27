import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Loader2, RefreshCw, Search } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { backupStatusLabels } from '../lib/backupV3';
import { formatDateTime } from '../lib/format';
import { supabase } from '../lib/supabase';
import { BackupExecutions, BackupTransfers } from './BackupPlatformActivity';
import { BackupTab } from './BackupTab';
import { PlatformWorkPage } from './PlatformWorkPage';
import { SearchableSelect } from './SearchableSelect';

type Company = {
  id: string;
  name: string;
  is_active: boolean;
  suspended: boolean;
  verified_at: string | null;
  confirmed_at: string | null;
  latest_job_status: string | null;
};
type Schedule = { enabled: boolean; cron_expression: string; timezone: string };
type Overview = {
  policy: Schedule;
  schedule_active: boolean;
  offsite_enabled: boolean;
  offsite_automatic: boolean;
  retention_enabled: boolean;
  restore_enabled: boolean;
  companies: Company[];
};

const tabs = [
  { key: 'supervision', label: 'Supervision' },
  { key: 'companies', label: 'Entreprises' },
  { key: 'runs', label: 'Exécutions' },
  { key: 'offsite', label: 'Copie distante LWS' },
  { key: 'settings', label: 'Paramètres' },
] as const;

type Tab = typeof tabs[number]['key'];
type CompanyFilter = 'all' | 'protected' | 'unprotected' | 'suspended';

const companyFilters = [
  { value: 'all', label: 'Toutes les entreprises' },
  { value: 'protected', label: 'Avec une copie LWS' },
  { value: 'unprotected', label: 'Sans copie LWS' },
  { value: 'suspended', label: 'Planification suspendue' },
];

function matchesFilter(company: Company, filter: CompanyFilter) {
  if (filter === 'protected') return !!company.confirmed_at;
  if (filter === 'unprotected') return company.is_active && !company.suspended && !company.confirmed_at;
  if (filter === 'suspended') return company.suspended || !company.is_active;
  return true;
}

export function CentralizedBackups() {
  const [tab, setTab] = useState<Tab>('supervision');
  const [data, setData] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<CompanyFilter>('all');
  const [draft, setDraft] = useState<Schedule | null>(null);
  const [busy, setBusy] = useState(false);
  const { success, error } = useToast();

  const load = useCallback(async () => {
    const result = await supabase.rpc('br_v3_platform_backups');
    if (result.error) { setLoadError(result.error.message); return; }
    setLoadError('');
    setData(result.data as Overview);
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function save(action: () => PromiseLike<{ error: { message: string } | null }>, message: string) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await action();
      if (result.error) throw result.error;
      setDraft(null);
      success(message);
      await load();
    } catch (cause) {
      error((cause as { message?: string })?.message || 'Opération indisponible.');
    } finally {
      setBusy(false);
    }
  }

  function navigate(next: Tab) {
    setTab(next);
    setSelectedId(null);
    setDraft(null);
  }

  function openCompany(id: string) {
    setTab('companies');
    setSelectedId(id);
  }

  const selected = data?.companies.find(company => company.id === selectedId);
  const activeCompanies = data?.companies.filter(company => company.is_active && !company.suspended) ?? [];
  const protectedCount = activeCompanies.filter(company => company.confirmed_at).length;
  const filtered = data?.companies.filter(company => matchesFilter(company, filter)
    && company.name.toLocaleLowerCase('fr').includes(query.trim().toLocaleLowerCase('fr'))) ?? [];

  return (
    <div>
      <nav className="pa-tabs" aria-label="Rubriques des sauvegardes">
        {tabs.map(item => (
          <button key={item.key} type="button" aria-current={tab === item.key ? 'page' : undefined}
            disabled={busy} onClick={() => navigate(item.key)}>{item.label}</button>
        ))}
      </nav>
      {loadError && <p role="alert" className="pa-danger">{loadError}</p>}
      {!data && !loadError && <p role="status" className="pa-empty"><Loader2 size={16} className="animate-spin" /> Chargement…</p>}
      {!data && loadError && <button type="button" className="pa-link" onClick={() => void load()}>Réessayer</button>}
      {data && tab === 'supervision' && (
        <section className="pa-page" aria-label="Supervision des sauvegardes">
          <div className="pa-section-head">
            <h2 className="pa-heading">Sauvegardes V3</h2>
            <button type="button" className="pa-icon-button" aria-label="Actualiser la supervision" onClick={() => void load()}>
              <RefreshCw size={16} aria-hidden="true" />
            </button>
          </div>
          <dl className="pa-metrics">
            <div><dt>Entreprises avec une copie LWS vérifiée</dt><dd>{protectedCount} <small>sur {activeCompanies.length}</small></dd></div>
            <div><dt>Entreprises sans copie LWS</dt><dd>{activeCompanies.length - protectedCount}</dd></div>
          </dl>
          <dl className="pa-keyvals">
            <div><dt>Planification</dt><dd>{data.schedule_active ? data.policy.cron_expression + ' (' + data.policy.timezone + ')' : 'Suspendue'}</dd></div>
            <div><dt>Copie distante LWS</dt><dd>{data.offsite_enabled ? 'Active' : 'Inactive'}</dd></div>
          </dl>
          <div className="pa-inline">
            <button type="button" className="pa-link" onClick={() => { setFilter('all'); setQuery(''); navigate('companies'); }}>Voir les entreprises <ChevronRight size={16} aria-hidden="true" /></button>
            <button type="button" className="pa-link" onClick={() => navigate('runs')}>Voir les exécutions <ChevronRight size={16} aria-hidden="true" /></button>
          </div>
        </section>
      )}
      {data && tab === 'companies' && (selected ? (
        <PlatformWorkPage title={selected.name} backLabel="Retour aux entreprises" onBack={() => { setSelectedId(null); void load(); }}
          actions={<button type="button" className="pa-button" disabled={busy || !selected.is_active}
            onClick={() => void save(() => supabase.rpc('br_v3_schedule_suspend', {
              p_tenant_id: selected.id, p_suspended: !selected.suspended,
            }), selected.suspended ? 'Planification réactivée.' : 'Planification suspendue.')}>
            {selected.suspended ? 'Réactiver la planification' : 'Suspendre la planification'}
          </button>}>
          <BackupTab key={selected.id} companyId={selected.id} />
        </PlatformWorkPage>
      ) : (
        <section className="pa-page" aria-label="Entreprises">
          <h2 className="pa-heading">Entreprises</h2>
          <div className="pa-toolbar">
            <label className="pa-search">
              <Search size={16} aria-hidden="true" />
              <input aria-label="Rechercher une entreprise" placeholder="Rechercher une entreprise"
                value={query} onChange={event => setQuery(event.target.value)} />
            </label>
            <SearchableSelect className="min-w-48" ariaLabel="Filtrer les entreprises" value={filter} options={companyFilters}
              searchable={false} clearable={false} onChange={value => setFilter(value as CompanyFilter)} />
          </div>
          {filtered.length ? <ul className="pa-divided">
            {filtered.map(company => (
              <li key={company.id} className="pa-setting-row">
                <div>
                  <strong>{company.name}</strong>
                  <p className="pa-row-subtitle">{company.verified_at ? 'Dernière archive ' + formatDateTime(company.verified_at) : 'Aucune archive vérifiée'}</p>
                  <p className="pa-row-subtitle">{company.confirmed_at ? 'Copie LWS vérifiée ' + formatDateTime(company.confirmed_at) : 'Aucune copie LWS vérifiée'}</p>
                  {company.latest_job_status && company.latest_job_status !== 'succeeded' && (
                    <p className="pa-row-subtitle">{backupStatusLabels[company.latest_job_status] || company.latest_job_status}</p>
                  )}
                  {(!company.is_active || company.suspended) && <p className="pa-row-subtitle">Planification suspendue</p>}
                </div>
                <button type="button" className="pa-link" onClick={() => openCompany(company.id)}>Ouvrir <ChevronRight size={16} aria-hidden="true" /></button>
              </li>
            ))}
          </ul> : <p className="pa-empty">Aucune entreprise trouvée.</p>}
        </section>
      ))}
      {data && tab === 'runs' && <BackupExecutions openCompany={openCompany} />}
      {data && tab === 'offsite' && <BackupTransfers openCompany={openCompany} />}
      {data && tab === 'settings' && (draft ? (
        <PlatformWorkPage title="Modifier la planification" backLabel="Retour aux paramètres" onBack={() => setDraft(null)} busy={busy}>
          <form className="pa-form" onSubmit={event => {
            event.preventDefault();
            void save(() => supabase.rpc('br_v3_schedule_update', {
              p_enabled: draft.enabled, p_cron_expression: draft.cron_expression,
            }), 'Planification enregistrée.');
          }}>
            <label className="pa-inline"><input type="checkbox" checked={draft.enabled}
              onChange={event => setDraft({ ...draft, enabled: event.target.checked })} /> Sauvegarde automatique</label>
            <label className="pa-field-label">Expression Cron ({draft.timezone})
              <input required className="w-input-ul" value={draft.cron_expression}
                onChange={event => setDraft({ ...draft, cron_expression: event.target.value })} />
            </label>
            <button type="submit" className="pa-button" data-variant="primary" disabled={busy}>Enregistrer</button>
          </form>
        </PlatformWorkPage>
      ) : (
        <section className="pa-page" aria-label="Paramètres des sauvegardes">
          <div className="pa-section-head">
            <h2 className="pa-heading">Paramètres</h2>
            <button type="button" className="pa-link" onClick={() => setDraft(data.policy)}>Modifier la planification</button>
          </div>
          <dl className="pa-keyvals">
            <div><dt>Planificateur</dt><dd>{data.schedule_active ? 'Actif' : 'Suspendu'}</dd></div>
            <div><dt>Expression Cron</dt><dd>{data.policy.cron_expression}</dd></div>
            <div><dt>Fuseau horaire</dt><dd>{data.policy.timezone}</dd></div>
            <div><dt>Copie LWS automatique</dt><dd>{data.offsite_enabled && data.offsite_automatic ? 'Active' : 'Inactive'}</dd></div>
            <div><dt>Rotation automatique</dt><dd>{data.retention_enabled ? 'Active' : 'Inactive'}</dd></div>
            <div><dt>Restauration depuis Waarwi</dt><dd>{data.restore_enabled ? 'Active' : 'Inactive'}</dd></div>
          </dl>
        </section>
      ))}
    </div>
  );
}
