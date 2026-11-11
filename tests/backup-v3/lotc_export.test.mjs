// Lot C — export par blocs, vérification, publication, téléchargement et copie hors site (PostgreSQL 17 local isolé).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { client } from './deps.mjs';
import { installSchema, installLotC, SEED, IDS } from './fixtures.mjs';
import {
  importAesKey, open, seal, parseContainer, splitBlock, rowLines, sha256hex,
  runExportInvocation, runOffsiteInvocation, webdavStore,
} from '../../supabase/functions/backup-export-v3/core.ts';

const DB = 'br_v3_lotc';
const { A, B, C } = IDS;
const md5 = (s) => createHash('md5').update(s, 'utf8').digest('hex');
const enc = new TextEncoder();
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
const crashAt = (point, nth = 1) => { let n = 0; return (p) => { if (p === point && ++n === nth) throw new SimulatedCrash(p); }; };

let K1, K2, ring;
const store = memStore();
let period = 0;

async function capture(tenant, p = `p${++period}`) {
  const r = (await one(`SELECT _br_v3_request_capture($1, $2) r`, [tenant, p])).r;
  const cl = await one(`SELECT * FROM _br_job_claim('cap', 900)`);
  assert.equal(cl.job_id, r.job_id);
  await q(`SELECT _br_job_mark_processing($1, $2)`, [cl.job_id, cl.lease_token]);
  await q(`SET statement_timeout = '120s'`);
  await q(`SELECT _br_capture_run($1, $2)`, [cl.job_id, cl.lease_token]);
  const j = await one(`SELECT status::text st, capture_generation_id g FROM _br_backup_jobs WHERE id = $1`, [r.job_id]);
  assert.equal(j.st, 'capture_ready');
  const progress = (await q(`SELECT table_name, rows_captured::text n, checksum FROM _br_capture_progress WHERE generation_id = $1`, [j.g])).rows;
  return { job: r.job_id, gen: j.g, progress };
}
const expireExport = () => q(`UPDATE _br_v3_archives SET export_lease_expires_at = now() - interval '1 second' WHERE status IN ('exporting','verifying','publishing')`);
async function drive(deps, worker = 'w1', max = 200) {
  let last;
  for (let i = 0; i < max; i++) {
    last = await runExportInvocation(deps, worker);
    if (['verified', 'failed', 'idle'].includes(last.outcome)) return last;
  }
  return last;
}
const archiveOf = (gen) => one(`SELECT * FROM _br_v3_archives WHERE generation_id = $1`, [gen]);
const blocksOf = async (id) => (await q(`SELECT * FROM _br_v3_archive_blocks WHERE archive_id = $1 ORDER BY block_no`, [id])).rows;
const bind = (a, kind, block_no, key_id) => ({ kind, tenant_id: a.tenant_id, archive_id: a.id, generation_id: a.generation_id, block_no, key_id });

// Rejoue l'archive publiée : déchiffre et décompresse chaque bloc, recalcule la somme par table du staging capturé.
async function roundTrip(a, progress) {
  const per = new Map();
  const lines = [];
  for (const k of await blocksOf(a.id)) {
    const { plain } = await open(store.m.get(k.object_path), bind(a, 'block', k.block_no, k.key_id), ring, 1 << 26);
    const { header, rows } = splitBlock(plain);
    assert.equal(header.table, k.table_name);
    assert.equal(rows, k.row_count);
    for (const l of rowLines(plain)) { (per.get(k.table_name) ?? per.set(k.table_name, []).get(k.table_name)).push(md5(l)); lines.push(l); }
  }
  for (const p of progress) {
    const got = per.get(p.table_name) ?? [];
    assert.equal(String(got.length), p.n, `rows ${p.table_name}`);
    if (got.length) assert.equal(md5(got.join('')), p.checksum, `checksum ${p.table_name}`);
  }
  return lines;
}

