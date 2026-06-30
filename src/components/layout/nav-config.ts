// ── Single source of truth for navigation ────────────────────────────────────
// Both MainNav and TopNav import from here.
// Add / remove / reorder nav items here only.

import {
  LayoutGrid, PlusCircle, CreditCard, ClipboardList, TrendingUp,
  History, Receipt, Wallet, Lock, ArrowLeftRight, BarChart3, Clock,
  Calculator, Settings, Scissors, Tags, Shield, Activity, Star,
  UsersRound, FileBarChart, Calendar, Ticket, CalendarCheck, MonitorPlay,
  AlertTriangle, Crown, KeyRound, FileKey2, Banknote, ShieldCheck, Users,
  HeartHandshake,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NavTheme { rgb: string; emoji: string; }

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  badge?: string;
}

export interface NavSection {
  title: string;
  icon: LucideIcon;
  items: NavItem[];
}

// ── Themes ────────────────────────────────────────────────────────────────────

export const NAV_THEMES: Record<string, NavTheme> = {
  'المدخلات':          { rgb: '214,168,79',  emoji: '📥' },
  'مراجعة المدخلات':   { rgb: '59,130,246',  emoji: '📊' },
  'المصروفات':         { rgb: '244,63,94',   emoji: '💸' },
  'الخصومات':          { rgb: '220,38,38',   emoji: '🔻' },
  'مراجعة المصروفات':  { rgb: '168,85,247',  emoji: '📋' },
  'مراجعة الخصومات':  { rgb: '185,28,28',   emoji: '📊' },
  'الخزنة':            { rgb: '16,185,129',  emoji: '🏦' },
  'الميزانية':         { rgb: '6,182,212',   emoji: '💰' },
  'الموارد البشرية':   { rgb: '236,72,153',  emoji: '👥' },
  'الإدارة':           { rgb: '148,163,184', emoji: '⚙️' },
  'لوحة التشغيل':      { rgb: '20,184,166',  emoji: '🖥️' },
  'الطابور':           { rgb: '245,158,11',  emoji: '🎫' },
  'الحجوزات':          { rgb: '99,102,241',  emoji: '📅' },
  'CUT CLUB':          { rgb: '234,179,8',   emoji: '👑' },
  'التدقيق':           { rgb: '239,68,68',   emoji: '🔍' },
  'الكاشير':           { rgb: '16,185,129',  emoji: '💵' },
};

export function getTheme(title: string): NavTheme {
  return NAV_THEMES[title] ?? { rgb: '161,161,170', emoji: '📌' };
}

// ── Sections ──────────────────────────────────────────────────────────────────

