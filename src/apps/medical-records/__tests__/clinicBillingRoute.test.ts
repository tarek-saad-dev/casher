import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), preview: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  requireTenantApp: mocks.auth,
  isAuthResult: (v: unknown) => !(v instanceof Response),
}));
vi.mock('../internal/clinicBillingRepository', () => ({
  getClinicBillingPreview: mocks.preview,
}));
import { GET } from '@/app/api/clinic/encounters/[encounterId]/billing/route';

const encounterId = 'f8e4b6ec-118e-42d5-9ae7-f1c6b4d59fd2';
const ctx = (id: string) => ({ params: Promise.resolve({ encounterId: id }) });

describe('clinic billing preview route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      tenantId: 'tenant-1', activeBranchId: 4, userId: 6,
    });
    mocks.preview.mockResolvedValue({
      encounterId, clientId: 19, patientName: 'Patient',
      practitionerEmpId: 8, practitionerName: 'Doctor',
      invoiceId: null, billingState: 'ready', services: [],
    });
  });

  it('enforces medical-records entitlement before loading any financial link', async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({ error: 'Denied' }, { status: 403 }));
    expect((await GET(new NextRequest('http://localhost/test'), ctx(encounterId))).status).toBe(403);
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it('rejects invalid encounter IDs before SQL', async () => {
    expect((await GET(new NextRequest('http://localhost/test'), ctx('12'))).status).toBe(400);
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it('uses only session tenant and branch, never spoofed query-string IDs', async () => {
    const res = await GET(
      new NextRequest('http://localhost/test?tenantId=evil&branchId=99'),
      ctx(encounterId),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.preview).toHaveBeenCalledWith({
      tenantId: 'tenant-1', branchId: 4, encounterId,
    });
  });

  it('returns 404 for a foreign-branch or missing encounter', async () => {
    mocks.preview.mockResolvedValue(null);
    expect((await GET(new NextRequest('http://localhost/test'), ctx(encounterId))).status).toBe(404);
  });

  it('does not leak SQL internal errors to the browser', async () => {
    mocks.preview.mockRejectedValue(new Error('private connection string'));
    const res = await GET(new NextRequest('http://localhost/test'), ctx(encounterId));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('private');
  });
});
