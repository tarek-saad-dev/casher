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
    SELECT PlanID, Stage, Version, BookingID, BookingCode, IdempotencyKey, ExecutionErrorCode,
      EmpID, BranchCode, RequestedDate, SelectedSlotJson, ServiceIdsJson, CompletedAt, UpdatedAt
    FROM dbo.TblBotBookingPlan WHERE PlanID = 1
  `);

  const msgCols = await p.request().query(`
    SELECT c.name FROM sys.columns c
    WHERE c.object_id = OBJECT_ID(N'dbo.TblBotMessage') ORDER BY c.column_id
  `);
  const names = (msgCols.recordset as Array<{ name: string }>).map((x) => x.name);
  const textCol = ['Content', 'BodyText', 'Text', 'MessageText', 'Body'].find((n) => names.includes(n)) || 'Content';

  const msgs = await p.request().query(`
    SELECT TOP 4 MessageID, Direction, [${textCol}] AS TextContent, CreatedAt
    FROM dbo.TblBotMessage WHERE ConversationID = 6 ORDER BY MessageID DESC
  `);

  const outCols = await p.request().query(`
    SELECT c.name FROM sys.columns c
    WHERE c.object_id = OBJECT_ID(N'dbo.TblMessageOutbox') ORDER BY c.column_id
  `);
  const onames = (outCols.recordset as Array<{ name: string }>).map((x) => x.name);
  const outbox = await p.request().query(`
    SELECT TOP 3 * FROM dbo.TblMessageOutbox ORDER BY ${onames.includes('OutboxID') ? 'OutboxID' : onames[0]} DESC
  `);

  const counts = await p.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.Bookings) AS bookings,
      (SELECT COUNT(*) FROM dbo.TblBookingHold) AS holds,
      (SELECT COUNT(*) FROM dbo.TblBookingSlotClaim) AS claims,
      (SELECT COUNT(*) FROM dbo.TblPublicBookingCreateRequest) AS creates,
      (SELECT COUNT(*) FROM dbo.Bookings WHERE BookingID = 3838) AS booking3838,
      (SELECT COUNT(*) FROM dbo.Bookings WHERE AssignedEmpID = 25 AND CAST(BookingDate AS DATE) = '2026-08-30' AND CONVERT(varchar(5), StartTime, 108) = '12:00') AS sameSlotBookings,
      (SELECT COUNT(*) FROM dbo.TblPublicBookingCreateRequest WHERE IdempotencyKey = N'bot-booking-plan:1:v7') AS keyCreates,
      (SELECT COUNT(*) FROM dbo.TblBookingSlotClaim WHERE BookingID = 3838 AND ClaimType = N'BOOKING') AS bookingClaims,
      (SELECT COUNT(*) FROM dbo.TblBookingSlotClaim WHERE BookingID = 3838 AND ClaimType = N'HOLD') AS holdClaims
  `);

  const booking = await p.request().query(`
    SELECT BookingID, BookingCode, ClientID, AssignedEmpID, BranchID, BookingDate, StartTime, Status, Source, Notes, CreatedAt
    FROM dbo.Bookings WHERE BookingID = 3838
  `);

  console.log(
    JSON.stringify(
      {
        plan: plan.recordset[0],
        recentMessages: msgs.recordset,
        counts: counts.recordset[0],
        booking: booking.recordset[0],
        outboxCols: onames,
        recentOutbox: outbox.recordset.map((r: any) => {
          const copy = { ...r };
          // trim large payloads
          for (const k of Object.keys(copy)) {
            if (typeof copy[k] === 'string' && copy[k].length > 200) copy[k] = copy[k].slice(0, 200) + '…';
          }
          return copy;
        }),
      },
      null,
      2,
    ),
  );
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
