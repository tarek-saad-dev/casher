/**
 * READ-ONLY forensic probe for TblCashMove #39406 and #39399.
 */
import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

function section(title: string, lines: string[]) {
  lines.push('\n' + '='.repeat(80));
  lines.push(title);
  lines.push('='.repeat(80));
}

async function main() {
  const sql = (await import('mssql')).default;
  const server = process.argv[2] || '127.0.0.1';
  const port = parseInt(process.argv[3] || process.env.LOCAL_DB_PORT || '14330', 10);
  const db = await sql.connect({
    server,
    port,
    database: process.env.DB_DATABASE || 'last132',
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    connectionTimeout: 30000,
    requestTimeout: 180000,
  });

  const out: string[] = [];
  out.push(`Connected ${server}:${port}/${process.env.DB_DATABASE}`);

  // Schema discovery
  section('SCHEMA — TblCashMove columns', out);
  const cmCols = await db.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='TblCashMove' ORDER BY ORDINAL_POSITION
  `);
  out.push(JSON.stringify(cmCols.recordset.map((r: { COLUMN_NAME: string }) => r.COLUMN_NAME)));

  section('PHASE 1 — TblCashMove full rows', out);
  const cashMoves = await db.request().query(`
    SELECT cm.*,
      b.BranchCode, b.BranchName,
      nd.NewDay AS BusinessDate,
      sm.UserID AS ShiftUserID, sm.BranchID AS ShiftBranchID, sm.Status AS ShiftStatus,
      sm.StartDate, sm.StartTime, sm.EndDate, sm.EndTime,
      cat.CatName,
      su.UserName AS ShiftUserName
    FROM dbo.TblCashMove cm
    LEFT JOIN dbo.TblBranch b ON b.BranchID = cm.BranchID
    LEFT JOIN dbo.TblNewDay nd ON nd.ID = cm.BusinessDayID
    LEFT JOIN dbo.TblShiftMove sm ON sm.ID = cm.ShiftMoveID
    LEFT JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID
    LEFT JOIN dbo.TblUser su ON su.UserID = sm.UserID
    WHERE cm.ID IN (39406, 39399)
    ORDER BY cm.ID
  `);
  out.push(JSON.stringify(cashMoves.recordset, null, 2));

  section('PHASE 1 — Employee mapping', out);
  const mapping = await db.request().query(`
    SELECT cm.ID AS CashMoveID, cm.ExpINID, cm.GrandTolal, cm.invDate, cm.BranchID, b.BranchCode,
      map.EmpID, map.TxnKind, map.IsActive, e.EmpName, cat.CatName
    FROM dbo.TblCashMove cm
    LEFT JOIN dbo.TblBranch b ON b.BranchID = cm.BranchID
    LEFT JOIN dbo.TblExpCatEmpMap map ON map.ExpINID = cm.ExpINID
    LEFT JOIN dbo.TblEmp e ON e.EmpID = map.EmpID
    LEFT JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID
    WHERE cm.ID IN (39406, 39399)
    ORDER BY cm.ID, map.TxnKind
  `);
  out.push(JSON.stringify(mapping.recordset, null, 2));

  section('PHASE 1 — Ledger entries', out);
  const ledger = await db.request().query(`
    SELECT le.*, e.EmpName, b.BranchCode, u.UserName AS CreatedByName
    FROM dbo.TblEmpLedgerEntry le
    LEFT JOIN dbo.TblEmp e ON e.EmpID = le.EmpID
    LEFT JOIN dbo.TblBranch b ON b.BranchID = le.BranchID
    LEFT JOIN dbo.TblUser u ON u.UserID = le.CreatedByUserID
    WHERE le.CashMoveID IN (39406, 39399)
       OR (le.RefType = N'TblCashMove' AND le.RefID IN (39406, 39399))
    ORDER BY le.ID
  `);
  out.push(JSON.stringify(ledger.recordset, null, 2));

  section('PHASE 1 — Omar branch assignments', out);
  const assign = await db.request().query(`
    SELECT e.EmpID, e.EmpName, ba.BranchID, b.BranchCode, ba.EffectiveFrom, ba.EffectiveTo
    FROM dbo.TblEmp e
    JOIN dbo.TblEmpBranchAssignment ba ON ba.EmpID = e.EmpID
    JOIN dbo.TblBranch b ON b.BranchID = ba.BranchID
    WHERE e.EmpName LIKE N'%عمر%'
    ORDER BY e.EmpID, ba.EffectiveFrom DESC
  `);
  out.push(JSON.stringify(assign.recordset, null, 2));

  section('PHASE 2 — One advance vs two', out);
  const phase2 = await db.request().query(`
    SELECT cm.ID AS CashMoveID, cm.BranchID, b.BranchCode, map.EmpID, e.EmpName,
      le.ID AS LedgerID, le.RefID, le.CashMoveID AS LedgerCashMoveID, le.Amount, le.CreatedAt
    FROM dbo.TblCashMove cm
    LEFT JOIN dbo.TblBranch b ON b.BranchID = cm.BranchID
    LEFT JOIN dbo.TblExpCatEmpMap map ON map.ExpINID = cm.ExpINID AND map.TxnKind = N'advance' AND map.IsActive = 1
    LEFT JOIN dbo.TblEmp e ON e.EmpID = map.EmpID
    LEFT JOIN dbo.TblEmpLedgerEntry le ON le.CashMoveID = cm.ID AND le.EntryReason = N'advance' AND le.IsVoided = 0
    WHERE cm.ID IN (39406, 39399)
    ORDER BY cm.ID
  `);
  out.push(JSON.stringify(phase2.recordset, null, 2));

  section('PHASE 2 — Paired settlement (معادلة) same day/shift', out);
  const paired = await db.request().query(`
    SELECT cm.ID, cm.invType, cm.inOut, cm.GrandTolal, cm.BranchID, b.BranchCode, cat.CatName, cm.Notes, cm.ShiftMoveID
    FROM dbo.TblCashMove cm
    LEFT JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID
    LEFT JOIN dbo.TblBranch b ON b.BranchID = cm.BranchID
    WHERE cm.invDate = '2026-08-28'
      AND cm.ShiftMoveID IN (SELECT ShiftMoveID FROM dbo.TblCashMove WHERE ID IN (39406, 39399))
    ORDER BY cm.ID
  `);
  out.push(JSON.stringify(paired.recordset, null, 2));

  section('PHASE 3 — All Omar advances 2026-08-28', out);
  const omarDay = await db.request().query(`
    SELECT cm.ID, cm.invID, cm.invDate, cm.invTime, cm.GrandTolal, cm.BranchID, b.BranchCode,
      cm.ExpINID, cat.CatName, cm.ShiftMoveID, cm.BusinessDayID, cm.PaymentMethodID, cm.Notes,
      map.EmpID, e.EmpName, sm.UserID AS ShiftUserID, su.UserName AS ShiftUserName,
      le.ID AS LedgerID, le.CreatedAt AS LedgerCreatedAt, le.CreatedByUserID, lu.UserName AS LedgerCreatedByName
    FROM dbo.TblCashMove cm
    JOIN dbo.TblExpCatEmpMap map ON map.ExpINID = cm.ExpINID AND map.TxnKind = N'advance'
    JOIN dbo.TblEmp e ON e.EmpID = map.EmpID
    JOIN dbo.TblBranch b ON b.BranchID = cm.BranchID
    LEFT JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID
    LEFT JOIN dbo.TblShiftMove sm ON sm.ID = cm.ShiftMoveID
    LEFT JOIN dbo.TblUser su ON su.UserID = sm.UserID
    LEFT JOIN dbo.TblEmpLedgerEntry le ON le.CashMoveID = cm.ID AND le.EntryReason = N'advance' AND le.IsVoided = 0
    LEFT JOIN dbo.TblUser lu ON lu.UserID = le.CreatedByUserID
    WHERE e.EmpName LIKE N'%عمر%' AND cm.invDate = '2026-08-28'
      AND cm.invType = N'مصروفات' AND cm.inOut = N'out'
    ORDER BY cm.ID
  `);
  out.push(JSON.stringify(omarDay.recordset, null, 2));

  section('PHASE 6 — Report JOIN fan-out test', out);
  const fanout = await db.request().query(`
    SELECT cm.ID AS CashMoveID, cm.BranchID AS CashMoveBranchID,
      ba.BranchID AS AssignmentBranchID, b.BranchCode, e.EmpID, e.EmpName
    FROM dbo.TblCashMove cm
    JOIN dbo.TblExpCatEmpMap map ON map.ExpINID = cm.ExpINID AND map.TxnKind = N'advance'
    JOIN dbo.TblEmp e ON e.EmpID = map.EmpID
    LEFT JOIN dbo.TblEmpBranchAssignment ba ON ba.EmpID = e.EmpID
      AND (ba.EffectiveTo IS NULL OR ba.EffectiveTo >= cm.invDate)
      AND ba.EffectiveFrom <= cm.invDate
    LEFT JOIN dbo.TblBranch b ON b.BranchID = ba.BranchID
    WHERE cm.ID IN (39406, 39399)
    ORDER BY cm.ID, ba.BranchID
  `);
  out.push(`Fan-out rows: ${fanout.recordset.length}`);
  out.push(JSON.stringify(fanout.recordset, null, 2));

  section('PHASE 7 — Aug 2026 cross-branch duplicate pairs', out);
  const augDupes = await db.request().query(`
    WITH advances AS (
      SELECT cm.ID AS CashMoveID, map.EmpID, e.EmpName, cm.invDate, cm.invTime,
        cm.GrandTolal AS Amount, cm.BranchID, b.BranchCode, cm.ShiftMoveID, cm.ExpINID,
        le.ID AS LedgerEntryID, le.CreatedAt AS LedgerCreatedAt, le.CreatedByUserID
      FROM dbo.TblCashMove cm
      INNER JOIN dbo.TblExpCatEmpMap map ON map.ExpINID = cm.ExpINID AND map.TxnKind = N'advance' AND map.IsActive = 1
      INNER JOIN dbo.TblEmp e ON e.EmpID = map.EmpID
      INNER JOIN dbo.TblBranch b ON b.BranchID = cm.BranchID
      LEFT JOIN dbo.TblEmpLedgerEntry le ON le.CashMoveID = cm.ID AND le.EntryReason = N'advance' AND le.IsVoided = 0
      WHERE cm.invType = N'مصروفات' AND cm.inOut = N'out'
        AND cm.invDate >= '2026-08-01' AND cm.invDate <= '2026-08-31' AND cm.GrandTolal > 0
    )
    SELECT a1.EmpID, a1.EmpName, CONVERT(varchar(10), a1.invDate, 23) AS invDate, a1.Amount,
      a1.BranchCode AS BranchA, a2.BranchCode AS BranchB,
      a1.CashMoveID AS CashMoveA, a2.CashMoveID AS CashMoveB,
      a1.LedgerEntryID AS LedgerA, a2.LedgerEntryID AS LedgerB,
      a1.invTime AS InvTimeA, a2.invTime AS InvTimeB,
      a1.ShiftMoveID AS ShiftA, a2.ShiftMoveID AS ShiftB,
      a1.LedgerCreatedAt AS CreatedAtA, a2.LedgerCreatedAt AS CreatedAtB
    FROM advances a1
    JOIN advances a2 ON a1.EmpID = a2.EmpID AND a1.invDate = a2.invDate AND a1.Amount = a2.Amount
      AND a1.CashMoveID < a2.CashMoveID AND a1.BranchID <> a2.BranchID
    ORDER BY invDate, a1.EmpID
  `);
  out.push(`Pairs: ${augDupes.recordset.length}`);
  out.push(JSON.stringify(augDupes.recordset, null, 2));

  section('PHASE 8 — Historical cross-branch pairs (all time)', out);
  const hist = await db.request().query(`
    WITH advances AS (
      SELECT cm.ID AS CashMoveID, map.EmpID, e.EmpName, cm.invDate, cm.GrandTolal AS Amount, cm.BranchID, b.BranchCode
      FROM dbo.TblCashMove cm
      INNER JOIN dbo.TblExpCatEmpMap map ON map.ExpINID = cm.ExpINID AND map.TxnKind = N'advance' AND map.IsActive = 1
      INNER JOIN dbo.TblEmp e ON e.EmpID = map.EmpID
      INNER JOIN dbo.TblBranch b ON b.BranchID = cm.BranchID
      WHERE cm.invType = N'مصروفات' AND cm.inOut = N'out' AND cm.GrandTolal > 0
    ),
    pairs AS (
      SELECT a1.EmpID, a1.invDate, a1.Amount, a1.CashMoveID AS CashMoveA, a2.CashMoveID AS CashMoveB,
        a1.BranchCode AS BranchA, a2.BranchCode AS BranchB, a1.EmpName
      FROM advances a1
      JOIN advances a2 ON a1.EmpID = a2.EmpID AND a1.invDate = a2.invDate AND a1.Amount = a2.Amount
        AND a1.CashMoveID < a2.CashMoveID AND a1.BranchID <> a2.BranchID
    )
    SELECT
      (SELECT COUNT(*) FROM advances) AS totalAdvances,
      (SELECT COUNT(*) FROM pairs) AS suspiciousCrossBranchPairs,
      (SELECT COUNT(DISTINCT EmpID) FROM pairs) AS affectedEmployees,
      (SELECT CONVERT(varchar(10), MIN(invDate), 23) FROM pairs) AS earliestOccurrence,
      (SELECT CONVERT(varchar(10), MAX(invDate), 23) FROM pairs) AS latestOccurrence
  `);
  out.push(JSON.stringify(hist.recordset[0], null, 2));

  const allPairs = await db.request().query(`
    WITH advances AS (
      SELECT cm.ID AS CashMoveID, map.EmpID, e.EmpName, cm.invDate, cm.GrandTolal AS Amount, cm.BranchID, b.BranchCode
      FROM dbo.TblCashMove cm
      INNER JOIN dbo.TblExpCatEmpMap map ON map.ExpINID = cm.ExpINID AND map.TxnKind = N'advance' AND map.IsActive = 1
      INNER JOIN dbo.TblEmp e ON e.EmpID = map.EmpID
      INNER JOIN dbo.TblBranch b ON b.BranchID = cm.BranchID
      WHERE cm.invType = N'مصروفات' AND cm.inOut = N'out' AND cm.GrandTolal > 0
    )
    SELECT a1.EmpID, a1.EmpName, CONVERT(varchar(10), a1.invDate, 23) AS invDate, a1.Amount,
      a1.BranchCode AS BranchA, a2.BranchCode AS BranchB, a1.CashMoveID AS CashMoveA, a2.CashMoveID AS CashMoveB
    FROM advances a1
    JOIN advances a2 ON a1.EmpID = a2.EmpID AND a1.invDate = a2.invDate AND a1.Amount = a2.Amount
      AND a1.CashMoveID < a2.CashMoveID AND a1.BranchID <> a2.BranchID
    ORDER BY a1.invDate DESC, a1.EmpID
  `);
  out.push(`All historical pairs: ${allPairs.recordset.length}`);
  out.push(JSON.stringify(allPairs.recordset, null, 2));

  // Same-day same-amount same-branch duplicates
  section('PHASE 7b — Same-branch same-day duplicate advances', out);
  const sameBranch = await db.request().query(`
    WITH advances AS (
      SELECT cm.ID AS CashMoveID, map.EmpID, e.EmpName, cm.invDate, cm.GrandTolal AS Amount, cm.BranchID, b.BranchCode, cm.ShiftMoveID
      FROM dbo.TblCashMove cm
      INNER JOIN dbo.TblExpCatEmpMap map ON map.ExpINID = cm.ExpINID AND map.TxnKind = N'advance' AND map.IsActive = 1
      INNER JOIN dbo.TblEmp e ON e.EmpID = map.EmpID
      INNER JOIN dbo.TblBranch b ON b.BranchID = cm.BranchID
      WHERE cm.invType = N'مصروفات' AND cm.inOut = N'out' AND cm.GrandTolal > 0
        AND cm.invDate >= '2026-08-01' AND cm.invDate <= '2026-08-31'
    )
    SELECT a1.EmpID, a1.EmpName, CONVERT(varchar(10), a1.invDate, 23) AS invDate, a1.Amount, a1.BranchCode,
      a1.CashMoveID AS CashMoveA, a2.CashMoveID AS CashMoveB, a1.ShiftMoveID AS ShiftA, a2.ShiftMoveID AS ShiftB
    FROM advances a1
    JOIN advances a2 ON a1.EmpID = a2.EmpID AND a1.invDate = a2.invDate AND a1.Amount = a2.Amount
      AND a1.BranchID = a2.BranchID AND a1.CashMoveID < a2.CashMoveID
    ORDER BY invDate, a1.EmpID
  `);
  out.push(JSON.stringify(sameBranch.recordset, null, 2));

  const reportPath = path.join(__dirname, 'forensic-advance-39406-39399-output.json');
  fs.writeFileSync(reportPath, out.join('\n'), 'utf8');
  console.log(out.join('\n'));
  console.log('\nWritten to', reportPath);
  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
