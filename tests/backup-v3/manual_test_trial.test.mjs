// Essai manuel v3 ciblé : refus d'accès, déduplication, ciblage capture + export, motif d'échec. PostgreSQL 17 local.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { client, ROOT } from './deps.mjs';
import { installSchema, installLotC, SEED, IDS } from './fixtures.mjs';
import { importAesKey, runExportInvocation } from '../../supabase/functions/backup-export-v3/core.ts';

const DB = 'br_v3_manual_test';
const MIG = process.env.BR_MT_SQL ?? `${ROOT}/supabase/migrations/20261112110000_v3_manual_test_targeted_trial.sql`;
const { A, B } = IDS;
const U = { owner: '20000000-0000-0000-0000-0000000000a1', cashier: '20000000-0000-0000-0000-0000000000a2',
  ownerB: '20000000-0000-0000-0000-0000000000b1' };
let c, ring;
const q = (s, p) => c.query(s, p);
const one = async (s, p) => (await q(s, p)).rows[0];
const errOf = async (s, p) => { try { await q(s, p); return null; } catch (e) { return `${e.code} ${e.message}`; } };
async function rpc(fn, args) {
  const names = Object.keys(args);
  return (await q(`SELECT ${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) AS r`, names.map((n) => args[n]))).rows[0].r;
}
const trialRpc = (fn, args) => rpc(fn === '_br_v3_export_claim' ? '_br_v3_mt_export_claim' : fn, args);
const m = new Map();
const store = { async put(p, b) { if (m.has(p)) throw new Error('object exists'); m.set(p, new Uint8Array(b)); }, async get(p) { if (!m.has(p)) throw new Error('not found'); return m.get(p); } };
async function as(uid, sql) {
  await q(`SET ROLE authenticated`);
  await q(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
  try { return await one(sql); } finally { await q(`RESET ROLE`); }
}
const asErr = async (uid, sql) => { try { await as(uid, sql); return null; } catch (e) { return `${e.code} ${e.message}`; } };
const crons = async () => (await q(`SELECT jobname, command FROM cron.job ORDER BY jobname`)).rows;
const captureCmd = async () => (await crons()).find((r) => r.jobname === 'br_v3_trial_capture')?.command;
const jobCount = async () => (await one(`SELECT count(*)::int n FROM _br_backup_jobs`)).n;

const ENV = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_user_id uuid;
CREATE TABLE profiles (id uuid PRIMARY KEY, tenant_id uuid REFERENCES tenants(id), role text);
INSERT INTO _br_table_registry (table_name, tenant_link, tenant_id_column, category) VALUES ('profiles','excluded','tenant_id','system');
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
CREATE FUNCTION cron.schedule(n text, s text, cmd text) RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (n, s, cmd)
     ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid::bigint $$;
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = n RETURNING true $$;
UPDATE tenants SET owner_user_id = '${U.owner}' WHERE id = '${A}';
UPDATE tenants SET owner_user_id = '${U.ownerB}' WHERE id = '${B}';
INSERT INTO profiles VALUES ('${U.owner}', '${A}', 'admin'), ('${U.cashier}', '${A}', 'cashier'), ('${U.ownerB}', '${B}', 'admin');
`;

test.before(async () => {
  const admin = client(); await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DB}`);
  await admin.end();
  c = client({ database: DB }); c.on('error', () => {}); await c.connect();
  await installSchema((s) => q(s));
  await q(SEED);
  await installLotC((s) => q(s));
  await q(ENV);
  await q(readFileSync(MIG, 'utf8'));
  await q(readFileSync(MIG, 'utf8'));
  await q(`UPDATE _br_v3_export_config SET block_target_bytes = 2048, row_max_bytes = 4096, max_blocks_per_invocation = 3`);
  await q(`UPDATE _br_capture_executor_config SET capture_timeout_seconds = 60, lease_margin_seconds = 60`);
  await q(`INSERT INTO _br_v3_manual_test_target (tenant_id, user_id, armed, functions_base_url)
           VALUES ($1, $2, true, 'https://example.supabase.co/functions/v1')`, [A, U.owner]);
  ring = { currentId: 'k1', keys: new Map([['k1', await importAesKey(randomBytes(32))]]) };
});
test.after(async () => { await c?.end(); });

