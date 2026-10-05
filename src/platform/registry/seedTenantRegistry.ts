import type { Transaction } from 'mssql';
import { sql } from '@/lib/db';
import {
  APP_REGISTRY_CODES,
  OPERATIONS_SURFACE_CODE,
} from '@/platform/registry/constants';

function buildSalonManifestJson(packCode: string): string {
  return JSON.stringify({
    packCode,
    enabledApps: [...APP_REGISTRY_CODES],
    compositionSurfaces: [OPERATIONS_SURFACE_CODE],
    extensions: [],
  });
}

const REGISTRY_APPS = [
  ...APP_REGISTRY_CODES.map((code) => ({ code, name: code, entitled: 1 })),
  { code: OPERATIONS_SURFACE_CODE, name: 'Operations', entitled: 0 },
];

/** Idempotent, insert-only AppRegistry catalog rows (global, not tenant state). */
export async function ensureAppRegistryRows(transaction: Transaction): Promise<void> {
  for (const app of REGISTRY_APPS) {
    await new sql.Request(transaction)
      .input('code', sql.NVarChar(64), app.code)
      .input('name', sql.NVarChar(256), app.name)
      .input('entitled', sql.Bit, app.entitled)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.AppRegistry WHERE AppCode = @code)
          INSERT INTO dbo.AppRegistry (AppCode, DisplayName, EntitledSeparately)
          VALUES (@code, @name, @entitled);
      `);
  }
}

/**
 * CASHER_BOOT bootstrap compatibility seed (DRVO-003 behavior, unchanged):
 * idempotent AppRegistry + TenantAppEntitlement (every registered app) + SalonPackConfig.
 * SalonPackConfig is insert-only (never overwrites existing ManifestJson).
 * New tenants are composed via platform/apps/tenantApps instead.
 */
export async function seedTenantRegistry(
  transaction: Transaction,
  tenantId: string,
  packCode = 'salon',
): Promise<void> {
  await ensureAppRegistryRows(transaction);

  for (const app of REGISTRY_APPS) {
    await new sql.Request(transaction)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('code', sql.NVarChar(64), app.code)
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM dbo.TenantAppEntitlement
          WHERE TenantId = @tenantId AND AppCode = @code
        )
          INSERT INTO dbo.TenantAppEntitlement (TenantId, AppCode, Enabled)
          VALUES (@tenantId, @code, 1);
      `);
  }

  const manifestJson = buildSalonManifestJson(packCode);
  await new sql.Request(transaction)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('packCode', sql.NVarChar(64), packCode)
    .input('manifest', sql.NVarChar(sql.MAX), manifestJson)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.SalonPackConfig WHERE TenantId = @tenantId)
        INSERT INTO dbo.SalonPackConfig (TenantId, PackCode, ManifestJson)
        VALUES (@tenantId, @packCode, @manifest);
    `);
}
