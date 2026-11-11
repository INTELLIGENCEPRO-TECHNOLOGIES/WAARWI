// Lot E — mesures sur gros volume synthétique (BR_LOT_E_ROWS lignes clients + ventes), PostgreSQL 17 local.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { client } from './deps.mjs';
import { installSchema, installLotC, SEED, IDS } from './fixtures.mjs';
import { LOTD_SCHEMA, LOTD_REGISTRY_PROFILES, LOTD_SEED, LOTD_TEST_HELPERS, lotDSql, U, S } from './lotd_fixtures.mjs';
import { importAesKey, runExportInvocation, runRestoreAction } from '../../supabase/functions/backup-export-v3/core.ts';

const DB = 'br_v3_lote_vol';
const N = Number(process.env.BR_LOT_E_ROWS ?? 20000);
const LOT_E = new URL('../../supabase/migrations_review/20261112100000_lot_e_restore_reset_server_integration_inactive.sql', import.meta.url);
const { A, B } = IDS;
let c, ring, CMD;
const q = (s, p) => c.query(s, p);
const one = async (s, p) => (await q(s, p)).rows[0];
async function rpc(fn, args) {
  const names = Object.keys(args);
  return (await q(`SELECT ${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) AS r`, names.map((n) => args[n]))).rows[0].r;
}
const m = new Map();
const store = { async put(p, b) { if (m.has(p)) throw new Error('object exists'); m.set(p, new Uint8Array(b)); }, async get(p) { if (!m.has(p)) throw new Error('not found'); return m.get(p); } };
const api = (actor, action, body = {}) => runRestoreAction({ rpc, store, keyring: ring }, { actor, cron: false }, action, body, 'vol', 8);
let rssPeak = 0;
const sampler = setInterval(() => { rssPeak = Math.max(rssPeak, process.memoryUsage().rss); }, 20);
const timed = async (f) => { const t = Date.now(); const r = await f(); return [r, Date.now() - t]; };

async function capture(tenant, period) {
  await q(`SELECT _br_v3_request_capture($1, $2, 'platform_manual')`, [tenant, period]);
  let j, ms = 0, ticks = 0;
  while (ticks++ < 3) {
    const [, t] = await timed(() => q(CMD)); ms += t;
    j = await one(`SELECT capture_generation_id g, status, error_code FROM _br_backup_jobs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`, [tenant]);
    if (j.g) break;
  }
  return { g: j.g, ms, job: j, ticks };
}
async function exportAll(checkpoint) {
  let last, n = 0;
  for (; n < 2000; n++) {
    last = await runExportInvocation({ rpc, store, keyring: ring, checkpoint }, 'vol');
    if (['verified', 'failed', 'idle', 'error'].includes(last.outcome)) break;
  }
  return { last, invocations: n + 1 };
}

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
  await q(`CREATE OR REPLACE FUNCTION public._br_assert_destructive_available() RETURNS void LANGUAGE plpgsql AS 'BEGIN END'`);
  await q(readFileSync(LOT_E, 'utf8'));
  await q(`UPDATE _br_v3_export_config SET enabled = true`);
  await q(`UPDATE _br_capture_executor_config SET enabled = true, capture_timeout_seconds = 600, lease_margin_seconds = 120`);
  await q(`UPDATE _br_restore_config SET enabled = true, lease_seconds = 600, maintenance_ttl_seconds = 900, swap_lock_timeout_ms = 5000`);
  await q(`SELECT _br_lotd_install_hooks()`);
  CMD = (await one(`SELECT _br_capture_executor_command() c`)).c;
  ring = { currentId: 'k1', keys: new Map([['k1', await importAesKey(randomBytes(32))]]) };
});
test.after(async () => { clearInterval(sampler); await c?.end(); });

