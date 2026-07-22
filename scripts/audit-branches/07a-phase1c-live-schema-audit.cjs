/**
 * Phase 1C live dependency/schema audit for TblNewDay / TblShiftMove.
 * Read-only. Never prints secrets.
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { connectReadOnly } = require('./_db.cjs');

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

async function q(pool, label, sqlText) {
  try {
    const r = await pool.request().query(sqlText);
    return { label, rows: r.recordset };
  } catch (err) {
    return { label, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  const { pool, target, database } = await connectReadOnly();
  try {
    if (database !== 'last132') {
      throw new Error(`Expected last132, got ${database}`);
    }

    const checks = [];

    checks.push(
      await q(
        pool,
        'newday_columns',
        `
      SELECT c.column_id, c.name, ty.name AS type_name, c.max_length, c.is_nullable, c.is_identity
      FROM sys.columns c
      JOIN sys.types ty ON ty.user_type_id = c.user_type_id
      JOIN sys.tables t ON t.object_id = c.object_id
      JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE s.name = N'dbo' AND t.name = N'TblNewDay'
      ORDER BY c.column_id`,
      ),
    );

    checks.push(
      await q(
        pool,
        'shiftmove_columns',
        `
      SELECT c.column_id, c.name, ty.name AS type_name, c.max_length, c.is_nullable, c.is_identity
      FROM sys.columns c
      JOIN sys.types ty ON ty.user_type_id = c.user_type_id
      JOIN sys.tables t ON t.object_id = c.object_id
      JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE s.name = N'dbo' AND t.name = N'TblShiftMove'
      ORDER BY c.column_id`,
      ),
    );

    checks.push(
      await q(
        pool,
        'newday_indexes',
        `
      SELECT i.name, i.is_primary_key, i.is_unique, i.has_filter, i.filter_definition,
             STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY ic.key_ordinal) AS cols
      FROM sys.indexes i
      JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      JOIN sys.tables t ON t.object_id = i.object_id
      WHERE t.name = N'TblNewDay' AND i.type > 0
      GROUP BY i.name, i.is_primary_key, i.is_unique, i.has_filter, i.filter_definition
      ORDER BY i.is_primary_key DESC, i.is_unique DESC, i.name`,
      ),
    );

    checks.push(
      await q(
        pool,
        'shiftmove_indexes',
        `
      SELECT i.name, i.is_primary_key, i.is_unique, i.has_filter, i.filter_definition,
             STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY ic.key_ordinal) AS cols
      FROM sys.indexes i
      JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      JOIN sys.tables t ON t.object_id = i.object_id
      WHERE t.name = N'TblShiftMove' AND i.type > 0
      GROUP BY i.name, i.is_primary_key, i.is_unique, i.has_filter, i.filter_definition
      ORDER BY i.is_primary_key DESC, i.is_unique DESC, i.name`,
      ),
    );

    checks.push(
      await q(
        pool,
        'fks_referencing_newday',
        `
      SELECT fk.name AS fk_name,
             OBJECT_SCHEMA_NAME(fk.parent_object_id) + N'.' + OBJECT_NAME(fk.parent_object_id) AS child_table,
             COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS child_col,
             COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS parent_col,
             fk.delete_referential_action_desc,
             fk.update_referential_action_desc
      FROM sys.foreign_keys fk
      JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
      WHERE OBJECT_NAME(fk.referenced_object_id) = N'TblNewDay'
      ORDER BY child_table, child_col`,
      ),
    );

    checks.push(
      await q(
        pool,
        'fks_from_newday',
        `
      SELECT fk.name AS fk_name,
             OBJECT_NAME(fk.parent_object_id) AS child_table,
             COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS child_col,
             OBJECT_NAME(fk.referenced_object_id) AS parent_table,
             COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS parent_col
      FROM sys.foreign_keys fk
      JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
      WHERE OBJECT_NAME(fk.parent_object_id) = N'TblNewDay'`,
      ),
    );

    checks.push(
      await q(
        pool,
        'fks_referencing_shiftmove',
        `
      SELECT fk.name AS fk_name,
             OBJECT_SCHEMA_NAME(fk.parent_object_id) + N'.' + OBJECT_NAME(fk.parent_object_id) AS child_table,
             COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS child_col,
             COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS parent_col
      FROM sys.foreign_keys fk
      JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
      WHERE OBJECT_NAME(fk.referenced_object_id) = N'TblShiftMove'
      ORDER BY child_table`,
      ),
    );

    checks.push(
      await q(
        pool,
        'columns_newday_businessdayid_branchid',
        `
      SELECT s.name AS schema_name, t.name AS table_name, c.name AS column_name, ty.name AS type_name, c.is_nullable
      FROM sys.columns c
      JOIN sys.tables t ON t.object_id = c.object_id
      JOIN sys.schemas s ON s.schema_id = t.schema_id
      JOIN sys.types ty ON ty.user_type_id = c.user_type_id
      WHERE c.name IN (N'NewDay', N'BusinessDayID', N'BranchID')
      ORDER BY t.name, c.name`,
      ),
    );

    checks.push(
      await q(
        pool,
        'modules_referencing_day_shift',
        `
      SELECT o.type_desc, SCHEMA_NAME(o.schema_id) + N'.' + o.name AS object_name
      FROM sys.sql_modules m
      JOIN sys.objects o ON o.object_id = m.object_id
      WHERE m.definition LIKE N'%TblNewDay%' OR m.definition LIKE N'%TblShiftMove%'
      ORDER BY o.type_desc, object_name`,
      ),
    );

    checks.push(
      await q(
        pool,
        'newday_id_integrity',
        `
      SELECT
        COUNT(*) AS total_rows,
        SUM(CASE WHEN ID IS NULL THEN 1 ELSE 0 END) AS null_ids,
        COUNT(DISTINCT ID) AS distinct_ids,
        SUM(CASE WHEN Status = 1 THEN 1 ELSE 0 END) AS open_count,
        SUM(CASE WHEN NewDay IS NULL THEN 1 ELSE 0 END) AS null_dates
      FROM dbo.TblNewDay`,
      ),
    );

    checks.push(
      await q(
        pool,
        'newday_duplicate_dates',
        `
      SELECT NewDay, COUNT(*) AS cnt
      FROM dbo.TblNewDay
      GROUP BY NewDay
      HAVING COUNT(*) > 1`,
      ),
    );

    checks.push(
      await q(
        pool,
        'shift_orphan_dates',
        `
      SELECT COUNT(*) AS shift_dates_missing_day
      FROM dbo.TblShiftMove sm
      WHERE NOT EXISTS (
        SELECT 1 FROM dbo.TblNewDay d WHERE d.NewDay = sm.NewDay
      )`,
      ),
    );

    checks.push(
      await q(
        pool,
        'users_multiple_open_shifts',
        `
      SELECT UserID, COUNT(*) AS open_count
      FROM dbo.TblShiftMove
      WHERE ISNULL(Status, 0) = 1
      GROUP BY UserID
      HAVING COUNT(*) > 1`,
      ),
    );

    checks.push(
      await q(
        pool,
        'treasury_recon_columns',
        `
      SELECT c.name, ty.name AS type_name, c.is_nullable
      FROM sys.columns c
      JOIN sys.types ty ON ty.user_type_id = c.user_type_id
      JOIN sys.tables t ON t.object_id = c.object_id
      WHERE t.name = N'TblTreasuryCloseRecon'
      ORDER BY c.column_id`,
      ),
    );

    checks.push(
      await q(
        pool,
        'treasury_recon_fks',
        `
      SELECT fk.name, COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS child_col,
             OBJECT_NAME(fk.referenced_object_id) AS parent_table,
             COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS parent_col
      FROM sys.foreign_keys fk
      JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
      WHERE OBJECT_NAME(fk.parent_object_id) = N'TblTreasuryCloseRecon'`,
      ),
    );

    checks.push(
      await q(
        pool,
        'treasury_recon_newday_join_shape',
        `
      SELECT
        COUNT(*) AS recon_rows,
        SUM(CASE WHEN EXISTS (SELECT 1 FROM dbo.TblNewDay d WHERE d.ID = r.NewDay) THEN 1 ELSE 0 END) AS match_as_id,
        SUM(CASE WHEN EXISTS (SELECT 1 FROM dbo.TblNewDay d WHERE d.NewDay = TRY_CONVERT(date, r.NewDay)) THEN 1 ELSE 0 END) AS match_as_date
      FROM dbo.TblTreasuryCloseRecon r`,
      ),
    );

    checks.push(
      await q(
        pool,
        'gleem_branch',
        `SELECT BranchID, BranchCode, BranchName FROM dbo.TblBranch WHERE BranchCode = N'GLEEM'`,
      ),
    );

    const out = {
      generatedAt: new Date().toISOString(),
      target,
      database,
      checks,
    };

    const outPath = path.join(__dirname, '_phase1c-live-schema-audit.json');
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    console.log(JSON.stringify({ outPath: path.relative(process.cwd(), outPath), target, database, checkCount: checks.length }, null, 2));
    for (const c of checks) {
      if (c.error) console.log(c.label, 'ERROR', c.error);
      else console.log(c.label, 'rows', (c.rows || []).length, JSON.stringify((c.rows || []).slice(0, 5)));
    }
  } finally {
    await pool.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
