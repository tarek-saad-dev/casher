/**
 * Phase 1D live financial schema/dependency audit (read-only).
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
    if (database !== 'last132') throw new Error(`Expected last132, got ${database}`);

    const checks = [];

    for (const table of [
      'TblinvServHead',
      'TblinvServDetail',
      'TblinvServPayment',
      'TblCashMove',
      'TblTreasuryCloseRecon',
    ]) {
      checks.push(
        await q(
          pool,
          `${table}_columns`,
          `
          SELECT c.name, ty.name AS type_name, c.is_nullable, c.is_identity
          FROM sys.columns c
          JOIN sys.types ty ON ty.user_type_id = c.user_type_id
          JOIN sys.tables t ON t.object_id = c.object_id
          WHERE t.name = N'${table}'
          ORDER BY c.column_id`,
        ),
      );
      checks.push(
        await q(
          pool,
          `${table}_pk_unique`,
          `
          SELECT i.name, i.is_primary_key, i.is_unique, i.has_filter,
                 STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY ic.key_ordinal) AS cols
          FROM sys.indexes i
          JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
          JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
          JOIN sys.tables t ON t.object_id=i.object_id
          WHERE t.name = N'${table}' AND (i.is_primary_key=1 OR i.is_unique=1)
          GROUP BY i.name, i.is_primary_key, i.is_unique, i.has_filter`,
        ),
      );
      checks.push(
        await q(
          pool,
          `${table}_fks`,
          `
          SELECT fk.name,
                 COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS child_col,
                 OBJECT_NAME(fk.referenced_object_id) AS parent_table,
                 COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS parent_col
          FROM sys.foreign_keys fk
          JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id=fk.object_id
          WHERE OBJECT_NAME(fk.parent_object_id)=N'${table}'
          ORDER BY fk.name`,
        ),
      );
    }

    checks.push(
      await q(
        pool,
        'triggers_on_invoice_cash',
        `
        SELECT t.name AS trigger_name, OBJECT_NAME(t.parent_id) AS table_name,
               t.is_disabled, te.type_desc
        FROM sys.triggers t
        JOIN sys.trigger_events te ON te.object_id = t.object_id
        WHERE OBJECT_NAME(t.parent_id) IN (
          N'TblinvServHead', N'TblinvServDetail', N'TblinvServPayment',
          N'TblCashMove', N'TblTreasuryCloseRecon'
        )
        ORDER BY table_name, trigger_name`,
      ),
    );

    checks.push(
      await q(
        pool,
        'insCashMoveSales_definition',
        `
        SELECT OBJECT_DEFINITION(OBJECT_ID(N'dbo.InsCashMoveSales')) AS definition`,
      ),
    );

    checks.push(
      await q(
        pool,
        'all_triggers_mentioning_cash_or_invoice',
        `
        SELECT o.name, OBJECT_NAME(t.parent_id) AS parent_table
        FROM sys.sql_modules m
        JOIN sys.triggers t ON t.object_id = m.object_id
        JOIN sys.objects o ON o.object_id = m.object_id
        WHERE m.definition LIKE N'%TblCashMove%'
           OR m.definition LIKE N'%TblinvServHead%'
           OR m.definition LIKE N'%InsCashMoveSales%'
        ORDER BY o.name`,
      ),
    );

    checks.push(
      await q(
        pool,
        'ct_financial_tables',
        `
        SELECT OBJECT_NAME(object_id) AS table_name, is_track_columns_updated_on
        FROM sys.change_tracking_tables
        WHERE OBJECT_NAME(object_id) IN (
          N'TblinvServHead', N'TblCashMove', N'TblTreasuryCloseRecon',
          N'TblinvServDetail', N'TblinvServPayment', N'TblNewDay', N'TblShiftMove'
        )
        ORDER BY table_name`,
      ),
    );

    checks.push(
      await q(
        pool,
        'sync_table_registry',
        `
        IF OBJECT_ID(N'sync.TableRegistry', N'U') IS NULL
          SELECT N'missing' AS status;
        ELSE
          SELECT TableName, IsEnabled, *
          FROM sync.TableRegistry
          WHERE TableName IN (
            N'TblinvServHead', N'TblCashMove', N'TblTreasuryCloseRecon',
            N'TblinvServDetail', N'TblinvServPayment', N'TblNewDay', N'TblShiftMove'
          )
          OR TableName LIKE N'%invServ%'
          OR TableName LIKE N'%CashMove%'
          OR TableName LIKE N'%Treasury%'`,
      ),
    );

    checks.push(
      await q(
        pool,
        'branchid_presence',
        `
        SELECT t.name AS table_name, c.name AS column_name, c.is_nullable
        FROM sys.columns c
        JOIN sys.tables t ON t.object_id = c.object_id
        WHERE c.name IN (N'BranchID', N'BusinessDayID')
        ORDER BY t.name, c.name`,
      ),
    );

    checks.push(
      await q(
        pool,
        'gleem',
        `SELECT BranchID, BranchCode FROM dbo.TblBranch WHERE BranchCode = N'GLEEM'`,
      ),
    );

    checks.push(
      await q(
        pool,
        'invoice_shift_join_stats',
        `
        SELECT
          COUNT(*) AS invoice_total,
          SUM(CASE WHEN ShiftMoveID IS NULL THEN 1 ELSE 0 END) AS invoice_null_shift,
          SUM(CASE WHEN ShiftMoveID IS NOT NULL AND sm.ID IS NULL THEN 1 ELSE 0 END) AS invoice_orphan_shift,
          SUM(CASE WHEN sm.ID IS NOT NULL AND h.invDate <> sm.NewDay THEN 1 ELSE 0 END) AS invoice_date_ne_shift_day
        FROM dbo.TblinvServHead h
        LEFT JOIN dbo.TblShiftMove sm ON sm.ID = h.ShiftMoveID`,
      ),
    );

    checks.push(
      await q(
        pool,
        'cash_shift_join_stats',
        `
        SELECT
          COUNT(*) AS cash_total,
          SUM(CASE WHEN ShiftMoveID IS NULL THEN 1 ELSE 0 END) AS cash_null_shift,
          SUM(CASE WHEN ShiftMoveID IS NOT NULL AND sm.ID IS NULL THEN 1 ELSE 0 END) AS cash_orphan_shift
        FROM dbo.TblCashMove cm
        LEFT JOIN dbo.TblShiftMove sm ON sm.ID = cm.ShiftMoveID`,
      ),
    );

    checks.push(
      await q(
        pool,
        'cash_invtypes',
        `
        SELECT invType, inOut, COUNT(*) AS cnt, SUM(GrandTolal) AS total
        FROM dbo.TblCashMove
        GROUP BY invType, inOut
        ORDER BY cnt DESC`,
      ),
    );

    checks.push(
      await q(
        pool,
        'invoice_types',
        `
        SELECT invType, COUNT(*) AS cnt, SUM(GrandTotal) AS total
        FROM dbo.TblinvServHead
        GROUP BY invType
        ORDER BY cnt DESC`,
      ),
    );

    checks.push(
      await q(
        pool,
        'sale_cash_match_sample',
        `
        SELECT TOP 5
          h.ID AS HeadSurrogate, h.invID, h.invType, h.invDate, h.ShiftMoveID AS invShift,
          cm.ID AS CashID, cm.invID AS cashInvID, cm.invType AS cashInvType, cm.ShiftMoveID AS cashShift
        FROM dbo.TblinvServHead h
        INNER JOIN dbo.TblCashMove cm
          ON cm.invID = h.invID AND cm.invType = h.invType
        WHERE h.invType = N'مبيعات'
        ORDER BY h.ID DESC`,
      ),
    );

    checks.push(
      await q(
        pool,
        'modules_financial',
        `
        SELECT o.type_desc, SCHEMA_NAME(o.schema_id)+N'.'+o.name AS object_name
        FROM sys.sql_modules m
        JOIN sys.objects o ON o.object_id = m.object_id
        WHERE m.definition LIKE N'%TblinvServHead%'
           OR m.definition LIKE N'%TblCashMove%'
           OR m.definition LIKE N'%TblTreasuryCloseRecon%'
        ORDER BY o.type_desc, object_name`,
      ),
    );

    const out = { generatedAt: new Date().toISOString(), target, database, checks };
    const outPath = path.join(__dirname, '_phase1d-live-schema-audit.json');
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    console.log(JSON.stringify({ outPath: path.relative(process.cwd(), outPath), checkCount: checks.length }, null, 2));
    for (const c of checks) {
      if (c.error) console.log(c.label, 'ERROR', c.error);
      else {
        const preview = (c.rows || []).slice(0, 3);
        console.log(c.label, 'rows', (c.rows || []).length, JSON.stringify(preview).slice(0, 400));
      }
    }
  } finally {
    await pool.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
