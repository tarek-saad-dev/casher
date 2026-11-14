#!/usr/bin/env npx tsx
/**
 * Authenticated HTTP staging acceptance for CUT Referral 50/20 and POS UUID.
 *
 * Creates a uniquely named disposable salon via official onboarding, opens its
 * own business day and shift, authenticates through /api/auth/login, makes real
 * paid POST /api/sales requests, replays them, and uses the AUDITED refund route.
 * Then purges the disposable tenant and verifies there is no residual money.
 *
 * Never uses CUT real clients or payment gateways. Last132_agent/drvo_agent
 * only, strictly localhost HTTP, no .env files and no production credentials.
 *
 * This is staging evidence, NOT independent approval or a browser UX test.
 */
import Module from 'module';
import crypto from 'node:crypto';
import mssql from 'mssql';
import { spawn, type ChildProcess } from 'node:child_process';

const loader = Module as unknown as {
  _load: (name: string, parent: unknown, isMain: boolean) => unknown;
};
const original = loader._load;
loader._load = function allowServerOnly(name, parent, isMain) {
  if (name === 'server-only') return {};
  return original.call(loader, name, parent, isMain);
};

const DB = 'last132_agent';
const LOGIN = 'drvo_agent';
const BASE = 'http://127.0.0.1:5521';
const MARKER = 'CUT248-HTTP-' + crypto.randomBytes(6).toString('hex').toUpperCase();
const PHONE = '010' + String(crypto.randomInt(10000000, 99999999));

function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error('CUT-248-HTTP E2E FAILED: ' + label);
  console.log('PASS: ' + label);
}
function setStagingEnv() {
  const secret = process.env.DRVO_STAGING_DB_PASSWORD;
  check(secret, 'protected staging secret configured');
  check(process.env.DB_DATABASE !== 'last132' &&
    process.env.CLOUD_DB_NAME !== 'last132', 'production env refused');
  Object.assign(process.env, {
    DB_SERVER: '127.0.0.1', DB_PORT: '14330', DB_DATABASE: DB,
    DB_USER: LOGIN, DB_PASSWORD: secret,
    DB_ENCRYPT: 'false', DB_TRUST_SERVER_CERTIFICATE: 'true',
    CLOUD_DB_SERVER: '127.0.0.1', CLOUD_DB_PORT: '14330',
    CLOUD_DB_NAME: DB, CLOUD_DB_USER: LOGIN, CLOUD_DB_PASSWORD: secret,
    CLOUD_DB_ENCRYPT: 'false', CLOUD_DB_TRUST_CERT: 'true',
    SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
    SESSION_COOKIE_SECURE: 'false',
    DRVO_FORCE_POS_PATH: 'extracted',
    POS_REFERRAL_CHECKOUT_ENABLED: 'true',
    POS_REFERRAL_REDEEM_ENABLED: 'true',
    POS_REFERRAL_REVERSAL_ENABLED: 'true',
    POS_SALE_IDEMPOTENCY_ENABLED: 'true',
    NEXT_PUBLIC_POS_SALE_IDEMPOTENCY_ENABLED: 'true',
    WHATSAPP_INTEGRATION_ENABLED: 'false',
    WHATSAPP_SALE_ENABLED: 'false',
    WHATSAPP_EMPLOYEE_SALE_ENABLED: 'false',
    WHATSAPP_FIRST_TIME_ENABLED: 'false',
    WHATSAPP_CAMPAIGNS_ENABLED: 'false',
  });
  return {
    server: '127.0.0.1', port: 14330, database: DB, user: LOGIN,
    password: secret, options: {
      encrypt: false, trustServerCertificate: true, enableArithAbort: true,
    }, requestTimeout: 120000,
  } satisfies mssql.config;
}
async function assertIdentity(pool: mssql.ConnectionPool) {
  const id = await pool.request().query('SELECT DB_NAME() AS Db, SUSER_SNAME() AS LoginName;');
  check(id.recordset[0]?.Db === DB &&
    String(id.recordset[0]?.LoginName).toLowerCase() === LOGIN,
  'dedicated SQL staging DB and user checked before any mutation');
}
function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
async function http(uri: string, opts?: RequestInit): Promise<Response> {
  return fetch(BASE + uri, { ...opts, signal: AbortSignal.timeout(120000) });
}
function asJson(method: string, body: unknown, cookie?: string): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  };
}
async function requireStatus(r: Response, status: number, label: string) {
  const data = await r.json() as Record<string, unknown>;
  check(r.status === status, label + ' status expected ' + status +
    ', received ' + r.status + ', code=' + String(data.code ?? data.error ?? 'none'));
  return data;
}

