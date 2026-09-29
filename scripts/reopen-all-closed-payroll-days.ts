#!/usr/bin/env npx tsx
/**
 * Reopen all CLOSED employee payroll days so they are editable.
 * Does not delete history — sets State=REOPENED with an audit reason.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const origLoad = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

async function main() {
  const { getPool, sql } = await import('../src/lib/db');
  const db = await getPool();

  const before = await db.request().query(`
    SELECT State, COUNT(*) AS Cnt
    FROM dbo.TblEmpBranchWorkDayClose
    GROUP BY State
    ORDER BY State
  `);
  console.log('BEFORE', before.recordset);

  const reason =
    'فتح جماعي مؤقت — إقفال يوم الموظفين معطّل؛ الأيام قابلة للتعديل';

  const upd = await db
    .request()
    .input('reason', sql.NVarChar(500), reason)
    .input('actor', sql.Int, 13)
    .query(`
      UPDATE dbo.TblEmpBranchWorkDayClose
      SET
        State = N'REOPENED',
        ReopenedAt = SYSUTCDATETIME(),
        ReopenedByUserID = @actor,
        ReopenReason = @reason,
        UpdatedByUserID = @actor,
        UpdatedAt = SYSUTCDATETIME()
      WHERE State = N'CLOSED';
      SELECT @@ROWCOUNT AS ReopenedCount;
    `);

  console.log('REOPENED', upd.recordset);

  const after = await db.request().query(`
    SELECT State, COUNT(*) AS Cnt
    FROM dbo.TblEmpBranchWorkDayClose
    GROUP BY State
    ORDER BY State
  `);
  console.log('AFTER', after.recordset);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