test.before(async () => {
  const admin = client(); await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DB}`);
  await admin.end();
  c = client({ database: DB }); c.on('error', () => {}); await c.connect();
  await installSchema((s) => q(s));
  await q(`CREATE TABLE syn_docs (id int PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      doc jsonb, note text, at timestamptz, d date, ratio numeric);
    CREATE TABLE syn_empty (id int PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE);
    INSERT INTO _br_table_registry (table_name, tenant_link, tenant_id_column, category) VALUES
      ('syn_docs','direct','tenant_id','operation'), ('syn_empty','direct','tenant_id','operation');`);
  await q(SEED);
  await q(`INSERT INTO syn_docs VALUES
    (1, '${A}', '{"a":{"b":[1,{"c":null}],"big":123456789012345678901234567890.000000000000000001}}', E'Ünïcødé 中文 🚀 "q" \\\\ back\\nslash\\ttab', '2026-11-11 10:20:30.123456+00', '1999-12-31', 0.1000000000000000000000000001),
    (2, '${A}', NULL, NULL, NULL, NULL, NULL),
    (3, '${A}', '[]', '', 'infinity', '0001-01-01', -99999999999999999999.99999999)`);
  await q(`INSERT INTO syn_items (tenant_id, label) VALUES ('${C}', repeat('x', 6000))`);
  await installLotC((s) => q(s));
  await q(`UPDATE _br_v3_export_config SET enabled = true, block_target_bytes = 2048, row_max_bytes = 4096, max_blocks_per_invocation = 3`);
  K1 = await importAesKey(randomBytes(32)); K2 = await importAesKey(randomBytes(32));
  ring = { currentId: 'k1', keys: new Map([['k1', K1], ['k2', K2]]) };
});
test.after(async () => { await c?.end().catch(() => {}); });

const backupsBefore = { n: null };

test('L0 disabled by default: claim refused while config.enabled = false', async () => {
  backupsBefore.n = (await one(`SELECT count(*)::int n, md5(string_agg(id::text || status::text, ',' ORDER BY id)) h FROM tenant_backups`));
  await q(`UPDATE _br_v3_export_config SET enabled = false`);
  assert.match(await errOf(`SELECT _br_v3_export_claim('w')`), /BRV-045/);
  assert.match(await errOf(`SELECT _br_v3_offsite_claim('w', 300)`), /BRV-045/);
  await q(`UPDATE _br_v3_export_config SET enabled = true`);
});

let mainA;
test('L1 multi-table multi-block export, empty table, exact numeric/bigint/Unicode/NULL/JSON, full round trip', async () => {
  const cap = await capture(A);
  const t0 = performance.now();
  const r = await drive({ rpc, store, keyring: ring });
  assert.equal(r.outcome, 'verified');
  const a = await archiveOf(cap.gen);
  mainA = { a, cap, ms: performance.now() - t0 };
  assert.equal(a.status, 'verified');
  assert.equal(a.restorable, false);
  const blocks = await blocksOf(a.id);
  assert.ok(blocks.length >= 4, `blocks ${blocks.length}`);
  assert.ok(new Set(blocks.map((b) => b.table_name)).size >= 5);
  for (const b of blocks) assert.ok(Number(b.plain_bytes) <= 2048 + 4096 + 512, 'byte limit per block');
  const lines = await roundTrip(a, cap.progress);
  assert.equal(lines.length, 61);
  const big = lines.find((l) => l.includes('9007199254740994'));
  assert.ok(big, 'bigint beyond 2^53 kept verbatim');
  assert.ok(lines.some((l) => l.includes('1234567891.123456')));
  const doc = lines.find((l) => l.includes('"id": 1') && l.includes('Ünïcødé'));
  assert.ok(doc.includes('123456789012345678901234567890.000000000000000001'));
  assert.ok(doc.includes('0.1000000000000000000000000001') && doc.includes('🚀') && doc.includes('中文'));
  // Relecture côté PostgreSQL : la ligne extraite redonne exactement les valeurs typées d'origine.
  const back = await one(`SELECT ($1::jsonb->>'big')::bigint = 9007199254740994 AS b`, [big]);
  assert.equal(back.b, true);
  const same = await one(`SELECT jsonb_populate_record(NULL::syn_docs, $1::jsonb) IS NOT DISTINCT FROM (SELECT s FROM syn_docs s WHERE id = 1) AS eq`, [doc]);
  assert.equal(same.eq, true);
  const nul = lines.find((l) => l.includes('"id": 2'));
  assert.ok(nul.includes('"doc": null') && nul.includes('"note": null'));
  // Manifeste : authentifié, conforme à la référence serveur, table vide présente.
  const { plain } = await open(store.m.get(a.manifest_path), bind(a, 'manifest', 0, a.key_id), ring, 1 << 20);
  assert.equal(await sha256hex(plain), a.manifest_plain_sha256);
  const man = JSON.parse(new TextDecoder().decode(plain));
  assert.equal(man.format_version, 3);
  assert.equal(man.restorable, false);
  const empty = man.tables.find((t) => t.table === 'syn_empty' || t.table_name === 'syn_empty');
  assert.ok(empty, 'empty table listed');
  assert.equal(String(empty.rows ?? empty.row_count), '0');
  assert.equal(man.blocks.length, blocks.length);
  assert.equal((await one(`SELECT status::text s, backup_id FROM _br_backup_jobs WHERE id = $1`, [cap.job])).s, 'succeeded');
  assert.equal((await one(`SELECT status::text s FROM _br_capture_generations WHERE id = $1`, [cap.gen])).s, 'superseded');
  assert.equal((await one(`SELECT count(*)::int n FROM _br_capture_rows WHERE generation_id = $1`, [cap.gen])).n, 0);
});

test('L2 oversized row: explicit BRV-021 failure, nothing truncated, nothing published', async () => {
  const cap = await capture(C);
  const r = await drive({ rpc, store, keyring: ring });
  assert.equal(r.outcome, 'failed');
  assert.equal(r.error_code, 'BRV-021');
  const a = await archiveOf(cap.gen);
  assert.equal(a.status, 'failed');
  assert.equal(a.manifest_path, null);
  assert.equal((await one(`SELECT status::text s FROM _br_backup_jobs WHERE id = $1`, [cap.job])).s, 'failed');
});

for (const point of ['after_encrypt_before_upload', 'after_upload_before_commit', 'after_blocks_before_finish',
  'before_verify_block', 'after_manifest_upload_before_publish', 'after_publish_before_close']) {
  test(`L3 interruption at ${point} then resume: no loss, no duplicate, no nonce reuse`, async () => {
    const cap = await capture(A);
    await assert.rejects(drive({ rpc, store, keyring: ring, checkpoint: crashAt(point, point.startsWith('after_manifest') || point.startsWith('after_publish') || point.startsWith('after_blocks') ? 1 : 2) }), { name: 'SimulatedCrash' });
    await expireExport();
    const r = await drive({ rpc, store, keyring: ring }, 'w2');
    const a = await archiveOf(cap.gen);
    if (point === 'after_publish_before_close') assert.equal(r.outcome, 'idle');
    else assert.equal(r.outcome, 'verified');
    assert.equal(a.status, 'verified');
    const blocks = await blocksOf(a.id);
    assert.deepEqual(blocks.map((b) => b.block_no), blocks.map((_, i) => i + 1));
    assert.equal(new Set(blocks.map((b) => b.nonce_hex)).size, blocks.length);
    await roundTrip(a, cap.progress);
    assert.equal((await one(`SELECT count(*)::int n FROM _br_v3_archives WHERE generation_id = $1`, [cap.gen])).n, 1);
  });
}

test('L4 repeated request and repeated publication: one job, one archive, idempotent publish, no v2 backup', async () => {
  const p = `rep${++period}`;
  const r1 = (await one(`SELECT _br_v3_request_capture($1, $2) r`, [B, p])).r;
  const cap = await capture(B, p);
  assert.equal(cap.job, r1.job_id);
  assert.equal((await drive({ rpc, store, keyring: ring })).outcome, 'verified');
  assert.equal((await drive({ rpc, store, keyring: ring })).outcome, 'idle');
  assert.equal((await one(`SELECT count(*)::int n FROM _br_v3_archives WHERE job_id = $1`, [r1.job_id])).n, 1);
  const { a } = mainA;
  const desc = { path: a.manifest_path, attempt_id: a.manifest_path.match(/manifest-(.+)\.wbr3m$/)[1], key_id: a.key_id,
    nonce_hex: a.manifest_nonce_hex, stored_sha256: a.manifest_sha256, stored_bytes: Number(a.manifest_bytes), plain_sha256: a.manifest_plain_sha256 };
  const again = await rpc('_br_v3_publish', { p_archive_id: a.id, p_token: randomUUID(), p_manifest: desc });
  assert.equal(again.idempotent, true);
  assert.match(await errOf(`SELECT _br_v3_publish($1, $2, $3)`, [a.id, randomUUID(), { ...desc, path: a.storage_prefix + `manifest-${randomUUID()}.wbr3m` }]), /BRV-010/);
  const now = await one(`SELECT count(*)::int n, md5(string_agg(id::text || status::text, ',' ORDER BY id)) h FROM tenant_backups`);
  assert.deepEqual(now, backupsBefore.n);
});

async function stopAtVerify(tenant) {
  const cap = await capture(tenant);
  await assert.rejects(drive({ rpc, store, keyring: ring, checkpoint: crashAt('before_verify_block') }), { name: 'SimulatedCrash' });
  await expireExport();
  const a = await archiveOf(cap.gen);
  assert.equal(a.status, 'verifying');
  return { cap, a, blocks: await blocksOf(a.id) };
}

test('L5 missing block is rejected (BRV-030) and the archive is never verified', async () => {
  const { a, blocks } = await stopAtVerify(A);
  store.m.delete(blocks[1].object_path);
  const r = await drive({ rpc, store, keyring: ring });
  assert.equal(r.outcome, 'failed'); assert.equal(r.error_code, 'BRV-030');
  assert.equal((await one(`SELECT status FROM _br_v3_archives WHERE id = $1`, [a.id])).status, 'failed');
});

test('L6 altered block is rejected (BRV-032)', async () => {
  const { a, blocks } = await stopAtVerify(A);
  const b = store.m.get(blocks[0].object_path); b[b.length - 5] ^= 0xff;
  const r = await drive({ rpc, store, keyring: ring });
  assert.equal(r.outcome, 'failed'); assert.equal(r.error_code, 'BRV-032');
  assert.equal((await one(`SELECT status FROM _br_v3_archives WHERE id = $1`, [a.id])).status, 'failed');
});

test('L7 block from another generation / wrong tenant / forged header / wrong key are rejected', async () => {
  const { a } = mainA;
  const k = (await blocksOf(a.id))[0];
  const bytes = store.m.get(k.object_path);
  const exp = bind(a, 'block', k.block_no, k.key_id);
  await assert.rejects(open(bytes, { ...exp, generation_id: randomUUID() }, ring, 1 << 20), /BRV-032/);
  await assert.rejects(open(bytes, { ...exp, archive_id: randomUUID() }, ring, 1 << 20), /BRV-032/);
  await assert.rejects(open(bytes, { ...exp, tenant_id: B }, ring, 1 << 20), /BRV-032/);
  await assert.rejects(open(bytes, { ...exp, block_no: 2 }, ring, 1 << 20), /BRV-032/);
  // En-tête réécrit pour imiter la cible : l'AAD (reconstruite depuis la référence serveur) fait échouer l'authentification.
  const forged = await seal(enc.encode('x\n'), { ...exp, tenant_id: B }, K1);
  const { header, ciphertext } = parseContainer(forged.bytes);
  const hb = enc.encode(JSON.stringify({ ...header, tenant_id: exp.tenant_id }));
  const fake = new Uint8Array(8 + hb.length + ciphertext.length);
  fake.set(enc.encode('WBR3')); new DataView(fake.buffer).setUint32(4, hb.length); fake.set(hb, 8); fake.set(ciphertext, 8 + hb.length);
  await assert.rejects(open(fake, exp, ring, 1 << 20), /BRV-032: authentication failed/);
  // Mauvaise clé sous le bon identifiant : échec d'authentification.
  await assert.rejects(open(bytes, exp, { currentId: 'k1', keys: new Map([['k1', K2]]) }, 1 << 20), /BRV-032/);
  // Clé absente : erreur non permanente BRV-044.
  await assert.rejects(open(bytes, exp, { currentId: 'k9', keys: new Map() }, 1 << 20), /BRV-044/);
  // Côté serveur : un en-tête de bloc d'une autre génération est refusé lors du marquage vérifié.
  const { a: a2, blocks } = await stopAtVerify(A);
  const t = (await rpc('_br_v3_export_claim', { p_worker_id: 'x' }));
  const s = store.m.get(blocks[0].object_path);
  const { plain, header: ch } = await open(s, bind(a2, 'block', 1, blocks[0].key_id), ring, 1 << 20);
  const h = splitBlock(plain).header;
  const e = await errOf(`SELECT _br_v3_mark_block_verified($1, $2, $3)`, [a2.id, t.lease_token, {
    block_no: 1, stored_sha256: await sha256hex(s), stored_bytes: s.length, plain_sha256: await sha256hex(plain), plain_bytes: plain.length,
    rows: splitBlock(plain).rows, key_id: blocks[0].key_id, nonce_hex: ch.nonce_hex, header: { ...h, generation_id: a.generation_id } }]);
  assert.match(e, /BRV-032/);
  await q(`SELECT _br_v3_export_release($1, $2)`, [a2.id, t.lease_token]);
  // Clé historique : une archive écrite avec k1 se vérifie après rotation vers k2.
  const r = await drive({ rpc, store, keyring: { currentId: 'k2', keys: new Map([['k1', K1], ['k2', K2]]) } });
  assert.equal(r.outcome, 'verified');
  assert.equal((await archiveOf(a2.generation_id)).key_id, 'k1');
});

test('L8 missing key during verification is transient: archive not failed, retried later', async () => {
  const { a } = await stopAtVerify(A);
  const r = await runExportInvocation({ rpc, store, keyring: { currentId: 'k2', keys: new Map([['k2', K2]]) } }, 'w');
  assert.equal(r.outcome, 'error'); assert.equal(r.error_code, 'BRV-044');
  const x = await one(`SELECT status, transient_errors FROM _br_v3_archives WHERE id = $1`, [a.id]);
  assert.equal(x.status, 'verifying'); assert.equal(x.transient_errors, 1);
  assert.equal((await drive({ rpc, store, keyring: ring })).outcome, 'verified');
});

test('L9 altered manifest: rejected by the server reference (BRV-040) and by authentication', async () => {
  const cap = await capture(A);
  let a;
  await assert.rejects(drive({ rpc, store, keyring: ring, checkpoint: crashAt('after_manifest_upload_before_publish') }), { name: 'SimulatedCrash' });
  a = await archiveOf(cap.gen);
  const tok = a.export_lease_token;
  const m = await rpc('_br_v3_get_manifest', { p_archive_id: a.id, p_token: tok });
  const altered = enc.encode(m.manifest_text.replace('"restorable": false', '"restorable": true'));
  const sealed = await seal(altered, bind(a, 'manifest', 0, m.key_id), K1);
  const att = randomUUID();
  const e = await errOf(`SELECT _br_v3_publish($1, $2, $3)`, [a.id, tok, { path: `${a.storage_prefix}manifest-${att}.wbr3m`, attempt_id: att,
    key_id: m.key_id, nonce_hex: sealed.nonce_hex, stored_sha256: sealed.stored_sha256, stored_bytes: sealed.bytes.length, plain_sha256: await sha256hex(altered) }]);
  assert.match(e, /BRV-040/);
  assert.equal((await archiveOf(cap.gen)).status, 'publishing');
  await expireExport();
  assert.equal((await drive({ rpc, store, keyring: ring })).outcome, 'verified');
  a = await archiveOf(cap.gen);
  const mb = new Uint8Array(store.m.get(a.manifest_path)); mb[mb.length - 3] ^= 1;
  await assert.rejects(open(mb, bind(a, 'manifest', 0, a.key_id), ring, 1 << 20), /BRV-032/);
});

test('L10 stale worker cannot commit, publish or overwrite after a takeover', async () => {
  const cap = await capture(A);
  await assert.rejects(drive({ rpc, store, keyring: ring, checkpoint: crashAt('after_manifest_upload_before_publish') }), { name: 'SimulatedCrash' });
  const old = await archiveOf(cap.gen);
  const oldTok = old.export_lease_token;
  const oldM = await rpc('_br_v3_get_manifest', { p_archive_id: old.id, p_token: oldTok });
  await expireExport();
  assert.equal((await drive({ rpc, store, keyring: ring }, 'w-new')).outcome, 'verified');
  const a = await archiveOf(cap.gen);
  const sealed = await seal(enc.encode(oldM.manifest_text), bind(a, 'manifest', 0, a.key_id), K1);
  const att = randomUUID();
  const e = await errOf(`SELECT _br_v3_publish($1, $2, $3)`, [a.id, oldTok, { path: `${a.storage_prefix}manifest-${att}.wbr3m`, attempt_id: att,
    key_id: a.key_id, nonce_hex: sealed.nonce_hex, stored_sha256: sealed.stored_sha256, stored_bytes: sealed.bytes.length, plain_sha256: oldM.plain_sha256 }]);
  assert.match(e, /BRV-010/);
  assert.match(await errOf(`SELECT _br_v3_read_block($1, $2)`, [a.id, oldTok]), /BRV-010/);
  await assert.rejects(store.put(a.manifest_path, new Uint8Array([1])), /object exists/);
  assert.match(await errOf(`UPDATE _br_v3_archives SET manifest_path = 'x' WHERE id = $1`, [a.id]), /BRV-070/);
  assert.match(await errOf(`UPDATE _br_v3_archive_blocks SET stored_sha256 = 'x' WHERE archive_id = $1`, [a.id]), /BRV-072/);
  assert.match(await errOf(`DELETE FROM _br_v3_archives WHERE id = $1`, [a.id]), /BRV-070/);
  assert.equal((await one(`SELECT manifest_path FROM _br_v3_archives WHERE id = $1`, [a.id])).manifest_path, a.manifest_path);
});

test('L11 never verified before every check: status observed after each 1-block invocation', async () => {
  await q(`UPDATE _br_v3_export_config SET max_blocks_per_invocation = 1`);
  const cap = await capture(A);
  const seen = [];
  for (let i = 0; i < 200; i++) {
    const r = await runExportInvocation({ rpc, store, keyring: ring }, 'w');
    const a = await archiveOf(cap.gen);
    seen.push(a.status);
    if (a.status !== 'verified') {
      assert.match(await errOf(`SELECT br_v3_download_authorize($1)`, [a.id]), /BR-40[49]/);
      if (a.status === 'verifying') {
        const t = await rpc('_br_v3_export_claim', { p_worker_id: 'probe' });
        assert.match(await errOf(`SELECT _br_v3_publish($1, $2, '{}'::jsonb)`, [a.id, t.lease_token]), /BRV-011/);
        await q(`SELECT _br_v3_export_release($1, $2)`, [a.id, t.lease_token]);
      }
    } else {
      assert.equal(a.blocks_verified, a.block_count);
      assert.equal((await one(`SELECT count(*)::int n FROM _br_v3_archive_blocks WHERE archive_id = $1 AND verified_at IS NULL`, [a.id])).n, 0);
    }
    if (r.outcome === 'verified') break;
  }
  assert.ok(seen.includes('exporting') && seen.includes('verifying') && seen.at(-1) === 'verified');
  await q(`UPDATE _br_v3_export_config SET max_blocks_per_invocation = 3`);
});

test('L12 download: owner/super_admin of the tenant only, packaged manifest + blocks, verifiable without server keys leaving', async () => {
  const { a } = mainA;
  const as = async (uid, tenant, admin) => {
    await q(`SELECT set_config('brtest.uid', $1, false), set_config('brtest.tenant', $2, false), set_config('brtest.admin', $3, false)`, [uid, tenant, admin]);
    return errOf(`SELECT br_v3_download_authorize($1)`, [a.id]);
  };
  assert.equal(await as('u', A, 'on'), null);
  assert.match(await as('u', B, 'on'), /BR-404/);
  assert.match(await as('u', A, 'off'), /BR-404/);
  assert.match(await as('', A, 'on'), /BR-404/);
  assert.match(await errOf(`SELECT br_v3_download_authorize($1)`, [randomUUID()]), /BR-404/);
  const priv = await one(`SELECT has_function_privilege('authenticated', '_br_v3_download_entries(uuid,integer,integer)', 'EXECUTE') e,
    has_table_privilege('authenticated', '_br_v3_archives', 'SELECT') t, has_table_privilege('anon', '_br_v3_archive_blocks', 'SELECT') b`);
  assert.deepEqual(priv, { e: false, t: false, b: false });
  const pkg = new Map();
  let off = 0, total = Infinity;
  while (off < total) {
    const page = await rpc('_br_v3_download_entries', { p_archive_id: a.id, p_offset: off, p_limit: 2 });
    total = page.total;
    for (const e of page.entries) {
      const bytes = store.m.get(e.object_path);
      assert.equal(await sha256hex(bytes), e.stored_sha256);
      pkg.set(`waarwi-v3-${a.id}/${e.name}`, bytes);
    }
    off += 2;
  }
  assert.equal(pkg.size, a.block_count + 1);
  const { plain } = await open(pkg.get(`waarwi-v3-${a.id}/manifest.wbr3m`), bind(a, 'manifest', 0, a.key_id), ring, 1 << 20);
  const man = JSON.parse(new TextDecoder().decode(plain));
  for (const b of man.blocks) {
    const name = `waarwi-v3-${a.id}/blocks/${String(b.block_no).padStart(6, '0')}.wbr3`;
    assert.equal(await sha256hex(pkg.get(name)), b.stored_sha256);
  }
});

test('L13 v2 untouched: tenant_backups identical, v3 never restorable, cleanup is a dry-run plan', async () => {
  const now = await one(`SELECT count(*)::int n, md5(string_agg(id::text || status::text, ',' ORDER BY id)) h FROM tenant_backups`);
  assert.deepEqual(now, backupsBefore.n);
  assert.equal((await one(`SELECT count(*)::int n FROM _br_backup_jobs WHERE backup_id IS NOT NULL`)).n, 0);
  assert.equal((await one(`SELECT count(*)::int n FROM _br_v3_archives WHERE restorable`)).n, 0);
  const plan = await rpc('_br_v3_cleanup_plan', { p_archive_id: mainA.a.id });
  assert.equal(plan.action, 'orphans_only'); assert.equal(plan.delete_enabled, false);
  assert.equal(plan.retained.length, mainA.a.block_count + 1);
  assert.equal((await one(`SELECT count(*)::int n FROM _br_v3_archive_blocks GROUP BY key_id, nonce_hex ORDER BY 1 DESC LIMIT 1`)).n, 1);
  assert.equal((await one(`SELECT br_check_schema_drift()->>'drift_detected' d`)).d, 'false');
});

function davServer() {
  const files = new Map(); const order = [];
  const ctl = { fail: 0, corrupt: false };
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      if (req.headers.authorization !== 'Basic ' + Buffer.from('u:p').toString('base64')) { res.writeHead(401); return res.end(); }
      if (req.method === 'MKCOL') { res.writeHead(201); return res.end(); }
      if (req.method === 'PUT') {
        if (ctl.fail > 0) { ctl.fail--; res.writeHead(500); return res.end(); }
        files.set(req.url, Buffer.concat(chunks)); order.push(req.url); res.writeHead(201); return res.end();
      }
      if (req.method === 'GET') {
        const f = files.get(req.url); if (!f) { res.writeHead(404); return res.end(); }
        const out = Buffer.from(f); if (ctl.corrupt) out[0] ^= 1;
        res.writeHead(200); return res.end(out);
      }
      res.writeHead(405); res.end();
    });
  });
  return { srv, files, order, ctl };
}

test('L14 offsite: interrupted then resumed, manifest last, remote verified, failures never shown as success', async () => {
  const dav = davServer();
  await new Promise((r) => dav.srv.listen(0, r));
  try {
    const remote = webdavStore(`http://127.0.0.1:${dav.srv.address().port}`, 'u', 'p');
    const { a } = mainA;
    await q(`UPDATE _br_v3_export_config SET offsite_enabled = true`);
    const t = await rpc('_br_v3_offsite_request', { p_archive_id: a.id });
    assert.equal((await rpc('_br_v3_offsite_request', { p_archive_id: a.id })).created, false);
    const st = async () => one(`SELECT status, blocks_confirmed, manifest_confirmed, error_code FROM _br_v3_offsite_transfers WHERE id = $1`, [t.transfer_id]);
    const deps = { rpc, store, remote };
    await assert.rejects(runOffsiteInvocation({ ...deps, checkpoint: crashAt('offsite_after_put', 2) }, 'o1', 100), { name: 'SimulatedCrash' });
    assert.equal((await st()).blocks_confirmed, 1);
    await q(`UPDATE _br_v3_offsite_transfers SET lease_expires_at = now() - interval '1 second'`);
    dav.ctl.fail = 1;
    let r = await runOffsiteInvocation(deps, 'o2', 100);
    assert.equal(r.outcome, 'error');
    let s = await st(); assert.equal(s.status, 'in_progress'); assert.equal(s.manifest_confirmed, false);
    dav.ctl.corrupt = true;
    r = await runOffsiteInvocation(deps, 'o3', 100);
    assert.equal(r.error_code, 'BRV-052'); assert.notEqual((await st()).status, 'confirmed');
    dav.ctl.corrupt = false;
    r = await runOffsiteInvocation(deps, 'o4', 2);
    assert.equal(r.outcome, 'progress');
    for (let i = 0; i < 20 && r.outcome !== 'confirmed'; i++) r = await runOffsiteInvocation(deps, 'o5', 2);
    assert.equal(r.outcome, 'confirmed');
    s = await st(); assert.equal(s.status, 'confirmed'); assert.equal(s.blocks_confirmed, a.block_count);
    assert.ok(dav.order.at(-1).endsWith('/manifest.wbr3m'));
    for (const k of await blocksOf(a.id)) {
      const rp = `/v3/${a.tenant_id}/${a.id}/blocks/${String(k.block_no).padStart(6, '0')}.wbr3`;
      assert.equal(await sha256hex(new Uint8Array(dav.files.get(rp))), k.stored_sha256);
    }
    assert.equal((await one(`SELECT status FROM _br_v3_archives WHERE id = $1`, [a.id])).status, 'verified');
    assert.ok(store.m.has(a.manifest_path));
    assert.equal((await runOffsiteInvocation(deps, 'o6', 5)).outcome, 'idle');
  } finally {
    await q(`UPDATE _br_v3_export_config SET offsite_enabled = false`);
    dav.srv.close();
  }
});

