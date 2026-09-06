import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Activity, AlertTriangle, Check, CheckCircle, Clock, Cloud, Database, Download,
  HardDrive, Loader2, Pause, Play, RefreshCw, RotateCcw, Search, Server, Shield,
  ShieldCheck, Upload, X, XCircle, ChevronRight, Settings2, History, Zap,
  Maximize2, Minimize2, MoreHorizontal, Lock,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatDateTime, formatDate } from '../lib/format';
import { useToast } from '../context/ToastContext';
import { ConfirmDialog } from './Modal';

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

const DOT_CLS: Record<string, string> = {
  verified: 'bg-[#0b8f61]',
  completed: 'bg-[#0b8f61]',
  running: 'bg-amber-500 animate-pulse',
  uploading: 'bg-amber-500 animate-pulse',
  queued: 'bg-[#9098a3]',
  failed: 'bg-[#c73737]',
  pending: 'bg-[#9098a3]',
};

function Dot({ status }: { status: string }) {
  return <span className={`inline-block w-[6px] h-[6px] rounded-full shrink-0 ${DOT_CLS[status] || 'bg-[#9098a3]'}`} />;
}

function StatusLabel({ status }: { status: string }) {
  const map: Record<string, string> = {
    verified: 'Vérifiée', completed: 'Terminé', running: 'En cours', uploading: 'Envoi…',
    queued: 'En attente', failed: 'Échoué', pending: 'En attente',
  };
  return <span className="inline-flex items-center gap-[6px] text-[10px] font-semibold"><Dot status={status} />{map[status] || status}</span>;
}

function Spinner() {
  return <div className="flex items-center justify-center py-20"><Loader2 className="w-5 h-5 animate-spin text-[#9098a3]" /></div>;
}

// ============================================================
// ROOT
// ============================================================
export function CentralizedBackups() {
  const [tab, setTab] = useState<Tab>('supervision');
  const [focusMode, setFocusMode] = useState(false);

  const tabs: { k: Tab; l: string }[] = [
    { k: 'supervision', l: 'Supervision' },
    { k: 'tenants', l: 'Tenants' },
    { k: 'executions', l: 'Exécutions' },
    { k: 'lws', l: 'Copie distante LWS' },
    { k: 'settings', l: 'Paramètres' },
  ];

  return (
    <div className={focusMode ? '-mx-5 sm:-mx-8 -mt-5 sm:-mt-8' : ''}>
      {/* Page head */}
      <div className={`${focusMode ? 'px-5 sm:px-8 pt-5 sm:pt-6' : ''}`}>
        <div className="text-[9px] font-bold text-[#9098a3] tracking-[.16em] uppercase mb-2">Système / Sauvegardes</div>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-[clamp(22px,2vw,30px)] font-bold text-[#101318] tracking-tight leading-none">Centre de sauvegarde</h2>
            <p className="text-[11px] text-[#67707c] mt-2 leading-relaxed">Surveillance globale des sauvegardes locales, du chiffrement et des copies distantes LWS.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFocusMode(!focusMode)}
              className="h-[34px] px-3 border border-[#cfd3d9] bg-white text-[10px] font-semibold text-[#101318] inline-flex items-center gap-[7px] hover:bg-[#f7f8f9] transition-colors"
            >
              {focusMode ? <Minimize2 className="w-[14px] h-[14px]" /> : <Maximize2 className="w-[14px] h-[14px]" />}
              {focusMode ? 'Quitter supervision' : 'Mode supervision'}
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <nav className={`flex items-center gap-6 border-b border-[#e5e7eb] mt-6 overflow-x-auto ${focusMode ? 'px-5 sm:px-8' : ''}`}>
        {tabs.map(t => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={`relative h-10 text-[11px] font-semibold whitespace-nowrap transition-colors ${
              tab === t.k ? 'text-[#101318]' : 'text-[#7c838d] hover:text-[#101318]'
            }`}
          >
            {t.l}
            {tab === t.k && <span className="absolute left-0 right-0 bottom-[-1px] h-[2px] bg-[#101318]" />}
          </button>
        ))}
      </nav>

      {/* Views */}
      <div className={focusMode ? 'px-5 sm:px-8 pb-8' : ''}>
        {tab === 'supervision' && <SupervisionTab />}
        {tab === 'tenants' && <TenantsTab />}
        {tab === 'executions' && <HistoryTab />}
        {tab === 'lws' && <OffsiteTab />}
        {tab === 'settings' && <SettingsTab />}
      </div>
    </div>
  );
}

// ============================================================
// SUPERVISION TAB
// ============================================================
function SupervisionTab() {
  const [data, setData] = useState<any>(null);
  const [offsiteSummary, setOffsiteSummary] = useState<any>(null);
  const [offsiteConfig, setOffsiteConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, s, c] = await Promise.all([
        callScheduler('dashboard_summary'),
        callOffsite('summary'),
        callOffsite('get_config'),
      ]);
      setData(d);
      setOffsiteSummary(s);
      setOffsiteConfig(c);
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    intervalRef.current = setInterval(() => {
      if (!document.hidden) load();
    }, 60000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [load]);

  if (loading) return <Spinner />;
  if (!data) return null;

  const cronStatus = data.cron_status as { exists: boolean; active?: boolean; schedule?: string; error?: string | null } | undefined;
  const cronError = cronStatus?.error ?? null;
  const cronReady = !!cronStatus?.exists && !!cronStatus?.active && !cronError;
  const cronSecretOk = !!data.cron_secret_configured;
  const planningOk = data.policy?.enabled && cronReady && cronSecretOk;

  const totalTenants = data.total_tenants || 0;
  const protectedTenants = data.protected_tenants || 0;
  const unprotected = Math.max(0, totalTenants - protectedTenants);
  const coveragePct = totalTenants > 0 ? Math.round((protectedTenants / totalTenants) * 100) : 0;
  const lastRun = data.last_run;

  const offsiteCfg = offsiteConfig?.config;
  const offsiteCron = offsiteConfig?.cron_status as { exists?: boolean; active?: boolean; error?: string | null } | undefined;
  const offsiteCronReady = !!offsiteCron?.exists && !!offsiteCron?.active && !offsiteCron?.error;
  const secrets = offsiteConfig?.secrets_configured || {};
  const allSecretsOk = secrets.LWS_WEBDAV_URL && secrets.LWS_WEBDAV_USERNAME && secrets.LWS_WEBDAV_PASSWORD && secrets.BACKUP_ENCRYPTION_KEY_B64 && secrets.BACKUP_ENCRYPTION_KEY_ID && secrets.OFFSITE_CRON_SECRET;
  const offsiteOk = offsiteCfg?.enabled && allSecretsOk && offsiteCronReady;

  const globalOk = planningOk && unprotected === 0;
  const globalState = globalOk ? 'Nominal' : unprotected > 0 ? 'Dégradé' : 'Non configuré';
  const globalCls = globalOk ? 'text-[#0b8f61]' : unprotected > 0 ? 'text-[#b66a06]' : 'text-[#67707c]';

  const queuedCount = offsiteSummary?.total_queued ?? 0;
  const failedCount = offsiteSummary?.total_failed ?? 0;
  const verifiedCount = offsiteSummary?.total_verified ?? 0;
  const incidents = failedCount + (unprotected > 0 ? unprotected : 0);

  return (
    <div>
      {/* Telemetry band */}
      <div className="grid grid-cols-2 lg:grid-cols-5 border-b border-[#e5e7eb]">
        <TelemetryCell label="État global" dotColor={globalOk ? '#0b8f61' : unprotected > 0 ? '#b66a06' : '#9098a3'}>
          <div className={`text-[22px] font-bold tracking-tight ${globalCls}`}>{globalState}</div>
          <div className="text-[9px] text-[#9098a3] mt-1">{globalOk ? 'Tous les services répondent' : 'Vérifier la configuration'}</div>
        </TelemetryCell>
        <TelemetryCell label="Couverture">
          <div className="text-[22px] font-bold tracking-tight">{protectedTenants} / {totalTenants} <span className="text-[10px] font-medium text-[#67707c]">tenants</span></div>
          <div className={`text-[9px] mt-1 ${coveragePct === 100 ? 'text-[#0b8f61]' : 'text-[#b66a06]'}`}>{coveragePct} % protégés</div>
        </TelemetryCell>
        <TelemetryCell label="Dernier cycle">
          {lastRun ? (
            <>
              <div className="text-[22px] font-bold tracking-tight">{lastRun.tenants_succeeded ?? 0} / {(lastRun.tenants_succeeded ?? 0) + (lastRun.tenants_failed ?? 0)} <span className="text-[10px] font-medium text-[#67707c]">réussis</span></div>
              <div className="text-[9px] text-[#9098a3] mt-1">{lastRun.started_at ? formatDateTime(lastRun.started_at) : '—'}</div>
            </>
          ) : (
            <div className="text-[13px] text-[#9098a3]">Aucun cycle</div>
          )}
        </TelemetryCell>
        <TelemetryCell label="Copie LWS">
          <div className="text-[22px] font-bold tracking-tight">{verifiedCount} <span className="text-[10px] font-medium text-[#67707c]">vérifiées</span></div>
          <div className="text-[9px] text-[#9098a3] mt-1">{offsiteOk ? 'AES-256-GCM' : 'Non configuré'}</div>
        </TelemetryCell>
        <TelemetryCell label="Incidents ouverts">
          <div className={`text-[22px] font-bold tracking-tight ${incidents > 0 ? 'text-[#c73737]' : ''}`}>{incidents}</div>
          <div className="text-[9px] text-[#9098a3] mt-1">{incidents === 0 ? 'Aucune action requise' : `${failedCount} échecs · ${unprotected} non protégés`}</div>
        </TelemetryCell>
      </div>

      {/* Control grid: primary + rail */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] min-h-[400px]">
        <div className="pr-0 xl:pr-7 pt-6">
          <SupTenantTable load={load} />
        </div>
        <aside className="border-t xl:border-t-0 xl:border-l border-[#e5e7eb] pt-6 xl:pl-7 mt-6 xl:mt-0">
          <HealthRail
            planningOk={planningOk}
            cronReady={cronReady}
            cronSecretOk={cronSecretOk}
            offsiteOk={offsiteOk}
            allSecretsOk={allSecretsOk}
            queuedCount={queuedCount}
            policy={data.policy}
            totalTenants={totalTenants}
          />
        </aside>
      </div>
    </div>
  );
}

