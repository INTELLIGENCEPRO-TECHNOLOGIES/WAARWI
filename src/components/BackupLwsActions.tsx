import { useState } from 'react';
import { Download, Loader2, ShieldCheck } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { downloadBackupV3, verifyLwsBackupV3 } from '../lib/backupV3';

export function BackupLwsActions({ archiveId, buttonClassName = 'btn-ghost min-h-11 text-sm disabled:opacity-50' }: {
  archiveId: string;
  buttonClassName?: string;
}) {
  const toast = useToast();
  const [operation, setOperation] = useState<'verify' | 'download' | null>(null);
  const [progress, setProgress] = useState('');

  async function run(next: 'verify' | 'download') {
    if (operation) return;
    setOperation(next);
    const action = next === 'verify' ? 'Vérification' : 'Téléchargement';
    setProgress(action + ' depuis LWS…');
    const update = (done: number, total: number) => setProgress(action + ' de ' + done + ' sur ' + total + ' fichiers');
    try {
      if (next === 'verify') {
        await verifyLwsBackupV3(archiveId, update);
        toast.success('Tous les fichiers de la copie LWS ont été vérifiés.');
      } else {
        await downloadBackupV3(archiveId, update, 'lws');
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Copie LWS indisponible.');
    } finally {
      setOperation(null);
      setProgress('');
    }
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <button type="button" className={buttonClassName} disabled={operation !== null} onClick={() => void run('verify')}>
        {operation === 'verify' ? <Loader2 size={15} aria-hidden="true" className="animate-spin" /> : <ShieldCheck size={15} aria-hidden="true" />}
        Vérifier la copie
      </button>
      <button type="button" className={buttonClassName} disabled={operation !== null} onClick={() => void run('download')}>
        {operation === 'download' ? <Loader2 size={15} aria-hidden="true" className="animate-spin" /> : <Download size={15} aria-hidden="true" />}
        Télécharger la copie LWS
      </button>
      {progress && <span className="w-full text-xs text-[var(--w-text-sec)]" role="status">{progress}</span>}
    </div>
  );
}
