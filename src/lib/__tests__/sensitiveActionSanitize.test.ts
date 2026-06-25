import { describe, it, expect } from 'vitest';
import { sanitizeForAudit, MASKED_VALUE } from '@/lib/sensitiveActionSanitize';

describe('sanitizeForAudit', () => {
  it('passes through primitives', () => {
    expect(sanitizeForAudit('text')).toBe('text');
    expect(sanitizeForAudit(42)).toBe(42);
    expect(sanitizeForAudit(true)).toBe(true);
    expect(sanitizeForAudit(null)).toBe(null);
    expect(sanitizeForAudit(undefined)).toBe(undefined);
  });

  it('masks sensitive keys at the top level', () => {
    const input = {
      userId: 1,
      password: 'secret123',
      token: 'abc.def.ghi',
      authorization: 'Bearer xxx',
      connectionString: 'Server=...',
    };
    expect(sanitizeForAudit(input)).toEqual({
      userId: 1,
      password: MASKED_VALUE,
      token: MASKED_VALUE,
      authorization: MASKED_VALUE,
      connectionString: MASKED_VALUE,
    });
  });

  it('masks sensitive keys recursively in nested objects', () => {
    const input = {
      user: {
        name: 'Ali',
        credentials: {
          password: 'p@ss',
          apiKey: 'key',
        },
      },
      authSession: {
        refreshToken: 'rt',
        idToken: 'idt',
      },
    };
    const result = sanitizeForAudit(input) as Record<string, unknown>;
    const user = result.user as Record<string, unknown>;
    const credentials = user.credentials as Record<string, unknown>;
    const authSession = result.authSession as Record<string, unknown>;
    expect(credentials.password).toBe(MASKED_VALUE);
    expect(credentials.apiKey).toBe(MASKED_VALUE);
    expect(authSession.refreshToken).toBe(MASKED_VALUE);
    expect(authSession.idToken).toBe(MASKED_VALUE);
    expect(user.name).toBe('Ali');
  });

  it('masks sensitive keys inside arrays', () => {
    const input = [
      { userId: 1, password: 'a' },
      { userId: 2, token: 'b' },
    ];
    const result = sanitizeForAudit(input) as Record<string, unknown>[];
    expect(result[0].password).toBe(MASKED_VALUE);
    expect(result[1].token).toBe(MASKED_VALUE);
  });

  it('handles extra sensitive keys from the registry', () => {
    const input = {
      customSecret: 'hide-me',
      visible: 'show-me',
    };
    const result = sanitizeForAudit(input, ['customSecret']) as Record<string, unknown>;
    expect(result.customSecret).toBe(MASKED_VALUE);
    expect(result.visible).toBe('show-me');
  });

  it('converts dates to ISO strings', () => {
    const d = new Date('2026-01-15T10:00:00Z');
    expect(sanitizeForAudit(d)).toBe(d.toISOString());
  });

  it('replaces circular references with [Circular]', () => {
    const a = { name: 'a' } as { name: string; self?: unknown };
    a.self = a;
    const result = sanitizeForAudit(a) as Record<string, unknown>;
    expect(result.name).toBe('a');
    expect(result.self).toBe('[Circular]');
  });
});
