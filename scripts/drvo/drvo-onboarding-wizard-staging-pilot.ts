#!/usr/bin/env npx tsx
import Module from 'module';
import sql from 'mssql';

const m = Module as unknown as { _load: (...args: unknown[]) => unknown };
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

const DB='last132_agent';
const LOGIN='drvo_agent';
const CODE='NOVA_PILOT';
const OWNER='nova_pilot_owner';
const OWNER_PASS='N0vaPilotOwner!26';

function ok(v: unknown, msg: string): asserts v {
  if (!v) throw new Error(msg);
  console.log('PASS:', msg);
}

function setEnv(password: string) {
  const server=process.env.DRVO_STAGING_DB_SERVER || '127.0.0.1';
  const port=process.env.DRVO_STAGING_DB_PORT || '14330';
  Object.assign(process.env,{
    DB_SERVER:server,DB_PORT:port,DB_DATABASE:DB,DB_USER:LOGIN,DB_PASSWORD:password,
    DB_ENCRYPT:'false',DB_TRUST_SERVER_CERTIFICATE:'true',
    CLOUD_DB_SERVER:server,CLOUD_DB_PORT:port,CLOUD_DB_NAME:DB,CLOUD_DB_USER:LOGIN,
    CLOUD_DB_PASSWORD:password,CLOUD_DB_ENCRYPT:'false',CLOUD_DB_TRUST_CERT:'true'
  });
}

async function count(pool: sql.ConnectionPool, q: string, tenantId?: string) {
  const r=pool.request();
  if (tenantId) r.input('tenantId',sql.UniqueIdentifier,tenantId);
  const x=await r.query(q);
  return Number(x.recordset[0]?.n || 0);
}

async function bootSnapshot(pool: sql.ConnectionPool, tenantId: string) {
  return {
    services: await count(pool,'SELECT COUNT(*) n FROM dbo.TblPro WHERE TenantId=@tenantId',tenantId),
    employees: await count(pool,'SELECT COUNT(*) n FROM dbo.TblEmp WHERE TenantId=@tenantId',tenantId),
    memberships: await count(pool,'SELECT COUNT(*) n FROM dbo.TenantMembership WHERE TenantId=@tenantId',tenantId),
    locations: await count(pool,'SELECT COUNT(*) n FROM dbo.Location WHERE TenantId=@tenantId',tenantId),
    ai: await count(pool,'SELECT COUNT(*) n FROM dbo.TenantAiConfig WHERE TenantId=@tenantId',tenantId),
    booking: await count(pool,'SELECT COUNT(*) n FROM dbo.QueueBookingSettings q JOIN dbo.Location l ON l.LegacyBranchId=q.BranchID WHERE l.TenantId=@tenantId',tenantId),
  };
}

async function tenantCounts(pool: sql.ConnectionPool, tenantId: string) {
  return {
    locations: await count(pool,'SELECT COUNT(*) n FROM dbo.Location WHERE TenantId=@tenantId',tenantId),
    memberships: await count(pool,'SELECT COUNT(*) n FROM dbo.TenantMembership WHERE TenantId=@tenantId',tenantId),
    services: await count(pool,"SELECT COUNT(*) n FROM dbo.TblPro WHERE TenantId=@tenantId AND ProName IN (N'Hair Cut',N'Beard Styling',N'Hair & Beard',N'Skin Care')",tenantId),
    employees: await count(pool,"SELECT COUNT(*) n FROM dbo.TblEmp WHERE TenantId=@tenantId AND EmpName IN (N'Ahmed Pilot',N'Karim Pilot',N'Mona Pilot')",tenantId),
    booking: await count(pool,'SELECT COUNT(*) n FROM dbo.QueueBookingSettings q JOIN dbo.Location l ON l.LegacyBranchId=q.BranchID WHERE l.TenantId=@tenantId',tenantId),
  };
}

