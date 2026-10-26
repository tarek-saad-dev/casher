import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

const fx = vi.hoisted(() => ({
  statements: [] as Array<{ sql: string; inputs: Record<string, unknown> }>,
  committed: 0, rolledBack: 0, alreadyPending: null as Record<string, unknown> | null,
  currentRevision: 3, inserted: false,
  outbox: [] as Record<string, unknown>[],
}));
const TENANT='11111111-1111-4111-8111-111111111111';
vi.mock('@/lib/db', () => {
  class Req {
    inputs: Record<string, unknown> = {};
    input(key:string, type:unknown, value?:unknown) { this.inputs[key] = arguments.length === 3 ? value : type; return this; }
    async query(sql: string) {
      fx.statements.push({sql,inputs:{...this.inputs}});
      if(sql.includes('FROM dbo.TenantSubscription')) return { recordset: [{
        TenantId:TENANT,PlanCode:'starter',Status:'trial',Origin:'onboarding',
        TrialStartedAt:null,TrialEndsAt:new Date('2026-11-01'),CurrentPeriodEndsAt:null,
        PastDueSince:null,SuspendedAt:null,CancelledAt:null,Revision:fx.currentRevision,
      }] };
      if(sql.includes('FROM dbo.SaaSPlan')) return { recordset: [{
        PlanCode:'growth',DisplayName:'Growth',IsPublic:1,IsActive:1,SortOrder:20,
        MaxBranches:3,MaxUsers:20,TrialDays:14,PastDueGraceDays:7,
      }] };
      if(sql.includes('FROM dbo.TenantPlanChangeRequest WITH (UPDLOCK')) return {recordset:fx.alreadyPending?[fx.alreadyPending]:[]};
      if(sql.includes('INSERT INTO dbo.TenantPlanChangeRequest')) {
        fx.inserted=true;
        return {recordset:[{
          RequestId:this.inputs.requestId,TenantId:this.inputs.tenantId,
          FromPlanCode:this.inputs.fromPlan,RequestedPlanCode:this.inputs.planCode,
          BillingCycle:this.inputs.cycle,QuotedAmountEgp:this.inputs.amount,
          Status:'pending',SubscriptionRevision:this.inputs.revision,RequestedByUserId:this.inputs.actor,
          CreatedAt:new Date('2026-10-26'),ReviewedAt:null,ReviewNote:null,
        }]};
      }
      return {recordset:[]};
    }
  }
  class Tx {
    async begin() {}
    async commit() {fx.committed++;}
    async rollback() {fx.rolledBack++;}
    request(){return new Req();}
  }
  return {getPool:vi.fn(async()=>({request:()=>new Req()})),sql:{
    Transaction:Tx,Request:Req,UniqueIdentifier:'uuid',Int:'int',NVarChar:()=> 'nv',Decimal:()=> 'decimal',
  }};
});
vi.mock('@/platform/commercial/bootstrapGuard',()=>({assertNotBootstrapTenant:vi.fn()}));
vi.mock('@/platform/tenant/tenantApplock',()=>({acquireTenantApplock:vi.fn(),TENANT_COMMERCIAL_LOCK_PARTS:['commercial']}));
vi.mock('@/platform/outbox/publisher',()=>({publishPlatformOutboxEvent:vi.fn(async(_tx,evt:Record<string,unknown>)=>{fx.outbox.push(evt);})}));
import { submitTenantPlanRequest } from '@/platform/commercial/planRequestService';

beforeEach(() => {fx.statements=[];fx.committed=0;fx.rolledBack=0;fx.alreadyPending=null;fx.currentRevision=3;fx.inserted=false;fx.outbox=[];});
const input={tenantId:TENANT,actorUserId:21,planCode:'growth',billingCycle:'annual' as const,expectedRevision:3};

describe('billing intent database boundary',()=>{
  it('creates one quoted pending request and outbox event, without subscription changes',async()=>{
    const result=await submitTenantPlanRequest(input);
    expect(result).toMatchObject({tenantId:TENANT,requestedPlanCode:'growth',quotedAmountEgp:8990,status:'pending',subscriptionRevision:3});
    expect(fx.committed).toBe(1); expect(fx.outbox).toHaveLength(1);
    expect(JSON.parse(String(fx.outbox[0].payload))).toMatchObject({paid:false,subscriptionChanged:false,quotedAmountEgp:8990});
    expect(fx.statements.filter((q)=>q.sql.includes('UPDATE dbo.TenantSubscription'))).toHaveLength(0);
    expect(fx.statements.filter((q)=>q.sql.includes('INSERT INTO dbo.TenantPlanChangeRequest'))[0]?.inputs.tenantId).toBe(TENANT);
  });
  it('rejects stale revisions before creating anything',async()=>{
    await expect(submitTenantPlanRequest({...input,expectedRevision:2})).rejects.toMatchObject({code:'REVISION_CONFLICT'});
    expect(fx.inserted).toBe(false);expect(fx.committed).toBe(0);expect(fx.rolledBack).toBe(1);expect(fx.outbox).toHaveLength(0);
  });
  it('idempotently reuses an identical pending request without another event',async()=>{
    fx.alreadyPending={RequestId:'22222222-2222-4222-8222-222222222222',TenantId:TENANT,
      FromPlanCode:'starter',RequestedPlanCode:'growth',BillingCycle:'annual',
      QuotedAmountEgp:8990,Status:'pending',SubscriptionRevision:3,
      RequestedByUserId:21,CreatedAt:new Date('2026-10-26'),ReviewedAt:null,ReviewNote:null};
    const result=await submitTenantPlanRequest(input);
    expect(result.requestId).toBe('22222222-2222-4222-8222-222222222222');
    expect(fx.inserted).toBe(false);expect(fx.outbox).toHaveLength(0);expect(fx.committed).toBe(1);
  });
  it('blocks a different pending request and leaves no writes',async()=>{
    fx.alreadyPending={RequestId:'22222222-2222-4222-8222-222222222222',TenantId:TENANT,
      FromPlanCode:'starter',RequestedPlanCode:'pro',BillingCycle:'monthly',
      QuotedAmountEgp:1499,Status:'pending',SubscriptionRevision:3,
      RequestedByUserId:21,CreatedAt:new Date('2026-10-26'),ReviewedAt:null,ReviewNote:null};
    await expect(submitTenantPlanRequest(input)).rejects.toMatchObject({code:'REQUEST_ALREADY_PENDING'});
    expect(fx.inserted).toBe(false);expect(fx.outbox).toHaveLength(0);expect(fx.rolledBack).toBe(1);
  });
});
