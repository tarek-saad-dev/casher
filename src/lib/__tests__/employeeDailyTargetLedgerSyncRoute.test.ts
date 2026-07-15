import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

vi.mock('server-only', () => ({}));

const requirePageAccess = vi.fn();
const isAuthResult = vi.fn((v: unknown) => typeof v === 'object' && v != null && (v as { ok?: boolean }).ok === true);

vi.mock('@/lib/api-auth', () => ({
  requirePageAccess: (...a: unknown[]) => requirePageAccess(...a),
  isAuthResult: (v: unknown) => isAuthResult(v),
}));

const reconcileEmployeeDailyTargetLedger = vi.fn();

vi.mock('@/lib/payroll/employee-target', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payroll/employee-target')>(
    '@/lib/payroll/employee-target',
  );
  return {
    ...actual,
    reconcileEmployeeDailyTargetLedger: (...a: unknown[]) => reconcileEmployeeDailyTargetLedger(...a),
  };
});

import { POST } from '@/app/api/payroll/daily/targets/ledger-sync/route';

describe('POST /api/payroll/daily/targets/ledger-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePageAccess.mockResolvedValue({ ok: true, userId: 7 });
  });

  it('dry-run for a specific day', async () => {
    reconcileEmployeeDailyTargetLedger.mockResolvedValue({
      scope: { workDate: '2026-07-15', dryRun: true, empIds: null },
      totals: { checked: 1, matched: 1, missing: 0, mismatched: 0, duplicates: 0, orphans: 0, repairable: 0, repaired: 0 },
      repair: { inserted: 0, updated: 0, deleted: 0, unchanged: 0, skippedConflicts: 0 },
      rows: [],
    });

    const res = await POST(
      new NextRequest('http://localhost/api/payroll/daily/targets/ledger-sync', {
        method: 'POST',
        body: JSON.stringify({ workDate: '2026-07-15' }),
      }),
    );
    expect(res.status).toBe(200);
    expect(reconcileEmployeeDailyTargetLedger).toHaveBeenCalledWith(
      expect.objectContaining({ workDate: '2026-07-15', dryRun: true }),
      7,
    );
  });

  it('repair for a day when dryRun=false', async () => {
    reconcileEmployeeDailyTargetLedger.mockResolvedValue({
      scope: { workDate: '2026-07-15', dryRun: false, empIds: null },
      totals: { checked: 1, matched: 0, missing: 0, mismatched: 0, duplicates: 0, orphans: 0, repairable: 1, repaired: 1 },
      repair: { inserted: 1, updated: 0, deleted: 0, unchanged: 0, skippedConflicts: 0 },
      rows: [],
    });

    const res = await POST(
      new NextRequest('http://localhost/api/payroll/daily/targets/ledger-sync', {
        method: 'POST',
        body: JSON.stringify({ workDate: '2026-07-15', dryRun: false }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.repair.inserted).toBe(1);
  });

  it('accepts year+month and empIds', async () => {
    reconcileEmployeeDailyTargetLedger.mockResolvedValue({
      scope: {},
      totals: { checked: 0, matched: 0, missing: 0, mismatched: 0, duplicates: 0, orphans: 0, repairable: 0, repaired: 0 },
      repair: { inserted: 0, updated: 0, deleted: 0, unchanged: 0, skippedConflicts: 0 },
      rows: [],
    });

    const res = await POST(
      new NextRequest('http://localhost/api/payroll/daily/targets/ledger-sync', {
        method: 'POST',
        body: JSON.stringify({ year: 2026, month: 7, empIds: [12], dryRun: true }),
      }),
    );
    expect(res.status).toBe(200);
    expect(reconcileEmployeeDailyTargetLedger).toHaveBeenCalledWith(
      expect.objectContaining({ year: 2026, month: 7, empIds: [12] }),
      7,
    );
  });

  it('rejects invalid month and unlimited scope', async () => {
    const badMonth = await POST(
      new NextRequest('http://localhost/api/payroll/daily/targets/ledger-sync', {
        method: 'POST',
        body: JSON.stringify({ year: 2026, month: 13 }),
      }),
    );
    expect(badMonth.status).toBe(400);

    const unlimited = await POST(
      new NextRequest('http://localhost/api/payroll/daily/targets/ledger-sync', {
        method: 'POST',
        body: JSON.stringify({ dryRun: true }),
      }),
    );
    expect(unlimited.status).toBe(400);
  });

  it('unauthorized when page access denied', async () => {
    requirePageAccess.mockResolvedValue(NextResponse.json({ error: 'غير مصرح' }, { status: 403 }));
    isAuthResult.mockReturnValue(false);

    const res = await POST(
      new NextRequest('http://localhost/api/payroll/daily/targets/ledger-sync', {
        method: 'POST',
        body: JSON.stringify({ workDate: '2026-07-15' }),
      }),
    );
    expect(res.status).toBe(403);
    expect(reconcileEmployeeDailyTargetLedger).not.toHaveBeenCalled();
  });
});
