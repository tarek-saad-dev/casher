#!/usr/bin/env npx tsx
import Module from 'module';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', override: true });
const mod = Module as any;
const o = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};
async function main() {
  const { getPool, closePool } = await import('../src/lib/db.ts');
  const p = await getPool();
  const r = await p.request().query(`
    SELECT name FROM sys.tables
    WHERE name LIKE '%Inbox%' OR name LIKE '%Spool%' OR name LIKE '%WhatsApp%'
       OR name LIKE '%Lid%' OR name LIKE '%Baileys%' OR name LIKE '%Idempot%'
       OR name LIKE '%Provider%'
    ORDER BY name
  `);
  console.log(JSON.stringify(r.recordset, null, 2));
  await closePool();
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
