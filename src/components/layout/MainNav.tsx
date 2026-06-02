'use client';

import { useState, useEffect, CSSProperties } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutGrid, PlusCircle, CreditCard, ClipboardList, TrendingUp,
  History, Receipt, Wallet, Lock, ArrowLeftRight, BarChart3, Clock,
  Calculator, Settings, Scissors, Tags, Shield, Activity, Star,
  ChevronDown, Menu, X, SlidersHorizontal, PanelLeftClose, PanelLeftOpen,
  UsersRound, FileBarChart, Calendar, Ticket, CalendarCheck, MonitorPlay,
  AlertTriangle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// NAV THEME SYSTEM — 100% inline styles, rgba() values, no dynamic Tailwind.
// ─────────────────────────────────────────────────────────────────────────────

interface NavTheme {
  rgb: string;    // "r,g,b"
  emoji: string;
}

const NAV_THEMES: Record<string, NavTheme> = {
  'المدخلات':          { rgb: '214,168,79',  emoji: '📥' }, // gold
  'مراجعة المدخلات':   { rgb: '59,130,246',  emoji: '📊' }, // blue
  'المصروفات':         { rgb: '244,63,94',   emoji: '💸' }, // rose
  'مراجعة المصروفات':  { rgb: '168,85,247',  emoji: '📋' }, // violet
  'الخزنة':            { rgb: '16,185,129',  emoji: '🏦' }, // emerald
  'الميزانية':         { rgb: '6,182,212',   emoji: '💰' }, // cyan
  'الموارد البشرية':   { rgb: '236,72,153',  emoji: '👥' }, // pink
  'الإدارة':           { rgb: '148,163,184', emoji: '⚙️' }, // slate
  'لوحة التشغيل':      { rgb: '20,184,166',  emoji: '🖥️' }, // teal
  'الطابور':           { rgb: '245,158,11',  emoji: '🎫' }, // amber
  'الحجوزات':          { rgb: '99,102,241',  emoji: '📅' }, // indigo
  'التدقيق':           { rgb: '239,68,68',   emoji: '🔍' }, // red (audit)
};

function getTheme(title: string): NavTheme {
  return NAV_THEMES[title] ?? { rgb: '161,161,170', emoji: '📌' };
}

// Glow helpers — computed once per rgb
const glow   = (rgb: string, a = 0.22) => `0 0 22px rgba(${rgb},${a})`;
const glow2  = (rgb: string, a = 0.14) => `0 0 14px rgba(${rgb},${a})`;
const dotGlow= (rgb: string)            => `0 0 8px  rgba(${rgb},0.90), 0 0 16px rgba(${rgb},0.45)`;

