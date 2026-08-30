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
  const plan = await p.request().query(`
    SELECT PlanID, Stage, Version, BookingID, BookingCode, IdempotencyKey, ExecutionErrorCode, UpdatedAt
    FROM dbo.TblBotBookingPlan WHERE PlanID = 1
  `);
  const creates = await p.request().query(`
    SELECT TOP 5 RequestID, IdempotencyKey, BookingID, Status, LastErrorCode, CreatedAt
    FROM dbo.TblPublicBookingCreateRequest ORDER BY RequestID DESC
  `);
  const counts = await p.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.Bookings) AS bookings,
      (SELECT COUNT(*) FROM dbo.TblBookingHold) AS holds,
      (SELECT COUNT(*) FROM dbo.TblBookingSlotClaim) AS claims,
      (SELECT COUNT(*) FROM dbo.TblPublicBookingCreateRequest) AS creates
  `);
  console.log(JSON.stringify({ plan: plan.recordset[0], creates: creates.recordset, counts: counts.recordset[0] }, null, 2));
  await closePool();
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
