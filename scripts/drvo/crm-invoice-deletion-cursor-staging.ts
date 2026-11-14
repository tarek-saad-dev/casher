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

    const owner=await pool.request().query(
      "SELECT TenantId FROM dbo.Tenant WHERE Code=N'CASHER_BOOT'");
    if (owner.recordset.length !== 1 || !owner.recordset[0].TenantId) {
      throw new Error('Missing unique CASHER_BOOT tenant on staging');
    }
    const ownerTenantId=String(owner.recordset[0].TenantId);

    // Validate the query executed under the actual staging user's READ rights,
    // including conversion, parameterization and bounded cursor ordering.
    const records = await pool.request()
      .input('sinceAuditId', sql.Int, 0)
      .input('limit', sql.Int, 20)
      .input('tenantId', sql.UniqueIdentifier, ownerTenantId)
      .input('actionType', sql.NVarChar(100), 'delete_invoice')
      .input('status', sql.NVarChar(30), 'success')
      .input('method', sql.NVarChar(20), 'DELETE')
      .query(`
        SELECT TOP (@limit)
          a.AuditID AS auditId, TRY_CONVERT(int, a.EntityID) AS invId
        FROM dbo.TblSensitiveActionAuditLog a WITH (READCOMMITTEDLOCK)
        WHERE a.AuditID > @sinceAuditId
          AND a.ActionType = @actionType
          AND a.ExecutionStatus = @status
          AND a.ActionMethod = @method
          AND a.EndpointPath LIKE N'/api/sales/%'
          AND TRY_CONVERT(int, a.EntityID) > 0
          AND EXISTS (
            SELECT 1 FROM dbo.Location l
            WHERE l.TenantId=@tenantId
              AND l.LegacyBranchId=TRY_CONVERT(int, JSON_VALUE(
                CASE WHEN ISJSON(a.OldData)=1 THEN a.OldData ELSE N'{}' END,
                '$.header.BranchID'
              ))
          )
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
    // A deliberately unmatched tenant must never observe any deletion IDs.
    const denied=await pool.request()
      .input('sinceAuditId',sql.Int,0)
      .input('limit',sql.Int,20)
      .input('tenantId',sql.UniqueIdentifier,'00000000-0000-0000-0000-000000000000')
      .input('actionType',sql.NVarChar(100),'delete_invoice')
      .input('status',sql.NVarChar(30),'success')
      .input('method',sql.NVarChar(20),'DELETE')
      .query(`
        SELECT TOP (@limit) a.AuditID
        FROM dbo.TblSensitiveActionAuditLog a WITH (READCOMMITTEDLOCK)
        WHERE a.AuditID>@sinceAuditId
          AND a.ActionType=@actionType AND a.ExecutionStatus=@status
          AND a.ActionMethod=@method AND a.EndpointPath LIKE N'/api/sales/%'
          AND TRY_CONVERT(int,a.EntityID)>0
          AND EXISTS (
            SELECT 1 FROM dbo.Location l
            WHERE l.TenantId=@tenantId
              AND l.LegacyBranchId=TRY_CONVERT(int, JSON_VALUE(
                CASE WHEN ISJSON(a.OldData)=1 THEN a.OldData ELSE N'{}' END,
                '$.header.BranchID'
              ))
          )
        ORDER BY a.AuditID ASC;
      `);
    if (denied.recordset.length !== 0) {
      throw new Error('Cross-tenant audited deletion exposure detected');
    }
    console.log('PASS: cross-tenant negative query yields zero audit IDs');
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
