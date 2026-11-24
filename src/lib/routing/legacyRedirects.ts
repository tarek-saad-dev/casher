/**
 * Old URLs that no longer have a page. They are redirected by next.config.ts
 * (`redirects()`), before any page renders, so bookmarks, PWA shortcuts and old
 * links keep working with zero page code. Query strings are passed through.
 *
 * Imported by next.config.ts, so this file must stay dependency-free.
 */
export type LegacyRedirect = { source: string; destination: string };

export const LEGACY_REDIRECTS: readonly LegacyRedirect[] = [
  // Former redirect-only pages
  { source: '/income/collection', destination: '/income/pos' },
  { source: '/income-review/today-sales', destination: '/sales/today' },
  { source: '/expenses/new', destination: '/expenses' },
  { source: '/expenses/fixed', destination: '/expenses' },
  { source: '/expenses-review/advances', destination: '/admin/hr' },
  { source: '/expenses-review/report', destination: '/reports/expenses/monthly' },
  { source: '/cashier/treasury/daily', destination: '/treasury/daily' },
  { source: '/treasury/daily-close', destination: '/treasury/daily' },
  { source: '/admin/hr/employee-monthly-sheet', destination: '/admin/hr?tab=employee-monthly-sheet' },
  { source: '/admin/employees', destination: '/admin/hr?tab=employees' },
  { source: '/admin/employees/run-migration', destination: '/admin/hr' },
  { source: '/admin/attendance', destination: '/admin/hr?tab=attendance' },
  { source: '/admin/attendance/daily-payroll', destination: '/admin/hr?tab=daily-payroll' },

  // Placeholder pages that never showed data (removed 2026-11)
  { source: '/income-review/all-sales', destination: '/income-review/all-revenue' },
  { source: '/income-review/payments', destination: '/income-review/all-revenue' },
  { source: '/income-review/today-revenue', destination: '/sales/today' },
  { source: '/expenses-review/salaries', destination: '/admin/hr' },
  { source: '/treasury/movement', destination: '/treasury/period-summary' },
  { source: '/treasury/summary', destination: '/treasury/period-summary' },
  { source: '/treasury/shift-close', destination: '/treasury/daily' },
  { source: '/admin/payment-methods', destination: '/admin/settings' },

  // Day and shift screens are tabs of مركز التشغيل (2026-11)
  { source: '/admin/day', destination: '/admin/operations?tab=day' },
  { source: '/admin/shift', destination: '/admin/operations?tab=shift' },

  // Audit screen whose APIs were removed (96ef91ad)
  { source: '/admin/audit/unspecified-payment-methods', destination: '/admin/audit/cash-move-classification' },
];
