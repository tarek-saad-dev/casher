/** REAL SQL staging integration test. Explicit opt-in; never run in CI or production.
 * Run with DB_PASSWORD and staging fence environment set. Creates a dedicated
 * tenant and removes only its own rows in afterAll, including on test failure.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

vi.mock('server-only', () => ({}));
import { getPool, sql } from '@/lib/db';
import { applyCommercialEntitlementCommand } from './commercialEntitlementService';

const staging = process.env.DRVO_STAGING_MODE === 'true'
  && process.env.STAGING_SAFETY_ENFORCE === 'true'
  && process.env.STAGING_SAFETY_DB_NAME === 'last132_agent'
  && process.env.DB_NAME === 'last132_agent'
  && process.env.DB_DATABASE === 'last132_agent'
  && process.env.DB_USER === 'drvo_agent'
  && process.env.DRVO_REAL_SQL_INTEGRATION === 'YES';

const tenantId = randomUUID();
const requestId = randomUUID();
const code = 'IT_' + randomUUID().replace(/-/g, '').slice(0, 14);
const future = '2099-01-01T00:00:00.000Z';
const renewed = '2099-06-01T00:00:00.000Z';
let tenantCreated = false;

describe.skipIf(!staging)('DRVO real SQL entitlement integration (isolated temporary tenant)', () => {
  beforeAll(async () => {
    const pool = await getPool();
    const safety = await pool.request().query<{ DbName: string; LoginName: string; ProductionAccess: number }>(`
      SELECT DB_NAME() AS DbName, SUSER_SNAME() AS LoginName,
             ISNULL(HAS_DBACCESS(N'last132'), 1) AS ProductionAccess
    `);
    expect(safety.recordset[0]).toMatchObject({
      DbName: 'last132_agent', LoginName: 'drvo_agent', ProductionAccess: 0,
    });
    await pool.request()
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('code', sql.NVarChar(64), code)
      .query(`
        INSERT dbo.Tenant(TenantId, Code, Name, Status)
        VALUES (@tenantId, @code, N'DRVO temporary integration tenant', N'active')
      `);
    tenantCreated = true;
  }, 60_000);

  afterAll(async () => {
    if (!tenantCreated) return;
    const pool = await getPool();
    // Fail closed: cleanup is restricted to the exact generated tenant ID.
    const tx = pool.transaction();
    await tx.begin();
    try {
      const safety = await tx.request().query<{ DbName: string }>('SELECT DB_NAME() AS DbName');
      if (safety.recordset[0]?.DbName !== 'last132_agent') throw new Error('CLEANUP_DB_MISMATCH');
      await tx.request().input('tenantId', sql.UniqueIdentifier, tenantId)
        .query('DELETE FROM dbo.DrvoModuleEntitlementAudit WHERE TenantId = @tenantId');
      await tx.request().input('tenantId', sql.UniqueIdentifier, tenantId)
        .query('DELETE FROM dbo.DrvoTenantModuleEntitlement WHERE TenantId = @tenantId');
      await tx.request().input('tenantId', sql.UniqueIdentifier, tenantId)
        .query('DELETE FROM dbo.Tenant WHERE TenantId = @tenantId');
      await tx.commit();
      console.log('DRVO_REAL_SQL_TEST_CLEANUP_PASS');
    } catch (err) {
      try { await tx.rollback(); } catch {}
      console.error('DRVO_REAL_SQL_TEST_CLEANUP_FAILED: temporary TenantId=' + tenantId);
      throw err;
    }
  }, 60_000);

  it('provisions, replays idempotently, rejects key reuse, suspends, renews and cancels', async () => {
    const base = { tenantId, moduleKey: 'inventory', requestId, action: 'provision' as const, validUntilUtc: future };
    const first = await applyCommercialEntitlementCommand(13, base);
    expect(first).toMatchObject({ status: 'enabled', replayed: false });
    const replay = await applyCommercialEntitlementCommand(13, base);
    expect(replay).toMatchObject({ status: 'enabled', replayed: true });
    await expect(applyCommercialEntitlementCommand(13, { ...base, moduleKey: 'reports' }))
      .rejects.toThrow('IDEMPOTENCY_KEY_REUSED');
    const suspend = await applyCommercialEntitlementCommand(13, {
      tenantId, moduleKey: 'inventory', requestId: randomUUID(), action: 'suspend',
    });
    expect(suspend.status).toBe('suspended');
    const renew = await applyCommercialEntitlementCommand(13, {
      tenantId, moduleKey: 'inventory', requestId: randomUUID(), action: 'renew', validUntilUtc: renewed,
    });
    expect(renew.status).toBe('enabled');
    const cancel = await applyCommercialEntitlementCommand(13, {
      tenantId, moduleKey: 'inventory', requestId: randomUUID(), action: 'cancel',
    });
    expect(cancel.status).toBe('disabled');
    const pool = await getPool();
    const audit = await pool.request().input('tenantId', sql.UniqueIdentifier, tenantId)
      .query<{ AuditCount: number }>('SELECT COUNT(*) AS AuditCount FROM dbo.DrvoModuleEntitlementAudit WHERE TenantId = @tenantId');
    expect(audit.recordset[0].AuditCount).toBe(4);
    const current = await pool.request().input('tenantId', sql.UniqueIdentifier, tenantId)
      .query<{ Status: string }>(`SELECT Status FROM dbo.DrvoTenantModuleEntitlement
        WHERE TenantId = @tenantId AND ModuleKey = N'inventory'`);
    expect(current.recordset[0].Status).toBe('disabled');
  }, 90_000);

  it('denies users without platform grants', async () => {
    await expect(applyCommercialEntitlementCommand(2147483647, {
      tenantId, moduleKey: 'reports', requestId: randomUUID(), action: 'provision', validUntilUtc: future,
    })).rejects.toThrow('PLATFORM_ENTITLEMENT_MANAGE_DENIED');
  }, 60_000);
});
