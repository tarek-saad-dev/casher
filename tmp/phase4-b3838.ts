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
  const b = await p.request().query(`
    SELECT BookingID, BookingCode, ClientID, AssignedEmpID, BranchID, BookingDate, StartTime, EndTime,
      Status, Source, Notes, AbsoluteStartUtc, IdempotencyRequestID, CreatedAt
    FROM dbo.Bookings WHERE BookingID = 3838
  `);
  const c = await p.request().query(`
    SELECT ClaimID, EmpID, BranchID, AbsoluteSlotStartUtc, ClaimType, BookingID, CreatedAtUtc
    FROM dbo.TblBookingSlotClaim WHERE BookingID = 3838
  `);
  console.log(JSON.stringify({ booking: b.recordset[0], claims: c.recordset }, null, 2));
  await closePool();
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
