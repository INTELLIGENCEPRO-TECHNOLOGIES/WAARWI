// Tenant recovery with synthetic companies against a loopback-only PostgreSQL server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { client, migration } from './deps.mjs';
import { installSchema, installLotC, SEED, IDS } from './fixtures.mjs';
import { LOTD_SCHEMA, LOTD_REGISTRY_PROFILES, LOTD_SEED, LOTD_TEST_HELPERS, lotDSql, U } from './lotd_fixtures.mjs';
import { importAesKey, importRestoreEntry, runExportInvocation, runRestoreAction } from '../../supabase/functions/backup-export-v3/core.ts';
import { readBackupV3Zip } from '../../src/lib/backupV3Zip.ts';

const { CFB } = createRequire(import.meta.url)('xlsx');
const DB = 'br_v3_tenant_recovery';
const { A, B } = IDS;
let db, keyring, capture;
const objects = new Map();
const remoteObjects = new Map();
const reads = { storage: 0, lws: 0 };
const [store, remote] = [objects, remoteObjects].map((map, index) => ({
  async put(path, bytes) {
    assert.ok(!map.has(path));
    map.set(path, new Uint8Array(bytes));
  },
  async get(path) {
    reads[index ? 'lws' : 'storage']++;
    if (!map.has(path)) throw new Error('fixture file not found');
    return map.get(path);
  },
}));
const q = (sql, params) => db.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

async function rpc(name, args) {
  const named = Object.keys(args).map((key, i) => key + ' => $' + (i + 1)).join(', ');
  return (await one('SELECT public.' + name + '(' + named + ') AS value', Object.values(args))).value;
}
const deps = () => ({ rpc, store, remote: () => remote, keyring });
const api = (actor, action, body = {}, cron = false) => runRestoreAction(deps(), { actor, cron }, action, body, 'recette', 4);
const status = async (actor, job) => (await api(actor, 'restore_status', job ? { job_id: job } : {})).body;
const state = async tenant => (await one('SELECT _t_tenant_state($1) AS value', [tenant])).value;
const execute = () => q('CALL public._br_rs_executor_next()');

async function request(actor, operation, archive = null, source = 'storage') {
  const result = await api(actor, 'restore_request', { operation, archive_id: archive, source });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.ok(result.body.job_id);
  return result.body.job_id;
}
async function createArchive(tenant, period) {
  if (period) await rpc('_br_v3_request_capture', { p_tenant_id: tenant, p_period_key: period });
  await q(capture);
  let result;
  for (let count = 0; count < 200; count++) {
    result = await runExportInvocation(deps(), 'recette');
    if (result.outcome === 'verified') break;
    assert.equal(result.outcome, 'progress', JSON.stringify(result));
  }
  assert.equal(result?.outcome, 'verified');
  return one('SELECT * FROM public._br_v3_archives WHERE id=$1', [result.archive_id]);
}
async function loadInBackground(actor, job) {
  for (let count = 0; count < 180; count++) {
    const { job: current } = await status(actor, job);
    if (current.status !== 'preparing') return current;
    const result = await api(null, 'restore_load', {}, true);
    assert.equal(result.status, 200);
    assert.notEqual(result.body.outcome, 'error', JSON.stringify(result.body));
    await execute();
  }
  assert.fail('Preparation did not finish');
}
async function confirm(job, word) {
  const response = await api(U.ownerA, 'restore_execute', { job_id: job, confirmation: word });
  assert.equal(response.status, 202, JSON.stringify(response.body));
  await execute();
  assert.equal((await status(U.ownerA, job)).job.status, 'prepared', 'requires a verified safety archive');
  assert.equal((await status(U.ownerA, job)).job.maintenance, false);
  await createArchive(A);
}

