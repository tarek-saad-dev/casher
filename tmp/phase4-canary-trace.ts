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
  const pool = await getPool();

  const plan = await pool.request().query(`
    SELECT PlanID, ConversationID, Stage, Version, EmpID, RequestedDate, SelectedSlotJson,
      BranchCode, ServiceIdsJson, ServiceNamesJson, EmployeeName, BranchName,
      BookingID, BookingCode, IdempotencyKey, ExecutionErrorCode, ClientID, UpdatedAt, CompletedAt
    FROM dbo.TblBotBookingPlan WHERE PlanID = 1
  `);

  const msgs = await pool.request().query(`
    SELECT TOP 8 MessageID, Direction, Body, CreatedAt, InboxID, OutboxID
    FROM dbo.TblBotMessage
    WHERE ConversationID = 6
    ORDER BY MessageID DESC
  `);

  const turns = await pool.request().query(`
    SELECT TOP 5 TurnID, ConversationID, Status, AnchorInboundMessageID, LatestInboundMessageID,
      OutboundMessageID, Intent, ErrorCode, CreatedAt, CompletedAt
    FROM dbo.TblBotAiTurn
    WHERE ConversationID = 6
    ORDER BY TurnID DESC
  `);

  const creates = await pool.request().query(`
    SELECT TOP 5 RequestID, IdempotencyKey, BookingID, BookingCode, Status, LastErrorCode, CreatedAt, CompletedAt
    FROM dbo.TblPublicBookingCreateRequest
    WHERE IdempotencyKey LIKE N'bot-booking-plan:1:%'
       OR CreatedAt >= DATEADD(MINUTE, -15, SYSUTCDATETIME())
    ORDER BY RequestID DESC
  `);

  const p = plan.recordset[0] as any;
  const bookingId = p?.BookingID;
  let booking: unknown = null;
  let claims: unknown = [];
  if (bookingId) {
    const b = await pool.request().input('id', bookingId).query(`
      SELECT BookingID, BookingCode, ClientID, AssignedEmpID, BranchID, BookingDate, StartTime, EndTime,
        Status, Source, Notes, AbsoluteStartUtc, AbsoluteEndUtc, IdempotencyRequestID, CreatedAt
      FROM dbo.Bookings WHERE BookingID = @id
    `);
    booking = b.recordset[0] || null;
    const c = await pool.request().input('id', bookingId).query(`
      SELECT ClaimID, EmpID, BranchID, AbsoluteSlotStartUtc, ClaimType, BookingID, HoldToken, CreatedAtUtc
      FROM dbo.TblBookingSlotClaim WHERE BookingID = @id
    `);
    claims = c.recordset;
  }

  const counts = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblBookingHold) AS holds,
      (SELECT COUNT(*) FROM dbo.TblBookingSlotClaim) AS claims,
      (SELECT COUNT(*) FROM dbo.TblPublicBookingCreateRequest) AS creates,
      (SELECT COUNT(*) FROM dbo.Bookings) AS bookings,
      (SELECT COUNT(*) FROM dbo.Bookings WHERE AssignedEmpID = 25 AND CAST(BookingDate AS DATE) = '2026-08-30') AS canaryEmpDateBookings,
      (SELECT COUNT(*) FROM dbo.TblPublicBookingCreateRequest WHERE IdempotencyKey LIKE N'bot-booking-plan:1:%') AS plan1Creates
  `);

  const outbox = await pool.request().query(`
    SELECT TOP 5 OutboxID, Status, ProviderMessageID, Attempts, LastError, CreatedAt, SentAt
    FROM dbo.TblMessageOutbox
    WHERE CreatedAt >= DATEADD(MINUTE, -20, SYSUTCDATETIME())
    ORDER BY OutboxID DESC
  `);

  console.log(
    JSON.stringify(
      {
        plan: p,
        recentMessages: msgs.recordset,
        recentTurns: turns.recordset,
        createRequests: creates.recordset,
        booking,
        claims,
        counts: counts.recordset[0],
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
