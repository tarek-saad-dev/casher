/**
 * DRVO-015 — two-tenant proof for shared master data. Tenant A and Tenant B each create a
 * same-named customer, service category, service and package through the real route handlers and
 * repositories; an in-memory SQL engine that honours every WHERE predicate stands in for SQL Server.
 * Neither tenant may list, read, update, delete or reference the other's rows.
 */
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeMasterDataDb } from './helpers/fakeMasterDataSql';

vi.mock('server-only', () => ({}));

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const h = vi.hoisted(() => ({ tenantId: '' as string, db: null as unknown }));

vi.mock('@/lib/db', async () => {
  const mod = await import('./helpers/fakeMasterDataSql');
  const db = mod.createFakeMasterDataDb();
  h.db = db;
  return mod.fakeDbModule(db);
});

vi.mock('@/lib/api-auth', () => ({
  authenticate: async () =>
    h.tenantId
      ? { ok: true, tenantId: h.tenantId, session: { UserID: 1, TenantId: h.tenantId } }
      : NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
  requirePageAccess: async () =>
    h.tenantId
      ? { ok: true, tenantId: h.tenantId, session: { UserID: 1, TenantId: h.tenantId } }
      : NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
  isAuthResult: (v: unknown) => !(v instanceof NextResponse) && (v as { ok?: boolean }).ok === true,
}));

vi.mock('@/lib/migrations/ensureServiceImageUrl', () => ({
  ensureTblProImageUrlColumn: async () => false,
  tblProImageUrlSelect: () => 'NULL AS ImageUrl',
}));
vi.mock('@/lib/migrations/ensureCategorySortOrder', () => ({
  ensureTblCatSortOrderColumn: async () => false,
  tblCatSortOrderSelect: () => '0 AS SortOrder',
}));
vi.mock('@/lib/booking/publicBookingServices', () => ({
  invalidatePublicBookingServicesCache: () => {},
}));

const fake = () => h.db as FakeMasterDataDb;

function as(tenantId: string) {
  h.tenantId = tenantId;
}

