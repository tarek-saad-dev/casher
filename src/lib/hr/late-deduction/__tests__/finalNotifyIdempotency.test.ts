import { describe, expect, it, vi } from 'vitest';

describe('final WhatsApp notification claim helpers', () => {
  it('claimFinalNotified returns true only when NotifiedFinalAt was null', async () => {
    const query = vi.fn(async () => ({ rowsAffected: [1] }));
    const db = {
      request: () => ({
        input() {
          return this;
        },
        query,
      }),
    };
    vi.resetModules();
    vi.doMock('@/lib/db', () => ({
      sql: { Int: 'int' },
    }));
    const { claimFinalNotified, releaseFinalNotified } = await import('../repository');
    await expect(claimFinalNotified(db as never, 42)).resolves.toBe(true);

    query.mockResolvedValueOnce({ rowsAffected: [0] });
    await expect(claimFinalNotified(db as never, 42)).resolves.toBe(false);

    query.mockResolvedValueOnce({ rowsAffected: [1] });
    await expect(releaseFinalNotified(db as never, 42)).resolves.toBeUndefined();
    expect(String(query.mock.calls.at(-1)?.[0] ?? '')).toContain('NotifiedFinalAt = NULL');
  });
});
