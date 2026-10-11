#!/usr/bin/env npx tsx
/**
 * DRVOERP permanent sales-demo tenant seed.
 *
 * Production-only by explicit approval. Creates ONLY tenant DRVO_DEMO and refuses CASHER_BOOT.
 * No WhatsApp/AI app is installed, public booking stays off, and seeded customer phones are synthetic.
 */
import path from 'path';
import dotenv from 'dotenv';
import Module from 'module';
import sql from 'mssql';

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const moduleWithLoad = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(request: string, parent: unknown, isMain: boolean) {
  if (request === 'server-only') return {};
  return originalLoad.call(moduleWithLoad, request, parent, isMain);
};

const APPROVAL = 'CREATE_DRVO_DEMO_V1';
const TENANT_CODE = 'DRVO_DEMO';
const MARKER = 'DRVO_DEMO_V1';
const OWNER_LOGIN = 'demo.owner';
const DEMO_NAME = "NOVA Men's Salon — DRVO Demo";

const BRANCHES = [
  {
    branchName: 'NOVA Smouha Demo',
    branchCode: 'DRVO_DEMO_SMOUHA',
    shortName: 'Smouha',
    address: 'سموحة، الإسكندرية',
    phone: '01000000011',
    timezone: 'Africa/Cairo',
    defaultOpenTime: '11:00',
    defaultCloseTime: '23:00',
  },
  {
    branchName: 'NOVA Louran Demo',
    branchCode: 'DRVO_DEMO_LOURAN',
    shortName: 'Louran',
    address: 'لوران، الإسكندرية',
    phone: '01000000012',
    timezone: 'Africa/Cairo',
    defaultOpenTime: '12:00',
    defaultCloseTime: '00:00',
  },
] as const;

const SERVICES = [
  { name: 'Hair Cut', arabicName: 'قص شعر', categoryName: 'خدمات', price: 200, durationMinutes: 30, active: true },
  { name: 'Beard Styling', arabicName: 'تهذيب دقن', categoryName: 'خدمات', price: 120, durationMinutes: 20, active: true },
  { name: 'Hair & Beard', arabicName: 'شعر ودقن', categoryName: 'خدمات', price: 280, durationMinutes: 45, active: true },
  { name: 'Classic Skin Care', arabicName: 'تنظيف بشرة كلاسيك', categoryName: 'خدمات', price: 300, durationMinutes: 45, active: true },
  { name: 'Deep Skin Care', arabicName: 'تنظيف بشرة عميق', categoryName: 'خدمات', price: 450, durationMinutes: 60, active: true },
  { name: 'Hair Styling', arabicName: 'تصفيف شعر', categoryName: 'خدمات', price: 150, durationMinutes: 20, active: true },
  { name: 'Hair Protein', arabicName: 'بروتين شعر', categoryName: 'خدمات', price: 900, durationMinutes: 90, active: true },
  { name: 'Nose & Ear Wax', arabicName: 'واكس الأنف والأذن', categoryName: 'خدمات', price: 100, durationMinutes: 15, active: true },
] as const;

const EMPLOYEES = [
  { name: 'يوسف علي', job: 'حلاق', primaryBranchCode: 'DRVO_DEMO_SMOUHA', active: true, acceptsBookings: true, employmentType: 'full_time', payrollMethod: 'monthly', payRate: 6500 },
  { name: 'كريم حسن', job: 'حلاق', primaryBranchCode: 'DRVO_DEMO_SMOUHA', active: true, acceptsBookings: true, employmentType: 'full_time', payrollMethod: 'monthly', payRate: 6000 },
  { name: 'سارة محمود', job: 'تنظيف بشرة', primaryBranchCode: 'DRVO_DEMO_SMOUHA', active: true, acceptsBookings: false, employmentType: 'part_time', payrollMethod: 'daily', payRate: 350 },
  { name: 'عمر سامح', job: 'حلاق', primaryBranchCode: 'DRVO_DEMO_LOURAN', active: true, acceptsBookings: true, employmentType: 'full_time', payrollMethod: 'monthly', payRate: 6200 },
  { name: 'زياد رامي', job: 'حلاق', primaryBranchCode: 'DRVO_DEMO_LOURAN', active: true, acceptsBookings: true, employmentType: 'full_time', payrollMethod: 'monthly', payRate: 5800 },
  { name: 'نور أحمد', job: 'تنظيف بشرة', primaryBranchCode: 'DRVO_DEMO_LOURAN', active: true, acceptsBookings: false, employmentType: 'part_time', payrollMethod: 'daily', payRate: 350 },
] as const;

