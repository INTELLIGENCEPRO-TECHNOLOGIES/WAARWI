// Scénarios SQL du moteur v3 (Lot B + B.1). Moteur : PGlite (défaut) ou PostgreSQL réel (BR_TEST_ENGINE=pg).
import { loadPGlite, client } from './deps.mjs';
import { installSchema, SEED, IDS, EXPECTED_A, LOT_B, LOT_B1 } from './fixtures.mjs';
import { migration } from './deps.mjs';

const ENGINE = process.env.BR_TEST_ENGINE || 'pglite';
let db;
async function open() {
  if (ENGINE === 'pglite') { const PGlite = await loadPGlite(); db = new PGlite(); return; }
  const admin = client(); await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS br_v3_scenarios WITH (FORCE)');
  await admin.query('CREATE DATABASE br_v3_scenarios'); await admin.end();
  const c = client({ database: 'br_v3_scenarios' }); await c.connect();
  db = { query: (s, p) => c.query(s, p), exec: (s) => c.query(s), close: () => c.end() };
}
const results = [];
const T = (id, name, ok, detail = '') => { results.push({ id, name, ok, detail }); };
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];
const err = async (sql, params) => { try { await db.query(sql, params); return null; } catch (e) { return (e.code || '') + ' ' + e.message; } };
const { A, B, C, D } = IDS;

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
  await open();
  await installSchema((s) => db.exec(s));
  let e2 = null;
  try { await db.exec(migration(LOT_B)); await db.exec(migration(LOT_B1)); } catch (e) { e2 = (e.code || '') + ' ' + e.message; }
  T('S0', 'migrations Lot B et B.1 rejouables (2e application)', e2 === null, e2 || '');
  const drift = (await one(`SELECT br_check_schema_drift() d`)).d;
  T('S0b', 'aucune dérive de schéma après migration', drift.drift_detected === false, JSON.stringify(drift.unregistered_tables));
  await db.exec(SEED);
  // La capture exige une limite finie fixée par l'appelant (B.1).
  await db.exec(`SET statement_timeout = '60s'`);
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
  const cG = await claim('wG', 60);
  if (cG?.job_id) {
    await q(`SELECT _br_job_mark_processing($1,$2)`, [cG.job_id, cG.lease_token]);
    const eShort = await err(`SELECT _br_capture_run($1,$2)`, [cG.job_id, cG.lease_token]);
    T('S11', 'capture refusée si le bail restant < limite de durée + 30 s (bail 60 s, limite 60 s)', !!eShort && eShort.includes('BRJ-041'), eShort?.slice(0, 60));
    await db.exec(`SET statement_timeout = 0`);
    const eNoLimit = await err(`SELECT _br_capture_run($1,$2)`, [cG.job_id, cG.lease_token]);
    await db.exec(`SET statement_timeout = '60s'`);
    T('S11b', 'capture refusée sans limite de durée fixée par l\'appelant', !!eNoLimit && eNoLimit.includes('BRJ-044'), eNoLimit?.slice(0, 60));
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
  const svcExec = [
    await err(`SELECT _br_capture_run(gen_random_uuid(), gen_random_uuid())`),
    await err(`SELECT _br_capture_executor_claim('x')`),
    await err(`SELECT _br_capture_executor_run()`),
    await err(`SELECT _br_capture_executor_schedule(true)`),
    await err(`UPDATE _br_capture_executor_config SET enabled = true`),
  ];
  const svcCfg = await err(`SELECT enabled FROM _br_capture_executor_config`);
  await db.exec(`RESET ROLE`);
  T('S14b', 'HTTP (service_role) ne peut plus lancer de capture ni l\'exécuteur ni l\'activer ; lecture de la config seule',
    svcExec.every(e => e && e.startsWith('42501')) && svcCfg === null, svcExec.map(e => e?.slice(0, 5)).join(','));
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

  // S17-S19 exécuteur serveur (même session, commande cron exacte)
  const cmd = (await one(`SELECT _br_capture_executor_command() c`)).c;
  await request(C, 'v3-exec');
  const disabled = await db.exec(cmd);
  const pendingC = await one(`SELECT status::text s FROM _br_backup_jobs WHERE tenant_id=$1 AND period_key='v3-exec'`, [C]);
  T('S17', 'exécuteur désactivé par défaut : la commande ne réserve rien', JSON.stringify(disabled[0].rows[0]).includes('disabled') && pendingC.s === 'pending', cmd);
  await db.exec(`UPDATE _br_capture_executor_config SET enabled = true`);
  let res = await db.exec(cmd);
  let runs = 0;
  while (runs++ < 6) {
    const last = res[res.length - 1].rows[0]._br_capture_executor_run;
    const j = await one(`SELECT status::text s FROM _br_backup_jobs WHERE tenant_id=$1 AND period_key='v3-exec'`, [C]);
    if (j.s === 'capture_ready' || last.state === 'idle') break;
    res = await db.exec(cmd);
  }
  const jC3 = await one(`SELECT status::text s, attempts, worker_id FROM _br_backup_jobs WHERE tenant_id=$1 AND period_key='v3-exec'`, [C]);
  T('S18', 'commande cron complète : réservation validée, capture dans une 2e transaction => capture_ready', jC3.s === 'capture_ready' && /^pg_cron:\d+$/.test(jC3.worker_id),
    `status=${jC3.s} worker=${jC3.worker_id}`);
  const idleRun = (await one(`SELECT _br_capture_executor_run() r`)).r;
  T('S19', 'exécution sans réservation dans la session : aucune action', idleRun.state === 'idle', '');
  await db.exec(`UPDATE _br_capture_executor_config SET enabled = false`);

  // S20 compatibilité du chemin v2 (file P0-2A) avec les fonctions partagées remplacées
  await q(`INSERT INTO tenants (id,name) VALUES ('00000000-0000-0000-0000-0000000000f3','V2')`);
  const V2 = '00000000-0000-0000-0000-0000000000f3';
  await q(`DELETE FROM _br_backup_jobs WHERE status NOT IN ('succeeded','failed','cancelled') AND tenant_id <> $1`, [V2]);
  const enq = (await one(`SELECT _br_jobs_enqueue_period('v2-2026-02', now(), 'auto', 'auto', ARRAY[$1::uuid], 3) r`, [V2])).r;
  const v2a = await claim('v2-worker', 900);
  await q(`SELECT _br_job_mark_processing($1,$2)`, [v2a.job_id, v2a.lease_token]);
  await q(`SELECT _br_job_renew_lease($1,$2,900)`, [v2a.job_id, v2a.lease_token]);
  const v2f = (await one(`SELECT _br_job_complete_failure($1,$2,'EDGE_TIMEOUT','x',10) r`, [v2a.job_id, v2a.lease_token])).r;
  await ready(v2a.job_id);
  const v2b = await claim('v2-worker', 900);
  await q(`SELECT _br_job_mark_processing($1,$2)`, [v2b.job_id, v2b.lease_token]);
  const bk = (await one(`INSERT INTO tenant_backups (tenant_id, status) VALUES ($1,'verified') RETURNING id`, [V2])).id;
  const v2s = (await one(`SELECT _br_job_complete_success($1,$2,$3) r`, [v2b.job_id, v2b.lease_token, bk])).r;
  const v2j = await job(v2b.job_id);
  T('S20', 'chemin v2 : file -> prise -> échec transitoire -> reprise -> succès avec sauvegarde vérifiée ; slot libéré',
    !!enq && v2a.job_id === v2b.job_id && v2f.status === 'pending' && v2s.status === 'succeeded' && v2j.slot_no === null && v2j.status === 'succeeded',
    `enqueue=${JSON.stringify(enq).slice(0, 60)} fail=${v2f.status} success=${v2s.status}`);

  const ev = await q(`SELECT event, count(*)::int n FROM _br_backup_job_events GROUP BY 1 ORDER BY 1`);
  console.log('events:', ev.map(e => `${e.event}=${e.n}`).join(' '));
  const ver = (await one(`SELECT version() v`)).v;
  console.log('engine:', ver);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  console.log(`TOTAL ${results.filter(r => r.ok).length}/${results.length}`);
  if (db.close) await db.close();
  if (results.some(r => !r.ok)) process.exit(1);
}
main().catch(e => { console.error('FATAL', e.code, e.message, e.where || ''); for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id} ${r.name} — ${r.detail}`); process.exit(1); });
