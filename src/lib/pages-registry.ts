// ── Master list of all system pages ──────────────────────────────────────────
// This is the single source of truth.
// Add new pages here and they will be auto-synced to TblSystemPages on startup.
// AccessMode: 'all' | 'roles' | 'super_admin_only'

export interface PageDefinition {
  key: string;
  name: string;
  path: string;
  section: string;
  accessMode: 'all' | 'roles' | 'super_admin_only';
  sort: number;
  defaultRoles?: string[]; // roles to assign on first insert (optional)
}

export const SYSTEM_PAGES: PageDefinition[] = [
  // ── POS / Income ────────────────────────────────────────────────────────────
  { key: 'income.pos',              name: 'نقطة البيع',              path: '/income/pos',                      section: 'المدخلات',         accessMode: 'roles', sort: 10,  defaultRoles: ['super_admin','admin','manager','cashier'] },
  { key: 'income.new',              name: 'إيراد جديد',              path: '/income/new',                      section: 'المدخلات',         accessMode: 'roles', sort: 11,  defaultRoles: ['super_admin','admin','cashier'] },
  // ── Sales review ────────────────────────────────────────────────────────────
  { key: 'sales.today',             name: 'مبيعات اليوم',            path: '/sales/today',                     section: 'مراجعة المدخلات',  accessMode: 'roles', sort: 20,  defaultRoles: ['super_admin','admin','manager','cashier','viewer'] },
  { key: 'income_review.all_sales', name: 'كل المبيعات',             path: '/income-review/all-sales',         section: 'مراجعة المدخلات',  accessMode: 'roles', sort: 21,  defaultRoles: ['super_admin','admin','manager','viewer'] },
  { key: 'income_review.today_rev', name: 'إيرادات اليوم',           path: '/income-review/today-revenue',     section: 'مراجعة المدخلات',  accessMode: 'roles', sort: 22,  defaultRoles: ['super_admin','admin','manager','cashier','viewer'] },
  { key: 'income_review.all_rev',   name: 'كل الإيرادات',            path: '/income-review/all-revenue',       section: 'مراجعة المدخلات',  accessMode: 'roles', sort: 23,  defaultRoles: ['super_admin','admin','accountant'] },
  { key: 'income_review.payments',  name: 'المدفوعات',               path: '/income-review/payments',          section: 'مراجعة المدخلات',  accessMode: 'roles', sort: 24,  defaultRoles: ['super_admin','admin','accountant'] },
  { key: 'reports.emp_services',    name: 'خدمات الصنايعية',         path: '/admin/reports/employee-services', section: 'مراجعة المدخلات',  accessMode: 'roles', sort: 25,  defaultRoles: ['super_admin','admin','manager'] },
  { key: 'reports.monthly',         name: 'التقرير الشهري',          path: '/reports/monthly',                 section: 'مراجعة المدخلات',  accessMode: 'roles', sort: 26,  defaultRoles: ['super_admin','admin','manager','accountant','viewer'] },
  // ── Expenses ─────────────────────────────────────────────────────────────────
  { key: 'expenses.new',            name: 'تسجيل مصروف',            path: '/expenses',                        section: 'المصروفات',         accessMode: 'roles', sort: 30,  defaultRoles: ['super_admin','admin','cashier','accountant'] },
  { key: 'reports.expenses',        name: 'تقرير المصروفات',         path: '/reports/expenses/monthly',        section: 'مراجعة المصروفات', accessMode: 'roles', sort: 40,  defaultRoles: ['super_admin','admin','manager','accountant'] },
  // ── Treasury ─────────────────────────────────────────────────────────────────
  { key: 'treasury.daily',          name: 'قفل اليوم',               path: '/treasury/daily',                  section: 'الخزنة',            accessMode: 'roles', sort: 50,  defaultRoles: ['super_admin','admin','cashier','accountant'] },
  { key: 'treasury.period_summary', name: 'ملخص الخزنة الدوري',      path: '/treasury/period-summary',         section: 'الخزنة',            accessMode: 'roles', sort: 51,  defaultRoles: ['super_admin','admin','manager','accountant','viewer'] },
  { key: 'treasury.movement',       name: 'حركة الخزنة',             path: '/treasury/movement',               section: 'الخزنة',            accessMode: 'roles', sort: 52,  defaultRoles: ['super_admin','admin','accountant','viewer'] },
  { key: 'treasury.summary',        name: 'ملخص حسب الدفع',          path: '/treasury/summary',                section: 'الخزنة',            accessMode: 'roles', sort: 53,  defaultRoles: ['super_admin','admin','accountant'] },
  { key: 'treasury.shift_close',    name: 'تقفيل الوردية',           path: '/treasury/shift-close',            section: 'الخزنة',            accessMode: 'roles', sort: 54,  defaultRoles: ['super_admin','admin','accountant'] },
  { key: 'treasury.monthly_close',  name: 'تقفيل الشهر',             path: '/admin/monthly-closing',           section: 'الخزنة',            accessMode: 'roles', sort: 55,  defaultRoles: ['super_admin','admin','accountant'] },
  // ── Budget ───────────────────────────────────────────────────────────────────
  { key: 'budget.main',             name: 'الميزانية الشهرية',       path: '/budget',                          section: 'الميزانية',         accessMode: 'roles', sort: 60,  defaultRoles: ['super_admin','admin','accountant'] },
  // ── Queue ────────────────────────────────────────────────────────────────────
  { key: 'queue.live',              name: 'لوحة الانتظار',           path: '/queue/live',                      section: 'الطابور',           accessMode: 'roles', sort: 70,  defaultRoles: ['super_admin','admin','manager','cashier','receptionist'] },
  { key: 'queue.new',               name: 'تذكرة جديدة',             path: '/queue/new',                       section: 'الطابور',           accessMode: 'roles', sort: 71,  defaultRoles: ['super_admin','admin','cashier','receptionist'] },
  // ── Bookings ─────────────────────────────────────────────────────────────────
  { key: 'bookings.list',           name: 'قائمة الحجوزات',          path: '/bookings',                        section: 'الحجوزات',          accessMode: 'roles', sort: 80,  defaultRoles: ['super_admin','admin','manager','cashier','receptionist'] },
  { key: 'bookings.new',            name: 'حجز جديد',                path: '/bookings/new',                    section: 'الحجوزات',          accessMode: 'roles', sort: 81,  defaultRoles: ['super_admin','admin','cashier','receptionist'] },
  { key: 'bookings.calendar',       name: 'التقويم',                 path: '/bookings/calendar',               section: 'الحجوزات',          accessMode: 'roles', sort: 82,  defaultRoles: ['super_admin','admin','manager','receptionist'] },
  // ── HR ───────────────────────────────────────────────────────────────────────
  { key: 'hr.employees',            name: 'الموظفون',                path: '/admin/hr',                        section: 'الموارد البشرية',   accessMode: 'roles', sort: 90,  defaultRoles: ['super_admin','admin'] },
  { key: 'hr.attendance',           name: 'متابعة الحضور',           path: '/admin/attendance',                section: 'الموارد البشرية',   accessMode: 'roles', sort: 91,  defaultRoles: ['super_admin','admin','manager'] },
  { key: 'hr.payroll',              name: 'يوميات الموظفين',         path: '/admin/attendance/daily-payroll',  section: 'الموارد البشرية',   accessMode: 'roles', sort: 92,  defaultRoles: ['super_admin','admin','manager'] },
  { key: 'hr.advances',             name: 'سلف الموظفين',            path: '/expenses-review/advances',        section: 'الموارد البشرية',   accessMode: 'roles', sort: 93,  defaultRoles: ['super_admin','admin'] },
  { key: 'hr.salaries',             name: 'مرتبات العاملين',         path: '/expenses-review/salaries',        section: 'الموارد البشرية',   accessMode: 'roles', sort: 94,  defaultRoles: ['super_admin','admin'] },
  // ── Admin ────────────────────────────────────────────────────────────────────
  { key: 'admin.operations',        name: 'مركز التشغيل',            path: '/admin/operations',                section: 'الإدارة',           accessMode: 'roles', sort: 100, defaultRoles: ['super_admin','admin','manager'] },
  { key: 'admin.users',             name: 'المستخدمون',              path: '/admin/users',                     section: 'الإدارة',           accessMode: 'roles', sort: 101, defaultRoles: ['super_admin','admin'] },
  { key: 'admin.services',          name: 'الخدمات',                 path: '/admin/services',                  section: 'الإدارة',           accessMode: 'roles', sort: 102, defaultRoles: ['super_admin','admin'] },
  { key: 'admin.payment_methods',   name: 'طرق الدفع',               path: '/admin/payment-methods',           section: 'الإدارة',           accessMode: 'roles', sort: 103, defaultRoles: ['super_admin','admin'] },
  { key: 'admin.categories',        name: 'التصنيفات',               path: '/admin/categories',                section: 'الإدارة',           accessMode: 'roles', sort: 104, defaultRoles: ['super_admin','admin'] },
  { key: 'admin.loyalty',           name: 'إدارة النقاط',            path: '/admin/loyalty',                   section: 'الإدارة',           accessMode: 'roles', sort: 105, defaultRoles: ['super_admin','admin'] },
  { key: 'admin.shift',             name: 'الورديات',                path: '/admin/shift',                     section: 'الإدارة',           accessMode: 'roles', sort: 106, defaultRoles: ['super_admin','admin'] },
  { key: 'admin.settings',          name: 'الإعدادات',               path: '/admin/settings',                  section: 'الإدارة',           accessMode: 'roles', sort: 107, defaultRoles: ['super_admin','admin'] },
  { key: 'admin.queue_settings',    name: 'إعدادات الطابور',         path: '/admin/queue-booking-settings',    section: 'الإدارة',           accessMode: 'roles', sort: 108, defaultRoles: ['super_admin','admin'] },
  // ── Special ──────────────────────────────────────────────────────────────────
  { key: 'operations.main',         name: 'لوحة التشغيل',            path: '/operations',                      section: 'لوحة التشغيل',      accessMode: 'all',   sort: 5 },
  { key: 'cut_club.main',           name: 'CUT CLUB',                path: '/admin/cut-club',                  section: 'CUT CLUB',          accessMode: 'roles', sort: 6,   defaultRoles: ['super_admin','admin'] },
  // ── Audit ────────────────────────────────────────────────────────────────────
  { key: 'audit.payment_methods',   name: 'تدقيق طرق الدفع',        path: '/admin/audit/unspecified-payment-methods', section: 'التدقيق', accessMode: 'roles', sort: 110, defaultRoles: ['super_admin','admin'] },
  // ── Permissions (super_admin_only) ───────────────────────────────────────────
  { key: 'admin.permissions.users', name: 'صلاحيات المستخدمين',     path: '/admin/permissions/users',         section: 'الإدارة',           accessMode: 'super_admin_only', sort: 200 },
  { key: 'admin.permissions.pages', name: 'صلاحيات الصفحات',        path: '/admin/permissions/pages',         section: 'الإدارة',           accessMode: 'super_admin_only', sort: 201 },
];