test('T0 grants: internals unreachable, RPC closed to anon', async () => {
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await q(`SET ROLE ${role}`);
    const calls = [`SELECT _br_v3_mt_capture_claim()`, `SELECT _br_v3_mt_schedule(true)`, `SELECT _br_v3_mt_runner_token()`,
      `SELECT _br_v3_mt_state(null)`, `SELECT * FROM _br_v3_manual_test_target`];
    if (role !== 'service_role') calls.push(`SELECT _br_v3_mt_export_claim('x')`, `SELECT _br_v3_mt_runner_ok('x')`);
    if (role !== 'authenticated') calls.push(`SELECT br_v3_manual_test_request()`, `SELECT br_v3_manual_test_status()`);
    for (const s of calls) assert.match(String(await errOf(s)), /^42501/, `${role}: ${s}`);
    await q(`RESET ROLE`);
  }
});

test('T1 refusals: no session, cashier, other tenant owner, moved profile, ownership change, disarmed', async () => {
  for (const fn of ['br_v3_manual_test_request()', 'br_v3_manual_test_status()']) {
    assert.match(String(await asErr(null, `SELECT ${fn}`)), /^42501 BRT-401/);
    assert.match(String(await asErr(U.cashier, `SELECT ${fn}`)), /^42501 BRT-403/);
    assert.match(String(await asErr(U.ownerB, `SELECT ${fn}`)), /^42501 BRT-403/);
  }
  await q(`UPDATE profiles SET tenant_id = $1 WHERE id = $2`, [B, U.owner]);
  assert.match(String(await asErr(U.owner, `SELECT br_v3_manual_test_request()`)), /BRT-403/);
  await q(`UPDATE profiles SET tenant_id = $1 WHERE id = $2`, [A, U.owner]);
  await q(`UPDATE tenants SET owner_user_id = $1 WHERE id = $2`, [U.cashier, A]);
  assert.match(String(await asErr(U.owner, `SELECT br_v3_manual_test_request()`)), /BRT-403/);
  await q(`UPDATE tenants SET owner_user_id = $1 WHERE id = $2`, [U.owner, A]);
  await q(`UPDATE _br_v3_manual_test_target SET armed = false`);
  assert.match(String(await asErr(U.owner, `SELECT br_v3_manual_test_status()`)), /BRT-403/);
  await q(`UPDATE _br_v3_manual_test_target SET armed = true`);
  assert.equal(await jobCount(), 0);
  assert.equal((await crons()).length, 0);
  assert.equal((await as(U.owner, `SELECT br_v3_manual_test_status() r`)).r.state, 'none');
});

