import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

describe('POST /api/operations/shift/handoff', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('server-only', () => ({}));
  });

  it('hands off with one atomic command and returns bootstrap operational CAMP', async () => {
    const handoffShift = vi.fn(async () => ({
      id: 201,
      branchId: 2,
      businessDayId: 20,
      newDay: '2026-08-25',
      userId: 7,
      shiftId: 1,
      startDate: '2026-08-25',
      startTime: '11:00 AM',
      status: true,
    }));
    vi.doMock('@/lib/session', () => ({
      getSession: vi.fn(async () => ({
        UserID: 7,
        UserName: 'saad',
        UserLevel: 'admin',
        ActiveBranchID: 2,
        ActiveBranchCode: 'CAMP_CAESAR',
        BranchSessionVersion: 1,
      })),
    }));
    vi.doMock('@/lib/permissions', () => ({
      hasPermission: () => true,
    }));
    vi.doMock('@/lib/branch/shiftSession', () => ({ handoffShift }));
    vi.doMock('@/lib/branch/operationalGates', () => ({
      branchErrorResponse: () => null,
    }));
    vi.doMock('@/modules/operations/application/loadOperationalBootstrap', () => ({
      loadOperationalBootstrap: vi.fn(async () => ({
        ok: true,
        data: {
          view: { branch: { branchId: 2, branchCode: 'CAMP_CAESAR' } },
          operational: {
            branch: { branchId: 2, branchCode: 'CAMP_CAESAR' },
            shift: { id: 201, branchId: 2 },
          },
        },
      })),
    }));

    const { POST } = await import('@/app/api/operations/shift/handoff/route');
    const res = await POST(
      new NextRequest('http://localhost/api/operations/shift/handoff', {
        method: 'POST',
        body: JSON.stringify({ targetBranchId: 2, shiftId: 1 }),
      }),
    );
    expect(res.status).toBe(200);
    expect(handoffShift).toHaveBeenCalledTimes(1);
    expect(handoffShift).toHaveBeenCalledWith({
      userId: 7,
      targetBranchId: 2,
      shiftId: 1,
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.shift.BranchID).toBe(2);
    expect(body.bootstrap.operational.branch.branchCode).toBe('CAMP_CAESAR');
    expect(handoffShift.mock.calls[0]?.[0]).toEqual({
      userId: 7,
      targetBranchId: 2,
      shiftId: 1,
    });
  });

  it('failed handoff does not invent a new operational branch', async () => {
    const handoffShift = vi.fn(async () => {
      const err = Object.assign(new Error('يوم العمل غير مفتوح'), {
        name: 'BranchDomainError',
        code: 'NO_OPEN_DAY',
        status: 400,
      });
      throw err;
    });
    vi.doMock('@/lib/session', () => ({
      getSession: vi.fn(async () => ({
        UserID: 7,
        UserName: 'saad',
        UserLevel: 'admin',
        ActiveBranchID: 2,
        ActiveBranchCode: 'CAMP_CAESAR',
        BranchSessionVersion: 1,
      })),
    }));
    vi.doMock('@/lib/permissions', () => ({
      hasPermission: () => true,
    }));
    vi.doMock('@/lib/branch/shiftSession', () => ({ handoffShift }));
    vi.doMock('@/lib/branch/operationalGates', () => ({
      branchErrorResponse: (err: { name?: string; message?: string; code?: string; status?: number }) => {
        if (err?.name === 'BranchDomainError') {
          return Response.json({ error: err.message, code: err.code }, { status: err.status || 400 });
        }
        return null;
      },
    }));
    const loadOperationalBootstrap = vi.fn();
    vi.doMock('@/modules/operations/application/loadOperationalBootstrap', () => ({
      loadOperationalBootstrap,
    }));

    const { POST } = await import('@/app/api/operations/shift/handoff/route');
    const res = await POST(
      new NextRequest('http://localhost/api/operations/shift/handoff', {
        method: 'POST',
        body: JSON.stringify({ targetBranchId: 2, shiftId: 1 }),
      }),
    );
    expect(res.status).toBe(400);
    expect(loadOperationalBootstrap).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.bootstrap).toBeUndefined();
    expect(body.ok).toBeUndefined();
  });
});
