import {beforeAll,afterAll,beforeEach,describe,expect,it,vi} from 'vitest';
import sql from 'mssql';
vi.mock('server-only',()=>({}));
import {
  stageVoucherOnNewSale,reverseStagingClaimBeforeSaleDeletion,
  denyEditOfStagingClaimedSale,
} from '../cut-club/stagingInvoiceClaim';
const enabled=process.env.CI==='true'&&
  process.env.CUT_CLUB_CLAIM_EPHEMERAL_SQL==='1'&&
  process.env.CUT_CLUB_CLAIM_EPHEMERAL_HOST==='127.0.0.1';
const tenant='413d433e-f36b-1410-8820-009ec495c7e1';
const voucher='CUT-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
let pool:sql.ConnectionPool;
async function snapshot(){
  const r=await pool.request().query<{
    Voucher:string;UsedInvID:number|null;Claims:number;Applied:number;Logs:number;Invoices:number;
  }>(`
    SELECT
      (SELECT Status FROM dbo.TblClientInventory WHERE InventoryID=31) AS Voucher,
      (SELECT UsedInvID FROM dbo.TblClientInventory WHERE InventoryID=31) AS UsedInvID,
      (SELECT COUNT(*) FROM dbo.CutClubVoucherInvoiceClaim) AS Claims,
      (SELECT COUNT(*) FROM dbo.CutClubVoucherInvoiceClaim WHERE Status=N'APPLIED') AS Applied,
      (SELECT COUNT(*) FROM dbo.TblInventoryUsageLog) AS Logs,
      (SELECT COUNT(*) FROM dbo.TblinvServHead) AS Invoices
  `);
  return r.recordset[0];
}
async function attempt(opts:{
  invId:number;clientId?:number;benefit?:number;serviceId?:number;throwAfter?:boolean;
}){
  const clientId=opts.clientId??7;
  const tx=new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try{
    await new sql.Request(tx)
      .input('invId',sql.Int,opts.invId)
      .input('clientId',sql.Int,clientId)
      .input('serviceId',sql.Int,opts.serviceId??39)
      .input('afterPrice',sql.Decimal(18,2),opts.benefit??0)
      .query(`
        INSERT dbo.TblinvServHead(invID,invType,ClientID,BranchID)
          VALUES(@invId,N'مبيعات',@clientId,1);
        INSERT dbo.TblinvServDetail(invID,invType,ProID,SPrice,SPriceAfterDis,Qty)
          VALUES(@invId,N'مبيعات',@serviceId,200,@afterPrice,1);
      `);
    const applied=await stageVoucherOnNewSale(tx,{
      trustedTenantId:tenant,trustedBranchId:1,
      trustedClientId:clientId,invoiceId:opts.invId,voucherCode:voucher,
    });
    if(opts.throwAfter)throw Error('SIMULATED_INVOICE_SAVE_FAILURE');
    await tx.commit();
    return applied;
  }catch(e){
    await tx.rollback().catch(()=>{});
    throw e;
  }
}
describe.skipIf(!enabled)('CUT CLUB staged voucher + invoice real SQL 2022 atomic acceptance',()=>{
  beforeAll(async()=>{
    const password=process.env.CUT_CLUB_CLAIM_EPHEMERAL_AGENT_PASSWORD;
    if(!password)throw Error('MISSING_EPHEMERAL_LOGIN');
    pool=await new sql.ConnectionPool({
      server:'127.0.0.1',port:1433,database:'last132_agent',
      user:'drvo_agent',password,
      options:{encrypt:false,trustServerCertificate:true},
      pool:{max:12,min:0,idleTimeoutMillis:5000},
    }).connect();
    process.env.CUT_CLUB_STAGING_CLAIM_WRITE_ENABLED='true';
    process.env.CUT_CLUB_STAGING_APPROVED_BRANCHES_JSON=JSON.stringify([tenant+':1']);
  });
  afterAll(async()=>{await pool?.close();});
  beforeEach(async()=>{
    await pool.request().query(`
      DELETE FROM dbo.TblInventoryUsageLog;
      DELETE FROM dbo.CutClubVoucherInvoiceClaim;
      DELETE FROM dbo.TblinvServDetail;
      DELETE FROM dbo.TblinvServHead;
      UPDATE dbo.TblClientInventory
      SET Status=N'ACTIVE',UsedInvID=NULL,UsedAt=NULL WHERE InventoryID=31;
    `);
  });
  it('claim, invoice, voucher USED, and immutable usage log commit together',async()=>{
    expect(await attempt({invId:500})).toBe(true);
    expect(await snapshot()).toEqual({
      Voucher:'USED',UsedInvID:500,Claims:1,Applied:1,Logs:1,Invoices:1,
    });
  });
  it('same voucher on competing invoices can be claimed only once',async()=>{
    const results=await Promise.allSettled([
      attempt({invId:501}),attempt({invId:502}),
    ]);
    expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(x=>x.status==='rejected')).toHaveLength(1);
    expect(await snapshot()).toMatchObject({
      Voucher:'USED',Claims:1,Applied:1,Logs:1,Invoices:1,
    });
  });
  it('rejected owner, wrong service and non-zero benefit rollback the invoice',async()=>{
    await expect(attempt({invId:503,clientId:8})).rejects.toThrow();
    await expect(attempt({invId:504,serviceId:22})).rejects.toThrow();
    await expect(attempt({invId:505,benefit:100})).rejects.toThrow();
    expect(await snapshot()).toEqual({
      Voucher:'ACTIVE',UsedInvID:null,Claims:0,Applied:0,Logs:0,Invoices:0,
    });
  });
  it('a later sale failure rolls back even a successful staged voucher claim',async()=>{
    await expect(attempt({invId:506,throwAfter:true})).rejects.toThrow();
    expect(await snapshot()).toEqual({
      Voucher:'ACTIVE',UsedInvID:null,Claims:0,Applied:0,Logs:0,Invoices:0,
    });
  });
  it('in-place edit is blocked; cancellation restores voucher with claim REVERSED',async()=>{
    await attempt({invId:507});
    const tx=new sql.Transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try{
      await expect(denyEditOfStagingClaimedSale(tx,507))
        .rejects.toThrow('CUT_CLUB_CLAIMED_INVOICE_REQUIRES_CANCEL_REISSUE');
      expect(await reverseStagingClaimBeforeSaleDeletion(tx,{
        trustedTenantId:tenant,trustedBranchId:1,invoiceId:507,
      })).toBe(true);
      await new sql.Request(tx).input('id',sql.Int,507).query(`
        DELETE FROM dbo.TblinvServDetail WHERE invID=@id;
        DELETE FROM dbo.TblinvServHead WHERE invID=@id;
      `);
      await tx.commit();
    }catch(e){await tx.rollback().catch(()=>{});throw e;}
    expect(await snapshot()).toEqual({
      Voucher:'ACTIVE',UsedInvID:null,Claims:1,Applied:0,Logs:1,Invoices:0,
    });
  });
  it('invoice deletion failure restores claim and USED state by rollback',async()=>{
    await attempt({invId:508});
    const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try{
      expect(await reverseStagingClaimBeforeSaleDeletion(tx,{
        trustedTenantId:tenant,trustedBranchId:1,invoiceId:508,
      })).toBe(true);
      throw Error('SIMULATED_INVOICE_DELETE_FAILURE');
    }catch{await tx.rollback();}
    expect(await snapshot()).toEqual({
      Voucher:'USED',UsedInvID:508,Claims:1,Applied:1,Logs:1,Invoices:1,
    });
  });
});
