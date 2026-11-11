// Lot D — restauration v3/v2 et réinitialisation sûres (PostgreSQL 17 local isolé, données synthétiques uniquement).
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { client } from './deps.mjs';
import { installSchema, installLotC, SEED, IDS } from './fixtures.mjs';
import { LOTD_SCHEMA, LOTD_REGISTRY_PROFILES, LOTD_SEED, LOTD_TEST_HELPERS, lotDSql, U, S } from './lotd_fixtures.mjs';
import { importAesKey, runExportInvocation, runRestoreLoadInvocation } from '../../supabase/functions/backup-export-v3/core.ts';

const DB = 'br_v3_lotd';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { A, B } = IDS;
let c;
const q = (s, p) => c.query(s, p);
const one = async (s, p) => (await q(s, p)).rows[0];
const errOf = async (s, p) => { try { await q(s, p); return null; } catch (e) { return e.message; } };
async function rpc(fn, args) {
  const names = Object.keys(args);
  const sql = `SELECT ${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) AS r`;
  return (await q(sql, names.map((n) => args[n]))).rows[0].r;
}
function memStore() {
  const m = new Map();
  return {
    m,
    async put(p, b) { if (m.has(p)) throw new Error('object exists'); m.set(p, new Uint8Array(b)); },
    async get(p) { if (!m.has(p)) throw new Error('not found'); return m.get(p); },
  };
}
class SimulatedCrash extends Error { constructor(p) { super(p); this.name = 'SimulatedCrash'; } }

let ring;
const store = memStore();
let period = 0;
const results = [];
const note = (id, detail) => results.push({ id, ...detail });

const state = async (t) => (await one(`SELECT _t_tenant_state($1) s`, [t])).s;
const diff = (x, y) => Object.keys({ ...x, ...y }).filter((k) => x[k] !== y[k]).sort();
const job = (id) => one(`SELECT * FROM _br_restore_jobs WHERE id = $1`, [id]);
const leftovers = async (id) => one(`SELECT
  (SELECT count(*)::int FROM _br_restore_rows WHERE job_id = $1) rows,
  (SELECT count(*)::int FROM _br_tenant_maintenance) maint,
  (SELECT count(*)::int FROM _br_restore_context) ctx`, [id]);

async function v3Archive(tenant) {
  const r = (await one(`SELECT _br_v3_request_capture($1, $2) r`, [tenant, `d${++period}`])).r;
  const cl = await one(`SELECT * FROM _br_job_claim('cap', 900)`);
  assert.equal(cl.job_id, r.job_id);
  await q(`SELECT _br_job_mark_processing($1, $2)`, [cl.job_id, cl.lease_token]);
  await q(`SET statement_timeout = '60s'`);
  await q(`SELECT _br_capture_run($1, $2)`, [cl.job_id, cl.lease_token]);
  await q(`SET statement_timeout = 0`);
  const g = (await one(`SELECT capture_generation_id g FROM _br_backup_jobs WHERE id = $1`, [r.job_id])).g;
  let last;
  for (let i = 0; i < 300; i++) {
    last = await runExportInvocation({ rpc, store, keyring: ring }, 'exp');
    if (['verified', 'failed', 'idle'].includes(last.outcome)) break;
  }
  assert.equal(last.outcome, 'verified');
  const a = await one(`SELECT * FROM _br_v3_archives WHERE generation_id = $1`, [g]);
  const progress = Object.fromEntries((await q(`SELECT table_name, rows_captured::text || ':' || coalesce(checksum, '-') v
    FROM _br_capture_progress WHERE generation_id = $1`, [g])).rows.map((x) => [x.table_name, x.v]));
  return { a, progress };
}
async function loadV3(jobId, { maxBlocks = 3, checkpoint, worker = 'rw' } = {}) {
  let r;
  for (let i = 0; i < 200; i++) {
    r = await runRestoreLoadInvocation({ rpc, store, keyring: ring, checkpoint }, jobId, worker, maxBlocks);
    if (r.outcome !== 'progress') return r;
  }
  return r;
}
const request = (tenant, fmt, src, actor = U.ownerA) =>
  rpc('_br_rs_request_restore', { p_tenant: tenant, p_actor: actor, p_format: fmt, p_source: src });
const call = async (jobId) => (await one(`CALL _br_rs_executor($1, 'wx', NULL)`, [jobId])).p_result;
async function execute(jobId, actor = U.ownerA) {
  const e = await rpc('_br_rs_request_execute', { p_job: jobId, p_actor: actor });
  assert.equal(e.execute_requested, true);
  return call(jobId);
}
const makeV2 = async (t, omit = [], created = new Date().toISOString(), drop = {}, style = 'sha256') =>
  (await one(`SELECT _t_make_v2($1, $2, $3, $4, $5) id`, [t, omit, created, JSON.stringify(drop), style])).id;
const backupsHash = async () => (await one(`SELECT count(*)::int n, md5(string_agg(id::text || status::text || md5(payload::text), ',' ORDER BY id)) h FROM tenant_backups`));
const nextSale = async (t, site) => (await one(`INSERT INTO sales (tenant_id, site_id, total) VALUES ($1, $2, 1) RETURNING sale_number`, [t, site])).sale_number;

