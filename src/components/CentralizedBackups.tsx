import { useEffect, useState, useCallback } from 'react';
import { Check, ChevronRight, Cloud, Download, Loader2, Pause, Play, RefreshCw, RotateCcw, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatDateTime } from '../lib/format';
import { useToast } from '../context/ToastContext';
import { PlatformConfirmation, PlatformWorkPage } from './PlatformWorkPage';
import { SearchableSelect } from './SearchableSelect';

async function callScheduler(action: string, payload: Record<string, unknown> = {}) {
  let { data: sess } = await supabase.auth.getSession();
  let token = sess.session?.access_token;
  if (!token) {
    const { data: r } = await supabase.auth.refreshSession();
    token = r.session?.access_token;
  }
  if (!token) throw new Error('Session expirée');
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/backup-scheduler`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erreur');
  return data;
}

async function callOffsite(action: string, payload: Record<string, unknown> = {}) {
  let { data: sess } = await supabase.auth.getSession();
  let token = sess.session?.access_token;
  if (!token) {
    const { data: r } = await supabase.auth.refreshSession();
    token = r.session?.access_token;
  }
  if (!token) throw new Error('Session expirée');
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/backup-offsite`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erreur');
  return data;
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} Go`;
}

function formatRowCount(rc: Record<string, number> | null | undefined): string {
  if (!rc) return '—';
  const total = Object.values(rc).reduce((a, b) => a + b, 0);
  return total.toLocaleString('fr-FR');
}

type Tab = 'supervision' | 'tenants' | 'executions' | 'lws' | 'settings';

type BackupFilter = 'all' | 'protected' | 'unprotected' | 'suspended';

type Backup = {
  id: string;
  label?: string;
  kind: string;
  status: string;
  created_at: string;
  size_bytes?: number | null;
  row_counts?: Record<string, number> | null;
  format_version?: number;
  error_message?: string | null;
};

type BackupCompany = {
  id: string;
  name: string;
  is_active: boolean;
  last_backup?: Backup | null;
  override?: { suspended?: boolean; notes?: string; custom_retention_daily?: number | null } | null;
};

type Transfer = {
  id: string;
  tenant_id: string;
  tenants?: { name: string } | null;
  queued_at: string;
  size_bytes?: number;
  status: string;
  error_message?: string;
};

type Run = {
  id: string;
  started_at: string;
  finished_at?: string | null;
  status: string;
  triggered_by: string;
  tenants_succeeded?: number;
  tenants_failed?: number;
  tenants_skipped?: number;
};

type RunItem = {
  id: string;
  tenant_id: string;
  tenants?: { name: string } | null;
  status: string;
  size_bytes?: number;
  row_count?: number;
  error_message?: string;
};

const statusLabels: Record<string, string> = {
  verified: 'Vérifiée', completed: 'Terminé', running: 'En cours', uploading: 'Envoi en cours',
  queued: 'En attente', failed: 'Échec', pending: 'En attente', succeeded: 'Réussi',
  skipped: 'Ignoré', partial_failure: 'Échec partiel',
};

function StatusLabel({ status }: { status: string }) {
  return <span className="pa-status" data-alert={status === 'failed' || status === 'partial_failure'}>{statusLabels[status] || status}</span>;
}

function Spinner() {
  return <p className="pa-empty" role="status"><Loader2 size={16} className="animate-spin" /> Chargement…</p>;
}

const tabs: { key: Tab; label: string }[] = [
  { key: 'supervision', label: 'Supervision' },
  { key: 'tenants', label: 'Entreprises' },
  { key: 'executions', label: 'Exécutions' },
  { key: 'lws', label: 'Copie distante LWS' },
  { key: 'settings', label: 'Paramètres' },
];

const offsiteSecrets = [
  'LWS_WEBDAV_URL', 'LWS_WEBDAV_USERNAME', 'LWS_WEBDAV_PASSWORD',
  'BACKUP_ENCRYPTION_KEY_B64', 'BACKUP_ENCRYPTION_KEY_ID', 'OFFSITE_CRON_SECRET',
] as const;

const filters: Record<BackupFilter, string> = {
  all: 'Toutes les entreprises', protected: 'Avec sauvegarde', unprotected: 'Sans sauvegarde', suspended: 'Planification suspendue',
};

export function CentralizedBackups() {
  const [tab, setTab] = useState<Tab>('supervision');
  const [companyFilter, setCompanyFilter] = useState<BackupFilter>('all');

  return (
    <div>
      <nav className="pa-tabs" aria-label="Sauvegardes de la plateforme">
        {tabs.map(item => (
          <button type="button" key={item.key} aria-current={tab === item.key ? 'page' : undefined}
            onClick={() => { setCompanyFilter('all'); setTab(item.key); }}>{item.label}</button>
        ))}
      </nav>
      {tab === 'supervision' && <SupervisionTab onNavigate={setTab} onUnprotected={() => { setCompanyFilter('unprotected'); setTab('tenants'); }} />}
      {tab === 'tenants' && <CompaniesTab initialFilter={companyFilter} />}
      {tab === 'executions' && <HistoryTab />}
      {tab === 'lws' && <OffsiteTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  );
}

function SupervisionTab({ onNavigate, onUnprotected }: { onNavigate: (tab: Tab) => void; onUnprotected: () => void }) {
  const [data, setData] = useState<any>(null);
  const [offsite, setOffsite] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const load = useCallback(async () => {
    try {
      const [summary, remote, settings] = await Promise.all([
        callScheduler('dashboard_summary'), callOffsite('summary'), callOffsite('get_config'),
      ]);
      setData(summary);
      setOffsite(remote);
      setConfig(settings);
    } catch (cause) { toast((cause as Error).message, 'error'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 60000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (loading) return <Spinner />;
  if (!data) return <p className="pa-empty">La supervision est indisponible.</p>;

  const total = data.total_tenants || 0;
  const protectedCount = data.protected_tenants || 0;
  const cronReady = data.cron_status?.exists && data.cron_status?.active && !data.cron_status.error;
  const planningReady = data.policy?.enabled && cronReady && data.cron_secret_configured;
  const offsiteCron = config?.cron_status;
  const remoteReady = config?.config?.enabled && offsiteCron?.exists && offsiteCron?.active && !offsiteCron.error
    && offsiteSecrets.every(key => config?.secrets_configured?.[key]);
  const lastRun = data.last_run as Run | null | undefined;

  return (
    <div className="pa-page">
      <dl className="pa-record-summary">
        <div><dt>Entreprises protégées</dt><dd>{protectedCount} sur {total}</dd></div>
        <div><dt>Copies LWS vérifiées</dt><dd>{offsite?.total_verified ?? 0}</dd></div>
        <div><dt>Transferts en attente</dt><dd>{offsite?.total_queued ?? 0}</dd></div>
        <div><dt>Dernier cycle</dt><dd>{lastRun ? formatDateTime(lastRun.started_at) : 'Aucun cycle'}</dd></div>
      </dl>
      <div className="pa-overview-grid">
        <section>
          <h2 className="pa-heading mb-2">À contrôler</h2>
          <div className="pa-divided">
            <button type="button" className="pa-dashboard-link" onClick={onUnprotected}>
              <span>Entreprises sans sauvegarde</span><strong>{Math.max(0, total - protectedCount)}</strong>
            </button>
            <button type="button" className="pa-dashboard-link" onClick={() => onNavigate('lws')}>
              <span>Transferts en échec</span><strong>{offsite?.total_failed ?? 0}</strong>
            </button>
            <button type="button" className="pa-dashboard-link" onClick={() => onNavigate('executions')}>
              <span>Dernière exécution</span>{lastRun ? <StatusLabel status={lastRun.status} /> : '—'}
            </button>
          </div>
        </section>
        <section>
          <div className="pa-section-head">
            <h2 className="pa-heading">Planification</h2>
            <button type="button" className="pa-link" onClick={() => onNavigate('settings')}>Paramètres <ChevronRight size={15} /></button>
          </div>
          <dl className="pa-keyvals">
            <KeyValue label="Sauvegarde automatique" value={planningReady ? 'Active' : 'Inactive'} />
            <KeyValue label="Planificateur" value={cronReady ? 'Actif' : 'Inactif'} />
            <KeyValue label="Copie distante LWS" value={remoteReady ? 'Active' : 'Inactive'} />
            {data.policy?.cron_expression && <KeyValue label="Cadence" value={data.policy.cron_expression + ' │ ' + (data.policy.timezone || 'Africa/Dakar')} />}
          </dl>
        </section>
      </div>
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function CompaniesTab({ initialFilter }: { initialFilter: BackupFilter }) {
  const [companies, setCompanies] = useState<BackupCompany[]>([]);
  const [transferByTenant, setTransferByTenant] = useState<Record<string, Transfer>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<BackupFilter>(initialFilter);
  const [selected, setSelected] = useState<string>();
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const [saved, remote] = await Promise.all([
        callScheduler('list_tenants_backup_status'), callOffsite('list_transfers', { limit: 200 }),
      ]);
      setCompanies(saved.tenants || []);
      const latest: Record<string, Transfer> = {};
      for (const transfer of (remote.transfers || []) as Transfer[]) {
        if (!latest[transfer.tenant_id] || transfer.queued_at > latest[transfer.tenant_id].queued_at) latest[transfer.tenant_id] = transfer;
      }
      setTransferByTenant(latest);
    } catch (cause) { toast((cause as Error).message, 'error'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const company = companies.find(item => item.id === selected);
  if (company) {
    return <CompanyBackups key={company.id} company={company} transfer={transferByTenant[company.id]} onBack={() => setSelected(undefined)} onChange={load} />;
  }

  const q = search.trim().toLocaleLowerCase('fr');
  const visible = companies.filter(item => {
    if (q && !item.name.toLocaleLowerCase('fr').includes(q)) return false;
    if (filter === 'protected') return !!item.last_backup;
    if (filter === 'unprotected') return !item.last_backup;
    if (filter === 'suspended') return !!item.override?.suspended;
    return true;
  });

  return (
    <div className="pa-page">
      <div className="pa-toolbar">
        <label className="pa-search">
          <Search size={16} aria-hidden="true" />
          <input aria-label="Rechercher une entreprise à sauvegarder" placeholder="Rechercher une entreprise…" value={search} onChange={event => setSearch(event.target.value)} />
        </label>
        <SearchableSelect ariaLabel="État des sauvegardes" className="w-full min-w-0 sm:w-48" value={filter}
          clearable={false} searchable={false} wrapLabels
          onChange={value => setFilter(value as BackupFilter)}
          options={Object.entries(filters).map(([value, label]) => ({ value, label }))} />
        <button type="button" className="pa-icon-button" aria-label="Actualiser les sauvegardes" onClick={() => void load()}><RefreshCw size={16} /></button>
      </div>
      {loading ? <Spinner /> : visible.length === 0 ? <p className="pa-empty">Aucune entreprise pour ces critères.</p> : (
        <div className="pa-table pa-backup-companies" role="table" aria-label="Sauvegardes par entreprise">
          <div className="pa-list-head" role="row">
            {['Entreprise', 'Dernière sauvegarde', 'Volume', 'Copie LWS', 'Actions'].map(label => <span role="columnheader" key={label}>{label}</span>)}
          </div>
          {visible.map(item => (
            <div className="pa-list-row" role="row" key={item.id}>
              <div role="cell" className="pa-row-title">
                <button type="button" className="pa-name-button" onClick={() => setSelected(item.id)}>{item.name}</button>
                <p className="pa-row-subtitle">{item.override?.suspended ? 'Planification suspendue' : item.is_active ? 'Entreprise active' : 'Entreprise inactive'}</p>
              </div>
              <div role="cell" className="pa-row-plan">
                {item.last_backup ? <StatusLabel status={item.last_backup.status} /> : 'Aucune'}
                {item.last_backup && <p className="pa-row-subtitle">{formatDateTime(item.last_backup.created_at)}</p>}
              </div>
              <div role="cell" className="pa-desktop-cell">{formatBytes(item.last_backup?.size_bytes)}</div>
              <div role="cell" className="pa-row-status">{transferByTenant[item.id] ? <StatusLabel status={transferByTenant[item.id].status} /> : '—'}</div>
              <div role="cell" className="pa-row-actions">
                <button type="button" className="pa-link" aria-label={'Sauvegardes de ' + item.name} onClick={() => setSelected(item.id)}>
                  Consulter <ChevronRight size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CompanyBackups({ company, transfer, onBack, onChange }: {
  company: BackupCompany; transfer?: Transfer; onBack: () => void; onChange: () => Promise<void>;
}) {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmation, setConfirmation] = useState<'backup' | 'suspend' | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const { toast, success, error } = useToast();
  const load = useCallback(async () => {
    try {
      const data = await callScheduler('tenant_backup_history', { tenant_id: company.id, limit: 30 });
      setBackups(data.backups || []);
    } catch (cause) { toast((cause as Error).message, 'error'); }
    finally { setLoading(false); }
  }, [company.id, toast]);

  useEffect(() => { void load(); }, [load]);

  const queue = async (id: string) => {
    setSending(id);
    try {
      const result = await callOffsite('queue_transfer', { backup_id: id });
      success(result.already_exists ? 'Transfert déjà en file' : 'Transfert ajouté à la file');
      await onChange();
    } catch (cause) { error((cause as Error).message); }
    finally { setSending(null); }
  };

  const isSuspended = !!company.override?.suspended;
  const toggleLabel = isSuspended ? 'Réactiver la planification' : 'Suspendre la planification';
  if (confirmation) {
    return (
      <PlatformConfirmation title={confirmation === 'backup' ? 'Sauvegarder ' + company.name + ' ?' : toggleLabel + ' ?'}
        backLabel="Retour à la sauvegarde" onBack={() => setConfirmation(null)}
        message={confirmation === 'backup' ? 'Waarwi lance une sauvegarde pour cette entreprise.'
          : isSuspended ? 'Les cycles automatiques incluront de nouveau cette entreprise.' : 'Les cycles automatiques excluront cette entreprise.'}
        label={confirmation === 'backup' ? 'Lancer la sauvegarde' : toggleLabel}
        onConfirm={async () => {
          if (confirmation === 'backup') {
            await callScheduler('backup_now', { tenant_id: company.id });
            success('Sauvegarde lancée');
            await load();
          } else {
            await callScheduler('set_tenant_override', {
              tenant_id: company.id, suspended: !isSuspended,
              notes: company.override?.notes || null,
              custom_retention_daily: company.override?.custom_retention_daily ?? null,
            });
            success(isSuspended ? 'Planification réactivée' : 'Planification suspendue');
          }
          await onChange();
          setConfirmation(null);
        }} />
    );
  }

  return (
    <PlatformWorkPage title={company.name} backLabel="Retour aux sauvegardes" onBack={onBack}
      actions={<>
        <button type="button" className="pa-button" data-variant="primary" onClick={() => setConfirmation('backup')}><Play size={16} /> Sauvegarder</button>
        <button type="button" className="pa-link" onClick={() => setConfirmation('suspend')}>{isSuspended ? <Play size={16} /> : <Pause size={16} />} {toggleLabel}</button>
      </>}>
      <dl className="pa-record-summary">
        <KeyValue label="Dernière sauvegarde" value={company.last_backup ? formatDateTime(company.last_backup.created_at) : 'Aucune'} />
        <KeyValue label="Volume" value={formatBytes(company.last_backup?.size_bytes)} />
        <KeyValue label="Copie distante" value={transfer ? <StatusLabel status={transfer.status} /> : 'Aucune'} />
        <KeyValue label="Planification" value={isSuspended ? 'Suspendue' : 'Active'} />
      </dl>
      <section>
        <div className="pa-section-head">
          <h3 className="pa-heading">Historique des sauvegardes</h3>
          <button type="button" className="pa-icon-button" aria-label="Actualiser l’historique" onClick={() => void load()}><RefreshCw size={16} /></button>
        </div>
        {loading ? <Spinner /> : backups.length === 0 ? <p className="pa-empty">Aucune sauvegarde enregistrée.</p> : (
          <div className="pa-divided">
            {backups.map(item => (
              <div className="pa-setting-row" key={item.id}>
                <div>
                  <strong>{item.label || item.kind}</strong>
                  <p className="pa-row-subtitle">{formatDateTime(item.created_at)} │ {formatBytes(item.size_bytes)} │ {formatRowCount(item.row_counts)} lignes</p>
                  {item.error_message && <p className="pa-danger text-xs">{item.error_message}</p>}
                </div>
                <div className="pa-inline">
                  <StatusLabel status={item.status} />
                  {item.status === 'verified' && (item.format_version ?? 0) >= 2 && (
                    <button type="button" className="pa-link" onClick={() => void queue(item.id)} disabled={sending !== null}>
                      {sending === item.id ? <Loader2 size={15} className="animate-spin" /> : <Cloud size={15} />} Envoyer vers LWS
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </PlatformWorkPage>
  );
}

function runDuration(run: Run) {
  if (!run.finished_at) return '—';
  const seconds = Math.max(0, Math.round((Date.parse(run.finished_at) - Date.parse(run.started_at)) / 1000));
  return seconds >= 60 ? Math.floor(seconds / 60) + ' min ' + seconds % 60 + ' s' : seconds + ' s';
}

function HistoryTab() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Run | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    callScheduler('list_runs', { limit: 30 }).then(data => setRuns(data.runs || []))
      .catch(cause => toast(cause.message, 'error')).finally(() => setLoading(false));
  }, [toast]);

  if (selected) return <RunDetails key={selected.id} run={selected} onBack={() => setSelected(null)} />;
  if (loading) return <Spinner />;
  if (runs.length === 0) return <p className="pa-empty">Aucune exécution enregistrée.</p>;

  return (
    <div className="pa-table pa-backup-runs" role="table" aria-label="Journal d’exécution">
      <div className="pa-list-head" role="row">
        {['Démarrage', 'Origine', 'Résultat', 'Durée'].map(label => <span role="columnheader" key={label}>{label}</span>)}
      </div>
      {runs.map(run => (
        <div className="pa-list-row" role="row" key={run.id}>
          <div className="pa-row-title" role="cell">
            <button type="button" className="pa-name-button" aria-label={'Détail du cycle du ' + formatDateTime(run.started_at)}
              onClick={() => setSelected(run)}>{formatDateTime(run.started_at)}</button>
          </div>
          <div className="pa-row-plan" role="cell">{run.triggered_by === 'cron' ? 'Automatique' : 'Manuel'}</div>
          <div className="pa-row-status" role="cell">
            <StatusLabel status={run.status} />
            <p className="pa-row-subtitle">{run.tenants_succeeded ?? 0} réussies │ {run.tenants_failed ?? 0} en échec</p>
          </div>
          <div className="pa-row-date pa-muted" role="cell">{runDuration(run)}</div>
        </div>
      ))}
    </div>
  );
}

function RunDetails({ run, onBack }: { run: Run; onBack: () => void }) {
  const [items, setItems] = useState<RunItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    callScheduler('get_run_detail', { run_id: run.id }).then(data => setItems(data.items || []))
      .catch(cause => toast(cause.message, 'error')).finally(() => setLoading(false));
  }, [run.id, toast]);

  return (
    <PlatformWorkPage title={'Cycle du ' + formatDateTime(run.started_at)} backLabel="Retour aux exécutions" onBack={onBack}>
      <dl className="pa-record-summary">
        <KeyValue label="Origine" value={run.triggered_by === 'cron' ? 'Automatique' : 'Manuelle'} />
        <KeyValue label="Statut" value={<StatusLabel status={run.status} />} />
        <KeyValue label="Durée" value={runDuration(run)} />
        <KeyValue label="Ignorées" value={run.tenants_skipped ?? 0} />
      </dl>
      <section>
        <h3 className="pa-heading mb-2">Résultat par entreprise</h3>
        {loading ? <Spinner /> : items.length === 0 ? <p className="pa-empty">Aucun résultat enregistré pour ce cycle.</p> : (
          <div className="pa-divided">
            {items.map(item => (
              <div className="pa-setting-row" key={item.id}>
                <div>
                  <strong>{item.tenants?.name || item.tenant_id?.slice(0, 8)}</strong>
                  <p className="pa-row-subtitle">{formatBytes(item.size_bytes)} │ {item.row_count?.toLocaleString('fr-FR') ?? '—'} lignes</p>
                  {item.error_message && <p className="pa-danger text-xs">{item.error_message}</p>}
                </div>
                <StatusLabel status={item.status} />
              </div>
            ))}
          </div>
        )}
      </section>
    </PlatformWorkPage>
  );
}

function OffsiteTab() {
  const [config, setConfig] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const { toast, success, error } = useToast();

  const load = useCallback(async () => {
    try {
      const [settings, totals, history] = await Promise.all([
        callOffsite('get_config'), callOffsite('summary'), callOffsite('list_transfers', { limit: 30 }),
      ]);
      setConfig(settings);
      setSummary(totals);
      setTransfers(history.transfers || []);
    } catch (cause) { toast((cause as Error).message, 'error'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const testConnection = async () => {
    setTesting(true);
    try {
      const result = await callOffsite('test_connection');
      if (result.success) success('Connexion WebDAV opérationnelle');
      else error(result.error || 'Échec du test');
    } catch (cause) { error((cause as Error).message); }
    finally { setTesting(false); }
  };

  const processQueue = async () => {
    setProcessing(true);
    try {
      const result = await callOffsite('process_queue');
      const processed: { status: string }[] = result.results || [];
      const failed = processed.filter(item => item.status === 'failed').length;
      const verified = processed.filter(item => item.status === 'verified').length;
      const skipped = processed.filter(item => item.status === 'skipped').length;
      const message = processed.length ? verified + ' vérifiés │ ' + failed + ' en échec │ ' + skipped + ' ignorés' : 'Aucun transfert en attente';
      toast(message, failed > 0 ? 'error' : 'success');
      await load();
    } catch (cause) { error((cause as Error).message); }
    finally { setProcessing(false); }
  };

  const handleTransfer = async (id: string, operation: 'retry_transfer' | 'verify_remote' | 'retrieve') => {
    setAction(id);
    try {
      const result = await callOffsite(operation, { transfer_id: id });
      if (operation === 'retry_transfer') success('Transfert remis en file');
      else if (operation === 'verify_remote') {
        if (result.verified) success('Empreinte conforme');
        else error(result.error || 'Empreinte non conforme');
      } else if (result.success) success(result.message || 'Sauvegarde rapatriée');
      else error(result.error || 'Échec du rapatriement');
      await load();
    } catch (cause) { error((cause as Error).message); }
    finally { setAction(null); }
  };

  if (loading) return <Spinner />;

  const secrets = config?.secrets_configured || {};
  const missing = offsiteSecrets.filter(key => !secrets[key]);
  const canTest = secrets.LWS_WEBDAV_URL && secrets.LWS_WEBDAV_USERNAME && secrets.LWS_WEBDAV_PASSWORD;
  const cron = config?.cron_status;
  const ready = config?.config?.enabled && !missing.length && cron?.exists && cron?.active && !cron.error;
  return (
    <div className="pa-page">
      <div className="pa-section-head">
        <span className="pa-muted text-sm">Connexion LWS │ {ready ? 'Active' : 'Inactive'}</span>
        <div className="pa-inline">
          <button type="button" className="pa-link" onClick={() => void testConnection()} disabled={!canTest || testing}>
            {testing ? <Loader2 size={16} className="animate-spin" /> : <Cloud size={16} />} Tester la connexion
          </button>
          <button type="button" className="pa-button" data-variant="primary" onClick={() => void processQueue()} disabled={processing}>
            <RefreshCw size={16} className={processing ? 'animate-spin' : undefined} /> Traiter la file
          </button>
        </div>
      </div>
      <dl className="pa-record-summary">
        <KeyValue label="Vérifiées" value={summary?.total_verified ?? 0} />
        <KeyValue label="En attente" value={summary?.total_queued ?? 0} />
        <KeyValue label="En échec" value={summary?.total_failed ?? 0} />
        <KeyValue label="Chiffrement" value={secrets.BACKUP_ENCRYPTION_KEY_ID ? 'Clé configurée' : 'Clé manquante'} />
      </dl>
      {missing.length > 0 && <details>
        <summary className="pa-link cursor-pointer">Configuration manquante ({missing.length})</summary>
        <ul className="pa-column-list">{missing.map(key => <li className="pa-break" key={key}>{key}</li>)}</ul>
      </details>}
      {transfers.length === 0 ? <p className="pa-empty">Aucun transfert enregistré.</p> : (
        <div className="pa-table pa-transfer-list" role="table" aria-label="Transferts LWS">
          <div className="pa-list-head" role="row">
            {['Entreprise', 'Archive', 'Statut', 'Actions'].map(label => <span role="columnheader" key={label}>{label}</span>)}
          </div>
          {transfers.map(item => (
            <div className="pa-list-row" role="row" key={item.id}>
              <div className="pa-row-title" role="cell">
                <strong>{item.tenants?.name || item.tenant_id?.slice(0, 8)}</strong>
                <p className="pa-row-subtitle">{formatDateTime(item.queued_at)}</p>
              </div>
              <div className="pa-row-amount" role="cell">{formatBytes(item.size_bytes)}</div>
              <div className="pa-row-status" role="cell">
                <StatusLabel status={item.status} />
                {item.error_message && <p className="pa-row-subtitle">{item.error_message}</p>}
              </div>
              <div className="pa-row-actions" role="cell">
                {action === item.id && <Loader2 size={15} className="animate-spin" />}
                {item.status === 'failed' && <button type="button" className="pa-link" disabled={action !== null} onClick={() => void handleTransfer(item.id, 'retry_transfer')}>
                  <RotateCcw size={15} /> Relancer
                </button>}
                {item.status === 'verified' && <>
                  <button type="button" className="pa-link" disabled={action !== null} onClick={() => void handleTransfer(item.id, 'verify_remote')}>
                    <Check size={15} /> Vérifier
                  </button>
                  <button type="button" className="pa-link" disabled={action !== null} onClick={() => void handleTransfer(item.id, 'retrieve')}>
                    <Download size={15} /> Récupérer
                  </button>
                </>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const defaultPolicy = {
  enabled: false, cron_expression: '0 2 * * *', timezone: 'Africa/Dakar',
  retention_daily: 7, retention_weekly: 4, retention_monthly: 6, max_concurrent: 2,
};

const defaultOffsite = { enabled: false, root_folder: '/Waarwi', auto_transfer: true };

function SettingsTab() {
  const [data, setData] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [policyDraft, setPolicyDraft] = useState<typeof defaultPolicy | null>(null);
  const [offsiteDraft, setOffsiteDraft] = useState<typeof defaultOffsite | null>(null);
  const { toast, success, error } = useToast();

  const load = useCallback(async () => {
    try {
      const [settings, offsite] = await Promise.all([callScheduler('dashboard_summary'), callOffsite('get_config')]);
      setData(settings);
      setConfig(offsite);
    } catch (cause) { toast((cause as Error).message, 'error'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (policyDraft) {
        await callScheduler('update_policy', policyDraft);
        success('Planification enregistrée');
      } else if (offsiteDraft) {
        await callOffsite('update_config', offsiteDraft);
        success('Configuration distante enregistrée');
      }
      await load();
      setPolicyDraft(null);
      setOffsiteDraft(null);
    } catch (cause) { error((cause as Error).message); }
    finally { setSaving(false); }
  };

  if (loading) return <Spinner />;
  if (!data || !config) return <p className="pa-empty">Les paramètres de protection sont indisponibles.</p>;

  const policy = {
    enabled: data.policy?.enabled ?? defaultPolicy.enabled,
    cron_expression: data.policy?.cron_expression || defaultPolicy.cron_expression,
    timezone: data.policy?.timezone || defaultPolicy.timezone,
    retention_daily: data.policy?.retention_daily ?? defaultPolicy.retention_daily,
    retention_weekly: data.policy?.retention_weekly ?? defaultPolicy.retention_weekly,
    retention_monthly: data.policy?.retention_monthly ?? defaultPolicy.retention_monthly,
    max_concurrent: data.policy?.max_concurrent ?? defaultPolicy.max_concurrent,
  };
  const offsite = {
    enabled: config.config?.enabled ?? defaultOffsite.enabled,
    root_folder: config.config?.root_folder || defaultOffsite.root_folder,
    auto_transfer: config.config?.auto_transfer ?? defaultOffsite.auto_transfer,
  };
  const secrets = config.secrets_configured || {};

  if (policyDraft || offsiteDraft) {
    return (
      <PlatformWorkPage title={policyDraft ? 'Modifier la planification' : 'Modifier la copie distante'} backLabel="Retour aux paramètres"
        onBack={() => { setPolicyDraft(null); setOffsiteDraft(null); }} busy={saving}>
        <form className="pa-form" onSubmit={event => { event.preventDefault(); void save(); }}>
          {policyDraft && <>
            <label className="pa-inline">
              <input type="checkbox" checked={policyDraft.enabled} onChange={event => setPolicyDraft({ ...policyDraft, enabled: event.target.checked })} />
              Protection automatique
            </label>
            <div className="pa-form-grid">
              <label className="pa-field-label">Expression cron
                <input required className="w-input-ul" value={policyDraft.cron_expression}
                  onChange={event => setPolicyDraft({ ...policyDraft, cron_expression: event.target.value })} />
              </label>
              <label className="pa-field-label">Fuseau horaire
                <input required className="w-input-ul" value={policyDraft.timezone}
                  onChange={event => setPolicyDraft({ ...policyDraft, timezone: event.target.value })} />
              </label>
              {([
                ['max_concurrent', 'Exécutions simultanées'], ['retention_daily', 'Rétention quotidienne (jours)'],
                ['retention_weekly', 'Rétention hebdomadaire (semaines)'], ['retention_monthly', 'Rétention mensuelle (mois)'],
              ] as const).map(([key, label]) => (
                <label className="pa-field-label" key={key}>{label}
                  <input required type="number" min={1} className="w-input-ul" value={policyDraft[key]}
                    onChange={event => setPolicyDraft({ ...policyDraft, [key]: Number(event.target.value) })} />
                </label>
              ))}
            </div>
          </>}
          {offsiteDraft && <>
            <label className="pa-inline">
              <input type="checkbox" checked={offsiteDraft.enabled} onChange={event => setOffsiteDraft({ ...offsiteDraft, enabled: event.target.checked })} />
              Copie distante activée
            </label>
            <label className="pa-inline">
              <input type="checkbox" checked={offsiteDraft.auto_transfer} onChange={event => setOffsiteDraft({ ...offsiteDraft, auto_transfer: event.target.checked })} />
              Transfert automatique
            </label>
            <label className="pa-field-label">Dossier racine
              <input required className="w-input-ul" value={offsiteDraft.root_folder}
                onChange={event => setOffsiteDraft({ ...offsiteDraft, root_folder: event.target.value })} />
            </label>
          </>}
          <div className="pa-form-actions">
            <button type="submit" className="pa-button" data-variant="primary" disabled={saving}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Enregistrer
            </button>
          </div>
        </form>
      </PlatformWorkPage>
    );
  }

  return (
    <div className="pa-page">
      <div className="pa-overview-grid">
        <section>
          <div className="pa-section-head">
            <h2 className="pa-heading">Planification et rétention</h2>
            <button type="button" className="pa-link" onClick={() => setPolicyDraft(policy)}>Modifier la planification</button>
          </div>
          <dl className="pa-keyvals">
            <KeyValue label="Protection automatique" value={policy.enabled ? 'Activée' : 'Désactivée'} />
            <KeyValue label="Expression cron" value={policy.cron_expression} />
            <KeyValue label="Fuseau horaire" value={policy.timezone} />
            <KeyValue label="Exécutions simultanées" value={policy.max_concurrent} />
            <KeyValue label="Rétention quotidienne" value={policy.retention_daily + ' jours'} />
            <KeyValue label="Rétention hebdomadaire" value={policy.retention_weekly + ' semaines'} />
            <KeyValue label="Rétention mensuelle" value={policy.retention_monthly + ' mois'} />
          </dl>
        </section>
        <section>
          <div className="pa-section-head">
            <h2 className="pa-heading">Copie distante</h2>
            <button type="button" className="pa-link" onClick={() => setOffsiteDraft(offsite)}>Modifier la copie distante</button>
          </div>
          <dl className="pa-keyvals">
            <KeyValue label="Copie LWS" value={offsite.enabled ? 'Activée' : 'Désactivée'} />
            <KeyValue label="Transfert automatique" value={offsite.auto_transfer ? 'Activé' : 'Désactivé'} />
            <KeyValue label="Protocole" value="WebDAV" />
            <KeyValue label="Dossier racine" value={offsite.root_folder} />
          </dl>
        </section>
      </div>
      <section className="pa-panel">
        <h2 className="pa-heading">Sécurité</h2>
        <dl className="pa-record-summary">
          <KeyValue label="Clé de chiffrement" value={secrets.BACKUP_ENCRYPTION_KEY_B64 ? 'Configurée' : 'Manquante'} />
          <KeyValue label="Secret du planificateur" value={data.cron_secret_configured ? 'Configuré' : 'Manquant'} />
          <KeyValue label="Secret de la copie distante" value={secrets.OFFSITE_CRON_SECRET ? 'Configuré' : 'Manquant'} />
        </dl>
      </section>
    </div>
  );
}
