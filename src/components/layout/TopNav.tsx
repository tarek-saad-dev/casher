'use client';

import { useState, useRef, useCallback, CSSProperties } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutGrid, PlusCircle, CreditCard, ClipboardList, TrendingUp,
  History, Receipt, Wallet, Lock, ArrowLeftRight, BarChart3, Clock,
  Calculator, Settings, Scissors, Tags, Shield, Activity, Star,
  UsersRound, FileBarChart, ChevronDown, Calendar,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { DbConnectionStatus } from '@/components/db/DbConnectionStatus';

// ─────────────────────────────────────────────────────────────────────────────
// SHARED DATA & THEMES (mirrors MainNav — single source of truth)
// ─────────────────────────────────────────────────────────────────────────────

interface NavTheme { rgb: string; emoji: string }

const NAV_THEMES: Record<string, NavTheme> = {
  'المدخلات':          { rgb: '214,168,79',  emoji: '📥' },
  'مراجعة المدخلات':   { rgb: '59,130,246',  emoji: '📊' },
  'المصروفات':         { rgb: '244,63,94',   emoji: '💸' },
  'مراجعة المصروفات':  { rgb: '168,85,247',  emoji: '📋' },
  'الخزنة':            { rgb: '16,185,129',  emoji: '🏦' },
  'الميزانية':         { rgb: '6,182,212',   emoji: '💰' },
  'الموارد البشرية':   { rgb: '236,72,153',  emoji: '�' },
  'الإدارة':           { rgb: '148,163,184', emoji: '⚙️' },
};

const getTheme = (title: string): NavTheme =>
  NAV_THEMES[title] ?? { rgb: '161,161,170', emoji: '📌' };

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
}

