/**
 * Phase 1M — branch readiness engine.
 * Activation depends on blockers, not score alone.
 */
import 'server-only';
import { evaluateBranchOperationalReadiness } from './readiness';
import { getBranchById, getBranchByCode, branchNow } from './repository';
import type { BranchLifecycleStatus } from './types';
import { BranchDomainError } from './types';
import { getPool, sql } from '@/lib/db';

export type ReadinessGate = 'smoke' | 'internal_live' | 'public_live';

export type ReadinessItemStatus = 'pass' | 'warning' | 'blocker';

export type BranchReadinessItem = {
  key: string;
  section: string;
  title: string;
  status: ReadinessItemStatus;
  requiredFor: ReadinessGate[];
  details: string;
  remediationUrl?: string;
};

export type BranchReadinessEvaluation = {
  branchId: number;
  branchCode: string;
  lifecycleStatus: BranchLifecycleStatus;
  score: number;
  isReadyForSmoke: boolean;
  isReadyForInternalLive: boolean;
  isReadyForPublicLive: boolean;
  blockers: BranchReadinessItem[];
  warnings: BranchReadinessItem[];
  sections: Array<{ section: string; items: BranchReadinessItem[] }>;
  evaluatedAt: string;
};

function item(
  partial: Omit<BranchReadinessItem, 'requiredFor'> & { requiredFor?: ReadinessGate[] },
): BranchReadinessItem {
  return {
    requiredFor: partial.requiredFor ?? ['smoke', 'internal_live', 'public_live'],
    ...partial,
  };
}

function scoreFrom(items: BranchReadinessItem[]): number {
  if (!items.length) return 0;
  const weights = { pass: 1, warning: 0.5, blocker: 0 };
  const sum = items.reduce((acc, i) => acc + weights[i.status], 0);
  return Math.round((sum / items.length) * 100);
}

function readyFor(gate: ReadinessGate, items: BranchReadinessItem[]): boolean {
  return !items.some(
    (i) => i.status === 'blocker' && i.requiredFor.includes(gate),
  );
}

