import 'server-only';
import type { ConnectionPool } from 'mssql';
import { getPool, sql } from '@/lib/db';
import { installedAppCodes, listTenantApps } from '@/platform/apps/tenantApps';
import { evaluateCommercialAccess } from '@/platform/commercial/commercialAccess';
import type { GoLiveMilestone, TenantGoLiveReport } from './goLiveTypes';

export type GoLiveCounts = {
  commercialAllowed: boolean;
  activeBranches: number;
  catalogItems: number;
  employees: number;
  users: number;
  businessDays: number;
  shifts: number;
  sales: number;
  bookings: number;
  bookingInstalled: boolean;
};

export function buildGoLiveMilestones(c: GoLiveCounts): GoLiveMilestone[] {
  const row = (
    id: GoLiveMilestone['id'],
    label: string,
    detail: string,
    status: GoLiveMilestone['status'],
    count: number | null,
    action: string,
  ): GoLiveMilestone => ({ id, label, detail, status, count, action });

  return [
    row(
      'commercial_access',
      'الاشتراك يسمح بالتشغيل',
      c.commercialAllowed ? 'الاشتراك صالح ويمكن للمستخدمين الدخول.' : 'فعّل الاشتراك أو راجع حالته قبل تسليم الحساب.',
      c.commercialAllowed ? 'done' : 'pending',
      null,
      'راجع الخطة وحالة الاشتراك.',
    ),
    row(
      'active_branch',
      'أول فرع جاهز للتشغيل',
      c.activeBranches > 0 ? `${c.activeBranches} فرع نشط وجاهز للتشغيل الداخلي.` : 'لا يوجد فرع نشط للتشغيل حتى الآن.',
      c.activeBranches > 0 ? 'done' : 'pending',
      c.activeBranches,
      'استكمل إعداد الفرع وتفعيله للتشغيل الداخلي.',
    ),
    row(
      'catalog',
      'الخدمات / المنتجات جاهزة',
      c.catalogItems > 0 ? `${c.catalogItems} عنصر في الكتالوج.` : 'الكتالوج فارغ؛ لا يمكن تنفيذ أول فاتورة بدون خدمة أو منتج.',
      c.catalogItems > 0 ? 'done' : 'pending',
      c.catalogItems,
      'أضف الخدمات أو المنتجات والأسعار الأساسية.',
    ),
    row(
      'team',
      'فريق التشغيل جاهز',
      c.employees > 0 ? `${c.employees} موظف مسجل داخل المنشأة.` : 'لا يوجد موظفون بعد.',
      c.employees > 0 ? 'done' : 'pending',
      c.employees,
      'أضف موظف تشغيل واحد على الأقل واربطه بالفرع.',
    ),
    row(
      'users',
      'مستخدمو المنشأة جاهزون',
      c.users > 0 ? `${c.users} مستخدم لديه عضوية بالمنشأة.` : 'لا يوجد مستخدم صالح للدخول.',
      c.users > 0 ? 'done' : 'pending',
      c.users,
      'تأكد من وجود المالك أو مستخدم تشغيل صالح.',
    ),
    row(
      'business_day',
      'أول يوم تشغيل',
      c.businessDays > 0 ? `تم إنشاء ${c.businessDays} يوم تشغيل على الأقل.` : 'لم يبدأ أي يوم تشغيل بعد.',
      c.businessDays > 0 ? 'done' : 'pending',
      c.businessDays,
      'سجّل دخول العميل وابدأ يوم التشغيل في الفرع.',
    ),
    row(
      'first_shift',
      'أول وردية',
      c.shifts > 0 ? `تم تسجيل ${c.shifts} وردية تشغيل.` : 'لم تُفتح أول وردية بعد.',
      c.shifts > 0 ? 'done' : 'pending',
      c.shifts,
      'افتح وردية من حساب العميل وتأكد أن الفرع الصحيح نشط.',
    ),
    row(
      'first_sale',
      'أول فاتورة مبيعات',
      c.sales > 0 ? `تم تسجيل ${c.sales} فاتورة مبيعات.` : 'لم تُسجل أول فاتورة بعد.',
      c.sales > 0 ? 'done' : 'pending',
      c.sales,
      'نفّذ فاتورة حقيقية/تجريبية صغيرة من نقطة البيع ثم راجع الخزنة والتقرير.',
    ),
    c.bookingInstalled
      ? row(
          'first_booking',
          'أول حجز',
          c.bookings > 0 ? `تم تسجيل ${c.bookings} حجز.` : 'تطبيق الحجز مثبت لكن لم يُسجل أول حجز بعد.',
          c.bookings > 0 ? 'done' : 'pending',
          c.bookings,
          'أنشئ أول حجز من شاشة التشغيل؛ النشر العام يظل قراراً مستقلاً.',
        )
      : row(
          'first_booking',
          'أول حجز',
          'تطبيق الحجز غير مثبت لهذه المنشأة.',
          'not_applicable',
          null,
          'لا يلزم شيء.',
        ),
  ];
}

