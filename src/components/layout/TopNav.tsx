'use client';

import { useState, useRef, useCallback, CSSProperties, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { DbConnectionStatus } from '@/components/db/DbConnectionStatus';
import { usePermissions } from '@/components/providers/PermissionsProvider';
import {
  NAV_SECTIONS, getTheme,
  isRouteActive as navIsRouteActive,
  getActiveSectionTitle,
} from './nav-config';
import type { NavItem, NavSection, NavTheme } from './nav-config';

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
    backgroundColor: 'color-mix(in srgb, var(--surface-elevated) 97%, transparent)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: `1px solid rgba(${rgb},0.22)`,
    borderRadius: 16,
    padding: '8px',
    boxShadow: `0 20px 60px color-mix(in srgb, var(--background) 60%, transparent), 0 0 40px rgba(${rgb},0.12)`,
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
                  <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{item.label}</div>
                </div>
                <span style={{
                  fontSize: 9, padding: '1px 5px', borderRadius: 9999,
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  color: 'var(--muted-foreground)', border: '1px solid color-mix(in srgb, var(--foreground) 8%, transparent)',
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
                  sv.style.color = 'var(--muted-foreground)';
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
                  color: active ? `rgb(${rgb})` : 'var(--muted-foreground)',
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
        color: isActive ? `rgb(${rgb})` : open ? `rgba(${rgb},0.85)` : 'var(--muted-foreground)',
        filter: isActive ? `drop-shadow(0 0 3px rgba(${rgb},0.45))` : 'none',
        transition: 'color 0.18s, filter 0.18s',
      }} />

      {/* Title */}
      <span style={{
        fontSize: 11, fontWeight: isActive ? 600 : 400,
        color: isActive ? `rgb(${rgb})` : open ? `rgba(${rgb},0.85)` : 'var(--muted-foreground)',
        textShadow: isActive ? `0 0 8px rgba(${rgb},0.3)` : 'none',
        whiteSpace: 'nowrap',
        transition: 'all 0.18s',
      }}>
        {section.title}
      </span>

      {/* Chevron */}
      <ChevronDown style={{
        width: 10, height: 10, flexShrink: 0,
        color: isActive ? `rgba(${rgb},0.7)` : open ? `rgba(${rgb},0.5)` : 'var(--muted-foreground)',
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
  const { canSeePage, access, loading: permLoading, isAuthenticated } = usePermissions();

  const isPosPage = pathname === '/income/pos';
  const isItemActive = (href: string) => navIsRouteActive(pathname, href);
  const activeSectionTitle = getActiveSectionTitle(pathname);

  // Filter sections — same logic as MainNav
  const visibleSections = useMemo(() => {
    if (permLoading || !isAuthenticated || !access) return [];
    return NAV_SECTIONS.map(section => ({
      ...section,
      items: section.items.filter(item => !item.disabled && canSeePage(item.href)),
    })).filter(section => section.items.length > 0);
  }, [access, permLoading, isAuthenticated, canSeePage]);

  if (permLoading || !isAuthenticated || !access) return null;

  return (
    <nav
      dir="rtl"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        padding: '2px 6px',
        backgroundColor: 'color-mix(in srgb, var(--topbar-background) 80%, transparent)',
        border: '1px solid color-mix(in srgb, var(--topbar-border) 50%, transparent)',
        borderRadius: 9999,
        overflow: 'visible',
        maxWidth: 'calc(100vw - 520px)',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {visibleSections.map(section => {
        const isActive = activeSectionTitle === section.title;
        const isDimmed = activeSectionTitle !== null && !isActive;
        return (
          <CategoryPill
            key={section.title}
            section={section}
            isActive={isActive}
            isDimmed={isDimmed}
            isRouteActive={isItemActive}
          />
        );
      })}

      {/* Connection Status Indicator — hidden on POS page */}
      {!isPosPage && (
        <div style={{ marginRight: 8, marginLeft: 4 }}>
          <DbConnectionStatus />
        </div>
      )}
    </nav>
  );
}
