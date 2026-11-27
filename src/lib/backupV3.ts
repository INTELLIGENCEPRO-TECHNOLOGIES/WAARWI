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

type DownloadPage = {
  total: number;
  entries: { n: number; name: string; stored_bytes: number; stored_sha256: string }[];
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

export async function requestBackupV3(label: string, companyId?: string) {
  const { error } = await supabase.rpc('br_v3_backup_request', {
    p_request_id: crypto.randomUUID(),
    p_label: label.trim() || null,
    p_tenant_id: companyId ?? null,
  });
  if (error) throw error;
}

export async function downloadBackupV3(archiveId: string, onProgress: (done: number, total: number) => void) {
  const { CFB } = await import('xlsx');
  const zip = CFB.utils.cfb_new();
  let offset = 0;

  for (;;) {
    const page = await supabase.functions.invoke<DownloadPage>('backup-export-v3', {
      body: { action: 'download_list', archive_id: archiveId, offset },
    });
    if (page.error || !page.data?.entries.length) throw new Error('Liste des blocs indisponible.');
    for (const entry of page.data.entries) {
      if (entry.n !== offset || !/^(manifest\.wbr3m|blocks\/\d{6,}\.wbr3)$/.test(entry.name)) {
        throw new Error('Ordre des blocs invalide.');
      }
      const file = await supabase.functions.invoke<Blob>('backup-export-v3', {
        body: { action: 'download_entry', archive_id: archiveId, n: entry.n },
      });
      if (file.error || !(file.data instanceof Blob)) throw new Error('Bloc chiffré indisponible.');
      const buffer = await file.data.arrayBuffer();
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
      const digest = Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
      if (buffer.byteLength !== entry.stored_bytes || digest !== entry.stored_sha256) {
        throw new Error('Empreinte du bloc non conforme.');
      }
      CFB.utils.cfb_add(zip, entry.name, new Uint8Array(buffer));
      offset++;
      onProgress(offset, page.data.total);
    }
    if (offset >= page.data.total) break;
  }

  const archive = CFB.write(zip, { fileType: 'zip', type: 'array', compression: false });
  const url = URL.createObjectURL(new Blob([archive], { type: 'application/zip' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'waarwi-v3-' + archiveId + '.zip';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
