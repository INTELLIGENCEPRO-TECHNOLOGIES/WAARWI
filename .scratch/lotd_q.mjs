import { client } from '../tests/backup-v3/deps.mjs';
const c = client({ database: process.env.DBN || 'br_v3_lotd_load' }); await c.connect();
try { const r = await c.query(process.argv[2]); console.log(JSON.stringify(r.rows ?? r.map?.(x=>x.rows), null, 0).slice(0, 6000)); } catch (e) { console.log('ERR', e.message, e.where || ''); }
await c.end();
