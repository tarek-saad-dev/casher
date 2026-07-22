/**
 * Capture and compare legacy TblNewDay / TblShiftMove fingerprints.
 * Read-only. Never prints secrets.
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { connectReadOnly } = require('./_db.cjs');

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

async function capture(pool) {
  const openDay = await pool.request().query(`
    SELECT ID, NewDay, Status
    FROM dbo.TblNewDay
    WHERE Status = 1
    ORDER BY ID
  `);
  const openShifts = await pool.request().query(`
    SELECT
      sm.ID, sm.UserID, sm.ShiftID, sm.NewDay, sm.StartDate, sm.StartTime,
      sm.EndDate, sm.EndTime, sm.Status, u.UserName
    FROM dbo.TblShiftMove sm
    LEFT JOIN dbo.TblUser u ON u.UserID = sm.UserID
    WHERE ISNULL(sm.Status, 0) = 1
    ORDER BY sm.ID
  `);
  const counts = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblinvServHead) AS InvoiceHeadCount,
      (SELECT COUNT(*) FROM dbo.TblCashMove) AS CashMoveCount,
      (SELECT COUNT(*) FROM dbo.TblEmpAttendance) AS AttendanceCount,
      (SELECT COUNT_BIG(*) FROM dbo.Bookings) AS BookingCount,
      (SELECT COUNT_BIG(*) FROM dbo.QueueTickets) AS QueueTicketCount,
      (SELECT COUNT(*) FROM dbo.TblNewDay) AS NewDayCount,
      (SELECT COUNT(*) FROM dbo.TblShiftMove) AS ShiftMoveCount,
      (SELECT CHECKSUM_AGG(CHECKSUM(ID, UserID, ShiftID, Status, StartDate, StartTime))
         FROM dbo.TblShiftMove WHERE ISNULL(Status,0)=1) AS OpenShiftChecksum,
      (SELECT CHECKSUM_AGG(CHECKSUM(ID, NewDay, Status))
         FROM dbo.TblNewDay WHERE Status = 1) AS OpenDayChecksum
  `);
  return {
    capturedAt: new Date().toISOString(),
    openDays: openDay.recordset,
    openShifts: openShifts.recordset,
    counts: counts.recordset[0],
  };
}

async function main() {
  const mode = process.argv[2] || 'before';
  const outPath = path.join(
    process.cwd(),
    'scripts',
    'audit-branches',
    `_phase1b-legacy-${mode}.json`,
  );
  const { pool, target, database } = await connectReadOnly();
  try {
    if (database !== 'last132') {
      throw new Error(`Expected database last132, got ${database}`);
    }
    const payload = await capture(pool);
    payload.target = target;
    payload.database = database;
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(
      JSON.stringify(
        {
          mode,
          outPath: path.relative(process.cwd(), outPath),
          openDayCount: payload.openDays.length,
          openShiftCount: payload.openShifts.length,
          counts: payload.counts,
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
