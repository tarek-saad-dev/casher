import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({
  calls: [] as Array<{ text: string; params: Record<string, unknown> }>,
  data: [] as Array<Record<string, unknown>[]>,
}));
vi.mock('@/lib/db', () => ({
  sql: {
    Int: 'INT', UniqueIdentifier: 'UUID',
    Request: class FakeRequest {
      params: Record<string, unknown> = {};
      input(name: string, _type: unknown, value: unknown) {
        this.params[name] = value;
        return this;
      }
      async query(text: string) {
        state.calls.push({ text, params: { ...this.params } });
        return { recordset: state.data.shift() ?? [] };
      }
    },
  },
}));

import { assertReferralInvoiceNotMutated } from '@/lib/referrals/referralInvoiceMutationGuard';

const tx = {} as import('mssql').Transaction;
const tenantId = '01234567-89ab-4cde-8fab-0123456789ab';

describe('referral invoice edit/delete guard', () => {
  beforeEach(() => {
    state.calls = [];
    state.data = [];
  });

  it('does not disrupt historical invoice updates before migration 023', async () => {
    state.data = [[{ Ready: 0 }]];
    await expect(assertReferralInvoiceNotMutated(tx, tenantId, 500)).resolves.toBeUndefined();
    expect(state.calls).toHaveLength(1);
  });

  it('allows unrelated invoice updates when no claim matches same tenant and invoice', async () => {
    state.data = [[{ Ready: 1 }], []];
    await expect(assertReferralInvoiceNotMutated(tx, tenantId, 500)).resolves.toBeUndefined();
    expect(state.calls[1]?.text).toContain('WITH (UPDLOCK, HOLDLOCK)');
    expect(state.calls[1]?.text).toContain('TenantId = @tenantId');
    expect(state.calls[1]?.params).toMatchObject({ tenantId, invId: 500 });
  });

  it('blocks edits or deletes of paid invoices referenced by referral claims', async () => {
    state.data = [[{ Ready: 1 }], [{ ClaimID: 700 }]];
    await expect(assertReferralInvoiceNotMutated(tx, tenantId, 500)).rejects.toThrowError(
      expect.objectContaining({ status: 409 }),
    );
  });
});
