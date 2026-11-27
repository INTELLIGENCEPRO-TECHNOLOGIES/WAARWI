import { supabase } from './supabase';

export type BackupV3Record = {
  job_id: string;
  archive_id: string | null;
  label: string;
  status: string;
  created_at: string;
  total_rows: number | null;
  size_bytes: number | null;
  copy_status: string | null;
  confirmed_at: string | null;
  error_code: string | null;
};

export type BackupSource = 'storage' | 'lws';
type BackupProgress = (done: number, total: number) => void;
type DownloadEntry = { n: number; name: string; stored_bytes: number; stored_sha256: string };
type DownloadPage = {
  total: number;
  entries: DownloadEntry[];
};

export const backupStatusLabels: Record<string, string> = {
  pending: 'En attente',
  leased: 'En préparation',
  processing: 'Capture en cours',
  capture_ready: 'Capture terminée',
  exporting: 'Chiffrement en cours',
  verifying: 'Vérification en cours',
  publishing: 'Publication en cours',
  verified: 'Vérifiée',
  succeeded: 'Vérifiée',
  failed: 'Échec',
  cancelled: 'Annulée',
  abandoned: 'Interrompue',
};

export const backupCopyStatusLabels: Record<string, string> = {
  pending: 'En attente',
  in_progress: 'En cours',
  confirmed: 'Vérifiée',
  failed: 'En échec',
};

export async function requestBackupV3(requestId: string, label: string, companyId?: string) {
  const { error } = await supabase.rpc('br_v3_backup_request', {
    p_request_id: requestId,
    p_label: label.trim() || null,
    p_tenant_id: companyId ?? null,
  });
  if (error) throw error;
}

async function invokeBackupV3<T>(body: Record<string, unknown> | Blob, fallback: string, headers?: Record<string, string>): Promise<T> {
  const result = await supabase.functions.invoke<T>('backup-export-v3', { body, headers });
  if (result.error || result.data === null) {
    const response = result.error?.context;
    const failure = response instanceof Response ? await response.json().catch(() => null) : null;
    throw new Error(typeof failure?.error === 'string' ? failure.error : fallback);
  }
  return result.data;
}

export type BackupRecoveryJob = {
  id: string;
  operation: 'restore' | 'reset';
  status: 'preparing' | 'prepared' | 'succeeded' | 'failed' | 'abandoned';
  source: BackupSource | 'zip';
  archive_id: string | null;
  archive_created_at: string | null;
  manifest_ok: boolean;
  total_blocks: number | null;
  loaded_blocks: number;
  execute_requested: boolean;
  safety_status: string | null;
  maintenance: boolean;
  error_code: string | null;
};

export type BackupRecoveryState = { available: boolean; authorized: boolean; job: BackupRecoveryJob | null };

export function getBackupRecovery(jobId?: string) {
  return invokeBackupV3<BackupRecoveryState>({ action: 'restore_status', job_id: jobId }, 'État de la restauration indisponible.');
}

export async function prepareBackupRecovery(archiveId?: string, source: BackupSource | 'zip' = 'storage') {
  const request = await invokeBackupV3<{ job_id: string; status: string }>({
    action: 'restore_request', operation: archiveId ? 'restore_v3' : 'reset', archive_id: archiveId ?? null, source,
  }, 'Préparation indisponible.');
  return request.job_id;
}

export async function executeBackupRecovery(jobId: string, confirmation: string) {
  await invokeBackupV3({ action: 'restore_execute', job_id: jobId, confirmation }, 'La demande de confirmation a échoué.');
}

export async function abandonBackupRecovery(jobId: string) {
  await invokeBackupV3({ action: 'restore_abandon', job_id: jobId }, 'L’annulation a échoué.');
}

