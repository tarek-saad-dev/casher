import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRequestQuery, mockRequestInput } = vi.hoisted(() => {
  let q = vi.fn();
  let i = vi.fn();
  return {
    mockRequestQuery: q,
    mockRequestInput: i,
  };
});

// Mock mssql so that @/lib/db's allocateInvID uses the mocked Request
vi.mock('mssql', () => ({
  default: {
    Request: class FakeRequest {
      input(name: string, _type: any, value: any) {
        mockRequestInput(name, _type, value);
        return this;
      }
      async query(q?: string) {
        return mockRequestQuery(q);
      }
    },
    Transaction: vi.fn(),
    ISOLATION_LEVEL: { SERIALIZABLE: 'SERIALIZABLE' },
    NVarChar: vi.fn((n: number) => ({ type: 'nvarchar', length: n })),
    Int: vi.fn(() => ({ type: 'int' })),
  },
}));

import { allocateInvID } from '@/lib/db';

describe('allocateInvID', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestQuery.mockReset();
    mockRequestInput.mockReset().mockReturnThis();
  });

  it('returns next invID when lock is acquired successfully', async () => {
    mockRequestQuery
      .mockResolvedValueOnce({ recordset: [{ lockResult: 0 }] })
      .mockResolvedValueOnce({ recordset: [{ newInvID: 43 }] });

    const tx = {} as any;
    const result = await allocateInvID(tx, 'TblCashMove', 'مصروفات', 5000);
    expect(result).toBe(43);
    expect(mockRequestQuery).toHaveBeenCalledTimes(2);
  });

  it('throws TREASURY_BUSY with statusCode 503 when lock acquisition fails', async () => {
    mockRequestQuery.mockResolvedValueOnce({ recordset: [{ lockResult: -1 }] });

    let caught: unknown;
    try {
      await allocateInvID({} as any, 'TblCashMove', 'مصروفات', 5000);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as any).code).toBe('TREASURY_BUSY');
    expect((caught as any).statusCode).toBe(503);
  });

  it('throws for invalid table name', async () => {
    let caught: unknown;
    try {
      await allocateInvID({} as any, 'UnknownTable' as any, 'مصروفات', 5000);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('Invalid invoice table');
  });

  it('uses distinct lock resources for different invTypes', async () => {
    mockRequestQuery
      .mockResolvedValueOnce({ recordset: [{ lockResult: 0 }] })
      .mockResolvedValueOnce({ recordset: [{ newInvID: 100 }] })
      .mockResolvedValueOnce({ recordset: [{ lockResult: 0 }] })
      .mockResolvedValueOnce({ recordset: [{ newInvID: 200 }] });

    const tx = {} as any;
    const expenseId = await allocateInvID(tx, 'TblCashMove', 'مصروفات', 5000);
    const incomeId = await allocateInvID(tx, 'TblCashMove', 'ايرادات', 5000);

    expect(expenseId).toBe(100);
    expect(incomeId).toBe(200);

    // Verify distinct input values for lock resources
    const lockInputCalls = mockRequestInput.mock.calls.filter((c) =>
      (c[0] as string) === 'lockResource'
    );
    expect(lockInputCalls.length).toBe(2);
    expect(lockInputCalls[0][1]).not.toBe(lockInputCalls[1][1]);
  });
});