const USERS = [
  { displayName: 'Demo Manager', loginName: 'demo.manager', roleKey: 'manager', defaultBranchCode: 'DRVO_DEMO_SMOUHA' },
  { displayName: 'Demo Reception', loginName: 'demo.reception', roleKey: 'receptionist', defaultBranchCode: 'DRVO_DEMO_SMOUHA' },
  { displayName: 'Demo Cashier Smouha', loginName: 'demo.cashier.smouha', roleKey: 'cashier', defaultBranchCode: 'DRVO_DEMO_SMOUHA' },
  { displayName: 'Demo Cashier Louran', loginName: 'demo.cashier.louran', roleKey: 'cashier', defaultBranchCode: 'DRVO_DEMO_LOURAN' },
] as const;

const CUSTOMERS = [
  ['عميل Demo Walk-in', null],
  ['محمد ياسر', '01000000002'],
  ['علي محمود', '01000000003'],
  ['عمر أشرف', '01000000004'],
  ['يوسف وليد', '01000000005'],
  ['كريم عمرو', '01000000006'],
  ['مروان سامي', '01000000007'],
  ['زياد أحمد', '01000000008'],
  ['حسن محمد', '01000000009'],
  ['آدم شريف', '01000000010'],
] as const;

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
  console.log('PASS:', message);
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function cairoLocalToUtc(date: string, hhmm: string): Date {
  const [y,m,d] = date.split('-').map(Number);
  const [hh,mm] = hhmm.split(':').map(Number);
  // Egypt is UTC+3 during the October 2026 DST window. Exact wall-clock display also persists separately.
  return new Date(Date.UTC(y!, m! - 1, d!, hh! - 3, mm!, 0));
}

