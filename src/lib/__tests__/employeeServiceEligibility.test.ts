import { describe, it, expect, vi } from 'vitest';

// ── Mock @/lib/db so the module imports cleanly; tests inject a fake pool ──────
vi.mock('@/lib/db', () => ({
  getPool: vi.fn(),
  sql: {
    Int: { type: 'int' },
    Request: class FakeReq {
      constructor(public _tx?: unknown) {}
      inputs: Record<string, unknown> = {};
      input(name: string, _type: unknown, val: unknown) {
        this.inputs[name] = val;
        return this;
      }
      async query() {
        return { recordset: [] };
      }
    },
  },
}));

import {
  normalizeServiceIds,
  validateEmployeeSupportsServices,
  buildUnsupportedServicesMessage,
} from '@/lib/employeeServiceEligibility';

interface FakeService {
  ProID: number;
  ProName?: string | null;
  ProNameAr?: string | null;
  isDeleted?: number;
}

/** Fake mssql pool that answers TblPro lookups from an in-memory catalog. */
function makePool(catalog: FakeService[]) {
  const queries: string[] = [];
  return {
    queries,
    request() {
      const inputs: Record<string, number> = {};
      return {
        input(name: string, _type: unknown, val: number) {
          inputs[name] = val;
          return this;
        },
        async query(q: string) {
          queries.push(q);
          if (/\[dbo\]\.\[TblPro\]/.test(q)) {
            const ids = Object.values(inputs);
            const recordset = catalog
              .filter((s) => ids.includes(s.ProID))
              .map((s) => ({
                ProID: s.ProID,
                ProName: s.ProName ?? null,
                ProNameAr: s.ProNameAr ?? null,
                isDeleted: s.isDeleted ?? 0,
              }));
            return { recordset };
          }
          return { recordset: [] };
        },
      };
    },
  } as never;
}

const CATALOG: FakeService[] = [
  { ProID: 1047, ProNameAr: 'حلاقة فيد', ProName: 'Fade Cut' },
  { ProID: 9, ProNameAr: 'حلاقة شعر', ProName: 'Hair Cut' },
  { ProID: 12, ProNameAr: 'تنظيف بشرة', ProName: 'Skin Care' },
  { ProID: 99, ProNameAr: 'خدمة محذوفة', ProName: 'Deleted', isDeleted: 1 },
];

describe('normalizeServiceIds', () => {
  it('dedupes and coerces numeric strings to numbers', () => {
    const { valid, invalid } = normalizeServiceIds([1047, '1047', ' 9 ', 9]);
    expect(valid).toEqual([1047, 9]);
    expect(invalid).toEqual([]);
  });

  it('collects null / invalid / non-positive ids as invalid', () => {
    const { valid, invalid } = normalizeServiceIds([null, undefined, '', 'abc', 0, -3, 12]);
    expect(valid).toEqual([12]);
    expect(invalid.length).toBe(6);
  });
});

