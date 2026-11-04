import 'server-only';
import { getPool, sql } from '@/lib/db';

export type PortalPushSubscriptionRow = {
  ID: number;
  EmpID: number;
  TenantId: string;
  Endpoint: string;
  P256dh: string;
  Auth: string;
};

export async function ensureEmployeePortalPushTable(): Promise<void> {
  const pool = await getPool();
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.TblEmployeePortalPushSubscription', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.TblEmployeePortalPushSubscription (
        ID int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        EmpID int NOT NULL,
        TenantId nvarchar(100) NOT NULL,
        Endpoint nvarchar(1000) NOT NULL,
        P256dh nvarchar(255) NOT NULL,
        Auth nvarchar(255) NOT NULL,
        UserAgent nvarchar(400) NULL,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_EmployeePortalPushCreated DEFAULT SYSUTCDATETIME(),
        UpdatedAt datetime2 NULL,
        CONSTRAINT FK_EmployeePortalPushEmp FOREIGN KEY (EmpID) REFERENCES dbo.TblEmp(EmpID),
        CONSTRAINT UQ_EmployeePortalPushEndpoint UNIQUE (Endpoint)
      );
      CREATE INDEX IX_EmployeePortalPush_EmpTenant
        ON dbo.TblEmployeePortalPushSubscription (EmpID, TenantId);
    END
  `);
}

export async function upsertPortalPushSubscription(input: {
  empId: number;
  tenantId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}): Promise<void> {
  await ensureEmployeePortalPushTable();
  const pool = await getPool();
  await pool
    .request()
    .input('empId', sql.Int, input.empId)
    .input('tenantId', sql.NVarChar(100), input.tenantId)
    .input('endpoint', sql.NVarChar(1000), input.endpoint)
    .input('p256dh', sql.NVarChar(255), input.p256dh)
    .input('auth', sql.NVarChar(255), input.auth)
    .input('ua', sql.NVarChar(400), input.userAgent ?? null)
    .query(`
      MERGE dbo.TblEmployeePortalPushSubscription AS target
      USING (SELECT @endpoint AS Endpoint) AS src
      ON target.Endpoint = src.Endpoint
      WHEN MATCHED THEN
        UPDATE SET
          EmpID = @empId,
          TenantId = @tenantId,
          P256dh = @p256dh,
          Auth = @auth,
          UserAgent = @ua,
          UpdatedAt = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (EmpID, TenantId, Endpoint, P256dh, Auth, UserAgent)
        VALUES (@empId, @tenantId, @endpoint, @p256dh, @auth, @ua);
    `);
}

export async function deletePortalPushSubscription(input: {
  empId: number;
  tenantId: string;
  endpoint: string;
}): Promise<boolean> {
  await ensureEmployeePortalPushTable();
  const pool = await getPool();
  const result = await pool
    .request()
    .input('empId', sql.Int, input.empId)
    .input('tenantId', sql.NVarChar(100), input.tenantId)
    .input('endpoint', sql.NVarChar(1000), input.endpoint)
    .query(`
      DELETE FROM dbo.TblEmployeePortalPushSubscription
      WHERE EmpID = @empId AND TenantId = @tenantId AND Endpoint = @endpoint
    `);
  return (result.rowsAffected[0] ?? 0) > 0;
}

export async function deletePortalPushSubscriptionByEndpoint(endpoint: string): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input('endpoint', sql.NVarChar(1000), endpoint)
    .query(`
      IF OBJECT_ID(N'dbo.TblEmployeePortalPushSubscription', N'U') IS NOT NULL
        DELETE FROM dbo.TblEmployeePortalPushSubscription WHERE Endpoint = @endpoint
    `);
}

export async function listPortalPushSubscriptionsForEmployee(input: {
  empId: number;
  tenantId?: string;
}): Promise<PortalPushSubscriptionRow[]> {
  const pool = await getPool();
  try {
    const request = pool.request().input('empId', sql.Int, input.empId);
    let tenantClause = '';
    if (input.tenantId) {
      request.input('tenantId', sql.NVarChar(100), input.tenantId);
      tenantClause = 'AND TenantId = @tenantId';
    }
    const result = await request.query(`
      SELECT ID, EmpID, TenantId, Endpoint, P256dh, Auth
      FROM dbo.TblEmployeePortalPushSubscription
      WHERE EmpID = @empId ${tenantClause}
    `);
    return result.recordset as PortalPushSubscriptionRow[];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/TblEmployeePortalPushSubscription|Invalid object name/i.test(message)) {
      return [];
    }
    throw error;
  }
}
