// Worker de référence Lot B — NON déployé, NON branché à un cron. Contrat d'appel des RPC serveur.

export type RpcError = { code?: string; message: string };
export type RpcResult<T = unknown> = { data: T | null; error: RpcError | null };
export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<RpcResult<any>>;

export type ErrorClass = 'transient' | 'permanent' | 'lease_lost';

export type Claim = {
  job_id: string;
  tenant_id: string;
  attempt: number;
  max_attempts: number;
  lease_token: string;
  lease_expires_at: string;
};

export type Outcome =
  | { outcome: 'idle' }
  | { outcome: 'capture_ready'; job_id: string; generation_id: string; restorable: false }
  | { outcome: 'retry_scheduled' | 'failed'; job_id: string; error_class: ErrorClass; code: string }
  | { outcome: 'lease_lost'; job_id: string; code: string };

const PERMANENT_SQLSTATES = new Set(['22023', '42501', 'P0002']);

export function errorCode(err: RpcError): string {
  const m = /^(BRJ-\d{3}|BR\d{3})/.exec(err.message ?? '');
  return m ? m[1] : err.code || 'UNKNOWN';
}

export function classify(err: RpcError): ErrorClass {
  const code = errorCode(err);
  // Bail perdu : le worker s'arrête sans rien écrire ; la reprise appartient au serveur.
  if (code === 'BRJ-010' || code === 'BRJ-042') return 'lease_lost';
  if (code.startsWith('BRJ-05') || code === 'BRJ-060' || code === 'BRJ-061' || code === 'BRJ-001') return 'permanent';
  if (err.code && PERMANENT_SQLSTATES.has(err.code)) return 'permanent';
  return 'transient';
}

export type WorkerOptions = { workerId: string; leaseSeconds?: number; backoffSeconds?: number };

export async function runOnce(rpc: Rpc, opts: WorkerOptions): Promise<Outcome> {
  const lease = opts.leaseSeconds ?? 900;
  const backoff = opts.backoffSeconds ?? 300;

  const claimed = await rpc('_br_job_claim', { p_worker_id: opts.workerId, p_lease_seconds: lease });
  if (claimed.error) throw new Error(`claim failed: ${errorCode(claimed.error)}`);
  const rows = Array.isArray(claimed.data) ? claimed.data : [];
  if (rows.length === 0) return { outcome: 'idle' };
  const job = rows[0] as Claim;
  if (!job?.job_id || !job?.lease_token) throw new Error('claim returned an unexpected shape');

  const ids = { p_job_id: job.job_id, p_lease_token: job.lease_token };

  const steps: Array<[string, Record<string, unknown>]> = [
    ['_br_job_mark_processing', ids],
    ['_br_job_renew_lease', { ...ids, p_lease_seconds: lease }],
  ];
  for (const [fn, args] of steps) {
    const r = await rpc(fn, args);
    if (r.error) return fail(rpc, job, r.error, backoff);
  }

  const cap = await rpc('_br_capture_run', ids);
  if (cap.error) return fail(rpc, job, cap.error, backoff);
  const res = cap.data as { generation_id?: string; status?: string; restorable?: boolean } | null;
  if (!res?.generation_id || res.status !== 'capture_ready' || res.restorable !== false) {
    throw new Error('capture returned an unexpected shape');
  }
  return { outcome: 'capture_ready', job_id: job.job_id, generation_id: res.generation_id, restorable: false };
}

async function fail(rpc: Rpc, job: Claim, err: RpcError, backoff: number): Promise<Outcome> {
  const cls = classify(err);
  const code = errorCode(err);
  if (cls === 'lease_lost') return { outcome: 'lease_lost', job_id: job.job_id, code };
  const r = await rpc('_br_job_fail', {
    p_job_id: job.job_id, p_lease_token: job.lease_token, p_error_code: code,
    p_error_message: err.message.slice(0, 500), p_permanent: cls === 'permanent', p_base_backoff_seconds: backoff,
  });
  if (r.error) {
    if (classify(r.error) === 'lease_lost') return { outcome: 'lease_lost', job_id: job.job_id, code: errorCode(r.error) };
    throw new Error(`fail report rejected: ${errorCode(r.error)}`);
  }
  const status = (r.data as { status?: string } | null)?.status;
  return { outcome: status === 'failed' ? 'failed' : 'retry_scheduled', job_id: job.job_id, error_class: cls, code };
}
