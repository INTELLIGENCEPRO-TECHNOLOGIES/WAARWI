import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, Lock, ShieldCheck } from 'lucide-react';
import { verifyBackupV3ForRestore, type BackupSource, type BackupV3Record } from '../lib/backupV3';
import { formatDateTime } from '../lib/format';
import { SearchableSelect } from './SearchableSelect';

export type BackupRecoveryTarget = { archiveId: string; source: BackupSource };

type ArchiveCheck = BackupRecoveryTarget & (
  | { status: 'running'; done: number; total: number }
  | { status: 'verified'; total: number }
  | { status: 'failed'; message: string });

export function BackupRestore({ backups, initialTarget }: {
  backups: BackupV3Record[];
  initialTarget: BackupRecoveryTarget | null;
}) {
  const [archiveId, setArchiveId] = useState(initialTarget?.archiveId ?? '');
  const [source, setSource] = useState<BackupSource>(initialTarget?.source ?? 'storage');
  const [check, setCheck] = useState<ArchiveCheck | null>(null);
  const active = useRef<AbortController | null>(null);
  const sourceGroup = useId();
  const suspensionId = useId();
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
          disabled={busy}
        />
        <fieldset className="flex flex-wrap gap-x-5" disabled={busy}>
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
          <button type="button" className="btn-secondary min-h-11 text-sm disabled:opacity-50" disabled={busy} onClick={() => void checkArchive()}>
            {busy ? <Loader2 size={16} aria-hidden="true" className="animate-spin" /> : <ShieldCheck size={16} aria-hidden="true" />}
            Contrôler l’archive
          </button>
          <button type="button" className="btn-ghost min-h-11 text-sm disabled:opacity-50" aria-describedby={suspensionId} disabled>
            <Lock size={16} aria-hidden="true" /> Restaurer cette sauvegarde
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
      <p id={suspensionId} className="border-t border-[var(--w-separator)] pt-3 text-sm text-[var(--w-text-sec)]">
        La restauration des données en ligne et l’import d’une archive téléchargée sont actuellement suspendus.
      </p>
    </section>
  );
}

export function BackupReset() {
  const suspensionId = useId();
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
        <button type="button" className="btn-ghost min-h-11 text-sm disabled:opacity-50" aria-describedby={suspensionId} disabled>
          <Lock size={16} aria-hidden="true" /> Réinitialiser les opérations
        </button>
        <p id={suspensionId} className="mt-2 text-sm text-[var(--w-text-sec)]">L’exécution de la réinitialisation est actuellement suspendue.</p>
      </div>
    </section>
  );
}
