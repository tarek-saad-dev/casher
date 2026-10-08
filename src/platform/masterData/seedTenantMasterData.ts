import type { Transaction } from 'mssql';
import { sql } from '@/lib/db';
import { requireMasterDataTenantId } from './tenantScope';

export const DEFAULT_TENANT_PAYMENT_METHODS = ['كاش', 'فيزا'] as const;

export const DEFAULT_TENANT_FINANCE_CATEGORIES = [
  { catName: 'مصروفات عامة', expInType: 'مصروفات' },
  { catName: 'إيرادات أخرى', expInType: 'ايرادات' },
] as const;

export const DEFAULT_TENANT_SERVICE_CATEGORIES = ['خدمات'] as const;

export interface SeedTenantMasterDataResult {
  paymentMethodsCreated: number;
  financeCategoriesCreated: number;
  serviceCategoriesCreated: number;
}

/**
 * Minimal default master data for a new tenant, inside the caller's transaction.
 * Insert-only and idempotent per tenant: never updates or copies another tenant's rows
 * (in particular no CUT customers, services or prices).
 */
export async function seedTenantMasterData(
  tx: Transaction,
  tenantId: string,
): Promise<SeedTenantMasterDataResult> {
  const tid = requireMasterDataTenantId(tenantId, 'seedTenantMasterData');
  const result: SeedTenantMasterDataResult = {
    paymentMethodsCreated: 0,
    financeCategoriesCreated: 0,
    serviceCategoriesCreated: 0,
  };

  for (const name of DEFAULT_TENANT_PAYMENT_METHODS) {
    const r = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tid)
      .input('name', sql.NVarChar(100), name)
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM dbo.TblPaymentMethods WITH (UPDLOCK, HOLDLOCK)
          WHERE TenantId = @tenantId AND PaymentMethod = @name
        )
          INSERT INTO dbo.TblPaymentMethods (TenantId, PaymentMethod) VALUES (@tenantId, @name);
      `);
    result.paymentMethodsCreated += r.rowsAffected.reduce((a, b) => a + b, 0) > 0 ? 1 : 0;
  }

  for (const cat of DEFAULT_TENANT_FINANCE_CATEGORIES) {
    const r = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tid)
      .input('name', sql.NVarChar(200), cat.catName)
      .input('type', sql.NVarChar(50), cat.expInType)
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM dbo.TblExpINCat WITH (UPDLOCK, HOLDLOCK)
          WHERE TenantId = @tenantId AND CatName = @name AND ExpINType = @type
        )
          INSERT INTO dbo.TblExpINCat (TenantId, CatName, ExpINType) VALUES (@tenantId, @name, @type);
      `);
    result.financeCategoriesCreated += r.rowsAffected.reduce((a, b) => a + b, 0) > 0 ? 1 : 0;
  }

  for (const name of DEFAULT_TENANT_SERVICE_CATEGORIES) {
    const r = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tid)
      .input('name', sql.NVarChar(100), name)
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM dbo.TblCat WITH (UPDLOCK, HOLDLOCK)
          WHERE TenantId = @tenantId AND CatName = @name
        )
          INSERT INTO dbo.TblCat (TenantId, CatName) VALUES (@tenantId, @name);
      `);
    result.serviceCategoriesCreated += r.rowsAffected.reduce((a, b) => a + b, 0) > 0 ? 1 : 0;
  }

  return result;
}
