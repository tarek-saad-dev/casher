import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from 'mssql';

vi.mock('server-only', () => ({}));

const state = vi.hoisted(() => ({
  results: [] as Array<Array<Record<string, unknown>>>,
  calls: [] as Array<{ query: string; params: Record<string, unknown> }>,
}));
vi.mock('@/lib/db', () => ({
  sql: {
    UniqueIdentifier: 'UUID',
    Int: 'INT',
    NVarChar: (_size: number) => 'NVARCHAR',
    Request: class MockRequest {
      params: Record<string, unknown> = {};
      input(name: string, _type: unknown, value: unknown) {
        this.params[name] = value;
        return this;
      }
      async query(query: string) {
        state.calls.push({ query, params: { ...this.params } });
        return { recordset: state.results.shift() ?? [] };
      }
    },
  },
}));

import {
  activateCustomerReferralCodeInSale,
  ReferralActivationDeniedError,
} from '@/lib/referrals/referralCodeActivation.service';

const tx = {} as Transaction;
const input = {
  tenantId: '01234567-89ab-4cde-8fab-0123456789ab',
  referrerClientId: 12,
  invId: 555,
  invType: 'مبيعات' as const,
};

describe('transaction-bound permanent code activation', () => {
  beforeEach(() => {
    state.calls = [];
    state.results = [];
  });

  it('refuses unpaid or foreign-client invoices without writing a code', async () => {
    state.results = [[]];
    await expect(activateCustomerReferralCodeInSale(tx, input))
      .rejects.toBeInstanceOf(ReferralActivationDeniedError);
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]!.params).toMatchObject({
      tenantId: input.tenantId, clientId: 12, invId: 555,
    });
    expect(state.calls[0]!.query).toContain('WITH (UPDLOCK, HOLDLOCK)');
    expect(state.calls[0]!.query).toContain('c.TenantId = @tenantId');
    expect(state.calls[0]!.query).toContain('h.Payment >= h.GrandTotal');
    expect(state.calls[0]!.query).toContain(
      'l.LegacyBranchId = h.BranchID AND l.TenantId = @tenantId',
    );
  });

  it('creates exactly one code for the first confirmed paid sale in the transaction', async () => {
    state.results = [[{ ClientID: 12 }], [], []];
    const code = await activateCustomerReferralCodeInSale(tx, input);
    expect(code).toMatch(/^CUT-[0-9A-F]{24}$/);
    expect(state.calls).toHaveLength(3);
    expect(state.calls[2]!.query).toContain('INSERT INTO dbo.TblReferralCustomerCode');
    expect(state.calls[2]!.params).toMatchObject({ tenantId: input.tenantId, clientId: 12, code });
  });

  it('returns the same permanent code without reissuing if it already exists', async () => {
    const code = 'CUT-ABCDEF0123456789ABCDEF01';
    state.results = [[{ ClientID: 12 }], [{ Code: code, ActivatedAtUtc: new Date() }]];
    expect(await activateCustomerReferralCodeInSale(tx, input)).toBe(code);
    expect(state.calls).toHaveLength(2);
    expect(state.calls[1]!.query).toContain('WITH (UPDLOCK, HOLDLOCK)');
  });

  it('activates a precreated but inactive code without replacing it', async () => {
    const code = 'CUT-ABCDEF0123456789ABCDEF01';
    state.results = [[{ ClientID: 12 }], [{ Code: code, ActivatedAtUtc: null }], []];
    expect(await activateCustomerReferralCodeInSale(tx, input)).toBe(code);
    expect(state.calls).toHaveLength(3);
    expect(state.calls[2]!.query).toContain('SET ActivatedAtUtc = SYSUTCDATETIME()');
  });

  it('rejects malformed invoice IDs rather than relying on SQL type coercion', async () => {
    await expect(activateCustomerReferralCodeInSale(tx, { ...input, invId: 0 }))
      .rejects.toBeInstanceOf(ReferralActivationDeniedError);
    expect(state.calls).toHaveLength(0);
  });
});