// Mutations après archivage : lignes en plus, soldes changés, ligne supprimée, numéros consommés.
async function mutateA(tag) {
  await q(`INSERT INTO customers (tenant_id, name, balance) VALUES ($1, 'Extra ${tag}', 1)`, [A]);
  await q(`INSERT INTO sites (tenant_id, name) VALUES ($1, 'Magasin extra ${tag}')`, [A]);
  await q(`UPDATE customers SET balance = balance + 999 WHERE id = 'cc000000-0000-0000-0000-000000000001'`);
  await q(`UPDATE vaults SET current_balance = 0 WHERE tenant_id = $1`, [A]);
  await q(`UPDATE stock_levels SET quantity = quantity + 100 WHERE tenant_id = $1`, [A]);
  await q(`DELETE FROM sale_returns WHERE tenant_id = $1`, [A]);
  for (let i = 0; i < 5; i++) await nextSale(A, S.A1);
  await q(`INSERT INTO cash_movements (tenant_id, session_id, kind, amount) VALUES ($1, '5e000000-0000-0000-0000-000000000003', 'ACO', 7)`, [A]);
  await q(`UPDATE profiles SET default_site_id = (SELECT id FROM sites WHERE name = 'Magasin extra ${tag}') WHERE id = $1`, [U.cashierA]);
}
const counters = async (t) => Object.fromEntries((await q(`SELECT doc_kind, last_number::text n FROM tenant_doc_counters WHERE tenant_id = $1`, [t])).rows.map((r) => [r.doc_kind, r.n]));

