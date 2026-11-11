// Lot E — chaîne serveur complète (API Edge simulée + SQL lot D/E) sur PostgreSQL 17 local isolé, données fictives.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { client } from './deps.mjs';
import { installSchema, installLotC, SEED, IDS } from './fixtures.mjs';
import { LOTD_SCHEMA, LOTD_REGISTRY_PROFILES, LOTD_SEED, LOTD_TEST_HELPERS, lotDSql, U, S } from './lotd_fixtures.mjs';
import { importAesKey, runExportInvocation, runRestoreAction } from '../../supabase/functions/backup-export-v3/core.ts';

const DB = 'br_v3_lote';
const LOT_E = process.env.BR_LOT_E_SQL
  ?? new URL('../../supabase/migrations_review/20261112100000_lot_e_restore_reset_server_integration_inactive.sql', import.meta.url);
const { A, B } = IDS;
let c, ring, CMD;
const q = (s, p) => c.query(s, p);
const one = async (s, p) => (await q(s, p)).rows[0];
const errOf = async (s, p) => { try { await q(s, p); return null; } catch (e) { return `${e.code} ${e.message}`; } };
async function rpc(fn, args) {
  const names = Object.keys(args);
  const sql = `SELECT ${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) AS r`;
  return (await q(sql, names.map((n) => args[n]))).rows[0].r;
}
const m = new Map();
const store = { m, async put(p, b) { if (m.has(p)) throw new Error('object exists'); m.set(p, new Uint8Array(b)); }, async get(p) { if (!m.has(p)) throw new Error('not found'); return m.get(p); } };
const results = [];
const note = (id, d) => results.push({ id, ...d });
const state = async (t) => (await one(`SELECT _t_tenant_state($1) s`, [t])).s;
const diff = (x, y) => Object.keys({ ...x, ...y }).filter((k) => x[k] !== y[k]).sort();
const job = (id) => one(`SELECT * FROM _br_restore_jobs WHERE id = $1`, [id]);
const counters = async (t) => Object.fromEntries((await q(`SELECT doc_kind, last_number::text n FROM tenant_doc_counters WHERE tenant_id = $1`, [t])).rows.map((r) => [r.doc_kind, r.n]));
const nextSale = async (t, site) => (await one(`INSERT INTO sales (tenant_id, site_id, total) VALUES ($1, $2, 1) RETURNING sale_number`, [t, site])).sale_number;
const api = (actor, action, body = {}, cron = false) => runRestoreAction({ rpc, store, keyring: ring }, { actor, cron }, action, body, 'edge-test', 3);
const GATE_CLOSED = `CREATE OR REPLACE FUNCTION public._br_assert_destructive_available() RETURNS void LANGUAGE plpgsql AS
  'BEGIN RAISE EXCEPTION ''Cette opération est temporairement indisponible'' USING ERRCODE = ''BR020'', HINT = ''BR-020''; END'`;
const GATE_OPEN = `CREATE OR REPLACE FUNCTION public._br_assert_destructive_available() RETURNS void LANGUAGE plpgsql AS 'BEGIN END'`;

// Capture par la commande pg_cron exacte du lot B.1, puis export Edge jusqu'à l'état terminal.
async function cronArchive(tenant) {
  await q(CMD);
  const g = (await one(`SELECT capture_generation_id g, status FROM _br_backup_jobs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`, [tenant]));
  assert.ok(g.g, `capture done: ${JSON.stringify(g)}`);
  let last, early = 0;
  for (let i = 0; i < 300; i++) {
    last = await runExportInvocation({ rpc, store, keyring: ring }, 'exp');
    const a = await one(`SELECT status, manifest_path FROM _br_v3_archives WHERE generation_id = $1`, [g.g]);
    if (a && a.status !== 'verified' && a.manifest_path && m.has(a.manifest_path)) early++;
    if (['verified', 'failed', 'idle'].includes(last.outcome)) break;
  }
  assert.equal(last.outcome, 'verified');
  assert.equal(early, 0, 'manifest never published before verification');
  return one(`SELECT * FROM _br_v3_archives WHERE generation_id = $1`, [g.g]);
}
async function loadAll(actor, jobId) {
  let r;
  for (let i = 0; i < 200; i++) { r = await api(actor, 'restore_load', { job_id: jobId }); if (r.body.outcome !== 'progress') break; }
  return r;
}
const runExecutor = () => q(`CALL _br_rs_executor_next('pg_cron')`);

