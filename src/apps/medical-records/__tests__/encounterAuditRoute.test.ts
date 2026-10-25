import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), actor: vi.fn(), list: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({
  requireTenantApp: mocks.auth,
  isAuthResult: (value: unknown) => !(value instanceof Response),
}));
vi.mock('../internal/repository', () => ({ resolveClinicalActorForUser: mocks.actor }));
vi.mock('../internal/encounterAuditRepository', () => ({ listEncounterAuditForClinician: mocks.list }));

import { GET } from '@/app/api/clinic/encounters/[encounterId]/audit/route';

const TENANT = 'e1b7fbd4-bb5b-470e-966f-99f68588e6cd';
const OTHER_TENANT = 'dfe6d16e-4af5-4f22-b197-5a30c53c32b7';
const ENCOUNTER = 'bce7f7d8-952a-4fa0-829f-f27f364aa9cd';

function request(params = '') {
  return new NextRequest(`http://localhost/api/clinic/encounters/${ENCOUNTER}/audit${params}`);
}
function context(encounterId = ENCOUNTER) {
  return { params: Promise.resolve({ encounterId }) };
}

describe('clinic encounter audit route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ tenantId: TENANT, userId: 7 });
    mocks.actor.mockResolvedValue({ kind: 'human', userId: 7, empId: 12 });
    mocks.list.mockResolvedValue([
      { auditId: 3, action: 'completed', actorUserId: 7, createdAt: '2026-10-25T00:00:00Z' },
    ]);
  });

  it('uses authoritative tenant and clinician identity and disables caching', async () => {
    const res = await GET(request(`?tenantId=${OTHER_TENANT}&practitionerEmpId=99`), context());
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(mocks.auth).toHaveBeenCalledWith('medical-records');
    expect(mocks.actor).toHaveBeenCalledWith(TENANT, 7);
    expect(mocks.list).toHaveBeenCalledWith({
      tenantId: TENANT, encounterId: ENCOUNTER, actor: { kind: 'human', userId: 7, empId: 12 },
    });
    expect((await res.json()).events).toHaveLength(1);
  });

  it.each([
    null,
    { kind: 'ai', agentId: 'assistant' },
    { kind: 'human', userId: 8, empId: 12 },
    { kind: 'human', userId: 7, empId: 0 },
  ])('does not reveal whether a visit exists to an unauthorized clinical actor (%j)', async (actor) => {
    mocks.actor.mockResolvedValue(actor);
    const res = await GET(request(), context());
    expect(res.status).toBe(404);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ error: 'غير موجود', code: 'NOT_FOUND' });
  });

  it('maps another tenant, another doctor, or missing encounter to the same 404', async () => {
    mocks.list.mockResolvedValue(null);
    const res = await GET(request(), context());
    expect(res.status).toBe(404);
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await res.json())).not.toContain(OTHER_TENANT);
  });

  it.each(['invalid', '00000000-0000-0000-0000-00000000000z', ''])(
    'rejects malformed encounter identifiers before clinical database calls (%j)',
    async (id) => {
      const res = await GET(request(), context(id));
      expect(res.status).toBe(404);
      expect(mocks.actor).not.toHaveBeenCalled();
      expect(mocks.list).not.toHaveBeenCalled();
    },
  );

  it('requires authentication plus the installed medical-records app', async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({ code: 'SESSION_REQUIRED' }, { status: 401 }));
    const res = await GET(request(), context());
    expect(res.status).toBe(401);
    expect(mocks.actor).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('fails closed if the audit transaction fails without exposing SQL error details', async () => {
    mocks.list.mockRejectedValue(new Error('Sensitive internal SQL details'));
    const res = await GET(request(), context());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('Sensitive internal SQL');
    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });
});