export async function prepareBackupZip(file: File, onProgress: BackupProgress, signal: AbortSignal) {
  const { readBackupV3Zip } = await import('./backupV3Zip');
  const zip = await readBackupV3Zip(file);
  signal.throwIfAborted();
  const jobId = await prepareBackupRecovery(zip.archiveId, 'zip');
  const { job } = await getBackupRecovery(jobId);
  if (job?.source !== 'zip' || job.archive_id !== zip.archiveId || job.total_blocks !== zip.blockCount) {
    throw new Error('Ce ZIP ne contient pas tous les fichiers attendus pour cette sauvegarde.');
  }
  if (job.status !== 'preparing') return;
  for (let number = 0; number <= zip.blockCount; number++) {
    signal.throwIfAborted();
    const part = await zip.part(number);
    signal.throwIfAborted();
    const accepted = await invokeBackupV3<{ accepted: boolean }>(part, 'Un fichier du ZIP n’a pas pu être transmis.', {
      'X-Restore-Job': jobId,
      'X-Restore-Part': String(number),
    });
    if (!accepted.accepted) throw new Error('Un fichier du ZIP a été refusé.');
    onProgress(number + 1, zip.blockCount + 1);
  }
}

async function visitBackupV3Entries(
  archiveId: string,
  source: BackupSource,
  onProgress: BackupProgress,
  visit: (entry: DownloadEntry) => Promise<void>,
  signal?: AbortSignal,
) {
  let offset = 0;
  let total: number | undefined;
  do {
    signal?.throwIfAborted();
    const page = await invokeBackupV3<DownloadPage>({
      action: 'download_list', archive_id: archiveId, source, offset,
    }, 'Liste des fichiers indisponible.');
    total ??= page.total;
    if (!Number.isSafeInteger(total) || page.total !== total || !page.entries.length || offset + page.entries.length > total) {
      throw new Error('Liste de sauvegarde incomplète.');
    }
    for (const entry of page.entries) {
      signal?.throwIfAborted();
      const name = offset === 0 ? 'manifest.wbr3m' : 'blocks/' + String(offset).padStart(6, '0') + '.wbr3';
      if (entry.n !== offset || entry.name !== name) {
        throw new Error('Ordre des fichiers de sauvegarde invalide.');
      }
      await visit(entry);
      signal?.throwIfAborted();
      offset++;
      onProgress(offset, total);
    }
  } while (offset < total);
}

export async function verifyBackupV3ForRestore(
  archiveId: string,
  source: BackupSource,
  onProgress: BackupProgress,
  signal: AbortSignal,
) {
  await visitBackupV3Entries(archiveId, source, onProgress, async entry => {
    const result = await invokeBackupV3<{ verified: boolean }>({
      action: 'verify_restore_entry', archive_id: archiveId, source, n: entry.n,
    }, 'Contrôle de l’archive indisponible.');
    if (!result.verified) throw new Error('Fichier non vérifié.');
  }, signal);
}

export async function verifyLwsBackupV3(archiveId: string, onProgress: BackupProgress) {
  await visitBackupV3Entries(archiveId, 'lws', onProgress, async entry => {
    const result = await invokeBackupV3<{ verified: boolean }>({
      action: 'verify_lws_entry', archive_id: archiveId, n: entry.n,
    }, 'Vérification LWS indisponible.');
    if (!result.verified) throw new Error('Fichier LWS non vérifié.');
  });
}

export async function downloadBackupV3(archiveId: string, onProgress: BackupProgress, source: BackupSource = 'storage') {
  const { CFB } = await import('xlsx');
  const zip = CFB.utils.cfb_new();
  await visitBackupV3Entries(archiveId, source, onProgress, async entry => {
    const file = await invokeBackupV3<Blob>({
      action: 'download_entry', archive_id: archiveId, source, n: entry.n,
    }, 'Fichier de sauvegarde indisponible.');
    if (!(file instanceof Blob)) throw new Error('Fichier de sauvegarde invalide.');
    const buffer = await file.arrayBuffer();
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
    const digest = Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
    if (buffer.byteLength !== entry.stored_bytes || digest !== entry.stored_sha256) {
      throw new Error('Empreinte du fichier non conforme.');
    }
    CFB.utils.cfb_add(zip, entry.name, new Uint8Array(buffer));
  });

  const archive = CFB.write(zip, { fileType: 'zip', type: 'array', compression: false });
  const url = URL.createObjectURL(new Blob([archive], { type: 'application/zip' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = (source === 'lws' ? 'waarwi-v3-lws-' : 'waarwi-v3-') + archiveId + '.zip';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