test.before(async () => {
  const admin = client();
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS ' + DB + ' WITH (FORCE)');
  await admin.query('CREATE DATABASE ' + DB);
  await admin.end();
  db = client({ database: DB });
  await db.connect();
  await q("SET timezone='UTC'");
  await installSchema(q);
  await q(SEED);
  await q(LOTD_SCHEMA);
  await q(LOTD_REGISTRY_PROFILES);
  await installLotC(q);
  await q(LOTD_SEED);
  await q(lotDSql());
  await q(LOTD_TEST_HELPERS);
  await q(`
    CREATE TABLE public._br_tenant_activation (tenant_id uuid PRIMARY KEY, enabled boolean NOT NULL);
    INSERT INTO public._br_table_registry(table_name,tenant_link,category) VALUES ('_br_tenant_activation','excluded','backup_system');
    CREATE TABLE public.site_change_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
      previous_site_id uuid REFERENCES sites(id) ON DELETE SET NULL, new_site_id uuid REFERENCES sites(id) ON DELETE SET NULL
    );
    INSERT INTO public._br_table_registry(table_name,tenant_link,tenant_id_column,category,restore_order,reset_behavior)
      VALUES ('site_change_log','direct','tenant_id','operation',99,'delete');
    ALTER TABLE public._br_tenant_activation ENABLE ROW LEVEL SECURITY;
    CREATE POLICY platform_admin_manage_activation ON public._br_tenant_activation
      FOR ALL TO authenticated USING (false) WITH CHECK (false);
    ALTER TABLE public._br_backup_jobs ADD COLUMN label text;
    CREATE SCHEMA cron;
    CREATE TABLE cron.job (jobname text PRIMARY KEY, command text, active boolean DEFAULT true);
    CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS
      'INSERT INTO cron.job VALUES ($1,$3,true) ON CONFLICT (jobname) DO UPDATE SET command=excluded.command RETURNING 1::bigint';
    CREATE SCHEMA vault;
    CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
    INSERT INTO vault.decrypted_secrets VALUES ('waarwi_backup_v3_runner','{"url":"https://recipe.invalid","headers":{"X-Cron-Secret":"fixture"}}');
    CREATE SCHEMA net;
    CREATE TABLE net.requests (body jsonb);
    CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer)
      RETURNS bigint LANGUAGE sql AS 'INSERT INTO net.requests VALUES ($3) RETURNING 1::bigint';
    CREATE SCHEMA realtime;
    CREATE TABLE realtime.notices (payload jsonb, topic text);
    CREATE FUNCTION realtime.send(jsonb,text,text,boolean) RETURNS void LANGUAGE sql AS
      'INSERT INTO realtime.notices VALUES ($1,$3)';
    CREATE OR REPLACE FUNCTION public._br_assert_destructive_available() RETURNS void LANGUAGE plpgsql AS
      'BEGIN RAISE EXCEPTION ''suspended'' USING ERRCODE = ''BR020''; END';
    CREATE FUNCTION public.proof_statement_trigger() RETURNS trigger LANGUAGE plpgsql AS
      'BEGIN PERFORM count(*) FROM new_rows; RETURN NULL; END';
    CREATE TRIGGER proof_statement AFTER INSERT ON syn_items REFERENCING NEW TABLE AS new_rows
      FOR EACH STATEMENT EXECUTE FUNCTION public.proof_statement_trigger();
    CREATE FUNCTION public.proof_constraint_trigger() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NULL; END';
    CREATE CONSTRAINT TRIGGER proof_constraint AFTER INSERT ON syn_items DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION public.proof_constraint_trigger();
    GRANT SELECT, INSERT ON syn_items TO authenticated;
    UPDATE _br_v3_export_config SET enabled=true, offsite_enabled=true, block_target_bytes=2048, row_max_bytes=8192, max_blocks_per_invocation=4;
    UPDATE _br_capture_executor_config SET enabled=true, capture_timeout_seconds=60, lease_margin_seconds=60;
  `);
  await q(migration('20261127211710_backup_v3_tenant_recovery.sql'));
  capture = (await one('SELECT _br_capture_executor_command() AS command')).command;
  keyring = { currentId: 'recipe', keys: new Map([['recipe', await importAesKey(randomBytes(32))]]) };
});
test.after(async () => { await db?.end(); });

