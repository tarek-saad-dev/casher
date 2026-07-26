#!/usr/bin/env npx tsx
/** Reset failed Camp Caesar smoke run 4 leftovers before retry. */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const o = m._load;
m._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};

async function main() {
  const { getPool, sql } = await import('../../src/lib/db');
  const { cleanupBranchSmokeRun } = await import('../../src/lib/branch/branchSmokeService');
  const db = await getPool();
  const runs = await db.request().query(`
    SELECT SmokeRunID, Status FROM dbo.TblBranchSmokeRun
    WHERE BranchID=3 AND Status IN (N'RUNNING', N'FAILED', N'PASSED')
    ORDER BY SmokeRunID DESC
  `);
  console.log('open runs', runs.recordset);
  for (const row of runs.recordset) {
    const id = Number(row.SmokeRunID);
    // Best-effort delete ops data for branch 3 smoke tags
    await db.request().input('bid', sql.Int, 3).query(`
      DELETE FROM dbo.TblEmpTargetRecalcRequest WHERE BranchID=@bid;
      DELETE FROM dbo.TblEmpLedgerEntry WHERE BranchID=@bid;
      DELETE FROM dbo.TblEmpDailyTarget WHERE BranchID=@bid;
      DELETE FROM dbo.TblEmpDailyPayroll WHERE BranchID=@bid;
      DELETE FROM dbo.TblEmpAttendance WHERE BranchID=@bid;
      DELETE FROM dbo.QueueTickets WHERE BranchID=@bid AND Source=N'phase1n-smoke';
      DELETE FROM dbo.Bookings WHERE BranchID=@bid AND Source=N'phase1n-smoke';
      DELETE FROM dbo.TblInventoryMovement WHERE BranchID=@bid;
      DELETE FROM dbo.TblBranchInventory WHERE BranchID=@bid;
      DELETE d FROM dbo.TblinvServDetail d
        INNER JOIN dbo.TblinvServHead h ON h.invID=d.invID AND h.invType=d.invType
        WHERE h.BranchID=@bid;
      DELETE FROM dbo.TblinvServPayment WHERE invID IN (
        SELECT invID FROM dbo.TblinvServHead WHERE BranchID=@bid
      );
      DELETE FROM dbo.TblCashMove WHERE BranchID=@bid;
      DELETE FROM dbo.TblinvServHead WHERE BranchID=@bid;
      DELETE FROM dbo.TblShiftMove WHERE BranchID=@bid;
      DELETE FROM dbo.TblNewDay WHERE BranchID=@bid;
    `);
    await cleanupBranchSmokeRun({
      branchId: 3,
      smokeRunId: id,
      actorUserId: 10,
      markArtifactsCleaned: true,
    });
    console.log('cleaned', id);
  }
  const b = await db.request().query(`
    SELECT BranchID, LifecycleStatus, IsActive, PublicBookingEnabled FROM dbo.TblBranch WHERE BranchID=3
  `);
  console.log('branch', b.recordset[0]);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