test.before(async () => {
  const admin = client(); await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DB}`);
  await admin.end();
  c = client({ database: DB }); c.on('error', () => {}); await c.connect();
  await installSchema((s) => q(s));
  await q(SEED); await q(LOTD_SCHEMA); await q(LOTD_REGISTRY_PROFILES);
  await installLotC((s) => q(s));
  await q(LOTD_SEED); await q(lotDSql()); await q(LOTD_TEST_HELPERS);
  await q(GATE_CLOSED);
  await q(readFileSync(LOT_E, 'utf8'));
  await q(`UPDATE _br_v3_export_config SET enabled = true, block_target_bytes = 2048, row_max_bytes = 8192, max_blocks_per_invocation = 4`);
  await q(`UPDATE _br_capture_executor_config SET enabled = true, capture_timeout_seconds = 60, lease_margin_seconds = 60`);
  CMD = (await one(`SELECT _br_capture_executor_command() c`)).c;
  ring = { currentId: 'k1', keys: new Map([['k1', await importAesKey(randomBytes(32))]]) };
});
test.after(async () => { console.log('LOTE_RESULTS ' + JSON.stringify(results)); await c?.end(); });

test('E0 grants: nothing reachable by API roles, executor and schedule not even by service_role', async () => {
  const denied = {};
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await q(`SET ROLE ${role}`);
    const calls = [`SELECT _br_rs_executor_schedule(true)`, `CALL _br_rs_executor_next('x')`];
    if (role !== 'service_role') calls.push(`SELECT _br_rs_api_request('${U.ownerA}', 'reset')`, `SELECT _br_rs_api_status('${U.ownerA}')`,
      `SELECT _br_rs_api_next_v3_load()`, `SELECT _br_rs_api_request_safety('${U.ownerA}', '${A}')`);
    denied[role] = [];
    for (const s of calls) denied[role].push(await errOf(s));
    await q(`RESET ROLE`);
    for (const e of denied[role]) assert.match(String(e), /^42501/, `${role}: ${e}`);
  }
  note('E0', { denied: Object.fromEntries(Object.entries(denied).map(([k, v]) => [k, v.length])) });
});

test('E1 BR020 in place: request, execute and executor refused before any job or mutation', async () => {
  const before = await state(A);
  await q(`UPDATE _br_restore_config SET enabled = true`);
  const r = await api(U.ownerA, 'restore_request', { operation: 'reset' });
  assert.equal(r.status, 409); assert.equal(r.body.code, 'BR-020');
  assert.match(String(await errOf(`SELECT _br_rs_api_execute($1, $2)`, [U.ownerA, A])), /^BR020/);
  assert.match(String(await errOf(`CALL _br_rs_executor_next('t')`)), /^BR020/);
  assert.equal((await one(`SELECT count(*)::int n FROM _br_restore_jobs`)).n, 0);
  assert.deepEqual(diff(before, await state(A)), []);
  await q(`UPDATE _br_restore_config SET enabled = false`);
  note('E1', { br020: r.body.code });
});

test('E2 gate simulated open: config, hooks, automatic cron backup verified for both tenants', async () => {
  await q(GATE_OPEN);
  await q(`UPDATE _br_restore_config SET enabled = true, lease_seconds = 30, maintenance_ttl_seconds = 60, swap_lock_timeout_ms = 2000`);
  assert.equal((await one(`SELECT _br_lotd_install_hooks() h`)).h.ok ?? true, true);
  assert.equal((await one(`SELECT _br_lotd_hooks_status() s`)).s.ok, true);
  await q(`SELECT _br_v3_request_capture($1, 'auto-e2', 'platform_manual')`, [B]);
  const aB = await cronArchive(B);
  assert.equal(aB.status, 'verified');
  note('E2', { archive_blocks: (await one(`SELECT count(*)::int n FROM _br_v3_archive_blocks WHERE archive_id = $1`, [aB.id])).n });
});

test('E3 isolation: viewer, other tenant, missing actor, foreign archive and job are refused', async () => {
  await q(`SELECT _br_v3_request_capture($1, 'e3', 'platform_manual')`, [A]);
  const aA = await cronArchive(A);
  const aB = await one(`SELECT id FROM _br_v3_archives WHERE tenant_id = $1 AND status = 'verified' LIMIT 1`, [B]);
  const out = {
    viewer: (await api(U.viewerA, 'restore_request', { operation: 'reset' })).status,
    cashier: (await api(U.cashierA, 'restore_request', { operation: 'restore_v3', archive_id: aA.id })).status,
    no_actor: (await api(null, 'restore_request', { operation: 'reset' })).status,
    no_actor_execute: (await api(null, 'restore_execute', { job_id: aA.id }, true)).status,
    foreign_archive: (await api(U.ownerA, 'restore_request', { operation: 'restore_v3', archive_id: aB.id })).status,
    bad_uuid: (await api(U.ownerA, 'restore_status', { job_id: "x' OR 1=1" })).status,
  };
  const r = await api(U.ownerA, 'restore_request', { operation: 'restore_v3', archive_id: aA.id, tenant_id: B });
  assert.equal(r.status, 200);
  assert.equal((await job(r.body.job_id)).tenant_id, A, 'tenant taken from the actor, never from the body');
  for (const a of ['restore_status', 'restore_load', 'restore_safety', 'restore_execute', 'restore_abandon']) out[`ownerB_${a}`] = (await api(U.ownerB, a, { job_id: r.body.job_id })).status;
  assert.deepEqual(out, { viewer: 403, cashier: 403, no_actor: 403, no_actor_execute: 403, foreign_archive: 404, bad_uuid: 404,
    ownerB_restore_status: 200, ownerB_restore_load: 404, ownerB_restore_safety: 404, ownerB_restore_execute: 404, ownerB_restore_abandon: 404 });
  const sB = await api(U.ownerB, 'restore_status', { job_id: r.body.job_id });
  assert.equal(sB.body.job, null, 'other tenant sees no job');
  assert.equal((await api(U.ownerA, 'restore_abandon', { job_id: r.body.job_id })).status, 200);
  note('E3', out);
});

test('E4 restore v3 via API: fresh archive, BRR-080 without safety, safety archive, concurrent write counted, exact diff', async () => {
  const ctlB = await state(B);
  await q(`SELECT _br_v3_request_capture($1, 'e4', 'platform_manual')`, [A]);
  const src = await cronArchive(A);
  const atArchive = await state(A);
  const cBefore = await counters(A);
  await q(`INSERT INTO customers (tenant_id, name, balance) VALUES ($1, 'Evolution E4', 5)`, [A]);
  await q(`UPDATE customers SET balance = balance + 77 WHERE id = 'cc000000-0000-0000-0000-000000000001'`);
  for (let i = 0; i < 3; i++) await nextSale(A, S.A2);
  const req = await api(U.ownerA, 'restore_request', { operation: 'restore_v3', archive_id: src.id });
  assert.equal(req.status, 200); assert.equal(req.body.scope, 'all_sites');
  const cronLoad = await api(null, 'restore_load', {}, true);
  assert.equal(cronLoad.status, 200, 'cron-only load works without actor');
  const ld = await loadAll(U.ownerA, req.body.job_id);
  assert.equal(ld.body.outcome, 'prepared', JSON.stringify(ld.body));
  const st = await api(U.ownerA, 'restore_status', { job_id: req.body.job_id });
  assert.equal(st.body.scope, 'all_sites'); assert.equal(st.body.job.status, 'prepared');

  const pre = await state(A);
  const noSafety = await api(U.ownerA, 'restore_execute', { job_id: req.body.job_id });
  assert.deepEqual([noSafety.status, noSafety.body.code], [409, 'BRR-080']);
  assert.equal((await job(req.body.job_id)).execute_requested_at, null);
  assert.deepEqual(diff(pre, await state(A)), [], 'refusal before any business mutation');

  const sf = await api(U.ownerA, 'restore_safety', { job_id: req.body.job_id });
  assert.equal(sf.status, 200, JSON.stringify(sf.body));
  const safety = await cronArchive(A);
  const c2 = client({ database: DB }); await c2.connect();
  await c2.query(`INSERT INTO customers (tenant_id, name, balance) VALUES ($1, 'Concurrent E4', 3)`, [A]);
  await c2.end();
  const liveCustomers = (await one(`SELECT count(*)::int n FROM customers WHERE tenant_id = $1`, [A])).n;
  const ex = await api(U.ownerA, 'restore_execute', { job_id: req.body.job_id });
  assert.equal(ex.status, 202, JSON.stringify(ex.body)); assert.equal(ex.body.safety_archive_id, safety.id);
  await runExecutor();
  const j = await job(req.body.job_id);
  assert.equal(j.status, 'succeeded', JSON.stringify(j));
  assert.equal(j.safety_archive_id, safety.id);
  const d = diff(atArchive, await state(A));
  assert.deepEqual(d.filter((k) => !['tenant_doc_counters', 'profiles'].includes(k)), [], JSON.stringify(d));
  assert.ok(BigInt((await counters(A)).sale) >= BigInt(cBefore.sale) + 3n, 'counters never go back');
  const sc = await one(`SELECT rows::int FROM _br_restore_safety_tables WHERE job_id = $1 AND table_name = 'customers'`, [j.id]);
  assert.equal(sc?.rows, liveCustomers, 'concurrent write included in the in-swap safety copy');
  assert.equal((await one(`SELECT count(*)::int n FROM _br_restore_safety WHERE job_id = $1 AND row_data->>'name' = 'Concurrent E4'`, [j.id])).n, 1);
  assert.deepEqual(diff(ctlB, await state(B)), [], 'control tenant intact');
  note('E4', { diff_justified: d, safety_rows_customers: sc.rows, refused: noSafety.body.code });
});

test('E5 rollback after first writes: counts and fingerprints identical before/after', async () => {
  await q(`SELECT _br_v3_request_capture($1, 'e5', 'platform_manual')`, [A]);
  const src = await cronArchive(A);
  await q(`INSERT INTO customers (tenant_id, name, balance) VALUES ($1, 'Evolution E5', 9)`, [A]);
  const req = await api(U.ownerA, 'restore_request', { operation: 'restore_v3', archive_id: src.id });
  assert.equal((await loadAll(U.ownerA, req.body.job_id)).body.outcome, 'prepared');
  await q(`UPDATE _br_restore_rows SET row_data = jsonb_set(row_data, '{sale_id}', to_jsonb(gen_random_uuid()::text))
    WHERE job_id = $1 AND table_name = 'sale_returns' AND ord = (SELECT max(ord) FROM _br_restore_rows WHERE job_id = $1 AND table_name = 'sale_returns')`, [req.body.job_id]);
  await api(U.ownerA, 'restore_safety', { job_id: req.body.job_id });
  await cronArchive(A);
  const before = await state(A); const ctlB = await state(B);
  assert.equal((await api(U.ownerA, 'restore_execute', { job_id: req.body.job_id })).status, 202);
  await runExecutor();
  const j = await job(req.body.job_id);
  assert.equal(j.status, 'failed');
  assert.deepEqual(diff(before, await state(A)), [], 'all restore writes undone');
  assert.deepEqual(diff(ctlB, await state(B)), []);
  assert.equal((await one(`SELECT count(*)::int n FROM _br_tenant_maintenance`)).n, 0);
  const st = await api(U.ownerA, 'restore_status', { job_id: j.id });
  assert.equal(st.body.job.status, 'failed');
  note('E5', { status: j.status, error_code: j.error_code, fingerprints_equal: true });
});

test('E6 global reset via API: both shops emptied, structure kept, new session and sale', async () => {
  const ctlB = await state(B); const cBefore = await counters(A);
  const req = await api(U.superA, 'restore_request', { operation: 'reset' });
  assert.equal(req.status, 200, JSON.stringify(req.body)); assert.equal(req.body.scope, 'all_sites');
  const noSafety = await api(U.superA, 'restore_execute', { job_id: req.body.job_id });
  assert.equal(noSafety.body.code, 'BRR-080');
  await api(U.superA, 'restore_safety', { job_id: req.body.job_id });
  await cronArchive(A);
  assert.equal((await api(U.superA, 'restore_execute', { job_id: req.body.job_id })).status, 202);
  await runExecutor();
  const j = await job(req.body.job_id);
  assert.equal(j.status, 'succeeded', JSON.stringify(j));
  const n = await one(`SELECT (SELECT count(*)::int FROM sales WHERE tenant_id = $1) s, (SELECT count(*)::int FROM cash_sessions WHERE tenant_id = $1) cs,
    (SELECT count(*)::int FROM sites WHERE tenant_id = $1) sites, (SELECT count(*)::int FROM cash_registers WHERE tenant_id = $1) regs,
    (SELECT count(*)::int FROM profiles WHERE tenant_id = $1) prof, (SELECT coalesce(sum(abs(balance)),0)::text FROM customers WHERE tenant_id = $1) bal`, [A]);
  assert.deepEqual([n.s, n.cs, Number(n.bal)], [0, 0, 0]);
  assert.ok(n.sites >= 2 && n.regs >= 2 && n.prof >= 3, JSON.stringify(n));
  assert.deepEqual(await counters(A), cBefore, 'counters kept');
  assert.deepEqual(diff(ctlB, await state(B)), [], 'control tenant intact');
  const reg = await one(`SELECT id FROM cash_registers WHERE site_id = $1 ORDER BY is_default DESC LIMIT 1`, [S.A1]);
  await q(`INSERT INTO cash_sessions (tenant_id, site_id, cash_register_id, user_id, status) VALUES ($1, $2, $3, $4, 'open')`, [A, S.A1, reg.id, U.cashierA]);
  const ns = await nextSale(A, S.A1);
  assert.equal(BigInt((await counters(A)).sale), BigInt(cBefore.sale) + 1n);
  note('E6', { kept: n, new_sale: ns });
});
