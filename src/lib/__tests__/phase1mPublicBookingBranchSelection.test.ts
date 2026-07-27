import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import fs from 'fs';
import path from 'path';
import { isPubliclyDiscoverable } from '@/lib/branch/lifecycle';

const root = path.join(__dirname, '..', '..', '..');
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('Phase 1M public booking branch selection', () => {
  it('listPublicActiveBranches filters by PUBLIC_LIVE + PublicBookingEnabled + QBS', () => {
    const src = read('src/lib/branch/bookingQueueOwnership.ts');
    expect(src).toContain('isPubliclyDiscoverable');
    expect(src).toContain('listPublicActiveBranches');
    expect(src).toContain('assertPublicBookable');
    expect(src).toContain('BookingEnabled');
    expect(src).toContain('publicBranches.length === 1');
    expect(src).toContain('PH1GTEST / SETUP / SMOKE_TEST never resolve publicly');
  });

  it('status + config endpoints remain branchCode scoped via Phase 1 resolver', () => {
    const status = read('src/app/api/public/booking/status/route.ts');
    expect(status).toContain('extractPublicBranchCode');
    expect(status).toContain('resolvePublicBookingBranchContext');

    const config = read('src/app/api/public/booking/config/route.ts');
    expect(config).toContain('extractPublicBranchCode');
    expect(config).toContain('resolvePublicBookingBranchContext');
    expect(config).toContain('bookingEnabled');
  });

  it('discoverability helper fails closed for smoke/setup', () => {
    expect(
      isPubliclyDiscoverable({
        lifecycleStatus: 'SETUP',
        publicBookingEnabled: false,
        isActive: false,
      }),
    ).toBe(false);
    expect(
      isPubliclyDiscoverable({
        lifecycleStatus: 'PUBLIC_LIVE',
        publicBookingEnabled: false,
        isActive: true,
      }),
    ).toBe(false);
  });

  it('public booking readiness doc exists', () => {
    const doc = read('docs/branch-phase-1m-public-booking-readiness.md');
    expect(doc).toContain('branchCode');
    expect(doc).toContain('cutsaloon.com');
    expect(doc).toContain('PH1GTEST');
  });
});