function req(url: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

async function seedTwoTenants() {
  const customers = await import('@/app/api/customers/route');
  const categories = await import('@/app/api/services/categories/route');
  const services = await import('@/app/api/services/route');

  const out: Record<string, { clientId: number; catId: number; proId: number }> = {};
  for (const t of [A, B]) {
    as(t);
    const c = await (await customers.POST(req('/api/customers', 'POST', { name: 'Ahmed Ali', mobile: '01012345678' }))).json();
    const cat = await (await categories.POST(req('/api/services/categories', 'POST', { CatName: 'Hair' }))).json();
    const pro = await (
      await services.POST(req('/api/services', 'POST', { ProName: 'Haircut', SPrice1: t === A ? 100 : 250, CatID: cat.CatID, isActive: true }))
    ).json();
    out[t] = { clientId: c.ClientID, catId: cat.CatID, proId: pro.ProID };
  }
  return out;
}

beforeEach(async () => {
  vi.resetModules();
  await import('@/lib/db');
  fake().reset();
  h.tenantId = '';
});

describe('DRVO-015 two-tenant master-data isolation', () => {
  it('both tenants can own a same-named customer, category and service', async () => {
    const ids = await seedTwoTenants();
    expect(ids[A].clientId).not.toBe(ids[B].clientId);
    expect(ids[A].catId).not.toBe(ids[B].catId);
    expect(ids[A].proId).not.toBe(ids[B].proId);

    const tenantsOf = (table: string, key: string, val: string) =>
      fake().rows(table).filter((r) => r[key] === val).map((r) => String(r.TenantId));
    expect(tenantsOf('TblClient', 'Name', 'Ahmed Ali').sort()).toEqual([A, B]);
    expect(tenantsOf('TblCat', 'CatName', 'Hair').sort()).toEqual([A, B]);
    expect(tenantsOf('TblPro', 'ProName', 'Haircut').sort()).toEqual([A, B]);
  });

  it('customer search returns only the caller tenant row', async () => {
    const ids = await seedTwoTenants();
    const { GET } = await import('@/app/api/customers/route');
    as(A);
    const rowsA = await (await GET(req('/api/customers?q=Ahmed'))).json();
    expect(rowsA.map((r: { ClientID: number }) => r.ClientID)).toEqual([ids[A].clientId]);
    as(B);
    const rowsB = await (await GET(req('/api/customers?q=Ahmed'))).json();
    expect(rowsB.map((r: { ClientID: number }) => r.ClientID)).toEqual([ids[B].clientId]);
  });

  it('cross-tenant customer update by id is not-found and leaves the row untouched', async () => {
    const ids = await seedTwoTenants();
    const { PATCH } = await import('@/app/api/customers/[id]/route');
    as(A);
    const res = await PATCH(req(`/api/customers/${ids[B].clientId}`, 'PATCH', { name: 'Hijacked' }), ctx(ids[B].clientId));
    expect(res.status).toBe(404);
    const bRow = fake().rows('TblClient').find((r) => r.ClientID === ids[B].clientId)!;
    expect(bRow.Name).toBe('Ahmed Ali');

    const own = await PATCH(req(`/api/customers/${ids[A].clientId}`, 'PATCH', { name: 'Ahmed A.' }), ctx(ids[A].clientId));
    expect(own.status).toBe(200);
    expect((await own.json()).Name).toBe('Ahmed A.');
  });

  it('service list shows only the caller tenant catalog with its own price', async () => {
    const ids = await seedTwoTenants();
    const { GET } = await import('@/app/api/services/route');
    as(B);
    const rows = await (await GET(req('/api/services'))).json();
    expect(rows.map((r: { ProID: number }) => r.ProID)).toEqual([ids[B].proId]);
    expect(rows[0].SPrice1).toBe(250);
  });

  it('cross-tenant service update by id is not-found and leaves the row untouched', async () => {
    const ids = await seedTwoTenants();
    const { PUT } = await import('@/app/api/services/[id]/route');
    as(A);
    const res = await PUT(
      req(`/api/services/${ids[B].proId}`, 'PUT', { ProName: 'Haircut', SPrice1: 1, isActive: true }),
      ctx(ids[B].proId),
    );
    expect(res.status).toBe(404);
    expect(fake().rows('TblPro').find((r) => r.ProID === ids[B].proId)!.SPrice1).toBe(250);
  });

  it('a service cannot be filed under another tenant category', async () => {
    const ids = await seedTwoTenants();
    const { POST } = await import('@/app/api/services/route');
    as(A);
    const res = await POST(req('/api/services', 'POST', { ProName: 'Shave', SPrice1: 50, CatID: ids[B].catId, isActive: true }));
    expect(res.status).toBe(404);
    expect(fake().rows('TblPro').some((r) => r.ProName === 'Shave')).toBe(false);
  });

  it('packages: same name per tenant, foreign service items rejected, by-id reads/writes not-found', async () => {
    const ids = await seedTwoTenants();
    const pkgs = await import('@/lib/catalog/servicePackages');
    const { getPool } = await import('@/lib/db');
    const db = (await getPool()) as never;
    const body = (proId: number) => ({
      NameEn: 'Groom Gold',
      NameAr: null,
      PackageKind: 'regular' as const,
      PackagePrice: 500,
      OriginalPrice: null,
      DurationMinutes: 60,
      Bonus: 0,
      ImageUrl: null,
      DescriptionAr: null,
      DescriptionEn: null,
      SortOrder: 0,
      IsPopular: false,
      isActive: true,
      DepositAmount: null,
      IncludesTrial: false,
      SessionCount: null,
      NotesAr: null,
      items: [{ ProID: proId, Qty: 1, SortOrder: 10, IsOptional: false }],
    });

    const pa = await pkgs.createServicePackage(db, A, body(ids[A].proId));
    const pb = await pkgs.createServicePackage(db, B, body(ids[B].proId));
    expect(pa.PackageID).not.toBe(pb.PackageID);

    await expect(pkgs.createServicePackage(db, A, body(ids[B].proId))).rejects.toBeInstanceOf(
      pkgs.PackageItemServiceNotFoundError,
    );

    expect(await pkgs.getServicePackageById(db, A, pb.PackageID)).toBeNull();
    expect(await pkgs.updateServicePackage(db, A, pb.PackageID, body(ids[A].proId))).toBeNull();
    expect(await pkgs.softDeleteServicePackage(db, A, pb.PackageID)).toBe(false);
    const bPkg = fake().rows('TblServicePackage').find((r) => r.PackageID === pb.PackageID)!;
    expect(Number(bPkg.isDeleted)).toBe(0);
    expect(fake().rows('TblServicePackageItem').filter((r) => r.PackageID === pb.PackageID)).toHaveLength(1);

    const listA = await pkgs.listServicePackages(db, A, {});
    expect(listA.map((p) => p.PackageID)).toEqual([pa.PackageID]);
  });

  it('phone lookups (public website, booking upsert, messaging) resolve within the tenant only', async () => {
    const ids = await seedTwoTenants();
    const website = await import('@/lib/client/publicClientWebsite.service');
    const { lookupClientIdByPhone } = await import('@/lib/client/clientPhoneLookup');
    const { upsertCustomer } = await import('@/lib/publicBookingHelpers');

    expect((await website.lookupClientByMobile(A, '01012345678'))?.id).toBe(ids[A].clientId);
    expect((await website.lookupClientByMobile(B, '+201012345678'))?.id).toBe(ids[B].clientId);
    expect((await lookupClientIdByPhone(A, '01012345678')).clientId).toBe(ids[A].clientId);

    expect(await upsertCustomer('Ahmed Ali', '01012345678', undefined, B)).toBe(ids[B].clientId);
    const before = fake().rows('TblClient').length;
    const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const newId = await upsertCustomer('Ahmed Ali', '01012345678', undefined, C);
    expect(newId).not.toBe(ids[A].clientId);
    expect(fake().rows('TblClient')).toHaveLength(before + 1);

    const upd = await website.updateClientWebsiteProfile(A, { clientId: ids[B].clientId, address: 'Giza' });
    expect(upd.ok).toBe(false);
    expect(fake().rows('TblClient').find((r) => r.ClientID === ids[B].clientId)!.Address ?? null).toBeNull();
  });

  it('a missing or malformed tenant fails closed before any SQL runs', async () => {
    const { lookupClientIdByPhone } = await import('@/lib/client/clientPhoneLookup');
    const pkgs = await import('@/lib/catalog/servicePackages');
    const { getPool } = await import('@/lib/db');
    const db = (await getPool()) as never;
    const n = fake().statements.length;
    const unresolved = { name: 'TenantContextError', code: 'TENANT_CONTEXT_UNRESOLVED' };
    await expect(lookupClientIdByPhone('', '01012345678')).rejects.toMatchObject(unresolved);
    await expect(pkgs.getServicePackageById(db, 'not-a-guid', 1)).rejects.toMatchObject(unresolved);
    expect(fake().statements.length).toBe(n);
  });

  it('control: the same engine leaks both tenants when a predicate is missing', async () => {
    await seedTwoTenants();
    const { getPool, sql } = await import('@/lib/db');
    const pool = await getPool();
    const unscoped = await pool.request().input('q', sql.NVarChar(100), '%Ahmed%')
      .query(`SELECT ClientID FROM dbo.TblClient WHERE [Name] LIKE @q`);
    expect(unscoped.recordset).toHaveLength(2);
  });

  it('every master-data statement issued during the proof carries a TenantId predicate', async () => {
    await seedTwoTenants();
    const touching = fake().statements.filter((s) => /\b(TblClient|TblPro|TblCat|TblServicePackage\w*)\b/.test(s));
    expect(touching.length).toBeGreaterThan(0);
    for (const s of touching) expect(s, s).toMatch(/TenantId/);
  });
});
