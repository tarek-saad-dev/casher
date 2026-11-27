import {beforeAll,afterAll,beforeEach,describe,expect,it,vi} from 'vitest';
import sql from 'mssql';
const enabled=process.env.CI==='true'&&process.env.CUT_CLUB_REWARD_EPHEMERAL_SQL==='1'&&
  process.env.CUT_CLUB_REWARD_EPHEMERAL_HOST==='127.0.0.1'&&!process.env.DB_SERVER&&!process.env.CLOUD_DB_SERVER;
const mocked=vi.hoisted(()=>({session:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/cut-club/memberOtp',()=>({getCutClubSession:mocked.session}));
import {purchaseRewardWithVerifiedSession} from '../cut-club/stagingRewardSettlement';
import {stageRewardPoolReady,createStageSqlRewardPurchasePort} from '../cut-club/stagingRewardSqlPort';
import {stageVoucherOnNewSale,denyEditOfStagingClaimedSale,reverseStagingClaimBeforeSaleDeletion} from '../cut-club/stagingInvoiceClaim';
const tenant='413d433e-f36b-1410-8820-009ec495c7e1';
const key='CUT_CLUB_LIFECYCLE_20261127_A';
let pool:sql.ConnectionPool;
const buy=()=>purchaseRewardWithVerifiedSession({
  enabled:true,trustedTenantId:tenant,trustedBranchId:1,cookieToken:'A'.repeat(43),
  nowSeconds:Math.floor(Date.now()/1000),itemId:15,idempotencyKey:key,
  stageReady:()=>stageRewardPoolReady(pool),
  verifyOwnedCustomerAndBranch:async owner=>{
    const r=await pool.request().input('tenant',sql.UniqueIdentifier,owner.tenantId)
      .input('client',sql.Int,owner.customerId).input('branch',sql.Int,owner.branchId)
      .query<{C:number}>(`SELECT COUNT(*) AS C FROM dbo.TblClient c CROSS JOIN dbo.TblBranch b
        WHERE c.ClientID=@client AND c.TenantId=@tenant AND b.BranchID=@branch AND b.BranchID=1`);
    return r.recordset[0].C===1;
  },
  port:createStageSqlRewardPurchasePort(pool),
});
async function snapshot(){
  return (await pool.request().query(`SELECT
    (SELECT PointsBalance FROM dbo.TblClientLoyalty WHERE ClientID=7) AS Coins,
    (SELECT StockQuantity FROM dbo.TblLoyaltyStoreItem WHERE ItemID=15) AS Stock,
    (SELECT COUNT(*) FROM dbo.TblClientInventory) AS Vouchers,
    (SELECT TOP(1) Status FROM dbo.TblClientInventory) AS VoucherStatus,
    (SELECT TOP(1) UsedInvID FROM dbo.TblClientInventory) AS UsedInvID,
    (SELECT COUNT(*) FROM dbo.TblLoyaltyPointLedger) AS LedgerRows,
    (SELECT SUM(PointsDelta) FROM dbo.TblLoyaltyPointLedger) AS LedgerDelta,
    (SELECT COUNT(*) FROM dbo.CutClubRewardCommand) AS Commands,
    (SELECT COUNT(*) FROM dbo.CutClubVoucherInvoiceClaim WHERE Status=N'APPLIED') AS Applied,
    (SELECT COUNT(*) FROM dbo.CutClubVoucherInvoiceClaim WHERE Status=N'REVERSED') AS Reversed,
    (SELECT COUNT(*) FROM dbo.TblInventoryUsageLog) AS UsageRows,
    (SELECT COUNT(*) FROM dbo.TblinvServHead) AS Invoices,
    (SELECT COUNT(*) FROM dbo.TblinvServDetail) AS Lines`)).recordset[0];
}
async function sell(code:string,id:number,client=7,failAfter=false){
  const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try{
    await new sql.Request(tx).input('id',sql.Int,id).input('client',sql.Int,client).query(`
      INSERT dbo.TblinvServHead(invID,invType,ClientID,BranchID) VALUES(@id,N'مبيعات',@client,1);
      INSERT dbo.TblinvServDetail(invID,invType,ProID,SPrice,SPriceAfterDis,Qty) VALUES(@id,N'مبيعات',39,200,0,1);`);
    if(!await stageVoucherOnNewSale(tx,{trustedTenantId:tenant,trustedBranchId:1,trustedClientId:client,invoiceId:id,voucherCode:code}))throw Error('CLAIM_MISSING');
    if(failAfter)throw Error('SIMULATED_LATE_SALE_FAILURE');
    await tx.commit();
  }catch(e){await tx.rollback().catch(()=>{});throw e;}
}
async function cancel(id:number,failAfter=false){
  const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try{
    await expect(denyEditOfStagingClaimedSale(tx,id)).rejects.toThrow('CUT_CLUB_CLAIMED_INVOICE_REQUIRES_CANCEL_REISSUE');
    if(!await reverseStagingClaimBeforeSaleDeletion(tx,{trustedTenantId:tenant,trustedBranchId:1,invoiceId:id}))throw Error('REVERSAL_MISSING');
    await new sql.Request(tx).input('id',sql.Int,id).query(`
      DELETE dbo.TblinvServDetail WHERE invID=@id;
      DELETE dbo.TblinvServHead WHERE invID=@id;`);
    if(failAfter)throw Error('SIMULATED_LATE_DELETE_FAILURE');
    await tx.commit();
  }catch(e){await tx.rollback().catch(()=>{});throw e;}
}
const paid={Coins:300,Stock:0,Vouchers:1,LedgerRows:1,LedgerDelta:-200,Commands:1};
describe.skipIf(!enabled)('CUT CLUB purchase -> invoice -> cancellation -> reuse (disposable SQL)',()=>{
  beforeAll(async()=>{
    const password=process.env.CUT_CLUB_REWARD_EPHEMERAL_AGENT_PASSWORD;
    if(!password)throw Error('MISSING_EPHEMERAL_LOGIN');
    pool=await new sql.ConnectionPool({server:'127.0.0.1',port:1433,database:'last132_agent',
      user:'drvo_agent',password,options:{encrypt:false,trustServerCertificate:true},
      pool:{max:12,min:0,idleTimeoutMillis:5000}}).connect();
    if(!await stageRewardPoolReady(pool))throw Error('WRONG_DB');
    process.env.CUT_CLUB_STAGING_REWARD_PURCHASE_ENABLED='true';
    process.env.CUT_CLUB_STAGING_CLAIM_WRITE_ENABLED='true';
    process.env.CUT_CLUB_STAGING_APPROVED_BRANCHES_JSON=JSON.stringify([tenant+':1']);
  });
  afterAll(async()=>{await pool?.close();});
  beforeEach(async()=>{
    mocked.session.mockReset().mockResolvedValue({tenantId:tenant,legacyClientId:7,linkStatus:'ACTIVE'});
    await pool.request().query(`
      DELETE dbo.TblInventoryUsageLog; DELETE dbo.CutClubVoucherInvoiceClaim;
      DELETE dbo.TblinvServDetail; DELETE dbo.TblinvServHead;
      DELETE dbo.CutClubRewardCommand; DELETE dbo.TblClientInventory; DELETE dbo.TblLoyaltyPointLedger;
      UPDATE dbo.CutClubMemberAccount SET AccessStatus='ENABLED',LinkStatus='ACTIVE',LegacyClientID=7;
      UPDATE dbo.CutClubCustomerSession SET RevokedAtUtc=NULL,ExpiresAtUtc=DATEADD(MINUTE,10,SYSUTCDATETIME());
      UPDATE dbo.TblClient SET Mobile='01000000000' WHERE ClientID=7;
      UPDATE dbo.TblClientLoyalty SET PointsBalance=500 WHERE ClientID=7;
      UPDATE dbo.TblLoyaltyStoreItem SET StockQuantity=1,ServiceID=39 WHERE ItemID=15;`);
  });
  it('purchased code is redeemed once, cancellation restores it, re-use does not debit again',async()=>{
    const first=await buy();if(!first.ok)throw Error('PURCHASE_FAILED');
    const code=first.receipt.voucherCode;
    expect(first.receipt).toMatchObject({itemId:15,coinsCharged:200,balanceAfter:300});
    expect(await snapshot()).toMatchObject({...paid,VoucherStatus:'ACTIVE',UsedInvID:null,Applied:0,Reversed:0,UsageRows:0,Invoices:0,Lines:0});
    await sell(code,500);
    await expect(sell(code,501)).rejects.toThrow();
    expect(await snapshot()).toMatchObject({...paid,VoucherStatus:'USED',UsedInvID:500,Applied:1,Reversed:0,UsageRows:1,Invoices:1,Lines:1});
    await expect(cancel(500,true)).rejects.toThrow('SIMULATED_LATE_DELETE_FAILURE');
    expect(await snapshot()).toMatchObject({...paid,VoucherStatus:'USED',UsedInvID:500,Applied:1,Reversed:0,UsageRows:1,Invoices:1,Lines:1});
    await cancel(500);
    expect(await snapshot()).toMatchObject({...paid,VoucherStatus:'ACTIVE',UsedInvID:null,Applied:0,Reversed:1,UsageRows:1,Invoices:0,Lines:0});
    expect(await buy()).toEqual({...first,replayed:true});
    await sell(code,502);
    expect(await snapshot()).toMatchObject({...paid,VoucherStatus:'USED',UsedInvID:502,Applied:1,Reversed:1,UsageRows:2,Invoices:1,Lines:1});
  });
  it('wrong owner and late invoice failure preserve purchased voucher; concurrent scans create just one invoice',async()=>{
    const first=await buy();if(!first.ok)throw Error('PURCHASE_FAILED');
    const code=first.receipt.voucherCode;
    await expect(sell(code,510,8)).rejects.toThrow();
    await expect(sell(code,511,7,true)).rejects.toThrow('SIMULATED_LATE_SALE_FAILURE');
    expect(await snapshot()).toMatchObject({...paid,VoucherStatus:'ACTIVE',UsedInvID:null,Applied:0,Reversed:0,UsageRows:0,Invoices:0,Lines:0});
    const results=await Promise.allSettled([sell(code,512),sell(code,513)]);
    expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(x=>x.status==='rejected')).toHaveLength(1);
    const state=await snapshot();
    expect(state).toMatchObject({...paid,VoucherStatus:'USED',Applied:1,Reversed:0,UsageRows:1,Invoices:1,Lines:1});
    expect([512,513]).toContain(state.UsedInvID);
  });
});