test.before(async () => {
  const admin = client(); await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DB}`);
  await admin.end();
  c = client({ database: DB }); c.on('error', () => {}); await c.connect();
  await installSchema((s) => q(s));
  await q(SEED);
  await q(LOTD_SCHEMA);
  await q(LOTD_REGISTRY_PROFILES);
  await installLotC((s) => q(s));
  await q(LOTD_SEED);
  await q(lotDSql());
  await q(LOTD_TEST_HELPERS);
  await q(`UPDATE _br_v3_export_config SET enabled = true, block_target_bytes = 2048, row_max_bytes = 8192, max_blocks_per_invocation = 4`);
  ring = { currentId: 'k1', keys: new Map([['k1', await importAesKey(randomBytes(32))]]) };
});
test.after(async () => {
  console.log('LOTD_RESULTS ' + JSON.stringify(results));
  await c?.end();
});

test('D0 inactive by default: disabled config, no hooks, no rights for users, context unreachable', async () => {
  const cfg = await one(`SELECT enabled FROM _br_restore_config`);
  assert.equal(cfg.enabled, false);
  const v2 = await makeV2(A);
  assert.match(await errOf(`SELECT _br_rs_request_restore($1, $2, 2, $3)`, [A, U.ownerA, v2]), /BRR-000/);
  assert.match(await errOf(`SELECT _br_rs_request_reset($1, $2)`, [A, U.ownerA]), /BRR-000/);
  assert.equal((await one(`SELECT _br_lotd_hooks_status() s`)).s.ok, false);
  for (const role of ['authenticated', 'anon']) {
    await q(`SET ROLE ${role}`);
    for (const sql of [`SELECT _br_rs_request_restore('${A}', '${U.ownerA}', 2, '${v2}')`, `SELECT _br_rs_request_reset('${A}', '${U.ownerA}')`,
      `SELECT _br_rs_recover()`, `SELECT _br_lotd_install_hooks()`, `CALL _br_rs_executor('${v2}', 'x', NULL)`,
      `INSERT INTO _br_restore_context VALUES (pg_backend_pid(), txid_current(), '${A}', '${v2}')`,
      `SELECT * FROM _br_restore_safety`, `UPDATE _br_restore_config SET enabled = true`]) {
      assert.match(await errOf(sql), /permission denied/, `${role}: ${sql}`);
    }
    await q(`SET brtest.bypass = 'on'`);
    assert.equal((await one(`SELECT _br_restore_bypass() b`)).b, false);
    await q(`RESET ROLE`);
  }
  assert.equal((await one(`SELECT _br_restore_bypass() b`)).b, false);
  note('D0', { executed: true });
});

test('D1 hooks required: an enabled engine still refuses the swap until gates and trigger guards exist', async () => {
  await q(`UPDATE _br_restore_config SET enabled = true, lease_seconds = 30, maintenance_ttl_seconds = 60, swap_lock_timeout_ms = 500`);
  const before = await state(A);
  const r = await request(A, 2, await makeV2(A));
  assert.equal((await call(r.job_id)).awaiting, 'execute_request');
  const out = await execute(r.job_id);
  assert.equal(out.status, 'failed');
  assert.equal(out.error_code, 'BRR-070');
  assert.deepEqual(diff(before, await state(A)), []);
  assert.deepEqual(await leftovers(r.job_id), { rows: 0, maint: 0, ctx: 0 });
  const h = (await one(`SELECT _br_lotd_install_hooks() h`)).h;
  const nreg = (await one(`SELECT count(*)::int n FROM _br_table_registry WHERE tenant_link IN ('direct','indirect')`)).n;
  assert.ok(h.gates === nreg && h.wrapped >= 9, JSON.stringify(h));
  assert.equal((await one(`SELECT _br_lotd_hooks_status() s`)).s.ok, true);
  assert.deepEqual((await one(`SELECT _br_lotd_install_hooks() h`)).h.wrapped, 0, 'idempotent');
  assert.equal((await one(`SELECT br_check_schema_drift() d`)).d.drift_detected, false);
  note('D1', { executed: true, hooks: h });
});

test('D2 authorization and tenant isolation: non-admin, other tenant, other tenant source, user session', async () => {
  const v2B = await makeV2(B);
  const v2A = await makeV2(A);
  assert.match(await errOf(`SELECT _br_rs_request_restore($1, $2, 2, $3)`, [A, U.cashierA, v2A]), /BRR-403/);
  assert.match(await errOf(`SELECT _br_rs_request_restore($1, $2, 2, $3)`, [A, U.ownerB, v2A]), /BRR-403/);
  assert.match(await errOf(`SELECT _br_rs_request_restore($1, $2, 2, $3)`, [A, U.ownerA, v2B]), /BRR-404/);
  assert.match(await errOf(`SELECT _br_rs_request_reset($1, $2)`, [B, U.ownerA]), /BRR-403/);
  await q(`UPDATE profiles SET is_active = false WHERE id = $1`, [U.superA]);
  assert.match(await errOf(`SELECT _br_rs_request_reset($1, $2)`, [A, U.superA]), /BRR-403/);
  await q(`UPDATE profiles SET is_active = true WHERE id = $1`, [U.superA]);
  await q(`SET ROLE service_role`);
  const r = await request(A, 2, v2A, U.superA);
  assert.equal(r.status, 'preparing');
  assert.match(await errOf(`SELECT _br_rs_request_execute($1, $2)`, [r.job_id, U.ownerB]), /BRR-403/);
  assert.match(await errOf(`SELECT _br_rs_abandon($1, $2)`, [r.job_id, U.ownerB]), /BRR-403/);
  assert.equal((await rpc('_br_rs_abandon', { p_job: r.job_id, p_actor: U.superA })).status, 'abandoned');
  await q(`RESET ROLE`);
  await q(`SET ROLE authenticated`);
  assert.match(await errOf(`SELECT _br_rs_verify($1, gen_random_uuid())`, [r.job_id]), /permission denied/);
  await q(`RESET ROLE`);
  note('D2', { executed: true });
});

test('D3 v2 restore exact: extra rows removed, balances/stock/prepayments back, profiles/auth kept, counters max, control tenant intact', async () => {
  const before = await state(A);
  const ctlB = await state(B);
  const cBefore = await counters(A);
  const v2 = await makeV2(A);
  const bk = await backupsHash();
  await mutateA('d3');
  const cMut = await counters(A);
  const r = await request(A, 2, v2);
  assert.equal((await call(r.job_id)).awaiting, 'execute_request');
  const out = await execute(r.job_id);
  assert.equal(out.status, 'succeeded', JSON.stringify(out));
  const after = await state(A);
  const d = diff(before, after);
  assert.deepEqual(d.filter((k) => !['tenant_doc_counters', 'profiles'].includes(k)), [], JSON.stringify(d));
  assert.equal(after['auth.users'], before['auth.users']);
  const cAfter = await counters(A);
  for (const k of Object.keys(cMut)) assert.ok(BigInt(cAfter[k]) >= BigInt(cMut[k]) && BigInt(cAfter[k]) >= BigInt(cBefore[k] ?? 0), k);
  const p = await one(`SELECT default_site_id FROM profiles WHERE id = $1`, [U.cashierA]);
  assert.equal(p.default_site_id, null, 'default site pointed to a shop absent from the archive');
  assert.equal((await one(`SELECT count(*)::int n FROM sites WHERE tenant_id = $1 AND name LIKE 'Magasin extra%'`, [A])).n, 0);
  assert.equal((await one(`SELECT balance::text b FROM customers WHERE id = 'cc000000-0000-0000-0000-000000000001'`)).b, '2500.00');
  assert.equal((await one(`SELECT current_balance::text b FROM vaults WHERE site_id = $1`, [S.A2])).b, '99999999999999.99');
  assert.equal((await one(`SELECT big::text b FROM cash_movements WHERE id = '3e000000-0000-0000-0000-000000000001'`)).b, '9223372036854775807');
  assert.deepEqual(diff(ctlB, await state(B)), []);
  assert.deepEqual(await backupsHash(), bk, 'existing backups untouched');
  const sf = await one(`SELECT count(*)::int t, sum(rows)::int r FROM _br_restore_safety_tables WHERE job_id = $1`, [r.job_id]);
  assert.ok(sf.t > 0 && sf.r > 0 && sf.r === out.report.safety.rows, JSON.stringify(sf));
  assert.deepEqual(await leftovers(r.job_id), { rows: 0, maint: 0, ctx: 0 });
  const ns = await nextSale(A, S.A1);
  assert.equal((await one(`SELECT count(*)::int n FROM sales WHERE tenant_id = $1 AND sale_number = $2`, [A, ns])).n, 1);
  note('D3', { executed: true, report: out.report?.counters, diff: d });
});

test('D4 v2 compatibility: md5/sha256/empty checksums, altered archives refused before mutation, old archive, missing table, format', async () => {
  const styles = {};
  for (const style of ['md5', 'sha256']) {
    if (style === 'md5') await q(`DELETE FROM cash_supervision_requests WHERE tenant_id = $1`, [A]);
    const v2 = await makeV2(A, [], new Date().toISOString(), {}, style);
    const ck = (await one(`SELECT checksums c FROM tenant_backups WHERE id = $1`, [v2])).c;
    const lens = [...new Set(Object.values(ck).map((x) => (x === null ? 'null' : String(x.length))))].sort();
    styles[style] = lens;
    if (style === 'md5') assert.deepEqual(lens, ['0', '32'], JSON.stringify(ck));
    const before = await state(A);
    await mutateA(`d4${style}`);
    const r = await request(A, 2, v2);
    assert.equal((await call(r.job_id)).awaiting, 'execute_request');
    const out = await execute(r.job_id);
    assert.equal(out.status, 'succeeded', JSON.stringify(out));
    const d = diff(before, await state(A));
    assert.deepEqual(d.filter((k) => !['tenant_doc_counters', 'profiles'].includes(k)), [], `${style} ${JSON.stringify(d)}`);
    assert.deepEqual(await leftovers(r.job_id), { rows: 0, maint: 0, ctx: 0 });
  }

  const tamper = {
    payload_value: `UPDATE tenant_backups SET payload = jsonb_set(payload, '{customers,0,balance}', '"1.00"') WHERE id = $1`,
    payload_row_removed: `UPDATE tenant_backups SET payload = jsonb_set(payload, '{sales}', (payload -> 'sales') - 0) WHERE id = $1`,
    checksum_value: `UPDATE tenant_backups SET checksums = jsonb_set(checksums, '{sites}', '"00000000000000000000000000000000"') WHERE id = $1`,
    row_count_value: `UPDATE tenant_backups SET row_counts = jsonb_set(row_counts, '{articles}', '999') WHERE id = $1`,
  };
  const refused = {};
  for (const [name, sql] of Object.entries(tamper)) {
    const v2 = await makeV2(A, [], new Date().toISOString(), {}, 'md5');
    await q(sql, [v2]);
    const before = await state(A);
    const ctlB = await state(B);
    const r = await request(A, 2, v2);
    const out = await call(r.job_id);
    assert.equal(out.status, 'failed', `${name} ${JSON.stringify(out)}`);
    assert.match(out.error_code, /^BRR-03[01]$/, name);
    refused[name] = out.error_code;
    const j = await job(r.job_id);
    assert.equal(j.execute_requested_at, null);
    assert.deepEqual(diff(before, await state(A)), [], name);
    assert.deepEqual(diff(ctlB, await state(B)), [], name);
    assert.deepEqual(await leftovers(r.job_id), { rows: 0, maint: 0, ctx: 0 }, name);
    assert.match(await errOf(`SELECT _br_rs_request_execute($1, $2)`, [r.job_id, U.ownerA]), /BRR-003/);
  }

  const regs = await one(`SELECT count(*)::int n, md5(string_agg(id::text || code, ',' ORDER BY id)) h FROM cash_registers WHERE tenant_id = $1`, [A]);
  const old = await makeV2(A, ['cash_registers', 'cash_register_assignments', 'cash_supervision_requests'], '2026-10-01T00:00:00Z', { cash_sessions: ['cash_register_id'] });
  const ro = await request(A, 2, old);
  assert.deepEqual(ro.historically_absent, ['cash_register_assignments', 'cash_registers', 'cash_supervision_requests']);
  assert.equal((await call(ro.job_id)).awaiting, 'execute_request');
  const oo = await execute(ro.job_id);
  assert.equal(oo.status, 'succeeded', JSON.stringify(oo));
  assert.deepEqual(await one(`SELECT count(*)::int n, md5(string_agg(id::text || code, ',' ORDER BY id)) h FROM cash_registers WHERE tenant_id = $1`, [A]), regs);
  assert.equal((await one(`SELECT count(*)::int n FROM cash_sessions s WHERE s.tenant_id = $1 AND NOT EXISTS
    (SELECT 1 FROM cash_registers g WHERE g.id = s.cash_register_id AND g.site_id = s.site_id)`, [A])).n, 0);

  const miss = await request(A, 2, await makeV2(A, ['sales'], '2026-10-01T00:00:00Z'));
  assert.equal(miss.status, 'failed');
  assert.equal(miss.error_code, 'BRR-020');
  const v1 = await makeV2(A);
  await q(`UPDATE tenant_backups SET format_version = 1 WHERE id = $1`, [v1]);
  assert.match(await errOf(`SELECT _br_rs_request_restore($1, $2, 2, $3)`, [A, U.ownerA, v1]), /BRR-010/);
  assert.match(await errOf(`SELECT _br_rs_request_restore($1, $2, 4, $3)`, [A, U.ownerA, v1]), /BRR-010/);
  note('D4', { executed: true, styles, refused, old_archive: oo.report?.kept_historically_absent, sessions_fixed: true });
});

test('D5 v3 restore of a real Lot C archive: crash + resume, block replay, multi-register refs, precision, tampering refused', async () => {
  const refs = async () => one(`SELECT
    (SELECT cash_register_id::text || '|' || coalesce(closed_by::text, '-') FROM cash_sessions WHERE id = '5e000000-0000-0000-0000-000000000001') s1,
    (SELECT code FROM cash_registers g JOIN cash_sessions s ON s.cash_register_id = g.id WHERE s.id = '5e000000-0000-0000-0000-000000000001') reg,
    (SELECT count(*)::int FROM customer_prepayments p JOIN cash_movements m ON m.id = '3e000000-0000-0000-0000-000000000001' WHERE p.id = '9e000000-0000-0000-0000-000000000001') prepay,
    (SELECT count(*)::int FROM cash_register_assignments WHERE tenant_id = $1) assigns,
    (SELECT big::text FROM cash_movements WHERE id = '3e000000-0000-0000-0000-000000000001') big,
    (SELECT current_balance::text FROM vaults WHERE site_id = $2) vault`, [A, S.A2]);
  await q(`UPDATE cash_sessions SET cash_register_id = (SELECT id FROM cash_registers WHERE site_id = $1 AND code = 'CAISSE-2')
    WHERE id = '5e000000-0000-0000-0000-000000000001'`, [S.A1]);
  const before = await state(A);
  const ctlB = await state(B);
  const refsBefore = await refs();
  assert.equal(refsBefore.reg, 'CAISSE-2');
  const { a } = await v3Archive(A);
  assert.equal(a.status, 'verified');
  const bk = await backupsHash();
  await mutateA('d5');
  const mutated = await state(A);

  const r = await request(A, 3, a.id);
  assert.equal(r.status, 'preparing');
  assert.equal((await call(r.job_id)).awaiting, 'v3_block_worker');
  let crashed = false;
  const crash = await loadV3(r.job_id, { maxBlocks: 2, checkpoint: async (p) => {
    if (p === 'block_loaded' && !crashed) { crashed = true; throw new SimulatedCrash('after first block'); }
  } });
  assert.equal(crash.outcome, 'error', JSON.stringify({ crash, j: await job(r.job_id) }));
  const mid = await job(r.job_id);
  assert.equal(mid.status, 'preparing');
  assert.equal(mid.lease_token, null, 'lease released after crash');
  const staged = (await one(`SELECT count(*)::int n FROM _br_restore_rows WHERE job_id = $1`, [r.job_id])).n;
  assert.ok(staged > 0, 'first block kept for resume');
  assert.deepEqual(diff(mutated, await state(A)), [], 'live data untouched by loading');

  const cl = await one(`SELECT _br_rs_claim($1, 'replay') r`, [r.job_id]);
  const plan = (await one(`SELECT _br_rs_v3_plan($1, $2, 50) r`, [r.job_id, cl.r.token])).r;
  const loadedBlocks = (await one(`SELECT count(*)::int n FROM _br_v3_archive_blocks WHERE archive_id = $1`, [a.id])).n - Number(plan.remaining);
  assert.ok(loadedBlocks >= 1 && !plan.blocks.some((b) => Number(b.block_no) === 1), 'already loaded block not planned again');
  await q(`SELECT _br_rs_unlease($1, $2)`, [r.job_id, cl.r.token]);

  const res = await loadV3(r.job_id, { maxBlocks: 3 });
  assert.equal(res.outcome, 'prepared', JSON.stringify(res));
  const rows = await one(`SELECT sum(expected_rows)::int e FROM _br_restore_tables WHERE job_id = $1 AND presence = 'archived'`, [r.job_id]);
  assert.equal((await one(`SELECT count(*)::int n FROM _br_restore_rows WHERE job_id = $1`, [r.job_id])).n, rows.e, 'no duplicate rows after resume');
  assert.equal((await call(r.job_id)).awaiting, 'execute_request');
  const out = await execute(r.job_id);
  assert.equal(out.status, 'succeeded', JSON.stringify(out));
  const d = diff(before, await state(A));
  assert.deepEqual(d.filter((k) => !['tenant_doc_counters', 'profiles'].includes(k)), [], JSON.stringify(d));
  assert.deepEqual(await refs(), refsBefore);
  assert.equal(refsBefore.big, '9223372036854775807');
  assert.equal(refsBefore.vault, '99999999999999.99');
  assert.deepEqual(diff(ctlB, await state(B)), []);
  assert.deepEqual(await backupsHash(), bk);
  assert.deepEqual(await leftovers(r.job_id), { rows: 0, maint: 0, ctx: 0 });
  const ns = await nextSale(A, S.A1);
  assert.equal((await one(`SELECT count(*)::int n FROM sales WHERE tenant_id = $1 AND sale_number = $2`, [A, ns])).n, 1);

  const blocks = (await q(`SELECT block_no, object_path FROM _br_v3_archive_blocks WHERE archive_id = $1 ORDER BY block_no`, [a.id])).rows;
  assert.ok(blocks.length >= 2);
  const flip = (u) => { const x = new Uint8Array(u); x[x.length - 5] ^= 1; return x; };
  const cases = {
    block_bit_flip: () => { store.m.set(blocks[0].object_path, flip(store.m.get(blocks[0].object_path))); },
    block_swapped: () => { store.m.set(blocks[0].object_path, store.m.get(blocks[1].object_path)); },
    manifest_bit_flip: () => { store.m.set(a.manifest_path, flip(store.m.get(a.manifest_path))); },
    block_deleted: () => { store.m.delete(blocks[1].object_path); },
  };
  const refused = {};
  for (const [name, tamper] of Object.entries(cases)) {
    const saved = new Map(store.m);
    tamper();
    const s0 = await state(A);
    const rj = await request(A, 3, a.id);
    const lr = await loadV3(rj.job_id, { maxBlocks: 50 });
    refused[name] = `${lr.outcome}:${lr.error_code ?? ''}`;
    assert.ok(lr.outcome === 'failed' || lr.outcome === 'error', `${name} ${JSON.stringify(lr)}`);
    assert.notEqual((await job(rj.job_id)).status, 'prepared', name);
    if (lr.outcome === 'error') assert.equal((await rpc('_br_rs_abandon', { p_job: rj.job_id, p_actor: U.ownerA })).status, 'abandoned');
    assert.deepEqual(diff(s0, await state(A)), [], name);
    assert.deepEqual(await leftovers(rj.job_id), { rows: 0, maint: 0, ctx: 0 }, name);
    store.m.clear(); for (const [k, v] of saved) store.m.set(k, v);
  }
  assert.match(refused.manifest_bit_flip, /BRR-041/);
  assert.match(refused.block_bit_flip, /BRR-04[45]/);
  assert.match(refused.block_swapped, /BRR-04[45]/);
  note('D5', { executed: true, blocks: blocks.length, staged_before_crash: staged, refused, counters: out.report?.counters });
});

test('D6 rollback: failure after the first restore writes and at final check leaves tenant, backups and safety untouched', async () => {
  const v2 = await makeV2(A);
  await mutateA('d6');
  const mutated = await state(A);
  const ctlB = await state(B);
  const bk = await backupsHash();
  const epoch = async () => (await one(`SELECT changed_at::text c FROM _br_tenant_epoch WHERE tenant_id = $1`, [A]))?.c ?? null;
  const ep0 = await epoch();
  const r0 = await request(A, 2, v2);
  await call(r0.job_id);
  await q(`CREATE FUNCTION _t_boom() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''injected failure''; END'`);
  await q(`CREATE TRIGGER _t_boom BEFORE INSERT ON sale_returns FOR EACH ROW EXECUTE FUNCTION _t_boom()`);
  const o0 = await execute(r0.job_id);
  await q(`DROP TRIGGER _t_boom ON sale_returns`);
  await q(`DROP FUNCTION _t_boom()`);
  assert.equal(o0.error_code, 'BRR-070', 'unguarded trigger on a restored table blocks the swap');

  const r1 = await request(A, 2, v2);
  await call(r1.job_id);
  const bad = await q(`UPDATE _br_restore_rows SET row_data = jsonb_set(row_data, '{sale_id}', to_jsonb(gen_random_uuid()::text))
    WHERE job_id = $1 AND table_name = 'sale_returns' AND ord = (SELECT max(ord) FROM _br_restore_rows WHERE job_id = $1 AND table_name = 'sale_returns')`, [r1.job_id]);
  assert.equal(bad.rowCount, 1);
  const o1 = await execute(r1.job_id);
  assert.equal(o1.status, 'failed', JSON.stringify(o1));
  assert.match(o1.error, /foreign key|sale_returns/);
  const outcomes = { unguarded_trigger: o0.error_code, mid_insert_fk: o1.error_code };

  const r2 = await request(A, 2, v2);
  await call(r2.job_id);
  await q(`INSERT INTO _br_restore_rows (job_id, table_name, ord, row_data)
    SELECT job_id, table_name, ord + 100000, jsonb_set(row_data, '{id}', to_jsonb(gen_random_uuid()::text))
    FROM _br_restore_rows WHERE job_id = $1 AND table_name = 'customers' ORDER BY ord LIMIT 1`, [r2.job_id]);
  const o2 = await execute(r2.job_id);
  assert.equal(o2.status, 'failed', JSON.stringify(o2));
  outcomes.final_check = o2.error_code;
  assert.equal(o2.error_code, 'BRR-077');

  for (const id of [r0.job_id, r1.job_id, r2.job_id]) {
    assert.equal((await job(id)).status, 'failed');
    assert.deepEqual(await leftovers(id), { rows: 0, maint: 0, ctx: 0 });
    assert.equal((await one(`SELECT count(*)::int n FROM _br_restore_safety_tables WHERE job_id = $1`, [id])).n, 0, 'safety copy rolled back');
  }
  assert.deepEqual(diff(mutated, await state(A)), [], 'all restore writes undone');
  assert.deepEqual(diff(ctlB, await state(B)), []);
  assert.deepEqual(await backupsHash(), bk);
  assert.deepEqual(await epoch(), ep0, 'epoch not bumped');
  const ns = await nextSale(A, S.A1);
  assert.ok(ns);
  note('D6', { executed: true, outcomes });
});

