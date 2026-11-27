import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Loader2, RotateCcw, ShieldCheck, Upload } from 'lucide-react';
import {
  abandonBackupRecovery, executeBackupRecovery, getBackupRecovery, prepareBackupRecovery, prepareBackupZip,
  verifyBackupV3ForRestore, type BackupRecoveryJob, type BackupRecoveryState, type BackupSource, type BackupV3Record,
} from '../lib/backupV3';
import { formatDateTime } from '../lib/format';
import { SearchableSelect } from './SearchableSelect';
import { Modal } from './Modal';

export type BackupRecoveryTarget = { archiveId: string; source: BackupSource };

type ArchiveCheck = BackupRecoveryTarget & (
  | { status: 'running'; done: number; total: number }
  | { status: 'verified'; total: number }
  | { status: 'failed'; message: string });

function BackupRestore({ backups, initialTarget, canPrepare, disabled, onPrepare }: {
  backups: BackupV3Record[];
  initialTarget: BackupRecoveryTarget | null;
  canPrepare: boolean;
  disabled: boolean;
  onPrepare: (target: BackupRecoveryTarget) => void;
}) {
  const [archiveId, setArchiveId] = useState(initialTarget?.archiveId ?? '');
  const [source, setSource] = useState<BackupSource>(initialTarget?.source ?? 'storage');
  const [check, setCheck] = useState<ArchiveCheck | null>(null);
  const active = useRef<AbortController | null>(null);
  const sourceGroup = useId();
  const archives = backups.filter((backup): backup is BackupV3Record & { archive_id: string } =>
    backup.status === 'verified' && backup.archive_id !== null);
  const selected = archives.find(backup => backup.archive_id === archiveId) ?? archives[0];
  const hasLwsCopy = selected?.copy_status === 'confirmed';
  const selectedSource = hasLwsCopy ? source : 'storage';
  const busy = check?.status === 'running';
  const currentCheck = check?.archiveId === selected?.archive_id && check?.source === selectedSource ? check : null;

  useEffect(() => () => active.current?.abort(), []);

  async function checkArchive() {
    if (active.current || !selected?.archive_id) return;
    const controller = new AbortController();
    const target = { archiveId: selected.archive_id, source: selectedSource };
    active.current = controller;
    setArchiveId(target.archiveId);
    setCheck({ ...target, status: 'running', done: 0, total: 0 });
    let checked = 0;
    try {
      await verifyBackupV3ForRestore(target.archiveId, target.source, (done, total) => {
        checked = done;
        setCheck({ ...target, status: 'running', done, total });
      }, controller.signal);
      if (!controller.signal.aborted) setCheck({ ...target, status: 'verified', total: checked });
    } catch (cause) {
      if (!controller.signal.aborted) {
        setCheck({ ...target, status: 'failed', message: cause instanceof Error ? cause.message : 'Contrôle indisponible.' });
      }
    } finally {
      active.current = null;
    }
  }

  return (
    <section className="grid min-w-0 max-w-2xl gap-4" aria-label="Restauration">
      <div className="grid gap-1">
        <h3 className="text-sm font-semibold">Restaurer une sauvegarde</h3>
        <p className="text-sm text-[var(--w-text-sec)]">Une restauration remplace les données de tous les magasins de l’entreprise par celles de la sauvegarde choisie.</p>
      </div>
      {archives.length ? <>
        <SearchableSelect
          label="Archive à contrôler"
          value={selected?.archive_id ?? ''}
          options={archives.map(backup => ({
            value: backup.archive_id,
            label: backup.label,
            sublabel: formatDateTime(backup.created_at),
          }))}
          onChange={value => { setArchiveId(value); setCheck(null); }}
          clearable={false}
          wrapLabels
          disabled={busy || disabled}
        />
        <fieldset className="flex flex-wrap gap-x-5" disabled={busy || disabled}>
          <legend className="mb-1 text-sm font-medium">Emplacement de la copie</legend>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="radio" name={sourceGroup} checked={selectedSource === 'storage'} onChange={() => { setSource('storage'); setCheck(null); }} />
            Archives Waarwi
          </label>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="radio" name={sourceGroup} checked={selectedSource === 'lws'} disabled={!hasLwsCopy} onChange={() => { setSource('lws'); setCheck(null); }} />
            Copie LWS{!hasLwsCopy && <span className="text-[var(--w-text-sec)]">(indisponible)</span>}
          </label>
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary min-h-11 text-sm disabled:opacity-50" disabled={busy || disabled} onClick={() => void checkArchive()}>
            {busy ? <Loader2 size={16} aria-hidden="true" className="animate-spin" /> : <ShieldCheck size={16} aria-hidden="true" />}
            Contrôler l’archive
          </button>
          <button type="button" className="btn-primary min-h-11 text-sm" disabled={busy || disabled || !canPrepare}
            onClick={() => { if (selected) onPrepare({ archiveId: selected.archive_id, source: selectedSource }); }}>
            <RotateCcw size={16} aria-hidden="true" /> Préparer la restauration
          </button>
        </div>
        {currentCheck?.status === 'running' && <p role="status" className="text-sm">
          {currentCheck.total ? `Contrôle de ${currentCheck.done} sur ${currentCheck.total} fichiers…` : 'Lecture du manifeste…'}
        </p>}
        {currentCheck?.status === 'verified' && <p role="status" className="text-sm font-medium">
          {currentCheck.total} fichiers déchiffrés et vérifiés, manifeste compris.
        </p>}
        {currentCheck?.status === 'failed' && <p role="alert" className="text-sm text-red-700">{currentCheck.message}</p>}
      </> : <p className="text-sm text-[var(--w-text-sec)]">Aucune archive V3 vérifiée à contrôler.</p>}
    </section>
  );
}

