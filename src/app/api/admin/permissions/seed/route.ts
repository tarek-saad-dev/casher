import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';

// ── Roles seed data ──────────────────────────────────────────────────────────
const ROLES = [
  { key: 'super_admin', name: 'مدير النظام الكامل',    desc: 'صلاحية كاملة على كل شيء' },
  { key: 'admin',       name: 'مدير عام',              desc: 'معظم صفحات الإدارة' },
  { key: 'manager',     name: 'مشرف',                  desc: 'تشغيل ومراجعة' },
  { key: 'cashier',     name: 'كاشير',                 desc: 'POS وعمليات الخزنة اليومية' },
  { key: 'accountant',  name: 'محاسب',                 desc: 'خزنة وتقارير مالية' },
  { key: 'receptionist',name: 'استقبال',               desc: 'حجوزات وعملاء وطابور' },
  { key: 'viewer',      name: 'مشاهد',                 desc: 'قراءة فقط' },
  { key: 'partner',     name: 'شريك',                  desc: 'عرض تقرير الشركاء فقط' },
];

// ── System pages seed data ───────────────────────────────────────────────────
// AccessMode: 'all' | 'roles' | 'super_admin_only'
const PAGES = [
  // POS / Income
  { key: 'income.pos',             name: 'نقطة البيع',             path: '/income/pos',                      section: 'المدخلات',          access: 'roles', sort: 10 },
  { key: 'income.new',             name: 'إيراد جديد',             path: '/income/new',                      section: 'المدخلات',          access: 'roles', sort: 11 },
  // Sales review
  { key: 'sales.today',            name: 'مبيعات اليوم',           path: '/sales/today',                     section: 'مراجعة المدخلات',   access: 'roles', sort: 20 },
  { key: 'income_review.all_sales',name: 'كل المبيعات',            path: '/income-review/all-sales',         section: 'مراجعة المدخلات',   access: 'roles', sort: 21 },
  { key: 'income_review.today_rev',name: 'إيرادات اليوم',          path: '/income-review/today-revenue',     section: 'مراجعة المدخلات',   access: 'roles', sort: 22 },
  { key: 'income_review.all_rev',  name: 'كل الإيرادات',           path: '/income-review/all-revenue',       section: 'مراجعة المدخلات',   access: 'roles', sort: 23 },
  { key: 'income_review.payments', name: 'المدفوعات',              path: '/income-review/payments',          section: 'مراجعة المدخلات',   access: 'roles', sort: 24 },
  { key: 'reports.emp_services',   name: 'خدمات الصنايعية',        path: '/admin/reports/employee-services', section: 'مراجعة المدخلات',   access: 'roles', sort: 25 },
  { key: 'reports.emp_monthly_work_revenue', name: 'مواعيد وإيرادات الموظفين', path: '/admin/reports/employee-monthly-work-revenue', section: 'مراجعة المدخلات', access: 'roles', sort: 27 },
  { key: 'reports.monthly',        name: 'التقرير الشهري',         path: '/reports/monthly',                 section: 'مراجعة المدخلات',   access: 'roles', sort: 26 },
  { key: 'reports.partners',       name: 'تقرير الشركاء',          path: '/admin/reports/partners',          section: 'التقارير',          access: 'roles', sort: 27 },
  // Expenses
  { key: 'expenses.new',           name: 'تسجيل مصروف',           path: '/expenses',                        section: 'المصروفات',          access: 'roles', sort: 30 },
  { key: 'reports.expenses',       name: 'تقرير المصروفات',        path: '/reports/expenses/monthly',        section: 'مراجعة المصروفات',  access: 'roles', sort: 40 },
  // Treasury
  { key: 'treasury.daily',         name: 'قفل اليوم',              path: '/treasury/daily',                  section: 'الخزنة',             access: 'roles', sort: 50 },
  { key: 'treasury.period_summary',name: 'ملخص الخزنة الدوري',     path: '/treasury/period-summary',         section: 'الخزنة',             access: 'roles', sort: 51 },
  { key: 'treasury.movement',      name: 'حركة الخزنة',            path: '/treasury/movement',               section: 'الخزنة',             access: 'roles', sort: 52 },
  { key: 'treasury.summary',       name: 'ملخص حسب الدفع',         path: '/treasury/summary',                section: 'الخزنة',             access: 'roles', sort: 53 },
  { key: 'treasury.shift_close',   name: 'تقفيل الوردية',          path: '/treasury/shift-close',            section: 'الخزنة',             access: 'roles', sort: 54 },
  { key: 'treasury.monthly_close', name: 'تقفيل الشهر',            path: '/admin/monthly-closing',           section: 'الخزنة',             access: 'roles', sort: 55 },
  // Budget
  { key: 'budget.main',            name: 'الميزانية الشهرية',      path: '/budget',                          section: 'الميزانية',          access: 'roles', sort: 60 },
  // Queue
  { key: 'queue.live',             name: 'لوحة الانتظار',          path: '/queue/live',                      section: 'الطابور',            access: 'roles', sort: 70 },
  { key: 'queue.new',              name: 'تذكرة جديدة',            path: '/queue/new',                       section: 'الطابور',            access: 'roles', sort: 71 },
  // Bookings
  { key: 'bookings.list',          name: 'قائمة الحجوزات',         path: '/bookings',                        section: 'الحجوزات',           access: 'roles', sort: 80 },
  { key: 'bookings.new',           name: 'حجز جديد',               path: '/bookings/new',                    section: 'الحجوزات',           access: 'roles', sort: 81 },
  { key: 'bookings.calendar',      name: 'التقويم',                path: '/bookings/calendar',               section: 'الحجوزات',           access: 'roles', sort: 82 },
  // HR
  { key: 'hr.employees',           name: 'الموظفون',               path: '/admin/hr',                        section: 'الموارد البشرية',    access: 'roles', sort: 90 },
  { key: 'hr.attendance',          name: 'متابعة الحضور',          path: '/admin/attendance',                section: 'الموارد البشرية',    access: 'roles', sort: 91 },
  { key: 'hr.payroll',             name: 'يوميات الموظفين',        path: '/admin/attendance/daily-payroll',  section: 'الموارد البشرية',    access: 'roles', sort: 92 },
  { key: 'hr.advances',            name: 'سلف الموظفين',           path: '/expenses-review/advances',        section: 'الموارد البشرية',    access: 'roles', sort: 93 },
  { key: 'hr.salaries',            name: 'مرتبات العاملين',        path: '/expenses-review/salaries',        section: 'الموارد البشرية',    access: 'roles', sort: 94 },
  // Admin
  { key: 'admin.operations',       name: 'مركز التشغيل',           path: '/admin/operations',                section: 'الإدارة',            access: 'roles', sort: 100 },
  { key: 'admin.users',            name: 'المستخدمون',             path: '/admin/users',                     section: 'الإدارة',            access: 'roles', sort: 101 },
  { key: 'admin.services',         name: 'الخدمات',                path: '/admin/services',                  section: 'الإدارة',            access: 'roles', sort: 102 },
  { key: 'admin.payment_methods',  name: 'طرق الدفع',              path: '/admin/payment-methods',           section: 'الإدارة',            access: 'roles', sort: 103 },
  { key: 'admin.categories',       name: 'التصنيفات',              path: '/admin/categories',                section: 'الإدارة',            access: 'roles', sort: 104 },
  { key: 'admin.loyalty',          name: 'إدارة النقاط',           path: '/admin/loyalty',                   section: 'الإدارة',            access: 'roles', sort: 105 },
  { key: 'admin.shift',            name: 'الورديات',               path: '/admin/shift',                     section: 'الإدارة',            access: 'roles', sort: 106 },
  { key: 'admin.settings',         name: 'الإعدادات',              path: '/admin/settings',                  section: 'الإدارة',            access: 'roles', sort: 107 },
  { key: 'admin.queue_settings',   name: 'إعدادات الطابور',        path: '/admin/queue-booking-settings',    section: 'الإدارة',            access: 'roles', sort: 108 },
  // Operations
  { key: 'operations.main',        name: 'لوحة التشغيل',           path: '/operations',                      section: 'لوحة التشغيل',       access: 'all',   sort: 5 },
  { key: 'cut_club.main',          name: 'CUT CLUB',               path: '/admin/cut-club',                  section: 'CUT CLUB',           access: 'roles', sort: 6 },
  // Audit
  { key: 'audit.payment_methods',  name: 'تدقيق طرق الدفع',       path: '/admin/audit/unspecified-payment-methods', section: 'التدقيق', access: 'roles', sort: 110 },
  // Permissions (super_admin_only)
  { key: 'admin.permissions.users',name: 'صلاحيات المستخدمين',    path: '/admin/permissions/users',         section: 'الإدارة',            access: 'super_admin_only', sort: 200 },
  { key: 'admin.permissions.pages',name: 'صلاحيات الصفحات',       path: '/admin/permissions/pages',         section: 'الإدارة',            access: 'super_admin_only', sort: 201 },
  { key: 'admin_approvals',         name: 'سجل التدقيق',             path: '/admin/approvals',                 section: 'الإدارة',            access: 'super_admin_only', sort: 202 },
  // Cashier
  { key: 'cashier_treasury_daily',  name: 'خزنة الكاشير اليومية',     path: '/cashier/treasury/daily',          section: 'الكاشير',           access: 'roles', sort: 56 },
];

