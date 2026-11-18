#!/usr/bin/env node
/**
 * CUT CLUB staging-only, guarded additive schema install.
 * Does NOT write customer, voucher, invoice or Coins data.
 * Intended for isolated GitHub Action on the staging SQL tunnel.
 * Refuses any DB/login other than last132_agent/drvo_agent.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const sql = require("mssql");
const e = process.env;
const EXPECTED_DB = "last132_agent", EXPECTED_LOGIN = "drvo_agent";
if (e.CUT_CLUB_STAGING_SCHEMA_INSTALL !== "true" ||
    e.LOCAL_DB_NAME !== EXPECTED_DB || e.LOCAL_DB_USER !== EXPECTED_LOGIN ||
    e.CUT_CLUB_STAGING_CLAIM_WRITE_ENABLED === "true") {
  console.error("CUT_CLUB_STAGE_SCHEMA_STOP: disabled or unsafe environment");
  process.exit(2);
}
const config = {
  server: e.LOCAL_DB_SERVER || "127.0.0.1",
  port: Number(e.LOCAL_DB_PORT || "14330"),
  database: EXPECTED_DB,
  user: EXPECTED_LOGIN,
  password: e.LOCAL_DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
  pool: { min: 0, max: 1 },
  connectionTimeout: 12000,
  requestTimeout: 30000,
};
const ddl = fs.readFileSync(path.resolve(__dirname, "../../docs/cut-club/sql/cashier-invoice-claim-staging-only.sql"), "utf8");
(async () => {
  if (!config.password) throw Error("STAGING_SQL_CREDENTIAL_MISSING");
  const pool = await new sql.ConnectionPool(config).connect();
  try {
    const ctx = await pool.request().query(`
      SET NOCOUNT ON;
      SELECT DB_NAME() AS DbName, SUSER_SNAME() AS LoginName,
        CASE WHEN OBJECT_ID(N'dbo.CutClubVoucherInvoiceClaim',N'U') IS NULL THEN 0 ELSE 1 END AS HasTable,
        HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CREATE TABLE') AS CanCreateTable;
    `);
    if (ctx.recordset.length !== 1 || ctx.recordset[0].DbName !== EXPECTED_DB ||
        ctx.recordset[0].LoginName !== EXPECTED_LOGIN)
      throw Error("STAGING_IDENTITY_MISMATCH");
    if (Number(ctx.recordset[0].HasTable) === 0) {
      if (Number(ctx.recordset[0].CanCreateTable) !== 1)
        throw Error("STAGING_DDL_PERMISSION_NOT_GRANTED");
      if (!ddl.includes("DB_NAME() <> N'last132_agent'") ||
          !ddl.includes("SUSER_SNAME() <> N'drvo_agent'"))
        throw Error("STAGING_DDL_GUARDS_MISSING");
      await pool.request().query(ddl);
      console.log("STAGING_SCHEMA_INSTALL: APPLIED (claim table and indexes, no fixture data)");
    } else {
      console.log("STAGING_SCHEMA_INSTALL: table already exists; no re-run of DDL");
    }
    const verify = await pool.request().query(`
      SET NOCOUNT ON;
      SELECT DB_NAME() AS DbName, SUSER_SNAME() AS LoginName,
       CASE WHEN OBJECT_ID(N'dbo.CutClubVoucherInvoiceClaim',N'U') IS NULL THEN 0 ELSE 1 END AS HasTable;
      SELECT name, is_unique, has_filter, filter_definition
      FROM sys.indexes
      WHERE object_id=OBJECT_ID(N'dbo.CutClubVoucherInvoiceClaim')
        AND name IN (N'UX_CutClubVoucherInvoiceClaim_InventoryApplied',
                     N'UX_CutClubVoucherInvoiceClaim_SaleBenefitApplied');
    `);
    const indexes = verify.recordsets[1];
    const expected = [
      "UX_CutClubVoucherInvoiceClaim_InventoryApplied",
      "UX_CutClubVoucherInvoiceClaim_SaleBenefitApplied",
    ];
    const ok = verify.recordsets[0][0].HasTable === 1 &&
      expected.every(name => indexes.some(i => i.name === name &&
        Number(i.is_unique) === 1 && Number(i.has_filter) === 1 &&
        /APPLIED/i.test(i.filter_definition || "")));
    if (!ok) throw Error("STAGING_SCHEMA_POST_VERIFY_FAILED");
    console.log("STAGING_SCHEMA_VERIFY: PASS (table and two filtered unique indexes)");
  } finally { await pool.close(); }
})().catch(err => {
  console.error("STAGING_SCHEMA_INSTALL_FAILED:", err.message?.startsWith("STAGING_") ?
    err.message : (err.code || "SQL_EXECUTION_ERROR"));
  process.exitCode = 1;
});