function BackupReset({ canPrepare, onPrepare }: { canPrepare: boolean; onPrepare: () => void }) {
  return (
    <section className="grid min-w-0 max-w-2xl gap-4" aria-label="Réinitialisation">
      <div className="grid gap-1">
        <h3 className="text-sm font-semibold">Réinitialiser les opérations</h3>
        <p className="text-sm text-[var(--w-text-sec)]">Cette opération concerne tous les magasins de l’entreprise.</p>
      </div>
      <dl className="divide-y divide-[var(--w-separator)] border-y border-[var(--w-separator)] text-sm">
        <div className="grid gap-1 py-3">
          <dt className="font-medium">Historique supprimé</dt>
          <dd className="text-[var(--w-text-sec)]">Ventes, commandes, sessions de caisse, mouvements et écritures comptables.</dd>
        </div>
        <div className="grid gap-1 py-3">
          <dt className="font-medium">Soldes remis à zéro</dt>
          <dd className="text-[var(--w-text-sec)]">Quantités en stock, soldes des clients et fournisseurs, du coffre et des comptes de transfert d’argent.</dd>
        </div>
        <div className="grid gap-1 py-3">
          <dt className="font-medium">Données conservées</dt>
          <dd className="text-[var(--w-text-sec)]">Fiches articles, clients et fournisseurs, magasins, utilisateurs et paramètres.</dd>
        </div>
      </dl>
      <div>
        <button type="button" className="btn-primary min-h-11 text-sm" onClick={onPrepare} disabled={!canPrepare}>
          <RotateCcw size={16} aria-hidden="true" /> Préparer la réinitialisation
        </button>
      </div>
    </section>
  );
}

const recoveryErrors: Record<string, string> = {
  'BRR-020': 'L’archive ne contient pas toutes les données requises pour l’état actuel de l’entreprise.',
  'BRR-039': 'Des références de la sauvegarde sont incompatibles avec les données actuelles.',
  'BRR-041': 'Le manifeste de la sauvegarde n’a pas pu être authentifié.',
  'BRR-045': 'Un bloc de la sauvegarde n’a pas pu être authentifié.',
  'BRR-073': 'La structure des données a changé. Préparez à nouveau l’opération.',
  'BRR-074': 'Des écritures sont restées en cours. L’opération a été interrompue.',
  'BRR-076': 'L’opération aurait affecté une autre entreprise. Elle a été annulée.',
  'BRR-080': 'La sauvegarde de sécurité a échoué ou de nouvelles données ont été enregistrées depuis sa création. Préparez à nouveau l’opération.',
  'BRR-403': 'L’autorisation de cette opération n’est plus valide.',
};

