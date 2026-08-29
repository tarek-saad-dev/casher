import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
const request = vi.fn(() => ({ input: vi.fn().mockReturnThis(), query }));

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(async () => ({ request })),
  sql: {
    Int: 'Int',
    BigInt: 'BigInt',
    NVarChar: () => 'NVarChar',
    Bit: 'Bit',
    Decimal: () => 'Decimal',
    MAX: 'MAX',
    Transaction: class {
      constructor() {}
      begin() {
        return Promise.resolve();
      }
      commit() {
        return Promise.resolve();
      }
      rollback() {
        return Promise.resolve();
      }
    },
  },
}));

import { recoverStaleAiProcessing } from '@/modules/messaging/ai/infra/aiTurnRepository';

describe('recoverStaleAiProcessing', () => {
  beforeEach(() => {
    query.mockReset();
    request.mockClear();
    query.mockResolvedValue({ recordset: [{ requeued: 1, failed: 0 }] });
  });

  it('increments RetryCount when requeueing stale processing turns', async () => {
    const result = await recoverStaleAiProcessing({ staleMs: 120_000 });
    expect(result).toEqual({ requeued: 1, failed: 0 });

    const sqlText = String(query.mock.calls[0]?.[0] ?? '');
    expect(sqlText).toMatch(/\[RetryCount\]\s*=\s*t\.\[RetryCount\]\s*\+\s*1/i);
    expect(sqlText).toMatch(/stale_processing_recovered/i);
    expect(sqlText).toMatch(/RetryCount\]\s*<\s*t\.\[MaxRetries\]/i);
    expect(sqlText).toMatch(/RetryCount\]\s*>=\s*t\.\[MaxRetries\]/i);
  });
});