function TelemetryCell({ label, children, dotColor }: { label: string; children: React.ReactNode; dotColor?: string }) {
  return (
    <div className="py-5 pr-5 first:pl-0 [&:not(:first-child)]:pl-5 [&:not(:first-child)]:border-l border-[#e5e7eb]">
      <div className="flex items-center gap-[7px] text-[9px] font-bold text-[#67707c] tracking-[.08em] uppercase">
        {dotColor && <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: dotColor }} />}
        {label}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function SupTenantTable({ load }: { load: () => void }) {
  const [tenants, setTenants] = useState<any[]>([]);
  const [lwsMap, setLwsMap] = useState<Record<string, any>>({});
  const [tLoading, setTLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'warning' | 'error'>('all');
  const [selectedTenant, setSelectedTenant] = useState<any>(null);
  const [confirmBackup, setConfirmBackup] = useState<any>(null);
  const [backingUp, setBackingUp] = useState<string | null>(null);
  const toast = useToast();

  const loadTenants = useCallback(async () => {
    try {
      const [tRes, txRes] = await Promise.all([
        callScheduler('list_tenants_backup_status'),
        callOffsite('list_transfers', { limit: 200 }),
      ]);
      setTenants(tRes.tenants || []);
      const map: Record<string, any> = {};
      for (const tx of (txRes.transfers || [])) {
        if (!map[tx.tenant_id] || tx.queued_at > map[tx.tenant_id].queued_at) map[tx.tenant_id] = tx;
      }
      setLwsMap(map);
    } catch (e: any) { toast.error(e.message); }
    finally { setTLoading(false); }
  }, []);

  useEffect(() => { loadTenants(); }, [loadTenants]);

  const handleBackupNow = async (tenant: any) => {
    setBackingUp(tenant.id);
    try {
      await callScheduler('backup_now', { tenant_id: tenant.id });
      toast.success(`Sauvegarde de ${tenant.name} lancée`);
      setTimeout(() => { loadTenants(); load(); }, 2000);
    } catch (e: any) { toast.error(e.message); }
    finally { setBackingUp(null); setConfirmBackup(null); }
  };

  const toggleSuspend = async (tenant: any) => {
    const current = tenant.override?.suspended;
    try {
      await callScheduler('set_tenant_override', { tenant_id: tenant.id, suspended: !current, notes: tenant.override?.notes || null });
      toast.success(current ? `${tenant.name} réactivé` : `${tenant.name} suspendu`);
      loadTenants();
    } catch (e: any) { toast.error(e.message); }
  };

  if (tLoading) return <Spinner />;

  const warningCount = tenants.filter(t => !t.last_backup && t.is_active && !t.override?.suspended).length;
  const errorCount = tenants.filter(t => t.last_backup?.status === 'failed').length;

  const filtered = tenants.filter(t => {
    if (filter === 'warning') return !t.last_backup && t.is_active && !t.override?.suspended;
    if (filter === 'error') return t.last_backup?.status === 'failed';
    return true;
  });

  return (
    <>
      <div className="flex items-end justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h3 className="text-[12px] font-bold text-[#101318] tracking-tight">Couverture des tenants</h3>
          <div className="text-[9px] text-[#9098a3] mt-1">Dernier point de contrôle</div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            {(['all', 'warning', 'error'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-[9px] font-semibold pb-0.5 border-b transition-colors ${
                  filter === f ? 'text-[#101318] border-[#101318]' : 'text-[#9098a3] border-transparent hover:text-[#101318]'
                }`}
              >
                {f === 'all' ? `Tous ${tenants.length}` : f === 'warning' ? `À surveiller ${warningCount}` : `Échecs ${errorCount}`}
              </button>
            ))}
          </div>
          <button onClick={() => { setTLoading(true); loadTenants(); }} className="text-[#67707c] hover:text-[#101318]">
            <RefreshCw className="w-[15px] h-[15px]" />
          </button>
        </div>
      </div>

      <table className="w-full border-collapse text-[10px]">
        <thead>
          <tr className="border-t border-b border-[#e5e7eb]">
            <th className="text-left py-2 pr-2 text-[8px] font-bold text-[#9098a3] tracking-[.1em] uppercase">Tenant</th>
            <th className="text-left py-2 pr-2 text-[8px] font-bold text-[#9098a3] tracking-[.1em] uppercase hidden md:table-cell">Dernière sauvegarde</th>
            <th className="text-left py-2 pr-2 text-[8px] font-bold text-[#9098a3] tracking-[.1em] uppercase hidden lg:table-cell">Volume</th>
            <th className="text-left py-2 pr-2 text-[8px] font-bold text-[#9098a3] tracking-[.1em] uppercase hidden lg:table-cell">Copie LWS</th>
            <th className="text-right py-2 text-[8px] font-bold text-[#9098a3] tracking-[.1em] uppercase w-8"></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(t => {
            const lws = lwsMap[t.id];
            const suspended = t.override?.suspended;
            const hasBackup = !!t.last_backup;
            const dotStatus = suspended ? 'queued' : !hasBackup ? 'failed' : t.last_backup.status;
            return (
              <tr key={t.id} className="border-b border-[#edf0f2] hover:bg-[#fafbfb] transition-colors">
                <td className="py-2 pr-2">
                  <div className="flex items-center gap-[10px] min-w-0">
                    <Dot status={dotStatus} />
                    <div className="min-w-0">
                      <div className="font-semibold text-[10px] truncate">{t.name}</div>
                      <div className="text-[8px] text-[#9098a3] mt-0.5">{suspended ? 'Suspendu' : t.is_active ? 'Actif' : 'Inactif'}</div>
                    </div>
                  </div>
                </td>
                <td className="py-2 pr-2 hidden md:table-cell">
                  {hasBackup ? (
                    <>
                      <StatusLabel status={t.last_backup.status} />
                      <div className="text-[8px] text-[#9098a3] mt-0.5">{formatDateTime(t.last_backup.created_at)}</div>
                    </>
                  ) : <span className="text-[#9098a3]">Aucune</span>}
                </td>
                <td className="py-2 pr-2 hidden lg:table-cell">
                  {hasBackup ? (
                    <>
                      <div className="font-semibold">{formatBytes(t.last_backup.size_bytes)}</div>
                    </>
                  ) : '—'}
                </td>
                <td className="py-2 pr-2 hidden lg:table-cell">
                  {lws ? <StatusLabel status={lws.status} /> : <span className="text-[#9098a3]">—</span>}
                </td>
                <td className="py-2 text-right">
                  <button onClick={() => setSelectedTenant(t)} className="p-1 text-[#9098a3] hover:text-[#101318]">
                    <MoreHorizontal className="w-[15px] h-[15px]" />
                  </button>
                </td>
              </tr>
            );
          })}
          {filtered.length === 0 && (
            <tr><td colSpan={5} className="py-8 text-center text-[#9098a3]">Aucun tenant ne correspond au filtre</td></tr>
          )}
        </tbody>
      </table>
      <div className="flex items-center justify-between text-[8px] text-[#9098a3] mt-2">
        <span>{filtered.length} tenant{filtered.length > 1 ? 's' : ''} affiché{filtered.length > 1 ? 's' : ''} sur {tenants.length}</span>
      </div>

      {selectedTenant && (
        <TenantDrawer
          tenant={selectedTenant}
          lws={lwsMap[selectedTenant.id]}
          onClose={() => setSelectedTenant(null)}
          onBackup={() => { setConfirmBackup(selectedTenant); }}
          onSuspend={() => { toggleSuspend(selectedTenant); setSelectedTenant(null); }}
        />
      )}

      {confirmBackup && (
        <ConfirmDialog
          open={true}
          layer="top"
          title={`Sauvegarder ${confirmBackup.name} ?`}
          message="Un cycle de sauvegarde sera lancé pour ce tenant uniquement."
          confirmLabel={backingUp ? 'Lancement…' : 'Confirmer'}
          onConfirm={() => handleBackupNow(confirmBackup)}
          onClose={() => setConfirmBackup(null)}
        />
      )}
    </>
  );
}

function HealthRail({ planningOk, cronReady, cronSecretOk, offsiteOk, allSecretsOk, queuedCount, policy, totalTenants }: {
  planningOk: boolean; cronReady: boolean; cronSecretOk: boolean; offsiteOk: boolean; allSecretsOk: boolean; queuedCount: number; policy: any; totalTenants: number;
}) {
  const [countdown, setCountdown] = useState('');

  useEffect(() => {
    function calc() {
      const now = new Date();
      const tz = policy?.timezone || 'Africa/Dakar';
      try {
        const parts = new Intl.DateTimeFormat('en-CA', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: tz }).formatToParts(now);
        const h = Number(parts.find(p => p.type === 'hour')?.value || 0);
        const m = Number(parts.find(p => p.type === 'minute')?.value || 0);
        const s = Number(parts.find(p => p.type === 'second')?.value || 0);
        const elapsed = h * 3600 + m * 60 + s;
        let remaining = 2 * 3600 - elapsed;
        if (remaining <= 0) remaining += 86400;
        const rh = Math.floor(remaining / 3600);
        const rm = Math.floor((remaining % 3600) / 60);
        setCountdown(`dans ${rh} h ${String(rm).padStart(2, '0')} min · ${totalTenants} tenants planifiés`);
      } catch { setCountdown('—'); }
    }
    calc();
    const id = setInterval(calc, 30000);
    return () => clearInterval(id);
  }, [policy, totalTenants]);

  const checks = [
    { label: 'Planificateur', ok: planningOk, val: planningOk ? 'Actif' : 'Inactif' },
    { label: 'Secret cron', ok: cronSecretOk, val: cronSecretOk ? 'Configuré' : 'Manquant' },
    { label: 'Chiffrement', ok: allSecretsOk, val: allSecretsOk ? 'AES-256-GCM' : 'Non configuré' },
    { label: 'WebDAV LWS', ok: offsiteOk, val: offsiteOk ? 'Connecté' : 'Inactif' },
    { label: 'File distante', ok: true, val: `${queuedCount} attente` },
  ];

  const chainOk = planningOk && offsiteOk;

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[8px] font-bold text-[#9098a3] tracking-[.13em] uppercase">Santé du système</div>
        <div className="flex items-center justify-between mt-2 text-[12px] font-bold">
          <span>Chaîne de protection</span>
          <span className={`inline-flex items-center gap-[6px] text-[9px] font-semibold ${chainOk ? 'text-[#0b8f61]' : 'text-[#b66a06]'}`}>
            <Dot status={chainOk ? 'verified' : 'queued'} />
            {chainOk ? 'Opérationnelle' : 'Incomplète'}
          </span>
        </div>
        <div className="mt-4 space-y-0">
          {checks.map(c => (
            <div key={c.label} className="grid grid-cols-[1fr_auto] gap-3 items-center py-2 border-b border-[#f0f1f3] last:border-0">
              <span className="flex items-center gap-2 text-[9px] text-[#67707c]">
                <Dot status={c.ok ? 'verified' : 'queued'} />
                {c.label}
              </span>
              <span className={`text-[9px] font-semibold text-right ${c.ok ? 'text-[#0b8f61]' : 'text-[#101318]'}`}>{c.val}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-[#e5e7eb] pt-6">
        <div className="text-[8px] font-bold text-[#9098a3] tracking-[.13em] uppercase">Prochain cycle automatique</div>
        <div className="mt-3">
          <div className="flex items-baseline gap-2">
            <span className="text-[24px] font-bold tracking-tight">02:00</span>
            <span className="text-[10px] text-[#67707c]">{policy?.timezone || 'Africa/Dakar'}</span>
          </div>
          <div className="text-[9px] text-[#9098a3] mt-1">{countdown}</div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// TENANT DRAWER
// ============================================================
function TenantDrawer({ tenant, lws, onClose, onBackup, onSuspend }: {
  tenant: any; lws?: any; onClose: () => void; onBackup: () => void; onSuspend: () => void;
}) {
  const [backups, setBackups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingLws, setSendingLws] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    (async () => {
      try {
        const d = await callScheduler('tenant_backup_history', { tenant_id: tenant.id, limit: 30 });
        setBackups(d.backups || []);
      } catch (e: any) { toast.error(e.message); }
      finally { setLoading(false); }
    })();
  }, [tenant.id]);

  const sendToLws = async (backupId: string) => {
    setSendingLws(backupId);
    try {
      const r = await callOffsite('queue_transfer', { backup_id: backupId });
      toast.success(r.already_exists ? 'Transfert déjà en file' : 'Transfert ajouté à la file');
    } catch (e: any) { toast.error(e.message); }
    finally { setSendingLws(null); }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/20" onClick={onClose} />
      <aside className="fixed top-0 right-0 bottom-0 w-[min(420px,94vw)] bg-white z-[51] shadow-[0_20px_70px_rgba(16,19,24,.12)] overflow-y-auto">
        <div className="p-7">
          {/* Header */}
          <div className="flex justify-between items-start pb-5 border-b border-[#e5e7eb]">
            <div>
              <h2 className="text-[18px] font-bold tracking-tight">{tenant.name}</h2>
              <p className="text-[9px] text-[#9098a3] mt-1">Détail de la protection du tenant</p>
            </div>
            <button onClick={onClose} className="p-1 text-[#67707c] hover:text-[#101318]"><X className="w-[17px] h-[17px]" /></button>
          </div>

          {/* Current state */}
          <div className="mt-6">
            <div className="text-[10px] font-bold text-[#9098a3] tracking-[.09em] uppercase mb-2">État actuel</div>
            <div className="space-y-0">
              <KVRow k="Sauvegarde locale" v={tenant.last_backup ? 'Vérifiée' : 'Aucune'} ok={!!tenant.last_backup} />
              <KVRow k="Copie distante" v={lws ? (lws.status === 'verified' ? 'Synchronisée' : lws.status) : 'Aucune'} ok={lws?.status === 'verified'} />
              <KVRow k="Dernière exécution" v={tenant.last_backup?.created_at ? formatDateTime(tenant.last_backup.created_at) : '—'} />
              <KVRow k="Volume protégé" v={tenant.last_backup ? formatBytes(tenant.last_backup.size_bytes) : '—'} />
              <KVRow k="Statut" v={tenant.override?.suspended ? 'Suspendu' : tenant.is_active ? 'Actif' : 'Inactif'} />
            </div>
          </div>

          {/* Backups list */}
          <div className="mt-6">
            <div className="text-[10px] font-bold text-[#9098a3] tracking-[.09em] uppercase mb-2">Historique des sauvegardes</div>
            {loading ? <Spinner /> : backups.length === 0 ? (
              <div className="text-[10px] text-[#9098a3] py-4">Aucune sauvegarde enregistrée</div>
            ) : (
              <div className="border-l border-[#cfd3d9] ml-[3px] space-y-0">
                {backups.slice(0, 10).map(b => (
                  <div key={b.id} className="relative pl-4 pb-4">
                    <span className={`absolute left-[-3.5px] top-[3px] w-[6px] h-[6px] rounded-full ${DOT_CLS[b.status] || 'bg-[#9098a3]'}`} />
                    <div className="text-[9px] font-semibold">{b.label || b.kind}</div>
                    <div className="text-[8px] text-[#9098a3] mt-1">
                      {formatDateTime(b.created_at)} · {formatBytes(b.size_bytes)} · {formatRowCount(b.row_counts)} lignes
                    </div>
                    {b.status === 'verified' && (b.format_version ?? 0) >= 2 && (
                      <button
                        onClick={() => sendToLws(b.id)}
                        disabled={sendingLws === b.id}
                        className="mt-1.5 inline-flex items-center gap-1 text-[8px] font-semibold text-[#67707c] hover:text-[#101318] disabled:opacity-50"
                      >
                        {sendingLws === b.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Cloud className="w-3 h-3" />}
                        Envoyer vers LWS
                      </button>
                    )}
                    {b.error_message && <div className="text-[8px] text-[#c73737] mt-0.5">{b.error_message}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="mt-6 space-y-2">
            <button
              onClick={onBackup}
              className="w-full h-[34px] bg-[#101318] text-white text-[10px] font-semibold inline-flex items-center justify-center gap-[7px] hover:bg-[#292e35] transition-colors"
            >
              <Play className="w-[14px] h-[14px]" />
              Sauvegarder ce tenant
            </button>
            <button
              onClick={onSuspend}
              className="w-full h-[34px] border border-[#cfd3d9] bg-white text-[10px] font-semibold inline-flex items-center justify-center gap-[7px] hover:bg-[#f7f8f9] transition-colors"
            >
              {tenant.override?.suspended ? <Play className="w-[14px] h-[14px]" /> : <Pause className="w-[14px] h-[14px]" />}
              {tenant.override?.suspended ? 'Réactiver' : 'Suspendre'}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

function KVRow({ k, v, ok }: { k: string; v: string; ok?: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-4 py-3 border-b border-[#edf0f2] text-[10px]">
      <span className="text-[#67707c]">{k}</span>
      <span className={`font-semibold text-right ${ok === true ? 'text-[#0b8f61]' : ok === false ? 'text-[#c73737]' : ''}`}>{v}</span>
    </div>
  );
}

// ============================================================
// TENANTS TAB
// ============================================================
function TenantsTab() {
  const [tenants, setTenants] = useState<any[]>([]);
  const [lwsMap, setLwsMap] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'protected' | 'unprotected' | 'suspended'>('all');
  const [selectedTenant, setSelectedTenant] = useState<any>(null);
  const [confirmBackup, setConfirmBackup] = useState<any>(null);
  const [backingUp, setBackingUp] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [tRes, txRes] = await Promise.all([
        callScheduler('list_tenants_backup_status'),
        callOffsite('list_transfers', { limit: 200 }),
      ]);
      setTenants(tRes.tenants || []);
      const map: Record<string, any> = {};
      for (const tx of (txRes.transfers || [])) {
        if (!map[tx.tenant_id] || tx.queued_at > map[tx.tenant_id].queued_at) map[tx.tenant_id] = tx;
      }
      setLwsMap(map);
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleBackupNow = async (tenant: any) => {
    setBackingUp(tenant.id);
    try {
      await callScheduler('backup_now', { tenant_id: tenant.id });
      toast.success(`Sauvegarde de ${tenant.name} lancée`);
      setTimeout(load, 2000);
    } catch (e: any) { toast.error(e.message); }
    finally { setBackingUp(null); setConfirmBackup(null); }
  };

  const toggleSuspend = async (tenant: any) => {
    try {
      await callScheduler('set_tenant_override', { tenant_id: tenant.id, suspended: !tenant.override?.suspended, notes: tenant.override?.notes || null });
      toast.success(tenant.override?.suspended ? `${tenant.name} réactivé` : `${tenant.name} suspendu`);
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  if (loading) return <Spinner />;

  const q = search.toLowerCase();
  const filtered = tenants.filter(t => {
    if (q && !t.name.toLowerCase().includes(q)) return false;
    if (filter === 'protected') return !!t.last_backup;
    if (filter === 'unprotected') return !t.last_backup && t.is_active && !t.override?.suspended;
    if (filter === 'suspended') return !!t.override?.suspended;
    return true;
  });

  const protectedCount = tenants.filter(t => t.last_backup).length;

  return (
    <div className="pt-6">
      <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
        <div>
          <h3 className="text-[16px] font-bold tracking-tight">Tenants protégés</h3>
          <p className="text-[10px] text-[#67707c] mt-1">État détaillé, dernière sauvegarde et disponibilité de chaque copie distante.</p>
        </div>
        <div className="flex items-center gap-3 border-b border-[#cfd3d9] pb-0.5 text-[#9098a3]">
          <Search className="w-[14px] h-[14px]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher un tenant…"
            className="border-0 outline-0 bg-transparent text-[10px] text-[#101318] placeholder-[#a4aab2] w-[180px]"
          />
        </div>
      </div>

      <div className="flex items-center gap-4 mb-4">
        {(['all', 'protected', 'unprotected', 'suspended'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-[9px] font-semibold pb-0.5 border-b transition-colors ${
              filter === f ? 'text-[#101318] border-[#101318]' : 'text-[#9098a3] border-transparent'
            }`}
          >
            {f === 'all' ? `Tous ${tenants.length}` : f === 'protected' ? `Protégés ${protectedCount}` : f === 'unprotected' ? `Non protégés ${tenants.length - protectedCount}` : `Suspendus ${tenants.filter(t => t.override?.suspended).length}`}
          </button>
        ))}
      </div>

      <table className="w-full border-collapse text-[10px]">
        <thead>
          <tr className="border-t border-b border-[#e5e7eb]">
            <th className="text-left py-2 text-[8px] font-bold text-[#9098a3] tracking-[.1em] uppercase">Tenant</th>
            <th className="text-left py-2 text-[8px] font-bold text-[#9098a3] tracking-[.1em] uppercase hidden md:table-cell">Dernier point</th>
            <th className="text-left py-2 text-[8px] font-bold text-[#9098a3] tracking-[.1em] uppercase hidden lg:table-cell">Intégrité</th>
            <th className="text-left py-2 text-[8px] font-bold text-[#9098a3] tracking-[.1em] uppercase hidden lg:table-cell">LWS</th>
            <th className="text-right py-2 w-8"></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(t => {
            const lws = lwsMap[t.id];
            const suspended = t.override?.suspended;
            return (
              <tr key={t.id} className="border-b border-[#edf0f2] hover:bg-[#fafbfb] transition-colors">
                <td className="py-2.5">
                  <div className="flex items-center gap-[10px]">
                    <Dot status={suspended ? 'queued' : !t.last_backup ? 'failed' : t.last_backup.status} />
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{t.name}</div>
                      <div className="text-[8px] text-[#9098a3] mt-0.5">{suspended ? 'Suspendu' : t.is_active ? 'Actif' : 'Inactif'}</div>
                    </div>
                  </div>
                </td>
                <td className="py-2.5 hidden md:table-cell">{t.last_backup?.created_at ? formatDateTime(t.last_backup.created_at) : '—'}</td>
                <td className="py-2.5 hidden lg:table-cell">{t.last_backup ? <StatusLabel status={t.last_backup.status} /> : <span className="text-[#9098a3]">—</span>}</td>
                <td className="py-2.5 hidden lg:table-cell">{lws ? <StatusLabel status={lws.status} /> : <span className="text-[#9098a3]">—</span>}</td>
                <td className="py-2.5 text-right">
                  <button onClick={() => setSelectedTenant(t)} className="p-1 text-[#9098a3] hover:text-[#101318]">
                    <MoreHorizontal className="w-[15px] h-[15px]" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex items-center justify-between text-[8px] text-[#9098a3] mt-2">
        <span>{filtered.length} tenants visibles sur {tenants.length}</span>
        <span>Couverture globale : <strong className={protectedCount === tenants.length ? 'text-[#0b8f61]' : 'text-[#b66a06]'}>{tenants.length > 0 ? Math.round((protectedCount / tenants.length) * 100) : 0} %</strong></span>
      </div>

      {selectedTenant && (
        <TenantDrawer
          tenant={selectedTenant}
          lws={lwsMap[selectedTenant.id]}
          onClose={() => setSelectedTenant(null)}
          onBackup={() => { setConfirmBackup(selectedTenant); }}
          onSuspend={() => { toggleSuspend(selectedTenant); setSelectedTenant(null); }}
        />
      )}
      {confirmBackup && (
        <ConfirmDialog
          open={true}
          layer="top"
          title={`Sauvegarder ${confirmBackup.name} ?`}
          message="Un cycle sera lancé pour ce tenant."
          confirmLabel={backingUp ? 'Lancement…' : 'Confirmer'}
          onConfirm={() => handleBackupNow(confirmBackup)}
          onClose={() => setConfirmBackup(null)}
        />
      )}
    </div>
  );
}

// ============================================================
// HISTORY TAB (Executions)
// ============================================================
function HistoryTab() {
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [runDetail, setRunDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const toast = useToast();

  useEffect(() => {
    (async () => {
      try {
        const d = await callScheduler('list_runs', { limit: 30 });
        setRuns(d.runs || []);
      } catch (e: any) { toast.error(e.message); }
      finally { setLoading(false); }
    })();
  }, []);

  const loadRunDetail = async (runId: string) => {
    setDetailLoading(true);
    try {
      const d = await callScheduler('get_run_detail', { run_id: runId });
      setRunDetail(d);
    } catch (e: any) { toast.error(e.message); }
    finally { setDetailLoading(false); }
  };

  if (loading) return <Spinner />;

  return (
    <div className="pt-6">
      <div className="mb-5">
        <h3 className="text-[16px] font-bold tracking-tight">Journal d'exécution</h3>
        <p className="text-[10px] text-[#67707c] mt-1">Traçabilité des cycles automatiques et manuels.</p>
      </div>

      <div className="border-t border-[#e5e7eb]">
        {/* Header row */}
        <div className="grid grid-cols-[1.2fr_.9fr_.9fr_auto] gap-4 items-center min-h-[33px] text-[8px] font-bold text-[#9098a3] tracking-[.09em] uppercase">
          <span>Démarrage</span>
          <span className="hidden sm:block">Origine</span>
          <span>Résultat</span>
          <span className="text-right">Durée</span>
        </div>
        {runs.map(run => {
          const total = (run.tenants_succeeded ?? 0) + (run.tenants_failed ?? 0);
          const duration = run.started_at && run.finished_at ? Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000) : null;
          const durationStr = duration !== null ? duration >= 60 ? `${Math.floor(duration / 60)} min ${duration % 60} s` : `${duration} s` : '—';
          return (
            <button
              key={run.id}
              onClick={() => { setSelectedRun(run); loadRunDetail(run.id); }}
              className="grid grid-cols-[1.2fr_.9fr_.9fr_auto] gap-4 items-center min-h-[51px] border-b border-[#edf0f2] text-[10px] text-left hover:bg-[#fafbfb] transition-colors w-full"
            >
              <span>
                <strong>{formatDateTime(run.started_at)}</strong>
                <span className="block text-[8px] text-[#9098a3] mt-0.5">{run.id?.slice(0, 8)}</span>
              </span>
              <span className="hidden sm:block text-[#67707c]">{run.triggered_by === 'cron' ? 'Automatique · cron' : 'Manuel · administrateur'}</span>
              <span><StatusLabel status={run.status} /> <span className="ml-1 text-[#67707c]">{run.tenants_succeeded ?? 0} / {total}</span></span>
              <strong className="text-right">{durationStr}</strong>
            </button>
          );
        })}
        {runs.length === 0 && (
          <div className="py-8 text-center text-[10px] text-[#9098a3]">Aucune exécution enregistrée</div>
        )}
      </div>

      {/* Run detail drawer */}
      {selectedRun && (
        <>
          <div className="fixed inset-0 z-50 bg-black/20" onClick={() => { setSelectedRun(null); setRunDetail(null); }} />
          <aside className="fixed top-0 right-0 bottom-0 w-[min(420px,94vw)] bg-white z-[51] shadow-[0_20px_70px_rgba(16,19,24,.12)] overflow-y-auto">
            <div className="p-7">
              <div className="flex justify-between items-start pb-5 border-b border-[#e5e7eb]">
                <div>
                  <h2 className="text-[18px] font-bold tracking-tight">Détail du cycle</h2>
                  <p className="text-[9px] text-[#9098a3] mt-1">{formatDateTime(selectedRun.started_at)}</p>
                </div>
                <button onClick={() => { setSelectedRun(null); setRunDetail(null); }} className="p-1 text-[#67707c] hover:text-[#101318]"><X className="w-[17px] h-[17px]" /></button>
              </div>

              <div className="mt-5 space-y-0">
                <KVRow k="Origine" v={selectedRun.triggered_by === 'cron' ? 'Automatique' : 'Manuel'} />
                <KVRow k="Statut" v={selectedRun.status} ok={selectedRun.status === 'completed'} />
                <KVRow k="Réussis" v={`${selectedRun.tenants_succeeded ?? 0}`} />
                <KVRow k="Échoués" v={`${selectedRun.tenants_failed ?? 0}`} ok={selectedRun.tenants_failed === 0 ? true : false} />
                <KVRow k="Ignorés" v={`${selectedRun.tenants_skipped ?? 0}`} />
              </div>

              {detailLoading ? <Spinner /> : runDetail?.items && (
                <div className="mt-5">
                  <div className="text-[10px] font-bold text-[#9098a3] tracking-[.09em] uppercase mb-2">Par tenant</div>
                  <div className="border-l border-[#cfd3d9] ml-[3px]">
                    {runDetail.items.map((item: any) => (
                      <div key={item.id} className="relative pl-4 pb-4">
                        <span className={`absolute left-[-3.5px] top-[3px] w-[6px] h-[6px] rounded-full ${DOT_CLS[item.status] || 'bg-[#9098a3]'}`} />
                        <div className="text-[9px] font-semibold">{item.tenants?.name || item.tenant_id?.slice(0, 8)}</div>
                        <div className="text-[8px] text-[#9098a3] mt-1">
                          {formatBytes(item.size_bytes)} · {item.row_count?.toLocaleString('fr-FR') || '—'} lignes
                          {item.error_message && <span className="text-[#c73737]"> · {item.error_message}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

// ============================================================
// OFFSITE TAB (LWS)
// ============================================================
function OffsiteTab() {
  const [config, setConfig] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [cfgRes, sumRes, txRes] = await Promise.all([
        callOffsite('get_config'),
        callOffsite('summary'),
        callOffsite('list_transfers', { limit: 30 }),
      ]);
      setConfig(cfgRes);
      setSummary(sumRes);
      setTransfers(txRes.transfers || []);
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const testConnection = async () => {
    setTesting(true);
    try {
      const r = await callOffsite('test_connection');
      if (r.success) toast.success('Connexion WebDAV opérationnelle');
      else toast.error(r.error || 'Échec du test');
    } catch (e: any) { toast.error(e.message); }
    finally { setTesting(false); }
  };

  const processQueue = async () => {
    setProcessing(true);
    try {
      const r = await callOffsite('process_queue');
      toast.success(`${r.processed ?? 0} transfert(s) traité(s)`);
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setProcessing(false); }
  };

  const retryTransfer = async (transferId: string) => {
    setActionInProgress(transferId);
    try {
      await callOffsite('retry_transfer', { transfer_id: transferId });
      toast.success('Transfert remis en file');
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setActionInProgress(null); }
  };

  const verifyRemote = async (transferId: string) => {
    setActionInProgress(transferId);
    try {
      const r = await callOffsite('verify_remote', { transfer_id: transferId });
      if (r.verified) toast.success('Empreinte conforme');
      else toast.error(r.error || 'Empreinte non conforme');
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setActionInProgress(null); }
  };

  const retrieveTransfer = async (transferId: string) => {
    setActionInProgress(transferId);
    try {
      const r = await callOffsite('retrieve', { transfer_id: transferId });
      if (r.success) toast.success(r.message || 'Sauvegarde rapatriée');
      else toast.error(r.error || 'Échec du rapatriement');
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setActionInProgress(null); }
  };

  if (loading) return <Spinner />;

  const cfg = config?.config;
  const secrets = config?.secrets_configured || {};
  const allSecretsOk = secrets.LWS_WEBDAV_URL && secrets.LWS_WEBDAV_USERNAME && secrets.LWS_WEBDAV_PASSWORD && secrets.BACKUP_ENCRYPTION_KEY_B64 && secrets.BACKUP_ENCRYPTION_KEY_ID && secrets.OFFSITE_CRON_SECRET;
  const offsiteCron = config?.cron_status as { exists?: boolean; active?: boolean; error?: string | null } | undefined;
  const offsiteCronReady = !!offsiteCron?.exists && !!offsiteCron?.active && !offsiteCron?.error;
  const offsiteOk = cfg?.enabled && allSecretsOk && offsiteCronReady;

  return (
    <div className="pt-6">
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_310px]">
        {/* Main */}
        <div className="xl:pr-7">
          <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
            <div>
              <h3 className="text-[16px] font-bold tracking-tight">Copies distantes LWS</h3>
              <p className="text-[10px] text-[#67707c] mt-1">Disponibilité, intégrité et récupération des archives chiffrées hors site.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={testConnection}
                disabled={testing || !(secrets.LWS_WEBDAV_URL && secrets.LWS_WEBDAV_USERNAME && secrets.LWS_WEBDAV_PASSWORD)}
                className="h-[29px] px-[9px] border border-[#cfd3d9] bg-white text-[9px] font-semibold inline-flex items-center gap-[7px] hover:bg-[#f7f8f9] disabled:opacity-40"
              >
                {testing ? <Loader2 className="w-[14px] h-[14px] animate-spin" /> : <Cloud className="w-[14px] h-[14px]" />}
                Tester la connexion
              </button>
              <button
                onClick={processQueue}
                disabled={processing}
                className="h-[29px] px-[9px] bg-[#101318] text-white text-[9px] font-semibold inline-flex items-center gap-[7px] hover:bg-[#292e35] disabled:opacity-50"
              >
                {processing ? <Loader2 className="w-[14px] h-[14px] animate-spin" /> : <RefreshCw className="w-[14px] h-[14px]" />}
                Traiter la file
              </button>
            </div>
          </div>

          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="border-t border-b border-[#e5e7eb]">
                <th className="text-left py-2 text-[8px] font-bold text-[#9098a3] tracking-[.1em] uppercase">Tenant</th>
                <th className="text-left py-2 text-[8px] font-bold text-[#9098a3] tracking-[.1em] uppercase hidden md:table-cell">Archive</th>
                <th className="text-left py-2 text-[8px] font-bold text-[#9098a3] tracking-[.1em] uppercase">Transfert</th>
                <th className="text-right py-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {transfers.map(tx => (
                <tr key={tx.id} className="border-b border-[#edf0f2] hover:bg-[#fafbfb] transition-colors">
                  <td className="py-2.5">
                    <div className="font-semibold">{tx.tenants?.name || tx.tenant_id?.slice(0, 8)}</div>
                    <div className="text-[8px] text-[#9098a3] mt-0.5">{formatDateTime(tx.queued_at)}</div>
                  </td>
                  <td className="py-2.5 hidden md:table-cell font-mono text-[9px] text-[#67707c]">
                    {formatBytes(tx.size_bytes)}
                  </td>
                  <td className="py-2.5"><StatusLabel status={tx.status} /></td>
                  <td className="py-2.5 text-right">
                    <div className="inline-flex items-center gap-1">
                      {tx.status === 'failed' && (
                        <button onClick={() => retryTransfer(tx.id)} disabled={actionInProgress === tx.id} className="p-1 text-[#9098a3] hover:text-[#101318] disabled:opacity-50" title="Relancer">
                          <RotateCcw className="w-[13px] h-[13px]" />
                        </button>
                      )}
                      {tx.status === 'verified' && (
                        <>
                          <button onClick={() => verifyRemote(tx.id)} disabled={actionInProgress === tx.id} className="p-1 text-[#9098a3] hover:text-[#101318] disabled:opacity-50" title="Vérifier">
                            <Check className="w-[13px] h-[13px]" />
                          </button>
                          <button onClick={() => retrieveTransfer(tx.id)} disabled={actionInProgress === tx.id} className="h-[29px] px-[9px] border border-[#cfd3d9] bg-white text-[9px] font-semibold hover:bg-[#f7f8f9] disabled:opacity-50">
                            Récupérer
                          </button>
                        </>
                      )}
                      {actionInProgress === tx.id && <Loader2 className="w-[13px] h-[13px] animate-spin text-[#9098a3]" />}
                    </div>
                  </td>
                </tr>
              ))}
              {transfers.length === 0 && (
                <tr><td colSpan={4} className="py-8 text-center text-[#9098a3]">Aucun transfert enregistré</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Side rail */}
        <aside className="border-t xl:border-t-0 xl:border-l border-[#e5e7eb] pt-6 xl:pl-7 mt-6 xl:mt-0">
          <div className="text-[8px] font-bold text-[#9098a3] tracking-[.13em] uppercase">Stockage CloudDrive</div>
          <div className="flex items-center justify-between mt-2 text-[12px] font-bold">
            <span>LWS CloudDrive</span>
            <span className={`inline-flex items-center gap-[6px] text-[9px] font-semibold ${offsiteOk ? 'text-[#0b8f61]' : 'text-[#9098a3]'}`}>
              <Dot status={offsiteOk ? 'verified' : 'queued'} />
              {offsiteOk ? 'Connecté' : 'Inactif'}
            </span>
          </div>

          <div className="mt-6 space-y-0">
            <div className="flex items-center gap-[10px] py-3 border-b border-[#edf0f2]">
              <Check className="w-[14px] h-[14px] text-[#0b8f61] shrink-0" />
              <div>
                <div className="text-[9px] font-semibold">WebDAV {offsiteOk ? 'opérationnel' : 'non configuré'}</div>
              </div>
            </div>
            <div className="flex items-center gap-[10px] py-3 border-b border-[#edf0f2]">
              <Lock className="w-[14px] h-[14px] text-[#0b8f61] shrink-0" />
              <div>
                <div className="text-[9px] font-semibold">Chiffrement AES-256-GCM</div>
                <div className="text-[8px] text-[#9098a3] mt-0.5">{secrets.BACKUP_ENCRYPTION_KEY_ID ? 'Clé configurée' : 'Clé manquante'}</div>
              </div>
            </div>
            <div className="flex items-center gap-[10px] py-3 border-b border-[#edf0f2]">
              <Shield className="w-[14px] h-[14px] text-[#0b8f61] shrink-0" />
              <div>
                <div className="text-[9px] font-semibold">{summary?.total_verified ?? 0} empreintes conformes</div>
                <div className="text-[8px] text-[#9098a3] mt-0.5">{(summary?.total_failed ?? 0) > 0 ? `${summary.total_failed} divergences` : 'Aucune divergence'}</div>
              </div>
            </div>
          </div>

          {/* Secret status */}
          {!allSecretsOk && (
            <div className="mt-5 text-[9px]">
              <div className="font-semibold text-[#b66a06] mb-1">Secrets manquants</div>
              {!secrets.LWS_WEBDAV_URL && <div className="text-[#9098a3]">LWS_WEBDAV_URL</div>}
              {!secrets.LWS_WEBDAV_USERNAME && <div className="text-[#9098a3]">LWS_WEBDAV_USERNAME</div>}
              {!secrets.LWS_WEBDAV_PASSWORD && <div className="text-[#9098a3]">LWS_WEBDAV_PASSWORD</div>}
              {!secrets.BACKUP_ENCRYPTION_KEY_B64 && <div className="text-[#9098a3]">BACKUP_ENCRYPTION_KEY_B64</div>}
              {!secrets.BACKUP_ENCRYPTION_KEY_ID && <div className="text-[#9098a3]">BACKUP_ENCRYPTION_KEY_ID</div>}
              {!secrets.OFFSITE_CRON_SECRET && <div className="text-[#9098a3]">OFFSITE_CRON_SECRET</div>}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// ============================================================
// SETTINGS TAB
// ============================================================
function SettingsTab() {
  const [data, setData] = useState<any>(null);
  const [offsiteConfig, setOffsiteConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingOffsite, setSavingOffsite] = useState(false);
  const [policyEditing, setPolicyEditing] = useState(false);
  const [configEditing, setConfigEditing] = useState(false);
  const toast = useToast();

  const [form, setForm] = useState({
    enabled: false, cron_expression: '0 2 * * *', timezone: 'Africa/Dakar',
    retention_daily: 7, retention_weekly: 4, retention_monthly: 6, max_concurrent: 2,
  });
  const [configForm, setConfigForm] = useState({ enabled: false, root_folder: '/Waarwi', auto_transfer: true });

  const load = useCallback(async () => {
    try {
      const [d, c] = await Promise.all([
        callScheduler('dashboard_summary'),
        callOffsite('get_config'),
      ]);
      setData(d);
      setOffsiteConfig(c);
      if (d.policy) {
        setForm({
          enabled: d.policy.enabled ?? false,
          cron_expression: d.policy.cron_expression || '0 2 * * *',
          timezone: d.policy.timezone || 'Africa/Dakar',
          retention_daily: d.policy.retention_daily ?? 7,
          retention_weekly: d.policy.retention_weekly ?? 4,
          retention_monthly: d.policy.retention_monthly ?? 6,
          max_concurrent: d.policy.max_concurrent ?? 2,
        });
      }
      if (c.config) {
        setConfigForm({
          enabled: c.config.enabled ?? false,
          root_folder: c.config.root_folder || '/Waarwi',
          auto_transfer: c.config.auto_transfer ?? true,
        });
      }
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const savePolicy = async () => {
    setSaving(true);
    try {
      await callScheduler('update_policy', form);
      toast.success('Politique enregistrée');
      setPolicyEditing(false);
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const saveConfig = async () => {
    setSavingOffsite(true);
    try {
      await callOffsite('update_config', configForm);
      toast.success('Configuration distante enregistrée');
      setConfigEditing(false);
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setSavingOffsite(false); }
  };

  if (loading) return <Spinner />;

  const secrets = offsiteConfig?.secrets_configured || {};

  return (
    <div className="pt-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h3 className="text-[16px] font-bold tracking-tight">Paramètres de protection</h3>
          <p className="text-[10px] text-[#67707c] mt-1">Configuration globale appliquée aux tenants actifs de la plateforme.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-12 max-w-[1080px]">
        {/* Scheduling */}
        <div>
          <div className="border-t border-[#e5e7eb]">
            <div className="flex items-center justify-between mt-4 mb-1">
              <h4 className="text-[11px] font-bold">Planification</h4>
              {!policyEditing && <button onClick={() => setPolicyEditing(true)} className="text-[9px] font-semibold text-[#67707c] hover:text-[#101318]">Modifier</button>}
            </div>
            <p className="text-[9px] text-[#9098a3] leading-relaxed mb-3">Cadence du cycle automatique et capacité de traitement.</p>
            {policyEditing ? (
              <div className="space-y-3">
                <SettingToggle label="Protection automatique" value={form.enabled} onChange={v => setForm(f => ({ ...f, enabled: v }))} />
                <SettingInput label="Expression cron" value={form.cron_expression} onChange={v => setForm(f => ({ ...f, cron_expression: v }))} mono />
                <SettingInput label="Fuseau horaire" value={form.timezone} onChange={v => setForm(f => ({ ...f, timezone: v }))} />
                <SettingInput label="Exécutions simultanées" value={String(form.max_concurrent)} onChange={v => setForm(f => ({ ...f, max_concurrent: Number(v) || 2 }))} />
                <div className="flex items-center gap-2 pt-2">
                  <button onClick={savePolicy} disabled={saving} className="h-[29px] px-3 bg-[#101318] text-white text-[9px] font-semibold hover:bg-[#292e35] disabled:opacity-50">
                    {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Enregistrer'}
                  </button>
                  <button onClick={() => setPolicyEditing(false)} className="h-[29px] px-3 border border-[#cfd3d9] text-[9px] font-semibold hover:bg-[#f7f8f9]">Annuler</button>
                </div>
              </div>
            ) : (
              <div>
                <SettingRow label="Protection automatique" value={form.enabled ? 'Activée' : 'Désactivée'} ok={form.enabled} />
                <SettingRow label="Expression cron" value={form.cron_expression} mono />
                <SettingRow label="Fuseau horaire" value={form.timezone} />
                <SettingRow label="Exécutions simultanées" value={`${form.max_concurrent} tenants`} />
              </div>
            )}
          </div>

          <div className="border-t border-[#e5e7eb] mt-7">
            <h4 className="text-[11px] font-bold mt-4 mb-1">Rétention</h4>
            <p className="text-[9px] text-[#9098a3] leading-relaxed mb-3">Conservation locale avant nettoyage automatique.</p>
            {policyEditing ? (
              <div className="space-y-3">
                <SettingInput label="Quotidiennes (jours)" value={String(form.retention_daily)} onChange={v => setForm(f => ({ ...f, retention_daily: Number(v) || 7 }))} />
                <SettingInput label="Hebdomadaires (semaines)" value={String(form.retention_weekly)} onChange={v => setForm(f => ({ ...f, retention_weekly: Number(v) || 4 }))} />
                <SettingInput label="Mensuelles (mois)" value={String(form.retention_monthly)} onChange={v => setForm(f => ({ ...f, retention_monthly: Number(v) || 6 }))} />
              </div>
            ) : (
              <div>
                <SettingRow label="Quotidiennes" value={`${form.retention_daily} jours`} />
                <SettingRow label="Hebdomadaires" value={`${form.retention_weekly} semaines`} />
                <SettingRow label="Mensuelles" value={`${form.retention_monthly} mois`} />
              </div>
            )}
          </div>
        </div>

        {/* Offsite */}
        <div>
          <div className="border-t border-[#e5e7eb]">
            <div className="flex items-center justify-between mt-4 mb-1">
              <h4 className="text-[11px] font-bold">Copie distante</h4>
              {!configEditing && <button onClick={() => setConfigEditing(true)} className="text-[9px] font-semibold text-[#67707c] hover:text-[#101318]">Modifier</button>}
            </div>
            <p className="text-[9px] text-[#9098a3] leading-relaxed mb-3">Transfert chiffré vers le stockage LWS après chaque sauvegarde planifiée.</p>
            {configEditing ? (
              <div className="space-y-3">
                <SettingToggle label="Transfert automatique" value={configForm.auto_transfer} onChange={v => setConfigForm(f => ({ ...f, auto_transfer: v }))} />
                <SettingToggle label="Copie distante activée" value={configForm.enabled} onChange={v => setConfigForm(f => ({ ...f, enabled: v }))} />
                <SettingInput label="Dossier racine" value={configForm.root_folder} onChange={v => setConfigForm(f => ({ ...f, root_folder: v }))} mono />
                <div className="flex items-center gap-2 pt-2">
                  <button onClick={saveConfig} disabled={savingOffsite} className="h-[29px] px-3 bg-[#101318] text-white text-[9px] font-semibold hover:bg-[#292e35] disabled:opacity-50">
                    {savingOffsite ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Enregistrer'}
                  </button>
                  <button onClick={() => setConfigEditing(false)} className="h-[29px] px-3 border border-[#cfd3d9] text-[9px] font-semibold hover:bg-[#f7f8f9]">Annuler</button>
                </div>
              </div>
            ) : (
              <div>
                <SettingRow label="Transfert automatique" value={configForm.auto_transfer ? 'Activé' : 'Désactivé'} ok={configForm.auto_transfer} />
                <SettingRow label="Copie distante" value={configForm.enabled ? 'Activée' : 'Désactivée'} ok={configForm.enabled} />
                <SettingRow label="Protocole" value="WebDAV" />
                <SettingRow label="Dossier racine" value={configForm.root_folder} mono />
              </div>
            )}
          </div>

          <div className="border-t border-[#e5e7eb] mt-7">
            <h4 className="text-[11px] font-bold mt-4 mb-1">Sécurité</h4>
            <p className="text-[9px] text-[#9098a3] leading-relaxed mb-3">Les valeurs sensibles restent masquées et ne sont jamais affichées dans l'interface.</p>
            <div>
              <SettingRow label="Clé de chiffrement" value={secrets.BACKUP_ENCRYPTION_KEY_B64 ? `Configurée${secrets.BACKUP_ENCRYPTION_KEY_ID ? ' · ID présent' : ''}` : 'Manquante'} ok={!!secrets.BACKUP_ENCRYPTION_KEY_B64} />
              <SettingRow label="Secret du planificateur" value={data?.cron_secret_configured ? 'Configuré' : 'Manquant'} ok={!!data?.cron_secret_configured} />
              <SettingRow label="Secret copie distante" value={secrets.OFFSITE_CRON_SECRET ? 'Configuré' : 'Manquant'} ok={!!secrets.OFFSITE_CRON_SECRET} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SETTINGS PRIMITIVES
// ============================================================
function SettingRow({ label, value, ok, mono }: { label: string; value: string; ok?: boolean; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-4 items-center py-[11px] border-b border-[#edf0f2]">
      <span className="text-[9px] text-[#67707c]">{label}</span>
      <span className={`text-[9px] font-semibold text-right ${mono ? 'font-mono tracking-tight' : ''} ${ok === true ? 'text-[#0b8f61]' : ok === false ? 'text-[#c73737]' : ''}`}>{value}</span>
    </div>
  );
}

function SettingInput({ label, value, onChange, mono }: { label: string; value: string; onChange: (v: string) => void; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-4 items-center py-[11px] border-b border-[#edf0f2]">
      <label className="text-[9px] text-[#67707c]">{label}</label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`text-[9px] font-semibold text-right bg-transparent border-b border-[#cfd3d9] outline-0 w-[140px] py-0.5 ${mono ? 'font-mono tracking-tight' : ''}`}
      />
    </div>
  );
}

function SettingToggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-4 items-center py-[11px] border-b border-[#edf0f2]">
      <label className="text-[9px] text-[#67707c]">{label}</label>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-[30px] h-[16px] rounded-full transition-colors ${value ? 'bg-[#0b8f61]' : 'bg-[#bec3ca]'}`}
      >
        <span className={`absolute top-[3px] left-[3px] w-[10px] h-[10px] bg-white rounded-full transition-transform ${value ? 'translate-x-[14px]' : ''}`} />
      </button>
    </div>
  );
}
