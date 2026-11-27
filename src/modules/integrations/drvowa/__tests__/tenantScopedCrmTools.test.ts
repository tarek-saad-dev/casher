import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const state = vi.hoisted(() => ({
  queries: [] as Array<{sql: string; params: Record<string,unknown>}>,
}));

vi.mock('@/lib/db', () => ({
  sql: {
    Int: 'INT', UniqueIdentifier: 'UUID', NVarChar: () => 'NVARCHAR',
  },
  getPool: vi.fn(async () => ({
    request() {
      const params: Record<string, unknown> = {};
      return {
        input(name: string, _type: unknown, value: unknown) {
          params[name] = value;
          return this;
        },
        async query(query: string) {
          state.queries.push({sql: query, params:{...params}});
          if(query.includes('COL_LENGTH')) return { recordset:[{Len:100}] };
          if(query.includes('FROM dbo.TblClient c')) return {
            recordset:[{ clientId:8, name:'Synthetic client', registerDate:null }],
          };
          if(query.includes('FROM dbo.TblPro p') && query.includes('SELECT TOP')) return {
            recordset:[{proId:9, proName:'Synthetic service', isDeleted:0}],
          };
          if(query.includes('FROM dbo.TblinvServHead h') && query.includes('SELECT TOP')) return {
            recordset:[{
              invId:7001, invType:'مبيعات', branchId:2,
              grandTotal:100, subTotal:100, disVal:0, isActive:'no',
            }],
          };
          if(query.includes('FROM dbo.TblinvServDetail d')) return {
            recordset:[{invId:7001, proId:9, empId:7, qty:1,sPrice:100,sPriceAfterDis:100}],
          };
          return {recordset:[]};
        },
      };
    },
  })),
}));

import { executeCustomerListChanges } from '../tools/customerListChanges';
import { executeCatalogListServices } from '../tools/catalogListServices';
import { executeInvoiceListChanges } from '../tools/invoiceListChanges';
import { executeDrvowaCrmTool } from '../tools';

const tenantId='01234567-89ab-4cde-8fab-0123456789ab';
const outsider='11111111-2222-4333-8444-555555555555';
const context={tenantId};

beforeEach(()=>{state.queries=[]});

function operationalQueries() {
  return state.queries.filter(x=>!x.sql.includes('COL_LENGTH'));
}

describe('DRVOWA ERP CRM sync tenant boundary — all read tools', () => {
  it('never accepts a tenant supplied by the CRM body for customer append and identity sweep', async () => {
    expect((await executeCustomerListChanges(
      {sinceClientId:5, tenantId:outsider},context
    )).ok).toBe(true);
    expect((await executeCustomerListChanges(
      {identitySweep:true,identitySweepSinceClientId:3, tenantId:outsider},context
    )).ok).toBe(true);
    const qs=operationalQueries();
    expect(qs.length).toBeGreaterThanOrEqual(2);
    for (const q of qs) {
      expect(q.sql).toContain('c.TenantId = @tenantId');
      expect(q.params.tenantId).toBe(tenantId);
      expect(q.params.tenantId).not.toBe(outsider);
    }
  });

  it('does not include foreign tenant service catalog/category in either cursor mode', async () => {
    expect((await executeCatalogListServices({sinceProId:0},context)).ok).toBe(true);
    expect((await executeCatalogListServices({
      identitySweep:true,identitySweepSinceProId:50,
    },context)).ok).toBe(true);
    for(const q of operationalQueries()) {
      expect(q.sql).toContain('p.TenantId = @tenantId');
      expect(q.sql).toContain('c.TenantId = @tenantId');
      expect(q.params.tenantId).toBe(tenantId);
    }
  });

  it('scopes invoice headers AND line details through owner Location across append and sweep', async () => {
    const append = await executeInvoiceListChanges({
      sinceInvId:0, includeInactive:true, tenantId:outsider,
    },context);
    expect(append.ok).toBe(true);
    const sweep = await executeInvoiceListChanges({
      statusSweep:true,statusSweepSinceInvId:0, tenantId:outsider,
    },context);
    expect(sweep.ok).toBe(true);

    const heads=operationalQueries().filter(q=>
      q.sql.includes('FROM dbo.TblinvServHead h') &&
      q.sql.includes('SELECT TOP'));
    const details=operationalQueries().filter(q=>
      q.sql.includes('FROM dbo.TblinvServDetail d'));
    expect(heads).toHaveLength(2);
    expect(details).toHaveLength(2);
    for (const q of [...heads,...details]) {
      expect(q.sql).toContain('l.LegacyBranchId = h.BranchID');
      expect(q.sql).toContain('l.TenantId = @tenantId');
      expect(q.params.tenantId).toBe(tenantId);
      expect(q.params.tenantId).not.toBe(outsider);
    }
    for(const q of details) {
      expect(q.sql).toContain('p.TenantId = @tenantId');
      expect(q.sql).toContain('e.TenantId = @tenantId');
    }
  });

  it('dispatcher refuses missing authenticated context BEFORE running any SQL', async () => {
    const bad=await executeDrvowaCrmTool('customer.list_changes',{}, {tenantId:''});
    expect(bad).toMatchObject({ok:false,error:{code:'INVALID_TENANT_CONTEXT'}});
    expect(state.queries).toHaveLength(0);
  });
});
