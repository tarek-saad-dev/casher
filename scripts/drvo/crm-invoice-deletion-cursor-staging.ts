#!/usr/bin/env npx tsx
/**
 * Read-only acceptance for the DRVOWA sales hard-delete audit cursor.
 * Dedicated staging SQL only: last132_agent/drvo_agent via local SSH tunnel.
 * NEVER runs against production, changes data, or outputs customer/audit PII.
 */
import sql from 'mssql';

const EXPECTED_DB = 'last132_agent';
const EXPECTED_LOGIN = 'drvo_agent';

async function main() {
  const pass = process.env.DRVO_STAGING_DB_PASSWORD;
  if (!pass) throw new Error('Dedicated staging DB password required');
  if (process.env.DB_DATABASE === 'last132' ||
      process.env.CLOUD_DB_NAME === 'last132') {
    throw new Error('Production environment detected; refusing to run');
  }
  const pool = await new sql.ConnectionPool({
    server: '127.0.0.1', port: 14330, database: EXPECTED_DB,
    user: EXPECTED_LOGIN, password: pass,
    options: { encrypt: false, trustServerCertificate: true },
    connectionTimeout: 10000, requestTimeout: 15000,
  }).connect();
  try {
    const id = await pool.request()
      .query('SELECT DB_NAME() AS db, SUSER_SNAME() AS login');
    const row = id.recordset[0];
    if (row?.db !== EXPECTED_DB ||
        String(row?.login).toLowerCase() !== EXPECTED_LOGIN) {
      throw new Error('Identity mismatch: staging-only proof refused');
    }
    console.log('PASS: isolated staging identity only');

    const schema = await pool.request().query(`
      SELECT c.name
      FROM sys.columns c
      WHERE c.object_id = OBJECT_ID(N'dbo.TblSensitiveActionAuditLog',N'U')
        AND c.name IN
          (N'AuditID',N'ActionType',N'ExecutionStatus',N'ActionMethod',
           N'EndpointPath',N'EntityID');
    `);
    const names = new Set(schema.recordset.map((c: {name: string})=>c.name));
    for (const column of [
      'AuditID','ActionType','ExecutionStatus','ActionMethod','EndpointPath','EntityID',
    ]) {
      if (!names.has(column)) throw new Error('Missing required audit column ' + column);
    }
    console.log('PASS: pre-existing audited invoice deletion schema present');

    // Validate the query executed under the actual staging user's READ rights,
    // including conversion, parameterization and bounded cursor ordering.
    const records = await pool.request()
      .input('sinceAuditId', sql.Int, 0)
      .input('limit', sql.Int, 20)
      .input('actionType', sql.NVarChar(100), 'delete_invoice')
      .input('status', sql.NVarChar(30), 'success')
      .input('method', sql.NVarChar(20), 'DELETE')
      .query(`
        SELECT TOP (@limit)
          a.AuditID AS auditId, TRY_CONVERT(int, a.EntityID) AS invId
        FROM dbo.TblSensitiveActionAuditLog a
        WHERE a.AuditID > @sinceAuditId
          AND a.ActionType = @actionType
          AND a.ExecutionStatus = @status
          AND a.ActionMethod = @method
          AND a.EndpointPath LIKE N'/api/sales/%'
          AND TRY_CONVERT(int, a.EntityID) > 0
        ORDER BY a.AuditID ASC;
      `);
    let cursor=0;
    for (const line of records.recordset as Array<{auditId:number,invId:number}>) {
      if (!Number.isSafeInteger(Number(line.auditId)) ||
          Number(line.auditId) <= cursor ||
          !Number.isSafeInteger(Number(line.invId)) ||
          Number(line.invId) <= 0) {
        throw new Error('Invalid audit cursor monotonicity or invoice key');
      }
      cursor=Number(line.auditId);
    }
    console.log('PASS: bounded successful-delete cursor SQL executed, count=' +
      records.recordset.length + ' (no row values, audit PII or customer details printed)');
    if (records.recordset.length === 0) {
      console.log('NOTE: no audited deletes in this snapshot; endpoint status flow still requires independent UAT');
    }
  } finally {
    await pool.close();
  }
}
void main().catch(error=>{
  console.error('FAIL: safe staging audit cursor proof: ' +
    (error instanceof Error ? error.message : String(error)));
  process.exitCode=1;
});
