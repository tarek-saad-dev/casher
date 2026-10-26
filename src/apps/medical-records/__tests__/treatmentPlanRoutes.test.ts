import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), actor: vi.fn(), list: vi.fn(), create: vi.fn(), link: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  requireTenantApp: mocks.auth,
  isAuthResult: (v: unknown) => !(v instanceof Response),
}));
vi.mock('../internal/repository', () => ({ resolveClinicalActorForUser: mocks.actor }));
vi.mock('../internal/treatmentPlanRepository', () => ({
  listTreatmentPlans: mocks.list,
  createTreatmentPlan: mocks.create,
  attachTreatmentSessionBooking: mocks.link,
}));

import { GET, POST } from '@/app/api/clinic/treatment-plans/route';
import { POST as LINK } from '@/app/api/clinic/treatment-plans/[planId]/sessions/[sessionNumber]/booking/route';
import { TreatmentPlanConflict } from '../application/treatmentPlanPolicy';

const encounterId = 'f8e4b6ec-118e-42d5-9ae7-f1c6b4d59fd2';
const planId = 'bd42d0c7-1bef-4561-9a41-bb1891b71ac8';
const get = (id = encounterId) =>
  new NextRequest('http://localhost/api/clinic/treatment-plans?encounterId=' + id);
const post = (data: unknown) => new NextRequest('http://localhost/api/clinic/treatment-plans', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
});
const link = (body: unknown) =>
  new NextRequest('http://localhost/api/clinic/treatment-plans/id/sessions/1/booking', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
const ctx = (number: string) => ({ params: Promise.resolve({ planId, sessionNumber: number }) });

describe('clinic treatment plan routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ tenantId: 'tenant-1', activeBranchId: 3, userId: 9 });
    mocks.actor.mockResolvedValue({ kind: 'human', userId: 9, empId: 22 });
    mocks.list.mockResolvedValue([]);
    mocks.create.mockResolvedValue(planId);
    mocks.link.mockResolvedValue({ bookingId: 19, reused: false });
  });

  it('requires medical-records entitlement and never accesses patient data without it', async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({ error: 'denied' }, { status: 403 }));
    expect((await GET(get())).status).toBe(403);
    expect((await POST(post({ encounterId, title: 'علاج', totalSessions: 4 }))).status).toBe(403);
    expect((await LINK(link({ bookingId: 19 }), ctx('1'))).status).toBe(403);
    expect(mocks.actor).not.toHaveBeenCalled();
  });

  it('never trusts doctor or tenant in request params/body', async () => {
    const res = await GET(new NextRequest(
      'http://localhost/api/clinic/treatment-plans?encounterId=' + encounterId +
      '&tenantId=other&practitionerEmpId=999',
    ));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.list).toHaveBeenCalledWith({
      tenantId: 'tenant-1', branchId: 3, userId: 9,
      practitionerEmpId: 22, encounterId,
    });
    const created = await POST(post({ encounterId, title: 'برنامج جلسات', totalSessions: 4,
      practitionerEmpId: 999, tenantId: 'other' }));
    expect(created.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({
      tenantId: 'tenant-1', branchId: 3, userId: 9,
      practitionerEmpId: 22, encounterId, title: 'برنامج جلسات', totalSessions: 4,
    });
  });

  it('unlinked clinicians cannot see or mutate treatment plans', async () => {
    mocks.actor.mockResolvedValue(null);
    expect((await GET(get())).status).toBe(403);
    expect((await POST(post({ encounterId, title: 'خطة', totalSessions: 3 }))).status).toBe(403);
    expect((await LINK(link({ bookingId: 19 }), ctx('1'))).status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.link).not.toHaveBeenCalled();
  });

  it('rejects non-UUID encounter, invalid title/count before writing', async () => {
    expect((await GET(get('19'))).status).toBe(400);
    expect((await POST(post({ encounterId: '19', title: 'خطة', totalSessions: 3 }))).status).toBe(400);
    expect((await POST(post({ encounterId, title: 'خطة', totalSessions: 51 }))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('links only numeric booking IDs to assigned doctor's plan', async () => {
    expect((await LINK(link({ bookingId: 'bogus' }), ctx('1'))).status).toBe(400);
    expect((await LINK(link({ bookingId: 19 }), ctx('0'))).status).toBe(400);
    const res = await LINK(link({ bookingId: 19, doctorId: 200 }), ctx('1'));
    expect(res.status).toBe(201);
    expect(mocks.link).toHaveBeenCalledWith({
      tenantId: 'tenant-1', branchId: 3, userId: 9,
      practitionerEmpId: 22, planId, sessionNumber: 1, bookingId: 19,
    });
  });

  it('maps duplicate booking and incomplete source to conflicts', async () => {
    mocks.link.mockRejectedValueOnce(new TreatmentPlanConflict('BOOKING_ALREADY_LINKED', 'reused'));
    const failed = await LINK(link({ bookingId: 19 }), ctx('1'));
    expect(failed.status).toBe(409);
    mocks.create.mockRejectedValueOnce(new TreatmentPlanConflict('NOT_READY', 'incomplete'));
    expect((await POST(post({ encounterId, title: 'خطة علاج', totalSessions: 3 }))).status).toBe(409);
  });
});