test('D7 replay, double request, recover and concurrent writes on several PostgreSQL connections', async () => {
  const c2 = client({ database: DB }); c2.on('error', () => {}); await c2.connect();
  const w2 = async (sql, p) => { try { await c2.query(sql, p); return 'ok'; } catch (e) { return e.message; } };
  const touchA = `UPDATE customers SET name = name WHERE id = 'cc000000-0000-0000-0000-000000000001'`;
  const touchB = `UPDATE customers SET name = name WHERE tenant_id = '${B}'`;
  const out = {};
  try {
    const v2 = await makeV2(A);
    const r = await request(A, 2, v2);
    assert.match(await errOf(`SELECT _br_rs_request_restore($1, $2, 2, $3)`, [A, U.ownerA, v2]), /BRR-002/);
    assert.match(await errOf(`SELECT _br_rs_request_reset($1, $2)`, [A, U.ownerA]), /BRR-002/);
    assert.match(await errOf(`SELECT _br_rs_request_execute($1, $2)`, [r.job_id, U.ownerA]), /BRR-003/);
    assert.equal((await call(r.job_id)).awaiting, 'execute_request');
    assert.equal((await call(r.job_id)).awaiting, 'execute_request', 'executor replay before execution is harmless');
    await rpc('_br_rs_request_execute', { p_job: r.job_id, p_actor: U.ownerA });
    assert.match(await errOf(`SELECT _br_rs_request_execute($1, $2)`, [r.job_id, U.ownerA]), /BRR-004/);

    await c2.query('BEGIN');
    assert.equal(await w2(touchA), 'ok');
    const t0 = Date.now();
    const blocked = await call(r.job_id);
    out.lock_wait_ms = Date.now() - t0;
    await c2.query('ROLLBACK');
    assert.equal(blocked.status, 'failed', JSON.stringify(blocked));
    assert.equal(blocked.error_code, 'BRR-074');
    assert.deepEqual(await leftovers(r.job_id), { rows: 0, maint: 0, ctx: 0 });
    assert.match(await errOf(`CALL _br_rs_executor($1, 'wx', NULL)`, [r.job_id]), /BRR-003/, 'failed job cannot be replayed');

    const before = await state(A);
    const r2 = await request(A, 2, v2);
    await call(r2.job_id);
    await rpc('_br_rs_request_execute', { p_job: r2.job_id, p_actor: U.ownerA });
    await c2.query('BEGIN');
    assert.equal(await w2(touchA), 'ok');
    const pending = call(r2.job_id);
    await sleep(300);
    await c2.query('COMMIT');
    const done = await pending;
    assert.equal(done.status, 'succeeded', JSON.stringify(done));
    assert.match(await errOf(`CALL _br_rs_executor($1, 'wx', NULL)`, [r2.job_id]), /BRR-003/, 'succeeded job cannot be replayed');
    const afterOk = await state(A);
    assert.deepEqual(diff(before, afterOk).filter((k) => !['tenant_doc_counters', 'profiles'].includes(k)), []);

    await c2.query('BEGIN');
    await c2.query('SELECT 1');
    const r3 = await request(A, 2, v2);
    await call(r3.job_id);
    assert.equal((await execute(r3.job_id)).status, 'succeeded');
    out.stale_tx_A = await w2(touchA);
    await c2.query('ROLLBACK');
    assert.match(out.stale_tx_A, /BR-504/);
    assert.equal(await w2(touchA), 'ok', 'fresh transaction writes again');

    const r4 = await request(A, 2, v2);
    await call(r4.job_id);
    await rpc('_br_rs_request_execute', { p_job: r4.job_id, p_actor: U.ownerA });
    const tok = (await one(`SELECT _br_rs_claim($1, 'm') r`, [r4.job_id])).r.token;
    await q(`SELECT _br_rs_enter_maintenance($1, $2)`, [r4.job_id, tok]);
    const r5 = await request(B, 2, await makeV2(B), U.ownerB);
    assert.match(await errOf(`SELECT _br_rs_enter_maintenance($1, $2)`, [r4.job_id, '00000000-0000-0000-0000-000000000000']), /BRR-06[01]/);
    out.maint_A = await w2(touchA);
    out.maint_B = await w2(touchB);
    assert.match(out.maint_A, /BR-503/);
    assert.equal(out.maint_B, 'ok', 'other tenant keeps writing');
    assert.equal((await rpc('_br_rs_abandon', { p_job: r5.job_id, p_actor: U.ownerB })).status, 'abandoned');
    await q(`SELECT _br_rs_unlease($1, $2)`, [r4.job_id, tok]);
    await q(`INSERT INTO _br_restore_context (backend_pid, xact_id, tenant_id, job_id) VALUES (2147483000, 1, $1, $2)`, [A, r4.job_id]);
    const rec = await rpc('_br_rs_recover', {});
    out.recover = rec;
    assert.ok(rec.released_maintenance >= 1 && rec.stale_contexts >= 1, JSON.stringify(rec));
    assert.equal(await w2(touchA), 'ok', 'tenant writable after recover');
    assert.equal((await rpc('_br_rs_abandon', { p_job: r4.job_id, p_actor: U.ownerA })).status, 'abandoned');
    assert.deepEqual(await leftovers(r4.job_id), { rows: 0, maint: 0, ctx: 0 });
  } finally {
    await c2.end();
  }
  note('D7', { executed: true, ...out });
});