// ─────────────────────────────────────────────────────────────────────────────
// NAV DATA
// ─────────────────────────────────────────────────────────────────────────────

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  badge?: string; // badge type identifier
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
      { href: '/income/pos',        label: 'نقطة البيع',    icon: LayoutGrid  },
      { href: '/income/new',        label: 'إيراد جديد',   icon: PlusCircle  },
      { href: '/income/collection', label: 'تحصيل / دفعة', icon: CreditCard, disabled: true },
    ],
  },
  {
    title: 'مراجعة المدخلات',
    icon: ClipboardList,
    items: [
      { href: '/sales/today',              label: 'مبيعات اليوم',   icon: TrendingUp  },
      { href: '/income-review/all-sales',  label: 'كل المبيعات',   icon: History     },
      { href: '/income-review/today-revenue', label: 'إيرادات اليوم', icon: Wallet  },
      { href: '/income-review/all-revenue',   label: 'كل الإيرادات', icon: History  },
      { href: '/income-review/payments',   label: 'المدفوعات',     icon: CreditCard  },
      { href: '/admin/reports/employee-services', label: 'خدمات الصنايعية', icon: FileBarChart },
      { href: '/reports/monthly', label: 'التقرير الشهري', icon: BarChart3 },
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
      { href: '/reports/expenses/monthly',       label: 'تقرير المصروفات',  icon: BarChart3   },
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
  // ─── Queue Module ───────────────────────────────────────────────
  {
    title: 'الطابور',
    icon: Ticket,
    items: [
      { href: '/queue/live', label: 'لوحة الانتظار',  icon: LayoutGrid  },
      { href: '/queue/new',  label: 'تذكرة جديدة',    icon: PlusCircle  },
    ],
  },
  // ─── Bookings Module ─────────────────────────────────────────────
  {
    title: 'الحجوزات',
    icon: CalendarCheck,
    items: [
      { href: '/bookings',          label: 'قائمة الحجوزات',  icon: ClipboardList },
      { href: '/bookings/new',      label: 'حجز جديد',        icon: PlusCircle    },
      { href: '/bookings/calendar', label: 'التقويم',          icon: Calendar      },
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
      { href: '/admin/queue-booking-settings', label: 'إعدادات الطابور', icon: Ticket     },
    ],
  },
  {
    title: 'التدقيق',
    icon: AlertTriangle,
    items: [
      { href: '/admin/audit/unspecified-payment-methods', label: 'تدقيق طرق الدفع', icon: AlertTriangle, badge: 'payment-audit' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function MainNav() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<string[]>(['المدخلات']);
  const [isCollapsed, setIsCollapsed] = useState(false);
  
  // Badge count for payment audit
  const [paymentAuditCount, setPaymentAuditCount] = useState<number>(0);
  
  // Fetch badge count periodically
  useEffect(() => {
    const fetchCount = async () => {
      try {
        const response = await fetch('/api/audit/unspecified-payment-methods/count');
        if (response.ok) {
          const data = await response.json();
          setPaymentAuditCount(data.count || 0);
        }
      } catch {
        // Silent fail - badge will just show 0
      }
    };
    
    fetchCount();
    // Refresh every 5 minutes
    const interval = setInterval(fetchCount, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Route matching (normalized, no false positives) ────────────────────────
  // Strips trailing slashes, then checks exact OR prefix-with-slash.
  // IMPORTANT: never uses plain startsWith(href) — avoids /admin matching /admin/services etc.
  const isRouteActive = (href: string): boolean => {
    if (!href || href === '#') return false;
    const norm = (p: string) => p.replace(/\/+$/, '') || '/';
    const cur = norm(pathname);
    const tgt = norm(href);
    if (tgt === '/') return cur === '/';
    return cur === tgt || cur.startsWith(tgt + '/');
  };

  // Derived purely from current pathname — no state involved.
  // This is the ONLY source of truth for "which section is lit".
  const activeSectionTitle: string | null = (() => {
    for (const section of NAV_SECTIONS) {
      for (const item of section.items) {
        if (!item.disabled && isRouteActive(item.href)) {
          return section.title;
        }
      }
    }
    return null;
  })();

  // Auto-expand the active section when navigating
  useEffect(() => {
    if (activeSectionTitle) {
      setExpandedSections(prev =>
        prev.includes(activeSectionTitle)
          ? prev
          : [...prev, activeSectionTitle]
      );
    }
    // Dev verification only — disabled in production for performance
    if (process.env.NODE_ENV === 'development') {
      console.log('[MainNav active]', { pathname, activeSectionTitle });
    }
  }, [pathname, activeSectionTitle]);

  const toggleSection = (title: string) =>
    setExpandedSections(prev =>
      prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title]
    );

  // isActive used only for individual items (child-level)
  const isActive = isRouteActive;

  // ── Sub item renderer ──────────────────────────────────────────────────────
  const renderSubItem = (
    item: NavItem,
    theme: NavTheme,
    isSectionActive: boolean,
    index: number
  ) => {
    const active = isActive(item.href);
    const Icon = item.icon;
    const { rgb } = theme;

    if (item.disabled) {
      return (
        <div
          key={item.href}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '7px 12px', borderRadius: 8, opacity: 0.3, cursor: 'not-allowed',
          }}
        >
          <Icon style={{ width: 13, height: 13, color: `rgb(${rgb})`, flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: '#A7A29A', flex: 1 }}>{item.label}</span>
          <span style={{
            fontSize: 9, padding: '1px 5px', borderRadius: 9999,
            backgroundColor: 'rgba(255,255,255,0.06)',
            color: '#6B6B6B', border: '1px solid rgba(255,255,255,0.08)',
          }}>قريباً</span>
        </div>
      );
    }

    // Staggered entrance delay
    const delay = isSectionActive ? `${index * 45}ms` : '0ms';

    // Base opacity per state — children are NEVER inherited from parent wrapper opacity
    const baseOpacity = active ? 1 : isSectionActive ? 1 : 0.55;

    const baseStyle: CSSProperties = {
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '7px 12px', borderRadius: 8,
      cursor: 'pointer', textDecoration: 'none',
      position: 'relative', overflow: 'hidden',
      transition: `background-color 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease,
                   opacity 0.25s ease ${delay}, transform 0.25s ease ${delay}`,
      opacity: baseOpacity,
      transform: isSectionActive ? 'translateX(0)' : 'translateX(3px)',
      border: '1px solid transparent',
      ...(active ? {
        backgroundColor: `rgba(${rgb}, 0.16)`,
        borderRight: `2px solid rgb(${rgb})`,
        borderColor: `rgba(${rgb}, 0.35)`,
        boxShadow: glow2(rgb, 0.22),
      } : {}),
    };

    const handleMouseEnter = (e: React.MouseEvent<HTMLAnchorElement>) => {
      const el = e.currentTarget as HTMLElement;
      // Always show clearly on hover — overrides any opacity state
      el.style.opacity = '1';
      el.style.transform = 'translateX(0)';
      if (!active) {
        el.style.backgroundColor = `rgba(${rgb}, 0.12)`;
        el.style.boxShadow = `${glow2(rgb, 0.20)}, inset 0 0 20px rgba(${rgb},0.04)`;
        el.style.borderColor = `rgba(${rgb}, 0.30)`;
      }
      // Dot
      const dot = el.querySelector(`[data-dot]`) as HTMLElement | null;
      if (dot && !active) {
        dot.style.width  = '6px';
        dot.style.height = '6px';
        dot.style.backgroundColor = `rgb(${rgb})`;
        dot.style.boxShadow = dotGlow(rgb);
      }
      // Icon
      const icon = el.querySelector(`[data-icon]`) as HTMLElement | null;
      if (icon && !active) {
        icon.style.color = `rgb(${rgb})`;
        icon.style.filter = `drop-shadow(0 0 5px rgba(${rgb},0.55))`;
      }
      // Text
      const txt = el.querySelector(`[data-txt]`) as HTMLElement | null;
      if (txt && !active) {
        txt.style.color = `rgb(${rgb})`;
        txt.style.textShadow = `0 0 12px rgba(${rgb},0.45)`;
        txt.style.fontWeight = '600';
      }
    };

    const handleMouseLeave = (e: React.MouseEvent<HTMLAnchorElement>) => {
      const el = e.currentTarget as HTMLElement;
      el.style.opacity = String(baseOpacity);
      el.style.transform = isSectionActive ? 'translateX(0)' : 'translateX(3px)';
      if (!active) {
        el.style.backgroundColor = 'transparent';
        el.style.boxShadow = 'none';
        el.style.borderColor = 'transparent';
      }
      // Dot
      const dot = el.querySelector(`[data-dot]`) as HTMLElement | null;
      if (dot && !active) {
        const sz = isSectionActive ? '5px' : '4px';
        dot.style.width  = sz;
        dot.style.height = sz;
        dot.style.backgroundColor = isSectionActive ? `rgba(${rgb},0.55)` : `rgba(${rgb},0.25)`;
        dot.style.boxShadow = isSectionActive ? glow2(rgb, 0.35) : 'none';
      }
      // Icon
      const icon = el.querySelector(`[data-icon]`) as HTMLElement | null;
      if (icon && !active) {
        icon.style.color = isSectionActive ? `rgba(${rgb},0.75)` : 'rgba(161,161,170,0.55)';
        icon.style.filter = 'none';
      }
      // Text
      const txt = el.querySelector(`[data-txt]`) as HTMLElement | null;
      if (txt && !active) {
        txt.style.color = isSectionActive ? 'rgba(220,215,208,0.9)' : '#7A7570';
        txt.style.textShadow = 'none';
        txt.style.fontWeight = '400';
      }
    };

    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMobileMenuOpen(false)}
        style={baseStyle}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Subtle gradient overlay visible on hover via JS */}
        {/* Dot */}
        <span
          data-dot
          style={{
            width: active ? 7 : isSectionActive ? 5 : 4,
            height: active ? 7 : isSectionActive ? 5 : 4,
            borderRadius: 9999, flexShrink: 0,
            backgroundColor: active ? `rgb(${rgb})` : isSectionActive ? `rgba(${rgb},0.55)` : `rgba(${rgb},0.25)`,
            boxShadow: active ? dotGlow(rgb) : isSectionActive ? glow2(rgb, 0.35) : 'none',
            transition: 'all 0.18s ease',
          }}
        />
        {/* Icon */}
        <Icon
          data-icon
          style={{
            width: 13, height: 13, flexShrink: 0,
            color: active ? `rgb(${rgb})` : isSectionActive ? `rgba(${rgb},0.75)` : 'rgba(161,161,170,0.55)',
            filter: active ? `drop-shadow(0 0 4px rgba(${rgb},0.5))` : 'none',
            transition: 'color 0.18s, filter 0.18s',
          }}
        />
        {/* Label */}
        <span
          data-txt
          style={{
            fontSize: 11,
            fontWeight: active ? 600 : 400,
            flex: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: active ? `rgb(${rgb})` : isSectionActive ? 'rgba(220,215,208,0.9)' : '#7A7570',
            textShadow: active ? `0 0 10px rgba(${rgb},0.4)` : 'none',
            transition: 'color 0.18s, text-shadow 0.18s',
          }}
        >
          {item.label}
        </span>
        
        {/* Badge */}
        {item.badge === 'payment-audit' && paymentAuditCount > 0 && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 9999,
              backgroundColor: 'rgba(239,68,68,0.85)', // red-500
              color: '#fff',
              border: '1px solid rgba(239,68,68,0.5)',
              boxShadow: '0 0 8px rgba(239,68,68,0.4)',
              flexShrink: 0,
              marginRight: 4,
            }}
          >
            {paymentAuditCount > 99 ? '99+' : paymentAuditCount}
          </span>
        )}
      </Link>
    );
  };

  // ── Direct link renderer (no sub-items, standalone button) ──────────────────
  const renderDirectLink = (href: string, label: string, Icon: LucideIcon, rgb: string) => {
    const active = isActive(href);
    if (isCollapsed) {
      return (
        <Link
          href={href}
          title={label}
          onClick={() => setMobileMenuOpen(false)}
          style={{
            position: 'relative',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 40, height: 40, borderRadius: 12,
            margin: '0 auto 8px',
            backgroundColor: active ? `rgba(${rgb},0.22)` : `rgba(${rgb},0.08)`,
            border: active ? `1px solid rgba(${rgb},0.55)` : `1px solid rgba(${rgb},0.22)`,
            boxShadow: active ? glow(rgb, 0.3) : 'none',
            transition: 'all 0.2s ease',
          }}
        >
          <Icon style={{ width: 18, height: 18, color: `rgb(${rgb})`, filter: active ? `drop-shadow(0 0 5px rgba(${rgb},0.6))` : 'none' }} />
          {active && (
            <span style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', width: 3, height: 22, borderRadius: 9999, backgroundColor: `rgb(${rgb})`, boxShadow: dotGlow(rgb) }} />
          )}
        </Link>
      );
    }
    return (
      <Link
        href={href}
        onClick={() => setMobileMenuOpen(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 12px',
          borderRadius: 12,
          marginBottom: 10,
          backgroundColor: active ? `rgba(${rgb},0.18)` : `rgba(${rgb},0.07)`,
          border: active ? `1px solid rgba(${rgb},0.50)` : `1px solid rgba(${rgb},0.20)`,
          boxShadow: active ? glow(rgb, 0.25) : 'none',
          transition: 'all 0.2s ease',
          textDecoration: 'none',
        }}
        onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = `rgba(${rgb},0.13)`; }}
        onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = `rgba(${rgb},0.07)`; }}
      >
        <div style={{
          width: 30, height: 30, borderRadius: 8, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backgroundColor: `rgba(${rgb},${active ? '0.28' : '0.14'})`,
          border: `1px solid rgba(${rgb},${active ? '0.55' : '0.25'})`,
          boxShadow: active ? glow2(rgb, 0.35) : 'none',
        }}>
          <Icon style={{ width: 15, height: 15, color: `rgb(${rgb})`, filter: active ? `drop-shadow(0 0 5px rgba(${rgb},0.65))` : 'none' }} />
        </div>
        <span style={{
          fontSize: 12, fontWeight: active ? 700 : 600,
          color: active ? `rgb(${rgb})` : `rgba(${rgb},0.85)`,
          textShadow: active ? `0 0 10px rgba(${rgb},0.4)` : 'none',
          transition: 'all 0.2s ease',
        }}>
          {label}
        </span>
        {active && (
          <span style={{ marginRight: 'auto', width: 5, height: 5, borderRadius: 9999, backgroundColor: `rgb(${rgb})`, boxShadow: dotGlow(rgb), flexShrink: 0 }} />
        )}
      </Link>
    );
  };

  // ── Section renderer ───────────────────────────────────────────────────────
  const renderSection = (section: NavSection) => {
    const theme = getTheme(section.title);
    const { rgb } = theme;
    const isSectionActive = activeSectionTitle === section.title;
    const isDimmed = activeSectionTitle !== null && !isSectionActive;

    // ── Collapsed mode ────────────────────────────────────────────────────────
    if (isCollapsed) {
      return section.items.map(item => {
        if (item.disabled) return null;
        const active = isActive(item.href);
        const Icon = item.icon;
        const dimOpacity = isDimmed && !active ? 0.35 : 1;
        return (
          <Link
            key={item.href}
            href={item.href}
            title={item.label}
            onClick={() => setMobileMenuOpen(false)}
            style={{
              position: 'relative',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 40, height: 40, borderRadius: 12,
              margin: '0 auto 4px',
              backgroundColor: active ? `rgba(${rgb}, 0.22)` : 'transparent',
              border: active ? `1px solid rgba(${rgb}, 0.55)` : '1px solid transparent',
              boxShadow: active ? glow(rgb, 0.25) : 'none',
              opacity: dimOpacity,
              transition: 'all 0.2s ease',
            }}
          >
            <Icon style={{
              width: 18, height: 18,
              color: active ? `rgb(${rgb})` : isDimmed ? '#4A4A52' : '#6B6B6B',
              filter: active ? `drop-shadow(0 0 5px rgba(${rgb},0.55))` : 'none',
            }} />
            {active && (
              <span style={{
                position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
                width: 3, height: 22, borderRadius: 9999,
                backgroundColor: `rgb(${rgb})`,
                boxShadow: dotGlow(rgb),
              }} />
            )}
          </Link>
        );
      });
    }

    // ── Expanded mode ─────────────────────────────────────────────────────────
    const isExpanded = expandedSections.includes(section.title);
    const hasActive = isSectionActive;
    const SectionIcon = section.icon;

    // KEY FIX: dim is applied to header button ONLY — not the wrapper.
    // This ensures children control their own opacity independently.
    const wrapperStyle: CSSProperties = {
      marginBottom: 6,
      // NO opacity here — children must not inherit dim
    };

    const headerStyle: CSSProperties = {
      borderRadius: 12,
      backgroundColor: hasActive
        ? `rgba(${rgb}, 0.14)`
        : isExpanded
          ? `rgba(${rgb}, 0.08)`
          : 'transparent',
      border: hasActive
        ? `1px solid rgba(${rgb}, 0.40)`
        : isExpanded
          ? `1px solid rgba(${rgb}, 0.22)`
          : '1px solid transparent',
      boxShadow: hasActive ? glow(rgb, 0.20) : 'none',
      // Dim header button when section is not active
      opacity: isDimmed ? 0.42 : 1,
      transition: 'all 0.25s ease',
    };

    return (
      <div key={section.title} style={wrapperStyle}>
        {/* Section Header — dim applied here only, not on children */}
        <button
          onClick={() => toggleSection(section.title)}
          className="w-full flex items-center justify-between px-3 py-2.5"
          style={headerStyle}
          onMouseEnter={e => {
            if (isDimmed) {
              (e.currentTarget as HTMLElement).style.opacity = '0.82';
            }
          }}
          onMouseLeave={e => {
            if (isDimmed) {
              (e.currentTarget as HTMLElement).style.opacity = '0.42';
            }
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Icon box */}
            <div style={{
              width: 30, height: 30, borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backgroundColor: `rgba(${rgb}, ${hasActive ? '0.25' : isExpanded ? '0.14' : '0.10'})`,
              border: `1px solid rgba(${rgb}, ${hasActive ? '0.50' : isExpanded ? '0.28' : '0.15'})`,
              boxShadow: hasActive ? glow2(rgb, 0.30) : 'none',
              flexShrink: 0,
              transition: 'all 0.2s ease',
            }}>
              <SectionIcon style={{
                width: 15, height: 15,
                color: `rgb(${rgb})`,
                filter: hasActive ? `drop-shadow(0 0 4px rgba(${rgb},0.6))` : 'none',
              }} />
            </div>
            {/* Title */}
            <span style={{
              fontSize: 12,
              fontWeight: hasActive ? 700 : isExpanded ? 600 : 500,
              color: hasActive ? `rgb(${rgb})` : isExpanded ? `rgba(${rgb},0.85)` : '#C4BFB8',
              textShadow: hasActive ? `0 0 10px rgba(${rgb},0.35)` : 'none',
              transition: 'all 0.2s ease',
            }}>
              {section.title}
            </span>
            {/* Glowing active dot */}
            {hasActive && (
              <span style={{
                width: 5, height: 5, borderRadius: 9999, flexShrink: 0,
                backgroundColor: `rgb(${rgb})`,
                boxShadow: dotGlow(rgb),
              }} />
            )}
          </div>

          {/* Chevron */}
          <ChevronDown style={{
            width: 14, height: 14, flexShrink: 0,
            color: hasActive ? `rgb(${rgb})` : isExpanded ? `rgba(${rgb},0.7)` : '#555',
            filter: hasActive ? `drop-shadow(0 0 3px rgba(${rgb},0.5))` : 'none',
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.22s ease, color 0.2s ease',
          }} />
        </button>

        {/* Sub-items container */}
        <div style={{
          overflow: 'hidden',
          maxHeight: isExpanded ? 520 : 0,
          opacity: isExpanded ? 1 : 0,
          transition: 'max-height 0.28s ease, opacity 0.22s ease',
          marginTop: isExpanded ? 3 : 0,
          paddingRight: 6,
        }}>
          <div style={{ position: 'relative' }}>
            {/* Vertical rail — glows for active section */}
            <div style={{
              position: 'absolute',
              right: 12,
              top: 4,
              bottom: 4,
              width: isSectionActive ? 2 : 1.5,
              borderRadius: 9999,
              backgroundColor: isSectionActive ? `rgba(${rgb}, 0.50)` : `rgba(${rgb}, 0.18)`,
              boxShadow: isSectionActive ? `0 0 10px rgba(${rgb}, 0.40)` : 'none',
              transition: 'all 0.3s ease',
            }} />
            <div style={{ paddingRight: 8, display: 'flex', flexDirection: 'column', gap: 1 }}>
              {section.items.map((item, idx) =>
                renderSubItem(item, theme, isSectionActive, idx)
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ── Sidebar nav content ────────────────────────────────────────────────────
  const SidebarContent = () => (
    <div
      className="flex-1 overflow-y-auto scrollbar-luxury-v"
      style={{ padding: isCollapsed ? '8px 6px' : '8px 10px' }}
    >
      {renderDirectLink('/operations', 'لوحة التشغيل', MonitorPlay, '20,184,166')}
      {NAV_SECTIONS.map(section => (
        <div key={section.title}>
          {renderSection(section)}
        </div>
      ))}
    </div>
  );

  return (
    <>
      {/* ── Desktop Sidebar ─────────────────────────────────────────────── */}
      <nav
        className="hidden lg:flex flex-col shrink-0 transition-all duration-300"
        style={{
          width: isCollapsed ? 60 : 215,
          backgroundColor: '#111114',
          borderLeft: '1px solid #2A2A30',
        }}
      >
        {/* Logo + collapse toggle */}
        <div
          className="flex items-center justify-between transition-all duration-300"
          style={{ padding: isCollapsed ? '10px 8px' : '14px 14px 10px' }}
        >
          <div style={{
            width: isCollapsed ? 36 : 52,
            height: isCollapsed ? 36 : 52,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.3s',
          }}>
            <img src="/cutsalon.png" alt="Cut Salon Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
          {!isCollapsed && (
            <button
              onClick={() => setIsCollapsed(true)}
              className="p-1.5 rounded-lg transition-colors hover:bg-[#2A2A30] text-[#6B6B6B] hover:text-[#F7F1E5]"
              title="طي القائمة"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}
          {isCollapsed && (
            <button
              onClick={() => setIsCollapsed(false)}
              className="p-1.5 rounded-lg transition-colors hover:bg-[#2A2A30] text-[#6B6B6B] hover:text-[#F7F1E5] mt-1"
              title="توسيع القائمة"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          )}
        </div>

        <SidebarContent />

        {/* Barber Chair Image */}
        {!isCollapsed && (
          <div style={{ padding: '4px 10px 8px' }}>
            <div className="relative rounded-xl overflow-hidden" style={{ height: 200 }}>
              <img src="/chair.png" alt="Barber Chair" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#111114] via-transparent to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-b from-[#111114] via-transparent to-transparent opacity-40" />
              <div className="absolute inset-0 bg-gradient-to-l from-[#111114] via-transparent to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-r from-[#111114] via-transparent to-transparent" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_30%,#111114_100%)]" />
              <div className="absolute bottom-3 left-3 right-3">
                <div className="bg-black/60 backdrop-blur-sm rounded-lg p-2.5 text-center">
                  <p className="text-amber-400 font-bold text-xs">Cut Salon</p>
                  <p className="text-white/70 text-[10px]">صالون حلاقة راقي</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '10px 10px', borderTop: '1px solid #2A2A30' }}>
          <button
            className="flex items-center justify-center transition-all duration-200 rounded-xl"
            style={{
              width: '100%',
              gap: isCollapsed ? 0 : 8,
              padding: isCollapsed ? '8px' : '8px 12px',
              border: '1px solid rgba(214,168,79,0.40)',
              color: '#D6A84F',
              backgroundColor: 'transparent',
            }}
            title="تخصيص القوائم"
          >
            {!isCollapsed && <span style={{ fontSize: 12 }}>تخصيص القوائم</span>}
            <SlidersHorizontal style={{ width: 14, height: 14 }} />
          </button>
        </div>
      </nav>

      {/* ── Mobile Header ───────────────────────────────────────────────── */}
      <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-[#111114] border-b border-[#2A2A30]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 flex items-center justify-center">
            <img src="/cutsalon.png" alt="Cut Salon Logo" className="w-full h-full object-contain" />
          </div>
          <h2 className="text-base font-bold text-[#F7F1E5]">CUT SALON</h2>
        </div>
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 bg-[#1E1D21] border border-[#2A2A30] rounded-lg text-[#A7A29A] hover:bg-[#2A2A30] transition-colors"
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* ── Mobile Menu ─────────────────────────────────────────────────── */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/80 backdrop-blur-sm">
          <div
            className="absolute top-0 right-0 bottom-0 shadow-2xl flex flex-col"
            style={{ width: 280, backgroundColor: '#111114', borderLeft: '1px solid #2A2A30' }}
          >
            {/* Mobile header */}
            <div className="flex items-center justify-between p-4 border-b border-[#2A2A30]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 flex items-center justify-center">
                  <img src="/cutsalon.png" alt="Cut Salon Logo" className="w-full h-full object-contain" />
                </div>
                <h2 className="text-base font-bold text-[#F7F1E5]">CUT SALON</h2>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 hover:bg-[#2A2A30] rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-[#A7A29A]" />
              </button>
            </div>

            {/* Mobile nav */}
            <div className="flex-1 overflow-y-auto py-3 px-3">
              {NAV_SECTIONS.map(section => (
                <div key={section.title}>{renderSection(section)}</div>
              ))}
            </div>

            {/* Mobile barber image */}
            <div className="px-3 py-2">
              <div className="relative rounded-xl overflow-hidden" style={{ height: 80 }}>
                <img src="/barber-mohamed.jpg" alt="Barber" className="w-full h-full object-cover opacity-60" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#111114] via-transparent to-transparent" />
              </div>
            </div>

            {/* Mobile footer */}
            <div className="p-3 border-t border-[#2A2A30]">
              <button className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl transition-all"
                style={{ border: '1px solid rgba(214,168,79,0.4)', color: '#D6A84F' }}>
                <span className="text-sm">تخصيص القوائم</span>
                <SlidersHorizontal className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
