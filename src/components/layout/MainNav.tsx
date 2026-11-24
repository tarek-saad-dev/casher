'use client';

import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react';
import { usePermissions } from '@/components/providers/PermissionsProvider';
import { useRouteAccess } from '@/hooks/useRouteAccess';
import { useTenantShell } from '@/components/tenant/TenantShellProvider';
import { brandPrintTitle, brandWordmark } from '@/platform/branding/brandProfile';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ChevronDown, Menu, X, PanelRightClose, PanelRightOpen, MonitorPlay, Crown, ServerCog } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  NAV_SECTIONS, NAV_CATEGORIES,
  isRouteActive as navIsRouteActive,
  getActiveSectionTitle,
  getActiveNavItem,
  getActiveCategoryTitle,
  getActiveMainTitle,
  buildNavTree,
} from './nav-config';
import type { NavItem, NavSection, NavCategory, NavMainGroup } from './nav-config';
import SidebarThemeSwitch from '@/components/theme/SidebarThemeSwitch';
import { useMobileNav } from '@/components/layout/MobileNavContext';
import { useNavMode } from '@/hooks/useNavMode';
import { cn } from '@/lib/utils';
import { useWhatsAppAttention } from '@/components/layout/WhatsAppAttentionProvider';

// ─────────────────────────────────────────────────────────────────────────────
// DRVO App Shell — contextual sidebar (ADR-023 `sidebar` pattern).
// Plum marks navigation context (active item), neutrals everywhere else.
// No per-section colours, glows or emojis. Permission / tenant-app filtering
// comes from the route registry (useRouteAccess) — the same rule the page
// gate uses — plus the tenant's installed apps.
// ─────────────────────────────────────────────────────────────────────────────

const COLLAPSE_KEY = 'drvo-sidebar-collapsed';

interface MainNavProps {
  /** Hide mobile header/menu chrome (used on POS mobile layout). */
  suppressMobileChrome?: boolean;
}

