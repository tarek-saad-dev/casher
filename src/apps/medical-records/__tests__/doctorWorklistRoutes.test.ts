import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), actor: vi.fn(), list: vi.fn(), transition: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  requireTenantApp: mocks.auth,
  isAuthResult: (v: unknown) => !(v instanceof Response),
}));
vi.mock('../internal/repository', () => ({
  resolveClinicalActorForUser: mocks.actor,
}));
vi.mock('../internal/doctorWorklistRepository', () => ({
  listDoctorAppointments: mocks.list,
}));
vi.mock('../internal/appointmentHandoffRepository', async importOriginal => {
  const original = await importOriginal<typeof import('../internal/appointmentHandoffRepository')>();
  return { ...original, transitionClinicAppointment: mocks.transition };
});

import { GET } from '@/app/api/clinic/my-day/route';
import { POST } from '@/app/api/clinic/my-day/[bookingId]/route';
import { ClinicAppointmentConflict } from '../internal/appointmentHandoffRepository';

const req = (url: string) => new NextRequest('http://localhost' + url);
const post = (body: unknown) => new NextRequest('http://localhost/api/clinic/my-day/19', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const ctx = (id: string) => ({ params: Promise.resolve({ bookingId: id }) });

describe('doctor-only clinic day API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      tenantId: 'tenant-1', activeBranchId: 3, userId: 27,
      tenant: { activeLocation: { locationId: 'location-3' } },
    });
    mocks.actor.mockResolvedValue({ kind: 'human', userId: 27, empId: 42 });
    mocks.list.mockResolvedValue([]);
    mocks.transition.mockResolvedValue({
      bookingId: 19, encounterId: 'visit-19', status: 'in_service',
    });
  });

  it('requires clinical app entitlement for both read and start', async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    expect((await GET(req('/api/clinic/my-day?date=2026-10-26'))).status).toBe(403);
    expect((await POST(post({ action: 'start' }), ctx('19'))).status).toBe(403);
    expect(mocks.actor).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('rejects invalid dates before querying practitioner information', async () => {
    expect((await GET(req('/api/clinic/my-day?date=2026-02-30'))).status).toBe(400);
    expect(mocks.actor).not.toHaveBeenCalled();
  });

  it('rejects unlinked logins without exposing another doctor appointments', async () => {
    mocks.actor.mockResolvedValue(null);
    const res = await GET(req('/api/clinic/my-day?date=2026-10-26'));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('CLINIC_DOCTOR_NOT_LINKED');
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('obtains tenant, date, branch, employee and user only from the authenticated context', async () => {
    const res = await GET(req('/api/clinic/my-day?date=2026-10-26&empId=100&branchId=100&tenantId=other'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.list).toHaveBeenCalledWith({
      tenantId: 'tenant-1', branchId: 3, userId: 27,
      practitionerEmpId: 42, date: '2026-10-26',
    });
  });

  it('rejects check-in or other mutations on doctor-only endpoint', async () => {
    expect((await POST(post({ action: 'arrive' }), ctx('19'))).status).toBe(400);
    expect((await POST(post({ action: 'cancel' }), ctx('19'))).status).toBe(400);
    expect(mocks.transition).not.toHaveBeenCalled();
  });

  it('rejects malformed booking ids and visit types', async () => {
    expect((await POST(post({ action: 'start' }), ctx('01'))).status).toBe(400);
    expect((await POST(post({ action: 'start', visitType: 'invalid' }), ctx('19'))).status).toBe(400);
    expect(mocks.transition).not.toHaveBeenCalled();
  });

  it('cannot start with an unlinked account', async () => {
    mocks.actor.mockResolvedValue(null);
    const res = await POST(post({ action: 'start' }), ctx('19'));
    expect(res.status).toBe(403);
    expect(mocks.transition).not.toHaveBeenCalled();
  });

  it('always passes assigned logged-in doctor into locked booking transition', async () => {
    const res = await POST(post({ action: 'start', visitType: 'follow_up', empId: 99 }), ctx('19'));
    expect(res.status).toBe(201);
    expect(mocks.transition).toHaveBeenCalledWith({
      tenantId: 'tenant-1', branchId: 3,
      locationId: 'location-3', bookingId: 19, actorUserId: 27,
      expectedPractitionerEmpId: 42, action: 'start', visitType: 'follow_up',
    });
  });

  it('maps a foreign doctor booking to 404, and a stale reassignment to a conflict', async () => {
    mocks.transition.mockRejectedValueOnce(new ClinicAppointmentConflict('NOT_FOUND', 'not yours'));
    expect((await POST(post({ action: 'start' }), ctx('19'))).status).toBe(404);
    mocks.transition.mockRejectedValueOnce(new ClinicAppointmentConflict('DOCTOR_UNAVAILABLE', 'changed doctor'));
    expect((await POST(post({ action: 'start' }), ctx('19'))).status).toBe(409);
  });

  it('returns 200 for an existing visit and never exposes SQL errors', async () => {
    mocks.transition.mockResolvedValueOnce({
      bookingId: 19, status: 'in_service', encounterId: 'visit-19', reused: true,
    });
    expect((await POST(post({ action: 'start' }), ctx('19'))).status).toBe(200);
    mocks.transition.mockRejectedValueOnce(new Error('Private database details'));
    const result = await POST(post({ action: 'start' }), ctx('19'));
    expect(result.status).toBe(500);
    expect(JSON.stringify(await result.json())).not.toContain('Private database');
  });
});
