import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  queries: [] as string[],
  commits: 0,
  rollbacks: 0,
  auditRows: [] as Array<Record<string, unknown>>,
  entitlement: null as null | { Status: string; ValidUntilUtc: Date | null },
  tenantFound: true,
  grant: true,
  failAudit: false,
}));

vi.mock('server-only', () => ({}));
vi.mock('mssql', () => ({
  Transaction: class {
    async begin() {}
    request() {
      const inputs: Record<string, unknown> = {};
      return {
        input(name: string, _type: unknown, value: unknown) {
          inputs[name] = value;
          return this;
        },
        async query(query: string) {
          state.queries.push(query);
          if (query.includes('DB_NAME()')) return { recordset: [{ DatabaseName: 'last132_agent' }] };
          if (query.includes('DrvoPlatformOperatorGrant')) {
            return { recordset: state.grant ? [{ PermissionKey: 'platform.entitlements.manage' }] : [] };
          }
          if (query.includes('sp_getapplock')) return { recordset: [{ LockResult: 0 }] };
          if (query.includes('DrvoModuleEntitlementAudit WITH')) {
            return { recordset: state.auditRows.filter(row => row.RequestId === inputs.requestId) };
          }
          if (query.includes('FROM dbo.Tenant WITH')) {
            return { recordset: state.tenantFound ? [{ TenantId: inputs.tenantId }] : [] };
          }
          if (query.includes('FROM dbo.DrvoTenantModuleEntitlement')) {
            return { recordset: state.entitlement ? [state.entitlement] : [] };
          }
          if (query.includes('UPDATE dbo.DrvoTenantModuleEntitlement')) {
            state.entitlement = {
              Status: String(inputs.status),
              ValidUntilUtc: inputs.validUntil as Date | null,
            };
            return { recordset: [] };
          }
          if (query.includes('INSERT dbo.DrvoModuleEntitlementAudit')) {
            if (state.failAudit) throw new Error('AUDIT_INSERT_FAILED');
            state.auditRows.push({
              RequestId: inputs.requestId,
              TenantId: inputs.tenantId,
              ModuleKey: inputs.moduleKey,
              Action: inputs.action,
              ActorUserId: inputs.actor,
              NewStatus: inputs.newStatus,
              NewValidUntilUtc: inputs.newExpiry,
            });
            return { recordset: [] };
          }
          throw new Error('UNEXPECTED_SQL_QUERY');
        },
      };
    }
    async commit() { state.commits++; }
    async rollback() { state.rollbacks++; }
  },
}));
vi.mock('@/lib/db', () => ({
  getPool: async () => ({}),
  sql: {
    ISOLATION_LEVEL: { SERIALIZABLE: 'SERIALIZABLE' },
    UniqueIdentifier: 'uuid',
    NVarChar: () => 'nvarchar',
    DateTime2: () => 'datetime2',
    Int: 'int',
  },
}));

import { applyCommercialEntitlementCommand } from './commercialEntitlementService';

const base = {
  tenantId: '083d433e-f36b-1410-8820-009ec495c7e1',
  moduleKey: 'booking',
  requestId: 'a05d433e-f36b-1410-8820-009ec495c7e1',
  action: 'provision' as const,
  validUntilUtc: '2099-11-16T00:00:00Z',
};
const keys = ['DRVO_STAGING_MODE','STAGING_SAFETY_ENFORCE','STAGING_SAFETY_DB_NAME','DB_NAME','DB_DATABASE','DB_USER'] as const;
const previous = Object.fromEntries(keys.map(k => [k, process.env[k]]));
beforeEach(() => {
  state.queries.length = 0;
  state.auditRows.length = 0;
  state.commits = 0;
  state.rollbacks = 0;
  state.entitlement = null;
  state.tenantFound = true;
  state.grant = true;
  state.failAudit = false;
  Object.assign(process.env, {
    DRVO_STAGING_MODE: 'true',
    STAGING_SAFETY_ENFORCE: 'true',
    STAGING_SAFETY_DB_NAME: 'last132_agent',
    DB_NAME: 'last132_agent',
    DB_DATABASE: 'last132_agent',
    DB_USER: 'drvo_agent',
  });
});
afterEach(() => {
  for (const k of keys) {
    if (previous[k] === undefined) delete process.env[k];
    else process.env[k] = previous[k];
  }
});
describe('commercial service transactional contract (mock SQL; not a real DB integration test)', () => {
  it('fails closed without staging mode before querying SQL', async () => {
    delete process.env.DRVO_STAGING_MODE;
    await expect(applyCommercialEntitlementCommand(13, base)).rejects.toThrow('COMMERCIAL_MUTATIONS_STAGING_ONLY');
    expect(state.queries).toHaveLength(0);
  });
  it('records one audit and returns replay without another write', async () => {
    const first = await applyCommercialEntitlementCommand(13, base);
    const replay = await applyCommercialEntitlementCommand(13, base);
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(state.auditRows).toHaveLength(1);
    expect(state.queries.filter(q => q.includes('UPDATE dbo.DrvoTenantModuleEntitlement'))).toHaveLength(1);
  });
  it('rejects reuse of requestId with different payload', async () => {
    await applyCommercialEntitlementCommand(13, base);
    await expect(applyCommercialEntitlementCommand(13, { ...base, moduleKey: 'pos' }))
      .rejects.toThrow('IDEMPOTENCY_KEY_REUSED');
    expect(state.auditRows).toHaveLength(1);
  });
  it('rejects non-platform actors before acquiring commercial lock', async () => {
    state.grant = false;
    await expect(applyCommercialEntitlementCommand(13, base))
      .rejects.toThrow('PLATFORM_ENTITLEMENT_MANAGE_DENIED');
    expect(state.queries.some(q => q.includes('sp_getapplock'))).toBe(false);
  });
  it('rolls back when audit insert fails', async () => {
    state.failAudit = true;
    await expect(applyCommercialEntitlementCommand(13, base)).rejects.toThrow('AUDIT_INSERT_FAILED');
    expect(state.rollbacks).toBe(1);
    expect(state.commits).toBe(0);
  });
});
