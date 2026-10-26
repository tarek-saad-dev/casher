import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => {
  const query = vi.fn();
  const input = vi.fn();
  const request = { input, query }; input.mockReturnValue(request);
  return { query, request, auth: vi.fn(), register: vi.fn(), assignment: vi.fn(), create: vi.fn() };
});
vi.mock('@/lib/api-auth', () => ({ requireTenantApp: mocks.auth, requireAdmin: mocks.auth, withTenantApp: (_app: string, pending: Promise<unknown>) => pending, isAuthResult: (value: unknown) => !(value instanceof Response) }));
vi.mock('@/lib/db', () => ({ getPool: async () => ({ request: () => mocks.request }), sql: { UniqueIdentifier: 'uuid', Int: 'int', NVarChar: () => 'text' } }));
vi.mock('@/lib/branch/assignmentIntegrity', () => ({ ensureEmployeeBranchAssignment: mocks.assignment }));
vi.mock('@/lib/booking/publicBookingBarbers', () => ({ invalidatePublicBookingBarbersCache: vi.fn() }));
vi.mock('@/lib/hr/tenantEmployeeCreate', () => ({ createTenantEmployee: mocks.create }));
vi.mock('../internal/repository', () => ({ registerClinicPractitioner: mocks.register }));
import { POST } from '@/app/api/clinic/practitioners/route';

function req(body: unknown) { return new NextRequest('http://localhost/api/clinic/practitioners', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }

describe('administrator practitioner linking', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ tenantId: 'tenant-a', userId: 7, activeBranchId: 3 }); mocks.query.mockResolvedValue({ recordset: [{ EmpID: 12, Job: 'طبيب' }] }); });
  it('allows admin to link an existing staff login to its doctor identity', async () => {
    const response = await POST(req({ name: 'Doctor A', userId: 24 }));
    expect(response.status).toBe(200);
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a', empId: 12, userId: 24, actorUserId: 7 }));
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('stores optional specialization in the existing clinical practitioner record', async () => {
    const response = await POST(req({ name: 'Doctor A', userId: 24, specialty: 'باطنة' }));
    expect(response.status).toBe(200);
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ specialty: 'باطنة' }));
  });
  it.each([{ specialty: ['باطنة'] }, { specialty: 'x'.repeat(121) }])('rejects malformed specializations', async (extra) => {
    expect((await POST(req({ name: 'Doctor A', ...extra }))).status).toBe(400);
    expect(mocks.register).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, 'invalid'])('rejects invalid target login %j', async (userId) => {
    expect((await POST(req({ name: 'Doctor A', userId }))).status).toBe(400);
    expect(mocks.register).not.toHaveBeenCalled();
  });
});
