/**
 * @vitest-environment node
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const queryMock = vi.fn();
const inputMock = vi.fn(() => ({ query: queryMock, input: inputMock }));

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(async () => ({
    request: () => ({
      input: inputMock,
      query: queryMock,
    }),
  })),
  sql: {
    Int: 'Int',
    NVarChar: () => 'NVarChar',
  },
}));

vi.mock('@/lib/booking/publicBookingServicePolicy', () => ({
  isRetailProductClassification: () => false,
}));

import {
  buildGroomPackageMetadataNote,
  parseGroomPackageMetadataNote,
  resolveGroomPackageBooking,
  GroomPackageBookingError,
} from '@/lib/booking/groomPackageBooking';

function proRow(overrides: Record<string, unknown>) {
  return {
    ProID: 1,
    ProName: 'Svc',
    ProNameAr: 'خدمة',
    SPrice1: 100,
    DurationMinutes: 10,
    ProType: 'serv',
    isDeleted: 0,
    CatName: 'Skincare',
    CatType: 'serv',
    ...overrides,
  };
}

describe('groomPackageBooking metadata', () => {
  it('round-trips structured notes', () => {
    const note = buildGroomPackageMetadataNote({
      packageId: 2,
      packagePrice: 1500,
      addonProIds: [1086],
      requiredServiceIds: [1049, 10, 22, 32, 1080, 1081, 1082, 12],
      totalPrice: 2000,
    });
    const parsed = parseGroomPackageMetadataNote(`customer note ${note} trailing`);
    expect(parsed).toEqual({
      packageId: 2,
      packagePrice: 1500,
      addonProIds: [1086],
      requiredServiceIds: [1049, 10, 22, 32, 1080, 1081, 1082, 12],
      totalPrice: 2000,
    });
  });
});

describe('resolveGroomPackageBooking', () => {
  beforeEach(() => {
    queryMock.mockReset();
    inputMock.mockClear();
  });

  function mockSignaturePackage() {
    const required = [1049, 10, 22, 32, 1080, 1081, 1082, 12];
    const optional = [1084, 1085, 1086, 1087];
    const prices: Record<number, number> = {
      1049: 250,
      10: 100,
      22: 120,
      32: 100,
      1080: 80,
      1081: 200,
      1082: 150,
      12: 400,
      1084: 200,
      1085: 300,
      1086: 500,
      1087: 1000,
    };
    const cats: Record<number, string> = {
      1085: 'Groom Home Visit',
      1086: 'Groom Home Visit',
      1087: 'Groom Home Visit',
      1084: 'Groom Add-ons',
    };
    const durations: Record<number, number | null> = {
      1085: 60,
      1086: 90,
      1087: 120,
      1084: null,
    };

    queryMock.mockImplementation(async (sqlText: string) => {
      const sql = String(sqlText);
      if (sql.includes('TblServicePackageItem')) {
        return {
          recordset: [
            ...required.map((ProID, i) => ({
              ProID,
              IsOptional: 0,
              SortOrder: (i + 1) * 10,
            })),
            ...optional.map((ProID, i) => ({
              ProID,
              IsOptional: 1,
              SortOrder: 1000 + i * 10,
            })),
          ],
        };
      }
      if (sql.includes('TblServicePackage')) {
        return {
          recordset: [
            {
              PackageID: 2,
              NameEn: 'Signature Groom',
              NameAr: 'باكدج العريس سيجنتشر',
              PackageKind: 'groom',
              PackagePrice: 1500,
              DurationMinutes: 110,
              isDeleted: 0,
            },
          ],
        };
      }
      // Batch Pro IN lookup — only return ids that were requested via input mocks
      const requested = inputMock.mock.calls
        .filter((c) => String(c[0]).startsWith('p'))
        .map((c) => Number(c[1]))
        .filter((n) => Number.isFinite(n) && n > 0);
      const ids = requested.length ? requested : [...required, ...optional];
      return {
        recordset: ids.map((lastProId) =>
          proRow({
            ProID: lastProId,
            ProName: `Service ${lastProId}`,
            SPrice1: prices[lastProId] ?? 0,
            DurationMinutes:
              lastProId in durations ? durations[lastProId] : 10,
            CatName: cats[lastProId] ?? 'Skincare',
            isDeleted: 0,
          }),
        ),
      };
    });
  }

  it('Signature + city visit prices PackagePrice+addon (not sum of required)', async () => {
    mockSignaturePackage();
    const r = await resolveGroomPackageBooking({
      packageId: 2,
      addonProIds: [1086],
    });
    expect(r.packagePrice).toBe(1500);
    expect(r.addonTotal).toBe(500);
    expect(r.totalPrice).toBe(2000);
    expect(r.requiredServiceIds).toEqual([1049, 10, 22, 32, 1080, 1081, 1082, 12]);
    expect(r.addonProIds).toEqual([1086]);
    // package duration 110 + city home visit 90 → 200
    expect(r.totalDurationMinutes).toBe(200);
    // first required line carries package commercial price
    expect(r.services[0].price).toBe(1500);
    expect(r.services.slice(1, 8).every((s) => s.price === 0)).toBe(true);
    expect(r.services.find((s) => s.serviceId === 1086)?.price).toBe(500);
  });

  it('rejects two home visits', async () => {
    mockSignaturePackage();
    await expect(
      resolveGroomPackageBooking({ packageId: 2, addonProIds: [1085, 1086] }),
    ).rejects.toMatchObject({ code: 'HOME_VISIT_EXCLUSIVE' });
  });

  it('rejects arbitrary addon ProID', async () => {
    mockSignaturePackage();
    await expect(
      resolveGroomPackageBooking({ packageId: 2, addonProIds: [99999] }),
    ).rejects.toMatchObject({ code: 'PACKAGE_ADDON_NOT_OPTIONAL' });
  });

  it('rejects Hair Detail Color when not optional', async () => {
    mockSignaturePackage();
    await expect(
      resolveGroomPackageBooking({ packageId: 2, addonProIds: [1083] }),
    ).rejects.toMatchObject({ code: 'PACKAGE_ADDON_NOT_OPTIONAL' });
  });

  it('logs mismatch but still uses server package truth', async () => {
    mockSignaturePackage();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await resolveGroomPackageBooking({
      packageId: 2,
      addonProIds: [1086],
      clientServiceIds: [1, 2, 3],
    });
    expect(r.clientServiceIdsMismatch).toBe(true);
    expect(r.totalPrice).toBe(2000);
    expect(r.requiredServiceIds).toEqual([1049, 10, 22, 32, 1080, 1081, 1082, 12]);
    warn.mockRestore();
  });

  it('rejects inactive package', async () => {
    queryMock.mockResolvedValueOnce({
      recordset: [
        {
          PackageID: 2,
          NameEn: 'Signature Groom',
          NameAr: 'x',
          PackageKind: 'groom',
          PackagePrice: 1500,
          DurationMinutes: 110,
          isDeleted: 1,
        },
      ],
    });
    await expect(resolveGroomPackageBooking({ packageId: 2 })).rejects.toMatchObject({
      code: 'PACKAGE_NOT_ACTIVE',
    });
  });
});

describe('GroomPackageBookingError', () => {
  it('is throwable with code', () => {
    const err = new GroomPackageBookingError('HOME_VISIT_EXCLUSIVE', { addonProIds: [1, 2] });
    expect(err.code).toBe('HOME_VISIT_EXCLUSIVE');
    expect(err.metadata.addonProIds).toEqual([1, 2]);
  });
});