test(`E7 volume ${N}: capture, export+verify, restore load and swap, interrupted export`, async () => {
  const [, seedMs] = await timed(async () => {
    await q(`INSERT INTO customers (tenant_id, name, balance) SELECT $1, 'Client synthétique ' || g || ' ' || repeat('x', 120), g % 1000 FROM generate_series(1, $2) g`, [A, N]);
    await q(`INSERT INTO sales (tenant_id, site_id, total) SELECT $1, CASE WHEN g % 2 = 0 THEN $2::uuid ELSE $3::uuid END, g FROM generate_series(1, $4) g`, [A, S.A1, S.A2, N]);
  });
  const size = await one(`SELECT pg_size_pretty(pg_total_relation_size('customers') + pg_total_relation_size('sales')) s`);
  const cap = await capture(A, 'vol');
  assert.ok(cap.g, JSON.stringify(cap.job));
  const [ex, exportMs] = await timed(() => exportAll());
  assert.equal(ex.last.outcome, 'verified', JSON.stringify(ex.last));
  const a = await one(`SELECT a.id, count(b.*)::int blocks, sum(b.cipher_bytes)::bigint bytes FROM _br_v3_archives a JOIN _br_v3_archive_blocks b ON b.archive_id = a.id
    WHERE a.generation_id = $1 GROUP BY a.id`, [cap.g]).catch(async () => one(`SELECT a.id, (SELECT count(*)::int FROM _br_v3_archive_blocks b WHERE b.archive_id = a.id) blocks FROM _br_v3_archives a WHERE a.generation_id = $1`, [cap.g]));
  const rows = (await one(`SELECT sum(rows_captured)::bigint n FROM _br_capture_progress WHERE generation_id = $1`, [cap.g])).n;

  await q(`DELETE FROM customers WHERE tenant_id = $1 AND name LIKE 'Client synthétique 1%'`, [A]);
  const req = await api(U.ownerA, 'restore_request', { operation: 'restore_v3', archive_id: a.id });
  assert.equal(req.status, 200, JSON.stringify(req.body));
  const [ld, loadMs] = await timed(async () => { let r; for (let i = 0; i < 2000; i++) { r = await api(U.ownerA, 'restore_load', { job_id: req.body.job_id }); if (r.body.outcome !== 'progress') break; } return r; });
  assert.equal(ld.body.outcome, 'prepared', JSON.stringify(ld.body));
  await api(U.ownerA, 'restore_safety', { job_id: req.body.job_id });
  const sCap = await capture(A, 'vol-safety');
  const [sEx, safetyExportMs] = await timed(() => exportAll());
  assert.equal(sEx.last.outcome, 'verified');
  assert.equal((await api(U.ownerA, 'restore_execute', { job_id: req.body.job_id })).status, 202);
  const [, swapMs] = await timed(() => q(`CALL _br_rs_executor_next('vol')`));
  const j = await one(`SELECT status, error_code FROM _br_restore_jobs WHERE id = $1`, [req.body.job_id]);
  assert.equal(j.status, 'succeeded', JSON.stringify(j));
  assert.equal((await one(`SELECT count(*)::int n FROM customers WHERE tenant_id = $1`, [A])).n >= N, true);

  console.log('LOTE_MEASURE ' + JSON.stringify({ N, seedMs, table_size: size.s, rows_captured: Number(rows), blocks: a.blocks, cipher_bytes: a.bytes ? Number(a.bytes) : null,
    capture_ms: cap.ms, export_verify_ms: exportMs, export_invocations: ex.invocations, restore_load_ms: loadMs, safety_capture_ms: sCap.ms,
    safety_export_ms: safetyExportMs, swap_ms: swapMs, rss_peak_mb: Math.round(rssPeak / 1048576) }));
  const iCap = await capture(B, 'vol-interrupt');
  assert.ok(iCap.g, JSON.stringify(iCap.job));
  let thrown = false;
  const cut = await exportAll(async (p) => { if (p === 'before_verify_block' && !thrown) { thrown = true; throw new Error('simulated edge kill'); } });
  const cutId = cut.last.archive_id;
  const mid = await one(`SELECT status, manifest_path, tenant_id FROM _br_v3_archives WHERE id = $1`, [cutId]);
  assert.ok(mid, JSON.stringify({ cut: cut.last, archives: (await q(`SELECT generation_id, status FROM _br_v3_archives WHERE tenant_id = $1`, [B])).rows }));
  assert.ok(thrown); assert.notEqual(mid.status, 'verified', 'interrupted run never marked verified');
  assert.ok(!mid.manifest_path || !m.has(mid.manifest_path), 'no manifest published');
  await q(`UPDATE _br_v3_archives SET lease_expires_at = now() - interval '1 second' WHERE id = $1`, [cutId]).catch(() => {});
  const resumed = await exportAll();
  const fin = await one(`SELECT status FROM _br_v3_archives WHERE id = $1`, [cutId]);
  assert.equal(fin.status, 'verified', JSON.stringify(resumed.last));

  console.log('LOTE_INTERRUPT ' + JSON.stringify({ outcome: cut.last.outcome, mid_status: mid.status, resumed: resumed.last.outcome, final: fin?.status }));
});
