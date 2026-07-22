import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  decodeSessionToken,
  encodeSessionPayload,
  getSessionSecretForTests,
} from '@/lib/session';
import { BRANCH_SESSION_VERSION, type SessionPayload } from '@/lib/session-types';

describe('Phase 1B session encode/decode', () => {
  const prevSecret = process.env.SESSION_SECRET;

  beforeEach(() => {
    process.env.SESSION_SECRET = 'phase1b-test-session-secret-32bytes-min!!';
  });

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = prevSecret;
  });

  function samplePayload(overrides: Partial<SessionPayload> = {}): SessionPayload {
    return {
      UserID: 9,
      UserName: 'Tester',
      UserLevel: 'user',
      ActiveBranchID: 42,
      ActiveBranchCode: 'GLEEM',
      BranchSessionVersion: BRANCH_SESSION_VERSION,
      iat: Math.floor(Date.now() / 1000),
      ...overrides,
    };
  }

  it('encodes and decodes the new branch session payload', () => {
    const payload = samplePayload();
    const token = encodeSessionPayload(payload);
    const decoded = decodeSessionToken(token);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.payload).toEqual(payload);
  });

  it('rejects a tampered signature', () => {
    const token = encodeSessionPayload(samplePayload());
    const [json] = token.split('.');
    const tampered = `${json}.not-a-real-signature`;
    expect(decodeSessionToken(tampered)).toEqual({ ok: false, reason: 'tampered' });
  });

  it('rejects an expired session', () => {
    const token = encodeSessionPayload(
      samplePayload({ iat: Math.floor(Date.now() / 1000) - 100_000 }),
    );
    expect(decodeSessionToken(token)).toEqual({ ok: false, reason: 'expired' });
  });

  it('requires re-login for legacy cookies without branch claims', () => {
    const secret = getSessionSecretForTests();
    const crypto = require('crypto') as typeof import('crypto');
    const legacy = {
      UserID: 1,
      UserName: 'Legacy',
      UserLevel: 'admin',
      iat: Math.floor(Date.now() / 1000),
    };
    const json = Buffer.from(JSON.stringify(legacy)).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(json).digest('base64url');
    const token = `${json}.${sig}`;
    expect(decodeSessionToken(token)).toEqual({ ok: false, reason: 'legacy' });
  });

  it('rejects missing branch claim fields', () => {
    const secret = getSessionSecretForTests();
    const crypto = require('crypto') as typeof import('crypto');
    const partial = {
      UserID: 1,
      UserName: 'X',
      UserLevel: 'user',
      ActiveBranchID: 1,
      iat: Math.floor(Date.now() / 1000),
    };
    const json = Buffer.from(JSON.stringify(partial)).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(json).digest('base64url');
    expect(decodeSessionToken(`${json}.${sig}`)).toEqual({ ok: false, reason: 'legacy' });
  });

  it('rejects unsupported BranchSessionVersion', () => {
    const secret = getSessionSecretForTests();
    const crypto = require('crypto') as typeof import('crypto');
    const bad = {
      ...samplePayload(),
      BranchSessionVersion: 99,
    };
    const json = Buffer.from(JSON.stringify(bad)).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(json).digest('base64url');
    expect(decodeSessionToken(`${json}.${sig}`)).toEqual({
      ok: false,
      reason: 'unsupported_version',
    });
  });

  it('requires explicit SESSION_SECRET in production', () => {
    const env = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;
    expect(() => encodeSessionPayload(samplePayload(), env)).toThrow(
      /SESSION_SECRET must be configured/,
    );
  });
});
