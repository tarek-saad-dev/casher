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
    SELECT PlanID, ConversationID, Stage, Version, EmpID, RequestedDate, SelectedSlotJson,
      BranchCode, ServiceIdsJson, ServiceNamesJson, EmployeeName, BranchName,
      BookingID, BookingCode, IdempotencyKey, ExecutionErrorCode, ClientID, UpdatedAt, CompletedAt
    FROM dbo.TblBotBookingPlan WHERE PlanID = 1
  `);

  const msgs = await p.request().query(`
    SELECT TOP 6 MessageID, Direction, Content, TextContent, BodyText, CreatedAt
    FROM dbo.TblBotMessage WHERE ConversationID = 6
    ORDER BY MessageID DESC
  `).catch(async () => {
    const cols = await p.request().query(`
      SELECT c.name FROM sys.columns c
      WHERE c.object_id = OBJECT_ID(N'dbo.TblBotMessage') ORDER BY c.column_id
    `);
    const names = (cols.recordset as Array<{ name: string }>).map((x) => x.name);
    const textCol = ['Content', 'BodyText', 'Text', 'MessageText', 'Body'].find((n) => names.includes(n)) || names[0];
    return p.request().query(`
      SELECT TOP 6 MessageID, Direction, [${textCol}] AS TextContent, CreatedAt
      FROM dbo.TblBotMessage WHERE ConversationID = 6 ORDER BY MessageID DESC
    `);
  });

  const turns = await p.request().query(`
    SELECT TOP 3 TurnID, Status, AnchorInboundMessageID, LatestInboundMessageID,
      OutboundMessageID, Intent, ErrorCode, CreatedAt, CompletedAt
    FROM dbo.TblBotAiTurn WHERE ConversationID = 6 ORDER BY TurnID DESC
  `);

  const creates = await p.request().query(`
    SELECT RequestID, IdempotencyKey, BookingID, BookingCode, Status, LastErrorCode, CreatedAt, CompletedAt
    FROM dbo.TblPublicBookingCreateRequest
    WHERE IdempotencyKey LIKE N'bot-booking-plan:1:%'
    ORDER BY RequestID DESC
  `);

  const counts = await p.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.Bookings) AS bookings,
      (SELECT COUNT(*) FROM dbo.TblBookingHold) AS holds,
      (SELECT COUNT(*) FROM dbo.TblBookingSlotClaim) AS claims,
      (SELECT COUNT(*) FROM dbo.TblPublicBookingCreateRequest) AS creates,
      (SELECT COUNT(*) FROM dbo.Bookings WHERE BookingID = 3838) AS booking3838,
      (SELECT COUNT(*) FROM dbo.Bookings WHERE AssignedEmpID = 25 AND CAST(BookingDate AS DATE) = '2026-08-30' AND StartTime = '12:00:00') AS sameSlotBookings,
      (SELECT COUNT(*) FROM dbo.TblPublicBookingCreateRequest WHERE IdempotencyKey = N'bot-booking-plan:1:v7') AS keyCreates
  `);

  const booking = await p.request().query(`
    SELECT BookingID, BookingCode, ClientID, AssignedEmpID, BranchID, BookingDate, StartTime, EndTime,
      Status, Source, Notes, AbsoluteStartUtc, IdempotencyRequestID, CreatedAt
    FROM dbo.Bookings WHERE BookingID = 3838
  `);

  const claims = await p.request().query(`
    SELECT ClaimID, EmpID, BranchID, AbsoluteSlotStartUtc, ClaimType, BookingID, HoldToken
    FROM dbo.TblBookingSlotClaim WHERE BookingID = 3838 ORDER BY ClaimID
  `);

  const orphanHolds = await p.request().query(`
    SELECT COUNT(*) AS n FROM dbo.TblBookingSlotClaim
    WHERE EmpID = 25 AND ClaimType = N'HOLD'
      AND AbsoluteSlotStartUtc >= '2026-08-30T09:00:00'
      AND AbsoluteSlotStartUtc < '2026-08-30T10:00:00'
      AND (BookingID IS NULL OR BookingID <> 3838)
  `);

  const outbox = await p.request().query(`
    SELECT TOP 5 OutboxID, Status, Attempts, LastError, CreatedAt, SentAt, IdempotencyKey
    FROM dbo.TblMessageOutbox
    WHERE CreatedAt >= DATEADD(MINUTE, -30, SYSUTCDATETIME())
    ORDER BY OutboxID DESC
  `);

  console.log(
    JSON.stringify(
      {
        plan: plan.recordset[0],
        recentMessages: msgs.recordset,
        recentTurns: turns.recordset,
        createRequests: creates.recordset,
        counts: counts.recordset[0],
        booking: booking.recordset[0],
        claimCount: claims.recordset.length,
        claimsSample: claims.recordset.slice(0, 3),
        orphanHoldsNearSlot: orphanHolds.recordset[0],
        recentOutbox: outbox.recordset,
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
