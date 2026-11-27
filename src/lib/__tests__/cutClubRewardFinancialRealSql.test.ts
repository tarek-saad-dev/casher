import {beforeAll,afterAll,beforeEach,describe,expect,it,vi} from 'vitest';
import mssql from 'mssql';
const enabled=process.env.CI==='true' &&
  process.env.CUT_CLUB_REWARD_EPHEMERAL_SQL==='1' &&
  process.env.CUT_CLUB_REWARD_EPHEMERAL_HOST==='127.0.0.1';
const mocked=vi.hoisted(()=>({session:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/cut-club/memberOtp',()=>({getCutClubSession:mocked.session}));
import {purchaseRewardWithVerifiedSession} from '../cut-club/stagingRewardSettlement';
import {stageRewardPoolReady,createStageSqlRewardPurchasePort} from '../cut-club/stagingRewardSqlPort';

const tenant='413d433e-f36b-1410-8820-009ec495c7e1';
const key='BATCH_PURCHASE_2026_IDEMPOTENT_AA';
let pool:mssql.ConnectionPool;
const owner=()=>({tenantId:tenant,legacyClientId:7,linkStatus:'ACTIVE'});
const request=(idempotencyKey=key,opts:Record<string,unknown>={})=>({
  enabled:true,trustedTenantId:tenant,trustedBranchId:1,
  cookieToken:'A'.repeat(43),
  nowSeconds:Math.floor(Date.now()/1000),
  itemId:15,idempotencyKey,
  stageReady:()=>stageRewardPoolReady(pool),
  verifyOwnedCustomerAndBranch:async()=>{
    const r=await pool.request().query<{C:number}>(`
      SELECT COUNT(*) AS C FROM dbo.TblClient WHERE ClientID=7
        AND TenantId='413d433e-f36b-1410-8820-009ec495c7e1'
    `);
    return r.recordset[0].C===1;
  },
  port:createStageSqlRewardPurchasePort(pool),
  ...opts,
});
async function financial(){
  const r=await pool.request().query<{
    Coins:number;Stock:number;Vouchers:number;Movements:number;Commands:number;
  }>(`
    SELECT (SELECT PointsBalance FROM dbo.TblClientLoyalty WHERE ClientID=7) AS Coins,
      (SELECT StockQuantity FROM dbo.TblLoyaltyStoreItem WHERE ItemID=15) AS Stock,
      (SELECT COUNT(*) FROM dbo.TblClientInventory) AS Vouchers,
      (SELECT COUNT(*) FROM dbo.TblLoyaltyPointLedger) AS Movements,
      (SELECT COUNT(*) FROM dbo.CutClubRewardCommand) AS Commands
  `);
  return r.recordset[0];
}
describe.skipIf(!enabled)('CUT CLUB staged reward financial settlement in disposable real SQL 2022',()=>{
  beforeAll(async()=>{
    const pass=process.env.CUT_CLUB_REWARD_EPHEMERAL_AGENT_PASSWORD;
    if(!pass)throw Error('MISSING_DISPOSABLE_SQL_PASSWORD');
    pool=await new mssql.ConnectionPool({
      server:'127.0.0.1',port:1433,database:'last132_agent',
      user:'drvo_agent',password:pass,
      options:{encrypt:false,trustServerCertificate:true},
      pool:{max:12,min:0,idleTimeoutMillis:5000},
    }).connect();
    process.env.CUT_CLUB_STAGING_REWARD_PURCHASE_ENABLED='true';
  });
  afterAll(async()=>{await pool?.close();});
  beforeEach(async()=>{
    mocked.session.mockReset().mockResolvedValue(owner());
    await pool.request().query(`
      IF OBJECT_ID(N'dbo.Trg_CutClubFailLedger',N'TR') IS NOT NULL
        DROP TRIGGER dbo.Trg_CutClubFailLedger;
      DELETE FROM dbo.CutClubRewardCommand;
      DELETE FROM dbo.TblClientInventory;
      DELETE FROM dbo.TblLoyaltyPointLedger;
      UPDATE dbo.CutClubMemberAccount SET AccessStatus='ENABLED',LinkStatus='ACTIVE',LegacyClientID=7;
      UPDATE dbo.CutClubCustomerSession SET RevokedAtUtc=NULL,ExpiresAtUtc=DATEADD(MINUTE,10,SYSUTCDATETIME());
      UPDATE dbo.TblClient SET Mobile='01000000000' WHERE ClientID=7;
      UPDATE dbo.TblClientLoyalty SET PointsBalance=500 WHERE ClientID=7;
      UPDATE dbo.TblLoyaltyStoreItem
        SET StockQuantity=1,ServiceID=39 WHERE ItemID=15;
    `);
  });
  it('stage pool identity and durable idempotency table verified',async()=>{
    expect(await stageRewardPoolReady(pool)).toBe(true);
    expect(await financial()).toEqual({Coins:500,Stock:1,Vouchers:0,Movements:0,Commands:0});
  });
  it('uses one transaction for debit, stock, one ledger, one voucher and command',async()=>{
    const first=await purchaseRewardWithVerifiedSession(request());
    expect(first.ok).toBe(true);
    if(!first.ok)throw Error('PURCHASE_FAILED');
    expect(first.replayed).toBe(false);
    expect(first.receipt).toMatchObject({itemId:15,coinsCharged:200,balanceAfter:300});
    expect(first.receipt.voucherCode).toMatch(/^CUT-[A-F0-9]{40}$/);
    expect(await financial()).toEqual({Coins:300,Stock:0,Vouchers:1,Movements:1,Commands:1});
    const replay=await purchaseRewardWithVerifiedSession(request());
    expect(replay).toEqual({...first,replayed:true});
    expect(await financial()).toEqual({Coins:300,Stock:0,Vouchers:1,Movements:1,Commands:1});
  });
  it('two parallel SQL connections and the SAME key settle exactly once',async()=>{
    const [a,b]=await Promise.all([
      purchaseRewardWithVerifiedSession(request()),
      purchaseRewardWithVerifiedSession(request()),
    ]);
    expect(a.ok&&b.ok).toBe(true);
    if(!a.ok||!b.ok)throw Error('CONCURRENT_REQUEST_FAILED');
    expect(a.receipt).toEqual(b.receipt);
    expect([a.replayed,b.replayed].sort()).toEqual([false,true]);
    expect(await financial()).toEqual({Coins:300,Stock:0,Vouchers:1,Movements:1,Commands:1});
  });
  it('two different keys cannot oversell one stock unit',async()=>{
    const [a,b]=await Promise.all([
      purchaseRewardWithVerifiedSession(request(key)),
      purchaseRewardWithVerifiedSession(request('ANOTHER_VALID_IDEMPOTENCY_KEY_2026')),
    ]);
    expect([a.ok,b.ok].sort()).toEqual([false,true]);
    expect(await financial()).toEqual({Coins:300,Stock:0,Vouchers:1,Movements:1,Commands:1});
  });
  it('failed ledger insert rolls back balance, stock, voucher and command',async()=>{
    await pool.request().query(`
      CREATE TRIGGER dbo.Trg_CutClubFailLedger ON dbo.TblLoyaltyPointLedger
      AFTER INSERT AS BEGIN THROW 51995,'SIMULATED_LEDGER_FAILURE',1; END;
    `);
    const result=await purchaseRewardWithVerifiedSession(request());
    expect(result.ok).toBe(false);
    expect(await financial()).toEqual({Coins:500,Stock:1,Vouchers:0,Movements:0,Commands:0});
  });
  it('mismatched/unmapped real service blocks debit and voucher issuance',async()=>{
    await pool.request().query(`UPDATE dbo.TblLoyaltyStoreItem SET ServiceID=NULL WHERE ItemID=15`);
    expect((await purchaseRewardWithVerifiedSession(request())).ok).toBe(false);
    expect(await financial()).toEqual({Coins:500,Stock:1,Vouchers:0,Movements:0,Commands:0});
  });
  it('suspended/review accounts cannot settle even if they have a historic balance',async()=>{
    mocked.session.mockResolvedValueOnce({tenantId:tenant,legacyClientId:7,linkStatus:'SUSPENDED'});
    expect((await purchaseRewardWithVerifiedSession(request())).ok).toBe(false);
    mocked.session.mockResolvedValueOnce({tenantId:tenant,legacyClientId:null,linkStatus:'REVIEW_REQUIRED'});
    expect((await purchaseRewardWithVerifiedSession(request())).ok).toBe(false);
    expect(await financial()).toEqual({Coins:500,Stock:1,Vouchers:0,Movements:0,Commands:0});
  });
  it('rejects a stale preflight session when SQL moderation, revocation, expiry or phone changed',async()=>{
    const original=await financial();
    const changes=[
      ["UPDATE dbo.CutClubMemberAccount SET AccessStatus='SUSPENDED'","UPDATE dbo.CutClubMemberAccount SET AccessStatus='ENABLED'"],
      ["UPDATE dbo.CutClubCustomerSession SET RevokedAtUtc=SYSUTCDATETIME()","UPDATE dbo.CutClubCustomerSession SET RevokedAtUtc=NULL"],
      ["UPDATE dbo.CutClubCustomerSession SET ExpiresAtUtc=DATEADD(SECOND,-1,SYSUTCDATETIME())","UPDATE dbo.CutClubCustomerSession SET ExpiresAtUtc=DATEADD(MINUTE,10,SYSUTCDATETIME())"],
      ["UPDATE dbo.TblClient SET Mobile='01200000000' WHERE ClientID=7","UPDATE dbo.TblClient SET Mobile='01000000000' WHERE ClientID=7"],
    ];
    for(const [deny,restore] of changes){
      await pool.request().query(deny);
      try{
        expect((await purchaseRewardWithVerifiedSession(request())).ok).toBe(false);
        expect(await financial()).toEqual(original);
      }finally{await pool.request().query(restore);}
    }
    expect((await purchaseRewardWithVerifiedSession(request())).ok).toBe(true);
    await pool.request().query("UPDATE dbo.CutClubMemberAccount SET AccessStatus='SUSPENDED'");
    expect((await purchaseRewardWithVerifiedSession(request())).ok).toBe(false);
    expect(await financial()).toEqual({Coins:300,Stock:0,Vouchers:1,Movements:1,Commands:1});
  });
  it('disabled flag denies without starting a transaction',async()=>{
    process.env.CUT_CLUB_STAGING_REWARD_PURCHASE_ENABLED='false';
    try{
      expect((await purchaseRewardWithVerifiedSession(request())).ok).toBe(false);
      expect(await financial()).toEqual({Coins:500,Stock:1,Vouchers:0,Movements:0,Commands:0});
    }finally{
      process.env.CUT_CLUB_STAGING_REWARD_PURCHASE_ENABLED='true';
    }
  });
});
