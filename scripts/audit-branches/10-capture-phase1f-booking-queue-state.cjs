/**
 * Phase 1F booking/queue fingerprint capture (read-only).
 * No customer names or phone numbers.
 *
 * Usage: node scripts/audit-branches/10-capture-phase1f-booking-queue-state.cjs [before|after]
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { connectReadOnly } = require('./_db.cjs');

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

async function capture(pool) {
  const hasBranchBooking = await pool.request().query(`
    SELECT CASE WHEN COL_LENGTH(N'dbo.Bookings', N'BranchID') IS NULL THEN 0 ELSE 1 END AS has_col
  `);
  const hasBranchQueue = await pool.request().query(`
    SELECT CASE WHEN COL_LENGTH(N'dbo.QueueTickets', N'BranchID') IS NULL THEN 0 ELSE 1 END AS has_col
  `);
  const hasBranchSettings = await pool.request().query(`
    SELECT CASE WHEN COL_LENGTH(N'dbo.QueueBookingSettings', N'BranchID') IS NULL THEN 0 ELSE 1 END AS has_col
  `);
  const hasQts = await pool.request().query(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.QueueTicketServices', N'U') IS NULL THEN 0 ELSE 1 END AS exists_flag
  `);

  const bookingBranchSelect = hasBranchBooking.recordset[0].has_col
    ? `
      (SELECT COUNT(*) FROM dbo.Bookings WHERE BranchID IS NULL) AS BookingsNullBranch,
      (SELECT COUNT(*) FROM dbo.Bookings b
         INNER JOIN dbo.TblBranch br ON br.BranchID = b.BranchID AND br.BranchCode = N'GLEEM') AS BookingsGleem,
      (SELECT COUNT(*) FROM dbo.Bookings b
         LEFT JOIN dbo.TblBranch br ON br.BranchID = b.BranchID AND br.BranchCode = N'GLEEM'
         WHERE b.BranchID IS NOT NULL AND br.BranchID IS NULL) AS BookingsNonGleem
    `
    : `
      CAST(NULL AS INT) AS BookingsNullBranch,
      CAST(NULL AS INT) AS BookingsGleem,
      CAST(NULL AS INT) AS BookingsNonGleem
    `;

  const queueBranchSelect = hasBranchQueue.recordset[0].has_col
    ? `
      (SELECT COUNT(*) FROM dbo.QueueTickets WHERE BranchID IS NULL) AS QueueNullBranch,
      (SELECT COUNT(*) FROM dbo.QueueTickets q
         INNER JOIN dbo.TblBranch br ON br.BranchID = q.BranchID AND br.BranchCode = N'GLEEM') AS QueueGleem,
      (SELECT COUNT(*) FROM dbo.QueueTickets q
         LEFT JOIN dbo.TblBranch br ON br.BranchID = q.BranchID AND br.BranchCode = N'GLEEM'
         WHERE q.BranchID IS NOT NULL AND br.BranchID IS NULL) AS QueueNonGleem
    `
    : `
      CAST(NULL AS INT) AS QueueNullBranch,
      CAST(NULL AS INT) AS QueueGleem,
      CAST(NULL AS INT) AS QueueNonGleem
    `;

  const settingsBranchSelect = hasBranchSettings.recordset[0].has_col
    ? `
      (SELECT COUNT(*) FROM dbo.QueueBookingSettings WHERE BranchID IS NULL) AS SettingsNullBranch,
      (SELECT COUNT(*) FROM dbo.QueueBookingSettings s
         INNER JOIN dbo.TblBranch br ON br.BranchID = s.BranchID AND br.BranchCode = N'GLEEM') AS SettingsGleem
    `
    : `
      CAST(NULL AS INT) AS SettingsNullBranch,
      CAST(NULL AS INT) AS SettingsGleem
    `;

  const counts = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.Bookings) AS BookingsCount,
      (SELECT COUNT(*) FROM dbo.BookingServices) AS BookingServicesCount,
      (SELECT COUNT(*) FROM dbo.QueueTickets) AS QueueTicketsCount,
      (SELECT COUNT(*) FROM dbo.QueueTicketHistory) AS QueueHistoryCount,
      (SELECT COUNT(*) FROM dbo.QueueBookingSettings) AS SettingsCount,
      ${hasQts.recordset[0].exists_flag
        ? '(SELECT COUNT(*) FROM dbo.QueueTicketServices) AS QueueTicketServicesCount'
        : 'CAST(0 AS INT) AS QueueTicketServicesCount'},
      (SELECT COUNT(*) FROM dbo.Bookings WHERE BookingCode IS NULL) AS NullBookingCodes,
      (SELECT COUNT(DISTINCT BookingCode) FROM dbo.Bookings WHERE BookingCode IS NOT NULL) AS DistinctBookingCodes,
      (SELECT COUNT(*) FROM (
         SELECT BookingCode FROM dbo.Bookings WHERE BookingCode IS NOT NULL
         GROUP BY BookingCode HAVING COUNT(*) > 1
       ) d) AS DupBookingCodes,
      (SELECT COUNT(*) FROM (
         SELECT TicketCode, QueueDate FROM dbo.QueueTickets
         GROUP BY TicketCode, QueueDate HAVING COUNT(*) > 1
       ) d) AS DupTicketCodeDate,
      (SELECT COUNT(DISTINCT CAST(AssignedEmpID AS nvarchar(20)) + N'|' + CONVERT(nvarchar(10), BookingDate, 23))
         FROM dbo.Bookings WHERE AssignedEmpID IS NOT NULL) AS BookingEmpDatePairs,
      (SELECT COUNT(*) FROM dbo.Bookings
         WHERE EndTime IS NOT NULL AND CAST(EndTime AS time) < CAST(StartTime AS time)) AS CrossMidnightBookings,
      (SELECT CHECKSUM_AGG(CHECKSUM(
         BookingID, ClientID, AssignedEmpID, BookingDate, StartTime, EndTime,
         Status, Source, BookingCode, QueueTicketID, ConvertedInvID, ConvertedInvType,
         CancelledAt, CancelReason
       )) FROM dbo.Bookings) AS BookingsChecksum,
      (SELECT CHECKSUM_AGG(CHECKSUM(BookingServiceID, BookingID, ProID, EmpID, Qty, Price, DurationMinutes))
         FROM dbo.BookingServices) AS BookingServicesChecksum,
      (SELECT CHECKSUM_AGG(CHECKSUM(
         QueueTicketID, TicketCode, TicketNumber, QueueDate, EmpID, Status, Source,
         EstimatedStartTime, EstimatedWaitMinutes, BookingID, Priority
       )) FROM dbo.QueueTickets) AS QueueTicketsChecksum,
      (SELECT CHECKSUM_AGG(CHECKSUM(ID, QueueTicketID, OldStatus, NewStatus, ActionType, ActionAt))
         FROM dbo.QueueTicketHistory) AS QueueHistoryChecksum,
      (SELECT ISNULL(SUM(CAST(EstimatedWaitMinutes AS bigint)), 0) FROM dbo.QueueTickets) AS EstimateWaitSum,
      (SELECT COUNT(*) FROM dbo.QueueTickets WHERE EstimatedWaitMinutes IS NOT NULL) AS EstimateWaitCount,
      (SELECT COUNT(*) FROM dbo.Bookings WHERE ConvertedInvID IS NOT NULL) AS ConvertedBookingCount,
      (SELECT COUNT(*) FROM dbo.TblinvServHead h
         INNER JOIN dbo.Bookings b ON b.ConvertedInvID = h.invID
           AND ISNULL(b.ConvertedInvType, N'خدمة') = h.invType) AS ConvertedSaleMatches,
      ${bookingBranchSelect},
      ${queueBranchSelect},
      ${settingsBranchSelect}
  `);

  const statusDist = await pool.request().query(`
    SELECT Status, COUNT(*) AS cnt
    FROM dbo.Bookings
    GROUP BY Status
    ORDER BY cnt DESC
  `);

  const queueStatusDist = await pool.request().query(`
    SELECT Status, COUNT(*) AS cnt
    FROM dbo.QueueTickets
    GROUP BY Status
    ORDER BY cnt DESC
  `);

  const uniqueIndexes = await pool.request().query(`
    SELECT t.name AS table_name, i.name AS index_name, i.is_unique,
           STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS columns
    FROM sys.indexes i
    INNER JOIN sys.tables t ON t.object_id = i.object_id
    INNER JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    INNER JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE t.name IN (N'Bookings', N'QueueTickets', N'QueueBookingSettings')
      AND i.is_unique = 1
      AND i.name IS NOT NULL
    GROUP BY t.name, i.name, i.is_unique
    ORDER BY t.name, i.name
  `);

  const gleem = await pool.request().query(`
    SELECT BranchID, BranchCode, BranchName, IsActive
    FROM dbo.TblBranch WHERE BranchCode = N'GLEEM'
  `);

  return {
    capturedAt: new Date().toISOString(),
    gleem: gleem.recordset[0] || null,
    columnsPresent: {
      BookingsBranchID: Boolean(hasBranchBooking.recordset[0].has_col),
      QueueTicketsBranchID: Boolean(hasBranchQueue.recordset[0].has_col),
      QueueBookingSettingsBranchID: Boolean(hasBranchSettings.recordset[0].has_col),
    },
    counts: counts.recordset[0],
    bookingStatusDist: statusDist.recordset,
    queueStatusDist: queueStatusDist.recordset,
    uniqueIndexes: uniqueIndexes.recordset,
  };
}

async function main() {
  const mode = process.argv[2] || 'before';
  const { pool, target, database } = await connectReadOnly();
  try {
    if (database !== 'last132') throw new Error(`Expected last132, got ${database}`);
    const payload = await capture(pool);
    payload.target = target;
    payload.database = database;
    const outPath = path.join(__dirname, `_phase1f-booking-queue-${mode}.json`);
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(
      JSON.stringify(
        {
          mode,
          outPath: path.relative(process.cwd(), outPath),
          counts: payload.counts,
          columnsPresent: payload.columnsPresent,
          uniqueIndexes: payload.uniqueIndexes,
          gleem: payload.gleem,
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
