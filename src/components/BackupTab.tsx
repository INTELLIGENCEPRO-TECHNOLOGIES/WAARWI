import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Database, Download, RefreshCw, Trash2, Loader2, Clock,
  ShieldCheck, AlertTriangle, Play, RotateCcw, Upload,
  CheckCircle2, XCircle, Lock, Info, FileCheck
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { usePermissions } from '../lib/permissions';
import { ConfirmDialog } from './Modal';

type BackupStatus = 'creating' | 'verified' | 'failed' | 'legacy' | 'incompatible';

type Backup = {
  id: string;
  label: string;
  kind: string;
  is_auto: boolean;
  size_bytes: number;
  created_at: string;
  format_version: number | null;
  status: BackupStatus | null;
  verified_at: string | null;
  global_checksum: string | null;
  row_counts: Record<string, number> | null;
  error_message: string | null;
};

type Schedule = {
  tenant_id: string;
  auto_enabled: boolean;
  frequency_hours: number;
  keep_count: number;
  last_run_at: string | null;
  next_run_at: string | null;
};

type PreflightResult = {
  viable: boolean;
  issues: { code: string; severity: string; message: string; table?: string }[];
  issue_count: number;
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

function totalRows(rc: Record<string, number> | null): number {
  if (!rc) return 0;
  return Object.values(rc).reduce((a, b) => a + b, 0);
}

function StatusBadge({ status }: { status: BackupStatus | null }) {
  if (!status) return null;
  const cfg: Record<string, { bg: string; text: string; label: string; icon: React.ReactNode }> = {
    verified: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Vérifié', icon: <CheckCircle2 className="w-3 h-3" /> },
    creating: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'En cours', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    failed: { bg: 'bg-red-50', text: 'text-red-700', label: 'Échec', icon: <XCircle className="w-3 h-3" /> },
    legacy: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Legacy v1', icon: <AlertTriangle className="w-3 h-3" /> },
    incompatible: { bg: 'bg-red-50', text: 'text-red-700', label: 'Incompatible', icon: <XCircle className="w-3 h-3" /> },
  };
  const c = cfg[status] || cfg.failed;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${c.bg} ${c.text}`}>
      {c.icon}{c.label}
    </span>
  );
}

export function BackupTab() {
  const { tenant } = useApp();
  const toast = useToast();
  const { can } = usePermissions();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [activationEnabled, setActivationEnabled] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState<Backup | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Backup | null>(null);
  const [confirmImport, setConfirmImport] = useState<{ name: string; payload: any } | null>(null);
  const [preflightResult, setPreflightResult] = useState<PreflightResult | null>(null);
  const [preflightTarget, setPreflightTarget] = useState<Backup | null>(null);
  const [label, setLabel] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    const [{ data: b }, { data: s }, { data: act }] = await Promise.all([
      supabase.from('tenant_backups')
        .select('id,label,kind,is_auto,size_bytes,created_at,format_version,status,verified_at,global_checksum,row_counts,error_message')
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false }),
      supabase.from('tenant_backup_settings')
        .select('*')
        .eq('tenant_id', tenant.id)
        .maybeSingle(),
      supabase.from('_br_tenant_activation')
        .select('enabled')
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
    setActivationEnabled(act?.enabled === true);
    setLoading(false);
  }, [tenant]);

  useEffect(() => { load(); }, [load]);

  const createBackup = async () => {
    if (!can('backup_create')) { toast.error('Permission insuffisante'); return; }
    setBusy('create');
    const { data, error: e } = await supabase.rpc('br_create_backup', {
      p_label: label || '',
      p_kind: 'manual',
    });
    setBusy(null);
    if (e) { toast.error(e.message); return; }
    setLabel('');
    const report = data as any;
    toast.success(`Sauvegarde créée — ${report?.total_rows ?? 0} lignes, ${report?.table_count ?? 0} tables`);
    load();
  };

  const runPreflight = async (b: Backup) => {
    setBusy('preflight');
    setPreflightTarget(b);
    setPreflightResult(null);
    const { data, error: e } = await supabase.rpc('br_preflight_restore', { p_backup_id: b.id });
    setBusy(null);
    if (e) { toast.error(e.message); setPreflightTarget(null); return; }
    const result = data as PreflightResult;
    setPreflightResult(result);
    if (result.viable) {
      setConfirmRestore(b);
    }
  };

  const doRestore = async (b: Backup) => {
    if (!can('backup_restore')) { toast.error('Permission insuffisante'); return; }
    setBusy('restore');
    const { data, error: e } = await supabase.rpc('br_restore_backup', { p_backup_id: b.id });
    setBusy(null);
    setConfirmRestore(null);
    setPreflightResult(null);
    setPreflightTarget(null);
    if (e) { toast.error(e.message); return; }
    const report = data as any;
    toast.success(`Restauration réussie — sauvegarde de sécurité: ${report?.safety_backup_id ? 'créée' : 'N/A'}`);
    load();
  };

  const doReset = async () => {
    if (!can('backup_reset_operations')) { toast.error('Permission insuffisante'); return; }
    setBusy('reset');
    const { data, error: e } = await supabase.rpc('br_reset_operations');
    setBusy(null);
    setConfirmReset(false);
    if (e) { toast.error(e.message); return; }
    const report = data as any;
    toast.success(`Opérations réinitialisées — sauvegarde de sécurité: ${report?.safety_backup_id ? 'créée' : 'N/A'}`);
    load();
  };

  const doDelete = async (b: Backup) => {
    if (!can('backup_delete')) { toast.error('Permission insuffisante'); return; }
    setBusy('delete');
    const { error: e } = await supabase.from('tenant_backups').delete().eq('id', b.id);
    setBusy(null);
    setConfirmDelete(null);
    if (e) { toast.error(e.message); return; }
    toast.success('Sauvegarde supprimée');
    load();
  };

  const doDownload = async (b: Backup) => {
    if (!can('backup_download')) { toast.error('Permission insuffisante'); return; }
    setBusy('download');
    const { data, error: e } = await supabase.from('tenant_backups')
      .select('payload,created_at,label,format_version,checksums,global_checksum,row_counts')
      .eq('id', b.id)
      .maybeSingle();
    setBusy(null);
    if (e || !data) { toast.error(e?.message || 'Introuvable'); return; }
    const blob = new Blob([JSON.stringify({
      meta: {
        id: b.id,
        label: data.label,
        created_at: data.created_at,
        tenant: tenant?.name,
        format_version: data.format_version,
        checksums: data.checksums,
        global_checksum: data.global_checksum,
        row_counts: data.row_counts,
      },
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
    if (!can('backup_manage_schedule')) { toast.error('Permission insuffisante'); return; }
    if (!tenant || !schedule) return;
    const next = { ...schedule, ...patch };
    setSchedule(next);
    const enabling = patch.auto_enabled === true && !schedule.auto_enabled;
    const payload: Record<string, unknown> = {
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
    if (e) { toast.error(e.message); load(); }
  };

  const onPickFile = () => fileInputRef.current?.click();

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const text = await f.text();
      const json = JSON.parse(text);
      const payload = json.payload || json;
      if (typeof payload !== 'object' || payload === null) throw new Error('Invalid');
      setConfirmImport({ name: f.name, payload });
    } catch {
      toast.error('Fichier JSON invalide');
    }
  };

  const doImport = async () => {
    if (!can('backup_import')) { toast.error('Permission insuffisante'); return; }
    if (!confirmImport) return;
    setBusy('import');
    const { data, error: e } = await supabase.rpc('br_import_payload', {
      p_payload: confirmImport.payload,
    });
    setBusy(null);
    setConfirmImport(null);
    if (e) { toast.error(e.message); return; }
    const report = data as any;
    toast.success(`Import réussi — sauvegarde de sécurité: ${report?.safety_backup_id ? 'créée' : 'N/A'}`);
    load();
  };

  const runNow = async () => {
    if (!can('backup_create')) { toast.error('Permission insuffisante'); return; }
    setBusy('runNow');
    const { error: e } = await supabase.rpc('br_create_backup', {
      p_label: `Auto ${new Date().toLocaleString('fr-FR')}`,
      p_kind: 'auto',
    });
    setBusy(null);
    if (e) { toast.error(e.message); return; }
    toast.success('Sauvegarde automatique créée');
    load();
  };

  const canRestore = (b: Backup) =>
    b.status === 'verified' && (b.format_version ?? 1) >= 2;

  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="py-4 border-b border-neutral-200">
        <h3 className="text-[14px] font-bold text-neutral-900">Sauvegarde & restauration</h3>
        <p className="text-[11px] text-neutral-500 mt-0.5">
          Créez des points de restauration de votre entreprise. Seules vos données sont sauvegardées.
          La restauration et la réinitialisation n'affectent aucun autre tenant.
        </p>
      </div>

      {/* Activation lock banner */}
      {!activationEnabled && (
        <div className="py-3 px-3 bg-amber-50 border border-amber-200 rounded-md my-3 flex items-start gap-2.5">
          <Lock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-semibold text-amber-800">Verrouillage de sécurité actif</p>
            <p className="text-[11px] text-amber-700 mt-0.5 leading-relaxed">
              Les opérations destructrices (restauration, réinitialisation, import) sont désactivées par défaut.
              Contactez l'administrateur de la plateforme pour activer ces opérations sur votre tenant.
            </p>
          </div>
        </div>
      )}

      {/* Create manual backup */}
      {can('backup_create') && (
        <div className="py-4 border-b border-neutral-200">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="w-4 h-4 text-neutral-400" />
            <h4 className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Créer une sauvegarde manuelle</h4>
          </div>
          <div className="flex items-center gap-2">
            <input
              className="bare-input text-sm py-1.5 flex-1"
              placeholder="Libellé (optionnel) — ex: Avant mise à jour tarifs"
              value={label}
              onChange={e => setLabel(e.target.value)}
            />
            <button
              onClick={createBackup}
              disabled={busy === 'create'}
              className="inline-flex items-center justify-center w-9 h-9 rounded-md bg-neutral-900 text-white hover:bg-neutral-800 transition active:scale-[0.97] disabled:opacity-50 shrink-0"
              title="Créer la sauvegarde"
            >
              {busy === 'create' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      )}

      {/* Import from file */}
      {can('backup_import') && (
        <div className="py-4 border-b border-neutral-200">
          <div className="flex items-center gap-2 mb-2">
            <Upload className="w-4 h-4 text-neutral-400" />
            <h4 className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Importer une sauvegarde depuis un fichier</h4>
          </div>
          <p className="text-[11px] text-neutral-500 leading-relaxed mb-3">
            Sélectionnez un fichier <code className="text-xs">.json</code> précédemment téléchargé pour restaurer l'état de votre entreprise.
            Une sauvegarde de sécurité sera créée automatiquement avant la restauration.
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
            disabled={busy === 'import' || !activationEnabled}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-700 hover:text-neutral-900 transition disabled:opacity-50"
          >
            {busy === 'import' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Choisir un fichier…
          </button>
          {!activationEnabled && (
            <p className="text-[10px] text-amber-600 mt-1 flex items-center gap-1">
              <Lock className="w-3 h-3" /> Verrouillage actif — import désactivé
            </p>
          )}
        </div>
      )}

      {/* Schedule */}
      {can('backup_manage_schedule') && schedule && (
        <div className="py-4 border-b border-neutral-200 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-neutral-400" />
              <h4 className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Sauvegarde automatique planifiée</h4>
            </div>
            <button
              onClick={() => saveSchedule({ auto_enabled: !schedule.auto_enabled })}
              className="shrink-0 relative"
            >
              <div className={`w-9 h-5 rounded-full transition-colors relative ${schedule.auto_enabled ? 'bg-neutral-900' : 'bg-neutral-200'}`}>
                <div className={`absolute top-0.5 bg-white rounded-full h-4 w-4 transition-transform shadow-sm ${schedule.auto_enabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
              </div>
            </button>
          </div>

          <div className={`grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 ${schedule.auto_enabled ? '' : 'opacity-50 pointer-events-none'}`}>
            <div>
              <label className="block text-[11px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Fréquence</label>
              <select
                className="bare-input text-sm py-1.5 w-full"
                disabled={!schedule.auto_enabled}
                value={schedule.frequency_hours}
                onChange={e => saveSchedule({ frequency_hours: Number(e.target.value) })}
              >
                {FREQ_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Nombre à conserver</label>
              <input
                type="number"
                min={1}
                max={50}
                className="bare-input text-sm py-1.5 w-full num"
                disabled={!schedule.auto_enabled}
                value={schedule.keep_count}
                onChange={e => saveSchedule({ keep_count: Math.max(1, Number(e.target.value) || 1) })}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-4 text-[11px] text-neutral-500">
            <div><span className="text-neutral-400">Dernière :</span> {fmtDate(schedule.last_run_at)}</div>
            <div><span className="text-neutral-400">Prochaine :</span> {fmtDate(schedule.next_run_at)}</div>
          </div>

          <button
            onClick={runNow}
            disabled={busy === 'runNow'}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-700 hover:text-neutral-900 transition disabled:opacity-50"
          >
            {busy === 'runNow' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Exécuter maintenant
          </button>
        </div>
      )}

      {/* History */}
      <div className="py-4 border-b border-neutral-200">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Historique ({backups.length})</h4>
          <button onClick={load} className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-500 hover:text-neutral-900 transition">
            <RefreshCw className="w-3.5 h-3.5" />Actualiser
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-neutral-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : backups.length === 0 ? (
          <div className="text-center py-8 text-xs text-neutral-500">
            Aucune sauvegarde pour l'instant. Créez la première ci-dessus.
          </div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {backups.map(b => (
              <div key={b.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                      {b.kind === 'safety' ? 'SÉCURITÉ' : b.is_auto ? 'AUTO' : 'MANUEL'}
                    </span>
                    <StatusBadge status={b.status} />
                    <div className="font-medium text-sm text-neutral-900 truncate">{b.label}</div>
                  </div>
                  <div className="text-[11px] text-neutral-500 mt-0.5 flex items-center gap-3 flex-wrap">
                    <span>{fmtDate(b.created_at)}</span>
                    <span>{fmtBytes(b.size_bytes)}</span>
                    {b.row_counts && <span>{totalRows(b.row_counts).toLocaleString('fr-FR')} lignes</span>}
                    {b.format_version && <span>v{b.format_version}</span>}
                  </div>
                  {b.error_message && (
                    <p className="text-[10px] text-red-600 mt-0.5 truncate">{b.error_message}</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {can('backup_download') && (
                    <button onClick={() => doDownload(b)} disabled={!!busy} className="p-1.5 rounded-md hover:bg-neutral-100 transition-colors disabled:opacity-40" title="Télécharger">
                      <Download className="w-4 h-4 text-neutral-500" />
                    </button>
                  )}
                  {can('backup_restore') && canRestore(b) && (
                    <button
                      onClick={() => runPreflight(b)}
                      disabled={!!busy || !activationEnabled}
                      className="p-1.5 rounded-md hover:bg-neutral-100 transition-colors disabled:opacity-40"
                      title={activationEnabled ? 'Vérifier puis restaurer' : 'Verrouillage actif'}
                    >
                      {busy === 'preflight' && preflightTarget?.id === b.id
                        ? <Loader2 className="w-4 h-4 text-neutral-500 animate-spin" />
                        : <RotateCcw className="w-4 h-4 text-neutral-500" />}
                    </button>
                  )}
                  {can('backup_restore') && !canRestore(b) && b.status === 'legacy' && (
                    <span className="p-1.5 text-amber-500" title="Sauvegarde legacy (v1) — ne peut pas être restaurée via le système v2">
                      <AlertTriangle className="w-4 h-4" />
                    </span>
                  )}
                  {can('backup_delete') && (
                    <button onClick={() => setConfirmDelete(b)} disabled={!!busy} className="p-1.5 rounded-md hover:bg-red-50 text-red-500 transition-colors disabled:opacity-40" title="Supprimer">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reset operations */}
      {can('backup_reset_operations') && (
        <div className="py-4 border-b border-neutral-200">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <h4 className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Réinitialiser les opérations</h4>
          </div>
          <div className="border-l-2 border-amber-400 pl-3">
            <p className="text-[11px] text-neutral-600 leading-relaxed">
              Supprime toutes les ventes, commandes, sessions de caisse, mouvements, écritures comptables et notifications.
              <strong className="text-neutral-800"> Vos articles, clients, fournisseurs et paramètres sont conservés.</strong>
              {' '}Une sauvegarde de sécurité est créée automatiquement avant l'opération.
            </p>
            <button
              onClick={() => setConfirmReset(true)}
              disabled={!activationEnabled || !!busy}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-800 transition disabled:opacity-50"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Réinitialiser les opérations
            </button>
            {!activationEnabled && (
              <p className="text-[10px] text-amber-600 mt-1 flex items-center gap-1">
                <Lock className="w-3 h-3" /> Verrouillage actif — réinitialisation désactivée
              </p>
            )}
          </div>
        </div>
      )}

      {/* Preflight results dialog */}
      {preflightResult && !preflightResult.viable && preflightTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-5">
            <div className="flex items-center gap-2 mb-3">
              <FileCheck className="w-5 h-5 text-red-600" />
              <h3 className="font-bold text-sm text-neutral-900">Vérification pré-restauration échouée</h3>
            </div>
            <p className="text-xs text-neutral-600 mb-3">
              La sauvegarde « {preflightTarget.label} » ne peut pas être restaurée :
            </p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {preflightResult.issues.map((iss, i) => (
                <div key={i} className={`text-[11px] px-2 py-1.5 rounded ${iss.severity === 'fatal' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                  <span className="font-semibold">[{iss.code}]</span> {iss.message}
                </div>
              ))}
            </div>
            <button
              onClick={() => { setPreflightResult(null); setPreflightTarget(null); }}
              className="mt-4 w-full text-center text-xs font-medium text-neutral-700 hover:text-neutral-900 py-2 rounded-md border border-neutral-200 hover:bg-neutral-50 transition"
            >
              Fermer
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmRestore}
        title="Restaurer cette sauvegarde ?"
        message={`La vérification pré-restauration a réussi. Toutes les données actuelles seront remplacées par celles de « ${confirmRestore?.label} ». Une sauvegarde de sécurité sera créée avant l'opération. Cette action est irréversible.`}
        confirmLabel="Restaurer"
        danger
        onClose={() => { setConfirmRestore(null); setPreflightResult(null); setPreflightTarget(null); }}
        onConfirm={() => confirmRestore && doRestore(confirmRestore)}
      />
      <ConfirmDialog
        open={confirmReset}
        title="Réinitialiser les opérations ?"
        message="Toutes les ventes, commandes et mouvements seront supprimés. Les articles, clients et fournisseurs restent intacts. Une sauvegarde de sécurité sera créée automatiquement."
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
