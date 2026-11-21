import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const fake=vi.hoisted(()=>({purchase:vi.fn(),pool:vi.fn(),allowed:vi.fn()}));
vi.mock('@/lib/cut-club/memberOtp',()=>({
  secureBffKey:(auth:string|null)=>auth==='Bearer trusted-test-key',
  cutClubTenant:()=> '413d433e-f36b-1410-8820-009ec495c7e1',
  ClubAuthError:class ClubAuthError extends Error{
    constructor(public code:string,public status:number){super(code);}
  },
}));
vi.mock('@/lib/db',()=>({getPool:fake.pool,sql:{UniqueIdentifier:'uuid',Int:'int'}}));
vi.mock('@/lib/cut-club/stagingRewardSettlement',()=>({
  purchaseRewardWithVerifiedSession:fake.purchase,
}));
vi.mock('@/lib/cut-club/stagingRewardSqlPort',()=>({
  stageRewardPoolReady:fake.allowed,createStageSqlRewardPurchasePort:()=>({}),
}));
import {GET,POST,OPTIONS} from '@/app/api/public/cut-club/rewards/purchase/route';

const submit=(body:unknown,authorized=true)=>POST(new NextRequest(
  'https://ops.cutsaloon.com/api/public/cut-club/rewards/purchase',{
    method:'POST',
    headers:{'content-type':'application/json',
      ...(authorized?{Authorization:'Bearer trusted-test-key'}:{})},
    body:JSON.stringify(body),
  }));
const valid={itemId:15,idempotencyKey:'PURCHASE_ONCE_SAFE_KEY_12345'};
describe('CUT CLUB staging checkout endpoint release gates',()=>{
  beforeEach(()=>{
    delete process.env.CUT_CLUB_STAGING_REWARD_PURCHASE_ENABLED;
    fake.purchase.mockReset();fake.pool.mockReset();fake.allowed.mockReset();
  });
  it('requires trusted server-to-server BFF token',async()=>{
    expect((await submit(valid,false)).status).toBe(401);
    expect(fake.pool).not.toHaveBeenCalled();
    expect(fake.purchase).not.toHaveBeenCalled();
  });
  it('is hard disabled by default even for authenticated callers',async()=>{
    const response=await submit(valid);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({code:'REWARD_PURCHASE_NOT_RELEASED'});
    expect(fake.pool).not.toHaveBeenCalled();
    expect((await GET()).status).toBe(403);
    expect((await OPTIONS()).status).toBe(403);
  });
  it('does not permit browser-supplied customer, balance, branch or prices',async()=>{
    process.env.CUT_CLUB_STAGING_REWARD_PURCHASE_ENABLED='true';
    expect((await submit({...valid,clientId:9})).status).toBe(400);
    expect((await submit({...valid,priceCoins:1})).status).toBe(400);
    expect((await submit({...valid,branchId:3})).status).toBe(400);
    expect((await submit({...valid,idempotencyKey:'short'})).status).toBe(400);
    expect(fake.pool).not.toHaveBeenCalled();
  });
  it('rejects non-CUT or absent operator-approved staging branch policy',async()=>{
    process.env.CUT_CLUB_STAGING_REWARD_PURCHASE_ENABLED='true';
    process.env.CUT_CLUB_AUTH_TENANT_CODE='CASHER_BOOT';
    delete process.env.CUT_CLUB_STAGING_REWARD_APPROVED_BRANCHES_JSON;
    delete process.env.CUT_CLUB_STAGING_REWARD_BRANCH_ID;
    expect((await submit(valid)).status).toBe(403);
    expect(fake.pool).not.toHaveBeenCalled();
  });
});
