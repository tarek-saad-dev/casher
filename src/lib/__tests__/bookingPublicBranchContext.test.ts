/**
 * Booking Phase 1 — public branch context unit tests (mocked DB/repo).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const getBranchByCode = vi.fn();
const listActiveBranches = vi.fn();
const canBranchAppearInPublicBooking = vi.fn();

vi.mock('@/lib/branch/repository', () => ({
  getBranchByCode: (...args: unknown[]) => getBranchByCode(...args),
  listActiveBranches: (...args: unknown[]) => listActiveBranches(...args),
}));

vi.mock('@/lib/branch/publicBranchVisibility', () => ({
  canBranchAppearInPublicBooking: (...args: unknown[]) =>
    canBranchAppearInPublicBooking(...args),
  canBranchesAppearInPublicBooking: async (branchIds: number[]) => {
    const out = new Map<number, boolean>();
    for (const id of branchIds) {
      out.set(id, await canBranchAppearInPublicBooking(id));
    }
    return out;
  },
}));

vi.mock('@/lib/db', () => ({
  getPool: async () => ({
    request: () => ({
      input() {
        return this;
      },
      query: async () => ({ recordset: [{ BookingEnabled: true }] }),
    }),
  }),
  sql: { Int: 0 },
}));

function gleemBranch(overrides: Record<string, unknown> = {}) {
  return {
    branchId: 1,
    branchCode: 'GLEEM',
    branchName: 'جليم',
    shortName: 'GLEEM',
    address: 'addr',
    phone: '01',
    timeZone: 'Africa/Cairo',
    businessDayCutoffTime: '04:00:00',
    defaultOpenTime: '11:00:00',
    defaultCloseTime: '01:30:00',
    isActive: true,
    lifecycleStatus: 'PUBLIC_LIVE',
    publicBookingEnabled: true,
    externalNotificationsEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

function campCaesarBranch(overrides: Record<string, unknown> = {}) {
  return gleemBranch({
    branchId: 3,
    branchCode: 'CAMP_CAESAR',
    branchName: 'كامب شيزار',
    lifecycleStatus: 'INTERNAL_LIVE',
    publicBookingEnabled: false,
    ...overrides,
  });
}

describe('bookingPublicBranchContext', () => {
  beforeEach(() => {
    getBranchByCode.mockReset();
    listActiveBranches.mockReset();
    canBranchAppearInPublicBooking.mockReset();
    vi.resetModules();
  });

  it('normalizes lowercase gleem and resolves public_booking', async () => {
    getBranchByCode.mockResolvedValue(gleemBranch());
    const mod = await import('@/lib/booking/publicBookingBranchContext');
    mod.invalidatePublicBookingBranchContextCache();
    const ctx = await mod.resolvePublicBookingBranchContext({
      branchCode: 'gleem',
      purpose: 'public_booking',
    });
    expect(ctx.branchCode).toBe('GLEEM');
    expect(ctx.bookingEnabled).toBe(true);
    expect(ctx.lifecycleStatus).toBeUndefined();
  });

  it('rejects Camp Caesar for public_booking without leaking lifecycle', async () => {
    getBranchByCode.mockResolvedValue(campCaesarBranch());
    const mod = await import('@/lib/booking/publicBookingBranchContext');
    mod.invalidatePublicBookingBranchContextCache();
    await expect(
      mod.resolvePublicBookingBranchContext({
        branchCode: 'CAMP_CAESAR',
        purpose: 'public_booking',
      }),
    ).rejects.toMatchObject({ code: 'BRANCH_NOT_PUBLIC', httpStatus: 404 });
  });

  it('rejects SETUP and INTERNAL_LIVE', async () => {
    const mod = await import('@/lib/booking/publicBookingBranchContext');
    mod.invalidatePublicBookingBranchContextCache();
    getBranchByCode.mockResolvedValue(
      gleemBranch({ lifecycleStatus: 'SETUP', publicBookingEnabled: false, isActive: false }),
    );
    await expect(
      mod.resolvePublicBookingBranchContext({ branchCode: 'X', purpose: 'public_booking' }),
    ).rejects.toMatchObject({ code: 'BRANCH_NOT_PUBLIC' });

    getBranchByCode.mockResolvedValue(
      gleemBranch({ lifecycleStatus: 'INTERNAL_LIVE', publicBookingEnabled: false }),
    );
    await expect(
      mod.resolvePublicBookingBranchContext({ branchCode: 'Y', purpose: 'public_booking' }),
    ).rejects.toMatchObject({ code: 'BRANCH_NOT_PUBLIC' });
  });

  it('rejects inactive PUBLIC_LIVE and PublicBookingEnabled=false', async () => {
    const mod = await import('@/lib/booking/publicBookingBranchContext');
    mod.invalidatePublicBookingBranchContextCache();
    getBranchByCode.mockResolvedValue(gleemBranch({ isActive: false }));
    await expect(
      mod.resolvePublicBookingBranchContext({ branchCode: 'GLEEM', purpose: 'public_booking' }),
    ).rejects.toMatchObject({ code: 'BRANCH_NOT_PUBLIC' });

    getBranchByCode.mockResolvedValue(gleemBranch({ publicBookingEnabled: false }));
    await expect(
      mod.resolvePublicBookingBranchContext({ branchCode: 'GLEEM', purpose: 'public_booking' }),
    ).rejects.toMatchObject({ code: 'BRANCH_NOT_PUBLIC' });
  });

  it('missing / empty / numeric / malformed codes fail correctly', async () => {
    const mod = await import('@/lib/booking/publicBookingBranchContext');
    expect(() => mod.normalizePublicBranchCode(null)).toThrowError(
      expect.objectContaining({ code: 'BRANCH_REQUIRED' }),
    );
    expect(() => mod.normalizePublicBranchCode('  ')).toThrowError(
      expect.objectContaining({ code: 'BRANCH_REQUIRED' }),
    );
    expect(() => mod.normalizePublicBranchCode('3')).toThrowError(
      expect.objectContaining({ code: 'INVALID_BRANCH_CODE' }),
    );
    expect(() => mod.normalizePublicBranchCode('bad code!')).toThrowError(
      expect.objectContaining({ code: 'INVALID_BRANCH_CODE' }),
    );
  });

  it('unknown code returns BRANCH_NOT_FOUND', async () => {
    getBranchByCode.mockResolvedValue(null);
    const mod = await import('@/lib/booking/publicBookingBranchContext');
    mod.invalidatePublicBookingBranchContextCache();
    await expect(
      mod.resolvePublicBookingBranchContext({
        branchCode: 'NO_SUCH_BRANCH',
        purpose: 'public_booking',
      }),
    ).rejects.toMatchObject({ code: 'BRANCH_NOT_FOUND' });
  });

  it('never falls back to GLEEM when branchCode missing', async () => {
    const mod = await import('@/lib/booking/publicBookingBranchContext');
    await expect(
      mod.resolvePublicBookingBranchContext({
        branchCode: null,
        purpose: 'public_booking',
      }),
    ).rejects.toMatchObject({ code: 'BRANCH_REQUIRED' });
    expect(getBranchByCode).not.toHaveBeenCalled();
  });

  it('internal_preview requires authorization; preview query alone fails', async () => {
    getBranchByCode.mockResolvedValue(campCaesarBranch());
    const mod = await import('@/lib/booking/publicBookingBranchContext');
    mod.invalidatePublicBookingBranchContextCache();
    await expect(
      mod.resolvePublicBookingBranchContext({
        branchCode: 'CAMP_CAESAR',
        purpose: 'internal_preview',
        previewQueryParam: 'true',
      }),
    ).rejects.toMatchObject({ code: 'BRANCH_NOT_PUBLIC' });

    const ctx = await mod.resolvePublicBookingBranchContext({
      branchCode: 'CAMP_CAESAR',
      purpose: 'internal_preview',
      auth: { userId: 10, canManageSettings: true },
    });
    expect(ctx.branchCode).toBe('CAMP_CAESAR');
    expect(ctx.lifecycleStatus).toBe('INTERNAL_LIVE');
  });

  it('listPublicDiscoverableBranches uses canBranchAppearInPublicBooking', async () => {
    listActiveBranches.mockResolvedValue([gleemBranch(), campCaesarBranch()]);
    canBranchAppearInPublicBooking.mockImplementation(async (id: number) => id === 1);
    const mod = await import('@/lib/booking/publicBookingBranchContext');
    const list = await mod.listPublicDiscoverableBranches();
    expect(list.map((b) => b.branchCode)).toEqual(['GLEEM']);
  });

  it('cache keys isolate by branchCode and purpose', async () => {
    getBranchByCode.mockResolvedValue(gleemBranch());
    const mod = await import('@/lib/booking/publicBookingBranchContext');
    mod.invalidatePublicBookingBranchContextCache();
    const a = await mod.resolvePublicBookingBranchContext({
      branchCode: 'GLEEM',
      purpose: 'public_booking',
    });
    getBranchByCode.mockResolvedValue(gleemBranch({ branchName: 'changed-should-not-show-if-cached' }));
    const b = await mod.resolvePublicBookingBranchContext({
      branchCode: 'GLEEM',
      purpose: 'public_booking',
    });
    expect(b.branchName).toBe(a.branchName);
    mod.invalidatePublicBookingBranchContextCache('GLEEM');
    const c = await mod.resolvePublicBookingBranchContext({
      branchCode: 'GLEEM',
      purpose: 'public_booking',
    });
    expect(c.branchName).toBe('changed-should-not-show-if-cached');
  });
});

describe('bookingPublicBranchVisibility policy', () => {
  it('isPubliclyDiscoverable requires PUBLIC_LIVE + flags', async () => {
    const { isPubliclyDiscoverable } = await import('@/lib/branch/lifecycle');
    expect(
      isPubliclyDiscoverable({
        lifecycleStatus: 'PUBLIC_LIVE',
        publicBookingEnabled: true,
        isActive: true,
      }),
    ).toBe(true);
    expect(
      isPubliclyDiscoverable({
        lifecycleStatus: 'INTERNAL_LIVE',
        publicBookingEnabled: true,
        isActive: true,
      }),
    ).toBe(false);
  });
});

describe('booking error contract nested shape', () => {
  it('returns nested error object', async () => {
    const { publicBookingErrorBody, PUBLIC_BOOKING_ERROR_CATALOG } = await import(
      '@/lib/booking/publicBookingErrorCatalog'
    );
    const body = publicBookingErrorBody('BRANCH_REQUIRED');
    expect(body).toEqual({
      ok: false,
      error: {
        code: 'BRANCH_REQUIRED',
        message: PUBLIC_BOOKING_ERROR_CATALOG.BRANCH_REQUIRED.messageAr,
        technicalMessage: 'branchCode is required',
        metadata: {},
      },
    });
  });
});

describe('config/status/services route contracts (source)', () => {
  it('config, status, and services use Phase 1 resolver (no silent fallback)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const root = path.join(__dirname, '..', '..', '..');
    const config = fs.readFileSync(
      path.join(root, 'src/app/api/public/booking/config/route.ts'),
      'utf8',
    );
    const status = fs.readFileSync(
      path.join(root, 'src/app/api/public/booking/status/route.ts'),
      'utf8',
    );
    const services = fs.readFileSync(
      path.join(root, 'src/app/api/public/booking/services/route.ts'),
      'utf8',
    );
    const branches = fs.readFileSync(
      path.join(root, 'src/app/api/public/branches/route.ts'),
      'utf8',
    );
    expect(config).toContain('resolvePublicBookingBranchContext');
    expect(config).not.toContain('resolvePublicBranchCode');
    expect(status).toContain('resolvePublicBookingBranchContext');
    expect(services).toContain('resolvePublicBookingBranchContext');
    expect(services).not.toContain('resolvePublicBranchCode');
    expect(branches).toContain('listPublicDiscoverableBranches');
  });
});
