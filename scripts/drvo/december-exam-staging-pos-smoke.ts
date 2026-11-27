/** Real legacy-schema POS adapter smoke. Always rollback; no post-commit effects.
 * Runs only on the private staging tunnel. No actual customer records are reused. */
import sql from 'mssql';
import Module from 'module';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
const loader=Module as unknown as {_load:(name:string,...rest:unknown[])=>unknown};
const original=loader._load;
loader._load=function(name,...rest){return name==='server-only'?{}:original.call(this,name,...rest);};
function check(ok:unknown,code:string):asserts ok{if(!ok)throw Error(code);}
async function main(){
 check(process.env.CI==='true'&&process.env.DECEMBER_STAGING_POS_SMOKE==='true','EXPLICIT_STAGING_SMOKE_REQUIRED');
 const password=process.env.DRVO_STAGING_DB_PASSWORD;check(password,'STAGING_PASSWORD_REQUIRED');
 // Guard any incidental app connection before imports.
 Object.assign(process.env,{DB_SERVER:'127.0.0.1',DB_PORT:'14330',DB_DATABASE:'last132_agent',DB_USER:'drvo_agent',DB_PASSWORD:password,DB_ENCRYPT:'false',DB_TRUST_SERVER_CERTIFICATE:'true',CLOUD_DB_SERVER:'127.0.0.1',CLOUD_DB_PORT:'14330',CLOUD_DB_NAME:'last132_agent',CLOUD_DB_USER:'drvo_agent',CLOUD_DB_PASSWORD:password,CLOUD_DB_ENCRYPT:'false',CLOUD_DB_TRUST_CERT:'true'});
 for(const key of ['LOCAL_DB_SERVER','LOCAL_DB_PORT','LOCAL_DB_NAME','LOCAL_DB_USER','LOCAL_DB_PASSWORD','DB_TRUSTED_CONNECTION','LOCAL_DB_TRUSTED_CONNECTION','BOOKING_V2_USE_TRUSTED_CONNECTION'])delete process.env[key];
 const pool=await new sql.ConnectionPool({server:'127.0.0.1',port:14330,database:'last132_agent',user:'drvo_agent',password,options:{encrypt:false,trustServerCertificate:true},connectionTimeout:15000,requestTimeout:45000}).connect();
 try{
 const identity=await pool.request().query("SELECT DB_NAME() db,SUSER_SNAME() login");
 check(identity.recordset[0]?.db==='last132_agent'&&identity.recordset[0]?.login==='drvo_agent','STAGING_IDENTITY_REQUIRED');
 const {executeLegacySaleCreateTransaction}=await import('../../src/apps/pos/internal/legacySaleCreateAdapter');
 const {computeInvoiceItemsTotals}=await import('../../src/lib/sales/service-line-totals');
 const {resolveSplitPaymentConfig}=await import('../../src/lib/clearingMethod');
 const {quoteDecemberInTransaction}=await import('../../src/lib/campaigns/december-exam/stagingCheckout');
 const {campaignSessionDigest}=await import('../../src/lib/campaigns/december-exam/registrationRepository');
 const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 let rolledBack=false;const ids:number[]=[];const clients:number[]=[];let campaignId='';
 try{
 const rq=()=>new sql.Request(tx);
 await rq().query('SET LOCK_TIMEOUT 8000');
 const t=await rq().query<{TenantId:string}>("SELECT TenantId FROM dbo.Tenant WHERE Code=N'CASHER_BOOT' AND Status=N'active'");
 check(t.recordset.length===1,'STAGING_TENANT_REQUIRED');const tenant=t.recordset[0].TenantId;
 const q=()=>rq().input('tenant',sql.UniqueIdentifier,tenant);
 const existing=await q().query("SELECT CampaignId FROM dbo.CutOfferCampaign WITH(UPDLOCK,HOLDLOCK) WHERE TenantId=@tenant AND Code='DECEMBER_EXAM_2026'");
 check(!existing.recordset.length,'EXISTING_CAMPAIGN_REFUSE_FIXTURE');
 const operation=await q().query<{BranchID:number;DayID:number;ShiftID:number;UserID:number;InvDate:string}>(`
 SELECT TOP(1) s.BranchID,d.ID DayID,s.ID ShiftID,s.UserID,CONVERT(varchar(10),d.NewDay,23) InvDate
 FROM dbo.TblShiftMove s JOIN dbo.TblNewDay d ON d.ID=s.BusinessDayID AND d.BranchID=s.BranchID
 JOIN dbo.Location l ON l.TenantId=@tenant AND l.LegacyBranchId=s.BranchID AND l.Status=N'active'
 WHERE s.Status=1 AND d.Status=1 ORDER BY s.ID DESC
 `);
 const op=operation.recordset[0];check(op,'STAGING_OPEN_DAY_SHIFT_REQUIRED');
 const service=await q().query<{ProID:number;SPrice1:number}>(`
 SELECT TOP(1) p.ProID,p.SPrice1 FROM dbo.TblPro p JOIN dbo.TblCat c ON c.CatID=p.CatID AND c.TenantId=p.TenantId
 WHERE p.TenantId=@tenant AND p.ProID=9 AND ISNULL(p.isDeleted,0)=0 AND ISNULL(c.CatType,'')<>'pro' AND p.SPrice1>0
 `);
 const svc=service.recordset[0];check(svc,'STAGING_TEST_SERVICE_REQUIRED');
 const emp=await q().query<{EmpID:number}>("SELECT TOP(1) EmpID FROM dbo.TblEmp WHERE TenantId=@tenant AND ISNULL(isActive,1)=1 ORDER BY EmpID");
 check(emp.recordset[0],'STAGING_TEST_EMPLOYEE_REQUIRED');
 const splitCfg=await resolveSplitPaymentConfig(tx);
 const payment=await q().input('clearing',sql.Int,splitCfg.clearingMethodId).query<{PaymentID:number}>(`
 SELECT TOP(1) PaymentID FROM dbo.TblPaymentMethods WHERE TenantId=@tenant AND PaymentID<>@clearing AND PaymentMethod<>N'بدون تحصيل - عرض ديسمبر' ORDER BY PaymentID
 `);
 check(payment.recordset[0],'STAGING_TEST_PAYMENT_REQUIRED');
 campaignId=randomUUID();
 await q().input('campaign',sql.UniqueIdentifier,campaignId).query(`
 INSERT dbo.CutOfferCampaign(TenantId,CampaignId,Code,Status,StartsAtUtc,EndsAtUtc,FirstVisitPct,StudentPct,ClubPct,MultiServicePct,Friend1Pct,Friend2Pct,Friend3Pct)
 VALUES(@tenant,@campaign,'DECEMBER_EXAM_2026','ACTIVE',DATEADD(hour,-1,SYSUTCDATETIME()),DATEADD(hour,1,SYSUTCDATETIME()),10,0,0,0,20,45,75)
 `);
 Object.assign(process.env,{DECEMBER_EXAM_TENANT_ID:tenant,DECEMBER_EXAM_STAGING_CHECKOUT_ENABLED:'true',DECEMBER_EXAM_STAGING_REFERRAL_ENABLED:'true',DECEMBER_EXAM_ELIGIBLE_SERVICE_IDS:String(svc.ProID)});
 async function makeClient(){
  const phone='010'+String(randomBytes(4).readUInt32BE()%100000000).padStart(8,'0');
  const mobile='+2'+phone;
  const client=await q().input('phone',sql.NVarChar(30),phone).input('mobile',sql.NVarChar(30),mobile).query<{ClientID:number}>(`
   IF EXISTS(SELECT 1 FROM dbo.TblClient WITH(UPDLOCK,HOLDLOCK) WHERE TenantId=@tenant AND Mobile IN(@phone,@mobile)) THROW 51910,'FIXTURE_PHONE_COLLISION',1;
   INSERT dbo.TblClient(TenantId,Name,Mobile,RegisterDate) OUTPUT inserted.ClientID VALUES(@tenant,N'DECEMBER_ROLLBACK_FIXTURE',@phone,GETDATE());
  `);
  const id=client.recordset[0].ClientID;clients.push(id);
  await q().input('campaign',sql.UniqueIdentifier,campaignId).input('participant',sql.UniqueIdentifier,randomUUID()).input('client',sql.Int,id).input('phone',sql.VarChar(16),mobile)
   .input('code',sql.VarChar(32),'CUT-'+randomBytes(8).toString('hex').toUpperCase()).input('digest',sql.Char(64),campaignSessionDigest(randomBytes(32).toString('base64url'))).input('user',sql.Int,op.UserID).query(`
   INSERT dbo.CutOfferParticipant(TenantId,CampaignId,ParticipantId,ClientId,PhoneNormalized,DisplayName,IsStudent,ReferralCode,SessionDigest,IdentityVerifiedAtUtc,IdentityVerifiedBy)
   VALUES(@tenant,@campaign,@participant,@client,@phone,N'DECEMBER_ROLLBACK_FIXTURE',0,@code,@digest,SYSUTCDATETIME(),@user)
  `);
  return id;
 }
 const item={proId:svc.ProID,empId:emp.recordset[0].EmpID,sPrice:Number(svc.SPrice1),qty:1,bonus:0,dis:0,disVal:0,notes:'DECEMBER_ROLLBACK_FIXTURE'};
 async function sale(clientId:number,method:number,expectedPercent:number){
  const quote=await quoteDecemberInTransaction(tx,{tenantId:tenant,branchId:op.BranchID,clientId,items:[item]});
  check(quote.percent===expectedPercent,'UNEXPECTED_FIXTURE_DISCOUNT');
  const computed=computeInvoiceItemsTotals([{sPrice:item.sPrice,qty:1,bonus:0}],{discountPercent:quote.percent,discountValue:quote.discountPiasters/100});
  const amount=quote.payablePiasters/100,allocations=amount?[{paymentMethodId:method,amount}]:[];
  const result=await executeLegacySaleCreateTransaction(tx,{items:[item],clientId,notes:'DECEMBER_ROLLBACK_FIXTURE',payCash:0,payVisa:0,paymentAllocations:allocations,computed,decemberClaim:{tenantId:tenant,expectedDiscountMinor:quote.discountPiasters},branchId:op.BranchID,businessDayId:op.DayID,shiftMoveID:op.ShiftID,invDate:op.InvDate,userID:op.UserID,splitCfg,activeAllocations:allocations,isSplitPayment:false,headerPaymentMethodId:method});
  ids.push(result.invID);
  const facts=await rq().input('invoice',sql.Int,result.invID).query<{paymentCount:number;paymentSum:number;cashCount:number;cashSum:number;redeemed:number}>(`
   SELECT (SELECT COUNT(*) FROM dbo.TblinvServPayment WHERE invID=@invoice AND invType=N'مبيعات') paymentCount,
   (SELECT COALESCE(SUM(PayValue),0) FROM dbo.TblinvServPayment WHERE invID=@invoice AND invType=N'مبيعات') paymentSum,
   (SELECT COUNT(*) FROM dbo.TblCashMove WHERE invID=@invoice AND invType=N'مبيعات') cashCount,
   (SELECT COALESCE(SUM(GrandTolal),0) FROM dbo.TblCashMove WHERE invID=@invoice AND invType=N'مبيعات') cashSum,
   (SELECT COUNT(*) FROM dbo.CutOfferRedemption WHERE InvoiceId=@invoice) redeemed
  `);
  const f=facts.recordset[0];check(f.redeemed===1&&f.paymentCount===(amount?1:0)&&f.cashCount===(amount?1:0)&&Math.round(Number(f.paymentSum)*100)===quote.payablePiasters&&Math.round(Number(f.cashSum)*100)===quote.payablePiasters,'STAGING_FINANCIAL_INVARIANT_FAILED');
 }
 await sale(await makeClient(),payment.recordset[0].PaymentID,10);
 console.log('REAL_POS_ADAPTER_POSITIVE_PAYMENT_PASS');
 // Prepare the dedicated method and trigger only INSIDE this rollback transaction.
 const method=await q().query<{PaymentID:number}>(`
 IF NOT EXISTS(SELECT 1 FROM dbo.TblPaymentMethods WHERE TenantId=@tenant AND PaymentMethod=N'بدون تحصيل - عرض ديسمبر')
 INSERT dbo.TblPaymentMethods(TenantId,PaymentMethod) VALUES(@tenant,N'بدون تحصيل - عرض ديسمبر');
 SELECT PaymentID FROM dbo.TblPaymentMethods WHERE TenantId=@tenant AND PaymentMethod=N'بدون تحصيل - عرض ديسمبر';
 `);
 check(method.recordset.length===1,'STAGING_ZERO_METHOD_CONFLICT');
 await rq().batch(readFileSync('docs/december-exam/sql/zero-payment-trigger-staging-only.sql','utf8'));
 process.env.DECEMBER_EXAM_STAGING_ZERO_PAYMENT_ENABLED='true';process.env.DECEMBER_EXAM_ZERO_PAYMENT_METHOD_ID=String(method.recordset[0].PaymentID);
 await q().input('campaign',sql.UniqueIdentifier,campaignId).query('UPDATE dbo.CutOfferCampaign SET FirstVisitPct=100 WHERE TenantId=@tenant AND CampaignId=@campaign');
 await sale(await makeClient(),method.recordset[0].PaymentID,100);
 console.log('REAL_POS_ADAPTER_ZERO_PAYMENT_PASS');
 }finally{await tx.rollback();rolledBack=true;}
 check(rolledBack,'STAGING_ROLLBACK_REQUIRED');
 const proof=await pool.request().input('campaign',sql.UniqueIdentifier,campaignId).query('SELECT COUNT(*) n FROM dbo.CutOfferCampaign WHERE CampaignId=@campaign');
 check(proof.recordset[0]?.n===0,'STAGING_FIXTURE_LEAK');
 for(const id of clients){const r=await pool.request().input('id',sql.Int,id).query('SELECT COUNT(*) n FROM dbo.TblClient WHERE ClientID=@id');check(r.recordset[0]?.n===0,'STAGING_CUSTOMER_LEAK');}
 for(const id of ids){const r=await pool.request().input('id',sql.Int,id).query("SELECT COUNT(*) n FROM dbo.TblinvServHead WHERE invID=@id AND invType=N'مبيعات'");check(r.recordset[0]?.n===0,'STAGING_INVOICE_LEAK');}
 console.log('REAL_POS_ADAPTER_ROLLBACK_PASS — no public activation or post-commit effects');
 }finally{await pool.close();}
}
main().catch(e=>{console.error(e instanceof Error?e.message:'STAGING_POS_SMOKE_FAILED');process.exitCode=1;});
