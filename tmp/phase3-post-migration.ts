#!/usr/bin/env npx tsx
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });
const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const orig = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return orig.call(this, r, ...rest);
};
async function main() {
  const { getPool, closePool } = await import('./src/lib/db.ts');
  const p = await getPool();
  const schema = await p.request().query(`
    SELECT i.name AS indexName, i.is_unique, i.filter_definition
    FROM sys.indexes i
    WHERE i.object_id = OBJECT_ID(N'dbo.TblBotBookingPlan') AND i.name IS NOT NULL;
    SELECT fk.name AS fkName
    FROM sys.foreign_keys fk
    WHERE fk.parent_object_id = OBJECT_ID(N'dbo.TblBotBookingPlan');
    SELECT
      (SELECT COUNT(*) FROM dbo.Bookings) AS bookings,
      (SELECT COUNT(*) FROM dbo.TblBookingHold) AS holds,
      (SELECT COUNT(*) FROM dbo.TblBookingSlotClaim) AS claims,
      (SELECT COUNT(*) FROM dbo.TblPublicBookingCreateRequest) AS creates,
      (SELECT COUNT(*) FROM dbo.TblBotConversation) AS conversations,
      (SELECT COUNT(*) FROM dbo.TblBotMessage) AS messages,
      (SELECT COUNT(*) FROM dbo.TblBotAiTurn) AS aiTurns,
      (SELECT COUNT(*) FROM dbo.TblMessageOutbox) AS outbox,
      (SELECT COUNT(*) FROM dbo.TblBotBookingPlan) AS plans
  `);
  console.log(JSON.stringify({
    indexes: schema.recordsets[0],
    fks: schema.recordsets[1],
    counts: schema.recordsets[2][0],
  }, null, 2));
  await closePool();
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
