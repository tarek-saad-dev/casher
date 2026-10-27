import 'server-only';
import { getPool, sql } from '@/lib/db';
import type {
  WorkspaceAppReadinessSignal,
  WorkspaceReadinessCheck,
  WorkspaceReadinessProvider,
} from '@/platform/tenant/workspaceReadinessSignals';

type TenantOpsSnapshot = {
  activeBranches: number;
  catalogServices: number;
  assignedEmployees: number;
  /** -1 when schedule table is absent — schedule check must be unknown, not pass. */
  scheduleRows: number;
  queueSettingsRows: number;
  paymentMethods: number;
  bookings: number;
  sales: number;
  openBusinessDays: number;
};

async function loadTenantOpsSnapshot(tenantId: string): Promise<TenantOpsSnapshot> {
  const pool = await getPool();
  const res = await pool
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT
        (
          SELECT COUNT(*)
          FROM dbo.Location l
          INNER JOIN dbo.TblBranch b ON b.BranchID = l.LegacyBranchId
          WHERE l.TenantId = @tenantId
            AND l.Status = N'active'
            AND b.IsActive = 1
            AND b.LifecycleStatus IN (N'INTERNAL_LIVE', N'PUBLIC_LIVE')
        ) AS ActiveBranches,
        (
          SELECT COUNT(*)
          FROM dbo.TblPro p
          WHERE p.TenantId = @tenantId
            AND ISNULL(p.isDeleted, 0) = 0
        ) AS CatalogServices,
        (
          SELECT COUNT(DISTINCT e.EmpID)
          FROM dbo.TblEmp e
          INNER JOIN dbo.TblEmpBranchAssignment a ON a.EmpID = e.EmpID
          INNER JOIN dbo.Location l ON l.LegacyBranchId = a.BranchID AND l.TenantId = @tenantId
          WHERE e.TenantId = @tenantId
            AND ISNULL(e.isActive, 1) = 1
            AND ISNULL(a.IsActive, 1) = 1
        ) AS AssignedEmployees,
        CASE
          WHEN OBJECT_ID(N'dbo.TblEmpBranchWorkSchedule', N'U') IS NULL THEN -1
          ELSE (
            SELECT COUNT(*)
            FROM dbo.TblEmpBranchWorkSchedule s
            INNER JOIN dbo.Location l ON l.LegacyBranchId = s.BranchID
            WHERE l.TenantId = @tenantId
          )
        END AS ScheduleRows,
        (
          SELECT COUNT(*)
          FROM dbo.QueueBookingSettings q
          INNER JOIN dbo.Location l ON l.LegacyBranchId = q.BranchID
          WHERE l.TenantId = @tenantId
        ) AS QueueSettingsRows,
        (
          SELECT COUNT(*)
          FROM dbo.TblPaymentMethods pm
          WHERE pm.TenantId = @tenantId
        ) AS PaymentMethods,
        (
          SELECT COUNT(*)
          FROM dbo.Bookings b
          INNER JOIN dbo.Location l ON l.LegacyBranchId = b.BranchID
          WHERE l.TenantId = @tenantId
        ) AS Bookings,
        (
          SELECT COUNT(*)
          FROM dbo.TblinvServHead h
          INNER JOIN dbo.Location l ON l.LegacyBranchId = h.BranchID
          WHERE l.TenantId = @tenantId AND h.invType = N'مبيعات'
        ) AS Sales,
        (
          SELECT COUNT(*)
          FROM dbo.TblNewDay d
          INNER JOIN dbo.Location l ON l.LegacyBranchId = d.BranchID
          WHERE l.TenantId = @tenantId AND d.Status = 1
        ) AS OpenBusinessDays;
    `);
  const row = res.recordset[0] as Record<string, number> | undefined;
  return {
    activeBranches: Number(row?.ActiveBranches ?? 0),
    catalogServices: Number(row?.CatalogServices ?? 0),
    assignedEmployees: Number(row?.AssignedEmployees ?? 0),
    scheduleRows: Number(row?.ScheduleRows ?? -1),
    queueSettingsRows: Number(row?.QueueSettingsRows ?? 0),
    paymentMethods: Number(row?.PaymentMethods ?? 0),
    bookings: Number(row?.Bookings ?? 0),
    sales: Number(row?.Sales ?? 0),
    openBusinessDays: Number(row?.OpenBusinessDays ?? 0),
  };
}

function check(
  key: string,
  ok: boolean,
  passDetail: string,
  failDetail: string,
  action?: string,
  actionHref?: string,
): WorkspaceReadinessCheck {
  return ok
    ? { key, state: 'pass', detail: passDetail }
    : { key, state: 'fail', detail: failDetail, action: action ?? null, actionHref: actionHref ?? null };
}

/**
 * Salon-owned Workspace readiness providers.
 * Employee assignment alone never proves bookable availability — schedule evidence is required.
 */
export function createSalonWorkspaceReadinessProviders(): readonly WorkspaceReadinessProvider[] {
  return [
    {
      appCode: 'booking',
      async check(tenantId: string): Promise<WorkspaceAppReadinessSignal> {
        const s = await loadTenantOpsSnapshot(tenantId);
        const checks: WorkspaceReadinessCheck[] = [
          check(
            'active_branch',
            s.activeBranches > 0,
            'يوجد فرع نشط للتشغيل الداخلي.',
            'لا يوجد فرع نشط. فعّل أول موقع قبل الحجوزات.',
            'راجع الفروع',
            '/admin/branches',
          ),
          check(
            'bookable_services',
            s.catalogServices > 0,
            'يوجد خدمات في الكتالوج.',
            'أضف خدمة واحدة على الأقل قابلة للحجز.',
            'أضف خدمة',
            '/admin/services',
          ),
          check(
            'assigned_team',
            s.assignedEmployees > 0,
            'يوجد موظفون مرتبطون بالفرع.',
            'أضف موظفًا واربطه بالفرع.',
            'أضف موظف',
            '/admin/hr',
          ),
          s.scheduleRows < 0
            ? {
                key: 'work_schedule',
                state: 'unknown' as const,
                detail: 'تعذر التحقق من جداول العمل على هذه البيئة.',
              }
            : check(
                'work_schedule',
                s.scheduleRows > 0,
                'يوجد جدول عمل مسجّل للفريق.',
                'تعيين الموظف وحده لا يكفي. اضبط ساعات العمل/التوافر قبل اعتبار الحجوزات جاهزة.',
                'اضبط التوافر',
                '/admin/workforce/availability',
              ),
        ];
        return {
          tenantId,
          appCode: 'booking',
          checks,
          usage: s.bookings > 0 ? 'observed' : 'not_observed',
        };
      },
    },
    {
      appCode: 'queue',
      async check(tenantId: string): Promise<WorkspaceAppReadinessSignal> {
        const s = await loadTenantOpsSnapshot(tenantId);
        const checks: WorkspaceReadinessCheck[] = [
          check(
            'active_branch',
            s.activeBranches > 0,
            'يوجد فرع نشط.',
            'فعّل فرعًا نشطًا قبل الطابور.',
            'راجع الفروع',
            '/admin/branches',
          ),
          check(
            'queue_settings',
            s.queueSettingsRows > 0,
            'إعدادات الطابور موجودة للفرع.',
            'إعدادات الطابور غير مكتملة لهذا الفرع.',
            'راجع إعدادات الطابور',
            '/admin/queue-booking-settings',
          ),
          check(
            'assigned_team',
            s.assignedEmployees > 0,
            'يوجد فريق مرتبط بالفرع.',
            'أضف موظفًا واربطه بالفرع قبل استقبال الطابور.',
            'أضف موظف',
            '/admin/hr',
          ),
        ];
        return {
          tenantId,
          appCode: 'queue',
          checks,
          usage: 'not_observed',
        };
      },
    },
    {
      appCode: 'pos',
      async check(tenantId: string): Promise<WorkspaceAppReadinessSignal> {
        const s = await loadTenantOpsSnapshot(tenantId);
        const checks: WorkspaceReadinessCheck[] = [
          check(
            'active_branch',
            s.activeBranches > 0,
            'يوجد فرع نشط.',
            'فعّل فرعًا قبل نقاط البيع.',
            'راجع الفروع',
            '/admin/branches',
          ),
          check(
            'sellable_catalog',
            s.catalogServices > 0,
            'يوجد عناصر قابلة للبيع في الكتالوج.',
            'أضف خدمة أو منتجًا قبل أول فاتورة.',
            'أضف خدمة',
            '/admin/services',
          ),
          check(
            'payment_methods',
            s.paymentMethods > 0,
            'طرق الدفع مفعّلة للمنشأة.',
            'فعّل طريقة دفع واحدة على الأقل قبل البيع.',
            'طرق الدفع',
            '/admin/payment-methods',
          ),
          check(
            'business_day',
            s.openBusinessDays > 0 || s.sales > 0,
            s.openBusinessDays > 0
              ? 'يوجد يوم تشغيل مفتوح أو سجل مبيعات سابق.'
              : 'تم تسجيل مبيعات سابقة.',
            'ابدأ يوم التشغيل وافتح وردية قبل أول فاتورة.',
            'مركز التشغيل',
            '/admin/operations',
          ),
        ];
        return {
          tenantId,
          appCode: 'pos',
          checks,
          usage: s.sales > 0 ? 'observed' : 'not_observed',
        };
      },
    },
  ];
}