// ── Per-role page access ──────────────────────────────────────────────────────
// Format: { role, pages: [pageKey,...], canEdit?, canDelete? }
const ROLE_ACCESS: { role: string; pages: string[]; canEdit?: boolean; canDelete?: boolean }[] = [
  {
    role: 'super_admin',
    pages: PAGES.map(p => p.key),
    canEdit: true, canDelete: true,
  },
  {
    role: 'admin',
    pages: [
      'income.pos','income.new',
      'sales.today','income_review.all_sales','income_review.today_rev','income_review.all_rev',
      'income_review.payments','reports.emp_services','reports.emp_monthly_work_revenue','reports.monthly','reports.partners',
      'expenses.new','reports.expenses',
      'treasury.daily','treasury.period_summary','treasury.movement','treasury.summary',
      'treasury.shift_close','treasury.monthly_close',
      'budget.main',
      'queue.live','queue.new',
      'bookings.list','bookings.new','bookings.calendar',
      'hr.employees','hr.attendance','hr.payroll','hr.advances','hr.salaries',
      'admin.operations','admin.users','admin.services','admin.payment_methods',
      'admin.categories','admin.loyalty','admin.shift','admin.settings','admin.queue_settings',
      'operations.main','cut_club.main',
      'audit.payment_methods',
    ],
    canEdit: true, canDelete: false,
  },
  {
    role: 'manager',
    pages: [
      'income.pos','sales.today','income_review.all_sales','income_review.today_rev',
      'reports.monthly','reports.expenses','reports.emp_services','reports.emp_monthly_work_revenue',
      'treasury.daily','treasury.period_summary','cashier_treasury_daily',
      'queue.live','queue.new',
      'bookings.list','bookings.new','bookings.calendar',
      'hr.attendance','hr.payroll',
      'admin.operations','operations.main',
    ],
    canEdit: true, canDelete: false,
  },
  {
    role: 'cashier',
    pages: [
      'income.pos','income.new',
      'sales.today','income_review.today_rev',
      'expenses.new',
      'cashier_treasury_daily',
      'queue.live','queue.new',
      'bookings.list','bookings.new',
      'operations.main',
    ],
    canEdit: true, canDelete: false,
  },
  {
    role: 'accountant',
    pages: [
      'expenses.new','reports.expenses',
      'treasury.daily','treasury.period_summary','treasury.movement','treasury.summary',
      'treasury.shift_close','treasury.monthly_close',
      'budget.main',
      'income_review.all_rev','income_review.payments','reports.monthly',
    ],
    canEdit: true, canDelete: false,
  },
  {
    role: 'receptionist',
    pages: [
      'bookings.list','bookings.new','bookings.calendar',
      'queue.live','queue.new',
      'operations.main',
    ],
    canEdit: true, canDelete: false,
  },
  {
    role: 'viewer',
    pages: [
      'sales.today','income_review.all_sales','income_review.today_rev','reports.monthly',
      'treasury.period_summary','treasury.movement',
      'operations.main',
    ],
    canEdit: false, canDelete: false,
  },
  {
    role: 'partner',
    pages: ['reports.partners'],
    canEdit: false, canDelete: false,
  },
];

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

  try {
    const db = await getPool();

    // ── Seed Roles ────────────────────────────────────────────────────────────
    for (const role of ROLES) {
      await db.request()
        .input('key',  role.key)
        .input('name', role.name)
        .input('desc', role.desc)
        .query(`
          IF NOT EXISTS (SELECT 1 FROM dbo.TblRoles WHERE RoleKey = @key)
            INSERT INTO dbo.TblRoles (RoleKey, RoleName, Description)
            VALUES (@key, @name, @desc)
        `);
    }

    // ── Seed System Pages ─────────────────────────────────────────────────────
    for (const page of PAGES) {
      await db.request()
        .input('key',    page.key)
        .input('name',   page.name)
        .input('path',   page.path)
        .input('section',page.section)
        .input('access', page.access)
        .input('sort',   page.sort)
        .query(`
          IF NOT EXISTS (SELECT 1 FROM dbo.TblSystemPages WHERE PageKey = @key)
            INSERT INTO dbo.TblSystemPages (PageKey, PageName, PagePath, Section, AccessMode, SortOrder)
            VALUES (@key, @name, @path, @section, @access, @sort)
        `);
    }

    // ── Seed PageRoleAccess ───────────────────────────────────────────────────
    for (const ra of ROLE_ACCESS) {
      for (const pageKey of ra.pages) {
        await db.request()
          .input('roleKey', ra.role)
          .input('pageKey', pageKey)
          .input('canEdit',   ra.canEdit   ? 1 : 0)
          .input('canDelete', ra.canDelete ? 1 : 0)
          .query(`
            DECLARE @rid INT = (SELECT RoleID FROM dbo.TblRoles WHERE RoleKey = @roleKey)
            DECLARE @pid INT = (SELECT PageID FROM dbo.TblSystemPages WHERE PageKey = @pageKey)
            IF @rid IS NOT NULL AND @pid IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM dbo.TblPageRoleAccess WHERE PageID=@pid AND RoleID=@rid)
            BEGIN
              INSERT INTO dbo.TblPageRoleAccess (PageID, RoleID, CanView, CanEdit, CanDelete)
              VALUES (@pid, @rid, 1, @canEdit, @canDelete)
            END
          `);
      }
    }

    // ── Seed UserRoles — Tarek = super_admin + admin, others by UserLevel ─────
    const usersRes = await db.request().query(`
      SELECT UserID, UserName, loginName, UserLevel, isDeleted FROM dbo.TblUser
    `);

    for (const user of usersRes.recordset) {
      if (user.isDeleted) continue;

      const rolesToAssign: string[] = [];

      if (user.loginName === 'Tarek' || user.UserName === 'Tarek') {
        rolesToAssign.push('super_admin', 'admin');
      } else if (user.UserLevel === 'admin') {
        rolesToAssign.push('admin');
      } else if (user.UserLevel === 'user') {
        rolesToAssign.push('cashier');
      }

      for (const roleKey of rolesToAssign) {
        await db.request()
          .input('uid',     user.UserID)
          .input('roleKey', roleKey)
          .query(`
            DECLARE @rid INT = (SELECT RoleID FROM dbo.TblRoles WHERE RoleKey = @roleKey)
            IF @rid IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM dbo.TblUserRoles WHERE UserID=@uid AND RoleID=@rid)
            BEGIN
              INSERT INTO dbo.TblUserRoles (UserID, RoleID) VALUES (@uid, @rid)
            END
          `);
      }
    }

    return NextResponse.json({ success: true, message: 'Seed completed successfully' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
