#!/usr/bin/env node
/**
 * READ-ONLY: multi-branch readiness probes.
 * Usage: node scripts/audit-branches/03-branch-readiness-probes.mjs
 *
 * Probes only — does not alter schema or data.
 */
const { connectReadOnly } = require('./_db.cjs');

async function tableExists(pool, schema, name) {
  const r = await pool
    .request()
    .input('schema', schema)
    .input('name', name)
    .query(`
      SELECT 1 AS ok
      FROM sys.tables t
      INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE s.name = @schema AND t.name = @name
    `);
  return r.recordset.length > 0;
}

async function columnsNamed(pool) {
  const r = await pool.request().query(`
    SELECT s.name AS schema_name, t.name AS table_name, c.name AS column_name, ty.name AS type_name
    FROM sys.columns c
    INNER JOIN sys.tables t ON t.object_id = c.object_id
    INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
    INNER JOIN sys.types ty ON ty.user_type_id = c.user_type_id
    WHERE c.name IN ('BranchID', 'BranchId', 'branch_id', 'SalonID', 'SalonId')
    ORDER BY s.name, t.name, c.name;
  `);
  return r.recordset;
}

async function safeQuery(pool, label, text) {
  try {
    const r = await pool.request().query(text);
    return { label, ok: true, rows: r.recordset };
  } catch (err) {
    return { label, ok: false, error: err.message };
  }
}

async function main() {
  const { pool, target, database } = await connectReadOnly();
  const report = {
    generatedAt: new Date().toISOString(),
    target,
    database,
    branchLikeColumns: [],
    probes: [],
  };

  try {
    report.branchLikeColumns = await columnsNamed(pool);

    report.probes.push(
      await safeQuery(
        pool,
        'open_business_days',
        `SELECT ID, NewDay, Status FROM dbo.TblNewDay WHERE Status = 1 ORDER BY ID DESC`
      )
    );

    report.probes.push(
      await safeQuery(
        pool,
        'newday_duplicate_dates',
        `SELECT NewDay, COUNT(*) AS cnt FROM dbo.TblNewDay GROUP BY NewDay HAVING COUNT(*) > 1`
      )
    );

    report.probes.push(
      await safeQuery(
        pool,
        'open_shifts_count',
        `SELECT COUNT(*) AS open_shifts FROM dbo.TblShiftMove WHERE Status = 1`
      )
    );

    report.probes.push(
      await safeQuery(
        pool,
        'attendance_dup_emp_workdate',
        `SELECT EmpID, WorkDate, COUNT(*) AS cnt
         FROM dbo.TblEmpAttendance
         GROUP BY EmpID, WorkDate
         HAVING COUNT(*) > 1`
      )
    );

    report.probes.push(
      await safeQuery(
        pool,
        'daily_target_dup_emp_workdate',
        `SELECT EmpID, WorkDate, COUNT(*) AS cnt
         FROM dbo.TblEmpDailyTarget
         GROUP BY EmpID, WorkDate
         HAVING COUNT(*) > 1`
      )
    );

    report.probes.push(
      await safeQuery(
        pool,
        'budget_dup_year_month',
        `SELECT [Year], [Month], COUNT(*) AS cnt
         FROM dbo.TblBudgetMonth
         GROUP BY [Year], [Month]
         HAVING COUNT(*) > 1`
      )
    );

    report.probes.push(
      await safeQuery(
        pool,
        'queue_ticket_dup_code_date',
        `SELECT TicketCode, QueueDate, COUNT(*) AS cnt
         FROM dbo.QueueTickets
         GROUP BY TicketCode, QueueDate
         HAVING COUNT(*) > 1`
      )
    );

    if (await tableExists(pool, 'dbo', 'TblLoyaltyStoreItem')) {
      report.probes.push(
        await safeQuery(
          pool,
          'store_item_salonid_null_counts',
          `SELECT
             SUM(CASE WHEN SalonID IS NULL THEN 1 ELSE 0 END) AS null_salon,
             SUM(CASE WHEN SalonID IS NOT NULL THEN 1 ELSE 0 END) AS with_salon,
             COUNT(*) AS total
           FROM dbo.TblLoyaltyStoreItem`
        )
      );
    }

    report.probes.push(
      await safeQuery(
        pool,
        'unique_indexes_mentioning_newday_or_queue',
        `SELECT s.name AS schema_name, t.name AS table_name, i.name AS index_name, i.filter_definition
         FROM sys.indexes i
         INNER JOIN sys.tables t ON t.object_id = i.object_id
         INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
         WHERE i.is_unique = 1 AND (
           t.name IN ('TblNewDay', 'QueueTickets', 'Bookings', 'TblEmpAttendance', 'TblEmpDailyTarget', 'TblBudgetMonth')
         )
         ORDER BY t.name, i.name`
      )
    );

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