export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'المدخلات',
    icon: LayoutGrid,
    items: [
      { href: '/income/pos',        label: 'نقطة البيع',     icon: LayoutGrid },
      { href: '/income/new',        label: 'إيراد جديد',    icon: PlusCircle },
      { href: '/income/collection', label: 'تحصيل / دفعة',  icon: CreditCard, disabled: true },
    ],
  },
  {
    title: 'مراجعة المدخلات',
    icon: ClipboardList,
    items: [
      { href: '/sales/today',                      label: 'مبيعات اليوم',      icon: TrendingUp  },
      { href: '/income-review/all-sales',          label: 'كل المبيعات',       icon: History     },
      { href: '/income-review/today-revenue',      label: 'إيرادات اليوم',     icon: Wallet      },
      { href: '/income-review/all-revenue',        label: 'كل الإيرادات',      icon: History     },
      { href: '/income-review/payments',           label: 'المدفوعات',          icon: CreditCard  },
      { href: '/admin/reports/employee-services',  label: 'خدمات الصنايعية',   icon: FileBarChart },
      { href: '/admin/reports/partners',           label: 'تقرير الشركاء',      icon: UsersRound    },
      { href: '/admin/reports/partners-overrides', label: 'حسابات الشركاء الخاصة', icon: FileKey2 },
      { href: '/reports/monthly',                  label: 'التقرير الشهري',     icon: BarChart3   },
    ],
  },
  {
    title: 'المصروفات',
    icon: Receipt,
    items: [
      { href: '/expenses', label: 'تسجيل مصروف', icon: Receipt },
      { href: '/deductions', label: 'تسجيل خصم', icon: Users },
    ],
  },
  {
    title: 'مراجعة المصروفات',
    icon: BarChart3,
    items: [
      { href: '/reports/expenses/monthly', label: 'تقرير المصروفات', icon: BarChart3 },
      { href: '/reports/deductions/monthly', label: 'تقرير الخصومات', icon: BarChart3 },
    ],
  },
  {
    title: 'الخزنة',
    icon: Wallet,
    items: [
      { href: '/treasury/daily',          label: 'قفل اليوم',           icon: Lock          },
      { href: '/treasury/period-summary', label: 'ملخص الخزنة الدوري',  icon: Calendar      },
      { href: '/treasury/movement',       label: 'حركة الخزنة',         icon: ArrowLeftRight },
      { href: '/treasury/summary',        label: 'ملخص حسب الدفع',      icon: BarChart3     },
      { href: '/treasury/shift-close',    label: 'تقفيل الوردية',        icon: Clock         },
      { href: '/admin/monthly-closing',   label: 'تقفيل الشهر',          icon: Lock          },
    ],
  },
  {
    title: 'الميزانية',
    icon: Calculator,
    items: [
      { href: '/budget', label: 'الميزانية الشهرية', icon: Calculator },
    ],
  },
  {
    title: 'الطابور',
    icon: Ticket,
    items: [
      { href: '/queue/live', label: 'لوحة الانتظار', icon: LayoutGrid  },
      { href: '/queue/new',  label: 'تذكرة جديدة',  icon: PlusCircle  },
    ],
  },
  {
    title: 'الحجوزات',
    icon: CalendarCheck,
    items: [
      { href: '/bookings',          label: 'قائمة الحجوزات', icon: ClipboardList },
      { href: '/bookings/new',      label: 'حجز جديد',        icon: PlusCircle   },
      { href: '/bookings/calendar', label: 'التقويم',          icon: Calendar     },
    ],
  },
  {
    title: 'الموارد البشرية',
    icon: UsersRound,
    items: [
      { href: '/admin/hr',                        label: 'الموظفون',          icon: UsersRound },
      { href: '/admin/attendance',                label: 'متابعة الحضور',    icon: Clock      },
      { href: '/admin/attendance/daily-payroll',  label: 'يوميات الموظفين',  icon: Calendar   },
      { href: '/expenses-review/advances',        label: 'سلف الموظفين',     icon: CreditCard },
      { href: '/expenses-review/salaries',        label: 'مرتبات العاملين',  icon: Wallet     },
    ],
  },
  {
    title: 'الإدارة',
    icon: Settings,
    items: [
      { href: '/admin/operations',                label: 'مركز التشغيل',          icon: Activity   },
      { href: '/admin/users',                     label: 'المستخدمون',             icon: Shield     },
      { href: '/admin/services',                  label: 'الخدمات',                icon: Scissors   },
      { href: '/admin/payment-methods',           label: 'طرق الدفع',             icon: CreditCard },
      { href: '/admin/categories',                label: 'التصنيفات',              icon: Tags       },
      { href: '/admin/loyalty',                   label: 'إدارة النقاط',          icon: Star       },
      { href: '/admin/shift',                     label: 'الورديات',               icon: Clock      },
      { href: '/admin/settings',                  label: 'الإعدادات',              icon: Settings   },
      { href: '/admin/queue-booking-settings',    label: 'إعدادات الطابور',       icon: Ticket     },
      { href: '/admin/permissions/users',         label: 'صلاحيات المستخدمين',    icon: KeyRound     },
      { href: '/admin/permissions/pages',         label: 'صلاحيات الصفحات',       icon: FileKey2     },
      { href: '/admin/approvals',                 label: 'طلبات الموافقة',          icon: ShieldCheck  },
      { href: '/admin/customers/follow-up',       label: 'متابعة العملاء',           icon: HeartHandshake },
    ],
  },
  {
    title: 'التدقيق',
    icon: AlertTriangle,
    items: [
      { href: '/admin/audit/unspecified-payment-methods', label: 'تدقيق طرق الدفع', icon: AlertTriangle, badge: 'payment-audit' },
    ],
  },
  {
    title: 'الكاشير',
    icon: Banknote,
    items: [
      { href: '/cashier/treasury/daily', label: 'خزنة الكاشير اليومية', icon: Wallet },
    ],
  },
];

// ── Direct links (outside sections — handled separately in MainNav) ───────────
// These are rendered as standalone items, not grouped under a section title.
export const NAV_DIRECT_LINKS: { href: string; label: string; iconName: 'operations' | 'cutclub' }[] = [
  { href: '/operations',     label: 'لوحة التشغيل', iconName: 'operations' },
  { href: '/admin/cut-club', label: 'CUT CLUB',      iconName: 'cutclub'    },
];

// ── Route helpers ─────────────────────────────────────────────────────────────

export function normPath(p: string): string {
  return p.replace(/\/+$/, '') || '/';
}

export function isRouteActive(pathname: string, href: string): boolean {
  if (!href || href === '#') return false;
  const cur = normPath(pathname);
  const tgt = normPath(href);
  if (tgt === '/') return cur === '/';
  return cur === tgt || cur.startsWith(tgt + '/');
}

export function getActiveSectionTitle(pathname: string): string | null {
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (!item.disabled && isRouteActive(pathname, item.href)) return section.title;
    }
  }
  return null;
}