test('activation preserves triggers and requires an authorized owner', async () => {
  assert.equal((await status(U.ownerA)).available, false);
  await q(migration('20261127211746_enable_backup_v3_tenant_recovery.sql'));
  const authorized = await status(U.ownerA);
  assert.equal(authorized.available, true);
  assert.equal(authorized.authorized, false);
  assert.equal((await api(U.ownerA, 'restore_request', { operation: 'reset' })).status, 403);
  await q('INSERT INTO public._br_tenant_activation VALUES ($1,true),($2,true)', [A,B]);
  assert.equal((await status(U.ownerA)).authorized, true);
  assert.equal((await api(U.viewerA, 'restore_status')).status, 403);
  assert.equal((await api(null, 'restore_status')).status, 403);
  await assert.rejects(q('SELECT public._br_assert_destructive_available()'), { code: 'BR020' });
  const rights = await one(`
    SELECT public._br_lotd_hooks_status()->>'ok' AS installed,
      has_function_privilege('authenticated','public._br_rs_api_execute(uuid,uuid,text)','EXECUTE') AS direct_execution,
      has_function_privilege('service_role','public._br_rs_swap(uuid,uuid)','EXECUTE') AS service_swap,
      (SELECT count(*)::int FROM cron.job WHERE jobname='br_restore_executor' AND active) AS runners`);
  assert.deepEqual(rights, { installed: 'true', direct_execution: false, service_swap: false, runners: 1 });
  await q('SET ROLE authenticated');
  try { await q("INSERT INTO syn_items(tenant_id,label) VALUES ($1,'ordinary write')", [B]); }
  finally { await q('RESET ROLE'); }
});

test('restores V3 from Waarwi, LWS and ZIP and preserves the control company', async () => {
  const oldSite = (await one('SELECT id FROM sites WHERE tenant_id=$1 ORDER BY id LIMIT 1', [B])).id;
  await q('INSERT INTO site_change_log(tenant_id,previous_site_id) VALUES ($1,$2)', [A,oldSite]);
  const archive = await createArchive(A, 'recipe:source');
  const base = await state(A);
  const control = await state(B);
  const blocks = (await q('SELECT * FROM public._br_v3_archive_blocks WHERE archive_id=$1 ORDER BY block_no', [archive.id])).rows;
  const zipParts = [objects.get(archive.manifest_path), ...blocks.map(block => objects.get(block.object_path))];
  const zip = CFB.utils.cfb_new();
  CFB.utils.cfb_add(zip, 'manifest.wbr3m', zipParts[0]);
  for (const block of blocks) {
    CFB.utils.cfb_add(zip, 'blocks/' + String(block.block_no).padStart(6, '0') + '.wbr3', zipParts[block.block_no]);
  }
  const file = new Blob([CFB.write(zip, { fileType: 'zip', type: 'array', compression: false })]);
  const imported = await readBackupV3Zip(file);
  assert.equal(imported.archiveId, archive.id);
  assert.equal(imported.blockCount, blocks.length);
  await assert.rejects(readBackupV3Zip(file.slice(0, -9)));
  CFB.utils.cfb_add(zip, '../manifest.wbr3m', zipParts[0]);
  await assert.rejects(readBackupV3Zip(new Blob([CFB.write(zip, { fileType: 'zip', type: 'array', compression: false })])));
  remoteObjects.set('v3/' + A + '/' + archive.id + '/manifest.wbr3m', zipParts[0]);
  for (const block of blocks) remoteObjects.set('v3/' + A + '/' + archive.id + '/blocks/' + String(block.block_no).padStart(6, '0') + '.wbr3', zipParts[block.block_no]);
  for (const source of ['storage','lws','zip']) {
    await q("UPDATE customers SET balance = balance + 1 WHERE tenant_id=$1", [A]);
    const modified = await state(A);
    if (source === 'lws') {
      await rpc('_br_v3_offsite_request', { p_archive_id: archive.id });
      await q(`UPDATE _br_v3_offsite_transfers SET status='confirmed', manifest_confirmed=true, blocks_confirmed=$2, confirmed_at=now()
        WHERE archive_id=$1`, [archive.id,blocks.length]);
      objects.delete(archive.manifest_path);
      for (const block of blocks) objects.delete(block.object_path);
    }
    const job = await request(U.ownerA, 'restore_v3', archive.id, source);
    assert.equal(await request(U.ownerA, 'restore_v3', archive.id, source), job);
    assert.equal((await api(U.ownerB, 'restore_execute', { job_id: job, confirmation:'RESTAURER' })).status, 404);
    assert.equal((await api(U.ownerA, 'restore_execute', { job_id: job, confirmation:'RESTAURER' })).status, 409);
    if (source === 'zip') {
      assert.equal((await api(null, 'restore_load', {}, true)).body.outcome, 'idle');
      const upload = (actor, number, bytes) => importRestoreEntry({ rpc, loadKeys: async () => keyring },
        actor, job, number, async expected => { assert.equal(bytes.length, expected); return bytes; });
      assert.equal((await upload(U.ownerB, 0, zipParts[0])).status, 404);
      const bad = new Uint8Array(zipParts[0]);
      bad[bad.length-1] ^= 1;
      assert.equal((await upload(U.ownerA, 0, bad)).body.code, 'BRR-041');
      for (let n = 0; n <= imported.blockCount; n++) {
        const bytes = new Uint8Array(await (await imported.part(n)).arrayBuffer());
        const response = await upload(U.ownerA, n, bytes);
        assert.equal(response.status, 200, JSON.stringify(response.body));
      }
      assert.equal((await upload(U.ownerA, 1, zipParts[1])).status, 200);
    }
    const before = { ...reads };
    assert.equal((await loadInBackground(U.ownerA, job)).status, 'prepared');
    if (source !== 'storage') assert.equal(reads.storage, before.storage);
    if (source === 'lws') assert.equal(reads.lws - before.lws, zipParts.length);
    assert.deepEqual(await state(A), modified);
    assert.equal((await api(U.ownerA,'restore_execute',{job_id:job,confirmation:'INVALID'})).status,409);
    await confirm(job, 'RESTAURER');
    await execute();
    const completed = (await status(U.ownerA, job)).job;
    assert.equal(completed.status, 'succeeded', JSON.stringify(completed));
    const restored = await state(A);
    assert.equal(restored.customers, base.customers);
    assert.equal(restored.sales, base.sales);
    assert.equal((await one('SELECT previous_site_id FROM site_change_log WHERE tenant_id=$1', [A])).previous_site_id, oldSite);
    assert.deepEqual(await state(B), control);
  }
  const notices = (await q('SELECT payload,topic FROM realtime.notices')).rows;
  assert.deepEqual(notices, Array.from({ length: 3 }, () => ({ payload: { table: '*' }, topic: 'waarwi:tenant:' + A })));
});

