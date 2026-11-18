#!/usr/bin/env node
/**
 * CUT CLUB staging-only metadata discovery. Read-only; never dumps user rows.
 * Outputs column/identity/default information needed for synthetic fixtures.
 */
"use strict";
const sql = require("mssql");
const e = process.env;
if (e.LOCAL_DB_NAME !== "last132_agent" || e.LOCAL_DB_USER !== "drvo_agent" ||
    e.CUT_CLUB_STAGING_CLAIM_WRITE_ENABLED === "true") {
  console.error("STAGING_FIXTURE_METADATA_STOP: unsafe connection or feature flag");
  process.exit(2);
}
(async () => {
  const pool = await new sql.ConnectionPool({
    server: e.LOCAL_DB_SERVER || "127.0.0.1",
    port: Number(e.LOCAL_DB_PORT || "14330"),
    database: "last132_agent", user: "drvo_agent",
    password: e.LOCAL_DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
    pool: { min: 0, max: 1 }, connectionTimeout: 12000, requestTimeout: 20000,
  }).connect();
  try {
    const result = await pool.request().query(`
      SET NOCOUNT ON;
      IF DB_NAME() <> N'last132_agent' OR SUSER_SNAME() <> N'drvo_agent'
        THROW 52180, 'CUT CLUB: wrong staging SQL identity', 1;
      SELECT t.name AS TableName, c.column_id AS Position, c.name AS ColumnName,
        TYPE_NAME(c.user_type_id) AS SqlType, c.max_length AS MaxLength,
        c.is_nullable AS Nullable, c.is_identity AS IsIdentity,
        dc.definition AS DefaultSql
      FROM sys.tables t
      JOIN sys.columns c ON c.object_id=t.object_id
      LEFT JOIN sys.default_constraints dc ON dc.parent_object_id=c.object_id
       AND dc.parent_column_id=c.column_id
      WHERE t.schema_id=SCHEMA_ID(N'dbo') AND t.name IN (
        N'TblPro',N'TblClient',N'TblClientInventory',
        N'TblLoyaltyStoreItem',N'TblInventoryUsageLog'
      )
      ORDER BY t.name,c.column_id;
      SELECT pt.name AS ParentTable, pc.name AS ParentColumn,
        rt.name AS ReferencesTable, rc.name AS ReferencesColumn
      FROM sys.foreign_key_columns k
      JOIN sys.tables pt ON pt.object_id=k.parent_object_id
      JOIN sys.columns pc ON pc.object_id=k.parent_object_id AND pc.column_id=k.parent_column_id
      JOIN sys.tables rt ON rt.object_id=k.referenced_object_id
      JOIN sys.columns rc ON rc.object_id=k.referenced_object_id AND rc.column_id=k.referenced_column_id
      WHERE pt.name IN (N'TblPro',N'TblClient',N'TblClientInventory',
                        N'TblLoyaltyStoreItem',N'TblInventoryUsageLog')
      ORDER BY pt.name,pc.name;
    `);
    console.log("=== CUT CLUB STAGING SYNTHETIC-FIXTURE SCHEMA (metadata ONLY) ===");
    for (const row of result.recordsets[0]) {
      console.log(JSON.stringify(row));
    }
    console.log("=== FK RELATIONSHIPS ===");
    for (const row of result.recordsets[1]) console.log(JSON.stringify(row));
    console.log("STAGING_FIXTURE_DISCOVERY: complete (NO customer data queried)");
  } finally { await pool.close(); }
})().catch(err => {
  console.error("STAGING_FIXTURE_DISCOVERY_FAILED:",err.code || "CONNECTION_OR_SCHEMA_ERROR");
  process.exitCode = 1;
});
