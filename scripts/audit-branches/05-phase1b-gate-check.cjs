/**
 * Phase 1B gate: secrets configured (presence only) + open shifts must be 0.
 * Never prints secret values.
 */
const path = require("path");
const dotenv = require("dotenv");
const { connectReadOnly } = require("./_db.cjs");

dotenv.config({ path: path.join(process.cwd(), ".env") });
dotenv.config({ path: path.join(process.cwd(), ".env.local"), override: false });

async function main() {
  const cronSecretConfigured = Boolean(process.env.CRON_SECRET);
  const sessionSecretConfigured = Boolean(process.env.SESSION_SECRET);

  const { pool, target, database } = await connectReadOnly();
  try {
    const openShifts = await pool.request().query(`
      SELECT COUNT(*) AS OpenShiftCount
      FROM dbo.TblShiftMove
      WHERE ISNULL(Status, 0) = 1
    `);
    const openShiftDetails = await pool.request().query(`
      SELECT
        sm.ID,
        sm.UserID,
        u.UserName,
        sm.StartDate,
        sm.StartTime,
        sm.NewDay
      FROM dbo.TblShiftMove sm
      LEFT JOIN dbo.TblUser u ON u.UserID = sm.UserID
      WHERE ISNULL(sm.Status, 0) = 1
      ORDER BY sm.ID
    `);
    const openDays = await pool.request().query(`
      SELECT ID, NewDay, Status
      FROM dbo.TblNewDay
      WHERE Status = 1
      ORDER BY ID DESC
    `);
    const foundation = await pool.request().query(`
      SELECT t.name
      FROM sys.tables t
      INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE s.name = N'dbo'
        AND t.name IN (N'TblBranch', N'TblUserBranchAccess', N'TblEmpBranchAssignment')
      ORDER BY t.name
    `);
    const opsBranchCols = await pool.request().query(`
      SELECT s.name AS SchemaName, t.name AS TableName, c.name AS ColumnName
      FROM sys.columns c
      INNER JOIN sys.tables t ON t.object_id = c.object_id
      INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE c.name = N'BranchID'
        AND t.name NOT IN (N'TblBranch', N'TblUserBranchAccess', N'TblEmpBranchAssignment')
      ORDER BY s.name, t.name
    `);

    const payload = {
      generatedAt: new Date().toISOString(),
      target,
      database,
      cronSecretConfigured,
      sessionSecretConfigured,
      openShiftCount: Number(openShifts.recordset[0].OpenShiftCount),
      openShiftDetails: openShiftDetails.recordset,
      openNewDays: openDays.recordset,
      existingFoundationTables: foundation.recordset.map((r) => r.name),
      unexpectedOperationalBranchColumns: opsBranchCols.recordset,
    };

    const blockers = [];
    if (target !== "cloud") blockers.push(`Expected database mode cloud, got ${target}`);
    if (database !== "last132") blockers.push(`Expected database last132, got ${database}`);
    if (!cronSecretConfigured) blockers.push("CRON_SECRET is not configured");
    if (!sessionSecretConfigured) blockers.push("SESSION_SECRET is not configured");
    if (payload.openShiftCount !== 0) {
      blockers.push(`Open shifts must be 0; found ${payload.openShiftCount}`);
    }
    if (payload.unexpectedOperationalBranchColumns.length > 0) {
      blockers.push("Unexpected operational BranchID columns present");
    }

    payload.blockers = blockers;
    payload.gatePassed = blockers.length === 0;
    console.log(JSON.stringify(payload, null, 2));
    if (!payload.gatePassed) process.exitCode = 2;
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
