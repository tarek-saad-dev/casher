// One-time migration + seed script for permissions module
// Run with: node scripts/run-permissions-migration.mjs

import sql from 'mssql';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const config = {
  server:   process.env.CLOUD_DB_SERVER   || process.env.DB_SERVER   || '',
  port:     parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
  database: process.env.CLOUD_DB_NAME     || process.env.DB_DATABASE || 'HawaiRestaurant',
  user:     process.env.CLOUD_DB_USER     || process.env.DB_USER     || '',
  password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '',
  options: {
    encrypt: true,
    trustServerCertificate: process.env.CLOUD_DB_TRUST_CERT === 'true',
    enableArithAbort: true,
  },
  connectionTimeout: 60000,
  requestTimeout:    60000,
};

async function migrate(db) {
  console.log('▶ Running migration...');

  await db.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='TblRoles')
    CREATE TABLE dbo.TblRoles (
      RoleID      INT IDENTITY(1,1) PRIMARY KEY,
      RoleKey     NVARCHAR(50)  NOT NULL UNIQUE,
      RoleName    NVARCHAR(100) NOT NULL,
      Description NVARCHAR(255) NULL,
      IsActive    BIT NOT NULL DEFAULT 1,
      CreatedAt   DATETIME2 NOT NULL DEFAULT GETDATE()
    )
  `);
  console.log('  ✓ TblRoles');

  await db.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='TblUserRoles')
    CREATE TABLE dbo.TblUserRoles (
      ID         INT IDENTITY(1,1) PRIMARY KEY,
      UserID     INT NOT NULL REFERENCES dbo.TblUser(UserID),
      RoleID     INT NOT NULL REFERENCES dbo.TblRoles(RoleID),
      AssignedAt DATETIME2 NOT NULL DEFAULT GETDATE(),
      CONSTRAINT UQ_UserRoles UNIQUE (UserID, RoleID)
    )
  `);
  console.log('  ✓ TblUserRoles');

  await db.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='TblSystemPages')
    CREATE TABLE dbo.TblSystemPages (
      PageID     INT IDENTITY(1,1) PRIMARY KEY,
      PageKey    NVARCHAR(100) NOT NULL UNIQUE,
      PageName   NVARCHAR(150) NOT NULL,
      PagePath   NVARCHAR(255) NOT NULL,
      Section    NVARCHAR(100) NULL,
      AccessMode NVARCHAR(30)  NOT NULL DEFAULT 'roles',
      SortOrder  INT NOT NULL DEFAULT 0,
      IsActive   BIT NOT NULL DEFAULT 1,
      CreatedAt  DATETIME2 NOT NULL DEFAULT GETDATE()
    )
  `);
  console.log('  ✓ TblSystemPages');

  await db.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='TblPageRoleAccess')
    CREATE TABLE dbo.TblPageRoleAccess (
      ID        INT IDENTITY(1,1) PRIMARY KEY,
      PageID    INT NOT NULL REFERENCES dbo.TblSystemPages(PageID),
      RoleID    INT NOT NULL REFERENCES dbo.TblRoles(RoleID),
      CanView   BIT NOT NULL DEFAULT 1,
      CanEdit   BIT NOT NULL DEFAULT 0,
      CanDelete BIT NOT NULL DEFAULT 0,
      CONSTRAINT UQ_PageRoleAccess UNIQUE (PageID, RoleID)
    )
  `);
  console.log('  ✓ TblPageRoleAccess');

  await db.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='TblPermissionAuditLog')
    CREATE TABLE dbo.TblPermissionAuditLog (
      LogID       INT IDENTITY(1,1) PRIMARY KEY,
      ActorUserID INT NULL,
      Action      NVARCHAR(50)  NOT NULL,
      TargetType  NVARCHAR(50)  NULL,
      TargetID    INT NULL,
      Details     NVARCHAR(500) NULL,
      CreatedAt   DATETIME2 NOT NULL DEFAULT GETDATE()
    )
  `);
  console.log('  ✓ TblPermissionAuditLog');
  console.log('✅ Migration complete\n');
}

const ROLES = [
  { key: 'super_admin',  name: 'مدير النظام الكامل',  desc: 'صلاحية كاملة' },
  { key: 'admin',        name: 'مدير عام',             desc: 'معظم الصفحات الإدارية' },
  { key: 'manager',      name: 'مشرف',                 desc: 'تشغيل ومراجعة' },
  { key: 'cashier',      name: 'كاشير',                desc: 'POS وعمليات يومية' },
  { key: 'accountant',   name: 'محاسب',                desc: 'خزنة وتقارير مالية' },
  { key: 'receptionist', name: 'استقبال',              desc: 'حجوزات وعملاء وطابور' },
  { key: 'viewer',       name: 'مشاهد',                desc: 'قراءة فقط' },
];

const PAGES = [
  { key: 'income.pos',              name: 'نقطة البيع',              path: '/income/pos',                       section: 'المدخلات',         access: 'roles', sort: 10 },
  { key: 'income.new',              name: 'إيراد جديد',              path: '/income/new',                       section: 'المدخلات',         access: 'roles', sort: 11 },
  { key: 'sales.today',             name: 'مبيعات اليوم',            path: '/sales/today',                      section: 'مراجعة المدخلات',  access: 'roles', sort: 20 },
  { key: 'income_review.all_sales', name: 'كل المبيعات',             path: '/income-review/all-sales',          section: 'مراجعة المدخلات',  access: 'roles', sort: 21 },
  { key: 'income_review.today_rev', name: 'إيرادات اليوم',           path: '/income-review/today-revenue',      section: 'مراجعة المدخلات',  access: 'roles', sort: 22 },
  { key: 'income_review.all_rev',   name: 'كل الإيرادات',            path: '/income-review/all-revenue',        section: 'مراجعة المدخلات',  access: 'roles', sort: 23 },
  { key: 'income_review.payments',  name: 'المدفوعات',               path: '/income-review/payments',           section: 'مراجعة المدخلات',  access: 'roles', sort: 24 },
  { key: 'reports.emp_services',    name: 'خدمات الصنايعية',         path: '/admin/reports/employee-services',  section: 'مراجعة المدخلات',  access: 'roles', sort: 25 },
  { key: 'reports.monthly',         name: 'التقرير الشهري',          path: '/reports/monthly',                  section: 'مراجعة المدخلات',  access: 'roles', sort: 26 },
  { key: 'expenses.new',            name: 'تسجيل مصروف',            path: '/expenses',                         section: 'المصروفات',         access: 'roles', sort: 30 },
  { key: 'reports.expenses',        name: 'تقرير المصروفات',         path: '/reports/expenses/monthly',         section: 'مراجعة المصروفات', access: 'roles', sort: 40 },
  { key: 'treasury.daily',          name: 'قفل اليوم',               path: '/treasury/daily',                   section: 'الخزنة',            access: 'roles', sort: 50 },
  { key: 'treasury.period_summary', name: 'ملخص الخزنة الدوري',      path: '/treasury/period-summary',          section: 'الخزنة',            access: 'roles', sort: 51 },
  { key: 'treasury.movement',       name: 'حركة الخزنة',             path: '/treasury/movement',                section: 'الخزنة',            access: 'roles', sort: 52 },
  { key: 'treasury.summary',        name: 'ملخص حسب الدفع',          path: '/treasury/summary',                 section: 'الخزنة',            access: 'roles', sort: 53 },
  { key: 'treasury.shift_close',    name: 'تقفيل الوردية',           path: '/treasury/shift-close',             section: 'الخزنة',            access: 'roles', sort: 54 },
  { key: 'treasury.monthly_close',  name: 'تقفيل الشهر',             path: '/admin/monthly-closing',            section: 'الخزنة',            access: 'roles', sort: 55 },
  { key: 'budget.main',             name: 'الميزانية الشهرية',       path: '/budget',                           section: 'الميزانية',         access: 'roles', sort: 60 },
  { key: 'queue.live',              name: 'لوحة الانتظار',           path: '/queue/live',                       section: 'الطابور',           access: 'roles', sort: 70 },
  { key: 'queue.new',               name: 'تذكرة جديدة',             path: '/queue/new',                        section: 'الطابور',           access: 'roles', sort: 71 },
  { key: 'bookings.list',           name: 'قائمة الحجوزات',          path: '/bookings',                         section: 'الحجوزات',          access: 'roles', sort: 80 },
  { key: 'bookings.new',            name: 'حجز جديد',                path: '/bookings/new',                     section: 'الحجوزات',          access: 'roles', sort: 81 },
  { key: 'bookings.calendar',       name: 'التقويم',                 path: '/bookings/calendar',                section: 'الحجوزات',          access: 'roles', sort: 82 },
  { key: 'hr.employees',            name: 'الموظفون',                path: '/admin/hr',                         section: 'الموارد البشرية',   access: 'roles', sort: 90 },
  { key: 'hr.attendance',           name: 'متابعة الحضور',           path: '/admin/attendance',                 section: 'الموارد البشرية',   access: 'roles', sort: 91 },
  { key: 'hr.payroll',              name: 'يوميات الموظفين',         path: '/admin/attendance/daily-payroll',   section: 'الموارد البشرية',   access: 'roles', sort: 92 },
  { key: 'hr.advances',             name: 'سلف الموظفين',            path: '/expenses-review/advances',         section: 'الموارد البشرية',   access: 'roles', sort: 93 },
  { key: 'hr.salaries',             name: 'مرتبات العاملين',         path: '/expenses-review/salaries',         section: 'الموارد البشرية',   access: 'roles', sort: 94 },
  { key: 'admin.operations',        name: 'مركز التشغيل',            path: '/admin/operations',                 section: 'الإدارة',           access: 'roles', sort: 100 },
  { key: 'admin.users',             name: 'المستخدمون',              path: '/admin/users',                      section: 'الإدارة',           access: 'roles', sort: 101 },
  { key: 'admin.services',          name: 'الخدمات',                 path: '/admin/services',                   section: 'الإدارة',           access: 'roles', sort: 102 },
  { key: 'admin.payment_methods',   name: 'طرق الدفع',               path: '/admin/payment-methods',            section: 'الإدارة',           access: 'roles', sort: 103 },
  { key: 'admin.categories',        name: 'التصنيفات',               path: '/admin/categories',                 section: 'الإدارة',           access: 'roles', sort: 104 },
  { key: 'admin.loyalty',           name: 'إدارة النقاط',            path: '/admin/loyalty',                    section: 'الإدارة',           access: 'roles', sort: 105 },
  { key: 'admin.shift',             name: 'الورديات',                path: '/admin/shift',                      section: 'الإدارة',           access: 'roles', sort: 106 },
  { key: 'admin.settings',          name: 'الإعدادات',               path: '/admin/settings',                   section: 'الإدارة',           access: 'roles', sort: 107 },
  { key: 'admin.queue_settings',    name: 'إعدادات الطابور',         path: '/admin/queue-booking-settings',     section: 'الإدارة',           access: 'roles', sort: 108 },
  { key: 'operations.main',         name: 'لوحة التشغيل',            path: '/operations',                       section: 'لوحة التشغيل',      access: 'all',   sort: 5 },
  { key: 'cut_club.main',           name: 'CUT CLUB',                path: '/admin/cut-club',                   section: 'CUT CLUB',          access: 'roles', sort: 6 },
  { key: 'audit.payment_methods',   name: 'تدقيق طرق الدفع',        path: '/admin/audit/unspecified-payment-methods', section: 'التدقيق', access: 'roles', sort: 110 },
  { key: 'admin.permissions.users', name: 'صلاحيات المستخدمين',     path: '/admin/permissions/users',          section: 'الإدارة',           access: 'super_admin_only', sort: 200 },
  { key: 'admin.permissions.pages', name: 'صلاحيات الصفحات',        path: '/admin/permissions/pages',          section: 'الإدارة',           access: 'super_admin_only', sort: 201 },
];

const ROLE_ACCESS = [
  { role: 'super_admin', pages: PAGES.map(p => p.key), canEdit: true, canDelete: true },
  { role: 'admin', pages: [
    'income.pos','income.new','sales.today','income_review.all_sales','income_review.today_rev',
    'income_review.all_rev','income_review.payments','reports.emp_services','reports.monthly',
    'expenses.new','reports.expenses','treasury.daily','treasury.period_summary','treasury.movement',
    'treasury.summary','treasury.shift_close','treasury.monthly_close','budget.main',
    'queue.live','queue.new','bookings.list','bookings.new','bookings.calendar',
    'hr.employees','hr.attendance','hr.payroll','hr.advances','hr.salaries',
    'admin.operations','admin.users','admin.services','admin.payment_methods','admin.categories',
    'admin.loyalty','admin.shift','admin.settings','admin.queue_settings',
    'operations.main','cut_club.main','audit.payment_methods',
  ], canEdit: true, canDelete: false },
  { role: 'manager', pages: [
    'income.pos','sales.today','income_review.all_sales','income_review.today_rev',
    'reports.monthly','reports.expenses','treasury.daily','treasury.period_summary',
    'queue.live','queue.new','bookings.list','bookings.new','bookings.calendar',
    'hr.attendance','hr.payroll','admin.operations','operations.main',
  ], canEdit: true, canDelete: false },
  { role: 'cashier', pages: [
    'income.pos','income.new','sales.today','income_review.today_rev','expenses.new',
    'treasury.daily','queue.live','queue.new','bookings.list','bookings.new','operations.main',
  ], canEdit: true, canDelete: false },
  { role: 'accountant', pages: [
    'expenses.new','reports.expenses','treasury.daily','treasury.period_summary',
    'treasury.movement','treasury.summary','treasury.shift_close','treasury.monthly_close',
    'budget.main','income_review.all_rev','income_review.payments','reports.monthly',
  ], canEdit: true, canDelete: false },
  { role: 'receptionist', pages: [
    'bookings.list','bookings.new','bookings.calendar','queue.live','queue.new','operations.main',
  ], canEdit: true, canDelete: false },
  { role: 'viewer', pages: [
    'sales.today','income_review.all_sales','income_review.today_rev','reports.monthly',
    'treasury.period_summary','treasury.movement','operations.main',
  ], canEdit: false, canDelete: false },
];

async function seed(db) {
  console.log('▶ Seeding roles...');
  for (const role of ROLES) {
    await db.request()
      .input('key', sql.NVarChar, role.key)
      .input('name', sql.NVarChar, role.name)
      .input('desc', sql.NVarChar, role.desc)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.TblRoles WHERE RoleKey=@key)
          INSERT INTO dbo.TblRoles (RoleKey,RoleName,Description) VALUES (@key,@name,@desc)
      `);
    process.stdout.write('  ✓ ' + role.key + '\n');
  }

  console.log('\n▶ Seeding pages...');
  for (const page of PAGES) {
    await db.request()
      .input('key',     sql.NVarChar, page.key)
      .input('name',    sql.NVarChar, page.name)
      .input('path',    sql.NVarChar, page.path)
      .input('section', sql.NVarChar, page.section)
      .input('access',  sql.NVarChar, page.access)
      .input('sort',    sql.Int,      page.sort)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.TblSystemPages WHERE PageKey=@key)
          INSERT INTO dbo.TblSystemPages (PageKey,PageName,PagePath,Section,AccessMode,SortOrder)
          VALUES (@key,@name,@path,@section,@access,@sort)
      `);
    process.stdout.write('  ✓ ' + page.key + '\n');
  }

  console.log('\n▶ Seeding page-role access...');
  for (const ra of ROLE_ACCESS) {
    for (const pageKey of ra.pages) {
      await db.request()
        .input('rk', sql.NVarChar, ra.role)
        .input('pk', sql.NVarChar, pageKey)
        .input('ce', sql.Bit, ra.canEdit   ? 1 : 0)
        .input('cd', sql.Bit, ra.canDelete ? 1 : 0)
        .query(`
          DECLARE @rid INT=(SELECT RoleID FROM dbo.TblRoles WHERE RoleKey=@rk)
          DECLARE @pid INT=(SELECT PageID FROM dbo.TblSystemPages WHERE PageKey=@pk)
          IF @rid IS NOT NULL AND @pid IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM dbo.TblPageRoleAccess WHERE PageID=@pid AND RoleID=@rid)
            INSERT INTO dbo.TblPageRoleAccess (PageID,RoleID,CanView,CanEdit,CanDelete)
            VALUES (@pid,@rid,1,@ce,@cd)
        `);
    }
  }
  console.log('  ✓ PageRoleAccess seeded');

  console.log('\n▶ Seeding user roles...');
  const users = await db.request().query(`SELECT UserID,UserName,loginName,UserLevel,isDeleted FROM dbo.TblUser`);
  for (const u of users.recordset) {
    if (u.isDeleted) continue;
    const rolesToAssign = [];
    if (u.loginName === 'Tarek' || u.UserName === 'Tarek') {
      rolesToAssign.push('super_admin', 'admin');
    } else if (u.UserLevel === 'admin') {
      rolesToAssign.push('admin');
    } else if (u.UserLevel === 'user') {
      rolesToAssign.push('cashier');
    }
    for (const rk of rolesToAssign) {
      await db.request()
        .input('uid', sql.Int, u.UserID)
        .input('rk',  sql.NVarChar, rk)
        .query(`
          DECLARE @rid INT=(SELECT RoleID FROM dbo.TblRoles WHERE RoleKey=@rk)
          IF @rid IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM dbo.TblUserRoles WHERE UserID=@uid AND RoleID=@rid)
            INSERT INTO dbo.TblUserRoles (UserID,RoleID) VALUES (@uid,@rid)
        `);
      console.log(`  ✓ ${u.UserName} → ${rk}`);
    }
  }
  console.log('\n✅ Seed complete');
}

async function main() {
  console.log('Connecting to DB...');
  const pool = await new sql.ConnectionPool(config).connect();
  console.log('Connected ✓\n');
  await migrate(pool);
  await seed(pool);
  await pool.close();
  console.log('\nDone!');
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
