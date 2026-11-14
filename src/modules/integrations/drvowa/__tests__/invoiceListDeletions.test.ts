import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const state = vi.hoisted(() => ({
  params: [] as Record<string, unknown>[],
  sql: [] as string[],
  rows: [] as Array<Record<string, unknown>>,
  fail: false,
}));

vi.mock('@/lib/db', () => ({
  sql: {
    Int: 'INT',
    NVarChar: () => 'NVARCHAR',
  },
  getPool: vi.fn(async () => ({
    request: () => {
      const params: Record<string, unknown> = {};
      return {
        input(name: string, _type: unknown, value: unknown) {
          params[name] = value;
          return this;
        },
        async query(query: string) {
          state.params.push({ ...params });
          state.sql.push(query);
          if (state.fail) throw new Error('SQL connection details must not leak');
          return { recordset: state.rows };
        },
      };
    },
  })),
}));

import { executeInvoiceListDeletions } from '../tools/invoiceListDeletions';
import { getDrvowaCrmSyncToolDefinitions, listImplementedDrvowaCrmTools } from '../index';

beforeEach(() => {
  state.params = [];
  state.sql = [];
  state.rows = [];
  state.fail = false;
});

describe('DRVOWA audited hard-deleted sale invoice cursor', () => {
  it('advertises the independent deletion stream as a read-only CRM tool', () => {
    const tool = getDrvowaCrmSyncToolDefinitions()
      .find(t => t.name === 'invoice.list_deletions');
    expect(tool).toMatchObject({ mode: 'READ', approval: 'AUTO' });
    expect(tool?.description).toContain('physically removes a header');
    expect(tool?.inputSchema?.properties).toHaveProperty('sinceAuditId');
    expect(listImplementedDrvowaCrmTools()).toContain('invoice.list_deletions');
  });

  it('returns only cancellation identities from successful committed sale DELETE audits', async () => {
    state.rows = [{ auditId: 71, invId: 5101 }, { auditId: 74, invId: 5124 }];
    const result = await executeInvoiceListDeletions({ sinceAuditId: 70, limit: 2 });
    expect(result).toEqual({
      ok: true,
      tool: 'invoice.list_deletions',
      data: {
        deletions: [
          { auditId: 71, invId: 5101, invType: 'مبيعات', status: 'cancelled', source: 'audited_hard_delete' },
          { auditId: 74, invId: 5124, invType: 'مبيعات', status: 'cancelled', source: 'audited_hard_delete' },
        ],
        cursorSemantics: {
          sinceAuditId: expect.stringContaining('independent of invoice IDs'),
          compositeKey: 'invType+invID',
          limitation: expect.stringContaining('audited DELETE'),
        },
        nextCursor: { sinceAuditId: 74 },
        hasMore: true,
      },
    });
    expect(state.params).toEqual([{
      sinceAuditId: 70, limit: 2, actionType: 'delete_invoice',
      status: 'success', method: 'DELETE',
    }]);
    expect(state.sql[0]).toContain('FROM dbo.TblSensitiveActionAuditLog a WITH (READCOMMITTEDLOCK)');
    expect(state.sql[0]).toContain('a.AuditID > @sinceAuditId');
    expect(state.sql[0]).toContain('a.ExecutionStatus = @status');
    expect(state.sql[0]).toContain('a.EndpointPath LIKE N\'/api/sales/%\'');
    expect(state.sql[0]).toContain('TRY_CONVERT(int, a.EntityID) > 0');
    expect(state.sql[0]).toContain('ORDER BY a.AuditID ASC');
    expect(state.sql[0]).not.toMatch(/SELECT\s+\*/i);
    expect(state.sql[0]).not.toMatch(/OldData|NewData|IPAddress|UserAgent|Reason/);
  });

  it('empty page preserves cursor and never rewinds to invoice ID', async () => {
    const result = await executeInvoiceListDeletions({ sinceAuditId: 95 });
    expect(result.data).toMatchObject({
      deletions: [],
      nextCursor: { sinceAuditId: 95 },
      hasMore: false,
    });
    expect(state.params[0]).toMatchObject({ sinceAuditId: 95, limit: 100 });
  });

  it('rejects negative, fractional and excessively large cursor inputs without SQL', async () => {
    for (const sinceAuditId of [-1, 1.5, '1; DROP TABLE x']) {
      const result = await executeInvoiceListDeletions({ sinceAuditId });
      expect(result.ok).toBe(false);
    }
    expect(state.sql).toHaveLength(0);
  });

  it('hides SQL diagnostics and never exposes the sensitive audit snapshot', async () => {
    state.fail = true;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await executeInvoiceListDeletions({ sinceAuditId: 1 });
      expect(res).toEqual({
        ok: false, tool: 'invoice.list_deletions',
        error: { code: 'INVOICE_DELETIONS_FAILED', message: 'Failed to list invoice deletions' },
      });
      expect(JSON.stringify(res)).not.toContain('SQL connection details');
    } finally {
      log.mockRestore();
    }
  });
});
