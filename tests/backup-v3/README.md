# Backup v3 tests (Lots B / B.1 / C / D / E)

Never run against production. All suites create their own local databases.

## Dependencies (outside the app bundle)

```
mkdir -p /tmp/pgl && cd /tmp/pgl
npm i @electric-sql/pglite@0.2 pg embedded-postgres@17.6.0-beta.15
B=/tmp/pgl/node_modules/@embedded-postgres/linux-x64/native/bin
$B/initdb -D /tmp/pgl/d2 -U postgres --auth=trust
$B/pg_ctl -D /tmp/pgl/d2 -o "-p 54329 -k /tmp/pgl" -l /tmp/pgl/pg.log -w start
```

Static check (optional, Lot D) — plpgsql_check 2.8.2 without root:

```
mkdir -p /tmp/pgl/pck && cd /tmp/pgl/pck
# download postgresql-17-plpgsql-check_2.8.2-1_amd64.deb from deb.debian.org/debian/pool/main/p/plpgsql-check/
dpkg-deb -x postgresql-17-plpgsql-check_*.deb x
N=/tmp/pgl/node_modules/@embedded-postgres/linux-x64/native
cp x/usr/lib/postgresql/17/lib/plpgsql_check.so $N/lib/postgresql/
cp x/usr/share/postgresql/17/extension/plpgsql_check* $N/share/postgresql/extension/
```

Overrides: `BR_TEST_DEPS` (node_modules path), `BR_TEST_PG_PORT`, `BR_TEST_PG_DB`.

## Suites

| File | Engine | Command | Covers |
|---|---|---|---|
| `pg_mechanics.test.mjs` | PostgreSQL 17 | `node --test tests/backup-v3/pg_mechanics.test.mjs` | statement_timeout / SET LOCAL / COMMIT in a multi-statement command / SKIP LOCKED |
| `engine_scenarios.mjs` | PGlite (default) or PG | `node tests/backup-v3/engine_scenarios.mjs` / `BR_TEST_ENGINE=pg node ...` | single-session engine scenarios S0-S20, v2 queue compatibility |
| `executor_concurrency.test.mjs` | PostgreSQL 17 | `node --test tests/backup-v3/executor_concurrency.test.mjs` | multi-session C1-C6: race on claim, long capture vs lease and locks, overrun, killed executor, stale executor |
| `lotc_export.test.mjs` | PostgreSQL 17 + Node crypto | `node --test --test-concurrency=1 tests/backup-v3/lotc_export.test.mjs` (`BR_LOT_C_SQL=<file>` to test a draft) | Lot C L0-L14 + M1: block export, exact format round trip, interruption points, verification, publication, download package, mock WebDAV offsite, measurements |
| `lotd_restore.test.mjs` (+ `lotd_fixtures.mjs`) | PostgreSQL 17, 2 connections | `BR_LOT_D_SQL=<migration file> node --test --test-concurrency=1 tests/backup-v3/lotd_restore.test.mjs` | Lot D D0-D8, see matrix below |
| `lote_chain.test.mjs` | PostgreSQL 17, 2 connections + Edge core | `BR_LOT_D_SQL=<Lot D file> node --test --test-concurrency=1 tests/backup-v3/lote_chain.test.mjs` | Lot E E0-E6, see matrix below |
| `lote_volume.test.mjs` | PostgreSQL 17 + Edge core | `BR_LOT_D_SQL=<Lot D file> BR_LOT_E_ROWS=20000 node --test tests/backup-v3/lote_volume.test.mjs` | Lot E E7: volume, step durations, RSS, export interrupted then resumed |
| `pg_cron_isolated_check.sql` | Supabase isolated project | manual | **prepared, not executed**: real pg_cron limits and execution |

## Lot D coverage matrix (global scope `all_sites`)

| Scenario | Test | Status |
|---|---|---|
| Gate, maintenance BR-503, epoch BR-504, actor checks | D0-D3, D7 | executed, pass |
| v2 restore, sha256 / md5 / empty checksum variants | D4 | executed, pass |
| Altered v2 archive refused before mutation (4 tampers), v1 / unknown format refused | D4 | executed, pass |
| Old v2 archive without registers/assignments (historically absent tables) | D4 | executed, pass |
| v3 restore of a real Lot C archive (33 blocks), exact diff | D5 | executed, pass |
| Crash, resume, replay without duplicates | D5 | executed, pass |
| Multi-register refs, closed_by, prepayment links, bigint and numeric precision | D5 | executed, pass |
| Rollback after first writes (FK failure, extra staged row, unguarded trigger BRR-070) | D6 | executed, pass |
| Concurrent writes on 2 connections, lock wait / BRR-074, recover | D7 | executed, pass |
| Global reset of the 2-shop tenant, control tenant intact, new sale + session | D8 | executed, pass |
| plpgsql_check on 35 Lot D functions | script | executed, 0 errors |
| Per-shop restore / reset | - | deferred (separate project) |
| Production apply, hook install, worker redeploy | - | not done (review only) |

## Lot E coverage matrix (server integration, scope `all_sites`)

| Scenario | Test | Status |
|---|---|---|
| anon / authenticated denied on every API, service_role denied on executor + schedule | E0 | executed, pass |
| BR020 closed: request / execute / executor refused, 0 job, no diff | E1 | executed, pass |
| Cron capture -> export -> manifest only after verification | E2 | executed, pass (24 blocks) |
| Isolation: roles, foreign archive, tenant never from body, foreign job | E3 | executed, pass |
| v3 restore via API, BRR-080 without fresh safety archive, concurrent write in safety | E4 | executed, pass |
| Rollback after first writes, state identical | E5 | executed, pass |
| Global reset 2 shops, new session + sale V-00016 | E6 | executed, pass |
| Volume 20k (40,116 rows, 31 blocks), interruption -> not verified -> resumed | E7 | executed, pass |
| Volume x10 (200k) | E7 | inconclusive within the 18 min window (step not logged) |
| plpgsql_check on Lot E functions | - | not executed (bench wiped) |
| Real pg_cron, Edge runtime, Storage, LWS, isolated project | - | not available |
