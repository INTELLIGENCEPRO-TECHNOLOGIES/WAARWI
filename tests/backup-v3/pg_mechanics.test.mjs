// Real PostgreSQL (not PGlite): timeout and transaction semantics the v3 executor relies on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { client } from './deps.mjs';

async function withClient(fn) {
  const c = client();
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

test('setup', async () => withClient(async (c) => {
  await c.query(`DROP SCHEMA IF EXISTS mech CASCADE; CREATE SCHEMA mech; CREATE TABLE mech.t(v text);
    CREATE FUNCTION mech.sleep_with_set(s float) RETURNS int LANGUAGE plpgsql SET statement_timeout = '10s' AS $$
    BEGIN PERFORM pg_sleep(s); RETURN 1; END $$;
    CREATE FUNCTION mech.catch_timeout(s float) RETURNS text LANGUAGE plpgsql AS $$
    BEGIN
      BEGIN PERFORM pg_sleep(s); INSERT INTO mech.t VALUES ('inner'); RETURN 'done';
      EXCEPTION WHEN query_canceled THEN INSERT INTO mech.t VALUES ('handled:' || SQLERRM); RETURN 'caught';
      END;
    END $$;`);
}));

test('M1 function-level SET statement_timeout does not extend the caller timer', async () => withClient(async (c) => {
  await c.query(`SET statement_timeout = '500ms'`);
  await assert.rejects(c.query('SELECT mech.sleep_with_set(1.5)'), (e) => e.code === '57014');
}));

test('M2 SET LOCAL before the statement in the same simple query applies to that statement', async () => withClient(async (c) => {
  await c.query(`SET statement_timeout = '500ms'`);
  await c.query(`SET LOCAL statement_timeout = '3s'; SELECT pg_sleep(1.2)`);
  await c.query(`SET statement_timeout = '10s'`);
  const t0 = Date.now();
  await assert.rejects(c.query(`SET LOCAL statement_timeout = '400ms'; SELECT pg_sleep(2)`), (e) => e.code === '57014');
  assert.ok(Date.now() - t0 < 1500, 'the shorter limit fixed beforehand is enforced');
}));

test('M3 explicit COMMIT inside a multi-statement command commits the first part even if the rest fails', async () => withClient(async (c) => {
  await c.query('TRUNCATE mech.t');
  await assert.rejects(c.query(`INSERT INTO mech.t VALUES ('claim'); COMMIT; SET LOCAL statement_timeout = '300ms'; INSERT INTO mech.t VALUES ('capture'); SELECT pg_sleep(1)`),
    (e) => e.code === '57014');
  const r = await c.query('SELECT v FROM mech.t ORDER BY v');
  assert.deepEqual(r.rows.map((x) => x.v), ['claim']);
}));

test('M4 a statement timeout is catchable in plpgsql and the handler can record it', async () => withClient(async (c) => {
  await c.query('TRUNCATE mech.t');
  const r = await c.query(`SET LOCAL statement_timeout = '300ms'; SELECT mech.catch_timeout(1) AS x`);
  assert.equal(r[1].rows[0].x, 'caught');
  const rows = (await c.query('SELECT v FROM mech.t')).rows.map((x) => x.v);
  assert.equal(rows.length, 1);
  assert.match(rows[0], /^handled:canceling statement due to statement timeout/);
}));

test('M5 session-level set_config survives the explicit COMMIT', async () => withClient(async (c) => {
  const r = await c.query(`SELECT set_config('waarwi.probe', 'abc', false); COMMIT; SELECT current_setting('waarwi.probe', true) AS v`);
  assert.equal(r[2].rows[0].v, 'abc');
}));

test('M6 FOR UPDATE SKIP LOCKED does not wait for a row locked by a long transaction', async () => {
  const a = client(); const b = client();
  await a.connect(); await b.connect();
  try {
    await a.query(`TRUNCATE mech.t; INSERT INTO mech.t VALUES ('row')`);
    await a.query('BEGIN'); await a.query(`SELECT * FROM mech.t FOR UPDATE`);
    const t0 = Date.now();
    const r = await b.query(`SELECT * FROM mech.t FOR UPDATE SKIP LOCKED`);
    assert.equal(r.rowCount, 0);
    assert.ok(Date.now() - t0 < 500);
    await a.query('ROLLBACK');
  } finally { await a.end(); await b.end(); }
});
