import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const getSession = vi.fn();
vi.mock('@/lib/session', () => ({
  getSession: (...args: unknown[]) => getSession(...args),
}));

const getEmployeeTargetSettings = vi.fn();
const previewEmployeeTargetPlan = vi.fn();
const saveEmployeeTargetPlan = vi.fn();

vi.mock('@/lib/payroll/employee-target', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payroll/employee-target')>(
    '@/lib/payroll/employee-target',
  );
  return {
    ...actual,
    getEmployeeTargetSettings: (...args: unknown[]) => getEmployeeTargetSettings(...args),
    previewEmployeeTargetPlan: (...args: unknown[]) => previewEmployeeTargetPlan(...args),
    saveEmployeeTargetPlan: (...args: unknown[]) => saveEmployeeTargetPlan(...args),
  };
});

import { GET, PUT } from '@/app/api/admin/employees/[id]/target-settings/route';
import { POST as previewPost } from '@/app/api/admin/employees/[id]/target-settings/preview/route';
import {
  EmployeeTargetConflictError,
  EmployeeTargetValidationError,
} from '@/lib/payroll/employee-target';

describe('target-settings APIs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ UserID: 1, UserName: 'Admin', UserLevel: 1 });
  });

  it('GET returns settings payload', async () => {
    getEmployeeTargetSettings.mockResolvedValue({
      employee: { empId: 5, empName: 'أحمد', isActive: true },
      asOfDate: '2026-07-14',
      effectivePlan: null,
      latestPlan: null,
      history: [],
    });

    const res = await GET(
      new NextRequest('http://localhost/api/admin/employees/5/target-settings'),
      { params: Promise.resolve({ id: '5' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.employee.empName).toBe('أحمد');
    expect(getEmployeeTargetSettings).toHaveBeenCalledWith(5, null);
  });

  it('GET unauthorized', async () => {
    getSession.mockResolvedValue(null);
    const res = await GET(
      new NextRequest('http://localhost/api/admin/employees/5/target-settings'),
      { params: Promise.resolve({ id: '5' }) },
    );
    expect(res.status).toBe(401);
  });

  it('preview returns converted tiers + calculation', async () => {
    previewEmployeeTargetPlan.mockReturnValue({
      convertedTiers: [{ dailyStartAmount: 1000, ratePercent: 20 }],
      preview: { targetAmount: 100, breakdown: [] },
    });

    // Use real parse; mock only preview function — wait, we mocked the whole module's preview
    // Actually importActual spreads real parseTargetPreviewBody; preview is mocked.
    // But route calls previewEmployeeTargetPlan which is mocked — good.
    // However route will call real parse then mocked preview. If we mock return, fine.

    // Re-import path: preview route imports previewEmployeeTargetPlan from module — mocked.

    const res = await previewPost(
      new NextRequest('http://localhost/api/admin/employees/5/target-settings/preview', {
        method: 'POST',
        body: JSON.stringify({
          inputBasis: 'daily',
          conversionDays: 26,
          tiers: [{ inputStartAmount: 1000, ratePercent: 20 }],
          sampleDailySales: 1500,
        }),
      }),
      { params: Promise.resolve({ id: '5' }) },
    );

    // Because we mocked preview to ignore args, but real parse runs first in route...
    // Our mock replaces previewEmployeeTargetPlan - the route imports at load time.
    // Need to check - vi.mock hoists so route uses mocked preview.
    // But I set mockReturnValue - then real parse still runs for body.
    // Problem: I mocked get/preview/save but previewEmployeeTargetPlan.mockReturnValue
    // means real conversion won't run. That's ok for API wiring test.

    // Actually wait - importActual includes real previewEmployeeTargetPlan then we override.
    // Good.

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preview.targetAmount).toBe(100);
  });

  it('PUT validation error returns 400 Arabic message', async () => {
    saveEmployeeTargetPlan.mockRejectedValue(
      new EmployeeTargetValidationError('التارجت المفعّل يحتاج شريحة واحدة على الأقل'),
    );

    const res = await PUT(
      new NextRequest('http://localhost/api/admin/employees/5/target-settings', {
        method: 'PUT',
        body: JSON.stringify({
          isEnabled: true,
          inputBasis: 'daily',
          conversionDays: 26,
          effectiveFrom: '2026-07-14',
          tiers: [{ inputStartAmount: 1000, ratePercent: 20 }],
        }),
      }),
      { params: Promise.resolve({ id: '5' }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('شريحة');
  });

  it('PUT conflict returns 409', async () => {
    saveEmployeeTargetPlan.mockRejectedValue(
      new EmployeeTargetConflictError('حدث تعارض مع خطة مستقبلية'),
    );

    const res = await PUT(
      new NextRequest('http://localhost/api/admin/employees/5/target-settings', {
        method: 'PUT',
        body: JSON.stringify({
          isEnabled: false,
          inputBasis: 'monthly',
          conversionDays: 26,
          effectiveFrom: '2026-07-14',
          tiers: [],
        }),
      }),
      { params: Promise.resolve({ id: '5' }) },
    );
    expect(res.status).toBe(409);
  });

  it('PUT success returns saved plan', async () => {
    saveEmployeeTargetPlan.mockResolvedValue({
      id: 9,
      empId: 5,
      isEnabled: false,
      tiers: [],
      effectiveFrom: '2026-07-14',
    });

    const res = await PUT(
      new NextRequest('http://localhost/api/admin/employees/5/target-settings', {
        method: 'PUT',
        body: JSON.stringify({
          isEnabled: false,
          inputBasis: 'monthly',
          conversionDays: 26,
          effectiveFrom: '2026-07-14',
          tiers: [],
        }),
      }),
      { params: Promise.resolve({ id: '5' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan.id).toBe(9);
    expect(body.plan.isEnabled).toBe(false);
  });
});