test('T2 dedupe + targeting: double click same job; other tenants never captured nor exported', async () => {
  const other = await rpc('_br_v3_request_capture', { p_tenant_id: B, p_period_key: 'other', p_backup_kind: 'platform_manual' });
  const r1 = (await as(U.owner, `SELECT br_v3_manual_test_request() r`)).r;
  const r2 = (await as(U.owner, `SELECT br_v3_manual_test_request() r`)).r;
  assert.equal(r1.state, 'pending'); assert.equal(r1.created, true);
  assert.equal(r2.job_id, r1.job_id); assert.equal(r2.created, false);
  assert.equal(await jobCount(), 2);
  assert.deepEqual((await crons()).map((r) => r.jobname), ['br_v3_trial_capture', 'br_v3_trial_export']);
  const exp = (await crons()).find((r) => r.jobname === 'br_v3_trial_export').command;
  assert.match(exp, /example\.supabase\.co\/functions\/v1\/backup-export-v3/);
  assert.doesNotMatch(exp, /[0-9a-f]{64}/, 'token never stored in cron command');

  await q(await captureCmd());
  const j = await one(`SELECT status, tenant_id FROM _br_backup_jobs WHERE id = $1`, [r1.job_id]);
  assert.equal(j.status, 'capture_ready');
  assert.equal((await one(`SELECT status FROM _br_backup_jobs WHERE id = $1`, [other.job_id])).status, 'pending');
  assert.equal((await as(U.owner, `SELECT br_v3_manual_test_status() r`)).r.state, 'exporting');
  assert.equal((await as(U.owner, `SELECT br_v3_manual_test_request() r`)).r.job_id, r1.job_id, 'refresh finds same job');

  // Tenant B rendu capture_ready par l'exécuteur général (activé pour le test seulement) : l'export d'essai l'ignore.
  await q(`UPDATE _br_capture_executor_config SET enabled = true`);
  await q((await one(`SELECT _br_capture_executor_command() c`)).c);
  await q(`UPDATE _br_capture_executor_config SET enabled = false`);
  assert.equal((await one(`SELECT status FROM _br_backup_jobs WHERE id = $1`, [other.job_id])).status, 'capture_ready');

  assert.equal((await one(`SELECT enabled FROM _br_v3_export_config`)).enabled, false);
  assert.match(String(await errOf(`SELECT _br_v3_export_claim('general')`)), /BRV-045/);
  let last, early = 0;
  for (let i = 0; i < 100; i++) {
    last = await runExportInvocation({ rpc: trialRpc, store, keyring: ring }, 'trial');
    const s = (await as(U.owner, `SELECT br_v3_manual_test_status() r`)).r;
    if (last.outcome !== 'verified' && s.state === 'verified') early++;
    if (['verified', 'failed', 'idle'].includes(last.outcome)) break;
  }
  assert.equal(last.outcome, 'verified'); assert.equal(early, 0);
  const s = (await as(U.owner, `SELECT br_v3_manual_test_status() r`)).r;
  assert.equal(s.state, 'verified'); assert.ok(s.block_count > 0); assert.equal(s.blocks_verified, s.block_count);
  assert.ok(s.duration_ms >= 0); assert.equal(s.reason, null);
  assert.equal((await one(`SELECT count(*)::int n FROM _br_v3_archives WHERE tenant_id = $1`, [B])).n, 0);
  assert.equal((await runExportInvocation({ rpc: trialRpc, store, keyring: ring }, 'trial')).outcome, 'idle');
  assert.equal((await one(`SELECT status FROM _br_backup_jobs WHERE id = $1`, [other.job_id])).status, 'capture_ready');

  await q(await captureCmd());
  assert.equal((await crons()).length, 0, 'temporary crons removed once finished');
});

test('T3 runner token: wrong refused, right accepted; never readable by API roles', async () => {
  const tok = (await one(`SELECT runner_token t FROM _br_v3_manual_test_target`)).t;
  assert.match(tok, /^[0-9a-f]{64}$/);
  assert.equal((await one(`SELECT _br_v3_mt_runner_ok($1) r`, ['0'.repeat(64)])).r, false);
  assert.equal((await one(`SELECT _br_v3_mt_runner_ok($1) r`, [tok])).r, true);
  assert.equal((await one(`SELECT _br_v3_mt_runner_ok(null) r`)).r, false);
});

test('T4 new click after success creates a new job; schema drift gives a readable failure without secret', async () => {
  const prev = (await one(`SELECT job_id FROM _br_v3_manual_test_target`)).job_id;
  const r = (await as(U.owner, `SELECT br_v3_manual_test_request() r`)).r;
  assert.notEqual(r.job_id, prev); assert.equal(r.created, true);
  await q(`CREATE TABLE syn_unregistered (id int, tenant_id uuid)`);
  await q(await captureCmd());
  const s = (await as(U.owner, `SELECT br_v3_manual_test_status() r`)).r;
  assert.equal(s.state, 'failed'); assert.equal(s.error_code, 'BRJ-051');
  assert.match(s.reason, /structure de la base/);
  assert.equal(JSON.stringify(s).includes('syn_unregistered'), false);
  await q(await captureCmd());
  assert.equal((await crons()).length, 0);
});
