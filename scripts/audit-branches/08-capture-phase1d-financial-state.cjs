/**
 * Phase 1D financial fingerprint capture (read-only).
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { connectReadOnly } = require('./_db.cjs');

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

async function capture(pool) {
  const counts = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblinvServHead) AS InvoiceHeadCount,
      (SELECT COUNT(*) FROM dbo.TblinvServDetail) AS InvoiceDetailCount,
      (SELECT COUNT(*) FROM dbo.TblinvServPayment) AS ServPaymentCount,
      (SELECT COUNT(*) FROM dbo.TblCashMove) AS CashMoveCount,
      (SELECT COUNT(*) FROM dbo.TblTreasuryCloseRecon) AS TreasuryReconCount,
      (SELECT COUNT(*) FROM dbo.TblShiftMove) AS ShiftMoveCount,
      (SELECT COUNT(*) FROM dbo.TblNewDay) AS NewDayCount,
      (SELECT COUNT(*) FROM dbo.TblEmpLedgerEntry) AS LedgerCount,
      (SELECT COUNT(*) FROM dbo.TblEmpTargetRecalcRequest) AS TargetRecalcCount,
      (SELECT COUNT(*) FROM dbo.TblClientLoyalty) AS ClientLoyaltyCount,
      (SELECT COUNT(*) FROM dbo.TblLoyaltyPointLedger) AS LoyaltyLedgerCount,
      (SELECT SUM(CAST(GrandTotal AS decimal(18,2))) FROM dbo.TblinvServHead) AS InvoiceGrandTotalSum,
      (SELECT SUM(CAST(PayValue AS decimal(18,2))) FROM dbo.TblinvServPayment) AS PaymentValueSum,
      (SELECT SUM(CASE WHEN inOut=N'in' THEN CAST(GrandTolal AS decimal(18,2)) ELSE 0 END) FROM dbo.TblCashMove) AS CashInSum,
      (SELECT SUM(CASE WHEN inOut=N'out' THEN CAST(GrandTolal AS decimal(18,2)) ELSE 0 END) FROM dbo.TblCashMove) AS CashOutSum,
      (SELECT CHECKSUM_AGG(CHECKSUM(ID, invID, invType, invDate, ShiftMoveID, GrandTotal, isActive, PaymentMethodID))
         FROM dbo.TblinvServHead) AS InvoiceChecksum,
      (SELECT CHECKSUM_AGG(CHECKSUM(ID, invID, invType, EmpID, ProID, Qty, SPriceAfterDis))
         FROM dbo.TblinvServDetail) AS DetailChecksum,
      (SELECT CHECKSUM_AGG(CHECKSUM(ID, invID, invType, PayDate, PayValue, PaymentMethodID, ShiftMoveID))
         FROM dbo.TblinvServPayment) AS PaymentChecksum,
      (SELECT CHECKSUM_AGG(CHECKSUM(ID, invID, invType, invDate, ShiftMoveID, GrandTolal, inOut, PaymentMethodID, ExpINID))
         FROM dbo.TblCashMove) AS CashChecksum,
      (SELECT CHECKSUM_AGG(CHECKSUM(ID, NewDay, ShiftMoveID, PaymentMethodID, SystemAmount, CountedAmount, ClosedByUserID))
         FROM dbo.TblTreasuryCloseRecon) AS ReconChecksum
  `);

  const byType = await pool.request().query(`
    SELECT invType, COUNT(*) AS cnt, SUM(CAST(GrandTolal AS decimal(18,2))) AS total
    FROM dbo.TblCashMove GROUP BY invType ORDER BY cnt DESC
  `);
  const byPm = await pool.request().query(`
    SELECT PaymentMethodID, COUNT(*) AS cnt, SUM(CAST(GrandTolal AS decimal(18,2))) AS total
    FROM dbo.TblCashMove GROUP BY PaymentMethodID ORDER BY PaymentMethodID
  `);
  const saleCashPairs = await pool.request().query(`
    SELECT COUNT(*) AS sale_cash_pairs
    FROM dbo.TblinvServHead h
    INNER JOIN dbo.TblCashMove cm ON cm.invID = h.invID AND cm.invType = h.invType
    WHERE h.invType = N'مبيعات'
  `);
  const ct = await pool.request().query(`
    SELECT OBJECT_NAME(object_id) AS table_name, is_track_columns_updated_on
    FROM sys.change_tracking_tables
    WHERE OBJECT_NAME(object_id) IN (N'TblinvServHead', N'TblCashMove', N'TblTreasuryCloseRecon', N'TblinvServDetail')
  `);

  return {
    capturedAt: new Date().toISOString(),
    counts: counts.recordset[0],
    cashByType: byType.recordset,
    cashByPaymentMethod: byPm.recordset,
    saleCashPairs: saleCashPairs.recordset[0],
    changeTracking: ct.recordset,
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
    const outPath = path.join(__dirname, `_phase1d-legacy-${mode}.json`);
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(
      JSON.stringify(
        {
          mode,
          outPath: path.relative(process.cwd(), outPath),
          counts: payload.counts,
          saleCashPairs: payload.saleCashPairs,
          changeTracking: payload.changeTracking,
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
