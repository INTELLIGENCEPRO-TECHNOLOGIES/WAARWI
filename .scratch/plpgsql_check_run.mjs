import { client } from '../tests/backup-v3/deps.mjs';
const c = client({ database: 'br_v3_lotd' }); await c.connect();
await c.query('CREATE EXTENSION IF NOT EXISTS plpgsql_check');
const v = (await c.query(`SELECT extversion FROM pg_extension WHERE extname = 'plpgsql_check'`)).rows[0].extversion;
const fns = (await c.query(`SELECT p.oid, p.oid::regprocedure::text sig, p.prorettype = 'trigger'::regtype trg, (SELECT t.tgrelid::regclass::text FROM pg_trigger t WHERE t.tgfoid = p.oid ORDER BY 1 LIMIT 1) rel
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
  WHERE n.nspname = 'public' AND l.lanname = 'plpgsql'
    AND (p.proname LIKE '\\_br\\_rs\\_%' OR p.proname LIKE '\\_br\\_gate%' OR p.proname LIKE '\\_br\\_lotd\\_%' OR p.proname LIKE '\\_br\\_restore\\_%')
  ORDER BY 2`)).rows;
let errors = 0, warnings = 0; const out = [];
for (const f of fns) {
  const rel = f.trg ? `, '${f.rel ?? 'public.customers'}'::regclass` : '';
  const r = (await c.query(`SELECT level, message, lineno, statement FROM plpgsql_check_function_tb(${f.oid}${rel}, fatal_errors => false, other_warnings => false, extra_warnings => false)`)).rows;
  for (const x of r) { if (x.level === 'error') errors++; else warnings++; out.push(`${x.level} ${f.sig} l${x.lineno} ${x.message}`); }
}
console.log(JSON.stringify({ triggers: fns.filter((f) => f.trg).map((f) => `${f.sig}@${f.rel}`), version: v, functions: fns.length, errors, warnings }));
console.log(out.slice(0, 40).join('\n'));
await c.end();
