/**
 * Route Handler session cookie clearing — mutation allowed here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextResponse } from 'next/server';

describe('GET /api/auth/session clears invalid cookies', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('destroys cookie when verifySessionCookie reports legacy', async () => {
    const destroySession = vi.fn(async () => undefined);
    const readSessionCookie = vi.fn(async () => 'legacy.token');
    vi.doMock('@/lib/session', () => ({
      destroySession,
      getSession: vi.fn(async () => null),
      readSessionCookie,
      verifySessionCookie: vi.fn(async () => ({ ok: false, reason: 'legacy' })),
    }));
    vi.doMock('@/lib/db', () => ({ getUserFriendlyError: (e: unknown) => String(e) }));
    vi.doMock('@/lib/permissions', () => ({ getPermissions: () => [] }));
    vi.doMock('@/lib/permissions-server', () => ({ getUserAccess: vi.fn() }));
    vi.doMock('@/lib/branch/repository', () => ({ getUserActiveStatus: vi.fn() }));
    vi.doMock('@/lib/branch/context', () => ({ getActiveBranchContext: vi.fn() }));
    vi.doMock('@/lib/branch/businessDay', () => ({ getOpenBusinessDay: vi.fn() }));
    vi.doMock('@/lib/branch/shiftSession', () => ({ getUserOpenShift: vi.fn() }));

    const { GET } = await import('@/app/api/auth/session/route');
    const res = await GET();
    expect(res).toBeInstanceOf(NextResponse);
    expect(res.status).toBe(401);
    expect(destroySession).toHaveBeenCalled();
    const body = await res.json();
    expect(body.user).toBeNull();
    expect(body.code).toBe('SESSION_UPGRADE_REQUIRED');
  });

  it('DELETE logout destroys the session cookie', async () => {
    const destroySession = vi.fn(async () => undefined);
    vi.doMock('@/lib/session', () => ({
      destroySession,
      getSession: vi.fn(),
      readSessionCookie: vi.fn(),
      verifySessionCookie: vi.fn(),
    }));
    vi.doMock('@/lib/db', () => ({ getUserFriendlyError: (e: unknown) => String(e) }));
    vi.doMock('@/lib/permissions', () => ({ getPermissions: () => [] }));
    vi.doMock('@/lib/permissions-server', () => ({ getUserAccess: vi.fn() }));
    vi.doMock('@/lib/branch/repository', () => ({ getUserActiveStatus: vi.fn() }));
    vi.doMock('@/lib/branch/context', () => ({ getActiveBranchContext: vi.fn() }));
    vi.doMock('@/lib/branch/businessDay', () => ({ getOpenBusinessDay: vi.fn() }));
    vi.doMock('@/lib/branch/shiftSession', () => ({ getUserOpenShift: vi.fn() }));

    const { DELETE } = await import('@/app/api/auth/session/route');
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(destroySession).toHaveBeenCalled();
  });
});
