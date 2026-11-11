import { useCallback, useEffect, useState } from 'react';
import { FlaskConical, Loader2, CheckCircle2, XCircle, Circle, Clock, Boxes } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';

// Affichage seulement : le serveur revérifie identité, rattachement, propriété et ces deux UUID.
const TRIAL_TENANT_ID = '31f9910a-5e94-4dc1-8ab5-c204bbcdb7db';
const TRIAL_OWNER_ID = '65a0b438-957b-4556-a296-00a851716220';

type TrialState = 'none' | 'pending' | 'capturing' | 'exporting' | 'verified' | 'failed';

type TrialStatus = {
  state: TrialState;
  job_id?: string;
  requested_at?: string | null;
  finished_at?: string | null;
  duration_ms?: number | null;
  block_count?: number | null;
  blocks_verified?: number | null;
  attempts?: number;
  max_attempts?: number;
  retry_at?: string | null;
  error_code?: string | null;
  reason?: string | null;
};

const STEPS: { key: TrialState; label: string }[] = [
  { key: 'pending', label: 'En attente' },
  { key: 'capturing', label: 'Capture en cours' },
  { key: 'exporting', label: 'Export et vérification' },
];
const ORDER: Record<TrialState, number> = { none: -1, pending: 0, capturing: 1, exporting: 2, verified: 3, failed: 3 };
const ACTIVE: TrialState[] = ['pending', 'capturing', 'exporting'];
const VALID_STATES: TrialState[] = ['none', ...ACTIVE, 'verified', 'failed'];

function fmtDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${String(s % 60).padStart(2, '0')} s`;
}

function parseStatus(data: unknown): TrialStatus | null {
  if (!data || typeof data !== 'object') return null;
  const s = data as TrialStatus;
  return VALID_STATES.includes(s.state) ? s : null;
}

export function BackupV3TrialPanel() {
  const { user, tenant, isOwner } = useApp();
  const toast = useToast();
  const eligible = isOwner && user?.id === TRIAL_OWNER_ID && tenant?.id === TRIAL_TENANT_ID;
  const [status, setStatus] = useState<TrialStatus | null>(null);
  const [allowed, setAllowed] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [now, setNow] = useState(Date.now());

  const fetchStatus = useCallback(async () => {
    const { data, error } = await supabase.rpc('br_v3_manual_test_status');
    if (error) {
      if (/BRT-40[13]/.test(error.message)) setAllowed(false);
      else setLoadError(true);
      return;
    }
    const s = parseStatus(data);
    if (!s) { setLoadError(true); return; }
    setLoadError(false);
    setStatus(s);
  }, []);

  useEffect(() => { if (eligible) fetchStatus(); }, [eligible, fetchStatus]);

  const active = !!status && ACTIVE.includes(status.state);

  useEffect(() => {
    if (!active) return;
    const poll = window.setInterval(() => { fetchStatus(); }, 5000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [active, fetchStatus]);

  const launch = async () => {
    if (requesting || active) return;
    setRequesting(true);
    const { data, error } = await supabase.rpc('br_v3_manual_test_request');
    setRequesting(false);
    if (error) {
      if (/BRT-40[13]/.test(error.message)) { setAllowed(false); toast.error('Accès refusé pour ce compte'); }
      else toast.error('Impossible de lancer l\'essai pour le moment');
      return;
    }
    const s = parseStatus(data);
    if (!s) { toast.error('Réponse inattendue du serveur'); return; }
    setStatus(s);
    setNow(Date.now());
    toast.success((data as { created?: boolean }).created ? 'Sauvegarde v3 mise en file' : 'Essai déjà en cours : suivi repris');
  };

  if (!eligible || !allowed) return null;

  const state = status?.state ?? 'none';
  const elapsed = status?.duration_ms
    ?? (active && status?.requested_at ? now - new Date(status.requested_at).getTime() : null);
  const blocks = status?.block_count ?? null;

  return (
    <div className="py-4 border-b border-neutral-200">
      <div className="flex items-center gap-2 mb-2">
        <FlaskConical className="w-4 h-4 text-neutral-400" />
        <h4 className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Essai sauvegarde v3</h4>
      </div>
      <p className="text-[11px] text-neutral-500 leading-relaxed mb-3">
        Lance une sauvegarde v3 chiffrée de votre entreprise, exportée par blocs puis vérifiée. Elle s'exécute en arrière-plan :
        vous pouvez quitter cette page et revenir suivre l'avancement.
      </p>

      <button
        onClick={launch}
        disabled={requesting || active}
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-800 transition active:scale-[0.97] disabled:opacity-50"
      >
        {requesting || active ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
        {active ? 'Essai en cours…' : 'Tester la sauvegarde v3'}
      </button>

      {loadError && (
        <p className="mt-3 text-[11px] text-amber-700">Suivi momentanément indisponible. Nouvel essai de lecture automatique.</p>
      )}

      {state !== 'none' && (
        <div className="mt-4 space-y-3">
          <ol className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            {STEPS.map((step) => {
              const idx = ORDER[step.key];
              const cur = ORDER[state];
              const done = state !== 'failed' && cur > idx;
              const isCurrent = state === step.key;
              return (
                <li key={step.key} className="flex items-center gap-1.5 text-xs">
                  {isCurrent ? <Loader2 className="w-3.5 h-3.5 animate-spin text-neutral-900" />
                    : done ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    : <Circle className="w-3.5 h-3.5 text-neutral-300" />}
                  <span className={isCurrent ? 'font-semibold text-neutral-900' : done ? 'text-neutral-700' : 'text-neutral-400'}>
                    {step.label}
                  </span>
                </li>
              );
            })}
            <li className="flex items-center gap-1.5 text-xs">
              {state === 'verified' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                : state === 'failed' ? <XCircle className="w-3.5 h-3.5 text-red-600" />
                : <Circle className="w-3.5 h-3.5 text-neutral-300" />}
              <span className={state === 'verified' ? 'font-semibold text-emerald-700' : state === 'failed' ? 'font-semibold text-red-700' : 'text-neutral-400'}>
                {state === 'failed' ? 'Échec' : 'Vérifiée'}
              </span>
            </li>
          </ol>

          <div className="flex flex-wrap gap-4 text-[11px] text-neutral-500">
            {elapsed != null && (
              <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> Durée : {fmtDuration(elapsed)}</span>
            )}
            {blocks != null && blocks > 0 && (
              <span className="inline-flex items-center gap-1">
                <Boxes className="w-3 h-3" /> Blocs : {state === 'verified' ? blocks : `${status?.blocks_verified ?? 0} vérifiés / ${blocks}`}
              </span>
            )}
          </div>

          {state === 'pending' && status?.retry_at && (
            <p className="text-[11px] text-amber-700">
              {status.reason ?? 'Tentative précédente interrompue.'} Nouvelle tentative prévue
              ({status.attempts}/{status.max_attempts}).
            </p>
          )}
          {state === 'failed' && (
            <p className="text-[11px] text-red-700">
              {status?.reason ?? 'La sauvegarde a échoué.'}
              {status?.error_code ? <span className="text-red-500"> (code {status.error_code})</span> : null}
            </p>
          )}
          {state === 'verified' && (
            <p className="text-[11px] text-emerald-700">Tous les blocs ont été contrôlés et le manifeste a été publié.</p>
          )}
        </div>
      )}
    </div>
  );
}
