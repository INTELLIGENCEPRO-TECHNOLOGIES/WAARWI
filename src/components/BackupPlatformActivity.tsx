import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { backupCopyStatusLabels, backupStatusLabels } from '../lib/backupV3';
import { formatDateTime, formatNum } from '../lib/format';
import { supabase } from '../lib/supabase';
import { PlatformWorkPage } from './PlatformWorkPage';
import { SearchableSelect } from './SearchableSelect';

type Page<T> = { items: T[]; total: number };
type Run = {
  period_key: string; created_at: string; automatic: boolean;
  total: number; succeeded: number; failed: number; cancelled: number; active: number;
};
type RunJob = {
  job_id: string; company_id: string; company_name: string; status: string;
  started_at: string | null; finished_at: string | null; error_code: string | null; total_rows: number | null;
};
type Transfer = {
  id: string; archive_id: string; company_id: string; company_name: string; label: string;
  status: string; requested_at: string; confirmed_at: string | null; blocks_confirmed: number;
  block_count: number; manifest_confirmed: boolean; error_code: string | null;
};

const PAGE_SIZE = 20;
const copyFilters = [
  { value: '', label: 'Tous les statuts' },
  ...Object.entries(backupCopyStatusLabels).map(([value, label]) => ({ value, label })),
];

function useBackupReport<T>(request: (signal: AbortSignal) => PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const [data, setData] = useState<T | null>(null);
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    setData(null);
    setMessage('');
    const load = async () => {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      try {
        const result = await request(controller.signal);
        if (controller.signal.aborted) return;
        if (result.error) throw result.error;
        setData(result.data as T);
        setMessage('');
      } catch (cause) {
        if (!controller.signal.aborted) setMessage((cause as { message?: string })?.message || 'Données indisponibles.');
      } finally {
        inFlight = false;
      }
    };
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 20_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [request, revision]);

  return { data, message, refresh: () => setRevision(value => value + 1) };
}

function ReportState({ loading, message, empty }: { loading: boolean; message: string; empty?: string }) {
  if (message) return <p role="alert" className="pa-danger">{message}</p>;
  if (loading) return <p className="pa-empty" role="status"><Loader2 size={16} className="animate-spin" /> Chargement…</p>;
  return empty ? <p className="pa-empty">{empty}</p> : null;
}

