// ── Single source of truth for navigation ────────────────────────────────────
// Both MainNav and TopNav import from here.
// Add / remove / reorder nav items here only.
//
// Structure (R3 routing IA): MAIN groups (NAV_CATEGORIES) are business
// modules; SUB sections group the pages of a module. Every href must exist in
// src/lib/routing/routeRegistry.ts (enforced by routeRegistry.test.ts), and
// each link is shown only when the user may open it (decideRouteAccess).

import {
  LayoutGrid, PlusCircle, ClipboardList, TrendingUp,
  History, Receipt, Wallet, Lock, ArrowLeftRight, BarChart3, Clock,
  Calculator, Settings, Scissors, Tags, Shield, Activity, Star,
  UsersRound, FileBarChart, Calendar, Ticket, CalendarCheck,
  AlertTriangle, KeyRound, FileKey2, ShieldCheck, Users,
  HeartHandshake, Layers, Beaker, Settings2, Sun, Building2, Package, Boxes,
  MessageCircle, Inbox,
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

/** Top-level groupings for mobile navigation (categories → sections → items). */
export interface NavCategory {
  title: string;
  description: string;
  sectionTitles: string[];
}

export const NAV_CATEGORIES: NavCategory[] = [
  {
    title: 'العمليات اليومية',
    description: 'البيع، المصروفات، الطابور والحجوزات',
    sectionTitles: ['المبيعات', 'المصروفات', 'الطابور', 'الحجوزات'],
  },
  {
    title: 'المراجعة',
    description: 'مراجعة المبيعات والإيرادات والمصروفات',
    sectionTitles: ['مراجعة المدخلات', 'مراجعة المصروفات'],
  },
  {
    title: 'المالية',
    description: 'الخزنة والتقفيل والميزانية',
    sectionTitles: ['الخزنة', 'التقفيل', 'الميزانية'],
  },
  {
    title: 'التقارير',
    description: 'تقارير التشغيل والموظفين والشركاء',
    sectionTitles: ['تقارير مدير', 'تقارير موظف', 'الشركاء'],
  },
  {
    title: 'الموظفون والتشغيل',
    description: 'الموظفون والحضور والورديات ومركز التشغيل',
    sectionTitles: ['الموارد البشرية', 'التشغيل'],
  },
  {
    title: 'الكتالوج والعملاء',
    description: 'الخدمات والمنتجات والمخزون والعملاء والنقاط',
    sectionTitles: ['الكتالوج والمخزون', 'العملاء والولاء'],
  },
  {
    title: 'واتساب',
    description: 'المحادثات، القوالب، الحملات، الجروبات والمساعد',
    sectionTitles: ['واتساب'],
  },
  {
    title: 'الإعدادات',
    description: 'الفروع والمستخدمون والصلاحيات والتدقيق',
    sectionTitles: ['الإعدادات', 'المستخدمون والصلاحيات', 'التدقيق'],
  },
];

// ── Themes (legacy TopNav only — the DRVO shell does not colour sections) ────

export const NAV_THEMES: Record<string, NavTheme> = {
  'المبيعات':              { rgb: '26,123,128',  emoji: '' },
  'مراجعة المدخلات':       { rgb: '26,123,128',  emoji: '' },
  'المصروفات':             { rgb: '26,123,128',  emoji: '' },
  'مراجعة المصروفات':      { rgb: '26,123,128',  emoji: '' },
  'الخزنة':                { rgb: '26,123,128',  emoji: '' },
  'التقفيل':               { rgb: '26,123,128',  emoji: '' },
  'الميزانية':             { rgb: '26,123,128',  emoji: '' },
  'تقارير مدير':           { rgb: '26,123,128',  emoji: '' },
  'تقارير موظف':           { rgb: '26,123,128',  emoji: '' },
  'الشركاء':               { rgb: '26,123,128',  emoji: '' },
  'الموارد البشرية':       { rgb: '26,123,128',  emoji: '' },
  'التشغيل':               { rgb: '26,123,128',  emoji: '' },
  'الطابور':               { rgb: '26,123,128',  emoji: '' },
  'الحجوزات':              { rgb: '26,123,128',  emoji: '' },
  'الكتالوج والمخزون':     { rgb: '26,123,128',  emoji: '' },
  'العملاء والولاء':       { rgb: '26,123,128',  emoji: '' },
  'واتساب':                { rgb: '26,123,128',  emoji: '' },
  'الإعدادات':             { rgb: '26,123,128',  emoji: '' },
  'المستخدمون والصلاحيات': { rgb: '26,123,128',  emoji: '' },
  'التدقيق':               { rgb: '26,123,128',  emoji: '' },
};

export function getTheme(title: string): NavTheme {
  return NAV_THEMES[title] ?? { rgb: '116,83,110', emoji: '' };
}

// ── Sections ──────────────────────────────────────────────────────────────────

export const NAV_SECTIONS: NavSection[] = [
  // ── العمليات اليومية ────────────────────────────────────────────────────────
  {
    title: 'المبيعات',
    icon: LayoutGrid,
    items: [
      { href: '/income/pos', label: 'نقطة البيع', icon: LayoutGrid },
      { href: '/income/new', label: 'إيراد جديد', icon: PlusCircle },
    ],
  },
  {
    title: 'المصروفات',
    icon: Receipt,
    items: [
      { href: '/expenses',   label: 'تسجيل مصروف', icon: Receipt },
      { href: '/deductions', label: 'تسجيل خصم',   icon: Users },
    ],
  },
  {
    title: 'الطابور',
    icon: Ticket,
    items: [
      { href: '/queue/live', label: 'لوحة الانتظار', icon: LayoutGrid },
      { href: '/queue/new',  label: 'تذكرة جديدة',  icon: PlusCircle },
    ],
  },
  {
    title: 'الحجوزات',
    icon: Calendar,
    items: [
      { href: '/bookings',          label: 'قائمة الحجوزات', icon: ClipboardList },
      { href: '/bookings/new',      label: 'حجز جديد',        icon: PlusCircle },
      { href: '/bookings/calendar', label: 'التقويم',          icon: Calendar },
    ],
  },

  // ── المراجعة ───────────────────────────────────────────────────────────────
  {
    title: 'مراجعة المدخلات',
    icon: TrendingUp,
    items: [
      { href: '/sales/today',                 label: 'مبيعات اليوم',  icon: TrendingUp },
      { href: '/income-review/all-revenue',   label: 'كل الإيرادات',  icon: History },
    ],
  },
  {
    title: 'مراجعة المصروفات',
    icon: FileBarChart,
    items: [
      { href: '/reports/expenses/monthly',   label: 'تقرير المصروفات', icon: BarChart3 },
      { href: '/reports/deductions/monthly', label: 'تقرير الخصومات',  icon: BarChart3 },
    ],
  },

  // ── المالية ────────────────────────────────────────────────────────────────
  {
    title: 'الخزنة',
    icon: Wallet,
    items: [
      // One page for treasury staff and cashiers (capabilities follow the grant).
      { href: '/treasury/daily',          label: 'الخزنة اليومية',      icon: Wallet },
      { href: '/treasury/group-daily',    label: 'خزنة كل الفروع',      icon: Building2 },
      { href: '/treasury/period-summary', label: 'ملخص الخزنة الدوري',  icon: Calendar },
    ],
  },
  {
    title: 'التقفيل',
    icon: Lock,
    items: [
      { href: '/admin/monthly-closing', label: 'تقفيل الشهر',   icon: Lock },
    ],
  },
  {
    title: 'الميزانية',
    icon: Calculator,
    items: [
      { href: '/budget', label: 'الميزانية الشهرية', icon: Calculator },
    ],
  },

  // ── التقارير ───────────────────────────────────────────────────────────────
  {
    title: 'تقارير مدير',
    icon: BarChart3,
    items: [
      { href: '/admin/reports/full-day', label: 'تقرير اليوم كامل', icon: Sun },
      { href: '/reports/monthly',        label: 'التقرير الشهري',   icon: BarChart3 },
    ],
  },
  {
    title: 'تقارير موظف',
    icon: FileBarChart,
    items: [
      { href: '/admin/reports/employee-services',             label: 'خدمات الصنايعية',          icon: FileBarChart },
      { href: '/admin/reports/employee-monthly-work-revenue', label: 'مواعيد وإيرادات الموظفين', icon: CalendarCheck },
    ],
  },
  {
    title: 'الشركاء',
    icon: UsersRound,
    items: [
      { href: '/admin/reports/partners',           label: 'تقرير الشركاء',         icon: UsersRound },
      { href: '/admin/reports/partners-real',      label: 'تقرير الشهر الحقيقي',  icon: FileBarChart },
      { href: '/admin/reports/partners-overrides', label: 'تعديلات تقرير الشركاء', icon: FileKey2 },
      { href: '/admin/partners',                   label: 'إدارة الشركاء',         icon: Building2 },
    ],
  },

  // ── الموظفون والتشغيل ─────────────────────────────────────────────────────
  {
    title: 'الموارد البشرية',
    icon: UsersRound,
    items: [
      { href: '/admin/hr',                              label: 'الموظفون',            icon: UsersRound },
      { href: '/admin/hr?tab=attendance',               label: 'متابعة الحضور',       icon: Clock },
      { href: '/admin/hr?tab=employee-monthly-sheet',   label: 'تقرير الموظف الشهري', icon: FileBarChart },
      { href: '/admin/hr/branch-transfer',              label: 'نقل بين الفروع',      icon: ArrowLeftRight },
      { href: '/admin/workforce/availability',          label: 'توافر الموظفين',      icon: CalendarCheck },
    ],
  },
  {
    title: 'التشغيل',
    icon: Activity,
    items: [
      { href: '/admin/operations',         label: 'مركز التشغيل',       icon: Activity },
      { href: '/admin/day',                label: 'اليوم التشغيلي',     icon: Sun },
      { href: '/admin/shift',              label: 'الورديات',           icon: Clock },
      { href: '/admin/booking/operations', label: 'تشغيل الحجز العام', icon: CalendarCheck },
    ],
  },

  // ── الكتالوج والعملاء ─────────────────────────────────────────────────────
  {
    title: 'الكتالوج والمخزون',
    icon: Package,
    items: [
      { href: '/admin/services',   label: 'الخدمات',    icon: Scissors },
      { href: '/admin/packages',   label: 'الباكدجات',  icon: Package },
      { href: '/admin/products',   label: 'المنتجات',   icon: Package },
      { href: '/admin/inventory',  label: 'المخزون',    icon: Boxes },
      { href: '/admin/categories', label: 'التصنيفات',  icon: Tags },
    ],
  },
  {
    title: 'العملاء والولاء',
    icon: HeartHandshake,
    items: [
      { href: '/admin/customers/follow-up', label: 'متابعة العملاء', icon: HeartHandshake },
      { href: '/admin/loyalty',             label: 'إدارة النقاط',  icon: Star },
    ],
  },

  // ── واتساب ─────────────────────────────────────────────────────────────────
  {
    title: 'واتساب',
    icon: MessageCircle,
    items: [
      { href: '/admin/whatsapp/inbox',         label: 'صندوق الوارد',       icon: Inbox, badge: 'whatsapp-unread' },
      { href: '/admin/whatsapp?tab=templates', label: 'قوالب الرسائل',      icon: FileBarChart },
      { href: '/admin/whatsapp?tab=campaigns', label: 'الحملات',            icon: PlusCircle },
      { href: '/admin/whatsapp?tab=groups',    label: 'الجروبات',           icon: UsersRound },
      { href: '/admin/ai-concierge',           label: 'مساعد الصالون',      icon: MessageCircle },
      { href: '/admin/integrations/whatsapp',  label: 'تشخيص تكامل واتساب', icon: Activity },
      { href: '/admin/whatsapp',               label: 'إعدادات واتساب',     icon: Settings },
    ],
  },

  // ── الإعدادات ──────────────────────────────────────────────────────────────
  {
    title: 'الإعدادات',
    icon: Settings,
    items: [
      { href: '/admin/branches',               label: 'الفروع',           icon: Building2 },
      { href: '/admin/queue-booking-settings', label: 'إعدادات الطابور', icon: Ticket },
      { href: '/admin/settings',               label: 'الإعدادات العامة', icon: Settings },
    ],
  },
  {
    title: 'المستخدمون والصلاحيات',
    icon: Shield,
    items: [
      { href: '/admin/users',             label: 'المستخدمون',          icon: Shield },
      { href: '/admin/permissions/users', label: 'صلاحيات المستخدمين', icon: KeyRound },
      { href: '/admin/permissions/pages', label: 'صلاحيات الصفحات',    icon: FileKey2 },
      { href: '/admin/approvals',         label: 'طلبات الموافقة',      icon: ShieldCheck },
    ],
  },
  {
    title: 'التدقيق',
    icon: AlertTriangle,
    items: [
      { href: '/admin/audit/cash-move-classification',      label: 'تدقيق تصنيف الخزنة',     icon: Layers },
      { href: '/admin/accounting/classification-lab',       label: 'معمل التصنيف المحاسبي', icon: Beaker },
      { href: '/admin/accounting/classification-settings',  label: 'إعدادات التصنيف',        icon: Settings2 },
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

function splitHref(href: string): { path: string; query: URLSearchParams } {
  const [path, query = ''] = href.split('?');
  return { path: normPath(path), query: new URLSearchParams(query) };
}

/**
 * Active-state matching. Items with a query (e.g. `/admin/hr?tab=attendance`)
 * are active only when the current URL carries the same params; plain items
 * match their path and sub-paths. Pass `search` (location.search) for tabs.
 */
export function isRouteActive(pathname: string, href: string, search = ''): boolean {
  if (!href || href === '#') return false;
  const cur = normPath(pathname.split('?')[0]);
  const target = splitHref(href);
  if (target.path === '/') return cur === '/';
  const pathMatches = cur === target.path || cur.startsWith(target.path + '/');
  if (!pathMatches) return false;
  if ([...target.query.keys()].length === 0) return true;
  const current = new URLSearchParams(search);
  for (const [key, value] of target.query) {
    if (current.get(key) !== value) return false;
  }
  return true;
}

export function getActiveSectionTitle(pathname: string, search = ''): string | null {
  return getActiveNavLocation(pathname, search)?.section.title ?? null;
}

export function getActiveNavItem(pathname: string, search = ''): NavItem | null {
  return getActiveNavLocation(pathname, search)?.item ?? null;
}

/**
 * Most specific matching item: query items beat plain items, longer paths
 * beat shorter ones (so `/admin/hr?tab=attendance` wins over `/admin/hr`).
 */
function getActiveNavLocation(pathname: string, search: string): { section: NavSection; item: NavItem } | null {
  let best: { section: NavSection; item: NavItem; score: number } | null = null;
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (item.disabled || !isRouteActive(pathname, item.href, search)) continue;
      const { path, query } = splitHref(item.href);
      const score = path.length * 10 + [...query.keys()].length;
      if (!best || score > best.score) best = { section, item, score };
    }
  }
  return best ? { section: best.section, item: best.item } : null;
}

export function getActiveCategoryTitle(sectionTitle: string | null): string | null {
  if (!sectionTitle) return null;
  for (const category of NAV_CATEGORIES) {
    if (category.sectionTitles.includes(sectionTitle)) return category.title;
  }
  return null;
}

// ── Nav tree (MAIN → SUB → items) ────────────────────────────────────────────

export interface NavMainMeta { icon: LucideIcon; rgb: string; emoji: string; }

/** Icon for each MAIN group (keyed by NAV_CATEGORIES title). */
export const NAV_MAIN_META: Record<string, NavMainMeta> = {
  'العمليات اليومية':   { icon: LayoutGrid,     rgb: '116,83,110', emoji: '' },
  'المراجعة':            { icon: ClipboardList,  rgb: '116,83,110', emoji: '' },
  'المالية':             { icon: Wallet,         rgb: '116,83,110', emoji: '' },
  'التقارير':            { icon: BarChart3,      rgb: '116,83,110', emoji: '' },
  'الموظفون والتشغيل':  { icon: UsersRound,     rgb: '116,83,110', emoji: '' },
  'الكتالوج والعملاء':  { icon: Package,        rgb: '116,83,110', emoji: '' },
  'واتساب':              { icon: MessageCircle,  rgb: '116,83,110', emoji: '' },
  'الإعدادات':           { icon: Settings,       rgb: '116,83,110', emoji: '' },
};

export function getMainMeta(title: string): NavMainMeta {
  return NAV_MAIN_META[title] ?? { icon: LayoutGrid, rgb: '116,83,110', emoji: '' };
}

/** MAIN group resolved with its concrete (already permission-filtered) SUB sections. */
export interface NavMainGroup {
  title: string;
  description: string;
  meta: NavMainMeta;
  subs: NavSection[];
}

/**
 * Group a list of (already visible/filtered) sections into MAIN groups using
 * NAV_CATEGORIES. Sections not referenced by any category are appended into a
 * fallback "أخرى" group so nothing ever disappears.
 */
export function buildNavTree(sections: NavSection[]): NavMainGroup[] {
  const byTitle = new Map(sections.map(s => [s.title, s]));
  const used = new Set<string>();

  const groups: NavMainGroup[] = NAV_CATEGORIES.map(category => {
    const subs = category.sectionTitles
      .map(t => byTitle.get(t))
      .filter((s): s is NavSection => Boolean(s));
    subs.forEach(s => used.add(s.title));
    return {
      title: category.title,
      description: category.description,
      meta: getMainMeta(category.title),
      subs,
    };
  }).filter(group => group.subs.length > 0);

  const leftovers = sections.filter(s => !used.has(s.title));
  if (leftovers.length > 0) {
    groups.push({
      title: 'أخرى',
      description: 'أقسام غير مصنّفة',
      meta: getMainMeta('أخرى'),
      subs: leftovers,
    });
  }

  return groups;
}

export function getActiveMainTitle(pathname: string, search = ''): string | null {
  return getActiveCategoryTitle(getActiveSectionTitle(pathname, search));
}
