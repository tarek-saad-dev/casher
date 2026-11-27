import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from 'vitest';
import mssql from 'mssql';
let pool:mssql.ConnectionPool|null=null;
vi.mock('@/lib/db',async()=>({sql:(await import('mssql')).default,getPool:async()=>{if(!pool)throw Error('POOL_REQUIRED');return pool;}}));
import {registerDecemberParticipant} from './registrationRepository';
import {quoteDecember,quoteDecemberInTransaction,persistDecemberRedemption} from './stagingCheckout';
import {confirmStagingDecemberReferral,guardDecemberInvoiceMutation} from './stagingInvoiceReferral';
import {assertNoZeroInvoiceCash} from './stagingZeroPayment';
const enabled=process.env.CI==='true'&&process.env.DECEMBER_EPHEMERAL_SQL==='1'&&process.env.CUT_CLUB_EPHEMERAL_HOST==='127.0.0.1'&&!process.env.DB_SERVER&&!process.env.CLOUD_DB_SERVER;
const tenant='413d433e-f36b-1410-8820-009ec495c7e1';
const line={proId:9,empId:1,sPrice:200,qty:1};
const input=(clientId:number,branchId=1)=>({tenantId:tenant,branchId,clientId,items:[line]});
async function atomic<T>(fn:(tx:mssql.Transaction)=>Promise<T>){const tx=new mssql.Transaction(pool!);await tx.begin(mssql.ISOLATION_LEVEL.SERIALIZABLE);try{const r=await fn(tx);await tx.commit();return r;}catch(e){await tx.rollback().catch(()=>null);throw e;}}
async function register(id:number,referralCode?:string){return registerDecemberParticipant(tenant,{name:'Synthetic '+id,phone:'01000000'+id,student:false,...(referralCode?{referralCode}:{})});}
async function approve(id:number){await pool!.request().input('client',mssql.Int,id).input('phone',mssql.VarChar(16),'+201000000'+id).query("UPDATE dbo.CutOfferParticipant SET ClientId=@client,IdentityVerifiedAtUtc=SYSUTCDATETIME(),IdentityVerifiedBy=1 WHERE PhoneNormalized=@phone");}
async function invoice(tx:mssql.Transaction,id:number,client:number,branch:number,discount:number){await new mssql.Request(tx).input('id',mssql.Int,id).input('client',mssql.Int,client).input('branch',mssql.Int,branch).input('discount',mssql.Decimal(10,2),discount).query("INSERT dbo.TblinvServHead VALUES(@id,N'مبيعات',@client,@branch,200,@discount,200-@discount,0,N'no'); INSERT dbo.TblinvServDetail VALUES(@id,N'مبيعات',9,200);");}
describe.skipIf(!enabled)('December actual SQL domain integration on disposable minimal fixture',()=>{
 beforeAll(async()=>{
  const password=process.env.CUT_CLUB_EPHEMERAL_AGENT_PASSWORD;if(!password)throw Error('FIXTURE_PASSWORD_REQUIRED');
  pool=await new mssql.ConnectionPool({server:'127.0.0.1',port:1433,database:'last132_agent',user:'drvo_agent',password,options:{encrypt:false,trustServerCertificate:true}}).connect();
  const r=await pool.request().query("SELECT DB_NAME() db,SUSER_SNAME() login");expect(r.recordset[0]).toMatchObject({db:'last132_agent',login:'drvo_agent'});
  process.env.DECEMBER_EXAM_TENANT_ID=tenant;process.env.DECEMBER_EXAM_STAGING_CHECKOUT_ENABLED='true';process.env.DECEMBER_EXAM_STAGING_REFERRAL_ENABLED='true';process.env.DECEMBER_EXAM_ELIGIBLE_SERVICE_IDS='9,11';process.env.DECEMBER_EXAM_REGISTRATION_MAX_PER_MINUTE='60';
 });
 afterAll(async()=>{await pool?.close();pool=null;});
 beforeEach(async()=>{await pool!.request().query(`
 DELETE dbo.CutClubMemberAccount WHERE LegacyClientID IN(101,102,103,104,105);DELETE dbo.TblClientLoyalty WHERE ClientID IN(101,102,103,104,105);
 DELETE dbo.CutOfferOperationAudit;DELETE dbo.CutOfferRedemption;DELETE dbo.CutOfferReferral;DELETE dbo.CutOfferParticipant;DELETE dbo.CutOfferCampaign;
 DELETE dbo.TblinvServDetail;DELETE dbo.TblinvServHead;DELETE dbo.TblCashMove;DELETE dbo.TblinvServPayment;
 INSERT dbo.CutOfferCampaign(TenantId,Code,Status,StartsAtUtc,EndsAtUtc,FirstVisitPct,StudentPct,ClubPct,MultiServicePct,Friend1Pct,Friend2Pct,Friend3Pct)
 VALUES('413d433e-f36b-1410-8820-009ec495c7e1','DECEMBER_EXAM_2026','ACTIVE',DATEADD(day,-1,SYSUTCDATETIME()),DATEADD(day,1,SYSUTCDATETIME()),10,10,5,5,20,45,75);
 `);});
 it('registration is pending; duplicate phone cannot mint a second session',async()=>{
  const owner=await register(101);await register(102,owner.referralCode);
  await expect(register(102,owner.referralCode)).rejects.toThrow('REGISTRATION_REVIEW_REQUIRED');
  const r=await pool!.request().query('SELECT Status FROM dbo.CutOfferReferral');expect(r.recordset).toEqual([{Status:'PENDING'}]);
  await expect(quoteDecember(input(101))).rejects.toThrow('DECEMBER_REGISTRATION_REQUIRED');
 });
 it('cross-branch paid visit confirms referral; rollback and deletion restore eligibility',async()=>{
  const owner=await register(101);await register(102,owner.referralCode);await approve(101);await approve(102);
  await expect(atomic(async tx=>{await invoice(tx,5001,102,2,0);await confirmStagingDecemberReferral(tx,{invoiceId:5001,clientId:102,branchId:2});throw Error('FORCED_ROLLBACK');})).rejects.toThrow('FORCED_ROLLBACK');
  expect((await quoteDecember(input(101))).percent).toBe(10);
  await atomic(async tx=>{await invoice(tx,5001,102,2,0);await confirmStagingDecemberReferral(tx,{invoiceId:5001,clientId:102,branchId:2});});
  expect((await quoteDecember(input(101))).percent).toBe(30);
  await atomic(async tx=>{await guardDecemberInvoiceMutation(tx,5001,'delete');await new mssql.Request(tx).query('DELETE dbo.TblinvServDetail WHERE invID=5001;DELETE dbo.TblinvServHead WHERE invID=5001;');});
  expect((await quoteDecember(input(101))).percent).toBe(10);
 });
 it('rejects stale catalog price and records only one cross-branch redemption',async()=>{
  await register(101);await approve(101);
  await expect(quoteDecember({...input(101),items:[{...line,sPrice:1}]})).rejects.toThrow('DECEMBER_INELIGIBLE_CART');
  const save=(id:number,branch:number)=>atomic(async tx=>{const q=await quoteDecemberInTransaction(tx,input(101,branch));await invoice(tx,id,101,branch,q.discountPiasters/100);await persistDecemberRedemption(tx,q,id);return id;});
  const results=await Promise.allSettled([save(5002,1),save(5003,2)]);
  expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  const r=await pool!.request().query('SELECT COUNT(*) n FROM dbo.CutOfferRedemption;SELECT COUNT(*) n FROM dbo.TblinvServHead;');const sets=r.recordsets as Array<Array<{n:number}>>;expect(sets[0][0].n).toBe(1);expect(sets[1][0].n).toBe(1);
  await expect(quoteDecember(input(101))).rejects.toThrow('DECEMBER_ALREADY_REDEEMED');
 },30000);
 it('zero redemption and no-cash invariant roll back when a movement exists',async()=>{
  await register(104);await approve(104);await pool!.request().query('UPDATE dbo.CutOfferCampaign SET FirstVisitPct=100');
  const save=(bad:boolean)=>atomic(async tx=>{const q=await quoteDecemberInTransaction(tx,input(104));expect(q.payablePiasters).toBe(0);await invoice(tx,5004,104,1,200);if(bad)await new mssql.Request(tx).query("INSERT dbo.TblCashMove VALUES(5004,N'مبيعات')");await assertNoZeroInvoiceCash(tx,5004);await persistDecemberRedemption(tx,q,5004);});
  await expect(save(true)).rejects.toThrow('DECEMBER_ZERO_PAYMENT_SIDE_EFFECT');await save(false);
  const r=await pool!.request().query('SELECT COUNT(*) n FROM dbo.TblCashMove;SELECT PercentApplied FROM dbo.CutOfferRedemption;');const sets=r.recordsets as Array<Array<Record<string,number>>>;expect(sets[0][0].n).toBe(0);expect(sets[1][0].PercentApplied).toBe(100);
 });
 it('old customer is not a first visit in another branch and cannot confirm a referral',async()=>{
  const owner=await register(101);await register(103,owner.referralCode);await approve(101);await approve(103);
  await atomic(tx=>invoice(tx,5010,103,1,0));
  await expect(quoteDecember(input(103,2))).rejects.toThrow('DECEMBER_NO_DISCOUNT');
  await atomic(async tx=>{await invoice(tx,5011,103,2,0);await confirmStagingDecemberReferral(tx,{invoiceId:5011,clientId:103,branchId:2});});
  expect((await quoteDecember(input(101))).percent).toBe(10);
 });
 it('checks active Club link, active loyalty and student verification from SQL',async()=>{
  await registerDecemberParticipant(tenant,{name:'Synthetic student',phone:'01000000101',student:true,education:{type:'UNIVERSITY',university:'Test university',faculty:'Test faculty'}});
  await approve(101);
  expect((await quoteDecember(input(101))).percent).toBe(10);
  await pool!.request().query(`
    UPDATE dbo.CutOfferParticipant SET StudentVerifiedAtUtc=SYSUTCDATETIME(),StudentVerifiedBy=1 WHERE ClientId=101;
    INSERT dbo.TblClientLoyalty(ClientLoyaltyID,ClientID,IsActive) VALUES(1101,101,1);
    INSERT dbo.CutClubMemberAccount(TenantId,PhoneNormalized,LegacyClientID,LinkStatus,LinkApprovedBy,LinkApprovedAtUtc,LinkProofType)
    VALUES('${tenant}','201000000101',101,'ACTIVE',1,SYSUTCDATETIME(),'IN_PERSON_ID');
  `);
  expect((await quoteDecember(input(101))).percent).toBe(25);
  await pool!.request().query('UPDATE dbo.TblClientLoyalty SET IsActive=0 WHERE ClientID=101');
  expect((await quoteDecember(input(101))).percent).toBe(20);
 });
 it('pause denies fresh registration and quote even after a successful previous quote',async()=>{
  await register(101);await approve(101);expect((await quoteDecember(input(101))).percent).toBe(10);
  await pool!.request().query("UPDATE dbo.CutOfferCampaign SET Status='PAUSED'");
  await expect(quoteDecember(input(101))).rejects.toThrow('DECEMBER_REGISTRATION_REQUIRED');
  await expect(register(105)).rejects.toThrow('CAMPAIGN_UNAVAILABLE');
 });

 it('blocks duplicate historical phone written with Arabic or Persian digits',async()=>{
  await register(101);await approve(101);
  for(const alias of ['٠١٠٠٠٠٠٠١٠١','۰۰۲۰۱۰۰۰۰۰۰۱۰۱','+20 (100) 000-0101']){
   await pool!.request().input('alias',mssql.NVarChar(30),alias).query('UPDATE dbo.TblClient SET Mobile=@alias WHERE ClientID=105');
   try{await expect(quoteDecember(input(101))).rejects.toThrow('DECEMBER_IDENTITY_REVIEW');}
   finally{await pool!.request().query("UPDATE dbo.TblClient SET Mobile='01000000105' WHERE ClientID=105");}
  }
 });
 it('does not confirm referral if invitee phone belongs to two canonical clients',async()=>{
  const owner=await register(101);await register(102,owner.referralCode);await approve(101);await approve(102);
  await pool!.request().query("UPDATE dbo.TblClient SET Mobile=N'٠١٠٠٠٠٠٠١٠٢' WHERE ClientID=105");
  try{
   await atomic(async tx=>{await invoice(tx,5020,102,2,0);await confirmStagingDecemberReferral(tx,{invoiceId:5020,clientId:102,branchId:2});});
   expect((await quoteDecember(input(101))).percent).toBe(10);
  }finally{await pool!.request().query("UPDATE dbo.TblClient SET Mobile='01000000105' WHERE ClientID=105");}
 });

 it('closes old invitation links after inviter redemption without blocking independent registration',async()=>{
  const owner=await register(101);await approve(101);
  await register(102,owner.referralCode);
  await atomic(async tx=>{const q=await quoteDecemberInTransaction(tx,input(101));await invoice(tx,5030,101,1,q.discountPiasters/100);await persistDecemberRedemption(tx,q,5030);});
  await expect(register(103,owner.referralCode)).rejects.toThrow('INVALID_REFERRAL_CODE');
  const independent=await register(103);expect(independent.referralStatus).toBeNull();
  const r=await pool!.request().query('SELECT COUNT(*) n FROM dbo.CutOfferReferral');expect(r.recordset[0].n).toBe(1);
 });

});