function ReportHeading({ title, onRefresh }: { title: string; onRefresh: () => void }) {
  return (
    <div className="pa-section-head">
      <h2 className="pa-heading">{title}</h2>
      <button type="button" className="pa-icon-button" aria-label={'Actualiser ' + title.toLowerCase()} onClick={onRefresh}>
        <RefreshCw size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

function ReportPagination({ page, total, setPage }: { page: number; total: number; setPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages === 1 && page === 0) return null;
  return (
    <nav className="pa-inline justify-end" aria-label="Pagination">
      <button type="button" className="pa-icon-button" aria-label="Page précédente" disabled={page === 0} onClick={() => setPage(page - 1)}>
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <span className="pa-row-subtitle">Page {page + 1} sur {pages}</span>
      <button type="button" className="pa-icon-button" aria-label="Page suivante" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </nav>
  );
}

function ReportStatus({ alert = false, children }: { alert?: boolean; children: ReactNode }) {
  return <span className="pa-status" data-alert={alert}>{children}</span>;
}

function runLabel(run: Run) {
  if (run.automatic) return 'Sauvegarde planifiée';
  return run.period_key.startsWith('v3-cutover:') ? 'Mise en service V3' : 'Sauvegarde manuelle';
}

export function BackupExecutions({ openCompany }: { openCompany: (id: string) => void }) {
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Run | null>(null);
  const request = useCallback((signal: AbortSignal) => supabase.rpc('br_v3_platform_backup_runs', {
    p_offset: page * PAGE_SIZE, p_limit: PAGE_SIZE,
  }).abortSignal(signal), [page]);
  const report = useBackupReport<Page<Run>>(request);

  if (selected) {
    return <BackupRunDetail run={selected} onBack={() => setSelected(null)} openCompany={openCompany} />;
  }

  return (
    <section className="pa-page" aria-label="Exécutions">
      <ReportHeading title="Exécutions" onRefresh={report.refresh} />
      <ReportState loading={!report.data} message={report.message}
        empty={report.data?.items.length === 0 ? 'Aucune exécution enregistrée.' : undefined} />
      {!!report.data?.items.length && <ul className="pa-divided">
        {report.data.items.map(run => (
          <li key={run.period_key} className="pa-setting-row">
            <div className="grid gap-1">
              <strong>{runLabel(run)}</strong>
              <time className="pa-row-subtitle" dateTime={run.created_at}>{formatDateTime(run.created_at)}</time>
              <span className="pa-row-subtitle">{run.succeeded} réussies sur {run.total}
                {run.active > 0 && <span className="ml-2 border-l border-[var(--w-separator)] pl-2">{run.active} en cours</span>}
                {run.failed > 0 && <span className="ml-2 border-l border-[var(--w-separator)] pl-2">{run.failed} en échec</span>}
                {run.cancelled > 0 && <span className="ml-2 border-l border-[var(--w-separator)] pl-2">{run.cancelled} annulées</span>}
              </span>
            </div>
            <button type="button" className="pa-link" onClick={() => setSelected(run)}>Détails <ChevronRight size={16} aria-hidden="true" /></button>
          </li>
        ))}
      </ul>}
      {report.data && <ReportPagination page={page} setPage={setPage} total={report.data.total} />}
    </section>
  );
}

function BackupRunDetail({ run, onBack, openCompany }: { run: Run; onBack: () => void; openCompany: (id: string) => void }) {
  const request = useCallback((signal: AbortSignal) => supabase.rpc('br_v3_platform_backup_run', {
    p_period_key: run.period_key,
  }).abortSignal(signal), [run.period_key]);
  const report = useBackupReport<RunJob[]>(request);

  return (
    <PlatformWorkPage title={runLabel(run)} backLabel="Retour aux exécutions" onBack={onBack}>
      <p className="pa-row-subtitle">{formatDateTime(run.created_at)}</p>
      <ReportState loading={!report.data} message={report.message}
        empty={report.data?.length === 0 ? 'Aucune sauvegarde pour cette exécution.' : undefined} />
      {!!report.data?.length && <ul className="pa-divided">
        {report.data.map(job => (
          <li key={job.job_id} className="pa-setting-row">
            <div className="grid gap-1">
              <button type="button" className="pa-name-button" onClick={() => openCompany(job.company_id)}>{job.company_name}</button>
              {job.started_at && <span className="pa-row-subtitle">Début {formatDateTime(job.started_at)}</span>}
              {job.finished_at && <span className="pa-row-subtitle">Fin {formatDateTime(job.finished_at)}</span>}
              {job.total_rows !== null && <span className="pa-row-subtitle">{formatNum(job.total_rows)} lignes</span>}
              {job.error_code && <span className="pa-danger">{job.error_code}</span>}
            </div>
            <ReportStatus alert={job.status === 'failed'}>{backupStatusLabels[job.status] || job.status}</ReportStatus>
          </li>
        ))}
      </ul>}
    </PlatformWorkPage>
  );
}

export function BackupTransfers({ openCompany }: { openCompany: (id: string) => void }) {
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState('');
  const [retrying, setRetrying] = useState<string | null>(null);
  const toast = useToast();
  const request = useCallback((signal: AbortSignal) => supabase.rpc('br_v3_platform_backup_transfers', {
    p_offset: page * PAGE_SIZE, p_limit: PAGE_SIZE, p_status: status || null,
  }).abortSignal(signal), [page, status]);
  const report = useBackupReport<Page<Transfer>>(request);

  async function retry(item: Transfer) {
    if (retrying) return;
    setRetrying(item.id);
    try {
      const result = await supabase.rpc('br_v3_backup_copy', { p_archive_id: item.archive_id });
      if (result.error) throw result.error;
      toast.success('Copie LWS remise en file.');
      report.refresh();
    } catch (cause) {
      toast.error((cause as { message?: string })?.message || 'Copie LWS indisponible.');
    } finally {
      setRetrying(null);
    }
  }

  return (
    <section className="pa-page" aria-label="Copie distante LWS">
      <ReportHeading title="Copie distante LWS" onRefresh={report.refresh} />
      <SearchableSelect className="max-w-xs" ariaLabel="Statut de la copie LWS" options={copyFilters} value={status}
        placeholder="Tous les statuts" searchable={false} clearable={false}
        onChange={value => { setPage(0); setStatus(value); }} />
      <ReportState loading={!report.data} message={report.message}
        empty={report.data?.items.length === 0 ? 'Aucune copie LWS pour ce filtre.' : undefined} />
      {!!report.data?.items.length && <ul className="pa-divided">
        {report.data.items.map(item => (
          <li key={item.id} className="pa-setting-row flex-wrap">
            <div className="grid gap-1">
              <button type="button" className="pa-name-button" onClick={() => openCompany(item.company_id)}>{item.company_name}</button>
              <span className="pa-row-subtitle">{item.label}</span>
              <span className="pa-row-subtitle">Demandée le {formatDateTime(item.requested_at)}</span>
              {item.confirmed_at && <span className="pa-row-subtitle">Vérifiée le {formatDateTime(item.confirmed_at)}</span>}
              <span className="pa-row-subtitle">{formatNum(item.blocks_confirmed)} sur {formatNum(item.block_count)} blocs vérifiés
                {item.manifest_confirmed && <span className="ml-2 border-l border-[var(--w-separator)] pl-2">Manifeste vérifié</span>}
              </span>
              {item.error_code && <span className="pa-danger">{item.error_code}</span>}
            </div>
            <div className="pa-inline">
              <ReportStatus alert={item.status === 'failed'}>{backupCopyStatusLabels[item.status] || item.status}</ReportStatus>
              {item.status === 'failed' && <button type="button" className="pa-link" disabled={retrying !== null} onClick={() => void retry(item)}>
                {retrying === item.id && <Loader2 size={14} className="animate-spin" />} Relancer
              </button>}
            </div>
          </li>
        ))}
      </ul>}
      {report.data && <ReportPagination page={page} setPage={setPage} total={report.data.total} />}
    </section>
  );
}
