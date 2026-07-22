/**
 * Phase 1C pre/post fingerprint capture (read-only).
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { connectReadOnly } = require('./_db.cjs');

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

async function capture(pool) {
  const openDays = await pool.request().query(`
    SELECT ID, NewDay, Status FROM dbo.TblNewDay WHERE Status = 1 ORDER BY ID
  `);
  const openShifts = await pool.request().query(`
    SELECT ID, UserID, ShiftID, NewDay, StartDate, StartTime, EndDate, EndTime, Status
    FROM dbo.TblShiftMove
    WHERE ISNULL(Status, 0) = 1
    ORDER BY ID
  `);
  const counts = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblNewDay) AS NewDayCount,
      (SELECT COUNT(*) FROM dbo.TblShiftMove) AS ShiftMoveCount,
      (SELECT COUNT(*) FROM dbo.TblinvServHead) AS InvoiceHeadCount,
      (SELECT COUNT(*) FROM dbo.TblCashMove) AS CashMoveCount,
      (SELECT COUNT(*) FROM dbo.TblinvServPayment) AS ServPaymentCount,
      (SELECT COUNT(*) FROM dbo.TblTreasuryCloseRecon) AS TreasuryReconCount,
      (SELECT CHECKSUM_AGG(CHECKSUM(ID, NewDay, Status)) FROM dbo.TblNewDay) AS NewDayChecksum,
      (SELECT CHECKSUM_AGG(CHECKSUM(ID, NewDay, UserID, ShiftID, Status, StartDate, StartTime, EndDate, EndTime))
         FROM dbo.TblShiftMove) AS ShiftMoveChecksum,
      (SELECT CHECKSUM_AGG(CHECKSUM(ID, UserID, ShiftID, Status, StartDate, StartTime))
         FROM dbo.TblShiftMove WHERE ISNULL(Status,0)=1) AS OpenShiftChecksum,
      (SELECT CHECKSUM_AGG(CHECKSUM(ID, NewDay, Status))
         FROM dbo.TblNewDay WHERE Status = 1) AS OpenDayChecksum,
      (SELECT CHECKSUM_AGG(CHECKSUM(ID, invID, invDate, ShiftMoveID, GrandTotal, isActive)) FROM dbo.TblinvServHead) AS InvoiceChecksum,
      (SELECT CHECKSUM_AGG(CHECKSUM(ID, invID, invDate, ShiftMoveID, GrandTolal, invType, inOut)) FROM dbo.TblCashMove) AS CashMoveChecksum,
      (SELECT CHECKSUM_AGG(CHECKSUM(ID, invID, PayDate, PayValue, ShiftMoveID, PaymentMethodID)) FROM dbo.TblinvServPayment) AS ServPaymentChecksum,
      (SELECT CHECKSUM_AGG(CHECKSUM(ID, NewDay, ShiftMoveID, PaymentMethodID, SystemAmount, CountedAmount, ClosedByUserID))
         FROM dbo.TblTreasuryCloseRecon) AS ReconChecksum
  `);

  const openShiftDetailHash = await pool.request().query(`
    SELECT
      ID,
      UserID,
      ShiftID,
      CONVERT(varchar(10), NewDay, 23) AS NewDay,
      CONVERT(varchar(10), StartDate, 23) AS StartDate,
      RTRIM(StartTime) AS StartTime,
      CONVERT(varchar(10), EndDate, 23) AS EndDate,
      RTRIM(EndTime) AS EndTime,
      CAST(Status AS int) AS Status
    FROM dbo.TblShiftMove
    WHERE ISNULL(Status, 0) = 1
    ORDER BY ID
  `);

  const openDayDetail = await pool.request().query(`
    SELECT ID, CONVERT(varchar(10), NewDay, 23) AS NewDay, CAST(Status AS int) AS Status
    FROM dbo.TblNewDay WHERE Status = 1 ORDER BY ID
  `);

  const reconAsId = await pool.request().query(`
    SELECT
      COUNT(*) AS recon_rows,
      SUM(CASE WHEN d.ID IS NOT NULL THEN 1 ELSE 0 END) AS match_as_id
    FROM dbo.TblTreasuryCloseRecon r
    LEFT JOIN dbo.TblNewDay d ON d.ID = r.NewDay
  `);

  return {
    capturedAt: new Date().toISOString(),
    openDays: openDays.recordset,
    openShifts: openShifts.recordset,
    openDayDetail: openDayDetail.recordset,
    openShiftDetail: openShiftDetailHash.recordset,
    counts: counts.recordset[0],
    treasuryReconMatchesDayId: reconAsId.recordset[0],
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
    const outPath = path.join(__dirname, `_phase1c-legacy-${mode}.json`);
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(
      JSON.stringify(
        {
          mode,
          outPath: path.relative(process.cwd(), outPath),
          openDayCount: payload.openDays.length,
          openShiftCount: payload.openShifts.length,
          counts: payload.counts,
          treasuryReconMatchesDayId: payload.treasuryReconMatchesDayId,
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