export async function evaluateTenantGoLive(
  tenantId: string,
  pool?: ConnectionPool,
): Promise<TenantGoLiveReport | null> {
  const db = pool ?? (await getPool());

  const tenantRes = await db
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT TenantId, Code, Name
      FROM dbo.Tenant WITH (NOLOCK)
      WHERE TenantId = @tenantId;
    `);
  const tenant = tenantRes.recordset[0] as
    | { TenantId: string; Code: string; Name: string }
    | undefined;
  if (!tenant) return null;

  const [apps, commercial, stats, primary, owner] = await Promise.all([
    listTenantApps(tenantId, { executor: db }),
    evaluateCommercialAccess(tenantId, { executor: db }),
    db
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
          (SELECT COUNT(*) FROM dbo.TblPro p WHERE p.TenantId = @tenantId AND ISNULL(p.isDeleted, 0) = 0) AS CatalogItems,
          (SELECT COUNT(*) FROM dbo.TblEmp e WHERE e.TenantId = @tenantId AND ISNULL(e.isActive, 1) = 1) AS Employees,
          (
            SELECT COUNT(*)
            FROM dbo.TenantMembership m
            INNER JOIN dbo.TblUser u ON u.UserID = m.LegacyUserId
            WHERE m.TenantId = @tenantId AND ISNULL(u.isDeleted, 0) = 0
          ) AS Users,
          (
            SELECT COUNT(*)
            FROM dbo.TblNewDay d
            INNER JOIN dbo.Location l ON l.LegacyBranchId = d.BranchID
            WHERE l.TenantId = @tenantId
          ) AS BusinessDays,
          (
            SELECT COUNT(*)
            FROM dbo.TblShiftMove s
            INNER JOIN dbo.Location l ON l.LegacyBranchId = s.BranchID
            WHERE l.TenantId = @tenantId
          ) AS Shifts,
          (
            SELECT COUNT(*)
            FROM dbo.TblinvServHead h
            INNER JOIN dbo.Location l ON l.LegacyBranchId = h.BranchID
            WHERE l.TenantId = @tenantId AND h.invType = N'مبيعات'
          ) AS Sales,
          (
            SELECT COUNT(*)
            FROM dbo.Bookings b
            INNER JOIN dbo.Location l ON l.LegacyBranchId = b.BranchID
            WHERE l.TenantId = @tenantId
          ) AS Bookings;
      `),
    db
      .request()
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .query(`
        SELECT TOP 1 b.BranchID, l.BranchCode, b.BranchName
        FROM dbo.Location l
        INNER JOIN dbo.TblBranch b ON b.BranchID = l.LegacyBranchId
        WHERE l.TenantId = @tenantId
        ORDER BY
          CASE WHEN l.Status = N'active' AND b.IsActive = 1 THEN 0 ELSE 1 END,
          b.BranchID;
      `),
    db
      .request()
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .query(`
        SELECT TOP 1 u.loginName
        FROM dbo.TenantMembership m
        INNER JOIN dbo.TblUser u ON u.UserID = m.LegacyUserId AND ISNULL(u.isDeleted, 0) = 0
        LEFT JOIN dbo.TblUserRoles ur ON ur.UserID = u.UserID
        LEFT JOIN dbo.TblRoles r ON r.RoleID = ur.RoleID
        WHERE m.TenantId = @tenantId
        ORDER BY CASE WHEN r.RoleKey = N'admin' THEN 0 ELSE 1 END, u.UserID;
      `),
  ]);

  const installed = new Set(installedAppCodes(apps));
  const s = stats.recordset[0] as Record<string, unknown>;
  const milestones = buildGoLiveMilestones({
    commercialAllowed: commercial.subscription.allowed,
    activeBranches: Number(s.ActiveBranches ?? 0),
    catalogItems: Number(s.CatalogItems ?? 0),
    employees: Number(s.Employees ?? 0),
    users: Number(s.Users ?? 0),
    businessDays: Number(s.BusinessDays ?? 0),
    shifts: Number(s.Shifts ?? 0),
    sales: Number(s.Sales ?? 0),
    bookings: Number(s.Bookings ?? 0),
    bookingInstalled: installed.has('booking'),
  });

  const applicable = milestones.filter((m) => m.status !== 'not_applicable');
  const completed = applicable.filter((m) => m.status === 'done').length;
  const total = applicable.length;
  const first = primary.recordset[0] as
    | { BranchID: number; BranchCode: string; BranchName: string | null }
    | undefined;

  return {
    tenantId: String(tenant.TenantId).toLowerCase(),
    tenantCode: String(tenant.Code),
    tenantName: String(tenant.Name),
    ownerLoginName: owner.recordset[0]?.loginName ? String(owner.recordset[0].loginName) : null,
    bookingInstalled: installed.has('booking'),
    status: completed === total ? 'READY_FOR_HANDOFF' : 'IN_PROGRESS',
    completed,
    total,
    progressPercent: total > 0 ? Math.round((completed / total) * 100) : 100,
    milestones,
    primaryBranch: first
      ? {
          branchId: Number(first.BranchID),
          branchCode: String(first.BranchCode),
          branchName: first.BranchName == null ? null : String(first.BranchName),
        }
      : null,
  };
}
