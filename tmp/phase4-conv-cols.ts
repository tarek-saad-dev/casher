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
  const { getPool, closePool } = await import('./src/lib/db.ts');
  const p = await getPool();
  const cols = await p.request().query(`
    SELECT c.name FROM sys.columns c
    WHERE c.object_id = OBJECT_ID(N'dbo.TblBotConversation')
    ORDER BY c.column_id
  `);
  const row = await p.request().query(`SELECT TOP 1 * FROM dbo.TblBotConversation WHERE ConversationID = 6`);
  console.log(JSON.stringify({ cols: cols.recordset.map((x: any) => x.name), row: row.recordset[0] }, null, 2));
  await closePool();
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
