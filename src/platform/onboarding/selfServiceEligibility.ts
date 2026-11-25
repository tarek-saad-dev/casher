import 'server-only';
import { getPool, sql } from '@/lib/db';

/** Only successfully self-registered salons get the first-run setup workflow. */
export async function isPublicSalonSetupTenant(tenantId: string, tenantCode: string): Promise<boolean> {
  if (tenantCode === 'CASHER_BOOT') return false;
  const pool = await getPool();
  const registration = await pool.request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT TOP 1 TenantId
      FROM dbo.PublicSignupRegistration
      WHERE TenantId = @tenantId AND IndustryCode = N'salon' AND Status = N'provisioned';
    `);
  return registration.recordset.length > 0;
}
