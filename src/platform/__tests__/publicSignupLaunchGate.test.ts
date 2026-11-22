/** DRVO Salon signup rollout gate is OFF by default: no Tenant/Owner/Trial write. */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ getPool: vi.fn(), sql: { Int: 'Int', UniqueIdentifier: 'UniqueIdentifier' } }));
vi.mock('@/lib/session', () => ({ createSession: vi.fn() }));
vi.mock('@/platform/publicSignup/service', () => ({
  PublicSignupError: class PublicSignupError extends Error {
    constructor(public code: string, msg: string, public status: number) { super(msg); }
  },
  provisionPublicSignup: vi.fn(),
}));

import { getPool } from '@/lib/db';
import { createSession } from '@/lib/session';
import { provisionPublicSignup } from '@/platform/publicSignup/service';
import { isPublicSignupEnabled, PUBLIC_SIGNUP_DISABLED } from '@/platform/publicSignup/launchGate';
import { POST } from '@/app/api/public/signup/complete/route';

beforeEach(() => {
  vi.stubEnv('DRVO_PUBLIC_SIGNUP_ENABLED', '');
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllEnvs());

describe('DRVO Salon public signup default deny', () => {
  it('requires the exact explicit true value, never a default or truthy non-boolean', () => {
    expect(isPublicSignupEnabled({})).toBe(false);
    expect(isPublicSignupEnabled({ DRVO_PUBLIC_SIGNUP_ENABLED: 'false' })).toBe(false);
    expect(isPublicSignupEnabled({ DRVO_PUBLIC_SIGNUP_ENABLED: '1' })).toBe(false);
    expect(isPublicSignupEnabled({ DRVO_PUBLIC_SIGNUP_ENABLED: 'TRUE' })).toBe(false);
    expect(isPublicSignupEnabled({ DRVO_PUBLIC_SIGNUP_ENABLED: 'true' })).toBe(true);
  });

  it('blocks even malformed request before JSON parsing, DB writes or session creation', async () => {
    const request = {
      json: vi.fn(async () => { throw new Error('should not parse disabled requests'); }),
      headers: new Headers(),
    } as unknown as Request;
    const response = await POST(request);
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ code: PUBLIC_SIGNUP_DISABLED.code });
    expect(request.json).not.toHaveBeenCalled();
    expect(getPool).not.toHaveBeenCalled();
    expect(provisionPublicSignup).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it('a non-true value remains blocked with zero side effects', async () => {
    vi.stubEnv('DRVO_PUBLIC_SIGNUP_ENABLED', 'TRUE');
    const response = await POST({ json: vi.fn() } as unknown as Request);
    expect(response.status).toBe(503);
    expect(getPool).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it('when explicitly enabled, normal input validation resumes (still no DB on bad JSON)', async () => {
    vi.stubEnv('DRVO_PUBLIC_SIGNUP_ENABLED', 'true');
    const request = { json: vi.fn(async () => { throw new Error('invalid'); }) } as unknown as Request;
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'BODY_INVALID' });
    expect(request.json).toHaveBeenCalledTimes(1);
    expect(getPool).not.toHaveBeenCalled();
    expect(provisionPublicSignup).not.toHaveBeenCalled();
  });

  it('public /start is dynamic and never mounts the signup flow when gate is closed', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/app/start/page.tsx'), 'utf8');
    expect(source).toContain("export const dynamic = 'force-dynamic'");
    expect(source).toContain('const signupEnabled = isPublicSignupEnabled();');
    expect(source).toContain('{signupEnabled ? (');
    expect(source).toContain('<PublicSignupFlow />');
    expect(source).toContain('التسجيل العام لسه غير متاح');
  });
});
