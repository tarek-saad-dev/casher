import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeMasterDataDb } from './helpers/fakeMasterDataSql';

vi.mock('server-only', () => ({}));

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOOT = 'b0000000-0000-4000-8000-000000000000';
const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/lib/db', async () => {
  const mod = await import('./helpers/fakeMasterDataSql');
  const db = mod.createFakeMasterDataDb();
  h.db = db;
  return mod.fakeDbModule(db);
});

const fake = () => h.db as FakeMasterDataDb;

async function tx() {
  const { sql, getPool } = await import('@/lib/db');
  return new sql.Transaction(await getPool()) as never;
}

beforeEach(async () => {
  vi.resetModules();
  await import('@/lib/db');
  fake().reset();
  fake().tables.TblClient.push({ ClientID: 1, TenantId: BOOT, Name: 'CUT client' });
  fake().tables.TblPro.push({ ProID: 1, TenantId: BOOT, ProName: 'CUT haircut', SPrice1: 150 });
  fake().tables.TblPaymentMethods.push({ PaymentID: 1, TenantId: BOOT, PaymentMethod: 'كاش' });
});

describe('DRVO-015 seedTenantMasterData', () => {
  it('creates the minimal defaults for a new tenant only', async () => {
    const { seedTenantMasterData, DEFAULT_TENANT_PAYMENT_METHODS, DEFAULT_TENANT_FINANCE_CATEGORIES, DEFAULT_TENANT_SERVICE_CATEGORIES } =
      await import('@/platform/masterData/seedTenantMasterData');
    const r = await seedTenantMasterData(await tx(), A);
    expect(r).toEqual({
      paymentMethodsCreated: DEFAULT_TENANT_PAYMENT_METHODS.length,
      financeCategoriesCreated: DEFAULT_TENANT_FINANCE_CATEGORIES.length,
      serviceCategoriesCreated: DEFAULT_TENANT_SERVICE_CATEGORIES.length,
    });
    const ofA = (t: string) => fake().rows(t).filter((x) => x.TenantId === A);
    expect(ofA('TblPaymentMethods').map((x) => x.PaymentMethod)).toEqual([...DEFAULT_TENANT_PAYMENT_METHODS]);
    expect(ofA('TblExpINCat')).toHaveLength(DEFAULT_TENANT_FINANCE_CATEGORIES.length);
    expect(ofA('TblCat')).toHaveLength(DEFAULT_TENANT_SERVICE_CATEGORIES.length);
    // never copies CUT customers, services or prices
    expect(ofA('TblClient')).toHaveLength(0);
    expect(ofA('TblPro')).toHaveLength(0);
  });

  it('is idempotent and leaves CASHER_BOOT rows untouched', async () => {
    const { seedTenantMasterData } = await import('@/platform/masterData/seedTenantMasterData');
    await seedTenantMasterData(await tx(), A);
    const again = await seedTenantMasterData(await tx(), A);
    expect(again).toEqual({ paymentMethodsCreated: 0, financeCategoriesCreated: 0, serviceCategoriesCreated: 0 });
    expect(fake().rows('TblPaymentMethods').filter((x) => x.TenantId === BOOT)).toEqual([
      { PaymentID: 1, TenantId: BOOT, PaymentMethod: 'كاش' },
    ]);
  });

  it('a same-named CASHER_BOOT payment method does not satisfy the new tenant seed', async () => {
    const { seedTenantMasterData } = await import('@/platform/masterData/seedTenantMasterData');
    const r = await seedTenantMasterData(await tx(), A);
    expect(r.paymentMethodsCreated).toBe(2);
  });

  it('refuses a missing or malformed tenant before writing', async () => {
    const { seedTenantMasterData } = await import('@/platform/masterData/seedTenantMasterData');
    const n = fake().statements.length;
    await expect(seedTenantMasterData(await tx(), '')).rejects.toMatchObject({ name: 'TenantContextError' });
    expect(fake().statements.length).toBe(n);
  });
});