test('M1 measurements on synthetic data (production limits: 4 MiB blocks, 8 blocks/invocation)', async () => {
  await q(`UPDATE _br_v3_export_config SET block_target_bytes = 4194304, row_max_bytes = 16777216, max_blocks_per_invocation = 8`);
  await q(`INSERT INTO syn_items (tenant_id, label, amount, big)
    SELECT '${B}', 'synthetic article ' || g || ' ' || md5(g::text), g * 1.000001, 9007199254740993 + g FROM generate_series(1, 120000) g`);
  const tc = performance.now();
  const cap = await capture(B);
  const captureMs = performance.now() - tc;
  let peakRss = 0, peakHeap = 0;
  const sample = () => { const m = process.memoryUsage(); peakRss = Math.max(peakRss, m.rss); peakHeap = Math.max(peakHeap, m.heapUsed); };
  const timer = setInterval(sample, 5);
  const rss0 = process.memoryUsage().rss;
  const local = memStore();
  const t0 = performance.now();
  const timings = {}; let inv = 0, r;
  do {
    r = await runExportInvocation({ rpc, store: local, keyring: ring }, 'm');
    inv++;
    for (const [k, v] of Object.entries(r.timings_ms)) timings[k] = (timings[k] ?? 0) + v;
  } while (!['verified', 'failed', 'idle'].includes(r.outcome) && inv < 100);
  const total = performance.now() - t0;
  clearInterval(timer); sample();
  assert.equal(r.outcome, 'verified');
  const a = await archiveOf(cap.gen);
  const rows = Number((await one(`SELECT sum(rows_captured)::text s FROM _br_capture_progress WHERE generation_id = $1`, [cap.gen])).s);
  console.log(JSON.stringify({
    rows, blocks: a.block_count, invocations: inv,
    plain_bytes: Number(a.plain_bytes ?? 0) || (await blocksOf(a.id)).reduce((s, b) => s + Number(b.plain_bytes), 0),
    stored_bytes: (await blocksOf(a.id)).reduce((s, b) => s + Number(b.stored_bytes), 0) + Number(a.manifest_bytes),
    capture_ms: Math.round(captureMs), export_verify_publish_ms: Math.round(total),
    step_ms: Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, Math.round(v)])),
    rss_start_mb: +(rss0 / 1048576).toFixed(1), rss_peak_mb: +(peakRss / 1048576).toFixed(1), heap_peak_mb: +(peakHeap / 1048576).toFixed(1),
    method: 'process.memoryUsage() sampled every 5 ms during the export/verify/publish loop (Node 22, worker core + in-memory object store holding all ciphertext)',
  }));
});
