import { PGlite } from '/tmp/pgl/node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';

const root = '/tmp/cc-agent/70445941/project/';
const db = new PGlite();
const results = [];
const T = (id, name, ok, detail = '') => { results.push({ id, name, ok, detail }); };
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];
const err = async (sql, params) => { try { await db.query(sql, params); return null; } catch (e) { return (e.code || '') + ' ' + e.message; } };
const tx = async (fn) => { await db.exec('BEGIN'); try { await fn(); } finally { await db.exec('ROLLBACK'); } };

const STUBS = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TYPE br_backup_status AS ENUM ('creating','verified','failed','legacy','incompatible');
CREATE TABLE tenants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE tenant_backups (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status br_backup_status NOT NULL DEFAULT 'creating', payload jsonb NOT NULL DEFAULT '{}');
CREATE TABLE _br_table_registry (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), schema_name text NOT NULL DEFAULT 'public', table_name text NOT NULL,
  tenant_link text NOT NULL, tenant_id_column text, parent_table text, category text NOT NULL, restore_order int NOT NULL DEFAULT 0,
  reset_behavior text NOT NULL DEFAULT 'preserve', self_ref_columns text[], is_mandatory boolean DEFAULT false, exclusion_reason text,
  created_at timestamptz DEFAULT now(), deferred_fk_columns text[], UNIQUE (schema_name, table_name));
CREATE TABLE _br_tenant_schedule_override (tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE, suspended boolean NOT NULL DEFAULT false);
CREATE OR REPLACE FUNCTION br_check_schema_drift() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_unregistered jsonb; v_missing jsonb;
BEGIN
SELECT coalesce(jsonb_agg(c.relname::text ORDER BY c.relname::text), '[]'::jsonb) INTO v_unregistered
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid
WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attname = 'tenant_id' AND a.attnum > 0 AND NOT a.attisdropped
AND NOT EXISTS (SELECT 1 FROM _br_table_registry r WHERE r.schema_name = 'public' AND r.table_name = c.relname::text);
SELECT coalesce(jsonb_agg(r.table_name ORDER BY r.table_name), '[]'::jsonb) INTO v_missing FROM _br_table_registry r
WHERE r.schema_name = 'public' AND r.tenant_link != 'excluded' AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = r.schema_name AND c.relname = r.table_name AND c.relkind = 'r');
RETURN jsonb_build_object('unregistered_tables', v_unregistered, 'missing_tables', v_missing,
'drift_detected', (v_unregistered != '[]'::jsonb OR v_missing != '[]'::jsonb), 'checked_at', now());
END $$;
-- Tables métier synthétiques
CREATE TABLE syn_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label text, amount numeric(20,6), big bigint);
CREATE TABLE syn_counters (tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, doc_kind text NOT NULL, value bigint NOT NULL,
  PRIMARY KEY (tenant_id, doc_kind));
CREATE TABLE syn_nopk (tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, label text, qty int);
CREATE TABLE syn_parent (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name text);
CREATE TABLE syn_child (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parent_id uuid NOT NULL REFERENCES syn_parent(id) ON DELETE CASCADE, note text);
INSERT INTO _br_table_registry (table_name, tenant_link, tenant_id_column, parent_table, category) VALUES
 ('syn_items','direct','tenant_id',NULL,'operation'), ('syn_counters','direct','tenant_id',NULL,'structure'),
 ('syn_nopk','direct','tenant_id',NULL,'operation'), ('syn_parent','direct','tenant_id',NULL,'structure'),
 ('syn_child','indirect',NULL,'syn_parent','structure'),
 ('tenant_backups','excluded','tenant_id',NULL,'backup_system'), ('_br_tenant_schedule_override','excluded','tenant_id',NULL,'backup_system');