test('D8 global reset of the 2-shop tenant: structure, profiles, permissions, counters kept; operations deleted; balances zeroed; control tenant intact', async () => {
  const zeroed = ['customers', 'suppliers', 'vaults', 'mt_accounts', 'stock_levels'];
  const reg = (await q(`SELECT table_name, reset_behavior FROM _br_table_registry WHERE tenant_link IN ('direct','indirect')`)).rows;
  const deleted = reg.filter((t) => (t.reset_behavior === 'delete' && t.table_name !== 'tenant_doc_counters') || t.table_name === 'stock_lots').map((t) => t.table_name).sort();
  const kept = reg.map((t) => t.table_name).filter((n) => !deleted.includes(n) && !zeroed.includes(n)).sort();
  const ids = async (t) => (await one(`SELECT count(*)::int n, md5(string_agg(id::text, ',' ORDER BY id)) h FROM ${t} WHERE tenant_id = $1`, [A]));
  const before = await state(A);
  const ctlB = await state(B);
  const bk = await backupsHash();
  const cBefore = await counters(A);
  const idsBefore = Object.fromEntries(await Promise.all(zeroed.map(async (t) => [t, await ids(t)])));
  const sitesBefore = (await q(`SELECT name FROM sites WHERE tenant_id = $1 ORDER BY name`, [A])).rows.map((x) => x.name);
  assert.ok(sitesBefore.includes('Magasin A1') && sitesBefore.includes('Magasin A2'));
  const opsBefore = {};
  for (const t of deleted) opsBefore[t] = (await one(`SELECT count(*)::int n FROM ${t} WHERE tenant_id = $1`, [A])).n;
  assert.ok(opsBefore.sales > 0 && opsBefore.cash_sessions > 0 && opsBefore.stock_lots > 0, JSON.stringify(opsBefore));

  assert.match(await errOf(`SELECT _br_rs_request_reset($1, $2)`, [A, U.viewerA]), /BRR-403/);
  assert.match(await errOf(`SELECT _br_rs_request_reset($1, $2)`, [A, U.ownerB]), /BRR-403/);
  const r = await rpc('_br_rs_request_reset', { p_tenant: A, p_actor: U.superA });
  assert.equal((await call(r.job_id)).awaiting, 'execute_request');
  const out = await execute(r.job_id, U.superA);
  assert.equal(out.status, 'succeeded', JSON.stringify(out));
  assert.equal(out.report.scope, 'all_sites');

  const after = await state(A);
  const changed = diff(before, after);
  assert.deepEqual(changed.filter((k) => kept.includes(k) || k === 'profiles' || k === 'auth.users'), [], JSON.stringify(changed));
  assert.deepEqual(await counters(A), cBefore, 'counters kept');
  for (const t of deleted) assert.equal((await one(`SELECT count(*)::int n FROM ${t} WHERE tenant_id = $1`, [A])).n, 0, t);
  for (const t of zeroed) assert.deepEqual(await ids(t), idsBefore[t], `${t} rows kept`);
  const bal = await one(`SELECT
    (SELECT coalesce(sum(abs(balance)), 0) FROM customers WHERE tenant_id = $1) + (SELECT coalesce(sum(abs(balance)), 0) FROM suppliers WHERE tenant_id = $1)
    + (SELECT coalesce(sum(abs(current_balance)), 0) FROM vaults WHERE tenant_id = $1) + (SELECT coalesce(sum(abs(balance)), 0) FROM mt_accounts WHERE tenant_id = $1)
    + (SELECT coalesce(sum(abs(quantity)) + sum(abs(reserved)), 0) FROM stock_levels WHERE tenant_id = $1) AS total`, [A]);
  assert.equal(Number(bal.total), 0);
  assert.deepEqual((await q(`SELECT name FROM sites WHERE tenant_id = $1 ORDER BY name`, [A])).rows.map((x) => x.name), sitesBefore);
  const regs = (await q(`SELECT s.name, count(g.id)::int n FROM sites s LEFT JOIN cash_registers g ON g.site_id = s.id WHERE s.tenant_id = $1 GROUP BY s.name ORDER BY s.name`, [A])).rows;
  assert.ok(regs.every((x) => x.n >= 1), JSON.stringify(regs));
  assert.deepEqual(diff(ctlB, await state(B)), [], 'control tenant intact');
  assert.deepEqual(await backupsHash(), bk);
  assert.ok(out.report.safety.rows > 0);
  assert.deepEqual(await leftovers(r.job_id), { rows: 0, maint: 0, ctx: 0 });

  const n1 = await nextSale(A, S.A1);
  const n2 = await nextSale(A, S.A2);
  assert.notEqual(n1, n2);
  assert.equal(BigInt((await counters(A)).sale), BigInt(cBefore.sale) + 2n, 'numbering continues after the old counter');
  const reg2 = await one(`SELECT id FROM cash_registers WHERE site_id = $1 ORDER BY is_default DESC LIMIT 1`, [S.A2]);
  await q(`INSERT INTO cash_sessions (tenant_id, site_id, cash_register_id, user_id, status) VALUES ($1, $2, $3, $4, 'open')`, [A, S.A2, reg2.id, U.cashierA]);
  note('D8', { executed: true, deleted: out.report.deleted, zeroed: out.report.zeroed, new_sales: [n1, n2], kept_tables: kept.length });
});
