import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeServer } from './fake_server.ts';
import { runOnce, classify } from './reference_worker.ts';

const T = 'tenant-A';
const W = { workerId: 'w1', leaseSeconds: 900, backoffSeconds: 60 };

test('A1 requête répétée => un seul job', async () => {
  const s = new FakeServer();
  const a = await s.rpc('_br_v3_request_capture', { p_tenant_id: T, p_period_key: 'p1' });
  const b = await s.rpc('_br_v3_request_capture', { p_tenant_id: T, p_period_key: 'p1' });
  assert.equal((a.data as any).created, true);
  assert.equal((b.data as any).created, false);
  assert.equal((a.data as any).job_id, (b.data as any).job_id);
  assert.equal(s.jobs.length, 1);
});

test('A2 erreur transitoire puis reprise jusqu\'à capture_ready', async () => {
  const s = new FakeServer();
  await s.rpc('_br_v3_request_capture', { p_tenant_id: T, p_period_key: 'p1' });
  s.faults['_br_capture_run'] = [{ code: '57014', message: 'canceling statement due to statement timeout' }];
  const r1 = await runOnce(s.rpc, W);
  assert.equal(r1.outcome, 'retry_scheduled');
  assert.equal(s.jobs[0].error_class, 'transient');
  assert.equal((await runOnce(s.rpc, W)).outcome, 'idle');
  s.now += 61_000;
  const r2 = await runOnce(s.rpc, W);
  assert.equal(r2.outcome, 'capture_ready');
  assert.equal(s.jobs[0].claim_fence, 2);
  assert.equal(s.jobs[0].attempts, 2);
});

test('A3 erreur permanente => failed, jamais reprise', async () => {
  const s = new FakeServer();
  await s.rpc('_br_v3_request_capture', { p_tenant_id: T, p_period_key: 'p1' });
  s.faults['_br_capture_run'] = [{ code: '55000', message: 'BRJ-051: schema drift detected, capture refused' }];
  const r = await runOnce(s.rpc, W);
  assert.equal(r.outcome, 'failed');
  assert.equal(s.jobs[0].error_class, 'permanent');
  s.now += 10 * 3600_000;
  assert.equal((await runOnce(s.rpc, W)).outcome, 'idle');
});

test('A4 bail expiré pendant la capture => le worker s\'arrête sans écrire', async () => {
  const s = new FakeServer();
  await s.rpc('_br_v3_request_capture', { p_tenant_id: T, p_period_key: 'p1' });
  s.onCapture = () => { s.now += 901_000; };
  const r = await runOnce(s.rpc, W);
  assert.equal(r.outcome, 'lease_lost');
  assert.ok(!s.calls.includes('_br_job_fail'));
  assert.equal(s.generations.length, 0);
});

test('A5 ancien worker rejeté après reprise par un nouveau worker', async () => {
  const s = new FakeServer();
  await s.rpc('_br_v3_request_capture', { p_tenant_id: T, p_period_key: 'p1' });
  const c1 = (await s.rpc('_br_job_claim', { p_worker_id: 'old', p_lease_seconds: 60 })).data as any[];
  const oldTok = c1[0].lease_token;
  s.now += 61_000;
  const c2 = (await s.rpc('_br_job_claim', { p_worker_id: 'new', p_lease_seconds: 900 })).data as any[];
  assert.notEqual(c2[0].lease_token, oldTok);
  const ids = { p_job_id: c1[0].job_id, p_lease_token: oldTok };
  for (const fn of ['_br_job_renew_lease', '_br_job_mark_processing', '_br_capture_run', '_br_job_fail']) {
    const r = await s.rpc(fn, { ...ids, p_lease_seconds: 900, p_error_code: 'X', p_error_message: 'x', p_permanent: false, p_base_backoff_seconds: 60 });
    assert.match(r.error?.message ?? '', /^BRJ-010/, fn);
  }
  assert.equal(s.jobs[0].status, 'leased');
  assert.equal(s.jobs[0].lease_token, c2[0].lease_token);
  assert.equal(s.jobs[0].claim_fence, 2);
});

test('A6 changement de génération : l\'ancienne n\'est plus publiable', async () => {
  const s = new FakeServer();
  await s.rpc('_br_v3_request_capture', { p_tenant_id: T, p_period_key: 'p1' });
  const r1 = await runOnce(s.rpc, W);
  assert.equal(r1.outcome, 'capture_ready');
  const g1 = (r1 as any).generation_id;
  await s.rpc('_br_capture_lose_staging', { p_job_id: s.jobs[0].id });
  const r2 = await runOnce(s.rpc, W);
  assert.equal(r2.outcome, 'capture_ready');
  const g2 = (r2 as any).generation_id;
  assert.notEqual(g1, g2);
  assert.match((await s.rpc('_br_capture_assert_current', { p_generation_id: g1 })).error?.message ?? '', /^BRJ-071/);
  assert.equal((await s.rpc('_br_capture_assert_current', { p_generation_id: g2 })).error, null);
});

test('A7 aucune sauvegarde « verified » prématurée', async () => {
  const s = new FakeServer();
  await s.rpc('_br_v3_request_capture', { p_tenant_id: T, p_period_key: 'p1' });
  const r = await runOnce(s.rpc, W);
  assert.equal(r.outcome, 'capture_ready');
  assert.equal((r as any).restorable, false);
  assert.equal(s.verifiedBackups, 0);
  assert.ok(!s.calls.includes('_br_job_complete_success'));
  assert.equal(s.jobs[0].status, 'capture_ready');
});

test('A8 classification des erreurs', () => {
  assert.equal(classify({ message: 'BRJ-010: lease not held' }), 'lease_lost');
  assert.equal(classify({ message: 'BRJ-042: lease expired during capture' }), 'lease_lost');
  assert.equal(classify({ message: 'BRJ-050: registered table x is missing' }), 'permanent');
  assert.equal(classify({ message: 'BRJ-060: backups suspended' }), 'permanent');
  assert.equal(classify({ code: '57014', message: 'canceling statement due to statement timeout' }), 'transient');
  assert.equal(classify({ message: 'fetch failed' }), 'transient');
});