async function main() {
  const password=process.env.DRVO_STAGING_DB_PASSWORD || '';
  ok(password,'staging password is configured');
  setEnv(password);
  const pool=await sql.connect({
    server:process.env.DB_SERVER!,port:Number(process.env.DB_PORT),database:DB,user:LOGIN,password,
    options:{encrypt:false,trustServerCertificate:true,enableArithAbort:true},requestTimeout:120000
  });
  let createdTenantId:string|null=null;
  try {
    const id=(await pool.request().query("SELECT DB_NAME() db,SUSER_SNAME() login,HAS_DBACCESS(N'last132') prod")).recordset[0];
    ok(id.db===DB,'DB_NAME = last132_agent');
    ok(String(id.login).toLowerCase()===LOGIN,'SUSER_SNAME = drvo_agent');
    ok(Number(id.prod)===0,'HAS_DBACCESS(last132) = 0');

    const { purgeSmokeTenant }=await import('./smokeTenantPurge');
    await purgeSmokeTenant(pool,CODE).catch(()=>false);

    const boot=(await pool.request().query("SELECT TenantId FROM dbo.Tenant WHERE Code=N'CASHER_BOOT'")).recordset;
    ok(boot.length===1,'CASHER_BOOT exists once');
    const bootId=String(boot[0].TenantId);
    const before=await bootSnapshot(pool,bootId);

    const op=(await pool.request().input('bootId',sql.UniqueIdentifier,bootId).query(`
      SELECT TOP 1 u.UserID,u.UserName
      FROM dbo.TblUser u
      JOIN dbo.TenantMembership m ON m.LegacyUserId=u.UserID AND m.TenantId=@bootId
      JOIN dbo.TblUserRoles ur ON ur.UserID=u.UserID
      JOIN dbo.TblRoles r ON r.RoleID=ur.RoleID AND r.RoleKey=N'super_admin'
      WHERE ISNULL(u.isDeleted,0)=0 ORDER BY u.UserID
    `)).recordset[0];
    ok(op,'staging platform operator exists');

    const plan=(await pool.request().query(`
      SELECT TOP 1 PlanCode FROM dbo.SaaSPlan
      WHERE IsActive=1 AND (MaxBranches IS NULL OR MaxBranches>=2) AND (MaxUsers IS NULL OR MaxUsers>=3)
      ORDER BY CASE WHEN PlanCode=N'growth' THEN 0 WHEN PlanCode=N'pro' THEN 1 ELSE 2 END,SortOrder
    `)).recordset[0];
    ok(plan,'active plan supports 2 branches and 3 users');
    const planCode=String(plan.PlanCode);

    const req:any={
      business:{businessName:"NOVA Men's Salon",tenantCode:CODE,industryPackCode:'salon',timezone:'Africa/Cairo',currency:'EGP',businessPhone:null,logoUrl:null,primaryColor:null,accentColor:null,receiptFooter:null},
      branches:[
        {branchName:'NOVA Smouha',branchCode:'NOVA_SMOUHA',shortName:'Smouha',timezone:'Africa/Cairo',defaultOpenTime:'11:00',defaultCloseTime:'23:00'},
        {branchName:'NOVA Louran',branchCode:'NOVA_LOURAN',shortName:'Louran',timezone:'Africa/Cairo',defaultOpenTime:'12:00',defaultCloseTime:'00:00'}
      ],
      services:[
        {name:'Hair Cut',arabicName:'قص شعر',categoryName:'خدمات',price:180,durationMinutes:30,active:true},
        {name:'Beard Styling',arabicName:'تهذيب دقن',categoryName:'خدمات',price:90,durationMinutes:20,active:true},
        {name:'Hair & Beard',arabicName:'شعر ودقن',categoryName:'خدمات',price:250,durationMinutes:45,active:true},
        {name:'Skin Care',arabicName:'عناية بالبشرة',categoryName:'خدمات',price:220,durationMinutes:45,active:true}
      ],
      employees:[
        {name:'Ahmed Pilot',job:'حلاق',primaryBranchCode:'NOVA_SMOUHA',active:true,acceptsBookings:true},
        {name:'Karim Pilot',job:'حلاق',primaryBranchCode:'NOVA_LOURAN',active:true,acceptsBookings:true},
        {name:'Mona Pilot',job:'موظف استقبال',primaryBranchCode:'NOVA_SMOUHA',active:true,acceptsBookings:false}
      ],
      owner:{displayName:'Nova Owner',loginName:OWNER,password:OWNER_PASS},
      users:[
        {displayName:'Nova Reception',loginName:'nova_pilot_reception',password:'N0vaReception!26',roleKey:'receptionist',defaultBranchCode:'NOVA_SMOUHA'},
        {displayName:'Nova Cashier',loginName:'nova_pilot_cashier',password:'N0vaCashier!26',roleKey:'cashier',defaultBranchCode:'NOVA_SMOUHA'}
      ],
      apps:{add:[],remove:[]},
      subscription:{planCode,status:'trial'},
      booking:[
        {branchCode:'NOVA_SMOUHA',defaultMode:'nearest',slotIntervalMinutes:15,minNoticeMinutes:30,maxBookingDaysAhead:14,defaultServiceDurationMinutes:30,allowSpecificBarber:true,allowNearestBarber:true},
        {branchCode:'NOVA_LOURAN',defaultMode:'nearest',slotIntervalMinutes:15,minNoticeMinutes:30,maxBookingDaysAhead:14,defaultServiceDurationMinutes:30,allowSpecificBarber:true,allowNearestBarber:true}
      ],
      ai:null
    };

    const { findIndustryPack }=await import('../../src/packs');
    const { preflightOnboarding }=await import('../../src/platform/onboarding/wizard/preflight');
    const { onboardBusiness,retryOnboardingSetup,defaultOnboardingDeps }=await import('../../src/platform/onboarding/wizard/coordinator');

    const pre=await preflightOnboarding(req,findIndustryPack);
    if(!pre.ok) console.error(JSON.stringify(pre.issues,null,2));
    ok(pre.ok,'wizard preflight PASS');

    const result=await onboardBusiness(req,{actorUserId:Number(op.UserID),actorUserName:String(op.UserName)},defaultOnboardingDeps(findIndustryPack));
    createdTenantId=result.core.tenantId;
    ok(result.complete,'Create Business completed all applicable stages');
    ok(result.core.tenantCode===CODE,'NOVA_PILOT tenant created');

    const c=await tenantCounts(pool,createdTenantId);
    ok(c.locations===2,'2 branches/locations');
    ok(c.memberships===3,'owner + receptionist + cashier');
    ok(c.services===4,'4 services');
    ok(c.employees===3,'3 employees');
    ok(c.booking===2,'2 branch booking settings');

    const owner=(await pool.request().input('login',sql.NVarChar(50),OWNER).query("SELECT UserID,Password FROM dbo.TblUser WHERE loginName=@login AND ISNULL(isDeleted,0)=0")).recordset[0];
    ok(owner,'owner login row exists');
    const { isPasswordHash,verifyPassword }=await import('../../src/lib/auth/passwordHash');
    ok(isPasswordHash(String(owner.Password)),'owner password is hashed');
    ok((await verifyPassword(OWNER_PASS,String(owner.Password))).ok,'owner credentials verify');

    const rows=(await pool.request().input('tenantId',sql.UniqueIdentifier,createdTenantId).query(`
      SELECT l.BranchCode,b.IsActive,b.LifecycleStatus,b.PublicBookingEnabled,b.ExternalNotificationsEnabled
      FROM dbo.Location l JOIN dbo.TblBranch b ON b.BranchID=l.LegacyBranchId
      WHERE l.TenantId=@tenantId
    `)).recordset;
    const first=rows.find((x:any)=>x.BranchCode==='NOVA_SMOUHA');
    const second=rows.find((x:any)=>x.BranchCode==='NOVA_LOURAN');
    ok(Boolean(first?.IsActive)&&first?.LifecycleStatus==='INTERNAL_LIVE','first branch INTERNAL_LIVE');
    ok(!Boolean(first?.PublicBookingEnabled)&&!Boolean(first?.ExternalNotificationsEnabled),'first branch remains private');
    ok(!Boolean(second?.IsActive)&&second?.LifecycleStatus==='SETUP','second branch SETUP');
    ok(!Boolean(second?.PublicBookingEnabled)&&!Boolean(second?.ExternalNotificationsEnabled),'second branch remains private');

    for(const app of ['booking','queue','pos','attendance','payroll','treasury','reports']) ok(result.core.apps.includes(app),`app on: ${app}`);
    for(const app of ['messaging','ai-receptionist','inventory','purchasing']) ok(!result.core.apps.includes(app),`app off: ${app}`);
    ok(await count(pool,'SELECT COUNT(*) n FROM dbo.TenantAiConfig WHERE TenantId=@tenantId',createdTenantId)===0,'AI is not configured');

    const beforeRetry=await tenantCounts(pool,createdTenantId);
    const retry=await retryOnboardingSetup(createdTenantId,req,{actorUserId:Number(op.UserID),actorUserName:String(op.UserName)},defaultOnboardingDeps(findIndustryPack));
    ok(retry.complete,'Retry Setup PASS');
    const afterRetry=await tenantCounts(pool,createdTenantId);
    ok(JSON.stringify(beforeRetry)===JSON.stringify(afterRetry),'retry is idempotent');
    ok(await count(pool,"SELECT COUNT(*) n FROM dbo.Tenant WHERE Code=N'NOVA_PILOT'")===1,'retry does not duplicate tenant');

    const after=await bootSnapshot(pool,bootId);
    ok(JSON.stringify(before)===JSON.stringify(after),'CASHER_BOOT counts unchanged');

    ok(await purgeSmokeTenant(pool,CODE),'pilot cleanup succeeded');
    createdTenantId=null;
    ok(await count(pool,"SELECT COUNT(*) n FROM dbo.Tenant WHERE Code=N'NOVA_PILOT'")===0,'NOVA_PILOT residue = 0');
    ok(JSON.stringify(before)===JSON.stringify(await bootSnapshot(pool,bootId)),'CASHER_BOOT unchanged after cleanup');

    console.log('DRVO ONBOARDING WIZARD STAGING PILOT PASS');
  } finally {
    if(createdTenantId){
      try { const { purgeSmokeTenant }=await import('./smokeTenantPurge'); await purgeSmokeTenant(pool,CODE); } catch {}
    }
    await pool.close();
  }
}
main().catch(e=>{console.error('DRVO ONBOARDING WIZARD STAGING PILOT FAIL:',e instanceof Error?e.message:e);process.exit(1);});
