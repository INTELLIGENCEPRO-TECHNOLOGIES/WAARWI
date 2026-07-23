import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Database, Download, RefreshCw, Trash2, Loader2, Clock,
  ShieldCheck, AlertTriangle, Play, RotateCcw, Upload
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { ConfirmDialog } from './Modal';

type Backup = {
  id: string;
  label: string;
  kind: string;
  is_auto: boolean;
  size_bytes: number;
  created_at: string;
};

type Schedule = {
  tenant_id: string;
  auto_enabled: boolean;
  frequency_hours: number;
  keep_count: number;
  last_run_at: string | null;
  next_run_at: string | null;
};

const FREQ_OPTIONS = [
  { v: 6,   l: 'Toutes les 6 heures' },
  { v: 12,  l: 'Toutes les 12 heures' },
  { v: 24,  l: 'Chaque jour' },
  { v: 72,  l: 'Tous les 3 jours' },
  { v: 168, l: 'Chaque semaine' },
];

function fmtBytes(n: number) {
  if (!n) return '0 o';
  const k = 1024, units = ['o', 'Ko', 'Mo', 'Go'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(k)));
  return `${(n / Math.pow(k, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function BackupTab() {
  const { tenant } = useApp();
  const { success, error } = useToast();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<Backup | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Backup | null>(null);
  const [label, setLabel] = useState('');
  const [confirmImport, setConfirmImport] = useState<{ name: string; payload: any } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    const [{ data: b }, { data: s }] = await Promise.all([
      supabase.from('tenant_backups')
        .select('id,label,kind,is_auto,size_bytes,created_at')
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false }),
      supabase.from('tenant_backup_settings')
        .select('*')
        .eq('tenant_id', tenant.id)
        .maybeSingle(),
    ]);
    setBackups((b || []) as Backup[]);
    setSchedule((s as Schedule) || {
      tenant_id: tenant.id,
      auto_enabled: false,
      frequency_hours: 24,
      keep_count: 10,
      last_run_at: null,
      next_run_at: null,
    });
    setLoading(false);
  }, [tenant]);

  useEffect(() => { load(); }, [load]);

  // Run due auto-backup on mount so schedule ticks while the user is online
  useEffect(() => {
    if (!tenant) return;
    (async () => {
      try {
        await supabase.rpc('tenant_run_due_auto_backup');
        load();
      } catch { /* silent */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id]);

  const createBackup = async () => {
    setBusy('create');
    const { error: e } = await supabase.rpc('tenant_create_backup', {
      p_label: label || '',
      p_auto: false,
    });
    setBusy(null);
    if (e) { error(e.message); return; }
    setLabel('');
    success('Sauvegarde créée');
    load();
  };

  const doRestore = async (b: Backup) => {
    setBusy('restore');
    const { error: e } = await supabase.rpc('tenant_restore_backup', { p_backup_id: b.id });
    setBusy(null);
    setConfirmRestore(null);
    if (e) { error(e.message); return; }
    success('Restauration effectuée');
    load();
  };

  const doReset = async () => {
    setBusy('reset');
    const { error: e } = await supabase.rpc('tenant_reset_operations');
    setBusy(null);
    setConfirmReset(false);
    if (e) { error(e.message); return; }
    success('Données opérationnelles réinitialisées');
  };

  const doDelete = async (b: Backup) => {
    setBusy('delete');
    const { error: e } = await supabase.from('tenant_backups').delete().eq('id', b.id);
    setBusy(null);
    setConfirmDelete(null);
    if (e) { error(e.message); return; }
    success('Sauvegarde supprimée');
    load();
  };

  const doDownload = async (b: Backup) => {
    setBusy('download');
    const { data, error: e } = await supabase.from('tenant_backups')
      .select('payload,created_at,label')
      .eq('id', b.id)
      .maybeSingle();
    setBusy(null);
    if (e || !data) { error(e?.message || 'Introuvable'); return; }
    const blob = new Blob([JSON.stringify({
      meta: { id: b.id, label: data.label, created_at: data.created_at, tenant: tenant?.name },
      payload: data.payload,
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeLabel = (data.label || 'backup').replace(/[^a-z0-9_-]+/gi, '_');
    a.download = `${tenant?.name?.replace(/[^a-z0-9_-]+/gi, '_') || 'tenant'}_${safeLabel}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveSchedule = async (patch: Partial<Schedule>) => {
    if (!tenant || !schedule) return;
    const next = { ...schedule, ...patch };
    setSchedule(next);
    const enabling = patch.auto_enabled === true && !schedule.auto_enabled;
    const payload: any = {
      tenant_id: tenant.id,
      auto_enabled: next.auto_enabled,
      frequency_hours: next.frequency_hours,
      keep_count: next.keep_count,
    };
    if (enabling) {
      payload.next_run_at = new Date().toISOString();
    } else if (patch.frequency_hours && schedule.last_run_at) {
      payload.next_run_at = new Date(
        new Date(schedule.last_run_at).getTime() + patch.frequency_hours * 3_600_000
      ).toISOString();
    }
    const { error: e } = await supabase
      .from('tenant_backup_settings')
      .upsert(payload, { onConflict: 'tenant_id' });
    if (e) { error(e.message); load(); }
  };

  const onPickFile = () => fileInputRef.current?.click();

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const text = await f.text();
      const json = JSON.parse(text);
      setConfirmImport({ name: f.name, payload: json });
    } catch (err: any) {
      error('Fichier JSON invalide');
    }
  };

  const doImport = async () => {
    if (!confirmImport) return;
    setBusy('import');
    const { error: e } = await supabase.rpc('tenant_restore_from_payload', {
      p_payload: confirmImport.payload,
    });
    setBusy(null);
    setConfirmImport(null);
    if (e) { error(e.message); return; }
    success('Restauration depuis le fichier effectuée');
    load();
  };

  const runNow = async () => {
    setBusy('runNow');
    const { error: e } = await supabase.rpc('tenant_run_due_auto_backup');
    // Force a backup even if schedule not due by creating a manual one with 'auto' label
    if (!e) {
      await supabase.rpc('tenant_create_backup', {
        p_label: `Auto ${new Date().toLocaleString('fr-FR')}`,
        p_auto: true,
      });
    }
    setBusy(null);
    if (e) { error(e.message); return; }
    success('Sauvegarde automatique exécutée');
    load();
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="card p-5">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
            <Database className="w-5 h-5 text-brand-700" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">Sauvegarde & restauration</h3>
            <p className="text-sm text-slate-500 mt-0.5">
              Créez des points de restauration de votre entreprise. Seules vos données sont sauvegardées.
              La restauration et la réinitialisation n'affectent aucun autre tenant.
            </p>
          </div>
        </div>
      </div>

      {/* Create */}
      <div className="card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <h4 className="font-semibold text-slate-900">Créer une sauvegarde manuelle</h4>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            className="input flex-1"
            placeholder="Libellé (optionnel) — ex: Avant mise à jour tarifs"
            value={label}
            onChange={e => setLabel(e.target.value)}
          />
          <button
            onClick={createBackup}
            disabled={busy === 'create'}
            className="btn-icon-primary shrink-0"
            title="Créer la sauvegarde"
          >
            {busy === 'create' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Import from file */}
      <div className="card p-5">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-neutral-50 flex items-center justify-center shrink-0">
            <Upload className="w-5 h-5 text-neutral-700" />
          </div>
          <div className="flex-1">
            <h4 className="font-semibold text-slate-900">Importer une sauvegarde depuis un fichier</h4>
            <p className="text-sm text-slate-600 mt-0.5 leading-relaxed">
              Sélectionnez un fichier <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">.json</code>
              {' '}précédemment téléchargé pour restaurer l'état de votre entreprise. Une sauvegarde de sécurité sera créée automatiquement avant la restauration.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={onFileChosen}
              className="hidden"
            />
            <button
              onClick={onPickFile}
              disabled={busy === 'import'}
              className="btn-icon mt-3"
              title="Choisir un fichier…"
            >
              {busy === 'import' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Schedule */}
      {schedule && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-brand-700" />
              <h4 className="font-semibold text-slate-900">Sauvegarde automatique planifiée</h4>
            </div>
            <button
              onClick={() => saveSchedule({ auto_enabled: !schedule.auto_enabled })}
              className={`h-9 px-3 rounded-xl text-sm font-semibold transition-colors ${
                schedule.auto_enabled
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                  : 'bg-slate-100 text-slate-600 border border-slate-200'
              }`}
            >
              {schedule.auto_enabled ? 'Activée' : 'Désactivée'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Fréquence</label>
              <select
                className="input"
                disabled={!schedule.auto_enabled}
                value={schedule.frequency_hours}
                onChange={e => saveSchedule({ frequency_hours: Number(e.target.value) })}
              >
                {FREQ_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Nombre à conserver</label>
              <input
                type="number"
                min={1}
                max={50}
                className="input"
                disabled={!schedule.auto_enabled}
                value={schedule.keep_count}
                onChange={e => saveSchedule({ keep_count: Math.max(1, Number(e.target.value) || 1) })}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-4 text-xs text-slate-600">
            <div><span className="text-slate-400">Dernière :</span> {fmtDate(schedule.last_run_at)}</div>
            <div><span className="text-slate-400">Prochaine :</span> {fmtDate(schedule.next_run_at)}</div>
          </div>

          <button
            onClick={runNow}
            disabled={busy === 'runNow'}
            className="btn-icon"
            title="Exécuter maintenant"
          >
            {busy === 'runNow' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          </button>
        </div>
      )}

      {/* List */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-semibold text-slate-900">Historique ({backups.length})</h4>
          <button onClick={load} className="btn-icon text-xs" title="Actualiser">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : backups.length === 0 ? (
          <div className="text-center py-8 text-sm text-slate-500">
            Aucune sauvegarde pour l'instant. Créez la première ci-dessus.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {backups.map(b => (
              <div key={b.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`badge ${b.is_auto ? 'bg-neutral-50 text-neutral-700' : 'bg-brand-50 text-brand-700'}`}>
                      {b.is_auto ? 'AUTO' : 'MANUEL'}
                    </span>
                    <div className="font-semibold text-sm text-slate-900 truncate">{b.label}</div>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-3">
                    <span>{fmtDate(b.created_at)}</span>
                    <span>{fmtBytes(b.size_bytes)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => doDownload(b)} className="btn-icon text-xs" title="Télécharger">
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setConfirmRestore(b)}
                    className="btn-icon-success text-xs"
                    title="Restaurer"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setConfirmDelete(b)}
                    className="h-9 w-9 rounded-xl hover:bg-red-50 text-red-500 inline-flex items-center justify-center"
                    title="Supprimer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reset operations */}
      <div className="card p-5 border-amber-200 bg-amber-50/40">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-700" />
          </div>
          <div className="flex-1">
            <h4 className="font-semibold text-slate-900">Réinitialiser les opérations</h4>
            <p className="text-sm text-slate-600 mt-0.5 leading-relaxed">
              Supprime toutes les ventes, commandes, sessions de caisse, mouvements, écritures comptables et notifications.
              <strong className="text-slate-800"> Vos articles, clients, fournisseurs et paramètres sont conservés.</strong>
            </p>
            <button
              onClick={() => setConfirmReset(true)}
              className="btn-icon-danger mt-3"
              title="Réinitialiser les opérations"
            >
              <AlertTriangle className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmRestore}
        title="Restaurer cette sauvegarde ?"
        message={`Toutes les données actuelles du tenant seront remplacées par celles de « ${confirmRestore?.label} ». Cette action est irréversible.`}
        confirmLabel="Restaurer"
        danger
        onClose={() => setConfirmRestore(null)}
        onConfirm={() => confirmRestore && doRestore(confirmRestore)}
      />
      <ConfirmDialog
        open={confirmReset}
        title="Réinitialiser les opérations ?"
        message="Toutes les ventes, commandes et mouvements seront supprimés. Les articles, clients et fournisseurs restent intacts. Pensez à créer une sauvegarde avant."
        confirmLabel="Réinitialiser"
        danger
        onClose={() => setConfirmReset(false)}
        onConfirm={doReset}
      />
      <ConfirmDialog
        open={!!confirmImport}
        title="Importer cette sauvegarde ?"
        message={`Le fichier « ${confirmImport?.name} » remplacera toutes les données actuelles de votre entreprise. Une sauvegarde de sécurité sera créée automatiquement avant.`}
        confirmLabel="Importer et restaurer"
        danger
        onClose={() => setConfirmImport(null)}
        onConfirm={doImport}
      />
      <ConfirmDialog
        open={!!confirmDelete}
        title="Supprimer cette sauvegarde ?"
        message={`La sauvegarde « ${confirmDelete?.label} » sera définitivement supprimée.`}
        confirmLabel="Supprimer"
        danger
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && doDelete(confirmDelete)}
      />
    </div>
  );
}
