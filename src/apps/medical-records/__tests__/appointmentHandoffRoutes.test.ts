import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), transition: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({
  requireTenantApp: mocks.auth,
  isAuthResult: (result: unknown) => !(result instanceof Response),
}));
vi.mock('../internal/appointmentHandoffRepository', async importOriginal => {
  const original = await importOriginal<typeof import('../internal/appointmentHandoffRepository')>();
  return { ...original, listClinicAppointments: mocks.list, transitionClinicAppointment: mocks.transition };
});

import { GET } from '@/app/api/clinic/appointments/route';
import { POST } from '@/app/api/clinic/appointments/[bookingId]/route';
import { ClinicAppointmentConflict } from '../internal/appointmentHandoffRepository';

const request = (path: string, body?: unknown) => new NextRequest(`http://localhost${path}`, body === undefined
  ? { method: 'GET' }
  : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const ctx = (bookingId: string) => ({ params: Promise.resolve({ bookingId }) });

describe('clinic appointments API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      tenantId: 'tenant-a', activeBranchId: 4, userId: 7,
      tenant: { activeLocation: { locationId: 'location-a' } },
    });
    mocks.list.mockResolvedValue([]);
    mocks.transition.mockResolvedValue({ bookingId: 19, status: 'in_service', encounterId: 'visit-a' });
  });

  it('requires medical-records entitlement before accessing appointments', async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({ error: 'Denied' }, { status: 403 }));
    expect((await GET(request('/api/clinic/appointments?date=2026-10-26'))).status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
    expect((await POST(request('/api/clinic/appointments/19', { action: 'start' }), ctx('19'))).status).toBe(403);
  });

  it('loads appointments only for session tenant and active branch', async () => {
    const res = await GET(request('/api/clinic/appointments?date=2026-10-26&tenantId=spoof'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.list).toHaveBeenCalledWith({ tenantId: 'tenant-a', branchId: 4, date: '2026-10-26' });
  });

  it('rejects malformed or impossible appointment dates', async () => {
    expect((await GET(request('/api/clinic/appointments?date=2026-02-30'))).status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('rejects invalid IDs and actions before mutations', async () => {
    expect((await POST(request('/api/clinic/appointments/00', { action: 'start' }), ctx('00'))).status).toBe(400);
    expect((await POST(request('/api/clinic/appointments/19', { action: 'cancel' }), ctx('19'))).status).toBe(400);
    expect((await POST(request('/api/clinic/appointments/19', { action: 'start', visitType: 'invalid' }), ctx('19'))).status).toBe(400);
    expect(mocks.transition).not.toHaveBeenCalled();
  });

  it('starts linked encounter with only session tenant, branch and location', async () => {
    const res = await POST(
      request('/api/clinic/appointments/19', { action: 'start', visitType: 'follow_up', branchId: 99 }),
      ctx('19'),
    );
    expect(res.status).toBe(201);
    expect(mocks.transition).toHaveBeenCalledWith({
      tenantId: 'tenant-a', branchId: 4, locationId: 'location-a',
      bookingId: 19, actorUserId: 7, action: 'start', visitType: 'follow_up',
    });
  });

  it('returns a conflict when appointment was cancelled', async () => {
    mocks.transition.mockRejectedValue(new ClinicAppointmentConflict('INVALID_STATE', 'Cancelled'));
    const res = await POST(request('/api/clinic/appointments/19', { action: 'start' }), ctx('19'));
    expect(res.status).toBe(409);
  });

  it('returns 404 for a booking outside this tenant and branch', async () => {
    mocks.transition.mockRejectedValue(new ClinicAppointmentConflict('NOT_FOUND', 'Missing'));
    const res = await POST(request('/api/clinic/appointments/19', { action: 'arrive' }), ctx('19'));
    expect(res.status).toBe(404);
  });

  it('does not expose SQL error messages in HTTP 500 responses', async () => {
    mocks.transition.mockRejectedValue(new Error('SQL secret details'));
    const res = await POST(request('/api/clinic/appointments/19', { action: 'start' }), ctx('19'));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('SQL secret');
  });
});
