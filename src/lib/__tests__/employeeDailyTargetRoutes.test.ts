import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const requirePageAccess = vi.fn();
vi.mock('@/lib/api-auth', () => ({
  isAuthResult: (v: { ok?: boolean }) => v?.ok === true,
  requirePageAccess: (...a: unknown[]) => requirePageAccess(...a),
}));

const getEmployeeDailyTargetsForDate = vi.fn();
const generateEmployeeDailyTargets = vi.fn();

vi.mock('@/lib/payroll/employee-target', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payroll/employee-target')>(
    '@/lib/payroll/employee-target',
  );
  return {
    ...actual,
    getEmployeeDailyTargetsForDate: (...a: unknown[]) => getEmployeeDailyTargetsForDate(...a),
    generateEmployeeDailyTargets: (...a: unknown[]) => generateEmployeeDailyTargets(...a),
  };
});

import { GET } from '@/app/api/payroll/daily/targets/route';
import { POST } from '@/app/api/payroll/daily/targets/generate/route';
import { EmployeeDailyTargetDomainError } from '@/lib/payroll/employee-target';

describe('daily targets APIs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePageAccess.mockResolvedValue({
      ok: true,
      userId: 7,
      userName: 'Admin',
      userLevel: 'admin',
      roles: ['admin'],
      isSuperAdmin: false,
    });
  });

  it('GET before generation returns not_generated employees', async () => {
    getEmployeeDailyTargetsForDate.mockResolvedValue({
      workDate: '2026-07-15',
      totals: {
        eligibleEmployees: 1,
        notGenerated: 1,
        generated: 0,
        recalculated: 0,
        zeroSales: 0,
        belowFirstTier: 0,
        earnedTarget: 0,
        totalCurrentNetSalesAfterDiscount: '100.00',
        totalStoredTargetAmount: '0.00',
      },
      employees: [
        {
          empId: 1,
          empName: 'أحمد',
          persistenceStatus: 'not_generated',
          storedTargetAmount: null,
        },
      ],
      planConflicts: [],
    });

    const res = await GET(
      new NextRequest('http://localhost/api/payroll/daily/targets?workDate=2026-07-15'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.employees[0].persistenceStatus).toBe('not_generated');
    expect(body.totals.notGenerated).toBe(1);
  });

  it('GET rejects invalid date', async () => {
    const res = await GET(
      new NextRequest('http://localhost/api/payroll/daily/targets?workDate=bad'),
    );
    expect(res.status).toBe(400);
  });

  it('GET rejects anonymous', async () => {
    const { NextResponse } = await import('next/server');
    requirePageAccess.mockResolvedValue(
      NextResponse.json({ error: 'غير مصرح' }, { status: 401 }),
    );
    const res = await GET(
      new NextRequest('http://localhost/api/payroll/daily/targets?workDate=2026-07-15'),
    );
    expect(res.status).toBe(401);
  });

  it('POST generate all employees', async () => {
    generateEmployeeDailyTargets.mockResolvedValue({
      workDate: '2026-07-15',
      totals: { eligibleEmployees: 2, generated: 2, recalculated: 0 },
      employees: [],
    });
    const res = await POST(
      new NextRequest('http://localhost/api/payroll/daily/targets/generate', {
        method: 'POST',
        body: JSON.stringify({ workDate: '2026-07-15' }),
      }),
    );
    expect(res.status).toBe(201);
    expect(generateEmployeeDailyTargets).toHaveBeenCalledWith({
      workDate: '2026-07-15',
      generatedByUserId: 7,
      empIds: undefined,
    });
  });

  it('POST with empIds subset', async () => {
    generateEmployeeDailyTargets.mockResolvedValue({
      workDate: '2026-07-15',
      totals: {},
      employees: [],
    });
    const res = await POST(
      new NextRequest('http://localhost/api/payroll/daily/targets/generate', {
        method: 'POST',
        body: JSON.stringify({ workDate: '2026-07-15', empIds: [12, 15] }),
      }),
    );
    expect(res.status).toBe(201);
    expect(generateEmployeeDailyTargets).toHaveBeenCalledWith(
      expect.objectContaining({ empIds: [12, 15] }),
    );
  });

  it('POST rejects invalid empIds', async () => {
    const res = await POST(
      new NextRequest('http://localhost/api/payroll/daily/targets/generate', {
        method: 'POST',
        body: JSON.stringify({ workDate: '2026-07-15', empIds: [12, 12] }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('POST domain conflict → 409', async () => {
    generateEmployeeDailyTargets.mockRejectedValue(
      new EmployeeDailyTargetDomainError('تعارض في خطط التارجت'),
    );
    const res = await POST(
      new NextRequest('http://localhost/api/payroll/daily/targets/generate', {
        method: 'POST',
        body: JSON.stringify({ workDate: '2026-07-15' }),
      }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).not.toMatch(/SELECT|INSERT|sql/i);
  });
});
