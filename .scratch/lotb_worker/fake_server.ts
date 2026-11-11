// Double de test en mémoire reproduisant le contrat des RPC Lot B. Ne prouve AUCUNE garantie PostgreSQL.
import type { Rpc, RpcResult } from './reference_worker.ts';

type Job = {
  id: string; tenant_id: string; period_key: string; status: string; attempts: number; max_attempts: number;
  claim_fence: number; lease_token: string | null; lease_expires_at: number | null; next_attempt_at: number;
  generation_id: string | null; error_class: string | null; error_code: string | null;
};

export class FakeServer {
  now = 1_000_000;
  jobs: Job[] = [];
  generations: { id: string; job_id: string; no: number; fence: number; status: string }[] = [];
  verifiedBackups = 0;
  faults: Record<string, Array<{ code?: string; message: string }>> = {};
  onCapture: (() => void) | null = null;
  calls: string[] = [];
  private seq = 0;

  private uid(p: string) { return `${p}-${++this.seq}`; }
  private err(message: string, code = '55000'): RpcResult { return { data: null, error: { code, message } }; }
  private ok(data: unknown): RpcResult { return { data, error: null }; }

  private owned(id: string, token: string): Job | null {
    const j = this.jobs.find((x) => x.id === id);
    if (!j || j.lease_token !== token || !['leased', 'processing'].includes(j.status)) return null;
    if (j.lease_expires_at === null || j.lease_expires_at <= this.now) return null;
    return j;
  }

  private recover() {
    for (const j of this.jobs) {
      if (['leased', 'processing'].includes(j.status) && (j.lease_expires_at ?? 0) <= this.now) {
        j.status = j.attempts >= j.max_attempts ? 'failed' : 'pending';
        j.lease_token = null; j.lease_expires_at = null; j.next_attempt_at = this.now;
      }
    }
  }

  rpc: Rpc = async (fn, a) => {
    this.calls.push(fn);
    const fault = this.faults[fn]?.shift();
    if (fault) return { data: null, error: fault };
    switch (fn) {
      case '_br_v3_request_capture': {
        const ex = this.jobs.find((j) => j.tenant_id === a.p_tenant_id && j.period_key === a.p_period_key);
        if (ex) return this.ok({ job_id: ex.id, created: false, status: ex.status });
        const j: Job = { id: this.uid('job'), tenant_id: String(a.p_tenant_id), period_key: String(a.p_period_key),
          status: 'pending', attempts: 0, max_attempts: Number(a.p_max_attempts ?? 3), claim_fence: 0,
          lease_token: null, lease_expires_at: null, next_attempt_at: this.now, generation_id: null,
          error_class: null, error_code: null };
        this.jobs.push(j);
        return this.ok({ job_id: j.id, created: true, status: 'pending' });
      }
      case '_br_job_claim': {
        this.recover();
        const active = new Set(this.jobs.filter((j) => ['leased', 'processing', 'capture_ready'].includes(j.status)).map((j) => j.tenant_id));
        const j = this.jobs.find((x) => x.status === 'pending' && x.next_attempt_at <= this.now && !active.has(x.tenant_id));
        if (!j) return this.ok([]);
        j.status = 'leased'; j.attempts++; j.claim_fence++; j.lease_token = this.uid('tok');
        j.lease_expires_at = this.now + Number(a.p_lease_seconds) * 1000; j.error_class = null;
        return this.ok([{ job_id: j.id, tenant_id: j.tenant_id, attempt: j.attempts, max_attempts: j.max_attempts,
          lease_token: j.lease_token, lease_expires_at: new Date(j.lease_expires_at).toISOString() }]);
      }
      case '_br_job_mark_processing': {
        const j = this.owned(String(a.p_job_id), String(a.p_lease_token));
        if (!j) return this.err('BRJ-010: lease not held');
        j.status = 'processing';
        return this.ok(new Date(j.lease_expires_at!).toISOString());
      }
      case '_br_job_renew_lease': {
        const j = this.owned(String(a.p_job_id), String(a.p_lease_token));
        if (!j) return this.err('BRJ-010: lease not held');
        j.lease_expires_at = this.now + Number(a.p_lease_seconds) * 1000;
        return this.ok(new Date(j.lease_expires_at).toISOString());
      }
      case '_br_capture_run': {
        const j = this.owned(String(a.p_job_id), String(a.p_lease_token));
        if (!j) return this.err('BRJ-010: lease not held');
        if (j.status !== 'processing') return this.err('BRJ-011: not processing');
        this.onCapture?.();
        if ((j.lease_expires_at ?? 0) <= this.now) return this.err('BRJ-042: lease expired during capture');
        for (const g of this.generations) if (g.job_id === j.id && g.status === 'capture_ready') g.status = 'superseded';
        const no = this.generations.filter((g) => g.job_id === j.id).length + 1;
        const g = { id: this.uid('gen'), job_id: j.id, no, fence: j.claim_fence, status: 'capture_ready' };
        this.generations.push(g);
        j.status = 'capture_ready'; j.generation_id = g.id; j.lease_token = null; j.lease_expires_at = null;
        return this.ok({ job_id: j.id, generation_id: g.id, generation_no: no, claim_fence: j.claim_fence,
          status: 'capture_ready', restorable: false });
      }
      case '_br_job_fail': {
        const j = this.owned(String(a.p_job_id), String(a.p_lease_token));
        if (!j) return this.err('BRJ-010: lease not held');
        const perm = a.p_permanent === true || String(a.p_error_code).startsWith('BRJ-05');
        j.lease_token = null; j.lease_expires_at = null; j.error_code = String(a.p_error_code);
        j.error_class = perm ? 'permanent' : 'transient';
        j.status = perm || j.attempts >= j.max_attempts ? 'failed' : 'pending';
        j.next_attempt_at = this.now + Number(a.p_base_backoff_seconds) * 1000;
        return this.ok({ job_id: j.id, status: j.status, error_class: j.error_class });
      }
      case '_br_capture_lose_staging': {
        const j = this.jobs.find((x) => x.id === a.p_job_id)!;
        const g = this.generations.find((x) => x.id === j.generation_id)!;
        g.status = 'superseded'; j.generation_id = null; j.status = 'pending'; j.next_attempt_at = this.now;
        return this.ok({ ok: false, reason: 'staging_lost' });
      }
      case '_br_capture_assert_current': {
        const g = this.generations.find((x) => x.id === a.p_generation_id);
        const j = g && this.jobs.find((x) => x.id === g.job_id);
        if (!g || !j || g.status !== 'capture_ready' || j.generation_id !== g.id || j.claim_fence !== g.fence) {
          return this.err('BRJ-071: generation is not the current capture of its job');
        }
        return this.ok({ generation_id: g.id, state: 'capture_ready', restorable: false });
      }
      default:
        return this.err(`unknown rpc ${fn}`, '42883');
    }
  };
}
