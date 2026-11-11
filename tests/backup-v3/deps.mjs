import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Test-only dependencies live outside the app (see README.md): pg, @electric-sql/pglite@0.2, embedded-postgres.
export const DEPS = process.env.BR_TEST_DEPS || '/tmp/pgl/node_modules';
const req = createRequire(path.join(DEPS, 'noop.js'));

export const pg = req('pg');
export async function loadPGlite() {
  const m = await import(path.join(DEPS, '@electric-sql/pglite/dist/index.js'));
  return m.PGlite;
}

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const migration = (name) => readFileSync(path.join(ROOT, 'supabase/migrations', name), 'utf8');

export const PG_PORT = Number(process.env.BR_TEST_PG_PORT || 54329);
export function client(extra = {}) {
  return new pg.Client({ host: 'localhost', port: PG_PORT, user: 'postgres', database: process.env.BR_TEST_PG_DB || 'postgres', ...extra });
}
