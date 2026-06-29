import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeAuditedAction, AuditedActionError, isAuditedActionError } from '@/lib/sensitiveActionAudit';
import { sanitizeForAudit } from '@/lib/sensitiveActionSanitize';
import type { SessionUser } from '@/lib/session-types';

// Mock the DB module
let globalFakeResult: Record<string, unknown> | { recordset: unknown[] } = { recordset: [] };

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(),
  sql: {
    Transaction: class FakeTransaction {
      began = false;
      committed = false;
      rolledBack = false;
      async begin() { this.began = true; }
      async commit() { this.committed = true; }
      async rollback() { this.rolledBack = true; }
    },
    Request: class FakeRequest {
      inputs: Record<string, unknown> = {};
      constructor(private transaction?: unknown) {}
      input(name: string, _type: unknown, value: unknown) {
        this.inputs[name] = value;
        return this;
      }
      async query() {
        return globalFakeResult ?? { recordset: [] };
      }
      setResult(result: Record<string, unknown> | { recordset: unknown[] }) {
        globalFakeResult = result;
      }
    },
    ISOLATION_LEVEL: { SERIALIZABLE: 'serializable' },
    NVarChar: (n?: number | string) => ({ type: 'nvarchar', length: n }),
    Int: () => ({ type: 'int' }),
    BigInt: () => ({ type: 'bigint' }),
    DateTime2: () => ({ type: 'datetime2' }),
    Decimal: () => ({ type: 'decimal' }),
    MAX: -1,
  },
}));

vi.mock('@/lib/permissions-server', () => ({
  getUserAccess: vi.fn().mockResolvedValue({
    isSuperAdmin: true,
    roles: ['admin', 'super_admin'],
  }),
}));

const mockUser: SessionUser = {
  UserID: 1,
  UserName: 'admin',
  UserLevel: 'admin',
};

interface FakeRequestHandle {
  inputs: Record<string, unknown>;
  input(name: string, type: unknown, value: unknown): FakeRequestHandle;
  query(sql: string): Promise<unknown>;
  setResult(result: unknown): void;
}