interface NavSection {
  title: string;
  icon: LucideIcon;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'المدخلات',
    icon: LayoutGrid,
    items: [
      { href: '/income/pos',        label: 'نقطة البيع',    icon: LayoutGrid },
      { href: '/income/new',        label: 'إيراد جديد',   icon: PlusCircle },
      { href: '/income/collection', label: 'تحصيل / دفعة', icon: CreditCard, disabled: true },
    ],
  },
  {
    title: 'مراجعة المدخلات',
    icon: ClipboardList,
    items: [
      { href: '/sales/today',                 label: 'مبيعات اليوم',   icon: TrendingUp },
      { href: '/income-review/all-sales',     label: 'كل المبيعات',   icon: History    },
      { href: '/income-review/today-revenue', label: 'إيرادات اليوم', icon: Wallet     },
      { href: '/income-review/all-revenue',   label: 'كل الإيرادات', icon: History    },
      { href: '/income-review/payments',      label: 'المدفوعات',     icon: CreditCard },
    ],
  },
  {
    title: 'المصروفات',
    icon: Receipt,
    items: [
      { href: '/expenses', label: 'تسجيل مصروف', icon: Receipt },
    ],
  },
  {
    title: 'مراجعة المصروفات',
    icon: BarChart3,
    items: [
      { href: '/reports/expenses/monthly',        label: 'تقرير المصروفات',  icon: BarChart3   },
    ],
  },
  {
    title: 'الخزنة',
    icon: Wallet,
    items: [
      { href: '/treasury/daily',       label: 'قفل اليوم',       icon: Lock           },
      { href: '/treasury/movement',    label: 'حركة الخزنة',     icon: ArrowLeftRight },
      { href: '/treasury/summary',     label: 'ملخص حسب الدفع', icon: BarChart3      },
      { href: '/treasury/shift-close', label: 'تقفيل الوردية',   icon: Clock          },
    ],
  },
  {
    title: 'الميزانية',
    icon: Calculator,
    items: [
      { href: '/budget', label: 'الميزانية الشهرية', icon: Calculator },
    ],
  },
  // ─── HR Module (Single with nested items) ─────────────────────────
  {
    title: 'الموارد البشرية',
    icon: UsersRound,
    items: [
      { href: '/admin/hr',              label: 'الموظفون',       icon: UsersRound },
      { href: '/admin/attendance',      label: 'متابعة الحضور', icon: Clock      },
      { href: '/admin/attendance/daily-payroll', label: 'يوميات الموظفين', icon: Calendar },
      { href: '/expenses-review/advances', label: 'سلف الموظفين', icon: CreditCard },
      { href: '/expenses-review/salaries', label: 'مرتبات العاملين', icon: Wallet     },
    ],
  },
  {
    title: 'الإدارة',
    icon: Settings,
    items: [
      { href: '/admin/operations',      label: 'مركز التشغيل',   icon: Activity   },
      { href: '/admin/users',           label: 'المستخدمون',      icon: Shield     },
      { href: '/admin/services',        label: 'الخدمات',         icon: Scissors   },
      { href: '/admin/payment-methods', label: 'طرق الدفع',      icon: CreditCard },
      { href: '/admin/categories',      label: 'التصنيفات',       icon: Tags       },
      { href: '/admin/loyalty',         label: 'إدارة النقاط',   icon: Star       },
      { href: '/admin/shift',           label: 'الورديات',        icon: Clock      },
      { href: '/admin/settings',        label: 'الإعدادات',       icon: Settings   },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function normPath(p: string) { return p.replace(/\/+$/, '') || '/'; }

// ─────────────────────────────────────────────────────────────────────────────
// DROPDOWN PANEL
// ─────────────────────────────────────────────────────────────────────────────

interface DropdownProps {
  section: NavSection;
  isVisible: boolean;
  onClose: () => void;
  isRouteActive: (href: string) => boolean;
}

function Dropdown({ section, isVisible, onClose, isRouteActive }: DropdownProps) {
  const { rgb } = getTheme(section.title);

  const panelStyle: CSSProperties = {
    position: 'absolute',
    top: 'calc(100% + 8px)',
    right: 0,
    minWidth: 220,
    maxWidth: 300,
    backgroundColor: 'rgba(10,10,14,0.97)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: `1px solid rgba(${rgb},0.22)`,
    borderRadius: 16,
    padding: '8px',
    boxShadow: `0 20px 60px rgba(0,0,0,0.6), 0 0 40px rgba(${rgb},0.12)`,
    zIndex: 10000,
    // Entrance animation via opacity + translateY
    opacity: isVisible ? 1 : 0,
    transform: isVisible ? 'translateY(0)' : 'translateY(-6px)',
    pointerEvents: isVisible ? 'auto' : 'none',
    transition: 'opacity 0.18s ease, transform 0.18s ease',
  };

  return (
    <div style={panelStyle} role="menu">
      {/* Dropdown header */}
      <div style={{
        padding: '6px 10px 8px',
        marginBottom: 4,
        borderBottom: `1px solid rgba(${rgb},0.15)`,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 14 }}>{getTheme(section.title).emoji}</span>
        <span style={{
          fontSize: 11, fontWeight: 600, letterSpacing: '0.05em',
          color: `rgba(${rgb},0.9)`,
          textTransform: 'uppercase',
        }}>
          {section.title}
        </span>
      </div>

      {/* Items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {section.items.map(item => {
          const Icon = item.icon;
          const active = !item.disabled && isRouteActive(item.href);

          if (item.disabled) {
            return (
              <div
                key={item.href}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: 10,
                  opacity: 0.3, cursor: 'not-allowed',
                }}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  backgroundColor: `rgba(${rgb},0.08)`,
                  border: `1px solid rgba(${rgb},0.12)`,
                }}>
                  <Icon style={{ width: 13, height: 13, color: `rgba(${rgb},0.5)` }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: '#6B6B6B' }}>{item.label}</div>
                </div>
                <span style={{
                  fontSize: 9, padding: '1px 5px', borderRadius: 9999,
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  color: '#555', border: '1px solid rgba(255,255,255,0.08)',
                }}>قريباً</span>
              </div>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              onClick={onClose}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', borderRadius: 10,
                textDecoration: 'none',
                backgroundColor: active ? `rgba(${rgb},0.16)` : 'transparent',
                border: active ? `1px solid rgba(${rgb},0.35)` : '1px solid transparent',
                boxShadow: active ? `0 0 14px rgba(${rgb},0.18)` : 'none',
                transition: 'background-color 0.15s, box-shadow 0.15s, border-color 0.15s',
              }}
              onMouseEnter={e => {
                if (active) return;
                const el = e.currentTarget as HTMLElement;
                el.style.backgroundColor = `rgba(${rgb},0.10)`;
                el.style.borderColor = `rgba(${rgb},0.25)`;
                el.style.boxShadow = `0 0 18px rgba(${rgb},0.14)`;
                const ic = el.querySelector('[data-di]') as HTMLElement | null;
                if (ic) {
                  ic.style.backgroundColor = `rgba(${rgb},0.20)`;
                  ic.style.borderColor = `rgba(${rgb},0.35)`;
                }
                const sv = el.querySelector('[data-ds]') as HTMLElement | null;
                if (sv) {
                  sv.style.color = `rgb(${rgb})`;
                  sv.style.textShadow = `0 0 10px rgba(${rgb},0.35)`;
                }
              }}
              onMouseLeave={e => {
                if (active) return;
                const el = e.currentTarget as HTMLElement;
                el.style.backgroundColor = 'transparent';
                el.style.borderColor = 'transparent';
                el.style.boxShadow = 'none';
                const ic = el.querySelector('[data-di]') as HTMLElement | null;
                if (ic) {
                  ic.style.backgroundColor = `rgba(${rgb},0.08)`;
                  ic.style.borderColor = `rgba(${rgb},0.14)`;
                }
                const sv = el.querySelector('[data-ds]') as HTMLElement | null;
                if (sv) {
                  sv.style.color = '#A7A29A';
                  sv.style.textShadow = 'none';
                }
              }}
            >
              {/* Icon box */}
              <div
                data-di
                style={{
                  width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  backgroundColor: active ? `rgba(${rgb},0.22)` : `rgba(${rgb},0.08)`,
                  border: `1px solid ${active ? `rgba(${rgb},0.45)` : `rgba(${rgb},0.14)`}`,
                  boxShadow: active ? `0 0 10px rgba(${rgb},0.25)` : 'none',
                  transition: 'all 0.15s',
                }}
              >
                <Icon style={{
                  width: 13, height: 13,
                  color: active ? `rgb(${rgb})` : `rgba(${rgb},0.7)`,
                  filter: active ? `drop-shadow(0 0 3px rgba(${rgb},0.5))` : 'none',
                }} />
              </div>

              {/* Label */}
              <span
                data-ds
                style={{
                  fontSize: 12, fontWeight: active ? 600 : 400,
                  color: active ? `rgb(${rgb})` : '#A7A29A',
                  textShadow: active ? `0 0 10px rgba(${rgb},0.35)` : 'none',
                  transition: 'color 0.15s, text-shadow 0.15s',
                  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >
                {item.label}
              </span>

              {/* Active indicator dot */}
              {active && (
                <span style={{
                  width: 5, height: 5, borderRadius: 9999, flexShrink: 0,
                  backgroundColor: `rgb(${rgb})`,
                  boxShadow: `0 0 8px rgba(${rgb},0.9), 0 0 16px rgba(${rgb},0.45)`,
                }} />
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY PILL (single top-nav button)
// ─────────────────────────────────────────────────────────────────────────────

interface PillProps {
  section: NavSection;
  isActive: boolean;
  isDimmed: boolean;
  isRouteActive: (href: string) => boolean;
}

function CategoryPill({ section, isActive, isDimmed, isRouteActive }: PillProps) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { rgb } = getTheme(section.title);
  const Icon = section.icon;

  const scheduleClose = useCallback(() => {
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const pillStyle: CSSProperties = {
    position: 'relative',
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '2px 8px',
    borderRadius: 9999,
    cursor: 'pointer',
    border: isActive
      ? `1px solid rgba(${rgb},0.45)`
      : open
        ? `1px solid rgba(${rgb},0.22)`
        : '1px solid transparent',
    backgroundColor: isActive
      ? `rgba(${rgb},0.15)`
      : open
        ? `rgba(${rgb},0.07)`
        : 'transparent',
    boxShadow: isActive ? `0 0 18px rgba(${rgb},0.20)` : 'none',
    opacity: isDimmed && !open ? 0.42 : 1,
    transition: 'all 0.18s ease',
    userSelect: 'none',
    // Critical: overflow visible so dropdown escapes pill bounds
    overflow: 'visible',
  };

  return (
    <div
      style={pillStyle}
      onMouseEnter={() => { cancelClose(); setOpen(true); }}
      onMouseLeave={scheduleClose}
    >
      {/* Icon */}
      <Icon style={{
        width: 12, height: 12, flexShrink: 0,
        color: isActive ? `rgb(${rgb})` : open ? `rgba(${rgb},0.85)` : '#6A6560',
        filter: isActive ? `drop-shadow(0 0 3px rgba(${rgb},0.45))` : 'none',
        transition: 'color 0.18s, filter 0.18s',
      }} />

      {/* Title */}
      <span style={{
        fontSize: 11, fontWeight: isActive ? 600 : 400,
        color: isActive ? `rgb(${rgb})` : open ? `rgba(${rgb},0.85)` : '#9A9590',
        textShadow: isActive ? `0 0 8px rgba(${rgb},0.3)` : 'none',
        whiteSpace: 'nowrap',
        transition: 'all 0.18s',
      }}>
        {section.title}
      </span>

      {/* Chevron */}
      <ChevronDown style={{
        width: 10, height: 10, flexShrink: 0,
        color: isActive ? `rgba(${rgb},0.7)` : open ? `rgba(${rgb},0.5)` : '#3A3835',
        transform: open ? 'rotate(180deg)' : 'rotate(0)',
        transition: 'transform 0.2s ease',
      }} />

      {/* Dropdown — sits outside pill via absolute, pill has overflow:visible */}
      <div
        style={{ overflow: 'visible' }}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        <Dropdown
          section={section}
          isVisible={open}
          onClose={() => setOpen(false)}
          isRouteActive={isRouteActive}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TOP NAV — main export
// ─────────────────────────────────────────────────────────────────────────────

export default function TopNav() {
  const pathname = usePathname();

  const isRouteActive = (href: string): boolean => {
    if (!href || href === '#') return false;
    const cur = normPath(pathname);
    const tgt = normPath(href);
    if (tgt === '/') return cur === '/';
    return cur === tgt || cur.startsWith(tgt + '/');
  };

  const activeSectionTitle: string | null = (() => {
    for (const section of NAV_SECTIONS) {
      for (const item of section.items) {
        if (!item.disabled && isRouteActive(item.href)) return section.title;
      }
    }
    return null;
  })();

  return (
    <nav
      dir="rtl"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        padding: '2px 6px',
        backgroundColor: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 9999,
        // overflow visible so dropdown escapes bar
        overflow: 'visible',
        maxWidth: 'calc(100vw - 520px)',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {NAV_SECTIONS.map(section => {
        const isActive = activeSectionTitle === section.title;
        const isDimmed = activeSectionTitle !== null && !isActive;
        return (
          <CategoryPill
            key={section.title}
            section={section}
            isActive={isActive}
            isDimmed={isDimmed}
            isRouteActive={isRouteActive}
          />
        );
      })}

      {/* Connection Status Indicator */}
      <div style={{ marginRight: 8, marginLeft: 4 }}>
        <DbConnectionStatus />
      </div>
    </nav>
  );
}
