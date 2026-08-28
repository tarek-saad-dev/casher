/**
 * Probe Ziad Gleem Aug 2026: ledger reasons vs cash-move advances vs partners سلف.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

async function q(
  db: { request: () => { query: (s: string) => Promise<{ recordset: unknown[] }> } },
  title: string,
  sqlText: string,
) {
  try {
    const r = await db.request().query(sqlText);
    console.log(`\n=== ${title} ===`);
    console.table(r.recordset);
    return r.recordset;
  } catch (e) {
    console.error(`\n=== ${title} FAILED ===`, e instanceof Error ? e.message : e);
    return [];
  }
}

async function main() {
  const { getPool } = await import('@/lib/db');
  const db = await getPool();

  await q(
    db,
    'LEDGER BY BRANCH+REASON Emp 12 Aug 2026',
    `
    SELECT
      ISNULL(b.BranchCode, N'?') AS BranchCode,
      l.EntryDirection,
      l.EntryReason,
      COUNT(*) AS cnt,
      SUM(l.Amount) AS amount
    FROM dbo.TblEmpLedgerEntry l
    LEFT JOIN dbo.TblBranch b ON b.BranchID = l.BranchID
    WHERE l.EmpID = 12 AND l.IsVoided = 0
      AND l.PayrollMonth = N'2026-08'
    GROUP BY b.BranchCode, l.EntryDirection, l.EntryReason
    ORDER BY b.BranchCode, l.EntryDirection, l.EntryReason
  `,
  );

  await q(
    db,
    'GLEEM LEDGER LINES Emp 12 Aug (debits)',
    `
    SELECT TOP 80
      l.ID,
      CONVERT(varchar(10), l.EntryDate, 23) AS EntryDate,
      l.EntryDirection,
      l.EntryReason,
      l.Amount,
      l.RefType,
      l.RefID,
      l.Notes
    FROM dbo.TblEmpLedgerEntry l
    WHERE l.EmpID = 12 AND l.IsVoided = 0
      AND l.PayrollMonth = N'2026-08'
      AND l.BranchID = 1
      AND l.EntryDirection = N'debit'
    ORDER BY l.EntryDate, l.ID
  `,
  );

  await q(
    db,
    'CASH MOVE ADVANCE MAP Emp 12 Gleem Aug',
    `
    SELECT
      cm.ID, CONVERT(varchar(10), cm.invDate, 23) AS invDate,
      cm.GrandTolal AS amount, cat.CatName, cm.Notes, cm.inOut, cm.invType
    FROM dbo.TblExpCatEmpMap em
    INNER JOIN dbo.TblCashMove cm ON em.ExpINID = cm.ExpINID
    INNER JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID
    WHERE em.EmpID = 12 AND em.IsActive = 1 AND em.TxnKind = N'advance'
      AND YEAR(cm.invDate) = 2026 AND MONTH(cm.invDate) = 8
      AND cm.BranchID = 1
    ORDER BY cm.invDate, cm.ID
  `,
  );

  await q(
    db,
    'CASH MOVE ALL MAP KINDS Emp 12 Gleem Aug',
    `
    SELECT
      em.TxnKind, cat.CatName,
      COUNT(*) AS cnt, SUM(cm.GrandTolal) AS amount
    FROM dbo.TblExpCatEmpMap em
    INNER JOIN dbo.TblCashMove cm ON em.ExpINID = cm.ExpINID
    INNER JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID
    WHERE em.EmpID = 12 AND em.IsActive = 1
      AND YEAR(cm.invDate) = 2026 AND MONTH(cm.invDate) = 8
      AND cm.BranchID = 1
    GROUP BY em.TxnKind, cat.CatName
    ORDER BY em.TxnKind, amount DESC
  `,
  );

  await q(
    db,
    'CASH MOVE LIKE زياد Gleem Aug',
    `
    SELECT
      cm.ID, CONVERT(varchar(10), cm.invDate, 23) AS invDate,
      cm.GrandTolal AS amount, cat.CatName, cm.inOut, cm.invType,
      LEFT(ISNULL(cm.Notes, N''), 80) AS Notes
    FROM dbo.TblCashMove cm
    LEFT JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID
    WHERE YEAR(cm.invDate) = 2026 AND MONTH(cm.invDate) = 8
      AND cm.BranchID = 1
      AND (
        cat.CatName LIKE N'%زياد%' OR cat.CatName LIKE N'%ذياد%'
        OR cm.Notes LIKE N'%زياد%' OR cm.Notes LIKE N'%ذياد%'
      )
    ORDER BY cm.invDate, cm.ID
  `,
  );

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
