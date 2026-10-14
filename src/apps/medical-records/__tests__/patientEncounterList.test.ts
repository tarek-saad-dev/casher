import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ requireTenantApp: mocks.auth, isAuthResult: (value: unknown) => !(value instanceof Response) }));
vi.mock('../internal/repository', () => ({ listPatientEncounters: mocks.list, openEncounter: vi.fn() }));
import * as routes from '@/app/api/clinic/encounters/route';

describe('patient encounter list', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ tenantId: 'tenant-a' }); mocks.list.mockResolvedValue([]); });
  it('reads encounter metadata using authenticated tenant and selected patient', async () => {
    const response = await routes.GET(new NextRequest('http://localhost/api/clinic/encounters?clientId=5&tenantId=tenant-b'));
    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith('tenant-a', 5);
  });
  it.each(['', '0', '-1', 'not-a-number', '1.5'])('rejects invalid clientId %j before repository access', async (clientId) => {
    expect((await routes.GET(new NextRequest(`http://localhost/api/clinic/encounters?clientId=${clientId}`))).status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