describe('validateEmployeeSupportsServices', () => {
  it('scenario 1: employee supports all services → valid', async () => {
    const pool = makePool(CATALOG);
    const res = await validateEmployeeSupportsServices({
      employeeId: 5,
      serviceIds: [1047, 9],
      pool,
    });
    expect(res.valid).toBe(true);
    expect(res.unsupportedServices).toEqual([]);
    expect(res.requestedServiceIds).toEqual([1047, 9]);
  });

  it('scenario 2: one missing service → precise unsupported service returned', async () => {
    const pool = makePool(CATALOG);
    const res = await validateEmployeeSupportsServices({
      employeeId: 5,
      serviceIds: [1047, 555],
      pool,
    });
    expect(res.valid).toBe(false);
    expect(res.unsupportedServices).toEqual([{ serviceId: 555, serviceName: null }]);
  });

  it('scenario 3: multiple missing services → all returned', async () => {
    const pool = makePool(CATALOG);
    const res = await validateEmployeeSupportsServices({
      employeeId: 5,
      serviceIds: [1047, 555, 777],
      pool,
    });
    expect(res.valid).toBe(false);
    expect(res.unsupportedServices.map((s) => s.serviceId)).toEqual([555, 777]);
  });

  it('scenario 4: duplicate service ids → validation still works', async () => {
    const pool = makePool(CATALOG);
    const res = await validateEmployeeSupportsServices({
      employeeId: 5,
      serviceIds: [1047, 1047, 9, 9],
      pool,
    });
    expect(res.valid).toBe(true);
    expect(res.requestedServiceIds).toEqual([1047, 9]);
  });

  it('scenario 5: numeric/string ids → normalized correctly', async () => {
    const pool = makePool(CATALOG);
    const res = await validateEmployeeSupportsServices({
      employeeId: 5,
      serviceIds: ['1047', ' 9 '],
      pool,
    });
    expect(res.valid).toBe(true);
    expect(res.requestedServiceIds).toEqual([1047, 9]);
  });

  it('scenario 6: soft-deleted service → rejected with its name', async () => {
    const pool = makePool(CATALOG);
    const res = await validateEmployeeSupportsServices({
      employeeId: 5,
      serviceIds: [1047, 99],
      pool,
    });
    expect(res.valid).toBe(false);
    expect(res.unsupportedServices).toEqual([
      { serviceId: 99, serviceName: 'خدمة محذوفة' },
    ]);
  });

  it('rejects null / invalid ids explicitly (no silent drop)', async () => {
    const pool = makePool(CATALOG);
    const res = await validateEmployeeSupportsServices({
      employeeId: 5,
      serviceIds: [1047, null],
      pool,
    });
    expect(res.valid).toBe(false);
    expect(res.invalidServiceIds.length).toBe(1);
  });

  it('empty service list is vacuously valid and issues no query', async () => {
    const pool = makePool(CATALOG);
    const res = await validateEmployeeSupportsServices({
      employeeId: 5,
      serviceIds: [],
      pool,
    });
    expect(res.valid).toBe(true);
    expect((pool as unknown as { queries: string[] }).queries.length).toBe(0);
  });

  it('scenario 11: multi-service booking → every service validated in a single query (no N+1)', async () => {
    const pool = makePool(CATALOG);
    const res = await validateEmployeeSupportsServices({
      employeeId: 5,
      serviceIds: [1047, 9, 12],
      pool,
    });
    expect(res.valid).toBe(true);
    expect((pool as unknown as { queries: string[] }).queries.length).toBe(1);
  });

  it('does NOT consult the duration-override table (TblEmpServiceSettings)', async () => {
    const pool = makePool(CATALOG);
    await validateEmployeeSupportsServices({ employeeId: 5, serviceIds: [1047], pool });
    const queries = (pool as unknown as { queries: string[] }).queries;
    expect(queries.some((q) => /TblEmpServiceSettings/.test(q))).toBe(false);
  });
});

describe('buildUnsupportedServicesMessage', () => {
  it('formats a single unsupported service', () => {
    const msg = buildUnsupportedServicesMessage('كريم', [
      { serviceId: 12, serviceName: 'تنظيف بشرة' },
    ]);
    expect(msg).toBe('لا يمكن نقل الموعد إلى كريم لأنه لا يقدم خدمة: تنظيف بشرة');
  });

  it('formats multiple unsupported services on one line list', () => {
    const msg = buildUnsupportedServicesMessage('كريم', [
      { serviceId: 12, serviceName: 'تنظيف بشرة' },
      { serviceId: 13, serviceName: 'بروتين' },
    ]);
    expect(msg).toContain('الخدمات التالية');
    expect(msg).toContain('تنظيف بشرة، بروتين');
  });

  it('falls back to service id when name is missing', () => {
    const msg = buildUnsupportedServicesMessage('كريم', [
      { serviceId: 77, serviceName: null },
    ]);
    expect(msg).toContain('خدمة #77');
  });
});
