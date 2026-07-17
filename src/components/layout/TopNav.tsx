'use client';

import { useState, useRef, useCallback, useEffect, CSSProperties, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { DbConnectionStatus } from '@/components/db/DbConnectionStatus';
import { usePermissions } from '@/components/providers/PermissionsProvider';
import {
  NAV_SECTIONS, getTheme,
  isRouteActive as navIsRouteActive,
  getActiveSectionTitle,
  getActiveMainTitle,
  buildNavTree,
} from './nav-config';
import type { NavSection, NavItem, NavMainGroup } from './nav-config';
import { useNavMode } from '@/hooks/useNavMode';

// ─────────────────────────────────────────────────────────────────────────────
// DROPDOWN ITEM (shared by section + main dropdowns)
// ─────────────────────────────────────────────────────────────────────────────

function DropdownItem({
  item, rgb, isRouteActive, onClose,
}: {
  item: NavItem;
  rgb: string;
  isRouteActive: (href: string) => boolean;
  onClose: () => void;
}) {
  const Icon = item.icon;
  const active = !item.disabled && isRouteActive(item.href);

  if (item.disabled) {
    return (
      <div
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

      {active && (
        <span style={{
          width: 5, height: 5, borderRadius: 9999, flexShrink: 0,
          backgroundColor: `rgb(${rgb})`,
          boxShadow: `0 0 8px rgba(${rgb},0.9), 0 0 16px rgba(${rgb},0.45)`,
        }} />
      )}
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DROPDOWN PANEL
// ─────────────────────────────────────────────────────────────────────────────

interface DropdownProps {
  section: NavSection;
  isVisible: boolean;
  anchorRect: DOMRect | null;
  onClose: () => void;
  isRouteActive: (href: string) => boolean;
}

function Dropdown({ section, isVisible, anchorRect, onClose, isRouteActive }: DropdownProps) {
  const { rgb } = getTheme(section.title);

  if (!anchorRect) return null;

  const panelStyle: CSSProperties = {
    position: 'fixed',
    top: anchorRect.bottom + 8,
    right: Math.max(8, window.innerWidth - anchorRect.right),
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
    opacity: isVisible ? 1 : 0,
    transform: isVisible ? 'translateY(0)' : 'translateY(-6px)',
    pointerEvents: isVisible ? 'auto' : 'none',
    transition: 'opacity 0.18s ease, transform 0.18s ease',
  };

  return (
    <div style={panelStyle} role="menu">
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {section.items.map(item => (
          <DropdownItem
            key={item.href}
            item={item}
            rgb={rgb}
            isRouteActive={isRouteActive}
            onClose={onClose}
          />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN DROPDOWN (tree mode) — groups SUB sections then their items
// ─────────────────────────────────────────────────────────────────────────────

interface MainDropdownProps {
  group: NavMainGroup;
  isVisible: boolean;
  anchorRect: DOMRect | null;
  onClose: () => void;
  isRouteActive: (href: string) => boolean;
}

function MainDropdown({ group, isVisible, anchorRect, onClose, isRouteActive }: MainDropdownProps) {
  const { rgb } = group.meta;

  if (!anchorRect) return null;

  const panelStyle: CSSProperties = {
    position: 'fixed',
    top: anchorRect.bottom + 8,
    right: Math.max(8, window.innerWidth - anchorRect.right),
    minWidth: 240,
    maxWidth: 320,
    maxHeight: 'calc(100vh - 140px)',
    overflowY: 'auto',
    backgroundColor: 'color-mix(in srgb, var(--surface-elevated) 97%, transparent)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: `1px solid rgba(${rgb},0.22)`,
    borderRadius: 16,
    padding: '8px',
    boxShadow: `0 20px 60px color-mix(in srgb, var(--background) 60%, transparent), 0 0 40px rgba(${rgb},0.12)`,
    zIndex: 10000,
    opacity: isVisible ? 1 : 0,
    transform: isVisible ? 'translateY(0)' : 'translateY(-6px)',
    pointerEvents: isVisible ? 'auto' : 'none',
    transition: 'opacity 0.18s ease, transform 0.18s ease',
  };

  return (
    <div style={panelStyle} role="menu" className="scrollbar-luxury-v">
      <div style={{
        padding: '6px 10px 8px',
        marginBottom: 4,
        borderBottom: `1px solid rgba(${rgb},0.15)`,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 14 }}>{group.meta.emoji}</span>
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
          color: `rgba(${rgb},0.9)`,
        }}>
          {group.title}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {group.subs.map(sub => {
          const subTheme = getTheme(sub.title);
          const SubIcon = sub.icon;
          return (
            <div key={sub.title}>
              {/* SUB header */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '4px 8px 4px', marginBottom: 2,
              }}>
                <SubIcon style={{ width: 12, height: 12, color: `rgb(${subTheme.rgb})`, flexShrink: 0 }} />
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.03em',
                  color: `rgba(${subTheme.rgb},0.85)`,
                }}>
                  {sub.title}
                </span>
                <span style={{
                  flex: 1, height: 1, marginRight: 4,
                  background: `linear-gradient(to left, rgba(${subTheme.rgb},0.25), transparent)`,
                }} />
              </div>
              {/* SUB items */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {sub.items.map(item => (
                  <DropdownItem
                    key={item.href}
                    item={item}
                    rgb={subTheme.rgb}
                    isRouteActive={isRouteActive}
                    onClose={onClose}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY PILL
// ─────────────────────────────────────────────────────────────────────────────

interface PillProps {
  section: NavSection;
  isActive: boolean;
  isDimmed: boolean;
  isRouteActive: (href: string) => boolean;
}

function CategoryPill({ section, isActive, isDimmed, isRouteActive }: PillProps) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { rgb } = getTheme(section.title);
  const Icon = section.icon;

  const updateAnchor = useCallback(() => {
    if (pillRef.current) setAnchorRect(pillRef.current.getBoundingClientRect());
  }, []);

  const scheduleClose = useCallback(() => {
    closeTimer.current = setTimeout(() => setOpen(false), 140);
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const openMenu = useCallback(() => {
    cancelClose();
    updateAnchor();
    setOpen(true);
  }, [cancelClose, updateAnchor]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => updateAnchor();
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open, updateAnchor]);

  const pillStyle: CSSProperties = {
    position: 'relative',
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '2px 8px',
    borderRadius: 9999,
    cursor: 'pointer',
    flexShrink: 0,
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
  };

  return (
    <div
      ref={pillRef}
      data-section={section.title}
      style={pillStyle}
      onMouseEnter={openMenu}
      onMouseLeave={scheduleClose}
    >
      <Icon style={{
        width: 12, height: 12, flexShrink: 0,
        color: isActive ? `rgb(${rgb})` : open ? `rgba(${rgb},0.85)` : 'var(--muted-foreground)',
        filter: isActive ? `drop-shadow(0 0 3px rgba(${rgb},0.45))` : 'none',
        transition: 'color 0.18s, filter 0.18s',
      }} />

      <span style={{
        fontSize: 11, fontWeight: isActive ? 600 : 400,
        color: isActive ? `rgb(${rgb})` : open ? `rgba(${rgb},0.85)` : 'var(--muted-foreground)',
        textShadow: isActive ? `0 0 8px rgba(${rgb},0.3)` : 'none',
        whiteSpace: 'nowrap',
        transition: 'all 0.18s',
      }}>
        {section.title}
      </span>

      <ChevronDown style={{
        width: 10, height: 10, flexShrink: 0,
        color: isActive ? `rgba(${rgb},0.7)` : open ? `rgba(${rgb},0.5)` : 'var(--muted-foreground)',
        transform: open ? 'rotate(180deg)' : 'rotate(0)',
        transition: 'transform 0.2s ease',
      }} />

      <div
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        <Dropdown
          section={section}
          isVisible={open}
          anchorRect={anchorRect}
          onClose={() => setOpen(false)}
          isRouteActive={isRouteActive}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PILL (tree mode)
// ─────────────────────────────────────────────────────────────────────────────

interface MainPillProps {
  group: NavMainGroup;
  isActive: boolean;
  isDimmed: boolean;
  isRouteActive: (href: string) => boolean;
}

function MainPill({ group, isActive, isDimmed, isRouteActive }: MainPillProps) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { rgb } = group.meta;
  const Icon = group.meta.icon;

  const updateAnchor = useCallback(() => {
    if (pillRef.current) setAnchorRect(pillRef.current.getBoundingClientRect());
  }, []);

  const scheduleClose = useCallback(() => {
    closeTimer.current = setTimeout(() => setOpen(false), 140);
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const openMenu = useCallback(() => {
    cancelClose();
    updateAnchor();
    setOpen(true);
  }, [cancelClose, updateAnchor]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => updateAnchor();
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open, updateAnchor]);

  const pillStyle: CSSProperties = {
    position: 'relative',
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '2px 8px',
    borderRadius: 9999,
    cursor: 'pointer',
    flexShrink: 0,
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
  };

  return (
    <div
      ref={pillRef}
      data-main={group.title}
      style={pillStyle}
      onMouseEnter={openMenu}
      onMouseLeave={scheduleClose}
    >
      <Icon style={{
        width: 12, height: 12, flexShrink: 0,
        color: isActive ? `rgb(${rgb})` : open ? `rgba(${rgb},0.85)` : 'var(--muted-foreground)',
        filter: isActive ? `drop-shadow(0 0 3px rgba(${rgb},0.45))` : 'none',
        transition: 'color 0.18s, filter 0.18s',
      }} />

      <span style={{
        fontSize: 11, fontWeight: isActive ? 700 : 500,
        color: isActive ? `rgb(${rgb})` : open ? `rgba(${rgb},0.85)` : 'var(--muted-foreground)',
        textShadow: isActive ? `0 0 8px rgba(${rgb},0.3)` : 'none',
        whiteSpace: 'nowrap',
        transition: 'all 0.18s',
      }}>
        {group.title}
      </span>

      <ChevronDown style={{
        width: 10, height: 10, flexShrink: 0,
        color: isActive ? `rgba(${rgb},0.7)` : open ? `rgba(${rgb},0.5)` : 'var(--muted-foreground)',
        transform: open ? 'rotate(180deg)' : 'rotate(0)',
        transition: 'transform 0.2s ease',
      }} />

      <div
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        <MainDropdown
          group={group}
          isVisible={open}
          anchorRect={anchorRect}
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
  const { mode: navMode, setMode: setNavMode } = useNavMode();
  const trackRef = useRef<HTMLDivElement>(null);
  const [canScrollStart, setCanScrollStart] = useState(false);
  const [canScrollEnd, setCanScrollEnd] = useState(false);

  const isPosPage = pathname === '/income/pos';
  const isItemActive = (href: string) => navIsRouteActive(pathname, href);
  const activeSectionTitle = getActiveSectionTitle(pathname);
  const activeMainTitle = getActiveMainTitle(pathname);

  const visibleSections = useMemo(() => {
    if (permLoading || !isAuthenticated || !access) return [];
    return NAV_SECTIONS.map(section => ({
      ...section,
      items: section.items.filter(item => !item.disabled && canSeePage(item.href)),
    })).filter(section => section.items.length > 0);
  }, [access, permLoading, isAuthenticated, canSeePage]);

  const groupedMains = useMemo(() => buildNavTree(visibleSections), [visibleSections]);
  const isTree = navMode === 'tree';

  const updateScrollState = useCallback(() => {
    const track = trackRef.current;
    if (!track || track.children.length === 0) {
      setCanScrollStart(false);
      setCanScrollEnd(false);
      return;
    }

    const trackRect = track.getBoundingClientRect();
    const first = track.firstElementChild as HTMLElement;
    const last = track.lastElementChild as HTMLElement;
    const firstRect = first.getBoundingClientRect();
    const lastRect = last.getBoundingClientRect();

    // RTL: first pill on the right — show arrows when content overflows either edge
    setCanScrollStart(firstRect.right > trackRect.right + 2);
    setCanScrollEnd(lastRect.left < trackRect.left - 2);
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    updateScrollState();
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(track);
    track.addEventListener('scroll', updateScrollState, { passive: true });
    window.addEventListener('resize', updateScrollState);
    return () => {
      ro.disconnect();
      track.removeEventListener('scroll', updateScrollState);
      window.removeEventListener('resize', updateScrollState);
    };
  }, [updateScrollState, visibleSections]);

  // Keep the active pill in view when route changes (works for both modes)
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const activeTitle = isTree ? activeMainTitle : activeSectionTitle;
    if (!activeTitle) return;
    const attr = isTree ? 'data-main' : 'data-section';
    const pill = track.querySelector(`[${attr}="${CSS.escape(activeTitle)}"]`);
    if (!(pill instanceof HTMLElement)) return;
    pill.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  }, [activeSectionTitle, activeMainTitle, isTree, visibleSections]);

  // Vertical wheel → horizontal scroll
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const onWheel = (e: WheelEvent) => {
      if (track.scrollWidth <= track.clientWidth + 1) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      e.preventDefault();
      track.scrollLeft += delta;
    };

    track.addEventListener('wheel', onWheel, { passive: false });
    return () => track.removeEventListener('wheel', onWheel);
  }, [visibleSections]);

  const scrollByDir = (dir: 'start' | 'end') => {
    const track = trackRef.current;
    if (!track) return;
    const pills = Array.from(track.querySelectorAll('[data-section],[data-main]')) as HTMLElement[];
    if (pills.length === 0) return;
    const trackRect = track.getBoundingClientRect();

    if (dir === 'start') {
      // Reveal content cut off on the right (RTL start)
      for (let i = pills.length - 1; i >= 0; i--) {
        if (pills[i].getBoundingClientRect().right > trackRect.right + 2) {
          pills[i].scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
          return;
        }
      }
      pills[0].scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
      return;
    }

    // Reveal content cut off on the left (RTL end)
    for (let i = 0; i < pills.length; i++) {
      if (pills[i].getBoundingClientRect().left < trackRect.left - 2) {
        pills[i].scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
        return;
      }
    }
    pills[pills.length - 1].scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  };

  if (permLoading || !isAuthenticated || !access) return null;

  const showArrows = canScrollStart || canScrollEnd;

  const arrowBtnStyle = (enabled: boolean): CSSProperties => ({
    flexShrink: 0,
    width: 22,
    height: 22,
    borderRadius: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid color-mix(in srgb, var(--topbar-border) 70%, transparent)',
    backgroundColor: enabled
      ? 'color-mix(in srgb, var(--primary) 18%, transparent)'
      : 'color-mix(in srgb, var(--muted) 40%, transparent)',
    color: enabled ? 'var(--primary)' : 'var(--muted-foreground)',
    opacity: enabled ? 1 : 0.35,
    cursor: enabled ? 'pointer' : 'default',
    transition: 'opacity 0.2s ease, background-color 0.2s ease',
    pointerEvents: enabled ? 'auto' : 'none',
  });

  const modeButtonStyle = (active: boolean): CSSProperties => ({
    border: '1px solid color-mix(in srgb, var(--topbar-border) 70%, transparent)',
    backgroundColor: active
      ? 'color-mix(in srgb, var(--primary) 20%, transparent)'
      : 'transparent',
    color: active ? 'var(--primary)' : 'var(--muted-foreground)',
    borderRadius: 9999,
    padding: '3px 9px',
    fontSize: 10,
    fontWeight: active ? 800 : 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'background-color 0.18s ease, color 0.18s ease',
  });

  return (
    <nav
      dir="rtl"
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        padding: '3px 4px 5px',
        backgroundColor: 'color-mix(in srgb, var(--topbar-background) 80%, transparent)',
        border: '1px solid color-mix(in srgb, var(--topbar-border) 50%, transparent)',
        borderRadius: 9999,
        overflow: 'visible',
        flexShrink: 1,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          padding: 2,
          borderRadius: 9999,
          backgroundColor: 'color-mix(in srgb, var(--topbar-background) 92%, transparent)',
          border: '1px solid color-mix(in srgb, var(--topbar-border) 50%, transparent)',
          flexShrink: 0,
        }}
        title="تبديل شكل القائمة"
      >
        <button type="button" onClick={() => setNavMode('legacy')} style={modeButtonStyle(navMode === 'legacy')}>
          قديم
        </button>
        <button type="button" onClick={() => setNavMode('tree')} style={modeButtonStyle(navMode === 'tree')}>
          جديد
        </button>
      </div>

      {showArrows && (
        <button
          type="button"
          aria-label="تمرير لليمين"
          onClick={() => scrollByDir('start')}
          style={arrowBtnStyle(canScrollStart)}
        >
          <ChevronRight style={{ width: 12, height: 12 }} />
        </button>
      )}

      <div
        ref={trackRef}
        className="scrollbar-luxury"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          padding: '0 4px 6px',
          flex: 1,
          minWidth: 0,
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollBehavior: 'smooth',
          WebkitOverflowScrolling: 'touch',
          overscrollBehaviorX: 'contain',
          touchAction: 'pan-x',
        }}
      >
        {isTree
          ? groupedMains.map(group => {
              const isActive = activeMainTitle === group.title;
              const isDimmed = activeMainTitle !== null && !isActive;
              return (
                <MainPill
                  key={group.title}
                  group={group}
                  isActive={isActive}
                  isDimmed={isDimmed}
                  isRouteActive={isItemActive}
                />
              );
            })
          : visibleSections.map(section => {
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

        {!isPosPage && (
          <div style={{ marginRight: 8, marginLeft: 4, flexShrink: 0 }}>
            <DbConnectionStatus />
          </div>
        )}
      </div>

      {showArrows && (
        <button
          type="button"
          aria-label="تمرير لليسار"
          onClick={() => scrollByDir('end')}
          style={arrowBtnStyle(canScrollEnd)}
        >
          <ChevronLeft style={{ width: 12, height: 12 }} />
        </button>
      )}
    </nav>
  );
}