export async function evaluateBranchReadiness(
  branchId: number,
  _options?: { at?: Date },
): Promise<BranchReadinessEvaluation> {
  const at = _options?.at ?? branchNow();
  const day = at.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const branch = await getBranchById(branchId);
  if (!branch) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', 'الفرع غير موجود', 404);
  }

  const legacy = await evaluateBranchOperationalReadiness({ branchId }, at);
  const items: BranchReadinessItem[] = [];

  items.push(
    item({
      key: 'identity.code',
      section: 'identity',
      title: 'رمز الفرع',
      status: branch.branchCode ? 'pass' : 'blocker',
      details: branch.branchCode || 'BranchCode missing',
      remediationUrl: `/admin/branches/${branch.branchId}/setup`,
    }),
    item({
      key: 'identity.name',
      section: 'identity',
      title: 'اسم الفرع',
      status: branch.branchName ? 'pass' : 'blocker',
      details: branch.branchName || 'BranchName missing',
    }),
    item({
      key: 'identity.timezone',
      section: 'identity',
      title: 'المنطقة الزمنية',
      status: branch.timeZone ? 'pass' : 'blocker',
      details: branch.timeZone || 'TimeZone missing',
    }),
    item({
      key: 'identity.address',
      section: 'identity',
      title: 'العنوان',
      status: branch.address ? 'pass' : 'warning',
      requiredFor: ['internal_live', 'public_live'],
      details: branch.address || 'Address recommended before live',
    }),
    item({
      key: 'lifecycle.valid',
      section: 'identity',
      title: 'حالة دورة الحياة',
      status: 'pass',
      details: `LifecycleStatus=${branch.lifecycleStatus}`,
    }),
  );

  // Map legacy checks into 1M items
  for (const c of legacy.checks) {
    const status: ReadinessItemStatus =
      !c.ok && c.severity === 'blocker'
        ? 'blocker'
        : !c.ok && c.severity === 'warning'
          ? 'warning'
          : c.ok
            ? 'pass'
            : 'warning';

    // BRANCH_ACTIVE is NOT a smoke blocker — SETUP/SMOKE are intentionally inactive
    if (c.code === 'BRANCH_ACTIVE') {
      items.push(
        item({
          key: 'ops.is_active',
          section: 'lifecycle',
          title: 'IsActive للتشغيل اليومي',
          status:
            branch.lifecycleStatus === 'INTERNAL_LIVE' ||
            branch.lifecycleStatus === 'PUBLIC_LIVE'
              ? branch.isActive
                ? 'pass'
                : 'blocker'
              : 'pass',
          requiredFor: ['internal_live', 'public_live'],
          details: `IsActive=${branch.isActive ? 1 : 0}; lifecycle=${branch.lifecycleStatus}`,
        }),
      );
      continue;
    }

    if (c.code === 'PUBLIC_BOOKING_FLAG') {
      items.push(
        item({
          key: 'booking.public_flag',
          section: 'booking',
          title: 'حجز الموقع',
          status:
            branch.lifecycleStatus === 'PUBLIC_LIVE'
              ? branch.publicBookingEnabled
                ? 'pass'
                : 'blocker'
              : branch.publicBookingEnabled
                ? 'blocker'
                : 'pass',
          requiredFor: ['public_live'],
          details: branch.publicBookingEnabled
            ? 'PublicBookingEnabled=1 (only valid in PUBLIC_LIVE)'
            : 'PublicBookingEnabled=0',
          remediationUrl: `/admin/branches/${branch.branchId}/readiness`,
        }),
      );
      continue;
    }

    const section =
      c.code.startsWith('QUEUE') || c.code.includes('BOOK')
        ? 'booking'
        : c.code.includes('BARBER') || c.code.includes('ASSIGN')
          ? 'employees'
          : c.code.includes('OPERATOR') || c.code.includes('ACCESS')
            ? 'users'
            : c.code.includes('PARTNER')
              ? 'reports'
              : 'operations';

    items.push(
      item({
        key: `legacy.${c.code}`,
        section,
        title: c.code,
        status,
        requiredFor:
          c.code === 'ELIGIBLE_BARBER'
            ? // Bookable listing requires IsActive=1; smoke keeps IsActive=0 — use smoke.assignment instead
              (['internal_live', 'public_live'] as ReadinessGate[])
            : c.code === 'BRANCH_ACTIVE'
              ? (['internal_live', 'public_live'] as ReadinessGate[])
            : c.severity === 'blocker'
              ? (['smoke', 'internal_live', 'public_live'] as ReadinessGate[])
              : (['public_live'] as ReadinessGate[]),
        details: c.message,
      }),
    );
  }

  const db = await getPool();

  // Smoke-specific: assignment exists even while IsActive=0
  const assignCnt = await db
    .request()
    .input('branchId', sql.Int, branch.branchId)
    .input('day', sql.Date, day)
    .query(`
      SELECT COUNT(*) AS cnt
      FROM dbo.TblEmpBranchAssignment ea
      WHERE ea.BranchID = @branchId
        AND ea.IsActive = 1
        AND ea.CanReceiveBookings = 1
        AND ea.EffectiveFrom <= @day
        AND (ea.EffectiveTo IS NULL OR ea.EffectiveTo >= @day)
    `);
  const smokeAssign = Number(assignCnt.recordset[0]?.cnt ?? 0);
  items.push(
    item({
      key: 'smoke.assignment',
      section: 'employees',
      title: 'تعيين موظف للـ smoke',
      status: smokeAssign > 0 ? 'pass' : 'blocker',
      requiredFor: ['smoke'],
      details:
        smokeAssign > 0
          ? `${smokeAssign} assignment(s) with CanReceiveBookings`
          : 'No bookable assignment on branch (required before SMOKE_TEST)',
    }),
  );

  // Payroll plan hard rule for assigned employees (smoke+)
  const payrollGap = await db
    .request()
    .input('branchId', sql.Int, branch.branchId)
    .input('day', sql.Date, day)
    .query(`
      IF OBJECT_ID(N'dbo.TblEmpBranchPayrollPlan', N'U') IS NULL
      BEGIN
        SELECT 0 AS GapCount;
      END
      ELSE
      BEGIN
        SELECT COUNT(*) AS GapCount
        FROM dbo.TblEmpBranchAssignment a
        WHERE a.BranchID = @branchId
          AND a.IsActive = 1
          AND a.EffectiveFrom <= @day
          AND (a.EffectiveTo IS NULL OR a.EffectiveTo >= @day)
          AND NOT EXISTS (
            SELECT 1
            FROM dbo.TblEmpBranchPayrollPlan p
            WHERE p.EmpID = a.EmpID
              AND p.BranchID = a.BranchID
              AND p.EffectiveFrom <= @day
              AND (p.EffectiveTo IS NULL OR p.EffectiveTo >= @day)
          )
      END
    `);
  const gap = Number(payrollGap.recordset[0]?.GapCount ?? 0);
  items.push(
    item({
      key: 'smoke.payroll_plan_coverage',
      section: 'payroll',
      title: 'خطط الرواتب للموظفين المعيّنين (smoke)',
      status: gap === 0 ? 'pass' : 'blocker',
      requiredFor: ['smoke'],
      details:
        gap === 0
          ? 'كل الموظفين المعيّنين لديهم خطة راتب فرعية سارية (أو لا تعيينات بعد)'
          : `${gap} موظف يمكنه الحضور بدون TblEmpBranchPayrollPlan سارية`,
      remediationUrl: `/admin/employees`,
    }),
  );

  // ── Phase 1N-B smoke operational blockers (explicit; score cannot bypass) ──
  const smokeOps = await db
    .request()
    .input('branchId', sql.Int, branch.branchId)
    .input('day', sql.Date, day)
    .query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.TblUserBranchAccess uba
           WHERE uba.BranchID = @branchId AND uba.IsActive = 1 AND uba.CanOperate = 1) AS Operators,
        (SELECT COUNT(*) FROM dbo.TblEmpBranchAssignment a
           INNER JOIN dbo.TblEmpWorkSchedule ws ON ws.EmpID = a.EmpID
           WHERE a.BranchID = @branchId AND a.IsActive = 1
             AND a.EffectiveFrom <= @day
             AND (a.EffectiveTo IS NULL OR a.EffectiveTo >= @day)
             AND ws.IsWorkingDay = 1) AS Schedules,
        (SELECT COUNT(*) FROM dbo.TblPro p
           WHERE ISNULL(p.isDeleted, 0) = 0
             AND ISNULL(p.PPrice, 0) > 0
             AND (
               LOWER(ISNULL(p.ProType, N'')) IN (N'service', N'serv')
               OR p.ProName LIKE N'%[SMOKE%'
             )) AS PricedServices,
        (SELECT COUNT(*) FROM dbo.TblPro p
           WHERE ISNULL(p.isDeleted, 0) = 0
             AND ISNULL(p.DurationMinutes, 0) > 0
             AND ISNULL(p.PPrice, 0) > 0) AS TimedServices,
        (SELECT COUNT(*) FROM dbo.TblPaymentMethods) AS PaymentMethods,
        (SELECT COUNT(*) FROM dbo.TblPro p
           LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID
           WHERE (LOWER(ISNULL(p.ProType, N'')) IN (N'pro', N'product')
                  OR LOWER(ISNULL(c.CatType, N'')) = N'pro')) AS StockProducts,
        (SELECT CASE WHEN OBJECT_ID(N'dbo.TblBranchInventory', N'U') IS NULL THEN 0 ELSE 1 END) AS InvTable,
        (SELECT CASE WHEN OBJECT_ID(N'dbo.TblBranchSmokeRun', N'U') IS NULL THEN 0 ELSE 1 END) AS SmokeRunTable,
        (SELECT CASE WHEN OBJECT_ID(N'dbo.TblBranchSmokeArtifact', N'U') IS NULL THEN 0 ELSE 1 END) AS SmokeArtTable,
        (SELECT CASE WHEN COL_LENGTH(N'dbo.TblCashMove', N'BranchID') IS NULL THEN 0 ELSE 1 END) AS CashBranchCol,
        (SELECT COUNT(*) FROM dbo.QueueBookingSettings WHERE BranchID = @branchId) AS QbsRows,
        (SELECT COUNT(*) FROM dbo.QueueBookingSettings
           WHERE BranchID = @branchId AND ISNULL(BookingEnabled, 0) = 0) AS QbsBookingOff,
        (SELECT COUNT(*) FROM dbo.TblBranch WHERE BranchCode = N'GLEEM' AND IsActive = 1) AS GleemActive
    `);
  const so = smokeOps.recordset[0] ?? {};

  items.push(
    item({
      key: 'smoke.operator',
      section: 'users',
      title: 'مشغّل smoke معتمد',
      status: Number(so.Operators) > 0 ? 'pass' : 'blocker',
      requiredFor: ['smoke'],
      details:
        Number(so.Operators) > 0
          ? `${so.Operators} operator access row(s)`
          : 'No CanOperate user access on branch',
    }),
    item({
      key: 'smoke.work_schedule',
      section: 'employees',
      title: 'جدول عمل للموظف المعيّن',
      status: Number(so.Schedules) > 0 ? 'pass' : 'blocker',
      requiredFor: ['smoke'],
      details:
        Number(so.Schedules) > 0
          ? 'Assigned employee has TblEmpWorkSchedule working day'
          : 'No work schedule for assigned smoke employee',
    }),
    item({
      key: 'smoke.service_price',
      section: 'services',
      title: 'خدمة مفعّلة بسعر',
      status: Number(so.PricedServices) > 0 ? 'pass' : 'blocker',
      requiredFor: ['smoke'],
      details:
        Number(so.PricedServices) > 0
          ? `${so.PricedServices} priced service(s) in catalog`
          : 'No enabled service with valid price (smoke needs at least one)',
    }),
    item({
      key: 'smoke.service_duration',
      section: 'services',
      title: 'مدة خدمة صالحة',
      status: Number(so.TimedServices) > 0 ? 'pass' : 'blocker',
      requiredFor: ['smoke'],
      details:
        Number(so.TimedServices) > 0
          ? 'At least one priced service has duration > 0'
          : 'No service with valid duration',
    }),
    item({
      key: 'smoke.payment_method',
      section: 'treasury',
      title: 'طريقة دفع للـ smoke',
      status: Number(so.PaymentMethods) > 0 ? 'pass' : 'blocker',
      requiredFor: ['smoke'],
      details:
        Number(so.PaymentMethods) > 0
          ? `${so.PaymentMethods} global payment method(s) available`
          : 'No payment methods configured',
    }),
    item({
      key: 'smoke.treasury_container',
      section: 'treasury',
      title: 'حاوية خزينة الفرع',
      status: Number(so.CashBranchCol) === 1 ? 'pass' : 'blocker',
      requiredFor: ['smoke'],
      details:
        Number(so.CashBranchCol) === 1
          ? 'TblCashMove.BranchID present (branch treasury ownership)'
          : 'TblCashMove.BranchID missing',
    }),
    item({
      key: 'smoke.inventory_container',
      section: 'inventory',
      title: 'حاوية مخزون الفرع',
      status: Number(so.InvTable) === 1 ? 'pass' : 'blocker',
      requiredFor: ['smoke'],
      details:
        Number(so.InvTable) === 1
          ? 'TblBranchInventory available'
          : 'TblBranchInventory missing',
    }),
    item({
      key: 'smoke.product',
      section: 'inventory',
      title: 'منتج مخزني للـ smoke',
      status: Number(so.StockProducts) > 0 ? 'pass' : 'blocker',
      requiredFor: ['smoke'],
      details:
        Number(so.StockProducts) > 0
          ? `${so.StockProducts} stock-tracked product(s)`
          : 'No stock-tracked product in catalog',
    }),
    item({
      key: 'smoke.queue_settings',
      section: 'booking',
      title: 'إعدادات طابور/حجز معطّلة للعامة',
      status:
        Number(so.QbsRows) > 0 && Number(so.QbsBookingOff) > 0 ? 'pass' : 'blocker',
      requiredFor: ['smoke'],
      details:
        Number(so.QbsRows) > 0 && Number(so.QbsBookingOff) > 0
          ? 'QueueBookingSettings present with BookingEnabled=0'
          : 'Missing disabled QueueBookingSettings container',
    }),
    item({
      key: 'smoke.notifications_off',
      section: 'notifications',
      title: 'إشعارات خارجية معطّلة',
      status: !branch.externalNotificationsEnabled ? 'pass' : 'blocker',
      requiredFor: ['smoke', 'internal_live'],
      details: `ExternalNotificationsEnabled=${branch.externalNotificationsEnabled ? 1 : 0}`,
    }),
    item({
      key: 'smoke.public_booking_off',
      section: 'booking',
      title: 'حجز عام معطّل أثناء smoke/setup',
      status:
        !branch.publicBookingEnabled && branch.lifecycleStatus !== 'PUBLIC_LIVE'
          ? 'pass'
          : 'blocker',
      requiredFor: ['smoke'],
      details: `PublicBookingEnabled=${branch.publicBookingEnabled ? 1 : 0}`,
    }),
    item({
      key: 'smoke.artifact_registry',
      section: 'smoke_framework',
      title: 'سجل آثار الـ smoke',
      status:
        Number(so.SmokeRunTable) === 1 && Number(so.SmokeArtTable) === 1
          ? 'pass'
          : 'blocker',
      requiredFor: ['smoke'],
      details:
        Number(so.SmokeRunTable) === 1 && Number(so.SmokeArtTable) === 1
          ? 'TblBranchSmokeRun + TblBranchSmokeArtifact present'
          : 'Smoke registry tables missing',
    }),
    item({
      key: 'smoke.cleanup_path',
      section: 'smoke_framework',
      title: 'مسار التنظيف متاح',
      status: Number(so.SmokeRunTable) === 1 ? 'pass' : 'blocker',
      requiredFor: ['smoke'],
      details: 'cleanupBranchSmokeRun requires smoke run table',
    }),
    item({
      key: 'smoke.gleem_baseline',
      section: 'isolation',
      title: 'خط أساس عزل GLEEM',
      status: Number(so.GleemActive) > 0 ? 'pass' : 'blocker',
      requiredFor: ['smoke'],
      details:
        Number(so.GleemActive) > 0
          ? 'GLEEM active baseline present for isolation diffs'
          : 'GLEEM active branch missing — cannot prove isolation',
    }),
  );

  // ── INTERNAL_LIVE: business decisions + proven smoke proofs ──
  const { getBranchSetupPolicy } = await import('./branchSetupPolicy');
  const { isOpeningInventoryResolved } = await import('./openingInventoryDecision');
  const setupPolicy = await getBranchSetupPolicy(branch.branchId);
  const openingInvOk = await isOpeningInventoryResolved(branch.branchId);

  const phoneOk = !!(branch.phone && String(branch.phone).trim());
  const addressOk = !!(branch.address && String(branch.address).trim());
  const hoursOk = !!(branch.defaultOpenTime && branch.defaultCloseTime);
  const printerOk = !!setupPolicy?.sharedPrinterApproved;
  const whatsappOk = !!setupPolicy?.sharedWhatsAppApproved;
  const partnerDraftOk = !!setupPolicy?.partnerSharesDraftReady;
  const partnerEffectiveOk = await (async () => {
    const shareRes = await db
      .request()
      .input('branchId', sql.Int, branch.branchId)
      .query(`
        SELECT COUNT(*) AS Cnt
        FROM dbo.TblBranchPartnerShare
        WHERE BranchID = @branchId AND IsActive = 1
          AND (Notes IS NULL OR Notes NOT LIKE N'%PHASE1O_DRAFT_PENDING_OPENING_DATE%')
      `);
    return Number(shareRes.recordset[0].Cnt) > 0;
  })();
  const realEmpOk = await (async () => {
    const empRes = await db
      .request()
      .input('branchId', sql.Int, branch.branchId)
      .query(`
        SELECT COUNT(*) AS Cnt
        FROM dbo.TblEmpBranchAssignment ea
        INNER JOIN dbo.TblEmp e ON e.EmpID = ea.EmpID
        WHERE ea.BranchID = @branchId AND ea.IsActive = 1
          AND ISNULL(e.isActive,1) = 1
          AND (e.EmpName IS NULL OR e.EmpName NOT LIKE N'%[SMOKE%')
      `);
    return Number(empRes.recordset[0].Cnt) > 0;
  })();
  const usersAccessOk = !!setupPolicy?.usersAccessReviewedAt;
  const paymentsOk = Number(so.PaymentMethods) > 0;
  const treasuryOk = Number(so.CashBranchCol) === 1;

  const bizChecks: Array<{
    key: string;
    title: string;
    ok: boolean;
    details: string;
  }> = [
    {
      key: 'biz.address',
      title: 'عنوان معتمد',
      ok: addressOk,
      details: addressOk ? `Address=${branch.address}` : 'BUSINESS_DECISION_REQUIRED: Address',
    },
    {
      key: 'biz.contact',
      title: 'تواصل/هاتف معتمد',
      ok: phoneOk,
      details: phoneOk ? `Phone=${branch.phone}` : 'BUSINESS_DECISION_REQUIRED: Phone/contact',
    },
    {
      key: 'biz.operating_hours',
      title: 'ساعات التشغيل',
      ok: hoursOk,
      details: hoursOk
        ? `Open ${branch.defaultOpenTime}–${branch.defaultCloseTime} (overnight if close<=open)`
        : 'BUSINESS_DECISION_REQUIRED: Operating hours',
    },
    {
      key: 'biz.opening_cash',
      title: 'رصيد نقدي افتتاحي',
      ok: false,
      details: 'BUSINESS_DECISION_REQUIRED: Opening cash balance',
    },
    {
      key: 'biz.opening_inventory',
      title: 'مخزون افتتاحي معتمد',
      ok: openingInvOk,
      details: openingInvOk
        ? `Opening inventory option=${setupPolicy?.openingInventoryOption}`
        : 'BUSINESS_DECISION_REQUIRED: Opening inventory (A/B/C)',
    },
    {
      key: 'biz.partner_shares_effective_date',
      title: 'تاريخ سريان نسب الشركاء / الافتتاح',
      ok: partnerEffectiveOk,
      details: partnerEffectiveOk
        ? 'Active non-draft partner shares present'
        : partnerDraftOk
          ? 'Partner draft 100% ready — EffectiveFrom/opening date still required'
          : 'BUSINESS_DECISION_REQUIRED: Partner shares + opening effective date',
    },
    {
      key: 'biz.partner_shares',
      title: 'نسب الشركاء (مسودة أو فعالة)',
      ok: partnerDraftOk || partnerEffectiveOk,
      details:
        partnerDraftOk || partnerEffectiveOk
          ? 'Partner percentages configured (draft or active)'
          : 'BUSINESS_DECISION_REQUIRED: Partner-share percentages',
    },
    {
      key: 'biz.real_employees',
      title: 'تعيينات موظفين إنتاجية',
      ok: realEmpOk,
      details: realEmpOk
        ? 'Active non-smoke employee assignments present'
        : 'BUSINESS_DECISION_REQUIRED: Real employee assignments (not smoke-only)',
    },
    {
      key: 'printer.shared_policy',
      title: 'سياسة طابعة مشتركة/معتمدة',
      ok: printerOk,
      details: printerOk
        ? 'SharedPrinterApproved=true'
        : 'BUSINESS_DECISION_REQUIRED: SharedPrinterApproved or dedicated printer',
    },
    {
      key: 'whatsapp.shared_policy',
      title: 'سياسة واتساب مشتركة/معتمدة',
      ok: whatsappOk,
      details: whatsappOk
        ? 'SharedWhatsAppApproved=true'
        : 'BUSINESS_DECISION_REQUIRED: SharedWhatsAppApproved or dedicated sender',
    },
    {
      key: 'users.access_review',
      title: 'مراجعة صلاحيات المستخدمين',
      ok: usersAccessOk,
      details: usersAccessOk
        ? `Users access reviewed at ${setupPolicy?.usersAccessReviewedAt}`
        : 'BUSINESS_DECISION_REQUIRED: Review copied user access list',
    },
    {
      key: 'payments.configuration',
      title: 'تهيئة طرق الدفع',
      ok: paymentsOk,
      details: 'Global TblPaymentMethods shared — no balances copied',
    },
    {
      key: 'treasury.container',
      title: 'حاوية الخزينة للفرع',
      ok: treasuryOk,
      details: 'Branch-owned CashMove.BranchID container',
    },
    {
      key: 'inventory.container',
      title: 'حاوية المخزون للفرع',
      ok: Number(so.InvTable ?? 1) > 0,
      details: 'TblBranchInventory present',
    },
    {
      key: 'services.price_duration_parity',
      title: 'تكافؤ أسعار/مدد الخدمات مع المصدر',
      ok: true,
      details: 'Global TblPro catalog shared — parity mismatches=0 by model',
    },
  ];
  for (const b of bizChecks) {
    items.push(
      item({
        key: b.key,
        section: 'business_decisions',
        title: b.title,
        status: b.ok ? 'pass' : 'blocker',
        requiredFor: ['internal_live', 'public_live'],
        details: b.details,
      }),
    );
  }

  // payroll / target coverage when real assignments exist
  const coverage = await db
    .request()
    .input('branchId', sql.Int, branch.branchId)
    .query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.TblEmpBranchAssignment WHERE BranchID=@branchId AND IsActive=1) AS Assignments,
        (SELECT COUNT(*) FROM dbo.TblEmpBranchAssignment ea
          WHERE ea.BranchID=@branchId AND ea.IsActive=1
            AND EXISTS (
              SELECT 1 FROM dbo.TblEmpBranchPayrollPlan p
              WHERE p.EmpID=ea.EmpID AND p.BranchID=ea.BranchID AND p.IsActive=1
            )) AS WithPayroll,
        (SELECT COUNT(*) FROM dbo.TblEmpBranchAssignment ea
          WHERE ea.BranchID=@branchId AND ea.IsActive=1
            AND (
              EXISTS (
                SELECT 1 FROM dbo.TblEmpTargetPlan t
                WHERE t.EmpID=ea.EmpID AND t.BranchID=ea.BranchID
                  AND (t.IsEnabled=1 OR t.Notes LIKE N'%NO_TARGET%')
              )
            )) AS WithTargetPolicy
    `);
  const cov = coverage.recordset[0] as {
    Assignments: number;
    WithPayroll: number;
    WithTargetPolicy: number;
  };
  const assignN = Number(cov.Assignments);
  items.push(
    item({
      key: 'payroll.plan_coverage',
      section: 'payroll',
      title: 'تغطية خطط الرواتب للتعيينات',
      status:
        assignN === 0
          ? 'blocker'
          : Number(cov.WithPayroll) >= assignN
            ? 'pass'
            : 'blocker',
      requiredFor: ['internal_live', 'public_live'],
      details:
        assignN === 0
          ? 'No assignments yet — coverage blocked until real employees assigned with plans'
          : `${cov.WithPayroll}/${assignN} assignments have branch payroll plans`,
    }),
    item({
      key: 'target.policy_coverage',
      section: 'targets',
      title: 'تغطية سياسة التarget / NO_TARGET',
      status:
        assignN === 0
          ? 'blocker'
          : Number(cov.WithTargetPolicy) >= assignN
            ? 'pass'
            : 'blocker',
      requiredFor: ['internal_live', 'public_live'],
      details:
        assignN === 0
          ? 'No assignments yet — target policy blocked until real employees assigned'
          : `${cov.WithTargetPolicy}/${assignN} assignments have target or NO_TARGET`,
    }),
  );

  // Smoke proof keys from latest PASSED/CLEANED ResultJson for this branch
  const { INTERNAL_LIVE_SMOKE_PROOF_KEYS } = await import('./smokeBranchPolicy');
  const proofRes = await db
    .request()
    .input('branchId', sql.Int, branch.branchId)
    .query(`
      SELECT TOP 1 SmokeRunID, Status, ResultJson, CleanupStatus
      FROM dbo.TblBranchSmokeRun
      WHERE BranchID = @branchId
        AND Status IN (N'PASSED', N'CLEANED')
      ORDER BY SmokeRunID DESC
    `);
  let proof: Record<string, unknown> = {};
  const proofRow = proofRes.recordset[0];
  if (proofRow?.ResultJson) {
    try {
      proof = JSON.parse(String(proofRow.ResultJson)) as Record<string, unknown>;
    } catch {
      proof = {};
    }
  }
  const proofsObj =
    proof && typeof proof === 'object' && proof.proofs && typeof proof.proofs === 'object'
      ? (proof.proofs as Record<string, unknown>)
      : proof;

  items.push(
    item({
      key: 'internal.passed_smoke_run',
      section: 'smoke_framework',
      title: 'نجاح smoke + تنظيف',
      status:
        proofRow &&
        (String(proofRow.Status) === 'PASSED' || String(proofRow.Status) === 'CLEANED') &&
        (String(proofRow.CleanupStatus) === 'COMPLETED' ||
          String(proofRow.Status) === 'CLEANED')
          ? 'pass'
          : 'blocker',
      requiredFor: ['internal_live'],
      details: proofRow
        ? `SmokeRunID=${proofRow.SmokeRunID} Status=${proofRow.Status} Cleanup=${proofRow.CleanupStatus}`
        : 'No PASSED/CLEANED smoke run for this branch',
    }),
  );

  for (const key of INTERNAL_LIVE_SMOKE_PROOF_KEYS) {
    if (key === 'cleanup.completed') continue; // covered above
    const present = Boolean(proofsObj[key]);
    items.push(
      item({
        key: `proof.${key}`,
        section: 'smoke_proofs',
        title: key,
        status: present ? 'pass' : 'blocker',
        requiredFor: ['internal_live'],
        details: present
          ? `Proven in smoke ResultJson: ${key}`
          : `Missing smoke proof: ${key}`,
      }),
    );
  }

  // Public frontend multi-branch — HARD blockers for PUBLIC_LIVE (Phase 1N-B / 1O)
  const publicBlockers: Array<{ key: string; title: string; details: string }> = [
    {
      key: 'public.frontend_multi_branch',
      title: 'واجهة الحجز تدعم اختيار الفرع',
      details:
        'PUBLIC_LIVE blocked until cutsaloon.com multi-branch selection is deployed and verified',
    },
    {
      key: 'public.branch_selection',
      title: 'اختيار الفرع في الواجهة العامة',
      details: 'PUBLIC_LIVE blocked until public branch selection UX ships (Phase 1P)',
    },
    {
      key: 'public.explicit_branch_code',
      title: 'branchCode صريح على كل طلب حجز',
      details: 'PUBLIC_LIVE blocked until every public booking request carries branchCode',
    },
    {
      key: 'public.booking_flow_smoke',
      title: 'smoke مسار الحجز العام متعدد الفروع',
      details: 'PUBLIC_LIVE blocked until public booking flow smoke passes',
    },
    {
      key: 'public.customer_notifications',
      title: 'إشعارات العملاء للفرع',
      details: 'PUBLIC_LIVE blocked until customer notifications are branch-scoped and enabled',
    },
  ];
  for (const p of publicBlockers) {
    items.push(
      item({
        key: p.key,
        section: 'public_website',
        title: p.title,
        status: 'blocker',
        requiredFor: ['public_live'],
        details: p.details,
        remediationUrl: '/docs/branch-phase-1o-booking-employee-handoff.md',
      }),
    );
  }

  const blockers = items.filter((i) => i.status === 'blocker');
  const warnings = items.filter((i) => i.status === 'warning');
  const sectionMap = new Map<string, BranchReadinessItem[]>();
  for (const i of items) {
    const list = sectionMap.get(i.section) ?? [];
    list.push(i);
    sectionMap.set(i.section, list);
  }

  const evaluation: BranchReadinessEvaluation = {
    branchId: branch.branchId,
    branchCode: branch.branchCode,
    lifecycleStatus: branch.lifecycleStatus,
    score: scoreFrom(items),
    isReadyForSmoke: readyFor('smoke', items),
    isReadyForInternalLive: readyFor('internal_live', items),
    isReadyForPublicLive: readyFor('public_live', items),
    blockers,
    warnings,
    sections: [...sectionMap.entries()].map(([section, sectionItems]) => ({
      section,
      items: sectionItems,
    })),
    evaluatedAt: at.toISOString(),
  };

  console.info(
    JSON.stringify({
      event: 'branch.readiness.evaluated',
      branchId: branch.branchId,
      branchCode: branch.branchCode,
      lifecycleStatus: branch.lifecycleStatus,
      score: evaluation.score,
      blockers: blockers.length,
      warnings: warnings.length,
      isReadyForSmoke: evaluation.isReadyForSmoke,
      isReadyForInternalLive: evaluation.isReadyForInternalLive,
      isReadyForPublicLive: evaluation.isReadyForPublicLive,
    }),
  );

  return evaluation;
}

export async function evaluateBranchReadinessByCode(
  branchCode: string,
): Promise<BranchReadinessEvaluation> {
  const branch = await getBranchByCode(branchCode);
  if (!branch) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', 'الفرع غير موجود', 404);
  }
  return evaluateBranchReadiness(branch.branchId);
}