function CountBadge({ count, tone = 'danger' }: { count: number; tone?: 'danger' | 'success' }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        'num inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[0.6875rem] font-bold',
        tone === 'danger' ? 'bg-destructive text-destructive-foreground' : 'bg-success text-success-foreground',
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

export default function MainNav({ suppressMobileChrome = false }: MainNavProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? '';
  const { isOpen: mobileMenuOpen, close: closeMobileMenu, toggle: toggleMobileMenu } = useMobileNav();
  const { mode: navMode, setMode: setNavMode } = useNavMode();
  const [expandedSections, setExpandedSections] = useState<string[]>(['المدخلات']);
  const [expandedMains, setExpandedMains] = useState<string[]>(['العمليات اليومية']);
  const [expandedMobileCategories, setExpandedMobileCategories] = useState<string[]>(['العمليات اليومية']);
  const [isCollapsed, setIsCollapsedState] = useState(false);

  const { access, loading: permLoading, isAuthenticated } = usePermissions();
  const { canOpen } = useRouteAccess();
  const { count: whatsAppAttentionCount } = useWhatsAppAttention();
  const { snapshot: tenantShell, isAppRouteAvailable } = useTenantShell();
  const canSeePage = useCallback(
    (href: string) => canOpen(href) && isAppRouteAvailable(href),
    [canOpen, isAppRouteAvailable],
  );
  const brandName = tenantShell?.brand.displayName ?? '';
  const brandTitle = brandPrintTitle(brandName);
  const brandLogo = tenantShell?.brand.logoUrl ?? null;
  const clubLabel = brandName ? `${brandWordmark(brandName)} CLUB` : 'CLUB';
  const isPlatformOperator = tenantShell?.isPlatformOperator === true;

  // Collapsed state is a remembered user preference (not an auto-timer).
  useEffect(() => {
    try {
      setIsCollapsedState(window.localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      // storage unavailable — keep expanded
    }
  }, []);
  const setIsCollapsed = useCallback((next: boolean) => {
    setIsCollapsedState(next);
    try {
      window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
    } catch {
      // ignore
    }
  }, []);

  // Filter nav sections based on user permissions and the tenant's installed apps
  // 3 states: loading → skeleton | not-authenticated → empty | authenticated → filtered
  const visibleSections = useMemo(() => {
    if (permLoading) return [];
    if (!isAuthenticated || !access) return [];
    return NAV_SECTIONS.map(section => ({
      ...section,
      items: section.items.filter(item => !item.disabled && canSeePage(item.href)),
    })).filter(section => section.items.length > 0);
  }, [access, permLoading, isAuthenticated, canSeePage]);

  // The payment-audit badge used to poll /api/audit/unspecified-payment-methods/count
  // on every page. That API was removed (96ef91ad), so the call only produced 404s;
  // the badge stays hidden until a count endpoint exists again.
  const paymentAuditCount = 0;

  const activeSectionTitle = getActiveSectionTitle(pathname, search);
  const activeNavItem = getActiveNavItem(pathname, search);
  const activeCategoryTitle = getActiveCategoryTitle(activeSectionTitle);
  const activeMainTitle = getActiveMainTitle(pathname, search);
  // Exactly one menu item is active: the most specific match (tabs included).
  const isActive = (href: string) =>
    activeNavItem ? activeNavItem.href === href : navIsRouteActive(pathname, href, search);
  const activeDirectLink = useMemo(() => {
    if (navIsRouteActive(pathname, '/operations')) return { label: 'لوحة التشغيل', section: 'اختصار' };
    if (navIsRouteActive(pathname, '/admin/cut-club')) return { label: clubLabel, section: 'اختصار' };
    if (navIsRouteActive(pathname, '/platform')) return { label: 'لوحة المنصة', section: 'اختصار' };
    return null;
  }, [pathname, clubLabel]);

  const currentPageLabel = activeNavItem?.label ?? activeDirectLink?.label ?? null;
  const currentSectionLabel = activeSectionTitle ?? activeDirectLink?.section ?? null;
  const isOperationsRoute = isActive('/operations');

  // Lock body scroll when mobile menu is open; Escape closes it.
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMobileMenu();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [mobileMenuOpen, closeMobileMenu]);

  // Auto-expand the active section/category/main when navigating
  useEffect(() => {
    if (activeSectionTitle) {
      setExpandedSections(prev => (prev.includes(activeSectionTitle) ? prev : [...prev, activeSectionTitle]));
    }
    if (activeCategoryTitle) {
      setExpandedMobileCategories(prev => (prev.includes(activeCategoryTitle) ? prev : [...prev, activeCategoryTitle]));
    }
    if (activeMainTitle) {
      setExpandedMains(prev => (prev.includes(activeMainTitle) ? prev : [...prev, activeMainTitle]));
    }
  }, [pathname, activeSectionTitle, activeCategoryTitle, activeMainTitle]);

  const toggleIn = (setter: (fn: (prev: string[]) => string[]) => void) => (title: string) =>
    setter(prev => (prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title]));
  const toggleSection = toggleIn(setExpandedSections);
  const toggleMobileCategory = toggleIn(setExpandedMobileCategories);
  const toggleMain = toggleIn(setExpandedMains);

  const sectionMap = useMemo(
    () => new Map(visibleSections.map(section => [section.title, section])),
    [visibleSections],
  );

  const mobileCategories = useMemo(
    () =>
      NAV_CATEGORIES.map(category => ({
        ...category,
        sections: category.sectionTitles
          .map(title => sectionMap.get(title))
          .filter((section): section is NavSection => Boolean(section)),
      })).filter(category => category.sections.length > 0),
    [sectionMap],
  );

  const groupedMains = useMemo(() => buildNavTree(visibleSections), [visibleSections]);

  const directLinks = useMemo(
    () =>
      [
        canSeePage('/operations') && { href: '/operations', label: 'لوحة التشغيل', Icon: MonitorPlay },
        canSeePage('/admin/cut-club') && { href: '/admin/cut-club', label: clubLabel, Icon: Crown },
        isPlatformOperator && { href: '/platform', label: 'لوحة المنصة', Icon: ServerCog },
      ].filter(Boolean) as { href: string; label: string; Icon: LucideIcon }[],
    [canSeePage, clubLabel, isPlatformOperator],
  );

  const itemBadge = (item: NavItem): ReactNode => {
    if (item.badge === 'payment-audit') return <CountBadge count={paymentAuditCount} />;
    if (item.badge === 'whatsapp-unread') return <CountBadge count={whatsAppAttentionCount} tone="success" />;
    return null;
  };

  // ── Brand mark ─────────────────────────────────────────────────────────────
  const BrandMark = ({ className }: { className?: string }) =>
    brandLogo ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={brandLogo} alt={brandName} className={cn('object-contain', className)} />
    ) : (
      <div
        className={cn('flex items-center justify-center rounded-lg bg-brand font-bold text-brand-foreground', className)}
        aria-label={brandName}
      >
        {brandName.trim().charAt(0)}
      </div>
    );

  // ── Shared item link ───────────────────────────────────────────────────────
  const itemClass = (active: boolean) =>
    cn(
      'group relative flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[0.8125rem] transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
      active
        ? 'bg-sidebar-active font-semibold text-sidebar-active-foreground before:absolute before:inset-y-1.5 before:start-0 before:w-[3px] before:rounded-full before:bg-brand'
        : 'text-sidebar-foreground hover:bg-sidebar-hover',
    );

  const renderItem = (item: NavItem, onNavigate?: () => void) => {
    const active = isActive(item.href);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={itemClass(active)}
      >
        <Icon className={cn('size-4 shrink-0', active ? 'text-brand' : 'text-muted-foreground group-hover:text-foreground')} aria-hidden />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {itemBadge(item)}
      </Link>
    );
  };

  const renderDirectLink = (href: string, label: string, Icon: LucideIcon, onNavigate?: () => void) => {
    const active = isActive(href);
    if (isCollapsed && !onNavigate) {
      return (
        <Link
          key={href}
          href={href}
          title={label}
          aria-label={label}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'flex size-10 items-center justify-center rounded-lg transition-colors',
            active ? 'bg-sidebar-active text-brand' : 'text-muted-foreground hover:bg-sidebar-hover hover:text-foreground',
          )}
        >
          <Icon className="size-[1.125rem]" aria-hidden />
        </Link>
      );
    }
    return (
      <Link key={href} href={href} onClick={onNavigate} aria-current={active ? 'page' : undefined} className={itemClass(active)}>
        <Icon className={cn('size-4 shrink-0', active ? 'text-brand' : 'text-muted-foreground')} aria-hidden />
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </Link>
    );
  };

  // ── Section (SUB) renderer ─────────────────────────────────────────────────
  const renderSection = (section: NavSection, onNavigate?: () => void) => {
    const isExpanded = expandedSections.includes(section.title);
    const hasActive = activeSectionTitle === section.title;
    const SectionIcon = section.icon;
    const panelId = `nav-sec-${section.title}`;
    return (
      <div key={section.title} className="mb-0.5">
        <button
          type="button"
          onClick={() => toggleSection(section.title)}
          aria-expanded={isExpanded}
          aria-controls={panelId}
          className={cn(
            'flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-xs font-semibold transition-colors',
            hasActive ? 'text-brand' : 'text-muted-foreground hover:bg-sidebar-hover hover:text-foreground',
          )}
        >
          <SectionIcon className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-start">{section.title}</span>
          <ChevronDown className={cn('size-3.5 shrink-0 transition-transform', isExpanded && 'rotate-180')} aria-hidden />
        </button>
        {isExpanded ? (
          <div id={panelId} className="mt-0.5 space-y-0.5 ps-2">
            {section.items.map(item => renderItem(item, onNavigate))}
          </div>
        ) : null}
      </div>
    );
  };

  // ── MAIN group renderer (tree mode) ────────────────────────────────────────
  const renderMainGroup = (group: NavMainGroup) => {
    const MainIcon = group.meta.icon;
    const isMainActive = activeMainTitle === group.title;
    const isExpanded = expandedMains.includes(group.title);
    return (
      <div key={group.title} className="mb-1">
        <button
          type="button"
          onClick={() => toggleMain(group.title)}
          aria-expanded={isExpanded}
          className={cn(
            'flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[0.8125rem] font-bold transition-colors',
            isMainActive ? 'text-brand-deep' : 'text-sidebar-foreground hover:bg-sidebar-hover',
          )}
        >
          <span
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-md',
              isMainActive ? 'bg-brand text-brand-foreground' : 'bg-muted text-muted-foreground',
            )}
          >
            <MainIcon className="size-3.5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1 truncate text-start">{group.title}</span>
          <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', isExpanded && 'rotate-180')} aria-hidden />
        </button>
        {isExpanded ? (
          <div className="mt-0.5 ps-3">
            {group.subs.map(section => renderSection(section))}
          </div>
        ) : null}
      </div>
    );
  };

  // ── Collapsed rail: one icon per section; click expands the sidebar there ──
  const renderCollapsedSection = (section: NavSection) => {
    const SectionIcon = section.icon;
    const hasActive = activeSectionTitle === section.title;
    return (
      <button
        key={section.title}
        type="button"
        title={section.title}
        aria-label={section.title}
        onClick={() => {
          setExpandedSections(prev => (prev.includes(section.title) ? prev : [...prev, section.title]));
          setIsCollapsed(false);
        }}
        className={cn(
          'flex size-10 items-center justify-center rounded-lg transition-colors',
          hasActive ? 'bg-sidebar-active text-brand' : 'text-muted-foreground hover:bg-sidebar-hover hover:text-foreground',
        )}
      >
        <SectionIcon className="size-[1.125rem]" aria-hidden />
      </button>
    );
  };

  const NavSkeleton = () => (
    <div className="flex flex-col gap-2 p-2" aria-hidden>
      {[72, 56, 64, 48, 60].map((w, i) => (
        <div key={i} className="h-7 animate-pulse rounded-md bg-muted" style={{ width: isCollapsed ? 28 : `${w}%` }} />
      ))}
    </div>
  );

  const NavModeToggle = () => (
    <div className="flex items-center gap-0.5 rounded-md border border-sidebar-border bg-muted p-0.5" title="تبديل شكل القائمة">
      {([
        { id: 'tree', label: 'مجمّعة' },
        { id: 'legacy', label: 'مسطّحة' },
      ] as const).map(opt => {
        const active = navMode === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => setNavMode(opt.id)}
            aria-pressed={active}
            className={cn(
              'h-6 rounded px-2 text-[0.6875rem] font-semibold transition-colors',
              active ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );

  // ── Mobile renderers ───────────────────────────────────────────────────────
  const renderMobileCategory = (category: NavCategory & { sections: NavSection[] }) => {
    const isExpanded = expandedMobileCategories.includes(category.title);
    const hasActiveSection = category.sections.some(s => s.title === activeSectionTitle);
    return (
      <div key={category.title} className="mb-2 rounded-xl border border-border bg-card">
        <button
          type="button"
          onClick={() => toggleMobileCategory(category.title)}
          aria-expanded={isExpanded}
          className="flex w-full items-center gap-3 px-3 py-3 text-start"
        >
          <div className="min-w-0 flex-1">
            <p className={cn('text-sm font-bold', hasActiveSection ? 'text-brand' : 'text-foreground')}>{category.title}</p>
            <p className="truncate text-xs text-muted-foreground">{category.description}</p>
          </div>
          <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', isExpanded && 'rotate-180')} aria-hidden />
        </button>
        {isExpanded ? (
          <div className="border-t border-border p-2">
            {category.sections.map(section => renderSection(section, closeMobileMenu))}
          </div>
        ) : null}
      </div>
    );
  };

  const MobileNavContent = () => (
    <div className="flex-1 overflow-y-auto px-3 py-3 scrollbar-luxury-v">
      {permLoading ? (
        <NavSkeleton />
      ) : isAuthenticated && access ? (
        <>
          {directLinks.length > 0 && (
            <div className="mb-3 space-y-0.5">
              {directLinks.map(link => renderDirectLink(link.href, link.label, link.Icon, closeMobileMenu))}
            </div>
          )}
          {mobileCategories.map(category => renderMobileCategory(category))}
          {mobileCategories.length === 0 && directLinks.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">لا توجد صفحات متاحة</p>
          )}
        </>
      ) : null}
    </div>
  );

  // ── Desktop sidebar content ────────────────────────────────────────────────
  const SidebarContent = () => (
    <div className={cn('flex-1 overflow-y-auto scrollbar-luxury-v', isCollapsed ? 'flex flex-col items-center gap-1 px-2 py-2' : 'px-2.5 py-2')}>
      {permLoading ? (
        <NavSkeleton />
      ) : isAuthenticated && access ? (
        isCollapsed ? (
          <>
            {directLinks.map(link => renderDirectLink(link.href, link.label, link.Icon))}
            {directLinks.length > 0 && <div className="my-1 h-px w-8 bg-sidebar-border" />}
            {visibleSections.map(section => renderCollapsedSection(section))}
          </>
        ) : (
          <>
            {directLinks.length > 0 && (
              <div className="mb-2 space-y-0.5 border-b border-sidebar-border pb-2">
                {directLinks.map(link => renderDirectLink(link.href, link.label, link.Icon))}
              </div>
            )}
            {navMode === 'tree'
              ? groupedMains.map(group => renderMainGroup(group))
              : visibleSections.map(section => renderSection(section))}
          </>
        )
      ) : null}
    </div>
  );

  return (
    <>
      {/* ── Desktop Sidebar (logical start: right in RTL) ─────────────────── */}
      <nav
        aria-label="التنقل الرئيسي"
        className="hidden shrink-0 flex-col border-e border-sidebar-border bg-sidebar-background transition-[width] duration-200 lg:flex"
        style={{ width: isCollapsed ? 'var(--app-sidebar-width-collapsed)' : 'var(--app-sidebar-width)' }}
      >
        <div className={cn('flex h-14 shrink-0 items-center border-b border-sidebar-border', isCollapsed ? 'justify-center px-2' : 'gap-2.5 px-3')}>
          {tenantShell && <BrandMark className={isCollapsed ? 'size-8 text-sm' : 'size-8 text-sm'} />}
          {!isCollapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-foreground">{brandTitle || brandName}</p>
              {currentSectionLabel ? <p className="truncate text-[0.6875rem] text-muted-foreground">{currentSectionLabel}</p> : null}
            </div>
          )}
        </div>

        <SidebarContent />

        <div className={cn('shrink-0 border-t border-sidebar-border', isCollapsed ? 'flex flex-col items-center gap-2 p-2' : 'flex items-center justify-between gap-2 p-2.5')}>
          {!isCollapsed && <NavModeToggle />}
          {!isCollapsed && <SidebarThemeSwitch />}
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-hover hover:text-foreground"
            title={isCollapsed ? 'توسيع القائمة' : 'طي القائمة'}
            aria-label={isCollapsed ? 'توسيع القائمة' : 'طي القائمة'}
          >
            {isCollapsed ? <PanelRightOpen className="size-4" aria-hidden /> : <PanelRightClose className="size-4" aria-hidden />}
          </button>
        </div>
      </nav>

      {/* ── Mobile / tablet header ───────────────────────────────────────── */}
      <div
        className={cn(
          'flex items-center justify-between border-b border-border bg-card lg:hidden',
          isOperationsRoute ? 'h-10 px-2' : 'h-14 px-3',
          suppressMobileChrome && 'max-md:hidden',
        )}
      >
        <div className={cn('flex min-w-0 items-center', isOperationsRoute ? 'gap-1.5' : 'gap-2.5')}>
          {tenantShell && <BrandMark className={isOperationsRoute ? 'size-6 text-xs' : 'size-8 text-sm'} />}
          <div className="min-w-0">
            <h2 className={cn('truncate font-bold leading-tight text-foreground', isOperationsRoute ? 'text-xs' : 'text-sm')}>{brandTitle}</h2>
            {currentPageLabel && !isOperationsRoute && (
              <p className="mt-0.5 truncate text-[0.6875rem] leading-tight text-muted-foreground">
                {currentSectionLabel && <span>{currentSectionLabel} · </span>}
                {currentPageLabel}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => toggleMobileMenu()}
          aria-label={mobileMenuOpen ? 'إغلاق القائمة' : 'فتح القائمة'}
          aria-expanded={mobileMenuOpen}
          className={cn(
            'flex shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
            isOperationsRoute ? 'size-8' : 'size-10',
          )}
        >
          {mobileMenuOpen ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
        </button>
      </div>

      {/* ── Mobile drawer ─────────────────────────────────────────────────── */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-50 bg-foreground/30 lg:hidden"
          onClick={() => closeMobileMenu()}
          role="dialog"
          aria-modal="true"
          aria-label="قائمة التنقل"
        >
          <div
            className="absolute inset-y-0 start-0 flex w-[min(92vw,360px)] flex-col border-e border-border bg-background shadow-lg"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-card p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  {tenantShell && <BrandMark className="size-9 text-base" />}
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-bold text-foreground">{brandTitle}</h2>
                    <p className="text-xs text-muted-foreground">تصفح الصفحات حسب القسم</p>
                  </div>
                </div>
                {currentPageLabel && (
                  <div className="mt-3 truncate rounded-lg bg-brand-soft px-3 py-2 text-xs text-muted-foreground">
                    <span className="font-semibold text-brand">الصفحة الحالية: </span>
                    {activeCategoryTitle && <span>{activeCategoryTitle} › </span>}
                    {currentSectionLabel && <span>{currentSectionLabel} › </span>}
                    <span className="font-medium text-foreground">{currentPageLabel}</span>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => closeMobileMenu()}
                aria-label="إغلاق القائمة"
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>

            <MobileNavContent />

            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-card p-3">
              <NavModeToggle />
              <SidebarThemeSwitch />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