test('a cascading outside-company profile change rolls back the entire restoration', async () => {
  const archive = await createArchive(A, 'recipe:cross-company-fk');
  const site = (await one('SELECT id FROM sites WHERE tenant_id=$1 ORDER BY id LIMIT 1', [A])).id;
  await q('UPDATE profiles SET default_site_id=$1 WHERE id=$2', [site,U.ownerB]);
  const before = await state(A);
  const control = await state(B);
  const job = await request(U.ownerA, 'restore_v3', archive.id);
  assert.equal((await loadInBackground(U.ownerA, job)).status, 'prepared');
  await confirm(job, 'RESTAURER');
  await execute();
  assert.equal((await status(U.ownerA, job)).job.error_code, 'BRR-076');
  assert.deepEqual(await state(A), before);
  assert.deepEqual(await state(B), control);
  assert.equal((await one('SELECT default_site_id FROM profiles WHERE id=$1', [U.ownerB])).default_site_id, site);
});

test('reset refuses a stale safety archive and removes operations only after confirmation', async () => {
  const wrong = await request(U.ownerA, 'reset');
  await confirm(wrong, 'RÉINITIALISER');
  await q("UPDATE customers SET balance = balance + 1 WHERE tenant_id=$1", [A]);
  const prior = await state(A);
  const control = await state(B);
  await execute();
  assert.equal((await status(U.ownerA, wrong)).job.error_code, 'BRR-080');
  assert.deepEqual(await state(A), prior);
  assert.deepEqual(await state(B), control);
  assert.equal((await status(U.ownerA, wrong)).job.maintenance, false);

  const job = await request(U.ownerA, 'reset');
  await confirm(job, 'RÉINITIALISER');
  await execute();
  const final = (await status(U.ownerA, job)).job;
  assert.equal(final.status, 'succeeded', JSON.stringify(final));
  assert.equal((await one('SELECT count(*)::int AS n FROM sales WHERE tenant_id=$1',[A])).n,0);
  assert.equal((await one('SELECT count(*)::int AS n FROM cash_sessions WHERE tenant_id=$1',[A])).n,0);
  assert.ok((await one('SELECT count(*)::int AS n FROM sites WHERE tenant_id=$1',[A])).n >= 2);
  assert.deepEqual(await state(B), control);
});