async function runWithFakeRequest(mutator: (req: FakeRequestHandle) => void) {
  const { getPool, sql } = await import('@/lib/db');
  const fakePool: Record<string, unknown> = { request: () => new sql.Request() };
  (getPool as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(fakePool);
  // Seed the global fake result so all requests (including audit inserts) return it.
  const seed = new sql.Request() as unknown as FakeRequestHandle;
  mutator(seed);
  return { getPool, sql, fakePool };
}

describe('executeAuditedAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalFakeResult = { recordset: [] };
  });

  it('executes once, audits once, and commits once', async () => {
    const execute = vi.fn().mockResolvedValue('result');
    await runWithFakeRequest((req) =>
      req.setResult({ recordset: [{ AuditID: 42 }] })
    );

    const result = await executeAuditedAction({
      actionType: 'edit_expense',
      user: mockUser,
      entityId: 1,
      reason: 'test reason',
      execute,
      loadOldData: async () => ({ amount: 100 }),
      loadNewData: async () => ({ amount: 200 }),
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.auditId).toBe(42);
    expect(result.data).toBe('result');
  });

  it('rejects missing reason for critical actions', async () => {
    await runWithFakeRequest(() => {});
    await expect(
      executeAuditedAction({
        actionType: 'delete_invoice',
        user: mockUser,
        entityId: 1,
        reason: '  ',
        execute: vi.fn(),
      })
    ).rejects.toThrow('تتطلب سبباً');
  });

  it('rejects whitespace-only reason', async () => {
    await runWithFakeRequest(() => {});
    await expect(
      executeAuditedAction({
        actionType: 'delete_expense',
        user: mockUser,
        entityId: 1,
        reason: '   \t\n  ',
        execute: vi.fn(),
      })
    ).rejects.toThrow('تتطلب سبباً');
  });

  it('rolls back and records failed audit on execute error', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('business failure'));
    await runWithFakeRequest((req) =>
      req.setResult({ recordset: [{ AuditID: 99 }] })
    );

    await expect(
      executeAuditedAction({
        actionType: 'edit_expense',
        user: mockUser,
        entityId: 1,
        reason: 'test',
        execute,
      })
    ).rejects.toSatisfy((err: unknown) => {
      expect(isAuditedActionError(err)).toBe(true);
      const audited = err as AuditedActionError;
      expect(audited.failedAuditId).toBe(99);
      return audited.message === 'business failure';
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('sanitizes SQL leak errors in the public message', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('ConnectionError: Login failed for user'));
    await runWithFakeRequest((req) =>
      req.setResult({ recordset: [{ AuditID: 55 }] })
    );

    await expect(
      executeAuditedAction({
        actionType: 'edit_expense',
        user: mockUser,
        entityId: 1,
        reason: 'test',
        execute,
      })
    ).rejects.toSatisfy((err: unknown) => {
      expect(isAuditedActionError(err)).toBe(true);
      const audited = err as AuditedActionError;
      expect(audited.message).toContain('خطأ تقني');
      expect(audited.message).not.toContain('Login failed');
      return true;
    });
  });

  it('masks sensitive data in audit JSON', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true });
    const sanitizeSpy = vi.spyOn(await import('@/lib/sensitiveActionSanitize'), 'sanitizeForAudit');
    await runWithFakeRequest((req) => req.setResult({ recordset: [{ AuditID: 77 }] }));

    await executeAuditedAction({
      actionType: 'edit_expense',
      user: mockUser,
      entityId: 1,
      reason: 'test',
      execute,
      loadOldData: async () => ({ amount: 100, password: 'secret' }),
      loadNewData: async () => ({ amount: 200, password: 'secret' }),
    });

    expect(sanitizeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ password: 'secret' }),
      expect.any(Array),
    );
    const redacted = sanitizeForAudit({ amount: 100, password: 'secret' });
    expect(redacted).toEqual({ amount: 100, password: '***REDACTED***' });
  });

  it('runs execute before audit insert and commit in order', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    await runWithFakeRequest((req) => req.setResult({ recordset: [{ AuditID: 42 }] }));

    await executeAuditedAction({
      actionType: 'edit_expense',
      user: mockUser,
      entityId: 1,
      reason: 'test reason',
      execute,
    });

    const steps = infoSpy.mock.calls
      .map((call) => (call[1] as { step?: string } | undefined)?.step)
      .filter((step): step is string => Boolean(step));

    expect(steps.indexOf('execute:complete')).toBeLessThan(steps.indexOf('audit-insert:start'));
    expect(steps.indexOf('audit-insert:complete')).toBeLessThan(steps.indexOf('commit:start'));
    infoSpy.mockRestore();
  });

  it('writes failed audit only after rollback using pool connection', async () => {
    const execute = vi.fn(async () => {
      throw new Error('business failure');
    });
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const { sql } = await runWithFakeRequest((req) => req.setResult({ recordset: [{ AuditID: 99 }] }));

    const poolRequestConstructors: boolean[] = [];
    const OriginalRequest = sql.Request;
    sql.Request = class PoolTrackingRequest extends OriginalRequest {
      constructor(connection?: unknown) {
        super(connection as never);
        poolRequestConstructors.push(!(connection instanceof sql.Transaction));
      }
    } as unknown as typeof sql.Request;

    await expect(
      executeAuditedAction({
        actionType: 'edit_expense',
        user: mockUser,
        entityId: 1,
        reason: 'test',
        execute,
      })
    ).rejects.toThrow();

    const steps = infoSpy.mock.calls
      .map((call) => (call[1] as { step?: string } | undefined)?.step)
      .filter((step): step is string => Boolean(step));

    expect(steps.indexOf('rollback:start')).toBeGreaterThan(steps.indexOf('execute:start'));
    expect(poolRequestConstructors.some((isPool) => isPool)).toBe(true);
    infoSpy.mockRestore();
  });
});
