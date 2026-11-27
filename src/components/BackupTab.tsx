import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Cloud, Download, Loader2, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { backupCopyStatusLabels, backupStatusLabels, downloadBackupV3, requestBackupV3, type BackupV3Record } from '../lib/backupV3';
import { formatDateTime, formatNum } from '../lib/format';
import { usePermissions } from '../lib/permissions';
import { supabase } from '../lib/supabase';
import { BackupLwsActions } from './BackupLwsActions';
import { BackupRecovery, type BackupRecoveryTarget } from './BackupRecovery';
import { Modal } from './Modal';

type BackupList = { backups: BackupV3Record[]; automatic: boolean; capture_enabled: boolean };

const views = [
  { id: 'archives', label: 'Archives' },
  { id: 'copies', label: 'Copie LWS' },
  { id: 'restore', label: 'Restauration' },
  { id: 'reset', label: 'Réinitialisation' },
  { id: 'schedule', label: 'Planification' },
] as const;

const errorMessage = (cause: unknown) => (cause as { message?: string })?.message || 'Opération indisponible.';

export function BackupTab({ companyId }: { companyId?: string }) {
  const { tenant } = useApp();
  const toast = useToast();
  const { can } = usePermissions();
  const [view, setView] = useState<typeof views[number]['id']>('archives');
  const [data, setData] = useState<BackupList | null>(null);
  const [loadError, setLoadError] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [recoveryTarget, setRecoveryTarget] = useState<BackupRecoveryTarget | null>(null);
  const manualRequest = useRef<string | null>(null);
  const manualForm = useId();
  const tenantId = companyId ?? tenant?.id;
  const canCreate = !!companyId || can('backup_create');
  const canDownload = !companyId && can('backup_download');
  const canRestore = !companyId && can('backup_restore');
  const canReset = !companyId && can('backup_reset_operations');
  const tabs = views.filter(item => (item.id !== 'restore' || canRestore) && (item.id !== 'reset' || canReset));
  const visibleBackups = (data?.backups ?? []).filter(item => view !== 'copies' || (item.status === 'verified' && item.archive_id));

  const load = useCallback(async () => {
    if (!tenantId) return;
    const result = await supabase.rpc('br_v3_backup_list', { p_tenant_id: companyId ?? null });
    if (result.error) { setLoadError(result.error.message); return; }
    setLoadError('');
    setData(result.data as BackupList);
  }, [companyId, tenantId]);

  useEffect(() => {
    setData(null);
    setLoadError('');
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function run(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await operation();
      await load();
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  function closeManual() {
    setManualOpen(false);
    setLabel('');
    manualRequest.current = null;
  }

  return (
    <section className="grid min-w-0 gap-4" aria-label="Sauvegardes">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{companyId ? 'Sauvegardes V3' : 'Sauvegarde et restauration'}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {canCreate && <button type="button" className="btn-primary min-h-11 text-sm" disabled={!data?.capture_enabled || busy}
            onClick={() => {
              manualRequest.current = crypto.randomUUID();
              setManualOpen(true);
            }}>
            <Plus size={16} aria-hidden="true" /> Faire une sauvegarde
          </button>}
          <button type="button" className="btn-ghost min-h-11 text-sm disabled:opacity-50" aria-label="Actualiser les sauvegardes" onClick={() => void load()}>
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>
      </header>
      <nav className="flex flex-wrap gap-x-3 sm:gap-x-4 border-b border-[var(--w-separator)]" aria-label="Rubriques de sauvegarde">
        {tabs.map(item => (
          <button key={item.id} type="button" aria-current={view === item.id ? 'page' : undefined}
            className="min-h-11 border-b-2 border-transparent px-1 text-sm font-medium text-[var(--w-text-sec)] aria-[current=page]:border-[var(--w-text)] aria-[current=page]:font-semibold aria-[current=page]:text-[var(--w-text)]"
            onClick={() => setView(item.id)}>{item.label}</button>
        ))}
      </nav>
      <Modal open={manualOpen && canCreate} onClose={() => { if (!busy) closeManual(); }} title="Faire une sauvegarde" size="sm" layer="top" focusOnOpen
        footer={<>
          <button type="button" className="btn-secondary min-h-11 text-sm disabled:opacity-50" disabled={busy} onClick={closeManual}>Annuler</button>
          <button type="submit" form={manualForm} className="btn-primary min-h-11 text-sm" disabled={busy || !data?.capture_enabled}>
            {busy && <Loader2 size={16} aria-hidden="true" className="animate-spin" />}
            Lancer la sauvegarde
          </button>
        </>}>
        <form id={manualForm} className="grid gap-3" onSubmit={event => {
          event.preventDefault();
          const requestId = manualRequest.current;
          if (!requestId || !data?.capture_enabled) return;
          void run(async () => {
            await requestBackupV3(requestId, label, companyId);
            closeManual();
            setView('archives');
            toast.success('Sauvegarde demandée. Suivez son état dans Archives.');
          });
        }}>
          <p className="text-sm text-[var(--w-text-sec)]">La sauvegarde couvre l’ensemble des magasins de l’entreprise.</p>
          <label className="grid min-w-0 gap-1 text-sm">
            Intitulé facultatif
            <input className="w-input-ul" value={label} maxLength={120} disabled={busy} onChange={event => setLabel(event.target.value)} />
          </label>
        </form>
      </Modal>
      {loadError && <p role="alert" className="text-sm text-red-700">{loadError}</p>}
      {!data && !loadError && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 size={16} className="animate-spin" /> Chargement…</p>}
      {data && canCreate && !data.capture_enabled && <p className="text-sm text-[var(--w-text-sec)]">La création de sauvegardes est momentanément indisponible.</p>}
      {progress && <p role="status" className="text-sm">{progress}</p>}
      {((view === 'restore' && canRestore) || (view === 'reset' && canReset)) && data &&
        <BackupRecovery key={view} mode={view} backups={data.backups} initialTarget={recoveryTarget} />}
      {data && view === 'schedule' && (
        <dl className="divide-y divide-[var(--w-separator)] text-sm">
          <div className="flex flex-wrap justify-between gap-2 py-3">
            <dt>Planification automatique</dt><dd className="font-medium">{data.automatic ? 'Active' : 'Suspendue'}</dd>
          </div>
          {canCreate && <div className="flex flex-wrap justify-between gap-2 py-3">
            <dt>Sauvegarde manuelle</dt><dd className="font-medium">{data.capture_enabled ? 'Disponible' : 'Indisponible'}</dd>
          </div>}
        </dl>
      )}
      {data && (view === 'archives' || view === 'copies') && (visibleBackups.length === 0 ? (
        <p className="py-4 text-sm text-[var(--w-text-sec)]">
          {view === 'copies' ? 'Aucune archive prête pour la copie LWS.' : 'Aucune sauvegarde V3.'}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--w-separator)] border-y border-[var(--w-separator)]">
          {visibleBackups.map(item => (
            <li key={item.job_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="grid min-w-0 gap-1">
                <strong className="break-words text-sm">{item.label}</strong>
                <span className="text-sm text-[var(--w-text-sec)]">{formatDateTime(item.created_at)}</span>
                <span className="text-sm">
                  {backupStatusLabels[item.status] || item.status}
                  {item.total_rows !== null && <span className="ml-2 border-l border-[var(--w-separator)] pl-2">{formatNum(item.total_rows)} lignes</span>}
                </span>
                {(view === 'copies' || item.copy_status) && <span className="text-sm text-[var(--w-text-sec)]">
                  {item.copy_status ? 'Copie LWS ' + (backupCopyStatusLabels[item.copy_status] ?? item.copy_status).toLocaleLowerCase('fr') : 'Copie LWS à lancer'}
                </span>}
                {view === 'copies' && item.confirmed_at && <span className="text-sm text-[var(--w-text-sec)]">
                  Vérifiée le {formatDateTime(item.confirmed_at)}
                </span>}
                {item.error_code && item.error_code !== 'YIELD' && <span className="text-xs text-red-700">{item.error_code}</span>}
              </div>
              {item.status === 'verified' && item.archive_id && (
                <div className="flex flex-wrap gap-2">
                  {view === 'copies' && item.copy_status === 'confirmed' && (companyId || canDownload) && (
                    <BackupLwsActions archiveId={item.archive_id} />
                  )}
                  {view === 'copies' && (!item.copy_status || item.copy_status === 'failed') && (
                    <button type="button" className="btn-ghost min-h-11 text-sm disabled:opacity-50" disabled={busy} onClick={() => void run(async () => {
                      const { error } = await supabase.rpc('br_v3_backup_copy', { p_archive_id: item.archive_id });
                      if (error) throw error;
                      toast.success('Copie LWS ajoutée à la file.');
                    })}><Cloud size={16} /> {item.copy_status ? 'Relancer la copie' : 'Copier sur LWS'}</button>
                  )}
                  {view === 'archives' && canDownload && <button type="button" className="btn-ghost min-h-11 text-sm disabled:opacity-50" disabled={busy} onClick={() => void run(async () => {
                    if (!item.archive_id) return;
                    setProgress('Préparation de l’archive…');
                    await downloadBackupV3(item.archive_id, (done, total) => setProgress(done + ' blocs téléchargés sur ' + total));
                  })}><Download size={16} /> Télécharger</button>}
                  {canRestore && (view === 'archives' || item.copy_status === 'confirmed') && (
                    <button type="button" className="btn-ghost min-h-11 text-sm disabled:opacity-50" onClick={() => {
                      if (!item.archive_id) return;
                      setRecoveryTarget({ archiveId: item.archive_id, source: view === 'copies' ? 'lws' : 'storage' });
                      setView('restore');
                    }}>
                      <ShieldCheck size={16} aria-hidden="true" /> Contrôler avant restauration
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      ))}
    </section>
  );
}
