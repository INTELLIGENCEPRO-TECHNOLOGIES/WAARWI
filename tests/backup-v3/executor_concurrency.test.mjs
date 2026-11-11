// Multi-session tests on a real PostgreSQL 17 (isolated local instance, never production).
// Each scenario uses distinct connections, i.e. distinct backends and transactions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { client } from './deps.mjs';
import { installSchema, SEED, IDS } from './fixtures.mjs';

const DB = 'br_v3_concurrency';
const { A, B } = IDS;
const open = [];
async function conn() {
  const c = client({ database: DB });
  c.on('error', () => {});
  await c.connect();
  open.push(c);
  return c;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ctl;
let CMD;

async function setCfg(timeoutSeconds, maxCapacity = 2) {
  await ctl.query(`UPDATE _br_capture_executor_config SET enabled = true, capture_timeout_seconds = $1,
    lease_margin_seconds = 60, max_capacity_failures = $2, retry_backoff_seconds = 10`, [timeoutSeconds, maxCapacity]);
  CMD = (await ctl.query(`SELECT _br_capture_executor_command() c`)).rows[0].c;
}
async function freshJob(tenant, period) {
  await ctl.query(`DELETE FROM _br_backup_jobs`);
  return (await ctl.query(`SELECT _br_v3_request_capture($1, $2) r`, [tenant, period])).rows[0].r.job_id;
}
async function runCmd(c, slowMs = 0) {
  await c.query(`SELECT set_config('brtest.slow_ms', $1, false)`, [String(slowMs)]);
  const res = await c.query(CMD);
  return { claim: res[0].rows[0]._br_capture_executor_claim, run: res[3].rows[0]._br_capture_executor_run };
}
const job = async (id) => (await ctl.query(`SELECT *, status::text AS st FROM _br_backup_jobs WHERE id = $1`, [id])).rows[0];
const ready = (id) => ctl.query(`UPDATE _br_backup_jobs SET next_attempt_at = now() - interval '1 second' WHERE id = $1`, [id]);
async function waitCapturing(c) {
  for (let i = 0; i < 200; i++) {
    const r = await ctl.query(`SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND state = 'active' AND query LIKE '%_br_capture_executor_run%'`, [c.processID]);
    const g = await ctl.query(`SELECT 1 FROM pg_locks l JOIN pg_class k ON k.oid = l.relation WHERE l.pid = $1 AND k.relname = '_br_capture_rows'`, [c.processID]);
    if (r.rowCount && g.rowCount) return;
    await sleep(25);
  }
  throw new Error('capture never started');
}
async function timed(p) {
  const t0 = Date.now();
  try { return { ok: true, v: await p, ms: Date.now() - t0 }; } catch (e) { return { ok: false, e, ms: Date.now() - t0 }; }
}

test.before(async () => {
  const admin = client();
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DB}`);
  await admin.end();
  ctl = await conn();
  await installSchema((s) => ctl.query(s));
  await ctl.query(SEED);
  // Test-only: slows each staged row so that one capture statement lasts seconds.
  await ctl.query(`CREATE FUNCTION brtest_slow() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF coalesce(nullif(current_setting('brtest.slow_ms', true), ''), '0')::int > 0 THEN
      PERFORM pg_sleep(current_setting('brtest.slow_ms')::int / 1000.0); END IF; RETURN NEW; END $$;
    CREATE TRIGGER brtest_slow BEFORE INSERT ON _br_capture_rows FOR EACH ROW EXECUTE FUNCTION brtest_slow();`);
});
test.after(async () => { for (const c of open) await c.end().catch(() => {}); });

test('C1 two executors start the same job at the same instant: exactly one reserves it', async () => {
  await setCfg(30);
  const id = await freshJob(A, 'c1');
  const [a, b] = [await conn(), await conn()];
  const [ra, rb] = await Promise.all([runCmd(a, 20), runCmd(b, 20)]);
  const states = [ra.claim.state, rb.claim.state].sort();
  assert.deepEqual(states, ['claimed', 'idle']);
  const j = await job(id);
  assert.equal(j.st, 'capture_ready');
  assert.equal(j.attempts, 1);
  const g = await ctl.query(`SELECT count(*)::int n FROM _br_capture_generations WHERE job_id = $1`, [id]);
  assert.equal(g.rows[0].n, 1);
});

test('C2 during a long capture: business writes, other claims and recovery do not wait; lease renewal waits on the row lock', async () => {
  await setCfg(30);
  const id = await freshJob(A, 'c2');
  await ctl.query(`SELECT _br_v3_request_capture($1, 'c2-other') r`, [B]);
  const [a, b] = [await conn(), await conn()];
  const before = (await ctl.query(`SELECT count(*)::int n FROM syn_items WHERE tenant_id = $1`, [A])).rows[0].n;
  const capture = timed(runCmd(a, 60));
  await waitCapturing(a);

  const write = await timed(b.query(`INSERT INTO syn_items (tenant_id, label) SELECT $1, 'during ' || g FROM generate_series(1,5) g;
    UPDATE syn_counters SET value = value + 1 WHERE tenant_id = '${A}' AND doc_kind = 'sale'`, [A]).catch(() =>
    b.query(`INSERT INTO syn_items (tenant_id, label) SELECT '${A}', 'during ' || g FROM generate_series(1,5) g`)));
  const other = await timed(b.query(`SELECT * FROM _br_job_claim('other', 120)`));
  const recov = await timed(b.query(`SELECT _br_jobs_recover_expired(50, 10) r`));
  const tok = (await job(id)).lease_token;
  await b.query(`SET lock_timeout = '400ms'`);
  const renew = await timed(b.query(`SELECT _br_job_renew_lease($1, $2, 300)`, [id, tok]));
  const cancel = await timed(b.query(`SELECT _br_job_cancel($1, 'x')`, [id]));
  await b.query(`RESET lock_timeout`);

  const done = await capture;
  assert.ok(write.ok && write.ms < 1000, `business write took ${write.ms} ms`);
  assert.ok(other.ok && other.ms < 1000 && other.v.rows[0]?.tenant_id === B, 'another tenant is claimed on the second slot without waiting');
  assert.ok(recov.ok && recov.ms < 1000 && recov.v.rows[0].r.requeued === 0, 'recovery skips the locked job');
  assert.ok(!renew.ok && renew.e.code === '55P03' && renew.ms >= 350, 'renewal from another session waits for the row lock, then gives up');
  assert.ok(!cancel.ok && cancel.e.code === '55P03', 'cancel waits for the row lock, then gives up');
  assert.ok(done.ok && done.v.run.state === 'capture_ready', JSON.stringify(done.v?.run ?? done.e?.message));
  assert.ok(done.ms > 2000, `capture lasted ${done.ms} ms`);
  const staged = (await ctl.query(`SELECT count(*)::int n FROM _br_capture_rows WHERE generation_id = $1 AND table_name = 'syn_items'`, [done.v.run.generation_id])).rows[0].n;
  const after = (await ctl.query(`SELECT count(*)::int n FROM syn_items WHERE tenant_id = $1`, [A])).rows[0].n;
  assert.equal(staged, before, 'capture sees one snapshot taken before the concurrent writes');
  assert.equal(after, before + 5, 'concurrent writes were committed');
  await ctl.query(`SELECT _br_job_fail($1, $2, 'X', 'release', true, 10)`, [other.v.rows[0].job_id, other.v.rows[0].lease_token]);
});

test('C3 duration overrun: recorded as capacity, retried once, then failed for good; never retried again', async () => {
  await setCfg(2, 2);
  const id = await freshJob(A, 'c3');
  const a = await conn();
  const r1 = await timed(runCmd(a, 100));
  assert.ok(r1.ok, r1.e?.message);
  assert.equal(r1.v.run.state, 'capacity_exceeded');
  assert.ok(r1.ms >= 1900 && r1.ms < 4500, `stopped by the limit after ${r1.ms} ms`);
  let j = await job(id);
  assert.equal(j.st, 'pending');
  assert.equal(j.error_code, 'BRJ-043');
  assert.equal(j.error_class, 'capacity');
  assert.equal(j.capacity_failures, 1);
  assert.equal(j.attempts, 1);
  assert.equal(j.slot_no, null);
  assert.equal((await ctl.query(`SELECT count(*)::int n FROM _br_capture_generations WHERE job_id = $1`, [id])).rows[0].n, 0);

  await ready(id);
  const r2 = await runCmd(a, 100);
  assert.equal(r2.run.state, 'capacity_exceeded');
  j = await job(id);
  assert.equal(j.st, 'failed');
  assert.equal(j.error_class, 'capacity');
  assert.equal(j.capacity_failures, 2);
  assert.equal(j.attempts, 2);
  assert.match(j.error_message, /statement timeout.*overrun 2\/2; attempt 2\/3/);
  await ready(id);
  const r3 = await runCmd(a, 0);
  assert.equal(r3.claim.state, 'idle');
  assert.equal((await job(id)).st, 'failed');
  const verified = (await ctl.query(`SELECT count(*)::int n FROM tenant_backups WHERE status = 'verified'`)).rows[0].n;
  assert.equal(verified, 0);
});

test('C4 executor killed mid-capture: nothing published, lock released, job resumed by another executor', async () => {
  await setCfg(30);
  const id = await freshJob(A, 'c4');
  const [a, b] = [await conn(), await conn()];
  const killed = timed(runCmd(a, 100));
  await waitCapturing(a);
  await ctl.query(`SELECT pg_terminate_backend($1)`, [a.processID]);
  const k = await killed;
  assert.ok(!k.ok);
  let j = await job(id);
  assert.equal(j.st, 'processing');
  assert.equal((await ctl.query(`SELECT count(*)::int n FROM _br_capture_generations WHERE job_id = $1`, [id])).rows[0].n, 0);
  const nowait = await timed(b.query(`SELECT id FROM _br_backup_jobs WHERE id = $1 FOR UPDATE NOWAIT`, [id]));
  assert.ok(nowait.ok, 'row lock released by the rollback');
  const early = await runCmd(b, 0);
  assert.equal(early.claim.state, 'idle', 'lease still valid: no takeover');

  await ctl.query(`UPDATE _br_backup_jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1`, [id]);
  await runCmd(b, 0);
  j = await job(id);
  assert.equal(j.st, 'pending');
  assert.equal(j.error_code, 'LEASE_EXPIRED');
  await ready(id);
  const resumed = await runCmd(b, 0);
  assert.equal(resumed.run.state, 'capture_ready');
  j = await job(id);
  assert.equal(Number(j.claim_fence), 2);
  assert.equal(j.attempts, 2);
});

test('C5 resume, then the old executor tries to publish: rejected, current generation untouched', async () => {
  await setCfg(30);
  const id = await freshJob(A, 'c5');
  const [a, b] = [await conn(), await conn()];
  const oldClaim = (await a.query(`SELECT _br_capture_executor_claim('pg_cron') r; COMMIT;`))[0].rows[0].r;
  assert.equal(oldClaim.state, 'claimed');
  const oldTok = (await job(id)).lease_token;
  await ctl.query(`UPDATE _br_backup_jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1`, [id]);
  await runCmd(b, 0);
  await ready(id);
  const fresh = await runCmd(b, 0);
  assert.equal(fresh.run.state, 'capture_ready');
  const cur = await job(id);

  const stale = (await a.query(`SET LOCAL statement_timeout = '30s'; SELECT _br_capture_executor_run() r`))[1].rows[0].r;
  assert.equal(stale.state, 'lease_lost');
  await a.query(`SET statement_timeout = '30s'`);
  await assert.rejects(a.query(`SELECT _br_capture_run($1, $2)`, [id, oldTok]), /BRJ-010/);
  await assert.rejects(a.query(`SELECT _br_job_fail($1, $2, 'X', 'stale', false, 10)`, [id, oldTok]), /BRJ-010/);
  await assert.rejects(a.query(`SELECT _br_job_renew_lease($1, $2, 300)`, [id, oldTok]), /BRJ-010/);
  const after = await job(id);
  assert.equal(after.st, 'capture_ready');
  assert.equal(after.capture_generation_id, cur.capture_generation_id);
  assert.equal(Number(after.claim_fence), 2);
  const assertCur = (await ctl.query(`SELECT _br_capture_assert_current($1) r`, [cur.capture_generation_id])).rows[0].r;
  assert.equal(assertCur.restorable, false);
});

test('C6 disabled executor: the exact cron command reserves nothing', async () => {
  const id = await freshJob(A, 'c6');
  await ctl.query(`UPDATE _br_capture_executor_config SET enabled = false`);
  const a = await conn();
  const r = await runCmd(a, 0);
  assert.equal(r.claim.state, 'disabled');
  assert.equal(r.run.state, 'idle');
  assert.equal((await job(id)).st, 'pending');
});
