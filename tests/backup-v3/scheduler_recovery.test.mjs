import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { client, migration } from './deps.mjs';

test('le planificateur reprend les tâches interrompues et publie les copies externes', async () => {
  const db = 'br_cron_' + randomUUID().replaceAll('-', '');
  const admin = client();
  await admin.connect();
  try {
    await admin.query('CREATE DATABASE ' + db);
    const dbClient = client({ database: db });
    await dbClient.connect();
    try {
      await dbClient.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
        END $$;
        CREATE TABLE tenants(id uuid PRIMARY KEY);
        CREATE TABLE tenant_backups(
          id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), kind text NOT NULL,
          is_auto boolean NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE _br_offsite_config(id int PRIMARY KEY, enabled boolean, auto_transfer boolean, root_folder text);
        CREATE TABLE _br_offsite_transfers(
          source_backup_id uuid UNIQUE, backup_id uuid REFERENCES tenant_backups(id), tenant_id uuid,
          remote_path text, status text
        );
      `);
      const schema = migration('20260904230627_centralized_backups_scheduler_tables_and_internal_fn.sql');
      await dbClient.query(schema.slice(schema.indexOf('-- 5. Schedule run history')));
      const migrationPath = process.env.BR_SCHEDULER_SQL
        ?? new URL('../../supabase/migrations/20261127181752_backup_scheduler_recover_expired_runs.sql', import.meta.url);
      await dbClient.query(readFileSync(migrationPath, 'utf8'));

      const [a, b, c, expired, running, next, backup, manual] = Array.from({ length: 8 }, randomUUID);
      await dbClient.query('INSERT INTO tenants(id) VALUES ($1), ($2), ($3)', [a, b, c]);
      await dbClient.query(`INSERT INTO _br_schedule_runs(id,started_at,tenants_total) VALUES
        ($1,now()-interval '2 hours',2), ($2,now(),1), ($3,now(),2)`, [expired, running, next]);
      await dbClient.query(`INSERT INTO _br_schedule_run_items(run_id,tenant_id,status) VALUES
        ($1,$2,'pending'), ($1,$3,'succeeded'), ($4,$3,'running')`, [expired, a, b, running]);

      const recovery = await dbClient.query('SELECT _br_recover_expired_schedule_runs() AS count');
      assert.equal(recovery.rows[0].count, 1);
      assert.deepEqual((await dbClient.query(`SELECT status,tenants_succeeded,tenants_failed FROM _br_schedule_runs
        WHERE id=$1`, [expired])).rows[0], { status: 'partial_failure', tenants_succeeded: 1, tenants_failed: 1 });
      assert.equal((await dbClient.query(`SELECT status FROM _br_schedule_run_items
        WHERE run_id=$1 AND tenant_id=$2`, [expired, a])).rows[0].status, 'failed');
      assert.equal((await dbClient.query(`SELECT status FROM _br_schedule_run_items WHERE run_id=$1`, [running])).rows[0].status, 'running');
      assert.equal((await dbClient.query('SELECT _br_recover_expired_schedule_runs() AS count')).rows[0].count, 0);

      const reservation = await dbClient.query(`SELECT tenant_id FROM _br_reserve_schedule_items($1,$2)`, [next, [a, b, c, a]]);
      assert.deepEqual(reservation.rows.map(row => row.tenant_id).sort(), [a, c].sort());
      assert.equal((await dbClient.query(`SELECT * FROM _br_reserve_schedule_items($1,$2)`, [next, [a, b, c]])).rowCount, 0);
      const access = await dbClient.query(`SELECT has_function_privilege('authenticated', '_br_reserve_schedule_items(uuid,uuid[])', 'execute') AS user_allowed,
        has_function_privilege('service_role', '_br_reserve_schedule_items(uuid,uuid[])', 'execute') AS worker_allowed`);
      assert.deepEqual(access.rows[0], { user_allowed: false, worker_allowed: true });

      await dbClient.query(`INSERT INTO _br_offsite_config VALUES(1,true,true,'/Waarwi/');`);
      await dbClient.query(`INSERT INTO tenant_backups(id,tenant_id,kind,is_auto,status,created_at) VALUES
        ($1,$3,'auto',true,'creating','2026-11-27T02:00:00Z'),
        ($2,$3,'platform_manual',false,'verified','2026-11-27T02:00:00Z')`, [backup, manual, a]);
      assert.equal((await dbClient.query('SELECT * FROM _br_offsite_transfers')).rowCount, 0);
      await dbClient.query(`UPDATE tenant_backups SET status='verified' WHERE id=$1`, [backup]);
      await dbClient.query(`UPDATE tenant_backups SET status='verified' WHERE id=$1`, [backup]);
      assert.deepEqual((await dbClient.query('SELECT source_backup_id, remote_path, status FROM _br_offsite_transfers')).rows, [{
        source_backup_id: backup, remote_path: `/Waarwi/${a}/2026/11/27_${backup}.waarwi.enc`, status: 'queued',
      }]);
    } finally {
      await dbClient.end();
    }
  } finally {
    await admin.query('DROP DATABASE IF EXISTS ' + db);
    await admin.end();
  }
});