async function main() {
  check(process.env.DRVO_DEMO_PRODUCTION_APPROVAL === APPROVAL, 'explicit production demo approval present');
  const ownerPassword = String(process.env.DRVO_DEMO_OWNER_PASSWORD || 'DrvoDemo#2026!Sales');
  check(ownerPassword.length >= 14, 'demo owner password is strong enough');

  const { getPool, closePool } = await import('../../src/lib/db');
  const { findIndustryPack } = await import('../../src/packs');
  const {
    onboardBusiness,
    defaultOnboardingDeps,
  } = await import('../../src/platform/onboarding/wizard/coordinator');
  const { grantStaffAccessToAllActiveBranches } = await import('../../src/lib/branch/userLoginBranch');
  const { validateSessionBranch } = await import('../../src/lib/branch/context');
  const { openShift, closeShift } = await import('../../src/lib/branch/shiftSession');
  const { getOpenBusinessDay } = await import('../../src/lib/branch/businessDay');
  const { createSale } = await import('../../src/apps/pos/application/createSale');
  const { computeInvoiceItemsTotals } = await import('../../src/lib/sales/service-line-totals');
  const { purgeSmokeTenant } = await import('./smokeTenantPurge');

  const pool = await getPool();
  let created = false;
  try {
    const identity = await pool.request().query("SELECT DB_NAME() AS db, SUSER_SNAME() AS login;");
    const liveDb = String(identity.recordset[0]?.db ?? '');
    check(liveDb === 'last132', 'database identity = last132 production');

    const existing = await pool
      .request()
      .input('code', sql.NVarChar(64), TENANT_CODE)
      .query('SELECT TenantId, Name FROM dbo.Tenant WHERE Code=@code;');

    if (existing.recordset.length) {
      const tid = String(existing.recordset[0].TenantId);
      const counts = await pool.request().input('tenantId', sql.UniqueIdentifier, tid).query(`
        SELECT
          (SELECT COUNT(*) FROM dbo.Location WHERE TenantId=@tenantId) AS branches,
          (SELECT COUNT(*) FROM dbo.TenantMembership WHERE TenantId=@tenantId) AS users,
          (SELECT COUNT(*) FROM dbo.TblPro WHERE TenantId=@tenantId) AS services,
          (SELECT COUNT(*) FROM dbo.TblEmp WHERE TenantId=@tenantId) AS employees;
      `);
      const c = counts.recordset[0];
      check(Number(c.branches) >= 2 && Number(c.users) >= 5 && Number(c.services) >= 8 && Number(c.employees) >= 6,
        'existing DRVO_DEMO tenant is already fully seeded');
      console.log('DEMO_ALREADY_EXISTS=YES');
      console.log('DEMO_LOGIN=' + OWNER_LOGIN);
      console.log('DEMO_PASSWORD_UNCHANGED=YES');
      return;
    }

    const actorRow = await pool.request().query(`
      SELECT TOP 1 u.UserID, u.UserName
      FROM dbo.TblUser u
      JOIN dbo.TenantMembership m ON m.LegacyUserId=u.UserID
      JOIN dbo.Tenant t ON t.TenantId=m.TenantId AND t.Code=N'CASHER_BOOT'
      JOIN dbo.TblUserRoles ur ON ur.UserID=u.UserID
      JOIN dbo.TblRoles r ON r.RoleID=ur.RoleID AND r.RoleKey=N'super_admin'
      WHERE ISNULL(u.isDeleted,0)=0
      ORDER BY u.UserID;
    `);
    check(actorRow.recordset.length === 1, 'platform operator found');
    const actor = {
      actorUserId: Number(actorRow.recordset[0].UserID),
      actorUserName: String(actorRow.recordset[0].UserName || 'platform-operator'),
    };

    const bootIdRow = await pool.request().query("SELECT TenantId FROM dbo.Tenant WHERE Code=N'CASHER_BOOT';");
    const bootId = String(bootIdRow.recordset[0].TenantId);
    const bootBefore = await pool.request().input('tenantId',sql.UniqueIdentifier,bootId).query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.TblPro WHERE TenantId=@tenantId) services,
        (SELECT COUNT(*) FROM dbo.TblEmp WHERE TenantId=@tenantId) employees,
        (SELECT COUNT(*) FROM dbo.TblClient WHERE TenantId=@tenantId) clients,
        (SELECT COUNT(*) FROM dbo.Location WHERE TenantId=@tenantId) branches,
        (SELECT COUNT(*) FROM dbo.TenantMembership WHERE TenantId=@tenantId) users;
    `);

    const sharedUserPassword = ownerPassword.slice(0, 12) + 'U9!';
    const req: any = {
      business: {
        businessName: DEMO_NAME,
        tenantCode: TENANT_CODE,
        industryPackCode: 'salon',
        timezone: 'Africa/Cairo',
        currency: 'EGP',
        businessPhone: '01000000000',
        logoUrl: null,
        primaryColor: '#0F172A',
        accentColor: '#C9A96E',
        receiptFooter: 'DRVOERP Demo — بيانات تجريبية فقط',
      },
      branches: BRANCHES.map((b) => ({ ...b })),
      services: SERVICES.map((s) => ({ ...s })),
      employees: EMPLOYEES.map((e) => ({ ...e })),
      owner: { displayName: 'DRVO Demo Owner', loginName: OWNER_LOGIN, password: ownerPassword },
      users: USERS.map((u) => ({ ...u, password: sharedUserPassword })),
      apps: { add: [], remove: [] },
      subscription: { planCode: 'growth', status: 'active' },
      booking: BRANCHES.map((b) => ({
        branchCode: b.branchCode,
        defaultMode: 'nearest',
        slotIntervalMinutes: 15,
        minNoticeMinutes: 30,
        maxBookingDaysAhead: 14,
        defaultServiceDurationMinutes: 30,
        allowSpecificBarber: true,
        allowNearestBarber: true,
      })),
      ai: null,
    };

    console.log('Creating DRVO demo tenant...');
    const result = await onboardBusiness(req, actor, defaultOnboardingDeps(findIndustryPack));
    created = true;
    check(result.complete, 'onboarding stages complete');
    check(result.core.tenantCode === TENANT_CODE, 'tenant code DRVO_DEMO created');
    const tenantId = result.core.tenantId;

    const locs = await pool.request().input('tenantId',sql.UniqueIdentifier,tenantId).query(`
      SELECT l.BranchCode,l.LegacyBranchId,b.BranchName,b.IsActive,b.LifecycleStatus
      FROM dbo.Location l JOIN dbo.TblBranch b ON b.BranchID=l.LegacyBranchId
      WHERE l.TenantId=@tenantId;
    `);
    const branchMap = new Map<string,{id:number;name:string}>();
    for(const row of locs.recordset){
      branchMap.set(String(row.BranchCode),{id:Number(row.LegacyBranchId),name:String(row.BranchName)});
    }
    const smouha = branchMap.get('DRVO_DEMO_SMOUHA');
    const louran = branchMap.get('DRVO_DEMO_LOURAN');
    check(smouha && louran,'both demo branches exist');

    // The second onboarding branch intentionally starts SETUP. For the permanent demo tenant only,
    // promote it to internal-live while keeping public booking and external messaging OFF.
    await pool.request()
      .input('tenantId',sql.UniqueIdentifier,tenantId)
      .input('branchId',sql.Int,louran!.id)
      .input('actor',sql.Int,actor.actorUserId)
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM dbo.Location WHERE TenantId=@tenantId AND LegacyBranchId=@branchId
        ) THROW 51000, 'Demo branch tenant ownership mismatch', 1;

        UPDATE dbo.TblBranch
        SET IsActive=1, LifecycleStatus=N'INTERNAL_LIVE',
            PublicBookingEnabled=0, ExternalNotificationsEnabled=0,
            UpdatedAt=SYSUTCDATETIME()
        WHERE BranchID=@branchId;

        UPDATE dbo.Location SET Status=N'active' WHERE TenantId=@tenantId AND LegacyBranchId=@branchId;
        UPDATE dbo.QueueBookingSettings SET BookingEnabled=0 WHERE BranchID=@branchId;

        INSERT INTO dbo.TblBranchLifecycleAudit
          (BranchID,FromStatus,ToStatus,Reason,ActorUserID,ReadinessJson)
        VALUES
          (@branchId,N'SETUP',N'INTERNAL_LIVE',N'DRVO permanent demo tenant activation',@actor,N'{"source":"DRVO_DEMO_V1"}');
      `);

    const userRows = await pool.request().input('tenantId',sql.UniqueIdentifier,tenantId).query(`
      SELECT u.UserID,u.loginName
      FROM dbo.TenantMembership m JOIN dbo.TblUser u ON u.UserID=m.LegacyUserId
      WHERE m.TenantId=@tenantId;
    `);
    const userMap = new Map<string,number>(userRows.recordset.map((r:any)=>[String(r.loginName),Number(r.UserID)]));
    const ownerId = userMap.get(OWNER_LOGIN);
    const managerId = userMap.get('demo.manager');
    const cashierSmouha = userMap.get('demo.cashier.smouha');
    const cashierLouran = userMap.get('demo.cashier.louran');
    check(ownerId && managerId && cashierSmouha && cashierLouran,'demo users created');

    for (const uid of [ownerId!, managerId!]) {
      await grantStaffAccessToAllActiveBranches({
        tenantId,
        userId: uid,
        actorUserId: actor.actorUserId,
        preferredBranchId: smouha!.id,
        grantReason: MARKER,
      });
    }

    const customerIds:number[]=[];
    for(const [name,phone] of CUSTOMERS){
      const ins=await pool.request()
        .input('tenantId',sql.UniqueIdentifier,tenantId)
        .input('name',sql.NVarChar(200),name)
        .input('phone',sql.NVarChar(200),phone)
        .query(`
          INSERT INTO dbo.TblClient (TenantId,[Name],Mobile,RegisterDate)
          OUTPUT INSERTED.ClientID AS id
          VALUES (@tenantId,@name,@phone,GETDATE());
        `);
      customerIds.push(Number(ins.recordset[0].id));
    }
    check(customerIds.length===10,'10 synthetic demo customers created');

    const serviceRows=await pool.request().input('tenantId',sql.UniqueIdentifier,tenantId).query(`
      SELECT ProID,ProName,ISNULL(Bonus,0) Bonus FROM dbo.TblPro WHERE TenantId=@tenantId;
    `);
    const serviceMap=new Map<string,{id:number;bonus:number}>();
    for(const r of serviceRows.recordset){
      serviceMap.set(String(r.ProName),{id:Number(r.ProID),bonus:Number(r.Bonus||0)});
    }
    for(const s of SERVICES) check(serviceMap.has(s.name),`service exists: ${s.name}`);

    const empRows=await pool.request().input('tenantId',sql.UniqueIdentifier,tenantId).query(`
      SELECT EmpID,EmpName FROM dbo.TblEmp WHERE TenantId=@tenantId;
    `);
    const empMap=new Map<string,number>(empRows.recordset.map((r:any)=>[String(r.EmpName),Number(r.EmpID)]));
    for(const e of EMPLOYEES) check(empMap.has(e.name),`employee exists: ${e.name}`);

    const pay=await pool.request().input('tenantId',sql.UniqueIdentifier,tenantId).query(`
      SELECT TOP 1 PaymentID FROM dbo.TblPaymentMethods
      WHERE TenantId=@tenantId AND PaymentMethod=N'كاش' ORDER BY PaymentID;
    `);
    check(pay.recordset.length===1,'tenant cash payment method exists');
    const cashPaymentId=Number(pay.recordset[0].PaymentID);

    const priceByName=new Map(SERVICES.map((s)=>[s.name,s.price]));
    const salePatterns=[
      ['Hair Cut'],['Hair & Beard'],['Beard Styling','Nose & Ear Wax'],['Hair Cut','Hair Styling'],
      ['Classic Skin Care'],['Hair & Beard','Hair Styling'],['Deep Skin Care'],['Hair Protein'],
    ];

    async function seedSales(branch:{id:number;name:string;code:string},userId:number,employeeNames:string[],count:number){
      const ctx=await validateSessionBranch(userId,branch.id,branch.code,new Date(Date.now()+60_000));
      const shift=await openShift(ctx,userId,1);
      const day=await getOpenBusinessDay(branch.id);
      check(day,'open business day exists for '+branch.code);
      let total=0;
      for(let i=0;i<count;i++){
        const names=salePatterns[i % salePatterns.length]!;
        const items=names.map((name,idx)=>{
          const svc=serviceMap.get(name)!;
          const empName=employeeNames[(i+idx)%employeeNames.length]!;
          return {proId:svc.id,empId:empMap.get(empName)!,sPrice:priceByName.get(name)!,bonus:svc.bonus,qty:1,dis:0,disVal:0,notes:name};
        });
        const computed=computeInvoiceItemsTotals(items.map((x)=>({
          sPrice:x.sPrice,qty:x.qty,discountPercent:x.dis,discountValue:x.disVal,bonus:x.bonus
        })),{discountPercent:0,discountValue:0});
        await createSale({
          items,
          clientId:customerIds[0]!,
          notes:`${MARKER} / ${branch.code} / sale ${i+1}`,
          payCash:computed.grandTotal,
          payVisa:0,
          paymentAllocations:[{paymentMethodId:cashPaymentId,amount:computed.grandTotal}],
          computed,
          branchId:branch.id,
          businessDayId:day!.id,
          shiftMoveID:shift.id,
          invDate:day!.newDay,
          userID:userId,
          splitCfg:{clearingMethodId:-1,expenseCatId:-1,incomeCatId:-1},
          activeAllocations:[{paymentMethodId:cashPaymentId,amount:computed.grandTotal}],
          isSplitPayment:false,
          headerPaymentMethodId:cashPaymentId,
          branchName:branch.name,
        });
        total+=computed.grandTotal;
      }
      try{ await closeShift(ctx,shift.id); }catch(err){ console.warn('WARN: demo shift close failed:',err instanceof Error?err.message:String(err)); }
      return total;
    }

    const smouhaRevenue=await seedSales(
      {id:smouha!.id,name:smouha!.name,code:'DRVO_DEMO_SMOUHA'},
      cashierSmouha!,['يوسف علي','كريم حسن','سارة محمود'],8
    );
    const louranRevenue=await seedSales(
      {id:louran!.id,name:louran!.name,code:'DRVO_DEMO_LOURAN'},
      cashierLouran!,['عمر سامح','زياد رامي','نور أحمد'],8
    );
    console.log('Seeded demo revenue:',smouhaRevenue+louranRevenue);

    // Upcoming calendar data. Direct insert is deliberate: public booking stays OFF and no notifications are emitted.
    const now=new Date();
    const bookings=[
      {days:1,time:'13:00',branch:'DRVO_DEMO_SMOUHA',emp:'يوسف علي',service:'Hair Cut',customer:0,source:'website'},
      {days:1,time:'15:30',branch:'DRVO_DEMO_SMOUHA',emp:'كريم حسن',service:'Hair & Beard',customer:1,source:'phone'},
      {days:2,time:'17:00',branch:'DRVO_DEMO_SMOUHA',emp:'يوسف علي',service:'Beard Styling',customer:2,source:'walk_in'},
      {days:3,time:'19:00',branch:'DRVO_DEMO_SMOUHA',emp:'كريم حسن',service:'Hair Styling',customer:3,source:'website'},
      {days:1,time:'14:00',branch:'DRVO_DEMO_LOURAN',emp:'عمر سامح',service:'Hair Cut',customer:4,source:'website'},
      {days:2,time:'16:00',branch:'DRVO_DEMO_LOURAN',emp:'زياد رامي',service:'Hair & Beard',customer:5,source:'phone'},
      {days:3,time:'18:30',branch:'DRVO_DEMO_LOURAN',emp:'عمر سامح',service:'Beard Styling',customer:6,source:'website'},
      {days:4,time:'20:00',branch:'DRVO_DEMO_LOURAN',emp:'زياد رامي',service:'Hair Styling',customer:7,source:'walk_in'},
    ];

    const tx=new sql.Transaction(pool);
    await tx.begin();
    try{
      for(let i=0;i<bookings.length;i++){
        const b=bookings[i]!;
        const date=dateOnly(addDays(now,b.days));
        const svc=SERVICES.find((x)=>x.name===b.service)!;
        const endMins=Number(b.time.slice(0,2))*60+Number(b.time.slice(3))+svc.durationMinutes;
        const end=`${String(Math.floor(endMins/60)%24).padStart(2,'0')}:${String(endMins%60).padStart(2,'0')}`;
        const branch=branchMap.get(b.branch)!;
        const empId=empMap.get(b.emp)!;
        const svcId=serviceMap.get(b.service)!.id;
        const absStart=cairoLocalToUtc(date,b.time);
        const absEnd=new Date(absStart.getTime()+svc.durationMinutes*60000);
        const code=`DMD${String(i+1).padStart(4,'0')}`;
        const ins=await new sql.Request(tx)
          .input('clientId',sql.Int,customerIds[b.customer]!)
          .input('empId',sql.Int,empId)
          .input('bDate',sql.Date,date)
          .input('sTime',sql.VarChar,b.time)
          .input('eTime',sql.VarChar,end)
          .input('source',sql.NVarChar,b.source)
          .input('notes',sql.NVarChar(500),MARKER+' synthetic booking')
          .input('code',sql.NVarChar,code)
          .input('createdBy',sql.Int,ownerId!)
          .input('branchId',sql.Int,branch.id)
          .input('workDate',sql.Date,date)
          .input('absStart',sql.DateTime2,absStart)
          .input('absEnd',sql.DateTime2,absEnd)
          .query(`
            INSERT INTO dbo.Bookings
              (ClientID,AssignedEmpID,BookingDate,StartTime,EndTime,Status,Source,Notes,BookingCode,CreatedByUserID,
               BranchID,PublicWorkDate,PublicDayOffset,AbsoluteStartUtc,AbsoluteEndUtc,PlanFingerprint,IdempotencyRequestID)
            OUTPUT INSERTED.BookingID
            VALUES
              (@clientId,@empId,@bDate,@sTime,@eTime,N'confirmed',@source,@notes,@code,@createdBy,
               @branchId,@workDate,0,@absStart,@absEnd,NULL,NULL);
          `);
        const bookingId=Number(ins.recordset[0].BookingID);
        await new sql.Request(tx)
          .input('bookingId',sql.Int,bookingId)
          .input('proId',sql.Int,svcId)
          .input('empId',sql.Int,empId)
          .input('price',sql.Decimal(18,2),svc.price)
          .input('mins',sql.Int,svc.durationMinutes)
          .query(`
            INSERT INTO dbo.BookingServices (BookingID,ProID,EmpID,Qty,Price,DurationMinutes)
            VALUES (@bookingId,@proId,@empId,1,@price,@mins);
          `);
      }
      await tx.commit();
    }catch(err){
      await tx.rollback();
      throw err;
    }
    check(true,'8 synthetic upcoming bookings created without notifications');

    const verify=await pool.request().input('tenantId',sql.UniqueIdentifier,tenantId)
      .input('marker',sql.NVarChar(100),MARKER+'%')
      .query(`
        SELECT
          (SELECT COUNT(*) FROM dbo.Location WHERE TenantId=@tenantId) branches,
          (SELECT COUNT(*) FROM dbo.TenantMembership WHERE TenantId=@tenantId) users,
          (SELECT COUNT(*) FROM dbo.TblPro WHERE TenantId=@tenantId) services,
          (SELECT COUNT(*) FROM dbo.TblEmp WHERE TenantId=@tenantId) employees,
          (SELECT COUNT(*) FROM dbo.TblClient WHERE TenantId=@tenantId) clients,
          (SELECT COUNT(*) FROM dbo.Bookings b JOIN dbo.Location l ON l.LegacyBranchId=b.BranchID WHERE l.TenantId=@tenantId AND b.Notes LIKE @marker) bookings,
          (SELECT COUNT(*) FROM dbo.TblinvServHead h JOIN dbo.Location l ON l.LegacyBranchId=h.BranchID WHERE l.TenantId=@tenantId AND h.Notes LIKE @marker) sales,
          (SELECT ISNULL(SUM(h.GrandTotal),0) FROM dbo.TblinvServHead h JOIN dbo.Location l ON l.LegacyBranchId=h.BranchID WHERE l.TenantId=@tenantId AND h.Notes LIKE @marker) revenue,
          (SELECT COUNT(*) FROM dbo.TenantAiConfig WHERE TenantId=@tenantId) aiConfig;
      `);
    const v=verify.recordset[0];
    check(Number(v.branches)===2,'verify: 2 branches');
    check(Number(v.users)===5,'verify: 5 users');
    check(Number(v.services)===8,'verify: 8 services');
    check(Number(v.employees)===6,'verify: 6 employees');
    check(Number(v.clients)===10,'verify: 10 customers');
    check(Number(v.bookings)===8,'verify: 8 bookings');
    check(Number(v.sales)===16,'verify: 16 sales');
    check(Number(v.revenue)>0,'verify: populated sales reports');
    check(Number(v.aiConfig)===0,'verify: AI remains unconfigured');

    const publicFlags=await pool.request().input('tenantId',sql.UniqueIdentifier,tenantId).query(`
      SELECT COUNT(*) bad
      FROM dbo.Location l JOIN dbo.TblBranch b ON b.BranchID=l.LegacyBranchId
      WHERE l.TenantId=@tenantId AND (ISNULL(b.PublicBookingEnabled,0)<>0 OR ISNULL(b.ExternalNotificationsEnabled,0)<>0);
    `);
    check(Number(publicFlags.recordset[0].bad)===0,'public booking and external notifications remain OFF');

    const bookingLeaks=await pool.request().input('tenantId',sql.UniqueIdentifier,tenantId)
      .input('marker',sql.NVarChar(100),MARKER+'%').query(`
      SELECT COUNT(*) bad
      FROM dbo.Bookings b
      LEFT JOIN dbo.Location l ON l.LegacyBranchId=b.BranchID AND l.TenantId=@tenantId
      LEFT JOIN dbo.TblClient c ON c.ClientID=b.ClientID AND c.TenantId=@tenantId
      LEFT JOIN dbo.TblEmp e ON e.EmpID=b.AssignedEmpID AND e.TenantId=@tenantId
      WHERE b.Notes LIKE @marker AND (l.LocationId IS NULL OR c.ClientID IS NULL OR e.EmpID IS NULL);
    `);
    check(Number(bookingLeaks.recordset[0].bad)===0,'booking references are tenant-isolated');

    const saleLeaks=await pool.request().input('tenantId',sql.UniqueIdentifier,tenantId)
      .input('marker',sql.NVarChar(100),MARKER+'%').query(`
      SELECT COUNT(*) bad
      FROM dbo.TblinvServHead h
      JOIN dbo.TblinvServDetail d ON d.invID=h.invID AND d.invType=h.invType
      LEFT JOIN dbo.Location l ON l.LegacyBranchId=h.BranchID AND l.TenantId=@tenantId
      LEFT JOIN dbo.TblPro p ON p.ProID=d.ProID AND p.TenantId=@tenantId
      LEFT JOIN dbo.TblEmp e ON e.EmpID=d.EmpID AND e.TenantId=@tenantId
      WHERE h.Notes LIKE @marker AND (l.LocationId IS NULL OR p.ProID IS NULL OR e.EmpID IS NULL);
    `);
    check(Number(saleLeaks.recordset[0].bad)===0,'sale references are tenant-isolated');

    const bootAfter=await pool.request().input('tenantId',sql.UniqueIdentifier,bootId).query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.TblPro WHERE TenantId=@tenantId) services,
        (SELECT COUNT(*) FROM dbo.TblEmp WHERE TenantId=@tenantId) employees,
        (SELECT COUNT(*) FROM dbo.TblClient WHERE TenantId=@tenantId) clients,
        (SELECT COUNT(*) FROM dbo.Location WHERE TenantId=@tenantId) branches,
        (SELECT COUNT(*) FROM dbo.TenantMembership WHERE TenantId=@tenantId) users;
    `);
    check(JSON.stringify(bootBefore.recordset[0])===JSON.stringify(bootAfter.recordset[0]),'CASHER_BOOT tenant counts unchanged');

    console.log('DRVO_DEMO_SEED=PASS');
    console.log('DEMO_TENANT='+TENANT_CODE);
    console.log('DEMO_NAME='+DEMO_NAME);
    console.log('DEMO_LOGIN='+OWNER_LOGIN);
    console.log('DEMO_PLAN=Growth Active');
    console.log('DEMO_BRANCHES=2');
    console.log('DEMO_SERVICES=8');
    console.log('DEMO_EMPLOYEES=6');
    console.log('DEMO_CUSTOMERS=10');
    console.log('DEMO_BOOKINGS=8');
    console.log('DEMO_SALES=16');
    console.log('DEMO_REVENUE='+Number(v.revenue).toFixed(2));
  } catch (err) {
    console.error('DRVO demo seed failed:', err instanceof Error ? err.stack || err.message : err);
    if (created) {
      try {
        const { purgeSmokeTenant } = await import('./smokeTenantPurge');
        await purgeSmokeTenant(pool, TENANT_CODE);
        console.error('Rollback cleanup: DRVO_DEMO purged after failure.');
      } catch (cleanupErr) {
        console.error('CRITICAL: DRVO_DEMO cleanup failed:', cleanupErr);
      }
    }
    throw err;
  } finally {
    await closePool().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error('DRVO demo seed fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
