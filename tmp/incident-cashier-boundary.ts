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

  const tables = await p.request().query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA='dbo' AND (
      TABLE_NAME LIKE N'%Spool%' OR TABLE_NAME LIKE N'%WhatsApp%Inbox%'
      OR TABLE_NAME LIKE N'%Baileys%' OR TABLE_NAME LIKE N'%Lid%'
      OR TABLE_NAME LIKE N'%Inbound%' OR TABLE_NAME LIKE N'%Provider%Idem%'
    )
    ORDER BY TABLE_NAME
  `);

  const inbox = await p.request().query(`
    SELECT TOP 10 ID, Phone, LEFT(Text,80) AS Text, Status, ProviderMessageID, CreatedAt, ReceivedAt
    FROM dbo.TblMessageInbox
    WHERE Phone LIKE N'%1557994946%' OR CreatedAt >= DATEADD(HOUR, -6, SYSUTCDATETIME())
    ORDER BY ID DESC
  `);

  const maxId = await p.request().query(`
    SELECT MAX(ID) AS maxId, MAX(CreatedAt) AS maxCreated
    FROM dbo.TblMessageInbox WHERE Phone LIKE N'%1557994946%'
  `);

  console.log(JSON.stringify({
    relatedTables: tables.recordset,
    recentCustomerOrRecent: inbox.recordset,
    customerMax: maxId.recordset[0],
  }, null, 2));
  await closePool();
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
