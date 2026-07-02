'use client';

import { useState, useEffect, CSSProperties, useMemo } from 'react';
import { usePermissions } from '@/components/providers/PermissionsProvider';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, Menu, X, PanelLeftClose, PanelLeftOpen, MonitorPlay, Crown, SlidersHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  NAV_SECTIONS, getTheme,
  isRouteActive as navIsRouteActive,
  getActiveSectionTitle,
} from './nav-config';
import type { NavItem, NavSection, NavTheme } from './nav-config';
import SidebarThemeSwitch from '@/components/theme/SidebarThemeSwitch';


// Glow helpers — computed once per rgb
const glow = (rgb: string, a = 0.22) => `0 0 22px rgba(${rgb},${a})`;
const glow2 = (rgb: string, a = 0.14) => `0 0 14px rgba(${rgb},${a})`;
const dotGlow = (rgb: string) => `0 0 8px  rgba(${rgb},0.90), 0 0 16px rgba(${rgb},0.45)`;


// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

interface MainNavProps {
  /** Hide mobile header/menu chrome (used on POS mobile layout). */
  suppressMobileChrome?: boolean;
}

export default function MainNav({ suppressMobileChrome = false }: MainNavProps) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<string[]>(['المدخلات']);
  const [isCollapsed, setIsCollapsed] = useState(true);

  const { canSeePage, access, loading: permLoading, isAuthenticated } = usePermissions();

  // Filter nav sections based on user permissions
  // 3 states: loading → skeleton | not-authenticated → empty | authenticated → filtered
  const visibleSections = useMemo(() => {
    if (permLoading) return [];          // still fetching — show skeleton
    if (!isAuthenticated || !access) return []; // 401 or error — show nothing
    return NAV_SECTIONS.map(section => ({
      ...section,
      items: section.items.filter(item => !item.disabled && canSeePage(item.href)),
    })).filter(section => section.items.length > 0);
  }, [access, permLoading, isAuthenticated, canSeePage]);

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

  const isActive = (href: string) => navIsRouteActive(pathname, href);
  const activeSectionTitle = getActiveSectionTitle(pathname);

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
          <span style={{ fontSize: 11, color: 'var(--muted-foreground)', flex: 1 }}>{item.label}</span>
          <span style={{
            fontSize: 9, padding: '1px 5px', borderRadius: 9999,
            backgroundColor: 'rgba(255,255,255,0.06)',
            color: 'var(--muted-foreground)', border: '1px solid rgba(255,255,255,0.08)',
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
        dot.style.width = '6px';
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
        dot.style.width = sz;
        dot.style.height = sz;
        dot.style.backgroundColor = isSectionActive ? `rgba(${rgb},0.55)` : `rgba(${rgb},0.25)`;
        dot.style.boxShadow = isSectionActive ? glow2(rgb, 0.35) : 'none';
      }
      // Icon
      const icon = el.querySelector(`[data-icon]`) as HTMLElement | null;
      if (icon && !active) {
        icon.style.color = isSectionActive ? `rgba(${rgb},0.75)` : 'color-mix(in srgb, var(--muted-foreground) 55%, transparent)';
        icon.style.filter = 'none';
      }
      // Text
      const txt = el.querySelector(`[data-txt]`) as HTMLElement | null;
      if (txt && !active) {
        txt.style.color = isSectionActive ? 'color-mix(in srgb, var(--foreground) 90%, transparent)' : 'var(--muted-foreground)';
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
            color: active ? `rgb(${rgb})` : isSectionActive ? `rgba(${rgb},0.75)` : 'color-mix(in srgb, var(--muted-foreground) 55%, transparent)',
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
            color: active ? `rgb(${rgb})` : isSectionActive ? 'color-mix(in srgb, var(--foreground) 90%, transparent)' : 'var(--muted-foreground)',
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
              color: active ? `rgb(${rgb})` : isDimmed ? 'color-mix(in srgb, var(--muted-foreground) 60%, transparent)' : 'var(--muted-foreground)',
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
              color: hasActive ? `rgb(${rgb})` : isExpanded ? `rgba(${rgb},0.85)` : 'var(--sidebar-foreground)',
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
            color: hasActive ? `rgb(${rgb})` : isExpanded ? `rgba(${rgb},0.7)` : 'var(--muted-foreground)',
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
  const NavSkeleton = () => (
    <div style={{ padding: isCollapsed ? '8px 6px' : '8px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[72, 56, 64, 48, 60].map((w, i) => (
        <div key={i} style={{ height: 28, width: isCollapsed ? 28 : `${w}%`, borderRadius: 8, background: 'var(--surface-muted)', animation: 'pulse 1.5s ease-in-out infinite' }} />
      ))}
    </div>
  );

  const SidebarContent = () => (
    <div
      className="flex-1 overflow-y-auto scrollbar-luxury-v"
      style={{ padding: isCollapsed ? '8px 6px' : '8px 10px' }}
    >
      {permLoading ? (
        <NavSkeleton />
      ) : isAuthenticated && access ? (
        <>
          {canSeePage('/operations') && renderDirectLink('/operations', 'لوحة التشغيل', MonitorPlay, '20,184,166')}
          {canSeePage('/admin/cut-club') && renderDirectLink('/admin/cut-club', 'CUT CLUB', Crown, '234,179,8')}
          {visibleSections.map(section => (
            <div key={section.title}>
              {renderSection(section)}
            </div>
          ))}
        </>
      ) : null}
    </div>
  );

  return (
    <>
      {/* ── Desktop Sidebar ─────────────────────────────────────────────── */}
      <nav
        className="hidden lg:flex flex-col shrink-0 transition-all duration-300"
        style={{
          width: isCollapsed ? 60 : 215,
          backgroundColor: 'var(--sidebar-background)',
          borderLeft: '1px solid var(--sidebar-border)',
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
              className="p-1.5 rounded-lg transition-colors hover:bg-sidebar-hover text-muted-foreground hover:text-foreground"
              title="طي القائمة"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}
          {isCollapsed && (
            <button
              onClick={() => setIsCollapsed(false)}
              className="p-1.5 rounded-lg transition-colors hover:bg-sidebar-hover text-muted-foreground hover:text-foreground mt-1"
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
              <div className="absolute inset-0 bg-gradient-to-t from-[var(--sidebar-background)] via-transparent to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-b from-[var(--sidebar-background)] via-transparent to-transparent opacity-40" />
              <div className="absolute inset-0 bg-gradient-to-l from-[var(--sidebar-background)] via-transparent to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-r from-[var(--sidebar-background)] via-transparent to-transparent" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_30%,var(--sidebar-background)_100%)]" />
              <div className="absolute bottom-3 left-3 right-3">
                <div className="bg-background/60 backdrop-blur-sm rounded-lg p-2.5 text-center">
                  <p className="text-primary font-bold text-xs">Cut Salon</p>
                  <p className="text-foreground/70 text-[10px]">صالون حلاقة راقي</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '10px 10px', borderTop: '1px solid var(--sidebar-border)' }}>
          <div className="flex items-center gap-2">
            <button
              className="flex flex-1 items-center justify-center transition-all duration-200 rounded-xl"
              style={{
                gap: isCollapsed ? 0 : 8,
                padding: isCollapsed ? '8px' : '8px 12px',
                border: '1px solid color-mix(in srgb, var(--primary) 40%, transparent)',
                color: 'var(--primary)',
                backgroundColor: 'transparent',
              }}
              title="تخصيص القوائم"
            >
              {!isCollapsed && <span style={{ fontSize: 12 }}>تخصيص القوائم</span>}
              <SlidersHorizontal style={{ width: 14, height: 14 }} />
            </button>
            {!isCollapsed && <SidebarThemeSwitch />}
          </div>
        </div>
      </nav>

      {/* ── Mobile Header ───────────────────────────────────────────────── */}
      <div className={`lg:hidden flex items-center justify-between px-4 py-3 bg-sidebar-background border-b border-sidebar-border ${suppressMobileChrome ? 'max-md:hidden' : ''}`}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 flex items-center justify-center">
            <img src="/cutsalon.png" alt="Cut Salon Logo" className="w-full h-full object-contain" />
          </div>
          <h2 className="text-base font-bold text-foreground">CUT SALON</h2>
        </div>
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 bg-surface-muted border border-sidebar-border rounded-lg text-muted-foreground hover:bg-sidebar-hover transition-colors"
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* ── Mobile Menu ─────────────────────────────────────────────────── */}
      {mobileMenuOpen && !suppressMobileChrome && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/80 backdrop-blur-sm">
          <div
            className="absolute top-0 right-0 bottom-0 shadow-2xl flex flex-col"
            style={{ width: 280, backgroundColor: 'var(--sidebar-background)', borderLeft: '1px solid var(--sidebar-border)' }}
          >
            {/* Mobile header */}
            <div className="flex items-center justify-between p-4 border-b border-sidebar-border">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 flex items-center justify-center">
                  <img src="/cutsalon.png" alt="Cut Salon Logo" className="w-full h-full object-contain" />
                </div>
                <h2 className="text-base font-bold text-foreground">CUT SALON</h2>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 hover:bg-sidebar-hover rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-muted-foreground" />
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
                <div className="absolute inset-0 bg-gradient-to-t from-[var(--sidebar-background)] via-transparent to-transparent" />
              </div>
            </div>

            {/* Mobile footer */}
            <div className="p-3 border-t border-sidebar-border">
              <button className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl transition-all"
                style={{ border: '1px solid color-mix(in srgb, var(--primary) 40%, transparent)', color: 'var(--primary)' }}>
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
