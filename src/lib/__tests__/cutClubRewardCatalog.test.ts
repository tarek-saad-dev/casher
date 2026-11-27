import {beforeEach,describe,expect,it,vi} from 'vitest';
const stub=vi.hoisted(()=>({
  session:vi.fn(),queries:[] as Array<{sql:string;params:Record<string,unknown>}>,
  balance:[{PointsBalance:250}] as Array<{PointsBalance:number|null}>,
  rewards:[
    {ItemID:15,NameAr:'ماسك وجه',NameEn:'Face Mask',DescriptionAr:'ماسك',
      PriceCoins:90,ServiceID:null,StockQuantity:4,UnlimitedStock:false,ExpiresAfterDays:30,ActiveTenantServiceCount:0},
    {ItemID:16,NameAr:'حمام زيت',NameEn:'Oil Bath',DescriptionAr:'',
      PriceCoins:400,ServiceID:22,StockQuantity:0,UnlimitedStock:false,ExpiresAfterDays:null,ActiveTenantServiceCount:1},
  ] as any[],
}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/cut-club/memberOtp',()=>({getCutClubSession:stub.session}));
vi.mock('@/lib/db',()=>({
  sql:{UniqueIdentifier:'uuid',Int:'int'},
  getPool:async()=>({request:()=>{
    const params:Record<string,unknown>={};
    return {input(k:string,_t:unknown,v:unknown){params[k]=v;return this;},
      async query(s:string){
        stub.queries.push({sql:s,params:{...params}});
        if(s.includes('FROM dbo.TblLoyaltyStoreItem'))return {recordset:stub.rewards};
        if(s.includes('FROM dbo.TblClient c'))return {recordset:stub.balance};
        throw Error('Unexpected query');
      }};
  }}),
}));
import {loadMemberRewardCatalog} from '@/lib/cut-club/memberRewardsRead';
const tenant='413d433e-f36b-1410-8820-009ec495c7e1';
describe('CUT CLUB verified-session Rewards read model',()=>{
  beforeEach(()=>{
    stub.session.mockReset();stub.queries.length=0;stub.balance=[{PointsBalance:250}];
    stub.session.mockResolvedValue({tenantId:tenant,legacyClientId:7,linkStatus:'ACTIVE'});
  });
  it('never calls DB for absent or forbidden status-only session',async()=>{
    stub.session.mockResolvedValueOnce(null);
    expect(await loadMemberRewardCatalog('invalid')).toBeNull();
    stub.session.mockResolvedValueOnce({tenantId:tenant,linkStatus:'SUSPENDED',legacyClientId:null});
    expect(await loadMemberRewardCatalog('valid')).toBeNull();
    expect(stub.queries).toHaveLength(0);
  });
  it('lists approved global active service rewards without financial mutations',async()=>{
    const result=await loadMemberRewardCatalog('valid');
    expect(result).toMatchObject({balance:250,purchaseEnabled:false});
    expect(result?.items).toMatchObject([
      {id:15,priceCoins:90,canAfford:true,serviceMappingReady:false,purchaseAvailable:false,stockState:'available'},
      {id:16,priceCoins:400,canAfford:false,serviceMappingReady:true,purchaseAvailable:false,stockState:'out_of_stock'},
    ]);
    expect(stub.queries[0].params).toMatchObject({tenant,clientId:7});
    expect(stub.queries[0].sql).toContain('c.TenantId=@tenant');
    expect(stub.queries[1].sql).toContain('SalonID IS NULL');
    expect(stub.queries[1].sql).toContain('ItemID IN (15,16,17,18)');
    expect(stub.queries[1].params).toEqual({tenant});
    expect(stub.queries[1].sql).toContain('p.TenantId=@tenant');
    expect(stub.queries[1].sql).toContain('p.isDeleted=0');
    expect(stub.queries.some(q=>/INSERT|UPDATE|DELETE/i.test(q.sql))).toBe(false);
    expect(JSON.stringify(result)).not.toContain('ClientID');
  });
  it('unlinked/review members can see real catalog but never inherit someone else’s coins',async()=>{
    stub.session.mockResolvedValueOnce({tenantId:tenant,legacyClientId:null,linkStatus:'REVIEW_REQUIRED'});
    const result=await loadMemberRewardCatalog('valid');
    expect(result?.balance).toBeNull();
    expect(result?.items[0].canAfford).toBeNull();
    expect(stub.queries).toHaveLength(1);
  });
  it('does not advertise a matching ServiceID as ready when inactive, absent, wrong-tenant or ambiguous',async()=>{
    const original=stub.rewards;
    try{
      for(const count of [0,2]){
        stub.rewards=[{...original[1],ActiveTenantServiceCount:count}];
        const catalog=await loadMemberRewardCatalog('valid');
        expect(catalog?.items[0]).toMatchObject({serviceId:null,serviceMappingReady:false,purchaseAvailable:false});
      }
      stub.rewards=[{...original[1],ServiceID:39,ActiveTenantServiceCount:1}];
      expect((await loadMemberRewardCatalog('valid'))?.items[0]).toMatchObject({serviceId:null,serviceMappingReady:false,purchaseAvailable:false});
    }finally{stub.rewards=original;}
  });
  it('fails wallet balance closed when multiple active loyalty records exist',async()=>{
    stub.balance=[{PointsBalance:250},{PointsBalance:500}];
    const result=await loadMemberRewardCatalog('valid');
    expect(result?.balance).toBeNull();
  });
});