`;

async function seed() {
  await db.exec(`
    INSERT INTO tenants (id, name) VALUES
      ('00000000-0000-0000-0000-00000000000a','A'), ('00000000-0000-0000-0000-00000000000b','B'),
      ('00000000-0000-0000-0000-00000000000c','C'), ('00000000-0000-0000-0000-00000000000d','D-suspended');
    INSERT INTO _br_tenant_schedule_override VALUES ('00000000-0000-0000-0000-00000000000d', true);
    INSERT INTO syn_items (tenant_id, label, amount, big)
      SELECT t, 'item ' || g, 1234567890.123456 + g, 9007199254740993 + g
      FROM unnest(ARRAY['00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b']::uuid[]) t, generate_series(1,50) g;
    INSERT INTO syn_counters VALUES ('00000000-0000-0000-0000-00000000000a','sale',10),('00000000-0000-0000-0000-00000000000a','quote',3),
      ('00000000-0000-0000-0000-00000000000b','sale',99);
    INSERT INTO syn_nopk VALUES ('00000000-0000-0000-0000-00000000000a','dup',1),('00000000-0000-0000-0000-00000000000a','dup',1),
      ('00000000-0000-0000-0000-00000000000a','zz',2),('00000000-0000-0000-0000-00000000000b','other',5);
    INSERT INTO syn_parent (id, tenant_id, name) VALUES ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','pa'),
      ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000b','pb');
    INSERT INTO syn_child (parent_id, note) VALUES ('10000000-0000-0000-0000-000000000001','c1'),('10000000-0000-0000-0000-000000000001','c2'),
      ('10000000-0000-0000-0000-000000000002','c3');
  `);
}
const A = '00000000-0000-0000-0000-00000000000a', B = '00000000-0000-0000-0000-00000000000b', C = '00000000-0000-0000-0000-00000000000c', D = '00000000-0000-0000-0000-00000000000d';
const EXPECTED_A = 50 + 2 + 3 + 1 + 2; // items + counters + nopk + parent + child

const claim = (w, s = 900) => one(`SELECT * FROM _br_job_claim($1, $2)`, [w, s]);
const job = (id) => one(`SELECT * FROM _br_backup_jobs WHERE id = $1`, [id]);
const request = (t, p) => one(`SELECT _br_v3_request_capture($1, $2) r`, [t, p]).then(r => r.r);
const expire = (id) => q(`UPDATE _br_backup_jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1`, [id]);
const ready = (id) => q(`UPDATE _br_backup_jobs SET next_attempt_at = now() - interval '1 second' WHERE id = $1`, [id]);
const capture = async (w) => {
  const c = await claim(w);
  await q(`SELECT _br_job_mark_processing($1, $2)`, [c.job_id, c.lease_token]);
  const r = (await one(`SELECT _br_capture_run($1, $2) r`, [c.job_id, c.lease_token])).r;
  return { c, r };
};

async function main() {
  await db.exec(STUBS);
  const m1 = readFileSync(root + 'supabase/migrations/20261018145906_p0_2a_durable_backup_job_queue_inactive.sql', 'utf8');
  const m2 = readFileSync(root + 'supabase/migrations/20261018154909_p0_2a1_tenant_backups_job_composite_fk.sql', 'utf8');
  const lotb = readFileSync(root + '.scratch/lotb_engine.sql', 'utf8');
  await db.exec(m1); await db.exec(m2);
  await db.exec(lotb);
  let e2 = null;
  try { await db.exec(lotb); } catch (e) { e2 = (e.code || '') + ' ' + e.message; }
  T('S0', 'migration Lot B rejouable (2e application)', e2 === null, e2 || '');
  const drift = (await one(`SELECT br_check_schema_drift() d`)).d;
  T('S0b', 'aucune dérive de schéma après migration', drift.drift_detected === false, JSON.stringify(drift.unregistered_tables));
  await seed();

  // S1 idempotence
  const r1 = await request(A, 'v3-2026-01-01');
  const r2 = await request(A, 'v3-2026-01-01');
  const n = (await one(`SELECT count(*)::int n FROM _br_backup_jobs WHERE tenant_id=$1`, [A])).n;
  T('S1', 'requête répétée => un seul job', r1.created === true && r2.created === false && r1.job_id === r2.job_id && n === 1, `created=${r1.created}/${r2.created} jobs=${n}`);
  const eSusp = await err(`SELECT _br_v3_request_capture($1,'p')`, [D]);
  T('S1b', 'tenant suspendu refusé (suspension respectée)', !!eSusp && eSusp.includes('BRJ-060'), eSusp);

  // S2 capture nominale
  const { c: c1, r: cap1 } = await capture('w1');
  const j1 = await job(c1.job_id);
  const staged = (await one(`SELECT count(*)::int n, count(DISTINCT tenant_id)::int t FROM _br_capture_rows WHERE generation_id=$1`, [cap1.generation_id]));
  T('S2', 'capture => capture_ready, slot libéré, lignes du seul tenant A', cap1.status === 'capture_ready' && j1.status === 'capture_ready'
    && j1.slot_no === null && j1.lease_token === null && staged.n === EXPECTED_A && staged.t === 1 && Number(cap1.total_rows) === EXPECTED_A,
    `rows=${staged.n}/${EXPECTED_A} status=${j1.status} fence=${j1.claim_fence}`);
  const childRows = (await one(`SELECT count(*)::int n FROM _br_capture_rows WHERE generation_id=$1 AND table_name='syn_child'`, [cap1.generation_id])).n;
  T('S2b', 'table indirecte capturée via son parent (2 lignes de A, pas celle de B)', childRows === 2, `child=${childRows}`);
  const prog = await q(`SELECT table_name, order_key, rows_captured::int FROM _br_capture_progress WHERE generation_id=$1 ORDER BY 1`, [cap1.generation_id]);
  T('S2c', 'progression persistée par table avec clé d\'ordre (PK simple, composite, sans PK)',
    prog.length === 5 && prog.find(p => p.table_name === 'syn_counters').order_key === 'pk:tenant_id,doc_kind'
    && prog.find(p => p.table_name === 'syn_nopk').order_key === 'row_text', prog.map(p => `${p.table_name}:${p.order_key}:${p.rows_captured}`).join(' '));
  const num = (await one(`SELECT row_data->>'amount' a, row_data->>'big' b FROM _br_capture_rows WHERE generation_id=$1 AND table_name='syn_items' AND ord=1`, [cap1.generation_id]));
  T('S2d', 'numeric et bigint conservés exactement dans le staging (jsonb)', /^\d+\.\d{6}$/.test(num.a) && num.b.length >= 16, `amount=${num.a} big=${num.b}`);

  // S3 pas de "verified" prématuré
  const tb = (await one(`SELECT count(*)::int n FROM tenant_backups`)).n;
  const eSucc = await err(`SELECT _br_job_complete_success($1,$2,gen_random_uuid())`, [c1.job_id, c1.lease_token]);
  const ac = (await one(`SELECT _br_capture_assert_current($1) r`, [cap1.generation_id])).r;
  T('S3', 'aucune sauvegarde vérifiée créée ; capture_ready non restaurable ; succès impossible', tb === 0 && !!eSucc && eSucc.includes('BRJ-010') && ac.restorable === false,
    `tenant_backups=${tb} complete_success=${eSucc?.slice(0, 60)}`);

  // S4 exclusion par tenant
  await request(A, 'v3-2026-01-02');
  const cA2 = await claim('w2');
  T('S4', 'second job du même tenant non pris tant que le premier est actif', !cA2 || cA2.job_id === undefined || cA2.job_id === null, JSON.stringify(cA2 || null));
  const eUniq = await err(`UPDATE _br_backup_jobs SET status='leased', slot_no=2, lease_token=gen_random_uuid(), lease_expires_at=now()+interval '1h', worker_id='x', claim_fence=claim_fence+1
     WHERE tenant_id=$1 AND period_key='v3-2026-01-02'`, [A]);
  T('S4b', 'garantie base : écriture directe d\'un 2e bail tenant A refusée par index unique', !!eUniq && eUniq.includes('uq_br_backup_jobs_one_active_per_tenant'), eUniq?.slice(0, 90));

  // S5 limite globale (2 emplacements)
  await request(B, 'v3-2026-01-01'); await request(C, 'v3-2026-01-01');
  const cB = await claim('wB'); const cC = await claim('wC');
  await q(`INSERT INTO tenants (id,name) VALUES ('00000000-0000-0000-0000-00000000000e','E')`);
  await request('00000000-0000-0000-0000-00000000000e', 'v3-2026-01-01');
  const cE = await claim('wE');
  T('S5', 'limite globale : 2 prises puis refus de la 3e', !!cB?.job_id && !!cC?.job_id && !cE?.job_id, `B=${!!cB?.job_id} C=${!!cC?.job_id} E=${!!cE?.job_id}`);
  const eSlot = await err(`UPDATE _br_backup_jobs SET status='leased', slot_no=(SELECT slot_no FROM _br_backup_jobs WHERE id=$1), lease_token=gen_random_uuid(),
     lease_expires_at=now()+interval '1h', worker_id='x' WHERE tenant_id='00000000-0000-0000-0000-00000000000e'`, [cB.job_id]);
  const eSlot3 = await err(`UPDATE _br_backup_jobs SET status='leased', slot_no=3, lease_token=gen_random_uuid(),
     lease_expires_at=now()+interval '1h', worker_id='x' WHERE tenant_id='00000000-0000-0000-0000-00000000000e'`);
  T('S5b', 'garantie base : emplacement déjà pris refusé (23505), emplacement inexistant refusé (FK)',
    !!eSlot && eSlot.includes('uq_br_backup_jobs_slot') && !!eSlot3 && eSlot3.startsWith('23503'), `${eSlot?.slice(0, 50)} | ${eSlot3?.slice(0, 50)}`);

  // S6 erreur transitoire puis reprise (job B)
  const fB = (await one(`SELECT _br_job_fail($1,$2,'NET_TIMEOUT','timeout réseau',false,10) r`, [cB.job_id, cB.lease_token])).r;
  const jB = await job(cB.job_id);
  T('S6', 'erreur transitoire => pending, backoff, slot libéré', fB.status === 'pending' && fB.error_class === 'transient' && jB.slot_no === null && jB.attempts === 1,
    `status=${jB.status} attempts=${jB.attempts} next=${jB.next_attempt_at.toISOString?.() ?? jB.next_attempt_at}`);
  const cE2 = await claim('wE');
  T('S6b', 'emplacement libéré réutilisé par le job en attente (E)', !!cE2?.job_id, '');
  const eE = await q(`SELECT _br_job_fail($1,$2,'X','libère',false,10)`, [cE2.job_id, cE2.lease_token]);
  await ready(cB.job_id);
  const cB2 = await claim('wB2');
  const jB2 = await job(cB2.job_id);
  T('S6c', 'reprise : nouvelle prise, nouveau jeton, fence 2', cB2.job_id === cB.job_id && cB2.lease_token !== cB.lease_token && Number(jB2.claim_fence) === 2,
    `fence=${jB2.claim_fence} attempt=${cB2.attempt}`);
  const eOld = await err(`SELECT _br_job_renew_lease($1,$2,900)`, [cB.job_id, cB.lease_token]);
  T('S6d', 'ancien jeton (prise 1) refusé au renouvellement', !!eOld && eOld.includes('BRJ-010'), eOld?.slice(0, 60));
  await q(`SELECT _br_job_mark_processing($1,$2)`, [cB2.job_id, cB2.lease_token]);
  const capB = (await one(`SELECT _br_capture_run($1,$2) r`, [cB2.job_id, cB2.lease_token])).r;
  T('S6e', 'reprise menée jusqu\'à capture_ready', capB.status === 'capture_ready' && Number(capB.claim_fence) === 2, `gen_no=${capB.generation_no}`);

  // S7 erreur permanente (job C) + classification serveur
  const fC = (await one(`SELECT _br_job_fail($1,$2,'BRJ-051','dérive',false,10) r`, [cC.job_id, cC.lease_token])).r;
  const jC = await job(cC.job_id);
  await ready(cC.job_id);
  const cC2 = await claim('wC2');
  T('S7', 'code BRJ-05x classé permanent par le serveur même si worker dit transitoire ; job terminal non repris',
    fC.status === 'failed' && jC.error_class === 'permanent' && jC.finished_at !== null && !(cC2?.job_id === cC.job_id), `status=${jC.status}`);

  // S8 bail expiré + ancien worker
  await q(`INSERT INTO tenants (id,name) VALUES ('00000000-0000-0000-0000-0000000000f1','F')`);
  await q(`INSERT INTO syn_items (tenant_id,label) VALUES ('00000000-0000-0000-0000-0000000000f1','f')`);
  const F = '00000000-0000-0000-0000-0000000000f1';
  await request(F, 'v3-2026-01-01');
  let cF = await claim('wF-old');
  if (!cF?.job_id || cF.tenant_id !== F) { await q(`SELECT _br_job_cancel($1,'test')`, [(await one(`SELECT id FROM _br_backup_jobs WHERE tenant_id='00000000-0000-0000-0000-00000000000e'`)).id]); cF = await claim('wF-old'); }
  await q(`SELECT _br_job_mark_processing($1,$2)`, [cF.job_id, cF.lease_token]);
  await expire(cF.job_id);
  const eRen = await err(`SELECT _br_job_renew_lease($1,$2,900)`, [cF.job_id, cF.lease_token]);
  const eCap = await err(`SELECT _br_capture_run($1,$2)`, [cF.job_id, cF.lease_token]);
  const eFail = await err(`SELECT _br_job_complete_failure($1,$2,'X','y',10)`, [cF.job_id, cF.lease_token]);
  const eSuc = await err(`SELECT _br_job_complete_success($1,$2,gen_random_uuid())`, [cF.job_id, cF.lease_token]);
  T('S8', 'bail expiré : renouveler, capturer, échouer, terminer refusés', [eRen, eCap, eFail, eSuc].every(e => e && e.includes('BRJ-010')),
    [eRen, eCap, eFail, eSuc].map(e => e?.slice(0, 14)).join(' | '));
  const rec = (await one(`SELECT _br_jobs_recover_expired(50,10) r`)).r;
  const jF = await job(cF.job_id);
  T('S8b', 'reprise après expiration : job remis en attente, slot libéré', jF.status === 'pending' && jF.slot_no === null && rec.requeued >= 1, JSON.stringify(rec));
  await ready(cF.job_id);
  const cFnew = await claim('wF-new');
  await q(`SELECT _br_job_mark_processing($1,$2)`, [cFnew.job_id, cFnew.lease_token]);
  const st = [
    await err(`SELECT _br_job_renew_lease($1,$2,900)`, [cF.job_id, cF.lease_token]),
    await err(`SELECT _br_capture_run($1,$2)`, [cF.job_id, cF.lease_token]),
    await err(`SELECT _br_job_fail($1,$2,'X','y',true,10)`, [cF.job_id, cF.lease_token]),
    await err(`SELECT _br_job_complete_success($1,$2,gen_random_uuid())`, [cF.job_id, cF.lease_token]),
    await err(`SELECT _br_job_cancel($1,'stale')`, [cF.job_id]),
  ];
  const jFnow = await job(cF.job_id);
  T('S8c', 'ancien worker rejeté pendant le bail du nouveau (5 opérations), job intact',
    st.slice(0, 4).every(e => e && e.includes('BRJ-010')) && st[4]?.includes('BRJ-012') && jFnow.status === 'processing' && jFnow.lease_token === cFnew.lease_token,
    st.map(e => e?.slice(0, 14)).join(' | '));
  const capF = (await one(`SELECT _br_capture_run($1,$2) r`, [cFnew.job_id, cFnew.lease_token])).r;
  T('S8d', 'nouveau worker termine la capture (fence 2)', capF.status === 'capture_ready' && Number(capF.claim_fence) === 2, '');

  // S9 changement de génération (perte de staging)
  await q(`DELETE FROM _br_capture_rows WHERE generation_id=$1 AND table_name='syn_items' AND ord > 40`, [cap1.generation_id]);
  const v = (await one(`SELECT _br_capture_verify_staging($1) r`, [cap1.generation_id])).r;
  const g1 = await one(`SELECT status, superseded_reason FROM _br_capture_generations WHERE id=$1`, [cap1.generation_id]);
  const left = (await one(`SELECT count(*)::int n FROM _br_capture_rows WHERE generation_id=$1`, [cap1.generation_id])).n;
  const jA = await job(c1.job_id);
  T('S9', 'perte de staging détectée => génération 1 superseded, staging purgé, job en attente',
    v.ok === false && v.reason === 'staging_lost' && g1.status === 'superseded' && left === 0 && jA.status === 'pending' && jA.capture_generation_id === null,
    `mismatch=${JSON.stringify(v.mismatches)}`);
  await ready(c1.job_id);
  let cA3 = await claim('wA3');
  while (cA3?.job_id && cA3.job_id !== c1.job_id) { await q(`SELECT _br_job_fail($1,$2,'X','y',true,10)`, [cA3.job_id, cA3.lease_token]); cA3 = await claim('wA3'); }
  await q(`SELECT _br_job_mark_processing($1,$2)`, [cA3.job_id, cA3.lease_token]);
  const capA2 = (await one(`SELECT _br_capture_run($1,$2) r`, [cA3.job_id, cA3.lease_token])).r;
  T('S9b', 'nouvelle génération n°2 avec nouveau fence, même contenu => même empreinte globale',
    capA2.generation_no === 2 && Number(capA2.claim_fence) > Number(c1 ? 1 : 0) && capA2.global_checksum === cap1.global_checksum,
    `gen_no=${capA2.generation_no} fence=${capA2.claim_fence} checksum_equal=${capA2.global_checksum === cap1.global_checksum}`);
  const eOldGen = await err(`SELECT _br_capture_assert_current($1)`, [cap1.generation_id]);
  const okNew = (await one(`SELECT _br_capture_assert_current($1) r`, [capA2.generation_id])).r;
  T('S9c', 'ancienne génération non publiable, nouvelle génération courante', !!eOldGen && eOldGen.includes('BRJ-071') && okNew.generation_no === 2, eOldGen?.slice(0, 60));
  const eIns = await err(`INSERT INTO _br_capture_rows (generation_id, tenant_id, table_name, ord, row_data) VALUES ($1,$2,'syn_items',999,'{}')`, [cap1.generation_id, A]);
  const eIns2 = await err(`INSERT INTO _br_capture_rows (generation_id, tenant_id, table_name, ord, row_data) VALUES ($1,$2,'syn_items',999,'{}')`, [capA2.generation_id, A]);
  const eRev = await err(`UPDATE _br_capture_generations SET status='capture_ready' WHERE id=$1`, [cap1.generation_id]);
  const eMut = await err(`UPDATE _br_capture_rows SET row_data='{}' WHERE generation_id=$1 AND ord=1`, [capA2.generation_id]);
  const eCross = await err(`INSERT INTO _br_capture_rows (generation_id, tenant_id, table_name, ord, row_data) VALUES ($1,$2,'syn_items',999,'{}')`, [capA2.generation_id, B]);
  T('S9d', 'écriture dans une génération close/ancienne, résurrection, modification et mélange de tenant refusés',
    eIns?.includes('BRJ-072') && eIns2?.includes('BRJ-072') && eRev?.includes('BRJ-070') && eMut?.includes('BRJ-073') && eCross?.startsWith('23503'),
    [eIns, eIns2, eRev, eMut, eCross].map(e => e?.slice(0, 14)).join(' | '));

  // S10 ordre déterministe
  const ordNo = await q(`SELECT ord::int, row_data->>'label' l FROM _br_capture_rows WHERE generation_id=$1 AND table_name='syn_nopk' ORDER BY ord`, [capA2.generation_id]);
  T('S10', 'table sans PK : ordre déterministe sur texte canonique', ordNo.map(r => r.l).join(',') === 'dup,dup,zz', ordNo.map(r => r.ord + ':' + r.l).join(' '));

  // S11 bail trop court
  await q(`INSERT INTO tenants (id,name) VALUES ('00000000-0000-0000-0000-0000000000f2','G')`);
  await request('00000000-0000-0000-0000-0000000000f2', 'p');
  const cG = await claim('wG', 120);
  if (cG?.job_id) {
    await q(`SELECT _br_job_mark_processing($1,$2)`, [cG.job_id, cG.lease_token]);
    const eShort = await err(`SELECT _br_capture_run($1,$2)`, [cG.job_id, cG.lease_token]);
    T('S11', 'capture refusée si le bail restant < 330 s', !!eShort && eShort.includes('BRJ-041'), eShort?.slice(0, 60));
    // S12 dérive
    await q(`CREATE TABLE syn_unregistered (id int PRIMARY KEY, tenant_id uuid)`);
    await q(`SELECT _br_job_renew_lease($1,$2,900)`, [cG.job_id, cG.lease_token]);
    const eDrift = await err(`SELECT _br_capture_run($1,$2)`, [cG.job_id, cG.lease_token]);
    const gens = (await one(`SELECT count(*)::int n FROM _br_capture_generations WHERE job_id=$1`, [cG.job_id])).n;
    T('S12', 'dérive de schéma => capture refusée, aucune génération partielle', !!eDrift && eDrift.includes('BRJ-051') && gens === 0, eDrift?.slice(0, 60));
    await q(`DROP TABLE syn_unregistered`);
    // S13 annulation
    await expire(cG.job_id);
    const can = (await one(`SELECT _br_job_cancel($1,'test') r`, [cG.job_id])).r;
    T('S13', 'annulation explicite d\'un job à bail expiré', can.status === 'cancelled', '');
  } else T('S11', 'capture refusée si bail court', false, 'claim impossible');

  // S14 privilèges
  const denied = [];
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    denied.push(await err(`SELECT count(*) FROM _br_capture_rows`));
    denied.push(await err(`SELECT _br_capture_run(gen_random_uuid(), gen_random_uuid())`));
    denied.push(await err(`SELECT _br_v3_request_capture('${A}','x')`));
    await db.exec(`RESET ROLE`);
  }
  await db.exec(`SET ROLE service_role`);
  const svcSel = await err(`SELECT count(*) FROM _br_capture_rows`);
  const svcIns = await err(`INSERT INTO _br_capture_rows VALUES (gen_random_uuid(),gen_random_uuid(),'x',1,'{}')`);
  await db.exec(`RESET ROLE`);
  T('S14', 'anon/authenticated : staging et fonctions refusés ; service_role lecture seule', denied.every(e => e && e.startsWith('42501')) && svcSel === null && svcIns?.startsWith('42501'),
    `denied=${denied.filter(Boolean).length}/6 svc_insert=${svcIns?.slice(0, 20)}`);

  // S15 suppression d'un tenant (cascade)
  const eDel = await err(`DELETE FROM tenants WHERE id=$1`, [A]);
  const remain = (await one(`SELECT count(*)::int n FROM _br_capture_generations WHERE tenant_id=$1`, [A])).n;
  T('S15', 'suppression de tenant : jobs, générations et staging supprimés en cascade sans blocage', eDel === null && remain === 0, eDel || '');

  // S16 claim : course simulée (pré-filtre trompé)
  await request(B, 'v3-race');
  const eRace = await err(`UPDATE _br_backup_jobs SET status='leased', slot_no=1, lease_token=gen_random_uuid(), lease_expires_at=now()+interval '1h', worker_id='x', claim_fence=claim_fence+1
      WHERE tenant_id=$1 AND period_key='v3-race'`, [B]);
  T('S16', 'B déjà en capture_ready : un bail concurrent pour B est refusé par la base', !!eRace && eRace.includes('uq_br_backup_jobs_one_active_per_tenant'), eRace?.slice(0, 70));

  const ev = await q(`SELECT event, count(*)::int n FROM _br_backup_job_events GROUP BY 1 ORDER BY 1`);
  console.log('events:', ev.map(e => `${e.event}=${e.n}`).join(' '));
  const ver = (await one(`SELECT version() v`)).v;
  console.log('engine:', ver);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  console.log(`TOTAL ${results.filter(r => r.ok).length}/${results.length}`);
}
main().catch(e => { console.error('FATAL', e.code, e.message, e.where || ''); for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id} ${r.name} — ${r.detail}`); process.exit(1); });
