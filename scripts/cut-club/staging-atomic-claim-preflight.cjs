#!/usr/bin/env node
/**
 * READ ONLY operator preflight. Never edits SQL or prints secrets.
 * Must execute from a separately configured staging app checkout.
 * Do NOT source or reuse /home/casher/app/.env production credentials.
 */
const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");
for (const name of [".env", ".env.production", ".env.local"]) {
  const file = path.resolve(process.cwd(), name);
  if (fs.existsSync(file)) dotenv.config({ path: file, override: true, quiet: true });
}
const sql = require("mssql");
const e = process.env;
const dbName = e.LOCAL_DB_NAME || e.DB_DATABASE || e.DB_NAME || "";
if (dbName !== "last132_agent") {
  console.error("STAGING_PREFLIGHT_STOP: local target DB is not last132_agent");
  process.exitCode = 2;
} else {
  (async () => {
    const config = {
      server: e.LOCAL_DB_SERVER || e.DB_SERVER || "localhost",
      port: Number(e.LOCAL_DB_PORT || e.DB_PORT || 1433),
      database: dbName,
      user: e.LOCAL_DB_USER || e.DB_USER,
      password: e.LOCAL_DB_PASSWORD || e.DB_PASSWORD,
      options: { encrypt: false, trustServerCertificate: true },
      pool: { min: 0, max: 1 },
      connectionTimeout: 12000, requestTimeout: 12000,
    };
    if (!config.user || !config.password || !config.server)
      throw Error("STAGING_PREFLIGHT_MISSING_CONNECTION_PARAMETERS");
    const pool = await new sql.ConnectionPool(config).connect();
    try {
      const r = await pool.request()
        .input("tenant", sql.UniqueIdentifier, "413d433e-f36b-1410-8820-009ec495c7e1")
        .query(`
          SET NOCOUNT ON;
          IF DB_NAME() <> N'last132_agent'
            THROW 52115, 'STAGING_PREFLIGHT_WRONG_DATABASE', 1;
          SELECT DB_NAME() AS DbName, SUSER_SNAME() AS LoginName,
            CASE WHEN OBJECT_ID(N'dbo.CutClubVoucherInvoiceClaim',N'U') IS NOT NULL
              THEN 1 ELSE 0 END AS ClaimTableInstalled;
          SELECT t.name AS TableName,c.name AS ColumnName
          FROM sys.tables AS t
          JOIN sys.columns c ON c.object_id=t.object_id
          WHERE t.name=N'CutClubVoucherInvoiceClaim';
          SELECT ProID, COUNT_BIG(*) AS ActiveMatchingServices
          FROM dbo.TblPro
          WHERE TenantId=@tenant AND isDeleted=0 AND ProID IN (39,22,11,9)
          GROUP BY ProID ORDER BY ProID;
        `);
      const ctx = r.recordsets[0][0];
      const cols = new Set(r.recordsets[1].map(x => x.ColumnName));
      const wanted = [
        "ClaimID", "TenantId", "InventoryID", "ClientID", "BranchID",
        "InvID", "ServiceID", "Status", "CreatedAt", "ReversedAt",
      ];
      const missing = wanted.filter(x => !cols.has(x));
      const ids = r.recordsets[2].map(x => Number(x.ProID)).sort((a,b) => a-b);
      const servicesOk = JSON.stringify(ids) === JSON.stringify([9,11,22,39]);
      const ready = ctx.LoginName==="drvo_agent" &&
        ctx.ClaimTableInstalled===1 && missing.length===0 && servicesOk;
      console.log("=== CUT CLUB READ ONLY STAGING READINESS ===");
      console.log("Staging DB:",ctx.DbName);
      console.log("Expected staging SQL login:",ctx.LoginName==="drvo_agent"?"OK":"MISMATCH");
      console.log("Claim table:",ctx.ClaimTableInstalled===1?"PRESENT":"MISSING");
      console.log("Missing claim columns:",missing.length?missing.join(", "):"none");
      console.log("Approved services 9,11,22,39 present and active:",servicesOk?"YES":"NO");
      console.log("Feature flag:",e.CUT_CLUB_STAGING_CLAIM_WRITE_ENABLED==="true"?"ON":"OFF");
      console.log("RESULT:",ready?"METADATA READY (NOT E2E)": "NO-GO");
      if (!ready) process.exitCode=1;
    } finally {
      await pool.close();
    }
  })().catch(err => {
    console.error("STAGING_PREFLIGHT_FAILED:",err.code || "CONNECTION_OR_SCHEMA_ERROR");
    process.exitCode = 1;
  });
}