async function main(): Promise<void> {
  const config = setStagingEnv();
  const pool = await mssql.connect(config);
  let tenantCode: string | null = null;
  let app: ChildProcess | null = null;
  let smokeIds: number[] = [];
  let smokeRequestIds: string[] = [];
  let testTenantId = '';
  let branchId = 0;
  let appLog = '';
  try {
    await assertIdentity(pool);
    const { parsePublicSignupInput, buildOnboardingRequest } =
      await import('../../src/platform/publicSignup/service');
    const { findIndustryPack } = await import('../../src/packs');
    const { onboardBusiness, defaultOnboardingDeps } =
      await import('../../src/platform/onboarding/wizard/coordinator');
    const { saveEmployeeBranchWeeklySchedule } =
      await import('../../src/lib/hr/employeeBranchScheduleSave');
    const { getOpenBusinessDay, openBusinessDay, getBranchBusinessDate } =
      await import('../../src/lib/branch/businessDay');
    const { openShift } = await import('../../src/lib/branch/shiftSession');
    const { computeInvoiceItemsTotals } =
      await import('../../src/lib/sales/service-line-totals');
    const { resolveSplitPaymentConfig } =
      await import('../../src/lib/clearingMethod');

    const publicInput = parsePublicSignupInput({
      industry: 'salon', needs: ['booking'],
      contactName: MARKER + '-OWNER',
      businessName: MARKER, phone: PHONE,
      password: 'StagingOnlyPass123!', startMode: 'demo',
    });
    const req = buildOnboardingRequest(publicInput);
    tenantCode = req.business.tenantCode;
    check(tenantCode !== 'CASHER_BOOT' && req.owner.password &&
      req.employees.length > 0, 'unique disposable staging tenant definition');
    req.subscription = { planCode: 'starter', status: 'active' };
    const actorR = await pool.request().query(
      'SELECT TOP 1 UserID FROM dbo.TblUser WHERE ISNULL(isDeleted,0)=0 ORDER BY UserID');
    check(actorR.recordset.length === 1, 'staging onboarding actor available');
    const actor = { actorUserId: Number(actorR.recordset[0].UserID),
      actorUserName: 'cut248-http-smoke' };
    const result = await onboardBusiness(req, actor, defaultOnboardingDeps(findIndustryPack));
    check(result.complete, 'official salon onboarding completed');
    testTenantId = String(result.core.tenantId);
    const branchCode = String(result.core.branchCode);
    const branchR = await pool.request()
      .input('tenant', mssql.UniqueIdentifier, testTenantId)
      .input('code', mssql.NVarChar(30), branchCode)
      .query('SELECT LegacyBranchId AS BranchID FROM dbo.Location WHERE TenantId=@tenant AND BranchCode=@code');
    check(branchR.recordset.length === 1, 'tenant owns its synthetic branch');
    branchId = Number(branchR.recordset[0].BranchID);

    const ownerR = await pool.request()
      .input('tenant', mssql.UniqueIdentifier, testTenantId)
      .query(`SELECT TOP 1 m.LegacyUserId AS UserID
        FROM dbo.TenantMembership m
        JOIN dbo.TblUser u ON u.UserID=m.LegacyUserId
        WHERE m.TenantId=@tenant ORDER BY m.LegacyUserId DESC;`);
    check(ownerR.recordset.length > 0, 'synthetic tenant has its own owner');
    const userId = Number(ownerR.recordset[0].UserID);
    const shiftR = await pool.request().query(
      'SELECT TOP 1 ShiftID FROM dbo.TblShift ORDER BY ShiftID');
    check(shiftR.recordset.length > 0, 'staging shift template exists');
    const shiftId = Number(shiftR.recordset[0].ShiftID);
    const ctx = {
      userId, branchId, branchCode, branchName: req.branches[0].branchName,
      shortName: null, timeZone: 'Africa/Cairo',
      businessDayCutoffTime: '04:00',
      canOperate: true, canViewReports: true, canSwitch: true,
    };
    const workDate = getBranchBusinessDate(ctx);
    const day = await getOpenBusinessDay(branchId) ??
      await openBusinessDay(ctx, workDate);
    check(day.branchId === branchId && day.status, 'disposable branch operational day OPEN');
    const shift = await openShift(ctx, userId, shiftId);
    check(shift.status && shift.branchId === branchId &&
      shift.businessDayId === day.id, 'synthetic owner shift OPEN');

    const empR = await pool.request()
      .input('tenant', mssql.UniqueIdentifier, testTenantId)
      .input('name', mssql.NVarChar(200), req.employees[0].name)
      .query('SELECT EmpID FROM dbo.TblEmp WHERE TenantId=@tenant AND EmpName=@name');
    check(empR.recordset.length === 1, 'synthetic barber belongs to tenant');
    const empId = Number(empR.recordset[0].EmpID);
    await saveEmployeeBranchWeeklySchedule({
      empId, branchId, effectiveFrom: workDate, skipPayrollCheck: true,
      cells: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        dayOfWeek, isWorking: true, startTime: '00:00',
        endTime: '23:59', canReceiveBookings: true,
      })),
    });
    const serviceR = await pool.request()
      .input('tenant', mssql.UniqueIdentifier, testTenantId)
      .query(`
        SELECT TOP 1 p.ProID, p.SPrice1 AS Price, ISNULL(p.Bonus,0) AS Bonus
        FROM dbo.TblPro p
        LEFT JOIN dbo.TblCat c ON c.CatID=p.CatID
        WHERE p.TenantId=@tenant AND ISNULL(p.isDeleted,0)=0 AND p.SPrice1>0
          AND LOWER(LTRIM(RTRIM(ISNULL(c.CatType, N''))))<>N'pro'
          AND LOWER(LTRIM(RTRIM(ISNULL(p.ProType, N'')))) NOT IN (N'pro',N'product')
        ORDER BY p.ProID;
      `);
    check(serviceR.recordset.length === 1, 'tenant has active, priced barber service');
    const proId = Number(serviceR.recordset[0].ProID);
    const price = Number(serviceR.recordset[0].Price);
    const bonus = Number(serviceR.recordset[0].Bonus);
    check(price > 0 && Number.isFinite(price) && Number.isFinite(bonus),
      'real service catalog price and bonus valid');
    const splitCfg = await resolveSplitPaymentConfig(pool);
    const methodR = await pool.request()
      .input('tenant', mssql.UniqueIdentifier, testTenantId)
      .input('clearing', mssql.Int, splitCfg.clearingMethodId)
      .query('SELECT TOP 1 PaymentID FROM dbo.TblPaymentMethods WHERE TenantId=@tenant AND PaymentID<>@clearing ORDER BY PaymentID');
    check(methodR.recordset.length === 1, 'payment method available');
    const method = Number(methodR.recordset[0].PaymentID);

    const clientIds: number[] = [];
    for (const suffix of ['REFERRER','REFERRED']) {
      const customer = await pool.request()
        .input('tenant', mssql.UniqueIdentifier, testTenantId)
        .input('name', mssql.NVarChar(60), MARKER + '-' + suffix)
        .query(`INSERT INTO dbo.TblClient (TenantId,Name,Notes,RegisterDate)
          OUTPUT INSERTED.ClientID AS ClientID
          VALUES (@tenant,@name,N'CUT248-HTTP-SYNTHETIC',CAST(GETDATE() AS date));`);
      const id = Number(customer.recordset[0]?.ClientID);
      check(Number.isSafeInteger(id) && id>0, 'synthetic client row created');
      clientIds.push(id);
    }
    const [referrer, referred] = clientIds;

    // Authenticated requests run through real Next.js route handlers,
    // signed staff cookie, tenant resolution, branch and open-shift gates.
    app = spawn(process.execPath, [
      'node_modules/next/dist/bin/next','dev','--webpack',
      '--hostname','127.0.0.1','--port','5521',
    ], { env: { ...process.env, NEXT_TELEMETRY_DISABLED:'1' },
      stdio: ['ignore','pipe','pipe'] });
    app.stdout?.on('data', () => {});
    app.stderr?.on('data', chunk => {
      appLog=(appLog+String(chunk)).slice(-1700);
    });
    let ready = false;
    for (let attempt=0;attempt<90;attempt++) {
      check(app.exitCode===null, 'local HTTP server still active');
      try {
        const ping=await fetch(BASE+'/api/auth/login',{
          signal:AbortSignal.timeout(2000)});
        if(ping.ok){ready=true;break;}
      } catch { /* server starting */ }
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    check(ready, 'staging HTTP server listening only on localhost');
    const anonymous = await http('/api/pos/referrals/wallet?clientId='+referrer);
    check(anonymous.status===401 || anonymous.status===403,
      'anonymous wallet request denied');
    const oldPublic = await http('/api/public/client/referral?clientId='+referrer);
    check(oldPublic.status===410, 'legacy fake unauthenticated referral endpoint is gone');

    const login=await http('/api/auth/login',asJson('POST',{
      loginName:req.owner.loginName,password:req.owner.password }));
    const cookie=(login.headers.get('set-cookie')||'').split(';')[0];
    check(login.ok && cookie.startsWith('pos_session='),
      'synthetic owner successfully logged in with signed staff session');

    function salePayload(customerId: number, type: 'plain'|'first'|'reward',
      code?: string, voucherId?: number) {
      const rate = type==='first'?50:type==='reward'?20:0;
      const calculated=computeInvoiceItemsTotals([
        {sPrice:price,qty:1,bonus,discountPercent:0,discountValue:0},
      ],{discountPercent:rate});
      return {
        requestId:crypto.randomUUID(),
        clientId: customerId,
        ...(code?{referralCode:code}:{}),
        ...(voucherId?{referralVoucherId:voucherId}:{}),
        items:[{
          proId,empId,sPrice:price,bonus,qty:1,dis:0,disVal:0,
          sPriceAfterDis:calculated.grandTotal,notes:MARKER,
        }],
        subTotal:calculated.subTotal,
        dis:0,disVal:0,grandTotal:calculated.grandTotal,
        totalBonus:calculated.totalBonus,totalQty:1,
        paymentMethodId:method,
        paymentAllocations:[{paymentMethodId:method,amount:calculated.grandTotal}],
        payCash:calculated.grandTotal,payVisa:0,notes:MARKER,notes2:MARKER,
      };
    }
    async function postSale(payload: ReturnType<typeof salePayload>, label: string) {
      const first=await requireStatus(
        await http('/api/sales',asJson('POST',payload,cookie)),201,label+' creates invoice');
      const id=Number(first.invID);
      check(Number.isSafeInteger(id) && id>0,'invoice ID persisted: '+label);
      smokeIds.push(id);
      smokeRequestIds.push(payload.requestId);
      const replay=await requireStatus(
        await http('/api/sales',asJson('POST',payload,cookie)),200,label+' same UUID replay');
      check(Number(replay.invID)===id && replay.replayed===true,
        label+' replay never inserts another invoice');
      const hashChanged={...payload,notes:payload.notes+'-CHANGED'};
      const conflicted=await requireStatus(
        await http('/api/sales',asJson('POST',hashChanged,cookie)),409,
        label+' changed payload is rejected');
      check(conflicted.code==='IDEMPOTENCY_CONFLICT',
        label+' retry hash and session are bound');
      const sqlRow=await pool.request()
        .input('id',mssql.Int,id)
        .query(`SELECT h.GrandTotal,h.Payment,h.PayDue,
          (SELECT ISNULL(SUM(p.PayValue),0) FROM dbo.TblinvServPayment p
           WHERE p.invID=h.invID AND p.invType=h.invType) AS PaymentRows,
          (SELECT COUNT(*) FROM dbo.TblPosSaleRequest r
           WHERE r.InvID=h.invID AND r.InvType=h.invType) AS RequestRows
           FROM dbo.TblinvServHead h
           WHERE h.invID=@id AND h.invType=N'مبيعات';`);
      const row=sqlRow.recordset[0];
      check(row && money(Number(row.GrandTotal))===payload.grandTotal &&
        money(Number(row.Payment))===payload.grandTotal &&
        money(Number(row.PaymentRows))===payload.grandTotal &&
        Number(row.RequestRows)===1,'paid invoice/payment/key match from actual SQL: '+label);
      return id;
    }
    const ownerSale=salePayload(referrer,'plain');
    const ownerInvoice=await postSale(ownerSale,'referrer first visit');

    const sourceCodeR=await pool.request()
      .input('tenant',mssql.UniqueIdentifier,testTenantId)
      .input('client',mssql.Int,referrer)
      .query(`SELECT Code FROM dbo.TblReferralCustomerCode
        WHERE TenantId=@tenant AND ReferrerClientID=@client
          AND ActivatedAtUtc IS NOT NULL;`);
    check(sourceCodeR.recordset.length===1,'paid referrer owns permanent active code');
    const code=String(sourceCodeR.recordset[0].Code);
    const preview=await requireStatus(
      await http('/api/pos/referrals/preview?code='+encodeURIComponent(code)+
        '&referredClientId='+referred,{headers:{cookie}}),
      200,'authenticated first visit preview');
    check(preview.eligible===true && Number(preview.discountPercent)===50,
      '50% offer eligibility sourced from SQL');

    const foreignMethod = salePayload(referred,'first',code);
    foreignMethod.paymentMethodId = 2147483640;
    foreignMethod.paymentAllocations = [{
      paymentMethodId: 2147483640, amount: foreignMethod.grandTotal,
    }];
    const rejectedMethod = await requireStatus(
      await http('/api/sales',asJson('POST',foreignMethod,cookie)),404,
      'referral must reject unowned payment method');
    check(rejectedMethod.code==='REFERRAL_PAYMENT_METHOD_NOT_OWNED',
      'staff tenant must own payment method on referral checkout');

    const first=salePayload(referred,'first',code);
    const firstInvoice=await postSale(first,'50% referred first visit');
    const claim=await pool.request()
      .input('tenant',mssql.UniqueIdentifier,testTenantId)
      .input('client',mssql.Int,referred)
      .query(`SELECT c.Status AS ClaimStatus,c.FirstPaidInvID,
        v.VoucherID,v.Status AS VoucherStatus FROM dbo.TblReferralVisitClaim c
        JOIN dbo.TblReferralDiscountVoucher v ON v.TenantId=c.TenantId
           AND v.ClaimID=c.ClaimID
        WHERE c.TenantId=@tenant AND c.ReferredClientID=@client;`);
    check(claim.recordset.length===1 &&
      claim.recordset[0].ClaimStatus==='APPLIED' &&
      Number(claim.recordset[0].FirstPaidInvID)===firstInvoice &&
      claim.recordset[0].VoucherStatus==='ACTIVE',
      'one claim and one 20% voucher persisted for 50% purchase');
    const voucherId=Number(claim.recordset[0].VoucherID);
    const wallet=await requireStatus(
      await http('/api/pos/referrals/wallet?clientId='+referrer,{headers:{cookie}}),
      200,'authenticated earned wallet');
    check(Array.isArray(wallet.vouchers) &&
      wallet.vouchers.some((v:Record<string,unknown>)=>Number(v.voucherId)===voucherId),
      'wallet actually exposes earned voucher');

    const reward=salePayload(referrer,'reward',undefined,voucherId);
    const rewardInvoice=await postSale(reward,'20% subsequent voucher redemption');
    const spent=await pool.request()
      .input('tenant',mssql.UniqueIdentifier,testTenantId)
      .input('voucherId',mssql.BigInt,voucherId)
      .query(`SELECT Status,UsedInvID FROM dbo.TblReferralDiscountVoucher
        WHERE TenantId=@tenant AND VoucherID=@voucherId;`);
    check(spent.recordset[0]?.Status==='USED' &&
      Number(spent.recordset[0]?.UsedInvID)===rewardInvoice,
      'same 20% voucher marked USED by paid HTTP invoice');
    const foreign=await http('/api/pos/referrals/wallet?clientId=2147483640',
      {headers:{cookie}});
    check(foreign.status===404,'unowned customer ID is never exposed');

    async function refund(invoiceId:number,label:string) {
      const r=await requireStatus(
        await http('/api/sales/'+invoiceId,
          asJson('DELETE',{reason:'Synthetic CUT248 staging HTTP E2E refund'},cookie)),
        200,label+' audited refund');
      check(r.success===true && Number(r.auditId)>0,
        label+' audit record committed');
      const gone=await pool.request().input('id',mssql.Int,invoiceId)
        .query(`SELECT COUNT(*) AS cnt FROM dbo.TblinvServHead
          WHERE invID=@id AND invType=N'مبيعات';`);
      check(Number(gone.recordset[0].cnt)===0,label+' paid invoice removed');
      return r;
    }
    await refund(firstInvoice,'referred source');
    const preserved=await pool.request()
      .input('tenant',mssql.UniqueIdentifier,testTenantId)
      .input('voucherId',mssql.BigInt,voucherId)
      .query(`SELECT c.Status AS ClaimStatus,v.Status AS VoucherStatus
        FROM dbo.TblReferralDiscountVoucher v
        JOIN dbo.TblReferralVisitClaim c ON c.ClaimID=v.ClaimID
        WHERE v.TenantId=@tenant AND v.VoucherID=@voucherId;`);
    check(preserved.recordset[0]?.ClaimStatus==='REVERSED' &&
      preserved.recordset[0]?.VoucherStatus==='USED',
      'source refund keeps already-earned voucher per commercial policy');
    await refund(rewardInvoice,'voucher redemption');
    const restored=await pool.request()
      .input('tenant',mssql.UniqueIdentifier,testTenantId)
      .input('voucherId',mssql.BigInt,voucherId)
      .query(`SELECT Status,UsedInvID FROM dbo.TblReferralDiscountVoucher
        WHERE TenantId=@tenant AND VoucherID=@voucherId;`);
    check(restored.recordset[0]?.Status==='ACTIVE' &&
      restored.recordset[0]?.UsedInvID==null,
      'audited refund restores original voucher without new award');

    const afterRefund=await requireStatus(
      await http('/api/sales',asJson('POST',first,cookie)),409,
      'refunded invoice UUID tombstone still rejects replay');
    check(afterRefund.code==='IDEMPOTENCY_INCONSISTENT',
      'no double charge even after original paid invoice deleted');
    await refund(ownerInvoice,'referrer baseline');
    console.log('CUT248_REFERRAL_AUTHENTICATED_HTTP_STAGING_PASS');
  } finally {
    if(app && app.exitCode===null){
      app.kill('SIGTERM');
      await new Promise(resolve=>setTimeout(resolve,1000));
      if(app.exitCode===null)app.kill('SIGKILL');
    }
    if(tenantCode){
      await assertIdentity(pool);
      const {purgeSmokeTenant}=await import('./smokeTenantPurge');
      await purgeSmokeTenant(pool,tenantCode);
      const left=await pool.request()
        .input('code',mssql.NVarChar(64),tenantCode)
        .query('SELECT COUNT(*) AS cnt FROM dbo.Tenant WHERE Code=@code');
      check(Number(left.recordset[0]?.cnt)===0,'disposable tenant purged');
      for(const id of smokeIds){
        const remaining=await pool.request().input('id',mssql.Int,id)
          .query(`SELECT
            (SELECT COUNT(*) FROM dbo.TblinvServHead
             WHERE invID=@id AND invType=N'مبيعات') AS Heads,
            (SELECT COUNT(*) FROM dbo.TblCashMove
             WHERE invID=@id AND invType=N'مبيعات') AS Cash;`);
        check(Number(remaining.recordset[0].Heads)===0 &&
          Number(remaining.recordset[0].Cash)===0,
          'synthetic financial row cleanup proved');
      }
      for(const requestId of smokeRequestIds){
        const x=await pool.request()
          .input('id',mssql.UniqueIdentifier,requestId)
          .query('SELECT COUNT(*) AS cnt FROM dbo.TblPosSaleRequest WHERE RequestID=@id');
        check(Number(x.recordset[0].cnt)===0,'synthetic UUID ledger cleanup proved');
      }
    }
    await pool.close();
    try{const {closePool}=await import('../../src/lib/db');await closePool();}
    catch{/* shared pool may already be closed by the test */}
    if(appLog && process.exitCode===1)console.error('Local staging app diagnostic:',appLog);
  }
}
void main().then(()=>{console.log('CUT248_HTTP_SMOKE_EXIT_OK');process.exit(0);})
  .catch(e=>{console.error('CUT248_HTTP_SMOKE_EXIT_FAILED:',
    e instanceof Error?e.message:String(e));process.exit(1);});
