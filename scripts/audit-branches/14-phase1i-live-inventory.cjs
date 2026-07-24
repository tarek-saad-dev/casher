/**
 * Phase 1I live inventory — tables, BranchID presence, CT, key counts.
 * Read-only. cloud/last132.
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { connectReadOnly } = require('./_db.cjs');

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

async function main() {
  const { pool, database, target } = await connectReadOnly();
  try {
    if (database !== 'last132') throw new Error(`Expected last132, got ${database}`);

    const tables = await pool.request().query(`
      SELECT t.name AS table_name
      FROM sys.tables t
      INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE s.name = N'dbo'
      ORDER BY t.name
    `);

    const branchCols = await pool.request().query(`
      SELECT t.name AS table_name, c.name AS column_name, c.is_nullable
      FROM sys.columns c
      INNER JOIN sys.tables t ON t.object_id = c.object_id
      INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE s.name = N'dbo' AND c.name = N'BranchID'
      ORDER BY t.name
    `);

    const branches = await pool.request().query(`
      SELECT BranchID, BranchCode, BranchName, IsActive
      FROM dbo.TblBranch
      ORDER BY BranchID
    `);

    const interest = [
      'TblPro', 'TblBarCode', 'TblinvPurchaseHead', 'TblinvPurchaseDetail', 'TblProMove',
      'TblEmpAttendance', 'TblEmpPayroll', 'TblEmpLedgerEntry', 'TblEmpTarget', 'TblBudget',
      'TblClient', 'TblClientLoyalty', 'TblLoyaltyPointLedger',
      'TblPrinter', 'TblPrintSetting', 'TblSettings', 'TblSettingValues',
      'TblOffers', 'TblOffer', 'TblCalendarSync', 'TblCalendarOutboundSync',
      'Bookings', 'QueueTickets', 'QueueBookingSettings',
      'TblinvServHead', 'TblCashMove', 'TblNewDay', 'TblShiftMove',
    ];

    const present = {};
    for (const name of interest) {
      const exists = tables.recordset.some((t) => t.table_name === name);
      present[name] = exists;
      if (!exists) continue;
      try {
        const cnt = await pool.request().query(`SELECT COUNT(*) AS c FROM dbo.[${name}]`);
        present[name] = { exists: true, rows: cnt.recordset[0].c };
      } catch {
        present[name] = { exists: true, rows: null };
      }
    }

    // Product qty columns
    const proCols = await pool.request().query(`
      SELECT c.name
      FROM sys.columns c
      WHERE c.object_id = OBJECT_ID(N'dbo.TblPro')
      ORDER BY c.column_id
    `).catch(() => ({ recordset: [] }));

    const purchaseCols = await pool.request().query(`
      SELECT c.name
      FROM sys.columns c
      WHERE c.object_id = OBJECT_ID(N'dbo.TblinvPurchaseHead')
      ORDER BY c.column_id
    `).catch(() => ({ recordset: [] }));

    const attCols = await pool.request().query(`
      SELECT c.name
      FROM sys.columns c
      WHERE c.object_id = OBJECT_ID(N'dbo.TblEmpAttendance')
      ORDER BY c.column_id
    `).catch(() => ({ recordset: [] }));

    const ct = await pool.request().query(`
      SELECT OBJECT_NAME(object_id) AS table_name
      FROM sys.change_tracking_tables
      ORDER BY 1
    `).catch(() => ({ recordset: [] }));

    const sync = await pool.request().query(`
      SELECT TableName, IsEnabled
      FROM sync.TableRegistry
      WHERE IsEnabled = 1
    `).catch(() => ({ recordset: [] }));

    const payload = {
      capturedAt: new Date().toISOString(),
      target,
      database,
      branches: branches.recordset,
      tablesWithBranchID: branchCols.recordset,
      tableCount: tables.recordset.length,
      interest: present,
      TblProColumns: proCols.recordset.map((r) => r.name),
      TblinvPurchaseHeadColumns: purchaseCols.recordset.map((r) => r.name),
      TblEmpAttendanceColumns: attCols.recordset.map((r) => r.name),
      changeTracking: ct.recordset,
      syncEnabled: sync.recordset,
    };

    const out = path.join(__dirname, '_phase1i-live-inventory.json');
    fs.writeFileSync(out, JSON.stringify(payload, null, 2), 'utf8');
    console.log(
      JSON.stringify(
        {
          out: path.relative(process.cwd(), out),
          branches: payload.branches,
          branchIdTables: payload.tablesWithBranchID.map((t) => t.table_name),
          interestSummary: Object.fromEntries(
            Object.entries(present).map(([k, v]) => [
              k,
              typeof v === 'object' ? v : { exists: v },
            ]),
          ),
          proHasQty: proCols.recordset.some((c) =>
            /qty|stock|balance|quantity/i.test(c.name),
          ),
          purchaseHasBranch: purchaseCols.recordset.some((c) => c.name === 'BranchID'),
          attendanceHasBranch: attCols.recordset.some((c) => c.name === 'BranchID'),
          syncEnabledCount: sync.recordset.length,
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