function jobSummary(job: BackupRecoveryJob) {
  if (job.status === 'succeeded') return job.operation === 'reset' ? 'Réinitialisation terminée.' : 'Restauration terminée.';
  if (job.status === 'abandoned') return 'Opération annulée.';
  if (job.status === 'failed') return recoveryErrors[job.error_code ?? ''] ?? 'L’opération a échoué. Les données n’ont pas été remplacées.';
  if (job.maintenance) return 'Application de l’opération. Les écritures de l’entreprise sont momentanément bloquées.';
  if (job.execute_requested) return job.safety_status === 'verified'
    ? 'Sauvegarde de sécurité vérifiée. Exécution en attente.'
    : 'Sauvegarde de sécurité en cours. L’exécution attend sa vérification.';
  if (job.status === 'prepared') return 'Opération préparée. Confirmez pour démarrer.';
  if (job.source === 'zip' && (!job.manifest_ok || job.loaded_blocks < (job.total_blocks ?? 0))) {
    return 'Import en attente. Sélectionnez le même ZIP pour reprendre l’envoi.';
  }
  return 'Vérification de la sauvegarde en cours.';
}

export function BackupRecovery({ mode, backups, initialTarget }: {
  mode: 'restore' | 'reset';
  backups: BackupV3Record[];
  initialTarget: BackupRecoveryTarget | null;
}) {
  const [info, setInfo] = useState<BackupRecoveryState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [progress, setProgress] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const request = useRef(0);
  const operation = useRef<AbortController | null>(null);
  const confirmForm = useId();
  const latest = info?.job;
  const active = latest?.status === 'preparing' || latest?.status === 'prepared';
  const job = latest?.operation === mode || active ? latest : null;
  const word = job?.operation === 'reset' ? 'RÉINITIALISER' : 'RESTAURER';
  const confirmationText = confirmation.trim().toLocaleUpperCase('fr');
  const allowed = info?.available === true && info?.authorized === true && !loadError;
  const canPrepare = allowed && !active && !busy;
  const canResumeZip = active && job?.operation === 'restore' && job.source === 'zip' && job.status === 'preparing';
  const canConfirm = allowed && job?.operation === mode && job.status === 'prepared' && !job.execute_requested;

  const load = useCallback(async () => {
    const current = ++request.current;
    try {
      const state = await getBackupRecovery();
      if (current !== request.current) return;
      setInfo(state);
      setLoadError('');
    } catch (cause) {
      if (current === request.current) setLoadError(cause instanceof Error ? cause.message : 'État du service indisponible.');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (!document.hidden && !operation.current) void load(); }, 5_000);
    return () => {
      request.current++;
      operation.current?.abort();
      window.clearInterval(timer);
    };
  }, [load]);

  async function run(task: (signal: AbortSignal) => Promise<unknown>) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setActionError('');
    try {
      await task(controller.signal);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setActionError(cause instanceof Error ? cause.message : 'Opération indisponible.');
      }
    } finally {
      operation.current = null;
      if (!controller.signal.aborted) {
        setBusy(false);
        setProgress('');
        await load();
      }
    }
  }

  function importZip() {
    if (!file || !allowed || (!canPrepare && !canResumeZip)) return;
    void run(async signal => {
      await prepareBackupZip(file, (done, total) => setProgress('Import de ' + done + ' sur ' + total + ' fichiers…'), signal);
      if (!signal.aborted) {
        setFile(null);
        setFileInputKey(value => value + 1);
      }
    });
  }

  return (
    <div className="grid min-w-0 max-w-2xl gap-5">
      {loadError && <p role="alert" className="text-sm text-red-700">{loadError}</p>}
      {!info && !loadError && <p role="status" className="text-sm text-[var(--w-text-sec)]">Vérification de l’accès…</p>}
      {info && !info.available && <p className="text-sm text-[var(--w-text-sec)]">Le service de restauration et de réinitialisation est momentanément indisponible.</p>}
      {info?.available && !info.authorized && <p className="text-sm text-[var(--w-text-sec)]">
        L’administrateur de la plateforme doit autoriser ces opérations pour votre entreprise.
      </p>}
      {job && (
        <section className="grid gap-2 border-b border-[var(--w-separator)] pb-4" aria-label="Suivi de l’opération">
          <strong className="text-sm">{job.operation === 'reset' ? 'Réinitialisation' : 'Restauration'}{job.source === 'zip' ? ' depuis un ZIP' : job.source === 'lws' ? ' depuis LWS' : ''}</strong>
          {job.archive_created_at && <span className="text-xs text-[var(--w-text-sec)]">Sauvegarde du {formatDateTime(job.archive_created_at)}</span>}
          <p className="text-sm" role={job.status === 'failed' ? 'alert' : 'status'}>{jobSummary(job)}</p>
          {job.status === 'preparing' && job.total_blocks !== null && (
            <span className="text-xs text-[var(--w-text-sec)]">{job.loaded_blocks} sur {job.total_blocks} blocs préparés</span>
          )}
          {active && (
            <div className="flex flex-wrap gap-2">
              {canConfirm && <button type="button" className="btn-primary min-h-11 text-sm" disabled={busy}
                onClick={() => { setConfirmation(''); setConfirming(true); }}>
                {job.operation === 'reset' ? 'Confirmer la réinitialisation' : 'Confirmer la restauration'}
              </button>}
              {!job.maintenance && <button type="button" className="btn-ghost min-h-11 text-sm disabled:opacity-50" disabled={busy}
                onClick={() => void run(() => abandonBackupRecovery(job.id))}>Annuler l’opération</button>}
            </div>
          )}
        </section>
      )}
      {mode === 'restore' && <>
        <BackupRestore backups={backups} initialTarget={initialTarget} canPrepare={canPrepare} disabled={busy}
          onPrepare={target => { if (canPrepare) void run(() => prepareBackupRecovery(target.archiveId, target.source)); }} />
        <section className="grid gap-3 border-t border-[var(--w-separator)] pt-4" aria-label="Importer une sauvegarde ZIP">
          <h3 className="text-sm font-semibold">Importer une sauvegarde ZIP</h3>
          <p className="text-sm text-[var(--w-text-sec)]">Choisissez un ZIP V3 téléchargé pour cette entreprise. Waarwi vérifie le manifeste et les blocs avant de proposer la restauration.</p>
          <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); importZip(); }}>
            <label className="grid min-w-0 flex-1 gap-1 text-sm">
              Fichier ZIP
              <input key={fileInputKey} type="file" className="block min-w-0 max-w-full text-sm"
                accept=".zip,application/zip" disabled={!allowed || busy || (active && !canResumeZip)}
                onChange={event => setFile(event.target.files?.[0] ?? null)} />
            </label>
            <button type="submit" className="btn-secondary min-h-11 text-sm disabled:opacity-50" disabled={!file || !allowed || busy || (active && !canResumeZip)}>
              <Upload size={16} aria-hidden="true" /> {canResumeZip ? 'Reprendre l’import' : 'Préparer l’import'}
            </button>
          </form>
        </section>
      </>}
      {mode === 'reset' && <BackupReset canPrepare={canPrepare} onPrepare={() => {
        if (canPrepare) void run(() => prepareBackupRecovery());
      }} />}
      {busy && <p className="flex items-center gap-2 text-sm" role="status"><Loader2 size={16} aria-hidden="true" className="animate-spin" />{progress || 'Demande en cours…'}</p>}
      {actionError && <p className="text-sm text-red-700" role="alert">{actionError}</p>}
      <Modal open={confirming && canConfirm} onClose={() => { if (!busy) setConfirming(false); }}
        title={job?.operation === 'reset' ? 'Confirmer la réinitialisation' : 'Confirmer la restauration'} size="sm" layer="top" focusOnOpen
        footer={<>
          <button type="button" className="btn-secondary min-h-11 text-sm disabled:opacity-50" disabled={busy} onClick={() => setConfirming(false)}>Annuler</button>
          <button type="submit" form={confirmForm} className="btn-danger min-h-11 text-sm disabled:opacity-50" disabled={busy || confirmationText !== word}>
            Confirmer
          </button>
        </>}>
        <form className="grid gap-3" id={confirmForm} onSubmit={event => {
          event.preventDefault();
          if (!canConfirm || !job || confirmationText !== word) return;
          void run(async () => {
            await executeBackupRecovery(job.id, confirmationText);
            setConfirming(false);
          });
        }}>
          <p className="text-sm">Cette action concerne tous les magasins de votre entreprise. Une sauvegarde de sécurité V3 sera créée avant l’exécution.</p>
          <label className="grid gap-1 text-sm">
            Saisissez <strong>{word}</strong> pour confirmer.
            <input className="w-input-ul" autoComplete="off" spellCheck={false} value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} />
          </label>
          {actionError && <p className="text-sm text-red-700" role="alert">{actionError}</p>}
        </form>
      </Modal>
    </div>
  );
}
