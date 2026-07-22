import { describe, expect, it, vi } from 'vitest';
import { isValidUserBranchAccess } from '@/lib/branch/repository';

vi.mock('server-only', () => ({}));

describe('Phase 1B access validity rules', () => {
  const now = new Date('2026-07-22T12:00:00Z');

  it('accepts valid active mappings and excludes inactive branches', () => {
    expect(
      isValidUserBranchAccess(
        {
          id: 1,
          userId: 3,
          branchId: 1,
          branchCode: 'GLEEM',
          branchName: 'جليم',
          shortName: 'جليم',
          isDefault: true,
          canOperate: true,
          canViewReports: false,
          canSwitch: false,
          isActive: true,
          validFrom: new Date('2026-01-01T00:00:00Z'),
          validTo: null,
          branchIsActive: true,
        },
        now,
      ),
    ).toBe(true);

    expect(
      isValidUserBranchAccess(
        {
          id: 2,
          userId: 3,
          branchId: 2,
          branchCode: 'OTHER',
          branchName: 'Other',
          shortName: null,
          isDefault: false,
          canOperate: true,
          canViewReports: true,
          canSwitch: true,
          isActive: true,
          validFrom: new Date('2026-01-01T00:00:00Z'),
          validTo: null,
          branchIsActive: false,
        },
        now,
      ),
    ).toBe(false);
  });
});
